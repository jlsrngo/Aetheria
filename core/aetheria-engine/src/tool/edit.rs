//! Document Edit Tool — mirrors `packages/opencode/src/tool/edit.ts`.
//! Modifies existing files with CRLF/LF normalization and cascading fuzzy replacers
//! (Simple, LineTrimmed, BlockAnchor, WhitespaceNormalized, IndentationFlexible, TrimmedBoundary).

use serde_json::{json, Value};

use super::edit_matchers::{
    block_anchor_matches, indentation_flexible_matches, line_trimmed_matches,
    trimmed_boundary_matches, whitespace_normalized_matches,
};
use super::resolve_writable_isolated_path;
use crate::session::message::emit_event;

pub fn edit_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "edit",
            "description": include_str!("prompt/edit.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": {
                        "type": "string",
                        "description": "The path to the file to modify (relative to workspace or absolute inside workspace)."
                    },
                    "oldString": {
                        "type": "string",
                        "description": "The text to replace."
                    },
                    "newString": {
                        "type": "string",
                        "description": "The text to replace it with (must be different from oldString)."
                    },
                    "replaceAll": {
                        "type": "boolean",
                        "description": "Replace all occurrences of oldString (default false)."
                    },
                    "startLine": {
                        "type": "integer",
                        "description": "Optional 1-based start line to replace directly with endLine (avoids oldString mismatch)."
                    },
                    "endLine": {
                        "type": "integer",
                        "description": "Optional 1-based inclusive end line to replace directly with startLine."
                    }
                },
                "required": ["filePath", "newString"]
            }
        }
    })
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n")
}

fn detect_line_ending(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn convert_to_line_ending(text: &str, ending: &str) -> String {
    if ending == "\n" {
        text.to_string()
    } else {
        text.replace("\r\n", "\n").replace('\n', "\r\n")
    }
}

/// Finds the closest line window in `content` when `old_string` misses by a few characters.
fn find_closest_snippet(content: &str, old_string: &str) -> Option<String> {
    let file_lines: Vec<&str> = content.lines().collect();
    let needle_lines: Vec<&str> = old_string
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if file_lines.is_empty() || needle_lines.is_empty() {
        return None;
    }

    let anchor = needle_lines
        .iter()
        .max_by_key(|l| l.len())
        .copied()
        .unwrap_or(needle_lines[0]);
    let anchor_tokens: Vec<&str> = anchor
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| t.len() >= 3)
        .collect();

    let mut best_idx = 0usize;
    let mut best_score = 0usize;
    for (idx, line) in file_lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut score = 0usize;
        if trimmed == anchor {
            score += 20;
        } else if trimmed == needle_lines[0] {
            score += 15;
        }
        for tok in &anchor_tokens {
            if trimmed.contains(tok) {
                score += 2;
            }
        }
        let win_end = (idx + needle_lines.len()).min(file_lines.len());
        for nl in &needle_lines {
            if file_lines[idx..win_end].iter().any(|fl| fl.trim() == *nl) {
                score += 4;
            }
        }
        if score > best_score {
            best_score = score;
            best_idx = idx;
        }
    }

    if best_score < 4 {
        return None;
    }

    let start = best_idx.saturating_sub(2);
    let end = (best_idx + needle_lines.len().clamp(3, 14) + 2).min(file_lines.len());
    let formatted: Vec<String> = (start..end)
        .map(|i| format!("{}: {}", i + 1, file_lines[i]))
        .collect();
    Some(format!(
        "Closest match around L{}-L{}:\n{}",
        start + 1,
        end,
        formatted.join("\n")
    ))
}

fn replace_line_range(
    content: &str,
    start_line: usize,
    end_line: usize,
    new_string: &str,
) -> Result<(String, usize), String> {
    let lines: Vec<&str> = content.split('\n').collect();
    if start_line == 0 || end_line < start_line || start_line > lines.len() {
        return Err(format!(
            "Invalid line range L{}-L{} (file has {} lines).",
            start_line,
            end_line,
            lines.len()
        ));
    }
    let clamped_end = end_line.min(lines.len());
    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
    out.extend_from_slice(&lines[..start_line - 1]);
    if !new_string.is_empty() {
        out.push(new_string.trim_end_matches('\n'));
    }
    out.extend_from_slice(&lines[clamped_end..]);
    Ok((out.join("\n"), 1))
}

