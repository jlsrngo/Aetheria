---
name: mg-kinetic-calligraphy
description: "Declarative Kinetic Calligraphy & Brush Impact motion graphics skill with tapered Enso ink strokes, dry-brush slashes, crimson Hanko seals, ink splatter particles, and dramatic typographic slams."
tags:
  - motion-graphics
  - declarative-kit
  - calligraphy
  - kinetic-typography
command: /mg-kinetic-calligraphy
---

# Kinetic Calligraphy — Declarative Fast-Path Skill

## Visual Identity
Expressive oriental sumi-e calligraphy fused with modern kinetic poster typography: tapered Enso brush circles, diagonal dry-brush slashes, crimson Hanko stamp seals, floating ink splatters, and high-contrast slam headlines.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean calligraphy plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `sumi-rice`, `crimson-impact`, `obsidian-gold`, `indigo-brush`, `vermilion-scroll`
- **layouts**: `brush-hero`, `brush-split`, `brush-stack`, `brush-stat`, `brush-slash`, `brush-cta`
- **motifs**: `enso-circle`, `brush-wave`, `katana-slash`, `ink-blossom`, `hanko-seal`, `spark-kanji`
- **transitions**: `brush-wipe`, `impact-flash`, `ink-burst`

## Limits & Safe-Zone Contract
- `headline` <= 42 chars; `subtext` <= 88 chars; `items` <= 4.
- Portrait `1080x1920` keeps all scroll cards inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: stroke progression, slam scale, and ink particle drift derive strictly from `t`.
