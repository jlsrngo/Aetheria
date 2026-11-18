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


def extract_audio_bpm_and_beats(video_path: Path, temp_dir: Path) -> Tuple[float, List[float]]:
    """Demuxes reference audio to 22.05kHz mono WAV and extracts BPM + transient beat timestamps."""
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
        return 120.0, []

    if not wav_path.is_file():
        return 120.0, []

    try:
        with wave.open(str(wav_path), "rb") as w:
            sr = int(w.getframerate() or 22050)
            n_frames = w.getnframes()
            if n_frames <= 0:
                return 120.0, []
            raw_bytes = w.readframes(n_frames)
        samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size < sr // 2:
            return 120.0, []

        hop = max(256, int(round(sr * 0.05)))  # 50ms windows
        energies: List[float] = []
        flux: List[float] = []
        prev_mag: Optional[np.ndarray] = None
        for i in range(0, len(samples) - hop, hop):
            chunk = samples[i:i + hop]
            rms = float(np.sqrt(np.mean(chunk * chunk)))
            energies.append(rms)
            mag = np.abs(np.fft.rfft(chunk * np.hanning(len(chunk))))
            if prev_mag is not None and prev_mag.shape == mag.shape:
                diff = mag - prev_mag
                half_rect = 0.5 * (diff + np.abs(diff))
                flux.append(float(np.sum(half_rect)))
            else:
                flux.append(0.0)
            prev_mag = mag

        if not energies or float(np.max(energies)) < 1e-4:
            return 120.0, []

        e_arr = np.asarray(energies, dtype=np.float32)
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

        if len(beat_times) >= 3:
            intervals = [
                beat_times[k + 1] - beat_times[k]
                for k in range(len(beat_times) - 1)
                if 0.25 <= (beat_times[k + 1] - beat_times[k]) <= 1.2
            ]
            if intervals:
                median_ioi = float(np.median(intervals))
                raw_bpm = 60.0 / max(0.25, median_ioi)
                while raw_bpm < 75.0:
                    raw_bpm *= 2.0
                while raw_bpm > 175.0:
                    raw_bpm *= 0.5
                bpm = round(raw_bpm, 1)
            else:
                bpm = 120.0
        else:
            bpm = 120.0
        return bpm, beat_times
    except Exception:
        return 120.0, []


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

                    regions.append({
                        "kind": "text",
                        "zone": zone,
                        "text": clean_text,
                        "x": round(x0 / w, 3),
                        "y": round(y0 / h, 3),
                        "w": round((x1 - x0) / w, 3),
                        "h": round((y1 - y0) / h, 3),
                        "px": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
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

        shape_boxes: List[Tuple[int, int, int, int, str]] = []
        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            area = cw * ch
            if area < 0.0004 * w * h:
                continue
            if cw >= 0.88 * w and ch >= 0.85 * h:
                continue
            if cw >= 0.28 * w and ch >= 0.11 * h:
                card_count += 1
                shape_boxes.append((x, y, cw, ch, "card"))
            elif cw >= 0.16 * w and 0.035 * h <= ch <= 0.14 * h:
                pill_count += 1
                shape_boxes.append((x, y, cw, ch, "pill"))
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
    """
    MotionClone-inspired full-timeline temporal scanner.
    Reads frames sequentially in one linear pass (grab/retrieve on strided indices,
    avoiding O(N*GOP) random keyframe seeks) to detect both hard color cuts and
    dark-on-dark / fade-through structural motion shot transitions.
    """
    safe_total = max(1, total_frames)
    target_step = max(1, int(round(max(fps, 1.0) / 10.0)))
    stride = max(target_step, (safe_total + 179) // 180)
    samples: List[Tuple[int, float, np.ndarray, np.ndarray, np.ndarray]] = []
    deltas: List[Dict[str, Any]] = []
    hard_jumps: List[int] = []
    structural_jumps: List[Tuple[int, float]] = []

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    f_idx = 0
    while f_idx < safe_total:
        if f_idx % stride != 0:
            if not cap.grab():
                break
            f_idx += 1
            continue

        ret, frame = cap.read()
        if not ret or frame is None:
            break

        h, w, _ = frame.shape
        target_w = 160
        target_h = max(16, int(round(h * (target_w / max(1, w)))))
        small_u8 = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
        small = small_u8.astype(np.float32)
        gray = cv2.cvtColor(small_u8, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 100) > 0

        ts = round(f_idx / max(fps, 1.0), 3)
        samples.append((f_idx, ts, small, gray, edges))
        if len(samples) >= 2:
            prev_small = samples[-2][2]
            diff = np.abs(small - prev_small) / 255.0
            score = float(diff.mean())
            changed_ratio = float((diff.mean(axis=2) > 0.12).mean())
            deltas.append({
                "frame": f_idx,
                "t": ts,
                "score": round(score, 4),
                "changedRatio": round(changed_ratio, 4),
            })
            # Hard visual cut (supports high-contrast dark bento/overlay jumps as well as full-frame flips)
            if (score > 0.17 and changed_ratio > 0.42) or (score > 0.13 and changed_ratio > 0.55):
                hard_jumps.append(f_idx)
        f_idx += 1

    # Detect dark-on-dark structural layout shifts and cross-fade / fade-to-black transitions
    if len(samples) >= 7:
        win = min(3, max(1, len(samples) // 8))
        morph_k = np.ones((5, 5), np.uint8)
        for i in range(win, len(samples) - win):
            cur_f, cur_t, _, _, _ = samples[i]
            _, _, a_small, a_gray, a_edges = samples[i - win]
            _, _, b_small, b_gray, b_edges = samples[i + win]

            ea_sum = int(np.sum(a_edges))
            eb_sum = int(np.sum(b_edges))
            if max(ea_sum, eb_sum) < 35:
                continue

            ea_d = cv2.dilate(a_edges.astype(np.uint8), morph_k) > 0
            eb_d = cv2.dilate(b_edges.astype(np.uint8), morph_k) > 0
            denom = float(ea_sum + eb_sum)
            edge_overlap = float(np.sum(a_edges & eb_d) + np.sum(b_edges & ea_d)) / denom

            ga = a_gray.astype(np.float32)
            gb = b_gray.astype(np.float32)
            fg_a = np.abs(ga - np.median(ga)) > 14.0
            fg_b = np.abs(gb - np.median(gb)) > 14.0
            fg_union = int(np.sum(fg_a | fg_b))
            fg_iou = (float(np.sum(fg_a & fg_b)) / fg_union) if fg_union >= 15 else 1.0

            win_delta = float(np.abs(a_small - b_small).mean() / 255.0)
            local_step = float(deltas[i - 1]["score"]) if (i - 1) < len(deltas) else 0.0
            # Trigger on sharp structural swap OR clean fade-out/blank pause into a brand-new composition
            is_fade_pause = (ea_sum >= 80 and eb_sum == 0) or (ea_sum == 0 and eb_sum >= 80)
            if edge_overlap < 0.22 and fg_iou < 0.18 and (
                local_step > 0.032 or win_delta > 0.035 or is_fade_pause
            ):
                strength = (1.0 - edge_overlap) * 0.5 + (1.0 - fg_iou) * 0.3 + max(local_step, win_delta)
                structural_jumps.append((cur_f, round(strength, 4)))

    # Fallback softer cut threshold if neither hard nor structural cuts fired
    if not hard_jumps and not structural_jumps and deltas:
        for d in deltas:
            if d["score"] > 0.13 and d["changedRatio"] > 0.40:
                hard_jumps.append(int(d["frame"]))

    # Combine hard cuts first (0.65s spacing), then add well-separated structural cuts (1.15s spacing)
    min_hard_gap = max(2, int(round(0.65 * max(fps, 1.0))))
    min_struct_gap = max(3, int(round(1.15 * max(fps, 1.0))))
    filtered_jumps: List[int] = []
    for j in hard_jumps:
        if not filtered_jumps or (j - filtered_jumps[-1]) >= min_hard_gap:
            filtered_jumps.append(j)

    jump_scores: Dict[int, float] = {d["frame"]: float(d["score"]) + 0.5 for d in deltas if d["frame"] in filtered_jumps}
    for jf, strength in sorted(structural_jumps, key=lambda x: x[1], reverse=True):
        if any(abs(jf - prev_j) < min_struct_gap for prev_j in filtered_jumps):
            continue
        filtered_jumps.append(jf)
        jump_scores[jf] = strength
    filtered_jumps.sort()

    min_struct_edge = max(0.75, 0.35)
    hard_set = set(hard_jumps)
    jump_timestamps = [
        round(j / max(fps, 1.0), 3)
        for j in filtered_jumps
        if (0.35 if j in hard_set else min_struct_edge) < (j / max(fps, 1.0)) < max(0.5, duration - 0.35)
    ]
    cut_timestamps = [0.0] + jump_timestamps

    # If video has <= 1 detected cut and duration >= 4s, divide into balanced beats snapped near local motion peaks
    if len(cut_timestamps) < 2 and duration >= 4.0:
        beat_count = 4 if duration >= 10.0 else 3
        cut_timestamps = [round((duration * i) / beat_count, 3) for i in range(beat_count)]
    elif len(cut_timestamps) > 8:
        # Keep the 7 strongest cuts by delta/structural score while respecting chronological order
        valid_jumps = [j for j in filtered_jumps if 0.35 < (j / max(fps, 1.0)) < max(0.5, duration - 0.35)]
        top_jumps = sorted(valid_jumps, key=lambda j: jump_scores.get(j, 0.0), reverse=True)[:7]
        top_jumps.sort()
        cut_timestamps = [0.0] + [round(j / max(fps, 1.0), 3) for j in top_jumps]

    # Deduplicate & sort cut timestamps
    clean_cuts = [0.0]
    for t in sorted(cut_timestamps):
        if t - clean_cuts[-1] >= 0.45 and t < duration - 0.25:
            clean_cuts.append(round(t, 3))

    return {
        "stride": stride,
        "scannedFrames": len(deltas) + 1,
        "deltas": deltas,
        "visualJumpTimestamps": jump_timestamps,
        "cutTimestamps": clean_cuts,
    }


def _classify_motion_cadence(energy: float) -> str:
    if energy >= 0.14:
        return "explosive-kinetic"
    if energy >= 0.06:
        return "fast-kinetic"
    if energy >= 0.02:
        return "smooth-motion"
    return "minimal-hold"


def extract_reference_blueprint(video_path_str: str, out_dir_str: Optional[str] = None) -> Dict[str, Any]:
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

    # 1. MotionClone-style full temporal scan + audio beat/BPM decompilation
    with tempfile.TemporaryDirectory(prefix="aetheria_ref_audio_") as tmp_audio_dir:
        bpm, beat_timestamps = extract_audio_bpm_and_beats(v_path, Path(tmp_audio_dir))
    temporal = scan_motion_timeline(cap, total_frames, fps, duration)
    cut_timestamps = snap_cuts_to_beats(temporal["cutTimestamps"], beat_timestamps, duration)
    temporal["cutTimestamps"] = cut_timestamps
    temporal["bpm"] = bpm
    temporal["beatTimestamps"] = beat_timestamps

    # 2. Plan all target timestamps (thumbs + per-scene start/mid/end + sub-frame trajectories) and fetch in ONE forward pass
    thumb_ratios = [0.10, 0.35, 0.60, 0.85]
    thumb_timestamps: List[float] = [
        round(min(max(0.0, duration - 0.05), duration * ratio), 3)
        for ratio in thumb_ratios
    ]

    scene_specs: List[Tuple[int, float, float, float, str, float, float, float, List[float]]] = []
    roles = ["hook", "problem_or_context", "proof_or_demo", "cta"]
    needed_indices = set()
    for ts in thumb_timestamps:
        needed_indices.add(min(max(0, total_frames - 1), max(0, int(round(ts * fps)))))

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
        scene_specs.append((i, start, end, dur, role, ts_start, ts_mid, ts_end, sub_ts_list))
        for ts in [ts_start, ts_mid, ts_end] + sub_ts_list:
            needed_indices.add(min(max(0, total_frames - 1), max(0, int(round(ts * fps)))))

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
        return cached_frames.get(f_idx)

    for idx, ts in enumerate(thumb_timestamps):
        frame = _frame_at(ts)
        if frame is not None:
            cv2.imwrite(str(frames_dir / f"thumb_{idx:03d}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])

    # 3. Extract per-scene keyframes, true palettes, spatial layouts, clean plate & Motion AST layers
    scenes: List[Dict[str, Any]] = []
    ast_scenes: List[Dict[str, Any]] = []
    scene_palettes: List[Dict[str, Any]] = []
    ocr_engine = _get_ocr_engine()
    ocr_available = ocr_engine is not None
    ocr_warning: Optional[str] = None
    if not ocr_available:
        try:
            from rapidocr_onnxruntime import RapidOCR as _ProbeOCR  # noqa: F401
            ocr_warning = "RapidOCR failed to initialize at runtime; on-screen text strings were NOT extracted."
        except Exception as _ocr_exc:
            ocr_warning = (
                f"RapidOCR unavailable ({_ocr_exc}); install core/ref_extractor/requirements.txt "
                "or rapidocr-onnxruntime to extract reference text strings."
            )

    for i, start, end, dur, role, ts_start, ts_mid, ts_end, sub_ts_list in scene_specs:
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

        scene_kf_name = f"ref_scene_{i + 1:02d}.jpg"
        scene_kf_path = frames_dir / scene_kf_name
        layout_info = analyze_frame_layout(fr_mid, ocr_engine)
        if fr_mid is not None:
            cv2.imwrite(str(scene_kf_path), fr_mid, [cv2.IMWRITE_JPEG_QUALITY, 94])

        # Also save start/end sub-keyframes for multi-pose motion cloning
        sub_keyframes = [{"t": ts_mid, "path": f"frames/{scene_kf_name}"}]
        if fr_start is not None and dur >= 0.9:
            start_name = f"ref_scene_{i + 1:02d}_start.jpg"
            cv2.imwrite(str(frames_dir / start_name), fr_start, [cv2.IMWRITE_JPEG_QUALITY, 88])
            sub_keyframes.insert(0, {"t": ts_start, "path": f"frames/{start_name}"})
        if fr_end is not None and dur >= 1.2:
            end_name = f"ref_scene_{i + 1:02d}_end.jpg"
            cv2.imwrite(str(frames_dir / end_name), fr_end, [cv2.IMWRITE_JPEG_QUALITY, 88])
            sub_keyframes.append({"t": ts_end, "path": f"frames/{end_name}"})

        pal = layout_info["palette"]
        clean_plate = extract_clean_plate_background(scene_sub_frames, pal["bgHex"])
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
                        "fontWeight": "800" if reg.get("zone") == "hero" else "600",
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

        layout_info["cleanPlate"] = clean_plate
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
            "motion": cadence,
            "motionEnergy": motion_energy,
            "keyframeTimestamp": ts_mid,
            "keyframe": f"frames/{scene_kf_name}",
            "keyframes": sub_keyframes,
            "cleanPlate": clean_plate,
            "layout": layout_info,
        })
        ast_scene_obj = {
            "id": scene_id,
            "index": i + 1,
            "role": role,
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": dur,
            "cleanPlate": clean_plate,
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

    cap.release()

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
        "beatTimestamps": beat_timestamps[:64],
        "visualJumpTimestamps": temporal["visualJumpTimestamps"],
        "cutTimestamps": cut_timestamps,
        "thumbTimestamps": thumb_timestamps,
    }
    temporal_json_path = out_dir / "temporal.json"
    with open(temporal_json_path, "w", encoding="utf-8") as f:
        json.dump(temporal_payload, f, indent=2)

    style_ast = {
        "version": 3,
        "source": v_path.name,
        "fps": int(round(fps)),
        "width": width,
        "height": height,
        "aspectRatio": aspect_ratio,
        "bpm": bpm,
        "beatTimestamps": beat_timestamps[:64],
        "scenes": ast_scenes,
    }
    ast_json_path = out_dir / "style_ast.json"
    with open(ast_json_path, "w", encoding="utf-8") as f:
        json.dump(style_ast, f, indent=2)

    style_spec = {
        "version": 2,
        "title": f"Extracted Reference Style ({v_path.name})",
        "engine": "aetheria-html-motion",
        "fidelityTarget": 0.90,
        "totalDuration": round(duration, 3),
        "fps": int(round(fps)),
        "bpm": bpm,
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
        "extractorBackend": "python_cv2_rapidocr" if ocr_available else "python_cv2_no_ocr",
        "astPath": "ref/extracted/style_ast.json",
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

    md = f"""# Reference Video Analysis Report (MotionClone Blueprint)
**Source:** `{v_path.name}`
**Duration:** {duration:.2f}s | **FPS:** {int(round(fps))} | **BPM:** {bpm:.1f} | **Resolution:** {width}x{height} ({aspect_ratio})
**Detected Tone:** {theme_label} (Mean Luma: {avg_luma:.1f})
**Detected Scene Cuts:** {len(cut_timestamps)} scenes (`{", ".join(f"{t:.2f}s" for t in cut_timestamps)}`)
**Extractor Backend:** `{style_spec['extractorBackend']}` (`ocrAvailable={ocr_available}`)
**Decompiled Motion AST:** `ref/extracted/style_ast.json` (version 3)
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
        md += f"- **Clean Plate Background:** fill=`{cp.get('fillHex')}`, hasGradient=`{cp.get('hasGradient')}`\n"
        md += f"- **Measured Palette:** bg=`{pal['bgHex']}`, surface=`{pal['surfaceHex']}`, text=`{pal['textHex']}`, accent=`{pal['accentHex']}`\n"
        md += f"- **Visual Archetype:** `{ly.get('visual_archetype')}`\n"
        md += f"- **Density:** `{ly.get('card_count', 0)}` cards, `{ly.get('pill_count', 0)}` pills, `{ly.get('scatter_count', 0)}` scatter elements | **Motion Energy:** `{s['motionEnergy']:.3f}` (`{s['motion']}`)\n"
        if ly.get("top"):
            md += f"- **Top Text Zone:** {', '.join([json.dumps(t) for t in ly['top'][:4]])}\n"
        if ly.get("hero"):
            md += f"- **Hero Text Zone:** {', '.join([json.dumps(t) for t in ly['hero'][:8]])}\n"
        if ly.get("bottom"):
            md += f"- **Bottom Text Zone:** {', '.join([json.dumps(t) for t in ly['bottom'][:3]])}\n"
        if ly.get("regions"):
            reg_summaries = []
            for r in ly["regions"][:6]:
                mot = r.get("motion") or {}
                curve_label = f"{mot.get('direction', 'pop')}:{mot.get('curve', 'AM.spring')}"
                reg_summaries.append(
                    f"{r['kind']}@({r['x']},{r['y']},{r['w']}x{r['h']})[{curve_label}]"
                )
            md += f"- **Normalized Bounding Boxes & Decompiled Motion (x,y,w,h)[dir:curve]:** `{', '.join(reg_summaries)}`\n"

    md += f"""
## Aetheria Modular HTML5/JS Reconstruction Directives
1. **READ DECOMPILED MOTION AST (`ref/extracted/style_ast.json`)**: Inspect `style_ast.json` for each scene's `cleanPlate` and `layers[]` (`box`, `style`, and `motion.entrance`). Map `curve == "AM.spring"` directly to `AM.spring(localTime - startSec, ...)` and `direction == "slide_up"` to Y-offset `yBox + 40 * (1 - p)` instead of guessing random easing formulas.
2. **EXACT TIMING & SCENES (`index.html` + `script/scene1..{len(scenes)}.js`)**: Mirror the measured `SCENES` timings and `{width}x{height}` (`{int(round(fps))}fps`) `window.__filmMeta` contract. Register each scene with `window.AM.registerScene("sceneK_...", ...)` and drive every frame deterministically via `window.renderAt(t)`.
3. **PER-SCENE PALETTE FIDELITY**: Switch backgrounds/accents per scene to match each scene's measured `cleanPlate.fillHex`, `bgHex`, and `accentHex` above — never substitute generic default colors.
4. **CLOSED-LOOP VISUAL VERIFICATION**: After writing `index.html` and `script/scene*.js`, call `capture_film_preview` with `compareToReference: true` to measure per-frame RGB SSIM + color/edge similarity and inspect `.aetheria/preview/comparison_strip.jpg`. Refine any low-scoring scenes iteratively until visual metrics and the 5-axis rubric pass!
"""

    with open(report_md, "w", encoding="utf-8") as f:
        f.write(md)

    return {
        "success": True,
        "reportPath": str(report_md),
        "stylePath": str(style_json),
        "specPath": str(style_json),
        "astPath": str(ast_json_path),
        "temporalPath": str(temporal_json_path),
        "blueprint": style_spec,
        "motionAst": style_ast,
    }


if __name__ == "__main__":
    vid = sys.argv[1] if len(sys.argv) > 1 else "workspace/ref/reference.mp4"
    out = sys.argv[2] if len(sys.argv) > 2 else "workspace/ref/extracted"
    res = extract_reference_blueprint(vid, out)
    print(json.dumps(res, indent=2))
