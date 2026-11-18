//! Document Read Tool — mirrors `packages/opencode/src/tool/read.ts`.
//! Reads text files or lists directory entries within the isolated active project folder.

use base64::prelude::*;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

fn image_mime_for_path(p: &Path) -> Option<&'static str> {
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

use super::resolve_isolated_path;

/// Allows read-only access ONLY to built-in IDE skill instructions inside `.aetheria/skills/`
/// so skill paths surfaced in `<skills>` load cleanly without breaching workspace isolation.
fn resolve_builtin_skill_read_path(workspace_dir: &str, raw_file: &str) -> Option<PathBuf> {
    let trimmed = raw_file.trim();
    if trimmed.is_empty() {
        return None;
    }
    let req_path = Path::new(trimmed);
    if req_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return None;
    }
    let skills_root = std::fs::canonicalize(crate::paths::project_root().join(".aetheria").join("skills")).ok()?;
    if let Ok(candidate) = std::fs::canonicalize(req_path) {
        if candidate.is_file() && candidate.starts_with(&skills_root) {
            return Some(candidate);
        }
    }
    // Also map `.aetheria/skills/...` relative to `project_root()` or prefixed by `workspace_dir`
    let norm = trimmed.replace('\\', "/");
    let rel_skill = if let Some((_, tail)) = norm.split_once(".aetheria/skills/") {
        Some(tail.trim_start_matches('/'))
    } else if !workspace_dir.trim().is_empty() {
        let ws_norm = workspace_dir.trim().replace('\\', "/");
        norm.strip_prefix(&ws_norm)
            .and_then(|s| s.trim_start_matches('/').strip_prefix(".aetheria/skills/"))
    } else {
        None
    }?;
    if rel_skill.is_empty() || rel_skill.contains("..") {
        return None;
    }
    let candidate = std::fs::canonicalize(skills_root.join(rel_skill)).ok()?;
    if candidate.is_file() && candidate.starts_with(&skills_root) {
        Some(candidate)
    } else {
        None
    }
}

pub fn read_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "read",
            "description": include_str!("prompt/read.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": { "type": "string", "description": "Path to the file or directory inside the workspace." },
                    "offset": { "type": "number", "description": "Optional 1-indexed line number to begin reading from (1 = first line)." },
                    "limit": { "type": "number", "description": "Optional maximum number of lines to read." }
                },
                "required": ["filePath"]
            }
        }
    })
}

