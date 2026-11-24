#!/usr/bin/env python3
"""Synthetic unit tests for core/ref_extractor/ref_motion_gate.py (Prompt 12 M3)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from ref_motion_gate import evaluate_scene_motion_gate


def _draw_moving_frame(i: int, static: bool = False) -> np.ndarray:
    img = np.full((640, 360, 3), 230, dtype=np.uint8)
    k = 0 if static else i
    cx = int(70 + k * 5.5)
    cy = int(180 + k * 4.5)
    cv2.rectangle(img, (cx - 48, cy - 48), (cx + 48, cy + 48), (130, 30, 175), -1)
    cv2.line(img, (cx - 40, cy - 20), (cx + 40, cy + 20), (255, 255, 255), 4)
    cv2.circle(img, (cx + 12, cy - 12), 14, (255, 210, 60), -1)
    return img


class MotionGateTests(unittest.TestCase):
    def test_gate_flags_weak_static_render_and_passes_matched_motion(self) -> None:
        fps = 30.0
        with tempfile.TemporaryDirectory() as td:
            td_p = Path(td)
            ref_path = td_p / "ref.mp4"
            writer = cv2.VideoWriter(str(ref_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (360, 640))
            for i in range(45):
                writer.write(_draw_moving_frame(i, static=False))
            writer.release()

            weak_pairs = []
            matched_pairs = []
            for idx in (5, 11, 17, 23, 29, 35):
                w0 = td_p / f"w_{idx}_0.png"
                w1 = td_p / f"w_{idx}_1.png"
                cv2.imwrite(str(w0), _draw_moving_frame(idx, static=True))
                cv2.imwrite(str(w1), _draw_moving_frame(idx + 1, static=True))
                weak_pairs.append({"t0": idx / fps, "t1": (idx + 1) / fps, "prev0": str(w0), "prev1": str(w1)})

                m0 = td_p / f"m_{idx}_0.png"
                m1 = td_p / f"m_{idx}_1.png"
                cv2.imwrite(str(m0), _draw_moving_frame(idx, static=False))
                cv2.imwrite(str(m1), _draw_moving_frame(idx + 1, static=False))
                matched_pairs.append({"t0": idx / fps, "t1": (idx + 1) / fps, "prev0": str(m0), "prev1": str(m1)})

            sec = [{"kind": "rotate", "zone": "top_right", "ampDegPerSec": 99.0, "tStart": 0.3, "tEnd": 1.5}]
            rep_weak = evaluate_scene_motion_gate({
                "refVideoPath": str(ref_path),
                "pairs": weak_pairs,
                "secondaryMotion": sec,
            })
            self.assertTrue(rep_weak["ok"])
            self.assertTrue(rep_weak["deficit"], f"weak render must trigger deficit: {rep_weak}")
            self.assertEqual(rep_weak["failureClass"], "implementation_motion_deficit")
            self.assertGreaterEqual(rep_weak["duplicatePairCount"], 4)
            self.assertIn("MOTION FLOW DEFICIT WARNING", rep_weak["warning"])
            self.assertIn("rotate[top_right +99deg/s", rep_weak["warning"])

            rep_ok = evaluate_scene_motion_gate({
                "refVideoPath": str(ref_path),
                "pairs": matched_pairs,
                "secondaryMotion": sec,
            })
            self.assertTrue(rep_ok["ok"])
            self.assertFalse(rep_ok["deficit"], f"matched render should pass gate: {rep_ok}")
            self.assertEqual(rep_ok["failureClass"], "none")
            self.assertEqual(rep_ok["duplicatePairCount"], 0)
            self.assertEqual(rep_ok["warning"], "")

            # Velocity snap / mid-motion freeze: 4 moving pairs + 2 frozen pairs mid-scene
            snap_pairs = []
            for k, idx in enumerate((5, 11, 17, 23, 29, 35)):
                s0 = td_p / f"s_{idx}_0.png"
                s1 = td_p / f"s_{idx}_1.png"
                is_frozen = k in (2, 4)
                cv2.imwrite(str(s0), _draw_moving_frame(idx, static=is_frozen))
                cv2.imwrite(str(s1), _draw_moving_frame(idx if is_frozen else idx + 1, static=is_frozen))
                snap_pairs.append({"t0": idx / fps, "t1": (idx + 1) / fps, "prev0": str(s0), "prev1": str(s1)})

            rep_snap = evaluate_scene_motion_gate({
                "refVideoPath": str(ref_path),
                "pairs": snap_pairs,
                "secondaryMotion": sec,
            })
            self.assertTrue(rep_snap["ok"])
            self.assertTrue(rep_snap["deficit"], f"mid-motion frozen pairs must be flagged: {rep_snap}")
            self.assertEqual(rep_snap["failureClass"], "implementation_velocity_snap")
            self.assertGreaterEqual(rep_snap["duplicatePairCount"], 2)
            self.assertIn("MOTION VELOCITY SNAP WARNING", rep_snap["warning"])

            # Static reference video must NOT false-alarm -> extraction_low_confidence
            static_ref = td_p / "static_ref.mp4"
            sw = cv2.VideoWriter(str(static_ref), cv2.VideoWriter_fourcc(*"mp4v"), fps, (360, 640))
            for i in range(45):
                sw.write(_draw_moving_frame(i, static=True))
            sw.release()
            rep_static_ref = evaluate_scene_motion_gate({
                "refVideoPath": str(static_ref),
                "pairs": weak_pairs,
                "secondaryMotion": [],
            })
            self.assertTrue(rep_static_ref["ok"])
            self.assertFalse(rep_static_ref["deficit"])
            self.assertEqual(rep_static_ref["failureClass"], "extraction_low_confidence")


if __name__ == "__main__":
    unittest.main()
