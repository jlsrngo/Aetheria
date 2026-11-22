//! Context assembly for agent turns:
//! - Workspace skills discovery (`.agents/skills`, `.opencode/skills`, `.aetheria/plugins`)
//! - Plugin rules discovery (`.aetheria/plugins/*/rules/*.md`)
//! - Base system prompt (`<env>`, `<living_memory>`, `<knowledge_base>`)
//!
//! Prompt directive & command resolvers live in [`super::command_resolvers`] (re-exported here).

pub use super::command_resolvers::{
    resolve_dynamic_style_or_skill_command, resolve_mentioned_files,
    resolve_motioncraft_style_command, resolve_reference_report,
    resolve_reference_report_for_prompt, resolve_voice_preset_command,
};

use crate::knowledge::get_active_knowledge_for_workspace;
use std::path::Path;

/// Scans workspace directory for compact skill entries bounded by turn relevance & config cap.
pub fn discover_workspace_skills(workspace_dir: &str) -> String {
    discover_workspace_skills_for_turn(workspace_dir, "")
}

pub fn discover_workspace_skills_for_turn(workspace_dir: &str, prompt_text: &str) -> String {
    let cfg = crate::provider::read_aetheria_config();
    let caps = super::dynamic_context::DynamicContextCaps::from_config(&cfg);
    let entries = super::dynamic_context::scan_workspace_skill_entries(workspace_dir);
    let (rendered, kept, total, truncated) =
        super::dynamic_context::filter_and_cap_skills(&entries, prompt_text, caps.skills_chars);
    if truncated && total > 0 {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_CONTEXT_CAP] block=skills kept={}/{} chars={} cap={}",
                kept,
                total,
                rendered.chars().count(),
                caps.skills_chars
            ),
        );
    }
    rendered
}

/// Discovers and loads active plugin rules from `.aetheria/plugins/*/rules/*.md` under cap.
pub fn discover_workspace_plugin_rules(workspace_dir: &str) -> String {
    discover_workspace_plugin_rules_for_turn(workspace_dir, "")
}

pub fn discover_workspace_plugin_rules_for_turn(workspace_dir: &str, prompt_text: &str) -> String {
    let cfg = crate::provider::read_aetheria_config();
    let caps = super::dynamic_context::DynamicContextCaps::from_config(&cfg);
    let rules = super::dynamic_context::scan_workspace_plugin_rules(workspace_dir);
    let (rendered, kept, truncated) = super::dynamic_context::filter_and_cap_plugin_rules(
        &rules,
        prompt_text,
        caps.plugin_rules_chars,
    );
    if truncated && !rules.is_empty() {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_CONTEXT_CAP] block=plugin_rules kept={}/{} chars={} cap={}",
                kept,
                rules.len(),
                rendered.chars().count(),
                caps.plugin_rules_chars
            ),
        );
    }
    rendered
}

const EMBEDDED_AM_API_REFERENCE: &str = include_str!("../../../../../.aetheria/reference/AM_API.md");

/// Returns the `window.AM` runtime reference document for video / motion-designer turns.
pub fn load_am_api_reference(workspace_dir: &str) -> String {
    if !workspace_dir.trim().is_empty() {
        let ws_override = Path::new(workspace_dir)
            .join(".aetheria")
            .join("reference")
            .join("AM_API.md");
        if ws_override.is_file() {
            if let Ok(content) = std::fs::read_to_string(&ws_override) {
                if !content.trim().is_empty() {
                    return content;
                }
            }
        }
    }
    EMBEDDED_AM_API_REFERENCE.to_string()
}

