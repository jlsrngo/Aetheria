//! Direct Per-Scene Vision-First Reference Remake Compiler (No-Subagent Pipeline).
//!
//! Replaces multi-agent `Director -> Subagent motion-designer -> QA Verifier` bureaucracy
//! on multi-scene video reference remakes with a deterministic, zero-subagent 2-to-3-pass
//! per-scene loop:
//!   For each Scene K = 1..N:
//!     1. Pass 1 (Draft): 1 direct LLM vision call (no tools, no 18KB `default.txt`, no raw OCR
//!        noise) receiving ONLY Scene K's high-res beat strip (`ref_scene_0K_beats.jpg`) +
//!        3 full-res keyframes (`q1/mid/q3` or `start/mid/end`) + hard mathematical facts.
//!     2. Capture Scene K's keyframes -> builds 3-row visual comparison strip
//!        (`scene_0K_compare_6beats.jpg`: REF | PREV | DIFF) + local-time diagnostics.
//!     3. Pass 2 (Visual Self-Correction): 1 direct LLM vision call inspecting the 3-row
//!        comparison strip + local-time structural diagnostics + Pass 1 JS code -> writes refined code.
//!     4. Auto-Rollback Guard: re-captures Scene K; if Pass 2 introduces runtime errors or
//!        regresses `overallFidelity` (`< best - 0.004`), immediately restores `best_code`.
//!     5. Optional Pass 3 (Targeted Recovery / Polish): runs if `runtime_errors > 0` or
//!        `best_score < 0.72` (including recovering from a Pass 2 rollback without giving up).

use base64::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::paths::now_ms;
use crate::session::message::emit_event;

use super::direct_scene_prompt::{
    build_scene_hard_facts_prompt, detect_scene_collision_hazards, DIRECT_SCENE_SYSTEM_PROMPT,
};
use super::direct_scene_tools::{
    build_scene_tool_definitions, execute_scene_micro_tool, SceneToolContext,
};
use super::resilience::send_resilient_chat_completion_with_options;
use crate::tool::json_repair::parse_or_repair_tool_args;

#[derive(Debug, Clone)]
pub(crate) struct DirectSceneOutcome {
    pub scene_id: String,
    pub script_rel: String,
    pub passes_run: usize,
    pub best_score: f64,
    pub rolled_back: bool,
    pub runtime_errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct DirectRemakeSummary {
    pub scenes: Vec<DirectSceneOutcome>,
    pub final_comparison: Option<Value>,
    pub wall_ms: u64,
}

/// Checks whether the active turn should run the zero-subagent Direct Per-Scene Remake Compiler.
/// Triggered after `film_scaffold` creates a multi-scene (`>= 4` scenes) project matching an
/// extracted video reference (`ref/extracted/style.json`), unless `AETHERIA_REMAKE_MODE=subagent`.
pub(crate) fn should_run_direct_scene_remake(workspace_dir: &str) -> bool {
    if let Ok(mode) = std::env::var("AETHERIA_REMAKE_MODE") {
        let m = mode.trim().to_ascii_lowercase();
        if m == "subagent" || m == "legacy" || m == "off" {
            return false;
        }
    }
    let ws = Path::new(workspace_dir);
    let style_path = ws.join("ref").join("extracted").join("style.json");
    if !style_path.is_file() {
        return false;
    }
    let Some(html_path) = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir))
    else {
        return false;
    };
    let Some(film_root) = html_path.parent() else {
        return false;
    };
    let film_json_path = film_root.join("film.json");
    if !film_json_path.is_file() {
        return false;
    }
    let Ok(raw_film) = std::fs::read_to_string(&film_json_path) else {
        return false;
    };
    let Ok(film_val) = serde_json::from_str::<Value>(&raw_film) else {
        return false;
    };
    let Some(scenes) = film_val.get("scenes").and_then(Value::as_array) else {
        return false;
    };
    let force_direct = std::env::var("AETHERIA_REMAKE_MODE")
        .map(|v| v.trim().eq_ignore_ascii_case("direct"))
        .unwrap_or(false);
    if !force_direct && scenes.len() < 4 {
        return false;
    }
    // Only trigger when scene scripts are still scaffold stubs (not already authored).
    let mut stub_count = 0usize;
    for (idx, sc) in scenes.iter().enumerate() {
        let rel = sc
            .get("script")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("script/scene{}.js", idx + 1));
        let p = film_root.join(&rel);
        if !p.is_file() {
            stub_count += 1;
        } else if let Ok(txt) = std::fs::read_to_string(&p) {
            if crate::tool::film_state::is_scaffold_stub_content(&txt) {
                stub_count += 1;
            }
        }
    }
    stub_count * 2 >= scenes.len().max(1)
}

