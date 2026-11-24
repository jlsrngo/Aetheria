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
- `bash({ command, workdir? })` — workspace-isolated shell/Python/OpenCV tool (active by default) for exact contour/geometry/font/timing verification when `inspect_ref_frame` or `sample_ref_region` is not enough. Avoid wasting steps running exploratory commands before writing code.
- `write_scene_script({ code })` — write your initial complete `script/sceneK.js` (or do a clean structural rewrite if needed).
- `patch_scene_script({ oldText, newText })` — make SURGICAL exact search-and-replace edits to fix one mismatch without breaking working code. ALWAYS prefer `patch_scene_script` over rewriting the whole file during refinement!
- `render_and_compare_scene({ timestamps?, fullResTimestamp? })` — render your script in headless Chrome/Edge and inspect the 3-row visual comparison (`Row 1 REFERENCE | Row 2 YOUR RENDER | Row 3 DIFF HEATMAP`) + full-res preview of the worst frame + SSIM/Color/Edge diagnostics.

RECOMMENDED PER-SCENE LOOP (PACED SO YOU ALWAYS WRITE, RENDER & POLISH):
1. Step 1 (optional — max 1 probe step total): The filmstrip storyboard strip + 3 full-res keyframes + measured facts are ALREADY attached above. Call `inspect_ref_frame` / `sample_ref_region` / `read_filmstrip` for unclear details, AND call `fetch_web_image({ query, outputPath: 'img/...png', removeBackground: true })` right away if this scene contains a photographic or realistic 3D object (you may batch up to 3 calls in parallel in ONE step). Never waste steps running exploratory shell commands.
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
2. MUTUAL-EXCLUSION PHASE, MORPH & C1 VELOCITY CONTINUITY:
   - When an element morphs (circle -> rounded square -> puzzle, or big capsule -> banner) or switches from Phase A to Phase B, NEVER draw two disjoint static sizes in separate `if (t < X)` blocks without lerping `w`, `h`, `x`, `y` between them, and NEVER gate a morph with `if (morph > 0.01) { drawOld(); return; }` (which freezes the old shape then pops in 1 frame!). Keep ONE persistent track and interpolate vertices/corner radii continuously!
   - **C1 VELOCITY CONTINUITY & AE SPEED-GRAPH LAW:** NEVER split one continuous zoom, card trajectory, or ring expansion into disconnected `if (t < A) ... else if (t < B)` jumps where position or radius snaps on the boundary, and NEVER chain `outCubic` -> `outCubic` segments that stop dead mid-motion! Prefer After Effects speed-graph curves (`AM.ease.aeGlide`, `AM.ease.outQuint`, `AM.ease.inOutQuint`, `AM.ease.aeSnap`, `AM.ease.outExpo`, `AM.spring`) with overlapping follow-through so fast moves glide cleanly to rest.
3. SMOOTH MONOTONIC MOTION, CONTINUOUS CURVE TRACING & LIVING DETAILS:
   - Whenever a helper accepts a `progress` / `traceProgress` / `p` parameter, ACTUALLY use `progress` continuously inside the drawing loop (`var exact = steps * progress;` interpolating the final fractional segment, OR arc-length polyline tracing with arrowheads attached directly to the moving tip — NEVER `Math.floor(steps * progress)` and NEVER hide an arrowhead until `p >= 0.96`).
   - Whenever Row 1 shows marching-ant dashed selection boxes, animate `ctx.lineDashOffset = -t * 28` continuously across the hold instead of freezing dead-still; match transform-box reveal style (e.g. horizontal resize/expand vs plain uniform scale) to Row 1!
   - Whenever you apply a windowed wave/sine oscillation `if (t >= t0 && t < t1)`, ALWAYS multiply its amplitude by a smooth window envelope `var env = Math.sin(AM.clamp((t - t0) / (t1 - t0), 0, 1) * Math.PI);` (`0` at `t0` and `t1`) so elements NEVER snap/jump in 1 frame at `t = t0`!
   - During any 'hold' phase where a card/pill/logo stays steady, keep precision-locked focal geometry crisp — ONLY animate living motion (marching dashes, spinning corner stars, rotating 3D hero, parallax ribbons) where Row 1 actually moves!
4. SOFT VOLUMETRIC CAUSTICS & SURFACE CONTRAST: Draw background light streaks/caustics/metaballs with `ctx.filter = 'blur(28px)'` (resetting `ctx.filter = 'none'`) or wide multi-stop radial gradients — NEVER draw unblurred sharp diagonal bars or hard concentric bullseye circles.
5. CLEAN BOUNDARY FRAMES & STRICT SCENE SCOPE: Render a valid visual frame at both `t = 0` and `t = dur` matching `BOUNDARY CONTINUITY LOCK` (`OPENING FRAME local_t=0.00s` and `CLOSING FRAME local_t=dur`). Never re-animate an already-exited card from the previous scene at a different Y position, and never prematurely draw the next scene's hero logo/text unless it is visibly present in THIS scene's final filmstrip tile.

OPTICAL MATERIAL & LIVING MOTION CRAFT:
- **Snappy Zoom-Zoom, Springs & Measured Holds:** Drive punchy entrances/pops with `AM.ease.outBack` / `AM.spring` / `AM.ease.outExpo` (`0.85 -> 1.04 -> 1.0`), exit zooms/wipes with `AM.ease.inCubic`, and camera or stage zooms/scrolls via `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)` whenever `MEASURED ZOOM / PAN / HOLD DYNAMICS` reports a `zoom_in`, `zoom_out`, or `pan_*` burst. Only animate continuous orbital rings or gentle breathing drift on regions where `MEASURED LIVING HOLD` / `30FPS ROTATING` confirms the reference actually moves — NEVER invent synthetic wobble on steady locked headlines or bars when the reference hold is steady!
- **Volumetric soft light vs sharp geometry:** For luminous clouds/portals/glows, use wide smooth radial gradients fading to `alpha=0` with `lighter` (`AM.drawOpticalGlow` / `AM.drawBloomStroke`) — never thin harsh oval outlines or stepped unblurred rings.
- **Optical lens & tapered ribbons:** When Row 1 shows water-bubble / spherical glass distortion bending text or edges, use `AM.drawSphericalLens(ctx, cx, cy, r, k, function(c) { ... }, opts)` (`drawFn(c)` draws in main canvas coords around `(cx, cy)`, or 2-arg `drawFn(lc, size)` draws in local `0..size`). When Row 1 shows a glowing arc, hopping comet, or light swoosh, use `AM.drawTaperedRibbon(ctx, pts, maxW, opts)`.
- **Progressive Character Blur Reveal, True 3D Turntable & Smooth Overlapped Transitions (MotionCraft Craft Laws):**
  - Whenever text reveals out of optical blur (e.g. editorial serif/sans headlines), NEVER draw the whole word with a single uniform `ctx.fillText` blur that snaps bold all at once, and NEVER snap words on/off in 1 frame! Call `AM.drawBlurRevealText(ctx, text, x, y, t, tStart, dur, { scaleFrom: 0.92, maxBlur: 14, risePx: 10, color, preBlurSec: 0.14, exitAt, exitDur: 0.26 })` or `AM.drawBlurRiseWords(ctx, text, x, y, t, tStart, opts)` so words unblur smoothly character-by-character left-to-right (only pass a smaller `scaleFrom` like `0.40` if Row 1 visibly zooms the text from far away).
  - When a line grows word-by-word across beats (e.g. `'Your'` -> `'Your Brain'`, or `'every'` -> `'every single day'`), NEVER swap the whole string inside an `if (t < X)` branch (which re-blurs already-visible words)! Slide the existing word smoothly into its new X alignment while revealing ONLY the newly appearing word via `AM.drawBlurRevealText` / `AM.drawBlurRiseWords`.
  - ONLY call `AM.drawTurntableObject(ctx, cx, cy, t, imgOrFn, { w, h, omega: 2.1, depth: 0.22, ringRadius, ringOmega: 0.65 })` for genuine 3D rotating hemisphere objects (e.g. a rotating 3D brain, globe, or coin). NEVER wrap flat 2D graphics (archery targets, puzzle pieces, 4-point corner stars, cards) in `AM.drawTurntableObject` (especially NEVER with `omega: 0`) — draw flat 2D icons directly with standard Canvas 2D transforms (`ctx.rotate(...)`, `ctx.scale(...)`).
  - Whenever an intra-scene phase changes or a transition in the reference looks fast/ambiguous, NEVER switch with a raw 1-frame cut: overlap the outgoing element's continuous zoom/slide/blur exit (`0.30..0.45s`) with the incoming element's `AM.drawBlurRevealText` / `AM.drawMorphPolygon` entrance!
