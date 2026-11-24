/**
 * Repeatable Tahap 1 E2E test: After Effects Keyframe Tracks (`aetheria-tracks.js`)
 * + `AetheriaStage` `layer.tracks` integration via live engine HTTP -> headless CDP -> FFmpeg.
 *
 * Verifies:
 *   1. Colored box driven by 3-key spatial `position` (`decelerate`) + `scale` tracks renders deterministically.
 *   2. Sampled frame centroids in the rendered MP4 match `AetheriaTracks.evaluateTrack` within <= 6 px.
 *   3. Failure paths: unknown track name throws cleanly in stage; invalid render directory returns error cleanly
 *      without crashing engine and `/api/health` remains healthy.
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

function loadTracksInNode() {
  const code = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-tracks.js"),
    "utf8",
  );
  const win = {};
  new Function("window", code)(win);
  return win.AetheriaTracks;
}

function measureCentroids(mp4Path, frameIndices) {
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
        "indices = json.loads(sys.argv[2])",
        "out = []",
        "for idx in indices:",
        "    assert idx < len(frames), f'missing frame {idx} of {len(frames)}'",
        "    f = frames[idx]",
        "    # BGR bright green box (#32E875)",
        "    mask = (f[:,:,1] > 180) & (f[:,:,0] < 150) & (f[:,:,2] < 120)",
        "    ys, xs = np.where(mask)",
        "    assert len(xs) > 400, f'box missing at frame {idx}: {len(xs)} px'",
        "    out.append({'frame': idx, 'cx': float(np.mean(xs)), 'cy': float(np.mean(ys)), 'px': int(len(xs))})",
        "print(json.dumps({'frameCount': len(frames), 'samples': out}))",
      ].join("\n"),
      mp4Path,
      JSON.stringify(frameIndices),
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
  const password = "tahap1-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const posTrack = [
    { t: 0.0, v: [120, 280], ease: "decelerate" },
    { t: 0.45, v: [340, 80], ease: "decelerate" },
    { t: 0.9, v: [520, 240] },
  ];
  const scaleTrack = [
    { t: 0.0, v: [0.85, 0.85], ease: "decelerate" },
    { t: 0.9, v: [1.3, 1.3] },
  ];

  const tracksApi = loadTracksInNode();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-tahap1-e2e-"));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>*{margin:0;padding:0;}html,body{width:640px;height:360px;overflow:hidden;background:#0e121c;}</style>
    <script src="/script/story-camera.js"></script>
    <script src="/script/aetheria-tracks.js"></script>
    <script src="/script/aetheria-stage.js"></script>
    <script src="/script/aetheria-motion.js"></script>
  </head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>
    (function () {
      var W = 640, H = 360;
      window.__filmMeta = { title: "Tahap 1 AE Tracks E2E", width: W, height: H, fps: 30, duration: 1.0, durationInFrames: 30, scenes: [{ id: "tracks", duration: 1.0 }] };
      var ctx = document.getElementById("film").getContext("2d");
      var stage = window.AM.createStage({ width: W, height: H });

      // Failure path check: unknown track name must throw cleanly without crashing stage
      var badCaught = false;
      try {
        stage.addLayer({ id: "bad_layer", tracks: { unknownTrackProp: [{ t: 0, v: 1 }] } });
      } catch (err) {
        if (String(err && err.message || err).indexOf("unknown track") !== -1) {
          badCaught = true;
        }
      }
      if (!badCaught) throw new Error("Stage did not reject unknown track name");

      stage.addLayer({
        id: "tracked_box",
        kind: "canvas2d",
        width: 72,
        height: 72,
        anchor: [0.5, 0.5],
        tracks: {
          position: ${JSON.stringify(posTrack)},
          scale: ${JSON.stringify(scaleTrack)}
        },
        draw: function (c) {
          c.fillStyle = "#32E875";
          c.fillRect(0, 0, 72, 72);
        }
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
      body: JSON.stringify({ codec: "h264", outputName: "tahap1_tracks.mp4" }),
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

    const sampleFrames = [0, 5, 10, 15, 22, 27];
    const mp4 = path.join(tmpRoot, "output", "tahap1_tracks.mp4");
    const stats = measureCentroids(mp4, sampleFrames);

    const comparisons = stats.samples.map((s) => {
      const t = s.frame / 30;
      const expected = tracksApi.evaluateTrack(posTrack, t, { spatial: true });
      const errPx = Math.hypot(s.cx - expected[0], s.cy - expected[1]);
      if (errPx > 6.0) {
        throw new Error(
          `Frame ${s.frame} (t=${t.toFixed(3)}s) centroid mismatch: got (${s.cx.toFixed(2)}, ${s.cy.toFixed(2)}), expected (${expected[0].toFixed(2)}, ${expected[1].toFixed(2)}), err=${errPx.toFixed(2)}px`,
        );
      }
      return {
        frame: s.frame,
        t: Number(t.toFixed(3)),
        observed: [Number(s.cx.toFixed(2)), Number(s.cy.toFixed(2))],
        expected: [Number(expected[0].toFixed(2)), Number(expected[1].toFixed(2))],
        errPx: Number(errPx.toFixed(2)),
        px: s.px,
      };
    });

    // Live API failure path check: non-existent directory must fail cleanly without crashing engine
    const badDir = path.join(tmpRoot, "does-not-exist");
    const badRes = await fetch(`${baseUrl}/api/render-media?directory=${encodeURIComponent(badDir)}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "x-aetheria-directory": badDir,
      },
      body: JSON.stringify({ codec: "h264", outputName: "should_fail.mp4" }),
    });
    let liveFailureMsg = "";
    if (!badRes.ok) {
      liveFailureMsg = await badRes.text();
    } else {
      const bj = await badRes.json();
      const badRenderId = bj.renderId || bj?.data?.renderId;
      if (!badRenderId) {
        throw new Error(`Expected missing directory render to return error or renderId, got: ${JSON.stringify(bj)}`);
      }
      const badDeadline = Date.now() + 15_000;
      let badFailed = false;
      while (Date.now() < badDeadline) {
        const bpr = await fetch(`${baseUrl}/api/render-progress?renderId=${encodeURIComponent(badRenderId)}`, {
          headers: { Authorization: authHeader },
        });
        const bpj = await bpr.json();
        const bjob = bpj?.data || bpj;
        if (bjob?.status === "error" || bjob?.status === "failed") {
          liveFailureMsg = String(bjob.error || bjob.message || JSON.stringify(bjob));
          badFailed = true;
          break;
        }
        if (bjob?.status === "done" || bjob?.status === "completed") {
          throw new Error(`Expected missing directory render job to fail, but it completed: ${JSON.stringify(bjob)}`);
        }
        await new Promise((res) => setTimeout(res, 200));
      }
      if (!badFailed) {
        throw new Error("Timed out waiting for missing directory render job to fail cleanly");
      }
    }
    if (!liveFailureMsg.trim()) {
      throw new Error("Expected non-empty failure diagnostic for missing directory render");
    }
    await waitForHealth(baseUrl, authHeader, 5000);

    console.log(
      JSON.stringify(
        {
          ok: true,
          frameCount: stats.frameCount,
          comparisons,
          failurePathHealthy: true,
          liveFailureMsg,
        },
        null,
        2,
      ),
    );
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Tahap 1 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[tahap1-e2e] FAILED:", err);
  process.exit(1);
});
