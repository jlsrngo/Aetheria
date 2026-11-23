#!/usr/bin/env python3
"""
Structural fidelity evaluator (Phase B) for Aetheria MotionClone reference comparison.
Measures:
- B1: Foreground bounding-box IoU, scale ratio, and vertical band count (catching stacked vs inline layouts).
- B2: Container spill & asymmetric inner-screen clip detection (catching content leaking out of bezels/cards).
- B3: Cached per-timestamp OCR word alignment & left/right edge text-clipping detection.
"""

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

_OCR_ENGINE: Any = None
_OCR_INIT_DONE: bool = False
_MEM_OCR_CACHE: Dict[str, List[str]] = {}


def _get_ocr() -> Any:
    global _OCR_ENGINE, _OCR_INIT_DONE
    if _OCR_INIT_DONE:
        return _OCR_ENGINE
    _OCR_INIT_DONE = True
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        _OCR_ENGINE = RapidOCR()
    except Exception:
        _OCR_ENGINE = None
    return _OCR_ENGINE


def _clean_ocr_tokens(raw_res: Any) -> List[str]:
    if not raw_res:
        return []
    tokens: List[str] = []
    for item in raw_res:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        txt = str(item[1]).strip()
        conf = float(item[2]) if len(item) > 2 and item[2] is not None else 0.75
        if conf < 0.52 or not txt:
            continue
        cleaned = "".join(ch for ch in txt if ch.isalnum() or ch in (" ", "-", ".")).strip(" .-_")
        if not cleaned:
            continue
        if len(cleaned) <= 2 and not cleaned.isalnum():
            continue
        if cleaned not in tokens:
            tokens.append(cleaned)
    return tokens[:6]


def _ocr_image_cached(img_bgr: np.ndarray, cache_file: Optional[Path], cache_key: Optional[str]) -> List[str]:
    if cache_key and cache_key in _MEM_OCR_CACHE:
        return _MEM_OCR_CACHE[cache_key]

    disk_map: Dict[str, List[str]] = {}
    if cache_file and cache_key and cache_file.is_file():
        try:
            disk_map = json.loads(cache_file.read_text(encoding="utf-8"))
            if isinstance(disk_map, dict) and cache_key in disk_map:
                words = [str(w) for w in disk_map[cache_key]]
                _MEM_OCR_CACHE[cache_key] = words
                return words
        except Exception:
            disk_map = {}

    ocr = _get_ocr()
    if ocr is None:
        return []

    h, w = img_bgr.shape[:2]
    scale = min(1.0, 512.0 / max(1, max(w, h)))
    probe = (
        cv2.resize(img_bgr, (max(32, int(round(w * scale))), max(32, int(round(h * scale)))), interpolation=cv2.INTER_AREA)
        if scale < 1.0
        else img_bgr
    )
    try:
        res, _ = ocr(probe)
        words = _clean_ocr_tokens(res)
    except Exception:
        words = []

    if cache_key:
        _MEM_OCR_CACHE[cache_key] = words
        if cache_file:
            try:
                disk_map[cache_key] = words
                cache_file.write_text(json.dumps(disk_map, indent=2), encoding="utf-8")
            except Exception:
                pass
    return words


def _extract_structural_mask_and_box(
    img_bgr: np.ndarray,
    bg_bgr: np.ndarray,
    orig_w: int,
    orig_h: int,
) -> Tuple[Optional[List[int]], Optional[Tuple[int, int, int, int]], np.ndarray, float, int]:
    """Extracts cleaned foreground mask (stripping ambient radial glow and 1-2px dust) and [x,y,w,h] in orig coords."""
    h, w = img_bgr.shape[:2]
    diff = np.max(np.abs(img_bgr.astype(np.int16) - bg_bgr), axis=2)
    p99 = float(np.percentile(diff, 99))
    thr = max(28.0, min(68.0, p99 * 0.30))
    mask = (diff > thr).astype(np.uint8)
    k3 = np.ones((3, 3), np.uint8)
    clean = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3)
    if np.count_nonzero(clean) < 16:
        clean = mask

    ratio = float(np.mean(clean > 0))
    ys, xs = np.where(clean > 0)
    if ys.size < 16:
        return None, None, clean, ratio, 0

    x0 = int(np.percentile(xs, 2))
    x1 = int(np.percentile(xs, 98)) + 1
    y0 = int(np.percentile(ys, 2))
    y1 = int(np.percentile(ys, 98)) + 1

    # Count distinct horizontal content bands inside [y0..y1] (e.g. 1 inline row vs 2 stacked rows)
    row_proj = np.sum(clean[y0:y1, x0:x1] > 0, axis=1)
    row_active = row_proj >= max(2, int((x1 - x0) * 0.03))
    bands = 0
    in_band = False
    gap_run = 0
    for val in row_active:
        if val:
            if not in_band:
                bands += 1
                in_band = True
            gap_run = 0
        else:
            gap_run += 1
            if gap_run >= max(3, int((y1 - y0) * 0.08)):
                in_band = False

    sx = float(orig_w) / float(max(1, w))
    sy = float(orig_h) / float(max(1, h))
    orig_box = [
        int(round(x0 * sx)),
        int(round(y0 * sy)),
        int(round(max(1, x1 - x0) * sx)),
        int(round(max(1, y1 - y0) * sy)),
    ]
    return orig_box, (x0, y0, x1, y1), clean, ratio, bands


