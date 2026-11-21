//! Resolves the active LLM provider endpoint, API key, and model ID for subagents.
//! Inherits the parent session's active provider/model so subagents run on the exact model chosen by the user.

use crate::provider::read_aetheria_config;
use crate::session::model::default_model_ref;
use crate::session::session::with_store;
use serde_json::Value;

/// Baseline default max_tokens for lightweight non-coding subagent roles (`explore`, `audio-director`, `qa-verifier`).
pub(crate) const DEFAULT_SUBAGENT_MAX_TOKENS: u64 = 4096;

/// Default output budget for `motion-designer`: high-craft multi-phase procedural Canvas scenes
/// run 150-330 lines (~5-12 KB) each; 24,576 tokens prevents agents from compressing scenes into
/// thin 40-line stubs when writing 2-3 rich scenes per turn. Capped to `model.limit.output` when lower.
pub(crate) const DEFAULT_MOTION_DESIGNER_MAX_TOKENS: u64 = 24_576;

pub(crate) fn resolve_subagent_max_tokens(
    cfg: &Value,
    subagent_type: &str,
    provider_id: &str,
    model_id: &str,
) -> u64 {
    let role = subagent_type.trim();
    if let Some(configured) = cfg
        .pointer(&format!("/agent/{}/max_tokens", role))
        .or_else(|| cfg.pointer(&format!("/agent/{}/maxTokens", role)))
        .and_then(Value::as_u64)
        .filter(|&n| n >= 256)
    {
        return configured;
    }
    let role_default = if role.eq_ignore_ascii_case("motion-designer") {
        DEFAULT_MOTION_DESIGNER_MAX_TOKENS
    } else {
        DEFAULT_SUBAGENT_MAX_TOKENS
    };
    if let Some(model_cap) = super::runner::find_model_config(cfg, provider_id, model_id)
        .and_then(|m| m.pointer("/limit/output"))
        .and_then(Value::as_u64)
        .filter(|&n| n >= 256)
    {
        return role_default.min(model_cap);
    }
    role_default
}

fn parse_reasoning_setting(raw: &Value) -> Option<String> {
    if let Some(flag) = raw.as_bool() {
        return if flag { None } else { Some("none".to_string()) };
    }
    let s = raw.as_str()?.trim().to_ascii_lowercase();
    match s.as_str() {
        "none" | "off" | "false" | "disable" | "disabled" => Some("none".to_string()),
        "minimal" | "low" | "medium" | "high" => Some(s),
        _ => None,
    }
}

/// Resolves per-role `agent.<id>.reasoning` when configured and supported by the active model.
/// Returns `None` when unset so global provider/model defaults stay completely untouched.
pub(crate) fn resolve_subagent_reasoning_effort(
    cfg: &Value,
    subagent_type: &str,
    provider_id: &str,
    model_id: &str,
) -> Option<String> {
    let role = subagent_type.trim();
    let raw = cfg
        .pointer(&format!("/agent/{}/reasoning", role))
        .or_else(|| cfg.pointer(&format!("/agent/{}/reasoningEffort", role)))
        .or_else(|| cfg.pointer(&format!("/agent/{}/reasoning_effort", role)))?;
    let effort = match parse_reasoning_setting(raw) {
        Some(v) => v,
        None => {
            if !raw.is_null() && !raw.is_boolean() {
                crate::paths::log_engine(
                    "subagent",
                    &format!(
                        "Ignoring unrecognized agent.{}.reasoning value {}; leaving model default.",
                        role, raw
                    ),
                );
            }
            return None;
        }
    };
    if !super::runner::model_supports_reasoning_from_config(Some(cfg), provider_id, model_id) {
        crate::paths::log_engine(
            "subagent",
            &format!(
                "Ignoring agent.{}.reasoning='{}': model '{}/{}' does not support per-request reasoning control.",
                role, effort, provider_id, model_id
            ),
        );
        return None;
    }
    Some(effort)
}

