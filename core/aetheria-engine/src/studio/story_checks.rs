//! Shared `story.json` validation checks used by `story_lint`, `generic_kit_lint`,
//! `collage_lint`, and `keynote_lint`.
//!
//! Single emission site for common issue codes:
//! - `STORY_EMPTY_SHOTS`, `STORY_INVALID_SHOT`, `STORY_INVALID_SHOT_ID`, `STORY_DUPLICATE_SHOT_ID`
//! - `STORY_INVALID_SHOT_TIMING`, `STORY_SHOT_DISCONTINUITY`, `STORY_AUDIO_TRUNCATION`
//! - `STORY_INVALID_CUSTOM_PATH`, `STORY_FILM_DURATION_MISMATCH`
//! - `STORY_KIT_LIMIT_EXCEEDED` (enforcing `kit.json` `limits`)

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::path::Path;

use super::story_lint::StoryLintIssue;
use crate::paths::contains_path;
use crate::tool::film_audio::read_wav_duration_secs;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitLimits {
    #[serde(default)]
    pub min_shots: Option<usize>,
    #[serde(default)]
    pub max_shots: Option<usize>,
    #[serde(default)]
    pub min_duration_sec: Option<f64>,
    #[serde(default)]
    pub max_duration_sec: Option<f64>,
    #[serde(default)]
    pub max_headline_chars: Option<usize>,
    #[serde(default)]
    pub max_subtext_chars: Option<usize>,
    #[serde(default)]
    pub max_items: Option<usize>,
}

pub fn push_issue(
    issues: &mut Vec<StoryLintIssue>,
    code: &str,
    path: impl Into<String>,
    hint: impl Into<String>,
) {
    issues.push(StoryLintIssue {
        code: code.to_string(),
        path: path.into(),
        hint: hint.into(),
    });
}

/// Validates that a script path matches `script/<name>.js` without path traversal (`..`).
pub fn is_safe_script_rel(raw: &str) -> Option<String> {
    let clean = raw.trim().trim_start_matches('/').replace('\\', "/");
    if clean.starts_with("script/") && clean.ends_with(".js") && !clean.contains("..") {
        Some(clean)
    } else {
        None
    }
}

/// Returns the non-empty `shots` array or emits `STORY_EMPTY_SHOTS`.
pub fn require_shots_array<'a>(
    root: &'a Map<String, Value>,
    issues: &mut Vec<StoryLintIssue>,
) -> Option<&'a Vec<Value>> {
    match root.get("shots").and_then(Value::as_array) {
        Some(shots) if !shots.is_empty() => Some(shots),
        _ => {
            push_issue(
                issues,
                "STORY_EMPTY_SHOTS",
                "shots",
                "Provide at least one shot in `shots` array.",
            );
            None
        }
    }
}

/// Ensures a shot entry is a JSON object or emits `STORY_INVALID_SHOT`.
pub fn require_shot_object<'a>(
    shot_val: &'a Value,
    sp: &str,
    issues: &mut Vec<StoryLintIssue>,
) -> Option<&'a Map<String, Value>> {
    match shot_val.as_object() {
        Some(obj) => Some(obj),
        None => {
            push_issue(
                issues,
                "STORY_INVALID_SHOT",
                sp.to_string(),
                "Each shot must be a JSON object.",
            );
            None
        }
    }
}

/// Validates a shot's `id` is non-empty and unique (`STORY_INVALID_SHOT_ID` / `STORY_DUPLICATE_SHOT_ID`).
pub fn check_shot_id(
    shot: &Map<String, Value>,
    sp: &str,
    seen_ids: &mut HashSet<String>,
    issues: &mut Vec<StoryLintIssue>,
) -> String {
    let sid = shot.get("id").and_then(Value::as_str).unwrap_or("").trim();
    if sid.is_empty() {
        push_issue(
            issues,
            "STORY_INVALID_SHOT_ID",
            format!("{sp}.id"),
            "Provide a unique non-empty shot id.",
        );
    } else if !seen_ids.insert(sid.to_string()) {
        push_issue(
            issues,
            "STORY_DUPLICATE_SHOT_ID",
            format!("{sp}.id"),
            format!("Duplicate shot id '{}'; rename to a unique id.", sid),
        );
    }
    sid.to_string()
}

/// Validates shot timing (`start >= 0`, `duration > 0`), timeline continuity (`tolerance_sec`),
/// and optional sibling WAV duration alignment (`STORY_INVALID_SHOT_TIMING`,
/// `STORY_SHOT_DISCONTINUITY`, `STORY_AUDIO_TRUNCATION`). Returns `Option<duration>`.
pub fn check_shot_timing_and_wav(
    shot_val: &Value,
    shot: &Map<String, Value>,
    sid: &str,
    sp: &str,
    expected_start: &mut f64,
    total_duration: &mut f64,
    tolerance_sec: f64,
    film_dir: Option<&Path>,
    issues: &mut Vec<StoryLintIssue>,
) -> Option<f64> {
    let start = shot.get("start").and_then(Value::as_f64);
    let dur = shot.get("duration").and_then(Value::as_f64);
    match (start, dur) {
        (Some(st), Some(du)) if st.is_finite() && du.is_finite() && st >= 0.0 && du > 0.0 => {
            if (st - *expected_start).abs() > tolerance_sec {
                push_issue(
                    issues,
                    "STORY_SHOT_DISCONTINUITY",
                    format!("{sp}.start"),
                    format!(
                        "Shot '{}' starts at {:.3}s, expected {:.3}s.",
                        sid, st, *expected_start
                    ),
                );
            }
            *expected_start = st + du;
            *total_duration = *expected_start;

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
                                issues,
                                "STORY_AUDIO_TRUNCATION",
                                format!("{sp}.duration"),
                                format!(
                                    "Shot duration ({:.2}s) is shorter than WAV '{}' ({:.2}s).",
                                    du, wav_rel, wav_dur
                                ),
                            );
                        }
                    }
                }
            }
            Some(du)
        }
        _ => {
            push_issue(
                issues,
                "STORY_INVALID_SHOT_TIMING",
                sp.to_string(),
                "Provide finite `start >= 0` and `duration > 0`.",
            );
            None
        }
    }
}