/// Extracts clean JavaScript source from a markdown-fenced or raw LLM response.
pub(crate) fn extract_js_code_block(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut best: Option<String> = None;
    let mut cursor = trimmed;
    while let Some(start_idx) = cursor.find("```") {
        let after_ticks = &cursor[start_idx + 3..];
        let Some(nl_idx) = after_ticks.find('\n') else {
            break;
        };
        let body = &after_ticks[nl_idx + 1..];
        let end_idx = body.find("```").unwrap_or(body.len());
        let candidate = body[..end_idx].trim();
        if !candidate.is_empty()
            && (candidate.contains("registerScene") || best.is_none())
            && best.as_ref().map(|b| candidate.len() > b.len()).unwrap_or(true)
        {
            best = Some(candidate.to_string());
        }
        if end_idx >= body.len() {
            break;
        }
        cursor = &body[end_idx + 3..];
    }
    if let Some(code) = best {
        return Some(format!("{}\n", code));
    }
    if trimmed.contains("registerScene") {
        return Some(format!("{}\n", trimmed));
    }
    None
}

fn encode_jpeg_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!(
        "data:image/jpeg;base64,{}",
        BASE64_STANDARD.encode(&bytes)
    ))
}

fn build_vision_user_message(text: String, image_data_urls: &[String]) -> Value {
    let mut parts = Vec::with_capacity(image_data_urls.len() + 1);
    for url in image_data_urls {
        parts.push(json!({
            "type": "image_url",
            "image_url": { "url": url }
        }));
    }
    parts.push(json!({ "type": "text", "text": text }));
    json!({
        "role": "user",
        "content": parts
    })
}

/// Collects the 6-panel storyboard strip plus 3 full-resolution keyframes spanning early -> mid -> late.
/// Short scenes without `_q1`/`_q3` automatically fall back to `_start`/`_end` so every scene gets 4 views.
fn collect_scene_pass1_images(ws_root: &Path, scene_num: usize) -> Vec<String> {
    let frames_dir = ws_root.join("ref").join("extracted").join("frames");
    let early = {
        let q1 = frames_dir.join(format!("ref_scene_{scene_num:02}_q1.jpg"));
        if q1.is_file() {
            q1
        } else {
            frames_dir.join(format!("ref_scene_{scene_num:02}_start.jpg"))
        }
    };
    let late = {
        let q3 = frames_dir.join(format!("ref_scene_{scene_num:02}_q3.jpg"));
        if q3.is_file() {
            q3
        } else {
            frames_dir.join(format!("ref_scene_{scene_num:02}_end.jpg"))
        }
    };
    let candidates = [
        frames_dir.join(format!("ref_scene_{scene_num:02}_beats.jpg")),
        early,
        frames_dir.join(format!("ref_scene_{scene_num:02}.jpg")),
        late,
    ];
    candidates
        .iter()
        .filter_map(|p| encode_jpeg_data_url(p))
        .collect()
}

