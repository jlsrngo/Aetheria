"""
MotionClone-inspired Closed-Loop Visual Comparison Engine.
Computes per-channel RGB SSIM (11x11 Gaussian window, sigma=1.5), color histogram
similarity, Sobel/Canny edge structure overlap, and renders a side-by-side
[Reference | Generated | Amplified Diff] comparison strip JPEG.
"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import cv2
    import numpy as np
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"Required Python vision library missing: {e}"}))
    sys.exit(1)


def compute_rgb_ssim(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Computes per-channel RGB SSIM with an 11x11 Gaussian window (sigma=1.5)."""
    a = img_a.astype(np.float64)
    b = img_b.astype(np.float64)
    c1 = (0.01 * 255.0) ** 2
    c2 = (0.03 * 255.0) ** 2

    channel_scores: List[float] = []
    for ch in range(3):
        ac = a[:, :, ch]
        bc = b[:, :, ch]
        mu1 = cv2.GaussianBlur(ac, (11, 11), 1.5)
        mu2 = cv2.GaussianBlur(bc, (11, 11), 1.5)
        mu1_sq = mu1 * mu1
        mu2_sq = mu2 * mu2
        mu1_mu2 = mu1 * mu2

        sigma1_sq = cv2.GaussianBlur(ac * ac, (11, 11), 1.5) - mu1_sq
        sigma2_sq = cv2.GaussianBlur(bc * bc, (11, 11), 1.5) - mu2_sq
        sigma12 = cv2.GaussianBlur(ac * bc, (11, 11), 1.5) - mu1_mu2

        num = (2.0 * mu1_mu2 + c1) * (2.0 * sigma12 + c2)
        den = (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)
        ssim_map = num / np.maximum(den, 1e-8)
        channel_scores.append(float(np.mean(ssim_map)))

    return float(np.clip(np.mean(channel_scores), 0.0, 1.0))


def _smooth_l1_hist(channel: np.ndarray, bins: int = 24) -> np.ndarray:
    hist = cv2.calcHist([channel], [0], None, [bins], [0, 256]).flatten().astype(np.float32)
    kernel = np.array([0.2, 0.6, 0.2], dtype=np.float32)
    smoothed = np.convolve(hist, kernel, mode="same")
    total = float(np.sum(smoothed))
    if total > 0.0:
        smoothed /= total
    return smoothed.reshape(-1, 1)


