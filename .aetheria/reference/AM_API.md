# window.AM Runtime API Reference (`/script/aetheria-motion.js`)

Single source of truth for deterministic motion helpers on `window.AM` (also `window.AetheriaMotion`).
Do NOT call `Math.random()`, `Date.now()`, `performance.now()`, `requestAnimationFrame`, `setTimeout`, or `setInterval`.

## Scene Registration & Playback Resolution
- `AM.registerScene(idOrIndex, fn)` — register `(ctx, localTime, dur, scene, AM) => void` for scene ID (`"scene1_hook"`), 1-based (`"scene1"`), or 0-based index (`0`).
- `AM.getSceneRenderer(sceneId, index)` — look up registered scene renderer (auto-dispatched by managed `index.html`).
- `AM.resolveScene(t, scenes)` — resolve `{ scene, index, localTime }` at global time `t` seconds.
- `AM.evalCurve(curve, u)` — linearly sample a normalized `[0..1]` monotonic curve array at `u` (falls back to `AM.ease.inOutCubic`).
- `AM.resolveTransition(t, scenes)` — resolves active `push_*` cross-scene transition bridge (`{ kind, fromScene, toScene, fromLocalTime, toLocalTime, progress }`) or `null` (also bypassed when `window.__isolateSceneTransition === true`).
- `AM.renderFrameWithTransitions(ctx, sec, scenes, W = 1080, H = 1920, renderSceneFn)` — composites outgoing + incoming scenes during `push_*` transition bridges or renders single resolved scene otherwise.

## Math, Interpolation & Color
- `AM.TAU` (`Math.PI * 2`), `AM.f3(v)` (round to 3 decimals)
- `AM.clamp(v, min = 0, max = 1)`
- `AM.lerp(a, b, t)`
- `AM.invLerp(a, b, v)` / `AM.inv(a, b, v)` — normalized `(v - a) / (b - a)` clamped to `[0, 1]`
- `AM.remap(v, inMin, inMax, outMin, outMax, easeFn?)`
- `AM.smoothstep(edge0, edge1, x)`
- `AM.hump(u)` — symmetric bell pulse (`sin(pi * clamp(u, 0, 1))`)
- `AM.crisp(t, k = 0.08, fps = 30)` — snapped step quantizer for crisp frame hits
- `AM.arcP(P0, P1, H, q)` — parabolic 2D arc between `[x0, y0]` and `[x1, y1]` with height `H` at progress `q`
- `AM.mixHex(a, b, k)` — linear RGB mix between 6-digit `#rrggbb` hex strings (`k` in `0..1`)
- `AM.hexAlpha(hex, alpha)` — convert `#rrggbb` + alpha (`0..1`) to `rgba(...)`

## Deterministic Seeded PRNG & Noise
- `AM.rand(seed)` — deterministic float in `[0, 1)` from numeric/string seed
- `AM.rng(seed = 1)` — returns stateful deterministic `() => number` generator
- `AM.noise1D(x, seed = 0)` — smooth 1D gradient noise in `[-1, 1]`
- `AM.noise2D(x, y, seed = 0)` — smooth 2D gradient noise in `[-1, 1]`

## Easing & Spring Physics
- `AM.bezier(x1, y1, x2, y2)` — returns cubic-bezier easing `(u) => y`
- `AM.ease` — `{ linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, outQuart, inOutQuart, outQuint, inOutQuint, outExpo, inOutExpo, inBack, outBack, outElastic, outBounce, pop, snap, aeGlide, aeSnap }`
- `AM.E` — shorthand aliases `{ inQ, outQ, ioQ, inC, outC, ioC, outQt, ioQt, outQn, ioQn, outX, outB, inB, pop, snap, aeGlide, aeSnap }`
- `AM.spring(t, fOrOpts = 2, z = 0.4)` — damped spring `0 -> 1` (accepts `(t, fHz, zeta)` or `(t, { stiffness, damping, mass })`)
- `AM.springV(t, f = 2, z = 0.4)` — closed-form spring derivative (velocity)
- `AM.kick(t, t0 = 0, f = 3, z = 0.35)` — damped impulse wave (`0 -> peak -> 0`) starting at `t0`
- `AM.pop(t, t0 = 0, f = 2.4, z = 0.42, amt = 0.12, pin = 0.9)` — returns `[scale, k]` pinned to `[1, 0]` after `pin` s (`scaleX = scale / (1 + k)`, `scaleY = scale * (1 + k)`)
- `AM.anticipation(p, dip = 0.12)` — pull-back before forward burst (`p` in `0..1`)
- `AM.stagger(t, index, startTime = 0, stepDelay = 0.08, duration = 0.45, easeFn?)`
- `AM.squashStretch(v, amount = 0.12)` — returns `{ sx, sy }` preserving area from velocity `v`

