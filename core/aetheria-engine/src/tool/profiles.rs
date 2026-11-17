//! Data-Driven Role Tool Profiles (`F3`).
//!
//! All tools remain registered in `catalog.rs`; this module decides which tools
//! are attached to each role / turn so video roles see only creative/studio tools
//! while general non-video turns retain the full engineering toolset.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolProfile {
    Director { include_render: bool },
    MotionDesigner,
    QaVerifier,
    AudioDirector,
    Explore,
    General,
}

impl ToolProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolProfile::Director { .. } => "director",
            ToolProfile::MotionDesigner => "motion-designer",
            ToolProfile::QaVerifier => "qa-verifier",
            ToolProfile::AudioDirector => "audio-director",
            ToolProfile::Explore => "explore",
            ToolProfile::General => "general",
        }
    }
}

pub fn is_tool_allowed_in_role(role: &str, name: &str, include_render: bool) -> bool {
    match role {
        "director" => {
            matches!(
                name,
                "film_scaffold"
                    | "film_audio"
                    | "capture_film_preview"
                    | "read"
                    | "glob"
                    | "grep"
                    | "question"
                    | "task"
                    | "extract_video_reference"
                    | "fetch_web_image"
            ) || (include_render && name == "render_video")
        }
        "motion-designer" => matches!(
            name,
            "film_scaffold"
                | "read"
                | "write"
                | "edit"
                | "glob"
                | "grep"
                | "fetch_web_image"
                | "capture_film_preview"
        ),
        "qa-verifier" => matches!(
            name,
            "read"
                | "glob"
                | "grep"
                | "capture_film_preview"
                | "edit"
                | "write"
                | "film_scaffold"
        ),
        "audio-director" => matches!(
            name,
            "voicebox_speak" | "generate_smart_sfx" | "read" | "write" | "glob"
        ),
        "explore" => matches!(name, "read" | "glob" | "grep" | "websearch" | "webfetch"),
        "general" => !matches!(name, "voicebox_speak" | "generate_smart_sfx"),
        _ => true,
    }
}

