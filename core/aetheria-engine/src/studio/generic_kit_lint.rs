//! Generic Declarative Kit Manifest (`kit.json`) validator & managed HTML renderer.
//!
//! Enables ANY externally imported or user-authored declarative skill package to run on the
//! zero-JS `story.json` fast path (pre-render lint, managed `index.html`, `contact_sheet.jpg` QA,
//! and auto-rollback) without modifying or recompiling Rust engine code.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::story_lint::{StoryLintIssue, StoryLintReport};
use crate::paths::contains_path;
use crate::tool::film_audio::read_wav_duration_secs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitManifest {
    pub renderer: String,
    #[serde(default)]
    pub use_three: bool,
    #[serde(default = "default_bg")]
    pub background: String,
    #[serde(default)]
    pub scripts: Vec<String>,
    #[serde(default)]
    pub enums: HashMap<String, Vec<String>>,
}

fn default_bg() -> String {
    "#0F1115".to_string()
}

fn push_issue(issues: &mut Vec<StoryLintIssue>, code: &str, path: impl Into<String>, hint: impl Into<String>) {
    issues.push(StoryLintIssue {
        code: code.to_string(),
        path: path.into(),
        hint: hint.into(),
    });
}

fn is_safe_script_rel(raw: &str) -> Option<String> {
    let clean = raw.trim().trim_start_matches('/').replace('\\', "/");
    if clean.starts_with("script/") && clean.ends_with(".js") && !clean.contains("..") {
        Some(clean)
    } else {
        None
    }
}

/// Loads `<dir>/kit.json` if present and valid.
pub fn load_kit_manifest(dir: &Path) -> Option<KitManifest> {
    let p = dir.join("kit.json");
    if !p.is_file() || !contains_path(dir, &p) {
        return None;
    }
    let raw = std::fs::read_to_string(&p).ok()?;
    serde_json::from_str::<KitManifest>(&raw).ok()
}

