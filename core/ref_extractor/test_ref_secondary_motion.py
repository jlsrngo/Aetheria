#!/usr/bin/env python3
"""Synthetic unit tests for Prompt 12 M2 (secondaryMotion, elementTracks ranking, hasLivingHold)."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from ref_element_tracks import extract_scene_element_tracks
from ref_motion_kinematics import extract_scene_motion_kinematics
from ref_secondary_motion import extract_scene_secondary_motion


def _draw_four_point_star(img: np.ndarray, cx: int, cy: int, r_outer: int, angle_deg: float, color: tuple[int, int, int]) -> None:
    pts = []
    r_inner = int(round(r_outer * 0.28))
    base = math.radians(angle_deg)
    for i in range(8):
        a = base + i * (math.pi / 4.0)
        r = r_outer if i % 2 == 0 else r_inner
        pts.append([int(round(cx + math.cos(a) * r)), int(round(cy + math.sin(a) * r))])
    cv2.fillPoly(img, [np.array(pts, dtype=np.int32)], color)


class SecondaryMotionM2Tests(unittest.TestCase):
    def test_rotating_star_90dps_and_sweeping_arc_detected_within_15pct(self) -> None:
        w, h, fps = 360, 640, 30.0
        frames: list[np.ndarray] = []
        for i in range(60):  # 2.0s at 30fps
            t = i / fps
            img = np.full((h, w, 3), 220, dtype=np.uint8)
            # 4-point purple star rotating continuously at 90 deg/sec -> periodSec = 4.0s
            _draw_four_point_star(img, 95, 115, 58, 90.0 * t, (140, 30, 175))
            # Low-contrast grey sweeping arc translating downward smoothly by ~160px over 2s
            arc_y = int(round(260 + 80.0 * t))
            cv2.ellipse(img, (180, arc_y), (170, 90), 0, 15, 165, (165, 165, 165), 14, cv2.LINE_AA)
            frames.append(img)

        def frame_at(ts: float) -> np.ndarray:
            idx = min(len(frames) - 1, max(0, int(round(ts * fps))))
            return frames[idx]

        sec = extract_scene_secondary_motion(frame_at, 0.0, 2.0, w, h, fps=fps)
        kinds = {item["kind"]: item for item in sec}
        self.assertIn("rotate", kinds, f"expected rotate in {sec}")
        rot = kinds["rotate"]
        self.assertAlmostEqual(abs(rot["ampDegPerSec"]), 90.0, delta=90.0 * 0.15)
        self.assertAlmostEqual(rot["periodSec"], 4.0, delta=4.0 * 0.15)
        self.assertIn("sweep", kinds, f"expected sweep in {sec}")
        self.assertGreaterEqual(kinds["sweep"]["ampPx"], 80.0)

    def test_static_clip_returns_empty_secondary_motion_and_false_living_hold(self) -> None:
        w, h, fps = 360, 640, 30.0
        base = np.full((h, w, 3), 220, dtype=np.uint8)
        _draw_four_point_star(base, 95, 115, 58, 20.0, (140, 30, 175))
        cv2.rectangle(base, (100, 300), (260, 360), (90, 90, 90), -1)

        rng = np.random.default_rng(7)
        frames = [
            np.clip(base.astype(np.int16) + rng.integers(-2, 3, size=base.shape), 0, 255).astype(np.uint8)
            for _ in range(60)
        ]

        def frame_at(ts: float) -> np.ndarray:
            idx = min(len(frames) - 1, max(0, int(round(ts * fps))))
            return frames[idx]

        sec = extract_scene_secondary_motion(frame_at, 0.0, 2.0, w, h, fps=fps)
        self.assertEqual(sec, [])

        kin = extract_scene_motion_kinematics(frame_at, 0.0, 2.0, w, h)
        self.assertFalse(kin["hasLivingHold"], f"static noisy clip must have hasLivingHold=False, got {kin}")
        self.assertEqual(kin["livingHoldRegions"], [])

    def test_element_tracks_prefers_moving_saturated_accent_over_grey_text_block(self) -> None:
        w, h, fps = 360, 640, 30.0
        frames: list[np.ndarray] = []
        for i in range(45):
            t = i / fps
            img = np.full((h, w, 3), 222, dtype=np.uint8)
            # Expanding low-saturation grey text-like rectangle
            tw = int(round(120 + 60 * t))
            cv2.rectangle(img, (80, 290), (80 + tw, 330), (150, 150, 150), -1)
            # Moving saturated purple accent blob
            cx = int(round(70 + 95 * t))
            cv2.circle(img, (cx, 120), 32, (160, 25, 185), -1)
            frames.append(img)

        def frame_at(ts: float) -> np.ndarray:
            idx = min(len(frames) - 1, max(0, int(round(ts * fps))))
            return frames[idx]

        tracks = extract_scene_element_tracks(frame_at, 0.0, 1.5, w, h)
        self.assertGreaterEqual(len(tracks), 1)
        self.assertFalse(tracks[0].get("isTextLike", False), f"top track should not be grey text: {tracks}")
        self.assertGreaterEqual(tracks[0].get("dominantSat", 0.0), 38.0)


if __name__ == "__main__":
    unittest.main()
