#!/usr/bin/env node
/**
 * Live-engine E2E test for Prompt 7 reference extractor accuracy (R1-R5):
 *   - Frame-accurate hard cuts (`cuts[].evidence == "hard"`, <= 1 frame error)
 *   - Global cameraMotion extraction & `AM.applyCamera` skeleton generation + moving-object control guard
 *   - Adaptive 6-panel beat strip (`beatStripPanels`, `scene-start` <= 0.15s, `scene-end`, camera peak)
 *   - Tile-wall `cleanPlate` (`kind: "tile-wall"`, true dark gap within <= 12/channel of #0C0B0E)
 *   - Honest BPM fallback (`bpmSource: "fallback"` -> "BPM tak terukur")
 *   - Failure path: corrupt/unreadable MP4 returns clean error without crashing engine
 *
 * Uses only generated synthetic clips in a temporary workspace (never touches `workspace/` or `benchmarks/`).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

async function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${urlPath}`);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Connection: "close" };
    if (authHeader) headers.Authorization = authHeader;
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload, "utf8");
    }
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
          } catch {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function generateSyntheticE2EClip(destMp4) {
  const refDir = path.join(REPO_ROOT, "core", "ref_extractor").replace(/\\/g, "/");
  const outMp4 = destMp4.replace(/\\/g, "/");
  const py = `
import sys
from pathlib import Path
sys.path.insert(0, r"${refDir}")
import synth_reference

spec = {
    "name": "p7_live_e2e",
    "width": 1024,
    "height": 576,
    "fps": 30.0,
    "hasAudio": False,
    "scenes": [
        {
            "id": "e2e_cam_zoom",
            "kind": "textured",
            "seed": 501,
            "durationSec": 2.0,
            "bgBgr": (20, 22, 28),
            "camera": {
                "t0": 0.35,
                "t1": 1.85,
                "scaleFrom": 1.0,
                "scaleTo": 1.65,
                "rotDegFrom": 0.0,
                "rotDegTo": 2.2,
                "txFrom": 0.0,
                "txTo": 14.0,
                "tyFrom": 0.0,
                "tyTo": -10.0,
                "ease": "inCubic",
            },
        },
        {
            "id": "e2e_dark_tile_wall",
            "kind": "tile-wall",
            "durationSec": 2.0,
            "transitionFromPrev": "hard",
            "bgBgr": (14, 11, 12),
            "lightTileBgr": (236, 238, 240),
            "darkTileBgr": (30, 28, 26),
            "tiltDeg": -2.8,
            "revealIntro": False,
            "camera": {
                "t0": 1.45,
                "t1": 1.95,
                "scaleFrom": 1.0,
                "scaleTo": 1.48,
                "rotDegFrom": 0.0,
                "rotDegTo": 1.8,
                "txFrom": 0.0,
                "txTo": 0.0,
                "tyFrom": 0.0,
                "tyTo": 0.0,
                "ease": "inCubic",
            },
        },
        {
            "id": "e2e_moving_obj_ctrl",
            "kind": "moving-object-static-bg",
            "seed": 503,
            "durationSec": 1.6,
            "transitionFromPrev": "hard",
            "bgBgr": (228, 226, 222),
        },
    ],
}
synth_reference.generate_synthetic_clip(spec, Path(r"${outMp4}"))
`;
  execFileSync("python", ["-c", py], { stdio: "pipe" });
}

function hexToRgb(hex) {
  const s = String(hex || "").replace(/^#/, "");
  if (s.length !== 6) return [0, 0, 0];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function main() {
  let stack = null;
  try {
    stack = await startLiveStack({
      startWeb: false,
      env: { AETHERIA_DISABLE_OCR: "1" },
    });
    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;

    // 1. Verify live engine health
    const health1 = await api(baseUrl, "/api/health", { authHeader });
    assert(health1.ok && health1.json?.healthy === true, `Engine unhealthy: ${health1.text}`);

    // 2. Generate synthetic clip inside isolated temp workspace
    const synthMp4 = path.join(wsDir, "ref", "p7_synth_e2e.mp4");
    fs.mkdirSync(path.dirname(synthMp4), { recursive: true });
    generateSyntheticE2EClip(synthMp4);

    // 3. Success path: POST /api/studio/video-reference/extract
    const extRes = await api(baseUrl, `/api/studio/video-reference/extract?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { videoPath: "ref/p7_synth_e2e.mp4" },
    });
    assert(extRes.ok && extRes.json?.success === true, `Extract failed: ${extRes.text}`);

    const extractedDir = path.join(wsDir, "ref", "extracted");
    const temporalDoc = JSON.parse(fs.readFileSync(path.join(extractedDir, "temporal.json"), "utf8"));
    const astDoc = JSON.parse(fs.readFileSync(path.join(extractedDir, "style_ast.json"), "utf8"));
    const reportMd = fs.readFileSync(path.join(extractedDir, "ref_report.md"), "utf8");
    const skel1 = fs.readFileSync(path.join(extractedDir, "skeletons", "scene1.js"), "utf8");

    // R1: Frame-accurate hard cuts (2.000s & 4.000s within <= 1 frame) + honest BPM fallback
    const hardCuts = (temporalDoc.cuts || []).filter((c) => c.evidence === "hard").map((c) => Number(c.cutSec));
    assert(hardCuts.length === 2, `Expected 2 hard cuts, got ${JSON.stringify(temporalDoc.cuts)}`);
    assert(Math.abs(hardCuts[0] - 2.0) * 30 <= 1.0, `Cut 1 drifted: ${hardCuts[0]}`);
    assert(Math.abs(hardCuts[1] - 4.0) * 30 <= 1.0, `Cut 2 drifted: ${hardCuts[1]}`);
    assert(astDoc.bpmSource === "fallback", `Expected bpmSource=fallback, got ${astDoc.bpmSource}`);
    assert(reportMd.includes("BPM tak terukur"), "ref_report.md missing 'BPM tak terukur'");

    // R2: Scene 1 cameraMotion + AM.applyCamera skeleton; Scene 3 moving-object control guard
    const [sc1, sc2, sc3] = astDoc.scenes || [];
    assert(sc1 && sc2 && sc3, `Expected 3 scenes, got ${(astDoc.scenes || []).length}`);
    const seg1 = (sc1.cameraMotion?.segments || []).find((s) => s.confidence !== "low");
    assert(Boolean(seg1), `Scene 1 missing active cameraMotion: ${JSON.stringify(sc1.cameraMotion)}`);
    assert(skel1.includes("AM.applyCamera"), "scene1.js skeleton missing AM.applyCamera");
    const sc3ActiveCam = (sc3.cameraMotion?.segments || []).some((s) => s.confidence !== "low");
    assert(!sc3ActiveCam, `Scene 3 moving-object control falsely flagged cameraMotion: ${JSON.stringify(sc3.cameraMotion)}`);

    // R3: Scene 1 (camera zoom) & Scene 2 (tile-wall late zoom) adaptive beat strips
    const panels1 = sc1.beatStripPanels || [];
    const reasons1 = new Set(panels1.map((p) => p.reason));
    assert(reasons1.has("scene-start") && reasons1.has("scene-end"), `Scene 1 missing cut bounds: ${[...reasons1]}`);
    assert(reasons1.has("camera-peak") || reasons1.has("camera-climax"), `Scene 1 missing camera event: ${[...reasons1]}`);

    const panels2 = sc2.beatStripPanels || [];
    const ts2 = sc2.beatStripTimestamps || [];
    assert(panels2.length >= 4 && panels2.length <= 6, `Unexpected panel count: ${panels2.length}`);
    assert(ts2[0] - sc2.start <= 0.15, `First beat-strip panel too far from cut: ${ts2[0]} vs ${sc2.start}`);
    assert(ts2[ts2.length - 1] >= sc2.end - 0.12, `Last panel missed late zoom climax: ${ts2[ts2.length - 1]} vs ${sc2.end}`);
    const reasons2 = new Set(panels2.map((p) => p.reason));
    assert(reasons2.has("scene-start") && reasons2.has("scene-end"), `Missing cut bounds in reasons: ${[...reasons2]}`);
    assert(
      reasons2.has("camera-peak") || reasons2.has("camera-climax") || reasons2.has("motion-peak"),
      `Missing motion/camera event in Scene 2 reasons: ${[...reasons2]}`
    );

    // R4: Scene 2 tile-wall cleanPlate true dark gap (#0C0B0E within <= 12/channel)
    assert(sc2.cleanPlate?.kind === "tile-wall", `Expected kind=tile-wall, got ${JSON.stringify(sc2.cleanPlate)}`);
    const rgb2 = hexToRgb(sc2.cleanPlate?.fillHex);
    const maxChErr = Math.max(Math.abs(rgb2[0] - 12), Math.abs(rgb2[1] - 11), Math.abs(rgb2[2] - 14));
    assert(maxChErr <= 12, `Tile-wall cleanPlate fillHex ${sc2.cleanPlate?.fillHex} err=${maxChErr} > 12 vs #0C0B0E`);

    // 4. Failure paths (AGENTS.md §3.3):
    //    (a) Engine HTTP endpoint rejects path outside workspace cleanly without crashing
    const escapeRes = await api(baseUrl, `/api/studio/video-reference/extract?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { videoPath: "../outside_escape.mp4" },
    });
    assert(
      escapeRes.json?.success === false && Boolean(escapeRes.json?.error),
      `Expected path-guard rejection, got: ${escapeRes.text}`
    );

    //    (b) Engine HTTP endpoint rejects unsupported reference URL with clear error
    const badUrlRes = await api(baseUrl, `/api/studio/video-reference/extract?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { referenceUrl: "https://example.com/not-supported.mp4" },
    });
    assert(
      badUrlRes.json?.success === false && Boolean(badUrlRes.json?.error),
      `Expected unsupported URL error, got: ${badUrlRes.text}`
    );

    //    (c) Python extractor rejects corrupt/unreadable video bytes cleanly
    const corruptMp4 = path.join(wsDir, "ref", "corrupt_e2e.mp4");
    fs.writeFileSync(corruptMp4, "NOT_A_VALID_MP4_STREAM_DATA_1234567890", "utf8");
    const corruptOut = execFileSync(
      "python",
      [path.join(REPO_ROOT, "core", "ref_extractor", "ref_extractor.py"), corruptMp4, path.join(wsDir, "ref", "corrupt_out")],
      { encoding: "utf8", env: { ...process.env, AETHERIA_DISABLE_OCR: "1" } }
    );
    const corruptJson = JSON.parse(corruptOut);
    assert(Boolean(corruptJson?.error), `Expected Python extractor error on corrupt MP4, got: ${corruptOut}`);

    const health2 = await api(baseUrl, "/api/health", { authHeader });
    assert(health2.ok && health2.json?.healthy === true, `Engine unhealthy after error paths: ${health2.text}`);

    console.log(
      "[REF_EXTRACTOR_P7_E2E_PASS]",
      JSON.stringify({
        hardCuts,
        bpmSource: astDoc.bpmSource,
        scene1ScaleTo: seg1.scaleTo,
        scene2CleanPlate: sc2.cleanPlate,
        scene2MaxChanErr: maxChErr,
        scene2BeatStripPanels: panels2,
        scene3ControlClean: !sc3ActiveCam,
        escapePathRejected: escapeRes.json.error,
        badUrlRejected: badUrlRes.json.error,
        corruptVideoRejected: corruptJson.error,
      })
    );
  } finally {
    await stack?.stop();
  }
}

main().catch((err) => {
  console.error("[REF_EXTRACTOR_P7_E2E_FAIL]", err);
  process.exit(1);
});
