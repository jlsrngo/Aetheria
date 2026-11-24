#!/usr/bin/env node
/**
 * Repeatable Phase 2 E2E test: Modular WebGL2 Post-Processing (`/script/aetheria-post.js`)
 * + Determinism + Safe 2D Fallback + Export Verification.
 *
 * Against a live debug `aetheria-engine`:
 * 1. Renders baseline (no post-processing) and WebGL2 post-processed (`bloom`, `vignette`,
 *    `grain`, `contrast`, `chromatic`) MP4s via `POST /api/render-media`.
 * 2. Verifies WebGL2 actually activated (`window.AetheriaPost.getSharedStats().backend === "webgl2"`),
 *    bloom adds measurable halo energy around bright core, and vignette darkens outer corners.
 * 3. Verifies determinism: rendering the exact WebGL2 project a second time yields identical frame SSIM/MAE.
 * 4. Failure/fallback path: `forceFallback2D: true` renders cleanly with 0 runtime errors and visible effect.
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
      if (r.ok && (await r.json())?.healthy === true) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`Timed out waiting for engine health at ${baseUrl}/api/health`);
}

function writeTestProject(dir, postOpts, requireWebGL) {
  fs.mkdirSync(dir, { recursive: true });
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>html,body{margin:0;padding:0;background:#0b0e14;overflow:hidden;}canvas{display:block;}</style>
    <script src="/script/aetheria-post.js"></script>
    <script src="/script/aetheria-motion.js"></script>
  </head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>
    (function () {
      var W = 640, H = 360;
      var POST_OPTS = ${JSON.stringify(postOpts)};
      var REQUIRE_WEBGL = ${requireWebGL ? "true" : "false"};
      window.__filmMeta = { title: "Phase 2 Post E2E", width: W, height: H, fps: 30, duration: 0.6, durationInFrames: 18, scenes: [{ id: "s1", duration: 0.6 }] };
      var ctx = document.getElementById("film").getContext("2d");
      window.renderAt = function (t) {
        ctx.setTransform(1,0,0,1,0,0);
        // Uniform mid-bright slate backdrop so vignette darkening on corners is clearly measurable
        ctx.fillStyle = "#3A465C";
        ctx.fillRect(0, 0, W, H);
        // Bright neon orb moving right -> strong bloom halo around it
        var cx = 220 + (t / 0.6) * 200;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(cx, 180, 44, 0, Math.PI * 2);
        ctx.fill();
        if (POST_OPTS) {
          window.AM.postProcess(ctx, t, POST_OPTS);
          var st = window.AetheriaPost.getSharedStats();
          if (REQUIRE_WEBGL && st.backend !== "webgl2") {
            throw new Error("Expected webgl2 backend, got " + st.backend);
          }
        }
      };
      window.renderAt(0);
      window.__ready = true;
    })();
    </script>
  </body></html>`;
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
}

async function renderProject(baseUrl, authHeader, dir, outputName) {
  const r = await fetch(`${baseUrl}/api/render-media?directory=${encodeURIComponent(dir)}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "x-aetheria-directory": dir,
    },
    body: JSON.stringify({ codec: "h264", outputName }),
  });
  if (!r.ok) throw new Error(`render-media failed (${r.status}): ${await r.text()}`);
  const j = await r.json();
  const renderId = j.renderId || j?.data?.renderId;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const pr = await fetch(`${baseUrl}/api/render-progress?renderId=${encodeURIComponent(renderId)}`, {
      headers: { Authorization: authHeader },
    });
    const pj = await pr.json();
    const job = pj?.data || pj;
    if (job?.status === "done" || job?.status === "completed") {
      return path.join(dir, "output", outputName);
    }
    if (job?.status === "error" || job?.status === "failed") {
      throw new Error(`Render failed (${outputName}): ${JSON.stringify(job)}`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`Render timed out (${outputName})`);
}

function compareVideos(rawMp4, postMp4A, postMp4B, fallbackMp4) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, json, cv2, numpy as np",
        "def grab_mid(p):",
        "    cap = cv2.VideoCapture(p)",
        "    frames = []",
        "    while True:",
        "        ok, f = cap.read()",
        "        if not ok: break",
        "        frames.append(f)",
        "    cap.release()",
        "    return frames[len(frames)//2], len(frames)",
        "raw, n_raw = grab_mid(sys.argv[1])",
        "pa, n_a = grab_mid(sys.argv[2])",
        "pb, n_b = grab_mid(sys.argv[3])",
        "fb, n_fb = grab_mid(sys.argv[4])",
        "corner_raw = float(np.mean(raw[:40, :40]))",
        "corner_post = float(np.mean(pa[:40, :40]))",
        "corner_fb = float(np.mean(fb[:40, :40]))",
        "# Ring around orb center (320, 180) at radius 56..88 checks bloom halo brightening",
        "yy, xx = np.ogrid[:360, :640]",
        "dist = np.sqrt((xx - 320)**2 + (yy - 180)**2)",
        "ring = (dist >= 54) & (dist <= 86)",
        "halo_raw = float(np.mean(raw[ring]))",
        "halo_post = float(np.mean(pa[ring]))",
        "det_mae = float(np.mean(np.abs(pa.astype(np.float32) - pb.astype(np.float32))))",
        "print(json.dumps({",
        "  'frames': [n_raw, n_a, n_b, n_fb],",
        "  'cornerRaw': round(corner_raw, 2),",
        "  'cornerPost': round(corner_post, 2),",
        "  'cornerFallback': round(corner_fb, 2),",
        "  'haloRaw': round(halo_raw, 2),",
        "  'haloPost': round(halo_post, 2),",
        "  'determinismMae': round(det_mae, 4)",
        "}))",
      ].join("\n"),
      rawMp4,
      postMp4A,
      postMp4B,
      fallbackMp4,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) {
    throw new Error(`Python comparison failed: ${py.stderr || py.stdout}`);
  }
  return JSON.parse(py.stdout.trim());
}

async function main() {
  const engineBin = resolveDebugEngineBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "phase2-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-phase2-e2e-"));
  const rawDir = path.join(tmpRoot, "raw");
  const postDir = path.join(tmpRoot, "post_webgl2");
  const fallbackDir = path.join(tmpRoot, "post_fallback2d");

  const fxOpts = {
    bloom: 0.95,
    bloomThreshold: 0.65,
    bloomRadius: 2.4,
    chromatic: 0.006,
    contrast: 1.08,
    vignette: 0.65,
    grain: 0.035,
    tonemap: true,
    fps: 30,
  };
  writeTestProject(rawDir, null, false);
  writeTestProject(postDir, fxOpts, true);
  writeTestProject(fallbackDir, { ...fxOpts, forceFallback2D: true }, false);

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
    const rawMp4 = await renderProject(baseUrl, authHeader, rawDir, "raw.mp4");
    const postMp4A = await renderProject(baseUrl, authHeader, postDir, "post_a.mp4");
    const postMp4B = await renderProject(baseUrl, authHeader, postDir, "post_b.mp4");
    const fallbackMp4 = await renderProject(baseUrl, authHeader, fallbackDir, "fallback.mp4");

    const metrics = compareVideos(rawMp4, postMp4A, postMp4B, fallbackMp4);
    if (!(metrics.cornerPost < metrics.cornerRaw - 12)) {
      throw new Error(`Expected WebGL2 vignette to darken corners significantly: ${JSON.stringify(metrics)}`);
    }
    if (!(metrics.haloPost > metrics.haloRaw + 6)) {
      throw new Error(`Expected WebGL2 bloom to brighten halo ring around bright orb: ${JSON.stringify(metrics)}`);
    }
    if (metrics.determinismMae > 0.01) {
      throw new Error(`Expected bit-deterministic WebGL2 post-processing (MAE <= 0.01): ${JSON.stringify(metrics)}`);
    }
    if (!(metrics.cornerFallback < metrics.cornerRaw - 8)) {
      throw new Error(`Expected Canvas 2D fallback vignette to work cleanly: ${JSON.stringify(metrics)}`);
    }

    console.log(JSON.stringify({ ok: true, webgl2Verified: true, metrics }, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (engineStderr.includes("panicked at")) {
      throw new Error(`Engine panicked during Phase 2 E2E:\n${engineStderr}`);
    }
  }
}

main().catch((err) => {
  console.error("[phase2-e2e] FAILED:", err);
  process.exit(1);
});
