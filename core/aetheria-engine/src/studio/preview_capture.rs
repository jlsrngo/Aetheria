//! Headless Browser Preview Screenshot Capture for HTML Motion Films.
//! Reuses the Edge/Chrome CDP pipeline from `html_renderer` without requiring FFmpeg,
//! allowing the agent to visually inspect rendered frames and compare them against references.

use super::cdp_ws::CdpWebSocket;
use super::film_inspector::{inspect_workspace_film, FilmMeta};
use super::film_static_server::start_ephemeral_film_server;
use super::html_renderer::wait_for_film_ready;
use super::motion::resolve_active_html_film_path;
use super::preview_browser::{
    acquire_fresh_preview_browser, acquire_warm_preview_browser, release_warm_preview_browser,
};
use crate::paths::detect_browser_executable;
use crate::tool::path_guard::resolve_isolated_path;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_PREVIEW_FRAMES: usize = 16;
const PREVIEW_VISION_MAX_EDGE: u32 = 960;
pub(crate) const DEFAULT_REFERENCE_PASS_THRESHOLD: f64 = 0.85;
pub const RELATIVE_PREVIEW_POSITIONS: [f64; 4] = [0.10, 0.35, 0.60, 0.85];

pub(crate) fn compute_preview_capture_scale(width: u32, height: u32, max_edge: u32) -> f64 {
    let max_dim = width.max(height);
    if max_dim <= max_edge || max_dim == 0 || max_edge == 0 {
        1.0
    } else {
        (max_edge as f64 / max_dim as f64).clamp(0.25, 1.0)
    }
}

static PREVIOUS_PREVIEW_DIGESTS: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();

fn previous_preview_digests_store() -> &'static Mutex<HashMap<String, Vec<String>>> {
    PREVIOUS_PREVIEW_DIGESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalize_preview_project_key(film_root: &std::path::Path) -> String {
    film_root
        .canonicalize()
        .unwrap_or_else(|_| film_root.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

pub(crate) fn compute_frame_digest(timestamp: f64, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:.2}:{:x}", timestamp, hasher.finalize())
}

pub(crate) fn resolve_reference_comparison_policy(
    has_reference: bool,
    compare_to_reference: Option<bool>,
) -> (bool, bool) {
    let overridden_false = has_reference && compare_to_reference == Some(false);
    let should_compare = has_reference || compare_to_reference.unwrap_or(false);
    (should_compare, overridden_false)
}

pub(crate) fn record_and_check_preview_changed(
    store: &mut HashMap<String, Vec<String>>,
    project_key: &str,
    digests: Vec<String>,
) -> Option<bool> {
    let changed = store
        .get(project_key)
        .map(|prev| *prev != digests);
    store.insert(project_key.to_string(), digests);
    changed
}

#[derive(Clone, Debug, Default)]
pub struct PreviewCaptureOptions {
    pub compare_to_reference: Option<bool>,
    pub pass_threshold: Option<f64>,
    pub visual_inspect_only: Option<bool>,
    pub include_full_res_frames: Option<bool>,
    pub disable_auto_rollback: bool,
    pub forced_scene_id: Option<String>,
    pub write_scene_beat_strips: Option<bool>,
    /// When `true` (or `AETHERIA_PREVIEW_MOTION_BLUR=1`), evaluates frames using the exact same
    /// `motion_blur::MotionBlurMode` temporal shutter expression as `html_renderer.rs` for 1:1 parity.
    pub apply_motion_blur: Option<bool>,
}

/// Returns `true` when the active film uses `stageMode: "hybrid"` or is a self-contained HTML
/// film without external modular `script/*.js` scene files.
pub(crate) fn is_hybrid_or_standalone_html_film(film_root: &Path) -> bool {
    let manifest_path = film_root.join("film.json");
    if manifest_path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<crate::tool::film_scaffold::FilmManifestJson>(&raw) {
                if manifest
                    .stage_mode
                    .as_deref()
                    .is_some_and(|m| m.eq_ignore_ascii_case("hybrid"))
                {
                    return true;
                }
            }
        }
    }
    let index_path = film_root.join("index.html");
    if index_path.is_file() {
        if let Ok(html) = std::fs::read_to_string(&index_path) {
            let local_scripts: Vec<String> = crate::tool::film_feedback::extract_local_script_srcs(&html)
                .into_iter()
                .filter(|rel| {
                    !rel.eq_ignore_ascii_case("script/aetheria-motion.js")
                        && !super::builtin_runtime::is_builtin_post_path(rel)
                        && !super::builtin_runtime::is_builtin_stage_path(rel)
                        && !super::builtin_runtime::is_builtin_tracks_path(rel)
                        && !super::builtin_runtime::is_builtin_story_camera_path(rel)
                        && !super::builtin_runtime::is_builtin_three_path(rel)
                })
                .collect();
            return local_scripts.is_empty();
        }
    }
    if manifest_path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<crate::tool::film_scaffold::FilmManifestJson>(&raw) {
                if !manifest.scenes.is_empty() {
                    return false;
                }
            }
        }
    }
    false
}

/// Resolves whether visual inspection mode applies: honors explicit override first, otherwise
/// defaults to `true` for standalone/hybrid HTML films when `compareToReference` is omitted.
pub(crate) fn resolve_effective_visual_inspect_only(
    explicit_visual_inspect: Option<bool>,
    compare_to_reference: Option<bool>,
    is_hybrid_or_standalone: bool,
) -> bool {
    if let Some(explicit) = explicit_visual_inspect {
        return explicit;
    }
    compare_to_reference.is_none() && is_hybrid_or_standalone
}

