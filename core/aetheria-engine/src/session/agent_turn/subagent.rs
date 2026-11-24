//! Isolated Child-Agent / Subagent Runner — mirrors `packages/core/src/plugin/subagent.ts`
//! and `packages/core/src/session/subagent-completion.ts`.
//! Delegates store setup (`subagent_store`), config (`subagent_provider`), and tool loops (`subagent_tool_batch`).

pub use super::subagent_store::{
    build_subagent_system_prompt, build_subagent_tools, collect_reference_vision_images,
    get_session_depth, load_or_init_child_session, load_or_init_child_session_with_images,
    persist_child_session_state, resolve_parent_skill_or_voice_directive, MAX_SUBAGENT_DEPTH,
};

use serde_json::{json, Value};
use std::time::Duration;

use super::kiro_standby::{acquire_subagent_turn_standby, register_subagent_pending};
use super::resilience::{
    send_resilient_chat_completion, SYNTHETIC_OUTPUT_LIMIT_PROMPT,
};
use super::subagent_provider::{
    resolve_child_vision_capability, resolve_subagent_max_tokens,
    resolve_subagent_provider_config_for_call,
};
use super::subagent_tool_batch::execute_subagent_tool_calls;
use crate::paths::now_ms;
use crate::session::doom_loop::DoomLoopDetector;
use crate::session::message::emit_event;

pub fn spawn_subagent_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "task",
            "description": include_str!("../../tool/prompt/task.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "description": { "type": "string", "description": "A short (3-5 words) summary of what this subagent will do" },
                    "prompt": { "type": "string", "description": "Detailed, self-contained instructions for the subagent, including exact file paths and expected output" },
                    "subagent_type": { "type": "string", "enum": ["general", "explore", "motion-designer", "audio-director", "qa-verifier"], "description": "The specialized persona and toolset for this subagent" },
                    "sessionID": { "type": "string", "description": "Optional child sessionID from a previous `task` result to continue/resume that subagent's conversation instead of starting fresh" },
                    "background": { "type": "boolean", "description": "Optional (defaults to true). Runs the subagent asynchronously in the background without blocking the parent turn and delivers a <subagent-notification> into the parent SessionInbox when complete. Pass false only when a synchronous blocking wait is strictly required." }
                },
                "required": ["description", "prompt", "subagent_type"]
            }
        }
    })
}

struct ChildActiveRunGuard(String);

impl Drop for ChildActiveRunGuard {
    fn drop(&mut self) {
        crate::session::session::set_active_run(&self.0, false);
    }
}

enum SubagentExitOutcome {
    Completed,
    Incomplete(String),
    Error(String),
}

