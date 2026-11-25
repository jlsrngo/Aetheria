#!/usr/bin/env node
/**
 * Live-Engine E2E Verification (`scripts/test-story-audio-sfx-e2e.mjs`).
 *
 * Verifies the engine-wide story audio & shared SFX catalog pipeline against a real
 * `aetheria-engine` + headless Chrome CDP + FFmpeg:
 *   1. Flat-string `story.json` (`"audio": "audio/s1.wav"`, `"words": "audio/s1.words.json"`)
 *      preserves VO audio tracks in `film_inspector.rs` (corr(MP4, VO) > 0.70).
 *   2. `window.__audioEvents` collected by `StoryCore` synthesizes a timeline-synced SFX track
 *      from the shared 16-sound catalog (`core/voicebox/sfx_engine.py`) and overrides generic SFX.
 *   3. FFmpeg `sidechaincompress` ducking + `loudnorm=I=-16` keeps talking segments loud and
 *      ducks silent BGM tails cleanly.
 *   4. Failure path: path-traversal `outputName` fails with HTTP 400 without crashing engine.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function writePcmWav(outPath, samplesFloat, sr) {
  const n = samplesFloat.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samplesFloat[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

function makeSpeechLikeSamples(totalSec, speechSec, sr = 24000, baseHz = 210) {
  const n = Math.round(totalSec * sr);
  const out = new Float32Array(n);
  const speechEnd = Math.round(speechSec * sr);
  for (let i = 0; i < speechEnd && i < n; i++) {
    const t = i / sr;
    const env = t < 0.08 ? t / 0.08 : t > speechSec - 0.08 ? Math.max(0, (speechSec - t) / 0.08) : 1.0;
    const mod = 0.65 + 0.35 * Math.sin(2 * Math.PI * 6.5 * t);
    out[i] = (0.55 * Math.sin(2 * Math.PI * baseHz * t) + 0.25 * Math.sin(2 * Math.PI * baseHz * 2.02 * t)) * env * mod * 0.5;
  }
  return out;
}

function makeBgmSamples(totalSec, sr = 48000) {
  const n = Math.round(totalSec * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (0.5 * Math.sin(2 * Math.PI * 130.81 * t) + 0.5 * Math.sin(2 * Math.PI * 196.0 * t)) * 0.12;
  }
  return out;
}

function verifyRenderedAudio(mp4Path, voS1Path) {
  const py = `
import json, re, subprocess, sys, wave, struct, math

mp4_p, vo_p = sys.argv[1], sys.argv[2]
probe = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=codec_type,codec_name,width,height,sample_rate,channels",
    "-of", "json", mp4_p
], text=True))

def read_mono(p):
    with wave.open(p, "rb") as w:
        raw = w.readframes(w.getnframes())
        vals = struct.unpack(f"<{len(raw)//2}h", raw)
        return [v / 32768.0 for v in vals]

tmp_mp4_wav = mp4_p + ".check.wav"
subprocess.check_call([
    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
    "-i", mp4_p, "-t", "2.0", "-ar", "24000", "-ac", "1", tmp_mp4_wav
])
mp4_s = read_mono(tmp_mp4_wav)
vo_s = read_mono(vo_p)
n = min(len(mp4_s), len(vo_s), 24000 * 2)
m1 = sum(mp4_s[:n]) / n
m2 = sum(vo_s[:n]) / n
num = sum((mp4_s[i] - m1) * (vo_s[i] - m2) for i in range(n))
den = math.sqrt(sum((mp4_s[i] - m1) ** 2 for i in range(n)) * sum((vo_s[i] - m2) ** 2 for i in range(n))) + 1e-12
corr_vo = num / den

def lufs_of(extra_args):
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", *extra_args, "-i", mp4_p, "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True
    ).stderr
    m = re.search(r"Integrated loudness:\\s*I:\\s*([-\\d.]+)\\s*LUFS", out)
    return float(m.group(1)) if m else None

overall_lufs = lufs_of([])
talk_lufs = lufs_of(["-ss", "0.2", "-t", "1.4"])
gap_lufs = lufs_of(["-ss", "2.15", "-t", "0.7"])

print(json.dumps({
    "streams": probe["streams"],
    "duration": float(probe["format"]["duration"]),
    "corrVo": round(corr_vo, 4),
    "overallLufs": overall_lufs,
    "talkLufs": talk_lufs,
    "gapLufs": gap_lufs,
}))
`;
  const res = spawnSync("python", ["-c", py, mp4Path, voS1Path], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `Audio verification failed: ${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout.trim());
}

async function main() {
  const stack = await startLiveStack({ startWeb: false });
  const t0 = Date.now();
  try {
    const projDir = path.join(stack.workspaceDir, "projects", "story-audio-sfx-e2e");
    fs.mkdirSync(path.join(projDir, "script"), { recursive: true });
    fs.mkdirSync(path.join(projDir, "audio"), { recursive: true });

    // Copy stickman skill scripts into the isolated project
    const skillScripts = path.join(REPO_ROOT, ".aetheria", "skills", "mg-stickman-story", "examples", "script");
    for (const f of fs.readdirSync(skillScripts)) {
      if (f.endsWith(".js")) {
        fs.copyFileSync(path.join(skillScripts, f), path.join(projDir, "script", f));
      }
    }

    // Write minimal StoryCore index.html
    fs.writeFileSync(
      path.join(projDir, "index.html"),
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Audio SFX E2E</title>
<style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:1080px;height:1920px;overflow:hidden;background:#FFF3E2}#stage,#stage canvas{width:1080px;height:1920px;display:block}</style>
<script src="/script/aetheria-motion.js"></script>
<script src="/script/story-core.js"></script>
<script src="/script/story-camera.js"></script>
<script src="/script/stickman-rig.js"></script>
<script src="/script/stickman-world.js"></script>
<script src="/script/stickman-overlay.js"></script>
<script src="/script/stickman-timeline.js"></script>
</head><body><div id="stage"><canvas id="stage-2d" width="1080" height="1920"></canvas></div>
<script>window.__filmMeta={title:"Audio SFX E2E",width:1080,height:1920,fps:30,duration:1,scenes:[]};window.renderAt=function(){};window.__ready=false;</script>
<script src="/script/story-runtime.js"></script></body></html>`,
    );

    // Shot 1: 3.0s total (2.0s speech + 1.0s silent BGM tail to measure ducking)
    // Shot 2: 2.0s comic recap (1.4s speech + 0.6s tail)
    const vo1Path = path.join(projDir, "audio", "s1.wav");
    const vo2Path = path.join(projDir, "audio", "s2.wav");
    writePcmWav(vo1Path, makeSpeechLikeSamples(2.0, 1.95, 24000, 210), 24000);
    writePcmWav(vo2Path, makeSpeechLikeSamples(1.4, 1.35, 24000, 245), 24000);
    writePcmWav(path.join(projDir, "audio", "bgm_s1.wav"), makeBgmSamples(3.0, 48000), 48000);
    writePcmWav(path.join(projDir, "audio", "bgm_s2.wav"), makeBgmSamples(2.0, 48000), 48000);

    fs.writeFileSync(
      path.join(projDir, "audio", "s1.words.json"),
      JSON.stringify({
        duration: 2.0,
        words: [
          { word: "Alarm", start: 0.05, end: 0.45 },
          { word: "rings", start: 0.5, end: 0.9 },
          { word: "now!", start: 1.0, end: 1.5 },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(projDir, "audio", "s2.words.json"),
      JSON.stringify({
        duration: 1.4,
        words: [
          { word: "Team", start: 0.05, end: 0.5 },
          { word: "wins!", start: 0.55, end: 1.2 },
        ],
      }),
    );

    fs.writeFileSync(
      path.join(projDir, "film.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          title: "Audio SFX E2E",
          width: 1080,
          height: 1920,
          fps: 30,
          audioMix: { musicMood: "cheerful", musicVolume: 0.16, duck: true, loudnorm: true },
          scenes: [
            { id: "s1", start: 0.0, duration: 3.0, audio: "audio/s1.wav", bgm: "audio/bgm_s1.wav", words: "audio/s1.words.json" },
            { id: "s2", start: 3.0, duration: 2.0, audio: "audio/s2.wav", bgm: "audio/bgm_s2.wav", words: "audio/s2.words.json" },
          ],
        },
        null,
        2,
      ),
    );

    // Flat-string `audio` + `words` in story.json (the exact schema that previously dropped VO!)
    fs.writeFileSync(
      path.join(projDir, "story.json"),
      JSON.stringify(
        {
          renderer: "2d-stickman-story",
          title: "Audio SFX E2E",
          canvas: { w: 1080, h: 1920, fps: 30 },
          actorsMap: { afro: "afro", nadia: "nadia" },
          captions: { enabled: true },
          shots: [
            {
              id: "s1",
              start: 0.0,
              duration: 3.0,
              audio: "audio/s1.wav",
              words: "audio/s1.words.json",
              stage: "bedroom",
              timeOfDay: "morning",
              alarm: true,
              caption: "Alarm rings now!",
              actors: [
                {
                  id: "afro",
                  x: -160,
                  pose: "surprised",
                  expr: "panic",
                  actions: [{ at: 0.4, emote: "exclaim", emoteDur: 1.0 }],
                },
              ],
              bubbles: [{ by: "afro", text: "Whoa!", at: 0.8, until: 2.2 }],
              camera: {
                initial: { size: "full", focus: "afro" },
                moves: [{ at: 0.35, kind: "punch", strength: 0.14 }],
              },
            },
            {
              id: "s2",
              start: 3.0,
              duration: 2.0,
              audio: "audio/s2.wav",
              words: "audio/s2.words.json",
              type: "comic",
              grid: [2, 1],
              transition: { kind: "whip", dir: "left", dur: 0.35 },
              caption: "Team wins!",
              panels: [
                { stage: "park", timeOfDay: "day", appear: 0.0, actors: [{ id: "afro", x: 0, pose: "cheer", expr: "laugh" }] },
                { stage: "study", timeOfDay: "day", appear: 0.25, actors: [{ id: "nadia", x: 0, pose: "cheer", expr: "happy" }] },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );

    // 1. Success path: render full 5s MP4
    const startRes = await fetch(
      `${stack.engineUrl}/api/render-media?directory=${encodeURIComponent(projDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
          "x-aetheria-workspace": stack.workspaceDir,
        },
        body: JSON.stringify({ outputName: "story-audio-sfx-e2e.mp4", codec: "h264" }),
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
        throw new Error(`Render failed: ${JSON.stringify(job)}\n${stack.engineLogs().slice(-2000)}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert.ok(doneJob, "Timed out waiting for story-audio-sfx render");
    const outMp4 = doneJob.outputPath || startJson.outputPath;
    assert.ok(outMp4 && fs.existsSync(outMp4), `Missing MP4: ${outMp4}`);

    const audioStats = verifyRenderedAudio(outMp4, vo1Path);
    const hasAudio = audioStats.streams.some((s) => s.codec_type === "audio");
    assert.ok(hasAudio, `Expected audio stream in MP4: ${JSON.stringify(audioStats)}`);
    assert.ok(
      audioStats.corrVo > 0.7,
      `Expected VO preserved in MP4 (corrVo > 0.70), got ${audioStats.corrVo}`,
    );
    assert.ok(
      audioStats.overallLufs !== null && audioStats.overallLufs >= -20 && audioStats.overallLufs <= -12,
      `Expected loudnorm around -16 LUFS, got ${audioStats.overallLufs}`,
    );
    assert.ok(
      audioStats.talkLufs !== null && audioStats.gapLufs !== null && audioStats.talkLufs - audioStats.gapLufs >= 8.0,
      `Expected BGM ducking contrast >= 8 dB (talk=${audioStats.talkLufs}, gap=${audioStats.gapLufs})`,
    );

    const engLog = stack.engineLogs();
    assert.match(
      engLog,
      /Synthesized runtime SFX track from window\.__audioEvents/,
      `Expected engine log to confirm runtime SFX synthesis from window.__audioEvents`,
    );

    // 2. Failure path: path traversal must fail cleanly with HTTP 400
    const badRes = await fetch(
      `${stack.engineUrl}/api/render-media?directory=${encodeURIComponent(projDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
          "x-aetheria-workspace": stack.workspaceDir,
        },
        body: JSON.stringify({ outputName: "../escape-sfx.mp4", codec: "h264" }),
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

    console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - t0, audioStats }));
  } finally {
    await stack.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
