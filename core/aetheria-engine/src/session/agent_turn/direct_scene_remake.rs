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
    build_scene_hard_facts_prompt, detect_scene_collision_hazards, format_comparison_feedback,
    DIRECT_SCENE_SYSTEM_PROMPT,
};
use super::resilience::send_resilient_chat_completion_with_options;

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
    let total_scenes = film_scenes.len();
    let mut outcomes = Vec::with_capacity(total_scenes);

    crate::paths::log_engine(
        "direct_remake",
        &format!(
            "🚀 Starting Direct Per-Scene Vision-First Remake (ZERO subagents): {} scenes on model={}",
            total_scenes, model_id
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
        let style_sc = style_scenes.get(idx);

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
        let mut rolled_back = false;
        let mut passes_run = 0usize;

        // Pass 1: Direct Draft
        let mut pass1_msgs = vec![
            json!({ "role": "system", "content": DIRECT_SCENE_SYSTEM_PROMPT }),
            build_vision_user_message(hard_facts.clone(), &pass1_images),
        ];
        if let Ok(comp1) = send_resilient_chat_completion_with_options(
            client,
            base_url,
            api_key,
            model_id,
            &mut pass1_msgs,
            &[],
            temperature,
            max_tokens,
            None,
        )
        .await
        {
            passes_run += 1;
            if let Some(code1) = extract_js_code_block(&comp1.assistant_text) {
                let _ = tokio::fs::write(&script_path, &code1).await;
                best_code = code1;
            }
        }

        // Capture Pass 1 visual comparison on Scene K's keyframes
        let (p1_score, mut cur_feedback, mut cur_strip, p1_errs) =
            match crate::studio::preview_capture::capture_film_preview_with_options(
                workspace_dir,
                scene_ts.clone(),
                Some(true),
                Some(0.65),
            )
            .await
            {
                Ok(res) => {
                    let (sc, fb, sp) = format_comparison_feedback(
                        res.reference_comparison.as_ref(),
                        sc_start,
                        &res.runtime_errors,
                        None,
                    );
                    (sc, fb, sp, res.runtime_errors)
                }
                Err(err) => {
                    let (sc, fb, sp) = format_comparison_feedback(None, sc_start, &[], Some(&err));
                    (sc, fb, sp, vec![err])
                }
            };
        let mut best_score = p1_score;
        let mut best_errs = p1_errs;
        let mut rollback_note = String::new();

        crate::paths::log_engine(
            "direct_remake",
            &format!(
                "Scene {}/{} ({}) Pass 1 -> score={:.3}, errors={}",
                scene_num,
                total_scenes,
                scene_id,
                best_score,
                best_errs.len()
            ),
        );

        // Pass 2 (Visual Self-Correction) + optional Pass 3 (Recovery/Polish if runtime error, collision hazard, or < 0.72)
        for refine_pass in 2..=3 {
            let code_hazards = detect_scene_collision_hazards(&best_code);
            let needs_pass = if refine_pass == 2 {
                !best_errs.is_empty() || !code_hazards.is_empty() || best_score < 0.86
            } else {
                !best_errs.is_empty() || !code_hazards.is_empty() || best_score < 0.72
            };
            if !needs_pass {
                break;
            }

            let mut refine_imgs = Vec::new();
            if let Some(ref sp) = cur_strip {
                if let Some(url) = encode_jpeg_data_url(sp) {
                    refine_imgs.push(url);
                }
            }
            if let Some(beats_url) = encode_jpeg_data_url(
                &ws_root
                    .join("ref")
                    .join("extracted")
                    .join("frames")
                    .join(format!("ref_scene_{scene_num:02}_beats.jpg")),
            ) {
                refine_imgs.push(beats_url);
            }
            if refine_imgs.is_empty() {
                refine_imgs = pass1_images.clone();
            }

            let hazard_block = if code_hazards.is_empty() {
                String::new()
            } else {
                format!(
                    "AUTOMATIC COLLISION / MOTION BUGS DETECTED IN YOUR CODE (MUST FIX ALL):\n- {}\n\n",
                    code_hazards.join("\n- ")
                )
            };

            let refine_prompt = format!(
                "VISUAL SELF-CORRECTION PASS {} FOR SCENE {}/{} (\"{}\", local t = 0..{:.3}s):\n\
                 Inspect the attached 3-row visual comparison strip (`Row 1 = REFERENCE | Row 2 = YOUR CURRENT RENDER | Row 3 = DIFF HEATMAP`) panel by panel from left to right.\n\n\
                 {}{}\
                 MEASURED DIAGNOSTICS:\n{}\n\n\
                 HARD FACTS:\n{}\n\n\
                 YOUR CURRENT `{}` CODE:\n```javascript\n{}\n```\n\n\
                 VISUAL SELF-AUDIT CHECKLIST (SCAN EVERY PANEL OF ROW 2 BEFORE CODING):\n\
                 1. ZERO COLLISIONS & OVERLAPS: Replace any fixed `i * spacing` text loop with `ctx.measureText` flow layout; cross-fade outgoing elements out cleanly (`1 - p`) before incoming elements occupy the same `(x, y)`.\n\
                 2. SMOOTH MONOTONIC MOTION: Keep reels/lists/trajectories continuous and monotonic across `0..dur` matching every panel's timestamp, with no backwards jumps or blank black boundary frames at `t = 0` or `t = dur`.\n\
                 3. EXACT GEOMETRY & CONTRAST: Match Row 1's `refFgBox` scale/position, bezel `outerBox` + `ctx.clip()`, rotated grid origin/polarity, surface brightness/gradients, and contrasting ink inside both light and dark cards/tiles.\n\
                 4. EXACT VISUAL FIDELITY: Match Row 1's style, typography weight, icons, and on-screen language directly from the images without inventing unrequested overlays. Output ONLY the complete corrected ```javascript ... ``` block.",
                refine_pass,
                scene_num,
                total_scenes,
                scene_id,
                sc_dur,
                rollback_note,
                hazard_block,
                cur_feedback,
                hard_facts,
                script_rel,
                best_code
            );

            let mut refine_msgs = vec![
                json!({ "role": "system", "content": DIRECT_SCENE_SYSTEM_PROMPT }),
                build_vision_user_message(refine_prompt, &refine_imgs),
            ];
            let Ok(comp_ref) = send_resilient_chat_completion_with_options(
                client,
                base_url,
                api_key,
                model_id,
                &mut refine_msgs,
                &[],
                temperature,
                max_tokens,
                None,
            )
            .await
            else {
                break;
            };
            passes_run += 1;
            let Some(next_code) = extract_js_code_block(&comp_ref.assistant_text) else {
                break;
            };
            let _ = tokio::fs::write(&script_path, &next_code).await;

            let (next_score, next_fb, next_strip, next_errs) =
                match crate::studio::preview_capture::capture_film_preview_with_options(
                    workspace_dir,
                    scene_ts.clone(),
                    Some(true),
                    Some(0.65),
                )
                .await
                {
                    Ok(res) => {
                        let (sc, fb, sp) = format_comparison_feedback(
                            res.reference_comparison.as_ref(),
                            sc_start,
                            &res.runtime_errors,
                            None,
                        );
                        (sc, fb, sp, res.runtime_errors)
                    }
                    Err(err) => {
                        let (sc, fb, sp) =
                            format_comparison_feedback(None, sc_start, &[], Some(&err));
                        (sc, fb, sp, vec![err])
                    }
                };

            let next_hazards = detect_scene_collision_hazards(&next_code);
            let fixed_collision_hazard =
                !code_hazards.is_empty() && next_hazards.len() < code_hazards.len();
            let improved = if !best_errs.is_empty() && next_errs.is_empty() {
                true
            } else if best_errs.is_empty() && !next_errs.is_empty() {
                false
            } else if fixed_collision_hazard && next_score >= best_score - 0.04 {
                true
            } else {
                next_score >= best_score - 0.004
            };

            if improved {
                best_code = next_code;
                best_score = next_score;
                best_errs = next_errs;
                cur_feedback = next_fb;
                cur_strip = next_strip;
                rollback_note.clear();
                crate::paths::log_engine(
                    "direct_remake",
                    &format!(
                        "Scene {}/{} ({}) Pass {} KEPT -> score={:.3}, errors={}",
                        scene_num,
                        total_scenes,
                        scene_id,
                        refine_pass,
                        best_score,
                        best_errs.len()
                    ),
                );
            } else {
                rolled_back = true;
                let _ = tokio::fs::write(&script_path, &best_code).await;
                crate::paths::log_engine(
                    "direct_remake",
                    &format!(
                        "Scene {}/{} ({}) Pass {} ROLLED BACK ({:.3} < {:.3}, errs={})",
                        scene_num,
                        total_scenes,
                        scene_id,
                        refine_pass,
                        next_score,
                        best_score,
                        next_errs.len()
                    ),
                );
                // If Pass 2 regressed while score is still < 0.72, let Pass 3 retry surgically
                // from the restored `best_code` instead of giving up early!
                if refine_pass == 2 && (!best_errs.is_empty() || best_score < 0.72) {
                    rollback_note = format!(
                        "PREVIOUS EDIT REGRESSED ({:.3} < {:.3}) AND WAS ROLLED BACK! Keep ALL working structure from the restored code below and make ONLY surgical fixes to the biggest visual mismatch in Row 1 vs Row 2 (do NOT invert polarity, shrink elements, or shift working timing).\n\n",
                        next_score, best_score
                    );
                } else {
                    break;
                }
            }
        }

        outcomes.push(DirectSceneOutcome {
            scene_id,
            script_rel,
            passes_run,
            best_score,
            rolled_back,
            runtime_errors: best_errs,
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
