//! Generic Declarative Kit Manifest (`kit.json`) validator & managed HTML renderer.
//!
//! Enables ANY externally imported or user-authored declarative skill package to run on the
//! zero-JS `story.json` fast path (pre-render lint, managed `index.html`, `contact_sheet.jpg` QA,
//! and auto-rollback) without modifying or recompiling Rust engine code.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::story_checks::{
    self, is_safe_script_rel, push_issue, KitLimits,
};
use super::story_lint::{StoryLintIssue, StoryLintReport};
use crate::paths::contains_path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitManifest {
    pub renderer: String,
    #[serde(default)]
    pub core: Option<u32>,
    #[serde(default)]
    pub use_three: bool,
    #[serde(default = "default_bg")]
    pub background: String,
    #[serde(default)]
    pub scripts: Vec<String>,
    #[serde(default)]
    pub enums: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub limits: Option<KitLimits>,
}

fn default_bg() -> String {
    "#0F1115".to_string()
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

    if let Some(shots) = story_checks::require_shots_array(root, &mut issues) {
        total_shots = shots.len();
        let mut seen_ids = HashSet::new();
        let mut expected_start = 0.0f64;

        for (idx, shot_val) in shots.iter().enumerate() {
            let sp = format!("shots[{}]", idx);
            let Some(shot) = story_checks::require_shot_object(shot_val, &sp, &mut issues) else {
                continue;
            };

            let sid = story_checks::check_shot_id(shot, &sp, &mut seen_ids, &mut issues);
            let _ = story_checks::check_shot_timing_and_wav(
                shot_val,
                shot,
                &sid,
                &sp,
                &mut expected_start,
                &mut total_duration,
                0.02,
                film_dir,
                &mut issues,
            );

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

            story_checks::check_custom_script_path(shot, &sp, &mut custom_shots, &mut issues);
        }

        if let Some(limits) = &kit.limits {
            story_checks::check_kit_limits(shots, total_duration, limits, &mut issues);
        }
    }

    story_checks::check_film_duration_alignment(film_dir, total_duration, &mut issues);

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
    let uses_story_core = kit.core == Some(1);
    let mut script_tags = String::new();
    let mut body_runtime_tags = String::new();
    if kit.use_three {
        script_tags.push_str("  <script src=\"/script/three.min.js\"></script>\n");
    }
    script_tags.push_str("  <script src=\"/script/aetheria-motion.js\"></script>\n");
    if uses_story_core {
        script_tags.push_str("  <script src=\"/script/story-core.js\"></script>\n");
    }
    let mut has_runtime = false;
    for sc in &kit.scripts {
        if let Some(clean) = is_safe_script_rel(sc) {
            if clean == "script/story-runtime.js" {
                has_runtime = true;
                if uses_story_core {
                    body_runtime_tags.push_str("  <script src=\"/script/story-runtime.js\"></script>\n");
                    continue;
                }
            }
            script_tags.push_str(&format!("  <script src=\"/{clean}\"></script>\n"));
        }
    }
    if !has_runtime {
        if uses_story_core {
            body_runtime_tags.push_str("  <script src=\"/script/story-runtime.js\"></script>\n");
        } else {
            script_tags.push_str("  <script src=\"/script/story-runtime.js\"></script>\n");
        }
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

    let boot_block = if uses_story_core {
        format!(
            "  <script>\n    window.__filmMeta = {{ title: \"{safe_title}\", width: {width}, height: {height}, fps: 30, duration: 1, scenes: [] }};\n    window.renderAt = function () {{}};\n    window.__microstockMode = {ms_flag};\n    window.__ready = false;\n  </script>\n{body_runtime_tags}"
        )
    } else {
        format!(
            "  <script>\n    (function () {{\n      window.__filmMeta = {{ title: \"{safe_title}\", width: {width}, height: {height}, fps: 30, duration: 1, scenes: [] }};\n      window.renderAt = function () {{}};\n      window.__ready = false;\n      if (window.StoryRuntime && typeof window.StoryRuntime.boot === \"function\") {{\n        window.StoryRuntime.boot({{\n          {boot_canvas_args}\n          storyUrl: \"/story.json\",\n          fallbackStoryUrl: \"/story.example.json\",\n          isMicrostock: {ms_flag}\n        }});\n      }}\n    }})();\n  </script>\n"
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
{boot_block}</body>
</html>
"##,
        title = safe_title,
        w = width,
        h = height,
        bg = bg,
        script_tags = script_tags,
        canvases_html = canvases_html,
        boot_block = boot_block,
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
            core: Some(1),
            use_three: false,
            background: "#0B0F1A".to_string(),
            scripts: vec!["script/neon-kit.js".to_string(), "script/story-runtime.js".to_string()],
            enums: HashMap::from([
                ("theme".to_string(), vec!["cyber".to_string(), "synth".to_string()]),
                ("layout".to_string(), vec!["hero".to_string(), "cards".to_string()]),
            ]),
            limits: None,
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
