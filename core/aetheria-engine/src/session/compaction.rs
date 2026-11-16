//! Session History Compaction Engine — mirrors OpenCode `packages/core/src/session/compaction.ts`.
//!
//! Compacts older conversational turns into a structured, anchored summary
//! (Objective, Relevant Files, Completed Actions, Findings) while preserving
//! the most recent messages intact. This prevents context exhaustion on long sessions.

use serde_json::{json, Value};

/// Default buffer in tokens before context window exhaustion to trigger compaction.
pub const DEFAULT_BUFFER_TOKENS: usize = 20_000;

/// Number of tokens dedicated to keeping recent turns intact.
pub const DEFAULT_KEEP_TOKENS: usize = 8_000;

/// Minimum recent messages to preserve intact even under tight budgets.
pub const MIN_RECENT_MESSAGES_TO_PRESERVE: usize = 6;

/// Default assumed context window if not specified by provider (128k standard).
pub const DEFAULT_CONTEXT_WINDOW: usize = 128_000;

/// Approximates token count using character length (~4 characters per token).
pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// Approximates token count of a JSON Value message.
pub fn estimate_message_tokens(msg: &Value) -> usize {
    if let Some(txt) = msg.get("text").and_then(|v| v.as_str()) {
        return estimate_tokens(txt);
    }
    if let Some(content) = msg.get("content") {
        if let Some(s) = content.as_str() {
            return estimate_tokens(s);
        }
        if let Some(arr) = content.as_array() {
            let total_chars: usize = arr
                .iter()
                .map(|item| {
                    if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                        t.len()
                    } else if let Some(tc) = item.pointer("/state/content/0/text").and_then(|v| v.as_str()) {
                        tc.len()
                    } else {
                        40
                    }
                })
                .sum();
            return total_chars.div_ceil(4);
        }
    }
    25
}

/// Computes the total estimated tokens across all messages in history.
pub fn total_history_tokens(history: &[Value]) -> usize {
    history.iter().map(estimate_message_tokens).sum()
}

/// Checks if the history should be compacted based on context limits.
pub fn should_compact(history: &[Value], context_limit: usize) -> bool {
    if history.len() <= MIN_RECENT_MESSAGES_TO_PRESERVE {
        return false;
    }
    let threshold = context_limit.saturating_sub(DEFAULT_BUFFER_TOKENS);
    total_history_tokens(history) > threshold
}

pub use super::provider_error::{
    is_context_overflow_error, is_quota_or_rate_limit_error, is_rate_limit_exclusion,
};


/// Compacts session history when approaching or exceeding context limits.
///
/// Returns `(compacted_history, was_compacted)`.
/// - Older messages are synthesized into an anchored OpenCode summary block.
/// - Recent messages (up to `DEFAULT_KEEP_TOKENS` or `MIN_RECENT_MESSAGES_TO_PRESERVE`) are kept intact.
pub fn compact_session_history(history: &[Value], context_limit: usize) -> (Vec<Value>, bool) {
    if history.len() <= MIN_RECENT_MESSAGES_TO_PRESERVE {
        return (history.to_vec(), false);
    }

    let total_tokens = total_history_tokens(history);
    let threshold = context_limit.saturating_sub(DEFAULT_BUFFER_TOKENS);

    if total_tokens <= threshold {
        return (history.to_vec(), false);
    }

    // Determine split point: count backwards from newest to fill DEFAULT_KEEP_TOKENS
    let mut keep_tokens = 0usize;
    let mut split_idx = history.len();

    for (i, msg) in history.iter().enumerate().rev() {
        let msg_tokens = estimate_message_tokens(msg);
        let items_kept = history.len() - i;

        if keep_tokens + msg_tokens > DEFAULT_KEEP_TOKENS && items_kept >= MIN_RECENT_MESSAGES_TO_PRESERVE {
            split_idx = i + 1;
            break;
        }

        keep_tokens += msg_tokens;
        split_idx = i;
    }

    // Ensure at least 1 message is in head to compact
    if split_idx == 0 {
        split_idx = history.len().saturating_sub(MIN_RECENT_MESSAGES_TO_PRESERVE);
    }

    if split_idx == 0 || split_idx >= history.len() {
        return (history.to_vec(), false);
    }

    let head = &history[..split_idx];
    let tail = &history[split_idx..];

    let summary = synthesize_compact_summary(head);

    let mut compacted = Vec::with_capacity(tail.len() + 1);
    compacted.push(json!({
        "type": "synthetic",
        "role": "system",
        "text": summary,
        "content": [{ "type": "text", "text": summary }],
        "compacted": true
    }));

    compacted.extend_from_slice(tail);
    (compacted, true)
}

