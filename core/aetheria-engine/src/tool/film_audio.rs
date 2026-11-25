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
                                "narration": { "type": "string", "description": "Narration text (optional/empty when mode='showreel'). Supports inline expression tags `[excited]`, `[sad]`, `[angry]`, `[sarcastic]`, `[nervous]`, `[confident]`, `[whispers]`, `[shouting]`, `[laughs]`, `[chuckles]`, `[sighs]`, `[gasps]`, `[clears throat]`, and `[pause]` (steers TTS emotion and is stripped from subtitles automatically)." },
                                "spokenText": { "type": "string", "description": "Optional phonetic override for foreign names or unmapped acronyms." },
                                "voPath": { "type": "string", "description": "Optional user-supplied WAV path (relative inside workspace/project) to skip TTS and derive exact duration, words.json, and RMS lipsync levels.json." },
                                "duration": { "type": "number", "description": "Target duration seconds for non-narrated showreel scenes (optional alias for minScene)." },
                                "voice": { "type": "string", "description": "Optional voice override (e.g. 'aetheria', 'id-ID-ArdiNeural', 'af_heart')." },
                                "style": { "type": "string", "description": "Optional delivery style ('default', 'energetic', 'mystery', 'casual', 'serious', 'horror', 'crime_conspiracy')." },
                                "lang": { "type": "string", "enum": ["id", "en"] },
                                "engine": { "type": "string", "enum": ["auto", "voxcpm", "edge", "kokoro"] },
                                "accent": { "type": "string", "description": "Optional hex accent color when initializing new scenes." },
                                "title": { "type": "string" },
                                "minScene": { "type": "number", "description": "Optional minimum duration floor (seconds) for this scene." },
                                "sfxCues": {
                                    "type": "array",
                                    "description": "SFX cues from the shared engine catalog (`{ type: 'pop'|'tick'|'ding'|'question'|'sparkle'|'zzz'|'boing'|'footstep'|'whoosh'|'soft-whoosh'|'thud'|'burst'|'alarm'|'flash'|'iris'|'riser', time?: sec, frame?: n, volume?: 0..1 }` or shorthand cue name). When omitted, deterministic transition & beat SFX cues are generated into `audio/sfx_<id>.wav` (declarative StoryCore skills auto-override with timeline-synced `window.__audioEvents` at render time).",
                                    "items": {}
                                },
                                "disableSfx": {
                                    "type": "boolean",
                                    "description": "Set true only if this scene must have no SFX track."
                                },
                                "musicMood": {
                                    "type": "string",
                                    "enum": ["cheerful", "chill", "tense", "comic", "sad", "epic", "study", "mystery", "warm"],
                                    "description": "Optional per-scene BGM mood override (falls back to top-level musicMood when omitted)."
                                }
                            },
                            "required": ["id"]
                        }
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["narrated", "showreel"],
                        "description": "Use 'showreel' for beat-synced music + SFX tracks without Voicebox narration/subtitle cards (ideal for visual motion showreels without spoken dialogue)."
                    },
                    "bpm": {
                        "type": "number",
                        "description": "BPM tempo for beat-synced 'showreel' or 'musicMood' BGM grooves (defaults to mood preset or 120)."
                    },
                    "musicMood": {
                        "type": "string",
                        "enum": ["cheerful", "chill", "tense", "comic", "sad", "epic", "study", "mystery", "warm"],
                        "description": "Optional procedural BGM mood preset synthesized alongside scenes (paired with FFmpeg ducking and loudnorm)."
                    },
                    "musicVolume": {
                        "type": "number",
                        "description": "Optional background music gain 0.0..1.0 (default 0.18)."
                    },
                    "duck": {
                        "type": "boolean",
                        "description": "Sidechain-duck BGM underneath voiceover via FFmpeg sidechaincompress (default true when musicMood is set)."
                    },
                    "loudnorm": {
                        "type": "boolean",
                        "description": "Apply EBU R128 loudness normalization (I=-16) in FFmpeg mix (default true when musicMood is set)."
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
                    "disableSfx": {
                        "type": "boolean",
                        "description": "Set true only if the user explicitly requested voiceover without sound effects."
                    },
                    "disableMicrostock": {
                        "type": "boolean",
                        "description": "Set true to disable Adobe Stock Microstock Mode ('M') before synthesizing narrated audio."
                    },
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

fn infer_default_lang(voice: Option<&str>, engine: Option<&str>) -> &'static str {
    if engine.is_some_and(|e| e.eq_ignore_ascii_case("kokoro")) {
        return "en";
    }
    if let Some(v) = voice {
        let lower = v.trim().to_ascii_lowercase();
        if lower == "aetheria_en"
            || lower.starts_with("en-")
            || lower.starts_with("en_")
            || lower.starts_with("af_")
            || lower.starts_with("am_")
            || lower.starts_with("bf_")
            || lower.starts_with("bm_")
        {
            return "en";
        }
    }
    "id"
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

    norm_type = se.normalize_sfx_kind(ctype)
    samples = se.synthesize_sfx(norm_type, vol)

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

async fn synthesize_showreel_bgm(
    bgm_wav_path: &Path,
    duration_sec: f64,
    bpm: f64,
    scene_index: usize,
    scene_start_sec: f64,
    mood: Option<&str>,
) -> Result<(), String> {
    let voicebox_dir = project_root().join("core").join("voicebox");
    let py_code = r#"
import sys
from pathlib import Path
vb_dir, out_wav_s, dur_s, bpm_s, idx_s, start_s, mood_s = sys.argv[1:8]
if vb_dir not in sys.path:
    sys.path.insert(0, vb_dir)
import sfx_engine
sfx_engine.generate_showreel_bgm_track(
    Path(out_wav_s),
    float(dur_s),
    float(bpm_s),
    int(idx_s),
    float(start_s),
    mood=mood_s or None,
)
"#;
    let mut cmd = Command::new("python");
    crate::paths::configure_hidden_tokio_command(&mut cmd);
    cmd.arg("-c")
        .arg(py_code)
        .arg(&voicebox_dir)
        .arg(bgm_wav_path)
        .arg(format!("{:.4}", duration_sec.max(0.35)))
        .arg(format!("{:.2}", bpm))
        .arg(scene_index.to_string())
        .arg(format!("{:.4}", scene_start_sec.max(0.0)))
        .arg(mood.unwrap_or(""));

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Failed launching showreel BGM synthesis: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "Showreel BGM synthesis failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Computes per-frame normalized RMS levels (`levels.json`) and optional energy-aligned `words.json`
/// from a WAV file using `sfx_engine.py`.
async fn analyze_wav_rms_and_words(
    wav_path: &Path,
    levels_json_path: &Path,
    words_target: Option<(&Path, &str)>,
    fps: u32,
) -> Result<(), String> {
    let voicebox_dir = project_root().join("core").join("voicebox");
    let py_code = r#"
import json, sys
from pathlib import Path
vb_dir, wav_s, levels_s, words_s, text_s, fps_s = sys.argv[1:7]
if vb_dir not in sys.path:
    sys.path.insert(0, vb_dir)
import sfx_engine
wav_p = Path(wav_s)
lvl = sfx_engine.compute_wav_rms_levels(wav_p, int(fps_s))
Path(levels_s).parent.mkdir(parents=True, exist_ok=True)
Path(levels_s).write_text(json.dumps(lvl), encoding="utf-8")
if words_s:
    aligned = sfx_engine.align_words_from_wav(wav_p, text_s)
    Path(words_s).parent.mkdir(parents=True, exist_ok=True)
    Path(words_s).write_text(json.dumps(aligned, indent=2), encoding="utf-8")
"#;
    let (words_path_str, words_text) = match words_target {
        Some((wp, txt)) => (wp.to_string_lossy().to_string(), txt.to_string()),
        None => (String::new(), String::new()),
    };
    let mut cmd = Command::new("python");
    crate::paths::configure_hidden_tokio_command(&mut cmd);
    cmd.arg("-c")
        .arg(py_code)
        .arg(&voicebox_dir)
        .arg(wav_path)
        .arg(levels_json_path)
        .arg(&words_path_str)
        .arg(&words_text)
        .arg(fps.max(1).to_string());

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Failed running WAV RMS analyzer: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "WAV RMS analysis failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Generates deterministic default SFX cues (transition + beat accents) when `sfxCues` is omitted.
pub fn default_sfx_cues_for_scene(
    scene_idx: usize,
    total_scenes: usize,
    computed_duration: f64,
    wav_duration: f64,
) -> Vec<Value> {
    let dur = computed_duration.max(0.5);
    let wav = wav_duration.max(0.4).min(dur);
    let entry_type = if scene_idx == 0 { "impact" } else { "whoosh" };
    let entry_vol = if scene_idx == 0 { 0.34 } else { 0.32 };
    let mut cues = vec![json!({
        "type": entry_type,
        "time": 0.04,
        "volume": entry_vol
    })];

    let mid_time = round3((wav * 0.42).clamp(0.45, (dur - 0.35).max(0.45)));
    if mid_time + 0.15 < dur {
        cues.push(json!({
            "type": "pop",
            "time": mid_time,
            "volume": 0.30
        }));
    }

    if dur >= 3.2 {
        let is_last = total_scenes > 1 && scene_idx + 1 == total_scenes;
        let tail_type = if is_last {
            "chime"
        } else if scene_idx % 2 == 1 {
            "typewriter"
        } else {
            "pop"
        };
        let tail_vol = if is_last { 0.34 } else { 0.27 };
        let tail_time = round3((wav * 0.78).clamp((mid_time + 0.55).min(dur - 0.25), (dur - 0.25).max(0.6)));
        if tail_time > mid_time + 0.25 && tail_time + 0.12 < dur {
            cues.push(json!({
                "type": tail_type,
                "time": tail_time,
                "volume": tail_vol
            }));
        }
    }

    cues
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

    let disable_microstock = arguments
        .get("disableMicrostock")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if disable_microstock {
        if let Some(prev_lock) = active_microstock_lock(workspace_dir) {
            let _ = crate::studio::microstock::manifest::save_workspace_mode(
                ws_root,
                false,
                &prev_lock.preset_id,
                prev_lock.fps,
            );
            if let Ok(mut m) =
                crate::studio::microstock::manifest::load_manifest(ws_root, &prev_lock.project_dir)
            {
                m.enabled = false;
                let _ = crate::studio::microstock::manifest::save_manifest(
                    ws_root,
                    &prev_lock.project_dir,
                    &m,
                );
            }
        }
    }

    let ref_style_val: Option<Value> = [
        ws_root.join("ref").join("extracted").join("style.json"),
        ws_root.join("ref").join("style.json"),
    ]
    .into_iter()
    .find(|p| p.is_file())
    .and_then(|p| std::fs::read_to_string(p).ok())
    .and_then(|s| serde_json::from_str::<Value>(&s).ok());

    let explicit_mode = arguments
        .get("mode")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .map(|s| s.to_ascii_lowercase());
    let music_only_flag = arguments.get("musicOnly").and_then(|v| v.as_bool()).unwrap_or(false);
    let all_empty_narration = raw_scenes.iter().all(|item| {
        item.get("narration")
            .or_else(|| item.get("text"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
    });
    let showreel_mode = explicit_mode.as_deref() == Some("showreel")
        || music_only_flag
        || (explicit_mode.is_none() && all_empty_narration);

    let bpm_arg = arguments
        .get("bpm")
        .and_then(|v| v.as_f64())
        .filter(|b| b.is_finite() && *b >= 60.0 && *b <= 200.0);
    let music_mood = arguments
        .get("musicMood")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());
    let music_volume = arguments
        .get("musicVolume")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(0.02, 1.0))
        .unwrap_or(0.18);
    let duck_bgm = arguments
        .get("duck")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let loudnorm_enabled = arguments
        .get("loudnorm")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let bpm = bpm_arg
        .or_else(|| {
            ref_style_val
                .as_ref()
                .and_then(|v| v.get("bpm"))
                .and_then(|v| v.as_f64())
                .filter(|b| b.is_finite() && *b >= 60.0 && *b <= 200.0)
        })
        .unwrap_or(if music_mood.is_some() { 0.0 } else { 120.0 });

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
                    "Adobe Stock Mode ('M') requires silent video (-an); remove audio/sfx from scene '{}' (or pass disableMicrostock: true to film_audio if the user requested a narrated video).",
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
        let has_vo_path = item
            .get("voPath")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.trim().is_empty());
        if !showreel_mode && !has_vo_path && narration.is_empty() {
            return json!({
                "ok": false,
                "error": format!("Scene '{}' requires non-empty 'narration' text (or set mode='showreel' or 'voPath').", clean_id)
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
    let explicit_default_lang = arguments.get("lang").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
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
    let mut showreel_cursor_sec = 0.0f64;

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
        let engine = item.get("engine").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).or(default_engine);
        let lang = item
            .get("lang")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or(explicit_default_lang)
            .unwrap_or_else(|| infer_default_lang(voice, engine));
        let ref_scene_dur = ref_style_val
            .as_ref()
            .and_then(|v| v.get("scenes"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.get(idx))
            .and_then(|s| s.get("duration"))
            .and_then(|d| d.as_f64())
            .filter(|d| d.is_finite() && *d > 0.0);
        let scene_min_sec = item
            .get("duration")
            .or_else(|| item.get("minScene"))
            .and_then(|v| v.as_f64())
            .filter(|m| m.is_finite() && *m > 0.0)
            .or(ref_scene_dur)
            .unwrap_or(min_scene_sec);
        let title_opt = item.get("title").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
        let accent = item.get("accent").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("#f59e0b");

        let vo_path_opt = item
            .get("voPath")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let (audio_rel, words_rel_opt, levels_rel_opt, final_wav_dur, computed_duration) = if showreel_mode && vo_path_opt.is_none() {
            let target_dur = round3(scene_min_sec.max(1.0));
            let bgm_rel = format!("audio/bgm_{}.wav", clean_id);
            let bgm_wav_path = film_dir.join(&bgm_rel);
            let safe_wav_dur = (target_dur - 0.04).max(0.35);
            if let Err(e) = synthesize_showreel_bgm(&bgm_wav_path, safe_wav_dur, bpm, idx, showreel_cursor_sec, music_mood.as_deref()).await {
                return json!({ "ok": false, "sceneId": clean_id, "error": e });
            }
            showreel_cursor_sec += target_dur;
            (bgm_rel, None, None, safe_wav_dur, target_dur)
        } else if let Some(vo_rel) = vo_path_opt {
            let film_dir_str = film_dir.to_string_lossy().to_string();
            let vo_src = match resolve_isolated_path(&film_dir_str, vo_rel) {
                Ok(p) if p.is_file() => p,
                Ok(_) => match resolve_isolated_path(workspace_dir, vo_rel) {
                    Ok(p) => p,
                    Err(e) => {
                        return json!({ "ok": false, "code": "INVALID_VO_PATH", "sceneId": clean_id, "error": e });
                    }
                },
                Err(e) => {
                    return json!({ "ok": false, "code": "INVALID_VO_PATH", "sceneId": clean_id, "error": e });
                }
            };
            if !vo_src.is_file() {
                return json!({
                    "ok": false,
                    "code": "MISSING_VO_FILE",
                    "sceneId": clean_id,
                    "error": format!("User-supplied voPath '{}' does not exist.", vo_rel)
                });
            }
            let a_rel = format!("audio/{}.wav", clean_id);
            let w_rel = format!("audio/{}.words.json", clean_id);
            let l_rel = format!("audio/{}.levels.json", clean_id);
            let wav_path = film_dir.join(&a_rel);
            let words_path = film_dir.join(&w_rel);
            let levels_path = film_dir.join(&l_rel);
            if vo_src != wav_path {
                if let Err(e) = std::fs::copy(&vo_src, &wav_path) {
                    return json!({
                        "ok": false,
                        "sceneId": clean_id,
                        "error": format!("Failed copying voPath '{}': {}", vo_rel, e)
                    });
                }
            }
            let wav_dur = match read_wav_duration_secs(&wav_path) {
                Ok(d) => d,
                Err(e) => return json!({ "ok": false, "sceneId": clean_id, "error": e }),
            };
            if let Err(e) = analyze_wav_rms_and_words(&wav_path, &levels_path, Some((&words_path, narration)), fps).await {
                return json!({ "ok": false, "sceneId": clean_id, "error": e });
            }
            let c_dur = round3(scene_min_sec.max(wav_dur + buffer_sec));
            (a_rel, Some(w_rel), Some(l_rel), wav_dur, c_dur)
        } else {
            let a_rel = format!("audio/{}.wav", clean_id);
            let w_rel = format!("audio/{}.words.json", clean_id);
            let l_rel = format!("audio/{}.levels.json", clean_id);
            let wav_path = film_dir.join(&a_rel);
            let words_path = film_dir.join(&w_rel);
            let levels_path = film_dir.join(&l_rel);

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
            let f_dur = words_dur.map(|wd| wd.max(wav_dur)).unwrap_or(wav_dur);
            let c_dur = round3(scene_min_sec.max(f_dur + buffer_sec));
            // Best-effort RMS mouth openness levels for voicebox TTS audio.
            let levels_opt = if analyze_wav_rms_and_words(&wav_path, &levels_path, None, fps).await.is_ok() {
                Some(l_rel)
            } else {
                None
            };
            (a_rel, Some(w_rel), levels_opt, f_dur, c_dur)
        };

        let scene_mood = item
            .get("musicMood")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .or_else(|| music_mood.clone());
        let bgm_rel_opt = if !showreel_mode || vo_path_opt.is_some() {
            if let Some(ref mood) = scene_mood {
                let scene_bpm = if arguments.get("bpm").is_some() { bpm } else { 0.0 };
                let bgm_rel = format!("audio/bgm_{}.wav", clean_id);
                let bgm_wav_path = film_dir.join(&bgm_rel);
                if let Err(e) = synthesize_showreel_bgm(
                    &bgm_wav_path,
                    computed_duration,
                    scene_bpm,
                    idx,
                    showreel_cursor_sec,
                    Some(mood.as_str()),
                )
                .await
                {
                    return json!({ "ok": false, "sceneId": clean_id, "error": e });
                }
                showreel_cursor_sec += computed_duration;
                Some(bgm_rel)
            } else {
                None
            }
        } else {
            None
        };

        let global_disable_sfx = arguments
            .get("disableSfx")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let scene_disable_sfx = item
            .get("disableSfx")
            .and_then(|v| v.as_bool())
            .unwrap_or(global_disable_sfx);
        let explicit_cues = item
            .get("sfxCues")
            .and_then(|v| v.as_array())
            .filter(|a| !a.is_empty())
            .cloned();
        let resolved_cues = if scene_disable_sfx {
            None
        } else {
            Some(explicit_cues.unwrap_or_else(|| {
                default_sfx_cues_for_scene(idx, raw_scenes.len(), computed_duration, final_wav_dur)
            }))
        };
        let sfx_rel = if let Some(ref cues) = resolved_cues {
            let rel = format!("audio/sfx_{}.wav", clean_id);
            let sfx_wav = film_dir.join(&rel);
            let sfx_json = film_dir.join(format!("audio/sfx_{}.json", clean_id));
            let sfx_dur = if showreel_mode { (computed_duration - 0.04).max(0.35) } else { computed_duration };
            if let Err(e) = synthesize_scene_sfx(&sfx_wav, &sfx_json, cues, sfx_dur, fps).await {
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
                bgm: bgm_rel_opt.clone(),
                sfx: sfx_rel.clone(),
                words: words_rel_opt.clone(),
                accent: accent.to_string(),
                transition_from_prev: None,
                transition_bridge: None,
                camera_track: None,
            },
        );

        generated_summaries.push(json!({
            "id": clean_id,
            "mode": if showreel_mode && vo_path_opt.is_none() { "showreel" } else if vo_path_opt.is_some() { "user_vo" } else { "narrated" },
            "duration": computed_duration,
            "wavDuration": round3(final_wav_dur),
            "bufferApplied": round3(computed_duration - final_wav_dur),
            "audio": audio_rel,
            "bgm": bgm_rel_opt,
            "words": words_rel_opt,
            "levels": levels_rel_opt,
            "sfx": sfx_rel
        }));
    }

    // Update or create film.json preserving existing layout/scenes when updating subset
    let film_json_path = film_dir.join("film.json");
    let index_path = film_dir.join("index.html");
    let default_w = ref_style_val
        .as_ref()
        .and_then(|v| v.get("width"))
        .and_then(Value::as_u64)
        .map(|n| n as u32)
        .filter(|&n| n >= 16)
        .unwrap_or(1080);
    let default_h = ref_style_val
        .as_ref()
        .and_then(|v| v.get("height"))
        .and_then(Value::as_u64)
        .map(|n| n as u32)
        .filter(|&n| n >= 16)
        .unwrap_or(1920);
    let default_fps = ref_style_val
        .as_ref()
        .and_then(|v| v.get("fps"))
        .and_then(Value::as_u64)
        .map(|n| (n as u32).max(1))
        .unwrap_or(fps);
    let default_bg = ref_style_val
        .as_ref()
        .and_then(|v| v.pointer("/palette/primary"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("#0f1115")
        .to_string();

    let any_scene_bgm = generated_summaries
        .iter()
        .any(|s| s.get("bgm").and_then(Value::as_str).is_some());
    let computed_audio_mix = if music_mood.is_some()
        || any_scene_bgm
        || arguments.get("duck").is_some()
        || arguments.get("loudnorm").is_some()
        || arguments.get("musicVolume").is_some()
    {
        Some(json!({
            "musicMood": music_mood,
            "musicVolume": round3(music_volume),
            "duck": duck_bgm,
            "loudnorm": loudnorm_enabled
        }))
    } else {
        None
    };

    let mut manifest = if film_json_path.is_file() {
        let raw = std::fs::read_to_string(&film_json_path).unwrap_or_default();
        serde_json::from_str::<FilmManifestJson>(&raw).unwrap_or_else(|_| FilmManifestJson {
            schema_version: 1,
            manage_index_html: true,
            stage_mode: None,
            title: "Motion Film".to_string(),
            width: default_w,
            height: default_h,
            fps: default_fps,
            background: default_bg.clone(),
            use_three: false,
            audio_mix: None,
            scenes: Vec::new(),
        })
    } else {
        let is_standalone_existing_html = index_path.is_file()
            && std::fs::read_to_string(&index_path)
                .ok()
                .is_some_and(|html| {
                    !super::film_feedback::extract_local_script_srcs(&html)
                        .iter()
                        .any(|s| s.to_ascii_lowercase().contains("scene"))
                });
        FilmManifestJson {
            schema_version: 1,
            manage_index_html: !is_standalone_existing_html,
            stage_mode: if is_standalone_existing_html {
                Some("hybrid".to_string())
            } else {
                None
            },
            title: "Motion Film".to_string(),
            width: default_w,
            height: default_h,
            fps: default_fps,
            background: default_bg,
            use_three: false,
            audio_mix: None,
            scenes: Vec::new(),
        }
    };
    if computed_audio_mix.is_some() {
        manifest.audio_mix = computed_audio_mix;
    }

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
                if upd.bgm.is_some() {
                    existing.bgm = upd.bgm;
                }
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
            bgm: None,
            sfx: None,
            words: None,
            accent: "#f59e0b".to_string(),
            transition_from_prev: None,
            transition_bridge: None,
            camera_track: None,
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
            bgm: None,
            sfx: None,
            words: None,
            accent: "#f59e0b".to_string(),
            transition_from_prev: None,
            transition_bridge: None,
            camera_track: None,
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

    #[tokio::test]
    async fn default_sfx_cues_synthesize_valid_scene_wav_and_json() {
        let dir = std::env::temp_dir().join(format!("aetheria_auto_sfx_{}", crate::paths::now_ms()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let cues = default_sfx_cues_for_scene(0, 3, 4.5, 3.9);
        assert!(cues.len() >= 2);
        let sfx_wav = dir.join("sfx_scene1.wav");
        let sfx_json = dir.join("sfx_scene1.json");
        synthesize_scene_sfx(&sfx_wav, &sfx_json, &cues, 4.5, 30)
            .await
            .expect("SFX synthesis should succeed");
        assert!(sfx_wav.is_file());
        assert!(sfx_json.is_file());
        let dur = read_wav_duration_secs(&sfx_wav).expect("valid SFX WAV header");
        assert!((dur - 4.5).abs() < 0.05);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn infers_english_default_lang_for_kokoro_and_en_neural_voices() {
        assert_eq!(infer_default_lang(Some("af_heart"), None), "en");
        assert_eq!(infer_default_lang(Some("am_adam"), None), "en");
        assert_eq!(infer_default_lang(Some("en-US-AriaNeural"), None), "en");
        assert_eq!(infer_default_lang(None, Some("kokoro")), "en");
        assert_eq!(infer_default_lang(Some("aetheria"), None), "id");
        assert_eq!(infer_default_lang(None, None), "id");
    }

    #[tokio::test]
    async fn film_audio_showreel_mode_generates_bpm_bgm_and_sfx_without_words() {
        let dir = std::env::temp_dir().join(format!("aetheria_showreel_aud_{}", crate::paths::now_ms()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().to_string();

        let res = execute_film_audio(
            "ses_showreel",
            &ws,
            &json!({
                "mode": "showreel",
                "bpm": 114.5,
                "scenes": [
                    { "id": "scene1_hook", "narration": "", "duration": 2.4 },
                    { "id": "scene2_grid", "narration": "", "duration": 2.0 }
                ]
            }),
        )
        .await;
        assert_eq!(res["ok"], true, "unexpected showreel audio error: {:?}", res);
        let project_root = resolve_active_project_or_film_root(&dir).unwrap();
        assert!(project_root.join("audio/bgm_scene1_hook.wav").is_file());
        assert!(project_root.join("audio/sfx_scene1_hook.wav").is_file());
        assert!(!project_root.join("audio/scene1_hook.words.json").exists());

        let manifest: FilmManifestJson = serde_json::from_str(
            &std::fs::read_to_string(project_root.join("film.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest.scenes.len(), 2);
        assert!(manifest.scenes[0].words.is_none());
        assert_eq!(manifest.scenes[0].audio.as_deref(), Some("audio/bgm_scene1_hook.wav"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn film_audio_supports_user_vo_path_with_mood_bgm_levels_and_path_guard() {
        let dir = std::env::temp_dir().join(format!("aetheria_user_vo_{}", crate::paths::now_ms()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().to_string();

        // Failure path: outside-workspace traversal in voPath must be rejected cleanly.
        let bad = execute_film_audio(
            "ses_vo_bad",
            &ws,
            &json!({
                "musicMood": "cheerful",
                "scenes": [{ "id": "s1", "narration": "Hello world", "voPath": "../../outside.wav" }]
            }),
        )
        .await;
        assert_eq!(bad["ok"], false);
        assert_eq!(bad["code"], "INVALID_VO_PATH");

        // Success path: fixture WAV in workspace produces levels.json, words.json, bgm, and audioMix.
        let film_dir = resolve_target_film_dir(&dir, "Motion Film").unwrap();
        write_test_pcm_wav(&film_dir.join("input").join("vo1.wav"), 2.2, 24000);
        let ok = execute_film_audio(
            "ses_vo_ok",
            &ws,
            &json!({
                "musicMood": "cheerful",
                "musicVolume": 0.16,
                "duck": true,
                "loudnorm": true,
                "scenes": [{ "id": "s1", "narration": "Hello bright morning", "voPath": "input/vo1.wav" }]
            }),
        )
        .await;
        assert_eq!(ok["ok"], true, "unexpected user VO error: {:?}", ok);
        assert!(film_dir.join("audio/s1.wav").is_file());
        assert!(film_dir.join("audio/s1.words.json").is_file());
        assert!(film_dir.join("audio/s1.levels.json").is_file());
        assert!(film_dir.join("audio/bgm_s1.wav").is_file());
        let manifest: FilmManifestJson = serde_json::from_str(
            &std::fs::read_to_string(film_dir.join("film.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest.scenes[0].bgm.as_deref(), Some("audio/bgm_s1.wav"));
        assert_eq!(
            manifest.audio_mix.as_ref().and_then(|m| m["musicMood"].as_str()),
            Some("cheerful")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
