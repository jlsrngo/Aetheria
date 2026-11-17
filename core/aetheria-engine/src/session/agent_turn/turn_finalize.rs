//! Turn Finalization, Synthesis & Persistence Helper
//! Isolated from `runner.rs` so final text synthesis, store saving, job settlement,
//! auto-title generation, usage/finish persistence, and terminal event emission live cleanly here.

use crate::paths::{gen_id, now_ms};
use crate::provider::catalog::resolve_model_cost_tiers;
use crate::provider::read_aetheria_config;
use crate::session::finish_reason::{normalize_finish_reason, FinishReason};
use crate::session::message::emit_event;
use crate::session::session::{save_store, with_store};
use crate::session::session_error::emit_session_error;
use crate::session::usage::{
    cost_to_json, record_step_usage, tokens_to_json, RecordedUsage, TurnUsageAccumulator,
};
use serde_json::{json, Value};

fn save_assistant_message(
    store: &mut crate::session::session::SessionStoreData,
    session_id: &str,
    message: Value,
) {
    let messages = store.messages.entry(session_id.to_string()).or_default();
    let message_id = message.get("id").and_then(|v| v.as_str());
    if let Some(index) = message_id.and_then(|id| {
        messages.iter().position(|m| m.get("id").and_then(|v| v.as_str()) == Some(id))
    }) {
        messages[index] = message;
    } else {
        messages.push(message);
    }
}

fn save_checkpoint_message(
    session_id: &str,
    assistant_msg_id: &str,
    provider_id: &str,
    model_id: &str,
    started_ms: u64,
    content: Vec<Value>,
) {
    let message = json!({
        "id": assistant_msg_id,
        "type": "assistant",
        "role": "assistant",
        "agent": "default",
        "model": { "providerID": provider_id, "id": model_id },
        "content": content,
        "time": { "created": started_ms }
    });
    with_store(|store| {
        save_assistant_message(store, session_id, message);
        save_store(store);
    });
}

pub(crate) fn persist_tool_checkpoint(
    session_id: &str,
    assistant_msg_id: &str,
    provider_id: &str,
    model_id: &str,
    started_ms: u64,
    tool_calls: &[Value],
) {
    let content = tool_calls
        .iter()
        .map(|call| {
            let name = call.pointer("/function/name").and_then(|v| v.as_str()).unwrap_or("tool");
            let id = call.get("id").cloned().unwrap_or(Value::Null);
            let input = call
                .pointer("/function/arguments")
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .unwrap_or_else(|| json!({}));
            json!({
                "type": "tool",
                "id": id,
                "name": name,
                "state": { "status": "running", "input": input },
                "time": { "created": started_ms }
            })
        })
        .collect::<Vec<_>>();
    save_checkpoint_message(
        session_id,
        assistant_msg_id,
        provider_id,
        model_id,
        started_ms,
        content,
    );
}

pub(crate) fn settle_completed_tool_checkpoint(
    session_id: &str,
    assistant_msg_id: &str,
    provider_id: &str,
    model_id: &str,
    started_ms: u64,
    content_parts: &[Value],
) {
    save_checkpoint_message(
        session_id,
        assistant_msg_id,
        provider_id,
        model_id,
        started_ms,
        content_parts.to_vec(),
    );
}

fn maybe_update_session_title(
    store: &mut crate::session::session::SessionStoreData,
    session_id: &str,
    completed_ms: u64,
) {
    if let Some(s) = store.sessions.get_mut(session_id) {
        if let Some(obj) = s.as_object_mut() {
            obj.remove("activeTurn");
        }
        s["time"]["updated"] = json!(completed_ms);
        let cur_title = s.get("title").and_then(|v| v.as_str()).unwrap_or("");
        if cur_title.is_empty()
            || cur_title.eq_ignore_ascii_case("New Session")
            || cur_title.eq_ignore_ascii_case("Chat")
            || cur_title.starts_with("New session -")
            || cur_title.starts_with("New Session -")
        {
            if let Some(first_msg) = store.messages.get(session_id).and_then(|m| m.first()) {
                let text = first_msg.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let auto_title = crate::session::title::derive_session_title(text);
                if auto_title != "New Session" {
                    s["title"] = json!(&auto_title);
                }
            }
        }
    }
}

