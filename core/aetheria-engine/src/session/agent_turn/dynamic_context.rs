//! Turn-Aware Relevance Filtering & Configurable Caps for Dynamic System Context (`F6`).
//! Keeps `<living_memory>`, `<knowledge_base>`, `<skills>`, and `<plugin_rules>` bounded,
//! focused on the current turn's intent, and explicitly logged when truncated or filtered.

use crate::tool::is_greeting_prompt;
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

pub(crate) const DEFAULT_MAX_LIVING_MEMORY_CHARS: usize = 900;
pub(crate) const DEFAULT_MAX_KNOWLEDGE_CHARS: usize = 1500;
pub(crate) const DEFAULT_MAX_SKILLS_CHARS: usize = 1600;
pub(crate) const DEFAULT_MAX_PLUGIN_RULES_CHARS: usize = 1500;
pub(crate) const DEFAULT_MAX_DYNAMIC_CHARS: usize = 3500;
const DEFAULT_MAX_CATALOG_FILES_IN_MEMORY: usize = 8;
const DEFAULT_MAX_KNOWLEDGE_NOTES: usize = 5;
const DEFAULT_MAX_NOTE_BODY_CHARS: usize = 320;
const DEFAULT_MAX_SKILL_DESC_CHARS: usize = 72;

#[derive(Debug, Clone, Copy)]
pub(crate) struct DynamicContextCaps {
    pub living_memory_chars: usize,
    pub knowledge_chars: usize,
    pub skills_chars: usize,
    pub plugin_rules_chars: usize,
    pub total_dynamic_chars: usize,
}

impl Default for DynamicContextCaps {
    fn default() -> Self {
        Self {
            living_memory_chars: DEFAULT_MAX_LIVING_MEMORY_CHARS,
            knowledge_chars: DEFAULT_MAX_KNOWLEDGE_CHARS,
            skills_chars: DEFAULT_MAX_SKILLS_CHARS,
            plugin_rules_chars: DEFAULT_MAX_PLUGIN_RULES_CHARS,
            total_dynamic_chars: DEFAULT_MAX_DYNAMIC_CHARS,
        }
    }
}

