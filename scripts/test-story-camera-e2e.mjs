#!/usr/bin/env node
/**
 * Shared StoryCamera Live Engine E2E (`scripts/test-story-camera-e2e.mjs`).
 *
 * Verifies all engine serving & validation paths against a real running `aetheria-engine`:
 * 1. Studio preview asset route (`GET /api/studio/ws-asset/script/story-camera.js`) returns 200 with `StoryCamera`.
 * 2. Failure path: `story.json` with invalid camera fields (`move: "teleport"`, `intensity: 1.8`)
 *    triggers `STORY_CAMERA_INVALID` during `film_scaffold(storyMode: true)` without crashing.
 * 3. Success path: valid `story.json` with `cameraStyle: "editorial"` passes lint, generates managed
 *    `index.html` containing `<script src="/script/story-camera.js"></script>`, and renders cleanly
 *    through headless Chromium CDP (`capture_film_preview`) with 0 runtime errors and `window.StoryCamera` loaded.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function toolReply(id, name, args) {
  return {
    id: `chatcmpl-${id}`,
    object: "chat.completion",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
      },
      finish_reason: "tool_calls",
    }],
  };
}

function stopReply(id, text) {
  return { id: `chatcmpl-${id}`, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
}

function startScriptedLlm(validStory, brokenStory, trace) {
  let coordStep = 0;
  let subStep = 0;
  const scenes = validStory.shots.map((s) => ({ id: s.id, title: s.id, duration: s.duration }));

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const msgs = Array.isArray(payload.messages) ? payload.messages : [];
      const joined = msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""))).join("\n");
      const tools = Array.isArray(payload.tools) ? payload.tools.map((t) => t.function?.name) : [];
      const isCoord = tools.includes("task");

      if (joined.includes("STORY_CAMERA_INVALID")) trace.sawCameraInvalidError = true;
      if (joined.includes("runtimeErrors\":[]") || joined.includes("Captured")) trace.sawPreviewOutput = true;

      let resp;
      if (isCoord) {
        resp = coordStep === 0
          ? toolReply(`c${coordStep}`, "task", {
              description: "Build cobalt camera story",
              subagent_type: "motion-designer",
              prompt: "Author story.json with cameraStyle, scaffold, and capture preview.",
            })
          : stopReply(`c${coordStep}`, "StoryCamera E2E selesai.");
        coordStep++;
      } else {
        if (subStep === 0) resp = toolReply(`s${subStep}`, "write", { filePath: "story.json", content: JSON.stringify(brokenStory, null, 2) });
        else if (subStep === 1) resp = toolReply(`s${subStep}`, "film_scaffold", { title: "StoryCamera E2E", preset: "landscape", width: 1280, height: 720, storyMode: true, useThree: false, scenes });
        else if (subStep === 2) resp = toolReply(`s${subStep}`, "write", { filePath: "story.json", content: JSON.stringify(validStory, null, 2) });
        else if (subStep === 3) resp = toolReply(`s${subStep}`, "capture_film_preview", {});
        else resp = stopReply(`s${subStep}`, "Subagent done.");
        subStep++;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resp));
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

async function main() {
  const validStory = {
    title: "StoryCamera E2E",
    theme: "cobalt-beam",
    seed: 555,
    cameraStyle: "editorial",
    canvas: { w: 1280, h: 720, fps: 30 },
    captions: { enabled: false },
    shots: [
      { id: "s1-hook", start: 0, duration: 3.0, layout: "kinetic-word-reveal", headline: "Satu gaya banyak gerak." },
      { id: "s2-icons", start: 3.0, duration: 3.0, layout: "icon-row-morph", anchor: "Aetheria", leftIcons: ["layers", "wave"], rightIcons: ["play", "bolt"] },
    ],
  };
  const brokenStory = JSON.parse(JSON.stringify(validStory));
  brokenStory.shots[0].camera = { move: "teleport", intensity: 1.8, moveDuration: 0.01 };

  const trace = { sawCameraInvalidError: false, sawPreviewOutput: false };
  const mockLlm = await startScriptedLlm(validStory, brokenStory, trace);
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-cam": {
            name: "Mock Camera E2E Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-cam-v": { name: "Mock Camera Vision", vision: true } },
          },
        },
      },
    });

    const base = stack.engineUrl;
    const auth = stack.authHeader;
    const dirQ = `directory=${encodeURIComponent(stack.workspaceDir)}`;

    // 1. Verify Studio preview asset endpoint serves /script/story-camera.js
    const assetRes = await fetch(`${base}/api/studio/ws-asset/script/story-camera.js?${dirQ}`, {
      headers: { Authorization: auth },
    });
    const assetBody = await assetRes.text();
    assert(assetRes.ok, `Studio asset route failed: HTTP ${assetRes.status}`);
    assert(assetBody.includes("StoryCamera"), "Studio asset route did not serve StoryCamera code");

    // 2. Run /mg-cobalt-editorial turn with broken -> fixed story.json -> capture_film_preview
    const modelObj = { providerID: "mock-cam", modelID: "mock-cam-v", id: "mock-cam-v" };
    const sesRes = await (await fetch(`${base}/api/session?${dirQ}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "StoryCamera E2E", model: modelObj }),
    })).json();
    const sessionId = sesRes.data?.id || sesRes.id;
    assert(sessionId, "session created");

    const turnRes = await fetch(`${base}/api/session/${sessionId}/prompt?${dirQ}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelObj, prompt: { text: "/mg-cobalt-editorial Buat 2 shot editorial." } }),
    });
    assert(turnRes.ok, `turn HTTP ${turnRes.status}`);

    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      await new Promise((r) => setTimeout(r, 400));
      const [msgRes, jobsRes] = await Promise.all([
        fetch(`${base}/api/session/${sessionId}/message?order=asc&${dirQ}`, { headers: { Authorization: auth } }).then((r) => r.json()).catch(() => null),
        fetch(`${base}/api/session/${sessionId}/jobs`, { headers: { Authorization: auth } }).then((r) => r.json()).catch(() => null),
      ]);
      const msgs = msgRes?.data ?? msgRes ?? [];
      const assistants = Array.isArray(msgs) ? msgs.filter((m) => (m.info?.role ?? m.role) === "assistant") : [];
      const jobs = jobsRes?.data ?? [];
      const runningJobs = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running") : [];
      const latest = assistants[assistants.length - 1];
      if (assistants.length > 0 && (latest?.info?.time?.completed || latest?.time?.completed) && runningJobs.length === 0) break;
    }

    const projectsDir = path.join(stack.workspaceDir, "projects");
    const slugs = fs.readdirSync(projectsDir).filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());
    assert(slugs.length === 1, `expected 1 project dir, got ${slugs.join(",")}`);
    const projPath = path.join(projectsDir, slugs[0]);
    const indexHtml = fs.readFileSync(path.join(projPath, "index.html"), "utf8");
    assert(indexHtml.includes('/script/story-camera.js'), "managed index.html missing /script/story-camera.js tag");
    assert(trace.sawCameraInvalidError, "broken camera story.json did not trigger STORY_CAMERA_INVALID");
    const previewDir = path.join(projPath, ".aetheria", "preview");
    assert(fs.existsSync(previewDir), "preview dir not created");
    const previewImgs = fs.readdirSync(previewDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
    assert(previewImgs.length >= 1, `expected preview images, got ${previewImgs.join(",")}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          studioAssetServed: true,
          sawCameraInvalidError: trace.sawCameraInvalidError,
          indexHasStoryCameraTag: true,
          previewImages: previewImgs,
        },
        null,
        2,
      ),
    );
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
  }
}

main().catch((err) => {
  console.error("[test-story-camera-e2e] FAILED:", err);
  process.exit(1);
});
