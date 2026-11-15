"""
MotionClone-inspired Closed-Loop Visual Comparison Engine.
Computes per-channel RGB SSIM (11x11 Gaussian window, sigma=1.5), color histogram
similarity, Sobel/Canny edge structure overlap, and renders a side-by-side
[Reference | Generated | Amplified Diff] comparison strip JPEG.
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

try:
    import cv2
    import numpy as np
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"Required Python vision library missing: {e}"}))
    sys.exit(1)


def compute_rgb_ssim(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Computes per-channel RGB SSIM with an 11x11 Gaussian window (sigma=1.5)."""
    a = img_a.astype(np.float64)
    b = img_b.astype(np.float64)
    c1 = (0.01 * 255.0) ** 2
    c2 = (0.03 * 255.0) ** 2

    channel_scores: List[float] = []
    for ch in range(3):
        ac = a[:, :, ch]
        bc = b[:, :, ch]
        mu1 = cv2.GaussianBlur(ac, (11, 11), 1.5)
        mu2 = cv2.GaussianBlur(bc, (11, 11), 1.5)
        mu1_sq = mu1 * mu1
        mu2_sq = mu2 * mu2
        mu1_mu2 = mu1 * mu2

        sigma1_sq = cv2.GaussianBlur(ac * ac, (11, 11), 1.5) - mu1_sq
        sigma2_sq = cv2.GaussianBlur(bc * bc, (11, 11), 1.5) - mu2_sq
        sigma12 = cv2.GaussianBlur(ac * bc, (11, 11), 1.5) - mu1_mu2

        num = (2.0 * mu1_mu2 + c1) * (2.0 * sigma12 + c2)
        den = (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)
        ssim_map = num / np.maximum(den, 1e-8)
        channel_scores.append(float(np.mean(ssim_map)))

    return float(np.clip(np.mean(channel_scores), 0.0, 1.0))


def _smooth_l1_hist(channel: np.ndarray, bins: int = 24) -> np.ndarray:
    hist = cv2.calcHist([channel], [0], None, [bins], [0, 256]).flatten().astype(np.float32)
    kernel = np.array([0.2, 0.6, 0.2], dtype=np.float32)
    smoothed = np.convolve(hist, kernel, mode="same")
    total = float(np.sum(smoothed))
    if total > 0.0:
        smoothed /= total
    return smoothed.reshape(-1, 1)


