//! Document Write Tool — mirrors `packages/engine/engine/src/tool/write.ts`.
//! Creates or updates a file inside the isolated active project folder.

use serde_json::{json, Value};

use std::path::Path;
use super::{resolve_isolated_path, resolve_writable_isolated_path};
use crate::session::message::emit_event;

pub fn validate_root_tsx_imports(file_path: &Path, content: &str) -> Result<(), String> {
    if !file_path
        .file_name()
        .map(|n| n == "Root.tsx" || n == "Root.jsx")
        .unwrap_or(false)
    {
        return Ok(());
    }
    let parent = file_path.parent().unwrap_or(file_path);
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("import ") && !trimmed.starts_with("export ") {
            continue;
        }
        for quote in ['"', '\''] {
            let marker = format!("from {quote}./");
            if let Some(pos) = trimmed.find(&marker) {
                let start = pos + marker.len() - 2;
                let rest = &trimmed[start..];
                if let Some(end) = rest[2..].find(quote) {
                    let rel_spec = &rest[..end + 2];
                    let clean_rel = rel_spec.trim_start_matches("./");
                    let candidates = [
                        parent.join(format!("{}.tsx", clean_rel)),
                        parent.join(format!("{}.ts", clean_rel)),
                        parent.join(format!("{}.jsx", clean_rel)),
                        parent.join(format!("{}.js", clean_rel)),
                        parent.join(clean_rel).join("index.tsx"),
                        parent.join(clean_rel).join("index.ts"),
                        parent.join(clean_rel),
                    ];
                    let exists = candidates.iter().any(|c| c.exists());
                    if !exists {
                        return Err(format!(
                            "Cannot update Root.tsx: imported file '{}' does not exist on disk yet. Please create and write '{}' first before referencing it in Root.tsx to prevent Vite build failures.",
                            rel_spec, rel_spec
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn write_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "write",
            "description": include_str!("prompt/write.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": { "type": "string", "description": "Relative path to the file inside workspace." },
                    "content": { "type": "string", "description": "Full file content to write." }
                },
                "required": ["filePath", "content"]
            }
        }
    })
}

/// Extracts a compact 1-based line-number index of structural anchors (scenes, render functions,
/// film metadata) for larger HTML/JS/TS files so the agent can call `edit`/`apply_patch` directly
/// without wasting multiple sequential `read` turns scanning its own freshly written file.
fn extract_file_line_index(path: &Path, content: &str) -> Vec<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "html" | "htm" | "js" | "mjs" | "ts" | "tsx") {
        return Vec::new();
    }
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= 60 {
        return Vec::new();
    }
    let mut anchors = Vec::new();
    for (idx, raw) in lines.iter().enumerate() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let is_anchor = trimmed.starts_with("// SCENE")
            || trimmed.starts_with("/* SCENE")
            || trimmed.starts_with("// ===")
            || trimmed.starts_with("function render")
            || trimmed.starts_with("function draw")
            || trimmed.contains("AM.registerScene(")
            || trimmed.contains("window.__filmMeta")
            || trimmed.contains("window.renderAt")
            || trimmed.starts_with("const SCENES")
            || trimmed.starts_with("const scenes")
            || trimmed.starts_with("<script")
            || trimmed.starts_with("<style");
        if is_anchor {
            let preview: String = trimmed.chars().take(90).collect();
            anchors.push(format!("L{}: {}", idx + 1, preview));
            if anchors.len() >= 32 {
                break;
            }
        }
    }
    anchors
}