def _normalize_word(w: str) -> str:
    return "".join(ch.lower() for ch in w if ch.isalnum())


def detect_empty_bento_tile_cells(
    ref_cmp: np.ndarray,
    prev_cmp: np.ndarray,
) -> Optional[Dict[str, Any]]:
    """
    v13 #4: When a scene is a bimodal high-contrast bento tile grid (e.g. Scene 2), checks
    whether reference tile cells contain interior vector icons (std >= 8.0) while preview
    dark/light tile cells are left empty/flat (std < 4.5). Uses eroded connected components
    so tilted grids (e.g. -2.8 deg) and arbitrary tile origins/pitches are measured inside
    each actual tile interior without crossing tile borders.
    """
    if ref_cmp is None or prev_cmp is None or ref_cmp.size == 0 or prev_cmp.size == 0:
        return None
    h, w = ref_cmp.shape[:2]
    if h < 90 or w < 120:
        return None
    ref_gray = cv2.cvtColor(ref_cmp, cv2.COLOR_BGR2GRAY)
    prev_gray = cv2.cvtColor(prev_cmp, cv2.COLOR_BGR2GRAY)
    inner_ref = ref_gray[int(h * 0.08) : int(h * 0.92), int(w * 0.08) : int(w * 0.92)]
    bright_frac = float(np.mean(inner_ref > 175))
    dark_frac = float(np.mean(inner_ref < 75))
    if bright_frac < 0.14 or dark_frac < 0.14:
        return None

    empty_cells: List[str] = []
    ref_icon_cells = 0
    seen_centers: List[Tuple[int, int]] = []
    light_mask = (prev_gray > 165).astype(np.uint8) * 255
    num_labels, _, stats, centroids = cv2.connectedComponentsWithStats(light_mask)

    candidate_boxes: List[Tuple[str, int, int, int, int]] = []
    for lbl in range(1, num_labels):
        area = int(stats[lbl, cv2.CC_STAT_AREA])
        bx = int(stats[lbl, cv2.CC_STAT_LEFT])
        by = int(stats[lbl, cv2.CC_STAT_TOP])
        bw = int(stats[lbl, cv2.CC_STAT_WIDTH])
        bh = int(stats[lbl, cv2.CC_STAT_HEIGHT])
        if area < 200 or bw < 24 or bh < 24 or bw > int(w * 0.42) or bh > int(h * 0.55):
            continue
        candidate_boxes.append(("lightTile", bx, by, bw, bh))
        step_x = int(round(bw * 1.06))
        step_y = int(round(bh * 1.06))
        for dx, dy in ((step_x, 0), (-step_x, 0), (0, step_y), (0, -step_y)):
            nx, ny = bx + dx, by + dy
            if nx >= 0 and ny >= 0 and (nx + bw) <= w and (ny + bh) <= h:
                candidate_boxes.append(("darkTile", nx, ny, bw, bh))

    for tile_kind, bx, by, bw, bh in candidate_boxes:
        cx, cy = bx + bw // 2, by + bh // 2
        if any(abs(cx - sx) < bw * 0.45 and abs(cy - sy) < bh * 0.45 for sx, sy in seen_centers):
            continue
        seen_centers.append((cx, cy))
        x0 = max(0, int(round(bx + bw * 0.24)))
        x1 = min(w, int(round(bx + bw * 0.76)))
        y0 = max(0, int(round(by + bh * 0.24)))
        y1 = min(h, int(round(by + bh * 0.76)))
        if (x1 - x0) < 8 or (y1 - y0) < 8:
            continue
        r_patch = ref_gray[y0:y1, x0:x1]
        p_patch = prev_gray[y0:y1, x0:x1]
        p_med = float(np.median(p_patch))
        if tile_kind == "darkTile" and p_med > 90:
            continue
        if tile_kind == "lightTile" and p_med < 150:
            continue
        r_std = float(np.std(r_patch))
        p_std = float(np.std(p_patch))
        if r_std >= 8.0:
            ref_icon_cells += 1
            if p_std < 4.5:
                empty_cells.append(f"({tile_kind}@x={cx},y={cy})")

    if ref_icon_cells >= 3 and len(empty_cells) >= 2:
        coords_str = ", ".join(empty_cells[:5])
        return {
            "emptyTileCellsDetected": True,
            "emptyCells": empty_cells[:6],
            "penalty": 0.14,
            "diagnosis": (
                f"EMPTY BENTO CELLS at {coords_str} — draw crisp contrast-inverted vector icons "
                f"inside dark tiles too (never leave darkTile cells blank)"
            ),
        }
    return None


