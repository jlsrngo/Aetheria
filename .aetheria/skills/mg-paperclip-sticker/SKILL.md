---
name: mg-paperclip-sticker
description: "Declarative PaperClip-style Sticker & Scrapbook Explainer motion graphics skill with thick white die-cut stickers, metallic paperclips, pastel washi tape, marker highlights, and infographic bar charts."
tags:
  - motion-graphics
  - declarative-kit
  - paperclip
  - sticker-explainer
command: /mg-paperclip-sticker
---

# PaperClip Sticker Explainer — Declarative Fast-Path Skill

## Visual Identity
Lin Chao / PaperClip knowledge-explainer aesthetic: dot-matrix drafting desk, crisp white-bordered die-cut stickers with bold dark outlines, translucent washi tape strips, metallic paperclips, sweeping highlighter marker strokes, and exact percentage bar charts.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) automatically hides all text and captions for clean sticker-explainer plates.

## Kit Enums (`examples/kit.json`)
- **themes**: `desk-slate`, `explainer-coral`, `studio-mint`, `notebook-warm`, `blueprint-desk`
- **layouts**: `sticker-hero`, `sticker-compare`, `sticker-bars`, `sticker-stat`, `sticker-grid`, `sticker-cta`
- **stickers**: `phone-diecut`, `chip-diecut`, `globe-diecut`, `flask-diecut`, `battery-diecut`, `rocket-diecut`
- **transitions**: `whip-pan`, `sticker-slap`, `paper-peel`

## Limits & Safe-Zone Contract
- `headline` <= 48 chars; `subtext` <= 96 chars; `items` <= 4.
- Portrait `1080x1920` keeps all sticker cards inside `x: 56..952`, `y: 80..1420`.
- Pure deterministic function of `t`: sticker slap-pop scale, marker highlight sweep, and bar growth derive solely from `localTime`.
