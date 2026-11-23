#!/usr/bin/env python3
"""Per-element motion trajectory extractor when global ORB camera motion is empty."""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _sample_track_timestamps(start: float, end: float, step_sec: float = 0.25) -> List[float]:
    dur = max(0.05, float(end) - float(start))
    lo = float(start) + min(0.02, dur * 0.1)
    hi = max(lo, float(end) - min(0.02, dur * 0.1))
    n = max(2, min(48, int(math.ceil(max(0.05, hi - lo) / max(0.08, step_sec))) + 1))
    return [round(lo + (hi - lo) * (i / float(n - 1)), 3) for i in range(n)]


def _extract_salient_components(
    frame_bgr: np.ndarray,
    full_w: int,
    full_h: int,
    work_w: int = 240,
) -> List[Dict[str, Any]]:
    fh, fw = frame_bgr.shape[:2]
    if fh <= 0 or fw <= 0:
        return []
    scale = min(1.0, float(work_w) / float(fw))
    mw = max(32, int(round(fw * scale)))
    mh = max(32, int(round(fh * scale)))
    small = cv2.resize(frame_bgr, (mw, mh), interpolation=cv2.INTER_AREA) if scale < 0.999 else frame_bgr

    b = max(3, min(8, mw // 24, mh // 24))
    border = np.concatenate(
        [
            small[:b, :, :].reshape(-1, 3),
            small[-b:, :, :].reshape(-1, 3),
            small[:, :b, :].reshape(-1, 3),
            small[:, -b:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    bg_bgr = np.median(border, axis=0).astype(np.int16)
    bg_hsv = cv2.cvtColor(np.uint8([[np.clip(bg_bgr, 0, 255)]]), cv2.COLOR_BGR2HSV)[0, 0]

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sigma = max(8.0, min(25.0, min(mw, mh) * 0.10))
    blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma)
    tophat_mask = np.abs(gray - blurred) > 18.0

    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.int16)
    sat_diff = np.abs(hsv[:, :, 1] - int(bg_hsv[1])) > 35
    bgr_diff = np.max(np.abs(small.astype(np.int16) - bg_bgr), axis=2) > 28
    salient = ((tophat_mask | (bgr_diff & sat_diff))).astype(np.uint8) * 255

    k5 = np.ones((5, 5), np.uint8)
    k3 = np.ones((3, 3), np.uint8)
    salient = cv2.morphologyEx(salient, cv2.MORPH_CLOSE, k5)
    salient = cv2.morphologyEx(salient, cv2.MORPH_OPEN, k3)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(salient, connectivity=8)
    mask_area = max(1, mw * mh)
    min_area = max(24, int(mask_area * 0.0015))
    max_box_area = int(mask_area * 0.45)
    sx = float(full_w) / float(mw)
    sy = float(full_h) / float(mh)

    out: List[Dict[str, Any]] = []
    for lbl in range(1, num_labels):
        area = int(stats[lbl, cv2.CC_STAT_AREA])
        bx = int(stats[lbl, cv2.CC_STAT_LEFT])
        by = int(stats[lbl, cv2.CC_STAT_TOP])
        bw = int(stats[lbl, cv2.CC_STAT_WIDTH])
        bh = int(stats[lbl, cv2.CC_STAT_HEIGHT])
        if area < min_area or bw <= 0 or bh <= 0 or (bw * bh) > max_box_area:
            continue
        pix = small[labels == lbl]
        if pix.size == 0:
            continue
        med_bgr = np.median(pix, axis=0)
        solidity = float(area) / float(max(1, bw * bh))
        bg_contrast = float(np.max(np.abs(med_bgr.astype(np.float32) - bg_bgr.astype(np.float32))))
        # Reject pale low-solidity diagonal background streaks/caustics that hijack foreground tracks
        if solidity < 0.22 and bg_contrast < 42.0 and (bw * bh) > int(mask_area * 0.12):
            continue
        hex_col = f"#{int(med_bgr[2]):02X}{int(med_bgr[1]):02X}{int(med_bgr[0]):02X}"
        fw_box = max(1, int(round(bw * sx)))
        fh_box = max(1, int(round(bh * sy)))
        fcx = int(round((bx + bw * 0.5) * sx))
        fcy = int(round((by + bh * 0.5) * sy))
        out.append(
            {
                "cx": fcx,
                "cy": fcy,
                "w": fw_box,
                "h": fh_box,
                "area": fw_box * fh_box,
                "hex": hex_col,
            }
        )
    out.sort(key=lambda c: c["area"], reverse=True)
    return out[:10]


def _downsample_points(points: List[Dict[str, Any]], max_pts: int = 10) -> List[Dict[str, Any]]:
    if len(points) <= max_pts:
        return points
    keep = {0, len(points) - 1}
    keep.add(min(range(len(points)), key=lambda i: points[i]["cx"]))
    keep.add(max(range(len(points)), key=lambda i: points[i]["cx"]))
    keep.add(min(range(len(points)), key=lambda i: points[i]["cy"]))
    keep.add(max(range(len(points)), key=lambda i: points[i]["cy"]))
    keep.add(min(range(len(points)), key=lambda i: points[i]["w"] * points[i]["h"]))
    keep.add(max(range(len(points)), key=lambda i: points[i]["w"] * points[i]["h"]))
    step = max(1, len(points) // max(1, max_pts - len(keep)))
    idx = 0
    while len(keep) < max_pts and idx < len(points):
        keep.add(idx)
        idx += step
    return [points[i] for i in sorted(keep)][:max_pts]


def extract_scene_element_tracks(
    frame_at_fn: Callable[[float], Optional[np.ndarray]],
    start: float,
    end: float,
    width: int,
    height: int,
    step_sec: float = 0.25,
    max_tracks: int = 3,
) -> List[Dict[str, Any]]:
    """Tracks up to `max_tracks` salient foreground elements across a scene at <=0.25s cadence."""
    timestamps = _sample_track_timestamps(start, end, step_sec=step_sec)
    diag = math.hypot(float(max(1, width)), float(max(1, height)))
    max_jump = diag * 0.38

    active_tracks: List[Dict[str, Any]] = []
    finished_tracks: List[Dict[str, Any]] = []

    for ts in timestamps:
        fr = frame_at_fn(ts)
        if fr is None:
            continue
        comps = _extract_salient_components(fr, width, height)
        local_t = round(max(0.0, float(ts) - float(start)), 3)

        used_tracks = set()
        used_comps = set()
        pairs: List[Tuple[float, int, int]] = []
        for ti, tr in enumerate(active_tracks):
            last = tr["points"][-1]
            if (local_t - last["localT"]) > max(0.65, step_sec * 2.5):
                continue
            for ci, cp in enumerate(comps):
                d = math.hypot(cp["cx"] - last["cx"], cp["cy"] - last["cy"])
                if d <= max_jump:
                    pairs.append((d, ti, ci))
        pairs.sort(key=lambda item: item[0])

        for _, ti, ci in pairs:
            if ti in used_tracks or ci in used_comps:
                continue
            used_tracks.add(ti)
            used_comps.add(ci)
            cp = comps[ci]
            active_tracks[ti]["points"].append(
                {
                    "localT": local_t,
                    "cx": cp["cx"],
                    "cy": cp["cy"],
                    "w": cp["w"],
                    "h": cp["h"],
                    "hex": cp["hex"],
                }
            )

        next_active: List[Dict[str, Any]] = []
        for ti, tr in enumerate(active_tracks):
            if ti in used_tracks or (local_t - tr["points"][-1]["localT"]) <= step_sec * 1.6:
                next_active.append(tr)
            else:
                finished_tracks.append(tr)
        for ci, cp in enumerate(comps):
            if ci in used_comps:
                continue
            next_active.append(
                {
                    "points": [
                        {
                            "localT": local_t,
                            "cx": cp["cx"],
                            "cy": cp["cy"],
                            "w": cp["w"],
                            "h": cp["h"],
                            "hex": cp["hex"],
                        }
                    ]
                }
            )
        active_tracks = next_active

    all_tracks = finished_tracks + active_tracks
    results: List[Tuple[float, Dict[str, Any]]] = []
    for tr in all_tracks:
        pts = tr["points"]
        if len(pts) < 2:
            continue
        cxs = [p["cx"] for p in pts]
        cys = [p["cy"] for p in pts]
        areas = [max(1, p["w"] * p["h"]) for p in pts]
        x_range = max(cxs) - min(cxs)
        y_range = max(cys) - min(cys)
        disp = round(math.hypot(float(x_range), float(y_range)), 1)
        size_ratio = round(float(max(areas)) / float(max(1, min(areas))), 2)
        dom_hex = pts[len(pts) // 2]["hex"]
        score = disp + max(0.0, size_ratio - 1.0) * 120.0 + len(pts) * 4.0
        results.append(
            (
                score,
                {
                    "displacementPx": disp,
                    "xRangePx": int(x_range),
                    "yRangePx": int(y_range),
                    "sizeRatio": size_ratio,
                    "dominantHex": dom_hex,
                    "pointCount": len(pts),
                    "points": _downsample_points(pts, max_pts=10),
                },
            )
        )

    results.sort(key=lambda item: item[0], reverse=True)
    top: List[Dict[str, Any]] = []
    for idx, (_, track_obj) in enumerate(results[:max_tracks], start=1):
        track_obj["id"] = idx
        top.append(track_obj)
    return top
