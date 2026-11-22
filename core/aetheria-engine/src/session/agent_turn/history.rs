//! History conversion & formatting for OpenAI/OpenCode compatible LLM turns.

use serde_json::{json, Value};

fn normalize_tool_failure_buckets(name: &str, input: &Value) -> Vec<(String, String)> {
    let lower = name.trim().to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "edit" | "write" | "apply_patch" | "film_scaffold" | "film_audio" | "codemode"
    ) {
        return crate::session::doom_loop::extract_tool_target_keys(&lower, input)
            .into_iter()
            .map(|target| ("mutate".to_string(), target))
            .collect();
    }
    if matches!(lower.as_str(), "capture_film_preview" | "render_video") {
        return vec![(lower, String::new())];
    }
    if lower == "lsp" {
        return crate::session::doom_loop::extract_tool_target_keys("lsp", input)
            .into_iter()
            .map(|target| ("lsp".to_string(), target))
            .collect();
    }
    if lower == "bash" {
        let cmd_key: String = input
            .get("command")
            .and_then(Value::as_str)
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_default()
            .chars()
            .take(64)
            .collect();
        return vec![("bash".to_string(), cmd_key)];
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
        } else if matches!(tool_lower, "film_scaffold" | "film_audio" | "codemode")
            && bucket.1 == "__workspace__"
        {
            extras.push(("mutate".to_string(), "index.html".to_string()));
        }
    }
    extras
}

fn extract_subagent_session_id(lower_name: &str, p: &Value, input: &Value) -> Option<String> {
    if lower_name != "task" && lower_name != "subagent" {
        return None;
    }
    p.pointer("/state/structured/sessionID")
        .or_else(|| p.pointer("/state/structured/session_id"))
        .or_else(|| p.pointer("/state/structured/sessionId"))
        .or_else(|| input.get("sessionID"))
        .or_else(|| input.get("session_id"))
        .or_else(|| input.get("sessionId"))
        .and_then(Value::as_str)
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
}

