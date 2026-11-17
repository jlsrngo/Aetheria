//! Deterministic Film Scaffold Tool (`film_scaffold`).
//!
//! Generates and maintains `film.json`, boilerplate `index.html` (window.__filmMeta, SCENES,
//! renderAt, words preload), and idempotent per-scene stubs (`script/sceneK.js`) so the LLM
//! focuses purely on creative animation code inside scene render functions.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::paths::contains_path;
use crate::session::message::emit_event;
use crate::studio::film_inspector::inspect_workspace_film;
use crate::studio::microstock::active_microstock_lock;
use crate::studio::project_registry::{
    create_studio_project, resolve_active_project_or_film_root, PROJECTS_DIR_NAME,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldSceneInput {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub audio: Option<String>,
    #[serde(default)]
    pub sfx: Option<String>,
    #[serde(default)]
    pub words: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmManifestJson {
    pub schema_version: u32,
    pub manage_index_html: bool,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub background: String,
    #[serde(default)]
    pub use_three: bool,
    pub scenes: Vec<FilmManifestScene>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmManifestScene {
    pub id: String,
    pub title: String,
    pub script: String,
    pub start: f64,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sfx: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<String>,
    pub accent: String,
}

pub fn film_scaffold_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "film_scaffold",
            "description": "Scaffolds the active motion film project (`film.json`, `index.html` boilerplate, and idempotent `script/sceneK.js` stubs) inside `projects/<slug>/`. Call this FIRST for any new animation so you never have to hand-write `index.html`, `window.__filmMeta`, `SCENES`, `renderAt`, or scene ID wiring — just fill in the generated `script/sceneK.js` scene function(s) afterwards. Preserves existing scene bodies cleanly on updates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Human-readable film title."
                    },
                    "width": {
                        "type": "integer",
                        "description": "Canvas width in pixels (defaults to 1080 or active Microstock lock)."
                    },
                    "height": {
                        "type": "integer",
                        "description": "Canvas height in pixels (defaults to 1920 or active Microstock lock)."
                    },
                    "fps": {
                        "type": "integer",
                        "description": "Frames per second (default 30)."
                    },
                    "preset": {
                        "type": "string",
                        "enum": ["portrait", "landscape", "4k"],
                        "description": "Optional quick ratio preset (`portrait` 1080x1920, `landscape` 1920x1080, `4k` 3840x2160)."
                    },
                    "background": {
                        "type": "string",
                        "description": "Canvas/stage background CSS color (default `#0f1115`)."
                    },
                    "useThree": {
                        "type": "boolean",
                        "description": "Include `/script/three.min.js` before scene scripts for WebGL 3D scenes."
                    },
                    "manageIndexHtml": {
                        "type": "boolean",
                        "description": "Whether the harness generates/updates `index.html` (default true; pass false for custom stage escape hatch)."
                    },
                    "overwriteIndexHtml": {
                        "type": "boolean",
                        "description": "Set true only if explicitly replacing an existing hand-written `index.html` without `film.json`."
                    },
                    "buffer": {
                        "type": "number",
                        "description": "Default breathing buffer seconds added when deriving scene duration from audio/words (default 0.6)."
                    },
                    "durationTolerance": {
                        "type": "number",
                        "description": "Excess dead-air warning threshold in seconds above WAV duration (default 2.0)."
                    },
                    "scenes": {
                        "type": "array",
                        "description": "Ordered list of film scenes. IDs must be unique.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string", "description": "Unique scene ID matching `AM.registerScene(\"<id>\", ...)`." },
                                "title": { "type": "string" },
                                "duration": { "type": "number", "description": "Optional scene duration in seconds (> 0). Omit to derive automatically from `words` / `audio` WAV duration (+ buffer)." },
                                "audio": { "type": "string", "description": "Optional relative audio path (e.g. `audio/scene1.wav`)." },
                                "sfx": { "type": "string", "description": "Optional relative SFX path." },
                                "words": { "type": "string", "description": "Optional relative word timing JSON path generated by Voicebox/TTS (e.g. `audio/scene1.words.json`)." },
                                "accent": { "type": "string", "description": "Hex accent color (e.g. `#f59e0b`)." }
                            },
                            "required": ["id"]
                        }
                    }
                },
                "required": ["scenes"]
            }
        }
    })
}

fn sanitize_js_id(raw: &str) -> String {
    let trimmed = raw.trim();
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
        }
    }
    out
}

fn normalize_asset_ref(raw: Option<String>) -> Option<String> {
    raw.map(|s| s.trim().trim_start_matches('/').replace('\\', "/"))
        .filter(|s| !s.is_empty() && !s.contains(".."))
}

