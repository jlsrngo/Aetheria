"""Tile-wall aware clean-plate background estimator & polarity guard (Prompt 7 R4).

Prevents temporal-median border averaging from collapsing bimodal light+dark tile walls
into a fake mid-grey `#8E8D8A` backdrop. Works symmetrically for both dark-gap and
light-gap tile walls using:
  1. Early-frame dominant uniform backdrop check (when tiles reveal over the canvas).
  2. De-rotated scanline trimmed-spread (`p85 - p15`) inter-tile gap detector:
     any full-width row or full-height column passing through bimodal tiles has huge
     inter-percentile luminance spread (~180-220), whereas a true inter-tile gap line
     has near-zero spread (<= 22) even if a small cursor/badge overlaps part of it.
  3. Honest `confidence: "low"` fallback if no uniform gap lines are found.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _bgr_to_hex(bgr: np.ndarray) -> str:
    b = int(np.clip(round(float(bgr[0])), 0, 255))
    g = int(np.clip(round(float(bgr[1])), 0, 255))
    r = int(np.clip(round(float(bgr[2])), 0, 255))
    return f"#{r:02X}{g:02X}{b:02X}"


def _hex_to_bgr_arr(hex_str: str) -> np.ndarray:
    s = str(hex_str or "").strip().lstrip("#")
    if len(s) != 6:
        return np.array([18.0, 18.0, 22.0], dtype=np.float32)
    try:
        return np.array([float(int(s[4:6], 16)), float(int(s[2:4], 16)), float(int(s[0:2], 16))], dtype=np.float32)
    except ValueError:
        return np.array([18.0, 18.0, 22.0], dtype=np.float32)


def _luma(bgr: np.ndarray) -> float:
    return float(0.114 * bgr[0] + 0.587 * bgr[1] + 0.299 * bgr[2])


def _measure_early_reveal_backdrop(
    early_frame: Optional[np.ndarray],
    light_luma: float,
    dark_luma: float,
) -> Optional[Tuple[np.ndarray, float]]:
    """Checks if an early frame still exposes >= 36% of a uniform single-color backdrop."""
    if early_frame is None or early_frame.size == 0:
        return None
    small = cv2.resize(early_frame, (128, 72), interpolation=cv2.INTER_AREA)
    q = small.astype(np.int32) // 16
    keys = (q[:, :, 0] << 8) | (q[:, :, 1] << 4) | q[:, :, 2]
    vals, counts = np.unique(keys, return_counts=True)
    if counts.size == 0:
        return None
    top_idx = int(np.argmax(counts))
    mode_frac = float(counts[top_idx]) / float(keys.size)
    if mode_frac < 0.36:
        return None

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    dark_frac = float(np.mean(gray < 65))
    light_frac = float(np.mean(gray > 180))
    if dark_frac >= 0.22 and light_frac >= 0.22 and mode_frac < 0.55:
        return None

    mode_mask = keys == vals[top_idx]
    b = 6
    border_mask = np.zeros_like(mode_mask)
    border_mask[:b, :] = True
    border_mask[-b:, :] = True
    border_mask[:, :b] = True
    border_mask[:, -b:] = True
    border_hit = float(np.sum(mode_mask & border_mask)) / float(max(1, int(np.sum(border_mask))))
    if border_hit < 0.32:
        return None

    bg_bgr = np.median(small[mode_mask], axis=0).astype(np.float32)
    mid_luma = 0.5 * (light_luma + dark_luma)
    if abs(_luma(bg_bgr) - mid_luma) < 18.0 and mode_frac < 0.55:
        return None
    return bg_bgr, mode_frac


def _scan_gap_lines_at_angle(frame_bgr: np.ndarray, angle_deg: float) -> Tuple[float, Optional[np.ndarray]]:
    """De-rotates frame by `angle_deg` and returns `(best_spread, gap_median_bgr)` from uniform gap scanlines."""
    h, w = frame_bgr.shape[:2]
    if abs(angle_deg) > 0.05:
        rot_m = cv2.getRotationMatrix2D((w * 0.5, h * 0.5), angle_deg, 1.0)
        rot = cv2.warpAffine(frame_bgr, rot_m, (w, h), borderMode=cv2.BORDER_REPLICATE)
    else:
        rot = frame_bgr
    gray = cv2.cvtColor(rot, cv2.COLOR_BGR2GRAY)

    # Trim outer margins slightly so warp border replication never mimics a gap line
    x0, x1 = int(round(w * 0.08)), int(round(w * 0.92))
    y0, y1 = int(round(h * 0.08)), int(round(h * 0.92))
    if x1 - x0 < 32 or y1 - y0 < 32:
        return 255.0, None

    roi_g = gray[y0:y1, x0:x1]
    roi_bgr = rot[y0:y1, x0:x1]

    # Inter-percentile spread (p85 - p15) ignores up to 15% foreground overlays (cursor/pill)
    row_p85 = np.percentile(roi_g, 85, axis=1)
    row_p15 = np.percentile(roi_g, 15, axis=1)
    row_spread = row_p85 - row_p15

    col_p85 = np.percentile(roi_g, 85, axis=0)
    col_p15 = np.percentile(roi_g, 15, axis=0)
    col_spread = col_p85 - col_p15

    # Confirm the ROI is genuinely bimodal across tiles (median spread is high)
    med_row_sp = float(np.median(row_spread))
    med_col_sp = float(np.median(col_spread))
    if max(med_row_sp, med_col_sp) < 60.0:
        return 255.0, None

    spread_thresh = 24.0
    gap_rows = np.where(row_spread <= spread_thresh)[0]
    gap_cols = np.where(col_spread <= spread_thresh)[0]

    best_sp = float(min(np.min(row_spread), np.min(col_spread)))
    gap_pixels: List[np.ndarray] = []

    if gap_rows.size > 0:
        # Weight toward cleanest center gap rows (within +2.5 of minimum spread to avoid tile-edge AA fringe)
        min_r = float(np.min(row_spread[gap_rows]))
        clean_r = gap_rows[row_spread[gap_rows] <= min(spread_thresh, min_r + 2.5)]
        if clean_r.size > 0:
            gap_pixels.append(roi_bgr[clean_r, :, :].reshape(-1, 3))

    if gap_cols.size > 0:
        min_c = float(np.min(col_spread[gap_cols]))
        clean_c = gap_cols[col_spread[gap_cols] <= min(spread_thresh, min_c + 2.5)]
        if clean_c.size > 0:
            gap_pixels.append(roi_bgr[:, clean_c, :].reshape(-1, 3))

    if not gap_pixels:
        return best_sp, None

    stacked = np.vstack(gap_pixels)
    if stacked.shape[0] < 32:
        return best_sp, None
    return best_sp, np.median(stacked, axis=0).astype(np.float32)


def _measure_scanline_gap_backdrop(
    frame_bgr: np.ndarray,
    tilt_deg: Optional[float],
) -> Optional[Tuple[np.ndarray, str]]:
    """Tests candidate de-rotation angles (`+tilt`, `-tilt`, `0`) to measure exact inter-tile gap color."""
    angles: List[float] = []
    if tilt_deg is not None and abs(float(tilt_deg)) > 0.1:
        t = float(tilt_deg)
        angles.extend([t, -t, 0.0])
    else:
        angles.append(0.0)

    best_spread = 255.0
    best_bgr: Optional[np.ndarray] = None
    for ang in angles:
        sp, bgr = _scan_gap_lines_at_angle(frame_bgr, ang)
        if bgr is not None and sp < best_spread:
            best_spread = sp
            best_bgr = bgr

    if best_bgr is None:
        return None
    polarity = "dark" if _luma(best_bgr) < 120.0 else "light"
    return best_bgr, polarity


def extract_tile_wall_clean_plate(
    early_frame: Optional[np.ndarray],
    mid_frame: Optional[np.ndarray],
    contrast_tiles: Dict[str, Any],
    tilt_deg: Optional[float] = None,
    fallback_hex: str = "#0C0B0E",
) -> Dict[str, Any]:
    """Measures true backdrop/gap color for a bimodal tile-wall scene without averaging tiles."""
    light_bgr = _hex_to_bgr_arr(contrast_tiles.get("lightTileHex", "#F0EEEC"))
    dark_bgr = _hex_to_bgr_arr(contrast_tiles.get("darkTileHex", "#1A1B1E"))
    light_luma = _luma(light_bgr)
    dark_luma = _luma(dark_bgr)

    # 1. Early reveal frame (direct backdrop when tiles animate in)
    early_hit = _measure_early_reveal_backdrop(early_frame, light_luma, dark_luma)
    if early_hit is not None:
        bg_bgr, mode_frac = early_hit
        bg_hex = _bgr_to_hex(bg_bgr)
        return {
            "fillHex": bg_hex,
            "bottomHex": bg_hex,
            "hasGradient": False,
            "kind": "tile-wall",
            "confidence": "high",
            "source": "early-reveal",
            "polarity": "dark" if _luma(bg_bgr) < 120.0 else "light",
            "coverage": round(mode_frac, 3),
        }

    # 2. Full-screen tile wall: measure uniform inter-tile gap scanlines after de-rotation
    if mid_frame is not None and mid_frame.size > 0:
        seam_hit = _measure_scanline_gap_backdrop(mid_frame, tilt_deg)
        if seam_hit is not None:
            bg_bgr, polarity = seam_hit
            bg_hex = _bgr_to_hex(bg_bgr)
            return {
                "fillHex": bg_hex,
                "bottomHex": bg_hex,
                "hasGradient": False,
                "kind": "tile-wall",
                "confidence": "high",
                "source": "inter-tile-gaps",
                "polarity": polarity,
            }

    # 3. Unmeasurable gaps: NEVER emit arithmetic mean of light+dark tiles; report honest low confidence
    fb_bgr = _hex_to_bgr_arr(fallback_hex)
    fb_luma = _luma(fb_bgr)
    mid_luma = 0.5 * (light_luma + dark_luma)
    if abs(fb_luma - mid_luma) < 35.0:
        safe_hex = str(contrast_tiles.get("darkTileHex") or "#0C0B0E")
    else:
        safe_hex = fallback_hex
    return {
        "fillHex": safe_hex,
        "bottomHex": safe_hex,
        "hasGradient": False,
        "kind": "tile-wall",
        "confidence": "low",
        "source": "unmeasurable-fallback",
        "polarity": "dark" if _luma(_hex_to_bgr_arr(safe_hex)) < 120.0 else "light",
    }
