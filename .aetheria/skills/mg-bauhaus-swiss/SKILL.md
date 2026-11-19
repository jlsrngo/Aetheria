---
name: mg-bauhaus-swiss
description: "Declarative Bauhaus & Swiss International Typographic motion graphics skill with 120 BPM modular grids, primary Constructivist geometry, and high-contrast sans-serif posters."
tags:
  - motion-graphics
  - declarative-kit
  - bauhaus
  - swiss-grid
command: /mg-bauhaus-swiss
---

# Bauhaus & Swiss Grid — Declarative Fast-Path Skill

## Visual Identity
1919 Weimar/Dessau Constructivist & Swiss International Typographic posters: strict 120px modular hairlines, registration crosshairs, primary red/yellow/blue blocks, zero-overshoot 120 BPM mechanical beat snaps, and stark black-framed hierarchy.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and schema fields.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for pure geometric plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `cream-1919`, `swiss-red`, `dessau-dark`, `zurich-mono`, `weimar-ochre`
- **layouts**: `bauhaus-poster`, `swiss-grid-split`, `modular-stack`, `constructivist-stat`, `diagonal-matrix`, `manifesto-cta`
- **glyphs**: `quarter-arc`, `split-circle`, `bauhaus-tri`, `grid-cross`, `concentric-ring`, `diagonal-bars`
- **transitions**: `block-wipe`, `diagonal-slice`, `invert-cut`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all framed modules inside `x: 72..1008`, `y: 150..1610`.
- Pure deterministic function of `t`: 120 BPM mechanical rotations and snap slides require zero runtime randomness.
