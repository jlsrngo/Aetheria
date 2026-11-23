"""
Aetheria Reference Video Extractor Engine (MotionClone-Grade Temporal + Visual Analyzer).
Scans reference videos locally using OpenCV + NumPy (+ optional RapidOCR) to extract:
- Full-timeline temporal motion energy & scene cut timestamps (`temporal.json`)
- True per-scene color tokens (measured background, text contrast, surface, vibrant accents)
- Spatial bounding-box layout zones & OCR/text hierarchy (`style.json`, `style_spec.json`)
- Scene keyframes (`frames/ref_scene_XX.jpg`) & normalized frames (`frames/thumb_00X.jpg`)
- Aetheria Modular HTML5/JS Motion Engine blueprint (`ref_report.md`)
"""

import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import cv2
    import numpy as np
except ImportError as e:
    print(json.dumps({"error": f"Required Python vision library missing: {e}"}))
    sys.exit(1)

import os
import shutil
import subprocess
import tempfile
import wave

_RAPID_OCR = None
_RAPID_OCR_LOADED = False


def _resolve_ffmpeg_bin() -> str:
    env_ff = os.environ.get("AETHERIA_FFMPEG", "").strip()
    if env_ff and Path(env_ff).is_file():
        return env_ff
    found = shutil.which("ffmpeg")
    if found:
        return found
    local_app = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app:
        capcut_root = Path(local_app) / "CapCut" / "Apps"
        if capcut_root.is_dir():
            candidates = sorted(capcut_root.glob("*/ffmpeg.exe"), reverse=True)
            for c in candidates:
                if c.is_file():
                    return str(c)
    return "ffmpeg"


