#!/usr/bin/env node
/**
 * Generic Plug-and-Play Declarative Skill Upload & Fast-Path E2E (`scripts/test-generic-kit-e2e.mjs`).
 *
 * Proves that a brand-new external skill package (unknown to Rust!) uploaded via `POST /api/skills/add`
 * with `files[]` (`SKILL.md`, `examples/kit.json`, `examples/story.example.json`, `examples/script/*.js`)
 * immediately runs on the zero-JS `story.json` fast path with pre-render enum validation, dynamic
 * `index.html` generation, and real Chromium CDP `contact_sheet.jpg` QA.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TEST_SLUG = "e2e-custom-neon-deck";

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function toolReply(id, name, args) {
  return {
    id: `chatcmpl-${id}`,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
  };
}

function stopReply(id, text) {
  return { id: `chatcmpl-${id}`, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
}

function buildCustomPackageFiles() {
  const skillMd = `---
name: ${TEST_SLUG}
description: "Temporary E2E custom declarative 2D neon deck skill."
tags:
  - motion-graphics
  - aetheria-motion
command: /${TEST_SLUG}
---

# Custom Neon Deck (story.json)

Write only \`story.json\` matching \`kit.json\`.
`;
  const kitJson = {
    renderer: "2d-e2e-custom-neon",
    useThree: false,
    background: "#090D1A",
    scripts: ["script/neon-kit.js", "script/story-runtime.js"],
    enums: {
      theme: ["cyber", "mint"],
      layout: ["hero", "metric"],
    },
  };
  const validStory = {
    renderer: "2d-e2e-custom-neon",
    title: "Custom Neon E2E",
    theme: "cyber",
    canvas: { w: 1080, h: 1920, fps: 30 },
    shots: [
      { id: "s1", start: 0, duration: 4.0, layout: "hero", headline: "CUSTOM KIT" },
      { id: "s2", start: 4.0, duration: 4.0, layout: "metric", headline: "100% PLUG & PLAY" },
    ],
    captions: { enabled: false },
  };
  const neonKitJs = `(function(){
    window.NeonKit = {
      drawCard: function(ctx, x, y, w, h, text, silent) {
        ctx.fillStyle = "#111827";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth = 6;
        ctx.strokeRect(x, y, w, h);
        if (!silent && text) {
          ctx.fillStyle = "#F8FAFC";
          ctx.font = "900 54px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, x + w / 2, y + h / 2);
        }
      }
    };
  })();`;
  const runtimeJs = `(function(){
    window.StoryRuntime = {
      boot: function(opts) {
        return fetch(opts.storyUrl || "/story.json").then(function(r){ return r.json(); }).then(function(spec){
          var W = spec.canvas.w || 1080, H = spec.canvas.h || 1920;
          var ctx = opts.canvas.getContext("2d");
          var sz = { minX: 49, maxX: 960, minY: 60, maxY: 1440 };
          window.__shotReport = {};
          window.__storyStats = { customShots: 0, totalShots: spec.shots.length, customRatio: 0 };
          window.__filmMeta = { title: spec.title, width: W, height: H, fps: 30, duration: 8, durationInFrames: 240, scenes: spec.shots };
          window.renderAt = function(t) {
            var shot = t < 4 ? spec.shots[0] : spec.shots[1];
            ctx.fillStyle = spec.theme === "mint" ? "#064E3B" : "#090D1A";
            ctx.fillRect(0, 0, W, H);
            window.NeonKit.drawCard(ctx, 120, 420, 780, 560, shot.headline, !!opts.isMicrostock);
            window.__shotReport[shot.id] = {
              shotId: shot.id, t: t, focusBboxInSafeZone: true,
              bbox: { behind: false, minX: 120, minY: 420, maxX: 900, maxY: 980, width: 780, height: 560 },
              overlapCount: 0, safeZone: sz, errors: []
            };
            return window.__shotReport[shot.id];
          };
          window.renderAt(0);
          window.__ready = true;
        });
      }
    };
  })();`;

  return {
    validStory,
    files: [
      { path: "SKILL.md", content: skillMd },
      { path: "examples/kit.json", content: JSON.stringify(kitJson, null, 2) },
      { path: "examples/story.example.json", content: JSON.stringify(validStory, null, 2) },
      { path: "examples/script/neon-kit.js", content: neonKitJs },
      { path: "examples/script/story-runtime.js", content: runtimeJs },
    ],
  };
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

      if (joined.includes("script/neon-kit.js") && joined.includes("useThree: false")) trace.sawGenericKitRules = true;
      if (joined.includes("STORY_KIT_ENUM_INVALID")) trace.sawKitEnumError = true;

      let resp;
      if (isCoord) {
        resp = coordStep === 0
          ? toolReply(`c${coordStep}`, "task", { description: "Build custom neon story", subagent_type: "motion-designer", prompt: "Author story.json, scaffold, and preview." })
          : stopReply(`c${coordStep}`, "Custom kit E2E selesai.");
        coordStep++;
      } else {
        if (subStep === 0) resp = toolReply(`s${subStep}`, "write", { filePath: "story.json", content: JSON.stringify(brokenStory, null, 2) });
        else if (subStep === 1) resp = toolReply(`s${subStep}`, "film_scaffold", { title: "Custom Neon E2E", preset: "portrait", storyMode: true, useThree: false, scenes });
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
  const pkg = buildCustomPackageFiles();
  const brokenStory = JSON.parse(JSON.stringify(pkg.validStory));
  brokenStory.shots[0].layout = "not-in-kit-enum";

  const trace = { sawGenericKitRules: false, sawKitEnumError: false };
  const mockLlm = await startScriptedLlm(pkg.validStory, brokenStory, trace);
  const installedSkillDir = path.join(REPO_ROOT, ".aetheria", "skills", TEST_SLUG);
  let stack = null;

  try {
    fs.rmSync(installedSkillDir, { recursive: true, force: true });
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-generic": {
            name: "Mock Generic Kit Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-generic-v": { name: "Mock Generic Vision", vision: true } },
          },
        },
      },
    });

    const base = stack.engineUrl;
    const auth = stack.authHeader;
    const dirQ = `directory=${encodeURIComponent(stack.workspaceDir)}`;

    // 1. Upload brand-new declarative skill package via POST /api/skills/add (files[])
    const addRes = await fetch(`${base}/api/skills/add`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: TEST_SLUG, description: "Custom E2E Neon Deck", files: pkg.files }),
    });
    const addJson = await addRes.json();
    assert(addRes.ok && addJson.success === true, `skills/add failed: ${JSON.stringify(addJson)}`);
    assert(fs.existsSync(path.join(installedSkillDir, "examples", "kit.json")), "kit.json uploaded into .aetheria/skills");

    // 2. Invoke the newly uploaded skill immediately via slash command
    const modelObj = { providerID: "mock-generic", modelID: "mock-generic-v", id: "mock-generic-v" };
    const sesRes = await (await fetch(`${base}/api/session?${dirQ}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Generic Kit Upload E2E", model: modelObj }),
    })).json();
    const sessionId = sesRes.data?.id || sesRes.id;
    assert(sessionId, "session created");

    const turnRes = await fetch(`${base}/api/session/${sessionId}/prompt?${dirQ}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelObj, prompt: { text: `/${TEST_SLUG} Buatkan 2 shot neon deck.` } }),
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
      if (assistants.length > 0 && (latest?.info?.time?.completed || latest?.time?.completed) && runningJobs.length === 0) break;
    }

    const projectsDir = path.join(stack.workspaceDir, "projects");
    const slugs = fs.readdirSync(projectsDir).filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());
    assert(slugs.length === 1, `expected 1 project dir, got ${slugs.join(",")}`);
    const projPath = path.join(projectsDir, slugs[0]);
    const scripts = fs.readdirSync(path.join(projPath, "script")).sort();
    const indexHtml = fs.readFileSync(path.join(projPath, "index.html"), "utf8");
    const sheetPath = path.join(projPath, ".aetheria", "preview", "contact_sheet.jpg");

    assert(trace.sawGenericKitRules, "saw generic kit.json rules");
    assert(trace.sawKitEnumError, "caught STORY_KIT_ENUM_INVALID from uploaded kit.json");
    assert(fs.existsSync(path.join(projPath, "kit.json")), "kit.json seeded into project dir");
    assert(scripts.includes("neon-kit.js") && scripts.includes("story-runtime.js"), `seeded scripts: ${scripts}`);
    assert(!indexHtml.includes("three.min.js") && indexHtml.includes("/script/neon-kit.js"), "managed index.html built dynamically from kit.json");
    assert(fs.existsSync(sheetPath) && fs.statSync(sheetPath).size > 3000, "contact_sheet.jpg rendered for custom uploaded kit");

    console.log("[GENERIC_KIT_E2E]", JSON.stringify({
      uploadedSkill: TEST_SLUG,
      seededScripts: scripts,
      sawGenericKitRules: trace.sawGenericKitRules,
      sawKitEnumError: trace.sawKitEnumError,
      contactSheetBytes: fs.statSync(sheetPath).size,
    }, null, 2));
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
    fs.rmSync(installedSkillDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[GENERIC_KIT_E2E] FAILED:", err);
  process.exit(1);
});