pub fn execute_subagent<'a>(
    parent_session_id: &'a str,
    workspace_dir: &'a str,
    arguments: &'a Value,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Value> + Send + 'a>> {
    Box::pin(async move {
        let description = arguments
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("Subagent Task");
        let prompt = arguments
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let raw_subagent_type = arguments
            .get("agent")
            .or_else(|| arguments.get("subagent_type"))
            .or_else(|| arguments.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("general");
        let subagent_type_owned = crate::tool::profiles::ToolProfile::from_subagent_type(raw_subagent_type)
            .as_str()
            .to_string();
        let subagent_type: &str = if raw_subagent_type.trim().is_empty() {
            "general"
        } else if subagent_type_owned == "general"
            && !matches!(raw_subagent_type.trim().to_ascii_lowercase().as_str(), "general")
        {
            raw_subagent_type.trim()
        } else {
            &subagent_type_owned
        };
        let model_override = arguments
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let requested_session_id = arguments
            .get("sessionID")
            .or_else(|| arguments.get("task_id"))
            .or_else(|| arguments.get("child_session_id"))
            .or_else(|| arguments.get("session_id"))
            .and_then(|v| v.as_str());
        // Always run `motion-designer` synchronously so scene batches never race over shared
        // `.aetheria/preview/` artifacts or let the coordinator preview mid-flight.
        let run_in_background = if subagent_type.trim().eq_ignore_ascii_case("motion-designer") {
            false
        } else {
            arguments
                .get("background")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        };

        if prompt.trim().is_empty() {
            return json!({ "ok": false, "state": "error", "error": "Subagent `prompt` is required and cannot be empty." });
        }

        let parent_depth = get_session_depth(parent_session_id);
        if parent_depth >= MAX_SUBAGENT_DEPTH {
            let err_msg = format!(
                "Maximum subagent recursion depth limit ({}) reached. Execute the remaining tools directly instead of spawning another subagent.",
                MAX_SUBAGENT_DEPTH
            );
            return json!({
                "ok": false, "state": "error", "subagent_type": subagent_type, "error": err_msg,
                "output": format!("<subagent state=\"error\">\n{}\n</subagent>", err_msg)
            });
        }
        let child_depth = parent_depth + 1;
        if let Some(req_cid) = requested_session_id.map(str::trim).filter(|s| !s.is_empty()) {
            if crate::session::session::is_active_run(req_cid) {
                crate::session::coordinator::admit_inbox_item(
                    req_cid,
                    prompt,
                    crate::session::coordinator::InboxDelivery::Steer,
                );
                return json!({
                    "ok": true,
                    "state": "running",
                    "mode": "background",
                    "sessionID": req_cid,
                    "subagent_type": subagent_type,
                    "description": description,
                    "resumed": true,
                    "output": format!(
                        "<subagent sessionID=\"{}\" type=\"{}\" state=\"running\" mode=\"background\">\nFollow-up instructions queued onto active child session {}.\n</subagent>",
                        req_cid, subagent_type, req_cid
                    )
                });
            }
        }
        let mut sys_prompt = build_subagent_system_prompt(subagent_type, workspace_dir);
        if let Some(active_directive) = resolve_parent_skill_or_voice_directive(
            parent_session_id,
            workspace_dir,
            subagent_type,
        ) {
            sys_prompt.push_str("\n\n");
            sys_prompt.push_str(&active_directive);
        }
        let mut effective_prompt = prompt.to_string();
        let mut initial_image_urls: Vec<String> = Vec::new();
        if matches!(
            subagent_type.trim().to_ascii_lowercase().as_str(),
            "motion-designer" | "qa-verifier"
        ) {
            if let Some(ms_override) =
                crate::studio::microstock::build_microstock_hard_override_block(workspace_dir)
            {
                sys_prompt.push_str("\n\n");
                sys_prompt.push_str(&ms_override);
            }
            let scope_text = format!("{}\n{}", description, prompt);
            let raw_target_scenes =
                super::subagent_scene_scope::extract_target_scene_indices(&scope_text);
            let target_scenes = if subagent_type.trim().eq_ignore_ascii_case("motion-designer") {
                super::subagent_scene_scope::clamp_target_scene_indices_for_reference(
                    workspace_dir,
                    &raw_target_scenes,
                )
            } else {
                raw_target_scenes.clone()
            };
            if raw_target_scenes.len() > target_scenes.len() {
                effective_prompt = format!(
                    "[SCENE SCOPE GUARD (v13): Multi-scene mass edits (>2 scenes) are prohibited to prevent cross-scene regressions. Your scope for this task is STRICTLY clamped to Scene(s) {:?} ONLY. Do NOT write or edit any other script/scene*.js file.]\n\n{}",
                    target_scenes, effective_prompt
                );
            }
            let is_scoped_batch =
                super::subagent_scene_scope::is_focused_scene_subset(workspace_dir, &target_scenes);
            if subagent_type.trim().eq_ignore_ascii_case("motion-designer")
                || subagent_type.trim().eq_ignore_ascii_case("qa-verifier")
            {
                if let Ok(report_path) =
                    crate::tool::path_guard::resolve_isolated_path(workspace_dir, "ref/extracted/ref_report.md")
                {
                    if let Ok(raw_report) = std::fs::read_to_string(&report_path) {
                        let trimmed = raw_report.trim();
                        if !trimmed.is_empty() {
                            let scoped_report = if is_scoped_batch {
                                super::subagent_scene_scope::filter_ref_report_for_scenes(
                                    trimmed,
                                    &target_scenes,
                                )
                            } else {
                                trimmed.to_string()
                            };
                            let excerpt: String = scoped_report.chars().take(6500).collect();
                            effective_prompt.push_str(&format!(
                                "\n\n<active_video_reference_report>\n{}\n\n[Threshold Rule: pass `passThreshold: 0.65` on `capture_film_preview` whenever replacing reference brand/copy names (still aim >=0.78+ after polish); omit/`0.85` only on strict 1:1 literal clones.]\n</active_video_reference_report>",
                                excerpt
                            ));
                        }
                    }
                }
            }
            let ref_vision_imgs = super::subagent_scene_scope::collect_reference_vision_images_scoped(
                workspace_dir,
                &target_scenes,
                12,
            );
            if !ref_vision_imgs.is_empty() {
                let (child_pid, child_mid, child_vision_ok) = resolve_child_vision_capability(
                    parent_session_id,
                    subagent_type,
                    model_override.as_deref(),
                );
                let frame_list = ref_vision_imgs
                    .iter()
                    .map(|(rel, _)| format!("`{}`", rel))
                    .collect::<Vec<_>>()
                    .join(", ");
                if child_vision_ok {
                    initial_image_urls = ref_vision_imgs.into_iter().map(|(_, url)| url).collect();
                    let scope_instruction = if is_scoped_batch {
                        "FOCUSED SCENE BATCH MODE: Study EVERY panel of each attached `ref_scene_0K_beats.jpg` storyboard strip + `_q1`/`mid`/`_q3` full-res keyframes from left to right, alongside `Saturated Accent Callouts`, `Container & Inner Screen ClipRect`, `Measured Foreground Trajectory`, `Kinetic Layout Clues`, and `Dense 6-Slice Timeline` in `<active_video_reference_report>`. Rules: (1) morph letters IN-PLACE on a single inline baseline (never stack icons above/below the hero word); (2) draw distinct vector icons in every grid/slot cell (never repeat 2x2 dot placeholders); (3) match exact `[x,y,w,h]` bounding boxes, 3D arrow flight/fold trajectory, marquee font scale, and exact active words at each timestamp; (4) clip all inner laptop/card screens with `ctx.clip()` to `innerClipRect` with >=24px text padding so nothing spills or clips. Write craft-rich Canvas code (~150-300 lines per complex scene) for ONLY these target scenes, then call `capture_film_preview({ compareToReference: true, passThreshold: 0.65 })` (automatically scoped to your target scenes) and resolve all structural diagnostics before finishing."
                    } else {
                        "study BOTH the per-scene stills AND the 0.5s contact sheet timeline for intra-scene multi-beat choreography, cursor paths, strokes, and transitions; call `read` on extra frames under `ref/extracted/frames/` or `.aetheria/preview/comparison_strip.jpg` if needed."
                    };
                    effective_prompt.push_str(&format!(
                        "\n\n[Attached Reference Keyframes ({} vision images inline): {} — {}]",
                        initial_image_urls.len(),
                        frame_list,
                        scope_instruction
                    ));
                } else {
                    effective_prompt.push_str(&format!(
                        "\n\n[TEXT-ONLY SUBAGENT VISION GAP WARNING: Child model `{}/{}` is text-only, so {} extracted reference keyframes ({}) could NOT be attached visually. Rely strictly on measured `style.json`/`ref_report.md` coordinates, hex palettes, and text zones (plus `codemode` pixel/contrast analysis if needed), and explicitly report that raw visual inspection was skipped due to the text-only model.]",
                        child_pid,
                        child_mid,
                        ref_vision_imgs.len(),
                        frame_list
                    ));
                }
            }
        }
        let (child_session_id, chat_messages, is_resumed) = load_or_init_child_session_with_images(
            parent_session_id,
            requested_session_id,
            subagent_type,
            description,
            child_depth,
            &sys_prompt,
            &effective_prompt,
            &initial_image_urls,
        );

        crate::session::coordinator::begin_session_turn(&child_session_id);
        crate::session::job_registry::start_subagent_job(
            &child_session_id,
            parent_session_id,
            Some(&child_session_id),
            subagent_type,
            description,
            run_in_background,
        );
        emit_event(
            workspace_dir,
            "subagent.started",
            json!({
                "parentSessionId": parent_session_id,
                "subagentSessionId": child_session_id,
                "subagentType": subagent_type,
                "description": description,
                "background": run_in_background,
                "resumed": is_resumed,
                "depth": child_depth,
                "timestamp": now_ms()
            }),
        );

        let pending_guard = register_subagent_pending(parent_session_id);
        crate::session::session::set_active_run(&child_session_id, true);

        if run_in_background {
            spawn_background_subagent_task(
                BackgroundSubagentSpec {
                    parent_id: parent_session_id.to_string(),
                    ws: workspace_dir.to_string(),
                    child_id: child_session_id.clone(),
                    sub_type: subagent_type.to_string(),
                    desc: description.to_string(),
                    model_override,
                    is_resumed,
                    child_depth,
                    chat_messages,
                },
                pending_guard,
                false,
            );

            return json!({
                "ok": true, "state": "running", "mode": "background",
                "sessionID": child_session_id, "subagent_type": subagent_type, "description": description,
                "output": format!(
                    "<subagent sessionID=\"{}\" type=\"{}\" state=\"running\" mode=\"background\">\nThe subagent is running in parallel in the background (sessionID: {}). Up to 4 sibling subagents run concurrently per cloud provider/model while excess siblings or local-cli queue cleanly in standby. Briefly tell the user what you launched and END YOUR RESPONSE NOW cleanly (DO NOT sleep, poll, or call another tool until woken by <subagent-notification>) so you stay responsive if the user asks questions while waiting.\n</subagent>",
                    child_session_id, subagent_type, child_session_id
                )
            });
        }

        let _active_guard = ChildActiveRunGuard(child_session_id.clone());
        let out = run_subagent_loop(
            parent_session_id,
            workspace_dir,
            &child_session_id,
            subagent_type,
            description,
            model_override.as_deref(),
            is_resumed,
            child_depth,
            chat_messages,
        )
        .await;
        drop(_active_guard);
        drop(pending_guard);
        out
    })
}

struct BackgroundSubagentSpec {
    parent_id: String,
    ws: String,
    child_id: String,
    sub_type: String,
    desc: String,
    model_override: Option<String>,
    is_resumed: bool,
    child_depth: usize,
    chat_messages: Vec<Value>,
}

fn spawn_background_subagent_task(
    spec: BackgroundSubagentSpec,
    pending_guard: super::kiro_standby::SubagentPendingGuard,
    wait_for_boot_sse: bool,
) {
    tokio::spawn(async move {
        let active_guard = ChildActiveRunGuard(spec.child_id.clone());
        if wait_for_boot_sse {
            crate::session::prompt::wait_for_sse_subscriber_or_delay().await;
            tokio::time::sleep(Duration::from_millis(45)).await;
        }
        let out = run_subagent_loop(
            &spec.parent_id,
            &spec.ws,
            &spec.child_id,
            &spec.sub_type,
            &spec.desc,
            spec.model_override.as_deref(),
            spec.is_resumed,
            spec.child_depth,
            spec.chat_messages,
        )
        .await;
        drop(active_guard);

        let remaining = pending_guard.release_now();
        let state_str = out.get("state").and_then(|v| v.as_str()).unwrap_or("completed");
        let output_xml = out.get("output").and_then(|v| v.as_str()).unwrap_or("");
        let safe_desc = spec.desc.replace('"', "'").replace(['<', '>', '\n', '\r'], " ");
        let is_success_state =
            state_str == "completed" && out.get("ok").and_then(Value::as_bool) != Some(false);
        let status_summary = if is_success_state {
            "finished cleanly".to_string()
        } else {
            format!("stopped in state '{}'", state_str)
        };
        let standby_note = if remaining > 0 {
            if is_success_state {
                format!(
                    "\n<standby-status pending=\"{}\">Subagent {}. {} sibling subagent(s) remain queued or active in standby. Report this completed subagent's findings concisely to the user now (e.g. 'Laporan {} (selesai)') and END YOUR TURN cleanly WITHOUT calling tools, sleeping, or polling — the next queued subagent will notify you when it finishes.</standby-status>",
                    remaining, status_summary, remaining, spec.sub_type
                )
            } else {
                format!(
                    "\n<standby-status pending=\"{}\">Subagent {} (NOT completed). {} sibling subagent(s) remain queued or active in standby. Report this incomplete/failed status accurately without claiming completion, and wait for remaining sibling notifications before taking recovery action.</standby-status>",
                    remaining, status_summary, remaining
                )
            }
        } else if is_success_state {
            String::from(
                "\n<standby-status pending=\"0\">All background subagents have finished cleanly. Deliver a clear final summary or synthesis to the user.</standby-status>",
            )
        } else {
            format!(
                "\n<standby-status pending=\"0\">Background subagent {} (NOT completed). Do NOT claim completion to the user. Inspect the diagnostic above and resume/fix the failed subtask or report honestly what failed.</standby-status>",
                status_summary
            )
        };
        let notification = format!(
            "<subagent-notification sessionID=\"{}\" type=\"{}\" state=\"{}\" remaining_standby=\"{}\" description=\"{}\">\n{}{}\n</subagent-notification>",
            spec.child_id, spec.sub_type, state_str, remaining, safe_desc, output_xml, standby_note
        );
        let parent_active = crate::session::session::is_active_run(&spec.parent_id);
        let delivery = if parent_active {
            crate::session::coordinator::InboxDelivery::Steer
        } else {
            crate::session::coordinator::InboxDelivery::Queue
        };
        crate::session::coordinator::admit_inbox_item(&spec.parent_id, &notification, delivery);

        if get_session_depth(&spec.parent_id) == 0 {
            crate::session::prompt::wake_parent_session_after_background(
                &spec.parent_id,
                &spec.ws,
            );
        }
    });
}

/// Resumes a persisted background subagent job that was interrupted by an engine crash (`K53`).
pub fn wake_interrupted_subagent_on_startup(rec: crate::session::restart::InterruptedSubagentRecovery) {
    let loaded = crate::session::session::with_store(|store| {
        let msgs = store.messages.get(&rec.child_session_id).cloned().unwrap_or_default();
        if msgs.is_empty() {
            return None;
        }
        let child_sess = store.sessions.get(&rec.child_session_id);
        let sub_type = child_sess
            .and_then(|s| s.get("agent"))
            .and_then(|v| v.as_str())
            .unwrap_or("general")
            .to_string();
        let child_depth = child_sess
            .and_then(|s| s.get("subagentDepth"))
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(1);
        let model_override = child_sess
            .and_then(|s| s.get("model"))
            .and_then(|m| {
                let pid = m.get("providerID").and_then(|v| v.as_str())?;
                let mid = m.get("id").and_then(|v| v.as_str())?;
                Some(format!("{}/{}", pid, mid))
            });
        let parent_sess = store.sessions.get(&rec.parent_session_id);
        let ws = parent_sess
            .and_then(|s| s.pointer("/location/directory").or_else(|| s.get("directory")))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| crate::paths::project_root().to_string_lossy().to_string());
        Some((sub_type, child_depth, model_override, ws, msgs))
    });

    let Some((sub_type, child_depth, model_override, ws, chat_messages)) = loaded else {
        crate::session::job_registry::settle_job_error(
            &rec.child_session_id,
            "Interrupted subagent session state missing on startup.",
        );
        return;
    };

    crate::session::coordinator::begin_session_turn(&rec.child_session_id);
    let pending_guard = register_subagent_pending(&rec.parent_session_id);
    crate::session::session::set_active_run(&rec.child_session_id, true);
    spawn_background_subagent_task(
        BackgroundSubagentSpec {
            parent_id: rec.parent_session_id,
            ws,
            child_id: rec.child_session_id,
            sub_type,
            desc: rec.description,
            model_override,
            is_resumed: true,
            child_depth,
            chat_messages,
        },
        pending_guard,
        true,
    );
}