pub(crate) fn collect_unresolved_failures_with_buckets(
    parts: &[Value],
) -> Vec<((String, String), String)> {
    let mut order: Vec<(String, String)> = Vec::new();
    let mut latest: std::collections::HashMap<(String, String), Option<String>> =
        std::collections::HashMap::new();
    let mut failed_subagent_buckets: std::collections::HashMap<String, Vec<(String, String)>> =
        std::collections::HashMap::new();

    for p in parts {
        if p.get("type").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        if p.pointer("/state/structured/syntaxError").and_then(Value::as_bool) == Some(true)
            || p.pointer("/state/structured/blocked").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let name = p.get("name").and_then(Value::as_str).unwrap_or("");
        let lower = name.trim().to_ascii_lowercase();
        let input = p.pointer("/state/input").unwrap_or(&Value::Null);
        let buckets = normalize_tool_failure_buckets(name, input);
        let sub_sid = extract_subagent_session_id(&lower, p, input);
        if buckets.is_empty() && sub_sid.is_none() {
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

        if is_completed_ok {
            if let Some(ref sid) = sub_sid {
                if let Some(prev_buckets) = failed_subagent_buckets.remove(sid) {
                    for prev in prev_buckets {
                        latest.insert(prev, None);
                    }
                }
            }
        }

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
                if let Some(ref sid) = sub_sid {
                    failed_subagent_buckets
                        .entry(sid.clone())
                        .or_default()
                        .push(bucket.clone());
                }
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

/// Returns true when this turn executed or attempted film creation/editing tools or motion subagents.
pub(crate) fn turn_touched_film_build(parts: &[Value]) -> bool {
    for p in parts {
        if p.get("type").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        let name = p
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "film_scaffold" | "film_audio" | "capture_film_preview" | "render_video"
        ) {
            return true;
        }
        if name == "task" {
            let sub = p
                .pointer("/state/input/subagent_type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if matches!(sub.as_str(), "motion-designer" | "qa-verifier") {
                return true;
            }
        }
        if matches!(name.as_str(), "write" | "edit" | "apply_patch") {
            let fp = p
                .pointer("/state/input/filePath")
                .or_else(|| p.pointer("/state/input/path"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .replace('\\', "/")
                .to_ascii_lowercase();
            if fp.contains("script/") || fp.ends_with("index.html") || fp.ends_with("film.json") {
                return true;
            }
        }
    }
    false
}

/// Shared fact-based completion blocker check combining unresolved tool errors with on-disk film state.
pub(crate) fn collect_turn_completion_blockers(parts: &[Value], workspace_dir: &str) -> Vec<String> {
    let mut blockers = collect_unresolved_mutating_or_verify_failures(parts);
    if !workspace_dir.trim().is_empty() && turn_touched_film_build(parts) {
        blockers.extend(crate::tool::film_state::collect_film_completion_blockers(workspace_dir));
    }
    blockers
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

/// Hysteresis image byte & count cap constants (mirrors OpenCode `model-request.ts:225-253`
/// plus count-based pruning so compact JPEGs never silently accumulate to 180k+ visual tokens).
pub const IMAGE_BUDGET_TRIGGER_BYTES: usize = 25 * 1024 * 1024; // 25 MiB
pub const IMAGE_BUDGET_TARGET_BYTES: usize = 15 * 1024 * 1024;  // 15 MiB
pub const IMAGE_BUDGET_MAX_COUNT: usize = 16;
pub const IMAGE_BUDGET_TARGET_COUNT: usize = 14;

/// Detects whether a multimodal user message carries rendered preview screenshots
/// (from `capture_film_preview`) rather than core reference keyframes (`ref_scene_`).
fn is_preview_vision_message(msg: &Value) -> bool {
    if msg.get("role").and_then(Value::as_str) != Some("user") {
        return false;
    }
    let Some(arr) = msg.get("content").and_then(Value::as_array) else {
        return false;
    };
    let mut has_inline_img = false;
    let mut mentions_preview = false;
    let mut mentions_ref_only = false;
    for part in arr {
        if part
            .pointer("/image_url/url")
            .and_then(Value::as_str)
            .is_some_and(|u| u.starts_with("data:image/"))
        {
            has_inline_img = true;
        } else if let Some(txt) = part.get("text").and_then(Value::as_str) {
            let lower = txt.to_ascii_lowercase();
            if lower.contains("preview_")
                || lower.contains("comparison_strip")
                || lower.contains("capture_film_preview")
            {
                mentions_preview = true;
            }
            if lower.contains("ref_scene_") || lower.contains("contact_sheet_") {
                mentions_ref_only = true;
            }
        }
    }
    has_inline_img && mentions_preview && !mentions_ref_only
}

/// Detects whether a multimodal user message carries a temporary `[FILMSTRIP_BATCH ...]`
/// sheet window attached by `read_filmstrip`, so moving to the next scene cleanly replaces
/// the previous scene's 1/1 filmstrip sheets without overflowing the 16-image active cap.
fn is_filmstrip_batch_message(msg: &Value) -> bool {
    if msg.get("role").and_then(Value::as_str) != Some("user") {
        return false;
    }
    let Some(arr) = msg.get("content").and_then(Value::as_array) else {
        return false;
    };
    let mut has_inline_img = false;
    let mut mentions_filmstrip_batch = false;
    for part in arr {
        if part
            .pointer("/image_url/url")
            .and_then(Value::as_str)
            .is_some_and(|u| u.starts_with("data:image/"))
        {
            has_inline_img = true;
        } else if let Some(txt) = part.get("text").and_then(Value::as_str) {
            if txt.to_ascii_lowercase().contains("[filmstrip_batch") {
                mentions_filmstrip_batch = true;
            }
        }
    }
    has_inline_img && mentions_filmstrip_batch
}

/// Counts active inline `data:image/` attachments currently present across `chat_messages`.
pub fn count_active_inline_images(chat_messages: &[Value]) -> usize {
    let mut count = 0usize;
    for msg in chat_messages {
        if let Some(arr) = msg.get("content").and_then(Value::as_array) {
            for part in arr {
                if part
                    .pointer("/image_url/url")
                    .and_then(Value::as_str)
                    .is_some_and(|u| u.starts_with("data:image/"))
                {
                    count += 1;
                }
            }
        }
    }
    count
}

/// Bounds total inline base64 `image_url` attachments across `chat_messages`:
/// 1. Replaces image attachments in superseded `capture_film_preview` rounds whenever a newer
///    preview round exists (preserving the text manifest labels and keeping reference keyframes).
/// 2. Applies deterministic FIFO-replay hysteresis on BOTH total byte size (`trigger_bytes` ->
///    `target_bytes`) and active image count (`max_count` -> `target_count`), keeping prompt-cache
///    prefixes stable between cuts.
pub fn bound_inline_images_with_limits(
    chat_messages: &mut [Value],
    trigger_bytes: usize,
    target_bytes: usize,
) -> usize {
    bound_inline_images_with_count_and_bytes(
        chat_messages,
        trigger_bytes,
        target_bytes,
        usize::MAX,
        usize::MAX,
    )
}

pub fn bound_inline_images_with_count_and_bytes(
    chat_messages: &mut [Value],
    trigger_bytes: usize,
    target_bytes: usize,
    max_count: usize,
    target_count: usize,
) -> usize {
    let mut removed = 0usize;

    // 1. Prune superseded `capture_film_preview` rounds (keep only the latest preview batch).
    let preview_msg_indices: Vec<usize> = chat_messages
        .iter()
        .enumerate()
        .filter_map(|(idx, msg)| is_preview_vision_message(msg).then_some(idx))
        .collect();
    if preview_msg_indices.len() > 1 {
        for &old_idx in &preview_msg_indices[..preview_msg_indices.len() - 1] {
            if let Some(arr) = chat_messages
                .get_mut(old_idx)
                .and_then(|m| m.get_mut("content"))
                .and_then(|c| c.as_array_mut())
            {
                for part in arr.iter_mut() {
                    let is_img = part
                        .pointer("/image_url/url")
                        .and_then(Value::as_str)
                        .is_some_and(|u| u.starts_with("data:image/"));
                    if is_img {
                        *part = json!({
                            "type": "text",
                            "text": "[Superseded preview image removed; inspect the latest capture_film_preview batch instead.]"
                        });
                        removed += 1;
                    }
                }
            }
        }
    }

    // 1b. Sliding-window pruning for superseded `[FILMSTRIP_BATCH ...]` calls from `read_filmstrip`:
    // only evict older batches once active images exceed `max_count`, preserving prompt-cache prefixes
    // on early/moderate turns while still preventing long multi-scene videos from overflowing 16 images.
    let filmstrip_msg_indices: Vec<usize> = chat_messages
        .iter()
        .enumerate()
        .filter_map(|(idx, msg)| is_filmstrip_batch_message(msg).then_some(idx))
        .collect();
    if filmstrip_msg_indices.len() > 1 && count_active_inline_images(chat_messages) > max_count {
        for &old_idx in &filmstrip_msg_indices[..filmstrip_msg_indices.len() - 1] {
            if let Some(arr) = chat_messages
                .get_mut(old_idx)
                .and_then(|m| m.get_mut("content"))
                .and_then(|c| c.as_array_mut())
            {
                for part in arr.iter_mut() {
                    let is_img = part
                        .pointer("/image_url/url")
                        .and_then(Value::as_str)
                        .is_some_and(|u| u.starts_with("data:image/"));
                    if is_img {
                        *part = json!({
                            "type": "text",
                            "text": "[Superseded filmstrip batch removed; call read_filmstrip again to revisit earlier sheets.]"
                        });
                        removed += 1;
                    }
                }
            }
        }
    }

    // 2. Deterministic FIFO-replay hysteresis on BOTH byte budget and max image count.
    let mut kept: std::collections::VecDeque<(usize, usize, usize)> =
        std::collections::VecDeque::new();
    let mut kept_bytes: usize = 0;
    let mut remove_slots: Vec<(usize, usize)> = Vec::new();

    for (msg_idx, msg) in chat_messages.iter().enumerate() {
        if let Some(arr) = msg.get("content").and_then(|v| v.as_array()) {
            for (part_idx, part) in arr.iter().enumerate() {
                let img_len = part
                    .pointer("/image_url/url")
                    .and_then(|v| v.as_str())
                    .filter(|u| u.starts_with("data:image/"))
                    .map(|u| u.len())
                    .unwrap_or(0);
                if img_len == 0 {
                    continue;
                }
                kept.push_back((msg_idx, part_idx, img_len));
                kept_bytes += img_len;
                if kept_bytes > trigger_bytes || kept.len() > max_count {
                    while (kept_bytes > target_bytes || kept.len() > target_count)
                        && kept.len() > 1
                    {
                        if let Some((old_m, old_p, old_len)) = kept.pop_front() {
                            kept_bytes = kept_bytes.saturating_sub(old_len);
                            remove_slots.push((old_m, old_p));
                        }
                    }
                    if kept_bytes > target_bytes && kept_bytes > trigger_bytes && kept.len() == 1 {
                        if let Some((old_m, old_p, old_len)) = kept.pop_front() {
                            kept_bytes = kept_bytes.saturating_sub(old_len);
                            remove_slots.push((old_m, old_p));
                        }
                    }
                }
            }
        }
    }

    for (msg_idx, part_idx) in remove_slots {
        if let Some(part) = chat_messages
            .get_mut(msg_idx)
            .and_then(|m| m.get_mut("content"))
            .and_then(|c| c.as_array_mut())
            .and_then(|arr| arr.get_mut(part_idx))
        {
            *part = json!({
                "type": "text",
                "text": "[This image was removed to keep the conversation within multimodal size limits.]"
            });
            removed += 1;
        }
    }
    removed
}

pub fn bound_inline_images(chat_messages: &mut [Value]) -> usize {
    bound_inline_images_with_count_and_bytes(
        chat_messages,
        IMAGE_BUDGET_TRIGGER_BYTES,
        IMAGE_BUDGET_TARGET_BYTES,
        IMAGE_BUDGET_MAX_COUNT,
        IMAGE_BUDGET_TARGET_COUNT,
    )
}

/// Converts session history into formatted OpenAI-compatible chat messages (default vision enabled).
pub fn build_chat_messages(effective_history: &[Value], sys_prompt: &str) -> Vec<Value> {
    build_chat_messages_with_options(effective_history, sys_prompt, true)
}

/// Converts session history into formatted OpenAI-compatible chat messages, respecting
/// `model_supports_vision` and preserving multi-step causal ordering and `extra_content`.
pub fn build_chat_messages_with_options(
    effective_history: &[Value],
    sys_prompt: &str,
    model_supports_vision: bool,
) -> Vec<Value> {
    let mut chat_messages = vec![json!({ "role": "system", "content": sys_prompt })];
    let compact_start_idx = effective_history
        .iter()
        .rposition(|m| {
            m.get("compactedSummary").and_then(|v| v.as_bool()) == Some(true)
                || m.get("compacted").and_then(|v| v.as_bool()) == Some(true)
        })
        .unwrap_or(0);
    let active_history = &effective_history[compact_start_idx..];

    // Pre-scan clean assistant turns so buckets resolved in a later turn j > i
    // do not keep carrying stale `[UNRESOLVED TOOL ERRORS IN TURN]` warnings on turn i.
    let mut latest_resolved_turn_by_bucket: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::new();
    let mut cross_turn_failed_subagent_buckets: std::collections::HashMap<String, Vec<(String, String)>> =
        std::collections::HashMap::new();
    for (idx, m) in active_history.iter().enumerate() {
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
                let name = p.get("name").and_then(Value::as_str).unwrap_or("");
                let lower = name.trim().to_ascii_lowercase();
                let input = p.pointer("/state/input").unwrap_or(&Value::Null);
                let sub_sid = extract_subagent_session_id(&lower, p, input);
                let buckets = normalize_tool_failure_buckets(name, input);
                let status = p
                    .pointer("/state/status")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let structured_failed =
                    p.pointer("/state/structured/ok").and_then(Value::as_bool) == Some(false);
                if status == "error" || (status == "completed" && structured_failed) {
                    if let Some(sid) = sub_sid {
                        cross_turn_failed_subagent_buckets
                            .entry(sid)
                            .or_default()
                            .extend(buckets);
                    }
                    continue;
                }
                if status != "completed" {
                    continue;
                }
                if let Some(ref sid) = sub_sid {
                    if let Some(prev_buckets) = cross_turn_failed_subagent_buckets.remove(sid) {
                        for prev in prev_buckets {
                            latest_resolved_turn_by_bucket.insert(prev, idx);
                        }
                    }
                }
                for bucket in buckets {
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

    const HISTORICAL_TEXT_ATTACHMENT_CAP: usize = 60_000;
    const HISTORICAL_TOOL_OUTPUT_CAP: usize = 50_000;
    for (turn_idx, m) in active_history.iter().enumerate() {
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
            let mut omitted_img_count = 0usize;
            let text_att_cap = HISTORICAL_TEXT_ATTACHMENT_CAP;
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
                        if model_supports_vision {
                            img_urls.push(uri.to_string());
                        } else {
                            omitted_img_count += 1;
                        }
                    } else if super::vision::is_text_or_code_attachment(fname, uri, mime) {
                        if let Some(decoded) = super::vision::decode_data_uri_text(uri) {
                            let snippet: String = decoded.chars().take(text_att_cap).collect();
                            enriched_txt.push_str(&format!(
                                "\n\n[Attached File: '{}']:\n```\n{}\n```",
                                fname, snippet
                            ));
                        }
                    }
                }
            }
            if omitted_img_count > 0 {
                enriched_txt.push_str(&format!(
                    "\n\n[{} historical image attachment(s) omitted for text-only model]",
                    omitted_img_count
                ));
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

            // Preserve multi-step causal boundaries: walk `parts` in order so intervening text
            // between tool batches emits separate (assistant -> tool -> assistant) steps instead
            // of collapsing every step into one synthetic parallel batch. Keep outputs/args stable
            // across turns so provider KV prompt-cache prefixes never invalidate.
            let mut pending_text = String::new();
            let mut pending_reasoning = String::new();
            let mut pending_reasoning_field: Option<String> = None;
            let mut pending_tool_calls: Vec<Value> = Vec::new();
            let mut pending_tool_results: Vec<Value> = Vec::new();
            let mut emitted_any_step = false;

            let flush_tool_step = |msgs: &mut Vec<Value>,
                                   pre_text: &mut String,
                                   pre_reasoning: &mut String,
                                   pre_reasoning_field: &mut Option<String>,
                                   tcs: &mut Vec<Value>,
                                   trs: &mut Vec<Value>,
                                   emitted: &mut bool| {
                if tcs.is_empty() {
                    return;
                }
                let content_val = if pre_text.trim().is_empty() {
                    Value::Null
                } else {
                    Value::String(std::mem::take(pre_text))
                };
                pre_text.clear();
                let mut step_msg = json!({
                    "role": "assistant",
                    "content": content_val,
                    "tool_calls": std::mem::take(tcs)
                });
                let r_txt = std::mem::take(pre_reasoning);
                let r_field = pre_reasoning_field.take();
                if !r_txt.trim().is_empty() {
                    let field = r_field.as_deref().unwrap_or("reasoning_content");
                    step_msg[field] = Value::String(r_txt);
                }
                msgs.push(step_msg);
                for tr in trs.drain(..) {
                    msgs.push(tr);
                }
                *emitted = true;
            };

            if let Some(arr) = parts {
                for p in arr {
                    let ptype = p.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if ptype == "reasoning" {
                        if !pending_tool_calls.is_empty() {
                            flush_tool_step(
                                &mut chat_messages,
                                &mut pending_text,
                                &mut pending_reasoning,
                                &mut pending_reasoning_field,
                                &mut pending_tool_calls,
                                &mut pending_tool_results,
                                &mut emitted_any_step,
                            );
                        }
                        if pending_reasoning_field.is_none() {
                            if let Some(f) = p.get("reasoningField").and_then(Value::as_str) {
                                if !f.trim().is_empty() {
                                    pending_reasoning_field = Some(f.to_string());
                                }
                            }
                        }
                        if let Some(r) = p.get("text").and_then(Value::as_str) {
                            pending_reasoning.push_str(r);
                        }
                    } else if ptype == "text" {
                        if !pending_tool_calls.is_empty() {
                            flush_tool_step(
                                &mut chat_messages,
                                &mut pending_text,
                                &mut pending_reasoning,
                                &mut pending_reasoning_field,
                                &mut pending_tool_calls,
                                &mut pending_tool_results,
                                &mut emitted_any_step,
                            );
                        }
                        if let Some(t) = p.get("text").and_then(|s| s.as_str()) {
                            pending_text.push_str(t);
                        }
                    } else if ptype == "tool" {
                        let cid = p.get("id").and_then(|v| v.as_str()).unwrap_or("call_0");
                        let fn_name = p.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                        let input_val = p.pointer("/state/input").cloned().unwrap_or_else(|| json!({}));
                        let out_str_raw = p
                            .pointer("/state/structured")
                            .map(|v| crate::tool::truncator::format_tool_result_for_model(fn_name, v))
                            .filter(|s| !s.is_empty())
                            .or_else(|| {
                                p.pointer("/state/content/0/text")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            })
                            .unwrap_or_else(|| "{}".to_string());
                        let out_str: String = if out_str_raw.len() > HISTORICAL_TOOL_OUTPUT_CAP {
                            let mut truncated: String =
                                out_str_raw.chars().take(HISTORICAL_TOOL_OUTPUT_CAP).collect();
                            truncated.push_str("...[truncated historical output]");
                            truncated
                        } else {
                            out_str_raw
                        };

                        let args_raw = serde_json::to_string(&input_val).unwrap_or_else(|_| "{}".to_string());
                        let mut tc_obj = json!({
                            "id": cid,
                            "type": "function",
                            "function": {
                                "name": fn_name,
                                "arguments": args_raw
                            }
                        });
                        if let Some(extra) = p.get("extra_content").filter(|v| !v.is_null()) {
                            tc_obj["extra_content"] = extra.clone();
                        }
                        pending_tool_calls.push(tc_obj);

                        pending_tool_results.push(json!({
                            "role": "tool",
                            "tool_call_id": cid,
                            "name": fn_name,
                            "content": out_str
                        }));
                    }
                }
            }

            if !pending_tool_calls.is_empty() {
                flush_tool_step(
                    &mut chat_messages,
                    &mut pending_text,
                    &mut pending_reasoning,
                    &mut pending_reasoning_field,
                    &mut pending_tool_calls,
                    &mut pending_tool_results,
                    &mut emitted_any_step,
                );
            }

            let mut clean_txt = pending_text;
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

            if !clean_txt.is_empty() || !emitted_any_step {
                if !clean_txt.is_empty() || !pending_reasoning.trim().is_empty() {
                    let mut final_msg = json!({ "role": "assistant", "content": clean_txt });
                    if !pending_reasoning.trim().is_empty() {
                        let field = pending_reasoning_field
                            .as_deref()
                            .unwrap_or("reasoning_content");
                        final_msg[field] = Value::String(pending_reasoning);
                    }
                    chat_messages.push(final_msg);
                }
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
    fn replays_multi_step_boundaries_extra_content_and_bounds_images_with_hysteresis() {
        let hist = vec![
            json!({
                "type": "user",
                "text": "check img",
                "files": [{ "name": "a.png", "uri": "data:image/png;base64,AAAA", "mime": "image/png" }]
            }),
            json!({
                "type": "assistant",
                "content": [
                    { "type": "text", "text": "Step 1 reading." },
                    {
                        "type": "tool",
                        "id": "c1",
                        "name": "read",
                        "extra_content": { "google": { "thought_signature": "sig_1" } },
                        "state": { "status": "completed", "input": { "filePath": "a.js" }, "structured": { "content": "1: ok" } }
                    },
                    { "type": "text", "text": "Step 2 editing." },
                    {
                        "type": "tool",
                        "id": "c2",
                        "name": "edit",
                        "state": { "status": "completed", "input": { "filePath": "a.js" }, "structured": { "ok": true, "output": "edited" } }
                    },
                    { "type": "text", "text": "All done." }
                ]
            }),
        ];

        // Non-vision model strips historical image_url
        let msgs_txt = build_chat_messages_with_options(&hist, "sys", false);
        assert!(msgs_txt[1]["content"].is_string());
        assert!(msgs_txt[1]["content"].as_str().unwrap().contains("omitted for text-only"));

        // Multi-step boundaries preserved (2 separate tool_calls assistant msgs, NOT collapsed into 1)
        let tool_call_msgs: Vec<&Value> = msgs_txt
            .iter()
            .filter(|m| m.get("tool_calls").is_some())
            .collect();
        assert_eq!(tool_call_msgs.len(), 2);
        assert_eq!(
            tool_call_msgs[0].pointer("/tool_calls/0/extra_content/google/thought_signature"),
            Some(&json!("sig_1"))
        );

        // Hysteresis image bounding replaces oldest image first
        let mut img_msgs = vec![
            json!({ "role": "user", "content": [{ "type": "image_url", "image_url": { "url": format!("data:image/png;base64,{}", "A".repeat(400)) } }] }),
            json!({ "role": "user", "content": [{ "type": "image_url", "image_url": { "url": format!("data:image/png;base64,{}", "B".repeat(400)) } }] }),
        ];
        let removed = bound_inline_images_with_limits(&mut img_msgs, 500, 450);
        assert_eq!(removed, 1);
        assert!(img_msgs[0]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("image was removed"));
        assert!(img_msgs[1]["content"][0].get("image_url").is_some());
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

    #[test]
    fn tracks_bash_and_lsp_failures_in_verification_buckets() {
        let parts_fail = vec![
            json!({
                "type": "tool",
                "name": "bash",
                "state": {
                    "status": "completed",
                    "input": { "command": "npm test" },
                    "structured": { "ok": false, "error": "1 test failed" }
                }
            }),
            json!({
                "type": "tool",
                "name": "lsp",
                "state": {
                    "status": "completed",
                    "input": { "filePath": "src/App.tsx" },
                    "structured": { "ok": false, "error": "No checker for .tsx" }
                }
            }),
        ];
        let blockers = collect_unresolved_mutating_or_verify_failures(&parts_fail);
        assert_eq!(blockers.len(), 2);
        assert!(blockers.iter().any(|b| b.contains("bash(npm test)")));
        assert!(blockers.iter().any(|b| b.contains("lsp(src/app.tsx)")));

        let mut parts_pass = parts_fail.clone();
        parts_pass.push(json!({
            "type": "tool",
            "name": "bash",
            "state": {
                "status": "completed",
                "input": { "command": "npm test" },
                "structured": { "ok": true }
            }
        }));
        let blockers_after = collect_unresolved_mutating_or_verify_failures(&parts_pass);
        assert_eq!(blockers_after.len(), 1);
        assert!(blockers_after[0].contains("lsp(src/app.tsx)"));
    }

    #[test]
    fn resumed_subagent_session_id_clears_earlier_incomplete_failure() {
        let same_turn_parts = vec![
            json!({
                "type": "tool",
                "id": "call_sub_1",
                "name": "task",
                "state": {
                    "status": "completed",
                    "input": { "subagent_type": "motion-designer", "description": "Build scenes" },
                    "structured": {
                        "ok": false,
                        "state": "incomplete",
                        "sessionID": "sub_123",
                        "error": "Reached max steps (30)"
                    }
                }
            }),
            json!({
                "type": "tool",
                "id": "call_sub_2",
                "name": "task",
                "state": {
                    "status": "completed",
                    "input": { "sessionID": "sub_123", "description": "Resume finishing render" },
                    "structured": { "ok": true, "state": "completed", "sessionID": "sub_123" }
                }
            }),
        ];
        assert!(collect_unresolved_mutating_or_verify_failures(&same_turn_parts).is_empty());

        let cross_turn_hist = vec![
            json!({
                "type": "assistant",
                "finish": "stop",
                "content": [same_turn_parts[0].clone()]
            }),
            json!({
                "type": "assistant",
                "finish": "stop",
                "content": [same_turn_parts[1].clone()]
            }),
        ];
        let msgs = build_chat_messages(&cross_turn_hist, "sys");
        let joined = msgs
            .iter()
            .filter_map(|m| m.get("content").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!joined.contains("[UNRESOLVED TOOL ERRORS IN TURN:"));
    }

    #[test]
    fn fifo_replay_image_hysteresis_keeps_cut_boundary_stable_on_append() {
        let img = |ch: &str, count: usize| {
            json!({
                "role": "user",
                "content": [{
                    "type": "image_url",
                    "image_url": { "url": format!("data:image/png;base64,{}", ch.repeat(count)) }
                }]
            })
        };
        let mut step3 = vec![img("A", 400), img("B", 400)];
        let rem3 = bound_inline_images_with_limits(&mut step3, 500, 450);
        assert_eq!(rem3, 1);

        // Appending a small image stays below trigger (500), so the cut boundary stays identical.
        let mut step4 = vec![img("A", 400), img("B", 400), img("C", 10)];
        let rem4 = bound_inline_images_with_limits(&mut step4, 500, 450);
        assert_eq!(rem4, 1);
        assert_eq!(step3[0], step4[0]);
        assert_eq!(step3[1], step4[1]);
    }

    #[test]
    fn prunes_superseded_preview_batches_and_enforces_max_image_count_cap() {
        let ref_msg = json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "[Tool visual output attached below in exact order:\n1. ref/extracted/frames/ref_scene_01.jpg\n]" },
                { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,REF1" } }
            ]
        });
        let prev_round1 = json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "[Tool visual output attached below in exact order:\n1. preview_0.jpg @ t=0.5s\n2. preview_1.jpg @ t=2.0s\n]" },
                { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,P1A" } },
                { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,P1B" } }
            ]
        });
        let prev_round2 = json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "[Tool visual output attached below in exact order:\n1. preview_0.jpg @ t=0.5s\n]" },
                { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,P2A" } }
            ]
        });
        let mut msgs = vec![ref_msg.clone(), prev_round1, prev_round2];
        let removed = bound_inline_images(&mut msgs);
        assert_eq!(removed, 2, "old preview round images must be pruned");
        assert_eq!(count_active_inline_images(&msgs), 2, "ref keyframe + latest preview kept");
        assert!(msgs[0].pointer("/content/1/image_url/url").is_some());
        assert!(msgs[2].pointer("/content/1/image_url/url").is_some());
        assert!(msgs[1]
            .pointer("/content/1/text")
            .and_then(Value::as_str)
            .is_some_and(|s| s.contains("Superseded preview image removed")));

        // Count-based FIFO hysteresis: 18 tiny images (well below 25 MiB):
        // At image #17 (> 16), prunes oldest 3 down to target (14); image #18 brings count to 15
        // (<= 16) without shifting the cut boundary (prompt-cache stable).
        let mut many: Vec<Value> = (0..18)
            .map(|i| {
                json!({
                    "role": "user",
                    "content": [{
                        "type": "image_url",
                        "image_url": { "url": format!("data:image/jpeg;base64,IMG{:02}", i) }
                    }]
                })
            })
            .collect();
        let count_removed = bound_inline_images(&mut many);
        assert_eq!(count_removed, 3);
        assert_eq!(count_active_inline_images(&many), IMAGE_BUDGET_TARGET_COUNT + 1);

        // Appending 2 more images crosses 16 again (17 > 16) and prunes cleanly down to 14.
        for i in 18..20 {
            many.push(json!({
                "role": "user",
                "content": [{
                    "type": "image_url",
                    "image_url": { "url": format!("data:image/jpeg;base64,IMG{:02}", i) }
                }]
            }));
        }
        let count_removed2 = bound_inline_images(&mut many);
        assert_eq!(count_removed2, 3);
        assert_eq!(count_active_inline_images(&many), IMAGE_BUDGET_TARGET_COUNT);

        // Sliding-window pruning: old `[FILMSTRIP_BATCH ...]` messages are replaced when a newer
        // filmstrip batch arrives, while keeping initial overview keyframes intact.
        let mut fs_msgs = vec![
            ref_msg,
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "[Tool visual output attached below in exact order:\n1. [FILMSTRIP_BATCH scene=1 sheets=1..5] filmstrips/sheet_001.jpg\n]" },
                    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,FS1" } }
                ]
            }),
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "[Tool visual output attached below in exact order:\n1. [FILMSTRIP_BATCH scene=2 sheets=6..9] filmstrips/sheet_006.jpg\n]" },
                    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,FS2" } }
                ]
            }),
        ];
        let fs_removed = bound_inline_images_with_count_and_bytes(
            &mut fs_msgs,
            IMAGE_BUDGET_TRIGGER_BYTES,
            IMAGE_BUDGET_TARGET_BYTES,
            2,
            2,
        );
        assert_eq!(fs_removed, 1);
        assert_eq!(count_active_inline_images(&fs_msgs), 2);
        assert!(fs_msgs[0].pointer("/content/1/image_url/url").is_some());
        assert!(fs_msgs[2].pointer("/content/1/image_url/url").is_some());
        assert!(fs_msgs[1]
            .pointer("/content/1/text")
            .and_then(Value::as_str)
            .is_some_and(|s| s.contains("Superseded filmstrip batch removed")));
    }

    #[test]
    fn slices_at_compacted_summary_and_keeps_historical_tool_payloads_cache_stable() {
        let big_out = "O".repeat(6_000);
        let big_code = "C".repeat(3_500);
        let hist = vec![
            json!({ "type": "user", "text": "very old pre-compaction message" }),
            json!({
                "type": "assistant",
                "compactedSummary": true,
                "content": [{ "type": "text", "text": "## Objective\n- Anchored summary" }]
            }),
            json!({
                "type": "assistant",
                "content": [
                    { "type": "reasoning", "text": "thinking step", "reasoningField": "reasoning" },
                    {
                        "type": "tool",
                        "id": "call_big",
                        "name": "write",
                        "state": {
                            "status": "completed",
                            "input": { "filePath": "index.html", "content": big_code },
                            "structured": { "ok": true, "output": big_code }
                        }
                    },
                    {
                        "type": "tool",
                        "id": "call_read",
                        "name": "read",
                        "state": {
                            "status": "completed",
                            "input": { "filePath": "ref.txt" },
                            "content": [{ "type": "text", "text": big_out }]
                        }
                    }
                ]
            }),
            json!({ "type": "user", "text": "t2" }),
            json!({ "type": "user", "text": "t3" }),
            json!({ "type": "user", "text": "t4" }),
            json!({ "type": "user", "text": "t5" }),
        ];

        let msgs = build_chat_messages(&hist, "sys");
        let serialized = serde_json::to_string(&msgs).unwrap();
        assert!(!serialized.contains("very old pre-compaction message"));
        assert!(serialized.contains("Anchored summary"));
        assert!(serialized.contains(&big_code));
        assert!(serialized.contains(&big_out));
        let step_msg = msgs.iter().find(|m| m.get("tool_calls").is_some()).unwrap();
        assert_eq!(step_msg["reasoning"], json!("thinking step"));
    }
}

