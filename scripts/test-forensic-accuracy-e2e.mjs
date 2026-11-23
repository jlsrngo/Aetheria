import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function buildModularTestFilm(workspaceDir) {
  const scriptDir = path.join(workspaceDir, "script");
  fs.mkdirSync(scriptDir, { recursive: true });

  const filmManifest = {
    schemaVersion: 1,
    manageIndexHtml: true,
    title: "Forensic Accuracy E2E",
    width: 720,
    height: 1280,
    fps: 30,
    background: "#0B0804",
    scenes: [
      {
        id: "scene1_lens",
        title: "Scene 1 Spherical Lens",
        script: "script/scene1.js",
        start: 0.0,
        duration: 0.833,
        accent: "#FFD9A0",
      },
      {
        id: "scene2_cut",
        title: "Scene 2 Exact Boundary Cut",
        script: "script/scene2.js",
        start: 0.833,
        duration: 0.567,
        accent: "#F08020",
      },
      {
        id: "scene3_push",
        title: "Scene 3 Push Left Bridge",
        script: "script/scene3.js",
        start: 1.4,
        duration: 0.6,
        accent: "#1850E8",
        transitionBridge: {
          kind: "push_left",
          tStart: 1.333,
          tEnd: 1.667,
          curve: [0.0, 0.25, 0.5, 0.75, 1.0],
        },
      },
    ],
  };
  fs.writeFileSync(
    path.join(workspaceDir, "film.json"),
    JSON.stringify(filmManifest, null, 2),
  );

  // Scene 1: 1-arg callback in main-canvas coords calling AM.drawSphericalLens at center (360, 640)
  const scene1Js = `(function () {
  var AM = window.AM;
  AM.registerScene("scene1_lens", function (ctx, t, dur) {
    var W = 720, H = 1280;
    ctx.fillStyle = "#0B0804";
    ctx.fillRect(0, 0, W, H);
    AM.drawSphericalLens(ctx, 360, 640, 290, 0.8, function (c) {
      c.fillStyle = "#FFFFFF";
      c.font = "700 44px Inter, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("With a Motions", 360, 640);
    });
    // Subtle deterministic floor indicator so every frame evolves continuously
    ctx.fillStyle = "#FFD9A0";
    ctx.fillRect(120 + 420 * AM.clamp(t / Math.max(0.1, dur), 0, 1), 1140, 36, 12);
  });
})();
`;
  fs.writeFileSync(path.join(scriptDir, "scene1.js"), scene1Js);

  // Scene 2: High-contrast orange backdrop for verifying 0-frame cut alignment at Frame 25 (t=0.8333s)
  const scene2Js = `(function () {
  var AM = window.AM;
  AM.registerScene("scene2_cut", function (ctx, t, dur) {
    var W = 720, H = 1280;
    ctx.fillStyle = "#F08020";
    ctx.fillRect(0, 0, W, H);
    var p = AM.clamp(t / Math.max(0.1, dur), 0, 1);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(260, 540 + 40 * p, 200, 200);
  });
})();
`;
  fs.writeFileSync(path.join(scriptDir, "scene2.js"), scene2Js);

  // Scene 3: Solid blue backdrop sliding in via runtime 30fps push_left transitionBridge
  const scene3Js = `(function () {
  var AM = window.AM;
  AM.registerScene("scene3_push", function (ctx, t, dur) {
    var W = 720, H = 1280;
    ctx.fillStyle = "#1850E8";
    ctx.fillRect(0, 0, W, H);
    var p = AM.clamp(t / Math.max(0.1, dur), 0, 1);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(280, 560 - 30 * p, 160, 160);
  });
})();
`;
  fs.writeFileSync(path.join(scriptDir, "scene3.js"), scene3Js);

  // Uses live /script/aetheria-motion.js resolveScene + renderFrameWithTransitions without auto soft-dissolve
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Forensic Accuracy E2E</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0B0804; }
    #stage { position: relative; width: 720px; height: 1280px; overflow: hidden; background: #0B0804; }
    #film { display: block; width: 720px; height: 1280px; }
  </style>
  <script src="/script/aetheria-motion.js"></script>
  <script src="/script/scene1.js"></script>
  <script src="/script/scene2.js"></script>
  <script src="/script/scene3.js"></script>
