//! Unified LLM Resilience Sender — coordinates `retry`, `stream_parser`, `stale_settlement`,
//! multi-key rotation, and automatic failover to Free Kenari (`glm-5.1`).

pub use super::retry::{
    compute_retry_backoff_ms, is_timeout_error, is_unreachable_network_error, MAX_TIMEOUT_RETRIES,
    SYNTHETIC_OUTPUT_LIMIT_PROMPT,
};
pub use super::stale_settlement::settle_stale_session_state;
pub use super::stream_parser::{parse_completion_body, sanitize_multimodal_messages_to_text};

use serde_json::{json, Value};
use std::time::Duration;

use super::retry::parse_retry_after_ms;
use crate::session::compaction::{
    emergency_compact_messages, is_context_overflow_error,
};
use crate::session::provider_error::{is_hard_quota_exhausted, is_rate_limit_throttle};

/// Output from a resilient single-step chat completion call.
pub struct ResilientCompletionOutput {
    pub assistant_text: String,
    pub tool_calls: Vec<Value>,
    pub finish_reason: String,
}

/// Executes a resilient chat completion request with full OpenCode recovery protections.
#[allow(clippy::too_many_arguments)]
pub async fn send_resilient_chat_completion(
    client: &reqwest::Client,
    base_url: &mut String,
    api_key: &mut String,
    model_id: &mut String,
    chat_messages: &mut Vec<Value>,
    tools: &[Value],
    temperature: f64,
    max_tokens: u64,
) -> Result<ResilientCompletionOutput, String> {
    let opt_temp = if model_id.to_ascii_lowercase().contains("gemini") {
        None
    } else {
        Some(temperature)
    };
    send_resilient_chat_completion_with_options(
        client,
        base_url,
        api_key,
        model_id,
        chat_messages,
        tools,
        opt_temp,
        max_tokens,
        None,
    )
    .await
}

pub(crate) fn build_resilient_chat_payload_with_tool_choice(
    model_id: &str,
    chat_messages: &[Value],
    tools: &[Value],
    temperature: Option<f64>,
    max_tokens: u64,
    reasoning_effort: Option<&str>,
    tool_choice: Option<&Value>,
) -> Value {
    let mut outbound_msgs = chat_messages.to_vec();
    super::history::bound_inline_images(&mut outbound_msgs);
    let mut payload = json!({
        "model": model_id,
        "messages": outbound_msgs,
        "max_tokens": max_tokens,
        "stream": true
    });
    // OpenCode pattern: omit `temperature` when `None` (especially for all Gemini 2.5/3 models
    // so they run at their native calibrated temperature instead of degraded 0.3 overrides).
    if let Some(temp) = temperature {
        payload["temperature"] = json!(temp);
    }
    if let Some(effort) = reasoning_effort.map(str::trim).filter(|s| !s.is_empty()) {
        payload["reasoning_effort"] = json!(effort);
    }
    if !tools.is_empty() {
        let normalized_tools = crate::bridge::schema::normalize_tools_for_model(model_id, tools);
        payload["tools"] = Value::Array(normalized_tools);
        if let Some(tc) = tool_choice {
            payload["tool_choice"] = tc.clone();
        }
    }
    payload
}

/// Variant of `send_resilient_chat_completion` accepting optional `temperature` and per-role `reasoning_effort`.
#[allow(clippy::too_many_arguments)]
pub async fn send_resilient_chat_completion_with_options(
    client: &reqwest::Client,
    base_url: &mut String,
    api_key: &mut String,
    model_id: &mut String,
    chat_messages: &mut Vec<Value>,
    tools: &[Value],
    temperature: Option<f64>,
    max_tokens: u64,
    reasoning_effort: Option<&str>,
) -> Result<ResilientCompletionOutput, String> {
    send_resilient_chat_completion_with_tool_choice(
        client,
        base_url,
        api_key,
        model_id,
        chat_messages,
        tools,
        temperature,
        max_tokens,
        reasoning_effort,
        None,
    )
    .await
}