/// Checks optional `shot.custom` escape-hatch path hygiene (`STORY_INVALID_CUSTOM_PATH`).
pub fn check_custom_script_path(
    shot: &Map<String, Value>,
    sp: &str,
    custom_shots: &mut usize,
    issues: &mut Vec<StoryLintIssue>,
) {
    if let Some(custom_str) = shot
        .get("custom")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        *custom_shots += 1;
        if is_safe_script_rel(custom_str).is_none() {
            push_issue(
                issues,
                "STORY_INVALID_CUSTOM_PATH",
                format!("{sp}.custom"),
                "Custom shot script must match `script/<name>.js` without `..`.",
            );
        }
    }
}

/// Cross-checks story total duration against sibling `film.json` (`STORY_FILM_DURATION_MISMATCH`).
pub fn check_film_duration_alignment(
    film_dir: Option<&Path>,
    total_duration: f64,
    issues: &mut Vec<StoryLintIssue>,
) {
    let Some(dir) = film_dir else {
        return;
    };
    let film_json_path = dir.join("film.json");
    if !film_json_path.is_file() {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(&film_json_path) else {
        return;
    };
    let Ok(fj) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let Some(f_scenes) = fj.get("scenes").and_then(Value::as_array) else {
        return;
    };
    let film_total: f64 = f_scenes
        .iter()
        .filter_map(|s| s.get("duration").and_then(Value::as_f64))
        .sum();
    if film_total > 0.0 && total_duration > 0.0 && (film_total - total_duration).abs() > 0.25 {
        push_issue(
            issues,
            "STORY_FILM_DURATION_MISMATCH",
            "shots",
            format!(
                "Story total duration ({:.2}s) differs from film.json total ({:.2}s).",
                total_duration, film_total
            ),
        );
    }
}

/// Enforces `kit.json` `limits` (`minShots`, `maxShots`, `minDurationSec`, `maxDurationSec`,
/// `maxHeadlineChars`, `maxSubtextChars`, `maxItems`), emitting `STORY_KIT_LIMIT_EXCEEDED`.
pub fn check_kit_limits(
    shots: &[Value],
    total_duration: f64,
    limits: &KitLimits,
    issues: &mut Vec<StoryLintIssue>,
) {
    if let Some(min_s) = limits.min_shots {
        if shots.len() < min_s {
            push_issue(
                issues,
                "STORY_KIT_LIMIT_EXCEEDED",
                "shots",
                format!("Shot count {} is below kit minShots ({}).", shots.len(), min_s),
            );
        }
    }
    if let Some(max_s) = limits.max_shots {
        if shots.len() > max_s {
            push_issue(
                issues,
                "STORY_KIT_LIMIT_EXCEEDED",
                "shots",
                format!("Shot count {} exceeds kit maxShots ({}).", shots.len(), max_s),
            );
        }
    }
    if let Some(min_d) = limits.min_duration_sec {
        if total_duration > 0.0 && total_duration + 0.001 < min_d {
            push_issue(
                issues,
                "STORY_KIT_LIMIT_EXCEEDED",
                "shots",
                format!(
                    "Total duration {:.2}s is below kit minDurationSec ({:.2}s).",
                    total_duration, min_d
                ),
            );
        }
    }
    if let Some(max_d) = limits.max_duration_sec {
        if total_duration > max_d + 0.001 {
            push_issue(
                issues,
                "STORY_KIT_LIMIT_EXCEEDED",
                "shots",
                format!(
                    "Total duration {:.2}s exceeds kit maxDurationSec ({:.2}s).",
                    total_duration, max_d
                ),
            );
        }
    }
    for (idx, shot_val) in shots.iter().enumerate() {
        let Some(shot) = shot_val.as_object() else {
            continue;
        };
        let sp = format!("shots[{idx}]");
        if let Some(max_h) = limits.max_headline_chars {
            if let Some(h) = shot.get("headline").and_then(Value::as_str) {
                if h.chars().count() > max_h {
                    push_issue(
                        issues,
                        "STORY_KIT_LIMIT_EXCEEDED",
                        format!("{sp}.headline"),
                        format!(
                            "Headline length {} exceeds kit maxHeadlineChars ({}).",
                            h.chars().count(),
                            max_h
                        ),
                    );
                }
            }
        }
        if let Some(max_sub) = limits.max_subtext_chars {
            if let Some(sub) = shot.get("subtext").and_then(Value::as_str) {
                if sub.chars().count() > max_sub {
                    push_issue(
                        issues,
                        "STORY_KIT_LIMIT_EXCEEDED",
                        format!("{sp}.subtext"),
                        format!(
                            "Subtext length {} exceeds kit maxSubtextChars ({}).",
                            sub.chars().count(),
                            max_sub
                        ),
                    );
                }
            }
        }
        if let Some(max_it) = limits.max_items {
            if let Some(arr) = shot.get("items").and_then(Value::as_array) {
                if arr.len() > max_it {
                    push_issue(
                        issues,
                        "STORY_KIT_LIMIT_EXCEEDED",
                        format!("{sp}.items"),
                        format!("Items count {} exceeds kit maxItems ({}).", arr.len(), max_it),
                    );
                }
            }
        }
    }
}
