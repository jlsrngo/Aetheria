#!/usr/bin/env python3
"""Native-framerate (30fps) element feel extractor: overshoot %, settle duration, and smear proxy (Prompt 11 M3).

Samples every frame inside burst windows from `ref_motion_kinematics` using `_foreground_box_and_mask`
and reports `elementFeel` ONLY when bbox area in the settled tail is stable (honesty guard: never guesses).
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from ref_motion_clues import _border_bg_bgr, _foreground_box_and_mask


def _measure_single_burst_feel(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    scene_start: float,
    scene_end: float,
    burst_t0: float,
    burst_t1: float,
    width: int,
    height: int,
    fps: float = 30.0,
) -> Optional[Dict[str, Any]]:
    safe_fps = max(10.0, float(fps))
    dt = 1.0 / safe_fps
    w_start = max(scene_start, scene_start + float(burst_t0) - 0.08)
    w_end = min(scene_end - 0.02, scene_start + float(burst_t1) + 0.35)
    if w_end - w_start < dt * 6:
        return None

    samples: List[Tuple[float, float, float, float, float, float]] = []
    t = w_start
    max_frames = 42
    while t <= w_end + 1e-4 and len(samples) < max_frames:
        fr = frame_at_fn(t)
        if fr is not None:
            bg_bgr = _border_bg_bgr(fr)
            box, _, ratio = _foreground_box_and_mask(fr, bg_bgr)
            if box is not None and 0.004 <= ratio <= 0.68:
                bx, by, bw, bh = box
                cx = bx + bw * 0.5
                cy = by + bh * 0.5
                diag = math.hypot(float(bw), float(bh))
                samples.append((round(t - scene_start, 3), cx, cy, float(bw), float(bh), diag))
        t += dt

    if len(samples) < 7:
        return None

    tail_len = max(3, min(6, len(samples) // 3))
    tail_diags = np.array([s[5] for s in samples[-tail_len:]], dtype=np.float64)
    settle_diag = float(np.median(tail_diags))
    if settle_diag < 24.0:
        return None
    tail_cv = float(np.std(tail_diags) / max(1.0, settle_diag))
    # Honesty guard: omit feel if settled bbox jitter is noisy
    if tail_cv > 0.12:
        return None

    diags = np.array([s[5] for s in samples], dtype=np.float64)
    start_diag = float(diags[0])
    peak_idx = int(np.argmax(diags))
    peak_diag = float(diags[peak_idx])

    # Determine motion start (first frame deviating > 5% from start_diag or moving > 3px)
    start_idx = 0
    for k in range(1, len(samples)):
        d_diag = abs(diags[k] - start_diag) / max(1.0, settle_diag)
        d_pos = math.hypot(samples[k][1] - samples[0][1], samples[k][2] - samples[0][2])
        if d_diag >= 0.05 or d_pos >= 3.0:
            start_idx = max(0, k - 1)
            break

    # Overshoot %: peak must occur strictly before the settled tail and exceed settle
    overshoot_pct = 0.0
    if peak_idx < len(samples) - max(2, tail_len // 2) and peak_diag > settle_diag:
        overshoot_pct = max(0.0, (peak_diag / settle_diag - 1.0) * 100.0)

    # Settle duration: first frame after peak (or after start) from which remaining tail stays within +-2.5%
    settle_idx = len(samples) - 1
    for k in range(max(start_idx + 1, peak_idx), len(samples)):
        rem = diags[k:]
        if float(np.max(np.abs(rem - settle_diag) / settle_diag)) <= 0.025:
            settle_idx = k
            break

    t_start = samples[start_idx][0]
    t_peak = samples[peak_idx][0]
    settle_sec = max(dt, samples[settle_idx][0] - t_start)

    # Motion smear proxy: peak bbox extent along primary travel axis during fast frames vs settled extent
    dxs = [abs(samples[k][1] - samples[k - 1][1]) for k in range(1, len(samples))]
    dys = [abs(samples[k][2] - samples[k - 1][2]) for k in range(1, len(samples))]
    axis_is_x = sum(dxs) >= sum(dys)
    extents = np.array([s[3] if axis_is_x else s[4] for s in samples], dtype=np.float64)
    settled_ext = float(np.median(extents[-tail_len:]))
    smear_ratio = round(float(np.max(extents) / max(1.0, settled_ext)), 2) if settled_ext >= 12.0 else 1.0

    # Require either measurable pop/scale change or measurable overshoot
    scale_change = abs(settle_diag - start_diag) / max(1.0, settle_diag)
    if scale_change < 0.08 and overshoot_pct < 3.0 and smear_ratio < 1.15:
        return None

    return {
        "tStart": round(float(t_start), 3),
        "tPeak": round(float(t_peak), 3),
        "overshootPct": round(float(overshoot_pct), 1),
        "settleSec": round(float(settle_sec), 3),
        "smearRatio": smear_ratio,
        "tailCv": round(tail_cv, 4),
    }


def extract_scene_element_feel(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    start: float,
    end: float,
    width: int,
    height: int,
    motion_bursts: Optional[List[Dict[str, Any]]] = None,
    fps: float = 30.0,
) -> List[Dict[str, Any]]:
    """Extracts up to 2 stable native-30fps element feel profiles (`overshootPct`, `settleSec`, `smearRatio`)."""
    bursts = motion_bursts or []
    if not bursts:
        return []
    out: List[Dict[str, Any]] = []
    for b in bursts[:3]:
        t0 = float(b.get("t0", 0.0))
        t1 = float(b.get("t1", t0 + 0.3))
        feel = _measure_single_burst_feel(frame_at_fn, start, end, t0, t1, width, height, fps=fps)
        if feel is not None:
            out.append(feel)
        if len(out) >= 2:
            break
    return out
