#!/usr/bin/env node
/**
 * Live 9Router (`ComboMaut`, variant `high`) E2E Session Runner matching the real OpenCode session (`ses_e042c3d63ffeCdZdJFUFQZU8cJ`):
 *   Turn #1: "kalau kamu ku suruh buat kan video berbasis kode js dan html ini contohnya https://pin.it/byKoQ42rJ apa yang kamu lakukan?"
 *   Turn #2: "coba buat kamu aja buat tema nya tapi aku mau yang mirip banget ga perlu audio"
 *
 * Usage: node scripts/test-live-9router-opencode-e2e.mjs
 * Requires local 9Router gateway reachable (reads baseURL + apiKey from `~/.config/opencode/opencode.json` in memory; never logs secrets).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startLiveStack } from "../e2e/live-stack.mjs";

const ARTIFACT_SCRATCH_DIR =
  "C:\\Users\\AMD\\.gemini\\antigravity\\brain\\c45f00c3-99e0-4e1a-9a15-95af61428086\\scratch\\live-9router-run";

function loadNineRouterConfig() {
  const ocCfgPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  let baseURL = process.env.NINEROUTER_BASE_URL || "http://127.0.0.1:20128/v1";
  let apiKey = process.env.NINEROUTER_API_KEY || "";

  if (fs.existsSync(ocCfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(ocCfgPath, "utf8"));
      const r9 = cfg?.provider?.["9router"];
      if (r9?.options?.baseURL) {
        baseURL = String(r9.options.baseURL).trim();
      }
      if (!apiKey && r9?.options?.apiKey) {
        apiKey = String(r9.options.apiKey).trim();
      }
    } catch {
      // fall through to env defaults
    }
  }
  return { baseURL, apiKey };
}

async function api(baseUrl, urlPath, { method = "GET", authHeader, body } = {}) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

function extractMessages(msgPayload) {
  const raw = msgPayload?.data ?? msgPayload;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.messages)) return raw.messages;
  return [];
}

function messageParts(msg) {
  if (Array.isArray(msg?.parts)) return msg.parts;
  if (Array.isArray(msg?.content)) return msg.content;
  return [];
}

function isTurnFinished(messages, minAssistantCount) {
  const assistants = messages.filter((m) => (m.info?.role ?? m.role) === "assistant");
  if (assistants.length < minAssistantCount) return false;
  return assistants.every((m) => {
    const info = m.info ?? m;
    if (!info.time?.completed && !info.error && !info.finish) return false;
    const parts = messageParts(m);
    return !parts.some(
      (p) =>
        (p.type === "tool" || p.type === "tool_use") &&
        (p.state?.status === "running" || p.state?.status === "pending")
    );
  });
}

function summarizeSessionTelemetry(messages) {
  const toolCounts = {};
  const blockedTools = [];
  const failedTools = [];
  let totalToolCalls = 0;
  let lastToolLabel = "";
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let sawEmergencyHeal = false;

  for (const m of messages) {
    const rawStr = JSON.stringify(m);
    if (rawStr.includes("[Emergency Context Auto-Heal]")) {
      sawEmergencyHeal = true;
    }
    const info = m.info ?? m;
    const tok = info.tokens || {};
    totalTokensIn += Number(tok.input || 0);
    totalTokensOut += Number(tok.output || 0);
    totalReasoning += Number(tok.reasoning || 0);
    totalCacheRead += Number(tok.cache?.read || 0);

    for (const p of messageParts(m)) {
      if (p?.type === "tool" || p?.type === "tool_use") {
        totalToolCalls += 1;
        const name = p.name || "unknown";
        toolCounts[name] = (toolCounts[name] || 0) + 1;
        const status = p.state?.status || "unknown";
        lastToolLabel = `${name}:${status}`;
        if (p.state?.structured?.blocked) {
          blockedTools.push({ id: p.id, name, error: p.state?.structured?.error });
        } else if (status === "error" || p.state?.structured?.ok === false) {
          failedTools.push({
            id: p.id,
            name,
            error: String(p.state?.structured?.error || "").slice(0, 260),
          });
        }
      }
    }
  }

  return {
    assistantCount: messages.filter((m) => (m.info?.role ?? m.role) === "assistant").length,
    totalToolCalls,
    toolCounts,
    blockedTools,
    failedTools,
    lastToolLabel,
    tokens: {
      input: totalTokensIn,
      output: totalTokensOut,
      reasoning: totalReasoning,
      cacheRead: totalCacheRead,
    },
    sawEmergencyHeal,
  };
}

async function sendAndWaitTurn(
  baseUrl,
  authHeader,
  dirQuery,
  sessionID,
  text,
  modelObj,
  turnLabel,
  timeoutMs
) {
  const preRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}&order=asc&limit=500`, {
    authHeader,
  });
  const prevAssistants = extractMessages(preRes.json).filter(
    (m) => (m.info?.role ?? m.role) === "assistant"
  ).length;

  const t0 = Date.now();
  const promptRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
    method: "POST",
    authHeader,
    body: {
      model: modelObj,
      prompt: { text },
    },
  });
  assert.ok(promptRes.ok, `${turnLabel} POST prompt failed: ${promptRes.status} ${promptRes.text}`);

  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const [activeRes, msgRes] = await Promise.all([
      api(baseUrl, `/api/session/active`, { authHeader }),
      api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}&order=asc&limit=500`, {
        authHeader,
      }),
    ]);
    const isActive = Boolean(activeRes.json?.data?.[sessionID]);
    const msgs = extractMessages(msgRes.json);
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    if (Date.now() - lastLogAt >= 15_000) {
      lastLogAt = Date.now();
      const tel = summarizeSessionTelemetry(msgs);
      const lastFail =
        tel.failedTools.length > 0 ? tel.failedTools[tel.failedTools.length - 1] : null;
      const failNote = lastFail
        ? ` | lastFail=${lastFail.name}:${String(lastFail.error || "").replace(/\s+/g, " ").slice(0, 110)}`
        : "";
      console.log(
        `[live-9router] ${turnLabel} active=${isActive} t=${elapsedSec}s assistants=${tel.assistantCount} tools=${tel.totalToolCalls} failed=${tel.failedTools.length} (${tel.lastToolLabel || "thinking"}) tokensOut=${tel.tokens.output}${failNote}`
      );
    }
    if (!isActive && isTurnFinished(msgs, prevAssistants + 1)) {
      const tel = summarizeSessionTelemetry(msgs);
      const lastAssistant = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant").pop();
      const textOut = messageParts(lastAssistant)
        .filter((p) => p?.type === "text")
        .map((p) => String(p.text || ""))
        .join("\n");
      console.log(
        `[live-9router] ${turnLabel} DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s | tools=${tel.totalToolCalls} ${JSON.stringify(tel.toolCounts)} | blocked=${tel.blockedTools.length} failed=${tel.failedTools.length} | finish=${lastAssistant?.finish || lastAssistant?.error || "done"}`
      );
      return { msgs, tel, textOut, elapsedMs: Date.now() - t0 };
    }
  }
  const latestMsgs = extractMessages(
    (await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}&order=asc&limit=500`, { authHeader })).json
  );
  const tel = summarizeSessionTelemetry(latestMsgs);
  throw new Error(
    `${turnLabel} timed out after ${Math.round(timeoutMs / 1000)}s | telemetry=${JSON.stringify(tel)}`
  );
}

function findWorkspaceFiles(rootDir) {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(full);
      } else {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

async function capturePlaywrightFallbackFrames(htmlPath, outDir) {
  const htmlText = fs.readFileSync(htmlPath, "utf8");
  const wMatch = htmlText.match(/width\s*[:=]\s*(\d{3,4})/);
  const hMatch = htmlText.match(/height\s*[:=]\s*(\d{3,4})/);
  const width = Math.max(320, Math.min(1920, Number(wMatch?.[1] || 720)));
  const height = Math.max(320, Math.min(1920, Number(hMatch?.[1] || 1280)));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const meta = await page.evaluate(() => ({
      hasRenderAt: typeof window.renderAt === "function",
      filmMeta: window.__filmMeta || window.AETHERIA_FILM || null,
      ready: Boolean(window.__ready),
    }));
    const dur = Number(meta?.filmMeta?.duration || 10);
    const times = [0.1, 0.35, 0.6, 0.85].map((r) => Number((dur * r).toFixed(2)));
    const saved = [];
    for (let i = 0; i < times.length; i++) {
      if (meta.hasRenderAt) {
        await page.evaluate((t) => window.renderAt(t), times[i]);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      const dest = path.join(outDir, `fallback_preview_${i}.jpg`);
      await page.screenshot({ path: dest, type: "jpeg", quality: 88 });
      saved.push(dest);
    }
    return { meta, saved };
  } finally {
    await browser.close();
  }
}

function redactSensitiveLogs(raw) {
  return String(raw || "")
    .replace(/(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._+/=-]{8,}/gi, "$1 [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})/g, "[REDACTED_KEY]")
    .replace(/("apiKey"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
}

async function saveLiveRunArtifacts({
  wsDir,
  sessionID,
  turn1Result,
  turn2Result,
  fallbackMessages,
  runError,
  engineLogs,
}) {
  fs.mkdirSync(ARTIFACT_SCRATCH_DIR, { recursive: true });
  const allFiles = findWorkspaceFiles(wsDir);
  const htmlFiles = allFiles.filter((f) => path.basename(f).toLowerCase() === "index.html");
  const previewJpgs = allFiles.filter(
    (f) => f.replace(/\\/g, "/").includes("/.aetheria/preview/") && /\.(jpg|jpeg|png)$/i.test(f)
  );

  const msgs = turn2Result?.msgs || fallbackMessages || [];
  const tel = turn2Result?.tel || summarizeSessionTelemetry(msgs);
  const savedSummary = {
    sessionId: sessionID,
    status: runError ? "error" : "ok",
    error: runError ? String(runError instanceof Error ? runError.message : runError) : null,
    turn1ElapsedMs: turn1Result?.elapsedMs ?? null,
    turn2ElapsedMs: turn2Result?.elapsedMs ?? null,
    telemetry: tel,
    htmlFiles: htmlFiles.map((f) => ({
      rel: path.relative(wsDir, f).replace(/\\/g, "/"),
      bytes: fs.statSync(f).size,
    })),
    previewFilesCount: previewJpgs.length,
    copiedPreviews: [],
    copiedHtmlPath: null,
    renderedFallback: null,
    turn1ReplyPreview: (turn1Result?.textOut || "").slice(0, 1200),
    turn2ReplyPreview: (turn2Result?.textOut || "").slice(0, 1200),
  };

  for (const src of previewJpgs) {
    const dest = path.join(ARTIFACT_SCRATCH_DIR, path.basename(src));
    fs.copyFileSync(src, dest);
    savedSummary.copiedPreviews.push(dest);
  }

  if (htmlFiles.length > 0) {
    const targetHtml =
      htmlFiles.find((f) => f.replace(/\\/g, "/").includes("/projects/")) || htmlFiles[0];
    const htmlSrc = fs.readFileSync(targetHtml, "utf8");
    const copiedHtml = path.join(ARTIFACT_SCRATCH_DIR, "index.html");
    fs.writeFileSync(copiedHtml, htmlSrc, "utf8");
    savedSummary.copiedHtmlPath = copiedHtml;
    savedSummary.htmlAnalysis = {
      bytes: htmlSrc.length,
      hasFilmMeta: htmlSrc.includes("__filmMeta") || htmlSrc.includes("AETHERIA_FILM"),
      hasRenderAt: htmlSrc.includes("window.renderAt") || htmlSrc.includes("function renderAt"),
      hasReady: htmlSrc.includes("__ready"),
      hasCss3d: /perspective|preserve-3d|rotateX|rotateY/i.test(htmlSrc),
      hasSvg: /<svg[\s>]/i.test(htmlSrc),
      hasCanvas: /<canvas[\s>]/i.test(htmlSrc),
    };

    const projectDir = path.dirname(targetHtml);
    const filmJsonPath = path.join(projectDir, "film.json");
    if (fs.existsSync(filmJsonPath)) {
      fs.copyFileSync(filmJsonPath, path.join(ARTIFACT_SCRATCH_DIR, "film.json"));
    }
    const scriptDir = path.join(projectDir, "script");
    if (fs.existsSync(scriptDir)) {
      savedSummary.projectScripts = fs.readdirSync(scriptDir);
    }

    if (previewJpgs.length === 0) {
      try {
        savedSummary.renderedFallback = await capturePlaywrightFallbackFrames(
          targetHtml,
          ARTIFACT_SCRATCH_DIR
        );
      } catch (fbErr) {
        savedSummary.renderedFallbackError = String(
          fbErr instanceof Error ? fbErr.message : fbErr
        );
      }
    }
  }

  if (typeof engineLogs === "string" && engineLogs.length > 0) {
    const redactedTail = redactSensitiveLogs(engineLogs.slice(-24_000));
    const logPath = path.join(ARTIFACT_SCRATCH_DIR, "engine_logs_tail.txt");
    fs.writeFileSync(logPath, redactedTail, "utf8");
    savedSummary.engineLogTailPath = logPath;
  }

  const summaryPath = path.join(ARTIFACT_SCRATCH_DIR, "live_9router_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(savedSummary, null, 2), "utf8");
  console.log(`[live-9router] Summary saved to ${summaryPath}`);
  console.log(JSON.stringify(savedSummary, null, 2));
  return { savedSummary, htmlFiles };
}

async function main() {
  const { baseURL, apiKey } = loadNineRouterConfig();
  assert.ok(apiKey, "9Router apiKey missing in ~/.config/opencode/opencode.json and NINEROUTER_API_KEY env var");

  const modelsRes = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert.ok(modelsRes.ok, `9Router gateway check failed at ${baseURL}/models: HTTP ${modelsRes.status}`);
  const modelsJson = await modelsRes.json();
  const hasComboMaut = Array.isArray(modelsJson?.data) && modelsJson.data.some((m) => m?.id === "ComboMaut");
  assert.ok(hasComboMaut, `ComboMaut model not found on 9Router gateway at ${baseURL}`);
  console.log(`[live-9router] Gateway OK (${baseURL}) with ComboMaut`);

  fs.mkdirSync(ARTIFACT_SCRATCH_DIR, { recursive: true });
  let stack = null;
  let sessId = null;
  let t1 = null;
  let t2 = null;
  let latestFallbackMsgs = null;
  let runError = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "9router": {
            name: "9Router",
            type: "openai",
            options: { baseURL, apiKey },
            models: {
              ComboMaut: { name: "ComboMaut", vision: true },
            },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = {
      providerID: "9router",
      modelID: "ComboMaut",
      id: "ComboMaut",
      variant: "high",
    };

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Live 9Router OpenCode Parity", model: modelObj },
    });
    sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    assert.ok(sessId, `Failed creating session: ${sessRes.text}`);
    console.log(`[live-9router] Session created: ${sessId} | workspace=${wsDir}`);

    const turn1Prompt =
      "kalau kamu ku suruh buat kan video berbasis kode js dan html ini contohnya https://pin.it/byKoQ42rJ apa yang kamu lakukan?";
    t1 = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      sessId,
      turn1Prompt,
      modelObj,
      "Turn#1",
      300_000
    );
    console.log(`[live-9router] Turn#1 reply preview:\n${t1.textOut.slice(0, 500)}\n---`);

    const turn2Prompt =
      "coba buat kamu aja buat tema nya tapi aku mau yang mirip banget ga perlu audio";
    t2 = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      sessId,
      turn2Prompt,
      modelObj,
      "Turn#2",
      1_800_000
    );
    console.log(`[live-9router] Turn#2 reply preview:\n${t2.textOut.slice(0, 700)}\n---`);
  } catch (err) {
    runError = err;
    if (stack && sessId) {
      try {
        const msgRes = await api(
          stack.engineUrl,
          `/api/session/${sessId}/message?directory=${encodeURIComponent(stack.workspaceDir)}&order=asc&limit=500`,
          { authHeader: stack.authHeader }
        );
        latestFallbackMsgs = extractMessages(msgRes.json);
      } catch {
        // best-effort snapshot before stopping engine
      }
    }
    throw err;
  } finally {
    if (stack) {
      try {
        const { savedSummary, htmlFiles } = await saveLiveRunArtifacts({
          wsDir: stack.workspaceDir,
          sessionID: sessId,
          turn1Result: t1,
          turn2Result: t2,
          fallbackMessages: latestFallbackMsgs,
          runError,
          engineLogs: typeof stack.engineLogs === "function" ? stack.engineLogs() : "",
        });
        if (!runError) {
          assert.equal(
            t2.tel.blockedTools.length,
            0,
            `Tools were blocked: ${JSON.stringify(t2.tel.blockedTools)}`
          );
          assert.ok(htmlFiles.length > 0, "Expected generated index.html inside workspace");
          assert.ok(
            savedSummary.htmlAnalysis?.hasRenderAt,
            "Generated index.html must expose window.renderAt"
          );
        }
      } finally {
        await stack.stop();
      }
    }
  }
}

main().catch((err) => {
  console.error("[live-9router] FAIL:", err);
  process.exit(1);
});