- **Micro-physics & crisp shapes:** Use `AM.impactRecoil` for dot/tether collisions, `AM.twistPolygon` for elastic 3D-sheared polygon spins, and `AM.drawMorphPolygon(ctx, ptsA, ptsB, p, opts)` for smooth shape morphs. Match concave vs convex geometry faithfully (e.g. pinched 4-point concave stars/diamonds vs rounded circles).
- **Boundary continuity:** Match `t = 0` and `t = dur` to the exact opening and closing frames of the beat strip (`ref_scene_XX_beats.jpg`) so flashes, wipes, and shape handoffs flow seamlessly across cuts.

COMPACT `window.AM` RUNTIME API (already loaded globally before your script):
- `AM.registerScene(id, fn)` — `fn(ctx, t, dur, scene, AM)` where `t` is local scene seconds `0..dur`.
- `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)` — global camera zoom/pan/rotation around `(cx, cy)` in degrees `rot`; `AM.applyTrackedCamera(ctx, scene.cameraTrack, t, W, H)`.
- `AM.clamp(v, lo, hi)`, `AM.lerp(a, b, p)`, `AM.invLerp(a, b, v)`, `AM.remap(v, a, b, c, d)`
- `AM.ease.inCubic(p)`, `AM.ease.outCubic(p)`, `AM.ease.inOutCubic(p)`, `AM.ease.outBack(p)`, `AM.ease.outExpo(p)`, `AM.ease.inOutQuart(p)`, `AM.ease.outQuint(p)`, `AM.ease.inOutQuint(p)`, `AM.ease.aeGlide(p)`, `AM.ease.aeSnap(p)`, `AM.ease.snap(p)`
- `AM.spring(tSec, { stiffness: 180, damping: 18, mass: 1 })` -> smooth spring 0..1 with slight overshoot
- `AM.drawBlurRevealText(ctx, text, x, y, t, tStart, dur, { maxBlur, risePx, color, inkStart, preBlurSec })` — progressive left-to-right character unblur + soft spring rise
- `AM.drawBlurRiseWords(ctx, wordsOrText, x, y, t, tStart, { stagger, enterDur, maxBlur, risePx, color, inkStart, preBlurSec, exitAt, exitDur })`, `AM.layoutBalancedHeadline(ctx, text, maxWidth)`
- `AM.drawTurntableObject(ctx, cx, cy, t, imgOrDrawFn, { w, h, omega, depth, tiltRad, floatPx, ringRadius, ringOmega, ringColor })` — 3D Y-axis turntable rotation + spinning dashed ring
- `AM.drawMorphPolygon(ctx, ptsA, ptsB, p, { cx, cy, rot, scale, fill, stroke })` — smooth vertex-matched polygon morph
- `AM.drawOpticalGlow(ctx, x, y, radius, colorHex, intensity)`, `AM.drawBloomStroke(ctx, drawPathFn, { color, lineWidth, glowRadius })`
- `AM.drawSphericalLens(ctx, cx, cy, radius, strength, drawContentFn, opts)`, `AM.drawTaperedRibbon(ctx, points, maxWidth, opts)`
- `AM.impactRecoil(t, hitTime, opts)` -> `{ dx, dy, rot, sx, sy }`; `AM.twistPolygon(points, angle, lagFactor)`
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
- `AM.ease.{inCubic,outCubic,inOutCubic,outBack,outExpo,inOutQuart,snap}(p)`
- `AM.spring(tSec, { stiffness, damping, mass })`, `AM.impactRecoil(t, hitTime, opts)`, `AM.twistPolygon(points, angle, lagFactor)`
- `AM.drawOpticalGlow(ctx, x, y, r, hex, inten)`, `AM.drawBloomStroke(ctx, fn, opts)`, `AM.drawSphericalLens(ctx, cx, cy, r, k, fn, opts)` (`fn(c)` scene coords; `fn(lc,sz)` `0..sz`), `AM.drawTaperedRibbon(ctx, pts, w, opts)`
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

/// Converts `(scale, rotDeg, panX, panY)` into exact `AM.applyCamera(ctx, { s, cx, cy, rot }, W, H)` args
/// matching `ref_camera_motion.py::camera_params_to_am_apply_camera`.
pub(crate) fn camera_params_to_am_apply_camera(
    scale: f64,
    rot_deg: f64,
    tx: f64,
    ty: f64,
    width: u32,
    height: u32,
) -> (f64, f64, f64, f64) {
    let s = scale.max(1e-4);
    let rad = rot_deg.to_radians();
    let a = s * rad.cos();
    let b = -s * rad.sin();
    let c = s * rad.sin();
    let d = s * rad.cos();
    let s2 = s * s;
    let cx = (width as f64) * 0.5 - (a * tx + c * ty) / s2;
    let cy = (height as f64) * 0.5 - (b * tx + d * ty) / s2;
    (s, cx, cy, rot_deg)
}

