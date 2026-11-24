//! Anti-cheat validation and bounded fidelity tracking helpers for MotionClone studio verification.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

pub const MAX_RASTER_ASSETS: usize = 12;
const MAX_INLINE_RASTER_DATA_URI_CHARS: usize = 8192;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatReport {
    pub passed: bool,
    pub raster_asset_count: usize,
    pub max_raster_assets: usize,
    pub violations: Vec<String>,
}

fn is_raster_image_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"
            )
        })
        .unwrap_or(false)
}

fn is_ignored_asset_dir(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".aetheria" | "ref" | "exports" | "node_modules" | ".git" | "dist" | "target"
    )
}

fn collect_raster_assets_recursive(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let dir_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !is_ignored_asset_dir(dir_name) {
                collect_raster_assets_recursive(&p, root, out);
            }
        } else if p.is_file() && is_raster_image_ext(&p) {
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
}

fn check_source_for_cheat_patterns(rel_path: &str, text: &str, violations: &mut Vec<String>) {
    let lower = text.to_ascii_lowercase();

    for needle in ["ref/ref_", "ref/extracted/", "../ref/", "/ref/ref_"] {
        if lower.contains(needle) {
            violations.push(format!(
                "{rel_path}: direct reference asset replay path '{needle}' is forbidden in generated film code"
            ));
            break;
        }
    }

    if lower.contains("<video") || lower.contains("createelement('video')") || lower.contains("createelement(\"video\")") {
        violations.push(format!(
            "{rel_path}: <video> element replay is forbidden; reconstruct motion deterministically via Canvas/SVG/WebGL + window.renderAt(t)"
        ));
    }

    if lower.contains("capturestream(") {
        violations.push(format!(
            "{rel_path}: captureStream() recording/replay hack is forbidden in film source"
        ));
    }

    for marker in [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/jpg;base64,",
        "data:image/webp;base64,",
    ] {
        let mut cursor = lower.as_str();
        while let Some(idx) = cursor.find(marker) {
            let after = &cursor[idx..];
            let end = after
                .find(['"', '\'', ')', ' ', '\n', '\r'])
                .unwrap_or(after.len());
            if end > MAX_INLINE_RASTER_DATA_URI_CHARS {
                violations.push(format!(
                    "{rel_path}: oversized inline raster data URI ({end} chars > {MAX_INLINE_RASTER_DATA_URI_CHARS}) looks like a full-frame bitmap embed"
                ));
                break;
            }
            cursor = &after[marker.len()..];
        }
    }
}

/// Validates deterministic reconstruction constraints (`P2-4`):
/// - Forbids loading `ref/ref_*` / `ref/extracted/*` media, `<video>` elements, `captureStream()`,
///   and oversized inline bitmap frame dumps in `index.html` or `script/*.js`.
/// - Caps raster image assets inside the film project directory at `MAX_RASTER_ASSETS` (12).
pub fn validate_film_anti_cheat(film_root: &Path) -> AntiCheatReport {
    let mut violations = Vec::new();
    let mut source_files: Vec<(String, std::path::PathBuf)> = Vec::new();

    let index_html = film_root.join("index.html");
    if index_html.is_file() {
        source_files.push(("index.html".to_string(), index_html));
    }

    let script_dir = film_root.join("script");
    if script_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&script_dir) {
            let mut scripts: Vec<std::path::PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.extension()
                            .and_then(|e| e.to_str())
                            .is_some_and(|e| e.eq_ignore_ascii_case("js"))
                })
                .collect();
            scripts.sort();
            for p in scripts {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if matches!(
                    name.to_ascii_lowercase().as_str(),
                    "aetheria-motion.js" | "aetheria-post.js" | "aetheria-stage.js" | "story-camera.js" | "three.min.js"
                ) {
                    continue;
                }
                source_files.push((format!("script/{name}"), p));
            }
        }
    }

    for (rel, path) in source_files {
        if let Ok(text) = std::fs::read_to_string(&path) {
            check_source_for_cheat_patterns(&rel, &text, &mut violations);
        }
    }

    let mut raster_assets = Vec::new();
    collect_raster_assets_recursive(film_root, film_root, &mut raster_assets);
    raster_assets.sort();
    let unique_rasters: HashSet<String> = raster_assets.into_iter().collect();
    let raster_asset_count = unique_rasters.len();
    if raster_asset_count > MAX_RASTER_ASSETS {
        violations.push(format!(
            "Project has {raster_asset_count} raster image assets (limit: {MAX_RASTER_ASSETS}); prefer procedural vector/Canvas/WebGL rendering"
        ));
    }

    AntiCheatReport {
        passed: violations.is_empty(),
        raster_asset_count,
        max_raster_assets: MAX_RASTER_ASSETS,
        violations,
    }
}

