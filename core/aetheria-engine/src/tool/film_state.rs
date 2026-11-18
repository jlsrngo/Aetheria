//! Fact-Based Film Scene Progress & On-Disk Completion Verification.
//! Derives per-scene state (`missing`, `stub`, `drafted`, `previewed`) strictly from
//! workspace files (`film.json`, `index.html`, `script/*.js`, `.aetheria/preview/`)
//! rather than volatile LLM `todowrite` lists.

use crate::paths::{contains_path, now_ms};
use crate::studio::film_inspector::inspect_workspace_film;
use crate::studio::motion::resolve_active_html_film_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const PREVIEW_STATE_FILENAME: &str = "preview_state.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneProgressStatus {
    Missing,
    Stub,
    Drafted,
    Previewed,
}

impl SceneProgressStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SceneProgressStatus::Missing => "missing",
            SceneProgressStatus::Stub => "stub",
            SceneProgressStatus::Drafted => "drafted",
            SceneProgressStatus::Previewed => "previewed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SceneProgressEntry {
    pub id: String,
    pub script: String,
    pub status: SceneProgressStatus,
}

#[derive(Debug, Clone)]
pub struct FilmSceneProgress {
    pub scenes: Vec<SceneProgressEntry>,
    pub total: usize,
    pub missing: usize,
    pub stub: usize,
    pub drafted: usize,
    pub previewed: usize,
}

impl FilmSceneProgress {
    pub fn to_json(&self) -> Value {
        let items: Vec<Value> = self
            .scenes
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "script": s.script,
                    "status": s.status.as_str(),
                })
            })
            .collect();
        json!({
            "source": "disk",
            "total": self.total,
            "missing": self.missing,
            "stub": self.stub,
            "drafted": self.drafted,
            "previewed": self.previewed,
            "scenes": items,
        })
    }

    pub fn unfinished_scenes(&self) -> Vec<(String, String, &'static str)> {
        self.scenes
            .iter()
            .filter(|s| matches!(s.status, SceneProgressStatus::Missing | SceneProgressStatus::Stub))
            .map(|s| (s.id.clone(), s.script.clone(), s.status.as_str()))
            .collect()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewStateMarker {
    captured_at_ms: u64,
    runtime_errors_count: usize,
    index_sha256: Option<String>,
    #[serde(default)]
    script_sha256: BTreeMap<String, String>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn normalize_rel_script(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("./")
        .trim_start_matches('/')
        .replace('\\', "/")
}

/// Returns true when script content is still an unimplemented `film_scaffold` placeholder stub.
pub fn is_scaffold_stub_content(content: &str) -> bool {
    if content.trim().is_empty() {
        return true;
    }
    if content.contains("// TODO: Write deterministic motion design beats here") {
        return true;
    }
    content.contains("managed stub by film_scaffold")
        && content.lines().count() <= 22
        && !content.contains("AM.spring")
        && !content.contains("AM.ease")
        && !content.contains("AM.evalKeyframes")
}

fn collect_scene_specs(film_dir: &Path) -> Option<Vec<(String, String)>> {
    let manifest_path = film_dir.join("film.json");
    if contains_path(film_dir, &manifest_path) && manifest_path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<super::film_scaffold::FilmManifestJson>(&raw) {
                if !manifest.scenes.is_empty() {
                    return Some(
                        manifest
                            .scenes
                            .into_iter()
                            .map(|s| (s.id, normalize_rel_script(&s.script)))
                            .collect(),
                    );
                }
            }
        }
    }

    let index_path = film_dir.join("index.html");
    if contains_path(film_dir, &index_path) && index_path.is_file() {
        let html_raw = std::fs::read_to_string(&index_path).ok()?;
        let meta = inspect_workspace_film(&index_path);
        let script_srcs: Vec<String> = super::film_feedback::extract_local_script_srcs(&html_raw)
            .into_iter()
            .filter(|rel| {
                !rel.eq_ignore_ascii_case("script/aetheria-motion.js")
                    && !crate::studio::builtin_runtime::is_builtin_three_path(rel)
            })
            .collect();
        if !meta.scenes.is_empty() && (!script_srcs.is_empty() || film_dir.join("script").is_dir()) {
            let entries = meta
                .scenes
                .into_iter()
                .enumerate()
                .map(|(i, s)| {
                    let guessed = script_srcs
                        .iter()
                        .find(|p| p.ends_with(&format!("scene{}.js", i + 1)))
                        .or_else(|| script_srcs.get(i))
                        .cloned()
                        .unwrap_or_else(|| format!("script/scene{}.js", i + 1));
                    (s.id, normalize_rel_script(&guessed))
                })
                .collect();
            return Some(entries);
        }
        if !script_srcs.is_empty() {
            let entries = script_srcs
                .into_iter()
                .enumerate()
                .map(|(i, rel)| (format!("scene{}", i + 1), normalize_rel_script(&rel)))
                .collect();
            return Some(entries);
        }
    }

    None
}

