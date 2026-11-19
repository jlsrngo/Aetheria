//! Declarative 2D Cutout Collage (`renderer: "2d-cutout-collage"`) validator & managed HTML renderer.
//!
//! Dispatched automatically from `story_lint::lint_story_json_value` when `story.json` declares
//! `"renderer": "2d-cutout-collage"`, reusing `StoryLintReport` / `StoryLintIssue` and
//! `film_audio::read_wav_duration_secs` with zero duplication.

use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

use super::story_checks::{self, push_issue};
use super::story_lint::{StoryLintIssue, StoryLintReport};

pub const VALID_COLLAGE_LAYOUTS: &[&str] = &[
    "dossier-hero",
    "split-compare",
    "evidence-board",
    "stat-callout",
    "timeline-strip",
    "quote-scrap",
];
pub const VALID_COLLAGE_PAPERS: &[&str] = &["kraft", "newsprint", "corkboard", "charcoal", "scrapbook"];
pub const VALID_COLLAGE_CUTOUTS: &[&str] = &[
    "portrait", "brain", "globe", "rocket", "eye", "hand-point", "rose", "clock",
    "gear", "megaphone", "book", "coin", "chart", "lightbulb", "phone", "camera",
];
pub const VALID_COLLAGE_ACCENTS: &[&str] = &[
    "rose", "manicule", "gear", "wax-seal", "star", "arrow", "paperclip", "scissors",
];
pub const VALID_COLLAGE_TRANSITIONS: &[&str] = &["tear-wipe", "cut"];

