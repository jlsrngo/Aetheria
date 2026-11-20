---
name: mg-bauhaus-swiss
description: "Declarative full-bleed Bauhaus 1919 & Swiss Constructivist motion graphics skill matching 09-bauhaus craft: cream lithograph sheet with Passkreuz marks, monumental Kandinsky primary geometry, 12-detent escapement rotation, 120 BPM modular tile cascade & two-sided flips, and vertical BAUHAUS poster typography."
tags:
  - motion-graphics
  - declarative-kit
  - bauhaus
  - swiss-grid
command: /mg-bauhaus-swiss
---

# Bauhaus 1919 Konstruktion (Full-Bleed Lithograph Engine) — Declarative Fast-Path Skill

## Visual Identity
Museum-grade 1919 Weimar/Dessau Bauhaus kinetic lithograph poster matching `09-bauhaus`: warm cream paper sheet (`#F1E9DA`) with corner Passkreuz registration marks and modular hairlines, monumental Kandinsky primary geometry (giant Red Circle kissing the apex of a Yellow Triangle, Cobalt Blue Square, Black Structural Bar, and sweeping sectors), 12-detent quantized escapement rotation, 120 BPM quarter-circle tile cascade & two-sided card flips, and vertical `BAUHAUS` monument with the iconic ▲■● primary triad.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) hides all text and captions while keeping the full lithograph geometry, Passkreuz marks, and modular tile cascades.

## Kit Enums (`examples/kit.json`)
- **themes**: `cream-1919`, `weimar-ochre`, `dessau-dark`, `swiss-red`, `zurich-mono`
- **layouts**: `kandinsky-assembly`, `escapement-pivot`, `tile-cascade`, `flip-matrix`, `constructivist-stat`, `bauhaus-poster`
- **transitions**: `block-wipe`, `tile-flip`, `invert-cut`

## Limits & Safe-Zone Contract
- `headline` <= 36 chars; `subtext` <= 84 chars.
- Pure deterministic function of `t`: 12-detent escapement teeth and 120 BPM tile flips derive strictly from `t`.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus integer `"seed"`) for deterministic framing variation; avoid raw numeric camera overrides unless a shot explicitly needs `shots[].camera.move`.
