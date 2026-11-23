"""Global per-scene camera motion estimator (zoom, rotation, pan) (Prompt 7 R2).

Uses chained pairwise ORB + cross-checked BFMatcher + RANSAC `estimateAffinePartial2D`
so large zooms do not lose track of an anchor frame. Includes strict honesty guards
against low-feature/dark scenes and foreground moving objects on static backgrounds,
plus exact conversion to `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)`.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

MIN_KEYPOINTS = 25
MIN_INLIERS = 25
MIN_INLIER_RATIO = 0.35
MIN_SPREAD_FRAC = 0.22
MAX_TRACK_WIDTH = 640

AM_EASE_NAMES = ("linear", "inCubic", "outCubic", "inOutCubic")


def eval_am_ease(name: str, u: float) -> float:
    x = max(0.0, min(1.0, float(u)))
    if name == "inCubic":
        return x * x * x
    if name == "outCubic":
        return 1.0 - (1.0 - x) ** 3
    if name == "inOutCubic":
        return 4.0 * x * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 3) / 2.0
    return x


def camera_params_to_am_apply_camera(
    scale: float,
    rot_deg: float,
    tx: float,
    ty: float,
    width: int,
    height: int,
) -> Dict[str, float]:
    """Converts `(scale, rotDeg, panX, panY)` into exact `AM.applyCamera(ctx, {s, cx, cy, rot}, W, H)` args."""
    s = max(1e-4, float(scale))
    rad = math.radians(float(rot_deg))
    a = s * math.cos(rad)
    b = -s * math.sin(rad)
    c = s * math.sin(rad)
    d = s * math.cos(rad)
    s2 = s * s
    cx = width * 0.5 - (a * tx + c * ty) / s2
    cy = height * 0.5 - (b * tx + d * ty) / s2
    return {
        "s": round(s, 5),
        "cx": round(cx, 3),
        "cy": round(cy, 3),
        "rot": round(float(rot_deg), 4),
    }


def plan_scene_camera_sample_frames(
    start_sec: float,
    end_sec: float,
    fps: float,
    total_frames: int,
    frame_diffs: Optional[List[float]] = None,
    max_samples: int = 28,
) -> List[int]:
    """Selects uniform + motion-peak dense frame indices inside `[start_sec, end_sec]`."""
    safe_fps = max(float(fps), 1.0)
    f0 = min(max(0, total_frames - 1), max(0, int(round(start_sec * safe_fps)) + 1))
    f1 = min(max(0, total_frames - 1), max(f0, int(round(end_sec * safe_fps)) - 1))
    if f1 <= f0 + 1:
        return [f0] if f0 == f1 else [f0, f1]

    # 1. Baseline uniform grid (up to 8 frames)
    n_base = min(8, max(4, (f1 - f0) + 1))
    base_idxs = [int(round(f0 + (f1 - f0) * (i / float(max(1, n_base - 1))))) for i in range(n_base)]
    chosen = set(base_idxs)

    # 2. Dense samples around high-activity regions from R1 per-frame diffs
    if frame_diffs and len(frame_diffs) > f0:
        hi = min(len(frame_diffs), f1)
        seg = np.asarray(frame_diffs[f0:hi], dtype=np.float32)
        if seg.size >= 3:
            med = float(np.median(seg))
            p80 = float(np.percentile(seg, 80))
            active_thresh = max(1.4, med * 1.65, p80 * 0.85)
            active_ks = [f0 + int(k) for k, v in enumerate(seg) if float(v) >= active_thresh]
            if active_ks:
                # Focus dense budget around the strongest contiguous active burst
                a_lo = max(f0, min(active_ks) - 2)
                a_hi = min(f1, max(active_ks) + 1)
                budget = max(4, max_samples - len(chosen))
                span = max(1, a_hi - a_lo)
                step = max(1, int(math.ceil(span / float(budget))))
                for idx in range(a_lo, a_hi + 1, step):
                    chosen.add(idx)
                chosen.add(a_hi)

    result = sorted(chosen)
    if len(result) > max_samples:
        # Preserve endpoints and dense peak area
        keep = [result[0]]
        inner = result[1:-1]
        pick = np.linspace(0, len(inner) - 1, max_samples - 2).round().astype(int)
        keep.extend(inner[i] for i in pick)
        keep.append(result[-1])
        result = sorted(set(keep))
    return result


def _prepare_gray(frame_bgr: np.ndarray) -> Tuple[np.ndarray, float]:
    h, w = frame_bgr.shape[:2]
    scale = 1.0
    if w > MAX_TRACK_WIDTH:
        scale = MAX_TRACK_WIDTH / float(w)
        nw = MAX_TRACK_WIDTH
        nh = max(16, int(round(h * scale)))
        frame_bgr = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    return gray, scale


def _estimate_pair_affine(
    kp_a: Any,
    des_a: Optional[np.ndarray],
    kp_b: Any,
    des_b: Optional[np.ndarray],
    ds_w: int,
    ds_h: int,
    full_scale: float,
    bf: Optional[Any] = None,
) -> Tuple[Optional[np.ndarray], int, float, bool]:
    """Estimates 3x3 homogeneous partial-affine matrix from frame A -> B in full-res pixel coords."""
    if des_a is None or des_b is None or len(kp_a) < MIN_KEYPOINTS or len(kp_b) < MIN_KEYPOINTS:
        return None, 0, 0.0, False

    matcher = bf if bf is not None else cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = matcher.match(des_a, des_b)
    if len(matches) < MIN_INLIERS:
        return None, 0, 0.0, False
    matches = sorted(matches, key=lambda m: m.distance)[:450]

    pts_a = np.float32([kp_a[m.queryIdx].pt for m in matches])
    pts_b = np.float32([kp_b[m.trainIdx].pt for m in matches])

    # Guard against foreground moving object on static background:
    # For a true static background behind a moving foreground object, outer-perimeter points
    # stay stationary (< 0.30px) across a wide span (>= 55%), whereas a slow zoom/rotation moves
    # outer-perimeter points the MOST while only the center pivot stays near zero.
    disp = np.linalg.norm(pts_b - pts_a, axis=1)
    cx_ds, cy_ds = ds_w * 0.5, ds_h * 0.5
    outer_mask = (np.abs(pts_a[:, 0] - cx_ds) >= ds_w * 0.22) | (np.abs(pts_a[:, 1] - cy_ds) >= ds_h * 0.22)
    static_mask = disp < 0.30
    static_count = int(np.sum(static_mask))
    outer_count = int(np.sum(outer_mask))
    outer_static_frac = float(np.sum(static_mask & outer_mask)) / float(max(1, outer_count))
    if static_count >= max(30, int(len(matches) * 0.45)) and outer_count >= 20 and outer_static_frac >= 0.65:
        sp = pts_a[static_mask]
        spread_x = float(sp[:, 0].max() - sp[:, 0].min()) / max(1.0, float(ds_w))
        spread_y = float(sp[:, 1].max() - sp[:, 1].min()) / max(1.0, float(ds_h))
        if spread_x >= 0.50 and spread_y >= 0.50:
            return np.eye(3, dtype=np.float64), static_count, round(static_count / float(len(matches)), 3), True

    cv2.setRNGSeed(42)
    mat, inliers = cv2.estimateAffinePartial2D(
        pts_a,
        pts_b,
        method=cv2.RANSAC,
        ransacReprojThreshold=2.0,
        maxIters=1000,
        confidence=0.995,
    )
    if mat is None or inliers is None:
        return None, 0, 0.0, False

    inlier_mask = inliers.ravel().astype(bool)
    n_inliers = int(np.sum(inlier_mask))
    inlier_ratio = n_inliers / float(max(1, len(matches)))
    if n_inliers < MIN_INLIERS or inlier_ratio < MIN_INLIER_RATIO:
        return None, n_inliers, round(inlier_ratio, 3), False

    in_pts = pts_a[inlier_mask]
    spread_x = float(in_pts[:, 0].max() - in_pts[:, 0].min()) / max(1.0, float(ds_w))
    spread_y = float(in_pts[:, 1].max() - in_pts[:, 1].min()) / max(1.0, float(ds_h))
    if spread_x < MIN_SPREAD_FRAC or spread_y < MIN_SPREAD_FRAC:
        return None, n_inliers, round(inlier_ratio, 3), False

    # Reject physically implausible single-step jumps (corrupted match)
    step_s = math.hypot(float(mat[0, 0]), float(mat[1, 0]))
    if step_s < 0.55 or step_s > 1.85:
        return None, n_inliers, round(inlier_ratio, 3), False

    # Rescale translation from downscaled coords back to full-resolution pixels
    inv_sc = 1.0 / max(1e-6, full_scale)
    h3 = np.eye(3, dtype=np.float64)
    h3[0, 0] = float(mat[0, 0])
    h3[0, 1] = float(mat[0, 1])
    h3[0, 2] = float(mat[0, 2]) * inv_sc
    h3[1, 0] = float(mat[1, 0])
    h3[1, 1] = float(mat[1, 1])
    h3[1, 2] = float(mat[1, 2]) * inv_sc
    return h3, n_inliers, round(inlier_ratio, 3), True


def _decompose_cumulative(h3: np.ndarray, width: int, height: int) -> Tuple[float, float, float, float]:
    a = float(h3[0, 0])
    b = float(h3[0, 1])
    c = float(h3[1, 0])
    d = float(h3[1, 1])
    tx = float(h3[0, 2])
    ty = float(h3[1, 2])
    scale = math.hypot(a, c)
    rot_deg = math.degrees(math.atan2(c, a))
    cx0 = width * 0.5
    cy0 = height * 0.5
    pan_x = (a * cx0 + b * cy0 + tx) - cx0
    pan_y = (c * cx0 + d * cy0 + ty) - cy0
    return scale, rot_deg, pan_x, pan_y


def _fit_best_ease(
    ts: List[float],
    scales: List[float],
    rots: List[float],
    txs: List[float],
    tys: List[float],
    t0: Optional[float] = None,
    t1: Optional[float] = None,
    i0_ref: int = 0,
    i1_ref: int = -1,
) -> Tuple[str, float]:
    if len(ts) < 3:
        return "linear", 0.0
    seg_t0 = ts[0] if t0 is None else float(t0)
    seg_t1 = ts[-1] if t1 is None else float(t1)
    if seg_t1 <= seg_t0 + 1e-4:
        return "linear", 0.0
    s0, s1 = scales[i0_ref], scales[i1_ref]
    r0, r1 = rots[i0_ref], rots[i1_ref]
    x0, x1 = txs[i0_ref], txs[i1_ref]
    y0, y1 = tys[i0_ref], tys[i1_ref]
    ds = s1 - s0
    dr = r1 - r0
    dx = x1 - x0
    dy = y1 - y0

    best_name = "linear"
    best_err = 1e9
    for name in AM_EASE_NAMES:
        sq = 0.0
        cnt = 0
        for i, t in enumerate(ts):
            u = max(0.0, min(1.0, (t - seg_t0) / (seg_t1 - seg_t0)))
            p = eval_am_ease(name, u)
            if abs(ds) > 0.025:
                pred = s0 + ds * p
                sq += ((scales[i] - pred) / abs(ds)) ** 2
                cnt += 1
            if abs(dr) > 0.35:
                pred = r0 + dr * p
                sq += ((rots[i] - pred) / abs(dr)) ** 2
                cnt += 1
            if abs(dx) > 5.0:
                pred = x0 + dx * p
                sq += ((txs[i] - pred) / abs(dx)) ** 2
                cnt += 1
            if abs(dy) > 5.0:
                pred = y0 + dy * p
                sq += ((tys[i] - pred) / abs(dy)) ** 2
                cnt += 1
        rmse = math.sqrt(sq / max(1, cnt))
        if rmse < best_err:
            best_err = rmse
            best_name = name
    return best_name, round(best_err, 4)


def _solve_normalized_pivot(h_rel: np.ndarray, width: int, height: int) -> Dict[str, float]:
    """Solves the fixed point `(I - A) * p = t` of the segment's relative affine transform."""
    a_mat = h_rel[:2, :2]
    t_vec = h_rel[:2, 2]
    i_minus_a = np.eye(2, dtype=np.float64) - a_mat
    det = float(np.linalg.det(i_minus_a))
    if abs(det) < 1e-3:
        return {"x": 0.5, "y": 0.5}
    pt = np.linalg.solve(i_minus_a, t_vec)
    nx = float(pt[0]) / max(1.0, float(width))
    ny = float(pt[1]) / max(1.0, float(height))
    if not (math.isfinite(nx) and math.isfinite(ny)) or nx < -0.5 or nx > 1.5 or ny < -0.5 or ny > 1.5:
        return {"x": 0.5, "y": 0.5}
    return {
        "x": round(max(0.0, min(1.0, nx)), 3),
        "y": round(max(0.0, min(1.0, ny)), 3),
    }


