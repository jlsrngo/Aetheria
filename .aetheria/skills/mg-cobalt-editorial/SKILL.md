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

## Shared Declarative Camera (`story.cameraStyle` & `shot.camera`)
- Set `"cameraStyle": "editorial"` (or `"calm"` | `"kinetic"`) at the root of `story.json` plus an integer `"seed"` so `/script/story-camera.js` varies shot framing deterministically without repeating consecutive moves/directions.
- Do **not** hand-author raw numeric camera overrides unless a shot genuinely needs custom framing; prefer `cameraStyle` at root or `camera: { "move", "intensity", "dir" }` per shot (`hold`, `push-in`, `pull-out`, `pan`, `tilt`, `truck`, `orbit`, `crane`, `handheld`, `whip`, `rack-focus-in`).
- Legacy compatibility: `shot.cameraPreset` (`static`, `dolly-in`, `macro-pullback`, `macro-zoom-in`, `pan-sweep`, `tilt-push`, `rack-focus-in`) and numeric `camera{}` overrides remain supported via `StoryCamera.LEGACY_PRESETS`.
- Internal layout cameras: `macro-ui-prompt` (when `cameraPreset` is absent/`static`) and `whip-cta-morph` keep their built-in macro choreography.

## Layouts (`kit.enums.layout`, 13 Presets)
1. `kinetic-word-reveal`: Word-by-word blur/fade reveal (`headline`).
2. `icon-row-morph`: Anchor word (`anchor`) flanked by staggered micro-UI icons (`leftIcons[]`, `rightIcons[]`).
3. `radial-wheel-list`: Anchor word (`anchor`) + active focal dot (`•`) + tilted rotating radial list (`items[]`, 6–10 items).
4. `coverflow-carousel` / `orbit-carousel`: Tightly-packed cylindrical surface-wrapped 3D carousel (`cards[]`: `{ title, tag, style }`, `targetIndex`, `turns`) where each card bends smoothly along the round cylinder wall over a clean backdrop, spinning fast then braking onto the center hero card.
5. `logo-assemble`: Geometric two-part brand mark assembling with spring snap + optional 1-beat blackout flash (`blackout`).
6. `brand-lockup-resolve`: Geometric mark sliding left + halftone dissolve into crisp wordmark (`brand`, `subtitle`).
7. `tilted-chart-dolly`: 2-phase true 3D forward-tilted perspective bar chart (`metric`, `bars[]`, `highlightIdx`, `avgLabel`) with soft matte charcoal-grey palette, tilt-shift Depth-of-Field blur, standing upright with motion blur, then zooming deep into the glowing cyan-to-amber focal bar.
8. `metric-pills-tree`: Sequential 1-by-1 pill reveal (glowing circle orb → expanding pill with sweeping glowing border + passive continuous camera pull-back) rising through a luminous connector bracket to hero `score` (`pills[]`, `scoreLabel`, `scoreValue`).
9. `neon-score-ring`: Glowing radial progress ring (`scoreFrom`, `scoreTo`, `headline`, `subtext`, `badge`) with macro zoom-out reveal.
10. `macro-ui-prompt`: Dark obsidian SaaS prompt/dashboard bar (`headline`, `promptText`, `modelTag`, `chips[]`, `ctaLabel`) with macro zoom-out & typing reveal.
11. `prompt-type-send`: Variable-pace 4-phase macro prompt (`headline`, `promptText`, `modelTag`, `chips[]`): zoomed `2.35×` follow-cam panning left as words type 1-by-1 → whip to `↑` Send button → click press + shockwave ripple → bloom flash transition.
12. `whip-cta-morph`: 4-beat CTA transition — falling light spark onto glossy dark brand icon → impact zoom-in & horizontal motion-blurred morph into wide glossy dark-violet `▶ Start` pill → exponential zoom-in plunging directly into the white `▶` triangle until the screen fills pure white into the final scene (`ctaLabel`, `brand`).

## Mode `'M'` (`?microstock=1`)
Suppresses all typography and captions while preserving diagonal cobalt light beams, micro-UI geometry, 3D coverflow abstract cards, and geometric mark animation.
