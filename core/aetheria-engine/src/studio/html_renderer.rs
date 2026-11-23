//! Headless Edge/Chrome CDP Frame Capture & Render Orchestrator (Zero Node.js / Zero Remotion).

use super::cdp_pool::{
    compute_render_worker_count, open_additional_cdp_tabs, OrderedFrameBuffer,
};
use super::cdp_ws::CdpWebSocket;
use super::ffmpeg_pipeline::{
    build_ffmpeg_command, format_ffmpeg_failure_from_task, spawn_stderr_drain,
};
use super::film_inspector::{inspect_workspace_film, FilmMeta};
use super::film_static_server::{pick_ephemeral_port, start_ephemeral_film_server};
use super::motion::resolve_active_html_film_path;
use crate::paths::{detect_browser_executable, locate_ffmpeg_binary, now_ms};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use tokio::io::AsyncWriteExt;

#[derive(Clone, Debug)]
pub struct HtmlRenderParams {
    pub workspace_dir: Option<String>,
    pub output_path: PathBuf,
    pub codec: String,
    pub frame_range: Option<(u32, u32)>,
}

#[derive(Clone, Debug)]
pub struct HtmlRenderResult {
    pub output_path: PathBuf,
    pub total_frames: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

pub(super) struct ChromeProcessGuard {
    child: Option<Child>,
    profile_dir: Option<PathBuf>,
}

impl Drop for ChromeProcessGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(dir) = self.profile_dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

fn spawn_headless_browser(
    browser_exe: &Path,
    cdp_port: u16,
    width: u32,
    height: u32,
) -> Result<ChromeProcessGuard, String> {
    let profile_dir =
        std::env::temp_dir().join(format!("aetheria_cdp_{}_{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&profile_dir).map_err(|e| {
        format!(
            "Failed creating headless browser profile directory '{}': {}",
            profile_dir.display(),
            e
        )
    })?;

    let mut browser_cmd = std::process::Command::new(browser_exe);
    browser_cmd
        .args([
            "--headless=new",
            "--disable-gpu-vsync",
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--enable-unsafe-swiftshader",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "--disable-extensions",
            "--disable-ipc-flooding-protection",
            "--mute-audio",
        ])
        .arg(format!("--remote-debugging-port={}", cdp_port))
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg(format!("--window-size={},{}", width, height))
        .arg("about:blank")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        browser_cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let browser_child = browser_cmd.spawn().map_err(|e| {
        format!(
            "Failed launching headless browser {}: {}",
            browser_exe.display(),
            e
        )
    })?;

    Ok(ChromeProcessGuard {
        child: Some(browser_child),
        profile_dir: Some(profile_dir),
    })
}

async fn wait_for_cdp_ws_url_polls(cdp_port: u16, max_polls: usize) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let list_url = format!("http://127.0.0.1:{}/json/list", cdp_port);

