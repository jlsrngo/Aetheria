//! Scene-Scoped Vision & Reference Report Filtering for Focused Subagent Delegation.
//!
//! When a coordinator delegates a focused subset of scenes (e.g. `scene1.js` + `scene2.js`),
//! attaching ONLY those scenes' high-resolution `ref_scene_0K_beats.jpg` storyboard strips,
//! `_q1`/`mid`/`_q3` keyframes, and matching `ref_report.md` sections prevents cross-scene
//! attention dilution and lets fast models (such as Gemini Flash) reproduce intricate intra-scene morphs.

use base64::prelude::*;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Extracts sorted unique 1-based scene indices referenced in `text`
/// (e.g. `scene1`, `scene1.js`, `scene1_hook`, `Scene 2`, `scene_03`).
pub(crate) fn extract_target_scene_indices(text: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    let lower = text.to_ascii_lowercase();
    let lb = lower.as_bytes();
    let mut found = BTreeSet::new();
    let mut i = 0usize;

    while i + 5 < lb.len() {
        if &lb[i..i + 5] == b"scene" {
            let prev_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            if prev_ok {
                let mut j = i + 5;
                if j < lb.len() && matches!(lb[j], b' ' | b'_' | b'-') {
                    j += 1;
                }
                let digit_start = j;
                while j < lb.len() && lb[j].is_ascii_digit() && j - digit_start < 2 {
                    j += 1;
                }
                if j > digit_start {
                    let next_ok = j >= lb.len() || !bytes[j].is_ascii_digit();
                    if next_ok {
                        if let Ok(num) = lower[digit_start..j].parse::<usize>() {
                            if (1..=24).contains(&num) {
                                found.insert(num);
                            }
                        }
                    }
                    i = j;
                    continue;
                }
            }
        }
        i += 1;
    }

    found.into_iter().collect()
}

/// Filters `ref_report.md` to retain header/global palette, ONLY the `### Scene K:` blocks
/// matching `target_scenes`, and the bottom reconstruction directives.
pub(crate) fn filter_ref_report_for_scenes(raw_report: &str, target_scenes: &[usize]) -> String {
    if target_scenes.is_empty() {
        return raw_report.to_string();
    }
    let targets: BTreeSet<usize> = target_scenes.iter().copied().collect();
    let mut out = Vec::new();
    let mut in_scene_block = false;
    let mut keep_current_scene = true;

    for line in raw_report.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("### Scene ") {
            in_scene_block = true;
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            let scene_num = digits.parse::<usize>().ok();
            keep_current_scene = scene_num.is_some_and(|n| targets.contains(&n));
            if keep_current_scene {
                out.push(line);
            }
            continue;
        }
        if trimmed.starts_with("## ") && in_scene_block {
            in_scene_block = false;
            keep_current_scene = true;
        }
        if !in_scene_block || keep_current_scene {
            out.push(line);
        }
    }
    out.join("\n")
}

fn read_total_extracted_scenes(ws: &Path) -> usize {
    let style_path = ws.join("ref").join("extracted").join("style.json");
    std::fs::read_to_string(&style_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.get("scenes").and_then(Value::as_array).map(|a| a.len()))
        .unwrap_or(0)
}

fn encode_image_pair(ws: &Path, path: &Path) -> Option<(String, String)> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };
    let rel = path
        .strip_prefix(ws)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    Some((
        rel,
        format!("data:{};base64,{}", mime, BASE64_STANDARD.encode(&bytes)),
    ))
}

/// Clamps `target_scenes` to at most 2 scenes when the extracted reference video has `>= 4` scenes
/// AND `target_scenes.len() < total`, preventing mass-refine tasks (such as `"Refine scene 3, 4, 5, 6, 7"`)
/// from diluting vision attention and overwriting passing scenes.
pub(crate) fn clamp_target_scene_indices_for_reference(
    workspace_dir: &str,
    target_scenes: &[usize],
) -> Vec<usize> {
    if target_scenes.len() <= 2 {
        return target_scenes.to_vec();
    }
    let total = read_total_extracted_scenes(Path::new(workspace_dir));
    if total >= 4 && target_scenes.len() > 2 {
        return target_scenes[..2].to_vec();
    }
    target_scenes.to_vec()
}

/// Extracts `K` from a scene script path like `script/scene3.js` or `./script/scene12.js`.
pub(crate) fn extract_scene_script_number(file_path: &str) -> Option<usize> {
    let norm = file_path.trim().replace('\\', "/");
    let fname = norm.rsplit('/').next().unwrap_or(&norm).to_ascii_lowercase();
    let rest = fname.strip_prefix("scene")?.strip_suffix(".js")?;
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    rest.parse::<usize>().ok()
}

/// Returns true when `target_scenes` is a focused subset (1..=3 scenes, or 1..=2 scenes on `>= 4`-scene films).
pub(crate) fn is_focused_scene_subset(workspace_dir: &str, target_scenes: &[usize]) -> bool {
    let total = read_total_extracted_scenes(Path::new(workspace_dir));
    let max_batch = if total >= 4 { 2 } else { 3 };
    if target_scenes.is_empty() || target_scenes.len() > max_batch {
        return false;
    }
    total == 0 || target_scenes.len() < total
}