fn resolve_target_film_dir(ws_root: &Path, title: &str) -> Result<PathBuf, String> {
    let projects_root = ws_root.join(PROJECTS_DIR_NAME);
    if let Some(active) = resolve_active_project_or_film_root(ws_root) {
        if active != ws_root && active.starts_with(&projects_root) && contains_path(ws_root, &active)
        {
            return Ok(active);
        }
    }
    let created = create_studio_project(ws_root, title)?;
    let dir = projects_root.join(&created.id);
    if !contains_path(ws_root, &dir) {
        return Err("Scaffold project path escaped workspace root.".to_string());
    }
    Ok(dir)
}

fn escape_html_text(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub(crate) fn render_managed_index_html(
    manifest: &FilmManifestJson,
    is_microstock: bool,
) -> String {
    let total_dur: f64 = manifest.scenes.iter().map(|s| s.duration).sum();
    let total_frames = ((total_dur * (manifest.fps as f64)).round() as u32).max(1);
    let safe_title = escape_html_text(&manifest.title);
    let safe_bg = if manifest.background.trim().is_empty() {
        "#0f1115"
    } else {
        manifest.background.trim()
    };

    let mut script_tags = String::new();
    if manifest.use_three {
        script_tags.push_str("  <script src=\"/script/three.min.js\"></script>\n");
    }
    script_tags.push_str("  <script src=\"/script/aetheria-motion.js\"></script>\n");
    for sc in &manifest.scenes {
        script_tags.push_str(&format!("  <script src=\"/{}\"></script>\n", sc.script));
    }

    let scenes_json = serde_json::to_string_pretty(&manifest.scenes).unwrap_or_else(|_| "[]".into());
    let title_json = serde_json::to_string(&manifest.title).unwrap_or_else(|_| "\"Motion Film\"".into());
    let bg_json = serde_json::to_string(safe_bg).unwrap_or_else(|_| "\"#0f1115\"".into());

    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width={w}, initial-scale=1.0" />
  <title>{title}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html, body {{
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: {bg};
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    #stage {{
      position: relative;
      width: {w}px;
      height: {h}px;
      overflow: hidden;
      background: {bg};
      transform-origin: center center;
    }}
    #film {{
      display: block;
      width: {w}px;
      height: {h}px;
    }}
  </style>
{scripts}</head>
<body>
  <div id="stage">
    <canvas id="film" width="{w}" height="{h}"></canvas>
  </div>
  <script>
  (function () {{
    "use strict";
    var W = {w};
    var H = {h};
    var FPS = {fps};
    var BG = {bg_json};
    var MICROSTOCK_MODE = {microstock};
    var SCENES = {scenes};
    var totalDuration = 0;
    for (var i = 0; i < SCENES.length; i++) {{
      totalDuration += Number(SCENES[i].duration || 0);
    }}

    window.__filmMeta = {{
      title: {title_json},
      width: {w},
      height: {h},
      fps: {fps},
      duration: Number(totalDuration.toFixed(4)),
      durationInFrames: {total_frames},
      scenes: SCENES
    }};

    var stageEl = document.getElementById("stage");
    function fitStage() {{
      if (!stageEl) return;
      var vw = window.innerWidth || W;
      var vh = window.innerHeight || H;
      var scale = Math.min(vw / W, vh / H);
      stageEl.style.transform = "scale(" + scale + ")";
    }}
    fitStage();
    window.addEventListener("resize", fitStage);

    var canvas = document.getElementById("film");
    var ctx = canvas.getContext("2d");

    window.renderAt = function (t) {{
      var sec = Number.isFinite(t) ? Math.max(0, t) : 0;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      if (!window.AM || !SCENES.length) return;
      var resolved = window.AM.resolveScene(sec, SCENES);
      var scene = resolved.scene;
      var localTime = resolved.localTime;
      var renderFn = window.AM.getSceneRenderer(scene.id, resolved.index);
      if (renderFn) {{
        ctx.save();
        try {{
          renderFn(ctx, localTime, scene.duration, scene, window.AM);
        }} catch (err) {{
          window.__runtimeError = String(err && err.stack ? err.stack : err);
          if (typeof console !== "undefined" && console.error) console.error(err);
        }}
        ctx.restore();
      }}
      if (!MICROSTOCK_MODE && scene._words && scene._words.length > 0 && window.AM.drawSubtitles) {{
        var subOpts = (scene.subtitleStyle && typeof scene.subtitleStyle === "object")
          ? scene.subtitleStyle
          : {{ style: "neobrutalism", wordsPerGroup: 1 }};
        ctx.save();
        window.AM.drawSubtitles(ctx, scene._words, localTime, subOpts);
        ctx.restore();
      }}
    }};

    var wordPromises = [];
    for (var j = 0; j < SCENES.length; j++) {{
      (function (sc) {{
        if (!sc.words) return;
        var p = fetch("/" + sc.words.replace(/^\/+/, ""))
          .then(function (r) {{ return r.ok ? r.json() : []; }})
          .then(function (d) {{ sc._words = Array.isArray(d) ? d : (d && Array.isArray(d.words) ? d.words : []); }})
          .catch(function () {{ sc._words = []; }});
        wordPromises.push(p);
      }})(SCENES[j]);
    }}

    if (wordPromises.length === 0) {{
      window.renderAt(0);
      window.__ready = true;
    }} else {{
      Promise.all(wordPromises).then(function () {{
        window.renderAt(0);
        window.__ready = true;
      }});
    }}
  }})();
  </script>
