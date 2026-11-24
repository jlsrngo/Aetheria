#!/usr/bin/env python3
"""Zero-LLM comparison of a generated remake video against its reference.

Usage (run from anywhere; do NOT use `python -I`, it imports repo siblings):
  python compare_result_vs_ref.py <ref.mp4> <result.mp4> [--repo <AetheriaNexus root>] [--out report.json]
        [--scene-cuts 1.667,4.967,7.367,9.267,14.467,22.367,26.0,30.267]
--scene-cuts (seconds, from the extractor's cuts[]) makes the per-scene table use the extractor's scenes;
without it scenes are the hard cuts the script itself detects (soft cuts are not found).

Measures, with no model call:
  1. hard-cut timing offset in frames (result cut vs matching reference cut)
  2. per-scene "motion energy" ratio result/ref and share of frames with ~zero change
  3. mean Lab dE76 between ref and result at sampled times (palette / brightness drift)
  4. (with --repo) the repo's own ref_compare.compare_pairs on sampled frames:
     share of frames with edgeSimilarity <= 0.15 and the structural diagnoses it emits
Dependencies: opencv-python, numpy (already required by core/ref_extractor).
"""
import argparse, importlib, json, os, shutil, sys, tempfile
import cv2
import numpy as np

SMALL = (180, 320)


def load_small(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(f, SMALL, interpolation=cv2.INTER_AREA))
    cap.release()
    return np.array(frames), fps


def hard_cuts(frames, thr=18.0):
    g = frames.astype(np.float32).mean(axis=3)
    d = np.abs(np.diff(g, axis=0)).mean(axis=(1, 2))
    cuts, i = [], 0
    while i < len(d):
        if d[i] > thr:
            j = i
            while j + 1 < len(d) and d[j + 1] > thr:
                j += 1
            k = i + int(np.argmax(d[i:j + 1]))
            cuts.append(k + 1)  # first frame of the new shot
            i = j + 1
        else:
            i += 1
    return cuts, d


def match_cuts(ref_cuts, res_cuts, tol=4):
    out = []
    for rc in ref_cuts:
        near = [c for c in res_cuts if abs(c - rc) <= tol]
        out.append({"refFrame": rc, "resFrame": (min(near, key=lambda c: abs(c - rc)) if near else None)})
        out[-1]["offsetFrames"] = None if out[-1]["resFrame"] is None else out[-1]["resFrame"] - rc
    return out


def scene_bounds(ref_cuts, n):
    b = [0] + list(ref_cuts) + [n]
    return list(zip(b[:-1], b[1:]))


def motion_by_scene(d_ref, d_res, bounds):
    rows = []
    for si, (a, b) in enumerate(bounds, 1):
        a2, b2 = a + 4, b - 1
        if b2 - a2 < 3:
            continue
        r, s = d_ref[a2 - 1:b2 - 1], d_res[a2 - 1:b2 - 1]
        rows.append({
            "scene": si, "t0": a, "t1": b,
            "meanDiffRef": round(float(r.mean()), 3), "meanDiffRes": round(float(s.mean()), 3),
            "ratioRes/Ref": round(float(s.mean() / max(1e-6, r.mean())), 2),
            "frozenShareRes": round(float((s < 0.05).mean()), 2), "frozenShareRef": round(float((r < 0.05).mean()), 2),
        })
    return rows


def lab_de(ref, res, fps, step_sec=1.0):
    rows = []
    n = min(len(ref), len(res))
    for i in range(0, n, max(1, int(round(step_sec * fps)))):
        a = cv2.cvtColor(ref[i], cv2.COLOR_BGR2LAB).astype(np.float32)
        b = cv2.cvtColor(res[i], cv2.COLOR_BGR2LAB).astype(np.float32)
        rows.append({"t": round(i / fps, 2), "dE76": round(float(np.sqrt(((a - b) ** 2).sum(2)).mean()), 1),
                     "meanRGBRef": [int(x) for x in ref[i].reshape(-1, 3).mean(0)[::-1]],
                     "meanRGBRes": [int(x) for x in res[i].reshape(-1, 3).mean(0)[::-1]]})
    return rows


