"""Deterministic 1/1 Video Filmstrip Generator (10 frames per sheet).

Performs a single sequential decode pass over all frames in a video and packs chronological
contact sheets (10 frames per image: 5x2 portrait or 2x5 landscape, <= 1280px longest edge)
alongside `filmstrip_index.json` mapping sheets, timestamps, per-frame motion deltas, and scenes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _compute_motion_bursts(
    frames_meta: List[Tuple[int, float, float]],
    fps: float,
    mean_delta: float,
) -> List[Dict[str, Any]]:
    """Finds contiguous temporal bursts where per-frame delta is elevated."""
    if len(frames_meta) < 2:
        return []
    thresh = max(0.8, 0.35 * max(mean_delta, 1.2))
    bursts: List[Dict[str, Any]] = []
    cur_start: Optional[float] = None
    cur_end: float = 0.0
    cur_peak: float = 0.0
    gap_tol = 2.5 / max(1.0, fps)

    for _, t_sec, d_val in frames_meta:
        if d_val >= thresh:
            if cur_start is None:
                cur_start = t_sec
                cur_end = t_sec
                cur_peak = d_val
            elif t_sec - cur_end <= gap_tol:
                cur_end = t_sec
                if d_val > cur_peak:
                    cur_peak = d_val
            else:
                bursts.append({
                    "tStart": round(cur_start, 2),
                    "tEnd": round(cur_end, 2),
                    "peakDelta": round(cur_peak, 2),
                })
                cur_start = t_sec
                cur_end = t_sec
                cur_peak = d_val
        elif cur_start is not None and (t_sec - cur_end) > gap_tol:
            bursts.append({
                "tStart": round(cur_start, 2),
                "tEnd": round(cur_end, 2),
                "peakDelta": round(cur_peak, 2),
            })
            cur_start = None

    if cur_start is not None:
        bursts.append({
            "tStart": round(cur_start, 2),
            "tEnd": round(cur_end, 2),
            "peakDelta": round(cur_peak, 2),
        })
    return bursts[:12]


def _resolve_sheet_geometry(aspect_w: int, aspect_h: int, frames_per_sheet: int) -> Tuple[int, int, int, int]:
    """Returns `(cols, rows, tile_w, tile_h)` kept within 1280px longest edge."""
    portrait = aspect_h > aspect_w
    ratio = float(max(1, aspect_h)) / float(max(1, aspect_w))
    if portrait:
        cols = 5
        rows = max(1, (frames_per_sheet + cols - 1) // cols)
        tile_w = 240
        tile_h = max(120, min(560, int(round(tile_w * ratio))))
        if rows * tile_h > 1280:
            tile_h = 1280 // rows
            tile_w = max(80, int(round(tile_h / ratio)))
    else:
        cols = 2
        rows = max(1, (frames_per_sheet + cols - 1) // cols)
        tile_w = 384
        tile_h = max(96, min(384, int(round(tile_w * ratio))))
        if rows * tile_h > 1280:
            tile_h = 1280 // rows
            tile_w = max(96, int(round(tile_h / ratio)))
        if cols * tile_w > 1280:
            tile_w = 1280 // cols
            tile_h = max(96, int(round(tile_w * ratio)))
    return cols, rows, tile_w, tile_h


def _stamp_tile(
    frame_bgr: np.ndarray,
    tile_w: int,
    tile_h: int,
    entry: Dict[str, Any],
) -> np.ndarray:
    sm = cv2.resize(frame_bgr, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
    is_hold = bool(entry.get("isHold"))
    bar_h = 22
    if is_hold:
        f_a = int(entry["frameStart"])
        f_b = int(entry["frameEnd"])
        dur_s = float(entry["holdSec"])
        label = f"HOLD f{f_a}-f{f_b} {dur_s:.2f}s"
        cv2.rectangle(sm, (0, 0), (tile_w, bar_h), (24, 92, 168), -1)
        cv2.putText(sm, label[:26], (5, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.39, (255, 245, 220), 1, cv2.LINE_AA)
    else:
        f_idx = int(entry["frame"])
        t_sec = float(entry["t"])
        d_val = float(entry["delta"])
        label = f"f{f_idx:04d} {t_sec:.2f}s d{d_val:.1f}"
        cv2.rectangle(sm, (0, 0), (min(tile_w, 168), bar_h), (10, 10, 14), -1)
        cv2.putText(sm, label[:24], (4, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (245, 245, 250), 1, cv2.LINE_AA)
    return sm


def _select_kept_tiles(
    decoded_frames: List[np.ndarray],
    deltas: List[float],
    fps: float,
    scene_ranges: List[Tuple[int, str, float, float, int, int]],
    mode: str,
    hold_eps: float,
) -> Tuple[List[Dict[str, Any]], List[int]]:
    """Builds the ordered list of kept tile descriptors plus the scene index for each frame."""
    n = len(decoded_frames)
    frame_to_scene = [0] * n
    boundary_frames = {0, max(0, n - 1)}
    for sc_idx, _, _, _, fs, fe in scene_ranges:
        lo = max(0, min(n - 1, fs))
        hi = max(lo, min(n - 1, fe))
        for f in range(lo, hi + 1):
            frame_to_scene[f] = sc_idx
        boundary_frames.add(lo)
        boundary_frames.add(max(lo, hi - 1))

    def _raw_entry(f_idx: int) -> Dict[str, Any]:
        return {
            "kind": "frame",
            "isHold": False,
            "frame": f_idx,
            "frameStart": f_idx,
            "frameEnd": f_idx,
            "t": round(f_idx / fps, 3),
            "tStart": round(f_idx / fps, 3),
            "tEnd": round(f_idx / fps, 3),
            "delta": round(deltas[f_idx], 3),
            "sceneIndex": frame_to_scene[f_idx],
            "tile": None,
        }

    kept: List[Dict[str, Any]] = []
    if mode == "raw":
        for f_idx in range(n):
            kept.append(_raw_entry(f_idx))
        return kept, frame_to_scene

    f_idx = 0
    while f_idx < n:
        if f_idx in boundary_frames or deltas[f_idx] >= hold_eps:
            kept.append(_raw_entry(f_idx))
            f_idx += 1
            continue

        sc = frame_to_scene[f_idx]
        run_start = f_idx
        run_end = f_idx
        while (
            run_end + 1 < n
            and (run_end + 1) not in boundary_frames
            and frame_to_scene[run_end + 1] == sc
            and deltas[run_end + 1] < hold_eps
        ):
            run_end += 1

        run_len = run_end - run_start + 1
        if run_len >= 3:
            kept.append({
                "kind": "hold",
                "isHold": True,
                "frame": run_start,
                "frameStart": run_start,
                "frameEnd": run_end,
                "t": round(run_start / fps, 3),
                "tStart": round(run_start / fps, 3),
                "tEnd": round(run_end / fps, 3),
                "holdSec": round(run_len / fps, 3),
                "delta": round(float(np.mean(deltas[run_start : run_end + 1])), 3),
                "sceneIndex": sc,
                "tile": None,
            })
            f_idx = run_end + 1
        else:
            for k in range(run_start, run_end + 1):
                kept.append(_raw_entry(k))
            f_idx = run_end + 1

    return kept, frame_to_scene


def generate_filmstrips(
    video_path: Path,
    out_dir: Path,
    scenes: List[Dict[str, Any]],
    mode: str = "raw",
    frames_per_sheet: int = 10,
    hold_eps: float = 0.15,
) -> Dict[str, Any]:
    """Extracts deterministic 1/1 filmstrip sheets (10 frames per sheet) and `filmstrip_index.json`."""
    norm_mode = "raw" if str(mode).strip().lower() == "raw" else "smart"
    per_sheet = max(2, min(20, int(frames_per_sheet)))
    eps = max(0.01, float(hold_eps))

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {"ok": False, "error": f"Could not open video for filmstrip extraction: {video_path}"}

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        if not np.isfinite(fps) or fps <= 1.0 or fps > 240.0:
            fps = 30.0
        aspect_w = max(16, int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 720))
        aspect_h = max(16, int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1280))
        cols, rows, tile_w, tile_h = _resolve_sheet_geometry(aspect_w, aspect_h, per_sheet)

        proxy_w = 180 if aspect_h > aspect_w else 320
        proxy_h = 320 if aspect_h > aspect_w else 180

        decoded_tiles: List[np.ndarray] = []
        deltas: List[float] = []
        prev_gray: Optional[np.ndarray] = None

        # Single sequential decode pass: resize straight to compact sheet tile size so memory stays modest.
        while True:
            ok, frame = cap.read()
            if not ok or frame is None or frame.size == 0:
                break
            sm_gray = cv2.cvtColor(
                cv2.resize(frame, (proxy_w, proxy_h), interpolation=cv2.INTER_AREA),
                cv2.COLOR_BGR2GRAY,
            ).astype(np.float32)
            if prev_gray is None:
                deltas.append(99.0)
            else:
                deltas.append(float(np.mean(np.abs(sm_gray - prev_gray))))
            prev_gray = sm_gray
            tile_bgr = cv2.resize(frame, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
            decoded_tiles.append(tile_bgr)
    finally:
        cap.release()

    total_frames = len(decoded_tiles)
    if total_frames == 0:
        return {"ok": False, "error": f"No frames decoded from video: {video_path}"}

    scene_ranges: List[Tuple[int, str, float, float, int, int]] = []
    for idx, s in enumerate(scenes or []):
        sc_idx = int(s.get("index") or (idx + 1))
        sc_id = str(s.get("id") or f"scene{sc_idx}")
        st = float(s.get("start") or 0.0)
        en = float(s.get("end") or (st + float(s.get("duration") or 0.5)))
        fs = max(0, min(total_frames - 1, int(round(st * fps))))
        fe = max(fs, min(total_frames - 1, int(round(en * fps)) - 1))
        if idx == len(scenes) - 1:
            fe = total_frames - 1
        scene_ranges.append((sc_idx, sc_id, round(st, 3), round(en, 3), fs, fe))
    if not scene_ranges:
        scene_ranges = [(1, "scene1", 0.0, round(total_frames / fps, 3), 0, total_frames - 1)]

    kept_entries, frame_to_scene = _select_kept_tiles(
        decoded_tiles, deltas, fps, scene_ranges, norm_mode, eps
    )

    strips_dir = out_dir / "filmstrips"
    vision_dir = out_dir / "vision" / "filmstrips"
    strips_dir.mkdir(parents=True, exist_ok=True)
    vision_dir.mkdir(parents=True, exist_ok=True)

    sheets_meta: List[Dict[str, Any]] = []
    sheet_for_scene: Dict[int, set] = {sc[0]: set() for sc in scene_ranges}
    tile_count_for_scene: Dict[int, int] = {sc[0]: 0 for sc in scene_ranges}

    for sheet_idx, offset in enumerate(range(0, len(kept_entries), per_sheet), 1):
        chunk = kept_entries[offset : offset + per_sheet]
        canvas = np.full((rows * tile_h, cols * tile_w, 3), (12, 12, 16), dtype=np.uint8)
        sheet_scenes = set()
        sheet_deltas: List[float] = []
        has_hold = False
        for i, entry in enumerate(chunk):
            r, c = divmod(i, cols)
            raw_tile = decoded_tiles[int(entry["frame"])]
            stamped = _stamp_tile(raw_tile, tile_w, tile_h, entry)
            canvas[r * tile_h : (r + 1) * tile_h, c * tile_w : (c + 1) * tile_w] = stamped
            sc = int(entry["sceneIndex"])
            if sc > 0:
                sheet_scenes.add(sc)
                sheet_for_scene.setdefault(sc, set()).add(sheet_idx)
                tile_count_for_scene[sc] = tile_count_for_scene.get(sc, 0) + 1
            if entry["frame"] > 0:
                sheet_deltas.append(float(entry["delta"]))
            if entry.get("isHold"):
                has_hold = True

        fname = f"sheet_{sheet_idx:03d}.jpg"
        cv2.imwrite(str(strips_dir / fname), canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 86])
        cv2.imwrite(str(vision_dir / fname), canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 84])
        sheets_meta.append({
            "sheetIndex": sheet_idx,
            "relPath": f"filmstrips/{fname}",
            "visionRelPath": f"vision/filmstrips/{fname}",
            "frameStart": int(chunk[0]["frameStart"]),
            "frameEnd": int(chunk[-1]["frameEnd"]),
            "tStart": float(chunk[0]["tStart"]),
            "tEnd": float(chunk[-1]["tEnd"]),
            "tileCount": len(chunk),
            "meanDelta": round(float(np.mean(sheet_deltas)) if sheet_deltas else 0.0, 3),
            "maxDelta": round(float(np.max(sheet_deltas)) if sheet_deltas else 0.0, 3),
            "hasHold": has_hold,
            "sceneIndices": sorted(sheet_scenes),
        })

    interior_deltas = np.asarray(deltas[1:] if len(deltas) > 1 else [0.0], dtype=np.float32)
    video_stats = {
        "meanDelta": round(float(np.mean(interior_deltas)), 3),
        "medianDelta": round(float(np.median(interior_deltas)), 3),
        "staticFramesPct": round(float(np.mean(interior_deltas < 0.35) * 100.0), 1),
        "nearZeroPct": round(float(np.mean(interior_deltas < 0.08) * 100.0), 1),
    }

    scenes_meta: List[Dict[str, Any]] = []
    for sc_idx, sc_id, st, en, fs, fe in scene_ranges:
        sc_frames_meta: List[Tuple[int, float, float]] = []
        sc_deltas: List[float] = []
        for f in range(max(1, fs + 1), min(total_frames, fe + 1)):
            d = deltas[f]
            sc_frames_meta.append((f, f / fps, d))
            sc_deltas.append(d)
        sc_arr = np.asarray(sc_deltas if sc_deltas else [0.0], dtype=np.float32)
        sc_mean = float(np.mean(sc_arr))
        sc_sheets = sorted(sheet_for_scene.get(sc_idx, set()))
        scenes_meta.append({
            "index": sc_idx,
            "id": sc_id,
            "start": st,
            "end": en,
            "frameStart": fs,
            "frameEnd": fe,
            "sheetIndices": sc_sheets,
            "sheetPaths": [f"filmstrips/sheet_{s:03d}.jpg" for s in sc_sheets],
            "tileCount": tile_count_for_scene.get(sc_idx, 0),
            "meanDelta": round(sc_mean, 3),
            "medianDelta": round(float(np.median(sc_arr)), 3),
            "staticPct": round(float(np.mean(sc_arr < 0.35) * 100.0), 1),
            "nearZeroPct": round(float(np.mean(sc_arr < 0.08) * 100.0), 1),
            "activeBursts": _compute_motion_bursts(sc_frames_meta, fps, sc_mean),
        })

    payload: Dict[str, Any] = {
        "ok": True,
        "version": 1,
        "mode": norm_mode,
        "framesPerSheet": per_sheet,
        "holdEps": eps,
        "fps": round(fps, 3),
        "width": aspect_w,
        "height": aspect_h,
        "sheetWidth": cols * tile_w,
        "sheetHeight": rows * tile_h,
        "totalFrames": total_frames,
        "keptTiles": len(kept_entries),
        "sheetCount": len(sheets_meta),
        "videoMotionStats": video_stats,
        "sheets": sheets_meta,
        "scenes": scenes_meta,
    }
    idx_path = out_dir / "filmstrip_index.json"
    idx_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    payload["indexPath"] = str(idx_path)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic 1/1 10-frame filmstrip sheets.")
    parser.add_argument("video", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--mode", choices=["smart", "raw"], default="raw")
    parser.add_argument("--frames-per-sheet", type=int, default=10)
    parser.add_argument("--hold-eps", type=float, default=0.15)
    args = parser.parse_args()

    scenes: List[Dict[str, Any]] = []
    style_path = args.out_dir / "style.json"
    if style_path.is_file():
        try:
            scenes = json.loads(style_path.read_text(encoding="utf-8")).get("scenes") or []
        except Exception:
            scenes = []

    res = generate_filmstrips(
        args.video,
        args.out_dir,
        scenes=scenes,
        mode=args.mode,
        frames_per_sheet=args.frames_per_sheet,
        hold_eps=args.hold_eps,
    )
    print(json.dumps({k: v for k, v in res.items() if k != "sheets"}, indent=2))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
