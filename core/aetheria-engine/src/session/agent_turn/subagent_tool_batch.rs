//! Single-Step Subagent Tool Batch Runner
//! Executes tool calls for one subagent step concurrently via `join_all` with JSON repair,
//! doom-loop protection, supervised `execute_tool_call`, UI telemetry events, and output bounding.

use serde_json::{json, Value};

use crate::paths::now_ms;
use crate::session::doom_loop::DoomLoopDetector;
use crate::session::message::emit_event;
use crate::session::tool_label_formatter::format_tool_step_label;
use crate::tool::json_repair::{canonicalize_tool_name, parse_or_repair_tool_args};
use crate::tool::truncator::bound_tool_output;

struct PreparedSubagentCall {
    call_id: String,
    fn_name: String,
    parsed_args: Value,
    syntax_error: Option<String>,
    policy_error: Option<String>,
    loop_error: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_subagent_tool_calls(
    parent_session_id: &str,
    child_session_id: &str,
    workspace_dir: &str,
    subagent_type: &str,
    steps_run: usize,
    model_supports_vision: bool,
    tool_calls: &[Value],
    doom_detector: &mut DoomLoopDetector,
    tools_executed: &mut Vec<String>,
    executed_tool_parts: &mut Vec<Value>,
    chat_messages: &mut Vec<Value>,
) -> Option<String> {
    let mut prepared = Vec::with_capacity(tool_calls.len());

    for (idx, tc) in tool_calls.iter().enumerate() {
        let cid = tc
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("sub_call_{}_{}", steps_run, idx));
        let raw_fn_name = tc
            .pointer("/function/name")
            .or_else(|| tc.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let fn_name = canonicalize_tool_name(raw_fn_name).to_string();
        let raw_args = tc
            .pointer("/function/arguments")
            .or_else(|| tc.get("arguments"))
            .and_then(|v| v.as_str())
            .unwrap_or("{}");

        let (mut parsed_args, syntax_error) = match parse_or_repair_tool_args(raw_args) {
            Ok(val) => (val, None),
            Err(repair_err) => (json!({}), Some(repair_err)),
        };

        let mut scoped_scene_guard_error: Option<String> = None;
        if syntax_error.is_none() && subagent_type.trim().eq_ignore_ascii_case("motion-designer") {
            let scoped_targets = chat_messages
                .iter()
                .find(|m| m.get("role").and_then(Value::as_str) == Some("user"))
                .and_then(|m| {
                    let c = m.get("content")?;
                    if let Some(s) = c.as_str() {
                        Some(s.to_string())
                    } else if let Some(arr) = c.as_array() {
                        arr.iter()
                            .filter_map(|p| p.get("text").and_then(Value::as_str))
                            .next()
                            .map(str::to_string)
                    } else {
                        None
                    }
                })
                .map(|first_user_text| {
                    let prompt_head: String = first_user_text
                        .split("<active_video_reference_report>")
                        .next()
                        .unwrap_or(&first_user_text)
                        .chars()
                        .take(1400)
                        .collect();
                    let raw =
                        super::subagent_scene_scope::extract_target_scene_indices(&prompt_head);
                    super::subagent_scene_scope::clamp_target_scene_indices_for_reference(
                        workspace_dir,
                        &raw,
                    )
                })
                .unwrap_or_default();

            let is_focused = super::subagent_scene_scope::is_focused_scene_subset(
                workspace_dir,
                &scoped_targets,
            );
            if fn_name == "capture_film_preview" && is_focused {
                let has_explicit_ts = parsed_args
                    .get("timestamps")
                    .and_then(Value::as_array)
                    .is_some_and(|a| !a.is_empty());
                if !has_explicit_ts && parsed_args.get("targetSceneIndices").is_none() {
                    if let Some(obj) = parsed_args.as_object_mut() {
                        obj.insert("targetSceneIndices".to_string(), json!(scoped_targets));
                    }
                }
            } else if is_focused && matches!(fn_name.as_str(), "write" | "edit" | "multiedit") {
                if let Some(fp) = parsed_args
                    .get("filePath")
                    .or_else(|| parsed_args.get("path"))
                    .and_then(Value::as_str)
                {
                    if let Some(scene_num) =
                        super::subagent_scene_scope::extract_scene_script_number(fp)
                    {
                        if !scoped_targets.contains(&scene_num) {
                            scoped_scene_guard_error = Some(format!(
                                "SCENE SCOPE GUARD: This motion-designer task is scoped strictly to Scene(s) {:?}. Modifying '{}' (Scene {}) outside your assigned scene scope is blocked to prevent cross-scene regression.",
                                scoped_targets, fp, scene_num
                            ));
                        }
                    }
                }
            }
        }

        let sub_profile = crate::tool::profiles::ToolProfile::from_subagent_type(subagent_type);
        let policy_error = if let Some(scope_err) = scoped_scene_guard_error {
            Some(scope_err)
        } else if fn_name == "question" {
            Some("Tool 'question' is unavailable inside subagents.".to_string())
        } else {
            crate::tool::profiles::check_tool_allowed_runtime(sub_profile, &fn_name).err()
        };

        let loop_error = if syntax_error.is_none() && policy_error.is_none() {
            let canonical_args =
                serde_json::to_string(&parsed_args).unwrap_or_else(|_| raw_args.to_string());
            doom_detector.check_and_record(&fn_name, &canonical_args)
        } else {
            None
        };

        let label = format_tool_step_label(&fn_name, &parsed_args, false);
        if syntax_error.is_none() && policy_error.is_none() && loop_error.is_none() {
            tools_executed.push(fn_name.clone());
            emit_event(
                workspace_dir,
                "subagent.tool.called",
                json!({
                    "parentSessionId": parent_session_id,
                    "subagentSessionId": child_session_id,
                    "subagentType": subagent_type,
                    "callID": cid,
                    "tool": fn_name,
                    "label": label,
                    "step": steps_run,
                    "timestamp": now_ms()
                }),
            );
        }

        prepared.push(PreparedSubagentCall {
            call_id: cid,
            fn_name,
            parsed_args,
            syntax_error,
            policy_error,
            loop_error,
        });
    }

    let futures = prepared.iter().map(|pc| async move {
        if let Some(err) = &pc.syntax_error {
            return (json!({ "ok": false, "error": err, "syntaxError": true }), false);
        }
        if let Some(err) = &pc.policy_error {
            return (json!({ "ok": false, "error": err, "blocked": true }), false);
        }
        if let Some(reason) = &pc.loop_error {
            return (json!({ "ok": false, "error": reason }), false);
        }
        let result = crate::tool::execute_tool_call(
            child_session_id,
            &pc.call_id,
            &pc.call_id,
            &pc.fn_name,
            &pc.parsed_args,
            workspace_dir,
        )
        .await;
        (result, true)
    });

    let results = futures_util::future::join_all(futures).await;

    let mut aborted_reason: Option<String> = None;
    let mut collected_vision_images = Vec::new();
    for (pc, (mut tool_result, was_executed)) in prepared.into_iter().zip(results.into_iter()) {
        if let Some(reason) = pc.loop_error {
            if aborted_reason.is_none() {
                aborted_reason = Some(reason);
            }
        }
        super::vision::extract_tool_vision_images_with_notice(
            &mut tool_result,
            &mut collected_vision_images,
            model_supports_vision,
        );
        let is_err = !was_executed
            || tool_result.get("error").is_some()
            || tool_result.get("ok").and_then(|v| v.as_bool()) == Some(false);
        if was_executed {
            if let Some(intervention) =
                doom_detector.record_outcome(&pc.fn_name, &pc.parsed_args, is_err)
            {
                if let Some(obj) = tool_result.as_object_mut() {
                    obj.insert("harnessIntervention".to_string(), json!(intervention));
                }
            }
            let done_label = format_tool_step_label(&pc.fn_name, &pc.parsed_args, !is_err);
            emit_event(
                workspace_dir,
                "subagent.tool.completed",
                json!({
                    "parentSessionId": parent_session_id,
                    "subagentSessionId": child_session_id,
                    "subagentType": subagent_type,
                    "callID": pc.call_id,
                    "tool": pc.fn_name,
                    "label": done_label,
                    "ok": !is_err,
                    "error": tool_result.get("error").and_then(|v| v.as_str()),
                    "step": steps_run,
                    "timestamp": now_ms()
                }),
            );
        }
        executed_tool_parts.push(json!({
            "type": "tool",
            "id": pc.call_id,
            "name": pc.fn_name,
            "state": {
                "status": if is_err { "error" } else { "completed" },
                "input": pc.parsed_args,
                "structured": tool_result
            }
        }));
        let serialized = serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
        let (bounded_content, _) = bound_tool_output(&pc.fn_name, &serialized);
        chat_messages.push(json!({
            "role": "tool",
            "tool_call_id": pc.call_id,
            "name": pc.fn_name,
            "content": bounded_content
        }));
    }

    super::vision::append_tool_vision_message(
        chat_messages,
        model_supports_vision,
        collected_vision_images,
    );

    aborted_reason
}