def extract_audio_bpm_beats_and_profile(
    video_path: Path, temp_dir: Path
) -> Tuple[float, List[float], Dict[str, Any]]:
    """Demuxes reference audio to 22.05kHz mono WAV and extracts BPM, beats, and audio mode."""
    default_profile: Dict[str, Any] = {
        "mode": "bgm-sfx-only",
        "speechLikelihood": 0.0,
        "voiceBandRatio": 0.0,
        "beatRegularity": 0.0,
        "bpmSource": "fallback",
        "bpmConfidence": 0.0,
    }
    wav_path = temp_dir / "ref_audio.wav"
    ff_bin = _resolve_ffmpeg_bin()
    cmd = [
        ff_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        str(wav_path),
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
    except Exception:
        return 120.0, [], {**default_profile, "mode": "silent"}

    if not wav_path.is_file():
        return 120.0, [], {**default_profile, "mode": "silent"}

    try:
        with wave.open(str(wav_path), "rb") as w:
            sr = int(w.getframerate() or 22050)
            n_frames = w.getnframes()
            if n_frames <= 0:
                return 120.0, [], {**default_profile, "mode": "silent"}
            raw_bytes = w.readframes(n_frames)
        samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size < sr // 2:
            return 120.0, [], {**default_profile, "mode": "silent"}

        hop = max(256, int(round(sr * 0.05)))  # 50ms windows
        freqs = np.fft.rfftfreq(hop, d=1.0 / float(sr))
        voice_mask = (freqs >= 300.0) & (freqs <= 3400.0)
        sub_mask = (freqs >= 35.0) & (freqs < 250.0)
        energies: List[float] = []
        flux: List[float] = []
        voice_powers: List[float] = []
        sub_powers: List[float] = []
        total_powers: List[float] = []
        prev_mag: Optional[np.ndarray] = None
        hanning = np.hanning(hop)
        for i in range(0, len(samples) - hop, hop):
            chunk = samples[i:i + hop]
            rms = float(np.sqrt(np.mean(chunk * chunk)))
            energies.append(rms)
            mag = np.abs(np.fft.rfft(chunk * hanning))
            pwr = mag * mag
            total_powers.append(float(np.sum(pwr)) + 1e-12)
            voice_powers.append(float(np.sum(pwr[voice_mask])))
            sub_powers.append(float(np.sum(pwr[sub_mask])))
            if prev_mag is not None and prev_mag.shape == mag.shape:
                diff = mag - prev_mag
                half_rect = 0.5 * (diff + np.abs(diff))
                flux.append(float(np.sum(half_rect)))
            else:
                flux.append(0.0)
            prev_mag = mag

        if not energies or float(np.max(energies)) < 1e-4:
            return 120.0, [], {**default_profile, "mode": "silent"}

        e_raw = np.asarray(energies, dtype=np.float32)
        e_arr = e_raw.copy()
        f_arr = np.asarray(flux, dtype=np.float32)
        if float(np.max(f_arr)) > 0:
            f_arr = f_arr / float(np.max(f_arr))
        if float(np.max(e_arr)) > 0:
            e_arr = e_arr / float(np.max(e_arr))
        combined = 0.55 * f_arr + 0.45 * e_arr
        threshold = max(0.18, float(np.mean(combined)) * 1.45)

        beat_times: List[float] = []
        win_sec = hop / float(sr)
        for idx, val in enumerate(combined):
            is_local_peak = (
                (idx == 0 or val >= combined[idx - 1])
                and (idx + 1 == len(combined) or val >= combined[idx + 1])
            )
            if val >= threshold and is_local_peak:
                t_sec = round(idx * win_sec, 3)
                if not beat_times or (t_sec - beat_times[-1]) >= 0.22:
                    beat_times.append(t_sec)

        beat_regularity = 0.0
        bpm_source = "fallback"
        bpm_confidence = 0.0
        if len(beat_times) >= 3:
            intervals = [
                beat_times[k + 1] - beat_times[k]
                for k in range(len(beat_times) - 1)
                if 0.25 <= (beat_times[k + 1] - beat_times[k]) <= 1.2
            ]
            if len(intervals) >= 2:
                median_ioi = float(np.median(intervals))
                mad_ioi = float(np.median(np.abs(np.asarray(intervals) - median_ioi)))
                beat_regularity = round(float(np.clip(1.0 - (mad_ioi / max(0.05, median_ioi)) * 2.0, 0.0, 1.0)), 3)
                if beat_regularity >= 0.25:
                    raw_bpm = 60.0 / max(0.25, median_ioi)
                    while raw_bpm < 75.0:
                        raw_bpm *= 2.0
                    while raw_bpm > 175.0:
                        raw_bpm *= 0.5
                    bpm = round(raw_bpm, 1)
                    bpm_source = "measured"
                    bpm_confidence = beat_regularity
                else:
                    bpm = 120.0
                    bpm_source = "fallback"
                    bpm_confidence = beat_regularity
            else:
                bpm = 120.0
        else:
            bpm = 120.0

        tot_sum = float(np.sum(total_powers)) + 1e-12
        voice_ratio = round(float(np.sum(voice_powers)) / tot_sum, 3)
        sub_ratio = round(float(np.sum(sub_powers)) / tot_sum, 3)
        # Speech typically has high pause-to-burst dynamic variance + dominant mid-band over sub-bass.
        mean_e = float(np.mean(e_raw)) + 1e-9
        cv_e = float(np.std(e_raw)) / mean_e
        quiet_frac = float(np.mean(e_raw < (mean_e * 0.25)))
        speech_score = 0.45 * min(1.0, max(0.0, (voice_ratio - 0.35) / 0.45)) + 0.30 * min(1.0, quiet_frac * 2.5) + 0.25 * min(1.0, max(0.0, (cv_e - 0.35) / 0.6))
        if sub_ratio >= 0.14 or beat_regularity >= 0.52:
            speech_score *= 0.65
        speech_likelihood = round(float(np.clip(speech_score, 0.0, 1.0)), 3)
        audio_mode = "speech-narrated" if speech_likelihood >= 0.55 else "bgm-sfx-only"
        profile = {
            "mode": audio_mode,
            "speechLikelihood": speech_likelihood,
            "voiceBandRatio": voice_ratio,
            "subBassRatio": sub_ratio,
            "beatRegularity": beat_regularity,
            "bpmSource": bpm_source,
            "bpmConfidence": bpm_confidence,
        }
        return bpm, beat_times, profile
    except Exception:
        return 120.0, [], {**default_profile, "mode": "silent"}


def extract_audio_bpm_and_beats(video_path: Path, temp_dir: Path) -> Tuple[float, List[float]]:
    """Backwards-compatible wrapper returning `(bpm, beat_timestamps)`."""
    bpm, beats, _ = extract_audio_bpm_beats_and_profile(video_path, temp_dir)
    return bpm, beats


def snap_cuts_to_beats(cut_timestamps: List[float], beat_times: List[float], duration: float, max_snap_sec: float = 0.12) -> List[float]:
    """Snaps visual cut timestamps (except 0.0) to the nearest audio beat onset within `max_snap_sec`."""
    if not beat_times:
        return cut_timestamps
    snapped: List[float] = []
    for t in cut_timestamps:
        if t <= 0.01:
            snapped.append(0.0)
            continue
        nearest = min(beat_times, key=lambda b: abs(b - t))
        candidate = round(nearest, 3) if abs(nearest - t) <= max_snap_sec else round(t, 3)
        if candidate <= 0.25 or candidate >= max(0.5, duration - 0.25):
            candidate = round(t, 3)
        if not snapped or (candidate - snapped[-1]) >= 0.40:
            snapped.append(candidate)
    return snapped if snapped else [0.0]


def extract_clean_plate_background(frames: List[np.ndarray], fallback_hex: str = "#141418") -> Dict[str, Any]:
    """Computes temporal median clean plate background across sampled scene sub-frames."""
    valid = [f for f in frames if f is not None and f.size > 0]
    if not valid:
        return {
            "fillHex": fallback_hex,
            "bottomHex": fallback_hex,
            "hasGradient": False,
        }
    target_h, target_w = 96, 96
    resized = [
        cv2.resize(f, (target_w, target_h), interpolation=cv2.INTER_AREA).astype(np.float32)
        for f in valid
    ]
    median_plate = np.median(np.stack(resized, axis=0), axis=0).astype(np.uint8)
    border = 8
    top_strip = median_plate[0:border, :, :].reshape(-1, 3)
    bot_strip = median_plate[-border:, :, :].reshape(-1, 3)
    left_strip = median_plate[:, 0:border, :].reshape(-1, 3)
    right_strip = median_plate[:, -border:, :].reshape(-1, 3)
    all_border = np.vstack([top_strip, bot_strip, left_strip, right_strip])

    bg_bgr = np.median(all_border, axis=0)
    top_bgr = np.median(top_strip, axis=0)
    bot_bgr = np.median(bot_strip, axis=0)
    grad_dist = _color_distance(top_bgr, bot_bgr)
    has_gradient = bool(grad_dist >= 18.0)

    return {
        "fillHex": _bgr_to_hex(top_bgr if has_gradient else bg_bgr),
        "bottomHex": _bgr_to_hex(bot_bgr if has_gradient else bg_bgr),
        "hasGradient": has_gradient,
    }


def _hex_to_bgr(hex_str: str) -> Tuple[float, float, float]:
    s = str(hex_str or "").strip().lstrip("#")
    if len(s) != 6:
        return (18.0, 18.0, 22.0)
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        return (float(b), float(g), float(r))
    except ValueError:
        return (18.0, 18.0, 22.0)


def reconcile_palette_with_clean_plate(
    palette: Dict[str, Any], clean_plate: Dict[str, Any]
) -> Dict[str, Any]:
    """Aligns scene palette bgHex/isDark to cleanPlate while protecting tile-wall & low-confidence polarity."""
    pal = dict(palette or {})
    cp = clean_plate or {}
    if cp.get("confidence") == "low":
        return pal

    cp_hex = str(cp.get("fillHex") or pal.get("bgHex") or "#141418")
    bg_hex = str(pal.get("bgHex") or cp_hex)
    cp_luma = _luma_from_bgr(np.array(_hex_to_bgr(cp_hex)))
    bg_luma = _luma_from_bgr(np.array(_hex_to_bgr(bg_hex)))

    if cp.get("kind") == "tile-wall":
        # Never overwrite a dark bgHex with a light color on tile-wall scenes (R4 polarity guard)
        if cp_luma < 120.0:
            pal["bgHex"] = cp_hex
            pal["isDark"] = True
            txt_luma = _luma_from_bgr(np.array(_hex_to_bgr(str(pal.get("textHex") or ""))))
            if abs(txt_luma - cp_luma) < 60.0:
                pal["textHex"] = "#F8FAFC"
                pal["accentHex"] = pal.get("accentHex") or pal["textHex"]
        elif not pal.get("isDark") and bg_luma >= 120.0:
            pal["bgHex"] = cp_hex
        return pal

    if (cp_luma >= 145.0 and bg_luma < 125.0) or (cp_luma >= 135.0 and abs(cp_luma - bg_luma) >= 55.0):
        pal["bgHex"] = cp_hex
        is_dark = cp_luma < 120.0
        pal["isDark"] = bool(is_dark)
        txt_hex = str(pal.get("textHex") or "")
        txt_luma = _luma_from_bgr(np.array(_hex_to_bgr(txt_hex)))
        if abs(txt_luma - cp_luma) < 60.0:
            pal["textHex"] = "#F8FAFC" if is_dark else "#1E2021"
            pal["accentHex"] = pal.get("accentHex") or pal["textHex"]
    return pal


def detect_grid_tilt_deg(frame_bgr: Optional[np.ndarray]) -> Optional[float]:
    """Detects consistent oblique layout/grid tilt angle in degrees via sub-degree HoughLines."""
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    gray = cv2.GaussianBlur(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    edges = cv2.Canny(gray, 40, 120)
    lines = cv2.HoughLines(edges, 1, np.pi / 720.0, 130)
    if lines is None or len(lines) < 6:
        return None
    angles = [((math.degrees(float(theta)) + 45.0) % 90.0) - 45.0 for _, theta in lines.reshape(-1, 2)]
    oblique = [a for a in angles if 1.8 <= abs(a) <= 25.0]
    if len(oblique) < 6 or (len(oblique) / max(1, len(angles))) < 0.55:
        return None
    if float(np.std(oblique)) > 2.5:
        return None
    return round(float(np.median(oblique)), 1)


def detect_bimodal_contrast_tiles(frame_bgr: Optional[np.ndarray]) -> Optional[Dict[str, Any]]:
    """Detects high-contrast bimodal dark+light grid/tile scenes and measures exact dark vs light tile hexes."""
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    dark_mask = gray < 55
    light_mask = gray > 185
    dark_pct = float(np.mean(dark_mask))
    light_pct = float(np.mean(light_mask))
    if dark_pct < 0.20 or light_pct < 0.20:
        return None
    dark_bgr = np.median(frame_bgr[dark_mask], axis=0)
    light_bgr = np.median(frame_bgr[light_mask], axis=0)
    h, w = gray.shape[:2]
    top_left_mean = float(np.mean(gray[: max(4, h // 6), : max(4, w // 6)]))
    return {
        "darkTileHex": _bgr_to_hex(dark_bgr),
        "lightTileHex": _bgr_to_hex(light_bgr),
        "topLeft": "light" if top_left_mean > 128.0 else "dark",
    }


def _edge_line_peaks(frac: np.ndarray, min_gap: int, thr: float) -> List[int]:
    idx = [
        i for i in range(1, len(frac) - 1)
        if frac[i] >= thr and frac[i] >= frac[i - 1] and frac[i] >= frac[i + 1]
    ]
    idx.sort(key=lambda i: -frac[i])
    picked: List[int] = []
    for i in idx:
        if all(abs(i - j) >= min_gap for j in picked):
            picked.append(i)
    return sorted(picked)


def measure_contrast_tile_grid(
    frame_bgr: Optional[np.ndarray], tilt_deg: Optional[float]
) -> Optional[Dict[str, Any]]:
    """Measures the real tile pitch/origin and per-cell dark/light map of a bento/tile wall.

    A bare "alternating tiles" hint made agents paint a strict checkerboard; real tile walls
    use irregular dark/light placement, so we emit the exact `L`/`D` map row by row.
    Coordinates are in the de-rotated (axis-aligned) frame: draw after `ctx.rotate(tilt)`.
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    angle = float(tilt_deg or 0.0)
    rot_m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    rot = cv2.warpAffine(frame_bgr, rot_m, (w, h), borderMode=cv2.BORDER_REPLICATE)
    gray = cv2.GaussianBlur(cv2.cvtColor(rot, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    col_frac = (gx > 60).mean(axis=0)
    row_frac = (gy > 60).mean(axis=1)
    col_frac = np.maximum.reduce([col_frac, np.roll(col_frac, 1), np.roll(col_frac, -1)])
    row_frac = np.maximum.reduce([row_frac, np.roll(row_frac, 1), np.roll(row_frac, -1)])
    xs = _edge_line_peaks(col_frac, max(8, w // 14), 0.25)
    ys = _edge_line_peaks(row_frac, max(8, h // 8), 0.25)
    if len(xs) < 2 or len(ys) < 2:
        return None
    pitch_x = float(np.median(np.diff(xs)))
    pitch_y = float(np.median(np.diff(ys)))
    if pitch_x < 24 or pitch_y < 24:
        return None
    # Keep map column/row 0 == the cell at origin: only step back one pitch when that partial
    # cell is wide enough to be sampled, otherwise its skipped slot would shift every index.
    rem_x, rem_y = xs[0] % pitch_x, ys[0] % pitch_y
    origin_x = rem_x - pitch_x if rem_x > pitch_x * 0.3 else rem_x
    origin_y = rem_y - pitch_y if rem_y > pitch_y * 0.3 else rem_y
    rows: List[str] = []
    y = origin_y
    populated_cells = 0
    total_cells = 0
    while y < h:
        row = ""
        x = origin_x
        while x < w:
            cx0, cx1 = int(max(0, x + pitch_x * 0.15)), int(min(w, x + pitch_x * 0.85))
            cy0, cy1 = int(max(0, y + pitch_y * 0.15)), int(min(h, y + pitch_y * 0.85))
            if cx1 - cx0 > 4 and cy1 - cy0 > 4:
                patch = gray[cy0:cy1, cx0:cx1]
                med = float(np.median(patch))
                cell_ch = "L" if med > 150 else ("D" if med < 80 else "M")
                row += cell_ch
                # Measure interior icon contrast inside [0.22..0.78] of cell
                ix0, ix1 = int(max(0, x + pitch_x * 0.22)), int(min(w, x + pitch_x * 0.78))
                iy0, iy1 = int(max(0, y + pitch_y * 0.22)), int(min(h, y + pitch_y * 0.78))
                if ix1 - ix0 > 6 and iy1 - iy0 > 6:
                    total_cells += 1
                    if float(np.std(gray[iy0:iy1, ix0:ix1])) >= 8.0:
                        populated_cells += 1
            x += pitch_x
        if row:
            rows.append(row)
        y += pitch_y
    if not rows:
        return None
    icon_ratio = round(float(populated_cells) / float(max(1, total_cells)), 2)
    return {
        "pitchX": round(pitch_x, 1),
        "pitchY": round(pitch_y, 1),
        "originX": round(float(origin_x), 1),
        "originY": round(float(origin_y), 1),
        "cols": max(len(r) for r in rows),
        "rows": len(rows),
        "map": rows,
        "populatedIconRatio": icon_ratio,
        "iconPopulatedEveryCell": bool(icon_ratio >= 0.45),
        "iconRule": (
            "CRITICAL BENTO ICON RULE: EVERY visible tile cell — BOTH lightTile (L) AND darkTile (D) — "
            "must contain a distinct centered vector icon (draw dark #1D1E21 vector icons inside lightTile "
            "cells and bright #F0EEEC vector icons inside darkTile cells; NEVER leave darkTile cells blank)"
        ),
    }


def analyze_layer_motion_curve(
    cap_or_frames: Any,
    start_frame: int,
    end_frame: int,
    box: Tuple[int, int, int, int],
    scene_duration: float = 2.5,
) -> Dict[str, Any]:
    """
    Measures layer motion vectors using Farneback dense optical flow and fits an AM easing curve
    (`AM.spring` with `{ tension, friction }`, `AM.ease.outCubic`, or `linear`).
    Accepts either a pre-sampled `List[np.ndarray]` of scene frames or an open `cv2.VideoCapture`.
    """
    x, y, w, h = box
    sampled_frames: List[np.ndarray] = []
    if isinstance(cap_or_frames, list):
        sampled_frames = [f for f in cap_or_frames if f is not None and f.size > 0]
    elif hasattr(cap_or_frames, "set") and hasattr(cap_or_frames, "read"):
        step = max(1, (end_frame - start_frame) // 6)
        for f_idx in range(start_frame, max(start_frame + 1, end_frame), step):
            cap_or_frames.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
            ok, fr = cap_or_frames.read()
            if ok and fr is not None:
                sampled_frames.append(fr)

    if len(sampled_frames) < 2 or w < 8 or h < 8:
        return {
            "type": "spring_pop",
            "direction": "pop",
            "trajectory": [0.0, 0.0],
            "curve": "AM.spring",
            "springParams": {"tension": 150, "friction": 14},
            "velocity": 0.0,
            "startSec": 0.08,
            "durationSec": round(min(0.55, max(0.25, scene_duration * 0.25)), 2),
        }

    fh, fw = sampled_frames[0].shape[:2]
    x0 = max(0, min(fw - 8, int(x)))
    y0 = max(0, min(fh - 8, int(y)))
    x1 = max(x0 + 8, min(fw, int(x + w)))
    y1 = max(y0 + 8, min(fh, int(y + h)))

    crop_dim = 72
    prev_crop = cv2.cvtColor(sampled_frames[0][y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    prev_crop = cv2.resize(prev_crop, (crop_dim, crop_dim), interpolation=cv2.INTER_AREA)
    trajectories: List[Tuple[float, float]] = []
    speeds: List[float] = []
    divergences: List[float] = []

    half = crop_dim // 2
    for fr in sampled_frames[1:]:
        cur_crop = cv2.cvtColor(fr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        cur_crop = cv2.resize(cur_crop, (crop_dim, crop_dim), interpolation=cv2.INTER_AREA)
        flow = cv2.calcOpticalFlowFarneback(
            prev_crop, cur_crop, None, 0.5, 3, 15, 3, 5, 1.2, 0
        )
        u = flow[:, :, 0]
        v = flow[:, :, 1]
        mean_u = float(np.mean(u))
        mean_v = float(np.mean(v))
        # Spatial divergence: outward flow (right - left) + (bottom - top)
        div_x = float(np.mean(u[:, half:]) - np.mean(u[:, :half]))
        div_y = float(np.mean(v[half:, :]) - np.mean(v[:half, :]))
        divergences.append(div_x + div_y)
        trajectories.append((mean_u, mean_v))
        speeds.append(float(np.hypot(mean_u, mean_v)))
        prev_crop = cur_crop

    avg_u = float(np.mean([t[0] for t in trajectories])) if trajectories else 0.0
    avg_v = float(np.mean([t[1] for t in trajectories])) if trajectories else 0.0
    avg_div = float(np.mean(divergences)) if divergences else 0.0
    velocity = round(float(np.hypot(avg_u, avg_v)), 2)

    if abs(avg_v) > abs(avg_u) and avg_v < -0.55:
        dir_name = "slide_up"
    elif abs(avg_v) > abs(avg_u) and avg_v > 0.55:
        dir_name = "slide_down"
    elif abs(avg_u) > abs(avg_v) and abs(avg_u) > 0.55:
        dir_name = "slide_right" if avg_u > 0 else "slide_left"
    elif avg_div > 0.45:
        dir_name = "scale_up"
    else:
        dir_name = "pop"

    # Cumulative displacement curve fitting (Overshoot vs OutCubic vs Linear)
    cum_disp: List[float] = [0.0]
    for s in speeds:
        cum_disp.append(cum_disp[-1] + s)
    total_disp = cum_disp[-1] if cum_disp[-1] > 1e-4 else 1.0
    norm_p = [d / total_disp for d in cum_disp]

    has_overshoot = False
    if len(trajectories) >= 3:
        v_signs = [np.sign(t[1]) for t in trajectories if abs(t[1]) > 0.15]
        u_signs = [np.sign(t[0]) for t in trajectories if abs(t[0]) > 0.15]
        if (len(set(v_signs)) > 1) or (len(set(u_signs)) > 1):
            has_overshoot = True

    n_pts = max(2, len(norm_p))
    t_grid = np.linspace(0.0, 1.0, n_pts)
    p_arr = np.asarray(norm_p, dtype=np.float32)
    cubic_pred = 1.0 - np.power(1.0 - t_grid, 3)
    lin_pred = t_grid
    ss_tot = float(np.sum((p_arr - np.mean(p_arr)) ** 2)) or 1.0
    r2_cubic = round(1.0 - float(np.sum((p_arr - cubic_pred) ** 2)) / ss_tot, 3)
    r2_linear = round(1.0 - float(np.sum((p_arr - lin_pred) ** 2)) / ss_tot, 3)

    is_decelerating = (len(speeds) >= 2 and speeds[0] > speeds[-1] * 1.15) or (r2_cubic > r2_linear + 0.05)
    if has_overshoot or dir_name in ("pop", "scale_up", "slide_up"):
        curve = "AM.spring"
        overshoot_ratio = min(0.45, max(0.05, velocity / 12.0))
        tension = int(round(140.0 * (1.0 + overshoot_ratio)))
        spring_params: Optional[Dict[str, int]] = {"tension": tension, "friction": 14}
    elif is_decelerating or dir_name in ("slide_down", "slide_left", "slide_right"):
        curve = "AM.ease.outCubic"
        spring_params = None
    else:
        curve = "linear"
        spring_params = None

    entrance_type = "spring_pop" if dir_name in ("pop", "scale_up") else dir_name
    out: Dict[str, Any] = {
        "type": entrance_type,
        "direction": dir_name,
        "trajectory": [round(avg_u / float(crop_dim), 3), round(avg_v / float(crop_dim), 3)],
        "curve": curve,
        "velocity": velocity,
        "r2OutCubic": r2_cubic,
        "startSec": 0.08,
        "durationSec": round(min(0.60, max(0.28, scene_duration * 0.24)), 2),
    }
    if spring_params is not None:
        out["springParams"] = spring_params
    return out


def compile_scene_am_skeleton(ast_scene: Dict[str, Any], width: int, height: int) -> str:
    """Compiles a decompiled Motion AST scene into a deterministic `window.AM.registerScene` JS skeleton."""
    scene_id = ast_scene.get("id", "scene1")
    cp = ast_scene.get("cleanPlate") or {}
    fill_hex = cp.get("fillHex", "#0F1115")
    bot_hex = cp.get("bottomHex", fill_hex)
    has_grad = bool(cp.get("hasGradient", False))
    layers = ast_scene.get("layers") or []

    lines = [
        f"// Auto-decompiled Motion Ghidra AST skeleton for {scene_id} ({width}x{height})",
        "(function () {",
        '  "use strict";',
        "  var AM = window.AM;",
        f'  AM.registerScene("{scene_id}", function (ctx, localTime, dur, scene, AM) {{',
        f"    var W = {width}, H = {height};",
        "    ctx.save();",
    ]
    if has_grad and fill_hex != bot_hex:
        lines.extend([
            "    var bgGrad = ctx.createLinearGradient(0, 0, 0, H);",
            f'    bgGrad.addColorStop(0, "{fill_hex}");',
            f'    bgGrad.addColorStop(1, "{bot_hex}");',
            "    ctx.fillStyle = bgGrad;",
            "    ctx.fillRect(0, 0, W, H);",
        ])
    else:
        lines.extend([
            f'    ctx.fillStyle = "{fill_hex}";',
            "    ctx.fillRect(0, 0, W, H);",
        ])

    cam_motion = ast_scene.get("cameraMotion")
    if cam_motion:
        try:
            from ref_camera_motion import compile_camera_motion_am_js

            lines.extend(compile_camera_motion_am_js(cam_motion, width, height))
        except Exception:
            pass

    for idx, layer in enumerate(layers[:8]):
        kind = layer.get("kind", "card")
        box = layer.get("box") or {"x": 0.15, "y": 0.25, "w": 0.7, "h": 0.2}
        st = layer.get("style") or {}
        mot = (layer.get("motion") or {}).get("entrance") or {}
        start_s = float(mot.get("startSec", round(0.06 * idx, 2)))
        dur_s = max(0.2, float(mot.get("durationSec", 0.45)))
        curve = mot.get("curve", "AM.spring")
        direction = mot.get("direction", "pop")
        sp = mot.get("springParams") or {"tension": 150, "friction": 14}

        lx = int(round(float(box.get("x", 0.15)) * width))
        ly = int(round(float(box.get("y", 0.25)) * height))
        lw = max(24, int(round(float(box.get("w", 0.7)) * width)))
        lh = max(24, int(round(float(box.get("h", 0.2)) * height)))

        p_var = f"p{idx + 1}"
        if curve == "AM.spring":
            lines.append(
                f"    var {p_var} = AM.spring(Math.max(0, localTime - {start_s:.2f}), {{ stiffness: {int(sp.get('tension', 150))}, damping: {int(sp.get('friction', 14))} }});"
            )
        elif curve == "AM.ease.outCubic":
            lines.append(
                f"    var {p_var} = AM.ease.outCubic(AM.clamp((localTime - {start_s:.2f}) / {dur_s:.2f}, 0, 1));"
            )
        else:
            lines.append(
                f"    var {p_var} = AM.clamp((localTime - {start_s:.2f}) / {dur_s:.2f}, 0, 1);"
            )

        dx_expr = "0"
        dy_expr = "0"
        if direction == "slide_up":
            dy_expr = f"40 * (1 - {p_var})"
        elif direction == "slide_down":
            dy_expr = f"-40 * (1 - {p_var})"
        elif direction == "slide_right":
            dx_expr = f"-60 * (1 - {p_var})"
        elif direction == "slide_left":
            dx_expr = f"60 * (1 - {p_var})"

        if kind == "text":
            txt = json.dumps(layer.get("text") or scene_id)
            f_hex = st.get("fillHex", "#F8FAFC")
            f_size = int(st.get("fontSize", 44))
            f_weight = st.get("fontWeight", "800")
            align = st.get("align", "center")
            tx = lx + lw // 2 if align == "center" else lx
            ty = ly + int(round(lh * 0.72))
            lines.extend([
                "    ctx.save();",
                f"    ctx.globalAlpha = AM.clamp({p_var}, 0, 1);",
                f'    ctx.fillStyle = "{f_hex}";',
                f'    ctx.font = "{f_weight} {f_size}px Inter, sans-serif";',
                f'    ctx.textAlign = "{align}";',
                f"    ctx.fillText({txt}, {tx} + ({dx_expr}), {ty} + ({dy_expr}));",
                "    ctx.restore();",
            ])
        else:
            f_hex = st.get("fillHex", "#1E293B")
            s_hex = st.get("strokeHex", "#38BDF8")
            rad = int(st.get("radius", 16))
            lines.extend([
                "    ctx.save();",
                f"    ctx.globalAlpha = AM.clamp({p_var}, 0, 1);",
                f'    ctx.fillStyle = "{f_hex}";',
                f'    ctx.strokeStyle = "{s_hex}";',
                "    ctx.lineWidth = 2;",
                f"    AM.roundRect(ctx, {lx} + ({dx_expr}), {ly} + ({dy_expr}), {lw}, {lh}, {rad});",
                "    ctx.fill();",
                "    ctx.stroke();",
                "    ctx.restore();",
            ])

    lines.extend([
        "    ctx.restore();",
        "  });",
        "})();",
        "",
    ])
    return "\n".join(lines)


def estimate_text_font_weight(frame_bgr: np.ndarray, px_box: List[int]) -> str:
    """Estimates typographic stroke weight ('400'|'500'|'600'|'800') from text crop stroke width."""
    try:
        x0, y0, bw, bh = [int(v) for v in px_box[:4]]
        h_img, w_img = frame_bgr.shape[:2]
        x0 = max(0, min(w_img - 1, x0))
        y0 = max(0, min(h_img - 1, y0))
        x1 = min(w_img, x0 + max(8, bw))
        y1 = min(h_img, y0 + max(8, bh))
        if (x1 - x0) < 10 or (y1 - y0) < 8:
            return "600"
        crop = cv2.cvtColor(frame_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        scale_up = 2 if bh < 42 else 1
        if scale_up > 1:
            crop = cv2.resize(crop, (crop.shape[1] * scale_up, crop.shape[0] * scale_up), interpolation=cv2.INTER_CUBIC)
        border = np.concatenate([crop[0, :], crop[-1, :], crop[:, 0], crop[:, -1]])
        bg_med = float(np.median(border))
        hi_val = float(np.percentile(crop, 98))
        lo_val = float(np.percentile(crop, 2))
        bg_is_dark = (hi_val - bg_med) >= (bg_med - lo_val)
        thresh_flag = cv2.THRESH_BINARY + cv2.THRESH_OTSU if bg_is_dark else cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        _, mask = cv2.threshold(crop, 0, 255, thresh_flag)
        fg_ys, _ = np.where(mask > 0)
        if fg_ys.size < 12:
            return "500"
        active_h = max(8.0, float(int(fg_ys.max()) - int(fg_ys.min()) + 1) / float(scale_up))
        fg_vals = cv2.distanceTransform(mask, cv2.DIST_L2, 3)[mask > 0]
        stroke_px = 2.0 * float(np.percentile(fg_vals, 92)) / float(scale_up)
        ratio = stroke_px / active_h
        if ratio <= 0.120:
            return "400"
        if ratio <= 0.155:
            return "500"
        if ratio <= 0.185:
            return "600"
        return "800"
    except Exception:
        return "600"


def _quick_ocr_summary(frame_bgr: Optional[np.ndarray], ocr_engine: Any) -> List[str]:
    """Lightweight OCR snippet extraction for intra-scene sub-beat change detection."""
    if frame_bgr is None or ocr_engine is None:
        return []
    try:
        h, w = frame_bgr.shape[:2]
        target_w = min(640, w)
        if w > target_w:
            img = cv2.resize(frame_bgr, (target_w, max(16, int(round(h * (target_w / float(w)))))), interpolation=cv2.INTER_AREA)
        else:
            img = frame_bgr
        res, _ = ocr_engine(img)
        if not res:
            return []
        words: List[str] = []
        for _, text, score in res:
            clean = text.strip()
            if score < 0.50 or not clean:
                continue
            # Drop 1-2 char OCR noise fragments (e.g. ".S" from a stylized glyph + dot)
            # so subBeats never trick agents into rendering literal punctuation noise.
            alnum = "".join(ch for ch in clean if ch.isalnum())
            if len(alnum) < 2 and clean != alnum:
                continue
            if len(clean) <= 2 and clean.startswith("."):
                continue
            words.append(clean)
        try:
            from ref_motion_clues import sanitize_ocr_tokens_for_clues
            words = sanitize_ocr_tokens_for_clues(words)
        except Exception:
            pass
        return words[:5]
    except Exception:
        return []


def extract_scene_sub_beats(
    fr_start: Optional[np.ndarray],
    fr_mid: Optional[np.ndarray],
    fr_end: Optional[np.ndarray],
    ts_start: float,
    ts_mid: float,
    ts_end: float,
    dur: float,
    mid_words: List[str],
    ocr_engine: Any,
) -> List[str]:
    """Detects significant intra-scene phase shifts (e.g., ticker -> card stack, amber UI -> purple wave)."""
    if dur < 1.6 or fr_start is None or fr_end is None:
        return []
    phases: List[str] = []
    start_words = _quick_ocr_summary(fr_start, ocr_engine)
    end_words = _quick_ocr_summary(fr_end, ocr_engine)

    def _luma(f: np.ndarray) -> float:
        return float(np.mean(cv2.cvtColor(cv2.resize(f, (64, 36)), cv2.COLOR_BGR2GRAY)))

    ls, lm, le = _luma(fr_start), (_luma(fr_mid) if fr_mid is not None else 0.0), _luma(fr_end)
    sa = cv2.resize(fr_start, (96, 54)).astype(np.float32)
    se = cv2.resize(fr_end, (96, 54)).astype(np.float32)
    diff_se = float(np.mean(np.abs(se - sa)) / 255.0)
    words_changed = (
        set(w.lower() for w in start_words) != set(w.lower() for w in end_words)
        and (bool(start_words) or bool(end_words))
    )
    if diff_se >= 0.06 or words_changed or abs(ls - le) >= 18.0:
        s_txt = ", ".join(start_words[:3]) if start_words else f"luma={ls:.0f}"
        m_txt = ", ".join(mid_words[:3]) if mid_words else f"luma={lm:.0f}"
        e_txt = ", ".join(end_words[:3]) if end_words else f"luma={le:.0f}"
        phases.append(f"early@{ts_start:.2f}s:[{s_txt}] -> mid@{ts_mid:.2f}s:[{m_txt}] -> late@{ts_end:.2f}s:[{e_txt}]")
    return phases


def _write_vision_copy(
    img: Optional[np.ndarray],
    vision_dir: Path,
    filename: str,
    max_edge: int = 540,
    quality: int = 78,
) -> None:
    if img is None or img.size == 0:
        return
    h, w = img.shape[:2]
    if h <= 0 or w <= 0:
        return
    longest = max(h, w)
    out = img
    if longest > max_edge:
        scale = max_edge / float(longest)
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        out = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    vision_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(vision_dir / filename), out, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])


def build_dense_contact_sheets(
    frame_lookup: Any,
    sample_timestamps: List[float],
    aspect_w: int,
    aspect_h: int,
    out_dir: Path,
) -> List[str]:
    """Builds compact timestamped contact sheets (6 cols x up to 3 rows = 18 frames) for full temporal vision."""
    if not sample_timestamps:
        return []
    tile_w = 240
    tile_h = max(120, min(568, int(round(tile_w * (aspect_h / max(1, aspect_w))))))
    tiles: List[np.ndarray] = []
    for ts in sample_timestamps:
        fr = frame_lookup(ts)
        if fr is None:
            continue
        sm = cv2.resize(fr, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
        cv2.rectangle(sm, (4, 4), (92, 24), (10, 10, 14), -1)
        cv2.putText(sm, f"{ts:.2f}s", (8, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (248, 248, 252), 1, cv2.LINE_AA)
        tiles.append(sm)
    if not tiles:
        return []

    cols = 6
    max_per_sheet = 18
    sheet_rels: List[str] = []
    for sheet_idx, offset in enumerate(range(0, min(len(tiles), max_per_sheet * 3), max_per_sheet), 1):
        chunk = tiles[offset:offset + max_per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        canvas = np.zeros((rows * tile_h, cols * tile_w, 3), dtype=np.uint8)
        for i, tile in enumerate(chunk):
            r, c = divmod(i, cols)
            canvas[r * tile_h:(r + 1) * tile_h, c * tile_w:(c + 1) * tile_w] = tile
        name = f"contact_sheet_{sheet_idx}.jpg"
        cv2.imwrite(str(out_dir / name), canvas, [cv2.IMWRITE_JPEG_QUALITY, 88])
        _write_vision_copy(canvas, out_dir / "vision", name, max_edge=1280, quality=84)
        sheet_rels.append(name)
    return sheet_rels


def build_scene_composite_card(
    frame_lookup: Any,
    hero_frame: Optional[np.ndarray],
    hero_ts: float,
    beat_timestamps: List[float],
    aspect_w: int,
    aspect_h: int,
    out_path: Path,
) -> Optional[str]:
    """Builds a high-res single-scene Composite Card (Hero HD + 6 Beat subframes)."""
    if hero_frame is None:
        hero_frame = frame_lookup(hero_ts)
    if hero_frame is None:
        return None

    portrait = aspect_h > aspect_w
    gap = 4
    bg_color = (14, 14, 18)

    if len(beat_timestamps) > 6:
        idxs = [int(round(k * (len(beat_timestamps) - 1) / 5.0)) for k in range(6)]
        selected_beats = [beat_timestamps[idx] for idx in idxs]
    else:
        selected_beats = list(beat_timestamps[:6])

    if portrait:
        hero_w = 540
        hero_h = max(480, min(960, int(round(hero_w * (aspect_h / max(1, aspect_w))))))
        hero_h -= hero_h % 3
        tile_h = max(120, hero_h // 3)
        tile_w = max(90, int(round(tile_h * (aspect_w / max(1, aspect_h)))))
        grid_cols, grid_rows = 2, 3
        total_h = (grid_rows * tile_h) + ((grid_rows - 1) * gap)
        hero_h = total_h
        total_w = hero_w + gap + (grid_cols * tile_w) + ((grid_cols - 1) * gap)
        canvas = np.full((total_h, total_w, 3), bg_color, dtype=np.uint8)
        hero_panel = cv2.resize(hero_frame, (hero_w, hero_h), interpolation=cv2.INTER_AREA)
        cv2.rectangle(hero_panel, (6, 6), (146, 30), (14, 14, 18), -1)
        cv2.putText(
            hero_panel,
            f"HERO {hero_ts:.2f}s",
            (12, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 208, 96),
            1,
            cv2.LINE_AA,
        )
        canvas[0:hero_h, 0:hero_w] = hero_panel
        grid_x0, grid_y0 = hero_w + gap, 0
    else:
        hero_w = 960
        hero_h = max(320, min(640, int(round(hero_w * (aspect_h / max(1, aspect_w))))))
        tile_w = max(160, (hero_w - 2 * gap) // 3)
        tile_h = max(96, int(round(tile_w * (aspect_h / max(1, aspect_w)))))
        grid_cols, grid_rows = 3, 2
        total_w = max(hero_w, (grid_cols * tile_w) + ((grid_cols - 1) * gap))
        total_h = hero_h + gap + (grid_rows * tile_h) + ((grid_rows - 1) * gap)
        canvas = np.full((total_h, total_w, 3), bg_color, dtype=np.uint8)
        hero_panel = cv2.resize(hero_frame, (total_w, hero_h), interpolation=cv2.INTER_AREA)
        cv2.rectangle(hero_panel, (6, 6), (156, 32), (14, 14, 18), -1)
        cv2.putText(
            hero_panel,
            f"HERO {hero_ts:.2f}s",
            (12, 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.58,
            (255, 208, 96),
            1,
            cv2.LINE_AA,
        )
        canvas[0:hero_h, 0:total_w] = hero_panel
        grid_x0, grid_y0 = 0, hero_h + gap

    for idx, ts in enumerate(selected_beats):
        fr = frame_lookup(ts)
        if fr is None:
            continue
        r, c = divmod(idx, grid_cols)
        x = grid_x0 + c * (tile_w + gap)
        y = grid_y0 + r * (tile_h + gap)
        tile = cv2.resize(fr, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
        cv2.rectangle(tile, (4, 4), (78, 22), (10, 10, 14), -1)
        cv2.putText(
            tile,
            f"{ts:.2f}s",
            (8, 17),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.44,
            (248, 248, 252),
            1,
            cv2.LINE_AA,
        )
        canvas[y:y + tile_h, x:x + tile_w] = tile

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    try:
        vision_dir = out_path.parent.parent / "vision"
        _write_vision_copy(canvas, vision_dir, out_path.name, max_edge=1280, quality=84)
    except Exception:
        pass
    return out_path.name


def build_scene_beats_strip(
    frame_lookup: Any,
    beat_timestamps: List[float],
    aspect_w: int,
    aspect_h: int,
    out_path: Path,
) -> Optional[str]:
    """Renders a high-resolution per-scene 3x2 (or 2x2) storyboard strip showing intra-scene morphs."""
    valid_pairs: List[Tuple[float, np.ndarray]] = []
    for ts in beat_timestamps:
        fr = frame_lookup(ts)
        if fr is not None and fr.size > 0:
            valid_pairs.append((ts, fr))
    if len(valid_pairs) < 2:
        return None
    cols = 3 if len(valid_pairs) >= 5 else 2
    rows = int(math.ceil(len(valid_pairs) / float(cols)))
    panel_w = 512 if aspect_w >= aspect_h else 320
    panel_h = max(120, int(round(panel_w * (aspect_h / float(max(1, aspect_w))))))
    sheet = np.full((rows * panel_h, cols * panel_w, 3), 12, dtype=np.uint8)
    for idx, (ts, fr) in enumerate(valid_pairs[: rows * cols]):
        r, c = divmod(idx, cols)
        resized = cv2.resize(fr, (panel_w, panel_h), interpolation=cv2.INTER_AREA)
        cv2.rectangle(resized, (0, 0), (112, 30), (10, 10, 12), -1)
        cv2.putText(
            resized,
            f"{ts:.2f}s",
            (8, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        sheet[r * panel_h : (r + 1) * panel_h, c * panel_w : (c + 1) * panel_w] = resized
    cv2.imwrite(str(out_path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])
    try:
        vision_dir = out_path.parent.parent / "vision"
        _write_vision_copy(sheet, vision_dir, out_path.name, max_edge=1080, quality=80)
    except Exception:
        pass
    return out_path.name


def _get_ocr_engine() -> Optional[Any]:
    global _RAPID_OCR, _RAPID_OCR_LOADED
    if _RAPID_OCR_LOADED:
        return _RAPID_OCR
    _RAPID_OCR_LOADED = True
    if os.environ.get("AETHERIA_DISABLE_OCR") == "1":
        return None
    try:
        from rapidocr_onnxruntime import RapidOCR
        _RAPID_OCR = RapidOCR()
    except Exception:
        _RAPID_OCR = None
    return _RAPID_OCR


def _bgr_to_hex(bgr: np.ndarray) -> str:
    b, g, r = int(np.clip(bgr[0], 0, 255)), int(np.clip(bgr[1], 0, 255)), int(np.clip(bgr[2], 0, 255))
    return f"#{r:02X}{g:02X}{b:02X}"


def _luma_from_bgr(bgr: np.ndarray) -> float:
    return float(0.114 * bgr[0] + 0.587 * bgr[1] + 0.299 * bgr[2])


def _chroma_from_bgr(bgr: np.ndarray) -> float:
    return float(max(bgr) - min(bgr))


def _color_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a.astype(np.float32) - b.astype(np.float32)))


def extract_true_scene_palette(frame_bgr: np.ndarray) -> Dict[str, Any]:
    """Extracts true measured background, surface, contrast text, and vibrant accent colors."""
    if frame_bgr is None or frame_bgr.size == 0:
        return {
            "bgHex": "#141418",
            "surfaceHex": "#1E1E24",
            "textHex": "#F4F4F6",
            "accentHex": "#F59E0B",
            "secondaryAccentHex": "#38BDF8",
            "isDark": True,
            "meanLuma": 24.0,
            "extractedColors": ["#141418", "#F4F4F6", "#F59E0B"],
        }

    h, w, _ = frame_bgr.shape
    border_strip = max(4, min(12, min(h, w) // 20))
    border_pixels = np.vstack([
        frame_bgr[0:border_strip, :, :].reshape(-1, 3),
        frame_bgr[-border_strip:, :, :].reshape(-1, 3),
        frame_bgr[:, 0:border_strip, :].reshape(-1, 3),
        frame_bgr[:, -border_strip:, :].reshape(-1, 3),
    ])
    bg_bgr = np.median(border_pixels, axis=0)
    bg_hex = _bgr_to_hex(bg_bgr)
    bg_luma = _luma_from_bgr(bg_bgr)

    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    mean_luma = float(np.mean(gray))
    is_dark = bg_luma < 120.0

    small = cv2.resize(frame_bgr, (64, 64), interpolation=cv2.INTER_AREA)
    pixels_float = np.float32(small.reshape(-1, 3))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
    k = min(6, len(pixels_float))
    _, labels, centers = cv2.kmeans(pixels_float, k, None, criteria, 8, cv2.KMEANS_PP_CENTERS)

    counts = np.bincount(labels.flatten(), minlength=k)
    ranked_indices = np.argsort(-counts)
    ranked_centers = [centers[idx] for idx in ranked_indices]
    extracted_colors = [_bgr_to_hex(c) for c in ranked_centers]

    # Pick highest-contrast non-background cluster for primary foreground text
    best_text = max(ranked_centers, key=lambda c: abs(_luma_from_bgr(c) - bg_luma))
    if abs(_luma_from_bgr(best_text) - bg_luma) < 60.0:
        text_hex = "#F8FAFC" if is_dark else "#111827"
    else:
        text_hex = _bgr_to_hex(best_text)

    # Pick surface color distinct from bg but closer in luma than text
    surface_candidates = [
        c for c in ranked_centers
        if 14.0 <= _color_distance(c, bg_bgr) <= 130.0
    ]
    if surface_candidates:
        surface_hex = _bgr_to_hex(surface_candidates[0])
    else:
        delta = 18.0 if is_dark else -16.0
        surface_hex = _bgr_to_hex(np.clip(bg_bgr + delta, 0, 255))

    # Pick top vibrant accent clusters distinct from bg
    vibrant = sorted(
        [c for c in ranked_centers if _color_distance(c, bg_bgr) > 25.0],
        key=lambda c: _chroma_from_bgr(c) + 0.15 * _color_distance(c, bg_bgr),
        reverse=True,
    )
    accent_hex = _bgr_to_hex(vibrant[0]) if len(vibrant) >= 1 else text_hex
    secondary_accent = _bgr_to_hex(vibrant[1]) if len(vibrant) >= 2 else accent_hex

    return {
        "bgHex": bg_hex,
        "surfaceHex": surface_hex,
        "textHex": text_hex,
        "accentHex": accent_hex,
        "secondaryAccentHex": secondary_accent,
        "isDark": bool(is_dark),
        "meanLuma": round(mean_luma, 1),
        "extractedColors": extracted_colors,
    }


def analyze_frame_layout(frame_bgr: np.ndarray, ocr_engine: Optional[Any] = None) -> Dict[str, Any]:
    """Extracts normalized bounding boxes, text bands, visual archetype, and true palette."""
    if frame_bgr is None:
        return {
            "top": [],
            "hero": [],
            "bottom": [],
            "regions": [],
            "has_card": False,
            "card_count": 0,
            "pill_count": 0,
            "scatter_count": 0,
            "bg_hex": "#141418",
            "is_dark_scene": True,
            "visual_archetype": "high-density-kinetic-showcase",
            "palette": extract_true_scene_palette(None),
        }

    h, w, _ = frame_bgr.shape
    palette = extract_true_scene_palette(frame_bgr)
    top_items: List[str] = []
    hero_items: List[str] = []
    bottom_items: List[str] = []
    regions: List[Dict[str, Any]] = []
    text_heights: List[float] = []

    if ocr_engine is not None:
        try:
            max_ocr_w = 1280
            if w > max_ocr_w:
                ocr_scale = max_ocr_w / float(w)
                ocr_img = cv2.resize(
                    frame_bgr,
                    (max_ocr_w, max(16, int(round(h * ocr_scale)))),
                    interpolation=cv2.INTER_AREA,
                )
            else:
                ocr_scale = 1.0
                ocr_img = frame_bgr
            res, _ = ocr_engine(ocr_img)
            if res:
                inv_scale = 1.0 / ocr_scale
                for box, text, score in res:
                    if score < 0.45 or not text.strip():
                        continue
                    xs = [p[0] * inv_scale for p in box]
                    ys = [p[1] * inv_scale for p in box]
                    x0, x1 = max(0.0, min(xs)), min(float(w), max(xs))
                    y0, y1 = max(0.0, min(ys)), min(float(h), max(ys))
                    y_mid = ((y0 + y1) * 0.5) / float(h)
                    clean_text = text.strip()
                    low_clean = clean_text.lower()
                    if low_clean in ("showrea", "shosea", "showre"):
                        clean_text = "Showreel"
                    elif low_clean in ("ertem", "estem", "1 ahe", "ahe", ".s", "s."):
                        continue
                    text_heights.append((y1 - y0) / float(h))

                    zone = "hero"
                    if y_mid < 0.18:
                        top_items.append(clean_text)
                        zone = "top"
                    elif y_mid <= 0.78:
                        hero_items.append(clean_text)
                    else:
                        bottom_items.append(clean_text)
                        zone = "bottom"

                    bw = int(max(1, x1 - x0))
                    bh = int(max(1, y1 - y0))
                    est_weight = estimate_text_font_weight(frame_bgr, [int(x0), int(y0), bw, bh])
                    regions.append({
                        "kind": "text",
                        "zone": zone,
                        "text": clean_text,
                        "fontWeight": est_weight,
                        "x": round(x0 / w, 3),
                        "y": round(y0 / h, 3),
                        "w": round((x1 - x0) / w, 3),
                        "h": round((y1 - y0) / h, 3),
                        "px": [int(x0), int(y0), bw, bh],
                    })
        except Exception:
            pass

    card_count = 0
    pill_count = 0
    scatter_count = 0

    try:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 45, 140)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        text_px_boxes = [r["px"] for r in regions if r.get("kind") == "text" and r.get("px")]

        def _overlaps_text_heavily(bx: int, by: int, bw: int, bh: int) -> bool:
            b_area = max(1, bw * bh)
            for tx, ty, tw, th in text_px_boxes:
                ix0, iy0 = max(bx, tx), max(by, ty)
                ix1, iy1 = min(bx + bw, tx + tw), min(by + bh, ty + th)
                if ix1 > ix0 and iy1 > iy0:
                    inter = (ix1 - ix0) * (iy1 - iy0)
                    if inter / float(b_area) >= 0.45:
                        return True
            return False

        shape_boxes: List[Tuple[int, int, int, int, str]] = []
        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            area = cw * ch
            if area < 0.0004 * w * h:
                continue
            if cw >= 0.88 * w and ch >= 0.85 * h:
                continue
            fill_ratio = cv2.contourArea(cnt) / max(1.0, float(area))
            if cw >= 0.28 * w and ch >= 0.11 * h:
                if fill_ratio >= 0.62:
                    card_count += 1
                    shape_boxes.append((x, y, cw, ch, "card"))
                else:
                    shape_boxes.append((x, y, cw, ch, "shape"))
            elif cw >= 0.16 * w and 0.035 * h <= ch <= 0.14 * h:
                if fill_ratio >= 0.68 and not _overlaps_text_heavily(x, y, cw, ch):
                    pill_count += 1
                    shape_boxes.append((x, y, cw, ch, "pill"))
                elif not _overlaps_text_heavily(x, y, cw, ch):
                    shape_boxes.append((x, y, cw, ch, "shape"))
            elif area <= 0.03 * w * h:
                scatter_count += 1

        # Keep largest non-text regions for layout coordinates
        shape_boxes.sort(key=lambda b: b[2] * b[3], reverse=True)
        for x, y, cw, ch, kind in shape_boxes[:8]:
            crop = frame_bgr[y:y + ch, x:x + cw]
            crop_hex = _bgr_to_hex(np.median(crop.reshape(-1, 3), axis=0)) if crop.size else palette["surfaceHex"]
            regions.append({
                "kind": kind,
                "x": round(x / w, 3),
                "y": round(y / h, 3),
                "w": round(cw / w, 3),
                "h": round(ch / h, 3),
                "px": [int(x), int(y), int(cw), int(ch)],
                "fillHex": crop_hex,
            })
    except Exception:
        pass

    has_card = card_count > 0
    if palette["isDark"] and scatter_count >= 12:
        visual_archetype = "dark-3d-particle-field (Dark contrast bg + floating geometric/3D elements + bold focal headline)"
    elif pill_count >= 2 or card_count >= 2:
        visual_archetype = "staggered-card-or-node-stack (Structured multi-card/pill layout with connector/stagger choreography)"
    elif has_card and card_count == 1:
        visual_archetype = "hero-card-macro-focus (Single dominant card/frame with inset badge & kinetic metric typography)"
    else:
        visual_archetype = "high-density-kinetic-showcase (Layered kinetic typography + accent vector graphics)"

    max_text_ratio = round(max(text_heights), 3) if text_heights else 0.065

    return {
        "top": top_items,
        "hero": hero_items,
        "bottom": bottom_items,
        "regions": regions[:14],
        "has_card": has_card,
        "card_count": card_count,
        "pill_count": pill_count,
        "scatter_count": scatter_count,
        "bg_hex": palette["bgHex"],
        "is_dark_scene": palette["isDark"],
        "headlineHeightRatio": max_text_ratio,
        "visual_archetype": visual_archetype,
        "palette": palette,
    }


def scan_motion_timeline(
    cap: cv2.VideoCapture,
    total_frames: int,
    fps: float,
    duration: float,
) -> Dict[str, Any]:
    """Delegates full-timeline frame-accurate cut scanning to `ref_temporal_cuts.py`."""
    from ref_temporal_cuts import scan_motion_timeline_accurate

    return scan_motion_timeline_accurate(cap, total_frames, fps, duration)


def _classify_motion_cadence(energy: float) -> str:
    if energy >= 0.14:
        return "explosive-kinetic"
    if energy >= 0.06:
        return "fast-kinetic"
    if energy >= 0.02:
        return "smooth-motion"
    return "minimal-hold"


def select_best_hero_frame(
    start_sec: float,
    end_sec: float,
    fps: float,
    total_frames: int,
    frame_lookup: Any,
    frame_diffs: Optional[List[float]] = None,
) -> Tuple[float, Optional[np.ndarray]]:
    """Selects the cleanest, sharpest settled interior frame for `HERO` / scene analysis."""
    dur = max(0.05, float(end_sec) - float(start_sec))
    fallback_ts = round(float(start_sec) + dur * 0.50, 3)
    fallback_fr = frame_lookup(fallback_ts)
    if dur < 0.25:
        return fallback_ts, fallback_fr

    ratios = [0.22, 0.34, 0.44, 0.52, 0.62, 0.72, 0.82]
    best_ts = fallback_ts
    best_fr = fallback_fr
    best_score = -1.0
    safe_fps = max(1.0, float(fps))
    safe_total = max(1, int(total_frames))

    for r in ratios:
        cand_ts = round(float(start_sec) + dur * r, 3)
        fr = frame_lookup(cand_ts)
        if fr is None or fr.size == 0:
            continue
        sm = cv2.resize(fr, (160, 160), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY)
        mean_luma = float(np.mean(gray))
        contrast = float(np.percentile(gray, 95) - np.percentile(gray, 5))
        edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 100) > 0
        edge_density = float(np.mean(edges))

        f_idx = max(0, min(safe_total - 1, int(round(cand_ts * safe_fps))))
        local_diff = 0.0
        if frame_diffs and 0 <= f_idx < len(frame_diffs):
            local_diff = float(frame_diffs[f_idx])

        score = (edge_density + 0.002) * max(8.0, contrast) / (1.0 + local_diff / 18.0)
        score *= 1.0 - 0.15 * abs(r - 0.52)
        if mean_luma < 8.0 and contrast < 28.0:
            score *= 0.05
        elif mean_luma > 242.0 and edge_density < 0.012:
            score *= 0.08
        if score > best_score:
            best_score = score
            best_ts = cand_ts
            best_fr = fr

    return best_ts, best_fr


def extract_reference_blueprint(
    video_path_str: str,
    out_dir_str: Optional[str] = None,
    fast_mode: bool = False,
) -> Dict[str, Any]:
    v_path = Path(video_path_str).resolve()
    if not v_path.exists():
        return {"error": f"Reference video not found at: {v_path}"}

    out_dir = Path(out_dir_str).resolve() if out_dir_str else v_path.parent / "extracted"
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(v_path))
    if not cap.isOpened():
        return {"error": f"Could not decode video file with OpenCV: {v_path}"}

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    if not math.isfinite(fps) or fps <= 1.0 or fps > 240.0:
        fps = 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1080)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1920)
    duration = total_frames / fps if total_frames > 0 else 10.0
    aspect_ratio = "9:16" if height > width else ("1:1" if abs(width - height) <= 16 else "16:9")

    # 1. MotionClone-style full temporal scan + audio beat/BPM decompilation + voice/BGM classification
    with tempfile.TemporaryDirectory(prefix="aetheria_ref_audio_") as tmp_audio_dir:
        bpm, beat_timestamps, audio_profile = extract_audio_bpm_beats_and_profile(v_path, Path(tmp_audio_dir))
    bpm_source = str(audio_profile.get("bpmSource") or "fallback")
    bpm_confidence = float(audio_profile.get("bpmConfidence") or 0.0)
    temporal = scan_motion_timeline(cap, total_frames, fps, duration)
    from ref_temporal_cuts import align_cuts_with_beats

    aligned_cuts = align_cuts_with_beats(temporal.get("cuts") or [], beat_timestamps, duration)
    cut_timestamps = [float(c["cutSec"]) for c in aligned_cuts]
    temporal["cuts"] = aligned_cuts
    temporal["cutTimestamps"] = cut_timestamps
    temporal["bpm"] = bpm
    temporal["bpmSource"] = bpm_source
    temporal["bpmConfidence"] = bpm_confidence
    temporal["beatTimestamps"] = beat_timestamps
    temporal["audioProfile"] = audio_profile

    # 2. Plan all target timestamps (thumbs + per-scene start/mid/end + sub-frame + dense contact sheet grid)
    thumb_ratios = [0.10, 0.35, 0.60, 0.85]
    thumb_timestamps: List[float] = [
        round(min(max(0.0, duration - 0.05), duration * ratio), 3)
        for ratio in thumb_ratios
    ]

    sheet_step = max(0.45, duration / 52.0) if duration > 0 else 0.5
    sheet_timestamps: List[float] = []
    cur_sheet_t = 0.0
    while cur_sheet_t < max(0.2, duration - 0.05) and len(sheet_timestamps) < 54:
        sheet_timestamps.append(round(cur_sheet_t, 3))
        cur_sheet_t += sheet_step

    scene_specs: List[Tuple[int, float, float, float, str, float, float, float, List[float], List[int]]] = []
    roles = ["hook", "problem_or_context", "proof_or_demo", "cta"]
    needed_indices = set()
    for ts in thumb_timestamps + sheet_timestamps:
        needed_indices.add(min(max(0, total_frames - 1), max(0, int(round(ts * fps)))))

    from ref_camera_motion import plan_scene_camera_sample_frames

    sub_sample_ratios = [0.05, 0.16, 0.28, 0.42, 0.56, 0.70, 0.84, 0.95]
    for i, start in enumerate(cut_timestamps):
        end = cut_timestamps[i + 1] if i + 1 < len(cut_timestamps) else round(duration, 3)
        dur = max(0.35, round(end - start, 3))
        role = roles[i] if i < len(roles) else f"beat_{i + 1}"
        ts_start = round(min(duration - 0.04, start + min(0.15, dur * 0.15)), 3)
        ts_mid = round(min(duration - 0.04, start + dur * 0.50), 3)
        ts_end = round(min(duration - 0.04, max(ts_mid, end - min(0.15, dur * 0.15))), 3)
        sub_ts_list = [
            round(min(max(0.0, duration - 0.03), start + dur * r), 3)
            for r in sub_sample_ratios
        ]
        cam_indices = plan_scene_camera_sample_frames(
            start, end, fps, total_frames, temporal.get("frameDiffs")
        )
        scene_specs.append((i, start, end, dur, role, ts_start, ts_mid, ts_end, sub_ts_list, cam_indices))
        for ts in [ts_start, ts_mid, ts_end] + sub_ts_list:
            needed_indices.add(min(max(0, total_frames - 1), max(0, int(round(ts * fps)))))
        # Pre-cache exact post-cut start and pre-cut end frames for adaptive beat strip (R3)
        f_cut_lo = min(max(0, total_frames - 1), max(0, int(round(start * fps)) + 1))
        f_cut_hi = min(max(0, total_frames - 1), max(f_cut_lo, int(round(end * fps)) - 1))
        needed_indices.add(f_cut_lo)
        needed_indices.add(f_cut_hi)
        for c_idx in cam_indices:
            needed_indices.add(c_idx)

    cached_frames: Dict[int, np.ndarray] = {}
    if needed_indices:
        max_needed = max(needed_indices)
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        cur_idx = 0
        while cur_idx <= max_needed:
            if cur_idx in needed_indices:
                ok, fr = cap.read()
                if not ok:
                    break
                if fr is not None:
                    cached_frames[cur_idx] = fr
            else:
                if not cap.grab():
                    break
            cur_idx += 1

    def _frame_at(ts_sec: float) -> Optional[np.ndarray]:
        f_idx = min(max(0, total_frames - 1), max(0, int(round(ts_sec * fps))))
        cached = cached_frames.get(f_idx)
        if cached is not None:
            return cached
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
            ok, fr = cap.read()
            if ok and fr is not None:
                cached_frames[f_idx] = fr
                return fr
        return None

    vision_dir = frames_dir.parent / "vision"
    for idx, ts in enumerate(thumb_timestamps):
        frame = _frame_at(ts)
        if frame is not None:
            thumb_name = f"thumb_{idx:03d}.jpg"
            cv2.imwrite(str(frames_dir / thumb_name), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            _write_vision_copy(frame, vision_dir, thumb_name, max_edge=540, quality=78)

    # 3. Extract per-scene keyframes, true palettes, spatial layouts, clean plate & Motion AST layers
    scenes: List[Dict[str, Any]] = []
    ast_scenes: List[Dict[str, Any]] = []
    scene_palettes: List[Dict[str, Any]] = []
    ocr_engine = None if fast_mode else _get_ocr_engine()
    ocr_available = ocr_engine is not None
    ocr_warning: Optional[str] = None
    if not fast_mode and not ocr_available:
        try:
            from rapidocr_onnxruntime import RapidOCR as _ProbeOCR  # noqa: F401
            ocr_warning = "RapidOCR failed to initialize at runtime; on-screen text strings were NOT extracted."
        except Exception as _ocr_exc:
            ocr_warning = (
                f"RapidOCR unavailable ({_ocr_exc}); install core/ref_extractor/requirements.txt "
                "or rapidocr-onnxruntime to extract reference text strings."
            )

    from ref_beat_strip import select_adaptive_beat_strip_panels
    from ref_camera_motion import estimate_scene_camera_motion
    from ref_clean_plate import extract_tile_wall_clean_plate

    for i, start, end, dur, role, ts_start, ts_mid, ts_end, sub_ts_list, cam_indices in scene_specs:
        fr_start = _frame_at(ts_start)
        fr_mid = _frame_at(ts_mid)
        fr_end = _frame_at(ts_end)
        scene_sub_frames = [
            f for f in (_frame_at(t) for t in sub_ts_list)
            if f is not None
        ]
        if not scene_sub_frames:
            scene_sub_frames = [f for f in (fr_start, fr_mid, fr_end) if f is not None]

        # Intra-scene motion energy from timeline deltas + start/end frame delta
        scene_deltas = [
            d["score"] for d in temporal["deltas"]
            if start <= d["t"] <= end
        ]
        if fr_start is not None and fr_end is not None:
            s_a = cv2.resize(fr_start, (160, 160), interpolation=cv2.INTER_AREA).astype(np.float32)
            s_b = cv2.resize(fr_end, (160, 160), interpolation=cv2.INTER_AREA).astype(np.float32)
            span_delta = float(np.abs(s_b - s_a).mean() / 255.0)
        else:
            span_delta = 0.05
        motion_energy = round(max(span_delta, float(np.mean(scene_deltas)) if scene_deltas else 0.04), 4)
        cadence = _classify_motion_cadence(motion_energy)

        ts_hero, fr_hero = select_best_hero_frame(
            start, end, fps, total_frames, _frame_at, temporal.get("frameDiffs")
        )
        if fr_hero is None:
            ts_hero, fr_hero = ts_mid, fr_mid

        scene_kf_name = f"ref_scene_{i + 1:02d}.jpg"
        scene_kf_path = frames_dir / scene_kf_name
        layout_info = analyze_frame_layout(fr_hero, ocr_engine)
        if fr_hero is not None:
            cv2.imwrite(str(scene_kf_path), fr_hero, [cv2.IMWRITE_JPEG_QUALITY, 94])
            _write_vision_copy(fr_hero, vision_dir, scene_kf_name, max_edge=540, quality=78)

        # Also save start/q1/hero/q3/end sub-keyframes and a high-res per-scene beat storyboard strip
        sub_keyframes = [{"t": ts_hero, "path": f"frames/{scene_kf_name}"}]
        if fr_start is not None and dur >= 0.9:
            start_name = f"ref_scene_{i + 1:02d}_start.jpg"
            cv2.imwrite(str(frames_dir / start_name), fr_start, [cv2.IMWRITE_JPEG_QUALITY, 88])
            _write_vision_copy(fr_start, vision_dir, start_name, max_edge=540, quality=78)
            sub_keyframes.append({"t": ts_start, "path": f"frames/{start_name}"})
        if dur >= 2.2 and len(sub_ts_list) >= 6:
            ts_q1 = sub_ts_list[2]  # ~28% into scene (captures opening morphs / marquees)
            ts_q3 = sub_ts_list[5]  # ~70% into scene (captures late transitions / secondary screens)
            fr_q1 = _frame_at(ts_q1)
            fr_q3 = _frame_at(ts_q3)
            if fr_q1 is not None:
                q1_name = f"ref_scene_{i + 1:02d}_q1.jpg"
                cv2.imwrite(str(frames_dir / q1_name), fr_q1, [cv2.IMWRITE_JPEG_QUALITY, 90])
                _write_vision_copy(fr_q1, vision_dir, q1_name, max_edge=540, quality=78)
                sub_keyframes.append({"t": ts_q1, "path": f"frames/{q1_name}"})
            if fr_q3 is not None:
                q3_name = f"ref_scene_{i + 1:02d}_q3.jpg"
                cv2.imwrite(str(frames_dir / q3_name), fr_q3, [cv2.IMWRITE_JPEG_QUALITY, 90])
                _write_vision_copy(fr_q3, vision_dir, q3_name, max_edge=540, quality=78)
                sub_keyframes.append({"t": ts_q3, "path": f"frames/{q3_name}"})
        if fr_end is not None and dur >= 0.8:
            end_name = f"ref_scene_{i + 1:02d}_end.jpg"
            cv2.imwrite(str(frames_dir / end_name), fr_end, [cv2.IMWRITE_JPEG_QUALITY, 88])
            _write_vision_copy(fr_end, vision_dir, end_name, max_edge=540, quality=78)
            sub_keyframes.append({"t": ts_end, "path": f"frames/{end_name}"})
        sub_keyframes.sort(key=lambda item: float(item.get("t", 0.0)))

        camera_motion = estimate_scene_camera_motion(
            cached_frames.get, cam_indices, start, fps, width, height
        )
        beat_strip_panels = select_adaptive_beat_strip_panels(
            start,
            end,
            fps,
            total_frames,
            frame_diffs=temporal.get("frameDiffs"),
            camera_motion=camera_motion,
            max_panels=6,
            cached_frame_indices=set(cached_frames.keys()),
        )
        beat_strip_ts = [float(p["t"]) for p in beat_strip_panels]
        beat_strip_meta = [{"t": round(float(p["t"]), 3), "reason": str(p["reason"])} for p in beat_strip_panels]
        beats_strip_name = build_scene_beats_strip(
            _frame_at,
            beat_strip_ts,
            width,
            height,
            frames_dir / f"ref_scene_{i + 1:02d}_beats.jpg",
        )
        beats_strip_rel = f"frames/{beats_strip_name}" if beats_strip_name else None
        card_name = build_scene_composite_card(
            _frame_at,
            fr_hero,
            ts_hero,
            beat_strip_ts,
            width,
            height,
            frames_dir / f"ref_scene_{i + 1:02d}_card.jpg",
        )
        card_rel = f"frames/{card_name}" if card_name else None

        grid_tilt_deg = detect_grid_tilt_deg(fr_hero)
        contrast_tiles = detect_bimodal_contrast_tiles(fr_hero)
        if grid_tilt_deg is not None:
            layout_info["gridTiltDeg"] = grid_tilt_deg
        if contrast_tiles is not None:
            tile_grid = measure_contrast_tile_grid(fr_hero, grid_tilt_deg)
            if tile_grid is not None:
                contrast_tiles["grid"] = tile_grid
            layout_info["contrastTiles"] = contrast_tiles

        pal = layout_info["palette"]
        if contrast_tiles is not None:
            fr_early_cut = _frame_at(beat_strip_ts[0]) if beat_strip_ts else fr_start
            clean_plate = extract_tile_wall_clean_plate(
                fr_early_cut, fr_hero, contrast_tiles, grid_tilt_deg, pal["bgHex"]
            )
        else:
            clean_plate = extract_clean_plate_background(scene_sub_frames, pal["bgHex"])
        pal = reconcile_palette_with_clean_plate(pal, clean_plate)
        layout_info["palette"] = pal
        layout_info["bg_hex"] = pal["bgHex"]
        layout_info["is_dark_scene"] = pal["isDark"]
        start_f_idx = max(0, int(round(start * fps)))
        end_f_idx = min(max(1, total_frames), int(round(end * fps)))

        ast_layers: List[Dict[str, Any]] = []
        for r_idx, reg in enumerate(layout_info.get("regions", [])[:10]):
            px = reg.get("px") or [
                int(round(reg.get("x", 0.1) * width)),
                int(round(reg.get("y", 0.1) * height)),
                int(round(reg.get("w", 0.3) * width)),
                int(round(reg.get("h", 0.15) * height)),
            ]
            motion_curve = analyze_layer_motion_curve(
                scene_sub_frames,
                start_f_idx,
                end_f_idx,
                (int(px[0]), int(px[1]), int(px[2]), int(px[3])),
                dur,
            )
            motion_curve["startSec"] = round(min(0.45, 0.06 * r_idx), 2)
            reg["motion"] = motion_curve

            kind = reg.get("kind", "card")
            layer_id = f"layer_{kind}_{r_idx + 1}"
            box_norm = {
                "x": reg.get("x", 0.0),
                "y": reg.get("y", 0.0),
                "w": reg.get("w", 0.2),
                "h": reg.get("h", 0.1),
            }
            if kind == "text":
                est_font_px = max(18, int(round(float(box_norm["h"]) * height * 0.72)))
                est_font_weight = str(reg.get("fontWeight") or ("600" if reg.get("zone") == "hero" else "500"))
                ast_layers.append({
                    "id": layer_id,
                    "kind": "text",
                    "text": reg.get("text", ""),
                    "zone": reg.get("zone", "hero"),
                    "box": box_norm,
                    "style": {
                        "fontFamily": "Inter, sans-serif",
                        "fillHex": pal["textHex"],
                        "fontSize": est_font_px,
                        "fontWeight": est_font_weight,
                        "align": "center" if abs((box_norm["x"] + box_norm["w"] * 0.5) - 0.5) <= 0.15 else "left",
                    },
                    "motion": {"entrance": motion_curve},
                })
            else:
                ast_layers.append({
                    "id": layer_id,
                    "kind": kind,
                    "box": box_norm,
                    "style": {
                        "fillHex": reg.get("fillHex", pal["surfaceHex"]),
                        "strokeHex": pal["accentHex"],
                        "radius": 999 if kind == "pill" else 16,
                    },
                    "motion": {"entrance": motion_curve},
                })

        mid_words = layout_info.get("hero", []) + layout_info.get("top", [])
        if fast_mode:
            sub_beats = []
        else:
            sub_beats = extract_scene_sub_beats(
                fr_start, fr_mid, fr_end, ts_start, ts_mid, ts_end, dur, mid_words, ocr_engine
            )
        motion_clues: Dict[str, Any] = {}
        try:
            from ref_motion_clues import extract_scene_motion_clues

            motion_clues = extract_scene_motion_clues(
                _frame_at,
                start,
                end,
                width,
                height,
                ocr_summary_fn=(
                    (lambda f: _quick_ocr_summary(f, ocr_engine))
                    if ocr_engine is not None
                    else None
                ),
                sub_ts_list=sub_ts_list,
            )
        except Exception:
            motion_clues = {}
        layout_info["cleanPlate"] = clean_plate
        layout_info["motionClues"] = motion_clues
        if camera_motion is not None:
            layout_info["cameraMotion"] = camera_motion
        cut_ev = (
            str(aligned_cuts[i].get("evidence") or ("start" if i == 0 else "hard"))
            if i < len(aligned_cuts)
            else ("start" if i == 0 else "hard")
        )
        trans_prev = "soft" if (i > 0 and cut_ev == "soft") else ("hard" if i > 0 else "none")
        scene_id = f"scene{i + 1}_{role}"
        scene_palettes.append(pal)
        scenes.append({
            "index": i + 1,
            "id": scene_id,
            "role": role,
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": dur,
            "durationFrames": max(1, int(round(dur * fps))),
            "cutEvidence": cut_ev,
            "transitionFromPrev": trans_prev,
            "motion": cadence,
            "motionEnergy": motion_energy,
            "keyframeTimestamp": ts_hero,
            "keyframe": f"frames/{scene_kf_name}",
            "compositeCard": card_rel,
            "beatsStrip": beats_strip_rel,
            "beatStripTimestamps": [round(float(t), 3) for t in beat_strip_ts],
            "beatStripPanels": beat_strip_meta,
            "keyframes": sub_keyframes,
            "subBeats": sub_beats,
            "gridTiltDeg": grid_tilt_deg,
            "cleanPlate": clean_plate,
            "cameraMotion": camera_motion,
            "motionClues": motion_clues,
            "layout": layout_info,
        })
        if not fast_mode:
            ast_scene_obj = {
                "id": scene_id,
                "index": i + 1,
                "role": role,
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": dur,
                "cutEvidence": cut_ev,
                "transitionFromPrev": trans_prev,
                "beatsStrip": beats_strip_rel,
                "beatStripTimestamps": [round(float(t), 3) for t in beat_strip_ts],
                "beatStripPanels": beat_strip_meta,
                "subBeats": sub_beats,
                "gridTiltDeg": grid_tilt_deg,
                "contrastTiles": contrast_tiles,
                "cleanPlate": clean_plate,
                "cameraMotion": camera_motion,
                "motionClues": motion_clues,
                "layers": ast_layers,
            }
            skeleton_code = compile_scene_am_skeleton(ast_scene_obj, width, height)
            skeletons_dir = out_dir / "skeletons"
            skeletons_dir.mkdir(parents=True, exist_ok=True)
            skeleton_rel = f"skeletons/scene{i + 1}.js"
            with open(skeletons_dir / f"scene{i + 1}.js", "w", encoding="utf-8") as sf:
                sf.write(skeleton_code)
            ast_scene_obj["skeletonPath"] = f"ref/extracted/{skeleton_rel}"
            ast_scene_obj["amCodeSkeleton"] = skeleton_code
            ast_scenes.append(ast_scene_obj)

    contact_sheets = build_dense_contact_sheets(_frame_at, sheet_timestamps, width, height, out_dir)
    cap.release()

    filmstrip_info: Optional[Dict[str, Any]] = None
    if os.environ.get("AETHERIA_DISABLE_FILMSTRIP") != "1":
        try:
            import ref_filmstrip

            fs_mode = os.environ.get("AETHERIA_FILMSTRIP_MODE", "raw")
            try:
                fs_eps = float(os.environ.get("AETHERIA_FILMSTRIP_HOLD_EPS", "0.15"))
            except ValueError:
                fs_eps = 0.15
            fs_res = ref_filmstrip.generate_filmstrips(
                v_path, out_dir, scenes, mode=fs_mode, frames_per_sheet=10, hold_eps=fs_eps
            )
            if fs_res.get("ok"):
                filmstrip_info = {
                    "indexPath": "ref/extracted/filmstrip_index.json",
                    "mode": fs_res["mode"],
                    "framesPerSheet": fs_res["framesPerSheet"],
                    "holdEps": fs_res["holdEps"],
                    "totalFrames": fs_res["totalFrames"],
                    "keptTiles": fs_res["keptTiles"],
                    "sheetCount": fs_res["sheetCount"],
                    "videoMotionStats": fs_res["videoMotionStats"],
                }
                fs_by_idx = {sc["index"]: sc for sc in (fs_res.get("scenes") or [])}
                for s in scenes:
                    sc_fs = fs_by_idx.get(s["index"])
                    if sc_fs:
                        s["filmstripSheets"] = sc_fs["sheetPaths"]
                        s["motionProfile"] = {
                            "meanDelta": sc_fs["meanDelta"],
                            "medianDelta": sc_fs["medianDelta"],
                            "staticPct": sc_fs["staticPct"],
                            "nearZeroPct": sc_fs["nearZeroPct"],
                            "activeBursts": sc_fs["activeBursts"],
                        }
        except Exception:
            filmstrip_info = None

    # Global dominant palette from the first / most representative scene
    lead_palette = scene_palettes[0] if scene_palettes else extract_true_scene_palette(None)
    avg_luma = float(np.mean([p["meanLuma"] for p in scene_palettes])) if scene_palettes else 128.0
    is_light_theme = avg_luma >= 125.0

    # Save temporal.json (MotionClone pattern)
    temporal_payload = {
        "version": 2,
        "source": v_path.name,
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "duration": round(duration, 3),
        "totalFrames": total_frames,
        "scannedFrames": temporal["scannedFrames"],
        "bpm": bpm,
        "bpmSource": bpm_source,
        "bpmConfidence": bpm_confidence,
        "beatTimestamps": beat_timestamps[:64],
        "visualJumpTimestamps": temporal["visualJumpTimestamps"],
        "cutTimestamps": cut_timestamps,
        "cuts": aligned_cuts,
        "thumbTimestamps": thumb_timestamps,
    }
    temporal_json_path = out_dir / "temporal.json"
    with open(temporal_json_path, "w", encoding="utf-8") as f:
        json.dump(temporal_payload, f, indent=2)

    ast_json_path: Optional[Path] = None
    style_ast: Optional[Dict[str, Any]] = None
    if not fast_mode:
        style_ast = {
            "version": 3,
            "source": v_path.name,
            "fps": int(round(fps)),
            "width": width,
            "height": height,
            "aspectRatio": aspect_ratio,
            "bpm": bpm,
            "bpmSource": bpm_source,
            "bpmConfidence": bpm_confidence,
            "audioProfile": audio_profile,
            "contactSheets": contact_sheets,
            "beatTimestamps": beat_timestamps[:64],
            "cuts": aligned_cuts,
            "scenes": ast_scenes,
        }
        ast_json_path = out_dir / "style_ast.json"
        with open(ast_json_path, "w", encoding="utf-8") as f:
            json.dump(style_ast, f, indent=2)

    extractor_backend = (
        "python_cv2_fast"
        if fast_mode
        else ("python_cv2_rapidocr" if ocr_available else "python_cv2_no_ocr")
    )
    style_spec = {
        "version": 2,
        "title": f"Extracted Reference Style ({v_path.name})",
        "engine": "aetheria-html-motion",
        "fidelityTarget": 0.90,
        "totalDuration": round(duration, 3),
        "fps": int(round(fps)),
        "bpm": bpm,
        "bpmSource": bpm_source,
        "bpmConfidence": bpm_confidence,
        "audioProfile": audio_profile,
        "cuts": aligned_cuts,
        "contactSheets": contact_sheets,
        "aspectRatio": aspect_ratio,
        "width": width,
        "height": height,
        "resolution": f"{width}x{height}",
        "theme": "light-measured" if is_light_theme else "dark-measured",
        "palette": {
            "primary": lead_palette["bgHex"],
            "surface": lead_palette["surfaceHex"],
            "text": lead_palette["textHex"],
            "accent": lead_palette["accentHex"],
            "secondaryAccent": lead_palette["secondaryAccentHex"],
            "extractedColors": lead_palette["extractedColors"],
        },
        "typography": {
            "headlineScaleRatio": round(float(np.mean([
                s["layout"].get("headlineHeightRatio", 0.065) for s in scenes
            ])), 3) if scenes else 0.065,
            "safeInsets": {"top": 120, "bottom": 240, "left": 64, "right": 140}
            if aspect_ratio == "9:16"
            else {"top": 64, "bottom": 120, "left": 80, "right": 80},
        },
        "visualJumpTimestamps": temporal["visualJumpTimestamps"],
        "ocrAvailable": ocr_available,
        "ocrWarning": ocr_warning,
        "extractorBackend": extractor_backend,
        "astPath": "ref/extracted/style_ast.json" if ast_json_path is not None else None,
        "filmstrip": filmstrip_info,
        "scenes": scenes,
    }

    style_json = out_dir / "style.json"
    with open(style_json, "w", encoding="utf-8") as f:
        json.dump(style_spec, f, indent=2)

    spec_legacy = out_dir / "style_spec.json"
    with open(spec_legacy, "w", encoding="utf-8") as f:
        json.dump(style_spec, f, indent=2)

    report_md = out_dir / "ref_report.md"
    theme_label = "Measured Light" if is_light_theme else "Measured Dark"
    ocr_banner = (
        f"\n> **WARNING (OCR Unavailable):** {ocr_warning} Inspect the extracted keyframes directly for exact copy/typography.\n"
        if not ocr_available and ocr_warning
        else ""
    )

    audio_mode_line = f"{audio_profile.get('mode', 'bgm-sfx-only')} (speechLikelihood={audio_profile.get('speechLikelihood', 0.0):.2f})"
    bpm_display = f"{bpm:.1f} (measured, conf={bpm_confidence:.2f})" if bpm_source == "measured" else f"BPM tak terukur (fallback={bpm:.1f})"
    cuts_display = ", ".join(
        f"{c['cutSec']:.3f}s[{c.get('evidence', 'hard')}]"
        + (f"(onset={c['nearestOnsetSec']:.3f}s)" if c.get("nearestOnsetSec") is not None and c.get("cutSec", 0.0) > 0.0 else "")
        for c in aligned_cuts
    )
    sheets_line = ", ".join(f"ref/extracted/{cs}" for cs in contact_sheets) if contact_sheets else "none"
    filmstrip_line = (
        f"**1/1 Filmstrip Index:** `{filmstrip_info['indexPath']}` "
        f"(`{filmstrip_info['sheetCount']}` sheets, `{filmstrip_info['keptTiles']}/{filmstrip_info['totalFrames']}` tiles, "
        f"mode=`{filmstrip_info['mode']}`, 10 frames/sheet — call `read_filmstrip({{ sceneIndex }})`)\n"
        if filmstrip_info
        else ""
    )
    ast_line = (
        "**Decompiled Motion AST:** `ref/extracted/style_ast.json` (version 3)"
        if ast_json_path is not None
        else "**Extraction Mode:** Fast visual mode (no CPU OCR / no AST skeleton; use `filmstrips/` + `_card.jpg` as ground truth)"
    )
    md = f"""# Reference Video Analysis Report (MotionClone Blueprint)
**Source:** `{v_path.name}`
**Duration:** {duration:.2f}s | **FPS:** {int(round(fps))} | **BPM:** {bpm_display} | **Resolution:** {width}x{height} ({aspect_ratio})
**Audio Profile:** `{audio_mode_line}`
**Dense Contact Sheets:** `{sheets_line}`
{filmstrip_line}**Detected Tone:** {theme_label} (Mean Luma: {avg_luma:.1f})
**Detected Scene Cuts:** {len(cut_timestamps)} scenes (`{cuts_display}`)
**Extractor Backend:** `{style_spec['extractorBackend']}` (`ocrAvailable={ocr_available}`)
{ast_line}
{ocr_banner}

## Measured Color Tokens (From Reference Pixels)
- Primary Background: `{lead_palette['bgHex']}`
- Card / Surface: `{lead_palette['surfaceHex']}`
- Foreground / Text: `{lead_palette['textHex']}`
- Primary Accent: `{lead_palette['accentHex']}`
- Secondary Accent: `{lead_palette['secondaryAccentHex']}`
- Palette Clusters: `{", ".join(lead_palette['extractedColors'])}`

## Scene Breakdown & Timing ({len(scenes)} Scenes)
| # | Scene ID | Start | End | Duration | Motion Cadence | Energy | Keyframe |
|---|----------|-------|-----|----------|----------------|--------|----------|
"""
    for s in scenes:
        md += (
            f"| {s['index']} | `{s['id']}` | {s['start']:.2f}s | {s['end']:.2f}s | "
            f"{s['duration']:.2f}s ({s['durationFrames']}f) | `{s['motion']}` | {s['motionEnergy']:.3f} | `{s['keyframe']}` |\n"
        )

    md += "\n## Per-Scene Palette, Spatial Regions & Choreography\n"
    for s in scenes:
        ly = s["layout"]
        pal = ly["palette"]
        cp = s.get("cleanPlate") or {"fillHex": pal["bgHex"], "hasGradient": False}
        md += f"\n### Scene {s['index']}: `{s['id']}` ({s['start']:.2f}s - {s['end']:.2f}s, {s['duration']:.2f}s)\n"
        if s.get("compositeCard"):
            md += f"- **Hero + 6-Beat Card:** `ref/extracted/{s['compositeCard']}`\n"
        if s.get("filmstripSheets"):
            fs_sheets = s["filmstripSheets"]
            fs_span = fs_sheets[0] if len(fs_sheets) == 1 else f"{fs_sheets[0]}..{fs_sheets[-1]}"
            mp = s.get("motionProfile") or {}
            burst_str = ", ".join(
                f"{b['tStart']:.2f}-{b['tEnd']:.2f}s(p={b['peakDelta']:.1f})"
                for b in (mp.get("activeBursts") or [])[:5]
            )
            md += (
                f"- **1/1 Filmstrip ({len(fs_sheets)} sheets):** `ref/extracted/{fs_span}` | "
                f"meanDelta=`{mp.get('meanDelta', 0):.2f}`, static=`{mp.get('staticPct', 0):.1f}%`"
                + (f", bursts=`[{burst_str}]`" if burst_str else "")
                + "\n"
            )
        cp_extra = ""
        if cp.get("kind"):
            cp_extra += f", kind=`{cp.get('kind')}`"
        if cp.get("confidence"):
            cp_extra += f", confidence=`{cp.get('confidence')}`"
        md += f"- **Clean Plate Background:** fill=`{cp.get('fillHex')}`, hasGradient=`{cp.get('hasGradient')}`{cp_extra}\n"
        md += f"- **Measured Palette:** bg=`{pal['bgHex']}`, surface=`{pal['surfaceHex']}`, text=`{pal['textHex']}`, accent=`{pal['accentHex']}`\n"
        if not fast_mode:
            md += f"- **Visual Archetype:** `{ly.get('visual_archetype')}`\n"
        md += f"- **Density:** `{ly.get('card_count', 0)}` cards, `{ly.get('pill_count', 0)}` pills, `{ly.get('scatter_count', 0)}` scatter elements | **Motion Energy:** `{s['motionEnergy']:.3f}` (`{s['motion']}`)\n"
        if ly.get("top"):
            md += f"- **Top Text Zone:** {', '.join([json.dumps(t) for t in ly['top'][:4]])}\n"
        if ly.get("hero"):
            md += f"- **Hero Text Zone:** {', '.join([json.dumps(t) for t in ly['hero'][:8]])}\n"
        if ly.get("bottom"):
            md += f"- **Bottom Text Zone:** {', '.join([json.dumps(t) for t in ly['bottom'][:3]])}\n"
        if ly.get("regions") and not fast_mode:
            reg_summaries = []
            for r in ly["regions"][:6]:
                mot = r.get("motion") or {}
                curve_label = f"{mot.get('direction', 'pop')}:{mot.get('curve', 'AM.spring')}"
                px_x = int(round(float(r.get("x", 0.0)) * width))
                px_y = int(round(float(r.get("y", 0.0)) * height))
                px_w = int(round(float(r.get("w", 0.2)) * width))
                px_h = int(round(float(r.get("h", 0.1)) * height))
                if r.get("kind") == "text":
                    est_font_px = max(18, int(round(float(r.get("h", 0.1)) * height * 0.72)))
                    fw = str(r.get("fontWeight") or ("600" if r.get("zone") == "hero" else "500"))
                    lbl = (r.get("text") or "").replace('"', "'").strip()[:22]
                    reg_summaries.append(
                        f'text"{lbl}"@({px_x},{px_y},{px_w}x{px_h}px,font={fw} {est_font_px}px)[{curve_label}]'
                    )
                else:
                    reg_summaries.append(
                        f"{r['kind']}@({px_x},{px_y},{px_w}x{px_h}px)[{curve_label}]"
                    )
            md += f"- **Measured Pixel Regions & Typography (x,y,wxh px)[dir:curve]:** `{', '.join(reg_summaries)}`\n"
        if s.get("gridTiltDeg") is not None:
            tilt_val = float(s["gridTiltDeg"])
            tilt_rad = round(math.radians(tilt_val), 4)
            md += f"- **Detected Grid/Layout Tilt:** `{tilt_val:+.1f} deg` (rotate scene grid by `ctx.rotate({tilt_rad})` around canvas center — check top-left cell polarity vs `ref_scene_XX.jpg`)\n"
        cm = s.get("cameraMotion")
        confident_segs = [
            seg for seg in (cm.get("segments") or []) if seg.get("confidence") != "low"
        ] if cm else []
        if confident_segs:
            seg_parts = []
            for seg in confident_segs:
                seg_parts.append(
                    f"local {seg['t0']:.2f}s->{seg['t1']:.2f}s "
                    f"scale={seg['scaleFrom']:.3f}->{seg['scaleTo']:.3f} "
                    f"rot={seg['rotDegFrom']:+.2f}->{seg['rotDegTo']:+.2f}deg "
                    f"pan=({seg['txFrom']:+.1f},{seg['tyFrom']:+.1f})->({seg['txTo']:+.1f},{seg['tyTo']:+.1f})px "
                    f"ease={seg['ease']} conf={seg['confidence']}"
                )
            piv = cm.get("pivot") or {"x": 0.5, "y": 0.5}
            md += f"- **Global Camera Motion (`AM.applyCamera`):** `{' ; '.join(seg_parts)}` | pivot=({piv.get('x', 0.5):.3f}, {piv.get('y', 0.5):.3f})\n"
        ct = ly.get("contrastTiles")
        if ct and ct.get("grid"):
            grid = ct["grid"]
            icon_rule = f" | **{grid.get('iconRule', '')}**" if grid.get("iconRule") else ""
            md += (
                f"- **High-Contrast Tile Wall (measured, NOT a checkerboard):** `lightTile={ct['lightTileHex']}`, `darkTile={ct['darkTileHex']}`, "
                f"`pitch={grid['pitchX']}x{grid['pitchY']}px`, `origin=({grid['originX']},{grid['originY']})`, `{grid['cols']} cols x {grid['rows']} rows`, "
                f"rows top->bottom (`L`=lightTile, `D`=darkTile, `M`=mid grey): `{' / '.join(grid['map'])}` — after the tilt rotate, draw cell (r,c) at "
                f"`originX + c*pitchX, originY + r*pitchY` sized `pitch - 8px` over a near-black gap background, colored EXACTLY per this map{icon_rule}\n"
            )
        elif ct:
            md += f"- **High-Contrast Tiles:** `lightTile={ct['lightTileHex']}`, `darkTile={ct['darkTileHex']}`, `topLeft={ct['topLeft']}` — crisp `lightTile` and near-black `darkTile` placed where `ref_scene_XX.jpg` shows them (NEVER substitute medium grey for dark tiles, and draw contrast-inverted vector icons inside BOTH light and dark tiles)\n"
        if s.get("subBeats"):
            md += f"- **Intra-Scene Multi-Beat Shifts:** `{' | '.join(s['subBeats'])}`\n"
        mc = s.get("motionClues") or {}
        if mc.get("inlineGlyphMorph"):
            md += f"- **Inline Glyph Morph (CRITICAL):** `{mc['inlineGlyphMorph']}`\n"
        if mc.get("heroCardBox"):
            md += f"- **Centered Hero Card Over Blurred Backdrop (CRITICAL):** `heroCardBox={mc['heroCardBox']}`, `backdrop={mc.get('blurredBackdrop', '')}`\n"
        if mc.get("saturatedAccents"):
            acc_strs = [
                f"{a['hex']}@({a['box'][0]},{a['box'][1]},{a['box'][2]}x{a['box'][3]}px)@{a['timestamp']:.2f}s"
                for a in mc["saturatedAccents"]
            ]
            md += f"- **Saturated Accent Callouts (small high-chroma elements missed by global palette):** `{', '.join(acc_strs)}`\n"
        if mc.get("containerClip"):
            cc = mc["containerClip"]
            ob = cc["outerBox"]
            ib = cc["innerClipRect"]
            md += (
                f"- **Container & Inner Screen ClipRect (MUST `ctx.clip()` so content never spills outside):** "
                f"`outerBezel=[{ob[0]},{ob[1]},{ob[2]}x{ob[3]}px]`, `innerClipRect=[{ib[0]},{ib[1]},{ib[2]}x{ib[3]}px]`\n"
            )
        if mc.get("objectTrajectory"):
            md += f"- **Measured Foreground Trajectory (t -> box[x,y,wxh]):** `{mc['objectTrajectory']}`\n"
        if mc.get("kineticClues"):
            md += f"- **Kinetic Layout Clues:** `{' ; '.join(mc['kineticClues'])}`\n"
        if mc.get("denseTimeline"):
            tl_parts = []
            for te in mc["denseTimeline"]:
                b_str = f"[{te['box'][0]},{te['box'][1]},{te['box'][2]}x{te['box'][3]}]" if te.get("box") else "[]"
                w_str = f" words={te['words']}" if te.get("words") else ""
                tl_parts.append(f"{te['t']:.2f}s:{b_str}{w_str}")
            md += f"- **Dense 6-Slice Timeline (exact position/size/words per timestamp):** `{' -> '.join(tl_parts)}`\n"

    md += f"""
## Reference Visual & Timing Notes
1. **VISION BEATS RAW OCR (`contact_sheet_*.jpg` + `frames/ref_scene_*.jpg`)**: Treat the keyframes and contact sheets as visual ground truth. OCR text and bounding boxes above are timing/coordinate hints only — never copy garbled OCR fragments or invent badges/pills not clearly present in the frames.
2. **EXACT TIMING & MULTI-PHASE CHOREOGRAPHY (`index.html`)**: Mirror the measured timings and `{width}x{height}` (`{int(round(fps))}fps`) `window.__filmMeta` contract with deterministic `window.renderAt(t)` and `window.__ready = true`, using whichever web stack fits the visual craft best (self-contained HTML + CSS Grid/Flexbox + CSS 3D `perspective`/`preserve-3d` + Inline SVG & `<filter>` + Canvas/WebGL in `index.html`, or optional modular `script/scene*.js`).
3. **PER-SCENE PALETTE & TYPOGRAPHY FIDELITY**: Match each scene's measured clean-plate background, surfaces, high-contrast accents, and typographic hierarchy.
4. **VISUAL SELF-VERIFICATION**: After authoring or editing, verify rendered frames via `capture_film_preview` (full-res screenshots attach automatically for standalone/hybrid `index.html`; `compareToReference: true` is optional and advisory on standalone/hybrid films unless `passThreshold` is set) and refine surgically until crisp.
"""

    with open(report_md, "w", encoding="utf-8") as f:
        f.write(md)

    return {
        "success": True,
        "fastMode": fast_mode,
        "reportPath": str(report_md),
        "stylePath": str(style_json),
        "specPath": str(style_json),
        "astPath": str(ast_json_path) if ast_json_path is not None else None,
        "temporalPath": str(temporal_json_path),
        "blueprint": style_spec,
        "motionAst": style_ast,
    }


if __name__ == "__main__":
    cli_args = [a for a in sys.argv[1:] if not a.startswith("--")]
    fast_flag = "--fast" in sys.argv[1:]
    vid = cli_args[0] if len(cli_args) > 0 else "workspace/ref/reference.mp4"
    out = cli_args[1] if len(cli_args) > 1 else "workspace/ref/extracted"
    res = extract_reference_blueprint(vid, out, fast_mode=fast_flag)
    print(json.dumps(res, indent=2))
