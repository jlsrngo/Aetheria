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


# Shared Engine SFX Catalog (usable by all skills via window.__audioEvents or film_audio sfxCues)
SFX_CATALOG_ALIASES: Dict[str, str] = {
    "pop": "pop",
    "tick": "tick",
    "tik": "tick",
    "typewriter": "tick",
    "click": "tick",
    "ding": "ding",
    "chime": "ding",
    "bell": "ding",
    "question": "question",
    "tanya": "question",
    "sparkle": "sparkle",
    "kilau": "sparkle",
    "star": "sparkle",
    "heart": "sparkle",
    "idea": "sparkle",
    "zzz": "zzz",
    "sleep": "zzz",
    "boing": "boing",
    "hop": "boing",
    "jump": "boing",
    "footstep": "footstep",
    "langkah": "footstep",
    "step": "footstep",
    "step_a": "footstep",
    "whoosh": "whoosh",
    "swipe": "whoosh",
    "whip": "whoosh",
    "soft-whoosh": "soft-whoosh",
    "soft_whoosh": "soft-whoosh",
    "whoosh_lembut": "soft-whoosh",
    "thud": "thud",
    "impact": "thud",
    "hit": "thud",
    "punch": "thud",
    "burst": "burst",
    "seru": "burst",
    "exclaim": "burst",
    "alarm": "alarm",
    "flash": "flash",
    "kilat": "flash",
    "iris": "iris",
    "riser": "riser",
    "fold": "fold",
    "lipat": "fold",
    "paper": "fold",
    "kertas": "fold",
    "door": "door",
    "pintu": "door",
    "notif": "notif",
    "notification": "notif",
}

SFX_CATALOG_NAMES: List[str] = sorted(set(SFX_CATALOG_ALIASES.values()))


def normalize_sfx_kind(raw_kind: str) -> str:
    key = str(raw_kind or "pop").strip().lower()
    if key in SFX_CATALOG_ALIASES:
        return SFX_CATALOG_ALIASES[key]
    for alias, canon in SFX_CATALOG_ALIASES.items():
        if alias in key:
            return canon
    return "pop"


def _sfx_env(i: int, sr: int, attack: float = 0.004, decay: float = 0.3) -> float:
    t = i / float(sr)
    return min(1.0, t / max(1e-5, attack)) * math.exp(-t / max(1e-5, decay))


def _sfx_sweep(f0: float, f1: float, dur: float, attack: float = 0.004, decay: Optional[float] = None) -> List[float]:
    n = max(1, int(dur * SAMPLE_RATE))
    dec = decay if decay is not None else max(0.01, dur / 3.0)
    out = [0.0] * n
    phase = 0.0
    denom = float(max(1, n - 1))
    for i in range(n):
        f = f0 + (f1 - f0) * (i / denom)
        phase += 2.0 * math.pi * f / SAMPLE_RATE
        out[i] = math.sin(phase) * _sfx_env(i, SAMPLE_RATE, attack, dec)
    return out


def _sfx_noise(n: int, seed: int, smooth_k: int) -> List[float]:
    import random
    rng = random.Random(seed)
    raw = [rng.uniform(-1.0, 1.0) for _ in range(n)]
    if smooth_k <= 1:
        return raw
    # Fast moving-average lowpass for crisp organic air/whoosh texture
    out = [0.0] * n
    acc = 0.0
    for i in range(n):
        acc += raw[i]
        if i >= smooth_k:
            acc -= raw[i - smooth_k]
        out[i] = acc / float(min(i + 1, smooth_k))
    return out