/// Collects vision keyframes scoped to `target_scenes` when delegating a 1..=3 scene batch,
/// prioritizing each target scene's high-res `ref_scene_0K_beats.jpg` storyboard strip plus
/// full-resolution `_q1`, `mid`, and `_q3` frames. Falls back to full-film collection otherwise.
pub(crate) fn collect_reference_vision_images_scoped(
    workspace_dir: &str,
    target_scenes: &[usize],
    max_frames: usize,
) -> Vec<(String, String)> {
    if workspace_dir.trim().is_empty() || max_frames == 0 {
        return Vec::new();
    }
    let ws = Path::new(workspace_dir);
    let frames_dir = ws.join("ref").join("extracted").join("frames");

    if frames_dir.is_dir() && is_focused_scene_subset(workspace_dir, target_scenes) {
        let mut chosen: Vec<PathBuf> = Vec::new();
        for &idx in target_scenes {
            let candidates = [
                frames_dir.join(format!("ref_scene_{idx:02}_beats.jpg")),
                frames_dir.join(format!("ref_scene_{idx:02}_q1.jpg")),
                frames_dir.join(format!("ref_scene_{idx:02}.jpg")),
                frames_dir.join(format!("ref_scene_{idx:02}_q3.jpg")),
                frames_dir.join(format!("ref_scene_{idx:02}_start.jpg")),
            ];
            let has_q1 = candidates[1].is_file();
            for (c_idx, p) in candidates.iter().enumerate() {
                if c_idx == 4 && has_q1 {
                    continue;
                }
                if p.is_file() && !chosen.contains(p) {
                    chosen.push(p.clone());
                }
            }
        }
        let encoded: Vec<(String, String)> = chosen
            .into_iter()
            .take(max_frames)
            .filter_map(|p| encode_image_pair(ws, &p))
            .collect();
        if !encoded.is_empty() {
            return encoded;
        }
    }

    super::subagent_store::collect_reference_vision_images(workspace_dir, max_frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_unique_sorted_scene_indices_from_batch_prompt() {
        let prompt = "Implement script/scene1.js (scene1_hook) and Scene 2 (`scene2_problem_or_context`). Do not touch other files.";
        assert_eq!(extract_target_scene_indices(prompt), vec![1, 2]);

        let all_eight = "Write scene1.js, scene2.js, scene3.js, scene4.js, scene5.js, scene6.js, scene7.js, scene8.js";
        assert_eq!(extract_target_scene_indices(all_eight), vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn filters_ref_report_to_only_target_scenes_and_keeps_directives() {
        let report = "\
# Reference Video Analysis Report
## Measured Color Tokens
- Primary: #0C0B0E

### Scene 1: `scene1_hook` (0.00s - 3.17s, 3.17s)
- Hero: Showreel

### Scene 2: `scene2_problem_or_context` (3.17s - 5.60s, 2.43s)
- Tilt: -2.8 deg

### Scene 3: `scene3_proof_or_demo` (5.60s - 6.67s, 1.07s)
- Hero: Making logo

## Aetheria Modular HTML5/JS Reconstruction Directives
1. VISION BEATS RAW OCR";

        let filtered = filter_ref_report_for_scenes(report, &[1, 2]);
        assert!(filtered.contains("# Reference Video Analysis Report"));
        assert!(filtered.contains("### Scene 1:"));
        assert!(filtered.contains("### Scene 2:"));
        assert!(!filtered.contains("### Scene 3:"));
        assert!(!filtered.contains("Making logo"));
        assert!(filtered.contains("## Aetheria Modular HTML5/JS Reconstruction Directives"));
    }

    #[test]
    fn clamps_mass_refine_scene_delegation_and_extracts_scene_script_number() {
        let ws = std::env::temp_dir().join(format!("aetheria_clamp_sc_{}", crate::paths::now_ms()));
        let ext_dir = ws.join("ref").join("extracted");
        std::fs::create_dir_all(&ext_dir).unwrap();
        std::fs::write(
            ext_dir.join("style.json"),
            r#"{"scenes":[{"id":"s1"},{"id":"s2"},{"id":"s3"},{"id":"s4"},{"id":"s5"},{"id":"s6"},{"id":"s7"},{"id":"s8"}]}"#,
        )
        .unwrap();
        let ws_str = ws.to_string_lossy().to_string();
        let raw = extract_target_scene_indices("Refine scene 3, scene 4, scene 5, scene 6, scene 7");
        assert_eq!(raw, vec![3, 4, 5, 6, 7]);
        let clamped = clamp_target_scene_indices_for_reference(&ws_str, &raw);
        assert_eq!(clamped, vec![3, 4]);
        assert!(is_focused_scene_subset(&ws_str, &clamped));
        assert_eq!(extract_scene_script_number("script/scene3.js"), Some(3));
        assert_eq!(extract_scene_script_number("./script/scene12.js"), Some(12));
        assert_eq!(extract_scene_script_number("script/aetheria-motion.js"), None);
        let _ = std::fs::remove_dir_all(&ws);
    }
}
