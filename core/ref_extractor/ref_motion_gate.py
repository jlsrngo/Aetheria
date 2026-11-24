#!/usr/bin/env python3
"""Zero-LLM per-scene 30fps optical-flow motion gate (Prompt 12 M3).

Evaluates adjacent 1/30s frame pairs rendered by headless CDP against the exact same
adjacent 1/30s pairs from the reference video using Farneback flow at 360x640 (matching
`scripts/motion-smooth-report.py`). Emits a structured motion-deficit diagnosis naming
exact `fastShare` / `p97Ratio` numbers and any under-animated `secondaryMotion` items.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import cv2
import numpy as np

SIZE = (360, 640)
FAST_PX = 3.0


def _pair_flow_p97(gray_a: np.ndarray, gray_b: np.ndarray) -> float:
    fl = cv2.calcOpticalFlowFarneback(gray_a, gray_b, None, 0.5, 3, 21, 3, 5, 1.1, 0)
    mag = np.hypot(fl[..., 0], fl[..., 1])
    return float(np.percentile(mag, 97))


def _load_gray(path: str) -> np.ndarray | None:
    img = cv2.imread(path)
    if img is None or img.size == 0:
        return None
    return cv2.cvtColor(cv2.resize(img, SIZE, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)


def _format_secondary_item(item: Dict[str, Any]) -> str:
    kind = str(item.get("kind") or "motion")
    zone = str(item.get("zone") or "center")
    t0 = float(item.get("tStart", 0.0))
    t1 = float(item.get("tEnd", 0.0))
    if kind == "rotate":
        dps = float(item.get("ampDegPerSec", 0.0))
        return f"rotate[{zone} {dps:+.0f}deg/s @{t0:.2f}..{t1:.2f}s]"
    if kind == "sweep":
        spd = float(item.get("speedPxPerSec", 0.0))
        return f"sweep[{zone} ~{spd:.0f}px/s @{t0:.2f}..{t1:.2f}s]"
    if kind == "orbit":
        amp = float(item.get("ampPx", 0.0))
        return f"orbit[{zone} amp={amp:.0f}px @{t0:.2f}..{t1:.2f}s]"
    if kind == "scale":
        sr = item.get("scaleRange") or [1.0, 1.0]
        return f"scale[{zone} {sr[0]}..{sr[1]}x @{t0:.2f}..{t1:.2f}s]"
    return f"{kind}[{zone} @{t0:.2f}..{t1:.2f}s]"


def evaluate_scene_motion_gate(payload: Dict[str, Any]) -> Dict[str, Any]:
    ref_video = str(payload.get("refVideoPath") or "").strip()
    pairs: List[Dict[str, Any]] = payload.get("pairs") or []
    sec_motion: List[Dict[str, Any]] = payload.get("secondaryMotion") or []

    if not ref_video or not Path(ref_video).is_file() or not pairs:
        return {"ok": False, "error": "Missing refVideoPath or frame pairs."}

    cap = cv2.VideoCapture(ref_video)
    if not cap.isOpened():
        return {"ok": False, "error": f"Failed to open refVideoPath: {ref_video}"}

    ref_p97s: List[float] = []
    res_p97s: List[float] = []
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        n_total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        for p in pairs:
            t0 = float(p.get("t0", 0.0))
            f0 = min(max(0, n_total - 2), max(0, int(round(t0 * fps))))
            f1 = min(max(1, n_total - 1), f0 + 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
            ok0, rf0 = cap.read()
            ok1, rf1 = cap.read()
            if not (ok0 and ok1 and rf0 is not None and rf1 is not None):
                continue
            pg0 = _load_gray(str(p.get("prev0") or ""))
            pg1 = _load_gray(str(p.get("prev1") or ""))
            if pg0 is None or pg1 is None:
                continue
            rg0 = cv2.cvtColor(cv2.resize(rf0, SIZE, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
            rg1 = cv2.cvtColor(cv2.resize(rf1, SIZE, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
            ref_p97s.append(_pair_flow_p97(rg0, rg1))
            res_p97s.append(_pair_flow_p97(pg0, pg1))
    finally:
        cap.release()

    if len(ref_p97s) < 3:
        return {"ok": False, "error": "Insufficient valid adjacent frame pairs for motion gate."}

    r_arr = np.asarray(ref_p97s, dtype=np.float64)
    s_arr = np.asarray(res_p97s, dtype=np.float64)
    fast_ref = float((r_arr > FAST_PX).mean())
    fast_res = float((s_arr > FAST_PX).mean())
    mean_ref = float(r_arr.mean())
    mean_res = float(s_arr.mean())
    p97_ratio = mean_res / max(mean_ref, 1e-4)

    fast_deficit = (fast_ref >= 0.18) and (fast_res < 0.50 * fast_ref)
    p97_deficit = (mean_ref >= 1.8) and (p97_ratio < 0.50)
    deficit = bool(fast_deficit or p97_deficit)

    warning = ""
    if deficit:
        sec_list = [_format_secondary_item(item) for item in sec_motion[:4]]
        sec_hint = (
            f" Animate the measured secondary elements continuously after entrance: {', '.join(sec_list)}!"
            if sec_list
            else " Keep decorative accents, arcs/ribbons, and camera/parallax motion alive across the full scene duration!"
        )
        warning = (
            f"MOTION FLOW DEFICIT WARNING (30fps optical flow): your render is much stiffer/more static than the reference "
            f"(fastShare={fast_res:.2f} vs ref={fast_ref:.2f}, p97Ratio={p97_ratio:.2f} < 0.50; meanP97={mean_res:.2f} vs ref={mean_ref:.2f} px/frame).{sec_hint}"
        )

    return {
        "ok": True,
        "pairsEvaluated": len(ref_p97s),
        "fastShareRef": round(fast_ref, 3),
        "fastShareRes": round(fast_res, 3),
        "p97MeanRef": round(mean_ref, 2),
        "p97MeanRes": round(mean_res, 2),
        "p97Ratio": round(p97_ratio, 2),
        "deficit": deficit,
        "warning": warning,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: ref_motion_gate.py <payload.json>"}))
        sys.exit(1)
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(evaluate_scene_motion_gate(payload)))
