#!/usr/bin/env python3
"""Zero-LLM "motion smoothness" report: result video vs reference, per extractor scene.

  python scripts/motion-smooth-report.py <ref.mp4> <result.mp4> --scene-cuts 2.502,6.206,9.543,13.513,15.682 [--out r.json]
  python scripts/motion-smooth-report.py <ref.mp4> <result.mp4> --scene-cuts path/to/style.json [--out r.json]

Needs only cv2 + numpy. Frames are resized to 360x640 (so px/frame below are in 360-wide units).
Per scene (frames within +-6 of every cut are excluded):
  fastShareRef/Res  share of frames whose 97th-percentile Farneback flow magnitude > FAST_PX (3.0 px/frame)
  p97Ratio          mean p97 flow, result / ref
  activeRef/Res     mean share of pixels with flow > 0.4 px/frame
Global:
  fastSeconds       seconds with p97 > FAST_PX (non-cut frames), ref vs result
  midMotionDup      frames whose frame-diff collapses (<0.2x median of +-3 neighbours, neighbours >0.9, both
                    adjacent diffs >0.5) = a stall/duplicate in the middle of motion. Ref should have ~0.
Limits (say so when reporting): optical-flow proxies, not "feel"; compression noise is not removed;
a high ratio does not prove the motion is the right motion. It cannot see velocity-curve SHAPE of one element
(use element tracking for that) and it does not measure blur quality.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

SIZE = (360, 640)
FAST_PX = 3.0


def _extract_cut_sec(item):
    if isinstance(item, (int, float)):
        return float(item)
    if isinstance(item, dict):
        for k in ("cutSec", "timestamp", "t", "sec", "start"):
            if k in item and item[k] is not None:
                return float(item[k])
    return 0.0


def parse_scene_cuts_arg(raw: str):
    """Accepts either comma-separated cut seconds OR a path to style.json (`cuts[]` or `scenes[].start`)."""
    cand = Path(raw.strip())
    if cand.is_file() and cand.suffix.lower() == ".json":
        data = json.loads(cand.read_text(encoding="utf-8"))
        cuts = data.get("cuts")
        if isinstance(cuts, list) and cuts:
            vals = [_extract_cut_sec(c) for c in cuts]
            return [v for v in vals if v > 0.05]
        scenes = data.get("scenes")
        if isinstance(scenes, list) and len(scenes) > 1:
            return [float(s["start"]) for s in scenes[1:] if float(s.get("start", 0.0)) > 0.05]
        return []
    return [float(x) for x in raw.split(",") if x.strip()]


def load(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    g = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        g.append(cv2.cvtColor(cv2.resize(f, SIZE, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY))
    cap.release()
    return g, fps


def series(g):
    p97, act, d = [], [], []
    for i in range(len(g) - 1):
        fl = cv2.calcOpticalFlowFarneback(g[i], g[i + 1], None, 0.5, 3, 21, 3, 5, 1.1, 0)
        m = np.hypot(fl[..., 0], fl[..., 1])
        p97.append(float(np.percentile(m, 97)))
        act.append(float((m > 0.4).mean()))
        d.append(float(np.abs(g[i + 1].astype(np.int16) - g[i]).mean()))
    return np.array(p97), np.array(act), np.array(d)


def mid_dups(d, ok):
    out = []
    for i in range(3, len(d) - 3):
        if not ok[i]:
            continue
        nb = np.r_[d[i - 3:i], d[i + 1:i + 4]]
        if np.median(nb) > 0.9 and d[i] < 0.2 * np.median(nb) and d[i - 1] > 0.5 and d[i + 1] > 0.5:
            out.append(i)
    return out


def compute_smooth_report(ref_path, res_path, cut_secs):
    gr, fps = load(ref_path)
    gs, _ = load(res_path)
    pr, ar, dr = series(gr)
    ps, as_, ds = series(gs)
    n = min(len(pr), len(ps))
    cuts = [int(round(float(x) * fps)) for x in cut_secs if float(x) > 0.0]
    ok = np.ones(n, bool)
    for c in cuts:
        ok[max(0, c - 6):c + 6] = False
    b = [0] + cuts + [n]
    scenes = []
    for si, (s0, s1) in enumerate(zip(b[:-1], b[1:]), 1):
        m = np.zeros(n, bool)
        m[s0 + 6:max(s0 + 6, min(s1, n) - 6)] = True
        m &= ok
        if m.sum() < 5:
            continue
        scenes.append({
            "scene": si,
            "fastShareRef": round(float((pr[:n][m] > FAST_PX).mean()), 3),
            "fastShareRes": round(float((ps[:n][m] > FAST_PX).mean()), 3),
            "p97Ratio": round(float(ps[:n][m].mean() / max(pr[:n][m].mean(), 1e-6)), 2),
            "activeRef": round(float(ar[:n][m].mean()), 3),
            "activeRes": round(float(as_[:n][m].mean()), 3),
        })
    return {
        "fps": fps,
        "scenes": scenes,
        "fastSeconds": {
            "ref": round(float(((pr[:n] > FAST_PX) & ok).sum() / fps), 2),
            "res": round(float(((ps[:n] > FAST_PX) & ok).sum() / fps), 2),
        },
        "midMotionDup": {"ref": mid_dups(dr[:n], ok), "res": mid_dups(ds[:n], ok)},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("res")
    ap.add_argument("--scene-cuts", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    cut_secs = parse_scene_cuts_arg(a.scene_cuts)
    rep = compute_smooth_report(a.ref, a.res, cut_secs)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1)
    print("scene | fastShare ref/res | p97Ratio | active ref/res")
    for s in rep["scenes"]:
        print(
            "  S%d | %.2f / %.2f | %.2f | %.3f / %.3f"
            % (s["scene"], s["fastShareRef"], s["fastShareRes"], s["p97Ratio"], s["activeRef"], s["activeRes"])
        )
    print("fast seconds ref/res:", rep["fastSeconds"]["ref"], rep["fastSeconds"]["res"])
    print("mid-motion duplicate frames ref:", rep["midMotionDup"]["ref"], "res:", rep["midMotionDup"]["res"])


if __name__ == "__main__":
    main()