def compute_color_similarity(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Combines CIELAB channel distribution overlap (immune to neutral hue wrap) with RGB proximity."""
    lab_a = cv2.cvtColor(img_a, cv2.COLOR_BGR2LAB)
    lab_b = cv2.cvtColor(img_b, cv2.COLOR_BGR2LAB)
    channel_sims: List[float] = []
    for ch in range(3):
        ha = _smooth_l1_hist(lab_a[:, :, ch])
        hb = _smooth_l1_hist(lab_b[:, :, ch])
        bhatt = float(cv2.compareHist(ha, hb, cv2.HISTCMP_BHATTACHARYYA))
        channel_sims.append(max(0.0, 1.0 - bhatt))
    dist_sim = float(np.mean(channel_sims))

    mean_diff = float(np.mean(np.abs(img_a.astype(np.float32) - img_b.astype(np.float32)))) / 255.0
    pixel_color_sim = max(0.0, 1.0 - mean_diff * 1.4)
    return float(np.clip(0.55 * dist_sim + 0.45 * pixel_color_sim, 0.0, 1.0))


def compute_edge_similarity(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Measures spatial composition alignment via dilated Canny edge F1 overlap."""
    ga = cv2.GaussianBlur(cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    gb = cv2.GaussianBlur(cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    ea = cv2.Canny(ga, 50, 150) > 0
    eb = cv2.Canny(gb, 50, 150) > 0

    ea_sum = int(np.sum(ea))
    eb_sum = int(np.sum(eb))
    if ea_sum == 0 and eb_sum == 0:
        return 1.0
    if ea_sum == 0 or eb_sum == 0:
        return 0.15

    kernel = np.ones((5, 5), np.uint8)
    ea_dil = cv2.dilate(ea.astype(np.uint8), kernel, iterations=1) > 0
    eb_dil = cv2.dilate(eb.astype(np.uint8), kernel, iterations=1) > 0

    prec = float(np.sum(eb & ea_dil)) / max(1, eb_sum)
    rec = float(np.sum(ea & eb_dil)) / max(1, ea_sum)
    if prec + rec <= 1e-6:
        return 0.0
    return float(np.clip(2.0 * prec * rec / (prec + rec), 0.0, 1.0))


def _fit_for_strip(img: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    return cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)


def compare_pairs(payload: Dict[str, Any]) -> Dict[str, Any]:
    pairs = payload.get("pairs") or []
    if not pairs:
        return {"ok": False, "error": "No reference/preview frame pairs supplied."}

    strip_out = Path(payload.get("stripOutputPath", "comparison_strip.jpg"))
    strip_out.parent.mkdir(parents=True, exist_ok=True)
    threshold = float(payload.get("passThreshold", 0.72))

    per_frame: List[Dict[str, Any]] = []
    strip_rows: List[np.ndarray] = []

    for item in pairs:
        ref_path = Path(str(item.get("refPath", "")))
        prev_path = Path(str(item.get("previewPath", "")))
        ts = float(item.get("timestamp", 0.0))

        if not ref_path.is_file() or not prev_path.is_file():
            continue

        ref_img = cv2.imread(str(ref_path))
        prev_img = cv2.imread(str(prev_path))
        if ref_img is None or prev_img is None:
            continue

        # Normalize comparison size up to 480px max dimension (preserving preview aspect)
        ph, pw = prev_img.shape[:2]
        scale = min(1.0, 480.0 / max(1, max(ph, pw)))
        cw = max(64, int(round(pw * scale)))
        ch = max(64, int(round(ph * scale)))

        ref_cmp = _fit_for_strip(ref_img, cw, ch)
        prev_cmp = _fit_for_strip(prev_img, cw, ch)

        ssim = compute_rgb_ssim(ref_cmp, prev_cmp)
        color_sim = compute_color_similarity(ref_cmp, prev_cmp)
        edge_sim = compute_edge_similarity(ref_cmp, prev_cmp)
        luma_ref = float(np.mean(cv2.cvtColor(ref_cmp, cv2.COLOR_BGR2GRAY))) / 255.0
        luma_prev = float(np.mean(cv2.cvtColor(prev_cmp, cv2.COLOR_BGR2GRAY))) / 255.0
        luma_delta = round(luma_prev - luma_ref, 3)

        combined = float(np.clip(0.50 * ssim + 0.30 * color_sim + 0.20 * edge_sim, 0.0, 1.0))
        verdict = "cocok" if combined >= 0.80 else ("sebagian" if combined >= 0.58 else "beda")

        per_frame.append({
            "timestamp": round(ts, 3),
            "refPath": str(item.get("refRelPath") or ref_path.name),
            "previewPath": str(item.get("previewRelPath") or prev_path.name),
            "ssim": round(ssim, 4),
            "colorSimilarity": round(color_sim, 4),
            "edgeSimilarity": round(edge_sim, 4),
            "luminanceDelta": luma_delta,
            "combinedScore": round(combined, 4),
            "verdict": verdict,
        })

        # Build [Reference | Generated | Diff Heatmap] row
        diff_raw = cv2.absdiff(ref_cmp, prev_cmp)
        diff_gray = cv2.cvtColor(diff_raw, cv2.COLOR_BGR2GRAY)
        diff_boost = np.clip(diff_gray.astype(np.float32) * 2.5, 0, 255).astype(np.uint8)
        diff_heat = cv2.applyColorMap(diff_boost, cv2.COLORMAP_INFERNO)

        tile_h = 260
        tile_w = max(90, int(round(tile_h * (cw / max(1, ch)))))
        r_tile = _fit_for_strip(ref_cmp, tile_w, tile_h)
        p_tile = _fit_for_strip(prev_cmp, tile_w, tile_h)
        d_tile = _fit_for_strip(diff_heat, tile_w, tile_h)

        row_img = np.hstack([r_tile, p_tile, d_tile])
        banner = np.full((28, row_img.shape[1], 3), (24, 24, 28), dtype=np.uint8)
        label = (
            f"t={ts:.2f}s | REF vs PREVIEW vs DIFF | "
            f"SSIM={ssim:.3f} Color={color_sim:.3f} Edge={edge_sim:.3f} [{verdict.upper()}]"
        )
        cv2.putText(
            banner,
            label,
            (8, 19),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (240, 240, 245),
            1,
            cv2.LINE_AA,
        )
        strip_rows.append(np.vstack([banner, row_img]))

    if not per_frame:
        return {"ok": False, "error": "Failed to load any valid reference/preview image pairs."}

    strip_saved = False
    if strip_rows:
        canvas = np.vstack(strip_rows)
        strip_saved = bool(cv2.imwrite(str(strip_out), canvas, [cv2.IMWRITE_JPEG_QUALITY, 86]))

    ssim_mean = round(float(np.mean([f["ssim"] for f in per_frame])), 4)
    ssim_min = round(float(np.min([f["ssim"] for f in per_frame])), 4)
    color_mean = round(float(np.mean([f["colorSimilarity"] for f in per_frame])), 4)
    edge_mean = round(float(np.mean([f["edgeSimilarity"] for f in per_frame])), 4)
    overall = round(float(np.mean([f["combinedScore"] for f in per_frame])), 4)
    worst = sorted(per_frame, key=lambda f: f["combinedScore"])[:2]

    return {
        "ok": True,
        "comparedCount": len(per_frame),
        "ssimMean": ssim_mean,
        "ssimMin": ssim_min,
        "colorMatchMean": color_mean,
        "edgeMatchMean": edge_mean,
        "overallFidelity": overall,
        "passThreshold": threshold,
        "passed": bool(overall >= threshold or ssim_mean >= threshold),
        "comparisonStripPath": str(strip_out) if strip_saved else None,
        "perFrame": per_frame,
        "worstFrames": worst,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: ref_compare.py <payload.json>"}))
        sys.exit(1)
    payload_path = Path(sys.argv[1])
    data = json.loads(payload_path.read_text(encoding="utf-8"))
    result = compare_pairs(data)
    print(json.dumps(result, indent=2))

