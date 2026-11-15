//! Closed-Loop Reference Visual Comparison & Video Duration Probing.
//! Pairs captured preview frames against extracted reference keyframes (`ref/`)
//! and invokes `core/ref_extractor/ref_compare.py` for per-channel RGB SSIM,
//! color/edge similarity, and side-by-side comparison strip generation.

use super::preview_capture::PreviewFrameCapture;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq)]
pub struct ReferenceKeyframe {
    pub timestamp: f64,
    pub abs_path: PathBuf,
    pub rel_path: String,
}

#[derive(Clone, Debug)]
pub struct FrameComparePair {
    pub timestamp: f64,
    pub ref_abs: PathBuf,
    pub ref_rel: String,
    pub preview_abs: PathBuf,
    pub preview_rel: String,
}

/// Parses `Duration: HH:MM:SS.xx` from FFmpeg's stderr output.
pub fn parse_ffmpeg_duration_stderr(stderr: &str) -> Option<f64> {
    let idx = stderr.find("Duration:")?;
    let after = stderr[idx + "Duration:".len()..].trim_start();
    let token = after.split(&[',', ' ', '\r', '\n'][..]).next()?.trim();
    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let mins: f64 = parts[1].parse().ok()?;
    let secs: f64 = parts[2].parse().ok()?;
    let total = hours * 3600.0 + mins * 60.0 + secs;
    if total.is_finite() && total > 0.05 {
        Some((total * 100.0).round() / 100.0)
    } else {
        None
    }
}

/// Probes real video duration in seconds using `ffmpeg -i` (requires no separate `ffprobe` binary).
pub fn probe_video_duration_secs(ffmpeg_bin: &Path, video_path: &Path) -> Option<f64> {
    let mut cmd = std::process::Command::new(ffmpeg_bin);
    crate::paths::configure_hidden_std_command(&mut cmd);
    let out = cmd
        .args(["-hide_banner", "-i"])
        .arg(video_path)
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    parse_ffmpeg_duration_stderr(&stderr)
}

fn rel_display(ws_root: &Path, abs_path: &Path) -> String {
    abs_path
        .strip_prefix(ws_root)
        .unwrap_or(abs_path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Discovers extracted reference keyframes inside `<ws_root>/ref/` ordered by timestamp.
pub fn discover_reference_keyframes(ws_root: &Path, film_duration: f64) -> Vec<ReferenceKeyframe> {
    let ref_dir = ws_root.join("ref");
    if !ref_dir.is_dir() {
        return Vec::new();
    }

    let extracted_dir = ref_dir.join("extracted");
    let style_path = extracted_dir.join("style.json");
    let mut out = Vec::new();

    if let Ok(raw) = std::fs::read_to_string(&style_path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
            if let Some(scenes) = parsed.get("scenes").and_then(Value::as_array) {
                for sc in scenes {
                    let Some(kf_rel) = sc.get("keyframe").and_then(Value::as_str) else {
                        continue;
                    };
                    let abs = extracted_dir.join(kf_rel);
                    if abs.is_file() {
                        let ts = sc
                            .get("keyframeTimestamp")
                            .and_then(Value::as_f64)
                            .or_else(|| {
                                let s = sc.get("start").and_then(Value::as_f64)?;
                                let d = sc.get("duration").and_then(Value::as_f64)?;
                                Some(s + d * 0.5)
                            })
                            .unwrap_or(0.0);
                        out.push(ReferenceKeyframe {
                            timestamp: ts,
                            rel_path: rel_display(ws_root, &abs),
                            abs_path: abs,
                        });
                    }
                }
            }
        }
    }
    if !out.is_empty() {
        return out;
    }

    // Fallback 1: `ref/extracted/frames/thumb_00N.jpg`
    let safe_dur = if film_duration.is_finite() && film_duration > 0.0 {
        film_duration
    } else {
        10.0
    };
    let ratios = [0.10, 0.35, 0.60, 0.85];
    let frames_dir = extracted_dir.join("frames");
    if frames_dir.is_dir() {
        let mut thumbs: Vec<PathBuf> = std::fs::read_dir(&frames_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("thumb_") && n.ends_with(".jpg"))
            })
            .collect();
        thumbs.sort();
        for (idx, p) in thumbs.into_iter().take(4).enumerate() {
            let ts = safe_dur * ratios.get(idx).copied().unwrap_or(0.5);
            out.push(ReferenceKeyframe {
                timestamp: (ts * 100.0).round() / 100.0,
                rel_path: rel_display(ws_root, &p),
                abs_path: p,
            });
        }
        if !out.is_empty() {
            return out;
        }
    }

    // Fallback 2: `ref/ref_tiktok_frame_1..4.jpg`, `ref_pinterest_frame_1..4.jpg`, `ref_frame_1..4.jpg`
    for prefix in ["ref_tiktok_frame_", "ref_pinterest_frame_", "ref_frame_"] {
        let mut seq = Vec::new();
        for idx in 1..=4 {
            let p = ref_dir.join(format!("{}{}.jpg", prefix, idx));
            if p.is_file() {
                let ts = safe_dur * ratios[idx - 1];
                seq.push(ReferenceKeyframe {
                    timestamp: (ts * 100.0).round() / 100.0,
                    rel_path: rel_display(ws_root, &p),
                    abs_path: p,
                });
            }
        }
        if !seq.is_empty() {
            return seq;
        }
    }

    // Fallback 3: single reference image in `ref/`
    if let Ok(entries) = std::fs::read_dir(&ref_dir) {
        let mut imgs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp"))
            })
            .collect();
        imgs.sort();
        if let Some(first) = imgs.into_iter().next() {
            out.push(ReferenceKeyframe {
                timestamp: safe_dur * 0.5,
                rel_path: rel_display(ws_root, &first),
                abs_path: first,
            });
        }
    }

    out
}

