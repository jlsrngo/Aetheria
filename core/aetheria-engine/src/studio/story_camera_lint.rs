//! Data-driven declarative camera validator (`STORY_CAMERA_INVALID`) for `story.json`.
//!
//! Invoked by `generic_kit_lint.rs` using camera limits declared in `kit.json` (`camera: { maxZoom, maxPan, maxRollDeg }`).
//! Never alters existing clay `VALID_CAMERA_PRESETS` or legacy issue codes.

use serde_json::Value;

use super::story_checks::push_issue;
use super::story_lint::StoryLintIssue;

pub const STORY_CAMERA_INVALID_CODE: &str = "STORY_CAMERA_INVALID";

pub const VALID_CAMERA_STYLES: &[&str] = &["calm", "kinetic", "editorial"];
pub const VALID_CAMERA_MOVES: &[&str] = &[
    "hold",
    "push-in",
    "pull-out",
    "pan",
    "tilt",
    "truck",
    "orbit",
    "crane",
    "handheld",
    "whip",
    "rack-focus-in",
];
pub const VALID_CAMERA_DIRS: &[&str] = &["auto", "left", "right", "up", "down", "in", "out"];
pub const VALID_CAMERA_CURVES: &[&str] = &[
    "ease-out",
    "ease-in-out",
    "linear",
    "whip",
    "whip-out",
    "whip-inout",
];

#[derive(Debug, Clone, Default)]
pub struct KitCameraConfig {
    pub enabled: bool,
    pub max_zoom: Option<f64>,
    pub max_pan: Option<f64>,
    pub max_roll_deg: Option<f64>,
    pub custom_moves: Option<Vec<String>>,
}

impl KitCameraConfig {
    pub fn from_manifest_value(val: Option<&Value>) -> Self {
        let Some(v) = val else {
            return Self::default();
        };
        if v.as_u64() == Some(1) || v.as_bool() == Some(true) {
            return Self {
                enabled: true,
                ..Self::default()
            };
        }
        let Some(obj) = v.as_object() else {
            return Self::default();
        };
        let custom_moves = obj
            .get("moves")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
            })
            .filter(|m| !m.is_empty());
        Self {
            enabled: true,
            max_zoom: obj.get("maxZoom").and_then(Value::as_f64),
            max_pan: obj.get("maxPan").and_then(Value::as_f64),
            max_roll_deg: obj.get("maxRollDeg").and_then(Value::as_f64),
            custom_moves,
        }
    }
}

pub fn validate_root_camera_style(
    root: &serde_json::Map<String, Value>,
    issues: &mut Vec<StoryLintIssue>,
) {
    let Some(val) = root.get("cameraStyle") else {
        return;
    };
    match val.as_str() {
        Some(s) if VALID_CAMERA_STYLES.contains(&s) => {}
        Some(s) => push_issue(
            issues,
            STORY_CAMERA_INVALID_CODE,
            "cameraStyle",
            format!(
                "Invalid `cameraStyle` '{}'. Allowed: {}.",
                s,
                VALID_CAMERA_STYLES.join(", ")
            ),
        ),
        None => push_issue(
            issues,
            STORY_CAMERA_INVALID_CODE,
            "cameraStyle",
            format!(
                "`cameraStyle` must be a string ({}).",
                VALID_CAMERA_STYLES.join(", ")
            ),
        ),
    }
}

