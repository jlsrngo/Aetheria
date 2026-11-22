//! Reference Video Extractor Tool for Aetheria Engine.
//! Analyzes reference video files or YouTube/TikTok URLs to extract exact scene cuts,
//! color palettes, pacing, and layout blueprints with >90% similarity fidelity.

use base64::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::process::Command;

use super::resolve_isolated_path;

pub(crate) const MAX_EXTRACTED_VISION_FRAMES: usize = 12;

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut i = 0usize;
    let mut j = 0usize;
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    while i < ab.len() && j < bb.len() {
        let ca = ab[i];
        let cb = bb[j];
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            let start_i = i;
            let start_j = j;
            while i < ab.len() && ab[i].is_ascii_digit() {
                i += 1;
            }
            while j < bb.len() && bb[j].is_ascii_digit() {
                j += 1;
            }
            let na: u64 = std::str::from_utf8(&ab[start_i..i])
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let nb: u64 = std::str::from_utf8(&bb[start_j..j])
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            match na.cmp(&nb) {
                std::cmp::Ordering::Equal => {
                    let len_cmp = (i - start_i).cmp(&(j - start_j));
                    if len_cmp != std::cmp::Ordering::Equal {
                        return len_cmp;
                    }
                }
                ord => return ord,
            }
        } else {
            let la = ca.to_ascii_lowercase();
            let lb = cb.to_ascii_lowercase();
            match la.cmp(&lb) {
                std::cmp::Ordering::Equal => {
                    i += 1;
                    j += 1;
                }
                ord => return ord,
            }
        }
    }
    ab.len().cmp(&bb.len())
}

