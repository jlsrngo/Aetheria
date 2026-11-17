#!/usr/bin/env python3
"""
F2-0 Measurement Script (Measure Before Guessing — T11 & T12).

1. T12 (Word timing sync vs final WAV RMS onsets):
   Synthesizes 3 fixed narrations per available engine (`edge`, `kokoro`, `voxcpm`),
   records only engines that actually ran without falling back, and compares
   `.words.json` word `start` timestamps against final WAV RMS onsets.

2. T11 (Export overlap when scene.duration < WAV duration):
   Creates a temporary 2-scene project (`scene1` = 1.0s duration with 3.2s 440Hz WAV;
   `scene2` = 2.0s duration starting at 1.0s with 2.0s 880Hz WAV), exports MP4 via the
   real `aetheria-engine` `/api/render-media` pipeline, extracts the muxed audio stream,
   and measures 440Hz vs 880Hz FFT energy inside Scene 2 `[1.2s, 2.8s]`.
"""

import json
import math
import os
import pathlib
import secrets
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
import struct

import numpy as np
import soundfile as sf

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
VOICEBOX_PY = REPO_ROOT / "core" / "voicebox" / "voicebox_engine.py"
OUT_JSON = REPO_ROOT / "scripts" / "out" / "f2-0-baseline.json"

TEST_NARRATIONS_ID = [
    "Halo semuanya, mari kita lihat animasi pertama sekarang juga.",
    "Fakta pertama sangat mengejutkan. ... Tunggu sebentar, lihat perubahan angkanya sekarang.",
    "Pada tahun dua ribu dua puluh lima, kecepatan naik dua ratus persen.",
]

TEST_NARRATIONS_EN = [
    "Hello everyone, let us watch the first animation right now.",
    "First fact is quite surprising. ... Wait a moment, see the numbers change.",
    "In twenty twenty five, render speed jumped two hundred percent.",
]


def percentile(values, p):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(s[int(k)])
    return float(s[f] * (c - k) + s[c] * (k - f))


