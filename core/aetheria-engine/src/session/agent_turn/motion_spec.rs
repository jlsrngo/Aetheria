//! Typed per-scene Motion Specification (`SceneMotionSpec` v1), pre-code validator,
//! and spec-to-code compliance checker for the Direct Per-Scene Remake Compiler.
//!
//! Separates Motion Planning (`write_motion_spec` -> validated `script/sceneK.motion_spec.json`)
//! from Motion Engineering (`write_scene_script` -> `script/sceneK.js`) within one model loop
//! so planning failures are caught BEFORE coding and implementation drift is caught AT write time.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use super::direct_scene_prompt::SceneMotionExpectations;

fn default_schema_version() -> u32 {
    1
}

fn default_mode() -> String {
    "remake".to_string()
}

fn default_easing() -> String {
    "aeGlide".to_string()
}

fn default_hold_behavior() -> String {
    "steady".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CameraIntentSpec {
    pub kind: String,
    #[serde(default)]
    pub start_sec: Option<f64>,
    #[serde(default)]
    pub end_sec: Option<f64>,
    #[serde(default)]
    pub easing: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HandoffSpec {
    #[serde(default)]
    pub incoming_bridge: Option<String>,
    #[serde(default)]
    pub outgoing_intent: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionElementSpec {
    pub id: String,
    pub role: String,
    pub motion_kind: String,
    pub start_sec: f64,
    pub end_sec: f64,
    #[serde(default = "default_easing")]
    pub easing: String,
    #[serde(default = "default_hold_behavior")]
    pub hold_behavior: String,
    #[serde(default)]
    pub omega_deg_per_sec: Option<f64>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub evidence_ref: Option<String>,
    #[serde(default)]
    pub intent: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneMotionSpec {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub scene_id: String,
    #[serde(default)]
    pub duration_sec: f64,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub camera_intent: Option<CameraIntentSpec>,
    #[serde(default)]
    pub handoff: Option<HandoffSpec>,
    pub elements: Vec<MotionElementSpec>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionSpecValidation {
    pub valid: bool,
    pub failure_class: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub summary: String,
}

const VALID_ROLES: [&str; 5] = ["hero", "supporting", "text", "accent", "background"];
const VALID_MOTION_KINDS: [&str; 10] = [
    "enter_settle",
    "blur_reveal",
    "turntable_3d",
    "rotate",
    "sweep",
    "orbit",
    "morph",
    "counter",
    "marching_dash",
    "static_plate",
];
const VALID_EASINGS: [&str; 15] = [
    "aeGlide",
    "outQuint",
    "inOutQuint",
    "aeSnap",
    "outExpo",
    "inOutExpo",
    "outQuart",
    "inOutQuart",
    "outBack",
    "spring",
    "inOutCubic",
    "inCubic",
    "outCubic",
    "outQuad",
    "linear",
];

/// Derives `script/sceneK.motion_spec.json` sibling path from `script/sceneK.js`.
pub(crate) fn spec_path_for_script(script_path: &Path) -> PathBuf {
    let stem = script_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("scene");
    script_path.with_file_name(format!("{}.motion_spec.json", stem))
}

/// OpenAI-compatible tool definition for `write_motion_spec`.
pub(crate) fn write_motion_spec_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "write_motion_spec",
            "description": "Declare and validate a concise per-scene Motion Specification BEFORE writing `script/sceneK.js`. Locks element roles, timings, After Effects speed-graph easings (`aeGlide`/`outQuint`/`aeSnap`/`spring`), 3D turntable/spin rates, and hold behavior so code stays compliant during visual polish.",
            "parameters": {
                "type": "object",
                "properties": {
                    "schemaVersion": { "type": "integer", "description": "Must be 1." },
                    "sceneId": { "type": "string", "description": "Active scene ID." },
                    "durationSec": { "type": "number", "description": "Scene duration in seconds." },
                    "mode": { "type": "string", "enum": ["remake", "original"] },
                    "cameraIntent": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "enum": ["static", "zoom_in", "zoom_out", "pan", "tracked"] },
                            "startSec": { "type": "number" },
                            "endSec": { "type": "number" },
                            "easing": { "type": "string" },
                            "note": { "type": "string" }
                        },
                        "required": ["kind"]
                    },
                    "handoff": {
                        "type": "object",
                        "properties": {
                            "incomingBridge": { "type": "string" },
                            "outgoingIntent": { "type": "string" }
                        }
                    },
                    "elements": {
                        "type": "array",
                        "description": "Ordered list of 1..16 elements with explicit motion roles, timing windows, easings, and hold behavior.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "role": { "type": "string", "enum": ["hero", "supporting", "text", "accent", "background"] },
                                "motionKind": { "type": "string", "enum": ["enter_settle", "blur_reveal", "turntable_3d", "rotate", "sweep", "orbit", "morph", "counter", "marching_dash", "static_plate"] },
                                "startSec": { "type": "number" },
                                "endSec": { "type": "number" },
                                "easing": { "type": "string", "enum": ["aeGlide", "outQuint", "inOutQuint", "aeSnap", "outExpo", "inOutExpo", "outQuart", "inOutQuart", "outBack", "spring", "inOutCubic", "inCubic", "outCubic", "outQuad", "linear"] },
                                "holdBehavior": { "type": "string", "enum": ["steady", "living"] },
                                "omegaDegPerSec": { "type": "number" },
                                "parentId": { "type": "string" },
                                "evidenceRef": { "type": "string" },
                                "intent": { "type": "string" }
                            },
                            "required": ["id", "role", "motionKind", "startSec", "endSec"]
                        }
                    }
                },
                "required": ["elements"]
            }
        }
    })
}

