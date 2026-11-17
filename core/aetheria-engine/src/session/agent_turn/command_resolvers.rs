//! Prompt Directive Resolvers:
//! - Active video reference report injection (`ref_report.md`)
//! - Explicit `@filename` workspace file mentions
//! - Motion style / skill slash commands (`/<style>`)
//! - Audio / voice preset slash commands (`/audio:<style>`, `/voice:<style>`)

use std::path::Path;

const STYLE_JSON_SOFT_CAP_CHARS: usize = 14_000;

fn compact_scene_entry(sc: &serde_json::Value, max_regions: usize) -> serde_json::Value {
    let Some(obj) = sc.as_object() else {
        return sc.clone();
    };
    let mut out = serde_json::Map::new();
    for key in [
        "index",
        "id",
        "role",
        "start",
        "end",
        "duration",
        "durationFrames",
        "keyframe",
        "keyframes",
        "motion",
        "motionEnergy",
    ] {
        if let Some(v) = obj.get(key) {
            out.insert(key.to_string(), v.clone());
        }
    }
    if let Some(layout) = obj.get("layout").and_then(serde_json::Value::as_object) {
        let mut ly_out = serde_json::Map::new();
        for key in [
            "visual_archetype",
            "visualArchetype",
            "is_dark_scene",
            "card_count",
            "pill_count",
            "scatter_count",
            "top",
            "hero",
            "bottom",
        ] {
            if let Some(v) = layout.get(key) {
                ly_out.insert(key.to_string(), v.clone());
            }
        }
        if let Some(pal) = layout.get("palette").and_then(serde_json::Value::as_object) {
            let mut pal_out = serde_json::Map::new();
            for key in ["bgHex", "surfaceHex", "textHex", "accentHex", "secondaryAccentHex", "isDark"] {
                if let Some(v) = pal.get(key) {
                    pal_out.insert(key.to_string(), v.clone());
                }
            }
            ly_out.insert("palette".to_string(), serde_json::Value::Object(pal_out));
        }
        if max_regions > 0 {
            if let Some(regs) = layout.get("regions").and_then(serde_json::Value::as_array) {
                let mut prioritized: Vec<&serde_json::Value> = regs
                    .iter()
                    .filter(|r| r.get("kind").and_then(serde_json::Value::as_str) == Some("text"))
                    .collect();
                for r in regs {
                    if r.get("kind").and_then(serde_json::Value::as_str) != Some("text") {
                        prioritized.push(r);
                    }
                }
                let compact_regs: Vec<serde_json::Value> = prioritized
                    .into_iter()
                    .take(max_regions)
                    .map(|r| {
                        let Some(ro) = r.as_object() else {
                            return r.clone();
                        };
                        let mut ro_out = serde_json::Map::new();
                        for key in ["kind", "zone", "text", "x", "y", "w", "h", "fillHex"] {
                            if let Some(v) = ro.get(key) {
                                ro_out.insert(key.to_string(), v.clone());
                            }
                        }
                        serde_json::Value::Object(ro_out)
                    })
                    .collect();
                ly_out.insert("regions".to_string(), serde_json::Value::Array(compact_regs));
            }
        }
        out.insert("layout".to_string(), serde_json::Value::Object(ly_out));
    }
    serde_json::Value::Object(out)
}

/// Summarizes `style.json` cleanly while keeping ALL scenes intact (no raw mid-JSON truncation).
pub(crate) fn summarize_style_json_compact(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return trimmed.chars().take(max_chars).collect();
    };
    let Some(obj) = parsed.as_object() else {
        return trimmed.chars().take(max_chars).collect();
    };

    for region_limit in [6usize, 3, 0] {
        let mut compact = serde_json::Map::new();
        for key in [
            "sourceVideo",
            "totalDuration",
            "fps",
            "width",
            "height",
            "aspectRatio",
            "fidelityTarget",
            "passThreshold",
            "ocrAvailable",
            "ocrWarning",
            "extractorBackend",
            "pythonCvUnavailable",
            "palette",
            "safeZone",
            "typography",
            "cutTimestamps",
        ] {
            if let Some(v) = obj.get(key) {
                compact.insert(key.to_string(), v.clone());
            }
        }
        if let Some(scenes) = obj.get("scenes").and_then(serde_json::Value::as_array) {
            let compact_scenes: Vec<serde_json::Value> = scenes
                .iter()
                .map(|s| compact_scene_entry(s, region_limit))
                .collect();
            compact.insert("scenes".to_string(), serde_json::Value::Array(compact_scenes));
        }
        compact.insert("compactedForContext".to_string(), serde_json::json!(true));
        if let Ok(serialized) = serde_json::to_string_pretty(&serde_json::Value::Object(compact)) {
            if serialized.chars().count() <= max_chars || region_limit == 0 {
                return serialized;
            }
        }
    }

    trimmed.chars().take(max_chars).collect()
}

