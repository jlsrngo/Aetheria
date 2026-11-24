//! Feature switches & deterministic cross-scene code-fact extraction for the Direct Per-Scene Remake Loop.
//!
//! All switches default to preserving exact baseline behavior unless explicitly set via environment variables.

use serde::Serialize;
use std::collections::BTreeSet;

/// Controls whether facts extracted from previously completed scenes are injected into scene K.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CrossContextMode {
    Off,
    Summary,
}

/// Selects the system prompt variant used by the direct per-scene remake loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PromptMode {
    Current,
    Minimal,
}

/// Experimental switches read once per direct-remake run and recorded cleanly in the trace header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectSceneSwitches {
    pub probe_steps: Option<usize>,
    pub cross_context: CrossContextMode,
    pub restore_best: bool,
    pub reasoning_effort: Option<String>,
    pub prompt_mode: PromptMode,
    pub only_scenes: Option<Vec<usize>>,
    pub max_steps: usize,
    pub filmstrip_pass1: bool,
    pub motion_spec: bool,
    pub concurrency: usize,
    #[serde(skip)]
    pub concurrency_explicit: bool,
    #[serde(skip)]
    pub probe_steps_explicit: bool,
    #[serde(skip)]
    pub cross_context_explicit: bool,
    #[serde(skip)]
    pub max_steps_explicit: bool,
}

impl Default for DirectSceneSwitches {
    fn default() -> Self {
        Self {
            probe_steps: Some(2),
            cross_context: CrossContextMode::Off,
            restore_best: true,
            reasoning_effort: None,
            prompt_mode: PromptMode::Current,
            only_scenes: None,
            max_steps: 12,
            filmstrip_pass1: true,
            motion_spec: true,
            concurrency: 1,
            concurrency_explicit: false,
            probe_steps_explicit: false,
            cross_context_explicit: false,
            max_steps_explicit: false,
        }
    }
}

impl DirectSceneSwitches {
    /// Reads switches from the process environment (`AETHERIA_SCENE_*`, `AETHERIA_REMAKE_ONLY_SCENES`).
    pub(crate) fn from_env() -> Self {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// Parses switches from an arbitrary key lookup function (deterministic & race-free for unit tests).
    pub(crate) fn from_lookup<F>(lookup: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        let (probe_steps, probe_steps_explicit) = match lookup("AETHERIA_SCENE_PROBE_STEPS") {
            Some(raw) => {
                let s = raw.trim().to_ascii_lowercase();
                if s.is_empty() {
                    (Some(2), false)
                } else if matches!(s.as_str(), "off" | "none" | "false" | "disabled") {
                    (None, true)
                } else if let Ok(n) = s.parse::<usize>() {
                    (Some(n), true)
                } else {
                    (Some(2), true)
                }
            }
            None => (Some(2), false),
        };

        let (cross_context, cross_context_explicit) = match lookup("AETHERIA_SCENE_CROSS_CONTEXT") {
            Some(raw) => {
                let s = raw.trim();
                if s.is_empty() {
                    (CrossContextMode::Off, false)
                } else if s.eq_ignore_ascii_case("summary") {
                    (CrossContextMode::Summary, true)
                } else {
                    (CrossContextMode::Off, true)
                }
            }
            None => (CrossContextMode::Off, false),
        };

        let restore_best = match lookup("AETHERIA_SCENE_RESTORE") {
            Some(raw) => {
                let s = raw.trim().to_ascii_lowercase();
                !matches!(s.as_str(), "off" | "0" | "false" | "no" | "disabled")
            }
            None => true,
        };

        let reasoning_effort = lookup("AETHERIA_SCENE_REASONING")
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty());

        let prompt_mode = match lookup("AETHERIA_SCENE_PROMPT") {
            Some(raw) if raw.trim().eq_ignore_ascii_case("minimal") => PromptMode::Minimal,
            _ => PromptMode::Current,
        };

        let only_scenes = lookup("AETHERIA_REMAKE_ONLY_SCENES").and_then(|raw| {
            let nums: BTreeSet<usize> = raw
                .split(',')
                .filter_map(|part| part.trim().parse::<usize>().ok())
                .filter(|&n| n >= 1)
                .collect();
            if nums.is_empty() {
                None
            } else {
                Some(nums.into_iter().collect())
            }
        });

        let parsed_max_steps = lookup("AETHERIA_SCENE_MAX_STEPS")
            .and_then(|v| v.trim().parse::<usize>().ok());
        let max_steps_explicit = parsed_max_steps.is_some();
        let max_steps = parsed_max_steps.map(|n| n.clamp(3, 18)).unwrap_or(12);

        let filmstrip_pass1 = match lookup("AETHERIA_DIRECT_FILMSTRIP") {
            Some(raw) => {
                let s = raw.trim().to_ascii_lowercase();
                if s.is_empty() {
                    true
                } else {
                    !matches!(s.as_str(), "0" | "false" | "off" | "no" | "disabled")
                }
            }
            None => true,
        };

        let motion_spec = match lookup("AETHERIA_DIRECT_MOTION_SPEC") {
            Some(raw) => {
                let s = raw.trim().to_ascii_lowercase();
                if s.is_empty() {
                    true
                } else {
                    !matches!(s.as_str(), "0" | "false" | "off" | "no" | "disabled")
                }
            }
            None => true,
        };

        let (concurrency, concurrency_explicit) = match lookup("AETHERIA_DIRECT_CONCURRENCY")
            .and_then(|v| v.trim().parse::<usize>().ok())
        {
            Some(n) => (n.clamp(1, 4), true),
            None => (1, false),
        };

        Self {
            probe_steps,
            cross_context,
            restore_best,
            reasoning_effort,
            prompt_mode,
            only_scenes,
            max_steps,
            filmstrip_pass1,
            motion_spec,
            concurrency,
            concurrency_explicit,
            probe_steps_explicit,
            cross_context_explicit,
            max_steps_explicit,
        }
    }