pub fn filter_tools_for_profile(profile: ToolProfile, all_tools: Vec<Value>) -> Vec<Value> {
    let role = profile.as_str();
    let include_render = matches!(
        profile,
        ToolProfile::Director {
            include_render: true
        }
    );
    all_tools
        .into_iter()
        .filter(|t| {
            let name = t
                .pointer("/function/name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            is_tool_allowed_in_role(role, name, include_render)
        })
        .collect()
}

pub fn prompt_explicitly_requests_render(prompt_text: &str) -> bool {
    let lower = prompt_text.to_ascii_lowercase();
    [
        "render sekarang ke mp4",
        "render video ini",
        "render ke mp4",
        "ekspor mp4",
        "export mp4",
        "export ke mp4",
        "render mp4",
        "render_video",
    ]
    .iter()
    .any(|p| lower.contains(p))
}

fn history_used_video_tools(history: &[Value]) -> bool {
    const VIDEO_TOOLS: &[&str] = &[
        "film_scaffold",
        "film_audio",
        "capture_film_preview",
        "render_video",
        "extract_video_reference",
        "produce_video",
    ];
    for msg in history {
        let parts = msg
            .get("parts")
            .or_else(|| msg.get("content"))
            .and_then(|v| v.as_array());
        if let Some(arr) = parts {
            for p in arr {
                let name = p
                    .get("tool")
                    .or_else(|| p.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if VIDEO_TOOLS.contains(&name) {
                    return true;
                }
            }
        }
    }
    false
}

fn prompt_looks_like_general_engineering(prompt_text: &str) -> bool {
    let lower = prompt_text.to_ascii_lowercase();
    [
        "cargo test",
        "vitest",
        "npm run",
        "pytest",
        "src-tauri",
        ".rs ",
        ".tsx",
        "git status",
        "git diff",
        "plugin_install",
        "plugin_list",
    ]
    .iter()
    .any(|k| lower.contains(k))
}

/// Selects `Director` on video-production turns and `General` on non-video chat/coding turns.
pub fn resolve_coordinator_profile(
    workspace_dir: &str,
    prompt_text: &str,
    history: &[Value],
) -> ToolProfile {
    let lower = prompt_text.to_ascii_lowercase();
    let has_slash_media = lower.contains("/mg-")
        || lower.contains("/adobe-stock")
        || lower.contains("/conspiracy-crime-board")
        || lower.contains("/editorial-kinetic")
        || lower.contains("/audio:")
        || lower.contains("/voice:")
        || lower.contains("/preset:")
        || lower.contains("/ref");

    let has_video_keywords = [
        "video",
        "film",
        "animasi",
        "animation",
        "motion graphics",
        "motion design",
        "storyboard",
        "film_scaffold",
        "film_audio",
        "capture_film_preview",
        "extract_video_reference",
        "render_video",
        "render mp4",
        "ekspor mp4",
        "render sekarang",
        "aetheria-motion",
        "tiktok",
        "reels",
        "shorts",
        "microstock",
        "voiceover",
        "sulih suara",
        "narasi",
        "scene1",
        "scene ",
        "adegan",
    ]
    .iter()
    .any(|k| lower.contains(k));

    let in_video_flow = !prompt_looks_like_general_engineering(prompt_text)
        && (has_slash_media
            || has_video_keywords
            || crate::studio::microstock::active_microstock_lock(workspace_dir).is_some()
            || history_used_video_tools(history));

    if in_video_flow {
        ToolProfile::Director {
            include_render: prompt_explicitly_requests_render(prompt_text),
        }
    } else {
        ToolProfile::General
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::catalog::build_tool_definitions;

    fn sorted_names(defs: Vec<Value>) -> Vec<String> {
        let mut names: Vec<String> = defs
            .into_iter()
            .filter_map(|t| {
                t.pointer("/function/name")
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn snapshot_tool_profiles_match_f3_allowlists() {
        let catalog = build_tool_definitions();

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::Director {
                    include_render: false
                },
                catalog.clone()
            )),
            vec![
                "capture_film_preview",
                "extract_video_reference",
                "fetch_web_image",
                "film_audio",
                "film_scaffold",
                "glob",
                "grep",
                "question",
                "read",
                "task",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::Director {
                    include_render: true
                },
                catalog.clone()
            )),
            vec![
                "capture_film_preview",
                "extract_video_reference",
                "fetch_web_image",
                "film_audio",
                "film_scaffold",
                "glob",
                "grep",
                "question",
                "read",
                "render_video",
                "task",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::MotionDesigner,
                catalog.clone()
            )),
            vec![
                "capture_film_preview",
                "edit",
                "fetch_web_image",
                "film_scaffold",
                "glob",
                "grep",
                "read",
                "write",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::QaVerifier,
                catalog.clone()
            )),
            vec![
                "capture_film_preview",
                "edit",
                "film_scaffold",
                "glob",
                "grep",
                "read",
                "write",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::AudioDirector,
                catalog.clone()
            )),
            vec![
                "generate_smart_sfx",
                "glob",
                "read",
                "voicebox_speak",
                "write",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(ToolProfile::Explore, catalog.clone())),
            vec!["glob", "grep", "read", "webfetch", "websearch"]
        );

        let general = sorted_names(filter_tools_for_profile(ToolProfile::General, catalog));
        assert!(!general.contains(&"voicebox_speak".to_string()));
        assert!(!general.contains(&"generate_smart_sfx".to_string()));
        for expected in ["bash", "apply_patch", "codemode", "edit", "write", "lsp", "task", "plugin_install"] {
            assert!(
                general.contains(&expected.to_string()),
                "general profile missing {}",
                expected
            );
        }
    }

    #[test]
    fn coordinator_profile_routes_video_vs_general_cleanly() {
        let tmp = std::env::temp_dir().join("aetheria_profile_route_test");
        let _ = std::fs::create_dir_all(&tmp);
        let ws = tmp.to_string_lossy();

        assert_eq!(
            resolve_coordinator_profile(&ws, "Jelaskan perbedaan const dan let", &[]),
            ToolProfile::General
        );
        assert_eq!(
            resolve_coordinator_profile(&ws, "Periksa error cargo test di backend", &[]),
            ToolProfile::General
        );
        assert_eq!(
            resolve_coordinator_profile(&ws, "/mg-flat-vector Buatkan video 2 scene", &[]),
            ToolProfile::Director {
                include_render: false
            }
        );
        assert_eq!(
            resolve_coordinator_profile(&ws, "Render sekarang ke mp4 video kopi ini", &[]),
            ToolProfile::Director {
                include_render: true
            }
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