/// Injects active video reference report (and keyframe inventory) if present in workspace.
pub fn resolve_reference_report(workspace_dir: &str) -> Option<String> {
    let ws_path = Path::new(workspace_dir);
    let report_candidates = [
        ws_path.join("ref").join("ref_report.md"),
        ws_path.join("ref").join("extracted").join("ref_report.md"),
        ws_path.join("workspace").join("ref").join("extracted").join("ref_report.md"),
    ];
    let style_candidates = [
        ws_path.join("ref").join("extracted").join("style.json"),
        ws_path.join("ref").join("style.json"),
        ws_path.join("workspace").join("ref").join("extracted").join("style.json"),
    ];

    let target_report = report_candidates.into_iter().find(|p| p.exists());
    let target_style = style_candidates.into_iter().find(|p| p.exists());

    let mut sections = Vec::new();
    if let Some(report_path) = target_report {
        if let Ok(bp_text) = std::fs::read_to_string(&report_path) {
            if !bp_text.trim().is_empty() {
                sections.push(bp_text.trim().to_string());
            }
        }
    }
    if let Some(style_path) = target_style {
        if let Ok(raw) = std::fs::read_to_string(&style_path) {
            let compact = summarize_style_json_compact(&raw, STYLE_JSON_SOFT_CAP_CHARS);
            if !compact.is_empty() {
                sections.push(format!("Structured style.json:\n{}", compact));
            }
        }
    }

    if sections.is_empty() {
        return None;
    }

    Some(format!(
        "[Active Video Reference Blueprint (MotionClone-Grade Reference)]:\n\"\"\"\n{}\n\"\"\"\n\
        GUIDELINES WHEN PRODUCING FROM REFERENCE:\n\
        1. VISUAL & TEMPORAL FIDELITY: Match the extracted `SCENES` timings, measured per-scene `bgHex`/`surfaceHex`/`textHex`/`accentHex` palette, spatial layout bounding boxes, and motion cadence.\n\
        2. 3-TRACK SUBAGENT DELEGATION: Delegate voiceover/SFX synthesis to `task(subagent_type: \"audio-director\")` (with `spokenText` for foreign names/acronyms) and delegate modular scene scripts (`script/scene1.js`..`script/sceneN.js` + `index.html`) to `task(subagent_type: \"motion-designer\")`.\n\
        3. DETERMINISTIC HTML ENGINE: Drive all motion via `window.renderAt(t)` and `window.AM` (`AM.evalKeyframes`, `AM.spring`, `AM.pop`, `AM.drawSVGPath`, `AM.textReveal`). NEVER load `ref/ref_*` directly on the canvas.\n\
        4. CLOSED-LOOP COMPARISON: Call `capture_film_preview` with `compareToReference: true` to measure RGB SSIM + color/edge similarity and inspect `.aetheria/preview/comparison_strip.jpg`. Refine any low-scoring scenes iteratively before finishing.",
        sections.join("\n\n---\n\n")
    ))
}

