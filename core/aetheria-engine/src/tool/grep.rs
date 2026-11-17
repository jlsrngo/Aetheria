//! Document Grep Tool — mirrors `packages/engine/engine/src/tool/grep.ts`.
//! Fast file content search using regex or substring matching within the workspace.

use serde_json::{json, Value};
use std::path::Path;

use super::resolve_isolated_path;
use crate::files::collect_files_recursive;

pub fn grep_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "grep",
            "description": include_str!("prompt/grep.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "The regex or literal pattern to search for in file contents." },
                    "path": { "type": "string", "description": "Optional subdirectory or file to search in. Defaults to workspace root." },
                    "include": { "type": "string", "description": "Optional file pattern to include (e.g. '*.txt', '*.json', '*.csv')." }
                },
                "required": ["pattern"]
            }
        }
    })
}

pub fn execute_grep(workspace_dir: &str, arguments: &Value) -> Value {
    let pattern_str = arguments
        .get("pattern")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if pattern_str.is_empty() {
        return json!({ "ok": false, "error": "Pattern is required for grep." });
    }

    let sub_path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or(".");
    let include_pattern = arguments
        .get("include")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let target_dir = match resolve_isolated_path(workspace_dir, sub_path) {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };

    const MAX_SCAN_FILES: usize = 300;
    const MAX_MATCHES: usize = 100;
    let mut all_files = Vec::new();
    let base = Path::new(workspace_dir);
    if target_dir.is_file() {
        all_files.push(target_dir.clone());
    } else {
        collect_files_recursive(base, &target_dir, &mut all_files, MAX_SCAN_FILES);
    }
    let mut truncated = all_files.len() >= MAX_SCAN_FILES;

    let mut matches = Vec::new();
    let mut files_scanned = 0usize;
    let terms: Vec<&str> = if pattern_str.contains('|') {
        pattern_str.split('|').map(str::trim).filter(|s| !s.is_empty()).collect()
    } else {
        vec![pattern_str]
    };

    for fpath in all_files {
        let rel_name = fpath
            .strip_prefix(base)
            .unwrap_or(&fpath)
            .to_string_lossy()
            .replace('\\', "/");
        if !include_pattern.is_empty()
            && !super::glob::matches_glob_pattern(include_pattern, &rel_name)
        {
            continue;
        }

        files_scanned += 1;
        if let Ok(content) = std::fs::read_to_string(&fpath) {
            for (line_idx, line) in content.lines().enumerate() {
                if terms.iter().any(|t| line.contains(t)) {
                    matches.push(json!({
                        "file": rel_name,
                        "line": line_idx + 1,
                        "text": line.trim()
                    }));
                    if matches.len() >= MAX_MATCHES {
                        truncated = true;
                        break;
                    }
                }
            }
        }
        if matches.len() >= MAX_MATCHES {
            truncated = true;
            break;
        }
    }

    if matches.is_empty() {
        return json!({
            "ok": true,
            "title": pattern_str,
            "matches": 0,
            "truncated": truncated,
            "output": format!("No matches found for '{}' across {} files.", pattern_str, files_scanned)
        });
    }

    let total = matches.len();
    let mut output_lines = vec![format!("Found {} matches{}:", total, if truncated { " (truncated)" } else { "" })];
    let mut current_file = String::new();

    for m in &matches {
        let f = m["file"].as_str().unwrap_or("");
        let line_num = m["line"].as_u64().unwrap_or(0);
        let text = m["text"].as_str().unwrap_or("");
        if f != current_file {
            current_file = f.to_string();
            output_lines.push(format!("\n{}:", f));
        }
        output_lines.push(format!("  Line {}: {}", line_num, text));
    }

    json!({
        "ok": true,
        "title": pattern_str,
        "matches": total,
        "truncated": truncated,
        "output": output_lines.join("\n"),
        "results": matches
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_grep_handles_alternation_and_reports_truncated_flag() {
        let tmp = std::env::temp_dir().join(format!("aetheria_grep_test_{}", crate::paths::now_ms()));
        std::fs::create_dir_all(&tmp).expect("mkdir");
        std::fs::write(tmp.join("a.js"), "alpha\nbeta\ngamma\n").expect("write");
        let res = execute_grep(
            &tmp.to_string_lossy(),
            &json!({ "pattern": "alpha|gamma", "include": "*.js" }),
        );
        assert_eq!(res.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(res.get("matches").and_then(Value::as_u64), Some(2));
        assert_eq!(res.get("truncated").and_then(Value::as_bool), Some(false));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