#[derive(Clone, Debug)]
pub struct FidelityHistorySummary {
    pub attempt: usize,
    pub previous_overall: Option<f64>,
    pub score_delta: Option<f64>,
    pub regressed_from_previous: bool,
}

static FIDELITY_SCORE_HISTORY: OnceLock<Mutex<HashMap<String, Vec<f64>>>> = OnceLock::new();
static SCENE_POLISH_ATTEMPTS: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
static BEST_SCENE_SNAPSHOTS: OnceLock<Mutex<HashMap<String, (f64, String, String)>>> =
    OnceLock::new();

fn fidelity_history_store() -> &'static Mutex<HashMap<String, Vec<f64>>> {
    FIDELITY_SCORE_HISTORY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn scene_polish_attempts_store() -> &'static Mutex<HashMap<String, usize>> {
    SCENE_POLISH_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn best_scene_snapshots_store() -> &'static Mutex<HashMap<String, (f64, String, String)>> {
    BEST_SCENE_SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_scene_number_from_id(scene_id: &str) -> Option<usize> {
    let lower = scene_id.trim().to_ascii_lowercase();
    let rest = lower.strip_prefix("scene")?;
    let digits: String = rest
        .trim_start_matches(['_', '-'])
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<usize>().ok()
}

/// Snapshots the best-scoring version of each `script/sceneK.js` per `(film_root, sceneId)` when
/// `runtime_errors_empty` is true, and automatically rolls back `script/sceneK.js` on disk whenever
/// a subsequent edit introduces runtime errors or drops that scene's `overallMean` by `> 0.008`.
pub fn reconcile_per_scene_snapshots_and_rollback(
    film_root: &Path,
    runtime_errors_empty: bool,
    comparison: &Value,
) -> Vec<Value> {
    let root_key = film_root
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let mut guard = best_scene_snapshots_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut rolled_back = Vec::new();

    if !runtime_errors_empty {
        let evaluated_scenes: HashSet<usize> = comparison
            .get("sceneScores")
            .and_then(Value::as_object)
            .map(|scores| {
                scores
                    .keys()
                    .filter_map(|sid| parse_scene_number_from_id(sid))
                    .collect()
            })
            .unwrap_or_default();
        let prefix = format!("{root_key}#");
        for (k, (best_score, script_rel, best_code)) in guard.iter() {
            if !k.starts_with(&prefix) {
                continue;
            }
            let sid = k.trim_start_matches(&prefix);
            if !evaluated_scenes.is_empty()
                && parse_scene_number_from_id(sid)
                    .is_some_and(|n| !evaluated_scenes.contains(&n))
            {
                continue;
            }
            if crate::tool::film_state::is_scaffold_stub_content(best_code) {
                continue;
            }
            let disk_path = film_root.join(script_rel);
            if let Ok(cur_code) = std::fs::read_to_string(&disk_path) {
                if cur_code != *best_code && std::fs::write(&disk_path, best_code).is_ok() {
                    rolled_back.push(json!({
                        "sceneId": sid,
                        "script": script_rel,
                        "reason": "runtime_error",
                        "restoredBestScore": best_score,
                    }));
                }
            }
        }
        return rolled_back;
    }

    let Some(scene_scores) = comparison.get("sceneScores").and_then(Value::as_object) else {
        return rolled_back;
    };

    for (sid, stats) in scene_scores {
        let Some(overall_mean) = stats.get("overallMean").and_then(Value::as_f64) else {
            continue;
        };
        let Some(scene_num) = parse_scene_number_from_id(sid) else {
            continue;
        };
        let script_rel = format!("script/scene{scene_num}.js");
        let disk_path = film_root.join(&script_rel);
        let Ok(cur_code) = std::fs::read_to_string(&disk_path) else {
            continue;
        };
        if crate::tool::film_state::is_scaffold_stub_content(&cur_code) {
            continue;
        }
        let snap_key = format!("{root_key}#scene{scene_num}");
        match guard.get(&snap_key).cloned() {
            None => {
                guard.insert(snap_key, (overall_mean, script_rel, cur_code));
            }
            Some((best_score, _, best_code)) => {
                if overall_mean >= best_score - 0.008 {
                    if overall_mean >= best_score {
                        guard.insert(snap_key, (overall_mean, script_rel, cur_code));
                    }
                } else if cur_code != best_code
                    && !crate::tool::film_state::is_scaffold_stub_content(&best_code)
                    && std::fs::write(&disk_path, &best_code).is_ok()
                {
                    rolled_back.push(json!({
                        "sceneId": sid,
                        "script": script_rel,
                        "rolledBackFrom": overall_mean,
                        "restoredBestScore": best_score,
                    }));
                }
            }
        }
    }
    rolled_back
}

