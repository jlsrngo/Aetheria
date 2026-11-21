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

fn is_video_file_name(lower_name: &str) -> bool {
    lower_name.ends_with(".mp4")
        || lower_name.ends_with(".mov")
        || lower_name.ends_with(".webm")
        || lower_name.ends_with(".mkv")
        || lower_name.ends_with(".avi")
}

struct SavedVideoAttachment {
    rel_path: String,
    disk_path: PathBuf,
    file_name: String,
    prefix: String,
}

/// Ingests attached files from chat payload (images, videos, audio, and text/HTML/SVG code).
/// When `defer_video_frames` is true, video files still extract audio and record their paths
/// so the async blueprint pipeline can attach MotionClone keyframes without duplicating naive thumbs.
fn process_attached_files_inner(
    workspace_dir: &str,
    files: Option<&Value>,
    ffmpeg_bin: Option<&Path>,
    defer_video_frames: bool,
) -> (Vec<String>, Vec<String>, Vec<SavedVideoAttachment>) {
    let mut ocr_transcriptions = Vec::new();
    let mut image_urls = Vec::new();
    let mut saved_videos = Vec::new();

    let files_arr = match files.and_then(|f| f.as_array()) {
        Some(arr) => arr,
        None => return (ocr_transcriptions, image_urls, saved_videos),
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
                            "[Reference Image Style Asset: '{}' saved at ref/ref_{} — translate its palette, composition, lighting, and typography into procedural HTML/CSS/SVG/Canvas/WebGL code; NEVER load or draw 'ref/ref_{}' directly as a canvas backdrop/image]",
                            file_name, clean_name, clean_name
                        ));
                    }
                }
            }
        } else if uri.starts_with("data:video/")
            || (uri.starts_with("data:") && is_video_file_name(&lower_name))
        {
            if let Some(comma_pos) = uri.find(',') {
                let b64_data = &uri[comma_pos + 1..];
                if let Ok(bytes) = BASE64_STANDARD.decode(b64_data.trim()) {
                    let ref_dir = resolve_workspace_ref_dir(workspace_dir);
                    let clean_name = file_name
                        .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_', "_");
                    let rel_path = format!("ref/ref_{}", clean_name);
                    let vid_path = ref_dir.join(format!("ref_{}", clean_name));
                    let ref_wav = ref_dir.join("ref_voice.wav");
                    if std::fs::write(&vid_path, &bytes).is_ok() {
                        super::social_links::extract_audio_track_ffmpeg(
                            ffmpeg_bin,
                            &vid_path,
                            &ref_wav,
                        );
                        if !defer_video_frames {
                            let probed_dur = ffmpeg_bin
                                .and_then(|ff| {
                                    crate::studio::reference_compare::probe_video_duration_secs(
                                        ff,
                                        &vid_path,
                                    )
                                })
                                .unwrap_or(10.0);
                            super::social_links::extract_sample_frames_ffmpeg(
                                ffmpeg_bin,
                                &ref_dir,
                                &vid_path,
                                &clean_name,
                                probed_dur,
                                &mut image_urls,
                            );
                        }
                        saved_videos.push(SavedVideoAttachment {
                            rel_path: rel_path.clone(),
                            disk_path: vid_path,
                            file_name: file_name.to_string(),
                            prefix: clean_name.clone(),
                        });
                        ocr_transcriptions.push(format!(
                            "[Reference Video Style & Voice Asset: '{}' saved at {} — voice track extracted at 'ref/ref_voice.wav'. Only clone it (refAudio + cloneVoice: true) if it is the user's own voice or they confirmed permission; otherwise describe its tone in voiceDesign.]",
                            file_name, rel_path
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
                    decoded_text.clone()
                };

                if is_standalone_html_or_svg_attachment(&lower_name, uri, mime) {
                    let (target_prefix, target_dir) = if !workspace_dir.trim().is_empty() {
                        let ws_path = Path::new(workspace_dir);
                        let state = crate::studio::project_registry::list_studio_projects(ws_path);
                        match state.active_project {
                            Some(slug) => (
                                format!("projects/{}/", slug),
                                ws_path.join("projects").join(slug),
                            ),
                            None => (String::new(), ws_path.to_path_buf()),
                        }
                    } else {
                        (String::new(), PathBuf::from("."))
                    };
                    let pre_extracted = if !workspace_dir.trim().is_empty() {
                        crate::studio::stage_extractor::extract_and_write_uploaded_stage(
                            workspace_dir,
                            &target_dir,
                            &decoded_text,
                        )
                    } else {
                        None
                    };
                    if pre_extracted.is_some() {
                        ocr_transcriptions.push(format!(
                            "[Attached Standalone HTML/SVG Source File: '{}'{} — STAGE ALREADY MOVED 1:1 BY ENGINE]\n\
                             The engine has ALREADY deterministically extracted and moved the exact visual stage (`<svg>`, `<canvas>`, CSS `@keyframes`, and original JS functions including particle/rocket loops) 1:1 into `{prefix}index.html` and `{prefix}script/scene1.js` (and initialized `{prefix}microstock/manifest.json`).\n\
                             CRITICAL RULE (MOVE, DO NOT RECREATE):\n\
                             - DO NOT overwrite or recreate `{prefix}index.html` or `{prefix}script/scene1.js` from scratch, and DO NOT spawn `motion-designer` to rewrite them! The original SVG/Canvas stage and rocket/particle animations are already in place.\n\
                             - Simply call `capture_film_preview` once to verify the extracted stage renders cleanly, optionally refine `{prefix}microstock/manifest.json` keywords if needed, and report completion to the user.\n\
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
                            "[Attached Standalone HTML/SVG Source File: '{}'{}]\n\
                             TARGET OUTPUT LOCATION: Write the cleaned stage directly to `{prefix}index.html` and `{prefix}script/scene1.js` (and `{prefix}microstock/manifest.json` when Microstock Mode 'M' is active).\n\
                             STRICT ISOLATION RULE: Use ONLY this attached source code below. Do NOT read or inspect unrelated files in workspace root, `ref/`, or other `projects/*` folders, and do NOT call `glob` or `explore` to search for other projects. Preserve all original vector `<svg>` artwork, gradients, filters, and characters verbatim while stripping UI control panels/buttons/sliders and converting animations into deterministic `window.renderAt(t)`.\n\
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
                    }
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
                    let cand_lower = candidate
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&lower_name)
                        .to_ascii_lowercase();
                    if is_video_file_name(&cand_lower) || mime.to_ascii_lowercase().starts_with("video/") {
                        let ref_dir = resolve_workspace_ref_dir(workspace_dir);
                        let clean_name = file_name
                            .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_', "_");
                        let rel_path = candidate
                            .strip_prefix(Path::new(workspace_dir))
                            .map(|p| p.to_string_lossy().replace('\\', "/"))
                            .unwrap_or_else(|_| uri.to_string());
                        let ref_wav = ref_dir.join("ref_voice.wav");
                        super::social_links::extract_audio_track_ffmpeg(
                            ffmpeg_bin,
                            &candidate,
                            &ref_wav,
                        );
                        saved_videos.push(SavedVideoAttachment {
                            rel_path: rel_path.clone(),
                            disk_path: candidate.clone(),
                            file_name: file_name.to_string(),
                            prefix: clean_name,
                        });
                        ocr_transcriptions.push(format!(
                            "[Attached Reference Video Asset: '{}' at {} — queued for MotionClone blueprint extraction]",
                            file_name, rel_path
                        ));
                    } else {
                        ocr_transcriptions.push(format!(
                            "[Attached Media Asset: {} at {}]",
                            file_name,
                            candidate.display()
                        ));
                    }
                }
            }
        }
    }

    (ocr_transcriptions, image_urls, saved_videos)
}

/// Sync attachment ingestion (used in unit tests / synchronous contexts).
pub fn process_attached_files(
    workspace_dir: &str,
    files: Option<&Value>,
    ffmpeg_bin: Option<&Path>,
) -> (Vec<String>, Vec<String>) {
    let (transcriptions, image_urls, _) =
        process_attached_files_inner(workspace_dir, files, ffmpeg_bin, false);
    (transcriptions, image_urls)
}

async fn extract_attached_video_blueprint(
    workspace_dir: &str,
    video_rel_path: &str,
    image_urls: &mut Vec<String>,
) -> Option<String> {
    let ext_res = crate::tool::ref_extractor::execute_ref_extractor(
        workspace_dir,
        &serde_json::json!({
            "videoPath": video_rel_path,
            "outputDir": "ref/extracted"
        }),
    )
    .await;

    if ext_res.get("error").is_some() {
        return None;
    }

    if let Some(imgs) = ext_res.get("_vision_images").and_then(|v| v.as_array()) {
        for item in imgs {
            if let Some(url) = item.as_str() {
                if !url.is_empty() && !image_urls.iter().any(|existing| existing == url) {
                    image_urls.push(url.to_string());
                }
            }
        }
    }

    let report_path = ext_res
        .get("reportPath")
        .and_then(|v| v.as_str())
        .unwrap_or("ref/extracted/ref_report.md");
    Some(report_path.to_string())
}

/// Async attachment ingestion that also runs MotionClone `ref_extractor` on local video attachments
/// so `ref/extracted/style.json`, `ref_report.md`, and temporal keyframes exist on turn 1.
pub async fn process_attached_files_and_blueprints(
    workspace_dir: &str,
    files: Option<&Value>,
    ffmpeg_bin: Option<&Path>,
) -> (Vec<String>, Vec<String>) {
    let (mut transcriptions, mut image_urls, saved_videos) =
        process_attached_files_inner(workspace_dir, files, ffmpeg_bin, true);

    for vid in saved_videos {
        let mut blueprint_imgs = Vec::new();
        let report_opt = extract_attached_video_blueprint(
            workspace_dir,
            &vid.rel_path,
            &mut blueprint_imgs,
        )
        .await;

        if blueprint_imgs.is_empty() {
            let ref_dir = resolve_workspace_ref_dir(workspace_dir);
            let (probed_dur, _) =
                super::social_links::probe_video_meta_async(ffmpeg_bin, &vid.disk_path).await;
            let sheet_path = ref_dir.join(format!("ref_{}_sheet.jpg", vid.prefix));
            if let Some(sheet_url) = super::social_links::extract_compact_contact_sheet_ffmpeg(
                ffmpeg_bin,
                &vid.disk_path,
                &sheet_path,
                probed_dur,
            )
            .await
            {
                blueprint_imgs.push(sheet_url);
            } else {
                super::social_links::extract_sample_frames_ffmpeg(
                    ffmpeg_bin,
                    &ref_dir,
                    &vid.disk_path,
                    &vid.prefix,
                    probed_dur,
                    &mut blueprint_imgs,
                );
            }
        }

        for img in blueprint_imgs {
            if !image_urls.iter().any(|existing| existing == &img) {
                image_urls.push(img);
            }
        }

        if let Some(report_rel) = report_opt {
            transcriptions.push(format!(
                "[Local Video MotionClone Blueprint Extracted for '{}': source=`{}`, report=`{}`, style=`ref/extracted/style.json`, temporal=`ref/extracted/temporal.json`. Temporal keyframes have been attached for scene-by-scene replication.]",
                vid.file_name, vid.rel_path, report_rel
            ));
        }
    }

    (transcriptions, image_urls)
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

/// Removes `_vision_images` (and optional `_vision_image_labels`) from a tool result before
/// serialization and appends `(data_url, optional_label)` pairs, emitting a text-only notice if needed.
pub(crate) fn extract_tool_vision_images_labeled_with_notice(
    tool_out: &mut Value,
    collected: &mut Vec<(String, Option<String>)>,
    model_supports_vision: bool,
) {
    let labels: Vec<Option<String>> = tool_out
        .as_object_mut()
        .and_then(|obj| obj.remove("_vision_image_labels"))
        .and_then(|v| match v {
            Value::Array(arr) => Some(
                arr.into_iter()
                    .map(|item| {
                        item.as_str()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                    })
                    .collect(),
            ),
            _ => None,
        })
        .unwrap_or_default();

    let mut urls = Vec::new();
    extract_tool_vision_images(tool_out, &mut urls);
    let omitted = urls.len();
    for (idx, url) in urls.into_iter().enumerate() {
        let label = labels.get(idx).cloned().flatten();
        collected.push((url, label));
    }
    if omitted > 0 && !model_supports_vision {
        if let Some(obj) = tool_out.as_object_mut() {
            obj.insert("visionOmittedCount".to_string(), serde_json::json!(omitted));
            obj.insert(
                "visionNotice".to_string(),
                serde_json::json!(format!(
                    "Active model is text-only: {omitted} image frame(s) were omitted from the vision stream. Rely strictly on structured numeric metrics (overallFidelity, ssimMean, colorMatchMean, edgeMatchMean, worstFrames, style.json, ref_report.md) and disclose transparently if direct visual inspection was incomplete."
                )),
            );
        }
    }
}

/// Variant of `extract_tool_vision_images` that leaves an explicit non-silent diagnostic
/// inside the serialized tool output when a text-only model strips visual frames.
#[allow(dead_code)] // Retained for backward-compatible unit tests while runtime uses labeled extractor.
pub(crate) fn extract_tool_vision_images_with_notice(
    tool_out: &mut Value,
    collected: &mut Vec<String>,
    model_supports_vision: bool,
) {
    let mut labeled = Vec::new();
    extract_tool_vision_images_labeled_with_notice(tool_out, &mut labeled, model_supports_vision);
    collected.extend(labeled.into_iter().map(|(u, _)| u));
}

/// Appends a multimodal user inspection message containing labeled images returned by tools
/// only when `model_supports_vision` is true.
pub(crate) fn append_labeled_tool_vision_message(
    chat_messages: &mut Vec<Value>,
    model_supports_vision: bool,
    items: Vec<(String, Option<String>)>,
) {
    if !model_supports_vision || items.is_empty() {
        return;
    }
    let has_labels = items.iter().any(|(_, lbl)| lbl.is_some());
    let header = if has_labels {
        let manifest: Vec<String> = items
            .iter()
            .enumerate()
            .map(|(i, (_, lbl))| format!("{}. {}", i + 1, lbl.as_deref().unwrap_or("image")))
            .collect();
        format!(
            "[Tool visual output attached below in exact order:\n{}\n]",
            manifest.join("\n")
        )
    } else {
        "[Tool visual output attached below.]".to_string()
    };
    let mut parts = vec![serde_json::json!({
        "type": "text",
        "text": header
    })];
    for (url, _) in items {
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

/// Appends a multimodal user inspection message containing images returned by tools (e.g. `capture_film_preview`)
/// only when `model_supports_vision` is true.
#[allow(dead_code)] // Retained for unit tests while runtime uses `append_labeled_tool_vision_message`.
pub(crate) fn append_tool_vision_message(
    chat_messages: &mut Vec<Value>,
    model_supports_vision: bool,
    images: Vec<String>,
) {
    append_labeled_tool_vision_message(
        chat_messages,
        model_supports_vision,
        images.into_iter().map(|u| (u, None)).collect(),
    );
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

    #[tokio::test]
    async fn process_attached_files_and_blueprints_extracts_blueprint_for_mp4_attachment() {
        let Some(ff) = find_ffmpeg_bin() else {
            return;
        };
        let ws = std::env::temp_dir().join(format!(
            "aetheria_vision_vid_bp_{}",
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&ws).unwrap();
        let sample_mp4 = ws.join("sample_src.mp4");
        let status = std::process::Command::new(&ff)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=#141824:s=320x568:d=1.5",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&sample_mp4)
            .output()
            .unwrap();
        assert!(status.status.success(), "ffmpeg should synthesize sample mp4");
        let mp4_bytes = std::fs::read(&sample_mp4).unwrap();
        let files_val = serde_json::json!([{
            "name": "local_clip.mp4",
            "uri": format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(&mp4_bytes)),
            "mime": "video/mp4"
        }]);

        let (transcriptions, images) =
            process_attached_files_and_blueprints(&ws.to_string_lossy(), Some(&files_val), Some(&ff))
                .await;

        assert!(!images.is_empty(), "blueprint frames should attach to vision images");
        assert!(
            transcriptions
                .iter()
                .any(|t| t.contains("Local Video MotionClone Blueprint Extracted")),
            "transcriptions={:?}",
            transcriptions
        );
        assert!(ws.join("ref/ref_local_clip.mp4").is_file());
        assert!(ws.join("ref/extracted/style.json").is_file());
        assert!(ws.join("ref/extracted/ref_report.md").is_file());

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn extract_tool_vision_images_with_notice_warns_text_only_models() {
        let mut out_text_only = serde_json::json!({
            "ok": true,
            "_vision_images": ["data:image/jpeg;base64,AAAA"]
        });
        let mut collected = Vec::new();
        extract_tool_vision_images_with_notice(&mut out_text_only, &mut collected, false);
        assert_eq!(out_text_only["visionOmittedCount"], 1);
        assert!(out_text_only["visionNotice"]
            .as_str()
            .unwrap()
            .contains("text-only"));
        assert_eq!(collected.len(), 1);

        let mut out_vision = serde_json::json!({
            "ok": true,
            "_vision_images": ["data:image/jpeg;base64,BBBB"]
        });
        let mut collected2 = Vec::new();
        extract_tool_vision_images_with_notice(&mut out_vision, &mut collected2, true);
        assert!(out_vision.get("visionOmittedCount").is_none());
        assert!(out_vision.get("visionNotice").is_none());
    }

    #[test]
    fn extracts_and_attaches_labeled_tool_vision_images() {
        let mut tool_out = serde_json::json!({
            "ok": true,
            "_vision_images": [
                "data:image/jpeg;base64,AAAA",
                "data:image/jpeg;base64,BBBB"
            ],
            "_vision_image_labels": [
                "ref/extracted/frames/ref_scene_01.jpg (Scene 1 init @ 0.75s)",
                "preview_0.jpg @ t=0.73s"
            ]
        });
        let mut collected = Vec::new();
        extract_tool_vision_images_labeled_with_notice(&mut tool_out, &mut collected, true);
        assert!(tool_out.get("_vision_images").is_none());
        assert!(tool_out.get("_vision_image_labels").is_none());
        assert_eq!(collected.len(), 2);

        let mut msgs = Vec::new();
        append_labeled_tool_vision_message(&mut msgs, true, collected);
        assert_eq!(msgs.len(), 1);
        let header = msgs[0].pointer("/content/0/text").and_then(|v| v.as_str()).unwrap();
        assert!(header.contains("1. ref/extracted/frames/ref_scene_01.jpg (Scene 1 init @ 0.75s)"));
        assert!(header.contains("2. preview_0.jpg @ t=0.73s"));
        assert_eq!(
            msgs[0].pointer("/content/1/image_url/url").and_then(|v| v.as_str()),
            Some("data:image/jpeg;base64,AAAA")
        );
    }
}

