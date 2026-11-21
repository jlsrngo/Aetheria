//! Structured JSONL per-step & per-scene telemetry for the Direct Per-Scene Remake Loop (Phase X0).
//!
//! Writes strictly privacy-safe telemetry (no API keys, OAuth tokens, base64 image payloads, or full prompts)
//! into `<workspace>/.aetheria/trace/direct_remake_<sessionId>.jsonl`.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::direct_scene_switches::DirectSceneSwitches;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolCallTraceRecord {
    pub name: String,
    pub ok: bool,
    pub ms: u64,
    pub arg_bytes: usize,
    pub result_bytes: usize,
    pub image_count: usize,
    pub image_bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StepTraceRecord {
    #[serde(rename = "type")]
    pub record_type: &'static str,
    pub scene: usize,
    pub scene_id: String,
    pub step: usize,
    pub upstream_model: String,
    pub thinking_level: Option<String>,
    pub tool_calls: Vec<ToolCallTraceRecord>,
    pub blocked_by_gate: Vec<String>,
    pub assistant_text_chars: usize,
    pub finish_reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenderTraceRecord {
    pub step: usize,
    pub overall: f64,
    pub ssim: f64,
    pub color: f64,
    pub edge: f64,
    pub runtime_errors: usize,
    pub hazards: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneSummaryTraceRecord {
    #[serde(rename = "type")]
    pub record_type: &'static str,
    pub scene: usize,
    pub scene_id: String,
    pub steps_used: usize,
    pub first_write_step: Option<usize>,
    pub probe_calls_before_write: usize,
    pub tool_histogram: BTreeMap<String, usize>,
    pub renders: Vec<RenderTraceRecord>,
    pub restored_best: bool,
    pub final_score: f64,
    pub wall_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunHeaderTraceRecord<'a> {
    #[serde(rename = "type")]
    record_type: &'static str,
    session_id: &'a str,
    model_selected: String,
    upstream_model: String,
    thinking_level: Option<String>,
    system_prompt_bytes: usize,
    system_prompt_hash: String,
    started_at_ms: u64,
    switches: &'a DirectSceneSwitches,
}

/// Computes deterministic 16-hex FNV-1a 64-bit hash so prompts can be fingerprinted without storing full text.
pub(crate) fn short_hash_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in input.as_bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

/// Sanitizes an arbitrary identifier for safe filename construction (strictly inside `.aetheria/trace/`).
fn sanitize_file_component(raw: &str) -> String {
    let clean: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if clean.is_empty() {
        "session".to_string()
    } else {
        clean
    }
}

/// Redacts accidental key-like tokens just in case a test or caller passes a suspicious string.
fn redact_model_label(raw: &str) -> String {
    let tr = raw.trim();
    if tr.starts_with("sk-")
        || tr.starts_with("AIza")
        || tr.starts_with("Bearer ")
        || tr.contains("data:image")
    {
        return format!("redacted_{}", short_hash_hex(tr));
    }
    tr.chars().take(120).collect()
}

/// Resolves the actual upstream model & thinking level sent on the wire for this request.
/// Matches `bridge/routes.rs` & `bridge/antigravity.rs` mapping rules.
pub(crate) fn resolve_effective_model_and_thinking(
    base_url: &str,
    model_id: &str,
    reasoning_override: Option<&str>,
) -> (String, Option<String>) {
    let safe_model = redact_model_label(model_id);
    let url_l = base_url.to_ascii_lowercase();
    let is_local_bridge = url_l.contains("127.0.0.1") || url_l.contains("localhost");
    let routes_to_antigravity = !safe_model.starts_with("kiro/")
        && !safe_model.starts_with("opencode/")
        && safe_model != "big-pickle"
        && !safe_model.ends_with("-free")
        && (safe_model.starts_with("gemini-")
            || safe_model.ends_with("-agy")
            || safe_model.ends_with("-thinking")
            || safe_model.starts_with("gpt-oss-"))
        && (is_local_bridge
            || safe_model.starts_with("gemini-3.8-")
            || safe_model.ends_with("-agy")
            || safe_model.ends_with("-thinking"));

    if !routes_to_antigravity {
        let effort = reasoning_override
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase());
        return (safe_model, effort);
    }

    let (upstream, base_thinking) = crate::bridge::antigravity_auth::map_antigravity_model(&safe_model);
    let upstream_str = upstream.to_string();
    let is_pro = upstream_str.contains("pro");
    let override_norm = reasoning_override
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());

    let effective_thinking = if upstream_str.starts_with("gemini-3") {
        if let Some(ref eff) = override_norm {
            let mapped = match eff.as_str() {
                "none" => if is_pro { "low" } else { "minimal" },
                "minimal" => if is_pro { "low" } else { "minimal" },
                "low" => "low",
                "medium" => if is_pro { "high" } else { "medium" },
                "high" => "high",
                _ => base_thinking.unwrap_or("medium"),
            };
            Some(mapped.to_string())
        } else {
            base_thinking.map(str::to_string)
        }
    } else if upstream_str.contains("gemini-2.5") {
        override_norm.or_else(|| base_thinking.map(str::to_string))
    } else {
        base_thinking.map(str::to_string)
    };

    (upstream_str, effective_thinking)
}

