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


def _extract_top_foreground_components(
    clean_mask: np.ndarray,
    width: int,
    height: int,
    max_components: int = 3,
) -> List[Dict[str, Any]]:
    """Extracts up to `max_components` spatially separate foreground objects via horizontal-biased close."""
    if clean_mask is None or clean_mask.size == 0:
        return []
    mh, mw = clean_mask.shape[:2]
    if mh <= 0 or mw <= 0:
        return []
    kx = max(7, min(25, int(mw) // 48))
    ky = max(5, min(17, int(mh) // 96))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kx, ky))
    grouped = cv2.morphologyEx((clean_mask > 0).astype(np.uint8) * 255, cv2.MORPH_CLOSE, kernel)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(grouped, connectivity=8)
    mask_area = max(1, mw * mh)
    min_area = max(36, int(mask_area * 0.0002))
    max_box_area = int(mask_area * 0.72)
    sx = float(width) / float(mw)
    sy = float(height) / float(mh)
    comps: List[Tuple[int, Dict[str, Any]]] = []
    for lbl in range(1, num_labels):
        area = int(stats[lbl, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        bx = int(stats[lbl, cv2.CC_STAT_LEFT])
        by = int(stats[lbl, cv2.CC_STAT_TOP])
        bw = int(stats[lbl, cv2.CC_STAT_WIDTH])
        bh = int(stats[lbl, cv2.CC_STAT_HEIGHT])
        if bw <= 0 or bh <= 0 or (bw * bh) >= max_box_area:
            continue
        out_x = int(round(bx * sx))
        out_y = int(round(by * sy))
        out_w = max(1, int(round(bw * sx)))
        out_h = max(1, int(round(bh * sy)))
        comps.append(
            (
                area,
                {
                    "box": [out_x, out_y, out_w, out_h],
                    "center": [out_x + out_w // 2, out_y + out_h // 2],
                    "areaFrac": round(float(area) / float(mask_area), 4),
                },
            )
        )
    comps.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in comps[:max_components]]


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


_GARBLED_OCR_NOISE = {
    ".s",
    "s.",
}


def sanitize_ocr_tokens_for_clues(words: List[str]) -> List[str]:
    """Filters out tiny punctuation/single-character OCR artifacts."""
    cleaned: List[str] = []
    for raw in words:
        w = raw.strip()
        if not w:
            continue
        low = w.lower()
        if low in _GARBLED_OCR_NOISE:
            continue
        alnum = "".join(ch for ch in w if ch.isalnum())
        if len(alnum) <= 1:
            continue
        cleaned.append(w)
    return cleaned


def detect_centered_hero_card_over_bright_backdrop(
    frame_bgr: np.ndarray,
) -> Optional[Dict[str, Any]]:
    """
    v13 #2: When a frame has a full-bleed bright/blurred backdrop (area_frac > 0.72, e.g., Scene 3
    blurred 3-card carousel), locates the sharp centered vertical hero card (e.g., [356, 34, 312, 506])
    using Canny contours + vertical border gradient peaks so we never emit a misleading 980x552 full-bleed box.
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    if w < 160 or h < 120:
        return None
    # A 3-card side-by-side carousel backdrop only applies to landscape/square stages;
    # on portrait (9:16) canvases, centered text over graph paper falsely triggers vertical Sobel peaks.
    if h > int(w * 1.15):
        return None
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    mean_luma = float(np.mean(gray))
    dark_frac = float(np.mean(gray < 80))
    if mean_luma < 160.0 or dark_frac >= 0.14:
        return None
    edges = cv2.Canny(gray, 35, 110)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    best_box: Optional[List[int]] = None
    best_score = 0.0
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)
        if len(approx) < 4 or len(approx) > 10:
            continue
        bx, by, bw, bh = cv2.boundingRect(approx)
        if not (int(w * 0.18) <= bw <= int(w * 0.48) and int(h * 0.52) <= bh <= int(h * 0.96)):
            continue
        if bh > 0 and (float(bw) / float(bh)) < 0.35:
            continue
        center_offset = abs((bx + bw * 0.5) - (w * 0.5)) / float(w)
        if center_offset > 0.12:
            continue
        score = ( float(bw * bh) / float(w * h) ) * (1.0 - center_offset * 3.0)
        if score > best_score:
            best_score = score
            best_box = [int(bx), int(by), int(bw), int(bh)]

    if best_box is None:
        # Fallback: vertical Sobel edge column peaks in [0.24W..0.42W] and [0.58W..0.76W]
        sobel_x = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
        y_band = sobel_x[int(h * 0.12) : int(h * 0.88), :]
        col_profile = np.mean(y_band, axis=0)
        col_median = float(np.median(col_profile))
        l_min, l_max = int(w * 0.24), int(w * 0.42)
        r_min, r_max = int(w * 0.58), int(w * 0.76)
        if l_max > l_min and r_max > r_min:
            lx = l_min + int(np.argmax(col_profile[l_min:l_max]))
            rx = r_min + int(np.argmax(col_profile[r_min:r_max]))
            cw = rx - lx
            sym_err = abs(((lx + rx) * 0.5) - (w * 0.5)) / float(w)
            # Check vertical edge continuity (rejects graph-paper / isolated text fragments)
            l_cont = float(np.mean(y_band[:, lx] > 12.0))
            r_cont = float(np.mean(y_band[:, rx] > 12.0))
            # Check center sharpness vs blurred side flanks
            center_roi = gray[int(h * 0.15) : int(h * 0.85), lx:rx]
            left_flank = gray[int(h * 0.15) : int(h * 0.85), int(w * 0.05) : max(int(w * 0.06), lx - 8)]
            right_flank = gray[int(h * 0.15) : int(h * 0.85), min(w - 2, rx + 8) : int(w * 0.95)]
            c_sharp = float(cv2.Laplacian(center_roi, cv2.CV_64F).var()) if center_roi.size else 0.0
            f_sharp = 0.5 * (
                (float(cv2.Laplacian(left_flank, cv2.CV_64F).var()) if left_flank.size else 0.0)
                + (float(cv2.Laplacian(right_flank, cv2.CV_64F).var()) if right_flank.size else 0.0)
            )
            peak_strength = float(col_profile[lx] + col_profile[rx]) * 0.5
            top_y = int(round(h * 0.06))
            bot_y = int(round(h * 0.94))
            ch = max(1, bot_y - top_y)
            if (
                int(w * 0.22) <= cw <= int(w * 0.44)
                and (float(cw) / float(ch)) >= 0.35
                and sym_err <= 0.09
                and peak_strength >= 14.0
                and peak_strength >= max(col_median * 2.5, 14.0)
                and l_cont >= 0.50
                and r_cont >= 0.50
                and c_sharp >= f_sharp * 1.15
            ):
                best_box = [int(lx), top_y, int(cw), int(ch)]

    if best_box is None:
        return None
    return {
        "heroCardBox": best_box,
        "blurredBackdrop": (
            f"full-bleed 3-card blurred carousel backdrop (draw side/background cards with "
            f"ctx.filter='blur(6px)', reset ctx.filter='none', then draw sharp centered vertical "
            f"hero card at heroCardBox={best_box} — NEVER stretch the hero card to full screen)"
        ),
    }


def detect_inline_glyph_morph(
    sampled_frames: List[Tuple[float, np.ndarray]],
    accents: List[Dict[str, Any]],
    raw_ocr_per_slice: List[Tuple[float, List[str], Optional[List[int]]]],
    width: int,
    height: int,
    scene_start: float = 0.0,
) -> Optional[str]:
    """
    Detects when a dark-backdrop scene has small localized high-chroma vector glyphs arranged
    inline along a single horizontal text baseline, preventing stacked-row layouts or literal
    truncated OCR strings. Strictly rejects talking-head / full-frame camera footage.
    """
    if not sampled_frames or len(accents) < 2:
        return None
    fr0 = sampled_frames[0][1]
    if fr0 is None or fr0.size == 0:
        return None
    border_strip = fr0[0:8, :, :]
    bg_luma = float(np.mean(border_strip))
    border_std = float(np.std(border_strip))
    if bg_luma > 48.0 or border_std > 20.0:
        return None

    # Only count small localized glyph-sized accents (not full-screen faces/clothing/backgrounds)
    small_accents = []
    for a in accents:
        bx = a.get("box")
        if not isinstance(bx, list) or len(bx) != 4:
            continue
        aw, ah = int(bx[2]), int(bx[3])
        if aw <= int(width * 0.24) and ah <= int(height * 0.28):
            small_accents.append(a)
    if len(small_accents) < 2:
        return None

    cys = [int(a["box"][1] + a["box"][3] // 2) for a in small_accents]
    if (max(cys) - min(cys)) > int(height * 0.16):
        return None

    baseline_y = int(round(sum(cys) / len(cys)))
    band_x0 = max(60, min(int(a["box"][0]) for a in small_accents) - int(width * 0.25))
    band_x1 = min(width - 60, max(int(a["box"][0] + a["box"][2]) for a in small_accents) + 40)
    for _, _, box in raw_ocr_per_slice:
        if box and len(box) == 4 and box[3] <= int(height * 0.34):
            by_mid = int(box[1] + box[3] // 2)
            if abs(by_mid - baseline_y) <= int(height * 0.14):
                baseline_y = by_mid
                band_x0 = max(60, min(band_x0, int(box[0])))
                band_x1 = min(width - 60, max(band_x1, int(box[0] + box[2])))

    accent_hexes = [str(a.get("hex", "")) for a in small_accents[:5] if a.get("hex")]
    accent_str = ", ".join(accent_hexes)
    return (
        f"INLINE GLYPH MORPH on single horizontal baseline y={baseline_y} (x={band_x0}..{band_x1}): "
        f"small vibrant geometric vector glyphs ({accent_str}) lie INLINE on the SAME horizontal baseline "
        f"y={baseline_y} as the hero title and morph left-to-right into crisp letters as the cursor sweeps across "
        f"(read the full intended word from the visual frames — NEVER render truncated OCR fragments and NEVER stack icons in a separate row above the word)"
    )


def _measure_boundary_anchor(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    ts: float,
    local_t: float,
) -> Optional[Dict[str, Any]]:
    fr = frame_at_fn(ts)
    if fr is None or fr.size == 0:
        return None
    bg_bgr = _border_bg_bgr(fr)
    bg_hex = _bgr_to_hex(bg_bgr)
    box, mask, ratio = _foreground_box_and_mask(fr, bg_bgr)
    fg_hex: Optional[str] = None
    center: Optional[List[int]] = None
    if box is not None and int(np.count_nonzero(mask)) >= 20:
        fg_bgr = np.median(fr[mask > 0], axis=0)
        fg_hex = _bgr_to_hex(fg_bgr)
        bx, by, bw, bh = box
        center = [int(bx + bw // 2), int(by + bh // 2)]
    return {
        "t": round(float(ts), 3),
        "localT": round(float(local_t), 3),
        "bgHex": bg_hex,
        "fgHex": fg_hex,
        "box": box,
        "center": center,
        "fgRatio": round(float(ratio), 4),
    }


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

    entry_anchor = _measure_boundary_anchor(frame_at_fn, start + 0.02, 0.0)
    exit_anchor = _measure_boundary_anchor(
        frame_at_fn, max(start + 0.02, end - 0.03), round(dur, 3)
    )

    bg_bgr = _border_bg_bgr(sampled[len(sampled) // 2][1])
    accents = extract_saturated_accent_callouts(sampled)
    container_clip = detect_container_clip_rect(sampled, bg_bgr)

    timeline: List[Dict[str, Any]] = []
    waypoints: List[Dict[str, Any]] = []
    kinetic_clues: List[str] = []
    raw_ocr_per_slice: List[Tuple[float, List[str], Optional[List[int]]]] = []
    hero_card_info: Optional[Dict[str, Any]] = None

    saw_wide_marquee = False
    saw_vertical_slot = False
    mid_idx = len(sampled) // 2
    last_idx = max(0, len(sampled) - 1)
    ocr_slice_indices = (
        {0, 1, 2, mid_idx, max(0, last_idx - 1), last_idx}
        if len(sampled) > 4
        else set(range(len(sampled)))
    )

    for s_idx, (ts, fr) in enumerate(sampled):
        box, clean_mask, ratio = _foreground_box_and_mask(fr, bg_bgr)
        should_run_ocr = (
            ocr_summary_fn is not None
            and 0.004 <= ratio <= 0.65
            and s_idx in ocr_slice_indices
        )
        raw_words = ocr_summary_fn(fr) if should_run_ocr else []
        words = sanitize_ocr_tokens_for_clues(raw_words)
        raw_ocr_per_slice.append((ts, raw_words, box))
        entry: Dict[str, Any] = {
            "t": round(ts, 2),
            "localT": round(max(0.0, ts - start), 3),
        }
        comps = _extract_top_foreground_components(clean_mask, width, height, max_components=3)
        if comps:
            entry["objects"] = comps
        if box:
            bx, by, bw, bh = box
            area_frac = float(bw * bh) / float(max(1, width * height))
            if area_frac >= 0.72:
                detected_hero = detect_centered_hero_card_over_bright_backdrop(fr)
                if detected_hero is not None:
                    if hero_card_info is None:
                        hero_card_info = detected_hero
                        kinetic_clues.append(
                            f"t={ts:.2f}s CENTERED VERTICAL HERO CARD at box={detected_hero['heroCardBox']} over {detected_hero['blurredBackdrop']}"
                        )
                    box = detected_hero["heroCardBox"]
                    bx, by, bw, bh = box
                    area_frac = float(bw * bh) / float(max(1, width * height))
                    entry["box"] = box
                    entry["backdrop"] = "blurred_carousel"
                else:
                    # Suppress misleading full-frame [14,13,980x552] foreground box
                    entry["backdrop"] = "full_bleed"
                    box = None
            else:
                entry["box"] = box

            if box and area_frac < 0.72:
                waypoints.append(
                    {
                        "t": round(ts, 2),
                        "box": box,
                        "center": [bx + bw // 2, by + bh // 2],
                    }
                )
            # Detect wide horizontal marquee band vs tall vertical slot reel
            if box and bw >= int(width * 0.48) and 48 <= bh <= int(height * 0.30) and not saw_wide_marquee:
                saw_wide_marquee = True
                est_px = max(36, int(round(bh * 0.62)))
                kinetic_clues.append(
                    f"t={ts:.2f}s WIDE HORIZONTAL MARQUEE at box=[{bx},{by},{bw}x{bh}] (use large font ~{est_px}px bold, words={words[:4]})"
                )
            elif (
                box
                and int(width * 0.14) <= bw <= int(width * 0.32)
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

    inline_glyph_morph = detect_inline_glyph_morph(
        sampled, accents, raw_ocr_per_slice, width, height, scene_start=start
    )
    if inline_glyph_morph:
        kinetic_clues.insert(0, inline_glyph_morph)

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

    out: Dict[str, Any] = {
        "saturatedAccents": accents,
        "objectTrajectory": trajectory_summary,
        "containerClip": container_clip,
        "denseTimeline": timeline,
        "kineticClues": kinetic_clues,
        "boundaryAnchors": {
            "entry": entry_anchor,
            "exit": exit_anchor,
        },
    }
    try:
        from ref_element_tracks import extract_scene_element_tracks

        el_tracks = extract_scene_element_tracks(frame_at_fn, start, end, width, height)
        if el_tracks:
            out["elementTracks"] = el_tracks
    except Exception:
        pass
    try:
        from ref_motion_kinematics import extract_scene_motion_kinematics

        kinematics = extract_scene_motion_kinematics(frame_at_fn, start, end, width, height)
        if kinematics:
            out["kinematics"] = kinematics
            try:
                from ref_element_feel import extract_scene_element_feel

                el_feel = extract_scene_element_feel(
                    frame_at_fn,
                    start,
                    end,
                    width,
                    height,
                    motion_bursts=kinematics.get("motionBursts"),
                    fps=30.0,
                )
                if el_feel:
                    out["elementFeel"] = el_feel
            except Exception:
                pass
    except Exception:
        pass
    try:
        from ref_secondary_motion import extract_scene_secondary_motion

        sec_motion = extract_scene_secondary_motion(frame_at_fn, start, end, width, height, fps=30.0)
        if sec_motion:
            out["secondaryMotion"] = sec_motion
    except Exception:
        pass
    if hero_card_info is not None:
        out["heroCardBox"] = hero_card_info["heroCardBox"]
        out["blurredBackdrop"] = hero_card_info["blurredBackdrop"]
    if inline_glyph_morph is not None:
        out["inlineGlyphMorph"] = inline_glyph_morph
    return out