## SVG Scene-Graph Helpers
- `AM.el(tag, attrs?, parent?)`, `AM.G(parent?, attrs?)`, `AM.tf(node, x, y, sx = 1, sy = sx, r = 0)`, `AM.vis(node, visible)`
- `AM.burstLine(ln, cx, cy, a, r0, r1, t, t0, dur = 10/30)` — animate SVG radial burst line
- `AM.ring(c, t, t0, r0, r1, w0, dur = 12/30)` — animate SVG shockwave `<circle>`

## Canvas 2D Drawing, Camera, Rigging & Subtitles
- `AM.roundRect(ctx, x, y, w, h, r)` — trace rounded rectangle path (`r` can be a scalar or `[tl, tr, br, bl]`)
- `AM.fillRoundRect(ctx, x, y, w, h, r)` — draws and fills a rounded rectangle (scalar radius or `[tl, tr, br, bl]`)
- `AM.strokeRoundRect(ctx, x, y, w, h, r)` — draws and strokes a rounded rectangle (scalar radius or `[tl, tr, br, bl]`)
- `AM.applyCamera(ctx, cam, W = 1080, H = 1920)` — `{ s, cx, cy, rot }` zoom/pan/rotate
- `AM.evalCameraTrack(track, localT, W = 1080, H = 1920)` — interpolates sparse 30fps `scene.cameraTrack` keyframes `{ t, tx, ty, s, rot }` into `{ s, cx, cy, rot }`
- `AM.applyTrackedCamera(ctx, track, localT, W = 1080, H = 1920)` — evaluates `evalCameraTrack(...)` and calls `AM.applyCamera(ctx, cam, W, H)`
- `AM.drawBurstLines(ctx, cx, cy, count, r0, r1, t, t0, dur = 0.35, color = "#FFC62B", lineWidth = 8)`
- `AM.drawShockRing(ctx, cx, cy, t, t0, r0, r1, w0 = 16, dur = 0.4, color = "#FF5A4E")`
- `AM.drawShapeWipe(ctx, t, tStart, dur = 0.65, colors?, originX = 540, originY = 660, W = 1080, H = 1920)`
- `AM.drawElectricBolt(ctx, x1, y1, x2, y2, segments, jitterAmp, seed, color, width)`
- `AM.drawOpticalGlow(ctx, x, y, radius, colorHex = "#FF8800", intensity = 1.0)` — 3-layer additive (`lighter`) optical bloom orb (wide atmospheric halo + saturated mid bloom + white-hot core)
- `AM.drawBloomStroke(ctx, drawPathFn, opts?)` — Gaussian-blurred additive (`lighter`) glowing stroke (`{ color, coreColor, lineWidth, glowRadius, intensity, lineCap, lineJoin }`)
- `AM.drawSphericalLens(ctx, cx, cy, radius, strength, drawContentFn, opts?)` — deterministic pixel-level spherical/water-bubble lens refraction shader (`drawContentFn(c)` draws in main canvas coordinates around `(cx, cy)`, while 2-arg `drawContentFn(lc, size)` draws in local `0..size` centered at `(size/2, size/2)` with automatic empty-buffer fallback; `strength` `0..1.4`, `{ coordSpace?, chromatic, rimAlpha, rimColor }`)
- `AM.drawTaperedRibbon(ctx, points, maxWidth = 24, opts?)` — variable-width tapered crescent/calligraphic light ribbon with Gaussian aura (`{ color, coreColor, alpha, asymmetry, glowBlur }`)
- `AM.impactRecoil(t, hitTime, opts?)` — deterministic damped spring collision jolt returning `{ dx, dy, rot, sx, sy }` (`{ ampX, ampY, ampRot, squash, damping, freq, duration }`)
- `AM.twistPolygon(points, angle, lagFactor = 0.35)` — deterministic elastic vertex-lag rotation/shear for polygon vertices (`[{x, y}]` or `[[x, y]]`)
- `AM.drawBlurRevealText(ctx, text, x, y, t, tStart = 0, dur = 0.45, opts?)` — progressive left-to-right character blur-rise reveal (`blur(maxBlur -> 0px)` + soft spring rise + subtle scale `scaleFrom: 0.92 -> 1.0`, or explicit Z-depth zoom when `scaleFrom` is set lower + locked kerning width via `measureText` + optional `preBlurSec` ghost preview, `inkStart -> color` tint, and `exitAt` / `exitDur` character blur-fade exit)
- `AM.drawBlurRiseWords(ctx, wordsOrText, x, y, t, tStart = 0, opts?)` — staggered word-by-word spring rise + optical blur decay + ink-tint transition + faster exit (`{ stagger, enterDur, maxBlur, risePx, inkStart, color, preBlurSec, exitAt, exitDur }`)
- `AM.layoutBalancedHeadline(ctx, text, maxWidth = 800)` — balanced 2-line / multi-line headline wrapper using `ctx.measureText` with zero single-word orphans
- `AM.drawTurntableObject(ctx, cx, cy, t, drawFnOrImg, opts?)` — 3D Y-axis turntable foreshortening + gentle rock/float + optional continuous spinning dashed orbital ring (`{ w, h, omega, depth, tiltRad, floatPx, ringRadius, ringOmega, ringColor, ringDash }`)
- `AM.drawMorphPolygon(ctx, ptsA, ptsB, p, opts?)` — vertex-matched polygon interpolation between `ptsA` and `ptsB` at progress `p` (`0..1`, `{ cx, cy, rot, scale, fill, stroke, lineWidth, draw }`)
- `AM.drawGridBackdrop(ctx, t, accentColor, bgTop, bgBottom, W = 1080, H = 1920)`
- `AM.drawCharacterRig(ctx, t, opts?)` — `{ x, y, scale, coatColor, coatShade, skinColor, hairColor, hairStyle, glasses, reactTime, reachTime, lean, expression, collarColor, leftSh, ... }`
- `AM.drawTopHeader(ctx, scene, localTimeOrIdx, globalTime)` — **OPTIONAL** top bar (omit unless active skill wants header bar)
- `AM.drawHeadlinePlaque(ctx, scene, localTime)` — **OPTIONAL** dark card plaque (omit unless active skill wants plaque)
- `AM.drawSubtitles(ctx, words, localTime, opts?)` — renders synced words (`[{ word, start, end }]`); defaults to 1-word-at-a-time `"neobrutalism"` chips (`wordsPerGroup: 1`) unless `style: "pill"` or `wordsPerGroup > 1` is passed (`style: "neobrutalism" | "pill", wordsPerGroup, palette, x, y, maxWidth, fontSize, fontFamily, activeColor, pastColor, upcomingColor, bgColor, borderColor, shadowColor, textColor, borderWidth, shadowOffsetX, shadowOffsetY, radius, tiltDeg, uppercase, holdAfterEnd`)

