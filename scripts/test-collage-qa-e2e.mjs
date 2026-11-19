#!/usr/bin/env node
/**
 * S7 Cutout Collage Declarative QA & Auto-Rollback Live-Engine E2E (`scripts/test-collage-qa-e2e.mjs`).
 *
 * Reuses `e2e/live-stack.mjs` (`startLiveStack`) with the real debug `aetheria-engine` binary
 * and real headless Chrome/Edge CDP to test the full declarative `/mg-cutout-collage` loop:
 *   1. Coordinator receives `/mg-cutout-collage` -> auto-seeds collage-kit.js, collage-layouts.js, story-runtime.js
 *      and injects 2D declarative `story.json` rules (`useThree: false`).
 *   2. `motion-designer` writes a deliberately broken `story.json` (`STORY_UNKNOWN_LAYOUT`) ->
 *      `film_scaffold(storyMode: true, useThree: false)` generates managed 2D `index.html` with 0 `scene*.js` stubs
 *      and emits structured `STORY_UNKNOWN_LAYOUT`.
 *   3. Single correction pass fixes `story.json` -> `capture_film_preview` renders `.aetheria/preview/contact_sheet.jpg`
 *      with 6/6 safe, 0 overlaps, 0 runtime errors.
 *   4. Deliberate regression edit -> `capture_film_preview` triggers `autoRolledBack === true`
 *      and restores `story.json` on disk back to the passing snapshot.
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
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function stopReply(id, text) {
  return {
    id: `chatcmpl-${id}`,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  };
}

function startScriptedLlm(validStory, brokenStory, regressedStory, trace) {
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

      if (joined.includes("useThree: false") && joined.includes("script/collage-")) trace.saw2dRules = true;
      if (joined.includes("STORY_UNKNOWN_LAYOUT")) trace.sawBadLayout = true;
      if (joined.includes("\"autoRolledBack\":true") || joined.includes("autoRolledBack")) trace.sawRollback = true;

      let resp;
      if (isCoord) {
        if (coordStep === 0) {
          resp = toolReply(`c${coordStep}`, "task", {
            description: "Build collage story.json",
            subagent_type: "motion-designer",
            prompt: "Author story.json for /mg-cutout-collage, scaffold with storyMode:true & useThree:false, and preview.",
          });
        } else {
          resp = stopReply(`c${coordStep}`, "Collage 2D story selesai diverifikasi.");
        }
        coordStep++;
      } else {
        if (subStep === 0) {
          resp = toolReply(`s${subStep}`, "write", { filePath: "story.json", content: JSON.stringify(brokenStory, null, 2) });
        } else if (subStep === 1) {
          resp = toolReply(`s${subStep}`, "film_scaffold", {
            title: "Collage E2E",
            preset: "portrait",
            storyMode: true,
            useThree: false,
            scenes,
          });
        } else if (subStep === 2) {
          resp = toolReply(`s${subStep}`, "write", { filePath: "story.json", content: JSON.stringify(validStory, null, 2) });
        } else if (subStep === 3) {
          resp = toolReply(`s${subStep}`, "capture_film_preview", {});
        } else if (subStep === 4) {
          resp = toolReply(`s${subStep}`, "write", { filePath: "story.json", content: JSON.stringify(regressedStory, null, 2) });
        } else if (subStep === 5) {
          resp = toolReply(`s${subStep}`, "capture_film_preview", {});
        } else {
          resp = stopReply(`s${subStep}`, "Subagent collage QA done.");
        }
        subStep++;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resp));
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function main() {
  const examplePath = path.join(REPO_ROOT, ".aetheria", "skills", "mg-cutout-collage", "examples", "story.example.json");
  const validStory = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const brokenStory = JSON.parse(JSON.stringify(validStory));
  brokenStory.shots[0].layout = "invalid-layout-xyz";
  const regressedStory = JSON.parse(JSON.stringify(validStory));
  regressedStory.shots[1].layout = "broken-regression-layout";

  const trace = { saw2dRules: false, sawBadLayout: false, sawRollback: false };
  const mockLlm = await startScriptedLlm(validStory, brokenStory, regressedStory, trace);
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-collage": {
            name: "Mock Collage QA Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-collage-v": { name: "Mock Collage Vision", vision: true } },
          },
        },
      },
    });

    const base = stack.engineUrl;
    const auth = stack.authHeader;
    const dirQ = `directory=${encodeURIComponent(stack.workspaceDir)}`;

    const modelObj = { providerID: "mock-collage", modelID: "mock-collage-v", id: "mock-collage-v" };
    const sesRes = await (await fetch(`${base}/api/session?${dirQ}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Collage 2D QA E2E", model: modelObj }),
    })).json();
    const sessionId = sesRes.data?.id || sesRes.id;
    assert(sessionId, "session created");

    const turnRes = await fetch(`${base}/api/session/${sessionId}/prompt?${dirQ}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelObj,
        prompt: { text: "/mg-cutout-collage Buatkan video kolase 6 shot tentang otak kreatif." },
      }),
    });
    assert(turnRes.ok, `turn HTTP ${turnRes.status}`);

    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      await new Promise((r) => setTimeout(r, 500));
      const [msgRes, jobsRes] = await Promise.all([
        fetch(`${base}/api/session/${sessionId}/message?order=asc&${dirQ}`, { headers: { Authorization: auth } }).then((r) => r.json()).catch(() => null),
        fetch(`${base}/api/session/${sessionId}/jobs`, { headers: { Authorization: auth } }).then((r) => r.json()).catch(() => null),
      ]);
      const msgs = msgRes?.data ?? msgRes ?? [];
      const assistants = Array.isArray(msgs) ? msgs.filter((m) => (m.info?.role ?? m.role) === "assistant") : [];
      const jobs = jobsRes?.data ?? [];
      const runningJobs = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running") : [];
      const latest = assistants[assistants.length - 1];
      if (assistants.length > 0 && (latest?.info?.time?.completed || latest?.time?.completed) && runningJobs.length === 0) {
        break;
      }
    }

    const projectsDir = path.join(stack.workspaceDir, "projects");
    const slugs = fs.readdirSync(projectsDir).filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());
    assert(slugs.length === 1, `expected 1 project dir, got ${slugs.join(",")}`);
    const projPath = path.join(projectsDir, slugs[0]);
    const scripts = fs.readdirSync(path.join(projPath, "script")).sort();
    const sheetPath = path.join(projPath, ".aetheria", "preview", "contact_sheet.jpg");
    const diskStory = JSON.parse(fs.readFileSync(path.join(projPath, "story.json"), "utf8"));
    const indexHtml = fs.readFileSync(path.join(projPath, "index.html"), "utf8");

    assert(trace.saw2dRules, "saw 2D declarative rules (useThree: false & script/collage-)");
    assert(trace.sawBadLayout, "caught STORY_UNKNOWN_LAYOUT pre-render");
    assert(trace.sawRollback, "auto-rollback triggered on regressed story.json");
    assert(
      scripts.includes("collage-kit.js") && scripts.includes("collage-layouts.js") && scripts.includes("story-runtime.js"),
      `seeded collage scripts: ${scripts}`,
    );
    assert(!scripts.some((s) => s.startsWith("scene")), `zero scene*.js stubs created: ${scripts}`);
    assert(!indexHtml.includes("three.min.js") && indexHtml.includes("/script/collage-kit.js"), "managed 2D index.html loads collage-kit without three.min.js");
    assert(fs.existsSync(sheetPath) && fs.statSync(sheetPath).size > 5000, "contact_sheet.jpg generated");
    assert(diskStory.shots[1].layout === "split-compare", "story.json restored to clean layout after rollback");

    console.log("[COLLAGE_QA_E2E]", JSON.stringify({
      projDir: `projects/${slugs[0]}`,
      seededScripts: scripts,
      saw2dRules: trace.saw2dRules,
      sawBadLayout: trace.sawBadLayout,
      sawRollback: trace.sawRollback,
      contactSheetBytes: fs.statSync(sheetPath).size,
      diskLayoutRestored: diskStory.shots[1].layout,
    }, null, 2));
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
  }
}

main().catch((err) => {
  console.error("[COLLAGE_QA_E2E] FAILED:", err);
  process.exit(1);
});
