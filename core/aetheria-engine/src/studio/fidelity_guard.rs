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
                    "aetheria-motion.js" | "three.min.js"
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

fn fidelity_history_store() -> &'static Mutex<HashMap<String, Vec<f64>>> {
    FIDELITY_SCORE_HISTORY.get_or_init(|| Mutex::new(HashMap::new()))
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
    let Some(worst_arr) = comparison.get("worstFrames").and_then(Value::as_array) else {
        return Vec::new();
    };
    if worst_arr.is_empty() {
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

    let mut seen_keys = HashSet::new();
    let mut out = Vec::new();
    for wf in worst_arr {
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
        if !seen_keys.insert(dedup_key) {
            continue;
        }
        out.push(json!({
            "sceneId": scene_id,
            "script": script_path,
            "timestamp": ts,
            "combinedScore": wf.get("combinedScore").and_then(Value::as_f64),
            "ssim": wf.get("ssim").and_then(Value::as_f64),
            "refRelPath": wf.get("refRelPath").and_then(Value::as_str),
            "previewRelPath": wf.get("previewRelPath").and_then(Value::as_str),
        }));
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

        let _ = std::fs::remove_dir_all(&ws);
    }
}