## Keyframe Track, Reveal & SVG Path Helpers
- `AM.evalKeyframes(frames, t, easingMode = "linear")` — interpolate `{ t, x, y, w, h, opacity, rotation, blur, reveal }` keyframes (`"linear" | "smooth" | "out" | "step"`)
- `AM.evalTrack(keys, t, opts?)` — evaluates After Effects speed-graph tracks `[{ t, v, ease?, outEase?, inEase?, hold? }]` (`ease`: `"linear" | "easy" | "smooth" | "easeInOutSoft" | "easeInOut" | "easeInOutStrong" | "accelerate" | "accelerateStrong" | "decelerate" | "decelerateStrong" | "expoInOut" | "expoAccelerate" | "expoDecelerate"`, plus `{ spatial: true }` for 2D/3D Catmull-Rom arc-length motion paths) via `/script/aetheria-tracks.js`
- `AM.wiggle(t, freq, amp, opts?)` — deterministic SplitMix64 C2 octave wiggle offset(s) (`{ octaves, ampMult, dims, seed, base }`) via `/script/aetheria-behaviors.js`
- `AM.loopTrack(keys, t, opts?)` — evaluates looping AE tracks (`{ type: "cycle" | "pingpong" | "offset" | "continue", direction: "out" | "in", numKeyframes, duration, spatial }`) via `/script/aetheria-behaviors.js`
- `AM.textReveal(text, reveal = 1)` — slice text deterministically by character ratio (`0..1`)
- `AM.clipWipe(ctx, x, y, w, h, reveal, drawFn)` — horizontal clip-rect wipe around `drawFn()`
- `AM.drawSVGPath(ctx, pathStr, x, y, w, h, opts?)` — stroke/fill SVG path via `Path2D` (`{ viewBoxW, viewBoxH, fill, stroke, progress, lineWidth, lineCap, lineJoin, approxLength }`)
- `AM.drawCursor(ctx, x, y, opts?)` — crisp vector pointer arrow with optional glow (`{ scale, angle, fill, stroke, glowColor, lineWidth }`)
- `AM.drawExtrudedArrow3D(ctx, cx, cy, scale?, opts?)` — 3D perspective extruded arrow prism (`scale` defaults to `90` px radius; multiplier `<= 8` auto-scales by `90px`; opts: `{ rx, ry, rz, depth=0.24, topLight, topMid, sideColor, strokeColor, alpha }`)
- `AM.drawLaptopFrame(ctx, opts?, drawScreenFn)` — sleek minimalist laptop frame + auto-clipped screen viewport; calls `drawScreenFn(ctx, { x, y, w, h, cx, cy })` (or `drawScreenFn(ctx, w, h)` with origin at `(0,0)`)
- `AM.drawWordWheel(ctx, opts)` — overlapping stacked typography focus wheel (`{ words, centerIndex, cx, cy, stepY, slideOffset, activeFont, dimFont, activeColor, dimColor }`)