    pub(crate) fn should_run_scene(&self, scene_num: usize) -> bool {
        match &self.only_scenes {
            Some(list) => list.contains(&scene_num),
            None => true,
        }
    }

    pub(crate) fn should_enforce_write_gate(
        &self,
        has_written: bool,
        step_idx: usize,
        has_write_tools: bool,
    ) -> bool {
        if has_written || !has_write_tools {
            return false;
        }
        match self.probe_steps {
            Some(limit) => step_idx >= limit,
            None => false,
        }
    }

    /// Produces the exact gate-rejection message (byte-for-byte identical to baseline when `probe_steps == Some(2)`).
    pub(crate) fn build_gate_block_error(&self, fn_name: &str, script_rel: &str) -> String {
        let step_limit = self.probe_steps.unwrap_or(2);
        format!(
            "Probing phase ended at step {}; `{}` is temporarily disabled until you write the initial script. Call `write_scene_script({{ code }})` NOW for `{}` — right after writing, all 6 tools return for render_and_compare_scene and polish.",
            step_limit, fn_name, script_rel
        )
    }

    /// Produces the exact step-budget nudge (byte-for-byte identical to baseline when `probe_steps == Some(2)`).
    pub(crate) fn build_probe_budget_nudge(
        &self,
        has_written: bool,
        step_idx: usize,
        scene_num: usize,
        total_scenes: usize,
        script_rel: &str,
    ) -> Option<String> {
        let limit = self.probe_steps?;
        if has_written || step_idx + 1 >= self.max_steps {
            return None;
        }
        if limit == 2 {
            if step_idx >= 1 {
                Some(format!(
                    "Step {}/{} complete — probing is finished. Call `write_scene_script` NOW with your complete, studio-grade Canvas 2D implementation for Scene {}/{} (`{}`). Right after writing, all 6 tools return so you can call `render_and_compare_scene` and polish surgically with `patch_scene_script`.",
                    step_idx + 1,
                    self.max_steps,
                    scene_num,
                    total_scenes,
                    script_rel
                ))
            } else {
                Some(format!(
                    "Step {}/{} complete. Finish any needed probe in at most 1 more step, then call `write_scene_script` to author `{}` and verify via `render_and_compare_scene`.",
                    step_idx + 1,
                    self.max_steps,
                    script_rel
                ))
            }
        } else if step_idx + 1 >= limit {
            Some(format!(
                "Step {}/{} complete — probing is finished. Call `write_scene_script` NOW with your complete, studio-grade Canvas 2D implementation for Scene {}/{} (`{}`). Right after writing, all tools return so you can call `render_and_compare_scene` and polish surgically with `patch_scene_script`.",
                step_idx + 1,
                self.max_steps,
                scene_num,
                total_scenes,
                script_rel
            ))
        } else {
            let rem = limit.saturating_sub(step_idx + 1);
            Some(format!(
                "Step {}/{} complete. Finish any needed probe in at most {} more step{}, then call `write_scene_script` to author `{}` and verify via `render_and_compare_scene`.",
                step_idx + 1,
                self.max_steps,
                rem,
                if rem == 1 { "" } else { "s" },
                script_rel
            ))
        }
    }
}

