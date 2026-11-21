//! Tool Output Formatter, Truncator & Spill-to-Disk Guard.
//!
//! Mirrors OpenCode `packages/core/src/tool-output.ts`:
//! 1. Formats structured tool JSON into clean multiline text for the LLM so `content`/`output`
//!    never collapses onto a single escaped JSON line and gets chopped at 2 KB.
//! 2. Bounds outputs to 50 KiB / 2,000 lines (Head mode for reads/grep, Tail mode for bash/codemode
//!    so error tracebacks at the bottom stay intact).
//! 3. Spills full untruncated outputs > limit to `<workspace>/.aetheria/tool-output/tool_<id>.txt`
//!    (with 7-day automatic pruning) and returns an actionable `read`/`grep` hint.

use serde_json::Value;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Maximum byte limit for a single tool response in the model context.
pub const MAX_TOOL_OUTPUT_BYTES: usize = 100 * 1024; // 100 KiB

/// Maximum lines allowed in a single tool response.
pub const MAX_TOOL_OUTPUT_LINES: usize = 2_000;

/// Maximum byte length for a single line before truncating.
pub const MAX_LINE_LENGTH: usize = 2_000;

const SPILL_RETENTION_SECS: u64 = 7 * 24 * 60 * 60; // 7 days

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TruncateDirection {
    Head,
    Tail,
}

/// Returns the preferred truncation direction for a given tool.
/// Shell/execution tools keep the tail so final exit errors & stack traces survive.
pub fn preferred_direction_for_tool(tool_name: &str) -> TruncateDirection {
    match tool_name {
        "bash" | "shell" | "terminal" | "codemode" => TruncateDirection::Tail,
        _ => TruncateDirection::Head,
    }
}

