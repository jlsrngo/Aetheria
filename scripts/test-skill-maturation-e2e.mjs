#!/usr/bin/env node
/**
 * Live-Engine E2E Verification (`scripts/test-skill-maturation-e2e.mjs`).
 *
 * Exercises the complete `mg-stickman-story` + Director Camera v2 + 3-frame Self-QC pipeline
 * against a real `aetheria-engine` binary and headless Chrome/Edge CDP in an isolated `os.tmpdir()` workspace:
 *   1. `/mg-stickman-story` activation auto-seeds `kit.json` + all 5 `script/*.js` runtime files and
 *      injects skill references (`references/camera.md`) and character galleries (`assets/character-gallery.png`).
 *   2. Invalid Director v2 camera spec (`kind: "teleport_bogus"`, `size: "super_giant"`) is caught cleanly
 *      by `film_scaffold` / `storyLint` (`STORY_CAMERA_INVALID`) without crashing.
 *   3. Valid 3-shot 9:16 `"Afro's Bright Morning"` `story.json` passes `storyLint` and renders a 9-tile
 *      `.aetheria/preview/contact_sheet.jpg` (`framesPerShot === 3`, `audioEventsCount > 0`, 0 runtime errors).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

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

function buildStories() {
  const exPath = path.join(REPO_ROOT, ".aetheria", "skills", "mg-stickman-story", "examples", "story.example.json");
  const validStory = JSON.parse(fs.readFileSync(exPath, "utf8"));
  const brokenStory = JSON.parse(JSON.stringify(validStory));
  brokenStory.shots[0].camera = {
    initial: { size: "super_giant", focus: "afro" },
    moves: [{ at: 0.2, kind: "teleport_bogus", dur: 0.6 }],
  };
  return { validStory, brokenStory };
}

function startScriptedLlm(validStory, brokenStory, trace) {
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
          res.end(JSON.stringify({ data: [{ id: "mock-stickman-v", object: "model" }] }));
          return;
        }
        const parsed = JSON.parse(body || "{}");
        const msgs = parsed.messages || [];
        const sysText = String(msgs[0]?.content || "");
        const isCoordinator = !sysText.includes("Motion Designer Subagent");
        const joined = msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

        for (const m of msgs) {
          if (m.role !== "tool") continue;
          const cid = m.tool_call_id || "";
          if (cid && trace.seenIds.has(cid)) continue;
          if (cid) trace.seenIds.add(cid);
          const txt = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          if (txt.includes("STORY_CAMERA_INVALID")) trace.sawCameraInvalid = true;
          if (txt.includes("\"storyQa\"")) {
            try {
              trace.previewResults.push(JSON.parse(txt));
            } catch {}
          }
        }

        let resp;
        if (isCoordinator) {
          if (coordStep === 0) {
            trace.sawRefsAndGalleries =
              joined.includes("references/camera.md") &&
              joined.includes("assets/character-gallery.png") &&
              joined.includes("stickman-rig.js");
            resp = toolReply(`c${coordStep}`, "task", {
              subagent_type: "motion-designer",
              description: "Author Stickman Story story.json and verify 3-frame Self-QC",
              prompt: "Author story.json for Afro's Bright Morning (1080x1920), scaffold in 2D storyMode, and run capture_film_preview.",
            });
          } else {
            resp = stopReply(`c${coordStep}`, "Stickman Story verification done.");
          }
          coordStep++;
        } else {
          if (subStep === 0) {
            resp = toolReply(`s${subStep}`, "write", {
              filePath: "story.json",
              content: JSON.stringify(brokenStory, null, 2),
            });
          } else if (subStep === 1) {
            resp = toolReply(`s${subStep}`, "film_scaffold", {
              title: "Afro's Bright Morning",
              width: 1080,
              height: 1920,
              fps: 30,
              useThree: false,
              storyMode: true,
              disableMicrostock: true,
              scenes: brokenStory.shots.map((s) => ({ id: s.id, duration: s.duration })),
            });
          } else if (subStep === 2) {
            resp = toolReply(`s${subStep}`, "write", {
              filePath: "story.json",
              content: JSON.stringify(validStory, null, 2),
            });
          } else if (subStep === 3) {
            resp = toolReply(`s${subStep}`, "film_scaffold", {
              title: "Afro's Bright Morning",
              width: 1080,
              height: 1920,
              fps: 30,
              useThree: false,
              storyMode: true,
              disableMicrostock: true,
              scenes: validStory.shots.map((s) => ({ id: s.id, duration: s.duration })),
            });
          } else if (subStep === 4) {
            resp = toolReply(`s${subStep}`, "capture_film_preview", {});
          } else {
            resp = stopReply(`s${subStep}`, "Stickman Story 3-frame QC passed.");
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
  const { validStory, brokenStory } = buildStories();
  const trace = {
    sawRefsAndGalleries: false,
    sawCameraInvalid: false,
    previewResults: [],
    seenIds: new Set(),
  };
  const mockLlm = await startScriptedLlm(validStory, brokenStory, trace);
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-stickman": {
            name: "Mock Stickman Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-stickman-v": { name: "Mock Stickman Vision", vision: true } },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-stickman", modelID: "mock-stickman-v", id: "mock-stickman-v" };

    const health = await api(baseUrl, "/api/health", { authHeader });
    if (!health.ok || !health.json?.healthy) {
      throw new Error(`Engine /api/health unhealthy: ${health.text}`);
    }

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Skill Maturation E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: { text: "/mg-stickman-story Create a 3-shot 9:16 story about Afro's bright morning." },
      },
    });
    if (!postRes.ok) throw new Error(`Prompt failed: ${postRes.text}`);

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
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
      throw new Error("Expected at least 1 capture_film_preview result");
    }
    const pv = trace.previewResults[trace.previewResults.length - 1];
    const projectsDir = path.join(wsDir, "projects");
    const projSlugs = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
    const projDir = projSlugs.length > 0 ? path.join(projectsDir, projSlugs[0]) : wsDir;
    const scriptFiles = fs.existsSync(path.join(projDir, "script"))
      ? fs.readdirSync(path.join(projDir, "script")).sort()
      : [];
    const contactSheetPath = path.join(projDir, ".aetheria", "preview", "contact_sheet.jpg");
    const contactSheetBytes = fs.existsSync(contactSheetPath) ? fs.statSync(contactSheetPath).size : 0;

    const summary = {
      sawRefsAndGalleries: trace.sawRefsAndGalleries,
      sawCameraInvalid: trace.sawCameraInvalid,
      hasKitJson: fs.existsSync(path.join(projDir, "kit.json")),
      seededScripts: scriptFiles,
      previewOk: pv.ok,
      framesCaptured: Array.isArray(pv.captured) ? pv.captured.length : (pv.framesCaptured ?? 0),
      lintValid: pv.storyQa?.lintValid,
      framesPerShot: pv.storyQa?.framesPerShot,
      totalShots: pv.storyQa?.totalShots,
      failedShots: pv.storyQa?.failedShots || [],
      audioEventsCount: pv.storyQa?.audioEventsCount || 0,
      runtimeErrors: (pv.runtimeErrors || []).length,
      contactSheetBytes,
    };
    console.log("[SKILL_MATURATION_E2E]", JSON.stringify(summary, null, 2));

    const checks = [
      ["sawRefsAndGalleries", summary.sawRefsAndGalleries],
      ["sawCameraInvalid", summary.sawCameraInvalid],
      ["hasKitJson", summary.hasKitJson],
      ["seeded stickman-rig.js", summary.seededScripts.includes("stickman-rig.js")],
      ["seeded stickman-world.js", summary.seededScripts.includes("stickman-world.js")],
      ["seeded stickman-overlay.js", summary.seededScripts.includes("stickman-overlay.js")],
      ["seeded stickman-timeline.js", summary.seededScripts.includes("stickman-timeline.js")],
      ["seeded story-runtime.js", summary.seededScripts.includes("story-runtime.js")],
      ["previewOk", summary.previewOk === true],
      ["lintValid", summary.lintValid === true],
      ["framesPerShot === 3", summary.framesPerShot === 3],
      ["framesCaptured === 9", summary.framesCaptured === 9],
      ["totalShots === 3", summary.totalShots === 3],
      ["failedShots empty", summary.failedShots.length === 0],
      ["audioEventsCount > 0", summary.audioEventsCount > 0],
      ["runtimeErrors === 0", summary.runtimeErrors === 0],
      ["contactSheetBytes > 8000", summary.contactSheetBytes > 8000],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
    if (bad.length > 0) {
      throw new Error(`Skill maturation E2E failed: ${bad.join(", ")}`);
    }
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
  }
}

main().catch((err) => {
  console.error("[SKILL_MATURATION_E2E] FAILED:", err);
  process.exit(1);
});