/// Returns `true` only when the turn explicitly uses a `/mg-*` Canvas skill, Microstock lock,
/// explicit `window.AM` / `film_scaffold` usage, or an existing `aetheria-motion.js` film on disk.
/// Unstyled video/showreel/reference turns stay lean without Canvas-2D API bias.
pub fn should_inject_am_api_reference(
    workspace_dir: &str,
    prompt_text: &str,
    has_explicit_skill: bool,
) -> bool {
    if crate::tool::catalog::is_greeting_prompt(prompt_text) {
        return false;
    }
    if has_explicit_skill
        || crate::studio::microstock::active_microstock_lock(workspace_dir).is_some()
    {
        return true;
    }
    let lower = prompt_text.to_ascii_lowercase();
    const AM_EXPLICIT_HINTS: &[&str] = &[
        "aetheria-motion",
        "window.am",
        "am.",
        "registerscene",
        "film_scaffold",
    ];
    if AM_EXPLICIT_HINTS.iter().any(|k| lower.contains(k)) {
        return true;
    }
    if !workspace_dir.trim().is_empty() {
        if let Some(html_path) = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir)) {
            if let Ok(html) = std::fs::read_to_string(&html_path) {
                if html.to_ascii_lowercase().contains("aetheria-motion.js") {
                    return true;
                }
            }
        }
    }
    false
}

/// Assembles complete system prompt with environment block, living memory, knowledge base, skills, and plugin rules.
pub fn assemble_system_prompt(workspace_dir: &str) -> String {
    assemble_system_prompt_for_turn(workspace_dir, "")
}

/// Loads the base prompt template dynamically in debug builds (via `AETHERIA_PROMPT_OVERRIDE_PATH`
/// or `default.txt` on disk) so prompt experiments take 0s to reload, falling back to embedded `default.txt`.
fn load_base_prompt_template() -> std::borrow::Cow<'static, str> {
    if cfg!(debug_assertions) {
        if let Ok(override_path) = std::env::var("AETHERIA_PROMPT_OVERRIDE_PATH") {
            let trimmed = override_path.trim();
            if !trimmed.is_empty() {
                if let Ok(raw) = std::fs::read_to_string(trimmed) {
                    if !raw.trim().is_empty() {
                        return std::borrow::Cow::Owned(raw);
                    }
                }
            }
        }
        let disk_path = crate::paths::project_root()
            .join("core")
            .join("aetheria-engine")
            .join("src")
            .join("session")
            .join("prompt")
            .join("default.txt");
        if let Ok(raw) = std::fs::read_to_string(&disk_path) {
            if !raw.trim().is_empty() {
                return std::borrow::Cow::Owned(raw);
            }
        }
    }
    std::borrow::Cow::Borrowed(include_str!("../prompt/default.txt"))
}

