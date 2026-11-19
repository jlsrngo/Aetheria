---
name: mg-synthwave-retro
description: "Declarative full-bleed 1986 Synthwave & Outrun motion graphics skill matching 10-synthwave craft: starry twilight sky, segmented scrolling sun, wireframe mountains, rushing palm silhouettes, 80s wedge supercar with wet-road taillight reflections, metallic chrome typography, and VHS OSD."
tags:
  - motion-graphics
  - declarative-kit
  - synthwave
  - outrun-retro
command: /mg-synthwave-retro
---

# Synthwave Retro 1986 (Full-Bleed Outrun Engine) — Declarative Fast-Path Skill

## Visual Identity
Full-bleed 1980s Outrun highway sequence: starry dusk sky with shooting star, massive scrolling-slit segmented sunset sun with atmospheric halo, flanking glowing wireframe mountains, rushing rim-lit palm silhouettes, perspective neon highway with sun-reflection ripples, iconic 80s wedge supercar with glowing taillights + wet-road streaks, 3D metallic chrome horizon-reflected headlines + neon script, and VHS `PLAY ▶` OSD + scanlines.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) renders the full-bleed animated Outrun highway, sun, mountains, palms, and supercar with zero text or VHS OSD.

## Kit Enums (`examples/kit.json`)
- **themes**: `outrun-1986`, `miami-vice`, `laser-crimson`, `midnight-chrome`, `vapor-teal`
- **layouts**: `highway-cruise`, `chrome-slam`, `neon-metric`, `car-chase`, `palm-sunset`, `vhs-outro`
- **carModes**: `cruising`, `boost`, `hidden`
- **transitions**: `vhs-rewind`, `neon-flash`, `grid-warp`

## Limits & Safe-Zone Contract
- `headline` <= 32 chars; `subtext` <= 72 chars.
- Pure deterministic function of `t`: grid travel, sun slit scroll, palm rush, star twinkle, and glint sweep derive strictly from `t`.
