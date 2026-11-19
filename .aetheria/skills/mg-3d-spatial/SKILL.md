---
name: mg-3d-spatial
description: "Declarative 3D Spatial Product Motion graphics skill powered by offline Three.js WebGL PBR studio lighting, rippling MoGraph cloner fields, sculpted 3D primitives, and floating HUD cards."
tags:
  - motion-graphics
  - declarative-kit
  - 3d-spatial
  - threejs
command: /mg-3d-spatial
---

# 3D Spatial Product Motion — Declarative Fast-Path Skill

## Visual Identity
C4D / Octane pastel & obsidian 3D product-ident look powered by offline Three.js r128 (`useThree: true`): three-point studio lighting, 5×5 rippling MoGraph sphere cloner field, sculpted PBR hero primitives with damped squash-and-stretch entrance, and translucent floating HUD cards.

## Zero-JS Workflow
Do **not** write custom WebGL/Three.js code. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all HUD cards and captions for pure 3D WebGL renders.

## Kit Enums (`examples/kit.json`)
- **themes**: `pastel-candy`, `studio-cream`, `obsidian-chrome`, `mint-ceramic`, `lilac-dream`
- **layouts**: `spatial-hero`, `spatial-showcase`, `spatial-specs`, `spatial-metric`, `spatial-orbit`, `spatial-cta`
- **objects**: `candy-torus`, `crystal-icosa`, `floating-capsule`, `gyro-rings`, `prism-cube`, `orb-cluster`
- **transitions**: `camera-push`, `elastic-drop`, `orbit-sweep`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 92 chars; `items` <= 4.
- Portrait `1080x1920` keeps all HUD cards inside `x: 56..952`, `y: 80..1420` while keeping the upper stage clear for the 3D hero.
- Pure deterministic function of `t`: 3D hero orbit, cloner effector wave, and camera sway derive strictly from `t`.