/// Records clean preview capture script/index SHA-256 digests so disk progress accurately tracks
/// whether drafted scenes remain `previewed` or became stale (`drafted`) after a later edit.
pub fn record_preview_state(film_dir: &Path, runtime_errors_count: usize) {
    let preview_dir = film_dir.join(".aetheria").join("preview");
    if !contains_path(film_dir, &preview_dir) {
        return;
    }
    let _ = std::fs::create_dir_all(&preview_dir);

    let index_sha256 = {
        let p = film_dir.join("index.html");
        if contains_path(film_dir, &p) {
            std::fs::read(&p).ok().map(|b| sha256_hex(&b))
        } else {
            None
        }
    };

    let mut script_sha256 = BTreeMap::new();
    let script_dir = film_dir.join("script");
    if contains_path(film_dir, &script_dir) && script_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&script_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let Some(name) = p.file_name().and_then(|v| v.to_str()) else {
                    continue;
                };
                if !name.ends_with(".js")
                    || name.eq_ignore_ascii_case("aetheria-motion.js")
                    || crate::studio::builtin_runtime::is_vendor_script_name(name)
                {
                    continue;
                }
                if let Ok(bytes) = std::fs::read(&p) {
                    let rel = normalize_rel_script(&format!("script/{}", name));
                    script_sha256.insert(rel, sha256_hex(&bytes));
                }
            }
        }
    }

    let marker = PreviewStateMarker {
        captured_at_ms: now_ms(),
        runtime_errors_count,
        index_sha256,
        script_sha256,
    };
    if let Ok(raw) = serde_json::to_string_pretty(&marker) {
        let state_path = preview_dir.join(PREVIEW_STATE_FILENAME);
        if contains_path(film_dir, &state_path) {
            let _ = std::fs::write(state_path, raw);
        }
    }
}

fn load_preview_marker(film_dir: &Path) -> Option<PreviewStateMarker> {
    let p = film_dir
        .join(".aetheria")
        .join("preview")
        .join(PREVIEW_STATE_FILENAME);
    if !contains_path(film_dir, &p) || !p.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(p).ok()?;
    serde_json::from_str::<PreviewStateMarker>(&raw).ok()
}

fn latest_preview_image_mtime(film_dir: &Path) -> Option<SystemTime> {
    let preview_dir = film_dir.join(".aetheria").join("preview");
    if !contains_path(film_dir, &preview_dir) || !preview_dir.is_dir() {
        return None;
    }
    let mut newest: Option<SystemTime> = None;
    let Ok(entries) = std::fs::read_dir(&preview_dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
            continue;
        }
        if let Ok(mt) = std::fs::metadata(&p).and_then(|m| m.modified()) {
            newest = Some(newest.map_or(mt, |prev| prev.max(mt)));
        }
    }
    newest
}

