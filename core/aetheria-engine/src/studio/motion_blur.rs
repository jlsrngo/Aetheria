//! Selective temporal supersampling (centered 130-degree shutter motion blur) for headless CDP export (Prompt 11 M5).
//!
//! Default is `Off`. Controlled via `AETHERIA_MOTION_BLUR=off|auto|N` (where `N` in `2..=12`).
//! In `auto` mode, only frames inside active `push_*`/`zoom_blur` transitions or measured high-velocity
//! `motionBursts`/`phaseZoomBridge` windows are supersampled (`8x`, centered shutter) directly on an
//! in-tab accumulation canvas so fast moves smear smoothly without 4-copy stroboscopic ghosting.

use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MotionBlurMode {
    Off,
    Auto { samples: u32, windows: Vec<(f64, f64)> },
    Fixed { samples: u32 },
}

impl MotionBlurMode {
    pub(crate) fn from_env_and_project(film_root: &Path, ws_root: &Path) -> Self {
        let raw = std::env::var("AETHERIA_MOTION_BLUR").unwrap_or_default();
        Self::parse_spec(&raw, film_root, ws_root)
    }

    pub(crate) fn parse_spec(spec: &str, film_root: &Path, ws_root: &Path) -> Self {
        let s = spec.trim().to_ascii_lowercase();
        if s.is_empty() || s == "off" || s == "0" || s == "false" || s == "none" {
            return Self::Off;
        }
        if s == "auto" {
            let windows = collect_motion_blur_windows(film_root, ws_root);
            return Self::Auto { samples: 8, windows };
        }
        if let Ok(n) = s.parse::<u32>() {
            let clamped = n.clamp(1, 12);
            if clamped <= 1 {
                return Self::Off;
            }
            return Self::Fixed { samples: clamped };
        }
        Self::Off
    }

    pub(crate) fn samples_for_time(&self, t: f64) -> u32 {
        match self {
            Self::Off => 1,
            Self::Fixed { samples } => *samples,
            Self::Auto { samples, windows } => {
                if windows.iter().any(|&(lo, hi)| t >= lo && t <= hi) {
                    *samples
                } else {
                    1
                }
            }
        }
    }

    pub(crate) fn is_enabled(&self) -> bool {
        !matches!(self, Self::Off)
    }
}

/// Collects global-time `(t_start, t_end)` intervals where fast camera/element motion or transitions occur
/// from `film.json` (`transitionBridge`) and `ref/extracted/style.json` (`motionBursts`, `phaseZoomBridge`).
pub(crate) fn collect_motion_blur_windows(film_root: &Path, ws_root: &Path) -> Vec<(f64, f64)> {
    let mut windows: Vec<(f64, f64)> = Vec::new();
    let pad = 0.04;

    if let Ok(raw) = std::fs::read_to_string(film_root.join("film.json")) {
        if let Ok(val) = serde_json::from_str::<Value>(&raw) {
            if let Some(scenes) = val.get("scenes").and_then(Value::as_array) {
                for sc in scenes {
                    if let Some(tb) = sc.get("transitionBridge") {
                        let kind = tb.get("kind").and_then(Value::as_str).unwrap_or("");
                        if kind.starts_with("push_") || kind == "zoom_blur" {
                            if let (Some(t0), Some(t1)) = (
                                tb.get("tStart").and_then(Value::as_f64),
                                tb.get("tEnd").and_then(Value::as_f64),
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
                            if peak >= 18.0 {
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
    merged
}

/// Builds the JS expression to evaluate either a single pure `window.renderAt(t)` (`samples <= 1`)
/// or an exact `N`-sub-frame centered temporal average across `[t - 0.18/fps, t + 0.18/fps]`.
pub(crate) fn build_render_frame_expr(t: f64, fps: f64, samples: u32) -> String {
    if samples <= 1 {
        return format!(
            "(() => {{ window.renderAt({:.6}); return new Promise(r => requestAnimationFrame(() => r(true))); }})()",
            t
        );
    }
    let n = samples.clamp(2, 12);
    let shutter_sec = 0.36 / fps.max(1.0);
    format!(
        "(() => {{ \
            const N = {}; const t0 = {:.6}; const shutter = {:.6}; \
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
            for (let k = 0; k < N; k++) {{ \
                const tk = Math.max(0, t0 + ((k + 0.5) / N - 0.5) * shutter); \
                window.renderAt(tk); \
                aCtx.globalAlpha = 1 / (k + 1); \
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
        n, t, shutter_sec
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_off_auto_and_fixed_modes_and_selects_burst_windows() {
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
                    { "id": "s2", "start": 2.5, "duration": 3.0, "transitionBridge": { "kind": "push_left", "tStart": 2.25, "tEnd": 2.75 } }
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
                        "motionClues": {
                            "kinematics": {
                                "motionBursts": [
                                    { "t0": 0.4, "t1": 0.7, "peakPxPerStep": 24.0 },
                                    { "t0": 1.2, "t1": 1.5, "peakPxPerStep": 5.0 }
                                ]
                            }
                        }
                    }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        let off = MotionBlurMode::parse_spec("", &film_dir, &tmp);
        assert!(!off.is_enabled());
        assert_eq!(off.samples_for_time(0.55), 1);

        let auto = MotionBlurMode::parse_spec("auto", &film_dir, &tmp);
        assert!(auto.is_enabled());
        assert_eq!(auto.samples_for_time(0.55), 8);
        assert_eq!(auto.samples_for_time(1.35), 1, "low-velocity burst should stay 1x");
        assert_eq!(auto.samples_for_time(2.50), 8, "push_left bridge should be 8x");
        assert_eq!(auto.samples_for_time(4.00), 1, "steady hold should stay 1x");

        let fixed = MotionBlurMode::parse_spec("6", &film_dir, &tmp);
        assert_eq!(fixed.samples_for_time(4.00), 6);

        let expr1 = build_render_frame_expr(1.0, 30.0, 1);
        assert!(!expr1.contains("__aeMbCanvas"));
        let expr8 = build_render_frame_expr(1.0, 30.0, 8);
        assert!(expr8.contains("__aeMbCanvas"));
        assert!(expr8.contains("const N = 8;"));
        assert!(expr8.contains("((k + 0.5) / N - 0.5)"));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
