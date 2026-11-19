#!/usr/bin/env node
/**
 * Live E2E test against a running (or auto-spawned debug) `aetheria-engine`:
 * Sends a real prompt invoking a declarative `mg-*` skill (default: `mg-aurora-glass`),
 * waits for the LLM agent turn to finish in an isolated `os.tmpdir()` workspace,
 * inspects generated `story.json` (canonical Dialect A), `kit.json`, and scripts,
 * renders the generated project via headless Playwright (`render-skill-example.mjs`),
 * and reports pass/fail metrics.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderSkillExample, deriveShotMidpointsFromStory } from "./render-skill-example.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PASSWORD_FILE = path.join(os.homedir(), ".aetheria", "dev-server-password");
const PORT = process.env.AETHERIA_PORT || "4196";
const HEALTH_URL = process.env.AETHERIA_HEALTH || `http://127.0.0.1:${PORT}/api/health`;
const BASE_URL = process.env.AETHERIA_API || `http://127.0.0.1:${PORT}/api`;

function parseArgs(argv) {
  const opts = {
    skill: "mg-aurora-glass",
    provider: process.env.AETHERIA_TEST_PROVIDER || "",
    model: process.env.AETHERIA_TEST_MODEL || "",
    timeoutMs: 240_000,
    keepTemp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && argv[i + 1]) opts.skill = argv[++i];
    else if (argv[i] === "--provider" && argv[i + 1]) opts.provider = argv[++i];
    else if (argv[i] === "--model" && argv[i + 1]) opts.model = argv[++i];
    else if (argv[i] === "--timeout-ms" && argv[i + 1]) opts.timeoutMs = Number(argv[++i]) || 240_000;
    else if (argv[i] === "--keep-temp") opts.keepTemp = true;
  }
  return opts;
}

function getAuthHeaders() {
  try {
    const raw = fs.readFileSync(PASSWORD_FILE, "utf8").trim();
    if (raw.includes(":")) {
      return { Authorization: `Basic ${Buffer.from(raw).toString("base64")}` };
    }
  } catch {}
  return {};
}

async function isEngineHealthy() {
  try {
    const res = await fetch(HEALTH_URL, { headers: getAuthHeaders(), signal: AbortSignal.timeout(3000) });
    const j = await res.json().catch(() => ({}));
    return j?.healthy === true;
  } catch {
    return false;
  }
}

async function ensureEngineRunning() {
  if (await isEngineHealthy()) {
    return { proc: null, startedByUs: false };
  }
  const serverAuth = require(path.join(REPO_ROOT, "scripts", "server-auth.cjs"));
  const auth = serverAuth.create();
  const exeName = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const debugBin = path.join(REPO_ROOT, "target", "debug", exeName);
  if (!fs.existsSync(debugBin)) {
    throw new Error(`Debug engine binary not found at ${debugBin}. Run 'npm run build:engine' first.`);
  }
  const proc = spawn(debugBin, ["serve", "--port", PORT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...auth.engineEnv },
    stdio: "pipe",
    windowsHide: true,
    shell: false,
  });
  proc.stdout?.on("data", (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      const t = line.trim();
      if (t && /agent|llm|tool|story|error|warn|turn|skill|scaffold|preview|stream|provider|http/i.test(t)) {
        console.log("[engine:out]", t.slice(0, 220));
      }
    }
  });
  proc.stderr?.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error("[engine:err]", line.slice(0, 220));
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isEngineHealthy()) return { proc, startedByUs: true };
    await new Promise((r) => setTimeout(r, 800));
  }
  proc.kill();
  throw new Error("Timed out waiting for debug aetheria-engine to become healthy.");
}

async function pickProviderAndModel(headers, explicitProvider, explicitModel) {
  if (explicitProvider && explicitModel) {
    return { providerID: explicitProvider, id: explicitModel };
  }
  try {
    const res = await fetch(`${BASE_URL}/config`, { headers });
    if (res.ok) {
      const cfg = await res.json();
      const providers = cfg?.provider && typeof cfg.provider === "object" ? Object.entries(cfg.provider) : [];
      const active = providers
        .filter(([, p]) => p && p.active !== false && p.models && Object.keys(p.models).length > 0)
        .sort((a, b) => Number(a[1].priority || 99) - Number(b[1].priority || 99));
      for (const [pid, p] of active) {
        if (explicitProvider && pid !== explicitProvider) continue;
        const modelIds = Object.keys(p.models || {});
        const chosen = explicitModel || p.defaultModel || modelIds.find((m) => /flash/i.test(m)) || modelIds[0];
        if (chosen) return { providerID: pid, id: chosen };
      }
    }
  } catch {}
  return {
    providerID: explicitProvider || "kenari",
    id: explicitModel || "nemotron-3-super-120b-a12b:free",
  };
}

function findStoryJsonRecursive(rootDir) {
  const results = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".aetheria" || ent.name === "node_modules") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.name === "story.json") results.push(full);
    }
  }
  walk(rootDir, 0);
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-e2e-${opts.skill}-`));
  const { proc, startedByUs } = await ensureEngineRunning();
  const headers = { "Content-Type": "application/json", ...getAuthHeaders() };
  const query = `?directory=${encodeURIComponent(testDir)}`;
  const t0 = Date.now();

  try {
    const model = await pickProviderAndModel(headers, opts.provider, opts.model);
    console.log(JSON.stringify({ step: "start", skill: opts.skill, model, testDir }));

    const sRes = await fetch(`${BASE_URL}/session${query}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ location: { directory: testDir }, model }),
    });
    const sJson = await sRes.json();
    const sessionId = sJson?.data?.id;
    if (!sessionId) throw new Error(`Create session failed: ${JSON.stringify(sJson)}`);

    const promptText = `/${opts.skill} Buat cerita motion pendek 12 detik (3 shot, masing-masing 4 detik, format 9:16 1080x1920 30fps) tentang "Kopi Pagi Nusantara: dari biji pilihan hingga seduhan hangat". Gunakan jalur deklaratif story.json (Dialect A: canvas {w,h,fps}, shots dengan start & duration, captions {enabled:true, items}). Tanpa audio/voiceover dulu agar cepat, langsung tulis story.json lalu preview/verifikasi.`;

    const pRes = await fetch(`${BASE_URL}/session/${sessionId}/prompt${query}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: { text: promptText } }),
    });
    const pJson = await pRes.json().catch(() => ({}));
    if (!pRes.ok || pJson?.error) {
      throw new Error(`Prompt failed (${pRes.status}): ${JSON.stringify(pJson)}`);
    }

    // Poll session status & messages until idle or timeout
    let lastStatus = "";
    let finalAssistantText = "";
    let toolCalls = [];
    let lastMsgs = [];
    const deadline = Date.now() + opts.timeoutMs;
    let sawBusy = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const stRes = await fetch(`${BASE_URL}/session/${sessionId}${query}`, { headers });
      const stJson = await stRes.json().catch(() => ({}));
      const status = stJson?.data?.status || stJson?.status || "";
      if (status !== lastStatus) {
        console.log(`[poll ${Math.round((Date.now() - t0) / 1000)}s] status=${status}`);
        lastStatus = status;
      }
      if (status === "running" || status === "busy" || status === "streaming") sawBusy = true;

      const mRes = await fetch(`${BASE_URL}/session/${sessionId}/message${query}`, { headers });
      const mJson = await mRes.json().catch(() => ({}));
      const msgs = Array.isArray(mJson?.data) ? mJson.data : [];
      lastMsgs = msgs;
      const assistants = msgs.filter((m) => m?.type === "assistant" || m?.role === "assistant");
      toolCalls = [];
      let hasFinishedAssistant = false;
      for (const am of assistants) {
        if (am?.time?.completed || am?.finishedAt || am?.status === "completed") {
          hasFinishedAssistant = true;
        }
        const parts = Array.isArray(am.content) ? am.content : Array.isArray(am.parts) ? am.parts : [];
        for (const c of parts) {
          if (c?.type === "tool_use" || c?.type === "tool-invocation" || c?.type === "tool" || c?.toolName || c?.name) {
            toolCalls.push(c.name || c.toolName || c.tool || c.type);
          }
          if (c?.type === "text" && c?.text?.trim()) {
            finalAssistantText = c.text.trim();
          }
        }
      }

      const storyNow = findStoryJsonRecursive(testDir);
      if (toolCalls.length > 0 || storyNow.length > 0) {
        console.log(`[poll ${Math.round((Date.now() - t0) / 1000)}s] tools=${toolCalls.length} (${toolCalls.slice(-3).join(",")}) stories=${storyNow.length} replyLen=${finalAssistantText.length}`);
      }

      // Only stop when session is NOT running AND either assistant has final text or completed with error
      const hasError = assistants.some((am) => am?.error || am?.status === "error");
      const isDone =
        (status !== "running" && status !== "busy" && status !== "streaming") &&
        (hasError || (finalAssistantText.length > 0 && (hasFinishedAssistant || sawBusy || storyNow.length > 0)));
      if (isDone) break;
    }

    const storyFiles = findStoryJsonRecursive(testDir);
    let storyParsed = null;
    let dialectACheck = null;
    let renderSummary = null;

    if (storyFiles.length > 0) {
      const storyFile = storyFiles[0];
      const projectDir = path.dirname(storyFile);
      storyParsed = JSON.parse(fs.readFileSync(storyFile, "utf8"));
      dialectACheck = {
        storyFile,
        hasCanvas: Boolean(storyParsed.canvas && storyParsed.canvas.w && storyParsed.canvas.h && storyParsed.canvas.fps),
        hasCaptionsEnabled: typeof storyParsed?.captions?.enabled === "boolean",
        shotCount: Array.isArray(storyParsed.shots) ? storyParsed.shots.length : 0,
        allShotsHaveStartDuration:
          Array.isArray(storyParsed.shots) &&
          storyParsed.shots.every((s) => typeof s.start === "number" && typeof s.duration === "number"),
        hasKitJson: fs.existsSync(path.join(projectDir, "kit.json")),
        hasIndexOrStoryHtml:
          fs.existsSync(path.join(projectDir, "index.html")) || fs.existsSync(path.join(projectDir, "story.html")),
      };

      const htmlName = fs.existsSync(path.join(projectDir, "index.html"))
        ? "index.html"
        : fs.existsSync(path.join(projectDir, "story.html"))
          ? "story.html"
          : null;
      if (htmlName) {
        const renderOut = path.join(testDir, "_e2e_render");
        const times = deriveShotMidpointsFromStory(projectDir);
        const { report } = await renderSkillExample({
          dir: projectDir,
          html: htmlName,
          outDir: renderOut,
          times,
          contactSheet: opts.keepTemp,
          microstock: false,
          extraScriptRoots: [path.join(REPO_ROOT, ".aetheria", "skills", opts.skill, "examples", "script")],
        });
        renderSummary = { ...report.summary, contactSheetPath: report.contactSheetPath, outDir: renderOut };
      }
    }

    const result = {
      ok: Boolean(dialectACheck?.hasCanvas && dialectACheck?.allShotsHaveStartDuration && (renderSummary ? renderSummary.runtimeErrorsCount === 0 : true)),
      skill: opts.skill,
      model,
      elapsedSec: Math.round((Date.now() - t0) / 100) / 10,
      lastStatus,
      toolCallsCount: toolCalls.length,
      toolCalls: toolCalls.slice(0, 30),
      dialectACheck,
      renderSummary,
      assistantReplySnippet: finalAssistantText.slice(0, 600),
      debugLastMsg: !dialectACheck ? lastMsgs.slice(-2) : undefined,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    if (startedByUs && proc) {
      proc.kill();
    }
    if (!opts.keepTemp) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("[test-declarative-story-e2e] FAILED:", err);
  process.exit(1);
});