fn is_hex(s: &str) -> bool {
    let t = s.trim();
    t.len() == 7 && t.starts_with('#') && t[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn lint_collage_story_value(
    root: &serde_json::Map<String, Value>,
    film_dir: Option<&Path>,
    story_path_label: &str,
    mut issues: Vec<StoryLintIssue>,
) -> StoryLintReport {
    if let Some(th) = root.get("theme") {
        let s = th.as_str().unwrap_or("");
        if !VALID_COLLAGE_PAPERS.contains(&s) {
            push_issue(
                &mut issues,
                "STORY_UNKNOWN_PAPER",
                "theme",
                format!("Invalid theme '{}'. Allowed: {}.", s, VALID_COLLAGE_PAPERS.join(", ")),
            );
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
                if !VALID_COLLAGE_LAYOUTS.contains(&layout) {
                    push_issue(
                        &mut issues,
                        "STORY_UNKNOWN_LAYOUT",
                        format!("{sp}.layout"),
                        format!("Invalid collage layout '{}'. Allowed: {}.", layout, VALID_COLLAGE_LAYOUTS.join(", ")),
                    );
                }

                if let Some(pv) = shot.get("paper") {
                    let p = pv.as_str().unwrap_or("");
                    if !VALID_COLLAGE_PAPERS.contains(&p) {
                        push_issue(
                            &mut issues,
                            "STORY_UNKNOWN_PAPER",
                            format!("{sp}.paper"),
                            format!("Invalid paper '{}'. Allowed: {}.", p, VALID_COLLAGE_PAPERS.join(", ")),
                        );
                    }
                }

                if let Some(cv) = shot.get("cutout") {
                    let c = cv.as_str().unwrap_or("");
                    if !VALID_COLLAGE_CUTOUTS.contains(&c) {
                        push_issue(
                            &mut issues,
                            "STORY_UNKNOWN_CUTOUT",
                            format!("{sp}.cutout"),
                            format!("Invalid cutout '{}'. Allowed: {}.", c, VALID_COLLAGE_CUTOUTS.join(", ")),
                        );
                    }
                }

                for ckey in ["accentColor", "secondaryColor"] {
                    if let Some(cv) = shot.get(ckey) {
                        if !cv.as_str().is_some_and(is_hex) {
                            push_issue(&mut issues, "STORY_INVALID_PALETTE", format!("{sp}.{ckey}"), "Use a 6-digit hex color like '#C0392B'.");
                        }
                    }
                }

                if let Some(accs) = shot.get("accents").and_then(Value::as_array) {
                    for (ai, av) in accs.iter().enumerate() {
                        let a = av.as_str().unwrap_or("");
                        if !VALID_COLLAGE_ACCENTS.contains(&a) {
                            push_issue(
                                &mut issues,
                                "STORY_UNKNOWN_ACCENT",
                                format!("{sp}.accents[{ai}]"),
                                format!("Invalid accent '{}'. Allowed: {}.", a, VALID_COLLAGE_ACCENTS.join(", ")),
                            );
                        }
                    }
                }

                if let Some(items) = shot.get("items").and_then(Value::as_array) {
                    for (ii, iv) in items.iter().enumerate() {
                        if let Some(ic) = iv.get("cutout").and_then(Value::as_str) {
                            if !VALID_COLLAGE_CUTOUTS.contains(&ic) {
                                push_issue(
                                    &mut issues,
                                    "STORY_UNKNOWN_CUTOUT",
                                    format!("{sp}.items[{ii}].cutout"),
                                    format!("Invalid item cutout '{}'. Allowed: {}.", ic, VALID_COLLAGE_CUTOUTS.join(", ")),
                                );
                            }
                        }
                    }
                }

                if let Some(tv) = shot.get("transition") {
                    let tr = tv.as_str().unwrap_or("");
                    if !VALID_COLLAGE_TRANSITIONS.contains(&tr) {
                        push_issue(
                            &mut issues,
                            "STORY_UNKNOWN_TRANSITION",
                            format!("{sp}.transition"),
                            format!("Invalid transition '{}'. Allowed: {}.", tr, VALID_COLLAGE_TRANSITIONS.join(", ")),
                        );
                    }
                }

            story_checks::check_custom_script_path(shot, &sp, &mut custom_shots, &mut issues);
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

pub fn render_collage_index_html(
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
    html, body {{ margin: 0; padding: 0; width: {w}px; height: {h}px; overflow: hidden; background: #D7BE9B; font-family: "Inter", sans-serif; }}
    #stage {{ position: relative; width: {w}px; height: {h}px; }}
    #stage canvas {{ position: absolute; inset: 0; width: {w}px; height: {h}px; display: block; }}
  </style>
  <script src="/script/aetheria-motion.js"></script>
  <script src="/script/collage-kit.js"></script>
  <script src="/script/collage-layouts.js"></script>
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
    fn collage_example_json_passes_lint() {
        let example_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(".aetheria")
            .join("skills")
            .join("mg-cutout-collage")
            .join("examples")
            .join("story.example.json");
        let rep = lint_story_file(&example_path);
        assert!(rep.valid, "mg-cutout-collage story.example.json must pass lint: {:?}", rep.issues);
        assert_eq!(rep.total_shots, 6);
        assert_eq!(rep.custom_shots, 0);
        assert!((rep.total_duration - 30.0).abs() < 0.01);
    }

    #[test]
    fn collage_negative_cases_emit_structured_codes() {
        let bad = json!({
            "renderer": "2d-cutout-collage",
            "theme": "plastic",
            "canvas": { "w": 1080, "h": 1920, "fps": 30 },
            "shots": [
                {
                    "id": "s1",
                    "start": 0.0,
                    "duration": 4.0,
                    "layout": "spiral-3d",
                    "paper": "metal",
                    "cutout": "unicorn",
                    "accents": ["laser"],
                    "transition": "explode",
                    "accentColor": "red"
                },
                {
                    "id": "s2",
                    "start": 5.5,
                    "duration": 4.0,
                    "layout": "dossier-hero"
                }
            ],
            "captions": { "enabled": true }
        });
        let r = lint_story_json_value(&bad, None, "story.json");
        assert!(!r.valid);
        for code in [
            "STORY_UNKNOWN_PAPER",
            "STORY_UNKNOWN_LAYOUT",
            "STORY_UNKNOWN_CUTOUT",
            "STORY_UNKNOWN_ACCENT",
            "STORY_UNKNOWN_TRANSITION",
            "STORY_INVALID_PALETTE",
            "STORY_SHOT_DISCONTINUITY",
        ] {
            assert!(r.issues.iter().any(|i| i.code == code), "missing {code}: {:?}", r.issues);
        }
    }

    #[test]
    fn collage_index_html_passes_film_linter() {
        let html = render_collage_index_html("Collage Film", 1080, 1920, &[], false);
        let lint = crate::studio::motion_linter::lint_html_film(&html);
        assert!(lint.valid, "collage index.html must pass motion_linter: {:?}", lint.issues);
        assert!(lint.has_render_at && lint.has_ready_flag && lint.has_film_meta);
    }
}