#[allow(clippy::too_many_arguments)]
async fn run_subagent_loop(
    parent_session_id: &str,
    workspace_dir: &str,
    child_session_id: &str,
    subagent_type: &str,
    description: &str,
    model_override: Option<&str>,
    is_resumed: bool,
    child_depth: usize,
    mut chat_messages: Vec<Value>,
) -> Value {
    let child_session_id = child_session_id.to_string();
    let (parent_provider_id, parent_model_id, parent_variant) =
        super::subagent_provider::resolve_parent_model_ref_with_variant(parent_session_id);
    let (mut base_url, mut api_key, mut model_id, provider_id) =
        resolve_subagent_provider_config_for_call(parent_session_id, subagent_type, model_override)
            .await;
    let inherited_variant = if provider_id == parent_provider_id && model_id == parent_model_id {
        parent_variant
    } else {
        None
    };
    crate::session::session::with_store(|store| {
        if let Some(sess) = store.sessions.get_mut(&child_session_id) {
            let mut mref = json!({ "providerID": &provider_id, "id": &model_id });
            if let Some(ref v) = inherited_variant {
                mref["variant"] = json!(v);
            }
            sess["model"] = mref;
            crate::session::session::save_store(store);
        }
    });
    let tools = build_subagent_tools(subagent_type, child_depth);
    let subagent_cfg = crate::provider::read_aetheria_config();
    let subagent_max_tokens =
        resolve_subagent_max_tokens(&subagent_cfg, subagent_type, &provider_id, &model_id);
    let subagent_reasoning = super::subagent_provider::resolve_subagent_reasoning_effort_with_fallback(
        &subagent_cfg,
        subagent_type,
        &provider_id,
        &model_id,
        inherited_variant.as_deref(),
    );
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let mut final_text = String::new();
    let mut tools_executed: Vec<String> = Vec::new();
    let mut executed_tool_parts: Vec<Value> = Vec::new();
    let mut verification_retries: usize = 0;
    let mut steps_run: usize = 0;
    let max_steps: usize = if subagent_type.trim().eq_ignore_ascii_case("motion-designer") {
        38
    } else {
        24
    };
    let mut output_limit_continuations: usize = 0;
    let mut length_hits_total: usize = 0;
    let mut doom_detector = DoomLoopDetector::default();
    let mut exit_outcome = SubagentExitOutcome::Completed;

    // Only Kiro (`local-cli` + `kiro/*`) stays strictly 1-slot; all other backends (Cloud APIs,
    // Antigravity/agy, Codex, Claude, OpenCode) allow up to 4 parallel sibling slots per model lane.
    let standby_lane = if provider_id == "local-cli" && model_id.starts_with("kiro/") {
        "local-cli".to_string()
    } else {
        format!("{}::{}", provider_id, model_id)
    };
    let _subagent_turn_permit = match acquire_subagent_turn_standby(
        parent_session_id,
        &child_session_id,
        workspace_dir,
        subagent_type,
        &standby_lane,
        child_depth,
    )
    .await
    {
        Ok(permit) => permit,
        Err(reason) => {
            exit_outcome = SubagentExitOutcome::Incomplete(reason);
            None
        }
    };

    if matches!(exit_outcome, SubagentExitOutcome::Completed) {
        while steps_run < max_steps {
        if let Some(reason) = crate::session::coordinator::is_session_interrupted(parent_session_id)
            .or_else(|| crate::session::coordinator::is_session_interrupted(&child_session_id))
        {
            exit_outcome = SubagentExitOutcome::Incomplete(format!("Subagent interrupted ({})", reason));
            break;
        }
        for steer in crate::session::coordinator::drain_pending_steers(&child_session_id) {
            chat_messages.push(json!({ "role": "user", "content": steer.text }));
        }
        let subagent_ctx_limit = crate::session::compaction_budget::resolve_model_context_limit(
            &subagent_cfg,
            &provider_id,
            &model_id,
        )
        .context;
        if crate::session::compaction::should_compact(&chat_messages, subagent_ctx_limit) {
            chat_messages = crate::session::compaction::emergency_compact_messages(&chat_messages);
        }

        steps_run += 1;
        // OpenCode pattern: omit `temperature` so models retain their native calibrated sampling.
        let subagent_temperature: Option<f64> = None;
        let completion = match super::resilience::send_resilient_chat_completion_with_session(
            &client,
            &mut base_url,
            &mut api_key,
            &mut model_id,
            &mut chat_messages,
            &tools,
            subagent_temperature,
            subagent_max_tokens,
            subagent_reasoning.as_deref(),
            None,
            Some(&child_session_id),
        )
        .await
        {
            Ok(out) => out,
            Err(err_msg) => {
                exit_outcome = SubagentExitOutcome::Error(err_msg);
                break;
            }
        };

        if completion.finish_reason == "length" || completion.finish_reason == "max_tokens" {
            length_hits_total += 1;
            crate::paths::log_engine(
                "subagent",
                &format!(
                    "[F4_LENGTH_LIMIT] session={} role={} step={} continuation={}/2 model={}/{} max_tokens={} text_chars={} tool_calls={}",
                    child_session_id,
                    subagent_type,
                    steps_run,
                    output_limit_continuations,
                    provider_id,
                    model_id,
                    subagent_max_tokens,
                    completion.assistant_text.len(),
                    completion.tool_calls.len(),
                ),
            );
        }

        if !completion.assistant_text.trim().is_empty() {
            if !final_text.is_empty() && output_limit_continuations > 0 {
                final_text.push('\n');
                final_text.push_str(&completion.assistant_text);
            } else {
                final_text = completion.assistant_text.clone();
            }
        }

        if !completion.tool_calls.is_empty() {
            output_limit_continuations = 0;
            chat_messages.push(json!({
                "role": "assistant",
                "content": if completion.assistant_text.is_empty() { Value::Null } else { json!(completion.assistant_text) },
                "tool_calls": completion.tool_calls
            }));

            let engine_cfg = crate::provider::read_aetheria_config();
            let subagent_vision_enabled = super::runner::model_supports_vision_from_config(
                Some(&engine_cfg),
                &provider_id,
                &model_id,
            );
            if let Some(doom_reason) = execute_subagent_tool_calls(
                parent_session_id,
                &child_session_id,
                workspace_dir,
                subagent_type,
                steps_run,
                subagent_vision_enabled,
                &completion.tool_calls,
                &mut doom_detector,
                &mut tools_executed,
                &mut executed_tool_parts,
                &mut chat_messages,
            ).await {
                exit_outcome = SubagentExitOutcome::Incomplete(doom_reason);
                break;
            }

            if steps_run >= max_steps {
                chat_messages.push(json!({ "role": "user", "content": crate::session::coordinator::MAX_STEPS_PROMPT }));
                if let Ok(synth) = send_resilient_chat_completion(
                    &client, &mut base_url, &mut api_key, &mut model_id, &mut chat_messages, &[], 0.2, 2048,
                ).await {
                    if !synth.assistant_text.trim().is_empty() {
                        final_text = synth.assistant_text;
                    }
                }
                exit_outcome = SubagentExitOutcome::Incomplete(format!(
                    "Reached maximum step limit ({}) while still requesting tool calls. You can resume this subagent by passing sessionID=\"{}\".",
                    max_steps, child_session_id
                ));
            }
            continue;
        }

        if (completion.finish_reason == "length" || completion.finish_reason == "max_tokens")
            && output_limit_continuations < 2
            && steps_run < max_steps
        {
            output_limit_continuations += 1;
            chat_messages.push(json!({ "role": "assistant", "content": completion.assistant_text }));
            chat_messages.push(json!({ "role": "user", "content": SYNTHETIC_OUTPUT_LIMIT_PROMPT }));
            continue;
        }

        if !completion.assistant_text.is_empty() {
            chat_messages.push(json!({ "role": "assistant", "content": completion.assistant_text }));
        }
        let late_steers = crate::session::coordinator::drain_pending_steers(&child_session_id);
        if !late_steers.is_empty() {
            for steer in late_steers {
                chat_messages.push(json!({ "role": "user", "content": steer.text }));
            }
            continue;
        }
        let polish_msg = evaluate_post_build_comparison_polish(subagent_type, &executed_tool_parts);
        let gate_issue = evaluate_subagent_verification_gate_in_workspace(
            subagent_type,
            workspace_dir,
            &executed_tool_parts,
        );
        if gate_issue.is_some() || polish_msg.is_some() {
            let refinement = extract_latest_fidelity_refinement_hint(&executed_tool_parts);
            let max_gate_retries = if refinement.is_some() || polish_msg.is_some() { 2 } else { 1 };
            if verification_retries < max_gate_retries && steps_run < max_steps {
                verification_retries += 1;
                let primary_reason = gate_issue
                    .as_deref()
                    .or(polish_msg.as_deref())
                    .unwrap_or("Verification required");
                let extra_refinement = refinement
                    .map(|(_, msg)| format!("\n\n{}", msg))
                    .or_else(|| {
                        gate_issue
                            .as_ref()
                            .and(polish_msg.as_ref())
                            .map(|p| format!("\n\n{}", p))
                    })
                    .unwrap_or_default();
                chat_messages.push(json!({
                    "role": "user",
                    "content": format!(
                        "SUBAGENT VERIFICATION GATE (attempt {}/{}): Cannot complete task yet — {}. Fix unresolved issues, compare `.aetheria/preview/comparison_strip.jpg` (Reference | Preview | Diff Heatmap), refine weak scenes, and re-run `capture_film_preview(compareToReference: true)` before finishing.{}",
                        verification_retries, max_gate_retries, primary_reason, extra_refinement
                    )
                }));
                continue;
            }
            if let Some(hard_err) = gate_issue {
                exit_outcome = SubagentExitOutcome::Incomplete(hard_err);
                break;
            }
        }
        exit_outcome = SubagentExitOutcome::Completed;
        break;
        }
    }

    drop(_subagent_turn_permit);

    let (ok_flag, state_str, error_field) = match &exit_outcome {
        SubagentExitOutcome::Completed => {
            crate::session::job_registry::settle_job_completed(&child_session_id, Some(final_text.clone()));
            (true, "completed", None)
        }
        SubagentExitOutcome::Incomplete(reason) => {
            crate::session::job_registry::settle_job_error(&child_session_id, reason);
            (false, "incomplete", Some(reason.clone()))
        }
        SubagentExitOutcome::Error(err) => {
            crate::session::job_registry::settle_job_error(&child_session_id, err);
            (false, "error", Some(err.clone()))
        }
    };

    persist_child_session_state(&child_session_id, &chat_messages, state_str);
    crate::paths::log_engine(
        "subagent",
        &format!(
            "[F4_SUBAGENT_SUMMARY] session={} role={} state={} steps={} max_tokens={} reasoning={} length_hits={} model={}/{}",
            child_session_id,
            subagent_type,
            state_str,
            steps_run,
            subagent_max_tokens,
            subagent_reasoning.as_deref().unwrap_or("default"),
            length_hits_total,
            provider_id,
            model_id,
        ),
    );
    emit_event(
        workspace_dir,
        "subagent.completed",
        json!({
            "parentSessionId": parent_session_id, "subagentSessionId": child_session_id,
            "subagentType": subagent_type, "description": description, "state": state_str,
            "ok": ok_flag, "stepsRun": steps_run, "toolsExecuted": tools_executed,
            "outputLimitHits": length_hits_total, "maxTokensUsed": subagent_max_tokens,
            "error": error_field, "timestamp": now_ms()
        }),
    );

    let body_summary = if !final_text.trim().is_empty() {
        final_text.clone()
    } else if let Some(ref err_msg) = error_field {
        format!("Subagent [{}] stopped in state '{}' after {} steps (tools called: {:?}). Reason: {}", subagent_type, state_str, steps_run, tools_executed, err_msg)
    } else {
        format!("Subagent [{}] completed {} steps (tools called: {:?}).", subagent_type, steps_run, tools_executed)
    };
    let formatted_envelope = if let Some(ref err_msg) = error_field {
        format!("<subagent sessionID=\"{}\" type=\"{}\" state=\"{}\">\n{}\n\n[Diagnostic: {}]\n</subagent>", child_session_id, subagent_type, state_str, body_summary, err_msg)
    } else {
        format!("<subagent sessionID=\"{}\" type=\"{}\" state=\"{}\">\n{}\n</subagent>", child_session_id, subagent_type, state_str, body_summary)
    };

    let mut result = json!({
        "ok": ok_flag, "state": state_str, "sessionID": child_session_id,
        "subagent_type": subagent_type, "description": description, "resumed": is_resumed,
        "steps_executed": steps_run, "tools_called": tools_executed,
        "outputLimitHits": length_hits_total, "maxTokensUsed": subagent_max_tokens,
        "output": formatted_envelope
    });
    if let Some(err_msg) = error_field {
        result["error"] = json!(err_msg);
    }
    result
}