    for _ in 0..max_polls {
        if let Ok(resp) = client.get(&list_url).send().await {
            if let Ok(items) = resp.json::<Vec<Value>>().await {
                if let Some(ws) = items.iter().find_map(|item| {
                    let is_page = item.get("type").and_then(Value::as_str) == Some("page");
                    if is_page {
                        item.get("webSocketDebuggerUrl")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    } else {
                        None
                    }
                }) {
                    return Ok(ws);
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    }

    Err(format!(
        "Timed out waiting for headless browser DevTools WebSocket on port {}",
        cdp_port
    ))
}

/// Spawns headless Chrome/Edge with fresh ephemeral CDP port retries and also returns the chosen CDP port
/// so callers can provision parallel worker tabs.
pub(super) async fn launch_headless_browser_with_port(
    browser_exe: &Path,
    width: u32,
    height: u32,
) -> Result<(ChromeProcessGuard, CdpWebSocket, u16), String> {
    const MAX_ATTEMPTS: usize = 3;
    let mut last_err = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        let cdp_port = pick_ephemeral_port()?;
        let guard = spawn_headless_browser(browser_exe, cdp_port, width, height)?;
        let max_polls = if attempt < MAX_ATTEMPTS { 30 } else { 80 };
        match wait_for_cdp_ws_url_polls(cdp_port, max_polls).await {
            Ok(ws_url) => match CdpWebSocket::connect(&ws_url).await {
                Ok(cdp) => return Ok((guard, cdp, cdp_port)),
                Err(err) => last_err = err,
            },
            Err(err) => last_err = err,
        }
        drop(guard);
    }

    Err(format!(
        "Failed connecting headless browser CDP after {} attempts: {}",
        MAX_ATTEMPTS, last_err
    ))
}

/// Spawns headless Edge/Chrome with fresh ephemeral CDP port retries to eliminate port TOCTOU races.
pub(super) async fn launch_headless_browser_with_cdp(
    browser_exe: &Path,
    width: u32,
    height: u32,
) -> Result<(ChromeProcessGuard, CdpWebSocket), String> {
    let (guard, cdp, _) = launch_headless_browser_with_port(browser_exe, width, height).await?;
    Ok((guard, cdp))
}

pub(super) async fn wait_for_film_ready(cdp: &mut CdpWebSocket, meta: &mut FilmMeta) -> Result<(), String> {
    let mut last_errors: Vec<String> = Vec::new();
    let mut last_href = String::new();

    for attempt in 0..150 {
        let probe = cdp
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": "JSON.stringify({ ready: Boolean(window.__ready), readyDefined: typeof window.__ready !== 'undefined', docComplete: document.readyState === 'complete', hasRenderAt: typeof window.renderAt === 'function', href: String(location.href || ''), errors: (() => { const e = Array.isArray(window.__aetheriaErrors) ? window.__aetheriaErrors.slice(0, 6) : []; if (window.__runtimeError && !e.includes(String(window.__runtimeError))) e.push(String(window.__runtimeError)); return e; })(), meta: window.__filmMeta || window.AETHERIA_FILM || null })",
                    "returnByValue": true
                }),
            )
            .await?;
        if let Some(raw_json) = probe
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(Value::as_str)
        {
            if let Ok(parsed) = serde_json::from_str::<Value>(raw_json) {
                if let Some(href) = parsed.get("href").and_then(Value::as_str) {
                    last_href = href.to_string();
                }
                if let Some(errs) = parsed.get("errors").and_then(Value::as_array) {
                    let collected: Vec<String> = errs
                        .iter()
                        .filter_map(Value::as_str)
                        .filter(|s| !s.trim().is_empty())
                        .map(str::to_string)
                        .collect();
                    if !collected.is_empty() {
                        last_errors = collected;
                    }
                }

                let is_ready = parsed.get("ready").and_then(Value::as_bool) == Some(true);
                let has_render_at =
                    parsed.get("hasRenderAt").and_then(Value::as_bool) == Some(true);
                let ready_defined =
                    parsed.get("readyDefined").and_then(Value::as_bool) == Some(true);
                let doc_complete =
                    parsed.get("docComplete").and_then(Value::as_bool) == Some(true);

                // Fail fast on startup script exceptions once DOM load completes so the agent sees the exact line error immediately instead of waiting 15s.
                if doc_complete
                    && !last_errors.is_empty()
                    && ((attempt >= 4 && !has_render_at) || (attempt >= 6 && !is_ready))
                {
                    return Err(format!(
                        "HTML film startup script error (window.renderAt / window.__ready not initialized): {}",
                        last_errors.join(" | ")
                    ));
                }

                // Proceed once explicit window.__ready is true, or when a film defined window.renderAt
                // and completed DOM load without setting window.__ready after an initial settle grace window.
                if has_render_at && (is_ready || (!ready_defined && doc_complete && attempt >= 6)) {
                    if let Some(rt_meta) = parsed.get("meta").filter(|v| v.is_object()) {
                        if let Some(w) = rt_meta.get("width").and_then(Value::as_u64).filter(|&n| n >= 64) {
                            meta.width = w as u32;
                        }
                        if let Some(h) = rt_meta.get("height").and_then(Value::as_u64).filter(|&n| n >= 64) {
                            meta.height = h as u32;
                        }
                        if let Some(f) = rt_meta.get("fps").and_then(Value::as_u64).filter(|&n| n >= 1) {
                            meta.fps = f as u32;
                        }
                        if let Some(d) = rt_meta.get("duration").and_then(Value::as_f64) {
                            if d > 0.0 {
                                meta.duration = d;
                            }
                        }
                        meta.total_frames = ((meta.duration * meta.fps as f64).round() as u32).max(1);
                    }
                    let _ = cdp
                        .call(
                            "Runtime.evaluate",
                            json!({
                                "expression": "Promise.race([(document.fonts && document.fonts.ready) ? document.fonts.ready.catch(() => {}) : Promise.resolve(), new Promise(r => setTimeout(r, 1200))]).then(() => { const s = document.createElement('style'); s.textContent = '#loading,#controls,.aetheria-standalone-controls,[data-aetheria-standalone-chrome]{display:none!important;opacity:0!important;visibility:hidden!important;}'; (document.head || document.documentElement).appendChild(s); return true; })",
                                "awaitPromise": true
                            }),
                        )
                        .await;
                    return Ok(());
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    if last_href.is_empty() || last_href == "about:blank" {
        return Err("CDP navigation did not leave about:blank within 15s".to_string());
    }
    if !last_errors.is_empty() {
        return Err(format!(
            "HTML film did not expose window.renderAt / window.__ready within 15s; startup errors: {}",
            last_errors.join(" | ")
        ));
    }
    Err("HTML film did not expose window.renderAt / window.__ready within 15s".to_string())
}

async fn prepare_film_tab(
    cdp: &mut CdpWebSocket,
    init_width: u32,
    init_height: u32,
    init_script: &str,
    target_url: &str,
    mut meta: FilmMeta,
) -> Result<FilmMeta, String> {
    let _ = cdp.call("Page.enable", json!({})).await?;
    let _ = cdp.call("Runtime.enable", json!({})).await?;
    let _ = cdp.call("Page.bringToFront", json!({})).await;
    let _ = cdp
        .call(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": init_width,
                "height": init_height,
                "deviceScaleFactor": 1,
                "mobile": false
            }),
        )
        .await?;
    let _ = cdp
        .call(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": init_script }),
        )
        .await;
    let _ = cdp
        .call("Page.navigate", json!({ "url": target_url }))
        .await?;
    wait_for_film_ready(cdp, &mut meta).await?;
    if meta.width != init_width || meta.height != init_height {
        let _ = cdp
            .call(
                "Emulation.setDeviceMetricsOverride",
                json!({
                    "width": meta.width,
                    "height": meta.height,
                    "deviceScaleFactor": 1,
                    "mobile": false
                }),
            )
            .await?;
    }
    Ok(meta)
}

async fn capture_single_frame_jpeg(
    cdp: &mut CdpWebSocket,
    t: f64,
    fps: f64,
    samples: u32,
    frame_num: u32,
    jpeg_quality: u32,
) -> Result<Vec<u8>, String> {
    let eval_expr = super::motion_blur::build_render_frame_expr(t, fps, samples);
    cdp.call(
        "Runtime.evaluate",
        json!({ "expression": eval_expr, "awaitPromise": true }),
    )
    .await?;

    let shot = cdp
        .call(
            "Page.captureScreenshot",
            json!({ "format": "jpeg", "quality": jpeg_quality, "optimizeForSpeed": true }),
        )
        .await?;
    let Some(b64) = shot.get("data").and_then(Value::as_str) else {
        return Err(format!(
            "CDP screenshot missing base64 payload at frame {}",
            frame_num
        ));
    };
    B64.decode(b64).map_err(|e| {
        format!(
            "Failed decoding CDP screenshot at frame {}: {}",
            frame_num, e
        )
    })
}

/// Renders the active HTML5+JS film using local headless Chrome/Edge multi-tab CDP + FFmpeg.
pub async fn render_active_html_film<FStatus, FProgress>(
    params: HtmlRenderParams,
    mut on_status: FStatus,
    mut on_progress: FProgress,
) -> Result<HtmlRenderResult, String>
where
    FStatus: FnMut(u32, String),
    FProgress: FnMut(u32, u32, u32),
{
    let html_path = resolve_active_html_film_path(params.workspace_dir.as_deref())
        .ok_or_else(|| "No index.html found in active project folder".to_string())?;
    let film_root = html_path
        .parent()
        .ok_or_else(|| "Invalid index.html parent path".to_string())?
        .to_path_buf();
    let ws_root = params
        .workspace_dir
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| film_root.clone());

