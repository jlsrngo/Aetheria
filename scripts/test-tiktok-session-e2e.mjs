#!/usr/bin/env node
/**
 * Live Session E2E Test for TikTok Reference Video Extraction + Motion Ghidra AST Decompilation:
 * Target URL: https://www.tiktok.com/@ngorzc/video/7707935063484173576?is_from_webapp=1&sender_device=pc&web_id=7705286071508960786
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startLiveStack } from "../e2e/live-stack.mjs";

const TIKTOK_URL =
  "https://www.tiktok.com/@ngorzc/video/7707935063484173576?is_from_webapp=1&sender_device=pc&web_id=7705286071508960786";
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

async function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 90_000 } = {}) {
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

function startCapturingMockLlm() {
  const capturedRequests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-tiktok-e2e", object: "model" }] }));
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        capturedRequests.push(JSON.parse(raw));
      } catch {
        capturedRequests.push({ raw });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "TikTok reference video analyzed and Motion AST decompiled.",
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
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
        capturedRequests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function main() {
  const mockLlm = await startCapturingMockLlm();
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
              "mock-tiktok-e2e": { name: "Mock TikTok E2E", vision: true },
            },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-e2e", modelID: "mock-tiktok-e2e", id: "mock-tiktok-e2e" };

    // 1. Create session
    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "TikTok @ngorzc E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);

    // 2. Send prompt with the exact TikTok URL into the session
    const promptText = `${TIKTOK_URL}\n\nBuatkan video profil produk Aetheria mengikuti gaya motion dari referensi TikTok di atas.`;
    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { model: modelObj, prompt: { text: promptText } },
    });
    if (!postRes.ok) throw new Error(`POST /prompt failed: ${postRes.text}`);

    // Wait for turn completion
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 600));
      const msgRes = await api(baseUrl, `/api/session/${sessId}/message?order=asc&${dirQuery}`, {
        authHeader,
      });
      const msgs = msgRes.json?.data ?? msgRes.json ?? [];
      const assistants = Array.isArray(msgs)
        ? msgs.filter((m) => (m.info?.role ?? m.role) === "assistant")
        : [];
      if (assistants.length > 0 && (assistants[0]?.info?.time?.completed || assistants[0]?.time?.completed)) {
        break;
      }
    }

    const mp4Path = path.join(wsDir, "ref", "ref_tiktok.mp4");
    const wavPath = path.join(wsDir, "ref", "ref_voice.wav");
    const astPath = path.join(wsDir, "ref", "extracted", "style_ast.json");
    const stylePath = path.join(wsDir, "ref", "extracted", "style.json");
    const temporalPath = path.join(wsDir, "ref", "extracted", "temporal.json");
    const reportPath = path.join(wsDir, "ref", "extracted", "ref_report.md");

    const astDoc = JSON.parse(fs.readFileSync(astPath, "utf8"));
    const styleDoc = JSON.parse(fs.readFileSync(stylePath, "utf8"));
    const reqStr = JSON.stringify(mockLlm.capturedRequests[0] || {});

    const summary = {
      mp4Downloaded: fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 100_000,
      mp4Bytes: fs.existsSync(mp4Path) ? fs.statSync(mp4Path).size : 0,
      voiceWavExtracted: fs.existsSync(wavPath) && fs.statSync(wavPath).size > 1000,
      styleAstExists: fs.existsSync(astPath),
      styleJsonExists: fs.existsSync(stylePath),
      temporalJsonExists: fs.existsSync(temporalPath),
      reportMdExists: fs.existsSync(reportPath),
      astVersion: astDoc.version,
      resolution: `${astDoc.width}x${astDoc.height}`,
      aspectRatio: astDoc.aspectRatio,
      fps: astDoc.fps,
      bpm: astDoc.bpm,
      scenesCount: (astDoc.scenes || []).length,
      palette: styleDoc.palette,
      scenesSummary: (astDoc.scenes || []).map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        duration: s.duration,
        cleanPlate: s.cleanPlate,
        layersCount: (s.layers || []).length,
        sampleLayerMotions: (s.layers || []).slice(0, 3).map((l) => ({
          kind: l.kind,
          text: l.text,
          direction: l.motion?.entrance?.direction,
          curve: l.motion?.entrance?.curve,
          velocity: l.motion?.entrance?.velocity,
        })),
        hasSkeletonFile: fs.existsSync(path.join(wsDir, s.skeletonPath || "")),
      })),
      llmPromptReceivedTikTokExtraction: reqStr.includes("TikTok Reference Video Extracted (@ngorzc"),
      llmPromptReceivedMotionAst: reqStr.includes("style_ast.json"),
      llmPromptReceivedVisionFrames: reqStr.includes("data:image/jpeg;base64,"),
    };

    // Negative path (AGENTS.md §3.3): invalid/unreachable TikTok video ID does not crash session turn
    const badPrompt = "https://www.tiktok.com/@ngorzc/video/0000000000000000000\n\nCek link tidak valid ini.";
    const badRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { model: modelObj, prompt: { text: badPrompt } },
    });
    const healthAfterBadUrl = await api(baseUrl, "/api/health", { authHeader });
    summary.invalidLinkHandledWithoutCrash =
      badRes.ok && Boolean(healthAfterBadUrl.json?.healthy);

    console.log("[TIKTOK_SESSION_E2E]", JSON.stringify(summary, null, 2));

    if (
      !summary.mp4Downloaded ||
      !summary.voiceWavExtracted ||
      !summary.styleAstExists ||
      summary.astVersion !== 3 ||
      summary.scenesCount < 1 ||
      !summary.llmPromptReceivedTikTokExtraction ||
      !summary.llmPromptReceivedMotionAst ||
      !summary.llmPromptReceivedVisionFrames ||
      !summary.invalidLinkHandledWithoutCrash
    ) {
      process.exitCode = 1;
    }
  } finally {
    await stack?.stop();
    await mockLlm.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[TIKTOK_SESSION_E2E_ERROR]", err);
  process.exit(1);
});