def evaluate_text_alignment(ref_words: List[str], prev_words: List[str]) -> Dict[str, Any]:
    """Compares OCR tokens at the same timestamp to detect clipped words, timing drift, or hallucinated rows."""
    ref_norm = [_normalize_word(w) for w in ref_words if len(_normalize_word(w)) >= 4]
    prev_norm = [_normalize_word(w) for w in prev_words if len(_normalize_word(w)) >= 3]
    if not ref_norm:
        return {
            "clippedTextDetected": False,
            "textDriftDetected": False,
            "extraTextDetected": False,
            "textMatchScore": 1.0,
            "textDiagnosis": "",
        }
    if not prev_norm:
        return {
            "clippedTextDetected": False,
            "textDriftDetected": True,
            "extraTextDetected": False,
            "textMatchScore": 0.25,
            "textDiagnosis": f"expected text {ref_words} missing in preview",
        }

    joined_prev = "".join(prev_norm)
    joined_ref = "".join(ref_norm)
    clipped_pairs: List[str] = []
    matched = 0
    valid_ref_pairs = [(rw, _normalize_word(rw)) for rw in ref_words if len(_normalize_word(rw)) >= 4]
    for rw_raw, rn in valid_ref_pairs:
        exact_or_prefix = (
            (rn in joined_prev)
            or (len(rn) >= 6 and rn[:6] in joined_prev)
            or any(
                pn == rn
                or (len(pn) >= 4 and (rn.startswith(pn[:5]) or pn.startswith(rn[:5])))
                for pn in prev_norm
            )
        )
        if exact_or_prefix:
            matched += 1
            continue
        # Check if preview only contains a clipped suffix/middle fragment (e.g. 'Movement' -> 'ement', 'Transitions' -> 'sitions')
        for pw_raw in prev_words:
            pn = _normalize_word(pw_raw)
            if 3 <= len(pn) <= len(rn) - 2 and (rn.endswith(pn) or rn[1:].startswith(pn)):
                clipped_pairs.append(f"'{rw_raw}'->'{pw_raw}'")
                break

    # Detect extra stacked/hallucinated tokens when reference has a single hero word (e.g. 'Showrea' vs ['SLOI', 'Showreel'])
    extra_tokens: List[str] = []
    for pw_raw in prev_words:
        pn = _normalize_word(pw_raw)
        if len(pn) < 3:
            continue
        is_rel = (
            (pn in joined_ref)
            or (len(pn) >= 5 and pn[:5] in joined_ref)
            or any(
                pn == rn or rn.startswith(pn[:4]) or pn.startswith(rn[:4]) or (pn in rn) or (rn in pn)
                for _, rn in valid_ref_pairs
            )
        )
        if not is_rel:
            extra_tokens.append(pw_raw)

    # Scrolling marquee phase tolerance (general, word-agnostic):
    # A scrolling marquee shifts one word partially off the left edge (len(clipped_pairs) == 1)
    # while at least one center word matches (matched >= 1) and a new word scrolls in on the right
    # (len(extra_tokens) >= 1) — unlike a static clipped container where 2+ words are cut with 0 new words.
    if len(valid_ref_pairs) >= 2 and matched >= 1 and len(clipped_pairs) == 1 and len(extra_tokens) >= 1:
        return {
            "clippedTextDetected": False,
            "textDriftDetected": False,
            "extraTextDetected": False,
            "textMatchScore": 0.90,
            "textDiagnosis": "",
        }

    denom = max(1, len(valid_ref_pairs))
    match_ratio = float(matched) / float(denom)
    clipped = len(clipped_pairs) > 0
    drift = (match_ratio < 0.68 and not clipped) or (len(ref_norm) >= 2 and len(extra_tokens) >= 1 and match_ratio < 0.9)
    extra = len(extra_tokens) > 0 and len(ref_norm) == 1

    diag_parts: List[str] = []
    if clipped:
        diag_parts.append(
            f"CLIPPED TEXT at container edge ({', '.join(clipped_pairs)} — shift text inside container clipRect with proper padding)"
        )
    if drift:
        diag_parts.append(
            f"TEXT SUB-BEAT/WORD MISMATCH (expected {ref_words} at this timestamp, got {prev_words})"
        )
    elif extra:
        diag_parts.append(
            f"EXTRA/STACKED TEXT {extra_tokens} alongside {ref_words} (render morphing glyphs inline on the single hero baseline, remove hallucinated subtitle/header)"
        )

    score = match_ratio
    if clipped:
        score = min(score, 0.35)
    if extra:
        score = min(score, 0.55)

    return {
        "clippedTextDetected": clipped,
        "textDriftDetected": drift,
        "extraTextDetected": extra,
        "textMatchScore": round(float(np.clip(score, 0.0, 1.0)), 4),
        "textDiagnosis": "; ".join(diag_parts),
    }


