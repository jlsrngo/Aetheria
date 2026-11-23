//! Formats compact per-element motion tracks when foreground objects move significantly.

use serde_json::Value;

const MAX_TRACK_BLOCK_CHARS: usize = 900;

/// Formats `motionClues.elementTracks` (only tracks with >=80px displacement or >=1.4x size ratio),
/// warning explicitly when no global camera motion was measured.
pub(crate) fn format_element_tracks_block(
    sc: &Value,
    has_camera_motion: bool,
) -> Option<String> {
    let tracks = sc
        .pointer("/motionClues/elementTracks")
        .or_else(|| sc.pointer("/layout/motionClues/elementTracks"))
        .and_then(Value::as_array)?;

    let mut lines = Vec::new();
    for (idx, tr) in tracks.iter().enumerate() {
        let disp = tr.get("displacementPx").and_then(Value::as_f64).unwrap_or(0.0);
        let ratio = tr.get("sizeRatio").and_then(Value::as_f64).unwrap_or(1.0);
        if disp < 80.0 && ratio < 1.4 {
            continue;
        }
        let tid = tr.get("id").and_then(Value::as_u64).unwrap_or((idx + 1) as u64);
        let hex = tr
            .get("dominantHex")
            .and_then(Value::as_str)
            .unwrap_or("#FFFFFF");
        let pts = match tr.get("points").and_then(Value::as_array) {
            Some(arr) if !arr.is_empty() => arr,
            _ => continue,
        };
        let mut wp = Vec::new();
        for p in pts.iter().take(6) {
            let Some(lt) = p.get("localT").and_then(Value::as_f64) else {
                continue;
            };
            let Some(cx) = p.get("cx").and_then(Value::as_i64) else {
                continue;
            };
            let Some(cy) = p.get("cy").and_then(Value::as_i64) else {
                continue;
            };
            let w = p.get("w").and_then(Value::as_i64).unwrap_or(0);
            let h = p.get("h").and_then(Value::as_i64).unwrap_or(0);
            wp.push(format!("{:.2}s@({},{})[{}x{}]", lt, cx, cy, w, h));
        }
        if wp.is_empty() {
            continue;
        }
        lines.push(format!(
            "track#{} ({}, move={:.0}px, scale={:.2}x): {}",
            tid,
            hex,
            disp,
            ratio,
            wp.join(" -> ")
        ));
        if lines.len() >= 3 {
            break;
        }
    }

    if lines.is_empty() {
        return None;
    }

    let header = if has_camera_motion {
        "ELEMENT TRACKS (per-object salient centroids):"
    } else {
        "NO GLOBAL CAMERA MEASURED — element-level motion follows (animate objects directly, do not invent global pan):"
    };
    let mut full = format!("{}\n  - {}", header, lines.join("\n  - "));
    if full.chars().count() > MAX_TRACK_BLOCK_CHARS {
        full = full.chars().take(MAX_TRACK_BLOCK_CHARS - 3).collect::<String>() + "...";
    }
    Some(full)
}

const MAX_KINEMATICS_CHARS: usize = 750;