pub(crate) fn resolve_effective_reference_policy(
    has_reference: bool,
    compare_to_reference: Option<bool>,
    effective_visual_inspect_only: bool,
) -> (bool, bool) {
    if effective_visual_inspect_only {
        return (false, false);
    }
    resolve_reference_comparison_policy(has_reference, compare_to_reference)
}

#[derive(Clone, Debug)]
pub struct PreviewFrameCapture {
    pub timestamp: f64,
    pub relative_ratio: f64,
    pub saved_rel_path: String,
    pub data_url: String,
}

#[derive(Clone, Debug)]
pub struct FilmPreviewCaptureResult {
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub fps: u32,
    pub frames: Vec<PreviewFrameCapture>,
    pub runtime_errors: Vec<String>,
    pub reference_comparison: Option<Value>,
    pub comparison_strip_data_url: Option<String>,
    pub changed_since_last_capture: Option<bool>,
    pub compare_to_reference_overridden: bool,
    pub anti_cheat: super::fidelity_guard::AntiCheatReport,
    pub story_qa: Option<Value>,
    pub story_contact_sheet_data_url: Option<String>,
    pub reused_warm_browser: bool,
    pub visual_inspect_only: bool,
    pub is_hybrid_or_standalone: bool,
    pub identical_frames_warning: Option<String>,
}

pub(crate) fn compute_relative_ratio(timestamp: f64, duration: f64) -> f64 {
    if duration <= 0.0 || !duration.is_finite() {
        return 0.0;
    }
    (((timestamp / duration).clamp(0.0, 1.0)) * 100.0).round() / 100.0
}

pub(crate) fn validate_render_at_eval_response(
    eval_resp: &Value,
    timestamp: f64,
) -> Result<(), String> {
    if let Some(exc) = eval_resp.get("exceptionDetails") {
        let desc = exc
            .pointer("/exception/description")
            .or_else(|| exc.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("JavaScript runtime exception");
        return Err(format!(
            "Film threw exception during window.renderAt({:.2}): {}",
            timestamp, desc
        ));
    }
    if eval_resp.pointer("/result/value/ok").and_then(Value::as_bool) == Some(false) {
        let msg = eval_resp
            .pointer("/result/value/error")
            .and_then(Value::as_str)
            .unwrap_or("Film does not expose window.renderAt(t)");
        return Err(msg.to_string());
    }
    Ok(())
}

pub(crate) fn validate_non_identical_frames(frames: &[PreviewFrameCapture]) -> Result<(), String> {
    if frames.len() >= 2 {
        let first = frames[0].data_url.trim();
        if !first.is_empty() && frames.iter().skip(1).all(|f| f.data_url.trim() == first) {
            return Err(
                "All captured preview frames are byte-for-byte identical — the film likely failed to render or is frozen across timestamps. Inspect index.html and script/scene*.js.".to_string(),
            );
        }
    }
    Ok(())
}

pub(crate) fn normalize_preview_timestamps(raw: &[f64], duration: f64) -> Vec<f64> {
    let safe_dur = if duration.is_finite() && duration > 0.0 {
        duration
    } else {
        5.0
    };
    let max_t = (safe_dur - 0.05).max(0.0);
    let mut out = Vec::new();
    let candidates: Vec<f64> = if raw.is_empty() {
        RELATIVE_PREVIEW_POSITIONS
            .iter()
            .map(|ratio| (safe_dur * ratio).min(max_t))
            .collect()
    } else {
        raw.iter()
            .copied()
            .filter(|t| t.is_finite() && *t >= 0.0)
            .take(MAX_PREVIEW_FRAMES)
            .collect()
    };

    for t in candidates {
        let clamped = ((t.min(max_t) * 1000.0).round()) / 1000.0;
        if !out.iter().any(|existing: &f64| (*existing - clamped).abs() < 0.02) {
            out.push(clamped);
        }
    }
    if out.is_empty() {
        out.push(0.0);
    }
    out
}

pub(crate) fn resolve_default_preview_timestamps(
    requested_timestamps: &[f64],
    should_compare: bool,
    has_reference: bool,
    ref_root: &Path,
    film_root: &Path,
    duration: f64,
    story_midpoints: &[(String, f64)],
    scenes: &[super::film_inspector::FilmSceneSpec],
) -> Vec<f64> {
    let align_budget = if should_compare {
        MAX_PREVIEW_FRAMES
    } else {
        14
    };
    if requested_timestamps.is_empty() && (should_compare || has_reference) {
        let aligned = super::reference_compare::recommended_reference_timestamps_for_film(
            ref_root,
            film_root,
            duration,
            align_budget,
        );
        if !aligned.is_empty() {
            return aligned;
        }
    }
    if requested_timestamps.is_empty() && !story_midpoints.is_empty() {
        return story_midpoints
            .iter()
            .map(|(_, t)| *t)
            .take(MAX_PREVIEW_FRAMES)
            .collect();
    }
    if requested_timestamps.is_empty() && scenes.len() >= 2 {
        return scenes
            .iter()
            .take(MAX_PREVIEW_FRAMES)
            .map(|sc| (sc.start + sc.duration * 0.5).clamp(0.0, duration.max(0.1)))
            .collect();
    }
    requested_timestamps.to_vec()
}

/// Captures 1-4 JPEG screenshots of the workspace `index.html` motion canvas via headless Edge/Chrome CDP.
pub async fn capture_film_preview_frames(
    workspace_dir: &str,
    requested_timestamps: Vec<f64>,
) -> Result<FilmPreviewCaptureResult, String> {
    capture_film_preview_with_options(workspace_dir, requested_timestamps, None, None).await
}

fn preview_capture_mutex() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Captures preview frames and optionally runs MotionClone-style RGB SSIM + side-by-side comparison
/// against extracted `ref/` keyframes.
pub async fn capture_film_preview_with_options(
    workspace_dir: &str,
    requested_timestamps: Vec<f64>,
    compare_to_reference: Option<bool>,
    pass_threshold: Option<f64>,
) -> Result<FilmPreviewCaptureResult, String> {
    capture_film_preview_with_full_options(
        workspace_dir,
        requested_timestamps,
        PreviewCaptureOptions {
            compare_to_reference,
            pass_threshold,
            visual_inspect_only: Some(false),
            include_full_res_frames: Some(false),
            disable_auto_rollback: false,
            forced_scene_id: None,
            write_scene_beat_strips: None,
            apply_motion_blur: None,
        },
    )
    .await
}

struct CdpRawCapture {
    meta: FilmMeta,
    ref_root: PathBuf,
    should_compare: bool,
    compare_to_reference_overridden: bool,
    timestamps: Vec<f64>,
    frames: Vec<PreviewFrameCapture>,
    frame_digests: Vec<String>,
    runtime_errors: Vec<String>,
    shot_state: Option<Value>,
    shot_report_val: Value,
    failed_shots: Vec<String>,
    sheet_data_url: Option<String>,
    contact_sheet_rel: Option<String>,
}

enum CdpAttemptError {
    WarmTransport(String),
    FilmFailure(String),
}

fn classify_film_ready_error(err: String) -> CdpAttemptError {
    if err.starts_with("HTML film ") {
        CdpAttemptError::FilmFailure(err)
    } else {
        CdpAttemptError::WarmTransport(err)
    }
}

struct CdpCaptureArgs<'a> {
    http_port: u16,
    ws_root: &'a Path,
    film_root: &'a Path,
    preview_dir: &'a Path,
    requested_timestamps: &'a [f64],
    options: &'a PreviewCaptureOptions,
    effective_visual_inspect_only: bool,
    has_story_json: bool,
    story_midpoints: &'a [(String, f64)],
}