def _load_custom_foley_sample(kind: str) -> Optional[List[float]]:
    """Loads an optional recorded WAV foley sample from `.aetheria/sfx-samples/<kind>.wav`."""
    try:
        repo_root = Path(__file__).resolve().parent.parent.parent
        sample_path = repo_root / ".aetheria" / "sfx-samples" / f"{kind}.wav"
        if not sample_path.is_file():
            return None
        with wave.open(str(sample_path), "rb") as wf:
            n_ch = wf.getnchannels()
            sw = wf.getsampwidth()
            sr = wf.getframerate()
            n_fr = wf.getnframes()
            if sw != 2 or sr <= 0 or n_fr <= 0:
                return None
            raw = wf.readframes(n_fr)
        total_ints = len(raw) // 2
        ints = struct.unpack(f"<{total_ints}h", raw)
        mono = [
            sum(ints[i + c] for c in range(n_ch)) / (32768.0 * n_ch)
            for i in range(0, total_ints - n_ch + 1, n_ch)
        ]
        if sr == SAMPLE_RATE or not mono:
            return mono
        out_len = max(1, int(round(len(mono) * SAMPLE_RATE / float(sr))))
        ratio = (len(mono) - 1) / float(max(1, out_len - 1))
        resampled = []
        for i in range(out_len):
            pos = i * ratio
            lo = int(pos)
            hi = min(len(mono) - 1, lo + 1)
            frac = pos - lo
            resampled.append(mono[lo] * (1.0 - frac) + mono[hi] * frac)
        return resampled
    except Exception:
        return None


def _bandpass_noise(n: int, seed: int, f_low: float, f_high: float) -> List[float]:
    """Two-pole resonant-feel bandpass filtered noise for organic cinematic whoosh/foley texture."""
    import random
    rng = random.Random(seed)
    out = [0.0] * n
    lp = 0.0
    hp_prev_in = 0.0
    hp_prev_out = 0.0
    dt = 1.0 / float(SAMPLE_RATE)
    rc_hi = 1.0 / (2.0 * math.pi * max(40.0, f_high))
    rc_lo = 1.0 / (2.0 * math.pi * max(20.0, f_low))
    a_lp = dt / (rc_hi + dt)
    a_hp = rc_lo / (rc_lo + dt)
    for i in range(n):
        x = rng.uniform(-1.0, 1.0)
        lp += a_lp * (x - lp)
        hp = a_hp * (hp_prev_out + lp - hp_prev_in)
        hp_prev_in = lp
        hp_prev_out = hp
        out[i] = hp
    return out