/// Applies OpenCode-style cascading replacers on LF-normalized content.
pub fn replace_content(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<(String, usize), String> {
    if old_string.is_empty() {
        return Err("oldString cannot be empty unless startLine and endLine are provided. Use 'write' to overwrite the full file.".to_string());
    }
    if old_string == new_string {
        return Err("No changes to apply: oldString and newString are identical.".to_string());
    }

    let candidate_lists: Vec<Vec<String>> = vec![
        vec![old_string.to_string()],
        line_trimmed_matches(content, old_string),
        block_anchor_matches(content, old_string),
        whitespace_normalized_matches(content, old_string),
        indentation_flexible_matches(content, old_string),
        trimmed_boundary_matches(content, old_string),
    ];

    for candidates in candidate_lists {
        for search in candidates {
            if search.is_empty() {
                continue;
            }
            if let Some(first_idx) = content.find(&search) {
                let count = content.matches(&search).count();
                if replace_all || count == 1 {
                    let updated = if replace_all {
                        content.replace(&search, new_string)
                    } else {
                        let mut res = String::with_capacity(content.len() + new_string.len());
                        res.push_str(&content[..first_idx]);
                        res.push_str(new_string);
                        res.push_str(&content[first_idx + search.len()..]);
                        res
                    };
                    return Ok((updated, if replace_all { count } else { 1 }));
                }
                // Multiple occurrences even when replaceAll is false: replace all to avoid blocking document edits
                let updated = content.replace(&search, new_string);
                return Ok((updated, count));
            }
        }
    }

    let hint = find_closest_snippet(content, old_string)
        .map(|s| format!("\n{}", s))
        .unwrap_or_default();
    Err(format!(
        "Could not find oldString in the file. Use the exact lines below (or pass startLine/endLine) without re-reading the whole file.{}",
        hint
    ))
}

pub fn execute_edit(session_id: &str, workspace_dir: &str, arguments: &Value) -> Value {
    let fp = arguments
        .get("filePath")
        .or_else(|| arguments.get("path"))
        .or_else(|| arguments.get("file"))
        .or_else(|| arguments.get("targetFile"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let target = arguments
        .get("oldString")
        .or_else(|| arguments.get("old_string"))
        .or_else(|| arguments.get("target"))
        .or_else(|| arguments.get("find"))
        .or_else(|| arguments.get("search"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let replacement = arguments
        .get("newString")
        .or_else(|| arguments.get("new_string"))
        .or_else(|| arguments.get("replacement"))
        .or_else(|| arguments.get("replace"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let replace_all = arguments
        .get("replaceAll")
        .or_else(|| arguments.get("replace_all"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let start_line = arguments
        .get("startLine")
        .or_else(|| arguments.get("start_line"))
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let end_line = arguments
        .get("endLine")
        .or_else(|| arguments.get("end_line"))
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);

    if target.is_empty() && (start_line.is_none() || end_line.is_none()) {
        return json!({
            "ok": false,
            "error": "oldString (target) cannot be empty unless startLine and endLine are provided. Use 'write' to overwrite the full file."
        });
    }

    match resolve_writable_isolated_path(workspace_dir, fp) {
        Ok(p) => match std::fs::read_to_string(&p) {
            Ok(content_old) => {
                let ending = detect_line_ending(&content_old);
                let norm_content = normalize_line_endings(&content_old);
                let norm_old = normalize_line_endings(target);
                let norm_new = normalize_line_endings(replacement);

                let edit_res = if let (Some(sl), Some(el)) = (start_line, end_line) {
                    replace_line_range(&norm_content, sl, el, &norm_new)
                } else {
                    replace_content(&norm_content, &norm_old, &norm_new, replace_all)
                };

                match edit_res {
                    Ok((norm_updated, count)) => {
                        let updated = convert_to_line_ending(&norm_updated, ending);
                        if let Err(val_err) = super::write::validate_root_tsx_imports(&p, &updated) {
                            return json!({ "ok": false, "error": val_err });
                        }
                        let (resolved_rel, film_root_rel) =
                            super::path_guard::resolve_film_display_info(workspace_dir, &p);
                        crate::files::record_document_change(workspace_dir, &resolved_rel, &content_old, &updated);
                        match std::fs::write(&p, &updated) {
                            Ok(_) => {
                                emit_event(
                                    workspace_dir,
                                    "file.edited",
                                    json!({
                                        "file": resolved_rel,
                                        "sessionID": session_id,
                                        "before": content_old,
                                        "after": updated
                                    }),
                                );
                                let mut res = json!({
                                    "ok": true,
                                    "output": "Edit applied successfully.",
                                    "occurrencesReplaced": count,
                                    "resolvedPath": resolved_rel
                                });
                                if let Some(fr) = film_root_rel {
                                    res["filmRoot"] = json!(fr);
                                }
                                super::film_feedback::attach_post_write_feedback(
                                    &mut res,
                                    workspace_dir,
                                    &p,
                                );
                                res
                            }
                            Err(e) => json!({ "ok": false, "error": format!("Write error: {}", e) }),
                        }
                    }
                    Err(err_msg) => json!({
                        "ok": false,
                        "error": format!("{} (file: '{}')", err_msg, fp)
                    }),
                }
            }
            Err(e) => json!({ "ok": false, "error": format!("Read error on '{}': {}", fp, e) }),
        },
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crlf_multiline_edit_succeeds() {
        let crlf_content = "SUMMARY REPORT\r\n1. Revenue: 100\r\n2. Expense: 20\r\nTotal: 80\r\n";
        let ending = detect_line_ending(crlf_content);
        assert_eq!(ending, "\r\n");

        let norm_content = normalize_line_endings(crlf_content);
        let norm_old = normalize_line_endings("2. Expense: 20\nTotal: 80");
        let norm_new = normalize_line_endings("2. Expense: 20\n3. Shipping: 15\nTotal: 65");

        let (updated_lf, count) = replace_content(&norm_content, &norm_old, &norm_new, false).unwrap();
        assert_eq!(count, 1);

        let final_crlf = convert_to_line_ending(&updated_lf, ending);
        assert!(final_crlf.contains("3. Shipping: 15\r\nTotal: 65\r\n"));
    }

    #[test]
    fn test_line_trimmed_and_whitespace_replacers() {
        let content = "Line 1   \n  Line 2:   Value 50  \nLine 3\n";
        let old_str = "Line 1\nLine 2: Value 50\nLine 3";
        let new_str = "Line 1\nLine 2: Value 75\nLine 3";

        let (updated, count) = replace_content(content, old_str, new_str, false).unwrap();
        assert_eq!(count, 1);
        assert!(updated.contains("Line 2: Value 75"));
    }

    #[test]
    fn test_edit_failure_includes_closest_line_snippet_and_line_range_works() {
        let content = "function drawStand(ctx, cx, cy, R) {\n  var standStartY = cy + R * 0.98;\n  var standEndY = cy + R * 1.48;\n  ctx.beginPath();\n}\n";
        let err = replace_content(
            content,
            "  var standEndY = cy + R * 1.55;\n  ctx.stroke();",
            "  var standEndY = cy + R * 1.60;",
            false,
        )
        .unwrap_err();
        assert!(err.contains("Closest match around L"));
        assert!(err.contains("3:   var standEndY = cy + R * 1.48;"));

        let (updated, count) = replace_line_range(content, 2, 3, "  var standStartY = cy + R;\n  var standEndY = cy + R * 1.60;").unwrap();
        assert_eq!(count, 1);
        assert!(updated.contains("1.60"));
        assert!(!updated.contains("1.48"));
    }
}
