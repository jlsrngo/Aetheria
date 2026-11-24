//! Direct Per-Scene Vision-First Reference Remake Compiler (Zero-Subagent Interactive Loop).
//!
//! Replaces multi-agent `Director -> Subagent motion-designer -> QA Verifier` bureaucracy
//! on multi-scene video reference remakes with a deterministic, single-model interactive loop
//! (up to 12 micro-tool steps per scene):
//!   For each Scene K = 1..N:
//!     1. Probing & Motion Planning: receives Scene K's 1/1 filmstrip sheets (or beat strip) +
//!        3 full-res keyframes + measured 30fps hard facts; optionally inspects crops/colors/assets
//!        and declares a validated `SceneMotionSpec` (`write_motion_spec`, toggleable via
//!        `AETHERIA_DIRECT_MOTION_SPEC=on|off`).
//!     2. Authoring (`write_scene_script` / `patch_scene_script`): runs instant static motion
//!        hazards + spec-to-code compliance checks before rendering.
//!     3. Visual & Temporal QA (`render_and_compare_scene`): captures headless CDP 6-beat
//!        comparison strips (`REF | PREV | DIFF`) + full-res worst frame + per-render 30fps
//!        optical-flow motion gate (`ref_motion_gate.py` with failure classification).
//!     4. Symmetric Checkpoint & Rollback Guard: preserves motion-clean checkpoints against
//!        visual regressions or newly introduced motion hazards (`is_better_checkpoint` /
//!        `should_restore_best_checkpoint`).

use base64::prelude::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::paths::now_ms;
use crate::session::message::emit_event;

use super::direct_scene_prompt::{
    detect_scene_motion_hazards, SceneMotionExpectations, DIRECT_SCENE_SYSTEM_PROMPT,
    DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL,
};
use super::direct_scene_switches::{
    extract_cross_scene_summary, CrossContextMode, DirectSceneSwitches, PromptMode,
};
use super::direct_scene_tools::{
    build_scene_tool_definitions_for_remake, execute_scene_micro_tool, RenderedMetrics,
    SceneToolContext,
};
use super::direct_scene_trace::{
    resolve_effective_model_and_thinking, DirectRemakeTracer, RenderTraceRecord,
    SceneSummaryTraceRecord, StepTraceRecord, ToolCallTraceRecord,
};
use super::resilience::send_resilient_chat_completion_with_tool_choice;
use crate::tool::json_repair::parse_or_repair_tool_args;

#[derive(Debug, Clone)]
pub(crate) struct DirectSceneOutcome {
    pub scene_id: String,
    pub script_rel: String,
    pub passes_run: usize,
    pub best_score: f64,
    pub rolled_back: bool,
    pub runtime_errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct DirectRemakeSummary {
    pub scenes: Vec<DirectSceneOutcome>,
    pub final_comparison: Option<Value>,
    pub wall_ms: u64,
}

/// Checks whether the active turn should run the zero-subagent Direct Per-Scene Remake Compiler.
/// Triggers automatically for multi-scene (`>= 2`) non-hybrid modular remakes when 1/1 filmstrips
/// exist (`filmstrip_index.json`), or explicitly via `AETHERIA_REMAKE_MODE=direct`; opt out via `standard`.
pub(crate) fn should_run_direct_scene_remake(workspace_dir: &str) -> bool {
    let mode_env = std::env::var("AETHERIA_REMAKE_MODE").ok();
    should_run_direct_scene_remake_with_mode(workspace_dir, mode_env.as_deref())
}

pub(crate) fn should_run_direct_scene_remake_with_mode(
    workspace_dir: &str,
    mode: Option<&str>,
) -> bool {
    let norm_mode = mode.map(|v| v.trim().to_ascii_lowercase()).unwrap_or_default();
    if matches!(norm_mode.as_str(), "standard" | "off" | "false" | "0" | "disabled") {
        return false;
    }
    let explicit_direct = norm_mode == "direct";
    let auto_mode = norm_mode.is_empty() || norm_mode == "auto";
    if !explicit_direct && !auto_mode {
        return false;
    }
    let ws = Path::new(workspace_dir);
    let style_path = ws.join("ref").join("extracted").join("style.json");
    if !style_path.is_file() {
        return false;
    }
    let Some(html_path) = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir))
    else {
        return false;
    };
    let Some(film_root) = html_path.parent() else {
        return false;
    };
    let film_json_path = film_root.join("film.json");
    if !film_json_path.is_file() {
        return false;
    }
    let Ok(raw_film) = std::fs::read_to_string(&film_json_path) else {
        return false;
    };
    let Ok(film_val) = serde_json::from_str::<Value>(&raw_film) else {
        return false;
    };
    if film_val
        .get("stageMode")
        .and_then(Value::as_str)
        .is_some_and(|s| s.eq_ignore_ascii_case("hybrid"))
    {
        return false;
    }
    let Some(scenes) = film_val.get("scenes").and_then(Value::as_array) else {
        return false;
    };
    if scenes.is_empty() {
        return false;
    }
    if !explicit_direct {
        let filmstrip_idx = ws.join("ref").join("extracted").join("filmstrip_index.json");
        if !filmstrip_idx.is_file() || scenes.len() < 2 {
            return false;
        }
    }
    // Only trigger when scene scripts are still scaffold stubs (not already authored),
    // OR when AETHERIA_REMAKE_ONLY_SCENES targets specific scenes for surgical re-authoring.
    if DirectSceneSwitches::from_env().only_scenes.is_some() {
        return true;
    }
    let mut stub_count = 0usize;
    for (idx, sc) in scenes.iter().enumerate() {
        let rel = sc
            .get("script")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("script/scene{}.js", idx + 1));
        let p = film_root.join(&rel);
        if !p.is_file() {
            stub_count += 1;
        } else if let Ok(txt) = std::fs::read_to_string(&p) {
            if crate::tool::film_state::is_scaffold_stub_content(&txt) {
                stub_count += 1;
            }
        }
    }
    stub_count * 2 >= scenes.len().max(1)
}

/// Automatically scaffolds a modular Canvas project from `ref/extracted/style.json` once
/// `filmstrip_index.json` (>= 2 scenes) exists on disk so multi-scene video remakes never get stuck
/// in repetitive exploratory probe loops before entering the parallel 1/1 per-scene compiler.
pub(crate) async fn maybe_auto_scaffold_for_direct_filmstrip_remake(
    session_id: &str,
    workspace_dir: &str,
    prompt_text: &str,
) -> bool {
    let mode_env = std::env::var("AETHERIA_REMAKE_MODE").ok();
    maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(
        session_id,
        workspace_dir,
        prompt_text,
        mode_env.as_deref(),
    )
    .await
}

pub(crate) async fn maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(
    session_id: &str,
    workspace_dir: &str,
    prompt_text: &str,
    mode: Option<&str>,
) -> bool {
    let norm_mode = mode.map(|v| v.trim().to_ascii_lowercase()).unwrap_or_default();
    if matches!(norm_mode.as_str(), "standard" | "off" | "false" | "0" | "disabled") {
        return false;
    }
    let explicit_direct = norm_mode == "direct";
    let auto_mode = norm_mode.is_empty() || norm_mode == "auto";
    if !explicit_direct && !auto_mode {
        return false;
    }
    if crate::studio::project_registry::is_hypothetical_or_planning_question(prompt_text) {
        return false;
    }
    let lower_prompt = prompt_text.to_ascii_lowercase();
    if lower_prompt.contains("hybrid")
        || lower_prompt.contains("css3d")
        || lower_prompt.contains("single html")
        || lower_prompt.contains("single-file")
    {
        return false;
    }

    let ws = PathBuf::from(workspace_dir);
    let style_path = ws.join("ref").join("extracted").join("style.json");
    let filmstrip_path = ws.join("ref").join("extracted").join("filmstrip_index.json");
    if !style_path.is_file() || !filmstrip_path.is_file() {
        return false;
    }
    if crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir)).is_some() {
        return false;
    }

    let Ok(raw_style) = tokio::fs::read_to_string(&style_path).await else {
        return false;
    };
    let Ok(style_val) = serde_json::from_str::<Value>(&raw_style) else {
        return false;
    };
    let Some(style_scenes) = style_val.get("scenes").and_then(Value::as_array) else {
        return false;
    };
    if style_scenes.len() < 2 {
        return false;
    }

    let mut width = style_val
        .get("width")
        .and_then(Value::as_u64)
        .unwrap_or(1080) as u32;
    let mut height = style_val
        .get("height")
        .and_then(Value::as_u64)
        .unwrap_or(1920) as u32;
    if width.max(height) < 640 && width >= 16 && height >= 16 {
        width *= 2;
        height *= 2;
    }
    let fps = style_val
        .get("fps")
        .and_then(Value::as_u64)
        .unwrap_or(30)
        .max(1) as u32;
    let background = style_val
        .pointer("/palette/primary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("#0f1115")
        .to_string();

    let scaffold_scenes: Vec<Value> = style_scenes
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let sid = s
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("scene{}", i + 1));
            let dur = s
                .get("duration")
                .and_then(Value::as_f64)
                .filter(|d| d.is_finite() && *d > 0.05)
                .unwrap_or(2.0);
            let mut row = json!({ "id": sid, "duration": dur });
            if let Some(tp) = s.get("transitionFromPrev").and_then(Value::as_str) {
                row["transitionFromPrev"] = Value::String(tp.to_string());
            }
            if let Some(tb) = s.get("transitionBridge") {
                if !tb.is_null() {
                    row["transitionBridge"] = tb.clone();
                }
            }
            if let Some(ct) = s.get("cameraTrack") {
                if !ct.is_null() {
                    row["cameraTrack"] = ct.clone();
                }
            }
            row
        })
        .collect();
    let title = style_val
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Reference Remake")
        .to_string();
    let args = json!({
        "title": title,
        "width": width,
        "height": height,
        "fps": fps,
        "background": background,
        "scenes": scaffold_scenes,
    });
    let sid_owned = session_id.to_string();
    let ws_owned = workspace_dir.to_string();
    let scene_len = style_scenes.len();
    let res = tokio::task::spawn_blocking(move || {
        crate::tool::film_scaffold::execute_film_scaffold(&sid_owned, &ws_owned, &args)
    })
    .await
    .ok();
    let ok = res
        .as_ref()
        .and_then(|v| v.get("ok").and_then(Value::as_bool))
        .unwrap_or(false);
    if ok {
        crate::paths::log_engine(
            "direct_remake",
            &format!(
                "Auto-scaffolded {} modular scenes ({}x{} @ {}fps) from ref/extracted/style.json + filmstrip_index.json",
                scene_len, width, height, fps
            ),
        );
    }
    ok
}

/// Extracts clean JavaScript source from a markdown-fenced or raw LLM response.
pub(crate) fn extract_js_code_block(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut best: Option<String> = None;
    let mut cursor = trimmed;
    while let Some(start_idx) = cursor.find("```") {
        let after_ticks = &cursor[start_idx + 3..];
        let Some(nl_idx) = after_ticks.find('\n') else {
            break;
        };
        let body = &after_ticks[nl_idx + 1..];
        let end_idx = body.find("```").unwrap_or(body.len());
        let candidate = body[..end_idx].trim();
        if !candidate.is_empty()
            && (candidate.contains("registerScene") || best.is_none())
            && best.as_ref().map(|b| candidate.len() > b.len()).unwrap_or(true)
        {
            best = Some(candidate.to_string());
        }
        if end_idx >= body.len() {
            break;
        }
        cursor = &body[end_idx + 3..];
    }
    if let Some(code) = best {
        return Some(format!("{}\n", code));
    }
    if trimmed.contains("registerScene") {
        return Some(format!("{}\n", trimmed));
    }
    None
}

fn encode_jpeg_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!(
        "data:image/jpeg;base64,{}",
        BASE64_STANDARD.encode(&bytes)
    ))
}

fn build_vision_user_message(text: String, image_data_urls: &[String]) -> Value {
    let mut parts = Vec::with_capacity(image_data_urls.len() + 1);
    for url in image_data_urls {
        parts.push(json!({
            "type": "image_url",
            "image_url": { "url": url }
        }));
    }
    parts.push(json!({ "type": "text", "text": text }));
    json!({
        "role": "user",
        "content": parts
    })
}

/// Collects the 6-panel storyboard strip plus 3 full-resolution keyframes spanning early -> mid -> late.
/// Short scenes without `_q1`/`_q3` automatically fall back to `_start`/`_end` so every scene gets 4 views.
fn collect_scene_pass1_images(ws_root: &Path, scene_num: usize) -> Vec<String> {
    let frames_dir = ws_root.join("ref").join("extracted").join("frames");
    let early = {
        let q1 = frames_dir.join(format!("ref_scene_{scene_num:02}_q1.jpg"));
        if q1.is_file() {
            q1
        } else {
            frames_dir.join(format!("ref_scene_{scene_num:02}_start.jpg"))
        }
    };
    let late = {
        let q3 = frames_dir.join(format!("ref_scene_{scene_num:02}_q3.jpg"));
        if q3.is_file() {
            q3
        } else {
            frames_dir.join(format!("ref_scene_{scene_num:02}_end.jpg"))
        }
    };
    let candidates = [
        frames_dir.join(format!("ref_scene_{scene_num:02}_beats.jpg")),
        early,
        frames_dir.join(format!("ref_scene_{scene_num:02}.jpg")),
        late,
    ];
    candidates
        .iter()
        .filter_map(|p| encode_jpeg_data_url(p))
        .collect()
}