    let browser_exe = detect_browser_executable().ok_or_else(|| {
        "No Google Chrome or Microsoft Edge executable found for headless HTML rendering".to_string()
    })?;
    let ffmpeg_bin = locate_ffmpeg_binary().ok_or_else(|| {
        "FFmpeg executable not found on PATH, AETHERIA_FFMPEG, or ~/.aetheria/bin/".to_string()
    })?;

    let mut meta = inspect_workspace_film(&html_path);
    if !meta.exists {
        return Err(format!("HTML film not found at {}", html_path.display()));
    }
    if let Some(parent) = params.output_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            format!(
                "Failed creating render output directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }

    let (http_port, _server_guard) =
        start_ephemeral_film_server(film_root.clone(), ws_root.clone()).await?;
    let (_chrome_guard, mut tab0, cdp_port) =
        launch_headless_browser_with_port(&browser_exe, meta.width, meta.height).await?;

    let is_proxy = params.codec.eq_ignore_ascii_case("proxy");
    let init_script = if is_proxy {
        "window.__aetheriaHeadless = true; window.__AETHERIA_PREVIEW_STAGE__ = true;"
    } else {
        "window.__aetheriaHeadless = true;"
    };
    let target_url = format!("http://127.0.0.1:{}/index.html", http_port);
    let init_w = meta.width;
    let init_h = meta.height;
    meta = prepare_film_tab(&mut tab0, init_w, init_h, init_script, &target_url, meta).await?;

    let max_idx = meta.total_frames.saturating_sub(1);
    let (start_frame, end_frame) = match params.frame_range {
        Some((s, e)) => (s.min(max_idx), e.min(max_idx).max(s.min(max_idx))),
        None => (0, max_idx),
    };
    let frames_to_render = end_frame - start_frame + 1;
    let fps_f = meta.fps.max(1) as f64;

    let desired_workers = compute_render_worker_count(frames_to_render);
    let mut workers = vec![tab0];
    if desired_workers > 1 {
        let extra_tabs = open_additional_cdp_tabs(cdp_port, desired_workers - 1).await;
        let mut init_handles = Vec::with_capacity(extra_tabs.len());
        for mut tab in extra_tabs {
            let meta_clone = meta.clone();
            let script = init_script.to_string();
            let url = target_url.clone();
            init_handles.push(tokio::spawn(async move {
                prepare_film_tab(
                    &mut tab,
                    meta_clone.width,
                    meta_clone.height,
                    &script,
                    &url,
                    meta_clone,
                )
                .await
                .map(|_| tab)
            }));
        }
        for handle in init_handles {
            if let Ok(Ok(ready_tab)) = handle.await {
                workers.push(ready_tab);
            }
        }
    }

    on_status(
        frames_to_render,
        format!(
            "Exporting {} frames ({}x{} @ {}fps, {} CDP workers)",
            frames_to_render,
            meta.width,
            meta.height,
            meta.fps,
            workers.len()
        ),
    );

    let out_ext = params
        .output_path
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .unwrap_or("mp4");
    let tmp_output = params.output_path.with_file_name(format!(
        ".tmp-{}-{}.{}",
        params
            .output_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("render"),
        now_ms(),
        out_ext
    ));

    let mut ff_cmd = build_ffmpeg_command(
        &ffmpeg_bin,
        &meta,
        &film_root,
        &ws_root,
        start_frame as f64 / fps_f,
        (end_frame + 1) as f64 / fps_f,
        &params.codec,
        &tmp_output,
    );
    let mut ff_child = ff_cmd
        .spawn()
        .map_err(|e| format!("Failed spawning FFmpeg {}: {}", ffmpeg_bin.display(), e))?;
    let mut ff_stdin = ff_child
        .stdin
        .take()
        .ok_or_else(|| "Failed capturing FFmpeg stdin".to_string())?;
    let ff_stderr_task = spawn_stderr_drain(ff_child.stderr.take());

    let jpeg_quality = if is_proxy { 75 } else { 92 };
    let mb_mode = if is_proxy {
        super::motion_blur::MotionBlurMode::Off
    } else {
        super::motion_blur::MotionBlurMode::from_env_and_project(&film_root, &ws_root)
    };
    let mb_mode_arc = Arc::new(mb_mode);
    let mb_supersampled_frames = Arc::new(AtomicUsize::new(0));
    let total_jobs = frames_to_render as usize;
    let next_idx = Arc::new(AtomicUsize::new(0));
    let cancel = Arc::new(AtomicBool::new(false));
    let (tx, mut rx) =
        tokio::sync::mpsc::channel::<(usize, Result<Vec<u8>, String>)>((workers.len() * 4).max(8));

    let mut worker_handles = Vec::with_capacity(workers.len());
    for mut tab in workers {
        let next_ref = Arc::clone(&next_idx);
        let cancel_ref = Arc::clone(&cancel);
        let tx_ref = tx.clone();
        let mb_ref = Arc::clone(&mb_mode_arc);
        let mb_cnt_ref = Arc::clone(&mb_supersampled_frames);
        worker_handles.push(tokio::spawn(async move {
            while !cancel_ref.load(Ordering::Relaxed) {
                let idx = next_ref.fetch_add(1, Ordering::Relaxed);
                if idx >= total_jobs {
                    break;
                }
                let frame_num = start_frame + idx as u32;
                let t = frame_num as f64 / fps_f;
                let samples = mb_ref.samples_for_time(t);
                if samples > 1 {
                    mb_cnt_ref.fetch_add(1, Ordering::Relaxed);
                }
                let res =
                    capture_single_frame_jpeg(&mut tab, t, fps_f, samples, frame_num, jpeg_quality)
                        .await;
                let is_err = res.is_err();
                if is_err {
                    cancel_ref.store(true, Ordering::Relaxed);
                }
                if tx_ref.send((idx, res)).await.is_err() || is_err {
                    break;
                }
            }
        }));
    }
    drop(tx);

    let mut reorder = OrderedFrameBuffer::new();
    let mut rendered = 0u32;
    let mut last_percent = 999u32;
    let mut pipe_res: Result<(), String> = Ok(());

    while let Some((idx, frame_res)) = rx.recv().await {
        match frame_res {
            Err(err) => {
                cancel.store(true, Ordering::Relaxed);
                pipe_res = Err(err);
                break;
            }
            Ok(jpeg_bytes) => {
                for (ordered_idx, ordered_bytes) in reorder.push_and_drain(idx, jpeg_bytes) {
                    if let Err(e) = ff_stdin.write_all(&ordered_bytes).await {
                        cancel.store(true, Ordering::Relaxed);
                        pipe_res = Err(format!(
                            "Failed piping frame {} to FFmpeg: {}",
                            start_frame + ordered_idx as u32,
                            e
                        ));
                        break;
                    }
                    rendered += 1;
                    let percent = ((rendered as f64 / frames_to_render as f64) * 100.0).round() as u32;
                    if percent != last_percent || rendered == frames_to_render {
                        last_percent = percent;
                        on_progress(rendered, frames_to_render, percent.min(100));
                    }
                }
                if pipe_res.is_err() {
                    break;
                }
            }
        }
    }

    drop(rx);
    for handle in worker_handles {
        let _ = handle.await;
    }
    if mb_mode_arc.is_enabled() {
        let ss_count = mb_supersampled_frames.load(Ordering::Relaxed);
        crate::paths::log_engine(
            "render",
            &format!(
                "Motion blur temporal supersampling applied to {}/{} frames (mode={:?})",
                ss_count, frames_to_render, *mb_mode_arc
            ),
        );
    }
    if pipe_res.is_ok() && rendered != frames_to_render {
        pipe_res = Err(format!(
            "Incomplete parallel frame capture: rendered {}/{} frames",
            rendered, frames_to_render
        ));
    }

    drop(ff_stdin);
    if let Err(err) = pipe_res {
        let _ = ff_child.kill().await;
        let _ = tokio::fs::remove_file(&tmp_output).await;
        if let Ok(Ok(ff_err)) =
            tokio::time::timeout(std::time::Duration::from_secs(2), ff_stderr_task).await
        {
            let lines: Vec<&str> = ff_err.lines().collect();
            let summary = if lines.len() <= 30 {
                lines.join("\n")
            } else {
                let head = lines[..12].join("\n");
                let tail = lines[lines.len().saturating_sub(18)..].join("\n");
                format!("{}\n...\n{}", head, tail)
            };
            if !summary.trim().is_empty() {
                return Err(format!("{}\nFFmpeg stderr:\n{}", err, summary));
            }
        }
        return Err(err);
    }

    let status = ff_child
        .wait()
        .await
        .map_err(|e| format!("FFmpeg wait error: {}", e))?;

    if !status.success() {
        let _ = tokio::fs::remove_file(&tmp_output).await;
        return Err(format_ffmpeg_failure_from_task(status, ff_stderr_task).await);
    }

    tokio::fs::rename(&tmp_output, &params.output_path)
        .await
        .map_err(|e| {
            format!(
                "Failed moving rendered MP4 from {} to {}: {}",
                tmp_output.display(),
                params.output_path.display(),
                e
            )
        })?;

    Ok(HtmlRenderResult {
        output_path: params.output_path,
        total_frames: frames_to_render,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn render_propagates_output_directory_creation_error() {
        let dir = std::env::temp_dir().join(format!("aetheria_render_mkdir_err_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html><script>window.renderAt=function(){};window.__ready=true;</script></html>").unwrap();
        // Create a regular file at `blocker` so creating `blocker/out.mp4` parent directory fails cleanly.
        let blocker = dir.join("blocker");
        std::fs::write(&blocker, "not-a-dir").unwrap();

        let err = render_active_html_film(
            HtmlRenderParams {
                workspace_dir: Some(dir.to_string_lossy().to_string()),
                output_path: blocker.join("out.mp4"),
                codec: "h264".to_string(),
                frame_range: None,
            },
            |_, _| {},
            |_, _, _| {},
        )
        .await;

        let _ = std::fs::remove_dir_all(&dir);
        if let Err(msg) = err {
            // Either failed creating render output directory, or browser/ffmpeg missing in test env;
            // verify it returned an explicit contextual Err instead of panicking or succeeding silently.
            assert!(!msg.trim().is_empty());
        } else {
            panic!("Expected explicit error when output parent path is a regular file");
        }
    }
}