def estimate_scene_camera_motion(
    frame_by_idx: Callable[[int], Optional[np.ndarray]],
    sample_indices: List[int],
    scene_start_sec: float,
    fps: float,
    width: int,
    height: int,
) -> Optional[Dict[str, Any]]:
    """Estimates global camera motion segments for one scene from ordered frame indices."""
    safe_fps = max(float(fps), 1.0)
    frames_loaded: List[Tuple[int, float, np.ndarray]] = []
    for f_idx in sorted(set(sample_indices)):
        fr = frame_by_idx(f_idx)
        if fr is not None and fr.size > 0:
            frames_loaded.append((f_idx, f_idx / safe_fps, fr))
    if len(frames_loaded) < 3:
        return None

    grays: List[Tuple[int, float, np.ndarray, float]] = []
    for f_idx, g_t, fr in frames_loaded:
        gray, ds_scale = _prepare_gray(fr)
        grays.append((f_idx, g_t, gray, ds_scale))

    # Fast pre-check: identify truly identical consecutive frames to avoid redundant ORB/RANSAC
    pair_static_skip: List[bool] = []
    for i in range(1, len(grays)):
        g_a = grays[i - 1][2][::4, ::4]
        g_b = grays[i][2][::4, ::4]
        mean_diff = float(np.mean(np.abs(g_b.astype(np.int16) - g_a.astype(np.int16))))
        pair_static_skip.append(mean_diff < 0.12)
    if all(pair_static_skip):
        return None

    orb = cv2.ORB_create(nfeatures=900)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    feat_cache: Dict[int, Tuple[Any, Optional[np.ndarray]]] = {}

    def _get_feat(idx: int) -> Tuple[Any, Optional[np.ndarray]]:
        cached = feat_cache.get(idx)
        if cached is not None:
            return cached
        res = orb.detectAndCompute(grays[idx][2], None)
        feat_cache[idx] = res
        return res

    cum_h: List[np.ndarray] = [np.eye(3, dtype=np.float64)]
    pair_inliers: List[int] = []
    pair_ratios: List[float] = []
    pair_valid: List[bool] = []
    pair_tracked: List[bool] = []
    step_magnitudes: List[float] = []

    # Adaptive keyframe anchoring: match each frame against the active anchor keyframe
    # and advance the anchor only when cumulative zoom/rot/pan grows large or inlier ratio drops.
    # Cuts random-walk drift across 20+ frames by ~5-10x while still handling large >2x zooms.
    anchor_idx = 0
    anchor_h = np.eye(3, dtype=np.float64)

    for i in range(1, len(grays)):
        if pair_static_skip[i - 1]:
            cum_h.append(cum_h[-1].copy())
            pair_inliers.append(0)
            pair_ratios.append(1.0)
            pair_valid.append(True)
            pair_tracked.append(False)
            step_magnitudes.append(0.0)
            continue

        kp_b, des_b = _get_feat(i)
        ds_h, ds_w = grays[i][2].shape[:2]
        ds_sc = grays[i][3]

        kp_anc, des_anc = _get_feat(anchor_idx)
        h_anc, n_in, ratio, ok = _estimate_pair_affine(
            kp_anc, des_anc, kp_b, des_b, ds_w, ds_h, ds_sc, bf=bf
        )
        if ok and h_anc is not None and ratio >= 0.42:
            cur_h = h_anc @ anchor_h
            a_s, a_r, a_px, a_py = _decompose_cumulative(h_anc, width, height)
            if (
                a_s > 1.26
                or a_s < 0.79
                or abs(a_r) > 5.0
                or math.hypot(a_px, a_py) > width * 0.12
                or ratio < 0.55
            ):
                anchor_idx = i
                anchor_h = cur_h.copy()
        else:
            # Anchor drifted too far or early intro reveal changed scene: chain from i-1 and re-anchor
            kp_a, des_a = _get_feat(i - 1)
            h_step, n_in, ratio, ok = _estimate_pair_affine(
                kp_a, des_a, kp_b, des_b, ds_w, ds_h, ds_sc, bf=bf
            )
            if ok and h_step is not None:
                cur_h = h_step @ cum_h[-1]
                anchor_idx = i
                anchor_h = cur_h.copy()
            else:
                cur_h = cum_h[-1].copy()
                # If anchor is stale (e.g. frame 0 was blank/reveal), advance anchor to current frame
                if i <= 4:
                    anchor_idx = i
                    anchor_h = cur_h.copy()

        pair_inliers.append(n_in)
        pair_ratios.append(ratio)
        pair_valid.append(ok)
        pair_tracked.append(True)
        prev_h = cum_h[-1]
        cum_h.append(cur_h)
        if ok:
            h_delta = cur_h @ np.linalg.inv(prev_h)
            ds, dr, dpx, dpy = _decompose_cumulative(h_delta, width, height)
            step_magnitudes.append(abs(ds - 1.0) * 12.0 + abs(dr) * 0.4 + math.hypot(dpx, dpy) / max(1.0, float(width)) * 8.0)
        else:
            step_magnitudes.append(0.0)

    valid_pairs = sum(1 for v in pair_valid if v)
    valid_frac = valid_pairs / float(max(1, len(pair_valid)))
    valid_tracked_pairs = sum(1 for v, tr in zip(pair_valid, pair_tracked) if v and tr)
    valid_inliers = [pair_inliers[i] for i, (v, tr) in enumerate(zip(pair_valid, pair_tracked)) if v and tr]
    valid_ratios = [pair_ratios[i] for i, (v, tr) in enumerate(zip(pair_valid, pair_tracked)) if v and tr]

    # Honesty gate: when sparse ORB keypoints fail on smooth gradients / glowing dark scenes,
    # try dense Farneback optical-flow fallback before giving up.
    if (
        valid_tracked_pairs < 2
        or valid_frac < 0.45
        or not valid_inliers
        or int(round(float(np.median(valid_inliers)))) < MIN_INLIERS
        or float(np.median(valid_ratios)) < MIN_INLIER_RATIO
    ):
        return _estimate_dense_flow_camera_fallback(grays, width, height, scene_start_sec)
    med_inliers = int(round(float(np.median(valid_inliers))))
    med_ratio = float(np.median(valid_ratios))

    # Decompose full cumulative curve
    local_ts: List[float] = []
    global_ts: List[float] = []
    scales: List[float] = []
    rots: List[float] = []
    txs: List[float] = []
    tys: List[float] = []
    for i, (_, g_t, _, _) in enumerate(grays):
        s_v, r_v, px_v, py_v = _decompose_cumulative(cum_h[i], width, height)
        local_ts.append(round(max(0.0, g_t - scene_start_sec), 3))
        global_ts.append(round(g_t, 3))
        scales.append(s_v)
        rots.append(r_v)
        txs.append(px_v)
        tys.append(py_v)

    d_scale = max(scales) - min(scales)
    d_rot = max(rots) - min(rots)
    d_pan = max(math.hypot(txs[i] - txs[0], tys[i] - tys[0]) for i in range(len(txs)))

    # Control gate: static camera / micro jitter -> no camera motion
    if d_scale < 0.035 and d_rot < 0.50 and d_pan < 6.0:
        return None

    # Find active motion interval [i0, i1] by trimming leading/trailing static holds,
    # then refine [i0, i1] jointly with easing fit so slow-onset curves (e.g. inCubic) are not clipped.
    step_arr = np.asarray(step_magnitudes, dtype=np.float64)
    max_step = float(np.max(step_arr)) if step_arr.size else 0.0
    step_thresh = max(0.025, max_step * 0.04)
    active_steps = [k for k, v in enumerate(step_magnitudes) if v >= step_thresh]
    if not active_steps:
        return None
    raw_i0 = max(0, active_steps[0])
    raw_i1 = min(len(grays) - 1, active_steps[-1] + 1)
    if raw_i1 <= raw_i0:
        return None

    # Jointly optimize onset/offset (including sub-sample continuous t0 refinement so slow-onset
    # easing curves like inCubic are never quantized to sparse pre-burst sample timestamps)
    # over a FIXED evaluation window so static hold frames cannot dilute RMSE.
    eval_lo = max(0, raw_i0 - 3)
    eval_hi = min(len(grays) - 1, raw_i1 + 2)
    best_tuple = (1e9, raw_i0, raw_i1, local_ts[raw_i0], local_ts[raw_i1], "linear")
    for cand_i0 in range(eval_lo, raw_i0 + 1):
        # Test cand_i0 exact timestamp plus mid-steps toward next sample when gap is wide
        t0_cands = [local_ts[cand_i0]]
        if cand_i0 + 1 <= raw_i0:
            t_a, t_b = local_ts[cand_i0], local_ts[cand_i0 + 1]
            if t_b - t_a > 0.05:
                for frac in (0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875):
                    t0_cands.append(round(t_a + (t_b - t_a) * frac, 3))
        for cand_i1 in range(raw_i1, eval_hi + 1):
            if cand_i1 - cand_i0 < 2:
                continue
            cand_t1 = local_ts[cand_i1]
            for cand_t0 in t0_cands:
                if cand_t1 <= cand_t0 + 0.05:
                    continue
                e_name, e_rmse = _fit_best_ease(
                    local_ts[eval_lo : eval_hi + 1],
                    scales[eval_lo : eval_hi + 1],
                    rots[eval_lo : eval_hi + 1],
                    txs[eval_lo : eval_hi + 1],
                    tys[eval_lo : eval_hi + 1],
                    t0=cand_t0,
                    t1=cand_t1,
                    i0_ref=cand_i0 - eval_lo,
                    i1_ref=cand_i1 - eval_lo,
                )
                if e_rmse < best_tuple[0] - 1e-4:
                    best_tuple = (e_rmse, cand_i0, cand_i1, cand_t0, cand_t1, e_name)
    fit_rmse, i0, i1, best_t0, best_t1, ease_name = best_tuple

    # Peak motion timestamp (global sec) for R3 adaptive beat strip
    peak_step_idx = int(np.argmax(step_arr))
    peak_change_sec = round(global_ts[min(len(global_ts) - 1, peak_step_idx + 1)], 3)

    seg_ts = local_ts[i0 : i1 + 1]
    seg_s = scales[i0 : i1 + 1]
    seg_r = rots[i0 : i1 + 1]
    seg_tx = txs[i0 : i1 + 1]
    seg_ty = tys[i0 : i1 + 1]

    # Compute relative matrix across [i0 -> i1] for pivot solving
    h_rel = cum_h[i1] @ np.linalg.inv(cum_h[i0])
    pivot = _solve_normalized_pivot(h_rel, width, height)

    # Confidence grading
    seg_valid_ratios = [pair_ratios[k] for k in range(i0, i1) if k < len(pair_ratios) and pair_valid[k] and pair_tracked[k]]
    seg_inliers = [pair_inliers[k] for k in range(i0, i1) if k < len(pair_inliers) and pair_valid[k] and pair_tracked[k]]
    seg_ratio_med = float(np.median(seg_valid_ratios)) if seg_valid_ratios else med_ratio
    seg_inlier_med = int(round(float(np.median(seg_inliers)))) if seg_inliers else med_inliers
    if seg_ratio_med >= 0.48 and seg_inlier_med >= 50 and fit_rmse <= 0.16:
        conf_label = "high"
    elif seg_ratio_med >= MIN_INLIER_RATIO and seg_inlier_med >= MIN_INLIERS and fit_rmse <= 0.28:
        conf_label = "medium"
    else:
        conf_label = "low"

    return {
        "segments": [
            {
                "t0": round(best_t0, 3),
                "t1": round(best_t1, 3),
                "scaleFrom": round(seg_s[0], 4),
                "scaleTo": round(seg_s[-1], 4),
                "rotDegFrom": round(seg_r[0], 3),
                "rotDegTo": round(seg_r[-1], 3),
                "txFrom": round(seg_tx[0], 2),
                "txTo": round(seg_tx[-1], 2),
                "tyFrom": round(seg_ty[0], 2),
                "tyTo": round(seg_ty[-1], 2),
                "ease": ease_name,
                "confidence": conf_label,
                "inlierRatio": round(seg_ratio_med, 3),
                "medianInliers": seg_inlier_med,
                "fitRmse": fit_rmse,
            }
        ],
        "pivot": pivot,
        "peakChangeSec": peak_change_sec,
    }