/// Formats a structured tool result JSON into clean model-facing text.
///
/// Crucial invariant: multiline text fields (`content`, `output`, `stdout`, `stderr`,
/// `editedSnippet`, `diagnostics`) are emitted verbatim as real lines rather than JSON-escaped
/// single-line strings, preventing false single-line 2 KB truncation while keeping structured
/// metadata intact for UI telemetry.
pub fn format_tool_result_for_model(tool_name: &str, result: &Value) -> String {
    let Some(obj) = result.as_object() else {
        return match result {
            Value::String(s) => s.clone(),
            _ => serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string()),
        };
    };

    let intervention = obj
        .get("harnessIntervention")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty());

    let is_error = obj.get("ok").and_then(Value::as_bool) == Some(false)
        || obj.get("error").and_then(Value::as_str).is_some();

    if is_error {
        let mut parts = Vec::new();
        if let Some(err) = obj.get("error").and_then(Value::as_str) {
            parts.push(format!("Error: {}", err));
        } else if let Some(msg) = obj.get("message").and_then(Value::as_str) {
            parts.push(format!("Error: {}", msg));
        } else {
            parts.push("Error: tool execution failed.".to_string());
        }
        if let Some(code) = obj.get("exitCode").and_then(Value::as_i64) {
            parts.push(format!("exitCode: {}", code));
        }
        if let Some(stdout) = obj
            .get("stdout")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            parts.push(format!("[stdout]\n{}", stdout));
        }
        if let Some(stderr) = obj
            .get("stderr")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            parts.push(format!("[stderr]\n{}", stderr));
        }
        if let Some(out) = obj
            .get("output")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            if obj.get("stdout").is_none() && obj.get("stderr").is_none() {
                parts.push(out.to_string());
            }
        }
        if let Some(hint) = intervention {
            parts.push(format!("[harness-note]\n{}", hint));
        }
        return parts.join("\n\n");
    }

    match tool_name {
        "read" | "read_file" => {
            if let Some(content) = obj.get("content").and_then(Value::as_str) {
                let mut out = String::new();
                if obj.get("isDirectory").and_then(Value::as_bool) == Some(true) {
                    out.push_str(content);
                } else if obj.get("isImage").and_then(Value::as_bool) == Some(true) {
                    out.push_str(content);
                } else {
                    out.push_str(content);
                    if let Some(total) = obj.get("linesTotal").and_then(Value::as_u64) {
                        let offset = obj.get("offset").and_then(Value::as_u64).unwrap_or(1);
                        let returned = obj
                            .get("linesReturned")
                            .and_then(Value::as_u64)
                            .unwrap_or(total);
                        let end_line = offset.saturating_add(returned).saturating_sub(1);
                        let has_more = obj
                            .get("hasMore")
                            .and_then(Value::as_bool)
                            .unwrap_or(end_line < total);
                        if has_more {
                            out.push_str(&format!(
                                "\n\n[Showing lines {}-{} of {} total. Call read with offset={} to continue.]",
                                offset,
                                end_line,
                                total,
                                end_line + 1
                            ));
                        } else if total > 0 {
                            out.push_str(&format!("\n\n[End of file — {} lines total]", total));
                        }
                    }
                }
                if let Some(hint) = intervention {
                    out.push_str(&format!("\n\n[harness-note]\n{}", hint));
                }
                return out;
            }
        }
        "bash" | "shell" | "terminal" | "codemode" => {
            let mut sections = Vec::new();
            let mut meta = Vec::new();
            if let Some(code) = obj.get("exitCode").and_then(Value::as_i64) {
                meta.push(format!("exitCode={}", code));
            }
            if let Some(cwd) = obj.get("cwd").and_then(Value::as_str) {
                meta.push(format!("cwd={}", cwd));
            }
            if obj.get("timedOut").and_then(Value::as_bool) == Some(true) {
                meta.push("timedOut=true".to_string());
            }
            if !meta.is_empty() {
                sections.push(format!("[{}]", meta.join(" | ")));
            }
            if let Some(stdout) = obj
                .get("stdout")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                sections.push(stdout.to_string());
            }
            if let Some(stderr) = obj
                .get("stderr")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                sections.push(format!("[stderr]\n{}", stderr));
            }
            if sections.len() <= 1 {
                if let Some(out) = obj
                    .get("output")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    sections.push(out.to_string());
                } else {
                    sections.push("(no output)".to_string());
                }
            }
            if let Some(log_file) = obj.get("logFile").and_then(Value::as_str) {
                sections.push(format!("[Full log saved to: {}]", log_file));
            }
            if let Some(hint) = intervention {
                sections.push(format!("[harness-note]\n{}", hint));
            }
            return sections.join("\n");
        }
        "grep" | "search" | "search_files" => {
            if let Some(output) = obj.get("output").and_then(Value::as_str) {
                let mut out = output.to_string();
                if let Some(hint) = intervention {
                    out.push_str(&format!("\n\n[harness-note]\n{}", hint));
                }
                return out;
            }
        }
        "glob" | "list" => {
            if let Some(files) = obj.get("files").and_then(Value::as_array) {
                let count = obj
                    .get("count")
                    .and_then(Value::as_u64)
                    .unwrap_or(files.len() as u64);
                let trunc = obj.get("truncated").and_then(Value::as_bool) == Some(true);
                let mut lines = Vec::with_capacity(files.len() + 2);
                lines.push(format!(
                    "Found {} file(s){}:",
                    count,
                    if trunc { " (truncated)" } else { "" }
                ));
                for f in files {
                    if let Some(s) = f.as_str() {
                        lines.push(s.to_string());
                    }
                }
                if let Some(hint) = intervention {
                    lines.push(format!("\n[harness-note]\n{}", hint));
                }
                return lines.join("\n");
            }
        }
        "extract_video_reference" => {
            if let Some(output) = obj.get("output").and_then(Value::as_str) {
                let mut out = output.to_string();
                if let Some(hint) = intervention {
                    out.push_str(&format!("\n\n[harness-note]\n{}", hint));
                }
                return out;
            }
        }
        "edit" | "write" | "apply_patch" | "multiedit" => {
            let mut sections = Vec::new();
            let mut meta = obj.clone();
            let primary_output = meta
                .remove("output")
                .and_then(|v| v.as_str().map(str::to_string));
            let snippet = meta
                .remove("editedSnippet")
                .and_then(|v| v.as_str().map(str::to_string));
            meta.remove("harnessIntervention");

            if let Some(out) = primary_output {
                sections.push(out);
            }
            if !meta.is_empty() {
                if let Ok(compact) = serde_json::to_string(&Value::Object(meta)) {
                    sections.push(compact);
                }
            }
            if let Some(snip) = snippet.filter(|s| !s.trim().is_empty()) {
                sections.push(format!("Updated excerpt:\n{}", snip));
            }
            if let Some(hint) = intervention {
                sections.push(format!("[harness-note]\n{}", hint));
            }
            if !sections.is_empty() {
                return sections.join("\n\n");
            }
        }
        _ => {}
    }

    // Generic fallback: if the payload has a large multi-line primary text field, keep remaining
    // metadata as compact JSON and emit the primary text verbatim so it is never trapped on 1 line.
    for key in ["output", "content", "diagnostics", "report"] {
        if let Some(text) = obj.get(key).and_then(Value::as_str) {
            if text.len() > 1_200 || text.contains('\n') {
                let mut meta = obj.clone();
                meta.remove(key);
                meta.remove("harnessIntervention");
                let mut sections = Vec::new();
                if !meta.is_empty() {
                    if let Ok(compact) = serde_json::to_string(&Value::Object(meta)) {
                        sections.push(compact);
                    }
                }
                sections.push(text.to_string());
                if let Some(hint) = intervention {
                    sections.push(format!("[harness-note]\n{}", hint));
                }
                return sections.join("\n\n");
            }
        }
    }

    serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string())
}

