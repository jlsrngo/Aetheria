#!/usr/bin/env python3
"""Unit tests for 30fps cross-scene transition bridges and multi-pulse motion timelines."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import ref_motion_transitions as rmt


def _write_mp4(path: Path, frames: list[np.ndarray], fps: float = 30.0) -> None:
    h, w = frames[0].shape[:2]
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    assert writer.isOpened()
    for fr in frames:
        writer.write(fr)
    writer.release()


class RefMotionTransitionsTests(unittest.TestCase):
    def test_detects_push_left_bridge_and_hard_cut_lead_in_blank(self) -> None:
        w, h, fps = 360, 640, 30.0
        frames: list[np.ndarray] = []

        # Scene 1 (0.00..2.00s, f0..f59): textured block pushed left across cut f54..f67
        # Scene 2 (2.00..4.00s, f60..f119): push ends at f67, then clean hold + hard cut at f120
        # Scene 3 (4.00..5.20s, f120..f155): 3 blank frames (f120..f122 -> 0.10s) then reveals object
        def draw_scene1(canvas: np.ndarray, ox: int) -> None:
            cv2.rectangle(canvas, (ox + 70, 160), (ox + 290, 420), (150, 40, 45), -1)
            cv2.circle(canvas, (ox + 180, 290), 48, (240, 235, 220), -1)
            cv2.putText(canvas, "LEFT", (ox + 110, 490), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (40, 40, 45), 3)

        def draw_scene2(canvas: np.ndarray, ox: int) -> None:
            cv2.rectangle(canvas, (ox + 90, 200), (ox + 270, 380), (40, 140, 70), -1)
            cv2.putText(canvas, "RIGHT", (ox + 100, 460), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (30, 60, 30), 3)

        def smooth_push(u: float) -> float:
            return 3 * u * u - 2 * u * u * u

        for f in range(156):
            fr = np.full((h, w, 3), 232, dtype=np.uint8)
            if f < 52:
                draw_scene1(fr, 0)
            elif f <= 67:
                u = (f - 52) / 15.0
                shift = int(round(smooth_push(u) * w))
                draw_scene1(fr, -shift)
                draw_scene2(fr, w - shift)
            elif f < 120:
                draw_scene2(fr, 0)
            elif f < 123:
                # 3 blank grid frames at start of Scene 3
                pass
            else:
                cv2.circle(fr, (180, 320), 64, (190, 60, 160), -1)
            frames.append(fr)

        with tempfile.TemporaryDirectory() as td:
            mp4 = Path(td) / "trans_test.mp4"
            _write_mp4(mp4, frames, fps=fps)
            scenes = [
                {"index": 1, "id": "scene1", "start": 0.0, "end": round(60 / fps, 3), "duration": 2.0},
                {"index": 2, "id": "scene2", "start": round(60 / fps, 3), "end": round(120 / fps, 3), "duration": 2.0},
                {"index": 3, "id": "scene3", "start": round(120 / fps, 3), "end": round(156 / fps, 3), "duration": 1.2},
            ]
            res = rmt.analyze_video_30fps_motion(mp4, scenes, w, h, fps)
            self.assertTrue(res["ok"])
            sc2 = res["perScene"][2]
            tb2 = sc2["transitionBridge"]
            self.assertEqual(tb2["kind"], "push_left", tb2)
            self.assertEqual(len(tb2["curve"]), 16)
            self.assertAlmostEqual(tb2["curve"][0], 0.0, places=3)
            self.assertAlmostEqual(tb2["curve"][-1], 1.0, places=3)

            sc3 = res["perScene"][3]
            tb3 = sc3["transitionBridge"]
            self.assertEqual(tb3["kind"], "hard_cut", tb3)
            self.assertGreaterEqual(tb3["leadInBlankSec"], 0.06)

    def test_extracts_segmented_camera_pulses_and_local_action(self) -> None:
        w, h, fps = 360, 640, 30.0
        frames: list[np.ndarray] = []
        # 2.4s scene: 0..0.6s static, 0.6..1.2s full-frame pan up (-160px), 1.2..2.4s local rotating orbital satellite
        for f in range(72):
            fr = np.full((h, w, 3), 230, dtype=np.uint8)
            t = f / fps
            pan_y = 0 if t < 0.6 else (-160 if t >= 1.2 else int(round(-160 * ((t - 0.6) / 0.6))))
            # Rich multi-quadrant background markers so pan triggers activeQuads >= 3
            for gx in (70, 270):
                for gy in (180, 500):
                    cv2.circle(fr, (gx, max(20, min(h - 20, gy + pan_y))), 16, (165, 170, 180), -1)
            cv2.rectangle(fr, (110, 260 + pan_y), (250, 380 + pan_y), (40, 90, 200), -1)
            if t >= 1.3:
                ang = (t - 1.3) * 5.0
                sx = int(180 + np.cos(ang) * 90)
                sy = int(200 + np.sin(ang) * 90)
                cv2.circle(fr, (sx, sy), 14, (210, 50, 140), -1)
            frames.append(fr)

        with tempfile.TemporaryDirectory() as td:
            mp4 = Path(td) / "pulses_test.mp4"
            _write_mp4(mp4, frames, fps=fps)
            scenes = [{"index": 1, "id": "scene1", "start": 0.0, "end": 2.4, "duration": 2.4}]
            res = rmt.analyze_video_30fps_motion(mp4, scenes, w, h, fps)
            self.assertTrue(res["ok"])
            sc1 = res["perScene"][1]
            mt = sc1["motionTimeline30fps"]
            self.assertEqual(len(mt["velocityCurve15"]), 15)
            pulses = mt["cameraPulses"]
            self.assertTrue(any(p["kind"] == "camera_pan_up" and p["dyPx"] < -60 for p in pulses), pulses)
            self.assertTrue(len(sc1["cameraTrack"]) >= 3, sc1["cameraTrack"])
            actions = mt["actionWindows"]
            self.assertTrue(
                any(a["kind"] in ("local_action", "continuous_ambient") and a["t0"] >= 1.15 for a in actions),
                actions,
            )

    def test_detects_corner_spin_and_progressive_char_blur_reveal(self) -> None:
        w, h, fps = 360, 640, 30.0
        frames: list[np.ndarray] = []
        for f in range(45):
            fr = np.full((h, w, 3), 230, dtype=np.uint8)
            t = f / fps
            # Spinning 4-point star in top-left corner (cx=68, cy=78)
            ang = t * 2.4
            pts = []
            for i in range(8):
                r = 38.0 if i % 2 == 0 else 13.0
                a = ang + i * (np.pi / 4.0)
                pts.append([int(round(68 + np.cos(a) * r)), int(round(78 + np.sin(a) * r))])
            cv2.fillPoly(fr, [np.array(pts, dtype=np.int32)], (120, 20, 160))

            # Progressive left-to-right unblurring text across y=320: left word sharp, right word blurring in
            left_layer = fr.copy()
            cv2.putText(left_layer, "rese", (40, 340), cv2.FONT_HERSHEY_SIMPLEX, 1.35, (140, 10, 40), 4)
            fr[:, : w // 2] = left_layer[:, : w // 2]
            if f >= 6:
                right_layer = np.full((h, w, 3), 230, dtype=np.uint8)
                cv2.putText(right_layer, "arch", (w // 2 + 4, 340), cv2.FONT_HERSHEY_SIMPLEX, 1.35, (140, 10, 40), 4)
                ksize = max(1, int(round((1.0 - min(1.0, (f - 6) / 20.0)) * 21)))
                if ksize % 2 == 0:
                    ksize += 1
                if ksize > 1:
                    right_layer = cv2.GaussianBlur(right_layer, (ksize, ksize), 0)
                fr[:, w // 2 :] = right_layer[:, w // 2 :]
            frames.append(fr)

        with tempfile.TemporaryDirectory() as td:
            mp4 = Path(td) / "spin_blur_test.mp4"
            _write_mp4(mp4, frames, fps=fps)
            scenes = [{"index": 1, "id": "scene1", "start": 0.0, "end": 1.5, "duration": 1.5}]
            res = rmt.analyze_video_30fps_motion(mp4, scenes, w, h, fps)
            self.assertTrue(res["ok"])
            mt = res["perScene"][1]["motionTimeline30fps"]
            spins = mt.get("spinningObjects") or []
            self.assertTrue(any(s["zone"] == "top_left" for s in spins), spins)
            blurs = mt.get("blurTextReveals") or []
            self.assertTrue(len(blurs) >= 1, blurs)


if __name__ == "__main__":
    unittest.main()
