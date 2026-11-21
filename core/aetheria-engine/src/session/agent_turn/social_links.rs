//! Social Video Reference Link Extraction (TikTok & YouTube).
//!
//! Fetches reference video metadata, downloads TikTok reference audio/keyframes via FFmpeg,
//! and attaches YouTube thumbnail frames to vision context.

use base64::prelude::*;
use serde_json::Value;
use std::path::Path;

fn extract_meta_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let double = format!("{}=\"", attr);
    if let Some(start) = tag.find(&double) {
        let rest = &tag[start + double.len()..];
        if let Some(end) = rest.find('"') {
            return Some(&rest[..end]);
        }
    }
    let single = format!("{}='", attr);
    if let Some(start) = tag.find(&single) {
        let rest = &tag[start + single.len()..];
        if let Some(end) = rest.find('\'') {
            return Some(&rest[..end]);
        }
    }
    None
}

fn unescape_html_basic(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

fn collect_urls_with_ext(html: &str, prefixes: &[&str], exts: &[&str]) -> Vec<String> {
    let mut found = Vec::new();
    for &prefix in prefixes {
        let mut pos = 0;
        while let Some(rel) = html[pos..].find(prefix) {
            let start = pos + rel;
            let tail = &html[start..];
            let end = tail
                .find(|c: char| {
                    matches!(c, '"' | '\'' | '<' | '>' | '\\' | ')' | ' ' | '\n' | '\r')
                })
                .unwrap_or(tail.len());
            let candidate = &tail[..end];
            let clean = candidate
                .split(&['?', '#'][..])
                .next()
                .unwrap_or(candidate)
                .to_ascii_lowercase();
            if exts.iter().any(|ext| clean.ends_with(ext)) {
                found.push(candidate.to_string());
            }
            pos = start + prefix.len();
        }
    }
    found
}

fn find_first_url_with_ext(html: &str, prefixes: &[&str], exts: &[&str]) -> Option<String> {
    collect_urls_with_ext(html, prefixes, exts)
        .into_iter()
        .next()
}

pub(crate) fn select_best_pinterest_mp4_url(html: &str) -> Option<String> {
    let candidates =
        collect_urls_with_ext(html, &["https://v1.pinimg.com/", "https://v.pinimg.com/"], &[".mp4"]);
    let mut best: Option<(i32, String)> = None;

    for url in candidates {
        let clean = url
            .split(&['?', '#'][..])
            .next()
            .unwrap_or(&url)
            .to_ascii_lowercase();

        let mut score: i32 = 0;
        if !clean.contains("hevc") && !clean.contains("h265") {
            score += 1000;
        }
        if clean.contains("/expmp4/") || clean.contains("/720p/") || clean.contains("/1080p/") {
            score += 100;
        }
        if clean.contains("1080") {
            score += 500;
        } else if clean.contains("720") {
            score += 400;
        } else if clean.contains("540") {
            score += 300;
        } else if clean.contains("480") {
            score += 250;
        } else if clean.contains("360") {
            score += 200;
        } else if clean.contains("240") {
            score += 100;
        }
        if !clean.ends_with("_t1.mp4") && !clean.ends_with("_t2.mp4") {
            score += 20;
        }

        if best.as_ref().is_none_or(|(best_score, _)| score > *best_score) {
            best = Some((score, url));
        }
    }

    best.map(|(_, url)| url)
}

pub(crate) fn extract_pinterest_media_from_html(
    html: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let mut title: Option<String> = None;
    let mut image_url: Option<String> = None;
    let mut mp4_url: Option<String> = None;

    let mut pos = 0;
    while let Some(rel_start) = html[pos..].find("<meta") {
        let tag_start = pos + rel_start;
        let Some(rel_end) = html[tag_start..].find('>') else {
            break;
        };
        let tag = &html[tag_start..=tag_start + rel_end];
        let prop = extract_meta_attr(tag, "property")
            .or_else(|| extract_meta_attr(tag, "name"))
            .unwrap_or("");
        let content = extract_meta_attr(tag, "content").map(unescape_html_basic);
        if let Some(val) = content.filter(|v| !v.is_empty()) {
            if prop.eq_ignore_ascii_case("og:title") && title.is_none() {
                title = Some(val);
            } else if matches!(prop, "og:image" | "twitter:image:src" | "twitter:image")
                && image_url.is_none()
                && val.starts_with("http")
            {
                image_url = Some(val);
            } else if prop.eq_ignore_ascii_case("og:video")
                && val.ends_with(".mp4")
                && mp4_url.is_none()
            {
                mp4_url = Some(val);
            }
        }
        pos = tag_start + rel_end + 1;
    }

    if image_url.is_none() {
        image_url = find_first_url_with_ext(
            html,
            &[
                "https://i.pinimg.com/originals/",
                "https://i.pinimg.com/736x/",
                "https://i.pinimg.com/564x/",
            ],
            &[".jpg", ".jpeg", ".png", ".webp"],
        );
    }

    if mp4_url.is_none() {
        mp4_url = select_best_pinterest_mp4_url(html);
    }

    (title, image_url, mp4_url)
}

pub(crate) fn persist_reference_frames_to_dir(
    ref_dir: &Path,
    prefix: &str,
    primary_bytes: Option<(&[u8], &str)>,
    extracted_jpg_frames: &[Vec<u8>],
) -> Vec<String> {
    let _ = std::fs::create_dir_all(ref_dir);
    let mut saved_files = Vec::new();

    if let Some((bytes, ext)) = primary_bytes {
        if !bytes.is_empty() {
            let main_rel = format!("ref/ref_{}.{}", prefix, ext);
            let main_path = ref_dir.join(format!("ref_{}.{}", prefix, ext));
            if std::fs::write(&main_path, bytes).is_ok() {
                saved_files.push(main_rel);
            }
        }
    }

    if !extracted_jpg_frames.is_empty() {
        for (idx, frame_bytes) in extracted_jpg_frames.iter().enumerate() {
            if frame_bytes.is_empty() {
                continue;
            }
            let frame_name = format!("ref_{}_frame_{}.jpg", prefix, idx + 1);
            let frame_path = ref_dir.join(&frame_name);
            if std::fs::write(&frame_path, frame_bytes).is_ok() {
                saved_files.push(format!("ref/{}", frame_name));
            }
        }
    } else if let Some((bytes, ext)) = primary_bytes {
        if !bytes.is_empty() {
            for idx in 1..=2 {
                let frame_name = format!("ref_{}_frame_{}.{}", prefix, idx, ext);
                let frame_path = ref_dir.join(&frame_name);
                if std::fs::write(&frame_path, bytes).is_ok() {
                    saved_files.push(format!("ref/{}", frame_name));
                }
            }
        }
    }

    saved_files
}

pub const RELATIVE_REFERENCE_POSITIONS: [f64; 4] = [0.10, 0.35, 0.60, 0.85];

pub(crate) fn compute_relative_sample_timestamps(duration_secs: f64) -> Vec<(f64, String)> {
    let safe_dur = if duration_secs.is_finite() && duration_secs > 0.5 {
        duration_secs
    } else {
        8.0
    };
    let max_t = (safe_dur - 0.05).max(0.1);
    RELATIVE_REFERENCE_POSITIONS
        .iter()
        .map(|ratio| {
            let t = ((safe_dur * ratio).min(max_t) * 100.0).round() / 100.0;
            let mins = (t as u64) / 60;
            let secs = t - (mins as f64 * 60.0);
            (*ratio, format!("00:{:02}:{:05.2}", mins, secs))
        })
        .collect()
}

fn is_pinterest_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http")
        && (lower.contains("://pin.it/")
            || (lower.contains("pinterest.") && lower.contains("/pin/")))
}