impl DynamicContextCaps {
    pub fn from_config(cfg: &Value) -> Self {
        let pick = |key: &str, fallback: usize| -> usize {
            cfg.pointer(&format!("/context/{}", key))
                .and_then(Value::as_u64)
                .map(|n| n as usize)
                .unwrap_or(fallback)
        };
        Self {
            living_memory_chars: pick("maxLivingMemoryChars", DEFAULT_MAX_LIVING_MEMORY_CHARS),
            knowledge_chars: pick("maxKnowledgeChars", DEFAULT_MAX_KNOWLEDGE_CHARS),
            skills_chars: pick("maxSkillsChars", DEFAULT_MAX_SKILLS_CHARS),
            plugin_rules_chars: pick("maxPluginRulesChars", DEFAULT_MAX_PLUGIN_RULES_CHARS),
            total_dynamic_chars: pick("maxDynamicChars", DEFAULT_MAX_DYNAMIC_CHARS),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DiscoveredSkillEntry {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Debug, Clone)]
pub(crate) struct DiscoveredPluginRule {
    pub plugin_name: String,
    pub rule_name: String,
    pub content: String,
    pub always_apply: bool,
}

fn truncate_utf8_with_ellipsis(text: &str, max_chars: usize) -> (String, bool) {
    let total = text.chars().count();
    if total <= max_chars {
        return (text.to_string(), false);
    }
    if max_chars <= 3 {
        return (text.chars().take(max_chars).collect(), true);
    }
    let kept: String = text.chars().take(max_chars - 3).collect();
    (format!("{}...", kept.trim_end()), true)
}

fn is_actual_greeting(prompt_text: &str) -> bool {
    !prompt_text.trim().is_empty() && is_greeting_prompt(prompt_text)
}

fn tokenize_query(prompt_text: &str) -> Vec<String> {
    let stop: HashSet<&str> = [
        "the", "and", "for", "with", "that", "this", "from", "into", "your", "make", "create",
        "build", "please", "tolong", "buat", "buatkan", "video", "yang", "dan", "untuk", "dengan",
        "dari", "pada", "ini", "itu", "atau", "akan", "saya", "aku",
    ]
    .into_iter()
    .collect();

    prompt_text
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| s.len() >= 3 && !stop.contains(s.as_str()))
        .collect()
}

fn extract_explicit_slash_skill(prompt_text: &str) -> Option<String> {
    let lower = prompt_text.trim().to_ascii_lowercase();
    for token in lower.split_whitespace() {
        let clean = token.trim_matches(|c: char| ",.!?:;\"'()[]{}".contains(c));
        if let Some(rest) = clean.strip_prefix('/') {
            if !rest.is_empty() && !rest.starts_with("audio") && !rest.contains('/') {
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn is_video_or_style_prompt(prompt_text: &str) -> bool {
    let lower = prompt_text.to_ascii_lowercase();
    const KEYWORDS: &[&str] = &[
        "video", "film", "animasi", "animation", "scene", "motion", "studio", "render", "mp4",
        "microstock", "adobe stock", "voiceover", "narasi", "subtitle", "skill", "style", "mg-",
        "3d", "webgl", "canvas", "svg", "tiktok", "reels", "shorts",
    ];
    KEYWORDS.iter().any(|k| lower.contains(k))
}

fn score_relevance(tokens: &[String], haystack: &str) -> usize {
    if tokens.is_empty() {
        return 0;
    }
    let lower = haystack.to_ascii_lowercase();
    let mut hits = 0usize;
    for tok in tokens {
        if lower.contains(tok.as_str()) {
            hits += 1;
        }
    }
    hits
}

/// Compacts `## Workspace Catalog` bloat and enforces `max_chars` cap on `<living_memory>`.
pub(crate) fn filter_and_cap_living_memory(
    raw: &str,
    prompt_text: &str,
    max_chars: usize,
) -> (String, bool) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || max_chars == 0 || is_actual_greeting(prompt_text) {
        return (String::new(), !trimmed.is_empty());
    }

    let mut out_lines: Vec<String> = Vec::new();
    let mut in_catalog = false;
    let mut catalog_kept = 0usize;
    let mut catalog_omitted = 0usize;
    let mut total_catalog_omitted = 0usize;

    for line in trimmed.lines() {
        let ltrim = line.trim_start();
        if ltrim.starts_with("## ") {
            if in_catalog && catalog_omitted > 0 {
                total_catalog_omitted += catalog_omitted;
                out_lines.push(format!(
                    "- ... ({} more files; inspect via `glob`)",
                    catalog_omitted
                ));
            }
            in_catalog = ltrim.starts_with("## Workspace Catalog");
            catalog_kept = 0;
            catalog_omitted = 0;
            out_lines.push(line.to_string());
            continue;
        }
        if ltrim.starts_with("<!--") && ltrim.ends_with("-->") {
            continue;
        }
        if in_catalog && ltrim.starts_with("- ") {
            if catalog_kept < DEFAULT_MAX_CATALOG_FILES_IN_MEMORY {
                out_lines.push(line.to_string());
                catalog_kept += 1;
            } else {
                catalog_omitted += 1;
            }
            continue;
        }
        out_lines.push(line.to_string());
    }
    if in_catalog && catalog_omitted > 0 {
        total_catalog_omitted += catalog_omitted;
        out_lines.push(format!(
            "- ... ({} more files; inspect via `glob`)",
            catalog_omitted
        ));
    }

    let compacted = out_lines.join("\n").trim().to_string();
    let (capped, hit_char_cap) = truncate_utf8_with_ellipsis(&compacted, max_chars);
    let was_reduced = hit_char_cap || total_catalog_omitted > 0;
    (capped, was_reduced)
}

/// Filters active knowledge notes by turn relevance and enforces char/note budget.
pub(crate) fn filter_and_cap_knowledge(
    nodes: &[Value],
    prompt_text: &str,
    max_chars: usize,
) -> (String, usize, usize, bool) {
    let total = nodes.len();
    if nodes.is_empty() || max_chars == 0 || is_actual_greeting(prompt_text) {
        return (String::new(), 0, total, total > 0);
    }

    let query_tokens = tokenize_query(prompt_text);
    let has_query = !prompt_text.trim().is_empty() && !query_tokens.is_empty();

    let mut ranked: Vec<(bool, usize, usize, String, String)> = Vec::new();
    for (idx, n) in nodes.iter().enumerate() {
        let title = n.get("title").and_then(Value::as_str).unwrap_or("Note").trim();
        let content = n.get("content").and_then(Value::as_str).unwrap_or("").trim();
        let tags = n
            .get("tags")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();
        let pinned = n
            .get("pinned")
            .or_else(|| n.get("alwaysInject"))
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let haystack = format!("{} {} {}", title, tags, content);
        let score = score_relevance(&query_tokens, &haystack);
        if has_query && !pinned && score == 0 {
            continue;
        }
        let (short_body, _) = truncate_utf8_with_ellipsis(content, DEFAULT_MAX_NOTE_BODY_CHARS);
        ranked.push((pinned, score, idx, title.to_string(), short_body));
    }

    ranked.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| a.2.cmp(&b.2))
    });

    let mut out = String::new();
    let mut kept = 0usize;
    let mut truncated = ranked.len() < total;

    for (_, _, _, title, body) in ranked.into_iter().take(DEFAULT_MAX_KNOWLEDGE_NOTES) {
        let entry = format!("--- {} ---\n{}\n", title, body);
        if out.len() + entry.len() > max_chars {
            let remaining = max_chars.saturating_sub(out.len());
            if remaining > 32 && kept == 0 {
                let (partial, _) = truncate_utf8_with_ellipsis(&entry, remaining);
                out.push_str(&partial);
                kept += 1;
            }
            truncated = true;
            break;
        }
        out.push_str(&entry);
        kept += 1;
    }

    if total > kept {
        truncated = true;
    }
    (out.trim_end().to_string(), kept, total, truncated)
}

/// Scans workspace and `.aetheria/skills/` for skill metadata entries (deterministic order).
pub(crate) fn scan_workspace_skill_entries(workspace_dir: &str) -> Vec<DiscoveredSkillEntry> {
    let mut search_paths = Vec::new();
    let ws = Path::new(workspace_dir);
    for sub in [".aetheria/skills", ".agents/skills", "skills", ".opencode/skills"] {
        let p = ws.join(sub);
        if p.exists() && p.is_dir() {
            search_paths.push(p);
        }
    }
    let plugins_dir = ws.join(".aetheria").join("plugins");
    if plugins_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    search_paths.push(p.clone());
                    let sk = p.join("skills");
                    if sk.is_dir() {
                        search_paths.push(sk);
                    }
                }
            }
        }
    }
    let repo_root = crate::paths::project_root();
    if repo_root != ws {
        for sub in [".aetheria/skills", ".agents/skills", ".opencode/skills"] {
            let p = repo_root.join(sub);
            if p.exists() && p.is_dir() {
                search_paths.push(p);
            }
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for base in search_paths {
        let Ok(entries) = std::fs::read_dir(&base) else {
            continue;
        };
        let mut sorted: Vec<_> = entries.flatten().collect();
        sorted.sort_by_key(|e| e.file_name());
        for entry in sorted {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_md = path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            if !seen.insert(dir_name.clone()) {
                continue;
            }
            let content = std::fs::read_to_string(&skill_md).unwrap_or_default();
            let mut s_name = dir_name.clone();
            let mut s_desc = String::new();
            for line in content.lines().take(30) {
                let ltrim = line.trim();
                if let Some(rest) = ltrim.strip_prefix("name:") {
                    let val = rest.trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() {
                        s_name = val.to_string();
                    }
                } else if let Some(rest) = ltrim.strip_prefix("description:") {
                    let val = rest.trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() {
                        s_desc = val.to_string();
                    }
                }
            }
            if s_desc.is_empty() {
                s_desc = format!("Motion skill {}", s_name);
            }
            out.push(DiscoveredSkillEntry {
                slug: dir_name,
                name: s_name,
                description: s_desc,
                path: skill_md.to_string_lossy().to_string(),
            });
        }
    }

    out
}

/// Filters discovered skills by turn relevance and emits compact `<skills>` directory under cap.
pub(crate) fn filter_and_cap_skills(
    entries: &[DiscoveredSkillEntry],
    prompt_text: &str,
    max_chars: usize,
) -> (String, usize, usize, bool) {
    let total = entries.len();
    if entries.is_empty() || max_chars == 0 || is_actual_greeting(prompt_text) {
        return (String::new(), 0, total, total > 0);
    }

    let trimmed = prompt_text.trim();
    let explicit_slug = extract_explicit_slash_skill(trimmed);
    let query_tokens = tokenize_query(trimmed);
    let video_prompt = is_video_or_style_prompt(trimmed);

    let selected: Vec<&DiscoveredSkillEntry> = if let Some(ref slash) = explicit_slug {
        let matched: Vec<_> = entries
            .iter()
            .filter(|e| {
                e.slug.eq_ignore_ascii_case(slash)
                    || e.name.eq_ignore_ascii_case(slash)
                    || e.slug.to_ascii_lowercase().contains(slash.as_str())
            })
            .collect();
        if matched.is_empty() {
            entries.iter().collect()
        } else {
            matched
        }
    } else if !trimmed.is_empty() && !video_prompt {
        entries
            .iter()
            .filter(|e| {
                score_relevance(&query_tokens, &format!("{} {} {}", e.slug, e.name, e.description))
                    > 0
            })
            .collect()
    } else {
        entries.iter().collect()
    };

    if selected.is_empty() {
        return (String::new(), 0, total, total > 0);
    }

    let mut lines = Vec::new();
    let header = "<skills>\nMotion/domain skills in `.aetheria/skills/<name>/SKILL.md` (call `read` to inspect; use `/<name>` to lock):\n";
    let footer = "\n</skills>";
    let mut used = header.len() + footer.len();
    let mut kept = 0usize;
    let mut truncated = selected.len() < total;

    for e in &selected {
        let (short_desc, _) = truncate_utf8_with_ellipsis(&e.description, DEFAULT_MAX_SKILL_DESC_CHARS);
        let line = if explicit_slug.is_some() {
            format!("- {}: {} ({})", e.name, short_desc, e.path)
        } else {
            format!("- {}: {}", e.name, short_desc)
        };
        let added = line.len() + 1;
        if used + added > max_chars {
            truncated = true;
            break;
        }
        used += added;
        lines.push(line);
        kept += 1;
    }

    if lines.is_empty() {
        return (String::new(), 0, total, true);
    }

    let omitted = total.saturating_sub(kept);
    if omitted > 0 && explicit_slug.is_none() {
        let note = format!("- ... ({} more skill(s) in `.aetheria/skills/`)", omitted);
        if used + note.len() + 1 <= max_chars {
            lines.push(note);
        }
        truncated = true;
    }

    let rendered = format!("{}{}{}", header, lines.join("\n"), footer);
    (rendered, kept, total, truncated)
}

pub(crate) fn scan_workspace_plugin_rules(workspace_dir: &str) -> Vec<DiscoveredPluginRule> {
    let mut out = Vec::new();
    let plugins_dir = Path::new(workspace_dir).join(".aetheria").join("plugins");
    if !plugins_dir.exists() || !plugins_dir.is_dir() {
        return out;
    }
    let Ok(plugins) = std::fs::read_dir(&plugins_dir) else {
        return out;
    };
    let mut plugin_dirs: Vec<_> = plugins.flatten().collect();
    plugin_dirs.sort_by_key(|e| e.file_name());
    for entry in plugin_dirs {
        let p_path = entry.path();
        if !p_path.is_dir() {
            continue;
        }
        let plugin_name = entry.file_name().to_string_lossy().to_string();
        let rules_dir = p_path.join("rules");
        if !rules_dir.exists() || !rules_dir.is_dir() {
            continue;
        }
        let Ok(rules) = std::fs::read_dir(&rules_dir) else {
            continue;
        };
        let mut rule_files: Vec<_> = rules.flatten().collect();
        rule_files.sort_by_key(|e| e.file_name());
        for r_entry in rule_files {
            let r_path = r_entry.path();
            if !r_path.is_file() {
                continue;
            }
            let rule_name = r_entry.file_name().to_string_lossy().to_string();
            if !rule_name.ends_with(".md") && !rule_name.ends_with(".mdc") {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&r_path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    let lower = trimmed.to_ascii_lowercase();
                    let always_apply = lower.contains("alwaysapply: true")
                        || lower.contains("always_apply: true");
                    out.push(DiscoveredPluginRule {
                        plugin_name: plugin_name.clone(),
                        rule_name,
                        content: trimmed.to_string(),
                        always_apply,
                    });
                }
            }
        }
    }
    out
}