fn collect_scene_keyframe_timestamps(
    ws_root: &Path,
    film_root: &Path,
    film_duration: f64,
    scene_num: usize,
    scene_start: f64,
    scene_dur: f64,
) -> Vec<f64> {
    let all_kfs = crate::studio::reference_compare::discover_reference_keyframes_for_film(
        ws_root,
        film_root,
        film_duration,
    );
    let prefix = format!("ref_scene_{scene_num:02}");
    let mut ts: Vec<f64> = all_kfs
        .iter()
        .filter(|k| {
            let rel = k.rel_path.to_ascii_lowercase();
            let sid = k.scene_id.as_deref().unwrap_or("").to_ascii_lowercase();
            rel.contains(&prefix)
                || sid.starts_with(&format!("scene{scene_num}_"))
                || sid == format!("scene{scene_num}")
        })
        .map(|k| k.timestamp)
        .collect();
    ts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    ts.dedup_by(|a, b| (*a - *b).abs() < 0.04);
    if ts.len() >= 2 {
        return ts.into_iter().take(6).collect();
    }
    vec![
        (scene_start + scene_dur * 0.15).min(film_duration - 0.05),
        (scene_start + scene_dur * 0.30).min(film_duration - 0.05),
        (scene_start + scene_dur * 0.50).min(film_duration - 0.05),
        (scene_start + scene_dur * 0.72).min(film_duration - 0.05),
        (scene_start + scene_dur * 0.88).min(film_duration - 0.05),
    ]
}

