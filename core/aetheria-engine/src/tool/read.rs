//! Document Read Tool — mirrors `packages/core/src/tool/plugin/read.ts`.
//! Reads text files (1-based line numbers, 2,000-byte line clamp, binary NUL detection,
//! past-EOF tail recovery, Levenshtein "Did you mean" path hints), images, or directory entries
//! within the isolated active project folder.

use base64::prelude::*;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

use super::resolve_isolated_path;
use super::truncator::{MAX_LINE_LENGTH, MAX_TOOL_OUTPUT_LINES};

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

fn is_likely_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.contains(&0u8) {
        return true;
    }
    let mut non_printable = 0usize;
    for &b in sample {
        if b < 0x09 || (b > 0x0D && b < 0x20) {
            non_printable += 1;
        }
    }
    non_printable * 10 > sample.len() * 3
}

fn levenshtein_ascii(a: &str, b: &str) -> usize {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let mut prev: Vec<usize> = (0..=b_bytes.len()).collect();
    let mut curr = vec![0usize; b_bytes.len() + 1];
    for (i, &ac) in a_bytes.iter().enumerate() {
        curr[0] = i + 1;
        for (j, &bc) in b_bytes.iter().enumerate() {
            let cost = usize::from(!ac.eq_ignore_ascii_case(&bc));
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b_bytes.len()]
}

fn suggest_similar_paths(workspace_dir: &str, missing_path: &Path) -> Vec<String> {
    let ws_root = Path::new(workspace_dir);
    let Some(parent) = missing_path.parent() else {
        return Vec::new();
    };
    let Some(target_name) = missing_path.file_name().and_then(|s| s.to_str()) else {
        return Vec::new();
    };
    if !parent.is_dir() || !crate::paths::contains_path(ws_root, parent) {
        return Vec::new();
    }
    let Ok(rd) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    let target_lower = target_name.to_ascii_lowercase();
    let mut scored: Vec<(usize, String)> = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let name_lower = name.to_ascii_lowercase();
        let dist = levenshtein_ascii(&target_lower, &name_lower);
        let contains_bonus = name_lower.contains(&target_lower) || target_lower.contains(&name_lower);
        let max_dist = (target_lower.len() / 2).max(3);
        if contains_bonus || dist <= max_dist {
            let rel = entry
                .path()
                .strip_prefix(ws_root)
                .unwrap_or(&entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            scored.push((if contains_bonus { dist.saturating_sub(2) } else { dist }, rel));
        }
    }
    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    scored.into_iter().take(3).map(|(_, p)| p).collect()
}

fn format_numbered_lines(lines: &[&str], start_0: usize, end_0: usize) -> String {
    let mut out = String::new();
    for (idx, line) in lines[start_0..end_0].iter().enumerate() {
        if idx > 0 {
            out.push('\n');
        }
        let line_no = start_0 + idx + 1;
        if line.len() > MAX_LINE_LENGTH {
            let cut = line.floor_char_boundary(MAX_LINE_LENGTH);
            out.push_str(&format!("{}: {}... [line truncated]", line_no, &line[..cut]));
        } else {
            out.push_str(&format!("{}: {}", line_no, line));
        }
    }
    out
}

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
    let skills_root =
        std::fs::canonicalize(crate::paths::project_root().join(".aetheria").join("skills"))
            .ok()?;
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
            if !p.exists() {
                let suggestions = suggest_similar_paths(workspace_dir, &p);
                let hint = if suggestions.is_empty() {
                    String::new()
                } else {
                    format!(" Did you mean: {}?", suggestions.join(", "))
                };
                return json!({
                    "ok": false,
                    "error": format!("File not found: '{}'.{}", fp, hint),
                    "suggestions": suggestions
                });
            }
            if p.is_dir() {
                match std::fs::read_dir(&p) {
                    Ok(rd) => {
                        let mut entries = Vec::new();
                        for entry in rd.flatten() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            if name.starts_with('.')
                                || name.starts_with("~$")
                                || name == "node_modules"
                            {
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
                    Err(e) => json!({ "ok": false, "error": format!("Directory read error: {}", e) }),
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
                            "_vision_images": [data_url],
                            "_vision_image_labels": [fp]
                        })
                    }
                    Ok(bytes) => json!({
                        "ok": false,
                        "error": format!("Image file '{}' is too large ({} bytes, max 4 MB) to attach directly.", fp, bytes.len())
                    }),
                    Err(e) => json!({ "ok": false, "error": format!("Image read error: {}", e) }),
                }
            } else {
                let raw_bytes = match std::fs::read(&p) {
                    Ok(b) => b,
                    Err(e) => return json!({ "ok": false, "error": format!("Read error: {}", e) }),
                };
                if is_likely_binary(&raw_bytes) {
                    let ext = p
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("binary");
                    return json!({
                        "ok": false,
                        "isBinary": true,
                        "bytes": raw_bytes.len(),
                        "error": format!(
                            "Cannot read binary file '{}' ({}, {} bytes) as text. Use 'bash' with python/ffprobe/node if you need to inspect binary data.",
                            fp, ext, raw_bytes.len()
                        )
                    });
                }
                let content = match String::from_utf8(raw_bytes) {
                    Ok(s) => s,
                    Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
                };

                // `offset` is a 1-indexed line number (see prompt/read.txt); 0 and 1 both
                // mean the first line.
                let requested_offset_1 = arguments
                    .get("offset")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1)
                    .max(1) as usize;
                let offset_0 = requested_offset_1.saturating_sub(1);
                let lim = arguments
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .map(|n| (n as usize).max(1))
                    .unwrap_or(MAX_TOOL_OUTPUT_LINES);

                let lines: Vec<&str> = content.lines().collect();
                let total_lines = lines.len();

                // Prevent slow 15-turn sequential nibbling on large HTML/JS/TS/CSS files:
                // when an agent requests a narrow 20..449 line slice of a >200-line code file,
                // expand the window to 450 lines so it sees full scene blocks in 1-2 reads.
                let is_large_code_file = total_lines > 200
                    && matches!(
                        p.extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_ascii_lowercase()
                            .as_str(),
                        "html" | "htm" | "js" | "mjs" | "ts" | "tsx" | "css"
                    );
                let lim = if is_large_code_file && lim >= 20 && lim < 450 {
                    450.min(MAX_TOOL_OUTPUT_LINES)
                } else {
                    lim
                };

                if total_lines == 0 {
                    return json!({
                        "content": "(empty file)",
                        "linesTotal": 0,
                        "offset": 1,
                        "linesReturned": 0,
                        "hasMore": false
                    });
                }

                if offset_0 >= total_lines {
                    let tail_start = total_lines.saturating_sub(50);
                    let tail_preview = format_numbered_lines(&lines, tail_start, total_lines);
                    return json!({
                        "ok": false,
                        "linesTotal": total_lines,
                        "error": format!(
                            "Offset {} is past end of file '{}' ({} lines total). Showing the last {} lines:\n{}",
                            requested_offset_1,
                            fp,
                            total_lines,
                            total_lines - tail_start,
                            tail_preview
                        )
                    });
                }

                let end_0 = (offset_0 + lim).min(total_lines);
                let numbered = format_numbered_lines(&lines, offset_0, end_0);
                json!({
                    "content": numbered,
                    "linesTotal": total_lines,
                    "offset": offset_0 + 1,
                    "linesReturned": end_0 - offset_0,
                    "hasMore": end_0 < total_lines
                })
            }
        }
        Err(e) => json!({ "ok": false, "error": e }),
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
            let ws_prefixed_skill = isolated_ws
                .join(".aetheria")
                .join("skills")
                .join("mg-3d-spatial")
                .join("SKILL.md");
            assert!(resolve_builtin_skill_read_path(
                isolated_ws.to_string_lossy().as_ref(),
                ws_prefixed_skill.to_string_lossy().as_ref()
            )
            .is_some());
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
    fn test_read_offset_is_one_indexed_and_prefixes_line_numbers() {
        let dir = std::env::temp_dir().join(format!("aetheria_read_offset_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.js"), "(function(){\n  'use strict';\n  run();\n})();").unwrap();
        let ws = dir.to_string_lossy();

        for first in [0, 1] {
            let res =
                execute_read(&ws, &json!({ "filePath": "a.js", "offset": first, "limit": 2000 }));
            let content = res.get("content").and_then(|v| v.as_str()).unwrap();
            assert!(
                content.starts_with("1: (function(){"),
                "offset {} hid or misnumbered line 1: {}",
                first,
                content
            );
            assert_eq!(res.get("offset"), Some(&json!(1)));
            assert_eq!(res.get("linesReturned"), Some(&json!(4)));
            assert_eq!(res.get("hasMore"), Some(&json!(false)));
        }

        let res = execute_read(&ws, &json!({ "filePath": "a.js", "offset": 3, "limit": 1 }));
        assert_eq!(res.get("content"), Some(&json!("3:   run();")));
        assert_eq!(res.get("offset"), Some(&json!(3)));
        assert_eq!(res.get("hasMore"), Some(&json!(true)));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_binary_guard_past_eof_recovery_and_did_you_mean() {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_read_diag_{}_{}",
            std::process::id(),
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("scene1.js"), "lineA\nlineB\nlineC\n").unwrap();
        std::fs::write(dir.join("clip.bin"), &[0x00, 0x01, 0xFF, 0x00, 0x42]).unwrap();
        let ws = dir.to_string_lossy();

        // 1. Binary NUL guard
        let bin_res = execute_read(&ws, &json!({ "filePath": "clip.bin" }));
        assert_eq!(bin_res.get("ok"), Some(&json!(false)));
        assert_eq!(bin_res.get("isBinary"), Some(&json!(true)));
        assert!(bin_res["error"].as_str().unwrap().contains("binary file"));

        // 2. Past-EOF tail recovery
        let eof_res = execute_read(&ws, &json!({ "filePath": "scene1.js", "offset": 99 }));
        assert_eq!(eof_res.get("ok"), Some(&json!(false)));
        let eof_err = eof_res["error"].as_str().unwrap();
        assert!(eof_err.contains("past end of file"));
        assert!(eof_err.contains("3: lineC"));

        // 3. Levenshtein "Did you mean" hint
        let miss_res = execute_read(&ws, &json!({ "filePath": "scne1.js" }));
        assert_eq!(miss_res.get("ok"), Some(&json!(false)));
        let miss_err = miss_res["error"].as_str().unwrap();
        assert!(miss_err.contains("Did you mean"));
        assert!(miss_err.contains("scene1.js"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_expands_tiny_slice_on_large_html_file() {
        let dir = std::env::temp_dir().join(format!("aetheria_read_expand_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let big_html = (1..=600)
            .map(|i| format!("// line {}", i))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(dir.join("index.html"), big_html).unwrap();

        let res = execute_read(
            &dir.to_string_lossy(),
            &json!({ "filePath": "index.html", "offset": 1, "limit": 60 }),
        );
        assert_eq!(res.get("linesReturned"), Some(&json!(450)));
        assert_eq!(res.get("hasMore"), Some(&json!(true)));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
