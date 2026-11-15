//! Adobe Stock (Microstock) mode engine module: profile, manifest, locked PNG->FFmpeg render, preflight, and CSV packager.

pub mod adobe_profile;
pub mod loop_check;
pub mod manifest;
pub mod packager;
pub mod policy;
pub mod preflight;
pub mod render_pipeline;

use adobe_profile::{AdobeProfile, RuleSeverity};
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use manifest::{
    load_manifest, resolve_microstock_project_dir, save_manifest, set_ai_declaration,
    MicrostockChecklist, MicrostockLicenseEntry, MicrostockMetadata,
};
use packager::build_adobe_package;
use policy::{build_compliant_filename, evaluate_pre_render_gates, PreRenderRequest};
use preflight::run_post_render_preflight;
use render_pipeline::{render_microstock_staging, MicrostockRenderParams};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;

use crate::paths::{gen_id, now_ms};
use crate::studio::motion::resolve_active_dir_from_request;
use crate::studio::renderer::get_render_jobs_store;
use crate::studio::types::RenderJob;

fn resolve_ws_root(q: &HashMap<String, String>, headers: &HeaderMap, dir_opt: Option<&str>) -> std::path::PathBuf {
    if let Some(d) = dir_opt.map(str::trim).filter(|s| !s.is_empty()) {
        return std::path::PathBuf::from(crate::paths::normalize_workspace_path(d));
    }
    resolve_active_dir_from_request(q, headers)
        .unwrap_or_else(|| crate::paths::aetheria_dot_dir().join("scratch"))
}

/// Builds the `<adobe_stock_microstock_mode>` system prompt injection when Microstock mode (`M`) is active.
pub fn build_active_microstock_prompt_block(workspace_dir: &str) -> Option<String> {
    if workspace_dir.trim().is_empty() {
        return None;
    }
    let ws_root = Path::new(workspace_dir);
    let project_dir = resolve_microstock_project_dir(ws_root, None).ok()?;
    let manifest = load_manifest(ws_root, &project_dir).ok()?;
    if !manifest.enabled {
        return None;
    }

    let profile = AdobeProfile::default_profile();
    let preset = profile
        .find_preset(&manifest.preset)
        .unwrap_or(&profile.presets[0]);
    let skill_md = include_str!("../../../../../.aetheria/skills/adobe-stock/SKILL.md");

    Some(format!(
        "<adobe_stock_microstock_mode>\n\
         ACTIVE ENGINE MODE: Adobe Stock (Microstock) Mode ('M' Toggle is ON).\n\
         Locked Preset: {} ({}x{}, aspect ratio {}, {} FPS, codec {}, silent -an).\n\
         Target Project Folder: {}\n\
         CRITICAL INSTRUCTIONS FOR THIS TURN:\n\
         1. Generate or update the HTML5+JS motion composition strictly at {}x{} ({}) and {} FPS with duration between 5 and 60 seconds.\n\
         2. Enforce ZERO text overlays (no fillText, no strokeText, no <text>, no visible DOM text), ZERO logos/trademarks, ZERO external http(s):// URLs, ZERO audio tracks, and 100% deterministic window.renderAt(t) without Math.random() or Date.now().\n\
         3. Automatically write/update `microstock/manifest.json` with valid Adobe Stock metadata (`title` <= 70 plain chars without commas, `keywords` array of 5 to 49 unique relevant keywords, `category` from the 21 Adobe Stock categories).\n\
         \n\
         {}\n\
         </adobe_stock_microstock_mode>",
        preset.id,
        preset.width,
        preset.height,
        preset.ratio,
        manifest.fps,
        manifest.codec,
        project_dir.display(),
        preset.width,
        preset.height,
        preset.ratio,
        manifest.fps,
        skill_md.trim()
    ))
}

/// GET /api/studio/microstock/profile
pub async fn handle_get_profile() -> impl IntoResponse {
    Json(json!({
        "success": true,
        "data": AdobeProfile::default_profile()
    }))
}