def synthesize_sfx(raw_kind: str, volume: float = 1.0) -> List[float]:
    """Synthesizes a named SFX clip (optional WAV foley override, else layered cinematic DSP at 48kHz)."""
    kind = normalize_sfx_kind(raw_kind)
    vol = max(0.05, min(1.5, float(volume)))

    custom_sample = _load_custom_foley_sample(kind)
    if custom_sample:
        return [max(-0.98, min(0.98, s * vol)) for s in custom_sample]

    if kind == "pop":
        # Layered tactile bubble/marimba pop: pitch-curved body + 2nd harmonic + crisp 6ms transient click
        n = int(0.095 * SAMPLE_RATE)
        s_body = _sfx_sweep(460.0, 1680.0, 0.095, 0.0018, 0.028)
        s_harm = _sfx_sweep(920.0, 2600.0, 0.05, 0.001, 0.014)
        nz = _bandpass_noise(int(0.012 * SAMPLE_RATE), 31, 1200.0, 4800.0)
        base = [0.0] * n
        for i in range(n):
            v = s_body[i] * 0.68
            if i < len(s_harm):
                v += s_harm[i] * 0.22
            if i < len(nz):
                v += nz[i] * _sfx_env(i, SAMPLE_RATE, 0.0008, 0.004) * 0.35
            base[i] = math.tanh(v * 1.15)
    elif kind == "tick":
        # Crisp mechanical UI click: micro filtered transient + resonant wood-tick body
        n = int(0.040 * SAMPLE_RATE)
        s_click = _sfx_sweep(2650.0, 1450.0, 0.040, 0.0008, 0.010)
        nz = _bandpass_noise(n, 41, 1800.0, 6200.0)
        base = [
            math.tanh((s_click[i] * 0.42 + nz[i] * _sfx_env(i, SAMPLE_RATE, 0.0005, 0.006) * 0.45) * 1.1)
            for i in range(n)
        ]
    elif kind == "ding":
        # Warm glassy bell with slight detuned chorus overtones
        n = int(0.60 * SAMPLE_RATE)
        base = [
            (
                math.sin(2.0 * math.pi * 1318.5 * i / SAMPLE_RATE) * 0.50
                + math.sin(2.0 * math.pi * 1321.2 * i / SAMPLE_RATE) * 0.22
                + math.sin(2.0 * math.pi * 2637.0 * i / SAMPLE_RATE) * 0.24 * math.exp(-i / (0.14 * SAMPLE_RATE))
                + math.sin(2.0 * math.pi * 3633.0 * i / SAMPLE_RATE) * 0.10 * math.exp(-i / (0.07 * SAMPLE_RATE))
            )
            * _sfx_env(i, SAMPLE_RATE, 0.002, 0.20) * 0.55
            for i in range(n)
        ]
    elif kind == "question":
        s1 = _sfx_sweep(400.0, 520.0, 0.12, 0.004, 0.06)
        s2 = _sfx_sweep(520.0, 720.0, 0.20, 0.004, 0.09)
        base = [s * 0.52 for s in (s1 + s2)]
    elif kind == "sparkle":
        n = int(0.72 * SAMPLE_RATE)
        base = [0.0] * n
        notes = (1318.5, 1568.0, 2093.0, 2637.0)  # E6, G6, C7, E7 musicbox shimmer
        note_n = int(0.36 * SAMPLE_RATE)
        for ni, freq in enumerate(notes):
            off = int(ni * 0.068 * SAMPLE_RATE)
            for i in range(note_n):
                idx = off + i
                if idx >= n:
                    break
                t = i / float(SAMPLE_RATE)
                sig = (
                    math.sin(2.0 * math.pi * freq * t)
                    + 0.22 * math.sin(2.0 * math.pi * (freq * 1.003) * t)
                    + 0.35 * math.sin(2.0 * math.pi * 2.756 * freq * t) * math.exp(-t / 0.11)
                ) * _sfx_env(i, SAMPLE_RATE, 0.002, 0.17) * 0.30
                base[idx] += sig
    elif kind == "zzz":
        base = [s * 0.26 for s in _sfx_sweep(420.0, 240.0, 0.65, 0.05, 0.38)]
    elif kind == "boing":
        n = int(0.48 * SAMPLE_RATE)
        base = [0.0] * n
        phase = 0.0
        for i in range(n):
            t = i / float(SAMPLE_RATE)
            f = 180.0 + 260.0 * abs(math.sin(2.0 * math.pi * 3.2 * t)) * math.exp(-t / 0.25)
            phase += 2.0 * math.pi * f / SAMPLE_RATE
            base[i] = math.sin(phase) * _sfx_env(i, SAMPLE_RATE, 0.003, 0.22) * 0.52
    elif kind == "footstep":
        n = int(0.070 * SAMPLE_RATE)
        nz = _bandpass_noise(n, 11, 280.0, 1200.0)
        base = [
            math.tanh(
                (
                    math.sin(2.0 * math.pi * 130.0 * i / SAMPLE_RATE) * _sfx_env(i, SAMPLE_RATE, 0.001, 0.022)
                    + nz[i] * _sfx_env(i, SAMPLE_RATE, 0.001, 0.015) * 0.72
                ) * 0.44
            )
            for i in range(n)
        ]
    elif kind in ("whoosh", "soft-whoosh"):
        # 2-layer cinematic air whoosh: warm low-mid body + airy high-frequency swish with fast-peak envelope
        is_fast = kind == "whoosh"
        dur = 0.36 if is_fast else 0.56
        n = int(dur * SAMPLE_RATE)
        body = _bandpass_noise(n, 5 if is_fast else 17, 160.0, 880.0 if is_fast else 620.0)
        air = _bandpass_noise(n, 13 if is_fast else 29, 1300.0, 5200.0 if is_fast else 3400.0)
        gain = 1.45 if is_fast else 1.05
        base = []
        denom = float(max(1, n - 1))
        for i in range(n):
            p = i / denom
            # Asymmetric cinematic swell (peaks around p=0.38 then glides out cleanly)
            shaped = (p ** 0.72) if p < 0.38 else max(0.0, (1.0 - (p - 0.38) / 0.62) ** 1.45)
            env_w = math.sin(math.pi * min(1.0, p)) * (0.45 + 0.55 * shaped)
            v = (body[i] * 0.72 + air[i] * 0.48) * env_w * gain
            base.append(math.tanh(v))
    elif kind == "thud":
        # 3-layer cinematic impact: sub-bass drop + warm woody punch + crisp slap transient
        n = int(0.34 * SAMPLE_RATE)
        nz_snap = _bandpass_noise(n, 7, 650.0, 3400.0)
        base = [0.0] * n
        phase_sub = 0.0
        phase_mid = 0.0
        for i in range(n):
            t = i / float(SAMPLE_RATE)
            f_sub = 135.0 * math.exp(-14.0 * t) + 38.0
            f_mid = 250.0 * math.exp(-22.0 * t) + 88.0
            phase_sub += 2.0 * math.pi * f_sub / SAMPLE_RATE
            phase_mid += 2.0 * math.pi * f_mid / SAMPLE_RATE
            v = (
                math.sin(phase_sub) * _sfx_env(i, SAMPLE_RATE, 0.0018, 0.13) * 0.78
                + math.sin(phase_mid) * _sfx_env(i, SAMPLE_RATE, 0.0012, 0.045) * 0.36
                + nz_snap[i] * _sfx_env(i, SAMPLE_RATE, 0.0008, 0.018) * 0.52
            )
            base[i] = math.tanh(v * 1.15)
    elif kind == "burst":
        s1 = _sfx_sweep(420.0, 150.0, 0.22, 0.0025, 0.09)
        s2 = _sfx_sweep(950.0, 1550.0, 0.10, 0.0015, 0.04)
        nz = _bandpass_noise(len(s1), 47, 1400.0, 5400.0)
        base = []
        for i in range(len(s1)):
            v = s1[i] * 0.58 + nz[i] * _sfx_env(i, SAMPLE_RATE, 0.002, 0.045) * 0.28
            if i < len(s2):
                v += s2[i] * 0.24
            base.append(math.tanh(v * 1.1))
    elif kind == "alarm":
        n = int(1.35 * SAMPLE_RATE)
        base = [0.0] * n
        beep_n = int(0.08 * SAMPLE_RATE)
        for k in range(8):
            off = int((k % 4) * 0.09 * SAMPLE_RATE) + int((k // 4) * 0.58 * SAMPLE_RATE)
            for i in range(beep_n):
                idx = off + i
                if idx >= n:
                    break
                sq = 1.0 if math.sin(2.0 * math.pi * 2300.0 * i / SAMPLE_RATE) >= 0.0 else -1.0
                base[idx] += sq * 0.20 * _sfx_env(i, SAMPLE_RATE, 0.002, 0.08)
    elif kind == "flash":
        s1 = _sfx_sweep(340.0, 2600.0, 0.22, 0.002, 0.11)
        nz = _bandpass_noise(len(s1), 9, 2200.0, 8200.0)
        base = [math.tanh((s1[i] * 0.38 + nz[i] * _sfx_env(i, SAMPLE_RATE, 0.001, 0.055) * 0.42) * 1.1) for i in range(len(s1))]
    elif kind == "iris":
        s1 = _sfx_sweep(620.0, 220.0, 0.18, 0.004, 0.10)
        s2 = _sfx_sweep(220.0, 540.0, 0.18, 0.004, 0.10)
        base = [s * 0.45 for s in (s1 + s2)]
    elif kind == "riser":
        # Dual-layer cinematic tension riser: sweeping filtered air + rising sub harmonic
        n = int(0.75 * SAMPLE_RATE)
        nz = generate_noise_sweep(0.75, 250.0, 6200.0, 0.44)
        sub = _sfx_sweep(65.0, 220.0, 0.75, 0.12, 0.55)
        base = [math.tanh((nz[i] * 0.75 + sub[i] * 0.32 * (i / float(max(1, n - 1)))) * 1.1) for i in range(n)]
    elif kind == "fold":
        # Tactile paper fold (Aetheria-skills PaperWorld)
        n = int(0.15 * SAMPLE_RATE)
        nz = _bandpass_noise(n, 21, 900.0, 4200.0)
        sw = _sfx_sweep(420.0, 960.0, 0.15, 0.002, 0.04)
        base = [math.tanh((nz[i] * _sfx_env(i, SAMPLE_RATE, 0.003, 0.055) * 0.62 + sw[i] * 0.28) * 1.1) for i in range(n)]
    elif kind == "door":
        # Soft tactile door open/thump (Aetheria-skills PaperWorld)
        n = int(0.18 * SAMPLE_RATE)
        nz = _bandpass_noise(n, 23, 320.0, 1400.0)
        sw = _sfx_sweep(310.0, 165.0, 0.18, 0.004, 0.06)
        base = [math.tanh((sw[i] * 0.48 + nz[i] * _sfx_env(i, SAMPLE_RATE, 0.002, 0.045) * 0.45) * 1.1) for i in range(n)]
    elif kind == "notif":
        # Crisp two-tone musicbox notification chime (C6 -> G6)
        n1 = int(0.14 * SAMPLE_RATE)
        n2 = int(0.30 * SAMPLE_RATE)
        p1 = [
            (math.sin(2.0 * math.pi * 1046.5 * i / SAMPLE_RATE) + 0.35 * math.sin(2.0 * math.pi * 2.756 * 1046.5 * i / SAMPLE_RATE) * math.exp(-i / (0.14 * SAMPLE_RATE)))
            * _sfx_env(i, SAMPLE_RATE, 0.002, 0.12) * 0.48
            for i in range(n1)
        ]
        p2 = [
            (math.sin(2.0 * math.pi * 1568.0 * i / SAMPLE_RATE) + 0.35 * math.sin(2.0 * math.pi * 2.756 * 1568.0 * i / SAMPLE_RATE) * math.exp(-i / (0.14 * SAMPLE_RATE)))
            * _sfx_env(i, SAMPLE_RATE, 0.002, 0.22) * 0.52
            for i in range(n2)
        ]
        base = p1 + p2
    else:
        base = [s * 0.70 for s in _sfx_sweep(500.0, 1800.0, 0.09, 0.002, 0.03)]

    return [max(-0.98, min(0.98, s * vol)) for s in base]


def render_audio_events_track(
    events: List[Any],
    total_duration_sec: float,
    out_wav_path: Path,
) -> Dict[str, Any]:
    """Renders `[timeSec, kind, gain]` timeline events into a single synchronized 48kHz WAV."""
    dur = max(0.25, float(total_duration_sec))
    total_samples = max(1, int(math.ceil(dur * SAMPLE_RATE)))
    mix = [0.0] * total_samples

    parsed = []
    for item in events or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            t_sec = max(0.0, float(item[0]))
            kind = normalize_sfx_kind(str(item[1]))
            gain = max(0.05, min(1.5, float(item[2]) if len(item) >= 3 else 0.8))
            parsed.append((t_sec, kind, gain))
        elif isinstance(item, dict):
            t_sec = max(0.0, float(item.get("time", item.get("t", 0.0))))
            kind = normalize_sfx_kind(str(item.get("kind") or item.get("type") or "pop"))
            gain = max(0.05, min(1.5, float(item.get("gain", item.get("volume", 0.8)))))
            parsed.append((t_sec, kind, gain))

    parsed.sort(key=lambda x: x[0])

    # Cache synthesized unit-gain clips per kind so repeated cues are instant
    clip_cache: Dict[str, List[float]] = {}
    last_by_kind: Dict[str, float] = {}
    placed_types: set = set()
    placed_count = 0

    for t_sec, kind, gain in parsed:
        if t_sec >= dur:
            continue
        min_gap = 0.14 if kind == "footstep" else 0.045
        if kind in last_by_kind and (t_sec - last_by_kind[kind]) < min_gap:
            continue
        last_by_kind[kind] = t_sec

        clip = clip_cache.get(kind)
        if clip is None:
            clip = synthesize_sfx(kind, 1.0)
            clip_cache[kind] = clip

        off = min(total_samples - 1, int(round(t_sec * SAMPLE_RATE)))
        for i, smp in enumerate(clip):
            idx = off + i
            if idx >= total_samples:
                break
            mix[idx] += smp * gain
        placed_types.add(kind)
        placed_count += 1

    # Soft-clip limiter so overlapping SFX never distort
    for i in range(total_samples):
        v = mix[i]
        if v > 0.85 or v < -0.85:
            mix[i] = math.tanh(v)

    write_wav(Path(out_wav_path), mix)
    return {
        "placed": placed_count,
        "types": sorted(placed_types),
        "duration": round(dur, 3),
    }


MOOD_PRESETS: Dict[str, Dict[str, Any]] = {
    "cheerful": {"bpm": 114.0, "midi": [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], "lead": "marimba", "pat": "arp8", "bass": True, "perc": "shaker", "kick": 0.22},
    "chill":    {"bpm": 84.0,  "midi": [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], "lead": "epiano", "pat": "arp4", "bass": True, "perc": "brush", "kick": 0.14},
    "warm":     {"bpm": 76.0,  "midi": [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], "lead": "musicbox", "pat": "slow", "pad": True, "kick": 0.14},
    "sad":      {"bpm": 64.0,  "midi": [[57, 60, 64], [53, 57, 60], [48, 52, 55], [52, 56, 59]], "lead": "piano", "pat": "sparse", "pad": True, "kick": 0.10},
    "tense":    {"bpm": 104.0, "midi": [[45, 48, 52], [44, 47, 51], [45, 48, 52], [41, 44, 48]], "lead": "pluck", "pat": "tick", "drone": True, "kick": 0.26},
    "epic":     {"bpm": 126.0, "midi": [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]], "lead": "marimba", "pat": "arp8", "bass": True, "perc": "kick", "kick": 0.34},
    "comic":    {"bpm": 120.0, "midi": [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]], "lead": "pizz", "pat": "bounce", "bass": True, "kick": 0.24},
    "mystery":  {"bpm": 72.0,  "midi": [[57, 60, 63], [56, 59, 62], [57, 60, 63], [53, 56, 59]], "lead": "musicbox", "pat": "sparse", "drone": True, "kick": 0.16},
    "study":    {"bpm": 70.0,  "midi": [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], "lead": "epiano", "pat": "slow", "pad": True, "kick": 0.14},
}

