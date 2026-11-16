//! Visual Preview Screenshot Tool for HTML5/JS Motion Films.
//! Captures screenshots of `index.html` at requested timestamps using headless Chromium/Edge CDP
//! (no FFmpeg required) and attaches them to vision context for visual self-verification.

use serde_json::{json, Value};

pub fn capture_film_preview_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "capture_film_preview",
            "description": "Captures visual screenshots of the active project's index.html film at specified timestamps (or reference-aligned keyframes) using headless Edge/Chrome, attaches them to vision context, and when reference frames exist in ref/ (or compareToReference=true), computes quantitative RGB SSIM + color/edge similarity and generates a side-by-side comparison_strip.jpg.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timestamps": {
                        "type": "array",
                        "items": { "type": "number" },
                        "description": "Optional playback timestamps in seconds to capture (e.g. [0.5, 3.0]). Defaults to reference scene keyframes or [10%, 35%, 60%, 85%] of duration."
                    },
                    "compareToReference": {
                        "type": "boolean",
                        "description": "Whether to compute RGB SSIM, color/edge similarity, and side-by-side comparison strip against extracted ref/ keyframes. Auto-enabled and mandatory whenever ref/ frames exist (false is overridden when ref/ frames are present)."
                    },
                    "passThreshold": {
                        "type": "number",
                        "description": "Optional fidelity score pass threshold (0.0..1.0, default 0.72)."
                    }
                }
            }
        }
    })
}

pub async fn execute_capture_film_preview(workspace_dir: &str, arguments: &Value) -> Value {
    let timestamps: Vec<f64> = arguments
        .get("timestamps")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    let compare_to_reference = arguments
        .get("compareToReference")
        .and_then(|v| v.as_bool());
    let pass_threshold = arguments
        .get("passThreshold")
        .and_then(|v| v.as_f64());

    match crate::studio::preview_capture::capture_film_preview_with_options(
        workspace_dir,
        timestamps,
        compare_to_reference,
        pass_threshold,
    )
    .await
    {
        Ok(res) => {
            let captured: Vec<Value> = res
                .frames
                .iter()
                .map(|f| {
                    json!({
                        "timestamp": f.timestamp,
                        "relativeRatio": f.relative_ratio,
                        "path": f.saved_rel_path
                    })
                })
                .collect();
            let mut vision_images: Vec<Value> = Vec::new();
            if let Some(strip_url) = res.comparison_strip_data_url {
                vision_images.push(Value::String(strip_url));
            }
            for f in &res.frames {
                vision_images.push(Value::String(f.data_url.clone()));
            }
            let unchanged_warning = if res.changed_since_last_capture == Some(false) {
                Some("WARNING: Captured frames are byte-identical to the previous preview capture. No code/visual change took effect — check whether recent edit calls failed or target different elements.")
            } else {
                None
            };
            let ref_override_note = if res.compare_to_reference_overridden {
                Some("compareToReference=false was overridden because ref/ keyframes exist for this project.")
            } else {
                None
            };
            let summary_extra = match &res.reference_comparison {
                Some(cmp) if cmp.get("ok").and_then(Value::as_bool) == Some(true) => format!(
                    " Reference comparison: RGB SSIM mean={}, color={}, edge={}, overall={}, passed={}. Inspect side-by-side strip + frames and refine any low-scoring scenes.",
                    cmp.get("ssimMean").and_then(Value::as_f64).unwrap_or(0.0),
                    cmp.get("colorMatchMean").and_then(Value::as_f64).unwrap_or(0.0),
                    cmp.get("edgeMatchMean").and_then(Value::as_f64).unwrap_or(0.0),
                    cmp.get("overallFidelity").and_then(Value::as_f64).unwrap_or(0.0),
                    cmp.get("passed").and_then(Value::as_bool).unwrap_or(false),
                ),
                _ => String::new(),
            };
            let extra_notices: String = [unchanged_warning, ref_override_note]
                .into_iter()
                .flatten()
                .map(|s| format!(" {}", s))
                .collect();
            json!({
                "ok": true,
                "width": res.width,
                "height": res.height,
                "duration": res.duration,
                "fps": res.fps,
                "changedSinceLastCapture": res.changed_since_last_capture,
                "compareToReferenceOverridden": res.compare_to_reference_overridden,
                "unchangedWarning": unchanged_warning,
                "compareToReferenceNote": ref_override_note,
                "captured": captured,
                "runtimeErrors": res.runtime_errors,
                "referenceComparison": res.reference_comparison,
                "output": format!(
                    "Captured {} visual preview frame(s) ({}x{} @ {}fps).{}{} Attached screenshots to vision context.",
                    res.frames.len(),
                    res.width,
                    res.height,
                    res.fps,
                    summary_extra,
                    extra_notices
                ),
                "_vision_images": vision_images
            })
        }
        Err(err) => json!({
            "ok": false,
            "error": err
        }),
    }
}
