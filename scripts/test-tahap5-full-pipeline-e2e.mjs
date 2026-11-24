/**
 * Repeatable Tahap 5 Full-Pipeline Integrated E2E Test:
 * Exercises auto-injected built-in engine runtimes (`aetheria-post`, `aetheria-tracks`,
 * `aetheria-behaviors`, `aetheria-shapes-text`, `aetheria-stage`, `aetheria-motion`)
 * with ZERO manual runtime <script> tags in `index.html`, combining:
 *   - Tahap 1: Spatial 3-key `position` + `rotationDeg` AE speed-graph tracks
 *   - Tahap 2: Additive `breathe` / `floatUpDown` behaviors + parent-child `followLag`
 *   - Tahap 3: `bounceInWords` text animator + `morphPath` + `trimPaths` + `repeatDraw`
 *   - Tahap 4: Alpha Track Matte + Echo Trail + WebGL2 DoF & Directional Blur
 *   - Failure path: invalid directory render fails cleanly while `/api/health` remains healthy.
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

function inspectFullStack(mp4Path) {
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
        "f0, f1 = frames[2], frames[24]",
        "motion_diff = float(np.mean(np.abs(f0.astype(np.float32) - f1.astype(np.float32))))",
        "non_bg_f1 = int(np.sum(np.max(f1, axis=2) > 70))",
        "print(json.dumps({'frameCount': len(frames), 'motionDiff': round(motion_diff, 3), 'nonBgPx': non_bg_f1}))",
      ].join("\n"),
      mp4Path,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) throw new Error(`Inspection failed: ${py.stderr || py.stdout}`);
  return JSON.parse(py.stdout.trim());
}

async function main() {
  const engineBin = resolveDebugEngineBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "tahap5-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-tahap5-e2e-"));

  // Intentionally omit ALL /script/aetheria-*.js tags to prove film_static_server auto-injects all 6 runtimes!
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>*{margin:0;padding:0;}html,body{width:640px;height:360px;overflow:hidden;background:#0e121c;}</style>
  </head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>
    (function () {
      if (!window.AM || !window.AetheriaStage || !window.AetheriaTracks || !window.AetheriaBehaviors || !window.AetheriaShapesText || !window.AetheriaPost) {
        throw new Error("Engine did not auto-inject all built-in runtimes!");
      }
      var W = 640, H = 360;
      window.__filmMeta = { title: "Tahap 5 Full EffectCraft Stack E2E", width: W, height: H, fps: 30, duration: 1.0, durationInFrames: 30, scenes: [{ id: "full", duration: 1.0 }] };
      var ctx = document.getElementById("film").getContext("2d");
      var stage = window.AM.createStage({ width: W, height: H });

      // Matte window revealing hero card
      stage.addLayer({
        id: "window_matte",
        matteSource: true,
        kind: "canvas2d",
        x: 320,
        y: 180,
        anchor: [0, 0],
        draw: function (c) {
          c.fillStyle = "#FFFFFF";
          window.AM.fillRoundRect(c, -280, -155, 560, 310, 24);
        }
      });

      // Hero card with spatial AE tracks + additive breathe + alpha track matte + echo trail
      stage.addLayer({
        id: "hero_card",
        kind: "canvas2d",
        width: 120,
        height: 80,
        anchor: [0.5, 0.5],
        matte: { layerId: "window_matte", mode: "alpha" },
        echo: { count: 3, echoTime: -0.03, startIntensity: 0.55, decay: 0.65, operator: "add" },
        tracks: {
          position: [
            { t: 0.0, v: [140, 220], ease: "decelerate" },
            { t: 0.5, v: [320, 120], ease: "easeInOut" },
            { t: 1.0, v: [490, 190] }
          ],
          rotationDeg: [{ t: 0, v: -12, ease: "smooth" }, { t: 1, v: 8 }]
        },
        behaviors: [{ preset: "breathe", amp: 0.08, freq: 3 }],
        draw: function (c) {
          c.fillStyle = "#38BDF8";
          window.AM.fillRoundRect(c, 0, 0, 120, 80, 14);
        }
      });

      // Lagged child emblem with morphing trimmed star + repeater
      var tri = window.AM.polystarPath({ points: 3, star: false, outerRadius: 32 });
      var star = window.AM.polystarPath({ points: 5, star: true, outerRadius: 38, innerRadius: 18 });
      stage.addLayer({
        id: "child_star",
        parentId: "hero_card",
        followLag: 0.12,
        kind: "canvas2d",
        x: 60,
        y: 40,
        anchor: [0, 0],
        draw: function (c, t) {
          var m = window.AM.morphPath(tri, star, t, { bendingResistance: 60 });
          window.AM.repeatDraw(c, { copies: 3, position: [0, 0], rotation: 30, scale: [88, 88], startOpacity: 100, endOpacity: 45 }, function (rc) {
            window.AM.drawShapePath(rc, m, { trim: { start: 0, end: 25 + t * 75 }, stroke: "#FACC15", lineWidth: 4 });
          });
        }
      });

      // Kinetic AE Text Animator layer
      stage.addLayer({
        id: "headline",
        kind: "text",
        x: 320,
        y: 295,
        anchor: [0, 0],
        text: "FULL STACK READY",
        textOpts: { preset: "bounceInWords", startSec: 0.05, durationSec: 0.7, fontSize: 38, color: "#FFFFFF" }
      });

      window.renderAt = function (t) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#0E121C";
        ctx.fillRect(0, 0, W, H);
        stage.render(ctx, t, {
          postProcess: { bloom: 0.35, directionalBlur: 3, directionalAngle: 0, dof: 3, dofFocus: [0.5, 0.5], fps: 30 }
        });
      };
      window.renderAt(0);
      window.__ready = true;
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
    const r = await fetch(`${baseUrl}/api/render-media?directory=${encodeURIComponent(tmpRoot)}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "x-aetheria-directory": tmpRoot,
      },
      body: JSON.stringify({ codec: "h264", outputName: "tahap5_full.mp4" }),
    });
    if (!r.ok) throw new Error(`render-media failed: ${await r.text()}`);
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

    const stats = inspectFullStack(path.join(tmpRoot, "output", "tahap5_full.mp4"));
    if (stats.frameCount < 30 || stats.motionDiff < 4.0 || stats.nonBgPx < 8000) {
      throw new Error(`Full-stack render failed visual checks: ${JSON.stringify(stats)}`);
    }

    // Failure path: missing project fails cleanly while /api/health stays healthy
    const badDir = path.join(tmpRoot, "missing_project");
    const badRes = await fetch(`${baseUrl}/api/render-media?directory=${encodeURIComponent(badDir)}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "x-aetheria-directory": badDir,
      },
      body: JSON.stringify({ codec: "h264", outputName: "fail.mp4" }),
    });
    if (badRes.ok) {
      const bj = await badRes.json();
      const bid = bj.renderId || bj?.data?.renderId;
      let failed = false;
      const bdl = Date.now() + 15_000;
      while (Date.now() < bdl) {
        const bpr = await fetch(`${baseUrl}/api/render-progress?renderId=${encodeURIComponent(bid)}`, {
          headers: { Authorization: authHeader },
        });
        const bpj = await bpr.json();
        const bjob = bpj?.data || bpj;
        if (bjob?.status === "error" || bjob?.status === "failed") {
          failed = true;
          break;
        }
        await new Promise((res) => setTimeout(res, 200));
      }
      if (!failed) throw new Error("Expected missing directory job to fail cleanly");
    }
    await waitForHealth(baseUrl, authHeader, 5000);
    console.log(JSON.stringify({ ok: true, autoInjectedAllRuntimes: true, stats }, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Tahap 5 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[tahap5-e2e] FAILED:", err);
  process.exit(1);
});