def compute_color_similarity(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Combines CIELAB channel distribution overlap (immune to neutral hue wrap) with RGB proximity."""
    lab_a = cv2.cvtColor(img_a, cv2.COLOR_BGR2LAB)
    lab_b = cv2.cvtColor(img_b, cv2.COLOR_BGR2LAB)
    channel_sims: List[float] = []
    for ch in range(3):
        ha = _smooth_l1_hist(lab_a[:, :, ch])
        hb = _smooth_l1_hist(lab_b[:, :, ch])
        bhatt = float(cv2.compareHist(ha, hb, cv2.HISTCMP_BHATTACHARYYA))
        channel_sims.append(max(0.0, 1.0 - bhatt))
    dist_sim = float(np.mean(channel_sims))

    mean_diff = float(np.mean(np.abs(img_a.astype(np.float32) - img_b.astype(np.float32)))) / 255.0
    pixel_color_sim = max(0.0, 1.0 - mean_diff * 1.4)
    return float(np.clip(0.55 * dist_sim + 0.45 * pixel_color_sim, 0.0, 1.0))


def compute_edge_similarity(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Measures spatial composition alignment via dilated Canny edge F1 overlap."""
    ga = cv2.GaussianBlur(cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    gb = cv2.GaussianBlur(cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    ea = cv2.Canny(ga, 50, 150) > 0
    eb = cv2.Canny(gb, 50, 150) > 0

    ea_sum = int(np.sum(ea))
    eb_sum = int(np.sum(eb))
    if ea_sum == 0 and eb_sum == 0:
        return 1.0
    if ea_sum == 0 or eb_sum == 0:
        return 0.15

    kernel = np.ones((5, 5), np.uint8)
    ea_dil = cv2.dilate(ea.astype(np.uint8), kernel, iterations=1) > 0
    eb_dil = cv2.dilate(eb.astype(np.uint8), kernel, iterations=1) > 0

    prec = float(np.sum(eb & ea_dil)) / max(1, eb_sum)
    rec = float(np.sum(ea & eb_dil)) / max(1, ea_sum)
    if prec + rec <= 1e-6:
        return 0.0
    return float(np.clip(2.0 * prec * rec / (prec + rec), 0.0, 1.0))


def compute_luma_correlation(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Measures spatial polarity alignment via normalized grayscale Pearson correlation (-1..1)."""
    ga = cv2.resize(cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY), (24, 14), interpolation=cv2.INTER_AREA).astype(np.float32).flatten()
    gb = cv2.resize(cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY), (24, 14), interpolation=cv2.INTER_AREA).astype(np.float32).flatten()
    ga -= float(np.mean(ga))
    gb -= float(np.mean(gb))
    denom = float(np.linalg.norm(ga) * np.linalg.norm(gb))
    if denom < 1e-4:
        return 1.0 if float(np.max(np.abs(ga - gb))) < 8.0 else 0.0
    return float(np.clip(np.dot(ga, gb) / denom, -1.0, 1.0))


def _fit_for_strip(img: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    return cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)


def _fit_letterbox(img: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    """Resizes preserving source aspect ratio inside target_w x target_h with padding."""
    sh, sw = img.shape[:2]
    if sw <= 0 or sh <= 0:
        return np.zeros((target_h, target_w, 3), dtype=np.uint8)
    scale = min(float(target_w) / float(sw), float(target_h) / float(sh))
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
    ox = (target_w - nw) // 2
    oy = (target_h - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = resized
    return canvas


def compute_foreground_metrics(ref_bgr: np.ndarray, prev_bgr: np.ndarray) -> Dict[str, Any]:
    """Detects blank/crashed previews on dark/uniform backdrops and evaluates active foreground ROI."""
    h, w = ref_bgr.shape[:2]
    b = max(4, min(10, h // 24, w // 24))
    border = np.concatenate(
        [
            ref_bgr[:b, :, :].reshape(-1, 3),
            ref_bgr[-b:, :, :].reshape(-1, 3),
            ref_bgr[:, :b, :].reshape(-1, 3),
            ref_bgr[:, -b:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    bg_bgr = np.median(border, axis=0).astype(np.int16)
    ref_fg = np.max(np.abs(ref_bgr.astype(np.int16) - bg_bgr), axis=2) > 22
    prev_fg = np.max(np.abs(prev_bgr.astype(np.int16) - bg_bgr), axis=2) > 22

    ref_ratio = float(np.mean(ref_fg))
    prev_ratio = float(np.mean(prev_fg))
    coverage = prev_ratio / max(ref_ratio, 1e-6) if ref_ratio > 0 else 1.0
    blank_detected = bool(ref_ratio >= 0.012 and prev_ratio < ref_ratio * 0.12)

    fg_ssim = None
    fg_color = None
    if not blank_detected and 0.012 <= ref_ratio <= 0.42:
        union = ref_fg | prev_fg
        ys, xs = np.where(union)
        if ys.size >= 32 and xs.size >= 32:
            pad = 16
            y0 = max(0, int(ys.min()) - pad)
            y1 = min(h, int(ys.max()) + pad + 1)
            x0 = max(0, int(xs.min()) - pad)
            x1 = min(w, int(xs.max()) + pad + 1)
            if (y1 - y0) >= 24 and (x1 - x0) >= 24:
                fg_ssim = compute_rgb_ssim(ref_bgr[y0:y1, x0:x1], prev_bgr[y0:y1, x0:x1])
        if np.count_nonzero(ref_fg) >= 32 and np.count_nonzero(prev_fg) >= 32:
            r_hsv = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2HSV)
            p_hsv = cv2.cvtColor(prev_bgr, cv2.COLOR_BGR2HSV)
            h1 = cv2.calcHist([r_hsv], [0, 1], ref_fg.astype(np.uint8) * 255, [24, 16], [0, 180, 0, 256])
            h2 = cv2.calcHist([p_hsv], [0, 1], prev_fg.astype(np.uint8) * 255, [24, 16], [0, 180, 0, 256])
            cv2.normalize(h1, h1, 0, 1, cv2.NORM_MINMAX)
            cv2.normalize(h2, h2, 0, 1, cv2.NORM_MINMAX)
            corr = float(cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL))
            fg_color = float(np.clip((corr + 1.0) * 0.5, 0.0, 1.0))

    return {
        "blankFrameDetected": blank_detected,
        "fgCoverageRatio": round(min(coverage, 9.99), 3),
        "fgSsim": fg_ssim,
        "fgColor": fg_color,
        "bgBgr": bg_bgr,
    }


def _mean_adjacent_frame_delta(frames: List[Tuple[float, np.ndarray]]) -> Optional[float]:
    if len(frames) < 2:
        return None
    ordered = sorted(frames, key=lambda x: x[0])
    deltas: List[float] = []
    for (t0, g0), (t1, g1) in zip(ordered, ordered[1:]):
        if abs(t1 - t0) < 0.03:
            continue
        if g0.shape != g1.shape:
            g1 = cv2.resize(g1, (g0.shape[1], g0.shape[0]), interpolation=cv2.INTER_AREA)
        diff = np.abs(g0.astype(np.float32) - g1.astype(np.float32))
        deltas.append(float(np.mean(diff)))
    if not deltas:
        return None
    return round(float(np.mean(deltas)), 2)


def _compute_motion_step_diagnostics(
    ref_frames: List[Tuple[float, np.ndarray]],
    prev_frames: List[Tuple[float, np.ndarray]],
) -> Dict[str, Any]:
    if len(ref_frames) < 2 or len(prev_frames) != len(ref_frames):
        return {
            "refStepDeltas": [],
            "prevStepDeltas": [],
            "frozenIntervals": [],
            "jumpIntervals": [],
            "motionWarning": None,
        }
    ref_ord = sorted(ref_frames, key=lambda x: x[0])
    prev_ord = sorted(prev_frames, key=lambda x: x[0])
    ref_steps: List[float] = []
    prev_steps: List[float] = []
    frozen_intervals: List[str] = []
    jump_intervals: List[str] = []
    for ((rt0, rg0), (rt1, rg1)), ((pt0, pg0), (pt1, pg1)) in zip(
        zip(ref_ord, ref_ord[1:]),
        zip(prev_ord, prev_ord[1:]),
    ):
        if abs(rt1 - rt0) < 0.025:
            continue
        if rg0.shape != rg1.shape:
            rg1 = cv2.resize(rg1, (rg0.shape[1], rg0.shape[0]), interpolation=cv2.INTER_AREA)
        if pg0.shape != pg1.shape:
            pg1 = cv2.resize(pg1, (pg0.shape[1], pg0.shape[0]), interpolation=cv2.INTER_AREA)
        rd = round(float(np.mean(np.abs(rg0.astype(np.float32) - rg1.astype(np.float32)))), 2)
        pd = round(float(np.mean(np.abs(pg0.astype(np.float32) - pg1.astype(np.float32)))), 2)
        ref_steps.append(rd)
        prev_steps.append(pd)
        if rd >= 0.45 and pd < 0.08:
            frozen_intervals.append(f"{pt0:.2f}s->{pt1:.2f}s (REF d={rd:.2f} vs RND d={pd:.2f})")
        elif pd >= 18.0 and pd > max(18.0, rd * 2.8) and rd < 14.0:
            jump_intervals.append(f"{pt0:.2f}s->{pt1:.2f}s (RND d={pd:.2f} vs REF d={rd:.2f})")

    warnings: List[str] = []
    if frozen_intervals:
        warnings.append(
            "MOTION FROZEN WARNING: Your rendered scene is static while the reference moves at "
            + ", ".join(frozen_intervals[:4])
            + " — animate position/scale/morph continuously across `t` instead of holding a static pose!"
        )
    if jump_intervals:
        warnings.append(
            "MOTION JUMP / TELEPORT WARNING: Your rendered scene snaps abruptly between frames at "
            + ", ".join(jump_intervals[:4])
            + " while the reference moves smoothly — remove sudden `if (t >= X)` position/phase jumps or mid-scene `return;` cutoffs and interpolate smoothly with `AM.lerp` / `AM.ease` or a smooth `Math.sin(p * Math.PI)` envelope!"
        )
    return {
        "refStepDeltas": ref_steps,
        "prevStepDeltas": prev_steps,
        "frozenIntervals": frozen_intervals,
        "jumpIntervals": jump_intervals,
        "motionWarning": "\n".join(warnings) if warnings else None,
    }


def compare_pairs(payload: Dict[str, Any]) -> Dict[str, Any]:
    pairs = payload.get("pairs") or []
    if not pairs:
        return {"ok": False, "error": "No reference/preview frame pairs supplied."}

    strip_out = Path(payload.get("stripOutputPath", "comparison_strip.jpg"))
    strip_out.parent.mkdir(parents=True, exist_ok=True)
    raw_threshold = payload.get("passThreshold")
    threshold = float(raw_threshold) if raw_threshold is not None else 0.85

    ref_video_raw = payload.get("refVideoPath")
    ref_video_path = Path(str(ref_video_raw)) if ref_video_raw else None
    video_cap: Optional[cv2.VideoCapture] = None
    video_fps: float = 30.0
    video_total_frames: int = 0
    if ref_video_path is not None and ref_video_path.is_file():
        cap_candidate = cv2.VideoCapture(str(ref_video_path))
        if cap_candidate.isOpened():
            video_cap = cap_candidate
            video_fps = max(1.0, float(video_cap.get(cv2.CAP_PROP_FPS) or 30.0))
            video_total_frames = max(0, int(video_cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0))

    per_frame: List[Dict[str, Any]] = []
    strip_rows: List[np.ndarray] = []
    prev_grays: List[Tuple[float, np.ndarray]] = []
    ref_grays: List[Tuple[float, np.ndarray]] = []
    scene_tiles_map: Dict[str, List[Tuple[float, np.ndarray, np.ndarray, np.ndarray, float, float, float]]] = {}
    any_ar_mismatch = False

    for item in pairs:
        ref_path = Path(str(item.get("refPath", "")))
        prev_path = Path(str(item.get("previewPath", "")))
        ts = float(item.get("timestamp", 0.0))
        video_ts = float(item.get("videoTimestamp", ts))
        ref_ts = float(item.get("refTimestamp", ts))
        scene_id = item.get("sceneId")
        phase = item.get("phase")

        if not prev_path.is_file():
            continue

        prev_img = cv2.imread(str(prev_path))
        if prev_img is None:
            continue

        ref_img: Optional[np.ndarray] = None
        if video_cap is not None and (abs(ts - ref_ts) > 0.04 or not ref_path.is_file()):
            target_f = max(0, int(round(max(0.0, video_ts) * video_fps)))
            if video_total_frames > 0:
                target_f = min(video_total_frames - 1, target_f)
            video_cap.set(cv2.CAP_PROP_POS_FRAMES, target_f)
            ok_dec, frame_dec = video_cap.read()
            if ok_dec and frame_dec is not None:
                ref_img = frame_dec

        if ref_img is None and ref_path.is_file():
            ref_img = cv2.imread(str(ref_path))
        if ref_img is None:
            continue

        rh, rw = ref_img.shape[:2]
        ph, pw = prev_img.shape[:2]
        ref_ar = float(rw) / max(1.0, float(rh))
        prev_ar = float(pw) / max(1.0, float(ph))
        ar_diff_ratio = abs(ref_ar - prev_ar) / max(ref_ar, prev_ar, 1e-6)
        ar_mismatch = ar_diff_ratio > 0.02
        if ar_mismatch:
            any_ar_mismatch = True

        # Normalize comparison size up to 480px max dimension (preserving aspect without silent distortion)
        scale = min(1.0, 480.0 / max(1, max(ph, pw)))
        cw = max(64, int(round(pw * scale)))
        ch = max(64, int(round(ph * scale)))

        ref_cmp = _fit_letterbox(ref_img, cw, ch) if ar_mismatch else _fit_for_strip(ref_img, cw, ch)
        prev_cmp = _fit_for_strip(prev_img, cw, ch)
        prev_grays.append((ts, cv2.cvtColor(prev_cmp, cv2.COLOR_BGR2GRAY)))
        ref_grays.append((ts, cv2.cvtColor(ref_cmp, cv2.COLOR_BGR2GRAY)))

        ssim = compute_rgb_ssim(ref_cmp, prev_cmp)
        color_sim = compute_color_similarity(ref_cmp, prev_cmp)
        edge_sim = compute_edge_similarity(ref_cmp, prev_cmp)
        luma_corr = compute_luma_correlation(ref_cmp, prev_cmp)
        fg_info = compute_foreground_metrics(ref_cmp, prev_cmp)
        if fg_info["fgSsim"] is not None:
            ssim = float(np.clip(0.65 * ssim + 0.35 * fg_info["fgSsim"], 0.0, 1.0))
        if fg_info["fgColor"] is not None:
            color_sim = float(np.clip(0.55 * color_sim + 0.45 * fg_info["fgColor"], 0.0, 1.0))
        luma_ref = float(np.mean(cv2.cvtColor(ref_cmp, cv2.COLOR_BGR2GRAY))) / 255.0
        luma_prev = float(np.mean(cv2.cvtColor(prev_cmp, cv2.COLOR_BGR2GRAY))) / 255.0
        luma_delta = round(luma_prev - luma_ref, 3)

        struct_info: Dict[str, Any] = {}
        if not fg_info["blankFrameDetected"]:
            try:
                from ref_structural_compare import evaluate_structural_frame_pair

                struct_info = evaluate_structural_frame_pair(
                    ref_cmp,
                    prev_cmp,
                    fg_info["bgBgr"],
                    int(rw),
                    int(rh),
                    ref_path=ref_path,
                    edge_sim=edge_sim,
                )
            except Exception:
                struct_info = {}

        struct_pen = float(struct_info.get("structuralPenalty", 0.0))
        combined = float(
            np.clip(0.50 * ssim + 0.30 * color_sim + 0.20 * edge_sim - struct_pen, 0.0, 1.0)
        )
        if fg_info["blankFrameDetected"]:
            combined = min(combined, 0.12)
        if ar_mismatch:
            verdict = "aspect_mismatch"
        else:
            verdict = "cocok" if combined >= 0.85 else ("sebagian" if combined >= 0.65 else "beda")

        ref_rel = str(item.get("refRelPath") or ref_path.name)
        prev_rel = str(item.get("previewRelPath") or prev_path.name)
        entry: Dict[str, Any] = {
            "timestamp": round(ts, 3),
            "refPath": ref_rel,
            "refRelPath": ref_rel,
            "previewPath": prev_rel,
            "previewRelPath": prev_rel,
            "ssim": round(ssim, 4),
            "colorSimilarity": round(color_sim, 4),
            "edgeSimilarity": round(edge_sim, 4),
            "luminanceDelta": luma_delta,
            "lumaCorrelation": round(luma_corr, 3),
            "blankFrameDetected": bool(fg_info["blankFrameDetected"]),
            "fgCoverageRatio": fg_info["fgCoverageRatio"],
            "fgBboxIou": struct_info.get("fgBboxIou"),
            "fgScaleRatio": struct_info.get("fgScaleRatio"),
            "refFgBox": struct_info.get("refFgBox"),
            "prevFgBox": struct_info.get("prevFgBox"),
            "containerSpillDetected": bool(struct_info.get("containerSpillDetected", False)),
            "stackedRowMismatch": bool(struct_info.get("stackedRowMismatch", False)),
            "clippedTextDetected": bool(struct_info.get("clippedTextDetected", False)),
            "textDriftDetected": bool(struct_info.get("textDriftDetected", False)),
            "structuralDiagnosis": struct_info.get("structuralDiagnosis") or "",
            "combinedScore": round(combined, 4),
            "aspectRatioMismatch": bool(ar_mismatch),
            "refDimensions": [int(rw), int(rh)],
            "previewDimensions": [int(pw), int(ph)],
            "verdict": verdict,
        }
        if scene_id:
            entry["sceneId"] = scene_id
        if phase:
            entry["phase"] = phase
        per_frame.append(entry)

        # Build [Reference | Generated | Diff Heatmap] row
        diff_raw = cv2.absdiff(ref_cmp, prev_cmp)
        diff_gray = cv2.cvtColor(diff_raw, cv2.COLOR_BGR2GRAY)
        diff_boost = np.clip(diff_gray.astype(np.float32) * 2.5, 0, 255).astype(np.uint8)
        diff_heat = cv2.applyColorMap(diff_boost, cv2.COLORMAP_INFERNO)

        tile_h = 260
        tile_w = max(90, int(round(tile_h * (cw / max(1, ch)))))
        r_tile = _fit_for_strip(ref_cmp, tile_w, tile_h)
        p_tile = _fit_for_strip(prev_cmp, tile_w, tile_h)
        d_tile = _fit_for_strip(diff_heat, tile_w, tile_h)
        if scene_id:
            scene_tiles_map.setdefault(str(scene_id), []).append(
                (ts, r_tile.copy(), p_tile.copy(), d_tile.copy(), ssim, edge_sim, combined)
            )

        row_img = np.hstack([r_tile, p_tile, d_tile])
        banner = np.full((28, row_img.shape[1], 3), (24, 24, 28), dtype=np.uint8)
        label = (
            f"t={ts:.2f}s | REF vs PREVIEW vs DIFF | "
            f"SSIM={ssim:.3f} Color={color_sim:.3f} Edge={edge_sim:.3f} [{verdict.upper()}]"
        )
        cv2.putText(
            banner,
            label,
            (8, 19),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (240, 240, 245),
            1,
            cv2.LINE_AA,
        )
        strip_rows.append(np.vstack([banner, row_img]))

    if video_cap is not None:
        video_cap.release()

    if not per_frame:
        return {"ok": False, "error": "Failed to load any valid reference/preview image pairs."}

    strip_saved = False
    if strip_rows:
        canvas = np.vstack(strip_rows)
        strip_saved = bool(cv2.imwrite(str(strip_out), canvas, [cv2.IMWRITE_JPEG_QUALITY, 86]))

    scene_beat_strips: Dict[str, str] = {}
    for sid, tile_items in scene_tiles_map.items():
        if not tile_items:
            continue
        tile_items.sort(key=lambda x: x[0])
        ref_row_tiles: List[np.ndarray] = []
        prev_row_tiles: List[np.ndarray] = []
        diff_row_tiles: List[np.ndarray] = []
        for ts_v, rt, pt, dt, ss_v, ed_v, cb_v in tile_items[:8]:
            r_lbl = rt.copy()
            p_lbl = pt.copy()
            d_lbl = dt.copy()
            cv2.rectangle(r_lbl, (0, 0), (140, 24), (14, 14, 18), -1)
            cv2.putText(r_lbl, f"REF {ts_v:.2f}s", (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.rectangle(p_lbl, (0, 0), (155, 24), (14, 14, 18), -1)
            cv2.putText(p_lbl, f"PREV {ts_v:.2f}s", (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 255, 180), 1, cv2.LINE_AA)
            cv2.rectangle(d_lbl, (0, 0), (r_lbl.shape[1], 24), (14, 14, 18), -1)
            cv2.putText(
                d_lbl,
                f"DIFF S={ss_v:.2f} E={ed_v:.2f} C={cb_v:.2f}",
                (6, 17),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.40,
                (255, 220, 140),
                1,
                cv2.LINE_AA,
            )
            ref_row_tiles.append(r_lbl)
            prev_row_tiles.append(p_lbl)
            diff_row_tiles.append(d_lbl)
        row_ref = np.hstack(ref_row_tiles)
        row_prev = np.hstack(prev_row_tiles)
        row_diff = np.hstack(diff_row_tiles)
        grid_6b = np.vstack([row_ref, row_prev, row_diff])
        m_num = re.search(r"(\d+)", sid)
        s_num = int(m_num.group(1)) if m_num else 1
        beat_out = strip_out.parent / f"scene_{s_num:02d}_compare_6beats.jpg"
        if cv2.imwrite(str(beat_out), grid_6b, [cv2.IMWRITE_JPEG_QUALITY, 88]):
            scene_beat_strips[sid] = str(beat_out)

    primary_beat_strip = next(iter(scene_beat_strips.values()), None) if len(scene_beat_strips) <= 2 else None

    ssim_mean = round(float(np.mean([f["ssim"] for f in per_frame])), 4)
    ssim_min = round(float(np.min([f["ssim"] for f in per_frame])), 4)
    color_mean = round(float(np.mean([f["colorSimilarity"] for f in per_frame])), 4)
    edge_mean = round(float(np.mean([f["edgeSimilarity"] for f in per_frame])), 4)
    overall = round(float(np.mean([f["combinedScore"] for f in per_frame])), 4)
    worst = sorted(per_frame, key=lambda f: f["combinedScore"])[:3]

    scene_buckets: Dict[str, List[Dict[str, Any]]] = {}
    for item in per_frame:
        sid = item.get("sceneId")
        if sid:
            scene_buckets.setdefault(str(sid), []).append(item)
    scene_scores: Dict[str, Dict[str, Any]] = {}
    for sid, items in scene_buckets.items():
        scene_scores[sid] = {
            "count": len(items),
            "ssimMean": round(float(np.mean([x["ssim"] for x in items])), 4),
            "ssimMin": round(float(np.min([x["ssim"] for x in items])), 4),
            "overallMean": round(float(np.mean([x["combinedScore"] for x in items])), 4),
            "overallMin": round(float(np.min([x["combinedScore"] for x in items])), 4),
        }

    prev_adj_delta = _mean_adjacent_frame_delta(prev_grays)
    ref_adj_delta = _mean_adjacent_frame_delta(ref_grays)
    motion_diag = _compute_motion_step_diagnostics(ref_grays, prev_grays)

    ssim_floor = round(threshold * 0.90, 4)
    passed = bool((overall >= threshold) and (ssim_mean >= ssim_floor) and (not any_ar_mismatch))

    return {
        "ok": True,
        "comparedCount": len(per_frame),
        "ssimMean": ssim_mean,
        "ssimMin": ssim_min,
        "colorMatchMean": color_mean,
        "edgeMatchMean": edge_mean,
        "overallFidelity": overall,
        "meanAdjacentFrameDelta": prev_adj_delta,
        "refMeanAdjacentFrameDelta": ref_adj_delta,
        "motionDiagnostics": motion_diag,
        "passThreshold": threshold,
        "ssimFloor": ssim_floor,
        "aspectRatioMismatch": bool(any_ar_mismatch),
        "passed": passed,
        "sceneScores": scene_scores,
        "comparisonStripPath": str(strip_out) if strip_saved else None,
        "sceneBeatStripPaths": scene_beat_strips,
        "primarySceneBeatStripPath": primary_beat_strip,
        "perFrame": per_frame,
        "worstFrames": worst,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: ref_compare.py <payload.json>"}))
        sys.exit(1)
    payload_path = Path(sys.argv[1])
    data = json.loads(payload_path.read_text(encoding="utf-8"))
    result = compare_pairs(data)
    print(json.dumps(result, indent=2))