/// Assembles base system prompt plus turn-filtered & budget-capped dynamic context blocks (`F6`).
/// Uses date-only (`YYYY-MM-DD (Day)`) without clock minutes so provider prompt caches stay hot.
pub fn assemble_system_prompt_for_turn(workspace_dir: &str, prompt_text: &str) -> String {
    let base_prompt_template = load_base_prompt_template();
    let now = chrono::Local::now();
    let today_date_str = now.format("%Y-%m-%d").to_string();
    let day_of_week = now.format("%A").to_string();

    let mut sys_prompt = format!(
        "{}\n\nHere is some useful information about the environment you are running in:\n\
        <env>\n\
          Working directory: {}\n\
          Platform: {}\n\
          Today's date: {} ({})\n\
        </env>",
        base_prompt_template.trim(),
        workspace_dir,
        std::env::consts::OS,
        today_date_str,
        day_of_week,
    );

    let cfg = crate::provider::read_aetheria_config();
    let caps = super::dynamic_context::DynamicContextCaps::from_config(&cfg);

    let raw_mem = crate::session::memory::get_living_memory_for_workspace(workspace_dir);
    let raw_mem_chars = raw_mem.trim().chars().count();
    let (mut mem_body, mem_reduced) = super::dynamic_context::filter_and_cap_living_memory(
        &raw_mem,
        prompt_text,
        caps.living_memory_chars,
    );
    if mem_reduced && raw_mem_chars > 0 {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_CONTEXT_CAP] block=living_memory raw_chars={} kept_chars={} cap={}",
                raw_mem_chars,
                mem_body.chars().count(),
                caps.living_memory_chars
            ),
        );
    }

    let active_kn = get_active_knowledge_for_workspace(workspace_dir);
    let raw_kn_chars: usize = active_kn
        .iter()
        .map(|n| {
            n.get("title").and_then(|v| v.as_str()).unwrap_or("").len()
                + n.get("content").and_then(|v| v.as_str()).unwrap_or("").len()
        })
        .sum();
    let (mut kn_body, kn_kept, kn_total, kn_reduced) =
        super::dynamic_context::filter_and_cap_knowledge(&active_kn, prompt_text, caps.knowledge_chars);
    if kn_reduced && kn_total > 0 {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_CONTEXT_CAP] block=knowledge_base kept={}/{} raw_chars={} kept_chars={} cap={}",
                kn_kept,
                kn_total,
                raw_kn_chars,
                kn_body.chars().count(),
                caps.knowledge_chars
            ),
        );
    }

    let skill_entries = super::dynamic_context::scan_workspace_skill_entries(workspace_dir);
    let raw_skills_chars: usize = skill_entries
        .iter()
        .map(|e| e.name.len() + e.description.len() + e.path.len() + 14)
        .sum();
    let (mut skills_block, sk_kept, sk_total, sk_reduced) =
        super::dynamic_context::filter_and_cap_skills(&skill_entries, prompt_text, caps.skills_chars);
    if sk_reduced && sk_total > 0 {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_CONTEXT_CAP] block=skills kept={}/{} raw_chars={} kept_chars={} cap={}",
                sk_kept,
                sk_total,
                raw_skills_chars,
                skills_block.chars().count(),
                caps.skills_chars
            ),
        );
    }

    let rule_entries = super::dynamic_context::scan_workspace_plugin_rules(workspace_dir);
    let raw_rules_chars: usize = rule_entries
        .iter()
        .map(|r| r.plugin_name.len() + r.rule_name.len() + r.content.len() + 16)
        .sum();
    let (mut rules_block, rl_kept, rl_reduced) = super::dynamic_context::filter_and_cap_plugin_rules(
        &rule_entries,
        prompt_text,
        caps.plugin_rules_chars,
    );
    if rl_reduced && !rule_entries.is_empty() {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_CONTEXT_CAP] block=plugin_rules kept={}/{} raw_chars={} kept_chars={} cap={}",
                rl_kept,
                rule_entries.len(),
                raw_rules_chars,
                rules_block.chars().count(),
                caps.plugin_rules_chars
            ),
        );
    }

    let mut mem_block = if mem_body.trim().is_empty() {
        String::new()
    } else {
        format!("<living_memory>\n{}\n</living_memory>", mem_body.trim())
    };
    let mut kn_block = if kn_body.trim().is_empty() {
        String::new()
    } else {
        format!("<knowledge_base>\n{}\n</knowledge_base>", kn_body.trim())
    };
    mem_body.clear();
    kn_body.clear();

    let global_trimmed = super::dynamic_context::apply_global_dynamic_budget(
        &mut mem_block,
        &mut kn_block,
        &mut skills_block,
        &mut rules_block,
        caps.total_dynamic_chars,
    );
    let final_dyn_chars = mem_block.chars().count()
        + kn_block.chars().count()
        + skills_block.chars().count()
        + rules_block.chars().count();
    let raw_dyn_total = raw_mem_chars + raw_kn_chars + raw_skills_chars + raw_rules_chars;
    if raw_dyn_total > 0 || final_dyn_chars > 0 {
        crate::paths::log_engine(
            "context",
            &format!(
                "[F6_DYNAMIC_CONTEXT] raw_chars={} final_chars={} mem={} kn={} skills={} rules={} global_trimmed={}",
                raw_dyn_total,
                final_dyn_chars,
                mem_block.chars().count(),
                kn_block.chars().count(),
                skills_block.chars().count(),
                rules_block.chars().count(),
                global_trimmed,
            ),
        );
    }

    for block in [&mem_block, &kn_block, &skills_block, &rules_block] {
        if !block.is_empty() {
            sys_prompt.push_str("\n\n");
            sys_prompt.push_str(block);
        }
    }

    if let Some(ms_block) =
        crate::studio::microstock::build_active_microstock_prompt_block(workspace_dir)
    {
        sys_prompt.push_str("\n\n");
        sys_prompt.push_str(&ms_block);
    }

    sys_prompt
}

