#!/usr/bin/env node
/**
 * OpenCode-Parity + Hybrid Web Native Stage E2E Verification (`AGENTS.md` §3.3).
 *
 * Proves against the live compiled Rust `aetheria-engine` HTTP server:
 *   Scenario A (OpenCode-parity continuous single-session Hybrid build):
 *     1. `9router` + `ComboMaut` + `variant: "high"` sends `reasoning_effort: "high"`,
 *        `max_tokens >= 32000`, `x-session-affinity` & `x-session-id` headers on every request,
 *        and never triggers `direct_scene_remake` even when `ref/` exists.
 *     2. Reading `ref/extracted/*.png` + workspace files delivers multimodal images directly.
 *     3. Crossing step >= 28 AND `messages.length > 65` does NOT trigger `[Emergency Context Auto-Heal]`.
 *     4. `film_scaffold(..., { stageMode: "hybrid" })` creates `index.html` + `film.json` without `script/scene*.js` stubs.
 *     5. Failure path: writing broken `window.renderAt` causes `capture_film_preview` -> `ok: false` without crashing engine.
 *     6. Surgical fix to real Hybrid HTML+CSS3D+SVG+Canvas -> `capture_film_preview({ visualInspectOnly: true, includeFullResFrames: true })`
 *        returns `ok: true`, `visualInspectOnly: true`, `fidelityFailed: false`, attaches full-res frames even with `ref/` present.
 *     7. Surgical `edit` + second `capture_film_preview` reuses warm Chromium CDP (`reusedWarmBrowser === true`, `changedSinceLastCapture === true`).
 *     8. Direct `read` on `.aetheria/preview/preview_0.jpg` works cleanly before finishing.
 *   Scenario B (> 51 step ceiling removal):
 *     - Second continuous session completes 54 unique tool steps without hitting the old 51-step limit.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { startLiveStack } from "../e2e/live-stack.mjs";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeSolidPng(width, height, [r, g, b]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = (r + ((x * 2) % 40)) & 0xff;
      raw[p + 1] = (g + ((y * 2) % 40)) & 0xff;
      raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function api(baseUrl, route, { method = "GET", authHeader, body } = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
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

function buildBrokenHybridHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Broken Hybrid</title>
</head>
<body>
  <div id="stage" style="width:1280px;height:720px;background:#0f172a;"></div>
  <script>
    window.__filmMeta = {
      title: "OpenCode Parity Hybrid",
      width: 1280,
      height: 720,
      fps: 30,
      duration: 3.0,
      stageMode: "hybrid",
      scenes: [
        { id: "intro", start: 0, duration: 1.5 },
        { id: "climax", start: 1.5, duration: 1.5 }
      ]
    };
    window.renderAt = function () {
      throw new Error("intentional broken renderAt");
    };
    window.__ready = true;
  </script>
</body>
</html>
`;
}

function buildWorkingHybridHtml(headlineText = "HYBRID ENGINE PARITY") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>OpenCode Parity Hybrid</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #070b14; }
    #stage {
      position: relative;
      width: 1280px;
      height: 720px;
      overflow: hidden;
      background: radial-gradient(circle at 50% 35%, #1e1b4b 0%, #070b14 75%);
      perspective: 1400px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .grid-wrap {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      transform-style: preserve-3d;
    }
    #hero-panel {
      width: 760px;
      padding: 44px 52px;
      border-radius: 24px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(14, 165, 233, 0.16));
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #f8fafc;
      transform-style: preserve-3d;
    }
    #hero-title {
      font-size: 54px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    #svg-layer, #fx-canvas {
      position: absolute;
      inset: 0;
      width: 1280px;
      height: 720px;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="stage">
    <svg id="svg-layer" viewBox="0 0 1280 720" width="1280" height="720">
      <defs>
        <filter id="halo-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <circle id="svg-halo" cx="640" cy="360" r="140" fill="none" stroke="#38bdf8" stroke-width="6" filter="url(#halo-blur)" />
      <rect id="svg-bar" x="120" y="610" width="100" height="12" rx="6" fill="#f59e0b" />
    </svg>
    <div class="grid-wrap">
      <div id="hero-panel">
        <div id="hero-title">${headlineText}</div>
      </div>
    </div>
    <canvas id="fx-canvas" width="1280" height="720"></canvas>
  </div>
  <script>
    (function () {
      var DURATION = 3.0;
      window.__filmMeta = {
        title: "OpenCode Parity Hybrid",
        width: 1280,
        height: 720,
        fps: 30,
        duration: DURATION,
        stageMode: "hybrid",
        scenes: [
          { id: "intro", start: 0, duration: 1.5 },
          { id: "climax", start: 1.5, duration: 1.5 }
        ]
      };
      var panel = document.getElementById("hero-panel");
      var halo = document.getElementById("svg-halo");
      var bar = document.getElementById("svg-bar");
      var canvas = document.getElementById("fx-canvas");
      var ctx = canvas.getContext("2d");

      window.renderAt = function (t) {
        var clamped = Math.max(0, Math.min(DURATION, Number(t) || 0));
        var p = clamped / DURATION;
        panel.style.transform =
          "translate3d(0, " + ((0.5 - p) * 70).toFixed(2) + "px, 0) rotateY(" + (-18 + p * 36).toFixed(2) + "deg)";
        halo.setAttribute("r", String(120 + p * 170));
        halo.setAttribute("cx", String(380 + p * 520));
        bar.setAttribute("width", String(120 + p * 920));
        ctx.clearRect(0, 0, 1280, 720);
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(180 + p * 920, 140 + Math.sin(p * Math.PI) * 80, 34, 0, Math.PI * 2);
        ctx.fill();
      };
      window.renderAt(0);
      window.__ready = true;
    })();
  </script>
</body>
</html>
`;
}

function startParityMockLlm() {
  const sessionStates = new Map();

  function getOrInitState(sessionId) {
    if (!sessionStates.has(sessionId)) {
      sessionStates.set(sessionId, {
        step: 0,
        done: false,
        maxMessagesLen: 0,
        sawEmergencyHeal: false,
        sawHybridPromptContract: false,
        sawAmApiReference: false,
        sawForcedScaffoldAfterDirective: false,
        sawRefImagePayload: false,
        sawPreviewVisionImagePayload: false,
        sawReadPreviewImagePayload: false,
        scaffoldResult: null,
        brokenPreviewResult: null,
        firstPreviewResult: null,
        secondPreviewResult: null,
        lastHeaders: null,
        lastReasoningEffort: null,
        lastMaxTokens: null,
        assertionsFailed: [],
      });
    }
    return sessionStates.get(sessionId);
  }

  function hasImagePayload(messages) {
    return JSON.stringify(messages).includes("data:image/");
  }

  function extractToolText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((p) => p && p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
    }
    return "";
  }

  function latestToolResult(messages, toolName, toolCallId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const matches =
        m.role === "tool" &&
        (m.name === toolName || (toolCallId && m.tool_call_id === toolCallId));
      if (!matches) continue;
      const text = extractToolText(m.content);
      try {
        return JSON.parse(text);
      } catch {
        return { _rawText: text };
      }
    }
    return null;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "ComboMaut", object: "model" }] }));
        return;
      }

      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const affinityId = String(req.headers["x-session-affinity"] || "");
      const headerSessId = String(req.headers["x-session-id"] || "");
      const state = getOrInitState(affinityId || "missing");

      state.step += 1;
      if (process.env.DEBUG) {
        console.log(`[opencode-parity-e2e] LLM req session=${affinityId} step=${state.step} msgs=${messages.length}`);
      }
      state.maxMessagesLen = Math.max(state.maxMessagesLen, messages.length);
      state.lastHeaders = {
        affinity: affinityId,
        sessionId: headerSessId,
      };
      state.lastReasoningEffort = body.reasoning_effort ?? null;
      state.lastMaxTokens = body.max_tokens ?? null;

      if (!affinityId || affinityId !== headerSessId) {
        state.assertionsFailed.push(
          `Step ${state.step}: expected matching x-session-affinity/x-session-id headers, got '${affinityId}' vs '${headerSessId}'`
        );
      }
      if (body.reasoning_effort !== "high") {
        state.assertionsFailed.push(
          `Step ${state.step}: expected reasoning_effort === "high", got ${JSON.stringify(body.reasoning_effort)}`
        );
      }
      if (!(Number(body.max_tokens) >= 32000)) {
        state.assertionsFailed.push(
          `Step ${state.step}: expected max_tokens >= 32000, got ${body.max_tokens}`
        );
      }

      const sysText = String(messages[0]?.content || "");
      if (sysText.includes("stageMode: \"hybrid\"")) {
        state.sawHybridPromptContract = true;
      }
      const serialized = JSON.stringify(messages);
      if (serialized.includes("<am_runtime_api_reference>")) {
        state.sawAmApiReference = true;
      }
      if (serialized.includes("direct vision-first per-scene remake compiler right after film_scaffold")) {
        state.sawForcedScaffoldAfterDirective = true;
      }
      if (serialized.includes("[Emergency Context Auto-Heal]")) {
        state.sawEmergencyHeal = true;
      }

      const respond = (msgObj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `cmpl-${Date.now()}-${state.step}`,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                finish_reason: msgObj.tool_calls ? "tool_calls" : "stop",
                message: msgObj,
              },
            ],
            usage: { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 },
          })
        );
      };

      const promptStr = String(messages[1]?.content || "");
      const isZeroFlagScenario = promptStr.includes("Buat animasi showreel 1280x720 dari referensi di ref.");
      const isLongScenario = promptStr.includes("SCENARIO_B_54_STEPS");

      if (isZeroFlagScenario) {
        if (state.step === 1) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "c_write_direct_html",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "index.html",
                    content: buildWorkingHybridHtml("AUTONOMOUS ZERO-FLAG"),
                  }),
                },
              },
            ],
          });
        }
        if (state.step === 2) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "c_preview_zero_flags",
                type: "function",
                function: {
                  name: "capture_film_preview",
                  arguments: JSON.stringify({
                    timestamps: [0.5, 1.5],
                  }),
                },
              },
            ],
          });
        }
        if (state.step === 3 && hasImagePayload(messages.slice(-3))) {
          state.sawPreviewVisionImagePayload = true;
        }
        state.done = true;
        return respond({
          role: "assistant",
          content: "SCENARIO_C_COMPLETE",
        });
      }

      if (isLongScenario) {
        if (state.step <= 54) {
          const idx = String(state.step).padStart(2, "0");
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `b_read_${idx}`,
                type: "function",
                function: {
                  name: "read",
                  arguments: JSON.stringify({ filePath: `ref/batch_${idx}.txt` }),
                },
              },
            ],
          });
        }
        state.done = true;
        return respond({
          role: "assistant",
          content: "SCENARIO_B_COMPLETE",
        });
      }

      // Scenario A (32-step OpenCode-parity hybrid run)
      const s = state.step;
      if (s === 1) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_img_1",
              type: "function",
              function: { name: "read", arguments: JSON.stringify({ filePath: "ref/extracted/keyframe_001.png" }) },
            },
            {
              id: "a_img_2",
              type: "function",
              function: { name: "read", arguments: JSON.stringify({ filePath: "ref/extracted/keyframe_002.png" }) },
            },
            {
              id: "a_style",
              type: "function",
              function: { name: "read", arguments: JSON.stringify({ filePath: "ref/extracted/style.json" }) },
            },
          ],
        });
      }

      if (s === 2) {
        if (hasImagePayload(messages)) {
          state.sawRefImagePayload = true;
        }
      }

      if (s >= 2 && s <= 20) {
        const aIdx = String((s - 1) * 2).padStart(2, "0");
        const bIdx = String((s - 1) * 2 + 1).padStart(2, "0");
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `a_note_a_${s}`,
              type: "function",
              function: { name: "read", arguments: JSON.stringify({ filePath: `ref/batch_${aIdx}.txt` }) },
            },
            {
              id: `a_note_b_${s}`,
              type: "function",
              function: { name: "read", arguments: JSON.stringify({ filePath: `ref/batch_${bIdx}.txt` }) },
            },
          ],
        });
      }

      if (s === 21) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_scaf_hybrid",
              type: "function",
              function: {
                name: "film_scaffold",
                arguments: JSON.stringify({
                  title: "OpenCode Parity Hybrid",
                  width: 1280,
                  height: 720,
                  fps: 30,
                  background: "#070b14",
                  stageMode: "hybrid",
                  scenes: [
                    { id: "intro", duration: 1.5 },
                    { id: "climax", duration: 1.5 },
                  ],
                }),
              },
            },
          ],
        });
      }

      if (s === 22) {
        state.scaffoldResult = latestToolResult(messages, "film_scaffold", "a_scaf_hybrid");
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_write_broken",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  filePath: "index.html",
                  content: buildBrokenHybridHtml(),
                }),
              },
            },
          ],
        });
      }

      if (s === 23) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_prev_broken",
              type: "function",
              function: {
                name: "capture_film_preview",
                arguments: JSON.stringify({
                  timestamps: [0.5, 1.5],
                  visualInspectOnly: true,
                  includeFullResFrames: true,
                }),
              },
            },
          ],
        });
      }

      if (s === 24) {
        state.brokenPreviewResult = latestToolResult(messages, "capture_film_preview", "a_prev_broken");
        state.brokenPreviewModelText =
          typeof state.brokenPreviewResult?._rawText === "string"
            ? state.brokenPreviewResult._rawText
            : JSON.stringify(state.brokenPreviewResult);
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_write_working",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  filePath: "index.html",
                  content: buildWorkingHybridHtml("HYBRID ENGINE PARITY"),
                }),
              },
            },
          ],
        });
      }

      if (s === 25) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_prev_1",
              type: "function",
              function: {
                name: "capture_film_preview",
                arguments: JSON.stringify({
                  timestamps: [0.5, 1.5],
                  visualInspectOnly: true,
                  includeFullResFrames: true,
                }),
              },
            },
          ],
        });
      }

      if (s === 26) {
        state.firstPreviewResult = latestToolResult(messages, "capture_film_preview", "a_prev_1");
        const lastMsg = messages[messages.length - 1];
        if (hasImagePayload([lastMsg]) || hasImagePayload(messages.slice(-3))) {
          state.sawPreviewVisionImagePayload = true;
        }
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_edit_title",
              type: "function",
              function: {
                name: "edit",
                arguments: JSON.stringify({
                  filePath: "index.html",
                  oldString: '<div id="hero-title">HYBRID ENGINE PARITY</div>',
                  newString: '<div id="hero-title">HYBRID ENGINE PARITY V2</div>',
                }),
              },
            },
          ],
        });
      }

      if (s === 27) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_prev_2",
              type: "function",
              function: {
                name: "capture_film_preview",
                arguments: JSON.stringify({
                  timestamps: [0.5, 1.5],
                  visualInspectOnly: true,
                  includeFullResFrames: true,
                }),
              },
            },
          ],
        });
      }

      if (s === 28) {
        state.secondPreviewResult = latestToolResult(messages, "capture_film_preview", "a_prev_2");
        const relPreview =
          state.secondPreviewResult?.captured?.[0]?.path || ".aetheria/preview/preview_0.jpg";
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "a_read_prev_img",
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({ filePath: relPreview }),
              },
            },
          ],
        });
      }

      if (s === 29) {
        state.readPreviewStep29Tail = messages.slice(-3);
        if (hasImagePayload(messages.slice(-3))) {
          state.sawReadPreviewImagePayload = true;
        }
      }

      if (s >= 29 && s <= 31) {
        const extraIdx = String(40 + s).padStart(2, "0");
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `a_tail_read_${s}`,
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({ filePath: `ref/batch_${extraIdx}.txt` }),
              },
            },
          ],
        });
      }

      state.done = true;
      return respond({
        role: "assistant",
        content: "SCENARIO_A_COMPLETE",
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        getState: (sessionId) => sessionStates.get(sessionId) || null,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function waitForDone(getStateFn, sessionId, apiInfo, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = getStateFn(sessionId);
    if (st?.done) {
      return st;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const latest = getStateFn(sessionId);
  let sessionDump = "";
  try {
    const msgRes = await api(
      apiInfo.baseUrl,
      `/api/session/${sessionId}/message?${apiInfo.dirQuery}`,
      { authHeader: apiInfo.authHeader }
    );
    sessionDump = `\nLast session messages: ${msgRes.text.slice(-1500)}`;
  } catch (e) {
    sessionDump = `\nFailed reading session messages: ${e?.message || e}`;
  }
  throw new Error(
    `Timed out waiting for session ${sessionId} completion (step=${latest?.step ?? 0}, maxMessages=${latest?.maxMessagesLen ?? 0})${sessionDump}`
  );
}

async function main() {
  const mockLlm = await startParityMockLlm();
  let stack = null;
  let wsDirC = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "9router": {
            name: "9Router",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-opencode-parity" },
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

    // Seed valid ref/extracted keyframes + unique batch text files for Scenario A & B
    const refDir = path.join(wsDir, "ref");
    const extDir = path.join(refDir, "extracted");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, "keyframe_001.png"), makeSolidPng(128, 72, [20, 30, 80]));
    fs.writeFileSync(path.join(extDir, "keyframe_002.png"), makeSolidPng(128, 72, [60, 40, 120]));
    fs.writeFileSync(path.join(extDir, "keyframe_003.png"), makeSolidPng(128, 72, [100, 70, 160]));
    fs.writeFileSync(
      path.join(extDir, "style.json"),
      JSON.stringify(
        {
          width: 1280,
          height: 720,
          fps: 30,
          aspectRatio: "16:9",
          scenes: [
            {
              id: "intro",
              start: 0.0,
              duration: 1.5,
              keyframe: "keyframe_001.png",
              keyframes: { start: "keyframe_001.png", mid: "keyframe_002.png" },
            },
            {
              id: "climax",
              start: 1.5,
              duration: 1.5,
              keyframe: "keyframe_003.png",
            },
          ],
        },
        null,
        2
      )
    );
    for (let i = 1; i <= 80; i++) {
      const idx = String(i).padStart(2, "0");
      fs.writeFileSync(path.join(refDir, `batch_${idx}.txt`), `parity-seed-${idx}\n`);
    }

    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = {
      providerID: "9router",
      modelID: "ComboMaut",
      id: "ComboMaut",
      variant: "high",
    };

    // --- Scenario A ---
    const sessARes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "OpenCode Parity Scenario A", model: modelObj },
    });
    const sessAId = sessARes.json?.data?.id ?? sessARes.json?.id;
    assert.ok(sessAId, `Missing Scenario A session id: ${sessARes.text}`);

    const promptARes = await api(baseUrl, `/api/session/${sessAId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: {
          text: "SCENARIO_A_HYBRID: Buat showreel hybrid HTML+CSS3D+SVG+Canvas 1280x720 dari ref.",
        },
      },
    });
    assert.ok(promptARes.ok, `Scenario A prompt failed: ${promptARes.text}`);

    const stA = await waitForDone(
      mockLlm.getState,
      sessAId,
      { baseUrl, authHeader, dirQuery },
      90_000
    );
    assert.equal(
      stA.assertionsFailed.length,
      0,
      `Scenario A request header/param assertions failed:\n${stA.assertionsFailed.join("\n")}`
    );
    assert.ok(stA.sawHybridPromptContract, "Expected updated hybrid stage contract in default.txt");
    assert.ok(stA.sawRefImagePayload, "Expected direct `read` on ref/extracted/keyframe_*.png to attach vision image");
    assert.equal(stA.sawEmergencyHeal, false, "Expected zero [Emergency Context Auto-Heal] past step 28 and 65 msgs");
    assert.ok(stA.step >= 32, `Expected >= 32 steps in Scenario A, got ${stA.step}`);
    assert.ok(stA.maxMessagesLen > 65, `Expected messages.length > 65 in Scenario A, got ${stA.maxMessagesLen}`);

    assert.equal(stA.scaffoldResult?.ok, true, `Hybrid film_scaffold failed: ${JSON.stringify(stA.scaffoldResult)}`);
    assert.equal(stA.scaffoldResult?.stageMode, "hybrid");
    assert.equal(stA.scaffoldResult?.managedIndexHtml, false);
    const sessAMessagesRes = await api(baseUrl, `/api/session/${sessAId}/message?${dirQuery}&limit=200`, {
      authHeader,
    });
    assert.ok(sessAMessagesRes.ok, `Failed reading Scenario A messages: ${sessAMessagesRes.text}`);
    const findStructuredByCallId = (payload, callId) => {
      const list = Array.isArray(payload)
        ? payload
        : payload?.items || payload?.messages || payload?.data || [];
      for (const msg of list) {
        const items = Array.isArray(msg?.content)
          ? msg.content
          : Array.isArray(msg?.parts)
          ? msg.parts
          : [];
        for (const part of items) {
          if (part?.type === "tool" && (part?.id === callId || part?.callID === callId)) {
            return part?.state || null;
          }
        }
      }
      return null;
    };
    const brokenPartState = findStructuredByCallId(sessAMessagesRes.json, "a_prev_broken");

    const filmDir = path.join(wsDir, stA.scaffoldResult.filmRoot);
    assert.equal(fs.existsSync(path.join(filmDir, "script", "scene1.js")), false, "Hybrid scaffold should not create script/scene1.js stub");
    assert.equal(fs.existsSync(path.join(filmDir, "script", "scene2.js")), false, "Hybrid scaffold should not create script/scene2.js stub");

    assert.ok(
      String(stA.brokenPreviewModelText || "").includes("intentional broken renderAt"),
      `Expected model-facing broken renderAt error text, got: ${stA.brokenPreviewModelText}`
    );
    assert.equal(
      brokenPartState?.structured?.ok,
      false,
      `Broken window.renderAt must store structured ok=false (keys=${Object.keys(sessAMessagesRes.json || {})}): ${JSON.stringify(brokenPartState)}`
    );
    assert.ok(
      String(brokenPartState?.structured?.error || "").includes("intentional broken renderAt"),
      `Expected broken renderAt structured error detail, got ${JSON.stringify(brokenPartState)}`
    );

    const healthAfterErr = await api(baseUrl, `/api/health`, { authHeader });
    assert.ok(healthAfterErr.ok, `Engine health endpoint failed: ${healthAfterErr.status} ${healthAfterErr.text}`);
    assert.equal(
      healthAfterErr.json?.data?.healthy ?? healthAfterErr.json?.healthy,
      true,
      `Engine must remain healthy after broken preview error: ${healthAfterErr.text}`
    );

    const preview1 = findStructuredByCallId(sessAMessagesRes.json, "a_prev_1")?.structured ?? stA.firstPreviewResult;
    const preview2 = findStructuredByCallId(sessAMessagesRes.json, "a_prev_2")?.structured ?? stA.secondPreviewResult;

    assert.equal(preview1?.ok, true, `First hybrid preview failed: ${JSON.stringify(preview1)}`);
    assert.equal(preview1?.visualInspectOnly, true);
    assert.equal(preview1?.fidelityFailed, false);
    assert.ok(stA.sawPreviewVisionImagePayload, "Expected full-res preview images attached to next LLM request");

    assert.equal(preview2?.ok, true, `Second hybrid preview failed: ${JSON.stringify(preview2)}`);
    assert.equal(preview2?.reusedWarmBrowser, true, "Expected second preview to reuse warm browser");
    assert.equal(preview2?.changedSinceLastCapture, true, "Expected surgical edit to change captured preview frames");
    const readPreviewPartState = findStructuredByCallId(sessAMessagesRes.json, "a_read_prev_img");
    assert.equal(
      readPreviewPartState?.structured?.ok,
      true,
      `read .aetheria/preview/preview_0.jpg failed: ${JSON.stringify(readPreviewPartState)}`
    );
    assert.equal(
      readPreviewPartState?.structured?.isImage,
      true,
      `Expected read .aetheria/preview/preview_0.jpg to detect image: ${JSON.stringify(readPreviewPartState)}`
    );
    assert.ok(
      stA.sawReadPreviewImagePayload,
      `Expected direct read on .aetheria/preview/preview_0.jpg to attach vision image; tail=${JSON.stringify(stA.readPreviewStep29Tail).slice(0, 800)}`
    );

    // --- Scenario B (> 51 steps) ---
    const sessBRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "OpenCode Parity Scenario B", model: modelObj },
    });
    const sessBId = sessBRes.json?.data?.id ?? sessBRes.json?.id;
    assert.ok(sessBId, `Missing Scenario B session id: ${sessBRes.text}`);

    const promptBRes = await api(baseUrl, `/api/session/${sessBId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: {
          text: "SCENARIO_B_54_STEPS: Jalankan audit bertahap 54 langkah tanpa terhenti di limit 51.",
        },
      },
    });
    assert.ok(promptBRes.ok, `Scenario B prompt failed: ${promptBRes.text}`);

    const stB = await waitForDone(
      mockLlm.getState,
      sessBId,
      { baseUrl, authHeader, dirQuery },
      90_000
    );
    assert.equal(
      stB.assertionsFailed.length,
      0,
      `Scenario B request assertions failed:\n${stB.assertionsFailed.join("\n")}`
    );
    assert.ok(stB.step >= 55, `Expected > 51 steps completed (54 tool steps + final answer = 55), got ${stB.step}`);
    assert.equal(stB.sawEmergencyHeal, false, "Scenario B should not trigger [Emergency Context Auto-Heal]");

    // --- Scenario C (Zero-flag autonomous flow: no "hybrid", no "film_scaffold", no preview flags) ---
    wsDirC = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-parity-scenC-"));
    const extDirC = path.join(wsDirC, "ref", "extracted");
    fs.mkdirSync(extDirC, { recursive: true });
    fs.writeFileSync(path.join(extDirC, "keyframe_001.png"), makeSolidPng(128, 72, [20, 30, 80]));
    fs.writeFileSync(
      path.join(extDirC, "style.json"),
      JSON.stringify({
        width: 1280,
        height: 720,
        fps: 30,
        aspectRatio: "16:9",
        scenes: [{ id: "intro", start: 0, duration: 3.0, keyframe: "keyframe_001.png" }],
      })
    );
    fs.writeFileSync(
      path.join(extDirC, "ref_report.md"),
      "# Reference Blueprint\n- 1280x720 @ 30fps\n- Kinetic typography + 3D card.\n"
    );

    const dirQueryC = `directory=${encodeURIComponent(wsDirC)}`;
    const sessCRes = await api(baseUrl, `/api/session?${dirQueryC}`, {
      method: "POST",
      authHeader,
      body: { title: "Zero-Flag Autonomous Flow", model: modelObj },
    });
    const sessCId = sessCRes.json?.data?.id ?? sessCRes.json?.id;
    assert.ok(sessCId, `Missing Scenario C session id: ${sessCRes.text}`);

    const promptCRes = await api(baseUrl, `/api/session/${sessCId}/prompt?${dirQueryC}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: {
          text: "Buat animasi showreel 1280x720 dari referensi di ref.",
        },
      },
    });
    assert.ok(promptCRes.ok, `Scenario C prompt failed: ${promptCRes.text}`);

    const stC = await waitForDone(
      mockLlm.getState,
      sessCId,
      { baseUrl, authHeader, dirQuery: dirQueryC },
      90_000
    );
    assert.equal(stC.assertionsFailed.length, 0, `Scenario C assertions failed:\n${stC.assertionsFailed.join("\n")}`);
    assert.equal(stC.sawAmApiReference, false, "Scenario C general reference prompt must NOT auto-inject <am_runtime_api_reference>");
    assert.equal(stC.sawForcedScaffoldAfterDirective, false, "Scenario C must NOT inject outdated forced film_scaffold directive");
    assert.ok(stC.sawPreviewVisionImagePayload, "Scenario C plain capture_film_preview must attach full-res frames automatically");

    const projDirCRoot = path.join(wsDirC, "projects");
    const createdProjDirs = fs.existsSync(projDirCRoot) ? fs.readdirSync(projDirCRoot) : [];
    assert.ok(createdProjDirs.length >= 1, "Scenario C showreel prompt must auto-create an isolated projects/<slug>/ folder");
    assert.ok(
      fs.existsSync(path.join(projDirCRoot, createdProjDirs[0], "index.html")),
      "Scenario C direct write('index.html') must land cleanly inside isolated project folder"
    );

    const sessCMessagesRes = await api(baseUrl, `/api/session/${sessCId}/message?${dirQueryC}&limit=50`, {
      authHeader,
    });
    assert.ok(sessCMessagesRes.ok, `Failed reading Scenario C messages: ${sessCMessagesRes.text}`);
    const previewC = findStructuredByCallId(sessCMessagesRes.json, "c_preview_zero_flags")?.structured;
    assert.equal(previewC?.ok, true, `Scenario C zero-flag preview failed: ${JSON.stringify(previewC)}`);
    assert.equal(previewC?.visualInspectOnly, true, "Standalone index.html must default capture_film_preview to visualInspectOnly=true");
    assert.equal(previewC?.fidelityFailed, false);

    console.log(
      `[opencode-parity-e2e] PASS | Scenario A: steps=${stA.step} maxMsgs=${stA.maxMessagesLen} warmReused=${preview2?.reusedWarmBrowser} | Scenario B: steps=${stB.step} maxMsgs=${stB.maxMessagesLen} | Scenario C: autoVisualInspect=${previewC?.visualInspectOnly} proj=${createdProjDirs[0]}`
    );
  } finally {
    if (wsDirC) {
      fs.rmSync(wsDirC, { recursive: true, force: true });
    }
    if (stack) {
      await stack.stop();
    }
    await mockLlm.close();
  }
}

main().catch((err) => {
  console.error("[opencode-parity-e2e] FAIL:", err);
  process.exit(1);
});