/// Computes fact-based per-scene progress (`missing`, `stub`, `drafted`, `previewed`) from disk.
pub fn collect_film_scene_progress(film_dir: &Path) -> Option<FilmSceneProgress> {
    let specs = collect_scene_specs(film_dir)?;
    let marker = load_preview_marker(film_dir);
    let fallback_preview_mtime = if marker.is_none() {
        latest_preview_image_mtime(film_dir)
    } else {
        None
    };

    let current_index_sha = {
        let idx = film_dir.join("index.html");
        if contains_path(film_dir, &idx) && idx.is_file() {
            std::fs::read(&idx).ok().map(|b| sha256_hex(&b))
        } else {
            None
        }
    };

    let index_unchanged = marker.as_ref().map(|m| match (&m.index_sha256, &current_index_sha) {
        (Some(recorded), Some(current)) => recorded == current,
        (None, _) => true,
        (Some(_), None) => false,
    });

    let mut entries = Vec::with_capacity(specs.len());
    let mut missing = 0usize;
    let mut stub = 0usize;
    let mut drafted = 0usize;
    let mut previewed = 0usize;

    for (id, script_rel) in specs {
        let norm_rel = normalize_rel_script(&script_rel);
        let full_path = film_dir.join(&norm_rel);
        let status = if !contains_path(film_dir, &full_path) || !full_path.is_file() {
            missing += 1;
            SceneProgressStatus::Missing
        } else {
            let bytes = std::fs::read(&full_path).unwrap_or_default();
            let text = String::from_utf8_lossy(&bytes);
            if is_scaffold_stub_content(&text) {
                stub += 1;
                SceneProgressStatus::Stub
            } else {
                let is_previewed = if let Some(ref mk) = marker {
                    mk.runtime_errors_count == 0
                        && index_unchanged == Some(true)
                        && mk
                            .script_sha256
                            .get(&norm_rel)
                            .map(|h| h == &sha256_hex(&bytes))
                            .unwrap_or(false)
                } else if let Some(prev_mt) = fallback_preview_mtime {
                    std::fs::metadata(&full_path)
                        .and_then(|m| m.modified())
                        .map(|script_mt| prev_mt >= script_mt)
                        .unwrap_or(false)
                } else {
                    false
                };
                if is_previewed {
                    previewed += 1;
                    SceneProgressStatus::Previewed
                } else {
                    drafted += 1;
                    SceneProgressStatus::Drafted
                }
            }
        };
        entries.push(SceneProgressEntry {
            id,
            script: norm_rel,
            status,
        });
    }

    let total = entries.len();
    Some(FilmSceneProgress {
        scenes: entries,
        total,
        missing,
        stub,
        drafted,
        previewed,
    })
}

pub fn resolve_film_dir_from_target(workspace_dir: &str, target: &Path) -> Option<PathBuf> {
    let ws = Path::new(workspace_dir);
    let mut cur = if target.is_file() {
        target.parent()
    } else {
        Some(target)
    };
    while let Some(dir) = cur {
        if (dir == ws || contains_path(ws, dir))
            && (dir.join("film.json").is_file() || dir.join("index.html").is_file())
        {
            return Some(dir.to_path_buf());
        }
        if dir == ws {
            break;
        }
        cur = dir.parent();
    }
    None
}

pub fn collect_active_film_scene_progress(workspace_dir: &str) -> Option<(PathBuf, FilmSceneProgress)> {
    if workspace_dir.trim().is_empty() {
        return None;
    }
    if let Some(html_path) = resolve_active_html_film_path(Some(workspace_dir)) {
        if let Some(film_dir) = html_path.parent() {
            if let Some(prog) = collect_film_scene_progress(film_dir) {
                return Some((film_dir.to_path_buf(), prog));
            }
        }
    }
    if let Ok(manifest_path) = super::path_guard::resolve_isolated_path(workspace_dir, "film.json") {
        if manifest_path.is_file() {
            if let Some(film_dir) = manifest_path.parent() {
                if let Some(prog) = collect_film_scene_progress(film_dir) {
                    return Some((film_dir.to_path_buf(), prog));
                }
            }
        }
    }
    None
}