pub(crate) fn extract_audio_track_ffmpeg(
    ffmpeg_bin: Option<&Path>,
    mp4_path: &Path,
    wav_path: &Path,
) {
    let Some(ff_cmd) = ffmpeg_bin else {
        return;
    };
    let mut ff_audio = std::process::Command::new(ff_cmd);
    crate::paths::configure_hidden_std_command(&mut ff_audio);
    let _ = ff_audio
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            &mp4_path.to_string_lossy(),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "24000",
            "-ac",
            "1",
            &wav_path.to_string_lossy(),
        ])
        .output();
}

pub(crate) fn extract_sample_frames_ffmpeg(
    ffmpeg_bin: Option<&Path>,
    ref_dir: &Path,
    mp4_path: &Path,
    prefix: &str,
    duration_secs: f64,
    image_urls: &mut Vec<String>,
) -> Vec<Vec<u8>> {
    let mut extracted = Vec::new();
    let Some(ff_cmd) = ffmpeg_bin else {
        return extracted;
    };
    let sample_points = compute_relative_sample_timestamps(duration_secs);
    for (idx, (_ratio, ts)) in sample_points.iter().enumerate() {
        let frame_name = format!("ref_{}_frame_{}.jpg", prefix, idx + 1);
        let frame_jpg = ref_dir.join(&frame_name);
        let mut ff_frame = std::process::Command::new(ff_cmd);
        crate::paths::configure_hidden_std_command(&mut ff_frame);
        let ok = ff_frame
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                ts.as_str(),
                "-i",
                &mp4_path.to_string_lossy(),
                "-frames:v",
                "1",
                "-q:v",
                "4",
                &frame_jpg.to_string_lossy(),
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            if let Ok(jpg_bytes) = std::fs::read(&frame_jpg) {
                if !jpg_bytes.is_empty() {
                    let b64 = BASE64_STANDARD.encode(&jpg_bytes);
                    image_urls.push(format!("data:image/jpeg;base64,{}", b64));
                    extracted.push(jpg_bytes);
                }
            }
        }
    }
    extracted
}

