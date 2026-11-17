//! Locked Adobe Stock lossless PNG CDP capture + Rec.709 H.264/ProRes FFmpeg pipeline.

use super::adobe_profile::{RuleSeverity, URL_REFUSAL};
use super::loop_check::{compare_images_psnr_ssim, FrameSimilarityMetrics};
use super::manifest::PreflightItem;
use crate::paths::{detect_browser_executable, locate_ffmpeg_binary, now_ms};
use crate::studio::ffmpeg_pipeline::{format_ffmpeg_failure_from_task, spawn_stderr_drain};
use crate::studio::film_inspector::inspect_workspace_film;
use crate::studio::film_static_server::start_ephemeral_film_server;
use crate::studio::html_renderer::launch_headless_browser_with_cdp;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone)]
pub struct MicrostockRenderParams {
    pub project_dir: PathBuf,
    pub ws_root: PathBuf,
    pub target_width: u32,
    pub target_height: u32,
    pub fps: u32,
    pub codec: String,
    pub duration_sec: f64,
    pub output_filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockRenderOutput {
    pub staging_path: String,
    pub filename: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub total_frames: u32,
    pub codec: String,
    pub file_size_bytes: u64,
    pub elapsed_ms: u64,
    pub source_vs_encoded: Option<FrameSimilarityMetrics>,
    pub upscale_check: Option<FrameSimilarityMetrics>,
}

pub fn build_microstock_ffmpeg_command(
    ffmpeg_bin: &Path,
    fps: u32,
    codec: &str,
    output_path: &Path,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg_bin);
    cmd.args(["-y", "-f", "image2pipe", "-vcodec", "png", "-framerate"])
        .arg(fps.max(1).to_string())
        .args(["-i", "pipe:0", "-map", "0:v", "-an"]);

    if codec.eq_ignore_ascii_case("prores") {
        cmd.args([
            "-c:v",
            "prores_ks",
            "-profile:v",
            "3",
            "-pix_fmt",
            "yuv422p10le",
            "-vf",
            "scale=in_color_matrix=bt709:out_color_matrix=bt709",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
        ]);
    } else {
        cmd.args([
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-crf",
            "15",
            "-movflags",
            "+faststart",
            "-vf",
            "scale=in_color_matrix=bt709:out_color_matrix=bt709",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
        ]);
    }