</head>
<body>
  <div id="stage"><canvas id="film" width="720" height="1280"></canvas></div>
  <script>
  (function () {
    "use strict";
    var W = 720, H = 1280, BG = "#0B0804";
    var SCENES = ${JSON.stringify(filmManifest.scenes)};
    window.__filmMeta = { title: "Forensic E2E", width: W, height: H, fps: 30, duration: 2.0, durationInFrames: 60, scenes: SCENES };
    var canvas = document.getElementById("film");
    var ctx = canvas.getContext("2d");
    function runSceneSafely(targetCtx, renderFn, localT, targetScene) {
      targetCtx.save();
      try {
        renderFn(targetCtx, localT, targetScene.duration, targetScene, window.AM);
      } finally {
        targetCtx.restore();
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        targetCtx.globalAlpha = 1;
        targetCtx.globalCompositeOperation = "source-over";
        targetCtx.filter = "none";
      }
    }
    window.renderAt = function (t) {
      var sec = Number.isFinite(t) ? Math.max(0, t) : 0;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      var renderSceneItem = function (targetCtx, targetScene, targetIdx, targetLocalT) {
        if (targetCtx !== ctx) {
          targetCtx.setTransform(1, 0, 0, 1, 0, 0);
          targetCtx.fillStyle = BG;
          targetCtx.fillRect(0, 0, W, H);
        }
        var renderFn = window.AM.getSceneRenderer(targetScene.id, targetIdx);
        if (renderFn) {
          runSceneSafely(targetCtx, renderFn, targetLocalT, targetScene);
        }
      };
      window.AM.renderFrameWithTransitions(ctx, sec, SCENES, W, H, renderSceneItem);
    };
    window.renderAt(0);
    window.__ready = true;
  })();
  </script>
</body>
</html>
`;
  fs.writeFileSync(path.join(workspaceDir, "index.html"), indexHtml);
}

function verifyRenderedMp4WithPython(mp4Path, outputDir) {
  const pyScript = `
import json, sys
from pathlib import Path
import cv2
import numpy as np

sys.path.insert(0, str(Path(r"${REPO_ROOT.replace(/\\/g, "\\\\")}") / "core" / "ref_extractor"))
import ref_compare
import ref_structural_compare as rsc

mp4_path = Path(sys.argv[1])
scratch = Path(sys.argv[2])
cap = cv2.VideoCapture(str(mp4_path))
assert cap.isOpened(), "cannot open rendered mp4"
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = round(float(cap.get(cv2.CAP_PROP_FPS)), 2)
frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
assert (w, h, frames) == (720, 1280, 60), f"unexpected video metadata {(w, h, fps, frames)}"

def read_frame(idx):
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, fr = cap.read()
    assert ok and fr is not None, f"failed reading frame {idx}"
    return fr

# 1. Verify K1 AM.drawSphericalLens preserved white text inside (360, 640) at frame 12 (t=0.40s)
fr12 = read_frame(12)
gray12 = cv2.cvtColor(fr12, cv2.COLOR_BGR2GRAY)
roi = gray12[520:760, 140:580]
max_luma = int(np.max(roi))
bright_pixels = int(np.count_nonzero(roi > 160))
assert max_luma > 200, f"spherical lens text too dim: max_luma={max_luma}"
assert bright_pixels > 800, f"spherical lens text missing/clipped: bright_pixels={bright_pixels}"