pub(crate) fn filter_and_cap_plugin_rules(
    rules: &[DiscoveredPluginRule],
    prompt_text: &str,
    max_chars: usize,
) -> (String, usize, bool) {
    let total = rules.len();
    if rules.is_empty() || max_chars == 0 || is_actual_greeting(prompt_text) {
        return (String::new(), 0, total > 0);
    }

    let query_tokens = tokenize_query(prompt_text);
    let has_query = !prompt_text.trim().is_empty() && !query_tokens.is_empty();

    let mut ranked: Vec<(bool, usize, usize, &DiscoveredPluginRule)> = Vec::new();
    for (idx, r) in rules.iter().enumerate() {
        let score = score_relevance(
            &query_tokens,
            &format!("{} {} {}", r.plugin_name, r.rule_name, r.content),
        );
        if has_query && !r.always_apply && score == 0 {
            continue;
        }
        ranked.push((r.always_apply, score, idx, r));
    }
    ranked.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| a.2.cmp(&b.2))
    });

    let mut out = String::new();
    let mut kept = 0usize;
    let mut truncated = ranked.len() < total;

    for (_, _, _, r) in ranked {
        let block = format!("[Plugin: {} / {}]\n{}\n", r.plugin_name, r.rule_name, r.content);
        if out.len() + block.len() > max_chars {
            let remaining = max_chars.saturating_sub(out.len());
            if remaining > 40 && kept == 0 {
                let (partial, _) = truncate_utf8_with_ellipsis(&block, remaining);
                out.push_str(&partial);
                kept += 1;
            }
            truncated = true;
            break;
        }
        out.push_str(&block);
        kept += 1;
    }

    if total > kept {
        truncated = true;
    }
    let rendered = if out.trim().is_empty() {
        String::new()
    } else {
        format!("<plugin_rules>\n{}\n</plugin_rules>", out.trim_end())
    };
    (rendered, kept, truncated)
}