/// Resolves per-role reasoning effort, falling back to an inherited parent session variant
/// when the subagent uses the same provider/model and per-role reasoning is unset.
pub(crate) fn resolve_subagent_reasoning_effort_with_fallback(
    cfg: &Value,
    subagent_type: &str,
    provider_id: &str,
    model_id: &str,
    fallback_variant: Option<&str>,
) -> Option<String> {
    if let Some(configured) =
        resolve_subagent_reasoning_effort(cfg, subagent_type, provider_id, model_id)
    {
        return Some(configured);
    }
    let variant = fallback_variant
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("default"))?;
    let explicitly_disabled = super::runner::find_model_config(cfg, provider_id, model_id)
        .and_then(|m| {
            m.get("reasoning")
                .or_else(|| m.pointer("/capabilities/reasoning"))
                .and_then(Value::as_bool)
        })
        == Some(false)
        || super::runner::local_bridge_supports_reasoning_effort(provider_id, model_id)
            == Some(false);
    if explicitly_disabled {
        None
    } else {
        Some(variant.to_string())
    }
}

pub(crate) fn resolve_parent_model_ref(parent_session_id: &str) -> (String, String) {
    let (provider_id, model_id, _) = resolve_parent_model_ref_with_variant(parent_session_id);
    (provider_id, model_id)
}

pub(crate) fn resolve_parent_model_ref_with_variant(
    parent_session_id: &str,
) -> (String, String, Option<String>) {
    let parent_model = with_store(|store| {
        store
            .sessions
            .get(parent_session_id)
            .and_then(|s| s.get("model"))
            .cloned()
    })
    .unwrap_or_else(default_model_ref);

    let provider_id = parent_model
        .get("providerID")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("local-cli")
        .to_string();
    let model_id = parent_model
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("kiro/auto")
        .to_string();
    let variant = parent_model
        .get("variant")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    (provider_id, model_id, variant)
}

fn resolve_provider_endpoint_and_key(cfg: &Value, provider_id: &str, bridge_url: &str) -> (String, String) {
    if provider_id == "antigravity" || provider_id == "local-cli" {
        return (bridge_url.to_string(), "local-cli-bridge".to_string());
    }

    let base_url = cfg
        .pointer(&format!("/provider/{}/options/baseURL", provider_id))
        .or_else(|| cfg.pointer(&format!("/provider/{}/api/url", provider_id)))
        .or_else(|| cfg.pointer(&format!("/provider/{}/api", provider_id)))
        .or_else(|| cfg.pointer(&format!("/providers/{}/options/baseURL", provider_id)))
        .or_else(|| cfg.pointer(&format!("/providers/{}/api/url", provider_id)))
        .and_then(Value::as_str)
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| bridge_url.to_string());

    let api_key = cfg
        .pointer(&format!("/provider/{}/options/apiKey", provider_id))
        .or_else(|| cfg.pointer(&format!("/provider/{}/request/body/apiKey", provider_id)))
        .or_else(|| cfg.pointer(&format!("/providers/{}/options/apiKey", provider_id)))
        .or_else(|| cfg.pointer(&format!("/providers/{}/request/body/apiKey", provider_id)))
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "local-cli-bridge".to_string());

    (base_url, api_key)
}

fn parse_model_spec(cfg: &Value, spec: &str, fallback_provider: &str) -> Option<(String, String)> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((p, m)) = trimmed.split_once('/') {
        let p = p.trim();
        let m = m.trim();
        if !p.is_empty() && !m.is_empty() {
            let is_known_provider = cfg.pointer(&format!("/provider/{}", p)).is_some()
                || cfg.pointer(&format!("/providers/{}", p)).is_some()
                || matches!(
                    p,
                    "local-cli" | "antigravity" | "kenari" | "openai" | "anthropic" | "google" | "parity"
                )
                || p.starts_with("parity");
            if is_known_provider {
                return Some((p.to_string(), m.to_string()));
            }
        }
    }
    Some((fallback_provider.to_string(), trimmed.to_string()))
}

