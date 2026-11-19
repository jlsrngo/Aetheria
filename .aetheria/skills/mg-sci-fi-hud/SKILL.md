---
name: mg-sci-fi-hud
description: "Declarative Sci-Fi FUI & Aerospace HUD motion graphics skill with glowing chamfered panels, rotating target reticles, conic radar sweeps, wireframe globes, and telemetry waveforms."
tags:
  - motion-graphics
  - declarative-kit
  - sci-fi
  - fui-hud
command: /mg-sci-fi-hud
---

# Sci-Fi FUI HUD — Declarative Fast-Path Skill

## Visual Identity
Aerospace & cybernetic Fictional User Interface (FUI): pitch-black/teal technical grids, chamfered glowing vector panels, multi-speed counter-rotating targeting reticles, conic radar sweeps, wireframe holographic globes, and alert-amber lock states.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean FUI telemetry plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `cyber-cyan`, `alert-amber`, `stealth-emerald`, `orbital-violet`, `crimson-lock`
- **layouts**: `hud-hero`, `hud-split`, `hud-telemetry`, `hud-lock`, `hud-matrix`, `hud-cta`
- **modules**: `radar-sweep`, `target-reticle`, `wire-globe`, `signal-wave`, `hex-core`, `orbital-rings`
- **transitions**: `glitch-cut`, `scan-wipe`, `lock-snap`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all HUD frames inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: radar sweeps, orbital rotations, and scanline sweeps derive strictly from `t`.
