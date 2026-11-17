#!/usr/bin/env node
/**
 * F6 E2E Verification (Turn-Aware Dynamic Context Filtering & Configurable Cap):
 * 1. Seeds temporary workspace with bloated `.aetheria/AETHERIA.md` (35 catalog lines),
 *    mixed `.aetheria/knowledge.json` (relevant, irrelevant, pinned), and plugin rules.
 * 2. Configures custom `/context/{maxLivingMemoryChars, maxDynamicChars}` in isolated aetheria.json.
 * 3. Sends 3 controlled HTTP turns (greeting, non-video, explicit `/mg-soft-clay-story` coffee)
 *    to capture exact system prompts sent to the LLM + verifies `[F6_CONTEXT_CAP]` & `[F6_DYNAMIC_CONTEXT]` logs.
 * 4. Runs a quick live `local-cli/gemini-2.5-flash` turn to verify live compatibility.
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

function findAvailablePort(preferred = 4849) {
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

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs = 90_000) {
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
    await new Promise((r) => setTimeout(r, 1000));
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
      await new Promise((r) => setTimeout(r, 300));
      return msgs;
    }
  }
  throw new Error(`Timed out waiting for turn`);
}

function startPromptCaptureServer() {
  const captures = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const msgs = body.messages || [];
      const sysMsg = msgs
        .filter((m) => m.role === "system" || m.role === "developer")
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");
      const lastUser = [...msgs]
        .reverse()
        .find((m) => m.role === "user");
      captures.push({
        userText: typeof lastUser?.content === "string" ? lastUser.content : "",
        systemPrompt: sysMsg,
        systemLen: sysMsg.length,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `chatcmpl_f6_${captures.length}`,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "Captured cleanly." },
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
        captures,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function setupWorkspaceFixtures(ws) {
  const dot = path.join(ws, ".aetheria");
  fs.mkdirSync(dot, { recursive: true });

  // 1. Oversized living memory (> 1500 chars with 35 file entries)
  const filesList = Array.from({ length: 35 }, (_, i) => `- projects/demo/script/scene_extra_${i + 1}.js`).join("\n");
  const mem = [
    "# LOCAL WORKSPACE OPERATING RULES (f6-test)",
    "## Domain Profile",
    "HTML5 + JavaScript Deterministic Motion Films",
    "## Workspace Catalog",
    filesList,
    "## Operating Invariants",
    "- Active Folder Isolation",
    "## User Preferences & Learned Corrections",
    "- Prefer crisp 3-beat animations.",
  ].join("\n");
  fs.writeFileSync(path.join(dot, "AETHERIA.md"), mem, "utf8");

  // 2. Knowledge base: 1 relevant, 1 irrelevant, 1 pinned
  fs.writeFileSync(
    path.join(dot, "knowledge.json"),
    JSON.stringify(
      {
        nodes: [
          {
            id: "kn_espresso",
            title: "Espresso Brand Palette",
            content: "Use warm crema beige and deep roast brown accents for coffee scenes.",
            active: true,
          },
          {
            id: "kn_tax",
            title: "Quarterly Payroll Taxes",
            content: "Submit W-2 withholding reconciliation spreadsheets to accounting.",
            active: true,
          },
          {
            id: "kn_pinned",
            title: "Studio Framing Rule",
            content: "Keep center safe zone padding 72px on vertical formats.",
            active: true,
            pinned: true,
          },
        ],
        edges: [],
        nextId: 4,
      },
      null,
      2
    ),
    "utf8"
  );

  // 3. Plugin rules: 1 alwaysApply + 1 topical finance rule
  const rulesDir = path.join(dot, "plugins", "demo-rules", "rules");
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(rulesDir, "global-motion.md"),
    "---\nalwaysApply: true\n---\nNever emit nondeterministic clocks.",
    "utf8"
  );
  fs.writeFileSync(
    path.join(rulesDir, "payroll-compliance.md"),
    "Always round quarterly tax withholdings to two decimals.",
    "utf8"
  );
}

function setupIsolatedXdgConfig(mockUrl) {
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f6-cfg-"));
  const cfgSubdir = path.join(xdgDir, "aetheria-nexus");
  fs.mkdirSync(cfgSubdir, { recursive: true });
  const srcCfg = path.join(os.homedir(), ".config", "aetheria-nexus", "aetheria.json");
  const baseCfg = fs.existsSync(srcCfg) ? JSON.parse(fs.readFileSync(srcCfg, "utf8")) : {};
  baseCfg.provider = {
    ...(baseCfg.provider || {}),
    "f6-mock": {
      name: "F6 Capture Provider",
      type: "openai",
      active: true,
      options: { baseURL: mockUrl, apiKey: "mock-f6-key" },
      models: {
        "capture-model": { name: "Capture", reasoning: false, limit: { output: 4096 } },
      },
    },
  };
  baseCfg.context = {
    maxLivingMemoryChars: 700,
    maxKnowledgeChars: 1200,
    maxSkillsChars: 1400,
    maxPluginRulesChars: 1200,
    maxDynamicChars: 2400,
  };
  fs.writeFileSync(path.join(cfgSubdir, "aetheria.json"), JSON.stringify(baseCfg, null, 2), "utf8");
  return xdgDir;
}

async function main() {
  const mock = await startPromptCaptureServer();
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4849);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f6-e2e-"));
  setupWorkspaceFixtures(tempWorkspace);
  const xdgConfig = setupIsolatedXdgConfig(mock.url);
  const xdgData = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f6-data-"));
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

    const mockModel = { providerID: "f6-mock", modelID: "capture-model", id: "capture-model" };

    // Turn 1: Greeting
    const s1 = (
      await api(baseUrl, `/api/session?${dirQuery}`, {
        method: "POST",
        authHeader,
        body: { title: "F6 Greeting", model: mockModel },
      })
    ).json?.data?.id;
    createdSessions.push(s1);
    await sendAndWaitTurn(baseUrl, authHeader, dirQuery, s1, "halo", mockModel, 30_000);

    // Turn 2: Non-video engineering question
    const s2 = (
      await api(baseUrl, `/api/session?${dirQuery}`, {
        method: "POST",
        authHeader,
        body: { title: "F6 Non-Video", model: mockModel },
      })
    ).json?.data?.id;
    createdSessions.push(s2);
    await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      s2,
      "Explain why config.rs regex validation might reject underscores.",
      mockModel,
      30_000
    );

    // Turn 3: Explicit /mg-soft-clay-story video espresso prompt
    const s3 = (
      await api(baseUrl, `/api/session?${dirQuery}`, {
        method: "POST",
        authHeader,
        body: { title: "F6 Explicit Skill Video", model: mockModel },
      })
    ).json?.data?.id;
    createdSessions.push(s3);
    await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      s3,
      "/mg-soft-clay-story buat video 2 scene tentang espresso crema",
      mockModel,
      30_000
    );

    // Turn 4: Real Gemini 2.5 Flash turn compatibility sanity check
    const realModel = {
      providerID: process.env.AETHERIA_TEST_PROVIDER || "local-cli",
      modelID: process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash",
      id: process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash",
    };
    const s4 = (
      await api(baseUrl, `/api/session?${dirQuery}`, {
        method: "POST",
        authHeader,
        body: { title: "F6 Live Sanity", model: realModel },
      })
    ).json?.data?.id;
    createdSessions.push(s4);
    const liveMsgs = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      s4,
      "Halo! Jawab singkat satu kata: siap.",
      realModel,
      60_000
    );

    const capGreeting = mock.captures.find((c) => c.userText.trim() === "halo");
    const capNonVideo = mock.captures.find((c) => c.userText.includes("config.rs"));
    const capEspresso = mock.captures.find((c) => c.userText.includes("espresso crema"));

    const fullLogs = engineLogs.join("");
    const checks = {
      greetingHasZeroDynamicBlocks:
        Boolean(capGreeting) &&
        !capGreeting.systemPrompt.includes("<living_memory>") &&
        !capGreeting.systemPrompt.includes("<knowledge_base>") &&
        !capGreeting.systemPrompt.includes("<skills>\nMotion/domain skills") &&
        !capGreeting.systemPrompt.includes("<plugin_rules>"),
      nonVideoCappedLivingMemAndNoMotionSkills:
        Boolean(capNonVideo) &&
        capNonVideo.systemPrompt.includes("<living_memory>") &&
        capNonVideo.systemPrompt.includes("more files; inspect via `glob`") &&
        !capNonVideo.systemPrompt.includes("mg-soft-clay-story") &&
        !capNonVideo.systemPrompt.includes("Quarterly Payroll Taxes"),
      explicitVideoNarrowsSkillsAndFiltersKnowledge:
        Boolean(capEspresso) &&
        capEspresso.systemPrompt.includes("mg-soft-clay-story") &&
        !capEspresso.systemPrompt.includes("mg-kinetic-type") &&
        capEspresso.systemPrompt.includes("Espresso Brand Palette") &&
        capEspresso.systemPrompt.includes("Studio Framing Rule") &&
        !capEspresso.systemPrompt.includes("Quarterly Payroll Taxes") &&
        capEspresso.systemPrompt.includes("global-motion.md") &&
        !capEspresso.systemPrompt.includes("payroll-compliance.md"),
      greetingSignificantlySmallerThanVideo:
        Boolean(capGreeting && capEspresso) && capGreeting.systemLen < capEspresso.systemLen,
      truncationAndSummaryLogged:
        fullLogs.includes("[F6_CONTEXT_CAP]") && fullLogs.includes("[F6_DYNAMIC_CONTEXT]"),
      liveModelTurnSucceeded: liveMsgs.some((m) => (m.info?.role ?? m.role) === "assistant"),
    };

    console.log(
      "[F6_CHECKS]",
      JSON.stringify(
        {
          ...checks,
          lengths: {
            greeting: capGreeting?.systemLen ?? 0,
            nonVideo: capNonVideo?.systemLen ?? 0,
            explicitVideo: capEspresso?.systemLen ?? 0,
          },
        },
        null,
        2
      )
    );
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`F6 E2E failed checks: ${JSON.stringify(checks)}`);
    }
    console.log("[F6_E2E_RESULT] PASSED");
  } catch (err) {
    console.error("[ENGINE_LOGS_TAIL]", engineLogs.join("").slice(-3000));
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
  console.error("[F6_E2E_FATAL]", err);
  process.exit(1);
});
