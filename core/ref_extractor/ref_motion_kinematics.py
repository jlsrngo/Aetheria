#!/usr/bin/env python3
"""Optical-flow kinematics extractor (zoom/pan bursts, hold liveness & rotational ring hints)."""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _sample_kinematic_timestamps(start: float, end: float, step_sec: float = 0.16) -> List[float]:
    dur = max(0.08, float(end) - float(start))
    lo = float(start) + min(0.02, dur * 0.08)
    hi = max(lo, float(end) - min(0.02, dur * 0.08))
    n = max(3, min(26, int(math.ceil(max(0.05, hi - lo) / max(0.08, step_sec))) + 1))
    return [round(lo + (hi - lo) * (i / float(n - 1)), 3) for i in range(n)]


def _classify_burst_kind(
    dx_total: float, dy_total: float, scale_ratio: float, max_div: float, max_curl: float
) -> str:
    if scale_ratio >= 1.24 or max_div >= 0.014:
        return "zoom_in"
    if scale_ratio <= 0.80 or max_div <= -0.014:
        return "zoom_out"
    if abs(dy_total) >= max(24.0, abs(dx_total) * 1.35):
        return "pan_up" if dy_total < 0 else "pan_down"
    if abs(dx_total) >= max(24.0, abs(dy_total) * 1.35):
        return "pan_left" if dx_total < 0 else "pan_right"
    if abs(max_curl) >= 0.18:
        return "spin_or_morph"
    return "pop_or_glide"