pub(crate) async fn extract_compact_contact_sheet_ffmpeg(
    ffmpeg_bin: Option<&Path>,
    mp4_path: &Path,
    sheet_path: &Path,
    duration_secs: f64,
) -> Option<String> {
    let ff_cmd = ffmpeg_bin?;
    let safe_dur = if duration_secs.is_finite() && duration_secs > 0.4 {
        duration_secs
    } else {
        8.0
    };
    let sample_fps = (16.0 / safe_dur).clamp(0.25, 16.0);
    let vf = format!("fps={:.4},scale=360:-2,tile=4x4", sample_fps);

    let mut cmd = tokio::process::Command::new(ff_cmd);
    crate::paths::configure_hidden_tokio_command(&mut cmd);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(mp4_path)
        .args(["-vf", &vf, "-frames:v", "1", "-q:v", "3"])
        .arg(sheet_path);

    let ok = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
        .await
        .ok()
        .and_then(Result::ok)
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ok {
        return None;
    }
    let bytes = tokio::fs::read(sheet_path).await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:image/jpeg;base64,{}", BASE64_STANDARD.encode(&bytes)))
}

pub(crate) async fn probe_video_meta_async(
    ffmpeg_bin: Option<&Path>,
    mp4_path: &Path,
) -> (f64, Option<(u32, u32)>) {
    let Some(ff) = ffmpeg_bin.map(Path::to_path_buf) else {
        return (10.0, None);
    };
    let mp4 = mp4_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let dur = crate::studio::reference_compare::probe_video_duration_secs(&ff, &mp4)
            .unwrap_or(10.0);
        let dims = crate::tool::ref_extractor::probe_video_dimensions_sync(&ff, &mp4);
        (dur, dims)
    })
    .await
    .unwrap_or((10.0, None))
}