async fn run_cdp_preview_capture(
    cdp: &mut CdpWebSocket,
    mut meta: FilmMeta,
    args: &CdpCaptureArgs<'_>,
) -> Result<CdpRawCapture, CdpAttemptError> {
    let initial_width = meta.width;
    let initial_height = meta.height;
    cdp.call(
        "Emulation.setDeviceMetricsOverride",
        json!({
            "width": meta.width,
            "height": meta.height,
            "deviceScaleFactor": 1,
            "mobile": false
        }),
    )
    .await
    .map_err(CdpAttemptError::WarmTransport)?;

    let target_url = format!("http://127.0.0.1:{}/index.html", args.http_port);
    cdp.call("Page.navigate", json!({ "url": target_url }))
        .await
        .map_err(CdpAttemptError::WarmTransport)?;
    wait_for_film_ready(cdp, &mut meta)
        .await
        .map_err(classify_film_ready_error)?;
    if meta.width != initial_width || meta.height != initial_height {
        cdp.call(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": meta.width,
                "height": meta.height,
                "deviceScaleFactor": 1,
                "mobile": false
            }),
        )
        .await
        .map_err(CdpAttemptError::WarmTransport)?;
    }

    let ref_root = if super::reference_compare::discover_reference_keyframes(args.ws_root, meta.duration)
        .is_empty()
        && args.film_root != args.ws_root
    {
        args.film_root.to_path_buf()
    } else {
        args.ws_root.to_path_buf()
    };
    let has_reference =
        !super::reference_compare::discover_reference_keyframes(&ref_root, meta.duration).is_empty();
    let (should_compare, compare_to_reference_overridden) = resolve_effective_reference_policy(
        has_reference,
        args.options.compare_to_reference,
        args.effective_visual_inspect_only,
    );

    let effective_requested = resolve_default_preview_timestamps(
        args.requested_timestamps,
        should_compare,
        has_reference,
        &ref_root,
        args.film_root,
        meta.duration,
        args.story_midpoints,
        &meta.scenes,
    );

    let timestamps = normalize_preview_timestamps(&effective_requested, meta.duration);
    let _ = tokio::fs::create_dir_all(args.preview_dir).await;

    let isolate_js = if args.options.forced_scene_id.is_some() {
        "window.__isolateSceneTransition = true;"
    } else {
        "window.__isolateSceneTransition = false;"
    };
    let _ = cdp
        .call(
            "Runtime.evaluate",
            json!({ "expression": isolate_js, "returnByValue": true }),
        )
        .await;

    let preview_motion_blur_enabled = args.options.apply_motion_blur.unwrap_or_else(|| {
        std::env::var("AETHERIA_PREVIEW_MOTION_BLUR")
            .ok()
            .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "on"))
    });
    let mb_mode = if preview_motion_blur_enabled {
        super::motion_blur::MotionBlurMode::from_env_and_project(args.film_root, args.ws_root)
    } else {
        super::motion_blur::MotionBlurMode::Off
    };
    let fps_f = (meta.fps.max(1)) as f64;

    let mut frames = Vec::with_capacity(timestamps.len());
    let mut frame_digests = Vec::with_capacity(timestamps.len());
    for (idx, ts) in timestamps.iter().enumerate() {
        let samples = mb_mode.samples_for_time(*ts);
        let eval_expr = if samples > 1 {
            let bounds = Some(mb_mode.shutter_bounds(*ts, fps_f));
            super::motion_blur::build_render_frame_expr(*ts, fps_f, samples, bounds)
        } else {
            format!(
                "(() => {{ if (typeof window.renderAt !== 'function') {{ return {{ ok: false, error: 'HTML film does not expose window.renderAt(t)' }}; }} window.renderAt({:.6}); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({{ ok: true }})))); }})()",
                ts
            )
        };
        let eval_resp = cdp
            .call(
                "Runtime.evaluate",
                json!({ "expression": eval_expr, "awaitPromise": true, "returnByValue": true }),
            )
            .await
            .map_err(CdpAttemptError::WarmTransport)?;
        validate_render_at_eval_response(&eval_resp, *ts).map_err(CdpAttemptError::FilmFailure)?;

        let capture_scale =
            compute_preview_capture_scale(meta.width, meta.height, PREVIEW_VISION_MAX_EDGE);
        let shot_params = if capture_scale < 0.999 {
            json!({
                "format": "jpeg",
                "quality": 84,
                "optimizeForSpeed": true,
                "clip": {
                    "x": 0,
                    "y": 0,
                    "width": meta.width,
                    "height": meta.height,
                    "scale": capture_scale
                }
            })
        } else {
            json!({ "format": "jpeg", "quality": 84, "optimizeForSpeed": true })
        };
        let shot = cdp
            .call("Page.captureScreenshot", shot_params)
            .await
            .map_err(CdpAttemptError::WarmTransport)?;
        let b64 = shot
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CdpAttemptError::WarmTransport(format!(
                    "CDP screenshot missing base64 payload at t={:.2}s",
                    ts
                ))
            })?;
        let jpeg_bytes = B64.decode(b64).map_err(|e| {
            CdpAttemptError::FilmFailure(format!(
                "Failed decoding CDP screenshot at t={:.2}s: {}",
                ts, e
            ))
        })?;

        let rel_path = format!(".aetheria/preview/preview_{}.jpg", idx);
        let file_path = args.preview_dir.join(format!("preview_{}.jpg", idx));
        tokio::fs::write(&file_path, &jpeg_bytes)
            .await
            .map_err(|e| {
                CdpAttemptError::FilmFailure(format!(
                    "Failed writing preview screenshot {}: {}",
                    rel_path, e
                ))
            })?;

        frame_digests.push(compute_frame_digest(*ts, &jpeg_bytes));
        frames.push(PreviewFrameCapture {
            timestamp: *ts,
            relative_ratio: compute_relative_ratio(*ts, meta.duration),
            saved_rel_path: rel_path,
            data_url: format!("data:image/jpeg;base64,{}", b64),
        });
    }

    let mut runtime_errors = Vec::new();
    if let Ok(err_eval) = cdp
        .call(
            "Runtime.evaluate",
            json!({
                "expression": "(() => { const errs = Array.isArray(window.__aetheriaErrors) ? window.__aetheriaErrors.slice(0, 8) : []; if (window.__runtimeError && !errs.includes(String(window.__runtimeError))) errs.push(String(window.__runtimeError)); return errs; })()",
                "returnByValue": true
            }),
        )
        .await
    {
        if let Some(arr) = err_eval.pointer("/result/value").and_then(Value::as_array) {
            for item in arr {
                if let Some(s) = item.as_str().filter(|v| !v.trim().is_empty()) {
                    runtime_errors.push(s.to_string());
                }
            }
        }
    }

    let (shot_state, shot_report_val, failed_shots, sheet_data_url, contact_sheet_rel) =
        if args.has_story_json {
            let shot_state = cdp
                .call(
                    "Runtime.evaluate",
                    json!({
                        "expression": "(() => ({ shotReport: window.__shotReport || {}, storyStats: window.__storyStats || null }))()",
                        "returnByValue": true
                    }),
                )
                .await
                .ok()
                .and_then(|v| v.pointer("/result/value").cloned())
                .unwrap_or_else(|| json!({ "shotReport": {}, "storyStats": null }));

            let shot_report_val = shot_state
                .get("shotReport")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let mut failed_shots: Vec<String> = Vec::new();
            if let Some(map) = shot_report_val.as_object() {
                for (sid, srep) in map {
                    let in_safe = srep
                        .get("focusBboxInSafeZone")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let has_errs = srep
                        .get("errors")
                        .and_then(Value::as_array)
                        .is_some_and(|a| !a.is_empty());
                    if !in_safe || has_errs {
                        failed_shots.push(sid.clone());
                    }
                }
                failed_shots.sort();
            }

            let mut sheet_items = Vec::with_capacity(frames.len());
            for (i, fr) in frames.iter().enumerate() {
                let sid = args
                    .story_midpoints
                    .get(i)
                    .map(|(id, _)| id.clone())
                    .unwrap_or_else(|| format!("shot{}", i + 1));
                let srep = shot_report_val.get(&sid).cloned().unwrap_or(Value::Null);
                sheet_items.push(json!({
                    "shotId": sid,
                    "t": fr.timestamp,
                    "dataUrl": fr.data_url,
                    "report": srep
                }));
            }
            let items_json =
                serde_json::to_string(&sheet_items).unwrap_or_else(|_| "[]".to_string());
            let stitch_expr = format!(
                r#"((items, W, H) => new Promise(async (resolve) => {{
                    try {{
                        const cols = Math.min(3, Math.max(1, items.length));
                        const rows = Math.ceil(items.length / cols);
                        const tw = 270;
                        const th = Math.round((H / Math.max(1, W)) * tw);
                        const pad = 12;
                        const hdr = 30;
                        const c = document.createElement('canvas');
                        c.width = cols * tw + (cols + 1) * pad;
                        c.height = rows * (th + hdr) + (rows + 1) * pad;
                        const ctx = c.getContext('2d');
                        ctx.fillStyle = '#0f172a';
                        ctx.fillRect(0, 0, c.width, c.height);
                        const sx = tw / Math.max(1, W);
                        const sy = th / Math.max(1, H);
                        for (let i = 0; i < items.length; i++) {{
                            const it = items[i];
                            const col = i % cols;
                            const row = Math.floor(i / cols);
                            const x = pad + col * (tw + pad);
                            const y = pad + row * (th + hdr + pad);
                            const rep = it.report || {{}};
                            const ok = rep.focusBboxInSafeZone !== false && (!Array.isArray(rep.errors) || rep.errors.length === 0);
                            ctx.fillStyle = '#1e293b';
                            ctx.fillRect(x, y, tw, hdr);
                            ctx.fillStyle = ok ? '#4ade80' : '#f87171';
                            ctx.font = 'bold 12px monospace';
                            ctx.fillText(it.shotId + ' t=' + Number(it.t || 0).toFixed(1) + 's [' + (ok ? 'SAFE' : 'FAIL') + ']', x + 6, y + 19);
                            const img = new Image();
                            await new Promise((r) => {{ img.onload = r; img.onerror = r; img.src = it.dataUrl; }});
                            ctx.drawImage(img, x, y + hdr, tw, th);
                            if (rep.safeZone) {{
                                ctx.save();
                                ctx.strokeStyle = 'rgba(56,189,248,0.85)';
                                ctx.setLineDash([4, 3]);
                                ctx.strokeRect(x + rep.safeZone.minX * sx, y + hdr + rep.safeZone.minY * sy, (rep.safeZone.maxX - rep.safeZone.minX) * sx, (rep.safeZone.maxY - rep.safeZone.minY) * sy);
                                ctx.restore();
                            }}
                            if (rep.bbox) {{
                                ctx.save();
                                ctx.strokeStyle = ok ? '#22c55e' : '#ef4444';
                                ctx.lineWidth = 2;
                                ctx.strokeRect(x + rep.bbox.minX * sx, y + hdr + rep.bbox.minY * sy, rep.bbox.width * sx, rep.bbox.height * sy);
                                ctx.restore();
                            }}
                        }}
                        resolve(c.toDataURL('image/jpeg', 0.88));
                    }} catch (e) {{
                        resolve('');
                    }}
                }}))({items_json}, {w}, {h})"#,
                items_json = items_json,
                w = meta.width,
                h = meta.height
            );

            let sheet_data_url = cdp
                .call(
                    "Runtime.evaluate",
                    json!({ "expression": stitch_expr, "awaitPromise": true, "returnByValue": true }),
                )
                .await
                .ok()
                .and_then(|v| {
                    v.pointer("/result/value")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .filter(|s| s.starts_with("data:image/jpeg;base64,"));

            let mut contact_sheet_rel: Option<String> = None;
            if let Some(ref url) = sheet_data_url {
                if let Some(b64_part) = url.strip_prefix("data:image/jpeg;base64,") {
                    if let Ok(bytes) = B64.decode(b64_part) {
                        let sheet_path = args.preview_dir.join("contact_sheet.jpg");
                        if tokio::fs::write(&sheet_path, &bytes).await.is_ok() {
                            contact_sheet_rel =
                                Some(".aetheria/preview/contact_sheet.jpg".to_string());
                        }
                    }
                }
            }

            (
                Some(shot_state),
                shot_report_val,
                failed_shots,
                sheet_data_url,
                contact_sheet_rel,
            )
        } else {
            (None, json!({}), Vec::new(), None, None)
        };

    Ok(CdpRawCapture {
        meta,
        ref_root,
        should_compare,
        compare_to_reference_overridden,
        timestamps,
        frames,
        frame_digests,
        runtime_errors,
        shot_state,
        shot_report_val,
        failed_shots,
        sheet_data_url,
        contact_sheet_rel,
    })
}

