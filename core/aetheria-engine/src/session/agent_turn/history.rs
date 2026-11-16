//! History conversion & formatting for OpenAI/OpenCode compatible LLM turns.

use serde_json::{json, Value};

fn normalize_tool_failure_buckets(name: &str, input: &Value) -> Vec<(String, String)> {
    let lower = name.trim().to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "edit" | "write" | "apply_patch" | "film_scaffold" | "codemode"
    ) {
        return crate::session::doom_loop::extract_tool_target_keys(&lower, input)
            .into_iter()
            .map(|target| ("mutate".to_string(), target))
            .collect();
    }
    if matches!(lower.as_str(), "capture_film_preview" | "render_video") {
        return vec![(lower, String::new())];
    }
    if matches!(lower.as_str(), "task" | "subagent") {
        return crate::session::doom_loop::extract_tool_target_keys(&lower, input)
            .into_iter()
            .map(|target| ("subagent".to_string(), target))
            .collect();
    }
    Vec::new()
}

fn partner_resolved_buckets(tool_lower: &str, bucket: &(String, String)) -> Vec<(String, String)> {
    let mut extras = Vec::new();
    if bucket.0 == "mutate" {
        if matches!(tool_lower, "write" | "edit" | "apply_patch")
            && (bucket.1 == "index.html" || bucket.1.ends_with("/index.html"))
        {
            extras.push(("mutate".to_string(), "__workspace__".to_string()));
        } else if matches!(tool_lower, "film_scaffold" | "codemode")
            && bucket.1 == "__workspace__"
        {
            extras.push(("mutate".to_string(), "index.html".to_string()));
        }
    }
    extras
}

