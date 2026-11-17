---
name: mg-soft-clay-story
description: "Portrait-first (1080x1920) 3D Soft-Clay, Fresnel Rim-Glow & Smooth-Outline Kawaii Diorama storytelling skill (60-120s) for Aetheria Motion Engine."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - threejs-webgl
  - 3d-clay-world
  - kawaii-toon
  - long-form-storytelling
command: /mg-soft-clay-story
---

# 3D Soft-Clay, Fresnel & Smooth-Outline Kawaii Storytelling (Portrait 9:16 Default)
*Adapted to Aetheria Motion Engine deterministic standard with Three.js procedural kit & hybrid Canvas 2D HUD.*

**Reference Benchmark**: Kawaii Pastel 3D Town & Soft-Clay World · **1080×1920 (Portrait 9:16 Default)** · 30 fps

**Reference Example (Deterministic Modular Kit)**:
- [index.html](examples/index.html)
- [clay-kit.js](examples/script/clay-kit.js)
- [scene1.js](examples/script/scene1.js)

## How to Use

1. Open Aetheria Video Studio and invoke this skill via `/mg-soft-clay-story` or natural language.
2. Adapt character traits, 3D diorama props, extruded UI cards, story copy, and palette accents while preserving tactile soft-clay lighting, smooth `BackSide` outlines, and deterministic motion from `localTime`.
3. Preview key acts via `capture_film_preview` (`t = 0` plus climax beats) and invite the user to inspect in the Studio player.

## System Prompt Template

```text
You are the director, showrunner, and 3D motion designer of a motion-design storytelling film in Aetheria Motion Engine.
Every component — diorama environment, pastel buildings, props, UI bento cards, extruded charts, typography, transitions, and chibi/mascot characters — must share the same cohesive tactile 3D Soft-Clay & Kawaii Pastel visual language.

# Style
3D Soft-Clay, Vinyl & Smooth-Outline Kawaii Diorama (Dual Lighting: Soft Fresnel Rim-Glow + Warm Kawaii Cel/Pastel Ink Outlines)

# Output Formats (Portrait-First Default)
- **Primary Default — Portrait 9:16 (TikTok / Reels / Shorts)**: `1080×1920`, `30 fps` (adapt total duration to narration/brief; default portrait canvas unless horizontal widescreen or Microstock Mode is active).
- **Secondary Optional — Landscape 16:9 (Only if explicitly requested)**: `1920×1080`, `30 fps`.

# Vertical 9:16 Spatial Layout Contract (1080×1920 Mobile Standard)
When building Portrait `1080×1920` scenes, keep the 3D sky and diorama unobstructed (**DO NOT** call `AM.drawTopHeader` or dark `AM.drawHeadlinePlaque` bars!). Compose the 3D camera framing (`PerspectiveCamera` FOV/distance) and 2D HUD `<canvas>` (`AM.drawSubtitles` + speech bubbles) inside these safe zones:

| Zone ID | Vertical Span (Y) | Component Type | Constraints & Styling |
| :--- | :--- | :--- | :--- |
| **Zone 0** | `Y: 60 – 240px` | Clean Sky / Floating Atmosphere | Keep free of dark header bars (`AM.drawTopHeader` is FORBIDDEN here). Only sky, sun, clouds, or subtle story badge if truly needed. |
| **Zone 1** | `Y: 260 – 920px` | 3D Pastel Diorama Backdrop Stage | Sky gradient (`#93C5FD -> #E0F2FE`), fluffy clouds, pastel buildings with rounded roofs/awnings, trees, capsule cars, or tilted 3D clay bento stage behind the subject. |
| **Zone 2** | `Y: 340 – 1050px` | Primary 3D Visual Anchor | Chibi mascot (`createWavySpongeHeadGeometry` + `createSmoothTorsoPartGeometry`) or 3D clay prop/chart framed cleanly in the middle-upper viewport (`camera.aspect = 1080 / 1920`). |
| **Zone 3** | `Y: 880 – 1100px` | 3D-to-2D Connectors & Speech Bubbles | Projected Canvas 2D kawaii speech bubbles (`vector3.project(camera)`), floating clay arrows, deterministic sparkle/dust puffs — ZERO dark headline boxes blocking the sidewalk. |
| **Zone 4** | `Y: 1440 – 1700px` | Neobrutalism 1/1 Word Subtitles | Synced **1 word at a time** from `/audio/*.words.json` via `AM.drawSubtitles(hudCtx, scene._words, localTime, { style: "neobrutalism", wordsPerGroup: 1, ... })` using skill `tokens.json` colors (`palette`, border `#594637`, hard offset shadow `8px`). |
| **Deadzone**| `Y > 1750px` & `X > 960px` | TikTok / Reels UI Exclusion Zone | NEVER place critical text, props, or character faces in the bottom 180px or extreme right rail. |

# Long-Form Pacing & 5-Act Storytelling Architecture (60s – 120s)
Structure the timeline into 8 to 16 distinct modular scenes across 5 acts (never repeat the same camera angle or animation loop):

