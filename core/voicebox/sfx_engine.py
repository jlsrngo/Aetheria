"""
Smart SFX Engine for Aetheria Nexus.
Synthesizes and intelligently schedules context-aware sound effects (SFX)
without prompt bloat or auditory clutter.
"""

import json
import math
import struct
import wave
from pathlib import Path
from typing import Dict, List, Any, Optional

SAMPLE_RATE = 48000

# Sound generator DSP definitions (Pure Python wave synthesis - zero dependencies)
def generate_sine_blip(freq_start: float, freq_end: float, duration: float, decay_rate: float, volume: float = 0.5) -> List[float]:
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    phase = 0.0
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        progress = i / max(1, num_samples - 1)
        freq = freq_start + (freq_end - freq_start) * progress
        phase += 2.0 * math.pi * freq / SAMPLE_RATE
        envelope = math.exp(-decay_rate * t) * volume
        sample = math.sin(phase) * envelope
        samples.append(sample)
    return samples

def generate_noise_sweep(duration: float, freq_start: float, freq_end: float, volume: float = 0.4) -> List[float]:
    import random
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    # Simple lowpass state
    lp_state = 0.0
    for i in range(num_samples):
        progress = i / max(1, num_samples - 1)
        # Cutoff sweep
        fc = freq_start + (freq_end - freq_start) * progress
        rc = 1.0 / (2.0 * math.pi * fc)
        dt = 1.0 / SAMPLE_RATE
        alpha = dt / (rc + dt)
        raw_noise = (random.random() * 2.0 - 1.0)
        lp_state += alpha * (raw_noise - lp_state)
        # Bell envelope
        envelope = math.sin(math.pi * progress) * volume
        samples.append(lp_state * envelope)
    return samples

def generate_chime(frequencies: List[float], duration: float, volume: float = 0.3) -> List[float]:
    num_samples = int(duration * SAMPLE_RATE)
    samples = [0.0] * num_samples
    for f in frequencies:
        phase = 0.0
        for i in range(num_samples):
            t = i / SAMPLE_RATE
            phase += 2.0 * math.pi * f / SAMPLE_RATE
            envelope = math.exp(-6.0 * t) * (volume / len(frequencies))
            samples[i] += math.sin(phase) * envelope
    return samples

def generate_sub_impact(duration: float = 0.45, volume: float = 0.6) -> List[float]:
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    phase = 0.0
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        freq = 150.0 * math.exp(-12.0 * t) + 42.0
        phase += 2.0 * math.pi * freq / SAMPLE_RATE
        envelope = math.exp(-5.0 * t) * volume
        sample = math.sin(phase) * envelope
        samples.append(sample)
    return samples