/// Builds a concise, ZERO-OCR hard-facts specification block for a single scene from `style.json`.
#[cfg(test)]
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
    build_scene_hard_facts_prompt_with_next(
        style_scene,
        None,
        film_scene,
        scene_num,
        total_scenes,
        width,
        height,
        fps,
        bpm,
        user_brief,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_scene_hard_facts_prompt_with_next(
    style_scene: Option<&Value>,
    next_style_scene: Option<&Value>,
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
            "IMPORTANT TIME MAPPING: Each 1/1 filmstrip tile is stamped `t=<local_t>s (<global_t>s) d<delta>` — the FIRST number `t=<local_t>s` (`0.00s .. {:.2}s`) is ALREADY your exact local `t` variable inside `AM.registerScene(\"{}\", function(ctx, t, dur, scene, AM))`! (Whereas `ref_scene_{:02}_beats.jpg` and comparison strips show global seconds `global_t = t + {:.3}`: global {:.2}s = local t={:.2}s early, global {:.2}s = local t={:.2}s mid, global {:.2}s = local t={:.2}s late).",
            dur,
            scene_id,
            scene_num,
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
        let mut runtime_bridge_local_spans: Vec<(f64, f64)> = Vec::new();
        for bridge_owner in [Some(sc), next_style_scene] {
            if let Some(tb) = bridge_owner.and_then(|s| s.get("transitionBridge")) {
                let kind = tb.get("kind").and_then(Value::as_str).unwrap_or("");
                if kind.starts_with("push_") || kind == "zoom_blur" {
                    if let (Some(bt0), Some(bt1)) = (
                        tb.get("tStart").and_then(Value::as_f64),
                        tb.get("tEnd").and_then(Value::as_f64),
                    ) {
                        let lo = (bt0 - start - 0.08).max(0.0);
                        let hi = (bt1 - start + 0.08).min(dur);
                        if hi > lo {
                            runtime_bridge_local_spans.push((lo, hi));
                        }
                    }
                }
            }
        }
        let mut has_measured_camera_motion = false;
        if let Some(cm) = sc.get("cameraMotion").or_else(|| sc.pointer("/layout/cameraMotion")) {
            if let Some(segs) = cm.get("segments").and_then(Value::as_array) {
                let parts: Vec<String> = segs
                    .iter()
                    .filter(|seg| seg.get("confidence").and_then(Value::as_str) != Some("low"))
                    .filter(|seg| {
                        // Skip camera segments that overlap an active runtime push_*/zoom_blur bridge
                        // so the scene script never double-pushes the canvas alongside aetheria-motion.js.
                        let t0 = seg.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                        let t1 = seg.get("t1").and_then(Value::as_f64).unwrap_or(dur);
                        let span = (t1 - t0).max(1e-3);
                        !runtime_bridge_local_spans.iter().any(|&(blo, bhi)| {
                            let ov = (t1.min(bhi) - t0.max(blo)).max(0.0);
                            ov >= span * 0.5
                        })
                    })
                    .map(|seg| {
                        let t0 = seg.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                        let t1 = seg.get("t1").and_then(Value::as_f64).unwrap_or(dur);
                        let s0 = seg.get("scaleFrom").and_then(Value::as_f64).unwrap_or(1.0);
                        let s1 = seg.get("scaleTo").and_then(Value::as_f64).unwrap_or(1.0);
                        let r0 = seg.get("rotDegFrom").and_then(Value::as_f64).unwrap_or(0.0);
                        let r1 = seg.get("rotDegTo").and_then(Value::as_f64).unwrap_or(0.0);
                        let tx0 = seg.get("txFrom").and_then(Value::as_f64).unwrap_or(0.0);
                        let ty0 = seg.get("tyFrom").and_then(Value::as_f64).unwrap_or(0.0);
                        let tx1 = seg.get("txTo").and_then(Value::as_f64).unwrap_or(0.0);
                        let ty1 = seg.get("tyTo").and_then(Value::as_f64).unwrap_or(0.0);
                        let (c0s, cx0, cy0, c0r) =
                            camera_params_to_am_apply_camera(s0, r0, tx0, ty0, width, height);
                        let (c1s, cx1, cy1, c1r) =
                            camera_params_to_am_apply_camera(s1, r1, tx1, ty1, width, height);
                        let ease_label = match seg.get("ease").and_then(Value::as_str) {
                            Some(e) if !e.trim().is_empty() => e.to_string(),
                            _ => "unmeasured (choose by role: enter=outExpo/outBack, exit=inCubic)".to_string(),
                        };
                        format!(
                            "local {:.2}s->{:.2}s scale={:.3}->{:.3} rot={:+.2}->{:+.2}deg | AM.applyCamera FROM={{s:{:.3}, cx:{:.1}, cy:{:.1}, rot:{:+.2}}} TO={{s:{:.3}, cx:{:.1}, cy:{:.1}, rot:{:+.2}}} ease={} conf={}",
                            t0,
                            t1,
                            s0,
                            s1,
                            r0,
                            r1,
                            c0s,
                            cx0,
                            cy0,
                            c0r,
                            c1s,
                            cx1,
                            cy1,
                            c1r,
                            ease_label,
                            seg.get("confidence").and_then(Value::as_str).unwrap_or("medium"),
                        )
                    })
                    .collect();
                if !parts.is_empty() {
                    has_measured_camera_motion = true;
                    lines.push(format!(
                        "MEASURED GLOBAL CAMERA MOTION (interpolate FROM -> TO into `AM.applyCamera(ctx, {{ s, cx, cy, rot }}, W, H)`): {}",
                        parts.join(" ; "),
                    ));
                }
            }
        }
        if let Some(track_block) =
            super::direct_scene_prompt_tracks::format_element_tracks_block(sc, has_measured_camera_motion)
        {
            lines.push(track_block);
        }
        if let Some(kin_block) =
            super::direct_scene_prompt_tracks::format_motion_kinematics_block(sc)
        {
            lines.push(kin_block);
        }
        if let Some(sec_block) =
            super::direct_scene_prompt_tracks::format_secondary_motion_block(sc)
        {
            lines.push(sec_block);
        }
        if let Some(blueprint_30fps) =
            super::direct_scene_prompt_tracks::format_30fps_motion_blueprint_block(
                sc,
                next_style_scene,
            )
        {
            lines.push(blueprint_30fps);
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
            if let Some(ba) = mc.get("boundaryAnchors") {
                let fmt_anchor = |a: Option<&Value>, fallback_lt: f64| -> Option<String> {
                    let obj = a?;
                    let lt = obj.get("localT").and_then(Value::as_f64).unwrap_or(fallback_lt);
                    let bg = obj.get("bgHex").and_then(Value::as_str).unwrap_or("#0C0B0E");
                    let fg = obj.get("fgHex").and_then(Value::as_str);
                    let b_str = fmt_box(obj.get("box"));
                    let c_str = obj
                        .get("center")
                        .and_then(Value::as_array)
                        .filter(|c| c.len() >= 2)
                        .and_then(|c| Some(format!("({},{})", c[0].as_i64()?, c[1].as_i64()?)));
                    match (fg, b_str, c_str) {
                        (Some(f_hex), Some(bx), Some(cx_cy)) => Some(format!(
                            "local_t={:.2}s: bg={} fg={} center={} box={}",
                            lt, bg, f_hex, cx_cy, bx
                        )),
                        _ => Some(format!("local_t={:.2}s: bg={} (clean/minimal stage)", lt, bg)),
                    }
                };
                let entry_s = fmt_anchor(ba.get("entry"), 0.0);
                let exit_s = fmt_anchor(ba.get("exit"), dur);
                if entry_s.is_some() || exit_s.is_some() {
                    lines.push(format!(
                        "BOUNDARY CONTINUITY LOCK (CRITICAL — match exact opening & closing pose so scene cuts never teleport!): OPENING [{}] | CLOSING [{}]",
                        entry_s.unwrap_or_else(|| "local_t=0.00s".to_string()),
                        exit_s.unwrap_or_else(|| format!("local_t={:.2}s", dur))
                    ));
                }
            }
            if let Some(kc) = mc.get("kineticClues").and_then(Value::as_array) {
                let clue_strs: Vec<&str> = kc.iter().filter_map(Value::as_str).take(3).collect();
                if !clue_strs.is_empty() {
                    lines.push(format!("KINETIC CLUES: {}", clue_strs.join(" | ")));
                }
            }
            if let Some(dt) = mc.get("denseTimeline").and_then(Value::as_array) {
                let mut rows: Vec<String> = Vec::new();
                for slice in dt.iter().take(8) {
                    let local_t = slice
                        .get("localT")
                        .and_then(Value::as_f64)
                        .or_else(|| {
                            slice
                                .get("t")
                                .and_then(Value::as_f64)
                                .map(|gt| (gt - start).max(0.0))
                        })
                        .unwrap_or(0.0);
                    let mut seg_parts: Vec<String> = Vec::new();
                    if let Some(objs) = slice.get("objects").and_then(Value::as_array) {
                        let obj_desc: Vec<String> = objs
                            .iter()
                            .take(3)
                            .enumerate()
                            .filter_map(|(oi, obj)| {
                                let bx = fmt_box(obj.get("box"))?;
                                let c = obj.get("center").and_then(Value::as_array)?;
                                let cx = c.first()?.as_i64()?;
                                let cy = c.get(1)?.as_i64()?;
                                Some(format!("obj{}:center=({},{}) {}", oi + 1, cx, cy, bx))
                            })
                            .collect();
                        if !obj_desc.is_empty() {
                            seg_parts.push(obj_desc.join(", "));
                        }
                    }
                    if seg_parts.is_empty() {
                        if let Some(bx) = fmt_box(slice.get("box")) {
                            seg_parts.push(format!("box={}", bx));
                        } else if let Some(bd) = slice.get("backdrop").and_then(Value::as_str) {
                            seg_parts.push(format!("backdrop={}", bd));
                        }
                    }
                    if let Some(words) = slice.get("words").and_then(Value::as_array) {
                        let w_list: Vec<&str> = words.iter().filter_map(Value::as_str).collect();
                        if !w_list.is_empty() {
                            seg_parts.push(format!("words={:?}", w_list));
                        }
                    }
                    if !seg_parts.is_empty() {
                        rows.push(format!("local_t={:.2}s: {}", local_t, seg_parts.join(" | ")));
                    }
                }
                if !rows.is_empty() {
                    lines.push(format!(
                        "DENSE SUB-BEAT TIMELINE (local_t, foreground objects, active words):\n  - {}",
                        rows.join("\n  - ")
                    ));
                }
            }
        }
        if let Some(regs) = sc.pointer("/layout/regions").and_then(Value::as_array) {
            let text_regs: Vec<String> = regs
                .iter()
                .filter(|r| r.get("kind").and_then(Value::as_str) == Some("text"))
                .take(6)
                .filter_map(|r| {
                    let txt = r.get("text").and_then(Value::as_str)?.trim();
                    if txt.is_empty() {
                        return None;
                    }
                    let (px_x, px_y, px_w, px_h) = if let Some(px) =
                        r.get("px").and_then(Value::as_array).filter(|a| a.len() >= 4)
                    {
                        (
                            px[0].as_i64()?,
                            px[1].as_i64()?,
                            px[2].as_i64()?.max(1),
                            px[3].as_i64()?.max(1),
                        )
                    } else {
                        let nx = r.get("x").and_then(Value::as_f64)?;
                        let ny = r.get("y").and_then(Value::as_f64)?;
                        let nw = r.get("w").and_then(Value::as_f64)?;
                        let nh = r.get("h").and_then(Value::as_f64)?;
                        (
                            (nx * width as f64).round() as i64,
                            (ny * height as f64).round() as i64,
                            (nw * width as f64).round().max(1.0) as i64,
                            (nh * height as f64).round().max(1.0) as i64,
                        )
                    };
                    let cx = px_x + px_w / 2;
                    let cy = px_y + px_h / 2;
                    let est_font = ((px_h as f64) * 0.88).round().max(18.0) as i64;
                    let weight = r.get("fontWeight").and_then(Value::as_str).unwrap_or("600");
                    let zone = r.get("zone").and_then(Value::as_str).unwrap_or("hero");
                    Some(format!(
                        "\"{}\" center=({},{}) box=[{},{},{}x{}] estFont≈{}px weight={} zone={}",
                        txt, cx, cy, px_x, px_y, px_w, px_h, est_font, weight, zone
                    ))
                })
                .collect();
            if !text_regs.is_empty() {
                lines.push(format!(
                    "MEASURED TYPOGRAPHY REGIONS (from hero frame — verify exact spelling visually against attached images):\n  - {}",
                    text_regs.join("\n  - ")
                ));
            }
        }
        if let Some(p_regs) = sc.pointer("/layout/phaseTextRegions").and_then(Value::as_array) {
            let phase_lines: Vec<String> = p_regs
                .iter()
                .take(6)
                .filter_map(|r| {
                    let txt = r.get("text").and_then(Value::as_str)?.trim();
                    if txt.is_empty() {
                        return None;
                    }
                    let px = r.get("px").and_then(Value::as_array).filter(|a| a.len() >= 4)?;
                    let (px_x, px_y, px_w, px_h) = (
                        px[0].as_i64()?,
                        px[1].as_i64()?,
                        px[2].as_i64()?.max(1),
                        px[3].as_i64()?.max(1),
                    );
                    let cx = px_x + px_w / 2;
                    let cy = px_y + px_h / 2;
                    let est_font = ((px_h as f64) * 0.88).round().max(18.0) as i64;
                    let lt = r.get("localT").and_then(Value::as_f64).unwrap_or(0.0);
                    Some(format!(
                        "local_t={:.2}s \"{}\" center=({},{}) box=[{},{},{}x{}] estFont≈{}px",
                        lt, txt, cx, cy, px_x, px_y, px_w, px_h, est_font
                    ))
                })
                .collect();
            if !phase_lines.is_empty() {
                lines.push(format!(
                    "OTHER PHASE TYPOGRAPHY REGIONS (EXACT measured Y & X coordinates for secondary phases — match these centers within ±15px!):\n  - {}",
                    phase_lines.join("\n  - ")
                ));
            }
        }
        if let Some(sb) = sc.get("subBeats").and_then(Value::as_array) {
            let sb_strs: Vec<&str> = sb.iter().filter_map(Value::as_str).take(3).collect();
            if !sb_strs.is_empty() {
                lines.push(format!("SUB-BEAT PHASE SHIFTS: {}", sb_strs.join(" ; ")));
            }
        }
        let is_soft_entry = sc
            .get("transitionFromPrev")
            .and_then(Value::as_str)
            .is_some_and(|v| v.eq_ignore_ascii_case("soft"))
            || sc
                .get("cutEvidence")
                .and_then(Value::as_str)
                .is_some_and(|v| v.eq_ignore_ascii_case("soft"));
        if is_soft_entry {
            lines.push("SOFT CUT TRANSITION FROM PREVIOUS SCENE: scene enters from a continuous morph/dissolve — match OPENING anchor pose at local_t=0.00s cleanly so the transition never teleports.".to_string());
        }
        if let Some(mp) = sc.get("motionProfile") {
            let mean_d = mp.get("meanDelta").and_then(Value::as_f64).unwrap_or(0.0);
            let static_pct = mp.get("staticPct").and_then(Value::as_f64).unwrap_or(0.0);
            let sheet_count = sc
                .get("filmstripSheets")
                .and_then(Value::as_array)
                .map(|a| a.len())
                .unwrap_or(0);
            let bursts: Vec<String> = mp
                .get("activeBursts")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|b| {
                            let bt0 = (b.get("tStart")?.as_f64()? - start).max(0.0);
                            let bt1 = (b.get("tEnd")?.as_f64()? - start).max(bt0);
                            let pk = b.get("peakDelta").and_then(Value::as_f64).unwrap_or(0.0);
                            Some(format!("{bt0:.2}..{bt1:.2}s(p={pk:.1})"))
                        })
                        .collect()
                })
                .unwrap_or_default();
            lines.push(format!(
                "MEASURED 1/1 MOTION PROFILE: meanDelta={mean_d:.2}, staticPct={static_pct:.1}%, activeLocalBursts=[{}], filmstripSheets={sheet_count}{}",
                bursts.join(", "),
                if sheet_count > 6 {
                    " (6 key burst-aligned sheets + 3 full-res early/mid/late keyframes attached above; call `read_filmstrip({ sceneIndex, startSheet })` for remaining sheets)"
                } else {
                    " (chronological 1/1 filmstrip sheets + 3 full-res early/mid/late keyframes attached above)"
                }
            ));
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
            "USER BRIEF: \"{}\" (Preserve the EXACT visual structure, layout, palette, iconography, on-screen words/titles, and sub-beat motion visibly shown in the attached reference frames — NEVER substitute words from the brief such as 'Aetheria' in place of the reference video's actual on-screen text unless the brief explicitly says 'change text X to Y'.)",
            clean_brief
        ));
    }

    lines.push(
        "TASK: Study ALL attached images (the chronological 1/1 filmstrip sheets + the 3 full-resolution early/mid/late keyframes). Do NOT write empty placeholder stubs — if you need exact pixel colors, do at most 1 batched `sample_ref_region` call first, then author the complete, smooth time-driven `script/sceneK.js` via `write_scene_script`, verify visually via `render_and_compare_scene` (which compares every timestamp against the exact reference video frame), and refine surgically via `patch_scene_script` until every beat and boundary matches cleanly with 0 runtime errors."
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
        let compared_count = cmp.get("comparedCount").and_then(Value::as_u64).unwrap_or(0);
        if compared_count >= 3 {
            if let Some(prev_delta) = cmp.get("meanAdjacentFrameDelta").and_then(Value::as_f64) {
                let ref_delta = cmp
                    .get("refMeanAdjacentFrameDelta")
                    .and_then(Value::as_f64)
                    .unwrap_or(2.5);
                if prev_delta < 1.2 && ref_delta >= 2.0 {
                    lines.push(format!(
                        "MOTION ACTIVITY WARNING: rendered frames across this scene are nearly static (avg frame delta={:.2} < 1.2 vs reference {:.2}) — add continuous ambient glow/ray drift, subtle AM.applyCamera breathing, and crisp spring motion!",
                        prev_delta, ref_delta
                    ));
                }
            }
        }
        if let Some(m_warn) = cmp
            .pointer("/motionDiagnostics/motionWarning")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            lines.push(m_warn.to_string());
        }
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
                if let (Some(rb_s), Some(pb_s), Some(r_arr), Some(p_arr)) = (
                    fmt_box(f.get("refFgBox")),
                    fmt_box(f.get("prevFgBox")),
                    f.get("refFgBox").and_then(Value::as_array).filter(|a| a.len() >= 4),
                    f.get("prevFgBox").and_then(Value::as_array).filter(|a| a.len() >= 4),
                ) {
                    let rx = r_arr[0].as_f64().unwrap_or(0.0);
                    let ry = r_arr[1].as_f64().unwrap_or(0.0);
                    let rw = r_arr[2].as_f64().unwrap_or(0.0);
                    let rh = r_arr[3].as_f64().unwrap_or(0.0);
                    let px = p_arr[0].as_f64().unwrap_or(0.0);
                    let py = p_arr[1].as_f64().unwrap_or(0.0);
                    let pw = p_arr[2].as_f64().unwrap_or(0.0);
                    let ph = p_arr[3].as_f64().unwrap_or(0.0);
                    let r_cx = rx + rw * 0.5;
                    let r_cy = ry + rh * 0.5;
                    let p_cx = px + pw * 0.5;
                    let p_cy = py + ph * 0.5;
                    let dx = (r_cx - p_cx).round() as i64;
                    let dy = (r_cy - p_cy).round() as i64;
                    let w_ratio = if rw > 1.0 { pw / rw } else { 1.0 };
                    let h_ratio = if rh > 1.0 { ph / rh } else { 1.0 };
                    let bad_scale = !(0.72..=1.35).contains(&w_ratio) || !(0.72..=1.35).contains(&h_ratio);
                    let bad_shift = dx.abs() >= 28 || dy.abs() >= 28;
                    if bad_scale || bad_shift {
                        let h_dir = if dx >= 0 { "RIGHT" } else { "LEFT" };
                        let v_dir = if dy >= 0 { "DOWN" } else { "UP" };
                        notes.push(format!(
                            "SCALE/POSITION MISMATCH: ref center=({:.0},{:.0}) vs your center=({:.0},{:.0}) -> SHIFT {} {}px, {} {}px! (refFgBox={} vs prevFgBox={})",
                            r_cx, r_cy, p_cx, p_cy, h_dir, dx.abs(), v_dir, dy.abs(), rb_s, pb_s
                        ));
                    }
                }
                if f_color < 0.78 {
                    notes.push(format!(
                        "COLOR/LUMINANCE DRIFT (color={:.2}): match Row 1's actual fill brightness & saturation (avoid dark gaps or muted outlines where Row 1 is luminous/solid)",
                        f_color
                    ));
                }
                if let Some(zones) = f.get("worstZones").and_then(Value::as_array) {
                    let z_strs: Vec<&str> = zones.iter().filter_map(Value::as_str).take(2).collect();
                    if !z_strs.is_empty() {
                        notes.push(format!("HOTSPOT MISMATCH: {}", z_strs.join(" ; ")));
                    }
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

    // 3. Un-enveloped phase-offset sine wave inside a time window (`Math.sin(i * ... - waveT)` without `* Math.PI` envelope)
    let has_indexed_wave = (code.contains("Math.sin(i *") || code.contains("Math.sin(idx *") || code.contains("Math.sin(phase)"))
        && (code.contains("if (t >=") || code.contains("if (t >"));
    let has_window_envelope = code.contains("* Math.PI)") || code.contains("env *") || code.contains("* env");
    if has_indexed_wave && !has_window_envelope {
        hazards.push(
            "MOTION JUMP HAZARD (Un-Enveloped Wave Oscillation): `Math.sin(i * phase - ...)` inside an `if (t >= t0)` window jumps discontinuously at `t = t0` because `sin(i * phase) != 0`! Multiply wave amplitude by a smooth window envelope `var env = Math.sin(AM.clamp((t - t0) / (t1 - t0), 0, 1) * Math.PI);` so displacement starts and ends smoothly at 0."
                .to_string(),
        );
    }

    // 4. Unused animation/progress parameter in a helper function (e.g. `function drawHoppingArc(..., progress, ...)` where `progress` is never used inside `{ ... }`)
    for (fn_name, param_name) in find_unused_progress_params(code) {
        hazards.push(format!(
            "FROZEN ANIMATION BUG (Unused Progress Parameter): Helper `function {}(..., {}, ...)` accepts animation parameter `{}` but NEVER uses `{}` inside its body — causing the shape to freeze statically and then teleport! Use `{}` inside `{}` (e.g. `var u = (step / 32) * {};` or `ctx.setLineDash([len * {}, len]);`) so the stroke/arc animates continuously.",
            fn_name, param_name, param_name, param_name, param_name, fn_name, param_name, param_name
        ));
    }

    // 5. Unused time-progress local variable (e.g. `var traceProgress = ...` computed from `t` and never read anywhere else)
    for var_name in find_unused_progress_vars(code) {
        hazards.push(format!(
            "FROZEN ANIMATION BUG (Unused Progress Variable): Variable `{}` is computed from time `t` but NEVER read in any drawing call — your shape is drawn 100% static instead of animating! Pass or apply `{}` to animate position, scale, arc span, or `ctx.setLineDash([perim * {}, perim])`.",
            var_name, var_name, var_name
        ));
    }

    // 6. Duplicate function declarations in the same script (from sloppy partial overwrites)
    for dup_fn in find_duplicate_function_declarations(code) {
        hazards.push(format!(
            "DUPLICATE CODE HAZARD: `function {}` is declared more than once in this script (dead overwritten code) — remove the duplicate declaration so only one clean definition exists.",
            dup_fn
        ));
    }

    // 7. Raw `ctx.fillText(...)` timed text reveals (either with manual uniform `ctx.filter = 'blur(...)'` OR plain alpha pop)
    //    instead of progressive character-by-character `AM.drawBlurRevealText` / `AM.drawBlurRiseWords`
    let has_manual_blur_filter = code.contains("filter = 'blur(")
        || code.contains("filter = \"blur(")
        || code.contains("filter = `blur(");
    let uses_blur_text_helper =
        code.contains("drawBlurRevealText") || code.contains("drawBlurRiseWords");
    let fill_text_count = code.matches("fillText(").count();
    let has_timed_text_gate = (code.contains("if (t >=") || code.contains("if (t >") || code.contains("if (t <"))
        && fill_text_count >= 3;
    if !uses_blur_text_helper && ((has_manual_blur_filter && fill_text_count >= 1) || has_timed_text_gate) {
        hazards.push(
            "STIFF TEXT REVEAL HAZARD (Raw `ctx.fillText` Pop/Fade Instead of Character Blur Reveal): Your script reveals timed words/phrases via raw `ctx.fillText(...)` (causing whole words to pop/fade stiffly) without calling `AM.drawBlurRevealText` or `AM.drawBlurRiseWords`! Replace animated headline/copy `ctx.fillText(...)` calls with `AM.drawBlurRevealText(ctx, word, x, y, t, tStart, dur, { scaleFrom: 0.72, maxBlur: 16, risePx: 12, color, preBlurSec: 0.14, exitAt, exitDur: 0.26 })` or `AM.drawBlurRiseWords(...)` so EVERY word enters character-by-character out of optical blur AND exits into blur (keep raw `ctx.fillText` ONLY for rolling numeric counters)."
                .to_string(),
        );
    }

    // 8. Static 3D hero object helper (`draw...Brain`, `draw...Globe`, `draw...Coin`, `draw...Sphere`) without `AM.drawTurntableObject`
    for static_3d_fn in find_static_3d_object_functions(code) {
        if !code.contains("drawTurntableObject") {
            hazards.push(format!(
                "STATIC 3D OBJECT HAZARD (`function {}` Does Not Rotate in 3D): `{}` is drawn as a static 2D illustration without 3D Y-axis turntable rotation! Wrap `{}` inside `AM.drawTurntableObject(ctx, cx, cy, t, function(c) {{ {}(c, 0, 0, 1.0); }}, {{ w: 280, h: 240, omega: 2.1, depth: 0.22, ringRadius: 158, ringOmega: 0.65 }})` so the 3D hemisphere surface and folds genuinely rotate in 3D.",
                static_3d_fn, static_3d_fn, static_3d_fn, static_3d_fn
            ));
        }
    }

    // 9. Chained zero-velocity easing segments (stop-start stiffness mid-zoom or mid-expansion)
    if has_chained_zero_velocity_easing(code) {
        hazards.push(
            "CHAINED STOP-START EASING HAZARD (Zero-Velocity Plateau Mid-Motion): Your script chains multiple `if/else` segments with `AM.ease.outCubic` back-to-back or chains `AM.ease.inOutCubic` directly into `AM.ease.inCubic`, forcing velocity to drop to 0 mid-motion and causing a robotic 3-4 frame pause! Merge each unified zoom/expansion into ONE continuous curve (`AM.ease.inOutCubic`, `AM.ease.outExpo`, `AM.spring`, or `AM.bezier`) with continuous velocity."
                .to_string(),
        );
    }

    // 10. Frozen morph early-return cutoff (`if (morph... > 0.01) { ... return; }`)
    if has_frozen_morph_early_return(code) {
        hazards.push(
            "FROZEN MORPH CUTOFF HAZARD: Early `return;` inside `if (morph... > 0.01)` skips actual shape interpolation and causes an abrupt 1-frame pop! Interpolate corner radius or vertices smoothly with `AM.lerp` / `AM.drawMorphPolygon` across the entire morph window."
                .to_string(),
        );
    }

    // 11. Stepped curve/ribbon truncation (`Math.floor(steps * progress)`)
    if code.contains("Math.floor(steps *")
        || code.contains("Math.floor(numSteps *")
        || code.contains("Math.floor(totalSteps *")
    {
        hazards.push(
            "STEPPED CURVE TRUNCATION HAZARD: Using `Math.floor(steps * progress)` makes curves/ribbons advance in choppy discrete jumps! Compute `var exact = steps * progress; var full = Math.floor(exact);` and smoothly draw the fractional final tip segment."
                .to_string(),
        );
    }

    // 12. Dummy zero-omega turntable wrapper on flat 2D objects
    if has_zero_omega_turntable(code) {
        hazards.push(
            "DUMMY ZERO-OMEGA TURNTABLE HAZARD: `AM.drawTurntableObject(..., { omega: 0 })` must NEVER be used to wrap flat 2D icons, targets, stars, or puzzle pieces! Draw flat 2D shapes directly with standard Canvas 2D transforms (`ctx.rotate` / `ctx.scale`), and reserve `AM.drawTurntableObject` strictly for genuinely rotating 3D objects."
                .to_string(),
        );
    }

    hazards
}