/// Parses and deterministically validates a `SceneMotionSpec` against scene bounds and
/// 30fps `SceneMotionExpectations` (separating `remake` vs `original` validation rules).
pub(crate) fn parse_and_validate_motion_spec(
    raw: &Value,
    expected_scene_id: &str,
    scene_dur: f64,
    expectations: SceneMotionExpectations,
) -> Result<(SceneMotionSpec, MotionSpecValidation), String> {
    let mut spec: SceneMotionSpec = serde_json::from_value(raw.clone())
        .map_err(|e| format!("Invalid Motion Specification schema: {}", e))?;

    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    if spec.schema_version != 1 {
        errors.push(format!("schemaVersion must be 1, got {}", spec.schema_version));
    }
    if spec.scene_id.trim().is_empty() {
        if !expected_scene_id.is_empty() {
            spec.scene_id = expected_scene_id.to_string();
        } else {
            errors.push("sceneId must not be empty".to_string());
        }
    } else if !expected_scene_id.is_empty() && spec.scene_id != expected_scene_id {
        warnings.push(format!(
            "sceneId '{}' differs from active scene '{}'",
            spec.scene_id, expected_scene_id
        ));
    }
    if !spec.duration_sec.is_finite() || spec.duration_sec <= 0.0 {
        if scene_dur > 0.0 {
            spec.duration_sec = scene_dur;
        } else {
            errors.push("durationSec must be > 0".to_string());
        }
    } else if scene_dur > 0.0 && (spec.duration_sec - scene_dur).abs() > 0.50 {
        errors.push(format!(
            "durationSec ({:.3}s) deviates >0.50s from scene duration ({:.3}s)",
            spec.duration_sec, scene_dur
        ));
    }
    let is_remake = !spec.mode.eq_ignore_ascii_case("original");
    if !matches!(spec.mode.as_str(), "remake" | "original") {
        errors.push(format!("mode must be 'remake' or 'original', got '{}'", spec.mode));
    }
    if spec.elements.is_empty() || spec.elements.len() > 16 {
        errors.push(format!(
            "elements must contain 1..=16 entries, got {}",
            spec.elements.len()
        ));
    }

    let bound_dur = if scene_dur > 0.0 {
        scene_dur
    } else {
        spec.duration_sec.max(0.1)
    };
    let mut ids: BTreeSet<String> = BTreeSet::new();
    for el in &spec.elements {
        if el.id.trim().is_empty() {
            errors.push("element id must not be empty".to_string());
        } else if !ids.insert(el.id.clone()) {
            errors.push(format!("duplicate element id '{}'", el.id));
        }
        if !VALID_ROLES.contains(&el.role.as_str()) {
            errors.push(format!("element '{}' has invalid role '{}'", el.id, el.role));
        }
        if !VALID_MOTION_KINDS.contains(&el.motion_kind.as_str()) {
            errors.push(format!(
                "element '{}' has invalid motionKind '{}'",
                el.id, el.motion_kind
            ));
        }
        if !VALID_EASINGS.contains(&el.easing.as_str()) {
            errors.push(format!("element '{}' has invalid easing '{}'", el.id, el.easing));
        }
        if !matches!(el.hold_behavior.as_str(), "steady" | "living") {
            errors.push(format!(
                "element '{}' has invalid holdBehavior '{}' (expected 'steady' or 'living')",
                el.id, el.hold_behavior
            ));
        }
        if !el.start_sec.is_finite() || !el.end_sec.is_finite() {
            errors.push(format!("element '{}' has non-finite timestamps", el.id));
        } else {
            if el.start_sec < -0.01 || el.start_sec >= el.end_sec {
                errors.push(format!(
                    "element '{}' has invalid interval {:.2}..{:.2}s (require 0 <= startSec < endSec)",
                    el.id, el.start_sec, el.end_sec
                ));
            }
            if el.end_sec > bound_dur + 0.15 {
                errors.push(format!(
                    "element '{}' endSec ({:.2}s) exceeds scene duration ({:.2}s)",
                    el.id, el.end_sec, bound_dur
                ));
            }
        }
        if matches!(el.motion_kind.as_str(), "rotate" | "turntable_3d") {
            if let Some(om) = el.omega_deg_per_sec {
                if om.abs() < 20.0 {
                    errors.push(format!(
                        "element '{}' ({}) requires |omegaDegPerSec| >= 20 deg/s, got {:.1}",
                        el.id, el.motion_kind, om
                    ));
                }
            } else {
                warnings.push(format!(
                    "element '{}' ({}) omitted omegaDegPerSec; specify explicit angular speed (e.g. 90..140 deg/s)",
                    el.id, el.motion_kind
                ));
            }
        }
        if expectations.has_incoming_push_bridge {
            let id_low = el.id.to_ascii_lowercase();
            let int_low = el.intent.as_deref().unwrap_or("").to_ascii_lowercase();
            if id_low.contains("prev_scene")
                || id_low.contains("previous_scene")
                || int_low.contains("previous scene")
                || int_low.contains("redraw prev")
            {
                errors.push(format!(
                    "element '{}' attempts manual previous-scene redraw while runtime incoming push_* bridge is active — remove it",
                    el.id
                ));
            }
        }
    }

    for el in &spec.elements {
        if let Some(ref pid) = el.parent_id {
            if !pid.trim().is_empty() && (!ids.contains(pid) || pid == &el.id) {
                errors.push(format!(
                    "element '{}' references invalid/dangling parentId '{}'",
                    el.id, pid
                ));
            }
        }
    }

    let has_kind = |k: &str| spec.elements.iter().any(|e| e.motion_kind == k);
    if is_remake {
        if expectations.requires_turntable_3d && !has_kind("turntable_3d") {
            errors.push(
                "30fps reference detected rotating 3D hero (`turntable_3d`), but spec has no element with motionKind='turntable_3d'".to_string(),
            );
        }
        if expectations.requires_corner_spin && !has_kind("rotate") && !has_kind("turntable_3d") {
            errors.push(
                "30fps reference detected spinning accent (`rotate`), but spec has no element with motionKind='rotate'".to_string(),
            );
        }
        if expectations.requires_blur_text_reveal && !has_kind("blur_reveal") {
            errors.push(
                "30fps reference detected blur-to-sharp text reveal, but spec has no element with motionKind='blur_reveal'".to_string(),
            );
        }
        if !expectations.has_living_hold
            && spec.elements.iter().any(|e| e.hold_behavior == "living")
        {
            warnings.push(
                "reference hold is steady (hasLivingHold=false), yet spec marks element(s) as holdBehavior='living' — keep locked holds crisp".to_string(),
            );
        }
    } else {
        let has_animated_focal = spec
            .elements
            .iter()
            .any(|e| matches!(e.role.as_str(), "hero" | "text") && e.motion_kind != "static_plate");
        if !has_animated_focal {
            errors.push(
                "original mode requires at least one animated hero or text element (not static_plate)".to_string(),
            );
        }
    }

    let valid = errors.is_empty();
    let failure_class = if valid {
        "none".to_string()
    } else {
        "planning_failure".to_string()
    };
    let elem_tags: Vec<String> = spec
        .elements
        .iter()
        .take(6)
        .map(|e| format!("{}[{}:{}@{:.2}..{:.2}s]", e.id, e.motion_kind, e.easing, e.start_sec, e.end_sec))
        .collect();
    let summary = format!(
        "spec v1 ({}) {} elements: {}",
        spec.mode,
        spec.elements.len(),
        elem_tags.join(", ")
    );

    Ok((
        spec,
        MotionSpecValidation {
            valid,
            failure_class,
            errors,
            warnings,
            summary,
        },
    ))
}

