"""Synthetic reference video generator for offline/unit accuracy evaluation (Prompt 7 R0).

Generates deterministic MP4 clips with exact known ground truth (hard cuts, soft
crossfades, camera zoom/rotation/pan following `AM.applyCamera` sign conventions,
tile-wall backgrounds in both dark and light polarities, and negative controls).
Never imports or touches any benchmark assets.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _eval_ease(name: str, u: float) -> float:
    x = max(0.0, min(1.0, float(u)))
    if name == "inCubic":
        return x * x * x
    if name == "outCubic":
        return 1.0 - (1.0 - x) ** 3
    if name == "inOutCubic":
        return 4.0 * x * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 3) / 2.0
    return x


def apply_camera_affine_matrix(
    s: float,
    cx: float,
    cy: float,
    rot_deg: float,
    width: int,
    height: int,
) -> np.ndarray:
    """Exact 2x3 OpenCV affine matrix equivalent to `AM.applyCamera(ctx, {s, cx, cy, rot}, W, H)`."""
    rad = math.radians(float(rot_deg))
    c = math.cos(rad)
    sn = math.sin(rad)
    a = float(s) * c
    b = -float(s) * sn
    cc = float(s) * sn
    d = float(s) * c
    tx = (width * 0.5) - (a * cx + b * cy)
    ty = (height * 0.5) - (cc * cx + d * cy)
    return np.array([[a, b, tx], [cc, d, ty]], dtype=np.float64)


def apply_camera_to_frame(
    src_bgr: np.ndarray,
    s: float,
    cx: float,
    cy: float,
    rot_deg: float,
    border_bgr: Tuple[int, int, int] = (14, 14, 18),
) -> np.ndarray:
    """Warps a textured BGR frame using the exact `AM.applyCamera` matrix."""
    h, w = src_bgr.shape[:2]
    mat = apply_camera_affine_matrix(s, cx, cy, rot_deg, w, h)
    return cv2.warpAffine(
        src_bgr,
        mat,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border_bgr,
    )


def make_textured_canvas(
    width: int,
    height: int,
    seed: int = 101,
    bg_bgr: Tuple[int, int, int] = (20, 22, 28),
) -> np.ndarray:
    """Builds a crisp, high-feature synthetic motion-graphics poster frame for reliable ORB tracking."""
    rng = np.random.default_rng(seed)
    img = np.full((height, width, 3), bg_bgr, dtype=np.uint8)

    # Subtle geometric grid lines
    step = max(36, min(width, height) // 10)
    grid_col = tuple(min(255, int(c) + 22) for c in bg_bgr)
    for x in range(step // 2, width, step):
        cv2.line(img, (x, 0), (x, height), grid_col, 1, cv2.LINE_AA)
    for y in range(step // 2, height, step):
        cv2.line(img, (0, y), (width, y), grid_col, 1, cv2.LINE_AA)

    palette = [
        (242, 240, 236),
        (235, 130, 62),
        (110, 215, 245),
        (140, 90, 238),
        (95, 218, 152),
        (80, 175, 245),
    ]
    # Draw crisp geometric shapes & glyphs across the full frame (avoiding only near-black emptiness)
    n_shapes = 48
    for i in range(n_shapes):
        col = palette[i % len(palette)]
        cx = int(rng.integers(int(width * 0.06), int(width * 0.94)))
        cy = int(rng.integers(int(height * 0.06), int(height * 0.94)))
        r = int(rng.integers(14, max(22, min(width, height) // 11)))
        kind = i % 4
        if kind == 0:
            cv2.rectangle(img, (cx - r, cy - r // 2), (cx + r, cy + r // 2), col, -1)
            cv2.rectangle(img, (cx - r, cy - r // 2), (cx + r, cy + r // 2), (255, 255, 255), 2)
        elif kind == 1:
            pts = np.array(
                [[cx, cy - r], [cx + r, cy + r], [cx - r, cy + r]], dtype=np.int32
            )
            cv2.fillPoly(img, [pts], col)
            cv2.polylines(img, [pts], True, (18, 18, 22), 2, cv2.LINE_AA)
        elif kind == 2:
            cv2.circle(img, (cx, cy), r, col, -1, cv2.LINE_AA)
            cv2.circle(img, (cx, cy), max(4, r // 2), bg_bgr, 2, cv2.LINE_AA)
        else:
            cv2.putText(
                img,
                f"M{i:02d}",
                (cx - r, cy + r // 3),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                col,
                2,
                cv2.LINE_AA,
            )

    # Corner calibration crosses + crisp center headline plaque
    cv2.rectangle(
        img,
        (int(width * 0.28), int(height * 0.38)),
        (int(width * 0.72), int(height * 0.62)),
        (244, 242, 238),
        -1,
    )
    cv2.rectangle(
        img,
        (int(width * 0.28), int(height * 0.38)),
        (int(width * 0.72), int(height * 0.62)),
        (36, 36, 42),
        3,
    )
    cv2.putText(
        img,
        f"SCENE {seed}",
        (int(width * 0.33), int(height * 0.53)),
        cv2.FONT_HERSHEY_SIMPLEX,
        max(0.8, width / 900.0),
        (22, 22, 28),
        3,
        cv2.LINE_AA,
    )
    return img


def make_tile_wall_frame(
    width: int,
    height: int,
    gap_bgr: Tuple[int, int, int],
    light_bgr: Tuple[int, int, int],
    dark_bgr: Tuple[int, int, int],
    cols: int = 6,
    rows: int = 3,
    gap_px: int = 12,
    tilt_deg: float = -2.8,
    reveal_frac: float = 1.0,
) -> np.ndarray:
    """Generates a high-contrast tile-wall frame over a true gap/backdrop color."""
    img = np.full((height, width, 3), gap_bgr, dtype=np.uint8)
    pitch_x = width / float(cols)
    pitch_y = height / float(rows)
    tile_w = max(12, int(round(pitch_x - gap_px)))
    tile_h = max(12, int(round(pitch_y - gap_px)))

    # Irregular non-checkerboard polarity map
    pattern = [
        "LDLLDL",
        "DLDDLD",
        "LLDLDL",
    ]
    total_tiles = rows * cols
    shown = max(0, min(total_tiles, int(round(total_tiles * reveal_frac))))
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx >= shown:
                idx += 1
                continue
            pol = pattern[r % len(pattern)][c % len(pattern[0])]
            col = light_bgr if pol == "L" else dark_bgr
            icon_col = dark_bgr if pol == "L" else light_bgr
            x0 = int(round(c * pitch_x + gap_px * 0.5))
            y0 = int(round(r * pitch_y + gap_px * 0.5))
            cv2.rectangle(img, (x0, y0), (x0 + tile_w, y0 + tile_h), col, -1)
            icx = x0 + tile_w // 2
            icy = y0 + tile_h // 2
            rad = max(8, min(tile_w, tile_h) // 5)
            if (r + c) % 2 == 0:
                cv2.circle(img, (icx, icy), rad, icon_col, 3, cv2.LINE_AA)
            else:
                cv2.rectangle(img, (icx - rad, icy - rad), (icx + rad, icy + rad), icon_col, 3)
            idx += 1

    if abs(tilt_deg) > 0.05:
        mat = cv2.getRotationMatrix2D((width * 0.5, height * 0.5), -tilt_deg, 1.0)
        img = cv2.warpAffine(
            img,
            mat,
            (width, height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=gap_bgr,
        )
    return img


def _bgr_hex(bgr: Tuple[int, int, int]) -> str:
    return f"#{bgr[2]:02X}{bgr[1]:02X}{bgr[0]:02X}"


def _write_video(frames: List[np.ndarray], out_mp4: Path, fps: float) -> None:
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    h, w = frames[0].shape[:2]
    writer = cv2.VideoWriter(str(out_mp4), cv2.VideoWriter_fourcc(*"mp4v"), float(fps), (w, h))
    if not writer.isOpened():
        raise RuntimeError(f"Failed to open OpenCV VideoWriter for {out_mp4}")
    try:
        for fr in frames:
            writer.write(fr)
    finally:
        writer.release()


def generate_synthetic_clip(
    spec: Dict[str, Any],
    out_mp4: Path,
    out_truth_json: Optional[Path] = None,
) -> Dict[str, Any]:
    """Renders a deterministic synthetic reference video from `spec` and emits exact ground truth."""
    width = int(spec["width"])
    height = int(spec["height"])
    fps = float(spec["fps"])
    scenes_cfg = spec["scenes"]

    all_frames: List[np.ndarray] = []
    truth_scenes: List[Dict[str, Any]] = []
    hard_cuts: List[Dict[str, Any]] = []
    soft_transitions: List[Dict[str, Any]] = []
    cur_frame = 0

    for s_idx, sc in enumerate(scenes_cfg):
        n_frames = max(6, int(round(float(sc["durationSec"]) * fps)))
        start_f = cur_frame
        start_sec = round(start_f / fps, 4)
        end_f = start_f + n_frames
        end_sec = round(end_f / fps, 4)
        transition = str(sc.get("transitionFromPrev") or ("none" if s_idx == 0 else "hard"))
        kind = str(sc.get("kind") or "textured")
        seed = int(sc.get("seed", 100 + s_idx * 17))
        bg_bgr = tuple(int(v) for v in sc.get("bgBgr", (20, 22, 28)))

        if s_idx > 0:
            if transition == "hard":
                hard_cuts.append({"frame": start_f, "t": start_sec})
            elif transition == "crossfade":
                fade_frames = max(4, int(round(float(sc.get("crossfadeSec", 0.65)) * fps)))
                soft_transitions.append({
                    "startFrame": start_f,
                    "endFrame": start_f + fade_frames,
                    "tStart": start_sec,
                    "tEnd": round((start_f + fade_frames) / fps, 4),
                    "kind": "crossfade",
                })

        cam = sc.get("camera")
        scene_frames: List[np.ndarray] = []
        base_img: Optional[np.ndarray] = None
        if kind == "textured":
            base_img = make_textured_canvas(width, height, seed=seed, bg_bgr=bg_bgr)
        elif kind == "dark-featureless":
            base_img = np.full((height, width, 3), bg_bgr, dtype=np.uint8)
            cv2.circle(base_img, (width // 2, height // 2), 18, (bg_bgr[0] + 6, bg_bgr[1] + 6, bg_bgr[2] + 6), -1)
        elif kind == "moving-object-static-bg":
            base_img = make_textured_canvas(width, height, seed=seed, bg_bgr=bg_bgr)

        cam_truth_samples: List[Dict[str, Any]] = []
        key_events: List[float] = []

        for k in range(n_frames):
            local_t = k / fps
            if kind == "tile-wall":
                light_bgr = tuple(int(v) for v in sc.get("lightTileBgr", (236, 240, 241)))
                dark_bgr = tuple(int(v) for v in sc.get("darkTileBgr", (26, 24, 23)))
                tilt_deg = float(sc.get("tiltDeg", -2.8))
                # Reveal tiles during the first 12% of scene so early frames expose true gap color
                reveal = min(1.0, (k + 1) / max(1.0, n_frames * 0.12)) if sc.get("revealIntro", True) else 1.0
                fr = make_tile_wall_frame(
                    width,
                    height,
                    gap_bgr=bg_bgr,
                    light_bgr=light_bgr,
                    dark_bgr=dark_bgr,
                    tilt_deg=tilt_deg,
                    reveal_frac=reveal,
                )
            elif kind == "moving-object-static-bg":
                fr = base_img.copy()
                u = k / max(1.0, n_frames - 1.0)
                ox = int(round(width * (0.18 + 0.64 * u)))
                oy = int(round(height * (0.30 + 0.35 * math.sin(u * math.pi))))
                rad = max(24, min(width, height) // 9)
                cv2.circle(fr, (ox, oy), rad, (50, 90, 245), -1, cv2.LINE_AA)
                cv2.circle(fr, (ox, oy), rad, (255, 255, 255), 3, cv2.LINE_AA)
            else:
                fr = base_img.copy()

            if cam:
                seg_t0 = float(cam.get("t0", 0.0))
                seg_t1 = float(cam.get("t1", float(sc["durationSec"])))
                ease_name = str(cam.get("ease", "linear"))
                if local_t <= seg_t0:
                    p = 0.0
                elif local_t >= seg_t1:
                    p = 1.0
                else:
                    p = _eval_ease(ease_name, (local_t - seg_t0) / max(1e-6, seg_t1 - seg_t0))
                s_val = float(cam.get("scaleFrom", 1.0)) + (float(cam.get("scaleTo", 1.0)) - float(cam.get("scaleFrom", 1.0))) * p
                rot_val = float(cam.get("rotDegFrom", 0.0)) + (float(cam.get("rotDegTo", 0.0)) - float(cam.get("rotDegFrom", 0.0))) * p
                pan_x = float(cam.get("txFrom", 0.0)) + (float(cam.get("txTo", 0.0)) - float(cam.get("txFrom", 0.0))) * p
                pan_y = float(cam.get("tyFrom", 0.0)) + (float(cam.get("tyTo", 0.0)) - float(cam.get("tyFrom", 0.0))) * p
                # Convert (s, rot, panX, panY) into exact AM.applyCamera (cx, cy)
                rad = math.radians(rot_val)
                a = s_val * math.cos(rad)
                b = -s_val * math.sin(rad)
                cc = s_val * math.sin(rad)
                d = s_val * math.cos(rad)
                s2 = max(1e-6, s_val * s_val)
                cx = width * 0.5 - (a * pan_x + cc * pan_y) / s2
                cy = height * 0.5 - (b * pan_x + d * pan_y) / s2
                fr = apply_camera_to_frame(fr, s_val, cx, cy, rot_val, border_bgr=bg_bgr)
                cam_truth_samples.append({
                    "frame": start_f + k,
                    "localT": round(local_t, 4),
                    "globalT": round((start_f + k) / fps, 4),
                    "scale": round(s_val, 5),
                    "rotDeg": round(rot_val, 4),
                    "tx": round(pan_x, 3),
                    "ty": round(pan_y, 3),
                })

            scene_frames.append(fr)

        if cam:
            # Key event timestamp near peak camera change (85% of motion segment)
            seg_t0 = float(cam.get("t0", 0.0))
            seg_t1 = float(cam.get("t1", float(sc["durationSec"])))
            key_events.append(round(start_sec + seg_t0 + 0.85 * (seg_t1 - seg_t0), 3))

        # Apply crossfade blend over the opening frames of this scene if requested
        if s_idx > 0 and transition == "crossfade" and all_frames:
            fade_frames = max(4, int(round(float(sc.get("crossfadeSec", 0.65)) * fps)))
            prev_tail = all_frames[-1].astype(np.float32)
            for k in range(min(fade_frames, len(scene_frames))):
                alpha = (k + 1) / float(fade_frames + 1)
                blended = (1.0 - alpha) * prev_tail + alpha * scene_frames[k].astype(np.float32)
                scene_frames[k] = np.clip(blended, 0, 255).astype(np.uint8)

        all_frames.extend(scene_frames)
        truth_scenes.append({
            "index": s_idx + 1,
            "id": str(sc.get("id") or f"scene_{s_idx + 1}"),
            "kind": kind,
            "startFrame": start_f,
            "endFrame": end_f,
            "startSec": start_sec,
            "endSec": end_sec,
            "transitionFromPrev": transition,
            "trueBgHex": _bgr_hex(bg_bgr),
            "trueBgBgr": list(bg_bgr),
            "isDarkBg": bool((0.114 * bg_bgr[0] + 0.587 * bg_bgr[1] + 0.299 * bg_bgr[2]) < 120.0),
            "camera": cam,
            "cameraSamples": cam_truth_samples,
            "keyEventsSec": key_events,
        })
        cur_frame = end_f

    _write_video(all_frames, out_mp4, fps)
    truth = {
        "name": str(spec.get("name") or out_mp4.stem),
        "videoPath": str(out_mp4),
        "width": width,
        "height": height,
        "fps": fps,
        "totalFrames": len(all_frames),
        "durationSec": round(len(all_frames) / fps, 4),
        "hasAudio": False,
        "expectedBpmSource": "fallback",
        "hardCuts": hard_cuts,
        "softTransitions": soft_transitions,
        "scenes": truth_scenes,
    }
    if out_truth_json is not None:
        out_truth_json.parent.mkdir(parents=True, exist_ok=True)
        out_truth_json.write_text(json.dumps(truth, indent=2), encoding="utf-8")
    return truth


def build_synthetic_suite_specs(suite: str) -> List[Dict[str, Any]]:
    """Returns disjoint synthetic tuning Set A or held-out evaluation Set B."""
    if suite == "A":
        return [
            {
                "name": "A1_cuts_zoom_tile_dark_30fps",
                "width": 1024,
                "height": 576,
                "fps": 30.0,
                "scenes": [
                    {
                        "id": "a1_static_intro",
                        "kind": "textured",
                        "durationSec": 2.4,
                        "seed": 11,
                        "bgBgr": (18, 16, 22),
                    },
                    {
                        "id": "a1_tile_zoom_in",
                        "kind": "tile-wall",
                        "durationSec": 2.6,
                        "transitionFromPrev": "hard",
                        "bgBgr": (14, 11, 12),  # #0C0B0E-like dark
                        "lightTileBgr": (236, 240, 241),
                        "darkTileBgr": (26, 24, 23),
                        "tiltDeg": -2.8,
                        "camera": {
                            "t0": 1.7,
                            "t1": 2.5,
                            "scaleFrom": 1.0,
                            "scaleTo": 1.48,
                            "rotDegFrom": 0.0,
                            "rotDegTo": 2.4,
                            "txFrom": 0.0,
                            "txTo": 0.0,
                            "tyFrom": 0.0,
                            "tyTo": 0.0,
                            "ease": "inCubic",
                        },
                    },
                    {
                        "id": "a1_short_scene",
                        "kind": "textured",
                        "durationSec": 1.1,
                        "transitionFromPrev": "hard",
                        "seed": 33,
                        "bgBgr": (228, 224, 218),
                    },
                    {
                        "id": "a1_pan_scene",
                        "kind": "textured",
                        "durationSec": 2.5,
                        "transitionFromPrev": "hard",
                        "seed": 44,
                        "bgBgr": (22, 34, 48),
                        "camera": {
                            "t0": 0.4,
                            "t1": 2.0,
                            "scaleFrom": 1.15,
                            "scaleTo": 1.15,
                            "rotDegFrom": 0.0,
                            "rotDegTo": 0.0,
                            "txFrom": -36.0,
                            "txTo": 36.0,
                            "tyFrom": -14.0,
                            "tyTo": 18.0,
                            "ease": "linear",
                        },
                    },
                    {
                        "id": "a1_soft_crossfade",
                        "kind": "textured",
                        "durationSec": 2.4,
                        "transitionFromPrev": "crossfade",
                        "crossfadeSec": 0.7,
                        "seed": 55,
                        "bgBgr": (42, 24, 38),
                    },
                ],
            },
            {
                "name": "A2_controls_and_light_tile_24fps",
                "width": 720,
                "height": 1280,
                "fps": 24.0,
                "scenes": [
                    {
                        "id": "a2_control_static",
                        "kind": "textured",
                        "durationSec": 2.5,
                        "seed": 61,
                        "bgBgr": (28, 30, 36),
                    },
                    {
                        "id": "a2_control_moving_obj",
                        "kind": "moving-object-static-bg",
                        "durationSec": 2.8,
                        "transitionFromPrev": "hard",
                        "seed": 62,
                        "bgBgr": (24, 28, 34),
                    },
                    {
                        "id": "a2_control_dark_empty",
                        "kind": "dark-featureless",
                        "durationSec": 2.2,
                        "transitionFromPrev": "hard",
                        "seed": 63,
                        "bgBgr": (10, 10, 14),
                    },
                    {
                        "id": "a2_light_tile_wall",
                        "kind": "tile-wall",
                        "durationSec": 2.5,
                        "transitionFromPrev": "hard",
                        "bgBgr": (236, 240, 242),  # light gap backdrop
                        "lightTileBgr": (248, 248, 250),
                        "darkTileBgr": (28, 28, 34),
                        "tiltDeg": 3.2,
                    },
                ],
            },
        ]

    if suite == "B":
        return [
            {
                "name": "B1_heldout_60fps_cuts_and_camera",
                "width": 1024,
                "height": 576,
                "fps": 60.0,
                "scenes": [
                    {
                        "id": "b1_zoom_out_rot",
                        "kind": "textured",
                        "durationSec": 2.6,
                        "seed": 201,
                        "bgBgr": (18, 26, 36),
                        "camera": {
                            "t0": 0.3,
                            "t1": 2.1,
                            "scaleFrom": 1.38,
                            "scaleTo": 1.02,
                            "rotDegFrom": -3.1,
                            "rotDegTo": 0.4,
                            "txFrom": 18.0,
                            "txTo": -12.0,
                            "tyFrom": 0.0,
                            "tyTo": 0.0,
                            "ease": "outCubic",
                        },
                    },
                    {
                        "id": "b1_short_hard_cut",
                        "kind": "textured",
                        "durationSec": 1.15,
                        "transitionFromPrev": "hard",
                        "seed": 202,
                        "bgBgr": (235, 232, 224),
                    },
                    {
                        "id": "b1_tile_dark_late_zoom",
                        "kind": "tile-wall",
                        "durationSec": 2.8,
                        "transitionFromPrev": "hard",
                        "bgBgr": (18, 16, 14),
                        "lightTileBgr": (240, 242, 245),
                        "darkTileBgr": (30, 32, 36),
                        "tiltDeg": -3.5,
                        "camera": {
                            "t0": 1.85,
                            "t1": 2.65,
                            "scaleFrom": 1.0,
                            "scaleTo": 1.52,
                            "rotDegFrom": 0.0,
                            "rotDegTo": -2.8,
                            "txFrom": 0.0,
                            "txTo": 0.0,
                            "tyFrom": 0.0,
                            "tyTo": 0.0,
                            "ease": "inCubic",
                        },
                    },
                    {
                        "id": "b1_soft_fade",
                        "kind": "textured",
                        "durationSec": 2.4,
                        "transitionFromPrev": "crossfade",
                        "crossfadeSec": 0.8,
                        "seed": 204,
                        "bgBgr": (24, 40, 32),
                    },
                    {
                        "id": "b1_final_hard_cut",
                        "kind": "textured",
                        "durationSec": 2.2,
                        "transitionFromPrev": "hard",
                        "seed": 205,
                        "bgBgr": (230, 225, 240),
                    },
                ],
            },
            {
                "name": "B2_heldout_24fps_controls_and_tile_light",
                "width": 720,
                "height": 1280,
                "fps": 24.0,
                "scenes": [
                    {
                        "id": "b2_moving_obj_control",
                        "kind": "moving-object-static-bg",
                        "durationSec": 2.6,
                        "seed": 301,
                        "bgBgr": (20, 24, 30),
                    },
                    {
                        "id": "b2_static_control",
                        "kind": "textured",
                        "durationSec": 2.4,
                        "transitionFromPrev": "hard",
                        "seed": 302,
                        "bgBgr": (220, 226, 232),
                    },
                    {
                        "id": "b2_dark_empty_control",
                        "kind": "dark-featureless",
                        "durationSec": 2.2,
                        "transitionFromPrev": "hard",
                        "seed": 303,
                        "bgBgr": (8, 9, 12),
                    },
                    {
                        "id": "b2_tile_light",
                        "kind": "tile-wall",
                        "durationSec": 2.6,
                        "transitionFromPrev": "hard",
                        "bgBgr": (232, 236, 240),
                        "lightTileBgr": (246, 248, 250),
                        "darkTileBgr": (22, 24, 28),
                        "tiltDeg": 2.4,
                    },
                    {
                        "id": "b2_pan_only",
                        "kind": "textured",
                        "durationSec": 2.6,
                        "transitionFromPrev": "hard",
                        "seed": 305,
                        "bgBgr": (30, 22, 34),
                        "camera": {
                            "t0": 0.5,
                            "t1": 2.1,
                            "scaleFrom": 1.18,
                            "scaleTo": 1.18,
                            "rotDegFrom": 0.0,
                            "rotDegTo": 0.0,
                            "txFrom": 28.0,
                            "txTo": -32.0,
                            "tyFrom": 16.0,
                            "tyTo": -20.0,
                            "ease": "inOutCubic",
                        },
                    },
                ],
            },
        ]

    raise ValueError(f"Unknown synthetic suite: {suite} (expected 'A' or 'B')")
