"""Adaptive per-scene beat-strip panel selector (Prompt 7 R3).

Replaces uniform fixed-ratio sampling (`sub_ts_list[1:7]`) with motion- and camera-aware
panel selection (max 6 panels, chronological) that ALWAYS covers:
  1. First frame after exact scene cut (`scene-start`, <= 0.15s from cut)
  2. Last frame before next cut (`scene-end`, capturing late climax / transitions)
  3. Peak global camera-motion change (`camera-peak` / `camera-climax`) when present
  4. Peak intra-scene pixel motion energy (`motion-peak`) from per-frame diffs
  5. Largest-gap midpoint fills (`mid-pacing`) up to `max_panels` (<= 6)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np


def _clamp_frame(idx: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(idx)))


def select_adaptive_beat_strip_panels(
    start_sec: float,
    end_sec: float,
    fps: float,
    total_frames: int,
    frame_diffs: Optional[List[float]] = None,
    camera_motion: Optional[Dict[str, Any]] = None,
    max_panels: int = 6,
    cached_frame_indices: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """Selects up to `max_panels` chronological panels `{ t, frame, reason }` for a scene."""
    safe_fps = max(float(fps), 1.0)
    safe_total = max(1, int(total_frames))
    dur = max(0.05, float(end_sec) - float(start_sec))

    # Strict interior bounds: first frame after exact cut, last frame before next cut
    f_cut_start = _clamp_frame(int(round(start_sec * safe_fps)), 0, safe_total - 1)
    f_cut_end = _clamp_frame(int(round(end_sec * safe_fps)), f_cut_start, safe_total)
    f_first = _clamp_frame(f_cut_start + 1 if f_cut_end - f_cut_start >= 3 else f_cut_start, 0, safe_total - 1)
    f_last = _clamp_frame(f_cut_end - 1 if f_cut_end > f_first else f_first, f_first, safe_total - 1)

    if f_last <= f_first:
        return [{"t": round(f_first / safe_fps, 3), "frame": f_first, "reason": "scene-start"}]

    target_count = min(max(2, int(max_panels)), 6 if dur >= 1.2 else 4)
    # Minimum separation between adaptive event picks (~45ms: distinct visual frames even during tight late zooms)
    event_min_gap_f = max(1, int(round(0.045 * safe_fps)))

    selected: List[Dict[str, Any]] = [
        {"t": round(f_first / safe_fps, 3), "frame": f_first, "reason": "scene-start"},
        {"t": round(f_last / safe_fps, 3), "frame": f_last, "reason": "scene-end"},
    ]

    def _try_add(frame_idx: int, reason: str, min_gap_f: int) -> bool:
        if len(selected) >= target_count:
            return False
        clamped = _clamp_frame(frame_idx, f_first, f_last)
        if any(abs(p["frame"] - clamped) < min_gap_f for p in selected):
            return False
        selected.append({
            "t": round(clamped / safe_fps, 3),
            "frame": clamped,
            "reason": reason,
        })
        return True

    # 1. Camera-motion peak change & late climax (85% of active camera segment; fallback 65% if peak overlaps scene-end)
    if camera_motion and isinstance(camera_motion, dict):
        active_segs = [
            s for s in (camera_motion.get("segments") or [])
            if s.get("confidence") != "low"
        ]
        if active_segs:
            added_cam = False
            peak_sec = camera_motion.get("peakChangeSec")
            if isinstance(peak_sec, (int, float)):
                added_cam = _try_add(int(round(float(peak_sec) * safe_fps)), "camera-peak", event_min_gap_f) or added_cam
            seg = active_segs[0]
            t0 = float(seg.get("t0", 0.0))
            t1 = float(seg.get("t1", dur))
            if t1 > t0 + 0.06:
                climax_sec = start_sec + t0 + 0.85 * (t1 - t0)
                added_cam = _try_add(int(round(climax_sec * safe_fps)), "camera-climax", event_min_gap_f) or added_cam
                if not added_cam:
                    mid_cam_sec = start_sec + t0 + 0.65 * (t1 - t0)
                    _try_add(int(round(mid_cam_sec * safe_fps)), "camera-peak", event_min_gap_f)

    # 2. Peak intra-scene motion energy from per-frame absdiff trace
    if frame_diffs and len(frame_diffs) > f_first + 1:
        lo_d = min(len(frame_diffs) - 1, f_first + 1)
        hi_d = min(len(frame_diffs), max(lo_d + 1, f_last - 1))
        if hi_d > lo_d:
            seg_d = np.asarray(frame_diffs[lo_d:hi_d], dtype=np.float32)
            if seg_d.size > 0:
                med_d = float(np.median(seg_d))
                peak_rel = int(np.argmax(seg_d))
                peak_val = float(seg_d[peak_rel])
                if peak_val >= max(1.0, med_d * 1.35):
                    # frame_diffs[k] measures transition k -> k+1, so land on frame k+1
                    _try_add(lo_d + peak_rel + 1, "motion-peak", event_min_gap_f)

    def _snap_to_cached(frame_idx: int, max_delta_f: int) -> int:
        if not cached_frame_indices:
            return frame_idx
        if frame_idx in cached_frame_indices:
            return frame_idx
        best_f = frame_idx
        best_d = max_delta_f + 1
        for cf in cached_frame_indices:
            if f_first <= cf <= f_last:
                d = abs(cf - frame_idx)
                if d < best_d:
                    best_d = d
                    best_f = cf
        return best_f

    # 3. Fill remaining slots up to target_count by bisecting the largest temporal gap
    fill_min_gap_f = max(2, int(round((f_last - f_first) / float(max(2, target_count * 2)))))
    cached_snap_f = max(2, int(round(0.14 * safe_fps)))
    while len(selected) < target_count:
        selected.sort(key=lambda p: p["frame"])
        best_gap = -1
        best_mid = None
        for idx in range(len(selected) - 1):
            a_f = selected[idx]["frame"]
            b_f = selected[idx + 1]["frame"]
            gap = b_f - a_f
            if gap > best_gap:
                best_gap = gap
                best_mid = (a_f + b_f) // 2
        if best_mid is None or best_gap < max(2, fill_min_gap_f):
            break
        snapped_mid = _snap_to_cached(best_mid, min(cached_snap_f, max(1, best_gap // 3)))
        if not _try_add(snapped_mid, "mid-pacing", 1):
            if not _try_add(best_mid, "mid-pacing", 1):
                break

    selected.sort(key=lambda p: p["frame"])
    return selected[:max_panels]
