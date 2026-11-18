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
    pub scene_id: Option<String>,
    pub phase: Option<String>,
}

#[derive(Clone, Debug)]
pub struct FrameComparePair {
    pub timestamp: f64,
    pub ref_abs: PathBuf,
    pub ref_rel: String,
    pub preview_abs: PathBuf,
    pub preview_rel: String,
    pub scene_id: Option<String>,
    pub phase: Option<String>,
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

fn resolve_extracted_frame_path(
    ws_root: &Path,
    extracted_dir: &Path,
    raw_rel: &str,
) -> Option<PathBuf> {
    let direct = extracted_dir.join(raw_rel);
    if direct.is_file() {
        return Some(direct);
    }
    let from_ws = ws_root.join(raw_rel);
    if from_ws.is_file() {
        return Some(from_ws);
    }
    let fname = Path::new(raw_rel.trim()).file_name()?;
    let in_frames = extracted_dir.join("frames").join(fname);
    if in_frames.is_file() {
        return Some(in_frames);
    }
    None
}

fn push_unique_ref_kf(
    out: &mut Vec<ReferenceKeyframe>,
    seen_paths: &mut std::collections::HashSet<PathBuf>,
    ws_root: &Path,
    abs: PathBuf,
    ts: f64,
    scene_id: Option<String>,
    phase: &str,
) {
    if !seen_paths.insert(abs.clone()) {
        return;
    }
    out.push(ReferenceKeyframe {
        timestamp: (ts * 100.0).round() / 100.0,
        rel_path: rel_display(ws_root, &abs),
        abs_path: abs,
        scene_id,
        phase: Some(phase.to_string()),
    });
}

/// Discovers extracted reference keyframes inside `<ws_root>/ref/` ordered by timestamp.
/// Collects per-scene `start`, `mid`, and `end` keyframes when available (`P1-1`).
pub fn discover_reference_keyframes(ws_root: &Path, film_duration: f64) -> Vec<ReferenceKeyframe> {
    let ref_dir = ws_root.join("ref");
    if !ref_dir.is_dir() {
        return Vec::new();
    }

    let extracted_dir = ref_dir.join("extracted");
    let style_path = extracted_dir.join("style.json");
    let mut out = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    if let Ok(raw) = std::fs::read_to_string(&style_path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
            if let Some(scenes) = parsed.get("scenes").and_then(Value::as_array) {
                for sc in scenes {
                    let scene_id = sc
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let start = sc.get("start").and_then(Value::as_f64).unwrap_or(0.0);
                    let dur = sc
                        .get("duration")
                        .and_then(Value::as_f64)
                        .filter(|&d| d > 0.0)
                        .unwrap_or(1.0);
                    let end = sc
                        .get("end")
                        .and_then(Value::as_f64)
                        .unwrap_or(start + dur);

                    if let Some(kfs_arr) = sc.get("keyframes").and_then(Value::as_array) {
                        for item in kfs_arr {
                            let Some(path_str) = item.get("path").and_then(Value::as_str) else {
                                continue;
                            };
                            let Some(abs) =
                                resolve_extracted_frame_path(ws_root, &extracted_dir, path_str)
                            else {
                                continue;
                            };
                            let lower_p = path_str.to_ascii_lowercase();
                            let phase = if lower_p.contains("_start.") {
                                "start"
                            } else if lower_p.contains("_end.") {
                                "end"
                            } else {
                                "mid"
                            };
                            let fallback_ts = match phase {
                                "start" => start + (dur * 0.15).min(0.15),
                                "end" => (end - (dur * 0.15).min(0.15)).max(start + dur * 0.5),
                                _ => start + dur * 0.5,
                            };
                            let ts = item.get("t").and_then(Value::as_f64).unwrap_or(fallback_ts);
                            push_unique_ref_kf(
                                &mut out,
                                &mut seen_paths,
                                ws_root,
                                abs,
                                ts,
                                scene_id.clone(),
                                phase,
                            );
                        }
                    }

                    if let Some(start_rel) = sc.pointer("/keyframes/start").and_then(Value::as_str) {
                        if let Some(abs) = resolve_extracted_frame_path(ws_root, &extracted_dir, start_rel) {
                            let ts = start + (dur * 0.15).min(0.15);
                            push_unique_ref_kf(&mut out, &mut seen_paths, ws_root, abs, ts, scene_id.clone(), "start");
                        }
                    }

                    let mid_rel = sc
                        .get("keyframe")
                        .and_then(Value::as_str)
                        .or_else(|| sc.pointer("/keyframes/mid").and_then(Value::as_str));
                    if let Some(rel) = mid_rel {
                        if let Some(abs) = resolve_extracted_frame_path(ws_root, &extracted_dir, rel) {
                            let ts = sc
                                .get("keyframeTimestamp")
                                .and_then(Value::as_f64)
                                .unwrap_or(start + dur * 0.5);
                            push_unique_ref_kf(&mut out, &mut seen_paths, ws_root, abs, ts, scene_id.clone(), "mid");
                        }
                    }

                    if let Some(end_rel) = sc.pointer("/keyframes/end").and_then(Value::as_str) {
                        if let Some(abs) = resolve_extracted_frame_path(ws_root, &extracted_dir, end_rel) {
                            let ts = (end - (dur * 0.15).min(0.15)).max(start + dur * 0.5);
                            push_unique_ref_kf(&mut out, &mut seen_paths, ws_root, abs, ts, scene_id.clone(), "end");
                        }
                    }
                }
            }
        }
    }
    if !out.is_empty() {
        out.sort_by(|a, b| {
            a.timestamp
                .partial_cmp(&b.timestamp)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
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
        let total_thumbs = thumbs.len().max(1);
        for (idx, p) in thumbs.into_iter().take(12).enumerate() {
            let ts = if total_thumbs <= ratios.len() {
                safe_dur * ratios.get(idx).copied().unwrap_or(0.5)
            } else {
                safe_dur * ((idx as f64 + 0.5) / total_thumbs as f64)
            };
            out.push(ReferenceKeyframe {
                timestamp: (ts * 100.0).round() / 100.0,
                rel_path: rel_display(ws_root, &p),
                abs_path: p,
                scene_id: None,
                phase: Some("thumb".to_string()),
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
                    scene_id: None,
                    phase: Some("frame".to_string()),
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
                scene_id: None,
                phase: Some("image".to_string()),
            });
        }
    }

    out
}

/// Discovers reference keyframes and remaps scene timestamps to the actual intervals in
/// `<film_root>/film.json` when available, so narrated films with adapted durations align
/// scene-by-scene instead of mis-pairing across scene cuts.
pub fn discover_reference_keyframes_for_film(
    ws_root: &Path,
    film_root: &Path,
    film_duration: f64,
) -> Vec<ReferenceKeyframe> {
    let mut kfs = discover_reference_keyframes(ws_root, film_duration);
    if kfs.is_empty() {
        return kfs;
    }

    let film_json_path = film_root.join("film.json");
    let Ok(raw) = std::fs::read_to_string(&film_json_path) else {
        return kfs;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return kfs;
    };
    let Some(film_scenes_arr) = parsed.get("scenes").and_then(Value::as_array) else {
        return kfs;
    };

    let mut film_scenes: Vec<(String, f64, f64)> = Vec::with_capacity(film_scenes_arr.len());
    let mut cursor = 0.0f64;
    for (idx, sc) in film_scenes_arr.iter().enumerate() {
        let id = sc
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("scene{}", idx + 1));
        let start = sc.get("start").and_then(Value::as_f64).unwrap_or(cursor);
        let dur = sc
            .get("duration")
            .and_then(Value::as_f64)
            .filter(|&d| d.is_finite() && d > 0.05)
            .unwrap_or(2.0);
        film_scenes.push((id, start, dur));
        cursor = start + dur;
    }
    if film_scenes.is_empty() {
        return kfs;
    }

    let mut seen_ref_scene_ids: Vec<String> = Vec::new();
    for kf in &kfs {
        if let Some(ref sid) = kf.scene_id {
            if !seen_ref_scene_ids.iter().any(|x| x == sid) {
                seen_ref_scene_ids.push(sid.clone());
            }
        }
    }
    if seen_ref_scene_ids.is_empty() {
        return kfs;
    }

    for kf in &mut kfs {
        let Some(ref sid) = kf.scene_id else {
            continue;
        };
        let matched_film_scene = film_scenes
            .iter()
            .find(|(fid, _, _)| fid == sid)
            .or_else(|| {
                let ref_idx = seen_ref_scene_ids.iter().position(|x| x == sid)?;
                // Map evenly if film has fewer or equal scenes
                let mapped_idx = if film_scenes.len() >= seen_ref_scene_ids.len() {
                    ref_idx
                } else {
                    (ref_idx * film_scenes.len()) / seen_ref_scene_ids.len().max(1)
                };
                film_scenes.get(mapped_idx)
            });
        if let Some((_, f_start, f_dur)) = matched_film_scene {
            let f_end = f_start + f_dur;
            let mapped_ts = match kf.phase.as_deref() {
                Some("start") => f_start + (f_dur * 0.15).min(0.15),
                Some("end") => (f_end - (f_dur * 0.15).min(0.15)).max(f_start + f_dur * 0.5),
                _ => f_start + f_dur * 0.5,
            };
            kf.timestamp = (mapped_ts * 100.0).round() / 100.0;
        }
    }

    kfs.sort_by(|a, b| {
        a.timestamp
            .partial_cmp(&b.timestamp)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    kfs
}

fn sample_kf_indices(len: usize, max_count: usize) -> Vec<usize> {
    if len == 0 || max_count == 0 {
        return Vec::new();
    }
    if len <= max_count {
        return (0..len).collect();
    }
    if max_count == 1 {
        return vec![0];
    }
    let mut out = Vec::with_capacity(max_count);
    for i in 0..max_count {
        let idx = (i * (len - 1)) / (max_count - 1);
        if out.last().copied() != Some(idx) {
            out.push(idx);
        }
    }
    out
}

/// Returns recommended preview capture timestamps aligned to discovered reference keyframes.
/// Prioritizes scene midpoints across all scenes before adding `start`/`end` transitions up to `max_frames`.
pub fn recommended_reference_timestamps(ws_root: &Path, film_duration: f64, max_frames: usize) -> Vec<f64> {
    let kfs = discover_reference_keyframes(ws_root, film_duration);
    select_timestamps_from_keyframes(&kfs, max_frames)
}

/// Returns recommended preview timestamps aligned to `film.json` scene windows when present.
pub fn recommended_reference_timestamps_for_film(
    ws_root: &Path,
    film_root: &Path,
    film_duration: f64,
    max_frames: usize,
) -> Vec<f64> {
    let kfs = discover_reference_keyframes_for_film(ws_root, film_root, film_duration);
    select_timestamps_from_keyframes(&kfs, max_frames)
}

fn select_timestamps_from_keyframes(kfs: &[ReferenceKeyframe], max_frames: usize) -> Vec<f64> {
    if kfs.is_empty() || max_frames == 0 {
        return Vec::new();
    }
    if kfs.len() <= max_frames {
        return kfs.iter().map(|k| k.timestamp).collect();
    }

    let mids: Vec<f64> = kfs
        .iter()
        .filter(|k| k.phase.as_deref() == Some("mid"))
        .map(|k| k.timestamp)
        .collect();
    let others: Vec<f64> = kfs
        .iter()
        .filter(|k| k.phase.as_deref() != Some("mid"))
        .map(|k| k.timestamp)
        .collect();

    let mut chosen = Vec::with_capacity(max_frames);
    if mids.is_empty() {
        for idx in sample_kf_indices(others.len(), max_frames) {
            chosen.push(others[idx]);
        }
    } else {
        for idx in sample_kf_indices(mids.len(), max_frames) {
            chosen.push(mids[idx]);
        }
        let rem = max_frames.saturating_sub(chosen.len());
        if rem > 0 {
            for idx in sample_kf_indices(others.len(), rem) {
                chosen.push(others[idx]);
            }
        }
    }
    chosen.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    chosen
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
        let best_ref = if ref_frames.len() == preview_frames.len()
            && (ref_frames[idx].timestamp - pf.timestamp).abs() < 0.25
        {
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
            scene_id: best_ref.scene_id.clone(),
            phase: best_ref.phase.clone(),
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
    let ref_kfs = discover_reference_keyframes_for_film(ws_root, film_root, film_duration);
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
                "sceneId": p.scene_id,
                "phase": p.phase,
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

    let py_bin = crate::paths::locate_python_binary();
    let mut cmd = tokio::process::Command::new(&py_bin);
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

    #[test]
    fn discovers_multi_phase_start_mid_end_keyframes_and_samples_across_scenes() {
        let ws = std::env::temp_dir().join(format!("aetheria_ref_multi_{}", crate::paths::now_ms()));
        let frames = ws.join("ref").join("extracted").join("frames");
        std::fs::create_dir_all(&frames).unwrap();
        let mut scenes = Vec::new();
        for idx in 1..=3 {
            let st = format!("ref_scene_{idx:02}_start.jpg");
            let mid = format!("ref_scene_{idx:02}.jpg");
            let en = format!("ref_scene_{idx:02}_end.jpg");
            std::fs::write(frames.join(&st), b"st").unwrap();
            std::fs::write(frames.join(&mid), b"mid").unwrap();
            std::fs::write(frames.join(&en), b"en").unwrap();
            let s0 = (idx - 1) as f64 * 2.0;
            scenes.push(json!({
                "id": format!("s{idx}"),
                "start": s0,
                "duration": 2.0,
                "end": s0 + 2.0,
                "keyframe": format!("frames/{mid}"),
                "keyframes": [
                    { "t": s0 + 0.15, "path": format!("frames/{st}") },
                    { "t": s0 + 1.0, "path": format!("frames/{mid}") },
                    { "t": s0 + 1.85, "path": format!("frames/{en}") },
                ]
            }));
        }
        std::fs::write(
            ws.join("ref").join("extracted").join("style.json"),
            serde_json::to_string(&json!({ "scenes": scenes })).unwrap(),
        )
        .unwrap();

        let kfs = discover_reference_keyframes(&ws, 6.0);
        assert_eq!(kfs.len(), 9, "expected start/mid/end for 3 scenes");
        assert_eq!(kfs[0].phase.as_deref(), Some("start"));
        assert_eq!(kfs[1].phase.as_deref(), Some("mid"));
        assert_eq!(kfs[2].phase.as_deref(), Some("end"));
        assert_eq!(kfs[4].scene_id.as_deref(), Some("s2"));

        let ts = recommended_reference_timestamps(&ws, 6.0, 12);
        assert_eq!(ts.len(), 9);

        let film_dir = ws.join("projects").join("adapted");
        std::fs::create_dir_all(&film_dir).unwrap();
        std::fs::write(
            film_dir.join("film.json"),
            serde_json::to_string(&json!({
                "scenes": [
                    { "id": "s1", "start": 0.0, "duration": 2.8 },
                    { "id": "s2", "start": 2.8, "duration": 3.0 },
                    { "id": "s3", "start": 5.8, "duration": 8.0 }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        let remapped = discover_reference_keyframes_for_film(&ws, &film_dir, 13.8);
        let s2_mid = remapped
            .iter()
            .find(|k| k.scene_id.as_deref() == Some("s2") && k.phase.as_deref() == Some("mid"))
            .expect("remapped s2 mid");
        assert!(
            (s2_mid.timestamp - 4.3).abs() < 0.05,
            "expected s2 mid mapped to adapted film window (2.8 + 1.5 = 4.3s), got {}",
            s2_mid.timestamp
        );

        let _ = std::fs::remove_dir_all(&ws);
    }
}