pub(crate) fn record_fidelity_score_in_map(
    store: &mut HashMap<String, Vec<f64>>,
    project_key: &str,
    overall: f64,
) -> FidelityHistorySummary {
    let entries = store.entry(project_key.to_string()).or_default();
    let prev = entries.last().copied();
    entries.push(overall);
    let attempt = entries.len();
    let delta = prev.map(|p| ((overall - p) * 10000.0).round() / 10000.0);
    let regressed = prev.is_some_and(|p| overall + 0.005 < p);
    FidelityHistorySummary {
        attempt,
        previous_overall: prev,
        score_delta: delta,
        regressed_from_previous: regressed,
    }
}

pub(crate) fn record_fidelity_score(project_key: &str, overall: f64) -> FidelityHistorySummary {
    let mut guard = fidelity_history_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    record_fidelity_score_in_map(&mut guard, project_key, overall)
}

/// Maps comparison `worstFrames` to exact scene IDs and script paths from `film.json` / `style.json`
/// so refinement prompts target only low-scoring scenes rather than rewriting the whole project.
pub fn build_target_worst_scenes(
    film_root: &Path,
    comparison: &Value,
) -> Vec<Value> {
    let source_frames: Vec<&Value> = comparison
        .get("perFrame")
        .and_then(Value::as_array)
        .filter(|arr| !arr.is_empty())
        .or_else(|| comparison.get("worstFrames").and_then(Value::as_array))
        .map(|arr| arr.iter().collect())
        .unwrap_or_default();
    if source_frames.is_empty() {
        return Vec::new();
    }

    let manifest_scenes: Vec<(String, String, f64, f64)> = film_root
        .join("film.json")
        .is_file()
        .then(|| std::fs::read_to_string(film_root.join("film.json")).ok())
        .flatten()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.get("scenes").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(idx, sc)| {
            let id = sc.get("id").and_then(Value::as_str)?.to_string();
            let script = sc
                .get("script")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("script/scene{}.js", idx + 1));
            let start = sc.get("start").and_then(Value::as_f64).unwrap_or(0.0);
            let dur = sc.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
            Some((id, script, start, start + dur))
        })
        .collect();

    // Rank weakness combining combinedScore, edge deficit, and structural/text flags so dark-backdrop scenes
    // with spilled containers, clipped text, wrong active words, or wrong bbox scale/position always surface.
    let weakness_rank = |f: &Value| -> f64 {
        let comb = f.get("combinedScore").and_then(Value::as_f64).unwrap_or(0.5);
        let edge_penalty = match f.get("edgeSimilarity").and_then(Value::as_f64) {
            Some(e) if e < 0.35 => (0.35 - e) * 0.65,
            _ => 0.0,
        };
        let struct_flag_pen = [
            "containerSpillDetected",
            "clippedTextDetected",
            "textDriftDetected",
            "stackedRowMismatch",
            "emptyTileCellsDetected",
        ]
        .iter()
        .any(|k| f.get(*k).and_then(Value::as_bool) == Some(true))
        .then_some(0.14)
        .unwrap_or(0.0);
        comb - edge_penalty - struct_flag_pen
    };

    // Keep the weakest single frame per unique scene so one scene with 2-3 phases
    // cannot starve other weak scenes out of polish feedback.
    let mut best_per_scene: HashMap<String, (f64, &Value, Option<String>, Option<String>)> =
        HashMap::new();
    for wf in &source_frames {
        let ts = wf.get("timestamp").and_then(Value::as_f64).unwrap_or(0.0);
        let hint_scene_id = wf.get("sceneId").and_then(Value::as_str).map(str::to_string);
        let matched = manifest_scenes
            .iter()
            .find(|(id, _, s, e)| {
                hint_scene_id.as_deref() == Some(id.as_str())
                    || (ts >= *s - 0.05 && ts <= *e + 0.05)
            })
            .cloned();
        let (scene_id, script_path) = match matched {
            Some((id, script, _, _)) => (Some(id), Some(script)),
            None => (hint_scene_id, None),
        };
        let dedup_key = scene_id
            .clone()
            .unwrap_or_else(|| format!("t={:.2}", ts));
        let rank = weakness_rank(wf);
        let replace = match best_per_scene.get(&dedup_key) {
            Some((prev_rank, _, _, _)) => rank < *prev_rank,
            None => true,
        };
        if replace {
            best_per_scene.insert(dedup_key, (rank, *wf, scene_id, script_path));
        }
    }

    let is_full_film_eval = best_per_scene.len() >= 4;
    let root_key = film_root
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let mut ranked: Vec<(f64, &Value, Option<String>, Option<String>)> =
        best_per_scene.into_values().collect();
    if is_full_film_eval {
        let attempts_guard = scene_polish_attempts_store()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        ranked.sort_by(|a, b| {
            let a_sid = a.2.as_deref().unwrap_or("");
            let b_sid = b.2.as_deref().unwrap_or("");
            let a_tries = attempts_guard
                .get(&format!("{}#{}", root_key, a_sid))
                .copied()
                .unwrap_or(0);
            let b_tries = attempts_guard
                .get(&format!("{}#{}", root_key, b_sid))
                .copied()
                .unwrap_or(0);
            let a_exhausted = a_tries >= 2;
            let b_exhausted = b_tries >= 2;
            a_exhausted
                .cmp(&b_exhausted)
                .then_with(|| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        });
    } else {
        ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    }

    let using_per_frame = comparison
        .get("perFrame")
        .and_then(Value::as_array)
        .is_some_and(|arr| !arr.is_empty());

    let mut out = Vec::new();
    for (_, wf, scene_id, script_path) in ranked {
        let comb_v = wf.get("combinedScore").and_then(Value::as_f64);
        let edge_v = wf.get("edgeSimilarity").and_then(Value::as_f64);
        let struct_diag = wf
            .get("structuralDiagnosis")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if using_per_frame
            && comb_v.unwrap_or(0.0) >= 0.80
            && edge_v.unwrap_or(1.0) >= 0.35
            && struct_diag.is_none()
        {
            continue;
        }
        let ts = wf.get("timestamp").and_then(Value::as_f64).unwrap_or(0.0);
        let phase = wf.get("phase").and_then(Value::as_str);
        let ssim_v = wf.get("ssim").and_then(Value::as_f64);
        let color_v = wf.get("colorSimilarity").and_then(Value::as_f64);
        let luma_delta = wf.get("luminanceDelta").and_then(Value::as_f64);
        let luma_corr = wf.get("lumaCorrelation").and_then(Value::as_f64);
        let blank_detected = wf
            .get("blankFrameDetected")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let mut diag_hints: Vec<String> = Vec::new();
        if blank_detected {
            diag_hints.push(
                "BLANK/CRASHED FRAME (preview rendered empty backdrop — check scene JS for ReferenceError/TypeError or missing draw calls at this timestamp)".to_string(),
            );
        }
        if let Some(sd) = struct_diag {
            diag_hints.push(sd.to_string());
        }
        if luma_corr.is_some_and(|c| c < 0.15) {
            diag_hints.push(format!(
                "INVERTED POLARITY/ORIENTATION vs ref (lumaCorrelation={:.2} — match measured tile map/polarity or flip foreground/background lightness in left column)",
                luma_corr.unwrap_or(0.0)
            ));
        }
        if phase == Some("start") && edge_v.is_some_and(|e| e < 0.25) {
            diag_hints.push(format!(
                "early-beat mismatch at start (t={:.2}s — follow subBeats/contact_sheet early transition instead of jumping straight to mid layout)",
                ts
            ));
        }
        if edge_v.is_some_and(|e| e < 0.55) {
            diag_hints.push(
                "edge mismatch (match measured pixel boxes/fontSize/fontWeight, exact hero silhouette/3D arrow/card aspect, or tilt angle)".to_string(),
            );
        }
        if color_v.is_some_and(|c| c < 0.85) {
            diag_hints.push(
                "palette mismatch (use cleanPlate.fillHex for canvas bg and match surface/accent hexes)".to_string(),
            );
        }
        if let Some(ld) = luma_delta {
            if ld < -0.06 {
                diag_hints.push(format!(
                    "TOO DARK vs ref (luminanceDelta={:.3} — brighten canvas bg/card fill toward cleanPlate.fillHex)",
                    ld
                ));
            } else if ld > 0.06 {
                diag_hints.push(format!(
                    "too bright vs ref (luminanceDelta={:.3} — darken backdrop/surface tone)",
                    ld
                ));
            }
        }
        if ssim_v.is_some_and(|s| s < 0.78) && diag_hints.is_empty() {
            diag_hints.push("structural layout drift (inspect comparison_strip Diff Heatmap)".to_string());
        }

        out.push(json!({
            "sceneId": scene_id,
            "script": script_path,
            "timestamp": ts,
            "phase": phase,
            "combinedScore": comb_v,
            "ssim": ssim_v,
            "edgeSimilarity": edge_v,
            "colorSimilarity": color_v,
            "luminanceDelta": luma_delta,
            "lumaCorrelation": luma_corr,
            "diagnosis": diag_hints.join("; "),
            "refRelPath": wf.get("refRelPath").and_then(Value::as_str),
            "previewRelPath": wf.get("previewRelPath").and_then(Value::as_str),
        }));
        if out.len() >= 5 {
            break;
        }
    }
    if is_full_film_eval {
        let mut attempts_guard = scene_polish_attempts_store()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for item in out.iter().take(2) {
            if let Some(sid) = item.get("sceneId").and_then(Value::as_str) {
                let k = format!("{}#{}", root_key, sid);
                *attempts_guard.entry(k).or_insert(0) += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anti_cheat_blocks_ref_replay_video_tag_and_excess_rasters() {
        let ws = std::env::temp_dir().join(format!("aetheria_anticheat_{}", crate::paths::now_ms()));
        let script_dir = ws.join("script");
        let img_dir = ws.join("images");
        std::fs::create_dir_all(&script_dir).unwrap();
        std::fs::create_dir_all(&img_dir).unwrap();

        std::fs::write(
            ws.join("index.html"),
            "<html><body><canvas id='stage'></canvas></body></html>",
        )
        .unwrap();
        std::fs::write(
            script_dir.join("scene1.js"),
            "window.AM.registerScene('s1', function(ctx){ /* clean procedural scene */ });",
        )
        .unwrap();
        let clean = validate_film_anti_cheat(&ws);
        assert!(clean.passed, "{:?}", clean.violations);

        std::fs::write(
            script_dir.join("scene1.js"),
            "var v = document.createElement('video'); v.src = 'ref/ref_pinterest.mp4';",
        )
        .unwrap();
        for idx in 0..13 {
            std::fs::write(img_dir.join(format!("pic_{idx}.png")), b"png").unwrap();
        }
        let dirty = validate_film_anti_cheat(&ws);
        assert!(!dirty.passed);
        assert_eq!(dirty.raster_asset_count, 13);
        assert!(dirty.violations.iter().any(|v| v.contains("ref/ref_")));
        assert!(dirty.violations.iter().any(|v| v.contains("<video>")));
        assert!(dirty.violations.iter().any(|v| v.contains("13 raster image assets")));

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn tracks_fidelity_history_and_maps_worst_scenes() {
        let mut hist = HashMap::new();
        let s1 = record_fidelity_score_in_map(&mut hist, "/p1", 0.62);
        assert_eq!(s1.attempt, 1);
        assert!(!s1.regressed_from_previous);

        let s2 = record_fidelity_score_in_map(&mut hist, "/p1", 0.78);
        assert_eq!(s2.attempt, 2);
        assert!(!s2.regressed_from_previous);
        assert!((s2.score_delta.unwrap() - 0.16).abs() < 1e-4);

        let s3 = record_fidelity_score_in_map(&mut hist, "/p1", 0.71);
        assert_eq!(s3.attempt, 3);
        assert!(s3.regressed_from_previous);

        let ws = std::env::temp_dir().join(format!("aetheria_worst_sc_{}", crate::paths::now_ms()));
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(
            ws.join("film.json"),
            serde_json::to_string(&json!({
                "scenes": [
                    { "id": "s1_hook", "script": "script/scene1.js", "start": 0.0, "duration": 2.0 },
                    { "id": "s2_payoff", "script": "script/scene2.js", "start": 2.0, "duration": 3.0 }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        let cmp = json!({
            "worstFrames": [
                { "timestamp": 3.5, "combinedScore": 0.51, "ssim": 0.42 }
            ]
        });
        let targeted = build_target_worst_scenes(&ws, &cmp);
        assert_eq!(targeted.len(), 1);
        assert_eq!(targeted[0]["sceneId"], "s2_payoff");
        assert_eq!(targeted[0]["script"], "script/scene2.js");

        // When perFrame is present, deduplicate per scene and surface low-edge dark-backdrop scenes
        // plus early-beat start mismatches even if dark-background SSIM looks high.
        let cmp_per_frame = json!({
            "perFrame": [
                { "sceneId": "s1_hook", "phase": "start", "timestamp": 0.15, "combinedScore": 0.77, "ssim": 0.93, "edgeSimilarity": 0.09 },
                { "sceneId": "s1_hook", "phase": "mid", "timestamp": 1.0, "combinedScore": 0.79, "ssim": 0.89, "edgeSimilarity": 0.30 },
                { "sceneId": "s2_payoff", "phase": "mid", "timestamp": 3.5, "combinedScore": 0.88, "ssim": 0.94, "edgeSimilarity": 0.65 }
            ]
        });
        let targeted_pf = build_target_worst_scenes(&ws, &cmp_per_frame);
        assert_eq!(targeted_pf.len(), 1);
        assert_eq!(targeted_pf[0]["sceneId"], "s1_hook");
        assert_eq!(targeted_pf[0]["phase"], "start");
        assert!(targeted_pf[0]["diagnosis"]
            .as_str()
            .unwrap_or("")
            .contains("early-beat mismatch"));

        // Verify per-scene snapshot & auto-rollback when a refine pass degrades a scene's score
        let script_dir = ws.join("script");
        std::fs::create_dir_all(&script_dir).unwrap();
        let s1_path = script_dir.join("scene1.js");
        let good_code = "window.AM.registerScene('s1_hook', function(ctx){ /* good v1 */ });";
        std::fs::write(&s1_path, good_code).unwrap();
        let cmp_pass1 = json!({
            "sceneScores": {
                "scene1_hook": { "overallMean": 0.742 }
            }
        });
        let rb1 = reconcile_per_scene_snapshots_and_rollback(&ws, true, &cmp_pass1);
        assert!(rb1.is_empty());

        let broken_code = "window.AM.registerScene('s1_hook', function(ctx){ /* regressed v2 */ });";
        std::fs::write(&s1_path, broken_code).unwrap();
        let cmp_pass2 = json!({
            "sceneScores": {
                "scene1_hook": { "overallMean": 0.610 }
            }
        });
        let rb2 = reconcile_per_scene_snapshots_and_rollback(&ws, true, &cmp_pass2);
        assert_eq!(rb2.len(), 1);
        assert_eq!(rb2[0]["script"], "script/scene1.js");
        assert_eq!(std::fs::read_to_string(&s1_path).unwrap(), good_code);

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn reconcile_never_snapshots_or_restores_scaffold_stub_and_scopes_runtime_rollback() {
        let ws = std::env::temp_dir().join(format!("aetheria_fg_stub_{}", crate::paths::now_ms()));
        let script_dir = ws.join("script");
        std::fs::create_dir_all(&script_dir).unwrap();

        let s1_path = script_dir.join("scene1.js");
        let s2_path = script_dir.join("scene2.js");
        let s12_path = script_dir.join("scene12.js");

        let stub_12 = "// Scene: scene12_beat_12 (4.27s) — managed stub by film_scaffold\n\
            (function () {\n\
              window.AM.registerScene(\"scene12_beat_12\", function (ctx) {\n\
                // TODO: Write deterministic motion design beats here\n\
              });\n\
            })();\n";
        std::fs::write(&s12_path, stub_12).unwrap();

        let real_1 = "window.AM.registerScene('scene1_hook', function(ctx,t){ ctx.fillRect(0,0,10,10); });";
        let real_2 = "window.AM.registerScene('scene2_ctx', function(ctx,t){ ctx.fillRect(0,0,20,20); });";
        std::fs::write(&s1_path, real_1).unwrap();
        std::fs::write(&s2_path, real_2).unwrap();

        // Evaluating the project while scene12 is still a stub must NOT snapshot scene12 as a "good" rollback target.
        let cmp_init = json!({
            "sceneScores": {
                "scene1_hook": { "overallMean": 0.72 },
                "scene2_ctx": { "overallMean": 0.75 },
                "scene12_beat_12": { "overallMean": 0.86 }
            }
        });
        assert!(reconcile_per_scene_snapshots_and_rollback(&ws, true, &cmp_init).is_empty());

        let authored_12 = "window.AM.registerScene('scene12_beat_12', function(ctx,t){ ctx.fillRect(t*10,0,50,50); });";
        std::fs::write(&s12_path, authored_12).unwrap();
        let cmp_12_low = json!({
            "sceneScores": {
                "scene12_beat_12": { "overallMean": 0.45 }
            }
        });
        let rb_stub = reconcile_per_scene_snapshots_and_rollback(&ws, true, &cmp_12_low);
        assert!(rb_stub.is_empty(), "must never roll back authored code to scaffold stub");
        assert_eq!(std::fs::read_to_string(&s12_path).unwrap(), authored_12);

        // Concurrent scene edit safety: runtime error during Scene 1 evaluation must NOT clobber modified Scene 2.
        let broken_1 = "window.AM.registerScene('scene1_hook', function(ctx,t){ throw new Error('s1'); });";
        let newer_2 = "window.AM.registerScene('scene2_ctx', function(ctx,t){ ctx.fillRect(5,5,40,40); });";
        std::fs::write(&s1_path, broken_1).unwrap();
        std::fs::write(&s2_path, newer_2).unwrap();

        let cmp_s1_err = json!({
            "sceneScores": {
                "scene1_hook": { "overallMean": 0.10 }
            }
        });
        let rb_err = reconcile_per_scene_snapshots_and_rollback(&ws, false, &cmp_s1_err);
        assert_eq!(rb_err.len(), 1);
        assert_eq!(rb_err[0]["script"], "script/scene1.js");
        assert_eq!(std::fs::read_to_string(&s1_path).unwrap(), real_1);
        assert_eq!(std::fs::read_to_string(&s2_path).unwrap(), newer_2);

        let _ = std::fs::remove_dir_all(&ws);
    }
}