pub fn execute_write(session_id: &str, workspace_dir: &str, arguments: &Value) -> Value {
    let fp = arguments
        .get("filePath")
        .or_else(|| arguments.get("path"))
        .or_else(|| arguments.get("file"))
        .or_else(|| arguments.get("target"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let Some(content) = arguments
        .get("content")
        .and_then(|v| v.as_str())
    else {
        return json!({
            "ok": false,
            "empty": true,
            "skipped": true,
            "error": format!(
                "Parameter 'content' is required when calling 'write' on '{}'. Never omit 'content' or pass historical summary placeholders.",
                fp
            )
        });
    };
    if arguments.get("_note").is_some()
        || content.contains("[historical content omitted")
        || (content.trim().is_empty() && resolve_isolated_path(workspace_dir, fp).map(|p| p.is_file()).unwrap_or(false))
    {
        return json!({
            "ok": false,
            "empty": true,
            "skipped": true,
            "error": format!(
                "Refusing to overwrite '{}' with empty or omitted historical content. Provide the complete file text in 'content'.",
                fp
            )
        });
    }

    match resolve_writable_isolated_path(workspace_dir, fp) {
        Ok(p) => {
            if let Err(val_err) = validate_root_tsx_imports(&p, content) {
                return json!({ "ok": false, "error": val_err });
            }
            let before_content = std::fs::read_to_string(&p).unwrap_or_default();
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let (resolved_rel, film_root_rel) =
                super::path_guard::resolve_film_display_info(workspace_dir, &p);
            crate::files::record_document_change(workspace_dir, &resolved_rel, &before_content, content);
            let write_res = std::fs::write(&p, content);
            match write_res {
                Ok(_) => {
                    emit_event(
                        workspace_dir,
                        "file.edited",
                        json!({
                            "file": resolved_rel,
                            "sessionID": session_id,
                            "before": before_content,
                            "after": content
                        }),
                    );
                    let line_count = content.lines().count();
                    let line_index = extract_file_line_index(&p, content);
                    let mut res = json!({
                        "ok": true,
                        "bytesWritten": content.len(),
                        "lineCount": line_count,
                        "resolvedPath": resolved_rel
                    });
                    if !line_index.is_empty() {
                        res["lineIndex"] = json!(line_index);
                    }
                    if let Some(fr) = film_root_rel {
                        res["filmRoot"] = json!(fr);
                    }
                    super::film_feedback::attach_post_write_feedback(&mut res, workspace_dir, &p);
                    res
                }
                Err(e) => json!({ "ok": false, "error": format!("Write error: {}", e) }),
            }
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_rejects_missing_content_and_historical_omitted_placeholder() {
        let dir = std::env::temp_dir().join(format!("aetheria_write_guard_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("script")).unwrap();
        let scene_path = dir.join("script").join("scene1.js");
        std::fs::write(&scene_path, "window.AM.registerScene('scene1', function() {});").unwrap();

        let dir_str = dir.to_string_lossy().to_string();
        let res_missing = execute_write(
            "ses_test",
            &dir_str,
            &json!({ "filePath": "script/scene1.js", "_note": "historical content omitted" }),
        );
        assert_eq!(res_missing.get("ok").and_then(|v| v.as_bool()), Some(false));
        assert!(res_missing.get("error").is_some());
        let preserved = std::fs::read_to_string(&scene_path).unwrap();
        assert!(preserved.contains("registerScene"), "existing file must not be wiped to 0 bytes");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_returns_line_index_for_large_html_without_requiring_reread() {
        let dir = std::env::temp_dir().join(format!("aetheria_write_idx_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut lines = vec![
            "<!doctype html><html><head><style>body{margin:0}</style></head><body>".to_string(),
            "<script>".to_string(),
            "window.__filmMeta = { title: 'Test', width: 720, height: 1280, fps: 30, duration: 10, scenes: [] };".to_string(),
        ];
        for i in 0..70 {
            if i == 10 {
                lines.push("// SCENE 1: Glow Intro".to_string());
                lines.push("function renderScene1(ctx, t) {}".to_string());
            } else if i == 40 {
                lines.push("// SCENE 2: Morph".to_string());
                lines.push("function renderScene2(ctx, t) {}".to_string());
            } else {
                lines.push(format!("const pad_{} = {};", i, i));
            }
        }
        lines.push("window.renderAt = function(t) {};".to_string());
        lines.push("</script></body></html>".to_string());
        let html = lines.join("\n");

        let dir_str = dir.to_string_lossy().to_string();
        let res = execute_write("ses_idx", &dir_str, &json!({ "filePath": "index.html", "content": html }));
        assert_eq!(res.get("ok").and_then(|v| v.as_bool()), Some(true));
        let idx = res.get("lineIndex").and_then(|v| v.as_array()).expect("lineIndex should be present");
        let joined = idx.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("\n");
        assert!(joined.contains("window.__filmMeta"), "missing __filmMeta anchor: {}", joined);
        assert!(joined.contains("SCENE 1"), "missing SCENE 1 anchor: {}", joined);
        assert!(joined.contains("function renderScene2"), "missing renderScene2 anchor: {}", joined);
        assert!(joined.contains("window.renderAt"), "missing renderAt anchor: {}", joined);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
