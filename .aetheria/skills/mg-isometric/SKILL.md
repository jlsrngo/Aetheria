---
name: mg-isometric
description: "Declarative 2.5D Isometric Architecture & System Explainer motion graphics skill with true 30-degree axonometric projection, three-shade directional cubes, smart-city modules, and cloud/data blocks."
tags:
  - motion-graphics
  - declarative-kit
  - isometric
  - system-explainer
command: /mg-isometric
---

# Isometric 2.5D — Declarative Fast-Path Skill

## Visual Identity
True 30° axonometric projection for cloud architecture, smart cities, and logistics explainers: isometric diamond grid backdrop, three-shade directional blocks (light top, mid left, shadowed right), and clean modular structures.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean isometric plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `pastel-city`, `cloud-slate`, `mint-campus`, `sunset-logistics`, `dark-datacenter`
- **layouts**: `iso-hero`, `iso-split`, `iso-stack`, `iso-stat`, `iso-campus`, `iso-cta`
- **structures**: `smart-tower`, `server-rack`, `cloud-node`, `factory-hub`, `energy-grid`, `data-cube`
- **transitions**: `elevator-lift`, `grid-slice`, `tile-drop`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all isometric frames inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: gentle modular levitation derives strictly from `t`.