/// Checks whether a subagent has unresolved tool/verify failures, skipped preview, or unfixed script stubs/errors.
#[allow(dead_code)] // Direct unit-test convenience wrapper without filesystem workspace inspection.
pub(crate) fn evaluate_subagent_verification_gate(
    subagent_type: &str,
    executed_tool_parts: &[Value],
) -> Option<String> {
    evaluate_subagent_verification_gate_in_workspace(subagent_type, "", executed_tool_parts)
}

pub(crate) fn evaluate_subagent_verification_gate_in_workspace(
    subagent_type: &str,
    workspace_dir: &str,
    executed_tool_parts: &[Value],
) -> Option<String> {
    let mut issues = super::history::collect_unresolved_mutating_or_verify_failures(executed_tool_parts);

    let sub_lower = subagent_type.trim().to_ascii_lowercase();
    let mut touched_mutation = false;
    let mut preview_ok_after_last_mutation = false;
    let mut any_preview_ok = false;
    let mut touched_paths: Vec<String> = Vec::new();

    for p in executed_tool_parts {
        if p.get("type").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        if p.pointer("/state/structured/syntaxError")
            .and_then(Value::as_bool)
            == Some(true)
            || p.pointer("/state/structured/blocked")
                .and_then(Value::as_bool)
                == Some(true)
        {
            continue;
        }
        let name = p
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let status = p
            .pointer("/state/status")
            .and_then(Value::as_str)
            .unwrap_or("");
        let structured_ok =
            p.pointer("/state/structured/ok").and_then(Value::as_bool) != Some(false);
        let ok = status == "completed" && structured_ok;

        if ok
            && matches!(
                name.as_str(),
                "edit" | "write" | "apply_patch" | "film_scaffold" | "codemode"
            )
        {
            touched_mutation = true;
            preview_ok_after_last_mutation = false;
            if let Some(fp) = p
                .pointer("/state/input/filePath")
                .or_else(|| p.pointer("/state/input/path"))
                .and_then(Value::as_str)
            {
                if !touched_paths.iter().any(|x| x == fp) {
                    touched_paths.push(fp.to_string());
                }
            }
        } else if ok && name == "capture_film_preview" {
            any_preview_ok = true;
            preview_ok_after_last_mutation = true;
        }
    }

    if sub_lower == "motion-designer" && touched_mutation && !preview_ok_after_last_mutation {
        issues.push(
            "Missing clean 'capture_film_preview' verification after modifying workspace files"
                .to_string(),
        );
    } else if sub_lower == "qa-verifier" && !any_preview_ok {
        issues.push("'qa-verifier' did not complete a clean 'capture_film_preview'".to_string());
    }

    if !workspace_dir.trim().is_empty() {
        if sub_lower == "motion-designer" {
            for rel in &touched_paths {
                let norm = rel.replace('\\', "/").to_ascii_lowercase();
                if !norm.contains("script/") || !norm.ends_with(".js") {
                    continue;
                }
                if let Ok(resolved) = crate::tool::path_guard::resolve_isolated_path(workspace_dir, rel) {
                    if resolved.is_file() {
                        if let Ok(text) = std::fs::read_to_string(&resolved) {
                            if crate::tool::film_state::is_scaffold_stub_content(&text) {
                                issues.push(format!("Touched scene '{}' is still a scaffold stub", rel));
                                continue;
                            }
                        }
                        let fb = crate::tool::film_feedback::collect_file_feedback(workspace_dir, &resolved);
                        if fb.has_errors {
                            for d in fb.diagnostics {
                                if d.starts_with("ERROR") {
                                    issues.push(format!("{} -> {}", rel, d));
                                }
                            }
                        }
                    }
                }
            }
        } else if sub_lower == "qa-verifier" {
            issues.extend(crate::tool::film_state::collect_film_completion_blockers(
                workspace_dir,
            ));
        }
    }

    if issues.is_empty() {
        None
    } else {
        Some(issues.join("; "))
    }
}