def write_wav(file_path: Path, samples: List[float]):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(file_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        int_samples = [max(-32767, min(32767, int(s * 32767.0))) for s in samples]
        raw = struct.pack(f"<{len(int_samples)}h", *int_samples)
        w.writeframes(raw)


MOOD_PRESETS: Dict[str, Dict[str, Any]] = {
    "cheerful": {"bpm": 122.0, "chords": [[261.63, 329.63, 392.00, 493.88], [293.66, 369.99, 440.00, 523.25], [329.63, 415.30, 493.88, 659.25], [261.63, 329.63, 392.00, 523.25]], "kick": 0.24},
    "chill": {"bpm": 88.0, "chords": [[174.61, 220.00, 261.63, 329.63], [164.81, 196.00, 246.94, 293.66], [146.83, 174.61, 220.00, 261.63], [130.81, 164.81, 196.00, 246.94]], "kick": 0.14},
    "tense": {"bpm": 105.0, "chords": [[110.00, 130.81, 164.81, 233.08], [103.83, 123.47, 155.56, 220.00], [98.00, 116.54, 146.83, 207.65], [110.00, 130.81, 155.56, 233.08]], "kick": 0.28},
    "comic": {"bpm": 132.0, "chords": [[261.63, 311.13, 392.00, 523.25], [293.66, 349.23, 440.00, 587.33], [246.94, 293.66, 392.00, 493.88], [261.63, 329.63, 392.00, 523.25]], "kick": 0.26},
    "sad": {"bpm": 76.0, "chords": [[130.81, 155.56, 196.00, 233.08], [116.54, 138.59, 174.61, 207.65], [103.83, 130.81, 155.56, 196.00], [98.00, 123.47, 146.83, 196.00]], "kick": 0.10},
    "epic": {"bpm": 116.0, "chords": [[110.00, 164.81, 220.00, 329.63], [130.81, 196.00, 261.63, 392.00], [146.83, 220.00, 293.66, 440.00], [123.47, 185.00, 246.94, 369.99]], "kick": 0.34},
    "study": {"bpm": 92.0, "chords": [[146.83, 174.61, 220.00, 261.63], [130.81, 164.81, 196.00, 246.94], [116.54, 146.83, 174.61, 220.00], [130.81, 164.81, 196.00, 261.63]], "kick": 0.16},
    "mystery": {"bpm": 96.0, "chords": [[123.47, 146.83, 185.00, 277.18], [116.54, 138.59, 174.61, 261.63], [110.00, 130.81, 164.81, 246.94], [123.47, 155.56, 185.00, 277.18]], "kick": 0.18},
    "warm": {"bpm": 100.0, "chords": [[174.61, 220.00, 261.63, 349.23], [196.00, 246.94, 293.66, 392.00], [164.81, 196.00, 246.94, 329.63], [146.83, 174.61, 220.00, 329.63]], "kick": 0.16},
}


def generate_showreel_bgm_track(
    file_path: Path,
    duration_sec: float,
    bpm: float = 120.0,
    scene_index: int = 0,
    scene_start_sec: float = 0.0,
    mood: Optional[str] = None,
) -> float:
    """Synthesizes a deterministic beat-locked studio chord pad + kick/tick groove without TTS."""
    preset = MOOD_PRESETS.get((mood or "").strip().lower())
    eff_bpm = float(bpm) if bpm else (preset["bpm"] if preset else 120.0)
    safe_bpm = min(175.0, max(70.0, eff_bpm))
    beat = 60.0 / safe_bpm
    safe_dur = max(0.35, float(duration_sec))
    num_samples = max(1, int(safe_dur * SAMPLE_RATE))
    buf = [0.0] * num_samples

    chords = (
        preset["chords"]
        if preset
        else [
            [130.81, 196.00, 246.94, 311.13],
            [116.54, 174.61, 220.00, 277.18],
            [155.56, 233.08, 293.66, 392.00],
            [174.61, 261.63, 311.13, 415.30],
        ]
    )
    chord = chords[scene_index % len(chords)]

    # Warm ambient pad with gentle fade in/out so cuts glue cleanly without clipping.
    attack = min(0.10, safe_dur * 0.15)
    release = min(0.18, safe_dur * 0.25)
    for f in chord:
        omega1 = 2.0 * math.pi * f / SAMPLE_RATE
        omega2 = 2.0 * math.pi * (f * 2.0) / SAMPLE_RATE
        scale = 0.14 / len(chord)
        for i in range(num_samples):
            lt = i / SAMPLE_RATE
            env = min(1.0, lt / max(0.001, attack)) * min(1.0, max(0.0, (safe_dur - lt) / max(0.001, release)))
            buf[i] += (math.sin(omega1 * i) + 0.22 * math.sin(omega2 * i)) * env * scale

    # Beat-locked low-end kick & subtle hi-hat tick aligned across global timeline.
    first_beat = math.ceil(max(0.0, scene_start_sec) / beat) * beat
    t_b = first_beat
    base_kick = float(preset["kick"]) if preset else 0.30
    while t_b < scene_start_sec + safe_dur - 0.05:
        lt = t_b - scene_start_sec
        if lt >= 0.0:
            i0 = int(lt * SAMPLE_RATE)
            n_k = int(0.17 * SAMPLE_RATE)
            phase = 0.0
            k_amp = base_kick if scene_index >= 1 else min(base_kick, 0.18)
            for k in range(n_k):
                idx = i0 + k
                if idx >= num_samples:
                    break
                kt = k / SAMPLE_RATE
                freq = 132.0 * math.exp(-22.0 * kt) + 46.0
                phase += 2.0 * math.pi * freq / SAMPLE_RATE
                buf[idx] += math.sin(phase) * math.exp(-13.0 * kt) * k_amp
            # Subtle upbeat tick at half beat
            ht = lt + beat * 0.5
            if ht + 0.04 < safe_dur:
                h0 = int(ht * SAMPLE_RATE)
                n_h = int(0.04 * SAMPLE_RATE)
                h_phase = 0.0
                for k in range(n_h):
                    idx = h0 + k
                    if idx >= num_samples:
                        break
                    kt = k / SAMPLE_RATE
                    hf = 2400.0 * math.exp(-16.0 * kt) + 340.0
                    h_phase += 2.0 * math.pi * hf / SAMPLE_RATE
                    buf[idx] += math.sin(h_phase) * math.exp(-72.0 * kt) * 0.09
        t_b += beat

    write_wav(file_path, buf)
    return round(num_samples / SAMPLE_RATE, 3)


def _read_wav_mono_normalized(wav_path: Path):
    """Reads a 16-bit PCM WAV into normalized mono float samples (-1..1) and sample rate."""
    with wave.open(str(wav_path), "rb") as w:
        ch = max(1, w.getnchannels())
        sw = w.getsampwidth()
        sr = max(1, w.getframerate())
        raw = w.readframes(w.getnframes())
    if sw != 2 or not raw:
        return [], sr, 0.0
    total_samples = len(raw) // (2 * ch)
    vals = struct.unpack(f"<{len(raw) // 2}h", raw)
    mono = []
    for i in range(total_samples):
        if ch == 1:
            mono.append(vals[i] / 32768.0)
        else:
            s = 0.0
            base = i * ch
            for c in range(ch):
                s += vals[base + c]
            mono.append(s / (ch * 32768.0))
    return mono, sr, len(mono) / float(sr)


def compute_wav_rms_levels(wav_path: Path, fps: int = 30) -> Dict[str, Any]:
    """Computes per-frame normalized RMS mouth-openness levels (0..1) from a WAV file."""
    safe_fps = max(1, int(fps or 30))
    mono, sr, dur = _read_wav_mono_normalized(wav_path)
    if not mono:
        return {"fps": safe_fps, "duration": 0.0, "levels": []}
    step = max(1, int(sr / safe_fps))
    raw_rms: List[float] = []
    for start in range(0, len(mono), step):
        chunk = mono[start : start + step]
        if not chunk:
            break
        sq = sum(x * x for x in chunk) / len(chunk)
        raw_rms.append(math.sqrt(sq))
    peak = max(raw_rms) if raw_rms else 1.0
    norm_div = max(peak, 0.04)
    levels = [round(min(1.0, max(0.0, (r - 0.01) / norm_div)), 3) for r in raw_rms]
    return {"fps": safe_fps, "duration": round(dur, 3), "levels": levels}


def align_words_from_wav(wav_path: Path, text: str) -> Dict[str, Any]:
    """Detects active speech spans via RMS energy and aligns words for subtitles/cues."""
    words = [w for w in str(text or "").strip().split() if w]
    mono, sr, dur = _read_wav_mono_normalized(wav_path)
    if not words:
        return {"duration": round(dur, 3), "words": []}
    win = max(1, int(sr * 0.02))  # 20ms analysis frames
    energies: List[float] = []
    for start in range(0, len(mono), win):
        chunk = mono[start : start + win]
        if chunk:
            energies.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)))
    peak = max(energies) if energies else 0.0
    thresh = max(0.015, peak * 0.14)
    active_spans: List[tuple] = []
    in_seg = False
    seg_s = 0.0
    for i, e in enumerate(energies):
        t = (i * win) / float(sr)
        if e >= thresh and not in_seg:
            in_seg = True
            seg_s = t
        elif e < thresh and in_seg:
            in_seg = False
            if t - seg_s >= 0.08:
                active_spans.append((seg_s, t))
    if in_seg and dur - seg_s >= 0.08:
        active_spans.append((seg_s, dur))
    if not active_spans:
        active_spans = [(0.0, max(0.25, dur))]

    total_active = sum(max(0.05, b - a) for a, b in active_spans)
    total_chars = max(1, sum(len(w) for w in words))
    out_words = []
    span_idx = 0
    cursor = active_spans[0][0]
    for w in words:
        w_dur = total_active * (max(1, len(w)) / float(total_chars))
        while span_idx < len(active_spans) - 1 and cursor >= active_spans[span_idx][1]:
            span_idx += 1
            cursor = active_spans[span_idx][0]
        s_t = cursor
        e_t = min(dur, s_t + max(0.06, w_dur))
        out_words.append({"word": w, "start": round(s_t, 3), "end": round(e_t, 3)})
        cursor = s_t + w_dur
    return {"duration": round(dur, 3), "words": out_words}

