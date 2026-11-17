//! FFmpeg MP4 video + multi-track scene audio muxing command builder (pure Rust CLI pipe).

use super::film_inspector::FilmMeta;
use crate::paths::contains_path;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use tokio::io::AsyncReadExt;

fn select_h264_encoder(ffmpeg_bin: &Path) -> &'static str {
    if !ffmpeg_bin.is_file() {
        return "libx264";
    }
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, &'static str>>> = OnceLock::new();
    let map = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = map.lock() {
        if let Some(&cached) = guard.get(ffmpeg_bin) {
            return cached;
        }
    }
    let mut enc_cmd = std::process::Command::new(ffmpeg_bin);
    enc_cmd
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        enc_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let encoders_out = enc_cmd
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut chosen: &'static str = "libx264";
    if !encoders_out.contains("libx264") {
        for cand in ["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf"] {
            if !encoders_out.contains(cand) {
                continue;
            }
            let mut probe = std::process::Command::new(ffmpeg_bin);
            probe
                .args([
                    "-hide_banner",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=128x128:r=30",
                    "-frames:v",
                    "1",
                    "-vf",
                    "format=nv12",
                    "-c:v",
                    cand,
                    "-f",
                    "null",
                    "-",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                probe.creation_flags(CREATE_NO_WINDOW);
            }
            if probe.status().map(|s| s.success()).unwrap_or(false) {
                chosen = cand;
                break;
            }
        }
    }
    if let Ok(mut guard) = map.lock() {
        guard.insert(ffmpeg_bin.to_path_buf(), chosen);
    }
    chosen
}