/// Checks generated JS `code` against a validated `SceneMotionSpec` to catch
/// Implementation Failures where code silently dropped planned motion or curves.
pub(crate) fn check_code_against_motion_spec(spec: &SceneMotionSpec, code: &str) -> Vec<String> {
    let mut issues = Vec::new();
    let has_kind = |k: &str| spec.elements.iter().any(|e| e.motion_kind == k);

    if has_kind("turntable_3d") && !code.contains("drawTurntableObject") {
        issues.push(
            "SPEC COMPLIANCE HAZARD: Your Motion Spec declared a `turntable_3d` element, but `script` does NOT call `AM.drawTurntableObject(...)`!".to_string(),
        );
    }
    if has_kind("rotate") && !code.contains(".rotate(") && !code.contains("drawTurntableObject") {
        issues.push(
            "SPEC COMPLIANCE HAZARD: Your Motion Spec declared a `rotate` element, but `script` has no `ctx.rotate(...)` call!".to_string(),
        );
    }
    if has_kind("blur_reveal")
        && !code.contains("drawBlurRevealText")
        && !code.contains("drawBlurRiseWords")
    {
        issues.push(
            "SPEC COMPLIANCE HAZARD: Your Motion Spec declared `blur_reveal` text, but `script` does NOT call `AM.drawBlurRevealText(...)` or `AM.drawBlurRiseWords(...)`!".to_string(),
        );
    }
    if has_kind("marching_dash") && (!code.contains("setLineDash(") || !code.contains("lineDashOffset")) {
        issues.push(
            "SPEC COMPLIANCE HAZARD: Your Motion Spec declared `marching_dash`, but `script` is missing `ctx.setLineDash(...)` + animated `ctx.lineDashOffset`!".to_string(),
        );
    }

    let declared_ae_curves = spec.elements.iter().any(|e| {
        matches!(
            e.easing.as_str(),
            "aeGlide" | "outQuint" | "inOutQuint" | "aeSnap" | "outExpo" | "spring"
        )
    });
    if declared_ae_curves {
        let uses_any_ae = code.contains("aeGlide")
            || code.contains("outQuint")
            || code.contains("inOutQuint")
            || code.contains("aeSnap")
            || code.contains("outExpo")
            || code.contains("outQn")
            || code.contains("ioQn")
            || code.contains("outX")
            || code.contains("AM.spring(")
            || code.contains("AM.bezier(");
        if !uses_any_ae && code.contains("outCubic") {
            issues.push(
                "SPEC COMPLIANCE HAZARD: Your Motion Spec planned After Effects speed-graph curves (`aeGlide`/`outQuint`/`aeSnap`/`outExpo`/`spring`), but `script` fell back exclusively to plain `outCubic` — use the planned curves!".to_string(),
            );
        }
    }

    issues
}

