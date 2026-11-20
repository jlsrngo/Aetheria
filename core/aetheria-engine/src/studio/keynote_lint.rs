//! Declarative Product Keynote Showreel (`renderer: "2d-product-keynote"`) validator & HTML renderer.

use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

use super::story_checks::{self, push_issue};
use super::story_lint::{StoryLintIssue, StoryLintReport};

pub const VALID_KEYNOTE_THEMES: &[&str] = &[
    "pearl-studio",
    "obsidian-pro",
    "titanium-warm",
    "aurora-keynote",
    "mint-editorial",
];
pub const VALID_KEYNOTE_LAYOUTS: &[&str] = &[
    "brand-intro",
    "hero-device",
    "bento-grid",
    "spec-counter",
    "feature-spotlight",
    "ui-showcase",
    "split-compare",
    "cta-outro",
];
pub const VALID_KEYNOTE_DEVICES: &[&str] = &["laptop", "phone", "tablet", "watch", "chip", "card"];
pub const VALID_KEYNOTE_ICONS: &[&str] = &[
    "spark", "bolt", "shield", "cpu", "layers", "globe", "wave", "lock", "camera", "play", "chart", "check",
];
pub const VALID_KEYNOTE_TRANSITIONS: &[&str] = &["zoom-cross", "slide-push", "cut"];