/// Extracts bounded visual refinement instructions (`P1-3`) from the latest failing `capture_film_preview` tool part.
pub(crate) fn extract_latest_fidelity_refinement_hint(
    executed_tool_parts: &[Value],
) -> Option<(bool, String)> {
    let latest_preview = executed_tool_parts.iter().rev().find(|p| {
        p.get("type").and_then(Value::as_str) == Some("tool")
            && p.get("name")
                .and_then(Value::as_str)
                .is_some_and(|n| n.eq_ignore_ascii_case("capture_film_preview"))
    })?;
    let structured = latest_preview.pointer("/state/structured")?;
    if structured.get("ok").and_then(Value::as_bool) != Some(false) {
        return None;
    }
    let cmp = structured.get("referenceComparison")?;
    if cmp.get("passed").and_then(Value::as_bool) != Some(false)
        && cmp.get("aspectRatioMismatch").and_then(Value::as_bool) != Some(true)
    {
        return None;
    }

    let attempt = cmp.get("attempt").and_then(Value::as_u64).unwrap_or(1);
    let overall = cmp.get("overallFidelity").and_then(Value::as_f64).unwrap_or(0.0);
    let thr = cmp.get("passThreshold").and_then(Value::as_f64).unwrap_or(0.85);
    let regressed = cmp.get("regressedFromPrevious").and_then(Value::as_bool) == Some(true);
    let targets: String = cmp
        .get("targetWorstScenes")
        .and_then(Value::as_array)
        .filter(|a| !a.is_empty())
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    let sid = t.get("sceneId").and_then(Value::as_str).unwrap_or("scene");
                    let sc = t.get("script").and_then(Value::as_str).unwrap_or("script/scene*.js");
                    let ts = t.get("timestamp").and_then(Value::as_f64).unwrap_or(0.0);
                    let comb = t.get("combinedScore").and_then(Value::as_f64).unwrap_or(0.0);
                    format!("{sid} ({sc} @ t={ts:.2}s, score={comb:.3})")
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|| "low-scoring frames in worstFrames".to_string());

    let reg_note = if regressed {
        let prev = cmp.get("previousOverall").and_then(Value::as_f64).unwrap_or(0.0);
        format!(" SCORE REGRESSED from {prev:.3} -> {overall:.3}: undo/revise the last change.")
    } else {
        String::new()
    };
    Some((
        regressed,
        format!(
            "BOUNDED VISUAL REFINEMENT (attempt #{attempt}, overall={overall:.3} < required {thr:.2}): Patch ONLY {targets} without overwriting passing scenes. Inspect `.aetheria/preview/comparison_strip.jpg` and re-run `capture_film_preview(compareToReference: true)`.{reg_note}"
        ),
    ))
}

