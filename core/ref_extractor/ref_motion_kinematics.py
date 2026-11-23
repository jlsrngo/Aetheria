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
        active = mag > 0.35
        act_count = int(np.count_nonzero(active))
        diff_abs = np.abs(g_b.astype(np.float32) - g_a.astype(np.float32))
        diff_mask = active | (diff_abs > 10.0)
        fg_diff = float(np.mean(diff_abs[diff_mask])) if np.any(diff_mask) else float(np.mean(diff_abs))

        if act_count >= 30:
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
        is_active_hold = act_count >= 24 or fg_diff >= 2.2
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
    if hold_steps:
        hold_active_pct = round(
            100.0 * sum(1 for s in hold_steps if s["isActive"]) / float(len(hold_steps)), 1
        )
        hold_fg_diff = round(float(np.mean([s["fgDiff"] for s in hold_steps])), 2)
        has_living_hold = bool(
            hold_active_pct >= 40.0
            or hold_fg_diff >= 2.2
            or (active_pct >= 80.0 and len(hold_steps) <= 1 and len(steps) >= 5)
        )
        rotational_hold = bool(
            has_living_hold and any(abs(s["curl"]) >= 0.02 for s in (hold_steps if len(hold_steps) > 1 else steps))
        )
    else:
        hold_active_pct = active_pct
        hold_fg_diff = round(float(np.mean([s["fgDiff"] for s in steps])), 2)
        has_living_hold = bool(len(steps) >= 3 and active_pct >= 65.0)
        rotational_hold = bool(has_living_hold and any(abs(s["curl"]) >= 0.02 for s in steps))

    return {
        "motionBursts": formatted_bursts,
        "activeFramePct": active_pct,
        "holdActivePct": hold_active_pct,
        "holdMeanFgDiff": hold_fg_diff,
        "hasLivingHold": has_living_hold,
        "rotationalHold": rotational_hold,
    }