fn is_hex(s: &str) -> bool {
    let t = s.trim();
    t.len() == 7 && t.starts_with('#') && t[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn lint_keynote_story_value(
    root: &serde_json::Map<String, Value>,
    film_dir: Option<&Path>,
    story_path_label: &str,
    mut issues: Vec<StoryLintIssue>,
) -> StoryLintReport {
    if let Some(th) = root.get("theme") {
        let s = th.as_str().unwrap_or("");
        if !VALID_KEYNOTE_THEMES.contains(&s) {
            push_issue(&mut issues, "STORY_UNKNOWN_THEME", "theme", format!("Invalid theme '{}'. Allowed: {}.", s, VALID_KEYNOTE_THEMES.join(", ")));
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

                let layout = shot.get("layout").and_then(Value::as_str).unwrap_or("");
                if !VALID_KEYNOTE_LAYOUTS.contains(&layout) {
                    push_issue(&mut issues, "STORY_UNKNOWN_LAYOUT", format!("{sp}.layout"), format!("Invalid keynote layout '{}'. Allowed: {}.", layout, VALID_KEYNOTE_LAYOUTS.join(", ")));
                }
                if let Some(th) = shot.get("theme").and_then(Value::as_str) {
                    if !VALID_KEYNOTE_THEMES.contains(&th) {
                        push_issue(&mut issues, "STORY_UNKNOWN_THEME", format!("{sp}.theme"), format!("Invalid theme '{}'. Allowed: {}.", th, VALID_KEYNOTE_THEMES.join(", ")));
                    }
                }
                if let Some(dv) = shot.get("device").and_then(Value::as_str) {
                    if !VALID_KEYNOTE_DEVICES.contains(&dv) {
                        push_issue(&mut issues, "STORY_UNKNOWN_DEVICE", format!("{sp}.device"), format!("Invalid device '{}'. Allowed: {}.", dv, VALID_KEYNOTE_DEVICES.join(", ")));
                    }
                }
                if let Some(ic) = shot.get("icon").and_then(Value::as_str) {
                    if !VALID_KEYNOTE_ICONS.contains(&ic) {
                        push_issue(&mut issues, "STORY_UNKNOWN_ICON", format!("{sp}.icon"), format!("Invalid icon '{}'. Allowed: {}.", ic, VALID_KEYNOTE_ICONS.join(", ")));
                    }
                }
                if let Some(tr) = shot.get("transition").and_then(Value::as_str) {
                    if !VALID_KEYNOTE_TRANSITIONS.contains(&tr) {
                        push_issue(&mut issues, "STORY_UNKNOWN_TRANSITION", format!("{sp}.transition"), format!("Invalid transition '{}'. Allowed: {}.", tr, VALID_KEYNOTE_TRANSITIONS.join(", ")));
                    }
                }
                for ckey in ["accentColor", "secondaryColor"] {
                    if let Some(cv) = shot.get(ckey) {
                        if !cv.as_str().is_some_and(is_hex) {
                            push_issue(&mut issues, "STORY_INVALID_PALETTE", format!("{sp}.{ckey}"), "Use a 6-digit hex color like '#0071E3'.");
                        }
                    }
                }
                if let Some(items) = shot.get("items").and_then(Value::as_array) {
                    for (ii, iv) in items.iter().enumerate() {
                        if let Some(ic) = iv.get("icon").and_then(Value::as_str) {
                            if !VALID_KEYNOTE_ICONS.contains(&ic) {
                                push_issue(&mut issues, "STORY_UNKNOWN_ICON", format!("{sp}.items[{ii}].icon"), format!("Invalid item icon '{}'.", ic));
                            }
                        }
                    }
                }
            story_checks::check_custom_script_path(shot, &sp, &mut custom_shots, &mut issues);
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

pub fn render_keynote_index_html(
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
    let mut custom_tags = String::new();
    for sc in custom_scripts {
        let clean = sc.trim().trim_start_matches('/').replace('\\', "/");
        if clean.starts_with("script/") && clean.ends_with(".js") && !clean.contains("..") {
            custom_tags.push_str(&format!("  <script src=\"/{}\"></script>\n", clean));
        }
    }
    let ms_flag = if is_microstock { "true" } else { "false" };
    format!(
        r##"<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; width: {w}px; height: {h}px; overflow: hidden; background: #0A0A0C; font-family: "Inter", sans-serif; }}
    #stage {{ position: relative; width: {w}px; height: {h}px; }}
    #stage canvas {{ position: absolute; inset: 0; width: {w}px; height: {h}px; display: block; }}
  </style>
  <script src="/script/aetheria-motion.js"></script>
  <script src="/script/story-camera.js"></script>
  <script src="/script/keynote-kit.js"></script>
  <script src="/script/keynote-layouts.js"></script>
  <script src="/script/story-runtime.js"></script>
{custom_tags}</head>
<body>
  <div id="stage">
    <canvas id="stage-2d" width="{w}" height="{h}"></canvas>
  </div>
  <script>
    (function () {{
      window.__filmMeta = {{ title: "{title}", width: {w}, height: {h}, fps: 30, duration: 1, scenes: [] }};
      window.renderAt = function () {{}};
      window.__ready = false;
      window.StoryRuntime.boot({{
        canvas: document.getElementById("stage-2d"),
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
        custom_tags = custom_tags,
        ms_flag = ms_flag,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::story_lint::{lint_story_file, lint_story_json_value};
    use serde_json::json;

    #[test]
    fn keynote_example_json_passes_lint() {
        let example_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(".aetheria")
            .join("skills")
            .join("mg-product-keynote")
            .join("examples")
            .join("story.example.json");
        let rep = lint_story_file(&example_path);
        assert!(rep.valid, "mg-product-keynote story.example.json must pass lint: {:?}", rep.issues);
        assert_eq!(rep.total_shots, 6);
        assert!((rep.total_duration - 24.0).abs() < 0.01);
    }

    #[test]
    fn keynote_negative_cases_emit_structured_codes() {
        let bad = json!({
            "renderer": "2d-product-keynote",
            "theme": "neon-99",
            "canvas": { "w": 1920, "h": 1080, "fps": 30 },
            "shots": [
                {
                    "id": "s1",
                    "start": 0.0,
                    "duration": 4.0,
                    "layout": "hologram",
                    "device": "toaster",
                    "icon": "banana",
                    "transition": "warp",
                    "accentColor": "blue"
                }
            ],
            "captions": { "enabled": false }
        });
        let r = lint_story_json_value(&bad, None, "story.json");
        assert!(!r.valid);
        for code in [
            "STORY_UNKNOWN_THEME",
            "STORY_UNKNOWN_LAYOUT",
            "STORY_UNKNOWN_DEVICE",
            "STORY_UNKNOWN_ICON",
            "STORY_UNKNOWN_TRANSITION",
            "STORY_INVALID_PALETTE",
        ] {
            assert!(r.issues.iter().any(|i| i.code == code), "missing {code}: {:?}", r.issues);
        }
    }

    #[test]
    fn keynote_index_html_passes_film_linter() {
        let html = render_keynote_index_html("Keynote Launch", 1920, 1080, &[], false);
        let lint = crate::studio::motion_linter::lint_html_film(&html);
        assert!(lint.valid, "keynote index.html must pass motion_linter: {:?}", lint.issues);
    }
}
