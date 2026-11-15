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

_RAPID_OCR = None
_RAPID_OCR_LOADED = False


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
            max_ocr_w = 540
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
    avoiding O(N*GOP) random keyframe seeks) to detect scene cuts and kinetic peaks.
    """
    safe_total = max(1, total_frames)
    target_step = max(1, int(round(max(fps, 1.0) / 10.0)))
    stride = max(target_step, (safe_total + 179) // 180)
    prev_small: Optional[np.ndarray] = None
    deltas: List[Dict[str, Any]] = []
    jump_indices: List[int] = []

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
        small = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA).astype(np.float32)

        ts = round(f_idx / max(fps, 1.0), 3)
        if prev_small is not None:
            diff = np.abs(small - prev_small) / 255.0
            score = float(diff.mean())
            changed_ratio = float((diff.mean(axis=2) > 0.12).mean())
            deltas.append({
                "frame": f_idx,
                "t": ts,
                "score": round(score, 4),
                "changedRatio": round(changed_ratio, 4),
            })
            # Strong scene cut: matches MotionClone's >0.22 mean & >60% changed pixels
            if score > 0.22 and changed_ratio > 0.60:
                jump_indices.append(f_idx)
        prev_small = small
        f_idx += 1

    # Fallback softer cut threshold if no hard cuts were detected
    if not jump_indices and deltas:
        for d in deltas:
            if d["score"] > 0.13 and d["changedRatio"] > 0.40:
                jump_indices.append(int(d["frame"]))

    # Deduplicate jumps closer than 0.65s
    min_gap_frames = max(2, int(round(0.65 * max(fps, 1.0))))
    filtered_jumps: List[int] = []
    for j in jump_indices:
        if not filtered_jumps or (j - filtered_jumps[-1]) >= min_gap_frames:
            filtered_jumps.append(j)

    jump_timestamps = [round(j / max(fps, 1.0), 3) for j in filtered_jumps if 0.35 < (j / max(fps, 1.0)) < max(0.5, duration - 0.35)]
    cut_timestamps = [0.0] + jump_timestamps

    # If video has <= 1 detected cut and duration >= 4s, divide into balanced beats snapped near local motion peaks
    if len(cut_timestamps) < 2 and duration >= 4.0:
        beat_count = 4 if duration >= 10.0 else 3
        cut_timestamps = [round((duration * i) / beat_count, 3) for i in range(beat_count)]
    elif len(cut_timestamps) > 10:
        # Keep the 9 strongest visual jumps by delta score
        jump_scores = {d["frame"]: d["score"] for d in deltas}
        top_jumps = sorted(filtered_jumps, key=lambda j: jump_scores.get(j, 0.0), reverse=True)[:9]
        top_jumps.sort()
        cut_timestamps = [0.0] + [
            round(j / max(fps, 1.0), 3)
            for j in top_jumps
            if 0.35 < (j / max(fps, 1.0)) < max(0.5, duration - 0.35)
        ]

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

    # 1. MotionClone-style full temporal scan
    temporal = scan_motion_timeline(cap, total_frames, fps, duration)
    cut_timestamps = temporal["cutTimestamps"]

    # 2. Plan all target timestamps (thumbs + per-scene start/mid/end) and fetch in ONE forward pass
    thumb_ratios = [0.10, 0.35, 0.60, 0.85]
    thumb_timestamps: List[float] = [
        round(min(max(0.0, duration - 0.05), duration * ratio), 3)
        for ratio in thumb_ratios
    ]

    scene_specs: List[Tuple[int, float, float, float, str, float, float, float]] = []
    roles = ["hook", "problem_or_context", "proof_or_demo", "cta"]
    needed_indices = set()
    for ts in thumb_timestamps:
        needed_indices.add(min(max(0, total_frames - 1), max(0, int(round(ts * fps)))))

    for i, start in enumerate(cut_timestamps):
        end = cut_timestamps[i + 1] if i + 1 < len(cut_timestamps) else round(duration, 3)
        dur = max(0.35, round(end - start, 3))
        role = roles[i] if i < len(roles) else f"beat_{i + 1}"
        ts_start = round(min(duration - 0.04, start + min(0.15, dur * 0.15)), 3)
        ts_mid = round(min(duration - 0.04, start + dur * 0.50), 3)
        ts_end = round(min(duration - 0.04, max(ts_mid, end - min(0.15, dur * 0.15))), 3)
        scene_specs.append((i, start, end, dur, role, ts_start, ts_mid, ts_end))
        for ts in (ts_start, ts_mid, ts_end):
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

    # 3. Extract per-scene keyframes, true palettes, spatial layouts & motion energy
    scenes: List[Dict[str, Any]] = []
    scene_palettes: List[Dict[str, Any]] = []
    ocr_engine = _get_ocr_engine()

    for i, start, end, dur, role, ts_start, ts_mid, ts_end in scene_specs:
        fr_start = _frame_at(ts_start)
        fr_mid = _frame_at(ts_mid)
        fr_end = _frame_at(ts_end)

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

        scene_palettes.append(layout_info["palette"])
        scenes.append({
            "index": i + 1,
            "id": f"scene{i + 1}_{role}",
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
            "layout": layout_info,
        })

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
        "visualJumpTimestamps": temporal["visualJumpTimestamps"],
        "cutTimestamps": cut_timestamps,
        "thumbTimestamps": thumb_timestamps,
    }
    temporal_json_path = out_dir / "temporal.json"
    with open(temporal_json_path, "w", encoding="utf-8") as f:
        json.dump(temporal_payload, f, indent=2)

    style_spec = {
        "version": 2,
        "title": f"Extracted Reference Style ({v_path.name})",
        "engine": "aetheria-html-motion",
        "fidelityTarget": 0.90,
        "totalDuration": round(duration, 3),
        "fps": int(round(fps)),
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

    md = f"""# Reference Video Analysis Report (MotionClone Blueprint)