</body>
</html>
"##,
        w = manifest.width,
        h = manifest.height,
        fps = manifest.fps,
        title = safe_title,
        bg = safe_bg,
        bg_json = bg_json,
        scripts = script_tags,
        microstock = is_microstock,
        scenes = scenes_json,
        title_json = title_json,
        total_frames = total_frames
    )
}

fn render_scene_stub(scene: &FilmManifestScene, width: u32, height: u32, background: &str) -> String {
    let id_json = serde_json::to_string(&scene.id).unwrap_or_else(|_| "\"scene1\"".into());
    let accent_json = serde_json::to_string(&scene.accent).unwrap_or_else(|_| "\"#f59e0b\"".into());
    let bg_json = serde_json::to_string(background).unwrap_or_else(|_| "\"#0f1115\"".into());
    format!(
        r#"// Scene: {title} ({dur:.2}s) — managed stub by film_scaffold
(function () {{
  "use strict";
  var AM = window.AM;
  AM.registerScene({id_json}, function (ctx, localTime, dur, scene, AM) {{
    var W = {width};
    var H = {height};
    var accent = (scene && scene.accent) || {accent_json};
    ctx.fillStyle = {bg_json};
    ctx.fillRect(0, 0, W, H);

    // TODO: Write deterministic motion design beats here using localTime (0..dur) and AM helpers.
    var progress = AM.clamp(localTime / Math.max(0.001, dur), 0, 1);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(W * (0.2 + 0.6 * progress), H * 0.5, 48, 0, Math.PI * 2);
    ctx.fill();
  }});
}})();
"#,
        title = scene.title,
        dur = scene.duration,
        id_json = id_json,
        width = width,
        height = height,
        accent_json = accent_json,
        bg_json = bg_json
    )
}

fn read_reference_canvas_defaults(ws_root: &Path) -> Option<(u32, u32, u32)> {
    let mut candidates = vec![
        ws_root.join("ref").join("extracted").join("style.json"),
        ws_root.join("ref").join("style.json"),
    ];
    if let Some(active_dir) = resolve_active_project_or_film_root(ws_root) {
        if active_dir != ws_root {
            candidates.push(active_dir.join("ref").join("extracted").join("style.json"));
            candidates.push(active_dir.join("ref").join("style.json"));
        }
    }
    for path in candidates {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let w = v.get("width").and_then(Value::as_u64).map(|n| n as u32);
        let h = v.get("height").and_then(Value::as_u64).map(|n| n as u32);
        if let (Some(rw), Some(rh)) = (w, h) {
            if rw >= 16 && rh >= 16 {
                let fps = v
                    .get("fps")
                    .and_then(Value::as_u64)
                    .map(|n| (n as u32).max(1))
                    .unwrap_or(30);
                return Some((rw, rh, fps));
            }
        }
    }
    None
}

