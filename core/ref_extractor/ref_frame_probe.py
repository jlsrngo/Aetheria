"""On-demand full-resolution reference frame & pixel probe (Smart Per-Scene Harness).

Gives the scene-authoring agent the exact same inspection power as Antigravity:
  - `inspect`: extract full-res frame at any timestamp, with optional zoom-crop `{x,y,w,h}`
  - `sample`:  measure median hex, top dominant cluster hexes, luma/polarity, and tight
               foreground bounding box inside any rectangular region of any frame.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _bgr_to_hex(bgr: np.ndarray) -> str:
    b = int(np.clip(round(float(bgr[0])), 0, 255))
    g = int(np.clip(round(float(bgr[1])), 0, 255))
    r = int(np.clip(round(float(bgr[2])), 0, 255))
    return f"#{r:02X}{g:02X}{b:02X}"


def _luma(bgr: np.ndarray) -> float:
    return float(0.114 * bgr[0] + 0.587 * bgr[1] + 0.299 * bgr[2])


def _read_frame_at_sec(video_path: Path, timestamp_sec: float) -> Tuple[Optional[np.ndarray], Dict[str, Any]]:
    if not video_path.is_file():
        return None, {"error": f"Reference video not found: {video_path}"}
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None, {"error": f"Could not decode reference video: {video_path}"}
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        if not np.isfinite(fps) or fps <= 1.0 or fps > 240.0:
            fps = 30.0
        total_frames = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1))
        duration = total_frames / fps
        clamped_t = max(0.0, min(max(0.0, duration - (1.0 / fps)), float(timestamp_sec)))
        target_idx = max(0, min(total_frames - 1, int(round(clamped_t * fps))))
        cap.set(cv2.CAP_PROP_POS_FRAMES, target_idx)
        ok, frame = cap.read()
        if not ok or frame is None or frame.size == 0:
            return None, {"error": f"Failed to decode frame {target_idx} at {clamped_t:.3f}s"}
        h, w = frame.shape[:2]
        return frame, {
            "width": w,
            "height": h,
            "fps": round(fps, 3),
            "duration": round(duration, 3),
            "frameIndex": target_idx,
            "timestampSec": round(target_idx / fps, 3),
        }
    finally:
        cap.release()


def _clamp_box(
    box: Optional[Tuple[int, int, int, int]], width: int, height: int
) -> Tuple[int, int, int, int]:
    if box is None:
        return (0, 0, width, height)
    x, y, w, h = [int(v) for v in box]
    x = max(0, min(width - 1, x))
    y = max(0, min(height - 1, y))
    w = max(4, min(width - x, w))
    h = max(4, min(height - y, h))
    return (x, y, w, h)


def inspect_reference_frame(
    video_path: Path,
    timestamp_sec: float,
    crop: Optional[Tuple[int, int, int, int]] = None,
    save_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Extracts a full-resolution frame (or zoom-crop) and returns a JPEG data URL."""
    frame, meta = _read_frame_at_sec(video_path, timestamp_sec)
    if frame is None:
        return {"ok": False, "error": meta.get("error", "Frame decode failed")}

    w, h = meta["width"], meta["height"]
    cx, cy, cw, ch = _clamp_box(crop, w, h)
    region = frame[cy : cy + ch, cx : cx + cw]
    # Upscale small zoom crops so tiny icons/glyphs are crisp for vision inspection
    out_img = region
    zoomed = False
    if crop is not None and max(cw, ch) < 420:
        scale = min(3.0, 420.0 / float(max(1, max(cw, ch))))
        out_img = cv2.resize(
            region,
            (max(16, int(round(cw * scale))), max(16, int(round(ch * scale)))),
            interpolation=cv2.INTER_CUBIC,
        )
        zoomed = True

    ok_enc, buf = cv2.imencode(".jpg", out_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok_enc:
        return {"ok": False, "error": "Failed to JPEG-encode extracted frame"}
    jpeg_bytes = buf.tobytes()
    if save_path is not None:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_bytes(jpeg_bytes)

    data_url = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")
    return {
        "ok": True,
        "timestampSec": meta["timestampSec"],
        "frameIndex": meta["frameIndex"],
        "canvasWidth": w,
        "canvasHeight": h,
        "crop": [cx, cy, cw, ch],
        "zoomed": zoomed,
        "outputWidth": int(out_img.shape[1]),
        "outputHeight": int(out_img.shape[0]),
        "savedPath": str(save_path) if save_path else None,
        "dataUrl": data_url,
    }


def inspect_reference_motion_strip(
    video_path: Path,
    start_sec: float,
    end_sec: float,
    num_frames: int = 8,
    crop: Optional[Tuple[int, int, int, int]] = None,
    save_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Extracts a 1-image chronological micro-strip (`num_frames` tiles across `[start_sec, end_sec]`)
    so the agent sees exact frame-by-frame motion, deformation, and cross-scene continuity in 1 call."""
    count = max(2, min(16, int(num_frames)))
    t0 = max(0.0, float(start_sec))
    t1 = max(t0 + 0.04, float(end_sec))
    timestamps = [round(t0 + (t1 - t0) * (i / float(count - 1)), 3) for i in range(count)]

    tiles: List[np.ndarray] = []
    meta_first: Optional[Dict[str, Any]] = None
    used_crop = [0, 0, 0, 0]
    for ts in timestamps:
        fr, meta = _read_frame_at_sec(video_path, ts)
        if fr is None:
            continue
        if meta_first is None:
            meta_first = meta
        w, h = meta["width"], meta["height"]
        cx, cy, cw, ch = _clamp_box(crop, w, h)
        used_crop = [cx, cy, cw, ch]
        roi = fr[cy : cy + ch, cx : cx + cw]
        tile_w = 240 if cw <= ch else 320
        tile_h = max(120, min(420, int(round(tile_w * (ch / float(max(1, cw)))))))
        tile = cv2.resize(roi, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
        cv2.rectangle(tile, (0, 0), (102, 24), (8, 8, 12), -1)
        cv2.putText(
            tile,
            f"{meta['timestampSec']:.2f}s",
            (6, 17),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        tiles.append(tile)

    if not tiles or meta_first is None:
        return {"ok": False, "error": "Failed to decode frames for motion micro-strip"}

    cols = 4 if len(tiles) <= 8 else 6
    rows = (len(tiles) + cols - 1) // cols
    th, tw = tiles[0].shape[:2]
    grid = np.full((rows * th, cols * tw, 3), 10, dtype=np.uint8)
    for idx, tile in enumerate(tiles):
        r, c = divmod(idx, cols)
        grid[r * th : (r + 1) * th, c * tw : (c + 1) * tw] = tile

    ok_enc, buf = cv2.imencode(".jpg", grid, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok_enc:
        return {"ok": False, "error": "Failed to JPEG-encode motion micro-strip"}
    jpeg_bytes = buf.tobytes()
    if save_path is not None:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_bytes(jpeg_bytes)

    data_url = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")
    return {
        "ok": True,
        "isMotionStrip": True,
        "startSec": timestamps[0],
        "endSec": timestamps[-1],
        "framesCount": len(tiles),
        "timestamps": timestamps,
        "canvasWidth": meta_first["width"],
        "canvasHeight": meta_first["height"],
        "crop": used_crop,
        "outputWidth": int(grid.shape[1]),
        "outputHeight": int(grid.shape[0]),
        "dataUrl": data_url,
    }


def sample_reference_region(
    video_path: Path,
    timestamp_sec: float,
    box: Optional[Tuple[int, int, int, int]] = None,
) -> Dict[str, Any]:
    """Measures exact colors, luminance, polarity, and tight foreground bbox in a frame region."""
    frame, meta = _read_frame_at_sec(video_path, timestamp_sec)
    if frame is None:
        return {"ok": False, "error": meta.get("error", "Frame decode failed")}

    w, h = meta["width"], meta["height"]
    bx, by, bw, bh = _clamp_box(box, w, h)
    roi = frame[by : by + bh, bx : bx + bw]

    # Sample border & overall color statistics
    b_strip = max(1, min(6, min(bw, bh) // 8))
    border_px = np.vstack([
        roi[:b_strip, :, :].reshape(-1, 3),
        roi[-b_strip:, :, :].reshape(-1, 3),
        roi[:, :b_strip, :].reshape(-1, 3),
        roi[:, -b_strip:, :].reshape(-1, 3),
    ])
    border_bgr = np.median(border_px, axis=0)
    median_bgr = np.median(roi.reshape(-1, 3), axis=0)
    mean_luma = round(float(np.mean(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY))), 1)

    # Dominant color clusters via K-means on downsampled ROI
    small = cv2.resize(roi, (min(96, bw), min(96, bh)), interpolation=cv2.INTER_AREA)
    pts = np.float32(small.reshape(-1, 3))
    k = min(5, max(1, len(pts)))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
    cv2.setRNGSeed(42)
    _, labels, centers = cv2.kmeans(pts, k, None, criteria, 4, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k)
    order = np.argsort(-counts)
    total_px = float(max(1, len(pts)))
    dominant: List[Dict[str, Any]] = []
    for idx in order:
        ratio = round(float(counts[idx]) / total_px, 3)
        if ratio >= 0.02:
            dominant.append({"hex": _bgr_to_hex(centers[idx]), "ratio": ratio})

    # Tight foreground bounding box relative to border color (in full canvas coords)
    diff = np.linalg.norm(roi.astype(np.float32) - border_bgr.astype(np.float32), axis=2)
    fg_mask = diff >= 24.0
    fg_box = None
    fg_coverage = round(float(np.mean(fg_mask)), 3)
    if np.any(fg_mask):
        ys, xs = np.where(fg_mask)
        fx0, fx1 = int(xs.min()), int(xs.max()) + 1
        fy0, fy1 = int(ys.min()), int(ys.max()) + 1
        fg_box = [bx + fx0, by + fy0, fx1 - fx0, fy1 - fy0]

    return {
        "ok": True,
        "timestampSec": meta["timestampSec"],
        "frameIndex": meta["frameIndex"],
        "canvasWidth": w,
        "canvasHeight": h,
        "sampledBox": [bx, by, bw, bh],
        "medianHex": _bgr_to_hex(median_bgr),
        "borderHex": _bgr_to_hex(border_bgr),
        "meanLuma": mean_luma,
        "isDark": bool(_luma(border_bgr) < 120.0),
        "dominantColors": dominant,
        "foregroundCoverage": fg_coverage,
        "foregroundBox": fg_box,
    }


def _parse_box(raw: Optional[str]) -> Optional[Tuple[int, int, int, int]]:
    if not raw or not raw.strip():
        return None
    parts = [int(round(float(p.strip()))) for p in raw.split(",")]
    if len(parts) != 4:
        raise ValueError(f"Expected 4 comma-separated numbers x,y,w,h, got: {raw}")
    return (parts[0], parts[1], parts[2], parts[3])


def main() -> None:
    parser = argparse.ArgumentParser(description="On-demand reference frame & pixel probe")
    parser.add_argument("mode", choices=["inspect", "sample"])
    parser.add_argument("--video", required=True, type=str)
    parser.add_argument("--t", required=True, type=float)
    parser.add_argument("--end-t", type=float, default=None, help="Optional end timestamp for multi-frame motion micro-strip")
    parser.add_argument("--frames", type=int, default=8, help="Number of frames in motion micro-strip (2..16)")
    parser.add_argument("--box", type=str, default=None, help="Optional x,y,w,h crop/sample box")
    parser.add_argument("--out", type=str, default=None, help="Optional JPEG output path (inspect mode)")
    args = parser.parse_args()

    try:
        box = _parse_box(args.box)
        if args.mode == "inspect":
            if args.end_t is not None and float(args.end_t) > float(args.t) + 0.04:
                res = inspect_reference_motion_strip(
                    Path(args.video),
                    args.t,
                    float(args.end_t),
                    num_frames=args.frames,
                    crop=box,
                    save_path=Path(args.out) if args.out else None,
                )
            else:
                res = inspect_reference_frame(
                    Path(args.video),
                    args.t,
                    crop=box,
                    save_path=Path(args.out) if args.out else None,
                )
        else:
            res = sample_reference_region(Path(args.video), args.t, box=box)
        print(json.dumps(res))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
