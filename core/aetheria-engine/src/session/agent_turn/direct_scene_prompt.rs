//! Prompt engineering, hard-facts formatting, and per-frame visual diff diagnostics
//! for the Zero-Subagent Direct Per-Scene Vision-First Reference Remake Compiler.

use serde_json::Value;
use std::path::PathBuf;

pub(crate) const DIRECT_SCENE_SYSTEM_PROMPT: &str = "\
You are a Senior Procedural Motion Graphics Engineer writing studio-grade deterministic HTML5 Canvas 2D scene scripts for the Aetheria Motion Engine (`window.AM`).

ANTIGRAVITY-GRADE INTERACTIVE WORKFLOW (YOU HAVE REAL MICRO-TOOLS — USE THEM!):
You are NOT restricted to a single blind shot. You have direct investigative and surgical editing tools for this scene:
- `inspect_ref_frame({ timestampSec, crop? })` — view ANY full-resolution reference frame (or zoom-crop `{x,y,w,h}`) whenever a small icon, text label, silhouette, or fast transition looks unclear in the 6-panel strip.
- `sample_ref_region({ timestampSec, box? })` — measure exact pixel hex colors, luminance polarity, and tight foreground bounding box inside any rectangle (also works for non-vision models).
- `fetch_web_image({ query, outputPath, removeBackground? })` — search & download real internet photos, realistic 3D renders, portraits, or icons into `img/<name>.png` (set `removeBackground: true` to cut out solid white/uniform corners into transparent PNG!). Preload once at top of your script via `var myImg = AM.loadImage('/img/<name>.png');` and draw via `AM.drawImageFit(ctx, myImg, x, y, w, h)`. Use this whenever the reference shows a realistic 3D object/photo (e.g. realistic brain, dartboard, portrait, product) that flat Canvas ovals cannot match!
- `bash({ command, workdir? })` — run workspace-isolated shell/Python/OpenCV/FFmpeg commands whenever you want custom pixel/geometry measurements or quick checks.
- `write_scene_script({ code })` — write your initial complete `script/sceneK.js` (or do a clean structural rewrite if needed).
- `patch_scene_script({ oldText, newText })` — make SURGICAL exact search-and-replace edits to fix one mismatch without breaking working code. ALWAYS prefer `patch_scene_script` over rewriting the whole file during refinement!
- `render_and_compare_scene({ timestamps?, fullResTimestamp? })` — render your script in headless Chrome/Edge and inspect the 3-row visual comparison (`Row 1 REFERENCE | Row 2 YOUR RENDER | Row 3 DIFF HEATMAP`) + full-res preview of the worst frame + SSIM/Color/Edge diagnostics.

RECOMMENDED PER-SCENE LOOP (PACED SO YOU ALWAYS WRITE, RENDER & POLISH):
1. Step 1 (optional — max 1–2 probe steps total): The 6-panel storyboard strip + 3 full-res keyframes + measured facts are ALREADY attached above. Call `inspect_ref_frame` / `sample_ref_region` for unclear details, AND call `fetch_web_image({ query, outputPath: 'img/...png', removeBackground: true })` right away if this scene contains a photographic or realistic 3D object (you may batch up to 3 calls in parallel in ONE step). Do NOT waste steps running exploratory `bash` `ls`/`cat` commands.
2. Step 2 (write code early!): Call `write_scene_script` with your complete, modular, studio-grade Canvas 2D implementation for this scene.
3. Step 3: Call `render_and_compare_scene` to inspect your actual rendered pixels against Row 1 (REFERENCE) and Row 3 (DIFF) plus the attached full-res frame.
4. Steps 4–11: Do NOT stop early just because SSIM looks like `0.70+` — plain white/light backgrounds inflate SSIM even when typography, timing, or icons look wrong! Compare EVERY panel left-to-right (including opening frame `t=0`, font sizes/weights, element exit timing, dashed selection boxes vs solid pills, and motion blur). Use `patch_scene_script` + `render_and_compare_scene` (typically 2–4 polish rounds) until visuals, proportions, timing, and motion closely match Row 1 with 0 runtime errors, then reply briefly.

SCENE SCRIPT CONTRACT:
1. Wrap the script in `(function () { var AM = window.AM; ... AM.registerScene(\"<sceneId>\", function (ctx, t, dur, scene, AM) { ... }); })();`.
2. Every visual frame MUST be 100% deterministic from local scene time `t` (`0 <= t <= dur`) and `AM.rng(seed)`. NEVER use `Math.random()`, `Date.now()`, `requestAnimationFrame`, `setTimeout`, `<video>`, or reference video paths (`ref/*`, `ref/extracted/*`). Local project images downloaded by `fetch_web_image` into `/img/*.png` ARE allowed and encouraged via `AM.loadImage('/img/...')` + `AM.drawImageFit(...)`.
3. EDITORIAL GOOGLE FONTS PRELOADED IN `index.html`: `'Playfair Display'` (italic & regular editorial serif), `'Anton'` (ultra-bold condensed display), `'Inter'` (400/600/700/800/900 geometric sans), and `'Montserrat'` (600/700/800) are preloaded automatically — use them to match serif/condensed/bold typographic contrast!

