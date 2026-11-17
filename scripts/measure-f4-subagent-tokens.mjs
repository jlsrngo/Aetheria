#!/usr/bin/env node
/**
 * F4.2 Baseline Measurement (before changing DEFAULT_SUBAGENT_MAX_TOKENS = 4096):
 * Runs 2 heavy multi-scene motion-designer tasks on live engine at max_tokens=4096
 * and aggregates outputLimitHits, scene write char/line sizes, and engine telemetry.
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

function findAvailablePort(preferred = 4819) {
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

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs = 300_000) {
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
    await new Promise((r) => setTimeout(r, 3000));
    const [msgRes, jobsRes] = await Promise.all([
      api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, {
        authHeader,
        timeoutMs: 20_000,
      }),
      api(baseUrl, `/api/session/${sessionID}/jobs`, { authHeader, timeoutMs: 10_000 }).catch(() => null),
    ]);
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
    const jobs = jobsRes?.json?.data ?? [];
    const hasRunningJob = Array.isArray(jobs) && jobs.some((j) => j.status === "running");
    if (assistants.length > prevCount && isTurnFinished(msgs) && !hasRunningJob) {
      await new Promise((r) => setTimeout(r, 1000));
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn`);
}

function setupIsolatedXdgConfig(overrideAgent = {}) {
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f4-cfg-"));
  const cfgSubdir = path.join(xdgDir, "aetheria-nexus");
  fs.mkdirSync(cfgSubdir, { recursive: true });
  const srcCfg = path.join(os.homedir(), ".config", "aetheria-nexus", "aetheria.json");
  let baseCfg = {};
  if (fs.existsSync(srcCfg)) {
    baseCfg = JSON.parse(fs.readFileSync(srcCfg, "utf8"));
  }
  baseCfg.agent = { ...(baseCfg.agent || {}), ...overrideAgent };
  fs.writeFileSync(path.join(cfgSubdir, "aetheria.json"), JSON.stringify(baseCfg, null, 2), "utf8");
  return xdgDir;
}

async function runCase({ label, prompt, overrideAgent = {} }) {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4819);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f4-meas-"));
  const xdgConfig = setupIsolatedXdgConfig(overrideAgent);
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
    if (!healthy) throw new Error(`Health check failed for ${label}`);

    const providerID = process.env.AETHERIA_TEST_PROVIDER || "local-cli";
    const modelID = process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash";
    const modelObj = { providerID, modelID, id: modelID };
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: `F4 Measure: ${label}`, model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    createdSessions.push(sessId);

    const t0 = Date.now();
    let timedOut = false;
    try {
      await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessId, prompt, modelObj, 360_000);
    } catch (err) {
      if (String(err?.message || err).includes("Timed out")) {
        timedOut = true;
      } else {
        throw err;
      }
    }
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    const htmlPath = filmMeta?.htmlPath;
    const filmDir = htmlPath ? path.dirname(htmlPath) : "";
    const scriptFiles = [];
    if (filmDir && fs.existsSync(path.join(filmDir, "script"))) {
      for (const f of fs.readdirSync(path.join(filmDir, "script"))) {
        if (!f.endsWith(".js") || f === "aetheria-motion.js" || f === "three.min.js") continue;
        const full = path.join(filmDir, "script", f);
        const content = fs.readFileSync(full, "utf8");
        scriptFiles.push({
          file: f,
          chars: content.length,
          lines: content.split(/\r?\n/).length,
          approxTokens: Math.ceil(content.length / 4),
        });
      }
    }

    const logText = engineLogs.join("");
    const limitLines = logText.split(/\r?\n/).filter((l) => l.includes("[F4_LENGTH_LIMIT]"));
    const summaryLines = logText.split(/\r?\n/).filter((l) => l.includes("[F4_SUBAGENT_SUMMARY]"));

    return {
      label,
      timedOut,
      elapsedSec,
      lintValid: filmMeta?.lint?.valid ?? false,
      scenesCount: filmMeta?.scenes?.length ?? filmMeta?.scenesCount ?? 0,
      lengthLimitHits: limitLines.length,
      limitLines,
      summaryLines,
      scriptFiles,
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

async function main() {
  const results = [];
  results.push(
    await runCase({
      label: "mg-soft-clay-story-3scene-4096",
      overrideAgent: { "motion-designer": { max_tokens: 4096 } },
      prompt:
        '/mg-soft-clay-story Buatkan video 3 scene berjudul "Perjalanan Biji Kopi" (portrait 1080x1920, tanpa voiceover/audio, durasi 3s per scene) lengkap dengan build karakter & diorama 3D clay per scene. Akhiri dengan `capture_film_preview`.',
    })
  );
  results.push(
    await runCase({
      label: "mg-kinetic-type-3scene-4096",
      overrideAgent: { "motion-designer": { max_tokens: 4096 } },
      prompt:
        '/mg-kinetic-type Buatkan video tipografi kinetik 3 scene berjudul "Empat Prinsip Desain Gerak" (portrait 1080x1920, tanpa voiceover/audio, durasi 3s per scene) dengan animasi tipografi dan geometris detail di tiap scene. Akhiri dengan `capture_film_preview`.',
    })
  );

  const outDir = path.join(REPO_ROOT, "scripts", "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outJson = path.join(outDir, "f4-tokens-baseline.json");
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2), "utf8");
  console.log("[F4_MEASURE_DONE]", JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("[F4_MEASURE_FATAL]", err);
  process.exit(1);
});
