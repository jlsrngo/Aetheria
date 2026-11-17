#!/usr/bin/env node
/**
 * F1 E2E Verification:
 * 1. Rebuilt dev engine health + auth rejection (negative check).
 * 2. General non-video chat turn leaves workspace clean (no film.json / index.html).
 * 3. Live 2-scene video turn with `/mg-flat-vector` produces `film.json` + `index.html`
 *    via `film_scaffold` WITHOUT any manual `write`/`edit`/`apply_patch` on `index.html`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function findAvailablePort(preferred = 4797) {
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
    // non-json
  }
  return { ok: res.ok, status: res.status, text, json };
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
    (await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader })).json
  ).filter((m) => (m.info?.role ?? m.role) === "assistant").length;

  const sendRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
    method: "POST",
    authHeader,
    body: { model: modelObj, prompt: { text } },
  });
  if (!sendRes.ok) {
    throw new Error(`POST prompt failed (${sendRes.status}): ${sendRes.text}`);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader });
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

function resolveModelObj() {
  const providerID = process.env.AETHERIA_TEST_PROVIDER || "local-cli";
  const modelID = process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash";
  return { providerID, modelID, id: modelID };
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
        const name = p.tool || p.name || "";
        const input = p.state?.input || p.input || {};
        const status = p.state?.status || p.status || "";
        calls.push({ name, input, status });
      }
    }
  }
  return calls;
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4797);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f1-e2e-"));
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
    let lastHealthErr = "";
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await api(baseUrl, "/api/health", { authHeader });
        if (res.ok && (res.json?.data?.healthy ?? res.json?.healthy)) {
          healthy = true;
          break;
        }
        lastHealthErr = `status=${res.status} ${res.text}`;
      } catch (e) {
        lastHealthErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (!healthy) {
      throw new Error(`Engine did not become healthy (${lastHealthErr})\n${engineLogs.join("")}`);
    }
    console.log("[HEALTH] ok", path.basename(engineBin));

    // Negative check 1: unauthorized request + invalid session
    const unauth = await fetch(`${baseUrl}/api/health`);
    const badSess = await api(baseUrl, `/api/session/missing-f1/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { prompt: { text: "hi" } },
    });
    if (unauth.status !== 401 || badSess.status < 400) {
      throw new Error(`Negative HTTP checks failed: unauth=${unauth.status} badSess=${badSess.status}`);
    }
    console.log("[NEGATIVE_CHECK] ok", { unauth: unauth.status, badSess: badSess.status });

    const modelObj = resolveModelObj();
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    // General chat check: must NOT produce video artifacts
    const chatRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F1 General Chat Check", model: modelObj },
    });
    const chatSessId = chatRes.json?.data?.id ?? chatRes.json?.id;
    if (!chatSessId) throw new Error(`Missing chatSessId: ${chatRes.text}`);
    createdSessions.push(chatSessId);

    const chatMsgs = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      chatSessId,
      "Jelaskan bedanya `const` dan `let` di JavaScript dalam 1 kalimat singkat.",
      modelObj,
      90_000
    );
    const chatErr = chatMsgs
      .filter((m) => (m.info?.role ?? m.role) === "assistant")
      .map((m) => (m.info ?? m).error)
      .filter(Boolean);
    if (chatErr.length > 0) {
      throw new Error(`General chat turn errored (provider blocked?): ${JSON.stringify(chatErr)}`);
    }
    if (fs.existsSync(path.join(tempWorkspace, "film.json")) || fs.existsSync(path.join(tempWorkspace, "projects"))) {
      throw new Error("General chat unexpectedly created film project files");
    }
    console.log("[GENERAL_CHAT] ok (no video artifacts created)");

    // Positive F1 video turn with /mg-flat-vector active (no manual index.html)
    const videoRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F1 Flat Vector 2-Scene", model: modelObj },
    });
    const videoSessId = videoRes.json?.data?.id ?? videoRes.json?.id;
    if (!videoSessId) throw new Error(`Missing videoSessId: ${videoRes.text}`);
    createdSessions.push(videoSessId);

    const videoPrompt =
      '/mg-flat-vector Buatkan video 2 scene (masing-masing 2.5 detik, judul "Pulse Intro", preset portrait, tanpa voiceover/audio). Scene 1 (`scene1_hook`): lingkaran coral muncul elastis di atas latar flat cream. Scene 2 (`scene2_lockup`): transisi shape wipe membuka badge logo "PULSE" dengan spring settle. Akhiri dengan `capture_film_preview`.';

    const videoMsgs = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      videoSessId,
      videoPrompt,
      modelObj,
      240_000
    );

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    const htmlPath = filmMeta?.htmlPath;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      throw new Error(`Managed index.html missing in film-meta: ${JSON.stringify(filmMeta)}`);
    }

    const filmDir = path.dirname(htmlPath);
    const filmJsonPath = path.join(filmDir, "film.json");
    if (!fs.existsSync(filmJsonPath)) {
      throw new Error(`film.json missing at ${filmJsonPath}`);
    }
    const filmJson = JSON.parse(fs.readFileSync(filmJsonPath, "utf8"));
    const indexHtml = fs.readFileSync(htmlPath, "utf8");

    // Inspect all sessions in this temp workspace for any manual index.html write/edit
    const sessListRes = await api(baseUrl, `/api/session?${dirQuery}`, { authHeader });
    const allSess = sessListRes.json?.data ?? sessListRes.json ?? [];
    const allToolCalls = [];
    for (const s of Array.isArray(allSess) ? allSess : [{ id: videoSessId }]) {
      const mRes = await api(baseUrl, `/api/session/${s.id}/message?${dirQuery}`, { authHeader });
      allToolCalls.push(...collectToolCalls(extractMessages(mRes.json)));
    }

    const scaffoldCalled = allToolCalls.some((c) => c.name === "film_scaffold" && c.status !== "error");
    const manualIndexTouch = allToolCalls.filter((c) => {
      if (!["write", "edit", "apply_patch"].includes(c.name)) return false;
      const serialized = JSON.stringify(c.input || "").toLowerCase();
      return serialized.includes("index.html");
    });

    const scene1Path = path.join(filmDir, "script", "scene1.js");
    const scene2Path = path.join(filmDir, "script", "scene2.js");
    const scene1Text = fs.existsSync(scene1Path) ? fs.readFileSync(scene1Path, "utf8") : "";
    const scene2Text = fs.existsSync(scene2Path) ? fs.readFileSync(scene2Path, "utf8") : "";

    const previewDir = path.join(filmDir, ".aetheria", "preview");
    const previews = fs.existsSync(previewDir)
      ? fs.readdirSync(previewDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      : [];
    const distinctHashes = new Set(
      previews.map((f) =>
        crypto.createHash("sha1").update(fs.readFileSync(path.join(previewDir, f))).digest("hex")
      )
    );

    const checks = {
      scaffoldCalled,
      noManualIndexHtmlWriteOrEdit: manualIndexTouch.length === 0,
      manageIndexHtmlTrue: filmJson.manageIndexHtml === true,
      managedSignaturePresent:
        indexHtml.includes("window.__filmMeta") &&
        indexHtml.includes("window.AM.resolveScene"),
      twoScenes: Array.isArray(filmJson.scenes) && filmJson.scenes.length === 2,
      scene1Written:
        scene1Text.includes("AM.registerScene") &&
        !scene1Text.includes("managed stub by film_scaffold"),
      scene2Written:
        scene2Text.includes("AM.registerScene") &&
        !scene2Text.includes("managed stub by film_scaffold"),
      lintValid: filmMeta?.lint?.valid === true,
      previewsDistinct: distinctHashes.size >= 2,
    };

    console.log("[F1_CHECKS]", JSON.stringify({ ...checks, manualIndexTouch, previewsCount: previews.length }, null, 2));

    const allOk = Object.values(checks).every(Boolean);
    if (!allOk) {
      throw new Error(`F1 E2E failed checks: ${JSON.stringify(checks)}`);
    }
    console.log("[F1_E2E_RESULT] PASSED");
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
  console.error("[F1_E2E_FATAL]", err);
  process.exit(1);
});