UNIVERSAL PROCEDURAL CRAFT METHODOLOGY:
1. DECOMPOSE VISUALLY BEFORE CODING: Put a concise `// VISUAL PLAN:` comment at the top listing (a) exact sub-beat phases across `0..dur` matching the attached storyboard panels left-to-right, and (b) Back -> Mid -> Front layer stack.
2. READ EVERYTHING DIRECTLY FROM THE REFERENCE IMAGES:
   - Extract ALL on-screen text, original text language, typography weight (`300`/`400` vs `700`), colors, gradients, icons, character/object silhouettes, and phase transitions DIRECTLY from the attached high-resolution reference images — NEVER invent extra elements not visible in the reference and NEVER translate on-screen labels unless explicitly requested.
   - Match the visual craft density of the reference with modular procedural Canvas 2D vector helpers (clean curves, rounded primitives, layered gradients, crisp shadows, distinct vector glyphs/illustrations — never minimalist placeholder stubs).
   - Obey measured spatial geometry: align hero positions, movement directions, and pixel scales to `MEASURED FOREGROUND TRAJECTORY` / `PRIMARY FOREGROUND BOUNDING BOX`; apply `MEASURED GLOBAL CAMERA MOTION` via `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)`; use `ctx.filter = \"blur(...)\"` (resetting to `\"none\"`) when foreground/background focus separates; clip inner screen/card content strictly with `ctx.clip()` using exact measured bezel `outerBox` dimensions; and apply `ctx.translate(W/2, H/2); ctx.rotate(rad); ctx.translate(-W/2, -H/2)` whenever drawing a rotated tile grid.

FIVE UNIVERSAL ZERO-COLLISION & MOTION HYGIENE LAWS:
1. DYNAMIC `measureText` FLOW LAYOUT: In any horizontal text row, marquee, or pill row, NEVER use a hardcoded fixed horizontal stride (`i * spacingX`). Always measure each item with `ctx.measureText(text).width` and advance `cursorX += itemWidth + gap` so words and pills never collide.
2. MUTUAL-EXCLUSION PHASE & MORPH HANDOFFS: When an element morphs (shape -> letter) or a scene switches from Phase A to Phase B in the same screen region, smoothly fade/scale the outgoing element out (`1 - p`) as the incoming element enters (`p`) so two layers never crash on top of each other at full opacity.
3. SMOOTH MONOTONIC MOTION & REELS: Scrolling lists, carousels, and word wheels must advance continuously and monotonically from a single ordered list (e.g., `AM.drawWordWheel` or continuous offset `y = cy + (idx - activeFloat) * spacing`) — never swap text arrays mid-transition (`f < 0.5 ? a : b`) or jump backwards.
4. SURFACE CONTRAST & LUMINANCE FIDELITY: Match the reference's actual surface brightness and gradient glow, and always invert inner ink/icon contrast on light vs dark cards/tiles so active or dark surfaces never appear empty.
5. CLEAN BOUNDARY FRAMES: Render a valid visual frame at both `t = 0` and `t = dur` (never leave unguarded blank/black flashes at scene boundaries).

COMPACT `window.AM` RUNTIME API (already loaded globally before your script):
- `AM.registerScene(id, fn)` — `fn(ctx, t, dur, scene, AM)` where `t` is local scene seconds `0..dur`.
- `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)` — global camera zoom/pan/rotation around `(cx, cy)` in degrees `rot`.
- `AM.clamp(v, lo, hi)`, `AM.lerp(a, b, p)`, `AM.invLerp(a, b, v)`, `AM.remap(v, a, b, c, d)`
- `AM.ease.inCubic(p)`, `AM.ease.outCubic(p)`, `AM.ease.inOutCubic(p)`, `AM.ease.outBack(p)`, `AM.ease.outExpo(p)`, `AM.ease.inOutQuart(p)`
- `AM.spring(tSec, { stiffness: 180, damping: 18, mass: 1 })` -> smooth spring 0..1 with slight overshoot
- `AM.rng(seed)` -> callable deterministic PRNG `r()` returning `0..1` (also has `r.next()`, `r.range(min, max)`, `r.pick(arr)`)
- `AM.drawCursor(ctx, x, y, { scale: 1.0, color: '#FFFFFF', stroke: '#111116', shadow: true, angle: 0 })`
- `AM.drawExtrudedArrow3D(ctx, cx, cy, pixelRadius, { rx, ry, rz, depth, topColor, sideColor, glowColor })`
- `AM.drawLaptopFrame(ctx, { x, y, w, h, bezelColor, baseColor }, function(c, scr) { /* draw clipped inside scr.x, scr.y, scr.w, scr.h */ })`
- `AM.drawWordWheel(ctx, { words, activeFloat, cx, cy, spacing, activeFont, dimFont, activeColor, dimColor })`
- `AM.drawSVGPath(ctx, d, { x, y, scale, fill, stroke, lineWidth })`
- `AM.loadImage('/img/asset.png')` -> preloaded `HTMLImageElement` (automatically awaited before Frame 0); `AM.drawImageFit(ctx, img, x, y, w, h, 'contain')`
- Safe Canvas 2D: keep `ctx.save()`/`ctx.restore()` balanced and never reference undeclared variables.";

/// Compact "minimal / IDE-like" system prompt (`<= 2500` bytes) for Phase X2 ablation.
/// Keeps only: target goal, 1-sentence determinism contract, tool list, and compact AM API.
pub(crate) const DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL: &str = "\
Reconstruct the target scene procedurally in HTML5 Canvas 2D (`script/sceneK.js`) matching the attached reference images and measured scene facts; never copy pixels or load `ref/*` paths.

