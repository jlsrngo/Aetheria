---
name: mg-aurora-glass
description: "Declarative Aurora Gradient Blur & Frosted Glassmorphism motion graphics skill with drifting mesh orbs, specular glass cards, liquid-glass lens, and micro-UI widgets."
tags:
  - motion-graphics
  - declarative-kit
  - aurora-glass
  - glassmorphism
command: /mg-aurora-glass
---

# Aurora Glass — Declarative Fast-Path Skill

## Visual Identity
Luxury AI & product-launch motion design: deep indigo/obsidian canvases lit by 4 drifting additive aurora orbs, translucent frosted-glass cards with iridescent specular rims, gliding refractive lenses, and calm breathing easing.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean stock-motion plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `indigo-aurora`, `emerald-northern`, `rose-nebula`, `obsidian-cyan`, `twilight-violet`
- **layouts**: `glass-hero`, `glass-split`, `glass-stack`, `glass-metric`, `glass-lens`, `glass-cta`
- **widgets**: `orb-pulse`, `waveform`, `chat-bubble`, `toggle-grid`, `metric-ring`, `spark-prism`
- **transitions**: `light-sweep`, `luminance-fade`, `prism-expand`

## Limits & Safe-Zone Contract
- `headline` <= 48 chars; `subtext` <= 96 chars; `items` <= 4.
- Portrait `1080x1920` keeps all cards inside `x: 72..1008`, `y: 150..1610` (above TikTok/Reels bottom HUD and clear of right rail).
- Deterministic pure rendering: all orb orbits, light sweeps, and widget animations derive solely from `t`.
