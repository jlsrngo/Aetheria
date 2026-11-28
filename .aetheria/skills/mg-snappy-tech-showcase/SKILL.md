---
name: mg-snappy-tech-showcase
description: "Portrait-first (1080x1920) & widescreen (1920x1080) high-craft Snappy Tech Showcase motion skill combining obsidian optical bloom, 3D plush studio dioramas, cobalt 360-degree card rings, and photo-OS product demos."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - tech-showcase
  - product-demo
  - ui-motion
  - 60fps-snappy
command: /mg-snappy-tech-showcase
---

# Snappy Tech Showcase (`mg-snappy-tech-showcase`)

**Supported Formats:** `1080×1920` (Portrait 9:16 TikTok/Reels, default) · `1920×1080` (Landscape 16:9 Product Commercial) · `1080×1080` (Square 1:1 Social Loop) · `30 fps` or `60 fps` CFR.

**Seeded Runtime & References:**
- Reusable motion kit (21 primitives covering Videos 1–5 + Video 6): [script/snappy-tech-kit.js](script/snappy-tech-kit.js) (`window.SnappyTechKit`)
- Visual galleries & photo assets: [visual-gallery.png](assets/visual-gallery.png), [sheet-2-photo-os-aurora.png](assets/sheet-2-photo-os-aurora.png), [sheet-3-characters-props.png](assets/sheet-3-characters-props.png), [qc-sheet-example.jpg](assets/qc-sheet-example.jpg), [wallpaper-alpine.jpg](assets/wallpaper-alpine.jpg), [call-grid-team.jpg](assets/call-grid-team.jpg)
- Camera & optical lens laws: [references/camera.md](references/camera.md)
- Declarative spec & example: [examples/story.schema.json](examples/story.schema.json), [examples/story.example.json](examples/story.example.json)
- Planned Video 6 blueprint & bundled portable reference MP4: [references/video6-gemini-notes.md](references/video6-gemini-notes.md), [ref6_mc_7603768.mp4](references/video6/ref6_mc_7603768.mp4)

## Visual Archetypes (5 Themes)

1. **`obsidian-bloom`** *(Focus App / Dark SaaS Launch)*: Pitch-black stage (`#000000`) with soft backlit card aura shadows (`rgba(255,255,255,0.16..0.22)`), optical halation bloom on white emblems/CTAs, neon-mint radial score gauges (`#5CF2AE`), and bloom-morph transitions between UI states.
2. **`plush-3d-studio`** *(3D AI Agent Workspace)*: Warm blush-peach cyclorama (`#D2DFFA → #F7EAEF`), multi-shell plush mascot with landing velocity jiggle, reactive keycap/surface impact press-in, cylindrical 180° camera orbits, whip-pans with shutter motion blur, and macro shallow-DoF focus lock.
3. **`cobalt-editorial`** *(Studio Reel / Feature Showcase)*: Deep obsidian-navy (`#02040B`) with breathing diagonal electric-cobalt light beams (`#2E5BFF → #5E8FFF`), blur-dissolve kinetic typography, beat-shaking vector icon rows, tilted feature wheels, true 360° 3D tilted card rings (with back-row peek & edge-on slivers), pure-black blackout cuts, and twinkling ASCII-to-solid wordmark decodes.
4. **`photo-os-warm`** *(Mobile & Desktop AI Assistant)*: Photographic alpine wallpapers inside sleek iOS/macOS frames, staggered glowing dock icons, frosted glass notifications, serif editorial notes with sweeping lime AI-enhance shimmer, live neon-lime audio waveform pills, and macro call-control pull-outs into 6-person team grids.
5. **`aurora-light`** *(Planned — see [video6-gemini-notes.md](references/video6-gemini-notes.md))*: Bright alabaster stage (`#F5F5F7`), 4-quadrant rainbow star iris explosion, stacked floating action pills with cursor hover-click, kinetic bouncy prompt typing, and dark scanline wave outro.

## Non-Negotiable Motion Craft Rules

1. **Zero Dead-Stop Motion:** Never freeze camera or hero cards at `velocity = 0`. Every hold carries a subtle continuous push/pull drift (`SnappyTechKit.expLerp` ±4–8%) so transitions flow seamlessly.
2. **Exponential Optical Zoom + Cosine-Cubic Glide:** Never linearly interpolate large zoom scales (`lerp(4.0, 1.0, t)` slams at the end). Always use `SnappyTechKit.expLerp(s0, s1, SnappyTechKit.smoothGlide(t0, t1, t))` over `0.45–0.65s` so the eye tracks every dolly smoothly.
3. **Optical Halation & Backlit Card Shadows:** Luminous emblems/icons render with multi-pass soft blur halation (never razor-hard solid polygons on flat radial gradients). Dark UI cards float over pitch-black backgrounds using soft backlit aura shadows (`SnappyTechKit.drawBacklitCard`).
4. **Tactile Micro-Dynamics:**
   - Use per-character **Letter Wave** (`SnappyTechKit.drawLetterWave`) for navbar/headline arrivals with peak highlight flash.
   - Add rhythmic beat-shake micro-wiggle to horizontal icon ribbons.
   - Depress surfaces (`SnappyTechKit.impactDip`) whenever a mascot, card, or padlock physically impacts.
   - Keep camera vibration strictly localized to physical impact moments — never shake the whole scene continuously.
5. **3D Camera & Carousel Hygiene:**
   - Interpolate 180° 3D flips on a cylindrical orbit around `lookAt` so the camera never crosses the overhead gimbal pole.
   - Render 3D card carousels as full 360° tilted rings (`SnappyTechKit.projectCylinderRing`) sorted back-to-front by Z.
   - Lock macro shallow-DoF blur dynamically to the active hero subject's screen position.
6. **Anti-Stutter & Harness Rules:**
   - Draw scaling text at fixed font size inside subpixel `ctx.scale()` — never animate `Math.round(fontSize)`.
   - Use `AM.drawCursor`, `AM.drawAnimatedText`, `AM.drawWordWheel`, `AM.createDirectorCamera`, and `AM.drawSubtitles` when authoring inside the Aetheria runtime; never call `AM.drawTopHeader`.
   - Keep `captions.enabled: false` for music-driven commercials; enable synced subtitles for narrated explainers.

## Authoring Workflow

1. Choose one primary theme (`obsidian-bloom`, `plush-3d-studio`, `cobalt-editorial`, `photo-os-warm`, or `aurora-light`) and canvas format (`1080×1920`, `1920×1080`, or `1080×1080`).
2. Generate BGM/SFX or narration via `film_audio` first so beat timestamps align with real audio duration.
3. Compose modular scenes using `SnappyTechKit` primitives (see [examples/story.example.json](examples/story.example.json)) with zero overlapping layers and explicit beat handoffs.
4. Inspect preview frames via `capture_film_preview` to verify focus plane, backlit contrast, zero clipping, and zero text overlap before final export.
