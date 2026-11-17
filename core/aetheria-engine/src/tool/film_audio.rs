//! Deterministic Film Audio & Timing Tool (`film_audio`).
//!
//! Synthesizes per-scene voiceovers (`voicebox_engine.py`) and optional SFX cues (`sfx_engine.py`)
//! into `audio/<id>.wav` + `audio/<id>.words.json`, derives exact scene durations from final WAV
//! durations (`max(minScene, wavDuration + buffer)`), enforces zero audio-scene overlap/truncation,
//! and updates `film.json` (+ managed `index.html`).

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tokio::process::Command;

use crate::paths::{contains_path, project_root};
use crate::session::message::emit_event;
use crate::studio::microstock::active_microstock_lock;
use crate::studio::project_registry::{
    create_studio_project, resolve_active_project_or_film_root, PROJECTS_DIR_NAME,
};

use super::film_scaffold::{render_managed_index_html, FilmManifestJson, FilmManifestScene};
use super::path_guard::resolve_isolated_path;

pub const DEFAULT_AUDIO_BUFFER_SEC: f64 = 0.6;
pub const DEFAULT_MIN_SCENE_SEC: f64 = 0.0;
pub const DEFAULT_DURATION_WARN_TOL_SEC: f64 = 2.0;

pub fn film_audio_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "film_audio",
            "description": "Synthesizes per-scene voiceover audio (`audio/<id>.wav` + `audio/<id>.words.json`) and optional scene SFX cues, automatically computes `duration = max(minScene, wavDuration + buffer)` from the final WAV duration (default buffer 0.6s), validates zero scene audio overlap, and updates `film.json` + managed `index.html`. Use this directly from the coordinator for narrated videos instead of manual `words.json` duration math.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scenes": {
                        "type": "array",
                        "description": "Ordered scene narration specs.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string", "description": "Scene ID matching `film.json` / `AM.registerScene`." },
                                "narration": { "type": "string", "description": "Clean subtitle/display narration text." },
                                "spokenText": { "type": "string", "description": "Optional phonetic override for foreign names or unmapped acronyms." },
                                "voice": { "type": "string", "description": "Optional voice override (e.g. 'aetheria', 'id-ID-ArdiNeural', 'af_heart')." },
                                "style": { "type": "string", "description": "Optional delivery style ('default', 'energetic', 'mystery', 'casual', 'serious', 'horror', 'crime_conspiracy')." },
                                "lang": { "type": "string", "enum": ["id", "en"] },
                                "engine": { "type": "string", "enum": ["auto", "voxcpm", "edge", "kokoro"] },
                                "accent": { "type": "string", "description": "Optional hex accent color when initializing new scenes." },
                                "title": { "type": "string" },
                                "sfxCues": {
                                    "type": "array",
                                    "description": "Optional SFX cues (`{ type: 'whoosh'|'pop'|'impact'|'chime'|'riser'|'typewriter', time?: sec, frame?: n, volume?: 0..1 }` or shorthand cue name).",
                                    "items": {}
                                }
                            },
                            "required": ["id", "narration"]
                        }
                    },
                    "buffer": {
                        "type": "number",
                        "description": "Breathing buffer seconds added after final WAV duration (default 0.6)."
                    },
                    "minScene": {
                        "type": "number",
                        "description": "Optional minimum scene duration floor in seconds (default 0.0)."
                    },
                    "fps": {
                        "type": "integer",
                        "description": "FPS for frame-based SFX cues (default 30)."
                    },
                    "voice": { "type": "string", "description": "Default narrator voice for all scenes." },
                    "style": { "type": "string", "description": "Default delivery style for preset voices." },
                    "lang": { "type": "string", "enum": ["id", "en"] },
                    "engine": { "type": "string", "enum": ["auto", "voxcpm", "edge", "kokoro"] },
                    "lexicon": { "type": "string", "description": "Optional relative path to custom pronunciation lexicon JSON inside project." },
                    "resetVoiceLock": { "type": "boolean" },
                    "durationTolerance": {
                        "type": "number",
                        "description": "Excess dead-air warning threshold in seconds above WAV duration (default 2.0)."
                    }
                },
                "required": ["scenes"]
            }
        }
    })
}