/// Captures preview frames with full options (including Playwright-parity `visual_inspect_only`,
/// full-resolution frame attachment, and persistent warm headless browser reuse).
pub async fn capture_film_preview_with_full_options(
    workspace_dir: &str,
    requested_timestamps: Vec<f64>,
    options: PreviewCaptureOptions,
) -> Result<FilmPreviewCaptureResult, String> {
    let _capture_guard = preview_capture_mutex().lock().await;
    let html_path = resolve_active_html_film_path(Some(workspace_dir))
        .ok_or_else(|| "No index.html found in active project folder".to_string())?;
    let film_root = html_path
        .parent()
        .ok_or_else(|| "Invalid index.html parent path".to_string())?
        .to_path_buf();
    let ws_root = if workspace_dir.trim().is_empty() {
        film_root.clone()
    } else {
        PathBuf::from(workspace_dir)
    };

    let browser_exe = detect_browser_executable().ok_or_else(|| {
        "No Microsoft Edge or Google Chrome executable found for headless preview capture".to_string()
    })?;

    let initial_meta = inspect_workspace_film(&html_path);
    if !initial_meta.exists {
        return Err(format!("HTML film not found at {}", html_path.display()));
    }

    let film_root_str = film_root.to_string_lossy().to_string();
    let preview_dir = resolve_isolated_path(&film_root_str, ".aetheria/preview")
        .unwrap_or_else(|_| film_root.join(".aetheria").join("preview"));
    let story_json_path = film_root.join("story.json");
    let has_story_json = story_json_path.is_file();
    let story_midpoints = if has_story_json {
        super::story_lint::story_shot_midpoints(&story_json_path)
    } else {
        Vec::new()
    };

    let (http_port, _server_guard) =
        start_ephemeral_film_server(film_root.clone(), ws_root.clone()).await?;

    let (mut warm, mut reused_warm_browser) =
        acquire_warm_preview_browser(&browser_exe, initial_meta.width, initial_meta.height).await?;

    let is_hybrid_or_standalone = is_hybrid_or_standalone_html_film(&film_root);
    let effective_visual_inspect_only = resolve_effective_visual_inspect_only(
        options.visual_inspect_only,
        options.compare_to_reference,
        is_hybrid_or_standalone,
    );

    let cdp_args = CdpCaptureArgs {
        http_port,
        ws_root: &ws_root,
        film_root: &film_root,
        preview_dir: &preview_dir,
        requested_timestamps: &requested_timestamps,
        options: &options,
        effective_visual_inspect_only,
        has_story_json,
        story_midpoints: &story_midpoints,
    };

    let raw = match run_cdp_preview_capture(&mut warm.cdp, initial_meta.clone(), &cdp_args).await {
        Ok(raw) => {
            release_warm_preview_browser(warm).await;
            raw
        }
        Err(CdpAttemptError::WarmTransport(first_err)) if reused_warm_browser => {
            drop(warm);
            reused_warm_browser = false;
            let mut fresh = acquire_fresh_preview_browser(
                &browser_exe,
                initial_meta.width,
                initial_meta.height,
            )
            .await?;
            match run_cdp_preview_capture(&mut fresh.cdp, initial_meta, &cdp_args).await {
                Ok(raw) => {
                    release_warm_preview_browser(fresh).await;
                    raw
                }
                Err(CdpAttemptError::WarmTransport(err) | CdpAttemptError::FilmFailure(err)) => {
                    drop(fresh);
                    return Err(format!(
                        "Warm preview failed ({}) and fresh retry failed: {}",
                        first_err, err
                    ));
                }
            }
        }
        Err(CdpAttemptError::FilmFailure(err)) => {
            release_warm_preview_browser(warm).await;
            return Err(err);
        }
        Err(CdpAttemptError::WarmTransport(err)) => {
            drop(warm);
            return Err(err);
        }
    };

    let CdpRawCapture {
        meta,
        ref_root,
        should_compare,
        compare_to_reference_overridden,
        timestamps,
        frames,
        frame_digests,
        runtime_errors,
        shot_state,
        shot_report_val,
        failed_shots,
        sheet_data_url,
        contact_sheet_rel,
    } = raw;

    let identical_frames_warning = if effective_visual_inspect_only {
        validate_non_identical_frames(&frames).err()
    } else {
        validate_non_identical_frames(&frames)?;
        None
    };

    let base_project_key = normalize_preview_project_key(&film_root);
    let ts_scope_sig = format!(
        "{}:{:.2}..{:.2}",
        timestamps.len(),
        timestamps.first().copied().unwrap_or(0.0),
        timestamps.last().copied().unwrap_or(0.0)
    );
    let project_key = format!("{}#{}", base_project_key, ts_scope_sig);
    let changed_since_last_capture = {
        let mut guard = previous_preview_digests_store()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        record_and_check_preview_changed(&mut guard, &project_key, frame_digests)
    };

    let anti_cheat = super::fidelity_guard::validate_film_anti_cheat(&film_root);

    let (reference_comparison, comparison_strip_data_url) = if should_compare {
        match super::reference_compare::compare_preview_to_reference(
            &ref_root,
            &film_root,
            meta.duration,
            &frames,
            options.pass_threshold.unwrap_or(DEFAULT_REFERENCE_PASS_THRESHOLD),
            options.forced_scene_id.as_deref(),
            options.write_scene_beat_strips.unwrap_or(true),
        )
        .await
        {
            Ok((mut cmp_json, strip_url)) => {
                if cmp_json.get("ok").and_then(Value::as_bool) == Some(true) {
                    let overall = cmp_json
                        .get("overallFidelity")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0);
                    let hist = super::fidelity_guard::record_fidelity_score(&project_key, overall);
                    let target_worst =
                        super::fidelity_guard::build_target_worst_scenes(&film_root, &cmp_json);
                    let rolled_back_scenes = if options.disable_auto_rollback {
                        Vec::new()
                    } else {
                        super::fidelity_guard::reconcile_per_scene_snapshots_and_rollback(
                            &film_root,
                            runtime_errors.is_empty(),
                            &cmp_json,
                        )
                    };
                    if let Some(obj) = cmp_json.as_object_mut() {
                        obj.insert("attempt".to_string(), json!(hist.attempt));
                        obj.insert("previousOverall".to_string(), json!(hist.previous_overall));
                        obj.insert("scoreDelta".to_string(), json!(hist.score_delta));
                        obj.insert(
                            "regressedFromPrevious".to_string(),
                            json!(hist.regressed_from_previous),
                        );
                        obj.insert("targetWorstScenes".to_string(), json!(target_worst));
                        if !rolled_back_scenes.is_empty() {
                            obj.insert(
                                "autoRolledBackScenes".to_string(),
                                json!(rolled_back_scenes),
                            );
                        }
                    }
                }
                (Some(cmp_json), strip_url)
            }
            Err(err) => (
                Some(json!({
                    "ok": false,
                    "error": err,
                })),
                None,
            ),
        }
    } else {
        (None, None)
    };

    let (story_qa, story_contact_sheet_data_url) = if has_story_json {
        let story_lint = super::story_lint::lint_story_file(&story_json_path);
        let rolled_back = super::story_lint::reconcile_story_snapshot_and_rollback(
            &film_root,
            story_lint.valid,
            failed_shots.len(),
            runtime_errors.len(),
        );
        let qa_json = json!({
            "mode": "story",
            "lintValid": story_lint.valid,
            "lintIssues": story_lint.issues,
            "totalShots": story_lint.total_shots,
            "customShots": story_lint.custom_shots,
            "failedShots": failed_shots,
            "shotReport": shot_report_val,
            "storyStats": shot_state.as_ref().and_then(|s| s.get("storyStats")).cloned().unwrap_or(Value::Null),
            "contactSheetRelPath": contact_sheet_rel,
            "autoRolledBack": rolled_back,
            "maxCorrectionPasses": 1
        });
        (Some(qa_json), sheet_data_url)
    } else {
        (None, None)
    };

    crate::tool::film_state::record_preview_state(&film_root, runtime_errors.len());

    Ok(FilmPreviewCaptureResult {
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        fps: meta.fps,
        frames,
        runtime_errors,
        reference_comparison,
        comparison_strip_data_url,
        changed_since_last_capture,
        compare_to_reference_overridden,
        anti_cheat,
        story_qa,
        story_contact_sheet_data_url,
        reused_warm_browser,
        visual_inspect_only: effective_visual_inspect_only,
        is_hybrid_or_standalone,
        identical_frames_warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_default_and_clamped_timestamps() {
        let defaults = normalize_preview_timestamps(&[], 10.0);
        assert_eq!(defaults, vec![1.0, 3.5, 6.0, 8.5]);
        assert_eq!(compute_relative_ratio(3.5, 10.0), 0.35);

        let custom = normalize_preview_timestamps(&[-1.0, 0.25, 0.255, 99.0, 2.0, 3.0, 4.0], 6.0);
        assert_eq!(custom, vec![0.25, 5.95, 2.0, 3.0, 4.0]);

        let many: Vec<f64> = (1..=20).map(|i| i as f64 * 0.5).collect();
        let capped = normalize_preview_timestamps(&many, 20.0);
        assert_eq!(capped.len(), MAX_PREVIEW_FRAMES);

        let exact_cuts = normalize_preview_timestamps(&[1.667, 4.967], 10.0);
        assert_eq!(exact_cuts, vec![1.667, 4.967]);
    }

    #[test]
    fn rejects_missing_or_throwing_render_at_in_eval_response() {
        let missing = json!({
            "result": {
                "type": "object",
                "value": {
                    "ok": false,
                    "error": "HTML film does not expose window.renderAt(t)"
                }
            }
        });
        let err1 = validate_render_at_eval_response(&missing, 1.0).unwrap_err();
        assert!(err1.contains("renderAt"));

        let thrown = json!({
            "exceptionDetails": {
                "text": "Uncaught TypeError: window.renderAt is not a function"
            }
        });
        let err2 = validate_render_at_eval_response(&thrown, 2.5).unwrap_err();
        assert!(err2.contains("window.renderAt(2.50)"));

        let ok_resp = json!({
            "result": {
                "type": "object",
                "value": { "ok": true }
            }
        });
        assert!(validate_render_at_eval_response(&ok_resp, 1.0).is_ok());
    }

    #[test]
    fn rejects_byte_identical_preview_frames() {
        let identical = vec![
            PreviewFrameCapture {
                timestamp: 1.0,
                relative_ratio: 0.1,
                saved_rel_path: ".aetheria/preview/preview_0.jpg".to_string(),
                data_url: "data:image/jpeg;base64,AAAA".to_string(),
            },
            PreviewFrameCapture {
                timestamp: 5.0,
                relative_ratio: 0.35,
                saved_rel_path: ".aetheria/preview/preview_1.jpg".to_string(),
                data_url: "data:image/jpeg;base64,AAAA".to_string(),
            },
        ];
        let err = validate_non_identical_frames(&identical).unwrap_err();
        assert!(err.contains("byte-for-byte identical"));

        let distinct = vec![
            identical[0].clone(),
            PreviewFrameCapture {
                timestamp: 5.0,
                relative_ratio: 0.35,
                saved_rel_path: ".aetheria/preview/preview_1.jpg".to_string(),
                data_url: "data:image/jpeg;base64,BBBB".to_string(),
            },
        ];
        assert!(validate_non_identical_frames(&distinct).is_ok());
    }

    #[test]
    fn enforces_reference_comparison_when_refs_exist_and_tracks_capture_changes() {
        assert_eq!(resolve_reference_comparison_policy(true, Some(false)), (true, true));
        assert_eq!(resolve_reference_comparison_policy(true, None), (true, false));
        assert_eq!(resolve_reference_comparison_policy(false, Some(false)), (false, false));

        let mut store = HashMap::new();
        let d1 = vec![
            compute_frame_digest(0.0, b"frame0_v1"),
            compute_frame_digest(1.5, b"frame1_v1"),
        ];
        assert_eq!(record_and_check_preview_changed(&mut store, "/proj", d1.clone()), None);
        assert_eq!(
            record_and_check_preview_changed(&mut store, "/proj", d1),
            Some(false)
        );
        let d2 = vec![
            compute_frame_digest(0.0, b"frame0_v2"),
            compute_frame_digest(1.5, b"frame1_v1"),
        ];
        assert_eq!(
            record_and_check_preview_changed(&mut store, "/proj", d2),
            Some(true)
        );
    }

    #[test]
    fn visual_inspect_only_policy_and_standalone_defaults_work() {
        assert_eq!(
            resolve_effective_visual_inspect_only(None, None, true),
            true
        );
        assert_eq!(
            resolve_effective_visual_inspect_only(None, Some(true), true),
            false
        );
        assert_eq!(
            resolve_effective_visual_inspect_only(None, None, false),
            false
        );
        assert_eq!(
            resolve_effective_visual_inspect_only(Some(true), Some(true), false),
            true
        );

        assert_eq!(
            resolve_effective_reference_policy(true, Some(true), true),
            (false, false)
        );
        assert_eq!(
            resolve_effective_reference_policy(true, Some(false), false),
            (true, true)
        );

        let dir = std::env::temp_dir().join(format!("aetheria_standalone_det_{}", crate::paths::now_ms()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("index.html"),
            "<!doctype html><body><div id='stage'></div><script>window.renderAt=function(){};window.__ready=true;</script></body>",
        )
        .unwrap();
        assert!(is_hybrid_or_standalone_html_film(&dir));

        // Standalone index.html remains standalone even when film.json also defines scenes (e.g. from film_audio).
        std::fs::write(
            dir.join("film.json"),
            r#"{"title":"t","width":1280,"height":720,"fps":30,"scenes":[{"id":"scene1","title":"S1","start":0,"duration":3}]}"#,
        )
        .unwrap();
        assert!(is_hybrid_or_standalone_html_film(&dir));

        std::fs::write(
            dir.join("index.html"),
            "<!doctype html><script src=\"/script/aetheria-motion.js\"></script><script src=\"/script/scene1.js\"></script>",
        )
        .unwrap();
        assert!(!is_hybrid_or_standalone_html_film(&dir));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classifies_html_film_errors_vs_cdp_transport_errors() {
        assert!(matches!(
            classify_film_ready_error(
                "HTML film startup script error (window.renderAt / window.__ready not initialized): ReferenceError: foo is not defined (line 42:7)".to_string()
            ),
            CdpAttemptError::FilmFailure(_)
        ));
        assert!(matches!(
            classify_film_ready_error(
                "HTML film did not expose window.renderAt / window.__ready within 15s".to_string()
            ),
            CdpAttemptError::FilmFailure(_)
        ));
        assert!(matches!(
            classify_film_ready_error("CDP socket closed unexpectedly".to_string()),
            CdpAttemptError::WarmTransport(_)
        ));
        assert!(matches!(
            classify_film_ready_error("CDP navigation did not leave about:blank within 15s".to_string()),
            CdpAttemptError::WarmTransport(_)
        ));
    }

    #[test]
    fn compute_preview_capture_scale_bounds_large_stages() {
        assert!((compute_preview_capture_scale(1080, 1920, 960) - 0.5).abs() < 1e-6);
        assert!((compute_preview_capture_scale(720, 1280, 960) - 0.75).abs() < 1e-6);
        assert!((compute_preview_capture_scale(360, 640, 960) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn standalone_visual_inspect_with_reference_auto_samples_multi_beat_timestamps() {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_preview_multibeat_{}",
            crate::paths::now_ms()
        ));
        let frames_dir = dir.join("ref").join("extracted").join("frames");
        std::fs::create_dir_all(&frames_dir).unwrap();
        for f in [
            "ref_scene_01_start.jpg",
            "ref_scene_01.jpg",
            "ref_scene_01_end.jpg",
            "ref_scene_02_start.jpg",
            "ref_scene_02_q1.jpg",
            "ref_scene_02.jpg",
            "ref_scene_02_q3.jpg",
            "ref_scene_02_end.jpg",
        ] {
            std::fs::write(frames_dir.join(f), b"jpg").unwrap();
        }
        let style_json = json!({
            "scenes": [
                {
                    "index": 1,
                    "id": "scene1",
                    "start": 0.0,
                    "duration": 2.0,
                    "keyframe": "frames/ref_scene_01.jpg",
                    "keyframes": [
                        { "t": 0.1, "path": "frames/ref_scene_01_start.jpg" },
                        { "t": 1.0, "path": "frames/ref_scene_01.jpg" },
                        { "t": 1.9, "path": "frames/ref_scene_01_end.jpg" }
                    ]
                },
                {
                    "index": 2,
                    "id": "scene2",
                    "start": 2.0,
                    "duration": 4.0,
                    "keyframe": "frames/ref_scene_02.jpg",
                    "keyframes": [
                        { "t": 2.1, "path": "frames/ref_scene_02_start.jpg" },
                        { "t": 3.1, "path": "frames/ref_scene_02_q1.jpg" },
                        { "t": 4.0, "path": "frames/ref_scene_02.jpg" },
                        { "t": 4.9, "path": "frames/ref_scene_02_q3.jpg" },
                        { "t": 5.9, "path": "frames/ref_scene_02_end.jpg" }
                    ]
                }
            ]
        });
        std::fs::write(
            dir.join("ref").join("extracted").join("style.json"),
            style_json.to_string(),
        )
        .unwrap();
        let scenes = vec![
            crate::studio::film_inspector::FilmSceneSpec {
                id: "scene1".into(),
                title: "S1".into(),
                start: 0.0,
                duration: 2.0,
                start_frame: 0,
                duration_frames: 60,
                audio: None,
                sfx: None,
                words: None,
            },
            crate::studio::film_inspector::FilmSceneSpec {
                id: "scene2".into(),
                title: "S2".into(),
                start: 2.0,
                duration: 4.0,
                start_frame: 60,
                duration_frames: 120,
                audio: None,
                sfx: None,
                words: None,
            },
        ];
        // Even in standalone visual-inspect mode (`should_compare = false`), when `has_reference` is true,
        // omitting timestamps selects multi-beat morph keyframes (`q1`/`q3`) instead of only 2 scene midpoints.
        let picked = resolve_default_preview_timestamps(
            &[],
            false,
            true,
            &dir,
            &dir,
            6.0,
            &[],
            &scenes,
        );
        assert!(picked.len() > 2, "expected multi-beat morph timestamps, got {:?}", picked);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
