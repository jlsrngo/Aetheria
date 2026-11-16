//! Multimodal vision & media processing:
//! - File attachment ingestion (images, audio, video)
//! - Frame extraction via FFmpeg for Vision LLMs
//! - TikTok & YouTube link preview and keyframe extraction

use base64::prelude::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Finds a local FFmpeg binary on PATH or standard engine locations.
pub fn find_ffmpeg_bin() -> Option<PathBuf> {
    crate::paths::locate_ffmpeg_binary()
}

/// Resolves the isolated `ref/` directory inside the currently open project folder.
fn resolve_workspace_ref_dir(workspace_dir: &str) -> PathBuf {
    let dir = crate::tool::path_guard::resolve_isolated_path(workspace_dir, "ref")
        .unwrap_or_else(|_| crate::paths::aetheria_dot_dir().join("scratch").join("ref"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Returns true when an attached file item is a text/code document (`.html`, `.svg`, `.js`, `.css`, `.json`, `.txt`, `.md`).
pub fn is_text_or_code_attachment(file_name: &str, uri: &str, mime: &str) -> bool {
    let lower_name = file_name.trim().to_ascii_lowercase();
    let lower_mime = mime.trim().to_ascii_lowercase();
    let lower_uri = uri.trim().to_ascii_lowercase();
    if [
        ".html", ".htm", ".svg", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".json", ".txt",
        ".md", ".xml",
    ]
    .iter()
    .any(|ext| lower_name.ends_with(ext))
    {
        return true;
    }
    lower_mime.starts_with("text/")
        || lower_mime == "image/svg+xml"
        || lower_mime == "application/json"
        || lower_mime == "application/javascript"
        || lower_uri.starts_with("data:text/")
        || lower_uri.starts_with("data:image/svg+xml")
        || lower_uri.starts_with("data:application/json")
        || lower_uri.starts_with("data:application/javascript")
}

/// Returns true when an attached file is a standalone HTML or SVG stage file.
pub fn is_standalone_html_or_svg_attachment(file_name: &str, uri: &str, mime: &str) -> bool {
    let lower_name = file_name.trim().to_ascii_lowercase();
    let lower_mime = mime.trim().to_ascii_lowercase();
    let lower_uri = uri.trim().to_ascii_lowercase();
    lower_name.ends_with(".html")
        || lower_name.ends_with(".htm")
        || lower_name.ends_with(".svg")
        || lower_mime == "text/html"
        || lower_mime == "image/svg+xml"
        || lower_uri.starts_with("data:text/html")
        || lower_uri.starts_with("data:image/svg+xml")
}

/// Decodes a `data:...;base64,...` or plain `data:...,...` URI into UTF-8 text.
pub fn decode_data_uri_text(uri: &str) -> Option<String> {
    let trimmed = uri.trim();
    if !trimmed.starts_with("data:") {
        return None;
    }
    let comma_pos = trimmed.find(',')?;
    let header = &trimmed[..comma_pos].to_ascii_lowercase();
    let payload = &trimmed[comma_pos + 1..];
    if header.contains(";base64") {
        let bytes = BASE64_STANDARD.decode(payload.trim()).ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    } else {
        Some(crate::files::urlencoding_decode(payload))
    }
}

/// Ingests attached files from chat payload (images, videos, audio, and text/HTML/SVG code)
pub fn process_attached_files(
    workspace_dir: &str,
    files: Option<&Value>,
    ffmpeg_bin: Option<&Path>,
) -> (Vec<String>, Vec<String>) {
    let mut ocr_transcriptions = Vec::new();
    let mut image_urls = Vec::new();

    let files_arr = match files.and_then(|f| f.as_array()) {
        Some(arr) => arr,
        None => return (ocr_transcriptions, image_urls),
    };

    for file_item in files_arr {
        let file_name = file_item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("attached_media");
        let uri = file_item
            .get("uri")
            .or_else(|| file_item.get("url"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mime = file_item
            .get("mime")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let lower_name = file_name.to_lowercase();

        if uri.starts_with("data:image/")
            && !uri.starts_with("data:image/svg")
            && !lower_name.ends_with(".svg")
        {
            image_urls.push(uri.to_string());
            if let Some(comma_pos) = uri.find(',') {
                let b64_data = &uri[comma_pos + 1..];
                if let Ok(bytes) = BASE64_STANDARD.decode(b64_data.trim()) {
                    let ref_dir = resolve_workspace_ref_dir(workspace_dir);
                    let clean_name = file_name
                        .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_', "_");
                    let img_path = ref_dir.join(format!("ref_{}", clean_name));
                    if std::fs::write(&img_path, &bytes).is_ok() {
                        ocr_transcriptions.push(format!(
                            "[Reference Image Style Asset: '{}' saved at ref/ref_{} — translate its palette, composition, lighting, and typography into procedural Canvas/WebGL code; NEVER load or draw 'ref/ref_{}' directly as a canvas backdrop/image]",
                            file_name, clean_name, clean_name
                        ));
                    }
                }
            }
        } else if uri.starts_with("data:video/")
            || (uri.starts_with("data:")
                && (lower_name.ends_with(".mp4")
                    || lower_name.ends_with(".mov")
                    || lower_name.ends_with(".webm")
                    || lower_name.ends_with(".mkv")))
        {
            if let Some(comma_pos) = uri.find(',') {
                let b64_data = &uri[comma_pos + 1..];
                if let Ok(bytes) = BASE64_STANDARD.decode(b64_data.trim()) {
                    let ref_dir = resolve_workspace_ref_dir(workspace_dir);
                    let clean_name = file_name
                        .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_', "_");
                    let vid_path = ref_dir.join(format!("ref_{}", clean_name));
                    let ref_wav = ref_dir.join("ref_voice.wav");
                    if std::fs::write(&vid_path, &bytes).is_ok() {
                        if let Some(ff) = ffmpeg_bin {
                            // Extract reference voice audio track (24kHz mono WAV)
                            let mut ff_audio = std::process::Command::new(ff);
                            crate::paths::configure_hidden_std_command(&mut ff_audio);
                            let _ = ff_audio
                                .args([
                                    "-y",
                                    "-hide_banner",
                                    "-loglevel",
                                    "error",
                                    "-i",
                                    &vid_path.to_string_lossy(),
                                    "-vn",
                                    "-ac",
                                    "1",
                                    "-ar",
                                    "24000",
                                    &ref_wav.to_string_lossy(),
                                ])
                                .output();

                            // Extract 4 visual style keyframes at normalized ratios [10%, 35%, 60%, 85%] of probed video duration
                            let probed_dur = crate::studio::reference_compare::probe_video_duration_secs(
                                ff,
                                &vid_path,
                            )
                            .unwrap_or(10.0);
                            let sample_points =
                                super::social_links::compute_relative_sample_timestamps(probed_dur);
                            for (idx, (_ratio, ts)) in sample_points.iter().enumerate() {
                                let frame_jpg = ref_dir.join(format!("ref_frame_{}.jpg", idx + 1));
                                let mut ff_frame = std::process::Command::new(ff);
                                crate::paths::configure_hidden_std_command(&mut ff_frame);
                                if ff_frame
                                    .args([
                                        "-y",
                                        "-hide_banner",
                                        "-loglevel",
                                        "error",
                                        "-ss",
                                        ts.as_str(),
                                        "-i",
                                        &vid_path.to_string_lossy(),
                                        "-frames:v",
                                        "1",
                                        "-q:v",
                                        "4",
                                        &frame_jpg.to_string_lossy(),
                                    ])
                                    .output()
                                    .map(|o| o.status.success())
                                    .unwrap_or(false)
                                {
                                    if let Ok(jpg_bytes) = std::fs::read(&frame_jpg) {
                                        if !jpg_bytes.is_empty() {
                                            let b64_jpg = BASE64_STANDARD.encode(&jpg_bytes);
                                            image_urls.push(format!("data:image/jpeg;base64,{}", b64_jpg));
                                        }
                                    }
                                }
                            }
                        }
                        ocr_transcriptions.push(format!(
                            "[Reference Video Style & Voice Asset: '{}' saved at ref/ref_{} with keyframes ref/ref_frame_1.jpg..ref/ref_frame_4.jpg at normalized ratios [10%, 35%, 60%, 85%]. Visual keyframes have been attached for style matching, and its voice track is extracted at 'ref/ref_voice.wav'. Only clone it (refAudio + cloneVoice: true) if it is the user's own voice or they confirmed permission; otherwise describe its tone in voiceDesign.]",
                            file_name, clean_name
                        ));
                    }
                }
            }
        } else if uri.starts_with("data:audio/")
            || (uri.starts_with("data:")
                && (lower_name.ends_with(".wav")
                    || lower_name.ends_with(".mp3")
                    || lower_name.ends_with(".m4a")
                    || lower_name.ends_with(".ogg")))
        {
            if let Some(comma_pos) = uri.find(',') {
                let b64_data = &uri[comma_pos + 1..];
                if let Ok(bytes) = BASE64_STANDARD.decode(b64_data.trim()) {
                    let ref_dir = resolve_workspace_ref_dir(workspace_dir);
                    let clean_name = file_name
                        .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_', "_");
                    let raw_audio = ref_dir.join(format!("ref_{}", clean_name));
                    let ref_wav = ref_dir.join("ref_voice.wav");
                    if std::fs::write(&raw_audio, &bytes).is_ok() {
                        if let Some(ff) = ffmpeg_bin {
                            let mut ff_norm = std::process::Command::new(ff);
                            crate::paths::configure_hidden_std_command(&mut ff_norm);
                            let _ = ff_norm
                                .args([
                                    "-y",
                                    "-hide_banner",
                                    "-loglevel",
                                    "error",
                                    "-i",
                                    &raw_audio.to_string_lossy(),
                                    "-ac",
                                    "1",
                                    "-ar",
                                    "24000",
                                    &ref_wav.to_string_lossy(),
                                ])
                                .output();
                        } else {
                            let _ = std::fs::copy(&raw_audio, &ref_wav);
                        }
                        ocr_transcriptions.push(format!(
                            "[Reference Voice Audio Asset: '{}' normalized to 'ref/ref_voice.wav'. If this is the user's own recording (or they confirmed permission), pass refAudio: \"ref/ref_voice.wav\" with cloneVoice: true to voicebox_speak; otherwise describe its tone in voiceDesign.]",
                            file_name
                        ));
                    }
                }
            }
        } else if is_text_or_code_attachment(&lower_name, uri, mime) {
            let decoded_opt = decode_data_uri_text(uri).or_else(|| {
                if !uri.is_empty() && !uri.starts_with("data:") {
                    crate::tool::path_guard::resolve_isolated_path(workspace_dir, uri)
                        .ok()
                        .and_then(|p| std::fs::read_to_string(p).ok())
                } else {
                    None
                }
            });
            if let Some(decoded_text) = decoded_opt {
                let clean_name = file_name
                    .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_' && c != '-', "_");
                let mut saved_rel = String::new();
                if !workspace_dir.trim().is_empty() {
                    if let Ok(upload_dir) =
                        crate::tool::path_guard::resolve_isolated_path(workspace_dir, ".aetheria/uploads")
                    {
                        let _ = std::fs::create_dir_all(&upload_dir);
                        let target_file = upload_dir.join(&clean_name);
                        if std::fs::write(&target_file, decoded_text.as_bytes()).is_ok() {
                            saved_rel = format!(".aetheria/uploads/{}", clean_name);
                        }
                    }
                }
                let max_inline_chars = 120_000usize;
                let inline_snippet: String = if decoded_text.chars().count() > max_inline_chars {
                    let mut s: String = decoded_text.chars().take(max_inline_chars).collect();
                    s.push_str(&format!(
                        "\n... [truncated inline at {} chars; full file saved at {}]",
                        max_inline_chars, saved_rel
                    ));
                    s
                } else {
                    decoded_text
                };

                if is_standalone_html_or_svg_attachment(&lower_name, uri, mime) {
                    let target_prefix = if !workspace_dir.trim().is_empty() {
                        let ws_path = Path::new(workspace_dir);
                        let state = crate::studio::project_registry::list_studio_projects(ws_path);
                        state
                            .active_project
                            .map(|slug| format!("projects/{}/", slug))
                            .unwrap_or_default()
                    } else {
                        String::new()
                    };
                    ocr_transcriptions.push(format!(
                        "[Attached Standalone HTML/SVG Source File: '{}'{}]\n\
                         TARGET OUTPUT LOCATION: Write the cleaned stage directly to `{prefix}index.html` and `{prefix}script/scene1.js` (and `{prefix}microstock/manifest.json` when Microstock Mode 'M' is active).\n\
                         STRICT ISOLATION RULE: Use ONLY this attached source code below. Do NOT read or inspect unrelated files in workspace root, `ref/`, or other `projects/*` folders, and do NOT call `glob` or `explore` to search for other projects. Preserve all original vector `<svg>` artwork, gradients, filters, and characters verbatim while stripping UI control panels/buttons/sliders, external CDNs, `<text>`/`<tspan>` (when Microstock Mode 'M' is active), and converting animations into deterministic `window.renderAt(t)`.\n\
                         ```html\n{}\n```",
                        file_name,
                        if saved_rel.is_empty() {
                            String::new()
                        } else {
                            format!(" (saved at {})", saved_rel)
                        },
                        inline_snippet,
                        prefix = target_prefix
                    ));
                } else {
                    ocr_transcriptions.push(format!(
                        "[Attached Code/Text File: '{}'{}]:\n```\n{}\n```",
                        file_name,
                        if saved_rel.is_empty() {
                            String::new()
                        } else {
                            format!(" (saved at {})", saved_rel)
                        },
                        inline_snippet
                    ));
                }
            }
        } else if !uri.is_empty() {
            if let Ok(candidate) = crate::tool::path_guard::resolve_isolated_path(workspace_dir, uri) {
                if candidate.exists() {
                    ocr_transcriptions.push(format!(
                        "[Attached Media Asset: {} at {}]",
                        file_name,
                        candidate.display()
                    ));
                }
            }
        }
    }

    (ocr_transcriptions, image_urls)
}

/// Removes `_vision_images` from a tool result before serialization and appends valid image data URLs.
pub(crate) fn extract_tool_vision_images(tool_out: &mut Value, collected: &mut Vec<String>) {
    let imgs = tool_out
        .as_object_mut()
        .and_then(|obj| obj.remove("_vision_images"))
        .and_then(|v| match v {
            Value::Array(arr) => Some(arr),
            _ => None,
        })
        .unwrap_or_default();
    for item in imgs {
        if let Some(url) = item.as_str() {
            if url.starts_with("data:image/") {
                collected.push(url.to_string());
            }
        }
    }
}

/// Appends a multimodal user inspection message containing images returned by tools (e.g. `capture_film_preview`)
/// only when `model_supports_vision` is true.
pub(crate) fn append_tool_vision_message(
    chat_messages: &mut Vec<Value>,
    model_supports_vision: bool,
    images: Vec<String>,
) {
    if !model_supports_vision || images.is_empty() {
        return;
    }
    let mut parts = vec![serde_json::json!({
        "type": "text",
        "text": "[Visual Inspection Images attached from tool execution. Examine composition, colors, lighting, typography, and layout, and compare against any user reference images/links before finalizing or making edits.]"
    })];
    for url in images {
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": url }
        }));
    }
    chat_messages.push(serde_json::json!({
        "role": "user",
        "content": parts
    }));
}

pub use super::social_links::process_social_links;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_strips_tool_vision_images() {
        let mut tool_out = serde_json::json!({
            "ok": true,
            "output": "Captured preview",
            "_vision_images": ["data:image/jpeg;base64,AAAA"]
        });
        let mut collected = Vec::new();
        extract_tool_vision_images(&mut tool_out, &mut collected);
        assert!(tool_out.get("_vision_images").is_none());
        assert_eq!(collected, vec!["data:image/jpeg;base64,AAAA".to_string()]);

        let mut msgs = Vec::new();
        append_tool_vision_message(&mut msgs, true, collected.clone());
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].get("role").and_then(|v| v.as_str()), Some("user"));
        assert_eq!(
            msgs[0].pointer("/content/1/image_url/url").and_then(|v| v.as_str()),
            Some("data:image/jpeg;base64,AAAA")
        );

        let mut text_only_msgs = Vec::new();
        append_tool_vision_message(&mut text_only_msgs, false, collected);
        assert!(text_only_msgs.is_empty());
    }

    #[test]
    fn decodes_attached_html_file_and_saves_upload_copy() {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_vision_html_test_{}",
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let html_raw = "<!DOCTYPE html><html><body><svg id=\"main-svg\"></svg><div id=\"control-panel\"></div></body></html>";
        let b64 = BASE64_STANDARD.encode(html_raw.as_bytes());
        let files_val = serde_json::json!([
            {
                "name": "animasi_happy_new_year_2027_microstock.html",
                "uri": format!("data:text/html;base64,{}", b64),
                "mime": "text/html"
            }
        ]);
        let (transcriptions, images) =
            process_attached_files(&dir.to_string_lossy(), Some(&files_val), None);
        assert!(images.is_empty());
        assert_eq!(transcriptions.len(), 1);
        assert!(transcriptions[0].contains("Attached Standalone HTML/SVG Source File"));
        assert!(transcriptions[0].contains("<svg id=\"main-svg\"></svg>"));
        assert!(dir
            .join(".aetheria/uploads/animasi_happy_new_year_2027_microstock.html")
            .is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