pub fn validate_shot_camera(
    shot: &serde_json::Map<String, Value>,
    shot_path: &str,
    canvas_w: f64,
    canvas_h: f64,
    cfg: &KitCameraConfig,
    issues: &mut Vec<StoryLintIssue>,
) {
    let Some(cam_val) = shot.get("camera") else {
        return;
    };
    let Some(cam) = cam_val.as_object() else {
        push_issue(
            issues,
            STORY_CAMERA_INVALID_CODE,
            format!("{shot_path}.camera"),
            "`camera` must be an object.".to_string(),
        );
        return;
    };

    if let Some(mv_val) = cam.get("move") {
        let valid_move = mv_val.as_str().is_some_and(|s| match &cfg.custom_moves {
            Some(list) => list.iter().any(|a| a == s),
            None => VALID_CAMERA_MOVES.contains(&s),
        });
        if !valid_move {
            let allowed = match &cfg.custom_moves {
                Some(list) => list.join(", "),
                None => VALID_CAMERA_MOVES.join(", "),
            };
            push_issue(
                issues,
                STORY_CAMERA_INVALID_CODE,
                format!("{shot_path}.camera.move"),
                format!("Invalid `camera.move`. Allowed: {allowed}."),
            );
        }
    }

    if let Some(dir_val) = cam.get("dir") {
        if !dir_val.as_str().is_some_and(|s| VALID_CAMERA_DIRS.contains(&s)) {
            push_issue(
                issues,
                STORY_CAMERA_INVALID_CODE,
                format!("{shot_path}.camera.dir"),
                format!("Invalid `camera.dir`. Allowed: {}.", VALID_CAMERA_DIRS.join(", ")),
            );
        }
    }

    if let Some(curve_val) = cam.get("curve") {
        if !curve_val.as_str().is_some_and(|s| VALID_CAMERA_CURVES.contains(&s)) {
            push_issue(
                issues,
                STORY_CAMERA_INVALID_CODE,
                format!("{shot_path}.camera.curve"),
                format!("Invalid `camera.curve`. Allowed: {}.", VALID_CAMERA_CURVES.join(", ")),
            );
        }
    }

    if let Some(int_val) = cam.get("intensity") {
        let ok = int_val
            .as_f64()
            .is_some_and(|n| n.is_finite() && (0.0..=1.0).contains(&n));
        if !ok {
            push_issue(
                issues,
                STORY_CAMERA_INVALID_CODE,
                format!("{shot_path}.camera.intensity"),
                "`camera.intensity` must be a number in [0, 1].".to_string(),
            );
        }
    }

    if let Some(md_val) = cam.get("moveDuration") {
        let ok = match md_val {
            Value::String(s) => s == "shot" || s == "burst",
            Value::Number(n) => n.as_f64().is_some_and(|x| x.is_finite() && x >= 0.1),
            _ => false,
        };
        if !ok {
            push_issue(
                issues,
                STORY_CAMERA_INVALID_CODE,
                format!("{shot_path}.camera.moveDuration"),
                "`camera.moveDuration` must be >= 0.1 seconds or \"shot\".".to_string(),
            );
        }
    }

    if let Some(max_zoom) = cfg.max_zoom {
        for field in ["zoomFrom", "zoomTo"] {
            if let Some(z_val) = cam.get(field) {
                let ok = z_val
                    .as_f64()
                    .is_some_and(|z| z.is_finite() && z > 0.0 && z <= max_zoom);
                if !ok {
                    push_issue(
                        issues,
                        STORY_CAMERA_INVALID_CODE,
                        format!("{shot_path}.camera.{field}"),
                        format!("`camera.{field}` must be in (0, {max_zoom}] (kit.json camera.maxZoom)."),
                    );
                }
            }
        }
    }

    if let Some(max_pan) = cfg.max_pan {
        for (field, dim) in [
            ("panXFrom", canvas_w),
            ("panXTo", canvas_w),
            ("panYFrom", canvas_h),
            ("panYTo", canvas_h),
        ] {
            if let Some(p_val) = cam.get(field) {
                let limit_px = max_pan * dim.max(1.0);
                let ok = p_val
                    .as_f64()
                    .is_some_and(|p| p.is_finite() && p.abs() <= limit_px);
                if !ok {
                    push_issue(
                        issues,
                        STORY_CAMERA_INVALID_CODE,
                        format!("{shot_path}.camera.{field}"),
                        format!(
                            "`camera.{field}` exceeds kit.json camera.maxPan ({max_pan} => +/-{limit_px:.1}px)."
                        ),
                    );
                }
            }
        }
    }

    if let Some(max_roll) = cfg.max_roll_deg {
        for field in ["rollFromDeg", "rollToDeg"] {
            if let Some(r_val) = cam.get(field) {
                let ok = r_val
                    .as_f64()
                    .is_some_and(|r| r.is_finite() && r.abs() <= max_roll);
                if !ok {
                    push_issue(
                        issues,
                        STORY_CAMERA_INVALID_CODE,
                        format!("{shot_path}.camera.{field}"),
                        format!("`camera.{field}` exceeds kit.json camera.maxRollDeg (+/-{max_roll} deg)."),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::generic_kit_lint::{lint_generic_kit_story_value, load_kit_manifest, KitManifest};
    use serde_json::json;

    fn sample_kit() -> KitManifest {
        serde_json::from_value(json!({
            "renderer": "2d-test-cam",
            "core": 1,
            "camera": { "version": 1, "maxZoom": 1.35, "maxPan": 0.08, "maxRollDeg": 3.5 },
            "enums": { "layout": ["hero"], "cameraStyle": ["calm", "kinetic", "editorial"] }
        }))
        .unwrap()
    }

    #[test]
    fn accepts_valid_camera_fields_and_shot_duration() {
        let kit = sample_kit();
        let story = json!({
            "title": "Valid Cam",
            "seed": 42,
            "cameraStyle": "editorial",
            "canvas": { "w": 1280, "h": 720, "fps": 30 },
            "shots": [
                {
                    "id": "s1",
                    "start": 0.0,
                    "duration": 3.0,
                    "layout": "hero",
                    "camera": { "move": "push-in", "intensity": 0.65, "dir": "in", "moveDuration": "shot", "curve": "ease-out" }
                },
                {
                    "id": "s2",
                    "start": 3.0,
                    "duration": 3.0,
                    "layout": "hero",
                    "camera": { "move": "pan", "intensity": 0.4, "moveDuration": 1.2, "zoomTo": 1.2, "panXTo": 80, "rollToDeg": -2.5 }
                }
            ]
        });
        let report = lint_generic_kit_story_value(story.as_object().unwrap(), &kit, None, "story.json", vec![]);
        assert!(report.valid, "Expected valid camera story, got: {:?}", report.issues);
    }

    #[test]
    fn rejects_invalid_move_intensity_duration_and_limits_with_single_code() {
        let kit = sample_kit();
        let story = json!({
            "title": "Bad Cam",
            "cameraStyle": "turbo-chaos",
            "canvas": { "w": 1280, "h": 720, "fps": 30 },
            "shots": [
                {
                    "id": "s1",
                    "start": 0.0,
                    "duration": 3.0,
                    "layout": "hero",
                    "camera": {
                        "move": "teleport",
                        "intensity": 1.5,
                        "moveDuration": 0.02,
                        "zoomTo": 2.4,
                        "panXTo": 250,
                        "rollToDeg": 9.0
                    }
                }
            ]
        });
        let report = lint_generic_kit_story_value(story.as_object().unwrap(), &kit, None, "story.json", vec![]);
        assert!(!report.valid);
        let cam_issues: Vec<&StoryLintIssue> = report
            .issues
            .iter()
            .filter(|i| i.code == STORY_CAMERA_INVALID_CODE)
            .collect();
        let paths: Vec<&str> = cam_issues.iter().map(|i| i.path.as_str()).collect();
        assert!(paths.contains(&"cameraStyle"), "missing cameraStyle: {:?}", paths);
        assert!(paths.contains(&"shots[0].camera.move"), "missing move: {:?}", paths);
        assert!(paths.contains(&"shots[0].camera.intensity"), "missing intensity: {:?}", paths);
        assert!(paths.contains(&"shots[0].camera.moveDuration"), "missing moveDuration: {:?}", paths);
        assert!(paths.contains(&"shots[0].camera.zoomTo"), "missing zoomTo: {:?}", paths);
        assert!(paths.contains(&"shots[0].camera.panXTo"), "missing panXTo: {:?}", paths);
        assert!(paths.contains(&"shots[0].camera.rollToDeg"), "missing rollToDeg: {:?}", paths);
    }

    #[test]
    fn all_18_builtin_skill_examples_remain_lint_valid_with_camera_validator() {
        let skills_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(".aetheria")
            .join("skills");
        let mut checked = 0usize;
        for entry in std::fs::read_dir(&skills_root).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("mg-") {
                continue;
            }
            let ex_dir = entry.path().join("examples");
            let story_path = ex_dir.join("story.example.json");
            if !story_path.is_file() {
                continue;
            }
            if let Some(kit) = load_kit_manifest(&ex_dir) {
                let raw = std::fs::read_to_string(&story_path).unwrap();
                let val: Value = serde_json::from_str(&raw).unwrap();
                let rep = lint_generic_kit_story_value(
                    val.as_object().unwrap(),
                    &kit,
                    None,
                    &name,
                    vec![],
                );
                let cam_errs: Vec<_> = rep
                    .issues
                    .iter()
                    .filter(|i| i.code == STORY_CAMERA_INVALID_CODE)
                    .collect();
                assert!(cam_errs.is_empty(), "{name} had camera lint errors: {:?}", cam_errs);
                checked += 1;
            }
        }
        assert!(checked >= 15, "Expected >=15 generic-kit builtin skills, checked {checked}");
    }
}
