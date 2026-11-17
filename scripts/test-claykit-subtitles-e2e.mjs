#!/usr/bin/env node
/**
 * Repeatable live E2E test for ClayKit sky self-heal & AM.drawSubtitles 1-word Neobrutalism default:
 * 1. Spawns live `aetheria-engine` with isolated tempWorkspace + XDG_CONFIG_HOME + XDG_DATA_HOME.
 * 2. Renders a ClayKit 3D project whose index.html intentionally sets `#0f1115` dark stage/body background,
 *    decodes frame 0 via FFmpeg to PPM, and verifies sky top & bottom margins render pastel blue (not #0f1115 black).
 * 3. Renders a Canvas project calling `AM.drawSubtitles(ctx, words, t, "#FFDE59")` (no style/wordsPerGroup opts)
 *    with 4 sequential words and verifies frame 0 renders a compact 1-word Neobrutalism yellow chip (not a wide dark 5-word pill).
 * 4. Verifies negative path (`outputName: "../escape.mp4"`) rejects with HTTP 400 cleanly and engine remains healthy.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

function findAvailablePort(preferred = 4890) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => {
      const srv2 = net.createServer();
      srv2.unref();
      srv2.listen(0, "127.0.0.1", () => {
        const { port } = srv2.address();
        srv2.close(() => resolve(port));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function api(baseUrl, urlPath, { method = "GET", body, authHeader, timeoutMs = 30_000 } = {}) {
  const target = new URL(urlPath, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  const headers = { Authorization: authHeader, Connection: "close" };
  if (payload !== null) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent: NO_KEEPALIVE_AGENT,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // ignore
          }
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, text, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function locateFfmpeg() {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of pathDirs) {
    const cand = path.join(d, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(cand)) return cand;
  }
  if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA || "";
    const npxRoot = path.join(localApp, "npm-cache", "_npx");
    if (fs.existsSync(npxRoot)) {
      for (const ent of fs.readdirSync(npxRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const cand = path.join(npxRoot, ent.name, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
        if (fs.existsSync(cand)) return cand;
      }
    }
    const ccRoot = path.join(localApp, "CapCut", "Apps");
    if (fs.existsSync(ccRoot)) {
      for (const ent of fs.readdirSync(ccRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const cand = path.join(ccRoot, ent.name, "ffmpeg.exe");
        if (fs.existsSync(cand)) return cand;
      }
    }
  }
  throw new Error("ffmpeg binary not found");
}

function decodeFirstFrameRgb(ffmpegBin, mp4Path, rgbPath) {
  execFileSync(
    ffmpegBin,
    ["-y", "-i", mp4Path, "-frames:v", "1", "-f", "image2", "-vcodec", "rawvideo", "-pix_fmt", "rgb24", rgbPath],
    { stdio: "pipe", windowsHide: true }
  );
  const pixels = fs.readFileSync(rgbPath);
  const width = 1080;
  return {
    getPixel(x, y) {
      const off = (y * width + x) * 3;
      return [pixels[off], pixels[off + 1], pixels[off + 2]];
    },
  };
}

async function renderRangeMp4(baseUrl, authHeader, dirQuery, tempWorkspace, outputName, inFrame = 0, outFrame = 1) {
  const startRes = await api(baseUrl, `/api/render-media?${dirQuery}`, {
    method: "POST",
    authHeader,
    body: {
      compositionId: "HtmlMotionFilm",
      codec: "h264",
      outputName,
      inFrame,
      outFrame,
    },
  });
  const renderId = startRes.json?.renderId || startRes.json?.data?.renderId;
  if (!startRes.ok || !renderId) {
    throw new Error(`render-media start failed: ${startRes.status} ${startRes.text}`);
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const prog = await api(baseUrl, `/api/render-progress?renderId=${encodeURIComponent(renderId)}&${dirQuery}`, {
      authHeader,
    });
    const d = prog.json?.data ?? prog.json;
    if (d?.status === "done") {
      return d.outputPath || path.join(tempWorkspace, "output", outputName);
    }
    if (d?.status === "error") {
      throw new Error(`render failed: ${d.error}`);
    }
  }
  throw new Error("render timed out");
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const engineBin = path.join(REPO_ROOT, "target", "debug", exe);
  assert(fs.existsSync(engineBin), `Missing dev engine binary at ${engineBin}`);
  const ffmpegBin = locateFfmpeg();

  const port = await findAvailablePort(4890);
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");
  const baseUrl = `http://127.0.0.1:${port}`;

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-clay-e2e-ws-"));
  const xdgConfig = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-clay-e2e-cfg-"));
  const xdgData = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-clay-e2e-data-"));
  const dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
  const logs = [];

  const engine = spawn(engineBin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: tempWorkspace,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_WORKSPACE: tempWorkspace,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_DATA_HOME: xdgData,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  engine.stdout.on("data", (d) => logs.push(d.toString()));
  engine.stderr.on("data", (d) => logs.push(d.toString()));

  try {
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const r = await api(baseUrl, "/api/health", { authHeader });
        if (r.ok && (r.json?.data?.healthy ?? r.json?.healthy)) {
          healthy = true;
          break;
        }
      } catch {
        // retry
      }
    }
    assert(healthy, `Engine health failed:\n${logs.join("")}`);

    // Scenario 1: ClayKit project with intentionally dark #0f1115 stage/body CSS must self-heal to pastel sky
    const clayProjDir = path.join(tempWorkspace, "projects", "clay-dark-repro");
    fs.mkdirSync(path.join(clayProjDir, "script"), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspace, ".aetheria"), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, ".aetheria", "active-project.json"), JSON.stringify({ id: "clay-dark-repro" }));

    fs.copyFileSync(
      path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-kit.js"),
      path.join(clayProjDir, "script", "clay-kit.js")
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "scene1.js"),
      path.join(clayProjDir, "script", "scene1.js")
    );
    const brokenHtml = fs
      .readFileSync(
        path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "index.html"),
        "utf8"
      )
      .replace("background: #93C5FD;", "background: #0f1115;")
      .replace("background: linear-gradient(180deg, #93C5FD 0%, #BAE6FD 48%, #E0F2FE 100%);", "background: #0f1115;");
    fs.writeFileSync(path.join(clayProjDir, "index.html"), brokenHtml, "utf8");

    const clayMp4 = await renderRangeMp4(baseUrl, authHeader, dirQuery, tempWorkspace, "clay-check.mp4", 0, 1);
    const clayImg = decodeFirstFrameRgb(ffmpegBin, clayMp4, path.join(tempWorkspace, "clay0.rgb"));
    const topPx = clayImg.getPixel(540, 80);
    const botPx = clayImg.getPixel(540, 1890);
    console.log("[E2E] ClayKit top sky RGB:", topPx, "| bottom RGB:", botPx);
    assert(topPx[2] > 230 && topPx[0] > 120, `Expected pastel blue sky at (540,80), got ${JSON.stringify(topPx)}`);
    assert(botPx[2] > 235 && botPx[1] > 220, `Expected pastel blue bottom at (540,1890), got ${JSON.stringify(botPx)}`);

    // Scenario 2: Default AM.drawSubtitles(ctx, words, t, "#FFDE59") must render 1-word Neobrutalism chip
    const subProjDir = path.join(tempWorkspace, "projects", "sub-default-test");
    fs.mkdirSync(path.join(subProjDir, "script"), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, ".aetheria", "active-project.json"), JSON.stringify({ id: "sub-default-test" }));
    fs.writeFileSync(
      path.join(subProjDir, "index.html"),
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><script src="/script/aetheria-motion.js"></script></head><body style="margin:0;background:#ffffff;"><canvas id="film" width="1080" height="1920"></canvas><script>
      var c = document.getElementById("film"), ctx = c.getContext("2d");
      var words = [
        { word: "SATU", start: 0.0, end: 0.4 },
        { word: "DUA", start: 0.4, end: 0.8 },
        { word: "TIGA", start: 0.8, end: 1.2 },
        { word: "EMPAT", start: 1.2, end: 1.6 }
      ];
      window.__filmMeta = { title: "Sub Test", width: 1080, height: 1920, fps: 30, duration: 1.6, durationInFrames: 48, scenes: [{ id: "s1", start: 0, duration: 1.6 }] };
      window.renderAt = function(t) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, 1080, 1920);
        window.AM.drawSubtitles(ctx, words, 0.2, "#FFDE59");
      };
      window.renderAt(0);
      window.__ready = true;
      </script></body></html>`,
      "utf8"
    );
    const subMp4 = await renderRangeMp4(baseUrl, authHeader, dirQuery, tempWorkspace, "sub-check.mp4", 0, 1);
    const subImg = decodeFirstFrameRgb(ffmpegBin, subMp4, path.join(tempWorkspace, "sub0.rgb"));
    // Scan horizontal chip span at y=1550 (above/around word center) vs outer margin x=120 & x=960
    let nonWhiteWidth = 0;
    for (let x = 0; x < 1080; x++) {
      const [r, g, b] = subImg.getPixel(x, 1545);
      if (r < 245 || g < 245 || b < 245) nonWhiteWidth++;
    }
    const leftEdgePx = subImg.getPixel(180, 1580);
    const chipBgPx = subImg.getPixel(540, 1542);
    console.log("[E2E] Subtitle chip width@1545:", nonWhiteWidth, "px | center-top RGB:", chipBgPx, "| leftEdge(180,1580):", leftEdgePx);
    assert(nonWhiteWidth > 120 && nonWhiteWidth < 460, `Expected compact 1-word chip (<460px wide), got ${nonWhiteWidth}px`);
    assert(chipBgPx[0] > 230 && chipBgPx[1] > 200 && chipBgPx[2] < 130, `Expected Neobrutalism yellow fill at (540,1542), got ${JSON.stringify(chipBgPx)}`);
    assert(leftEdgePx[0] > 245 && leftEdgePx[1] > 245 && leftEdgePx[2] > 245, `Expected white margin at x=180 (not wide dark 4-word pill), got ${JSON.stringify(leftEdgePx)}`);

    // Scenario 3: Negative path traversal test on /api/render-media must reject cleanly without crashing engine
    const negRes = await api(baseUrl, `/api/render-media?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { compositionId: "HtmlMotionFilm", codec: "h264", outputName: "../escape.mp4" },
    });
    assert(negRes.status === 400 && negRes.json?.success === false, `Expected HTTP 400 on escape outputName, got ${negRes.status} ${negRes.text}`);
    const healthAfter = await api(baseUrl, "/api/health", { authHeader });
    assert(healthAfter.ok && (healthAfter.json?.data?.healthy ?? healthAfter.json?.healthy), "Engine unhealthy after negative test");

    console.log("[CLAYKIT_SUBTITLES_E2E] PASSED", JSON.stringify({ topPx, botPx, nonWhiteWidth, chipBgPx, negStatus: negRes.status }));
  } finally {
    try {
      if (process.platform === "win32" && engine.pid) {
        execSync(`taskkill /F /T /PID ${engine.pid}`, { stdio: "ignore", windowsHide: true });
      } else {
        engine.kill("SIGKILL");
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(xdgConfig, { recursive: true, force: true });
    fs.rmSync(xdgData, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[CLAYKIT_SUBTITLES_E2E_FAILED]", err);
  process.exit(1);
});