/// Extracts concise, factual cross-scene patterns purely from actual completed JS code
/// (never from LLM memory): hex colors, font families, helper function names, `AM.*` helpers,
/// and transition/clipping primitives. Strictly capped at <= 1200 bytes.
pub(crate) fn extract_cross_scene_summary(
    completed_scenes: &[(usize, String, String)],
) -> Option<String> {
    if completed_scenes.is_empty() {
        return None;
    }

    let mut hexes: BTreeSet<String> = BTreeSet::new();
    let mut fonts: BTreeSet<String> = BTreeSet::new();
    let mut helpers: BTreeSet<String> = BTreeSet::new();
    let mut am_apis: BTreeSet<String> = BTreeSet::new();
    let mut structures: BTreeSet<&'static str> = BTreeSet::new();

    for (_, _, code) in completed_scenes {
        collect_hex_literals(code, &mut hexes);
        collect_font_names(code, &mut fonts);
        collect_helper_names(code, &mut helpers);
        collect_am_calls(code, &mut am_apis);
        if code.contains(".clip(") {
            structures.insert("ctx.clip");
        }
        if code.contains(".filter") {
            structures.insert("ctx.filter-blur");
        }
        if code.contains("globalAlpha") {
            structures.insert("globalAlpha-fade");
        }
        if code.contains("applyCamera") {
            structures.insert("AM.applyCamera");
        }
        if code.contains("ease.") {
            structures.insert("AM.ease");
        }
    }

    let last_scenes: Vec<String> = completed_scenes
        .iter()
        .rev()
        .take(4)
        .map(|(num, id, code)| format!("s{}({}:{}L)", num, id, code.lines().count()))
        .collect();

    let mut parts = vec![format!("Done: {}", last_scenes.join(", "))];
    if !hexes.is_empty() {
        let vals: Vec<String> = hexes.into_iter().take(12).collect();
        parts.push(format!("Palette: {}", vals.join(" ")));
    }
    if !fonts.is_empty() {
        let vals: Vec<String> = fonts.into_iter().take(6).collect();
        parts.push(format!("Fonts: {}", vals.join(", ")));
    }
    if !helpers.is_empty() {
        let vals: Vec<String> = helpers.into_iter().take(10).collect();
        parts.push(format!("Helpers: {}", vals.join(", ")));
    }
    if !am_apis.is_empty() {
        let vals: Vec<String> = am_apis.into_iter().take(10).collect();
        parts.push(format!("AM calls: {}", vals.join(", ")));
    }
    if !structures.is_empty() {
        let vals: Vec<&str> = structures.into_iter().collect();
        parts.push(format!("Transitions/Ops: {}", vals.join(", ")));
    }

    let header = "PREVIOUS SCENES CODE SUMMARY (static facts extracted from authored scripts; keep visual continuity where matching):\n";
    let mut out = format!("{}{}", header, parts.join("\n"));
    const MAX_BYTES: usize = 1200;
    if out.len() > MAX_BYTES {
        let mut end = MAX_BYTES.saturating_sub(4);
        while end > 0 && !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
        out.push_str("\n...");
    }
    Some(out)
}

