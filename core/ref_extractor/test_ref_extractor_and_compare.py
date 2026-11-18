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

    def test_ref_extractor_detects_dark_on_dark_structural_cuts(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mc_py_darkcuts_") as tmp:
            td = Path(tmp)
            mp4 = td / "dark_cuts.mp4"
            writer = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (320, 180))
            self.assertTrue(writer.isOpened())
            # Shot 1 (0.0-1.6s): dark #0C0B0E with top-left circle
            for _ in range(16):
                frame = np.full((180, 320, 3), 12, dtype=np.uint8)
                cv2.circle(frame, (60, 55), 32, (220, 220, 230), -1)
                writer.write(frame)
            # Shot 2 (1.6-3.2s): same dark #0C0B0E with bottom-right wide bar (dark-on-dark swap)
            for _ in range(16):
                frame = np.full((180, 320, 3), 12, dtype=np.uint8)
                cv2.rectangle(frame, (175, 105), (295, 160), (210, 120, 240), -1)
                writer.write(frame)
            # Shot 3 (3.2-4.8s): same dark #0C0B0E with center rotated cross
            for _ in range(16):
                frame = np.full((180, 320, 3), 12, dtype=np.uint8)
                cv2.line(frame, (125, 25), (195, 95), (240, 240, 245), 8)
                cv2.line(frame, (195, 25), (125, 95), (240, 240, 245), 8)
                writer.write(frame)
            writer.release()

            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"))
            self.assertTrue(res.get("success"), res)
            bp = res["blueprint"]
            cuts = bp["scenes"]
            self.assertGreaterEqual(len(cuts), 3, f"expected >=3 dark-on-dark scenes, got {len(cuts)}")
            self.assertIn("audioProfile", bp)
            self.assertTrue(bp.get("contactSheets"), "expected dense contact sheet(s) generated")
            self.assertTrue((td / "out" / bp["contactSheets"][0]).is_file())

    def test_font_weight_estimation_distinguishes_thin_from_bold(self) -> None:
        def _draw_sample(thickness: int) -> np.ndarray:
            c = np.full((120, 320, 3), 12, dtype=np.uint8)
            for ox in (40, 110, 180, 250):
                cv2.line(c, (ox, 28), (ox, 92), (240, 240, 245), thickness, cv2.LINE_8)
                cv2.line(c, (ox + 34, 28), (ox + 34, 92), (240, 240, 245), thickness, cv2.LINE_8)
                cv2.line(c, (ox, 60), (ox + 34, 60), (240, 240, 245), thickness, cv2.LINE_8)
            return c

        w_thin = ref_extractor.estimate_text_font_weight(_draw_sample(3), [25, 18, 275, 86])
        w_bold = ref_extractor.estimate_text_font_weight(_draw_sample(14), [25, 18, 275, 86])
        self.assertIn(w_thin, ("400", "500"))
        self.assertEqual(w_bold, "800")

    def test_clean_plate_reconciles_dark_palette_and_luma_correlation_detects_inversion(self):
        pal = {"bgHex": "#746970", "textHex": "#F3ECED", "accentHex": "#F3ECED", "isDark": True}
        cp = {"fillHex": "#E0D6D9", "bottomHex": "#E0D6D9", "hasGradient": False}
        fixed = ref_extractor.reconcile_palette_with_clean_plate(pal, cp)
        self.assertEqual(fixed["bgHex"], "#E0D6D9")
        self.assertFalse(fixed["isDark"])
        self.assertEqual(fixed["textHex"], "#1E2021")

        # Inverted black/white checkerboard yields negative luma correlation
        a = np.zeros((180, 320, 3), dtype=np.uint8)
        b = np.full((180, 320, 3), 240, dtype=np.uint8)
        a[:, :160] = 240
        b[:, :160] = 10
        corr = ref_compare.compute_luma_correlation(a, b)
        self.assertLess(corr, -0.5)

    def test_detect_grid_tilt_deg_measures_tilted_grid_and_ignores_straight(self):
        board = np.zeros((576, 1024, 3), dtype=np.uint8)
        cw, ch = 128, 128
        for r in range(-1, 6):
            for c in range(-1, 10):
                col = (240, 240, 240) if (r + c) % 2 == 0 else (20, 20, 24)
                x0, y0 = max(0, c * cw), max(0, r * ch)
                x1, y1 = min(1024, (c + 1) * cw), min(576, (r + 1) * ch)
                if x1 > x0 and y1 > y0:
                    cv2.rectangle(board, (x0, y0), (x1, y1), col, -1)
        self.assertIsNone(ref_extractor.detect_grid_tilt_deg(board))
        ct = ref_extractor.detect_bimodal_contrast_tiles(board)
        self.assertIsNotNone(ct)
        self.assertEqual(ct["topLeft"], "light")

        mat = cv2.getRotationMatrix2D((512, 288), 7.0, 1.0)
        tilted = cv2.warpAffine(board, mat, (1024, 576), borderMode=cv2.BORDER_REFLECT)
        deg = ref_extractor.detect_grid_tilt_deg(tilted)
        self.assertIsNotNone(deg)
        self.assertLess(deg, -4.5)
        self.assertGreater(deg, -9.5)

    def test_measure_contrast_tile_grid_reads_irregular_wall_not_checkerboard(self):
        expected = ["LDLLDL", "DDLDLL", "LLDLDD"]
        pitch_x, pitch_y, gap = 170, 192, 8
        wall = np.full((576, 1024, 3), 6, dtype=np.uint8)
        for r, row in enumerate(expected):
            for c, cell in enumerate(row):
                col = (236, 238, 240) if cell == "L" else (33, 30, 29)
                x0, y0 = c * pitch_x + gap // 2, r * pitch_y + gap // 2
                cv2.rectangle(wall, (x0, y0), (x0 + pitch_x - gap, y0 + pitch_y - gap), col, -1)
        grid = ref_extractor.measure_contrast_tile_grid(wall, None)
        self.assertIsNotNone(grid)
        self.assertAlmostEqual(grid["pitchX"], pitch_x, delta=6)
        self.assertAlmostEqual(grid["pitchY"], pitch_y, delta=6)
        self.assertEqual([row[:6] for row in grid["map"][:3]], expected)

    def test_non_rectangular_arrow_contour_is_not_labeled_pill(self):
        frame = np.full((576, 1024, 3), 12, dtype=np.uint8)
        # Concave chevron/arrow silhouette matching Scene 4 (~210x56 bounding box, low rectangularity)
        pts = np.array([[420, 390], [520, 340], [630, 390], [520, 372]], dtype=np.int32)
        cv2.fillPoly(frame, [pts], (235, 220, 250))
        layout = ref_extractor.analyze_frame_layout(frame, ocr_engine=None)
        self.assertEqual(layout["pill_count"], 0)
        kinds = [r.get("kind") for r in layout["regions"]]
        self.assertNotIn("pill", kinds)

    def test_build_scene_beats_strip_creates_high_res_grid(self):
        with tempfile.TemporaryDirectory() as td:
            out_path = Path(td) / "ref_scene_01_beats.jpg"
            frames = {
                t: np.full((576, 1024, 3), int(30 + idx * 30), dtype=np.uint8)
                for idx, t in enumerate([0.5, 0.9, 1.3, 1.7, 2.2, 2.7])
            }
            name = ref_extractor.build_scene_beats_strip(
                lambda ts: frames.get(ts),
                list(frames.keys()),
                1024,
                576,
                out_path,
            )
            self.assertEqual(name, "ref_scene_01_beats.jpg")
            img = cv2.imread(str(out_path))
            self.assertIsNotNone(img)
            # 3 cols x 2 rows at 512x288 per panel => 1536x576
            self.assertEqual(img.shape[1], 1536)
            self.assertEqual(img.shape[0], 576)

    def test_ref_compare_flags_blank_dark_preview_as_crashed_not_passing(self):
        with tempfile.TemporaryDirectory() as td:
            ref_img = np.full((360, 640, 3), 12, dtype=np.uint8)
            cv2.putText(ref_img, "SHOWREEL", (90, 200), cv2.FONT_HERSHEY_SIMPLEX, 2.4, (240, 240, 245), 6)
            blank_prev = np.full((360, 640, 3), 12, dtype=np.uint8)
            ref_p = Path(td) / "ref.jpg"
            prev_p = Path(td) / "blank.jpg"
            cv2.imwrite(str(ref_p), ref_img)
            cv2.imwrite(str(prev_p), blank_prev)
            res = ref_compare.compare_pairs({
                "passThreshold": 0.65,
                "stripOutputPath": str(Path(td) / "strip.jpg"),
                "pairs": [{"timestamp": 1.0, "refPath": str(ref_p), "previewPath": str(prev_p)}],
            })
            self.assertTrue(res["ok"])
            pf = res["perFrame"][0]
            self.assertTrue(pf["blankFrameDetected"])
            self.assertLessEqual(pf["combinedScore"], 0.15)
            self.assertEqual(pf["verdict"], "beda")

            exact_res = ref_compare.compare_pairs({
                "passThreshold": 0.65,
                "stripOutputPath": str(Path(td) / "strip_ok.jpg"),
                "pairs": [{"timestamp": 1.0, "refPath": str(ref_p), "previewPath": str(ref_p)}],
            })
            self.assertFalse(exact_res["perFrame"][0]["blankFrameDetected"])
            self.assertGreaterEqual(exact_res["perFrame"][0]["combinedScore"], 0.95)


if __name__ == "__main__":
    unittest.main()