/// Resolves `@filename` mentions in prompt into file context.
pub fn resolve_mentioned_files(workspace_dir: &str, prompt_text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for word in prompt_text.split_whitespace() {
        if let Some(m) = word.strip_prefix('@') {
            let clean_m = m.trim_matches(|c: char| !c.is_alphanumeric() && c != '.' && c != '_' && c != '-');
            if !clean_m.is_empty() {
                let candidate = Path::new(workspace_dir).join(clean_m);
                if candidate.is_file() {
                    if let Ok(content) = std::fs::read_to_string(&candidate) {
                        let snippet: String = content.chars().take(8000).collect();
                        out.push(format!(
                            "[Explicitly Mentioned Workspace File: {}]:\n\"\"\"\n{}\n\"\"\"",
                            clean_m, snippet.trim()
                        ));
                    } else {
                        out.push(format!(
                            "[Explicitly Mentioned Workspace File: {} (binary document present in active folder)]",
                            clean_m
                        ));
                    }
                }
            }
        }
    }
    out
}

pub fn resolve_motioncraft_style_command(workspace_dir: &str, prompt_text: &str) -> Option<String> {
    resolve_dynamic_style_or_skill_command_inner(workspace_dir, prompt_text, true)
}

/// Read-only variant for subagents inside an already-started turn (reuses active project subfolder).
pub fn resolve_motioncraft_style_readonly(workspace_dir: &str, prompt_text: &str) -> Option<String> {
    resolve_dynamic_style_or_skill_command_inner(workspace_dir, prompt_text, false)
}

/// Returns the active `projects/<slug>/` instruction block for subagents (e.g. `audio-director`).
pub fn resolve_active_project_note(workspace_dir: &str) -> Option<String> {
    if workspace_dir.trim().is_empty() {
        return None;
    }
    let state = crate::studio::project_registry::list_studio_projects(Path::new(workspace_dir));
    let slug = state.active_project?;
    let proj = state.projects.into_iter().find(|p| p.id == slug)?;
    Some(format!(
        "ACTIVE VIDEO PROJECT SUBFOLDER: {rel}/ (Title: \"{title}\")\n\
        - Write ALL files for this video inside `{rel}/` (e.g. `{rel}/audio/scene1.wav`, `{rel}/audio/scene1.words.json`, `{rel}/audio/sfx_*.json`, `{rel}/index.html`, `{rel}/script/scene1.js`).\n\
        - Do NOT write scene or audio files into the workspace root.",
        rel = proj.relative_path,
        title = proj.title
    ))
}

/// Seeds non-scene kit scripts (e.g. `examples/script/clay-kit.js`) into `workspace/script/`
/// via `resolve_isolated_path` when missing, so `motion-designer` uses the real 3D kit
/// instead of rewriting a miniature 2D stub.
fn seed_skill_kit_scripts(workspace_dir: &str, skill_dir: &Path) -> Vec<String> {
    if workspace_dir.trim().is_empty() {
        return Vec::new();
    }
    let src_dir = skill_dir.join("examples").join("script");
    if !src_dir.is_dir() {
        return Vec::new();
    }
    let mut seeded = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&src_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let Some(fname) = p.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let lower = fname.to_ascii_lowercase();
            if !lower.ends_with(".js") || lower.starts_with("scene") {
                continue;
            }
            let rel = format!("script/{fname}");
            if let Ok(dest) = crate::tool::path_guard::resolve_isolated_path(workspace_dir, &rel) {
                if !dest.exists() {
                    if let Some(parent) = dest.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if std::fs::copy(&p, &dest).is_ok() {
                        seeded.push(rel);
                    }
                } else {
                    seeded.push(rel);
                }
            }
        }
    }
    seeded.sort();
    seeded
}

/// Dynamically detects and resolves style or design skill slash commands from `.aetheria/skills/*`.
pub fn resolve_dynamic_style_or_skill_command(workspace_dir: &str, prompt_text: &str) -> Option<String> {
    resolve_dynamic_style_or_skill_command_inner(workspace_dir, prompt_text, true)
}