pub fn execute_film_scaffold(session_id: &str, workspace_dir: &str, arguments: &Value) -> Value {
    let ws_root = if workspace_dir.trim().is_empty() {
        return json!({ "ok": false, "error": "workspace_dir is empty." });
    } else {
        Path::new(workspace_dir)
    };

    let raw_scenes = match arguments.get("scenes").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr,
        _ => {
            return json!({
                "ok": false,
                "error": "Parameter 'scenes' must be a non-empty array of { id, duration, ... }."
            });
        }
    };

    let lock = active_microstock_lock(workspace_dir);
    let preset = arguments.get("preset").and_then(|v| v.as_str()).unwrap_or("");
    let (preset_w, preset_h) = match preset {
        "landscape" => (Some(1920u32), Some(1080u32)),
        "4k" => (Some(3840u32), Some(2160u32)),
        "portrait" => (Some(1080u32), Some(1920u32)),
        _ => (None, None),
    };

    let req_w = arguments.get("width").and_then(|v| v.as_u64()).map(|v| v as u32).or(preset_w);
    let req_h = arguments.get("height").and_then(|v| v.as_u64()).map(|v| v as u32).or(preset_h);
    let req_fps = arguments.get("fps").and_then(|v| v.as_u64()).map(|v| v as u32);

    let ref_defaults = read_reference_canvas_defaults(ws_root);
    let allow_ar_mismatch = arguments
        .get("allowAspectRatioMismatch")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let (width, height, fps) = if let Some(ref lk) = lock {
        if let (Some(w), Some(h)) = (req_w, req_h) {
            if w != lk.width || h != lk.height {
                return json!({
                    "ok": false,
                    "code": "MICROSTOCK_RATIO_MISMATCH",
                    "error": format!(
                        "Adobe Stock Mode ('M') locks dimensions to {}x{} ({}), cannot scaffold {}x{}. Omit width/height or pass {}x{}.",
                        lk.width, lk.height, lk.ratio, w, h, lk.width, lk.height
                    )
                });
            }
        }
        (lk.width, lk.height, req_fps.unwrap_or(lk.fps).max(1))
    } else {
        let w = req_w
            .or_else(|| ref_defaults.map(|d| d.0))
            .unwrap_or(1080)
            .max(16);
        let h = req_h
            .or_else(|| ref_defaults.map(|d| d.1))
            .unwrap_or(1920)
            .max(16);
        let f = req_fps
            .or_else(|| ref_defaults.map(|d| d.2))
            .unwrap_or(30)
            .max(1);
        if let Some((rw, rh, _)) = ref_defaults {
            if (req_w.is_some() || req_h.is_some()) && !allow_ar_mismatch {
                let target_ar = w as f64 / h as f64;
                let ref_ar = rw as f64 / rh as f64;
                let diff_ratio = (target_ar - ref_ar).abs() / target_ar.max(ref_ar).max(1e-6);
                if diff_ratio > 0.02 {
                    return json!({
                        "ok": false,
                        "code": "REFERENCE_ASPECT_RATIO_MISMATCH",
                        "error": format!(
                            "Requested {}x{} (aspect {:.3}) mismatches extracted reference aspect {}x{} ({:.3}). Omit width/height/preset to inherit reference dimensions automatically, or pass allowAspectRatioMismatch: true.",
                            w, h, target_ar, rw, rh, ref_ar
                        )
                    });
                }
            }
        }
        (w, h, f)
    };

    let title = arguments
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Motion Film")
        .to_string();
    let explicit_background = arguments
        .get("background")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let background_omitted = explicit_background.is_none();
    let background = explicit_background.unwrap_or("#0f1115").to_string();
    let use_three = arguments.get("useThree").and_then(|v| v.as_bool()).unwrap_or(false);
    let manage_index = arguments
        .get("manageIndexHtml")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let overwrite_index = arguments
        .get("overwriteIndexHtml")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let buffer_sec = arguments
        .get("buffer")
        .and_then(|v| v.as_f64())
        .filter(|b| b.is_finite() && *b >= 0.0)
        .unwrap_or(super::film_audio::DEFAULT_AUDIO_BUFFER_SEC);
    let warn_tol = arguments
        .get("durationTolerance")
        .and_then(|v| v.as_f64())
        .filter(|t| t.is_finite() && *t >= 0.0)
        .unwrap_or(super::film_audio::DEFAULT_DURATION_WARN_TOL_SEC);

    let film_dir = match resolve_target_film_dir(ws_root, &title) {
        Ok(d) => d,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let film_json_path = film_dir.join("film.json");
    let index_path = film_dir.join("index.html");
    let script_dir = film_dir.join("script");

    let existing_by_id: std::collections::HashMap<String, FilmManifestScene> =
        if film_json_path.is_file() {
            std::fs::read_to_string(&film_json_path)
                .ok()
                .and_then(|s| serde_json::from_str::<FilmManifestJson>(&s).ok())
                .map(|m| m.scenes.into_iter().map(|s| (s.id.clone(), s)).collect())
                .unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        };

    let mut seen_ids = HashSet::new();
    let mut manifest_scenes = Vec::with_capacity(raw_scenes.len());
    let mut acc_start = 0.0f64;

    for (idx, item) in raw_scenes.iter().enumerate() {
        let parsed: ScaffoldSceneInput = match serde_json::from_value(item.clone()) {
            Ok(v) => v,
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("Invalid scene at index {}: {}", idx, e)
                });
            }
        };
        let clean_id = sanitize_js_id(&parsed.id);
        if clean_id.is_empty() {
            return json!({
                "ok": false,
                "error": format!("Scene at index {} has an empty or invalid 'id'.", idx)
            });
        }
        if !seen_ids.insert(clean_id.clone()) {
            return json!({
                "ok": false,
                "code": "DUPLICATE_SCENE_ID",
                "error": format!("Duplicate scene id '{}' in scenes array.", clean_id)
            });
        }

        let prev = existing_by_id.get(&clean_id);
        let audio = normalize_asset_ref(parsed.audio).or_else(|| {
            if lock.is_none() {
                prev.and_then(|p| p.audio.clone())
            } else {
                None
            }
        });
        let sfx = normalize_asset_ref(parsed.sfx).or_else(|| {
            if lock.is_none() {
                prev.and_then(|p| p.sfx.clone())
            } else {
                None
            }
        });
        let words = normalize_asset_ref(parsed.words).or_else(|| prev.and_then(|p| p.words.clone()));

        if lock.is_some() && (audio.is_some() || sfx.is_some()) {
            return json!({
                "ok": false,
                "code": "MICROSTOCK_AUDIO_FORBIDDEN",
                "error": format!(
                    "Adobe Stock Mode ('M') requires silent video (-an); remove audio/sfx from scene '{}'.",
                    clean_id
                )
            });
        }

        let resolved_duration = match parsed.duration {
            Some(d) => {
                if !d.is_finite() || d <= 0.0 {
                    return json!({
                        "ok": false,
                        "error": format!("Scene '{}' must have a finite positive duration.", clean_id)
                    });
                }
                d
            }
            None => {
                match super::film_audio::resolve_final_audio_duration(
                    &film_dir,
                    words.as_deref(),
                    audio.as_deref(),
                ) {
                    Ok(audio_dur) => {
                        let derived = ((audio_dur + buffer_sec) * 1000.0).round() / 1000.0;
                        if let Some(prev_sc) = prev {
                            if prev_sc.duration >= audio_dur && prev_sc.audio == audio {
                                prev_sc.duration
                            } else {
                                derived
                            }
                        } else {
                            derived
                        }
                    }
                    Err(reason) => {
                        return json!({
                            "ok": false,
                            "code": "MISSING_SCENE_DURATION_AND_AUDIO",
                            "sceneId": clean_id,
                            "error": format!(
                                "Scene '{}' omits 'duration' and cannot derive it from 'words' or 'audio': {}. Provide 'duration' or run 'film_audio' first.",
                                clean_id, reason
                            )
                        });
                    }
                }
            }
        };

        let scene_title = parsed
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(&clean_id)
            .to_string();
        let accent = parsed
            .accent
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("#f59e0b")
            .to_string();

        manifest_scenes.push(FilmManifestScene {
            id: clean_id,
            title: scene_title,
            script: format!("script/scene{}.js", idx + 1),
            start: (acc_start * 1000.0).round() / 1000.0,
            duration: (resolved_duration * 1000.0).round() / 1000.0,
            audio,
            sfx,
            words,
            accent,
        });
        acc_start += resolved_duration;
    }

    let mut warnings = match super::film_audio::validate_scenes_audio_durations(
        &film_dir,
        &manifest_scenes,
        warn_tol,
    ) {
        Ok(w) => w,
        Err(err_val) => return err_val,
    };
    if use_three && background_omitted {
        warnings.push(json!({
            "code": "USE_THREE_DEFAULT_DARK_BG",
            "message": "WARNING: 'useThree: true' defaulted 'background' to dark '#0f1115'. Pass an explicit 'background' (e.g. '#93C5FD') or set 'scene.background' / 'renderer.setClearColor(...)' / '#stage' CSS gradient if using alpha: true."
        }));
    }

    if let Err(e) = std::fs::create_dir_all(&script_dir) {
        return json!({
            "ok": false,
            "error": format!("Failed creating script directory '{}': {}", script_dir.display(), e)
        });
    }

    if manage_index && index_path.is_file() && !film_json_path.is_file() && !overwrite_index {
        return json!({
            "ok": false,
            "code": "UNMANAGED_INDEX_HTML_EXISTS",
            "error": "Existing hand-written index.html found without film.json. Pass manageIndexHtml: false to only write film.json/missing stubs, or overwriteIndexHtml: true to replace index.html."
        });
    }

    let manifest = FilmManifestJson {
        schema_version: 1,
        manage_index_html: manage_index,
        title: title.clone(),
        width,
        height,
        fps,
        background: background.clone(),
        use_three,
        scenes: manifest_scenes.clone(),
    };

    let manifest_str = match serde_json::to_string_pretty(&manifest) {
        Ok(s) => s,
        Err(e) => return json!({ "ok": false, "error": format!("Serialize film.json error: {}", e) }),
    };
    if let Err(e) = std::fs::write(&film_json_path, &manifest_str) {
        return json!({
            "ok": false,
            "error": format!("Failed writing {}: {}", film_json_path.display(), e)
        });
    }

    let film_root_rel = film_dir
        .strip_prefix(ws_root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    emit_event(
        workspace_dir,
        "file.edited",
        json!({
            "file": if film_root_rel.is_empty() { "film.json".to_string() } else { format!("{}/film.json", film_root_rel) },
            "sessionID": session_id
        }),
    );

    if manage_index {
        let html = render_managed_index_html(&manifest, lock.is_some());
        if let Err(e) = std::fs::write(&index_path, &html) {
            return json!({
                "ok": false,
                "error": format!("Failed writing {}: {}", index_path.display(), e)
            });
        }
        emit_event(
            workspace_dir,
            "file.edited",
            json!({
                "file": if film_root_rel.is_empty() { "index.html".to_string() } else { format!("{}/index.html", film_root_rel) },
                "sessionID": session_id
            }),
        );
    }

    let mut created_scenes = Vec::new();
    let mut existing_scenes = Vec::new();
    let mut scene_files = Vec::new();

    for sc in &manifest.scenes {
        scene_files.push(sc.script.clone());
        let sc_path = film_dir.join(&sc.script);
        if sc_path.is_file() {
            existing_scenes.push(sc.script.clone());
            continue;
        }
        let stub = render_scene_stub(sc, manifest.width, manifest.height, &manifest.background);
        if let Err(e) = std::fs::write(&sc_path, &stub) {
            return json!({
                "ok": false,
                "error": format!("Failed writing {}: {}", sc_path.display(), e)
            });
        }
        emit_event(
            workspace_dir,
            "file.edited",
            json!({
                "file": if film_root_rel.is_empty() { sc.script.clone() } else { format!("{}/{}", film_root_rel, sc.script) },
                "sessionID": session_id
            }),
        );
        created_scenes.push(sc.script.clone());
    }

    let meta = inspect_workspace_film(&index_path);
    let scene_progress = super::film_state::collect_film_scene_progress(&film_dir).map(|p| p.to_json());
    let mut result = json!({
        "ok": true,
        "filmRoot": film_root_rel,
        "filmJson": if film_root_rel.is_empty() { "film.json".to_string() } else { format!("{}/film.json", film_root_rel) },
        "indexHtml": if film_root_rel.is_empty() { "index.html".to_string() } else { format!("{}/index.html", film_root_rel) },
        "managedIndexHtml": manage_index,
        "createdScenes": created_scenes,
        "existingScenes": existing_scenes,
        "sceneFiles": scene_files,
        "width": manifest.width,
        "height": manifest.height,
        "fps": manifest.fps,
        "totalDuration": meta.duration,
        "lintValid": meta.lint.valid,
        "warnings": warnings,
        "output": format!(
            "Scaffolded film '{}' ({}x{} @ {}fps, {} scene(s)) in '{}'. Now write the animation inside: {} (track real progress via sceneProgress on disk instead of todowrite).",
            manifest.title,
            manifest.width,
            manifest.height,
            manifest.fps,
            manifest.scenes.len(),
            film_root_rel,
            scene_files.join(", ")
        )
    });
    if let Some(prog) = scene_progress {
        result["sceneProgress"] = prog;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn film_scaffold_generates_idempotent_stubs_and_rejects_duplicate_ids() {
        let dir = std::env::temp_dir().join(format!("aetheria_scaffold_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().to_string();

        let dup_res = execute_film_scaffold(
            "ses_1",
            &ws,
            &json!({
                "title": "Dup Test",
                "scenes": [
                    { "id": "scene1", "duration": 5.0 },
                    { "id": "scene1", "duration": 4.0 }
                ]
            }),
        );
        assert_eq!(dup_res["ok"], false);
        assert_eq!(dup_res["code"], "DUPLICATE_SCENE_ID");

        let ok_res = execute_film_scaffold(
            "ses_1",
            &ws,
            &json!({
                "title": "Globe Animation",
                "preset": "landscape",
                "scenes": [
                    { "id": "scene1_globe", "duration": 6.0, "accent": "#38bdf8" },
                    { "id": "scene2_outro", "duration": 4.0, "accent": "#f59e0b" }
                ]
            }),
        );
        assert_eq!(ok_res["ok"], true, "unexpected error: {:?}", ok_res);
        assert_eq!(ok_res["width"], 1920);
        assert_eq!(ok_res["height"], 1080);
        assert_eq!(ok_res["lintValid"], true);

        let film_root = dir.join(ok_res["filmRoot"].as_str().unwrap());
        let s1_path = film_root.join("script").join("scene1.js");
        assert!(film_root.join("film.json").is_file());
        assert!(film_root.join("index.html").is_file());
        assert!(s1_path.is_file());

        // Customize scene1.js body and re-run scaffold with updated duration -> body must stay intact
        let custom_s1 = "window.AM.registerScene(\"scene1_globe\", function(ctx){ /* CUSTOM_ANIM */ });";
        std::fs::write(&s1_path, custom_s1).unwrap();

        let rerun = execute_film_scaffold(
            "ses_1",
            &ws,
            &json!({
                "title": "Globe Animation Updated",
                "preset": "landscape",
                "scenes": [
                    { "id": "scene1_globe", "duration": 8.0, "accent": "#38bdf8" },
                    { "id": "scene2_outro", "duration": 4.0, "accent": "#f59e0b" }
                ]
            }),
        );
        assert_eq!(rerun["ok"], true);
        assert_eq!(
            std::fs::read_to_string(&s1_path).unwrap(),
            custom_s1,
            "idempotent re-scaffold must preserve existing scene body"
        );
        let html_after = std::fs::read_to_string(film_root.join("index.html")).unwrap();
        assert!(html_after.contains("Globe Animation Updated"));
        assert!(html_after.contains("8.0"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn film_scaffold_respects_legacy_unmanaged_index_and_escape_hatch() {
        let dir = std::env::temp_dir().join(format!("aetheria_scaffold_legacy_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let proj = create_studio_project(&dir, "Legacy Custom").unwrap();
        let legacy_html = dir.join("projects").join(&proj.id).join("index.html");
        std::fs::write(&legacy_html, "<html><!-- hand-written stage --></html>").unwrap();

        let ws = dir.to_string_lossy().to_string();
        let refused = execute_film_scaffold(
            "ses_1",
            &ws,
            &json!({
                "title": "Legacy Custom",
                "scenes": [{ "id": "s1", "duration": 5.0 }]
            }),
        );
        assert_eq!(refused["ok"], false);
        assert_eq!(refused["code"], "UNMANAGED_INDEX_HTML_EXISTS");
        assert!(std::fs::read_to_string(&legacy_html).unwrap().contains("hand-written stage"));

        let escape = execute_film_scaffold(
            "ses_1",
            &ws,
            &json!({
                "title": "Legacy Custom",
                "manageIndexHtml": false,
                "scenes": [{ "id": "s1", "duration": 5.0 }]
            }),
        );
        assert_eq!(escape["ok"], true);
        assert!(std::fs::read_to_string(&legacy_html).unwrap().contains("hand-written stage"));
        assert!(dir.join("projects").join(&proj.id).join("film.json").is_file());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn film_scaffold_derives_duration_from_words_or_wav_and_rejects_short_or_missing() {
        let dir = std::env::temp_dir().join(format!("aetheria_scaffold_dur_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let proj = create_studio_project(&dir, "Derived Duration").unwrap();
        let proj_dir = dir.join("projects").join(&proj.id);
        let audio_dir = proj_dir.join("audio");
        std::fs::create_dir_all(&audio_dir).unwrap();

        // Missing both duration and audio/words -> clear error
        let ws = dir.to_string_lossy().to_string();
        let missing_res = execute_film_scaffold(
            "ses_d1",
            &ws,
            &json!({
                "title": "Derived Duration",
                "scenes": [{ "id": "s1" }]
            }),
        );
        assert_eq!(missing_res["ok"], false);
        assert_eq!(missing_res["code"], "MISSING_SCENE_DURATION_AND_AUDIO");

        // Write real 2.5s WAV + words.json
        let sr = 24000u32;
        let data_bytes = (2.5 * sr as f64) as u32 * 2;
        let mut wav = Vec::with_capacity(44 + data_bytes as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&sr.to_le_bytes());
        wav.extend_from_slice(&(sr * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_bytes.to_le_bytes());
        wav.resize(44 + data_bytes as usize, 0u8);
        std::fs::write(audio_dir.join("s1.wav"), wav).unwrap();
        std::fs::write(
            audio_dir.join("s1.words.json"),
            r#"{"text":"Halo","duration":2.5,"words":[{"word":"Halo","start":0.05,"end":0.4}]}"#,
        )
        .unwrap();

        // Derived duration when omitted -> 2.5 + 0.6 = 3.1s
        let ok_res = execute_film_scaffold(
            "ses_d1",
            &ws,
            &json!({
                "title": "Derived Duration",
                "scenes": [{ "id": "s1", "audio": "audio/s1.wav", "words": "audio/s1.words.json" }]
            }),
        );
        assert_eq!(ok_res["ok"], true, "{:?}", ok_res);
        assert!((ok_res["totalDuration"].as_f64().unwrap() - 3.1).abs() < 0.02);

        // Explicitly too short duration -> AUDIO_LONGER_THAN_SCENE error with shortfall diff
        let short_res = execute_film_scaffold(
            "ses_d1",
            &ws,
            &json!({
                "title": "Derived Duration",
                "scenes": [{ "id": "s1", "duration": 1.0, "audio": "audio/s1.wav", "words": "audio/s1.words.json" }]
            }),
        );
        assert_eq!(short_res["ok"], false);
        assert_eq!(short_res["code"], "AUDIO_LONGER_THAN_SCENE");
        assert!(short_res["error"].as_str().unwrap().contains("1.500s"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn film_scaffold_managed_html_defaults_to_neobrutalism_word_by_word_subtitles() {
        let manifest = FilmManifestJson {
            schema_version: 1,
            manage_index_html: true,
            title: "Sub Test".to_string(),
            width: 1080,
            height: 1920,
            fps: 30,
            background: "#93C5FD".to_string(),
            use_three: false,
            scenes: vec![FilmManifestScene {
                id: "s1".to_string(),
                title: "S1".to_string(),
                script: "script/scene1.js".to_string(),
                start: 0.0,
                duration: 3.0,
                audio: None,
                sfx: None,
                words: None,
                accent: "#FFDE59".to_string(),
            }],
        };
        let html = render_managed_index_html(&manifest, false);
        assert!(html.contains(r#"style: "neobrutalism", wordsPerGroup: 1"#));
    }

    #[test]
    fn film_scaffold_warns_when_use_three_omits_background() {
        let dir = std::env::temp_dir().join(format!("aetheria_scaffold_3d_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().to_string();

        let res_warn = execute_film_scaffold(
            "ses_3d",
            &ws,
            &json!({
                "title": "3D No BG",
                "useThree": true,
                "scenes": [{ "id": "s1", "duration": 3.0 }]
            }),
        );
        assert_eq!(res_warn["ok"], true);
        let warn_str = res_warn["warnings"].to_string();
        assert!(warn_str.contains("useThree: true"), "expected useThree warning, got {}", warn_str);

        let res_ok = execute_film_scaffold(
            "ses_3d",
            &ws,
            &json!({
                "title": "3D Explicit BG",
                "useThree": true,
                "background": "#93C5FD",
                "scenes": [{ "id": "s1", "duration": 3.0 }]
            }),
        );
        assert_eq!(res_ok["ok"], true);
        assert_eq!(res_ok["warnings"].as_array().map(|a| a.len()).unwrap_or(99), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn film_scaffold_inherits_reference_dimensions_and_rejects_aspect_mismatch() {
        let dir = std::env::temp_dir().join(format!("aetheria_scaffold_ref_ar_{}", crate::paths::now_ms()));
        let extracted = dir.join("ref").join("extracted");
        std::fs::create_dir_all(&extracted).unwrap();
        std::fs::write(
            extracted.join("style.json"),
            serde_json::to_string(&json!({
                "width": 1920,
                "height": 1080,
                "fps": 60,
                "aspectRatio": "16:9",
                "scenes": []
            }))
            .unwrap(),
        )
        .unwrap();
        let ws = dir.to_string_lossy().to_string();

        // Explicit portrait request against 16:9 reference must be rejected clearly
        let err_res = execute_film_scaffold(
            "ses_ar",
            &ws,
            &json!({
                "title": "Ref Inherit Test",
                "preset": "portrait",
                "scenes": [{ "id": "s1", "duration": 2.0 }]
            }),
        );
        assert_eq!(err_res["ok"], false);
        assert_eq!(err_res["code"], "REFERENCE_ASPECT_RATIO_MISMATCH");

        // Omitting width/height/fps inherits 1920x1080 @ 60fps from style.json
        let ok_res = execute_film_scaffold(
            "ses_ar",
            &ws,
            &json!({
                "title": "Ref Inherit Test",
                "scenes": [{ "id": "s1", "duration": 2.0 }]
            }),
        );
        assert_eq!(ok_res["ok"], true, "{:?}", ok_res);
        assert_eq!(ok_res["width"], 1920);
        assert_eq!(ok_res["height"], 1080);
        assert_eq!(ok_res["fps"], 60);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
