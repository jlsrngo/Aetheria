//! K0 Characterization tests for all 17 built-in declarative `mg-*` skill examples.
//!
//! Kept in a dedicated test module to avoid adding lines to `story_lint.rs` (1,107 lines).

use std::path::PathBuf;

use serde_json::Value;

use super::generic_kit_lint::load_kit_manifest;
use super::story_lint::{lint_story_json_value, story_shot_midpoints};

fn discover_builtin_mg_skill_examples() -> Vec<(String, PathBuf, PathBuf)> {
    // CARGO_MANIFEST_DIR = <repo>/core/aetheria-engine
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
fn k0_characterize_all_17_builtin_skill_examples() {
    let skills = discover_builtin_mg_skill_examples();
    assert_eq!(
        skills.len(),
        17,
        "Expected 17 built-in mg-* skill examples with story.example.json"
    );

    let mut pass_count = 0usize;
    let mut fail_count = 0usize;
    let mut zero_midpoint_count = 0usize;
    let mut kit_loaded_count = 0usize;

    println!("\n=== K0 Characterization: 17 Built-in mg-* Skill Examples ===");
    println!(
        "{:<24} | {:<7} | {:<5} | {:<5} | {:<4} | {}",
        "Skill", "KitLoad", "Valid", "Shots", "Mids", "Issue Codes"
    );
    println!("{}", "-".repeat(100));

    for (name, examples_dir, story_path) in &skills {
        let raw = std::fs::read_to_string(story_path)
            .unwrap_or_else(|e| panic!("read {}: {}", story_path.display(), e));
        let val: Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("parse {}: {}", story_path.display(), e));
        let kit_loaded = load_kit_manifest(examples_dir).is_some();
        if kit_loaded {
            kit_loaded_count += 1;
        }
        let report = lint_story_json_value(&val, Some(examples_dir), &story_path.to_string_lossy());
        let shots_len = val
            .get("shots")
            .and_then(Value::as_array)
            .map(|a| a.len())
            .unwrap_or(0);
        let mids = story_shot_midpoints(story_path);
        if mids.is_empty() {
            zero_midpoint_count += 1;
        }
        if report.valid {
            pass_count += 1;
        } else {
            fail_count += 1;
        }
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
    }

    println!(
        "Summary: total={} pass={} fail={} zero_midpoints={} kit_loaded={}",
        skills.len(),
        pass_count,
        fail_count,
        zero_midpoint_count,
        kit_loaded_count
    );

    // K0 baseline characterization (pre-K1):
    // 3 Dialect A skills pass; 14 non-Dialect-A skills fail; 5 Dialect B skills have 0 midpoints.
    assert_eq!(pass_count, 3, "K0 baseline: expected 3 Dialect A skills to pass");
    assert_eq!(fail_count, 14, "K0 baseline: expected 14 non-Dialect-A skills to fail");
    assert_eq!(
        zero_midpoint_count, 5,
        "K0 baseline: expected 5 Dialect B skills to yield 0 midpoints"
    );
}