fn resolve_dynamic_style_or_skill_command_inner(
    workspace_dir: &str,
    prompt_text: &str,
    create_project: bool,
) -> Option<String> {
    let root = crate::paths::project_root();

    let mut slash_tags: Vec<String> = Vec::new();
    for token in prompt_text.split_whitespace() {
        let t = token.trim();
        if let Some(rest) = t.strip_prefix('/') {
            let tag = rest
                .trim_start_matches("style:")
                .trim_start_matches("style=")
                .trim_start_matches("skill:")
                .trim_start_matches("skill=")
                .trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                .to_lowercase();
            if !tag.is_empty() {
                slash_tags.push(tag);
            }
        }
    }

    if slash_tags.is_empty() {
        return None;
    }

    let aetheria_skills_dir = root.join(".aetheria").join("skills");

    for tag in &slash_tags {
        if aetheria_skills_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&aetheria_skills_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        let is_match = name == *tag || (tag.len() >= 3 && name.contains(tag));

                        if is_match {
                            let skill_md = std::fs::read_to_string(path.join("SKILL.md"))
                                .or_else(|_| std::fs::read_to_string(path.join("style.md")))
                                .or_else(|_| std::fs::read_to_string(path.join("README.md")))
                                .unwrap_or_default();
                            let tokens_json = std::fs::read_to_string(path.join("tokens.json"))
                                .unwrap_or_default();
                            let brief_content = std::fs::read_to_string(path.join("REMOTION_BRIEF.md"))
                                .or_else(|_| std::fs::read_to_string(path.join("brief.md")))
                                .unwrap_or_default();
                            let brief_section = if !brief_content.is_empty() {
                                format!("\n\nEXACT MOTION SKILL SPECIFICATIONS:\n{brief_content}\n")
                            } else {
                                String::new()
                            };
                            let examples_section = collect_skill_examples(&path);
                            let active_project = if !workspace_dir.trim().is_empty() {
                                if create_project {
                                    crate::studio::project_registry::ensure_project_for_prompt(
                                        Path::new(workspace_dir),
                                        prompt_text,
                                    )
                                    .ok()
                                } else {
                                    let state = crate::studio::project_registry::list_studio_projects(
                                        Path::new(workspace_dir),
                                    );
                                    state.active_project.and_then(|slug| {
                                        state.projects.into_iter().find(|p| p.id == slug)
                                    })
                                }
                            } else {
                                None
                            };
                            let (seed_target_dir, project_rel_prefix, project_note) =
                                match active_project.as_ref() {
                                    Some(proj) => {
                                        let full = Path::new(workspace_dir)
                                            .join(&proj.relative_path)
                                            .to_string_lossy()
                                            .to_string();
                                        let note = format!(
                                            "\nACTIVE VIDEO PROJECT SUBFOLDER: {rel}/ (Title: \"{title}\")\n\
                                            - Write ALL scene and audio files inside `{rel}/` (e.g. `{rel}/film.json`, `{rel}/script/scene1.js`..`sceneN.js`, `{rel}/audio/scene1.wav`, `{rel}/audio/scene1.words.json`, `{rel}/audio/sfx_*.json`).\n\
                                            - When running `film_scaffold`, `{rel}/index.html` and relative `script/...` / `audio/...` URLs are managed automatically by the harness.\n\
                                            - Do NOT write scene or audio files into the workspace root.\n",
                                            rel = proj.relative_path,
                                            title = proj.title
                                        );
                                        (full, format!("{}/", proj.relative_path), note)
                                    }
                                    None => (
                                        workspace_dir.to_string(),
                                        String::new(),
                                        String::new(),
                                    ),
                                };

                            let seeded_kits = seed_skill_kit_scripts(&seed_target_dir, &path);
                            let seeded_note = if seeded_kits.is_empty() {
                                String::new()
                            } else {
                                let prefixed: Vec<String> = seeded_kits
                                    .iter()
                                    .map(|k| format!("{}{}", project_rel_prefix, k))
                                    .collect();
                                format!(
                                    "\nSEEDED KIT FILES ALREADY IN PROJECT (DO NOT OVERWRITE OR READ IN FULL; USE EXPORTED APIs PER SKILL.md): {}\n",
                                    prefixed.join(", ")
                                )
                            };

                            let has_custom_stage_kit = !seeded_kits.is_empty()
                                || path.join("examples").join("index.html").is_file();
                            let microstock_override =
                                crate::studio::microstock::build_microstock_hard_override_block(
                                    workspace_dir,
                                );
                            let rules_block = if let Some(ref ms_override) = microstock_override {
                                if has_custom_stage_kit {
                                    format!(
                                        "MANDATORY RULES FOR THIS GENERATION (MICROSTOCK MODE 'M' LOCKED):\n\
                                        1. Delegate modular scene scripts (`{project_rel_prefix}script/scene1.js`..`sceneN.js`) + `{project_rel_prefix}index.html` (`manageIndexHtml: false` with `examples/index.html` dual-canvas template) to `task(subagent_type: \"motion-designer\")`. DO NOT call `audio-director`, `voicebox_speak`, or `generate_smart_sfx` (Adobe Stock requires silent `-an` streams).\n\
                                        2. Pass the active skill path (`{path_display}`) and target project subfolder (`{project_rel_prefix}`) to `motion-designer`, keeping ONLY its 3D Three.js + `ClayKit` / lighting / pastel material aesthetic adapted cleanly to the locked Microstock canvas dimensions.\n\
                                        3. If `script/*-kit.js` (e.g. `clay-kit.js`) is already seeded in `{project_rel_prefix}script/`, DO NOT overwrite it — load it alongside `/script/three.min.js` and `/script/aetheria-motion.js`, and pass the Microstock-locked `width, height` to `ClayKit.initStage(canvas, width, height)`.\n\
                                        4. Enforce ZERO subtitles (`AM.drawSubtitles`), ZERO `fillText`/`strokeText`/DOM text, and update `{project_rel_prefix}microstock/manifest.json` metadata.\n\n\
                                        {ms_override}",
                                        path_display = path.display()
                                    )
                                } else {
                                    format!(
                                        "MANDATORY RULES FOR THIS GENERATION (MICROSTOCK MODE 'M' LOCKED):\n\
                                        1. Call `film_scaffold` FIRST so `{project_rel_prefix}film.json` and `{project_rel_prefix}index.html` use the locked Microstock dimensions; delegate `script/scene1.js`..`sceneN.js` to `task(subagent_type: \"motion-designer\")`.\n\
                                        2. DO NOT call `audio-director`, `voicebox_speak`, or `generate_smart_sfx` (Adobe Stock requires silent `-an` streams).\n\
                                        3. Pass the active skill path (`{path_display}`) and target project subfolder (`{project_rel_prefix}`) to `motion-designer`, enforcing ZERO subtitles (`AM.drawSubtitles`), ZERO `fillText`/`strokeText`/DOM text, and updating `{project_rel_prefix}microstock/manifest.json` metadata.\n\n\
                                        {ms_override}",
                                        path_display = path.display()
                                    )
                                }
                            } else if has_custom_stage_kit {
                                format!(
                                    "MANDATORY RULES FOR THIS GENERATION:\n\
                                    1. Generate narrated voiceover/SFX directly via `film_audio` from the coordinator (or optional `task(subagent_type: \"audio-director\")`) and delegate modular per-scene scripts (`{project_rel_prefix}script/scene1.js`..`sceneN.js`) + custom stage `{project_rel_prefix}index.html` (`manageIndexHtml: false`) to `task(subagent_type: \"motion-designer\")`.\n\
                                    2. Pass the active skill path (`{path_display}`), target project subfolder (`{project_rel_prefix}`), and `examples/` kit instructions directly in your prompt to `motion-designer`. Preserve the skill's dual-canvas Three.js + `ClayKit` (`#stage-webgl` with `preserveDrawingBuffer: true` + `#stage-hud`) and Neobrutalism `AM.drawSubtitles` architecture rather than falling back to plain 2D Canvas.\n\
                                    3. If `script/*-kit.js` (e.g. `clay-kit.js`) is already seeded in `{project_rel_prefix}script/`, DO NOT overwrite it — load it alongside `/script/three.min.js` and `/script/aetheria-motion.js`.\n\
                                    4. Strictly apply the skill's tokens, camera movement rules, and motion curves (`AM.spring`, `AM.anticipation`, `AM.stagger`).",
                                    path_display = path.display()
                                )
                            } else {
                                format!(
                                    "MANDATORY RULES FOR THIS GENERATION:\n\
                                    1. Generate narrated voiceover/SFX directly via `film_audio` from the coordinator (or optional `task(subagent_type: \"audio-director\")`) so durations derive cleanly from WAV, and delegate modular per-scene scripts (`{project_rel_prefix}script/scene1.js`..`sceneN.js`) to `task(subagent_type: \"motion-designer\")`.\n\
                                    2. Call `film_scaffold` FIRST to generate `{project_rel_prefix}film.json`, managed `{project_rel_prefix}index.html`, and `{project_rel_prefix}script/scene1.js`..`sceneN.js` stubs — do NOT hand-write `index.html`.\n\
                                    3. Pass the active skill path (`{path_display}`) and target project subfolder (`{project_rel_prefix}`) directly in your prompt to `motion-designer`.\n\
                                    4. Follow the skill's design tokens, palette, typography, motion curves (`AM.spring`, `AM.anticipation`, `AM.stagger`), and signature Do's & Don'ts.",
                                    path_display = path.display()
                                )
                            };

                            return Some(format!(
                                "[Active Motion Skill Triggered: /{name}]:\n\"\"\"\n\
                                SKILL DIRECTIVES (from {path_display}/SKILL.md):\n{skill_md}\n\n\
                                DESIGN TOKENS (from {path_display}/tokens.json):\n{tokens_json}\n\
                                {brief_section}\
                                {examples_section}\
                                {project_note}\
                                {seeded_note}\
                                \"\"\"\n\
                                {rules_block}",
                                path_display = path.display()
                            ));
                        }
                    }
                }
            }
        }
    }

    None
}

