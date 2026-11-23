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

const MAX_KINEMATICS_CHARS: usize = 950;

/// Formats measured zoom/pan/spin bursts, discriminative lag-15 living-hold regions,
/// 30fps element feel (`overshootPct`/`settleSec`), and pre-cut motion energy lock.
pub(crate) fn format_motion_kinematics_block(sc: &Value) -> Option<String> {
    let kin = sc
        .pointer("/motionClues/kinematics")
        .or_else(|| sc.pointer("/layout/motionClues/kinematics"))?;
    let active_pct = kin.get("activeFramePct").and_then(Value::as_f64).unwrap_or(0.0);
    let has_living_hold = kin.get("hasLivingHold").and_then(Value::as_bool).unwrap_or(false);
    let hold_diff = kin.get("holdMeanFgDiff").and_then(Value::as_f64).unwrap_or(0.0);
    let rotational_hold = kin.get("rotationalHold").and_then(Value::as_bool).unwrap_or(false);
    let pre_cut_active = kin.get("preCutActive").and_then(Value::as_bool).unwrap_or(false);
    let pre_cut_diff = kin.get("preCutDiff").and_then(Value::as_f64).unwrap_or(0.0);

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

    let feel_arr = sc
        .pointer("/motionClues/elementFeel")
        .or_else(|| sc.pointer("/layout/motionClues/elementFeel"))
        .and_then(Value::as_array);

    if burst_strs.is_empty() && !has_living_hold && !pre_cut_active && feel_arr.is_none_or(|a| a.is_empty()) {
        return None;
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "MEASURED ZOOM / PAN / HOLD DYNAMICS (refActivePct={:.0}%): {}",
        active_pct,
        if burst_strs.is_empty() {
            "measured motion profile".to_string()
        } else {
            burst_strs.join(" ; ")
        }
    ));
    if has_living_hold {
        let mut reg_desc = Vec::new();
        if let Some(regs) = kin.get("livingHoldRegions").and_then(Value::as_array) {
            for r in regs.iter().take(2) {
                let z = r.get("zone").and_then(Value::as_str).unwrap_or("center");
                let amp = r.get("ampPx").and_then(Value::as_f64).unwrap_or(0.0);
                let per = r.get("periodSec").and_then(Value::as_f64);
                match per {
                    Some(p) => reg_desc.push(format!("zone={} amp≈{:.1}px period≈{:.2}s", z, amp, p)),
                    None if amp >= 1.5 => reg_desc.push(format!("zone={} amp≈{:.1}px", z, amp)),
                    _ => reg_desc.push(format!("zone={}", z)),
                }
            }
        }
        let rot_hint = if rotational_hold {
            "rotate rings/orbital dashes (`ctx.rotate(t * omega)` / `AM.drawTurntableObject`) + "
        } else {
            ""
        };
        let region_txt = if reg_desc.is_empty() {
            format!("fgHoldDiff={:.1}", hold_diff)
        } else {
            reg_desc.join(", ")
        };
        lines.push(format!(
            "MEASURED LIVING HOLD ({}): {}keep ONLY the measured moving element alive (match amplitude/period; do NOT add artificial wobble to static text).",
            region_txt, rot_hint
        ));
    } else {
        lines.push(
            "REFERENCE HOLD IS STEADY: keep settled layout crisp and locked — do NOT add synthetic sine wobble."
                .to_string(),
        );
    }

    if pre_cut_active {
        lines.push(format!(
            "PRE-CUT MOTION CONTINUITY LOCK (ref preCutDiff={:.2}): reference is STILL moving in the final 0.40s before the cut — NEVER freeze dead-still before `t = dur`!",
            pre_cut_diff
        ));
    }

    if let Some(feels) = feel_arr {
        let mut f_parts = Vec::new();
        for f in feels.iter().take(2) {
            let t0 = f.get("tStart").and_then(Value::as_f64).unwrap_or(0.0);
            let ov = f.get("overshootPct").and_then(Value::as_f64).unwrap_or(0.0);
            let st = f.get("settleSec").and_then(Value::as_f64).unwrap_or(0.25);
            let sm = f.get("smearRatio").and_then(Value::as_f64).unwrap_or(1.0);
            f_parts.push(format!(
                "pop@{:.2}s overshoot=+{:.0}% settle={:.2}s smear={:.2}x",
                t0, ov, st, sm
            ));
        }
        if !f_parts.is_empty() {
            lines.push(format!(
                "MEASURED ELEMENT FEEL (30fps): {} -> match with `AM.ease.outBack` / `AM.spring`!",
                f_parts.join(" ; ")
            ));
        }
    }

    let mut out = lines.join("\n");
    if out.chars().count() > MAX_KINEMATICS_CHARS {
        out = out.chars().take(MAX_KINEMATICS_CHARS - 3).collect::<String>() + "...";
    }
    Some(out)
}

const MAX_30FPS_BLUEPRINT_CHARS: usize = 950;