/// Generic 30fps motion expectations extracted directly from `style.json` for a scene
/// so hazard checks are driven by measured video kinematics rather than guessed helper names.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SceneMotionExpectations {
    pub requires_turntable_3d: bool,
    pub requires_corner_spin: bool,
    pub requires_blur_text_reveal: bool,
    pub pre_cut_active: bool,
    pub has_incoming_push_bridge: bool,
    pub has_living_hold: bool,
}

impl SceneMotionExpectations {
    pub(crate) fn from_style_scene(style_sc: Option<&Value>) -> Self {
        let Some(sc) = style_sc else {
            return Self::default();
        };
        let spinning = sc
            .pointer("/motionTimeline30fps/spinningObjects")
            .and_then(Value::as_array);
        let requires_turntable_3d = spinning.is_some_and(|arr| {
            arr.iter().any(|item| {
                matches!(
                    item.get("kind").and_then(Value::as_str),
                    Some("turntable_3d" | "turntable_3d_and_ring_spin")
                )
            })
        });
        let secondary_rotate = sc
            .pointer("/motionClues/secondaryMotion")
            .or_else(|| sc.pointer("/layout/motionClues/secondaryMotion"))
            .and_then(Value::as_array)
            .is_some_and(|arr| {
                arr.iter()
                    .any(|item| item.get("kind").and_then(Value::as_str) == Some("rotate"))
            });
        let requires_corner_spin = secondary_rotate
            || spinning.is_some_and(|arr| {
                arr.iter()
                    .any(|item| item.get("kind").and_then(Value::as_str) == Some("corner_spin"))
            });
        let requires_blur_text_reveal = sc
            .pointer("/motionTimeline30fps/blurTextReveals")
            .and_then(Value::as_array)
            .is_some_and(|arr| !arr.is_empty());
        let pre_cut_active = sc
            .pointer("/motionClues/kinematics/preCutActive")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let has_incoming_push_bridge = sc
            .pointer("/transitionBridge/kind")
            .and_then(Value::as_str)
            .is_some_and(|k| k.starts_with("push_"));
        let has_living_hold = sc
            .pointer("/motionClues/kinematics/hasLivingHold")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Self {
            requires_turntable_3d,
            requires_corner_spin,
            requires_blur_text_reveal,
            pre_cut_active,
            has_incoming_push_bridge,
            has_living_hold,
        }
    }
}