**Source:** `{v_path.name}`
**Duration:** {duration:.2f}s | **FPS:** {int(round(fps))} | **Resolution:** {width}x{height} ({aspect_ratio})
**Detected Tone:** {theme_label} (Mean Luma: {avg_luma:.1f})
**Detected Scene Cuts:** {len(cut_timestamps)} scenes (`{", ".join(f"{t:.2f}s" for t in cut_timestamps)}`)

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
        md += f"\n### Scene {s['index']}: `{s['id']}` ({s['start']:.2f}s - {s['end']:.2f}s, {s['duration']:.2f}s)\n"
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
            reg_summaries = [
                f"{r['kind']}@({r['x']},{r['y']},{r['w']}x{r['h']})"
                for r in ly["regions"][:6]
            ]
            md += f"- **Normalized Bounding Boxes (x,y,w,h):** `{', '.join(reg_summaries)}`\n"

    md += f"""
## Aetheria Modular HTML5/JS Reconstruction Directives
1. **EXACT TIMING & SCENES (`index.html` + `script/scene1..{len(scenes)}.js`)**: Mirror the measured `SCENES` timings and `{width}x{height}` (`{int(round(fps))}fps`) `window.__filmMeta` contract. Register each scene with `window.AM.registerScene("sceneK_...", ...)` and drive every frame deterministically via `window.renderAt(t)`.
2. **PER-SCENE PALETTE FIDELITY**: Switch backgrounds/accents per scene to match each scene's measured `bgHex` and `accentHex` above — never substitute generic default colors.
3. **MULTI-POSE MOTION CLONING**: Use `AM.evalKeyframes(frames, localTime, easing)` (`linear` | `smooth` | `out` | `step`), `AM.spring`, `AM.pop`, `AM.drawSVGPath`, and `AM.textReveal` to reconstruct exact entrance/mid/exit trajectories at the measured bounding boxes `(x, y, w, h)`.
4. **CLOSED-LOOP VISUAL VERIFICATION**: After writing `index.html` and `script/scene*.js`, call `capture_film_preview` with `compareToReference: true` to measure per-frame RGB SSIM + color/edge similarity and inspect `.aetheria/preview/comparison_strip.jpg`. Refine any low-scoring scenes iteratively until visual metrics and the 5-axis rubric pass!
"""

    with open(report_md, "w", encoding="utf-8") as f:
        f.write(md)

    return {
        "success": True,
        "reportPath": str(report_md),
        "stylePath": str(style_json),
        "specPath": str(style_json),
        "temporalPath": str(temporal_json_path),
        "blueprint": style_spec,
    }


if __name__ == "__main__":
    vid = sys.argv[1] if len(sys.argv) > 1 else "workspace/ref/reference.mp4"
    out = sys.argv[2] if len(sys.argv) > 2 else "workspace/ref/extracted"
    res = extract_reference_blueprint(vid, out)
    print(json.dumps(res, indent=2))
