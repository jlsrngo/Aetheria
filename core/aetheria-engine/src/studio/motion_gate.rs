//! Lightweight per-scene 30fps optical-flow motion gate (Prompt 12 M3).
//!
//! Captures 7 evenly spaced adjacent `1/fps` frame pairs inside the scene via headless CDP
//! (reusing the warm preview browser, ~2s) and evaluates Farneback `fastShare` / `p97Ratio`
//! against the identical timestamps in the reference video via `core/ref_extractor/ref_motion_gate.py`.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::preview_capture::{capture_film_preview_with_full_options, PreviewCaptureOptions};
use crate::paths::{locate_python_binary, now_ms};
use crate::tool::ref_probe::locate_reference_video;

#[derive(Debug, Clone)]
pub(crate) struct SceneMotionGateResult {
    pub fast_share_ref: f64,
    pub fast_share_res: f64,
    pub p97_ratio: f64,
    pub deficit: bool,
    pub warning: Option<String>,
    pub elapsed_ms: u64,
}

/// Selects up to 7 evenly spaced adjacent `(t0, t1)` frame pairs (`t1 - t0 = 1/fps`)
/// strictly inside `[safe_lo + 0.14, safe_hi - 0.14]` so cut transitions do not pollute flow.
pub(crate) fn build_motion_gate_pair_timestamps(
    safe_lo: f64,
    safe_hi: f64,
    film_duration: f64,
    fps: u32,
) -> Vec<(f64, f64)> {
    let safe_fps = (fps.max(15)) as f64;
    let dt = 1.0 / safe_fps;
    let max_t = (film_duration - 0.06).max(0.0);
    let inner_lo = (safe_lo + 0.14).min(max_t);
    let inner_hi = (safe_hi - 0.14 - dt).min(max_t - dt);
    if inner_hi <= inner_lo + 0.06 {
        return Vec::new();
    }
    let span = inner_hi - inner_lo;
    let n_pairs = ((span / 0.25).floor() as usize).clamp(4, 7);
    let mut pairs = Vec::with_capacity(n_pairs);
    for i in 0..n_pairs {
        let frac = if n_pairs <= 1 {
            0.5
        } else {
            i as f64 / (n_pairs - 1) as f64
        };
        let t0 = ((inner_lo + span * frac) * 1000.0).round() / 1000.0;
        let t1 = ((t0 + dt) * 1000.0).round() / 1000.0;
        if t1 <= max_t + 1e-4 && (t1 - t0) >= 0.022 {
            pairs.push((t0, t1));
        }
    }
    pairs
}

