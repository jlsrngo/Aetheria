#!/usr/bin/env python3
"""30fps cross-scene transition bridge & multi-pulse intra-scene motion extractor.

Runs a single sequential 30fps Farneback optical-flow pass over the full reference video
to capture mature timing data that coarse beat snapshots miss:
1) Cross-scene transition bridges (`push_left`, `push_right`, `push_up`, `push_down` with a
   16-point normalized displacement curve, or `hard_cut` with measured `leadInBlankSec`).
2) Multi-pulse intra-scene `cameraPulses`, sparse `cameraTrack` keyframes, `actionWindows`
   (`camera_zoom_*`, `camera_pan_*`, `local_action`, `continuous_ambient`), and a 15-bin
   `velocityCurve15`.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _even_dim(val: int, lo: int = 48) -> int:
    v = max(lo, int(val))
    return v if v % 2 == 0 else v + 1


def _compute_fg_ratio(small_bgr: np.ndarray) -> float:
    h, w = small_bgr.shape[:2]
    b = max(2, min(6, w // 24, h // 24))
    border = np.concatenate(
        [
            small_bgr[:b, :].reshape(-1, 3),
            small_bgr[-b:, :].reshape(-1, 3),
            small_bgr[:, :b].reshape(-1, 3),
            small_bgr[:, -b:].reshape(-1, 3),
        ],
        axis=0,
    )
    bg = np.median(border, axis=0).astype(np.int16)
    diff = np.max(np.abs(small_bgr.astype(np.int16) - bg), axis=2)
    return float(np.count_nonzero(diff > 26)) / float(max(1, h * w))


def _resample_curve_16(raw_vals: List[float]) -> List[float]:
    if not raw_vals:
        return [round(i / 15.0, 4) for i in range(16)]
    arr = np.asarray([max(0.25, float(v)) for v in raw_vals], dtype=np.float64)
    cum = np.concatenate([[0.0], np.cumsum(arr)])
    tot = float(cum[-1])
    if tot <= 1e-6:
        return [round(i / 15.0, 4) for i in range(16)]
    norm = cum / tot
    xp = np.linspace(0.0, 1.0, len(norm))
    targets = np.linspace(0.0, 1.0, 16)
    sampled = np.interp(targets, xp, norm)
    sampled[0] = 0.0
    sampled[-1] = 1.0
    return [round(float(x), 4) for x in sampled]


def _scan_wave_on_axis(
    flows: List[Dict[str, float]],
    cut_frame: int,
    lo_f: int,
    hi_f: int,
    axis: str,
    sign: int,
    fps: float,
) -> Optional[Dict[str, Any]]:
    key = "dx" if axis == "x" else "dy"
    orth_key = "dy" if axis == "x" else "dx"

    # Locate peak signed velocity near cut
    best_idx = -1
    best_score = 0.0
    for fi in range(lo_f, hi_f + 1):
        fl = flows[fi]
        v = fl[key] * float(sign)
        if v > best_score and fl["actPct"] >= 6.0:
            best_score = v
            best_idx = fi
    if best_idx < 0 or best_score < 16.0:
        return None

    def _is_aligned(fi: int) -> bool:
        fl = flows[fi]
        return (fl[key] * float(sign) >= 1.5) and (fl["actPct"] >= 6.0)

    def _is_blur_alias(fi: int) -> bool:
        fl = flows[fi]
        return fl["p90"] >= 18.0 and fl["actPct"] >= 10.0

    # Expand left from peak, allowing at most 1 high-energy aperture-alias frame
    f_start = best_idx
    while f_start > lo_f:
        cand = f_start - 1
        if _is_aligned(cand):
            f_start = cand
        elif cand - 1 >= lo_f and _is_blur_alias(cand) and _is_aligned(cand - 1):
            f_start = cand - 1
        else:
            break

    # Expand right from peak
    f_end = best_idx
    while f_end < hi_f:
        cand = f_end + 1
        if _is_aligned(cand):
            f_end = cand
        elif cand + 1 <= hi_f and _is_blur_alias(cand) and _is_aligned(cand + 1):
            f_end = cand + 1
        else:
            break

    span = f_end - f_start + 1
    dur = float(span) / max(1.0, fps)
    if span < 5 or dur < 0.16 or dur > 1.0:
        return None

    pre_end = min(f_end, cut_frame)
    pre_lo = max(f_start, cut_frame - int(round(0.35 * fps)))
    post_start = max(f_start, cut_frame + 1)
    post_hi = min(f_end, cut_frame + int(round(0.45 * fps)))
    pre_moving = sum(1 for fi in range(pre_lo, pre_end + 1) if _is_aligned(fi) or _is_blur_alias(fi))
    post_moving = sum(1 for fi in range(post_start, post_hi + 1) if _is_aligned(fi) or _is_blur_alias(fi))
    if pre_moving < 2 or post_moving < 2:
        return None

    raw_steps: List[float] = []
    orth_sum = 0.0
    for fi in range(f_start, f_end + 1):
        fl = flows[fi]
        v = fl[key] * float(sign)
        if v <= 0.5:
            # Interpolate across single alias frame
            left_v = flows[max(f_start, fi - 1)][key] * float(sign)
            right_v = flows[min(f_end, fi + 1)][key] * float(sign)
            v = max(0.5, 0.5 * (max(0.0, left_v) + max(0.0, right_v)))
        raw_steps.append(v)
        orth_sum += abs(fl[orth_key])

    tot_disp = float(sum(raw_steps))
    if tot_disp < max(1.0, orth_sum * 1.65):
        return None

    return {
        "axis": axis,
        "sign": sign,
        "fStart": f_start,
        "fPeak": best_idx,
        "fEnd": f_end,
        "peakVel": best_score,
        "totalDisp": tot_disp,
        "dur": dur,
        "rawSteps": raw_steps,
    }


def _detect_transition_bridge(
    flows: List[Dict[str, float]],
    fg_ratios: List[float],
    cut_frame: int,
    fps: float,
    width: int,
    height: int,
) -> Dict[str, Any]:
    n = len(flows)
    lo_f = max(1, cut_frame - int(round(0.45 * fps)))
    hi_f = min(n - 1, cut_frame + int(round(0.55 * fps)))

    candidates: List[Dict[str, Any]] = []
    for axis in ("x", "y"):
        thresh_disp = width * 0.22 if axis == "x" else height * 0.13
        for sign in (-1, 1):
            wave = _scan_wave_on_axis(flows, cut_frame, lo_f, hi_f, axis, sign, fps)
            if wave is not None and wave["totalDisp"] >= thresh_disp and wave["peakVel"] >= 18.0:
                candidates.append(wave)

    if candidates:
        best = max(candidates, key=lambda c: c["totalDisp"])
        if best["axis"] == "x":
            kind = "push_left" if best["sign"] < 0 else "push_right"
            dir_str = "left" if best["sign"] < 0 else "right"
        else:
            kind = "push_up" if best["sign"] < 0 else "push_down"
            dir_str = "up" if best["sign"] < 0 else "down"
        return {
            "kind": kind,
            "cutSec": round(float(cut_frame) / fps, 3),
            "tStart": round(float(best["fStart"]) / fps, 3),
            "tPeak": round(float(best["fPeak"]) / fps, 3),
            "tEnd": round(float(best["fEnd"]) / fps, 3),
            "durationSec": round(float(best["dur"]), 3),
            "direction": dir_str,
            "peakVelocityPx": round(float(best["peakVel"]), 1),
            "totalDispPx": round(float(best["totalDisp"]), 1),
            "curve": _resample_curve_16(best["rawSteps"]),
        }

    # Check for cross-cut zoom / motion-blur whip bridge when not a directional push
    zoom_lo = max(1, cut_frame - int(round(0.20 * fps)))
    zoom_hi = min(n - 1, cut_frame + int(round(0.24 * fps)))
    pre_zoom_f = [fi for fi in range(zoom_lo, cut_frame + 1) if flows[fi]["p90"] >= 15.0 and flows[fi]["actPct"] >= 10.0 and abs(flows[fi]["div"]) >= 0.015]
    post_zoom_f = [fi for fi in range(cut_frame + 1, zoom_hi + 1) if flows[fi]["p90"] >= 15.0 and flows[fi]["actPct"] >= 10.0 and abs(flows[fi]["div"]) >= 0.015]

    # Measure hard-cut lead-in clean blank grid frames
    max_probe = min(len(fg_ratios), cut_frame + int(round(0.40 * fps)) + 1)
    blank_count = 0
    for fi in range(max(0, cut_frame), max_probe):
        if fg_ratios[fi] < 0.008:
            blank_count += 1
        else:
            break
    if blank_count == 0 and len(pre_zoom_f) >= 2 and len(post_zoom_f) >= 2:
        zf0 = min(pre_zoom_f)
        zf1 = max(post_zoom_f)
        raw_z = [max(0.5, flows[fi]["p90"]) for fi in range(zf0, zf1 + 1)]
        return {
            "kind": "zoom_blur",
            "cutSec": round(float(cut_frame) / fps, 3),
            "tStart": round(float(zf0) / fps, 3),
            "tPeak": round(float(cut_frame) / fps, 3),
            "tEnd": round(float(zf1) / fps, 3),
            "durationSec": round(float(zf1 - zf0 + 1) / max(1.0, fps), 3),
            "direction": "zoom",
            "peakVelocityPx": round(float(max(raw_z)), 1),
            "totalDispPx": round(float(sum(raw_z)), 1),
            "curve": _resample_curve_16(raw_z),
        }
    return {
        "kind": "hard_cut",
        "cutSec": round(float(cut_frame) / fps, 3),
        "leadInBlankSec": round(float(blank_count) / fps, 3),
    }


def _build_camera_track_keyframes(
    pulses: List[Dict[str, Any]],
    flows: List[Dict[str, float]],
    scene_start: float,
    dur: float,
    fps: float,
) -> List[Dict[str, Any]]:
    if not pulses:
        return []
    frame_map: Dict[int, Tuple[float, float, float]] = {}
    cum_tx = 0.0
    cum_ty = 0.0
    cum_s = 1.0
    pulse_frames = set()
    for p in pulses:
        for fi in range(int(p["f0"]), int(p["f1"]) + 1):
            pulse_frames.add(fi)

    min_f = min(int(p["f0"]) for p in pulses)
    max_f = max(int(p["f1"]) for p in pulses)
    frame_map[max(0, min_f - 1)] = (0.0, 0.0, 1.0)
    for fi in range(min_f, max_f + 1):
        fl = flows[fi]
        if fi in pulse_frames:
            cum_tx += fl["dx"]
            cum_ty += fl["dy"]
            cum_s = float(np.clip(cum_s * (1.0 + fl["div"]), 0.45, 2.5))
        frame_map[fi] = (cum_tx, cum_ty, cum_s)

    keyframes: List[Dict[str, Any]] = []
    if min_f > 0:
        keyframes.append({"t": 0.0, "tx": 0.0, "ty": 0.0, "s": 1.0, "rot": 0.0})

    sorted_fs = sorted(frame_map.keys())
    step = max(1, len(sorted_fs) // 16)
    picked_fs = sorted(set(sorted_fs[::step] + [sorted_fs[0], sorted_fs[-1]]))
    for fi in picked_fs:
        lt = round(max(0.0, float(fi) / fps - scene_start), 3)
        tx, ty, s_val = frame_map[fi]
        keyframes.append({
            "t": lt,
            "tx": round(tx, 1),
            "ty": round(ty, 1),
            "s": round(s_val, 3),
            "rot": 0.0,
        })
    last_tx, last_ty, last_s = frame_map[sorted_fs[-1]]
    if keyframes[-1]["t"] < dur - 0.04:
        keyframes.append({
            "t": round(dur, 3),
            "tx": round(last_tx, 1),
            "ty": round(last_ty, 1),
            "s": round(last_s, 3),
            "rot": 0.0,
        })
    return keyframes


def _classify_pulse_kind(dx: float, dy: float, scale_ratio: float) -> str:
    if scale_ratio >= 1.15:
        return "camera_zoom_in"
    if scale_ratio <= 0.86:
        return "camera_zoom_out"
    if abs(dy) >= abs(dx):
        return "camera_pan_up" if dy < 0 else "camera_pan_down"
    return "camera_pan_left" if dx < 0 else "camera_pan_right"


def _extract_scene_motion_timeline(
    flows: List[Dict[str, float]],
    start_f: int,
    end_f: int,
    scene_start: float,
    dur: float,
    fps: float,
    exclude_frames: set[int],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    span_fs = [fi for fi in range(max(1, start_f + 1), min(len(flows), end_f + 1))]
    if not span_fs:
        return {"velocityCurve15": [], "cameraPulses": [], "actionWindows": [], "meanP90": 0.0, "activePct": 0.0}, []

    # 1. 15-bin velocity curve over the entire scene
    buckets = 15
    vel_curve: List[Dict[str, Any]] = []
    for bi in range(buckets):
        b0 = int(math.floor(bi * len(span_fs) / buckets))
        b1 = max(b0 + 1, int(math.floor((bi + 1) * len(span_fs) / buckets)))
        sub = [flows[fi] for fi in span_fs[b0:b1]]
        mid_f = span_fs[(b0 + min(len(span_fs) - 1, b1 - 1)) // 2]
        vel_curve.append({
            "lt": round(max(0.0, float(mid_f) / fps - scene_start), 2),
            "p90": round(float(np.mean([r["p90"] for r in sub])), 1),
            "dx": round(float(np.mean([r["dx"] for r in sub])), 1),
            "dy": round(float(np.mean([r["dy"] for r in sub])), 1),
            "act": round(float(np.mean([r["actPct"] for r in sub])), 1),
        })

    # 2. Multi-pulse intra-scene camera pulses (excluding cross-scene push bridge frames)
    clean_fs = [fi for fi in span_fs if fi not in exclude_frames]
    cam_pulses: List[Dict[str, Any]] = []
    cur: List[int] = []
    gap = 0
    for fi in clean_fs:
        fl = flows[fi]
        is_cam = (fl["activeQuads"] >= 3) and (math.hypot(fl["dx"], fl["dy"]) >= 2.2 or abs(fl["div"]) >= 0.018)
        if is_cam:
            cur.append(fi)
            gap = 0
        elif cur and gap < 1:
            gap += 1
            cur.append(fi)
        else:
            if cur:
                if len(cur) > 1 and gap == 1:
                    cur.pop()
                if len(cur) >= 3:
                    dx_s = sum(flows[k]["dx"] for k in cur)
                    dy_s = sum(flows[k]["dy"] for k in cur)
                    s_tot = 1.0
                    for k in cur:
                        s_tot *= float(np.clip(1.0 + flows[k]["div"], 0.85, 1.18))
                    pk = max(flows[k]["p90"] for k in cur)
                    if math.hypot(dx_s, dy_s) >= 42.0 or s_tot >= 1.15 or s_tot <= 0.86:
                        cam_pulses.append({
                            "f0": cur[0],
                            "f1": cur[-1],
                            "t0": round(max(0.0, float(cur[0] - 1) / fps - scene_start), 2),
                            "t1": round(max(0.0, float(cur[-1]) / fps - scene_start), 2),
                            "kind": _classify_pulse_kind(dx_s, dy_s, s_tot),
                            "dxPx": int(round(dx_s)),
                            "dyPx": int(round(dy_s)),
                            "scaleRatio": round(float(s_tot), 2),
                            "peakP90": round(float(pk), 1),
                        })
            cur = []
            gap = 0
    if len(cur) >= 3:
        dx_s = sum(flows[k]["dx"] for k in cur)
        dy_s = sum(flows[k]["dy"] for k in cur)
        s_tot = 1.0
        for k in cur:
            s_tot *= float(np.clip(1.0 + flows[k]["div"], 0.85, 1.18))
        pk = max(flows[k]["p90"] for k in cur)
        if math.hypot(dx_s, dy_s) >= 42.0 or s_tot >= 1.15 or s_tot <= 0.86:
            cam_pulses.append({
                "f0": cur[0],
                "f1": cur[-1],
                "t0": round(max(0.0, float(cur[0] - 1) / fps - scene_start), 2),
                "t1": round(max(0.0, float(cur[-1]) / fps - scene_start), 2),
                "kind": _classify_pulse_kind(dx_s, dy_s, s_tot),
                "dxPx": int(round(dx_s)),
                "dyPx": int(round(dy_s)),
                "scaleRatio": round(float(s_tot), 2),
                "peakP90": round(float(pk), 1),
            })

    cam_pulses = cam_pulses[:3]
    cam_frames: set[int] = set()
    for p in cam_pulses:
        for fi in range(int(p["f0"]), int(p["f1"]) + 1):
            cam_frames.add(fi)

    camera_track = _build_camera_track_keyframes(cam_pulses, flows, scene_start, dur, fps)

    # 3. Localized / continuous ambient action windows outside camera pulses
    action_windows: List[Dict[str, Any]] = [
        {
            "t0": p["t0"],
            "t1": p["t1"],
            "kind": p["kind"],
            "dxPx": p["dxPx"],
            "dyPx": p["dyPx"],
            "scaleRatio": p["scaleRatio"],
            "peakP90": p["peakP90"],
            "meanActPct": round(float(np.mean([flows[k]["actPct"] for k in range(int(p["f0"]), int(p["f1"]) + 1)])), 1),
        }
        for p in cam_pulses
    ]

    loc_cur: List[int] = []
    loc_gap = 0
    for fi in clean_fs:
        if fi in cam_frames:
            is_act = False
        else:
            fl = flows[fi]
            is_act = (fl["actPct"] >= 2.0) and (fl["p90"] >= 6.0 or fl["grayDiff"] >= 0.9)
        if is_act:
            loc_cur.append(fi)
            loc_gap = 0
        elif loc_cur and loc_gap < 2:
            loc_gap += 1
            loc_cur.append(fi)
        else:
            if loc_cur:
                while loc_cur and loc_gap > 0:
                    loc_cur.pop()
                    loc_gap -= 1
                if len(loc_cur) >= 4:
                    mean_p90 = float(np.mean([flows[k]["p90"] for k in loc_cur]))
                    peak_p90 = float(np.max([flows[k]["p90"] for k in loc_cur]))
                    mean_act = float(np.mean([flows[k]["actPct"] for k in loc_cur]))
                    wdur = float(len(loc_cur)) / max(1.0, fps)
                    if peak_p90 >= 10.0 or (wdur >= 0.75 and mean_p90 >= 6.0 and mean_act >= 4.0):
                        kind = "continuous_ambient" if (wdur >= 0.75 and mean_act >= 4.5 and mean_p90 >= 6.0) else "local_action"
                        action_windows.append({
                            "t0": round(max(0.0, float(loc_cur[0] - 1) / fps - scene_start), 2),
                            "t1": round(max(0.0, float(loc_cur[-1]) / fps - scene_start), 2),
                            "kind": kind,
                            "dxPx": int(round(sum(flows[k]["dx"] for k in loc_cur))),
                            "dyPx": int(round(sum(flows[k]["dy"] for k in loc_cur))),
                            "scaleRatio": 1.0,
                            "peakP90": round(peak_p90, 1),
                            "meanActPct": round(mean_act, 1),
                        })
            loc_cur = []
            loc_gap = 0
    if len(loc_cur) >= 4:
        mean_p90 = float(np.mean([flows[k]["p90"] for k in loc_cur]))
        peak_p90 = float(np.max([flows[k]["p90"] for k in loc_cur]))
        mean_act = float(np.mean([flows[k]["actPct"] for k in loc_cur]))
        wdur = float(len(loc_cur)) / max(1.0, fps)
        if peak_p90 >= 10.0 or (wdur >= 0.75 and mean_p90 >= 6.0 and mean_act >= 4.0):
            kind = "continuous_ambient" if (wdur >= 0.75 and mean_act >= 4.5 and mean_p90 >= 6.0) else "local_action"
            action_windows.append({
                "t0": round(max(0.0, float(loc_cur[0] - 1) / fps - scene_start), 2),
                "t1": round(max(0.0, float(loc_cur[-1]) / fps - scene_start), 2),
                "kind": kind,
                "dxPx": int(round(sum(flows[k]["dx"] for k in loc_cur))),
                "dyPx": int(round(sum(flows[k]["dy"] for k in loc_cur))),
                "scaleRatio": 1.0,
                "peakP90": round(peak_p90, 1),
                "meanActPct": round(mean_act, 1),
            })

    action_windows.sort(key=lambda w: w["t0"])
    if len(action_windows) > 5:
        action_windows = sorted(
            sorted(action_windows, key=lambda w: w["peakP90"] * max(0.2, w["t1"] - w["t0"]), reverse=True)[:5],
            key=lambda w: w["t0"],
        )

    clean_pulses = [{k: v for k, v in p.items() if k not in ("f0", "f1")} for p in cam_pulses]
    mean_scene_p90 = round(float(np.mean([flows[fi]["p90"] for fi in span_fs])), 1)
    act_pct = round(100.0 * sum(1 for fi in span_fs if flows[fi]["actPct"] >= 2.0) / float(len(span_fs)), 1)

    # 4. Detect local spinning objects (corner stars, spinning rings, sustained 3D turntable hero)
    spinning_objects: List[Dict[str, Any]] = []
    non_cam_clean_fs = [fi for fi in clean_fs if fi not in cam_frames]
    zone_defs = [
        ("top_left", "corner_spin"),
        ("top_right", "corner_spin"),
        ("mid_right", "corner_spin"),
        ("bottom_right", "corner_spin"),
        ("center", "turntable_3d_and_ring_spin"),
    ]
    for z_name, z_kind in zone_defs:
        om_key = f"om_{z_name}"
        act_key = f"act_{z_name}"
        tt_key = f"tt_{z_name}"
        div_key = f"div_{z_name}"
        if z_name == "center":
            # True 3D Y-axis turntable (e.g. rotating brain/globe): sustained center surface texture
            # rolling horizontally while silhouette scale stays steady (ultra-low radial divergence)
            # over >= 0.90s AND >= 45% of non-camera-pan frames — rejects radial pop-ins (targets),
            # morphs (puzzle), and burst text reveals.
            active_fs = [
                fi for fi in non_cam_clean_fs
                if (flows[fi].get(act_key, 0.0) >= 14.0)
                and (abs(flows[fi].get(div_key, 0.0)) <= 0.0022)
                and (0.12 <= flows[fi].get(f"mv_{z_name}", 0.0) <= 0.95)
                and (flows[fi].get(f"hdom_{z_name}", 0.0) >= 1.25 or abs(flows[fi].get(om_key, 0.0)) >= 0.012)
            ]
            min_frames = max(24, int(round(0.90 * fps)), int(round(len(non_cam_clean_fs) * 0.45)))
        else:
            # Corner emblems require genuine rotational curl (not radial expansion or wipe)
            active_fs = [
                fi for fi in non_cam_clean_fs
                if (flows[fi].get(act_key, 0.0) >= 1.2)
                and (abs(flows[fi].get(om_key, 0.0)) >= 0.010)
            ]
            min_frames = max(6, int(round(0.22 * fps)))
        if len(active_fs) >= min_frames:
            om_vals = [flows[fi].get(om_key, 0.0) for fi in active_fs]
            pos_cnt = sum(1 for v in om_vals if v > 0.006)
            neg_cnt = sum(1 for v in om_vals if v < -0.006)
            sign_z = 1.0 if pos_cnt >= neg_cnt else -1.0
            mag_med = float(np.median([abs(v) for v in om_vals]))
            deg_per_sec = round(sign_z * max(28.0, min(140.0, mag_med * fps * (180.0 / math.pi) * 2.2)), 1)
            spinning_objects.append({
                "zone": z_name,
                "kind": z_kind,
                "t0": round(max(0.0, float(active_fs[0] - 1) / fps - scene_start), 2),
                "t1": round(max(0.0, float(active_fs[-1]) / fps - scene_start), 2),
                "omegaDegPerSec": deg_per_sec,
            })

    # 5. Detect progressive left-to-right character blur text reveals
    blur_reveals: List[Dict[str, Any]] = []
    br_cur: List[int] = []
    for fi in clean_fs:
        if flows[fi].get("charBlurWave", 0.0) >= 1.0:
            br_cur.append(fi)
        else:
            if len(br_cur) >= 3:
                blur_reveals.append({
                    "t0": round(max(0.0, float(br_cur[0] - 1) / fps - scene_start), 2),
                    "t1": round(max(0.0, float(br_cur[-1] + 2) / fps - scene_start), 2),
                    "kind": "left_to_right_char_unblur",
                })
            br_cur = []
    if len(br_cur) >= 3:
        blur_reveals.append({
            "t0": round(max(0.0, float(br_cur[0] - 1) / fps - scene_start), 2),
            "t1": round(min(dur, max(0.0, float(br_cur[-1] + 2) / fps - scene_start)), 2),
            "kind": "left_to_right_char_unblur",
        })

    # 6. Detect intra-scene phase zoom bridge (e.g. Scene 1 purple card zoom-up overlap with text blur reveal)
    phase_zoom_bridge: Optional[Dict[str, Any]] = None
    zoom_cands = [
        p for p in clean_pulses
        if p["kind"] in ("camera_zoom_in", "camera_zoom_out") and (p["scaleRatio"] >= 1.20 or p["scaleRatio"] <= 0.83)
    ]
    if zoom_cands:
        best_z = max(zoom_cands, key=lambda p: abs(float(p["scaleRatio"]) - 1.0))
        phase_zoom_bridge = {
            "t0": best_z["t0"],
            "t1": best_z["t1"],
            "kind": "zoom_through_overlap",
            "scaleRatio": best_z["scaleRatio"],
        }

    timeline = {
        "velocityCurve15": vel_curve,
        "cameraPulses": clean_pulses,
        "actionWindows": action_windows,
        "spinningObjects": spinning_objects[:4],
        "blurTextReveals": blur_reveals[:3],
        "phaseZoomBridge": phase_zoom_bridge,
        "meanP90": mean_scene_p90,
        "activePct": act_pct,
    }
    return timeline, camera_track


def analyze_video_30fps_motion(
    video_path: Path,
    scenes: List[Dict[str, Any]],
    width: int,
    height: int,
    fps: float,
) -> Dict[str, Any]:
    """Extracts 30fps transition bridges and intra-scene camera/action curves across `video_path`."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {"ok": False, "perScene": {}, "transitions": []}

    try:
        proxy_w = _even_dim(min(180, max(96, int(width))), lo=96)
        proxy_h = _even_dim(int(round(float(height) * (float(proxy_w) / float(max(1, width))))), lo=64)
        sx = float(width) / float(proxy_w)
        sy = float(height) / float(proxy_h)
        yy, xx = np.mgrid[0:proxy_h, 0:proxy_w]
        rx = (xx - proxy_w * 0.5) / max(1.0, proxy_w * 0.5)
        ry = (yy - proxy_h * 0.5) / max(1.0, proxy_h * 0.5)
        r2 = np.maximum(0.08, rx * rx + ry * ry)
        qh, qw = proxy_h // 2, proxy_w // 2
        min_quad = max(8, int(qh * qw * 0.015))
        min_act_cnt = max(35, int(proxy_w * proxy_h * 0.008))

        flows: List[Dict[str, float]] = [
            {
                "dx": 0.0,
                "dy": 0.0,
                "p90": 0.0,
                "div": 0.0,
                "curl": 0.0,
                "actPct": 0.0,
                "activeQuads": 0.0,
                "grayDiff": 0.0,
                "charBlurWave": 0.0,
            }
        ]
        fg_ratios: List[float] = []
        prev_gray: Optional[np.ndarray] = None
        zone_boxes = {
            "top_left": (0, int(proxy_h * 0.36), 0, int(proxy_w * 0.42)),
            "top_right": (0, int(proxy_h * 0.36), int(proxy_w * 0.58), proxy_w),
            "mid_right": (int(proxy_h * 0.28), int(proxy_h * 0.68), int(proxy_w * 0.58), proxy_w),
            "bottom_right": (int(proxy_h * 0.62), proxy_h, int(proxy_w * 0.52), proxy_w),
            "center": (int(proxy_h * 0.16), int(proxy_h * 0.74), int(proxy_w * 0.20), int(proxy_w * 0.80)),
        }

        while True:
            ok, frame = cap.read()
            if not ok or frame is None or frame.size == 0:
                break
            small = cv2.resize(frame, (proxy_w, proxy_h), interpolation=cv2.INTER_AREA)
            fg_ratios.append(_compute_fg_ratio(small))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            if prev_gray is not None:
                fl = cv2.calcOpticalFlowFarneback(prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
                fx, fy = fl[..., 0], fl[..., 1]
                mag = np.hypot(fx, fy)
                act = mag > 0.35
                cnt = int(np.count_nonzero(act))
                g_diff = float(np.mean(np.abs(gray.astype(np.float32) - prev_gray.astype(np.float32))))
                quads = sum(
                    1
                    for qm in (act[:qh, :qw], act[:qh, qw:], act[qh:, :qw], act[qh:, qw:])
                    if int(np.count_nonzero(qm)) >= min_quad
                )
                if cnt >= min_act_cnt:
                    mdx = float(np.median(fx[act]))
                    mdy = float(np.median(fy[act]))
                    dx = mdx * sx
                    dy = mdy * sy
                    p90 = float(np.percentile(mag[act], 90)) * ((sx + sy) * 0.5)
                    afx = fx[act] - mdx
                    afy = fy[act] - mdy
                    div = float(np.median((afx * rx[act] + afy * ry[act]) / r2[act])) * (1.0 / max(1.0, proxy_w * 0.5))
                    curl = float(np.median((rx[act] * afy - ry[act] * afx) / np.sqrt(r2[act])))
                    ap = 100.0 * float(cnt) / float(proxy_w * proxy_h)
                else:
                    dx = dy = p90 = div = curl = ap = 0.0

                zone_metrics: Dict[str, float] = {}
                for z_name, (y0, y1, x0, x1) in zone_boxes.items():
                    z_mag = mag[y0:y1, x0:x1]
                    z_act = z_mag > 0.22
                    z_cnt = int(np.count_nonzero(z_act))
                    z_area = max(1, (y1 - y0) * (x1 - x0))
                    z_ap = 100.0 * float(z_cnt) / float(z_area)
                    zone_metrics[f"act_{z_name}"] = z_ap
                    if z_cnt >= 14:
                        zy, zx = np.nonzero(z_act)
                        cx_z = float(np.mean(zx))
                        cy_z = float(np.mean(zy))
                        z_fx = fx[y0:y1, x0:x1][z_act]
                        z_fy = fy[y0:y1, x0:x1][z_act]
                        z_mdx = float(np.median(z_fx))
                        z_mdy = float(np.median(z_fy))
                        dx_c = zx.astype(np.float32) - cx_z
                        dy_c = zy.astype(np.float32) - cy_z
                        r2_c = np.maximum(4.0, dx_c * dx_c + dy_c * dy_c)
                        om = float(np.median((dx_c * (z_fy - z_mdy) - dy_c * (z_fx - z_mdx)) / r2_c))
                        z_div = float(np.median((dx_c * (z_fx - z_mdx) + dy_c * (z_fy - z_mdy)) / r2_c))
                        z_mv = math.hypot(z_mdx, z_mdy)
                        z_hdom = abs(z_mdx) / max(0.05, abs(z_mdy))
                        # 3D turntable / internal surface motion while centroid stays relatively steady
                        internal_std = float(np.percentile(np.hypot(z_fx - z_mdx, z_fy - z_mdy), 85))
                        tt_score = internal_std if z_mv <= 1.25 else 0.0
                        zone_metrics[f"om_{z_name}"] = om
                        zone_metrics[f"div_{z_name}"] = z_div
                        zone_metrics[f"mv_{z_name}"] = z_mv
                        zone_metrics[f"hdom_{z_name}"] = z_hdom
                        zone_metrics[f"tt_{z_name}"] = tt_score
                    else:
                        zone_metrics[f"om_{z_name}"] = 0.0
                        zone_metrics[f"div_{z_name}"] = 0.0
                        zone_metrics[f"mv_{z_name}"] = 0.0
                        zone_metrics[f"hdom_{z_name}"] = 0.0
                        zone_metrics[f"tt_{z_name}"] = 0.0

                # Detect horizontal progressive character blur-to-sharp reveal wave across text band
                mid_g = gray[int(proxy_h * 0.18) : int(proxy_h * 0.84), :]
                mid_prev = prev_gray[int(proxy_h * 0.18) : int(proxy_h * 0.84), :]
                mid_diff = np.abs(mid_g.astype(np.float32) - mid_prev.astype(np.float32))
                bg_med = float(np.median(mid_g))
                ink_mask = np.abs(mid_g.astype(np.float32) - bg_med) >= 12.0
                lap = np.abs(cv2.Laplacian(mid_g, cv2.CV_32F))
                hw = proxy_w // 2
                l_ink = ink_mask[:, :hw]
                r_ink = ink_mask[:, hw:]
                l_cnt = int(np.count_nonzero(l_ink))
                r_cnt = int(np.count_nonzero(r_ink))
                if l_cnt >= 18 and r_cnt >= 12:
                    left_diff = float(np.mean(mid_diff[:, :hw][l_ink]))
                    right_diff = float(np.mean(mid_diff[:, hw:][r_ink]))
                    left_lap = float(np.percentile(lap[:, :hw][l_ink], 85))
                    right_lap = float(np.percentile(lap[:, hw:][r_ink], 85))
                    char_blur_wave = (
                        1.0
                        if (
                            (left_diff >= 0.65 or right_diff >= 0.65)
                            and left_lap >= 14.0
                            and (right_lap < left_lap * 0.82 or right_diff > left_diff * 1.18)
                            and ap <= 42.0
                        )
                        else 0.0
                    )
                else:
                    char_blur_wave = 0.0

                flows.append({
                    "dx": dx,
                    "dy": dy,
                    "p90": p90,
                    "div": div,
                    "curl": curl,
                    "actPct": ap,
                    "activeQuads": float(quads),
                    "grayDiff": g_diff,
                    "charBlurWave": char_blur_wave,
                    **zone_metrics,
                })
            prev_gray = gray
    finally:
        cap.release()

    if len(flows) < 4:
        return {"ok": False, "perScene": {}, "transitions": []}

    bridges_by_idx: Dict[int, Dict[str, Any]] = {}
    push_frames_for_scene: Dict[int, set[int]] = {int(sc["index"]): set() for sc in scenes}
    transitions_summary: List[Dict[str, Any]] = []

    for i in range(1, len(scenes)):
        sc = scenes[i]
        prev_sc = scenes[i - 1]
        cut_sec = float(sc.get("start", 0.0))
        cut_frame = max(1, min(len(flows) - 1, int(round(cut_sec * fps))))
        tb = _detect_transition_bridge(flows, fg_ratios, cut_frame, fps, width, height)
        bridges_by_idx[int(sc["index"])] = tb
        if tb.get("kind", "").startswith("push_"):
            f0 = max(1, int(round(float(tb["tStart"]) * fps)))
            f1 = min(len(flows) - 1, int(round(float(tb["tEnd"]) * fps)))
            for fi in range(f0, f1 + 1):
                push_frames_for_scene[int(prev_sc["index"])].add(fi)
                push_frames_for_scene[int(sc["index"])].add(fi)
            transitions_summary.append({
                "fromSceneId": prev_sc.get("id"),
                "toSceneId": sc.get("id"),
                "toSceneIndex": sc.get("index"),
                **tb,
            })

    per_scene: Dict[int, Dict[str, Any]] = {}
    for sc in scenes:
        sc_idx = int(sc["index"])
        st = float(sc.get("start", 0.0))
        en = float(sc.get("end", st + float(sc.get("duration", 1.0))))
        dur = max(0.08, en - st)
        start_f = max(0, min(len(flows) - 1, int(round(st * fps))))
        end_f = max(start_f + 1, min(len(flows) - 1, int(round(en * fps))))
        timeline, cam_track = _extract_scene_motion_timeline(
            flows,
            start_f,
            end_f,
            st,
            dur,
            fps,
            push_frames_for_scene.get(sc_idx, set()),
        )
        per_scene[sc_idx] = {
            "transitionBridge": bridges_by_idx.get(sc_idx),
            "motionTimeline30fps": timeline,
            "cameraTrack": cam_track,
        }

    return {"ok": True, "perScene": per_scene, "transitions": transitions_summary}
