---
name: mg-pixel-arcade
description: "Declarative 8-Bit & 16-Bit Pixel Arcade motion graphics skill with crisp nearest-neighbor pixel sprites, PICO-8/GameBoy/SNES palettes, CRT scanlines, and RPG typewriter dialogue boxes."
tags:
  - motion-graphics
  - declarative-kit
  - pixel-art
  - arcade-retro
command: /mg-pixel-arcade
---

# Pixel Arcade 16-Bit — Declarative Fast-Path Skill

## Visual Identity
Authentic 1980s/90s arcade & console attract-screen motion: integer-snapped pixel sprites (`imageSmoothingEnabled = false`), PICO-8 / GameBoy DMG / SNES limited palettes, stepped parallax stars, chunky RPG dialogue boxes with blinking cursors, and CRT scanlines.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and dialogue boxes for pure pixel-art plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `pico8-night`, `gameboy-dmg`, `snes-sunset`, `arcade-crt`, `cyber-bit`
- **layouts**: `arcade-title`, `arcade-vs`, `arcade-quests`, `arcade-highscore`, `arcade-level`, `arcade-continue`
- **sprites**: `hero-knight`, `coin-spin`, `slime-bounce`, `treasure-chest`, `heart-pixel`, `rocket-8bit`
- **transitions**: `pixel-dissolve`, `crt-off`, `stage-wipe`

## Limits & Safe-Zone Contract
- `headline` <= 40 chars; `subtext` <= 88 chars; `items` <= 4.
- Portrait `1080x1920` keeps all pixel dialogue frames inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: stepped sprite bounce, typewriter character count, and parallax star scroll derive strictly from `t`.