/// Applies thin OpenCode-style model-family prompt optimization (`plugin/optimize.ts`).
/// - Frontier Gemini models stay on the lean base prompt (zero extra bloat).
/// - Anthropic Claude appends a concise 2-line code-comment guideline.
/// - OpenAI GPT-5+ appends concise autonomy/commentary guidance.
pub fn optimize_system_prompt_for_model(sys_prompt: String, model_id: &str) -> String {
    let lower = model_id.to_ascii_lowercase();
    if lower.contains("gemini") {
        return sys_prompt;
    }
    if lower.contains("claude") || lower.contains("anthropic") {
        return format!(
            "{}\n\n# Style Note\n- Keep code comments sparse and explain *why* rather than restating *what*; skip filler preambles.",
            sys_prompt
        );
    }
    if lower.contains("gpt-5") || lower.contains("codex") {
        return format!(
            "{}\n\n# Execution Style\n- Keep intermediate commentary brief and bias toward concrete tool actions, batching independent calls in parallel.",
            sys_prompt
        );
    }
    sys_prompt
}

#[cfg(test)]
mod tests {
    use super::assemble_system_prompt;

    #[test]
    fn system_prompt_uses_registered_subagent_types() {
        let prompt = include_str!("../prompt/default.txt");
        assert!(prompt.contains("subagent_type: \"audio-director\""));
        assert!(prompt.contains("subagent_type: \"motion-designer\""));
        assert!(prompt.contains("subagent_type: \"qa-verifier\""));
        assert!(!prompt.contains("spawn_subagent(role:"));

        let tmp = std::env::temp_dir().join("aetheria_ctx_prompt_test");
        let _ = std::fs::create_dir_all(&tmp);
        let assembled = assemble_system_prompt(&tmp.to_string_lossy());
        assert!(assembled.contains("Working directory:"));
        assert!(!assembled.contains("window.AM Runtime API Reference"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn default_txt_deduped_and_am_api_selective() {
        let prompt = include_str!("../prompt/default.txt");
        assert!(!prompt.contains("Lightweight Stage Orchestrator Contract"));
        assert!(prompt.contains("AM.registerScene"));
        assert!(prompt.contains("Math.random()"));
        assert!(prompt.contains("requestAnimationFrame"));

        let tmp = std::env::temp_dir().join("aetheria_am_select_test");
        let _ = std::fs::create_dir_all(&tmp);
        let ws = tmp.to_string_lossy();
        assert!(!super::should_inject_am_api_reference(&ws, "halo", false));
        assert!(!super::should_inject_am_api_reference(
            &ws,
            "explain Rust lifetimes and borrow checker",
            false
        ));
        assert!(!super::should_inject_am_api_reference(
            &ws,
            "buatkan video showreel animasi dari referensi",
            false
        ));
        assert!(super::should_inject_am_api_reference(
            &ws,
            "/mg-flat-vector buatkan intro",
            true
        ));
        assert!(super::should_inject_am_api_reference(
            &ws,
            "edit scene1 pakai window.AM",
            false
        ));
        std::fs::write(
            tmp.join("index.html"),
            "<!doctype html><script src=\"/script/aetheria-motion.js\"></script>",
        )
        .unwrap();
        assert!(super::should_inject_am_api_reference(
            &ws,
            "perbarui warna latar",
            false
        ));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