/// Runs static code hygiene checks PLUS 30fps signal-driven motion compliance checks
/// (3D turntable rotation, spinning corner emblems, blur-to-sharp text reveals,
/// incoming push-bridge redraw guard, and living-hold dashed-outline check).
pub(crate) fn detect_scene_motion_hazards(
    code: &str,
    expectations: SceneMotionExpectations,
) -> Vec<String> {
    let mut hazards = detect_scene_collision_hazards(code);
    if expectations.requires_turntable_3d
        && !code.contains("drawTurntableObject")
        && !hazards.iter().any(|h| h.contains("STATIC 3D OBJECT HAZARD"))
    {
        hazards.push(
            "MISSING 3D TURNTABLE HAZARD: 30fps motion analysis detected a rotating 3D hero object in this scene, but your script does NOT call `AM.drawTurntableObject(...)`! Wrap your hero image or draw callback inside `AM.drawTurntableObject(ctx, cx, cy, t, heroImgOrFn, { w, h, omega: 2.0, depth: 0.24, ringRadius, ringOmega: 0.65 })` so it genuinely spins 360° in 3D."
                .to_string(),
        );
    }
    if expectations.requires_corner_spin
        && !code.contains(".rotate(")
        && !code.contains("drawTurntableObject")
    {
        hazards.push(
            "MISSING CORNER SPIN HAZARD: 30fps motion analysis detected a spinning corner emblem/icon in this scene, but your script has no `ctx.rotate(...)` or `AM.drawTurntableObject(...)` call! Rotate the corner graphic smoothly with `ctx.rotate(t * omega)`."
                .to_string(),
        );
    }
    if expectations.requires_blur_text_reveal
        && !code.contains("drawBlurRevealText")
        && !code.contains("drawBlurRiseWords")
        && !hazards.iter().any(|h| h.contains("STIFF TEXT REVEAL HAZARD"))
    {
        hazards.push(
            "MISSING BLUR TEXT REVEAL HAZARD: 30fps motion analysis detected blur-to-sharp text reveal(s) in this scene, but your script does NOT call `AM.drawBlurRevealText(...)` or `AM.drawBlurRiseWords(...)`! Replace plain `ctx.fillText(...)` reveals with `AM.drawBlurRevealText(...)`."
                .to_string(),
        );
    }
    if expectations.has_incoming_push_bridge && has_manual_prev_scene_exit_redraw(code) {
        hazards.push(
            "DOUBLE-PUSH / REDRAWN PREVIOUS SCENE HAZARD: This scene already has a runtime `push_*` `transitionBridge` in `film.json` that slides the real previous scene out seamlessly! Remove your manual `if (t < 0.3)` previous-scene exit-slide redraw block so the transition never jump-cuts or double-pushes."
                .to_string(),
        );
    }
    if expectations.has_living_hold
        && code.contains("setLineDash(")
        && !code.contains("lineDashOffset")
        && !code.contains("Math.sin(")
        && !code.contains(".rotate(")
        && !code.contains("drawTurntableObject")
    {
        hazards.push(
            "FROZEN DASHED OUTLINE HAZARD: `hasLivingHold` is true and your script draws dashed outlines via `ctx.setLineDash(...)`, but never animates `ctx.lineDashOffset = -t * 28`! Animate `lineDashOffset` continuously so dashed selection boxes/rings stay alive during the hold."
                .to_string(),
        );
    }
    hazards
}

