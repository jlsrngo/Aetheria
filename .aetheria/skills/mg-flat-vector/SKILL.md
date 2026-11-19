---
name: mg-flat-vector
description: "Declarative 2D Flat Vector & Clean Tech Explainer skill driven by story.json + kit.json + FlatKit."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - visual-archetype
  - flat-vector
command: /mg-flat-vector
---

# 2D Flat Vector Explainer (`story.json`)

**Default Format:** `1080×1920` (Portrait 9:16, `30 fps`) · Optional Landscape `1920×1080` · Supports silent Microstock Mode `'M'` (`captions.enabled = false`).

**Seeded Runtime Package (auto-copied to `script/` + `kit.json` — DO NOT overwrite or hand-code Canvas 2D):**
- `kit.json`, `script/flat-kit.js` (`FlatKit`), `script/story-runtime.js` (`StoryRuntime`)
- Reference spec & example: [kit.json](examples/kit.json), [story.example.json](examples/story.example.json)

## How to Author a Film (Zero Hand-Written JS)

1. Generate narration/SFX first via `film_audio` (skip audio in Microstock Mode `'M'`).
2. Write **one** declarative `story.json` with `"renderer": "2d-flat-vector"` inside the active project subfolder (`<= 150` lines). Do **NOT** write `index.html` or `script/scene*.js` unless a shot truly requires `shots[].custom: "script/sceneK.js"`.
3. Call `film_scaffold(..., { storyMode: true, useThree: false })` to generate managed 2D `index.html` and validate `storyLint` (`0` errors required).
4. Call `capture_film_preview` to render `.aetheria/preview/contact_sheet.jpg` and verify `storyQa` (`0` failed shots). Apply at most 1 targeted correction pass if needed.

## `story.json` Compact Example

```json
{
  "renderer": "2d-flat-vector",
  "title": "Short Explainer Title",
  "theme": "clean-light",
  "canvas": { "w": 1080, "h": 1920, "fps": 30 },
  "shots": [
    {
      "id": "shot1_hook",
      "start": 0,
      "duration": 5.0,
      "layout": "hero-center",
      "theme": "clean-light",
      "badge": "TOPIC",
      "icon": "bulb",
      "headline": "CLEAR BOLD HEADLINE",
      "subheadline": "Concise one-line explanation.",
      "accentColor": "#2563EB",
      "secondaryColor": "#10B981",
      "caption": "Narration sentence synced to audio."
    }
  ],
  "captions": { "enabled": true }
}
```

## Valid Enum Values (`examples/kit.json`)
- **`renderer`:** `"2d-flat-vector"`
- **`theme` (5):** `clean-light` | `midnight-tech` | `mint-fresh` | `coral-pop` | `cobalt-deck`
- **`layout` (6, auto-framed inside safe zone):** `hero-center` | `split-compare` (`items[2]`) | `step-list` (`items[2..3]`) | `stat-counter` (`statValue`, `statLabel`) | `timeline-flow` (`items[2..3]`) | `callout-card`
- **`icon` (12):** `dot-flow` | `chart` | `clock` | `shield` | `rocket` | `bulb` | `gear` | `globe` | `coin` | `leaf` | `phone` | `check`
- **`transition` (3):** `slide-up` | `zoom-pop` | `cut`
- **Timeline continuity:** `shots[0].start == 0`, `shots[k+1].start == shots[k].start + shots[k].duration`, `duration >= wavDuration`.
- **Captions:** Synced via `AM.drawSubtitles`. Set `captions.enabled: false` in Microstock Mode `'M'`. Never call `AM.drawTopHeader`.
