#!/usr/bin/env python3
"""
Dense motion clues extractor (Phase A: A1-A5) for Aetheria MotionClone reference analysis.
Extracts information that coarse 3-point scene summaries miss:
- A1: 6-slice dense intra-scene timeline with per-timestamp bounding boxes & active OCR words.
- A2: Small high-saturation accent callouts (hex + pixel box + timestamp) missed by area-weighted palette clustering.
- A3: Hero foreground trajectory waypoints (box, center, scale/aspect shift across the scene).
- A4: Nested container bezel & inner screen clipRect detection (preventing container spill).
- A5: Kinetic typography / wide marquee / vertical slot-reel structural cues.
"""

from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _bgr_to_hex(bgr: np.ndarray) -> str:
    b, g, r = int(np.clip(bgr[0], 0, 255)), int(np.clip(bgr[1], 0, 255)), int(np.clip(bgr[2], 0, 255))
    return f"#{r:02X}{g:02X}{b:02X}"


def _border_bg_bgr(frame_bgr: np.ndarray) -> np.ndarray:
    h, w = frame_bgr.shape[:2]
    b = max(4, min(12, h // 24, w // 24))
    border = np.concatenate(
        [
            frame_bgr[:b, :, :].reshape(-1, 3),
            frame_bgr[-b:, :, :].reshape(-1, 3),
            frame_bgr[:, :b, :].reshape(-1, 3),
            frame_bgr[:, -b:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(border, axis=0).astype(np.int16)


def _foreground_box_and_mask(
    frame_bgr: np.ndarray,
    bg_bgr: np.ndarray,
) -> Tuple[Optional[List[int]], np.ndarray, float]:
    h, w = frame_bgr.shape[:2]
    diff = np.max(np.abs(frame_bgr.astype(np.int16) - bg_bgr), axis=2)
    p99 = float(np.percentile(diff, 99))
    thr = max(28.0, min(68.0, p99 * 0.30))
    mask = (diff > thr).astype(np.uint8)
    k3 = np.ones((3, 3), np.uint8)
    clean = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3)
    if np.count_nonzero(clean) < 20:
        clean = mask
    ratio = float(np.mean(clean > 0))
    ys, xs = np.where(clean > 0)
    if ys.size < 20:
        return None, clean, ratio
    x0 = int(np.percentile(xs, 2))
    x1 = int(np.percentile(xs, 98)) + 1
    y0 = int(np.percentile(ys, 2))
    y1 = int(np.percentile(ys, 98)) + 1
    return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)], clean, ratio


def extract_saturated_accent_callouts(
    sampled_frames: List[Tuple[float, np.ndarray]],
) -> List[Dict[str, Any]]:
    """Finds small high-chroma accent elements (0.03%..25% area) that area-weighted palettes miss."""
    seen_hue_bins: Dict[int, Dict[str, Any]] = {}
    for ts, frame in sampled_frames:
        if frame is None:
            continue
        h, w = frame.shape[:2]
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        sat_mask = ((hsv[:, :, 1] >= 90) & (hsv[:, :, 2] >= 85)).astype(np.uint8)
        sat_ratio = float(np.mean(sat_mask > 0))
        if sat_ratio < 0.0003 or sat_ratio > 0.35:
            continue

        # Group by 6 hue buckets (0..180 in OpenCV HSV)
        for h_bin in range(6):
            lo, hi = h_bin * 30, (h_bin + 1) * 30
            bin_mask = ((sat_mask > 0) & (hsv[:, :, 0] >= lo) & (hsv[:, :, 0] < hi)).astype(np.uint8)
            cnt = int(np.count_nonzero(bin_mask))
            if cnt < max(24, int(h * w * 0.00025)):
                continue
            ys, xs = np.where(bin_mask > 0)
            x0, x1 = int(np.percentile(xs, 5)), int(np.percentile(xs, 95)) + 1
            y0, y1 = int(np.percentile(ys, 5)), int(np.percentile(ys, 95)) + 1
            med_bgr = np.median(frame[bin_mask > 0], axis=0)
            hex_col = _bgr_to_hex(med_bgr)
            prev = seen_hue_bins.get(h_bin)
            if prev is None or cnt > prev["pixels"]:
                seen_hue_bins[h_bin] = {
                    "hex": hex_col,
                    "box": [x0, y0, max(1, x1 - x0), max(1, y1 - y0)],
                    "timestamp": round(ts, 2),
                    "pixels": cnt,
                }

    out = sorted(seen_hue_bins.values(), key=lambda x: x["timestamp"])
    for item in out:
        item.pop("pixels", None)
    return out[:4]


def detect_container_clip_rect(
    sampled_frames: List[Tuple[float, np.ndarray]],
    bg_bgr: np.ndarray,
) -> Optional[Dict[str, Any]]:
    """Detects centered bounded containers (laptop bezel/screen or hero card) and their inner clipRect."""
    best: Optional[Dict[str, Any]] = None
    for ts, frame in sampled_frames:
        if frame is None:
            continue
        h, w = frame.shape[:2]
        box, mask, ratio = _foreground_box_and_mask(frame, bg_bgr)
        if not box:
            continue
        bx, by, bw, bh = box
        area_frac = float(bw * bh) / float(max(1, w * h))
        cx_norm = (bx + bw * 0.5) / float(max(1, w))
        cy_norm = (by + bh * 0.5) / float(max(1, h))
        # Must be a centered bounded container covering 14%..66% of the canvas
        if not (0.14 <= area_frac <= 0.66 and 0.42 <= cx_norm <= 0.58 and 0.38 <= cy_norm <= 0.62):
            continue
        # Check for a high-saturation inner screen (e.g. purple screen inside laptop bezel)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        chroma = ((hsv[:, :, 1] >= 75) & (hsv[:, :, 2] >= 65)).astype(np.uint8)
        c_ratio = float(np.mean(chroma > 0))
        inner_box = box
        kind = "centered-container"
        if 0.08 <= c_ratio <= 0.48:
            ys, xs = np.where(chroma > 0)
            ix0, ix1 = int(np.percentile(xs, 2)), int(np.percentile(xs, 98)) + 1
            iy0, iy1 = int(np.percentile(ys, 2)), int(np.percentile(ys, 98)) + 1
            inner_box = [ix0, iy0, max(1, ix1 - ix0), max(1, iy1 - iy0)]
            kind = "bezel-with-inner-screen"
        cand = {
            "kind": kind,
            "outerBox": box,
            "innerClipRect": inner_box,
            "timestamp": round(ts, 2),
            "score": c_ratio if kind == "bezel-with-inner-screen" else area_frac * 0.5,
        }
        if best is None or cand["score"] > best["score"]:
            best = cand

    if best:
        best.pop("score", None)
    return best


def extract_scene_motion_clues(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    start: float,
    end: float,
    width: int,
    height: int,
    ocr_summary_fn: Optional[Callable[[np.ndarray], List[str]]] = None,
    sub_ts_list: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """Extracts Phase A (A1-A5) dense timeline, saturated accents, object trajectory, container clipRect, and kinetic cues."""
    dur = max(0.2, end - start)
    ts_candidates = (
        sub_ts_list
        if (sub_ts_list and len(sub_ts_list) >= 4)
        else [round(start + dur * f, 3) for f in (0.05, 0.16, 0.28, 0.42, 0.56, 0.70, 0.84, 0.95)]
    )
    sampled: List[Tuple[float, np.ndarray]] = []
    for ts in ts_candidates:
        if sampled and abs(ts - sampled[-1][0]) < 0.06:
            continue
        fr = frame_at_fn(ts)
        if fr is not None:
            sampled.append((ts, fr))

    if not sampled:
        return {}

    bg_bgr = _border_bg_bgr(sampled[len(sampled) // 2][1])
    accents = extract_saturated_accent_callouts(sampled)
    container_clip = detect_container_clip_rect(sampled, bg_bgr)

    timeline: List[Dict[str, Any]] = []
    waypoints: List[Dict[str, Any]] = []
    kinetic_clues: List[str] = []

    saw_wide_marquee = False
    saw_vertical_slot = False

    for ts, fr in sampled:
        box, _, ratio = _foreground_box_and_mask(fr, bg_bgr)
        words = ocr_summary_fn(fr) if (ocr_summary_fn is not None and 0.004 <= ratio <= 0.52) else []
        entry: Dict[str, Any] = {"t": round(ts, 2)}
        if box:
            entry["box"] = box
            bx, by, bw, bh = box
            area_frac = float(bw * bh) / float(max(1, width * height))
            if area_frac < 0.72:
                waypoints.append(
                    {
                        "t": round(ts, 2),
                        "box": box,
                        "center": [bx + bw // 2, by + bh // 2],
                    }
                )
            # Detect wide horizontal marquee band vs tall vertical slot reel
            if bw >= int(width * 0.48) and 48 <= bh <= int(height * 0.30) and not saw_wide_marquee:
                saw_wide_marquee = True
                est_px = max(36, int(round(bh * 0.62)))
                kinetic_clues.append(
                    f"t={ts:.2f}s WIDE HORIZONTAL MARQUEE at box=[{bx},{by},{bw}x{bh}] (use large font ~{est_px}px bold, words={words[:4]})"
                )
            elif (
                int(width * 0.14) <= bw <= int(width * 0.32)
                and bh >= int(height * 0.36)
                and abs((bx + bw * 0.5) - width * 0.5) <= width * 0.08
                and not saw_vertical_slot
            ):
                saw_vertical_slot = True
                kinetic_clues.append(
                    f"t={ts:.2f}s CENTERED VERTICAL 3-CELL ICON SLOT REEL at box=[{bx},{by},{bw}x{bh}] flanked by side labels {words[:3]}"
                )
        if words:
            entry["words"] = words[:5]
        timeline.append(entry)

    trajectory_summary: Optional[str] = None
    if len(waypoints) >= 2:
        centers = [wp["center"] for wp in waypoints]
        areas = [max(1, wp["box"][2] * wp["box"][3]) for wp in waypoints]
        max_shift = max(
            abs(c[0] - centers[0][0]) + abs(c[1] - centers[0][1]) for c in centers[1:]
        )
        area_ratio = float(max(areas)) / float(max(1, min(areas)))
        if max_shift >= 38 or area_ratio >= 1.35:
            steps = [
                f"t={wp['t']:.2f}s:box=[{wp['box'][0]},{wp['box'][1]},{wp['box'][2]}x{wp['box'][3]}]"
                for wp in waypoints
            ]
            trajectory_summary = " -> ".join(steps)

    return {
        "saturatedAccents": accents,
        "objectTrajectory": trajectory_summary,
        "containerClip": container_clip,
        "denseTimeline": timeline,
        "kineticClues": kinetic_clues,
    }
