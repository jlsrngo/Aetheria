//! Interactive Antigravity-grade micro-tools for the Smart Per-Scene Agentic Harness.
//!
//! Gives the scene-authoring LLM direct, workspace-isolated investigative and surgical editing
//! capabilities on a single scene (zero subagent bureaucracy):
//!   1. `inspect_ref_frame`       — extract full-res or zoom-cropped reference frame at any timestamp
//!   2. `sample_ref_region`       — measure exact pixel hexes, dominant clusters, and foreground bbox
//!   3. `fetch_web_image`         — download real internet images/3D objects/icons into `img/` (with optional bg cutout)
//!   4. `bash`                    — workspace-isolated shell/Python/OpenCV measurements
//!   5. `write_scene_script`      — write complete `script/sceneK.js` with instant hazard lint
//!   6. `patch_scene_script`      — surgical exact search-and-replace edit on `script/sceneK.js`
//!   7. `render_and_compare_scene`— render Scene K via headless CDP and return visual strip + full-res worst frame + metrics

use base64::prelude::*;
use serde_json::{json, Value};
use std::path::Path;

use super::direct_scene_prompt::{detect_scene_collision_hazards, format_comparison_feedback};
use crate::tool::ref_probe::{locate_reference_video, parse_box_arg, run_probe_python};

pub(crate) struct SceneToolContext<'a> {
    pub session_id: &'a str,
    pub workspace_dir: &'a str,
    pub ws_root: &'a Path,
    pub film_root: &'a Path,
    pub script_path: &'a Path,
    pub script_rel: &'a str,
    pub scene_num: usize,
    pub scene_start: f64,
    pub scene_dur: f64,
    pub film_duration: f64,
    pub width: u32,
    pub height: u32,
    pub default_scene_ts: &'a [f64],
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RenderedMetrics {
    pub overall: f64,
    pub ssim: f64,
    pub color: f64,
    pub edge: f64,
}

pub(crate) struct SceneToolOutcome {
    pub result_json: Value,
    pub vision_images: Vec<String>,
    pub vision_caption: Option<String>,
    pub script_modified: bool,
    pub rendered_score: Option<f64>,
    pub rendered_metrics: Option<RenderedMetrics>,
    pub rendered_errors: Option<Vec<String>>,
}

/// Returns OpenAI-compatible function tool definitions for the Smart Per-Scene Agentic Harness.
pub(crate) fn build_scene_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "inspect_ref_frame",
                "description": "Extract a full-resolution reference video frame at any timestamp (local scene seconds 0..dur or global seconds), optionally zoom-cropped to a rectangular region {x,y,w,h} to inspect fine icons, typography, or transitions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "timestampSec": { "type": "number", "description": "Timestamp in local scene seconds (0..dur) or global seconds." },
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
        }),
        json!({
            "type": "function",
            "function": {
                "name": "sample_ref_region",
                "description": "Measure exact hex colors (median, border, top dominant clusters), luminance/polarity, and tight foreground pixel bounding box inside a rectangular area of the reference frame at timestampSec.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "timestampSec": { "type": "number", "description": "Timestamp in local scene seconds (0..dur) or global seconds." },
                        "box": {
                            "type": "object",
                            "description": "Pixel region to sample {x, y, w, h}. Omit to sample the full frame.",
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
        }),
        crate::tool::fetch_web_image::fetch_web_image_tool_definition(),
        json!({
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Run a workspace-isolated shell command (PowerShell on Windows) to run Python/OpenCV/FFmpeg measurements, compute geometry, or validate scene syntax.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to execute inside the workspace." },
                        "workdir": { "type": "string", "description": "Optional relative working directory inside the workspace." }
                    },
                    "required": ["command"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "write_scene_script",
                "description": "Write the complete deterministic JavaScript implementation for this scene's script file (`script/sceneK.js`). Use for the initial draft or a full structural rewrite.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": { "type": "string", "description": "Complete JavaScript source calling AM.registerScene(...)." }
                    },
                    "required": ["code"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "patch_scene_script",
                "description": "Apply a surgical exact search-and-replace edit to this scene's script file (`script/sceneK.js`) without rewriting untouched working code. Prefer this over write_scene_script for targeted visual/timing adjustments.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "oldText": { "type": "string", "description": "Exact existing code substring to replace (must match uniquely)." },
                        "newText": { "type": "string", "description": "Replacement JavaScript code." }
                    },
                    "required": ["oldText", "newText"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "render_and_compare_scene",
                "description": "Render this scene via headless browser and return a 3-row visual comparison strip (Row 1 REFERENCE | Row 2 YOUR RENDER | Row 3 DIFF HEATMAP), per-frame SSIM/Color/Edge metrics, and any JS runtime errors. Optionally pass specific timestamps (local 0..dur or global) and fullResTimestamp to also inspect one full-resolution rendered frame.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "timestamps": {
                            "type": "array",
                            "items": { "type": "number" },
                            "description": "Optional list of up to 6 timestamps (local 0..dur or global seconds) to capture."
                        },
                        "fullResTimestamp": {
                            "type": "number",
                            "description": "Optional single timestamp (local or global) whose full-resolution rendered frame will also be attached."
                        }
                    }
                }
            }
        }),
    ]
}

