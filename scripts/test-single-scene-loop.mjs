#!/usr/bin/env node
/**
 * Fast Per-Scene Vision-First Loop Runner (`v13`)
 * Implements the Direct Per-Scene 2-Pass Loop & 6-Beat Comparison Strip workflow
 * from `docs/arsitektur-direct-per-scene-loop-dan-siklus-uji-cepat.md`:
 *   - Caches extracted reference video (`ref/extracted/style.json`, `ref_report.md`, `ref_scene_0K_beats.jpg`)
 *   - Supports `--scene <1..8|all>` (default: `1`), `--reextract`, `--clean`
 *   - Verifies through the live Rust engine (`aetheria-engine serve`):
 *     1. Hard-Facts + Beat Strip extraction (`inlineGlyphMorph`, `heroCardBox`, `blurredBackdrop`, `contrastTiles.grid.iconRule`, `beatStripTimestamps`)
 *     2. Scene-Scope Guard (`v13 #1a`: clamping `> 2` scenes to `<= 2` scenes and blocking out-of-scope `script/sceneM.js` writes)
 *     3. 2-Pass Direct Per-Scene Loop on the target scene(s) with 6-Beat Horizontal Comparison Strip (`scene_0K_compare_6beats.jpg`)
 *     4. Per-Scene Best Snapshot & Auto-Rollback (`v13 #1b`) when a refine pass degrades `overallMean`
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startLiveStack } from "../e2e/live-stack.mjs";

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = {
    scene: "1",
    reextract: false,
    clean: false,
    cacheDir: path.join(os.tmpdir(), "aetheria-single-scene-loop-cache"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene" && argv[i + 1]) {
      out.scene = String(argv[++i]).trim();
    } else if (a.startsWith("--scene=")) {
      out.scene = a.slice("--scene=".length).trim();
    } else if (a === "--reextract") {
      out.reextract = true;
    } else if (a === "--clean") {
      out.clean = true;
    } else if (a === "--cache-dir" && argv[i + 1]) {
      out.cacheDir = path.resolve(argv[++i]);
    }
  }
  return out;
}

async function api(baseUrl, route, { method = "GET", authHeader, body } = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

function ensureReferenceExtracted(cacheDir, forceReextract) {
  const refDir = path.join(cacheDir, "ref");
  const extDir = path.join(refDir, "extracted");
  const stylePath = path.join(extDir, "style.json");
  const mp4Path = path.join(refDir, "ref_tiktok.mp4");
  fs.mkdirSync(refDir, { recursive: true });

  const gtMp4 = path.join(
    ROOT,
    "benchmarks",
    "labs-showreel-ground-truth",
    "labs-showreel-remake.mp4"
  );
  if (!fs.existsSync(mp4Path) && fs.existsSync(gtMp4)) {
    fs.copyFileSync(gtMp4, mp4Path);
  }

  if (forceReextract || !fs.existsSync(stylePath)) {
    assert.ok(fs.existsSync(mp4Path), `Reference MP4 not found at ${mp4Path}`);
    const extractorPy = path.join(ROOT, "core", "ref_extractor", "ref_extractor.py");
    console.log(`[single-scene-loop] Running ref_extractor.py on ${mp4Path}...`);
    const t0 = Date.now();
    const r = spawnSync("python", [extractorPy, mp4Path, extDir], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 180000,
    });
    assert.equal(r.status, 0, `ref_extractor.py failed: ${r.stderr || r.stdout}`);
    console.log(
      `[single-scene-loop] Extracted reference in ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  }
  return JSON.parse(fs.readFileSync(stylePath, "utf8"));
}

function getScenePassScripts(sceneNum, sceneId, passNum) {
  if (sceneNum === 1) {
    if (passNum === 1) {
      // Pass 1 Draft: v12 defect (stacked icons above literal truncated "Showrea")
      return `(function () {
  var AM = window.AM;
  AM.registerScene("${sceneId}", function (ctx, t, dur) {
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, 1024, 576);
    var shift = Math.round((t / Math.max(0.1, dur)) * 40);
    var cols = ["#884BF9", "#3EF5B6", "#F0721F", "#365BBA"];
    for (var i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect(340 + shift + i * 76, 140, 44, 44);
    }
    ctx.fillStyle = "#F0EEF4";
    ctx.font = "600 84px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Showrea", 492 + shift, 330);
  });
})();\n`;
    }
    // Pass 2 Polish (v13): Single inline horizontal baseline y=288 with morphing colored vector glyphs -> "Showreel"
    return `(function () {
  var AM = window.AM;
  AM.registerScene("${sceneId}", function (ctx, t, dur) {
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, 1024, 576);
    if (t < 0.45) {
      var r = 24 + 72 * (t / 0.45);
      ctx.save();
      ctx.translate(512, 288);
      ctx.fillStyle = "#D4D2DC";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0C0B0E";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    var letters = ["S", "h", "o", "w", "r", "e", "e", "l"];
    var xs = [362, 404, 446, 494, 536, 572, 610, 640];
    var glyphCols = ["#365BBA", "#3EF5B6", "#F0721F", "#884BF9", "#EC4899", "#F59E0B"];
    var revealProgress = Math.min(1, Math.max(0, (t - 0.75) / 1.15));
    var revealedCount = Math.floor(2 + revealProgress * 6.5);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (var i = 0; i < letters.length; i++) {
      var lx = xs[i];
      var ly = 288;
      if (i < revealedCount || t >= 1.95) {
        var grad = ctx.createLinearGradient(lx - 20, ly - 38, lx + 20, ly + 38);
        grad.addColorStop(0, "#FFFFFF");
        grad.addColorStop(0.55, "#DCD9E4");
        grad.addColorStop(1, "#9A96A6");
        ctx.fillStyle = grad;
        ctx.font = "500 84px Inter, sans-serif";
        ctx.fillText(letters[i], lx, ly);
      } else {
        var gc = glyphCols[i % glyphCols.length];
        ctx.save();
        ctx.translate(lx, ly);
        ctx.fillStyle = gc;
        ctx.beginPath();
        ctx.roundRect(-16, -18, 32, 36, 9);
        ctx.fill();
        ctx.fillStyle = "#0C0B0E";
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    var curX = 355 + revealProgress * 300;
    AM.drawCursor(ctx, curX, 240, 0.9, "#F4F4F6", "#18181C");
  });
})();\n`;
  }

  if (sceneNum === 2) {
    if (passNum === 1) {
      // Pass 1 Draft: v12 defect (dark tiles left empty without vector icons!)
      return `(function () {
  var AM = window.AM;
  AM.registerScene("${sceneId}", function (ctx, t, dur) {
    var drift = (t / Math.max(0.1, dur)) * 18;
    ctx.fillStyle = "#0F1012";
    ctx.fillRect(0, 0, 1024, 576);
    ctx.save();
    ctx.translate(512, 288);
    ctx.rotate(-0.049);
    ctx.translate(-512 - drift, -288);
    var map = ["LDLDLDL", "DLDLDLD", "LDLDLDL", "DLDLDLD"];
    var px = 191, py = 186, ox = -114, oy = -65;
    for (var r = 0; r < map.length; r++) {
      for (var c = 0; c < map[r].length; c++) {
        var isL = map[r][c] === "L";
        var x = ox + c * px, y = oy + r * py;
        ctx.fillStyle = isL ? "#F0EEEC" : "#1D1E21";
        ctx.beginPath();
        ctx.roundRect(x, y, px - 10, py - 10, 22);
        ctx.fill();
        if (isL) {
          ctx.strokeStyle = "#1D1E21";
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(x + (px - 10) / 2, y + (py - 10) / 2, 28, 0, Math.PI * 1.5);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  });
})();\n`;
    }
    // Pass 2 Polish (v13): Exact measured irregular tile wall map=["LDLDLDL","LDLLLDD","DLDLDLL"], pitch=159x238, origin=(-35,-63) + vector icons inside BOTH lightTile (L) AND darkTile (D)!
    return `(function () {
  var AM = window.AM;
  AM.registerScene("${sceneId}", function (ctx, t, dur) {
    ctx.fillStyle = "#0F1012";
    ctx.fillRect(0, 0, 1024, 576);
    var drift = (t / Math.max(0.1, dur)) * 8;
    ctx.save();
    ctx.translate(512, 288);
    ctx.rotate(-0.049);
    ctx.translate(-512 - drift, -288);
    var map = ["LDLDLDL", "LDLLLDD", "DLDLDLL"];
    var px = 159, py = 238, ox = -35, oy = -63;
    for (var r = 0; r < map.length; r++) {
      for (var c = 0; c < map[r].length; c++) {
        var isL = map[r][c] === "L";
        var x = ox + c * px, y = oy + r * py;
        var w = px - 3, h = py - 3;
        var cx = x + w * 0.5, cy = y + h * 0.5;
        ctx.fillStyle = isL ? "#F0EEEA" : "#16171A";
        ctx.fillRect(x, y, w, h);
        var fg = isL ? "#16171A" : "#F0EEEA";
        ctx.strokeStyle = fg;
        ctx.fillStyle = fg;
        ctx.lineWidth = 3.5;
        if (r === 1 && c === 3) {
          ctx.font = "800 36px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("L", cx, cy);
        } else {
          var kind = (r * 7 + c) % 5;
          if (kind === 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, 13, 0.3, Math.PI * 1.65);
            ctx.stroke();
          } else if (kind === 1) {
            ctx.strokeRect(cx - 11, cy - 11, 22, 22);
          } else if (kind === 2) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - 13);
            ctx.lineTo(cx + 12, cy + 10);
            ctx.lineTo(cx - 12, cy + 10);
            ctx.closePath();
            ctx.stroke();
          } else if (kind === 3) {
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.fillRect(cx - 10, cy - 10, 20, 20);
          }
        }
      }
    }
    ctx.restore();
  });
})();\n`;
  }

  // Scene 3+: Centered vertical hero card [381, 70, 262, 440] over blurred 3-card carousel backdrop
  if (passNum === 1) {
    // Pass 1 Draft: v12 defect (full-screen white rectangle [14, 13, 980, 552] covering entire canvas)
    return `(function () {
  var AM = window.AM;
  AM.registerScene("${sceneId}", function (ctx, t, dur) {
    var dx = Math.round((t / Math.max(0.1, dur)) * 30);
    ctx.fillStyle = "#18181B";
    ctx.fillRect(0, 0, 1024, 576);
    ctx.fillStyle = "#F0EFEF";
    ctx.fillRect(14 + dx, 13, 520, 552);
    ctx.fillStyle = "#18181B";
    ctx.font = "600 42px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Draft", 260 + dx, 288);
  });
})();\n`;
  }
  // Pass 2 Polish (v13): Blurred 3-card carousel background + sharp centered vertical hero card [352, 22, 320, 536]
  return `(function () {
  var AM = window.AM;
  AM.registerScene("${sceneId}", function (ctx, t, dur) {
    var zoom = 1 + (t / Math.max(0.1, dur)) * 0.04;
    ctx.fillStyle = "#242328";
    ctx.fillRect(0, 0, 1024, 576);

    ctx.save();
    ctx.filter = "blur(6px)";
    // Left and right blurred flanking cards + top/bottom checkerboard edges
    ctx.fillStyle = "#E6E3E4";
    ctx.fillRect(52, 22, 290, 536);
    ctx.fillStyle = "#DAD3D6";
    ctx.fillRect(682, 22, 290, 536);
    // Left blurred slash-circle icon
    ctx.fillStyle = "#48454A";
    ctx.beginPath();
    ctx.arc(197, 290, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#E6E3E4";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(168, 318);
    ctx.lineTo(226, 262);
    ctx.stroke();
    // Right blurred double-parallelogram icon
    ctx.fillStyle = "#5A565C";
    ctx.beginPath();
    ctx.moveTo(800, 275);
    ctx.lineTo(852, 250);
    ctx.lineTo(852, 274);
    ctx.lineTo(800, 299);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(800, 308);
    ctx.lineTo(852, 283);
    ctx.lineTo(852, 307);
    ctx.lineTo(800, 332);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Sharp centered vertical hero card at heroCardBox=[352, 22, 320, 536]
    ctx.save();
    ctx.translate(512, 288);
    ctx.scale(zoom, zoom);
    ctx.translate(-512, -288);
    ctx.fillStyle = "#F4F2EE";
    ctx.fillRect(352, 22, 320, 536);
    ctx.strokeStyle = "#5A575C";
    ctx.lineWidth = 2;
    ctx.strokeRect(352, 22, 320, 536);

    // Bold geometric italic 'L' hero logo in center (512, 255)
    ctx.fillStyle = "#18171A";
    ctx.font = "900 italic 118px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("L", 512, 255);

    // Subtle purple construction arc near top-left of 'L'
    ctx.strokeStyle = "#6F58E9";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(462, 218, 22, Math.PI * 1.05, Math.PI * 1.48);
    ctx.stroke();

    // White pill badge 'Making logo' near bottom of hero card (y=458)
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(402, 430, 220, 52, 26);
    ctx.fill();
    ctx.font = "500 22px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#2A292E";
    ctx.fillText("Making ", 438, 457);
    ctx.fillStyle = "#6F58E9";
    ctx.fillText("logo", 522, 457);
    ctx.restore();
  });
})();\n`;
}

async function startSingleSceneMockLlm(styleDoc, targetSceneNum) {
  const scenes = styleDoc.scenes || [];
  const scMeta = scenes[targetSceneNum - 1];
  const sceneId = scMeta.id || `scene${targetSceneNum}`;
  const beatTs =
    Array.isArray(scMeta.beatStripTimestamps) && scMeta.beatStripTimestamps.length >= 2
      ? scMeta.beatStripTimestamps
      : [
          Number((scMeta.start + scMeta.duration * 0.25).toFixed(2)),
          Number((scMeta.start + scMeta.duration * 0.5).toFixed(2)),
          Number((scMeta.start + scMeta.duration * 0.75).toFixed(2)),
        ];

  let coordStep = 0;
  let subStep = 0;
  let sawScopeGuardClampBanner = false;
  let sawOutOfScopeWriteBlocked = false;
  let sawAutoRollback = false;
  let subDone = false;
  let pass1Result = null;
  let pass2Result = null;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-loop-v13", object: "model" }] }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const messages = body.messages || [];
      const sysText = String(messages[0]?.content || "");
      const allText = JSON.stringify(messages);
      const isSubagent = sysText.includes("Motion Designer Subagent");

      const respond = (msgObj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `cmpl-${Date.now()}`,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                finish_reason: msgObj.tool_calls ? "tool_calls" : "stop",
                message: msgObj,
              },
            ],
            usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
          })
        );
      };

      if (isSubagent) {
        subStep += 1;
        if (allText.includes("SCENE SCOPE GUARD (v13)")) {
          sawScopeGuardClampBanner = true;
        }
        if (allText.includes("SCENE SCOPE GUARD: This motion-designer task is scoped strictly")) {
          sawOutOfScopeWriteBlocked = true;
        }
        if (allText.includes("autoRolledBackScenes")) {
          sawAutoRollback = true;
        }

        // Capture latest preview comparison result from tool messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role === "tool" && m.name === "capture_film_preview") {
            try {
              const parsed = JSON.parse(m.content);
              if (parsed?.referenceComparison?.ok) {
                if (subStep === 3) {
                  pass1Result = parsed.referenceComparison;
                } else if (subStep === 5 || subStep === 8) {
                  pass2Result = parsed.referenceComparison;
                }
              }
            } catch {
              // ignore
            }
            break;
          }
        }

        if (subStep === 1) {
          // Step 1: Write Pass 1 Draft of targetSceneNum + attempt out-of-scope write to scene7.js (must be blocked by v13 Scene Scope Guard!)
          const outOfScopeNum = targetSceneNum === 7 ? 6 : 7;
          const calls = [
            {
              id: `w_pass1_s${targetSceneNum}`,
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  filePath: `script/scene${targetSceneNum}.js`,
                  content: getScenePassScripts(targetSceneNum, sceneId, 1),
                }),
              },
            },
          ];
          if (targetSceneNum !== outOfScopeNum) {
            calls.push({
              id: `w_blocked_s${outOfScopeNum}`,
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  filePath: `script/scene${outOfScopeNum}.js`,
                  content: "// should be blocked by SCENE SCOPE GUARD",
                }),
              },
            });
          }
          return respond({ role: "assistant", content: "", tool_calls: calls });
        }

        if (subStep === 2) {
          // Step 2: Run scoped preview for Pass 1 Draft (omitting timestamps/targetSceneIndices so subagent_tool_batch auto-scopes!)
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `p_pass1_s${targetSceneNum}`,
                type: "function",
                function: {
                  name: "capture_film_preview",
                  arguments: JSON.stringify({
                    compareToReference: true,
                    passThreshold: 0.65,
                    targetSceneIndices: [targetSceneNum],
                  }),
                },
              },
            ],
          });
        }

        if (subStep === 3) {
          // Step 3: Write Pass 2 v13 Polish of targetSceneNum
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `w_pass2_s${targetSceneNum}`,
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: `script/scene${targetSceneNum}.js`,
                    content: getScenePassScripts(targetSceneNum, sceneId, 2),
                  }),
                },
              },
            ],
          });
        }

        if (subStep === 4) {
          // Step 4: Run scoped preview for Pass 2 v13 Polish
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `p_pass2_s${targetSceneNum}`,
                type: "function",
                function: {
                  name: "capture_film_preview",
                  arguments: JSON.stringify({
                    compareToReference: true,
                    passThreshold: 0.65,
                    targetSceneIndices: [targetSceneNum],
                  }),
                },
              },
            ],
          });
        }

        if (subStep === 5) {
          // Step 5: Test Auto-Rollback on regression! Write a broken/blank regression to targetSceneNum and run preview
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `w_reg_s${targetSceneNum}`,
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    filePath: `script/scene${targetSceneNum}.js`,
                    content: `(function(){ window.AM.registerScene("${sceneId}", function(ctx, t){ ctx.fillStyle="#050507"; ctx.fillRect(0,0,1024,576); ctx.fillStyle="#222"; ctx.fillRect(10+t*4,10,12,12); }); })();\n`,
                  }),
                },
              },
            ],
          });
        }

        if (subStep === 6) {
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `p_reg_s${targetSceneNum}`,
                type: "function",
                function: {
                  name: "capture_film_preview",
                  arguments: JSON.stringify({
                    compareToReference: true,
                    passThreshold: 0.65,
                    targetSceneIndices: [targetSceneNum],
                  }),
                },
              },
            ],
          });
        }

        if (subStep === 7) {
          // Step 7: Re-verify after auto-rollback restored Pass 2's best script on disk!
          return respond({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `p_post_rb_s${targetSceneNum}`,
                type: "function",
                function: {
                  name: "capture_film_preview",
                  arguments: JSON.stringify({
                    compareToReference: true,
                    passThreshold: 0.65,
                    targetSceneIndices: [targetSceneNum],
                  }),
                },
              },
            ],
          });
        }

        subDone = true;
        return respond({
          role: "assistant",
          content: `Completed 2-pass visual loop + auto-rollback verification for Scene ${targetSceneNum} (${sceneId}).`,
        });
      }

      // Coordinator turns
      coordStep += 1;
      if (coordStep === 1) {
        const scaffoldScenes = scenes.map((s, idx) => ({
          id: s.id || `scene${idx + 1}`,
          duration: Number(s.duration || 2.5),
          accent: s.layout?.palette?.accentHex || "#884BF9",
        }));
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
                  title: "Labs Showreel v13 Loop",
                  slug: "labs-showreel-loop",
                  width: Number(styleDoc.width || 1024),
                  height: Number(styleDoc.height || 576),
                  fps: Number(styleDoc.fps || 30),
                  background: "#0C0B0E",
                  scenes: scaffoldScenes,
                }),
              },
            },
          ],
        });
      }

      if (coordStep === 2) {
        // Deliberately mention 4 scenes (targetSceneNum + 3 others) so v13 clamp_target_scene_indices_for_reference clamps it to <= 2 scenes!
        const extra1 = (targetSceneNum % scenes.length) + 1;
        const extra2 = ((targetSceneNum + 1) % scenes.length) + 1;
        const extra3 = ((targetSceneNum + 2) % scenes.length) + 1;
        return respond({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "c_task",
              type: "function",
              function: {
                name: "task",
                arguments: JSON.stringify({
                  subagent_type: "motion-designer",
                  background: false,
                  description: `Build and verify scene ${targetSceneNum}`,
                  prompt: `Implement script/scene${targetSceneNum}.js (and refine scene ${extra1}, scene ${extra2}, scene ${extra3}) using 6-beat comparison strip.`,
                }),
              },
            },
          ],
        });
      }

      return respond({
        role: "assistant",
        content: `Single-scene loop for Scene ${targetSceneNum} complete.`,
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        getState: () => ({
          sawScopeGuardClampBanner,
          sawOutOfScopeWriteBlocked,
          sawAutoRollback,
          subDone,
          pass1Result,
          pass2Result,
        }),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function runSingleSceneIteration(cacheDir, styleDoc, sceneNum) {
  const t0 = Date.now();
  const mockLlm = await startSingleSceneMockLlm(styleDoc, sceneNum);
  let stack = null;
  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-loop": {
            name: "Mock Loop Provider",
            type: "openai",
            options: { baseURL: mockLlm.url, apiKey: "sk-loop" },
            models: { "mock-loop-v13": { name: "Mock Loop v13", vision: true } },
          },
        },
      },
    });

    // Copy cached ref/extracted into stack.workspaceDir/ref/extracted (instant ~10ms, no re-extraction!)
    fs.cpSync(
      path.join(cacheDir, "ref"),
      path.join(stack.workspaceDir, "ref"),
      { recursive: true }
    );

    const baseUrl = stack.engineUrl;
    const authHeader = stack.authHeader;
    const wsDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(wsDir)}`;
    const modelObj = { providerID: "mock-loop", modelID: "mock-loop-v13", id: "mock-loop-v13" };

    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: `Scene ${sceneNum} Loop`, model: modelObj },
    });
    const sessId = sessRes.json?.data?.id ?? sessRes.json?.id;
    assert.ok(sessId, `Missing session id: ${sessRes.text}`);

    const postRes = await api(baseUrl, `/api/session/${sessId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: { text: `Kerjakan Scene ${sceneNum} dari referensi video ref/ref_tiktok.mp4.` },
      },
    });
    assert.ok(postRes.ok, `Prompt failed: ${postRes.text}`);

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      if (mockLlm.getState().subDone) {
        break;
      }
    }

    const state = mockLlm.getState();
    const projDir = path.join(wsDir, "projects", "labs-showreel-v13-loop");
    const beatStripSrc = path.join(
      projDir,
      ".aetheria",
      "preview",
      `scene_${String(sceneNum).padStart(2, "0")}_compare_6beats.jpg`
    );
    assert.ok(
      fs.existsSync(beatStripSrc),
      `Expected 6-beat comparison strip at ${beatStripSrc}`
    );

    const outPreviewDir = path.join(cacheDir, "preview");
    fs.mkdirSync(outPreviewDir, { recursive: true });
    const persistedBeatStrip = path.join(
      outPreviewDir,
      `scene_${String(sceneNum).padStart(2, "0")}_compare_6beats.jpg`
    );
    fs.copyFileSync(beatStripSrc, persistedBeatStrip);

    // Verify that after Step 5's deliberate regression, Step 6 auto-rolled back script/sceneK.js to Pass 2's code!
    const finalScriptOnDisk = fs.readFileSync(
      path.join(projDir, "script", `scene${sceneNum}.js`),
      "utf8"
    );
    const scMeta = styleDoc.scenes[sceneNum - 1];
    const expectedPass2Code = getScenePassScripts(sceneNum, scMeta.id || `scene${sceneNum}`, 2);
    assert.equal(
      finalScriptOnDisk,
      expectedPass2Code,
      `Expected auto-rollback to restore Pass 2 code for scene${sceneNum}.js`
    );
    assert.ok(state.sawOutOfScopeWriteBlocked, "Expected out-of-scope write to be blocked by SCENE SCOPE GUARD");
    assert.ok(state.sawAutoRollback, "Expected autoRolledBackScenes in preview result");

    const pass1Overall = Number(state.pass1Result?.overallFidelity || 0);
    const pass2Overall = Number(state.pass2Result?.overallFidelity || 0);
    assert.ok(
      pass2Overall > pass1Overall,
      `Expected Pass 2 score (${pass2Overall}) > Pass 1 score (${pass1Overall})`
    );

    const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
    console.log(
      JSON.stringify(
        {
          scene: sceneNum,
          sceneId: scMeta.id,
          elapsedSec,
          pass1Overall,
          pass2Overall,
          scoreDelta: Number((pass2Overall - pass1Overall).toFixed(4)),
          ssimMean: state.pass2Result?.ssimMean,
          edgeMatchMean: state.pass2Result?.edgeMatchMean,
          colorMatchMean: state.pass2Result?.colorMatchMean,
          sawScopeGuardClampBanner: state.sawScopeGuardClampBanner,
          sawOutOfScopeWriteBlocked: state.sawOutOfScopeWriteBlocked,
          sawAutoRollback: state.sawAutoRollback,
          compare6BeatsPath: persistedBeatStrip,
        },
        null,
        2
      )
    );
  } finally {
    if (stack) await stack.stop();
    await mockLlm.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.clean && fs.existsSync(opts.cacheDir)) {
    fs.rmSync(opts.cacheDir, { recursive: true, force: true });
  }
  fs.mkdirSync(opts.cacheDir, { recursive: true });

  const styleDoc = ensureReferenceExtracted(opts.cacheDir, opts.reextract);
  const scenes = Array.isArray(styleDoc.scenes) ? styleDoc.scenes : [];
  assert.ok(scenes.length >= 4, `Expected >=4 extracted scenes, got ${scenes.length}`);

  const s1Clues = scenes[0]?.motionClues || {};
  const s2Tiles = scenes[1]?.layout?.contrastTiles?.grid || {};
  const s3Clues = scenes[2]?.motionClues || {};
  assert.ok(s1Clues.inlineGlyphMorph, "Scene 1 must have inlineGlyphMorph clue");
  assert.ok(!s1Clues.heroCardBox, "Scene 1 (dark scene) must NOT have false heroCardBox");
  assert.ok(s2Tiles.iconRule, "Scene 2 contrastTiles.grid must include iconRule");
  assert.ok(! scenes[1]?.motionClues?.heroCardBox, "Scene 2 (bento grid) must NOT have false heroCardBox");
  assert.ok(Array.isArray(s3Clues.heroCardBox), "Scene 3 (bright carousel) must detect heroCardBox");

  const targetIndices =
    opts.scene.toLowerCase() === "all"
      ? [1, 2, 3]
      : [Math.max(1, Math.min(scenes.length, Number.parseInt(opts.scene, 10) || 1))];

  for (const sceneNum of targetIndices) {
    await runSingleSceneIteration(opts.cacheDir, styleDoc, sceneNum);
  }
}

main().catch((err) => {
  console.error("[single-scene-loop] FAILED:", err);
  process.exit(1);
});
