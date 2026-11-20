"""Unit tests for on-demand reference frame & pixel probe (`ref_frame_probe.py`)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ref_frame_probe


class RefFrameProbeTests(unittest.TestCase):
    def test_inspect_and_sample_measure_exact_crop_and_colors(self) -> None:
        with tempfile.TemporaryDirectory(prefix="p8_probe_") as tmp:
            td = Path(tmp)
            mp4 = td / "probe.mp4"
            writer = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (640, 360))
            self.assertTrue(writer.isOpened())
            # 0.0..1.0s: dark #0C0B0E backdrop with crisp orange rectangle at [200, 100, 140x120]
            for _ in range(30):
                fr = np.full((360, 640, 3), (14, 11, 12), dtype=np.uint8)
                cv2.rectangle(fr, (200, 100), (339, 219), (40, 140, 245), -1)  # BGR -> #F58C28
                writer.write(fr)
            writer.release()

            # 1. Inspect with zoom crop
            out_jpg = td / "crop.jpg"
            insp = ref_frame_probe.inspect_reference_frame(
                mp4, 0.5, crop=(180, 80, 180, 160), save_path=out_jpg
            )
            self.assertTrue(insp["ok"], insp)
            self.assertTrue(insp["zoomed"])
            self.assertEqual(insp["crop"], [180, 80, 180, 160])
            self.assertTrue(insp["dataUrl"].startswith("data:image/jpeg;base64,"))
            self.assertTrue(out_jpg.is_file())

            # 2. Sample region around rectangle -> measures border dark hex, dominant orange, and tight fgBox
            samp = ref_frame_probe.sample_reference_region(mp4, 0.5, box=(160, 60, 220, 200))
            self.assertTrue(samp["ok"], samp)
            self.assertTrue(samp["isDark"])
            self.assertIsNotNone(samp["foregroundBox"])
            fx, fy, fw, fh = samp["foregroundBox"]
            self.assertLessEqual(abs(fx - 200), 4)
            self.assertLessEqual(abs(fy - 100), 4)
            self.assertLessEqual(abs(fw - 140), 6)
            self.assertLessEqual(abs(fh - 120), 6)
            dom_hexes = [c["hex"] for c in samp["dominantColors"]]
            self.assertGreaterEqual(len(dom_hexes), 2)

    def test_corrupt_or_missing_video_returns_clean_error(self) -> None:
        with tempfile.TemporaryDirectory(prefix="p8_probe_err_") as tmp:
            td = Path(tmp)
            missing = ref_frame_probe.inspect_reference_frame(td / "missing.mp4", 0.5)
            self.assertFalse(missing["ok"])
            self.assertIn("not found", missing["error"].lower())

            corrupt = td / "bad.mp4"
            corrupt.write_text("NOT_A_VIDEO", encoding="utf-8")
            bad = ref_frame_probe.sample_reference_region(corrupt, 0.5)
            self.assertFalse(bad["ok"])
            self.assertTrue(bad.get("error"))


if __name__ == "__main__":
    unittest.main()
