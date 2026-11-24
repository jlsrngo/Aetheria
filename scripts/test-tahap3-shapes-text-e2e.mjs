/**
 * Repeatable Tahap 3 E2E test: AE Text Animators (`bounceInWords`) + Exact Arc-Length
 * `Trim Paths` + `Repeater` + `Procrustes morphPath` rendered live via CDP -> FFmpeg.
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

function inspectVideo(mp4Path) {
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
        "# Yellow/gold trimmed & repeated shape pixels (high R & G, low B)",
        "gold0 = int(np.sum((f0[:,:,2] > 180) & (f0[:,:,1] > 150) & (f0[:,:,0] < 90)))",
        "gold1 = int(np.sum((f1[:,:,2] > 180) & (f1[:,:,1] > 150) & (f1[:,:,0] < 90)))",
        "# Bright white animated text pixels in lower half",
        "white0 = int(np.sum((f0[200:,:,0] > 200) & (f0[200:,:,1] > 200) & (f0[200:,:,2] > 200)))",
        "white1 = int(np.sum((f1[200:,:,0] > 200) & (f1[200:,:,1] > 200) & (f1[200:,:,2] > 200)))",
        "diff = float(np.mean(np.abs(f0.astype(np.float32) - f1.astype(np.float32))))",
        "print(json.dumps({'frameCount': len(frames), 'goldPx': [gold0, gold1], 'whiteTextPx': [white0, white1], 'diff': round(diff, 3)}))",
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
  const password = "tahap3-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-tahap3-e2e-"));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>*{margin:0;padding:0;}html,body{width:640px;height:360px;overflow:hidden;background:#0e121c;}</style>
    <script src="/script/story-camera.js"></script>
    <script src="/script/aetheria-tracks.js"></script>
    <script src="/script/aetheria-behaviors.js"></script>
    <script src="/script/aetheria-shapes-text.js"></script>
    <script src="/script/aetheria-stage.js"></script>
    <script src="/script/aetheria-motion.js"></script>
  </head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>
    (function () {
      var W = 640, H = 360;
      window.__filmMeta = { title: "Tahap 3 Shapes & Text E2E", width: W, height: H, fps: 30, duration: 1.0, durationInFrames: 30, scenes: [{ id: "st", duration: 1.0 }] };
      var ctx = document.getElementById("film").getContext("2d");
      var stage = window.AM.createStage({ width: W, height: H });

      // Failure path: invalid text preset throws cleanly
      var caught = false;
      try { window.AM.drawAnimatedText(ctx, "FAIL", 0, 0, 0, { preset: "badTextPreset" }); } catch (e) { caught = true; }
      if (!caught) throw new Error("Expected invalid text preset to throw");

      var tri = window.AM.polystarPath({ points: 3, star: false, outerRadius: 56 });
      var star = window.AM.polystarPath({ points: 5, star: true, outerRadius: 68, innerRadius: 32 });

      stage.addLayer({
        id: "morph_repeater",
        kind: "canvas2d",
        x: 320,
        y: 120,
        anchor: [0, 0],
        draw: function (c, t) {
          var morphed = window.AM.morphPath(tri, star, t, { bendingResistance: 65 });
          window.AM.repeatDraw(c, { copies: 4, position: [0, 0], rotation: 22, scale: [88, 88], startOpacity: 100, endOpacity: 40 }, function (rc) {
            window.AM.drawShapePath(rc, morphed, {
              roundCorners: 8,
              trim: { start: 0, end: 15 + t * 85, offset: t * 90 },
              stroke: "#FACC15",
              lineWidth: 6
            });
          });
        }
      });

      stage.addLayer({
        id: "kinetic_title",
        kind: "text",
        x: 320,
        y: 270,
        anchor: [0, 0],
        text: "AETHERIA MOTION",
        textOpts: { preset: "bounceInWords", startSec: 0.05, durationSec: 0.75, fontSize: 44, color: "#FFFFFF" }
      });

      window.renderAt = function (t) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#0E121C";
        ctx.fillRect(0, 0, W, H);
        stage.render(ctx, t);
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
      body: JSON.stringify({ codec: "h264", outputName: "tahap3_shapes_text.mp4" }),
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

    const stats = inspectVideo(path.join(tmpRoot, "output", "tahap3_shapes_text.mp4"));
    if (stats.goldPx[1] <= stats.goldPx[0] || stats.goldPx[1] < 1500) {
      throw new Error(`Trim/Repeater shape did not grow visibly: ${JSON.stringify(stats)}`);
    }
    if (stats.whiteTextPx[1] <= stats.whiteTextPx[0] || stats.whiteTextPx[1] < 1200) {
      throw new Error(`Animated text did not reveal visibly: ${JSON.stringify(stats)}`);
    }
    await waitForHealth(baseUrl, authHeader, 5000);
    console.log(JSON.stringify({ ok: true, stats }, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Tahap 3 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[tahap3-e2e] FAILED:", err);
  process.exit(1);
});