MOOD_ALIASES: Dict[str, str] = {
    "ceria": "cheerful",
    "santai": "chill",
    "hangat": "warm",
    "sedih": "sad",
    "tegang": "tense",
    "semangat": "epic",
    "lucu": "comic",
    "misteri": "mystery",
    "malam": "study",
}


def _resolve_mood_preset(mood: Optional[str]) -> Optional[Dict[str, Any]]:
    if not mood:
        return None
    key = str(mood).strip().lower()
    key = MOOD_ALIASES.get(key, key)
    return MOOD_PRESETS.get(key)


def _midi_hz(m: float) -> float:
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


def _render_musical_mood_bgm(
    preset: Dict[str, Any],
    duration_sec: float,
    bpm_override: float,
    scene_index: int,
) -> List[float]:
    """Synthesizes a 6-instrument musical mood arrangement (marimba/epiano/musicbox/piano/pizz/pluck)."""
    eff_bpm = float(bpm_override) if bpm_override and bpm_override > 0 else float(preset["bpm"])
    safe_bpm = min(175.0, max(58.0, eff_bpm))
    beat = 60.0 / safe_bpm
    safe_dur = max(0.35, float(duration_sec))
    num_samples = max(1, int(safe_dur * SAMPLE_RATE))

    try:
        import numpy as np  # Fast vectorized synthesis when available
        out = np.zeros(num_samples, dtype=np.float32)
        rng = np.random.default_rng(scene_index + 3)

        def np_env(n: int, a: float = 0.004, d: float = 0.3):
            t = np.arange(n, dtype=np.float32) / SAMPLE_RATE
            return np.minimum(1.0, t / a) * np.exp(-t / d)

        def np_tone(freq: float, dur: float, kind: str, vel: float):
            n = max(1, int(dur * SAMPLE_RATE))
            t = np.arange(n, dtype=np.float32) / SAMPLE_RATE
            if kind == "marimba":
                s = np.sin(2.0 * np.pi * freq * t) + 0.25 * np.sin(2.0 * np.pi * 4.0 * freq * t) * np.exp(-t / 0.05)
                e = np_env(n, 0.003, 0.26)
            elif kind == "epiano":
                s = np.sin(2.0 * np.pi * freq * t) + 0.30 * np.sin(2.0 * np.pi * 2.0 * freq * t) * np.exp(-t / 0.40)
                e = np_env(n, 0.010, 0.70)
            elif kind == "musicbox":
                s = (
                    np.sin(2.0 * np.pi * freq * t)
                    + 0.35 * np.sin(2.0 * np.pi * 2.76 * freq * t) * np.exp(-t / 0.15)
                    + 0.15 * np.sin(2.0 * np.pi * 5.40 * freq * t) * np.exp(-t / 0.07)
                )
                e = np_env(n, 0.002, 0.85)
            elif kind == "piano":
                s = (
                    np.sin(2.0 * np.pi * freq * t)
                    + 0.40 * np.sin(2.0 * np.pi * 2.0 * freq * t) * np.exp(-t / 0.50)
                    + 0.20 * np.sin(2.0 * np.pi * 3.0 * freq * t) * np.exp(-t / 0.30)
                )
                e = np_env(n, 0.004, 0.95)
            elif kind == "pizz":
                s = np.sin(2.0 * np.pi * freq * t) + 0.30 * np.sin(2.0 * np.pi * 3.0 * freq * t) * np.exp(-t / 0.03)
                e = np_env(n, 0.002, 0.09)
            else:  # pluck
                s = np.sin(2.0 * np.pi * freq * t) + 0.50 * np.sin(2.0 * np.pi * 2.0 * freq * t) * np.exp(-t / 0.10)
                e = np_env(n, 0.002, 0.16)
            return (s * e * vel).astype(np.float32)

        def np_pad(chord_midi: List[int], dur: float, vel: float = 0.14):
            n = max(1, int(dur * SAMPLE_RATE))
            t = np.arange(n, dtype=np.float32) / SAMPLE_RATE
            acc = np.zeros(n, dtype=np.float32)
            for m in chord_midi:
                f = _midi_hz(m)
                acc += np.sin(2.0 * np.pi * f * t) + 0.30 * np.sin(2.0 * np.pi * f * 2.003 * t)
            fade = min(0.55, dur * 0.35)
            e = np.minimum(1.0, t / max(0.01, fade)) * np.minimum(1.0, np.maximum(0.0, (dur - t) / max(0.01, fade)))
            return (acc * e * (vel / max(1, len(chord_midi)))).astype(np.float32)

        def put_np(seg, t_pos: float):
            a = int(t_pos * SAMPLE_RATE)
            if a < 0 or a >= num_samples:
                return
            take = min(len(seg), num_samples - a)
            if take > 0:
                out[a : a + take] += seg[:take]

        chords = preset["midi"]
        lead = preset["lead"]
        pat = preset["pat"]
        perc = preset.get("perc")
        bar = scene_index
        t_cur = 0.0
        while t_cur < safe_dur + 0.05:
            ch = chords[bar % len(chords)]
            if pat == "arp8":
                order = [0, 1, 2, 1, 0, 2, 1, 2]
                steps = [(k * beat / 2.0, ch[order[k] % len(ch)] + 12, 0.45 if k % 2 else 0.65) for k in range(8)]
            elif pat == "arp4":
                steps = [(k * beat, ch[k % len(ch)] + 12, 0.58) for k in range(4)]
            elif pat == "slow":
                steps = [(0.0, ch[2 % len(ch)] + 12, 0.65), (beat * 1.5, ch[1 % len(ch)] + 12, 0.48), (beat * 2.5, ch[0] + 24, 0.55)]
            elif pat == "sparse":
                steps = [(0.0, ch[2 % len(ch)] + 12, 0.72), (beat * 2.5, ch[1 % len(ch)] + 12, 0.45)]
            elif pat == "tick":
                steps = [(k * beat / 2.0, ch[0] + 24 if k % 4 == 0 else ch[2 % len(ch)] + 12, 0.34) for k in range(8)]
            else:  # bounce
                order = [0, 2, 1, 2]
                steps = [(k * beat / 2.0, ch[order[k % 4] % len(ch)] + 12, 0.58) for k in (0, 1, 2, 3, 5, 7)]

            for off, midi_note, vel in steps:
                put_np(np_tone(_midi_hz(midi_note), 0.65, lead, vel * 0.42), t_cur + off)

            if preset.get("bass"):
                for k in (0, 2):
                    n_b = max(1, int(beat * 1.5 * SAMPLE_RATE))
                    tb = np.arange(n_b, dtype=np.float32) / SAMPLE_RATE
                    b_seg = (np.sin(2.0 * np.pi * _midi_hz(ch[0] - 24) * tb) * np_env(n_b, 0.01, 0.42) * 0.38).astype(np.float32)
                    put_np(b_seg, t_cur + k * beat)
            if preset.get("pad"):
                put_np(np_pad([c - 12 for c in ch], beat * 4.0, 0.14), t_cur)
            if preset.get("drone"):
                put_np(np_pad([ch[0] - 24, ch[0] - 17], beat * 4.0, 0.18), t_cur)
            if perc:
                for k in range(8):
                    tt = t_cur + k * beat / 2.0
                    if perc == "shaker" and k % 2 == 1:
                        n_p = int(0.05 * SAMPLE_RATE)
                        put_np((rng.standard_normal(n_p) * np_env(n_p, 0.002, 0.015) * 0.05).astype(np.float32), tt)
                    elif perc == "brush" and k % 2 == 0:
                        n_p = int(0.11 * SAMPLE_RATE)
                        put_np((rng.standard_normal(n_p) * np_env(n_p, 0.01, 0.045) * 0.032).astype(np.float32), tt)
                    elif perc == "kick" and k % 2 == 0:
                        n_p = int(0.18 * SAMPLE_RATE)
                        tb = np.arange(n_p, dtype=np.float32) / SAMPLE_RATE
                        put_np((np.sin(2.0 * np.pi * (110.0 - 65.0 * tb / 0.18) * tb) * np_env(n_p, 0.002, 0.09) * 0.42).astype(np.float32), tt)
            t_cur += beat * 4.0
            bar += 1

        # Smooth edge fades so per-scene mood transitions cross-glue cleanly without clicks
        fade_in_n = min(num_samples // 3, int(0.35 * SAMPLE_RATE))
        fade_out_n = min(num_samples // 3, int(0.40 * SAMPLE_RATE))
        if fade_in_n > 1:
            out[:fade_in_n] *= np.linspace(0.0, 1.0, fade_in_n, dtype=np.float32)
        if fade_out_n > 1:
            out[-fade_out_n:] *= np.linspace(1.0, 0.0, fade_out_n, dtype=np.float32)
        peak = float(np.max(np.abs(out))) + 1e-6
        out = out * (0.72 / max(peak, 0.72))
        return out.tolist()
    except Exception:
        # Pure-Python fallback if NumPy is unavailable
        buf = [0.0] * num_samples
        chord = [_midi_hz(m) for m in preset["midi"][scene_index % len(preset["midi"])]]
        scale = 0.16 / max(1, len(chord))
        for f in chord:
            omega = 2.0 * math.pi * f / SAMPLE_RATE
            for i in range(num_samples):
                buf[i] += math.sin(omega * i) * scale
        return buf


def generate_showreel_bgm_track(
    file_path: Path,
    duration_sec: float,
    bpm: float = 120.0,
    scene_index: int = 0,
    scene_start_sec: float = 0.0,
    mood: Optional[str] = None,
) -> float:
    """Synthesizes a deterministic musical mood BGM track (or beat-locked studio groove when mood is omitted)."""
    preset = _resolve_mood_preset(mood)
    if preset is not None:
        buf = _render_musical_mood_bgm(preset, duration_sec, bpm, scene_index)
        write_wav(file_path, buf)
        return round(len(buf) / float(SAMPLE_RATE), 3)

    safe_bpm = min(175.0, max(70.0, float(bpm or 120.0)))
    beat = 60.0 / safe_bpm
    safe_dur = max(0.35, float(duration_sec))
    num_samples = max(1, int(safe_dur * SAMPLE_RATE))
    buf = [0.0] * num_samples

    chords = [
        [130.81, 196.00, 246.94, 311.13],
        [116.54, 174.61, 220.00, 277.18],
        [155.56, 233.08, 293.66, 392.00],
        [174.61, 261.63, 311.13, 415.30],
    ]
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
    base_kick = 0.30
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
