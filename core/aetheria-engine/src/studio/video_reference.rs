//! Video Reference Extractor handler for Studio (`/api/studio/video-reference/extract`).

use crate::files::resolve_base_dir;
use crate::paths::contains_path;
use axum::{extract::Query, http::HeaderMap, response::IntoResponse, Json};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractVideoRefPayload {
    pub file_name: Option<String>,
    pub video_base64: Option<String>,
    pub video_path: Option<String>,
    pub reference_url: Option<String>,
}

pub(crate) fn validate_reference_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.chars().any(char::is_whitespace)
        || !(trimmed.starts_with("https://") || trimmed.starts_with("http://"))
    {
        return Err("URL referensi harus berupa link http:// atau https:// yang valid tanpa spasi.".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    let supported = lower.contains("://pin.it/")
        || (lower.contains("pinterest.") && lower.contains("/pin/"))
        || lower.contains("tiktok.com/");
    if !supported {
        return Err(
            "URL referensi belum didukung (gunakan link video Pinterest pin.it/pinterest.com atau TikTok)."
                .to_string(),
        );
    }
    Ok(trimmed.to_string())
}

/// POST `/api/studio/video-reference/extract`
pub async fn handle_extract_video_reference(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<ExtractVideoRefPayload>,
) -> impl IntoResponse {
    let active_ws = resolve_base_dir(&q, &headers);
    let ref_dir = active_ws.join("ref");
    let _ = std::fs::create_dir_all(&ref_dir);

    let extracted_dir = ref_dir.join("extracted");
    let style_path = extracted_dir.join("style.json");
    let temporal_path = extracted_dir.join("temporal.json");
    let report_path = extracted_dir.join("ref_report.md");

    let mut extracted_by_social_hook = false;
    let target_video = if let Some(b64_raw) = payload.video_base64.filter(|s| !s.trim().is_empty()) {
        let clean_b64 = b64_raw
            .split(',')
            .next_back()
            .unwrap_or(b64_raw.as_str())
            .trim();
        let safe_name = payload
            .file_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("ref_{}.mp4", crate::paths::now_ms()));
        let safe_base_name = std::path::Path::new(&safe_name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("ref_upload.mp4");
        let out_path = ref_dir.join(safe_base_name);
        if !contains_path(&active_ws, &out_path) {
            return Json(json!({
                "success": false,
                "error": "Upload filename resolved outside active project folder."
            }));
        }
        match base64::engine::general_purpose::STANDARD.decode(clean_b64) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(&out_path, &bytes) {
                    return Json(json!({
                        "success": false,
                        "error": format!("Failed to save reference video: {}", e)
                    }));
                }
                out_path
            }
            Err(e) => {
                return Json(json!({
                    "success": false,
                    "error": format!("Invalid video base64 payload: {}", e)
                }));
            }
        }
    } else if let Some(vp) = payload.video_path.filter(|s| !s.trim().is_empty()) {
        let p = std::path::Path::new(&vp);
        let resolved = if p.is_absolute() {
            p.to_path_buf()
        } else {
            active_ws.join(p)
        };
        if !contains_path(&active_ws, &resolved) {
            return Json(json!({
                "success": false,
                "error": "Reference videoPath is outside active project folder."
            }));
        }
        resolved
    } else if let Some(ref_url_raw) = payload.reference_url.filter(|s| !s.trim().is_empty()) {
        let validated_url = match validate_reference_url(&ref_url_raw) {
            Ok(u) => u,
            Err(err) => {
                return Json(json!({
                    "success": false,
                    "error": err
                }));
            }
        };
        // Clear stale downloaded social videos & extracted specs so a failed fetch cannot reuse old outputs
        let pin_mp4 = ref_dir.join("ref_pinterest.mp4");
        let tiktok_mp4 = ref_dir.join("ref_tiktok.mp4");
        let _ = std::fs::remove_file(&pin_mp4);
        let _ = std::fs::remove_file(&tiktok_mp4);
        let _ = std::fs::remove_file(&style_path);

        let ws_str = active_ws.to_string_lossy().to_string();
        let ff_bin = crate::paths::locate_ffmpeg_binary();
        let _ = crate::session::agent_turn::social_links::process_social_links(
            &ws_str,
            &validated_url,
            ff_bin.as_deref(),
        )
        .await;

        let downloaded = if pin_mp4.is_file() {
            pin_mp4
        } else if tiktok_mp4.is_file() {
            tiktok_mp4
        } else {
            return Json(json!({
                "success": false,
                "error": "Tidak menemukan video MP4 dari link referensi tersebut (pastikan pin/video publik memiliki stream video)."
            }));
        };
        extracted_by_social_hook = style_path.is_file() && report_path.is_file();
        downloaded
    } else {
        return Json(json!({
            "success": false,
            "error": "Provide either an uploaded video file, videoPath, or referenceUrl."
        }));
    };

    let _ = std::fs::create_dir_all(&extracted_dir);

    let res = if extracted_by_social_hook {
        json!({ "ok": true, "source": "social_links" })
    } else {
        crate::tool::ref_extractor::execute_ref_extractor(
            &active_ws.to_string_lossy(),
            &json!({
                "videoPath": target_video.to_string_lossy().to_string(),
                "outputDir": extracted_dir.to_string_lossy().to_string()
            }),
        )
        .await
    };

    let report_md = std::fs::read_to_string(&report_path).unwrap_or_default();
    let style_spec: Option<serde_json::Value> = std::fs::read_to_string(&style_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());

    Json(json!({
        "success": res.get("error").is_none(),
        "videoPath": target_video.to_string_lossy().to_string(),
        "reportPath": report_path.to_string_lossy().to_string(),
        "stylePath": style_path.to_string_lossy().to_string(),
        "temporalPath": temporal_path.to_string_lossy().to_string(),
        "reportMarkdown": report_md,
        "styleSpec": style_spec,
        "extractorResult": res
    }))
}

#[cfg(test)]
mod tests {
    use super::validate_reference_url;

    #[test]
    fn validates_supported_reference_urls_and_rejects_others() {
        assert_eq!(
            validate_reference_url("  https://pin.it/6OqBZoR44 ").unwrap(),
            "https://pin.it/6OqBZoR44"
        );
        assert!(validate_reference_url("https://www.tiktok.com/@a/video/123").is_ok());
        assert!(validate_reference_url("https://example.com/foo.mp4").is_err());
        assert!(validate_reference_url("ftp://pin.it/abc").is_err());
        assert!(validate_reference_url("https://pin.it/abc def").is_err());
    }
}