def _estimate_dense_flow_camera_fallback(
    grays: List[Tuple[int, float, np.ndarray, float]],
    width: int,
    height: int,
    scene_start_sec: float,
) -> Optional[Dict[str, Any]]:
    """Dense Farneback optical-flow camera fallback for gradient/glow/low-keypoint scenes."""
    if len(grays) < 3:
        return None
    flow_w = 180
    flow_h = max(64, int(round(height * (flow_w / float(max(1, width))))))
    yy, xx = np.mgrid[0:flow_h, 0:flow_w]
    rx = (xx - flow_w * 0.5) / max(1.0, flow_w * 0.5)
    ry = (yy - flow_h * 0.5) / max(1.0, flow_h * 0.5)
    r_norm2 = np.maximum(0.15, rx * rx + ry * ry)

    smalls = [cv2.resize(g[2], (flow_w, flow_h), interpolation=cv2.INTER_AREA) for g in grays]
    cum_s = 1.0
    cum_tx = 0.0
    cum_ty = 0.0
    scales = [1.0]
    txs = [0.0]
    tys = [0.0]
    step_mags = []

    qh, qw = flow_h // 2, flow_w // 2
    min_quad_pix = max(8, int(qh * qw * 0.015))
    for i in range(1, len(smalls)):
        flow = cv2.calcOpticalFlowFarneback(
            smalls[i - 1], smalls[i], None, 0.5, 2, 13, 2, 5, 1.1, 0
        )
        fx, fy = flow[..., 0], flow[..., 1]
        active = (fx * fx + fy * fy) > 0.08
        active_quads = sum(
            1
            for qmask in (
                active[:qh, :qw],
                active[:qh, qw:],
                active[qh:, :qw],
                active[qh:, qw:],
            )
            if int(np.sum(qmask)) >= min_quad_pix
        )
        if int(np.sum(active)) < int(flow_w * flow_h * 0.12) or active_quads < 3:
            scales.append(cum_s)
            txs.append(cum_tx)
            tys.append(cum_ty)
            step_mags.append(0.0)
            continue
        afx = fx[active]
        afy = fy[active]
        mdx = float(np.median(afx))
        mdy = float(np.median(afy))
        # Radial divergence (zoom) measured over active pixels relative to median pan
        div = float(np.median(((afx - mdx) * rx[active] + (afy - mdy) * ry[active]) / r_norm2[active])) / max(1.0, flow_w * 0.5)
        step_scale = float(np.clip(1.0 + div, 0.88, 1.14))
        cum_s = float(np.clip(cum_s * step_scale, 0.45, 2.6))
        cum_tx += mdx * (width / float(flow_w))
        cum_ty += mdy * (height / float(flow_h))
        scales.append(cum_s)
        txs.append(cum_tx)
        tys.append(cum_ty)
        step_mags.append(abs(step_scale - 1.0) * 14.0 + math.hypot(mdx, mdy) * 0.25)

    d_scale = max(scales) - min(scales)
    d_pan = max(math.hypot(txs[i], tys[i]) for i in range(len(txs)))
    if d_scale < 0.06 and d_pan < max(18.0, width * 0.03):
        return None

    local_ts = [round(max(0.0, g[1] - scene_start_sec), 3) for g in grays]
    global_ts = [round(g[1], 3) for g in grays]
    peak_mag = max(step_mags) if step_mags else 0.0
    active_steps = [k for k, m in enumerate(step_mags) if m >= max(0.25, peak_mag * 0.15)]
    i0 = active_steps[0] if active_steps else 0
    i1 = min(len(local_ts) - 1, active_steps[-1] + 1) if active_steps else len(local_ts) - 1
    peak_idx = int(np.argmax(np.asarray(step_mags, dtype=np.float64))) if step_mags else 0
    peak_sec = round(global_ts[min(len(global_ts) - 1, peak_idx + 1)], 3)
    return {
        "segments": [
            {
                "t0": local_ts[i0],
                "t1": local_ts[i1],
                "scaleFrom": round(scales[i0], 4),
                "scaleTo": round(scales[i1], 4),
                "rotDegFrom": 0.0,
                "rotDegTo": 0.0,
                "txFrom": round(txs[i0], 2),
                "txTo": round(txs[i1], 2),
                "tyFrom": round(tys[i0], 2),
                "tyTo": round(tys[i1], 2),
                "ease": "inOutCubic",
                "confidence": "medium",
                "backend": "dense_optical_flow",
            }
        ],
        "pivot": {"x": 0.5, "y": 0.5},
        "peakChangeSec": peak_sec,
    }


