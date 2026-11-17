#!/usr/bin/env node
/**
 * F8 Controlled A/B Proof:
 * Runs 5 fixed video production briefs sequentially against:
 *   - BEFORE baseline (`1efc2b9` worktree dev binary)
 *   - AFTER harness (`HEAD` dev binary)
 * on the same model(s), inside completely isolated tempWorkspace + XDG_DATA_HOME + XDG_CONFIG_HOME.
 * Exports `.mp4` + preview JPEGs under blinded labels (`Sample-X` vs `Sample-Y`) for human inspection,
 * and saves objective process/disk metrics without grading visual quality.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

const BRIEFS = [
  {
    id: "brief-01-soft-clay",
    title: "3D Soft Clay Diorama (Silent Portrait)",
    narrated: false,
    prompt:
      '/mg-soft-clay-story Buatkan video 2 scene berjudul "Ritual Kopi Pagi" (portrait 1080x1920, tanpa voiceover/audio, durasi 3s per scene). Akhiri dengan `capture_film_preview`.',
  },
  {
    id: "brief-02-narrated-solar",
    title: "Flat Vector + Indonesian Voiceover & SFX",
    narrated: true,
    prompt:
      '/mg-flat-vector Buatkan video explainer 2 scene bernarasi Indonesia tentang "Cara Kerja Panel Surya" (portrait 1080x1920). Sintesiskan voiceover Bahasa Indonesia sekitar 10-14 kata per scene lengkap dengan subtitle ter-sync, dan akhiri dengan `capture_film_preview`.',
  },
  {
    id: "brief-03-kinetic-type",
    title: "Kinetic Typography (3 Scenes Portrait)",
    narrated: false,
    prompt:
      '/mg-kinetic-type Buatkan video tipografi kinetik 3 scene berjudul "Tiga Aturan Komposisi" (portrait 1080x1920, tanpa voiceover/audio, durasi 2.5s per scene). Akhiri dengan `capture_film_preview`.',
  },
  {
    id: "brief-04-sci-fi-hud",
    title: "Sci-Fi HUD Telemetry (Landscape 16:9)",
    narrated: false,
    prompt:
      '/mg-sci-fi-hud Buatkan video HUD telemetry 2 scene berjudul "Orbital Docking Scan" (landscape 1920x1080, tanpa voiceover/audio, durasi 3s per scene). Akhiri dengan `capture_film_preview`.',
  },
  {
    id: "brief-05-bauhaus-swiss",
    title: "Bauhaus Swiss Geometric Poster (Portrait)",
    narrated: false,
    prompt:
      '/mg-bauhaus-swiss Buatkan video poster geometris 2 scene berjudul "Geometri Waktu" (portrait 1080x1920, tanpa voiceover/audio, durasi 3s per scene). Akhiri dengan `capture_film_preview`.',
  },
];

function resolveHeadAfterLabel() {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    if (sha) return `after_${sha}`;
  } catch {
    // ignore
  }
  return "after_head";
}

function parseArgs(argv) {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const opts = {
    beforeBin: path.join(os.tmpdir(), "aetheria-f8-before-1efc2b9", "target", "debug", exe),
    afterBin: path.join(REPO_ROOT, "target", "debug", exe),
    afterLabel: resolveHeadAfterLabel(),
    models: (process.env.F8_MODELS || "local-cli/gemini-2.5-flash")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    briefIds: null,
    outDir: path.join(REPO_ROOT, "scripts", "out"),
    timeoutMs: 300_000,
    append: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--before-bin" && argv[i + 1]) opts.beforeBin = path.resolve(argv[++i]);
    else if (a === "--after-bin" && argv[i + 1]) opts.afterBin = path.resolve(argv[++i]);
    else if (a === "--after-label" && argv[i + 1]) opts.afterLabel = argv[++i];
    else if (a === "--models" && argv[i + 1]) {
      opts.models = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--briefs" && argv[i + 1]) {
      opts.briefIds = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--out-dir" && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === "--append") opts.append = true;
  }
  return opts;
}

function findAvailablePort(preferred = 4860) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => {
      const ephem = net.createServer();
      ephem.unref();
      ephem.listen(0, "127.0.0.1", () => {
        const addr = ephem.address();
        const port = typeof addr === "object" && addr ? addr.port : preferred + 1;
        ephem.close(() => resolve(port));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });
}

async function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 30_000 } = {}) {
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
          } catch {
            // non-json
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
  const parts = Array.isArray(last.parts)
    ? last.parts
    : Array.isArray(last.content)
      ? last.content
      : [];
  return !parts.some(
    (p) =>
      (p.type === "tool" || p.type === "tool_use") &&
      (p.state?.status === "running" || p.state?.status === "pending")
  );
}

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs) {
  const sendRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
    method: "POST",
    authHeader,
    timeoutMs: 30_000,
    body: { model: modelObj, prompt: { text } },
  });
  if (!sendRes.ok) {
    throw new Error(`POST prompt failed (${sendRes.status}): ${sendRes.text}`);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const [msgRes, jobsRes] = await Promise.all([
      api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, {
        authHeader,
        timeoutMs: 20_000,
      }),
      api(baseUrl, `/api/session/${sessionID}/jobs`, { authHeader, timeoutMs: 10_000 }).catch(() => null),
    ]);
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    const jobs = jobsRes?.json?.data ?? [];
    const hasRunningJob = Array.isArray(jobs) && jobs.some((j) => j.status === "running");
    if (isTurnFinished(msgs) && !hasRunningJob) {
      await new Promise((r) => setTimeout(r, 800));
      return { msgs, timedOut: false };
    }
  }
  return { msgs: [], timedOut: true };
}

function readWavDurationSec(wavPath) {
  try {
    const buf = fs.readFileSync(wavPath);
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
      const id = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === "fmt " && offset + 8 + 12 <= buf.length) {
        byteRate = buf.readUInt32LE(offset + 16);
      } else if (id === "data") {
        dataSize = size;
      }
      offset += 8 + size + (size % 2);
    }
    if (byteRate > 0 && dataSize > 0) return dataSize / byteRate;
  } catch {
    // ignore
  }
  return null;
}

function isStubContent(content) {
  if (!content.trim()) return true;
  if (content.includes("// TODO: Write deterministic motion design beats here")) return true;
  return (
    content.includes("managed stub by film_scaffold") &&
    content.split(/\r?\n/).length <= 22 &&
    !content.includes("AM.spring") &&
    !content.includes("AM.ease")
  );
}

function analyzeSessionStore(xdgDataDir, filmDir) {
  const storePath = path.join(xdgDataDir, "aetheria-nexus", "sessions-store.json");
  const metrics = {
    rootAssistantSteps: 0,
    subagentCount: 0,
    subagentSteps: 0,
    nonCreativeCalls: 0,
    editCalls: 0,
    editErrors: 0,
    writeCalls: 0,
    todowriteCalls: 0,
    audioDurationOk: null,
    finalAssistantText: "",
    toolCounts: {},
  };

  if (fs.existsSync(storePath)) {
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const sessions = store.sessions || {};
    const messages = store.messages || {};
    for (const [sid, sMeta] of Object.entries(sessions)) {
      const isRoot = !sMeta.parentID;
      if (!isRoot) metrics.subagentCount++;
      const list = messages[sid] || [];
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const role = m.info?.role || m.role;
        if (role === "assistant") {
          if (isRoot) metrics.rootAssistantSteps++;
          else metrics.subagentSteps++;
        }
        const parts = Array.isArray(m.parts) ? m.parts : Array.isArray(m.content) ? m.content : [];
        for (const p of parts) {
          if (p.type === "tool") {
            const name = String(p.tool || p.name || "").toLowerCase();
            metrics.toolCounts[name] = (metrics.toolCounts[name] || 0) + 1;
            const st = p.state?.status;
            const ok = p.state?.structured?.ok !== false && st !== "error";
            if (["read", "glob", "grep", "todowrite", "bash", "codemode", "apply_patch", "websearch"].includes(name)) {
              metrics.nonCreativeCalls++;
            }
            if (name === "todowrite") metrics.todowriteCalls++;
            if (name === "write") metrics.writeCalls++;
            if (name === "edit") {
              metrics.editCalls++;
              if (!ok) metrics.editErrors++;
            }
          } else if (isRoot && role === "assistant" && p.type === "text" && p.text) {
            metrics.finalAssistantText = p.text;
          }
        }
        if (role === "assistant" && Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const name = String(tc.function?.name || "").toLowerCase();
            metrics.toolCounts[name] = (metrics.toolCounts[name] || 0) + 1;
            if (["read", "glob", "grep", "todowrite", "bash", "codemode", "apply_patch", "websearch"].includes(name)) {
              metrics.nonCreativeCalls++;
            }
            if (name === "todowrite") metrics.todowriteCalls++;
            if (name === "write") metrics.writeCalls++;
            if (name === "edit") {
              metrics.editCalls++;
              const tr = list.slice(i + 1).find((x) => x.role === "tool" && x.tool_call_id === tc.id);
              try {
                const parsed = JSON.parse(tr?.content || "{}");
                if (parsed.ok === false) metrics.editErrors++;
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }
  }

  let diskScenesTotal = 0;
  let diskStubCount = 0;
  let diskMissingCount = 0;
  let audioChecked = 0;
  let audioValid = true;
  if (filmDir && fs.existsSync(filmDir)) {
    const manifestPath = path.join(filmDir, "film.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const mf = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const scenes = Array.isArray(mf.scenes) ? mf.scenes : [];
        diskScenesTotal = scenes.length;
        for (const sc of scenes) {
          const sp = path.join(filmDir, String(sc.script || ""));
          if (!fs.existsSync(sp)) diskMissingCount++;
          else if (isStubContent(fs.readFileSync(sp, "utf8"))) diskStubCount++;
          if (sc.audio) {
            const wavPath = path.join(filmDir, String(sc.audio).replace(/^\/+/, ""));
            const wavDur = readWavDurationSec(wavPath);
            if (wavDur != null) {
              audioChecked++;
              if (Number(sc.duration || 0) < wavDur - 0.05) audioValid = false;
            }
          }
        }
      } catch {
        // ignore
      }
    } else {
      const sdir = path.join(filmDir, "script");
      if (fs.existsSync(sdir)) {
        const sceneJs = fs.readdirSync(sdir).filter((f) => /^scene\d*\.js$/i.test(f));
        diskScenesTotal = sceneJs.length;
        for (const f of sceneJs) {
          if (isStubContent(fs.readFileSync(path.join(sdir, f), "utf8"))) diskStubCount++;
        }
      }
    }
  }
  if (audioChecked > 0) metrics.audioDurationOk = audioValid;

  const editFailRatePct =
    metrics.editCalls > 0 ? Number(((metrics.editErrors / metrics.editCalls) * 100).toFixed(1)) : 0;
  const incompleteWork = metrics.editErrors > 0 || diskStubCount > 0 || diskMissingCount > 0;
  const falseCompletionClaim =
    incompleteWork &&
    metrics.finalAssistantText.length > 0 &&
    !metrics.finalAssistantText.includes("[Verification notice:");

  return {
    ...metrics,
    editFailRatePct,
    diskScenesTotal,
    diskStubCount,
    diskMissingCount,
    falseCompletionClaim,
  };
}

async function renderProjectMp4(baseUrl, authHeader, dirQuery, outMp4Path, tempWorkspace) {
  const outputName = `f8-${crypto.randomBytes(4).toString("hex")}.mp4`;
  const startRes = await api(baseUrl, `/api/render-media?${dirQuery}`, {
    method: "POST",
    authHeader,
    timeoutMs: 30_000,
    body: {
      compositionId: "HtmlMotionFilm",
      codec: "h264",
      outputName,
    },
  });
  const renderId = startRes.json?.renderId || startRes.json?.data?.renderId;
  if (!startRes.ok || !renderId) {
    return { rendered: false, error: `render-media HTTP ${startRes.status}: ${startRes.text}` };
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 180_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const prog = await api(baseUrl, `/api/render-progress?renderId=${encodeURIComponent(renderId)}&${dirQuery}`, {
      authHeader,
      timeoutMs: 10_000,
    }).catch(() => null);
    const data = prog?.json?.data ?? prog?.json;
    if (data?.status === "done") {
      const renderedSrc = data.outputPath && fs.existsSync(data.outputPath)
        ? data.outputPath
        : path.join(tempWorkspace, "out", outputName);
      if (renderedSrc && fs.existsSync(renderedSrc)) {
        fs.copyFileSync(renderedSrc, outMp4Path);
        return { rendered: true, outputPath: outMp4Path };
      }
      return { rendered: false, error: `render done but missing output at ${renderedSrc}` };
    }
    if (data?.status === "error") {
      return { rendered: false, error: data.error || "render error" };
    }
  }
  return { rendered: false, error: "render timeout" };
}

function setupIsolatedXdgConfig() {
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f8-cfg-"));
  const cfgSubdir = path.join(xdgDir, "aetheria-nexus");
  fs.mkdirSync(cfgSubdir, { recursive: true });
  const srcCfg = path.join(os.homedir(), ".config", "aetheria-nexus", "aetheria.json");
  const baseCfg = fs.existsSync(srcCfg) ? JSON.parse(fs.readFileSync(srcCfg, "utf8")) : {};
  // Ensure clean benchmark with zero custom /agent overrides beyond branch code defaults
  delete baseCfg.agent;
  delete baseCfg.context;
  fs.writeFileSync(path.join(cfgSubdir, "aetheria.json"), JSON.stringify(baseCfg, null, 2), "utf8");
  return xdgDir;
}

async function runSingleEval({ branchLabel, engineBin, modelSpec, brief, collectDir, timeoutMs }) {
  if (!fs.existsSync(engineBin)) {
    throw new Error(`Engine binary missing for ${branchLabel}: ${engineBin}`);
  }
  const [providerID, ...rest] = modelSpec.split("/");
  const modelID = rest.join("/");
  const modelObj = { providerID, modelID, id: modelID };

  const port = await findAvailablePort(4860);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-f8-ws-${branchLabel}-`));
  const xdgConfig = setupIsolatedXdgConfig();
  const xdgData = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-f8-data-${branchLabel}-`));
  const engineLogs = [];
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
  engine.stdout.on("data", (d) => engineLogs.push(d.toString()));
  engine.stderr.on("data", (d) => engineLogs.push(d.toString()));

  const dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
  const createdSessions = [];

  try {
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await api(baseUrl, "/api/health", { authHeader, timeoutMs: 5_000 });
        if (res.ok && (res.json?.data?.healthy ?? res.json?.healthy)) {
          healthy = true;
          break;
        }
      } catch {
        // retry
      }
    }
    if (!healthy) throw new Error(`Health failed for ${branchLabel}:\n${engineLogs.join("")}`);

    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: `F8 ${branchLabel} ${brief.id}`, model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    createdSessions.push(sessId);

    const t0 = Date.now();
    const { timedOut } = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      sessId,
      brief.prompt,
      modelObj,
      timeoutMs
    );
    const wallTimeSec = Number(((Date.now() - t0) / 1000).toFixed(1));

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    let htmlPath = filmMeta?.htmlPath;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      const rootHtml = path.join(tempWorkspace, "index.html");
      if (fs.existsSync(rootHtml)) {
        htmlPath = rootHtml;
      } else if (fs.existsSync(path.join(tempWorkspace, "projects"))) {
        for (const ent of fs.readdirSync(path.join(tempWorkspace, "projects"), { withFileTypes: true })) {
          if (ent.isDirectory()) {
            const cand = path.join(tempWorkspace, "projects", ent.name, "index.html");
            if (fs.existsSync(cand)) {
              htmlPath = cand;
              break;
            }
          }
        }
      }
    }
    const filmDir = htmlPath ? path.dirname(htmlPath) : "";
    const lintValid = filmMeta?.lint?.valid === true;

    let renderResult = { rendered: false, error: "no valid htmlPath" };
    if (htmlPath && fs.existsSync(htmlPath)) {
      fs.mkdirSync(collectDir, { recursive: true });
      const outMp4 = path.join(collectDir, "output.mp4");
      renderResult = await renderProjectMp4(baseUrl, authHeader, dirQuery, outMp4, tempWorkspace);

      const prevDir = path.join(filmDir, ".aetheria", "preview");
      if (fs.existsSync(prevDir)) {
        for (const f of fs.readdirSync(prevDir)) {
          if (f.endsWith(".jpg") || f.endsWith(".png")) {
            fs.copyFileSync(path.join(prevDir, f), path.join(collectDir, f));
          }
        }
      }
    }

    const storeMetrics = analyzeSessionStore(xdgData, filmDir);
    return {
      branchLabel,
      model: modelSpec,
      briefId: brief.id,
      timedOut,
      wallTimeSec,
      lintValid,
      renderResult,
      ...storeMetrics,
    };
  } finally {
    for (const sid of createdSessions) {
      await api(baseUrl, `/api/session/${sid}?${dirQuery}`, { method: "DELETE", authHeader }).catch(() => {});
    }
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

function writeOutputs(outDir, rows, unblindKey) {
  fs.writeFileSync(path.join(outDir, "f8-ab-results.json"), JSON.stringify(rows, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "f8-unblind-key.json"), JSON.stringify(unblindKey, null, 2), "utf8");

  const reportLines = [
    "# F8 Controlled A/B Objective Metrics (`1efc2b9` Before vs Final Harness)",
    "",
    "> Visual & motion quality is NOT scored by the agent. Inspect rendered videos & preview frames under blinded labels (`Sample-X` vs `Sample-Y`) first; open `scripts/out/f8-unblind-key.json` only after human scoring.",
    "",
    "| Model | Brief | Branch | Wall(s) | Root Steps | Subagents | Sub Steps | Non-Creative Tools | Edit (err/total) | Ending Stub/Miss | False Claim | Lint | MP4 Rendered | Audio OK |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|",
  ];
  for (const r of rows) {
    reportLines.push(
      `| \`${r.model}\` | \`${r.briefId}\` | \`${r.branchLabel}\` | ${r.wallTimeSec} | ${r.rootAssistantSteps} | ${r.subagentCount} | ${r.subagentSteps} | ${r.nonCreativeCalls} | ${r.editErrors}/${r.editCalls} | ${r.diskStubCount}/${r.diskMissingCount} | ${r.falseCompletionClaim} | ${r.lintValid} | ${r.renderResult?.rendered === true} | ${r.audioDurationOk ?? "-"} |`
    );
  }

  reportLines.push("", "## Blind Evaluation Pairs (Human Visual Scorecard)", "");
  for (const pair of unblindKey) {
    reportLines.push(`### ${pair.briefId} — ${pair.briefTitle} (\`${pair.model}\`)`);
    reportLines.push(`- **Sample-X:** \`${pair.sampleXDir}\``);
    reportLines.push(`- **Sample-Y:** \`${pair.sampleYDir}\``);
    reportLines.push("- Human Preference (`Sample-X` / `Sample-Y` / Tie) + Notes: _[TBD by human evaluator]_");
    reportLines.push("");
  }

  const mdPath = path.join(outDir, "f8-ab-metrics.md");
  fs.writeFileSync(mdPath, reportLines.join("\n"), "utf8");
  return mdPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const blindRoot = path.join(opts.outDir, "f8-blind");
  fs.mkdirSync(blindRoot, { recursive: true });

  const resultsPath = path.join(opts.outDir, "f8-ab-results.json");
  const keyPath = path.join(opts.outDir, "f8-unblind-key.json");
  const rows = opts.append && fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, "utf8")) : [];
  const unblindKey = opts.append && fs.existsSync(keyPath) ? JSON.parse(fs.readFileSync(keyPath, "utf8")) : [];

  const selectedBriefs = opts.briefIds?.length
    ? BRIEFS.filter((b) => opts.briefIds.includes(b.id))
    : BRIEFS;

  for (const modelSpec of opts.models) {
    const mSlug = modelSpec.replace(/[^a-z0-9._-]+/gi, "_");
    for (const brief of selectedBriefs) {
      const pairRoot = path.join(blindRoot, mSlug, brief.id);
      fs.rmSync(pairRoot, { recursive: true, force: true });

      const beforeIsX = crypto.randomInt(2) === 0;
      const beforeLabel = beforeIsX ? "Sample-X" : "Sample-Y";
      const afterLabel = beforeIsX ? "Sample-Y" : "Sample-X";

      console.log(`[F8] Running BEFORE (${opts.beforeBin}) | ${modelSpec} | ${brief.id} -> ${beforeLabel}`);
      const beforeDir = path.join(pairRoot, beforeLabel);
      const beforeRes = await runSingleEval({
        branchLabel: "before_1efc2b9",
        engineBin: opts.beforeBin,
        modelSpec,
        brief,
        collectDir: beforeDir,
        timeoutMs: opts.timeoutMs,
      });
      console.log(`[F8] BEFORE done:`, JSON.stringify({ wallTimeSec: beforeRes.wallTimeSec, lintValid: beforeRes.lintValid, stubs: beforeRes.diskStubCount, editErrors: beforeRes.editErrors, rendered: beforeRes.renderResult?.rendered }));

      console.log(`[F8] Running AFTER (${opts.afterBin}) [${opts.afterLabel}] | ${modelSpec} | ${brief.id} -> ${afterLabel}`);
      const afterDir = path.join(pairRoot, afterLabel);
      const afterRes = await runSingleEval({
        branchLabel: opts.afterLabel,
        engineBin: opts.afterBin,
        modelSpec,
        brief,
        collectDir: afterDir,
        timeoutMs: opts.timeoutMs,
      });
      console.log(`[F8] AFTER done:`, JSON.stringify({ wallTimeSec: afterRes.wallTimeSec, lintValid: afterRes.lintValid, stubs: afterRes.diskStubCount, editErrors: afterRes.editErrors, rendered: afterRes.renderResult?.rendered }));

      const keepRow = (r) => !(r.model === modelSpec && r.briefId === brief.id);
      const filteredRows = rows.filter(keepRow);
      rows.length = 0;
      rows.push(...filteredRows, beforeRes, afterRes);

      const filteredKey = unblindKey.filter(keepRow);
      unblindKey.length = 0;
      unblindKey.push(...filteredKey, {
        model: modelSpec,
        briefId: brief.id,
        briefTitle: brief.title,
        sampleXDir: path.join(pairRoot, "Sample-X"),
        sampleYDir: path.join(pairRoot, "Sample-Y"),
        sampleXBranch: beforeIsX ? "before_1efc2b9" : opts.afterLabel,
        sampleYBranch: beforeIsX ? opts.afterLabel : "before_1efc2b9",
      });
      writeOutputs(opts.outDir, rows, unblindKey);
    }
  }

  const mdPath = writeOutputs(opts.outDir, rows, unblindKey);
  console.log("[F8_EVAL_COMPLETE]", mdPath);
}

main().catch((err) => {
  console.error("[F8_EVAL_FATAL]", err);
  process.exit(1);
});
