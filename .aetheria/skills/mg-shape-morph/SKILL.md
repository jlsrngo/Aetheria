---
name: mg-shape-morph
description: "Declarative Geometric Shape Morphing motion graphics skill with 64-vertex equal-count path interpolation, vibrant color-field wipes, squash-and-stretch rotation, and continuous unbroken flow."
tags:
  - motion-graphics
  - declarative-kit
  - shape-morph
  - kinetic-geometry
command: /mg-shape-morph
---

# Geometric Shape Morph — Declarative Fast-Path Skill

## Visual Identity
Hypnotic continuous vector transformation: vibrant color-field backdrops with crisp white cards, 64-vertex equal-count parametric shape interpolation (zero knotting or pinching), subtle rotation + squash-and-stretch, and hold-and-release beat rhythm.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for pure shape-morph plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `cobalt-pop`, `coral-field`, `emerald-morph`, `violet-pulse`, `amber-studio`
- **layouts**: `morph-hero`, `morph-pair`, `morph-chain`, `morph-stat`, `morph-quartet`, `morph-cta`
- **shapes**: `circle`, `squircle`, `star-6`, `triangle`, `capsule`, `diamond`
- **transitions**: `color-wipe`, `morph-spin`, `scale-pop`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all morph cards inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: cubic morph progress and squash-stretch derive strictly from `t`.
