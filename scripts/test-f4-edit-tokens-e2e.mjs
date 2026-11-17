#!/usr/bin/env node
/**
 * F4 E2E Verification (Edit Strategy Contract, max_tokens Tuning & Per-Role Reasoning Hook):
 * 1. Mock OpenAI-compatible provider checks exact HTTP wire payloads:
 *    - `agent.explore.reasoning = "low"` on reasoning=true model forwards `reasoning_effort: "low"`.
 *    - `agent.qa-verifier.reasoning = "low"` on reasoning=false model omits `reasoning_effort` & logs ignore.
 *    - Unconfigured role leaves payload free of `reasoning_effort` (global default untouched).
 * 2. Real LLM (`local-cli/gemini-2.5-flash`) + tuned `DEFAULT_MOTION_DESIGNER_MAX_TOKENS = 12288`
 *    + `agent.motion-designer.reasoning = "low"`:
 *    - Produces valid 3-scene `/mg-kinetic-type` video with `max_tokens=12288`, `length_hits=0`.
 * 3. Live >25-line un-ranged `edit` negative check + recovery via full-file `write`.
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

function findAvailablePort(preferred = 4829) {
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
    await new Promise((r) => setTimeout(r, 2000));
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
      await new Promise((r) => setTimeout(r, 600));
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn`);
}

function startMockOpenAIServer() {
  const recorded = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      recorded.push({
        model: body.model,
        max_tokens: body.max_tokens ?? null,
        reasoning_effort: body.reasoning_effort ?? null,
        toolNames: (body.tools || []).map((t) => t.function?.name).filter(Boolean),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl_mock",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Mock provider inspected OK.",
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        recorded,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function setupIsolatedXdgConfig(mockUrl) {
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f4-cfg-"));
  const cfgSubdir = path.join(xdgDir, "aetheria-nexus");
  fs.mkdirSync(cfgSubdir, { recursive: true });
  const srcCfg = path.join(os.homedir(), ".config", "aetheria-nexus", "aetheria.json");
  const baseCfg = fs.existsSync(srcCfg) ? JSON.parse(fs.readFileSync(srcCfg, "utf8")) : {};
  baseCfg.provider = {
    ...(baseCfg.provider || {}),
    "f4-mock": {
      name: "F4 Mock Provider",
      type: "openai",
      active: true,
      options: { baseURL: mockUrl, apiKey: "mock-key-123" },
      models: {
        "thinker-model": { name: "Thinker", reasoning: true, limit: { output: 16384 } },
        "plain-model": { name: "Plain", reasoning: false, limit: { output: 16384 } },
      },
    },
  };
  baseCfg.agent = {
    ...(baseCfg.agent || {}),
    "motion-designer": { reasoning: "low" }, // leave max_tokens unset to test 12288 default!
    explore: { model: "f4-mock/thinker-model", reasoning: "low", max_tokens: 3072 },
    "audio-director": { model: "f4-mock/plain-model", reasoning: "low" },
    general: { model: "f4-mock/thinker-model" }, // reasoning unset -> global default untouched!
  };
  fs.writeFileSync(path.join(cfgSubdir, "aetheria.json"), JSON.stringify(baseCfg, null, 2), "utf8");
  return xdgDir;
}

async function main() {
  const mock = await startMockOpenAIServer();
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4829);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f4-e2e-"));
  const xdgConfig = setupIsolatedXdgConfig(mock.url);
  const xdgData = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f4-data-"));
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

    const providerID = process.env.AETHERIA_TEST_PROVIDER || "local-cli";
    const modelID = process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash";
    const modelObj = { providerID, modelID, id: modelID };
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    // 1. Live wire-format verification for agent.<id>.reasoning & agent.<id>.max_tokens
    const hookSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F4 Hook Wire Verification", model: modelObj },
    });
    const hookSessId = hookSessRes.json?.data?.id ?? hookSessRes.json?.id;
    createdSessions.push(hookSessId);

    // Seed a 35-line JS file for live un-ranged >25-line edit negative test
    const demoLines = Array.from({ length: 35 }, (_, i) => `var line${i + 1} = ${i + 1};`);
    fs.writeFileSync(path.join(tempWorkspace, "demo_long.js"), demoLines.join("\n") + "\n", "utf8");
    const first30Lines = demoLines.slice(0, 30).join("\n");

    const hookPrompt = [
      "Execute these 3 subagent calls right now:",
      '1. Call `task` with `subagent_type: "explore"`, description `"check workspace"` and prompt `"Confirm OK"`.',
      '2. Call `task` with `subagent_type: "audio-director"`, description `"check plain reasoning ignore"` and prompt `"Confirm OK"`.',
      '3. Call `task` with `subagent_type: "general"`, description `"check default untouched"` and prompt `"Confirm OK"`.',
    ].join("\n");

    await sendAndWaitTurn(baseUrl, authHeader, dirQuery, hookSessId, hookPrompt, modelObj, 120_000);

    // Separate focused turn for >25-line un-ranged edit rejection -> write recovery
    const editSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F4 Edit Strategy Guard Check", model: modelObj },
    });
    const editSessId = editSessRes.json?.data?.id ?? editSessRes.json?.id;
    createdSessions.push(editSessId);

    const editPromptStep1 = `Call ONLY the \`edit\` tool once (do NOT call \`read\` or \`write\`) on \`filePath: "demo_long.js"\` with NO \`startLine\` and NO \`endLine\`, setting \`oldString\` to these exact 30 lines:
\`\`\`js
${first30Lines}
\`\`\`
and \`newString\` to \`"var line1 = 999;"\`. Report the exact tool error output.`;

    const editMsgs1 = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, editSessId, editPromptStep1, modelObj, 60_000);
    const editMsgs2 = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      editSessId,
      'Now fix `demo_long.js` by overwriting it with the `write` tool to contain `"var line1 = 999;\n"`.',
      modelObj,
      60_000
    );
    const updatedDemo = fs.readFileSync(path.join(tempWorkspace, "demo_long.js"), "utf8");
    const editToolErrors = [];
    const editToolCallsDebug = [];
    for (const m of [...editMsgs1, ...editMsgs2]) {
      for (const p of m.parts || []) {
        if ((p.type === "tool" || p.type === "tool_use") && (p.tool || p.name) === "edit") {
          editToolCallsDebug.push(p.state);
          const rawErr =
            (typeof p.state?.error === "string" ? p.state.error : p.state?.error?.message) ||
            p.state?.structured?.error ||
            p.state?.output ||
            "";
          if (rawErr) editToolErrors.push(String(rawErr));
        }
      }
    }
    const asstErrText = editMsgs1
      .filter((m) => (m.info?.role ?? m.role) === "assistant")
      .map((m) => (m.parts || []).filter((p) => p.type === "text").map((p) => p.text || "").join("\n"))
      .join("\n");

    const exploreReq = mock.recorded.find((r) => r.model === "thinker-model" && r.max_tokens === 3072);
    const plainReq = mock.recorded.find((r) => r.model === "plain-model");
    const defaultReq = mock.recorded.find((r) => r.model === "thinker-model" && r.max_tokens === 4096);

    // 2. Live tuned motion-designer video production run (`mg-kinetic-type`, 3 scenes)
    const vidSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F4 Kinetic 3-Scene Tuned Budget", model: modelObj },
    });
    const vidSessId = vidSessRes.json?.data?.id ?? vidSessRes.json?.id;
    createdSessions.push(vidSessId);

    const vidPrompt =
      '/mg-kinetic-type Buatkan video tipografi kinetik 3 scene berjudul "F4 Tuned Motion" (portrait 1080x1920, tanpa voiceover/audio, durasi 3s per scene). Akhiri dengan `capture_film_preview`.';
    await sendAndWaitTurn(baseUrl, authHeader, dirQuery, vidSessId, vidPrompt, modelObj, 240_000);

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;

    const fullLogs = engineLogs.join("");
    const checks = {
      exploreForwardedReasoningLowAndMaxTokens3072:
        exploreReq?.reasoning_effort === "low" && exploreReq?.max_tokens === 3072,
      unsupportedReasoningOmittedOnPlainModel:
        Boolean(plainReq) && plainReq?.reasoning_effort === null,
      unsupportedReasoningLoggedClearly:
        fullLogs.includes("Ignoring agent.audio-director.reasoning='low'"),
      unconfiguredRoleUntouched:
        Boolean(defaultReq) && defaultReq?.reasoning_effort === null && defaultReq?.max_tokens === 4096,
      unrangedLongEditRejectedClearly:
        editToolErrors.some((e) => e.includes("startLine") && e.includes("line limit")) ||
        fullLogs.includes("line limit"),
      demoUpdatedViaWrite:
        updatedDemo.includes("999"),
      motionDesignerUsed12288AndLowReasoning:
        fullLogs.includes("role=motion-designer") &&
        fullLogs.includes("max_tokens=12288") &&
        fullLogs.includes("reasoning=low"),
      motionDesignerZeroLengthLimitHits:
        fullLogs.includes("role=motion-designer") && !fullLogs.includes("[F4_LENGTH_LIMIT]"),
      videoLintValid: filmMeta?.lint?.valid === true,
      videoThreeScenes: (filmMeta?.scenes?.length ?? 0) === 3,
    };

    console.log(
      "[F4_CHECKS]",
      JSON.stringify({ ...checks, mockRecorded: mock.recorded, editToolErrors, editToolCallsDebug, asstErrText: asstErrText.slice(0, 300) }, null, 2)
    );
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`F4 E2E failed checks: ${JSON.stringify(checks)}`);
    }
    console.log("[F4_E2E_RESULT] PASSED");
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
  console.error("[F4_E2E_FATAL]", err);
  process.exit(1);
});
