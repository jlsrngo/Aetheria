"""Unit tests for deterministic 1/1 filmstrip extractor, hero selector, and beat spacing."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ref_beat_strip
import ref_extractor
import ref_filmstrip


class RefFilmstripAndTuningTests(unittest.TestCase):
    def test_raw_and_smart_filmstrips_portrait_and_landscape(self) -> None:
        with tempfile.TemporaryDirectory(prefix="p9_fs_") as tmp:
            td = Path(tmp)
            # Portrait synthetic clip: 12 moving frames + 10 identical hold frames + 8 moving frames = 30f
            mp4_p = td / "portrait.mp4"
            w_p = cv2.VideoWriter(str(mp4_p), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (180, 320))
            self.assertTrue(w_p.isOpened())
            for i in range(30):
                fr = np.full((320, 180, 3), 16, dtype=np.uint8)
                x = 20 + (i * 8 if i < 12 else (96 if i < 22 else 96 + (i - 22) * 8))
                cv2.rectangle(fr, (min(140, x), 110), (min(175, x + 32), 180), (40, 160, 250), -1)
                w_p.write(fr)
            w_p.release()

            scenes = [{"index": 1, "id": "scene1_hook", "start": 0.0, "end": 1.0}]
            raw_res = ref_filmstrip.generate_filmstrips(mp4_p, td / "out_raw", scenes, mode="raw")
            self.assertTrue(raw_res["ok"], raw_res)
            self.assertEqual(raw_res["totalFrames"], 30)
            self.assertEqual(raw_res["keptTiles"], 30)
            self.assertEqual(raw_res["sheetCount"], 3)
            self.assertLessEqual(max(raw_res["sheetWidth"], raw_res["sheetHeight"]), 1280)
            self.assertTrue((td / "out_raw" / "vision" / "filmstrips" / "sheet_001.jpg").is_file())

            smart_res = ref_filmstrip.generate_filmstrips(mp4_p, td / "out_smart", scenes, mode="smart", hold_eps=0.15)
            self.assertTrue(smart_res["ok"], smart_res)
            self.assertEqual(smart_res["totalFrames"], 30)
            self.assertLess(smart_res["keptTiles"], 25)
            self.assertTrue(any(s.get("hasHold") for s in smart_res["sheets"]))

            # Landscape geometry stays <= 1280px longest edge (2 cols x 5 rows)
            mp4_l = td / "landscape.mp4"
            w_l = cv2.VideoWriter(str(mp4_l), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (320, 180))
            self.assertTrue(w_l.isOpened())
            for i in range(12):
                fr = np.full((180, 320, 3), 24, dtype=np.uint8)
                cv2.circle(fr, (40 + i * 20, 90), 22, (20, 150, 255), -1)
                w_l.write(fr)
            w_l.release()
            land_res = ref_filmstrip.generate_filmstrips(mp4_l, td / "out_land", scenes, mode="raw")
            self.assertTrue(land_res["ok"], land_res)
            self.assertLessEqual(max(land_res["sheetWidth"], land_res["sheetHeight"]), 1280)

    def test_hero_selector_avoids_flash_and_beat_panels_avoid_clumping(self) -> None:
        # Solid near-white flash at midpoint (r=0.52) vs crisp high-contrast graphic elsewhere
        frames = {}
        fps = 30.0
        for f in range(60):
            t = round(f / fps, 3)
            if 24 <= f <= 34:
                fr = np.full((180, 180, 3), 252, dtype=np.uint8)
            else:
                fr = np.full((180, 180, 3), 14, dtype=np.uint8)
                cv2.rectangle(fr, (35, 50), (145, 130), (30, 145, 250), -1)
            frames[f] = (t, fr)

        def lookup(ts: float):
            f_idx = max(0, min(59, int(round(ts * fps))))
            return frames[f_idx][1]

        best_ts, best_fr = ref_extractor.select_best_hero_frame(0.0, 2.0, fps, 60, lookup)
        self.assertIsNotNone(best_fr)
        self.assertLess(float(np.mean(best_fr)), 200.0, f"hero landed on flash at t={best_ts}")

        # Beat panels on a 2.0s scene should not clump within 0.12s of scene boundaries
        diffs = [0.5] * 60
        diffs[2] = 45.0   # 0.067s right beside scene-start (frame 1)
        diffs[28] = 30.0  # genuine interior peak
        panels = ref_beat_strip.select_adaptive_beat_strip_panels(
            0.0, 2.0, fps, 60, frame_diffs=diffs, max_panels=6
        )
        for i in range(len(panels) - 1):
            gap_sec = panels[i + 1]["t"] - panels[i]["t"]
            self.assertGreaterEqual(gap_sec, 0.12, f"clumped beat panels: {panels}")


if __name__ == "__main__":
    unittest.main()
