#!/usr/bin/env node
/**
 * Live-engine E2E test for the Antigravity-Grade Smart Per-Scene Agentic Harness:
 *   1. Verifies Director profile directly exposes `write` & `edit` (zero forced subagents).
 *   2. Verifies Direct Per-Scene Remake exposes all 5 micro-tools:
 *        - `inspect_ref_frame` (with zoom crop -> returns JPEG image_url)
 *        - `sample_ref_region` (returns exact measured hex & foregroundBox)
 *        - `write_scene_script`
 *        - `patch_scene_script` (surgical edit + clean error on missing oldText)
 *        - `render_and_compare_scene` (real headless CDP comparison strip + full-res frame)
 *   3. Verifies backward-compatible raw ```javascript``` code-block fallback on Scene 4.
 *   4. Verifies ZERO subagents are spawned and engine stays healthy throughout.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

async function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 120_000 } = {}) {
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
          } catch {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function generateSynthetic4SceneVideo(destMp4) {
  const refDir = path.join(REPO_ROOT, "core", "ref_extractor").replace(/\\/g, "/");
  const outMp4 = destMp4.replace(/\\/g, "/");
  const py = `
import sys
from pathlib import Path
sys.path.insert(0, r"${refDir}")
import synth_reference

spec = {
    "name": "smart_harness_e2e_4sc",
    "width": 640,
    "height": 360,
    "fps": 30.0,
    "hasAudio": False,
    "scenes": [
        {"id": "s1", "kind": "textured", "seed": 601, "durationSec": 1.2, "bgBgr": (18, 20, 26)},
        {"id": "s2", "kind": "textured", "seed": 602, "durationSec": 1.2, "bgBgr": (236, 232, 224), "transitionFromPrev": "hard"},
        {"id": "s3", "kind": "textured", "seed": 603, "durationSec": 1.2, "bgBgr": (22, 26, 38), "transitionFromPrev": "hard"},
        {"id": "s4", "kind": "textured", "seed": 604, "durationSec": 1.2, "bgBgr": (240, 238, 234), "transitionFromPrev": "hard"},
    ],
}
synth_reference.generate_synthetic_clip(spec, Path(r"${outMp4}"))
`;
  execFileSync("python", ["-c", py], { stdio: "pipe" });
}

function startSmartHarnessMockLlm() {
  let coordStep = 0;
  let directorHasOpenCodeFreedom = false;
  let all6SceneToolsExposed = false;
  let inspectRefFrameReturnedImage = false;
  let sampleRefRegionReturnedHex = false;
  let bashWorkedInScene = false;
  let renderReturnedStripAndFullRes = false;
  let badPatchErroredCleanly = false;
  let subagentsSpawned = 0;
  const sceneStepCounts = new Map();

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-smart-v", object: "model" }] }));
        return;
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const msgs = payload.messages || [];
      const sysText = String(msgs[0]?.content || "");
      const toolNames = (payload.tools || []).map((t) => t?.function?.name).filter(Boolean);

      const respond = (msgObj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                finish_reason: msgObj.tool_calls ? "tool_calls" : "stop",
                message: msgObj,
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
          })
        );
      };

      // Check if we're inside the Smart Per-Scene Agentic Harness
      if (sysText.includes("ANTIGRAVITY-GRADE INTERACTIVE WORKFLOW")) {
        const expectedTools = [
          "inspect_ref_frame",
          "sample_ref_region",
          "bash",
          "write_scene_script",
          "patch_scene_script",
          "render_and_compare_scene",
        ];
        if (expectedTools.every((n) => toolNames.includes(n))) {
          all6SceneToolsExposed = true;
        }

        const firstUserParts = Array.isArray(msgs[1]?.content) ? msgs[1].content : [];
        const firstUserText = firstUserParts.map((p) => p?.text || "").join("\n");
        const scMatch = firstUserText.match(/TARGET SCENE (\d+)\/\d+: id="([^"]+)"/);
        const sceneNum = scMatch ? Number(scMatch[1]) : 1;
        const sceneId = scMatch ? scMatch[2] : `scene${sceneNum}`;
        const step = (sceneStepCounts.get(sceneNum) || 0) + 1;
        sceneStepCounts.set(sceneNum, step);

        // Inspect tool outputs already returned in conversation
        const toolMsgs = msgs.filter((m) => m.role === "tool");
        const userMsgs = msgs.filter((m) => m.role === "user");

        if (sceneNum === 1) {
          if (step === 1) {
            return respond({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "s1_inspect",
                  type: "function",
                  function: {
                    name: "inspect_ref_frame",
                    arguments: JSON.stringify({ timestampSec: 0.5, crop: { x: 120, y: 80, w: 220, h: 160 } }),
                  },
                },
                {
                  id: "s1_sample",
                  type: "function",
                  function: {
                    name: "sample_ref_region",
                    arguments: JSON.stringify({ timestampSec: 0.5, box: { x: 120, y: 80, w: 220, h: 160 } }),
                  },
                },
                {
                  id: "s1_bash",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: JSON.stringify({ command: "Write-Output SMART_BASH_OK" }),
                  },
                },
              ],
            });
          }
          if (step === 2) {
            const sampleMsg = toolMsgs.find((m) => m.name === "sample_ref_region");
            if (sampleMsg && String(sampleMsg.content || "").includes("medianHex")) {
              sampleRefRegionReturnedHex = true;
            }
            const bashMsg = toolMsgs.find((m) => m.name === "bash");
            if (bashMsg && String(bashMsg.content || "").includes("SMART_BASH_OK")) {
              bashWorkedInScene = true;
            }
            const lastUser = userMsgs[userMsgs.length - 1];
            const lastImgs = Array.isArray(lastUser?.content)
              ? lastUser.content.filter((p) => p?.type === "image_url")
              : [];
            if (lastImgs.length >= 1) {
              inspectRefFrameReturnedImage = true;
            }
            const draftCode = [
              "(function () {",
              "  var AM = window.AM;",
              `  AM.registerScene("${sceneId}", function (ctx, t, dur, scene, AM) {`,
              "    var W = 640, H = 360;",
              "    var preservedAnchor = 'KEEP_ME_INTACT';",
              "    var accent = '#FF0000';",
              "    ctx.fillStyle = '#14161A';",
              "    ctx.fillRect(0, 0, W, H);",
              "    var p = AM.ease.outCubic(AM.clamp(t / Math.max(0.2, dur), 0, 1));",
              "    ctx.fillStyle = accent;",
              "    ctx.fillRect(140 + 40 * p, 95, 220, 150);",
              "    if (preservedAnchor) { ctx.fillStyle = '#F2F0EC'; ctx.fillRect(200, 140, 100, 40); }",
              "  });",
              "})();",
            ].join("\n");
            return respond({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "s1_write",
                  type: "function",
                  function: { name: "write_scene_script", arguments: JSON.stringify({ code: draftCode }) },
                },
              ],
            });
          }
          if (step === 3) {
            return respond({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "s1_render1",
                  type: "function",
                  function: {
                    name: "render_and_compare_scene",
                    arguments: JSON.stringify({ timestamps: [0.2, 0.7], fullResTimestamp: 0.5 }),
                  },
                },
              ],
            });
          }
          if (step === 4) {
            const lastUser = userMsgs[userMsgs.length - 1];
            const lastImgs = Array.isArray(lastUser?.content)
              ? lastUser.content.filter((p) => p?.type === "image_url")
              : [];
            if (lastImgs.length >= 2) {
              renderReturnedStripAndFullRes = true;
            }
            // Intentional failure path: non-matching oldText must return clean error
            return respond({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "s1_bad_patch",
                  type: "function",
                  function: {
                    name: "patch_scene_script",
                    arguments: JSON.stringify({ oldText: "NON_EXISTENT_ANCHOR_XYZ", newText: "broken" }),
                  },
                },
              ],
            });
          }
          if (step === 5) {
            const badPatchMsg = toolMsgs.find((m) => m.tool_call_id === "s1_bad_patch");
            const badPatchText = String(badPatchMsg?.content || "");
            if (badPatchText.startsWith("Error:") || badPatchText.includes('"ok":false')) {
              badPatchErroredCleanly = true;
            }
            // Real surgical patch
            return respond({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "s1_good_patch",
                  type: "function",
                  function: {
                    name: "patch_scene_script",
                    arguments: JSON.stringify({
                      oldText: "    var accent = '#FF0000';",
                      newText: "    var accent = '#F58C28';",
                    }),
                  },
                },
              ],
            });
          }
          if (step === 6) {
            return respond({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "s1_render2",
                  type: "function",
                  function: { name: "render_and_compare_scene", arguments: JSON.stringify({}) },
                },
              ],
            });
          }
          return respond({ role: "assistant", content: "Scene 1 verified and complete." });
        }

        // Scene 4: exercise graceful raw ```javascript``` code-block fallback (no tool call)
        if (sceneNum === 4) {
          if (step === 1) {
            return respond({
              role: "assistant",
              content:
                "```javascript\n" +
                "(function(){ var AM=window.AM; AM.registerScene(\"" +
                sceneId +
                "\", function(ctx,t,dur){ var p=AM.clamp(t/Math.max(0.2,dur),0,1); ctx.fillStyle='#EAE8E4'; ctx.fillRect(0,0,640,360); ctx.fillStyle='#24262E'; ctx.fillRect(160+30*p,110,240,120); }); })();\n" +
                "```",
            });
          }
          return respond({ role: "assistant", content: "Scene 4 fallback verified." });
        }

        // Scenes 2 & 3: fast write + render + done
        if (step === 1) {
          const bg = sceneNum === 2 ? "#EAE6DE" : "#181C28";
          const fg = sceneNum === 2 ? "#1E222A" : "#6EB8F5";
          const code = `(function(){ var AM=window.AM; AM.registerScene("${sceneId}", function(ctx,t,dur){ var p=AM.clamp(t/Math.max(0.2,dur),0,1); ctx.fillStyle="${bg}"; ctx.fillRect(0,0,640,360); ctx.fillStyle="${fg}"; ctx.fillRect(150+35*p,100,260,140); }); })();\n`;
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_write`,
                type: "function",
                function: { name: "write_scene_script", arguments: JSON.stringify({ code }) },
              },
            ],
          });
        }
        if (step === 2) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `s${sceneNum}_render`,
                type: "function",
                function: { name: "render_and_compare_scene", arguments: JSON.stringify({}) },
              },
            ],
          });
        }
        return respond({ role: "assistant", content: `Scene ${sceneNum} verified.` });
      }

      // Main coordinator turn
      if (sysText.includes("Motion Designer Subagent") || sysText.includes("QA Verifier")) {
        subagentsSpawned += 1;
        return respond({ role: "assistant", content: "Unexpected subagent call." });
      }

      coordStep += 1;
      if (
        ["write", "edit", "bash", "inspect_ref_frame", "sample_ref_region"].every((t) =>
          toolNames.includes(t)
        )
      ) {
        directorHasOpenCodeFreedom = true;
      }
      if (coordStep === 1) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "c_ext",
              type: "function",
              function: {
                name: "extract_video_reference",
                arguments: JSON.stringify({ videoPath: "ref/ref_smart_e2e.mp4" }),
              },
            },
          ],
        });
      }
      if (coordStep === 2) {
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "c_scaf",
              type: "function",
              function: {
                name: "film_scaffold",
                arguments: JSON.stringify({
                  title: "Smart Harness E2E",
                  width: 640,
                  height: 360,
                  fps: 30,
                  background: "#12141A",
                  scenes: [
                    { id: "scene1_hook", duration: 1.2 },
                    { id: "scene2_problem_or_context", duration: 1.2 },
                    { id: "scene3_proof_or_demo", duration: 1.2 },
                    { id: "scene4_cta", duration: 1.2 },
                  ],
                }),
              },
            },
          ],
        });
      }
      return respond({ role: "assistant", content: "Done." });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        getStats: () => ({
          coordStep,
          directorHasOpenCodeFreedom,
          all6SceneToolsExposed,
          inspectRefFrameReturnedImage,
          sampleRefRegionReturnedHex,
          bashWorkedInScene,
          renderReturnedStripAndFullRes,
          badPatchErroredCleanly,
          subagentsSpawned,
          sceneStepCounts: Object.fromEntries(sceneStepCounts.entries()),
        }),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const mockLlm = await startSmartHarnessMockLlm();
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      env: { AETHERIA_DISABLE_OCR: "1", AETHERIA_REMAKE_MODE: "direct" },
      aetheriaConfig: {
        provider: {
          "mock-smart": {
            name: "Mock Smart Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-smart-v": { name: "Mock Smart Vision", vision: true } },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-smart", modelID: "mock-smart-v", id: "mock-smart-v" };

    const h1 = await api(baseUrl, "/api/health", { authHeader });
    assert(h1.ok && h1.json?.healthy === true, `Engine unhealthy: ${h1.text}`);

    generateSynthetic4SceneVideo(path.join(wsDir, "ref", "ref_smart_e2e.mp4"));

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Smart Per-Scene Harness E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    assert(Boolean(sessId), `Missing session id: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: { text: "Ikuti referensi video ref/ref_smart_e2e.mp4 dan buat ulang 4 scene secara presisi." },
      },
    });
    assert(postRes.ok, `Prompt failed: ${postRes.text}`);

    const deadline = Date.now() + 180_000;
    let completed = false;
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
        completed = true;
        break;
      }
    }
    if (!completed) {
      console.error("[SMART_E2E_TIMEOUT_STATS]", JSON.stringify(mockLlm.getStats()));
    }
    assert(completed, "Timed out waiting for smart harness turn completion");

    // Locate scaffolded project folder
    const projsDir = path.join(wsDir, "projects");
    const slug = fs.readdirSync(projsDir).find((d) => fs.existsSync(path.join(projsDir, d, "film.json")));
    assert(Boolean(slug), `No project folder created under ${projsDir}`);
    const projDir = path.join(projsDir, slug);

    const sc1Code = fs.readFileSync(path.join(projDir, "script", "scene1.js"), "utf8");
    const sc4Code = fs.readFileSync(path.join(projDir, "script", "scene4.js"), "utf8");
    const surgicalPatchPreservedCode =
      sc1Code.includes("var accent = '#F58C28';") &&
      !sc1Code.includes("var accent = '#FF0000';") &&
      sc1Code.includes("KEEP_ME_INTACT");
    const rawCodeBlockFallbackWorked = sc4Code.includes('AM.registerScene("scene4_cta"');

    const h2 = await api(baseUrl, "/api/health", { authHeader });
    assert(h2.ok && h2.json?.healthy === true, `Engine unhealthy after run: ${h2.text}`);

    // Verify Phase X0 telemetry trace file exists, has valid JSONL schema across all 4 scenes, and zero secrets
    const traceFile = path.join(wsDir, ".aetheria", "trace", `direct_remake_${sessId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`);
    assert(fs.existsSync(traceFile), `Missing X0 trace file at ${traceFile}`);
    const traceRaw = fs.readFileSync(traceFile, "utf8");
    assert(!traceRaw.includes("data:image"), "X0 trace must not contain base64 images");
    assert(!traceRaw.includes("sk-mock"), "X0 trace must not contain API keys");
    const traceRows = traceRaw
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    assert(traceRows.length >= 9, `Expected >= 9 trace JSONL lines, got ${traceRows.length}`);
    assert(traceRows[0].type === "run_header", "Line 0 must be run_header");
    assert(traceRows[0].systemPromptBytes > 2500 && typeof traceRows[0].systemPromptHash === "string", "run_header missing prompt metadata");
    const stepRows = traceRows.filter((r) => r.type === "step");
    const summaryRows = traceRows.filter((r) => r.type === "scene_summary");
    assert(stepRows.length >= 4, "Expected step trace entries");
    assert(summaryRows.length === 4, `Expected 4 scene_summary entries, got ${summaryRows.length}`);
    assert(summaryRows[0].firstWriteStep === 2, `Expected scene 1 firstWriteStep=2, got ${summaryRows[0].firstWriteStep}`);
    assert(summaryRows[0].probeCallsBeforeWrite === 3, `Expected scene 1 3 probe calls before write, got ${summaryRows[0].probeCallsBeforeWrite}`);

    const stats = mockLlm.getStats();
    const summary = {
      ...stats,
      traceLines: traceRows.length,
      traceFile,
      surgicalPatchPreservedCode,
      rawCodeBlockFallbackWorked,
    };
    console.log("[SMART_SCENE_HARNESS_E2E_PASS]", JSON.stringify(summary));

    assert(summary.directorHasOpenCodeFreedom, "Director missing OpenCode tool freedom (write/edit/bash/inspect_ref_frame/sample_ref_region)");
    assert(summary.all6SceneToolsExposed, "Smart per-scene harness did not expose all 6 micro-tools including bash");
    assert(summary.inspectRefFrameReturnedImage, "inspect_ref_frame did not attach vision image");
    assert(summary.sampleRefRegionReturnedHex, "sample_ref_region did not return medianHex");
    assert(summary.bashWorkedInScene, "bash did not execute cleanly inside per-scene harness");
    assert(summary.renderReturnedStripAndFullRes, "render_and_compare_scene did not attach strip + full-res frame");
    assert(summary.badPatchErroredCleanly, "patch_scene_script failed to return clean error on missing oldText");
    assert(summary.surgicalPatchPreservedCode, "Surgical patch did not preserve untouched code or apply edit");
    assert(summary.rawCodeBlockFallbackWorked, "Raw code-block fallback failed on Scene 4");
    assert(summary.subagentsSpawned === 0, `Unexpected subagents spawned: ${summary.subagentsSpawned}`);
  } finally {
    await stack?.stop();
    await mockLlm.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[SMART_SCENE_HARNESS_E2E_FAIL]", err);
  process.exit(1);
});
