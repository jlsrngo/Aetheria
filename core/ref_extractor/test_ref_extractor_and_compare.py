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

    def test_ref_structural_compare_detects_container_spill_clipped_text_and_word_drift(self):
        import ref_structural_compare as rsc

        # 1. Text alignment checks: clipped left edge, word sub-beat drift, and extra stacked row
        clip_res = rsc.evaluate_text_alignment(
            ["Movement", "Transitions", "Design"],
            ["ement", "sitions", "Design"],
        )
        self.assertTrue(clip_res["clippedTextDetected"])
        self.assertIn("CLIPPED TEXT", clip_res["textDiagnosis"])

        drift_res = rsc.evaluate_text_alignment(
            ["Thinking", "Finding", "Building"],
            ["Finding", "Building", "Creating"],
        )
        self.assertTrue(drift_res["textDriftDetected"])
        self.assertIn("TEXT SUB-BEAT/WORD MISMATCH", drift_res["textDiagnosis"])

        extra_res = rsc.evaluate_text_alignment(["Showrea"], ["SLOI", "Showreel"])
        self.assertTrue(extra_res["extraTextDetected"])
        self.assertIn("EXTRA/STACKED TEXT", extra_res["textDiagnosis"])

        # 2. Container spill check: ref has centered laptop container, preview spills outside
        ref_img = np.full((270, 480, 3), 12, dtype=np.uint8)
        cv2.rectangle(ref_img, (120, 60), (360, 210), (165, 55, 130), -1)
        prev_spill = np.full((270, 480, 3), 12, dtype=np.uint8)
        cv2.rectangle(prev_spill, (40, 25), (410, 245), (165, 55, 130), -1)

        bg = np.array([12, 12, 12], dtype=np.int16)
        st = rsc.evaluate_structural_frame_pair(
            ref_img, prev_spill, bg, 1024, 576, ref_path=None, edge_sim=0.70
        )
        self.assertTrue(st["containerSpillDetected"])
        self.assertGreater(st["structuralPenalty"], 0.10)
        self.assertIn("CONTAINER SPILL", st["structuralDiagnosis"])

    def test_ref_motion_clues_extracts_saturated_accents_container_clip_and_trajectory(self):
        import ref_motion_clues as rmc

        frames = {}
        for idx, t in enumerate([0.1, 0.3, 0.5, 0.7, 0.9, 1.1]):
            fr = np.full((576, 1024, 3), 12, dtype=np.uint8)
            x0 = 180 + idx * 45
            cv2.rectangle(fr, (x0, 220), (x0 + 240, 360), (245, 75, 140), -1)
            frames[round(t, 3)] = fr

        clues = rmc.extract_scene_motion_clues(
            lambda ts: frames.get(round(ts, 3)),
            0.0,
            1.2,
            1024,
            576,
            ocr_summary_fn=None,
            sub_ts_list=[0.1, 0.3, 0.5, 0.7, 0.9, 1.1],
        )
        self.assertTrue(len(clues.get("saturatedAccents", [])) >= 1)
        self.assertIsNotNone(clues.get("objectTrajectory"))
        self.assertEqual(len(clues.get("denseTimeline", [])), 6)

    def test_v13_hero_card_over_bright_backdrop_inline_glyph_morph_bento_icons_and_marquee(self):
        import ref_motion_clues as rmc
        import ref_structural_compare as rsc

        # 1. Scene 3 hero card over bright/blurred backdrop (v13 #2)
        scene3 = np.full((576, 1024, 3), 232, dtype=np.uint8)
        cv2.rectangle(scene3, (40, 60), (310, 510), (210, 212, 216), -1)
        cv2.rectangle(scene3, (710, 60), (980, 510), (210, 212, 216), -1)
        scene3 = cv2.GaussianBlur(scene3, (15, 15), 5.0)
        # Sharp centered vertical hero card [356, 34, 312, 506]
        cv2.rectangle(scene3, (356, 34), (668, 540), (248, 248, 250), -1)
        cv2.rectangle(scene3, (356, 34), (668, 540), (40, 42, 46), 3)
        hero_info = rmc.detect_centered_hero_card_over_bright_backdrop(scene3)
        self.assertIsNotNone(hero_info)
        hx, hy, hw, hh = hero_info["heroCardBox"]
        self.assertAlmostEqual(hx, 356, delta=24)
        self.assertAlmostEqual(hw, 312, delta=36)
        self.assertGreaterEqual(hh, 440)

        # 1b. Portrait 9:16 graph-paper frame with centered text must NOT trigger a fake heroCardBox
        portrait_grid = np.full((1280, 720, 3), 220, dtype=np.uint8)
        for gx in range(0, 720, 40):
            cv2.line(portrait_grid, (gx, 0), (gx, 1280), (200, 200, 200), 1)
        for gy in range(0, 1280, 40):
            cv2.line(portrait_grid, (0, gy), (720, gy), (200, 200, 200), 1)
        cv2.putText(portrait_grid, "Smart decisions", (170, 620), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (60, 40, 70), 3)
        self.assertIsNone(rmc.detect_centered_hero_card_over_bright_backdrop(portrait_grid))

        # 2. Scene 1 inline glyph morph clue (v13 #3)
        s1_fr = np.full((576, 1024, 3), 12, dtype=np.uint8)
        accents = [
            {"hex": "#884BF9", "box": [620, 260, 44, 52], "timestamp": 1.5},
            {"hex": "#3EF5B6", "box": [680, 260, 44, 52], "timestamp": 1.5},
        ]
        morph_clue = rmc.detect_inline_glyph_morph(
            [(1.5, s1_fr)],
            accents,
            [(1.5, ["Showrea"], [230, 252, 560, 72])],
            1024,
            576,
        )
        self.assertIsNotNone(morph_clue)
        self.assertIn("INLINE GLYPH MORPH", morph_clue)
        self.assertIn("#884BF9", morph_clue)

        # Negative test: talking-head/full-screen footage with large accents must NOT trigger inline glyph morph
        cam_fr = np.full((576, 1024, 3), 120, dtype=np.uint8)
        big_accents = [
            {"hex": "#9F6C5D", "box": [108, 200, 439, 360], "timestamp": 1.0},
            {"hex": "#3C3E6A", "box": [10, 300, 520, 260], "timestamp": 2.0},
        ]
        self.assertIsNone(
            rmc.detect_inline_glyph_morph([(1.0, cam_fr)], big_accents, [], 1024, 576)
        )

        # 3. Marquee scroll tolerance (v13 #2b)
        mq_res = rsc.evaluate_text_alignment(
            ["Motion", "Designing", "Workflow"],
            ["signing", "Workflow", "Anima"],
        )
        self.assertFalse(mq_res["textDriftDetected"])
        self.assertGreaterEqual(mq_res["textMatchScore"], 0.85)

        # 4. Empty dark bento tile cells detection (v13 #4)
        ref_bento = np.full((270, 480, 3), 14, dtype=np.uint8)
        prev_bento = np.full((270, 480, 3), 14, dtype=np.uint8)
        ch_h, cw_w = 90, 96
        for r in range(3):
            for c in range(5):
                is_light = (r + c) % 2 == 0
                bg_c = (238, 238, 240) if is_light else (28, 28, 32)
                fg_c = (28, 28, 32) if is_light else (238, 238, 240)
                x0, y0 = c * cw_w + 4, r * ch_h + 4
                x1, y1 = (c + 1) * cw_w - 4, (r + 1) * ch_h - 4
                cv2.rectangle(ref_bento, (x0, y0), (x1, y1), bg_c, -1)
                cv2.rectangle(prev_bento, (x0, y0), (x1, y1), bg_c, -1)
                # Reference has icons inside BOTH light and dark tiles
                cv2.circle(ref_bento, ((x0 + x1) // 2, (y0 + y1) // 2), 16, fg_c, 3)
                # Preview only draws icons inside light tiles, leaving dark tiles blank!
                if is_light:
                    cv2.circle(prev_bento, ((x0 + x1) // 2, (y0 + y1) // 2), 16, fg_c, 3)
        bento_diag = rsc.detect_empty_bento_tile_cells(ref_bento, prev_bento)
        self.assertIsNotNone(bento_diag)
        self.assertTrue(bento_diag["emptyTileCellsDetected"])
        self.assertIn("EMPTY BENTO CELLS", bento_diag["diagnosis"])

    def test_geometry_gate_penalizes_wrong_geometry_and_preserves_good_and_soft_glow_frames(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mc_py_geogate_") as tmp:
            td = Path(tmp)
            bg = (4, 8, 11)  # dark #0B0804 in BGR

            # Pair A: Empty dark sphere vs sphere with bright text inside (Scene 2 bug)
            ref_a = np.full((1280, 720, 3), bg, dtype=np.uint8)
            cv2.circle(ref_a, (360, 640), 260, (160, 210, 240), 6)
            cv2.putText(ref_a, "WITH A", (200, 600), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (245, 245, 250), 6)
            cv2.putText(ref_a, "MOTIONS", (175, 695), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (245, 245, 250), 6)
            prev_a = np.full((1280, 720, 3), bg, dtype=np.uint8)
            cv2.circle(prev_a, (360, 640), 260, (160, 210, 240), 6)

            # Pair B: Wide capsule vs tiny half-size pill (Scene 3 bug)
            ref_b = np.full((1280, 720, 3), bg, dtype=np.uint8)
            cv2.rectangle(ref_b, (110, 560), (610, 710), (242, 242, 245), -1)
            cv2.putText(ref_b, "FORM", (245, 655), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (16, 16, 20), 6)
            prev_b = np.full((1280, 720, 3), bg, dtype=np.uint8)
            cv2.rectangle(prev_b, (280, 605), (440, 665), (242, 242, 245), -1)

            # Pair C: 5 horizontal dots vs 4 vertical staircase bars (Scene 5 phase inversion)
            ref_c = np.full((1280, 720, 3), bg, dtype=np.uint8)
            for idx in range(5):
                cv2.circle(ref_c, (150 + idx * 105, 640), 26, (60, 175, 250), -1)
            prev_c = np.full((1280, 720, 3), bg, dtype=np.uint8)
            for idx in range(4):
                x0 = 150 + idx * 120
                cv2.rectangle(prev_c, (x0, 260 + idx * 140), (x0 + 48, 1220), (235, 235, 242), -1)

            # Pair D: Panned top-right capsule vs static center capsule (Scene 6 camera miss)
            ref_d = np.full((1280, 720, 3), (245, 248, 250), dtype=np.uint8)
            cv2.rectangle(ref_d, (390, 180), (675, 300), (28, 30, 36), -1)
            cv2.putText(ref_d, "Create", (440, 255), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (245, 245, 250), 4)
            prev_d = np.full((1280, 720, 3), (245, 248, 250), dtype=np.uint8)
            cv2.rectangle(prev_d, (210, 560), (510, 700), (28, 30, 36), -1)
            cv2.putText(prev_d, "Create", (265, 645), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (245, 245, 250), 4)

            # Pair E: Good aligned card frame
            ref_good = ref_a.copy()
            prev_good = ref_a.copy()

            # Pair F: Pure soft radial gradient glow (no sharp Canny edges)
            yy, xx = np.mgrid[0:1280, 0:720]
            dist = np.sqrt(((xx - 360.0) / 260.0) ** 2 + ((yy - 640.0) / 260.0) ** 2)
            glow = np.clip(1.0 - dist, 0.0, 1.0) ** 2.0
            ref_glow = np.zeros((1280, 720, 3), dtype=np.uint8)
            ref_glow[:, :, 0] = (bg[0] + glow * 45).astype(np.uint8)
            ref_glow[:, :, 1] = (bg[1] + glow * 130).astype(np.uint8)
            ref_glow[:, :, 2] = (bg[2] + glow * 210).astype(np.uint8)
            prev_glow = ref_glow.copy()

            paths = {}
            for name, img in [
                ("ref_a", ref_a), ("prev_a", prev_a),
                ("ref_b", ref_b), ("prev_b", prev_b),
                ("ref_c", ref_c), ("prev_c", prev_c),
                ("ref_d", ref_d), ("prev_d", prev_d),
                ("ref_good", ref_good), ("prev_good", prev_good),
                ("ref_glow", ref_glow), ("prev_glow", prev_glow),
            ]:
                p = td / f"{name}.jpg"
                cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, 94])
                paths[name] = str(p)

            res = ref_compare.compare_pairs({
                "passThreshold": 0.72,
                "stripOutputPath": str(td / "strip_geo.jpg"),
                "pairs": [
                    {"timestamp": 2.6, "refPath": paths["ref_a"], "previewPath": paths["prev_a"], "sceneId": "scene2_context"},
                    {"timestamp": 6.7, "refPath": paths["ref_b"], "previewPath": paths["prev_b"], "sceneId": "scene3_proof"},
                    {"timestamp": 11.7, "refPath": paths["ref_c"], "previewPath": paths["prev_c"], "sceneId": "scene5_beat"},
                    {"timestamp": 18.4, "refPath": paths["ref_d"], "previewPath": paths["prev_d"], "sceneId": "scene6_beat"},
                    {"timestamp": 32.3, "refPath": paths["ref_good"], "previewPath": paths["prev_good"], "sceneId": "scene9_logo"},
                    {"timestamp": 0.5, "refPath": paths["ref_glow"], "previewPath": paths["prev_glow"], "sceneId": "scene1_hook"},
                ],
            })
            self.assertTrue(res["ok"])
            self.assertIn("overallMin", res)
            pf = res["perFrame"]
            # All 4 wrong-geometry pairs must drop strictly below 0.60 with geometry gate active
            for idx, label in [(0, "empty-sphere"), (1, "tiny-pill"), (2, "phase-bars"), (3, "static-vs-panned")]:
                self.assertLess(
                    pf[idx]["combinedScore"],
                    0.60,
                    f"{label} score too high: {pf[idx]}",
                )
                self.assertTrue(pf[idx]["geometryGateApplied"], f"{label} expected geometryGateApplied=True")
            # Good frame & pure soft glow must remain high and unpenalized
            self.assertGreaterEqual(pf[4]["combinedScore"], 0.78)
            self.assertFalse(pf[4]["geometryGateApplied"])
            self.assertGreaterEqual(pf[5]["combinedScore"], 0.85)
            self.assertFalse(pf[5]["geometryGateApplied"])

            # Verify writeSceneBeatStrips=False preserves existing per-scene strip and primary strip picks largest bucket
            sentinel = b"KEEP_EXISTING_8BEAT_STRIP"
            strip1 = td / "scene_01_compare_6beats.jpg"
            strip1.write_bytes(sentinel)
            no_overwrite = ref_compare.compare_pairs({
                "stripOutputPath": str(td / "comparison_strip.jpg"),
                "writeSceneBeatStrips": False,
                "pairs": [
                    {"timestamp": 0.5, "refPath": paths["ref_glow"], "previewPath": paths["prev_glow"], "sceneId": "scene1_hook"},
                ],
            })
            self.assertTrue(no_overwrite["ok"])
            self.assertEqual(strip1.read_bytes(), sentinel)

            multi_bucket = ref_compare.compare_pairs({
                "stripOutputPath": str(td / "comparison_strip2.jpg"),
                "writeSceneBeatStrips": True,
                "pairs": [
                    {"timestamp": 0.5, "refPath": paths["ref_glow"], "previewPath": paths["prev_glow"], "sceneId": "scene1_hook"},
                    {"timestamp": 2.6, "refPath": paths["ref_a"], "previewPath": paths["prev_good"], "sceneId": "scene2_context"},
                    {"timestamp": 2.8, "refPath": paths["ref_a"], "previewPath": paths["prev_good"], "sceneId": "scene2_context"},
                    {"timestamp": 3.0, "refPath": paths["ref_a"], "previewPath": paths["prev_good"], "sceneId": "scene2_context"},
                ],
            })
            self.assertTrue(multi_bucket["ok"])
            self.assertTrue(
                str(multi_bucket.get("primarySceneBeatStripPath", "")).endswith("scene_02_compare_6beats.jpg"),
                f"expected scene_02 strip (3 tiles) over scene_01 (1 tile), got {multi_bucket.get('primarySceneBeatStripPath')}",
            )

    def test_motion_clues_extracts_top3_connected_components_and_soft_cut_metadata(self) -> None:
        import ref_motion_clues as rmc

        fr = np.full((1280, 720, 3), 10, dtype=np.uint8)
        # Object 1: top star/badge (medium)
        cv2.circle(fr, (360, 260), 65, (60, 180, 255), -1)
        # Object 2: wide center pill (largest)
        cv2.rectangle(fr, (120, 560), (600, 710), (245, 245, 250), -1)
        # Object 3: bottom accent block (smaller)
        cv2.rectangle(fr, (260, 930), (460, 1000), (220, 100, 250), -1)

        clues = rmc.extract_scene_motion_clues(
            lambda _ts: fr,
            2.0,
            4.0,
            720,
            1280,
            ocr_summary_fn=None,
            sub_ts_list=[2.1, 2.6, 3.1, 3.6],
        )
        timeline = clues.get("denseTimeline") or []
        self.assertGreaterEqual(len(timeline), 4)
        first = timeline[0]
        self.assertIn("localT", first)
        self.assertAlmostEqual(first["localT"], 0.1, places=2)
        objs = first.get("objects") or []
        self.assertEqual(len(objs), 3, f"expected 3 separate connected components, got {objs}")
        self.assertGreaterEqual(objs[0]["areaFrac"], objs[1]["areaFrac"])

        with tempfile.TemporaryDirectory(prefix="mc_py_softcut_") as tmp:
            td = Path(tmp)
            mp4 = td / "soft_cut.mp4"
            writer = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), 15.0, (320, 180))
            self.assertTrue(writer.isOpened())
            s1 = np.full((180, 320, 3), 18, dtype=np.uint8)
            cv2.circle(s1, (80, 90), 34, (40, 160, 240), -1)
            s2 = np.full((180, 320, 3), 232, dtype=np.uint8)
            cv2.rectangle(s2, (160, 40), (280, 140), (40, 40, 200), -1)
            for _ in range(18):
                writer.write(s1)
            for k in range(6):
                a = (k + 1) / 6.0
                writer.write(cv2.addWeighted(s1, 1.0 - a, s2, a, 0.0))
            for _ in range(18):
                writer.write(s2)
            writer.release()

            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"), fast_mode=True)
            self.assertTrue(res.get("success"), res)
            bp_scenes = res["blueprint"]["scenes"]
            self.assertGreaterEqual(len(bp_scenes), 2)
            for sc in bp_scenes:
                self.assertIn("cutEvidence", sc)
                self.assertIn("transitionFromPrev", sc)
                mc = sc.get("motionClues") or {}
                self.assertGreaterEqual(len(mc.get("denseTimeline") or []), 4)
                self.assertIn("boundaryAnchors", mc)

        # Verify multi-phase OCR runs on Q1/mid/Q3/end slices when scene has > 4 slices
        ocr_calls: list[int] = []
        frame_tags: dict[int, int] = {}

        def _frame_at_idx(ts_val: float) -> np.ndarray:
            tag = int(round(ts_val * 10))
            fr_i = np.full((360, 640, 3), 240, dtype=np.uint8)
            cv2.rectangle(fr_i, (120, 120), (420, 240), (20, 20, 30), -1)
            cv2.putText(fr_i, str(tag), (140, 190), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (240, 240, 240), 2)
            frame_tags[id(fr_i)] = tag
            return fr_i

        def _spy_ocr(fr_in: np.ndarray) -> list[str]:
            tag = int(frame_tags.get(id(fr_in), -1))
            ocr_calls.append(tag)
            return [f"word_{tag}"]

        multi_clues = rmc.extract_scene_motion_clues(
            _frame_at_idx,
            0.0,
            6.0,
            640,
            360,
            ocr_summary_fn=_spy_ocr,
            sub_ts_list=[0.3, 1.0, 1.7, 2.5, 3.4, 4.2, 5.0, 5.7],
        )
        self.assertGreaterEqual(len(ocr_calls), 5, f"expected multi-phase Q1/mid/Q3 OCR calls, got {ocr_calls}")
        self.assertGreaterEqual(len(multi_clues.get("denseTimeline") or []), 8)

    def test_element_tracks_verdict_geometri_beda_and_color_drift(self) -> None:
        import ref_element_tracks as ret
        import ref_structural_compare as rsc

        # K3 synthetic test: saturated rounded pill moving diagonally over a striped light gradient background
        w, h = 720, 1280
        base = np.zeros((h, w, 3), dtype=np.uint8)
        for y in range(h):
            v = int(218 + 24 * (y / float(h)))
            base[y, :, :] = (v, v, v)
        for x in range(40, w, 60):
            cv2.line(base, (x, 0), (x, h), (205, 205, 208), 1)

        def _synth_at(ts: float) -> np.ndarray:
            p = max(0.0, min(1.0, ts / 2.0))
            cx = int(round(120 + (540 - 120) * p))
            cy = int(round(220 + (880 - 220) * p))
            fr = base.copy()
            cv2.rectangle(fr, (cx - 75, cy - 35), (cx + 75, cy + 35), (47, 172, 246), -1)  # #F6AC2F in BGR
            return fr

        tracks = ret.extract_scene_element_tracks(_synth_at, 0.0, 2.0, w, h, step_sec=0.25)
        self.assertGreaterEqual(len(tracks), 1, "expected at least 1 salient track")
        tr1 = tracks[0]
        self.assertGreaterEqual(tr1["displacementPx"], 650.0)
        pts = tr1["points"]
        self.assertLessEqual(abs(pts[0]["cx"] - 124), 6)
        self.assertLessEqual(abs(pts[0]["cy"] - 226), 6)
        self.assertLessEqual(abs(pts[-1]["cx"] - 536), 6)
        self.assertLessEqual(abs(pts[-1]["cy"] - 874), 6)

        # K6 test: #F6AC2F (BGR 47,172,246) vs #E9791D (BGR 29,121,233) emits COLOR DRIFT; identical -> None
        img_ref = np.full((120, 120, 3), 24, dtype=np.uint8)
        img_prev = np.full((120, 120, 3), 24, dtype=np.uint8)
        cv2.circle(img_ref, (60, 60), 34, (47, 172, 246), -1)
        cv2.circle(img_prev, (60, 60), 34, (29, 121, 233), -1)
        drift_msg = rsc.detect_color_and_luma_drift(img_ref, img_prev)
        self.assertIsNotNone(drift_msg)
        self.assertIn("COLOR DRIFT", drift_msg)
        self.assertIsNone(rsc.detect_color_and_luma_drift(img_ref, img_ref.copy()))

        # K5 test: foreground present with edge_sim <= 0.15 yields verdict == "geometri_beda"
        with tempfile.TemporaryDirectory(prefix="mc_py_geobeda_") as tmp:
            td = Path(tmp)
            ref_shape = np.full((320, 180, 3), 12, dtype=np.uint8)
            cv2.rectangle(ref_shape, (35, 70), (145, 250), (240, 240, 240), -1)
            prev_wrong = np.full((320, 180, 3), 12, dtype=np.uint8)
            cv2.circle(prev_wrong, (90, 160), 42, (240, 240, 240), -1)
            rp = td / "ref.png"
            pp = td / "prev.png"
            cv2.imwrite(str(rp), ref_shape)
            cv2.imwrite(str(pp), prev_wrong)
            res_cmp = ref_compare.compare_pairs({
                "stripOutputPath": str(td / "s.jpg"),
                "pairs": [{"timestamp": 0.5, "refPath": str(rp), "previewPath": str(pp), "sceneId": "scene1"}],
            })
            self.assertEqual(res_cmp["perFrame"][0]["verdict"], "geometri_beda", res_cmp["perFrame"][0])

    def test_motion_kinematics_and_stiffness_warning(self) -> None:
        import math
        import ref_motion_kinematics as rmk

        w, h = 720, 1280
        # 1a. Zoom-in expanding textured hero card
        def _zoom_fr(ts: float) -> np.ndarray:
            fr = np.full((h, w, 3), 220, dtype=np.uint8)
            p = max(0.0, min(1.0, (ts - 0.35) / 0.85))
            hw = int(95 * (0.6 + 1.0 * p))
            hh = int(70 * (0.6 + 1.0 * p))
            cv2.rectangle(fr, (360 - hw, 640 - hh), (360 + hw, 640 + hh), (150, 12, 55), -1)
            cv2.putText(fr, "ZOOM", (360 - hw // 2, 650), cv2.FONT_HERSHEY_SIMPLEX, 0.8 + 0.6 * p, (255, 255, 255), 3)
            return fr

        kin_zoom = rmk.extract_scene_motion_kinematics(_zoom_fr, 0.0, 1.6, w, h)
        self.assertTrue(any(b["kind"] == "zoom_in" and b["scaleRatio"] > 1.3 for b in kin_zoom["motionBursts"]), kin_zoom)

        # 1b. Vertical pan-up stage
        def _pan_fr(ts: float) -> np.ndarray:
            fr = np.full((h, w, 3), 220, dtype=np.uint8)
            p = max(0.0, min(1.0, (ts - 0.4) / 0.7))
            cy = int(round(780 - 180 * p))
            cv2.rectangle(fr, (190, cy - 110), (530, cy + 110), (35, 130, 230), -1)
            cv2.circle(fr, (360, cy), 44, (240, 240, 240), -1)
            return fr

        kin_pan = rmk.extract_scene_motion_kinematics(_pan_fr, 0.0, 1.6, w, h)
        self.assertTrue(any(b["kind"] == "pan_up" and b["dyPx"] < -50 for b in kin_pan["motionBursts"]), kin_pan)

        # 1c. Living hold vs static hold
        def _living_fr(ts: float) -> np.ndarray:
            fr = np.full((h, w, 3), 218, dtype=np.uint8)
            ang = ts * 2.8
            for k in range(18):
                a = ang + k * (2 * math.pi / 18)
                px = int(360 + math.cos(a) * 145)
                py = int(500 + math.sin(a) * 145)
                cv2.circle(fr, (px, py), 6, (40, 40, 44), -1)
            sway_x = int(360 + math.sin(ts * 4.0) * 18)
            cv2.circle(fr, (sway_x, 500), 68, (140, 120, 105), -1)
            return fr

        kin_live = rmk.extract_scene_motion_kinematics(_living_fr, 0.0, 2.0, w, h)
        self.assertTrue(kin_live["hasLivingHold"], kin_live)
        self.assertGreaterEqual(kin_live["activeFramePct"], 70.0)

        kin_static = rmk.extract_scene_motion_kinematics(lambda _t: _zoom_fr(0.0), 0.0, 1.4, w, h)
        self.assertFalse(kin_static["hasLivingHold"], kin_static)

        # 2. Motion stiffness warning on stiff preview vs lively ref
        ref_seq = [(i * 0.25, cv2.cvtColor(_pan_fr(i * 0.25), cv2.COLOR_BGR2GRAY)) for i in range(6)]
        stiff_base = cv2.cvtColor(_pan_fr(0.4), cv2.COLOR_BGR2GRAY)
        stiff_seq = [(i * 0.25, stiff_base.copy()) for i in range(6)]
        md_stiff = ref_compare._compute_motion_step_diagnostics(ref_seq, stiff_seq)
        self.assertLess(md_stiff["motionEnergyRatio"], 0.35)
        self.assertIn("MOTION STIFFNESS WARNING", md_stiff["motionWarning"] or "")
        md_live = ref_compare._compute_motion_step_diagnostics(ref_seq, ref_seq)
        self.assertNotIn("MOTION STIFFNESS WARNING", md_live["motionWarning"] or "")


if __name__ == "__main__":
    unittest.main()
