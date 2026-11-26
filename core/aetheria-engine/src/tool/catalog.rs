//! Tool Schema Catalog & Prompt Tool-Attachment Gate.
//!
//! Decides whether document/studio tools should be exposed on a turn
//! and assembles the OpenAI-compatible tool definitions list for the LLM.

use serde_json::{json, Value};

use super::{
    apply_patch, bash, codemode, edit, fetch_web_image, film_audio, film_scaffold, glob, grep, lsp,
    preview_film, question, read, ref_extractor, ref_filmstrip, ref_probe, render, sfx, skill_manager, snapshot,
    storyboard, tasks, todo, voicebox, webfetch, websearch, write,
};

pub fn is_greeting_prompt(prompt_text: &str) -> bool {
    let clean: String = prompt_text
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    let lower = clean.trim().to_lowercase();
    if lower.is_empty() {
        return true;
    }
    matches!(
        lower.as_str(),
        "halo"
            | "hello"
            | "hi"
            | "hey"
            | "hai"
            | "pagi"
            | "siang"
            | "sore"
            | "malam"
            | "tes"
            | "test"
            | "ping"
            | "halo nexus"
            | "hai nexus"
            | "hey nexus"
            | "assalamualaikum"
            | "assalamu alaikum"
            | "selamat pagi"
            | "selamat siang"
            | "selamat sore"
            | "selamat malam"
    ) || (lower.len() <= 6
        && (lower.starts_with("hi")
            || lower.starts_with("halo")
            || lower.starts_with("hey")
            || lower.starts_with("hai")))
}

pub fn should_attach_document_tools(prompt_text: &str, _history: &[Value]) -> bool {
    // Never attach tools for casual greetings, pings, or empty inputs.
    // This strictly prevents the LLM from hallucinating studio tasks, voiceover synthesis, or web image downloads.
    if is_greeting_prompt(prompt_text) {
        return false;
    }
    true
}

pub fn build_tool_definitions() -> Vec<Value> {
    let mut tools = vec![
        film_audio::film_audio_tool_definition(),
        film_scaffold::film_scaffold_tool_definition(),
        storyboard::produce_video_tool_definition(),
        render::render_video_tool_definition(),
        preview_film::capture_film_preview_tool_definition(),
        voicebox::voicebox_tool_definition(),
        sfx::sfx_tool_definition(),
        ref_extractor::ref_extractor_tool_definition(),
        ref_filmstrip::read_filmstrip_tool_definition(),
        ref_probe::inspect_ref_frame_tool_definition(),
        ref_probe::sample_ref_region_tool_definition(),
        fetch_web_image::fetch_web_image_tool_definition(),
        read::read_tool_definition(),
        write::write_tool_definition(),
        edit::edit_tool_definition(),
        glob::glob_tool_definition(),
        grep::grep_tool_definition(),
        todo::todo_tool_definition(),
        websearch::websearch_tool_definition(),
        question::question_tool_definition(),
        tasks::tasks_tool_definition(),
        bash::bash_tool_definition(),
        apply_patch::apply_patch_tool_definition(),
        webfetch::webfetch_tool_definition(),
        lsp::lsp_tool_definition(),
        snapshot::snapshot_tool_definition(),
        codemode::codemode_tool_definition(),
        register_style_tool_definition(),
        delete_style_tool_definition(),
        crate::session::agent_turn::subagent::spawn_subagent_tool_definition(),
    ];
    tools.extend(skill_manager::skill_tool_definitions());
    tools
}

pub fn register_style_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "register_motion_style",
            "description": "Promotes an approved declarative motion skill package (SKILL.md + examples/kit.json + examples/script/<slug>-kit.js + examples/story.example.json + assets/kit-gallery.jpg) from a workspace `draft_dir` or `files[]` into `.aetheria/skills/<slug>/` so it becomes a reusable `/<slug>` command. Only call after explicit user approval via `question`.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Kebab-case skill slug, e.g. 'cobalt-editorial' or 'cyber-neon'"
                    },
                    "draft_dir": {
                        "type": "string",
                        "description": "Relative workspace path to a draft skill directory containing SKILL.md and optional examples/ & assets/ (e.g. 'projects/my-ref/draft-skill')"
                    },
                    "files": {
                        "type": "array",
                        "description": "Optional multi-file skill package payload when registering directly in-memory",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string" },
                                "content": { "type": "string" }
                            },
                            "required": ["path", "content"]
                        }
                    },
                    "file_path": {
                        "type": "string",
                        "description": "Optional path to a local SKILL.md file or skill package directory"
                    },
                    "content": {
                        "type": "string",
                        "description": "Optional inline SKILL.md markdown content"
                    },
                    "description": {
                        "type": "string",
                        "description": "Short human-readable summary of the skill style"
                    },
                    "origin": {
                        "type": "string",
                        "enum": ["reference", "custom", "imported"],
                        "description": "Skill origin tag (use 'reference' when created from a reference video)"
                    },
                    "source_video": {
                        "type": "string",
                        "description": "Optional source reference video filename (e.g. 'ref_pinterest.mp4')"
                    }
                },
                "required": ["name"]
            }
        }
    })
}

pub fn delete_style_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "delete_motion_style",
            "description": "Deletes a user-created or reference-created custom skill from `.aetheria/skills/<slug>/`. Built-in skills are protected and cannot be deleted.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The custom skill slug or command to delete (e.g. 'cobalt-ref' or '/cobalt-ref')"
                    }
                },
                "required": ["name"]
            }
        }
    })
}
