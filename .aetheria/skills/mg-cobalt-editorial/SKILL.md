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
- `theme`: `"cobalt-beam"` | `"indigo-shaft"` | `"obsidian-ice"`
- `canvas`: `{ "w": 1280, "h": 720, "fps": 30 }` (or `1080×1920` for portrait 9:16)
- `captions`: `{ "enabled": false }` (kinetic typography lives inside shots)
- `shots[]`: contiguous `{ "id", "start", "duration", "layout", ... }`

## Layouts (`kit.enums.layout`)
1. `kinetic-word-reveal`: Word-by-word blur/fade reveal (`headline`, optional `accentWord`).
2. `icon-row-morph`: Anchor word (`anchor`) flanked by staggered crisp micro-UI icons (`icons[]` or `leftIcons[]`/`rightIcons[]`).
3. `radial-wheel-list`: Anchor word (`anchor`) + active focal dot (`•`) + tilted rotating radial list (`items[]`, 6–10 items).
4. `coverflow-carousel`: 3D-perspective horizontal card carousel (`cards[]`: `{ title, tag, style }`).
5. `logo-assemble`: Geometric two-part brand mark assembling with spring snap + optional 1-beat blackout flash (`blackoutAt`, `markStyle`).
6. `brand-lockup-resolve`: Geometric mark sliding left + dot-matrix dissolve into crisp wordmark (`brand`, `subtitle`).

## Mode `'M'` (`?microstock=1`)
Suppresses all typography and captions while preserving diagonal cobalt light beams, micro-UI geometry, 3D coverflow abstract cards, and geometric mark animation.