pub(crate) struct DirectRemakeTracer {
    trace_path: Option<PathBuf>,
}

impl DirectRemakeTracer {
    pub(crate) fn new(
        ws_root: &Path,
        session_id: &str,
        base_url: &str,
        model_id: &str,
        switches: &DirectSceneSwitches,
        system_prompt: &str,
        started_at_ms: u64,
    ) -> Self {
        let safe_sid = sanitize_file_component(session_id);
        let candidate = ws_root
            .join(".aetheria")
            .join("trace")
            .join(format!("direct_remake_{}.jsonl", safe_sid));

        if !crate::paths::contains_path(ws_root, &candidate) {
            crate::paths::log_engine(
                "direct_remake_trace",
                "Skipped trace writer because resolved path fell outside workspace",
            );
            return Self { trace_path: None };
        }

        if let Some(parent) = candidate.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                crate::paths::log_engine(
                    "direct_remake_trace",
                    &format!("Failed creating trace dir {}: {}", parent.display(), e),
                );
                return Self { trace_path: None };
            }
        }

        let (upstream_model, thinking_level) = resolve_effective_model_and_thinking(
            base_url,
            model_id,
            switches.reasoning_effort.as_deref(),
        );
        let header = RunHeaderTraceRecord {
            record_type: "run_header",
            session_id: &safe_sid,
            model_selected: redact_model_label(model_id),
            upstream_model,
            thinking_level,
            system_prompt_bytes: system_prompt.len(),
            system_prompt_hash: short_hash_hex(system_prompt),
            started_at_ms,
            switches,
        };

        let mut tracer = Self {
            trace_path: Some(candidate),
        };
        // Overwrite existing trace file for the same session ID on header initialization.
        tracer.write_json_line(&header, true);
        tracer
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> Option<&Path> {
        self.trace_path.as_deref()
    }

    pub(crate) fn record_step(&mut self, rec: &StepTraceRecord) {
        self.write_json_line(rec, false);
    }

    pub(crate) fn record_scene_summary(&mut self, rec: &SceneSummaryTraceRecord) {
        self.write_json_line(rec, false);
    }

    fn write_json_line<T: Serialize>(&mut self, value: &T, truncate: bool) {
        let Some(ref path) = self.trace_path else {
            return;
        };
        let Ok(line) = serde_json::to_string(value) else {
            return;
        };
        let open_res = if truncate {
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(path)
        } else {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
        };
        match open_res {
            Ok(mut file) => {
                if let Err(e) = writeln!(file, "{}", line) {
                    crate::paths::log_engine(
                        "direct_remake_trace",
                        &format!("Trace write failed: {}", e),
                    );
                }
            }
            Err(e) => {
                crate::paths::log_engine(
                    "direct_remake_trace",
                    &format!("Trace open failed: {}", e),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_antigravity_upstream_model_and_thinking_with_override() {
        assert_eq!(
            resolve_effective_model_and_thinking(
                "http://127.0.0.1:20288/v1",
                "gemini-3.8-flash-medium",
                None
            ),
            ("gemini-3-flash".to_string(), Some("medium".to_string()))
        );
        assert_eq!(
            resolve_effective_model_and_thinking(
                "http://127.0.0.1:20288/v1",
                "gemini-3.8-flash-medium",
                Some("high")
            ),
            ("gemini-3-flash".to_string(), Some("high".to_string()))
        );
        assert_eq!(
            resolve_effective_model_and_thinking(
                "http://127.0.0.1:20288/v1",
                "gemini-3.8-pro-low",
                Some("minimal")
            ),
            ("gemini-3.1-pro-low".to_string(), Some("low".to_string()))
        );
        assert_eq!(
            resolve_effective_model_and_thinking(
                "http://127.0.0.1:54321/v1",
                "mock-smart-v",
                Some("high")
            ),
            ("mock-smart-v".to_string(), Some("high".to_string()))
        );
    }

    #[test]
    fn tracer_writes_valid_schema_jsonl_without_secrets_or_base64() {
        let root = std::env::temp_dir().join(format!(
            "aetheria_trace_unit_{}",
            crate::paths::now_ms()
        ));
        let _ = std::fs::create_dir_all(&root);

        let switches = DirectSceneSwitches::default();
        let fake_prompt = "SYSTEM PROMPT WITH Bearer secret-oauth-token AND sk-live-12345 AND data:image/jpeg;base64,AAAA";
        let mut tracer = DirectRemakeTracer::new(
            &root,
            "sess/with/../unsafe-chars",
            "http://127.0.0.1:20288/v1",
            "sk-secret-test-key",
            &switches,
            fake_prompt,
            123456789,
        );

        let trace_path = tracer.path().expect("trace path created").to_path_buf();
        assert!(crate::paths::contains_path(&root, &trace_path));

        tracer.record_step(&StepTraceRecord {
            record_type: "step",
            scene: 1,
            scene_id: "scene1_hook".to_string(),
            step: 1,
            upstream_model: "gemini-3-flash".to_string(),
            thinking_level: Some("high".to_string()),
            tool_calls: vec![ToolCallTraceRecord {
                name: "inspect_ref_frame".to_string(),
                ok: true,
                ms: 42,
                arg_bytes: 34,
                result_bytes: 120,
                image_count: 1,
                image_bytes: 8400,
                probe_tag: Some("t=0.50".to_string()),
            }],
            blocked_by_gate: vec![],
            assistant_text_chars: 18,
            finish_reason: "tool_calls".to_string(),
            input_tokens: Some(450),
            output_tokens: Some(90),
        });

        let mut hist = BTreeMap::new();
        hist.insert("inspect_ref_frame".to_string(), 1usize);
        hist.insert("write_scene_script".to_string(), 1usize);
        hist.insert("render_and_compare_scene".to_string(), 1usize);

        tracer.record_scene_summary(&SceneSummaryTraceRecord {
            record_type: "scene_summary",
            scene: 1,
            scene_id: "scene1_hook".to_string(),
            steps_used: 3,
            first_write_step: Some(2),
            probe_calls_before_write: 1,
            tool_histogram: hist,
            renders: vec![RenderTraceRecord {
                step: 3,
                overall: 0.78,
                ssim: 0.74,
                color: 0.85,
                edge: 0.75,
                runtime_errors: 0,
                hazards: 0,
            }],
            restored_best: false,
            final_score: 0.78,
            wall_ms: 950,
        });

        let content = std::fs::read_to_string(&trace_path).expect("trace file readable");
        for forbidden in ["data:image", "sk-secret", "sk-live", "Bearer ", "AIza"] {
            assert!(
                !content.contains(forbidden),
                "trace leaked forbidden pattern '{}': {}",
                forbidden,
                content
            );
        }

        let lines: Vec<serde_json::Value> = content
            .lines()
            .map(|l| serde_json::from_str(l).expect("valid json line"))
            .collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["type"], "run_header");
        assert_eq!(lines[0]["systemPromptBytes"], fake_prompt.len());
        assert_eq!(lines[1]["type"], "step");
        assert_eq!(lines[1]["toolCalls"][0]["imageBytes"], 8400);
        assert_eq!(lines[1]["inputTokens"], 450);
        assert_eq!(lines[2]["type"], "scene_summary");
        assert_eq!(lines[2]["firstWriteStep"], 2);
        assert_eq!(lines[2]["renders"][0]["overall"], 0.78);

        let _ = std::fs::remove_dir_all(&root);
    }
}
