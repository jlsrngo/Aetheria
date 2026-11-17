import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function generateSyntheticReferenceMp4(outPath: string) {
  const pyCode = [
    "import sys, cv2, numpy as np",
    "out_path = sys.argv[1]",
    "w, h, fps = 540, 960, 30",
    "vw = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))",
    "for f in range(120):",
    "    t = f / fps",
    "    if t < 2.0:",
    "        img = np.full((h, w, 3), (26, 20, 20), dtype=np.uint8)",
    "        cv2.rectangle(img, (90, 280), (450, 560), (40, 140, 250), -1)",
    "        cv2.putText(img, 'HOOK', (160, 440), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (245, 245, 250), 4)",
    "    else:",
    "        img = np.full((h, w, 3), (223, 230, 234), dtype=np.uint8)",
    "        cv2.rectangle(img, (70, 260), (470, 620), (40, 40, 180), -1)",
    "        cv2.putText(img, 'PAYOFF', (120, 460), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (255, 255, 255), 4)",
    "    vw.write(img)",
    "vw.release()",
  ].join("\n");
  execFileSync("python", ["-c", pyCode, outPath], { windowsHide: true });
}

function writeFilmProject(
  dir: string,
  opts: { bg1: string; card1: string; bg2: string; card2: string },
) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "script", "scene1.js"),
    `(function(){
  var AM = window.AM;
  AM.registerScene("scene1_hook", function(ctx, localTime, dur, scene, AM) {
    var pose = AM.evalKeyframes([
      { t: 0, x: 90, y: 280, w: 360, h: 280, opacity: 1, reveal: 1 },
      { t: 2, x: 90, y: 280, w: 360, h: 280, opacity: 1, reveal: 1 }
    ], localTime, "linear");
    ctx.fillStyle = ${JSON.stringify(opts.bg1)};
    ctx.fillRect(0, 0, 540, 960);
    ctx.fillStyle = ${JSON.stringify(opts.card1)};
    ctx.fillRect(pose.x, pose.y, pose.w, pose.h);
    ctx.fillStyle = "#F5F5FA";
    ctx.font = "bold 56px sans-serif";
    ctx.fillText(AM.textReveal("HOOK", pose.reveal), 160, 440);
  });
})();\n`,
  );
  fs.writeFileSync(
    path.join(dir, "script", "scene2.js"),
    `(function(){
  var AM = window.AM;
  AM.registerScene("scene2_payoff", function(ctx, localTime, dur, scene, AM) {
    ctx.fillStyle = ${JSON.stringify(opts.bg2)};
    ctx.fillRect(0, 0, 540, 960);
    ctx.fillStyle = ${JSON.stringify(opts.card2)};
    ctx.fillRect(70, 260, 400, 360);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("PAYOFF", 120, 460);
  });
})();\n`,
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>MotionClone E2E</title></head>
<body style="margin:0;overflow:hidden;background:#000;">
<canvas id="stage" width="540" height="960"></canvas>
<script src="/script/aetheria-motion.js"></script>
<script src="/script/scene1.js"></script>
<script src="/script/scene2.js"></script>
<script>
var SCENES = [
  { id: "scene1_hook", start: 0, duration: 2 },
  { id: "scene2_payoff", start: 2, duration: 2 }
];
window.__filmMeta = { title: "MotionClone E2E", width: 540, height: 960, fps: 30, duration: 4, scenes: SCENES };
var canvas = document.getElementById("stage");
var ctx = canvas.getContext("2d");
window.renderAt = function(t) {
  var resolved = AM.resolveScene(t, SCENES);
  var fn = AM.getSceneRenderer(resolved.scene.id, resolved.index);
  if (fn) fn(ctx, resolved.localTime, resolved.scene.duration, resolved.scene, AM);
};
window.__ready = true;
window.renderAt(0);
</script>
</body>
</html>`,
  );
}

test.describe("MotionClone Reference Extraction & Closed-Loop Comparison E2E", () => {
  let stack: LiveStack | null = null;
  let tmpVideoDir: string | null = null;

  test.beforeEach(() => {
    test.setTimeout(180_000);
  });

  test.afterEach(async () => {
    await stack?.stop();
    stack = null;
    if (tmpVideoDir) {
      fs.rmSync(tmpVideoDir, { recursive: true, force: true });
      tmpVideoDir = null;
    }
  });

  test("extracts multi-scene reference via UI + rejects path escape cleanly", async ({ page }) => {
    stack = await startLiveStack();
    tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-vid-"));
    const sampleMp4 = path.join(tmpVideoDir, "sample_ref.mp4");
    generateSyntheticReferenceMp4(sampleMp4);

    const appErrors: string[] = [];
    page.on("pageerror", (err) => appErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("fonts.googleapis.com")) {
        appErrors.push(msg.text());
      }
    });

    await page.addInitScript(
      ({ workspaceDir }: { workspaceDir: string }) => {
        if (!sessionStorage.getItem("__mc_e2e_init")) {
          localStorage.setItem("aetheria_active_folder", workspaceDir);
          localStorage.setItem("aetheria_active_provider", "e2e-mock");
          localStorage.setItem("aetheria_active_model", "e2e-fast");
          sessionStorage.setItem("__mc_e2e_init", "1");
        }
      },
      { workspaceDir: stack.workspaceDir },
    );

    await page.goto(`/?folder=${encodeURIComponent(stack.workspaceDir)}`);
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 20_000 });

    // Open Preset Studio via /add preset slash command
    await textarea.fill("/add preset");
    await textarea.press("Enter");

    const videoCard = page.getByRole("button", { name: /Video Template & Referensi/i });
    await expect(videoCard).toBeVisible({ timeout: 10_000 });
    await videoCard.click();

    // Upload synthetic MP4 and trigger real extraction
    const fileInput = page.locator('input[type="file"][accept*="video/mp4"]');
    await fileInput.setInputFiles(sampleMp4);

    const extractBtn = page.getByRole("button", { name: /Ekstrak Keyframe & Palet/i });
    await expect(extractBtn).toBeVisible({ timeout: 10_000 });
    await extractBtn.click();

    await expect(page.getByText(/Blueprint terekstrak ke/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2 scene/i)).toBeVisible({ timeout: 10_000 });

    // Verify extracted files on disk
    const extractedDir = path.join(stack.workspaceDir, "ref", "extracted");
    const temporal = JSON.parse(fs.readFileSync(path.join(extractedDir, "temporal.json"), "utf8"));
    const styleSpec = JSON.parse(fs.readFileSync(path.join(extractedDir, "style.json"), "utf8"));
    const reportMd = fs.readFileSync(path.join(extractedDir, "ref_report.md"), "utf8");

    expect(temporal.cutTimestamps.length).toBe(2);
    expect(temporal.cutTimestamps[1]).toBeGreaterThanOrEqual(1.8);
    expect(temporal.cutTimestamps[1]).toBeLessThanOrEqual(2.2);

    expect(styleSpec.scenes.length).toBe(2);
    expect(styleSpec.scenes[0].layout.is_dark_scene).toBe(true);
    expect(styleSpec.scenes[1].layout.is_dark_scene).toBe(false);
    expect(styleSpec.palette.accent.toLowerCase()).not.toBe("#10b981");

    expect(reportMd).toContain("window.AM.registerScene");
    expect(reportMd).toContain("compareToReference: true");
    expect(reportMd).not.toContain("<Sequence");

    // Verify error path: path escape rejected cleanly without crashing engine
    const badRes = await fetch(
      `${stack.engineUrl}/api/studio/video-reference/extract?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: stack.authHeader,
        },
        body: JSON.stringify({ videoPath: "../../secret.mp4" }),
      },
    );
    const badJson = await badRes.json();
    expect(badJson.success).toBe(false);
    expect(String(badJson.error)).toContain("outside active project folder");

    const health = await fetch(`${stack.engineUrl}/api/health`, {
      headers: { Authorization: stack.authHeader },
    }).then((r) => r.json());
    expect(health.healthy).toBe(true);
    expect(appErrors).toEqual([]);
  });

  test("runs closed-loop capture_film_preview comparison: fails mismatched film, refines, and passes", async () => {
    tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-loop-"));
    const sampleMp4 = path.join(tmpVideoDir, "sample_ref.mp4");
    generateSyntheticReferenceMp4(sampleMp4);

    const observations: {
      sawReferenceBlueprint: boolean;
      turnsSeen: number;
      rawToolMessages: string[];
      toolResults: Array<{
        ok: boolean;
        error: string | null;
        fidelityFailed: boolean;
        comparisonOk: boolean;
        passed: boolean;
        comparedCount: number;
        attempt: number;
        targetWorstCount: number;
        ssimMean: number;
        colorMatchMean: number;
        edgeMatchMean: number;
        overallFidelity: number;
        runtimeErrors: string[];
      }>;
    } = {
      sawReferenceBlueprint: false,
      turnsSeen: 0,
      rawToolMessages: [],
      toolResults: [],
    };

    let turnIndex = 0;
    const scriptedLlm = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ id: "e2e-clone", object: "model" }] }));
          return;
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const msgs = Array.isArray(payload.messages) ? payload.messages : [];
        const sysText = String(msgs[0]?.content ?? "");
        const scene1Match = `(function(){
  var AM = window.AM;
  AM.registerScene("scene1_hook", function(ctx, localTime, dur, scene, AM) {
    var pose = AM.evalKeyframes([
      { t: 0, x: 90, y: 280, w: 360, h: 280, opacity: 1, reveal: 1 },
      { t: 2, x: 90, y: 280, w: 360, h: 280, opacity: 1, reveal: 1 }
    ], localTime, "linear");
    ctx.fillStyle = "#14141A";
    ctx.fillRect(0, 0, 540, 960);
    ctx.fillStyle = "#FA8C28";
    ctx.fillRect(pose.x, pose.y, pose.w, pose.h);
    ctx.fillStyle = "#F5F5FA";
    ctx.font = "bold 56px sans-serif";
    ctx.fillText(AM.textReveal("HOOK", pose.reveal), 160, 440);
  });
})();\n`;
        const scene2Match = `(function(){
  var AM = window.AM;
  AM.registerScene("scene2_payoff", function(ctx, localTime, dur, scene, AM) {
    ctx.fillStyle = "#EAE6DF";
    ctx.fillRect(0, 0, 540, 960);
    ctx.fillStyle = "#B42828";
    ctx.fillRect(70, 260, 400, 360);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("PAYOFF", 120, 460);
  });
})();\n`;

        res.writeHead(200, { "Content-Type": "application/json" });
        if (sysText.includes("Motion Designer Subagent")) {
          const hasWrote = msgs.some((m) => m.role === "tool" && m.name === "write");
          const hasPreviewed = msgs.some(
            (m) => m.role === "tool" && m.name === "capture_film_preview",
          );
          if (!hasWrote) {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: "",
                      tool_calls: [
                        {
                          id: "call_write_s1",
                          type: "function",
                          function: {
                            name: "write",
                            arguments: JSON.stringify({
                              filePath: "script/scene1.js",
                              content: scene1Match,
                            }),
                          },
                        },
                        {
                          id: "call_write_s2",
                          type: "function",
                          function: {
                            name: "write",
                            arguments: JSON.stringify({
                              filePath: "script/scene2.js",
                              content: scene2Match,
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            );
            return;
          }
          if (!hasPreviewed) {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: "",
                      tool_calls: [
                        {
                          id: "call_sub_preview",
                          type: "function",
                          function: {
                            name: "capture_film_preview",
                            arguments: JSON.stringify({ compareToReference: true }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            );
            return;
          }
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { role: "assistant", content: "Refined scene1.js and scene2.js." },
                },
              ],
            }),
          );
          return;
        }

        observations.turnsSeen += 1;
        const joined = JSON.stringify(msgs);
        if (joined.includes("Active Video Reference Blueprint")) {
          observations.sawReferenceBlueprint = true;
        }

        const lastToolMsg = [...msgs].reverse().find((m) => m.role === "tool");
        if (lastToolMsg && typeof lastToolMsg.content === "string") {
          observations.rawToolMessages.push(lastToolMsg.content.slice(0, 600));
          try {
            const parsed = JSON.parse(lastToolMsg.content);
            if (parsed.referenceComparison) {
              observations.toolResults.push({
                ok: Boolean(parsed.ok),
                error: parsed.error ? String(parsed.error) : null,
                fidelityFailed: Boolean(parsed.fidelityFailed),
                comparisonOk: Boolean(parsed.referenceComparison.ok),
                passed: Boolean(parsed.referenceComparison.passed),
                comparedCount: Number(parsed.referenceComparison.comparedCount ?? 0),
                attempt: Number(parsed.referenceComparison.attempt ?? 0),
                targetWorstCount: Array.isArray(parsed.referenceComparison.targetWorstScenes)
                  ? parsed.referenceComparison.targetWorstScenes.length
                  : 0,
                ssimMean: Number(parsed.referenceComparison.ssimMean ?? 0),
                colorMatchMean: Number(parsed.referenceComparison.colorMatchMean ?? 0),
                edgeMatchMean: Number(parsed.referenceComparison.edgeMatchMean ?? 0),
                overallFidelity: Number(parsed.referenceComparison.overallFidelity ?? 0),
                runtimeErrors: Array.isArray(parsed.runtimeErrors) ? parsed.runtimeErrors : [],
              });
            }
          } catch {
            // ignore non-preview tool outputs
          }
        }

        turnIndex += 1;

        if (turnIndex === 1) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_preview_1",
                        type: "function",
                        function: {
                          name: "capture_film_preview",
                          arguments: JSON.stringify({ compareToReference: true }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        if (turnIndex === 2) {
          // Director delegates script refinement to motion-designer child subagent
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_delegate_md",
                        type: "function",
                        function: {
                          name: "task",
                          arguments: JSON.stringify({
                            description: "Refine scenes to match ref",
                            prompt: "Rewrite script/scene1.js and script/scene2.js to match exact reference colors and geometry.",
                            subagent_type: "motion-designer",
                            background: false,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        if (turnIndex === 3) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_preview_2",
                        type: "function",
                        function: {
                          name: "capture_film_preview",
                          arguments: JSON.stringify({ compareToReference: true }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "Closed-loop reference verification passed.",
                },
              },
            ],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => scriptedLlm.listen(0, "127.0.0.1", () => resolve()));
    const llmAddr = scriptedLlm.address();
    if (!llmAddr || typeof llmAddr === "string") {
      throw new Error("Scripted LLM failed to bind port");
    }

    try {
      stack = await startLiveStack({
        startWeb: false,
        aetheriaConfig: {
          provider: {
            "e2e-clone": {
              name: "E2E Clone Provider",
              type: "openai",
              options: {
                baseURL: `http://127.0.0.1:${llmAddr.port}/v1`,
                apiKey: "e2e-clone-key",
              },
              models: {
                "e2e-clone": { name: "E2E Clone Model", vision: true },
              },
            },
          },
        },
      });

      // 1. Extract reference MP4 via engine HTTP endpoint
      const b64 = fs.readFileSync(sampleMp4).toString("base64");
      const extractRes = await fetch(
        `${stack.engineUrl}/api/studio/video-reference/extract?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            fileName: "sample_ref.mp4",
            videoBase64: `data:video/mp4;base64,${b64}`,
          }),
        },
      );
      const extractJson = await extractRes.json();
      expect(extractJson.success).toBe(true);

      // 2. Seed intentionally mismatched film
      writeFilmProject(stack.workspaceDir, {
        bg1: "#FF00AA",
        card1: "#00FFCC",
        bg2: "#220055",
        card2: "#FFFF00",
      });

      // 3. Create session & trigger prompt loop
      const sessRes = await fetch(
        `${stack.engineUrl}/api/session?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            title: "MotionClone Loop E2E",
            directory: stack.workspaceDir,
            model: { providerID: "e2e-clone", id: "e2e-clone" },
          }),
        },
      );
      expect(sessRes.ok).toBe(true);
      const sessJson = await sessRes.json();
      const sessionId = sessJson?.data?.id || sessJson?.id;
      expect(sessionId).toBeTruthy();

      const promptRes = await fetch(
        `${stack.engineUrl}/api/session/${encodeURIComponent(sessionId)}/prompt?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            prompt: { text: "Clone reference video and verify in loop" },
          }),
        },
      );
      expect(promptRes.ok).toBe(true);

      try {
        await expect
          .poll(() => observations.toolResults.length, { timeout: 60_000 })
          .toBe(2);
      } catch (err) {
        throw new Error(
          `Loop polling failed: ${err instanceof Error ? err.message : String(err)}\nturnsSeen=${observations.turnsSeen} sawBlueprint=${observations.sawReferenceBlueprint}\nrawToolMessages=${JSON.stringify(observations.rawToolMessages)}\nengineLogsTail:\n${stack.engineLogs().slice(-2500)}`,
        );
      }

      expect(observations.sawReferenceBlueprint).toBe(true);
      const [firstPass, secondPass] = observations.toolResults;
      expect(firstPass.ok).toBe(false);
      expect(firstPass.fidelityFailed).toBe(true);
      expect(firstPass.comparisonOk).toBe(true);
      expect(firstPass.passed).toBe(false);
      expect(firstPass.comparedCount).toBeGreaterThanOrEqual(4);
      expect(firstPass.targetWorstCount).toBeGreaterThan(0);
      expect(firstPass.ssimMean).toBeLessThan(0.65);

      expect(secondPass.ok, `secondPass failed: ${JSON.stringify(secondPass)}`).toBe(true);
      expect(secondPass.passed).toBe(true);
      expect(secondPass.attempt).toBeGreaterThanOrEqual(2);
      expect(secondPass.ssimMean).toBeGreaterThanOrEqual(0.75);
      expect(secondPass.colorMatchMean).toBeGreaterThanOrEqual(0.8);
      expect(secondPass.runtimeErrors).toEqual([]);

      const stripFile = path.join(stack.workspaceDir, ".aetheria", "preview", "comparison_strip.jpg");
      expect(fs.existsSync(stripFile)).toBe(true);
      expect(fs.statSync(stripFile).size).toBeGreaterThan(2000);
    } finally {
      scriptedLlm.closeAllConnections?.();
      await new Promise<void>((resolve) => scriptedLlm.close(() => resolve()));
    }
  });

  test("extracts real Pinterest link https://pin.it/6OqBZoR44 via UI & session prompt, runs comparison, and rejects invalid URL", async ({
    page,
  }) => {
    stack = await startLiveStack();
    const appErrors: string[] = [];
    page.on("pageerror", (err) => appErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("fonts.googleapis.com")) {
        appErrors.push(msg.text());
      }
    });

    await page.addInitScript(
      ({ workspaceDir }: { workspaceDir: string }) => {
        if (!sessionStorage.getItem("__mc_pin_e2e_init")) {
          localStorage.setItem("aetheria_active_folder", workspaceDir);
          localStorage.setItem("aetheria_active_provider", "e2e-mock");
          localStorage.setItem("aetheria_active_model", "e2e-fast");
          sessionStorage.setItem("__mc_pin_e2e_init", "1");
        }
      },
      { workspaceDir: stack.workspaceDir },
    );

    await page.goto(`/?folder=${encodeURIComponent(stack.workspaceDir)}`);
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 25_000 });

    await textarea.fill("/add preset");
    await textarea.press("Enter");

    const videoCard = page.getByRole("button", { name: /Video Template & Referensi/i });
    await expect(videoCard).toBeVisible({ timeout: 10_000 });
    await videoCard.click();

    const urlInput = page.locator('input[placeholder*="pin.it"]');
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
    await urlInput.fill("https://pin.it/6OqBZoR44");

    const extractBtn = page.getByRole("button", { name: /Ekstrak Keyframe & Palet/i });
    await expect(extractBtn).toBeVisible({ timeout: 10_000 });
    await extractBtn.click();

    await expect(page.getByText(/Blueprint terekstrak ke/i)).toBeVisible({ timeout: 90_000 });

    const mp4Path = path.join(stack.workspaceDir, "ref", "ref_pinterest.mp4");
    expect(fs.existsSync(mp4Path)).toBe(true);
    expect(fs.statSync(mp4Path).size).toBeGreaterThan(500_000);

    const extractedDir = path.join(stack.workspaceDir, "ref", "extracted");
    const temporal = JSON.parse(fs.readFileSync(path.join(extractedDir, "temporal.json"), "utf8"));
    const styleSpec = JSON.parse(fs.readFileSync(path.join(extractedDir, "style.json"), "utf8"));
    const reportMd = fs.readFileSync(path.join(extractedDir, "ref_report.md"), "utf8");
    const frameFiles = fs
      .readdirSync(path.join(extractedDir, "frames"))
      .filter((f) => f.endsWith(".jpg"));

    expect(temporal.duration).toBeGreaterThan(20);
    expect(styleSpec.totalDuration).toBeGreaterThan(20);
    expect(temporal.cutTimestamps.length).toBeGreaterThanOrEqual(2);
    expect(styleSpec.width).toBe(720);
    expect(styleSpec.height).toBe(1280);
    expect(styleSpec.aspectRatio).toBe("9:16");
    expect(styleSpec.scenes.length).toBeGreaterThanOrEqual(2);
    expect(reportMd).toContain("window.AM.registerScene");
    expect(frameFiles.length).toBeGreaterThanOrEqual(2);

    // Error path: unsupported reference URL must return clean failure without crashing engine
    const badUrlRes = await fetch(
      `${stack.engineUrl}/api/studio/video-reference/extract?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: stack.authHeader,
        },
        body: JSON.stringify({ referenceUrl: "https://example.com/not-a-supported-video" }),
      },
    );
    const badUrlJson = await badUrlRes.json();
    expect(badUrlJson.success).toBe(false);
    expect(String(badUrlJson.error || "").length).toBeGreaterThan(5);

    const health = await fetch(`${stack.engineUrl}/api/health`, {
      headers: { Authorization: stack.authHeader },
    }).then((r) => r.json());
    expect(health.healthy).toBe(true);
    expect(appErrors).toEqual([]);

    // Close UI page before stopping Vite so HMR does not log ERR_CONNECTION_REFUSED in Phase 2
    await page.close();
    await stack.stop();
    stack = null;

    const pinObs = {
      sawPinterestNote: false,
      sawBlueprint: false,
      sawVisionImage: false,
      turnsSeen: 0,
      comparison: null as null | {
        ok: boolean;
        comparisonOk: boolean;
        ssimMean: number;
        colorMatchMean: number;
        edgeMatchMean: number;
        overallFidelity: number;
        runtimeErrors: string[];
      },
    };
    let llmTurn = 0;
    const pinLlm = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ id: "e2e-clone", object: "model" }] }));
          return;
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        pinObs.turnsSeen += 1;
        const msgs = Array.isArray(payload.messages) ? payload.messages : [];
        const joined = JSON.stringify(msgs);
        if (joined.includes("Pinterest Reference Visual Extracted")) pinObs.sawPinterestNote = true;
        if (joined.includes("Active Video Reference Blueprint")) pinObs.sawBlueprint = true;
        if (joined.includes("data:image/jpeg;base64,")) pinObs.sawVisionImage = true;

        const lastToolMsg = [...msgs].reverse().find((m) => m.role === "tool");
        if (lastToolMsg && typeof lastToolMsg.content === "string") {
          try {
            const parsed = JSON.parse(lastToolMsg.content);
            if (parsed.referenceComparison) {
              pinObs.comparison = {
                ok: Boolean(parsed.ok),
                comparisonOk: Boolean(parsed.referenceComparison.ok),
                ssimMean: Number(parsed.referenceComparison.ssimMean ?? 0),
                colorMatchMean: Number(parsed.referenceComparison.colorMatchMean ?? 0),
                edgeMatchMean: Number(parsed.referenceComparison.edgeMatchMean ?? 0),
                overallFidelity: Number(parsed.referenceComparison.overallFidelity ?? 0),
                runtimeErrors: Array.isArray(parsed.runtimeErrors) ? parsed.runtimeErrors : [],
              };
            }
          } catch {
            // ignore non-JSON tool messages
          }
        }

        llmTurn += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        if (llmTurn === 1) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_pin_preview",
                        type: "function",
                        function: {
                          name: "capture_film_preview",
                          arguments: JSON.stringify({ compareToReference: true }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "Pinterest pin.it/6OqBZoR44 extraction and comparison complete.",
                },
              },
            ],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => pinLlm.listen(0, "127.0.0.1", () => resolve()));
    const pinLlmAddr = pinLlm.address();
    if (!pinLlmAddr || typeof pinLlmAddr === "string") {
      throw new Error("Pin scripted LLM failed to bind port");
    }

    try {
      stack = await startLiveStack({
        startWeb: false,
        aetheriaConfig: {
          provider: {
            "e2e-clone": {
              name: "E2E Clone Provider",
              type: "openai",
              options: {
                baseURL: `http://127.0.0.1:${pinLlmAddr.port}/v1`,
                apiKey: "e2e-clone-key",
              },
              models: {
                "e2e-clone": { name: "E2E Clone Model", vision: true },
              },
            },
          },
        },
      });

      // Seed a 720x1280 dark 23.7s HTML motion film so capture_film_preview renders distinct keyframes
      fs.mkdirSync(path.join(stack.workspaceDir, "script"), { recursive: true });
      fs.writeFileSync(
        path.join(stack.workspaceDir, "index.html"),
        `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pin Clone</title></head>
<body style="margin:0;overflow:hidden;background:#010101;">
<canvas id="stage" width="720" height="1280"></canvas>
<script src="/script/aetheria-motion.js"></script>
<script>
window.__filmMeta = { title: "Pin Clone", width: 720, height: 1280, fps: 30, duration: 23.7, scenes: [{ id: "main", start: 0, duration: 23.7 }] };
var ctx = document.getElementById("stage").getContext("2d");
window.renderAt = function(t) {
  ctx.fillStyle = "#010101";
  ctx.fillRect(0, 0, 720, 1280);
  ctx.fillStyle = "#07091F";
  ctx.fillRect(80, 320 + Math.sin(t) * 20, 560, 420);
  ctx.fillStyle = "#D0CBCA";
  ctx.font = "600 42px Inter, sans-serif";
  ctx.fillText("isn't about (" + t.toFixed(1) + "s)", 160, 580);
};
window.__ready = true;
window.renderAt(0);
</script>
</body></html>`,
      );

      const sessRes = await fetch(
        `${stack.engineUrl}/api/session?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            title: "Pin Real Link E2E",
            directory: stack.workspaceDir,
            model: { providerID: "e2e-clone", id: "e2e-clone" },
          }),
        },
      );
      expect(sessRes.ok).toBe(true);
      const sessJson = await sessRes.json();
      const sessionId = sessJson?.data?.id || sessJson?.id;
      expect(sessionId).toBeTruthy();

      const promptRes = await fetch(
        `${stack.engineUrl}/api/session/${encodeURIComponent(sessionId)}/prompt?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            prompt: { text: "Tolong clone video dari referensi https://pin.it/6OqBZoR44" },
          }),
        },
      );
      expect(promptRes.ok).toBe(true);

      await expect.poll(() => pinObs.comparison !== null, { timeout: 120_000 }).toBe(true);
      expect(pinObs.sawPinterestNote).toBe(true);
      expect(pinObs.sawBlueprint).toBe(true);
      expect(pinObs.sawVisionImage).toBe(true);
      expect(pinObs.comparison?.comparisonOk).toBe(true);
      expect(pinObs.comparison?.runtimeErrors).toEqual([]);
      expect(pinObs.comparison?.ssimMean).toBeGreaterThan(0);

      expect(fs.existsSync(path.join(stack.workspaceDir, "ref", "ref_pinterest.mp4"))).toBe(true);
      expect(fs.existsSync(path.join(stack.workspaceDir, "ref", "extracted", "style.json"))).toBe(
        true,
      );
      const stripFile = path.join(
        stack.workspaceDir,
        ".aetheria",
        "preview",
        "comparison_strip.jpg",
      );
      expect(fs.existsSync(stripFile)).toBe(true);
      expect(fs.statSync(stripFile).size).toBeGreaterThan(2000);
    } finally {
      pinLlm.closeAllConnections?.();
      await new Promise<void>((resolve) => pinLlm.close(() => resolve()));
    }
  });

  test("local MP4 attachment extracts turn-1 blueprint, attaches child vision frames, rejects aspect ratio mismatch & anti-cheat replay", async () => {
    tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-local-att-"));
    const sampleMp4 = path.join(tmpVideoDir, "local_ref.mp4");
    generateSyntheticReferenceMp4(sampleMp4);

    const obs = {
      coordinatorSawBlueprint: false,
      coordinatorImageCount: 0,
      childSawMotionDesigner: false,
      childSawBlueprint: false,
      childImageCount: 0,
      aspectMismatchPreview: null as null | {
        ok: boolean;
        fidelityFailed: boolean;
        aspectRatioMismatch: boolean;
        passed: boolean;
        antiCheatPassed: boolean;
        violations: string[];
      },
      done: false,
    };

    let coordTurn = 0;
    const mockLlm = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ id: "e2e-clone", object: "model" }] }));
          return;
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const msgs = Array.isArray(payload.messages) ? payload.messages : [];
        const sysText = String(msgs[0]?.content ?? "");

        res.writeHead(200, { "Content-Type": "application/json" });
        if (sysText.includes("Motion Designer Subagent")) {
          obs.childSawMotionDesigner = true;
          const childJoined = JSON.stringify(msgs);
          if (childJoined.includes("Active Video Reference Blueprint")) {
            obs.childSawBlueprint = true;
          }
          const userContent = msgs[1]?.content;
          if (Array.isArray(userContent)) {
            obs.childImageCount = userContent.filter((p) => p?.type === "image_url").length;
          }
          const hasPreview = msgs.some(
            (m) => m.role === "tool" && m.name === "capture_film_preview",
          );
          if (!hasPreview) {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: "",
                      tool_calls: [
                        {
                          id: "call_child_preview",
                          type: "function",
                          function: {
                            name: "capture_film_preview",
                            arguments: JSON.stringify({ compareToReference: true }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            );
            return;
          }
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { role: "assistant", content: "Child inspection complete." },
                },
              ],
            }),
          );
          return;
        }

        const coordJoined = JSON.stringify(msgs);
        if (coordJoined.includes("Active Video Reference Blueprint")) {
          obs.coordinatorSawBlueprint = true;
        }
        const firstUser = msgs.find((m) => m.role === "user");
        if (Array.isArray(firstUser?.content)) {
          obs.coordinatorImageCount = firstUser.content.filter(
            (p: { type?: string }) => p?.type === "image_url",
          ).length;
        }

        const previewToolMsg = [...msgs]
          .reverse()
          .find((m) => m.role === "tool" && m.name === "capture_film_preview");
        if (previewToolMsg && typeof previewToolMsg.content === "string") {
          try {
            const parsed = JSON.parse(previewToolMsg.content);
            if (parsed.referenceComparison) {
              obs.aspectMismatchPreview = {
                ok: Boolean(parsed.ok),
                fidelityFailed: Boolean(parsed.fidelityFailed),
                aspectRatioMismatch: Boolean(parsed.referenceComparison.aspectRatioMismatch),
                passed: Boolean(parsed.referenceComparison.passed),
                antiCheatPassed: Boolean(parsed.antiCheat?.passed),
                violations: Array.isArray(parsed.antiCheat?.violations)
                  ? parsed.antiCheat.violations
                  : [],
              };
            }
          } catch {
            // ignore
          }
        }

        coordTurn += 1;
        if (coordTurn === 1) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_spawn_md",
                        type: "function",
                        function: {
                          name: "task",
                          arguments: JSON.stringify({
                            description: "Build clone scenes",
                            prompt: "Inspect extracted reference and preview.",
                            subagent_type: "motion-designer",
                            background: false,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        if (coordTurn === 2) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_bad_preview",
                        type: "function",
                        function: {
                          name: "capture_film_preview",
                          arguments: JSON.stringify({ compareToReference: true }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }

        obs.done = true;
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "Verified turn-1 local extraction, child vision, aspect check, and anti-cheat.",
                },
              },
            ],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => mockLlm.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockLlm.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Mock LLM failed to bind port");
    }

    try {
      stack = await startLiveStack({
        startWeb: false,
        aetheriaConfig: {
          provider: {
            "e2e-clone": {
              name: "E2E Clone Provider",
              type: "openai",
              options: {
                baseURL: `http://127.0.0.1:${addr.port}/v1`,
                apiKey: "e2e-clone-key",
              },
              models: {
                "e2e-clone": { name: "E2E Clone Model", vision: true },
              },
            },
          },
        },
      });

      // Seed landscape 960x540 (mismatched vs 540x960 portrait ref) + forbidden <video src="ref/ref_local_ref.mp4">
      fs.mkdirSync(path.join(stack.workspaceDir, "script"), { recursive: true });
      fs.writeFileSync(
        path.join(stack.workspaceDir, "index.html"),
        `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bad Clone</title></head>
<body style="margin:0;overflow:hidden;background:#000;">
<video src="ref/ref_local_ref.mp4" style="display:none;"></video>
<canvas id="stage" width="960" height="540"></canvas>
<script>
window.__filmMeta = { title: "Bad Clone", width: 960, height: 540, fps: 30, duration: 4, scenes: [{ id: "s1", start: 0, duration: 4 }] };
var ctx = document.getElementById("stage").getContext("2d");
window.renderAt = function(t) {
  ctx.fillStyle = t < 2 ? "#111111" : "#222244";
  ctx.fillRect(0, 0, 960, 540);
};
window.__ready = true;
window.renderAt(0);
</script>
</body></html>`,
      );

      const sessRes = await fetch(
        `${stack.engineUrl}/api/session?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            title: "Local MP4 Attachment Fidelity E2E",
            directory: stack.workspaceDir,
            model: { providerID: "e2e-clone", id: "e2e-clone" },
          }),
        },
      );
      expect(sessRes.ok).toBe(true);
      const sessJson = await sessRes.json();
      const sessionId = sessJson?.data?.id || sessJson?.id;
      expect(sessionId).toBeTruthy();

      const mp4B64 = fs.readFileSync(sampleMp4).toString("base64");
      const promptRes = await fetch(
        `${stack.engineUrl}/api/session/${encodeURIComponent(sessionId)}/prompt?directory=${encodeURIComponent(stack.workspaceDir)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: stack.authHeader,
          },
          body: JSON.stringify({
            prompt: { text: "Clone video referensi terlampir secara akurat" },
            files: [
              {
                name: "local_ref.mp4",
                mime: "video/mp4",
                uri: `data:video/mp4;base64,${mp4B64}`,
              },
            ],
          }),
        },
      );
      expect(promptRes.ok).toBe(true);

      await expect.poll(() => obs.done, { timeout: 90_000 }).toBe(true);
      expect(obs.coordinatorSawBlueprint).toBe(true);
      expect(obs.coordinatorImageCount).toBeGreaterThanOrEqual(2);
      expect(obs.childSawMotionDesigner).toBe(true);
      expect(obs.childSawBlueprint).toBe(true);
      expect(obs.childImageCount).toBeGreaterThanOrEqual(2);

      expect(obs.aspectMismatchPreview).not.toBeNull();
      expect(obs.aspectMismatchPreview?.ok).toBe(false);
      expect(obs.aspectMismatchPreview?.fidelityFailed).toBe(true);
      expect(obs.aspectMismatchPreview?.aspectRatioMismatch).toBe(true);
      expect(obs.aspectMismatchPreview?.passed).toBe(false);
      expect(obs.aspectMismatchPreview?.antiCheatPassed).toBe(false);
      expect(obs.aspectMismatchPreview?.violations.join(" ")).toContain("ref/ref_");
      expect(obs.aspectMismatchPreview?.violations.join(" ")).toContain("<video>");

      expect(fs.existsSync(path.join(stack.workspaceDir, "ref", "extracted", "style.json"))).toBe(
        true,
      );
    } finally {
      mockLlm.closeAllConnections?.();
      await new Promise<void>((resolve) => mockLlm.close(() => resolve()));
    }
  });
});