SCRIPT CONTRACT:
Wrap the script in `(function () { var AM = window.AM; ... AM.registerScene(\"<sceneId>\", function (ctx, t, dur, scene, AM) { ... }); })();`. Every frame must be deterministic from local scene time `t` (`0 <= t <= dur`) and `AM.rng(seed)`, never calling `Math.random()`, `Date.now()`, `requestAnimationFrame`, `setTimeout`, `<video>`, or `ref/*` URLs. Preloaded fonts: `'Playfair Display'`, `'Anton'`, `'Inter'`, `'Montserrat'`. Keep `ctx.save()`/`ctx.restore()` balanced.

TOOLS:
- `inspect_ref_frame({ timestampSec, crop? })` — view full-res reference frame or zoom crop `{x,y,w,h}`.
- `sample_ref_region({ timestampSec, box? })` — measure hex colors, luminance, and foreground bbox.
- `fetch_web_image({ query, outputPath, removeBackground? })` — download an image/asset into `/img/<name>.png`.
- `bash({ command, workdir? })` — run workspace-isolated shell/Python commands.
- `write_scene_script({ code })` — write `script/sceneK.js`.
- `patch_scene_script({ oldText, newText })` — exact search-and-replace edit on `script/sceneK.js`.
- `render_and_compare_scene({ timestamps?, fullResTimestamp? })` — render headless preview and return comparison strip, worst full-res frame, and scores/errors.

COMPACT `window.AM` API:
- `AM.registerScene(id, fn)` — `fn(ctx, t, dur, scene, AM)`
- `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)` — global zoom/pan/rotation (`rot` in deg)
- `AM.clamp(v, lo, hi)`, `AM.lerp(a, b, p)`, `AM.invLerp(a, b, v)`, `AM.remap(v, a, b, c, d)`
- `AM.ease.{inCubic,outCubic,inOutCubic,outBack,outExpo,inOutQuart}(p)`
- `AM.spring(tSec, { stiffness, damping, mass })`
- `AM.rng(seed)` -> deterministic PRNG (`r()`, `r.range(min, max)`, `r.pick(arr)`)
- `AM.drawCursor(ctx, x, y, opts)`, `AM.drawExtrudedArrow3D(ctx, cx, cy, r, opts)`, `AM.drawLaptopFrame(ctx, rect, fn)`, `AM.drawWordWheel(ctx, opts)`, `AM.drawSVGPath(ctx, d, opts)`
- `AM.loadImage('/img/asset.png')`, `AM.drawImageFit(ctx, img, x, y, w, h, 'contain')`";

/// Converts `t=6.72s:box=[64,292,423x272] -> ...` from global timestamps into explicit
/// scene-local timestamps plus computed centers `(cx, cy)` and sizes `w×h`.
pub(crate) fn format_trajectory_local_time(raw: &str, scene_start: f64) -> String {
    let mut out = Vec::new();
    for seg in raw.split("->") {
        let s = seg.trim();
        if s.is_empty() {
            continue;
        }
        let parsed = (|| -> Option<String> {
            let after_t = s.strip_prefix("t=")?;
            let (ts_str, rest) = after_t.split_once("s:box=[")?;
            let global_t: f64 = ts_str.parse().ok()?;
            let local_t = (global_t - scene_start).max(0.0);
            let box_inner = rest.strip_suffix(']')?;
            let parts: Vec<&str> = box_inner.split(',').collect();
            if parts.len() != 3 {
                return None;
            }
            let x: i32 = parts[0].trim().parse().ok()?;
            let y: i32 = parts[1].trim().parse().ok()?;
            let (w_s, h_s) = parts[2].trim().split_once('x')?;
            let w: i32 = w_s.parse().ok()?;
            let h: i32 = h_s.parse().ok()?;
            let cx = x + w / 2;
            let cy = y + h / 2;
            Some(format!(
                "local_t={:.2}s: center=({},{}) size={}x{} box=[{},{},{}x{}]",
                local_t, cx, cy, w, h, x, y, w, h
            ))
        })();
        out.push(parsed.unwrap_or_else(|| s.to_string()));
    }
    if out.is_empty() {
        raw.to_string()
    } else {
        out.join(" -> ")
    }
}

