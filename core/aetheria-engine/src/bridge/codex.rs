use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use super::extract_content_text;
use super::schema::normalize_openai_schema;
use crate::cred_store::{decode_jwt_payload, ensure_fresh_credential, refresh_credential_source};

// ============================================================================
// 4. CODEX (ChatGPT Backend Responses API)
// ============================================================================
fn normalize_codex_model(model: &str) -> &str {
    model.strip_prefix("codex/").unwrap_or(model)
}

fn build_codex_user_content(content: Option<&Value>) -> Vec<Value> {
    let mut parts = Vec::new();
    match content {
        Some(Value::String(s)) => {
            parts.push(json!({ "type": "input_text", "text": s }));
        }
        Some(Value::Array(arr)) => {
            for item in arr {
                if let Some(s) = item.as_str() {
                    if !s.is_empty() {
                        parts.push(json!({ "type": "input_text", "text": s }));
                    }
                    continue;
                }
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if item_type == "image_url" || item_type == "input_image" || item.get("image_url").is_some() {
                    let raw_url = item
                        .pointer("/image_url/url")
                        .or_else(|| item.get("image_url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    if !raw_url.is_empty() {
                        parts.push(json!({
                            "type": "input_image",
                            "image_url": raw_url
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
                        parts.push(json!({ "type": "input_text", "text": txt }));
                    }
                }
            }
        }
        _ => {}
    }
    if parts.is_empty() {
        parts.push(json!({ "type": "input_text", "text": "" }));
    }
    parts
}

pub(crate) async fn handle_codex_request(body: Value, model: &str, is_stream: bool) -> Response {
    let mut cred = match ensure_fresh_credential("codex").await {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": { "message": "Codex CLI credentials not found." } })),
            )
                .into_response()
        }
    };

    let account_id = cred
        .account_id
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            decode_jwt_payload(&cred.access_token).and_then(|p| {
                p.pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
        })
        .unwrap_or_default();

    let messages = body
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut sys_parts = Vec::new();
    let mut input = Vec::new();

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
            input.push(json!({
                "type": "function_call_output",
                "call_id": call_id,
                "output": out_str
            }));
            continue;
        }
        if role == "assistant" {
            let txt = extract_content_text(m.get("content"));
            if !txt.is_empty() {
                input.push(json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": txt }]
                }));
            }
            if let Some(tcs) = m.get("tool_calls").and_then(|v| v.as_array()) {
                for tc in tcs {
                    let call_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("call_0");
                    let name = tc
                        .pointer("/function/name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool");
                    let args = tc
                        .pointer("/function/arguments")
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    input.push(json!({
                        "type": "function_call",
                        "call_id": call_id,
                        "name": name,
                        "arguments": args
                    }));
                }
            }
            continue;
        }
        let user_content = build_codex_user_content(m.get("content"));
        input.push(json!({
            "type": "message",
            "role": "user",
            "content": user_content
        }));
    }

    let mut codex_payload = json!({
        "model": normalize_codex_model(model),
        "instructions": if sys_parts.is_empty() { "You are a helpful assistant.".to_string() } else { sys_parts.join("\n\n") },
        "input": input,
        "stream": true,
        "store": false
    });

    if let Some(tools) = body.get("tools").and_then(|v| v.as_array()) {
        let mapped: Vec<Value> = tools
            .iter()
            .map(|t| {
                if let Some(fn_obj) = t.get("function") {
                    let raw_params = fn_obj
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
                    json!({
                        "type": "function",
                        "name": fn_obj.get("name"),
                        "description": fn_obj.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                        "parameters": normalize_openai_schema(&raw_params)
                    })
                } else {
                    t.clone()
                }
            })
            .collect();
        if !mapped.is_empty() {
            codex_payload["tools"] = Value::Array(mapped);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .unwrap_or_default();

    let mut req_builder = client
        .post("https://chatgpt.com/backend-api/codex/responses")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", cred.access_token))
        .header("originator", "codex_cli_rs")
        .header("Accept", "text/event-stream");
    if !account_id.is_empty() {
        req_builder = req_builder.header("ChatGPT-Account-ID", &account_id);
    }

    let mut resp = match req_builder.json(&codex_payload).send().await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": { "message": format!("Codex request error: {}", e) } })),
            )
                .into_response()
        }
    };

    if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
        if let Some(refreshed) = refresh_credential_source("codex", &cred).await {
            cred = refreshed;
            let mut rb2 = client
                .post("https://chatgpt.com/backend-api/codex/responses")
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", cred.access_token))
                .header("originator", "codex_cli_rs")
                .header("Accept", "text/event-stream");
            if !account_id.is_empty() {
                rb2 = rb2.header("ChatGPT-Account-ID", &account_id);
            }
            if let Ok(r2) = rb2.json(&codex_payload).send().await {
                resp = r2;
            }
        }
    }

    if !resp.status().is_success() {
        let st = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return (
            st,
            Json(json!({ "error": { "message": format!("Codex error ({}): {}", st, txt) } })),
        )
            .into_response();
    }

    let sse_text = resp.text().await.unwrap_or_default();
    let mut full_text = String::new();
    let mut thought_text = String::new();
    let mut tool_calls = Vec::new();

    for line in sse_text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data_str = trimmed.trim_start_matches("data:").trim();
        if data_str.is_empty() || data_str == "[DONE]" {
            continue;
        }
        if let Ok(evt) = serde_json::from_str::<Value>(data_str) {
            let etype = evt.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if etype == "response.output_text.delta" {
                if let Some(d) = evt.get("delta").and_then(|v| v.as_str()) {
                    full_text.push_str(d);
                }
            } else if etype == "response.reasoning_summary_text.delta"
                || etype == "response.reasoning_text.delta"
            {
                if let Some(d) = evt.get("delta").and_then(|v| v.as_str()) {
                    thought_text.push_str(d);
                }
            } else if etype == "response.output_item.done" {
                if let Some(item) = evt.get("item") {
                    if item.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                        let call_id = item
                            .get("call_id")
                            .or_else(|| item.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("call_0");
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool");
                        let args = item
                            .get("arguments")
                            .and_then(|v| v.as_str())
                            .unwrap_or("{}");
                        tool_calls.push(json!({
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": args
                            }
                        }));
                    }
                }
            }
        }
    }

    if is_stream {
        super::make_sse_response_with_reasoning(model, full_text, thought_text, tool_calls)
    } else {
        super::make_completion_response_with_reasoning(model, full_text, thought_text, tool_calls)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_user_image_url_as_input_image() {
        let content = json!([
            { "type": "text", "text": "buat animasi untuk adobestock dari 2 gambar ini" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }
        ]);
        let mapped = build_codex_user_content(Some(&content));
        assert_eq!(mapped.len(), 3);
        assert_eq!(mapped[0]["type"], "input_text");
        assert_eq!(
            mapped[0]["text"],
            "buat animasi untuk adobestock dari 2 gambar ini"
        );
        assert_eq!(mapped[1]["type"], "input_image");
        assert_eq!(mapped[1]["image_url"], "data:image/png;base64,iVBORw0KGgo=");
        assert_eq!(mapped[2]["type"], "input_image");
        assert_eq!(mapped[2]["image_url"], "data:image/png;base64,AAAA");
    }
}