/// Validates a `story.json` against a generic `kit.json` manifest (timeline continuity,
/// `film.json`/WAV alignment, custom script path hygiene, and any enums declared in `kit.enums`).
pub fn lint_generic_kit_story_value(
    root: &serde_json::Map<String, Value>,
    kit: &KitManifest,
    film_dir: Option<&Path>,
    story_path_label: &str,
    mut issues: Vec<StoryLintIssue>,
) -> StoryLintReport {
    // Check root-level enum fields declared in kit.enums (e.g. `theme`)
    for (field, allowed) in &kit.enums {
        if allowed.is_empty() {
            continue;
        }
        if let Some(val) = root.get(field).and_then(Value::as_str) {
            if !allowed.iter().any(|a| a == val) {
                push_issue(
                    &mut issues,
                    "STORY_KIT_ENUM_INVALID",
                    field.clone(),
                    format!(
                        "Invalid `{}` value '{}'. Allowed by kit.json: {}.",
                        field,
                        val,
                        allowed.join(", ")
                    ),
                );
            }
        }
    }

    let mut total_shots = 0usize;
    let mut custom_shots = 0usize;
    let mut total_duration = 0.0f64;

    match root.get("shots").and_then(Value::as_array) {
        Some(shots) if !shots.is_empty() => {
            total_shots = shots.len();
            let mut seen_ids = HashSet::new();
            let mut expected_start = 0.0f64;

            for (idx, shot_val) in shots.iter().enumerate() {
                let sp = format!("shots[{}]", idx);
                let Some(shot) = shot_val.as_object() else {
                    push_issue(&mut issues, "STORY_INVALID_SHOT", sp, "Each shot must be a JSON object.");
                    continue;
                };

                let sid = shot.get("id").and_then(Value::as_str).unwrap_or("").trim();
                if sid.is_empty() {
                    push_issue(&mut issues, "STORY_INVALID_SHOT_ID", format!("{sp}.id"), "Provide a non-empty shot id.");
                } else if !seen_ids.insert(sid.to_string()) {
                    push_issue(&mut issues, "STORY_DUPLICATE_SHOT_ID", format!("{sp}.id"), format!("Duplicate shot id '{}'.", sid));
                }

                let start = shot.get("start").and_then(Value::as_f64);
                let dur = shot.get("duration").and_then(Value::as_f64);
                match (start, dur) {
                    (Some(st), Some(du)) if st.is_finite() && du.is_finite() && st >= 0.0 && du > 0.0 => {
                        if (st - expected_start).abs() > 0.02 {
                            push_issue(
                                &mut issues,
                                "STORY_SHOT_DISCONTINUITY",
                                format!("{sp}.start"),
                                format!("Shot '{}' starts at {:.3}s, expected {:.3}s.", sid, st, expected_start),
                            );
                        }
                        expected_start = st + du;
                        total_duration = expected_start;

                        if let (Some(dir), Some(wav_rel)) = (
                            film_dir,
                            shot_val.pointer("/audio/wav").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()),
                        ) {
                            let wav_path = dir.join(wav_rel.trim_start_matches('/'));
                            if contains_path(dir, &wav_path) && wav_path.is_file() {
                                if let Ok(wav_dur) = read_wav_duration_secs(&wav_path) {
                                    if du + 0.05 < wav_dur {
                                        push_issue(
                                            &mut issues,
                                            "STORY_AUDIO_TRUNCATION",
                                            format!("{sp}.duration"),
                                            format!("Shot duration ({:.2}s) < WAV '{}' ({:.2}s).", du, wav_rel, wav_dur),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    _ => push_issue(&mut issues, "STORY_INVALID_SHOT_TIMING", sp.clone(), "Provide finite `start >= 0` and `duration > 0`."),
                }

                // Validate per-shot enum fields declared in kit.enums
                for (field, allowed) in &kit.enums {
                    if allowed.is_empty() {
                        continue;
                    }
                    if let Some(v) = shot.get(field) {
                        match v {
                            Value::String(s) => {
                                if !allowed.iter().any(|a| a == s) {
                                    push_issue(
                                        &mut issues,
                                        "STORY_KIT_ENUM_INVALID",
                                        format!("{sp}.{field}"),
                                        format!("Invalid `{field}` value '{s}'. Allowed by kit.json: {}.", allowed.join(", ")),
                                    );
                                }
                            }
                            Value::Array(arr) => {
                                for (ai, item) in arr.iter().enumerate() {
                                    if let Some(s) = item.as_str() {
                                        if !allowed.iter().any(|a| a == s) {
                                            push_issue(
                                                &mut issues,
                                                "STORY_KIT_ENUM_INVALID",
                                                format!("{sp}.{field}[{ai}]"),
                                                format!("Invalid `{field}` item '{s}'. Allowed by kit.json: {}.", allowed.join(", ")),
                                            );
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }

                if let Some(custom_str) = shot.get("custom").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
                    custom_shots += 1;
                    if is_safe_script_rel(custom_str).is_none() {
                        push_issue(
                            &mut issues,
                            "STORY_INVALID_CUSTOM_PATH",
                            format!("{sp}.custom"),
                            "Custom shot script must match `script/<name>.js` without `..`.",
                        );
                    }
                }
            }
        }
        _ => push_issue(&mut issues, "STORY_EMPTY_SHOTS", "shots", "Provide at least one shot in `shots` array."),
    }

    if let Some(dir) = film_dir {
        let film_json_path = dir.join("film.json");
        if film_json_path.is_file() {
            if let Ok(raw) = std::fs::read_to_string(&film_json_path) {
                if let Ok(fj) = serde_json::from_str::<Value>(&raw) {
                    if let Some(f_scenes) = fj.get("scenes").and_then(Value::as_array) {
                        let film_total: f64 = f_scenes.iter().filter_map(|s| s.get("duration").and_then(Value::as_f64)).sum();
                        if film_total > 0.0 && total_duration > 0.0 && (film_total - total_duration).abs() > 0.25 {
                            push_issue(
                                &mut issues,
                                "STORY_FILM_DURATION_MISMATCH",
                                "shots",
                                format!("Story total duration ({:.2}s) differs from film.json total ({:.2}s).", total_duration, film_total),
                            );
                        }
                    }
                }
            }
        }
    }

    StoryLintReport {
        valid: issues.is_empty(),
        story_path: story_path_label.to_string(),
        total_shots,
        custom_shots,
        total_duration: (total_duration * 1000.0).round() / 1000.0,
        issues,
    }
}

/// Renders a managed `index.html` dynamically from `kit.json` (supports both 2D and Three.js 3D kits).
pub fn render_generic_kit_index_html(
    kit: &KitManifest,
    title: &str,
    width: u32,
    height: u32,
    custom_scripts: &[String],
    is_microstock: bool,
) -> String {
    let safe_title = title
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let bg = if kit.background.trim().is_empty() { "#0F1115" } else { kit.background.trim() };
    let mut script_tags = String::new();
    if kit.use_three {
        script_tags.push_str("  <script src=\"/script/three.min.js\"></script>\n");
    }
    script_tags.push_str("  <script src=\"/script/aetheria-motion.js\"></script>\n");
    let mut has_runtime = false;
    for sc in &kit.scripts {
        if let Some(clean) = is_safe_script_rel(sc) {
            if clean == "script/story-runtime.js" {
                has_runtime = true;
            }
            script_tags.push_str(&format!("  <script src=\"/{clean}\"></script>\n"));
        }
    }
    if !has_runtime {
        script_tags.push_str("  <script src=\"/script/story-runtime.js\"></script>\n");
    }
    for sc in custom_scripts {
        if let Some(clean) = is_safe_script_rel(sc) {
            script_tags.push_str(&format!("  <script src=\"/{clean}\"></script>\n"));
        }
    }
    let ms_flag = if is_microstock { "true" } else { "false" };
    let (canvases_html, boot_canvas_args) = if kit.use_three {
        (
            format!(
                "    <canvas id=\"stage-webgl\" width=\"{width}\" height=\"{height}\"></canvas>\n    <canvas id=\"stage-hud\" width=\"{width}\" height=\"{height}\"></canvas>"
            ),
            "glCanvas: document.getElementById(\"stage-webgl\"),\n        hudCanvas: document.getElementById(\"stage-hud\"),".to_string(),
        )
    } else {
        (
            format!("    <canvas id=\"stage-2d\" width=\"{width}\" height=\"{height}\"></canvas>"),
            "canvas: document.getElementById(\"stage-2d\"),".to_string(),
        )
    };

    format!(
        r##"<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; width: {w}px; height: {h}px; overflow: hidden; background: {bg}; font-family: "Inter", sans-serif; }}
    #stage {{ position: relative; width: {w}px; height: {h}px; }}
    #stage canvas {{ position: absolute; inset: 0; width: {w}px; height: {h}px; display: block; }}
  </style>
{script_tags}</head>
<body>
  <div id="stage">
{canvases_html}
  </div>
  <script>
    (function () {{
      window.__filmMeta = {{ title: "{title}", width: {w}, height: {h}, fps: 30, duration: 1, scenes: [] }};
      window.renderAt = function () {{}};
      window.__ready = false;
      window.StoryRuntime.boot({{
        {boot_canvas_args}
        storyUrl: "/story.json",
        fallbackStoryUrl: "/story.example.json",
        isMicrostock: {ms_flag}
      }});
    }})();
  </script>
</body>
</html>
"##,
        title = safe_title,
        w = width,
        h = height,
        bg = bg,
        script_tags = script_tags,
        canvases_html = canvases_html,
        boot_canvas_args = boot_canvas_args,
        ms_flag = ms_flag,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn generic_kit_validates_custom_enums_and_renders_valid_html() {
        let kit = KitManifest {
            renderer: "2d-custom-neon".to_string(),
            use_three: false,
            background: "#0B0F1A".to_string(),
            scripts: vec!["script/neon-kit.js".to_string(), "script/story-runtime.js".to_string()],
            enums: HashMap::from([
                ("theme".to_string(), vec!["cyber".to_string(), "synth".to_string()]),
                ("layout".to_string(), vec!["hero".to_string(), "cards".to_string()]),
            ]),
        };

        let ok = json!({
            "renderer": "2d-custom-neon",
            "theme": "cyber",
            "canvas": { "w": 1080, "h": 1920, "fps": 30 },
            "shots": [
                { "id": "s1", "start": 0.0, "duration": 4.0, "layout": "hero" },
                { "id": "s2", "start": 4.0, "duration": 4.0, "layout": "cards" }
            ],
            "captions": { "enabled": true }
        });
        let r_ok = lint_generic_kit_story_value(ok.as_object().unwrap(), &kit, None, "story.json", vec![]);
        assert!(r_ok.valid, "valid custom kit story should pass: {:?}", r_ok.issues);

        let bad = json!({
            "renderer": "2d-custom-neon",
            "theme": "pastel",
            "canvas": { "w": 1080, "h": 1920, "fps": 30 },
            "shots": [
                { "id": "s1", "start": 0.0, "duration": 4.0, "layout": "unknown-layout" }
            ],
            "captions": { "enabled": true }
        });
        let r_bad = lint_generic_kit_story_value(bad.as_object().unwrap(), &kit, None, "story.json", vec![]);
        assert!(!r_bad.valid);
        assert_eq!(r_bad.issues.iter().filter(|i| i.code == "STORY_KIT_ENUM_INVALID").count(), 2);

        let html = render_generic_kit_index_html(&kit, "Neon Deck", 1080, 1920, &[], false);
        let lint = crate::studio::motion_linter::lint_html_film(&html);
        assert!(lint.valid, "generic kit HTML must pass motion_linter: {:?}", lint.issues);
        assert!(html.contains("/script/neon-kit.js"));
        assert!(!html.contains("three.min.js"));
    }
}