/// Builds a concise, ZERO-OCR hard-facts specification block for a single scene from `style.json`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_scene_hard_facts_prompt(
    style_scene: Option<&Value>,
    film_scene: &Value,
    scene_num: usize,
    total_scenes: usize,
    width: u32,
    height: u32,
    fps: u32,
    bpm: f64,
    user_brief: &str,
) -> String {
    let scene_id = film_scene
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("scene1_hook");
    let start = film_scene
        .get("start")
        .and_then(Value::as_f64)
        .or_else(|| style_scene.and_then(|s| s.get("start")).and_then(Value::as_f64))
        .unwrap_or(0.0);
    let dur = film_scene
        .get("duration")
        .and_then(Value::as_f64)
        .or_else(|| style_scene.and_then(|s| s.get("duration")).and_then(Value::as_f64))
        .unwrap_or(2.0);
    let end = start + dur;

    let bpm_label = match style_scene
        .and_then(|s| s.get("bpmSource"))
        .and_then(Value::as_str)
    {
        Some("fallback") => "BPM tak terukur".to_string(),
        _ => format!("BPM={:.1}", bpm),
    };

    let mut lines = vec![
        format!(
            "TARGET SCENE {}/{}: id=\"{}\", script=\"script/scene{}.js\"",
            scene_num, total_scenes, scene_id, scene_num
        ),
        format!(
            "CANVAS & TIMING: {}x{} @ {}fps | {} | global {:.3}s -> {:.3}s | local t = 0.000s .. {:.3}s",
            width, height, fps, bpm_label, start, end, dur
        ),
        format!(
            "IMPORTANT TIME MAPPING: The timestamp labels printed on `ref_scene_{:02}_beats.jpg` are GLOBAL seconds (`global_t`). Inside `AM.registerScene(\"{}\", function(ctx, t, dur, scene, AM))`, `t` is LOCAL seconds (`t = global_t - {:.3}`). For example, global {:.2}s = local t={:.2}s (early), global {:.2}s = local t={:.2}s (mid), global {:.2}s = local t={:.2}s (late).",
            scene_num,
            scene_id,
            start,
            start + dur * 0.15,
            dur * 0.15,
            start + dur * 0.50,
            dur * 0.50,
            start + dur * 0.85,
            dur * 0.85
        ),
    ];

    if let Some(sc) = style_scene {
        if let Some(cp) = sc.get("cleanPlate") {
            let fill = cp.get("fillHex").and_then(Value::as_str).unwrap_or("#0C0B0E");
            let grad = cp.get("hasGradient").and_then(Value::as_bool).unwrap_or(false);
            let kind = cp.get("kind").and_then(Value::as_str);
            let conf = cp.get("confidence").and_then(Value::as_str);
            let mut extra = String::new();
            if let Some(k) = kind {
                extra.push_str(&format!(" kind={}", k));
            }
            if let Some(c) = conf {
                extra.push_str(&format!(" confidence={}", c));
            }
            lines.push(format!(
                "CLEAN PLATE BACKGROUND: fillHex={} hasGradient={}{}",
                fill, grad, extra
            ));
        }
        if let Some(pal) = sc.pointer("/layout/palette") {
            lines.push(format!(
                "MEASURED PALETTE: bg={} surface={} text={} accent={}",
                pal.get("bgHex").and_then(Value::as_str).unwrap_or("#0C0B0E"),
                pal.get("surfaceHex").and_then(Value::as_str).unwrap_or("#222228"),
                pal.get("textHex").and_then(Value::as_str).unwrap_or("#EAE9EE"),
                pal.get("accentHex").and_then(Value::as_str).unwrap_or("#7D56EF"),
            ));
        }
        let tilt_deg = sc.get("gridTiltDeg").and_then(Value::as_f64);
        if let Some(tilt) = tilt_deg {
            let rad = tilt.to_radians();
            lines.push(format!(
                "MEASURED GRID TILT: {:+.1} deg (`rad = {:.4}` around canvas center ({}, {}))",
                tilt,
                rad,
                width / 2,
                height / 2
            ));
        }
        if let Some(ct) = sc.pointer("/layout/contrastTiles") {
            let light = ct.get("lightTileHex").and_then(Value::as_str).unwrap_or("#F0EEEC");
            let dark = ct.get("darkTileHex").and_then(Value::as_str).unwrap_or("#1D1E21");
            if let Some(grid) = ct.get("grid") {
                let px = grid.get("pitchX").and_then(Value::as_f64).unwrap_or(158.0);
                let py = grid.get("pitchY").and_then(Value::as_f64).unwrap_or(255.0);
                let ox = grid.get("originX").and_then(Value::as_f64).unwrap_or(-24.0);
                let oy = grid.get("originY").and_then(Value::as_f64).unwrap_or(-90.0);
                let map_rows: Vec<&str> = grid
                    .get("map")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                let rad = tilt_deg.unwrap_or(0.0).to_radians();
                lines.push(format!(
                    "MEASURED HIGH-CONTRAST TILE WALL (EXACT POLARITY MAP — NOT AN ALTERNATING CHECKERBOARD!):\n\
                     - lightTile={} | darkTile={} | pitch={}x{}px | origin=({},{}) | map=[{}]\n\
                     - EXACT ROTATED GRID COORDINATE CONVENTION (CRITICAL — DO NOT INVENT YOUR OWN startX/startY OR LARGE DRIFT OFFSET!):\n\
                       `ctx.save(); ctx.translate({}, {}); ctx.rotate({:.4}); ctx.translate(-{}, -{});`\n\
                       Then for row `r` (`-1..rows`) and col `c` (`-1..cols`), draw tile at `x = {} + c * {}`, `y = {} + r * {}`, `w = {}`, `h = {}`.\n\
                       Inside `0..rows, 0..cols`, fill color MUST obey `map[r][c] === 'L' ? '{}' : '{}'` (for outer padding ring `r<0/c<0`, alternate cleanly). Keep any camera drift tiny (`<= ±6px`) so light/dark tiles stay pixel-aligned with Row 1! Draw a DISTINCT custom vector icon inside EVERY cell (dark icons on light tiles AND bright white icons on dark tiles).",
                    light,
                    dark,
                    px,
                    py,
                    ox,
                    oy,
                    map_rows.join(" / "),
                    width / 2,
                    height / 2,
                    rad,
                    width / 2,
                    height / 2,
                    ox,
                    px,
                    oy,
                    py,
                    px,
                    py,
                    light,
                    dark,
                ));
            }
        }
        if let Some(cm) = sc.get("cameraMotion").or_else(|| sc.pointer("/layout/cameraMotion")) {
            if let Some(segs) = cm.get("segments").and_then(Value::as_array) {
                let parts: Vec<String> = segs
                    .iter()
                    .filter(|seg| seg.get("confidence").and_then(Value::as_str) != Some("low"))
                    .map(|seg| {
                        format!(
                            "local {:.2}s->{:.2}s scale={:.3}->{:.3} rot={:+.2}->{:+.2}deg pan=({:+.1},{:+.1})->({:+.1},{:+.1})px ease={} conf={}",
                            seg.get("t0").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("t1").and_then(Value::as_f64).unwrap_or(dur),
                            seg.get("scaleFrom").and_then(Value::as_f64).unwrap_or(1.0),
                            seg.get("scaleTo").and_then(Value::as_f64).unwrap_or(1.0),
                            seg.get("rotDegFrom").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("rotDegTo").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("txFrom").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("tyFrom").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("txTo").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("tyTo").and_then(Value::as_f64).unwrap_or(0.0),
                            seg.get("ease").and_then(Value::as_str).unwrap_or("linear"),
                            seg.get("confidence").and_then(Value::as_str).unwrap_or("medium"),
                        )
                    })
                    .collect();
                if !parts.is_empty() {
                    let px = cm.pointer("/pivot/x").and_then(Value::as_f64).unwrap_or(0.5);
                    let py = cm.pointer("/pivot/y").and_then(Value::as_f64).unwrap_or(0.5);
                    lines.push(format!(
                        "MEASURED GLOBAL CAMERA MOTION (apply via `AM.applyCamera(ctx, {{ s, cx, cy, rot }}, W, H)`): {} | pivot=({:.3}, {:.3})",
                        parts.join(" ; "),
                        px,
                        py,
                    ));
                }
            }
        }
        if let Some(mc) = sc.get("motionClues") {
            if let Some(acc) = mc.get("saturatedAccents").and_then(Value::as_array) {
                let hexes: Vec<String> = acc
                    .iter()
                    .filter_map(|a| {
                        let hx = a.get("hex").and_then(Value::as_str)?;
                        let ts = a.get("timestamp").and_then(Value::as_f64).unwrap_or(start);
                        Some(format!("{}@local_t={:.2}s", hx, (ts - start).max(0.0)))
                    })
                    .collect();
                if !hexes.is_empty() {
                    lines.push(format!(
                        "SMALL HIGH-CHROMA ACCENT COLORS DETECTED: {}",
                        hexes.join(", ")
                    ));
                }
            }
            if let Some(hb) = mc.get("heroCardBox") {
                let bd = mc
                    .get("blurredBackdrop")
                    .and_then(Value::as_str)
                    .unwrap_or("blurred carousel backdrop");
                lines.push(format!(
                    "POSSIBLE CENTERED CARD HINT (VERIFY AGAINST ATTACHED IMAGES — ONLY draw if visibly present in the reference frames!): {} over {}",
                    hb, bd
                ));
            }
            if let Some(cc) = mc.get("containerClip") {
                let kind = cc.get("kind").and_then(Value::as_str).unwrap_or("");
                if kind == "bezel-with-inner-screen" {
                    let outer = cc.get("outerBox").unwrap_or(&Value::Null);
                    let inner = cc.get("innerClipRect").unwrap_or(&Value::Null);
                    let exact_args = outer
                        .as_array()
                        .filter(|a| a.len() >= 4)
                        .and_then(|a| {
                            Some(format!(
                                "{{ x: {}, y: {}, w: {}, h: {} }}",
                                a[0].as_i64()?,
                                a[1].as_i64()?,
                                a[2].as_i64()?,
                                a[3].as_i64()?
                            ))
                        })
                        .unwrap_or_else(|| outer.to_string());
                    lines.push(format!(
                        "DEVICE BEZEL & SCREEN CLIP RECT (match EXACT outerBox {} for the device/frame and ctx.clip() inside innerClipRect {}): outerBox={} innerClipRect={}",
                        exact_args, inner, outer, inner
                    ));
                } else if let Some(outer) = cc.get("outerBox") {
                    // `centered-container` is just the foreground silhouette box (no physical bezel).
                    // Report it as scale/placement guidance without falsely asking for a bezel clip.
                    lines.push(format!(
                        "PRIMARY FOREGROUND BOUNDING BOX (match this pixel scale & centered placement): {}",
                        outer
                    ));
                }
            }
            if let Some(im) = mc.get("inlineGlyphMorph").and_then(Value::as_str) {
                lines.push(format!("INLINE GLYPH MORPH HINT: {}", im));
            }
            if let Some(traj) = mc.get("objectTrajectory").and_then(Value::as_str) {
                let local_traj = format_trajectory_local_time(traj, start);
                lines.push(format!(
                    "MEASURED FOREGROUND TRAJECTORY (EXACT local_t, center & pixel size — match position, direction, AND scale!): {}",
                    local_traj
                ));
            }
        }
    }

    let clean_brief: String = user_brief
        .lines()
        .filter(|l| !l.trim().starts_with("http://") && !l.trim().starts_with("https://"))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .chars()
        .take(320)
        .collect();
    if !clean_brief.is_empty() {
        lines.push(format!(
            "USER BRIEF: \"{}\" (Preserve the EXACT visual structure, layout, palette, iconography, on-screen text language, and sub-beat motion of the reference frames; adapt only what is explicitly requested without translating reference micro-labels or breaking proportions.)",
            clean_brief
        ));
    }

    lines.push(
        "TASK: Study ALL attached images (the adaptive 6-panel storyboard strip + full-resolution reference keyframes). Use `inspect_ref_frame` / `sample_ref_region` whenever you need exact zoom detail or colors, author `script/sceneK.js` via `write_scene_script`, verify visually via `render_and_compare_scene`, and refine surgically via `patch_scene_script` until every beat matches cleanly with 0 runtime errors."
            .to_string(),
    );
    lines.join("\n")
}

