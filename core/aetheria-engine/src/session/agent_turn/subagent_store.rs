//! Subagent Child Session Store, Persona Prompt Builder & Recursion Guard
//! Mirrors `packages/core/src/plugin/subagent.ts` session/persona setup.

use serde_json::{json, Value};

use crate::paths::{gen_id, now_ms};
use crate::session::session::{save_store, with_store, SessionStoreData};

/// Maximum recursion depth for subagents (`parent = 0`, `child = 1`, `grandchild = 2`).
pub const MAX_SUBAGENT_DEPTH: usize = 1;

/// Builds the specialized system prompt for each subagent persona.
pub fn build_subagent_system_prompt(subagent_type: &str, workspace_dir: &str) -> String {
    let persona_rules = match subagent_type {
        "explore" => {
            "You are the **Explore Subagent** (Read-Only Fast Discovery).\n\
             - Your job is to rapidly inspect files, search patterns, or gather facts in the workspace.\n\
             - Use `glob`, `grep`, `read`, or `websearch` to locate exact answers.\n\
             - Do NOT modify files. Return a concise, factual summary with exact file paths."
        }
        "motion-designer" => {
            "You are the **Motion Designer Subagent** (Visual & Scene Specialist).\n\
             - You support ANY visual pipeline chosen by the active `/skill` or task brief — including 2D HTML5 Canvas/SVG (`window.AM` via `/script/aetheria-motion.js`) AND 3D WebGL / Three.js (`/script/three.min.js`, built-in offline in the engine) — driven deterministically by `window.renderAt(t)`.\n\
             - NEVER lock onto, assume, or default to any unrequested style or template (such as `01-flat-vector`, generic header badges, or headline plaques). If the delegated task provides standalone HTML/SVG/CSS animation code to clean or convert, extract ONLY the visual stage (`<svg>`/`<canvas>`, defs, layers), strip control bars/CDNs (`tailwindcss`, Google Fonts, `<input>`/`<button>`), convert CSS `@keyframes` / `requestAnimationFrame` / `Math.random()` into deterministic `window.renderAt(t)` + `AM.rand(seed)`, and set `window.__filmMeta` + `window.__ready = true`. Otherwise, if no style/skill/reference was supplied, ask the coordinator to confirm the style/skill.\n\
             - Keep scripts strictly modular under `script/` (`script/scene1.js` .. `script/sceneN.js` and optional helper modules) with entry at `index.html`; NEVER create React/Remotion folders (`src/`, `public/`, `Root.tsx`) and NEVER overwrite built-in engine runtimes `script/aetheria-motion.js` or `script/three.min.js`.\n\
             - PRECEDENCE RULE: If an Active Video Reference Blueprint (`ref/extracted/ref_report.md`, `ref/extracted/style.json`) or reference frames exist, the reference's resolution, FPS, scene timings, palette (`bgHex`/`surfaceHex`/`textHex`/`accentHex`), layout bounding boxes, and typography STRICTLY OVERRIDE any active `/skill` aesthetics/palette! Only when NO reference exists should an active `/skill` govern visual aesthetics. If a `/skill` is also active alongside a reference, use the skill solely for technical `AM`/WebGL implementation patterns.\n\
             - When matching a video reference (`Active Video Reference Blueprint`), VISION IS GROUND TRUTH OVER RAW OCR: inspect every panel of the attached `ref_scene_0K_beats.jpg` storyboard strip + `_q1`/`mid`/`_q3` full-res stills (or `contact_sheet_*.jpg`) from left to right BEFORE writing any scene code. Explicitly identify EVERY exact visual beat (`early -> q1 -> mid -> q3 -> late`): (a) for kinetic word morphs, morph each letter slot IN-PLACE on the SINGLE hero baseline (`y` from `Dense 6-Slice Timeline`) using the measured `Saturated Accent Callouts` — NEVER stack a separate row of icons above or below the word; (b) draw a distinct vector icon inside every bento/grid cell or vertical slot-reel cell matching `ref_scene_0K_beats.jpg` (C-arc, focus-corners, crescent-moon, 3D cube, orbit, prism, sparkle, wave, wifi) — NEVER repeat lazy 2x2 dot placeholders or empty boxes; (c) follow `Measured Foreground Trajectory` & `Dense 6-Slice Timeline` for exact `[x,y,w,h]` position, scale, 3D rotation/folding pose, marquee font height, and exact active words at each timestamp (never shift word-wheel timing by 1 beat and never invent extra subtitles/headers); (d) whenever `Container & Inner Screen ClipRect` or a laptop/card container is present, clip all inner screen content (`ctx.save(); ctx.beginPath(); ctx.rect(scr.x,scr.y,scr.w,scr.h); ctx.clip(); ... ctx.restore();`) with `>=24px` text padding so backgrounds/ripples/text NEVER spill outside the bezel or clip at the left edge. Use `<active_video_reference_report>` (`ref_report.md`) and `style_ast.json` for exact timing, `cleanPlate.fillHex`, measured `High-Contrast Tile Wall` (`L`/`D` row map, `pitch`, `origin`), and measured pixel font sizes/weights (`400`/`500` vs `800`), while STRICTLY REJECTING garbled OCR artifacts (`.S`, `Ertem`, `Estem`, `Enum`). Write craft-rich Canvas vector code (~150–300 lines per complex scene) with custom helper draw functions! After writing your target scene(s), call `capture_film_preview({ compareToReference: true, passThreshold: 0.65 })`, visually critique `.aetheria/preview/comparison_strip.jpg` (`Ref | Preview | Diff Heatmap`) and fix any `CONTAINER SPILL`, `CLIPPED TEXT`, `TEXT SUB-BEAT/WORD MISMATCH`, `STACKED ROW`, or `POSITION/SCALE SHIFT` diagnostics BEFORE stopping!\n\\
             - When the active `/skill` provides `examples/index.html` and `examples/script/*-kit.js` (such as `clay-kit.js`), preserve that dual-canvas/WebGL architecture (`#stage-webgl` with `preserveDrawingBuffer: true` + `#stage-hud`), skill subtitle config (e.g. `style: \"neobrutalism\"`), and full kit builders (auto-seeded into `script/` by the engine; inspect with `read` — NEVER shrink it into a minimal stub or fall back to plain 2D Canvas).\n\
             - If using `THREE.WebGLRenderer`, ALWAYS pass `preserveDrawingBuffer: true` so headless MP4 exports capture every WebGL frame.\n\
             - `AM.drawTopHeader`, `AM.drawHeadlinePlaque`, and dark pill `AM.drawSubtitles` are OPTIONAL — omit or customize them according to the active skill's `SKILL.md` and `tokens.json`.\n\
             - Never use `requestAnimationFrame`, `Math.random()`, `Date.now()`, or `setTimeout`/`setInterval`; drive all motion from `t` and read `audio/*.words.json` timings.\n\
             - After writing or modifying scripts/HTML, call `capture_film_preview` to verify zero runtimeErrors and clean visuals before finishing.\n\
             - For short modular scene scripts (`script/scene*.js`, <= ~200 lines), write or update the full file with `write` by default instead of large `edit` diffs; reserve `edit` with `startLine`/`endLine` for tiny targeted patches (<= 25 lines) or large files, then report the exact files created/updated."
        }
        "audio-director" => {
            "You are the **Audio Director Subagent** (Voiceover & SFX Specialist).\n\
             - Your job is to synthesize natural voiceovers (`voicebox_speak`) and procedural sound effects (`generate_smart_sfx`).\n\
             - Ensure audio output paths match the project script (`audio/scene1.wav`, `audio/sfx_*.wav`).\n\
             - Report all generated audio files and their durations."
        }
        "qa-verifier" => {
            "You are the **QA Verifier Subagent** (Verification & Audit Specialist).\n\
             - Your job is to inspect generated motion films (`index.html`, `script/scene*.js`, `audio/*.words.json`), check file existence, verify JSON/JS/HTML syntax, run `capture_film_preview` (with `compareToReference: true` when `ref/` keyframes exist), inspect `runtimeErrors` and RGB SSIM / `comparison_strip.jpg`, and fix any missing asset paths, broken script references, or visual mismatches.\n\
             - You MUST execute `capture_film_preview` before reporting verification complete, and report verification status and measured metrics accurately."
        }
        _ => {
            "You are the **General Autonomous Subagent**.\n\
             - Execute the delegated subtask thoroughly using available tools.\n\
             - Be direct, concise, and return a clear summary of actions taken and files produced."
        }
    };

    let skills_section = if matches!(
        subagent_type.trim().to_ascii_lowercase().as_str(),
        "motion-designer" | "qa-verifier"
    ) {
        let mut s = String::new();
        let discovered = super::context::discover_workspace_skills(workspace_dir);
        if !discovered.is_empty() {
            s.push_str("\n\n");
            s.push_str(&discovered);
        }
        if subagent_type.trim().eq_ignore_ascii_case("motion-designer") {
            let am_ref = super::context::load_am_api_reference(workspace_dir);
            if !am_ref.trim().is_empty() {
                s.push_str("\n\n<am_runtime_api_reference>\n");
                s.push_str(am_ref.trim());
                s.push_str("\n</am_runtime_api_reference>");
            }
        }
        if let Some(ms_block) =
            crate::studio::microstock::build_active_microstock_prompt_block(workspace_dir)
        {
            s.push_str("\n\n");
            s.push_str(&ms_block);
        }
        s
    } else {
        String::new()
    };

    let platform_note = if matches!(
        subagent_type.trim().to_ascii_lowercase().as_str(),
        "motion-designer" | "qa-verifier" | "audio-director" | "explore"
    ) {
        format!("Platform: `{}` (use built-in `read`, `grep`, and `glob` tools).", std::env::consts::OS)
    } else {
        format!(
            "Platform: `{}` (On `windows`, `bash` executes in PowerShell — prefer built-in `read`, `grep`, and `glob` first).",
            std::env::consts::OS
        )
    };

    format!(
        "{}{}\n\n\
         Active Project Workspace: `{}`\n\
         {}\n\
         IMPORTANT RULES:\n\
         1. Focus strictly on the delegated subtask.\n\
         2. Do NOT ask the user questions; make reasonable engineering decisions autonomously.\n\
         3. When finished, output a concise final report summarizing what was done and which files were touched.",
        persona_rules,
        skills_section,
        workspace_dir,
        platform_note
    )
}