/// Automatically extracts lightweight storyboard previews if prompt contains TikTok, YouTube, or Pinterest links.
/// Heavy full-video `ref_extractor.py` stays on-demand via `extract_video_reference` to keep first-turn latency ~1-2s.
pub async fn process_social_links(
    workspace_dir: &str,
    prompt_text: &str,
    ffmpeg_bin: Option<&Path>,
) -> (Vec<String>, Vec<String>) {
    let mut ocr_transcriptions = Vec::new();
    let mut image_urls = Vec::new();

    for word in prompt_text.split_whitespace() {
        let clean_url = word.trim_matches(|c: char| c == '(' || c == ')' || c == '<' || c == '>' || c == '"' || c == '\'');
        if clean_url.contains("tiktok.com/") {
            if let Ok(resp) = reqwest::Client::new()
                .get("https://www.tikwm.com/api/")
                .query(&[("url", clean_url)])
                .send()
                .await
            {
                if let Ok(json_val) = resp.json::<Value>().await {
                    let data = json_val.get("data").cloned().unwrap_or(Value::Null);
                    let title = data.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let duration = data.get("duration").and_then(|v| v.as_u64()).unwrap_or(30);
                    let author = data
                        .get("author")
                        .and_then(|a| a.get("unique_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("creator");
                    let play_url = data.get("play").and_then(|v| v.as_str()).unwrap_or("");

                    let ref_dir = crate::tool::path_guard::resolve_isolated_path(workspace_dir, "ref")
                        .unwrap_or_else(|_| Path::new(workspace_dir).join("ref"));
                    let _ = std::fs::create_dir_all(&ref_dir);
                    let mp4_path = ref_dir.join("ref_tiktok.mp4");
                    let sheet_path = ref_dir.join("ref_tiktok_contact_sheet.jpg");

                    let mut has_mp4 = false;
                    let mut has_sheet = false;
                    let mut probed_dims = None;
                    let mut probed_dur = duration as f64;
                    if !play_url.is_empty() {
                        if let Ok(vid_resp) = reqwest::get(play_url).await {
                            if let Ok(vid_bytes) = vid_resp.bytes().await {
                                if !vid_bytes.is_empty() && std::fs::write(&mp4_path, &vid_bytes).is_ok() {
                                    has_mp4 = true;
                                    let (d, dims) = probe_video_meta_async(ffmpeg_bin, &mp4_path).await;
                                    if d > 0.4 {
                                        probed_dur = d;
                                    }
                                    probed_dims = dims;
                                    if let Some(sheet_url) = extract_compact_contact_sheet_ffmpeg(
                                        ffmpeg_bin,
                                        &mp4_path,
                                        &sheet_path,
                                        probed_dur,
                                    )
                                    .await
                                    {
                                        image_urls.push(sheet_url);
                                        has_sheet = true;
                                    } else {
                                        extract_sample_frames_ffmpeg(
                                            ffmpeg_bin,
                                            &ref_dir,
                                            &mp4_path,
                                            "tiktok",
                                            probed_dur,
                                            &mut image_urls,
                                        );
                                    }
                                }
                            }
                        }
                    }

                    let dims_str = probed_dims
                        .map(|(w, h)| format!("{w}x{h}"))
                        .unwrap_or_else(|| "unknown".to_string());
                    let preview_note = if has_sheet {
                        "4x4 storyboard contact sheet attached: ref/ref_tiktok_contact_sheet.jpg."
                    } else if has_mp4 {
                        "Sample frames extracted to ref/."
                    } else {
                        "Reference metadata only (video stream unavailable)."
                    };
                    ocr_transcriptions.push(format!(
                        "[TikTok Reference Video Ready (@{}, {}, {:.1}s, title: \"{}\"): saved at ref/ref_tiktok.mp4. {} Inspect full-res frames via `inspect_ref_frame`, `extract_video_reference`, or `read`/`bash` (Python/OpenCV/FFmpeg); reconstruct visually in HTML/CSS/SVG/Canvas/WebGL without pasting ref media onto the stage.]",
                        author, dims_str, probed_dur, title, preview_note
                    ));
                }
            }
            continue;
        }

        let yt_id = if let Some(idx) = clean_url.find("youtube.com/watch?v=") {
            clean_url[idx + 20..].split(&['&', '#', '?'][..]).next()
        } else if let Some(idx) = clean_url.find("youtu.be/") {
            clean_url[idx + 9..].split(&['&', '#', '?'][..]).next()
        } else if let Some(idx) = clean_url.find("youtube.com/shorts/") {
            clean_url[idx + 19..].split(&['&', '#', '?'][..]).next()
        } else {
            None
        };
        if let Some(vid_id) = yt_id.filter(|id| id.len() >= 8) {
            let ref_dir = crate::tool::path_guard::resolve_isolated_path(workspace_dir, "ref")
                .unwrap_or_else(|_| Path::new(workspace_dir).join("ref"));
            let _ = std::fs::create_dir_all(&ref_dir);
            let yt_mp4 = ref_dir.join("ref_youtube.mp4");
            let sheet_path = ref_dir.join("ref_youtube_contact_sheet.jpg");
            let ytdlp_note: String;

            if let Some(ytdlp_bin) = crate::paths::locate_ytdlp_binary() {
                let mut dl = tokio::process::Command::new(&ytdlp_bin);
                crate::paths::configure_hidden_tokio_command(&mut dl);
                dl.args([
                    "--no-playlist",
                    "--max-filesize",
                    "120M",
                    "-f",
                    "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
                    "--merge-output-format",
                    "mp4",
                    "-o",
                ])
                .arg(&yt_mp4)
                .arg(clean_url);
                if let Some(ff) = ffmpeg_bin.and_then(|p| p.parent()) {
                    dl.arg("--ffmpeg-location").arg(ff);
                }
                match tokio::time::timeout(std::time::Duration::from_secs(90), dl.output()).await {
                    Ok(Ok(out)) if out.status.success() && yt_mp4.is_file() => {
                        let (dur, dims) = probe_video_meta_async(ffmpeg_bin, &yt_mp4).await;
                        let mut sheet_line = String::new();
                        if let Some(sheet_url) = extract_compact_contact_sheet_ffmpeg(
                            ffmpeg_bin,
                            &yt_mp4,
                            &sheet_path,
                            dur,
                        )
                        .await
                        {
                            image_urls.push(sheet_url);
                            sheet_line = "\n- 4x4 Storyboard Contact Sheet: ref/ref_youtube_contact_sheet.jpg".to_string();
                        } else {
                            extract_sample_frames_ffmpeg(
                                ffmpeg_bin,
                                &ref_dir,
                                &yt_mp4,
                                "youtube",
                                dur,
                                &mut image_urls,
                            );
                        }
                        let dims_str = dims
                            .map(|(w, h)| format!(" ({w}x{h}, {dur:.1}s)"))
                            .unwrap_or_else(|| format!(" ({dur:.1}s)"));
                        ocr_transcriptions.push(format!(
                            "[YouTube Reference Video Extracted (ID: {}{}:\n\
                             - Reference Video Downloaded via yt-dlp: ref/ref_youtube.mp4{}\n\
                             - Inspect full-res frames via `inspect_ref_frame`, `extract_video_reference`, or `read`/`bash` (Python/OpenCV/FFmpeg).]",
                            vid_id, dims_str, sheet_line
                        ));
                        continue;
                    }
                    Ok(Ok(out)) => {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        ytdlp_note = format!(
                            "yt-dlp failed ({}); ",
                            stderr.trim().chars().take(120).collect::<String>()
                        );
                    }
                    Ok(Err(e)) => {
                        ytdlp_note = format!("yt-dlp launch failed ({e}); ");
                    }
                    Err(_) => {
                        ytdlp_note = "yt-dlp timed out after 90s; ".to_string();
                    }
                }
            } else {
                ytdlp_note = "yt-dlp binary is not installed; ".to_string();
            }

            let thumb_url = format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", vid_id);
            if let Ok(resp) = reqwest::get(&thumb_url).await {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        let thumb_path = ref_dir.join("ref_youtube_thumb.jpg");
                        let _ = std::fs::write(&thumb_path, &bytes);
                        let b64 = BASE64_STANDARD.encode(&bytes);
                        image_urls.push(format!("data:image/jpeg;base64,{}", b64));
                        ocr_transcriptions.push(format!(
                            "[Reference Video Link Detected (YouTube ID: {}): Thumbnail fallback ONLY — {}only a single thumbnail (`hqdefault.jpg` saved at `ref/ref_youtube_thumb.jpg`) was attached. Full scene cuts, exact timing/BPM, motion curves, and multi-scene layout were NOT extracted. Match thumbnail mood/palette honestly without fabricating unverified scene timings unless the user uploads the MP4 directly or installs `yt-dlp`.]",
                            vid_id, ytdlp_note
                        ));
                    }
                }
            }
            continue;
        }

        if is_pinterest_url(clean_url) {
            if let Ok(client) = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")
                .timeout(std::time::Duration::from_secs(30))
                .build()
            {
                if let Ok(resp) = client.get(clean_url).send().await {
                    if let Ok(html) = resp.text().await {
                        let (pin_title, img_url_opt, mp4_url_opt) =
                            extract_pinterest_media_from_html(&html);
                        let ref_dir = crate::tool::path_guard::resolve_isolated_path(workspace_dir, "ref")
                            .unwrap_or_else(|_| Path::new(workspace_dir).join("ref"));
                        let _ = std::fs::create_dir_all(&ref_dir);
                        let mut primary_img: Option<(Vec<u8>, String, String)> = None;
                        let mut extracted_video_frames: Vec<Vec<u8>> = Vec::new();
                        let mut has_mp4 = false;
                        let mut has_sheet = false;
                        let mut probed_dur = 10.0;
                        let mut probed_dims = None;

                        if let Some(ref img_url) = img_url_opt {
                            if let Ok(img_resp) = client.get(img_url).send().await {
                                let mime = img_resp
                                    .headers()
                                    .get(reqwest::header::CONTENT_TYPE)
                                    .and_then(|v| v.to_str().ok())
                                    .and_then(|s| s.split(';').next())
                                    .map(|s| s.trim().to_ascii_lowercase())
                                    .filter(|m| m.starts_with("image/"))
                                    .unwrap_or_else(|| "image/jpeg".to_string());
                                let ext = match mime.as_str() {
                                    "image/png" => "png",
                                    "image/webp" => "webp",
                                    _ => "jpg",
                                };
                                if let Ok(bytes) = img_resp.bytes().await {
                                    if !bytes.is_empty() {
                                        primary_img = Some((bytes.to_vec(), ext.to_string(), mime));
                                    }
                                }
                            }
                        }

                        if let Some(ref mp4_url) = mp4_url_opt {
                            if let Ok(vid_resp) = client.get(mp4_url).send().await {
                                if let Ok(vbytes) = vid_resp.bytes().await {
                                    if !vbytes.is_empty() {
                                        let mp4_path = ref_dir.join("ref_pinterest.mp4");
                                        if std::fs::write(&mp4_path, &vbytes).is_ok() {
                                            has_mp4 = true;
                                            let (dur, dims) = probe_video_meta_async(ffmpeg_bin, &mp4_path).await;
                                            probed_dur = dur;
                                            probed_dims = dims;
                                            let sheet_path = ref_dir.join("ref_pinterest_contact_sheet.jpg");
                                            if let Some(sheet_url) = extract_compact_contact_sheet_ffmpeg(
                                                ffmpeg_bin,
                                                &mp4_path,
                                                &sheet_path,
                                                probed_dur,
                                            )
                                            .await
                                            {
                                                image_urls.push(sheet_url);
                                                has_sheet = true;
                                            } else {
                                                extracted_video_frames = extract_sample_frames_ffmpeg(
                                                    ffmpeg_bin,
                                                    &ref_dir,
                                                    &mp4_path,
                                                    "pinterest",
                                                    probed_dur,
                                                    &mut image_urls,
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Attach og:image only if no video storyboard/frames were extracted (1 compact image instead of 17).
                        if image_urls.is_empty() {
                            if let Some((ref bytes, _, ref mime)) = primary_img {
                                image_urls.push(format!(
                                    "data:{};base64,{}",
                                    mime,
                                    BASE64_STANDARD.encode(bytes)
                                ));
                            }
                        }

                        let mut saved_files = if has_sheet {
                            let mut list = vec![
                                "ref/ref_pinterest.mp4".to_string(),
                                "ref/ref_pinterest_contact_sheet.jpg".to_string(),
                            ];
                            if let Some((ref bytes, ref ext, _)) = primary_img {
                                let cover_rel = format!("ref/ref_pinterest.{}", ext);
                                if std::fs::write(ref_dir.join(format!("ref_pinterest.{}", ext)), bytes).is_ok() {
                                    list.push(cover_rel);
                                }
                            }
                            list
                        } else {
                            let mut list = persist_reference_frames_to_dir(
                                &ref_dir,
                                "pinterest",
                                primary_img
                                    .as_ref()
                                    .map(|(bytes, ext, _)| (bytes.as_slice(), ext.as_str())),
                                &extracted_video_frames,
                            );
                            if has_mp4 {
                                list.push("ref/ref_pinterest.mp4".to_string());
                            }
                            list
                        };
                        let _ = &mut saved_files;

                        if !saved_files.is_empty() || pin_title.is_some() {
                            let title_str = pin_title.as_deref().unwrap_or("Pinterest Pin");
                            if has_mp4 {
                                let dims_str = probed_dims
                                    .map(|(w, h)| format!("{w}x{h}, "))
                                    .unwrap_or_default();
                                ocr_transcriptions.push(format!(
                                    "[Pinterest Reference Video Ready (title: \"{}\", {}{:.1}s, saved: [{}]): 4x4 storyboard contact sheet attached to vision context. Inspect full-res frames via `inspect_ref_frame`, `extract_video_reference`, or `read`/`bash` (Python/OpenCV/FFmpeg); reconstruct visually in HTML/CSS/SVG/Canvas/WebGL without pasting ref files onto the stage.]",
                                    title_str,
                                    dims_str,
                                    probed_dur,
                                    saved_files.join(", ")
                                ));
                            } else {
                                ocr_transcriptions.push(format!(
                                    "[Pinterest Reference Image Ready (title: \"{}\", saved: [{}]): Image attached directly to vision context — reconstruct its palette, typography, and layout procedurally without drawing the ref file directly.]",
                                    title_str,
                                    saved_files.join(", ")
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    (ocr_transcriptions, image_urls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_pinterest_og_tags_and_fallback_video() {
        let html = r#"
            <html><head>
            <meta content="Night Motion [Video] | Landscape" name="og:title" property="og:title"/>
            <meta content="https://i.pinimg.com/736x/76/ed/af/76edaf00529634c5287f884a8b4ef38d.jpg" name="og:image" property="og:image"/>
            <script>var u = "https://v1.pinimg.com/videos/mc/720p/27/93/99/2793999fd5ea5a998899b956594bf2bd.mp4";</script>
            </head></html>
        "#;
        let (title, img, mp4) = extract_pinterest_media_from_html(html);
        assert_eq!(title.as_deref(), Some("Night Motion [Video] | Landscape"));
        assert_eq!(
            img.as_deref(),
            Some("https://i.pinimg.com/736x/76/ed/af/76edaf00529634c5287f884a8b4ef38d.jpg")
        );
        assert_eq!(
            mp4.as_deref(),
            Some("https://v1.pinimg.com/videos/mc/720p/27/93/99/2793999fd5ea5a998899b956594bf2bd.mp4")
        );
        assert!(is_pinterest_url("https://pin.it/4pV09EcBu"));
        assert!(!is_pinterest_url("https://example.com/foo"));
    }

    #[test]
    fn skips_vtt_and_hls_urls_to_extract_pinterest_mp4() {
        let html = r#"
            <script>
            {"captions":"https://v1.pinimg.com/videos/captions/en-us/4a/30/f3/4a30f360b9f0bc014a72962fe0bcd9ff.vtt",
             "hls":"https://v1.pinimg.com/videos/iht/hls/4a/30/f3/4a30f360b9f0bc014a72962fe0bcd9ff.m3u8",
             "mp4":"https://v1.pinimg.com/videos/iht/expMp4/4a/30/f3/4a30f360b9f0bc014a72962fe0bcd9ff_720w.mp4"}
            </script>
        "#;
        let (_, _, mp4) = extract_pinterest_media_from_html(html);
        assert_eq!(
            mp4.as_deref(),
            Some("https://v1.pinimg.com/videos/iht/expMp4/4a/30/f3/4a30f360b9f0bc014a72962fe0bcd9ff_720w.mp4")
        );
    }

    #[test]
    fn persists_pinterest_image_and_named_frames_in_ref_dir() {
        let dir = std::env::temp_dir().join(format!("aetheria_pin_g1_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let saved = persist_reference_frames_to_dir(
            &dir,
            "pinterest",
            Some((b"fake-jpg-bytes", "jpg")),
            &[],
        );
        assert_eq!(
            saved,
            vec![
                "ref/ref_pinterest.jpg".to_string(),
                "ref/ref_pinterest_frame_1.jpg".to_string(),
                "ref/ref_pinterest_frame_2.jpg".to_string(),
            ]
        );
        assert!(dir.join("ref_pinterest.jpg").is_file());
        assert!(dir.join("ref_pinterest_frame_1.jpg").is_file());
        assert!(dir.join("ref_pinterest_frame_2.jpg").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn computes_paired_relative_sample_timestamps() {
        let pts = compute_relative_sample_timestamps(10.0);
        assert_eq!(
            pts,
            vec![
                (0.10, "00:00:01.00".to_string()),
                (0.35, "00:00:03.50".to_string()),
                (0.60, "00:00:06.00".to_string()),
                (0.85, "00:00:08.50".to_string()),
            ]
        );
    }

    #[test]
    fn prefers_highest_res_h264_pinterest_mp4_over_first_lowres_hevc() {
        let html = r#"
            <script>
            {"v1":"https://v1.pinimg.com/videos/iht/hevcMp4V3/bb/04/d9/bb04d9ff4860c241c31d0550d4db20f3_540w.mp4",
             "v2":"https://v1.pinimg.com/videos/iht/h265-pt-mp4/bb/04/d9/bb04d9ff4860c241c31d0550d4db20f3_720w_t1.mp4",
             "v3":"https://v1.pinimg.com/videos/iht/expMp4/bb/04/d9/bb04d9ff4860c241c31d0550d4db20f3_720w.mp4",
             "v4":"https://v1.pinimg.com/videos/iht/hevcMp4V3/bb/04/d9/bb04d9ff4860c241c31d0550d4db20f3_360w.mp4"}
            </script>
        "#;
        let (_, _, mp4) = extract_pinterest_media_from_html(html);
        assert_eq!(
            mp4.as_deref(),
            Some("https://v1.pinimg.com/videos/iht/expMp4/bb/04/d9/bb04d9ff4860c241c31d0550d4db20f3_720w.mp4")
        );
    }
}