def ensure_soundbank(sfx_dir: Path):
    """Generates the studio soundbank files in both sfx_dir and its parent public dir."""
    sfx_dir.mkdir(parents=True, exist_ok=True)
    parent_dir = sfx_dir.parent
    files = {
        "sfx_typewriter.wav": lambda: generate_sine_blip(2200, 1600, 0.035, 120.0, 0.24),
        "sfx_pop.wav": lambda: generate_sine_blip(950, 480, 0.075, 45.0, 0.42),
        "sfx_whoosh.wav": lambda: generate_noise_sweep(0.380, 400, 4500, 0.38),
        "sfx_impact.wav": lambda: generate_sub_impact(0.450, 0.65),
        "sfx_chime.wav": lambda: generate_chime([1046.5, 1318.5, 1567.98], 0.35, 0.36),
        "sfx_riser.wav": lambda: generate_noise_sweep(0.750, 250, 6000, 0.36),
    }
    for name, gen_fn in files.items():
        target = sfx_dir / name
        samples = None
        if not target.exists() or target.stat().st_size < 100:
            samples = gen_fn()
            write_wav(target, samples)
        # Also ensure top-level workspace/public/sfx_*.wav exists so staticFile("sfx_whoosh.wav") works directly
        flat_target = parent_dir / name
        if not flat_target.exists() or flat_target.stat().st_size < 100:
            if samples is None:
                samples = gen_fn()
            write_wav(flat_target, samples)