/// Runs the Zero-Subagent Direct Per-Scene Vision-First Remake Compiler end-to-end.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_direct_per_scene_remake(
    session_id: &str,
    workspace_dir: &str,
    user_brief: &str,
    client: &reqwest::Client,
    base_url: &mut String,
    api_key: &mut String,
    model_id: &mut String,
    content_parts: &mut Vec<Value>,
) -> Result<DirectRemakeSummary, String> {
    let started = now_ms();
    let ws_root = PathBuf::from(workspace_dir);
    let style_path = ws_root.join("ref").join("extracted").join("style.json");
    let style_val: Value = serde_json::from_str(
        &std::fs::read_to_string(&style_path)
            .map_err(|e| format!("Failed reading {}: {}", style_path.display(), e))?,
    )
    .map_err(|e| format!("Invalid style.json: {}", e))?;

    let html_path = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir))
        .ok_or_else(|| "No active index.html found after film_scaffold".to_string())?;
    let film_root = html_path
        .parent()
        .ok_or_else(|| "Invalid film root".to_string())?
        .to_path_buf();
    let film_val: Value = serde_json::from_str(
        &std::fs::read_to_string(film_root.join("film.json"))
            .map_err(|e| format!("Failed reading film.json: {}", e))?,
    )
    .map_err(|e| format!("Invalid film.json: {}", e))?;

    let width = film_val.get("width").and_then(Value::as_u64).unwrap_or(1024) as u32;
    let height = film_val.get("height").and_then(Value::as_u64).unwrap_or(576) as u32;
    let fps = film_val.get("fps").and_then(Value::as_u64).unwrap_or(30) as u32;
    let bpm = style_val.get("bpm").and_then(Value::as_f64).unwrap_or(120.0);
    let root_bpm_source = style_val
        .get("bpmSource")
        .or_else(|| style_val.pointer("/audioProfile/bpmSource"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let film_scenes = film_val
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let style_scenes = style_val
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total_dur: f64 = film_scenes
        .iter()
        .map(|s| s.get("duration").and_then(Value::as_f64).unwrap_or(0.0))
        .sum::<f64>()
        .max(1.0);

    // Ensure showreel BGM+SFX exists when audioProfile is bgm-sfx-only and audio hasn't been generated yet.
    let audio_mode = style_val
        .pointer("/audioProfile/mode")
        .and_then(Value::as_str)
        .unwrap_or("bgm-sfx-only");
    let first_bgm = film_scenes
        .first()
        .and_then(|s| s.get("id").and_then(Value::as_str))
        .map(|id| film_root.join("audio").join(format!("bgm_{}.wav", id)));
    if audio_mode == "bgm-sfx-only" && first_bgm.as_ref().is_some_and(|p| !p.is_file()) {
        let audio_scenes: Vec<Value> = film_scenes
            .iter()
            .filter_map(|s| {
                Some(json!({
                    "id": s.get("id")?.as_str()?,
                    "narration": "",
                    "duration": s.get("duration").and_then(Value::as_f64).unwrap_or(2.0),
                }))
            })
            .collect();
        let _ = crate::tool::film_audio::execute_film_audio(
            session_id,
            workspace_dir,
            &json!({ "mode": "showreel", "bpm": bpm, "scenes": audio_scenes }),
        )
        .await;
    }

    let temperature = if model_id.to_ascii_lowercase().contains("gemini-3") {
        1.0
    } else {
        0.35
    };
    let max_tokens = 16_384u64;
    let max_scene_steps: usize = std::env::var("AETHERIA_SCENE_MAX_STEPS")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .map(|n| n.clamp(3, 14))
        .unwrap_or(8);
    let scene_tools = build_scene_tool_definitions();
    let total_scenes = film_scenes.len();
    let mut outcomes = Vec::with_capacity(total_scenes);

    crate::paths::log_engine(
        "direct_remake",
        &format!(
            "🚀 Starting Smart Per-Scene Agentic Remake (ZERO subagents, 5 micro-tools, max {} steps/scene): {} scenes on model={}",
            max_scene_steps, total_scenes, model_id
        ),
    );

    for (idx, film_sc) in film_scenes.iter().enumerate() {
        let scene_num = idx + 1;
        let scene_id = film_sc
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("scene")
            .to_string();
        let script_rel = film_sc
            .get("script")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("script/scene{}.js", scene_num));
        let script_path = film_root.join(&script_rel);
        let sc_start = film_sc.get("start").and_then(Value::as_f64).unwrap_or(0.0);
        let sc_dur = film_sc.get("duration").and_then(Value::as_f64).unwrap_or(2.0);
        let style_sc_owned = style_scenes.get(idx).cloned().map(|mut sc_val| {
            if let (Some(obj), Some(src)) = (sc_val.as_object_mut(), root_bpm_source.as_ref()) {
                obj.entry("bpmSource".to_string())
                    .or_insert_with(|| Value::String(src.clone()));
            }
            sc_val
        });
        let style_sc = style_sc_owned.as_ref();

        emit_event(
            workspace_dir,
            "session.tool.called",
            json!({
                "sessionID": session_id,
                "tool": "direct_scene_remake",
                "label": format!("Direct Vision-First Scene {}/{}: {}", scene_num, total_scenes, scene_id),
                "timestamp": now_ms()
            }),
        );

        let pass1_images = collect_scene_pass1_images(&ws_root, scene_num);
        let hard_facts = build_scene_hard_facts_prompt(
            style_sc,
            film_sc,
            scene_num,
            total_scenes,
            width,
            height,
            fps,
            bpm,
            user_brief,
        );
        let scene_ts = collect_scene_keyframe_timestamps(
            &ws_root,
            &film_root,
            total_dur,
            scene_num,
            sc_start,
            sc_dur,
        );

        let mut best_code = std::fs::read_to_string(&script_path).unwrap_or_default();
        let mut best_score = -1.0f64;
        let mut best_errs: Vec<String> = Vec::new();
        let mut best_hazards = usize::MAX;
        let mut latest_score = 0.0f64;
        let mut latest_errs: Vec<String> = Vec::new();
        let mut has_written = false;
        let mut dirty_since_render = false;
        let mut rolled_back = false;
        let mut passes_run = 0usize;

        let tool_ctx = SceneToolContext {
            session_id,
            workspace_dir,
            ws_root: &ws_root,
            film_root: &film_root,
            script_path: &script_path,
            script_rel: &script_rel,
            scene_num,
            scene_start: sc_start,
            scene_dur: sc_dur,
            film_duration: total_dur,
            width,
            height,
            default_scene_ts: &scene_ts,
        };

        let mut scene_msgs = vec![
            json!({ "role": "system", "content": DIRECT_SCENE_SYSTEM_PROMPT }),
            build_vision_user_message(hard_facts.clone(), &pass1_images),
        ];

        // Interactive Antigravity-grade per-scene tool loop (inspect -> sample -> write -> render -> surgical patch)
        for step_idx in 0..max_scene_steps {
            let Ok(comp) = send_resilient_chat_completion_with_options(
                client,
                base_url,
                api_key,
                model_id,
                &mut scene_msgs,
                &scene_tools,
                temperature,
                max_tokens,
                None,
            )
            .await
            else {
                break;
            };
            passes_run += 1;

            if !comp.tool_calls.is_empty() {
                scene_msgs.push(json!({
                    "role": "assistant",
                    "content": if comp.assistant_text.trim().is_empty() { Value::Null } else { json!(comp.assistant_text) },
                    "tool_calls": comp.tool_calls,
                }));

                let mut step_images: Vec<String> = Vec::new();
                let mut step_captions: Vec<String> = Vec::new();

                for (tc_idx, tc) in comp.tool_calls.iter().enumerate() {
                    let cid = tc
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("sc{}_{}_{}", scene_num, step_idx, tc_idx));
                    let fn_name = tc
                        .pointer("/function/name")
                        .or_else(|| tc.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let raw_args = tc
                        .pointer("/function/arguments")
                        .or_else(|| tc.get("arguments"))
                        .and_then(Value::as_str)
                        .unwrap_or("{}");

                    let (parsed_args, arg_err) = match parse_or_repair_tool_args(raw_args) {
                        Ok(v) => (v, None),
                        Err(e) => (json!({}), Some(e)),
                    };

                    let outcome = if let Some(err) = arg_err {
                        super::direct_scene_tools::SceneToolOutcome {
                            result_json: json!({ "ok": false, "error": format!("Malformed JSON tool args: {}", err) }),
                            vision_images: Vec::new(),
                            vision_caption: None,
                            script_modified: false,
                            rendered_score: None,
                            rendered_errors: None,
                        }
                    } else {
                        emit_event(
                            workspace_dir,
                            "session.tool.called",
                            json!({
                                "sessionID": session_id,
                                "tool": fn_name,
                                "label": format!("Scene {}/{}: {}", scene_num, total_scenes, fn_name),
                                "timestamp": now_ms()
                            }),
                        );
                        execute_scene_micro_tool(&tool_ctx, fn_name, &parsed_args).await
                    };

                    if outcome.script_modified {
                        has_written = true;
                        dirty_since_render = true;
                    }
                    if let Some(sc_val) = outcome.rendered_score {
                        dirty_since_render = false;
                        let errs = outcome.rendered_errors.clone().unwrap_or_default();
                        latest_score = sc_val;
                        latest_errs = errs.clone();
                        let cur_code = tokio::fs::read_to_string(&script_path)
                            .await
                            .unwrap_or_default();
                        let cur_haz = detect_scene_collision_hazards(&cur_code).len();
                        // Non-destructive best-checkpoint tracking: NEVER overwrites working file mid-loop!
                        let better_checkpoint = best_score < 0.0
                            || (!best_errs.is_empty() && errs.is_empty())
                            || (best_errs.is_empty()
                                && errs.is_empty()
                                && (sc_val >= best_score - 0.002
                                    || (cur_haz < best_hazards && sc_val >= best_score - 0.04)));
                        if better_checkpoint {
                            best_code = cur_code;
                            best_score = sc_val;
                            best_errs = errs;
                            best_hazards = cur_haz;
                        }
                        crate::paths::log_engine(
                            "direct_remake",
                            &format!(
                                "Scene {}/{} ({}) step {} render -> score={:.3} (best={:.3}), errs={}",
                                scene_num,
                                total_scenes,
                                scene_id,
                                step_idx + 1,
                                sc_val,
                                best_score.max(0.0),
                                latest_errs.len()
                            ),
                        );
                    }

                    step_images.extend(outcome.vision_images);
                    if let Some(cap) = outcome.vision_caption {
                        step_captions.push(cap);
                    }

                    scene_msgs.push(json!({
                        "role": "tool",
                        "tool_call_id": cid,
                        "name": fn_name,
                        "content": serde_json::to_string(&outcome.result_json).unwrap_or_else(|_| "{}".to_string()),
                    }));
                }

                if !step_images.is_empty() {
                    let caption = if step_captions.is_empty() {
                        "Visual tool output attached above. Inspect closely and patch surgically if anything mismatches.".to_string()
                    } else {
                        step_captions.join("\n")
                    };
                    scene_msgs.push(build_vision_user_message(caption, &step_images));
                }
                continue;
            }

            // Graceful fallback for models that return a raw ```javascript``` block without tool calls
            if let Some(code_block) = extract_js_code_block(&comp.assistant_text) {
                let _ = tokio::fs::write(&script_path, &code_block).await;
                has_written = true;
                dirty_since_render = false;
                scene_msgs.push(json!({ "role": "assistant", "content": comp.assistant_text }));

                let render_out = execute_scene_micro_tool(
                    &tool_ctx,
                    "render_and_compare_scene",
                    &json!({}),
                )
                .await;
                let sc_val = render_out.rendered_score.unwrap_or(0.0);
                let errs = render_out.rendered_errors.unwrap_or_default();
                latest_score = sc_val;
                latest_errs = errs.clone();
                let cur_haz = detect_scene_collision_hazards(&code_block).len();
                let better = best_score < 0.0
                    || (!best_errs.is_empty() && errs.is_empty())
                    || (best_errs.is_empty() && errs.is_empty() && sc_val >= best_score - 0.002);
                if better {
                    best_code = code_block;
                    best_score = sc_val;
                    best_errs = errs;
                    best_hazards = cur_haz;
                }
                if latest_errs.is_empty() && latest_score >= 0.86 && cur_haz == 0 {
                    break;
                }
                if step_idx + 1 < max_scene_steps {
                    let diag = render_out
                        .result_json
                        .get("diagnostics")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let follow_txt = format!(
                        "Auto-rendered your script for Scene {}/{} (overall={:.3}, errors={}).\n{}\nInspect the comparison strip above; use `patch_scene_script` (or `inspect_ref_frame` / `sample_ref_region`) to fix any remaining mismatch, then call `render_and_compare_scene`, or reply briefly if done.",
                        scene_num,
                        total_scenes,
                        latest_score,
                        latest_errs.len(),
                        diag
                    );
                    scene_msgs.push(build_vision_user_message(follow_txt, &render_out.vision_images));
                    continue;
                }
                break;
            }

            // Model finished cleanly with text response (no tool calls)
            if has_written {
                break;
            }
            // If model answered with prose before writing any code, nudge once to write the scene script
            if step_idx + 1 < max_scene_steps {
                scene_msgs.push(json!({ "role": "assistant", "content": comp.assistant_text }));
                scene_msgs.push(json!({
                    "role": "user",
                    "content": format!("Please call `write_scene_script` now to author `{}` and verify it with `render_and_compare_scene`.", script_rel)
                }));
                continue;
            }
            break;
        }

        // If the model edited the script on its last step without rendering, run one final verification capture
        if has_written && dirty_since_render {
            let final_out =
                execute_scene_micro_tool(&tool_ctx, "render_and_compare_scene", &json!({})).await;
            latest_score = final_out.rendered_score.unwrap_or(0.0);
            latest_errs = final_out.rendered_errors.unwrap_or_default();
            if best_score < 0.0 {
                best_code = tokio::fs::read_to_string(&script_path)
                    .await
                    .unwrap_or_default();
                best_score = latest_score;
                best_errs = latest_errs.clone();
            }
        }

        // End-of-scene safety net ONLY (never rolls back mid-investigation!):
        // Restore best checkpoint only if final script has runtime errors or regressed significantly (> 0.03).
        let final_code_now = tokio::fs::read_to_string(&script_path)
            .await
            .unwrap_or_default();
        let final_haz = detect_scene_collision_hazards(&final_code_now).len();
        let should_restore_best = best_score >= 0.0
            && !best_code.is_empty()
            && ((best_errs.is_empty() && !latest_errs.is_empty())
                || (latest_score + 0.03 < best_score && final_haz >= best_hazards));
        let (final_score, final_errs) = if should_restore_best {
            let _ = tokio::fs::write(&script_path, &best_code).await;
            rolled_back = true;
            crate::paths::log_engine(
                "direct_remake",
                &format!(
                    "Scene {}/{} ({}) end-of-scene safety restore ({:.3} -> best {:.3})",
                    scene_num, total_scenes, scene_id, latest_score, best_score
                ),
            );
            (best_score, best_errs)
        } else if has_written {
            (latest_score.max(0.0), latest_errs)
        } else {
            (best_score.max(0.0), best_errs)
        };

        outcomes.push(DirectSceneOutcome {
            scene_id,
            script_rel,
            passes_run,
            best_score: final_score,
            rolled_back,
            runtime_errors: final_errs,
        });
    }

    // Final full-film preview capture across all scenes
    let final_comparison =
        match crate::studio::preview_capture::capture_film_preview_with_options(
            workspace_dir,
            Vec::new(),
            Some(true),
            Some(0.65),
        )
        .await
        {
            Ok(res) => {
                let structured = json!({
                    "ok": true,
                    "mode": "direct-per-scene-no-subagent",
                    "referenceComparison": res.reference_comparison,
                    "runtimeErrors": res.runtime_errors,
                });
                content_parts.push(json!({
                    "id": crate::paths::gen_id("prt"),
                    "type": "tool",
                    "name": "capture_film_preview",
                    "tool": "capture_film_preview",
                    "callID": crate::paths::gen_id("direct_prev"),
                    "state": {
                        "status": "completed",
                        "input": { "compareToReference": true, "passThreshold": 0.65 },
                        "output": "Direct per-scene vision-first remake full-film verification complete.",
                        "structured": structured
                    }
                }));
                res.reference_comparison
            }
            Err(err) => {
                crate::paths::log_engine(
                    "direct_remake",
                    &format!("Final full-film preview warning: {}", err),
                );
                None
            }
        };

    let wall_ms = now_ms().saturating_sub(started);
    Ok(DirectRemakeSummary {
        scenes: outcomes,
        final_comparison,
        wall_ms,
    })
}