## Local Image Asset Preloading & Unified Asset Registry (`/img/*`, `/assets.json`)
- `AM.loadImage(url)` — preloads and caches a local project image (e.g. `"/img/brain.png"` downloaded by `fetch_web_image`), registering it so managed `index.html` waits before `window.__ready = true`.
- `AM.whenImagesReady()` — returns a Promise resolving once all `AM.loadImage(...)` assets have settled.
- `AM.drawImageFit(ctx, img, x, y, w, h, mode = "contain")` — draws a loaded `HTMLImageElement` cleanly centered/scaled (`"contain"` or `"cover"`); returns `false` if not loaded.
- `AM.registerAsset(record)` — registers/caches an asset metadata record (`{ id, path, url, kind, width, height, hasAlpha, alphaBbox, pivot, valid }`) and preloads raster/SVG assets.
- `AM.loadAssetManifest(url = "/assets.json")` — fetches optional project `assets.json` (silently resolves empty on 404), registers valid assets, and waits for preloaded images.
- `AM.getAsset(idOrPath)` — looks up a registered asset by `id`, relative `path`, or `url`, returning `{ meta, image, ready }` or `null`.
- `AM.drawAsset(ctx, idOrPath, x, y, w, h, opts?)` — draws a registered raster cutout, raster photo, or SVG respecting `alphaBbox` tight crop, normalized `pivot`, `mode` (`"contain" | "cover"`), `rot`, `scale`/`scaleX`/`scaleY`, `flipX`/`flipY`, `alpha`, and optional `shadow`; returns `false` if missing/invalid.
- `AM.postProcess(ctx, t, opts?)` — runs modular WebGL2 post-processing passes via `/script/aetheria-post.js` (`{ bloom, bloomThreshold, bloomRadius, chromatic, exposure, contrast, saturation, temperature, tint, tonemap, vignette, vignetteSoftness, grain, fps }`) with automatic Canvas 2D fallback if WebGL2 is unavailable or context is lost.
- `AM.createStage(opts?)` — creates a universal multi-layer compositing stage via `/script/aetheria-stage.js` supporting parent-child transform hierarchy (`parentId`, `followLag` secondary-motion lag in seconds, `localToWorld`), declarative `tracks` (`x`, `y`, `position`, `scale`, `scaleX`, `scaleY`, `rotation`, `rotationDeg`, `opacity`, `anchor`, `width`, `height`), additive `behaviors` (22 presets: `wiggleSoft`, `shake`, `floatUpDown`, `sway`, `orbit`, `figureEight`, `bouncingBall`, `driftRight`, `driftDiagonal`, `pendulum`, `wobble`, `spinSlow`, `spinFast`, `pulse`, `heartbeat`, `breathe`, `rubberBand`, `jitterScale`, `blink`, `strobe`, `flicker`, `fadePulse`), z-order sorting, opacity inheritance, masks, parallax, and unified rendering of `"canvas2d"`, `"asset"`, `"svg"`, `"dom"`, `"three"`, and `"webgl"` layers.
- `AM.syncCamera(camState, targets?)` — synchronizes one normalized camera pose (`AM.evalCameraTrack` or `StoryCamera`) across Canvas 2D, DOM/SVG elements, and Three.js 3D cameras simultaneously.
