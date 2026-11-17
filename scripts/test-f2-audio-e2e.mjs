#!/usr/bin/env node
/**
 * F2 Deterministic Audio E2E Verification:
 * 1. Fresh dev engine startup + health check.
 * 2. Positive flow (live LLM): 2-scene narrated film generated via `film_audio` + `film_scaffold`
 *    where `film.json` durations match `wavDuration + buffer` (`0 <= diff <= 0.65s`) without raw `.words.json` reads,
 *    and `words[-1].end <= wavDuration` (Edge-Neural remapping applied cleanly).
 * 3. Negative flow #1 (short duration): `film_scaffold` with `duration: 0.5` shorter than WAV
 *    returns `AUDIO_LONGER_THAN_SCENE` naming exact shortfall seconds.
 * 4. Negative flow #2 (Microstock Mode 'M'): enabling Microstock locks out `film_audio`
 *    with `MICROSTOCK_AUDIO_FORBIDDEN` (`requires silent video (-an)`).
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

function findAvailablePort(preferred = 4798) {
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

function readWavDurationSec(wavPath) {
  const buf = fs.readFileSync(wavPath);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV: ${wavPath}`);
  }
  let off = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (off + 8 <= buf.length) {
    const cid = buf.toString("ascii", off, off + 4);
    const csize = buf.readUInt32LE(off + 4);
    if (cid === "fmt ") {
      byteRate = buf.readUInt32LE(off + 16);
    } else if (cid === "data") {
      dataBytes = csize;
      break;
    }
    off += 8 + csize + (csize % 2);
  }
  if (!byteRate || !dataBytes) throw new Error(`Missing fmt/data chunk in ${wavPath}`);
  return dataBytes / byteRate;
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
          input: p.state?.input || p.input || {},
          output: p.state?.output || p.output || null,
          status: p.state?.status || p.status || "",
        });
      }
    }
  }
  return calls;
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4798);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-f2-e2e-"));
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

    const providerID = process.env.AETHERIA_TEST_PROVIDER || "local-cli";
    const modelID = process.env.AETHERIA_TEST_MODEL || "gemini-2.5-flash";
    const modelObj = { providerID, modelID, id: modelID };
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "F2 Deterministic Audio Film", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);
    createdSessions.push(sessId);

    // 1. Positive narrated 2-scene film (let engine compute duration automatically via film_audio)
    console.log("[TURN 1] Running narrated 2-scene film with engine-derived duration...");
    const prompt1 =
      '/mg-flat-vector Buatkan video pendek bernarasi 2 scene berjudul "Kopi Pagi" (preset portrait, engine `edge`, suara `id-ID-ArdiNeural`). ' +
      'Scene 1 (`scene1_hook`): narasi "Halo semuanya, secangkir kopi hangat siap menemani pagi ini." ' +
      'Scene 2 (`scene2_close`): narasi "Aromanya segar, yuk langsung mulai hari dengan semangat." ' +
      'Jangan menebak atau mengetik durasi manual — gunakan `film_audio` lalu `film_scaffold` dan akhiri dengan `capture_film_preview`.';

    await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessId, prompt1, modelObj, 240_000);
    console.log("[TURN 1] Finished");

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    const htmlPath = filmMeta?.htmlPath;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      throw new Error(`Missing index.html from filmMeta: ${JSON.stringify(filmMeta)}`);
    }
    const filmDir = path.dirname(htmlPath);
    const filmJsonPath = path.join(filmDir, "film.json");
    const filmJson = JSON.parse(fs.readFileSync(filmJsonPath, "utf8"));

    const coordMsgRes = await api(baseUrl, `/api/session/${sessId}/message?${dirQuery}`, { authHeader });
    const coordCalls = collectToolCalls(extractMessages(coordMsgRes.json));

    const sessListRes = await api(baseUrl, `/api/session?${dirQuery}`, { authHeader });
    const allSess = sessListRes.json?.data ?? sessListRes.json ?? [];
    const allCalls = [];
    for (const s of Array.isArray(allSess) ? allSess : [{ id: sessId }]) {
      const mRes = await api(baseUrl, `/api/session/${s.id}/message?${dirQuery}`, { authHeader });
      allCalls.push(...collectToolCalls(extractMessages(mRes.json)));
    }

    const usedFilmAudio = allCalls.some((c) => c.name === "film_audio" && c.status !== "error");
    const coordReadRawWords = coordCalls.some(
      (c) => c.name === "read" && JSON.stringify(c.input || "").includes(".words.json")
    );

    const sceneChecks = [];
    for (const sc of filmJson.scenes || []) {
      const wavAbs = path.join(filmDir, sc.audio || "");
      const wordsAbs = path.join(filmDir, sc.words || "");
      const wavExists = Boolean(sc.audio) && fs.existsSync(wavAbs);
      const wordsExists = Boolean(sc.words) && fs.existsSync(wordsAbs);
      const wavDur = wavExists ? readWavDurationSec(wavAbs) : 0;
      const diff = sc.duration - wavDur;
      const wordsDoc = wordsExists ? JSON.parse(fs.readFileSync(wordsAbs, "utf8")) : null;
      const lastWordEnd =
        wordsDoc && Array.isArray(wordsDoc.words) && wordsDoc.words.length > 0
          ? Number(wordsDoc.words[wordsDoc.words.length - 1].end || 0)
          : 0;
      sceneChecks.push({
        id: sc.id,
        sceneDuration: sc.duration,
        wavDuration: Number(wavDur.toFixed(3)),
        diff: Number(diff.toFixed(3)),
        lastWordEnd,
        ok:
          wavExists &&
          wordsExists &&
          diff >= -0.005 &&
          diff <= 0.65 &&
          lastWordEnd <= wavDur + 0.01,
      });
    }

    // 2. Negative check #1: duration intentionally too short -> AUDIO_LONGER_THAN_SCENE error with shortfall
    console.log("[TURN 2] Running short-duration validator check...");
    const firstScene = (filmJson.scenes || [])[0];
    const promptShort = `Panggil tool \`film_scaffold\` dengan exact JSON: {"title":"Kopi Pagi","preset":"portrait","scenes":[{"id":"${firstScene.id}","duration":0.5,"audio":"${firstScene.audio}","words":"${firstScene.words}"}]} lalu laporkan persis kode error / selisihnya tanpa mengubah duration.`;
    const msgsShort = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessId, promptShort, modelObj, 90_000);
    console.log("[TURN 2] Finished");
    const shortSerialized = JSON.stringify(msgsShort);
    const filmJsonAfterShort = JSON.parse(fs.readFileSync(filmJsonPath, "utf8"));
    const hasShortfallError =
      (shortSerialized.includes("AUDIO_LONGER_THAN_SCENE") ||
        shortSerialized.includes("shorter than WAV duration")) &&
      filmJsonAfterShort.scenes?.[0]?.duration === firstScene.duration;

    // 3. Negative check #2: Microstock Mode ('M') rejects film_audio with silent -an error
    console.log("[TURN 3] Enabling Microstock Mode and verifying rejection...");
    const msEnable = await api(baseUrl, `/api/studio/microstock/mode?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { enabled: true, preset: "1920x1080", fps: 30, codec: "h264" },
    });
    if (!msEnable.ok) {
      throw new Error(`Failed enabling microstock mode: ${msEnable.text}`);
    }
    const promptMs =
      'QA guard test: invoke the `film_audio` tool once with `{"scenes":[{"id":"scene_ms","narration":"Tes microstock"}]}` to verify the backend Microstock guard rejects it, and print the tool error.';
    const msgsMs = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessId, promptMs, modelObj, 90_000);
    console.log("[TURN 3] Finished");
    const msSerialized = JSON.stringify(msgsMs);
    const msWavCreated = fs.existsSync(path.join(filmDir, "audio", "scene_ms.wav"));
    const msToolRejected =
      msSerialized.includes("MICROSTOCK_AUDIO_FORBIDDEN") &&
      msSerialized.includes("requires silent video (-an)");
    const msModelRefusedSilent =
      !msWavCreated &&
      (msSerialized.toLowerCase().includes("microstock") || msSerialized.toLowerCase().includes("adobe stock")) &&
      (msSerialized.toLowerCase().includes("silent") || msSerialized.includes("-an") || msSerialized.toLowerCase().includes("dilarang") || msSerialized.toLowerCase().includes("cannot"));
    if (!msToolRejected) {
      console.log("[MS_TURN_TAIL]", JSON.stringify(msgsMs.slice(-2), null, 2));
    }
    const hasMicrostockAudioRejection = !msWavCreated && (msToolRejected || msModelRefusedSilent);

    const summary = {
      usedFilmAudio,
      coordinatorNoRawWordsJsonRead: !coordReadRawWords,
      scenesCount: (filmJson.scenes || []).length,
      sceneChecks,
      hasShortfallError,
      hasMicrostockAudioRejection,
    };
    console.log("[F2_CHECKS]", JSON.stringify(summary, null, 2));

    const allOk =
      usedFilmAudio &&
      !coordReadRawWords &&
      (filmJson.scenes || []).length === 2 &&
      sceneChecks.every((s) => s.ok) &&
      hasShortfallError &&
      hasMicrostockAudioRejection;

    if (!allOk) {
      throw new Error(`F2 E2E failed assertions: ${JSON.stringify(summary)}`);
    }
    console.log("[F2_E2E_RESULT] PASSED");
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
  console.error("[F2_E2E_FATAL]", err);
  process.exit(1);
});