fn sanitize_id(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Parses exact duration in seconds from a RIFF WAV file header (`fmt ` + `data` chunks).
pub(crate) fn read_wav_duration_secs(wav_path: &Path) -> Result<f64, String> {
    let bytes = std::fs::read(wav_path)
        .map_err(|e| format!("Failed reading WAV '{}': {}", wav_path.display(), e))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(format!("Invalid RIFF/WAVE header in '{}'", wav_path.display()));
    }
    let mut offset = 12usize;
    let mut byte_rate: Option<u32> = None;
    let mut data_bytes: Option<u32> = None;

    while offset + 8 <= bytes.len() {
        let chunk_id = &bytes[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let payload_start = offset + 8;
        let payload_end = payload_start.saturating_add(chunk_size).min(bytes.len());

        if chunk_id == b"fmt " && payload_end - payload_start >= 16 {
            let sr = u32::from_le_bytes([
                bytes[payload_start + 4],
                bytes[payload_start + 5],
                bytes[payload_start + 6],
                bytes[payload_start + 7],
            ]);
            let br = u32::from_le_bytes([
                bytes[payload_start + 8],
                bytes[payload_start + 9],
                bytes[payload_start + 10],
                bytes[payload_start + 11],
            ]);
            let channels = u16::from_le_bytes([bytes[payload_start + 2], bytes[payload_start + 3]]);
            let bits = u16::from_le_bytes([bytes[payload_start + 14], bytes[payload_start + 15]]);
            let computed = sr
                .saturating_mul(channels as u32)
                .saturating_mul((bits as u32).max(8) / 8);
            byte_rate = Some(if br > 0 { br } else { computed });
        } else if chunk_id == b"data" {
            data_bytes = Some((payload_end - payload_start) as u32);
            break;
        }

        let padded = chunk_size + (chunk_size % 2);
        offset = payload_start.saturating_add(padded);
    }

    match (byte_rate, data_bytes) {
        (Some(br), Some(db)) if br > 0 => Ok(db as f64 / br as f64),
        _ => Err(format!(
            "Missing fmt/data chunk or zero byte_rate in WAV '{}'",
            wav_path.display()
        )),
    }
}

pub(crate) fn read_words_duration_secs(words_path: &Path) -> Option<f64> {
    let raw = std::fs::read_to_string(words_path).ok()?;
    let val: Value = serde_json::from_str(&raw).ok()?;
    val.get("duration")
        .and_then(|v| v.as_f64())
        .filter(|d| d.is_finite() && *d > 0.0)
}

fn resolve_film_asset(film_dir: &Path, rel: &str) -> Option<PathBuf> {
    let clean = rel.trim().trim_start_matches('/').replace('\\', "/");
    if clean.is_empty() || clean.contains("..") {
        return None;
    }
    let cand = film_dir.join(&clean);
    if contains_path(film_dir, &cand) && cand.is_file() {
        return Some(cand);
    }
    None
}

/// Resolves authoritative final WAV duration from `.words.json["duration"]` and/or the `.wav` file itself.
/// Never computes duration from `words[-1].end`.
pub(crate) fn resolve_final_audio_duration(
    film_dir: &Path,
    words_rel: Option<&str>,
    audio_rel: Option<&str>,
) -> Result<f64, String> {
    let wav_path = audio_rel.and_then(|r| resolve_film_asset(film_dir, r)).or_else(|| {
        words_rel
            .and_then(|r| resolve_film_asset(film_dir, r))
            .and_then(|wp| {
                let s = wp.to_string_lossy();
                s.strip_suffix(".words.json")
                    .map(|base| PathBuf::from(format!("{}.wav", base)))
                    .filter(|p| p.is_file())
            })
    });
    let words_path = words_rel.and_then(|r| resolve_film_asset(film_dir, r)).or_else(|| {
        wav_path
            .as_ref()
            .map(|p| p.with_extension("words.json"))
            .filter(|p| p.is_file())
    });

    if let Some(ref wp) = wav_path {
        let wav_dur = read_wav_duration_secs(wp)?;
        if let Some(wjson_dur) = words_path.as_deref().and_then(read_words_duration_secs) {
            return Ok(wav_dur.max(wjson_dur));
        }
        return Ok(wav_dur);
    }
    if let Some(ref wjp) = words_path {
        if let Some(wjson_dur) = read_words_duration_secs(wjp) {
            return Ok(wjson_dur);
        }
        return Err(format!(
            "Word timing file '{}' has no valid numeric 'duration' field and matching WAV is missing.",
            wjp.display()
        ));
    }
    Err("No existing WAV audio or .words.json file found to derive duration.".to_string())
}

/// Enforces that no scene's duration is shorter than its final WAV audio (preventing export overlap)
/// and emits non-fatal warnings when dead air after WAV exceeds `warn_tolerance`.
pub(crate) fn validate_scenes_audio_durations(
    film_dir: &Path,
    scenes: &[FilmManifestScene],
    warn_tolerance: f64,
) -> Result<Vec<Value>, Value> {
    let mut warnings = Vec::new();
    let tol = if warn_tolerance.is_finite() && warn_tolerance >= 0.0 {
        warn_tolerance
    } else {
        DEFAULT_DURATION_WARN_TOL_SEC
    };

    for sc in scenes {
        if sc.audio.is_none() && sc.words.is_none() {
            continue;
        }
        let wav_rel = match sc.audio.as_deref() {
            Some(a) => a,
            None => continue,
        };
        let Some(wav_path) = resolve_film_asset(film_dir, wav_rel) else {
            return Err(json!({
                "ok": false,
                "code": "MISSING_SCENE_AUDIO_FILE",
                "sceneId": sc.id,
                "error": format!("Scene '{}' declares audio '{}' which does not exist in film folder.", sc.id, wav_rel)
            }));
        };
        let wav_dur = read_wav_duration_secs(&wav_path).map_err(|e| {
            json!({
                "ok": false,
                "code": "INVALID_SCENE_AUDIO_WAV",
                "sceneId": sc.id,
                "error": e
            })
        })?;
        let final_wav_dur = sc
            .words
            .as_deref()
            .and_then(|w| resolve_film_asset(film_dir, w))
            .and_then(|wp| read_words_duration_secs(&wp))
            .map(|wd| wav_dur.max(wd))
            .unwrap_or(wav_dur);

        if sc.duration + 0.005 < final_wav_dur {
            let shortfall = final_wav_dur - sc.duration;
            return Err(json!({
                "ok": false,
                "code": "AUDIO_LONGER_THAN_SCENE",
                "sceneId": sc.id,
                "sceneDuration": round3(sc.duration),
                "wavDuration": round3(final_wav_dur),
                "shortfallSec": round3(shortfall),
                "error": format!(
                    "Scene '{}' duration ({:.3}s) is {:.3}s shorter than WAV duration ({:.3}s); narration would overlap or clip into the next scene during export. Set duration >= {:.3}s or run film_audio.",
                    sc.id, sc.duration, shortfall, final_wav_dur, final_wav_dur
                )
            }));
        }

        let excess = sc.duration - final_wav_dur;
        if excess > tol {
            warnings.push(json!({
                "code": "AUDIO_SCENE_TOO_LONG",
                "sceneId": sc.id,
                "sceneDuration": round3(sc.duration),
                "wavDuration": round3(final_wav_dur),
                "excessPauseSec": round3(excess),
                "message": format!(
                    "Scene '{}' duration ({:.3}s) exceeds WAV duration ({:.3}s) by {:.3}s (empty pause > {:.1}s tolerance).",
                    sc.id, sc.duration, final_wav_dur, excess, tol
                )
            }));
        }
    }

    Ok(warnings)
}

fn resolve_target_film_dir(ws_root: &Path, title: &str) -> Result<PathBuf, String> {
    let projects_root = ws_root.join(PROJECTS_DIR_NAME);
    if let Some(active) = resolve_active_project_or_film_root(ws_root) {
        if active != ws_root && active.starts_with(&projects_root) && contains_path(ws_root, &active)
        {
            return Ok(active);
        }
    }
    let created = create_studio_project(ws_root, title)?;
    let dir = projects_root.join(&created.id);
    if !contains_path(ws_root, &dir) {
        return Err("Film audio project path escaped workspace root.".to_string());
    }
    Ok(dir)
}

fn resolve_isolated_lexicon(
    ws_root: &Path,
    film_dir: &Path,
    explicit: Option<&str>,
    workspace_dir: &str,
) -> Option<PathBuf> {
    if let Some(raw) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(resolved) = resolve_isolated_path(workspace_dir, raw) {
            if resolved.is_file() {
                return Some(resolved);
            }
        }
    }
    for cand in [
        film_dir.join("pronunciation_lexicon.json"),
        film_dir.join(".aetheria").join("pronunciation_lexicon.json"),
        ws_root.join(".aetheria").join("pronunciation_lexicon.json"),
        ws_root.join("pronunciation_lexicon.json"),
    ] {
        if contains_path(ws_root, &cand) && cand.is_file() {
            return Some(cand);
        }
    }
    None
}