/// GET /api/studio/microstock/manifest
pub async fn handle_get_manifest(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let ws_root = resolve_ws_root(&q, &headers, q.get("directory").map(String::as_str));
    let project_slug = q.get("project").map(String::as_str);
    let project_dir = match resolve_microstock_project_dir(&ws_root, project_slug) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e })),
            )
                .into_response()
        }
    };

    match load_manifest(&ws_root, &project_dir) {
        Ok(manifest) => Json(json!({
            "success": true,
            "data": manifest
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": e })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveManifestPayload {
    pub directory: Option<String>,
    pub project: Option<String>,
    pub enabled: Option<bool>,
    pub preset: Option<String>,
    pub fps: Option<u32>,
    pub codec: Option<String>,
    pub is_loop: Option<bool>,
    #[serde(default)]
    pub ai_declared_present: bool,
    pub ai_declared: Option<bool>,
    pub checklist: Option<MicrostockChecklist>,
    pub metadata: Option<MicrostockMetadata>,
    pub licenses: Option<Vec<MicrostockLicenseEntry>>,
}

/// POST /api/studio/microstock/manifest
pub async fn handle_save_manifest(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<SaveManifestPayload>,
) -> impl IntoResponse {
    let ws_root = resolve_ws_root(&q, &headers, payload.directory.as_deref());
    let project_dir = match resolve_microstock_project_dir(&ws_root, payload.project.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e })),
            )
                .into_response()
        }
    };

    let mut manifest = load_manifest(&ws_root, &project_dir).unwrap_or_default();
    if let Some(en) = payload.enabled {
        manifest.enabled = en;
    }
    if let Some(p) = payload.preset.filter(|s| !s.trim().is_empty()) {
        manifest.preset = p.trim().to_string();
    }
    if let Some(fps) = payload.fps {
        manifest.fps = fps;
    }
    if let Some(c) = payload.codec.filter(|s| !s.trim().is_empty()) {
        manifest.codec = c.trim().to_ascii_lowercase();
    }
    if let Some(lp) = payload.is_loop {
        manifest.is_loop = lp;
    }
    if payload.ai_declared_present || payload.ai_declared.is_some() {
        set_ai_declaration(&mut manifest, payload.ai_declared);
    }
    if let Some(cl) = payload.checklist {
        manifest.checklist = cl;
    }
    if let Some(meta) = payload.metadata {
        manifest.metadata = meta;
    }
    if let Some(lic) = payload.licenses {
        manifest.licenses = lic;
    }

    match save_manifest(&ws_root, &project_dir, &manifest) {
        Ok(_) => Json(json!({
            "success": true,
            "data": manifest
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": e })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleModePayload {
    pub directory: Option<String>,
    pub project: Option<String>,
    pub enabled: bool,
    pub preset: Option<String>,
    pub fps: Option<u32>,
}

/// POST /api/studio/microstock/mode
pub async fn handle_toggle_mode(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<ToggleModePayload>,
) -> impl IntoResponse {
    let ws_root = resolve_ws_root(&q, &headers, payload.directory.as_deref());
    let project_dir = match resolve_microstock_project_dir(&ws_root, payload.project.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e })),
            )
                .into_response()
        }
    };

    let profile = AdobeProfile::default_profile();
    let mut manifest = load_manifest(&ws_root, &project_dir).unwrap_or_default();
    manifest.enabled = payload.enabled;
    if let Some(ref p) = payload.preset {
        if profile.find_preset(p).is_some() {
            manifest.preset = p.clone();
        }
    }
    if !profile.presets.iter().any(|p| p.id == manifest.preset) {
        manifest.preset = "1920x1080".to_string();
    }
    if let Some(fps) = payload.fps {
        if profile.allowed_fps.value.contains(&fps) {
            manifest.fps = fps;
        }
    }
    if !profile.allowed_fps.value.contains(&manifest.fps) {
        manifest.fps = 30;
    }

    let preset_spec = profile
        .find_preset(&manifest.preset)
        .cloned()
        .unwrap_or_else(|| profile.presets[0].clone());

    if let Err(e) = save_manifest(&ws_root, &project_dir, &manifest) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": e })),
        )
            .into_response();
    }

    Json(json!({
        "success": true,
        "data": {
            "enabled": manifest.enabled,
            "preset": preset_spec,
            "fps": manifest.fps,
            "codec": manifest.codec,
            "manifest": manifest
        }
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockRenderPayload {
    pub directory: Option<String>,
    pub project: Option<String>,
    pub preset_id: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub codec: Option<String>,
    pub duration_sec: Option<f64>,
    pub output_filename: Option<String>,
    pub reference_url: Option<String>,
    pub auto_preflight: Option<bool>,
    pub render_id: Option<String>,
}

fn resolve_microstock_render_id(requested: Option<&str>) -> String {
    requested
        .map(str::trim)
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 64
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .map(String::from)
        .unwrap_or_else(|| gen_id("msrnd"))
}

/// POST /api/studio/microstock/render
pub async fn handle_microstock_render(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<MicrostockRenderPayload>,
) -> impl IntoResponse {
    let ws_root = resolve_ws_root(&q, &headers, payload.directory.as_deref());
    let project_dir = match resolve_microstock_project_dir(&ws_root, payload.project.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "code": "FILENAME_TOO_LONG",
                    "message": e
                })),
            )
                .into_response()
        }
    };

    let profile = AdobeProfile::default_profile();
    let mut manifest = load_manifest(&ws_root, &project_dir).unwrap_or_default();

    let preset_id = payload
        .preset_id
        .clone()
        .unwrap_or_else(|| manifest.preset.clone());
    let fps = payload.fps.unwrap_or(manifest.fps);
    let codec = payload
        .codec
        .clone()
        .unwrap_or_else(|| manifest.codec.clone());
    let duration_sec = payload.duration_sec.unwrap_or(6.0);

    let req = PreRenderRequest {
        preset_id: preset_id.clone(),
        width: payload.width,
        height: payload.height,
        fps,
        codec: codec.clone(),
        duration_sec,
        output_filename: payload.output_filename.clone(),
        reference_url: payload.reference_url.clone(),
    };

    let pre_items = evaluate_pre_render_gates(&profile, &project_dir, &manifest, &req);
    if let Some(first_fail) = pre_items.iter().find(|i| i.severity == RuleSeverity::Fail) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "code": first_fail.code,
                "message": first_fail.message,
                "items": pre_items
            })),
        )
            .into_response();
    }

    let (target_w, target_h) = if let (Some(w), Some(h)) = (payload.width, payload.height) {
        (w, h)
    } else if let Some(p) = profile.find_preset(&preset_id) {
        (p.width, p.height)
    } else {
        (1920, 1080)
    };

    let slug = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("stock");
    let output_filename = payload
        .output_filename
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| build_compliant_filename(slug, &preset_id, &codec));

    let render_id = resolve_microstock_render_id(payload.render_id.as_deref());
    let total_frames = ((duration_sec * (fps as f64)).round() as u32).max(1);
    {
        let mut jobs = get_render_jobs_store().write().unwrap_or_else(|e| e.into_inner());
        jobs.insert(
            render_id.clone(),
            RenderJob {
                render_id: render_id.clone(),
                composition_id: format!("AdobeStock-{}", preset_id),
                status: "rendering".to_string(),
                percent: 0,
                rendered_frames: 0,
                total_frames,
                output_path: None,
                error: None,
                created_at: now_ms(),
            },
        );
    }

    let rid_prog = render_id.clone();
    let render_res = render_microstock_staging(
        MicrostockRenderParams {
            project_dir: project_dir.clone(),
            ws_root: ws_root.clone(),
            target_width: target_w,
            target_height: target_h,
            fps,
            codec: codec.clone(),
            duration_sec,
            output_filename: output_filename.clone(),
        },
        move |done, total, pct| {
            let mut jobs = get_render_jobs_store().write().unwrap_or_else(|e| e.into_inner());
            if let Some(j) = jobs.get_mut(&rid_prog) {
                j.rendered_frames = done;
                j.total_frames = total;
                j.percent = pct;
            }
        },
    )
    .await;

    let render_out = match render_res {
        Ok(out) => {
            let mut jobs = get_render_jobs_store().write().unwrap_or_else(|e| e.into_inner());
            if let Some(j) = jobs.get_mut(&render_id) {
                j.status = "completed".to_string();
                j.percent = 100;
                j.output_path = Some(out.staging_path.clone());
            }
            out
        }
        Err(fail_item) => {
            let mut jobs = get_render_jobs_store().write().unwrap_or_else(|e| e.into_inner());
            if let Some(j) = jobs.get_mut(&render_id) {
                j.status = "failed".to_string();
                j.error = Some(fail_item.message.clone());
            }
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "code": fail_item.code,
                    "message": fail_item.message,
                    "items": [fail_item]
                })),
            )
                .into_response();
        }
    };

    manifest.preset = preset_id;
    manifest.fps = fps;
    manifest.codec = codec;
    let _ = save_manifest(&ws_root, &project_dir, &manifest);

    let mut preflight_report = None;
    if payload.auto_preflight.unwrap_or(true) {
        if let Ok(rep) = run_post_render_preflight(
            &profile,
            &ws_root,
            &project_dir,
            &mut manifest,
            &output_filename,
            None,
        )
        .await
        {
            preflight_report = Some(rep);
        }
    }

    Json(json!({
        "success": true,
        "data": {
            "renderId": render_id,
            "render": render_out,
            "preflight": preflight_report,
            "manifest": manifest
        }
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockPreflightPayload {
    pub directory: Option<String>,
    pub project: Option<String>,
    pub file: String,
    pub check_loop: Option<bool>,
}

/// POST /api/studio/microstock/preflight
pub async fn handle_microstock_preflight(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<MicrostockPreflightPayload>,
) -> impl IntoResponse {
    let ws_root = resolve_ws_root(&q, &headers, payload.directory.as_deref());
    let project_dir = match resolve_microstock_project_dir(&ws_root, payload.project.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e })),
            )
                .into_response()
        }
    };

    let profile = AdobeProfile::default_profile();
    let mut manifest = load_manifest(&ws_root, &project_dir).unwrap_or_default();

    match run_post_render_preflight(
        &profile,
        &ws_root,
        &project_dir,
        &mut manifest,
        &payload.file,
        payload.check_loop,
    )
    .await
    {
        Ok(report) => Json(json!({
            "success": true,
            "data": report
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": e })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockPackagePayload {
    pub directory: Option<String>,
    pub project: Option<String>,
    pub file: Option<String>,
    pub metadata: Option<MicrostockMetadata>,
}

/// POST /api/studio/microstock/package
pub async fn handle_microstock_package(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<MicrostockPackagePayload>,
) -> impl IntoResponse {
    let ws_root = resolve_ws_root(&q, &headers, payload.directory.as_deref());
    let project_dir = match resolve_microstock_project_dir(&ws_root, payload.project.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "code": "METADATA_INVALID",
                    "message": e
                })),
            )
                .into_response()
        }
    };

    let profile = AdobeProfile::default_profile();
    let mut manifest = load_manifest(&ws_root, &project_dir).unwrap_or_default();
    if let Some(meta) = payload.metadata {
        manifest.metadata = meta;
        let _ = save_manifest(&ws_root, &project_dir, &manifest);
    }

    let slug = payload
        .project
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| project_dir.file_name().and_then(|n| n.to_str()))
        .unwrap_or("adobe-clip");

    match build_adobe_package(
        &profile,
        &ws_root,
        &project_dir,
        slug,
        &mut manifest,
        payload.file.as_deref(),
    ) {
        Ok(pkg) => Json(json!({
            "success": true,
            "data": pkg
        }))
        .into_response(),
        Err(items) => {
            let code = items
                .first()
                .map(|i| i.code.clone())
                .unwrap_or_else(|| "METADATA_INVALID".to_string());
            let msg = items
                .first()
                .map(|i| i.message.clone())
                .unwrap_or_else(|| "Package validation failed".to_string());
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "code": code,
                    "message": msg,
                    "items": items
                })),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_microstock_render_id, MicrostockRenderPayload};

    #[test]
    fn resolves_valid_caller_render_id_and_rejects_unsafe_ones() {
        assert_eq!(
            resolve_microstock_render_id(Some("  msrnd_test-123  ")),
            "msrnd_test-123"
        );
        let fallback_empty = resolve_microstock_render_id(Some("   "));
        assert!(fallback_empty.starts_with("msrnd_"));
        let fallback_bad = resolve_microstock_render_id(Some("../bad/id"));
        assert!(fallback_bad.starts_with("msrnd_"));
        let parsed: MicrostockRenderPayload = serde_json::from_str(
            r#"{"presetId":"1920x1080","fps":30,"renderId":"msrnd_custom_1"}"#,
        )
        .expect("payload deserialize");
        assert_eq!(parsed.render_id.as_deref(), Some("msrnd_custom_1"));
    }
}
