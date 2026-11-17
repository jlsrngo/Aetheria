//! Multi-File Patch Application Tool — mirrors `packages/core/src/tool/patch.ts`.
//! Parses `*** Begin Patch`, `*** Add File:`, `*** Update File:`, and `*** Delete File:`
//! blocks and applies them atomically inside the isolated workspace with baseline tracking.

use serde_json::{json, Value};

use super::{resolve_isolated_path, validate_writable_runtime_path};
use crate::session::message::emit_event;

pub fn apply_patch_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "apply_patch",
            "description": include_str!("prompt/apply_patch.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "patchText": {
                        "type": "string",
                        "description": "The full patch text describing all files to add, update, or delete."
                    }
                },
                "required": ["patchText"]
            }
        }
    })
}

pub fn execute_apply_patch(session_id: &str, workspace_dir: &str, arguments: &Value) -> Value {
    let patch_text = arguments
        .get("patchText")
        .or_else(|| arguments.get("patch"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if patch_text.trim().is_empty() {
        return json!({ "ok": false, "error": "patchText is required" });
    }

    let mut touched_files: Vec<String> = Vec::new();
    let mut touched_paths: Vec<std::path::PathBuf> = Vec::new();
    let mut rollback_log: Vec<(std::path::PathBuf, Option<Vec<u8>>)> = Vec::new();
    let mut current_op: Option<(&str, String)> = None;
    let mut current_lines: Vec<&str> = Vec::new();

    let rollback_all = |log: &[(std::path::PathBuf, Option<Vec<u8>>)]| {
        for (path, prev_opt) in log.iter().rev() {
            match prev_opt {
                Some(bytes) => {
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(path, bytes);
                }
                None => {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    };

    let flush_op = |op: Option<(&str, String)>,
                    lines: &[&str],
                    touched: &mut Vec<String>,
                    written: &mut Vec<std::path::PathBuf>,
                    log: &mut Vec<(std::path::PathBuf, Option<Vec<u8>>)>|
     -> Result<(), String> {
        let Some((kind, rel_path)) = op else {
            return Ok(());
        };
        let target = resolve_isolated_path(workspace_dir, &rel_path)?;
        match kind {
            "delete" => {
                validate_writable_runtime_path(&target)?;
                if target.exists() {
                    let prev = std::fs::read(&target).map_err(|e| e.to_string())?;
                    log.push((target.clone(), Some(prev)));
                    std::fs::remove_file(&target).map_err(|e| e.to_string())?;
                    touched.push(format!("D {}", rel_path));
                }
            }
            "add" => {
                validate_writable_runtime_path(&target)?;
                if let Some(parent) = target.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let prev = if target.exists() {
                    Some(std::fs::read(&target).map_err(|e| e.to_string())?)
                } else {
                    None
                };
                let content: String = lines
                    .iter()
                    .map(|l| l.strip_prefix('+').unwrap_or(l))
                    .collect::<Vec<_>>()
                    .join("\n");
                log.push((target.clone(), prev));
                std::fs::write(&target, &content).map_err(|e| e.to_string())?;
                crate::files::record_document_change(workspace_dir, &rel_path, "", &content);
                touched.push(format!("A {}", rel_path));
                written.push(target);
            }
            "update" => {
                validate_writable_runtime_path(&target)?;
                let existing = std::fs::read_to_string(&target).map_err(|e| {
                    format!("Cannot read '{}' for update patch: {}", rel_path, e)
                })?;
                let updated = apply_unified_lines_to_content(&existing, lines)?;
                log.push((target.clone(), Some(existing.as_bytes().to_vec())));
                std::fs::write(&target, &updated).map_err(|e| e.to_string())?;
                crate::files::record_document_change(
                    workspace_dir,
                    &rel_path,
                    &existing,
                    &updated,
                );
                touched.push(format!("M {}", rel_path));
                written.push(target);
            }
            _ => {}
        }
        Ok(())
    };

    for raw_line in patch_text.lines() {
        let trimmed = raw_line.trim_end_matches('\r');
        if trimmed.starts_with("*** Begin Patch") || trimmed.starts_with("*** End Patch") {
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("*** Add File:") {
            if let Err(e) = flush_op(
                current_op.take(),
                &current_lines,
                &mut touched_files,
                &mut touched_paths,
                &mut rollback_log,
            ) {
                rollback_all(&rollback_log);
                return json!({ "ok": false, "error": e });
            }
            current_lines.clear();
            current_op = Some(("add", path.trim().to_string()));
        } else if let Some(path) = trimmed.strip_prefix("*** Update File:") {
            if let Err(e) = flush_op(
                current_op.take(),
                &current_lines,
                &mut touched_files,
                &mut touched_paths,
                &mut rollback_log,
            ) {
                rollback_all(&rollback_log);
                return json!({ "ok": false, "error": e });
            }
            current_lines.clear();
            current_op = Some(("update", path.trim().to_string()));
        } else if let Some(path) = trimmed.strip_prefix("*** Delete File:") {
            if let Err(e) = flush_op(
                current_op.take(),
                &current_lines,
                &mut touched_files,
                &mut touched_paths,
                &mut rollback_log,
            ) {
                rollback_all(&rollback_log);
                return json!({ "ok": false, "error": e });
            }
            current_lines.clear();
            current_op = Some(("delete", path.trim().to_string()));
        } else {
            current_lines.push(trimmed);
        }
    }

    if let Err(e) = flush_op(
        current_op.take(),
        &current_lines,
        &mut touched_files,
        &mut touched_paths,
        &mut rollback_log,
    ) {
        rollback_all(&rollback_log);
        return json!({ "ok": false, "error": e });
    }

    emit_event(
        workspace_dir,
        "patch.applied",
        json!({ "sessionID": session_id, "files": touched_files }),
    );

    let mut res = json!({
        "ok": true,
        "filesChanged": touched_files,
        "output": format!("Successfully applied patch to {} file(s): {}", touched_files.len(), touched_files.join(", "))
    });
    if let Some(last_target) = touched_paths.last() {
        super::film_feedback::attach_post_write_feedback(&mut res, workspace_dir, last_target);
    }
    res
}

fn apply_unified_lines_to_content(original: &str, patch_lines: &[&str]) -> Result<String, String> {
    let mut content = original.replace("\r\n", "\n");
    let mut old_block = Vec::new();
    let mut new_block = Vec::new();

    let apply_hunk = |src: &mut String, old_b: &[String], new_b: &[String]| -> Result<(), String> {
        if old_b.is_empty() && new_b.is_empty() {
            return Ok(());
        }
        let old_str = old_b.join("\n");
        let new_str = new_b.join("\n");
        if old_str.is_empty() {
            if !src.ends_with('\n') && !src.is_empty() {
                src.push('\n');
            }
            src.push_str(&new_str);
            return Ok(());
        }
        if let Some(pos) = src.find(&old_str) {
            src.replace_range(pos..pos + old_str.len(), &new_str);
            Ok(())
        } else {
            Err(format!(
                "Could not locate patch context block:\n{}",
                old_str.lines().take(3).collect::<Vec<_>>().join("\n")
            ))
        }
    };

    for line in patch_lines {
        if line.starts_with("@@") {
            apply_hunk(&mut content, &old_block, &new_block)?;
            old_block.clear();
            new_block.clear();
        } else if let Some(removed) = line.strip_prefix('-') {
            old_block.push(removed.to_string());
        } else if let Some(added) = line.strip_prefix('+') {
            new_block.push(added.to_string());
        } else if let Some(ctx) = line.strip_prefix(' ') {
            old_block.push(ctx.to_string());
            new_block.push(ctx.to_string());
        } else {
            old_block.push((*line).to_string());
            new_block.push((*line).to_string());
        }
    }
    apply_hunk(&mut content, &old_block, &new_block)?;
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_patch_rolls_back_earlier_edits_on_failure() {
        let tmp = std::env::temp_dir().join(format!("aetheria_patch_rb_{}", crate::paths::now_ms()));
        std::fs::create_dir_all(&tmp).expect("mkdir");
        let file_a = tmp.join("a.txt");
        std::fs::write(&file_a, "line1\nold\nline3\n").expect("write a");
        let ws = tmp.to_string_lossy().to_string();

        let patch = concat!(
            "*** Begin Patch\n",
            "*** Update File: a.txt\n",
            " line1\n",
            "-old\n",
            "+new\n",
            "*** Update File: missing.txt\n",
            "-nope\n",
            "+never\n",
            "*** End Patch\n",
        );

        let res = execute_apply_patch("sess1", &ws, &json!({ "patchText": patch }));
        assert_eq!(res.get("ok").and_then(Value::as_bool), Some(false));
        let after_a = std::fs::read_to_string(&file_a).expect("read a");
        assert_eq!(after_a, "line1\nold\nline3\n");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