def repo_compare(ref_path, res_path, fps, repo, step_sec=0.5):
    sys.path.insert(0, os.path.join(repo, "core", "ref_extractor"))
    ref_compare = importlib.import_module("ref_compare")
    tmp = tempfile.mkdtemp(prefix="cmp_")
    try:
        cr, cs = cv2.VideoCapture(ref_path), cv2.VideoCapture(res_path)
        total = int(min(cr.get(cv2.CAP_PROP_FRAME_COUNT), cs.get(cv2.CAP_PROP_FRAME_COUNT)))
        pairs = []
        for i in range(1, total, max(1, int(round(step_sec * fps)))):
            pp = []
            for cap, tag in ((cr, "ref"), (cs, "res")):
                cap.set(cv2.CAP_PROP_POS_FRAMES, i)
                ok, f = cap.read()
                if not ok or f is None:
                    pp = []
                    break
                p = os.path.join(tmp, "%s_%05d.png" % (tag, i))
                cv2.imwrite(p, f)
                pp.append(p)
            if len(pp) == 2:
                pairs.append({"refPath": pp[0], "previewPath": pp[1], "timestamp": round(i / fps, 3), "sceneId": "x"})
        cr.release()
        cs.release()
        out = ref_compare.compare_pairs({"pairs": pairs, "stripOutputPath": os.path.join(tmp, "strip.jpg"), "passThreshold": 0.85})
        pf = out["perFrame"]
        edge = np.array([f["edgeSimilarity"] for f in pf])
        comb = np.array([f["combinedScore"] for f in pf])
        low = edge <= 0.15
        diag = [{"t": f["timestamp"], "combined": f["combinedScore"], "edge": f["edgeSimilarity"], "diag": f.get("structuralDiagnosis")}
                for f in pf if f.get("structuralDiagnosis")]
        return {
            "frames": len(pf), "overallFidelity": out["overallFidelity"],
            "lowEdgeShare(edge<=0.15)": round(float(low.mean()), 3),
            "lowEdgeButVerdictSebagianOrBetter(>=0.65)": int((comb[low] >= 0.65).sum()),
            "lowEdgeCombinedMax": round(float(comb[low].max()), 3) if low.any() else None,
            "framesWithStructuralDiagnosis": len(diag), "diagnosesSample": diag[:12],
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _extract_cut_sec(item):
    if isinstance(item, (int, float)):
        return float(item)
    if isinstance(item, dict):
        for k in ("cutSec", "timestamp", "t", "sec", "start"):
            if k in item and item[k] is not None:
                return float(item[k])
    return 0.0


def parse_scene_cuts(raw, fps):
    if not raw:
        return None
    s = raw.strip()
    if s.lower().endswith(".json") and os.path.isfile(s):
        with open(s, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        cuts = data.get("cuts")
        if isinstance(cuts, list) and cuts:
            vals = [_extract_cut_sec(x) for x in cuts]
            return [int(round(v * fps)) for v in vals if v > 0.05]
        scenes = data.get("scenes")
        if isinstance(scenes, list) and len(scenes) > 1:
            return [int(round(float(sc["start"]) * fps)) for sc in scenes[1:] if float(sc.get("start", 0.0)) > 0.05]
        return []
    return [int(round(float(x) * fps)) for x in s.split(",") if x.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref"); ap.add_argument("res")
    ap.add_argument("--repo"); ap.add_argument("--out"); ap.add_argument("--scene-cuts")
    a = ap.parse_args()
    ref, fps = load_small(a.ref)
    res, _ = load_small(a.res)
    n = min(len(ref), len(res))
    rc, d_ref = hard_cuts(ref)
    sc, d_res = hard_cuts(res)
    cut_frames = parse_scene_cuts(a.scene_cuts, fps)
    report = {
        "fps": fps, "frames": {"ref": len(ref), "res": len(res)},
        "cutOffsets": match_cuts(rc, sc),
        "motionByScene": motion_by_scene(
            d_ref, d_res,
            scene_bounds(cut_frames if cut_frames is not None else rc, n)),
        "paletteDrift": lab_de(ref, res, fps),
    }
    if a.repo:
        report["repoComparator"] = repo_compare(a.ref, a.res, fps, a.repo)
    txt = json.dumps(report, indent=2, ensure_ascii=False)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(txt)
    offs = [c["offsetFrames"] for c in report["cutOffsets"]]
    print("cut offsets (frames, result - ref):", offs)
    print("motion ratio res/ref per scene:", [m["ratioRes/Ref"] for m in report["motionByScene"]])
    print("frozen share (res) per scene:", [m["frozenShareRes"] for m in report["motionByScene"]])
    worst = sorted(report["paletteDrift"], key=lambda r: -r["dE76"])[:5]
    print("worst dE76 seconds:", [(r["t"], r["dE76"]) for r in worst])
    if a.repo:
        rcmp = report["repoComparator"]
        print("repo comparator:", {k: rcmp[k] for k in rcmp if k != "diagnosesSample"})


if __name__ == "__main__":
    main()
