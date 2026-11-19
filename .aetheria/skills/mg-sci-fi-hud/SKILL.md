---
name: mg-sci-fi-hud
description: "Declarative Territory Studio-grade Aerospace FUI & Holographic HUD skill matching 22-hud (KESTREL-9): 3D wireframe & dotted-land holographic Earth globe, 120-tick azimuth scope, counter-rotating tactical rings, conic radar sweep, sparkline waveforms, 20-bar spectrum analyzer, and alert-amber target lock."
tags:
  - motion-graphics
  - declarative-kit
  - sci-fi
  - fui-hud
command: /mg-sci-fi-hud
---

# Sci-Fi FUI HUD (KESTREL-9 Holographic Scope) — Declarative Fast-Path Skill

## Visual Identity
Film-grade aerospace & orbital telemetry FUI matching `22-hud` (`KESTREL-9 TARGET ACQUIRED`): pitch-black `#020A0D` technical grid with corner L-brackets, top `KESTREL-9` header bar with hexagonal status box and `UTC` clock + blinking `REC` dot, central 3D wireframe + dotted-continent holographic Earth globe with horizontal scan plane, 120-tick azimuth bearing ring, counter-rotating 36-segment tactical ring, conic phosphor radar sweep, converging target lock brackets, and dual-column bottom telemetry deck (`SLANT RNG KM`, zoom ticks, sparkline waveform, and 20-bar LED spectrum equalizer).

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) hides all text and captions while keeping the full holographic globe, concentric scope rings, radar sweep, sparklines, and spectrum bars.

## Kit Enums (`examples/kit.json`)
- **themes**: `cyber-cyan`, `alert-amber`, `crimson-lock`, `stealth-emerald`, `orbital-violet`
- **layouts**: `scope-search`, `signal-detected`, `target-locked`, `orbital-dive`, `spectrum-analysis`, `uplink-complete`
- **transitions**: `glitch-cut`, `shockwave-lock`, `scan-wipe`

## Limits & Safe-Zone Contract
- `headline` <= 38 chars; `subtext` <= 88 chars.
- Pure deterministic function of `t`: 3D globe rotation, radar sweep angle, sparkline waveform, and spectrum bars derive strictly from `t`.