/// Selects up to `max_sheets` Pass 1 sheets chronologically, always keeping start/end and
/// prioritizing sheets covering the highest-delta `activeBursts` before filling largest gaps.
pub(crate) fn select_pass1_filmstrip_sheets<'a>(
    matching: &[&'a Value],
    active_bursts: &[(f64, f64, f64)],
    max_sheets: usize,
) -> Vec<&'a Value> {
    if max_sheets == 0 {
        return Vec::new();
    }
    if matching.len() <= max_sheets {
        return matching.to_vec();
    }
    let n = matching.len();
    let mut chosen = std::collections::BTreeSet::new();
    chosen.insert(0);
    if max_sheets > 1 {
        chosen.insert(n - 1);
    }

    let mut sorted_bursts = active_bursts.to_vec();
    sorted_bursts.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    for (bt0, bt1, _) in sorted_bursts {
        if chosen.len() >= max_sheets {
            break;
        }
        let best_idx = (0..n)
            .filter(|idx| !chosen.contains(idx))
            .filter(|&idx| {
                let s0 = matching[idx].get("tStart").and_then(Value::as_f64).unwrap_or(0.0);
                let s1 = matching[idx].get("tEnd").and_then(Value::as_f64).unwrap_or(s0);
                s1 >= bt0 && s0 <= bt1
            })
            .max_by(|&a, &b| {
                let da = matching[a]
                    .get("maxDelta")
                    .or_else(|| matching[a].get("meanDelta"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let db = matching[b]
                    .get("maxDelta")
                    .or_else(|| matching[b].get("meanDelta"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });
        if let Some(idx) = best_idx {
            chosen.insert(idx);
        }
    }

    while chosen.len() < max_sheets {
        let vec_chosen: Vec<usize> = chosen.iter().copied().collect();
        let mut best_mid = None;
        let mut best_gap = 1usize;
        for win in vec_chosen.windows(2) {
            let gap = win[1] - win[0];
            if gap > best_gap {
                best_gap = gap;
                best_mid = Some((win[0] + win[1]) / 2);
            }
        }
        match best_mid {
            Some(mid) if !chosen.contains(&mid) => {
                chosen.insert(mid);
            }
            _ => break,
        }
    }

    chosen.into_iter().map(|i| matching[i]).collect()
}

/// Loads up to 6 key 1/1 filmstrip sheets spanning `scene_num` (burst-prioritized from start to end,
/// plus settled scene hero JPEGs) when `AETHERIA_DIRECT_FILMSTRIP=1` is active;
/// falls back cleanly to `collect_scene_pass1_images`.
fn collect_scene_filmstrip_pass1_images(ws_root: &Path, scene_num: usize) -> Vec<String> {
    let extracted_dir = ws_root.join("ref").join("extracted");
    let idx_path = extracted_dir.join("filmstrip_index.json");
    let Ok(raw) = std::fs::read_to_string(&idx_path) else {
        return collect_scene_pass1_images(ws_root, scene_num);
    };
    let Ok(idx_val) = serde_json::from_str::<Value>(&raw) else {
        return collect_scene_pass1_images(ws_root, scene_num);
    };
    let all_sheets = idx_val
        .get("sheets")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let scene_obj = idx_val
        .get("scenes")
        .and_then(Value::as_array)
        .and_then(|arr| {
            arr.iter()
                .find(|s| s.get("index").and_then(Value::as_u64) == Some(scene_num as u64))
        });
    let wanted: std::collections::HashSet<u64> = scene_obj
        .and_then(|sc| sc.get("sheetIndices"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default();
    let active_bursts: Vec<(f64, f64, f64)> = scene_obj
        .and_then(|sc| sc.get("activeBursts"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|b| {
                    Some((
                        b.get("tStart")?.as_f64()?,
                        b.get("tEnd")?.as_f64()?,
                        b.get("peakDelta").and_then(Value::as_f64).unwrap_or(0.0),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    let matching: Vec<&Value> = if !wanted.is_empty() {
        all_sheets
            .iter()
            .filter(|sh| {
                sh.get("sheetIndex")
                    .and_then(Value::as_u64)
                    .is_some_and(|si| wanted.contains(&si))
            })
            .collect()
    } else {
        crate::tool::ref_filmstrip::select_filmstrip_sheets(
            &idx_val,
            &json!({ "sceneIndex": scene_num, "maxSheets": 10 }),
        )
        .0
    };
    if matching.is_empty() {
        return collect_scene_pass1_images(ws_root, scene_num);
    }

    let picked = select_pass1_filmstrip_sheets(&matching, &active_bursts, 6);

    let mut urls = Vec::with_capacity(picked.len() + 3);
    for sh in picked {
        let rel_raw = sh.get("relPath").and_then(Value::as_str).unwrap_or("");
        let rel_vis = sh.get("visionRelPath").and_then(Value::as_str).unwrap_or("");
        let raw_p = extracted_dir.join(rel_raw);
        let vis_p = extracted_dir.join(rel_vis);
        // Prefer full-tile `relPath` (240x426 / 384x216 tiles, ~48 KB) over downscaled `visionRelPath`
        // so micro-typography and shapes on the 1/1 filmstrip stay sharp!
        let chosen = if !rel_raw.is_empty()
            && crate::paths::contains_path(&extracted_dir, &raw_p)
            && raw_p.is_file()
        {
            Some(raw_p)
        } else if !rel_vis.is_empty()
            && crate::paths::contains_path(&extracted_dir, &vis_p)
            && vis_p.is_file()
        {
            Some(vis_p)
        } else {
            None
        };
        if let Some(p) = chosen {
            if let Some(url) = encode_jpeg_data_url(&p) {
                urls.push(url);
            }
        }
    }
    // Always attach all 3 full-resolution keyframes (early, mid, late) alongside the filmstrip sheets
    // so every sub-beat has 1:1 full-resolution visual clarity!
    let frames_dir = extracted_dir.join("frames");
    let early_p = {
        let q1 = frames_dir.join(format!("ref_scene_{scene_num:02}_q1.jpg"));
        if q1.is_file() {
            q1
        } else {
            frames_dir.join(format!("ref_scene_{scene_num:02}_start.jpg"))
        }
    };
    let mid_p = frames_dir.join(format!("ref_scene_{scene_num:02}.jpg"));
    let late_p = {
        let q3 = frames_dir.join(format!("ref_scene_{scene_num:02}_q3.jpg"));
        if q3.is_file() {
            q3
        } else {
            frames_dir.join(format!("ref_scene_{scene_num:02}_end.jpg"))
        }
    };
    let mut seen_kf = std::collections::HashSet::new();
    for kf_p in [early_p, mid_p, late_p] {
        if seen_kf.insert(kf_p.clone()) {
            if let Some(kf_url) = encode_jpeg_data_url(&kf_p) {
                urls.push(kf_url);
            }
        }
    }
    if urls.is_empty() {
        collect_scene_pass1_images(ws_root, scene_num)
    } else {
        urls
    }
}

/// Computes settled isolated-preview timestamp bounds `(safe_lo, safe_hi)` excluding incoming
/// and outgoing `push_*` / `zoom_blur` transition bridge overlaps so per-scene isolated renders
/// (`window.__isolateSceneTransition = true`) never compare against an adjacent scene's sliding elements.
pub(crate) fn compute_isolated_scene_time_bounds(
    scene_start: f64,
    scene_dur: f64,
    film_duration: f64,
    style_sc: Option<&Value>,
    film_sc: &Value,
    next_style_sc: Option<&Value>,
) -> (f64, f64) {
    let scene_end = (scene_start + scene_dur).min((film_duration - 0.03).max(0.0));
    let mut safe_lo = scene_start + 0.02;
    let mut safe_hi = (scene_end - 0.03).max(safe_lo);

    if let Some(in_tb) = style_sc
        .and_then(|s| s.get("transitionBridge"))
        .or_else(|| film_sc.get("transitionBridge"))
    {
        let kind = in_tb.get("kind").and_then(Value::as_str).unwrap_or("");
        if (kind.starts_with("push_") || kind == "zoom_blur")
            && in_tb.get("tEnd").and_then(Value::as_f64).is_some()
        {
            let t_end = in_tb.get("tEnd").and_then(Value::as_f64).unwrap_or(scene_start);
            let max_lo = scene_start + scene_dur * 0.42;
            safe_lo = safe_lo.max((t_end + 0.04).min(max_lo));
        }
    }

    if let Some(out_tb) = next_style_sc.and_then(|s| s.get("transitionBridge")) {
        let kind = out_tb.get("kind").and_then(Value::as_str).unwrap_or("");
        if (kind.starts_with("push_") || kind == "zoom_blur")
            && out_tb.get("tStart").and_then(Value::as_f64).is_some()
        {
            let t_start = out_tb.get("tStart").and_then(Value::as_f64).unwrap_or(scene_end);
            let min_hi = scene_start + scene_dur * 0.58;
            safe_hi = safe_hi.min((t_start - 0.04).max(min_hi));
        }
    }

    if safe_hi < safe_lo {
        safe_hi = safe_lo;
    }
    (
        ((safe_lo * 1000.0).round()) / 1000.0,
        ((safe_hi * 1000.0).round()) / 1000.0,
    )
}

fn collect_scene_keyframe_timestamps(
    ws_root: &Path,
    film_root: &Path,
    film_duration: f64,
    scene_num: usize,
    _scene_start: f64,
    _scene_dur: f64,
    safe_lo: f64,
    safe_hi: f64,
) -> Vec<f64> {
    let all_kfs = crate::studio::reference_compare::discover_reference_keyframes_for_film(
        ws_root,
        film_root,
        film_duration,
    );
    let prefix = format!("ref_scene_{scene_num:02}");
    let mut ts: Vec<f64> = all_kfs
        .iter()
        .filter(|k| {
            let rel = k.rel_path.to_ascii_lowercase();
            let sid = k.scene_id.as_deref().unwrap_or("").to_ascii_lowercase();
            rel.contains(&prefix)
                || sid.starts_with(&format!("scene{scene_num}_"))
                || sid == format!("scene{scene_num}")
        })
        .map(|k| k.timestamp.clamp(safe_lo, safe_hi))
        .collect();
    ts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    ts.dedup_by(|a, b| (*a - *b).abs() < 0.04);
    if ts.len() >= 2 {
        return ts.into_iter().take(6).collect();
    }
    let span = (safe_hi - safe_lo).max(0.05);
    vec![
        (safe_lo + span * 0.12).min(film_duration - 0.05),
        (safe_lo + span * 0.30).min(film_duration - 0.05),
        (safe_lo + span * 0.50).min(film_duration - 0.05),
        (safe_lo + span * 0.72).min(film_duration - 0.05),
        (safe_lo + span * 0.90).min(film_duration - 0.05),
    ]
}

/// Pure checkpoint comparison helper shared across step renders and post-loop dirty verification.
pub(crate) fn is_better_checkpoint(
    best_score: f64,
    best_errs: &[String],
    best_hazards: usize,
    cand_score: f64,
    cand_errs: &[String],
    cand_hazards: usize,
) -> bool {
    best_score < 0.0
        || (!best_errs.is_empty() && cand_errs.is_empty())
        || (best_errs.is_empty()
            && cand_errs.is_empty()
            && ((cand_hazards <= best_hazards && cand_score >= best_score - 0.002)
                || (cand_hazards < best_hazards && cand_score >= best_score - 0.12)
                || (cand_hazards > best_hazards && cand_score >= best_score + 0.12)))
}

/// Pure end-of-scene safety-restore predicate (baseline rule P4).
/// Protects clean animated scripts (`final_hazards < best_hazards`, e.g. fixed 3D turntable / blur reveal)
/// from being rolled back to an older static/hazardous checkpoint unless pixel score severely collapsed,
/// and restores a motion-clean best checkpoint if the final render introduced a motion hazard/deficit
/// without a major visual score rescue (`+0.12`).
pub(crate) fn should_restore_best_checkpoint(
    best_score: f64,
    best_code: &str,
    best_errs: &[String],
    best_hazards: usize,
    latest_score: f64,
    latest_errs: &[String],
    final_hazards: usize,
) -> bool {
    best_score >= 0.0
        && !best_code.is_empty()
        && !crate::tool::film_state::is_scaffold_stub_content(best_code)
        && ((best_errs.is_empty() && !latest_errs.is_empty())
            || (final_hazards > best_hazards && latest_score < best_score + 0.12)
            || (final_hazards == best_hazards && latest_score + 0.008 < best_score)
            || (final_hazards < best_hazards && latest_score + 0.14 < best_score))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn should_early_exit_scene(
    active_filmstrip: bool,
    is_mock_model: bool,
    step_rendered: bool,
    latest_errs: &[String],
    active_hazards: &[String],
    has_motion_warning: bool,
    has_structural_diagnosis: bool,
    renders_completed: usize,
    latest_score: f64,
    latest_edge: f64,
    latest_min_frame_score: f64,
) -> bool {
    active_filmstrip
        && !is_mock_model
        && step_rendered
        && latest_errs.is_empty()
        && active_hazards.is_empty()
        && !has_motion_warning
        && !has_structural_diagnosis
        && latest_edge >= 0.42
        && latest_min_frame_score >= 0.66
        && ((renders_completed >= 2 && latest_score >= 0.80)
            || (renders_completed >= 1 && latest_score >= 0.87))
}

/// Safe plateau early-stop: once a scene already holds a clean (`best_hazards == 0`) checkpoint
/// with solid fidelity (`best_score >= 0.70`) and a subsequent clean render passes motion QA
/// without improving over `best_score + 0.004`, stop burning tail steps that only roll back.
#[allow(clippy::too_many_arguments)]
pub(crate) fn should_early_exit_on_plateau(
    active_filmstrip: bool,
    is_mock_model: bool,
    step_rendered: bool,
    latest_errs: &[String],
    active_hazards: &[String],
    has_motion_warning: bool,
    renders_completed: usize,
    best_hazards: usize,
    best_score: f64,
    latest_score: f64,
    latest_edge: f64,
    renders_without_gain: usize,
) -> bool {
    active_filmstrip
        && !is_mock_model
        && step_rendered
        && latest_errs.is_empty()
        && active_hazards.is_empty()
        && !has_motion_warning
        && best_hazards == 0
        && renders_completed >= 2
        && best_score >= 0.70
        && latest_edge >= 0.40
        && renders_without_gain >= 1
        && latest_score <= best_score + 0.004
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PostWriteToolPhase {
    AllTools,
    FixRuntimeErrorsNow,
    ApplyPolishOrFinish,
    VerifyDirtyScriptNow,
}

fn select_post_write_tool_phase(
    has_written: bool,
    dirty_since_render: bool,
    has_runtime_errors: bool,
    probes_since_edit: usize,
) -> PostWriteToolPhase {
    if !has_written {
        return PostWriteToolPhase::AllTools;
    }
    if dirty_since_render && probes_since_edit >= 1 {
        return PostWriteToolPhase::VerifyDirtyScriptNow;
    }
    if !dirty_since_render && has_runtime_errors && probes_since_edit >= 1 {
        return PostWriteToolPhase::FixRuntimeErrorsNow;
    }
    if !dirty_since_render && !has_runtime_errors && probes_since_edit >= 1 {
        return PostWriteToolPhase::ApplyPolishOrFinish;
    }
    PostWriteToolPhase::AllTools
}

/// Runs the Zero-Subagent Direct Per-Scene Vision-First Remake Compiler end-to-end.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_direct_per_scene_remake(
    session_id: &str,
    workspace_dir: &str,
    user_brief: &str,
    client: &reqwest::Client,
    base_url: &mut String,
    api_key: &mut String,
    model_id: &mut String,
    content_parts: &mut Vec<Value>,
) -> Result<DirectRemakeSummary, String> {
    let switches = DirectSceneSwitches::from_env();
    run_direct_per_scene_remake_with_switches(
        session_id,
        workspace_dir,
        user_brief,
        client,
        base_url,
        api_key,
        model_id,
        content_parts,
        switches,
    )
    .await
}

struct DirectSceneRunCtx {
    session_id: String,
    workspace_dir: String,
    user_brief: String,
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model_id: String,
    ws_root: PathBuf,
    film_root: PathBuf,
    switches: DirectSceneSwitches,
    active_filmstrip: bool,
    system_prompt: &'static str,
    temperature: Option<f64>,
    max_tokens: u64,
    width: u32,
    height: u32,
    fps: u32,
    bpm: f64,
    total_dur: f64,
    total_scenes: usize,
    scene_tools: Vec<Value>,
    write_only_tools: Vec<Value>,
    patch_or_write_tools: Vec<Value>,
    render_only_tools: Vec<Value>,
    render_lock: Arc<tokio::sync::Mutex<()>>,
    tracer: Arc<tokio::sync::Mutex<DirectRemakeTracer>>,
    completed_scenes: Arc<tokio::sync::Mutex<Vec<(usize, String, String)>>>,
}

async fn run_single_direct_scene(
    shared: Arc<DirectSceneRunCtx>,
    idx: usize,
    film_sc: Value,
    style_sc_owned: Option<Value>,
    next_style_sc_owned: Option<Value>,
) -> (DirectSceneOutcome, SceneSummaryTraceRecord) {
    let scene_num = idx + 1;
    let scene_started = now_ms();
    let max_scene_steps = shared.switches.max_steps;
    let total_scenes = shared.total_scenes;
    let mut scene_base_url = shared.base_url.clone();
    let mut scene_api_key = shared.api_key.clone();
    let mut scene_model_id = shared.model_id.clone();

    let scene_id = film_sc
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("scene")
        .to_string();
    let script_rel = film_sc
        .get("script")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("script/scene{}.js", scene_num));
    let script_path = shared.film_root.join(&script_rel);
    let sc_start = film_sc.get("start").and_then(Value::as_f64).unwrap_or(0.0);
    let sc_dur = film_sc.get("duration").and_then(Value::as_f64).unwrap_or(2.0);
    let style_sc = style_sc_owned.as_ref();
    let next_style_sc = next_style_sc_owned.as_ref();

    emit_event(
        &shared.workspace_dir,
        "session.tool.called",
        json!({
            "sessionID": shared.session_id,
            "tool": "direct_scene_remake",
            "label": format!("Direct Vision-First Scene {}/{}: {}", scene_num, total_scenes, scene_id),
            "timestamp": now_ms()
        }),
    );

    let pass1_images = if shared.active_filmstrip {
        collect_scene_filmstrip_pass1_images(&shared.ws_root, scene_num)
    } else {
        collect_scene_pass1_images(&shared.ws_root, scene_num)
    };
    let mut hard_facts = super::direct_scene_prompt::build_scene_hard_facts_prompt_with_next(
        style_sc,
        next_style_sc,
        &film_sc,
        scene_num,
        total_scenes,
        shared.width,
        shared.height,
        shared.fps,
        shared.bpm,
        &shared.user_brief,
    );
    if matches!(shared.switches.cross_context, CrossContextMode::Summary) {
        let completed_snapshot = {
            let guard = shared.completed_scenes.lock().await;
            guard.clone()
        };
        if let Some(summary_block) = extract_cross_scene_summary(&completed_snapshot) {
            hard_facts.push_str("\n\n");
            hard_facts.push_str(&summary_block);
        }
    }
    let (safe_iso_lo, safe_iso_hi) = compute_isolated_scene_time_bounds(
        sc_start,
        sc_dur,
        shared.total_dur,
        style_sc,
        &film_sc,
        next_style_sc,
    );
    let scene_ts = collect_scene_keyframe_timestamps(
        &shared.ws_root,
        &shared.film_root,
        shared.total_dur,
        scene_num,
        sc_start,
        sc_dur,
        safe_iso_lo,
        safe_iso_hi,
    );

    let mut best_code = std::fs::read_to_string(&script_path).unwrap_or_default();
    let mut best_score = -1.0f64;
    let mut best_errs: Vec<String> = Vec::new();
    let mut best_hazards = usize::MAX;
    let mut latest_score = 0.0f64;
    let mut latest_edge = 0.0f64;
    let mut latest_min_frame_score = 0.0f64;
    let mut latest_has_struct_diag = false;
    let mut latest_motion_flow_deficit = false;
    let mut latest_errs: Vec<String> = Vec::new();
    let mut has_written = false;
    let mut dirty_since_render = false;
    let mut probes_since_edit: usize = 0;
    let mut renders_completed: usize = 0;
    let mut rolled_back = false;
    let mut passes_run = 0usize;
    let mut first_write_step: Option<usize> = None;
    let mut probe_calls_before_write: usize = 0;
    let mut tool_histogram: BTreeMap<String, usize> = BTreeMap::new();
    let mut render_records: Vec<RenderTraceRecord> = Vec::new();

    let motion_expectations = SceneMotionExpectations::from_style_scene(style_sc);
    let secondary_motion: Vec<Value> = style_sc
        .and_then(|sc| {
            sc.pointer("/motionClues/secondaryMotion")
                .or_else(|| sc.pointer("/layout/motionClues/secondaryMotion"))
                .and_then(Value::as_array)
        })
        .cloned()
        .unwrap_or_default();
    let mut motion_deficit_rounds: usize = 0;
    let mut audits_run: usize = 0;
    let mut renders_without_gain: usize = 0;
    let tool_ctx = SceneToolContext {
        session_id: &shared.session_id,
        workspace_dir: &shared.workspace_dir,
        ws_root: &shared.ws_root,
        film_root: &shared.film_root,
        script_path: &script_path,
        script_rel: &script_rel,
        scene_id: &scene_id,
        scene_num,
        scene_start: sc_start,
        scene_dur: sc_dur,
        film_duration: shared.total_dur,
        width: shared.width,
        height: shared.height,
        fps: shared.fps,
        default_scene_ts: &scene_ts,
        safe_iso_lo,
        safe_iso_hi,
        use_filmstrip: shared.active_filmstrip,
        motion_expectations,
        secondary_motion: &secondary_motion,
    };

    let mut scene_msgs = vec![
        json!({ "role": "system", "content": shared.system_prompt }),
        build_vision_user_message(hard_facts, &pass1_images),
    ];

    let force_write_choice = json!({
        "type": "function",
        "function": { "name": "write_scene_script" }
    });
    let force_render_choice = json!({
        "type": "function",
        "function": { "name": "render_and_compare_scene" }
    });
    for step_idx in 0..max_scene_steps {
        let enforce_write_now = shared.switches.should_enforce_write_gate(
            has_written,
            step_idx,
            !shared.write_only_tools.is_empty(),
        );
        let post_phase = if enforce_write_now {
            PostWriteToolPhase::AllTools
        } else if shared.active_filmstrip
            && has_written
            && !dirty_since_render
            && renders_completed >= 1
            && step_idx + 2 >= max_scene_steps
        {
            PostWriteToolPhase::ApplyPolishOrFinish
        } else if step_idx + 2 >= max_scene_steps && has_written && dirty_since_render {
            PostWriteToolPhase::VerifyDirtyScriptNow
        } else if step_idx + 1 == max_scene_steps && has_written && !dirty_since_render {
            PostWriteToolPhase::ApplyPolishOrFinish
        } else {
            select_post_write_tool_phase(
                has_written,
                dirty_since_render,
                !latest_errs.is_empty(),
                probes_since_edit,
            )
        };
        let active_tools: &[Value] = if enforce_write_now {
            &shared.write_only_tools
        } else {
            match post_phase {
                PostWriteToolPhase::FixRuntimeErrorsNow
                | PostWriteToolPhase::ApplyPolishOrFinish
                    if !shared.patch_or_write_tools.is_empty() =>
                {
                    &shared.patch_or_write_tools
                }
                PostWriteToolPhase::VerifyDirtyScriptNow
                    if !shared.render_only_tools.is_empty() =>
                {
                    &shared.render_only_tools
                }
                _ => &shared.scene_tools,
            }
        };
        let active_tool_choice = if enforce_write_now {
            Some(&force_write_choice)
        } else if post_phase == PostWriteToolPhase::VerifyDirtyScriptNow
            && !shared.render_only_tools.is_empty()
        {
            Some(&force_render_choice)
        } else {
            None
        };
        let comp = match send_resilient_chat_completion_with_tool_choice(
            &shared.client,
            &mut scene_base_url,
            &mut scene_api_key,
            &mut scene_model_id,
            &mut scene_msgs,
            active_tools,
            shared.temperature,
            shared.max_tokens,
            shared.switches.reasoning_effort.as_deref(),
            active_tool_choice,
        )
        .await
        {
            Ok(c) => c,
            Err(err) => {
                crate::paths::log_engine(
                    "direct_remake",
                    &format!(
                        "⚠️ Scene {}/{} ({}) step {} LLM error: {}",
                        scene_num, total_scenes, scene_id, step_idx + 1, err
                    ),
                );
                break;
            }
        };
        passes_run += 1;
        let (step_upstream_model, step_thinking_level) = resolve_effective_model_and_thinking(
            &scene_base_url,
            &scene_model_id,
            shared.switches.reasoning_effort.as_deref(),
        );

        if !comp.tool_calls.is_empty() {
            scene_msgs.push(json!({
                "role": "assistant",
                "content": if comp.assistant_text.trim().is_empty() { Value::Null } else { json!(comp.assistant_text) },
                "tool_calls": comp.tool_calls,
            }));

            let mut step_images: Vec<String> = Vec::new();
            let mut step_captions: Vec<String> = Vec::new();
            let mut step_tool_records: Vec<ToolCallTraceRecord> = Vec::new();
            let mut step_blocked_by_gate: Vec<String> = Vec::new();
            let mut step_modified = false;
            let mut step_rendered = false;
            let mut step_probed = false;

            for (tc_idx, tc) in comp.tool_calls.iter().enumerate() {
                let tool_started = now_ms();
                let cid = tc
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("sc{}_{}_{}", scene_num, step_idx, tc_idx));
                let fn_name = tc
                    .pointer("/function/name")
                    .or_else(|| tc.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let raw_args = tc
                    .pointer("/function/arguments")
                    .or_else(|| tc.get("arguments"))
                    .and_then(Value::as_str)
                    .unwrap_or("{}");
                *tool_histogram.entry(fn_name.to_string()).or_insert(0) += 1;

                let (parsed_args, arg_err) = match parse_or_repair_tool_args(raw_args) {
                    Ok(v) => (v, None),
                    Err(e) => (json!({}), Some(e)),
                };

                let mut blocked_this_call = false;
                let outcome = if let Some(err) = arg_err {
                    super::direct_scene_tools::SceneToolOutcome {
                        result_json: json!({ "ok": false, "error": format!("Malformed JSON tool args: {}", err) }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                } else if enforce_write_now
                    && !matches!(
                        fn_name,
                        "write_scene_script"
                            | "write"
                            | "write_to_file"
                            | "patch_scene_script"
                            | "edit"
                            | "replace_file_content"
                    )
                {
                    blocked_this_call = true;
                    step_blocked_by_gate.push(fn_name.to_string());
                    crate::paths::log_engine(
                        "direct_remake",
                        &format!(
                            "🚧 Scene {}/{} ({}) step {} blocked probe tool='{}' while write_scene_script is required",
                            scene_num, total_scenes, scene_id, step_idx + 1, fn_name
                        ),
                    );
                    super::direct_scene_tools::SceneToolOutcome {
                        result_json: json!({
                            "ok": false,
                            "error": shared.switches.build_gate_block_error(fn_name, &script_rel)
                        }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                } else if post_phase == PostWriteToolPhase::VerifyDirtyScriptNow
                    && fn_name != "render_and_compare_scene"
                {
                    blocked_this_call = true;
                    step_blocked_by_gate.push(fn_name.to_string());
                    super::direct_scene_tools::SceneToolOutcome {
                        result_json: json!({
                            "ok": false,
                            "error": format!("You modified `{}` — call `render_and_compare_scene` NOW to inspect your pixels before further probing.", script_rel)
                        }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                } else if matches!(
                    post_phase,
                    PostWriteToolPhase::FixRuntimeErrorsNow
                        | PostWriteToolPhase::ApplyPolishOrFinish
                ) && !matches!(
                    fn_name,
                    "write_scene_script"
                        | "write"
                        | "write_to_file"
                        | "patch_scene_script"
                        | "edit"
                        | "replace_file_content"
                ) {
                    blocked_this_call = true;
                    step_blocked_by_gate.push(fn_name.to_string());
                    let msg = if post_phase == PostWriteToolPhase::FixRuntimeErrorsNow {
                        format!("Runtime JS errors are active — fix `{}` NOW with `patch_scene_script` or `write_scene_script` before probing further.", script_rel)
                    } else {
                        format!("Post-render probing limit reached — call `patch_scene_script` or `write_scene_script` on `{}` to apply fixes, or reply briefly in text if done.", script_rel)
                    };
                    super::direct_scene_tools::SceneToolOutcome {
                        result_json: json!({ "ok": false, "error": msg }),
                        vision_images: Vec::new(),
                        vision_caption: None,
                        script_modified: false,
                        rendered_score: None,
                        rendered_metrics: None,
                        rendered_errors: None,
                    }
                } else {
                    emit_event(
                        &shared.workspace_dir,
                        "session.tool.called",
                        json!({
                            "sessionID": shared.session_id,
                            "tool": fn_name,
                            "label": format!("Scene {}/{}: {}", scene_num, total_scenes, fn_name),
                            "timestamp": now_ms()
                        }),
                    );
                    let out = if fn_name == "render_and_compare_scene" {
                        let _render_guard = shared.render_lock.lock().await;
                        execute_scene_micro_tool(&tool_ctx, fn_name, &parsed_args).await
                    } else {
                        execute_scene_micro_tool(&tool_ctx, fn_name, &parsed_args).await
                    };
                    let tool_ok = out.result_json.get("ok").and_then(Value::as_bool) != Some(false)
                        && out.result_json.get("error").is_none();
                    let err_preview = out
                        .result_json
                        .get("error")
                        .and_then(Value::as_str)
                        .map(|s| format!(" err={}", s.chars().take(120).collect::<String>()))
                        .unwrap_or_default();
                    crate::paths::log_engine(
                        "direct_remake",
                        &format!(
                            "🔧 Scene {}/{} ({}) step {} tool='{}' ok={} modified={}{}",
                            scene_num,
                            total_scenes,
                            scene_id,
                            step_idx + 1,
                            fn_name,
                            tool_ok,
                            out.script_modified,
                            err_preview
                        ),
                    );
                    out
                };

                let call_ok = outcome.result_json.get("ok").and_then(Value::as_bool) != Some(false)
                    && outcome.result_json.get("error").is_none();
                let img_count = outcome.vision_images.len();
                let img_bytes: usize = outcome.vision_images.iter().map(|s| s.len()).sum();

                if outcome.script_modified {
                    if !has_written && first_write_step.is_none() {
                        first_write_step = Some(step_idx + 1);
                    }
                    has_written = true;
                    dirty_since_render = true;
                    step_modified = true;
                } else if !blocked_this_call && outcome.rendered_score.is_none() {
                    let is_failed_asset_fetch = fn_name == "fetch_web_image" && !call_ok;
                    if !is_failed_asset_fetch {
                        step_probed = true;
                    }
                    if !has_written {
                        probe_calls_before_write += 1;
                    }
                }
                if let Some(sc_val) = outcome.rendered_score {
                    dirty_since_render = false;
                    step_rendered = true;
                    renders_completed += 1;
                    let errs = outcome.rendered_errors.clone().unwrap_or_default();
                    latest_score = sc_val;
                    latest_errs = errs.clone();
                    let cur_code = tokio::fs::read_to_string(&script_path)
                        .await
                        .unwrap_or_default();
                    let metrics = outcome.rendered_metrics.unwrap_or(RenderedMetrics {
                        overall: sc_val,
                        ssim: 0.0,
                        color: 0.0,
                        edge: 0.0,
                        min_frame_score: sc_val,
                        has_structural_diagnosis: false,
                        motion_flow_deficit: false,
                    });
                    if metrics.motion_flow_deficit {
                        motion_deficit_rounds += 1;
                    }
                    latest_motion_flow_deficit = metrics.motion_flow_deficit;
                    let cur_haz = detect_scene_motion_hazards(&cur_code, motion_expectations).len()
                        + super::motion_spec::load_and_check_motion_spec_compliance(&script_path, &cur_code).len()
                        + usize::from(metrics.motion_flow_deficit);
                    latest_edge = metrics.edge;
                    latest_min_frame_score = metrics.min_frame_score;
                    latest_has_struct_diag = metrics.has_structural_diagnosis;
                    render_records.push(RenderTraceRecord {
                        step: step_idx + 1,
                        overall: metrics.overall,
                        ssim: metrics.ssim,
                        color: metrics.color,
                        edge: metrics.edge,
                        runtime_errors: errs.len(),
                        hazards: cur_haz,
                    });
                    let prev_best_score = best_score;
                    let prev_best_hazards = best_hazards;
                    if is_better_checkpoint(
                        best_score,
                        &best_errs,
                        best_hazards,
                        sc_val,
                        &errs,
                        cur_haz,
                    ) {
                        let meaningful_gain = prev_best_score < 0.0
                            || cur_haz < prev_best_hazards
                            || sc_val > prev_best_score + 0.004;
                        if meaningful_gain {
                            renders_without_gain = 0;
                        } else {
                            renders_without_gain += 1;
                        }
                        best_code = cur_code;
                        best_score = sc_val;
                        best_errs = errs;
                        best_hazards = cur_haz;
                    } else {
                        renders_without_gain += 1;
                    }
                    crate::paths::log_engine(
                        "direct_remake",
                        &format!(
                            "Scene {}/{} ({}) step {} render -> score={:.3} (best={:.3}), errs={}",
                            scene_num,
                            total_scenes,
                            scene_id,
                            step_idx + 1,
                            sc_val,
                            best_score.max(0.0),
                            latest_errs.len()
                        ),
                    );
                }

                fn push_diag_tags(out: &mut Vec<String>, text: &str) {
                    for tag in [
                        "UNDERSIZED",
                        "OVERSIZED",
                        "MISALIGNED",
                        "COLOR DRIFT",
                        "HOTSPOT MISMATCH",
                        "MOTION FROZEN WARNING",
                        "MOTION STIFFNESS WARNING",
                        "MOTION JUMP / TELEPORT WARNING",
                        "MOTION WINDOW FREEZE",
                        "MOTION DIRECTION/PAN MISMATCH",
                        "MOTION ACTIVITY WARNING",
                        "PRE-CUT FREEZE WARNING",
                        "MOTION FLOW DEFICIT WARNING",
                        "MOTION VELOCITY SNAP WARNING",
                        "SPEC COMPLIANCE HAZARD",
                    ] {
                        if text.contains(tag) && !out.iter().any(|x| x == tag) {
                            out.push(tag.to_string());
                        }
                    }
                }
                let mut diag_summary: Vec<String> = Vec::new();
                if let Some(d_str) = outcome.result_json.get("diagnostics").and_then(Value::as_str) {
                    push_diag_tags(&mut diag_summary, d_str);
                }
                if outcome
                    .result_json
                    .get("assetHint")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())
                {
                    diag_summary.push("assetHint".to_string());
                }
                if let Some(ref cap) = outcome.vision_caption {
                    push_diag_tags(&mut diag_summary, cap);
                }

                step_images.extend(outcome.vision_images);
                if let Some(cap) = outcome.vision_caption {
                    step_captions.push(cap);
                }

                let model_text =
                    crate::tool::truncator::format_tool_result_for_model(fn_name, &outcome.result_json);
                let direction = crate::tool::truncator::preferred_direction_for_tool(fn_name);
                let (bounded_text, _, _) = crate::tool::truncator::bound_tool_output_with_spill(
                    fn_name,
                    &model_text,
                    Some(&shared.workspace_dir),
                    Some(&cid),
                    direction,
                );
                let probe_tag = if fn_name == "inspect_ref_frame" {
                    parsed_args
                        .get("timestampSec")
                        .and_then(Value::as_f64)
                        .map(|t| format!("t={:.3}", t))
                } else if matches!(fn_name, "bash" | "shell" | "terminal") {
                    let cmd = parsed_args.get("command").and_then(Value::as_str).unwrap_or("");
                    if cmd.contains("cv2") || cmd.contains("VideoCapture") {
                        Some("cv2".to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };
                step_tool_records.push(ToolCallTraceRecord {
                    name: fn_name.to_string(),
                    ok: call_ok,
                    ms: now_ms().saturating_sub(tool_started),
                    arg_bytes: raw_args.len(),
                    result_bytes: bounded_text.len(),
                    image_count: img_count,
                    image_bytes: img_bytes,
                    probe_tag,
                    diag_summary,
                });
                scene_msgs.push(json!({
                    "role": "tool",
                    "tool_call_id": cid,
                    "name": fn_name,
                    "content": bounded_text,
                }));
            }

            {
                let mut tr = shared.tracer.lock().await;
                tr.record_step(&StepTraceRecord {
                    record_type: "step",
                    scene: scene_num,
                    scene_id: scene_id.clone(),
                    step: step_idx + 1,
                    upstream_model: step_upstream_model,
                    thinking_level: step_thinking_level,
                    tool_calls: step_tool_records,
                    blocked_by_gate: step_blocked_by_gate,
                    assistant_text_chars: comp.assistant_text.len(),
                    finish_reason: comp.finish_reason.clone(),
                    input_tokens: comp.input_tokens,
                    output_tokens: comp.output_tokens,
                });
            }

            if step_modified || step_rendered {
                probes_since_edit = 0;
            } else if has_written && step_probed {
                probes_since_edit += 1;
            }

            let cur_code_after_step = if step_modified || step_rendered {
                tokio::fs::read_to_string(&script_path)
                    .await
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let mut active_hazards = if !cur_code_after_step.is_empty() {
                detect_scene_motion_hazards(&cur_code_after_step, motion_expectations)
            } else {
                Vec::new()
            };
            if !cur_code_after_step.is_empty() {
                active_hazards.extend(super::motion_spec::load_and_check_motion_spec_compliance(
                    &script_path,
                    &cur_code_after_step,
                ));
            }
            let has_motion_warning = step_captions
                .iter()
                .any(|c| {
                    c.contains("MOTION FROZEN WARNING")
                        || c.contains("MOTION STIFFNESS WARNING")
                        || c.contains("MOTION JUMP / TELEPORT WARNING")
                        || c.contains("MOTION ACTIVITY WARNING")
                        || c.contains("MOTION WINDOW FREEZE")
                        || c.contains("MOTION DIRECTION/PAN MISMATCH")
                        || c.contains("PRE-CUT FREEZE WARNING")
                        || ((c.contains("MOTION FLOW DEFICIT WARNING")
                            || c.contains("MOTION VELOCITY SNAP WARNING"))
                            && motion_deficit_rounds <= 1)
                });

            // Fast early-exit for live filmstrip remakes once visual score, edge overlap, worst-frame
            // floor, and zero structural diagnosis are all clean AND zero runtime errors/hazards remain.
            if should_early_exit_scene(
                shared.active_filmstrip,
                scene_model_id.starts_with("mock-"),
                step_rendered,
                &latest_errs,
                &active_hazards,
                has_motion_warning,
                latest_has_struct_diag,
                renders_completed,
                latest_score,
                latest_edge,
                latest_min_frame_score,
            ) || should_early_exit_on_plateau(
                shared.active_filmstrip,
                scene_model_id.starts_with("mock-"),
                step_rendered,
                &latest_errs,
                &active_hazards,
                has_motion_warning,
                renders_completed,
                best_hazards,
                best_score,
                latest_score,
                latest_edge,
                renders_without_gain,
            ) {
                break;
            }

            let mut nudge_opt = shared.switches.build_probe_budget_nudge(
                has_written,
                step_idx,
                scene_num,
                total_scenes,
                &script_rel,
            );
            if nudge_opt.is_none() && has_written && step_idx + 1 < max_scene_steps {
                let next_post_phase = if shared.active_filmstrip
                    && !dirty_since_render
                    && renders_completed >= 1
                    && step_idx + 3 >= max_scene_steps
                {
                    PostWriteToolPhase::ApplyPolishOrFinish
                } else {
                    select_post_write_tool_phase(
                        has_written,
                        dirty_since_render,
                        !latest_errs.is_empty(),
                        probes_since_edit,
                    )
                };
                nudge_opt = if step_rendered && !latest_errs.is_empty() {
                    Some("RUNTIME JS ERRORS DETECTED — fix them immediately with `patch_scene_script` (or `write_scene_script`), then re-verify with `render_and_compare_scene`.".to_string())
                } else if step_rendered && !active_hazards.is_empty() {
                    Some(format!(
                        "CRITICAL MOTION / CODE BUGS DETECTED IN `{}` (MUST FIX NOW VIA `patch_scene_script`):\n- {}",
                        script_rel,
                        active_hazards.join("\n- ")
                    ))
                } else if step_rendered
                    && latest_errs.is_empty()
                    && !latest_has_struct_diag
                    && latest_score >= 0.78
                    && latest_edge >= 0.35
                    && latest_min_frame_score >= 0.62
                    && renders_completed >= 2
                {
                    Some("Score is >= 0.78 with strong edge/worst-frame alignment and 0 runtime errors. Reply briefly in text to finalize this scene and move on, unless a glaring visual/motion defect remains.".to_string())
                } else {
                    match next_post_phase {
                        PostWriteToolPhase::VerifyDirtyScriptNow => Some(
                            "Script was modified — call `render_and_compare_scene` NOW to visually inspect your rendered pixels against Row 1.".to_string(),
                        ),
                        PostWriteToolPhase::FixRuntimeErrorsNow => Some(
                            "Probe complete — call `patch_scene_script` or `write_scene_script` NOW to fix the runtime JS errors, then re-verify with `render_and_compare_scene`.".to_string(),
                        ),
                        PostWriteToolPhase::ApplyPolishOrFinish => Some(
                            "Probing window complete after render. Apply your fixes NOW via `patch_scene_script` (or `write_scene_script`), or reply briefly in text if this scene is already complete.".to_string(),
                        ),
                        PostWriteToolPhase::AllTools => None,
                    }
                };
            }

            if !step_images.is_empty() {
                let mut caption = if step_captions.is_empty() {
                    "Visual tool output attached above. Inspect closely and patch surgically if anything mismatches.".to_string()
                } else {
                    step_captions.join("\n")
                };
                if super::scene_auditor::should_trigger_independent_auditor(
                    shared.switches.independent_auditor,
                    scene_model_id.starts_with("mock-"),
                    step_rendered,
                    audits_run,
                    renders_completed,
                    !step_images.is_empty(),
                    latest_errs.is_empty(),
                    latest_score,
                    latest_edge,
                    has_motion_warning,
                    latest_has_struct_diag,
                ) {
                    audits_run += 1;
                    match super::scene_auditor::run_independent_scene_audit(
                        &shared.client,
                        &scene_base_url,
                        &scene_api_key,
                        &scene_model_id,
                        &scene_id,
                        sc_start,
                        sc_dur,
                        latest_score,
                        latest_edge,
                        &caption,
                        &step_images,
                    )
                    .await
                    {
                        Ok(report) => {
                            let _ = super::scene_auditor::persist_scene_audit_record(
                                &script_path,
                                renders_completed,
                                latest_score,
                                latest_edge,
                                &report,
                            );
                            if let Some(brief) =
                                super::scene_auditor::format_auditor_revision_brief(&report)
                            {
                                caption.push_str("\n\n");
                                caption.push_str(&brief);
                            }
                            crate::paths::log_engine(
                                "direct_remake",
                                &format!(
                                    "Scene {}/{} ({}) independent audit -> verdict={} findings={}",
                                    scene_num,
                                    total_scenes,
                                    scene_id,
                                    report.verdict,
                                    report.findings.len()
                                ),
                            );
                        }
                        Err(err) => {
                            crate::paths::log_engine(
                                "direct_remake",
                                &format!(
                                    "⚠️ Scene {}/{} ({}) independent audit skipped: {}",
                                    scene_num, total_scenes, scene_id, err
                                ),
                            );
                        }
                    }
                }
                if let Some(nudge) = nudge_opt {
                    caption.push_str("\n\n");
                    caption.push_str(&nudge);
                }
                scene_msgs.push(build_vision_user_message(caption, &step_images));
            } else if let Some(nudge) = nudge_opt {
                scene_msgs.push(json!({
                    "role": "user",
                    "content": nudge
                }));
            }
            continue;
        }

        {
            let mut tr = shared.tracer.lock().await;
            tr.record_step(&StepTraceRecord {
                record_type: "step",
                scene: scene_num,
                scene_id: scene_id.clone(),
                step: step_idx + 1,
                upstream_model: step_upstream_model,
                thinking_level: step_thinking_level,
                tool_calls: Vec::new(),
                blocked_by_gate: Vec::new(),
                assistant_text_chars: comp.assistant_text.len(),
                finish_reason: comp.finish_reason.clone(),
                input_tokens: comp.input_tokens,
                output_tokens: comp.output_tokens,
            });
        }

        // Graceful fallback for models that return a raw ```javascript``` block without tool calls
        if let Some(code_block) = extract_js_code_block(&comp.assistant_text) {
            let _ = tokio::fs::write(&script_path, &code_block).await;
            if !has_written && first_write_step.is_none() {
                first_write_step = Some(step_idx + 1);
            }
            has_written = true;
            dirty_since_render = false;
            scene_msgs.push(json!({ "role": "assistant", "content": comp.assistant_text }));

            let render_out = {
                let _render_guard = shared.render_lock.lock().await;
                execute_scene_micro_tool(&tool_ctx, "render_and_compare_scene", &json!({})).await
            };
            let sc_val = render_out.rendered_score.unwrap_or(0.0);
            let errs = render_out.rendered_errors.unwrap_or_default();
            latest_score = sc_val;
            latest_errs = errs.clone();
            let metrics = render_out.rendered_metrics.unwrap_or(RenderedMetrics {
                overall: sc_val,
                ssim: 0.0,
                color: 0.0,
                edge: 0.0,
                min_frame_score: sc_val,
                has_structural_diagnosis: false,
                motion_flow_deficit: false,
            });
            if metrics.motion_flow_deficit {
                motion_deficit_rounds += 1;
            }
            latest_motion_flow_deficit = metrics.motion_flow_deficit;
            let cur_haz = detect_scene_motion_hazards(&code_block, motion_expectations).len()
                + usize::from(metrics.motion_flow_deficit);
            latest_edge = metrics.edge;
            latest_min_frame_score = metrics.min_frame_score;
            latest_has_struct_diag = metrics.has_structural_diagnosis;
            render_records.push(RenderTraceRecord {
                step: step_idx + 1,
                overall: metrics.overall,
                ssim: metrics.ssim,
                color: metrics.color,
                edge: metrics.edge,
                runtime_errors: errs.len(),
                hazards: cur_haz,
            });
            if is_better_checkpoint(
                best_score,
                &best_errs,
                best_hazards,
                sc_val,
                &errs,
                cur_haz,
            ) {
                best_code = code_block;
                best_score = sc_val;
                best_errs = errs;
                best_hazards = cur_haz;
            }
            if latest_errs.is_empty()
                && !latest_has_struct_diag
                && latest_score >= 0.86
                && latest_edge >= 0.35
                && latest_min_frame_score >= 0.62
                && cur_haz == 0
            {
                break;
            }
            if step_idx + 1 < max_scene_steps {
                let diag = render_out
                    .result_json
                    .get("diagnostics")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let follow_txt = format!(
                    "Auto-rendered your script for Scene {}/{} (overall={:.3}, errors={}).\n{}\nInspect the comparison strip above; use `patch_scene_script` (or `inspect_ref_frame` / `sample_ref_region`) to fix any remaining mismatch, then call `render_and_compare_scene`, or reply briefly if done.",
                    scene_num, total_scenes, latest_score, latest_errs.len(), diag
                );
                scene_msgs.push(build_vision_user_message(follow_txt, &render_out.vision_images));
                continue;
            }
            break;
        }

        if has_written {
            break;
        }
        if step_idx + 1 < max_scene_steps {
            scene_msgs.push(json!({ "role": "assistant", "content": comp.assistant_text }));
            scene_msgs.push(json!({
                "role": "user",
                "content": format!("Please call `write_scene_script` now to author `{}` and verify it with `render_and_compare_scene`.", script_rel)
            }));
            continue;
        }
        break;
    }

    // If the model edited the script on its last step without rendering, run one final verification capture
    if has_written && dirty_since_render {
        let final_out = {
            let _render_guard = shared.render_lock.lock().await;
            execute_scene_micro_tool(&tool_ctx, "render_and_compare_scene", &json!({})).await
        };
        latest_score = final_out.rendered_score.unwrap_or(0.0);
        latest_errs = final_out.rendered_errors.unwrap_or_default();
        let final_dirty_code = tokio::fs::read_to_string(&script_path)
            .await
            .unwrap_or_default();
        let metrics = final_out.rendered_metrics.unwrap_or(RenderedMetrics {
            overall: latest_score,
            ssim: 0.0,
            color: 0.0,
            edge: 0.0,
            min_frame_score: latest_score,
            has_structural_diagnosis: false,
            motion_flow_deficit: false,
        });
        latest_motion_flow_deficit = metrics.motion_flow_deficit;
        let final_dirty_haz = detect_scene_motion_hazards(&final_dirty_code, motion_expectations).len()
            + usize::from(metrics.motion_flow_deficit);
        latest_edge = metrics.edge;
        latest_min_frame_score = metrics.min_frame_score;
        render_records.push(RenderTraceRecord {
            step: passes_run,
            overall: metrics.overall,
            ssim: metrics.ssim,
            color: metrics.color,
            edge: metrics.edge,
            runtime_errors: latest_errs.len(),
            hazards: final_dirty_haz,
        });
        if is_better_checkpoint(
            best_score,
            &best_errs,
            best_hazards,
            latest_score,
            &latest_errs,
            final_dirty_haz,
        ) {
            best_code = final_dirty_code;
            best_score = latest_score;
            best_errs = latest_errs.clone();
            best_hazards = final_dirty_haz;
        }
        let _ = (latest_edge, latest_min_frame_score);
    }

    let final_code_now = tokio::fs::read_to_string(&script_path)
        .await
        .unwrap_or_default();
    let final_haz = detect_scene_motion_hazards(&final_code_now, motion_expectations).len()
        + super::motion_spec::load_and_check_motion_spec_compliance(&script_path, &final_code_now)
            .len()
        + usize::from(latest_motion_flow_deficit);
    let should_restore_best = shared.switches.restore_best
        && should_restore_best_checkpoint(
            best_score,
            &best_code,
            &best_errs,
            best_hazards,
            latest_score,
            &latest_errs,
            final_haz,
        );
    let (final_score, final_errs, persisted_code) = if should_restore_best {
        let _ = tokio::fs::write(&script_path, &best_code).await;
        rolled_back = true;
        crate::paths::log_engine(
            "direct_remake",
            &format!(
                "Scene {}/{} ({}) end-of-scene safety restore ({:.3} -> best {:.3})",
                scene_num, total_scenes, scene_id, latest_score, best_score
            ),
        );
        (best_score, best_errs, best_code)
    } else if has_written {
        (latest_score.max(0.0), latest_errs, final_code_now)
    } else {
        (best_score.max(0.0), best_errs, final_code_now)
    };

    {
        let mut done = shared.completed_scenes.lock().await;
        done.push((scene_num, scene_id.clone(), persisted_code));
        done.sort_by_key(|entry| entry.0);
    }
    let summary_rec = SceneSummaryTraceRecord {
        record_type: "scene_summary",
        scene: scene_num,
        scene_id: scene_id.clone(),
        steps_used: passes_run,
        first_write_step,
        probe_calls_before_write,
        tool_histogram,
        renders: render_records,
        restored_best: rolled_back,
        final_score,
        wall_ms: now_ms().saturating_sub(scene_started),
    };

    (
        DirectSceneOutcome {
            scene_id,
            script_rel,
            passes_run,
            best_score: final_score,
            rolled_back,
            runtime_errors: final_errs,
        },
        summary_rec,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_direct_per_scene_remake_with_switches(
    session_id: &str,
    workspace_dir: &str,
    user_brief: &str,
    client: &reqwest::Client,
    base_url: &mut String,
    api_key: &mut String,
    model_id: &mut String,
    content_parts: &mut Vec<Value>,
    switches: DirectSceneSwitches,
) -> Result<DirectRemakeSummary, String> {
    let started = now_ms();
    let ws_root = PathBuf::from(workspace_dir);
    let style_path = ws_root.join("ref").join("extracted").join("style.json");
    let style_val: Value = serde_json::from_str(
        &std::fs::read_to_string(&style_path)
            .map_err(|e| format!("Failed reading {}: {}", style_path.display(), e))?,
    )
    .map_err(|e| format!("Invalid style.json: {}", e))?;

    let html_path = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir))
        .ok_or_else(|| "No active index.html found after film_scaffold".to_string())?;
    let film_root = html_path
        .parent()
        .ok_or_else(|| "Invalid film root".to_string())?
        .to_path_buf();
    let film_val: Value = serde_json::from_str(
        &std::fs::read_to_string(film_root.join("film.json"))
            .map_err(|e| format!("Failed reading film.json: {}", e))?,
    )
    .map_err(|e| format!("Invalid film.json: {}", e))?;

    let width = film_val.get("width").and_then(Value::as_u64).unwrap_or(1024) as u32;
    let height = film_val.get("height").and_then(Value::as_u64).unwrap_or(576) as u32;
    let fps = film_val.get("fps").and_then(Value::as_u64).unwrap_or(30) as u32;
    let bpm = style_val.get("bpm").and_then(Value::as_f64).unwrap_or(120.0);
    let root_bpm_source = style_val
        .get("bpmSource")
        .or_else(|| style_val.pointer("/audioProfile/bpmSource"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let film_scenes = film_val
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let style_scenes = style_val
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total_dur: f64 = film_scenes
        .iter()
        .map(|s| s.get("duration").and_then(Value::as_f64).unwrap_or(0.0))
        .sum::<f64>()
        .max(1.0);

    // Ensure showreel BGM+SFX exists when audioProfile is bgm-sfx-only and audio hasn't been generated yet.
    let audio_mode = style_val
        .pointer("/audioProfile/mode")
        .and_then(Value::as_str)
        .unwrap_or("bgm-sfx-only");
    let first_bgm = film_scenes
        .first()
        .and_then(|s| s.get("id").and_then(Value::as_str))
        .map(|id| film_root.join("audio").join(format!("bgm_{}.wav", id)));
    if audio_mode == "bgm-sfx-only" && first_bgm.as_ref().is_some_and(|p| !p.is_file()) {
        let audio_scenes: Vec<Value> = film_scenes
            .iter()
            .filter_map(|s| {
                Some(json!({
                    "id": s.get("id")?.as_str()?,
                    "narration": "",
                    "duration": s.get("duration").and_then(Value::as_f64).unwrap_or(2.0),
                }))
            })
            .collect();
        let _ = crate::tool::film_audio::execute_film_audio(
            session_id,
            workspace_dir,
            &json!({ "mode": "showreel", "bpm": bpm, "scenes": audio_scenes }),
        )
        .await;
    }

    let temperature = if model_id.to_ascii_lowercase().contains("gemini") {
        None
    } else {
        Some(0.35)
    };
    let max_tokens = 32_768u64;
    let system_prompt = match switches.prompt_mode {
        PromptMode::Current => DIRECT_SCENE_SYSTEM_PROMPT,
        PromptMode::Minimal => DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL,
    };
    let has_filmstrip_index = ws_root
        .join("ref")
        .join("extracted")
        .join("filmstrip_index.json")
        .is_file();
    let active_filmstrip = switches.filmstrip_pass1 && has_filmstrip_index;
    let total_scenes = film_scenes.len();
    let mut effective_switches = switches.clone();
    if active_filmstrip && total_scenes >= 2 {
        if !effective_switches.probe_steps_explicit {
            effective_switches.probe_steps = Some(1);
        }
        if !effective_switches.max_steps_explicit {
            effective_switches.max_steps = 10;
        }
        if !effective_switches.cross_context_explicit {
            effective_switches.cross_context = CrossContextMode::Summary;
        }
    }
    let max_scene_steps: usize = effective_switches.max_steps;
    let effective_concurrency = if effective_switches.concurrency_explicit {
        effective_switches.concurrency
    } else if active_filmstrip && total_scenes >= 2 {
        4
    } else {
        1
    };

    let tracer = DirectRemakeTracer::new(
        &ws_root,
        session_id,
        base_url,
        model_id,
        &effective_switches,
        system_prompt,
        started,
    );
    let scene_tools = build_scene_tool_definitions_for_remake(
        active_filmstrip,
        effective_switches.motion_spec && active_filmstrip,
    );
    let write_only_tools: Vec<Value> = scene_tools
        .iter()
        .filter(|t| {
            t.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|n| n == "write_scene_script")
        })
        .cloned()
        .collect();
    let patch_or_write_tools: Vec<Value> = scene_tools
        .iter()
        .filter(|t| {
            t.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|n| matches!(n, "patch_scene_script" | "write_scene_script"))
        })
        .cloned()
        .collect();
    let render_only_tools: Vec<Value> = scene_tools
        .iter()
        .filter(|t| {
            t.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|n| n == "render_and_compare_scene")
        })
        .cloned()
        .collect();

    crate::paths::log_engine(
        "direct_remake",
        &format!(
            "🚀 Starting Smart Per-Scene Agentic Remake (ZERO subagents, {} micro-tools, max {} steps/scene, concurrency={}): {} scenes on model={}",
            scene_tools.len(), max_scene_steps, effective_concurrency, total_scenes, model_id
        ),
    );

    let shared = Arc::new(DirectSceneRunCtx {
        session_id: session_id.to_string(),
        workspace_dir: workspace_dir.to_string(),
        user_brief: user_brief.to_string(),
        client: client.clone(),
        base_url: base_url.clone(),
        api_key: api_key.clone(),
        model_id: model_id.clone(),
        ws_root,
        film_root,
        switches: effective_switches.clone(),
        active_filmstrip,
        system_prompt,
        temperature,
        max_tokens,
        width,
        height,
        fps,
        bpm,
        total_dur,
        total_scenes,
        scene_tools,
        write_only_tools,
        patch_or_write_tools,
        render_only_tools,
        render_lock: Arc::new(tokio::sync::Mutex::new(())),
        tracer: Arc::new(tokio::sync::Mutex::new(tracer)),
        completed_scenes: Arc::new(tokio::sync::Mutex::new(Vec::new())),
    });

    let mut scene_jobs: Vec<(usize, Value, Option<Value>, Option<Value>)> =
        Vec::with_capacity(total_scenes);
    for (idx, film_sc) in film_scenes.into_iter().enumerate() {
        let scene_num = idx + 1;
        if !effective_switches.should_run_scene(scene_num) {
            continue;
        }
        let style_sc_owned = style_scenes.get(idx).cloned().map(|mut sc_val| {
            if let (Some(obj), Some(src)) = (sc_val.as_object_mut(), root_bpm_source.as_ref()) {
                obj.entry("bpmSource".to_string())
                    .or_insert_with(|| Value::String(src.clone()));
            }
            sc_val
        });
        let next_style_sc_owned = style_scenes.get(idx + 1).cloned();
        scene_jobs.push((idx, film_sc, style_sc_owned, next_style_sc_owned));
    }

    let mut indexed: Vec<(usize, DirectSceneOutcome, SceneSummaryTraceRecord)> =
        Vec::with_capacity(scene_jobs.len());
    if effective_concurrency <= 1 {
        for (idx, film_sc, style_sc, next_style_sc) in scene_jobs {
            let (outcome, sum_rec) = run_single_direct_scene(
                Arc::clone(&shared),
                idx,
                film_sc,
                style_sc,
                next_style_sc,
            )
            .await;
            indexed.push((idx, outcome, sum_rec));
        }
    } else {
        // M4b: Keep hard-cut scenes 100% parallel, but sequence ONLY `soft` cut scenes (without a
        // runtime push_* bridge) behind Scene N-1 so Scene N receives Scene N-1's exact closing pose
        // via `completed_scenes` before acquiring a concurrency permit (deadlock-free).
        let sem = Arc::new(tokio::sync::Semaphore::new(effective_concurrency));
        let mut done_txs: std::collections::HashMap<usize, tokio::sync::watch::Sender<bool>> =
            std::collections::HashMap::new();
        let mut done_rxs: std::collections::HashMap<usize, tokio::sync::watch::Receiver<bool>> =
            std::collections::HashMap::new();
        for (idx, _, _, _) in &scene_jobs {
            let (tx, rx) = tokio::sync::watch::channel(false);
            done_txs.insert(*idx, tx);
            done_rxs.insert(*idx, rx);
        }
        let mut join_set = tokio::task::JoinSet::new();
        for (idx, film_sc, style_sc, next_style_sc) in scene_jobs {
            let is_soft_seam = style_sc.as_ref().is_some_and(|sc| {
                let is_soft = sc.get("transitionFromPrev").and_then(Value::as_str) == Some("soft");
                let has_push = sc
                    .pointer("/transitionBridge/kind")
                    .and_then(Value::as_str)
                    .is_some_and(|k| k.starts_with("push_"));
                is_soft && !has_push
            });
            let wait_prev_rx = if is_soft_seam && idx > 0 {
                done_rxs.get(&(idx - 1)).cloned()
            } else {
                None
            };
            let my_done_tx = done_txs.remove(&idx);
            let sem_c = Arc::clone(&sem);
            let shared_c = Arc::clone(&shared);
            join_set.spawn(async move {
                if let Some(mut rx) = wait_prev_rx {
                    let _ = rx.wait_for(|&done| done).await;
                }
                let _permit = sem_c.acquire_owned().await.ok();
                let (outcome, sum_rec) =
                    run_single_direct_scene(shared_c, idx, film_sc, style_sc, next_style_sc)
                        .await;
                if let Some(tx) = my_done_tx {
                    let _ = tx.send(true);
                }
                (idx, outcome, sum_rec)
            });
        }
        while let Some(res) = join_set.join_next().await {
            match res {
                Ok(item) => indexed.push(item),
                Err(join_err) => {
                    crate::paths::log_engine(
                        "direct_remake",
                        &format!("Scene task join error: {}", join_err),
                    );
                }
            }
        }
        indexed.sort_by_key(|(idx, _, _)| *idx);
    }
    let mut outcomes = Vec::with_capacity(indexed.len());
    {
        let mut tr = shared.tracer.lock().await;
        for (_, outcome, sum_rec) in indexed {
            tr.record_scene_summary(&sum_rec);
            outcomes.push(outcome);
        }
    }

    // Final full-film preview capture across all scenes
    let final_comparison =
        match crate::studio::preview_capture::capture_film_preview_with_full_options(
            workspace_dir,
            Vec::new(),
            crate::studio::preview_capture::PreviewCaptureOptions {
                compare_to_reference: Some(true),
                pass_threshold: Some(0.65),
                visual_inspect_only: Some(false),
                include_full_res_frames: Some(false),
                disable_auto_rollback: true,
                forced_scene_id: None,
                write_scene_beat_strips: Some(false),
                apply_motion_blur: None,
            },
        )
        .await
        {
            Ok(res) => {
                let structured = json!({
                    "ok": true,
                    "mode": "direct-per-scene-no-subagent",
                    "referenceComparison": res.reference_comparison,
                    "runtimeErrors": res.runtime_errors,
                });
                content_parts.push(json!({
                    "id": crate::paths::gen_id("prt"),
                    "type": "tool",
                    "name": "capture_film_preview",
                    "tool": "capture_film_preview",
                    "callID": crate::paths::gen_id("direct_prev"),
                    "state": {
                        "status": "completed",
                        "input": { "compareToReference": true, "passThreshold": 0.65 },
                        "output": "Direct per-scene vision-first remake full-film verification complete.",
                        "structured": structured
                    }
                }));
                res.reference_comparison
            }
            Err(err) => {
                crate::paths::log_engine(
                    "direct_remake",
                    &format!("Final full-film preview warning: {}", err),
                );
                None
            }
        };

    let wall_ms = now_ms().saturating_sub(started);
    Ok(DirectRemakeSummary {
        scenes: outcomes,
        final_comparison,
        wall_ms,
    })
}

pub(crate) fn format_direct_remake_report(summary: &DirectRemakeSummary) -> String {
    let mut lines = vec![format!(
        "Selesai menyusun {} scene secara langsung (**Direct Per-Scene Vision-First Mode — tanpa subagent**) dalam {:.1} detik:",
        summary.scenes.len(),
        summary.wall_ms as f64 / 1000.0
    )];
    for sc in &summary.scenes {
        let rb = if sc.rolled_back {
            " (auto-rollback ke versi terbaik)"
        } else {
            ""
        };
        let err = if sc.runtime_errors.is_empty() {
            "0 error".to_string()
        } else {
            format!("{} error", sc.runtime_errors.len())
        };
        lines.push(format!(
            "- `{}` (`{}`): {} pass · skor lokal `{:.3}` · {}{}",
            sc.scene_id, sc.script_rel, sc.passes_run, sc.best_score, err, rb
        ));
    }
    if let Some(ref cmp) = summary.final_comparison {
        let overall = cmp
            .get("overallFidelity")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let ssim = cmp.get("ssimMean").and_then(Value::as_f64).unwrap_or(0.0);
        let color = cmp
            .get("colorMatchMean")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let edge = cmp
            .get("edgeMatchMean")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        lines.push(format!(
            "\nVerifikasi penuh seluruh film (`comparison_strip.jpg`): `overall={:.3}`, `SSIM={:.3}`, `Color={:.3}`, `Edge={:.3}`.",
            overall, ssim, color, edge
        ));
    }
    lines.push(
        "\nSilakan tinjau hasilnya di Studio Player, lalu klik Export MP4 jika sudah sesuai."
            .to_string(),
    );
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};
    use std::sync::{Arc, Mutex as StdMutex};

    #[test]
    fn extracts_fenced_and_raw_javascript_scene_blocks() {
        let fenced = "Here is the scene:\n```javascript\n(function(){ window.AM.registerScene('s1', function(ctx,t){}); })();\n```\nDone.";
        let got = extract_js_code_block(fenced).expect("should extract fenced js");
        assert!(got.contains("window.AM.registerScene('s1'"));
        assert!(!got.contains("Here is the scene"));

        let raw = "(function(){ AM.registerScene('s2', function(){}); })();";
        assert!(extract_js_code_block(raw).is_some());
        assert!(extract_js_code_block("plain text without code").is_none());
    }

    #[test]
    fn restore_predicate_tracks_errors_and_score_drops() {
        assert!(!should_restore_best_checkpoint(
            0.80,
            "good",
            &[],
            0,
            0.795,
            &[],
            0
        ));
        assert!(should_restore_best_checkpoint(
            0.7703,
            "good",
            &[],
            0,
            0.7506,
            &[],
            0
        ));
        assert!(should_restore_best_checkpoint(
            0.80,
            "good",
            &[],
            0,
            0.0,
            &["ReferenceError".to_string()],
            0
        ));
        assert!(should_restore_best_checkpoint(
            0.82,
            "good",
            &[],
            0,
            0.75,
            &[],
            0
        ));
        assert!(!should_restore_best_checkpoint(
            0.82,
            "// Scene: scene12 (4.0s) — managed stub by film_scaffold\n// TODO: Write deterministic motion design beats here",
            &[],
            0,
            0.20,
            &["ReferenceError".to_string()],
            0
        ));
        // Even if final_hazards < best_hazards, a large visual drop (> 0.04) must trigger rollback.
        assert!(should_restore_best_checkpoint(
            0.78,
            "good",
            &[],
            1,
            0.30,
            &[],
            0
        ));
    }

    #[test]
    fn isolated_scene_time_bounds_exclude_incoming_and_outgoing_push_bridges() {
        let style_sc3 = json!({
            "transitionBridge": {
                "kind": "push_left",
                "tStart": 6.039,
                "tEnd": 6.673
            }
        });
        let next_sc5 = json!({
            "transitionBridge": {
                "kind": "push_up",
                "tStart": 13.347,
                "tEnd": 14.181
            }
        });
        let (lo3, hi3) = compute_isolated_scene_time_bounds(
            6.206,
            3.337,
            17.885,
            Some(&style_sc3),
            &json!({}),
            None,
        );
        assert!(lo3 >= 6.71, "expected lo3 >= 6.71 outside push_left tail, got {lo3}");
        assert!(hi3 >= 9.50);

        let (lo4, hi4) = compute_isolated_scene_time_bounds(
            9.543,
            4.101,
            17.885,
            None,
            &json!({}),
            Some(&next_sc5),
        );
        assert!((lo4 - 9.563).abs() < 0.01);
        assert!(hi4 <= 13.31, "expected hi4 <= 13.31 before push_up start, got {hi4}");
    }

    fn setup_test_remake_workspace(tag: &str, num_scenes: usize) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "aetheria_remake_unit_{}_{}",
            tag,
            crate::paths::now_ms()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let proj = root.join("projects").join("demo");
        let script_dir = proj.join("script");
        let audio_dir = proj.join("audio");
        let ref_frames = root.join("ref").join("extracted").join("frames");
        let aetheria_dir = root.join(".aetheria");
        std::fs::create_dir_all(&script_dir).expect("script dir");
        std::fs::create_dir_all(&audio_dir).expect("audio dir");
        std::fs::create_dir_all(&ref_frames).expect("ref frames dir");
        std::fs::create_dir_all(&aetheria_dir).expect("aetheria dir");

        std::fs::write(
            aetheria_dir.join("active-project.json"),
            json!({ "activeProject": "projects/demo" }).to_string(),
        )
        .expect("active project");

        // Dummy WAV header so showreel BGM generation does not spawn audio tool
        let mut scenes_json = Vec::new();
        let mut style_scenes = Vec::new();
        let mut script_tags = String::new();
        let mut map_entries = Vec::new();
        for i in 1..=num_scenes {
            let sid = format!("scene{}_unit", i);
            let rel = format!("script/scene{}.js", i);
            let start = (i - 1) as f64 * 1.0;
            scenes_json.push(json!({
                "id": sid,
                "start": start,
                "duration": 1.0,
                "script": rel,
            }));
            style_scenes.push(json!({
                "id": sid,
                "start": start,
                "duration": 1.0,
                "cleanPlate": { "fillHex": "#FFFFFF", "hasGradient": false }
            }));
            std::fs::write(
                script_dir.join(format!("scene{}.js", i)),
                format!("(function(){{ window.AM.registerScene(\"{}\", function(ctx,t){{}}); }})();\n", sid),
            )
            .expect("stub scene");
            std::fs::write(audio_dir.join(format!("bgm_{}.wav", sid)), b"RIFF").expect("dummy bgm");
            script_tags.push_str(&format!("<script src=\"{}\"></script>\n", rel));
            map_entries.push(format!("{{ id: \"{}\", start: {}, dur: 1.0 }}", sid, start));
        }

        let total_dur = num_scenes as f64;
        std::fs::write(
            proj.join("film.json"),
            json!({
                "title": "Unit Test Film",
                "width": 320,
                "height": 180,
                "fps": 30,
                "duration": total_dur,
                "scenes": scenes_json,
            })
            .to_string(),
        )
        .expect("film json");

        std::fs::write(
            root.join("ref").join("extracted").join("style.json"),
            json!({
                "bpm": 120.0,
                "audioProfile": { "mode": "silent" },
                "scenes": style_scenes,
            })
            .to_string(),
        )
        .expect("style json");

        let index_html = format!(
            "<!doctype html><html><body style=\"margin:0\"><canvas id=\"c\" width=\"320\" height=\"180\"></canvas>\n\
             <script>\n\
             window.__filmMeta = {{ width: 320, height: 180, fps: 30, duration: {} }};\n\
             var _scenes = [{}];\n\
             window.AM = {{\n\
               _fns: {{}},\n\
               registerScene: function(id, fn) {{ this._fns[id] = fn; }},\n\
               clamp: function(v,a,b){{ return Math.max(a, Math.min(b, v)); }},\n\
               ease: {{ outCubic: function(x){{ return 1 - Math.pow(1 - x, 3); }} }},\n\
               rng: function(seed){{ return function(){{ return ((seed * 9301 + 49297) % 233280) / 233280; }}; }}\n\
             }};\n\
             window.renderAt = function(t) {{\n\
               var ctx = document.getElementById('c').getContext('2d');\n\
               for (var i = _scenes.length - 1; i >= 0; i--) {{\n\
                 if (t >= _scenes[i].start) {{\n\
                   var fn = window.AM._fns[_scenes[i].id];\n\
                   if (fn) fn(ctx, t - _scenes[i].start, _scenes[i].dur, _scenes[i], window.AM);\n\
                   break;\n\
                 }}\n\
               }}\n\
             }};\n\
             </script>\n\
             {}</body></html>\n",
            total_dur,
            map_entries.join(", "),
            script_tags
        );
        std::fs::write(proj.join("index.html"), index_html).expect("index html");
        root
    }

    async fn start_scripted_mock_llm<F>(handler: F) -> (String, Arc<StdMutex<Vec<Value>>>, tokio::task::JoinHandle<()>)
    where
        F: Fn(usize, &Value) -> Value + Send + Sync + 'static,
    {
        let captured = Arc::new(StdMutex::new(Vec::<Value>::new()));
        let cap_srv = Arc::clone(&captured);
        let handler = Arc::new(handler);

        let app = Router::new().route(
            "/v1/chat/completions",
            post(move |Json(payload): Json<Value>| {
                let cap = Arc::clone(&cap_srv);
                let h = Arc::clone(&handler);
                async move {
                    let idx = {
                        let mut g = cap.lock().expect("capture lock");
                        let idx = g.len();
                        g.push(payload.clone());
                        idx
                    };
                    Json(h(idx, &payload))
                }
            }),
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock llm");
        let addr = listener.local_addr().expect("mock addr");
        let srv = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://{}/v1", addr), captured, srv)
    }

    fn read_jsonl_lines(path: &Path) -> Vec<Value> {
        std::fs::read_to_string(path)
            .expect("trace readable")
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).expect("valid trace jsonl"))
            .collect()
    }

    #[tokio::test]
    async fn default_switches_preserve_baseline_payloads_and_write_trace() {
        let ws = setup_test_remake_workspace("default_snapshot", 1);
        let good_js = "(function(){ var AM=window.AM; AM.registerScene(\"scene1_unit\", function(ctx,t){ ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,320,180); ctx.fillStyle='#111111'; ctx.fillRect(20+t*80,40,50,50); }); })();\n";
        let (mut base_url, captured, srv) = start_scripted_mock_llm(move |idx, payload| {
            match idx {
                0 => json!({
                    "choices": [{
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": "tc_probe_0",
                                "type": "function",
                                "function": { "name": "bash", "arguments": "{\"command\":\"Write-Output P0\"}" }
                            }]
                        }
                    }],
                    "usage": { "prompt_tokens": 111, "completion_tokens": 22 }
                }),
                1 => json!({
                    "choices": [{
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": "tc_probe_1",
                                "type": "function",
                                "function": { "name": "bash", "arguments": "{\"command\":\"Write-Output P1\"}" }
                            }]
                        }
                    }],
                    "usage": { "prompt_tokens": 122, "completion_tokens": 24 }
                }),
                2 => {
                    // Gate fired: non-write call here must be rejected cleanly by gate
                    json!({
                        "choices": [{
                            "finish_reason": "tool_calls",
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "id": "tc_blocked_2",
                                    "type": "function",
                                    "function": { "name": "bash", "arguments": "{\"command\":\"Write-Output BLOCKED\"}" }
                                }]
                            }
                        }]
                    })
                }
                3 => {
                    let _ = payload;
                    json!({
                        "choices": [{
                            "finish_reason": "tool_calls",
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "id": "tc_write_3",
                                    "type": "function",
                                    "function": {
                                        "name": "write_scene_script",
                                        "arguments": json!({ "code": good_js }).to_string()
                                    }
                                }]
                            }
                        }]
                    })
                }
                _ => json!({
                    "choices": [{
                        "finish_reason": "stop",
                        "message": { "role": "assistant", "content": "Done." }
                    }]
                }),
            }
        })
        .await;

        let client = reqwest::Client::new();
        let mut api_key = "sk-test-secret".to_string();
        let mut model_id = "gemini-3.8-flash-medium".to_string();
        let mut content_parts = Vec::new();
        let sid = "sess_default_snap";

        let _summary = run_direct_per_scene_remake_with_switches(
            sid,
            &ws.to_string_lossy(),
            "Unit test default snapshot",
            &client,
            &mut base_url,
            &mut api_key,
            &mut model_id,
            &mut content_parts,
            DirectSceneSwitches::default(),
        )
        .await
        .expect("remake completed");

        srv.abort();
        let reqs = captured.lock().expect("lock").clone();
        assert_eq!(reqs.len(), 5);

        // Step 0 & 1: exact baseline system prompt, all 7 tools, no tool_choice, no reasoning_effort
        assert_eq!(
            reqs[0].pointer("/messages/0/content").and_then(Value::as_str),
            Some(DIRECT_SCENE_SYSTEM_PROMPT)
        );
        assert!(reqs[0].get("temperature").is_none());
        assert!(reqs[0].get("reasoning_effort").is_none());
        assert_eq!(reqs[0]["tools"].as_array().map(|a| a.len()), Some(7));
        assert!(reqs[0].get("tool_choice").is_none());

        let step1_last_user = reqs[1]["messages"]
            .as_array()
            .and_then(|m| m.last())
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        assert_eq!(
            step1_last_user,
            "Step 1/12 complete. Finish any needed probe in at most 1 more step, then call `write_scene_script` to author `script/scene1.js` and verify via `render_and_compare_scene`."
        );

        // Step 2: gate active (1 write tool + forced tool_choice + exact baseline nudge)
        let step2_last_user = reqs[2]["messages"]
            .as_array()
            .and_then(|m| m.last())
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        assert_eq!(
            step2_last_user,
            "Step 2/12 complete — probing is finished. Call `write_scene_script` NOW with your complete, studio-grade Canvas 2D implementation for Scene 1/1 (`script/scene1.js`). Right after writing, all 6 tools return so you can call `render_and_compare_scene` and polish surgically with `patch_scene_script`."
        );
        assert_eq!(reqs[2]["tools"].as_array().map(|a| a.len()), Some(1));
        assert_eq!(
            reqs[2].pointer("/tool_choice/function/name").and_then(Value::as_str),
            Some("write_scene_script")
        );

        // Step 3: blocked bash call received exact baseline error string
        let blocked_tool_msg = reqs[3]["messages"]
            .as_array()
            .and_then(|arr| arr.iter().rev().find(|m| m["role"] == "tool"))
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        assert!(blocked_tool_msg.contains("Probing phase ended at step 2; `bash` is temporarily disabled until you write the initial script."));

        // Step 4: after write, all 7 tools return and tool_choice is omitted
        assert_eq!(reqs[4]["tools"].as_array().map(|a| a.len()), Some(7));
        assert!(reqs[4].get("tool_choice").is_none());

        // Verify X0 JSONL trace exists, has schema fields, and zero secrets
        let trace_path = ws
            .join(".aetheria")
            .join("trace")
            .join(format!("direct_remake_{}.jsonl", sid));
        assert!(trace_path.is_file());
        let raw_trace = std::fs::read_to_string(&trace_path).expect("trace txt");
        assert!(!raw_trace.contains("sk-test-secret"));
        assert!(!raw_trace.contains("data:image"));

        let recs = read_jsonl_lines(&trace_path);
        assert_eq!(recs[0]["type"], "run_header");
        assert_eq!(recs[0]["upstreamModel"], "gemini-3-flash");
        assert_eq!(recs[0]["thinkingLevel"], "medium");
        let step3_rec = recs.iter().find(|r| r["type"] == "step" && r["step"] == 3).expect("step 3");
        assert_eq!(step3_rec["blockedByGate"], json!(["bash"]));
        let step1_rec = recs.iter().find(|r| r["type"] == "step" && r["step"] == 1).expect("step 1");
        assert_eq!(step1_rec["inputTokens"], 111);
        assert_eq!(step1_rec["outputTokens"], 22);
        let sc_sum = recs.iter().find(|r| r["type"] == "scene_summary").expect("summary");
        assert_eq!(sc_sum["firstWriteStep"], 4);
        assert_eq!(sc_sum["probeCallsBeforeWrite"], 2);

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn switches_control_probe_off_cross_context_minimal_prompt_reasoning_and_only_scenes() {
        let ws = setup_test_remake_workspace("switches_matrix", 2);
        let s1_js = "(function(){ var AM=window.AM; function customOrb(c,x){ c.fillRect(x,20,30,30); } AM.registerScene(\"scene1_unit\", function(ctx,t){ ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,320,180); ctx.fillStyle='#3A7AFE'; customOrb(ctx, t*80); AM.ease.outCubic(t); }); })();\n";
        let s2_js = "(function(){ var AM=window.AM; AM.registerScene(\"scene2_unit\", function(ctx,t){ ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,320,180); ctx.fillStyle='#10B981'; ctx.fillRect(40+t*70,40,60,60); }); })();\n";

        let s1_clone = s1_js.to_string();
        let s2_clone = s2_js.to_string();
        let (mut base_url, captured, srv) = start_scripted_mock_llm(move |idx, _payload| match idx {
            // Scene 1: probe step 0, 1, 2 (step 2 must NOT be blocked when PROBE_STEPS=off!), step 3 write, step 4 done
            0 | 1 | 2 => json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": format!("tc_{}", idx),
                            "type": "function",
                            "function": { "name": "bash", "arguments": "{\"command\":\"Write-Output PROBE_OK\"}" }
                        }]
                    }
                }]
            }),
            3 => json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "tc_s1_w",
                            "type": "function",
                            "function": { "name": "write_scene_script", "arguments": json!({ "code": s1_clone }).to_string() }
                        }]
                    }
                }]
            }),
            4 => json!({
                "choices": [{ "finish_reason": "stop", "message": { "role": "assistant", "content": "S1 done" } }]
            }),
            5 => json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "tc_s2_w",
                            "type": "function",
                            "function": { "name": "write_scene_script", "arguments": json!({ "code": s2_clone }).to_string() }
                        }]
                    }
                }]
            }),
            _ => json!({
                "choices": [{ "finish_reason": "stop", "message": { "role": "assistant", "content": "S2 done" } }]
            }),
        })
        .await;

        let switches = DirectSceneSwitches {
            probe_steps: None,
            cross_context: CrossContextMode::Summary,
            restore_best: false,
            reasoning_effort: Some("high".to_string()),
            prompt_mode: PromptMode::Minimal,
            only_scenes: None,
            max_steps: 10,
            filmstrip_pass1: false,
            ..Default::default()
        };
        let client = reqwest::Client::new();
        let mut api_key = "k".to_string();
        let mut model_id = "mock-smart-v".to_string();
        let mut parts = Vec::new();
        let _ = run_direct_per_scene_remake_with_switches(
            "sess_sw_on",
            &ws.to_string_lossy(),
            "Switch check",
            &client,
            &mut base_url,
            &mut api_key,
            &mut model_id,
            &mut parts,
            switches,
        )
        .await
        .expect("switches run ok");
        srv.abort();

        let reqs = captured.lock().expect("lock").clone();
        // Check Minimal prompt & reasoning_effort forwarded & probe gate disabled at step 2 (idx=2)
        assert_eq!(
            reqs[0].pointer("/messages/0/content").and_then(Value::as_str),
            Some(DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL)
        );
        assert_eq!(
            reqs[0].get("reasoning_effort").and_then(Value::as_str),
            Some("high")
        );
        assert_eq!(reqs[2]["tools"].as_array().map(|a| a.len()), Some(7));
        assert!(reqs[2].get("tool_choice").is_none());
        let step3_bash_out = reqs[3]["messages"]
            .as_array()
            .and_then(|arr| arr.iter().rev().find(|m| m["role"] == "tool"))
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        assert!(step3_bash_out.contains("PROBE_OK"));

        // Check Scene 2 initial prompt (idx=5) received deterministic factual summary from Scene 1 code
        let s2_init_text = reqs[5]
            .pointer("/messages/1/content/0/text")
            .and_then(Value::as_str)
            .unwrap_or("");
        assert!(s2_init_text.contains("PREVIOUS SCENES CODE SUMMARY"));
        assert!(s2_init_text.contains("#3A7AFE"));
        assert!(s2_init_text.contains("customOrb()"));
        assert!(s2_init_text.contains("AM.ease.outCubic"));

        // Now verify `only_scenes = Some(vec![2])` runs ONLY scene 2
        let ws_only = setup_test_remake_workspace("only_scene2", 2);
        let (mut url2, cap2, srv2) = start_scripted_mock_llm(|_idx, _p| {
            json!({ "choices": [{ "finish_reason": "stop", "message": { "role": "assistant", "content": "Done" } }] })
        })
        .await;
        let sw_only = DirectSceneSwitches {
            only_scenes: Some(vec![2]),
            max_steps: 3,
            ..Default::default()
        };
        let mut k2 = "k".to_string();
        let mut m2 = "mock-only".to_string();
        let mut p2 = Vec::new();
        let sum2 = run_direct_per_scene_remake_with_switches(
            "sess_only2",
            &ws_only.to_string_lossy(),
            "Only s2",
            &client,
            &mut url2,
            &mut k2,
            &mut m2,
            &mut p2,
            sw_only,
        )
        .await
        .expect("only scene 2 ok");
        srv2.abort();
        assert_eq!(sum2.scenes.len(), 1);
        assert_eq!(sum2.scenes[0].scene_id, "scene2_unit");
        let reqs2 = cap2.lock().expect("lock").clone();
        assert!(reqs2.iter().all(|r| {
            let txt = r.pointer("/messages/1/content/0/text").and_then(Value::as_str).unwrap_or("");
            txt.contains("TARGET SCENE 2/2") && !txt.contains("PREVIOUS SCENES CODE SUMMARY")
        }));

        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&ws_only);
    }

    #[tokio::test]
    async fn restore_switch_controls_real_checkpoint_rollback_on_regression() {
        let good_js = "(function(){ var AM=window.AM; AM.registerScene(\"scene1_unit\", function(ctx,t){ ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,320,180); ctx.fillStyle='#2255EE'; ctx.fillRect(20+t*80,30,60,60); }); })();\n";
        let broken_js = "(function(){ var AM=window.AM; AM.registerScene(\"scene1_unit\", function(ctx,t){ throw new Error('intentional_regression'); }); })();\n";

        for restore_enabled in [true, false] {
            let ws = setup_test_remake_workspace(
                if restore_enabled { "restore_on" } else { "restore_off" },
                1,
            );
            let good = good_js.to_string();
            let bad = broken_js.to_string();
            let (mut base_url, _captured, srv) = start_scripted_mock_llm(move |idx, _| match idx {
                0 => json!({
                    "choices": [{
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant", "content": "",
                            "tool_calls": [{
                                "id": "w_good", "type": "function",
                                "function": { "name": "write_scene_script", "arguments": json!({ "code": good }).to_string() }
                            }]
                        }
                    }]
                }),
                1 => json!({
                    "choices": [{
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant", "content": "",
                            "tool_calls": [{
                                "id": "r_good", "type": "function",
                                "function": { "name": "render_and_compare_scene", "arguments": "{}" }
                            }]
                        }
                    }]
                }),
                2 => json!({
                    "choices": [{
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant", "content": "",
                            "tool_calls": [{
                                "id": "w_bad", "type": "function",
                                "function": { "name": "write_scene_script", "arguments": json!({ "code": bad }).to_string() }
                            }]
                        }
                    }]
                }),
                3 => json!({
                    "choices": [{
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant", "content": "",
                            "tool_calls": [{
                                "id": "r_bad", "type": "function",
                                "function": { "name": "render_and_compare_scene", "arguments": "{}" }
                            }]
                        }
                    }]
                }),
                _ => json!({
                    "choices": [{ "finish_reason": "stop", "message": { "role": "assistant", "content": "Finished" } }]
                }),
            })
            .await;

            let switches = DirectSceneSwitches {
                restore_best: restore_enabled,
                ..Default::default()
            };
            let client = reqwest::Client::new();
            let mut api_key = "k".to_string();
            let mut model_id = "mock-restore".to_string();
            let mut parts = Vec::new();
            let sid = if restore_enabled { "sess_rst_on" } else { "sess_rst_off" };
            let sum = run_direct_per_scene_remake_with_switches(
                sid,
                &ws.to_string_lossy(),
                "Restore switch test",
                &client,
                &mut base_url,
                &mut api_key,
                &mut model_id,
                &mut parts,
                switches,
            )
            .await
            .expect("restore test ok");
            srv.abort();

            let disk_code = std::fs::read_to_string(ws.join("projects").join("demo").join("script").join("scene1.js"))
                .expect("scene1 on disk");
            assert_eq!(sum.scenes[0].rolled_back, restore_enabled);
            if restore_enabled {
                assert!(disk_code.contains("#2255EE"), "expected restored good code, got: {}", disk_code);
            } else {
                assert!(disk_code.contains("intentional_regression"), "expected broken code kept when restore=off, got: {}", disk_code);
            }

            let trace_lines = read_jsonl_lines(&ws.join(".aetheria").join("trace").join(format!("direct_remake_{}.jsonl", sid)));
            let sc_sum = trace_lines.iter().find(|r| r["type"] == "scene_summary").expect("scene summary");
            assert_eq!(sc_sum["restoredBest"], restore_enabled);

            let _ = std::fs::remove_dir_all(&ws);
        }
    }

    #[test]
    fn direct_scene_remake_is_opt_in_by_default() {
        let ws = setup_test_remake_workspace("opt_in_check", 4);
        let script_dir = ws.join("projects").join("demo").join("script");
        for i in 1..=4 {
            std::fs::write(
                script_dir.join(format!("scene{}.js", i)),
                format!(
                    "// TODO: Write deterministic motion design beats here\nwindow.AM.registerScene(\"scene{}_unit\", function(ctx,t){{}});\n",
                    i
                ),
            )
            .expect("write stub");
        }
        let ws_str = ws.to_string_lossy().to_string();
        assert!(
            !should_run_direct_scene_remake_with_mode(&ws_str, None),
            "default remake mode must not hijack turn into direct_scene_remake"
        );
        assert!(
            !should_run_direct_scene_remake_with_mode(&ws_str, Some("")),
            "empty mode must not trigger direct_scene_remake"
        );
        assert!(
            should_run_direct_scene_remake_with_mode(&ws_str, Some("direct")),
            "explicit AETHERIA_REMAKE_MODE=direct must opt in when stub scenes + style.json exist"
        );
        if std::env::var_os("AETHERIA_REMAKE_MODE").is_none() {
            assert!(!should_run_direct_scene_remake(&ws_str));
        }

        // When filmstrip_index.json exists with >= 2 modular stub scenes, auto/unset triggers direct mode
        // while explicit `standard` opts out cleanly.
        std::fs::write(
            ws.join("ref").join("extracted").join("filmstrip_index.json"),
            "{}",
        )
        .expect("write filmstrip index");
        assert!(should_run_direct_scene_remake_with_mode(&ws_str, None));
        assert!(should_run_direct_scene_remake_with_mode(&ws_str, Some("auto")));
        assert!(!should_run_direct_scene_remake_with_mode(&ws_str, Some("standard")));

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn auto_scaffold_prepares_modular_scenes_when_filmstrip_exists_and_skips_hybrid_or_missing() {
        let ws = std::env::temp_dir().join(format!("aetheria_auto_scaf_{}", crate::paths::now_ms()));
        let _ = std::fs::remove_dir_all(&ws);
        let ext = ws.join("ref").join("extracted");
        std::fs::create_dir_all(&ext).expect("ext dir");
        std::fs::write(
            ext.join("style.json"),
            json!({
                "title": "Auto Scaffold Unit",
                "width": 720,
                "height": 1280,
                "fps": 30,
                "palette": { "primary": "#0C0805" },
                "scenes": [
                    { "id": "scene1_hook", "duration": 1.67 },
                    { "id": "scene2_context", "duration": 1.13 }
                ]
            })
            .to_string(),
        )
        .expect("style json");
        let ws_str = ws.to_string_lossy().to_string();

        // Missing filmstrip_index.json -> no-op
        assert!(!maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(&"s1", &ws_str, "remake video", Some("auto")).await);

        std::fs::write(ext.join("filmstrip_index.json"), "{}").expect("filmstrip idx");
        // Explicit hybrid request -> no-op
        assert!(!maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(&"s1", &ws_str, "build using hybrid CSS3D stage", Some("auto")).await);
        // Explicit standard opt-out -> no-op
        assert!(!maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(&"s1", &ws_str, "remake video", Some("standard")).await);
        // Normal auto remake -> scaffolds 2 modular stub scenes cleanly and enables should_run_direct_scene_remake
        assert!(maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(&"s1", &ws_str, "remake video ref/reference.mp4", Some("auto")).await);
        assert!(should_run_direct_scene_remake_with_mode(&ws_str, Some("auto")));
        // Second call sees existing index.html -> idempotent false
        assert!(!maybe_auto_scaffold_for_direct_filmstrip_remake_with_mode(&"s1", &ws_str, "remake video", Some("auto")).await);

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn select_post_write_tool_phase_enforces_fix_verify_and_polish_transitions() {
        assert_eq!(
            select_post_write_tool_phase(false, false, false, 5),
            PostWriteToolPhase::AllTools
        );
        assert_eq!(
            select_post_write_tool_phase(true, true, false, 0),
            PostWriteToolPhase::AllTools
        );
        assert_eq!(
            select_post_write_tool_phase(true, true, false, 1),
            PostWriteToolPhase::VerifyDirtyScriptNow
        );
        assert_eq!(
            select_post_write_tool_phase(true, false, true, 0),
            PostWriteToolPhase::AllTools
        );
        assert_eq!(
            select_post_write_tool_phase(true, false, true, 1),
            PostWriteToolPhase::FixRuntimeErrorsNow
        );
        assert_eq!(
            select_post_write_tool_phase(true, false, false, 0),
            PostWriteToolPhase::AllTools
        );
        assert_eq!(
            select_post_write_tool_phase(true, false, false, 1),
            PostWriteToolPhase::ApplyPolishOrFinish
        );
        assert_eq!(
            select_post_write_tool_phase(true, false, false, 2),
            PostWriteToolPhase::ApplyPolishOrFinish
        );
    }

    #[test]
    fn is_better_checkpoint_and_early_exit_enforce_edge_and_worst_frame_gates() {
        // B-03 progression: even when best_score >= 0.0, higher candidate score must win!
        assert!(is_better_checkpoint(0.55, &[], 0, 0.82, &[], 0));
        assert!(!is_better_checkpoint(0.82, &[], 0, 0.55, &[], 0));
        assert!(is_better_checkpoint(0.40, &["err".to_string()], 0, 0.30, &[], 0));

        // Motion-hazard protection: a clean 0-hazard animated script (0.622) beats and is NOT rolled back
        // to an older 2-hazard static script (0.669), while equal-hazard regression still rolls back!
        assert!(is_better_checkpoint(0.669, &[], 2, 0.622, &[], 0));
        let real_code = "AM.registerScene('s', function(ctx,t){ ctx.fillRect(0,0,10,10); ctx.arc(5,5,2,0,6); });";
        assert!(!should_restore_best_checkpoint(0.669, real_code, &[], 2, 0.622, &[], 0));
        assert!(should_restore_best_checkpoint(0.70, real_code, &[], 0, 0.60, &[], 0));

        // Regression guard (Run 12 S5): a render that introduces a motion-flow deficit (hazards=1)
        // must NOT overwrite a motion-clean checkpoint (hazards=0) for a tiny visual score bump,
        // and end-of-scene restore must roll back to the motion-clean checkpoint unless score jumped >= +0.12.
        assert!(!is_better_checkpoint(0.8118, &[], 0, 0.8207, &[], 1));
        assert!(should_restore_best_checkpoint(0.8118, real_code, &[], 0, 0.8207, &[], 1));
        assert!(is_better_checkpoint(0.50, &[], 0, 0.70, &[], 1));
        assert!(!should_restore_best_checkpoint(0.50, real_code, &[], 0, 0.70, &[], 1));

        // Early exit blocked when edge < 0.42, min_frame_score < 0.66, score < 0.80, or structuralDiagnosis is present
        assert!(!should_early_exit_scene(true, false, true, &[], &[], false, false, 2, 0.82, 0.35, 0.68));
        assert!(!should_early_exit_scene(true, false, true, &[], &[], false, false, 2, 0.82, 0.45, 0.62));
        assert!(!should_early_exit_scene(true, false, true, &[], &[], false, false, 2, 0.78, 0.42, 0.66));
        assert!(!should_early_exit_scene(true, false, true, &[], &[], false, true, 2, 0.88, 0.72, 0.85));
        assert!(should_early_exit_scene(true, false, true, &[], &[], false, false, 2, 0.81, 0.42, 0.66));

        // Plateau early-stop saves tail steps once a clean >=0.70 checkpoint stops improving,
        // while NEVER cutting short a scene with remaining hazards, motion warnings, or low score.
        assert!(should_early_exit_on_plateau(true, false, true, &[], &[], false, 3, 0, 0.7902, 0.7411, 0.45, 1));
        assert!(!should_early_exit_on_plateau(true, false, true, &[], &[], false, 2, 1, 0.7902, 0.7411, 0.45, 1));
        assert!(!should_early_exit_on_plateau(true, false, true, &[], &[], true, 3, 0, 0.7902, 0.7411, 0.45, 1));
        assert!(!should_early_exit_on_plateau(true, false, true, &[], &[], false, 2, 0, 0.68, 0.65, 0.45, 1));
        assert!(!should_early_exit_on_plateau(true, false, true, &[], &[], false, 2, 0, 0.75, 0.78, 0.55, 0));
    }

    #[test]
    fn select_pass1_filmstrip_sheets_prioritizes_bursts_and_spread() {
        let sheets: Vec<Value> = (1..=17)
            .map(|idx| {
                let s0 = (idx - 1) as f64 * 0.33;
                let s1 = s0 + 0.30;
                json!({
                    "sheetIndex": idx,
                    "tStart": s0,
                    "tEnd": s1,
                    "maxDelta": if idx == 7 || idx == 12 { 18.5 } else { 1.2 },
                    "meanDelta": if idx == 7 || idx == 12 { 11.0 } else { 0.8 },
                })
            })
            .collect();
        let refs: Vec<&Value> = sheets.iter().collect();
        let bursts = vec![(2.0, 2.3, 18.5), (3.6, 3.9, 14.0)];
        let picked = select_pass1_filmstrip_sheets(&refs, &bursts, 6);
        let idxs: Vec<u64> = picked
            .iter()
            .filter_map(|v| v.get("sheetIndex").and_then(Value::as_u64))
            .collect();
        assert_eq!(idxs.len(), 6);
        assert_eq!(idxs.first().copied(), Some(1));
        assert_eq!(idxs.last().copied(), Some(17));
        assert!(idxs.contains(&7), "expected burst sheet 7 in {:?}", idxs);
        assert!(idxs.contains(&12), "expected burst sheet 12 in {:?}", idxs);
        assert!(idxs.windows(2).all(|w| w[0] < w[1]), "expected strictly sorted {:?}", idxs);
    }

    #[tokio::test]
    async fn final_dirty_step_updates_best_checkpoint_and_recovers_from_error() {
        let ws = setup_test_remake_workspace("b03_final_dirty", 1);
        let broken_js = "(function(){ var AM=window.AM; AM.registerScene(\"scene1_unit\", function(ctx,t){ throw new Error('step0_broken'); }); })();\n";
        let fixed_js = "(function(){ var AM=window.AM; AM.registerScene(\"scene1_unit\", function(ctx,t){ ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,320,180); ctx.fillStyle='#1155EE'; ctx.fillRect(20+t*80,40,60,60); }); })();\n";

        let broken_c = broken_js.to_string();
        let fixed_c = fixed_js.to_string();
        let (mut base_url, _captured, srv) = start_scripted_mock_llm(move |idx, _| match idx {
            0 => json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant", "content": "",
                        "tool_calls": [{
                            "id": "w_broken", "type": "function",
                            "function": { "name": "write_scene_script", "arguments": json!({ "code": broken_c }).to_string() }
                        }]
                    }
                }]
            }),
            1 => json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant", "content": "",
                        "tool_calls": [{
                            "id": "r_broken", "type": "function",
                            "function": { "name": "render_and_compare_scene", "arguments": "{}" }
                        }]
                    }
                }]
            }),
            // Step 2 is the LAST allowed step (`max_steps = 3`), leaving dirty_since_render = true!
            _ => json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant", "content": "",
                        "tool_calls": [{
                            "id": "w_fixed_last", "type": "function",
                            "function": { "name": "write_scene_script", "arguments": json!({ "code": fixed_c }).to_string() }
                        }]
                    }
                }]
            }),
        })
        .await;

        let switches = DirectSceneSwitches {
            probe_steps: Some(0),
            max_steps: 3,
            filmstrip_pass1: false,
            ..Default::default()
        };
        let client = reqwest::Client::new();
        let mut api_key = "k".to_string();
        let mut model_id = "mock-dirty-b03".to_string();
        let mut parts = Vec::new();
        let sum = run_direct_per_scene_remake_with_switches(
            "sess_b03_dirty",
            &ws.to_string_lossy(),
            "B-03 final dirty recovery test",
            &client,
            &mut base_url,
            &mut api_key,
            &mut model_id,
            &mut parts,
            switches,
        )
        .await
        .expect("b03 dirty test ok");
        srv.abort();

        assert_eq!(sum.scenes.len(), 1);
        assert!(sum.scenes[0].runtime_errors.is_empty(), "expected recovered 0 runtime errors, got {:?}", sum.scenes[0].runtime_errors);
        assert!(!sum.scenes[0].rolled_back);
        let disk_code = std::fs::read_to_string(ws.join("projects").join("demo").join("script").join("scene1.js"))
            .expect("scene1 on disk");
        assert!(disk_code.contains("#1155EE"), "expected final step fix persisted, got: {}", disk_code);

        let _ = std::fs::remove_dir_all(&ws);
    }
}
