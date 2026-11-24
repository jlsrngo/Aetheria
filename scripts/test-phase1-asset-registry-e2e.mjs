#!/usr/bin/env node
/**
 * Repeatable Phase 1 E2E test: Unified Asset Registry (`assets.json`) & Cutout Runtime (`AM.drawAsset`).
 *
 * Verifies real layers end-to-end against a freshly built debug `aetheria-engine`:
 * 1. Engine health (`GET /api/health` -> `healthy: true`).
 * 2. Syncing project assets (`POST /api/studio/asset-registry` with `{ workspaceDir, sync: true }`)
 *    produces `assets.json` with valid PNG cutout, valid SVG vector, and flags corrupt PNG (`valid: false`).
 * 3. Failure path: invalid workspace returns HTTP 400 with clear JSON error (engine stays healthy).
 * 4. Full headless Chromium CDP + FFmpeg render (`POST /api/render-media`) of a 2-scene project
 *    sharing the same transparent cutout & SVG across Scene 1 and Scene 2 via `AM.drawAsset(...)`,
 *    proving non-empty animated cutout pixels in both scenes and safe handling of the corrupt entry.
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
  } catch {
    // Already exited.
  }
}

async function waitForHealth(baseUrl, authHeader, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.healthy === true) return data;
      }
    } catch {
      // Retry until ready.
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`Timed out waiting for engine health at ${baseUrl}/api/health`);
}

function createSyntheticCutoutPng(outPath) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, cv2, numpy as np",
        "img = np.zeros((240, 320, 4), dtype=np.uint8)",
        "cv2.circle(img, (210, 120), 68, (30, 140, 255, 255), -1)",
        "cv2.circle(img, (190, 100), 18, (255, 255, 255, 255), -1)",
        "cv2.imwrite(sys.argv[1], img)",
      ].join("; "),
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) {
    throw new Error(`Failed generating synthetic PNG cutout: ${py.stderr || py.stdout}`);
  }
}

function inspectRenderedVideo(mp4Path) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, json, cv2, numpy as np",
        "cap = cv2.VideoCapture(sys.argv[1])",
        "frames = []",
        "while True:",
        "    ok, fr = cap.read()",
        "    if not ok: break",
        "    frames.append(fr)",
        "cap.release()",
        "assert len(frames) >= 40, f'too few frames: {len(frames)}'",
        "f1a, f1b = frames[6], frames[24]",
        "f2a, f2b = frames[36], frames[54]",
        "def orange_px(f): return int(np.sum((f[:,:,2] > 180) & (f[:,:,1] > 90) & (f[:,:,0] < 90)))",
        "def cyan_px(f): return int(np.sum((f[:,:,0] > 160) & (f[:,:,1] > 160) & (f[:,:,2] < 90)))",
        "diff1 = float(np.mean(np.abs(f1a.astype(np.float32) - f1b.astype(np.float32))))",
        "diff2 = float(np.mean(np.abs(f2a.astype(np.float32) - f2b.astype(np.float32))))",
        "print(json.dumps({",
        "  'frameCount': len(frames),",
        "  'scene1Orange': orange_px(f1b),",
        "  'scene2Orange': orange_px(f2b),",
        "  'scene1Cyan': cyan_px(f1b),",
        "  'scene2Cyan': cyan_px(f2b),",
        "  'scene1MotionDiff': round(diff1, 3),",
        "  'scene2MotionDiff': round(diff2, 3)",
        "}))",
      ].join("\n"),
      mp4Path,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) {
    throw new Error(`Video inspection failed: ${py.stderr || py.stdout}`);
  }
  return JSON.parse(py.stdout.trim());
}

async function main() {
  const engineBin = resolveDebugEngineBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "phase1-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-phase1-e2e-"));
  const imgDir = path.join(tmpRoot, "img");
  const scriptDir = path.join(tmpRoot, "script");
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });

  // 1. Seed real transparent PNG cutout + SVG vector + broken PNG in isolated temp project
  createSyntheticCutoutPng(path.join(imgDir, "orb_cutout.png"));
  fs.writeFileSync(
    path.join(imgDir, "badge.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect x="12" y="12" width="136" height="136" rx="24" fill="#00D4FF"/></svg>`,
    "utf8",
  );
  fs.writeFileSync(path.join(imgDir, "broken.png"), "<html>not-a-png</html>", "utf8");

  const filmManifest = {
    title: "Phase 1 Asset Registry E2E",
    width: 640,
    height: 360,
    fps: 30,
    background: "#10141C",
    scenes: [
      { id: "scene1", title: "Cutout Intro", duration: 1.0, script: "script/scene1.js" },
      { id: "scene2", title: "Cutout Reuse", duration: 1.0, script: "script/scene2.js" },
    ],
  };
  fs.writeFileSync(path.join(tmpRoot, "film.json"), JSON.stringify(filmManifest, null, 2), "utf8");

  fs.writeFileSync(
    path.join(scriptDir, "scene1.js"),
    `(function () {
      var AM = window.AM;
      AM.registerScene("scene1", function (ctx, t, dur) {
        var p = AM.ease.aeGlide(AM.clamp(t / dur, 0, 1));
        var brokenDrawn = AM.drawAsset(ctx, "broken", 10, 10, 60, 60);
        if (brokenDrawn) throw new Error("broken asset must never report drawn=true");
        AM.drawAsset(ctx, "orb_cutout", 40 + p * 160, 80, 180, 180, { rot: p * 0.6 });
        AM.drawAsset(ctx, "badge", 420, 90 + (1 - p) * 40, 130, 130);
      });
    })();`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(scriptDir, "scene2.js"),
    `(function () {
      var AM = window.AM;
      AM.registerScene("scene2", function (ctx, t, dur) {
        var p = AM.ease.outQuint(AM.clamp(t / dur, 0, 1));
        AM.drawAsset(ctx, "orb_cutout", 340 - p * 120, 70, 210, 210, { flipX: true, scale: 0.9 + p * 0.2 });
        AM.drawAsset(ctx, "badge", 70 + p * 60, 110, 140, 140, { rot: -p * 0.4 });
      });
    })();`,
    "utf8",
  );

  fs.writeFileSync(
    path.join(tmpRoot, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8" />
      <style>html,body{margin:0;padding:0;background:#10141C;overflow:hidden;}canvas{display:block;}</style>
      <script src="/script/aetheria-motion.js"></script>
      <script src="/script/scene1.js"></script>
      <script src="/script/scene2.js"></script>
    </head><body>
      <canvas id="film" width="640" height="360"></canvas>
      <script>
      (function () {
        var W = 640, H = 360, SCENES = ${JSON.stringify(filmManifest.scenes)};
        window.__filmMeta = { title: "Phase 1 Asset Registry E2E", width: W, height: H, fps: 30, duration: 2.0, durationInFrames: 60, scenes: SCENES };
        var ctx = document.getElementById("film").getContext("2d");
        window.renderAt = function (t) {
          ctx.setTransform(1,0,0,1,0,0);
          ctx.fillStyle = "#10141C";
          ctx.fillRect(0, 0, W, H);
          var r = window.AM.resolveScene(t, SCENES);
          var fn = window.AM.getSceneRenderer(r.scene.id, r.index);
          if (fn) fn(ctx, r.localTime, r.scene.duration, r.scene, window.AM);
        };
        window.AM.loadAssetManifest("/assets.json").then(function () {
          window.renderAt(0);
          window.__ready = true;
        });
      })();
      </script>
    </body></html>`,
    "utf8",
  );

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
    const health = await waitForHealth(baseUrl, authHeader);
    if (!health.healthy) throw new Error("Health endpoint did not return healthy: true");

    // 2. Success path: sync assets.json via live engine API
    const syncRes = await fetch(`${baseUrl}/api/studio/asset-registry`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir: tmpRoot, sync: true }),
    });
    if (!syncRes.ok) {
      throw new Error(`asset-registry sync failed (${syncRes.status}): ${await syncRes.text()}`);
    }
    const syncJson = await syncRes.json();
    const assets = syncJson?.data?.assets || [];
    const orb = assets.find((a) => a.id === "orb_cutout");
    const badge = assets.find((a) => a.id === "badge");
    const broken = assets.find((a) => a.id === "broken");
    if (!orb?.valid || orb.kind !== "raster_cutout" || !orb.hasAlpha) {
      throw new Error(`Unexpected orb_cutout metadata: ${JSON.stringify(orb)}`);
    }
    if (!badge?.valid || badge.kind !== "svg" || badge.width !== 160 || badge.height !== 160) {
      throw new Error(`Unexpected badge SVG metadata: ${JSON.stringify(badge)}`);
    }
    if (!broken || broken.valid !== false || !Array.isArray(broken.warnings) || broken.warnings.length === 0) {
      throw new Error(`Expected broken.png to be flagged invalid with warnings: ${JSON.stringify(broken)}`);
    }

    // 3. Failure path: nonexistent workspace must return 400 cleanly without crashing engine
    const badRes = await fetch(`${baseUrl}/api/studio/asset-registry`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir: path.join(tmpRoot, "does-not-exist"), sync: true }),
    });
    if (badRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for invalid workspaceDir, got ${badRes.status}`);
    }
    const badJson = await badRes.json();
    if (!badJson?.error) {
      throw new Error(`Expected clear error message for invalid workspaceDir, got ${JSON.stringify(badJson)}`);
    }

    // 4. Real browser CDP + FFmpeg render using synced assets.json across Scene 1 & Scene 2
    const renderRes = await fetch(
      `${baseUrl}/api/render-media?directory=${encodeURIComponent(tmpRoot)}`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          "x-aetheria-directory": tmpRoot,
        },
        body: JSON.stringify({ codec: "h264", outputName: "phase1_e2e.mp4" }),
      },
    );
    if (!renderRes.ok) {
      throw new Error(`render-media start failed (${renderRes.status}): ${await renderRes.text()}`);
    }
    const renderStart = await renderRes.json();
    const renderId = renderStart.renderId || renderStart?.data?.renderId;
    if (!renderId) throw new Error(`Missing renderId in response: ${JSON.stringify(renderStart)}`);

    let job = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const pr = await fetch(`${baseUrl}/api/render-progress?renderId=${encodeURIComponent(renderId)}`, {
        headers: { Authorization: authHeader },
      });
      const pj = await pr.json();
      job = pj?.data || pj;
      if (job?.status === "done" || job?.status === "completed") break;
      if (job?.status === "error" || job?.status === "failed") {
        throw new Error(`Render job failed: ${JSON.stringify(job)}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!job || (job.status !== "done" && job.status !== "completed")) {
      throw new Error(`Render job timed out: ${JSON.stringify(job)}`);
    }

    const outMp4 = path.join(tmpRoot, "output", "phase1_e2e.mp4");
    if (!fs.existsSync(outMp4)) throw new Error(`Expected rendered MP4 at ${outMp4}`);
    const stats = inspectRenderedVideo(outMp4);
    if (stats.scene1Orange < 500 || stats.scene2Orange < 500) {
      throw new Error(`PNG cutout not rendered in both scenes: ${JSON.stringify(stats)}`);
    }
    if (stats.scene1Cyan < 500 || stats.scene2Cyan < 500) {
      throw new Error(`SVG asset not rendered in both scenes: ${JSON.stringify(stats)}`);
    }
    if (stats.scene1MotionDiff < 0.5 || stats.scene2MotionDiff < 0.5) {
      throw new Error(`Assets did not animate across frames: ${JSON.stringify(stats)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          assetsRegistered: assets.length,
          videoStats: stats,
        },
        null,
        2,
      ),
    );
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[phase1-e2e] FAILED:", err);
  process.exit(1);
});
