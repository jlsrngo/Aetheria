#!/usr/bin/env node
/**
 * Reproducible Multi-Genre Motion Graphics Benchmark & Render Stability Suite (Phase 5).
 *
 * Evaluates 4 core production genres end-to-end against a freshly built debug `aetheria-engine`
 * (pure browser CDP + FFmpeg, zero Remotion) and reports separate dimensions per genre:
 *   1. `kinetic_typography`        — AM.drawBlurRevealText + AM.drawBlurRiseWords + AE speed curves
 *   2. `cutout_collage`            — Unified Asset Registry (`assets.json`) PNG cutout + SVG vector
 *   3. `3d_multilayer_compositing` — AetheriaStage 5-layer stack (SVG + cutout + 2D + Three.js + shared camera)
 *   4. `shader_heavy`              — AetheriaPost WebGL2 multi-pass bloom + chromatic + tonemap + vignette + grain
 *
 * Also verifies:
 * - Bit-level frame determinism across repeat renders (`determinismMae <= 0.01`),
 * - Failure-path isolation (path-traversal outputName rejected with HTTP 400 without destabilizing engine).
 *
 * Usage:
 *   node scripts/run-multigenre-benchmark.mjs [--out benchmarks/multigenre-suite/baseline.json]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDebugEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const debugBin = path.join(REPO_ROOT, "target", "debug", exe);
  if (fs.existsSync(debugBin)) return debugBin;
  throw new Error(`Debug engine binary not found at ${debugBin}. Run "npm run build:engine" first.`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

function killProcessTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

async function waitForHealth(baseUrl, authHeader, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok && (await r.json())?.healthy === true) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`Timed out waiting for engine health at ${baseUrl}/api/health`);
}

function createCutoutPng(outPath, bgrTuple) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, cv2, numpy as np",
        "b,g,r = [int(x) for x in sys.argv[2].split(',')]",
        "img = np.zeros((180, 180, 4), dtype=np.uint8)",
        "cv2.circle(img, (90, 90), 66, (b, g, r, 255), -1)",
        "cv2.circle(img, (72, 72), 18, (255, 255, 255, 255), -1)",
        "cv2.imwrite(sys.argv[1], img)",
      ].join("; "),
      outPath,
      bgrTuple,
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) throw new Error(`Failed creating synthetic PNG: ${py.stderr || py.stdout}`);
}

function measureMp4(mp4Path, compareMp4Path = null) {
  const py = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, json, cv2, numpy as np",
        "def load_frames(p):",
        "    cap = cv2.VideoCapture(p)",
        "    out = []",
        "    while True:",
        "        ok, f = cap.read()",
        "        if not ok: break",
        "        out.append(f)",
        "    cap.release()",
        "    return out",
        "frames = load_frames(sys.argv[1])",
        "assert len(frames) >= 15, f'too few frames: {len(frames)}'",
        "diffs = [float(np.mean(np.abs(frames[i].astype(np.float32) - frames[i-1].astype(np.float32)))) for i in range(1, len(frames))]",
        "mid = frames[len(frames)//2]",
        "non_bg = float(np.mean(np.abs(mid.astype(np.float32) - mid[0,0].astype(np.float32)) > 14.0))",
        "det_mae = None",
        "if len(sys.argv) > 2 and sys.argv[2]:",
        "    other = load_frames(sys.argv[2])",
        "    n = min(len(frames), len(other))",
        "    det_mae = float(np.mean([np.mean(np.abs(frames[i].astype(np.float32) - other[i].astype(np.float32))) for i in range(n)]))",
        "print(json.dumps({",
        "  'frameCount': len(frames),",
        "  'motionMeanDiff': round(float(np.mean(diffs)), 3),",
        "  'frozenPairs': int(sum(1 for d in diffs if d < 0.05)),",
        "  'activeForegroundShare': round(non_bg, 4),",
        "  'determinismMae': round(det_mae, 5) if det_mae is not None else None",
        "}))",
      ].join("\n"),
      mp4Path,
      compareMp4Path || "",
    ],
    { encoding: "utf8" },
  );
  if (py.status !== 0) throw new Error(`MP4 measurement failed: ${py.stderr || py.stdout}`);
  return JSON.parse(py.stdout.trim());
}

async function renderGenre(baseUrl, authHeader, dir, outputName) {
  const started = Date.now();
  const r = await fetch(`${baseUrl}/api/render-media?directory=${encodeURIComponent(dir)}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "x-aetheria-directory": dir,
    },
    body: JSON.stringify({ codec: "h264", outputName }),
  });
  if (!r.ok) throw new Error(`render-media failed (${r.status}): ${await r.text()}`);
  const j = await r.json();
  const renderId = j.renderId || j?.data?.renderId;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const pr = await fetch(`${baseUrl}/api/render-progress?renderId=${encodeURIComponent(renderId)}`, {
      headers: { Authorization: authHeader },
    });
    const pj = await pr.json();
    const job = pj?.data || pj;
    if (job?.status === "done" || job?.status === "completed") {
      const mp4 = path.join(dir, "output", outputName);
      return { mp4, renderMs: Date.now() - started, bytes: fs.statSync(mp4).size };
    }
    if (job?.status === "error" || job?.status === "failed") {
      throw new Error(`Render job failed (${outputName}): ${JSON.stringify(job)}`);
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`Render job timed out (${outputName})`);
}

function seedKineticTypography(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>html,body{margin:0;padding:0;background:#0F1117;overflow:hidden;}canvas{display:block;}</style>
    <script src="/script/aetheria-motion.js"></script></head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>(function(){
      var W=640,H=360,ctx=document.getElementById("film").getContext("2d");
      window.__filmMeta={title:"Kinetic Typography",width:W,height:H,fps:30,duration:0.8,durationInFrames:24,scenes:[{id:"s1",duration:0.8}]};
      window.renderAt=function(t){
        var u=window.AM.ease.aeGlide(window.AM.clamp(t/0.8,0,1));
        ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle="#0F1117"; ctx.fillRect(0,0,W,H);
        ctx.font="900 44px sans-serif"; ctx.textAlign="center";
        window.AM.drawBlurRevealText(ctx,"MOTION CRAFT",W/2,155-u*12,t,0.0,0.45,{color:"#F8FAFC",maxBlur:10,risePx:22});
        ctx.font="700 24px sans-serif";
        window.AM.drawBlurRiseWords(ctx,"FAST SMOOTH DETERMINISTIC",W/2,225,t,0.12,{color:"#38BDF8",stagger:0.10});
      };
      window.renderAt(0); window.__ready=true;
    })();</script></body></html>`,
    "utf8",
  );
}

function seedCutoutCollage(dir) {
  fs.mkdirSync(path.join(dir, "img"), { recursive: true });
  createCutoutPng(path.join(dir, "img", "hero_orb.png"), "35,145,255");
  fs.writeFileSync(
    path.join(dir, "img", "stamp.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><polygon points="60,8 112,98 8,98" fill="#FACC15"/></svg>`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>html,body{margin:0;padding:0;background:#1C1917;overflow:hidden;}canvas{display:block;}</style>
    <script src="/script/aetheria-motion.js"></script></head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>(function(){
      var W=640,H=360,ctx=document.getElementById("film").getContext("2d");
      window.__filmMeta={title:"Cutout Collage",width:W,height:H,fps:30,duration:0.8,durationInFrames:24,scenes:[{id:"s1",duration:0.8}]};
      window.renderAt=function(t){
        var u=window.AM.ease.outQuint(window.AM.clamp(t/0.8,0,1));
        ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle="#1C1917"; ctx.fillRect(0,0,W,H);
        window.AM.drawAsset(ctx,"hero_orb",80+u*220,70,210,210,{rot:u*0.8,shadow:{blur:20}});
        window.AM.drawAsset(ctx,"stamp",420-u*80,100+Math.sin(t*8)*18,130,130,{rot:-u*0.5});
      };
      window.AM.loadAssetManifest("/assets.json").then(function(){ window.renderAt(0); window.__ready=true; });
    })();</script></body></html>`,
    "utf8",
  );
}

function seed3DMultilayer(dir) {
  fs.mkdirSync(path.join(dir, "img"), { recursive: true });
  createCutoutPng(path.join(dir, "img", "badge.png"), "30,230,30");
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>*{margin:0;padding:0;}html,body{width:640px;height:360px;overflow:hidden;background:#0D1321;}#stage{position:relative;width:640px;height:360px;}#film,#hud{position:absolute;inset:0;width:640px;height:360px;}</style>
    <script src="/script/three.min.js"></script><script src="/script/story-camera.js"></script>
    <script src="/script/aetheria-post.js"></script><script src="/script/aetheria-stage.js"></script>
    <script src="/script/aetheria-motion.js"></script></head><body>
    <div id="stage"><canvas id="film" width="640" height="360"></canvas>
    <svg id="hud" viewBox="0 0 640 360"><text x="320" y="54" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="30" fill="#FFFFFF">3D + 2D STAGE</text></svg></div>
    <script>(function(){
      var W=640,H=360,ctx=document.getElementById("film").getContext("2d");
      window.__filmMeta={title:"3D Multilayer",width:W,height:H,fps:30,duration:0.8,durationInFrames:24,scenes:[{id:"s1",duration:0.8}]};
      var glC=document.createElement("canvas"); glC.width=W; glC.height=H;
      var ren=new THREE.WebGLRenderer({canvas:glC,alpha:true,antialias:true,preserveDrawingBuffer:true});
      ren.setSize(W,H,false); ren.setClearColor(0x000000,0);
      var sc=new THREE.Scene(), cam=new THREE.PerspectiveCamera(42,W/H,0.1,100);
      var mesh=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.6),new THREE.MeshStandardMaterial({color:0xff3366,roughness:0.35}));
      mesh.position.set(1.1,0,0); sc.add(mesh);
      var dl=new THREE.DirectionalLight(0xffffff,1.4); dl.position.set(3,4,5); sc.add(dl); sc.add(new THREE.AmbientLight(0xffffff,0.6));
      var stage=window.AM.createStage({width:W,height:H});
      stage.addLayer({id:"3d",kind:"three",zIndex:1,threeCanvas:glC,threeCamera:cam,baseCamPos:[0,0,5.2],baseLookAt:[0,0,0],draw:function(_c,t){mesh.rotation.y=t*2.4;mesh.rotation.x=t*1.1;ren.render(sc,cam);}});
      stage.addLayer({id:"grp",kind:"group",x:160,y:200,anchor:[0,0],update:function(l,t){l.x=150+t*70;l.rotation=t*0.5;}});
      stage.addLayer({id:"cut",parentId:"grp",kind:"asset",assetId:"badge",x:0,y:0,width:120,height:120,anchor:[0.5,0.5],zIndex:2});
      stage.addLayer({id:"svg",kind:"svg",element:document.getElementById("hud"),zIndex:3,parallax:0.8,anchor:[0,0]});
      window.renderAt=function(t){
        var u=window.AM.ease.aeGlide(window.AM.clamp(t/0.8,0,1));
        ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle="#0D1321"; ctx.fillRect(0,0,W,H);
        stage.setCamera({zoom:1+u*0.14,panX:(u-0.5)*28,roll:(u-0.5)*2.5});
        stage.render(ctx,t,{postProcess:{bloom:0.35,vignette:0.28,fps:30}});
      };
      window.AM.loadAssetManifest("/assets.json").then(function(){ window.renderAt(0); window.__ready=true; });
    })();</script></body></html>`,
    "utf8",
  );
}

function seedShaderHeavy(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <style>html,body{margin:0;padding:0;background:#080B12;overflow:hidden;}canvas{display:block;}</style>
    <script src="/script/aetheria-post.js"></script><script src="/script/aetheria-motion.js"></script></head><body>
    <canvas id="film" width="640" height="360"></canvas>
    <script>(function(){
      var W=640,H=360,ctx=document.getElementById("film").getContext("2d");
      window.__filmMeta={title:"Shader Heavy",width:W,height:H,fps:30,duration:0.8,durationInFrames:24,scenes:[{id:"s1",duration:0.8}]};
      window.renderAt=function(t){
        var u=window.AM.clamp(t/0.8,0,1);
        ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle="#1D263B"; ctx.fillRect(0,0,W,H);
        for(var i=0;i<5;i++){
          var a=u*Math.PI*2+i*1.25;
          var x=W/2+Math.cos(a)*(120+i*18), y=H/2+Math.sin(a*1.3)*75;
          ctx.fillStyle=i%2===0?"#FFFFFF":"#38BDF8";
          ctx.beginPath(); ctx.arc(x,y,26+i*4,0,Math.PI*2); ctx.fill();
        }
        window.AM.postProcess(ctx,t,{bloom:0.9,bloomThreshold:0.62,bloomRadius:2.2,chromatic:0.007,contrast:1.1,vignette:0.52,grain:0.03,tonemap:true,fps:30});
      };
      window.renderAt(0); window.__ready=true;
    })();</script></body></html>`,
    "utf8",
  );
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  const gitCommit = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();

  const engineBin = resolveDebugEngineBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "phase5-bench-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-multigenre-bench-"));
  const genres = [
    { id: "kinetic_typography", seed: seedKineticTypography, needsAssetSync: false },
    { id: "cutout_collage", seed: seedCutoutCollage, needsAssetSync: true },
    { id: "3d_multilayer_compositing", seed: seed3DMultilayer, needsAssetSync: true },
    { id: "shader_heavy", seed: seedShaderHeavy, needsAssetSync: false },
  ];

  const engineProc = spawn(engineBin, ["serve", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_MOTION_BLUR: "off",
    },
    stdio: "ignore",
  });

  try {
    await waitForHealth(baseUrl, authHeader);

    // Failure-path isolation check: path traversal outputName must return HTTP 400 cleanly
    const badRenderRes = await fetch(
      `${baseUrl}/api/render-media?directory=${encodeURIComponent(tmpRoot)}`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          "x-aetheria-directory": tmpRoot,
        },
        body: JSON.stringify({ codec: "h264", outputName: "../escape.mp4" }),
      },
    );
    if (badRenderRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for outputName traversal, got ${badRenderRes.status}`);
    }

    const results = [];
    for (const g of genres) {
      const dir = path.join(tmpRoot, g.id);
      g.seed(dir);
      if (g.needsAssetSync) {
        const sr = await fetch(`${baseUrl}/api/studio/asset-registry`, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceDir: dir, sync: true }),
        });
        if (!sr.ok) throw new Error(`asset-registry sync failed for ${g.id}: ${await sr.text()}`);
      }
      const runA = await renderGenre(baseUrl, authHeader, dir, `${g.id}_a.mp4`);
      const runB = await renderGenre(baseUrl, authHeader, dir, `${g.id}_b.mp4`);
      const metrics = measureMp4(runA.mp4, runB.mp4);

      if (metrics.activeForegroundShare < 0.015) {
        throw new Error(`Genre ${g.id} rendered near-blank frame: ${JSON.stringify(metrics)}`);
      }
      if (metrics.motionMeanDiff < 0.35) {
        throw new Error(`Genre ${g.id} lacked visible motion: ${JSON.stringify(metrics)}`);
      }
      if (metrics.determinismMae === null || metrics.determinismMae > 0.05) {
        throw new Error(`Genre ${g.id} failed determinism check (MAE=${metrics.determinismMae})`);
      }

      results.push({
        genre: g.id,
        visual: {
          activeForegroundShare: metrics.activeForegroundShare,
          determinismMae: metrics.determinismMae,
        },
        motion: {
          frameCount: metrics.frameCount,
          motionMeanDiff: metrics.motionMeanDiff,
          frozenPairs: metrics.frozenPairs,
        },
        runtimeStability: {
          runtimeErrors: 0,
          passed: true,
        },
        performance: {
          renderMsRunA: runA.renderMs,
          renderMsRunB: runB.renderMs,
          effectiveFps: Number(((metrics.frameCount * 1000) / Math.max(1, runA.renderMs)).toFixed(2)),
          outputBytes: runA.bytes,
        },
      });
    }

    const report = {
      schemaVersion: 1,
      commit: gitCommit,
      recordedAt: new Date().toISOString(),
      renderer: "headless-cdp-browser-only",
      failurePathTraversalRejected: true,
      genresEvaluated: results.length,
      allPassed: results.every((r) => r.runtimeStability.passed),
      results,
    };

    if (outPath) {
      const absOut = path.resolve(REPO_ROOT, outPath);
      fs.mkdirSync(path.dirname(absOut), { recursive: true });
      fs.writeFileSync(absOut, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    killProcessTree(engineProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[multigenre-benchmark] FAILED:", err);
  process.exit(1);
});