fn sanitize_call_id(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(48)
        .collect();
    if cleaned.is_empty() {
        format!("out_{}", crate::paths::now_ms())
    } else {
        cleaned
    }
}

fn prune_stale_spill_files(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(SPILL_RETENTION_SECS))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

fn spill_output_to_workspace(
    workspace_dir: &str,
    call_id: Option<&str>,
    raw_output: &str,
) -> Option<String> {
    let ws = workspace_dir.trim();
    if ws.is_empty() {
        return None;
    }
    let ws_root = Path::new(ws);
    if !ws_root.is_dir() {
        return None;
    }
    let spill_dir = ws_root.join(".aetheria").join("tool-output");
    if !crate::paths::contains_path(ws_root, &spill_dir) {
        return None;
    }
    if std::fs::create_dir_all(&spill_dir).is_err() {
        return None;
    }
    prune_stale_spill_files(&spill_dir);

    let suffix = match call_id {
        Some(id) if !id.trim().is_empty() => sanitize_call_id(id),
        _ => format!("{}", crate::paths::now_ms()),
    };
    let file_name = format!("tool_{}.txt", suffix);
    let spill_path = spill_dir.join(&file_name);
    if !crate::paths::contains_path(ws_root, &spill_path) {
        return None;
    }
    std::fs::write(&spill_path, raw_output).ok()?;
    Some(format!(".aetheria/tool-output/{}", file_name))
}

fn clamp_single_line(line: &str) -> String {
    if line.len() > MAX_LINE_LENGTH {
        let split_pos = line.floor_char_boundary(MAX_LINE_LENGTH);
        format!("{}... [line truncated]", &line[..split_pos])
    } else {
        line.to_string()
    }
}

