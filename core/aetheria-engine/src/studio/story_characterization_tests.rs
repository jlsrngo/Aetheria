//! K1 Characterization & Regression Tests for all 17 built-in declarative `mg-*` skill examples.
//!
//! Kept in a dedicated test module to avoid adding lines to `story_lint.rs`.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::generic_kit_lint::load_kit_manifest;
use super::story_dialect::normalize_story_dialect;
use super::story_lint::{
    lint_story_json_value, reconcile_story_snapshot_and_rollback, story_shot_midpoints,
};

fn discover_builtin_mg_skill_examples() -> Vec<(String, PathBuf, PathBuf)> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("resolve repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();
    let skills_root = repo_root.join(".aetheria").join("skills");
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&skills_root)
        .unwrap_or_else(|e| panic!("failed to read {}: {}", skills_root.display(), e));
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("mg-") {
            continue;
        }
        let examples_dir = entry.path().join("examples");
        let story_path = examples_dir.join("story.example.json");
        if story_path.is_file() {
            entries.push((name, examples_dir, story_path));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

#[test]
fn k1_all_17_builtin_skill_examples_pass_lint_and_midpoints() {
    let skills = discover_builtin_mg_skill_examples();
    assert_eq!(
        skills.len(),
        18,
        "Expected 18 built-in mg-* skill examples with story.example.json"
    );

    println!("\n=== K1 Verification: 17 Built-in mg-* Skill Examples ===");
    println!(
        "{:<24} | {:<7} | {:<5} | {:<5} | {:<4} | {}",
        "Skill", "KitLoad", "Valid", "Shots", "Mids", "Issue Codes"
    );
    println!("{}", "-".repeat(100));

    let mut failed_skills = Vec::new();
    for (name, examples_dir, story_path) in &skills {
        let raw = std::fs::read_to_string(story_path)
            .unwrap_or_else(|e| panic!("read {}: {}", story_path.display(), e));
        let val: Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("parse {}: {}", story_path.display(), e));

        // Canonical Dialect A must not trigger dialect deprecation notes
        let (_norm, notes) = normalize_story_dialect(&val);
        assert!(
            notes.is_empty(),
            "Skill '{}' should be canonical Dialect A (no deprecation notes), got: {:?}",
            name,
            notes
        );

        let kit_loaded = load_kit_manifest(examples_dir).is_some();
        let report = lint_story_json_value(&val, Some(examples_dir), &story_path.to_string_lossy());
        let shots_len = val
            .get("shots")
            .and_then(Value::as_array)
            .map(|a| a.len())
            .unwrap_or(0);
        let mids = story_shot_midpoints(story_path);
        let codes: Vec<String> = report.issues.iter().map(|i| i.code.clone()).collect();

        println!(
            "{:<24} | {:<7} | {:<5} | {:<5} | {:<4} | {}",
            name,
            kit_loaded,
            report.valid,
            shots_len,
            mids.len(),
            if codes.is_empty() {
                "OK".to_string()
            } else {
                codes.join(", ")
            }
        );

        if !report.valid {
            failed_skills.push(format!("{}: {:?}", name, report.issues));
        }
        assert_eq!(
            mids.len(),
            shots_len,
            "Skill '{}': expected 1 midpoint per shot ({}), got {}",
            name,
            shots_len,
            mids.len()
        );
    }

    assert!(
        failed_skills.is_empty(),
        "All 17 built-in skills must pass lint_story_json_value, failures:\n{}",
        failed_skills.join("\n")
    );
}