def extract_scene_motion_kinematics(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    start: float,
    end: float,
    width: int,
    height: int,
    step_sec: float = 0.16,
) -> Dict[str, Any]:
    """Extracts zoom/pan/spin motion bursts and living-hold activity metrics for a single scene."""
    timestamps = _sample_kinematic_timestamps(start, end, step_sec=step_sec)
    work_w = min(180, max(64, int(width)))
    work_h = max(48, int(round(float(height) * (work_w / float(max(1, width))))))
    sx = float(width) / float(work_w)
    sy = float(height) / float(work_h)

    samples: List[Tuple[float, np.ndarray, Optional[Tuple[int, int, int, int]]]] = []
    for ts in timestamps:
        fr = frame_at_fn(ts)
        if fr is None:
            continue
        small = cv2.resize(fr, (work_w, work_h), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        b = max(2, min(6, work_w // 24, work_h // 24))
        border = np.concatenate(
            [small[:b, :].reshape(-1, 3), small[-b:, :].reshape(-1, 3), small[:, :b].reshape(-1, 3), small[:, -b:].reshape(-1, 3)],
            axis=0,
        )
        bg = np.median(border, axis=0).astype(np.int16)
        fg_mask = np.max(np.abs(small.astype(np.int16) - bg), axis=2) > 26
        ys, xs = np.where(fg_mask)
        box = None
        if ys.size >= 20:
            x0, x1 = int(xs.min()), int(xs.max()) + 1
            y0, y1 = int(ys.min()), int(ys.max()) + 1
            box = (x0, y0, max(1, x1 - x0), max(1, y1 - y0))
        samples.append((ts, gray, box))

    if len(samples) < 2:
        return {}

    yy, xx = np.mgrid[0:work_h, 0:work_w]
    steps: List[Dict[str, Any]] = []
    for i in range(1, len(samples)):
        t_a, g_a, box_a = samples[i - 1]
        t_b, g_b, box_b = samples[i]
        fl = cv2.calcOpticalFlowFarneback(g_a, g_b, None, 0.5, 2, 13, 2, 5, 1.1, 0)
        fx, fy = fl[..., 0], fl[..., 1]
        mag = np.hypot(fx, fy)
        active = mag > 0.45
        act_count = int(np.count_nonzero(active))
        diff_abs = np.abs(g_b.astype(np.float32) - g_a.astype(np.float32))
        diff_mask = active | (diff_abs > 10.0)
        fg_diff = float(np.mean(diff_abs[diff_mask])) if np.any(diff_mask) else float(np.mean(diff_abs))

        if act_count >= max(30, int(work_w * work_h * 0.004)):
            p75_px = float(np.percentile(mag[active], 75)) * ((sx + sy) * 0.5)
            dx_px = float(np.median(fx[active])) * sx
            dy_px = float(np.median(fy[active])) * sy
            acx = float(np.mean(xx[active]))
            acy = float(np.mean(yy[active]))
            rx = (xx[active] - acx) / max(1.0, work_w * 0.25)
            ry = (yy[active] - acy) / max(1.0, work_h * 0.25)
            r2 = np.maximum(0.15, rx * rx + ry * ry)
            r_norm = np.sqrt(r2)
            afx = fx[active] - float(np.median(fx[active]))
            afy = fy[active] - float(np.median(fy[active]))
            div = float(np.median((afx * rx + afy * ry) / r2)) / max(1.0, work_w * 0.25)
            curl = float(np.median((rx * afy - ry * afx) / r_norm)) / max(1.0, work_w * 0.25)
        else:
            p75_px, dx_px, dy_px, div, curl = 0.0, 0.0, 0.0, 0.0, 0.0

        area_ratio = 1.0
        if box_a is not None and box_b is not None:
            area_a = float(box_a[2] * box_a[3])
            area_b = float(box_b[2] * box_b[3])
            if min(area_a, area_b) >= 48.0:
                area_ratio = area_b / area_a

        is_burst = (
            p75_px >= 6.0
            or abs(div) >= 0.012
            or abs(dx_px) >= 10.0
            or abs(dy_px) >= 10.0
            or area_ratio >= 1.18
            or area_ratio <= 0.84
        )
        is_active_hold = act_count >= max(24, int(work_w * work_h * 0.004)) or fg_diff >= 2.6
        steps.append(
            {
                "lt0": round(max(0.0, t_a - start), 2),
                "lt1": round(max(0.0, t_b - start), 2),
                "p75": p75_px,
                "dx": dx_px,
                "dy": dy_px,
                "div": div,
                "curl": curl,
                "areaRatio": area_ratio,
                "fgDiff": fg_diff,
                "isBurst": is_burst,
                "isActive": is_active_hold,
            }
        )

    bursts: List[List[Dict[str, Any]]] = []
    cur: Optional[List[Dict[str, Any]]] = None
    for st in steps:
        if st["isBurst"]:
            if cur is None:
                cur = [st]
            else:
                cur.append(st)
        elif cur is not None:
            bursts.append(cur)
            cur = None
    if cur is not None:
        bursts.append(cur)

    formatted_bursts: List[Dict[str, Any]] = []
    for grp in bursts:
        dx_tot = sum(s["dx"] for s in grp)
        dy_tot = sum(s["dy"] for s in grp)
        scale_tot = 1.0
        for s in grp:
            scale_tot *= float(np.clip(s["areaRatio"], 0.6, 1.8))
        max_div = max((s["div"] for s in grp), key=abs)
        max_curl = max((s["curl"] for s in grp), key=abs)
        peak_px = max(s["p75"] for s in grp)
        kind = _classify_burst_kind(dx_tot, dy_tot, scale_tot, max_div, max_curl)
        if peak_px < 4.0 and abs(dx_tot) < 12.0 and abs(dy_tot) < 12.0 and abs(scale_tot - 1.0) < 0.12:
            continue
        formatted_bursts.append(
            {
                "t0": grp[0]["lt0"],
                "t1": grp[-1]["lt1"],
                "kind": kind,
                "dxPx": int(round(dx_tot)),
                "dyPx": int(round(dy_tot)),
                "scaleRatio": round(float(scale_tot), 2),
                "peakPxPerStep": round(float(peak_px), 1),
            }
        )
    formatted_bursts.sort(key=lambda b: b["peakPxPerStep"], reverse=True)
    formatted_bursts = sorted(formatted_bursts[:4], key=lambda b: b["t0"])

    hold_steps = [s for s in steps if not s["isBurst"]]
    active_pct = round(100.0 * sum(1 for s in steps if s["isActive"]) / float(len(steps)), 1)

    # Discriminative lag-long (~0.48s ≈ lag-15 at 30fps) vs lag-1 foreground liveness:
    # Compression noise stays flat across lag-1 and lag-long, while true slow drift/rotation grows with lag.
    lag_k = max(2, min(len(samples) - 1, int(round(0.48 / max(0.08, step_sec)))))
    hold_step_indices = [idx_s for idx_s, s in enumerate(steps) if not s["isBurst"]]
    lag1_shares: List[float] = []
    lag_long_shares: List[float] = []
    fg_centroids: List[Tuple[float, float]] = []
    living_regions: List[Dict[str, Any]] = []

    region_defs = [
        ("center", int(work_w * 0.22), int(work_h * 0.22), int(work_w * 0.78), int(work_h * 0.78)),
        ("top", 0, 0, work_w, int(work_h * 0.30)),
        ("bottom", 0, int(work_h * 0.70), work_w, work_h),
    ]
    region_long_shares: Dict[str, List[float]] = {r[0]: [] for r in region_defs}
    region_lag1_shares: Dict[str, List[float]] = {r[0]: [] for r in region_defs}

    eval_indices = hold_step_indices if len(hold_step_indices) >= 2 else list(range(len(steps)))
    # Use the longest contiguous hold run for centroid amplitude so multi-phase scenes
    # do not inflate hold ampPx by jumping between Phase 1 and Phase 2 centroids.
    longest_run: List[int] = []
    cur_run: List[int] = []
    for st_i in eval_indices:
        if not cur_run or st_i == cur_run[-1] + 1:
            cur_run.append(st_i)
        else:
            if len(cur_run) > len(longest_run):
                longest_run = cur_run
            cur_run = [st_i]
    if len(cur_run) > len(longest_run):
        longest_run = cur_run
    centroid_indices = set(longest_run if len(longest_run) >= 3 else eval_indices)

    for st_i in eval_indices:
        cur_sample_i = st_i + 1
        prev_sample_i = st_i
        g_cur = samples[cur_sample_i][1].astype(np.int16)
        g_prev = samples[prev_sample_i][1].astype(np.int16)
        l1 = float((np.abs(g_cur - g_prev) > 10).mean())
        lag1_shares.append(l1)
        if cur_sample_i >= lag_k:
            g_old = samples[cur_sample_i - lag_k][1].astype(np.int16)
            ll = float((np.abs(g_cur - g_old) > 10).mean())
            lag_long_shares.append(ll)
            for rname, rx0, ry0, rx1, ry1 in region_defs:
                rl1 = float((np.abs(g_cur[ry0:ry1, rx0:rx1] - g_prev[ry0:ry1, rx0:rx1]) > 10).mean())
                rll = float((np.abs(g_cur[ry0:ry1, rx0:rx1] - g_old[ry0:ry1, rx0:rx1]) > 10).mean())
                region_lag1_shares[rname].append(rl1)
                region_long_shares[rname].append(rll)
        if st_i in centroid_indices:
            bx = samples[cur_sample_i][2]
            if bx is not None:
                fg_centroids.append(((bx[0] + bx[2] * 0.5) * sx, (bx[1] + bx[3] * 0.5) * sy))

    mean_lag1 = float(np.mean(lag1_shares)) if lag1_shares else 0.0
    mean_lag_long = float(np.mean(lag_long_shares)) if lag_long_shares else 0.0
    lag_growth = mean_lag_long / max(1e-4, mean_lag1) if lag_long_shares else 0.0

    amp_px = 0.0
    period_sec: Optional[float] = None
    if len(fg_centroids) >= 2:
        cxs = np.array([c[0] for c in fg_centroids], dtype=np.float64)
        cys = np.array([c[1] for c in fg_centroids], dtype=np.float64)
        amp_x = float(np.ptp(cxs)) * 0.5
        amp_y = float(np.ptp(cys)) * 0.5
        amp_px = round(max(amp_x, amp_y), 1)
        if len(fg_centroids) >= 3:
            sig = cys - float(np.mean(cys)) if amp_y >= amp_x else cxs - float(np.mean(cxs))
            if float(np.max(np.abs(sig))) >= 2.0:
                signs = np.sign(sig)
                crossings = [k for k in range(1, len(signs)) if signs[k] * signs[k - 1] < 0]
                if len(crossings) >= 2:
                    avg_half_steps = float(np.mean(np.diff(crossings)))
                    period_sec = round(max(0.4, avg_half_steps * 2.0 * step_sec), 2)

    if hold_steps:
        hold_active_pct = round(
            100.0 * sum(1 for s in hold_steps if s["isActive"]) / float(len(hold_steps)), 1
        )
        hold_fg_diff = round(float(np.mean([s["fgDiff"] for s in hold_steps])), 2)
    else:
        hold_active_pct = active_pct
        hold_fg_diff = round(float(np.mean([s["fgDiff"] for s in steps])), 2)

    max_hold_curl = max(
        (abs(s["curl"]) for s in (hold_steps if len(hold_steps) > 1 else steps)),
        default=0.0,
    )

    # Derive compression-noise floor directly from this video's quietest lag-1 baseline:
    # compression noise stays tiny (<1.5%) and flat with ~0 centroid displacement,
    # whereas genuine hover/drift grows from lag-1 to lag-long and continuous fast secondary
    # motion (stars/arcs) keeps lag-1 and lag-long both high (>=4.5%) across the hold.
    quiet_lag1 = float(np.percentile(lag1_shares, 25)) if lag1_shares else 0.0
    amp_floor_px = 2.5
    noise_share_floor = max(0.018, quiet_lag1 * 1.45)
    # Check settled tail (last 40% of lag-long samples) so entrance-only scenes (e.g. bar charts
    # that grow early and then lock completely static) do not falsely report hasLivingHold=True.
    tail_split = max(0, int(len(lag_long_shares) * 0.60))
    tail_lag_long = float(np.median(lag_long_shares[tail_split:])) if lag_long_shares else 0.0
    settled_is_quiet = (len(lag_long_shares) >= 4) and (tail_lag_long < 0.016) and (max_hold_curl < 0.025)

    for rname, _, _, _, _ in region_defs:
        r_longs = region_long_shares[rname]
        r_l1s = region_lag1_shares[rname]
        if not r_longs:
            continue
        rm_long = float(np.mean(r_longs))
        rm_l1 = float(np.mean(r_l1s))
        r_tail_long = float(np.median(r_longs[max(0, int(len(r_longs) * 0.60)):])) if len(r_longs) >= 4 else rm_long
        if settled_is_quiet and r_tail_long < 0.020:
            continue
        reg_amp = amp_px if rname == "center" else (round(amp_px * 0.6, 1) if amp_px >= amp_floor_px else 0.0)
        has_real_amp = reg_amp >= amp_floor_px
        has_rotational_hold = (rm_long >= max(0.055, rm_l1 * 1.40)) and (max_hold_curl >= 0.025)
        grows_or_continuous = (rm_long >= rm_l1 * 1.25) or (rm_l1 >= 0.045 and rm_long >= 0.055)
        if rm_long >= noise_share_floor and grows_or_continuous and (has_real_amp or has_rotational_hold):
            reg_entry: Dict[str, Any] = {
                "zone": rname,
                "lag15Share": round(rm_long, 4),
                "ampPx": reg_amp,
            }
            if period_sec is not None and rname == "center" and has_real_amp:
                reg_entry["periodSec"] = period_sec
            living_regions.append(reg_entry)
    living_regions.sort(key=lambda r: r["lag15Share"], reverse=True)
    living_regions = living_regions[:2]

    has_living_hold = bool(
        len(living_regions) > 0
        or (not settled_is_quiet and max_hold_curl >= 0.030 and mean_lag_long >= 0.045)
    )
    rotational_hold = bool(has_living_hold and max_hold_curl >= 0.025)

    # M4: Pre-cut motion energy (last ~0.40s before scene end) with noise floor rejection (>8 gray delta)
    # so compression jitter does not trigger false preCutActive while genuine motion right before a cut does.
    tail_n = max(1, min(len(steps), int(round(0.40 / max(0.08, step_sec)))))
    tail_diffs: List[float] = []
    for k in range(max(1, len(samples) - tail_n), len(samples)):
        d_mat = np.abs(samples[k][1].astype(np.float32) - samples[k - 1][1].astype(np.float32))
        gd = float(np.where(d_mat > 8.0, d_mat, 0.0).mean())
        tail_diffs.append(gd)
    pre_cut_diff = round(float(np.median(tail_diffs)) if tail_diffs else 0.0, 3)
    pre_cut_active = bool(pre_cut_diff >= 0.35)

    return {
        "motionBursts": formatted_bursts,
        "activeFramePct": active_pct,
        "holdActivePct": hold_active_pct,
        "holdMeanFgDiff": hold_fg_diff,
        "holdLag1Share": round(mean_lag1, 4),
        "holdLag15Share": round(mean_lag_long, 4),
        "hasLivingHold": has_living_hold,
        "rotationalHold": rotational_hold,
        "livingHoldRegions": living_regions,
        "preCutDiff": pre_cut_diff,
        "preCutActive": pre_cut_active,
    }
