---
name: mg-liquid-fluid
description: "Declarative Liquid & Fluid Motion graphics skill with glossy 3D-shaded metaballs, organic droplets, splash crowns, flowing liquid ribbons, and specular pill highlights."
tags:
  - motion-graphics
  - declarative-kit
  - liquid-fluid
  - metaballs
command: /mg-liquid-fluid
---

# Liquid & Fluid Motion — Declarative Fast-Path Skill

## Visual Identity
Glossy beverage & beauty commercial motion: deep rich backdrops with layered flowing liquid waves, 3D-shaded specular metaball spheres, organic droplets, splash crowns, and vibrant gradient-rimmed pill cards.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean liquid plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `plum-candy`, `ocean-splash`, `citrus-fizz`, `berry-velvet`, `obsidian-lava`
- **layouts**: `fluid-hero`, `fluid-split`, `fluid-stack`, `fluid-stat`, `fluid-pool`, `fluid-cta`
- **forms**: `metaball-duo`, `liquid-drop`, `splash-crown`, `ripple-pool`, `wave-ribbon`, `bubble-cluster`
- **transitions**: `liquid-flood`, `splash-wipe`, `droplet-merge`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all fluid cards inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: wave phase, metaball separation, and droplet orbit derive strictly from `t`.