# 2. Verify P0-2 + K5 geometry gate scores empty sphere < 0.60 with verdict == "geometri_beda"
ref_p = scratch / "frame12_ref.jpg"
empty_sphere_p = scratch / "frame12_empty_sphere.jpg"
cv2.imwrite(str(ref_p), fr12, [cv2.IMWRITE_JPEG_QUALITY, 94])
blank_sphere = np.full((1280, 720, 3), (4, 8, 11), dtype=np.uint8)
cv2.circle(blank_sphere, (360, 640), 290, (160, 210, 240), 4)
cv2.imwrite(str(empty_sphere_p), blank_sphere, [cv2.IMWRITE_JPEG_QUALITY, 94])
cmp_res = ref_compare.compare_pairs({
    "passThreshold": 0.72,
    "stripOutputPath": str(scratch / "e2e_strip.jpg"),
    "pairs": [{"timestamp": 0.40, "refPath": str(ref_p), "previewPath": str(empty_sphere_p), "sceneId": "scene1_lens"}],
})
assert cmp_res["ok"] is True
pf0 = cmp_res["perFrame"][0]
assert pf0["geometryGateApplied"] is True, f"expected geometryGateApplied=True, got {pf0}"
assert pf0["combinedScore"] < 0.60, f"expected empty-sphere score < 0.60, got {pf0}"

# 2b. Verify K5 explicit geometri_beda verdict when foreground edge_sim <= 0.15
wrong_geo_p = scratch / "frame12_wrong_geo.jpg"
wrong_geo = np.full((1280, 720, 3), (4, 8, 11), dtype=np.uint8)
cv2.rectangle(wrong_geo, (40, 40), (220, 260), (240, 240, 240), -1)
cv2.imwrite(str(wrong_geo_p), wrong_geo, [cv2.IMWRITE_JPEG_QUALITY, 94])
cmp_geo = ref_compare.compare_pairs({
    "passThreshold": 0.72,
    "stripOutputPath": str(scratch / "e2e_strip_geo.jpg"),
    "pairs": [{"timestamp": 0.40, "refPath": str(ref_p), "previewPath": str(wrong_geo_p), "sceneId": "scene1_lens"}],
})
pf_geo = cmp_geo["perFrame"][0]
assert pf_geo["verdict"] == "geometri_beda", f"expected geometri_beda verdict, got {pf_geo}"

# 3. Verify K2 0-frame cut alignment on rounded boundary 0.833 (Frame 24=dark Scene 1, Frame 25=orange Scene 2)
fr24 = read_frame(24)
fr25 = read_frame(25)
pre_cut_r = int(fr24[40, 40, 2])
cut_r = int(fr25[40, 40, 2])
assert pre_cut_r < 30, f"expected dark Scene 1 at Frame 24 (t=0.800s), got R={pre_cut_r}"
assert cut_r > 210, f"expected hard-cut orange Scene 2 at exact Frame 25 (t=0.8333s), got R={cut_r}"

# 4. Verify K6 COLOR DRIFT detector
drift_a = np.full((120, 120, 3), 24, dtype=np.uint8)
drift_b = np.full((120, 120, 3), 24, dtype=np.uint8)
cv2.circle(drift_a, (60, 60), 34, (47, 172, 246), -1)
cv2.circle(drift_b, (60, 60), 34, (29, 121, 233), -1)
drift_msg = rsc.detect_color_and_luma_drift(drift_a, drift_b)
assert drift_msg and "COLOR DRIFT" in drift_msg, f"expected COLOR DRIFT diag, got {drift_msg}"

# 5. Verify runtime 30fps push_left transitionBridge at Frame 45 (t=1.50s midpoint: orange left, blue right) and settled blue Frame 54
fr45 = read_frame(45)
fr54 = read_frame(54)
left_px = fr45[200, 60]
right_px = fr45[200, 660]
settled_px = fr54[200, 100]
assert int(left_px[2]) > 200 and int(left_px[0]) < 60, f"expected orange outgoing Scene 2 on left of push_left at Frame 45, got BGR={left_px.tolist()}"
assert int(right_px[0]) > 180 and int(right_px[2]) < 60, f"expected blue incoming Scene 3 on right of push_left at Frame 45, got BGR={right_px.tolist()}"
assert int(settled_px[0]) > 180 and int(settled_px[2]) < 60, f"expected settled blue Scene 3 at Frame 54, got BGR={settled_px.tolist()}"