pub fn execute_read(workspace_dir: &str, arguments: &Value) -> Value {
    let fp = arguments
        .get("filePath")
        .or_else(|| arguments.get("path"))
        .or_else(|| arguments.get("file"))
        .or_else(|| arguments.get("target"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let resolved = resolve_isolated_path(workspace_dir, fp)
        .ok()
        .filter(|p| p.exists())
        .map(Ok)
        .or_else(|| resolve_builtin_skill_read_path(workspace_dir, fp).map(Ok))
        .unwrap_or_else(|| resolve_isolated_path(workspace_dir, fp));

    match resolved {
        Ok(p) => {
            if p.is_dir() {
                match std::fs::read_dir(&p) {
                    Ok(rd) => {
                        let mut entries = Vec::new();
                        for entry in rd.flatten() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            if name.starts_with('.') || name.starts_with("~$") || name == "node_modules" {
                                continue;
                            }
                            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                            if is_dir {
                                entries.push(format!("{}/", name));
                            } else {
                                entries.push(name);
                            }
                        }
                        entries.sort();
                        json!({ "content": entries.join("\n"), "isDirectory": true, "entries": entries })
                    }
                    Err(e) => json!({ "error": format!("Directory read error: {}", e) }),
                }
            } else if let Some(mime) = image_mime_for_path(&p) {
                const MAX_READ_IMAGE_BYTES: usize = 4 * 1024 * 1024;
                match std::fs::read(&p) {
                    Ok(bytes) if bytes.len() <= MAX_READ_IMAGE_BYTES => {
                        let b64 = BASE64_STANDARD.encode(&bytes);
                        let data_url = format!("data:{};base64,{}", mime, b64);
                        json!({
                            "ok": true,
                            "content": format!("Binary image file '{}' ({}, {} bytes) attached to vision context for direct visual inspection.", fp, mime, bytes.len()),
                            "isImage": true,
                            "mime": mime,
                            "bytes": bytes.len(),
                            "_vision_images": [data_url]
                        })
                    }
                    Ok(bytes) => json!({
                        "error": format!("Image file '{}' is too large ({} bytes, max 4 MB) to attach directly.", fp, bytes.len())
                    }),
                    Err(e) => json!({ "error": format!("Image read error: {}", e) }),
                }
            } else {
                match std::fs::read_to_string(&p) {
                    Ok(content) => {
                        // `offset` is a 1-indexed line number (see prompt/read.txt); 0 and 1 both
                        // mean the first line. Treating it as 0-based hid line 1 from agents.
                        let offset = arguments
                            .get("offset")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            .saturating_sub(1) as usize;
                        let limit = arguments.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);

                        let lines: Vec<&str> = content.lines().collect();
                        let total_lines = lines.len();

                        if offset > 0 || limit.is_some() || total_lines > crate::tool::truncator::MAX_TOOL_OUTPUT_LINES {
                            let lim = limit.unwrap_or(crate::tool::truncator::MAX_TOOL_OUTPUT_LINES);
                            let start = offset.min(total_lines);
                            let end = (start + lim).min(total_lines);
                            let sliced = lines[start..end].join("\n");
                            json!({
                                "content": sliced,
                                "linesTotal": total_lines,
                                "offset": start + 1,
                                "linesReturned": end - start
                            })
                        } else {
                            json!({ "content": content, "linesTotal": total_lines })
                        }
                    }
                    Err(e) => json!({ "error": format!("Read error: {}", e) }),
                }
            }
        }
        Err(e) => json!({ "error": e }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_allows_builtin_skills_and_rejects_arbitrary_external_paths() {
        let external = std::env::temp_dir()
            .join("aetheria_outside_ws_test")
            .join("secret.txt");
        assert!(resolve_builtin_skill_read_path("", external.to_string_lossy().as_ref()).is_none());

        let skill_md = crate::paths::project_root()
            .join(".aetheria")
            .join("skills")
            .join("mg-3d-spatial")
            .join("SKILL.md");
        if skill_md.is_file() {
            assert!(
                resolve_builtin_skill_read_path("", skill_md.to_string_lossy().as_ref()).is_some()
            );
            let isolated_ws = std::env::temp_dir().join("aetheria_isolated_skill_read");
            let ws_prefixed_skill = isolated_ws.join(".aetheria").join("skills").join("mg-3d-spatial").join("SKILL.md");
            assert!(
                resolve_builtin_skill_read_path(
                    isolated_ws.to_string_lossy().as_ref(),
                    ws_prefixed_skill.to_string_lossy().as_ref()
                )
                .is_some()
            );
        }
    }

    #[test]
    fn test_read_image_attaches_vision_data_url() {
        let dir = std::env::temp_dir().join(format!("aetheria_read_img_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let img_path = dir.join("sample.png");
        let tiny_png = [0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        std::fs::write(&img_path, tiny_png).unwrap();

        let res = execute_read(&dir.to_string_lossy(), &json!({ "filePath": "sample.png" }));
        assert_eq!(res.get("ok"), Some(&json!(true)));
        assert_eq!(res.get("isImage"), Some(&json!(true)));
        let imgs = res
            .get("_vision_images")
            .and_then(|v| v.as_array())
            .expect("vision images array");
        assert_eq!(imgs.len(), 1);
        assert!(imgs[0].as_str().unwrap().starts_with("data:image/png;base64,"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_offset_is_one_indexed_and_never_hides_first_line() {
        let dir = std::env::temp_dir().join(format!("aetheria_read_offset_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.js"), "(function(){\n  'use strict';\n  run();\n})();").unwrap();
        let ws = dir.to_string_lossy();

        for first in [0, 1] {
            let res = execute_read(&ws, &json!({ "filePath": "a.js", "offset": first, "limit": 2000 }));
            let content = res.get("content").and_then(|v| v.as_str()).unwrap();
            assert!(content.starts_with("(function(){"), "offset {} hid line 1: {}", first, content);
            assert_eq!(res.get("offset"), Some(&json!(1)));
            assert_eq!(res.get("linesReturned"), Some(&json!(4)));
        }

        let res = execute_read(&ws, &json!({ "filePath": "a.js", "offset": 3, "limit": 1 }));
        assert_eq!(res.get("content"), Some(&json!("  run();")));
        assert_eq!(res.get("offset"), Some(&json!(3)));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