fn collect_hex_literals(code: &str, out: &mut BTreeSet<String>) {
    let bytes = code.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_hexdigit() && end - start < 8 {
                end += 1;
            }
            let len = end - start;
            if len == 3 || len == 6 {
                out.insert(format!("#{}", code[start..end].to_ascii_uppercase()));
            }
            i = end;
            continue;
        }
        i += 1;
    }
}

fn collect_font_names(code: &str, out: &mut BTreeSet<String>) {
    const KNOWN_FONTS: [&str; 8] = [
        "Playfair Display",
        "Anton",
        "Inter",
        "Montserrat",
        "Georgia",
        "Helvetica",
        "Arial",
        "monospace",
    ];
    for f in KNOWN_FONTS {
        if code.contains(f) {
            out.insert(f.to_string());
        }
    }
    for line in code.lines() {
        if let Some(pos) = line.find(".font") {
            let rest = &line[pos..];
            for quote in ['"', '\''] {
                if let Some(q1) = rest.find(quote) {
                    if let Some(q2) = rest[q1 + 1..].find(quote) {
                        let inner = rest[q1 + 1..q1 + 1 + q2].trim();
                        if inner.len() >= 3 && inner.len() <= 40 && inner.contains("px") {
                            out.insert(inner.to_string());
                        }
                    }
                }
            }
        }
    }
}

fn collect_helper_names(code: &str, out: &mut BTreeSet<String>) {
    // Match both standalone multi-line and single-line IIFE `function name(` declarations
    let mut cursor = code;
    while let Some(pos) = cursor.find("function ") {
        let after = &cursor[pos + "function ".len()..];
        if let Some((raw_name, _)) = after.split_once('(') {
            let clean = raw_name.trim();
            if is_ident(clean) {
                out.insert(format!("{}()", clean));
            }
        }
        cursor = after;
    }
    for line in code.lines() {
        let tr = line.trim();
        if let Some(after_var) = tr
            .strip_prefix("var ")
            .or_else(|| tr.strip_prefix("const "))
            .or_else(|| tr.strip_prefix("let "))
        {
            if let Some((lhs, rhs)) = after_var.split_once('=') {
                let clean = lhs.trim();
                let rhs_t = rhs.trim();
                if (rhs_t.starts_with("function") || rhs_t.contains("=>")) && is_ident(clean) {
                    out.insert(format!("{}()", clean));
                }
            }
        }
    }
}

fn collect_am_calls(code: &str, out: &mut BTreeSet<String>) {
    let mut cursor = code;
    while let Some(pos) = cursor.find("AM.") {
        let after = &cursor[pos..];
        let mut end = 3;
        let bytes = after.as_bytes();
        while end < bytes.len() {
            let ch = bytes[end];
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'.' {
                end += 1;
            } else {
                break;
            }
        }
        let token = &after[..end];
        if token.len() > 3 && token != "AM.registerScene" {
            out.insert(token.to_string());
        }
        cursor = &after[end.max(3)..];
    }
}

fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 48
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup_from<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k: &str| {
            pairs
                .iter()
                .find(|(pk, _)| *pk == k)
                .map(|(_, pv)| (*pv).to_string())
        }
    }

    #[test]
    fn default_switches_match_baseline_settings() {
        let sw = DirectSceneSwitches::from_lookup(|_| None);
        assert_eq!(sw, DirectSceneSwitches::default());
        assert_eq!(sw.probe_steps, Some(2));
        assert_eq!(sw.cross_context, CrossContextMode::Off);
        assert!(sw.restore_best);
        assert!(sw.reasoning_effort.is_none());
        assert_eq!(sw.prompt_mode, PromptMode::Current);
        assert!(sw.only_scenes.is_none());
        assert_eq!(sw.max_steps, 12);
    }

    #[test]
    fn switches_parse_all_overrides_and_gate_behavior() {
        let pairs = [
            ("AETHERIA_SCENE_PROBE_STEPS", "off"),
            ("AETHERIA_SCENE_CROSS_CONTEXT", "summary"),
            ("AETHERIA_SCENE_RESTORE", "off"),
            ("AETHERIA_SCENE_REASONING", " HIGH "),
            ("AETHERIA_SCENE_PROMPT", "minimal"),
            ("AETHERIA_REMAKE_ONLY_SCENES", "6, 2, 2, 3"),
            ("AETHERIA_SCENE_MAX_STEPS", "99"),
            ("AETHERIA_DIRECT_FILMSTRIP", "0"),
            ("AETHERIA_DIRECT_MOTION_SPEC", "off"),
            ("AETHERIA_DIRECT_CONCURRENCY", "9"),
        ];
        let sw = DirectSceneSwitches::from_lookup(lookup_from(&pairs));
        assert_eq!(sw.probe_steps, None);
        assert_eq!(sw.cross_context, CrossContextMode::Summary);
        assert!(!sw.restore_best);
        assert_eq!(sw.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(sw.prompt_mode, PromptMode::Minimal);
        assert_eq!(sw.only_scenes, Some(vec![2, 3, 6]));
        assert_eq!(sw.max_steps, 18);
        assert!(!sw.filmstrip_pass1);
        assert!(!sw.motion_spec);
        assert_eq!(sw.concurrency, 4);
        assert!(sw.concurrency_explicit);
        assert!(sw.probe_steps_explicit);
        assert!(sw.cross_context_explicit);
        assert!(sw.max_steps_explicit);

        assert!(!sw.should_run_scene(1));
        assert!(sw.should_run_scene(2));
        assert!(sw.should_run_scene(3));
        assert!(sw.should_run_scene(6));

        // When probe_steps == None ("off"), gate never fires and nudge is None
        assert!(!sw.should_enforce_write_gate(false, 2, true));
        assert!(!sw.should_enforce_write_gate(false, 10, true));
        assert!(sw
            .build_probe_budget_nudge(false, 2, 2, 8, "script/scene2.js")
            .is_none());

        // When probe_steps == Some(6), gate fires only at step >= 6
        let sw6 = DirectSceneSwitches {
            probe_steps: Some(6),
            ..Default::default()
        };
        assert!(!sw6.should_enforce_write_gate(false, 5, true));
        assert!(sw6.should_enforce_write_gate(false, 6, true));
        assert!(sw6.build_gate_block_error("bash", "script/scene1.js").contains("step 6"));
    }

    #[test]
    fn cross_scene_summary_extracts_code_facts_and_caps_at_1200_bytes() {
        let mut huge_code = String::from(
            "(function(){\n  var bg = '#0C0B0E'; var acc = '#7d56ef';\n  function drawGlowRing(ctx) {}\n  ctx.font = '700 42px \"Playfair Display\", serif';\n  AM.applyCamera(ctx, {s:1}, 1024, 576);\n  ctx.clip();\n",
        );
        for i in 0..80 {
            huge_code.push_str(&format!(
                "  function helperFnLongNameNumber{:03}(x) {{ return AM.ease.outCubic(x); }}\n  var c{} = '#{:06X}';\n",
                i, i, 0x100000 + i
            ));
        }
        huge_code.push_str("})();\n");

        let summary = extract_cross_scene_summary(&[(
            1,
            "scene1_hook".to_string(),
            huge_code,
        )])
        .expect("summary generated");

        assert!(
            summary.len() <= 1200,
            "summary length {} exceeded 1200 bytes",
            summary.len()
        );
        assert!(summary.contains("#0C0B0E"));
        assert!(summary.contains("Playfair Display"));
        assert!(summary.contains("drawGlowRing()"));
        assert!(summary.contains("AM.applyCamera"));
        assert!(summary.contains("ctx.clip"));
    }
}
