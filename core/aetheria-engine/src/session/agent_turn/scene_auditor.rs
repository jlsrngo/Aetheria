//! Independent Visual & Motion Auditor for the Direct Per-Scene Remake Loop (Phase 4).
//!
//! Logically separates evaluation (Auditor) from authoring (Creator):
//! - Uses a dedicated read-only system prompt and rubric with ZERO Creator history and ZERO code-writing tools.
//! - Evaluates the rendered comparison strip (`REF | PREV | DIFF`) plus measured fidelity/motion metrics.
//! - Emits a structured `SceneAuditReport` (`sceneId`, `verdict`, `scores`, `findings[]`, `summary`),
//!   persists audit history to `script/<scene>.audit.json`, and formats concise targeted revision directives
//!   scoped strictly to high/medium findings so the Creator avoids unrelated regressions.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::resilience::send_resilient_chat_completion_with_tool_choice;

pub(crate) const INDEPENDENT_AUDITOR_SYSTEM_PROMPT: &str = "\
You are an independent Motion Graphics QA Auditor. You did NOT write the scene code and must NOT defend prior design choices.
You have NO code-editing tools. Your sole job is to inspect the attached `REF | PREV | DIFF` visual strip and measured numeric diagnostics, then return ONLY one valid JSON object matching this exact schema:
{
  \"sceneId\": \"string\",
  \"verdict\": \"pass\" | \"revise\" | \"critical\",
  \"scores\": {
    \"visualFidelity\": 0.0,
    \"motionFidelity\": 0.0,
    \"compositionTypography\": 0.0,
    \"productionQuality\": 0.0
  },
  \"findings\": [
    {
      \"timestampSec\": 1.25,
      \"category\": \"layout\" | \"typography\" | \"color\" | \"object_scale\" | \"motion_timing\" | \"motion_trajectory\" | \"asset_quality\" | \"runtime\",
      \"severity\": \"high\" | \"medium\" | \"low\",
      \"evidence\": \"Concrete visual or metric discrepancy observed between REF and PREV\",
      \"targetedFix\": \"Exact surgical adjustment limited to the affected layer/element; preserve working elements\"
    }
  ],
  \"summary\": \"One concise sentence summarizing the single highest-leverage improvement.\"
}
Rules:
1. Do NOT penalize intentional holds or hard cuts that match REF.
2. Cap findings to at most 4 highest-impact items sorted by severity (high -> medium -> low).
3. Ground every finding in concrete visual/metric evidence; never invent flaws if REF and PREV already match.
4. Return raw JSON only (no prose outside the JSON object).";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditRubricScores {
    #[serde(default)]
    pub visual_fidelity: f64,
    #[serde(default)]
    pub motion_fidelity: f64,
    #[serde(default)]
    pub composition_typography: f64,
    #[serde(default)]
    pub production_quality: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditFinding {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_sec: Option<f64>,
    pub category: String,
    pub severity: String,
    pub evidence: String,
    pub targeted_fix: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneAuditReport {
    pub scene_id: String,
    pub verdict: String,
    #[serde(default)]
    pub scores: AuditRubricScores,
    #[serde(default)]
    pub findings: Vec<AuditFinding>,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneAuditHistoryEntry {
    pub render_index: usize,
    pub numeric_score: f64,
    pub edge_score: f64,
    pub timestamp_ms: u64,
    pub report: SceneAuditReport,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneAuditHistoryFile {
    pub schema_version: u32,
    pub scene_id: String,
    pub audits: Vec<SceneAuditHistoryEntry>,
}

/// Selective gating so the independent auditor runs only when a scene genuinely benefits from
/// external critique (max 1 audit per scene, skipped when already clean or disabled).
#[allow(clippy::too_many_arguments)]
pub(crate) fn should_trigger_independent_auditor(
    enabled: bool,
    is_mock_model: bool,
    step_rendered: bool,
    audits_run: usize,
    renders_completed: usize,
    has_images: bool,
    latest_errs_empty: bool,
    latest_score: f64,
    latest_edge: f64,
    has_motion_warning: bool,
    has_struct_diag: bool,
) -> bool {
    if !enabled || is_mock_model || !step_rendered || audits_run >= 1 || !has_images {
        return false;
    }
    if renders_completed != 1 {
        return false;
    }
    if !latest_errs_empty {
        // Runtime JS errors already have exact stack traces; don't spend an auditor call before code runs.
        return false;
    }
    latest_score < 0.78 || latest_edge < 0.45 || has_motion_warning || has_struct_diag
}

fn strip_code_fences(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        let after_lang = rest
            .find('\n')
            .map(|idx| &rest[idx + 1..])
            .unwrap_or(rest);
        if let Some(end_idx) = after_lang.rfind("```") {
            return after_lang[..end_idx].trim();
        }
        return after_lang.trim();
    }
    trimmed
}

fn extract_json_object_slice(raw: &str) -> Option<&str> {
    let clean = strip_code_fences(raw);
    let start = clean.find('{')?;
    let end = clean.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&clean[start..=end])
}

fn normalize_severity(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "high" | "critical" | "blocker" => "high".to_string(),
        "medium" | "moderate" | "med" => "medium".to_string(),
        _ => "low".to_string(),
    }
}

