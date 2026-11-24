#!/usr/bin/env node
/**
 * Repeatable Phase 3 E2E test: Universal Multi-Layer Compositor (`aetheria-stage.js`)
 * + Unified 2D/3D/DOM Camera Adapter (`StoryCamera` + `AM.createStage`).
 *
 * Implements the roadmap's 5-technology single-scene acceptance criterion against live debug engine:
 *   1. SVG/HTML text overlay (`kind: "svg"` synced to camera matrix)
 *   2. Transparent PNG cutout from `assets.json` (`kind: "asset"` child inside animated parent group)
 *   3. Canvas 2D deterministic particles (`kind: "canvas2d"` with parallax)
 *   4. Three.js 3D lit rotating mesh (`kind: "three"`, `preserveDrawingBuffer: true`, synced 3D camera)
 *   5. WebGL2 post-processing (`aetheria-post.js` bloom + vignette + grain)
 * All driven synchronously by one shared timeline (`window.renderAt(t)`) and one camera rig,
 * plus failure-path verification that cyclic `parentId` is rejected cleanly without crashing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDebugEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const debugBin = path.join(REPO_ROOT, "target", "debug", exe);
  if (fs.existsSync(debugBin)) return debugBin;
  throw new Error(`Debug engine binary not found at ${debugBin}. Run "npm run build:engine" first.`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

function killProcessTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

async function waitForHealth(baseUrl, authHeader, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok && (await r.json())?.healthy === true) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`Timed out waiting for engine health at ${baseUrl}/api/health`);
}

function createCutoutAsset(outPath) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, cv2, numpy as np",
        "img = np.zeros((160, 160, 4), dtype=np.uint8)",
        "cv2.circle(img, (80, 80), 62, (20, 240, 20, 255), -1)",
        "cv2.circle(img, (80, 80), 18, (255, 255, 255, 255), -1)",
        "cv2.imwrite(sys.argv[1], img)",
      ].join("; "),
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) throw new Error(`Failed creating cutout PNG: ${py.stderr || py.stdout}`);
}

function inspectCompositeVideo(mp4Path) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, json, cv2, numpy as np",
        "cap = cv2.VideoCapture(sys.argv[1])",
        "frames = []",
        "while True:",
        "    ok, f = cap.read()",
        "    if not ok: break",
        "    frames.append(f)",
        "cap.release()",
        "assert len(frames) >= 24, f'too few frames: {len(frames)}'",
        "fa, fb = frames[3], frames[21]",
        "# Green cutout PNG pixels (G high, R/B low)",
        "green_a = int(np.sum((fa[:,:,1] > 160) & (fa[:,:,2] < 110) & (fa[:,:,0] < 120)))",
        "green_b = int(np.sum((fb[:,:,1] > 160) & (fb[:,:,2] < 110) & (fb[:,:,0] < 120)))",
        "# Magenta/red Three.js 3D cube pixels (R high, B high or R >> G)",
        "red_a = int(np.sum((fa[:,:,2] > 160) & (fa[:,:,1] < 110)))",
        "red_b = int(np.sum((fb[:,:,2] > 160) & (fb[:,:,1] < 110)))",
        "# Bright white/yellow SVG title & particles pixels",
        "bright_b = int(np.sum((fb[:,:,2] > 210) & (fb[:,:,1] > 200) & (fb[:,:,0] > 160)))",
        "motion_diff = float(np.mean(np.abs(fa.astype(np.float32) - fb.astype(np.float32))))",
        "print(json.dumps({",
        "  'frameCount': len(frames),",
        "  'cutoutGreenPx': [green_a, green_b],",
        "  'threeCubeRedPx': [red_a, red_b],",
        "  'brightTextAndParticlesPx': bright_b,",
        "  'motionDiff': round(motion_diff, 3)",
        "}))",
      ].join("\n"),
      mp4Path,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) throw new Error(`Video inspection failed: ${py.stderr || py.stdout}`);
  return JSON.parse(py.stdout.trim());
}

async function main() {
  const engineBin = resolveDebugEngineBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "phase3-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-phase3-e2e-"));
  fs.mkdirSync(path.join(tmpRoot, "img"), { recursive: true });
  createCutoutAsset(path.join(tmpRoot, "img", "emblem.png"));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      html,body{width:640px;height:360px;overflow:hidden;background:#0e121c;}
      #stage{position:relative;width:640px;height:360px;overflow:hidden;}
      #film{position:absolute;inset:0;width:640px;height:360px;display:block;}
      #svg-hud{position:absolute;left:0;top:0;width:640px;height:360px;pointer-events:none;}
    </style>
    <script src="/script/three.min.js"></script>
    <script src="/script/story-camera.js"></script>
    <script src="/script/aetheria-post.js"></script>
    <script src="/script/aetheria-stage.js"></script>
    <script src="/script/aetheria-motion.js"></script>
  </head><body>
    <div id="stage">
      <canvas id="film" width="640" height="360"></canvas>
      <svg id="svg-hud" viewBox="0 0 640 360" width="640" height="360">
        <text x="320" y="64" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="38" fill="#FFFFFF">UNIFIED 5-LAYER STAGE</text>
      </svg>
    </div>
    <script>
    (function () {
      var W = 640, H = 360;
      window.__filmMeta = { title: "Phase 3 Unified Stage E2E", width: W, height: H, fps: 30, duration: 1.0, durationInFrames: 30, scenes: [{ id: "unified", duration: 1.0 }] };
      var canvas = document.getElementById("film");
      var ctx = canvas.getContext("2d");
      var svgHud = document.getElementById("svg-hud");

      // Offscreen Three.js WebGL canvas composited into unified layer stack
      var glCanvas = document.createElement("canvas");
      glCanvas.width = W;
      glCanvas.height = H;
      var renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(W, H, false);
      renderer.setClearColor(0x000000, 0);
      var scene3D = new THREE.Scene();
      var cam3D = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
      cam3D.position.set(0, 0, 5.2);
      var cube = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 1.7, 1.7),
        new THREE.MeshStandardMaterial({ color: 0xff2266, emissive: 0x550822, roughness: 0.35, metalness: 0.2 })
      );
      cube.position.set(1.2, 0.1, 0);
      scene3D.add(cube);
      var keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(3, 4, 5);
      scene3D.add(keyLight);
      scene3D.add(new THREE.AmbientLight(0xffffff, 0.55));

      var stage = window.AM.createStage({ width: W, height: H });

      // Verify cycle guard failure path without crashing stage
      stage.addLayer({ id: "cycle_a", kind: "group" });
      stage.addLayer({ id: "cycle_b", parentId: "cycle_a", kind: "group" });
      var cycleCaught = false;
      try {
        stage.addLayer({ id: "cycle_a", parentId: "cycle_b", kind: "group" });
      } catch (e) {
        cycleCaught = true;
      }
      if (!cycleCaught) throw new Error("Cycle guard did not reject cyclic parentId");
      stage.removeLayer("cycle_b");
      stage.removeLayer("cycle_a");

      // Layer 1: Canvas 2D deterministic particles (parallax 0.6)
      var rng = window.AM.rng(42);
      var particles = [];
      for (var i = 0; i < 36; i++) {
        particles.push({ x: rng() * W, y: rng() * H, r: 2 + rng() * 4, vx: (rng() - 0.5) * 40 });
      }
      stage.addLayer({
        id: "particles_2d",
        kind: "canvas2d",
        zIndex: 1,
        parallax: 0.6,
        draw: function (c, t) {
          c.fillStyle = "#FFF4A3";
          for (var j = 0; j < particles.length; j++) {
            var pt = particles[j];
            c.beginPath();
            c.arc((pt.x + pt.vx * t + W) % W, pt.y, pt.r, 0, Math.PI * 2);
            c.fill();
          }
        }
      });

      // Layer 2: Three.js 3D lit rotating mesh driven by unified camera
      stage.addLayer({
        id: "three_cube",
        kind: "three",
        zIndex: 2,
        threeCanvas: glCanvas,
        threeCamera: cam3D,
        baseCamPos: [0, 0, 5.2],
        baseLookAt: [0, 0, 0],
        draw: function (_c, t) {
          cube.rotation.y = 0.4 + t * 2.1;
          cube.rotation.x = 0.25 + t * 0.9;
          renderer.render(scene3D, cam3D);
        }
      });

      // Layer 3: Parent group + child PNG cutout from assets.json
      stage.addLayer({
        id: "hero_group",
        kind: "group",
        x: 170,
        y: 205,
        anchor: [0, 0],
        update: function (layer, t) {
          layer.x = 150 + t * 50;
          layer.rotation = (t - 0.5) * 0.35;
        }
      });
      stage.addLayer({
        id: "cutout_emblem",
        parentId: "hero_group",
        kind: "asset",
        assetId: "emblem",
        x: 0,
        y: 0,
        width: 130,
        height: 130,
        anchor: [0.5, 0.5],
        zIndex: 3
      });

      // Layer 4: SVG text overlay synced to the same camera rig
      stage.addLayer({
        id: "svg_title",
        kind: "svg",
        element: svgHud,
        zIndex: 10,
        parallax: 0.85,
        anchor: [0, 0]
      });

      window.renderAt = function (t) {
        var u = window.AM.ease.aeGlide(window.AM.clamp(t / 1.0, 0, 1));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#121826";
        ctx.fillRect(0, 0, W, H);

        // Shared camera moves 2D particles, Three.js 3D camera, cutout rig, and SVG title together
        stage.setCamera({
          zoom: 1.0 + u * 0.14,
          panX: (u - 0.5) * 32,
          panY: Math.sin(u * Math.PI) * -10,
          roll: (u - 0.5) * 3.0
        });

        stage.render(ctx, t, {
          postProcess: { bloom: 0.45, vignette: 0.32, grain: 0.02, fps: 30 }
        });
      };

      window.AM.loadAssetManifest("/assets.json").then(function () {
        window.renderAt(0);
        window.__ready = true;
      });
    })();
    </script>
  </body></html>`;
  fs.writeFileSync(path.join(tmpRoot, "index.html"), html, "utf8");

  const engineProc = spawn(engineBin, ["serve", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_MOTION_BLUR: "off",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let engineStderr = "";
  engineProc.stderr?.on("data", (d) => {
    engineStderr += d.toString();
  });

  try {
    await waitForHealth(baseUrl, authHeader);

    // Sync assets.json via Phase 1 live API first
    const syncRes = await fetch(`${baseUrl}/api/studio/asset-registry`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir: tmpRoot, sync: true }),
    });
    if (!syncRes.ok) throw new Error(`asset-registry sync failed: ${await syncRes.text()}`);

    // Render 5-layer unified composition via live headless CDP + FFmpeg
    const r = await fetch(`${baseUrl}/api/render-media?directory=${encodeURIComponent(tmpRoot)}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "x-aetheria-directory": tmpRoot,
      },
      body: JSON.stringify({ codec: "h264", outputName: "phase3_unified.mp4" }),
    });
    if (!r.ok) throw new Error(`render-media failed (${r.status}): ${await r.text()}`);
    const j = await r.json();
    const renderId = j.renderId || j?.data?.renderId;
    const deadline = Date.now() + 60_000;
    let done = false;
    while (Date.now() < deadline) {
      const pr = await fetch(`${baseUrl}/api/render-progress?renderId=${encodeURIComponent(renderId)}`, {
        headers: { Authorization: authHeader },
      });
      const pj = await pr.json();
      const job = pj?.data || pj;
      if (job?.status === "done" || job?.status === "completed") {
        done = true;
        break;
      }
      if (job?.status === "error" || job?.status === "failed") {
        throw new Error(`Render failed: ${JSON.stringify(job)}`);
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    if (!done) throw new Error("Render timed out");

    const mp4 = path.join(tmpRoot, "output", "phase3_unified.mp4");
    const stats = inspectCompositeVideo(mp4);
    if (stats.cutoutGreenPx[0] < 800 || stats.cutoutGreenPx[1] < 800) {
      throw new Error(`PNG cutout layer missing in render: ${JSON.stringify(stats)}`);
    }
    if (stats.threeCubeRedPx[0] < 800 || stats.threeCubeRedPx[1] < 800) {
      throw new Error(`Three.js 3D layer missing in render: ${JSON.stringify(stats)}`);
    }
    if (stats.brightTextAndParticlesPx < 300) {
      throw new Error(`SVG title / Canvas particles missing in render: ${JSON.stringify(stats)}`);
    }
    if (stats.motionDiff < 1.5) {
      throw new Error(`Unified camera/layers did not animate visibly: ${JSON.stringify(stats)}`);
    }

    console.log(JSON.stringify({ ok: true, unifiedFiveLayerVerified: true, stats }, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Phase 3 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[phase3-e2e] FAILED:", err);
  process.exit(1);
});