fn has_manual_prev_scene_exit_redraw(code: &str) -> bool {
    let lines: Vec<&str> = code.lines().collect();
    for (idx, line) in lines.iter().enumerate() {
        let lower = line.to_ascii_lowercase();
        let is_early_t_gate = lower.contains("if (t < 0.") || lower.contains("if (t <= 0.");
        if !is_early_t_gate {
            continue;
        }
        let prev_comment = if idx > 0 {
            lines[idx - 1].to_ascii_lowercase()
        } else {
            String::new()
        };
        let end = (idx + 12).min(lines.len());
        let window = lines[idx..end].join("\n").to_ascii_lowercase();
        let mentions_prev = prev_comment.contains("previous scene")
            || prev_comment.contains("prev scene")
            || window.contains("previous scene")
            || window.contains("prevscene");
        let mentions_exit_slide = (window.contains("exitp") || window.contains("slidex") || window.contains("slidey"))
            && window.contains(".translate(");
        if mentions_prev && mentions_exit_slide {
            return true;
        }
    }
    false
}

fn is_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn count_ident_occurrences(haystack: &str, ident: &str) -> usize {
    if ident.is_empty() {
        return 0;
    }
    let hb = haystack.as_bytes();
    let ib = ident.as_bytes();
    if ib.len() > hb.len() {
        return 0;
    }
    let mut count = 0usize;
    let mut i = 0usize;
    while i + ib.len() <= hb.len() {
        if &hb[i..i + ib.len()] == ib {
            let left_ok = i == 0 || !is_ident_char(hb[i - 1]);
            let right_ok = i + ib.len() == hb.len() || !is_ident_char(hb[i + ib.len()]);
            if left_ok && right_ok {
                count += 1;
                i += ib.len();
                continue;
            }
        }
        i += 1;
    }
    count
}