def detect_color_and_luma_drift(
    ref_cmp: np.ndarray,
    prev_cmp: np.ndarray,
) -> Optional[str]:
    """Detects measured luma or foreground hue drift when mean delta exceeds thresholds."""
    if ref_cmp is None or prev_cmp is None or ref_cmp.size == 0 or prev_cmp.size == 0:
        return None
    ref_luma = float(np.mean(cv2.cvtColor(ref_cmp, cv2.COLOR_BGR2GRAY))) / 255.0
    prev_luma = float(np.mean(cv2.cvtColor(prev_cmp, cv2.COLOR_BGR2GRAY))) / 255.0
    delta_luma = abs(prev_luma - ref_luma)

    ref_hsv = cv2.cvtColor(ref_cmp, cv2.COLOR_BGR2HSV)
    prev_hsv = cv2.cvtColor(prev_cmp, cv2.COLOR_BGR2HSV)
    ref_sat = (ref_hsv[:, :, 1] >= 60) & (ref_hsv[:, :, 2] >= 45)
    prev_sat = (prev_hsv[:, :, 1] >= 60) & (prev_hsv[:, :, 2] >= 45)

    has_sat_pair = int(np.count_nonzero(ref_sat)) >= 40 and int(np.count_nonzero(prev_sat)) >= 40
    if has_sat_pair:
        h_ref = float(np.median(ref_hsv[:, :, 0][ref_sat]))
        h_prev = float(np.median(prev_hsv[:, :, 0][prev_sat]))
        diff_h = abs(h_ref - h_prev)
        delta_hue = min(diff_h, 180.0 - diff_h)
        ref_bgr = np.mean(ref_cmp[ref_sat], axis=0)
        prev_bgr = np.mean(prev_cmp[prev_sat], axis=0)
    else:
        h_ref = 0.0
        h_prev = 0.0
        delta_hue = 0.0
        ref_bgr = np.mean(ref_cmp.reshape(-1, 3), axis=0)
        prev_bgr = np.mean(prev_cmp.reshape(-1, 3), axis=0)

    if delta_luma <= 0.06 and not (has_sat_pair and delta_hue >= 5.0):
        return None

    ref_hex = f"#{int(round(ref_bgr[2])):02X}{int(round(ref_bgr[1])):02X}{int(round(ref_bgr[0])):02X}"
    prev_hex = f"#{int(round(prev_bgr[2])):02X}{int(round(prev_bgr[1])):02X}{int(round(prev_bgr[0])):02X}"
    return (
        f"COLOR DRIFT: ref fg ≈ {ref_hex} (hue {h_ref:.0f}, luma {ref_luma:.2f}), "
        f"preview ≈ {prev_hex} (hue {h_prev:.0f}, luma {prev_luma:.2f}) — match the fill hex"
    )


