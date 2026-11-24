#!/usr/bin/env python3
"""Synthetic unit tests for scripts/motion-smooth-report.py (Prompt 12 M0)."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "motion-smooth-report.py"


def _load_mod():
    spec = importlib.util.spec_from_file_location("motion_smooth_report", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write_clip(path: Path, frames: list[np.ndarray], fps: float = 30.0) -> None:
    h, w = frames[0].shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (w, h))
    for fr in frames:
        writer.write(fr)
    writer.release()


def _make_textured_moving_frames(n: int = 45, duplicate_idx: int | None = None) -> list[np.ndarray]:
    frames: list[np.ndarray] = []
    for i in range(n):
        img = np.full((640, 360, 3), 235, dtype=np.uint8)
        eff_i = i - 1 if (duplicate_idx is not None and i == duplicate_idx) else i
        cx = int(70 + eff_i * 5.0)
        cy = int(200 + eff_i * 4.0)
        # Draw high-contrast patterned moving block so Farneback flow > 3 px/frame cleanly
        cv2.rectangle(img, (cx - 45, cy - 45), (cx + 45, cy + 45), (140, 30, 180), -1)
        cv2.circle(img, (cx - 16, cy - 16), 14, (255, 230, 90), -1)
        cv2.line(img, (cx - 40, cy + 20), (cx + 40, cy - 20), (255, 255, 255), 4)
        frames.append(img)
    return frames


def _make_static_frames(n: int = 45) -> list[np.ndarray]:
    img = np.full((640, 360, 3), 235, dtype=np.uint8)
    cv2.rectangle(img, (120, 240), (240, 360), (40, 90, 210), -1)
    return [img.copy() for _ in range(n)]


class MotionSmoothReportTests(unittest.TestCase):
    def test_synthetic_continuous_static_and_mid_motion_duplicate(self) -> None:
        mod = _load_mod()
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            ref_mov = td_path / "ref_mov.mp4"
            res_mov = td_path / "res_mov.mp4"
            res_static = td_path / "res_static.mp4"
            res_dup = td_path / "res_dup.mp4"

            _write_clip(ref_mov, _make_textured_moving_frames(45))
            _write_clip(res_mov, _make_textured_moving_frames(45))
            _write_clip(res_static, _make_static_frames(45))
            _write_clip(res_dup, _make_textured_moving_frames(45, duplicate_idx=22))

            # (a) Continuous motion -> high fastShare
            rep_mov = mod.compute_smooth_report(ref_mov, res_mov, [])
            self.assertEqual(len(rep_mov["scenes"]), 1)
            self.assertGreaterEqual(rep_mov["scenes"][0]["fastShareRef"], 0.8)
            self.assertGreaterEqual(rep_mov["scenes"][0]["fastShareRes"], 0.8)
            self.assertEqual(rep_mov["midMotionDup"]["ref"], [])
            self.assertEqual(rep_mov["midMotionDup"]["res"], [])

            # (b) Static box -> fastShare == 0
            rep_static = mod.compute_smooth_report(ref_mov, res_static, [])
            self.assertEqual(rep_static["scenes"][0]["fastShareRes"], 0.0)
            self.assertEqual(rep_static["fastSeconds"]["res"], 0.0)

            # (c) Single duplicate frame inserted mid-motion -> caught in midMotionDup
            rep_dup = mod.compute_smooth_report(ref_mov, res_dup, [])
            self.assertIn(21, rep_dup["midMotionDup"]["res"])

            # Style JSON cuts parser (both numeric and dict cut entries from real style.json)
            style_json = td_path / "style.json"
            style_json.write_text(json.dumps({"cuts": [2.502, 6.206, 9.543]}), encoding="utf-8")
            self.assertEqual(mod.parse_scene_cuts_arg(str(style_json)), [2.502, 6.206, 9.543])
            style_dict_json = td_path / "style_dict.json"
            style_dict_json.write_text(
                json.dumps({"cuts": [{"cutSec": 0.0}, {"cutSec": 2.502}, {"cutSec": 6.206}]}),
                encoding="utf-8",
            )
            self.assertEqual(mod.parse_scene_cuts_arg(str(style_dict_json)), [2.502, 6.206])


if __name__ == "__main__":
    unittest.main()