/// Dynamically detects audio preset commands (`/audio:<style>`, `/preset:<style>`, `/voice:<style>`)
/// and loads the corresponding voice styling directives.
pub fn resolve_voice_preset_command(prompt_text: &str) -> Option<String> {
    let mut requested_style = None;
    for token in prompt_text.split_whitespace() {
        let t = token.trim();
        if let Some(rest) = t.strip_prefix('/') {
            let lower = rest.to_lowercase();
            if let Some(s) = lower.strip_prefix("audio:").or_else(|| lower.strip_prefix("audio="))
                .or_else(|| lower.strip_prefix("voice:")).or_else(|| lower.strip_prefix("voice="))
                .or_else(|| lower.strip_prefix("preset:")).or_else(|| lower.strip_prefix("preset=")) {
                let clean = s.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
                if !clean.is_empty() {
                    requested_style = Some(clean.to_string());
                    break;
                }
            }
        }
    }

    let style_key = requested_style?;
    let root = crate::paths::project_root();
    let presets_path = root.join("core").join("voicebox").join("presets").join("presets.json");
    if !presets_path.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&presets_path).ok()?;
    let json_val: serde_json::Value = serde_json::from_str(&content).ok()?;
    let styles_obj = json_val.get("presets")?.get("aetheria")?.get("styles")?;

    let effective_key = match style_key.as_str() {
        "pocketmyth" | "pm" => "default",
        "kriminal" | "conspiracy" => "crime_conspiracy",
        other => other,
    };

    if let Some(style_data) = styles_obj.get(effective_key) {
        let label = style_data.get("label").and_then(|v| v.as_str()).unwrap_or(effective_key);
        let instruction = style_data.get("controlInstruction").and_then(|v| v.as_str()).unwrap_or("");
        let cfg = style_data.get("cfgValue").and_then(|v| v.as_f64()).unwrap_or(1.48);

        return Some(format!(
            "[Active Voicebox Audio Preset Directive: /audio:{effective_key}]:\n\"\"\"\n\
            NARRATOR VOICE STYLE: {label}\n\
            CONTROL INSTRUCTION: \"{instruction}\"\n\
            CFG VALUE: {cfg:.2}\n\
            \"\"\"\n\
            MANDATORY RULES FOR AUDIO GENERATION:\n\
            1. When calling `voicebox_speak`, pass:\n\
               - voice: \"aetheria\"\n\
               - style: \"{effective_key}\"\n\
            2. When producing video scenes, deliver narration with this exact tone ({label})."
        ));
    }

    None
}