pub use super::compaction_emergency::emergency_compact_messages;


/// Builds a structured OpenCode-standard markdown summary from older messages.
fn synthesize_compact_summary(messages: &[Value]) -> String {
    let mut objective = String::from("(General workspace automation and document processing)");
    let mut files_touched = Vec::new();
    let mut completed_actions = Vec::new();
    let mut failed_items = Vec::new();
    let mut key_findings = Vec::new();

    // Look for original user objective in the earliest user messages
    for msg in messages {
        let mtype = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if mtype == "user" {
            if let Some(txt) = msg.get("text").and_then(|v| v.as_str()) {
                let first_line = txt.lines().next().unwrap_or("").trim();
                if !first_line.is_empty() {
                    let truncated: String = first_line.chars().take(200).collect();
                    objective = truncated;
                    break;
                }
            }
        }
    }

    for msg in messages {
        let mtype = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if mtype == "assistant" {
            let parts_slice = msg
                .get("content")
                .and_then(|v| v.as_array())
                .map(|v| v.as_slice())
                .unwrap_or(&[]);
            let unresolved_in_turn =
                crate::session::agent_turn::history::collect_unresolved_mutating_or_verify_failures(
                    parts_slice,
                );
            if let Some(err) = msg.get("error") {
                let etype = err.get("type").and_then(|v| v.as_str()).unwrap_or("error");
                let emsg = err
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("turn failed");
                let snippet: String = emsg.trim().chars().take(120).collect();
                let entry = format!("Turn aborted with error ({}: {})", etype, snippet);
                if !failed_items.contains(&entry) && failed_items.len() < 12 {
                    failed_items.push(entry);
                }
            } else if msg.get("finish").and_then(|v| v.as_str()) == Some("interrupted") {
                let entry = "Turn interrupted before completion".to_string();
                if !failed_items.contains(&entry) && failed_items.len() < 12 {
                    failed_items.push(entry);
                }
            }
            for u in &unresolved_in_turn {
                let entry = format!("Unresolved tool failure: {}", u);
                if !failed_items.contains(&entry) && failed_items.len() < 12 {
                    failed_items.push(entry);
                }
            }

            let turn_trustworthy = msg.get("error").is_none()
                && msg.get("finish").and_then(|v| v.as_str()) != Some("interrupted")
                && unresolved_in_turn.is_empty();

            for p in parts_slice {
                let ptype = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if ptype == "tool" {
                    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                    let input = p.pointer("/state/input").unwrap_or(&Value::Null);

                    for target in crate::session::doom_loop::extract_tool_target_keys(name, input) {
                        if !target.is_empty()
                            && target != "__workspace__"
                            && !target.starts_with("subagent:")
                            && !files_touched.contains(&target)
                        {
                            files_touched.push(target);
                        }
                    }

                    let status = p.pointer("/state/status").and_then(|v| v.as_str()).unwrap_or("");
                    let structured_failed =
                        p.pointer("/state/structured/ok").and_then(|v| v.as_bool()) == Some(false);
                    if status == "completed" && !structured_failed {
                        let action_entry = format!("Executed '{}' successfully", name);
                        if !completed_actions.contains(&action_entry) && completed_actions.len() < 12
                        {
                            completed_actions.push(action_entry);
                        }
                    } else if status == "error"
                        && p.pointer("/state/structured/syntaxError").and_then(|v| v.as_bool())
                            != Some(true)
                        && !matches!(
                            name.trim().to_ascii_lowercase().as_str(),
                            "edit"
                                | "write"
                                | "apply_patch"
                                | "film_scaffold"
                                | "codemode"
                                | "capture_film_preview"
                                | "render_video"
                                | "task"
                                | "subagent"
                        )
                    {
                        let snippet: String = p
                            .pointer("/state/structured/error")
                            .or_else(|| p.pointer("/state/error/message"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool error")
                            .trim()
                            .chars()
                            .take(100)
                            .collect();
                        let entry = format!("Tool '{}' failed: {}", name, snippet);
                        if !failed_items.contains(&entry) && failed_items.len() < 12 {
                            failed_items.push(entry);
                        }
                    }
                } else if ptype == "text" && turn_trustworthy {
                    if let Some(txt) = p.get("text").and_then(|v| v.as_str()) {
                        let clean = txt.trim();
                        if !clean.is_empty()
                            && !clean.starts_with('{')
                            && !clean.contains("[FAILED TURN")
                            && !clean.contains("[INTERRUPTED TURN")
                            && key_findings.len() < 6
                        {
                            let bullet: String =
                                clean.lines().next().unwrap_or("").chars().take(150).collect();
                            if !bullet.is_empty() && !key_findings.contains(&bullet) {
                                key_findings.push(bullet);
                            }
                        }
                    }
                }
            }
        }
    }

    let files_rendered = if files_touched.is_empty() {
        "- (none)".to_string()
    } else {
        files_touched
            .iter()
            .take(15)
            .map(|f| format!("- `{}`", f))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let completed_rendered = if completed_actions.is_empty() {
        "- (none)".to_string()
    } else {
        completed_actions
            .iter()
            .map(|a| format!("- {}", a))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let failed_rendered = if failed_items.is_empty() {
        "- (none)".to_string()
    } else {
        failed_items
            .iter()
            .map(|f| format!("- {}", f))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let findings_rendered = if key_findings.is_empty() {
        "- (none)".to_string()
    } else {
        key_findings
            .iter()
            .map(|k| format!("- {}", k))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "[Compacted Conversation History by Harness]\n\
         ## Objective\n\
         - {}\n\n\
         ## Relevant Files\n\
         {}\n\n\
         ## Work State\n\
         ### Completed\n\
         {}\n\n\
         ### Failed / Unverified\n\
         {}\n\n\
         ### Key Decisions & Findings\n\
         {}\n\n\
         *Note: Earlier messages were summarized to conserve context window. Recent turns follow intact.*",
        objective, files_rendered, completed_rendered, failed_rendered, findings_rendered
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_small_history_does_not_compact() {
        let history = vec![
            json!({ "type": "user", "text": "Halo" }),
            json!({ "type": "assistant", "content": [{ "type": "text", "text": "Ada yang bisa dibantu?" }] }),
        ];
        let (res, compacted) = compact_session_history(&history, 128_000);
        assert!(!compacted);
        assert_eq!(res.len(), 2);
    }

    #[test]
    fn test_large_history_compacts_into_anchored_summary() {
        let mut history = Vec::new();
        history.push(json!({ "type": "user", "text": "Tolong rekap data dari sales.xlsx dan update ke report.md" }));
        history.push(json!({
            "type": "assistant",
            "content": [
                {
                    "type": "tool",
                    "name": "read",
                    "state": { "input": { "filePath": "sales.xlsx" }, "status": "completed" }
                },
                { "type": "text", "text": "Data sales telah dibaca, total revenue 50 juta." }
            ]
        }));

        for i in 1..=15 {
            history.push(json!({ "type": "user", "text": format!("Pertanyaan ke-{}", i) }));
            history.push(json!({
                "type": "assistant",
                "content": [{ "type": "text", "text": format!("Jawaban ke-{}", i) }]
            }));
        }

        let (compacted_history, was_compacted) = compact_session_history(&history, 1_000);
        assert!(was_compacted);
        assert!(compacted_history.len() < history.len());

        let first = &compacted_history[0];
        assert_eq!(first["type"], "synthetic");
        let summary_text = first["text"].as_str().unwrap();
        assert!(summary_text.contains("## Objective"));
        assert!(summary_text.contains("sales.xlsx"));
        assert!(summary_text.contains("## Work State"));
        assert!(summary_text.contains("### Failed / Unverified"));
    }

    #[test]
    fn test_compact_summary_preserves_failures_and_drops_untrusted_claims() {
        let mut history = vec![
            json!({ "type": "user", "text": "Perbaiki scene1.js" }),
            json!({
                "type": "assistant",
                "error": { "type": "provider.timeout", "message": "upstream timed out" },
                "content": [
                    {
                        "type": "tool",
                        "name": "edit",
                        "state": {
                            "status": "error",
                            "input": { "filePath": "script/scene1.js" },
                            "structured": { "ok": false, "error": "oldString missing" }
                        }
                    },
                    { "type": "text", "text": "Semua edit sudah selesai sempurna!" }
                ]
            }),
        ];
        for i in 1..=15 {
            history.push(json!({ "type": "user", "text": format!("Pesan {}", i) }));
            history.push(json!({
                "type": "assistant",
                "content": [{ "type": "text", "text": format!("Balasan {}", i) }]
            }));
        }
        let (compacted, did_compact) = compact_session_history(&history, 900);
        assert!(did_compact);
        let summary = compacted[0]["text"].as_str().unwrap();
        assert!(summary.contains("### Failed / Unverified"));
        assert!(summary.contains("provider.timeout"));
        assert!(summary.contains("script/scene1.js"));
        assert!(!summary.contains("Semua edit sudah selesai sempurna!"));
    }
}
