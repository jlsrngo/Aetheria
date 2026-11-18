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
                        "description": "Optional fidelity score pass threshold (0.0..1.0). Use default 0.85 for exact 1:1 clones, or 0.65 when adapting a reference style/motion to a new brand or custom copy."
                    }
                }
            }
        }
    })
}

pub async fn execute_capture_film_preview(workspace_dir: &str, arguments: &Value) -> Value {
    let mut timestamps: Vec<f64> = arguments
        .get("timestamps")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    if timestamps.is_empty() {
        let target_scenes: Vec<usize> = arguments
            .get("targetSceneIndices")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_u64().map(|n| n as usize))
                    .filter(|&n| (1..=24).contains(&n))
                    .collect()
            })
            .unwrap_or_default();
        if !target_scenes.is_empty() {
            if let Some(html_path) = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir)) {
                if let Some(film_root) = html_path.parent() {
                    let ws_root = if workspace_dir.trim().is_empty() {
                        film_root.to_path_buf()
                    } else {
                        std::path::PathBuf::from(workspace_dir)
                    };
                    let meta = crate::studio::film_inspector::inspect_workspace_film(&html_path);
                    timestamps = crate::studio::reference_compare::recommended_reference_timestamps_for_film_scenes(
                        &ws_root,
                        film_root,
                        meta.duration,
                        &target_scenes,
                        12,
                    );
                }
            }
        }
    }
    let compare_to_reference = arguments
        .get("compareToReference")
        .and_then(|v| v.as_bool());
    let pass_threshold = arguments
        .get("passThreshold")
        .and_then(|v| v.as_f64())
        .map(|t| t.clamp(0.65, 0.99));

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
                // Attach ONLY the unified side-by-side comparison strip (Ref | Preview | Diff Heatmap)
                // instead of duplicating 12 raw preview frames that flood vision context on multi-pass polish.
                vision_images.push(Value::String(strip_url));
                if let Some(beat_strip_path) = res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("primarySceneBeatStripPath"))
                    .and_then(Value::as_str)
                {
                    if let Ok(bytes) = std::fs::read(beat_strip_path) {
                        if !bytes.is_empty() {
                            use base64::prelude::*;
                            vision_images.push(Value::String(format!(
                                "data:image/jpeg;base64,{}",
                                BASE64_STANDARD.encode(&bytes)
                            )));
                        }
                    }
                }
            } else {
                for f in &res.frames {
                    vision_images.push(Value::String(f.data_url.clone()));
                }
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
            let regressed = res
                .reference_comparison
                .as_ref()
                .and_then(|c| c.get("regressedFromPrevious").and_then(Value::as_bool))
                == Some(true);
            let target_worst_desc: Option<String> = res
                .reference_comparison
                .as_ref()
                .and_then(|c| c.get("targetWorstScenes").and_then(Value::as_array))
                .filter(|arr| !arr.is_empty())
                .map(|arr| {
                    arr.iter()
                        .map(|item| {
                            let sid = item.get("sceneId").and_then(Value::as_str).unwrap_or("scene");
                            let sc = item.get("script").and_then(Value::as_str).unwrap_or("script/scene*.js");
                            let ts = item.get("timestamp").and_then(Value::as_f64).unwrap_or(0.0);
                            let comb = item.get("combinedScore").and_then(Value::as_f64).unwrap_or(0.0);
                            let edge = item.get("edgeSimilarity").and_then(Value::as_f64).unwrap_or(0.0);
                            let diag = item.get("diagnosis").and_then(Value::as_str).unwrap_or("");
                            if diag.is_empty() {
                                format!("{sid} ({sc} @ t={ts:.2}s, comb={comb:.3}, edge={edge:.3})")
                            } else {
                                format!("{sid} ({sc} @ t={ts:.2}s, comb={comb:.3}, edge={edge:.3}: {diag})")
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("; ")
                });

            let summary_extra = match &res.reference_comparison {
                Some(cmp) if cmp.get("ok").and_then(Value::as_bool) == Some(true) => {
                    let worst_note = target_worst_desc
                        .as_ref()
                        .map(|w| format!(" Target worst scenes: {w}."))
                        .unwrap_or_default();
                    let reg_note = if regressed {
                        let prev = cmp.get("previousOverall").and_then(Value::as_f64).unwrap_or(0.0);
                        let cur = cmp.get("overallFidelity").and_then(Value::as_f64).unwrap_or(0.0);
                        format!(" REGRESSION DETECTED ({prev:.3} -> {cur:.3}): revert ineffective patch before continuing.")
                    } else {
                        String::new()
                    };
                    let rollback_note = cmp
                        .get("autoRolledBackScenes")
                        .and_then(Value::as_array)
                        .filter(|a| !a.is_empty())
                        .map(|arr| {
                            let names: Vec<String> = arr
                                .iter()
                                .filter_map(|x| x.get("script").and_then(Value::as_str).map(str::to_string))
                                .collect();
                            format!(" AUTO-ROLLBACK RESTORED best snapshot for {:?} after score regression.", names)
                        })
                        .unwrap_or_default();
                    format!(
                        " Reference comparison: RGB SSIM mean={}, color={}, edge={}, overall={}, passed={}. Inspect side-by-side strip + frames.{}{}{}",
                        cmp.get("ssimMean").and_then(Value::as_f64).unwrap_or(0.0),
                        cmp.get("colorMatchMean").and_then(Value::as_f64).unwrap_or(0.0),
                        cmp.get("edgeMatchMean").and_then(Value::as_f64).unwrap_or(0.0),
                        cmp.get("overallFidelity").and_then(Value::as_f64).unwrap_or(0.0),
                        cmp.get("passed").and_then(Value::as_bool).unwrap_or(false),
                        worst_note,
                        reg_note,
                        rollback_note,
                    )
                }
                _ => String::new(),
            };
            let extra_notices: String = [unchanged_warning, ref_override_note]
                .into_iter()
                .flatten()
                .map(|s| format!(" {}", s))
                .collect();
            let has_runtime_errors = !res.runtime_errors.is_empty();
            let ref_exec_failed = res
                .reference_comparison
                .as_ref()
                .and_then(|c| c.get("ok").and_then(Value::as_bool))
                == Some(false);
            let ref_threshold_failed = res
                .reference_comparison
                .as_ref()
                .and_then(|c| c.get("passed").and_then(Value::as_bool))
                == Some(false);
            let ref_ar_mismatch = res
                .reference_comparison
                .as_ref()
                .and_then(|c| c.get("aspectRatioMismatch").and_then(Value::as_bool))
                == Some(true);
            let anti_cheat_failed = !res.anti_cheat.passed;
            let preview_ok = !has_runtime_errors
                && !ref_exec_failed
                && !ref_threshold_failed
                && !ref_ar_mismatch
                && !anti_cheat_failed;

            let mut failure_reasons = Vec::new();
            if has_runtime_errors {
                failure_reasons.push(format!(
                    "Film runtime errors detected: {}",
                    res.runtime_errors.join(" | ")
                ));
            }
            if ref_exec_failed {
                let ref_err = res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("error").and_then(Value::as_str))
                    .unwrap_or("Reference comparison failed.");
                failure_reasons.push(format!("Reference comparison failed: {}", ref_err));
            }
            if ref_ar_mismatch {
                failure_reasons.push(
                    "Aspect ratio mismatch between generated preview and reference keyframes (> 2% tolerance)."
                        .to_string(),
                );
            }
            if ref_threshold_failed {
                let overall = res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("overallFidelity").and_then(Value::as_f64))
                    .unwrap_or(0.0);
                let ssim_mean = res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("ssimMean").and_then(Value::as_f64))
                    .unwrap_or(0.0);
                let thr = res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("passThreshold").and_then(Value::as_f64))
                    .unwrap_or(0.85);
                failure_reasons.push(format!(
                    "Visual fidelity below threshold (overall={overall:.3}, ssimMean={ssim_mean:.3}, required passThreshold={thr:.2}). Inspect comparison_strip.jpg and fix worstFrames before finishing."
                ));
            }
            if anti_cheat_failed {
                failure_reasons.push(format!(
                    "Anti-cheat constraint failed: {}",
                    res.anti_cheat.violations.join(" | ")
                ));
            }

            let runtime_note = if has_runtime_errors {
                format!(
                    " Runtime errors detected ({} error(s)); fix script errors before finishing.",
                    res.runtime_errors.len()
                )
            } else {
                String::new()
            };
            let mut result = json!({
                "ok": preview_ok,
                "fidelityFailed": ref_threshold_failed || ref_ar_mismatch,
                "antiCheat": res.anti_cheat,
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
                    "Captured {} visual preview frame(s) ({}x{} @ {}fps).{}{}{} Attached screenshots to vision context.",
                    res.frames.len(),
                    res.width,
                    res.height,
                    res.fps,
                    summary_extra,
                    extra_notices,
                    runtime_note
                ),
                "_vision_images": vision_images
            });
            if !failure_reasons.is_empty() {
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("error".to_string(), json!(failure_reasons.join(" | ")));
                }
            }
            if ref_threshold_failed || regressed || ref_ar_mismatch {
                if let Some(obj) = result.as_object_mut() {
                    obj.insert(
                        "refinementGuidance".to_string(),
                        json!({
                            "regressedFromPrevious": regressed,
                            "targetWorstScenes": res
                                .reference_comparison
                                .as_ref()
                                .and_then(|c| c.get("targetWorstScenes"))
                                .cloned()
                                .unwrap_or_else(|| json!([])),
                            "summary": target_worst_desc.clone().unwrap_or_else(|| "Inspect worstFrames and comparison_strip.jpg".to_string()),
                        }),
                    );
                }
            }
            if let Some((_, progress)) = super::film_state::collect_active_film_scene_progress(workspace_dir) {
                result["sceneProgress"] = progress.to_json();
                let unfinished = progress.unfinished_scenes();
                if !unfinished.is_empty() {
                    let list: Vec<String> = unfinished
                        .iter()
                        .map(|(id, sc, st)| format!("{} ({} = {})", id, sc, st))
                        .collect();
                    let note = format!(
                        " Unfinished scenes remain on disk: {}. Implement every stub/missing scene and re-run capture_film_preview before finishing.",
                        list.join(", ")
                    );
                    if let Some(prev_out) = result.get("output").and_then(Value::as_str).map(str::to_string) {
                        result["output"] = json!(format!("{}{}", prev_out, note));
                    }
                }
            }
            result
        }
        Err(err) => json!({
            "ok": false,
            "error": err
        }),
    }
}
