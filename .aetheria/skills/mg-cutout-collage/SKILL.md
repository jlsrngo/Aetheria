---
name: mg-cutout-collage
description: "Declarative 2D Dada Cutout & Paper Collage storytelling skill driven by story.json + stepped 12fps stop-motion CollageKit."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - visual-archetype
  - cutout-collage
  - stop-motion
command: /mg-cutout-collage
---

# 2D Cutout / Paper Collage Declarative Storytelling (`story.json`)

**Default Format:** `1080×1920` (Portrait 9:16, `30 fps` render on `12 fps` stop-motion boil) · Optional Landscape `1920×1080` · Supports silent Microstock Mode `'M'` (`captions.enabled = false`).

**Seeded Runtime Package (auto-copied to `script/` — DO NOT overwrite or hand-code Canvas 2D):**
- `script/collage-kit.js` (`CollageKit`), `script/collage-layouts.js` (`CollageLayouts`), `script/story-runtime.js` (`StoryRuntime`)
- Reference spec & example: [story.schema.json](examples/story.schema.json), [story.example.json](examples/story.example.json)

## How to Author a Film (Zero Hand-Written JS)

1. Generate narration/SFX first via `film_audio` (skip audio in Microstock Mode `'M'`).
2. Write **one** declarative `story.json` with `"renderer": "2d-cutout-collage"` inside the active project subfolder (`<= 150` lines for a 6-shot ~30s story). Do **NOT** write `index.html` or `script/scene*.js` unless a shot truly needs an escape hatch (`shots[].custom: "script/sceneK.js"`).
3. Optional real photos: fetch CC0/editorial images via `fetch_web_image` into `img/...` and reference `"image": "img/file.png"` on a `dossier-hero` shot (automatically framed with white scissor-cut rim, washi tape, and red push-pin).
4. Call `film_scaffold(..., { storyMode: true, useThree: false })` to generate the managed 2D `index.html` and run pre-render `storyLint` validation (`0` errors required).
5. Call `capture_film_preview` to render one midpoint frame per shot into `.aetheria/preview/contact_sheet.jpg` and inspect `storyQa` (`__shotReport`). If any shot fails framing/overlap, apply **at most 1 targeted correction pass** (auto-rollback protects against regressions).

## `story.json` Specification (Compact Schema)

```json
{
  "renderer": "2d-cutout-collage",
  "title": "Short Documentary Title",
  "theme": "kraft",
  "canvas": { "w": 1080, "h": 1920, "fps": 30 },
  "shots": [
    {
      "id": "shot1_hook",
      "start": 0,
      "duration": 5.0,
      "layout": "dossier-hero",
      "paper": "kraft",
      "header": "ARSIP // FILE 01",
      "stamp": "RAHASIA",
      "cutout": "portrait",
      "headline": "JUDUL UTAMA TEGAS",
      "subheadline": "SUB-BADGE RINGKAS",
      "accentColor": "#C0392B",
      "secondaryColor": "#F59E0B",
      "accents": ["rose", "manicule"],
      "transition": "tear-wipe",
      "caption": "Kalimat narasi singkat dan tajam.",
      "audio": { "wav": "audio/shot1_hook.wav", "words": "audio/shot1_hook.words.json" }
    }
  ],
  "captions": { "enabled": true }
}
```

## Valid Enum Values & Contracts
- **`renderer`:** `"2d-cutout-collage"` (required so `story_lint` & `film_scaffold` boot the 2D Collage runtime).
- **`layout` (6, auto-zoned inside safe zone `X:49..960, Y:60..1440` with 0 overlap):** `dossier-hero` | `split-compare` (`items[2]`) | `evidence-board` (`items[2..4]` + red yarn) | `stat-callout` (`statValue`, `statLabel`) | `timeline-strip` (`items[2..3]`) | `quote-scrap` (`quote` + highlighter sweep)
- **`paper` / `theme` (5):** `kraft` | `newsprint` | `corkboard` | `charcoal` | `scrapbook`
- **`cutout` (16):** `portrait` | `brain` | `globe` | `rocket` | `eye` | `hand-point` | `rose` | `clock` | `gear` | `megaphone` | `book` | `coin` | `chart` | `lightbulb` | `phone` | `camera` (or pass `"image": "img/..."` on `dossier-hero`)
- **`accents` (max 2 per shot, 8 kinds):** `rose` | `manicule` | `gear` | `wax-seal` | `star` | `arrow` | `paperclip` | `scissors`
- **`transition` (2):** `tear-wipe` (default) | `cut`
- **Timeline continuity:** `shots[0].start == 0`, `shots[k+1].start == shots[k].start + shots[k].duration`, and `duration >= wavDuration`.
- **Captions:** Synced via `AM.drawSubtitles` to `/audio/*.words.json` (Zone 5 `Y: 1600`, lemon-yellow `#FFDE59` pop). Set `captions.enabled: false` in Microstock Mode `'M'` (zero text). Never call `AM.drawTopHeader`.
