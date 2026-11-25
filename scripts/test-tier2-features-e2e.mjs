#!/usr/bin/env node
/**
 * Tier 2 Live-Engine E2E Verification (`scripts/test-tier2-features-e2e.mjs`).
 *
 * Tests all 3 Tier 2 features end-to-end against a real `aetheria-engine` + headless Chrome CDP:
 *   1. User-supplied VO (`voPath`) + mood BGM (`musicMood: "cheerful"`, `duck: true`, `loudnorm: true`)
 *      plus path-isolation failure path (`../../outside.wav` -> `INVALID_VO_PATH`).
 *   2. RMS energy lipsync (`audio/<id>.levels.json` generated from WAV and consumed by `StoryCore` + `mg-stickman-story`).
 *   3. On-demand 9-frame motion strip QC (`capture_film_preview({ framesPerShot: 9, stripShotId: "s1_vo" })`
 *      -> creates `.aetheria/preview/strip_s1_vo.jpg` and sets `storyQa.framesPerShot === 9`).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function writeSpeechLikeWav(outPath, durationSec = 2.2, sr = 24000) {
  const numSamples = Math.round(durationSec * sr);
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sr;
    const envelope = t > 0.15 && t < durationSec - 0.25 ? Math.max(0.15, Math.sin(t * 9.0) * 0.7 + 0.3) : 0.0;
    const sample = Math.round(Math.sin(2 * Math.PI * 220 * t) * 14000 * envelope);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${urlPath}`);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Connection: "close" };
    if (authHeader) headers.Authorization = authHeader;
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
        agent: new http.Agent({ keepAlive: false }),
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: raw, json });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout ${method} ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function buildOneShotStory() {
  return {
    renderer: "2d-stickman-story",
    title: "Tier2 VO & Strip E2E",
    canvas: { w: 1080, h: 1920, fps: 30 },
    actorsMap: { afro: "afro" },
    captions: { enabled: true },
    shots: [
      {
        id: "s1_vo",
        start: 0,
        duration: 2.8,
        stage: "park",
        timeOfDay: "day",
        caption: "Hello bright morning friends!",
        audio: {
          wav: "audio/s1_vo.wav",
          words: "audio/s1_vo.words.json",
          levels: "audio/s1_vo.levels.json",
        },
        actors: [
          {
            id: "afro",
            x: -360,
            pose: "run",
            expr: "excited",
            actions: [{ at: 0.1, toX: 0, dur: 1.6, style: "run" }],
          },
        ],
        camera: {
          initial: { size: "full", focus: "afro" },
          moves: [{ at: 0.0, kind: "follow", focus: "afro", until: 1.7 }],
        },
      },
    ],
  };
}

function startScriptedLlm(storyObj, trace) {
  let coordStep = 0;
  let subStep = 0;

  const toolReply = (id, name, argsObj) => ({
    id,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `call_${id}_${name}`, type: "function", function: { name, arguments: JSON.stringify(argsObj) } }],
        },
      },
    ],
  });

  const stopReply = (id, text) => ({
    id,
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ id: "mock-tier2-v", object: "model" }] }));
          return;
        }
        const parsed = JSON.parse(body || "{}");
        const msgs = parsed.messages || [];
        const sysText = String(msgs[0]?.content || "");
        const isCoord = !sysText.includes("Motion Designer Subagent");

        for (const m of msgs) {
          if (m.role !== "tool") continue;
          const cid = m.tool_call_id || "";
          if (cid && trace.seenIds.has(cid)) continue;
          if (cid) trace.seenIds.add(cid);
          const txt = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          if (txt.includes("INVALID_VO_PATH") || txt.includes("Project Folder Isolation Error")) trace.sawInvalidVoRejection = true;
          if (txt.includes("\"levels\"") && txt.includes("\"bgm\"")) trace.sawAudioMixSummary = true;
          if (txt.includes("\"storyQa\"")) {
            try {
              trace.previewResults.push(JSON.parse(txt));
            } catch {}
          }
        }

        let resp;
        if (isCoord) {
          if (coordStep === 0) {
            resp = toolReply(`c${coordStep}`, "film_audio", {
              musicMood: "cheerful",
              scenes: [{ id: "s1_vo", narration: "Hello bright morning friends!", voPath: "../../outside.wav" }],
            });
          } else if (coordStep === 1) {
            resp = toolReply(`c${coordStep}`, "film_audio", {
              musicMood: "cheerful",
              musicVolume: 0.16,
              duck: true,
              loudnorm: true,
              scenes: [{ id: "s1_vo", narration: "Hello bright morning friends!", voPath: "input/vo1.wav" }],
            });
          } else if (coordStep === 2) {
            resp = toolReply(`c${coordStep}`, "task", {
              subagent_type: "motion-designer",
              description: "Author story.json and capture 9-frame motion strip",
              prompt: "Write story.json, scaffold, and run capture_film_preview with framesPerShot 9.",
            });
          } else {
            resp = stopReply(`c${coordStep}`, "Tier 2 features verified.");
          }
          coordStep++;
        } else {
          if (subStep === 0) {
            resp = toolReply(`s${subStep}`, "write", {
              filePath: "story.json",
              content: JSON.stringify(storyObj, null, 2),
            });
          } else if (subStep === 1) {
            resp = toolReply(`s${subStep}`, "film_scaffold", {
              title: "Tier2 VO & Strip E2E",
              width: 1080,
              height: 1920,
              fps: 30,
              useThree: false,
              storyMode: true,
              disableMicrostock: true,
              scenes: [{ id: "s1_vo", duration: 2.8, audio: "audio/s1_vo.wav", words: "audio/s1_vo.words.json" }],
            });
          } else if (subStep === 2) {
            resp = toolReply(`s${subStep}`, "capture_film_preview", {
              framesPerShot: 9,
              stripShotId: "s1_vo",
            });
          } else {
            resp = stopReply(`s${subStep}`, "9-frame strip QC completed.");
          }
          subStep++;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resp));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function main() {
  const storyObj = buildOneShotStory();
  const trace = {
    sawInvalidVoRejection: false,
    sawAudioMixSummary: false,
    previewResults: [],
    seenIds: new Set(),
  };
  const mockLlm = await startScriptedLlm(storyObj, trace);
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-tier2": {
            name: "Mock Tier2 Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-tier2-v": { name: "Mock Tier2 Vision", vision: true } },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-tier2", modelID: "mock-tier2-v", id: "mock-tier2-v" };

    // Pre-create fixture VO WAV in the isolated project directory where /mg-stickman-story will resolve
    const projSlug = "make-a-1-shot-stickman-story-using-user-vo";
    const fixtureVo = path.join(wsDir, "projects", projSlug, "input", "vo1.wav");
    writeSpeechLikeWav(fixtureVo, 2.2, 24000);

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Tier2 Features E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: { text: "/mg-stickman-story Make a 1-shot stickman story using user VO" },
      },
    });
    if (!postRes.ok) throw new Error(`Prompt failed: ${postRes.text}`);

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const [msgRes, jobsRes] = await Promise.all([
        api(baseUrl, `/api/session/${sessId}/message?order=asc&${dirQuery}`, { authHeader }).catch(() => null),
        api(baseUrl, `/api/session/${sessId}/jobs`, { authHeader }).catch(() => null),
      ]);
      const msgs = msgRes?.json?.data ?? msgRes?.json ?? [];
      const assistants = Array.isArray(msgs) ? msgs.filter((m) => (m.info?.role ?? m.role) === "assistant") : [];
      const jobs = jobsRes?.json?.data ?? [];
      const running = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running") : [];
      const latest = assistants[assistants.length - 1];
      if (assistants.length > 0 && (latest?.info?.time?.completed || latest?.time?.completed) && running.length === 0) {
        break;
      }
    }

    if (trace.previewResults.length < 1) {
      throw new Error("Expected capture_film_preview result with storyQa");
    }
    const pv = trace.previewResults[trace.previewResults.length - 1];
    const projectsDir = path.join(wsDir, "projects");
    const slugs = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
    const projDir = path.join(projectsDir, slugs[0] || projSlug);
    const filmJson = JSON.parse(fs.readFileSync(path.join(projDir, "film.json"), "utf8"));
    const levelsJson = JSON.parse(fs.readFileSync(path.join(projDir, "audio", "s1_vo.levels.json"), "utf8"));
    const wordsJson = JSON.parse(fs.readFileSync(path.join(projDir, "audio", "s1_vo.words.json"), "utf8"));
    const stripPath = path.join(projDir, ".aetheria", "preview", "strip_s1_vo.jpg");
    const stripBytes = fs.existsSync(stripPath) ? fs.statSync(stripPath).size : 0;

    const summary = {
      sawInvalidVoRejection: trace.sawInvalidVoRejection,
      sawAudioMixSummary: trace.sawAudioMixSummary,
      audioMix: filmJson.audioMix || null,
      sceneBgm: filmJson.scenes?.[0]?.bgm || null,
      levelsCount: Array.isArray(levelsJson.levels) ? levelsJson.levels.length : 0,
      wordsCount: Array.isArray(wordsJson.words) ? wordsJson.words.length : 0,
      framesCaptured: Array.isArray(pv.captured) ? pv.captured.length : 0,
      framesPerShot: pv.storyQa?.framesPerShot,
      contactSheetRelPath: pv.storyQa?.contactSheetRelPath,
      runtimeErrors: (pv.runtimeErrors || []).length,
      stripBytes,
    };
    console.log("[TIER2_E2E]", JSON.stringify(summary, null, 2));

    const checks = [
      ["sawInvalidVoRejection", summary.sawInvalidVoRejection],
      ["sawAudioMixSummary", summary.sawAudioMixSummary],
      ["audioMix.duck === true", summary.audioMix?.duck === true],
      ["audioMix.loudnorm === true", summary.audioMix?.loudnorm === true],
      ["sceneBgm set", summary.sceneBgm === "audio/bgm_s1_vo.wav"],
      ["levelsCount > 10", summary.levelsCount > 10],
      ["wordsCount === 4", summary.wordsCount === 4],
      ["framesCaptured === 9", summary.framesCaptured === 9],
      ["framesPerShot === 9", summary.framesPerShot === 9],
      ["contactSheetRelPath strip_s1_vo.jpg", summary.contactSheetRelPath === ".aetheria/preview/strip_s1_vo.jpg"],
      ["runtimeErrors === 0", summary.runtimeErrors === 0],
      ["stripBytes > 5000", summary.stripBytes > 5000],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
    if (bad.length > 0) {
      throw new Error(`Tier 2 E2E failed checks: ${bad.join(", ")}`);
    }
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
  }
}

main().catch((err) => {
  console.error("[TIER2_E2E] FAILED:", err);
  process.exit(1);
});
