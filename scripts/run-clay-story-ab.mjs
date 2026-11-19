#!/usr/bin/env node
/**
 * S6 A/B Experiment Runner (`scripts/run-clay-story-ab.mjs`).
 *
 * Compares Condition A (legacy `/mg-soft-clay-story`, `AETHERIA_CLAY_STORY_MODE=legacy`)
 * vs Condition B (declarative `story.json` kit) across N runs per condition on the exact same
 * fixed brief (6 shots, ~30s, farmer vs pest in Indonesian) and same configured model.
 *
 * Measures per run:
 * - model-written JS lines/chars (excluding auto-seeded kit scripts & managed index.html)
 * - `story.json` lines/chars
 * - total tool steps across coordinator + subagents
 * - wall-clock seconds
 * - runtime errors
 * - shots with focus outside portrait 9:16 safe zone (independent Playwright measurement + __shotReport)
 * - `customShots` / `totalShots`
 * - whether final MP4 render (`/api/render-media`) completes
 * - saves each run's `contact_sheet.png` for human visual evaluation
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderSkillExample } from "./render-skill-example.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const FIXED_BRIEF =
  "/mg-soft-clay-story Buatkan video cerita 3D soft-clay 6 shot (±30 detik total, masing-masing 5 detik, portrait 1080x1920 30fps) berbahasa Indonesia tentang seorang petani melawan hama wereng di sawah menggunakan larutan organik dan menanam bunga kenikir bersama tetangga. Tanpa narasi TTS/audio dulu (cukup visual 3D + caption teks visual), pastikan preview diverifikasi bersih sebelum selesai.";

const SEEDED_KIT_FILES = new Set([
  "clay-kit.js",
  "clay-buildings.js",
  "clay-people.js",
  "clay-gestures.js",
  "clay-assets.js",
  "story-runtime.js",
  "aetheria-motion.js",
  "three.min.js",
]);

function parseArgs(argv) {
  const opts = {
    model: "local-cli/gemini-3.8-flash-high",
    runs: 3,
    conditions: ["A", "B"],
    outDir: "",
    turnTimeoutMs: 360_000,
    renderTimeoutMs: 420_000,
    skipMp4: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" && argv[i + 1]) opts.model = argv[++i];
    else if (a === "--runs" && argv[i + 1]) opts.runs = Math.max(1, Number(argv[++i]) || 3);
    else if (a === "--conditions" && argv[i + 1]) {
      opts.conditions = argv[++i].split(",").map((s) => s.trim().toUpperCase()).filter((s) => s === "A" || s === "B");
    } else if (a === "--out-dir" && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === "--turn-timeout-ms" && argv[i + 1]) opts.turnTimeoutMs = Number(argv[++i]);
    else if (a === "--render-timeout-ms" && argv[i + 1]) opts.renderTimeoutMs = Number(argv[++i]);
    else if (a === "--skip-mp4") opts.skipMp4 = true;
  }
  if (!opts.outDir) {
    opts.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-s6-ab-"));
  } else {
    fs.mkdirSync(opts.outDir, { recursive: true });
  }
  return opts;
}

function findAvailablePort(preferred = 4880) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => {
      const ephem = net.createServer();
      ephem.unref();
      ephem.listen(0, "127.0.0.1", () => {
        const port = ephem.address().port;
        ephem.close(() => resolve(port));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${urlPath}`);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Connection: "close" };
    if (authHeader) headers.Authorization = authHeader;
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
        agent: new http.Agent({ keepAlive: false }),
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
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, text, json });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function setupIsolatedXdgConfig() {
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-s6-cfg-"));
  const cfgSubdir = path.join(xdgDir, "aetheria-nexus");
  fs.mkdirSync(cfgSubdir, { recursive: true });
  const srcCfg = path.join(os.homedir(), ".config", "aetheria-nexus", "aetheria.json");
  const baseCfg = fs.existsSync(srcCfg) ? JSON.parse(fs.readFileSync(srcCfg, "utf8")) : {};
  delete baseCfg.agent;
  delete baseCfg.context;
  fs.writeFileSync(path.join(cfgSubdir, "aetheria.json"), JSON.stringify(baseCfg, null, 2), "utf8");
  return xdgDir;
}

function extractMessages(msgPayload) {
  const raw = msgPayload?.data ?? msgPayload;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.messages)) return raw.messages;
  return [];
}

function isTurnFinished(messages) {
  const assistants = messages.filter((m) => (m.info?.role ?? m.role) === "assistant");
  if (assistants.length === 0) return false;
  const last = assistants[assistants.length - 1];
  const info = last.info ?? last;
  if (!info.time?.completed && !info.error) return false;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  return !parts.some((p) => p.type === "tool" && (p.state?.status === "running" || p.state?.status === "pending"));
}

function findActiveProjectDir(wsDir) {
  const projectsDir = path.join(wsDir, "projects");
  if (fs.existsSync(projectsDir)) {
    const dirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(projectsDir, d.name));
    for (const d of dirs) {
      if (fs.existsSync(path.join(d, "index.html")) || fs.existsSync(path.join(d, "story.json"))) {
        return d;
      }
    }
    if (dirs.length > 0) return dirs[0];
  }
  return wsDir;
}

function measureModelAuthoredCode(projDir, condition) {
  let modelJsLines = 0;
  let modelJsChars = 0;
  const modelFiles = [];

  const scriptDir = path.join(projDir, "script");
  if (fs.existsSync(scriptDir)) {
    for (const fname of fs.readdirSync(scriptDir).sort()) {
      if (!fname.endsWith(".js") || SEEDED_KIT_FILES.has(fname.toLowerCase())) continue;
      const full = path.join(scriptDir, fname);
      if (!fs.statSync(full).isFile()) continue;
      const txt = fs.readFileSync(full, "utf8");
      modelJsLines += txt.split(/\r?\n/).length;
      modelJsChars += txt.length;
      modelFiles.push(`script/${fname}`);
    }
  }

  // In Condition A (legacy), model hand-writes index.html when manageIndexHtml=false
  const indexPath = path.join(projDir, "index.html");
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf8");
    const isStoryManaged = html.includes("window.StoryRuntime.boot");
    const isScaffoldManaged = html.includes("Aetheria Motion Engine (Managed Entry)");
    if (condition === "A" && !isStoryManaged && !isScaffoldManaged) {
      modelJsLines += html.split(/\r?\n/).length;
      modelJsChars += html.length;
      modelFiles.push("index.html");
    }
  }

  let storyJsonLines = 0;
  let storyJsonChars = 0;
  let totalShots = 0;
  let customShots = 0;
  const storyPath = path.join(projDir, "story.json");
  if (fs.existsSync(storyPath)) {
    const raw = fs.readFileSync(storyPath, "utf8");
    storyJsonLines = raw.split(/\r?\n/).length;
    storyJsonChars = raw.length;
    try {
      const parsed = JSON.parse(raw);
      const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
      totalShots = shots.length;
      customShots = shots.filter((s) => typeof s.custom === "string" && s.custom.trim().length > 0).length;
    } catch {}
  } else {
    const filmJsonPath = path.join(projDir, "film.json");
    if (fs.existsSync(filmJsonPath)) {
      try {
        const fj = JSON.parse(fs.readFileSync(filmJsonPath, "utf8"));
        if (Array.isArray(fj.scenes)) totalShots = fj.scenes.length;
      } catch {}
    }
  }

  return { modelJsLines, modelJsChars, modelFiles, storyJsonLines, storyJsonChars, totalShots, customShots };
}

async function renderProjectMp4(baseUrl, authHeader, dirQuery, outMp4Path, tempWorkspace, timeoutMs) {
  const outputName = `s6-ab-${crypto.randomBytes(4).toString("hex")}.mp4`;
  const startRes = await api(baseUrl, `/api/render-media?${dirQuery}`, {
    method: "POST",
    authHeader,
    timeoutMs: 30_000,
    body: { compositionId: "HtmlMotionFilm", codec: "h264", outputName },
  });
  const renderId = startRes.json?.renderId || startRes.json?.data?.renderId;
  if (!startRes.ok || !renderId) {
    return { rendered: false, error: `render-media HTTP ${startRes.status}: ${startRes.text.slice(0, 240)}` };
  }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const prog = await api(baseUrl, `/api/render-progress?renderId=${encodeURIComponent(renderId)}&${dirQuery}`, {
      authHeader,
      timeoutMs: 10_000,
    }).catch(() => null);
    const data = prog?.json?.data ?? prog?.json;
    if (data?.status === "done") {
      const renderedSrc =
        data.outputPath && fs.existsSync(data.outputPath)
          ? data.outputPath
          : path.join(tempWorkspace, "out", outputName);
      if (renderedSrc && fs.existsSync(renderedSrc)) {
        fs.copyFileSync(renderedSrc, outMp4Path);
        return {
          rendered: true,
          renderSec: Math.round((Date.now() - t0) / 100) / 10,
          outputPath: outMp4Path,
          bytes: fs.statSync(outMp4Path).size,
        };
      }
      return { rendered: false, error: `render done but missing output at ${renderedSrc}` };
    }
    if (data?.status === "error") {
      return { rendered: false, error: data.error || "render error" };
    }
  }
  return { rendered: false, error: "render timeout" };
}

async function runSingleTrial(condition, runIdx, opts) {
  const label = `${condition}${runIdx}`;
  const runDir = path.join(opts.outDir, label);
  fs.mkdirSync(runDir, { recursive: true });

  const [providerID, ...rest] = opts.model.split("/");
  const modelID = rest.join("/");
  const modelObj = { providerID, modelID, id: modelID };

  const exe = path.join(REPO_ROOT, "target", "debug", process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine");
  if (!fs.existsSync(exe)) throw new Error(`Debug engine missing at ${exe}. Run 'npm run build:engine'.`);

  const port = await findAvailablePort(4880 + runIdx * 3 + (condition === "B" ? 1 : 0));
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const tempWs = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-s6-${label}-ws-`));
  const xdgCfg = setupIsolatedXdgConfig();
  const xdgData = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-s6-${label}-data-`));
  let legacySkillFile = "";
  if (condition === "A") {
    legacySkillFile = path.join(xdgCfg, "legacy-mg-soft-clay-story-SKILL.md");
    const legacyMd = execFileSync("git", ["show", "8ca89ca:.aetheria/skills/mg-soft-clay-story/SKILL.md"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    fs.writeFileSync(legacySkillFile, legacyMd, "utf8");
  }
  let engineLogs = "";

  const eng = spawn(exe, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: tempWs,
    env: {
      ...process.env,
      AETHERIA_ROOT: REPO_ROOT,
      AETHERIA_WORKSPACE: tempWs,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_CLAY_STORY_MODE: condition === "A" ? "legacy" : "story",
      ...(legacySkillFile ? { AETHERIA_LEGACY_SKILL_MD_PATH: legacySkillFile } : {}),
      XDG_CONFIG_HOME: xdgCfg,
      XDG_DATA_HOME: xdgData,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  eng.stdout.on("data", (d) => (engineLogs += d.toString()));
  eng.stderr.on("data", (d) => (engineLogs += d.toString()));

  const startedAt = Date.now();
  try {
    // Wait for health
    const hDeadline = Date.now() + 25_000;
    let healthy = false;
    while (Date.now() < hDeadline) {
      try {
        const hr = await api(baseUrl, "/api/health", { authHeader, timeoutMs: 2500 });
        if (hr.ok && (hr.json?.healthy || hr.json?.data?.healthy)) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!healthy) throw new Error(`Engine failed health check for ${label}`);

    const dirQuery = `directory=${encodeURIComponent(tempWs)}`;
    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: `S6 AB ${label}`, model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Failed creating session for ${label}: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { model: modelObj, prompt: { text: FIXED_BRIEF } },
    });
    if (!postRes.ok) throw new Error(`Prompt rejected for ${label}: ${postRes.text}`);

    let timedOut = false;
    const deadline = Date.now() + opts.turnTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const [mRes, jRes] = await Promise.all([
        api(baseUrl, `/api/session/${sessId}/message?order=asc&${dirQuery}`, { authHeader, timeoutMs: 10_000 }).catch(() => null),
        api(baseUrl, `/api/session/${sessId}/jobs`, { authHeader, timeoutMs: 10_000 }).catch(() => null),
      ]);
      const msgs = extractMessages(mRes?.json);
      const jobs = Array.isArray(jRes?.json?.data) ? jRes.json.data : [];
      const running = jobs.filter((j) => j.status === "running").length;
      if (isTurnFinished(msgs) && running === 0) break;
      if (Date.now() >= deadline) timedOut = true;
    }

    const wallSec = Math.round((Date.now() - startedAt) / 100) / 10;

    // Collect tool call counts & preview errors across all sessions (coordinator + subagents)
    const allSessRes = await api(baseUrl, `/api/session?includeChildren=true&${dirQuery}`, { authHeader });
    const rawSessions = allSessRes.json?.data ?? allSessRes.json;
    const allSessions = Array.isArray(rawSessions) ? rawSessions : [{ id: sessId }];
    let toolSteps = 0;
    let previewRuntimeErrors = [];
    let lastStoryQa = null;
    for (const s of allSessions) {
      const sid = s.id ?? s.info?.id;
      if (!sid) continue;
      const mRes = await api(baseUrl, `/api/session/${sid}/message?order=asc&${dirQuery}`, { authHeader }).catch(() => null);
      for (const m of extractMessages(mRes?.json)) {
        const parts = Array.isArray(m.parts) ? m.parts : Array.isArray(m.content) ? m.content : [];
        for (const p of parts) {
          if (p.type === "tool") {
            toolSteps++;
            const st = p.state?.structured;
            if ((p.tool === "capture_film_preview" || p.name === "capture_film_preview") && st) {
              if (Array.isArray(st.runtimeErrors)) previewRuntimeErrors = st.runtimeErrors;
              if (st.storyQa) lastStoryQa = st.storyQa;
            }
          }
        }
      }
    }

    const projDir = findActiveProjectDir(tempWs);
    const codeStats = measureModelAuthoredCode(projDir, condition);

    // Copy engine contact_sheet.jpg if generated
    const engineSheet = path.join(projDir, ".aetheria", "preview", "contact_sheet.jpg");
    let engineContactSheetPath = null;
    if (fs.existsSync(engineSheet)) {
      engineContactSheetPath = path.join(runDir, "engine_contact_sheet.jpg");
      fs.copyFileSync(engineSheet, engineContactSheetPath);
    }

    // Independent 6-shot Playwright framing & runtime check across project duration
    let evalContactSheetPath = null;
    let outOfSafeZoneShots = null;
    let independentRuntimeErrors = [];
    let avgFrameRenderMs = null;
    if (fs.existsSync(path.join(projDir, "index.html"))) {
      let times = [2.5, 7.5, 12.5, 17.5, 22.5, 27.5];
      const storyPath = path.join(projDir, "story.json");
      if (fs.existsSync(storyPath)) {
        try {
          const sv = JSON.parse(fs.readFileSync(storyPath, "utf8"));
          if (Array.isArray(sv.shots) && sv.shots.length > 0) {
            times = sv.shots.map((sh) => Math.round((Number(sh.start || 0) + Number(sh.duration || 1) * 0.5) * 100) / 100);
          }
        } catch {}
      }
      try {
        const evalDir = path.join(runDir, "eval_frames");
        const { report } = await renderSkillExample({
          dir: projDir,
          html: "index.html",
          outDir: evalDir,
          times,
          contactSheet: true,
          extraScriptRoots: [path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script")],
        });
        evalContactSheetPath = report.contactSheetPath;
        outOfSafeZoneShots = report.summary.outOfSafeZoneCount;
        independentRuntimeErrors = report.runtimeErrors || [];
        avgFrameRenderMs = report.summary.avgRenderMs;
      } catch (e) {
        independentRuntimeErrors = [String(e?.message || e)];
      }
    } else {
      independentRuntimeErrors = ["index.html not generated"];
    }

    // Final MP4 render check
    let renderResult = { rendered: false, skipped: opts.skipMp4 };
    if (!opts.skipMp4 && fs.existsSync(path.join(projDir, "index.html"))) {
      renderResult = await renderProjectMp4(
        baseUrl,
        authHeader,
        dirQuery,
        path.join(runDir, "output.mp4"),
        tempWs,
        opts.renderTimeoutMs,
      );
    }

    // Save project snapshot (story.json / script / index.html) for auditability
    fs.writeFileSync(path.join(runDir, "engine.log"), engineLogs, "utf8");
    const result = {
      label,
      condition,
      runIdx,
      model: opts.model,
      timedOut,
      wallSec,
      toolSteps,
      sessionsCount: allSessions.length,
      ...codeStats,
      customRatio: codeStats.totalShots > 0 ? Math.round((codeStats.customShots / codeStats.totalShots) * 1000) / 1000 : 0,
      runtimeErrorsCount: Math.max(previewRuntimeErrors.length, independentRuntimeErrors.length),
      previewRuntimeErrors,
      independentRuntimeErrors,
      outOfSafeZoneShots,
      avgFrameRenderMs,
      storyQaFailedShots: lastStoryQa?.failedShots ?? null,
      storyQaLintValid: lastStoryQa?.lintValid ?? null,
      finalRenderCompleted: Boolean(renderResult.rendered),
      renderResult,
      contactSheetPath: evalContactSheetPath || engineContactSheetPath,
      engineContactSheetPath,
    };
    fs.writeFileSync(path.join(runDir, "trial_result.json"), JSON.stringify(result, null, 2), "utf8");
    console.log(`[S6_AB ${label}]`, JSON.stringify({
      wallSec: result.wallSec,
      toolSteps: result.toolSteps,
      modelJsLines: result.modelJsLines,
      modelJsChars: result.modelJsChars,
      storyJsonLines: result.storyJsonLines,
      outOfSafeZoneShots: result.outOfSafeZoneShots,
      runtimeErrorsCount: result.runtimeErrorsCount,
      customShots: result.customShots,
      totalShots: result.totalShots,
      finalRenderCompleted: result.finalRenderCompleted,
      contactSheetPath: result.contactSheetPath,
    }));
    return result;
  } finally {
    const exitP = new Promise((r) => eng.once("exit", r));
    eng.kill("SIGKILL");
    await Promise.race([exitP, new Promise((r) => setTimeout(r, 1500))]);
    await new Promise((r) => setTimeout(r, 400));
    for (const dir of [tempWs, xdgCfg, xdgData]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const trials = [];
  for (const cond of opts.conditions) {
    for (let r = 1; r <= opts.runs; r++) {
      const tr = await runSingleTrial(cond, r, opts);
      trials.push(tr);
    }
  }
  const agg = (cond) => {
    const list = trials.filter((t) => t.condition === cond);
    if (list.length === 0) return null;
    const mean = (fn) => {
      const vals = list.map(fn).filter((v) => typeof v === "number" && Number.isFinite(v));
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    };
    return {
      n: list.length,
      meanModelJsLines: mean((t) => t.modelJsLines),
      meanModelJsChars: mean((t) => t.modelJsChars),
      meanStoryJsonLines: mean((t) => t.storyJsonLines),
      meanToolSteps: mean((t) => t.toolSteps),
      meanWallSec: mean((t) => t.wallSec),
      totalRuntimeErrors: list.reduce((s, t) => s + (t.runtimeErrorsCount || 0), 0),
      meanOutOfSafeZoneShots: mean((t) => t.outOfSafeZoneShots),
      meanCustomRatio: mean((t) => t.customRatio),
      finalRenderCompletedCount: list.filter((t) => t.finalRenderCompleted).length,
    };
  };
  const summary = {
    model: opts.model,
    outDir: opts.outDir,
    conditionA: agg("A"),
    conditionB: agg("B"),
    trials,
  };
  const summaryPath = path.join(opts.outDir, "ab_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log("[S6_AB_SUMMARY]", JSON.stringify({ summaryPath, conditionA: summary.conditionA, conditionB: summary.conditionB }, null, 2));
}

main().catch((err) => {
  console.error("[S6_AB] FAILED:", err);
  process.exit(1);
});
