#!/usr/bin/env node
/**
 * S3/S4/S5 Live-Engine E2E Verification (`scripts/test-story-qa-e2e.mjs`).
 *
 * Reuses `e2e/live-stack.mjs` (`startLiveStack`) with the real debug `aetheria-engine` binary
 * and real headless Chrome/Edge CDP to test the full declarative `/mg-soft-clay-story` loop:
 *   1. Coordinator receives `/mg-soft-clay-story` -> auto-seeds clay-kit, clay-assets, story-runtime
 *      and injects declarative `story.json` rules.
 *   2. `motion-designer` writes a deliberately broken `story.json` (invalid focus ID + shot gap) ->
 *      `film_scaffold(storyMode: true)` generates managed `index.html` with 0 `scene*.js` stubs and
 *      emits structured `STORY_UNKNOWN_FOCUS` & `STORY_SHOT_DISCONTINUITY` errors; `capture_film_preview`
 *      reports `failedShots: ["shot2_hama_muncul"]` + generates `.aetheria/preview/contact_sheet.jpg`.
 *   3. Single correction pass fixes `story.json` -> `capture_film_preview` passes (`ok: true`,
 *      `lintValid: true`, `failedShots: []`, 6/6 shots in safe zone, `customShots: 0`, `0` runtime errors).
 *   4. Deliberate regression edit -> `capture_film_preview` triggers `storyQa.autoRolledBack === true`
 *      and restores `story.json` on disk back to the passing Pass-1 snapshot.
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

function buildStorySpecs() {
  const examplePath = path.join(
    REPO_ROOT,
    ".aetheria",
    "skills",
    "mg-soft-clay-story",
    "examples",
    "story.example.json",
  );
  const validStory = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const brokenStory = JSON.parse(JSON.stringify(validStory));
  brokenStory.shots[1].focus = "hantu_salah";
  brokenStory.shots[1].start = 6.5;

  const regressedStory = JSON.parse(JSON.stringify(validStory));
  regressedStory.shots[2].focus = "broken_again";

  return { validStory, brokenStory, regressedStory };
}

function startScriptedLlm(validStory, brokenStory, regressedStory, trace) {
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
          tool_calls: [
            {
              id: `call_${id}_${name}`,
              type: "function",
              function: { name, arguments: JSON.stringify(argsObj) },
            },
          ],
        },
      },
    ],
  });

  const stopReply = (id, text) => ({
    id,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: text },
      },
    ],
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ id: "mock-story-v", object: "model" }] }));
          return;
        }
        const parsed = JSON.parse(body || "{}");
        const msgs = parsed.messages || [];
        const sysText = String(msgs[0]?.content || "");
        const isCoordinator = !sysText.includes("Motion Designer Subagent");
        const joined = msgs
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n");

        const seenIds = trace.seenToolCallIds;
        for (const m of msgs) {
          if (m.role === "tool") {
            const cid = m.tool_call_id || "";
            if (cid && seenIds.has(cid)) continue;
            if (cid) seenIds.add(cid);
            const txt = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            if (txt.includes("STORY_UNKNOWN_FOCUS")) trace.sawPreRenderUnknownFocus = true;
            if (txt.includes("STORY_SHOT_DISCONTINUITY")) trace.sawPreRenderDiscontinuity = true;
            if (txt.includes("\"autoRolledBack\":true") || txt.includes("\"autoRolledBack\": true")) {
              trace.sawAutoRollback = true;
            }
            if (txt.includes("\"storyQa\"")) {
              try {
                trace.previewResults.push(JSON.parse(txt));
              } catch {}
            }
          }
        }

        let resp;
        if (isCoordinator) {
          if (coordStep === 0) {
            trace.sawDeclarativeSkillRules =
              joined.includes("DECLARATIVE STORY KIT") && joined.includes("story.example.json");
            trace.sawSeededKitNote =
              joined.includes("clay-assets.js") && joined.includes("story-runtime.js");
            resp = toolReply(`c${coordStep}`, "task", {
              subagent_type: "motion-designer",
              description: "Author declarative story.json and run QA preview",
              prompt:
                "Author story.json for the 6-shot farmer-vs-pest soft-clay story, run film_scaffold(storyMode: true), and verify via capture_film_preview.",
            });
          } else {
            resp = stopReply(`c${coordStep}`, "Declarative story QA E2E complete.");
          }
          coordStep++;
        } else {
          // motion-designer subagent drives write -> film_scaffold -> preview (broken) -> 1-pass fix -> preview (ok) -> regression -> preview (rollback)
          if (subStep === 0) {
            resp = toolReply(`s${subStep}`, "write", {
              filePath: "story.json",
              content: JSON.stringify(brokenStory, null, 2),
            });
          } else if (subStep === 1) {
            resp = toolReply(`s${subStep}`, "film_scaffold", {
              title: "Petani Melawan Hama Sawah",
              width: 1080,
              height: 1920,
              fps: 30,
              useThree: true,
              storyMode: true,
              disableMicrostock: true,
              scenes: brokenStory.shots.map((s) => ({ id: s.id, duration: s.duration })),
            });
          } else if (subStep === 2) {
            resp = toolReply(`s${subStep}`, "capture_film_preview", {});
          } else if (subStep === 3) {
            resp = toolReply(`s${subStep}`, "write", {
              filePath: "story.json",
              content: JSON.stringify(validStory, null, 2),
            });
          } else if (subStep === 4) {
            resp = toolReply(`s${subStep}`, "capture_film_preview", {});
          } else if (subStep === 5) {
            resp = toolReply(`s${subStep}`, "write", {
              filePath: "story.json",
              content: JSON.stringify(regressedStory, null, 2),
            });
          } else if (subStep === 6) {
            resp = toolReply(`s${subStep}`, "capture_film_preview", {});
          } else {
            resp = stopReply(`s${subStep}`, "Subagent story QA verification finished.");
          }
          subStep++;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resp));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function main() {
  const { validStory, brokenStory, regressedStory } = buildStorySpecs();
  const trace = {
    sawDeclarativeSkillRules: false,
    sawSeededKitNote: false,
    sawPreRenderUnknownFocus: false,
    sawPreRenderDiscontinuity: false,
    sawAutoRollback: false,
    previewResults: [],
    seenToolCallIds: new Set(),
  };
  const mockLlm = await startScriptedLlm(validStory, brokenStory, regressedStory, trace);
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-story": {
            name: "Mock Story QA Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-story-v": { name: "Mock Story Vision", vision: true } },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-story", modelID: "mock-story-v", id: "mock-story-v" };

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Story QA E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: { text: "/mg-soft-clay-story Buatkan video cerita 6 shot petani melawan hama sawah." },
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
      const runningJobs = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running") : [];
      const latest = assistants[assistants.length - 1];
      if (assistants.length > 0 && (latest?.info?.time?.completed || latest?.time?.completed) && runningJobs.length === 0) {
        break;
      }
    }

    const previewParts = trace.previewResults;
    if (previewParts.length < 3) {
      throw new Error(`Expected 3 capture_film_preview results (broken, fixed, regressed), got ${previewParts.length}`);
    }

    const [pBroken, pFixed, pRegressed] = previewParts;

    // Locate active project folder
    const projectsDir = path.join(wsDir, "projects");
    const projSlugs = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
    const projDir = projSlugs.length > 0 ? path.join(projectsDir, projSlugs[0]) : wsDir;
    const storyDisk = JSON.parse(fs.readFileSync(path.join(projDir, "story.json"), "utf8"));
    const scriptFiles = fs.existsSync(path.join(projDir, "script"))
      ? fs.readdirSync(path.join(projDir, "script")).sort()
      : [];
    const sceneStubs = scriptFiles.filter((f) => /^scene\d+\.js$/i.test(f));
    const contactSheetPath = path.join(projDir, ".aetheria", "preview", "contact_sheet.jpg");
    const contactSheetBytes = fs.existsSync(contactSheetPath) ? fs.statSync(contactSheetPath).size : 0;

    const { previewResults: _omit, seenToolCallIds: _omit2, ...traceFlags } = trace;
    const summary = {
      ...traceFlags,
      projDir: path.relative(wsDir, projDir).replace(/\\/g, "/"),
      seededScripts: scriptFiles,
      zeroSceneStubsCreated: sceneStubs.length === 0,
      brokenPreviewOk: pBroken.ok,
      brokenLintValid: pBroken.storyQa?.lintValid,
      brokenFailedShots: pBroken.storyQa?.failedShots,
      fixedPreviewOk: pFixed.ok,
      fixedLintValid: pFixed.storyQa?.lintValid,
      fixedFailedShots: pFixed.storyQa?.failedShots,
      fixedCustomShots: pFixed.storyQa?.customShots,
      fixedTotalShots: pFixed.storyQa?.totalShots,
      fixedRuntimeErrors: (pFixed.runtimeErrors || []).length,
      regressedAutoRolledBack: pRegressed.storyQa?.autoRolledBack,
      diskFocusRestoredAfterRollback: storyDisk.shots?.[2]?.focus === "jeriken_organik",
      contactSheetBytes,
    };

    console.log("[STORY_QA_E2E]", JSON.stringify(summary, null, 2));

    const checks = [
      ["sawDeclarativeSkillRules", summary.sawDeclarativeSkillRules],
      ["sawSeededKitNote", summary.sawSeededKitNote],
      ["sawPreRenderUnknownFocus", summary.sawPreRenderUnknownFocus],
      ["sawPreRenderDiscontinuity", summary.sawPreRenderDiscontinuity],
      ["zeroSceneStubsCreated", summary.zeroSceneStubsCreated],
      ["brokenPreviewOk === false", summary.brokenPreviewOk === false],
      ["brokenLintValid === false", summary.brokenLintValid === false],
      ["brokenFailedShots includes shot2", (summary.brokenFailedShots || []).includes("shot2_hama_muncul")],
      ["fixedPreviewOk === true", summary.fixedPreviewOk === true],
      ["fixedLintValid === true", summary.fixedLintValid === true],
      ["fixedFailedShots empty", (summary.fixedFailedShots || []).length === 0],
      ["fixedTotalShots === 6", summary.fixedTotalShots === 6],
      ["fixedCustomShots === 0", summary.fixedCustomShots === 0],
      ["fixedRuntimeErrors === 0", summary.fixedRuntimeErrors === 0],
      ["regressedAutoRolledBack === true", summary.regressedAutoRolledBack === true],
      ["diskFocusRestoredAfterRollback", summary.diskFocusRestoredAfterRollback === true],
      ["contactSheetBytes > 5000", summary.contactSheetBytes > 5000],
    ];
    const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length > 0) {
      throw new Error(`Story QA E2E assertion(s) failed: ${failed.join(", ")}`);
    }
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
  }
}

main().catch((err) => {
  console.error("[STORY_QA_E2E] FAILED:", err);
  process.exit(1);
});