#[test]
fn k1_legacy_dialect_b_normalizes_and_passes_lint_and_midpoints() {
    let tmp = std::env::temp_dir().join(format!(
        "aetheria-k1-legacy-b-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let kit = json!({
        "renderer": "2d-legacy-test",
        "useThree": false,
        "scripts": ["script/story-runtime.js"],
        "enums": {
            "layout": ["hero", "outro"]
        }
    });
    std::fs::write(tmp.join("kit.json"), serde_json::to_string_pretty(&kit).unwrap()).unwrap();

    let legacy_story = json!({
        "version": 1,
        "meta": { "title": "Legacy B", "width": 1080, "height": 1920, "fps": 30 },
        "shots": [
            { "id": "s1", "startSec": 0.0, "endSec": 3.0, "layout": "hero" },
            { "id": "s2", "startSec": 3.0, "endSec": 6.0, "layout": "outro" }
        ],
        "captions": [
            { "startSec": 0.5, "endSec": 2.5, "text": "Hello" }
        ]
    });
    let story_path = tmp.join("story.json");
    std::fs::write(
        &story_path,
        serde_json::to_string_pretty(&legacy_story).unwrap(),
    )
    .unwrap();

    let report = lint_story_json_value(&legacy_story, Some(&tmp), "story.json");
    assert!(
        report.valid,
        "Legacy Dialect B should normalize and pass lint, got: {:?}",
        report.issues
    );
    assert_eq!(report.total_shots, 2);
    assert!((report.total_duration - 6.0).abs() < 0.001);

    let mids = story_shot_midpoints(&story_path);
    assert_eq!(mids.len(), 2);
    assert!((mids[0].1 - 1.5).abs() < 0.001);
    assert!((mids[1].1 - 4.5).abs() < 0.001);

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn k1_negative_lint_cases_fail_as_expected() {
    let tmp = std::env::temp_dir().join(format!(
        "aetheria-k1-negative-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let kit = json!({
        "renderer": "2d-neg-test",
        "useThree": false,
        "scripts": ["script/story-runtime.js"],
        "enums": {
            "layout": ["valid-layout"]
        }
    });
    std::fs::write(tmp.join("kit.json"), serde_json::to_string_pretty(&kit).unwrap()).unwrap();

    // 1. Discontinuity
    let discont = json!({
        "title": "Discont",
        "canvas": { "w": 1080, "h": 1920, "fps": 30 },
        "captions": { "enabled": false },
        "shots": [
            { "id": "s1", "start": 0.0, "duration": 2.0, "layout": "valid-layout" },
            { "id": "s2", "start": 2.5, "duration": 2.0, "layout": "valid-layout" }
        ]
    });
    let r1 = lint_story_json_value(&discont, Some(&tmp), "discont.json");
    assert!(!r1.valid);
    assert!(r1.issues.iter().any(|i| i.code == "STORY_SHOT_DISCONTINUITY"));

    // 2. Invalid enum
    let bad_enum = json!({
        "title": "BadEnum",
        "canvas": { "w": 1080, "h": 1920, "fps": 30 },
        "captions": { "enabled": false },
        "shots": [
            { "id": "s1", "start": 0.0, "duration": 2.0, "layout": "bogus-layout" }
        ]
    });
    let r2 = lint_story_json_value(&bad_enum, Some(&tmp), "bad_enum.json");
    assert!(!r2.valid);
    assert!(r2.issues.iter().any(|i| i.code == "STORY_KIT_ENUM_INVALID"));

    // 3. Negative start
    let neg_start = json!({
        "title": "NegStart",
        "canvas": { "w": 1080, "h": 1920, "fps": 30 },
        "captions": { "enabled": false },
        "shots": [
            { "id": "s1", "start": -1.0, "duration": 2.0, "layout": "valid-layout" }
        ]
    });
    let r3 = lint_story_json_value(&neg_start, Some(&tmp), "neg_start.json");
    assert!(!r3.valid);
    assert!(r3.issues.iter().any(|i| i.code == "STORY_INVALID_SHOT_TIMING"));

    // 4. Missing captions.enabled on canonical Dialect A (no meta)
    let no_caps = json!({
        "title": "NoCaps",
        "canvas": { "w": 1080, "h": 1920, "fps": 30 },
        "shots": [
            { "id": "s1", "start": 0.0, "duration": 2.0, "layout": "valid-layout" }
        ]
    });
    let r4 = lint_story_json_value(&no_caps, Some(&tmp), "no_caps.json");
    assert!(!r4.valid);
    assert!(r4.issues.iter().any(|i| i.code == "STORY_INVALID_CAPTIONS"));

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn k1_reconcile_snapshot_rollback_works_with_normalized_story() {
    let tmp = std::env::temp_dir().join(format!(
        "aetheria-k1-rollback-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let good_story = json!({
        "title": "Good",
        "canvas": { "w": 1080, "h": 1920, "fps": 30 },
        "captions": { "enabled": false },
        "shots": [{ "id": "s1", "start": 0.0, "duration": 3.0 }]
    });
    let good_str = serde_json::to_string_pretty(&good_story).unwrap();
    let story_path = tmp.join("story.json");
    std::fs::write(&story_path, &good_str).unwrap();

    // First pass: valid -> saved as best snapshot, no rollback
    let rolled1 = reconcile_story_snapshot_and_rollback(&tmp, true, 0, 0);
    assert!(!rolled1);

    // Second pass: broken edit -> lint_ok=false -> rolls back to good_str
    std::fs::write(&story_path, "{\"broken\":true}").unwrap();
    let rolled2 = reconcile_story_snapshot_and_rollback(&tmp, false, 1, 0);
    assert!(rolled2);
    let restored = std::fs::read_to_string(&story_path).unwrap();
    assert_eq!(restored, good_str);

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn k3_kit_limits_are_enforced_with_story_kit_limit_exceeded() {
    let tmp = std::env::temp_dir().join(format!(
        "aetheria-k3-limits-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let kit = json!({
        "renderer": "2d-limits-test",
        "useThree": false,
        "scripts": ["script/story-runtime.js"],
        "limits": {
            "minShots": 2,
            "maxShots": 4,
            "minDurationSec": 3.0,
            "maxDurationSec": 20.0,
            "maxHeadlineChars": 12
        }
    });
    std::fs::write(tmp.join("kit.json"), serde_json::to_string_pretty(&kit).unwrap()).unwrap();

    let too_few_and_long_headline = json!({
        "title": "Limits",
        "canvas": { "w": 1080, "h": 1920, "fps": 30 },
        "captions": { "enabled": false },
        "shots": [
            { "id": "s1", "start": 0.0, "duration": 25.0, "headline": "This headline is way too long" }
        ]
    });
    let report = lint_story_json_value(&too_few_and_long_headline, Some(&tmp), "limits.json");
    assert!(!report.valid);
    let limit_issues: Vec<_> = report
        .issues
        .iter()
        .filter(|i| i.code == "STORY_KIT_LIMIT_EXCEEDED")
        .collect();
    assert_eq!(
        limit_issues.len(),
        3,
        "Expected 3 STORY_KIT_LIMIT_EXCEEDED issues (minShots, maxDurationSec, maxHeadlineChars), got: {:?}",
        limit_issues
    );

    let _ = std::fs::remove_dir_all(&tmp);
}