/// Formats 30fps cross-scene transition bridges (`push_*` / `leadInBlankSec`) and multi-pulse
/// action windows (`motionTimeline30fps` + `cameraTrack`) into concise timed directives.
pub(crate) fn format_30fps_motion_blueprint_block(
    sc: &Value,
    next_sc: Option<&Value>,
) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    let has_cam_track = sc
        .get("cameraTrack")
        .and_then(Value::as_array)
        .is_some_and(|a| a.len() >= 2);

    if let Some(tb) = sc.get("transitionBridge") {
        let kind = tb.get("kind").and_then(Value::as_str).unwrap_or("hard_cut");
        if kind.starts_with("push_") {
            let dur_s = tb.get("durationSec").and_then(Value::as_f64).unwrap_or(0.5);
            lines.push(format!(
                "INCOMING 30FPS TRANSITION BRIDGE ({} over {:.2}s): RUNTIME AUTO-TRANSITION ACTIVE — draw ONLY this scene's own elements cleanly from local_t=0.00s; NEVER redraw the previous scene!",
                kind, dur_s
            ));
        } else if let Some(blank_s) = tb.get("leadInBlankSec").and_then(Value::as_f64) {
            if blank_s >= 0.04 {
                lines.push(format!(
                    "OPENING BREATH LOCK (30fps): keep clean empty backdrop during local_t=0.00..{:.2}s BEFORE revealing hero elements (avoid sudden frame-0 pop).",
                    blank_s
                ));
            }
        }
    }

    if let Some(next_tb) = next_sc.and_then(|n| n.get("transitionBridge")) {
        let next_kind = next_tb
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("hard_cut");
        if next_kind.starts_with("push_") {
            let dur_s = next_tb
                .get("durationSec")
                .and_then(Value::as_f64)
                .unwrap_or(0.5);
            lines.push(format!(
                "OUTGOING 30FPS TRANSITION ({} over {:.2}s): keep this scene's settled layout alive right to the end; runtime slides the whole canvas out seamlessly.",
                next_kind, dur_s
            ));
        }
    }

    if let Some(mt) = sc.get("motionTimeline30fps") {
        if let Some(windows) = mt.get("actionWindows").and_then(Value::as_array) {
            let mut win_strs = Vec::new();
            for w in windows.iter().take(4) {
                let t0 = w.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                let t1 = w.get("t1").and_then(Value::as_f64).unwrap_or(t0);
                let kind = w.get("kind").and_then(Value::as_str).unwrap_or("local_action");
                let dx = w.get("dxPx").and_then(Value::as_i64).unwrap_or(0);
                let dy = w.get("dyPx").and_then(Value::as_i64).unwrap_or(0);
                let sr = w.get("scaleRatio").and_then(Value::as_f64).unwrap_or(1.0);
                let p90 = w.get("peakP90").and_then(Value::as_f64).unwrap_or(0.0);
                let tag = match kind {
                    "camera_zoom_in" | "camera_zoom_out" => format!("s={:.2}x", sr),
                    k if k.starts_with("camera_pan_") => format!("dx={:+}px,dy={:+}px", dx, dy),
                    _ => format!("p90={:.0}px/fr", p90),
                };
                win_strs.push(format!("{:.2}..{:.2}s {} ({})", t0, t1, kind, tag));
            }
            if !win_strs.is_empty() {
                lines.push(format!("30FPS TIMED ACTION WINDOWS: {}", win_strs.join(" ; ")));
            }
        }
        if let Some(pzb) = mt.get("phaseZoomBridge") {
            let t0 = pzb.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
            let t1 = pzb.get("t1").and_then(Value::as_f64).unwrap_or(t0 + 0.4);
            let sr = pzb.get("scaleRatio").and_then(Value::as_f64).unwrap_or(1.5);
            lines.push(format!(
                "INTRA-SCENE PHASE ZOOM OVERLAP (local {:.2}..{:.2}s, scale={:.2}x): NEVER cut Phase 1 abruptly! Keep Phase 1 zooming/sliding out through the edge until {:.2}s WHILE Phase 2 text begins unblurring underneath via `AM.drawBlurRevealText`!",
                t0, t1, sr, t1
            ));
        }
        if let Some(spins) = mt.get("spinningObjects").and_then(Value::as_array) {
            let mut sp_strs = Vec::new();
            for sp in spins.iter().take(3) {
                let zone = sp.get("zone").and_then(Value::as_str).unwrap_or("center");
                let kind = sp.get("kind").and_then(Value::as_str).unwrap_or("corner_spin");
                let om = sp.get("omegaDegPerSec").and_then(Value::as_f64).unwrap_or(45.0);
                sp_strs.push(format!("{}[{} omega={:+.0}deg/s]", zone, kind, om));
            }
            if !sp_strs.is_empty() {
                lines.push(format!(
                    "30FPS ROTATING / TURNTABLE OBJECTS DETECTED ({}): rotate corner stars/accents continuously (`ctx.rotate(baseAngle + t * omegaRad)`) and animate central 3D objects + dashed rings via `AM.drawTurntableObject(ctx, cx, cy, t, imgOrFn, {{ w, h, omega, depth, ringRadius, ringOmega }})` — NEVER leave them non-rotating!",
                    sp_strs.join(", ")
                ));
            }
        }
        if let Some(blurs) = mt.get("blurTextReveals").and_then(Value::as_array) {
            if !blurs.is_empty() {
                let b0 = &blurs[0];
                let t0 = b0.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                let t1 = b0.get("t1").and_then(Value::as_f64).unwrap_or(t0 + 0.45);
                lines.push(format!(
                    "PROGRESSIVE LEFT-TO-RIGHT BLUR TEXT REVEAL & 3D DEPTH ZOOM (local {:.2}..{:.2}s): MANDATORY — call `AM.drawBlurRevealText(ctx, text, x, y, t, tStart, dur, {{ scaleFrom: 0.28, maxBlur: 18, risePx: 14, color, preBlurSec: 0.18, exitAt }})` or `AM.drawBlurRiseWords(...)` for ALL text entrances and exits so words zoom from far/small/blurred (`scaleFrom: 0.28 -> 1.0`) to close/solid character-by-character AND blur out on exit (NEVER use raw `ctx.fillText` snaps)!",
                    t0, t1
                ));
            }
        }
    }

    if has_cam_track {
        lines.push(
            "30FPS CAMERA TRACK AVAILABLE (`scene.cameraTrack`): ONLY call `AM.applyTrackedCamera(ctx, scene.cameraTrack, t, W, H)` when the ENTIRE stage/background moves together in Row 1; if headers/icons stay fixed while one element enters or slides, animate that element directly at the timed windows above instead of moving the whole camera!"
                .to_string(),
        );
    }

    if lines.is_empty() {
        return None;
    }
    let mut full = lines.join("\n");
    if full.chars().count() > MAX_30FPS_BLUEPRINT_CHARS {
        full = full.chars().take(MAX_30FPS_BLUEPRINT_CHARS - 3).collect::<String>() + "...";
    }
    Some(full)
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
        assert!(block.contains("MEASURED LIVING HOLD"));
        assert!(!block.contains("Math.sin(t * 2.5)"));
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

    #[test]
    fn formats_30fps_transition_bridge_and_action_windows_within_cap() {
        let sc = json!({
            "transitionBridge": { "kind": "push_left", "durationSec": 0.63 },
            "cameraTrack": [
                { "t": 0.0, "tx": 0.0, "ty": 0.0, "s": 1.0, "rot": 0.0 },
                { "t": 1.2, "tx": 0.0, "ty": -140.0, "s": 1.25, "rot": 0.0 }
            ],
            "motionTimeline30fps": {
                "actionWindows": [
                    { "t0": 0.35, "t1": 0.90, "kind": "camera_pan_up", "dxPx": 0, "dyPx": -140, "scaleRatio": 1.0, "peakP90": 24.0 },
                    { "t0": 1.10, "t1": 2.40, "kind": "continuous_ambient", "dxPx": 4, "dyPx": 0, "scaleRatio": 1.0, "peakP90": 18.0 }
                ]
            }
        });
        let next_sc = json!({
            "transitionBridge": { "kind": "push_up", "durationSec": 0.57 }
        });
        let blk = format_30fps_motion_blueprint_block(&sc, Some(&next_sc)).expect("expected blueprint");
        assert!(blk.contains("RUNTIME AUTO-TRANSITION ACTIVE"));
        assert!(blk.contains("OUTGOING 30FPS TRANSITION (push_up"));
        assert!(blk.contains("30FPS TIMED ACTION WINDOWS"));
        assert!(blk.contains("AM.applyTrackedCamera"));
        assert!(blk.chars().count() <= MAX_30FPS_BLUEPRINT_CHARS);

        let hard_sc = json!({
            "transitionBridge": { "kind": "hard_cut", "leadInBlankSec": 0.10 },
            "motionTimeline30fps": {
                "phaseZoomBridge": { "t0": 1.15, "t1": 1.60, "kind": "zoom_through_overlap", "scaleRatio": 1.67 },
                "spinningObjects": [{ "zone": "top_left", "kind": "corner_spin", "omegaDegPerSec": 52.0 }],
                "blurTextReveals": [{ "t0": 1.25, "t1": 1.70, "kind": "left_to_right_char_unblur" }]
            }
        });
        let hard_blk = format_30fps_motion_blueprint_block(&hard_sc, None).expect("expected blank lock");
        assert!(hard_blk.contains("OPENING BREATH LOCK"));
        assert!(hard_blk.contains("INTRA-SCENE PHASE ZOOM OVERLAP"));
        assert!(hard_blk.contains("30FPS ROTATING / TURNTABLE OBJECTS DETECTED"));
        assert!(hard_blk.contains("PROGRESSIVE LEFT-TO-RIGHT BLUR TEXT REVEAL"));
        assert!(hard_blk.chars().count() <= MAX_30FPS_BLUEPRINT_CHARS);
    }
}
