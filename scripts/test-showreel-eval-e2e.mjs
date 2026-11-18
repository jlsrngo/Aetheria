#!/usr/bin/env node
/**
 * Reproducible E2E test verifying the full upgraded reference -> showreel audio ->
 * AM high-craft primitives -> mandatory evaluation-before-stop Diff Heatmap polish loop
 * against a live compiled aetheria-engine binary.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startLiveStack } from "../e2e/live-stack.mjs";

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

function buildSyntheticReferenceVideo(destMp4) {
  const py = `
import math, wave, struct, tempfile, subprocess
from pathlib import Path
import cv2, numpy as np

out_mp4 = Path(r"""${destMp4}""")
out_mp4.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    td = Path(tmp)
    silent_mp4 = td / "vid.mp4"
    wav_path = td / "bgm.wav"
    w = cv2.VideoWriter(str(silent_mp4), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (640, 360))
    for f in range(180):
        if f < 60:
            img = np.full((360, 640, 3), 14, dtype=np.uint8)
            r = int(48 + 20 * min(1.0, f / 30.0))
            cv2.circle(img, (320, 180), r, (239, 86, 125), -1)
            cv2.putText(img, "SHOW", (245, 192), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (245, 245, 250), 2, cv2.LINE_AA)
        elif f < 120:
            img = np.full((360, 640, 3), 14, dtype=np.uint8)
            dx = int(40 * min(1.0, (f - 60) / 30.0))
            cv2.rectangle(img, (190, 90), (450, 270), (244, 242, 238), -1)
            cv2.rectangle(img, (220 + dx, 155), (340 + dx, 205), (90, 175, 225), -1)
        else:
            img = np.full((360, 640, 3), 21, dtype=np.uint8)
            img[:, :, 0] = 46; img[:, :, 1] = 27
            dy = int(16 * min(1.0, (f - 120) / 30.0))
            cv2.rectangle(img, (160, 100 + dy), (480, 245 + dy), (248, 189, 56), -1)
            cv2.putText(img, "PRO", (272, 184 + dy), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (20, 22, 28), 2, cv2.LINE_AA)
        w.write(img)
    w.release()

    sr = 22050
    dur = 6.0
    n = int(sr * dur)
    samples = []
    beat = 60.0 / 120.0
    for i in range(n):
        t = i / sr
        bt = t % beat
        pad = 0.16 * math.sin(2 * math.pi * 130.8 * t) + 0.10 * math.sin(2 * math.pi * 196.0 * t)
        kick = 0.35 * math.sin(2 * math.pi * (95.0 * math.exp(-15 * bt) + 48.0) * bt) * math.exp(-14 * bt) if bt < 0.25 else 0.0
        samples.append(max(-0.9, min(0.9, pad + kick)))
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *[int(x * 32767) for x in samples]))

    import shutil, os
    cands = []
    if shutil.which("ffmpeg"):
        cands.append(shutil.which("ffmpeg"))
    capcut = Path(os.environ.get("LOCALAPPDATA", "")) / "CapCut" / "Apps"
    if capcut.exists():
        cands.extend(str(p) for p in sorted(capcut.glob("*/ffmpeg.exe"), reverse=True))
    muxed = False
    for ff in cands:
        try:
            r = subprocess.run([ff, "-y", "-i", str(silent_mp4), "-i", str(wav_path), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out_mp4)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if r.returncode == 0 and out_mp4.exists():
                muxed = True
                break
        except Exception:
            pass
    if not muxed:
        shutil.copyfile(silent_mp4, out_mp4)
`;
  execFileSync("python", ["-c", py], { stdio: "pipe" });
}

function startEvalScriptedLlm() {
  let subagentCalls = 0;
  let sawPolishGate = false;
  let previewCalls = 0;
  let coordCalls = 0;
  let sawContactSheetNote = false;
  let sawShowreelAudioResult = false;
  let badModeErroredCleanly = false;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-eval-v", object: "model" }] }));
        return;
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const msgs = payload.messages || [];
      const sysText = String(msgs[0]?.content || "");
      const isSubagent = sysText.includes("Motion Designer Subagent");
      const allText = JSON.stringify(msgs);

      const respond = (msgObj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: `cmpl-${Date.now()}`,
          object: "chat.completion",
          choices: [{ index: 0, finish_reason: msgObj.tool_calls ? "tool_calls" : "stop", message: msgObj }],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        }));
      };

      if (isSubagent) {
        subagentCalls += 1;
        if (allText.includes("contact_sheet_")) sawContactSheetNote = true;
        if (allText.includes("EVALUATION & DIFF HEATMAP POLISH PASS")) sawPolishGate = true;

        if (subagentCalls === 1) {
          // Step 1: animated coarse drafts (pass 0.65, below 0.85 -> triggers mandatory polish gate)
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "s_w1",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene1.js",
                    content: `(function(){var AM=window.AM;AM.registerScene("scene1_hook",function(ctx,t,dur){var r=40+14*Math.min(1,t/1.0);ctx.fillStyle="#0E0E0E";ctx.fillRect(0,0,640,360);ctx.fillStyle="#6B46D8";ctx.beginPath();ctx.arc(320,180,r,0,Math.PI*2);ctx.fill();ctx.fillStyle="#E8E4EC";ctx.font="400 36px Inter,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("SHOW",320,182);});})();\n`,
                  }),
                },
              },
              {
                id: "s_w2",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene2.js",
                    content: `(function(){var AM=window.AM;AM.registerScene("scene2_problem_or_context",function(ctx,t,dur){var dx=32*Math.min(1,t/1.0);ctx.fillStyle="#0E0E0E";ctx.fillRect(0,0,640,360);ctx.fillStyle="#EAEFF2";ctx.fillRect(198,98,244,164);ctx.fillStyle="#D8AA56";ctx.fillRect(224+dx,158,96,42);});})();\n`,
                  }),
                },
              },
              {
                id: "s_w3_init",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene3.js",
                    content: `(function(){var AM=window.AM;AM.registerScene("scene3_proof_or_demo",function(ctx,t,dur){var dy=14*Math.min(1,t/1.0);ctx.fillStyle="#151B2E";ctx.fillRect(0,0,640,360);ctx.fillStyle="#2FA4DC";ctx.fillRect(175,110+dy,290,126);ctx.fillStyle="#14161C";ctx.font="700 32px Inter,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("PRO",320,174+dy);});})();\n`,
                  }),
                },
              },
            ],
          });
        }

        if (subagentCalls === 2) {
          previewCalls += 1;
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "s_p1",
              type: "function",
              function: {
                name: "capture_film_preview",
                arguments: JSON.stringify({ compareToReference: true, passThreshold: 0.65 }),
              },
            }],
          });
        }

        if (subagentCalls === 3) {
          // Intentionally try to stop early after 1st capture — the engine's EVALUATION & DIFF HEATMAP POLISH gate MUST block early exit!
          return respond({
            role: "assistant",
            content: "Initial scenes drafted and preview captured once, finishing now.",
          });
        }

        if (subagentCalls === 4) {
          // Blocked by evaluation gate -> now fix weak shapes/text and verify again!
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "s_w3",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene1.js",
                    content: `(function(){var AM=window.AM;AM.registerScene("scene1_hook",function(ctx,t,dur){var r=48+20*Math.min(1,t/1.0);ctx.fillStyle="#0E0E0E";ctx.fillRect(0,0,640,360);ctx.fillStyle="#7D56EF";ctx.beginPath();ctx.arc(320,180,r,0,Math.PI*2);ctx.fill();ctx.fillStyle="#FAF5F5";ctx.font="400 44px Inter,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("SHOW",320,182);});})();\n`,
                  }),
                },
              },
              {
                id: "s_w4",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene2.js",
                    content: `(function(){var AM=window.AM;AM.registerScene("scene2_problem_or_context",function(ctx,t,dur){var dx=40*Math.min(1,t/1.0);ctx.fillStyle="#0E0E0E";ctx.fillRect(0,0,640,360);ctx.fillStyle="#EEF2F4";ctx.fillRect(190,90,260,180);ctx.fillStyle="#E1AF5A";ctx.fillRect(220+dx,155,120,50);AM.drawCursor(ctx,340+dx,210,{scale:0.9});});})();\n`,
                  }),
                },
              },
              {
                id: "s_w5",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: "script/scene3.js",
                    content: `(function(){var AM=window.AM;AM.registerScene("scene3_proof_or_demo",function(ctx,t,dur){var dy=16*Math.min(1,t/1.0);ctx.fillStyle="#151B2E";ctx.fillRect(0,0,640,360);ctx.fillStyle="#38BDF8";ctx.fillRect(160,100+dy,320,145);ctx.fillStyle="#14161C";ctx.font="700 38px Inter,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("PRO",320,174+dy);});})();\n`,
                  }),
                },
              },
            ],
          });
        }

        if (subagentCalls === 5) {
          previewCalls += 1;
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "s_p2",
              type: "function",
              function: {
                name: "capture_film_preview",
                arguments: JSON.stringify({ compareToReference: true, passThreshold: 0.65 }),
              },
            }],
          });
        }

        return respond({ role: "assistant", content: "Refined weak scenes and verified second capture cleanly." });
      }

      // Coordinator turns
      coordCalls += 1;
      if (coordCalls === 1) {
        // First extract reference + negative check on film_audio narrated w/ empty narration
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "c_ext",
              type: "function",
              function: { name: "extract_video_reference", arguments: JSON.stringify({ videoPath: "ref/ref_showreel.mp4" }) },
            },
            {
              id: "c_aud_bad",
              type: "function",
              function: {
                name: "film_audio",
                arguments: JSON.stringify({ mode: "narrated", scenes: [{ id: "scene1_hook", narration: "" }] }),
              },
            },
          ],
        });
      }

      if (coordCalls === 2) {
        if (allText.includes("requires non-empty 'narration' text")) badModeErroredCleanly = true;
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
                  title: "Showreel Eval E2E",
                  width: 640,
                  height: 360,
                  fps: 30,
                  background: "#0E0E0E",
                  scenes: [
                    { id: "scene1_hook", duration: 2.0, accent: "#7D56EF" },
                    { id: "scene2_problem_or_context", duration: 2.0, accent: "#E1AF5A" },
                    { id: "scene3_proof_or_demo", duration: 2.0, accent: "#38BDF8" },
                  ],
                }),
              },
            },
            {
              id: "c_aud_ok",
              type: "function",
              function: {
                name: "film_audio",
                arguments: JSON.stringify({
                  mode: "showreel",
                  bpm: 120,
                  scenes: [
                    { id: "scene1_hook", narration: "", duration: 2.0 },
                    { id: "scene2_problem_or_context", narration: "", duration: 2.0 },
                    { id: "scene3_proof_or_demo", narration: "", duration: 2.0 },
                  ],
                }),
              },
            },
          ],
        });
      }

      if (coordCalls === 3) {
        if (allText.includes("totalDuration=6.000s") && allText.includes("Synthesized audio")) {
          sawShowreelAudioResult = true;
        }
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "c_sub",
            type: "function",
            function: {
              name: "task",
              arguments: JSON.stringify({
                subagent_type: "motion-designer",
                background: false,
                description: "Build and evaluate showreel scenes",
                prompt: "Write script/scene1.js, script/scene2.js, and script/scene3.js matching ref/extracted, evaluate comparison_strip.jpg, and polish weak scenes.",
              }),
            },
          }],
        });
      }

      return respond({ role: "assistant", content: "Showreel build, evaluation polish, and verification complete." });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        getStats: () => ({
          coordCalls,
          subagentCalls,
          previewCalls,
          sawPolishGate,
          sawContactSheetNote,
          sawShowreelAudioResult,
          badModeErroredCleanly,
        }),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function main() {
  const mockLlm = await startEvalScriptedLlm();
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-e2e": {
            name: "Mock E2E Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-mock" },
            models: { "mock-eval-v": { name: "Mock Eval Vision", vision: true } },
          },
        },
      },
    });

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-e2e", modelID: "mock-eval-v", id: "mock-eval-v" };

    buildSyntheticReferenceVideo(path.join(wsDir, "ref", "ref_showreel.mp4"));

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Showreel Eval Loop E2E", model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    if (!sessId) throw new Error(`Missing session id: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: { text: "Ikuti referensi video ref/ref_showreel.mp4 lalu evaluasi perbandingan sebelum berhenti." },
      },
    });
    if (!postRes.ok) throw new Error(`Prompt failed: ${postRes.text}`);

    const deadline = Date.now() + 90_000;
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

    const findActiveProjectDir = (root) => {
      const projsDir = path.join(root, "projects");
      if (fs.existsSync(projsDir)) {
        for (const ent of fs.readdirSync(projsDir, { withFileTypes: true })) {
          if (ent.isDirectory() && fs.existsSync(path.join(projsDir, ent.name, "film.json"))) {
            return path.join(projsDir, ent.name);
          }
        }
      }
      return root;
    };
    const projDir = findActiveProjectDir(wsDir);
    const stats = mockLlm.getStats();
    const cs1 = path.join(wsDir, "ref", "extracted", "contact_sheet_1.jpg");
    const strip = path.join(projDir, ".aetheria", "preview", "comparison_strip.jpg");
    const filmJsonPath = path.join(projDir, "film.json");
    const filmManifest = fs.existsSync(filmJsonPath) ? JSON.parse(fs.readFileSync(filmJsonPath, "utf8")) : null;

    const summary = {
      ...stats,
      projDir: path.relative(wsDir, projDir).replace(/\\/g, "/"),
      contactSheetExists: fs.existsSync(cs1),
      comparisonStripExists: fs.existsSync(strip),
      showreelBgmExists: fs.existsSync(path.join(projDir, "audio", "bgm_scene1_hook.wav")),
      showreelSfxExists: fs.existsSync(path.join(projDir, "audio", "sfx_scene1_hook.wav")),
      noWordsSubtitleFiles: !fs.existsSync(path.join(projDir, "audio", "scene1_hook.words.json")),
      filmScenesCount: filmManifest?.scenes?.length || 0,
    };
    console.log("[SHOWREEL_EVAL_E2E]", JSON.stringify(summary, null, 2));

    if (
      !summary.badModeErroredCleanly ||
      !summary.sawShowreelAudioResult ||
      !summary.sawContactSheetNote ||
      !summary.sawPolishGate ||
      summary.previewCalls < 2 ||
      !summary.contactSheetExists ||
      !summary.comparisonStripExists ||
      !summary.showreelBgmExists ||
      !summary.showreelSfxExists ||
      !summary.noWordsSubtitleFiles ||
      summary.filmScenesCount !== 3
    ) {
      process.exitCode = 1;
    }
  } finally {
    await stack?.stop();
    await mockLlm.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[SHOWREEL_EVAL_E2E_ERROR]", err);
  process.exit(1);
});