def evaluate_structural_frame_pair(
    ref_cmp: np.ndarray,
    prev_cmp: np.ndarray,
    bg_bgr: np.ndarray,
    orig_w: int,
    orig_h: int,
    ref_path: Optional[Path] = None,
    edge_sim: float = 1.0,
) -> Dict[str, Any]:
    """Computes B1 (bbox IoU/scale/bands), B2 (container spill), and B3 (timestamp OCR alignment)."""
    h, w = ref_cmp.shape[:2]
    ref_box, ref_local, ref_mask, ref_ratio, ref_bands = _extract_structural_mask_and_box(
        ref_cmp, bg_bgr, orig_w, orig_h
    )
    prev_box, prev_local, prev_mask, prev_ratio, prev_bands = _extract_structural_mask_and_box(
        prev_cmp, bg_bgr, orig_w, orig_h
    )

    bbox_iou = 1.0
    scale_ratio = 1.0
    container_spill = False
    stacked_row_mismatch = False
    struct_diags: List[str] = []

    if ref_box and prev_box and ref_local and prev_local:
        rx, ry, rw_b, rh_b = ref_box
        px, py, pw_b, ph_b = prev_box
        rx0, ry0, rx1, ry1 = ref_local
        ix0, iy0 = max(rx, px), max(ry, py)
        ix1, iy1 = min(rx + rw_b, px + pw_b), min(ry + rh_b, py + ph_b)
        inter = float(max(0, ix1 - ix0) * max(0, iy1 - iy0))
        union = float(rw_b * rh_b + pw_b * ph_b) - inter
        bbox_iou = float(np.clip(inter / max(1.0, union), 0.0, 1.0))

        ref_area_frac = float(rw_b * rh_b) / float(max(1, orig_w * orig_h))
        prev_area_frac = float(pw_b * ph_b) / float(max(1, orig_w * orig_h))
        scale_ratio = round(prev_area_frac / max(ref_area_frac, 1e-4), 3)

        # B2: Container spill (reference has a medium/large bounded container 14%..68% of canvas)
        if 0.14 <= ref_area_frac <= 0.68:
            pad_x, pad_y = int(0.04 * w), int(0.04 * h)
            in_ref = np.zeros_like(prev_mask)
            in_ref[max(0, ry0 - pad_y) : min(h, ry1 + pad_y), max(0, rx0 - pad_x) : min(w, rx1 + pad_x)] = 1
            out_frac = float(np.sum((prev_mask > 0) & (in_ref == 0))) / float(
                max(1, int(np.sum(prev_mask > 0)))
            )
            if scale_ratio > 1.35 and out_frac > 0.20:
                container_spill = True
                struct_diags.append(
                    f"CONTAINER SPILL: preview elements [{px},{py},{pw_b}x{ph_b}] spill outside ref container [{rx},{ry},{rw_b}x{rh_b}] (area={scale_ratio:.2f}x, spill={out_frac:.0%} — clip inner canvas to [{rx},{ry},{rw_b},{rh_b}])"
                )

        # B1b: Stacked rows vs single inline row (e.g. Scene 1 icons stacked at y=192 above Showreel instead of inline y=235..360)
        if (
            ref_bands == 1
            and prev_bands >= 2
            and ref_area_frac <= 0.35
            and (ry - py) >= int(0.05 * orig_h)
        ):
            stacked_row_mismatch = True
            struct_diags.append(
                f"STACKED ROW LAYOUT MISMATCH: ref has 1 inline horizontal band at [{rx},{ry},{rw_b}x{rh_b}], preview stacked {prev_bands} bands starting at y={py} ([{px},{py},{pw_b}x{ph_b}] — place morphing shapes/letters inline on the SAME baseline y={ry + rh_b // 2})"
            )

        # B1a: Position or scale mismatch on non-full-bleed scenes
        if not container_spill and ref_area_frac < 0.72 and bbox_iou < 0.56:
            if scale_ratio < 0.52:
                struct_diags.append(
                    f"UNDERSIZED ELEMENTS: preview box [{px},{py},{pw_b}x{ph_b}] is {scale_ratio:.2f}x smaller than ref [{rx},{ry},{rw_b}x{rh_b}] (IoU={bbox_iou:.2f} — enlarge hero typography/shape to fill {rw_b}x{rh_b}px)"
                )
            elif scale_ratio > 1.65:
                struct_diags.append(
                    f"OVERSIZED ELEMENTS: preview box [{px},{py},{pw_b}x{ph_b}] is {scale_ratio:.2f}x larger than ref [{rx},{ry},{rw_b}x{rh_b}] (IoU={bbox_iou:.2f} — scale/fold shape down to [{rx},{ry},{rw_b}x{rh_b}])"
                )
            else:
                struct_diags.append(
                    f"POSITION/SCALE SHIFT: preview box [{px},{py},{pw_b}x{ph_b}] vs ref [{rx},{ry},{rw_b}x{rh_b}] (IoU={bbox_iou:.2f} — align center/pose to ({rx + rw_b // 2},{ry + rh_b // 2}) sized {rw_b}x{rh_b}px)"
                )

    # B3: Selective cached OCR check on bounded foreground scenes when edge_sim < 0.62
    ref_words: List[str] = []
    prev_words: List[str] = []
    text_info: Dict[str, Any] = {
        "clippedTextDetected": False,
        "textDriftDetected": False,
        "extraTextDetected": False,
        "textMatchScore": 1.0,
        "textDiagnosis": "",
    }
    ref_area_frac_check = (
        float(ref_box[2] * ref_box[3]) / float(max(1, orig_w * orig_h)) if ref_box else 1.0
    )
    if 0.008 <= ref_ratio <= 0.48 and ref_area_frac_check < 0.78 and edge_sim < 0.62:
        cache_file = (ref_path.parent / ".ocr_cache.json") if (ref_path and ref_path.is_file()) else None
        cache_key = None
        if ref_path and ref_path.is_file():
            try:
                st = ref_path.stat()
                cache_key = f"{ref_path.name}:{st.st_size}:{int(st.st_mtime)}"
            except Exception:
                cache_key = ref_path.name
        ref_words = _ocr_image_cached(ref_cmp, cache_file, cache_key)
        if ref_words:
            prev_digest = hashlib.md5(prev_cmp.tobytes()).hexdigest()[:12]
            prev_words = _ocr_image_cached(prev_cmp, None, f"prev:{prev_digest}")
            text_info = evaluate_text_alignment(ref_words, prev_words)
            if text_info["textDiagnosis"]:
                struct_diags.append(text_info["textDiagnosis"])

    bento_info = detect_empty_bento_tile_cells(ref_cmp, prev_cmp)
    empty_bento = False
    if bento_info is not None:
        empty_bento = True
        struct_diags.append(bento_info["diagnosis"])

    color_drift_diag = detect_color_and_luma_drift(ref_cmp, prev_cmp)
    if color_drift_diag is not None:
        struct_diags.append(color_drift_diag)

    # Compute structural penalty so structural bugs (spill, clipped text, wrong active words, tiny marquee, wrong pose)
    # cannot hide behind high dark-background SSIM.
    penalty = 0.0
    if container_spill:
        penalty += 0.14
    if stacked_row_mismatch:
        penalty += 0.10
    if empty_bento:
        penalty += 0.14
    if ref_area_frac_check < 0.72 and bbox_iou < 0.55:
        penalty += min(0.14, (0.55 - bbox_iou) * 0.32)
    if text_info["clippedTextDetected"]:
        penalty += 0.12
    elif text_info["textDriftDetected"]:
        penalty += 0.14
    elif text_info["extraTextDetected"]:
        penalty += 0.08

    return {
        "fgBboxIou": round(bbox_iou, 4),
        "fgScaleRatio": scale_ratio,
        "refFgBox": ref_box,
        "prevFgBox": prev_box,
        "containerSpillDetected": container_spill,
        "stackedRowMismatch": stacked_row_mismatch,
        "emptyTileCellsDetected": empty_bento,
        "clippedTextDetected": bool(text_info["clippedTextDetected"]),
        "textDriftDetected": bool(text_info["textDriftDetected"]),
        "refOcrWords": ref_words,
        "prevOcrWords": prev_words,
        "structuralPenalty": round(min(0.28, penalty), 4),
        "structuralDiagnosis": "; ".join(struct_diags),
    }
