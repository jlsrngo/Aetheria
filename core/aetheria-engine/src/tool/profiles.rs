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
    GeneralChat,
    GeneralCode,
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
            ToolProfile::GeneralChat => "general-chat",
            ToolProfile::GeneralCode => "general-code",
            ToolProfile::General => "general",
        }
    }

    pub fn from_subagent_type(subagent_type: &str) -> Self {
        let norm = subagent_type.trim().to_ascii_lowercase().replace('_', "-");
        match norm.as_str() {
            "explore" => ToolProfile::Explore,
            "audio-director" => ToolProfile::AudioDirector,
            "motion-designer" => ToolProfile::MotionDesigner,
            "qa-verifier" => ToolProfile::QaVerifier,
            _ => ToolProfile::General,
        }
    }
}

pub fn check_tool_allowed_runtime(profile: ToolProfile, tool_name: &str) -> Result<(), String> {
    let role = profile.as_str();
    let include_render = matches!(
        profile,
        ToolProfile::Director {
            include_render: true
        }
    );
    if is_tool_allowed_in_role(role, tool_name, include_render) {
        return Ok(());
    }
    let hint = match profile {
        ToolProfile::Director { .. }
            if matches!(tool_name, "voicebox_speak" | "generate_smart_sfx") =>
        {
            "Use `film_audio` directly from director instead of per-clip voice/SFX tools."
        }
        ToolProfile::Director { .. } if tool_name == "render_video" => {
            "`render_video` is disabled unless the user explicitly asked to render/export MP4."
        }
        ToolProfile::MotionDesigner | ToolProfile::QaVerifier => {
            "Stay within your exposed scene authoring/verification tools."
        }
        ToolProfile::GeneralChat => {
            "Mutation and execution tools are disabled in chat Q&A mode."
        }
        _ => "Use only tools exposed in the active profile.",
    };
    Err(format!(
        "Tool '{}' is not permitted in active role '{}'. {}",
        tool_name, role, hint
    ))
}

pub fn is_tool_allowed_in_role(role: &str, name: &str, include_render: bool) -> bool {
    match role {
        // OpenCode/Antigravity-style full-access studio builder: direct file, terminal, and reference-probe freedom.
        "director" => {
            matches!(
                name,
                "film_scaffold"
                    | "film_audio"
                    | "capture_film_preview"
                    | "read"
                    | "write"
                    | "edit"
                    | "apply_patch"
                    | "glob"
                    | "grep"
                    | "bash"
                    | "codemode"
                    | "question"
                    | "task"
                    | "extract_video_reference"
                    | "inspect_ref_frame"
                    | "sample_ref_region"
                    | "fetch_web_image"
                    | "websearch"
                    | "webfetch"
            ) || (include_render && name == "render_video")
        }
        "motion-designer" => matches!(
            name,
            "film_scaffold"
                | "read"
                | "write"
                | "edit"
                | "apply_patch"
                | "glob"
                | "grep"
                | "bash"
                | "codemode"
                | "extract_video_reference"
                | "inspect_ref_frame"
                | "sample_ref_region"
                | "fetch_web_image"
                | "capture_film_preview"
        ),
        "qa-verifier" => matches!(
            name,
            "read"
                | "glob"
                | "grep"
                | "bash"
                | "codemode"
                | "capture_film_preview"
                | "inspect_ref_frame"
                | "sample_ref_region"
                | "edit"
                | "write"
                | "apply_patch"
                | "film_scaffold"
        ),
        "audio-director" => matches!(
            name,
            "voicebox_speak" | "generate_smart_sfx" | "read" | "write" | "glob" | "bash"
        ),
        "explore" => matches!(name, "read" | "glob" | "grep" | "websearch" | "webfetch"),
        "general-chat" => matches!(
            name,
            "read"
                | "glob"
                | "grep"
                | "webfetch"
                | "websearch"
                | "question"
                | "manage_operational_tasks"
                | "task"
        ),
        "general-code" => matches!(
            name,
            "read"
                | "write"
                | "edit"
                | "apply_patch"
                | "glob"
                | "grep"
                | "bash"
                | "codemode"
                | "lsp"
                | "snapshot"
                | "question"
                | "todowrite"
                | "manage_operational_tasks"
                | "webfetch"
                | "websearch"
                | "fetch_web_image"
                | "task"
        ),
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

/// Model-aware tool filter (mirrors OpenCode `tool/model-policy.ts`).
/// Hides redundant `apply_patch` for Gemini / Claude / OSS models when `edit` + `write` are
/// already exposed (reducing schema noise and avoiding edit-vs-patch confusion), while keeping
/// `apply_patch` exposed for GPT-5+ / Codex models that are natively tuned for unified patch syntax.
pub fn filter_tools_for_model(model_id: &str, tools: Vec<Value>) -> Vec<Value> {
    let lower = model_id.to_ascii_lowercase();
    let prefers_apply_patch = lower.contains("gpt-5") || lower.contains("codex");
    if prefers_apply_patch {
        return tools;
    }
    let has_edit_and_write = tools.iter().any(|t| {
        t.pointer("/function/name").and_then(Value::as_str) == Some("edit")
    }) && tools.iter().any(|t| {
        t.pointer("/function/name").and_then(Value::as_str) == Some("write")
    });
    if !has_edit_and_write {
        return tools;
    }
    tools
        .into_iter()
        .filter(|t| t.pointer("/function/name").and_then(Value::as_str) != Some("apply_patch"))
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

fn history_used_any_tool(history: &[Value], tool_names: &[&str]) -> bool {
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
                if tool_names.contains(&name) {
                    return true;
                }
            }
        }
    }
    false
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
    history_used_any_tool(history, VIDEO_TOOLS)
}