/// Normalizes a model-supplied timestamp (which may be local `0..dur` OR global `start..end`)
/// into a valid clamped global video timestamp in seconds.
pub(crate) fn normalize_scene_timestamp(
    raw_t: f64,
    scene_start: f64,
    scene_dur: f64,
    film_duration: f64,
) -> f64 {
    let max_t = (film_duration - 0.03).max(0.0);
    if !raw_t.is_finite() {
        return (scene_start + scene_dur * 0.5).clamp(0.0, max_t);
    }
    let scene_end = scene_start + scene_dur;
    let global_t = if scene_start > 0.25 && raw_t >= 0.0 && raw_t <= scene_dur + 0.05 {
        scene_start + raw_t
    } else if raw_t >= scene_start - 0.15 && raw_t <= scene_end + 0.15 {
        raw_t
    } else if raw_t >= 0.0 && raw_t <= scene_dur + 0.05 {
        scene_start + raw_t
    } else {
        raw_t
    };
    global_t.clamp(0.0, max_t)
}

/// Applies a surgical search-and-replace patch to `source` using `edit::replace_content`'s
/// 6-tier cascading fuzzy matchers (exact, line-trimmed, block-anchor, whitespace-normalized,
/// indentation-flexible, trimmed-boundary) plus closest-line diagnostics and CRLF preservation.
pub(crate) fn apply_surgical_patch(
    source: &str,
    old_text: &str,
    new_text: &str,
) -> Result<(String, usize), String> {
    if old_text.is_empty() {
        return Err("`oldText` must not be empty.".to_string());
    }
    let uses_crlf = source.contains("\r\n");
    let norm_src = source.replace("\r\n", "\n");
    let norm_old = old_text.replace("\r\n", "\n");
    let norm_new = new_text.replace("\r\n", "\n");

    let (updated_lf, _) = crate::tool::edit::replace_content(&norm_src, &norm_old, &norm_new, false)?;

    // Compute 1-based line number of the first differing line.
    let line_num = norm_src
        .lines()
        .zip(updated_lf.lines())
        .position(|(a, b)| a != b)
        .map(|i| i + 1)
        .unwrap_or(1);

    let final_text = if uses_crlf {
        updated_lf.replace('\n', "\r\n")
    } else {
        updated_lf
    };
    Ok((final_text, line_num))
}

fn encode_file_jpeg_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!(
        "data:image/jpeg;base64,{}",
        BASE64_STANDARD.encode(&bytes)
    ))
}

