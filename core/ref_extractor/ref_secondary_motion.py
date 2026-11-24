#!/usr/bin/env python3
"""Native 30fps decorative / secondary motion extractor (Prompt 12 M2).

Tracks up to K non-text decorative elements per scene at native frame rate (30fps):
  1. Saturated accent blobs (e.g. corner stars, badges, orbital dots, icons):
     - Rotation (`rotate`) via circular cross-correlation of the centroid radial profile
       (works accurately on 3/4/5/6-fold symmetric stars where 2nd moments vanish).
     - Orbital/translational drift (`orbit`) via post-entrance centroid amplitude & period.
     - Breathing/scale pulse (`scale`) via sustained equivalent-radius range.
  2. Low-contrast sweeping arcs / ribbons (`sweep`) via 30fps Farneback flow masked outside
     saturated blobs and dense text lines.

Returns `secondaryMotion: [{kind, zone, colorHex, tStart, tEnd, ampPx|ampDegPerSec|scaleRange, periodSec?}]`.
Returns `[]` on static clips (zero false positives).
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

WORK_W = 180


def _zone_name(cx_norm: float, cy_norm: float) -> str:
    v = "top" if cy_norm < 0.34 else ("bottom" if cy_norm > 0.66 else "mid")
    h = "left" if cx_norm < 0.36 else ("right" if cx_norm > 0.64 else "center")
    if v == "mid" and h == "center":
        return "center"
    return f"{v}_{h}"


def _radial_profile(mask: np.ndarray, cx: float, cy: float, n_bins: int = 180) -> Tuple[np.ndarray, float]:
    """Computes normalized 0..360 deg max-radius profile around (cx, cy) and its relative anisotropy."""
    ys, xs = np.nonzero(mask)
    if ys.size < 16:
        return np.zeros(n_bins, dtype=np.float32), 0.0
    dx = xs.astype(np.float32) - float(cx)
    dy = ys.astype(np.float32) - float(cy)
    r = np.hypot(dx, dy)
    ang = (np.degrees(np.arctan2(dy, dx)) + 360.0) % 360.0
    bins = np.clip((ang * (n_bins / 360.0)).astype(np.int32), 0, n_bins - 1)
    prof = np.zeros(n_bins, dtype=np.float32)
    np.maximum.at(prof, bins, r)
    # Fill tiny empty angular bins via circular interpolation
    nz = np.nonzero(prof > 0)[0]
    if nz.size < max(12, n_bins // 6):
        return prof, 0.0
    if nz.size < n_bins:
        all_idx = np.arange(n_bins, dtype=np.float32)
        xp = np.concatenate([nz - n_bins, nz, nz + n_bins]).astype(np.float32)
        fp = np.concatenate([prof[nz], prof[nz], prof[nz]])
        prof = np.interp(all_idx, xp, fp).astype(np.float32)
    mean_r = float(np.mean(prof))
    if mean_r <= 2.0:
        return prof, 0.0
    aniso = float(np.std(prof) / mean_r)
    prof_norm = (prof - mean_r) / max(1e-4, float(np.std(prof)))
    return prof_norm, aniso


def _estimate_step_rotation_deg(
    prof_a: np.ndarray,
    prof_b: np.ndarray,
    max_shift_bins: int = 15,
) -> Tuple[float, float]:
    """Finds signed circular shift (in degrees) maximizing correlation between two radial profiles."""
    n_bins = len(prof_a)
    if n_bins < 36:
        return 0.0, 0.0
    deg_per_bin = 360.0 / float(n_bins)
    best_shift = 0
    best_corr = -1.0
    corrs: Dict[int, float] = {}
    for sh in range(-max_shift_bins, max_shift_bins + 1):
        c = float(np.dot(prof_a, np.roll(prof_b, -sh))) / float(n_bins)
        corrs[sh] = c
        if c > best_corr:
            best_corr = c
            best_shift = sh
    # Parabolic sub-bin refinement around peak
    sub = float(best_shift)
    if best_shift - 1 in corrs and best_shift + 1 in corrs:
        y0, y1, y2 = corrs[best_shift - 1], corrs[best_shift], corrs[best_shift + 1]
        denom = (y0 - 2.0 * y1 + y2)
        if abs(denom) > 1e-6:
            delta = 0.5 * (y0 - y2) / denom
            if abs(delta) <= 0.6:
                sub += delta
    return sub * deg_per_bin, best_corr


def _extract_accent_blobs(
    small_bgr: np.ndarray,
    bg_hsv: np.ndarray,
    full_w: int,
    full_h: int,
) -> List[Dict[str, Any]]:
    mh, mw = small_bgr.shape[:2]
    hsv = cv2.cvtColor(small_bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.int16)
    val = hsv[:, :, 2].astype(np.int16)
    sat_mask = ((sat >= 52) & (np.abs(sat - int(bg_hsv[1])) >= 36) & (val >= 28)).astype(np.uint8) * 255
    k3 = np.ones((3, 3), np.uint8)
    sat_mask = cv2.morphologyEx(sat_mask, cv2.MORPH_CLOSE, k3)
    sat_mask = cv2.morphologyEx(sat_mask, cv2.MORPH_OPEN, k3)

    num_lbl, labels, stats, _ = cv2.connectedComponentsWithStats(sat_mask, connectivity=8)
    total_area = max(1, mw * mh)
    min_area = max(24, int(total_area * 0.0018))
    max_area = int(total_area * 0.42)
    sx = float(full_w) / float(mw)
    sy = float(full_h) / float(mh)

    blobs: List[Dict[str, Any]] = []
    for lbl in range(1, num_lbl):
        area = int(stats[lbl, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        bx = int(stats[lbl, cv2.CC_STAT_LEFT])
        by = int(stats[lbl, cv2.CC_STAT_TOP])
        bw = int(stats[lbl, cv2.CC_STAT_WIDTH])
        bh = int(stats[lbl, cv2.CC_STAT_HEIGHT])
        if bw < 6 or bh < 6:
            continue
        sub_mask = (labels[by:by + bh, bx:bx + bw] == lbl)
        ys, xs = np.nonzero(sub_mask)
        if ys.size < 16:
            continue
        lcx = float(np.mean(xs))
        lcy = float(np.mean(ys))
        cx = (bx + lcx) * sx
        cy = (by + lcy) * sy
        prof, aniso = _radial_profile(sub_mask, lcx, lcy)
        pix = small_bgr[by:by + bh, bx:bx + bw][sub_mask]
        med = np.median(pix, axis=0)
        hex_col = f"#{int(med[2]):02X}{int(med[1]):02X}{int(med[0]):02X}"
        r_eq = math.sqrt(float(area) * sx * sy / math.pi)
        blobs.append({
            "cx": cx,
            "cy": cy,
            "rEq": r_eq,
            "area": area,
            "box": (bx, by, bw, bh),
            "hex": hex_col,
            "prof": prof,
            "aniso": aniso,
        })
    blobs.sort(key=lambda b: b["area"], reverse=True)
    return blobs[:6]


def _estimate_period_sec(values: np.ndarray, dt: float) -> Optional[float]:
    if values.size < 10:
        return None
    sig = values - float(np.mean(values))
    if float(np.std(sig)) < 1e-3:
        return None
    # Zero-crossings with mild smoothing to reject 1-frame noise
    k = min(5, max(3, (values.size // 8) | 1))
    kernel = np.ones(k, dtype=np.float64) / float(k)
    smooth = np.convolve(sig, kernel, mode="valid")
    signs = np.sign(smooth)
    crossings = [i for i in range(1, len(signs)) if signs[i] * signs[i - 1] < 0]
    if len(crossings) >= 2:
        avg_half = float(np.mean(np.diff(crossings)))
        per = avg_half * 2.0 * dt
        if 0.25 <= per <= 12.0:
            return round(per, 2)
    return None


def extract_scene_secondary_motion(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    start: float,
    end: float,
    width: int,
    height: int,
    fps: float = 30.0,
    max_items: int = 4,
) -> List[Dict[str, Any]]:
    """Tracks non-text decorative elements & sweeping low-contrast arcs at native 30fps."""
    dur = max(0.05, float(end) - float(start))
    safe_fps = max(10.0, float(fps))
    dt = 1.0 / safe_fps
    n_frames = min(150, max(2, int(round(dur * safe_fps))))
    ts_list = [float(start) + i * dt for i in range(n_frames) if float(start) + i * dt <= float(end) - 0.01]
    if len(ts_list) < 8:
        return []

    mw = WORK_W
    mh = max(64, int(round(float(height) * (float(mw) / float(max(1, width))))))
    sx = float(width) / float(mw)
    sy = float(height) / float(mh)
    diag = math.hypot(float(width), float(height))
    max_step = diag * 0.14

    tracks: List[Dict[str, Any]] = []
    finished: List[Dict[str, Any]] = []
    prev_gray: Optional[np.ndarray] = None
    sweep_frames: List[Tuple[float, float, float, float, float, float]] = []

    for fi, ts in enumerate(ts_list):
        fr = frame_at_fn(ts)
        if fr is None or fr.size == 0:
            continue
        small = cv2.resize(fr, (mw, mh), interpolation=cv2.INTER_AREA)
        b = max(3, min(6, mw // 24, mh // 24))
        border = np.concatenate(
            [
                small[:b, :, :].reshape(-1, 3),
                small[-b:, :, :].reshape(-1, 3),
                small[:, :b, :].reshape(-1, 3),
                small[:, -b:, :].reshape(-1, 3),
            ],
            axis=0,
        )
        bg_bgr = np.median(border, axis=0).astype(np.uint8)
        bg_hsv = cv2.cvtColor(np.uint8([[bg_bgr]]), cv2.COLOR_BGR2HSV)[0, 0]
        bg_gray_val = float(cv2.cvtColor(np.uint8([[bg_bgr]]), cv2.COLOR_BGR2GRAY)[0, 0])

        blobs = _extract_accent_blobs(small, bg_hsv, width, height)
        local_t = round(max(0.0, ts - float(start)), 3)

        # Match blobs to active tracks
        used_t: set[int] = set()
        used_b: set[int] = set()
        pairs: List[Tuple[float, int, int]] = []
        for ti, tr in enumerate(tracks):
            last = tr["obs"][-1]
            if fi - last["fi"] > 3:
                continue
            for bi, bl in enumerate(blobs):
                d = math.hypot(bl["cx"] - last["cx"], bl["cy"] - last["cy"])
                if d <= max_step:
                    pairs.append((d, ti, bi))
        pairs.sort(key=lambda x: x[0])
        for _, ti, bi in pairs:
            if ti in used_t or bi in used_b:
                continue
            used_t.add(ti)
            used_b.add(bi)
            bl = blobs[bi]
            tracks[ti]["obs"].append({"fi": fi, "lt": local_t, **bl})

        next_tracks: List[Dict[str, Any]] = []
        for ti, tr in enumerate(tracks):
            if ti in used_t or (fi - tr["obs"][-1]["fi"]) <= 2:
                next_tracks.append(tr)
            else:
                finished.append(tr)
        for bi, bl in enumerate(blobs):
            if bi not in used_b:
                next_tracks.append({"obs": [{"fi": fi, "lt": local_t, **bl}]})
        tracks = next_tracks

        # Low-contrast sweeping arcs / ribbons outside saturated accent blobs
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        if prev_gray is not None:
            fl = cv2.calcOpticalFlowFarneback(prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.1, 0)
            fx, fy = fl[..., 0], fl[..., 1]
            mag = np.hypot(fx, fy)
            hsv_cur = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            low_sat = hsv_cur[:, :, 1] < 48
            mod_contrast = (np.abs(gray.astype(np.float32) - bg_gray_val) >= 7.0) & (
                np.abs(gray.astype(np.float32) - bg_gray_val) <= 92.0
            )
            non_blob = np.ones((mh, mw), dtype=bool)
            for bl in blobs:
                bx, by, bw, bh = bl["box"]
                non_blob[max(0, by - 4):min(mh, by + bh + 4), max(0, bx - 4):min(mw, bx + bw + 4)] = False
            sweep_mask = (mag > 0.65) & low_sat & mod_contrast & non_blob
            scnt = int(np.count_nonzero(sweep_mask))
            sfrac = float(scnt) / float(mw * mh)
            if scnt >= 28 and sfrac >= 0.004:
                ys_s, xs_s = np.nonzero(sweep_mask)
                span_x = float(xs_s.max() - xs_s.min()) / float(mw)
                span_y = float(ys_s.max() - ys_s.min()) / float(mh)
                if max(span_x, span_y) >= 0.22:
                    mdx = float(np.median(fx[sweep_mask])) * sx
                    mdy = float(np.median(fy[sweep_mask])) * sy
                    spd = float(np.percentile(mag[sweep_mask], 80)) * ((sx + sy) * 0.5)
                    sweep_frames.append((
                        local_t,
                        spd,
                        mdx,
                        mdy,
                        float(np.mean(xs_s)) / float(mw),
                        float(np.mean(ys_s)) / float(mh),
                    ))
        prev_gray = gray

    all_tracks = finished + tracks
    results: List[Tuple[float, Dict[str, Any]]] = []

    for tr in all_tracks:
        obs = tr["obs"]
        if len(obs) < 10:
            continue
        # Skip first 15% (at most 5 frames) if track is long so entrance pops don't mask sustained motion
        trim = min(5, len(obs) // 6) if len(obs) >= 18 else 0
        sub = obs[trim:]
        if len(sub) < 8:
            sub = obs

        cxs = np.array([o["cx"] for o in sub], dtype=np.float64)
        cys = np.array([o["cy"] for o in sub], dtype=np.float64)
        rs = np.array([o["rEq"] for o in sub], dtype=np.float64)
        zone = _zone_name(float(np.median(cxs)) / float(max(1, width)), float(np.median(cys)) / float(max(1, height)))
        hex_col = sub[len(sub) // 2]["hex"]
        t0 = sub[0]["lt"]
        t1 = sub[-1]["lt"]
        span_sec = max(dt, t1 - t0)

        # 1. Rotation via radial-profile circular shift (2-frame stride for crisp sub-degree precision)
        aniso_med = float(np.median([o["aniso"] for o in sub]))
        rot_rates: List[float] = []
        if aniso_med >= 0.045:
            stride = 2 if len(sub) >= 12 else 1
            for k in range(len(sub) - stride):
                a, b_obs = sub[k], sub[k + stride]
                step_f = b_obs["fi"] - a["fi"]
                if step_f <= 0 or step_f > 4:
                    continue
                d_deg, corr = _estimate_step_rotation_deg(a["prof"], b_obs["prof"])
                if corr >= 0.72:
                    rot_rates.append(d_deg / (step_f * dt))

        if len(rot_rates) >= 5:
            med_dps = float(np.median(rot_rates))
            same_sign = sum(1 for v in rot_rates if v * med_dps > 0 and abs(v) >= 12.0)
            if abs(med_dps) >= 18.0 and same_sign >= max(4, int(len(rot_rates) * 0.55)):
                period = round(360.0 / abs(med_dps), 2)
                results.append((
                    abs(med_dps) * 1.4,
                    {
                        "kind": "rotate",
                        "zone": zone,
                        "colorHex": hex_col,
                        "ampDegPerSec": round(med_dps, 1),
                        "periodSec": period,
                        "tStart": round(t0, 2),
                        "tEnd": round(t1, 2),
                    },
                ))

        # 2. Orbit / translational drift
        amp_x = float(np.ptp(cxs)) * 0.5
        amp_y = float(np.ptp(cys)) * 0.5
        amp_px = math.hypot(amp_x, amp_y)
        step_dists = np.hypot(np.diff(cxs), np.diff(cys))
        active_move_frac = float(np.mean(step_dists >= 0.75)) if step_dists.size else 0.0
        if amp_px >= 14.0 and active_move_frac >= 0.35:
            per = _estimate_period_sec(cxs if amp_x >= amp_y else cys, dt)
            entry: Dict[str, Any] = {
                "kind": "orbit",
                "zone": zone,
                "colorHex": hex_col,
                "ampPx": round(amp_px, 1),
                "tStart": round(t0, 2),
                "tEnd": round(t1, 2),
            }
            if per is not None:
                entry["periodSec"] = per
            results.append((amp_px * 1.1, entry))

        # 3. Sustained scale pulse
        r_med = float(np.median(rs))
        if r_med >= 12.0:
            r_min = float(np.percentile(rs, 10))
            r_max = float(np.percentile(rs, 90))
            s_ratio = r_max / max(1.0, r_min)
            if s_ratio >= 1.16:
                per_s = _estimate_period_sec(rs, dt)
                s_entry: Dict[str, Any] = {
                    "kind": "scale",
                    "zone": zone,
                    "colorHex": hex_col,
                    "scaleRange": [round(r_min / r_med, 2), round(r_max / r_med, 2)],
                    "tStart": round(t0, 2),
                    "tEnd": round(t1, 2),
                }
                if per_s is not None:
                    s_entry["periodSec"] = per_s
                results.append(((s_ratio - 1.0) * 120.0, s_entry))

    # 4. Low-contrast sweeping arcs / ribbons
    if len(sweep_frames) >= 8:
        spds = np.array([f[1] for f in sweep_frames], dtype=np.float64)
        tot_disp = float(np.sum(spds))
        med_spd = float(np.median(spds))
        if tot_disp >= 35.0 and med_spd >= 2.0:
            sw_t0 = sweep_frames[0][0]
            sw_t1 = sweep_frames[-1][0]
            sw_zone = _zone_name(
                float(np.median([f[4] for f in sweep_frames])),
                float(np.median([f[5] for f in sweep_frames])),
            )
            sw_entry: Dict[str, Any] = {
                "kind": "sweep",
                "zone": sw_zone,
                "ampPx": round(tot_disp, 1),
                "speedPxPerSec": round(med_spd * safe_fps, 1),
                "tStart": round(sw_t0, 2),
                "tEnd": round(sw_t1, 2),
            }
            # Estimate sweep cycle period if velocity oscillates
            dx_series = np.array([f[2] for f in sweep_frames], dtype=np.float64)
            dy_series = np.array([f[3] for f in sweep_frames], dtype=np.float64)
            per_sw = _estimate_period_sec(
                dx_series if float(np.std(dx_series)) >= float(np.std(dy_series)) else dy_series,
                dt,
            )
            if per_sw is not None:
                sw_entry["periodSec"] = per_sw
            results.append((tot_disp * 0.9, sw_entry))

    results.sort(key=lambda item: item[0], reverse=True)
    # Deduplicate by (kind, zone)
    deduped: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()
    for _, item in results:
        key = (str(item["kind"]), str(item["zone"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= max_items:
            break
    return deduped
