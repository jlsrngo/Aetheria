/**
 * Repeatable Tahap 2 E2E test: Additive Behaviors (`aetheria-behaviors.js`),
 * `AM.loopTrack`, `AM.wiggle`, and Secondary Motion `followLag` via live engine -> CDP -> FFmpeg.
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

function inspectLagAndBehavior(mp4Path) {
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
        "f = frames[15]", // t = 0.5s
        "# Parent box is bright red (#F43F5E -> high R, low G)",
        "py_r, px_r = np.where((f[:,:,2] > 200) & (f[:,:,1] < 100))",
        "# Lagged child box is bright cyan (#22D3EE -> high B & G, low R)",
        "cy_c, cx_c = np.where((f[:,:,0] > 190) & (f[:,:,1] > 170) & (f[:,:,2] < 100))",
        "assert len(px_r) > 400 and len(cx_c) > 250, f'missing boxes: parent={len(px_r)} child={len(cx_c)}'",
        "print(json.dumps({",
        "  'frameCount': len(frames),",
        "  'parentCenter': [float(np.mean(px_r)), float(np.mean(py_r))],",
        "  'childCenter': [float(np.mean(cx_c)), float(np.mean(cy_c))]",
        "}))",
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
  const password = "tahap2-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-tahap2-e2e-"));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>*{margin:0;padding:0;}html,body{width:640px;height:360px;overflow:hidden;background:#0e121c;}</style>
    <script src="/script/story-camera.js"></script>
    <script src="/script/aetheria-tracks.js"></script>
    <script src="/script/aetheria-behaviors.js"></script>
    <script src="/script/aetheria-stage.js"></script>
    <script src="/script/aetheria-motion.js"></script>
  </head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>
    (function () {
      var W = 640, H = 360;
      window.__filmMeta = { title: "Tahap 2 Behaviors E2E", width: W, height: H, fps: 30, duration: 1.0, durationInFrames: 30, scenes: [{ id: "beh", duration: 1.0 }] };
      var ctx = document.getElementById("film").getContext("2d");
      var stage = window.AM.createStage({ width: W, height: H });

      // Failure path: unknown behavior preset must throw cleanly
      var caught = false;
      try { stage.addLayer({ id: "bad", behaviors: ["invalidPresetName"] }); } catch (e) { caught = true; }
      if (!caught) throw new Error("Expected unknown behavior preset to throw");

      // Parent moves x: 120 -> 480 linearly over 1s + floats vertically by +30*sin(t*PI)
      stage.addLayer({
        id: "parent_box",
        kind: "canvas2d",
        y: 120,
        width: 64,
        height: 64,
        anchor: [0.5, 0.5],
        tracks: { x: [{ t: 0, v: 120 }, { t: 1, v: 480 }] },
        behaviors: [{ preset: "floatUpDown", amp: 30, freq: Math.PI }],
        draw: function (c) { c.fillStyle = "#F43F5E"; c.fillRect(0, 0, 64, 64); }
      });

      // Child sits +120px below parent, lagged by 0.2s (so at t=0.5s child X trails parent by 0.2*360 = 72px!)
      stage.addLayer({
        id: "child_box",
        parentId: "parent_box",
        followLag: 0.2,
        kind: "canvas2d",
        x: 32,
        y: 152,
        width: 48,
        height: 48,
        anchor: [0.5, 0.5],
        draw: function (c) { c.fillStyle = "#22D3EE"; c.fillRect(0, 0, 48, 48); }
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
      body: JSON.stringify({ codec: "h264", outputName: "tahap2_behaviors.mp4" }),
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

    const stats = inspectLagAndBehavior(path.join(tmpRoot, "output", "tahap2_behaviors.mp4"));
    // At t = 0.5s: parent X = 300, Y = 120 + 30*sin(0.5*PI) = 150
    // Child lagged 0.2s (parent at t = 0.3s): X = 120 + 0.3*360 = 228, Y = 120 + 30*sin(0.3*PI) + 120 = 264.27
    const parentErr = Math.hypot(stats.parentCenter[0] - 300, stats.parentCenter[1] - 150);
    const childErr = Math.hypot(stats.childCenter[0] - 228, stats.childCenter[1] - (120 + 30 * Math.sin(0.3 * Math.PI) + 120));
    if (parentErr > 6 || childErr > 6) {
      throw new Error(`Behavior/lag mismatch: ${JSON.stringify({ stats, parentErr, childErr })}`);
    }

    await waitForHealth(baseUrl, authHeader, 5000);
    console.log(JSON.stringify({ ok: true, stats, parentErr: Number(parentErr.toFixed(2)), childErr: Number(childErr.toFixed(2)) }, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Tahap 2 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[tahap2-e2e] FAILED:", err);
  process.exit(1);
});
