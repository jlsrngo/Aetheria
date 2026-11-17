#!/usr/bin/env node
/**
 * F3 E2E Verification (Role-Based Tool Surfaces):
 * 1. Fresh dev engine startup + health check.
 * 2. General non-video coding turn can still use full general tools (e.g. `write` + `bash`).
 * 3. Video turn with `/mg-flat-vector` (2-scene film) succeeds end-to-end using lean
 *    `director` (10 tools) + `motion-designer` (8 tools, zero bash/codemode/websearch/apply_patch).
 * 4. Negative check: missing directory/session fails gracefully.
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
    throw new Error(`Engine binary not found. Run "npm run build:engine" first.`);
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort(preferred = 4799) {
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
    await new Promise((r) => setTimeout(r, 2500));
    const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, {
      authHeader,
      timeoutMs: 20_000,
    });
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
    if (assistants.length > prevCount && isTurnFinished(msgs)) {
      await new Promise((r) => setTimeout(r, 800));
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn`);
}

function collectToolCalls(messages) {
  const calls = [];
  for (const m of messages) {
    const parts = Array.isArray(m.parts)
      ? m.parts
      : Array.isArray(m.content)
        ? m.content
        : [];
    for (const p of parts) {
      if (p.type === "tool" || p.type === "tool_use") {
        calls.push({
          name: p.tool || p.name || "",
          status: p.state?.status || p.status || "",
        });
      }
    }
  }
  return calls;
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4799);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f3-e2e-"));
  const engineLogs = [];
  const engine = spawn(engineBin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: tempWorkspace,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_WORKSPACE: tempWorkspace,
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
    if (!healthy) {
      throw new Error(`Engine failed health check:\n${engineLogs.join("")}`);
    }
    console.log("[HEALTH] ok");

    // Negative HTTP check
    const missingSess = await api(baseUrl, `/api/session/does-not-exist/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { prompt: { text: "ping" } },
    });
    if (missingSess.status < 400) {
      throw new Error(`Expected 4xx on missing session, got ${missingSess.status}`);
    }

    const providerID = process.env.AETHERIA_TEST_PROVIDER || "local-cli";
    const modelID = process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash";
    const modelObj = { providerID, modelID, id: modelID };
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    // 1. General coding turn must still expose full engineering tools (write + bash)
    const genSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F3 General Engineering Turn", model: modelObj },
    });
    const genSessId = genSessRes.json?.data?.id ?? genSessRes.json?.id;
    createdSessions.push(genSessId);

    const genPrompt =
      'Tugas non-video: buat file `hello.txt` berisi `"ok-f3"` menggunakan tool `write`, lalu jalankan perintah shell `echo verified` via tool `bash` dan laporkan hasilnya.';
    const genMsgs = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, genSessId, genPrompt, modelObj, 90_000);
    const genCalls = collectToolCalls(genMsgs);
    const generalUsedWrite = genCalls.some((c) => c.name === "write" && c.status !== "error");
    const generalUsedBash = genCalls.some((c) => c.name === "bash" && c.status !== "error");
    const helloTxtExists = fs.existsSync(path.join(tempWorkspace, "hello.txt"));

    // 2. Video production turn with /mg-flat-vector (director -> motion-designer) without bash/codemode
    const vidSessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F3 Video Lean Profile", model: modelObj },
    });
    const vidSessId = vidSessRes.json?.data?.id ?? vidSessRes.json?.id;
    createdSessions.push(vidSessId);

    const vidPrompt =
      '/mg-flat-vector Buatkan video explainer 2 scene berjudul "F3 Profile Test" (preset portrait, tanpa voiceover/audio, durasi 2.5s per scene). Akhiri dengan `capture_film_preview`.';
    await sendAndWaitTurn(baseUrl, authHeader, dirQuery, vidSessId, vidPrompt, modelObj, 240_000);

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    const htmlPath = filmMeta?.htmlPath;
    const filmDir = htmlPath ? path.dirname(htmlPath) : "";
    const filmJson = filmDir && fs.existsSync(path.join(filmDir, "film.json"))
      ? JSON.parse(fs.readFileSync(path.join(filmDir, "film.json"), "utf8"))
      : null;

    const allSessRes = await api(baseUrl, `/api/session?${dirQuery}`, { authHeader });
    const allSess = allSessRes.json?.data ?? allSessRes.json ?? [];
    const videoRoleCalls = [];
    for (const s of Array.isArray(allSess) ? allSess : []) {
      if (s.id === genSessId) continue;
      const mRes = await api(baseUrl, `/api/session/${s.id}/message?order=asc&${dirQuery}`, { authHeader });
      videoRoleCalls.push(...collectToolCalls(extractMessages(mRes.json)));
    }
    const videoNoForbiddenTools = !videoRoleCalls.some((c) =>
      ["bash", "codemode", "apply_patch", "websearch", "plugin_install", "todowrite"].includes(c.name)
    );

    const checks = {
      generalUsedWrite,
      generalUsedBash,
      helloTxtExists,
      videoTwoScenes: Array.isArray(filmJson?.scenes) && filmJson.scenes.length === 2,
      videoLintValid: filmMeta?.lint?.valid === true,
      videoNoForbiddenTools,
    };
    console.log("[F3_CHECKS]", JSON.stringify(checks, null, 2));
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`F3 E2E failed checks: ${JSON.stringify(checks)}`);
    }
    console.log("[F3_E2E_RESULT] PASSED");
  } catch (err) {
    console.error("[ENGINE_LOGS_TAIL]", engineLogs.join("").slice(-3000));
    throw err;
  } finally {
    for (const sid of createdSessions) {
      await api(baseUrl, `/api/session/${sid}?${dirQuery}`, {
        method: "DELETE",
        authHeader,
      }).catch(() => {});
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
  }
}

main().catch((err) => {
  console.error("[F3_E2E_FATAL]", err);
  process.exit(1);
});
