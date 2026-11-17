import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const candidates = [
    path.join(REPO_ROOT, "target", "debug", exe),
    path.join(REPO_ROOT, "target", "release", exe),
  ].filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    throw new Error('Engine binary not found. Run "npm run build:engine" first.');
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort(preferred = 4796) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => {
      const ephem = net.createServer();
      ephem.unref();
      ephem.listen(0, "127.0.0.1", () => {
        const addr = ephem.address();
        const port = typeof addr === "object" && addr ? addr.port : preferred + 1;
        ephem.close(() => resolve(port));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });
}

function writeSilentWav(filePath, durationSec = 0.25, sampleRate = 16000) {
  const numSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buf);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4796);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-audio-e2e-"));
  const outputDir = path.join(tempWorkspace, "output");
  const audioDir = path.join(tempWorkspace, "audio");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });

  const mediaPayload = Buffer.from(Array.from({ length: 64 }, (_, i) => i));
  fs.writeFileSync(path.join(outputDir, "sample.mp4"), mediaPayload);

  const engineLogs = [];
  const engine = spawn(engineBin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: tempWorkspace,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_WORKSPACE: tempWorkspace,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  engine.stdout.on("data", (d) => engineLogs.push(d.toString()));
  engine.stderr.on("data", (d) => engineLogs.push(d.toString()));

  try {
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await fetch(`${baseUrl}/api/health`, { headers: { Authorization: authHeader } });
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.healthy ?? json?.healthy) {
            healthy = true;
            break;
          }
        }
      } catch {
        // wait
      }
    }
    assert(healthy, `Engine failed healthcheck:\n${engineLogs.join("")}`);

    // Activate isolated temp workspace for desktop/studio endpoints
    const initRes = await fetch(`${baseUrl}/api/desktop/init-workspace`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ folderPath: tempWorkspace }),
    });
    assert(initRes.ok, `init-workspace failed: ${initRes.status}`);

    // 1. Range forward bytes=0-15
    const r1 = await fetch(`${baseUrl}/api/studio/stream-video?file=sample.mp4`, {
      headers: { Authorization: authHeader, Range: "bytes=0-15" },
    });
    assert(r1.status === 206, `Expected 206 for bytes=0-15, got ${r1.status}`);
    assert(r1.headers.get("content-range") === "bytes 0-15/64", `Bad content-range: ${r1.headers.get("content-range")}`);
    const b1 = Buffer.from(await r1.arrayBuffer());
    assert(b1.equals(mediaPayload.subarray(0, 16)), "bytes=0-15 payload mismatch");

    // 2. Suffix Range bytes=-16
    const r2 = await fetch(`${baseUrl}/api/studio/stream-video?file=sample.mp4`, {
      headers: { Authorization: authHeader, Range: "bytes=-16" },
    });
    assert(r2.status === 206, `Expected 206 for bytes=-16, got ${r2.status}`);
    assert(r2.headers.get("content-range") === "bytes 48-63/64", `Bad suffix content-range: ${r2.headers.get("content-range")}`);
    const b2 = Buffer.from(await r2.arrayBuffer());
    assert(b2.equals(mediaPayload.subarray(48, 64)), "bytes=-16 payload mismatch");

    // 3. Invalid out-of-bounds Range -> 416
    const r416 = await fetch(`${baseUrl}/api/studio/stream-video?file=sample.mp4`, {
      headers: { Authorization: authHeader, Range: "bytes=200-250" },
    });
    assert(r416.status === 416, `Expected 416 for OOB range, got ${r416.status}`);

    // 4. Negative check: traversal in stream-video
    const r403 = await fetch(`${baseUrl}/api/studio/stream-video?file=../secret.mp4`, {
      headers: { Authorization: authHeader },
    });
    assert(r403.status === 403, `Expected 403 for traversal path, got ${r403.status}`);

    // 5. Negative check: traversal sampleFileName in voice-presets/save
    const presetRes = await fetch(`${baseUrl}/api/studio/voice-presets/save`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "e2e_test_preset",
        name: "E2E Preset",
        promptText: "Halo dunia",
        sampleFileName: "../evil.wav",
        sampleBase64: Buffer.from("RIFFtest").toString("base64"),
      }),
    });
    const presetJson = await presetRes.json();
    assert(presetJson?.success === false, `Expected traversal preset save to fail, got ${JSON.stringify(presetJson)}`);
    assert(
      String(presetJson?.error || "").toLowerCase().includes("invalid samplefilename"),
      `Expected sampleFileName error, got ${JSON.stringify(presetJson)}`
    );

    // 6. storyboard_mixer.py negative check (missing VO -> non-zero exit)
    const mixerScript = path.join(REPO_ROOT, "core", "voicebox", "storyboard_mixer.py");
    const sbMissingPath = path.join(audioDir, "sb_missing.json");
    const masterOut = path.join(audioDir, "master.wav");
    fs.writeFileSync(
      sbMissingPath,
      JSON.stringify({
        totalDurationSec: 1.0,
        scenes: [{ startSec: 0, voFile: "missing_vo.wav", beats: [] }],
      })
    );
    let missingVoFailed = false;
    try {
      execFileSync("python", [mixerScript, "--resolved-json", sbMissingPath, "--public-dir", audioDir, "--out", masterOut], {
        stdio: "pipe",
      });
    } catch (err) {
      missingVoFailed = true;
      const stderr = String(err.stderr || "");
      assert(stderr.includes("Missing or empty WAV asset"), `Expected missing WAV stderr, got ${stderr}`);
    }
    assert(missingVoFailed, "Expected storyboard_mixer.py to fail on missing voFile");

    // 7. storyboard_mixer.py happy path with valid VO WAV (missing SFX reported in warnings)
    const validVo = path.join(audioDir, "vo_s1.wav");
    writeSilentWav(validVo, 0.3);
    const sbOkPath = path.join(audioDir, "sb_ok.json");
    fs.writeFileSync(
      sbOkPath,
      JSON.stringify({
        totalDurationSec: 1.0,
        scenes: [{ startSec: 0, voFile: "vo_s1.wav", beats: [] }],
      })
    );
    const okStdout = execFileSync(
      "python",
      [mixerScript, "--resolved-json", sbOkPath, "--public-dir", audioDir, "--out", masterOut],
      { encoding: "utf8" }
    );
    const okJson = JSON.parse(okStdout.trim());
    assert(okJson.success === true, `Expected mixer success, got ${okStdout}`);
    assert(Array.isArray(okJson.warnings) && okJson.warnings.length >= 1, "Expected warnings for missing SFX bank");
    assert(fs.existsSync(masterOut) && fs.statSync(masterOut).size > 44, "Expected non-empty master WAV output");

    console.log("AUDIO_PIPELINE_E2E_PASSED");
  } finally {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      engine.once("exit", done);
      engine.kill("SIGKILL");
      setTimeout(done, 1500);
    });
    fs.rmSync(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error("AUDIO_PIPELINE_E2E_FAILED:", err);
  process.exit(1);
});
