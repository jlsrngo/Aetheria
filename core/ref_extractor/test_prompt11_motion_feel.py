#!/usr/bin/env python3
"""Synthetic unit tests for Prompt 11 M1 (honest ease), M2 (lag-15 living hold), M3 (30fps overshoot/settle), and M4 (pre-cut energy)."""

import math
import os
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

import ref_camera_motion  # noqa: E402
import ref_element_feel  # noqa: E402
import ref_motion_kinematics  # noqa: E402


class TestPrompt11MotionFeel(unittest.TestCase):
    def test_m1_fits_outExpo_and_inCubic_honestly(self):
        ts = [round(i * 0.1, 3) for i in range(11)]
        zeros = [0.0] * len(ts)
        ones = [1.0] * len(ts)

        tx_out_expo = [200.0 * ref_camera_motion.eval_am_ease("outExpo", t) for t in ts]
        name_oe, rmse_oe = ref_camera_motion._fit_best_ease(ts, ones, zeros, tx_out_expo, zeros)
        self.assertEqual(name_oe, "outExpo")
        self.assertLess(rmse_oe, 0.02)

        tx_in_cubic = [200.0 * ref_camera_motion.eval_am_ease("inCubic", t) for t in ts]
        name_ic, rmse_ic = ref_camera_motion._fit_best_ease(ts, ones, zeros, tx_in_cubic, zeros)
        self.assertEqual(name_ic, "inCubic")
        self.assertLess(rmse_ic, 0.02)

    def test_m2_discriminates_noisy_static_hold_vs_living_drift_hold_and_m4_precut(self):
        rng = np.random.default_rng(42)
        base = np.full((320, 180, 3), 225, dtype=np.uint8)
        cv2.circle(base, (90, 160), 34, (45, 45, 160), -1)

        def static_noisy_frame(t: float) -> np.ndarray:
            # Compression-like +-3 luma jitter that is identical at lag-1 and lag-15
            noise = rng.integers(-3, 4, size=base.shape, dtype=np.int16)
            return np.clip(base.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        kin_static = ref_motion_kinematics.extract_scene_motion_kinematics(
            static_noisy_frame, 0.0, 2.4, 360, 640, step_sec=0.16
        )
        self.assertFalse(kin_static["hasLivingHold"], f"noisy static hold should be False: {kin_static}")
        self.assertFalse(kin_static["preCutActive"], f"static tail should not be preCutActive: {kin_static}")

        def living_drift_frame(t: float) -> np.ndarray:
            fr = np.full((320, 180, 3), 225, dtype=np.uint8)
            dy = int(round(math.sin(t * 2.2) * 14.0))
            dx = int(round(math.cos(t * 1.8) * 10.0))
            cv2.circle(fr, (90 + dx, 160 + dy), 36, (45, 45, 160), -1)
            return fr

        kin_live = ref_motion_kinematics.extract_scene_motion_kinematics(
            living_drift_frame, 0.0, 2.4, 360, 640, step_sec=0.16
        )
        self.assertTrue(kin_live["hasLivingHold"], f"living drift hold should be True: {kin_live}")
        self.assertGreater(len(kin_live["livingHoldRegions"]), 0)
        self.assertTrue(kin_live["preCutActive"], f"active tail should be preCutActive: {kin_live}")

    def test_m3_measures_12pct_overshoot_vs_no_overshoot_at_30fps(self):
        def make_pop_fn(overshoot_frac: float):
            def frame_at(t: float) -> np.ndarray:
                fr = np.full((320, 180, 3), 235, dtype=np.uint8)
                # Pop from t=0.10..0.40s, settle 0.40..0.90s
                if t < 0.10:
                    s = 0.25
                elif t < 0.26:
                    u = (t - 0.10) / 0.16
                    s = 0.25 + (1.0 + overshoot_frac - 0.25) * (1.0 - (1.0 - u) ** 2)
                elif t < 0.42:
                    u = (t - 0.26) / 0.16
                    s = (1.0 + overshoot_frac) - overshoot_frac * u
                else:
                    s = 1.0
                hw = max(6, int(round(48 * s)))
                hh = max(6, int(round(32 * s)))
                cv2.rectangle(fr, (90 - hw, 160 - hh), (90 + hw, 160 + hh), (35, 35, 190), -1)
                return fr

            return frame_at

        feel_ov = ref_element_feel.extract_scene_element_feel(
            make_pop_fn(0.12),
            0.0,
            1.0,
            180,
            320,
            motion_bursts=[{"t0": 0.10, "t1": 0.42}],
            fps=30.0,
        )
        self.assertEqual(len(feel_ov), 1, f"expected 1 feel entry, got {feel_ov}")
        self.assertGreaterEqual(feel_ov[0]["overshootPct"], 8.0)
        self.assertLessEqual(feel_ov[0]["overshootPct"], 16.0)
        self.assertGreater(feel_ov[0]["settleSec"], 0.15)

        feel_flat = ref_element_feel.extract_scene_element_feel(
            make_pop_fn(0.0),
            0.0,
            1.0,
            180,
            320,
            motion_bursts=[{"t0": 0.10, "t1": 0.42}],
            fps=30.0,
        )
        self.assertEqual(len(feel_flat), 1, f"expected 1 feel entry for non-overshoot pop, got {feel_flat}")
        self.assertLessEqual(feel_flat[0]["overshootPct"], 2.0)


if __name__ == "__main__":
    unittest.main()