async fn synthesize_scene_sfx(
    sfx_wav_path: &Path,
    sfx_json_path: &Path,
    cues: &[Value],
    duration_sec: f64,
    fps: u32,
) -> Result<(), String> {
    let root = project_root();
    let voicebox_dir = root.join("core").join("voicebox");
    let cues_json = serde_json::to_string(cues).unwrap_or_else(|_| "[]".to_string());

    let py_code = r#"
import json, sys, wave, struct
from pathlib import Path

vb_dir, out_wav_s, out_json_s, cues_s, dur_s, fps_s = sys.argv[1:7]
sys.path.insert(0, vb_dir)
import sfx_engine as se

cues = json.loads(cues_s)
dur = max(0.25, float(dur_s))
fps = max(1, int(fps_s))
sr = se.SAMPLE_RATE
total_samples = max(1, int(dur * sr))
mix = [0.0] * total_samples
placed = []

for raw in cues:
    if isinstance(raw, str):
        ctype = raw.strip().lower()
        t_sec = 0.0
        vol = 0.35
    elif isinstance(raw, dict):
        ctype = str(raw.get("type") or raw.get("sfx") or "pop").strip().lower()
        if raw.get("time") is not None:
            t_sec = max(0.0, float(raw["time"]))
        elif raw.get("frame") is not None:
            t_sec = max(0.0, float(raw["frame"]) / float(fps))
        else:
            t_sec = 0.0
        vol = max(0.05, min(1.0, float(raw.get("volume", 0.38))))
    else:
        continue

    if "whoosh" in ctype or "swipe" in ctype:
        samples = se.generate_noise_sweep(0.38, 400, 4500, vol)
        norm_type = "whoosh"
    elif "riser" in ctype:
        samples = se.generate_noise_sweep(0.75, 250, 6000, vol)
        norm_type = "riser"
    elif "impact" in ctype or "hit" in ctype or "thud" in ctype:
        samples = se.generate_sub_impact(0.45, vol)
        norm_type = "impact"
    elif "chime" in ctype or "bell" in ctype:
        samples = se.generate_chime([1046.5, 1318.5, 1567.98], 0.35, vol)
        norm_type = "chime"
    elif "type" in ctype or "click" in ctype:
        samples = se.generate_sine_blip(2200, 1600, 0.035, 120.0, vol)
        norm_type = "typewriter"
    else:
        samples = se.generate_sine_blip(950, 480, 0.075, 45.0, vol)
        norm_type = "pop"

    offset = min(total_samples - 1, int(t_sec * sr))
    for i, smp in enumerate(samples):
        idx = offset + i
        if idx >= total_samples:
            break
        mix[idx] = max(-0.95, min(0.95, mix[idx] + smp))
    placed.append({"type": norm_type, "time": round(t_sec, 3), "volume": round(vol, 2)})

se.write_wav(Path(out_wav_s), mix)
Path(out_json_s).parent.mkdir(parents=True, exist_ok=True)
Path(out_json_s).write_text(json.dumps({"duration": round(dur, 3), "cues": placed}, indent=2), encoding="utf-8")
"#;

    let mut cmd = Command::new("python");
    crate::paths::configure_hidden_tokio_command(&mut cmd);
    cmd.arg("-c")
        .arg(py_code)
        .arg(&voicebox_dir)
        .arg(sfx_wav_path)
        .arg(sfx_json_path)
        .arg(&cues_json)
        .arg(format!("{:.4}", duration_sec))
        .arg(fps.to_string());

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Failed launching Python SFX synthesis: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "SFX synthesis failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

pub async fn execute_film_audio(
    session_id: &str,
    workspace_dir: &str,
    arguments: &Value,
) -> Value {
    if workspace_dir.trim().is_empty() {
        return json!({ "ok": false, "error": "workspace_dir is empty." });
    }
    let ws_root = Path::new(workspace_dir);

    let raw_scenes = match arguments.get("scenes").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr,
        _ => {
            return json!({
                "ok": false,
                "error": "Parameter 'scenes' must be a non-empty array of { id, narration, ... }."
            });
        }
    };

    let lock = active_microstock_lock(workspace_dir);
    let mut seen_ids = HashSet::new();
    for (idx, item) in raw_scenes.iter().enumerate() {
        let raw_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let clean_id = sanitize_id(raw_id);
        if clean_id.is_empty() {
            return json!({
                "ok": false,
                "error": format!("Scene at index {} has an empty or invalid 'id'.", idx)
            });
        }
        if lock.is_some() {
            return json!({
                "ok": false,
                "code": "MICROSTOCK_AUDIO_FORBIDDEN",
                "error": format!(
                    "Adobe Stock Mode ('M') requires silent video (-an); remove audio/sfx from scene '{}'.",
                    clean_id
                )
            });
        }
        if !seen_ids.insert(clean_id.clone()) {
            return json!({
                "ok": false,
                "code": "DUPLICATE_SCENE_ID",
                "error": format!("Duplicate scene id '{}' in film_audio scenes array.", clean_id)
            });
        }
        let narration = item
            .get("narration")
            .or_else(|| item.get("text"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if narration.is_empty() {
            return json!({
                "ok": false,
                "error": format!("Scene '{}' requires non-empty 'narration' text.", clean_id)
            });
        }
    }

    let buffer_sec = arguments
        .get("buffer")
        .and_then(|v| v.as_f64())
        .filter(|b| b.is_finite() && *b >= 0.0)
        .unwrap_or(DEFAULT_AUDIO_BUFFER_SEC);
    let min_scene_sec = arguments
        .get("minScene")
        .and_then(|v| v.as_f64())
        .filter(|m| m.is_finite() && *m >= 0.0)
        .unwrap_or(DEFAULT_MIN_SCENE_SEC);
    let warn_tol = arguments
        .get("durationTolerance")
        .and_then(|v| v.as_f64())
        .filter(|t| t.is_finite() && *t >= 0.0)
        .unwrap_or(DEFAULT_DURATION_WARN_TOL_SEC);
    let fps = arguments
        .get("fps")
        .and_then(|v| v.as_u64())
        .map(|f| (f as u32).max(1))
        .unwrap_or(30);

    let default_voice = arguments.get("voice").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
    let default_style = arguments.get("style").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
    let default_lang = arguments.get("lang").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("id");
    let default_engine = arguments.get("engine").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
    let custom_lex_arg = arguments.get("lexicon").and_then(|v| v.as_str());
    let reset_lock = arguments.get("resetVoiceLock").and_then(|v| v.as_bool()).unwrap_or(false);

    let film_dir = match resolve_target_film_dir(ws_root, "Motion Film") {
        Ok(d) => d,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let audio_dir = film_dir.join("audio");
    if let Err(e) = std::fs::create_dir_all(&audio_dir) {
        return json!({
            "ok": false,
            "error": format!("Failed creating audio dir '{}': {}", audio_dir.display(), e)
        });
    }

    let lexicon_path = resolve_isolated_lexicon(ws_root, &film_dir, custom_lex_arg, workspace_dir);
    let script_path = project_root().join("core").join("voicebox").join("voicebox_engine.py");
    let mut generated_summaries = Vec::new();
    let mut updated_map: HashMap<String, FilmManifestScene> = HashMap::new();
    let mut ordered_ids = Vec::with_capacity(raw_scenes.len());

    for (idx, item) in raw_scenes.iter().enumerate() {
        let clean_id = sanitize_id(item.get("id").and_then(|v| v.as_str()).unwrap_or(""));
        ordered_ids.push(clean_id.clone());
        let narration = item
            .get("narration")
            .or_else(|| item.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let spoken_text = item
            .get("spokenText")
            .or_else(|| item.get("spoken_text"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let voice = item.get("voice").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).or(default_voice);
        let style = item.get("style").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).or(default_style);
        let lang = item.get("lang").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).unwrap_or(default_lang);
        let engine = item.get("engine").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).or(default_engine);
        let title_opt = item.get("title").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
        let accent = item.get("accent").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("#f59e0b");

        let audio_rel = format!("audio/{}.wav", clean_id);
        let words_rel = format!("audio/{}.words.json", clean_id);
        let wav_path = film_dir.join(&audio_rel);
        let words_path = film_dir.join(&words_rel);

        let mut cmd = Command::new("python");
        crate::paths::configure_hidden_tokio_command(&mut cmd);
        cmd.arg(&script_path)
            .arg("--text")
            .arg(narration)
            .arg("--out")
            .arg(&wav_path)
            .arg("--lang")
            .arg(lang)
            .arg("--workspace")
            .arg(&film_dir);
        if let Some(sp) = spoken_text {
            cmd.arg("--spoken-text").arg(sp);
        }
        if let Some(ref lp) = lexicon_path {
            cmd.arg("--lexicon").arg(lp);
        }
        if let Some(v) = voice {
            cmd.arg("--voice").arg(v);
        }
        if let Some(st) = style {
            cmd.arg("--style").arg(st);
        }
        if let Some(eng) = engine {
            cmd.arg("--engine").arg(eng);
        }
        if reset_lock && idx == 0 {
            cmd.arg("--reset-voice-lock");
        }

        let output = match cmd.output().await {
            Ok(o) => o,
            Err(e) => {
                return json!({
                    "ok": false,
                    "sceneId": clean_id,
                    "error": format!("Failed running Voicebox for scene '{}': {}", clean_id, e)
                });
            }
        };
        if !output.status.success() {
            return json!({
                "ok": false,
                "sceneId": clean_id,
                "error": format!(
                    "Voicebox synthesis failed for '{}': {}",
                    clean_id,
                    String::from_utf8_lossy(&output.stderr).trim()
                )
            });
        }

        let wav_dur = match read_wav_duration_secs(&wav_path) {
            Ok(d) => d,
            Err(e) => {
                return json!({ "ok": false, "sceneId": clean_id, "error": e });
            }
        };
        let words_dur = read_words_duration_secs(&words_path);
        let final_wav_dur = words_dur.map(|wd| wd.max(wav_dur)).unwrap_or(wav_dur);
        let computed_duration = round3(min_scene_sec.max(final_wav_dur + buffer_sec));

        let sfx_cues = item.get("sfxCues").and_then(|v| v.as_array()).filter(|a| !a.is_empty());
        let sfx_rel = if let Some(cues) = sfx_cues {
            let rel = format!("audio/sfx_{}.wav", clean_id);
            let sfx_wav = film_dir.join(&rel);
            let sfx_json = film_dir.join(format!("audio/sfx_{}.json", clean_id));
            if let Err(e) = synthesize_scene_sfx(&sfx_wav, &sfx_json, cues, computed_duration, fps).await {
                return json!({ "ok": false, "sceneId": clean_id, "error": e });
            }
            Some(rel)
        } else {
            None
        };

        updated_map.insert(
            clean_id.clone(),
            FilmManifestScene {
                id: clean_id.clone(),
                title: title_opt.unwrap_or(&clean_id).to_string(),
                script: format!("script/scene{}.js", idx + 1),
                start: 0.0,
                duration: computed_duration,
                audio: Some(audio_rel.clone()),
                sfx: sfx_rel.clone(),
                words: Some(words_rel.clone()),
                accent: accent.to_string(),
            },
        );

        generated_summaries.push(json!({
            "id": clean_id,
            "duration": computed_duration,
            "wavDuration": round3(final_wav_dur),
            "bufferApplied": round3(computed_duration - final_wav_dur),
            "audio": audio_rel,
            "words": words_rel,
            "sfx": sfx_rel
        }));
    }

    // Update or create film.json preserving existing layout/scenes when updating subset
    let film_json_path = film_dir.join("film.json");
    let index_path = film_dir.join("index.html");
    let mut manifest = if film_json_path.is_file() {
        let raw = std::fs::read_to_string(&film_json_path).unwrap_or_default();
        serde_json::from_str::<FilmManifestJson>(&raw).unwrap_or_else(|_| FilmManifestJson {
            schema_version: 1,
            manage_index_html: true,
            title: "Motion Film".to_string(),
            width: 1080,
            height: 1920,
            fps,
            background: "#0f1115".to_string(),
            use_three: false,
            scenes: Vec::new(),
        })
    } else {
        FilmManifestJson {
            schema_version: 1,
            manage_index_html: true,
            title: "Motion Film".to_string(),
            width: 1080,
            height: 1920,
            fps,
            background: "#0f1115".to_string(),
            use_three: false,
            scenes: Vec::new(),
        }
    };

    if manifest.scenes.is_empty() {
        for id in &ordered_ids {
            if let Some(sc) = updated_map.remove(id) {
                manifest.scenes.push(sc);
            }
        }
    } else {
        for existing in &mut manifest.scenes {
            if let Some(upd) = updated_map.remove(&existing.id) {
                existing.duration = upd.duration;
                existing.audio = upd.audio;
                existing.words = upd.words;
                if upd.sfx.is_some() {
                    existing.sfx = upd.sfx;
                }
            }
        }
        for id in &ordered_ids {
            if let Some(rem) = updated_map.remove(id) {
                let next_idx = manifest.scenes.len() + 1;
                let mut appended = rem;
                appended.script = format!("script/scene{}.js", next_idx);
                manifest.scenes.push(appended);
            }
        }
    }

    let mut acc_start = 0.0f64;
    for sc in &mut manifest.scenes {
        sc.start = round3(acc_start);
        acc_start += sc.duration;
    }

    let warnings = match validate_scenes_audio_durations(&film_dir, &manifest.scenes, warn_tol) {
        Ok(w) => w,
        Err(err_val) => return err_val,
    };

    let manifest_str = match serde_json::to_string_pretty(&manifest) {
        Ok(s) => s,
        Err(e) => return json!({ "ok": false, "error": format!("Serialize film.json failed: {}", e) }),
    };
    if let Err(e) = std::fs::write(&film_json_path, manifest_str) {
        return json!({
            "ok": false,
            "error": format!("Failed writing {}: {}", film_json_path.display(), e)
        });
    }

    let film_root_rel = film_dir
        .strip_prefix(ws_root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    emit_event(
        workspace_dir,
        "file.edited",
        json!({
            "file": if film_root_rel.is_empty() { "film.json".to_string() } else { format!("{}/film.json", film_root_rel) },
            "sessionID": session_id
        }),
    );

    if manifest.manage_index_html && index_path.is_file() {
        let html = render_managed_index_html(&manifest, false);
        if std::fs::write(&index_path, html).is_ok() {
            emit_event(
                workspace_dir,
                "file.edited",
                json!({
                    "file": if film_root_rel.is_empty() { "index.html".to_string() } else { format!("{}/index.html", film_root_rel) },
                    "sessionID": session_id
                }),
            );
        }
    }

    json!({
        "ok": true,
        "filmRoot": film_root_rel,
        "scenes": generated_summaries,
        "totalDuration": round3(acc_start),
        "warnings": warnings,
        "output": format!(
            "Synthesized audio for {} scene(s) and updated film.json (totalDuration={:.3}s). Next call film_scaffold (duration may be omitted) or write scene scripts.",
            generated_summaries.len(),
            acc_start
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::microstock::{handle_toggle_mode, ToggleModePayload};
    use axum::extract::Query;
    use axum::http::HeaderMap;
    use axum::Json;

    fn write_test_pcm_wav(path: &Path, duration_sec: f64, sr: u32) {
        let num_samples = (duration_sec * sr as f64).round() as usize;
        let data_bytes = (num_samples * 2) as u32;
        let byte_rate = sr * 2;
        let mut buf = Vec::with_capacity(44 + data_bytes as usize);
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        buf.extend_from_slice(b"WAVEfmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&sr.to_le_bytes());
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_bytes.to_le_bytes());
        buf.resize(44 + data_bytes as usize, 0u8);
        if let Some(p) = path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        std::fs::write(path, buf).unwrap();
    }

    #[test]
    fn validator_errors_when_scene_shorter_than_wav_and_warns_when_excessive() {
        let dir = std::env::temp_dir().join(format!("aetheria_audio_val_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write_test_pcm_wav(&dir.join("audio").join("s1.wav"), 3.5, 24000);

        let too_short = vec![FilmManifestScene {
            id: "s1".to_string(),
            title: "S1".to_string(),
            script: "script/scene1.js".to_string(),
            start: 0.0,
            duration: 1.5,
            audio: Some("audio/s1.wav".to_string()),
            sfx: None,
            words: None,
            accent: "#f59e0b".to_string(),
        }];
        let err = validate_scenes_audio_durations(&dir, &too_short, 2.0).unwrap_err();
        assert_eq!(err["code"], "AUDIO_LONGER_THAN_SCENE");
        assert_eq!(err["shortfallSec"], 2.0);
        assert!(err["error"].as_str().unwrap().contains("2.000s"));

        let too_long = vec![FilmManifestScene {
            id: "s1".to_string(),
            title: "S1".to_string(),
            script: "script/scene1.js".to_string(),
            start: 0.0,
            duration: 8.0,
            audio: Some("audio/s1.wav".to_string()),
            sfx: None,
            words: None,
            accent: "#f59e0b".to_string(),
        }];
        let warnings = validate_scenes_audio_durations(&dir, &too_long, 2.0).unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0]["code"], "AUDIO_SCENE_TOO_LONG");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn film_audio_rejects_in_microstock_mode() {
        let dir = std::env::temp_dir().join(format!("aetheria_audio_ms_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().to_string();
        let _ = handle_toggle_mode(
            Query(std::collections::HashMap::new()),
            HeaderMap::new(),
            Json(ToggleModePayload {
                directory: Some(ws.clone()),
                project: None,
                enabled: true,
                preset: Some("1920x1080".to_string()),
                fps: Some(30),
            }),
        )
        .await;

        let res = execute_film_audio(
            "ses_ms",
            &ws,
            &json!({
                "scenes": [{ "id": "scene1", "narration": "Test narration" }]
            }),
        )
        .await;
        assert_eq!(res["ok"], false);
        assert_eq!(res["code"], "MICROSTOCK_AUDIO_FORBIDDEN");
        assert!(res["error"].as_str().unwrap().contains("Adobe Stock Mode ('M') requires silent video (-an)"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