/// Variant accepting an explicit `tool_choice` override (e.g. grammar-enforced `write_scene_script`).
#[allow(clippy::too_many_arguments)]
pub async fn send_resilient_chat_completion_with_tool_choice(
    client: &reqwest::Client,
    base_url: &mut String,
    api_key: &mut String,
    model_id: &mut String,
    chat_messages: &mut Vec<Value>,
    tools: &[Value],
    temperature: Option<f64>,
    max_tokens: u64,
    reasoning_effort: Option<&str>,
    tool_choice: Option<&Value>,
) -> Result<ResilientCompletionOutput, String> {
    let max_retries: usize = 6;
    let mut attempt: usize = 0;
    let mut timeout_retries: usize = 0;
    let mut did_emergency_compact = false;
    let mut did_failover = false;

    loop {
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let payload = build_resilient_chat_payload_with_tool_choice(
            model_id,
            chat_messages,
            tools,
            temperature,
            max_tokens,
            reasoning_effort,
            tool_choice,
        );

        let mut req = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json");
        let active_key = crate::provider::protocol_adapters::select_healthy_api_key(api_key);
        if !active_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", active_key));
        }

        match req.json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(raw_body) => match parse_completion_body(&raw_body) {
                    Ok((assistant_text, tool_calls, finish_reason)) => {
                        return Ok(ResilientCompletionOutput {
                            assistant_text,
                            tool_calls,
                            finish_reason,
                        });
                    }
                    Err(parse_err) => {
                        if is_context_overflow_error(&parse_err) && !did_emergency_compact {
                            did_emergency_compact = true;
                            *chat_messages = emergency_compact_messages(chat_messages);
                            continue;
                        }
                        if attempt < max_retries {
                            attempt += 1;
                            let delay = compute_retry_backoff_ms(attempt, false, None);
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                            continue;
                        }
                        return Err(parse_err);
                    }
                },
                Err(read_err) => {
                    let err_str = read_err.to_string();
                    if is_context_overflow_error(&err_str) && !did_emergency_compact {
                        did_emergency_compact = true;
                        *chat_messages = emergency_compact_messages(chat_messages);
                        continue;
                    }
                    if attempt < max_retries {
                        attempt += 1;
                        let delay = compute_retry_backoff_ms(attempt, false, None);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        continue;
                    }
                    return Err(format!("Failed reading LLM response body: {}", err_str));
                }
            },
            Ok(resp) => {
                let status_code = resp.status().as_u16();
                let retry_after_ms_hdr = resp
                    .headers()
                    .get("retry-after-ms")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let retry_after = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let err_txt = resp.text().await.unwrap_or_default();

                if is_context_overflow_error(&err_txt) && !did_emergency_compact {
                    did_emergency_compact = true;
                    *chat_messages = emergency_compact_messages(chat_messages);
                    continue;
                }

                if (status_code == 400 || status_code == 415 || status_code == 422)
                    && sanitize_multimodal_messages_to_text(chat_messages)
                {
                    continue;
                }

                let is_hard_quota = is_hard_quota_exhausted(status_code, &err_txt);
                let is_throttle = is_rate_limit_throttle(status_code, &err_txt);
                if is_hard_quota || is_throttle {
                    let cur_key =
                        crate::provider::protocol_adapters::select_healthy_api_key(api_key);
                    if crate::provider::protocol_adapters::rotate_api_key_on_quota(
                        api_key, &cur_key, 60_000,
                    )
                    .is_some()
                    {
                        continue;
                    }
                }
                let is_server_err = status_code >= 500 || status_code == 408;

                // Retry transient bursts (429 / throttling) and 5xx on the user's selected model
                // up to OpenCode retry budget BEFORE considering failover.
                if (is_server_err || is_throttle) && attempt < max_retries {
                    attempt += 1;
                    let delay = parse_retry_after_ms(
                        retry_after_ms_hdr.as_deref(),
                        retry_after.as_deref(),
                    )
                    .unwrap_or_else(|| compute_retry_backoff_ms(attempt, false, None));
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    continue;
                }

                if is_hard_quota && !did_failover {
                    did_failover = true;
                    let port = crate::bridge::ensure_bridge_running().await;
                    *base_url = format!("http://127.0.0.1:{}/v1", port);
                    *api_key = "local-cli-bridge".to_string();
                    *model_id = "glm-5.1".to_string();
                    continue;
                }

                let preview: String = err_txt.chars().take(240).collect();
                if is_throttle {
                    return Err(format!(
                        "Rate limit (RPM/TPM) from provider (HTTP {}): {}",
                        status_code, preview
                    ));
                }
                return Err(format!("HTTP {} from provider: {}", status_code, preview));
            }
            Err(net_err) => {
                let err_str = net_err.to_string();
                let is_unreach = is_unreachable_network_error(&err_str);
                let is_tmo = is_timeout_error(&err_str);

                if base_url.contains("127.0.0.1:4318") || base_url.contains("localhost:4318") {
                    let port = crate::bridge::ensure_bridge_running().await;
                    *base_url = format!("http://127.0.0.1:{}/v1", port);
                }

                if is_tmo {
                    timeout_retries += 1;
                    if timeout_retries > MAX_TIMEOUT_RETRIES && !did_failover {
                        did_failover = true;
                        let port = crate::bridge::ensure_bridge_running().await;
                        *base_url = format!("http://127.0.0.1:{}/v1", port);
                        *api_key = "local-cli-bridge".to_string();
                        *model_id = "glm-5.1".to_string();
                        continue;
                    }
                }

                if attempt < max_retries {
                    attempt += 1;
                    let delay = compute_retry_backoff_ms(attempt, is_unreach, None);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    continue;
                }

                if !did_failover {
                    did_failover = true;
                    let port = crate::bridge::ensure_bridge_running().await;
                    *base_url = format!("http://127.0.0.1:{}/v1", port);
                    *api_key = "local-cli-bridge".to_string();
                    *model_id = "glm-5.1".to_string();
                    continue;
                }

                return Err(format!("Network error after {} retries: {}", attempt, err_str));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_retry_backoff_honors_retry_after() {
        let d = compute_retry_backoff_ms(1, false, Some("7"));
        assert_eq!(d, 7_000);
    }

    #[test]
    fn test_compute_retry_backoff_unreachable_scales_higher() {
        let normal = compute_retry_backoff_ms(5, false, None);
        let unreach = compute_retry_backoff_ms(5, true, None);
        assert!(normal <= 10_450);
        assert!(unreach >= 30_000);
    }

    #[test]
    fn test_parse_completion_body_json_and_sse() {
        let json_body = r#"{
            "choices": [{
                "finish_reason": "stop",
                "message": { "role": "assistant", "content": "Hello from JSON" }
            }]
        }"#;
        let (text, tcs, reason) = parse_completion_body(json_body).expect("valid json");
        assert_eq!(text, "Hello from JSON");
        assert!(tcs.is_empty());
        assert_eq!(reason, "stop");

        let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"Part 1 \"}}]}\n\
                        data: {\"choices\":[{\"delta\":{\"content\":\"Part 2\"},\"finish_reason\":\"length\"}]}\n\
                        data: [DONE]\n";
        let (sse_text, _, sse_reason) = parse_completion_body(sse_body).expect("valid sse");
        assert_eq!(sse_text, "Part 1 Part 2");
        assert_eq!(sse_reason, "length");
    }

    #[test]
    fn test_build_resilient_chat_payload_forwards_tool_choice_and_omits_gemini_temp() {
        let msgs = vec![json!({ "role": "user", "content": "hi" })];
        let tools = vec![json!({
            "type": "function",
            "function": { "name": "write_scene_script", "parameters": { "type": "object" } }
        })];
        let tc = json!({ "type": "function", "function": { "name": "write_scene_script" } });
        let payload = build_resilient_chat_payload_with_tool_choice(
            "gemini-3.8-flash-high",
            &msgs,
            &tools,
            None,
            32768,
            None,
            Some(&tc),
        );
        assert!(payload.get("temperature").is_none());
        assert_eq!(
            payload.pointer("/tool_choice/function/name").and_then(Value::as_str),
            Some("write_scene_script")
        );
    }
}
