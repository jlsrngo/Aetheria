//! Selective temporal supersampling (centered 180-degree tent-weighted shutter motion blur)
//! for headless CDP export with strict hard-cut boundary clamping.
//!
//! Default is `Auto` (opt out via `AETHERIA_MOTION_BLUR=off`, or force fixed `N` in `2..=12`).
//! In `Auto` mode, frames inside active soft transitions (`push_*`/`zoom_blur`), measured
//! high-velocity `motionBursts`/`phaseZoomBridge`/`actionWindows`, or fast `secondaryMotion`
//! are supersampled (`8x`, tent-weighted 180° shutter) directly on an in-tab accumulation canvas,
//! with sub-frame timestamps clamped strictly inside hard-cut scene boundaries so hard cuts
//! never ghost across scenes.

use serde_json::Value;
use std::path::Path;

/// EffectCraft-derived adaptive shutter sub-sample calculator (`crates/render/src/frames.rs`).
/// Returns `1` when corner travel during shutter is sub-pixel (`< 1.0` px), otherwise scales
/// smoothly ~1 sample per pixel clamped within `[per_frame, limit]`.
pub(crate) fn adaptive_samples(travel_px: f64, per_frame: u32, limit: u32) -> u32 {
    if !travel_px.is_finite() || travel_px < 1.0 {
        return 1;
    }
    let lo = per_frame.clamp(2, 12) as f64;
    let hi = (limit.clamp(4, 16) as f64).max(lo);
    travel_px.ceil().clamp(lo, hi) as u32
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MotionBlurMode {
    Off,
    Auto {
        samples: u32,
        windows: Vec<(f64, f64)>,
        hard_cuts: Vec<f64>,
    },
    Fixed {
        samples: u32,
        hard_cuts: Vec<f64>,
    },
}

fn is_soft_bridge_kind(kind: &str) -> bool {
    kind.starts_with("push_")
        || matches!(kind, "zoom_blur" | "zoom_in" | "zoom_out" | "blur_dissolve")
}

impl MotionBlurMode {
    pub(crate) fn from_env_and_project(film_root: &Path, ws_root: &Path) -> Self {
        let raw = std::env::var("AETHERIA_MOTION_BLUR").unwrap_or_default();
        let trimmed = raw.trim();
        let spec = if trimmed.is_empty() { "auto" } else { trimmed };
        Self::parse_spec(spec, film_root, ws_root)
    }

    pub(crate) fn parse_spec(spec: &str, film_root: &Path, ws_root: &Path) -> Self {
        let s = spec.trim().to_ascii_lowercase();
        if s == "off" || s == "0" || s == "false" || s == "none" {
            return Self::Off;
        }
        if s.is_empty() || s == "auto" {
            let (windows, hard_cuts) = collect_motion_blur_profile(film_root, ws_root);
            return Self::Auto {
                samples: 8,
                windows,
                hard_cuts,
            };
        }
        if let Ok(n) = s.parse::<u32>() {
            let clamped = n.clamp(1, 12);
            if clamped <= 1 {
                return Self::Off;
            }
            let (_, hard_cuts) = collect_motion_blur_profile(film_root, ws_root);
            return Self::Fixed {
                samples: clamped,
                hard_cuts,
            };
        }
        Self::Off
    }

    pub(crate) fn samples_for_time(&self, t: f64) -> u32 {
        match self {
            Self::Off => 1,
            Self::Fixed { samples, .. } => *samples,
            Self::Auto { samples, windows, .. } => {
                if windows.iter().any(|&(lo, hi)| t >= lo && t <= hi) {
                    adaptive_samples(*samples as f64, 4, *samples)
                } else {
                    1
                }
            }
        }
    }

    /// Returns centered 180-degree shutter bounds `(t_lo, t_hi)` clamped so sub-frames
    /// never bleed across a hard scene cut.
    pub(crate) fn shutter_bounds(&self, t: f64, fps: f64) -> (f64, f64) {
        let half = 0.25 / fps.max(1.0);
        let mut lo = (t - half).max(0.0);
        let mut hi = (t + half).max(lo);
        let cuts: &[f64] = match self {
            Self::Off => &[],
            Self::Auto { hard_cuts, .. } | Self::Fixed { hard_cuts, .. } => hard_cuts,
        };
        for &cut in cuts {
            if !cut.is_finite() || cut <= 0.0 {
                continue;
            }
            if t < cut && hi >= cut - 0.0005 {
                hi = (cut - 0.0005).max(lo);
            } else if t >= cut && lo < cut + 0.0001 {
                lo = (cut + 0.0001).min(hi);
            }
        }
        (lo, hi.max(lo))
    }

    pub(crate) fn is_enabled(&self) -> bool {
        !matches!(self, Self::Off)
    }
}

/// Collects global-time `(t_start, t_end)` fast-motion windows AND hard-cut boundary timestamps
/// from `film.json` (`transitionBridge`) and `ref/extracted/style.json`
/// (`motionBursts`, `phaseZoomBridge`, `actionWindows`, `secondaryMotion`).
pub(crate) fn collect_motion_blur_profile(
    film_root: &Path,
    ws_root: &Path,
) -> (Vec<(f64, f64)>, Vec<f64>) {
    let mut windows: Vec<(f64, f64)> = Vec::new();
    let mut hard_cuts: Vec<f64> = Vec::new();
    let pad = 0.04;

    if let Ok(raw) = std::fs::read_to_string(film_root.join("film.json")) {
        if let Ok(val) = serde_json::from_str::<Value>(&raw) {
            if let Some(scenes) = val.get("scenes").and_then(Value::as_array) {
                for (idx, sc) in scenes.iter().enumerate() {
                    let tb = sc.get("transitionBridge");
                    let kind = tb
                        .and_then(|v| v.get("kind"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let is_soft = is_soft_bridge_kind(kind);
                    if idx > 0 && !is_soft {
                        if let Some(start) = sc.get("start").and_then(Value::as_f64) {
                            if start > 0.0 {
                                hard_cuts.push(start);
                            }
                        }
                    }
                    if is_soft {
                        if let Some(tb_obj) = tb {
                            if let (Some(t0), Some(t1)) = (
                                tb_obj.get("tStart").and_then(Value::as_f64),
                                tb_obj.get("tEnd").and_then(Value::as_f64),
                            ) {
                                if t1 > t0 {
                                    windows.push(((t0 - pad).max(0.0), t1 + pad));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let style_path = ws_root.join("ref").join("extracted").join("style.json");
    if let Ok(raw) = std::fs::read_to_string(&style_path) {
        if let Ok(val) = serde_json::from_str::<Value>(&raw) {
            if let Some(scenes) = val.get("scenes").and_then(Value::as_array) {
                for sc in scenes {
                    let s0 = sc.get("start").and_then(Value::as_f64).unwrap_or(0.0);
                    if let Some(bursts) = sc
                        .pointer("/motionClues/kinematics/motionBursts")
                        .and_then(Value::as_array)
                    {
                        for b in bursts {
                            let peak = b.get("peakPxPerStep").and_then(Value::as_f64).unwrap_or(0.0);
                            if peak >= 14.0 {
                                if let (Some(bt0), Some(bt1)) = (
                                    b.get("t0").and_then(Value::as_f64),
                                    b.get("t1").and_then(Value::as_f64),
                                ) {
                                    if bt1 > bt0 {
                                        windows.push(((s0 + bt0 - pad).max(0.0), s0 + bt1 + pad));
                                    }
                                }
                            }
                        }
                    }
                    if let Some(pzb) = sc.pointer("/motionTimeline30fps/phaseZoomBridge") {
                        if let (Some(zt0), Some(zt1)) = (
                            pzb.get("t0").and_then(Value::as_f64),
                            pzb.get("t1").and_then(Value::as_f64),
                        ) {
                            if zt1 > zt0 {
                                windows.push(((s0 + zt0 - pad).max(0.0), s0 + zt1 + pad));
                            }
                        }
                    }
                    if let Some(aw_list) = sc
                        .pointer("/motionTimeline30fps/actionWindows")
                        .and_then(Value::as_array)
                    {
                        for aw in aw_list {
                            let p90 = aw.get("peakP90").and_then(Value::as_f64).unwrap_or(0.0);
                            if p90 >= 12.0 {
                                if let (Some(at0), Some(at1)) = (
                                    aw.get("t0").and_then(Value::as_f64),
                                    aw.get("t1").and_then(Value::as_f64),
                                ) {
                                    if at1 > at0 {
                                        windows.push(((s0 + at0 - pad).max(0.0), s0 + at1 + pad));
                                    }
                                }
                            }
                        }
                    }
                    if let Some(sec_list) = sc
                        .pointer("/motionClues/secondaryMotion")
                        .and_then(Value::as_array)
                    {
                        for sec in sec_list {
                            let omega = sec
                                .get("ampDegPerSec")
                                .and_then(Value::as_f64)
                                .unwrap_or(0.0)
                                .abs();
                            let spd = sec
                                .get("speedPxPerSec")
                                .and_then(Value::as_f64)
                                .unwrap_or(0.0)
                                .abs();
                            if omega >= 50.0 || spd >= 100.0 {
                                if let (Some(st0), Some(st1)) = (
                                    sec.get("tStart").and_then(Value::as_f64),
                                    sec.get("tEnd").and_then(Value::as_f64),
                                ) {
                                    if st1 > st0 {
                                        windows.push(((s0 + st0).max(0.0), s0 + st1));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    windows.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (lo, hi) in windows {
        if let Some(last) = merged.last_mut() {
            if lo <= last.1 + 0.02 {
                last.1 = last.1.max(hi);
                continue;
            }
        }
        merged.push((lo, hi));
    }
    hard_cuts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    (merged, hard_cuts)
}

/// Builds the JS expression to evaluate either a single pure `window.renderAt(t)` (`samples <= 1`)
/// or a tent-weighted `N`-sub-frame centered 180° shutter average across `[t_lo, t_hi]`.
pub(crate) fn build_render_frame_expr(
    t: f64,
    fps: f64,
    samples: u32,
    shutter_bounds: Option<(f64, f64)>,
) -> String {
    if samples <= 1 {
        return format!(
            "(() => {{ window.renderAt({:.6}); return new Promise(r => requestAnimationFrame(() => r(true))); }})()",
            t
        );
    }
    let n = samples.clamp(2, 12);
    let half = 0.25 / fps.max(1.0);
    let (t_lo, t_hi) = shutter_bounds.unwrap_or(((t - half).max(0.0), t + half));
    format!(
        "(() => {{ \
            const N = {}; const t0 = {:.6}; const tLo = {:.6}; const tHi = {:.6}; \
            const stage = document.querySelector('canvas'); \
            if (!stage || !stage.getContext) {{ window.renderAt(t0); return new Promise(r => requestAnimationFrame(() => r(true))); }} \
            const sCtx = stage.getContext('2d'); \
            if (!sCtx) {{ window.renderAt(t0); return new Promise(r => requestAnimationFrame(() => r(true))); }} \
            if (!window.__aeMbCanvas || window.__aeMbCanvas.width !== stage.width || window.__aeMbCanvas.height !== stage.height) {{ \
                window.__aeMbCanvas = document.createElement('canvas'); \
                window.__aeMbCanvas.width = stage.width; \
                window.__aeMbCanvas.height = stage.height; \
            }} \
            const acc = window.__aeMbCanvas; \
            const aCtx = acc.getContext('2d'); \
            aCtx.setTransform(1, 0, 0, 1, 0, 0); \
            aCtx.clearRect(0, 0, acc.width, acc.height); \
            let wSum = 0; \
            for (let k = 0; k < N; k++) {{ \
                const frac = (k + 0.5) / N; \
                const tk = Math.max(0, tLo + (tHi - tLo) * frac); \
                const u = frac * 2 - 1; \
                const wk = 1 - Math.abs(u) * 0.6; \
                wSum += wk; \
                window.renderAt(tk); \
                aCtx.globalAlpha = wk / wSum; \
                aCtx.drawImage(stage, 0, 0); \
            }} \
            aCtx.globalAlpha = 1; \
            sCtx.save(); \
            sCtx.setTransform(1, 0, 0, 1, 0, 0); \
            sCtx.clearRect(0, 0, stage.width, stage.height); \
            sCtx.drawImage(acc, 0, 0); \
            sCtx.restore(); \
            return new Promise(r => requestAnimationFrame(() => r(true))); \
        }})()",
        n, t, t_lo, t_hi
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_off_auto_and_fixed_modes_and_clamps_hard_cuts() {
        let tmp = std::env::temp_dir().join(format!("aetheria_mb_{}", crate::paths::now_ms()));
        let film_dir = tmp.join("projects").join("demo");
        let ref_dir = tmp.join("ref").join("extracted");
        std::fs::create_dir_all(&film_dir).unwrap();
        std::fs::create_dir_all(&ref_dir).unwrap();
        std::fs::write(
            film_dir.join("film.json"),
            serde_json::to_string(&json!({
                "scenes": [
                    { "id": "s1", "start": 0.0, "duration": 2.5 },
                    { "id": "s2", "start": 2.5, "duration": 3.0, "transitionBridge": { "kind": "push_left", "tStart": 2.25, "tEnd": 2.75 } },
                    { "id": "s3", "start": 5.5, "duration": 2.0, "transitionBridge": { "kind": "hard_cut" } }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            ref_dir.join("style.json"),
            serde_json::to_string(&json!({
                "scenes": [
                    {
                        "id": "s1",
                        "start": 0.0,
                        "motionTimeline30fps": {
                            "actionWindows": [
                                { "t0": 1.8, "t1": 2.0, "peakP90": 16.0 }
                            ]
                        },
                        "motionClues": {
                            "kinematics": {
                                "motionBursts": [
                                    { "t0": 0.4, "t1": 0.7, "peakPxPerStep": 24.0 },
                                    { "t0": 1.2, "t1": 1.5, "peakPxPerStep": 5.0 }
                                ]
                            },
                            "secondaryMotion": [
                                { "kind": "rotate", "tStart": 0.8, "tEnd": 1.1, "ampDegPerSec": 95.0 }
                            ]
                        }
                    }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        let off = MotionBlurMode::parse_spec("off", &film_dir, &tmp);
        assert!(!off.is_enabled());
        assert_eq!(off.samples_for_time(0.55), 1);

        let default_auto = MotionBlurMode::parse_spec("", &film_dir, &tmp);
        assert!(default_auto.is_enabled());
        assert_eq!(default_auto.samples_for_time(0.55), 8);
        assert_eq!(default_auto.samples_for_time(0.95), 8, "fast secondaryMotion should be 8x");
        assert_eq!(default_auto.samples_for_time(1.90), 8, "fast actionWindow should be 8x");
        assert_eq!(default_auto.samples_for_time(1.35), 1, "low-velocity burst should stay 1x");
        assert_eq!(default_auto.samples_for_time(2.50), 8, "push_left bridge should be 8x");
        assert_eq!(default_auto.samples_for_time(4.00), 1, "steady hold should stay 1x");

        // Hard cut at 5.5 must clamp shutter bounds cleanly on both sides
        let (pre_lo, pre_hi) = default_auto.shutter_bounds(5.498, 30.0);
        assert!(pre_hi < 5.5, "pre-cut shutter must not bleed past 5.5: ({}, {})", pre_lo, pre_hi);
        let (post_lo, post_hi) = default_auto.shutter_bounds(5.501, 30.0);
        assert!(post_lo >= 5.5, "post-cut shutter must not bleed before 5.5: ({}, {})", post_lo, post_hi);

        // Soft push_left bridge at 2.5 must NOT be clamped
        let (soft_lo, soft_hi) = default_auto.shutter_bounds(2.500, 30.0);
        assert!(soft_lo < 2.5 && soft_hi > 2.5);

        let fixed = MotionBlurMode::parse_spec("6", &film_dir, &tmp);
        assert_eq!(fixed.samples_for_time(4.00), 6);

        let expr1 = build_render_frame_expr(1.0, 30.0, 1, None);
        assert!(!expr1.contains("__aeMbCanvas"));
        let expr8 = build_render_frame_expr(1.0, 30.0, 8, Some((0.992, 1.008)));
        assert!(expr8.contains("__aeMbCanvas"));
        assert!(expr8.contains("const N = 8;"));
        assert!(expr8.contains("wk / wSum"));

        assert_eq!(adaptive_samples(0.0, 4, 12), 1);
        assert_eq!(adaptive_samples(0.8, 4, 12), 1);
        assert_eq!(adaptive_samples(2.2, 4, 12), 4);
        assert_eq!(adaptive_samples(8.5, 4, 12), 9);
        assert_eq!(adaptive_samples(50.0, 4, 12), 12);

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