fn history_used_write_or_exec_tools(history: &[Value]) -> bool {
    const WRITE_TOOLS: &[&str] = &["write", "edit", "apply_patch", "bash", "codemode", "lsp"];
    history_used_any_tool(history, WRITE_TOOLS)
}

fn prompt_mentions_plugins_or_styles(prompt_text: &str) -> bool {
    let lower = prompt_text.to_ascii_lowercase();
    [
        "plugin",
        "extension",
        "mcp",
        "register_motion_style",
        "register_style",
        "plugin_install",
        "plugin_list",
    ]
    .iter()
    .any(|k| lower.contains(k))
}

fn prompt_needs_code_or_write_tools(prompt_text: &str) -> bool {
    let lower = prompt_text.to_ascii_lowercase();
    [
        "edit",
        "write",
        "buat file",
        "create file",
        "hapus file",
        "delete file",
        "ubah ",
        "perbaiki",
        "fix ",
        "bug",
        "error",
        "refactor",
        "patch",
        "apply_patch",
        "codemode",
        "bash",
        "run ",
        "jalankan",
        "cargo ",
        "npm ",
        "npx ",
        "vitest",
        "pytest",
        "git ",
        "src-tauri",
        ".rs",
        ".ts",
        ".tsx",
        ".js",
        ".py",
        ".json",
        ".xlsx",
        ".docx",
        ".pdf",
        "spreadsheet",
        "dokumen",
        "skrip",
        "script",
    ]
    .iter()
    .any(|k| lower.contains(k))
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

/// Selects `Director` on video-production turns, or narrows non-video turns to
/// `General` (plugins), `GeneralCode` (workspace editing/commands), or `GeneralChat` (lightweight Q&A).
pub fn resolve_coordinator_profile(
    workspace_dir: &str,
    prompt_text: &str,
    history: &[Value],
) -> ToolProfile {
    let lower = prompt_text.to_ascii_lowercase();
    let explicitly_non_video = lower.contains("non-video")
        || lower.contains("non video")
        || lower.contains("bukan video")
        || lower.contains("not a video");

    let has_slash_media = lower.contains("/mg-")
        || lower.contains("/adobe-stock")
        || lower.contains("/conspiracy-crime-board")
        || lower.contains("/editorial-kinetic")
        || lower.contains("/audio:")
        || lower.contains("/voice:")
        || lower.contains("/preset:")
        || lower.contains("/ref");

    let has_video_keywords = !explicitly_non_video
        && [
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

    let in_video_flow = !explicitly_non_video
        && !prompt_looks_like_general_engineering(prompt_text)
        && (has_slash_media
            || has_video_keywords
            || crate::studio::microstock::active_microstock_lock(workspace_dir).is_some()
            || history_used_video_tools(history));

    if in_video_flow {
        ToolProfile::Director {
            include_render: prompt_explicitly_requests_render(prompt_text),
        }
    } else if prompt_mentions_plugins_or_styles(prompt_text) {
        ToolProfile::General
    } else if prompt_needs_code_or_write_tools(prompt_text)
        || history_used_write_or_exec_tools(history)
        || (!history.is_empty()
            && [
                "lanjut",
                "teruskan",
                "continue",
                "coba",
                "cek",
                "benerin",
                "rapikan",
                "lakukan",
                "kerjakan",
                "do it",
                "go ahead",
            ]
            .iter()
            .any(|k| lower.contains(k)))
    {
        ToolProfile::GeneralCode
    } else {
        ToolProfile::GeneralChat
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
                "apply_patch",
                "bash",
                "capture_film_preview",
                "codemode",
                "edit",
                "extract_video_reference",
                "fetch_web_image",
                "film_audio",
                "film_scaffold",
                "glob",
                "grep",
                "inspect_ref_frame",
                "question",
                "read",
                "sample_ref_region",
                "task",
                "webfetch",
                "websearch",
                "write",
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
                "apply_patch",
                "bash",
                "capture_film_preview",
                "codemode",
                "edit",
                "extract_video_reference",
                "fetch_web_image",
                "film_audio",
                "film_scaffold",
                "glob",
                "grep",
                "inspect_ref_frame",
                "question",
                "read",
                "render_video",
                "sample_ref_region",
                "task",
                "webfetch",
                "websearch",
                "write",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::MotionDesigner,
                catalog.clone()
            )),
            vec![
                "apply_patch",
                "bash",
                "capture_film_preview",
                "codemode",
                "edit",
                "extract_video_reference",
                "fetch_web_image",
                "film_scaffold",
                "glob",
                "grep",
                "inspect_ref_frame",
                "read",
                "sample_ref_region",
                "write",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::QaVerifier,
                catalog.clone()
            )),
            vec![
                "apply_patch",
                "bash",
                "capture_film_preview",
                "codemode",
                "edit",
                "film_scaffold",
                "glob",
                "grep",
                "inspect_ref_frame",
                "read",
                "sample_ref_region",
                "write",
            ]
        );

        assert_eq!(
            sorted_names(filter_tools_for_profile(
                ToolProfile::AudioDirector,
                catalog.clone()
            )),
            vec![
                "bash",
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

        let general_chat = sorted_names(filter_tools_for_profile(
            ToolProfile::GeneralChat,
            catalog.clone(),
        ));
        assert_eq!(
            general_chat,
            vec![
                "glob",
                "grep",
                "manage_operational_tasks",
                "question",
                "read",
                "task",
                "webfetch",
                "websearch",
            ]
        );

        let general_code = sorted_names(filter_tools_for_profile(
            ToolProfile::GeneralCode,
            catalog.clone(),
        ));
        assert!(!general_code.contains(&"film_scaffold".to_string()));
        assert!(!general_code.contains(&"plugin_install".to_string()));
        assert!(general_code.contains(&"edit".to_string()));
        assert!(general_code.contains(&"bash".to_string()));

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
            ToolProfile::GeneralChat
        );
        assert_eq!(
            resolve_coordinator_profile(&ws, "Periksa error cargo test di backend", &[]),
            ToolProfile::GeneralCode
        );
        assert_eq!(
            resolve_coordinator_profile(&ws, "Tugas non-video: buat file hello.txt", &[]),
            ToolProfile::GeneralCode
        );
        assert_eq!(
            resolve_coordinator_profile(&ws, "Install plugin baru via plugin_install", &[]),
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

        assert!(check_tool_allowed_runtime(
            ToolProfile::Director {
                include_render: false
            },
            "write"
        )
        .is_ok());
        assert!(check_tool_allowed_runtime(
            ToolProfile::Director {
                include_render: false
            },
            "edit"
        )
        .is_ok());
        assert!(check_tool_allowed_runtime(
            ToolProfile::Director {
                include_render: false
            },
            "render_video"
        )
        .is_err());
        assert!(check_tool_allowed_runtime(ToolProfile::GeneralChat, "bash").is_err());
        assert_eq!(
            ToolProfile::from_subagent_type("motion_designer"),
            ToolProfile::MotionDesigner
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