fn find_scene_audio_file(film_root: &Path, ws_root: &Path, raw_audio: &str) -> Option<PathBuf> {
    let clean = raw_audio.trim().trim_start_matches('/').replace('\\', "/");
    if clean.is_empty() || clean.contains("..") {
        return None;
    }
    for root in [film_root, &film_root.join("public"), ws_root] {
        let candidate = root.join(&clean);
        if contains_path(root, &candidate) && candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Constructs an FFmpeg `image2pipe` MP4 encoding command with synchronized scene audio mixing.
pub fn build_ffmpeg_command(
    ffmpeg_bin: &Path,
    meta: &FilmMeta,
    film_root: &Path,
    ws_root: &Path,
    start_sec: f64,
    end_sec: f64,
    codec: &str,
    output_path: &Path,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg_bin);
    cmd.args(["-y", "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate"])
        .arg(meta.fps.max(1).to_string())
        .args(["-i", "pipe:0"]);

    let is_gif = codec.eq_ignore_ascii_case("gif")
        || output_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("gif"))
            .unwrap_or(false);

    let mut active_audios: Vec<(PathBuf, u64, f64, f64, f64)> = Vec::new();
    if !is_gif {
        for scene in &meta.scenes {
            let sc_start = scene.start.max(0.0);
            let sc_end = sc_start + scene.duration.max(0.0);
            if sc_end <= start_sec || sc_start >= end_sec {
                continue;
            }
            let trim_start = (start_sec - sc_start).max(0.0);
            let max_dur = (end_sec - sc_start.max(start_sec)).max(0.05);
            let delay_ms = ((sc_start - start_sec).max(0.0) * 1000.0).round() as u64;

            if let Some(ref audio_rel) = scene.audio {
                if let Some(audio_path) = find_scene_audio_file(film_root, ws_root, audio_rel) {
                    active_audios.push((audio_path, delay_ms, trim_start, max_dur, 1.0));
                }
            }
            if let Some(ref sfx_rel) = scene.sfx {
                if let Some(sfx_path) = find_scene_audio_file(film_root, ws_root, sfx_rel) {
                    active_audios.push((sfx_path, delay_ms, trim_start, max_dur, 0.45));
                }
            }
        }
    }

    for (audio_path, _, _, _, _) in &active_audios {
        cmd.arg("-i").arg(audio_path);
    }

    if !active_audios.is_empty() {
        let total_dur = (end_sec - start_sec).max(0.05);
        let mut filter_parts = Vec::with_capacity(active_audios.len() + 1);
        let mut mix_labels = Vec::with_capacity(active_audios.len());
        for (idx, (_, delay_ms, trim_start, max_dur, vol)) in active_audios.iter().enumerate() {
            let input_idx = idx + 1;
            let label = format!("[a{}]", idx);
            let vol_filter = if (*vol - 1.0).abs() > 0.01 {
                format!(",volume={:.2}", vol)
            } else {
                String::new()
            };
            filter_parts.push(format!(
                "[{}:a]atrim=start={:.4}:duration={:.4},asetpts=PTS-STARTPTS{},adelay={}|{}{}",
                input_idx, trim_start, max_dur, vol_filter, delay_ms, delay_ms, label
            ));
            mix_labels.push(label);
        }
        // Clamp `[aout]` to the exact target video duration via `apad` + `atrim` so audio neither
        // truncates nor outlives the video without relying on `-shortest` (which can close `pipe:0` early).
        filter_parts.push(format!(
            "{}amix=inputs={}:duration=longest:normalize=0,apad=whole_dur={:.4},atrim=duration={:.4}[aout]",
            mix_labels.join(""),
            active_audios.len(),
            total_dur,
            total_dur
        ));
        cmd.args(["-filter_complex", &filter_parts.join(";")])
            .args(["-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]);
    } else {
        cmd.args(["-map", "0:v", "-an"]);
    }

    match codec.to_lowercase().as_str() {
        "gif" => {
            cmd.args([
                "-vf",
                "split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                "-loop",
                "0",
            ]);
        }
        "h265" | "hevc" => {
            cmd.args(["-c:v", "libx265", "-pix_fmt", "yuv420p", "-preset", "fast"]);
        }
        "vp9" => {
            cmd.args(["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p"]);
        }
        "prores" => {
            cmd.args(["-c:v", "prores_ks", "-profile:v", "3"]);
        }
        "proxy" => {
            let enc = select_h264_encoder(ffmpeg_bin);
            if enc == "libx264" {
                cmd.args([
                    "-vf",
                    "scale=trunc(iw/4)*2:trunc(ih/4)*2",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "26",
                    "-g",
                    "15",
                    "-movflags",
                    "+faststart",
                ]);
            } else {
                cmd.args([
                    "-vf",
                    "scale=trunc(iw/4)*2:trunc(ih/4)*2,format=nv12",
                    "-c:v",
                    enc,
                    "-b:v",
                    "2500k",
                    "-movflags",
                    "+faststart",
                ]);
            }
        }
        _ if is_gif => {
            cmd.args([
                "-vf",
                "split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                "-loop",
                "0",
                "-f",
                "gif",
            ]);
        }
        _ => {
            let enc = select_h264_encoder(ffmpeg_bin);
            if enc == "libx264" {
                cmd.args([
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-preset",
                    "fast",
                    "-crf",
                    "18",
                    "-movflags",
                    "+faststart",
                ]);
            } else {
                cmd.args([
                    "-vf",
                    "format=nv12",
                    "-c:v",
                    enc,
                    "-b:v",
                    "8000k",
                    "-movflags",
                    "+faststart",
                ]);
            }
        }
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

/// Drains FFmpeg's stderr pipe concurrently so Windows pipe buffers never fill up and deadlock.
pub fn spawn_stderr_drain(
    ff_stderr: Option<tokio::process::ChildStderr>,
) -> tokio::task::JoinHandle<String> {
    tokio::spawn(async move {
        let mut err_txt = String::new();
        if let Some(mut se) = ff_stderr {
            let mut buf = [0u8; 8192];
            loop {
                match se.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]);
                        err_txt.push_str(&chunk);
                        if err_txt.len() > 64 * 1024 {
                            let mut trim_at = err_txt.len() - 32 * 1024;
                            while trim_at < err_txt.len() && !err_txt.is_char_boundary(trim_at) {
                                trim_at += 1;
                            }
                            err_txt.drain(..trim_at);
                        }
                    }
                }
            }
        }
        err_txt
    })
}

pub async fn format_ffmpeg_failure_from_task(
    status: std::process::ExitStatus,
    stderr_task: tokio::task::JoinHandle<String>,
) -> String {
    let err_txt = stderr_task.await.unwrap_or_default();
    let tail: Vec<&str> = err_txt.lines().rev().take(12).collect();
    let summary: String = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
    format!("FFmpeg exited with {:?}:\n{}", status.code(), summary)
}