cap.release()
print(json.dumps({
    "width": w,
    "height": h,
    "fps": fps,
    "frames": frames,
    "lensMaxLuma": max_luma,
    "lensBrightPixels": bright_pixels,
    "emptySphereScore": pf0["combinedScore"],
    "wrongGeoVerdict": pf_geo["verdict"],
    "geometryGateApplied": pf0["geometryGateApplied"],
    "preCutFrame24Red": pre_cut_r,
    "exactCutFrame25Red": cut_r,
    "pushMidLeftBGR": [int(x) for x in left_px],
    "pushMidRightBGR": [int(x) for x in right_px],
    "settledScene3BGR": [int(x) for x in settled_px],
    "colorDriftDiag": drift_msg,
}))
`;
  const scratchDir = path.join(outputDir, "forensic-check");
  fs.mkdirSync(scratchDir, { recursive: true });
  const res = spawnSync("python", ["-c", pyScript, mp4Path, scratchDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`OpenCV/compare verification failed:\n${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout.trim());
}

async function main() {
  const stack = await startLiveStack({ startWeb: false });
  const t0 = Date.now();
  try {
    const healthInit = await fetch(`${stack.engineUrl}/api/health`, {
      headers: { Authorization: stack.authHeader },
    });
    const healthInitJson = await healthInit.json();
    assert.equal(healthInit.status, 200);
    assert.equal(healthInitJson.healthy, true);

    buildModularTestFilm(stack.workspaceDir);

    // 1. Success path: render modular 2-scene film using live Chromium CDP + AM.drawSphericalLens + 0.12s soft cross-dissolve
    const startRes = await fetch(
      `${stack.engineUrl}/api/render-media?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
          "x-aetheria-workspace": stack.workspaceDir,
        },
        body: JSON.stringify({
          outputName: "forensic-accuracy-e2e.mp4",
          codec: "h264",
          inFrame: 0,
          outFrame: 59,
        }),
      },
    );
    const startJson = await startRes.json();
    assert.equal(startRes.status, 200, `Unexpected status: ${JSON.stringify(startJson)}`);
    assert.equal(startJson.success, true);

    let doneJob = null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const progRes = await fetch(
        `${stack.engineUrl}/api/render-progress?renderId=${encodeURIComponent(startJson.renderId)}`,
        { headers: { Authorization: stack.authHeader } },
      );
      const job = await progRes.json();
      if (job.status === "done") {
        doneJob = job;
        break;
      }
      if (job.status === "error" || job.status === "not_found") {
        throw new Error(`Render failed: ${JSON.stringify(job)}\n${stack.engineLogs().slice(-1500)}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert.ok(doneJob, "Timed out waiting for forensic accuracy E2E render");
    assert.equal(doneJob.renderedFrames, 60);

    const outPath = doneJob.outputPath || startJson.outputPath;
    assert.ok(outPath && fs.existsSync(outPath), `Missing rendered file: ${outPath}`);

    const metrics = verifyRenderedMp4WithPython(outPath, path.join(stack.workspaceDir, "output"));

    // 2. Failure path: path traversal outputName rejected cleanly with HTTP 400, engine stays healthy
    const badRes = await fetch(
      `${stack.engineUrl}/api/render-media?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
          "x-aetheria-workspace": stack.workspaceDir,
        },
        body: JSON.stringify({
          outputName: "../escape.mp4",
          codec: "h264",
        }),
      },
    );
    const badJson = await badRes.json();
    assert.equal(badRes.status, 400);
    assert.equal(badJson.success, false);
    assert.match(String(badJson.error || ""), /Access Denied/i);

    const healthAfter = await fetch(`${stack.engineUrl}/api/health`, {
      headers: { Authorization: stack.authHeader },
    });
    const healthAfterJson = await healthAfter.json();
    assert.equal(healthAfter.status, 200);
    assert.equal(healthAfterJson.healthy, true);

    console.log(
      JSON.stringify({
        ok: true,
        elapsedMs: Date.now() - t0,
        metrics,
      }),
    );
  } finally {
    await stack.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