/// Loads `script/sceneK.motion_spec.json` if present on disk and checks `code` compliance.
pub(crate) fn load_and_check_motion_spec_compliance(script_path: &Path, code: &str) -> Vec<String> {
    let spec_path = spec_path_for_script(script_path);
    let Ok(raw) = std::fs::read_to_string(&spec_path) else {
        return Vec::new();
    };
    let Ok(spec) = serde_json::from_str::<SceneMotionSpec>(&raw) else {
        return Vec::new();
    };
    check_code_against_motion_spec(&spec, code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_remake_spec_and_rejects_planning_failures() {
        let exp = SceneMotionExpectations {
            requires_turntable_3d: true,
            requires_corner_spin: true,
            requires_blur_text_reveal: true,
            pre_cut_active: false,
            has_incoming_push_bridge: true,
            has_living_hold: false,
        };

        let bad = json!({
            "schemaVersion": 1,
            "sceneId": "scene2_demo",
            "durationSec": 3.0,
            "mode": "remake",
            "elements": [
                {
                    "id": "prev_scene_exit",
                    "role": "supporting",
                    "motionKind": "enter_settle",
                    "startSec": 0.0,
                    "endSec": 0.25,
                    "intent": "redraw previous scene sliding out"
                },
                {
                    "id": "star_1",
                    "role": "accent",
                    "motionKind": "rotate",
                    "startSec": 2.5,
                    "endSec": 1.0,
                    "omegaDegPerSec": 5.0,
                    "parentId": "missing_parent"
                }
            ]
        });
        let (_, bad_res) =
            parse_and_validate_motion_spec(&bad, "scene2_demo", 3.0, exp).expect("parses");
        assert!(!bad_res.valid);
        assert_eq!(bad_res.failure_class, "planning_failure");
        assert!(bad_res.errors.iter().any(|e| e.contains("previous-scene")));
        assert!(bad_res.errors.iter().any(|e| e.contains("invalid interval")));
        assert!(bad_res.errors.iter().any(|e| e.contains("omegaDegPerSec")));
        assert!(bad_res.errors.iter().any(|e| e.contains("parentId")));
        assert!(bad_res.errors.iter().any(|e| e.contains("turntable_3d")));
        assert!(bad_res.errors.iter().any(|e| e.contains("blur_reveal")));

        let good = json!({
            "schemaVersion": 1,
            "sceneId": "scene2_demo",
            "durationSec": 3.0,
            "mode": "remake",
            "elements": [
                {
                    "id": "hero_brain",
                    "role": "hero",
                    "motionKind": "turntable_3d",
                    "startSec": 0.1,
                    "endSec": 3.0,
                    "easing": "aeGlide",
                    "omegaDegPerSec": 120.0
                },
                {
                    "id": "headline",
                    "role": "text",
                    "motionKind": "blur_reveal",
                    "startSec": 0.15,
                    "endSec": 1.2,
                    "easing": "aeGlide"
                },
                {
                    "id": "ring_dash",
                    "role": "supporting",
                    "motionKind": "marching_dash",
                    "startSec": 0.2,
                    "endSec": 3.0,
                    "parentId": "hero_brain"
                }
            ]
        });
        let (spec, good_res) =
            parse_and_validate_motion_spec(&good, "scene2_demo", 3.0, exp).expect("parses");
        assert!(good_res.valid, "expected valid spec, got {:?}", good_res.errors);
        assert_eq!(good_res.failure_class, "none");

        // Implementation failure detection: code that drops turntable, blur reveal, dash offset, and aeGlide
        let drifted_code = "AM.registerScene('scene2_demo', function(ctx, t){ var p = AM.ease.outCubic(t); ctx.drawImage(img, 0, 0); ctx.setLineDash([4,4]); ctx.fillText('hi', 10, 20); });";
        let drift_issues = check_code_against_motion_spec(&spec, drifted_code);
        assert!(drift_issues.iter().any(|i| i.contains("drawTurntableObject")));
        assert!(drift_issues.iter().any(|i| i.contains("drawBlurRevealText")));
        assert!(drift_issues.iter().any(|i| i.contains("lineDashOffset")));
        assert!(drift_issues.iter().any(|i| i.contains("outCubic")));

        let compliant_code = "AM.registerScene('scene2_demo', function(ctx, t){ var p = AM.ease.aeGlide(t); AM.drawTurntableObject(ctx, 360, 500, t, img, { w: 280, h: 240, omega: 2.0 }); ctx.setLineDash([5,5]); ctx.lineDashOffset = -t*28; AM.drawBlurRevealText(ctx, 'hi', 10, 20, t, 0.15, 0.4); });";
        assert!(check_code_against_motion_spec(&spec, compliant_code).is_empty());
    }

    #[test]
    fn original_mode_allows_creative_motion_but_rejects_static_only_scenes() {
        let empty_exp = SceneMotionExpectations::default();
        let static_orig = json!({
            "schemaVersion": 1,
            "sceneId": "orig_1",
            "durationSec": 2.5,
            "mode": "original",
            "elements": [
                { "id": "bg", "role": "background", "motionKind": "static_plate", "startSec": 0.0, "endSec": 2.5 }
            ]
        });
        let (_, res) = parse_and_validate_motion_spec(&static_orig, "orig_1", 2.5, empty_exp).unwrap();
        assert!(!res.valid);
        assert!(res.errors.iter().any(|e| e.contains("original mode requires")));

        let lively_orig = json!({
            "schemaVersion": 1,
            "sceneId": "orig_1",
            "durationSec": 2.5,
            "mode": "original",
            "elements": [
                { "id": "title", "role": "hero", "motionKind": "blur_reveal", "startSec": 0.1, "endSec": 1.0, "easing": "aeGlide", "holdBehavior": "living" }
            ]
        });
        let (_, res_ok) = parse_and_validate_motion_spec(&lively_orig, "orig_1", 2.5, empty_exp).unwrap();
        assert!(res_ok.valid);
        assert!(res_ok.warnings.is_empty());
    }
}