fn resolve_agent_configured_model(
    cfg: &Value,
    agent_name: &str,
    fallback_provider: &str,
) -> Option<(String, String)> {
    let agent_model = cfg.pointer(&format!("/agent/{}/model", agent_name))?;
    if let Some(s) = agent_model.as_str() {
        return parse_model_spec(cfg, s, fallback_provider);
    }
    if let Some(obj) = agent_model.as_object() {
        let pid = obj
            .get("providerID")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback_provider);
        let mid = obj
            .get("modelID")
            .or_else(|| obj.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        return Some((pid.to_string(), mid.to_string()));
    }
    None
}

pub(crate) fn resolve_child_vision_capability(
    parent_session_id: &str,
    agent_name: &str,
    model_override: Option<&str>,
) -> (String, String, bool) {
    let cfg = read_aetheria_config();
    let (parent_provider_id, parent_model_id) = resolve_parent_model_ref(parent_session_id);
    let (provider_id, model_id) = model_override
        .and_then(|spec| parse_model_spec(&cfg, spec, &parent_provider_id))
        .or_else(|| resolve_agent_configured_model(&cfg, agent_name, &parent_provider_id))
        .unwrap_or((parent_provider_id, parent_model_id));
    let supports_vision =
        super::runner::model_supports_vision_from_config(Some(&cfg), &provider_id, &model_id);
    (provider_id, model_id, supports_vision)
}

pub(crate) async fn resolve_subagent_provider_config_for_call(
    parent_session_id: &str,
    agent_name: &str,
    model_override: Option<&str>,
) -> (String, String, String, String) {
    let cfg = read_aetheria_config();
    let (parent_provider_id, parent_model_id) = resolve_parent_model_ref(parent_session_id);
    let (provider_id, model_id) = model_override
        .and_then(|spec| parse_model_spec(&cfg, spec, &parent_provider_id))
        .or_else(|| resolve_agent_configured_model(&cfg, agent_name, &parent_provider_id))
        .unwrap_or_else(|| (parent_provider_id.clone(), parent_model_id));

    let session_model = with_store(|store| {
        store
            .sessions
            .get(parent_session_id)
            .and_then(|s| s.get("model"))
            .cloned()
    });

    let bridge_url = if provider_id == "antigravity" || provider_id == "local-cli" {
        let port = crate::bridge::ensure_bridge_running().await;
        format!("http://127.0.0.1:{}/v1", port)
    } else {
        crate::bridge::get_bridge_base_url()
    };

    let (mut base_url, mut api_key) =
        resolve_provider_endpoint_and_key(&cfg, &provider_id, &bridge_url);
    if provider_id == parent_provider_id {
        if let Some(ref sm) = session_model {
            if let Some(sess_url) = sm
                .get("baseURL")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                base_url = sess_url.trim_end_matches('/').to_string();
            }
            if let Some(sess_key) = sm
                .get("apiKey")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                api_key = sess_key.to_string();
            }
        }
    }
    (base_url, api_key, model_id, provider_id)
}

