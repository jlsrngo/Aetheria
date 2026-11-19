---
name: mg-cel-boil
description: "Declarative Hand-Drawn Cel-Boil motion graphics skill with 12fps quantized line boil, off-register comic color fills, paper halftone texture, and squash-and-stretch cartoon sprites."
tags:
  - motion-graphics
  - declarative-kit
  - cel-boil
  - hand-drawn
command: /mg-cel-boil
---

# Hand-Drawn Cel Boil — Declarative Fast-Path Skill

## Visual Identity
Traditional frame-by-frame animation warmth: 12fps quantized 3-frame line-boil outlines, slightly off-register hand-colored fills, halftone sketchbook paper, radial comic speedlines, and lively squash-and-stretch cel FX sprites.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean cel-FX plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `sketch-cream`, `comic-tomato`, `studio-butter`, `ink-mint`, `night-chalk`
- **layouts**: `cel-hero`, `cel-split`, `cel-stack`, `cel-stat`, `cel-strip`, `cel-cta`
- **sprites**: `flame-spirit`, `star-burst`, `smoke-puff`, `lightning-zap`, `pencil-nib`, `heart-pop`
- **transitions**: `ink-splash`, `speedline-cut`, `paper-flip`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all comic frames inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: 12fps boil index (`Math.floor(t * 12) % 3`) uses seeded hashing with zero randomness.