/// Returns recommended preview capture timestamps aligned to discovered reference keyframes.
pub fn recommended_reference_timestamps(ws_root: &Path, film_duration: f64, max_frames: usize) -> Vec<f64> {
    let kfs = discover_reference_keyframes(ws_root, film_duration);
    if kfs.is_empty() {
        return Vec::new();
    }
    let mut ts: Vec<f64> = kfs.into_iter().map(|k| k.timestamp).collect();
    if ts.len() > max_frames && max_frames > 0 {
        let step = (ts.len() - 1) as f64 / (max_frames - 1).max(1) as f64;
        let mut sampled = Vec::with_capacity(max_frames);
        for i in 0..max_frames {
            let idx = ((i as f64) * step).round() as usize;
            sampled.push(ts[idx.min(ts.len() - 1)]);
        }
        ts = sampled;
    }
    ts
}

/// Pairs each captured preview frame with its nearest timestamp reference keyframe.
pub fn pair_preview_with_reference(
    film_root: &Path,
    preview_frames: &[PreviewFrameCapture],
    ref_frames: &[ReferenceKeyframe],
) -> Vec<FrameComparePair> {
    if ref_frames.is_empty() {
        return Vec::new();
    }
    let mut pairs = Vec::with_capacity(preview_frames.len());
    for (idx, pf) in preview_frames.iter().enumerate() {
        let best_ref = if ref_frames.len() == preview_frames.len() {
            &ref_frames[idx]
        } else {
            ref_frames
                .iter()
                .min_by(|a, b| {
                    let da = (a.timestamp - pf.timestamp).abs();
                    let db = (b.timestamp - pf.timestamp).abs();
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(&ref_frames[0])
        };
        pairs.push(FrameComparePair {
            timestamp: pf.timestamp,
            ref_abs: best_ref.abs_path.clone(),
            ref_rel: best_ref.rel_path.clone(),
            preview_abs: film_root.join(&pf.saved_rel_path),
            preview_rel: pf.saved_rel_path.clone(),
        });
    }
    pairs
}

/// Runs quantitative RGB SSIM + color/edge comparison and builds a side-by-side strip JPEG.
pub async fn compare_preview_to_reference(
    ws_root: &Path,
    film_root: &Path,
    film_duration: f64,
    preview_frames: &[PreviewFrameCapture],
    pass_threshold: f64,
) -> Result<(Value, Option<String>), String> {
    let ref_kfs = discover_reference_keyframes(ws_root, film_duration);
    if ref_kfs.is_empty() {
        return Err("No extracted reference keyframes found under ref/ to compare against.".to_string());
    }

    let pairs = pair_preview_with_reference(film_root, preview_frames, &ref_kfs);
    if pairs.is_empty() {
        return Err("No preview frames available for reference comparison.".to_string());
    }

    let preview_dir = film_root.join(".aetheria").join("preview");
    let _ = tokio::fs::create_dir_all(&preview_dir).await;
    let payload_path = preview_dir.join("compare_payload.json");
    let strip_path = preview_dir.join("comparison_strip.jpg");

    let pairs_json: Vec<Value> = pairs
        .iter()
        .map(|p| {
            json!({
                "timestamp": p.timestamp,
                "refPath": p.ref_abs.to_string_lossy().to_string(),
                "refRelPath": p.ref_rel,
                "previewPath": p.preview_abs.to_string_lossy().to_string(),
                "previewRelPath": p.preview_rel,
            })
        })
        .collect();

    let payload = json!({
        "passThreshold": pass_threshold,
        "stripOutputPath": strip_path.to_string_lossy().to_string(),
        "pairs": pairs_json,
    });
    let payload_bytes = serde_json::to_vec_pretty(&payload)
        .map_err(|e| format!("Failed serializing comparison payload: {}", e))?;
    tokio::fs::write(&payload_path, &payload_bytes)
        .await
        .map_err(|e| format!("Failed writing comparison payload: {}", e))?;

    let script_path = crate::paths::project_root()
        .join("core")
        .join("ref_extractor")
        .join("ref_compare.py");
    if !script_path.is_file() {
        return Err(format!("Comparison helper not found at {}", script_path.display()));
    }

    let mut cmd = tokio::process::Command::new("python");
    crate::paths::configure_hidden_tokio_command(&mut cmd);
    cmd.arg(&script_path).arg(&payload_path);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed invoking ref_compare.py: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let idx = stdout
        .find('{')
        .ok_or_else(|| format!("ref_compare.py returned non-JSON output: {}", stdout.trim()))?;
    let mut parsed: Value = serde_json::from_str(&stdout[idx..])
        .map_err(|e| format!("Failed parsing ref_compare.py JSON: {}", e))?;

    if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
        let err_msg = parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Reference visual comparison failed");
        return Err(err_msg.to_string());
    }

    let strip_rel = ".aetheria/preview/comparison_strip.jpg";
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert(
            "comparisonStripRelPath".to_string(),
            Value::String(strip_rel.to_string()),
        );
    }

    let strip_data_url = match tokio::fs::read(&strip_path).await {
        Ok(bytes) if !bytes.is_empty() => Some(format!("data:image/jpeg;base64,{}", B64.encode(&bytes))),
        _ => None,
    };

    Ok((parsed, strip_data_url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_duration_from_stderr() {
        let sample = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'ref.mp4':\n  Duration: 00:01:23.45, start: 0.000000, bitrate: 1200 kb/s";
        assert_eq!(parse_ffmpeg_duration_stderr(sample), Some(83.45));
        assert_eq!(parse_ffmpeg_duration_stderr("Duration: N/A, bitrate: N/A"), None);
    }

    #[test]
    fn discovers_keyframes_from_style_json_and_pairs_by_timestamp() {
        let ws = std::env::temp_dir().join(format!("aetheria_ref_cmp_test_{}", std::process::id()));
        let extracted = ws.join("ref").join("extracted");
        let frames = extracted.join("frames");
        let _ = std::fs::remove_dir_all(&ws);
        std::fs::create_dir_all(&frames).unwrap();
        std::fs::write(frames.join("ref_scene_01.jpg"), b"jpg1").unwrap();
        std::fs::write(frames.join("ref_scene_02.jpg"), b"jpg2").unwrap();
        std::fs::write(
            extracted.join("style.json"),
            serde_json::to_string(&json!({
                "scenes": [
                    { "start": 0.0, "duration": 2.0, "keyframeTimestamp": 1.0, "keyframe": "frames/ref_scene_01.jpg" },
                    { "start": 2.0, "duration": 4.0, "keyframeTimestamp": 4.0, "keyframe": "frames/ref_scene_02.jpg" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        let kfs = discover_reference_keyframes(&ws, 6.0);
        assert_eq!(kfs.len(), 2);
        assert_eq!(kfs[0].timestamp, 1.0);
        assert_eq!(kfs[1].timestamp, 4.0);

        let previews = vec![PreviewFrameCapture {
            timestamp: 3.9,
            relative_ratio: 0.65,
            saved_rel_path: ".aetheria/preview/preview_0.jpg".to_string(),
            data_url: "data:image/jpeg;base64,AA==".to_string(),
        }];
        let pairs = pair_preview_with_reference(&ws, &previews, &kfs);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].ref_rel, "ref/extracted/frames/ref_scene_02.jpg");

        let _ = std::fs::remove_dir_all(&ws);
    }
}