#[allow(dead_code)]
pub(crate) async fn resolve_subagent_provider_config(
    parent_session_id: &str,
) -> (String, String, String) {
    let (base_url, api_key, model_id, _provider_id) =
        resolve_subagent_provider_config_for_call(parent_session_id, "general", None).await;
    (base_url, api_key, model_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn inherits_parent_session_provider_and_model() {
        let sid = "sess_subagent_inherit_test";
        with_store(|store| {
            store.sessions.insert(
                sid.to_string(),
                json!({
                    "id": sid,
                    "model": {
                        "providerID": "local-cli",
                        "id": "kiro/claude-sonnet-4.5"
                    }
                }),
            );
        });

        let (pid, mid) = resolve_parent_model_ref(sid);
        assert_eq!(pid, "local-cli");
        assert_eq!(mid, "kiro/claude-sonnet-4.5");

        let (url, key) = resolve_provider_endpoint_and_key(
            &json!({
                "provider": {
                    "kenari": {
                        "options": {
                            "baseURL": "https://kenari.id/v1",
                            "apiKey": "kn-test"
                        }
                    }
                }
            }),
            "kenari",
            "http://127.0.0.1:20288/v1",
        );
        assert_eq!(url, "https://kenari.id/v1");
        assert_eq!(key, "kn-test");
    }

    #[test]
    fn subagent_max_tokens_and_reasoning_respect_config_and_model_capabilities() {
        let cfg = json!({
            "agent": {
                "motion-designer": {
                    "max_tokens": 12288,
                    "reasoning": "low"
                },
                "qa-verifier": {
                    "maxTokens": 6144,
                    "reasoning": "none"
                }
            },
            "provider": {
                "local-cli": {
                    "models": {
                        "big-pickle": { "reasoning": false, "limit": { "output": 8192 } },
                        "gemini-2.5-flash": { "reasoning": true, "limit": { "output": 32768 } }
                    }
                },
                "custom-openai": {
                    "models": {
                        "plain-chat": { "reasoning": false },
                        "reasoner-pro": { "reasoning": true }
                    }
                }
            }
        });

        assert_eq!(resolve_subagent_max_tokens(&cfg, "motion-designer", "local-cli", "gemini-2.5-flash"), 12288);
        assert_eq!(resolve_subagent_max_tokens(&cfg, "qa-verifier", "local-cli", "gemini-2.5-flash"), 6144);
        assert_eq!(resolve_subagent_max_tokens(&cfg, "explore", "local-cli", "gemini-2.5-flash"), DEFAULT_SUBAGENT_MAX_TOKENS);

        // Unconfigured motion-designer uses measured 12288 on high-output models and clamps safely to model.limit.output.
        let bare_cfg = json!({
            "provider": cfg["provider"].clone()
        });
        assert_eq!(
            resolve_subagent_max_tokens(&bare_cfg, "motion-designer", "local-cli", "gemini-2.5-flash"),
            DEFAULT_MOTION_DESIGNER_MAX_TOKENS
        );
        assert_eq!(
            resolve_subagent_max_tokens(&bare_cfg, "motion-designer", "local-cli", "big-pickle"),
            8192
        );

        // Unconfigured role leaves global defaults completely untouched.
        assert_eq!(
            resolve_subagent_reasoning_effort(&cfg, "audio-director", "local-cli", "gemini-2.5-flash"),
            None
        );
        // Supported Gemini bridge model & custom reasoning model apply per-role setting.
        assert_eq!(
            resolve_subagent_reasoning_effort(&cfg, "motion-designer", "local-cli", "gemini-2.5-flash").as_deref(),
            Some("low")
        );
        assert_eq!(
            resolve_subagent_reasoning_effort(&cfg, "qa-verifier", "custom-openai", "reasoner-pro").as_deref(),
            Some("none")
        );
        // Unsupported model/provider ignores setting cleanly.
        assert_eq!(
            resolve_subagent_reasoning_effort(&cfg, "motion-designer", "custom-openai", "plain-chat"),
            None
        );
        assert_eq!(
            resolve_subagent_reasoning_effort(&cfg, "motion-designer", "local-cli", "kiro/auto"),
            None
        );
    }

    #[test]
    fn resolve_child_vision_capability_respects_override_and_parent() {
        let sid = "sess_subagent_vision_cap_test";
        with_store(|store| {
            store.sessions.insert(
                sid.to_string(),
                json!({
                    "id": sid,
                    "model": {
                        "providerID": "custom",
                        "id": "gpt-4o"
                    }
                }),
            );
        });
        let (_p1, m1, vis1) = resolve_child_vision_capability(sid, "motion-designer", None);
        assert_eq!(m1, "gpt-4o");
        assert!(vis1);

        let (_p2, m2, vis2) =
            resolve_child_vision_capability(sid, "motion-designer", Some("deepseek-chat"));
        assert_eq!(m2, "deepseek-chat");
        assert!(!vis2);

        with_store(|store| {
            store.sessions.remove(sid);
        });
    }
}