class SmartSfxScheduler:
    """
    Intelligently maps video scene events to sound effects.
    Implements density guard to avoid cluttered audio.
    """

    DEFAULT_RULES = {
        "scene_transition": {"type": "whoosh", "lead_frames": 2, "volume": 0.22},
        "headline_entrance": {"type": "pop", "lead_frames": 1, "volume": 0.20},
        "badge_in": {"type": "pop", "lead_frames": 1, "volume": 0.18},
        "stat_highlight": {"type": "chime", "lead_frames": 0, "volume": 0.24},
        "dramatic_climax": {"type": "impact", "lead_frames": 0, "volume": 0.32},
        "call_to_action": {"type": "chime", "lead_frames": 0, "volume": 0.22},
        "caption_phrase": {"type": "typewriter", "lead_frames": 0, "volume": 0.12},
    }

    @classmethod
    def generate_cues_for_scenes(cls, scenes: List[Dict[str, Any]], fps: int = 30) -> List[Dict[str, Any]]:
        cues = []
        current_frame = 0

        for idx, scene in enumerate(scenes):
            duration_frames = int(scene.get("duration", 4.0) * fps)
            scene_type = scene.get("type", "normal").lower()

            # 1. Scene Entrance (Whoosh) - except frame 0 to keep intro clean
            if idx > 0:
                cues.append({
                    "type": "whoosh",
                    "file": "sfx/minimal/swipe.mp3",
                    "frame": max(0, current_frame - 2),
                    "volume": 0.22
                })

            # 2. Key Headline / Card Pop
            headline_offset = scene.get("headlineFrame", 6)
            cues.append({
                "type": "pop",
                "file": "sfx/minimal/pop.mp3",
                "frame": current_frame + headline_offset,
                "volume": 0.20
            })

            # 3. Contextual Highlights based on scene semantic role
            if "stat" in scene_type or "proof" in scene_type or scene.get("hasStat"):
                cues.append({
                    "type": "chime",
                    "file": "sfx/glass/complete.mp3",
                    "frame": current_frame + int(duration_frames * 0.35),
                    "volume": 0.24
                })
            elif "climax" in scene_type or "twist" in scene_type or scene.get("isClimax"):
                cues.append({
                    "type": "impact",
                    "file": "sfx/cinematic/complete.mp3",
                    "frame": current_frame + int(duration_frames * 0.25),
                    "volume": 0.32
                })
            elif "cta" in scene_type or "end" in scene_type or idx == len(scenes) - 1:
                cues.append({
                    "type": "chime",
                    "file": "sfx/arcade/badge.mp3",
                    "frame": current_frame + int(duration_frames * 0.30),
                    "volume": 0.22
                })

            current_frame += duration_frames

        # Apply Density Guard: Ensure no two loud cues occur within 6 frames (~200ms)
        cues.sort(key=lambda x: x["frame"])
        filtered_cues = []
        last_frame = -999
        for c in cues:
            if c["frame"] - last_frame >= 6 or c["type"] == "impact":
                filtered_cues.append(c)
                last_frame = c["frame"]

        return filtered_cues

if __name__ == "__main__":
    import sys
    # When run directly, ensure soundbank in workspace/public/sfx
    project_root = Path(__file__).resolve().parent.parent.parent
    ensure_soundbank(project_root / "workspace" / "public" / "sfx")
    ensure_soundbank(project_root / "public" / "sfx")
    ensure_soundbank(project_root / "apps" / "public" / "sfx")
    print(json.dumps({"status": "ok", "soundbank": "synced"}))