pub(crate) fn collect_unresolved_failures_with_buckets(
    parts: &[Value],
) -> Vec<((String, String), String)> {
    let mut order: Vec<(String, String)> = Vec::new();
    let mut latest: std::collections::HashMap<(String, String), Option<String>> =
        std::collections::HashMap::new();

    for p in parts {
        if p.get("type").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        if p.pointer("/state/structured/syntaxError").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let name = p.get("name").and_then(Value::as_str).unwrap_or("");
        let lower = name.trim().to_ascii_lowercase();
        let input = p.pointer("/state/input").unwrap_or(&Value::Null);
        let buckets = normalize_tool_failure_buckets(name, input);
        if buckets.is_empty() {
            continue;
        }
        let status = p
            .pointer("/state/status")
            .and_then(Value::as_str)
            .unwrap_or("");
        let structured_failed =
            p.pointer("/state/structured/ok").and_then(Value::as_bool) == Some(false);
        let is_completed_ok = status == "completed" && !structured_failed;
        let is_failed = status == "error" || (status == "completed" && structured_failed);

        for bucket in buckets {
            if !latest.contains_key(&bucket) {
                order.push(bucket.clone());
            }
            if is_completed_ok {
                for partner in partner_resolved_buckets(&lower, &bucket) {
                    latest.insert(partner, None);
                }
                latest.insert(bucket, None);
            } else if is_failed {
                let err_raw = p
                    .pointer("/state/structured/error")
                    .or_else(|| p.pointer("/state/error/message"))
                    .or_else(|| p.pointer("/state/structured/message"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool error");
                let snippet: String = err_raw.trim().chars().take(120).collect();
                let desc = if bucket.1.is_empty() {
                    format!("{}: {}", name, snippet)
                } else {
                    format!("{}({}): {}", name, bucket.1, snippet)
                };
                latest.insert(bucket, Some(desc));
            }
        }
    }

    order
        .into_iter()
        .filter_map(|k| latest.remove(&k).flatten().map(|desc| (k, desc)))
        .collect()
}

pub(crate) fn collect_unresolved_mutating_or_verify_failures(parts: &[Value]) -> Vec<String> {
    collect_unresolved_failures_with_buckets(parts)
        .into_iter()
        .map(|(_, desc)| desc)
        .collect()
}

pub(crate) fn build_historical_turn_warning(msg: &Value, unresolved: &[String]) -> Option<String> {
    let mut notes = Vec::new();

    if let Some(err) = msg.get("error") {
        let err_type = err
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("provider.error");
        let err_msg = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown turn error");
        let snippet: String = err_msg.trim().chars().take(180).collect();
        notes.push(format!(
            "[FAILED TURN ({}: {}): this turn aborted with an error; do NOT treat its text claims or partial plans as completed work.]",
            err_type, snippet
        ));
    } else if msg.get("finish").and_then(Value::as_str) == Some("interrupted") {
        notes.push(
            "[INTERRUPTED TURN: the previous turn stopped before completion; verify workspace files before continuing.]"
                .to_string(),
        );
    }

    if !unresolved.is_empty() {
        notes.push(format!(
            "[UNRESOLVED TOOL ERRORS IN TURN: {} — do NOT assume these edits or verifications succeeded.]",
            unresolved.join("; ")
        ));
    }

    if notes.is_empty() {
        None
    } else {
        Some(notes.join("\n"))
    }
}

/// Converts session history into formatted OpenAI-compatible chat messages
pub fn build_chat_messages(effective_history: &[Value], sys_prompt: &str) -> Vec<Value> {
    let mut chat_messages = vec![json!({ "role": "system", "content": sys_prompt })];

    // Pre-scan clean assistant turns so buckets resolved in a later turn j > i
    // do not keep carrying stale `[UNRESOLVED TOOL ERRORS IN TURN]` warnings on turn i.
    let mut latest_resolved_turn_by_bucket: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::new();
    for (idx, m) in effective_history.iter().enumerate() {
        if m.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        if m.get("error").is_some()
            || m.get("finish").and_then(|v| v.as_str()) == Some("interrupted")
        {
            continue;
        }
        if let Some(parts) = m.get("content").and_then(|v| v.as_array()) {
            let unresolved_in_turn: std::collections::HashSet<(String, String)> =
                collect_unresolved_failures_with_buckets(parts)
                    .into_iter()
                    .map(|(b, _)| b)
                    .collect();
            for p in parts {
                if p.get("type").and_then(Value::as_str) != Some("tool") {
                    continue;
                }
                if p.pointer("/state/structured/syntaxError")
                    .and_then(Value::as_bool)
                    == Some(true)
                {
                    continue;
                }
                let status = p
                    .pointer("/state/status")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let structured_failed =
                    p.pointer("/state/structured/ok").and_then(Value::as_bool) == Some(false);
                if status != "completed" || structured_failed {
                    continue;
                }
                let name = p.get("name").and_then(Value::as_str).unwrap_or("");
                let lower = name.trim().to_ascii_lowercase();
                let input = p.pointer("/state/input").unwrap_or(&Value::Null);
                for bucket in normalize_tool_failure_buckets(name, input) {
                    if !unresolved_in_turn.contains(&bucket) {
                        for partner in partner_resolved_buckets(&lower, &bucket) {
                            latest_resolved_turn_by_bucket.insert(partner, idx);
                        }
                        latest_resolved_turn_by_bucket.insert(bucket, idx);
                    }
                }
            }
        }
    }

    for (turn_idx, m) in effective_history.iter().enumerate() {
        let mtype = m.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if mtype == "synthetic" {
            let txt = m.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if !txt.is_empty() {
                chat_messages.push(json!({ "role": "user", "content": txt }));
            }
        } else if mtype == "user" {
            let txt = m.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let mut enriched_txt = txt.to_string();
            let mut img_urls: Vec<String> = Vec::new();
            if let Some(arr) = m.get("files").and_then(|v| v.as_array()) {
                for f in arr {
                    let fname = f.get("name").and_then(|v| v.as_str()).unwrap_or("attached_file");
                    let uri = f
                        .get("uri")
                        .or_else(|| f.get("url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let mime = f.get("mime").and_then(|v| v.as_str()).unwrap_or("");
                    if uri.starts_with("data:image/") && !uri.starts_with("data:image/svg") {
                        img_urls.push(uri.to_string());
                    } else if super::vision::is_text_or_code_attachment(fname, uri, mime) {
                        if let Some(decoded) = super::vision::decode_data_uri_text(uri) {
                            let snippet: String = decoded.chars().take(120_000).collect();
                            enriched_txt.push_str(&format!(
                                "\n\n[Attached File: '{}']:\n```\n{}\n```",
                                fname, snippet
                            ));
                        }
                    }
                }
            }
            if img_urls.is_empty() {
                chat_messages.push(json!({ "role": "user", "content": enriched_txt }));
            } else {
                let mut parts = vec![json!({ "type": "text", "text": enriched_txt })];
                for u in img_urls {
                    parts.push(json!({ "type": "image_url", "image_url": { "url": u } }));
                }
                chat_messages.push(json!({ "role": "user", "content": parts }));
            }
        } else if mtype == "assistant" {
            let parts = m.get("content").and_then(|v| v.as_array());
            let mut tool_calls = Vec::new();
            let mut tool_results = Vec::new();
            let mut text_parts = Vec::new();

            if let Some(arr) = parts {
                for p in arr {
                    let ptype = p.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if ptype == "text" {
                        if let Some(t) = p.get("text").and_then(|s| s.as_str()) {
                            text_parts.push(t);
                        }
                    } else if ptype == "tool" {
                        let cid = p.get("id").and_then(|v| v.as_str()).unwrap_or("call_0");
                        let fn_name = p.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                        let input_val = p.pointer("/state/input").cloned().unwrap_or_else(|| json!({}));
                        let out_str_raw = p
                            .pointer("/state/content/0/text")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| {
                                p.pointer("/state/structured")
                                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                            })
                            .unwrap_or_else(|| "{}".to_string());
                        let out_str: String = if out_str_raw.len() > 600 {
                            let mut truncated: String = out_str_raw.chars().take(600).collect();
                            truncated.push_str("...[truncated historical output]");
                            truncated
                        } else {
                            out_str_raw
                        };

                        let args_raw = serde_json::to_string(&input_val).unwrap_or_else(|_| "{}".to_string());
                        let args_compact = if args_raw.len() > 600 {
                            let fp = input_val
                                .get("filePath")
                                .or_else(|| input_val.get("path"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if fn_name == "write" {
                                let preview: String = input_val
                                    .get("content")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .chars()
                                    .take(160)
                                    .collect();
                                json!({
                                    "filePath": fp,
                                    "content": format!("{} ... [historical content omitted ({} chars)]", preview, args_raw.len())
                                })
                                .to_string()
                            } else {
                                json!({ "filePath": fp, "_note": "[historical content omitted]" }).to_string()
                            }
                        } else {
                            args_raw
                        };

                        tool_calls.push(json!({
                            "id": cid,
                            "type": "function",
                            "function": {
                                "name": fn_name,
                                "arguments": args_compact
                            }
                        }));

                        tool_results.push(json!({
                            "role": "tool",
                            "tool_call_id": cid,
                            "name": fn_name,
                            "content": out_str
                        }));
                    }
                }
            }

            let mut clean_txt = text_parts.join("");
            if clean_txt.starts_with("[Tools executed in this past turn:") {
                if let Some(pos) = clean_txt.find("]\n") {
                    clean_txt = clean_txt[pos + 2..].to_string();
                } else if let Some(pos) = clean_txt.find(']') {
                    clean_txt = clean_txt[pos + 1..].trim_start().to_string();
                }
            }

            let unresolved_errors: Vec<String> = parts
                .map(|arr| {
                    collect_unresolved_failures_with_buckets(arr)
                        .into_iter()
                        .filter(|(bucket, _)| {
                            latest_resolved_turn_by_bucket
                                .get(bucket)
                                .copied()
                                .map(|resolved_idx| resolved_idx <= turn_idx)
                                .unwrap_or(true)
                        })
                        .map(|(_, desc)| desc)
                        .collect()
                })
                .unwrap_or_default();
            if let Some(turn_warning) = build_historical_turn_warning(m, &unresolved_errors) {
                if clean_txt.is_empty() {
                    clean_txt = turn_warning;
                } else {
                    clean_txt.push_str("\n\n");
                    clean_txt.push_str(&turn_warning);
                }
            }

            // Standard OpenCode / OpenAI Message Structure:
            // 1. Assistant message with tool_calls (if any tools were invoked)
            // 2. Tool response messages for each tool call
            // 3. Final assistant text message AFTER tool outputs
            if !tool_calls.is_empty() {
                chat_messages.push(json!({
                    "role": "assistant",
                    "content": Value::Null,
                    "tool_calls": tool_calls
                }));
                for tr in tool_results {
                    chat_messages.push(tr);
                }
                if !clean_txt.is_empty() {
                    chat_messages.push(json!({
                        "role": "assistant",
                        "content": clean_txt
                    }));
                }
            } else if !clean_txt.is_empty() {
                chat_messages.push(json!({ "role": "assistant", "content": clean_txt }));
            }
        }
    }

    chat_messages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_failed_and_unresolved_turns_in_chat_history() {
        let hist = vec![json!({
            "type": "assistant",
            "finish": null,
            "error": { "type": "provider.auth", "message": "401 invalid key" },
            "content": [
                { "type": "text", "text": "Siap. Ganti total ke konsep baru." },
                {
                    "type": "tool",
                    "id": "call_1",
                    "name": "edit",
                    "state": {
                        "status": "error",
                        "input": { "filePath": "script/scene1.js", "oldString": "x" },
                        "structured": { "error": "Could not find oldString" }
                    }
                }
            ]
        })];

        let msgs = build_chat_messages(&hist, "sys");
        let last = msgs.last().unwrap().get("content").and_then(Value::as_str).unwrap();
        assert!(last.contains("FAILED TURN (provider.auth: 401 invalid key)"));
        assert!(last.contains("UNRESOLVED TOOL ERRORS IN TURN"));
    }

    #[test]
    fn clears_edit_failure_once_later_write_on_same_file_succeeds() {
        let parts = vec![
            json!({
                "type": "tool",
                "name": "edit",
                "state": {
                    "status": "error",
                    "input": { "filePath": "script/scene1.js" },
                    "structured": { "error": "Could not find oldString" }
                }
            }),
            json!({
                "type": "tool",
                "name": "write",
                "state": {
                    "status": "completed",
                    "input": { "filePath": "script/scene1.js" }
                }
            }),
        ];
        assert!(collect_unresolved_mutating_or_verify_failures(&parts).is_empty());
    }

    #[test]
    fn skips_syntax_error_pollution_and_clears_apply_patch_and_cross_turn_recovery() {
        let hist = vec![
            json!({
                "type": "assistant",
                "finish": "stop",
                "content": [
                    {
                        "type": "tool",
                        "id": "call_syn",
                        "name": "edit",
                        "state": {
                            "status": "error",
                            "input": {},
                            "structured": { "ok": false, "syntaxError": true, "error": "Invalid JSON" }
                        }
                    },
                    {
                        "type": "tool",
                        "id": "call_patch_err",
                        "name": "apply_patch",
                        "state": {
                            "status": "error",
                            "input": { "patchText": "*** Update File: script/scene1.js\n@@\n-x\n+y" },
                            "structured": { "ok": false, "error": "patch hunk failed" }
                        }
                    },
                    {
                        "type": "tool",
                        "id": "call_task_err",
                        "name": "task",
                        "state": {
                            "status": "completed",
                            "input": { "subagent_type": "motion-designer", "description": "fix scene1" },
                            "structured": { "ok": false, "state": "incomplete", "error": "missing preview" }
                        }
                    }
                ]
            }),
            json!({
                "type": "assistant",
                "finish": "stop",
                "content": [
                    {
                        "type": "tool",
                        "id": "call_write_fix",
                        "name": "write",
                        "state": {
                            "status": "completed",
                            "input": { "filePath": "script/scene1.js", "content": "ok" },
                            "structured": { "ok": true }
                        }
                    }
                ]
            }),
        ];

        // Syntax error part is never reported as an unresolved edit failure.
        let turn0_parts = hist[0]["content"].as_array().unwrap();
        let unresolved0 = collect_unresolved_mutating_or_verify_failures(turn0_parts);
        assert_eq!(unresolved0.len(), 2);
        assert!(unresolved0.iter().any(|s| s.contains("script/scene1.js")));
        assert!(unresolved0.iter().any(|s| s.contains("task(subagent:motion-designer:fix scene1)")));

        // Cross-turn resolution suppresses resolved script/scene1.js on turn 0, while leaving unresolved task warning.
        let msgs = build_chat_messages(&hist, "sys");
        let assistant_texts: Vec<&str> = msgs
            .iter()
            .filter(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
            .filter_map(|m| m.get("content").and_then(Value::as_str))
            .collect();
        let turn0_warn = assistant_texts[0];
        assert!(!turn0_warn.contains("script/scene1.js"));
        assert!(turn0_warn.contains("task(subagent:motion-designer:fix scene1)"));
    }
}

