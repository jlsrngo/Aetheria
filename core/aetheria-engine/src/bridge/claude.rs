use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use super::extract_content_text;
use crate::cred_store::ensure_fresh_credential;

// ============================================================================
// 5. CLAUDE (Anthropic Messages API)
// ============================================================================
fn parse_data_image_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    let rest = trimmed.strip_prefix("data:")?;
    let (meta, b64) = rest.split_once(";base64,")?;
    let mime = meta.trim();
    let clean_b64: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    if mime.is_empty() || clean_b64.is_empty() {
        return None;
    }
    Some((mime.to_string(), clean_b64))
}

fn build_claude_user_content(content: Option<&Value>) -> Vec<Value> {
    let mut blocks = Vec::new();
    match content {
        Some(Value::String(s)) => {
            if !s.is_empty() {
                blocks.push(json!({ "type": "text", "text": s }));
            }
        }
        Some(Value::Array(arr)) => {
            for item in arr {
                if let Some(s) = item.as_str() {
                    if !s.is_empty() {
                        blocks.push(json!({ "type": "text", "text": s }));
                    }
                    continue;
                }
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if item_type == "image_url" || item.get("image_url").is_some() {
                    let raw_url = item
                        .pointer("/image_url/url")
                        .or_else(|| item.get("image_url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if let Some((mime, b64)) = parse_data_image_url(raw_url) {
                        blocks.push(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": b64
                            }
                        }));
                    }
                    continue;
                }
                if let Some(txt) = item
                    .get("text")
                    .or_else(|| item.get("input_text"))
                    .or_else(|| item.get("content"))
                    .and_then(|v| v.as_str())
                {
                    if !txt.is_empty() {
                        blocks.push(json!({ "type": "text", "text": txt }));
                    }
                }
            }
        }
        _ => {}
    }
    if blocks.is_empty() {
        blocks.push(json!({ "type": "text", "text": " " }));
    }
    blocks
}

pub(crate) async fn handle_claude_request(body: Value, model: &str, is_stream: bool) -> Response {
    let cred = match ensure_fresh_credential("claude").await {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": { "message": "Claude CLI credentials not found." } })),
            )
                .into_response()
        }
    };

    let messages = body
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut sys_parts = Vec::new();
    let mut claude_msgs: Vec<Value> = Vec::new();

    for m in &messages {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        if role == "system" || role == "developer" {
            let txt = extract_content_text(m.get("content"));
            if !txt.trim().is_empty() {
                sys_parts.push(txt);
            }
            continue;
        }
        if role == "tool" {
            let call_id = m
                .get("tool_call_id")
                .or_else(|| m.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("call_0");
            let out_str = extract_content_text(m.get("content"));
            let tr_block = json!({
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": out_str
            });
            if let Some(last) = claude_msgs.last_mut() {
                if last.get("role").and_then(|v| v.as_str()) == Some("user") {
                    if let Some(arr) = last.get_mut("content").and_then(|v| v.as_array_mut()) {
                        arr.push(tr_block);
                        continue;
                    }
                }
            }
            claude_msgs.push(json!({
                "role": "user",
                "content": [tr_block]
            }));
            continue;
        }
        if role == "assistant" {
            let mut blocks = Vec::new();
            let txt = extract_content_text(m.get("content"));
            if !txt.trim().is_empty() {
                blocks.push(json!({
                    "type": "text",
                    "text": txt
                }));
            }
            if let Some(tcs) = m.get("tool_calls").and_then(|v| v.as_array()) {
                for tc in tcs {
                    let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("call_0");
                    let name = tc
                        .pointer("/function/name")
                        .or_else(|| tc.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool");
                    let input_val = match tc.pointer("/function/arguments") {
                        Some(Value::String(s)) => {
                            serde_json::from_str::<Value>(s).unwrap_or_else(|_| json!({}))
                        }
                        Some(v) if v.is_object() => v.clone(),
                        _ => json!({}),
                    };
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": id,
                        "name": name,
                        "input": input_val
                    }));
                }
            }
            if !blocks.is_empty() {
                claude_msgs.push(json!({
                    "role": "assistant",
                    "content": blocks
                }));
            }
            continue;
        }

        let user_blocks = build_claude_user_content(m.get("content"));
        claude_msgs.push(json!({
            "role": "user",
            "content": user_blocks
        }));
    }

    let mut payload = json!({
        "model": model,
        "max_tokens": body.get("max_tokens").and_then(|v| v.as_u64()).unwrap_or(8192),
        "messages": claude_msgs,
        "stream": false
    });
    if !sys_parts.is_empty() {
        payload["system"] = Value::String(sys_parts.join("\n\n"));
    }

    if let Some(tools) = body.get("tools").and_then(|v| v.as_array()) {
        let mut mapped_tools = Vec::new();
        for t in tools {
            let fn_obj = t.get("function").unwrap_or(t);
            if let Some(name) = fn_obj.get("name").and_then(|v| v.as_str()) {
                let desc = fn_obj
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let schema = fn_obj
                    .get("parameters")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
                mapped_tools.push(json!({
                    "name": name,
                    "description": desc,
                    "input_schema": schema
                }));
            }
        }
        if !mapped_tools.is_empty() {
            payload["tools"] = Value::Array(mapped_tools);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .unwrap_or_default();

    let resp = match client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", cred.access_token))
        .header("anthropic-version", "2023-06-01")
        .header(
            "anthropic-beta",
            "oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14",
        )
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": { "message": format!("Claude request error: {}", e) } })),
            )
                .into_response()
        }
    };

    if !resp.status().is_success() {
        let st = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return (
            st,
            Json(json!({ "error": { "message": format!("Claude error ({}): {}", st, txt) } })),
        )
            .into_response();
    }

    let data: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    let mut text = String::new();
    let mut thought_text = String::new();
    let mut tool_calls = Vec::new();
    if let Some(arr) = data.get("content").and_then(|v| v.as_array()) {
        for block in arr {
            let btype = block.get("type").and_then(|v| v.as_str());
            if btype == Some("thinking") || btype == Some("reasoning") {
                if let Some(t) = block
                    .get("thinking")
                    .or_else(|| block.get("text"))
                    .and_then(|v| v.as_str())
                {
                    thought_text.push_str(t);
                }
            } else if btype == Some("text") {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    text.push_str(t);
                }
            } else if btype == Some("tool_use") {
                let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("call_0");
                let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                let args = serde_json::to_string(block.get("input").unwrap_or(&json!({})))
                    .unwrap_or_else(|_| "{}".to_string());
                tool_calls.push(json!({
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": args }
                }));
            }
        }
    }

    if is_stream {
        super::make_sse_response_with_reasoning(model, text, thought_text, tool_calls)
    } else {
        super::make_completion_response_with_reasoning(model, text, thought_text, tool_calls)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_user_image_url_as_anthropic_base64_image() {
        let content = json!([
            { "type": "text", "text": "inspect this reference image" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } }
        ]);
        let blocks = build_claude_user_content(Some(&content));
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "inspect this reference image");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["source"]["type"], "base64");
        assert_eq!(blocks[1]["source"]["media_type"], "image/png");
        assert_eq!(blocks[1]["source"]["data"], "iVBORw0KGgo=");
    }
}