/// Formats measured zoom/pan/spin bursts and continuous living-hold cues (`motionClues.kinematics`).
pub(crate) fn format_motion_kinematics_block(sc: &Value) -> Option<String> {
    let kin = sc
        .pointer("/motionClues/kinematics")
        .or_else(|| sc.pointer("/layout/motionClues/kinematics"))?;
    let active_pct = kin.get("activeFramePct").and_then(Value::as_f64).unwrap_or(0.0);
    let has_living_hold = kin.get("hasLivingHold").and_then(Value::as_bool).unwrap_or(false);
    let hold_diff = kin.get("holdMeanFgDiff").and_then(Value::as_f64).unwrap_or(0.0);
    let rotational_hold = kin.get("rotationalHold").and_then(Value::as_bool).unwrap_or(false);

    let mut burst_strs = Vec::new();
    if let Some(bursts) = kin.get("motionBursts").and_then(Value::as_array) {
        for b in bursts.iter().take(4) {
            let t0 = b.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
            let t1 = b.get("t1").and_then(Value::as_f64).unwrap_or(t0);
            let kind = b.get("kind").and_then(Value::as_str).unwrap_or("pop_or_glide");
            let dx = b.get("dxPx").and_then(Value::as_i64).unwrap_or(0);
            let dy = b.get("dyPx").and_then(Value::as_i64).unwrap_or(0);
            let sc_ratio = b.get("scaleRatio").and_then(Value::as_f64).unwrap_or(1.0);
            let detail = match kind {
                "zoom_in" | "zoom_out" => format!("scale={:.2}x", sc_ratio),
                "pan_up" | "pan_down" => format!("dy={:+}px", dy),
                "pan_left" | "pan_right" => format!("dx={:+}px", dx),
                _ => format!("dx={:+}px,dy={:+}px,scale={:.2}x", dx, dy, sc_ratio),
            };
            burst_strs.push(format!("local {:.2}..{:.2}s: {} ({})", t0, t1, kind, detail));
        }
    }

    if burst_strs.is_empty() && !has_living_hold {
        return None;
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "MEASURED ZOOM / PAN / HOLD DYNAMICS (refActivePct={:.0}%): {}",
        active_pct,
        if burst_strs.is_empty() {
            "continuous micro-motion across scene".to_string()
        } else {
            burst_strs.join(" ; ")
        }
    ));
    if has_living_hold {
        let rot_hint = if rotational_hold {
            "rotate rings/orbital dashes (`ctx.rotate(t * omega)` / `ctx.lineDashOffset = -t * speed`) + "
        } else {
            ""
        };
        lines.push(format!(
            "CONTINUOUS LIVING HOLD REQUIRED (ref fgHoldDiff={:.1}): NEVER freeze after entrance — {}keep floating hero gently breathing/swaying (`Math.sin(t * 2.5)`) and dashed rings spinning smoothly across the entire hold!",
            hold_diff, rot_hint
        ));
    }

    let mut out = lines.join("\n");
    if out.chars().count() > MAX_KINEMATICS_CHARS {
        out = out.chars().take(MAX_KINEMATICS_CHARS - 3).collect::<String>() + "...";
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn static_kinematics_returns_none_and_living_burst_formats_directives() {
        let static_sc = json!({
            "motionClues": {
                "kinematics": { "motionBursts": [], "hasLivingHold": false, "activeFramePct": 0.0 }
            }
        });
        assert!(format_motion_kinematics_block(&static_sc).is_none());

        let live_sc = json!({
            "motionClues": {
                "kinematics": {
                    "activeFramePct": 88.0,
                    "hasLivingHold": true,
                    "rotationalHold": true,
                    "holdMeanFgDiff": 14.2,
                    "motionBursts": [
                        { "t0": 0.4, "t1": 1.0, "kind": "pan_up", "dyPx": -135, "dxPx": 4, "scaleRatio": 1.02 },
                        { "t0": 1.1, "t1": 1.6, "kind": "zoom_in", "dyPx": 0, "dxPx": 0, "scaleRatio": 1.62 }
                    ]
                }
            }
        });
        let block = format_motion_kinematics_block(&live_sc).expect("expected block");
        assert!(block.contains("MEASURED ZOOM / PAN / HOLD DYNAMICS"));
        assert!(block.contains("pan_up (dy=-135px)"));
        assert!(block.contains("zoom_in (scale=1.62x)"));
        assert!(block.contains("CONTINUOUS LIVING HOLD REQUIRED"));
        assert!(block.chars().count() <= MAX_KINEMATICS_CHARS);
    }

    #[test]
    fn stationary_tracks_return_none() {
        let sc = json!({
            "motionClues": {
                "elementTracks": [
                    {
                        "id": 1,
                        "displacementPx": 24.0,
                        "sizeRatio": 1.1,
                        "dominantHex": "#F6AC2F",
                        "points": [
                            { "localT": 0.1, "cx": 360, "cy": 640, "w": 120, "h": 60 },
                            { "localT": 1.0, "cx": 370, "cy": 642, "w": 122, "h": 62 }
                        ]
                    }
                ]
            }
        });
        assert!(format_element_tracks_block(&sc, false).is_none());
    }

    #[test]
    fn moving_tracks_include_no_camera_warning_and_respect_char_cap() {
        let pts: Vec<Value> = (0..10)
            .map(|i| {
                json!({
                    "localT": (i as f64) * 0.25,
                    "cx": 140 + i * 45,
                    "cy": 770 - i * 35,
                    "w": 180 + i * 10,
                    "h": 90
                })
            })
            .collect();
        let sc = json!({
            "motionClues": {
                "elementTracks": [
                    { "id": 1, "displacementPx": 480.0, "sizeRatio": 1.45, "dominantHex": "#F6AC2F", "points": pts.clone() },
                    { "id": 2, "displacementPx": 210.0, "sizeRatio": 1.1, "dominantHex": "#3EF5B6", "points": pts.clone() },
                    { "id": 3, "displacementPx": 190.0, "sizeRatio": 1.8, "dominantHex": "#884BF9", "points": pts }
                ]
            }
        });
        let block = format_element_tracks_block(&sc, false).expect("expected block");
        assert!(block.contains("NO GLOBAL CAMERA MEASURED"));
        assert!(block.contains("track#1 (#F6AC2F"));
        assert!(block.chars().count() <= MAX_TRACK_BLOCK_CHARS);

        let with_cam = format_element_tracks_block(&sc, true).expect("expected block");
        assert!(with_cam.starts_with("ELEMENT TRACKS"));
        assert!(!with_cam.contains("NO GLOBAL CAMERA MEASURED"));
    }
}
