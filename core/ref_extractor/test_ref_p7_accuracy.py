"""Synthetic-only accuracy unit tests for Prompt 7 (R1 cuts/BPM, R2 cameraMotion + AM.applyCamera round-trip).

Never references or loads any file from `benchmarks/`. All test fixtures are generated
deterministically in temporary directories via `synth_reference.py`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ref_camera_motion
import ref_compare
import ref_extractor
import ref_temporal_cuts
import synth_reference


class RefExtractorP7AccuracyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_ocr = os.environ.get("AETHERIA_DISABLE_OCR")
        os.environ["AETHERIA_DISABLE_OCR"] = "1"

    def tearDown(self) -> None:
        if self._prev_ocr is None:
            os.environ.pop("AETHERIA_DISABLE_OCR", None)
        else:
            os.environ["AETHERIA_DISABLE_OCR"] = self._prev_ocr

    def test_r1_d1_hard_cut_never_shifted_by_audio_onset(self) -> None:
        raw_cuts = [
            {"cutSec": 0.0, "evidence": "start", "diffScore": 0.0, "frameIndex": 0},
            {"cutSec": 2.000, "evidence": "hard", "diffScore": 0.42, "frameIndex": 60},
            {"cutSec": 4.000, "evidence": "soft", "diffScore": 0.14, "frameIndex": 120},
        ]
        beats = [0.500, 2.090, 4.080, 5.500]
        aligned = ref_temporal_cuts.align_cuts_with_beats(raw_cuts, beats, duration=6.0, max_snap_sec=0.12)
        self.assertEqual(len(aligned), 3)
        # Hard cut MUST NOT shift toward nearest audio onset (D1)
        self.assertAlmostEqual(aligned[1]["cutSec"], 2.000, places=3)
        self.assertEqual(aligned[1]["evidence"], "hard")
        self.assertAlmostEqual(aligned[1]["nearestOnsetSec"], 2.090, places=3)
        # Soft/structural cut MAY snap within max_snap_sec and report nearestOnsetSec
        self.assertAlmostEqual(aligned[2]["cutSec"], 4.080, places=3)
        self.assertEqual(aligned[2]["evidence"], "soft")
        self.assertAlmostEqual(aligned[2]["nearestOnsetSec"], 4.080, places=3)

    def test_r1_hard_cuts_frame_accurate_crossfade_not_hard_and_bpm_fallback(self) -> None:
        spec = {
            "name": "unit_r1_cuts",
            "width": 640,
            "height": 360,
            "fps": 30,
            "hasAudio": False,
            "scenes": [
                {"id": "s1", "kind": "textured", "seed": 11, "durationSec": 1.6, "bgBgr": [20, 22, 30]},
                {"id": "s2", "kind": "textured", "seed": 22, "durationSec": 1.6, "bgBgr": [232, 228, 220], "transitionFromPrev": "hard"},
                {"id": "s3", "kind": "textured", "seed": 33, "durationSec": 1.8, "bgBgr": [30, 34, 46], "transitionFromPrev": "crossfade", "transitionDurSec": 0.6},
                {"id": "s4", "kind": "textured", "seed": 44, "durationSec": 1.6, "bgBgr": [238, 236, 232], "transitionFromPrev": "hard"},
            ],
        }
        with tempfile.TemporaryDirectory(prefix="p7_u_r1_") as tmp:
            td = Path(tmp)
            mp4 = td / "r1.mp4"
            truth = synth_reference.generate_synthetic_clip(spec, mp4)
            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"))
            self.assertTrue(res.get("success"), res)
            bp = res["blueprint"]
            ast_doc = res["motionAst"]
            cuts = bp.get("cuts") or []

            # Exact hard cuts within <= 1 frame
            hard_pred = [c["cutSec"] for c in cuts if c.get("evidence") == "hard"]
            hard_true = [c["t"] for c in truth["hardCuts"]]
            self.assertEqual(len(hard_true), 2)
            for tc in hard_true:
                nearest = min(hard_pred, key=lambda p: abs(p - tc))
                err_frames = abs(nearest - tc) * 30.0
                self.assertLessEqual(err_frames, 1.0, f"hard cut {tc}s drifted by {err_frames:.2f}f (pred={hard_pred})")

            # Soft crossfade window must NEVER be tagged as evidence == "hard"
            for st in truth["softTransitions"]:
                for c in cuts:
                    if st["tStart"] - 0.15 <= c["cutSec"] <= st["tEnd"] + 0.15:
                        self.assertNotEqual(c.get("evidence"), "hard", f"crossfade wrongly marked hard: {c}")

            # Honest BPM fallback on silent clip
            self.assertEqual(bp.get("bpmSource"), "fallback")
            self.assertEqual(ast_doc.get("bpmSource"), "fallback")
            self.assertEqual(bp.get("bpmConfidence"), 0.0)
            report_text = (td / "out" / "ref_report.md").read_text(encoding="utf-8")
            self.assertIn("BPM tak terukur", report_text)

    def test_r2_camera_motion_accuracy_and_am_apply_camera_roundtrip_ssim(self) -> None:
        w, h, fps = 640, 360, 30
        spec = {
            "name": "unit_r2_cam",
            "width": w,
            "height": h,
            "fps": fps,
            "hasAudio": False,
            "scenes": [
                {
                    "id": "cam_zoom_rot_pan",
                    "kind": "textured",
                    "seed": 77,
                    "durationSec": 2.0,
                    "bgBgr": [22, 24, 30],
                    "camera": {
                        "t0": 0.4,
                        "t1": 1.9,
                        "scaleFrom": 1.0,
                        "scaleTo": 1.75,
                        "rotDegFrom": 0.0,
                        "rotDegTo": 2.4,
                        "txFrom": 0.0,
                        "txTo": 18.0,
                        "tyFrom": 0.0,
                        "tyTo": -12.0,
                        "ease": "inCubic",
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory(prefix="p7_u_r2_") as tmp:
            td = Path(tmp)
            mp4 = td / "r2.mp4"
            synth_reference.generate_synthetic_clip(spec, mp4)
            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"))
            self.assertTrue(res.get("success"), res)

            sc = res["motionAst"]["scenes"][0]
            cm = sc.get("cameraMotion")
            self.assertIsNotNone(cm, "cameraMotion should be detected")
            segs = cm.get("segments") or []
            self.assertGreaterEqual(len(segs), 1)
            seg = segs[0]
            self.assertNotEqual(seg.get("confidence"), "low")
            self.assertIn("AM.applyCamera", sc.get("amCodeSkeleton", ""))

            # Evaluate extracted trajectory against ground truth at exact frame 48 (t = 1.600s)
            eval_frame = 48
            eval_t = eval_frame / float(fps)
            u_true = (eval_t - 0.4) / (1.9 - 0.4)
            p_true = u_true ** 3
            s_true = 1.0 + 0.75 * p_true
            r_true = 2.4 * p_true
            tx_true = 18.0 * p_true
            ty_true = -12.0 * p_true

            t0, t1 = float(seg["t0"]), float(seg["t1"])
            u_pred = max(0.0, min(1.0, (eval_t - t0) / max(1e-4, t1 - t0)))
            p_pred = synth_reference._eval_ease(str(seg["ease"]), u_pred)
            s_pred = float(seg["scaleFrom"]) + (float(seg["scaleTo"]) - float(seg["scaleFrom"])) * p_pred
            r_pred = float(seg["rotDegFrom"]) + (float(seg["rotDegTo"]) - float(seg["rotDegFrom"])) * p_pred
            tx_pred = float(seg["txFrom"]) + (float(seg["txTo"]) - float(seg["txFrom"])) * p_pred
            ty_pred = float(seg["tyFrom"]) + (float(seg["tyTo"]) - float(seg["tyFrom"])) * p_pred

            self.assertLessEqual(abs(s_pred - s_true) / s_true * 100.0, 2.5)
            self.assertLessEqual(abs(r_pred - r_true), 0.3)
            self.assertLessEqual(abs(tx_pred - tx_true), 3.5)
            self.assertLessEqual(abs(ty_pred - ty_true), 3.5)

            # R2.5 Round-trip test: apply extracted AM.applyCamera params to synthetic canvas -> SSIM >= 0.90 vs clip frame
            base_canvas = synth_reference.make_textured_canvas(w, h, seed=77, bg_bgr=(22, 24, 30))
            rt_frame = 57  # t = 1.900s (full zoom=1.75, rot=+2.4deg, pan=(+18,-12))
            rt_t = rt_frame / float(fps)
            u_rt = max(0.0, min(1.0, (rt_t - t0) / max(1e-4, t1 - t0)))
            p_rt = synth_reference._eval_ease(str(seg["ease"]), u_rt)
            s_rt = float(seg["scaleFrom"]) + (float(seg["scaleTo"]) - float(seg["scaleFrom"])) * p_rt
            r_rt = float(seg["rotDegFrom"]) + (float(seg["rotDegTo"]) - float(seg["rotDegFrom"])) * p_rt
            tx_rt = float(seg["txFrom"]) + (float(seg["txTo"]) - float(seg["txFrom"])) * p_rt
            ty_rt = float(seg["tyFrom"]) + (float(seg["tyTo"]) - float(seg["tyFrom"])) * p_rt

            cap = cv2.VideoCapture(str(mp4))
            cap.set(cv2.CAP_PROP_POS_FRAMES, rt_frame)
            ok_t, frame_t = cap.read()
            cap.release()
            self.assertTrue(ok_t and frame_t is not None)

            am_params = ref_camera_motion.camera_params_to_am_apply_camera(
                s_rt, r_rt, tx_rt, ty_rt, w, h
            )
            warped = synth_reference.apply_camera_to_frame(
                base_canvas,
                am_params["s"],
                am_params["cx"],
                am_params["cy"],
                am_params["rot"],
                border_bgr=(22, 24, 30),
            )
            ssim_val = ref_compare.compute_rgb_ssim(frame_t, warped)
            self.assertGreaterEqual(ssim_val, 0.90, f"Round-trip AM.applyCamera SSIM too low: {ssim_val:.4f}")

    def test_r2_negative_controls_no_false_camera_motion(self) -> None:
        spec = {
            "name": "unit_r2_controls",
            "width": 640,
            "height": 360,
            "fps": 30,
            "hasAudio": False,
            "scenes": [
                {"id": "ctrl_static", "kind": "textured", "seed": 81, "durationSec": 1.6, "bgBgr": [24, 24, 28]},
                {"id": "ctrl_moving_obj", "kind": "moving-object-static-bg", "seed": 82, "durationSec": 1.6, "bgBgr": [228, 226, 222], "transitionFromPrev": "hard"},
                {"id": "ctrl_dark_empty", "kind": "dark-featureless", "seed": 83, "durationSec": 1.6, "bgBgr": [10, 10, 12], "transitionFromPrev": "hard"},
            ],
        }
        with tempfile.TemporaryDirectory(prefix="p7_u_r2_ctrl_") as tmp:
            td = Path(tmp)
            mp4 = td / "r2_ctrl.mp4"
            synth_reference.generate_synthetic_clip(spec, mp4)
            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"))
            self.assertTrue(res.get("success"), res)
            for sc in res["motionAst"]["scenes"]:
                cm = sc.get("cameraMotion")
                if cm is not None:
                    for seg in cm.get("segments") or []:
                        self.assertEqual(seg.get("confidence"), "low", f"Control falsely flagged active camera: {sc['id']} -> {cm}")

    def test_r3_adaptive_beat_strip_captures_cut_bounds_and_late_camera_climax(self) -> None:
        spec = {
            "name": "unit_r3_strip",
            "width": 640,
            "height": 360,
            "fps": 30,
            "hasAudio": False,
            "scenes": [
                {"id": "intro", "kind": "textured", "seed": 91, "durationSec": 1.2, "bgBgr": [230, 228, 224]},
                {
                    "id": "late_zoom_scene",
                    "kind": "textured",
                    "seed": 92,
                    "durationSec": 2.2,
                    "bgBgr": [18, 20, 26],
                    "transitionFromPrev": "hard",
                    "camera": {
                        "t0": 1.75,
                        "t1": 2.15,
                        "scaleFrom": 1.0,
                        "scaleTo": 1.65,
                        "rotDegFrom": 0.0,
                        "rotDegTo": 2.1,
                        "txFrom": 0.0,
                        "txTo": 0.0,
                        "tyFrom": 0.0,
                        "tyTo": 0.0,
                        "ease": "inCubic",
                    },
                },
            ],
        }
        with tempfile.TemporaryDirectory(prefix="p7_u_r3_") as tmp:
            td = Path(tmp)
            mp4 = td / "r3.mp4"
            synth_reference.generate_synthetic_clip(spec, mp4)
            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"))
            self.assertTrue(res.get("success"), res)
            sc2 = res["motionAst"]["scenes"][1]
            panels = sc2.get("beatStripPanels") or []
            ts_list = sc2.get("beatStripTimestamps") or []
            self.assertGreaterEqual(len(panels), 4)
            self.assertLessEqual(len(panels), 6)
            self.assertEqual(ts_list, sorted(ts_list), "beatStripTimestamps must be chronological")
            # First panel within <= 0.15s after exact cut
            self.assertLessEqual(ts_list[0] - sc2["start"], 0.15)
            # Last panel near scene end capturing late zoom climax (t >= start + 2.05s)
            self.assertGreaterEqual(ts_list[-1], sc2["start"] + 2.05)
            reasons = {p["reason"] for p in panels}
            self.assertIn("scene-start", reasons)
            self.assertIn("scene-end", reasons)
            self.assertTrue("camera-peak" in reasons or "camera-climax" in reasons, f"expected camera reason in {reasons}")

    def test_r4_tile_wall_clean_plate_dark_and_light_gaps_and_polarity_guard(self) -> None:
        # 1. Both dark-gap (no reveal intro — seams only!) and light-gap (no reveal intro — seams only!)
        spec = {
            "name": "unit_r4_tiles",
            "width": 1024,
            "height": 576,
            "fps": 24,
            "hasAudio": False,
            "scenes": [
                {
                    "id": "dark_tile_full",
                    "kind": "tile-wall",
                    "durationSec": 1.6,
                    "bgBgr": (14, 11, 12),  # #0C0B0E
                    "lightTileBgr": (236, 238, 240),
                    "darkTileBgr": (30, 28, 26),
                    "tiltDeg": -2.8,
                    "revealIntro": False,
                },
                {
                    "id": "light_tile_full",
                    "kind": "tile-wall",
                    "durationSec": 1.6,
                    "transitionFromPrev": "hard",
                    "bgBgr": (240, 236, 232),  # #E8ECF0
                    "lightTileBgr": (250, 248, 246),
                    "darkTileBgr": (28, 26, 24),
                    "tiltDeg": 2.4,
                    "revealIntro": False,
                },
            ],
        }
        with tempfile.TemporaryDirectory(prefix="p7_u_r4_") as tmp:
            td = Path(tmp)
            mp4 = td / "r4.mp4"
            synth_reference.generate_synthetic_clip(spec, mp4)
            res = ref_extractor.extract_reference_blueprint(str(mp4), str(td / "out"))
            self.assertTrue(res.get("success"), res)
            sc_dark, sc_light = res["motionAst"]["scenes"][0], res["motionAst"]["scenes"][1]
            cp_dark = sc_dark["cleanPlate"]
            cp_light = sc_light["cleanPlate"]

            self.assertEqual(cp_dark.get("kind"), "tile-wall")
            self.assertEqual(cp_light.get("kind"), "tile-wall")

            def _rgb(hx: str):
                s = hx.lstrip("#")
                return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))

            dr = _rgb(cp_dark["fillHex"])
            lr = _rgb(cp_light["fillHex"])
            self.assertLessEqual(max(abs(dr[0] - 12), abs(dr[1] - 11), abs(dr[2] - 14)), 12, f"dark tile fill wrong: {cp_dark}")
            self.assertLessEqual(max(abs(lr[0] - 232), abs(lr[1] - 236), abs(lr[2] - 240)), 12, f"light tile fill wrong: {cp_light}")

        # 2. Polarity guard: reconcile_palette_with_clean_plate must NOT overwrite dark bgHex on tile-wall or low confidence
        dark_pal = {"bgHex": "#0C0B0E", "textHex": "#F4F4F6", "accentHex": "#7D56EF", "isDark": True}
        reconciled_low = ref_extractor.reconcile_palette_with_clean_plate(
            dark_pal, {"fillHex": "#DCDAD6", "kind": "tile-wall", "confidence": "low"}
        )
        self.assertEqual(reconciled_low["bgHex"], "#0C0B0E")
        self.assertTrue(reconciled_low["isDark"])
        reconciled_tw_light = ref_extractor.reconcile_palette_with_clean_plate(
            dark_pal, {"fillHex": "#EAECEF", "kind": "tile-wall", "confidence": "high"}
        )
        self.assertEqual(reconciled_tw_light["bgHex"], "#0C0B0E")
        self.assertTrue(reconciled_tw_light["isDark"])

    def test_r1_isolated_shared_bg_hard_cut_detected_without_early_soft_cut(self) -> None:
        w, h, fps = 640, 360, 30.0

        def _grid_frame(variant: int) -> np.ndarray:
            fr = np.full((h, w, 3), (222, 224, 224), dtype=np.uint8)
            for gx in range(20, w, 40):
                cv2.line(fr, (gx, 0), (gx, h), (204, 206, 206), 1)
            for gy in range(20, h, 40):
                cv2.line(fr, (0, gy), (w, gy), (204, 206, 206), 1)
            if variant == 1:
                cv2.rectangle(fr, (110, 65), (340, 290), (24, 24, 28), -1)
                cv2.circle(fr, (460, 180), 75, (184, 5, 118), -1)
            else:
                cv2.rectangle(fr, (190, 50), (255, 295), (210, 120, 30), -1)
                cv2.rectangle(fr, (280, 90), (345, 295), (170, 50, 125), -1)
                cv2.rectangle(fr, (370, 70), (435, 295), (50, 150, 240), -1)
            return fr

        f1 = _grid_frame(1)
        f2 = _grid_frame(2)
        with tempfile.TemporaryDirectory(prefix="p7_shared_bg_cut_") as tmp:
            td = Path(tmp)
            mp4 = td / "shared_bg.mp4"
            writer = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
            self.assertTrue(writer.isOpened())
            for _ in range(45):
                writer.write(f1)
            for _ in range(45):
                writer.write(f2)
            writer.release()

            cap = cv2.VideoCapture(str(mp4))
            scan = ref_temporal_cuts.scan_motion_timeline_accurate(cap, 90, fps, 3.0)
            cap.release()
            non_start = [c for c in scan["cuts"] if c["evidence"] != "start"]
            self.assertEqual(len(non_start), 1, f"expected single cut at frame 45, got {non_start}")
            self.assertEqual(non_start[0]["evidence"], "hard", f"expected hard cut, got {non_start}")
            self.assertLessEqual(abs(int(non_start[0]["frame"]) - 45), 1, f"cut drifted: {non_start}")

    def test_r1_bright_plate_layout_swap_splits_long_span_without_chopping_short_scene(self) -> None:
        w, h, fps = 640, 360, 30.0

        def _bright_plate_frame(phase: int, slide_px: int = 0) -> np.ndarray:
            fr = np.full((h, w, 3), (220, 222, 222), dtype=np.uint8)
            for gx in range(20, w, 40):
                cv2.line(fr, (gx, 0), (gx, h), (204, 206, 206), 1)
            for gy in range(20, h, 40):
                cv2.line(fr, (0, gy), (w, gy), (204, 206, 206), 1)
            if phase == 1:
                cv2.circle(fr, (180 + slide_px, 140), 42, (28, 28, 32), -1)
                cv2.rectangle(fr, (110 + slide_px, 210), (260 + slide_px, 250), (140, 20, 120), -1)
            else:
                cv2.rectangle(fr, (380 + slide_px, 60), (540 + slide_px, 270), (220, 120, 35), -1)
                cv2.circle(fr, (460 + slide_px, 310), 28, (35, 160, 45), -1)
            return fr

        with tempfile.TemporaryDirectory(prefix="p7_bp_swap_") as tmp:
            td = Path(tmp)
            mp4 = td / "bp_swap.mp4"
            writer = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
            self.assertTrue(writer.isOpened())
            # 6.0s clip (180 frames) with smooth 10-frame slide swap at t=3.0s
            for idx in range(180):
                if idx < 85:
                    writer.write(_bright_plate_frame(1, 0))
                elif idx < 95:
                    alpha = (idx - 85) / 10.0
                    f_a = _bright_plate_frame(1, int(-alpha * 220))
                    f_b = _bright_plate_frame(2, int((1.0 - alpha) * 180))
                    writer.write(cv2.addWeighted(f_a, 1.0 - alpha, f_b, alpha, 0.0))
                else:
                    writer.write(_bright_plate_frame(2, 0))
            writer.release()

            cap = cv2.VideoCapture(str(mp4))
            scan = ref_temporal_cuts.scan_motion_timeline_accurate(cap, 180, fps, 6.0)
            cap.release()
            non_start = [c for c in scan["cuts"] if c["evidence"] != "start"]
            self.assertGreaterEqual(len(non_start), 1, f"expected split near 3.0s, got {scan['cuts']}")
            nearest = min(non_start, key=lambda c: abs(c["cutSec"] - 3.0))
            self.assertLessEqual(abs(nearest["cutSec"] - 3.0), 0.35, f"split drifted from 3.0s: {non_start}")


if __name__ == "__main__":
    unittest.main()
