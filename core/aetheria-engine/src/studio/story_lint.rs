//! Declarative `story.json` pre-render validator and managed HTML shell renderer.
//!
//! Validates schema structure, cast/prop/animation ID references, shot timeline continuity
//! (`start[k+1] == start[k] + duration[k]`), cross-file duration alignment against `film.json`
//! and WAV durations (reusing `film_audio::read_wav_duration_secs`), and valid asset kinds/accessories.
//! Every failure emits structured `{ code, path, hint }` so one edit resolves it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

use crate::paths::contains_path;
use crate::tool::film_audio::read_wav_duration_secs;

pub const VALID_ASSET_KINDS: &[&str] = &[
    "humanoid",
    "flower-row",
    "container",
    "insect",
    "tree",
    "building",
    "vehicle",
    "blob",
];

pub const VALID_HUMANOID_ACCESSORIES: &[&str] = &[
    "hat-conical",
    "hat-cap",
    "towel",
    "glasses",
    "backpack",
    "beard",
    "hijab",
];
pub const VALID_HUMANOID_VARIANTS: &[&str] = &["adult", "kid", "elder", "chubby"];
pub const VALID_BUILDING_VARIANTS: &[&str] = &["shop", "house", "hut", "barn", "apartment", "school"];
pub const VALID_HAIR_STYLES: &[&str] = &["short", "long", "bun", "ponytail", "spiky", "bald"];
pub const VALID_EXPRESSIONS: &[&str] = &["happy", "laugh", "sad", "surprised", "angry", "worried", "sleepy"];
pub const VALID_EMOTES: &[&str] = &["exclaim", "question", "idea", "heart", "sweat", "anger", "sleep", "music"];
pub const VALID_ANIMATIONS: &[&str] = &[
    "idle", "walk", "run", "hop", "grow", "pop-in", "wave", "talk", "point", "cheer", "shock", "work", "nod", "dance",
];
pub const VALID_CAMERA_PRESETS: &[&str] = &["wide", "medium", "close", "dolly-in", "orbit"];
pub const VALID_STAGES: &[&str] = &["city-street", "open-field", "indoor-room"];
pub const VALID_MOODS: &[&str] = &["day", "sunset", "night"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoryLintIssue {
    pub code: String,
    pub path: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryLintReport {
    pub valid: bool,
    pub story_path: String,
    pub total_shots: usize,
    pub custom_shots: usize,
    pub total_duration: f64,
    pub issues: Vec<StoryLintIssue>,
}

fn is_valid_hex_color(s: &str) -> bool {
    let t = s.trim();
    t.len() == 7 && t.starts_with('#') && t[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn push_issue(issues: &mut Vec<StoryLintIssue>, code: &str, path: impl Into<String>, hint: impl Into<String>) {
    issues.push(StoryLintIssue {
        code: code.to_string(),
        path: path.into(),
        hint: hint.into(),
    });
}

fn validate_expression_and_emote(
    obj: &serde_json::Map<String, Value>,
    base: &str,
    issues: &mut Vec<StoryLintIssue>,
) {
    if let Some(ev) = obj.get("expression") {
        let expr = ev.as_str().unwrap_or("");
        if !VALID_EXPRESSIONS.contains(&expr) {
            push_issue(
                issues,
                "STORY_UNKNOWN_EXPRESSION",
                format!("{base}.expression"),
                format!("Unsupported expression '{}'. Allowed: {}.", expr, VALID_EXPRESSIONS.join(", ")),
            );
        }
    }
    if let Some(mv) = obj.get("emote") {
        let em = mv.as_str().unwrap_or("");
        if !em.is_empty() && !VALID_EMOTES.contains(&em) {
            push_issue(
                issues,
                "STORY_UNKNOWN_EMOTE",
                format!("{base}.emote"),
                format!("Unsupported emote '{}'. Allowed: {} (or \"\").", em, VALID_EMOTES.join(", ")),
            );
        }
    }
}

fn validate_actor_list(
    entries: &[Value],
    list_name: &str,
    actor_ids: &mut HashSet<String>,
    issues: &mut Vec<StoryLintIssue>,
) {
    for (idx, item) in entries.iter().enumerate() {
        let base = format!("{}[{}]", list_name, idx);
        let Some(obj) = item.as_object() else {
            push_issue(issues, "STORY_INVALID_ACTOR", base, "Each entry must be an object { id, asset }.");
            continue;
        };
        let id = obj.get("id").and_then(Value::as_str).unwrap_or("").trim();
        if id.is_empty() {
            push_issue(issues, "STORY_INVALID_ACTOR_ID", format!("{base}.id"), "Provide a non-empty string actor id.");
        } else if !actor_ids.insert(id.to_string()) {
            push_issue(
                issues,
                "STORY_DUPLICATE_ACTOR_ID",
                format!("{base}.id"),
                format!("Duplicate actor id '{}'; every cast and prop id must be unique.", id),
            );
        }

        let Some(asset) = obj.get("asset").and_then(Value::as_object) else {
            push_issue(
                issues,
                "STORY_MISSING_ASSET",
                format!("{base}.asset"),
                "Provide an `asset` object with at least `{ kind }`.",
            );
            continue;
        };

        let kind = asset.get("kind").and_then(Value::as_str).unwrap_or("");
        if !VALID_ASSET_KINDS.contains(&kind) {
            push_issue(
                issues,
                "STORY_UNKNOWN_KIND",
                format!("{base}.asset.kind"),
                format!(
                    "Unsupported asset kind '{}'. Use one of: {}.",
                    kind,
                    VALID_ASSET_KINDS.join(", ")
                ),
            );
        }

        if let Some(scale_val) = asset.get("scale") {
            let ok = scale_val
                .as_f64()
                .is_some_and(|s| s.is_finite() && s > 0.1 && s <= 10.0);
            if !ok {
                push_issue(
                    issues,
                    "STORY_INVALID_SCALE",
                    format!("{base}.asset.scale"),
                    "Set `scale` to a finite number in (0.1, 10].",
                );
            }
        }

        if let Some(pal_val) = asset.get("palette") {
            match pal_val.as_object() {
                None => push_issue(
                    issues,
                    "STORY_INVALID_PALETTE",
                    format!("{base}.asset.palette"),
                    "Palette must be an object mapping slot names to 6-digit hex colors (e.g. '#60A5FA').",
                ),
                Some(pal) => {
                    for (k, v) in pal {
                        if !v.as_str().is_some_and(is_valid_hex_color) {
                            push_issue(
                                issues,
                                "STORY_INVALID_PALETTE",
                                format!("{base}.asset.palette.{k}"),
                                "Use a 6-digit hex color string like '#FB923C'.",
                            );
                        }
                    }
                }
            }
        }

        if let Some(acc_val) = asset.get("accessories") {
            match acc_val.as_array() {
                None => push_issue(
                    issues,
                    "STORY_INVALID_ACCESSORIES",
                    format!("{base}.asset.accessories"),
                    "Accessories must be an array of strings.",
                ),
                Some(accs) => {
                    let allowed: &[&str] = if kind == "humanoid" {
                        VALID_HUMANOID_ACCESSORIES
                    } else {
                        &[]
                    };
                    for (ai, av) in accs.iter().enumerate() {
                        let a_str = av.as_str().unwrap_or("");
                        if !allowed.contains(&a_str) {
                            let hint = if allowed.is_empty() {
                                format!("Kind '{}' does not accept accessories; remove accessories or pass [].", kind)
                            } else {
                                format!(
                                    "Unknown accessory '{}' for '{}'. Allowed: {}.",
                                    a_str,
                                    kind,
                                    allowed.join(", ")
                                )
                            };
                            push_issue(
                                issues,
                                "STORY_UNKNOWN_ACCESSORY",
                                format!("{base}.asset.accessories[{ai}]"),
                                hint,
                            );
                        }
                    }
                }
            }
        }

        if let Some(var_val) = asset.get("variant") {
            let v = var_val.as_str().unwrap_or("");
            let allowed: &[&str] = match kind {
                "humanoid" => VALID_HUMANOID_VARIANTS,
                "building" => VALID_BUILDING_VARIANTS,
                _ => &[],
            };
            if !allowed.contains(&v) {
                let hint = if allowed.is_empty() {
                    format!("Kind '{}' has no variants; omit `variant`.", kind)
                } else {
                    format!("Unknown variant '{}' for '{}'. Allowed: {}.", v, kind, allowed.join(", "))
                };
                push_issue(issues, "STORY_UNKNOWN_VARIANT", format!("{base}.asset.variant"), hint);
            }
        }

        if let Some(hair_val) = asset.get("hair") {
            let h = hair_val.as_str().unwrap_or("");
            if kind != "humanoid" || !VALID_HAIR_STYLES.contains(&h) {
                let hint = if kind != "humanoid" {
                    "Only 'humanoid' accepts `hair`.".to_string()
                } else {
                    format!("Unknown hair '{}'. Allowed: {}.", h, VALID_HAIR_STYLES.join(", "))
                };
                push_issue(issues, "STORY_UNKNOWN_HAIR", format!("{base}.asset.hair"), hint);
            }
        }

        validate_expression_and_emote(obj, &base, issues);
    }
}

/// Validates a parsed `story.json` Value and optional sibling files (`film.json`, referenced WAVs).
pub fn lint_story_json_value(
    val: &Value,
    film_dir: Option<&Path>,
    story_path_label: &str,
) -> StoryLintReport {
    let mut issues = Vec::new();
    let Some(root) = val.as_object() else {
        push_issue(&mut issues, "STORY_INVALID_ROOT", "", "Root of story.json must be a JSON object.");
        return StoryLintReport {
            valid: false,
            story_path: story_path_label.to_string(),
            total_shots: 0,
            custom_shots: 0,
            total_duration: 0.0,
            issues,
        };
    };

    // 1. Canvas validation
    match root.get("canvas").and_then(Value::as_object) {
        None => push_issue(
            &mut issues,
            "STORY_INVALID_CANVAS",
            "canvas",
            "Provide `canvas: { w, h, fps }` (e.g. `{ \"w\": 1080, \"h\": 1920, \"fps\": 30 }`).",
        ),
        Some(c) => {
            let w = c.get("w").and_then(Value::as_u64).unwrap_or(0);
            let h = c.get("h").and_then(Value::as_u64).unwrap_or(0);
            let fps = c.get("fps").and_then(Value::as_u64).unwrap_or(0);
            if !(320..=3840).contains(&w) || !(320..=3840).contains(&h) || !(12..=60).contains(&fps) {
                push_issue(
                    &mut issues,
                    "STORY_INVALID_CANVAS",
                    "canvas",
                    "Canvas requires integers `w` and `h` in 320..=3840 and `fps` in 12..=60.",
                );
            }
        }
    }

    // 2. Captions validation
    if root
        .get("captions")
        .and_then(|c| c.get("enabled"))
        .and_then(Value::as_bool)
        .is_none()
    {
        push_issue(
            &mut issues,
            "STORY_INVALID_CAPTIONS",
            "captions.enabled",
            "Set `captions: { \"enabled\": true }` (or `false` for silent/Microstock mode).",
        );
    }

    // Dispatch 2D declarative renderers (`2d-cutout-collage`, `2d-product-keynote`) to their dedicated validators
    match root.get("renderer").and_then(Value::as_str) {
        Some("2d-cutout-collage") => {
            return super::collage_lint::lint_collage_story_value(root, film_dir, story_path_label, issues);
        }
        Some("2d-product-keynote") => {
            return super::keynote_lint::lint_keynote_story_value(root, film_dir, story_path_label, issues);
        }
        _ => {}
    }

    // 3. Cast & Props validation
    let mut actor_ids = HashSet::new();
    match root.get("cast").and_then(Value::as_array) {
        Some(cast) if !cast.is_empty() => validate_actor_list(cast, "cast", &mut actor_ids, &mut issues),
        _ => push_issue(
            &mut issues,
            "STORY_EMPTY_CAST",
            "cast",
            "Provide at least one character in `cast` array.",
        ),
    }
    match root.get("props") {
        Some(Value::Array(props)) => validate_actor_list(props, "props", &mut actor_ids, &mut issues),
        _ => push_issue(
            &mut issues,
            "STORY_INVALID_PROPS",
            "props",
            "Provide a `props` array (may be empty `[]`).",
        ),
    }

    // 4. Shots validation (IDs, continuity, references, camera, stage, actions, custom, WAV alignment)
    let mut total_shots = 0usize;
    let mut custom_shots = 0usize;
    let mut total_duration = 0.0f64;
    let mut shot_ids = HashSet::new();

    match root.get("shots").and_then(Value::as_array) {
        Some(shots) if !shots.is_empty() => {
            total_shots = shots.len();
            let mut expected_start = 0.0f64;

            for (si, shot_val) in shots.iter().enumerate() {
                let sp = format!("shots[{si}]");
                let Some(shot) = shot_val.as_object() else {
                    push_issue(&mut issues, "STORY_INVALID_SHOT", sp, "Each shot must be a JSON object.");
                    continue;
                };

                let sid = shot.get("id").and_then(Value::as_str).unwrap_or("").trim();
                if sid.is_empty() {
                    push_issue(&mut issues, "STORY_INVALID_SHOT_ID", format!("{sp}.id"), "Provide a unique non-empty shot id.");
                } else if !shot_ids.insert(sid.to_string()) {
                    push_issue(
                        &mut issues,
                        "STORY_DUPLICATE_SHOT_ID",
                        format!("{sp}.id"),
                        format!("Duplicate shot id '{}'; rename to a unique id.", sid),
                    );
                }

                let start = shot.get("start").and_then(Value::as_f64);
                let dur = shot.get("duration").and_then(Value::as_f64);
                match (start, dur) {
                    (Some(st), Some(du)) if st.is_finite() && du.is_finite() && st >= 0.0 && du > 0.0 => {
                        if (st - expected_start).abs() > 0.05 {
                            push_issue(
                                &mut issues,
                                "STORY_SHOT_DISCONTINUITY",
                                format!("{sp}.start"),
                                format!(
                                    "Expected start={:.3} to connect cleanly with previous shot (got {:.3}). Set `start: {:.3}`.",
                                    expected_start, st, expected_start
                                ),
                            );
                        }
                        expected_start = st + du;
                        total_duration = expected_start;

                        // Check WAV duration if shot specifies audio.wav (reusing film_audio::read_wav_duration_secs)
                        if let (Some(dir), Some(wav_rel)) = (
                            film_dir,
                            shot_val
                                .pointer("/audio/wav")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|s| !s.is_empty()),
                        ) {
                            let wav_path = dir.join(wav_rel.trim_start_matches('/'));
                            if contains_path(dir, &wav_path) && wav_path.is_file() {
                                if let Ok(wav_dur) = read_wav_duration_secs(&wav_path) {
                                    if du + 0.05 < wav_dur {
                                        push_issue(
                                            &mut issues,
                                            "STORY_AUDIO_TRUNCATION",
                                            format!("{sp}.duration"),
                                            format!(
                                                "Shot duration ({:.2}s) is shorter than WAV '{}' ({:.2}s). Increase `duration` to at least {:.2}s.",
                                                du,
                                                wav_rel,
                                                wav_dur,
                                                wav_dur + 0.6
                                            ),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    _ => push_issue(
                        &mut issues,
                        "STORY_INVALID_SHOT_TIMING",
                        sp.clone(),
                        "Provide finite `start >= 0` and `duration > 0` on every shot.",
                    ),
                }

                // Focus reference(s)
                match shot.get("focus") {
                    Some(Value::String(fid)) if !fid.trim().is_empty() => {
                        if !actor_ids.contains(fid.trim()) {
                            push_issue(
                                &mut issues,
                                "STORY_UNKNOWN_FOCUS",
                                format!("{sp}.focus"),
                                format!("Focus id '{}' is not declared in `cast` or `props`.", fid),
                            );
                        }
                    }
                    Some(Value::Array(arr)) if !arr.is_empty() => {
                        for (fi, fv) in arr.iter().enumerate() {
                            let fid = fv.as_str().unwrap_or("").trim();
                            if fid.is_empty() || !actor_ids.contains(fid) {
                                push_issue(
                                    &mut issues,
                                    "STORY_UNKNOWN_FOCUS",
                                    format!("{sp}.focus[{fi}]"),
                                    format!("Focus id '{}' is not declared in `cast` or `props`.", fid),
                                );
                            }
                        }
                    }
                    _ => push_issue(
                        &mut issues,
                        "STORY_UNKNOWN_FOCUS",
                        format!("{sp}.focus"),
                        "Set `focus` to an actor id string or non-empty array of actor ids from `cast`/`props`.",
                    ),
                }

                // Camera preset
                let preset = shot_val
                    .pointer("/camera/preset")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !VALID_CAMERA_PRESETS.contains(&preset) {
                    push_issue(
                        &mut issues,
                        "STORY_UNKNOWN_CAMERA_PRESET",
                        format!("{sp}.camera.preset"),
                        format!(
                            "Invalid camera preset '{}'. Allowed: {}.",
                            preset,
                            VALID_CAMERA_PRESETS.join(", ")
                        ),
                    );
                }

                // Stage & optional mood preset
                let stage = shot.get("stage").and_then(Value::as_str).unwrap_or("");
                if !VALID_STAGES.contains(&stage) {
                    push_issue(
                        &mut issues,
                        "STORY_UNKNOWN_STAGE",
                        format!("{sp}.stage"),
                        format!("Invalid stage '{}'. Allowed: {}.", stage, VALID_STAGES.join(", ")),
                    );
                }
                if let Some(mood_val) = shot.get("mood") {
                    let mood = mood_val.as_str().unwrap_or("");
                    if !VALID_MOODS.contains(&mood) {
                        push_issue(
                            &mut issues,
                            "STORY_UNKNOWN_MOOD",
                            format!("{sp}.mood"),
                            format!("Invalid mood '{}'. Allowed: {}.", mood, VALID_MOODS.join(", ")),
                        );
                    }
                }

                // Placements ID + expression/emote check
                if let Some(pls) = shot.get("placements").and_then(Value::as_object) {
                    for (pid, pval) in pls {
                        if !actor_ids.contains(pid) {
                            push_issue(
                                &mut issues,
                                "STORY_UNKNOWN_PLACEMENT_ID",
                                format!("{sp}.placements.{pid}"),
                                format!("Placement target '{}' is not declared in `cast` or `props`.", pid),
                            );
                        }
                        if let Some(pobj) = pval.as_object() {
                            validate_expression_and_emote(pobj, &format!("{sp}.placements.{pid}"), &mut issues);
                        }
                    }
                }

                // Actions check
                match shot.get("actions").and_then(Value::as_array) {
                    None => push_issue(
                        &mut issues,
                        "STORY_INVALID_ACTIONS",
                        format!("{sp}.actions"),
                        "Provide an `actions` array (may be empty `[]`).",
                    ),
                    Some(acts) => {
                        let shot_dur = dur.unwrap_or(0.0);
                        for (ai, av) in acts.iter().enumerate() {
                            let ap = format!("{sp}.actions[{ai}]");
                            let target = av.get("target").and_then(Value::as_str).unwrap_or("");
                            if !actor_ids.contains(target) {
                                push_issue(
                                    &mut issues,
                                    "STORY_UNKNOWN_ACTION_TARGET",
                                    format!("{ap}.target"),
                                    format!("Action target '{}' is not declared in `cast` or `props`.", target),
                                );
                            }
                            let anim = av.get("anim").and_then(Value::as_str).unwrap_or("");
                            if !VALID_ANIMATIONS.contains(&anim) {
                                push_issue(
                                    &mut issues,
                                    "STORY_UNKNOWN_ANIMATION",
                                    format!("{ap}.anim"),
                                    format!(
                                        "Unsupported animation '{}'. Allowed: {}.",
                                        anim,
                                        VALID_ANIMATIONS.join(", ")
                                    ),
                                );
                            }
                            let at = av.get("at").and_then(Value::as_f64);
                            let adur = av.get("dur").and_then(Value::as_f64);
                            if !matches!((at, adur), (Some(a), Some(d)) if a >= 0.0 && d > 0.0 && (shot_dur <= 0.0 || a < shot_dur)) {
                                push_issue(
                                    &mut issues,
                                    "STORY_INVALID_ACTION_WINDOW",
                                    ap.clone(),
                                    "Set `at >= 0` (less than shot duration) and `dur > 0`.",
                                );
                            }
                            for pos_key in ["from", "to"] {
                                if let Some(pv) = av.get(pos_key) {
                                    let valid_vec3 = pv
                                        .as_array()
                                        .map(|arr| {
                                            arr.len() == 3
                                                && arr.iter().all(|v| v.as_f64().map(|n| n.is_finite()).unwrap_or(false))
                                        })
                                        .unwrap_or(false);
                                    if !valid_vec3 {
                                        push_issue(
                                            &mut issues,
                                            "STORY_INVALID_ACTION_POS",
                                            format!("{ap}.{pos_key}"),
                                            format!("`{pos_key}` must be a 3-number [x, y, z] position array."),
                                        );
                                    }
                                }
                            }
                            if let Some(aobj) = av.as_object() {
                                validate_expression_and_emote(aobj, &ap, &mut issues);
                            }
                        }
                    }
                }

                // Custom escape-hatch check
                if let Some(custom_val) = shot.get("custom") {
                    if let Some(custom_str) = custom_val.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                        custom_shots += 1;
                        let norm = custom_str.replace('\\', "/");
                        if !norm.starts_with("script/") || !norm.ends_with(".js") || norm.contains("..") {
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
        }
        _ => push_issue(
            &mut issues,
            "STORY_EMPTY_SHOTS",
            "shots",
            "Provide at least one shot in `shots` array.",
        ),
    }

    // 5. Cross-check total duration against sibling film.json when present
    if let Some(dir) = film_dir {
        let film_json_path = dir.join("film.json");
        if film_json_path.is_file() {
            if let Ok(raw) = std::fs::read_to_string(&film_json_path) {
                if let Ok(fj) = serde_json::from_str::<Value>(&raw) {
                    if let Some(f_scenes) = fj.get("scenes").and_then(Value::as_array) {
                        let film_total: f64 = f_scenes
                            .iter()
                            .filter_map(|s| s.get("duration").and_then(Value::as_f64))
                            .sum();
                        if film_total > 0.0 && total_duration > 0.0 && (film_total - total_duration).abs() > 0.25 {
                            push_issue(
                                &mut issues,
                                "STORY_FILM_DURATION_MISMATCH",
                                "shots",
                                format!(
                                    "Story total duration ({:.2}s) differs from film.json total ({:.2}s). Align shot durations with film.json / audio WAVs.",
                                    total_duration, film_total
                                ),
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

/// Reads and validates a `story.json` file on disk.
pub fn lint_story_file(story_path: &Path) -> StoryLintReport {
    let label = story_path.to_string_lossy().to_string();
    let raw = match std::fs::read_to_string(story_path) {
        Ok(s) => s,
        Err(e) => {
            return StoryLintReport {
                valid: false,
                story_path: label,
                total_shots: 0,
                custom_shots: 0,
                total_duration: 0.0,
                issues: vec![StoryLintIssue {
                    code: "STORY_READ_ERROR".to_string(),
                    path: String::new(),
                    hint: format!("Failed to read story.json: {}", e),
                }],
            };
        }
    };
    let val: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return StoryLintReport {
                valid: false,
                story_path: label,
                total_shots: 0,
                custom_shots: 0,
                total_duration: 0.0,
                issues: vec![StoryLintIssue {
                    code: "STORY_JSON_PARSE_ERROR".to_string(),
                    path: String::new(),
                    hint: format!("Fix JSON syntax error in story.json: {}", e),
                }],
            };
        }
    };
    lint_story_json_value(&val, story_path.parent(), &label)
}

pub fn render_story_index_html_for_renderer(
    renderer: &str,
    title: &str,
    width: u32,
    height: u32,
    custom_scripts: &[String],
    is_microstock: bool,
) -> String {
    if renderer == "2d-cutout-collage" {
        return super::collage_lint::render_collage_index_html(title, width, height, custom_scripts, is_microstock);
    }
    if renderer == "2d-product-keynote" {
        return super::keynote_lint::render_keynote_index_html(title, width, height, custom_scripts, is_microstock);
    }
    render_story_index_html(title, width, height, custom_scripts, is_microstock)
}

/// Renders a minimal managed `index.html` for declarative `story.json` projects so models
/// do not hand-write `index.html` or `scene*.js`.
pub fn render_story_index_html(
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
    html, body {{ margin: 0; padding: 0; width: {w}px; height: {h}px; overflow: hidden; background: #93C5FD; font-family: "Inter", sans-serif; }}
    #stage {{ position: relative; width: {w}px; height: {h}px; background: linear-gradient(180deg, #93C5FD 0%, #BAE6FD 48%, #E0F2FE 100%); }}
    #stage canvas {{ position: absolute; inset: 0; width: {w}px; height: {h}px; display: block; }}
  </style>
  <script src="/script/three.min.js"></script>
  <script src="/script/aetheria-motion.js"></script>
  <script src="/script/clay-kit.js"></script>
  <script src="/script/clay-buildings.js"></script>
  <script src="/script/clay-people.js"></script>
  <script src="/script/clay-gestures.js"></script>
  <script src="/script/clay-assets.js"></script>
  <script src="/script/story-runtime.js"></script>
{custom_tags}</head>
<body>
  <div id="stage">
    <canvas id="stage-webgl" width="{w}" height="{h}"></canvas>
    <canvas id="stage-hud" width="{w}" height="{h}"></canvas>
  </div>
  <script>
    (function () {{
      window.__filmMeta = {{ title: "{title}", width: {w}, height: {h}, fps: 30, duration: 1, scenes: [] }};
      window.renderAt = function () {{}};
      window.__ready = false;
      window.StoryRuntime.boot({{
        glCanvas: document.getElementById("stage-webgl"),
        hudCanvas: document.getElementById("stage-hud"),
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
        ms_flag = ms_flag
    )
}

/// Returns one midpoint timestamp (`start + duration * 0.5`) per shot from `story.json`.
pub fn story_shot_midpoints(story_path: &Path) -> Vec<(String, f64)> {
    let Ok(raw) = std::fs::read_to_string(story_path) else {
        return Vec::new();
    };
    let Ok(val) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let Some(shots) = val.get("shots").and_then(Value::as_array) else {
        return Vec::new();
    };
    shots
        .iter()
        .enumerate()
        .filter_map(|(i, sh)| {
            let id = sh
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("shot{}", i + 1));
            let st = sh.get("start").and_then(Value::as_f64)?;
            let du = sh.get("duration").and_then(Value::as_f64)?;
            if st.is_finite() && du.is_finite() && du > 0.0 {
                Some((id, ((st + du * 0.5) * 1000.0).round() / 1000.0))
            } else {
                None
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorySnapshotMeta {
    lint_ok: bool,
    failed_shots: usize,
    runtime_errors: usize,
}

impl StorySnapshotMeta {
    fn is_worse_than(&self, best: &StorySnapshotMeta) -> bool {
        if best.lint_ok && !self.lint_ok {
            return true;
        }
        if self.lint_ok == best.lint_ok && self.runtime_errors > best.runtime_errors {
            return true;
        }
        if self.lint_ok == best.lint_ok
            && self.runtime_errors == best.runtime_errors
            && self.failed_shots > best.failed_shots
        {
            return true;
        }
        false
    }
}

/// Persists the best `story.json` snapshot in `.aetheria/preview/` and automatically restores it
/// if a correction pass worsens lint validity, runtime error count, or failed framing shot count.
/// Returns `true` if `story.json` was rolled back.
pub fn reconcile_story_snapshot_and_rollback(
    film_dir: &Path,
    lint_ok: bool,
    failed_shots: usize,
    runtime_errors: usize,
) -> bool {
    let story_path = film_dir.join("story.json");
    if !contains_path(film_dir, &story_path) || !story_path.is_file() {
        return false;
    }
    let preview_dir = film_dir.join(".aetheria").join("preview");
    if !contains_path(film_dir, &preview_dir) {
        return false;
    }
    let _ = std::fs::create_dir_all(&preview_dir);
    let best_story_path = preview_dir.join("best_story.json");
    let best_meta_path = preview_dir.join("best_story_meta.json");

    let cur = StorySnapshotMeta {
        lint_ok,
        failed_shots,
        runtime_errors,
    };

    if best_meta_path.is_file() && best_story_path.is_file() {
        if let Ok(raw_meta) = std::fs::read_to_string(&best_meta_path) {
            if let Ok(best) = serde_json::from_str::<StorySnapshotMeta>(&raw_meta) {
                if cur.is_worse_than(&best) {
                    if let Ok(best_bytes) = std::fs::read(&best_story_path) {
                        let _ = std::fs::write(&story_path, best_bytes);
                        return true;
                    }
                }
            }
        }
    }

    if let Ok(cur_bytes) = std::fs::read(&story_path) {
        let _ = std::fs::write(&best_story_path, cur_bytes);
        if let Ok(meta_str) = serde_json::to_string_pretty(&cur) {
            let _ = std::fs::write(&best_meta_path, meta_str);
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn minimal_valid_story() -> Value {
        json!({
            "title": "Test Story",
            "canvas": { "w": 1080, "h": 1920, "fps": 30 },
            "cast": [
                { "id": "petani", "asset": { "kind": "humanoid", "accessories": ["hat-conical", "towel"], "palette": { "primary": "#60A5FA" }, "scale": 1.0 } }
            ],
            "props": [
                { "id": "bunga", "asset": { "kind": "flower-row", "scale": 1.0 } }
            ],
            "shots": [
                {
                    "id": "shot1",
                    "start": 0.0,
                    "duration": 4.0,
                    "focus": "petani",
                    "camera": { "preset": "wide" },
                    "stage": "open-field",
                    "actions": [{ "target": "petani", "anim": "idle", "at": 0.0, "dur": 4.0 }]
                },
                {
                    "id": "shot2",
                    "start": 4.0,
                    "duration": 4.0,
                    "focus": ["petani", "bunga"],
                    "camera": { "preset": "medium" },
                    "stage": "open-field",
                    "actions": [{ "target": "bunga", "anim": "grow", "at": 0.0, "dur": 3.5 }]
                }
            ],
            "captions": { "enabled": true }
        })
    }

    #[test]
    fn positive_example_story_file_passes_lint() {
        let example_path = crate::paths::project_root()
            .join(".aetheria")
            .join("skills")
            .join("mg-soft-clay-story")
            .join("examples")
            .join("story.example.json");
        let rep = lint_story_file(&example_path);
        assert!(rep.valid, "story.example.json should pass lint, got: {:?}", rep.issues);
        assert_eq!(rep.total_shots, 6);
        assert_eq!(rep.custom_shots, 0);
        assert!((rep.total_duration - 30.0).abs() < 0.01);
    }

    #[test]
    fn negative_tests_cover_each_structured_error_code() {
        // 1. STORY_INVALID_CANVAS
        let mut s = minimal_valid_story();
        s["canvas"]["fps"] = json!(5);
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_INVALID_CANVAS" && i.path == "canvas"));

        // 2. STORY_UNKNOWN_KIND
        let mut s = minimal_valid_story();
        s["cast"][0]["asset"]["kind"] = json!("spaceship");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_KIND" && i.path == "cast[0].asset.kind"));

        // 3. STORY_UNKNOWN_ACCESSORY
        let mut s = minimal_valid_story();
        s["cast"][0]["asset"]["accessories"] = json!(["jetpack"]);
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_ACCESSORY"));

        // 4. STORY_DUPLICATE_ACTOR_ID
        let mut s = minimal_valid_story();
        s["props"][0]["id"] = json!("petani");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_DUPLICATE_ACTOR_ID"));

        // 5. STORY_SHOT_DISCONTINUITY
        let mut s = minimal_valid_story();
        s["shots"][1]["start"] = json!(5.5);
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_SHOT_DISCONTINUITY" && i.hint.contains("4.000")));

        // 6. STORY_UNKNOWN_FOCUS
        let mut s = minimal_valid_story();
        s["shots"][0]["focus"] = json!("ghost_actor");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_FOCUS" && i.path == "shots[0].focus"));

        // 7. STORY_UNKNOWN_CAMERA_PRESET
        let mut s = minimal_valid_story();
        s["shots"][0]["camera"]["preset"] = json!("drone-360");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_CAMERA_PRESET"));

        // 8. STORY_UNKNOWN_STAGE
        let mut s = minimal_valid_story();
        s["shots"][0]["stage"] = json!("mars");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_STAGE"));

        // 9. STORY_UNKNOWN_ACTION_TARGET & STORY_UNKNOWN_ANIMATION
        let mut s = minimal_valid_story();
        s["shots"][0]["actions"][0]["target"] = json!("missing_id");
        s["shots"][0]["actions"][0]["anim"] = json!("backflip");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_ACTION_TARGET"));
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_ANIMATION"));

        // 9b. Valid walk with from/to passes; invalid action `to` triggers STORY_INVALID_ACTION_POS
        let mut s = minimal_valid_story();
        s["shots"][0]["actions"][0]["anim"] = json!("walk");
        s["shots"][0]["actions"][0]["from"] = json!([-1.2, 0.0, 0.0]);
        s["shots"][0]["actions"][0]["to"] = json!([0.4, 0.0, 1.6]);
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.valid, "valid walk action with from/to must pass: {:?}", r.issues);

        s["shots"][0]["actions"][0]["to"] = json!([0.4, 0.0]);
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_INVALID_ACTION_POS" && i.path == "shots[0].actions[0].to"));

        // 9c. Variety validation: variant, hair, expression, emote, mood
        let mut s = minimal_valid_story();
        s["cast"][0]["asset"]["variant"] = json!("giant");
        s["cast"][0]["asset"]["hair"] = json!("mohawk");
        s["shots"][0]["mood"] = json!("eclipse");
        s["shots"][0]["actions"][0]["expression"] = json!("furious");
        s["shots"][0]["actions"][0]["emote"] = json!("rainbow");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_VARIANT"));
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_HAIR"));
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_MOOD"));
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_EXPRESSION"));
        assert!(r.issues.iter().any(|i| i.code == "STORY_UNKNOWN_EMOTE"));

        // 10. STORY_INVALID_CUSTOM_PATH
        let mut s = minimal_valid_story();
        s["shots"][0]["custom"] = json!("../evil.js");
        let r = lint_story_json_value(&s, None, "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_INVALID_CUSTOM_PATH"));

        // 11. STORY_FILM_DURATION_MISMATCH + STORY_AUDIO_TRUNCATION with temp dir + real WAV
        let tmp = std::env::temp_dir().join(format!("aetheria-story-lint-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::create_dir_all(tmp.join("audio"));
        // Write valid 5.0s PCM WAV header (8000 Hz mono 16-bit -> 16000 B/s -> 80000 bytes data)
        let data_len: u32 = 80_000;
        let mut wav = Vec::with_capacity(44 + data_len as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_len).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&8000u32.to_le_bytes());
        wav.extend_from_slice(&16000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_len.to_le_bytes());
        wav.resize(44 + data_len as usize, 0);
        std::fs::write(tmp.join("audio").join("s1.wav"), &wav).unwrap();
        std::fs::write(
            tmp.join("film.json"),
            serde_json::to_string(&json!({ "scenes": [{ "id": "shot1", "duration": 12.0 }] })).unwrap(),
        )
        .unwrap();

        let mut s = minimal_valid_story();
        s["shots"][0]["audio"] = json!({ "wav": "audio/s1.wav" });
        let r = lint_story_json_value(&s, Some(&tmp), "story.json");
        assert!(r.issues.iter().any(|i| i.code == "STORY_AUDIO_TRUNCATION"));
        assert!(r.issues.iter().any(|i| i.code == "STORY_FILM_DURATION_MISMATCH"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn story_index_html_passes_film_linter() {
        let html = render_story_index_html("Petani Story", 1080, 1920, &[], false);
        let lint = crate::studio::motion_linter::lint_html_film(&html);
        assert!(lint.valid, "story index.html must pass motion_linter: {:?}", lint.issues);
        assert!(lint.has_render_at && lint.has_ready_flag && lint.has_film_meta);
    }

    #[test]
    fn story_snapshot_auto_rolls_back_when_validation_worsens() {
        let tmp = std::env::temp_dir().join(format!("aetheria-story-rb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let story_path = tmp.join("story.json");
        std::fs::write(&story_path, "{\"title\":\"good\"}").unwrap();

        // First clean snapshot saved
        assert!(!reconcile_story_snapshot_and_rollback(&tmp, true, 0, 0));
        // Mutate to broken edit -> must roll back
        std::fs::write(&story_path, "{\"title\":\"broken\"}").unwrap();
        assert!(reconcile_story_snapshot_and_rollback(&tmp, true, 2, 0));
        assert_eq!(std::fs::read_to_string(&story_path).unwrap(), "{\"title\":\"good\"}");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
