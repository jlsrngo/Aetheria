#!/usr/bin/env python3
"""Zero-LLM "motion feel" report: result video vs reference video.

Usage (only requires cv2 + numpy):
  python scripts/motion-feel-report.py <ref.mp4> <result.mp4> --scene-cuts 1.667,4.967,... [--out report.json]

What it measures (all proxies — they say WHERE to look, not "which is nicer"):
  A. Dead holds. For sliding 0.8 s windows inside each scene: share of pixels whose gray level
     changed by >10 between frame i and i+15 (0.5 s) ("lag15 share"). Slow, real drift raises it;
     compression noise does not (it is the same at lag 1 and lag 15). A window is DEAD when the result's
     lag15 share is < 0.002 while the reference's is >= 0.01 at the same time.
  B. Seam jumps. At every scene boundary: max |frame diff| within +-2 frames divided by the median
     |frame diff| of the 12 frames before the boundary, plus absolute peak diff and pre-cut energy.
  C. Per-scene motion energy ratio (mean |frame diff| result/ref).
"""
import argparse
import json
import cv2
import numpy as np

W, H = 90, 160


def load_gray(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    g = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        g.append(cv2.cvtColor(cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY))
    cap.release()
    return np.array(g).astype(np.int16), fps


def share(G, i, lag, thr=10):
    return float((np.abs(G[i + lag] - G[i]) > thr).mean())


def drift_windows(Gr, Gs, bounds, fps, win=0.8, step=0.4, margin=0.3):
    out = []
    for si, (a, b) in enumerate(bounds, 1):
        t = a / fps + margin
        while t + win <= b / fps - margin:
            i0, i1 = int(t * fps), int((t + win) * fps) - 16
            if i1 > i0 and i1 + 16 < min(len(Gr), len(Gs)):
                idx = range(i0, i1, 2)
                r1 = np.mean([share(Gr, i, 1) for i in idx])
                r15 = np.mean([share(Gr, i, 15) for i in idx])
                s1 = np.mean([share(Gs, i, 1) for i in idx])
                s15 = np.mean([share(Gs, i, 15) for i in idx])
                out.append({
                    "scene": si,
                    "t": round(t, 2),
                    "ref_lag1": round(float(r1), 4),
                    "ref_lag15": round(float(r15), 4),
                    "res_lag1": round(float(s1), 4),
                    "res_lag15": round(float(s15), 4),
                    "dead": bool(s15 < 0.002 and r15 >= 0.01),
                })
            t += step
    return out


def seam_ratio(G, cut, ctx=12):
    d = np.abs(np.diff(G, axis=0)).mean(axis=(1, 2))
    lo, hi = max(0, cut - 3), min(len(d), cut + 2)
    peak = float(d[lo:hi].max()) if hi > lo else 0.0
    base = float(np.median(d[max(0, cut - 3 - ctx):cut - 3])) if cut - 3 > 2 else float("nan")
    return peak, base, peak / max(base, 0.05)


def evaluate_motion_feel(ref_path, res_path, scene_cuts_sec):
    Gr, fps = load_gray(ref_path)
    Gs, _ = load_gray(res_path)
    n = min(len(Gr), len(Gs))
    cuts = [int(round(float(x) * fps)) for x in scene_cuts_sec if str(x).strip()]
    bounds = list(zip([0] + cuts, cuts + [n]))
    dw = drift_windows(Gr, Gs, bounds, fps)
    per_scene = []
    for si in range(1, len(bounds) + 1):
        w = [x for x in dw if x["scene"] == si]
        if not w:
            continue
        per_scene.append({
            "scene": si,
            "windows": len(w),
            "deadWindows": sum(1 for x in w if x["dead"]),
            "meanRef_lag15": round(float(np.mean([x["ref_lag15"] for x in w])), 4),
            "meanRes_lag15": round(float(np.mean([x["res_lag15"] for x in w])), 4),
        })
    seams = []
    for c in cuts:
        rp, rb, rr = seam_ratio(Gr, c)
        sp, sb, sr = seam_ratio(Gs, c)
        seams.append({
            "cutSec": round(c / fps, 3),
            "refPeak": round(rp, 2),
            "resPeak": round(sp, 2),
            "refPreMed": round(rb, 3) if np.isfinite(rb) else None,
            "resPreMed": round(sb, 3) if np.isfinite(sb) else None,
            "refRatio": round(rr, 1),
            "resRatio": round(sr, 1),
            "resPopVsRef": round(sr / max(rr, 0.5), 1),
        })
    d_ref = np.abs(np.diff(Gr[:n], axis=0)).mean(axis=(1, 2))
    d_res = np.abs(np.diff(Gs[:n], axis=0)).mean(axis=(1, 2))
    energy = []
    for si, (s0, s1) in enumerate(bounds, 1):
        r, s = d_ref[s0 + 4:s1 - 1], d_res[s0 + 4:s1 - 1]
        if len(r) > 3:
            energy.append({"scene": si, "ratioRes/Ref": round(float(s.mean() / max(1e-6, r.mean())), 2)})
    return {
        "fps": round(float(fps), 3),
        "frames": n,
        "perScene": per_scene,
        "seams": seams,
        "energy": energy,
        "totalDeadWindows": sum(p["deadWindows"] for p in per_scene),
        "totalWindows": sum(p["windows"] for p in per_scene),
        "driftWindows": dw,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("res")
    ap.add_argument("--scene-cuts", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    cuts = [float(x) for x in a.scene_cuts.split(",") if x.strip()]
    rep = evaluate_motion_feel(a.ref, a.res, cuts)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, indent=1)
    print("scene | windows dead | refLag15 resLag15")
    for p in rep["perScene"]:
        print("  S%-2d | %3d %3d | %.4f %.4f" % (p["scene"], p["windows"], p["deadWindows"], p["meanRef_lag15"], p["meanRes_lag15"]))
    print("seam @sec | refPeak resPeak | refPre resPre | refRatio resRatio | res/ref")
    for s in rep["seams"]:
        rpre = f"{s['refPreMed']:.2f}" if s["refPreMed"] is not None else "n/a"
        spre = f"{s['resPreMed']:.2f}" if s["resPreMed"] is not None else "n/a"
        print(
            "  %6.3f | %7.2f %7.2f | %6s %6s | %8.1f %8.1f | %5.1f%s"
            % (s["cutSec"], s["refPeak"], s["resPeak"], rpre, spre, s["refRatio"], s["resRatio"], s["resPopVsRef"], "  <-- POP" if s["resPopVsRef"] >= 3 else "")
        )
    print("energy ratio res/ref:", [e["ratioRes/Ref"] for e in rep["energy"]])
    print("TOTAL dead windows: %d / %d" % (rep["totalDeadWindows"], rep["totalWindows"]))


if __name__ == "__main__":
    main()
