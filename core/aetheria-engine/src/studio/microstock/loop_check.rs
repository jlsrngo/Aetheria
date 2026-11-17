//! FFmpeg PSNR/SSIM frame comparator and CDP loop continuity inspector.

use super::adobe_profile::{RuleSeverity, URL_BEST_PRACTICES};
use super::manifest::PreflightItem;
use crate::paths::{detect_browser_executable, locate_ffmpeg_binary, now_ms};
use crate::studio::cdp_ws::CdpWebSocket;
use crate::studio::film_inspector::inspect_workspace_film;
use crate::studio::film_static_server::start_ephemeral_film_server;
use crate::studio::html_renderer::launch_headless_browser_with_cdp;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSimilarityMetrics {
    pub psnr_db: f64,
    pub ssim: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopCheckResult {
    pub seam_zero_vs_duration: FrameSimilarityMetrics,
    pub last_to_first: FrameSimilarityMetrics,
    pub adjacent_step_median: FrameSimilarityMetrics,
    pub min_seam_ssim_threshold: f64,
    pub max_psnr_drop_db_threshold: f64,
    pub is_discontinuous: bool,
    pub item: PreflightItem,
}

/// Parses `All:0.9942` (SSIM) and `average:42.15` / ` average:inf` (PSNR) from FFmpeg stderr.
pub fn parse_ffmpeg_psnr_ssim_stderr(stderr: &str) -> FrameSimilarityMetrics {
    let mut ssim = 0.0;
    let mut psnr_db = 0.0;

    for line in stderr.lines() {
        if line.contains("SSIM") {
            if let Some(pos) = line.find("All:") {
                let rest = &line[pos + 4..];
                let token: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect();
                if let Ok(val) = token.parse::<f64>() {
                    ssim = val;
                }
            }
        }
        if line.contains("PSNR") {
            if let Some(pos) = line.find("average:") {
                let rest = &line[pos + 8..];
                if rest.starts_with("inf") {
                    psnr_db = 99.0;
                } else {
                    let token: String = rest
                        .chars()
                        .take_while(|c| c.is_ascii_digit() || *c == '.')
                        .collect();
                    if let Ok(val) = token.parse::<f64>() {
                        psnr_db = val;
                    }
                }
            }
        }
    }

    FrameSimilarityMetrics { psnr_db, ssim }
}

/// Runs `ffmpeg -i a -i b -lavfi "[0:v][1:v]ssim;[0:v][1:v]psnr" -f null -` and returns PSNR/SSIM.
pub fn compare_images_psnr_ssim(
    ffmpeg_bin: &Path,
    img_a: &Path,
    img_b: &Path,
) -> Result<FrameSimilarityMetrics, String> {
    let mut cmd = std::process::Command::new(ffmpeg_bin);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd
        .args(["-hide_banner", "-i"])
        .arg(img_a)
        .arg("-i")
        .arg(img_b)
        .args(["-lavfi", "[0:v][1:v]ssim;[0:v][1:v]psnr", "-f", "null", "-"])
        .output()
        .map_err(|e| format!("Failed running FFmpeg ssim/psnr: {}", e))?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    Ok(parse_ffmpeg_psnr_ssim_stderr(&stderr))
}

async fn capture_png_at_time(cdp: &mut CdpWebSocket, t_sec: f64, dest: &Path) -> Result<(), String> {
    let expr = format!(
        "(() => {{ window.renderAt({:.6}); return new Promise(r => requestAnimationFrame(() => r(true))); }})()",
        t_sec
    );
    let _ = cdp
        .call("Runtime.evaluate", json!({ "expression": expr, "awaitPromise": true }))
        .await?;
    let shot = cdp
        .call("Page.captureScreenshot", json!({ "format": "png" }))
        .await?;
    let b64 = shot
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing PNG base64 from Page.captureScreenshot".to_string())?;
    let bytes = B64
        .decode(b64)
        .map_err(|e| format!("Invalid base64 PNG: {}", e))?;
    std::fs::write(dest, bytes).map_err(|e| format!("Failed writing frame PNG: {}", e))
}

/// Evaluates loop continuity at `renderAt(0)`, `renderAt(duration)`, and `renderAt(last_frame)` via CDP.
pub async fn check_project_loop_continuity(
    project_dir: &Path,
    ws_root: &Path,
    min_seam_ssim_threshold: f64,
    max_psnr_drop_db_threshold: f64,
) -> Result<LoopCheckResult, String> {
    let html_path = project_dir.join("index.html");
    if !html_path.is_file() {
        return Err("No index.html in project for loop check".to_string());
    }
    let browser_exe =
        detect_browser_executable().ok_or_else(|| "No headless browser found".to_string())?;
    let ffmpeg_bin = locate_ffmpeg_binary().ok_or_else(|| "FFmpeg not found".to_string())?;

    let meta = inspect_workspace_film(&html_path);
    let fps = meta.fps.max(1) as f64;
    let duration = meta.duration.max(1.0);
    let dt = 1.0 / fps;

    // Use half-res viewport (capped at 960x540) so loop check completes fast while preserving seam geometry.
    let probe_w = (meta.width / 2).max(320).min(960);
    let probe_h = (meta.height / 2).max(180).min(960);

    let (http_port, _srv) =
        start_ephemeral_film_server(project_dir.to_path_buf(), ws_root.to_path_buf()).await?;
    let (_chrome, mut cdp) =
        launch_headless_browser_with_cdp(&browser_exe, probe_w, probe_h).await?;
    let _ = cdp.call("Page.enable", json!({})).await?;
    let _ = cdp.call("Runtime.enable", json!({})).await?;
    let _ = cdp
        .call(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": meta.width,
                "height": meta.height,
                "deviceScaleFactor": (probe_w as f64) / (meta.width.max(1) as f64),
                "mobile": false
            }),
        )
        .await?;

    let target_url = format!("http://127.0.0.1:{}/index.html", http_port);
    let _ = cdp.call("Page.navigate", json!({ "url": target_url })).await?;

    // Wait for window.renderAt
    for _ in 0..60 {
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

    let tmp_dir = std::env::temp_dir().join(format!("aetheria_loop_{}", now_ms()));
    let _ = std::fs::create_dir_all(&tmp_dir);

    let f_zero = tmp_dir.join("f_zero.png");
    let f_step1 = tmp_dir.join("f_step1.png");
    let f_step2 = tmp_dir.join("f_step2.png");
    let f_last = tmp_dir.join("f_last.png");
    let f_dur = tmp_dir.join("f_dur.png");

    let res = async {
        capture_png_at_time(&mut cdp, 0.0, &f_zero).await?;
        capture_png_at_time(&mut cdp, dt, &f_step1).await?;
        capture_png_at_time(&mut cdp, dt * 2.0, &f_step2).await?;
        capture_png_at_time(&mut cdp, (duration - dt).max(0.0), &f_last).await?;
        capture_png_at_time(&mut cdp, duration, &f_dur).await?;

        let seam = compare_images_psnr_ssim(&ffmpeg_bin, &f_zero, &f_dur)?;
        let last_to_first = compare_images_psnr_ssim(&ffmpeg_bin, &f_last, &f_zero)?;
        let step_a = compare_images_psnr_ssim(&ffmpeg_bin, &f_zero, &f_step1)?;
        let step_b = compare_images_psnr_ssim(&ffmpeg_bin, &f_step1, &f_step2)?;
        let median_step = FrameSimilarityMetrics {
            psnr_db: (step_a.psnr_db + step_b.psnr_db) / 2.0,
            ssim: (step_a.ssim + step_b.ssim) / 2.0,
        };

        // Discontinuous if renderAt(0) vs renderAt(duration) drops below seam SSIM threshold
        // OR if last->first PSNR drops far below normal frame-to-frame motion step PSNR.
        let psnr_drop = median_step.psnr_db - last_to_first.psnr_db;
        let is_discontinuous = seam.ssim < min_seam_ssim_threshold
            || (psnr_drop > max_psnr_drop_db_threshold && last_to_first.ssim < 0.92);

        let item = if is_discontinuous {
            PreflightItem {
                code: "LOOP_DISCONTINUITY".to_string(),
                severity: RuleSeverity::Warn,
                message: format!(
                    "Loop boundary jump detected: seam(0 vs duration) SSIM={:.4} PSNR={:.2}dB (threshold SSIM>={:.2}); last->first SSIM={:.4} PSNR={:.2}dB vs step median PSNR={:.2}dB (drop {:.2}dB > {:.1}dB).",
                    seam.ssim,
                    seam.psnr_db,
                    min_seam_ssim_threshold,
                    last_to_first.ssim,
                    last_to_first.psnr_db,
                    median_step.psnr_db,
                    psnr_drop,
                    max_psnr_drop_db_threshold
                ),
                source: URL_BEST_PRACTICES.to_string(),
            }
        } else {
            PreflightItem {
                code: "LOOP_CONTINUITY_MEASURED".to_string(),
                severity: RuleSeverity::Info,
                message: format!(
                    "Loop boundary continuity within heuristic threshold: seam(0 vs duration) SSIM={:.4} PSNR={:.2}dB; last->first SSIM={:.4} PSNR={:.2}dB vs step median PSNR={:.2}dB.",
                    seam.ssim,
                    seam.psnr_db,
                    last_to_first.ssim,
                    last_to_first.psnr_db,
                    median_step.psnr_db
                ),
                source: URL_BEST_PRACTICES.to_string(),
            }
        };

        Ok(LoopCheckResult {
            seam_zero_vs_duration: seam,
            last_to_first,
            adjacent_step_median: median_step,
            min_seam_ssim_threshold,
            max_psnr_drop_db_threshold,
            is_discontinuous,
            item,
        })
    }
    .await;

    let _ = std::fs::remove_dir_all(&tmp_dir);
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_ssim_and_psnr_output() {
        let sample = "\
[Parsed_ssim_0 @ 000001] SSIM Y:0.998123 (27.26) U:0.999100 (30.45) V:0.999200 (30.96) All:0.998450 (28.09)\n\
[Parsed_psnr_1 @ 000001] PSNR y:44.12 u:48.90 v:49.10 average:45.34 min:41.20 max:50.10\n";
        let m = parse_ffmpeg_psnr_ssim_stderr(sample);
        assert!((m.ssim - 0.998450).abs() < 1e-6);
        assert!((m.psnr_db - 45.34).abs() < 1e-4);
    }
}
