//! Visual Preview Screenshot Tool for HTML5/JS Motion Films.
//! Captures screenshots of `index.html` at requested timestamps using headless Chromium/Edge CDP
//! (no FFmpeg required) and attaches them to vision context for visual self-verification.

use serde_json::{json, Value};

pub fn capture_film_preview_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "capture_film_preview",
            "description": "Captures visual screenshots of the active project's index.html film at specified timestamps using headless Edge/Chrome and attaches them to vision context. Standalone/hybrid HTML films default to attaching full-resolution frames directly without SSIM gating when compareToReference is omitted; passing compareToReference=true on standalone/hybrid films attaches an advisory comparison_strip.jpg without hard-failing unless passThreshold is explicitly set.",
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
                        "description": "Set true to compute RGB SSIM, color/edge similarity, and side-by-side comparison strip against extracted ref/ keyframes. Auto-enabled on modular scene scripts when ref/ frames exist; advisory/non-blocking on standalone/hybrid HTML films unless passThreshold is also passed."
                    },
                    "passThreshold": {
                        "type": "number",
                        "description": "Optional fidelity score pass threshold (0.0..1.0). Use default 0.85 for exact 1:1 clones, or 0.65 when adapting a reference style/motion to a new brand or custom copy."
                    },
                    "visualInspectOnly": {
                        "type": "boolean",
                        "description": "Optional override for Playwright-parity visual frame inspection without quantitative SSIM failure or auto-rollback (automatically true on standalone/hybrid index.html when compareToReference is omitted)."
                    },
                    "includeFullResFrames": {
                        "type": "boolean",
                        "description": "Optional flag to attach every captured full-resolution .aetheria/preview/preview_*.jpg image to vision context even when a comparison strip is also produced (defaults to true in visual inspection mode)."
                    },
                    "motionStrip": {
                        "type": "object",
                        "description": "Optional chronological 10-frame REF-vs-RENDER motion verification strip across a scene or time span (detects frozen/stiff animations automatically).",
                        "properties": {
                            "sceneIndex": { "type": "integer", "description": "Optional 1-based scene number from filmstrip_index.json / style.json." },
                            "startSec": { "type": "number", "description": "Optional start timestamp in seconds." },
                            "endSec": { "type": "number", "description": "Optional end timestamp in seconds." },
                            "frames": { "type": "integer", "description": "Optional sample frame count (`4..10`, default `10`)." }
                        }
                    }
                }
            }
        }
    })
}

fn build_preview_vision_images_with_labels(
    frames: &[crate::studio::preview_capture::PreviewFrameCapture],
    comparison_strip_data_url: Option<String>,
    comparison_strip_label: Option<&str>,
    reference_comparison: Option<&Value>,
    story_contact_sheet_data_url: Option<String>,
    include_full_res_frames: bool,
) -> (Vec<Value>, Vec<Value>) {
    let mut vision_images: Vec<Value> = Vec::new();
    let mut vision_labels: Vec<Value> = Vec::new();
    let mut attached_full_res = false;
    if let Some(strip_url) = comparison_strip_data_url {
        // Attach the unified side-by-side comparison strip (Ref | Preview | Diff Heatmap)
        // or chronological REF-vs-RENDER motion strip cleanly.
        vision_images.push(Value::String(strip_url));
        vision_labels.push(json!(comparison_strip_label.unwrap_or("comparison_strip.jpg (Ref | Preview | Diff Heatmap)")));
        if let Some(beat_strip_path) = reference_comparison
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
                    vision_labels.push(json!("primarySceneBeatStrip (beat-by-beat comparison)"));
                }
            }
        }
    } else if let Some(sheet_url) = story_contact_sheet_data_url {
        vision_images.push(Value::String(sheet_url));
        vision_labels.push(json!("story_contact_sheet.jpg"));
    } else {
        for f in frames {
            vision_images.push(Value::String(f.data_url.clone()));
            vision_labels.push(json!(format!("{} @ t={:.2}s", f.saved_rel_path, f.timestamp)));
        }
        attached_full_res = true;
    }
    if include_full_res_frames && !attached_full_res {
        for f in frames {
            vision_images.push(Value::String(f.data_url.clone()));
            vision_labels.push(json!(format!("{} @ t={:.2}s", f.saved_rel_path, f.timestamp)));
        }
    }
    (vision_images, vision_labels)
}