/// Executes one micro-tool call for Scene K inside the Smart Per-Scene Agentic Harness.
pub(crate) async fn execute_scene_micro_tool(
    ctx: &SceneToolContext<'_>,
    tool_name: &str,
    args: &Value,
) -> SceneToolOutcome {
    match tool_name {
        "inspect_ref_frame" => {
            let Some(video_path) = locate_reference_video(ctx.ws_root, None) else {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "No reference video found in ref/ directory." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            };
            let raw_t = args
                .get("timestampSec")
                .and_then(Value::as_f64)
                .unwrap_or(ctx.scene_dur * 0.5);
            let global_t =
                normalize_scene_timestamp(raw_t, ctx.scene_start, ctx.scene_dur, ctx.film_duration);
            let crop_csv = parse_box_arg(args.get("crop"));
            match run_probe_python("inspect", &video_path, global_t, crop_csv.as_deref()).await {
                Ok(mut val) => {
                    let data_url = val
                        .as_object_mut()
                        .and_then(|o| o.remove("dataUrl"))
                        .and_then(|v| v.as_str().map(str::to_string));
                    let local_t = (global_t - ctx.scene_start).max(0.0);
                    if let Some(o) = val.as_object_mut() {
                        o.insert("localTimestampSec".to_string(), json!((local_t * 1000.0).round() / 1000.0));
                    }
                    let imgs = data_url.into_iter().collect();
                    let caption = Some(format!(
                        "Full-resolution reference frame from `inspect_ref_frame` at local_t={:.3}s (global {:.3}s){}.",
                        local_t,
                        global_t,
                        crop_csv
                            .as_ref()
                            .map(|c| format!(" crop=[{}]", c))
                            .unwrap_or_default()
                    ));
                    SceneToolOutcome {
                        result_json: val,
                        vision_images: imgs,
                        vision_caption: caption,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                }
                Err(err) => SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": err }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                },
            }
        }
        "sample_ref_region" => {
            let Some(video_path) = locate_reference_video(ctx.ws_root, None) else {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "No reference video found in ref/ directory." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            };
            let raw_t = args
                .get("timestampSec")
                .and_then(Value::as_f64)
                .unwrap_or(ctx.scene_dur * 0.5);
            let global_t =
                normalize_scene_timestamp(raw_t, ctx.scene_start, ctx.scene_dur, ctx.film_duration);
            let box_csv = parse_box_arg(args.get("box"));
            match run_probe_python("sample", &video_path, global_t, box_csv.as_deref()).await {
                Ok(mut val) => {
                    let local_t = (global_t - ctx.scene_start).max(0.0);
                    if let Some(o) = val.as_object_mut() {
                        o.insert("localTimestampSec".to_string(), json!((local_t * 1000.0).round() / 1000.0));
                    }
                    SceneToolOutcome {
                        result_json: val,
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                }
                Err(err) => SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": err }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                },
            }
        }
        "fetch_web_image" => {
            let res =
                crate::tool::fetch_web_image::execute_fetch_web_image(ctx.workspace_dir, args)
                    .await;
            let mut imgs = Vec::new();
            let mut caption = None;
            if res.get("success").and_then(Value::as_bool) == Some(true)
                && res.get("fallback").and_then(Value::as_bool) != Some(true)
            {
                if let Some(out_str) = res.get("outputPath").and_then(Value::as_str) {
                    let p = Path::new(out_str);
                    if let Ok(bytes) = tokio::fs::read(p).await {
                        if !bytes.is_empty() && bytes.len() <= 1_500_000 {
                            let ext = p
                                .extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("png")
                                .to_ascii_lowercase();
                            let mime = match ext.as_str() {
                                "png" => Some("image/png"),
                                "jpg" | "jpeg" => Some("image/jpeg"),
                                "webp" => Some("image/webp"),
                                _ => None,
                            };
                            if let Some(m) = mime {
                                imgs.push(format!("data:{};base64,{}", m, BASE64_STANDARD.encode(&bytes)));
                                let asset_url = res
                                    .get("assetUrl")
                                    .and_then(Value::as_str)
                                    .unwrap_or("/img/web_image.png");
                                caption = Some(format!(
                                    "Downloaded internet image `{}` attached above. Verify it matches the reference object cleanly (if not, try a more specific `query` or `removeBackground: true`); preload via `AM.loadImage('{}')` and draw via `AM.drawImageFit(...)`.",
                                    asset_url, asset_url
                                ));
                            }
                        }
                    }
                }
            }
            SceneToolOutcome {
                result_json: res,
                vision_images: imgs,
                vision_caption: caption,
                script_modified: false,
                rendered_score: None,
                rendered_metrics: None,
                rendered_errors: None,
            }
        }
        "bash" | "shell" | "terminal" => {
            let before = tokio::fs::read_to_string(ctx.script_path).await.ok();
            let res =
                crate::tool::bash::execute_bash(ctx.session_id, ctx.workspace_dir, args).await;
            let after = tokio::fs::read_to_string(ctx.script_path).await.ok();
            let modified_via_bash = match (before.as_deref(), after.as_deref()) {
                (Some(b), Some(a)) => {
                    b != a
                        && a.contains("registerScene")
                        && !crate::tool::film_state::is_scaffold_stub_content(a)
                }
                (None, Some(a)) => {
                    a.contains("registerScene")
                        && !crate::tool::film_state::is_scaffold_stub_content(a)
                }
                _ => false,
            };
            SceneToolOutcome {
                result_json: res,
                vision_images: Vec::new(),
                vision_caption: None,
                script_modified: modified_via_bash,
                rendered_score: None,
                rendered_metrics: None,
                rendered_errors: None,
            }
        }
        name if matches!(name, "write_scene_script" | "write" | "write_to_file")
            || name.starts_with("write_scene_script") =>
        {
            let Some(code) = args
                .get("code")
                .or_else(|| args.get("content"))
                .or_else(|| args.get("CodeContent"))
                .and_then(Value::as_str)
            else {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "Missing required string parameter `code`." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            };
            if !code.contains("registerScene") {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "Scene script must call `AM.registerScene(...)`." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            }
            if !crate::paths::contains_path(ctx.ws_root, ctx.script_path) {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "Scene script path resolved outside workspace." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            }
            let normalized = if code.ends_with('\n') {
                code.to_string()
            } else {
                format!("{}\n", code)
            };
            if let Err(e) = tokio::fs::write(ctx.script_path, &normalized).await {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": format!("Write failed: {}", e) }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            }
            let hazards = detect_scene_collision_hazards(&normalized);
            let lines_count = normalized.lines().count();
            SceneToolOutcome {
                result_json: json!({
                    "ok": true,
                    "file": ctx.script_rel,
                    "lines": lines_count,
                    "collisionHazards": hazards,
                    "nextStep": "Call `render_and_compare_scene` to visually verify your render against the reference."
                }),
                vision_images: Vec::new(),
                vision_caption: None,
                script_modified: true,
                rendered_score: None,
                rendered_metrics: None,
                rendered_errors: None,
            }
        }
        name if matches!(name, "patch_scene_script" | "edit" | "replace_file_content")
            || name.starts_with("patch_scene_script") =>
        {
            let old_text = args
                .get("oldText")
                .or_else(|| args.get("oldString"))
                .or_else(|| args.get("TargetContent"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let new_text = args
                .get("newText")
                .or_else(|| args.get("newString"))
                .or_else(|| args.get("ReplacementContent"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !crate::paths::contains_path(ctx.ws_root, ctx.script_path) {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "Scene script path resolved outside workspace." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            }
            let current = match tokio::fs::read_to_string(ctx.script_path).await {
                Ok(c) => c,
                Err(e) => {
                    return SceneToolOutcome {
                        result_json: json!({ "ok": false, "error": format!("Failed reading {}: {}", ctx.script_rel, e) }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    };
                }
            };
            match apply_surgical_patch(&current, old_text, new_text) {
                Ok((updated, start_line)) => {
                    if let Err(e) = tokio::fs::write(ctx.script_path, &updated).await {
                        return SceneToolOutcome {
                            result_json: json!({ "ok": false, "error": format!("Failed writing patched script: {}", e) }),
                            vision_images: Vec::new(),
                            vision_caption: None,
                            script_modified: false,
                            rendered_score: None,
                            rendered_metrics: None,
                            rendered_errors: None,
                        };
                    }
                    let hazards = detect_scene_collision_hazards(&updated);
                    SceneToolOutcome {
                        result_json: json!({
                            "ok": true,
                            "file": ctx.script_rel,
                            "patchedAtLine": start_line,
                            "lines": updated.lines().count(),
                            "collisionHazards": hazards
                        }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: true,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                }
                Err(err) => SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": err }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                },
            }
        }
        "render_and_compare_scene" => {
            let mut ts_list: Vec<f64> = args
                .get("timestamps")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_f64)
                        .take(6)
                        .map(|t| {
                            normalize_scene_timestamp(
                                t,
                                ctx.scene_start,
                                ctx.scene_dur,
                                ctx.film_duration,
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            if ts_list.is_empty() {
                ts_list = ctx.default_scene_ts.to_vec();
            }
            let full_res_t = args
                .get("fullResTimestamp")
                .and_then(Value::as_f64)
                .map(|t| {
                    normalize_scene_timestamp(t, ctx.scene_start, ctx.scene_dur, ctx.film_duration)
                });
            if let Some(ft) = full_res_t {
                if !ts_list.iter().any(|x| (*x - ft).abs() < 0.04) && ts_list.len() < 6 {
                    ts_list.push(ft);
                    ts_list.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                }
            }

            match crate::studio::preview_capture::capture_film_preview_with_options(
                ctx.workspace_dir,
                ts_list,
                Some(true),
                Some(0.65),
            )
            .await
            {
                Ok(res) => {
                    let (score, feedback, strip_path) = format_comparison_feedback(
                        res.reference_comparison.as_ref(),
                        ctx.scene_start,
                        &res.runtime_errors,
                        None,
                    );
                    let mut imgs = Vec::new();
                    if let Some(ref sp) = strip_path {
                        if let Some(url) = encode_file_jpeg_data_url(sp) {
                            imgs.push(url);
                        }
                    }
                    // Attach a full-resolution rendered frame: explicit `fullResTimestamp` if requested,
                    // otherwise automatically attach the worst-scoring rendered frame so fine typography,
                    // borders, and icons stay 1:1 readable instead of tiny strip thumbnails!
                    let auto_worst_t = if full_res_t.is_some() {
                        full_res_t
                    } else {
                        res.reference_comparison
                            .as_ref()
                            .and_then(|c| c.get("perFrame"))
                            .and_then(Value::as_array)
                            .and_then(|arr| {
                                arr.iter()
                                    .min_by(|a, b| {
                                        let sa = a
                                            .get("combinedScore")
                                            .and_then(Value::as_f64)
                                            .unwrap_or(1.0);
                                        let sb = b
                                            .get("combinedScore")
                                            .and_then(Value::as_f64)
                                            .unwrap_or(1.0);
                                        sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
                                    })
                                    .and_then(|f| f.get("timestamp"))
                                    .and_then(Value::as_f64)
                            })
                    };
                    if let Some(ft) = auto_worst_t {
                        if let Some(best_fr) = res.frames.iter().min_by(|a, b| {
                            (a.timestamp - ft)
                                .abs()
                                .partial_cmp(&(b.timestamp - ft).abs())
                                .unwrap_or(std::cmp::Ordering::Equal)
                        }) {
                            if !best_fr.data_url.trim().is_empty() {
                                imgs.push(best_fr.data_url.clone());
                            }
                        }
                    }
                    let caption = Some(format!(
                        "Visual render comparison for Scene {} (`Row 1 = REFERENCE | Row 2 = YOUR RENDER | Row 3 = DIFF HEATMAP`{}). Measured overall={:.3}, runtimeErrors={}.",
                        ctx.scene_num,
                        if imgs.len() > 1 { " + full-res preview frame" } else { "" },
                        score,
                        res.runtime_errors.len()
                    ));
                    let ssim_mean = res
                        .reference_comparison
                        .as_ref()
                        .and_then(|c| c.get("ssimMean").and_then(Value::as_f64))
                        .unwrap_or(0.0);
                    let color_mean = res
                        .reference_comparison
                        .as_ref()
                        .and_then(|c| c.get("colorMatchMean").and_then(Value::as_f64))
                        .unwrap_or(0.0);
                    let edge_mean = res
                        .reference_comparison
                        .as_ref()
                        .and_then(|c| c.get("edgeMatchMean").and_then(Value::as_f64))
                        .unwrap_or(0.0);
                    SceneToolOutcome {
                        result_json: json!({
                            "ok": true,
                            "overallFidelity": (score * 1000.0).round() / 1000.0,
                            "runtimeErrors": res.runtime_errors,
                            "diagnostics": feedback,
                            "canvas": format!("{}x{}", ctx.width, ctx.height),
                            "filmRoot": ctx.film_root.file_name().and_then(|s| s.to_str()).unwrap_or("")
                        }),
                        vision_images: imgs,
                        vision_caption: caption,
                        script_modified: false,
                        rendered_score: Some(score),
                        rendered_metrics: Some(RenderedMetrics {
                            overall: score,
                            ssim: ssim_mean,
                            color: color_mean,
                            edge: edge_mean,
                        }),
                        rendered_errors: Some(res.runtime_errors),
                    }
                }
                Err(err) => SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": err }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: Some(0.0),
                    rendered_metrics: Some(RenderedMetrics {
                        overall: 0.0,
                        ssim: 0.0,
                        color: 0.0,
                        edge: 0.0,
                    }),
                    rendered_errors: Some(vec![err]),
                },
            }
        }
        other => SceneToolOutcome {
            result_json: json!({ "ok": false, "error": format!("Unknown scene tool '{}'.", other) }),
            vision_images: Vec::new(),
            vision_caption: None,
            script_modified: false,
            rendered_score: None,
            rendered_metrics: None,
            rendered_errors: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surgical_patch_replaces_unique_block_and_rejects_missing_or_ambiguous() {
        let src = "function draw(ctx) {\n  var x = 100;\n  ctx.fillStyle = '#111';\n}\n";
        let (patched, line) =
            apply_surgical_patch(src, "  var x = 100;", "  var x = 124;").expect("patch ok");
        assert_eq!(line, 2);
        assert!(patched.contains("var x = 124;"));
        assert!(patched.contains("ctx.fillStyle = '#111';"));

        assert!(apply_surgical_patch(src, "nonexistent", "x").is_err());
        assert!(apply_surgical_patch("a\na\n", "a", "b").is_err());
    }

    #[test]
    fn normalize_scene_timestamp_handles_local_and_global_inputs() {
        // Scene 2: global 3.5s .. 5.6s (dur = 2.1s)
        assert!((normalize_scene_timestamp(0.5, 3.5, 2.1, 25.8) - 4.0).abs() < 1e-6);
        assert!((normalize_scene_timestamp(5.53, 3.5, 2.1, 25.8) - 5.53).abs() < 1e-6);
        // Scene 1: global 0.0s .. 3.5s
        assert!((normalize_scene_timestamp(1.2, 0.0, 3.5, 25.8) - 1.2).abs() < 1e-6);
    }

    #[test]
    fn scene_tool_definitions_expose_all_seven_antigravity_micro_tools() {
        let defs = build_scene_tool_definitions();
        let names: Vec<&str> = defs
            .iter()
            .filter_map(|d| d.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert_eq!(
            names,
            vec![
                "inspect_ref_frame",
                "sample_ref_region",
                "fetch_web_image",
                "bash",
                "write_scene_script",
                "patch_scene_script",
                "render_and_compare_scene",
            ]
        );
    }
}