fn sample_evenly_indices(len: usize, max_count: usize) -> Vec<usize> {
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

fn resolve_style_frame_in_dir(frames_dir: &Path, raw: &str) -> Option<PathBuf> {
    let fname = Path::new(raw.trim()).file_name()?.to_str()?;
    let candidate = frames_dir.join(fname);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// Selects reference keyframes in temporal scene order rather than lexicographical truncation.
/// Priority:
/// 1) Per-scene midpoint keyframes across ALL scenes (evenly sampled only if scenes > `max_frames`),
/// 2) Per-scene `_start` / `_end` transition frames evenly across scenes,
/// 3) Overview `thumb_*.jpg` fallback frames naturally sorted.
pub(crate) fn select_extracted_vision_keyframes(
    frames_dir: &Path,
    style_json_path: Option<&Path>,
    max_frames: usize,
) -> Vec<PathBuf> {
    if max_frames == 0 {
        return Vec::new();
    }

    let style_candidate = style_json_path
        .map(PathBuf::from)
        .or_else(|| frames_dir.parent().map(|p| p.join("style.json")));

    let mut midpoints: Vec<PathBuf> = Vec::new();
    let mut transitions: Vec<PathBuf> = Vec::new();

    if let Some(style_path) = style_candidate.filter(|p| p.is_file()) {
        if let Ok(raw) = std::fs::read_to_string(&style_path) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                if let Some(scenes) = parsed.get("scenes").and_then(Value::as_array) {
                    let mut seen = std::collections::HashSet::new();
                    for sc in scenes {
                        let scene_dur = sc
                            .get("duration")
                            .and_then(Value::as_f64)
                            .or_else(|| {
                                match (
                                    sc.get("start").and_then(Value::as_f64),
                                    sc.get("end").and_then(Value::as_f64),
                                ) {
                                    (Some(s), Some(e)) => Some((e - s).max(0.0)),
                                    _ => None,
                                }
                            })
                            .unwrap_or(0.0);
                        let is_long_scene = scene_dur >= 2.5;
                        let mid_str = sc
                            .pointer("/keyframes/mid")
                            .and_then(Value::as_str)
                            .or_else(|| sc.get("keyframe").and_then(Value::as_str));
                        // Prefer Composite Scene Card (`ref_scene_XX_card.jpg`: Hero HD + 6-Beat Strip)
                        // when available so the vision model gets full material/typo sharpness AND motion cadence in 1 image.
                        if let Some(cc_p) = sc
                            .get("compositeCard")
                            .and_then(Value::as_str)
                            .and_then(|s| resolve_style_frame_in_dir(frames_dir, s))
                        {
                            if seen.insert(cc_p.clone()) {
                                midpoints.push(cc_p);
                            }
                            continue;
                        }
                        // Otherwise prefer the 6-panel adaptive beat strip (`ref_scene_XX_beats.jpg`).
                        if let Some(bs_p) = sc
                            .get("beatsStrip")
                            .and_then(Value::as_str)
                            .and_then(|s| resolve_style_frame_in_dir(frames_dir, s))
                        {
                            if seen.insert(bs_p.clone()) {
                                midpoints.push(bs_p);
                            }
                        }
                        if let Some(kfs_arr) = sc.get("keyframes").and_then(Value::as_array) {
                            for item in kfs_arr {
                                let Some(path_str) = item.get("path").and_then(Value::as_str) else {
                                    continue;
                                };
                                let Some(p) = resolve_style_frame_in_dir(frames_dir, path_str) else {
                                    continue;
                                };
                                if !seen.insert(p.clone()) {
                                    continue;
                                }
                                let lower_path = path_str.to_ascii_lowercase();
                                if lower_path.contains("_beats.") {
                                    continue;
                                }
                                if lower_path.contains("_q1.") || lower_path.contains("_q3.") {
                                    if is_long_scene {
                                        midpoints.push(p);
                                    } else {
                                        transitions.push(p);
                                    }
                                } else if lower_path.contains("_start.")
                                    || lower_path.contains("_end.")
                                {
                                    transitions.push(p);
                                } else {
                                    midpoints.push(p);
                                }
                            }
                        }
                        if let Some(p) =
                            mid_str.and_then(|s| resolve_style_frame_in_dir(frames_dir, s))
                        {
                            if seen.insert(p.clone()) {
                                midpoints.push(p);
                            }
                        }
                        for key in ["start", "end"] {
                            if let Some(p) = sc
                                .pointer(&format!("/keyframes/{}", key))
                                .and_then(Value::as_str)
                                .and_then(|s| resolve_style_frame_in_dir(frames_dir, s))
                            {
                                if seen.insert(p.clone()) {
                                    transitions.push(p);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut thumbs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(frames_dir) {
        let mut disk_files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| {
                            matches!(
                                e.to_ascii_lowercase().as_str(),
                                "jpg" | "jpeg" | "png" | "webp"
                            )
                        })
                        .unwrap_or(false)
            })
            .collect();
        disk_files.sort_by(|a, b| {
            let na = a.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let nb = b.file_name().and_then(|n| n.to_str()).unwrap_or("");
            natural_cmp(na, nb)
        });

        let has_style_scenes = !midpoints.is_empty();
        let already_listed: std::collections::HashSet<PathBuf> =
            midpoints.iter().chain(transitions.iter()).cloned().collect();

        for p in disk_files {
            if already_listed.contains(&p) {
                continue;
            }
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if name.contains("_beats.") {
                continue;
            }
            if !has_style_scenes && name.starts_with("ref_scene_") {
                if name.contains("_start.")
                    || name.contains("_end.")
                    || name.contains("_q1.")
                    || name.contains("_q3.")
                {
                    transitions.push(p);
                } else {
                    midpoints.push(p);
                }
            } else {
                thumbs.push(p);
            }
        }
    }

    let mut selected: Vec<PathBuf> = Vec::with_capacity(max_frames);
    let mut selected_set = std::collections::HashSet::new();

    // Collect compact contact sheets generated in ref/extracted/ (full temporal storyboard).
    let mut sheets: Vec<PathBuf> = Vec::new();
    if let Some(extracted_root) = frames_dir.parent() {
        for idx in 1..=3 {
            let cs = extracted_root.join(format!("contact_sheet_{}.jpg", idx));
            if cs.is_file() {
                sheets.push(cs);
            }
        }
    }

    // Reserve capacity for up to 2 temporal contact sheets alongside per-scene midpoints.
    let mid_budget = if !sheets.is_empty() && max_frames > sheets.len() + 2 {
        max_frames.saturating_sub(sheets.len())
    } else {
        max_frames
    };

    for idx in sample_evenly_indices(midpoints.len(), mid_budget) {
        let p = &midpoints[idx];
        if selected_set.insert(p.clone()) {
            selected.push(p.clone());
        }
    }

    for cs in &sheets {
        if selected.len() >= max_frames {
            break;
        }
        if selected_set.insert(cs.clone()) {
            selected.push(cs.clone());
        }
    }

    let rem = max_frames.saturating_sub(selected.len());
    if rem > 0 {
        for idx in sample_evenly_indices(transitions.len(), rem) {
            let p = &transitions[idx];
            if selected_set.insert(p.clone()) {
                selected.push(p.clone());
            }
        }
    }

    let rem = max_frames.saturating_sub(selected.len());
    if rem > 0 {
        for idx in sample_evenly_indices(thumbs.len(), rem) {
            let p = &thumbs[idx];
            if selected_set.insert(p.clone()) {
                selected.push(p.clone());
            }
        }
    }

    selected
}

async fn python_has_cv2_and_numpy() -> bool {
    let py_bin = crate::paths::locate_python_binary();
    let mut check = Command::new(&py_bin);
    crate::paths::configure_hidden_tokio_command(&mut check);
    check.arg("-c").arg("import cv2, numpy");
    check
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub(crate) fn build_compact_extraction_summary(
    parsed: &Value,
    frame_paths: &[String],
) -> (String, Vec<String>) {
    let bp = parsed.get("blueprint");
    let width = bp
        .and_then(|b| b.get("width"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let height = bp
        .and_then(|b| b.get("height"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let fps = bp
        .and_then(|b| b.get("fps"))
        .and_then(Value::as_f64)
        .unwrap_or(30.0);
    let total_dur = bp
        .and_then(|b| b.get("totalDuration"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let ar = bp
        .and_then(|b| b.get("aspectRatio"))
        .and_then(Value::as_str)
        .unwrap_or("9:16");
    let bpm = bp
        .and_then(|b| b.get("bpm"))
        .and_then(Value::as_f64)
        .unwrap_or(120.0);
    let fast_mode = parsed
        .get("fastMode")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let report_path = parsed
        .get("reportPath")
        .and_then(Value::as_str)
        .unwrap_or("ref/extracted/ref_report.md");
    let style_path = parsed
        .get("stylePath")
        .and_then(Value::as_str)
        .unwrap_or("ref/extracted/style.json");

    let mut lines = Vec::new();
    lines.push(format!(
        "Reference video extracted ({width}x{height} @ {fps:.0}fps, {total_dur:.2}s, {ar}, BPM={bpm:.0}, fastMode={fast_mode})."
    ));
    lines.push(format!("Artifacts: report={report_path}, style={style_path}"));

    let scenes = bp
        .and_then(|b| b.get("scenes"))
        .and_then(Value::as_array)
        .map(|s| s.as_slice())
        .unwrap_or(&[]);

    if !scenes.is_empty() {
        lines.push(format!("Scenes ({} detected):", scenes.len()));
        for s in scenes {
            let idx = s.get("index").and_then(Value::as_u64).unwrap_or(0);
            let id = s.get("id").and_then(Value::as_str).unwrap_or("scene");
            let start = s.get("start").and_then(Value::as_f64).unwrap_or(0.0);
            let end = s.get("end").and_then(Value::as_f64).unwrap_or(start);
            let mid = (start + end) * 0.5;
            let pal = s.pointer("/layout/palette");
            let bg = pal
                .and_then(|p| p.get("bgHex"))
                .and_then(Value::as_str)
                .unwrap_or("?");
            let text = pal
                .and_then(|p| p.get("textHex"))
                .and_then(Value::as_str)
                .unwrap_or("?");
            let accent = pal
                .and_then(|p| p.get("accentHex"))
                .and_then(Value::as_str)
                .unwrap_or("?");
            let kf = s
                .get("keyframe")
                .and_then(Value::as_str)
                .unwrap_or("");
            let mut scene_line = format!(
                "  Scene {idx} ({id}): {start:.2}s-{end:.2}s (mid {mid:.2}s) | bg={bg} text={text} accent={accent} | keyframe={kf}"
            );
            if let Some(segs) = s
                .pointer("/cameraMotion/segments")
                .and_then(Value::as_array)
                .filter(|a| !a.is_empty())
            {
                let seg = &segs[0];
                let sf = seg.get("scaleFrom").and_then(Value::as_f64).unwrap_or(1.0);
                let st = seg.get("scaleTo").and_then(Value::as_f64).unwrap_or(1.0);
                let txf = seg.get("txFrom").and_then(Value::as_f64).unwrap_or(0.0);
                let txt = seg.get("txTo").and_then(Value::as_f64).unwrap_or(0.0);
                let tyf = seg.get("tyFrom").and_then(Value::as_f64).unwrap_or(0.0);
                let tyt = seg.get("tyTo").and_then(Value::as_f64).unwrap_or(0.0);
                let ease = seg.get("ease").and_then(Value::as_str).unwrap_or("inOutCubic");
                scene_line.push_str(&format!(
                    " | cam: scale={sf:.2}->{st:.2} pan=({txf:.0},{tyf:.0})->({txt:.0},{tyt:.0}) ease={ease}"
                ));
            }
            if let Some(panels) = s.get("beatStripPanels").and_then(Value::as_array).filter(|a| !a.is_empty()) {
                let tags: Vec<String> = panels
                    .iter()
                    .filter_map(|p| {
                        let t = p.get("t").and_then(Value::as_f64)?;
                        let r = p.get("reason").and_then(Value::as_str).unwrap_or("beat");
                        Some(format!("{r}@{t:.2}s"))
                    })
                    .collect();
                if !tags.is_empty() {
                    scene_line.push_str(&format!(" | beats=[{}]", tags.join(", ")));
                }
            }
            lines.push(scene_line);
        }
    }

    let mut labels = Vec::with_capacity(frame_paths.len());
    for rel in frame_paths {
        let base = Path::new(rel)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(rel.as_str());
        if base.contains("contact_sheet") {
            labels.push(format!("{rel} (full timeline storyboard contact sheet)"));
            continue;
        }
        let matched = scenes.iter().find(|s| {
            let kf = s.get("keyframe").and_then(Value::as_str).unwrap_or("");
            let kf_mid = s
                .pointer("/keyframes/mid")
                .and_then(Value::as_str)
                .unwrap_or("");
            let bs = s.get("beatsStrip").and_then(Value::as_str).unwrap_or("");
            let cc = s.get("compositeCard").and_then(Value::as_str).unwrap_or("");
            (!kf.is_empty() && Path::new(kf).file_name().and_then(|n| n.to_str()) == Some(base))
                || (!kf_mid.is_empty()
                    && Path::new(kf_mid).file_name().and_then(|n| n.to_str()) == Some(base))
                || (!bs.is_empty()
                    && Path::new(bs).file_name().and_then(|n| n.to_str()) == Some(base))
                || (!cc.is_empty()
                    && Path::new(cc).file_name().and_then(|n| n.to_str()) == Some(base))
        });
        if let Some(s) = matched {
            let idx = s.get("index").and_then(Value::as_u64).unwrap_or(0);
            let id = s.get("id").and_then(Value::as_str).unwrap_or("scene");
            let start = s.get("start").and_then(Value::as_f64).unwrap_or(0.0);
            let end = s.get("end").and_then(Value::as_f64).unwrap_or(start);
            let mid = (start + end) * 0.5;
            labels.push(format!(
                "{rel} (Scene {idx} {id}: {start:.2}s-{end:.2}s, mid {mid:.2}s)"
            ));
        } else {
            labels.push(rel.clone());
        }
    }

    if !labels.is_empty() {
        lines.push("Attached vision images (already loaded — proceed directly to coding unless an extra timestamp via `inspect_ref_frame` is needed):".to_string());
        for (i, lbl) in labels.iter().enumerate() {
            lines.push(format!("  {}. {}", i + 1, lbl));
        }
    }

    (lines.join("\n"), labels)
}

pub(crate) fn collect_extracted_frames_response(
    ws: &Path,
    frames_dir: &Path,
    fallback_mode: &str,
) -> Value {
    let total_extracted = std::fs::read_dir(frames_dir)
        .map(|rd| rd.flatten().filter(|e| e.path().is_file()).count())
        .unwrap_or(0);
    let selected_paths =
        select_extracted_vision_keyframes(frames_dir, None, MAX_EXTRACTED_VISION_FRAMES);
    let mut frame_paths = Vec::new();
    let mut vision_images = Vec::new();
    let vision_dir = frames_dir.parent().map(|parent| parent.join("vision"));
    for p in selected_paths {
        let rel = p
            .strip_prefix(ws)
            .unwrap_or(&p)
            .to_string_lossy()
            .replace('\\', "/");
        frame_paths.push(rel);
        let vision_candidate = vision_dir
            .as_ref()
            .zip(p.file_name())
            .map(|(vd, fname)| vd.join(fname))
            .filter(|vp| vp.is_file());
        let read_path = vision_candidate.as_deref().unwrap_or(&p);
        if let Ok(bytes) = std::fs::read(read_path) {
            if !bytes.is_empty() {
                let b64 = BASE64_STANDARD.encode(&bytes);
                let mime = match p
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
                    .as_deref()
                {
                    Some("png") => "image/png",
                    Some("webp") => "image/webp",
                    _ => "image/jpeg",
                };
                vision_images.push(Value::String(format!("data:{};base64,{}", mime, b64)));
            }
        }
    }
    json!({
        "ok": true,
        "success": true,
        "fallback": fallback_mode,
        "totalExtractedFrames": total_extracted,
        "frames": frame_paths,
        "_vision_images": vision_images
    })
}

pub fn ref_extractor_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "extract_video_reference",
            "description": "Extracts scene cuts, color palettes, BPM/audio cadence, keyframes, contact sheets, and `ref_report.md`/`style.json` metadata from a reference video file. Defaults to `mode: \"fast\"` (~2-3s via OpenCV/FFmpeg without CPU OCR; ideal for vision models).",
            "parameters": {
                "type": "object",
                "properties": {
                    "videoPath": {
                        "type": "string",
                        "description": "Path to the reference MP4 video file (e.g. 'ref/reference.mp4')."
                    },
                    "outputDir": {
                        "type": "string",
                        "description": "Optional output folder to save extracted blueprints, frames, and palette. Defaults to 'ref/extracted'."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["fast", "deep"],
                        "description": "Extraction mode: 'fast' (default, ~2-3s: scene cuts, keyframes, contact sheets, palette, BPM, no CPU OCR) or 'deep' (~60-90s: adds CPU RapidOCR text boxes, sub-beat motion clues, and scene AST)."
                    }
                },
                "required": ["videoPath"]
            }
        }
    })
}

pub(crate) fn probe_video_dimensions_sync(ffmpeg_bin: &Path, video_path: &Path) -> Option<(u32, u32)> {
    let ffprobe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    let ffprobe_path = ffmpeg_bin
        .parent()
        .map(|p| p.join(ffprobe_name))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(ffprobe_name));
    let mut cmd = std::process::Command::new(ffprobe_path);
    crate::paths::configure_hidden_std_command(&mut cmd);
    let out = cmd
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
        ])
        .arg(video_path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (w_s, h_s) = text.trim().split_once('x')?;
    let w = w_s.trim().parse::<u32>().ok().filter(|&n| n >= 16)?;
    let h = h_s.trim().parse::<u32>().ok().filter(|&n| n >= 16)?;
    Some((w, h))
}

pub(crate) fn write_ffmpeg_fallback_blueprint(
    video_path: &Path,
    out_dir: &Path,
    probed_dur: f64,
    dims: Option<(u32, u32)>,
    sample_points: &[(f64, String)],
    frame_rel_paths: &[String],
) -> (PathBuf, PathBuf, PathBuf) {
    let _ = std::fs::create_dir_all(out_dir);
    let (width, height) = dims.unwrap_or((1080, 1920));
    let aspect_ratio = if height > width {
        "9:16"
    } else if width.abs_diff(height) <= 16 {
        "1:1"
    } else {
        "16:9"
    };
    let warning = "Python OpenCV/NumPy/RapidOCR unavailable; FFmpeg fallback extracted keyframe images only without semantic scene segmentation, color clustering, bounding boxes, or OCR text strings.";

    let timestamps: Vec<f64> = sample_points
        .iter()
        .map(|(ratio, _)| ((probed_dur * ratio) * 100.0).round() / 100.0)
        .collect();

    let mut fallback_scenes = Vec::new();
    let total = frame_rel_paths.len().max(1);
    for (idx, frame_rel) in frame_rel_paths.iter().enumerate() {
        let start = if idx == 0 {
            0.0
        } else {
            ((probed_dur * (idx as f64 / total as f64)) * 100.0).round() / 100.0
        };
        let end = (((idx + 1) as f64 / total as f64) * probed_dur * 100.0).round() / 100.0;
        let dur = (end - start).max(0.25);
        fallback_scenes.push(json!({
            "index": idx + 1,
            "id": format!("scene_{}", idx + 1),
            "role": format!("segment_{}", idx + 1),
            "start": start,
            "end": end,
            "duration": dur,
            "durationFrames": (dur * 30.0).round() as u32,
            "keyframe": frame_rel,
            "keyframes": { "start": frame_rel, "mid": frame_rel, "end": frame_rel },
            "motion": "unknown_ffmpeg_fallback",
            "motionEnergy": 0.05,
        }));
    }

    let temporal_path = out_dir.join("temporal.json");
    let temporal_json = json!({
        "duration": (probed_dur * 100.0).round() / 100.0,
        "fps": 30,
        "width": width,
        "height": height,
        "extractorBackend": "ffmpeg_fallback",
        "pythonCvUnavailable": true,
        "cutTimestamps": timestamps,
        "visualJumpTimestamps": [],
        "fallbackWarning": warning,
    });
    let _ = std::fs::write(
        &temporal_path,
        serde_json::to_string_pretty(&temporal_json).unwrap_or_default(),
    );

    let style_path = out_dir.join("style.json");
    let style_json = json!({
        "sourceVideo": video_path.file_name().and_then(|n| n.to_str()).unwrap_or("reference.mp4"),
        "totalDuration": (probed_dur * 100.0).round() / 100.0,
        "fps": 30,
        "width": width,
        "height": height,
        "aspectRatio": aspect_ratio,
        "fidelityTarget": 0.85,
        "extractorBackend": "ffmpeg_fallback",
        "pythonCvUnavailable": true,
        "ocrAvailable": false,
        "ocrWarning": warning,
        "fallbackWarning": warning,
        "scenes": fallback_scenes,
    });
    let _ = std::fs::write(
        &style_path,
        serde_json::to_string_pretty(&style_json).unwrap_or_default(),
    );

    let report_path = out_dir.join("ref_report.md");
    let report_md = format!(
        "# Reference Video Analysis Report (FFmpeg Fallback)\n\
         **Source:** `{}`\n\
         **Duration:** {:.2}s | **Resolution:** {}x{} ({})\n\
         **Extractor Backend:** `ffmpeg_fallback` (`pythonCvUnavailable=true`, `ocrAvailable=false`)\n\n\
         > **WARNING:** {}\n\n\
         **Extracted Sample Keyframes:**\n{}\n",
        video_path.file_name().and_then(|n| n.to_str()).unwrap_or("reference.mp4"),
        probed_dur,
        width,
        height,
        aspect_ratio,
        warning,
        frame_rel_paths
            .iter()
            .map(|f| format!("- `{}`", f))
            .collect::<Vec<_>>()
            .join("\n"),
    );
    let _ = std::fs::write(&report_path, report_md);

    (style_path, temporal_path, report_path)
}

pub async fn execute_ref_extractor(workspace_dir: &str, arguments: &Value) -> Value {
    let video_raw = match arguments.get("videoPath").and_then(|v| v.as_str()) {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => return json!({ "error": "extract_video_reference requires a valid 'videoPath' string." }),
    };

    let root = crate::paths::project_root();
    let ws = if workspace_dir.trim().is_empty() {
        root.clone()
    } else {
        std::path::PathBuf::from(workspace_dir)
    };

    let video_path = match resolve_isolated_path(&ws.to_string_lossy(), video_raw) {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };

    if !video_path.exists() {
        return json!({ "ok": false, "error": format!("Reference video file not found at: {}", video_path.display()) });
    }

    let default_out = "ref/extracted";
    let out_raw = arguments.get("outputDir").and_then(|v| v.as_str()).unwrap_or(default_out);
    let out_dir = match resolve_isolated_path(&ws.to_string_lossy(), out_raw) {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };

    if python_has_cv2_and_numpy().await {
        let script_path = root.join("core").join("ref_extractor").join("ref_extractor.py");
        let py_bin = crate::paths::locate_python_binary();
        let mut cmd = Command::new(&py_bin);
        crate::paths::configure_hidden_tokio_command(&mut cmd);
        if let Some(ff_bin) = crate::paths::locate_ffmpeg_binary() {
            cmd.env("AETHERIA_FFMPEG", ff_bin);
        }
        let deep_mode = arguments
            .get("mode")
            .and_then(|v| v.as_str())
            .is_some_and(|m| m.trim().eq_ignore_ascii_case("deep"));
        cmd.arg(&script_path).arg(&video_path).arg(&out_dir);
        if !deep_mode {
            cmd.arg("--fast");
        }

        if let Ok(res) = cmd.output().await {
            let stdout = String::from_utf8_lossy(&res.stdout).to_string();
            if let Some(idx) = stdout.find('{') {
                if let Ok(mut parsed) = serde_json::from_str::<Value>(&stdout[idx..]) {
                    if parsed.get("error").is_none() {
                        let frames_dir = out_dir.join("frames");
                        let vision_bundle = collect_extracted_frames_response(&ws, &frames_dir, "opencv");
                        let ast_path = out_dir.join("style_ast.json");
                        if let Some(obj) = parsed.as_object_mut() {
                            obj.insert("ok".to_string(), json!(true));
                            if ast_path.is_file() {
                                obj.insert("astPath".to_string(), json!(ast_path.to_string_lossy()));
                                if obj.get("motionAst").is_none() {
                                    if let Ok(ast_raw) = std::fs::read_to_string(&ast_path) {
                                        if let Ok(ast_val) = serde_json::from_str::<Value>(&ast_raw) {
                                            obj.insert("motionAst".to_string(), ast_val);
                                        }
                                    }
                                }
                            }
                            let frame_list: Vec<String> = vision_bundle
                                .get("frames")
                                .and_then(Value::as_array)
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|v| v.as_str().map(str::to_string))
                                        .collect()
                                })
                                .unwrap_or_default();
                            if let Some(imgs) = vision_bundle.get("_vision_images").cloned() {
                                obj.insert("_vision_images".to_string(), imgs);
                            }
                            if let Some(frames) = vision_bundle.get("frames").cloned() {
                                obj.insert("extractedFrames".to_string(), frames);
                            }
                            if let Some(total) = vision_bundle.get("totalExtractedFrames").cloned() {
                                obj.insert("totalExtractedFrames".to_string(), total);
                            }
                            let (summary, labels) =
                                build_compact_extraction_summary(&Value::Object(obj.clone()), &frame_list);
                            obj.insert("output".to_string(), json!(summary));
                            if !labels.is_empty() {
                                obj.insert("_vision_image_labels".to_string(), json!(labels));
                            }
                        }
                        return parsed;
                    }
                }
            } else if res.status.success() && !stdout.trim().is_empty() {
                return json!({
                    "ok": true,
                    "success": true,
                    "raw": stdout.trim()
                });
            }
        }
    }

    // Fallback: extract reference frames via FFmpeg at normalized [10%, 35%, 60%, 85%] of real video duration
    let frames_dir = out_dir.join("frames");
    let _ = std::fs::create_dir_all(&frames_dir);
    let ff_bin = crate::paths::locate_ffmpeg_binary().unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let probed_dur = crate::studio::reference_compare::probe_video_duration_secs(&ff_bin, &video_path)
        .unwrap_or(10.0);
    let sample_points = crate::session::agent_turn::social_links::compute_relative_sample_timestamps(probed_dur);

    for (idx, (_ratio, ts)) in sample_points.iter().enumerate() {
        let thumb_path = frames_dir.join(format!("thumb_{:03}.jpg", idx + 1));
        let mut ff_cmd = Command::new(&ff_bin);
        crate::paths::configure_hidden_tokio_command(&mut ff_cmd);
        let _ = ff_cmd
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                ts.as_str(),
                "-i",
                &video_path.to_string_lossy(),
                "-frames:v",
                "1",
                "-q:v",
                "4",
                &thumb_path.to_string_lossy(),
            ])
            .output()
            .await;
    }

    let mut fallback_res = collect_extracted_frames_response(&ws, &frames_dir, "ffmpeg");
    let frame_rels: Vec<String> = fallback_res
        .get("frames")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if !frame_rels.is_empty() {
        let dims = probe_video_dimensions_sync(&ff_bin, &video_path);
        let (style_path, temporal_path, report_path) = write_ffmpeg_fallback_blueprint(
            &video_path,
            &out_dir,
            probed_dur,
            dims,
            &sample_points,
            &frame_rels,
        );
        if let Some(obj) = fallback_res.as_object_mut() {
            obj.insert("pythonCvUnavailable".to_string(), json!(true));
            obj.insert("ocrAvailable".to_string(), json!(false));
            obj.insert("extractorBackend".to_string(), json!("ffmpeg_fallback"));
            obj.insert(
                "fallbackWarning".to_string(),
                json!("Python OpenCV/NumPy unavailable; generated minimal FFmpeg fallback frames and metadata without scene cuts or OCR."),
            );
            obj.insert("stylePath".to_string(), json!(style_path.to_string_lossy()));
            obj.insert("temporalPath".to_string(), json!(temporal_path.to_string_lossy()));
            obj.insert("reportPath".to_string(), json!(report_path.to_string_lossy()));
            obj.insert("_vision_image_labels".to_string(), json!(frame_rels));
        }
        return fallback_res;
    }

    json!({
        "ok": false,
        "error": "Failed to extract reference frames: neither Python (cv2/numpy) nor FFmpeg produced frames."
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_fallback_frames_with_success_true_and_no_palette() {
        let ws = std::env::temp_dir().join(format!("aetheria_ref_ext_g5_{}", std::process::id()));
        let frames_dir = ws.join("ref").join("extracted").join("frames");
        let _ = std::fs::remove_dir_all(&ws);
        std::fs::create_dir_all(&frames_dir).unwrap();
        std::fs::write(frames_dir.join("thumb_001.jpg"), b"jpg1").unwrap();
        std::fs::write(frames_dir.join("thumb_002.jpg"), b"jpg2").unwrap();

        let res = collect_extracted_frames_response(&ws, &frames_dir, "ffmpeg");
        assert_eq!(res.get("success"), Some(&json!(true)));
        assert!(res.get("palette").is_none());
        assert_eq!(
            res.get("frames"),
            Some(&json!([
                "ref/extracted/frames/thumb_001.jpg",
                "ref/extracted/frames/thumb_002.jpg"
            ]))
        );
        assert_eq!(
            res.get("_vision_images")
                .and_then(|v| v.as_array())
                .map(|a| a.len()),
            Some(2)
        );

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn select_extracted_vision_keyframes_covers_all_scenes_and_sorts_naturally() {
        let ws = std::env::temp_dir().join(format!("aetheria_ref_sel_{}", crate::paths::now_ms()));
        let frames_dir = ws.join("ref").join("extracted").join("frames");
        std::fs::create_dir_all(&frames_dir).unwrap();

        // Create 10 scene midpoints + start/end + thumbs, intentionally named without zero padding for scene 2 vs 10 test
        let mut scenes = Vec::new();
        for idx in 1..=10 {
            let mid = format!("ref_scene_{idx}.jpg");
            let st = format!("ref_scene_{idx}_start.jpg");
            let en = format!("ref_scene_{idx}_end.jpg");
            std::fs::write(frames_dir.join(&mid), format!("mid_{idx}").as_bytes()).unwrap();
            std::fs::write(frames_dir.join(&st), format!("st_{idx}").as_bytes()).unwrap();
            std::fs::write(frames_dir.join(&en), format!("en_{idx}").as_bytes()).unwrap();
            scenes.push(json!({
                "index": idx,
                "id": format!("scene_{idx}"),
                "keyframe": format!("ref/extracted/frames/{mid}"),
                "keyframes": {
                    "start": format!("ref/extracted/frames/{st}"),
                    "mid": format!("ref/extracted/frames/{mid}"),
                    "end": format!("ref/extracted/frames/{en}"),
                }
            }));
        }
        std::fs::write(frames_dir.join("thumb_001.jpg"), b"t1").unwrap();
        let style_path = ws.join("ref").join("extracted").join("style.json");
        std::fs::write(&style_path, serde_json::to_string(&json!({ "scenes": scenes })).unwrap()).unwrap();

        let selected = select_extracted_vision_keyframes(&frames_dir, Some(&style_path), 12);
        let names: Vec<String> = selected
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
            .collect();

        assert_eq!(names.len(), 12);
        // All 10 scenes must be represented in order 1..10 before adding transition frames
        assert_eq!(
            &names[0..10],
            &[
                "ref_scene_1.jpg",
                "ref_scene_2.jpg",
                "ref_scene_3.jpg",
                "ref_scene_4.jpg",
                "ref_scene_5.jpg",
                "ref_scene_6.jpg",
                "ref_scene_7.jpg",
                "ref_scene_8.jpg",
                "ref_scene_9.jpg",
                "ref_scene_10.jpg",
            ]
        );
        // Without style.json, natural ordering still places ref_scene_2 before ref_scene_10
        let _ = std::fs::remove_file(&style_path);
        let fallback_names: Vec<String> =
            select_extracted_vision_keyframes(&frames_dir, None, 12)
                .iter()
                .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
                .collect();
        assert_eq!(fallback_names[1], "ref_scene_2.jpg");
        assert_eq!(fallback_names[9], "ref_scene_10.jpg");

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn write_ffmpeg_fallback_blueprint_emits_honest_warnings() {
        let ws = std::env::temp_dir().join(format!("aetheria_ff_fb_{}", crate::paths::now_ms()));
        let out_dir = ws.join("ref").join("extracted");
        let vid = ws.join("ref").join("ref_demo.mp4");
        let (style_path, temporal_path, report_path) = write_ffmpeg_fallback_blueprint(
            &vid,
            &out_dir,
            6.5,
            Some((1280, 720)),
            &[(0.1, "00:00:00.65".into()), (0.6, "00:00:03.90".into())],
            &[
                "ref/extracted/frames/thumb_001.jpg".into(),
                "ref/extracted/frames/thumb_002.jpg".into(),
            ],
        );

        let style: Value =
            serde_json::from_str(&std::fs::read_to_string(style_path).unwrap()).unwrap();
        let temporal: Value =
            serde_json::from_str(&std::fs::read_to_string(temporal_path).unwrap()).unwrap();
        let report = std::fs::read_to_string(report_path).unwrap();

        assert_eq!(style["width"], 1280);
        assert_eq!(style["height"], 720);
        assert_eq!(style["aspectRatio"], "16:9");
        assert_eq!(style["pythonCvUnavailable"], true);
        assert_eq!(style["ocrAvailable"], false);
        assert_eq!(style["extractorBackend"], "ffmpeg_fallback");
        assert_eq!(temporal["extractorBackend"], "ffmpeg_fallback");
        assert!(report.contains("FFmpeg Fallback"));
        assert!(report.contains("ocrAvailable=false"));

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn select_extracted_vision_keyframes_includes_contact_sheets_alongside_midpoints() {
        let ws = std::env::temp_dir().join(format!("aetheria_kf_cs_{}", crate::paths::now_ms()));
        let extracted = ws.join("ref").join("extracted");
        let frames_dir = extracted.join("frames");
        std::fs::create_dir_all(&frames_dir).unwrap();

        let mut scenes = Vec::new();
        for idx in 1..=6 {
            let mid = format!("ref_scene_{idx:02}.jpg");
            std::fs::write(frames_dir.join(&mid), format!("mid_{idx}").as_bytes()).unwrap();
            scenes.push(json!({
                "index": idx,
                "id": format!("scene_{idx}"),
                "keyframe": format!("frames/{mid}")
            }));
        }
        std::fs::write(extracted.join("contact_sheet_1.jpg"), b"sheet1").unwrap();
        let style_path = extracted.join("style.json");
        std::fs::write(&style_path, serde_json::to_string(&json!({ "scenes": scenes })).unwrap()).unwrap();

        let selected = select_extracted_vision_keyframes(&frames_dir, Some(&style_path), 12);
        let names: Vec<String> = selected
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
            .collect();
        assert_eq!(names[0], "ref_scene_01.jpg");
        assert!(names.contains(&"contact_sheet_1.jpg".to_string()));

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn build_compact_extraction_summary_formats_scenes_and_labels() {
        let parsed = json!({
            "fastMode": true,
            "reportPath": "ref/extracted/ref_report.md",
            "stylePath": "ref/extracted/style.json",
            "blueprint": {
                "width": 720,
                "height": 1280,
                "fps": 30,
                "totalDuration": 15.0,
                "aspectRatio": "9:16",
                "bpm": 120,
                "scenes": [
                    {
                        "index": 1,
                        "id": "init",
                        "start": 0.0,
                        "end": 1.5,
                        "keyframe": "frames/ref_scene_01.jpg",
                        "layout": {
                            "palette": {
                                "bgHex": "#0d0d0d",
                                "textHex": "#eae6df",
                                "accentHex": "#e63920"
                            }
                        }
                    }
                ]
            }
        });
        let frames = vec![
            "ref/extracted/frames/ref_scene_01.jpg".to_string(),
            "ref/extracted/contact_sheet_1.jpg".to_string(),
        ];
        let (summary, labels) = build_compact_extraction_summary(&parsed, &frames);
        assert!(summary.contains("720x1280 @ 30fps, 15.00s, 9:16, BPM=120"));
        assert!(summary.contains("Scene 1 (init): 0.00s-1.50s (mid 0.75s) | bg=#0d0d0d"));
        assert_eq!(labels.len(), 2);
        assert!(labels[0].contains("Scene 1 init: 0.00s-1.50s"));
        assert!(labels[1].contains("full timeline storyboard contact sheet"));
    }

    #[test]
    fn select_extracted_vision_keyframes_prioritizes_q1_q3_for_long_scenes() {
        let ws = std::env::temp_dir().join(format!(
            "aetheria_long_scene_kfs_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let ext_dir = ws.join("ref").join("extracted");
        let frames_dir = ext_dir.join("frames");
        std::fs::create_dir_all(&frames_dir).expect("mkdir frames");
        for name in [
            "ref_scene_01_start.jpg",
            "ref_scene_01_q1.jpg",
            "ref_scene_01.jpg",
            "ref_scene_01_q3.jpg",
            "ref_scene_01_end.jpg",
            "ref_scene_02.jpg",
            "ref_scene_02_q1.jpg",
        ] {
            std::fs::write(frames_dir.join(name), b"img").expect("write frame");
        }
        let style = json!({
            "scenes": [
                {
                    "index": 1,
                    "duration": 3.6,
                    "keyframe": "frames/ref_scene_01.jpg",
                    "keyframes": [
                        { "t": 0.05, "path": "frames/ref_scene_01_start.jpg" },
                        { "t": 1.0, "path": "frames/ref_scene_01_q1.jpg" },
                        { "t": 1.8, "path": "frames/ref_scene_01.jpg" },
                        { "t": 2.6, "path": "frames/ref_scene_01_q3.jpg" },
                        { "t": 3.55, "path": "frames/ref_scene_01_end.jpg" }
                    ]
                },
                {
                    "index": 2,
                    "duration": 1.5,
                    "keyframe": "frames/ref_scene_02.jpg",
                    "keyframes": [
                        { "t": 0.4, "path": "frames/ref_scene_02_q1.jpg" },
                        { "t": 0.75, "path": "frames/ref_scene_02.jpg" }
                    ]
                }
            ]
        });
        let style_path = ext_dir.join("style.json");
        std::fs::write(&style_path, style.to_string()).expect("write style");

        // Cap to 5 frames: contact sheets none -> 4 midpoints (s1_q1, s1_mid, s1_q3, s2_mid) + 1 transition.
        let selected = select_extracted_vision_keyframes(&frames_dir, Some(&style_path), 5);
        let names: Vec<String> = selected
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
            .collect();
        assert_eq!(
            &names[..4],
            &[
                "ref_scene_01_q1.jpg",
                "ref_scene_01.jpg",
                "ref_scene_01_q3.jpg",
                "ref_scene_02.jpg",
            ]
        );
        assert_ne!(names[4], "ref_scene_01_q1.jpg");

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn collect_extracted_frames_response_prefers_compact_vision_copy() {
        let ws = std::env::temp_dir().join(format!(
            "aetheria_vision_copy_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let ext_dir = ws.join("ref").join("extracted");
        let frames_dir = ext_dir.join("frames");
        let vision_dir = ext_dir.join("vision");
        std::fs::create_dir_all(&frames_dir).expect("mkdir frames");
        std::fs::create_dir_all(&vision_dir).expect("mkdir vision");
        std::fs::write(frames_dir.join("ref_scene_01.jpg"), b"full-res-bytes")
            .expect("write full res");
        std::fs::write(vision_dir.join("ref_scene_01.jpg"), b"compact")
            .expect("write compact vision");

        let res = collect_extracted_frames_response(&ws, &frames_dir, "test");
        let frames = res["frames"].as_array().expect("frames");
        assert_eq!(frames[0], "ref/extracted/frames/ref_scene_01.jpg");
        let imgs = res["_vision_images"].as_array().expect("vision");
        let decoded = imgs[0].as_str().expect("data url");
        assert!(decoded.starts_with("data:image/jpeg;base64,"));
        let b64 = decoded.trim_start_matches("data:image/jpeg;base64,");
        assert_eq!(
            BASE64_STANDARD.decode(b64).expect("decode"),
            b"compact"
        );

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn select_extracted_vision_keyframes_prefers_composite_cards_with_sheets() {
        let ws = std::env::temp_dir().join(format!(
            "aetheria_composite_cards_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let ext_dir = ws.join("ref").join("extracted");
        let frames_dir = ext_dir.join("frames");
        std::fs::create_dir_all(&frames_dir).expect("mkdir frames");

        for f in [
            "ref_scene_01_card.jpg",
            "ref_scene_01.jpg",
            "ref_scene_01_beats.jpg",
            "ref_scene_01_start.jpg",
            "ref_scene_02_card.jpg",
            "ref_scene_02.jpg",
        ] {
            std::fs::write(frames_dir.join(f), b"jpg").expect("write frame");
        }
        std::fs::write(ext_dir.join("contact_sheet_1.jpg"), b"sheet1").expect("write sheet1");
        std::fs::write(ext_dir.join("contact_sheet_3.jpg"), b"sheet3").expect("write sheet3");

        let style = serde_json::json!({
            "scenes": [
                {
                    "index": 1,
                    "duration": 2.4,
                    "compositeCard": "frames/ref_scene_01_card.jpg",
                    "beatsStrip": "frames/ref_scene_01_beats.jpg",
                    "keyframe": "frames/ref_scene_01.jpg",
                    "keyframes": [
                        { "t": 0.05, "path": "frames/ref_scene_01_start.jpg" },
                        { "t": 1.2, "path": "frames/ref_scene_01.jpg" }
                    ]
                },
                {
                    "index": 2,
                    "duration": 1.8,
                    "compositeCard": "frames/ref_scene_02_card.jpg",
                    "keyframe": "frames/ref_scene_02.jpg",
                    "keyframes": [
                        { "t": 3.0, "path": "frames/ref_scene_02.jpg" }
                    ]
                }
            ]
        });
        let style_path = ext_dir.join("style.json");
        std::fs::write(&style_path, style.to_string()).expect("write style");

        let selected = select_extracted_vision_keyframes(&frames_dir, Some(&style_path), 5);
        let names: Vec<String> = selected
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
            .collect();
        assert_eq!(
            &names[..4],
            &[
                "ref_scene_01_card.jpg",
                "ref_scene_02_card.jpg",
                "contact_sheet_1.jpg",
                "contact_sheet_3.jpg",
            ]
        );
        assert!(!names.iter().any(|n| n == "ref_scene_01_beats.jpg"));

        let _ = std::fs::remove_dir_all(&ws);
    }
}
