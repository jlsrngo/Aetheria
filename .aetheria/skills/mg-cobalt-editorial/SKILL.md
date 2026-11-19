---
name: mg-cobalt-editorial
description: Minimalist cobalt-blue volumetric light-beam editorial showreel motion graphics (kinetic word reveal, icon-row morph, tilted radial feature wheel, 3D coverflow carousel, geometric logo assemble with blackout impact, and halftone-dissolve brand lockup).
---

# `mg-cobalt-editorial` — Cobalt Light-Beam Editorial Showreel

Declarative Canvas 2D motion skill inspired by minimalist cobalt light-shaft studio showreels (`16:9` landscape or `9:16` portrait, Core API v1 via `/script/story-core.js`).

## When to Use
- Product launch / studio intro showreels (15–60s) with clean minimalist typography, radial feature wheels, and 3D coverflow showcases.
- High-contrast dark cobalt editorial aesthetics with zero clutter and smooth diagonal volumetric light beams.

## Canonical `story.json` Contract (Dialect A)
- `title`: string
- `theme`: `"cobalt-beam"` | `"indigo-shaft"` | `"obsidian-ice"` | `"obsidian-violet"` | `"obsidian-emerald"` | `"obsidian-crimson"`
- `canvas`: `{ "w": 1280, "h": 720, "fps": 30 }` (or `1080×1920` for portrait 9:16)
- `captions`: `{ "enabled": false }` (kinetic typography lives inside shots)
- `shots[]`: contiguous `{ "id", "start", "duration", "layout", "cameraPreset"?, "camera"?, ... }`

## Virtual 2.5D Camera (`shot.cameraPreset` or `shot.camera`)
Every shot supports cinematic camera motion:
- Presets: `"static"`, `"dolly-in"`, `"macro-pullback"` (`2.2x -> 1.0x`), `"macro-zoom-in"` (`0.95x -> 1.48x`), `"pan-sweep"`, `"tilt-push"`, `"rack-focus-in"`.
- Optional overrides inside `camera`: `{ zoomFrom, zoomTo, panXFrom, panXTo, panYFrom, panYTo, rollFromDeg, rollToDeg, blurFrom, blurTo }`.

## Layouts (`kit.enums.layout`, 10 Presets)
1. `kinetic-word-reveal`: Word-by-word blur/fade reveal (`headline`).
2. `icon-row-morph`: Anchor word (`anchor`) flanked by staggered micro-UI icons (`leftIcons[]`, `rightIcons[]`).
3. `radial-wheel-list`: Anchor word (`anchor`) + active focal dot (`•`) + tilted rotating radial list (`items[]`, 6–10 items).
4. `coverflow-carousel`: 3D-perspective horizontal card carousel (`cards[]`: `{ title, tag, style }`).
5. `logo-assemble`: Geometric two-part brand mark assembling with spring snap + optional 1-beat blackout flash (`blackout`).
6. `brand-lockup-resolve`: Geometric mark sliding left + halftone dissolve into crisp wordmark (`brand`, `subtitle`).
7. `tilted-chart-dolly`: 3D-foreshortened perspective bar chart (`metric`, `bars[]`, `highlightIdx`, `avgLabel`) with glowing cyan-to-amber focal bar & dolly-in.
8. `metric-pills-tree`: Glowing rounded counter pills (`pills[]`: `{ label, value }`) expanding with animated count-up + luminous connector bracket rising to hero `score` (`scoreLabel`, `scoreValue`).
9. `neon-score-ring`: Glowing radial progress ring (`scoreFrom`, `scoreTo`, `headline`, `subtext`, `badge`) with macro zoom-out reveal.
10. `macro-ui-prompt`: Dark obsidian SaaS prompt/dashboard bar (`headline`, `promptText`, `modelTag`, `chips[]`, `ctaLabel`) with macro zoom-out & typing reveal.

## Mode `'M'` (`?microstock=1`)
Suppresses all typography and captions while preserving diagonal cobalt light beams, micro-UI geometry, 3D coverflow abstract cards, and geometric mark animation.
