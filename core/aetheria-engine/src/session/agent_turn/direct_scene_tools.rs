//! Interactive studio-grade micro-tools for the Smart Per-Scene Agentic Harness.
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

use super::direct_scene_prompt::{
    detect_scene_motion_hazards, format_comparison_feedback, SceneMotionExpectations,
};
use crate::tool::ref_probe::{locate_reference_video, parse_box_arg, run_probe_python};

pub(crate) struct SceneToolContext<'a> {
    pub session_id: &'a str,
    pub workspace_dir: &'a str,
    pub ws_root: &'a Path,
    pub film_root: &'a Path,
    pub script_path: &'a Path,
    pub script_rel: &'a str,
    pub scene_id: &'a str,
    pub scene_num: usize,
    pub scene_start: f64,
    pub scene_dur: f64,
    pub film_duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub default_scene_ts: &'a [f64],
    pub safe_iso_lo: f64,
    pub safe_iso_hi: f64,
    pub use_filmstrip: bool,
    pub motion_expectations: SceneMotionExpectations,
    pub secondary_motion: &'a [Value],
}

/// Returns true when the 30fps optical-flow motion gate should verify a scene render.
/// Every error-free filmstrip render must be checked so later edits cannot bypass the gate
/// and register as false-clean (`motion_flow_deficit = false`).
pub(crate) fn should_run_motion_flow_gate(use_filmstrip: bool, runtime_error_count: usize) -> bool {
    use_filmstrip && runtime_error_count == 0
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RenderedMetrics {
    pub overall: f64,
    pub ssim: f64,
    pub color: f64,
    pub edge: f64,
    pub min_frame_score: f64,
    pub has_structural_diagnosis: bool,
    pub motion_flow_deficit: bool,
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

pub(crate) fn build_scene_tool_definitions_with_options(
    include_filmstrip: bool,
    allow_bash: bool,
) -> Vec<Value> {
    let mut defs = build_scene_tool_definitions();
    if !allow_bash {
        defs.retain(|d| {
            d.pointer("/function/name").and_then(Value::as_str) != Some("bash")
        });
    }
    if include_filmstrip {
        defs.push(crate::tool::ref_filmstrip::read_filmstrip_tool_definition());
    }
    defs
}

#[cfg(test)]
pub(crate) fn build_scene_tool_definitions_with_filmstrip(include_filmstrip: bool) -> Vec<Value> {
    build_scene_tool_definitions_for_remake(include_filmstrip, false)
}

pub(crate) fn build_scene_tool_definitions_for_remake(
    include_filmstrip: bool,
    include_motion_spec: bool,
) -> Vec<Value> {
    let allow_bash = std::env::var("AETHERIA_DIRECT_ALLOW_BASH")
        .ok()
        .map(|v| {
            !matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off" | "disabled"
            )
        })
        .unwrap_or(true);
    let mut defs = build_scene_tool_definitions_with_options(include_filmstrip, allow_bash);
    if include_motion_spec {
        defs.push(super::motion_spec::write_motion_spec_tool_definition());
    }
    defs
}

/// Rejects solid-background or empty stub placeholders written only to bypass the write gate.
pub(crate) fn is_trivial_static_placeholder(code: &str) -> bool {
    if crate::tool::film_state::is_scaffold_stub_content(code) {
        return true;
    }
    if code.contains("throw ") {
        return false;
    }
    let lower = code.to_ascii_lowercase();
    let code_lines: Vec<&str> = code
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("//") && !l.starts_with("/*") && !l.starts_with('*'))
        .collect();
    const DRAW_PATTERNS: &[&str] = &[
        "fillrect(",
        "strokerect(",
        "arc(",
        "ellipse(",
        "moveto(",
        "lineto(",
        "beziercurveto(",
        "quadraticcurveto(",
        "filltext(",
        "stroketext(",
        "drawimage(",
        "drawopticalglow(",
        "drawbloomstroke(",
        "drawsphericallens(",
        "drawtaperedribbon(",
        "drawextrudedarrow3d(",
        "drawwordwheel(",
        "drawsvgpath(",
        "drawlaptopframe(",
        "fillroundrect(",
        "strokeroundrect(",
        "drawcursor(",
        "drawblurrevealtext(",
        "drawblurrisewords(",
        "drawturntableobject(",
        "drawmorphpolygon(",
    ];
    let draw_hits: usize = DRAW_PATTERNS.iter().map(|pat| lower.matches(pat).count()).sum();
    draw_hits <= 1 && (code_lines.len() <= 20 || lower.contains("placeholder"))
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

fn build_unused_downloaded_asset_hint(film_root: &Path, code: &str) -> Option<String> {
    let uses_asset_registry = code.contains("AM.drawAsset(");
    let has_load = code.contains("AM.loadImage(") || code.contains("AM.getAsset(");
    let actually_draws_image = uses_asset_registry
        || code.contains("AM.drawImageFit(")
        || code.contains(".drawImage(")
        || (has_load && code.contains("AM.drawTurntableObject("));
    if (has_load || uses_asset_registry) && actually_draws_image {
        return None;
    }
    let img_dir = film_root.join("img");
    let entries = std::fs::read_dir(img_dir).ok()?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            let low = ext.to_ascii_lowercase();
            if matches!(low.as_str(), "png" | "jpg" | "jpeg" | "webp") {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    names.push(format!("/img/{}", name));
                }
            }
        }
        if names.len() >= 3 {
            break;
        }
    }
    if names.is_empty() {
        return None;
    }
    Some(format!(
        "UNUSED DOWNLOADED ASSET HAZARD: Real image asset(s) exist on disk [{}] from `fetch_web_image`, but your script did NOT actually render it with `AM.loadImage` + `AM.drawTurntableObject`/`AM.drawImageFit`/`ctx.drawImage`! Preload `var heroImg = AM.loadImage('{}');` at module top level AND pass `heroImg` directly into `AM.drawTurntableObject(ctx, cx, cy, t, heroImg, {{ w, h, omega: 2.1, depth: 0.24, ringRadius }})` or `AM.drawImageFit(ctx, heroImg, ...)` instead of drawing a flat procedural fallback!",
        names.join(", "),
        names[0]
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
                                let has_alpha = res.get("hasAlpha").and_then(Value::as_bool).unwrap_or(false);
                                let bg_rm = res.get("backgroundRemoved").and_then(Value::as_bool).unwrap_or(false);
                                let dims = match (
                                    res.get("width").and_then(Value::as_u64),
                                    res.get("height").and_then(Value::as_u64),
                                ) {
                                    (Some(w), Some(h)) => format!("{}x{}", w, h),
                                    _ => "unknown".to_string(),
                                };
                                let tone_note = match (
                                    res.get("meanLuma").and_then(Value::as_f64),
                                    res.get("meanSat").and_then(Value::as_f64),
                                    res.get("meanHex").and_then(Value::as_str),
                                ) {
                                    (Some(l), Some(s), Some(hx)) => {
                                        format!(" | assetTone: meanHex={} luma={:.0}/255 sat={:.0}/255", hx, l, s)
                                    }
                                    _ => String::new(),
                                };
                                caption = Some(format!(
                                    "Downloaded internet image `{}` ({}, hasAlpha={}, cutout={}{}) attached above. Preload it at module top level via `var heroImg = AM.loadImage('{}');` and render/rotate it cleanly via `AM.drawTurntableObject(ctx, cx, cy, t, heroImg, {{ w, h, omega: 2.1, depth: 0.24, ringRadius }})` or `AM.drawImageFit(...)` — match tone to Row 1 using `ctx.filter = 'brightness(...) contrast(...) saturate(...)'` (or re-fetch with `targetLuma`/`targetSat` from `sample_ref_region`). If this candidate looks wrong, call `fetch_web_image` with `candidateIndex: 1` (or a `url` from `candidates`).",
                                    asset_url, dims, has_alpha, bg_rm, tone_note, asset_url
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
        "write_motion_spec" => {
            let spec_path = super::motion_spec::spec_path_for_script(ctx.script_path);
            if !crate::paths::contains_path(ctx.ws_root, &spec_path) {
                return SceneToolOutcome {
                    result_json: json!({ "ok": false, "error": "Motion spec path resolved outside workspace." }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                };
            }
            match super::motion_spec::parse_and_validate_motion_spec(
                args,
                ctx.scene_id,
                ctx.scene_dur,
                ctx.motion_expectations,
            ) {
                Ok((spec, validation)) => {
                    if validation.valid {
                        if let Ok(pretty) = serde_json::to_string_pretty(&spec) {
                            let _ = tokio::fs::write(&spec_path, format!("{}\n", pretty)).await;
                        }
                    }
                    let next_step = if validation.valid {
                        "Motion Specification validated and saved. Now call `write_scene_script` implementing every declared element, timing, easing, and hold behavior."
                    } else {
                        "Planning failure: fix the validation errors in `write_motion_spec` (or proceed directly if minor) before writing `script/sceneK.js`."
                    };
                    SceneToolOutcome {
                        result_json: json!({
                            "ok": validation.valid,
                            "valid": validation.valid,
                            "failureClass": validation.failure_class,
                            "errors": validation.errors,
                            "warnings": validation.warnings,
                            "summary": validation.summary,
                            "nextStep": next_step,
                        }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                }
                Err(err) => SceneToolOutcome {
                    result_json: json!({
                        "ok": false,
                        "valid": false,
                        "failureClass": "planning_failure",
                        "error": err,
                    }),
                    vision_images: Vec::new(),
                    vision_caption: None,
                    script_modified: false,
                    rendered_score: None,
                    rendered_metrics: None,
                    rendered_errors: None,
                },
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
            if is_trivial_static_placeholder(code) {
                return SceneToolOutcome {
                    result_json: json!({
                        "ok": false,
                        "error": "Rejected static placeholder stub: write the complete time-driven animated scene (using local time t and real vector/text/glow layers from the attached 1/1 filmstrips), never a solid-color placeholder."
                    }),
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
            let mut hazards = detect_scene_motion_hazards(&normalized, ctx.motion_expectations);
            hazards.extend(super::motion_spec::load_and_check_motion_spec_compliance(
                ctx.script_path,
                &normalized,
            ));
            let lines_count = normalized.lines().count();
            let asset_hint = build_unused_downloaded_asset_hint(ctx.film_root, &normalized);
            if let Some(ref hint) = asset_hint {
                hazards.push(hint.clone());
            }
            let mut rj = json!({
                "ok": true,
                "file": ctx.script_rel,
                "lines": lines_count,
                "collisionHazards": hazards,
                "nextStep": "Call `render_and_compare_scene` to visually verify your render against the reference."
            });
            if let Some(hint) = asset_hint {
                rj["assetHint"] = json!(hint);
            }
            SceneToolOutcome {
                result_json: rj,
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
                    let mut hazards = detect_scene_motion_hazards(&updated, ctx.motion_expectations);
                    hazards.extend(super::motion_spec::load_and_check_motion_spec_compliance(
                        ctx.script_path,
                        &updated,
                    ));
                    let asset_hint = build_unused_downloaded_asset_hint(ctx.film_root, &updated);
                    if let Some(ref hint) = asset_hint {
                        hazards.push(hint.clone());
                    }
                    let mut rj = json!({
                        "ok": true,
                        "file": ctx.script_rel,
                        "patchedAtLine": start_line,
                        "lines": updated.lines().count(),
                        "collisionHazards": hazards
                    });
                    if let Some(hint) = asset_hint {
                        rj["assetHint"] = json!(hint);
                    }
                    SceneToolOutcome {
                        result_json: rj,
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
                        .take(8)
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
                if ctx.use_filmstrip {
                    let raw_min_t = ctx.scene_start + 0.02;
                    let raw_max_t = (ctx.scene_start + ctx.scene_dur - 0.03)
                        .min((ctx.film_duration - 0.03).max(0.0))
                        .max(raw_min_t);
                    let min_t = ((raw_min_t.max(ctx.safe_iso_lo).min(raw_max_t)) * 1000.0).round()
                        / 1000.0;
                    let max_t = ((raw_max_t.min(ctx.safe_iso_hi).max(min_t)) * 1000.0).round()
                        / 1000.0;
                    // Include settled entry boundary (outside cross-scene push/zoom bridge), saved sub-beat keyframe timestamps, evenly spaced beats, and settled exit boundary
                    ts_list.push(min_t);
                    for &kt in ctx.default_scene_ts {
                        if kt >= min_t && kt <= max_t && !ts_list.iter().any(|x| (*x - kt).abs() < 0.04) {
                            ts_list.push(kt);
                        }
                    }
                    for i in 1..6 {
                        if ts_list.len() >= 7 {
                            break;
                        }
                        let r = i as f64 / 6.0;
                        let cand = ((min_t + (max_t - min_t) * r) * 1000.0).round() / 1000.0;
                        if !ts_list.iter().any(|x| (*x - cand).abs() < 0.05) {
                            ts_list.push(cand);
                        }
                    }
                    if ctx.motion_expectations.pre_cut_active && (max_t - min_t) >= 0.45 {
                        let pre_tail = ((max_t - 0.30).max(min_t) * 1000.0).round() / 1000.0;
                        if !ts_list.iter().any(|x| (*x - pre_tail).abs() < 0.04) && ts_list.len() < 7 {
                            ts_list.push(pre_tail);
                        }
                    }
                    if !ts_list.iter().any(|x| (*x - max_t).abs() < 0.04) {
                        ts_list.push(max_t);
                    }
                    ts_list.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    ts_list.truncate(8);
                } else {
                    ts_list = ctx.default_scene_ts.to_vec();
                }
            }
            let full_res_t = args
                .get("fullResTimestamp")
                .and_then(Value::as_f64)
                .map(|t| {
                    normalize_scene_timestamp(t, ctx.scene_start, ctx.scene_dur, ctx.film_duration)
                });
            if let Some(ft) = full_res_t {
                if !ts_list.iter().any(|x| (*x - ft).abs() < 0.04) && ts_list.len() < 8 {
                    ts_list.push(ft);
                    ts_list.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                }
            }

            match crate::studio::preview_capture::capture_film_preview_with_full_options(
                ctx.workspace_dir,
                ts_list,
                crate::studio::preview_capture::PreviewCaptureOptions {
                    compare_to_reference: Some(true),
                    pass_threshold: Some(0.65),
                    visual_inspect_only: Some(false),
                    include_full_res_frames: Some(false),
                    disable_auto_rollback: true,
                    forced_scene_id: Some(ctx.scene_id.to_string()),
                    write_scene_beat_strips: Some(true),
                    apply_motion_blur: None,
                },
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
                    let motion_check: Option<Value> = res
                        .reference_comparison
                        .as_ref()
                        .and_then(|c| c.get("motionDiagnostics"))
                        .cloned();
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
                    let mut motion_warn_lines: Vec<String> = feedback
                        .lines()
                        .filter(|l| {
                            l.contains("MOTION FROZEN WARNING")
                                || l.contains("MOTION STIFFNESS WARNING")
                                || l.contains("MOTION JUMP / TELEPORT WARNING")
                                || l.contains("MOTION ACTIVITY WARNING")
                                || l.contains("MOTION WINDOW FREEZE")
                                || l.contains("MOTION DIRECTION/PAN MISMATCH")
                        })
                        .map(str::to_string)
                        .collect();
                    let pre_cut_frozen = ctx.motion_expectations.pre_cut_active
                        && motion_check.as_ref().is_some_and(|mc| {
                            let ref_last = mc
                                .get("refStepDeltas")
                                .and_then(Value::as_array)
                                .and_then(|a| a.last())
                                .and_then(Value::as_f64)
                                .unwrap_or(0.0);
                            let prev_last = mc
                                .get("prevStepDeltas")
                                .and_then(Value::as_array)
                                .and_then(|a| a.last())
                                .and_then(Value::as_f64)
                                .unwrap_or(1.0);
                            ref_last >= 0.45 && prev_last < 0.15
                        });
                    if pre_cut_frozen {
                        motion_warn_lines.push(
                            "PRE-CUT FREEZE WARNING: The reference is STILL actively moving in the final 0.35s before the cut (`preCutActive=true`), but your rendered tail froze nearly dead-still (delta < 0.15)! Keep motion/parallax/ribbons/elements moving smoothly all the way to `t = dur` to avoid a jarring seam pop."
                                .to_string(),
                        );
                    }
                    // M3: Run lightweight 30fps optical-flow motion gate on every error-free
                    // filmstrip render so no post-fix or late edit can slip past unchecked as
                    // false-clean (`motion_flow_deficit = false`) when static SSIM looks high.
                    let mut motion_flow_deficit = false;
                    let mut motion_flow_json: Option<Value> = None;
                    let mut feedback = feedback;
                    if should_run_motion_flow_gate(ctx.use_filmstrip, res.runtime_errors.len()) {
                        if let Some(gate) = crate::studio::motion_gate::run_scene_motion_flow_gate(
                            ctx.workspace_dir,
                            ctx.ws_root,
                            ctx.scene_id,
                            ctx.safe_iso_lo,
                            ctx.safe_iso_hi,
                            ctx.film_duration,
                            ctx.fps,
                            ctx.secondary_motion,
                        )
                        .await
                        {
                            crate::paths::log_engine(
                                "direct_remake",
                                &format!(
                                    "Scene {} ({}) 30fps motion gate ({}ms): fastShare={:.2}/{:.2} p97Ratio={:.2} dup={} snap={} class={} deficit={}",
                                    ctx.scene_num,
                                    ctx.scene_id,
                                    gate.elapsed_ms,
                                    gate.fast_share_res,
                                    gate.fast_share_ref,
                                    gate.p97_ratio,
                                    gate.duplicate_pair_count,
                                    gate.velocity_snap_count,
                                    gate.failure_class,
                                    gate.deficit
                                ),
                            );
                            motion_flow_deficit = gate.deficit;
                            motion_flow_json = Some(json!({
                                "fastShareRef": gate.fast_share_ref,
                                "fastShareRes": gate.fast_share_res,
                                "p97Ratio": gate.p97_ratio,
                                "duplicatePairCount": gate.duplicate_pair_count,
                                "velocitySnapCount": gate.velocity_snap_count,
                                "failureClass": gate.failure_class,
                                "deficit": gate.deficit,
                                "elapsedMs": gate.elapsed_ms,
                            }));
                            if let Some(warn) = gate.warning {
                                motion_warn_lines.push(warn.clone());
                                if !feedback.is_empty() {
                                    feedback.push('\n');
                                }
                                feedback.push_str(&warn);
                            }
                        }
                    }
                    let caption = Some(if motion_warn_lines.is_empty() {
                        format!(
                            "Visual render comparison for Scene {} (`Row 1 = REFERENCE | Row 2 = YOUR RENDER | Row 3 = DIFF HEATMAP`{}). Measured overall={:.3}, runtimeErrors={}.",
                            ctx.scene_num,
                            if imgs.len() > 1 { " + motion strip / full-res frame" } else { "" },
                            score,
                            res.runtime_errors.len()
                        )
                    } else {
                        format!(
                            "Visual render comparison for Scene {} (`Row 1 = REFERENCE | Row 2 = YOUR RENDER | Row 3 = DIFF HEATMAP`{}). Measured overall={:.3}, runtimeErrors={}.\n{}",
                            ctx.scene_num,
                            if imgs.len() > 1 { " + motion strip / full-res frame" } else { "" },
                            score,
                            res.runtime_errors.len(),
                            motion_warn_lines.join("\n")
                        )
                    });
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
                    let min_frame_score = res
                        .reference_comparison
                        .as_ref()
                        .and_then(|c| {
                            c.get("overallMin").and_then(Value::as_f64).or_else(|| {
                                c.get("perFrame").and_then(Value::as_array).and_then(|arr| {
                                    arr.iter()
                                        .filter_map(|f| f.get("combinedScore").and_then(Value::as_f64))
                                        .reduce(f64::min)
                                })
                            })
                        })
                        .unwrap_or(score);
                    let has_structural_diagnosis = res
                        .reference_comparison
                        .as_ref()
                        .and_then(|c| c.get("perFrame"))
                        .and_then(Value::as_array)
                        .is_some_and(|arr| {
                            arr.iter().any(|f| {
                                f.get("structuralDiagnosis")
                                    .and_then(Value::as_str)
                                    .is_some_and(|d| !d.trim().is_empty())
                            })
                        });
                    let mut rj = json!({
                        "ok": true,
                        "overallFidelity": (score * 1000.0).round() / 1000.0,
                        "edgeMatchMean": (edge_mean * 1000.0).round() / 1000.0,
                        "minFrameScore": (min_frame_score * 1000.0).round() / 1000.0,
                        "hasStructuralDiagnosis": has_structural_diagnosis,
                        "runtimeErrors": res.runtime_errors,
                        "diagnostics": feedback,
                        "canvas": format!("{}x{}", ctx.width, ctx.height),
                        "filmRoot": ctx.film_root.file_name().and_then(|s| s.to_str()).unwrap_or("")
                    });
                    if let Some(mc) = motion_check {
                        rj["motionCheck"] = mc;
                    }
                    if let Some(mfg) = motion_flow_json {
                        rj["motionFlowGate"] = mfg;
                    }
                    SceneToolOutcome {
                        result_json: rj,
                        vision_images: imgs,
                        vision_caption: caption,
                        script_modified: false,
                        rendered_score: Some(score),
                        rendered_metrics: Some(RenderedMetrics {
                            overall: score,
                            ssim: ssim_mean,
                            color: color_mean,
                            edge: edge_mean,
                            min_frame_score,
                            has_structural_diagnosis,
                            motion_flow_deficit,
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
                        min_frame_score: 0.0,
                        has_structural_diagnosis: true,
                        motion_flow_deficit: false,
                    }),
                    rendered_errors: Some(vec![err]),
                },
            }
        }
        "read_filmstrip" => {
            let mut val = crate::tool::ref_filmstrip::execute_read_filmstrip(ctx.workspace_dir, args);
            let mut imgs = Vec::new();
            let mut cap = None;
            if let Some(obj) = val.as_object_mut() {
                if let Some(Value::Array(arr)) = obj.remove("_vision_images") {
                    for u in arr {
                        if let Some(s) = u.as_str() {
                            imgs.push(s.to_string());
                        }
                    }
                }
                if let Some(Value::Array(lbls)) = obj.remove("_vision_image_labels") {
                    let strs: Vec<&str> = lbls.iter().filter_map(Value::as_str).collect();
                    if !strs.is_empty() {
                        cap = Some(strs.join("\n"));
                    }
                }
            }
            SceneToolOutcome {
                result_json: val,
                vision_images: imgs,
                vision_caption: cap,
                script_modified: false,
                rendered_score: None,
                rendered_metrics: None,
                rendered_errors: None,
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

    #[test]
    fn trivial_static_placeholder_check_blocks_solid_stubs_but_allows_real_animated_scripts() {
        let s4_placeholder = "// scene4 placeholder to enable inspection and comparison tools\n(function () {\n  var AM = window.AM;\n  AM.registerScene(\"scene4_cta\", function (ctx, t, dur, scene, AM) {\n    ctx.fillStyle = \"#93632F\";\n    ctx.fillRect(0, 0, scene.width, scene.height);\n  });\n})();\n";
        assert!(is_trivial_static_placeholder(s4_placeholder));

        let s1_stub = "// VISUAL PLAN:\n// Phase 1..3\n(function () {\n  var AM = window.AM;\n  AM.registerScene(\"scene1_hook\", function (ctx, t, dur, scene, AM) {\n    var W = 720, H = 1280;\n    ctx.fillStyle = \"#0C0804\";\n    ctx.fillRect(0, 0, W, H);\n  });\n})();\n";
        assert!(is_trivial_static_placeholder(s1_stub));

        let real_compact = "(function () {\n  var AM = window.AM;\n  AM.registerScene(\"scene1_unit\", function (ctx, t, dur, scene, AM) {\n    var p = AM.ease.outCubic(AM.clamp(t / Math.max(0.2, dur), 0, 1));\n    ctx.fillStyle = '#14161A';\n    ctx.fillRect(0, 0, 640, 360);\n    ctx.fillStyle = '#F58C28';\n    ctx.fillRect(140 + 40 * p, 95, 220, 150);\n  });\n})();\n";
        assert!(!is_trivial_static_placeholder(real_compact));

        let rollback_broken = "(function(){ var AM=window.AM; AM.registerScene(\"scene1_unit\", function(ctx,t){ throw new Error('intentional_regression'); }); })();\n";
        assert!(!is_trivial_static_placeholder(rollback_broken));
    }

    #[test]
    fn scene_tool_definitions_keep_bash_active_by_default_and_respect_opt_out() {
        let filmstrip_no_bash = build_scene_tool_definitions_with_options(true, false);
        let names_no_bash: Vec<&str> = filmstrip_no_bash
            .iter()
            .filter_map(|d| d.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert!(!names_no_bash.contains(&"bash"));
        assert!(names_no_bash.contains(&"read_filmstrip"));
        assert!(names_no_bash.contains(&"inspect_ref_frame"));

        let filmstrip_default = build_scene_tool_definitions_with_filmstrip(true);
        let names_default: Vec<&str> = filmstrip_default
            .iter()
            .filter_map(|d| d.pointer("/function/name").and_then(Value::as_str))
            .collect();
        assert!(names_default.contains(&"bash"));
        assert!(names_default.contains(&"read_filmstrip"));
    }

    #[test]
    fn motion_flow_gate_runs_on_every_error_free_filmstrip_render() {
        assert!(should_run_motion_flow_gate(true, 0));
        assert!(!should_run_motion_flow_gate(true, 1));
        assert!(!should_run_motion_flow_gate(false, 0));
    }
}
