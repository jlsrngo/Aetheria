//! Post-render preflight inspector (`ffprobe`, `freezedetect`, `blackdetect`, `loop_check`, staging -> ready promotion).

use super::adobe_profile::{
    AdobeProfile, RuleSeverity, URL_BEST_PRACTICES, URL_CSV, URL_GEN_AI_CONTENT, URL_LEGAL,
    URL_SUBMIT_VIDEOS, URL_TECHNICAL,
};
use super::loop_check::check_project_loop_continuity;
use super::manifest::{
    save_manifest, MicrostockManifest, MicrostockRenderRecord, PreflightItem, PreflightReport,
};
use crate::paths::{contains_path, locate_ffmpeg_binary, now_iso};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub fn locate_ffprobe_binary() -> Option<PathBuf> {
    if let Some(ff) = locate_ffmpeg_binary() {
        if let Some(parent) = ff.parent() {
            let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
            let candidate = parent.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed reading {} for sha256: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

pub fn probe_media_json(ffprobe_bin: &Path, media_path: &Path) -> Result<Value, String> {
    let mut cmd = std::process::Command::new(ffprobe_bin);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(media_path)
        .output()
        .map_err(|e| format!("Failed running ffprobe: {}", e))?;

    if !out.status.success() {
        return Err(format!(
            "ffprobe failed on {}: {}",
            media_path.display(),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    serde_json::from_slice::<Value>(&out.stdout)
        .map_err(|e| format!("Invalid ffprobe JSON output: {}", e))
}

fn parse_frame_rate(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    if let Some((num_s, den_s)) = trimmed.split_once('/') {
        let num = num_s.parse::<f64>().ok()?;
        let den = den_s.parse::<f64>().ok()?;
        if den <= 0.0 {
            return None;
        }
        let ratio = num / den;
        let rounded = ratio.round();
        if (ratio - rounded).abs() <= 0.05 {
            return Some(rounded as u32);
        }
        return None;
    }
    trimmed.parse::<u32>().ok()
}

/// Pure evaluator over `ffprobe -print_format json` output for unit & E2E verification.
pub fn evaluate_ffprobe_json(
    profile: &AdobeProfile,
    probe: &Value,
    filename: &str,
    file_size_bytes: u64,
) -> (Vec<PreflightItem>, f64) {
    let mut items = Vec::new();
    let clean_name = filename.trim();

    if clean_name.len() > profile.max_filename_chars.value {
        items.push(PreflightItem {
            code: "FILENAME_TOO_LONG".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Filename '{}' is {} chars (max {}).",
                clean_name,
                clean_name.len(),
                profile.max_filename_chars.value
            ),
            source: URL_CSV.to_string(),
        });
    }

    let ext = Path::new(clean_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !profile.containers.value.iter().any(|c| c == &ext) {
        items.push(PreflightItem {
            code: "CONTAINER_NOT_ALLOWED".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "File extension '.{}' is not in allowed Adobe Stock containers {:?}.",
                ext, profile.containers.value
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    let max_bytes = profile.max_file_size_mb.value * 1024 * 1024;
    if file_size_bytes > max_bytes {
        items.push(PreflightItem {
            code: "FILE_TOO_LARGE".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "File size {:.1} MB exceeds Adobe Stock {} MB limit.",
                (file_size_bytes as f64) / (1024.0 * 1024.0),
                profile.max_file_size_mb.value
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    let streams = probe
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_audio = streams
        .iter()
        .any(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio"));
    if has_audio {
        items.push(PreflightItem {
            code: "HAS_AUDIO".to_string(),
            severity: RuleSeverity::Fail,
            message: "Audio stream detected in rendered file; Adobe Stock microstock clips must be silent (-an).".to_string(),
            source: URL_SUBMIT_VIDEOS.to_string(),
        });
    }

    let video_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video"));

    let mut duration_sec = probe
        .pointer("/format/duration")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    if let Some(vs) = video_stream {
        let codec_name = vs
            .get("codec_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        if !profile.codecs.value.iter().any(|c| c == &codec_name) {
            items.push(PreflightItem {
                code: "CODEC_NOT_ALLOWED".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "Video codec '{}' is not allowed (expected h264 or prores).",
                    codec_name
                ),
                source: URL_TECHNICAL.to_string(),
            });
        }

        let width = vs.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
        let height = vs.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
        if !profile.is_whitelisted_resolution(width, height) {
            items.push(PreflightItem {
                code: "RESOLUTION_NOT_ALLOWED".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "Resolution {}x{} is not in Adobe Stock resolution whitelist.",
                    width, height
                ),
                source: URL_TECHNICAL.to_string(),
            });
        }

        let r_fps = vs
            .get("r_frame_rate")
            .and_then(Value::as_str)
            .and_then(parse_frame_rate)
            .or_else(|| {
                vs.get("avg_frame_rate")
                    .and_then(Value::as_str)
                    .and_then(parse_frame_rate)
            });
        match r_fps {
            Some(fps) if profile.allowed_fps.value.contains(&fps) => {}
            other => {
                items.push(PreflightItem {
                    code: "FPS_NOT_ALLOWED".to_string(),
                    severity: RuleSeverity::Fail,
                    message: format!(
                        "Stream frame rate {:?} is not in allowed integer FPS list {:?}.",
                        other, profile.allowed_fps.value
                    ),
                    source: URL_TECHNICAL.to_string(),
                });
            }
        }

        if duration_sec <= 0.0 {
            duration_sec = vs
                .get("duration")
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.0);
        }
    } else {
        items.push(PreflightItem {
            code: "CODEC_NOT_ALLOWED".to_string(),
            severity: RuleSeverity::Fail,
            message: "No video stream found in file.".to_string(),
            source: URL_TECHNICAL.to_string(),
        });
    }

    let (min_dur, max_dur) = profile.duration_sec_range.value;
    if duration_sec + 0.15 < (min_dur as f64) || duration_sec - 0.15 > (max_dur as f64) {
        items.push(PreflightItem {
            code: "DURATION_OUT_OF_RANGE".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Stream duration {:.2}s is outside Adobe Stock {}-{}s range.",
                duration_sec, min_dur, max_dur
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    (items, duration_sec)
}

/// Parses FFmpeg `freezedetect` and `blackdetect` stderr output.
pub fn parse_freeze_and_black_stderr(stderr: &str, duration_sec: f64) -> (f64, f64) {
    let mut frozen_total = 0.0;
    let mut open_freeze_start: Option<f64> = None;
    let mut black_total = 0.0;

    for line in stderr.lines() {
        if let Some(pos) = line.find("freeze_start:") {
            let val_s: String = line[pos + "freeze_start:".len()..]
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
                .collect();
            if let Ok(v) = val_s.parse::<f64>() {
                open_freeze_start = Some(v.max(0.0));
            }
        }
        if let Some(pos) = line.find("freeze_duration:") {
            let val_s: String = line[pos + "freeze_duration:".len()..]
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(v) = val_s.parse::<f64>() {
                frozen_total += v.max(0.0);
                open_freeze_start = None;
            }
        }
        if let Some(pos) = line.find("black_duration:") {
            let val_s: String = line[pos + "black_duration:".len()..]
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(v) = val_s.parse::<f64>() {
                black_total += v.max(0.0);
            }
        }
    }

    if let Some(start) = open_freeze_start {
        if duration_sec > start {
            frozen_total += duration_sec - start;
        }
    }

    (frozen_total, black_total)
}

pub fn analyze_motion_and_black_frames(
    ffmpeg_bin: &Path,
    media_path: &Path,
    duration_sec: f64,
) -> Vec<PreflightItem> {
    let mut items = Vec::new();
    let mut cmd = std::process::Command::new(ffmpeg_bin);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let Ok(out) = cmd
        .args([
            "-hide_banner",
            "-i",
        ])
        .arg(media_path)
        .args([
            "-vf",
            "freezedetect=n=0.002:d=0.8,blackdetect=d=0.15:pix_th=0.05",
            "-an",
            "-f",
            "null",
            "-",
        ])
        .output()
    else {
        return items;
    };

    let stderr = String::from_utf8_lossy(&out.stderr);
    let safe_dur = duration_sec.max(1.0);
    let (frozen_sec, black_sec) = parse_freeze_and_black_stderr(&stderr, safe_dur);
    let frozen_ratio = frozen_sec / safe_dur;

    if frozen_ratio >= 0.70 {
        items.push(PreflightItem {
            code: "LOW_MOTION".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Static/frozen frames detected for {:.2}s ({:.0}% of clip duration); Adobe Stock rejects still frames or limited motion.",
                frozen_sec,
                frozen_ratio * 100.0
            ),
            source: URL_BEST_PRACTICES.to_string(),
        });
    } else if frozen_ratio >= 0.35 {
        items.push(PreflightItem {
            code: "LOW_MOTION".to_string(),
            severity: RuleSeverity::Warn,
            message: format!(
                "Partial low-motion segment detected ({:.2}s / {:.0}% of clip).",
                frozen_sec,
                frozen_ratio * 100.0
            ),
            source: URL_BEST_PRACTICES.to_string(),
        });
    }

    if black_sec >= 0.15 {
        items.push(PreflightItem {
            code: "BLACK_FRAMES".to_string(),
            severity: RuleSeverity::Warn,
            message: format!(
                "Black frames detected ({:.2}s total); avoid fade-to-black transitions in stock clips.",
                black_sec
            ),
            source: URL_BEST_PRACTICES.to_string(),
        });
    }

    items
}

pub async fn run_post_render_preflight(
    profile: &AdobeProfile,
    ws_root: &Path,
    project_dir: &Path,
    manifest: &mut MicrostockManifest,
    file_arg: &str,
    check_loop_override: Option<bool>,
) -> Result<PreflightReport, String> {
    let staging_dir = project_dir.join("output").join("microstock").join("staging");
    let ready_dir = project_dir.join("output").join("microstock").join("ready");
    let _ = std::fs::create_dir_all(&staging_dir);
    let _ = std::fs::create_dir_all(&ready_dir);

    let candidate_in_staging = staging_dir.join(file_arg.trim());
    let candidate_direct = project_dir.join(file_arg.trim());
    let source_path = if candidate_in_staging.is_file() {
        candidate_in_staging
    } else if candidate_direct.is_file() {
        candidate_direct
    } else {
        return Err(format!("Rendered file '{}' not found in staging/", file_arg));
    };

    if !contains_path(ws_root, &source_path) {
        return Err("Access Denied: preflight file path escapes workspace".to_string());
    }

    let filename = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("output.mp4")
        .to_string();
    let file_size = std::fs::metadata(&source_path).map(|m| m.len()).unwrap_or(0);

    let ffprobe_bin =
        locate_ffprobe_binary().ok_or_else(|| "ffprobe binary not found".to_string())?;
    let ffmpeg_bin = locate_ffmpeg_binary().ok_or_else(|| "ffmpeg binary not found".to_string())?;

    let probe_json = probe_media_json(&ffprobe_bin, &source_path)?;
    let (mut items, duration_sec) =
        evaluate_ffprobe_json(profile, &probe_json, &filename, file_size);

    items.extend(analyze_motion_and_black_frames(
        &ffmpeg_bin,
        &source_path,
        duration_sec,
    ));

    // Manifest declaration & checklist checks
    let mut blocked = false;
    match manifest.provenance.ai_declared {
        None => {
            blocked = true;
            items.push(PreflightItem {
                code: "AI_DECLARATION_MISSING".to_string(),
                severity: RuleSeverity::Fail,
                message: "Generative AI declaration (aiDeclared) is unset.".to_string(),
                source: URL_GEN_AI_CONTENT.to_string(),
            });
        }
        Some(true) => {
            items.push(PreflightItem {
                code: "AI_LABEL_REQUIRED".to_string(),
                severity: RuleSeverity::Info,
                message: format!(
                    "Check '{}' in Adobe Stock Contributor Portal.",
                    profile.ai_portal_checkbox_label.value
                ),
                source: URL_GEN_AI_CONTENT.to_string(),
            });
        }
        Some(false) => {}
    }

    if !manifest.checklist.is_complete() {
        blocked = true;
        items.push(PreflightItem {
            code: "CHECKLIST_INCOMPLETE".to_string(),
            severity: RuleSeverity::Fail,
            message: "Compliance checklist is incomplete.".to_string(),
            source: URL_LEGAL.to_string(),
        });
    }

    // Optional loop check
    let mut metrics_obj = json!({
        "durationSec": duration_sec,
        "fileSizeBytes": file_size,
        "ffprobeStreams": probe_json.get("streams").cloned().unwrap_or(Value::Null),
    });

    let should_check_loop = check_loop_override.unwrap_or(manifest.is_loop);
    if should_check_loop {
        if let Ok(loop_res) =
            check_project_loop_continuity(project_dir, ws_root, 0.96, 6.0).await
        {
            metrics_obj["loopCheck"] = json!({
                "seamZeroVsDuration": loop_res.seam_zero_vs_duration,
                "lastToFirst": loop_res.last_to_first,
                "adjacentStepMedian": loop_res.adjacent_step_median,
                "minSeamSsimThreshold": loop_res.min_seam_ssim_threshold,
                "maxPsnrDropDbThreshold": loop_res.max_psnr_drop_db_threshold,
                "isDiscontinuous": loop_res.is_discontinuous,
            });
            items.push(loop_res.item);
        }
    }

    // Always append MOTION_GRAPHICS_RULES_UNKNOWN info notice
    items.push(PreflightItem {
        code: "MOTION_GRAPHICS_RULES_UNKNOWN".to_string(),
        severity: RuleSeverity::Info,
        message: profile.motion_graphics_notice.clone(),
        source: URL_TECHNICAL.to_string(),
    });

    let has_fail = items.iter().any(|i| i.severity == RuleSeverity::Fail);
    let has_warn = items.iter().any(|i| i.severity == RuleSeverity::Warn);

    let status = if blocked {
        "blocked"
    } else if has_fail {
        "fail"
    } else if has_warn {
        "warn"
    } else {
        "pass"
    };

    let mut promoted_to_ready = false;
    let mut ready_path_str = None;

    if status == "pass" || status == "warn" {
        let ready_dest = ready_dir.join(&filename);
        if contains_path(ws_root, &ready_dest) {
            std::fs::copy(&source_path, &ready_dest).map_err(|e| {
                format!(
                    "Failed promoting {} to ready/: {}",
                    source_path.display(),
                    e
                )
            })?;
            promoted_to_ready = true;
            ready_path_str = Some(ready_dest.to_string_lossy().to_string());
        }
    }

    let report = PreflightReport {
        status: status.to_string(),
        checked_at: now_iso(),
        promoted_to_ready,
        ready_path: ready_path_str,
        items,
        metrics: Some(metrics_obj),
    };

    if let Ok(sha256) = compute_file_sha256(&source_path) {
        manifest.renders.retain(|r| r.file != filename);
        manifest.renders.push(MicrostockRenderRecord {
            file: filename,
            sha256,
            preset: manifest.preset.clone(),
            preflight: report.clone(),
        });
        let _ = save_manifest(ws_root, project_dir, manifest);
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_ffprobe_json_fixtures_for_all_stream_codes() {
        let profile = AdobeProfile::default_profile();

        // 1. Valid 1920x1080@30fps H.264 6s silent MP4
        let valid_probe = json!({
            "format": { "duration": "6.000000" },
            "streams": [{
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "30/1"
            }]
        });
        let (items, _) = evaluate_ffprobe_json(&profile, &valid_probe, "clip-1080p.mp4", 5_000_000);
        assert!(items.is_empty(), "expected no errors on valid probe, got {:?}", items);

        // 2. HAS_AUDIO, CODEC_NOT_ALLOWED, RESOLUTION_NOT_ALLOWED, FPS_NOT_ALLOWED, DURATION_OUT_OF_RANGE, CONTAINER_NOT_ALLOWED, FILE_TOO_LARGE, FILENAME_TOO_LONG
        let bad_probe = json!({
            "format": { "duration": "2.500000" },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "vp9",
                    "width": 1000,
                    "height": 1000,
                    "r_frame_rate": "20/1"
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        });
        let (bad_items, _) = evaluate_ffprobe_json(
            &profile,
            &bad_probe,
            "this-filename-is-over-thirty-chars.webm",
            4000 * 1024 * 1024,
        );
        let codes: Vec<&str> = bad_items.iter().map(|i| i.code.as_str()).collect();
        assert!(codes.contains(&"FILENAME_TOO_LONG"));
        assert!(codes.contains(&"CONTAINER_NOT_ALLOWED"));
        assert!(codes.contains(&"FILE_TOO_LARGE"));
        assert!(codes.contains(&"HAS_AUDIO"));
        assert!(codes.contains(&"CODEC_NOT_ALLOWED"));
        assert!(codes.contains(&"RESOLUTION_NOT_ALLOWED"));
        assert!(codes.contains(&"FPS_NOT_ALLOWED"));
        assert!(codes.contains(&"DURATION_OUT_OF_RANGE"));
    }

    #[test]
    fn parses_unclosed_freezedetect_and_blackdetect() {
        let stderr = "\
[freezedetect @ 001] lavfi.freezedetect.freeze_start: 0\n\
[blackdetect @ 002] black_start:0 black_end:0.5 black_duration:0.5\n";
        let (frozen, black) = parse_freeze_and_black_stderr(stderr, 6.0);
        assert!((frozen - 6.0).abs() < 1e-4);
        assert!((black - 0.5).abs() < 1e-4);
    }
}