fn emit_and_append_text_part(
    workspace_dir: &str,
    session_id: &str,
    assistant_msg_id: &str,
    text: &str,
    content_parts: &mut Vec<Value>,
) {
    let txt_part_id = gen_id("txt");
    emit_event(
        workspace_dir,
        "session.next.text.started",
        json!({ "sessionID": session_id, "messageID": assistant_msg_id, "id": txt_part_id }),
    );
    if !text.is_empty() {
        emit_event(
            workspace_dir,
            "session.next.text.delta",
            json!({ "sessionID": session_id, "messageID": assistant_msg_id, "id": txt_part_id, "delta": text }),
        );
    }
    emit_event(
        workspace_dir,
        "session.next.text.ended",
        json!({ "sessionID": session_id, "messageID": assistant_msg_id, "id": txt_part_id, "text": text }),
    );
    content_parts.push(json!({ "type": "text", "id": txt_part_id, "text": text }));
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn finalize_agent_turn(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    provider_id: &str,
    model_id: &str,
    session_id: &str,
    workspace_dir: &str,
    assistant_msg_id: &str,
    started_ms: u64,
    reached_max_steps: bool,
    final_text_streamed: bool,
    mut final_text: String,
    mut content_parts: Vec<Value>,
    chat_messages: &mut Vec<Value>,
    usage_acc: &mut TurnUsageAccumulator,
    mut last_step_usage: Option<RecordedUsage>,
    mut last_finish: FinishReason,
) {
    let blockers = super::history::collect_turn_completion_blockers(&content_parts, workspace_dir);
    let unresolved_notice = if blockers.is_empty() {
        None
    } else {
        crate::paths::log_engine(
            "verification",
            &format!("[F5_COMPLETION_GUARD] session={} blockers={}", session_id, blockers.join(" | ")),
        );
        Some(format!(
            "[Verification notice: unresolved tool failure(s) or unfinished/invalid disk scene(s) remained in this turn — {}.]",
            blockers.join("; ")
        ))
    };

    let mut emit_text_events = !final_text_streamed;
    if final_text.trim().is_empty() {
        emit_text_events = true;
        let synthesis_prompt = if reached_max_steps {
            crate::session::coordinator::MAX_STEPS_PROMPT
        } else if unresolved_notice.is_some() {
            "Some tool operations failed and remain unresolved in this turn. Summarize accurately what succeeded, what failed, and do NOT claim overall completion."
        } else {
            "All requested Aetheria Studio and code operations have completed execution. Provide a clear, concise final summary and answer to the user."
        };
        chat_messages.push(json!({ "role": "user", "content": synthesis_prompt }));

        let req_body = json!({
            "model": model_id,
            "messages": chat_messages,
            "stream": false
        });
        let mut synth_err: Option<String> = None;
        match client
            .post(format!("{}/chat/completions", base_url))
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&req_body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<Value>().await {
                    let cfg = read_aetheria_config();
                    let tiers = resolve_model_cost_tiers(&cfg, provider_id, model_id);
                    let synth_usage = record_step_usage(data.get("usage"), &tiers);
                    usage_acc.record_step(synth_usage);
                    last_step_usage = synth_usage;
                    let raw_finish = data
                        .pointer("/choices/0/finish_reason")
                        .and_then(|v| v.as_str());
                    last_finish = normalize_finish_reason(raw_finish, false);
                    if let Some(txt) = data
                        .pointer("/choices/0/message/content")
                        .and_then(|v| v.as_str())
                    {
                        final_text = txt.trim().to_string();
                    }
                } else {
                    synth_err = Some("invalid JSON response from synthesis endpoint".to_string());
                }
            }
            Ok(resp) => {
                synth_err = Some(format!("HTTP {}", resp.status()));
            }
            Err(e) => {
                synth_err = Some(e.to_string());
            }
        }
        if final_text.trim().is_empty() {
            if let Some(ref reason) = synth_err {
                eprintln!("[turn_finalize] synthesis failed ({}): {}", session_id, reason);
            }
            final_text = if unresolved_notice.is_some() {
                "Turn ended without a model summary; see the unresolved verification notice below."
                    .to_string()
            } else {
                let reason = synth_err.unwrap_or_else(|| "empty synthesis content".to_string());
                format!(
                    "[TURN INCOMPLETE — summary unavailable: {}]",
                    reason
                )
            };
        }
    }

    if emit_text_events {
        if let Some(ref notice) = unresolved_notice {
            if final_text.trim().is_empty() {
                final_text = notice.clone();
            } else if !final_text.contains("[Verification notice:") {
                final_text.push_str("\n\n");
                final_text.push_str(notice);
            }
        }
        emit_and_append_text_part(
            workspace_dir,
            session_id,
            assistant_msg_id,
            &final_text,
            &mut content_parts,
        );
    } else if let Some(ref notice) = unresolved_notice {
        if !final_text.contains("[Verification notice:") {
            let delta = if final_text.trim().is_empty() {
                notice.clone()
            } else {
                format!("\n\n{}", notice)
            };
            final_text.push_str(&delta);
            emit_and_append_text_part(
                workspace_dir,
                session_id,
                assistant_msg_id,
                &delta,
                &mut content_parts,
            );
        }
    }

    let completed_ms = now_ms();
    let total_elapsed = completed_ms.saturating_sub(started_ms);
    crate::paths::log_engine(
        "chat",
        &format!(
            "🏁 Turn completed for session '{}' in {}ms (model: '{}', finish: '{}')",
            session_id,
            total_elapsed,
            model_id,
            last_finish.as_str()
        ),
    );

    let total_usage = usage_acc.totals();
    let assistant_msg = json!({
        "id": assistant_msg_id,
        "type": "assistant",
        "role": "assistant",
        "agent": "default",
        "model": { "providerID": provider_id, "id": model_id },
        "content": content_parts,
        "finish": last_finish.as_str(),
        "cost": cost_to_json(total_usage.as_ref()),
        "tokens": tokens_to_json(total_usage.as_ref()),
        "time": { "created": started_ms, "completed": completed_ms }
    });

    with_store(|store| {
        maybe_update_session_title(store, session_id, completed_ms);
        save_assistant_message(store, session_id, assistant_msg);
        save_store(store);
    });

    if last_finish != FinishReason::ToolCalls {
        emit_event(
            workspace_dir,
            "session.next.step.ended",
            json!({
                "sessionID": session_id,
                "messageID": assistant_msg_id,
                "finish": last_finish.as_str(),
                "cost": cost_to_json(last_step_usage.as_ref()),
                "tokens": tokens_to_json(last_step_usage.as_ref()),
            }),
        );
    }
    crate::session::job_registry::settle_job_completed(&assistant_msg_id, Some(final_text));
    crate::session::session::set_active_run(session_id, false);
    emit_event(workspace_dir, "session.idle", json!({ "sessionID": session_id }));
    emit_event(
        workspace_dir,
        "session.status",
        json!({ "sessionID": session_id, "status": { "type": "idle" } }),
    );
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn finalize_interrupted_turn(
    provider_id: &str,
    model_id: &str,
    session_id: &str,
    workspace_dir: &str,
    assistant_msg_id: &str,
    started_ms: u64,
    content_parts: Vec<Value>,
    usage_acc: &TurnUsageAccumulator,
    reason: &str,
) {
    let completed_ms = now_ms();
    let total_usage = usage_acc.totals();
    let assistant_msg = json!({
        "id": assistant_msg_id,
        "type": "assistant",
        "role": "assistant",
        "agent": "default",
        "model": { "providerID": provider_id, "id": model_id },
        "content": content_parts,
        "finish": "interrupted",
        "cost": cost_to_json(total_usage.as_ref()),
        "tokens": tokens_to_json(total_usage.as_ref()),
        "time": { "created": started_ms, "completed": completed_ms }
    });

    with_store(|store| {
        maybe_update_session_title(store, session_id, completed_ms);
        save_assistant_message(store, session_id, assistant_msg);
        save_store(store);
    });

    crate::session::job_registry::cancel_job(assistant_msg_id, reason);
    crate::session::coordinator::finish_session_turn(session_id);
    crate::session::session::set_active_run(session_id, false);
    emit_event(
        workspace_dir,
        "session.execution.interrupted",
        json!({
            "sessionID": session_id,
            "messageID": assistant_msg_id,
            "reason": reason,
        }),
    );
    emit_event(
        workspace_dir,
        "session.status",
        json!({ "sessionID": session_id, "status": { "type": "idle" } }),
    );
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn finalize_failed_turn(
    provider_id: &str,
    model_id: &str,
    session_id: &str,
    workspace_dir: &str,
    assistant_msg_id: &str,
    started_ms: u64,
    content_parts: Vec<Value>,
    usage_acc: &TurnUsageAccumulator,
    finish: Option<FinishReason>,
    category: &str,
    message: &str,
    retryable: bool,
    status: Option<u16>,
) {
    finalize_failed_turn_with_opts(
        provider_id,
        model_id,
        session_id,
        workspace_dir,
        assistant_msg_id,
        started_ms,
        content_parts,
        usage_acc,
        finish,
        category,
        message,
        retryable,
        status,
        true,
    );
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn finalize_execution_failure(
    provider_id: &str,
    model_id: &str,
    session_id: &str,
    workspace_dir: &str,
    assistant_msg_id: &str,
    started_ms: u64,
    content_parts: Vec<Value>,
    usage_acc: &TurnUsageAccumulator,
    finish: Option<FinishReason>,
    category: &str,
    message: &str,
) {
    finalize_failed_turn_with_opts(
        provider_id,
        model_id,
        session_id,
        workspace_dir,
        assistant_msg_id,
        started_ms,
        content_parts,
        usage_acc,
        finish,
        category,
        message,
        false,
        None,
        false,
    );
}

#[allow(clippy::too_many_arguments)]
fn finalize_failed_turn_with_opts(
    provider_id: &str,
    model_id: &str,
    session_id: &str,
    workspace_dir: &str,
    assistant_msg_id: &str,
    started_ms: u64,
    content_parts: Vec<Value>,
    usage_acc: &TurnUsageAccumulator,
    finish: Option<FinishReason>,
    category: &str,
    message: &str,
    retryable: bool,
    status: Option<u16>,
    emit_step_error: bool,
) {
    if emit_step_error {
        emit_session_error(
            workspace_dir,
            session_id,
            assistant_msg_id,
            category,
            message,
            retryable,
            status,
        );
    }

    let completed_ms = now_ms();
    let total_usage = usage_acc.totals();
    let assistant_msg = json!({
        "id": assistant_msg_id,
        "type": "assistant",
        "role": "assistant",
        "agent": "default",
        "model": { "providerID": provider_id, "id": model_id },
        "content": content_parts,
        "finish": finish.map(|f| f.as_str()),
        "cost": cost_to_json(total_usage.as_ref()),
        "tokens": tokens_to_json(total_usage.as_ref()),
        "error": {
            "type": category,
            "message": message,
            "retryable": retryable,
            "status": status
        },
        "time": { "created": started_ms, "completed": completed_ms }
    });

    with_store(|store| {
        maybe_update_session_title(store, session_id, completed_ms);
        save_assistant_message(store, session_id, assistant_msg);
        save_store(store);
    });

    crate::session::job_registry::settle_job_error(assistant_msg_id, message);
    crate::session::session::set_active_run(session_id, false);
    emit_event(
        workspace_dir,
        "session.execution.failed",
        json!({
            "sessionID": session_id,
            "messageID": assistant_msg_id,
            "error": { "type": category, "message": message }
        }),
    );
    emit_event(
        workspace_dir,
        "session.status",
        json!({ "sessionID": session_id, "status": { "type": "idle" } }),
    );
}