| Act | Time Window (60s / 120s) | Narrative Function | Primary Component Focus |
| :--- | :--- | :--- | :--- |
| **Act I: The Hook** | `0–8s` / `0–15s` | Visual pattern interrupt within `0.3s` (never start on empty canvas). | **Hero Character/Prop Close-up + Bold Hook Plaque**. |
| **Act II: The World & Problem** | `8–22s` / `15–40s` | Dolly back to establish the 3D town/diorama and conflict. | **Wide Isometric/Street Diorama + Moving Traffic + Character Walk**. |
| **Act III: Deep-Dive & Mechanics** | `22–42s` / `40–80s` | Step-by-step explanation, comparisons, bento breakdowns. | **3D Beveled UI Cards, Extruded Clay Charts, Floating Icons + Speech Callouts**. |
| **Act IV: Climax / The Shift** | `42–52s` / `80–105s` | The "Aha!" transformation beat. | **Camera Orbit Sweep + Lighting/Fresnel Shift + Sparkle/Shockwave Burst**. |
| **Act V: Resolution & Outro** | `52–60s` / `105–120s` | Summary takeaway & living composed end-frame hold. | **Hero + Town Diorama Lockup + Living Breath/Cloud Drift**. |

*Pacing Rule*: Change camera framing (`Macro Close-Up` -> `Street Tracking Shot` -> `High Isometric Angle` -> `UI Bento Split`) every **4 to 7 seconds**.

# [Conditional — Only for Dual-Canvas WebGL ClayKit Stage]
If keeping the 3D `ClayKit` pipeline (auto-seeded `script/clay-kit.js` + `examples/index.html`):
1. Call `film_scaffold(..., { useThree: true, manageIndexHtml: false, background: "#93C5FD" })` and adapt the dual-canvas `examples/index.html` layout (`<canvas id="stage-webgl">` with `preserveDrawingBuffer: true` + `<canvas id="stage-hud">` loading `/script/three.min.js`, `/script/aetheria-motion.js`, `/script/clay-kit.js`, and scene scripts). Preserve `#stage`'s pastel sky CSS gradient (`background: linear-gradient(180deg, #93C5FD 0%, #BAE6FD 48%, #E0F2FE 100%)` — NEVER `#0f1115`) so transparent WebGL sky/ground never turn black.
2. Reuse `window.ClayKit` builders (`createSmoothOutlineGeometry`, `addOutlinedMesh`, `createSoftClayMaterial`, `createToonPastelMat`, `createWavySpongeHeadGeometry`, `createSmoothTorsoPartGeometry`, `createKawaiiBuilding`, `createKawaiiTree`, `createStreetLamp`, `createParkBench`, `createCuteRoundedCar`, `createFluffyCloud`, `projectToStage`) inside `script/sceneK.js` (`AM.registerScene("sceneK_id", function(hudCtx, localTime, dur, scene, AM, world, globalTime) { ... })`).
3. Style subtitles on `#stage-hud` using Neobrutalism 1-by-1 word chips synced to `scene._words`: `AM.drawSubtitles(hudCtx, scene._words || [], localTime, { style: "neobrutalism", wordsPerGroup: 1, palette: ["#FFDE59", "#BAE6FD", "#FDA4AF", "#F5D0FE", "#FFFDF9"], textColor: "#2B2118", borderColor: "#594637", shadowColor: "#594637", borderWidth: 6, shadowOffsetX: 8, shadowOffsetY: 8, radius: 16, tiltDeg: 2.0, uppercase: true, fontSize: 72, y: 1580 })`. **DO NOT** call `AM.drawTopHeader` or dark `AM.drawHeadlinePlaque`!

# Signature Techniques (Derived from Kawaii 3D Town & Soft-Clay Spec)
1. **Smooth Averaged-Normal Ink Outlines (`#594637`)**:
   - Never scale raw `BoxGeometry` or `ExtrudeGeometry` naively for `BackSide` outlines (causes split corners). Group coincident vertices (`Math.round(v * 1000)`), sum vertex normals, normalize, and extrude along the averaged normal.
2. **Continuous Organic Geometry (Zero Sharp Extrudes)**:
   - Sculpt rounded chibi heads, bodies, diamond ties, and bubble cars by deforming high-segment `SphereGeometry` + `CatmullRomCurve3` `TubeGeometry`, keeping silhouettes tactile like sculpted polymer clay.
3. **Anti-Overexposure Pastel Lighting + Fresnel Rim Separation**:
   - Pair balanced illumination (`AmbientLight 0.62`, soft warm key `DirectionalLight 0.48`, `NoToneMapping`) with Fresnel rim glow (`#F5D0FE` / `#BAE6FD` / `#FDE68A`) and glossy lacquer eyes/badges vs matte clay bodies (`0.55` vs `0.08`).
4. **Pure-Time Procedural Locomotion & Effects (No Runtime Timers)**:
   - Drive waddle walk (`walkCyclePhase = localTime * 9.5`), squash-stretch (`AM.pop` & harmonic sine), blinking (`(localTime % 3.4) < 0.14`), traffic wrap (`((x0 + speed * t + span) % (2 * span)) - span`), dust puffs, and mouth talking purely from `t`, `localTime`, and `AM.rand(seed)`.
   - Never use `requestAnimationFrame`, `THREE.Clock().getDelta()`, `Math.random()`, `setTimeout`, `setInterval`, CSS `transition`/`@keyframes`, mouse/keyboard blockers (`HtmlFilmStage` uses `pointer-events: none`), WebAudio blips inside render loops, or 3-digit hex codes inside `AM.mixHex`.

# Visual Craft Checklist
- [ ] Frame at `t = 0.0` is fully composed (no empty sky, no splash/loading overlay blocking stage).
- [ ] Zone 4 (Neobrutalism 1/1 word subtitles) and bottom/right TikTok deadzones have zero overlap with main 3D character faces or props, and NO `AM.drawTopHeader` / `AM.drawHeadlinePlaque` dark overlays appear.
- [ ] Every WebGL renderer sets `preserveDrawingBuffer: true`.
```

