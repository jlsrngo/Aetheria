"""Offline reference-extractor accuracy evaluator (Prompt 7 R0).

Evaluates `ref_extractor.extract_reference_blueprint` against:
  - Synthetic Suite A (parameter tuning)
  - Synthetic Suite B (held-out evaluation)
  - Optional offline benchmark video (hard-cut ground truth computed purely from
    per-frame absdiff outliers, NEVER loaded from `film.json`).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ref_extractor
from synth_reference import build_synthetic_suite_specs, generate_synthetic_clip


def _hex_to_rgb(hx: str) -> Tuple[int, int, int]:
    s = str(hx or "").strip().lstrip("#")
    if len(s) != 6:
        return (0, 0, 0)
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def _luma_rgb(rgb: Tuple[int, int, int]) -> float:
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]


def _eval_ease(name: str, u: float) -> float:
    x = max(0.0, min(1.0, float(u)))
    if name == "inCubic":
        return x * x * x
    if name == "outCubic":
        return 1.0 - (1.0 - x) ** 3
    if name == "inOutCubic":
        return 4.0 * x * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 3) / 2.0
    return x


def _eval_camera_motion_at(cam_motion: Optional[Dict[str, Any]], local_t: float) -> Optional[Dict[str, float]]:
    """Evaluates extracted `cameraMotion` segments at `local_t` (relative to scene start)."""
    if not cam_motion or not isinstance(cam_motion, dict):
        return None
    segs = cam_motion.get("segments") or []
    if not segs:
        return None
    s_val, r_val, tx_val, ty_val = 1.0, 0.0, 0.0, 0.0
    for seg in segs:
        t0 = float(seg.get("t0", 0.0))
        t1 = float(seg.get("t1", t0))
        if local_t <= t0:
            if seg is segs[0]:
                s_val = float(seg.get("scaleFrom", 1.0))
                r_val = float(seg.get("rotDegFrom", 0.0))
                tx_val = float(seg.get("txFrom", 0.0))
                ty_val = float(seg.get("tyFrom", 0.0))
            break
        if local_t >= t1:
            s_val = float(seg.get("scaleTo", 1.0))
            r_val = float(seg.get("rotDegTo", 0.0))
            tx_val = float(seg.get("txTo", 0.0))
            ty_val = float(seg.get("tyTo", 0.0))
            continue
        u = (local_t - t0) / max(1e-6, t1 - t0)
        p = _eval_ease(str(seg.get("ease", "linear")), u)
        s_val = float(seg.get("scaleFrom", 1.0)) + (float(seg.get("scaleTo", 1.0)) - float(seg.get("scaleFrom", 1.0))) * p
        r_val = float(seg.get("rotDegFrom", 0.0)) + (float(seg.get("rotDegTo", 0.0)) - float(seg.get("rotDegFrom", 0.0))) * p
        tx_val = float(seg.get("txFrom", 0.0)) + (float(seg.get("txTo", 0.0)) - float(seg.get("txFrom", 0.0))) * p
        ty_val = float(seg.get("tyFrom", 0.0)) + (float(seg.get("tyTo", 0.0)) - float(seg.get("tyFrom", 0.0))) * p
        break
    return {"scale": s_val, "rotDeg": r_val, "tx": tx_val, "ty": ty_val}


def detect_hard_cuts_from_frame_diffs(video_path: Path) -> Tuple[float, int, float, List[Dict[str, Any]]]:
    """Computes frame-level hard-cut ground truth on a real video strictly from absdiff outliers (R2)."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    prev = None
    diffs: List[float] = []
    idx = 0
    while True:
        ok, fr = cap.read()
        if not ok or fr is None:
            break
        small = cv2.resize(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
        if prev is not None:
            diffs.append(float(np.abs(small - prev).mean()))
        prev = small
        idx += 1
    cap.release()
    arr = np.asarray(diffs, dtype=np.float32)
    p95 = float(np.percentile(arr, 95)) if arr.size else 0.0
    # Hard cut criterion per R2: sharp isolated spike >> p95 (at least 3.5x p95 and >= 25.0/255)
    thresh = max(25.0, p95 * 3.5)
    peaks: List[Dict[str, Any]] = []
    for k, val in enumerate(diffs):
        frame_idx = k + 1
        if val >= thresh:
            if not peaks or (frame_idx - peaks[-1]["frame"]) >= max(2, int(round(0.35 * fps))):
                peaks.append({"frame": frame_idx, "t": round(frame_idx / fps, 4), "diff": round(val, 2)})
            elif val > peaks[-1]["diff"]:
                peaks[-1] = {"frame": frame_idx, "t": round(frame_idx / fps, 4), "diff": round(val, 2)}
    return fps, idx, round(p95, 2), peaks


def _match_cuts(
    truth_cuts: List[Dict[str, Any]],
    pred_cuts: List[Dict[str, Any]],
    fps: float,
    tol_frames: float = 2.0,
) -> Dict[str, Any]:
    tol_sec = (tol_frames + 0.05) / max(fps, 1.0)
    used_pred = set()
    frame_errors: List[float] = []
    matched = 0
    details: List[Dict[str, Any]] = []
    for tc in truth_cuts:
        best_i = None
        best_err_s = 1e9
        for pi, pc in enumerate(pred_cuts):
            if pi in used_pred:
                continue
            err_s = abs(float(pc["cutSec"]) - float(tc["t"]))
            if err_s < best_err_s:
                best_err_s = err_s
                best_i = pi
        if best_i is not None and best_err_s <= tol_sec:
            used_pred.add(best_i)
            matched += 1
            err_f = round(best_err_s * fps, 3)
            frame_errors.append(err_f)
            details.append({"truthT": tc["t"], "predT": pred_cuts[best_i]["cutSec"], "errFrames": err_f, "matched": True})
        else:
            details.append({
                "truthT": tc["t"],
                "predT": pred_cuts[best_i]["cutSec"] if best_i is not None else None,
                "errFrames": round(best_err_s * fps, 3) if best_i is not None else None,
                "matched": False,
            })
    recall = matched / max(1, len(truth_cuts)) if truth_cuts else 1.0
    precision = matched / max(1, len(pred_cuts)) if pred_cuts else (1.0 if not truth_cuts else 0.0)
    return {
        "truthCount": len(truth_cuts),
        "predHardCount": len(pred_cuts),
        "matched": matched,
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "medianErrFrames": round(float(np.median(frame_errors)), 3) if frame_errors else None,
        "maxErrFrames": round(float(np.max(frame_errors)), 3) if frame_errors else None,
        "details": details,
    }


def _extract_pred_cut_entries(temporal_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(temporal_doc.get("cuts"), list) and temporal_doc["cuts"]:
        return [c for c in temporal_doc["cuts"] if float(c.get("cutSec", 0.0)) > 0.01]
    # Backwards-compatible fallback for baseline R0 before R1 adds `cuts[]`
    return [
        {"cutSec": float(t), "evidence": "hard", "confidence": 1.0}
        for t in (temporal_doc.get("cutTimestamps") or [])
        if float(t) > 0.01
    ]


def evaluate_synthetic_suite(suite: str) -> Dict[str, Any]:
    specs = build_synthetic_suite_specs(suite)
    clip_reports: List[Dict[str, Any]] = []

    all_truth_cuts = 0
    all_pred_hard = 0
    all_matched = 0
    all_err_frames: List[float] = []
    soft_false_hard = 0
    scale_sq_errs: List[float] = []
    rot_sq_errs: List[float] = []
    pan_sq_errs: List[float] = []
    control_total = 0
    control_false_zoom = 0
    tile_total = 0
    tile_max_chan_errs: List[int] = []
    tile_polarity_ok = 0
    bpm_fallback_ok = 0
    bpm_fallback_total = 0
    key_event_total = 0
    key_event_covered = 0

    with tempfile.TemporaryDirectory(prefix=f"aetheria_p7_suite_{suite}_") as tmp:
        td = Path(tmp)
        for spec in specs:
            mp4_path = td / f"{spec['name']}.mp4"
            truth = generate_synthetic_clip(spec, mp4_path)
            out_dir = td / f"out_{spec['name']}"
            t0 = time.perf_counter()
            res = ref_extractor.extract_reference_blueprint(str(mp4_path), str(out_dir))
            elapsed = round(time.perf_counter() - t0, 3)
            if not res.get("success"):
                raise RuntimeError(f"Extraction failed on {spec['name']}: {res}")

            temporal_doc = json.loads((out_dir / "temporal.json").read_text(encoding="utf-8"))
            ast_doc = res["motionAst"]
            fps = float(truth["fps"])

            pred_cuts_all = _extract_pred_cut_entries(temporal_doc)
            pred_hard_only = [c for c in pred_cuts_all if c.get("evidence") == "hard"]
            cut_eval = _match_cuts(truth["hardCuts"], pred_hard_only, fps, tol_frames=2.0)

            all_truth_cuts += cut_eval["truthCount"]
            all_pred_hard += cut_eval["predHardCount"]
            all_matched += cut_eval["matched"]
            for d in cut_eval["details"]:
                if d["matched"] and d["errFrames"] is not None:
                    all_err_frames.append(float(d["errFrames"]))

            # Check soft transitions are NOT misclassified as hard cuts
            for st in truth["softTransitions"]:
                for pc in pred_hard_only:
                    if st["tStart"] - 0.15 <= float(pc["cutSec"]) <= st["tEnd"] + 0.15:
                        soft_false_hard += 1

            # BPM fallback check (synthetic clips have no audio)
            bpm_fallback_total += 1
            if temporal_doc.get("bpmSource") == "fallback" or ast_doc.get("bpmSource") == "fallback":
                bpm_fallback_ok += 1

            # Per-scene cameraMotion, controls, tile-wall cleanPlate, and beatStrip key-event coverage
            ast_scenes = ast_doc.get("scenes") or []
            for ts in truth["scenes"]:
                mid_t = 0.5 * (ts["startSec"] + ts["endSec"])
                matched_sc = next(
                    (sc for sc in ast_scenes if float(sc["start"]) - 0.1 <= mid_t <= float(sc["end"]) + 0.1),
                    None,
                )
                if matched_sc is None:
                    continue

                cam_motion = matched_sc.get("cameraMotion")
                if ts["camera"] and ts["cameraSamples"]:
                    # Sample 5 interior timestamps inside the motion segment
                    c_seg = ts["camera"]
                    for frac in (0.15, 0.35, 0.55, 0.75, 0.92):
                        lt_truth = float(c_seg["t0"]) + frac * (float(c_seg["t1"]) - float(c_seg["t0"]))
                        gt = ts["startSec"] + lt_truth
                        sample = min(ts["cameraSamples"], key=lambda s: abs(s["globalT"] - gt))
                        pred_c = _eval_camera_motion_at(cam_motion, gt - float(matched_sc["start"]))
                        if pred_c is not None:
                            # Relative scale error (%) vs ground truth (ratio relative to t0)
                            ref_s = float(c_seg.get("scaleFrom", 1.0))
                            ref_r = float(c_seg.get("rotDegFrom", 0.0))
                            ref_tx = float(c_seg.get("txFrom", 0.0))
                            ref_ty = float(c_seg.get("tyFrom", 0.0))
                            pred_0 = _eval_camera_motion_at(cam_motion, max(0.0, ts["startSec"] + float(c_seg["t0"]) - float(matched_sc["start"])))
                            if pred_0:
                                rel_s_truth = sample["scale"] / max(1e-4, ref_s)
                                rel_s_pred = pred_c["scale"] / max(1e-4, pred_0["scale"])
                                rel_r_truth = sample["rotDeg"] - ref_r
                                rel_r_pred = pred_c["rotDeg"] - pred_0["rotDeg"]
                                rel_tx_truth = sample["tx"] - ref_tx
                                rel_tx_pred = pred_c["tx"] - pred_0["tx"]
                                rel_ty_truth = sample["ty"] - ref_ty
                                rel_ty_pred = pred_c["ty"] - pred_0["ty"]
                                scale_sq_errs.append(((rel_s_pred - rel_s_truth) / max(1e-4, rel_s_truth) * 100.0) ** 2)
                                rot_sq_errs.append((rel_r_pred - rel_r_truth) ** 2)
                                pan_sq_errs.append(0.5 * ((rel_tx_pred - rel_tx_truth) ** 2 + (rel_ty_pred - rel_ty_truth) ** 2))
                elif ts["kind"] in ("textured", "moving-object-static-bg", "dark-featureless") and ts.get("transitionFromPrev") != "crossfade":
                    # Control scene (no camera motion, not merged with a crossfaded moving neighbor)
                    control_total += 1
                    segs = (cam_motion or {}).get("segments") or []
                    has_high_conf_move = any(
                        seg.get("confidence") != "low"
                        and (
                            abs(float(seg.get("scaleTo", 1.0)) - float(seg.get("scaleFrom", 1.0))) > 0.04
                            or abs(float(seg.get("rotDegTo", 0.0)) - float(seg.get("rotDegFrom", 0.0))) > 0.6
                            or math.hypot(
                                float(seg.get("txTo", 0.0)) - float(seg.get("txFrom", 0.0)),
                                float(seg.get("tyTo", 0.0)) - float(seg.get("tyFrom", 0.0)),
                            ) > 8.0
                        )
                        for seg in segs
                    )
                    if has_high_conf_move:
                        control_false_zoom += 1

                if ts["kind"] == "tile-wall":
                    tile_total += 1
                    cp = matched_sc.get("cleanPlate") or {}
                    got_rgb = _hex_to_rgb(cp.get("fillHex", "#000000"))
                    want_rgb = _hex_to_rgb(ts["trueBgHex"])
                    max_ch = max(abs(got_rgb[i] - want_rgb[i]) for i in range(3))
                    tile_max_chan_errs.append(max_ch)
                    if (_luma_rgb(got_rgb) < 120.0) == bool(ts["isDarkBg"]):
                        tile_polarity_ok += 1

                for ke in ts.get("keyEventsSec") or []:
                    key_event_total += 1
                    strip_ts = matched_sc.get("beatStripTimestamps") or []
                    if any(abs(float(t) - ke) <= 0.25 for t in strip_ts):
                        key_event_covered += 1

            clip_reports.append({
                "name": spec["name"],
                "elapsedSec": elapsed,
                "sceneCount": len(ast_scenes),
                "cutEval": cut_eval,
                "bpm": temporal_doc.get("bpm"),
                "bpmSource": temporal_doc.get("bpmSource"),
            })

    return {
        "suite": suite,
        "clips": clip_reports,
        "summary": {
            "cutRecall": round(all_matched / max(1, all_truth_cuts), 4),
            "cutPrecision": round(all_matched / max(1, all_pred_hard), 4),
            "cutMedianErrFrames": round(float(np.median(all_err_frames)), 3) if all_err_frames else None,
            "cutMaxErrFrames": round(float(np.max(all_err_frames)), 3) if all_err_frames else None,
            "softFalseHardCount": soft_false_hard,
            "cameraScaleRmsePct": round(math.sqrt(float(np.mean(scale_sq_errs))), 3) if scale_sq_errs else None,
            "cameraRotRmseDeg": round(math.sqrt(float(np.mean(rot_sq_errs))), 3) if rot_sq_errs else None,
            "cameraPanRmsePx": round(math.sqrt(float(np.mean(pan_sq_errs))), 3) if pan_sq_errs else None,
            "controlFalseMoveRate": round(control_false_zoom / max(1, control_total), 4),
            "controlTotal": control_total,
            "tileWallMaxChanErr": max(tile_max_chan_errs) if tile_max_chan_errs else None,
            "tileWallPolarityAcc": round(tile_polarity_ok / max(1, tile_total), 4) if tile_total else None,
            "keyEventCoverage": round(key_event_covered / max(1, key_event_total), 4) if key_event_total else None,
            "bpmFallbackCorrect": f"{bpm_fallback_ok}/{bpm_fallback_total}",
        },
    }


def evaluate_benchmark(video_path: Path) -> Dict[str, Any]:
    """Offline evaluation on benchmark video (hard-cut truth derived strictly from frame diffs)."""
    fps, total_frames, p95_diff, truth_hard_cuts = detect_hard_cuts_from_frame_diffs(video_path)
    with tempfile.TemporaryDirectory(prefix="aetheria_p7_bench_") as tmp:
        out_dir = Path(tmp) / "extracted"
        t0 = time.perf_counter()
        res = ref_extractor.extract_reference_blueprint(str(video_path), str(out_dir))
        elapsed = round(time.perf_counter() - t0, 3)
        if not res.get("success"):
            raise RuntimeError(f"Benchmark extraction failed: {res}")

        temporal_doc = json.loads((out_dir / "temporal.json").read_text(encoding="utf-8"))
        ast_doc = res["motionAst"]
        ast_scenes = ast_doc.get("scenes") or []

        pred_cuts = _extract_pred_cut_entries(temporal_doc)
        pred_hard = [c for c in pred_cuts if c.get("evidence") == "hard"]
        cut_eval = _match_cuts(truth_hard_cuts, pred_hard, fps, tol_frames=1.5)

        # Find tile-wall scene (scene covering t=4.5s)
        sc2 = next((sc for sc in ast_scenes if float(sc["start"]) <= 4.5 <= float(sc["end"])), None)
        sc2_clean = (sc2 or {}).get("cleanPlate") or {}
        sc2_rgb = _hex_to_rgb(sc2_clean.get("fillHex", "#000000"))
        true_sc2_rgb = (12, 11, 14)  # #0C0B0E
        sc2_max_chan_err = max(abs(sc2_rgb[i] - true_sc2_rgb[i]) for i in range(3))

        # Scene 2 R6 cameraMotion accuracy at 4 checkpoints relative to t=5.30s
        # Ground truth from R6 table: (t, scale_vs_5.30, rot_deg_vs_5.30)
        r6_points = [
            (5.43, 1.036, 0.18),
            (5.50, 1.151, 0.74),
            (5.53, 1.239, 1.17),
            (5.57, 1.400, 1.97),
        ]
        cam_eval: List[Dict[str, Any]] = []
        cam_motion = (sc2 or {}).get("cameraMotion")
        if sc2 and cam_motion:
            s_start = float(sc2["start"])
            base_c = _eval_camera_motion_at(cam_motion, 5.30 - s_start)
            if base_c:
                for gt_t, gt_s, gt_r in r6_points:
                    cur_c = _eval_camera_motion_at(cam_motion, gt_t - s_start)
                    if cur_c:
                        rel_s = cur_c["scale"] / max(1e-4, base_c["scale"])
                        rel_r = cur_c["rotDeg"] - base_c["rotDeg"]
                        s_err_pct = round(abs(rel_s - gt_s) / gt_s * 100.0, 3)
                        r_err_deg = round(abs(rel_r - gt_r), 3)
                        cam_eval.append({
                            "t": gt_t,
                            "predScale": round(rel_s, 4),
                            "truthScale": gt_s,
                            "scaleErrPct": s_err_pct,
                            "predRotDeg": round(rel_r, 3),
                            "truthRotDeg": gt_r,
                            "rotErrDeg": r_err_deg,
                        })

        sc2_strip = (sc2 or {}).get("beatStripTimestamps") or []
        has_high_zoom_panel = any(float(t) >= 5.53 for t in sc2_strip)
        first_panel_offset = round(float(sc2_strip[0]) - float(sc2["start"]), 3) if sc2 and sc2_strip else None

        return {
            "video": str(video_path),
            "fps": fps,
            "totalFrames": total_frames,
            "frameDiffP95": p95_diff,
            "elapsedSec": elapsed,
            "sceneCount": len(ast_scenes),
            "cutTimestamps": temporal_doc.get("cutTimestamps"),
            "truthHardCutsFromDiffs": truth_hard_cuts,
            "hardCutEval": cut_eval,
            "bpm": temporal_doc.get("bpm"),
            "bpmSource": temporal_doc.get("bpmSource"),
            "bpmConfidence": temporal_doc.get("bpmConfidence"),
            "scene2": {
                "id": sc2["id"] if sc2 else None,
                "start": sc2["start"] if sc2 else None,
                "end": sc2["end"] if sc2 else None,
                "cleanPlate": sc2_clean,
                "cleanPlateMaxChanErrVs0C0B0E": sc2_max_chan_err,
                "beatStripTimestamps": sc2_strip,
                "hasPanelAtOrAfter5_53s": has_high_zoom_panel,
                "firstPanelOffsetSec": first_panel_offset,
                "hasCameraMotion": bool(cam_motion),
                "r6CameraEval": cam_eval,
                "maxScaleErrPct": max((p["scaleErrPct"] for p in cam_eval), default=None),
                "maxRotErrDeg": max((p["rotErrDeg"] for p in cam_eval), default=None),
            },
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ref_extractor accuracy (Prompt 7).")
    parser.add_argument("--suite", choices=["A", "B", "both", "none"], default="both")
    parser.add_argument("--benchmark", type=str, default=None, help="Optional offline benchmark video path")
    parser.add_argument("--out", type=str, default=None, help="Optional JSON report output path")
    args = parser.parse_args()

    report: Dict[str, Any] = {}
    if args.suite in ("A", "both"):
        report["syntheticA"] = evaluate_synthetic_suite("A")
    if args.suite in ("B", "both"):
        report["syntheticB"] = evaluate_synthetic_suite("B")
    if args.benchmark:
        report["benchmark"] = evaluate_benchmark(Path(args.benchmark))

    text = json.dumps(report, indent=2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