fn collect_skill_examples(skill_dir: &Path) -> String {
    let examples_dir = skill_dir.join("examples");
    if !examples_dir.is_dir() {
        return String::new();
    }

    let mut files: Vec<std::path::PathBuf> = Vec::new();
    let mut stack = vec![examples_dir.clone()];
    while let Some(dir) = stack.pop() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.is_file() {
                    files.push(p);
                }
            }
        }
    }
    files.sort();

    let mut out = String::new();
    let mut total_chars = 0usize;
    const MAX_TOTAL_CHARS: usize = 35_000;

    for file in files.into_iter().take(6) {
        let Ok(content) = std::fs::read_to_string(&file) else {
            continue;
        };
        let rel = file
            .strip_prefix(skill_dir)
            .unwrap_or(&file)
            .to_string_lossy()
            .replace('\\', "/");
        if total_chars + content.len() > MAX_TOTAL_CHARS {
            out.push_str(&format!(
                "\nREFERENCE EXAMPLE FILE ({rel} at {}): [omitted due to size — read directly with `read` tool if needed]\n",
                file.display()
            ));
            continue;
        }
        total_chars += content.len();
        out.push_str(&format!(
            "\nREFERENCE EXAMPLE ({rel} — copy/adapt into workspace):\n```\n{content}\n```\n"
        ));
    }

    if out.is_empty() {
        String::new()
    } else {
        format!("\nREFERENCE EXAMPLE KIT (from {}/examples):\n{out}", skill_dir.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slash_skill_command_injects_examples_kit_for_soft_clay_story() {
        let resolved = resolve_dynamic_style_or_skill_command("", "/mg-soft-clay-story /audio:mystery")
            .expect("mg-soft-clay-story should resolve");
        assert!(resolved.contains("SKILL DIRECTIVES"));
        assert!(resolved.contains("DESIGN TOKENS"));
        assert!(resolved.contains("REFERENCE EXAMPLE (examples/script/clay-kit.js"));
        assert!(resolved.contains("ClayKit"));
    }

    #[test]
    fn summarize_style_json_compact_preserves_all_scenes_when_exceeding_6000_chars() {
        let scenes: Vec<serde_json::Value> = (1..=12)
            .map(|idx| {
                serde_json::json!({
                    "index": idx,
                    "id": format!("scene_{idx}"),
                    "start": (idx - 1) as f64 * 1.5,
                    "end": idx as f64 * 1.5,
                    "duration": 1.5,
                    "durationFrames": 45,
                    "keyframe": format!("ref/extracted/frames/ref_scene_{idx:02}.jpg"),
                    "motion": "kinetic_slide",
                    "motionEnergy": 0.42,
                    "layout": {
                        "visual_archetype": "bento_card",
                        "palette": {
                            "bgHex": "#101218",
                            "surfaceHex": "#1A1E28",
                            "textHex": "#F5F7FA",
                            "accentHex": "#F59E0B",
                            "extractedColors": ["#101218", "#1A1E28", "#F5F7FA", "#F59E0B", "#38BDF8", "#A78BFA"]
                        },
                        "hero": [format!("Headline Scene {idx}")],
                        "regions": (0..6).map(|r| serde_json::json!({
                            "kind": if r == 0 { "text" } else { "card" },
                            "zone": "hero",
                            "text": format!("Scene {idx} box {r} description with extended metadata padding to bloat JSON size"),
                            "x": 0.1,
                            "y": 0.2,
                            "w": 0.8,
                            "h": 0.15,
                            "px": [108, 384, 864, 288],
                            "fillHex": "#1A1E28"
                        })).collect::<Vec<_>>()
                    }
                })
            })
            .collect();
        let raw = serde_json::to_string_pretty(&serde_json::json!({
            "sourceVideo": "long_ref.mp4",
            "totalDuration": 18.0,
            "fps": 30,
            "width": 1080,
            "height": 1920,
            "aspectRatio": "9:16",
            "scenes": scenes,
        }))
        .unwrap();
        assert!(raw.chars().count() > 8000, "test fixture should exceed 6000 chars");

        let compact = summarize_style_json_compact(&raw, 7000);
        let parsed: serde_json::Value =
            serde_json::from_str(&compact).expect("compacted style.json must remain valid JSON");
        let parsed_scenes = parsed["scenes"].as_array().unwrap();
        assert_eq!(parsed_scenes.len(), 12);
        assert_eq!(parsed_scenes[11]["id"], "scene_12");
    }
}