fn find_unused_progress_params(code: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut cursor = code;
    while let Some(idx) = cursor.find("function ") {
        let after_kw = &cursor[idx + "function ".len()..];
        let Some(open_p) = after_kw.find('(') else {
            break;
        };
        let fn_name = after_kw[..open_p].trim();
        let after_open = &after_kw[open_p + 1..];
        let Some(close_p) = after_open.find(')') else {
            break;
        };
        let params_str = &after_open[..close_p];
        let after_close = &after_open[close_p + 1..];
        let Some(open_b) = after_close.find('{') else {
            cursor = after_close;
            continue;
        };
        let body_start = &after_close[open_b + 1..];
        let mut depth = 1i32;
        let mut end_offset = None;
        for (bi, ch) in body_start.char_indices() {
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    end_offset = Some(bi);
                    break;
                }
            }
        }
        let Some(body_end) = end_offset else {
            break;
        };
        let body = &body_start[..body_end];
        if !fn_name.is_empty() && fn_name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            let fn_lower = fn_name.to_ascii_lowercase();
            let is_draw_helper = fn_lower.starts_with("draw") || fn_lower.starts_with("render");
            for raw_p in params_str.split(',') {
                let p = raw_p.trim();
                let lower = p.to_ascii_lowercase();
                let is_progress_param = lower == "progress"
                    || lower == "prog"
                    || lower.ends_with("progress")
                    || lower.ends_with("prog")
                    || (is_draw_helper && matches!(lower.as_str(), "t" | "time" | "localt"));
                if is_progress_param && count_ident_occurrences(body, p) == 0 {
                    out.push((fn_name.to_string(), p.to_string()));
                }
            }
        }
        cursor = &body_start[body_end + 1..];
    }
    out
}

fn find_unused_progress_vars(code: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    for stmt in code.split(['\n', ';']) {
        let trimmed = stmt.trim();
        for kw in ["var ", "let ", "const "] {
            if let Some(rest) = trimmed.strip_prefix(kw) {
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                let lower = name.to_ascii_lowercase();
                if (lower.ends_with("progress") || lower == "traceprog" || lower == "arcp")
                    && !candidates.contains(&name)
                {
                    candidates.push(name);
                }
            }
        }
    }
    let mut unused = Vec::new();
    for name in candidates {
        // Count how many statements read `name` on the right-hand side or inside function args
        let mut rhs_reads = 0usize;
        for stmt in code.split(['\n', ';']) {
            if count_ident_occurrences(stmt, &name) == 0 {
                continue;
            }
            let t = stmt.trim();
            // Skip pure declaration `var traceProgress = 0` or pure assignment `traceProgress = ...` where `name` only appears on LHS
            let is_decl_lhs = ["var ", "let ", "const "]
                .iter()
                .any(|kw| t.starts_with(&format!("{}{}", kw, name)));
            let is_assign_lhs = t.starts_with(&name)
                && t[name.len()..].trim_start().starts_with('=')
                && !t[name.len()..].trim_start().starts_with("==");
            if is_decl_lhs || is_assign_lhs {
                if let Some((_, rhs)) = t.split_once('=') {
                    if count_ident_occurrences(rhs, &name) > 0 {
                        rhs_reads += 1;
                    }
                }
            } else {
                rhs_reads += 1;
            }
        }
        if rhs_reads == 0 {
            unused.push(name);
        }
    }
    unused
}

fn find_duplicate_function_declarations(code: &str) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut dups = Vec::new();
    for line in code.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("function ") {
            let name: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() && !seen.insert(name.clone()) && !dups.contains(&name) {
                dups.push(name);
            }
        }
    }
    dups
}

fn has_chained_zero_velocity_easing(code: &str) -> bool {
    let out_cubic_count = code.matches("AM.ease.outCubic(").count() + code.matches("AM.E.outC(").count();
    let else_if_t_count = code.matches("else if (t ").count() + code.matches("else if (t>").count() + code.matches("else if (t<").count();
    if out_cubic_count >= 4 && else_if_t_count >= 3 {
        return true;
    }
    let lines: Vec<&str> = code.lines().collect();
    for (idx, line) in lines.iter().enumerate() {
        if line.contains("AM.ease.inOutCubic(") || line.contains("AM.E.ioC(") {
            let end = (idx + 14).min(lines.len());
            let mut saw_else = line.contains("} else") || line.contains(" else {");
            for next in &lines[idx + 1..end] {
                let tr = next.trim();
                if tr.starts_with("} else") || tr == "else {" || tr.contains("} else {") {
                    saw_else = true;
                } else if saw_else && (tr.contains("AM.ease.inCubic(") || tr.contains("AM.E.inC(")) {
                    return true;
                }
            }
        }
    }
    false
}

fn has_frozen_morph_early_return(code: &str) -> bool {
    let lines: Vec<&str> = code.lines().collect();
    for (idx, line) in lines.iter().enumerate() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("if (") && lower.contains("morph") && (lower.contains("> 0.0") || lower.contains(">= 0.0")) {
            let end = (idx + 7).min(lines.len());
            if lines[idx..end].iter().any(|l| l.trim() == "return;" || l.contains("return;")) {
                return true;
            }
        }
    }
    false
}

fn has_zero_omega_turntable(code: &str) -> bool {
    if !code.contains("drawTurntableObject(") {
        return false;
    }
    let compact: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    compact.contains("omega:0,")
        || compact.contains("omega:0}")
        || compact.contains("omega:0.0,")
        || compact.contains("omega:0.0}")
}