#[cfg(test)]
mod prompt_tests {
    use super::*;

    #[test]
    fn motion_designer_prompt_supports_threejs_and_injects_workspace_skills() {
        let dir = std::env::temp_dir().join(format!("aetheria_subagent_skills_{}", std::process::id()));
        let skill_dir = dir.join(".aetheria").join("skills").join("custom-3d-skill");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: custom-3d-skill\ndescription: Custom 3D motion skill\n---\n",
        )
        .unwrap();

        let prompt = build_subagent_system_prompt("motion-designer", &dir.to_string_lossy());
        assert!(prompt.contains("/script/three.min.js"));
        assert!(prompt.contains("preserveDrawingBuffer: true"));
        assert!(prompt.contains("custom-3d-skill"));
        assert!(prompt.contains("OPTIONAL"));
        assert!(prompt.contains("<am_runtime_api_reference>"));

        let explore_prompt = build_subagent_system_prompt("explore", &dir.to_string_lossy());
        assert!(!explore_prompt.contains("<am_runtime_api_reference>"));

        let audio_prompt = build_subagent_system_prompt("audio-director", &dir.to_string_lossy());
        assert!(!audio_prompt.contains("<am_runtime_api_reference>"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn subagent_directive_forwards_reference_blueprint_and_keyframes() {
        let dir = std::env::temp_dir().join(format!("aetheria_subagent_ref_{}", std::process::id()));
        let extracted = dir.join("ref").join("extracted");
        let frames = extracted.join("frames");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&frames).unwrap();
        std::fs::write(extracted.join("ref_report.md"), "# Reference Video Analysis Report\nPrimary Background: `#101116`").unwrap();
        std::fs::write(frames.join("ref_scene_01.jpg"), b"jpg1").unwrap();
        std::fs::write(
            extracted.join("style.json"),
            r##"{"scenes":[{"start":0.0,"duration":2.0,"keyframeTimestamp":1.0,"keyframe":"frames/ref_scene_01.jpg"}]}"##,
        )
        .unwrap();

        let parent_id = gen_id("parent_ref_test");
        with_store(|store| {
            store.messages.insert(
                parent_id.clone(),
                vec![json!({
                    "role": "user",
                    "parts": [{ "type": "text", "text": "Clone this reference video" }]
                })],
            );
        });

        let injected = resolve_parent_skill_or_voice_directive(
            &parent_id,
            &dir.to_string_lossy(),
            "motion-designer",
        )
        .expect("expected reference directive for motion-designer");
        assert!(injected.contains("Active Video Reference Blueprint"));
        assert!(injected.contains("#101116"));
        assert!(injected.contains("ref_scene_01.jpg"));

        with_store(|store| {
            store.messages.remove(&parent_id);
        });
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reference_overrides_skill_and_collects_vision_images_for_child_session() {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_subagent_ref_prec_{}",
            crate::paths::now_ms()
        ));
        let frames_dir = dir.join("ref").join("extracted").join("frames");
        std::fs::create_dir_all(&frames_dir).unwrap();
        std::fs::write(frames_dir.join("ref_scene_01.jpg"), b"img1").unwrap();
        std::fs::write(frames_dir.join("ref_scene_02.jpg"), b"img2").unwrap();
        std::fs::write(
            dir.join("ref").join("extracted").join("ref_report.md"),
            "# Reference Report\n- Primary BG: `#0A0B10`\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("ref").join("extracted").join("style.json"),
            serde_json::to_string(&json!({
                "scenes": [
                    { "index": 1, "id": "scene_1", "start": 0.0, "duration": 2.0, "keyframe": "ref/extracted/frames/ref_scene_01.jpg" },
                    { "index": 2, "id": "scene_2", "start": 2.0, "duration": 2.0, "keyframe": "ref/extracted/frames/ref_scene_02.jpg" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        let parent_id = format!("test_parent_prec_{}", crate::paths::now_ms());
        with_store(|store| {
            store.messages.insert(
                parent_id.clone(),
                vec![json!({
                    "info": { "role": "user" },
                    "parts": [{ "type": "text", "text": "/mg-soft-clay-story clone video referensi" }]
                })],
            );
        });

        let injected = resolve_parent_skill_or_voice_directive(
            &parent_id,
            &dir.to_string_lossy(),
            "motion-designer",
        )
        .expect("expected combined reference + skill directive");
        let ref_pos = injected.find("Active Video Reference Blueprint").unwrap();
        let skill_pos = injected.find("SKILL DIRECTIVES").unwrap();
        assert!(ref_pos < skill_pos, "reference blueprint must precede skill directives");
        assert!(injected.contains("REFERENCE OVERRIDES SKILL AESTHETICS"));

        let vis = collect_reference_vision_images(&dir.to_string_lossy(), 8);
        assert_eq!(vis.len(), 2);
        assert_eq!(vis[0].0, "ref/extracted/frames/ref_scene_01.jpg");
        assert!(vis[0].1.starts_with("data:image/jpeg;base64,"));

        let urls: Vec<String> = vis.into_iter().map(|(_, u)| u).collect();
        let (child_id, msgs, _) = load_or_init_child_session_with_images(
            &parent_id,
            None,
            "motion-designer",
            "Build scenes",
            1,
            "sys",
            "clone",
            &urls,
        );
        let content_arr = msgs[1]["content"].as_array().expect("multimodal user content array");
        assert_eq!(content_arr.len(), 3);
        assert_eq!(content_arr[1]["type"], "image_url");

        with_store(|store| {
            store.messages.remove(&parent_id);
            store.messages.remove(&child_id);
            store.sessions.remove(&child_id);
        });
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Resolves the parent session's active `/skill` or `/audio:` directive so specialized
/// subagents receive the full `SKILL.md`, `tokens.json`, and `examples/` kit automatically.
pub fn resolve_parent_skill_or_voice_directive(
    parent_session_id: &str,
    workspace_dir: &str,
    subagent_type: &str,
) -> Option<String> {
    let latest_user_text = with_store(|store| {
        let msgs = store.messages.get(parent_session_id)?;
        msgs.iter().rev().find_map(|m| {
            let role = m.pointer("/info/role").or_else(|| m.get("role")).and_then(|v| v.as_str())?;
            if role != "user" {
                return None;
            }
            let parts = m.get("parts")?.as_array()?;
            let combined: String = parts
                .iter()
                .filter_map(|p| {
                    if p.get("type").and_then(|v| v.as_str()) == Some("text") {
                        p.get("text").and_then(|v| v.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if combined.trim().is_empty() { None } else { Some(combined) }
        })
    })
    .unwrap_or_default();

    match subagent_type {
        "motion-designer" | "qa-verifier" => {
            let mut blocks = Vec::new();
            let ref_bp =
                crate::session::agent_turn::command_resolvers::resolve_reference_report(workspace_dir);
            let has_ref_blueprint = ref_bp.is_some();
            if let Some(bp) = ref_bp {
                blocks.push(bp);
            }

            let ref_kfs = crate::studio::reference_compare::discover_reference_keyframes(
                std::path::Path::new(workspace_dir),
                12.0,
            );
            if !ref_kfs.is_empty() {
                let kf_list: Vec<String> = ref_kfs
                    .iter()
                    .take(12)
                    .map(|k| format!("- t={:.2}s -> `{}`", k.timestamp, k.rel_path))
                    .collect();
                blocks.push(format!(
                    "[Extracted Reference Keyframes on Disk]:\n{}\nUse `read` on any keyframe or `.aetheria/preview/comparison_strip.jpg` to inspect pixels directly, and run `capture_film_preview` (`compareToReference: true`) to measure RGB SSIM.",
                    kf_list.join("\n")
                ));
            }

            if let Some(style_or_proj) =
                crate::session::agent_turn::command_resolvers::resolve_motioncraft_style_readonly(
                    workspace_dir,
                    &latest_user_text,
                )
                .or_else(|| {
                    crate::session::agent_turn::command_resolvers::resolve_active_project_note(
                        workspace_dir,
                    )
                })
            {
                if has_ref_blueprint && style_or_proj.contains("SKILL DIRECTIVES") {
                    blocks.push(format!(
                        "[REFERENCE OVERRIDES SKILL AESTHETICS — The Active Video Reference Blueprint above strictly overrides this skill's default colors, aspect ratio, dark/light polarity, and scene durations. Use the skill below only for technical `AM`/WebGL architecture:]\n{}",
                        style_or_proj
                    ));
                } else {
                    blocks.push(style_or_proj);
                }
            }

            if blocks.is_empty() {
                None
            } else {
                Some(blocks.join("\n\n"))
            }
        }
        "audio-director" => {
            let voice = crate::session::agent_turn::command_resolvers::resolve_voice_preset_command(
                &latest_user_text,
            );
            let proj = crate::session::agent_turn::command_resolvers::resolve_active_project_note(
                workspace_dir,
            );
            match (voice, proj) {
                (Some(v), Some(p)) => Some(format!("{}\n\n{}", v, p)),
                (Some(v), None) => Some(v),
                (None, Some(p)) => Some(p),
                (None, None) => None,
            }
        }
        _ => None,
    }
}

/// Filters the tool definitions available to a specific subagent persona via `tool::profiles`.
pub fn build_subagent_tools(subagent_type: &str, current_depth: usize) -> Vec<Value> {
    let profile = crate::tool::profiles::ToolProfile::from_subagent_type(subagent_type);
    let mut filtered = crate::tool::profiles::filter_tools_for_profile(
        profile,
        crate::tool::build_tool_definitions(),
    );
    filtered.retain(|t| {
        let name = t
            .pointer("/function/name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if name == "question" {
            return false;
        }
        if name == "task" && current_depth >= MAX_SUBAGENT_DEPTH {
            return false;
        }
        true
    });
    filtered
}

/// Reads the subagent recursion depth of a session from `SESSION_STORE` (`0` for root sessions).
pub fn get_session_depth(session_id: &str) -> usize {
    with_store(|store| {
        store
            .sessions
            .get(session_id)
            .and_then(|s| s.get("subagentDepth"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize
    })
}

/// Collects temporally balanced reference keyframe `(rel_path, data_url)` pairs for subagent vision attachment.
pub fn collect_reference_vision_images(
    workspace_dir: &str,
    max_frames: usize,
) -> Vec<(String, String)> {
    use base64::prelude::*;
    if workspace_dir.trim().is_empty() || max_frames == 0 {
        return Vec::new();
    }
    let ws = std::path::Path::new(workspace_dir);
    let frames_dir = ws.join("ref").join("extracted").join("frames");
    let style_path = ws.join("ref").join("extracted").join("style.json");

    let mut candidate_paths = if frames_dir.is_dir() {
        crate::tool::ref_extractor::select_extracted_vision_keyframes(
            &frames_dir,
            style_path.is_file().then_some(style_path.as_path()),
            max_frames,
        )
    } else {
        Vec::new()
    };

    if candidate_paths.is_empty() {
        let ref_dir = ws.join("ref");
        if ref_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&ref_dir) {
                let mut imgs: Vec<std::path::PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_file()
                            && p.extension()
                                .and_then(|e| e.to_str())
                                .map(|e| {
                                    matches!(
                                        e.to_ascii_lowercase().as_str(),
                                        "jpg" | "jpeg" | "png" | "webp"
                                    )
                                })
                                .unwrap_or(false)
                    })
                    .collect();
                imgs.sort();
                candidate_paths = imgs.into_iter().take(max_frames).collect();
            }
        }
    }

    let mut out = Vec::new();
    for p in candidate_paths {
        let Ok(bytes) = std::fs::read(&p) else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }
        let mime = match p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref()
        {
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            _ => "image/jpeg",
        };
        let rel = p
            .strip_prefix(ws)
            .unwrap_or(&p)
            .to_string_lossy()
            .replace('\\', "/");
        out.push((
            rel,
            format!("data:{};base64,{}", mime, BASE64_STANDARD.encode(&bytes)),
        ));
    }
    out
}

fn build_user_msg_payload(user_prompt: &str, image_urls: &[String]) -> Value {
    if image_urls.is_empty() {
        json!({ "role": "user", "content": user_prompt })
    } else {
        let mut parts = vec![json!({ "type": "text", "text": user_prompt })];
        for url in image_urls {
            parts.push(json!({ "type": "image_url", "image_url": { "url": url } }));
        }
        json!({ "role": "user", "content": parts })
    }
}

/// Loads an existing child session for continuation or creates a new isolated child session in `SESSION_STORE`
/// with optional initial multimodal `image_url` frames attached to the user message.
pub fn load_or_init_child_session_with_images(
    parent_session_id: &str,
    requested_child_id: Option<&str>,
    subagent_type: &str,
    description: &str,
    child_depth: usize,
    sys_prompt: &str,
    user_prompt: &str,
    image_urls: &[String],
) -> (String, Vec<Value>, bool) {
    let now = now_ms();
    with_store(|store| {
        if let Some(existing_id) = requested_child_id.filter(|s| !s.trim().is_empty()) {
            if let Some(existing_msgs) = store.messages.get_mut(existing_id) {
                if !existing_msgs.is_empty() {
                    existing_msgs.push(build_user_msg_payload(user_prompt, image_urls));
                    let cloned = existing_msgs.clone();
                    if let Some(sess) = store.sessions.get_mut(existing_id) {
                        sess["updatedAt"] = json!(now);
                        sess["state"] = json!("running");
                    }
                    save_store(store);
                    return (existing_id.to_string(), cloned, true);
                }
            }
        }

        let new_id = requested_child_id
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| gen_id("sub"));

        let parent_model = store
            .sessions
            .get(parent_session_id)
            .and_then(|s| s.get("model"))
            .cloned();
        let parent_permissions = store
            .sessions
            .get(parent_session_id)
            .and_then(|s| s.get("permissions"))
            .cloned();

        let mut session_meta = json!({
            "id": new_id,
            "parentID": parent_session_id,
            "title": format!("[Subagent: {}] {}", subagent_type, description),
            "agent": subagent_type,
            "subagentDepth": child_depth,
            "state": "running",
            "createdAt": now,
            "updatedAt": now
        });
        if let Some(pm) = parent_model {
            session_meta["model"] = pm;
        }
        if let Some(pp) = parent_permissions {
            session_meta["permissions"] = pp;
        }
        store.sessions.insert(new_id.clone(), session_meta);

        let initial_msgs = vec![
            json!({ "role": "system", "content": sys_prompt }),
            build_user_msg_payload(user_prompt, image_urls),
        ];
        store.messages.insert(new_id.clone(), initial_msgs.clone());
        save_store(store);

        (new_id, initial_msgs, false)
    })
}

/// Loads an existing child session for continuation or creates a new isolated child session in `SESSION_STORE`.
pub fn load_or_init_child_session(
    parent_session_id: &str,
    requested_child_id: Option<&str>,
    subagent_type: &str,
    description: &str,
    child_depth: usize,
    sys_prompt: &str,
    user_prompt: &str,
) -> (String, Vec<Value>, bool) {
    load_or_init_child_session_with_images(
        parent_session_id,
        requested_child_id,
        subagent_type,
        description,
        child_depth,
        sys_prompt,
        user_prompt,
        &[],
    )
}

/// Saves the child session's updated messages and completion state in `SESSION_STORE`.
pub fn persist_child_session_state(
    child_session_id: &str,
    chat_messages: &[Value],
    state_str: &str,
) {
    let now = now_ms();
    with_store(|store| {
        store
            .messages
            .insert(child_session_id.to_string(), chat_messages.to_vec());
        if let Some(sess) = store.sessions.get_mut(child_session_id) {
            sess["state"] = json!(state_str);
            sess["updatedAt"] = json!(now);
        }
        save_store(store);
    });
}

fn extract_xml_attr(tag_header: &str, attr_name: &str) -> Option<String> {
    let needle = format!("{}=\"", attr_name);
    let start = tag_header.find(&needle)? + needle.len();
    let rest = &tag_header[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Parses one or more `<subagent-notification ...>` blocks from a consolidated wakeup payload.
pub fn parse_subagent_notifications(text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut cursor = text;
    while let Some(pos) = cursor.find("<subagent-notification ") {
        let after = &cursor[pos..];
        let header_end = after.find('>').unwrap_or(after.len());
        let header = &after[..header_end];
        let child_id = extract_xml_attr(header, "sessionID").unwrap_or_default();
        let subagent_type = extract_xml_attr(header, "type").unwrap_or_else(|| "general".to_string());
        let state = extract_xml_attr(header, "state").unwrap_or_else(|| "completed".to_string());
        let description = extract_xml_attr(header, "description").unwrap_or_default();
        let remaining = extract_xml_attr(header, "remaining_standby")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        out.push(json!({
            "childSessionId": child_id,
            "subagentType": subagent_type,
            "state": state,
            "description": description,
            "remainingStandby": remaining,
        }));
        cursor = &after[header_end.min(after.len())..];
    }
    out
}

/// Persists a `synthetic` subagent completion notification into `store.messages` so future
/// turns retain child results and the UI can render crisp notice rows without raw XML.
pub fn persist_synthetic_subagent_notice(
    store: &mut SessionStoreData,
    parent_session_id: &str,
    text: &str,
) -> bool {
    let notices = parse_subagent_notifications(text);
    if notices.is_empty() {
        return false;
    }
    let created_ms = now_ms();
    let msg = json!({
        "id": gen_id("syn"),
        "type": "synthetic",
        "role": "user",
        "agent": "subagent-notice",
        "text": text,
        "metadata": {
            "source": "subagent",
            "notices": notices,
        },
        "time": { "created": created_ms },
    });
    store
        .messages
        .entry(parent_session_id.to_string())
        .or_default()
        .push(msg);
    true
}

/// Persists a synthetic notification directly via global `SESSION_STORE` (e.g. mid-turn steers).
pub fn persist_synthetic_subagent_notice_in_store(parent_session_id: &str, text: &str) {
    with_store(|store| {
        if persist_synthetic_subagent_notice(store, parent_session_id, text) {
            save_store(store);
        }
    });
}