/// Bounds a tool output string to standard limits (50 KiB / 2,000 lines), optionally spilling the
/// full output to `<workspace>/.aetheria/tool-output/tool_<id>.txt` when truncated.
///
/// Returns `(bounded_string, was_truncated, spill_relative_path)`.
pub fn bound_tool_output_with_spill(
    tool_name: &str,
    raw_output: &str,
    workspace_dir: Option<&str>,
    call_id: Option<&str>,
    direction: TruncateDirection,
) -> (String, bool, Option<String>) {
    let raw_lines: Vec<&str> = raw_output.lines().collect();
    let total_lines = raw_lines.len();
    let total_bytes = raw_output.len();

    let needs_line_truncation = total_lines > MAX_TOOL_OUTPUT_LINES;
    let needs_byte_truncation = total_bytes > MAX_TOOL_OUTPUT_BYTES;
    let has_oversized_lines = raw_lines.iter().any(|l| l.len() > MAX_LINE_LENGTH);

    if !needs_line_truncation && !needs_byte_truncation && !has_oversized_lines {
        return (raw_output.to_string(), false, None);
    }

    let spill_rel = if needs_line_truncation || needs_byte_truncation {
        workspace_dir.and_then(|ws| spill_output_to_workspace(ws, call_id, raw_output))
    } else {
        None
    };

    let (bounded_body, lines_included) = match direction {
        TruncateDirection::Head => {
            let mut bounded = String::with_capacity(MAX_TOOL_OUTPUT_BYTES + 256);
            let mut included = 0usize;
            for line in raw_lines.iter().take(MAX_TOOL_OUTPUT_LINES) {
                let clean = clamp_single_line(line);
                if bounded.len() + clean.len() + 1 > MAX_TOOL_OUTPUT_BYTES {
                    break;
                }
                if !bounded.is_empty() {
                    bounded.push('\n');
                }
                bounded.push_str(&clean);
                included += 1;
            }
            (bounded, included)
        }
        TruncateDirection::Tail => {
            let mut rev_selected: Vec<String> = Vec::new();
            let mut used_bytes = 0usize;
            for line in raw_lines.iter().rev().take(MAX_TOOL_OUTPUT_LINES) {
                let clean = clamp_single_line(line);
                let add_len = clean.len() + usize::from(!rev_selected.is_empty());
                if used_bytes + add_len > MAX_TOOL_OUTPUT_BYTES {
                    break;
                }
                used_bytes += add_len;
                rev_selected.push(clean);
            }
            rev_selected.reverse();
            let included = rev_selected.len();
            (rev_selected.join("\n"), included)
        }
    };

    let truncated_kb = (bounded_body.len() + 1023) / 1024;
    let total_kb = (total_bytes + 1023) / 1024;
    let mode_label = match direction {
        TruncateDirection::Head => "first",
        TruncateDirection::Tail => "last",
    };

    let spill_hint = match &spill_rel {
        Some(rel) => format!(
            " Full untruncated output saved to '{}'. Use 'read' with offset/limit or 'grep' on that file to inspect any omitted section.",
            rel
        ),
        None => format!(
            " In tool '{}', use pagination ('offset' / 'limit') or specific query filters to inspect further.",
            tool_name
        ),
    };

    let mut final_out = String::with_capacity(bounded_body.len() + 320);
    if direction == TruncateDirection::Tail && lines_included < total_lines {
        final_out.push_str(&format!(
            "[... {} earlier lines omitted — showing {} {} lines ({} KB of {} KB) ...]\n",
            total_lines.saturating_sub(lines_included),
            mode_label,
            lines_included,
            truncated_kb,
            total_kb
        ));
    }
    final_out.push_str(&bounded_body);
    final_out.push_str(&format!(
        "\n\n[Output truncated by harness: displayed {} ~{} KB ({} of {} lines, total {} KB).{}]",
        mode_label, truncated_kb, lines_included, total_lines, total_kb, spill_hint
    ));

    (final_out, true, spill_rel)
}

