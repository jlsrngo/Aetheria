---
name: mg-synthwave-retro
description: "Declarative 1980s Synthwave & Outrun Retro motion graphics skill with scrolling perspective neon grids, striped sunset sun, wireframe mountains, metallic chrome typography, and VHS scanlines."
tags:
  - motion-graphics
  - declarative-kit
  - synthwave
  - outrun-retro
command: /mg-synthwave-retro
---

# Synthwave Retro 1986 — Declarative Fast-Path Skill

## Visual Identity
Quintessential 1980s Outrun aesthetic: starry purple dusk sky, segmented horizontal-slit retro sun, wireframe horizon mountains, scrolling magenta/cyan perspective grid, metallic chrome gradient headlines, and VHS scanlines.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean Outrun plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `outrun-1986`, `miami-vice`, `laser-crimson`, `midnight-chrome`, `vapor-teal`
- **layouts**: `synth-hero`, `synth-split`, `synth-stack`, `synth-stat`, `synth-horizon`, `synth-cta`
- **icons**: `retro-sun`, `cassette-tape`, `neon-palm`, `sport-car`, `laser-grid`, `vhs-play`
- **transitions**: `vhs-rewind`, `neon-flash`, `grid-warp`

## Limits & Safe-Zone Contract
- `headline` <= 42 chars; `subtext` <= 88 chars; `items` <= 4.
- Portrait `1080x1920` keeps all neon frames inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: scrolling perspective grid phase derives solely from `t`.