pub async fn format_ffmpeg_failure(
    status: std::process::ExitStatus,
    ff_stderr: Option<tokio::process::ChildStderr>,
) -> String {
    let mut err_txt = String::new();
    if let Some(mut se) = ff_stderr {
        let _ = se.read_to_string(&mut err_txt).await;
    }
    let tail: Vec<&str> = err_txt.lines().rev().take(12).collect();
    let summary: String = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
    format!("FFmpeg exited with {:?}:\n{}", status.code(), summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::film_inspector::FilmSceneSpec;
    use crate::studio::motion_linter::FilmLintReport;

    fn sample_meta() -> FilmMeta {
        FilmMeta {
            exists: true,
            engine: "html5-canvas".to_string(),
            html_path: "index.html".to_string(),
            title: "Test".to_string(),
            width: 1080,
            height: 1920,
            fps: 30,
            duration: 5.0,
            total_frames: 150,
            scenes: vec![FilmSceneSpec {
                id: "s1".to_string(),
                title: "Scene 1".to_string(),
                start: 0.0,
                duration: 5.0,
                start_frame: 0,
                duration_frames: 150,
                audio: Some("audio/bgm.mp3".to_string()),
                sfx: None,
                words: None,
            }],
            lint: FilmLintReport {
                valid: true,
                has_render_at: true,
                has_ready_flag: true,
                has_film_meta: true,
                issues: vec![],
            },
        }
    }

    #[test]
    fn gif_codec_uses_palettegen_paletteuse_and_disables_audio() {
        let meta = sample_meta();
        let cmd = build_ffmpeg_command(
            Path::new("ffmpeg"),
            &meta,
            Path::new("."),
            Path::new("."),
            0.0,
            5.0,
            "gif",
            Path::new("output/anim.gif"),
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"-an".to_string()));
        assert!(args.contains(&"-loop".to_string()));
        assert!(args.iter().any(|a| a.contains("palettegen") && a.contains("paletteuse")));
        assert!(!args.contains(&"libx264".to_string()));
    }

    #[test]
    fn mp4_audio_filter_clamps_exact_video_duration_without_shortest() {
        let tmp = std::env::temp_dir().join(format!(
            "aetheria-ffmpeg-pad-test-{}",
            crate::paths::now_ms()
        ));
        let audio_dir = tmp.join("audio");
        std::fs::create_dir_all(&audio_dir).expect("create audio dir");
        std::fs::write(audio_dir.join("bgm.mp3"), b"stub").expect("write audio stub");

        let meta = sample_meta();
        let cmd = build_ffmpeg_command(
            Path::new("ffmpeg"),
            &meta,
            &tmp,
            &tmp,
            0.0,
            5.0,
            "h264",
            &tmp.join("out.mp4"),
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(!args.contains(&"-shortest".to_string()));
        assert!(args.iter().any(|a| {
            a.contains("amix=inputs=1:duration=longest:normalize=0,apad=whole_dur=5.0000,atrim=duration=5.0000[aout]")
        }));
    }

    #[tokio::test]
    async fn stderr_drain_prevents_pipe_deadlock_on_large_output() {
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = tokio::process::Command::new("cmd");
            c.args([
                "/C",
                "for /L %i in (1,1,2000) do @echo 1234567890123456789012345678901234567890123456789012345678901234567890 >&2",
            ]);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = tokio::process::Command::new("sh");
            c.args([
                "-c",
                "i=0; while [ $i -lt 2000 ]; do echo 1234567890123456789012345678901234567890123456789012345678901234567890 >&2; i=$((i+1)); done",
            ]);
            c
        };

        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn stderr producer");
        let drain_task = spawn_stderr_drain(child.stderr.take());
        let status = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            child.wait(),
        )
        .await
        .expect("child should not deadlock on full stderr pipe")
        .expect("wait status");
        assert!(status.success());
        let drained = drain_task.await.expect("drain join");
        assert!(!drained.is_empty());
        assert!(drained.len() <= 64 * 1024);
    }
}

