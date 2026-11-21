//! First-class on-demand reference frame & pixel probe tools (`inspect_ref_frame`, `sample_ref_region`).
//!
//! Exposed to ALL agents (main coordinator, subagents, and per-scene harness) so both vision
//! and non-vision models can inspect any timestamp/crop or measure exact pixel hex colors and
//! foreground bounding boxes inside the active workspace's `ref/` video.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn inspect_ref_frame_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "inspect_ref_frame",
            "description": "Extract a full-resolution frame at `timestampSec` — OR pass `endSec` + `frames` (e.g. 8) to extract a 1-image frame-by-frame motion micro-strip across `[timestampSec, endSec]` — from the active workspace reference video (with optional zoom-crop `{x,y,w,h}` in canvas pixels) to inspect micro-animations, lens distortion, collisions, or cross-scene transitions in a single call.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timestampSec": { "type": "number", "description": "Timestamp in seconds inside the reference video (or start timestamp when `endSec` is provided)." },
                    "endSec": { "type": "number", "description": "Optional end timestamp in seconds. When > `timestampSec`, returns a single stitched multi-frame motion micro-strip image covering `[timestampSec, endSec]`." },
                    "frames": { "type": "integer", "description": "Optional number of frames (`2..16`, default `8`) when `endSec` is set." },
                    "videoPath": { "type": "string", "description": "Optional relative path to the reference video (defaults to the active video in `ref/`)." },
                    "crop": {
                        "type": "object",
                        "description": "Optional zoom-crop rectangle in canvas pixel coordinates.",
                        "properties": {
                            "x": { "type": "integer" },
                            "y": { "type": "integer" },
                            "w": { "type": "integer" },
                            "h": { "type": "integer" }
                        },
                        "required": ["x", "y", "w", "h"]
                    }
                },
                "required": ["timestampSec"]
            }
        }
    })
}

pub fn sample_ref_region_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "sample_ref_region",
            "description": "Measure exact pixel hex colors (median, border, top dominant color clusters with ratios), luminance/polarity, and tight foreground bounding box `[x,y,w,h]` at `timestampSec` inside `box`. Works for both vision and non-vision models.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timestampSec": { "type": "number", "description": "Timestamp in seconds inside the reference video." },
                    "videoPath": { "type": "string", "description": "Optional relative path to the reference video (defaults to the active video in `ref/`)." },
                    "box": {
                        "type": "object",
                        "description": "Optional pixel region `{x,y,w,h}` to sample (omit for full frame).",
                        "properties": {
                            "x": { "type": "integer" },
                            "y": { "type": "integer" },
                            "w": { "type": "integer" },
                            "h": { "type": "integer" }
                        },
                        "required": ["x", "y", "w", "h"]
                    }
                },
                "required": ["timestampSec"]
            }
        }
    })
}

/// Locates the active reference video inside `ws_root/ref/` (or resolves an explicit isolated `videoPath`).
pub(crate) fn locate_reference_video(ws_root: &Path, explicit_path: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = explicit_path.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(resolved) = super::resolve_isolated_path(&ws_root.to_string_lossy(), raw) {
            if resolved.is_file() {
                return Some(resolved);
            }
        }
    }
    let ref_dir = ws_root.join("ref");
    for meta_name in ["temporal.json", "style.json"] {
        let p = ref_dir.join("extracted").join(meta_name);
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                if let Some(src) = v.get("source").and_then(Value::as_str) {
                    let cand = ref_dir.join(src);
                    if cand.is_file() && crate::paths::contains_path(ws_root, &cand) {
                        return Some(cand);
                    }
                }
            }
        }
    }
    let entries = std::fs::read_dir(&ref_dir).ok()?;
    let mut mp4s: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "mov" | "webm" | "mkv"))
        })
        .collect();
    mp4s.sort();
    mp4s.into_iter()
        .find(|p| crate::paths::contains_path(ws_root, p))
}

fn locate_probe_script() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("core/ref_extractor/ref_frame_probe.py"),
        PathBuf::from("../core/ref_extractor/ref_frame_probe.py"),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(6) {
            let c = anc.join("core").join("ref_extractor").join("ref_frame_probe.py");
            if c.is_file() {
                return Some(c);
            }
        }
    }
    None
}

pub(crate) fn parse_box_arg(val: Option<&Value>) -> Option<String> {
    let obj = val?.as_object()?;
    let x = obj.get("x")?.as_i64()?;
    let y = obj.get("y")?.as_i64()?;
    let w = obj.get("w")?.as_i64()?;
    let h = obj.get("h")?.as_i64()?;
    Some(format!("{},{},{},{}", x, y, w, h))
}