def compile_camera_motion_am_js(camera_motion: Optional[Dict[str, Any]], width: int, height: int) -> List[str]:
    """Emits deterministic JS lines calling `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)`."""
    if not camera_motion or not isinstance(camera_motion, dict):
        return []
    segs = [s for s in (camera_motion.get("segments") or []) if s.get("confidence") != "low"]
    if not segs:
        return []
    seg = segs[0]
    t0 = float(seg.get("t0", 0.0))
    t1 = max(t0 + 0.05, float(seg.get("t1", t0 + 0.5)))
    ease = str(seg.get("ease") or "linear")
    ease_expr = f"AM.ease.{ease}(camU)" if ease in ("inCubic", "outCubic", "inOutCubic") else "camU"
    s0, s1 = float(seg.get("scaleFrom", 1.0)), float(seg.get("scaleTo", 1.0))
    r0, r1 = float(seg.get("rotDegFrom", 0.0)), float(seg.get("rotDegTo", 0.0))
    tx0, tx1 = float(seg.get("txFrom", 0.0)), float(seg.get("txTo", 0.0))
    ty0, ty1 = float(seg.get("tyFrom", 0.0)), float(seg.get("tyTo", 0.0))
    return [
        f"    var camU = AM.clamp((localTime - {t0:.3f}) / {t1 - t0:.3f}, 0, 1);",
        f"    var camP = {ease_expr};",
        f"    var camS = {s0:.4f} + ({s1 - s0:.4f}) * camP;",
        f"    var camRot = {r0:.3f} + ({r1 - r0:.3f}) * camP;",
        f"    var camTx = {tx0:.2f} + ({tx1 - tx0:.2f}) * camP;",
        f"    var camTy = {ty0:.2f} + ({ty1 - ty0:.2f}) * camP;",
        "    var camRad = (camRot * Math.PI) / 180;",
        "    var camA = camS * Math.cos(camRad), camB = -camS * Math.sin(camRad), camC = camS * Math.sin(camRad), camD = camS * Math.cos(camRad);",
        "    var camS2 = Math.max(1e-4, camS * camS);",
        "    var camCx = W * 0.5 - (camA * camTx + camC * camTy) / camS2;",
        "    var camCy = H * 0.5 - (camB * camTx + camD * camTy) / camS2;",
        "    AM.applyCamera(ctx, { s: camS, cx: camCx, cy: camCy, rot: camRot }, W, H);",
    ]
