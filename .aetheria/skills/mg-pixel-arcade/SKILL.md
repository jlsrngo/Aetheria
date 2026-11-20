---
name: mg-pixel-arcade
description: "Declarative 16-Bit Indexed-Palette Pixel Art motion graphics skill matching QUEST-32 SNES craft: 320x180 / 180x320 integer-scaled parallax world, Bayer 4x4 dithering, waterfall color cycling, outlined animated hero & slime sprites, 3D-extruded gold pixel titles, and CRT scanlines."
tags:
  - motion-graphics
  - declarative-kit
  - pixel-art
  - arcade-retro
command: /mg-pixel-arcade
---

# Pixel Arcade 16-Bit (QUEST-32 Indexed Engine) — Declarative Fast-Path Skill

## Visual Identity
Full-bleed 16-bit SNES/GBA side-scroller world rendered in an exact integer ×6 indexed pixel buffer (`180×320` for 9:16 portrait or `320×180` for 16:9 landscape): QUEST-32 master palette with 6 time-of-day LUT stages (`day` → `night`), Bayer 4×4 ordered dithering, parallax snow mountains, stone waterfall tower with color-cycled foam, pine forest, brick earth + wooden bridge over shimmering water, outlined animated hero/slime/coin/chest sprites, 3D-extruded golden pixel typography, RPG dialogue box, and subtle CRT scanlines.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) renders the full animated parallax pixel world with zero text, HUD, or dialogue boxes.

## Kit Enums (`examples/kit.json`)
- **themes**: `day`, `afternoon`, `golden`, `sunset`, `dusk`, `night`
- **layouts**: `side-scroll`, `boss-encounter`, `treasure-reveal`, `title-logo`, `dialogue-cutscene`, `stage-clear`
- **heroActions**: `run`, `jump`, `bop`, `cheer`, `item-get`, `idle`
- **transitions**: `pixel-dissolve`, `palette-shift`, `crt-flash`

## Limits & Safe-Zone Contract
- `headline` <= 32 chars; `subtext` <= 80 chars.
- Pure deterministic function of `f = Math.round(t * 30)`: colour cycling, Bayer dithering, sprite animation, and parallax scroll require zero randomness.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus integer `"seed"`) for deterministic framing variation; avoid raw numeric camera overrides unless a shot explicitly needs `shots[].camera.move`.