pub(crate) async fn run_probe_python(
    mode: &str,
    video_path: &Path,
    timestamp_sec: f64,
    box_csv: Option<&str>,
) -> Result<Value, String> {
    run_probe_python_ext(mode, video_path, timestamp_sec, None, None, box_csv).await
}

pub(crate) async fn run_probe_python_ext(
    mode: &str,
    video_path: &Path,
    timestamp_sec: f64,
    end_sec: Option<f64>,
    frames: Option<u32>,
    box_csv: Option<&str>,
) -> Result<Value, String> {
    let script = locate_probe_script()
        .ok_or_else(|| "ref_frame_probe.py not found in core/ref_extractor/".to_string())?;
    let mut cmd = tokio::process::Command::new("python");
    cmd.arg(&script)
        .arg(mode)
        .arg("--video")
        .arg(video_path)
        .arg("--t")
        .arg(format!("{:.3}", timestamp_sec.max(0.0)));
    if let Some(et) = end_sec.filter(|&e| e > timestamp_sec + 0.04) {
        cmd.arg("--end-t").arg(format!("{:.3}", et));
        cmd.arg("--frames").arg(frames.unwrap_or(8).clamp(2, 16).to_string());
    }
    if let Some(b) = box_csv {
        cmd.arg("--box").arg(b);
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "ref_frame_probe timed out after 20s".to_string())?
        .map_err(|e| format!("Failed spawning python ref_frame_probe: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let parsed: Value = serde_json::from_str(&stdout).map_err(|e| {
        let stderr = String::from_utf8_lossy(&out.stderr);
        format!(
            "Invalid JSON from ref_frame_probe ({}): {} | stderr: {}",
            e,
            stdout.chars().take(200).collect::<String>(),
            stderr.chars().take(200).collect::<String>()
        )
    })?;
    if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("ref_frame_probe failed")
            .to_string());
    }
    Ok(parsed)
}

/// Executes global `inspect_ref_frame` tool (attaches `_vision_images` for multimodal tool loop).
pub async fn execute_inspect_ref_frame(workspace_dir: &str, arguments: &Value) -> Value {
    let ws_root = Path::new(workspace_dir);
    let explicit = arguments.get("videoPath").and_then(Value::as_str);
    let Some(video_path) = locate_reference_video(ws_root, explicit) else {
        return json!({ "ok": false, "error": "No reference video found in workspace `ref/` directory." });
    };
    let ts = arguments
        .get("timestampSec")
        .or_else(|| arguments.get("t"))
        .or_else(|| arguments.get("startSec"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let end_ts = arguments
        .get("endSec")
        .or_else(|| arguments.get("end"))
        .and_then(Value::as_f64);
    let frames = arguments
        .get("frames")
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    let crop_csv = parse_box_arg(arguments.get("crop").or_else(|| arguments.get("box")));
    match run_probe_python_ext("inspect", &video_path, ts, end_ts, frames, crop_csv.as_deref()).await {
        Ok(mut val) => {
            if let Some(data_url) = val
                .as_object_mut()
                .and_then(|o| o.remove("dataUrl"))
                .and_then(|v| v.as_str().map(str::to_string))
            {
                let label = if let Some(et) = end_ts.filter(|&e| e > ts + 0.04) {
                    format!("inspect_ref_frame motion micro-strip @ t={:.2}s..{:.2}s", ts, et)
                } else {
                    format!("inspect_ref_frame @ t={:.2}s", ts)
                };
                if let Some(o) = val.as_object_mut() {
                    o.insert("_vision_images".to_string(), json!([data_url]));
                    o.insert(
                        "_vision_image_labels".to_string(),
                        json!([label]),
                    );
                    o.insert(
                        "nonVisionHint".to_string(),
                        json!("If your model lacks vision, call `sample_ref_region` on the same timestamp/box for exact hex colors and bounding boxes."),
                    );
                }
            }
            val
        }
        Err(err) => json!({ "ok": false, "error": err }),
    }
}

/// Executes global `sample_ref_region` tool (returns exact numeric pixel/color/bbox measurements).
pub async fn execute_sample_ref_region(workspace_dir: &str, arguments: &Value) -> Value {
    let ws_root = Path::new(workspace_dir);
    let explicit = arguments.get("videoPath").and_then(Value::as_str);
    let Some(video_path) = locate_reference_video(ws_root, explicit) else {
        return json!({ "ok": false, "error": "No reference video found in workspace `ref/` directory." });
    };
    let ts = arguments
        .get("timestampSec")
        .or_else(|| arguments.get("t"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let box_csv = parse_box_arg(arguments.get("box").or_else(|| arguments.get("crop")));
    match run_probe_python("sample", &video_path, ts, box_csv.as_deref()).await {
        Ok(val) => val,
        Err(err) => json!({ "ok": false, "error": err }),
    }
}
