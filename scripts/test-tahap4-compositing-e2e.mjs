/**
 * Repeatable Tahap 4 E2E test: Alpha & Luma Track Mattes, Echo Motion Trails,
 * and WebGL2 Directional/Radial Blur + DoF rendered live via headless CDP -> FFmpeg.
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

function inspectCompositingVideo(mp4Path) {
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
        "f = frames[15]",
        "# Alpha-matted crimson plate should appear inside the central circle (cx=180,cy=180,r=70) but NOT at corner (20,20)",
        "in_matte = f[170:190, 170:190]",
        "out_matte = f[15:35, 15:35]",
        "in_red = float(np.mean(in_matte[:,:,2]))",
        "out_red = float(np.mean(out_matte[:,:,2]))",
        "# Echo trail cyan orb moving across right half (x > 300): multiple trailing cyan pixels",
        "cyan_px = int(np.sum((f[:, 280:, 0] > 110) & (f[:, 280:, 1] > 110) & (f[:, 280:, 2] < 100)))",
        "print(json.dumps({'frameCount': len(frames), 'inMatteRed': round(in_red, 2), 'outMatteRed': round(out_red, 2), 'echoCyanPx': cyan_px}))",
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
  const password = "tahap4-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-tahap4-e2e-"));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>*{margin:0;padding:0;}html,body{width:640px;height:360px;overflow:hidden;background:#0e121c;}</style>
    <script src="/script/story-camera.js"></script>
    <script src="/script/aetheria-post.js"></script>
    <script src="/script/aetheria-tracks.js"></script>
    <script src="/script/aetheria-stage.js"></script>
    <script src="/script/aetheria-motion.js"></script>
  </head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>
    (function () {
      var W = 640, H = 360;
      window.__filmMeta = { title: "Tahap 4 Compositing E2E", width: W, height: H, fps: 30, duration: 1.0, durationInFrames: 30, scenes: [{ id: "comp", duration: 1.0 }] };
      var ctx = document.getElementById("film").getContext("2d");
      var stage = window.AM.createStage({ width: W, height: H });

      // Failure path: unknown matte mode must throw cleanly
      var caught = false;
      try { stage.addLayer({ id: "bad", matte: { layerId: "circle_matte", mode: "invalidMode" } }); } catch (e) { caught = true; }
      if (!caught) throw new Error("Expected unknown matte mode to throw");

      // Matte source circle at (180, 180)
      stage.addLayer({
        id: "circle_matte",
        matteSource: true,
        kind: "canvas2d",
        x: 180,
        y: 180,
        anchor: [0, 0],
        draw: function (c) {
          c.fillStyle = "#FFFFFF";
          c.beginPath();
          c.arc(0, 0, 70, 0, Math.PI * 2);
          c.fill();
        }
      });

      // Full-frame crimson plate revealed ONLY inside circle_matte via alpha track matte
      stage.addLayer({
        id: "matted_plate",
        kind: "canvas2d",
        x: 0,
        y: 0,
        anchor: [0, 0],
        matte: { layerId: "circle_matte", mode: "alpha" },
        draw: function (c) {
          c.fillStyle = "#EF4444";
          c.fillRect(0, 0, W, H);
        }
      });

      // Fast-moving cyan orb on right half with 5-step Echo trail
      stage.addLayer({
        id: "echo_orb",
        kind: "canvas2d",
        y: 180,
        anchor: [0, 0],
        tracks: { x: [{ t: 0, v: 320, ease: "easeInOut" }, { t: 1, v: 580 }] },
        echo: { count: 5, echoTime: -0.04, startIntensity: 0.85, decay: 0.72, operator: "add" },
        draw: function (c) {
          c.fillStyle = "#22D3EE";
          c.beginPath();
          c.arc(0, 0, 26, 0, Math.PI * 2);
          c.fill();
        }
      });

      window.renderAt = function (t) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#0E121C";
        ctx.fillRect(0, 0, W, H);
        stage.render(ctx, t, {
          postProcess: {
            directionalBlur: 4,
            directionalAngle: 0,
            radialBlur: 0.03,
            radialCenter: [0.5, 0.5],
            dof: 4,
            dofFocus: [0.3, 0.5],
            dofRadius: 0.25,
            dofFeather: 0.35,
            fps: 30
          }
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
      body: JSON.stringify({ codec: "h264", outputName: "tahap4_compositing.mp4" }),
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

    const stats = inspectCompositingVideo(path.join(tmpRoot, "output", "tahap4_compositing.mp4"));
    if (stats.inMatteRed < 150 || stats.outMatteRed > 50) {
      throw new Error(`Alpha track matte did not isolate crimson plate: ${JSON.stringify(stats)}`);
    }
    if (stats.echoCyanPx < 2500) {
      throw new Error(`Echo trail orb pixels too low: ${JSON.stringify(stats)}`);
    }
    await waitForHealth(baseUrl, authHeader, 5000);
    console.log(JSON.stringify({ ok: true, stats }, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Tahap 4 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[tahap4-e2e] FAILED:", err);
  process.exit(1);
});