pub(crate) fn format_direct_remake_report(summary: &DirectRemakeSummary) -> String {
    let mut lines = vec![format!(
        "Selesai menyusun {} scene secara langsung (**Direct Per-Scene Vision-First Mode — tanpa subagent**) dalam {:.1} detik:",
        summary.scenes.len(),
        summary.wall_ms as f64 / 1000.0
    )];
    for sc in &summary.scenes {
        let rb = if sc.rolled_back {
            " (auto-rollback ke versi terbaik)"
        } else {
            ""
        };
        let err = if sc.runtime_errors.is_empty() {
            "0 error".to_string()
        } else {
            format!("{} error", sc.runtime_errors.len())
        };
        lines.push(format!(
            "- `{}` (`{}`): {} pass · skor lokal `{:.3}` · {}{}",
            sc.scene_id, sc.script_rel, sc.passes_run, sc.best_score, err, rb
        ));
    }
    if let Some(ref cmp) = summary.final_comparison {
        let overall = cmp
            .get("overallFidelity")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let ssim = cmp.get("ssimMean").and_then(Value::as_f64).unwrap_or(0.0);
        let color = cmp
            .get("colorMatchMean")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let edge = cmp
            .get("edgeMatchMean")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        lines.push(format!(
            "\nVerifikasi penuh seluruh film (`comparison_strip.jpg`): `overall={:.3}`, `SSIM={:.3}`, `Color={:.3}`, `Edge={:.3}`.",
            overall, ssim, color, edge
        ));
    }
    lines.push(
        "\nSilakan tinjau hasilnya di Studio Player, lalu klik Export MP4 jika sudah sesuai."
            .to_string(),
    );
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_fenced_and_raw_javascript_scene_blocks() {
        let fenced = "Here is the scene:\n```javascript\n(function(){ window.AM.registerScene('s1', function(ctx,t){}); })();\n```\nDone.";
        let got = extract_js_code_block(fenced).expect("should extract fenced js");
        assert!(got.contains("window.AM.registerScene('s1'"));
        assert!(!got.contains("Here is the scene"));

        let raw = "(function(){ AM.registerScene('s2', function(){}); })();";
        assert!(extract_js_code_block(raw).is_some());
        assert!(extract_js_code_block("plain text without code").is_none());
    }
}