    cmd.arg(output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

pub async fn render_microstock_staging<FProgress>(
    params: MicrostockRenderParams,
    mut on_progress: FProgress,
) -> Result<MicrostockRenderOutput, PreflightItem>
where
    FProgress: FnMut(u32, u32, u32),
{
    let t0 = now_ms();
    let html_path = params.project_dir.join("index.html");
    if !html_path.is_file() {
        return Err(PreflightItem {
            code: "MOTION_LINT_ERRORS".to_string(),
            severity: RuleSeverity::Fail,
            message: format!("No index.html found at {}", html_path.display()),
            source: URL_REFUSAL.to_string(),
        });
    }

    let browser_exe = detect_browser_executable().ok_or_else(|| PreflightItem {
        code: "MOTION_LINT_ERRORS".to_string(),
        severity: RuleSeverity::Fail,
        message: "No headless Chromium/Edge browser found.".to_string(),
        source: URL_REFUSAL.to_string(),
    })?;
    let ffmpeg_bin = locate_ffmpeg_binary().ok_or_else(|| PreflightItem {
        code: "MOTION_LINT_ERRORS".to_string(),
        severity: RuleSeverity::Fail,
        message: "FFmpeg binary not found.".to_string(),
        source: URL_REFUSAL.to_string(),
    })?;

    let meta = inspect_workspace_film(&html_path);
    let base_w = meta.width.max(1);
    let base_h = meta.height.max(1);

    let dpr_x = (params.target_width as f64) / (base_w as f64);
    let dpr_y = (params.target_height as f64) / (base_h as f64);
    let (viewport_w, viewport_h, dpr) = if (dpr_x - dpr_y).abs() < 0.01 && dpr_x >= 1.0 {
        (base_w, base_h, dpr_x)
    } else {
        (params.target_width, params.target_height, 1.0)
    };

    let staging_dir = params
        .project_dir
        .join("output")
        .join("microstock")
        .join("staging");
    tokio::fs::create_dir_all(&staging_dir)
        .await
        .map_err(|e| PreflightItem {
            code: "MOTION_LINT_ERRORS".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Failed creating staging directory '{}': {}",
                staging_dir.display(),
                e
            ),
            source: URL_REFUSAL.to_string(),
        })?;
    let final_output = staging_dir.join(&params.output_filename);

    let (http_port, _srv) =
        start_ephemeral_film_server(params.project_dir.clone(), params.ws_root.clone())
            .await
            .map_err(|e| PreflightItem {
                code: "MOTION_LINT_ERRORS".to_string(),
                severity: RuleSeverity::Fail,
                message: e,
                source: URL_REFUSAL.to_string(),
            })?;
    let (_chrome, mut cdp) = launch_headless_browser_with_cdp(
        &browser_exe,
        params.target_width,
        params.target_height,
    )
    .await
    .map_err(|e| PreflightItem {
        code: "MOTION_LINT_ERRORS".to_string(),
        severity: RuleSeverity::Fail,
        message: e,
        source: URL_REFUSAL.to_string(),
    })?;

    let _ = cdp.call("Page.enable", json!({})).await;
    let _ = cdp.call("Runtime.enable", json!({})).await;
    let _ = cdp
        .call(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": viewport_w,
                "height": viewport_h,
                "deviceScaleFactor": dpr,
                "mobile": false
            }),
        )
        .await;

    let target_url = format!("http://127.0.0.1:{}/index.html", http_port);
    let _ = cdp.call("Page.navigate", json!({ "url": target_url })).await;

    for _ in 0..80 {
        if let Ok(v) = cdp
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": "typeof window.renderAt === 'function' && window.__ready !== false",
                    "returnByValue": true
                }),
            )
            .await
        {
            if v.pointer("/result/value").and_then(Value::as_bool) == Some(true) {
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    // If dpr > 1.0 (e.g. 4K target from 1080p base), verify UPSCALE_RISK heuristic:
    //Compare DPR=2 render vs DPR=1 FFmpeg-upscaled frame + inspect DOM canvas backing store resolution.
    let mut upscale_check = None;
    if dpr > 1.05 {
        let tmp_check_dir = std::env::temp_dir().join(format!("aetheria_upscale_{}", now_ms()));
        let _ = std::fs::create_dir_all(&tmp_check_dir);
        let dpr2_png = tmp_check_dir.join("dpr2.png");
        let dpr1_png = tmp_check_dir.join("dpr1.png");
        let dpr1_up_png = tmp_check_dir.join("dpr1_up.png");

        let _ = cdp
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": "(() => { window.renderAt(0.5); return new Promise(r => requestAnimationFrame(() => r(true))); })()",
                    "awaitPromise": true
                }),
            )
            .await;

        let canvas_backing_w = cdp
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": "(() => { const c = document.querySelector('canvas'); return c ? c.width : 0; })()",
                    "returnByValue": true
                }),
            )
            .await
            .ok()
            .and_then(|v| v.pointer("/result/value").and_then(Value::as_u64))
            .unwrap_or(0) as u32;

        if let Ok(shot2) = cdp
            .call("Page.captureScreenshot", json!({ "format": "png" }))
            .await
        {
            if let Some(b64) = shot2.get("data").and_then(Value::as_str) {
                if let Ok(bytes) = B64.decode(b64) {
                    let _ = std::fs::write(&dpr2_png, bytes);
                }
            }
        }

        // Capture DPR=1 at base resolution and upscale via FFmpeg to compare
        let _ = cdp
            .call(
                "Emulation.setDeviceMetricsOverride",
                json!({
                    "width": viewport_w,
                    "height": viewport_h,
                    "deviceScaleFactor": 1.0,
                    "mobile": false
                }),
            )
            .await;
        let _ = cdp
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": "(() => { window.renderAt(0.5); return new Promise(r => requestAnimationFrame(() => r(true))); })()",
                    "awaitPromise": true
                }),
            )
            .await;
        if let Ok(shot1) = cdp
            .call("Page.captureScreenshot", json!({ "format": "png" }))
            .await
        {
            if let Some(b64) = shot1.get("data").and_then(Value::as_str) {
                if let Ok(bytes) = B64.decode(b64) {
                    let _ = std::fs::write(&dpr1_png, bytes);
                }
            }
        }

        // Restore DPR for main render
        let _ = cdp
            .call(
                "Emulation.setDeviceMetricsOverride",
                json!({
                    "width": viewport_w,
                    "height": viewport_h,
                    "deviceScaleFactor": dpr,
                    "mobile": false
                }),
            )
            .await;

        let mut up_cmd = std::process::Command::new(&ffmpeg_bin);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            up_cmd.creation_flags(0x08000000);
        }
        let _ = up_cmd
            .args(["-y", "-hide_banner", "-i"])
            .arg(&dpr1_png)
            .arg("-vf")
            .arg(format!(
                "scale={}:{}:flags=bilinear",
                params.target_width, params.target_height
            ))
            .arg(&dpr1_up_png)
            .output();

        let sim = compare_images_psnr_ssim(&ffmpeg_bin, &dpr2_png, &dpr1_up_png).ok();
        let _ = std::fs::remove_dir_all(&tmp_check_dir);
        upscale_check = sim;

        // If the canvas backing resolution stayed <= base_w (never scaled to 4K) AND DPR=2 matches upscaled DPR=1:
        if canvas_backing_w > 0 && canvas_backing_w < params.target_width {
            let metrics_note = sim
                .map(|m| format!(" (SSIM={:.5}, PSNR={:.2}dB)", m.ssim, m.psnr_db))
                .unwrap_or_default();
            return Err(PreflightItem {
                code: "UPSCALE_RISK".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "4K preset blocked: canvas backing buffer is {}px wide (< {}px target), causing upscaled pixels{}.",
                    canvas_backing_w, params.target_width, metrics_note
                ),
                source: URL_REFUSAL.to_string(),
            });
        }
    }

    let total_frames = ((params.duration_sec * (params.fps as f64)).round() as u32).max(1);
    let fps_f = params.fps.max(1) as f64;
    let ext = if params.codec.eq_ignore_ascii_case("prores") {
        "mov"
    } else {
        "mp4"
    };
    let tmp_output = staging_dir.join(format!(".tmp-ms-{}.{}", now_ms(), ext));

    let mut ff_cmd =
        build_microstock_ffmpeg_command(&ffmpeg_bin, params.fps, &params.codec, &tmp_output);
    let mut ff_child = ff_cmd.spawn().map_err(|e| PreflightItem {
        code: "MOTION_LINT_ERRORS".to_string(),
        severity: RuleSeverity::Fail,
        message: format!("Failed spawning FFmpeg: {}", e),
        source: URL_REFUSAL.to_string(),
    })?;
    let mut ff_stdin = ff_child.stdin.take().ok_or_else(|| PreflightItem {
        code: "MOTION_LINT_ERRORS".to_string(),
        severity: RuleSeverity::Fail,
        message: "Failed capturing FFmpeg stdin".to_string(),
        source: URL_REFUSAL.to_string(),
    })?;
    let ff_stderr_task = spawn_stderr_drain(ff_child.stderr.take());

    let mut sample_frame0_png: Option<Vec<u8>> = None;
    let mut pipe_err: Option<String> = None;

    for frame_idx in 0..total_frames {
        let t = (frame_idx as f64) / fps_f;
        let eval_expr = format!(
            "(() => {{ window.renderAt({:.6}); return new Promise(r => requestAnimationFrame(() => r(true))); }})()",
            t
        );
        if let Err(e) = cdp
            .call(
                "Runtime.evaluate",
                json!({ "expression": eval_expr, "awaitPromise": true }),
            )
            .await
        {
            pipe_err = Some(e);
            break;
        }

        let shot = match cdp
            .call("Page.captureScreenshot", json!({ "format": "png" }))
            .await
        {
            Ok(v) => v,
            Err(e) => {
                pipe_err = Some(e);
                break;
            }
        };
        let Some(b64) = shot.get("data").and_then(Value::as_str) else {
            pipe_err = Some(format!("Missing PNG base64 at frame {}", frame_idx));
            break;
        };
        let png_bytes = match B64.decode(b64) {
            Ok(b) => b,
            Err(e) => {
                pipe_err = Some(format!("Invalid base64 PNG at frame {}: {}", frame_idx, e));
                break;
            }
        };

        if frame_idx == 0 {
            sample_frame0_png = Some(png_bytes.clone());
        }

        if let Err(e) = ff_stdin.write_all(&png_bytes).await {
            pipe_err = Some(format!("Failed piping PNG frame {} to FFmpeg: {}", frame_idx, e));
            break;
        }

        let done = frame_idx + 1;
        let pct = ((done as f64 / total_frames as f64) * 100.0).round() as u32;
        on_progress(done, total_frames, pct.min(100));
    }

    drop(ff_stdin);
    if let Some(err_msg) = pipe_err {
        let _ = ff_child.kill().await;
        let _ = tokio::fs::remove_file(&tmp_output).await;
        return Err(PreflightItem {
            code: "MOTION_LINT_ERRORS".to_string(),
            severity: RuleSeverity::Fail,
            message: err_msg,
            source: URL_REFUSAL.to_string(),
        });
    }

    let status = ff_child.wait().await.map_err(|e| PreflightItem {
        code: "MOTION_LINT_ERRORS".to_string(),
        severity: RuleSeverity::Fail,
        message: format!("FFmpeg wait failed: {}", e),
        source: URL_REFUSAL.to_string(),
    })?;
    if !status.success() {
        let _ = tokio::fs::remove_file(&tmp_output).await;
        let msg = format_ffmpeg_failure_from_task(status, ff_stderr_task).await;
        return Err(PreflightItem {
            code: "MOTION_LINT_ERRORS".to_string(),
            severity: RuleSeverity::Fail,
            message: msg,
            source: URL_REFUSAL.to_string(),
        });
    }

    tokio::fs::rename(&tmp_output, &final_output)
        .await
        .map_err(|e| PreflightItem {
            code: "MOTION_LINT_ERRORS".to_string(),
            severity: RuleSeverity::Fail,
            message: format!("Failed moving staging output: {}", e),
            source: URL_REFUSAL.to_string(),
        })?;

    // Compare frame 0 source PNG against encoded video frame 0 via FFmpeg PSNR/SSIM
    let mut source_vs_encoded = None;
    if let Some(raw_png) = sample_frame0_png {
        let tmp_cmp = std::env::temp_dir().join(format!("aetheria_src_cmp_{}.png", now_ms()));
        if std::fs::write(&tmp_cmp, raw_png).is_ok() {
            let mut dec_cmd = std::process::Command::new(&ffmpeg_bin);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                dec_cmd.creation_flags(0x08000000);
            }
            let dec_png = std::env::temp_dir().join(format!("aetheria_dec_cmp_{}.png", now_ms()));
            let _ = dec_cmd
                .args(["-y", "-hide_banner", "-i"])
                .arg(&final_output)
                .args(["-frames:v", "1"])
                .arg(&dec_png)
                .output();
            if dec_png.is_file() {
                source_vs_encoded = compare_images_psnr_ssim(&ffmpeg_bin, &tmp_cmp, &dec_png).ok();
            }
            let _ = std::fs::remove_file(&dec_png);
            let _ = std::fs::remove_file(&tmp_cmp);
        }
    }

    let file_size_bytes = std::fs::metadata(&final_output).map(|m| m.len()).unwrap_or(0);
    let elapsed_ms = now_ms().saturating_sub(t0);

    Ok(MicrostockRenderOutput {
        staging_path: final_output.to_string_lossy().to_string(),
        filename: params.output_filename,
        width: params.target_width,
        height: params.target_height,
        fps: params.fps,
        total_frames,
        codec: params.codec,
        file_size_bytes,
        elapsed_ms,
        source_vs_encoded,
        upscale_check,
    })
}