fn normalize_category(raw: &str) -> String {
    let low = raw.trim().to_ascii_lowercase();
    match low.as_str() {
        "layout" | "typography" | "color" | "object_scale" | "motion_timing"
        | "motion_trajectory" | "asset_quality" | "runtime" => low,
        _ if low.contains("type") || low.contains("text") || low.contains("font") => {
            "typography".to_string()
        }
        _ if low.contains("color") || low.contains("contrast") => "color".to_string(),
        _ if low.contains("scale") || low.contains("size") => "object_scale".to_string(),
        _ if low.contains("time") || low.contains("pace") || low.contains("speed") => {
            "motion_timing".to_string()
        }
        _ if low.contains("traj") || low.contains("path") || low.contains("motion") => {
            "motion_trajectory".to_string()
        }
        _ if low.contains("asset") || low.contains("cutout") || low.contains("image") => {
            "asset_quality".to_string()
        }
        _ if low.contains("runtime") || low.contains("error") => "runtime".to_string(),
        _ => "layout".to_string(),
    }
}

fn severity_rank(sev: &str) -> u8 {
    match sev {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    }
}

/// Parses and normalizes an Auditor LLM text response into a validated `SceneAuditReport`.
pub(crate) fn parse_auditor_report(raw_text: &str, fallback_scene_id: &str) -> Result<SceneAuditReport, String> {
    let slice = extract_json_object_slice(raw_text)
        .ok_or_else(|| "Independent Auditor response did not contain a JSON object.".to_string())?;
    let val: Value = serde_json::from_str(slice)
        .map_err(|e| format!("Failed parsing Independent Auditor JSON: {}", e))?;

    let scene_id = val
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_scene_id)
        .to_string();

    let verdict_raw = val
        .get("verdict")
        .and_then(Value::as_str)
        .unwrap_or("revise")
        .trim()
        .to_ascii_lowercase();
    let verdict = match verdict_raw.as_str() {
        "pass" | "revise" | "critical" => verdict_raw,
        _ => "revise".to_string(),
    };

    let clamp01 = |v: f64| v.clamp(0.0, 1.0);
    let scores_v = val.get("scores");
    let scores = AuditRubricScores {
        visual_fidelity: clamp01(
            scores_v
                .and_then(|s| s.get("visualFidelity"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ),
        motion_fidelity: clamp01(
            scores_v
                .and_then(|s| s.get("motionFidelity"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ),
        composition_typography: clamp01(
            scores_v
                .and_then(|s| s.get("compositionTypography"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ),
        production_quality: clamp01(
            scores_v
                .and_then(|s| s.get("productionQuality"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ),
    };

    let mut findings: Vec<AuditFinding> = Vec::new();
    if let Some(arr) = val.get("findings").and_then(Value::as_array) {
        for item in arr.iter().take(6) {
            let evidence = item
                .get("evidence")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let targeted_fix = item
                .get("targetedFix")
                .or_else(|| item.get("recommendation"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if evidence.is_empty() && targeted_fix.is_empty() {
                continue;
            }
            findings.push(AuditFinding {
                timestamp_sec: item.get("timestampSec").and_then(Value::as_f64),
                category: normalize_category(
                    item.get("category").and_then(Value::as_str).unwrap_or("layout"),
                ),
                severity: normalize_severity(
                    item.get("severity").and_then(Value::as_str).unwrap_or("medium"),
                ),
                evidence,
                targeted_fix,
            });
        }
    }
    findings.sort_by_key(|f| severity_rank(&f.severity));
    findings.truncate(4);

    let summary = val
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    Ok(SceneAuditReport {
        scene_id,
        verdict,
        scores,
        findings,
        summary,
    })
}

/// Formats actionable (`high` / `medium`) independent audit findings as a concise targeted patch directive.
pub(crate) fn format_auditor_revision_brief(report: &SceneAuditReport) -> Option<String> {
    let actionable: Vec<&AuditFinding> = report
        .findings
        .iter()
        .filter(|f| f.severity == "high" || f.severity == "medium")
        .collect();
    if report.verdict == "pass" && actionable.is_empty() {
        return None;
    }
    if actionable.is_empty() && report.summary.is_empty() {
        return None;
    }

    let mut out = format!(
        "INDEPENDENT AUDITOR REPORT (verdict={}, visual={:.2}, motion={:.2}, comp={:.2}) — apply ONLY targeted fixes below and preserve working layers:\n",
        report.verdict,
        report.scores.visual_fidelity,
        report.scores.motion_fidelity,
        report.scores.composition_typography
    );
    for (idx, f) in actionable.iter().enumerate() {
        let ts_tag = f
            .timestamp_sec
            .map(|t| format!(" @ t={:.2}s", t))
            .unwrap_or_default();
        out.push_str(&format!(
            "{}. [{}|{}{}] Evidence: {} -> Fix: {}\n",
            idx + 1,
            f.severity.to_ascii_uppercase(),
            f.category,
            ts_tag,
            f.evidence,
            f.targeted_fix
        ));
    }
    if !report.summary.is_empty() {
        out.push_str(&format!("Priority summary: {}", report.summary));
    }
    Some(out.trim_end().to_string())
}

pub(crate) fn audit_history_path_for_script(script_path: &Path) -> PathBuf {
    script_path.with_extension("audit.json")
}

/// Persists an audit entry cleanly alongside `script/sceneK.js` -> `script/sceneK.audit.json`.
pub(crate) fn persist_scene_audit_record(
    script_path: &Path,
    render_index: usize,
    numeric_score: f64,
    edge_score: f64,
    report: &SceneAuditReport,
) -> Result<PathBuf, String> {
    let audit_path = audit_history_path_for_script(script_path);
    let mut history = std::fs::read_to_string(&audit_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SceneAuditHistoryFile>(&raw).ok())
        .unwrap_or_else(|| SceneAuditHistoryFile {
            schema_version: 1,
            scene_id: report.scene_id.clone(),
            audits: Vec::new(),
        });
    history.schema_version = 1;
    history.scene_id = report.scene_id.clone();
    history.audits.push(SceneAuditHistoryEntry {
        render_index,
        numeric_score: (numeric_score * 10_000.0).round() / 10_000.0,
        edge_score: (edge_score * 10_000.0).round() / 10_000.0,
        timestamp_ms: crate::paths::now_ms(),
        report: report.clone(),
    });
    let body = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed serializing audit history: {}", e))?;
    std::fs::write(&audit_path, body)
        .map_err(|e| format!("Failed writing '{}': {}", audit_path.display(), e))?;
    Ok(audit_path)
}

/// Executes an isolated, read-only Independent Auditor LLM vision call (zero code tools,
/// separate system prompt & history) on the rendered comparison strip and measured metrics.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_independent_scene_audit(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model_id: &str,
    scene_id: &str,
    scene_start: f64,
    scene_dur: f64,
    numeric_score: f64,
    edge_score: f64,
    diagnostics_text: &str,
    vision_images: &[String],
) -> Result<SceneAuditReport, String> {
    let mut eff_base = base_url.to_string();
    let mut eff_key = api_key.to_string();
    let mut eff_model = std::env::var("AETHERIA_AUDITOR_MODEL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| model_id.to_string());

    let mut content_parts: Vec<Value> = Vec::with_capacity(vision_images.len() + 1);
    for img_url in vision_images.iter().take(3) {
        content_parts.push(json!({
            "type": "image_url",
            "image_url": { "url": img_url }
        }));
    }
    let prompt_text = format!(
        "Audit scene `{}` (window {:.2}s..{:.2}s, duration {:.2}s).\nMeasured scores: overall={:.3}, edge={:.3}.\nMeasured diagnostics:\n{}\n\nInspect the attached REF | PREV | DIFF strip objectively and output ONLY the structured JSON audit report.",
        scene_id,
        scene_start,
        scene_start + scene_dur,
        scene_dur,
        numeric_score,
        edge_score,
        diagnostics_text.trim()
    );
    content_parts.push(json!({ "type": "text", "text": prompt_text }));

    let mut audit_msgs = vec![
        json!({ "role": "system", "content": INDEPENDENT_AUDITOR_SYSTEM_PROMPT }),
        json!({ "role": "user", "content": content_parts }),
    ];

    // CRITICAL: pass empty tools `&[]` so the Auditor is strictly read-only and cannot mutate code.
    let comp = send_resilient_chat_completion_with_tool_choice(
        client,
        &mut eff_base,
        &mut eff_key,
        &mut eff_model,
        &mut audit_msgs,
        &[],
        Some(0.15),
        1024,
        None,
        None,
    )
    .await?;

    parse_auditor_report(&comp.assistant_text, scene_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
    use std::sync::{Arc, Mutex};

    #[test]
    fn trigger_gate_fires_selectively_and_skips_clean_or_repeat_scenes() {
        assert!(should_trigger_independent_auditor(
            true, false, true, 0, 1, true, true, 0.66, 0.40, false, false
        ));
        // Clean scene skips auditor to avoid unnecessary latency
        assert!(!should_trigger_independent_auditor(
            true, false, true, 0, 1, true, true, 0.82, 0.56, false, false
        ));
        // Already audited once -> never repeats
        assert!(!should_trigger_independent_auditor(
            true, false, true, 1, 1, true, true, 0.60, 0.30, true, true
        ));
        // Disabled switch or runtime errors -> skipped
        assert!(!should_trigger_independent_auditor(
            false, false, true, 0, 1, true, true, 0.50, 0.25, true, true
        ));
        assert!(!should_trigger_independent_auditor(
            true, false, true, 0, 1, true, false, 0.50, 0.25, true, true
        ));
    }

    #[test]
    fn parses_fenced_json_and_formats_targeted_brief_filtering_low_severity() {
        let raw = r#"```json
{
  "sceneId": "scene2_brain",
  "verdict": "revise",
  "scores": {
    "visualFidelity": 0.72,
    "motionFidelity": 0.64,
    "compositionTypography": 0.81,
    "productionQuality": 0.78
  },
  "findings": [
    {
      "timestampSec": 0.45,
      "category": "typography",
      "severity": "low",
      "evidence": "Minor 2px kerning difference",
      "targetedFix": "Ignore unless layout shifts"
    },
    {
      "timestampSec": 1.80,
      "category": "object_scale",
      "severity": "high",
      "evidence": "Hero brain cutout is 22% smaller than REF",
      "targetedFix": "Increase drawTurntableObject width/height from 240 to 295"
    }
  ],
  "summary": "Scale up the rotating hero cutout to match REF."
}
```"#;
        let report = parse_auditor_report(raw, "fallback").expect("parse fenced json");
        assert_eq!(report.scene_id, "scene2_brain");
        assert_eq!(report.findings.len(), 2);
        // Sorted high before low
        assert_eq!(report.findings[0].severity, "high");

        let brief = format_auditor_revision_brief(&report).expect("targeted brief");
        assert!(brief.contains("INDEPENDENT AUDITOR REPORT"));
        assert!(brief.contains("[HIGH|object_scale @ t=1.80s]"));
        assert!(!brief.contains("Minor 2px kerning"), "low findings should not clutter targeted revision");

        // Malformed output fails cleanly without panicking
        assert!(parse_auditor_report("not json at all", "s1").is_err());
    }

    #[tokio::test]
    async fn live_wire_auditor_enforces_zero_tools_separate_prompt_and_persists_history() {
        let captured_payloads: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let cap_clone = Arc::clone(&captured_payloads);

        let app = Router::new()
            .route(
                "/chat/completions",
                post(
                    |State(store): State<Arc<Mutex<Vec<Value>>>>, Json(body): Json<Value>| async move {
                        store.lock().unwrap().push(body.clone());
                        let is_fail = body
                            .get("model")
                            .and_then(Value::as_str)
                            .is_some_and(|m| m == "fail-model");
                        if is_fail {
                            return (
                                StatusCode::OK,
                                Json(json!({
                                    "choices": [{ "message": { "role": "assistant", "content": "unparseable garbage" }, "finish_reason": "stop" }]
                                })),
                            );
                        }
                        let audit_json = json!({
                            "sceneId": "scene1_hook",
                            "verdict": "revise",
                            "scores": {
                                "visualFidelity": 0.71,
                                "motionFidelity": 0.62,
                                "compositionTypography": 0.80,
                                "productionQuality": 0.75
                            },
                            "findings": [{
                                "timestampSec": 0.9,
                                "category": "motion_timing",
                                "severity": "high",
                                "evidence": "Headline entrance finishes 0.4s late vs REF",
                                "targetedFix": "Shift headline tStart from 0.6 to 0.2"
                            }],
                            "summary": "Start headline reveal 0.4s earlier."
                        });
                        (
                            StatusCode::OK,
                            Json(json!({
                                "choices": [{
                                    "message": { "role": "assistant", "content": audit_json.to_string() },
                                    "finish_reason": "stop"
                                }]
                            })),
                        )
                    },
                ),
            )
            .with_state(cap_clone);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let srv = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let base_url = format!("http://127.0.0.1:{}", addr.port());
        let imgs = vec!["data:image/jpeg;base64,/9j/4AAQSkZJRg==".to_string()];

        let report = run_independent_scene_audit(
            &client,
            &base_url,
            "test-key",
            "auditor-test-model",
            "scene1_hook",
            0.0,
            2.5,
            0.68,
            0.41,
            "UNDERSIZED hero element",
            &imgs,
        )
        .await
        .expect("live wire auditor succeeds");

        assert_eq!(report.verdict, "revise");
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].category, "motion_timing");

        // Verify wire contract: NO tools sent, independent system prompt used, image attached
        {
            let reqs = captured_payloads.lock().unwrap();
            assert_eq!(reqs.len(), 1);
            assert!(
                reqs[0].get("tools").is_none()
                    || reqs[0].get("tools").and_then(Value::as_array).is_some_and(|a| a.is_empty()),
                "Auditor must never receive code-editing tools: {:?}",
                reqs[0].get("tools")
            );
            let sys = reqs[0].pointer("/messages/0/content").and_then(Value::as_str).unwrap_or("");
            assert!(sys.contains("independent Motion Graphics QA Auditor"));
            let user_parts = reqs[0].pointer("/messages/1/content").and_then(Value::as_array).unwrap();
            assert_eq!(user_parts[0]["type"], "image_url");
        }

        // Verify audit persistence to script/scene1.audit.json
        let tmp = std::env::temp_dir().join(format!("aetheria_audit_hist_{}", crate::paths::now_ms()));
        std::fs::create_dir_all(tmp.join("script")).unwrap();
        let script_path = tmp.join("script").join("scene1.js");
        let saved = persist_scene_audit_record(&script_path, 1, 0.68, 0.41, &report).unwrap();
        assert!(saved.is_file());
        let raw_hist = std::fs::read_to_string(&saved).unwrap();
        assert!(raw_hist.contains("motion_timing"));
        let _ = std::fs::remove_dir_all(&tmp);

        // Failure path: malformed auditor response returns Err cleanly
        let err = run_independent_scene_audit(
            &client,
            &base_url,
            "test-key",
            "fail-model",
            "scene1_hook",
            0.0,
            2.5,
            0.68,
            0.41,
            "diag",
            &imgs,
        )
        .await;
        assert!(err.is_err());

        srv.abort();
    }
}