fn find_static_3d_object_functions(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in code.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("function ") {
            let Some(open_p) = rest.find('(') else {
                continue;
            };
            let name = rest[..open_p].trim();
            let lower = name.to_ascii_lowercase();
            let is_3d_hero = (lower.starts_with("draw") || lower.starts_with("render"))
                && (lower.contains("brain")
                    || lower.contains("globe")
                    || lower.contains("sphere")
                    || lower.contains("coin")
                    || lower.contains("head")
                    || lower.contains("planet"));
            if is_3d_hero && !out.contains(&name.to_string()) {
                out.push(name.to_string());
            }
        }
    }
    out
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

        let static_cmp = json!({
            "overallFidelity": 0.72,
            "ssimMean": 0.80,
            "colorMatchMean": 0.85,
            "edgeMatchMean": 0.40,
            "comparedCount": 4,
            "meanAdjacentFrameDelta": 0.65,
            "refMeanAdjacentFrameDelta": 3.40,
            "perFrame": []
        });
        let (_, static_fb, _) = format_comparison_feedback(Some(&static_cmp), 0.0, &[], None);
        assert!(static_fb.contains("MOTION ACTIVITY WARNING"));
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

        let bad_arc = "function drawHoppingArc(ctx, x1, x2, progress) { ctx.moveTo(x1, 0); ctx.lineTo(x2, 0); }\nvar traceProgress = 0; traceProgress = AM.clamp(t / 0.75, 0, 1); ctx.stroke();";
        let h3 = detect_scene_collision_hazards(bad_arc);
        assert!(h3.iter().any(|s| s.contains("Unused Progress Parameter") && s.contains("drawHoppingArc")));
        assert!(h3.iter().any(|s| s.contains("Unused Progress Variable") && s.contains("traceProgress")));

        let dup_fn = "function draw3DStar(cx, cy) { ctx.fill(); }\nfunction draw3DStar(cx, cy) { ctx.stroke(); }";
        let h4 = detect_scene_collision_hazards(dup_fn);
        assert!(h4.iter().any(|s| s.contains("DUPLICATE CODE HAZARD") && s.contains("draw3DStar")));

        let chained = "if (p <= 0.6) { var e1 = AM.ease.inOutCubic(u1); } else {\n var e2 = AM.ease.inCubic(u2);\n}";
        assert!(
            detect_scene_collision_hazards(chained)
                .iter()
                .any(|s| s.contains("CHAINED STOP-START EASING HAZARD"))
        );

        let frozen_morph = "if (morphCircle > 0.01) {\n ctx.arc(0,0,50,0,6.28);\n ctx.fill();\n return;\n}";
        assert!(
            detect_scene_collision_hazards(frozen_morph)
                .iter()
                .any(|s| s.contains("FROZEN MORPH CUTOFF HAZARD"))
        );

        let stepped = "var maxStep = Math.floor(steps * progress);";
        assert!(
            detect_scene_collision_hazards(stepped)
                .iter()
                .any(|s| s.contains("STEPPED CURVE TRUNCATION HAZARD"))
        );

        let dummy_tt = "AM.drawTurntableObject(ctx, 360, 640, t, drawFn, { w: 200, h: 200, omega: 0.0, ringRadius: 0 });";
        assert!(
            detect_scene_collision_hazards(dummy_tt)
                .iter()
                .any(|s| s.contains("DUMMY ZERO-OMEGA TURNTABLE HAZARD"))
        );
    }

    #[test]
    fn detect_scene_motion_hazards_uses_30fps_signals_generically() {
        let style_sc = json!({
            "motionTimeline30fps": {
                "spinningObjects": [
                    { "zone": "center", "kind": "turntable_3d", "omegaRadPerSec": 2.0 },
                    { "zone": "top_left", "kind": "corner_spin", "omegaRadPerSec": 1.6 }
                ],
                "blurTextReveals": [
                    { "tStart": 0.4, "tEnd": 0.9 }
                ]
            },
            "motionClues": { "kinematics": { "preCutActive": true } }
        });
        let exp = SceneMotionExpectations::from_style_scene(Some(&style_sc));
        assert!(exp.requires_turntable_3d);
        assert!(exp.requires_corner_spin);
        assert!(exp.requires_blur_text_reveal);
        assert!(exp.pre_cut_active);

        let static_code = "AM.registerScene('s', function(ctx,t){ ctx.drawImage(img, 100, 100); ctx.fillText('hi', 100, 200); });";
        let hz = detect_scene_motion_hazards(static_code, exp);
        assert!(hz.iter().any(|h| h.contains("MISSING 3D TURNTABLE HAZARD")));
        assert!(hz.iter().any(|h| h.contains("MISSING CORNER SPIN HAZARD")));
        assert!(hz.iter().any(|h| h.contains("MISSING BLUR TEXT REVEAL HAZARD")));

        let animated_code = "AM.registerScene('s', function(ctx,t){ AM.drawTurntableObject(ctx, 360, 500, t, img, { w: 300, h: 260 }); AM.drawBlurRevealText(ctx, 'hi', 100, 200, t, 0.4, 0.5); });";
        let clean = detect_scene_motion_hazards(animated_code, exp);
        assert!(clean.is_empty(), "expected 0 hazards when primitives used, got {:?}", clean);

        // Regression tests for Run 12 findings:
        // 1. Unused `t` in draw helper (`drawSweepingRibbon(ctx, t)`)
        let frozen_ribbon = "function drawSweepingRibbon(ctx, t) { ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(100,100); ctx.stroke(); }";
        assert!(
            detect_scene_collision_hazards(frozen_ribbon)
                .iter()
                .any(|h| h.contains("Unused Progress Parameter") && h.contains("drawSweepingRibbon"))
        );

        // 2. Manual previous-scene exit slide when runtime push_* transitionBridge is active
        let push_sc = json!({
            "transitionBridge": { "kind": "push_left" },
            "motionClues": { "kinematics": { "hasLivingHold": true } }
        });
        let push_exp = SceneMotionExpectations::from_style_scene(Some(&push_sc));
        assert!(push_exp.has_incoming_push_bridge);
        assert!(push_exp.has_living_hold);
        let double_push_code = "// Transition out previous scene elements\nif (t < 0.28) { var exitP = t / 0.24; var slideX = -exitP * 720; ctx.translate(slideX, 0); }\nctx.setLineDash([4,4]); ctx.strokeRect(0,0,100,50);";
        let push_hz = detect_scene_motion_hazards(double_push_code, push_exp);
        assert!(push_hz.iter().any(|h| h.contains("DOUBLE-PUSH / REDRAWN PREVIOUS SCENE HAZARD")));
        assert!(push_hz.iter().any(|h| h.contains("FROZEN DASHED OUTLINE HAZARD")));
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

    #[test]
    fn hard_facts_prompt_emits_dense_timeline_typography_regions_and_converted_camera() {
        let (s, cx, cy, rot) = camera_params_to_am_apply_camera(1.2, 0.0, 60.0, -30.0, 720, 1280);
        assert!((s - 1.2).abs() < 1e-6);
        assert!((cx - 310.0).abs() < 1e-6);
        assert!((cy - 665.0).abs() < 1e-6);
        assert!(rot.abs() < 1e-6);

        let style_sc = json!({
            "start": 4.967,
            "duration": 2.4,
            "cutEvidence": "soft",
            "transitionFromPrev": "soft",
            "subBeats": ["early@5.12s:[Finding form] -> late@7.15s:[White capsule]"],
            "motionClues": {
                "kineticClues": ["t=5.50s star morphs into wide capsule"],
                "denseTimeline": [{
                    "t": 5.5,
                    "localT": 0.533,
                    "objects": [
                        { "center": [360, 420], "box": [320, 380, 80, 80] },
                        { "center": [360, 562], "box": [190, 520, 340, 84] }
                    ],
                    "words": ["Finding", "form"]
                }]
            },
            "cameraMotion": {
                "segments": [{
                    "t0": 0.0, "t1": 2.4,
                    "scaleFrom": 1.0, "scaleTo": 1.2,
                    "rotDegFrom": 0.0, "rotDegTo": 0.0,
                    "txFrom": 0.0, "tyFrom": 0.0, "txTo": 60.0, "tyTo": -30.0,
                    "ease": "inOutCubic", "confidence": "high"
                }]
            },
            "layout": {
                "regions": [{
                    "kind": "text",
                    "zone": "hero",
                    "text": "Finding form",
                    "fontWeight": "600",
                    "px": [190, 520, 340, 84]
                }]
            }
        });
        let film_sc = json!({ "id": "scene3_proof", "start": 4.967, "duration": 2.4 });
        let prompt = build_scene_hard_facts_prompt(
            Some(&style_sc),
            &film_sc,
            3,
            9,
            720,
            1280,
            30,
            120.0,
            "Reconstruct reference motion",
        );
        assert!(prompt.contains("DENSE SUB-BEAT TIMELINE"));
        assert!(prompt.contains("local_t=0.53s: obj1:center=(360,420) [320,380,80x80], obj2:center=(360,562) [190,520,340x84] | words=[\"Finding\", \"form\"]"));
        assert!(prompt.contains("MEASURED TYPOGRAPHY REGIONS"));
        assert!(prompt.contains("\"Finding form\" center=(360,562) box=[190,520,340x84] estFont≈74px weight=600 zone=hero"));
        assert!(prompt.contains("AM.applyCamera FROM={s:1.000, cx:360.0, cy:640.0, rot:+0.00} TO={s:1.200, cx:310.0, cy:665.0, rot:+0.00}"));
        assert!(prompt.contains("SOFT CUT TRANSITION FROM PREVIOUS SCENE"));
        assert!(prompt.contains("KINETIC CLUES"));
        assert!(prompt.contains("SUB-BEAT PHASE SHIFTS"));
    }

    #[test]
    fn suppresses_camera_motion_segment_overlapping_outgoing_push_bridge() {
        let style_sc = json!({
            "start": 9.543,
            "duration": 4.101,
            "cameraMotion": {
                "segments": [
                    {
                        "t0": 0.50, "t1": 1.10,
                        "scaleFrom": 1.0, "scaleTo": 1.12,
                        "rotDegFrom": 0.0, "rotDegTo": 0.0,
                        "txFrom": 0.0, "tyFrom": 0.0, "txTo": 0.0, "tyTo": -40.0,
                        "ease": "outCubic", "confidence": "high"
                    },
                    {
                        "t0": 3.87, "t1": 4.071,
                        "scaleFrom": 1.0, "scaleTo": 1.0,
                        "rotDegFrom": 0.0, "rotDegTo": 0.0,
                        "txFrom": 0.0, "tyFrom": -25.0, "txTo": 0.0, "tyTo": -688.0,
                        "ease": "inCubic", "confidence": "high"
                    }
                ]
            }
        });
        let next_sc = json!({
            "start": 13.644,
            "duration": 2.049,
            "transitionBridge": {
                "kind": "push_up",
                "tStart": 13.347,
                "tEnd": 14.181,
                "durationSec": 0.868
            }
        });
        let film_sc = json!({ "id": "scene4_cta", "start": 9.543, "duration": 4.101 });
        let prompt = build_scene_hard_facts_prompt_with_next(
            Some(&style_sc),
            Some(&next_sc),
            &film_sc,
            4,
            6,
            720,
            1280,
            30,
            120.0,
            "Reconstruct reference motion",
        );
        assert!(prompt.contains("local 0.50s->1.10s"), "non-overlapping intra-scene camera motion should be kept");
        assert!(
            !prompt.contains("local 3.87s->4.07s"),
            "outgoing push_up overlap segment must be omitted to prevent double-push: {}",
            prompt
        );
        assert!(prompt.contains("OUTGOING 30FPS TRANSITION (push_up"));
    }
}