fn locate_motion_gate_script() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("core/ref_extractor/ref_motion_gate.py"),
        PathBuf::from("../core/ref_extractor/ref_motion_gate.py"),
        PathBuf::from("../../core/ref_extractor/ref_motion_gate.py"),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(6) {
            let p = anc.join("core").join("ref_extractor").join("ref_motion_gate.py");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn decode_data_url_bytes(data_url: &str) -> Option<(Vec<u8>, &'static str)> {
    let (header, b64) = data_url.split_once(',')?;
    let ext = if header.contains("image/png") {
        "png"
    } else {
        "jpg"
    };
    let bytes = B64.decode(b64.trim()).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some((bytes, ext))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_scene_motion_flow_gate(
    workspace_dir: &str,
    ws_root: &Path,
    scene_id: &str,
    safe_lo: f64,
    safe_hi: f64,
    film_duration: f64,
    fps: u32,
    secondary_motion: &[Value],
) -> Option<SceneMotionGateResult> {
    let started = now_ms();
    let ref_video = locate_reference_video(ws_root, None)?;
    let script_path = locate_motion_gate_script()?;
    let pairs = build_motion_gate_pair_timestamps(safe_lo, safe_hi, film_duration, fps);
    if pairs.len() < 4 {
        return None;
    }

    let mut ts_list = Vec::with_capacity(pairs.len() * 2);
    for &(t0, t1) in &pairs {
        ts_list.push(t0);
        ts_list.push(t1);
    }

    let capture = capture_film_preview_with_full_options(
        workspace_dir,
        ts_list,
        PreviewCaptureOptions {
            compare_to_reference: Some(false),
            pass_threshold: None,
            visual_inspect_only: Some(true),
            include_full_res_frames: Some(false),
            disable_auto_rollback: true,
            forced_scene_id: Some(scene_id.to_string()),
            write_scene_beat_strips: Some(false),
        },
    )
    .await
    .ok()?;

    if capture.frames.len() < 6 {
        return None;
    }

    let tmp_dir = std::env::temp_dir().join(format!(
        "aetheria_mgate_{}_{}",
        std::process::id(),
        now_ms()
    ));
    tokio::fs::create_dir_all(&tmp_dir).await.ok()?;

    let mut json_pairs = Vec::new();
    for (idx, &(t0, t1)) in pairs.iter().enumerate() {
        let f0 = capture.frames.iter().min_by(|a, b| {
            (a.timestamp - t0)
                .abs()
                .partial_cmp(&(b.timestamp - t0).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let f1 = capture.frames.iter().min_by(|a, b| {
            (a.timestamp - t1)
                .abs()
                .partial_cmp(&(b.timestamp - t1).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let (Some(fr0), Some(fr1)) = (f0, f1) else {
            continue;
        };
        if (fr0.timestamp - t0).abs() > 0.015 || (fr1.timestamp - t1).abs() > 0.015 {
            continue;
        }
        let (Some((b0, ext0)), Some((b1, ext1))) = (
            decode_data_url_bytes(&fr0.data_url),
            decode_data_url_bytes(&fr1.data_url),
        ) else {
            continue;
        };
        let p0 = tmp_dir.join(format!("p{}_0.{}", idx, ext0));
        let p1 = tmp_dir.join(format!("p{}_1.{}", idx, ext1));
        if tokio::fs::write(&p0, b0).await.is_ok() && tokio::fs::write(&p1, b1).await.is_ok() {
            json_pairs.push(json!({
                "t0": t0,
                "t1": t1,
                "prev0": p0.to_string_lossy().to_string(),
                "prev1": p1.to_string_lossy().to_string(),
            }));
        }
    }

    if json_pairs.len() < 3 {
        let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
        return None;
    }

    let payload_path = tmp_dir.join("payload.json");
    let payload = json!({
        "refVideoPath": ref_video.to_string_lossy().to_string(),
        "pairs": json_pairs,
        "secondaryMotion": secondary_motion,
    });
    if tokio::fs::write(&payload_path, payload.to_string())
        .await
        .is_err()
    {
        let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
        return None;
    }

    let python = locate_python_binary();
    let out = tokio::process::Command::new(python)
        .arg(&script_path)
        .arg(&payload_path)
        .output()
        .await;
    let _ = tokio::fs::remove_dir_all(&tmp_dir).await;

    let output = out.ok()?;
    if !output.status.success() {
        return None;
    }
    let val: Value = serde_json::from_slice(&output.stdout).ok()?;
    if val.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }

    let deficit = val.get("deficit").and_then(Value::as_bool).unwrap_or(false);
    let warning = val
        .get("warning")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    Some(SceneMotionGateResult {
        fast_share_ref: val.get("fastShareRef").and_then(Value::as_f64).unwrap_or(0.0),
        fast_share_res: val.get("fastShareRes").and_then(Value::as_f64).unwrap_or(0.0),
        p97_ratio: val.get("p97Ratio").and_then(Value::as_f64).unwrap_or(1.0),
        deficit,
        warning,
        elapsed_ms: now_ms().saturating_sub(started),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_evenly_spaced_adjacent_30fps_pairs_inside_safe_bounds() {
        let pairs = build_motion_gate_pair_timestamps(6.21, 9.54, 17.88, 30);
        assert_eq!(pairs.len(), 7);
        for &(t0, t1) in &pairs {
            assert!(t0 >= 6.34 && t1 <= 9.41);
            assert!((t1 - t0 - 1.0 / 30.0).abs() < 0.002);
        }
        // Very short scene (< 0.35s) cleanly returns empty
        assert!(build_motion_gate_pair_timestamps(0.0, 0.25, 5.0, 30).is_empty());
    }
}
