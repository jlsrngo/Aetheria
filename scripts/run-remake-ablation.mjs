#!/usr/bin/env node
/**
 * PROMPT 8 (Phase X3) — Direct Per-Scene Remake Ablation Runner & X4/X5 Evaluator.
 *
 * Uses `e2e/live-stack.mjs` (`startLiveStack` & `resolveEngineBinary`) to benchmark
 * conditions C0..C6 across synthetic R0 clips (and optional owner-provided non-benchmark MP4),
 * parses Phase X0 JSONL traces, builds `REF | C0 | Cx` comparison contact sheets, and evaluates
 * Phase X4 default-change criteria and Phase X5 conditional motion-probe triggers.
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startLiveStack, resolveEngineBinary } from "../e2e/live-stack.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

const ABLATION_CELLS = [
  { id: "C0", label: "default", env: {} },
  { id: "C1", label: "PROBE_STEPS=6", env: { AETHERIA_SCENE_PROBE_STEPS: "6" } },
  { id: "C2", label: "PROBE_STEPS=off", env: { AETHERIA_SCENE_PROBE_STEPS: "off" } },
  { id: "C3", label: "CROSS_CONTEXT=summary", env: { AETHERIA_SCENE_CROSS_CONTEXT: "summary" } },
  { id: "C4", label: "REASONING=high", env: { AETHERIA_SCENE_REASONING: "high" } },
  {
    id: "C5",
    label: "PROMPT=minimal+PROBE=off+RESTORE=off+MAX=18",
    env: {
      AETHERIA_SCENE_PROMPT: "minimal",
      AETHERIA_SCENE_PROBE_STEPS: "off",
      AETHERIA_SCENE_RESTORE: "off",
      AETHERIA_SCENE_MAX_STEPS: "18",
    },
  },
  {
    id: "C6",
    label: "C1+C3+C4",
    env: {
      AETHERIA_SCENE_PROBE_STEPS: "6",
      AETHERIA_SCENE_CROSS_CONTEXT: "summary",
      AETHERIA_SCENE_REASONING: "high",
    },
  },
];

function parseArgs(argv) {
  const opts = {
    live: false,
    dryRun: true,
    runs: 3,
    cells: ABLATION_CELLS.map((c) => c.id),
    scenes: "1,2,3",
    clips: 2,
    realClip: "",
    provider: process.env.AETHERIA_TEST_PROVIDER || "",
    model: process.env.AETHERIA_TEST_MODEL || "",
    outDir: "",
    cleanup: false,
    timeoutMs: 240_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") {
      opts.live = true;
      opts.dryRun = false;
    } else if (a === "--dry-run") {
      opts.live = false;
      opts.dryRun = true;
    } else if (a === "--runs" && argv[i + 1]) {
      opts.runs = Math.max(1, Number(argv[++i]) || 3);
    } else if (a === "--cells" && argv[i + 1]) {
      opts.cells = argv[++i]
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (a === "--scenes" && argv[i + 1]) {
      opts.scenes = argv[++i].trim();
    } else if (a === "--clips" && argv[i + 1]) {
      opts.clips = Math.max(1, Math.min(2, Number(argv[++i]) || 2));
    } else if (a === "--real-clip" && argv[i + 1]) {
      opts.realClip = argv[++i];
    } else if (a === "--provider" && argv[i + 1]) {
      opts.provider = argv[++i];
    } else if (a === "--model" && argv[i + 1]) {
      opts.model = argv[++i];
    } else if (a === "--out-dir" && argv[i + 1]) {
      opts.outDir = argv[++i];
    } else if (a === "--cleanup") {
      opts.cleanup = true;
    } else if (a === "--timeout-ms" && argv[i + 1]) {
      opts.timeoutMs = Math.max(30_000, Number(argv[++i]) || 240_000);
    }
  }
  return opts;
}

function assertNotBenchmarkPath(candidatePath) {
  const benchmarksRoot = path.resolve(REPO_ROOT, "benchmarks").toLowerCase().replace(/\\/g, "/");
  const resolved = path.resolve(candidatePath).toLowerCase().replace(/\\/g, "/");
  if (resolved === benchmarksRoot || resolved.startsWith(`${benchmarksRoot}/`)) {
    throw new Error(
      `ANTI-CHEAT BLOCKED: --real-clip MUST NOT point inside benchmarks/ (${candidatePath})`,
    );
  }
}

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
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function generateSyntheticR0Clips(destDir, clipLimit) {
  fs.mkdirSync(destDir, { recursive: true });
  const refDir = path.join(REPO_ROOT, "core", "ref_extractor").replace(/\\/g, "/");
  const outDirPy = destDir.replace(/\\/g, "/");
  const py = `
import json, sys
from pathlib import Path
sys.path.insert(0, r"${refDir}")
import synth_reference

specs = [
    synth_reference.build_synthetic_suite_specs("A")[0],
    synth_reference.build_synthetic_suite_specs("B")[0],
][:${clipLimit}]

out = []
for sp in specs:
    mp4 = Path(r"${outDirPy}") / f"{sp['name']}.mp4"
    truth_json = Path(r"${outDirPy}") / f"{sp['name']}_truth.json"
    truth = synth_reference.generate_synthetic_clip(sp, mp4, truth_json)
    out.append({"id": sp["name"], "mp4": str(mp4), "truth": truth})
print(json.dumps(out))
`;
  const stdout = execFileSync("python", ["-c", py], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(stdout.trim());
}

function startAblationMockLlm(cellId) {
  const stats = { calls: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-ablation-v", object: "model" }] }));
        return;
      }
      stats.calls += 1;
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const msgs = Array.isArray(payload.messages) ? payload.messages : [];
      const sysText = String(msgs[0]?.content || "");
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      const toolNames = tools.map((t) => t?.function?.name).filter(Boolean);

      const respond = (msgObj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `abl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            object: "chat.completion",
            choices: [{ index: 0, finish_reason: msgObj.tool_calls ? "tool_calls" : "stop", message: msgObj }],
            usage: { prompt_tokens: 210, completion_tokens: 95, total_tokens: 305 },
          }),
        );
      };

      const isDirectScene =
        sysText.includes("ANTIGRAVITY-GRADE INTERACTIVE WORKFLOW") ||
        sysText.includes("Reconstruct the target scene procedurally");

      if (isDirectScene) {
        const firstUserParts = Array.isArray(msgs[1]?.content) ? msgs[1].content : [];
        const firstUserText = firstUserParts.map((p) => p?.text || "").join("\n");
        const scMatch = firstUserText.match(/TARGET SCENE (\d+)\/\d+: id="([^"]+)"/);
        const sceneNum = scMatch ? Number(scMatch[1]) : 1;
        const sceneId = scMatch ? scMatch[2] : `scene${sceneNum}`;
        const dimMatch = firstUserText.match(/CANVAS & TIMING:\s*(\d+)x(\d+)\s*@/);
        const cw = dimMatch ? Number(dimMatch[1]) : 1024;
        const ch = dimMatch ? Number(dimMatch[2]) : 576;
        const bgMatch = firstUserText.match(/CLEAN PLATE BACKGROUND:\s*fillHex=(#[0-9A-Fa-f]{6})/);
        const bgHex = bgMatch ? bgMatch[1] : "#12141A";
        const assistantMsgs = msgs.filter((m) => m.role === "assistant");
        const step = assistantMsgs.length + 1;

        if (step === 1) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_p1`,
                type: "function",
                function: { name: "sample_ref_region", arguments: JSON.stringify({ timestampSec: 0.4 }) },
              },
              {
                id: `s${sceneNum}_p2`,
                type: "function",
                function: { name: "inspect_ref_frame", arguments: JSON.stringify({ timestampSec: 0.4 }) },
              },
            ],
          });
        }
        if (step === 2) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_p3`,
                type: "function",
                function: { name: "inspect_ref_frame", arguments: JSON.stringify({ timestampSec: 0.8 }) },
              },
            ],
          });
        }
        if (step === 3 && toolNames.includes("inspect_ref_frame")) {
          // Executed only when gate allows >2 probe steps (C1/C2/C5/C6)
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_p4`,
                type: "function",
                function: { name: "inspect_ref_frame", arguments: JSON.stringify({ timestampSec: 1.0 }) },
              },
            ],
          });
        }
        const wroteAlready = msgs.some(
          (m) => m.role === "tool" && String(m.name || "") === "write_scene_script" && String(m.content || "").includes('"ok":true'),
        );
        if (!wroteAlready) {
          const accent = cellId === "C5" ? "#F59E0B" : "#60A5FA";
          const code = [
            "(function () {",
            "  var AM = window.AM;",
            `  function drawAccentLayer(c, p) { c.fillStyle='${accent}'; c.fillRect(${Math.round(cw * 0.25)} + p * 60, ${Math.round(ch * 0.35)}, ${Math.round(cw * 0.35)}, ${Math.round(ch * 0.25)}); }`,
            `  AM.registerScene("${sceneId}", function (ctx, t, dur) {`,
            `    var W = ${cw}, H = ${ch};`,
            "    var p = AM.ease.outCubic(AM.clamp(t / Math.max(0.2, dur), 0, 1));",
            `    ctx.fillStyle = "${bgHex}";`,
            "    ctx.fillRect(0, 0, W, H);",
            "    drawAccentLayer(ctx, p);",
            "    ctx.fillStyle = '#F8FAFC';",
            `    ctx.font = '700 28px "Inter", sans-serif';`,
            `    ctx.fillText("${sceneId} ${cellId}", 64 + p * 16, ${Math.round(ch * 0.22)});`,
            "  });",
            "})();",
          ].join("\n");
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_w`,
                type: "function",
                function: { name: "write_scene_script", arguments: JSON.stringify({ code }) },
              },
            ],
          });
        }
        const renderedAlready = msgs.some(
          (m) => m.role === "tool" && String(m.name || "") === "render_and_compare_scene",
        );
        if (!renderedAlready) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_r`,
                type: "function",
                function: { name: "render_and_compare_scene", arguments: JSON.stringify({}) },
              },
            ],
          });
        }
        return respond({ role: "assistant", content: `Scene ${sceneNum} complete (${cellId}).` });
      }

      // Coordinator turn: step 1 extract_video_reference -> step 2 film_scaffold from style.json -> done
      const toolMsgs = msgs.filter((m) => m.role === "tool");
      if (toolMsgs.length === 0) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "coord_extract",
              type: "function",
              function: { name: "extract_video_reference", arguments: JSON.stringify({ videoPath: "ref/ref_clip.mp4" }) },
            },
          ],
        });
      }
      if (toolMsgs.length === 1) {
        const wsHintMatch = JSON.stringify(msgs).match(/ref_clip\.mp4/);
        const _unused = wsHintMatch;
        const scList = [];
        let title = `Ablation ${cellId}`;
        let width = 1024;
        let height = 576;
        let fps = 30;
        const extractContent = String(toolMsgs[0]?.content || "");
        const countMatch = extractContent.match(/(\d+)\s+scenes?/i);
        const nScenes = Math.max(4, Math.min(8, Number(countMatch?.[1]) || 4));
        const ids = ["scene1_intro", "scene2_tile_zoom", "scene3_short", "scene4_pan", "scene5_fade", "scene6_extra", "scene7_extra", "scene8_extra"];
        for (let k = 0; k < nScenes; k++) {
          scList.push({ id: ids[k], duration: 2.0 });
        }
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "coord_scaffold",
              type: "function",
              function: {
                name: "film_scaffold",
                arguments: JSON.stringify({ title, width, height, fps, background: "#101218", scenes: scList }),
              },
            },
          ],
        });
      }
      return respond({ role: "assistant", content: "Done." });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        stats,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address()?.port;
      srv.close(() => (p ? resolve(p) : reject(new Error("No free port"))));
    });
  });
}

async function startLiveUserEngine(envVars) {
  const serverAuth = require(path.join(REPO_ROOT, "scripts", "server-auth.cjs"));
  const auth = serverAuth.create();
  const port = await findFreePort();
  const exeBin = resolveEngineBinary(REPO_ROOT);
  let logs = "";
  const proc = spawn(exeBin, ["serve", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...auth.engineEnv,
      AETHERIA_DISABLE_OCR: "1",
      ...envVars,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  proc.stdout?.on("data", (d) => (logs += d.toString("utf8")));
  proc.stderr?.on("data", (d) => (logs += d.toString("utf8")));

  const engineUrl = `http://127.0.0.1:${port}`;
  const authHeader = `Basic ${Buffer.from(`${auth.engineEnv.AETHERIA_SERVER_USERNAME}:${auth.engineEnv.AETHERIA_SERVER_PASSWORD}`).toString("base64")}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Live engine exited early:\n${logs.slice(-600)}`);
    try {
      const h = await api(engineUrl, "/api/health", { authHeader, timeoutMs: 3000 });
      if (h.ok && h.json?.healthy === true) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  const stop = async () => {
    try {
      if (process.platform === "win32") execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore", windowsHide: true });
      else proc.kill("SIGKILL");
    } catch {}
  };
  return { engineUrl, authHeader, stop, logs: () => logs };
}

function findTraceFile(wsDir, sessId) {
  const safeSid = sessId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const expected = path.join(wsDir, ".aetheria", "trace", `direct_remake_${safeSid}.jsonl`);
  if (fs.existsSync(expected)) return expected;
  const traceDir = path.join(wsDir, ".aetheria", "trace");
  if (!fs.existsSync(traceDir)) return null;
  const first = fs.readdirSync(traceDir).find((f) => f.startsWith("direct_remake_") && f.endsWith(".jsonl"));
  return first ? path.join(traceDir, first) : null;
}

function parseTraceMetrics(tracePath) {
  const rows = fs
    .readFileSync(tracePath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
  const header = rows.find((r) => r.type === "run_header") || {};
  const steps = rows.filter((r) => r.type === "step");
  const summaries = rows.filter((r) => r.type === "scene_summary");

  const sceneScores = summaries.map((s) => Number(s.finalScore || 0));
  const below072 = sceneScores.filter((v) => v < 0.72).length;
  const runtimeErrScenes = summaries.filter((s) =>
    Array.isArray(s.renders) ? s.renders.some((r) => Number(r.runtimeErrors || 0) > 0) : false,
  ).length;
  const firstWriteSteps = summaries.map((s) => s.firstWriteStep).filter((v) => typeof v === "number");
  const probesBeforeWrite = summaries.map((s) => Number(s.probeCallsBeforeWrite || 0));
  const totalSteps = summaries.reduce((a, s) => a + Number(s.stepsUsed || 0), 0);
  const totalWallMs = summaries.reduce((a, s) => a + Number(s.wallMs || 0), 0);
  const inputTokens = steps.reduce((a, st) => a + (typeof st.inputTokens === "number" ? st.inputTokens : 0), 0);
  const outputTokens = steps.reduce((a, st) => a + (typeof st.outputTokens === "number" ? st.outputTokens : 0), 0);
  const hasTokens = steps.some((st) => typeof st.inputTokens === "number");

  // X5 trigger check: >= 3 consecutive inspect_ref_frame on nearby timestamps OR bash using cv2
  let x5TriggeredScenes = 0;
  for (const sc of summaries) {
    const scSteps = steps.filter((st) => Number(st.scene) === Number(sc.scene));
    const toolSeq = [];
    for (const st of scSteps) {
      for (const tc of st.toolCalls || []) toolSeq.push(tc);
    }
    let maxNearbyInspectStreak = 0;
    let streakTimes = [];
    let usedBashCv2 = false;
    for (const tc of toolSeq) {
      if (tc.name === "bash" && tc.probeTag === "cv2") {
        usedBashCv2 = true;
      }
      if (tc.name === "inspect_ref_frame") {
        const m = typeof tc.probeTag === "string" ? tc.probeTag.match(/t=(\d+(?:\.\d+)?)/) : null;
        const tVal = m ? Number(m[1]) : null;
        if (streakTimes.length === 0 || tVal === null || Math.abs(tVal - streakTimes[streakTimes.length - 1]) <= 1.5) {
          streakTimes.push(tVal ?? 0);
        } else {
          streakTimes = [tVal];
        }
        maxNearbyInspectStreak = Math.max(maxNearbyInspectStreak, streakTimes.length);
      } else {
        streakTimes = [];
      }
    }
    if (maxNearbyInspectStreak >= 3 || usedBashCv2) {
      x5TriggeredScenes += 1;
    }
  }

  return {
    header,
    summaries,
    medianSceneScore: median(sceneScores),
    minSceneScore: sceneScores.length ? Math.min(...sceneScores) : 0,
    below072,
    runtimeErrScenes,
    medianFirstWriteStep: median(firstWriteSteps),
    medianProbeBeforeWrite: median(probesBeforeWrite),
    totalSteps,
    totalWallMs,
    inputTokens: hasTokens ? inputTokens : null,
    outputTokens: hasTokens ? outputTokens : null,
    sceneCount: summaries.length,
    x5TriggeredScenes,
  };
}

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function rangeSpan(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.max(...arr) - Math.min(...arr);
}

async function captureProjectSceneMidpoints(projDir, outPngMap) {
  const filmPath = path.join(projDir, "film.json");
  const indexPath = path.join(projDir, "index.html");
  if (!fs.existsSync(filmPath) || !fs.existsSync(indexPath)) return;
  const film = JSON.parse(fs.readFileSync(filmPath, "utf8"));
  const scenes = Array.isArray(film.scenes) ? film.scenes : [];
  if (scenes.length === 0) return;

  const mimeMap = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav" };
  const server = http.createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = cleanUrl === "/" ? "index.html" : cleanUrl.replace(/^\/+/, "");
    const target = path.resolve(projDir, rel);
    if (!target.startsWith(path.resolve(projDir)) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: Number(film.width) || 1024, height: Number(film.height) || 576 } });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.renderAt === "function", { timeout: 10_000 });
    for (let i = 0; i < scenes.length; i++) {
      const scNum = i + 1;
      if (!outPngMap.has(scNum)) continue;
      const sc = scenes[i];
      const midT = Number(sc.start || 0) + Number(sc.duration || 1) * 0.5;
      await page.evaluate((t) => {
        window.renderAt(t);
      }, midT);
      await page.waitForTimeout(40);
      const dest = outPngMap.get(scNum);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await page.screenshot({ path: dest, type: "jpeg", quality: 85 });
    }
  } finally {
    await browser.close();
    server.close();
  }
}

function buildRefVsCellsContactSheet(clipId, sceneNum, panelPaths, outSheetPath) {
  if (panelPaths.length < 2) return;
  const specJson = JSON.stringify(panelPaths);
  const py = `
import json
from PIL import Image, ImageDraw
panels = json.loads(r'''${specJson}''')
imgs = []
for p in panels:
    im = Image.open(p["path"]).convert("RGB").resize((360, 202))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 140, 24], fill=(15, 23, 42))
    d.text((6, 6), p["label"][:18], fill=(248, 250, 252))
    imgs.append(im)
strip = Image.new("RGB", (360 * len(imgs), 202), (10, 12, 18))
for idx, im in enumerate(imgs):
    strip.paste(im, (idx * 360, 0))
strip.save(r"${outSheetPath.replace(/\\/g, "/")}", quality=88)
`;
  execFileSync("python", ["-c", py], { stdio: "pipe" });
}

async function runSingleAblationPass({ clip, cell, runIdx, opts, mockLlm }) {
  const tempWsParent = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-abl-${clip.id}-${cell.id}-r${runIdx}-`));
  let stack = null;
  let liveProc = null;

  try {
    const cellEnv = {
      AETHERIA_DISABLE_OCR: "1",
      AETHERIA_REMAKE_MODE: "direct",
      AETHERIA_REMAKE_ONLY_SCENES: opts.scenes,
      ...cell.env,
    };

    let baseUrl;
    let authHeader;
    let wsDir;
    let modelObj;

    if (opts.live) {
      wsDir = path.join(tempWsParent, "workspace");
      fs.mkdirSync(path.join(wsDir, "ref"), { recursive: true });
      liveProc = await startLiveUserEngine(cellEnv);
      baseUrl = liveProc.engineUrl;
      authHeader = liveProc.authHeader;

      // Pick configured live provider/model unless overridden
      if (opts.provider && opts.model) {
        modelObj = { providerID: opts.provider, modelID: opts.model, id: opts.model };
      } else {
        const cfgRes = await api(baseUrl, "/api/config", { authHeader });
        const providers = cfgRes.json?.provider && typeof cfgRes.json.provider === "object" ? Object.entries(cfgRes.json.provider) : [];
        const active = providers
          .filter(([, p]) => p && p.active !== false && p.models && Object.keys(p.models).length > 0)
          .sort((a, b) => {
            const aHas38 = Object.keys(a[1].models || {}).some((m) => /gemini-3\.8-flash/i.test(m));
            const bHas38 = Object.keys(b[1].models || {}).some((m) => /gemini-3\.8-flash/i.test(m));
            if (aHas38 !== bHas38) return aHas38 ? -1 : 1;
            return Number(a[1].priority || 99) - Number(b[1].priority || 99);
          });
        for (const [pid, p] of active) {
          if (opts.provider && pid !== opts.provider) continue;
          const mids = Object.keys(p.models || {});
          const chosen = opts.model || mids.find((m) => /gemini-3\.8-flash-(medium|high)/i.test(m)) || p.defaultModel || mids[0];
          if (chosen) {
            modelObj = { providerID: pid, modelID: chosen, id: chosen };
            break;
          }
        }
        if (!modelObj) {
          throw new Error("BLOCKED_NO_LIVE_PROVIDER: No active provider/model found in /api/config");
        }
      }
    } else {
      stack = await startLiveStack({
        startWeb: false,
        env: cellEnv,
        aetheriaConfig: {
          provider: {
            "mock-abl": {
              name: "Mock Ablation Provider",
              type: "openai",
              options: { baseURL: mockLlm.url, apiKey: "sk-mock-abl" },
              models: { "mock-ablation-v": { name: "Mock Ablation Vision", vision: true } },
            },
          },
        },
      });
      baseUrl = stack.engineUrl;
      authHeader = stack.authHeader;
      wsDir = stack.workspaceDir;
      fs.mkdirSync(path.join(wsDir, "ref"), { recursive: true });
      modelObj = { providerID: "mock-abl", modelID: "mock-ablation-v", id: "mock-ablation-v" };
    }

    fs.copyFileSync(clip.mp4, path.join(wsDir, "ref", "ref_clip.mp4"));
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: `Ablation ${clip.id} ${cell.id} #${runIdx}`, model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Failed creating session: ${sessRes.text}`);

    const t0 = Date.now();
    const promptRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: {
          text: `Ikuti referensi video ref/ref_clip.mp4 dan buat ulang scene video tersebut secara presisi dengan micro-tools.`,
        },
      },
    });
    if (!promptRes.ok) throw new Error(`Prompt rejected (${promptRes.status}): ${promptRes.text}`);

    const deadline = Date.now() + opts.timeoutMs;
    let completed = false;
    let assistantError = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 600));
      const [msgRes, jobsRes] = await Promise.all([
        api(baseUrl, `/api/session/${sessId}/message?order=asc&${dirQuery}`, { authHeader }).catch(() => null),
        api(baseUrl, `/api/session/${sessId}/jobs`, { authHeader }).catch(() => null),
      ]);
      const msgs = msgRes?.json?.data ?? msgRes?.json ?? [];
      const assistants = Array.isArray(msgs) ? msgs.filter((m) => (m.info?.role ?? m.role) === "assistant") : [];
      const jobs = jobsRes?.json?.data ?? [];
      const running = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running") : [];
      const latest = assistants[assistants.length - 1];
      const errMsg = latest?.info?.error?.message || latest?.error?.message || "";
      if (errMsg) assistantError = String(errMsg);
      if (assistants.length > 0 && (latest?.info?.time?.completed || latest?.time?.completed) && running.length === 0) {
        completed = true;
        break;
      }
    }
    const wallMs = Date.now() - t0;
    if (!completed) {
      throw new Error(`Turn timed out after ${opts.timeoutMs}ms${assistantError ? `: ${assistantError}` : ""}`);
    }
    const traceFile = findTraceFile(wsDir, sessId);
    if (!traceFile) {
      throw new Error(`Missing X0 JSONL trace in ${wsDir} (assistantError=${assistantError || "none"})`);
    }
    const metrics = parseTraceMetrics(traceFile);

    // Copy ref frames + capture rendered midpoint frames for run 1 contact sheets
    const snapDir = path.join(tempWsParent, "snaps");
    const refFramesDir = path.join(wsDir, "ref", "extracted", "frames");
    const projsDir = path.join(wsDir, "projects");
    const slug = fs.existsSync(projsDir)
      ? fs.readdirSync(projsDir).find((d) => fs.existsSync(path.join(projsDir, d, "film.json")))
      : null;
    const frameMap = new Map();
    if (runIdx === 1 && slug) {
      const targetScenes = opts.scenes
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => n >= 1);
      const outMap = new Map();
      for (const scNum of targetScenes) {
        const refImg = path.join(refFramesDir, `ref_scene_${String(scNum).padStart(2, "0")}.jpg`);
        const renImg = path.join(snapDir, `sc${scNum}_${cell.id}.jpg`);
        outMap.set(scNum, renImg);
        frameMap.set(scNum, { refImg: fs.existsSync(refImg) ? refImg : null, renImg });
      }
      await captureProjectSceneMidpoints(path.join(projsDir, slug), outMap);
    }

    return {
      metrics,
      wallMs,
      frameMap,
      cleanupSnap: () => fs.rmSync(tempWsParent, { recursive: true, force: true }),
    };
  } finally {
    await stack?.stop();
    await liveProc?.stop();
    if (runIdx !== 1) {
      fs.rmSync(tempWsParent, { recursive: true, force: true });
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.realClip) {
    assertNotBenchmarkPath(opts.realClip);
    if (!fs.existsSync(opts.realClip)) {
      throw new Error(`--real-clip does not exist: ${opts.realClip}`);
    }
  }

  const outDir = opts.outDir
    ? path.resolve(opts.outDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-remake-ablation-"));
  const clipsDir = path.join(outDir, "clips");
  const sheetsDir = path.join(outDir, "contact_sheets");
  fs.mkdirSync(sheetsDir, { recursive: true });

  const clips = generateSyntheticR0Clips(clipsDir, opts.clips);
  if (opts.realClip) {
    clips.push({ id: `real_${path.basename(opts.realClip, path.extname(opts.realClip))}`, mp4: path.resolve(opts.realClip), truth: null });
  }

  const summaryRows = [];
  const x5All = { scenesTotal: 0, scenesTriggered: 0 };
  const refAndCellFrames = new Map(); // `${clipId}:${sceneNum}` -> { ref, cells: Map(cellId -> buf) }
  const cleanupDirs = [];
  let c0ThinkingLevel = null;

  try {
    for (const clip of clips) {
      for (const cellId of opts.cells) {
        const cell = ABLATION_CELLS.find((c) => c.id === cellId);
        if (!cell) continue;
        if (cell.id === "C4" && c0ThinkingLevel === "high") {
          console.log(`[SKIP] C4 on ${clip.id} because C0 already ran thinkingLevel=high`);
          continue;
        }

        const runResults = [];
        for (let r = 1; r <= opts.runs; r++) {
          let mock = null;
          if (!opts.live) {
            mock = await startAblationMockLlm(cell.id);
          }
          try {
            const res = await runSingleAblationPass({ clip, cell, runIdx: r, opts, mockLlm: mock });
            runResults.push(res);
            if (r !== 1) res.cleanupSnap();
            else cleanupDirs.push(res.cleanupSnap);

            if (cell.id === "C0" && !c0ThinkingLevel) {
              c0ThinkingLevel = res.metrics.header?.thinkingLevel || null;
            }
            x5All.scenesTotal += res.metrics.sceneCount;
            x5All.scenesTriggered += res.metrics.x5TriggeredScenes;

            if (r === 1) {
              for (const [scNum, pair] of res.frameMap.entries()) {
                const key = `${clip.id}:${scNum}`;
                if (!refAndCellFrames.has(key)) refAndCellFrames.set(key, { clipId: clip.id, scNum, ref: null, cells: new Map() });
                const rec = refAndCellFrames.get(key);
                if (pair.refImg && fs.existsSync(pair.refImg) && !rec.ref) {
                  const stableRef = path.join(sheetsDir, `_tmp_${clip.id}_s${scNum}_ref.jpg`);
                  fs.copyFileSync(pair.refImg, stableRef);
                  rec.ref = stableRef;
                }
                if (pair.renImg && fs.existsSync(pair.renImg)) {
                  const stableRen = path.join(sheetsDir, `_tmp_${clip.id}_s${scNum}_${cell.id}.jpg`);
                  fs.copyFileSync(pair.renImg, stableRen);
                  rec.cells.set(cell.id, stableRen);
                }
              }
            }
          } finally {
            await mock?.close().catch(() => {});
          }
        }

        const overalls = runResults.map((x) => x.metrics.medianSceneScore);
        const mins = runResults.map((x) => x.metrics.minSceneScore);
        const row = {
          cell: cell.id,
          label: cell.label,
          clip: clip.id,
          runs: runResults.length,
          medianOverall: median(overalls),
          minOverall: Math.min(...mins),
          rangeOverall: rangeSpan(overalls),
          medianBelow072: median(runResults.map((x) => x.metrics.below072)),
          runtimeErrScenes: runResults.reduce((a, x) => a + x.metrics.runtimeErrScenes, 0),
          medianFirstWriteStep: median(runResults.map((x) => x.metrics.medianFirstWriteStep)),
          medianProbeBeforeWrite: median(runResults.map((x) => x.metrics.medianProbeBeforeWrite)),
          medianSteps: median(runResults.map((x) => x.metrics.totalSteps)),
          medianWallMs: median(runResults.map((x) => x.wallMs)),
          upstreamModel: runResults[0]?.metrics.header?.upstreamModel || "",
          thinkingLevel: runResults[0]?.metrics.header?.thinkingLevel || null,
        };
        summaryRows.push(row);
      }
    }

    // Build REF | C0 | Cx contact sheets per clip & scene
    const sheetFiles = [];
    for (const entry of refAndCellFrames.values()) {
      const c0Img = entry.cells.get("C0");
      for (const [cellId, cellImg] of entry.cells.entries()) {
        if (cellId === "C0") continue;
        const panels = [];
        if (entry.ref) panels.push({ label: "REF", path: entry.ref });
        if (c0Img) panels.push({ label: "C0", path: c0Img });
        panels.push({ label: cellId, path: cellImg });
        if (panels.length >= 2) {
          const dest = path.join(sheetsDir, `${entry.clipId}_scene${entry.scNum}_REF_C0_${cellId}.jpg`);
          buildRefVsCellsContactSheet(entry.clipId, entry.scNum, panels, dest);
          sheetFiles.push(dest);
        }
      }
    }
    // Remove temporary single-frame copies inside contact_sheets/
    for (const f of fs.readdirSync(sheetsDir)) {
      if (f.startsWith("_tmp_")) fs.unlinkSync(path.join(sheetsDir, f));
    }

    // Evaluate X4 decision rule per non-C0 cell across clips
    const clipIds = clips.map((c) => c.id);
    const cellIds = [...new Set(summaryRows.map((r) => r.cell))].filter((id) => id !== "C0");
    const x4Decisions = cellIds.map((cid) => {
      let betterClips = 0;
      let regressedErr = false;
      for (const cl of clipIds) {
        const c0 = summaryRows.find((r) => r.cell === "C0" && r.clip === cl);
        const cx = summaryRows.find((r) => r.cell === cid && r.clip === cl);
        if (!c0 || !cx) continue;
        const diff = cx.medianOverall - c0.medianOverall;
        const maxRng = Math.max(c0.rangeOverall, cx.rangeOverall);
        if (cx.runtimeErrScenes > c0.runtimeErrScenes) regressedErr = true;
        if (diff >= 0.03 && diff > maxRng && cx.runtimeErrScenes <= c0.runtimeErrScenes) {
          betterClips += 1;
        }
      }
      let status = "tidak lolos";
      if (!opts.live) status = "dry-run mock (bukan bukti perubahan default)";
      else if (clipIds.length < 3) status = `belum cukup data (${clipIds.length}/3 klip)`;
      else if (betterClips >= 2 && !regressedErr) status = `lolos (${betterClips}/${clipIds.length} klip — menunggu tinjauan lembar kontak pemilik)`;
      return { cell: cid, betterClips, totalClips: clipIds.length, status };
    });

    const x5Pct = x5All.scenesTotal > 0 ? (x5All.scenesTriggered / x5All.scenesTotal) * 100 : 0;
    const x5Report = {
      scenesTotal: x5All.scenesTotal,
      scenesTriggered: x5All.scenesTriggered,
      pct: Number(x5Pct.toFixed(1)),
      triggered: x5Pct >= 30.0,
    };

    const mdLines = [
      `# Direct Per-Scene Ablation Report (${opts.live ? "LIVE" : "DRY-RUN MOCK"})`,
      "",
      `| Sel | Klip | median overall (min) | rentang | scene <0,72 | error runtime | firstWriteStep | probe sebelum tulis | langkah | waktu |`,
      `|---|---|---|---|---|---|---|---|---|---|`,
    ];
    for (const r of summaryRows) {
      mdLines.push(
        `| ${r.cell} (${r.label}) | ${r.clip} | ${r.medianOverall.toFixed(3)} (${r.minOverall.toFixed(3)}) | ${r.rangeOverall.toFixed(3)} | ${r.medianBelow072} | ${r.runtimeErrScenes} | ${r.medianFirstWriteStep.toFixed(1)} | ${r.medianProbeBeforeWrite.toFixed(1)} | ${r.medianSteps.toFixed(1)} | ${(r.medianWallMs / 1000).toFixed(1)}s |`,
      );
    }
    if (!opts.realClip) {
      mdLines.push(`| ALL | real_clip_pemilik | Terblokir | - | - | - | - | - | - | butuh --real-clip <path.mp4> di luar benchmarks/ |`);
    }
    mdLines.push("", "## Evaluasi X4", ...x4Decisions.map((d) => `- ${d.cell}: ${d.status}`));
    mdLines.push(
      "",
      `## Evaluasi Pemicu X5`,
      `- Pemicu (>=30% scene dgn >=3 inspect berdekatan atau bash+cv2): ${x5Report.scenesTriggered}/${x5Report.scenesTotal} (${x5Report.pct}%) -> ${x5Report.triggered ? "TERPICU" : "TIDAK TERPICU"}`,
    );

    const reportPath = path.join(outDir, "ablation_report.md");
    const jsonPath = path.join(outDir, "ablation_report.json");
    fs.writeFileSync(reportPath, mdLines.join("\n") + "\n", "utf8");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ opts: { live: opts.live, runs: opts.runs, scenes: opts.scenes }, summaryRows, x4Decisions, x5Report, sheetFiles }, null, 2),
      "utf8",
    );

    console.log(mdLines.join("\n"));
    console.log(`\n[ABLATION_COMPLETE] report=${reportPath} sheets=${sheetFiles.length}`);
  } finally {
    for (const fn of cleanupDirs) {
      try {
        fn();
      } catch {}
    }
    if (opts.cleanup) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("[ABLATION_FAIL]", err);
  process.exit(1);
});
