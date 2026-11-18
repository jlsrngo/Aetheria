"""Unit tests for MotionClone ref_extractor and ref_compare."""

import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ref_compare
import ref_extractor


class RefExtractorAndCompareTests(unittest.TestCase):
    def test_ref_extractor_multi_scene_and_ocr_fields(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mc_py_ext_") as tmp:
            td = Path(tmp)
            mp4 = td / "multi.mp4"
            writer = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (320, 180))
            self.assertTrue(writer.isOpened())
            # Scene 1: dark background + orange box
            for _ in range(12):
                frame = np.full((180, 320, 3), 18, dtype=np.uint8)
                cv2.rectangle(frame, (40, 40), (140, 140), (40, 140, 250), -1)
                writer.write(frame)
            # Scene 2: light background + red card
            for _ in range(12):
                frame = np.full((180, 320, 3), 235, dtype=np.uint8)
                cv2.rectangle(frame, (170, 30), (280, 150), (40, 40, 190), -1)
                writer.write(frame)
            writer.release()

            out = td / "out"
            res = ref_extractor.extract_reference_blueprint(str(mp4), str(out))
            self.assertTrue(res.get("success"), res)
            bp = res["blueprint"]
            self.assertEqual(bp["aspectRatio"], "16:9")
            self.assertIn("ocrAvailable", bp)
            self.assertIn("extractorBackend", bp)
            self.assertEqual(len(bp["scenes"]), 2)
            self.assertTrue((out / "ref_report.md").is_file())
            self.assertTrue((out / "style.json").is_file())
            self.assertTrue((out / "style_ast.json").is_file())
            self.assertIn("motionAst", res)
            ast_doc = res["motionAst"]
            self.assertEqual(ast_doc["version"], 3)
            self.assertIn("bpm", ast_doc)
            self.assertEqual(len(ast_doc["scenes"]), 2)
            self.assertIn("cleanPlate", ast_doc["scenes"][0])
            self.assertIn("fillHex", ast_doc["scenes"][0]["cleanPlate"])
            self.assertGreaterEqual(len(ast_doc["scenes"][0]["layers"]), 1)
            first_layer = ast_doc["scenes"][0]["layers"][0]
            self.assertIn("motion", first_layer)
            self.assertIn("entrance", first_layer["motion"])
            self.assertIn("curve", first_layer["motion"]["entrance"])
            self.assertIn("direction", first_layer["motion"]["entrance"])
            self.assertIn("amCodeSkeleton", ast_doc["scenes"][0])
            self.assertIn("AM.registerScene", ast_doc["scenes"][0]["amCodeSkeleton"])
            self.assertTrue((out / "skeletons" / "scene1.js").is_file())
            self.assertTrue((out / "skeletons" / "scene2.js").is_file())

    def test_ref_compare_strict_threshold_and_aspect_ratio_guard(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mc_py_cmp_") as tmp:
            td = Path(tmp)
            ref_img = np.zeros((320, 180, 3), dtype=np.uint8)
            cv2.rectangle(ref_img, (24, 50), (156, 220), (35, 130, 240), -1)
            prev_match = ref_img.copy()
            # Same palette solids, shifted wrong box layout (low edge/ssim despite similar colors)
            prev_layout_wrong = np.zeros((320, 180, 3), dtype=np.uint8)
            cv2.rectangle(prev_layout_wrong, (10, 10), (170, 80), (35, 130, 240), -1)
            prev_ar_wrong = np.zeros((180, 320, 3), dtype=np.uint8)

            r_path = td / "ref.jpg"
            m_path = td / "match.jpg"
            w_path = td / "layout_wrong.jpg"
            ar_path = td / "ar_wrong.jpg"
            cv2.imwrite(str(r_path), ref_img)
            cv2.imwrite(str(m_path), prev_match)
            cv2.imwrite(str(w_path), prev_layout_wrong)
            cv2.imwrite(str(ar_path), prev_ar_wrong)

            ok_res = ref_compare.compare_pairs({
                "pairs": [{"refPath": str(r_path), "previewPath": str(m_path), "timestamp": 1.0, "sceneId": "s1"}],
                "stripOutputPath": str(td / "strip_ok.jpg"),
            })
            self.assertTrue(ok_res["ok"])
            self.assertEqual(ok_res["passThreshold"], 0.85)
            self.assertTrue(ok_res["passed"])
            self.assertFalse(ok_res["aspectRatioMismatch"])
            self.assertIn("s1", ok_res["sceneScores"])
            self.assertGreaterEqual(ok_res["sceneScores"]["s1"]["ssimMin"], 0.90)

            wrong_res = ref_compare.compare_pairs({
                "pairs": [{"refPath": str(r_path), "previewPath": str(w_path), "timestamp": 1.0, "sceneId": "s1"}],
                "stripOutputPath": str(td / "strip_bad.jpg"),
            })
            self.assertTrue(wrong_res["ok"])
            self.assertFalse(wrong_res["passed"])

            ar_res = ref_compare.compare_pairs({
                "pairs": [{"refPath": str(r_path), "previewPath": str(ar_path), "timestamp": 1.0, "sceneId": "s1"}],
                "stripOutputPath": str(td / "strip_ar.jpg"),
            })
            self.assertTrue(ar_res["ok"])
            self.assertTrue(ar_res["aspectRatioMismatch"])
            self.assertFalse(ar_res["passed"])


if __name__ == "__main__":
    unittest.main()
