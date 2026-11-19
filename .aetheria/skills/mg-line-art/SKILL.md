---
name: mg-line-art
description: "Declarative Technical Monoline & Blueprint Line Art motion graphics skill with self-drawing vector schematics, glowing pen tips, coordinate grids, and drafting callouts."
tags:
  - motion-graphics
  - declarative-kit
  - line-art
  - blueprint
command: /mg-line-art
---

# Technical Line Art & Blueprint — Declarative Fast-Path Skill

## Visual Identity
Minimalist architectural drafting & technical schematics: uniform 2.5–3px monoline strokes self-drawing with a glowing pen tip, dashed reference circles, corner L-brackets, and blueprint coordinate grids.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and dimension callouts for clean blueprint plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `midnight-gold`, `blueprint-cyan`, `archival-ink`, `obsidian-silver`, `atelier-emerald`
- **layouts**: `monoline-hero`, `blueprint-split`, `schematic-stack`, `dimension-stat`, `drafting-grid`, `atelier-cta`
- **schematics**: `blueprint-arch`, `botanical-sprout`, `circuit-trace`, `compass-rose`, `gear-schematic`, `monogram-emblem`
- **transitions**: `pen-trace`, `blueprint-fold`, `cursor-sweep`

## Limits & Safe-Zone Contract
- `headline` <= 48 chars; `subtext` <= 96 chars; `items` <= 4.
- Portrait `1080x1920` keeps all drafting frames inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: path trace length and pen-tip position derive strictly from `localTime`.