/// Bounds a tool output string to standard limits (Head mode, no spill path).
///
/// Returns `(bounded_string, was_truncated)`.
pub fn bound_tool_output(tool_name: &str, raw_output: &str) -> (String, bool) {
    let (out, truncated, _) = bound_tool_output_with_spill(
        tool_name,
        raw_output,
        None,
        None,
        preferred_direction_for_tool(tool_name),
    );
    (out, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_small_output_passes_unmodified() {
        let small = "{\"status\":\"ok\",\"count\":5}";
        let (output, truncated) = bound_tool_output("test", small);
        assert!(!truncated);
        assert_eq!(output, small);
    }

    #[test]
    fn test_truncates_excessive_lines() {
        let mut lines = Vec::new();
        for i in 1..=3000 {
            lines.push(format!("Row {}", i));
        }
        let raw = lines.join("\n");
        let (output, truncated) = bound_tool_output("read", &raw);

        assert!(truncated);
        assert!(output.contains("[Output truncated by harness"));
        assert!(output.contains("3000 lines"));
        assert!(output.len() <= MAX_TOOL_OUTPUT_BYTES + 1024);
    }

    #[test]
    fn test_truncates_giant_single_line() {
        let giant = "A".repeat(80 * 1024); // 80 KB
        let (output, truncated) = bound_tool_output("read", &giant);

        assert!(truncated);
        assert!(output.contains("[Output truncated by harness"));
        assert!(output.len() <= MAX_TOOL_OUTPUT_BYTES + 1024);
    }

    #[test]
    fn test_multibyte_utf8_char_boundary_truncation() {
        let prefix = format!("{}\nend", "─".repeat(700)); // 700 * 3 = 2,100 bytes
        let (output, truncated) = bound_tool_output("read", &prefix);

        assert!(truncated);
        assert!(output.contains("[line truncated]"));
    }

    #[test]
    fn test_format_tool_result_preserves_18kb_multiline_read_without_2kb_chop() {
        let multiline: String = (1..=350)
            .map(|i| format!("{}: const sceneLine_{} = 'hello world motion frame';", i, i))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(multiline.len() > 15_000 && multiline.len() < 45_000);

        let tool_json = json!({
            "content": multiline,
            "linesTotal": 350,
            "offset": 1,
            "linesReturned": 350
        });
        let formatted = format_tool_result_for_model("read", &tool_json);
        let (bounded, truncated, spill) = bound_tool_output_with_spill(
            "read",
            &formatted,
            None,
            Some("call_read_18kb"),
            TruncateDirection::Head,
        );
        assert!(!truncated, "18 KB multiline file must NOT be truncated");
        assert!(spill.is_none());
        assert!(bounded.contains("1: const sceneLine_1"));
        assert!(bounded.contains("350: const sceneLine_350"));
    }

    #[test]
    fn test_tail_mode_and_spill_to_disk_preserves_bottom_traceback() {
        let tmp = std::env::temp_dir().join(format!(
            "aetheria_trunc_spill_{}_{}",
            std::process::id(),
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&tmp).expect("mkdir");
        let mut lines = Vec::new();
        for i in 1..=2500 {
            lines.push(format!("INFO build step {:04} processing asset chunk", i));
        }
        lines.push("Traceback (most recent call last):".to_string());
        lines.push("ValueError: FINAL_SENTINEL_ERROR_999".to_string());
        let raw = lines.join("\n");

        let (bounded, truncated, spill_rel) = bound_tool_output_with_spill(
            "bash",
            &raw,
            Some(&tmp.to_string_lossy()),
            Some("call_bash_42"),
            TruncateDirection::Tail,
        );
        assert!(truncated);
        assert!(
            bounded.contains("ValueError: FINAL_SENTINEL_ERROR_999"),
            "Tail truncation must preserve final error line"
        );
        let rel = spill_rel.expect("spill file path returned");
        assert!(rel.starts_with(".aetheria/tool-output/tool_call_bash_42"));
        assert!(bounded.contains(&rel));
        let spilled_full = std::fs::read_to_string(tmp.join(&rel)).expect("read spill file");
        assert_eq!(spilled_full, raw);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_extract_video_reference_uses_compact_multiline_output() {
        let payload = serde_json::json!({
            "ok": true,
            "success": true,
            "output": "Reference video extracted (720x1280 @ 30fps, 15.00s).\n  Scene 1 (init): 0.00s-1.50s | bg=#0d0d0d",
            "blueprint": {
                "huge": "x".repeat(8000)
            }
        });
        let formatted = format_tool_result_for_model("extract_video_reference", &payload);
        assert!(formatted.contains("Reference video extracted (720x1280 @ 30fps"));
        assert!(formatted.contains("Scene 1 (init): 0.00s-1.50s"));
        assert!(!formatted.contains("xxxx"));
    }

    #[test]
    fn test_read_65kb_multiline_html_not_truncated() {
        let line = "<div class=\"scene-layer\" style=\"opacity:1\">motion element 0123456789</div>\n";
        let html = line.repeat(900);
        assert!(html.len() > 60 * 1024 && html.len() < MAX_TOOL_OUTPUT_BYTES);
        let (output, truncated) = bound_tool_output("read", &html);
        assert!(!truncated);
        assert_eq!(output, html);
    }
}