/// Applies the overall `maxDynamicChars` budget across already per-block-capped dynamic blocks,
/// trimming lower-priority blocks (`skills`, `living_memory`, then `knowledge`) only if combined size overflows.
pub(crate) fn apply_global_dynamic_budget(
    living_mem: &mut String,
    knowledge_block: &mut String,
    skills_block: &mut String,
    rules_block: &mut String,
    total_budget: usize,
) -> bool {
    let mut cur_total = living_mem.chars().count()
        + knowledge_block.chars().count()
        + skills_block.chars().count()
        + rules_block.chars().count();
    let mut trimmed = false;
    if cur_total <= total_budget {
        return false;
    }

    for slot in [skills_block, living_mem, knowledge_block, rules_block] {
        if cur_total <= total_budget {
            break;
        }
        let excess = cur_total - total_budget;
        let slot_chars = slot.chars().count();
        if slot_chars == 0 {
            continue;
        }
        let new_cap = slot_chars.saturating_sub(excess);
        if new_cap < 48 {
            slot.clear();
            cur_total = cur_total.saturating_sub(slot_chars);
        } else {
            let (shortened, _) = truncate_utf8_with_ellipsis(slot, new_cap);
            let new_len = shortened.chars().count();
            *slot = shortened;
            cur_total = cur_total.saturating_sub(slot_chars.saturating_sub(new_len));
        }
        trimmed = true;
    }
    trimmed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn relevance_filtering_drops_noise_on_greetings_and_non_video_turns_and_caps_overflow() {
        let sample_skills = vec![
            DiscoveredSkillEntry {
                slug: "mg-soft-clay-story".into(),
                name: "mg-soft-clay-story".into(),
                description: "3D Clay diorama characters with neonbrutalism subtitles".into(),
                path: ".aetheria/skills/mg-soft-clay-story/SKILL.md".into(),
            },
            DiscoveredSkillEntry {
                slug: "mg-kinetic-type".into(),
                name: "mg-kinetic-type".into(),
                description: "High-speed kinetic typography animation scenes".into(),
                path: ".aetheria/skills/mg-kinetic-type/SKILL.md".into(),
            },
            DiscoveredSkillEntry {
                slug: "mg-flat-vector".into(),
                name: "mg-flat-vector".into(),
                description: "Clean modernist 2D vector illustration".into(),
                path: ".aetheria/skills/mg-flat-vector/SKILL.md".into(),
            },
        ];

        // Greeting gets zero skills & zero living memory
        assert!(filter_and_cap_skills(&sample_skills, "halo!", DEFAULT_MAX_SKILLS_CHARS).0.is_empty());
        assert!(filter_and_cap_living_memory("# Memory\ncontent", "hi", DEFAULT_MAX_LIVING_MEMORY_CHARS).0.is_empty());

        // Non-video coding prompt gets zero motion skills
        let non_video = filter_and_cap_skills(&sample_skills, "Perbaiki bug parser JSON di config.rs", DEFAULT_MAX_SKILLS_CHARS);
        assert!(non_video.0.is_empty());

        // Explicit /mg-soft-clay-story narrows catalog down to just that skill
        let explicit = filter_and_cap_skills(&sample_skills, "/mg-soft-clay-story buatkan video kopi", DEFAULT_MAX_SKILLS_CHARS);
        assert_eq!(explicit.1, 1);
        assert!(explicit.0.contains("mg-soft-clay-story"));
        assert!(!explicit.0.contains("mg-kinetic-type"));

        // Living memory compacts >8 catalog lines cleanly and honors strict char cap
        let bloated_mem = format!(
            "# LOCAL RULES\n## Domain Profile\nHTML5\n\n## Workspace Catalog\n{}\n## Operating Invariants\n- Stay isolated\n",
            (1..=30).map(|i| format!("- file_{}.js", i)).collect::<Vec<_>>().join("\n")
        );
        let (capped_mem, reduced) = filter_and_cap_living_memory(&bloated_mem, "buatkan video", 320);
        assert!(reduced);
        assert!(capped_mem.chars().count() <= 320);
        assert!(capped_mem.contains("more files; inspect via `glob`"));

        // Knowledge base filters irrelevant notes and keeps pinned/relevant ones under cap
        let kn_nodes = vec![
            json!({ "id": "k1", "title": "Coffee Roasting Notes", "content": "Dark roast beans smell great." }),
            json!({ "id": "k2", "title": "Kubernetes YAML", "content": "Pod replica limits for cloud cluster." }),
            json!({ "id": "k3", "title": "Pinned Brand Palette", "content": "Always use cobalt blue.", "pinned": true }),
        ];
        let (kn_out, kn_kept, kn_total, kn_trunc) = filter_and_cap_knowledge(&kn_nodes, "buatkan video roasting coffee", 1500);
        assert_eq!(kn_total, 3);
        assert_eq!(kn_kept, 2);
        assert!(kn_trunc);
        assert!(kn_out.contains("Coffee Roasting Notes"));
        assert!(kn_out.contains("Pinned Brand Palette"));
        assert!(!kn_out.contains("Kubernetes YAML"));
    }
}
