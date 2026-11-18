#!/usr/bin/env node
/**
 * E2E Verification: Project Isolation vs Stale Microstock Lock + Automatic SFX Synthesis & Agent Gate
 *
 * Pass Criteria:
 * 1. Engine health check (`GET /api/health` -> `healthy: true`).
 * 2. Starting a new TikTok/Reels narrated video session in a workspace whose previous active project
 *    had Adobe Stock Microstock Mode ('M') locked ON (`3840x2160`, `enabled: true`) automatically
 *    isolates into a new `projects/<slug>` folder (skipping reference URL line) and clears the stale lock.
 * 3. Calling `film_audio` WITHOUT `sfxCues` succeeds on the first try (`zero MICROSTOCK_* errors`) and
 *    automatically synthesizes `audio/sfx_<sceneId>.wav` + `audio/sfx_<sceneId>.json` for every scene,
 *    wiring `"sfx": "audio/sfx_<sceneId>.wav"` into both `film.json` and managed `index.html`.
 * 4. Agent Completion Gate (`collect_turn_completion_blockers` / `collect_film_completion_blockers`):
 *    if a narrated scene in `film.json` is missing its `sfx` track, the engine blocks premature completion
 *    and triggers an auto-continue turn until SFX + scene script + preview are complete.
 * 5. Negative & Recovery path: enabling Microstock Mode ('M') on the active project blocks `film_audio`
 *    with `MICROSTOCK_AUDIO_FORBIDDEN`, while passing `disableMicrostock: true` cleanly disables the lock.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startLiveStack } from "../e2e/live-stack.mjs";

const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

function readWavHeader(wavPath) {
  const buf = fs.readFileSync(wavPath);
  if (
    buf.length < 44 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`Invalid WAV file: ${wavPath}`);
  }
  let off = 12;
  let byteRate = 0;
  let dataBytes = 0;
  let peakAbs = 0;
  while (off + 8 <= buf.length) {
    const cid = buf.toString("ascii", off, off + 4);
    const csize = buf.readUInt32LE(off + 4);
    if (cid === "fmt ") {
      byteRate = buf.readUInt32LE(off + 16);
    } else if (cid === "data") {
      dataBytes = csize;
      const start = off + 8;
      const end = Math.min(buf.length, start + csize);
      for (let i = start; i + 1 < end; i += 2) {
        const sample = Math.abs(buf.readInt16LE(i));
        if (sample > peakAbs) peakAbs = sample;
      }
      break;
    }
    off += 8 + csize + (csize % 2);
  }
  if (!byteRate || !dataBytes) {
    throw new Error(`Missing fmt/data chunk in ${wavPath}`);
  }
  return { durationSec: dataBytes / byteRate, peakAbs };
}

async function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 45_000 } = {}) {
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
    req.on("timeout", () =>
      req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms on ${urlPath}`))
    );
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function startMockLlmServer() {
  let step = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-studio-e2e", object: "model" }] }));
        return;
      }
      const bodyStr = Buffer.concat(chunks).toString("utf8");
      let message;
      let finishReason = "stop";

      if (bodyStr.includes("CompletionGateSfxTest")) {
        if (bodyStr.includes("has voiceover audio") && bodyStr.includes("no SFX track")) {
          finishReason = "tool_calls";
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_gate_fix_sfx",
                type: "function",
                function: {
                  name: "film_audio",
                  arguments: JSON.stringify({
                    scenes: [
                      {
                        id: "scene1_hook",
                        narration: "Masih bayar render cloud buat konten TikTok? Bikin video otomatis seratus persen lokal.",
                      },
                      {
                        id: "scene2_cta",
                        narration: "Aetheria, studio video AI lokal di PC Windows.",
                      },
                    ],
                  }),
                },
              },
            ],
          };
        } else if (!bodyStr.includes("GateRecoveredSfxOk")) {
          // First attempt: touch film build via film_scaffold while sfx is missing -> must trigger completion gate!
          if (!bodyStr.includes("call_gate_touch")) {
            finishReason = "tool_calls";
            message = {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_gate_touch",
                  type: "function",
                  function: {
                    name: "film_scaffold",
                    arguments: JSON.stringify({
                      title: "Aetheria Product Promo - TikTok Reel",
                      preset: "portrait",
                      scenes: [
                        { id: "scene1_hook", duration: 6.0, audio: "audio/scene1_hook.wav" },
                        { id: "scene2_cta", duration: 5.0, audio: "audio/scene2_cta.wav" },
                      ],
                    }),
                  },
                },
              ],
            };
          } else {
            message = {
              role: "assistant",
              content: "GateRecoveredSfxOk: mencoba berhenti sebelum SFX ada.",
            };
          }
        } else {
          message = {
            role: "assistant",
            content: "GateRecoveredSfxOk: SFX berhasil dipulihkan lewat completion gate.",
          };
        }
      } else if (bodyStr.includes("DisableMicrostockTest")) {
        if (!bodyStr.includes("call_ms_disable")) {
          finishReason = "tool_calls";
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_ms_disable",
                type: "function",
                function: {
                  name: "film_audio",
                  arguments: JSON.stringify({
                    disableMicrostock: true,
                    scenes: [{ id: "scene1_hook", narration: "Halo dunia." }],
                  }),
                },
              },
            ],
          };
        } else {
          message = {
            role: "assistant",
            content: "Microstock disabled and audio + SFX generated.",
          };
        }
      } else if (bodyStr.includes("QaGuardTest")) {
        if (!bodyStr.includes("MICROSTOCK_AUDIO_FORBIDDEN")) {
          finishReason = "tool_calls";
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_ms_guard",
                type: "function",
                function: {
                  name: "film_audio",
                  arguments: JSON.stringify({
                    scenes: [{ id: "scene_ms", narration: "Tes microstock silent guard" }],
                  }),
                },
              },
            ],
          };
        } else {
          message = {
            role: "assistant",
            content: "Guard verified: MICROSTOCK_AUDIO_FORBIDDEN.",
          };
        }
      } else {
        step += 1;
        if (step === 1) {
          // Turn 1 Step 1: Coordinator calls film_audio WITHOUT sfxCues!
          finishReason = "tool_calls";
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_audio_1",
                type: "function",
                function: {
                  name: "film_audio",
                  arguments: JSON.stringify({
                    scenes: [
                      {
                        id: "scene1_hook",
                        narration: "Masih bayar render cloud buat konten TikTok? Bikin video otomatis seratus persen lokal.",
                      },
                      {
                        id: "scene2_cta",
                        narration: "Aetheria, studio video AI lokal di PC Windows.",
                      },
                    ],
                  }),
                },
              },
            ],
          };
        } else if (step === 2) {
          // Turn 1 Step 2: Coordinator calls film_scaffold omitting sfx and duration (must auto-preserve both!)
          finishReason = "tool_calls";
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_scaffold_1",
                type: "function",
                function: {
                  name: "film_scaffold",
                  arguments: JSON.stringify({
                    title: "Aetheria Product Promo - TikTok Reel",
                    preset: "portrait",
                    background: "#FFFFFF",
                    scenes: [
                      {
                        id: "scene1_hook",
                        title: "Hook",
                        audio: "audio/scene1_hook.wav",
                        words: "audio/scene1_hook.words.json",
                        accent: "#250497",
                      },
                      {
                        id: "scene2_cta",
                        title: "CTA",
                        audio: "audio/scene2_cta.wav",
                        words: "audio/scene2_cta.words.json",
                        accent: "#563DAA",
                      },
                    ],
                  }),
                },
              },
            ],
          };
        } else {
          message = {
            role: "assistant",
            content: "Audio, SFX, dan scaffold selesai tanpa error.",
          };
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          choices: [{ index: 0, finish_reason: finishReason, message }],
          usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
        })
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
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
  if (!info.time?.completed && !info.error && !info.finish) return false;
  let parts = last.parts ?? last.content ?? [];
  if (typeof parts === "string") {
    try {
      parts = JSON.parse(parts);
    } catch {
      parts = [];
    }
  }
  if (!Array.isArray(parts)) return true;
  return !parts.some(
    (p) =>
      (p.type === "tool" || p.type === "tool_use") &&
      (p.state?.status === "running" || p.state?.status === "pending")
  );
}

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs = 120_000) {
  const prevCount = extractMessages(
    (await api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, { authHeader })).json
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
    await new Promise((r) => setTimeout(r, 500));
    const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?order=asc&${dirQuery}`, {
      authHeader,
    });
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
    if (assistants.length > prevCount && isTurnFinished(msgs)) {
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn`);
}

function collectToolCalls(msgs) {
  const out = [];
  for (const m of msgs) {
    let parts = m?.parts ?? m?.content ?? [];
    if (typeof parts === "string") {
      try {
        parts = JSON.parse(parts);
      } catch {
        parts = [];
      }
    }
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (p?.type === "tool" || p?.tool || p?.name) {
        out.push({
          name: p.tool || p.name,
          status: p?.state?.status ?? p?.status,
          input: p?.state?.input ?? p?.input,
          structured: p?.state?.structured,
        });
      }
    }
  }
  return out;
}

async function main() {
  const mockLlm = await startMockLlmServer();
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-e2e": {
            name: "Mock E2E Provider",
            type: "openai",
            options: {
              baseURL: mockLlm.url,
              apiKey: "sk-mock-key",
            },
            models: {
              "mock-studio-e2e": { name: "Mock Studio E2E" },
            },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;

    // 1. Verify GET /api/health -> healthy: true
    const healthRes = await api(baseUrl, "/api/health", { authHeader });
    const healthy = Boolean(
      healthRes.ok && (healthRes.json?.healthy === true || healthRes.json?.data?.healthy === true)
    );
    if (!healthy) throw new Error(`Engine health check failed: ${healthRes.text}`);

    // Seed an existing stale Microstock project ("buat-animasinya-ini-untuk-micsrostock") with 'M' ON!
    const staleSlug = "buat-animasinya-ini-untuk-micsrostock";
    const staleDir = path.join(wsDir, "projects", staleSlug);
    fs.mkdirSync(path.join(staleDir, "microstock"), { recursive: true });
    fs.mkdirSync(path.join(wsDir, ".aetheria"), { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, ".aetheria", "active-project.json"),
      JSON.stringify({ project: staleSlug }, null, 2)
    );
    fs.writeFileSync(
      path.join(wsDir, ".aetheria", "microstock-mode.json"),
      JSON.stringify({ enabled: true, preset: "3840x2160", fps: 30 }, null, 2)
    );
    fs.writeFileSync(
      path.join(staleDir, "microstock", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, enabled: true, preset: "3840x2160", fps: 30, codec: "h264" }, null, 2)
    );
    fs.writeFileSync(path.join(staleDir, "index.html"), "<html><title>Old Microstock</title></html>");

    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-e2e", modelID: "mock-studio-e2e", id: "mock-studio-e2e" };

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Aetheria TikTok Profile E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);

    // 2. Send the exact prompt pattern (with reference URL on line 1 + "portrait" + "rapi" in storyline)
    const userPrompt =
      'ini contohnya https://pin.it/3L9k7puLg\n\n' +
      'Buatkan video profil produk tentang "Aetheria (ArunakiNexus)" untuk format TikTok / Reels (9:16, 1080x1920, 30fps, durasi sekitar 30–35 detik).\n\n' +
      'Scene 1 — Hook: judul besar rapi dengan rasio portrait.\n' +
      'Scene 2 — CTA: Aetheria Studio Video AI Lokal.';

    const msgs1 = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessId, userPrompt, modelObj);
    const calls1 = collectToolCalls(msgs1);

    const activeMarker = JSON.parse(
      fs.readFileSync(path.join(wsDir, ".aetheria", "active-project.json"), "utf8")
    );
    const activeSlug = activeMarker.project;
    const projectDir = path.join(wsDir, "projects", activeSlug);
    const filmJsonPath = path.join(projectDir, "film.json");
    const indexHtmlPath = path.join(projectDir, "index.html");
    const filmJson = JSON.parse(fs.readFileSync(filmJsonPath, "utf8"));
    const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");

    // Pre-author the 2 scene scripts so the completion gate doesn't flag stub scripts on subsequent guard turns
    fs.writeFileSync(
      path.join(projectDir, "script", "scene1.js"),
      "window.AM.registerScene('scene1_hook', function(ctx, t, dur) { ctx.fillStyle='#250497'; ctx.fillRect(0,0,1080,1920); });\n"
    );
    fs.writeFileSync(
      path.join(projectDir, "script", "scene2.js"),
      "window.AM.registerScene('scene2_cta', function(ctx, t, dur) { ctx.fillStyle='#563DAA'; ctx.fillRect(0,0,1080,1920); });\n"
    );

    const failedCalls = calls1.filter(
      (c) => c.status === "error" || c.structured?.ok === false
    );

    const sfxChecks = (filmJson.scenes || []).map((sc) => {
      const sfxRel = sc.sfx;
      const sfxAbs = sfxRel ? path.join(projectDir, sfxRel) : "";
      const sfxJsonAbs = path.join(projectDir, "audio", `sfx_${sc.id}.json`);
      const wavExists = Boolean(sfxRel) && fs.existsSync(sfxAbs);
      const jsonExists = fs.existsSync(sfxJsonAbs);
      const wavInfo = wavExists ? readWavHeader(sfxAbs) : { durationSec: 0, peakAbs: 0 };
      const cueDoc = jsonExists ? JSON.parse(fs.readFileSync(sfxJsonAbs, "utf8")) : null;
      return {
        id: sc.id,
        sfx: sfxRel,
        wavExists,
        jsonExists,
        cuesCount: cueDoc?.cues?.length ?? 0,
        durationSec: Number(wavInfo.durationSec.toFixed(3)),
        peakAbs: wavInfo.peakAbs,
        inIndexHtml: Boolean(sfxRel) && indexHtml.includes(sfxRel),
        ok:
          wavExists &&
          jsonExists &&
          (cueDoc?.cues?.length ?? 0) >= 2 &&
          wavInfo.peakAbs > 500 &&
          indexHtml.includes(sfxRel),
      };
    });

    // 3. Negative path: explicitly enable Microstock Mode ('M') on the active project and verify MICROSTOCK_AUDIO_FORBIDDEN
    const msEnable = await api(baseUrl, `/api/studio/microstock/mode?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { enabled: true, preset: "1920x1080", fps: 30, codec: "h264" },
    });
    if (!msEnable.ok) throw new Error(`Failed enabling microstock mode: ${msEnable.text}`);

    const msgsGuard = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      sessId,
      "QaGuardTest: verify microstock audio guard",
      modelObj
    );
    const guardCalls = collectToolCalls(msgsGuard);
    const guardRejected = guardCalls.some(
      (c) =>
        c.name === "film_audio" &&
        c.structured?.code === "MICROSTOCK_AUDIO_FORBIDDEN"
    );

    // 4. Recovery path: calling film_audio with disableMicrostock: true cleanly disables lock and synthesizes audio + SFX
    const msgsDisable = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      sessId,
      "DisableMicrostockTest: Mode microstock berhasil dimatikan otomatis",
      modelObj
    );
    const disableCalls = collectToolCalls(msgsDisable);
    const disableSucceeded = disableCalls.some(
      (c) =>
        c.name === "film_audio" &&
        c.input?.disableMicrostock === true &&
        c.structured?.ok === true
    );

    // 5. Completion Gate enforcement: remove sfx_scene1_hook.wav from disk + film.json and verify gate forces recovery
    fs.rmSync(path.join(projectDir, "audio", "sfx_scene1_hook.wav"), { force: true });
    fs.rmSync(path.join(projectDir, "audio", "sfx_scene2_cta.wav"), { force: true });
    const strippedFilm = JSON.parse(fs.readFileSync(filmJsonPath, "utf8"));
    for (const sc of strippedFilm.scenes || []) sc.sfx = null;
    fs.writeFileSync(filmJsonPath, JSON.stringify(strippedFilm, null, 2));

    const msgsGate = await sendAndWaitTurn(
      baseUrl,
      authHeader,
      dirQuery,
      sessId,
      "CompletionGateSfxTest: pastikan completion gate menolak film bernarasi tanpa SFX lalu memulihkannya",
      modelObj
    );
    const gateCalls = collectToolCalls(msgsGate);
    const gateForcedSfxRecovery =
      gateCalls.some((c) => c.name === "film_audio" && c.structured?.ok === true) &&
      fs.existsSync(path.join(projectDir, "audio", "sfx_scene1_hook.wav")) &&
      fs.existsSync(path.join(projectDir, "audio", "sfx_scene2_cta.wav"));

    const summary = {
      healthy,
      switchedAwayFromStaleMicrostockProject:
        activeSlug !== staleSlug && activeSlug.includes("aetheria") && !activeSlug.includes("pin-it"),
      activeSlug,
      zeroFailedToolCallsOnTurn1: failedCalls.length === 0,
      failedCallsCount: failedCalls.length,
      allScenesHaveAutoSfxAndNonZeroAudio:
        sfxChecks.length === 2 && sfxChecks.every((c) => c.ok),
      sfxChecks,
      negativeMicrostockGuardRejected: guardRejected,
      recoveryDisableMicrostockSucceeded: disableSucceeded,
      completionGateEnforcedAndRecoveredSfx: gateForcedSfxRecovery,
    };

    console.log("[SFX_ISOLATION_E2E]", JSON.stringify(summary, null, 2));

    if (
      !summary.healthy ||
      !summary.switchedAwayFromStaleMicrostockProject ||
      !summary.zeroFailedToolCallsOnTurn1 ||
      !summary.allScenesHaveAutoSfxAndNonZeroAudio ||
      !summary.negativeMicrostockGuardRejected ||
      !summary.recoveryDisableMicrostockSucceeded ||
      !summary.completionGateEnforcedAndRecoveredSfx
    ) {
      process.exitCode = 1;
    }
  } finally {
    await stack?.stop();
    await mockLlm.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[SFX_ISOLATION_E2E_ERROR]", err);
  process.exit(1);
});