#[allow(dead_code)] // Retained for backward-compatible unit tests while runtime uses `build_preview_vision_images_with_labels`.
fn build_preview_vision_images(
    frames: &[crate::studio::preview_capture::PreviewFrameCapture],
    comparison_strip_data_url: Option<String>,
    reference_comparison: Option<&Value>,
    story_contact_sheet_data_url: Option<String>,
    include_full_res_frames: bool,
) -> Vec<Value> {
    build_preview_vision_images_with_labels(
        frames,
        comparison_strip_data_url,
        None,
        reference_comparison,
        story_contact_sheet_data_url,
        include_full_res_frames,
    )
    .0
}

pub async fn execute_capture_film_preview(workspace_dir: &str, arguments: &Value) -> Value {
    let mut timestamps: Vec<f64> = arguments
        .get("timestamps")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    let mut motion_strip_req = arguments.get("motionStrip").and_then(Value::as_object);
    if timestamps.is_empty() {
        if let Some(ms) = motion_strip_req {
            let mut s0 = ms.get("startSec").and_then(Value::as_f64);
            let mut s1 = ms.get("endSec").and_then(Value::as_f64);
            let sc_idx = ms.get("sceneIndex").and_then(Value::as_u64).map(|n| n as usize);
            let film_meta_opt = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir))
                .map(|hp| (hp.clone(), crate::studio::film_inspector::inspect_workspace_film(&hp)));
            if s0.is_none() || s1.is_none() {
                if let Some(idx_1based) = sc_idx {
                    if let Some((ref hp, ref meta)) = film_meta_opt {
                        if let Some(sc) = meta.scenes.get(idx_1based.saturating_sub(1)) {
                            s0 = s0.or(Some(sc.start));
                            s1 = s1.or(Some(sc.start + sc.duration));
                        } else if let Some(fr) = hp.parent() {
                            let st_p = std::path::Path::new(workspace_dir).join("ref").join("extracted").join("style.json");
                            let st_p2 = fr.join("ref").join("extracted").join("style.json");
                            let chosen = if st_p.is_file() { st_p } else { st_p2 };
                            if let Ok(raw) = std::fs::read_to_string(chosen) {
                                if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                                    if let Some(sc) = v.get("scenes").and_then(Value::as_array).and_then(|arr| arr.get(idx_1based.saturating_sub(1))) {
                                        s0 = s0.or(sc.get("start").and_then(Value::as_f64));
                                        s1 = s1.or(sc.get("end").and_then(Value::as_f64));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let total_d = film_meta_opt.as_ref().map(|(_, m)| m.duration).unwrap_or(5.0).max(0.5);
            let start_sec = s0.unwrap_or(0.0).clamp(0.0, (total_d - 0.1).max(0.0));
            let end_sec = s1.unwrap_or((start_sec + 3.0).min(total_d)).clamp(start_sec + 0.08, total_d);
            let n = ms.get("frames").and_then(Value::as_u64).unwrap_or(10).clamp(4, 10) as usize;
            let max_end = (end_sec - 0.03).max(start_sec);
            for i in 0..n {
                let ratio = if n <= 1 { 0.0 } else { i as f64 / (n - 1) as f64 };
                timestamps.push(((start_sec + (max_end - start_sec) * ratio) * 1000.0).round() / 1000.0);
            }
        }
    } else if motion_strip_req.is_none() && arguments.get("motionStrip").and_then(Value::as_bool) == Some(true) {
        motion_strip_req = None;
    }
    let build_motion_strip = motion_strip_req.is_some()
        || arguments.get("motionStrip").and_then(Value::as_bool) == Some(true);
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
    let visual_inspect_only = arguments
        .get("visualInspectOnly")
        .and_then(|v| v.as_bool());
    let include_full_res_frames = arguments
        .get("includeFullResFrames")
        .and_then(|v| v.as_bool());

    match crate::studio::preview_capture::capture_film_preview_with_full_options(
        workspace_dir,
        timestamps,
        crate::studio::preview_capture::PreviewCaptureOptions {
            compare_to_reference,
            pass_threshold,
            visual_inspect_only,
            include_full_res_frames,
            disable_auto_rollback: false,
        },
    )
    .await
    {
        Ok(mut res) => {
            let mut motion_check_val: Option<Value> = None;
            let mut custom_strip_label: Option<&str> = None;
            if !res.frames.is_empty() && (build_motion_strip || res.comparison_strip_data_url.is_none()) {
                let ws_root = std::path::Path::new(workspace_dir);
                let ref_vid = super::ref_probe::locate_reference_video(ws_root, None).or_else(|| {
                    crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir))
                        .and_then(|hp| hp.parent().map(std::path::Path::to_path_buf))
                        .and_then(|fr| super::ref_probe::locate_reference_video(&fr, None))
                });
                if let Some(video_path) = ref_vid {
                    if build_motion_strip {
                        if let Some(mut ms_val) = super::ref_probe::build_visual_ref_vs_preview_motion_strip(
                            ws_root,
                            &video_path,
                            &res.frames,
                            "motion_strip.jpg",
                        )
                        .await
                        {
                            if let Some(ms_url) = ms_val
                                .as_object_mut()
                                .and_then(|o| o.remove("dataUrl"))
                                .and_then(|v| v.as_str().map(str::to_string))
                            {
                                res.comparison_strip_data_url = Some(ms_url);
                                custom_strip_label = Some(
                                    "motion_strip.jpg (TOP: REF | BOTTOM: RND + frame step deltas)",
                                );
                            }
                            motion_check_val = Some(ms_val);
                        }
                    } else if res.comparison_strip_data_url.is_none() {
                        if let Some(strip_url) = super::ref_probe::build_visual_ref_vs_preview_strip(
                            ws_root,
                            &video_path,
                            &res.frames,
                        )
                        .await
                        {
                            res.comparison_strip_data_url = Some(strip_url);
                        }
                    }
                }
            }
            let attach_full_res = if res.comparison_strip_data_url.is_some() {
                include_full_res_frames.unwrap_or(false)
            } else {
                include_full_res_frames.unwrap_or(res.visual_inspect_only)
            };
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
            let (vision_images, vision_labels) = build_preview_vision_images_with_labels(
                &res.frames,
                res.comparison_strip_data_url.clone(),
                custom_strip_label,
                res.reference_comparison.as_ref(),
                res.story_contact_sheet_data_url.clone(),
                attach_full_res,
            );
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
            let motion_warning_owned = motion_check_val
                .as_ref()
                .and_then(|v| v.get("motionWarning").and_then(Value::as_str))
                .map(str::to_string);
            let extra_notices: String = [
                unchanged_warning,
                ref_override_note,
                res.identical_frames_warning.as_deref(),
                motion_warning_owned.as_deref(),
            ]
                .into_iter()
                .flatten()
                .map(|s| format!(" {}", s))
                .collect();
            let has_runtime_errors = !res.runtime_errors.is_empty();
            // Standalone/hybrid HTML films (e.g. re-themed showreels) treat `compareToReference: true`
            // as advisory visual diagnostics unless the caller explicitly sets `passThreshold`.
            let enforce_ref = !res.visual_inspect_only
                && (!res.is_hybrid_or_standalone || pass_threshold.is_some());
            let ref_exec_failed = enforce_ref
                && res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("ok").and_then(Value::as_bool))
                    == Some(false);
            let ref_threshold_failed = enforce_ref
                && res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("passed").and_then(Value::as_bool))
                    == Some(false);
            let ref_ar_mismatch = enforce_ref
                && res
                    .reference_comparison
                    .as_ref()
                    .and_then(|c| c.get("aspectRatioMismatch").and_then(Value::as_bool))
                    == Some(true);
            let anti_cheat_failed = !res.anti_cheat.passed;
            let story_lint_failed = res
                .story_qa
                .as_ref()
                .and_then(|q| q.get("lintValid").and_then(Value::as_bool))
                == Some(false);
            let story_failed_shots: Vec<String> = res
                .story_qa
                .as_ref()
                .and_then(|q| q.get("failedShots").and_then(Value::as_array))
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let story_framing_failed = !story_failed_shots.is_empty();
            let preview_ok = !has_runtime_errors
                && !ref_exec_failed
                && !ref_threshold_failed
                && !ref_ar_mismatch
                && !anti_cheat_failed
                && !story_lint_failed
                && !story_framing_failed;

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
            if story_lint_failed {
                failure_reasons.push(
                    "story.json pre-render lint failed (see storyQa.lintIssues). Fix in at most 1 edit pass."
                        .to_string(),
                );
            }
            if story_framing_failed {
                failure_reasons.push(format!(
                    "Story shot framing/error failed on {:?} (see storyQa.shotReport & contact_sheet.jpg). Perform at most 1 targeted correction pass for failed shots only.",
                    story_failed_shots
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
                "visualInspectOnly": res.visual_inspect_only,
                "reusedWarmBrowser": res.reused_warm_browser,
                "fidelityFailed": ref_threshold_failed || ref_ar_mismatch,
                "antiCheat": res.anti_cheat,
                "width": res.width,
                "height": res.height,
                "duration": res.duration,
                "fps": res.fps,
                "changedSinceLastCapture": res.changed_since_last_capture,
                "compareToReferenceOverridden": res.compare_to_reference_overridden,
                "unchangedWarning": unchanged_warning,
                "identicalFramesWarning": res.identical_frames_warning,
                "compareToReferenceNote": ref_override_note,
                "captured": captured,
                "runtimeErrors": res.runtime_errors,
                "referenceComparison": res.reference_comparison,
                "storyQa": res.story_qa,
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
                "_vision_images": vision_images,
                "_vision_image_labels": vision_labels
            });
            if let Some(mc) = motion_check_val {
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("motionCheck".to_string(), mc);
                }
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::preview_capture::PreviewFrameCapture;

    #[test]
    fn build_preview_vision_images_respects_include_full_res_frames() {
        let frames = vec![
            PreviewFrameCapture {
                timestamp: 0.5,
                relative_ratio: 0.25,
                saved_rel_path: ".aetheria/preview/preview_0.jpg".to_string(),
                data_url: "data:image/jpeg;base64,FRAME0".to_string(),
            },
            PreviewFrameCapture {
                timestamp: 1.5,
                relative_ratio: 0.75,
                saved_rel_path: ".aetheria/preview/preview_1.jpg".to_string(),
                data_url: "data:image/jpeg;base64,FRAME1".to_string(),
            },
        ];

        // Default comparison mode attaches only the comparison strip.
        let strip_only = build_preview_vision_images(
            &frames,
            Some("data:image/jpeg;base64,STRIP".to_string()),
            None,
            None,
            false,
        );
        assert_eq!(strip_only.len(), 1);
        assert_eq!(strip_only[0], "data:image/jpeg;base64,STRIP");

        // `includeFullResFrames: true` keeps the strip AND appends all full-res frames.
        let with_full = build_preview_vision_images(
            &frames,
            Some("data:image/jpeg;base64,STRIP".to_string()),
            None,
            None,
            true,
        );
        assert_eq!(with_full.len(), 3);
        assert_eq!(with_full[1], "data:image/jpeg;base64,FRAME0");
        assert_eq!(with_full[2], "data:image/jpeg;base64,FRAME1");

        // Visual inspect mode without strip attaches every frame without duplicating.
        let direct_frames = build_preview_vision_images(&frames, None, None, None, true);
        assert_eq!(direct_frames.len(), 2);
        assert_eq!(direct_frames[0], "data:image/jpeg;base64,FRAME0");
    }
}