def analyze_wav_onsets(wav_path: pathlib.Path):
    data, sr = sf.read(str(wav_path))
    data = np.asarray(data, dtype=np.float32)
    if data.ndim > 1:
        data = np.mean(data, axis=1)
    duration_sec = len(data) / float(sr)

    hop = max(1, int(sr * 0.005))  # 5ms resolution
    win = max(1, int(sr * 0.020))  # 20ms RMS window
    n_frames = max(0, (len(data) - win) // hop + 1)
    rms = np.empty(n_frames, dtype=np.float32)
    for i in range(n_frames):
        seg = data[i * hop : i * hop + win]
        rms[i] = float(np.sqrt(np.mean(seg * seg)))

    peak = float(np.max(rms)) if len(rms) > 0 else 0.0
    thresh = max(0.004, peak * 0.05)
    voiced = rms >= thresh

    # Group contiguous voiced frames (bridging micro-dips <= 60ms = 12 hops)
    raw_islands = []
    in_island = False
    start_idx = 0
    for idx, v in enumerate(voiced):
        if v and not in_island:
            in_island = True
            start_idx = idx
        elif not v and in_island:
            raw_islands.append([start_idx, idx])
            in_island = False
    if in_island:
        raw_islands.append([start_idx, len(voiced)])

    merged_islands = []
    bridge_hops = int(0.080 / 0.005)
    for isl in raw_islands:
        if merged_islands and isl[0] - merged_islands[-1][1] <= bridge_hops:
            merged_islands[-1][1] = isl[1]
        else:
            merged_islands.append(isl)

    island_onsets_sec = [i[0] * 0.005 for i in merged_islands]
    island_offsets_sec = [i[1] * 0.005 for i in merged_islands]

    # Significant local RMS rises (threshold crossings or >= 2x jump from recent floor)
    rise_onsets_sec = []
    for i in range(4, len(rms)):
        local_min = float(np.min(rms[i - 4 : i]))
        cross_thresh = (not voiced[i - 1]) and voiced[i]
        energy_surge = voiced[i] and (rms[i] > max(thresh * 1.5, local_min * 2.2)) and (rms[i] > rms[i - 1] * 1.25)
        if cross_thresh or energy_surge:
            t_sec = i * 0.005
            if not rise_onsets_sec or (t_sec - rise_onsets_sec[-1]) >= 0.060:
                rise_onsets_sec.append(t_sec)

    return {
        "duration_sec": duration_sec,
        "sr": sr,
        "peak_rms": peak,
        "thresh": thresh,
        "rms": rms,
        "voiced": voiced,
        "island_onsets_sec": island_onsets_sec,
        "island_offsets_sec": island_offsets_sec,
        "rise_onsets_sec": rise_onsets_sec,
    }


def evaluate_word_sync(words_json_path: pathlib.Path, wav_path: pathlib.Path):
    with open(words_json_path, "r", encoding="utf-8") as f:
        wdoc = json.load(f)
    words = wdoc.get("words") or []
    wav_info = analyze_wav_onsets(wav_path)
    island_onsets = wav_info["island_onsets_sec"]
    rise_onsets = wav_info["rise_onsets_sec"]
    rms = wav_info["rms"]
    thresh = wav_info["thresh"]

    if not words:
        return {"word_count": 0, "error": "no words"}

    first_word_signed_ms = (
        (words[0]["start"] - island_onsets[0]) * 1000.0 if island_onsets else None
    )

    # Unambiguous words: word[0] + words separated by a >= 150ms silence gap in words.json
    post_pause_errors_ms = []
    if island_onsets:
        word_group_starts = [words[0]["start"]]
        for i in range(1, len(words)):
            gap = words[i]["start"] - words[i - 1]["end"]
            if gap >= 0.150:
                word_group_starts.append(words[i]["start"])
        for ws in word_group_starts:
            nearest_isl = min(island_onsets, key=lambda o: abs(o - ws))
            post_pause_errors_ms.append(abs(ws - nearest_isl) * 1000.0)

    # All words vs nearest detected local RMS rise onset
    all_word_errors_ms = []
    silent_starts = 0
    for w in words:
        ws = float(w.get("start", 0.0))
        if rise_onsets:
            nearest_rise = min(rise_onsets, key=lambda o: abs(o - ws))
            all_word_errors_ms.append(abs(ws - nearest_rise) * 1000.0)
        hop_idx = min(len(rms) - 1, max(0, int(round(ws / 0.005))))
        if len(rms) > 0 and rms[hop_idx] < thresh:
            silent_starts += 1

    dur_diff_ms = (wav_info["duration_sec"] - float(words[-1]["end"])) * 1000.0
    return {
        "wav_duration": round(wav_info["duration_sec"], 3),
        "words_json_duration": wdoc.get("duration"),
        "word_count": len(words),
        "first_word_signed_err_ms": round(first_word_signed_ms, 1) if first_word_signed_ms is not None else None,
        "last_word_to_wav_end_ms": round(dur_diff_ms, 1),
        "silent_start_pct": round(100.0 * silent_starts / len(words), 1),
        "post_pause_errors_ms": [round(x, 1) for x in post_pause_errors_ms],
        "all_word_errors_ms": [round(x, 1) for x in all_word_errors_ms],
    }


def run_voicebox_sample(text: str, out_wav: pathlib.Path, engine: str, lang: str, voice: str):
    cmd = [
        sys.executable,
        str(VOICEBOX_PY),
        "--text",
        text,
        "--out",
        str(out_wav),
        "--lang",
        lang,
        "--voice",
        voice,
        "--engine",
        engine,
        "--reset-voice-lock",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    if proc.returncode != 0:
        return {"ok": False, "error": f"exit={proc.returncode} {stderr.strip() or stdout.strip()}"}
    idx = stdout.rfind("{")
    if idx == -1:
        return {"ok": False, "error": f"No JSON output: {stdout}"}
    try:
        parsed = json.loads(stdout[idx:])
        parsed["ok"] = True
        return parsed
    except Exception as e:
        return {"ok": False, "error": f"JSON parse error: {e}"}


def measure_t12_engines(work_dir: pathlib.Path):
    results = {}
    specs = [
        ("edge-neural", "edge", "id", "id-ID-ArdiNeural", TEST_NARRATIONS_ID),
        ("kokoro", "kokoro", "en", "af_heart", TEST_NARRATIONS_EN),
        ("voxcpm2", "voxcpm", "id", "aetheria", TEST_NARRATIONS_ID),
    ]

    for label, cli_engine, lang, voice, texts in specs:
        eng_dir = work_dir / label
        eng_dir.mkdir(parents=True, exist_ok=True)
        samples = []
        unavailable_reason = None

        for i, text in enumerate(texts):
            out_wav = eng_dir / f"sample_{i + 1}.wav"
            try:
                res = run_voicebox_sample(text, out_wav, cli_engine, lang, voice)
            except Exception as e:
                unavailable_reason = str(e)
                break

            if not res.get("ok"):
                unavailable_reason = res.get("error", "execution failed")
                break

            actual_engine = res.get("engine")
            fallback = res.get("fallback_reason")
            if actual_engine != label:
                unavailable_reason = (
                    f"requested {label} fell back to {actual_engine}"
                    + (f" ({fallback})" if fallback else "")
                )
                break

            words_path = out_wav.with_suffix(".words.json")
            if not out_wav.is_file() or not words_path.is_file():
                unavailable_reason = "missing WAV or words.json output"
                break

            metrics = evaluate_word_sync(words_path, out_wav)
            samples.append(metrics)

        if unavailable_reason:
            results[label] = {
                "status": "tidak terverifikasi",
                "reason": unavailable_reason,
            }
        else:
            all_err = [e for s in samples for e in s["all_word_errors_ms"]]
            pause_err = [e for s in samples for e in s["post_pause_errors_ms"]]
            first_signed = [s["first_word_signed_err_ms"] for s in samples if s["first_word_signed_err_ms"] is not None]
            results[label] = {
                "status": "measured",
                "sample_count": len(samples),
                "total_words": sum(s["word_count"] for s in samples),
                "all_words_median_err_ms": round(statistics.median(all_err), 1) if all_err else None,
                "all_words_p95_err_ms": round(percentile(all_err, 95), 1) if all_err else None,
                "post_pause_median_err_ms": round(statistics.median(pause_err), 1) if pause_err else None,
                "post_pause_p95_err_ms": round(percentile(pause_err, 95), 1) if pause_err else None,
                "first_word_signed_err_ms": first_signed,
                "samples": samples,
            }
    return results


def resolve_engine_binary():
    exe = "aetheria-engine.exe" if os.name == "nt" else "aetheria-engine"
    cands = [
        REPO_ROOT / "target" / "debug" / exe,
        REPO_ROOT / "target" / "release" / exe,
    ]
    cands = [p for p in cands if p.is_file()]
    if not cands:
        raise RuntimeError("Engine binary not built")
    cands.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return cands[0]


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def write_sine_wav(path: pathlib.Path, freq_hz: float, duration_sec: float, sr: int = 48000, amp: float = 0.45):
    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(sr * duration_sec)
    t = np.arange(n, dtype=np.float64) / sr
    samples = amp * np.sin(2.0 * math.pi * freq_hz * t)
    int16 = np.clip(samples * 32767.0, -32767, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(int16.tobytes())


def http_json(url, method="GET", headers=None, body=None, timeout=15):
    req_headers = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def band_mag_hz(signal: np.ndarray, sr: int, target_hz: float) -> float:
    n = len(signal)
    if n == 0:
        return 0.0
    win = signal * np.hanning(n)
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    spec = np.abs(np.fft.rfft(win)) / (n * 0.5)
    mask = np.abs(freqs - target_hz) <= 12.0
    return float(np.max(spec[mask])) if np.any(mask) else 0.0


def resolve_ffmpeg_binary():
    explicit = os.environ.get("AETHERIA_FFMPEG", "").strip()
    if explicit and pathlib.Path(explicit).is_file():
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    bin_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    candidates = [
        pathlib.Path.home() / ".aetheria" / "bin" / bin_name,
        REPO_ROOT / "bin" / bin_name,
        REPO_ROOT / bin_name,
        pathlib.Path.home() / "scoop" / "shims" / bin_name,
        pathlib.Path("C:/ffmpeg/bin") / bin_name,
    ]
    local_app = os.environ.get("LOCALAPPDATA")
    if local_app:
        local = pathlib.Path(local_app)
        candidates.append(local / "Microsoft" / "WinGet" / "Links" / bin_name)
        winget_dir = local / "Microsoft" / "WinGet" / "Packages"
        if winget_dir.is_dir():
            for pkg in winget_dir.iterdir():
                if "ffmpeg" in pkg.name.lower():
                    candidates.append(pkg / "bin" / bin_name)
                    if pkg.is_dir():
                        for sub in pkg.iterdir():
                            candidates.append(sub / "bin" / bin_name)
        npx_cache = local / "npm-cache" / "_npx"
        if npx_cache.is_dir():
            candidates.extend(npx_cache.glob("*/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"))
        capcut_apps = local / "CapCut" / "Apps"
        if capcut_apps.is_dir():
            candidates.extend(capcut_apps.glob(f"*/{bin_name}"))
        candidates.append(local / "Programs" / "ffmpeg" / "bin" / bin_name)
    for pf in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(pf)
        if base:
            candidates.append(pathlib.Path(base) / "ffmpeg" / "bin" / bin_name)
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def measure_t11_overlap(work_dir: pathlib.Path):
    ws = work_dir / "t11_ws"
    proj = ws / "projects" / "t11-overlap"
    audio_dir = proj / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    (ws / ".aetheria").mkdir(parents=True, exist_ok=True)
    (ws / ".aetheria" / "active-project.json").write_text(
        json.dumps({"project": "t11-overlap"}), encoding="utf-8"
    )

    # Scene 1 audio: 3.2s continuous 440 Hz tone, while scene1 duration = 1.0s (2.2s shorter!)
    # Scene 2 audio: 2.0s continuous 880 Hz tone, scene2 duration = 2.0s (starts at t = 1.0s)
    write_sine_wav(audio_dir / "scene1.wav", 440.0, 3.2, amp=0.45)
    write_sine_wav(audio_dir / "scene2.wav", 880.0, 2.0, amp=0.45)

    html = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>T11 Overlap Test</title>
<style>html,body{margin:0;padding:0;width:640px;height:360px;overflow:hidden;background:#111}canvas{display:block;width:640px;height:360px}</style>
</head>
<body>
<canvas id="c" width="640" height="360"></canvas>
<script>
var SCENES = [
  { id: "scene1", start: 0.0, duration: 1.0, audio: "audio/scene1.wav" },
  { id: "scene2", start: 1.0, duration: 2.0, audio: "audio/scene2.wav" }
];
window.__filmMeta = { title: "T11 Overlap", width: 640, height: 360, fps: 10, duration: 3.0, scenes: SCENES };
window.renderAt = function(t) {
  var c = document.getElementById("c").getContext("2d");
  c.fillStyle = t < 1.0 ? "#f59e0b" : "#06b6d4";
  c.fillRect(0, 0, 640, 360);
};
window.renderAt(0);
window.__ready = true;
</script>
</body>
</html>
"""
    (proj / "index.html").write_text(html, encoding="utf-8")

    engine_bin = resolve_engine_binary()
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    password = secrets.token_hex(12)
    import base64
    auth = "Basic " + base64.b64encode(f"aetheria:{password}".encode()).decode()
    headers = {"Authorization": auth}
    env = dict(os.environ)
    env["AETHERIA_SERVER_USERNAME"] = "aetheria"
    env["AETHERIA_SERVER_PASSWORD"] = password
    env["AETHERIA_WORKSPACE"] = str(ws)

    log_path = work_dir / "engine_t11.log"
    log_f = open(log_path, "wb")
    proc = subprocess.Popen(
        [str(engine_bin), "serve", "--port", str(port), "--hostname", "127.0.0.1"],
        cwd=str(ws),
        env=env,
        stdout=log_f,
        stderr=log_f,
    )
    try:
        healthy = False
        for _ in range(60):
            time.sleep(0.25)
            try:
                h = http_json(f"{base_url}/api/health", headers=headers)
                if h.get("healthy") or h.get("data", {}).get("healthy"):
                    healthy = True
                    break
            except Exception:
                pass
        if not healthy:
            return {"status": "tidak terverifikasi", "reason": "engine health check timed out"}

        dir_q = f"directory={urllib.parse.quote(str(ws))}"
        start_res = http_json(
            f"{base_url}/api/render-media?{dir_q}",
            method="POST",
            headers=headers,
            body={"compositionId": "HtmlMotionFilm", "outputName": "t11_overlap.mp4"},
        )
        rid = start_res.get("renderId")
        if not rid:
            return {"status": "tidak terverifikasi", "reason": f"missing renderId: {start_res}"}

        deadline = time.time() + 180
        final_job = None
        while time.time() < deadline:
            time.sleep(0.5)
            prog = http_json(f"{base_url}/api/render-progress?renderId={urllib.parse.quote(rid)}", headers=headers)
            st = prog.get("status")
            if st in ("done", "completed", "error"):
                final_job = prog
                break
        if not final_job or final_job.get("status") == "error":
            return {"status": "tidak terverifikasi", "reason": f"render failed: {final_job}"}

        mp4_path = pathlib.Path(final_job["outputPath"])
        extracted_wav = work_dir / "t11_extracted.wav"
        ffmpeg_bin = resolve_ffmpeg_binary()
        if not ffmpeg_bin:
            return {"status": "tidak terverifikasi", "reason": "ffmpeg binary not found"}
        subprocess.run(
            [ffmpeg_bin, "-y", "-i", str(mp4_path), "-vn", "-ac", "1", "-ar", "48000", str(extracted_wav)],
            check=True,
            capture_output=True,
        )

        audio, sr = sf.read(str(extracted_wav))
        audio = np.asarray(audio, dtype=np.float32)
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)

        win1 = audio[int(0.2 * sr) : int(0.8 * sr)]
        win2 = audio[int(1.2 * sr) : int(2.8 * sr)]
        s1_440 = band_mag_hz(win1, sr, 440.0)
        s1_880 = band_mag_hz(win1, sr, 880.0)
        s2_440 = band_mag_hz(win2, sr, 440.0)
        s2_880 = band_mag_hz(win2, sr, 880.0)

        overlap_detected = (s2_440 > 0.05) and (s2_880 > 0.05)
        return {
            "status": "measured",
            "scene1_duration_sec": 1.0,
            "scene1_wav_sec": 3.2,
            "scene2_start_sec": 1.0,
            "window_scene1_0.2_0.8s": {"mag_440hz": round(s1_440, 4), "mag_880hz": round(s1_880, 4)},
            "window_scene2_1.2_2.8s": {"mag_440hz_spillover": round(s2_440, 4), "mag_880hz_expected": round(s2_880, 4)},
            "overlap_detected": bool(overlap_detected),
        }
    finally:
        proc.kill()
        proc.wait(timeout=5)
        log_f.close()


def main():
    t11_only = "--t11-only" in sys.argv
    tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix="aetheria-f2-0-"))
    try:
        if t11_only and OUT_JSON.is_file():
            existing = json.loads(OUT_JSON.read_text(encoding="utf-8"))
            t12 = existing.get("t12_word_timing_sync", {})
        else:
            t12 = measure_t12_engines(tmp_dir)
        t11 = measure_t11_overlap(tmp_dir)
        report = {
            "t12_word_timing_sync": t12,
            "t11_export_overlap": t11,
        }
        OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        OUT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