fn fmt_box(v: Option<&Value>) -> Option<String> {
    let arr = v?.as_array()?;
    if arr.len() < 4 {
        return None;
    }
    let x = arr[0].as_i64()?;
    let y = arr[1].as_i64()?;
    let w = arr[2].as_i64()?;
    let h = arr[3].as_i64()?;
    Some(format!("[{},{},{}x{}]", x, y, w, h))
}

fn box_dims(v: Option<&Value>) -> Option<(f64, f64)> {
    let arr = v?.as_array()?;
    if arr.len() < 4 {
        return None;
    }
    Some((arr[2].as_f64()?, arr[3].as_f64()?))
}

/// Formats per-frame comparison metrics into actionable local-time feedback for Pass 2 & Pass 3.
pub(crate) fn format_comparison_feedback(
    cmp_opt: Option<&Value>,
    scene_start: f64,
    runtime_errors: &[String],
    capture_err: Option<&str>,
) -> (f64, String, Option<PathBuf>) {
    let mut lines = Vec::new();
    if let Some(err) = capture_err {
        lines.push(format!("CAPTURE ERROR: {}", err));
    }
    if !runtime_errors.is_empty() {
        lines.push(format!(
            "RUNTIME JS ERRORS (MUST FIX IMMEDIATELY): {}",
            runtime_errors.join(" | ")
        ));
    }
    let mut score = 0.0;
    let mut strip_path: Option<PathBuf> = None;
    if let Some(cmp) = cmp_opt {
        score = cmp
            .get("overallFidelity")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let ssim = cmp.get("ssimMean").and_then(Value::as_f64).unwrap_or(0.0);
        let color = cmp
            .get("colorMatchMean")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let edge = cmp
            .get("edgeMatchMean")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        lines.push(format!(
            "MEASURED SCORE: overall={:.3} (SSIM={:.3}, Color={:.3}, Edge={:.3})",
            score, ssim, color, edge
        ));
        if let Some(p) = cmp
            .get("primarySceneBeatStripPath")
            .or_else(|| cmp.get("comparisonStripPath"))
            .and_then(Value::as_str)
        {
            let pb = PathBuf::from(p);
            if pb.is_file() {
                strip_path = Some(pb);
            }
        }
        if let Some(frames) = cmp.get("perFrame").and_then(Value::as_array) {
            for f in frames {
                let ts = f.get("timestamp").and_then(Value::as_f64).unwrap_or(0.0);
                let local_t = (ts - scene_start).max(0.0);
                let comb = f.get("combinedScore").and_then(Value::as_f64).unwrap_or(0.0);
                let f_ssim = f.get("ssim").and_then(Value::as_f64).unwrap_or(0.0);
                let f_color = f.get("colorSimilarity").and_then(Value::as_f64).unwrap_or(0.0);
                let ed = f.get("edgeSimilarity").and_then(Value::as_f64).unwrap_or(0.0);
                let luma_corr = f.get("lumaCorrelation").and_then(Value::as_f64);
                let diag = f
                    .get("structuralDiagnosis")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let blank = f
                    .get("blankFrameDetected")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                if blank {
                    lines.push(format!(
                        "- local_t={:.2}s (global {:.2}s, score={:.3}): BLANK/CRASHED FRAME — nothing visible drawn at this timestamp!",
                        local_t, ts, comb
                    ));
                    continue;
                }

                let mut notes: Vec<String> = Vec::new();
                if !diag.is_empty() {
                    notes.push(diag.to_string());
                }
                if f_ssim < 0.50 || luma_corr.is_some_and(|c| c < 0.45) {
                    notes.push(format!(
                        "POLARITY/LAYOUT SHIFT (SSIM={:.2}, lumaCorr={:.2}): bright and dark areas are inverted or shifted — verify grid originX/originY + ctx.translate(-W/2,-H/2), background luminance, or sub-beat timing!",
                        f_ssim,
                        luma_corr.unwrap_or(0.0)
                    ));
                }
                if let (Some(rb_s), Some(pb_s), Some((rw, rh)), Some((pw, ph))) = (
                    fmt_box(f.get("refFgBox")),
                    fmt_box(f.get("prevFgBox")),
                    box_dims(f.get("refFgBox")),
                    box_dims(f.get("prevFgBox")),
                ) {
                    let w_ratio = if rw > 1.0 { pw / rw } else { 1.0 };
                    let h_ratio = if rh > 1.0 { ph / rh } else { 1.0 };
                    if !(0.72..=1.35).contains(&w_ratio) || !(0.72..=1.35).contains(&h_ratio) {
                        notes.push(format!(
                            "SCALE/POSITION MISMATCH: refFgBox={} vs your prevFgBox={} — resize/reposition your hero or typography to match refFgBox!",
                            rb_s, pb_s
                        ));
                    }
                }
                if f_color < 0.78 {
                    notes.push(format!(
                        "COLOR/LUMINANCE DRIFT (color={:.2}): match Row 1's actual fill brightness & saturation (avoid dark gaps or muted outlines where Row 1 is luminous/solid)",
                        f_color
                    ));
                }
                if notes.is_empty() && (comb < 0.80 || ed < 0.35) {
                    notes.push("visual silhouette/alignment drift — inspect Row 1 (REF) vs Row 2 (YOUR RENDER) and Row 3 (DIFF) in the attached strip".to_string());
                }
                if !notes.is_empty() {
                    lines.push(format!(
                        "- local_t={:.2}s (global {:.2}s, score={:.3}, ssim={:.2}, color={:.2}, edge={:.2}): {}",
                        local_t,
                        ts,
                        comb,
                        f_ssim,
                        f_color,
                        ed,
                        notes.join(" | ")
                    ));
                }
            }
        }
    }
    (score, lines.join("\n"), strip_path)
}

