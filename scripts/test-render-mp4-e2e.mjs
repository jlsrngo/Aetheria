import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_HTML = path.join(REPO_ROOT, "benchmarks", "showreel-aetheria-9router.html");

function inspectVideoWithPython(mp4Path) {
  const pyCode = [
    "import cv2, json, sys",
    "cap = cv2.VideoCapture(sys.argv[1])",
    "assert cap.isOpened(), 'cannot open rendered mp4'",
    "info = {'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), 'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), 'fps': round(cap.get(cv2.CAP_PROP_FPS), 2), 'frames': int(cap.get(cv2.CAP_PROP_FRAME_COUNT))}",
    "cap.release()",
    "print(json.dumps(info))",
  ].join("; ");
  const res = spawnSync("python", ["-c", pyCode, mp4Path], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`OpenCV verification failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout.trim());
}

async function main() {
  const stack = await startLiveStack({ startWeb: false });
  const t0 = Date.now();
  try {
    fs.copyFileSync(SOURCE_HTML, path.join(stack.workspaceDir, "index.html"));

    // 1. Success path: fast 30-frame slice triggers parallel worker pool (>= 24 frames)
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
          outputName: "e2e-fast-30.mp4",
          codec: "h264",
          inFrame: 0,
          outFrame: 29,
        }),
      },
    );
    const startJson = await startRes.json();
    assert.equal(startRes.status, 200, `Unexpected status: ${JSON.stringify(startJson)}`);
    assert.equal(startJson.success, true);
    assert.ok(startJson.renderId, "Missing renderId");

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
    assert.ok(doneJob, "Timed out waiting for 30-frame render job");
    assert.equal(doneJob.renderedFrames, 30);
    assert.equal(doneJob.totalFrames, 30);

    const outPath = doneJob.outputPath || startJson.outputPath;
    assert.ok(outPath && fs.existsSync(outPath), `Missing rendered file: ${outPath}`);
    const fileBytes = fs.statSync(outPath).size;
    assert.ok(fileBytes > 10_000, `Rendered MP4 unexpectedly small: ${fileBytes} bytes`);

    const streamInfo = inspectVideoWithPython(outPath);
    assert.equal(streamInfo.width, 1080);
    assert.equal(streamInfo.height, 1920);
    assert.equal(streamInfo.frames, 30);

    // 2. Failure path: path traversal outputName must fail cleanly with HTTP 400 without crashing engine
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

    const healthRes = await fetch(`${stack.engineUrl}/api/health`, {
      headers: { Authorization: stack.authHeader },
    });
    const healthJson = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.equal(healthJson.healthy, true);

    console.log(
      JSON.stringify({
        ok: true,
        elapsedMs: Date.now() - t0,
        fileBytes,
        streamInfo,
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