/// Enforces one mandatory visual self-evaluation & Diff Heatmap calibration pass before `motion-designer`
/// stops after its very first reference preview capture when there is measurable fidelity/edge headroom.
pub(crate) fn evaluate_post_build_comparison_polish(
    subagent_type: &str,
    executed_tool_parts: &[Value],
) -> Option<String> {
    if !subagent_type.trim().eq_ignore_ascii_case("motion-designer") {
        return None;
    }
    let completed_previews: Vec<&Value> = executed_tool_parts
        .iter()
        .filter(|p| {
            p.get("type").and_then(Value::as_str) == Some("tool")
                && p.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|n| n.eq_ignore_ascii_case("capture_film_preview"))
                && p.pointer("/state/status").and_then(Value::as_str) == Some("completed")
        })
        .collect();
    let preview_count = completed_previews.len();
    if preview_count == 0 || preview_count >= 3 {
        return None;
    }
    let latest_structured = completed_previews.last()?.pointer("/state/structured")?;
    if latest_structured.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let cmp = latest_structured.get("referenceComparison")?;
    if cmp.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let overall = cmp.get("overallFidelity").and_then(Value::as_f64).unwrap_or(0.0);
    let edge_mean = cmp.get("edgeMatchMean").and_then(Value::as_f64).unwrap_or(0.0);
    let score_delta = cmp.get("scoreDelta").and_then(Value::as_f64).unwrap_or(0.0);
    let worst_arr_opt = cmp.get("targetWorstScenes").and_then(Value::as_array);
    let worst_scene_low = worst_arr_opt
        .map(|arr| {
            arr.iter()
                .any(|x| x.get("combinedScore").and_then(Value::as_f64).unwrap_or(1.0) < 0.82)
        })
        .unwrap_or(false);
    let worst_scene_broken = worst_arr_opt
        .map(|arr| {
            arr.iter()
                .any(|x| x.get("combinedScore").and_then(Value::as_f64).unwrap_or(1.0) < 0.62)
        })
        .unwrap_or(false);

    if preview_count == 1 && overall >= 0.85 && edge_mean >= 0.62 && !worst_scene_low {
        return None;
    }
    if preview_count == 2
        && !(overall < 0.80 && (worst_scene_broken || score_delta <= 0.005 || edge_mean < 0.38))
    {
        return None;
    }
    let targets = cmp
        .get("targetWorstScenes")
        .and_then(Value::as_array)
        .filter(|a| !a.is_empty())
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    let sid = t.get("sceneId").and_then(Value::as_str).unwrap_or("scene");
                    let sc = t.get("script").and_then(Value::as_str).unwrap_or("script/scene*.js");
                    let comb = t.get("combinedScore").and_then(Value::as_f64).unwrap_or(0.0);
                    let diag = t.get("diagnosis").and_then(Value::as_str).unwrap_or("");
                    if diag.is_empty() {
                        format!("{sid} ({sc}, score={comb:.3})")
                    } else {
                        format!("{sid} ({sc}, score={comb:.3}: {diag})")
                    }
                })
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_else(|| "weakest scenes in comparison_strip.jpg".to_string());

    if preview_count == 1 {
        Some(format!(
            "EVALUATION & DIFF HEATMAP POLISH PASS (preview #1 -> overall={overall:.3}, edge={edge_mean:.3}): Never stop right after initial build. Compare `.aetheria/preview/comparison_strip.jpg` (`Reference | Preview | Diff Heatmap`) against `contact_sheet_*.jpg` + `<active_video_reference_report>`, refine coordinates/tilt/polarity/cleanPlate brightness/fontWeight/sub-beats on ONLY {targets}, and run `capture_film_preview(compareToReference: true)` (keeping `passThreshold: 0.65` for brand adaptations) again to confirm measurable improvement."
        ))
    } else {
        Some(format!(
            "FINAL REMEDIATION POLISH PASS (preview #2 -> overall={overall:.3}, edge={edge_mean:.3}, delta={score_delta:+.3}): Weak scenes still scored <0.62 or stalled without improvement. Inspect LEFT vs MIDDLE panels in `.aetheria/preview/comparison_strip.jpg` and `<active_video_reference_report>` carefully for inverted light/dark polarity, grid tilt angle, cleanPlate background lightness, or missed early->mid->late `subBeats`, fix ONLY {targets}, and run `capture_film_preview(compareToReference: true)` (keeping `passThreshold: 0.65` for brand adaptations) once more."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_subagent_empty_prompt_returns_structured_error() {
        let out = execute_subagent("sess_parent_test", "E:\\JS\\ArunakiNexus\\workspace", &json!({
            "description": "Empty test", "prompt": "   ", "subagent_type": "explore"
        })).await;
        assert_eq!(out["ok"], false);
        assert_eq!(out["state"], "error");
    }

    #[tokio::test]
    async fn test_subagent_recursion_depth_guard_blocks_deep_nesting() {
        crate::session::session::with_store(|store| {
            store.sessions.insert("sess_deep_child".to_string(), json!({ "id": "sess_deep_child", "subagentDepth": MAX_SUBAGENT_DEPTH }));
        });
        let out = execute_subagent("sess_deep_child", "E:\\JS\\ArunakiNexus\\workspace", &json!({
            "description": "Nested spawn", "prompt": "Try spawning another subagent", "subagent_type": "general"
        })).await;
        assert_eq!(out["ok"], false);
        assert_eq!(out["state"], "error");
    }

    #[test]
    fn test_child_session_creation_and_continuation() {
        let unique_child_id = crate::paths::gen_id("sub_test_cont");
        let (child_id, initial_msgs, resumed) = load_or_init_child_session(
            "parent_123", Some(&unique_child_id), "explore", "Find files", 1, "You are Explore.", "Step 1 prompt",
        );
        assert_eq!(child_id, unique_child_id);
        assert!(!resumed);
        assert_eq!(initial_msgs.len(), 2);
        let mut updated = initial_msgs;
        updated.push(json!({ "role": "assistant", "content": "Found 3 files." }));
        persist_child_session_state(&child_id, &updated, "incomplete");
        let (resumed_id, resumed_msgs, is_resumed) = load_or_init_child_session(
            "parent_123", Some(&unique_child_id), "explore", "Continue finding files", 1, "You are Explore.", "Step 2 continuation prompt",
        );
        assert_eq!(resumed_id, unique_child_id);
        assert!(is_resumed);
        assert_eq!(resumed_msgs.len(), 4);
    }

    #[test]
    fn subagent_verification_gate_flags_unresolved_failures_and_missing_preview() {
        let unresolved_parts = vec![json!({
            "type": "tool",
            "name": "edit",
            "state": {
                "status": "error",
                "input": { "filePath": "script/scene1.js" },
                "structured": { "ok": false, "error": "oldString not found" }
            }
        })];
        let gate_err = evaluate_subagent_verification_gate("general", &unresolved_parts)
            .expect("unresolved edit should trigger gate");
        assert!(gate_err.contains("script/scene1.js"));

        let missing_preview_parts = vec![json!({
            "type": "tool",
            "name": "write",
            "state": {
                "status": "completed",
                "input": { "filePath": "script/scene1.js" },
                "structured": { "ok": true }
            }
        })];
        let preview_err =
            evaluate_subagent_verification_gate("motion-designer", &missing_preview_parts)
                .expect("motion-designer without capture_film_preview must fail gate");
        assert!(preview_err.contains("capture_film_preview"));

        let verified_parts = vec![
            missing_preview_parts[0].clone(),
            json!({
                "type": "tool",
                "name": "capture_film_preview",
                "state": {
                    "status": "completed",
                    "input": {},
                    "structured": { "ok": true }
                }
            }),
        ];
        assert!(evaluate_subagent_verification_gate("motion-designer", &verified_parts).is_none());
        assert!(evaluate_subagent_verification_gate("qa-verifier", &verified_parts).is_none());
        assert!(evaluate_subagent_verification_gate("qa-verifier", &[]).is_some());
    }

    #[test]
    fn extract_latest_fidelity_refinement_hint_surfaces_worst_scenes_and_regression() {
        let failing_parts = vec![json!({
            "type": "tool",
            "name": "capture_film_preview",
            "state": {
                "status": "completed",
                "input": { "compareToReference": true },
                "structured": {
                    "ok": false,
                    "referenceComparison": {
                        "ok": true,
                        "attempt": 2,
                        "overallFidelity": 0.61,
                        "previousOverall": 0.69,
                        "regressedFromPrevious": true,
                        "passThreshold": 0.85,
                        "passed": false,
                        "aspectRatioMismatch": false,
                        "targetWorstScenes": [
                            {
                                "sceneId": "scene2_payoff",
                                "script": "script/scene2.js",
                                "timestamp": 3.5,
                                "combinedScore": 0.48
                            }
                        ]
                    }
                }
            }
        })];
        let (regressed, hint) =
            extract_latest_fidelity_refinement_hint(&failing_parts).expect("expected hint");
        assert!(regressed);
        assert!(hint.contains("scene2_payoff"));
        assert!(hint.contains("script/scene2.js"));
        assert!(hint.contains("SCORE REGRESSED"));
    }

    #[test]
    fn post_build_polish_requires_second_evaluation_when_first_pass_has_headroom() {
        let single_pass = vec![json!({
            "type": "tool",
            "name": "capture_film_preview",
            "state": {
                "status": "completed",
                "structured": {
                    "ok": true,
                    "referenceComparison": {
                        "ok": true,
                        "overallFidelity": 0.71,
                        "edgeMatchMean": 0.41,
                        "targetWorstScenes": [
                            {
                                "sceneId": "scene3_card_zoom",
                                "script": "script/scene3.js",
                                "combinedScore": 0.58,
                                "diagnosis": "edge mismatch"
                            }
                        ]
                    }
                }
            }
        })];
        let msg = evaluate_post_build_comparison_polish("motion-designer", &single_pass)
            .expect("first preview with overall=0.71 must trigger polish evaluation");
        assert!(msg.contains("scene3_card_zoom"));
        assert!(msg.contains("comparison_strip.jpg"));

        let improved_second = vec![
            single_pass[0].clone(),
            json!({
                "type": "tool",
                "name": "capture_film_preview",
                "state": {
                    "status": "completed",
                    "structured": {
                        "ok": true,
                        "referenceComparison": {
                            "ok": true,
                            "overallFidelity": 0.82,
                            "edgeMatchMean": 0.65,
                            "scoreDelta": 0.11,
                            "targetWorstScenes": [
                                {
                                    "sceneId": "scene3_card_zoom",
                                    "script": "script/scene3.js",
                                    "combinedScore": 0.74,
                                    "diagnosis": ""
                                }
                            ]
                        }
                    }
                }
            }),
        ];
        assert!(
            evaluate_post_build_comparison_polish("motion-designer", &improved_second).is_none(),
            "improved second preview pass (>=0.80 with positive delta and no <0.62 scene) should allow completion"
        );

        let stalled_broken_second = vec![single_pass[0].clone(), single_pass[0].clone()];
        let remediate = evaluate_post_build_comparison_polish("motion-designer", &stalled_broken_second)
            .expect("second preview pass that still leaves <0.62 scene with zero delta must trigger final remediation");
        assert!(remediate.contains("FINAL REMEDIATION POLISH PASS"));

        let low_edge_second = vec![
            single_pass[0].clone(),
            json!({
                "type": "tool",
                "name": "capture_film_preview",
                "state": {
                    "status": "completed",
                    "structured": {
                        "ok": true,
                        "referenceComparison": {
                            "ok": true,
                            "overallFidelity": 0.73,
                            "edgeMatchMean": 0.28,
                            "scoreDelta": 0.02,
                            "targetWorstScenes": [
                                { "sceneId": "scene4_cta", "script": "script/scene4.js", "combinedScore": 0.72, "diagnosis": "edge mismatch" }
                            ]
                        }
                    }
                }
            }),
        ];
        assert!(
            evaluate_post_build_comparison_polish("motion-designer", &low_edge_second)
                .is_some_and(|m| m.contains("FINAL REMEDIATION POLISH PASS")),
            "second preview pass with overall < 0.80 and low edgeMatchMean (< 0.38) should trigger final polish"
        );

        let three_passes = vec![
            single_pass[0].clone(),
            single_pass[0].clone(),
            single_pass[0].clone(),
        ];
        assert!(
            evaluate_post_build_comparison_polish("motion-designer", &three_passes).is_none(),
            "third preview pass should always allow clean completion"
        );

        let already_sharp = vec![json!({
            "type": "tool",
            "name": "capture_film_preview",
            "state": {
                "status": "completed",
                "structured": {
                    "ok": true,
                    "referenceComparison": {
                        "ok": true,
                        "overallFidelity": 0.89,
                        "edgeMatchMean": 0.72,
                        "targetWorstScenes": []
                    }
                }
            }
        })];
        assert!(evaluate_post_build_comparison_polish("motion-designer", &already_sharp).is_none());
    }
}