/// Static zero-collision & motion hygiene check on generated scene JS.
/// Catches recurring Canvas 2D overlap/jump anti-patterns in <1ms so Pass 2/3 can fix them directly.
pub(crate) fn detect_scene_collision_hazards(code: &str) -> Vec<String> {
    let mut hazards = Vec::new();
    let has_measure_text = code.contains("measureText(");

    // 1. Fixed horizontal stride in a word/marquee loop without `ctx.measureText(...)`
    let has_fixed_stride = (code.contains("* spacingX")
        || code.contains("* wordSpacing")
        || code.contains("* stepX")
        || code.contains("* itemSpacing"))
        && code.contains("fillText(");
    if has_fixed_stride && !has_measure_text {
        hazards.push(
            "COLLISION HAZARD (Fixed Stride Marquee): Horizontal word loop multiplies index by fixed `spacingX` without `ctx.measureText(word).width` — wide words WILL collide/overlap! Replace with cumulative `cursorX += ctx.measureText(word).width + gap` (`gap >= fontSize * 0.70`)."
                .to_string(),
        );
    }

    // 2. Mid-scroll ternary word swap (`f < 0.5 ?` / `p < 0.5 ?`) or 2D `stateRows` matrix instead of monotonic scrolling
    if (code.contains("stateRows") || code.contains("f < 0.5 ?") || code.contains("p < 0.5 ?"))
        && code.contains("fillText(")
        && !code.contains("AM.drawWordWheel")
    {
        hazards.push(
            "MOTION JUMP HAZARD (Non-Monotonic Scrolling List): Switching word arrays mid-scroll (`stateRows` / `f < 0.5 ?`) causes text to teleport or jump backwards! Replace with `AM.drawWordWheel(ctx, { words: [...], activeFloat, ... })` (or a single ordered `words[]` array) with strictly monotonic `activeFloat`."
                .to_string(),
        );
    }

    hazards
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn formats_object_trajectory_into_local_time_and_centers() {
        let raw = "t=6.72s:box=[64,292,423x272] -> t=7.32s:box=[446,270,236x134]";
        let formatted = format_trajectory_local_time(raw, 6.667);
        assert!(formatted.contains("local_t=0.05s: center=(275,428) size=423x272"));
        assert!(formatted.contains("local_t=0.65s: center=(564,337) size=236x134"));
    }

    #[test]
    fn hard_facts_prompt_distinguishes_bezel_vs_centered_box_and_emits_grid_convention() {
        let style_sc = json!({
            "start": 3.167,
            "duration": 2.43,
            "gridTiltDeg": -2.8,
            "cleanPlate": { "fillHex": "#D5D5CB", "hasGradient": false },
            "layout": {
                "hero": ["Showrea", "Ertem"],
                "contrastTiles": {
                    "lightTileHex": "#F0EEEC",
                    "darkTileHex": "#1D1E21",
                    "grid": {
                        "pitchX": 158.0, "pitchY": 255.0,
                        "originX": -24.0, "originY": -90.0,
                        "map": ["LDLDLDL", "LDLLLDD", "DLDLDLL"]
                    }
                }
            },
            "motionClues": {
                "containerClip": { "kind": "centered-container", "outerBox": [297, 175, 439, 220] },
                "saturatedAccents": [{ "hex": "#884BF9", "timestamp": 4.667 }]
            },
            "cameraMotion": {
                "segments": [{
                    "t0": 2.13, "t1": 2.43,
                    "scaleFrom": 1.0, "scaleTo": 1.48,
                    "rotDegFrom": 0.0, "rotDegTo": 2.2,
                    "txFrom": 0.0, "tyFrom": 0.0, "txTo": 0.0, "tyTo": 0.0,
                    "ease": "inCubic", "confidence": "high"
                }],
                "pivot": { "x": 0.5, "y": 0.5 }
            }
        });
        let film_sc = json!({ "id": "scene2_problem_or_context", "start": 3.167, "duration": 2.43 });
        let prompt = build_scene_hard_facts_prompt(
            Some(&style_sc),
            &film_sc,
            2,
            8,
            1024,
            576,
            30,
            114.5,
            "https://www.tiktok.com/@ngorzc/video/123\nBuatkan showcase Aetheria Studio.",
        );
        assert!(prompt.contains("ctx.translate(512, 288); ctx.rotate(-0.0489); ctx.translate(-512, -288);"));
        assert!(prompt.contains("PRIMARY FOREGROUND BOUNDING BOX"));
        assert!(!prompt.contains("MUST ctx.clip()"));
        assert!(prompt.contains("#884BF9@local_t=1.50s"));
        assert!(prompt.contains("MEASURED GLOBAL CAMERA MOTION"));
        assert!(prompt.contains("AM.applyCamera"));
        assert!(prompt.contains("scale=1.000->1.480"));
        assert!(!prompt.contains("Showrea"));
        assert!(!prompt.contains("Ertem"));
    }

    #[test]
    fn hard_facts_prompt_marks_fallback_bpm_as_unmeasured() {
        let style_sc = json!({
            "start": 0.0,
            "duration": 2.0,
            "bpmSource": "fallback"
        });
        let film_sc = json!({ "id": "scene1_hook", "start": 0.0, "duration": 2.0 });
        let prompt = build_scene_hard_facts_prompt(
            Some(&style_sc),
            &film_sc,
            1,
            2,
            1024,
            576,
            30,
            120.0,
            "Test fallback BPM prompt.",
        );
        assert!(prompt.contains("BPM tak terukur"));
        assert!(!prompt.contains("BPM=120.0"));
    }

    #[test]
    fn comparison_feedback_reports_local_time_polarity_and_fg_scale_mismatch() {
        let cmp = json!({
            "overallFidelity": 0.48,
            "ssimMean": 0.37,
            "colorMatchMean": 0.72,
            "edgeMatchMean": 0.21,
            "perFrame": [{
                "timestamp": 18.0,
                "combinedScore": 0.55,
                "ssim": 0.42,
                "colorSimilarity": 0.72,
                "edgeSimilarity": 0.25,
                "lumaCorrelation": 0.28,
                "refFgBox": [324, 173, 382, 224],
                "prevFgBox": [390, 240, 220, 105]
            }]
        });
        let (score, fb, _) = format_comparison_feedback(Some(&cmp), 16.0, &[], None);
        assert!((score - 0.48).abs() < 1e-6);
        assert!(fb.contains("local_t=2.00s (global 18.00s"));
        assert!(fb.contains("POLARITY/LAYOUT SHIFT"));
        assert!(fb.contains("SCALE/POSITION MISMATCH"));
        assert!(fb.contains("COLOR/LUMINANCE DRIFT"));
    }

    #[test]
    fn detects_fixed_stride_marquee_and_non_monotonic_word_wheel_hazards() {
        let bad_marquee = "var spacingX = 310; for (var i=0;i<words.length;i++){ ctx.fillText(words[i], startX + i * spacingX, cy); }";
        let h1 = detect_scene_collision_hazards(bad_marquee);
        assert!(h1.iter().any(|s| s.contains("Fixed Stride Marquee")));

        let good_marquee = "var x = startX; for (var i=0;i<words.length;i++){ var w = ctx.measureText(words[i]).width; ctx.fillText(words[i], x, cy); x += w + 56; }";
        assert!(detect_scene_collision_hazards(good_marquee).is_empty());

        let bad_wheel = "const stateRows = [['A','B']]; const word = f < 0.5 ? word0 : word1; ctx.fillText(word, cx, y);";
        let h2 = detect_scene_collision_hazards(bad_wheel);
        assert!(h2.iter().any(|s| s.contains("Non-Monotonic Scrolling List")));
    }

    #[test]
    fn direct_system_prompt_is_style_agnostic_without_benchmark_fingerprints() {
        for (label, prompt) in [
            ("DIRECT_SCENE_SYSTEM_PROMPT", DIRECT_SCENE_SYSTEM_PROMPT),
            ("DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL", DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL),
        ] {
            for forbidden in [
                "#6E44FF",
                "#6D28D9",
                "#DCD9E4",
                "crescent moon",
                "concave-tail",
                "Showreel",
                "Labs Studio",
            ] {
                assert!(
                    !prompt.contains(forbidden),
                    "{} must stay 100% style-agnostic (found '{}')",
                    label,
                    forbidden
                );
            }
        }
    }

    #[test]
    fn minimal_system_prompt_meets_size_and_structure_constraints() {
        assert!(
            DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL.len() <= 2500,
            "minimal prompt {} bytes exceeded 2500 bytes",
            DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL.len()
        );
        for forbidden in [
            "ANTIGRAVITY-GRADE",
            "FIVE UNIVERSAL",
            "METHODOLOGY",
            "Step 1",
            "Step 2",
        ] {
            assert!(
                !DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL.contains(forbidden),
                "minimal prompt must omit '{}'",
                forbidden
            );
        }
        assert!(DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL.contains("AM.rng(seed)"));
        assert!(DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL.contains("write_scene_script"));
        assert!(DIRECT_SCENE_SYSTEM_PROMPT_MINIMAL.contains("render_and_compare_scene"));
    }
}
