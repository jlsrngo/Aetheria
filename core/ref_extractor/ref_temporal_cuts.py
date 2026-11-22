"""Frame-accurate scene boundary detector & cut-to-beat alignment (Prompt 7 R1).

Modular companion to `ref_extractor.py` implementing:
  1. Single linear pass with a low-cost 32x18 per-frame absdiff trace over ALL frames
     (high recall for hard cuts regardless of video duration or stride) combined with
     strided 160px structural/edge-IoU scanning for dark-on-dark / fade transitions.
  2. Exact frame-level hard-cut impulse isolation (separating true 1-frame hard cuts
     from sustained fast camera/object motion and smooth crossfade plateaus).
  3. Window refinement `[candidate - stride, candidate + stride]` for structural cuts.
  4. Policy D1: NEVER shift `evidence == "hard"` cuts toward audio onsets; only snap
     structural/soft cuts while always reporting both `cutSec` and `nearestOnsetSec`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _local_baseline_diff(diffs: np.ndarray, idx: int, half_win: int) -> float:
    n = int(diffs.shape[0])
    lo = max(0, idx - half_win)
    hi = min(n, idx + half_win + 1)
    # Exclude [idx-1, idx, idx+1] so a cut impulse does not inflate its own baseline
    left = diffs[lo : max(lo, idx - 1)]
    right = diffs[min(hi, idx + 2) : hi]
    if left.size == 0 and right.size == 0:
        return 0.0
    if left.size == 0:
        return float(np.median(right))
    if right.size == 0:
        return float(np.median(left))
    return float(np.median(np.concatenate([left, right])))


def _is_sustained_motion_or_fade(diffs: np.ndarray, idx: int) -> bool:
    """Returns True when `diffs[idx]` sits inside a flat plateau (crossfade / continuous motion) rather than an impulse."""
    n = int(diffs.shape[0])
    val = float(diffs[idx])
    neighbors: List[float] = []
    for off in (-3, -2, -1, 1, 2, 3):
        j = idx + off
        if 0 <= j < n:
            neighbors.append(float(diffs[j]))
    if not neighbors:
        return False
    med_nb = float(np.median(neighbors))
    # True hard cut is an impulse: significantly higher than immediate pre/post frames
    immediate = [float(diffs[j]) for j in (idx - 1, idx + 1) if 0 <= j < n]
    min_imm = min(immediate) if immediate else 0.0
    if val < max(med_nb * 2.2, 16.0):
        return True
    if min_imm > 0.0 and val < min_imm * 1.75:
        return True
    return False


def scan_motion_timeline_accurate(
    cap: cv2.VideoCapture,
    total_frames: int,
    fps: float,
    duration: float,
) -> Dict[str, Any]:
    """Full-frame low-cost hard-cut scanner + strided structural shift scanner + window refinement."""
    safe_fps = max(float(fps), 1.0)
    safe_total = max(1, int(total_frames))
    target_step = max(1, int(round(safe_fps / 10.0)))
    stride = max(target_step, (safe_total + 179) // 180)

    samples: List[Tuple[int, float, np.ndarray, np.ndarray, np.ndarray]] = []
    deltas: List[Dict[str, Any]] = []
    structural_jumps: List[Tuple[int, float, str]] = []

    # Per-frame lightweight 32x18 RGB + gray difference trace (index k corresponds to transition (k) -> (k+1), i.e. frame k+1)
    frame_diffs: List[float] = []
    frame_changed: List[float] = []
    prev_tiny: Optional[np.ndarray] = None

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    f_idx = 0
    while f_idx < safe_total:
        ret, frame = cap.read()
        if not ret or frame is None:
            break

        tiny = cv2.resize(frame, (32, 18), interpolation=cv2.INTER_AREA).astype(np.float32)
        if prev_tiny is not None:
            abs_d = np.abs(tiny - prev_tiny)
            frame_diffs.append(float(abs_d.mean()))
            frame_changed.append(float((abs_d.mean(axis=2) > 26.0).mean()))
        prev_tiny = tiny

        if f_idx % stride == 0:
            h, w = frame.shape[:2]
            target_w = 160
            target_h = max(16, int(round(h * (target_w / max(1, w)))))
            small_u8 = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
            small = small_u8.astype(np.float32)
            gray = cv2.cvtColor(small_u8, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 100) > 0

            ts = round(f_idx / safe_fps, 3)
            samples.append((f_idx, ts, small, gray, edges))
            if len(samples) >= 2:
                prev_small = samples[-2][2]
                diff = np.abs(small - prev_small) / 255.0
                score = float(diff.mean())
                changed_ratio = float((diff.mean(axis=2) > 0.12).mean())
                deltas.append({
                    "frame": f_idx,
                    "t": ts,
                    "score": round(score, 4),
                    "changedRatio": round(changed_ratio, 4),
                })

        f_idx += 1

    actual_frames = max(1, f_idx)
    actual_duration = actual_frames / safe_fps if duration <= 0 else float(duration)
    diffs_arr = np.asarray(frame_diffs, dtype=np.float32)
    changed_arr = np.asarray(frame_changed, dtype=np.float32)

    # 1. Exact frame-level hard-cut impulse detection across ALL frames
    hard_candidates: List[Tuple[int, float]] = []
    if diffs_arr.size >= 3:
        half_win = max(6, int(round(0.45 * safe_fps)))
        for k in range(int(diffs_arr.size)):
            val = float(diffs_arr[k])
            chg = float(changed_arr[k])
            if val < 17.5:
                continue
            # Must be strict local max within +-2 frames (ties broken by first frame)
            lo_p = max(0, k - 2)
            hi_p = min(int(diffs_arr.size), k + 3)
            if val < float(np.max(diffs_arr[lo_p:hi_p])) - 1e-6:
                continue
            if k > 0 and val <= float(diffs_arr[k - 1]):
                continue
            local_med = _local_baseline_diff(diffs_arr, k, half_win)
            strong_impulse = (
                (val >= 26.0 and val >= max(local_med * 3.0, 16.0) and chg >= 0.30)
                or (val >= 17.5 and val >= max(local_med * 4.5, 16.0) and chg >= 0.42)
            )
            if not strong_impulse:
                continue
            if _is_sustained_motion_or_fade(diffs_arr, k):
                continue
            cut_frame = k + 1  # transition k -> k+1 lands on frame k+1
            conf = round(float(min(1.0, (val / max(12.0, local_med + 12.0)) / 4.0)), 3)
            hard_candidates.append((cut_frame, max(0.55, conf)))

    # Non-maximum suppression on hard cuts with minimum 0.45s spacing (keeps short valid scenes like 1.07s)
    min_hard_gap = max(2, int(round(0.45 * safe_fps)))
    hard_cuts_frames: List[Tuple[int, float]] = []
    for cf, conf in sorted(hard_candidates, key=lambda x: x[0]):
        t_sec = cf / safe_fps
        if t_sec <= 0.30 or t_sec >= max(0.5, actual_duration - 0.30):
            continue
        if not hard_cuts_frames or (cf - hard_cuts_frames[-1][0]) >= min_hard_gap:
            hard_cuts_frames.append((cf, conf))
        else:
            prev_f, prev_c = hard_cuts_frames[-1]
            prev_val = float(diffs_arr[prev_f - 1]) if 0 < prev_f <= diffs_arr.size else 0.0
            cur_val = float(diffs_arr[cf - 1]) if 0 < cf <= diffs_arr.size else 0.0
            if cur_val > prev_val:
                hard_cuts_frames[-1] = (cf, conf)

    # 2. Dark-on-dark structural / fade-through layout transitions (strided 160px + window refinement)
    if len(samples) >= 7:
        win = min(3, max(1, len(samples) // 8))
        morph_k = np.ones((5, 5), np.uint8)
        for i in range(win, len(samples) - win):
            cur_f, _, _, _, _ = samples[i]
            _, _, a_small, a_gray, a_edges = samples[i - win]
            _, _, b_small, b_gray, b_edges = samples[i + win]

            ea_sum = int(np.sum(a_edges))
            eb_sum = int(np.sum(b_edges))
            if max(ea_sum, eb_sum) < 35:
                continue

            ea_d = cv2.dilate(a_edges.astype(np.uint8), morph_k) > 0
            eb_d = cv2.dilate(b_edges.astype(np.uint8), morph_k) > 0
            denom = float(ea_sum + eb_sum)
            edge_overlap = float(np.sum(a_edges & eb_d) + np.sum(b_edges & ea_d)) / denom

            ga = a_gray.astype(np.float32)
            gb = b_gray.astype(np.float32)
            fg_a = np.abs(ga - np.median(ga)) > 14.0
            fg_b = np.abs(gb - np.median(gb)) > 14.0
            fg_union = int(np.sum(fg_a | fg_b))
            fg_iou = (float(np.sum(fg_a & fg_b)) / fg_union) if fg_union >= 15 else 1.0

            win_delta = float(np.abs(a_small - b_small).mean() / 255.0)
            local_step = float(deltas[i - 1]["score"]) if (i - 1) < len(deltas) else 0.0
            is_fade_pause = (ea_sum >= 80 and eb_sum == 0) or (ea_sum == 0 and eb_sum >= 80)
            med_a = float(np.median(ga))
            med_b = float(np.median(gb))
            same_bright_plate = min(med_a, med_b) >= 90.0 and abs(med_a - med_b) < 16.0
            is_dark_layout_shift = (
                max(med_a, med_b) < 75.0
                and edge_overlap < 0.14
                and fg_iou < 0.14
                and (win_delta > 0.020 or local_step > 0.020 or is_fade_pause)
            )
            is_structural_shift = (
                edge_overlap < 0.22
                and fg_iou < 0.18
                and (
                    is_fade_pause
                    or (not same_bright_plate and (local_step > 0.032 or win_delta > 0.035))
                    or (same_bright_plate and win_delta >= 0.14)
                )
            )
            if is_structural_shift or is_dark_layout_shift:
                # Refine structural candidate within [cur_f - stride, cur_f + stride] using exact frame_diffs
                refined_f = cur_f
                evidence_kind = "structural"
                if diffs_arr.size > 0:
                    w_lo = max(0, cur_f - stride - 1)
                    w_hi = min(int(diffs_arr.size), cur_f + stride)
                    if w_hi > w_lo:
                        sub = diffs_arr[w_lo:w_hi]
                        best_k = w_lo + int(np.argmax(sub))
                        refined_f = best_k + 1
                        peak_v = float(sub[best_k - w_lo])
                        med_v = float(np.median(sub))
                        if peak_v < max(med_v * 1.9, 6.0):
                            evidence_kind = "soft"
                strength = (1.0 - edge_overlap) * 0.5 + (1.0 - fg_iou) * 0.3 + max(local_step, win_delta)
                structural_jumps.append((refined_f, round(strength, 4), evidence_kind))

    # 3. Combine: ALL hard cuts first, then well-separated structural/soft cuts (1.15s spacing)
    min_struct_gap = max(3, int(round(1.15 * safe_fps)))
    combined: List[Dict[str, Any]] = []
    for cf, conf in hard_cuts_frames:
        score_val = float(diffs_arr[cf - 1]) / 255.0 + 1.0 if 0 < cf <= diffs_arr.size else 1.5
        combined.append({
            "frame": int(cf),
            "cutSec": round(cf / safe_fps, 3),
            "evidence": "hard",
            "confidence": round(conf, 3),
            "_rank": score_val,
        })

    for jf, strength, ev_kind in sorted(structural_jumps, key=lambda x: x[1], reverse=True):
        t_sec = jf / safe_fps
        if t_sec <= 0.70 or t_sec >= max(0.5, actual_duration - 0.35):
            continue
        if any(abs(jf - c["frame"]) < min_struct_gap for c in combined):
            continue
        # Do not split an already-short (< 4.2s) interval between two hard cuts with a weak soft cut
        # (prevents chopping a single continuous 3.3s object morph like the glass sphere -> 4-point star in half).
        if ev_kind == "soft" and strength < 0.84:
            prev_hard = max(
                (c["cutSec"] for c in combined if c["evidence"] == "hard" and c["cutSec"] < t_sec),
                default=0.0,
            )
            next_hard = min(
                (c["cutSec"] for c in combined if c["evidence"] == "hard" and c["cutSec"] > t_sec),
                default=actual_duration,
            )
            if prev_hard > 0.0 and next_hard < actual_duration and (next_hard - prev_hard) < 4.20:
                continue
        combined.append({
            "frame": int(jf),
            "cutSec": round(t_sec, 3),
            "evidence": ev_kind,
            "confidence": round(min(0.85, max(0.35, strength * 0.85)), 3),
            "_rank": float(strength),
        })

    combined.sort(key=lambda x: x["frame"])

    # Scale cut ceiling smoothly with duration (~1 scene per ~2.6s, clamped 8..16)
    # while keeping ALL actual hard cuts first.
    hard_count = sum(1 for c in combined if c["evidence"] == "hard")
    dur_cap = max(8, int(round(actual_duration / 2.6)))
    max_total_cuts = max(dur_cap, min(16, max(hard_count, dur_cap)))
    max_total_cuts = min(16, max_total_cuts)
    if len(combined) > max_total_cuts:
        hard_only = [c for c in combined if c["evidence"] == "hard"]
        non_hard = sorted(
            [c for c in combined if c["evidence"] != "hard"],
            key=lambda x: x["_rank"],
            reverse=True,
        )
        slots = max(0, max_total_cuts - len(hard_only))
        combined = sorted(hard_only[:max_total_cuts] + non_hard[:slots], key=lambda x: x["frame"])

    # Fallback balanced beats only if 0 cuts detected and duration >= 4.0s
    if not combined and actual_duration >= 4.0:
        beat_count = 4 if actual_duration >= 10.0 else 3
        for idx in range(1, beat_count):
            t_b = round((actual_duration * idx) / beat_count, 3)
            combined.append({
                "frame": int(round(t_b * safe_fps)),
                "cutSec": t_b,
                "evidence": "soft",
                "confidence": 0.25,
                "_rank": 0.1,
            })

    # Deduplicate cleanly while keeping frame 0
    cuts_out: List[Dict[str, Any]] = [{
        "frame": 0,
        "cutSec": 0.0,
        "evidence": "start",
        "confidence": 1.0,
        "nearestOnsetSec": None,
    }]
    for c in combined:
        if c["cutSec"] - cuts_out[-1]["cutSec"] >= 0.40 and c["cutSec"] < actual_duration - 0.25:
            cuts_out.append({
                "frame": c["frame"],
                "cutSec": round(float(c["cutSec"]), 3),
                "evidence": c["evidence"],
                "confidence": c["confidence"],
                "nearestOnsetSec": None,
            })

    jump_timestamps = [c["cutSec"] for c in cuts_out if c["cutSec"] > 0.0]
    cut_timestamps = [c["cutSec"] for c in cuts_out]

    return {
        "stride": stride,
        "scannedFrames": actual_frames,
        "stridedSamples": len(samples),
        "deltas": deltas,
        "frameDiffs": [round(float(v), 3) for v in frame_diffs],
        "visualJumpTimestamps": jump_timestamps,
        "cutTimestamps": cut_timestamps,
        "cuts": cuts_out,
    }


def align_cuts_with_beats(
    cut_entries: List[Dict[str, Any]],
    beat_times: List[float],
    duration: float,
    max_snap_sec: float = 0.12,
) -> List[Dict[str, Any]]:
    """Policy D1: NEVER shifts hard cuts; snaps only structural/soft cuts and always records nearestOnsetSec."""
    out: List[Dict[str, Any]] = []
    for entry in cut_entries:
        c = dict(entry)
        t = float(c.get("cutSec", 0.0))
        if t <= 0.01:
            c["cutSec"] = 0.0
            c["nearestOnsetSec"] = round(min(beat_times, key=lambda b: abs(b)), 3) if beat_times else None
            out.append(c)
            continue

        nearest: Optional[float] = None
        if beat_times:
            nearest = round(float(min(beat_times, key=lambda b: abs(b - t))), 3)
        c["nearestOnsetSec"] = nearest

        evidence = str(c.get("evidence") or "structural")
        if evidence == "hard" or nearest is None:
            # Hard cuts are frame-exact visual facts: never shift them toward audio onsets
            c["cutSec"] = round(t, 3)
        else:
            cand = nearest if abs(nearest - t) <= max_snap_sec else round(t, 3)
            if cand <= 0.25 or cand >= max(0.5, duration - 0.25):
                cand = round(t, 3)
            if out and (cand - float(out[-1]["cutSec"])) < 0.40:
                cand = round(t, 3)
            c["cutSec"] = cand

        if not out or (float(c["cutSec"]) - float(out[-1]["cutSec"])) >= 0.40:
            out.append(c)

    return out if out else [{
        "frame": 0,
        "cutSec": 0.0,
        "evidence": "start",
        "confidence": 1.0,
        "nearestOnsetSec": None,
    }]
