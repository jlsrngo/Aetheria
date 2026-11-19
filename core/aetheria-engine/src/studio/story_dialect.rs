//! Canonical `story.json` Dialect A normalizer with backward compatibility for legacy Dialect B.
//!
//! Canonical Dialect A:
//! - `canvas: { w, h, fps }`
//! - `captions: { enabled: bool, items?: [{ start, duration, text }] }`
//! - `shots[i]: { id, start, duration, ... }`
//!
//! Legacy Dialect B (accepted via normalization, with deprecation notes):
//! - `meta: { width, height, fps?, title? }`
//! - `captions: [{ startSec, endSec, text }, ...]` (array) or omitted when `meta` is present
//! - `shots[i]: { startSec, endSec, ... }`

use serde_json::{Map, Value};

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Normalizes a parsed `story.json` value into canonical Dialect A.
///
/// Returns `(normalized_value, deprecation_notes)`. Existing Dialect A fields are
/// preserved untouched (idempotent). Does not mutate invalid values into valid ones
/// if required data is absent (e.g., missing both `canvas` and `meta` stays missing).
pub fn normalize_story_dialect(val: &Value) -> (Value, Vec<String>) {
    let Some(orig_obj) = val.as_object() else {
        return (val.clone(), Vec::new());
    };

    let mut obj = orig_obj.clone();
    let mut notes = Vec::new();
    let has_meta = obj.get("meta").and_then(Value::as_object).is_some();

    // 1. Normalize `meta` -> `canvas` (and root `title` if missing)
    if obj.get("canvas").and_then(Value::as_object).is_none() {
        if let Some(meta) = orig_obj.get("meta").and_then(Value::as_object) {
            let w = meta
                .get("width")
                .or_else(|| meta.get("w"))
                .and_then(Value::as_u64);
            let h = meta
                .get("height")
                .or_else(|| meta.get("h"))
                .and_then(Value::as_u64);
            let fps = meta.get("fps").and_then(Value::as_u64).unwrap_or(30);
            if let (Some(w), Some(h)) = (w, h) {
                let mut canvas = Map::new();
                canvas.insert("w".to_string(), Value::from(w));
                canvas.insert("h".to_string(), Value::from(h));
                canvas.insert("fps".to_string(), Value::from(fps));
                obj.insert("canvas".to_string(), Value::Object(canvas));
                notes.push(
                    "Deprecated Dialect B `meta` normalized to canonical `canvas: { w, h, fps }`."
                        .to_string(),
                );
            }
            if obj.get("title").and_then(Value::as_str).is_none() {
                if let Some(t) = meta.get("title").and_then(Value::as_str) {
                    obj.insert("title".to_string(), Value::String(t.to_string()));
                }
            }
        }
    }

    // 2. Normalize `captions` array (or omitted on legacy `meta` docs) -> `{ enabled, items? }`
    match orig_obj.get("captions") {
        Some(Value::Array(arr)) => {
            let mut items = Vec::with_capacity(arr.len());
            for item in arr {
                if let Some(im) = item.as_object() {
                    let mut norm_item = im.clone();
                    if norm_item.get("start").and_then(Value::as_f64).is_none()
                        || norm_item.get("duration").and_then(Value::as_f64).is_none()
                    {
                        if let (Some(s), Some(e)) = (
                            im.get("startSec").and_then(Value::as_f64),
                            im.get("endSec").and_then(Value::as_f64),
                        ) {
                            if s.is_finite() && e.is_finite() {
                                norm_item.insert("start".to_string(), Value::from(round3(s)));
                                norm_item.insert("duration".to_string(), Value::from(round3(e - s)));
                            }
                        }
                    }
                    items.push(Value::Object(norm_item));
                } else {
                    items.push(item.clone());
                }
            }
            let enabled = !items.is_empty();
            let mut cap = Map::new();
            cap.insert("enabled".to_string(), Value::Bool(enabled));
            if !items.is_empty() {
                cap.insert("items".to_string(), Value::Array(items));
            }
            obj.insert("captions".to_string(), Value::Object(cap));
            notes.push(
                "Deprecated Dialect B `captions` array normalized to canonical `captions: { enabled, items }`."
                    .to_string(),
            );
        }
        None if has_meta => {
            let mut cap = Map::new();
            cap.insert("enabled".to_string(), Value::Bool(false));
            obj.insert("captions".to_string(), Value::Object(cap));
            notes.push(
                "Legacy `meta` story missing `captions` normalized to `captions: { enabled: false }`."
                    .to_string(),
            );
        }
        _ => {}
    }

    // 3. Normalize shots `startSec`/`endSec` -> `start`/`duration`
    if let Some(Value::Array(shots)) = obj.get_mut("shots") {
        let mut normalized_any_shot = false;
        for sh in shots.iter_mut() {
            let Some(sm) = sh.as_object_mut() else {
                continue;
            };
            let has_start = sm.get("start").and_then(Value::as_f64).is_some();
            let has_dur = sm.get("duration").and_then(Value::as_f64).is_some();
            if !has_start || !has_dur {
                let s_sec = sm.get("startSec").and_then(Value::as_f64);
                let e_sec = sm.get("endSec").and_then(Value::as_f64);
                if let (Some(s), Some(e)) = (s_sec, e_sec) {
                    if s.is_finite() && e.is_finite() {
                        if !has_start {
                            sm.insert("start".to_string(), Value::from(round3(s)));
                        }
                        if !has_dur {
                            sm.insert("duration".to_string(), Value::from(round3(e - s)));
                        }
                        normalized_any_shot = true;
                    }
                }
            }
        }
        if normalized_any_shot {
            notes.push(
                "Deprecated Dialect B shot `startSec`/`endSec` normalized to canonical `start`/`duration`."
                    .to_string(),
            );
        }
    }

    (Value::Object(obj), notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_dialect_b_to_dialect_a() {
        let legacy = json!({
            "meta": { "title": "Legacy", "width": 1080, "height": 1920, "fps": 30 },
            "captions": [{ "startSec": 0.5, "endSec": 2.0, "text": "Hello" }],
            "shots": [
                { "id": "s1", "startSec": 0.0, "endSec": 3.0 },
                { "id": "s2", "startSec": 3.0, "endSec": 6.5 }
            ]
        });
        let (norm, notes) = normalize_story_dialect(&legacy);
        assert_eq!(notes.len(), 3);
        assert_eq!(norm["canvas"]["w"], 1080);
        assert_eq!(norm["canvas"]["h"], 1920);
        assert_eq!(norm["canvas"]["fps"], 30);
        assert_eq!(norm["title"], "Legacy");
        assert_eq!(norm["captions"]["enabled"], true);
        assert_eq!(norm["captions"]["items"][0]["start"], 0.5);
        assert_eq!(norm["captions"]["items"][0]["duration"], 1.5);
        assert_eq!(norm["shots"][0]["start"], 0.0);
        assert_eq!(norm["shots"][0]["duration"], 3.0);
        assert_eq!(norm["shots"][1]["start"], 3.0);
        assert_eq!(norm["shots"][1]["duration"], 3.5);
    }

    #[test]
    fn canonical_dialect_a_is_untouched_with_no_notes() {
        let canonical = json!({
            "title": "Canonical",
            "canvas": { "w": 1080, "h": 1920, "fps": 30 },
            "captions": { "enabled": false },
            "shots": [{ "id": "s1", "start": 0.0, "duration": 4.0 }]
        });
        let (norm, notes) = normalize_story_dialect(&canonical);
        assert!(notes.is_empty());
        assert_eq!(norm, canonical);
    }
}
