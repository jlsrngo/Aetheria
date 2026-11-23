#!/usr/bin/env python3
"""Unit tests for scripts/motion-feel-report.py using synthetic videos created at test time."""

import importlib.util
import os
import tempfile
import unittest

import cv2
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "motion-feel-report.py")


def _load_module():
    spec = importlib.util.spec_from_file_location("motion_feel_report", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def _write_box_video(path: str, mode: str, n_frames: int = 90, fps: float = 30.0) -> None:
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (180, 320))
    for i in range(n_frames):
        frame = np.full((320, 180, 3), 230, dtype=np.uint8)
        if mode == "moving":
            x = int(20 + (i / float(n_frames - 1)) * 90)
        elif mode == "slow_drift":
            # Moves 28px over 3s (~0.3px/frame -> lag-1 misses it, lag-15 detects real motion!)
            x = int(round(40 + (i / float(n_frames - 1)) * 28))
        else:
            x = 40
        cv2.rectangle(frame, (x, 100), (x + 56, 200), (30, 30, 30), -1)
        writer.write(frame)
    writer.release()


class TestMotionFeelReport(unittest.TestCase):
    def test_detects_dead_hold_but_not_slow_drift(self):
        mod = _load_module()
        with tempfile.TemporaryDirectory(prefix="aetheria_feel_") as td:
            ref_p = os.path.join(td, "ref.mp4")
            dead_p = os.path.join(td, "dead.mp4")
            drift_p = os.path.join(td, "drift.mp4")
            _write_box_video(ref_p, "moving")
            _write_box_video(dead_p, "static")
            _write_box_video(drift_p, "slow_drift")

            rep_dead = mod.evaluate_motion_feel(ref_p, dead_p, [])
            self.assertGreater(rep_dead["totalWindows"], 0)
            self.assertEqual(rep_dead["totalDeadWindows"], rep_dead["totalWindows"])

            rep_drift = mod.evaluate_motion_feel(ref_p, drift_p, [])
            self.assertGreater(rep_drift["totalWindows"], 0)
            self.assertEqual(rep_drift["totalDeadWindows"], 0)


if __name__ == "__main__":
    unittest.main()