/// Checks active workspace film on disk for unfinished (`stub`/`missing`) scenes or script errors.
pub fn collect_film_completion_blockers(workspace_dir: &str) -> Vec<String> {
    let Some((film_dir, progress)) = collect_active_film_scene_progress(workspace_dir) else {
        return Vec::new();
    };
    let mut blockers = Vec::new();
    for (id, script, st) in progress.unfinished_scenes() {
        blockers.push(format!(
            "Scene '{}' ({}) is still '{}' on disk",
            id, script, st
        ));
    }

    for sc in &progress.scenes {
        if matches!(sc.status, SceneProgressStatus::Missing | SceneProgressStatus::Stub) {
            continue;
        }
        let script_path = film_dir.join(&sc.script);
        if contains_path(&film_dir, &script_path) && script_path.is_file() {
            let fb = super::film_feedback::collect_file_feedback(workspace_dir, &script_path);
            if fb.has_errors {
                for diag in fb.diagnostics {
                    if diag.starts_with("ERROR") {
                        blockers.push(format!("{} -> {}", sc.script, diag));
                    }
                }
            }
        }
    }

    let index_path = film_dir.join("index.html");
    if contains_path(&film_dir, &index_path) && index_path.is_file() {
        let fb = super::film_feedback::collect_file_feedback(workspace_dir, &index_path);
        if fb.wiring_error {
            for diag in fb.diagnostics {
                if diag.starts_with("ERROR") {
                    blockers.push(format!("index.html -> {}", diag));
                }
            }
        }
    }

    if crate::studio::microstock::active_microstock_lock(workspace_dir).is_none() {
        let manifest_path = film_dir.join("film.json");
        if contains_path(&film_dir, &manifest_path) && manifest_path.is_file() {
            if let Ok(raw) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) =
                    serde_json::from_str::<super::film_scaffold::FilmManifestJson>(&raw)
                {
                    for sc in &manifest.scenes {
                        let Some(ref audio_rel) = sc.audio else {
                            continue;
                        };
                        let audio_full = film_dir.join(normalize_rel_script(audio_rel));
                        if !contains_path(&film_dir, &audio_full) || !audio_full.is_file() {
                            blockers.push(format!(
                                "Scene '{}' references missing voiceover audio '{}'",
                                sc.id, audio_rel
                            ));
                        }
                        match sc.sfx.as_deref() {
                            Some(sfx_rel) => {
                                let sfx_full = film_dir.join(normalize_rel_script(sfx_rel));
                                if !contains_path(&film_dir, &sfx_full) || !sfx_full.is_file() {
                                    blockers.push(format!(
                                        "Scene '{}' references missing SFX file '{}'; re-run film_audio to synthesize SFX",
                                        sc.id, sfx_rel
                                    ));
                                }
                            }
                            None => {
                                blockers.push(format!(
                                    "Scene '{}' has voiceover audio '{}' but no SFX track ('audio/sfx_{}.wav'); run film_audio or attach sfx in film.json",
                                    sc.id, audio_rel, sc.id
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    blockers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::film_scaffold::execute_film_scaffold;

    #[test]
    fn scene_progress_tracks_stub_drafted_previewed_and_stale_re_edits_on_disk() {
        let root = std::env::temp_dir().join(format!("aetheria_f5_state_{}", crate::paths::now_ms()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let ws_str = root.to_string_lossy().to_string();

        let scaffold_res = execute_film_scaffold(
            "ses_f5_state_test",
            &ws_str,
            &json!({
                "title": "State Test",
                "preset": "portrait",
                "scenes": [
                    { "id": "scene1_hook", "duration": 2.5 },
                    { "id": "scene2_body", "duration": 2.5 }
                ]
            }),
        );
        assert_eq!(scaffold_res["ok"], json!(true));
        assert_eq!(scaffold_res["sceneProgress"]["source"], json!("disk"));
        assert_eq!(scaffold_res["sceneProgress"]["stub"], json!(2));
        assert_eq!(scaffold_res["sceneProgress"]["drafted"], json!(0));
        assert_eq!(scaffold_res["sceneProgress"]["previewed"], json!(0));

        let film_rel = scaffold_res["filmRoot"].as_str().unwrap();
        let film_dir = root.join(film_rel);

        // Implement scene1 only; leave scene2 as stub
        std::fs::write(
            film_dir.join("script").join("scene1.js"),
            "window.AM.registerScene('scene1_hook', function(ctx, localTime, dur) { ctx.fillStyle = '#112233'; ctx.fillRect(0,0,1080,1920); });\n",
        )
        .unwrap();

        let p1 = collect_film_scene_progress(&film_dir).expect("progress should parse");
        assert_eq!(p1.drafted, 1);
        assert_eq!(p1.stub, 1);
        assert_eq!(p1.previewed, 0);
        assert_eq!(p1.unfinished_scenes().len(), 1);
        assert_eq!(p1.unfinished_scenes()[0].0, "scene2_body");

        // Preview capture with runtimeErrors = 1 must NOT promote to previewed
        record_preview_state(&film_dir, 1);
        let p_err = collect_film_scene_progress(&film_dir).expect("progress");
        assert_eq!(p_err.previewed, 0);
        assert_eq!(p_err.drafted, 1);

        // Clean preview capture promotes drafted scene1 -> previewed while scene2 stays stub!
        record_preview_state(&film_dir, 0);
        let p2 = collect_film_scene_progress(&film_dir).expect("progress");
        assert_eq!(p2.previewed, 1);
        assert_eq!(p2.stub, 1);

        // Modifying scene1 after preview invalidates its previewed hash back to drafted
        std::fs::write(
            film_dir.join("script").join("scene1.js"),
            "window.AM.registerScene('scene1_hook', function(ctx, localTime, dur) { ctx.fillStyle = '#445566'; ctx.fillRect(0,0,1080,1920); });\n",
        )
        .unwrap();
        let p3 = collect_film_scene_progress(&film_dir).expect("progress");
        assert_eq!(p3.previewed, 0);
        assert_eq!(p3.drafted, 1);
        assert_eq!(p3.stub, 1);

        // Completion blockers report scene2 stub cleanly
        let blockers = collect_film_completion_blockers(&ws_str);
        assert!(blockers.iter().any(|b| b.contains("scene2_body") && b.contains("stub")));

        // Narrated scene without SFX track is flagged by completion gate until SFX exists
        std::fs::write(
            film_dir.join("script").join("scene2.js"),
            "window.AM.registerScene('scene2_body', function(ctx, localTime, dur) { ctx.fillStyle = '#223344'; ctx.fillRect(0,0,1080,1920); });\n",
        )
        .unwrap();
        std::fs::create_dir_all(film_dir.join("audio")).unwrap();
        std::fs::write(film_dir.join("audio").join("scene1_hook.wav"), b"RIFF0000WAVE").unwrap();
        let manifest_no_sfx = json!({
            "schemaVersion": 1,
            "manageIndexHtml": true,
            "title": "State Test",
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "background": "#0f1115",
            "useThree": false,
            "scenes": [
                { "id": "scene1_hook", "title": "S1", "script": "script/scene1.js", "start": 0.0, "duration": 2.5, "audio": "audio/scene1_hook.wav", "sfx": null, "words": null, "accent": "#f59e0b" },
                { "id": "scene2_body", "title": "S2", "script": "script/scene2.js", "start": 2.5, "duration": 2.5, "audio": null, "sfx": null, "words": null, "accent": "#f59e0b" }
            ]
        });
        std::fs::write(film_dir.join("film.json"), serde_json::to_string_pretty(&manifest_no_sfx).unwrap()).unwrap();
        let sfx_blockers = collect_film_completion_blockers(&ws_str);
        assert!(
            sfx_blockers.iter().any(|b| b.contains("scene1_hook") && b.contains("audio/sfx_scene1_hook.wav")),
            "expected missing SFX blocker, got {:?}",
            sfx_blockers
        );

        std::fs::write(film_dir.join("audio").join("sfx_scene1_hook.wav"), b"RIFF0000WAVE").unwrap();
        let mut manifest_with_sfx = manifest_no_sfx;
        manifest_with_sfx["scenes"][0]["sfx"] = json!("audio/sfx_scene1_hook.wav");
        std::fs::write(film_dir.join("film.json"), serde_json::to_string_pretty(&manifest_with_sfx).unwrap()).unwrap();
        let clean_blockers = collect_film_completion_blockers(&ws_str);
        assert!(clean_blockers.is_empty(), "expected zero blockers once SFX is attached, got {:?}", clean_blockers);

        let _ = std::fs::remove_dir_all(&root);
    }
}
