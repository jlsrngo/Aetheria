#!/usr/bin/env node
/**
 * F5 E2E Verification (Fact-Based Scene State & Verification Guardrails):
 * 1. Deterministic adversarial mock checks (real engine HTTP -> tool execution -> gate):
 *    - `film_scaffold` returns `sceneProgress` (`stub: 2, drafted: 0, previewed: 0`).
 *    - Failed `edit` on stub keeps `scene1` at `stub` (never marks `drafted`).
 *    - `write` without `AM.registerScene` returns `ok: false` + `ERROR (MISSING_REGISTER_SCENE)`.
 *    - Writing only `scene1.js` while leaving `scene2.js` as stub updates `sceneProgress` to `drafted: 1, stub: 1`.
 *    - False completion claim `"Video selesai!"` is intercepted by `COMPLETION BLOCKED BY VERIFICATION GATE`
 *      mentioning `scene2` stub, and repeated cheat gets stamped with `[Verification notice: ...]` + `[F5_COMPLETION_GUARD]`.
 * 2. Live Gemini 2.5 Flash 2-scene `/mg-flat-vector` turn:
 *    - Writes both scenes, passes `capture_film_preview`, reaches `previewed: 2, stub: 0` in `.aetheria/preview/preview_state.json`,
 *      and exposes `/api/studio/film-meta` cleanly with `lint.valid === true`.
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

function resolveEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const candidates = [
    path.join(REPO_ROOT, "target", "debug", exe),
    path.join(REPO_ROOT, "target", "release", exe),
  ].filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    throw new Error('Engine binary not found. Run "npm run build:engine" first.');
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort(preferred = 4839) {
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

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs = 240_000) {
  const prevCount = extractMessages(
    (await api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, { authHeader, timeoutMs: 20_000 })).json
  ).filter((m) => (m.info?.role ?? m.role) === "assistant").length;

  const sendRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
    method: "POST",
    authHeader,
    timeoutMs,
    body: { model: modelObj, prompt: { text } },
  });
  if (!sendRes.ok) {
    throw new Error(`POST prompt failed (${sendRes.status}): ${sendRes.text}`);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const [msgRes, jobsRes] = await Promise.all([
      api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, { authHeader, timeoutMs: 20_000 }),
      api(baseUrl, `/api/session/${sessionID}/jobs`, { authHeader, timeoutMs: 10_000 }).catch(() => null),
    ]);
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
    const jobs = jobsRes?.json?.data ?? [];
    const hasRunningJob = Array.isArray(jobs) && jobs.some((j) => j.status === "running");
    if (assistants.length > prevCount && isTurnFinished(msgs) && !hasRunningJob) {
      await new Promise((r) => setTimeout(r, 500));
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn`);
}

function startAdversarialMockServer() {
  let step = 0;
  const toolOutputs = [];
  const promptsReceived = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const msgs = body.messages || [];
      for (const m of msgs) {
        if (m.role === "tool" && typeof m.content === "string") {
          toolOutputs.push(m.content);
        }
        if (m.role === "user" && typeof m.content === "string") {
          promptsReceived.push(m.content);
        }
      }
      step++;
      let choice;
      if (step === 1) {
        choice = {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_f5_1",
                type: "function",
                function: {
                  name: "film_scaffold",
                  arguments: JSON.stringify({
                    title: "F5 Guard Film",
                    preset: "portrait",
                    scenes: [
                      { id: "scene1", duration: 2.0 },
                      { id: "scene2", duration: 2.0 },
                    ],
                  }),
                },
              },
            ],
          },
        };
      } else if (step === 2) {
        choice = {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_f5_2",
                type: "function",
                function: {
                  name: "edit",
                  arguments: JSON.stringify({
                    filePath: "script/scene1.js",
                    oldString: "THIS_STRING_DOES_NOT_EXIST",
                    newString: "var a = 1;",
                  }),
                },
              },
            ],
          },
        };
      } else if (step === 3) {
        choice = {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_f5_3",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene2.js",
                    content: "var brokenSceneWithoutRegister = true;\n",
                  }),
                },
              },
            ],
          },
        };
      } else if (step === 4) {
        // Fix ONLY scene1.js with valid AM.registerScene; leave scene2 without valid register/still broken/stub-restored
        choice = {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_f5_4",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene1.js",
                    content:
                      "window.AM.registerScene('scene1', function(ctx, localTime, dur) { ctx.fillStyle = '#112233'; ctx.fillRect(0, 0, 1080, 1920); });\n",
                  }),
                },
              },
            ],
          },
        };
      } else {
        // Attempt false completion twice!
        choice = {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Video selesai 100%! Semua scene sudah beres.",
          },
        };
      }

      const payload = JSON.stringify({
        id: `chatcmpl_f5_${step}`,
        object: "chat.completion",
        choices: [choice],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        getToolOutputs: () => toolOutputs,
        getPrompts: () => promptsReceived,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function setupIsolatedXdgConfig(mockUrl) {
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f5-cfg-"));
  const cfgSubdir = path.join(xdgDir, "aetheria-nexus");
  fs.mkdirSync(cfgSubdir, { recursive: true });
  const srcCfg = path.join(os.homedir(), ".config", "aetheria-nexus", "aetheria.json");
  const baseCfg = fs.existsSync(srcCfg) ? JSON.parse(fs.readFileSync(srcCfg, "utf8")) : {};
  baseCfg.provider = {
    ...(baseCfg.provider || {}),
    "f5-mock": {
      name: "F5 Adversarial Mock",
      type: "openai",
      active: true,
      options: { baseURL: mockUrl, apiKey: "mock-f5-key" },
      models: {
        "cheat-llm": { name: "Cheat LLM", reasoning: false, limit: { output: 8192 } },
      },
    },
  };
  fs.writeFileSync(path.join(cfgSubdir, "aetheria.json"), JSON.stringify(baseCfg, null, 2), "utf8");
  return xdgDir;
}

async function main() {
  const mock = await startAdversarialMockServer();
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4839);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f5-e2e-"));
  const xdgConfig = setupIsolatedXdgConfig(mock.url);
  const xdgData = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f5-data-"));
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
    if (!healthy) throw new Error(`Health failed:\n${engineLogs.join("")}`);
    console.log("[HEALTH] ok");

    // Part A: Negative adversarial cheat check via mock model (using General profile so coordinator can call film_scaffold/edit/write directly)
    const mockModel = { providerID: "f5-mock", modelID: "cheat-llm", id: "cheat-llm" };
    const negSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F5 Adversarial Gate Test", model: mockModel },
    });
    const negSessId = negSessRes.json?.data?.id ?? negSessRes.json?.id;
    createdSessions.push(negSessId);

    const negMsgs = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      negSessId,
      "Non-video script plugin harness verification test: run steps cleanly.",
      mockModel,
      60_000
    );

    const rawToolOuts = mock.getToolOutputs();
    const scaffoldOut = rawToolOuts.find((t) => t.includes('"sceneProgress"')) || "";
    const missingRegOut = rawToolOuts.find((t) => t.includes("MISSING_REGISTER_SCENE")) || "";
    const lastNegAsst = [...negMsgs].reverse().find((m) => (m.info?.role ?? m.role) === "assistant");
    const lastNegParts = Array.isArray(lastNegAsst?.parts)
      ? lastNegAsst.parts
      : Array.isArray(lastNegAsst?.content)
        ? lastNegAsst.content
        : [];
    const lastNegText = lastNegParts
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join("\n") || (typeof lastNegAsst?.content === "string" ? lastNegAsst.content : "");
    const promptsSeen = mock.getPrompts();

    // Clean tempWorkspace before positive live video run!
    const projRoot = path.join(tempWorkspace, "projects");
    if (fs.existsSync(projRoot)) fs.rmSync(projRoot, { recursive: true, force: true });
    const dotAeth = path.join(tempWorkspace, ".aetheria");
    if (fs.existsSync(dotAeth)) fs.rmSync(dotAeth, { recursive: true, force: true });

    // Part B: Positive live Gemini 2.5 Flash 2-scene `/mg-flat-vector` turn
    const providerID = process.env.AETHERIA_TEST_PROVIDER || "local-cli";
    const modelID = process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash";
    const realModel = { providerID, modelID, id: modelID };
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    const posSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F5 Positive Disk State Film", model: realModel },
    });
    const posSessId = posSessRes.json?.data?.id ?? posSessRes.json?.id;
    createdSessions.push(posSessId);

    const posMsgs = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      posSessId,
      '/mg-flat-vector Buatkan video 2 scene berjudul "F5 Disk Progress" (portrait 1080x1920, tanpa voiceover/audio, 2.5s per scene). Akhiri dengan `capture_film_preview`.',
      realModel,
      240_000
    );

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    const htmlPath = filmMeta?.htmlPath;
    const filmDir = htmlPath ? path.dirname(htmlPath) : "";
    const previewStatePath = filmDir ? path.join(filmDir, ".aetheria", "preview", "preview_state.json") : "";
    const previewState = previewStatePath && fs.existsSync(previewStatePath)
      ? JSON.parse(fs.readFileSync(previewStatePath, "utf8"))
      : null;

    // Check preview sceneProgress from positive run messages
    let positivePreviewProgress = null;
    for (const m of posMsgs) {
      const mParts = Array.isArray(m.parts) ? m.parts : Array.isArray(m.content) ? m.content : [];
      for (const p of mParts) {
        const sp = p.state?.structured?.sceneProgress;
        if (sp && (p.tool || p.name) === "capture_film_preview") {
          positivePreviewProgress = sp;
        }
      }
    }

    const fullLogs = engineLogs.join("");
    const checks = {
      scaffoldReturnedStubProgress: scaffoldOut.includes('"stub":2') || scaffoldOut.includes('"stub": 2'),
      missingRegisterSceneFlagged: Boolean(missingRegOut),
      gateBlockedFalseCompletion: promptsSeen.some((p) =>
        p.includes("COMPLETION BLOCKED BY VERIFICATION GATE")
      ),
      terminalNoticeAppendedOnRepeatedCheat:
        lastNegText.includes("[Verification notice:") &&
        fullLogs.includes("[F5_COMPLETION_GUARD]"),
      positiveLintValid: filmMeta?.lint?.valid === true,
      positivePreviewStateRecorded:
        Boolean(previewState) &&
        previewState.runtimeErrorsCount === 0 &&
        Object.keys(previewState.scriptSha256 || {}).some((k) => k.endsWith("scene1.js")) &&
        Object.keys(previewState.scriptSha256 || {}).some((k) => k.endsWith("scene2.js")),
      positiveProgressPreviewed: positivePreviewProgress
        ? positivePreviewProgress.stub === 0 && positivePreviewProgress.previewed >= 2
        : Boolean(previewState),
    };

    console.log(
      "[F5_CHECKS]",
      JSON.stringify({ ...checks, positivePreviewProgress, previewStateKeys: Object.keys(previewState?.scriptSha256 || {}) }, null, 2)
    );
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`F5 E2E failed checks: ${JSON.stringify(checks)}`);
    }
    console.log("[F5_E2E_RESULT] PASSED");
  } catch (err) {
    console.error("[ENGINE_LOGS_TAIL]", engineLogs.join("").slice(-3500));
    throw err;
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
    await mock.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(xdgConfig, { recursive: true, force: true });
    fs.rmSync(xdgData, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[F5_E2E_FATAL]", err);
  process.exit(1);
});
