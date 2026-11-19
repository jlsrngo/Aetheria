---
name: mg-soft-clay-story
description: "Portrait-first (1080x1920) declarative 3D Soft-Clay storytelling skill driven by story.json + auto-framed ClayKit assets."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - threejs-webgl
  - 3d-clay-world
  - kawaii-toon
  - long-form-storytelling
command: /mg-soft-clay-story
---

# 3D Soft-Clay Declarative Storytelling (`story.json`)

**Default Format:** `1080×1920` (Portrait 9:16, `30 fps`) · Optional Landscape `1920×1080` · Supports silent Microstock Mode `'M'` (`captions.enabled = false`).

**Seeded Runtime Package (auto-copied to `script/` — DO NOT overwrite or hand-code Three.js):**
- `script/clay-kit.js`, `script/clay-assets.js` (`ClayKit.makeAsset`), `script/story-runtime.js` (`StoryRuntime`)
- Reference spec & example: [story.schema.json](examples/story.schema.json), [story.example.json](examples/story.example.json)

## How to Author a Film (Zero Hand-Written JS)

1. Generate narration/SFX first via `film_audio` (skip audio in Microstock Mode `'M'`).
2. Write **one** declarative `story.json` inside the active project subfolder (`<= 150` lines for a 6-shot ~30s story). Do **NOT** write `index.html` or `script/scene*.js` unless a shot truly needs an escape hatch (`shots[].custom: "script/sceneK.js"`).
3. Call `film_scaffold(..., { storyMode: true, useThree: true })` to generate the managed `index.html` and run pre-render `storyLint` validation (`0` errors required).
4. Call `capture_film_preview` to render one midpoint frame per shot into `.aetheria/preview/contact_sheet.jpg` and inspect `storyQa` (`__shotReport`). If any shot fails framing or errors, apply **at most 1 targeted correction pass** on failed shots only (auto-rollback protects against regressions).

## `story.json` Specification (Compact Schema)

```json
{
  "title": "Short Story Title",
  "canvas": { "w": 1080, "h": 1920, "fps": 30 },
  "cast": [
    {
      "id": "petani",
      "asset": {
        "kind": "humanoid",
        "palette": { "primary": "#60A5FA", "secondary": "#78716C", "hat": "#FDE68A" },
        "scale": 1.0,
        "accessories": ["hat-conical", "towel"],
        "tags": ["hero"]
      },
      "pos": [0, 0, 1.4],
      "rotY": 0.08
    }
  ],
  "props": [
    {
      "id": "bunga_kenikir",
      "asset": { "kind": "flower-row", "palette": { "primary": "#FB923C", "accent": "#FACC15" }, "scale": 1.05 },
      "pos": [0, 0, 2.0],
      "visible": false
    }
  ],
  "shots": [
    {
      "id": "shot1_intro",
      "start": 0,
      "duration": 5.0,
      "focus": "petani",
      "camera": { "preset": "wide" },
      "stage": "open-field",
      "placements": { "bunga_kenikir": { "visible": false } },
      "actions": [
        { "target": "petani", "anim": "walk", "at": 0.2, "dur": 3.6, "from": [-1.4, 0, -0.8], "to": [0.2, 0, 1.8] }
      ],
      "caption": "Pagi tenang di sawah Pak Tani.",
      "audio": { "wav": "audio/shot1_intro.wav", "words": "audio/shot1_intro.words.json" }
    }
  ],
  "captions": { "enabled": true }
}
```

## Valid Enum Values & Contracts
- **`asset.kind` (8):** `humanoid` | `flower-row` | `container` | `insect` | `tree` | `building` | `vehicle` | `blob`
- **`accessories` (`humanoid` only):** `hat-conical` | `hat-cap` | `towel`
- **`actions[].anim` (5):** `idle` | `walk` (leg/arm stride + bouncy steps) | `hop` | `grow` | `pop-in`. Optional locomotion on any action: `"from": [x,y,z], "to": [x,y,z]` (auto-faces travel direction and resumes `idle` on arrival; use `walk` + `to` so characters move naturally instead of standing still).
- **`camera.preset` (5, auto-framed inside 9:16 safe zone `X:49..960, Y:60..1440`):** `wide` | `medium` | `close` | `dolly-in` | `orbit`
- **`stage` (2):** `open-field` (terraced meadow/paddy) | `city-street` (pastel town street)
- **Timeline continuity:** `shots[0].start == 0`, `shots[k+1].start == shots[k].start + shots[k].duration`, and `duration >= wavDuration`.
- **Captions:** Synced via `AM.drawSubtitles` to `/audio/*.words.json` (Zone 4 `Y: 1440–1700`, Neobrutalism 1-word chips). Set `captions.enabled: false` in Microstock Mode `'M'` (zero text). Never call `AM.drawTopHeader`.
- **Placement hygiene:** Hide or move background props (`visible: false` or side `pos`) when they would sit between the camera and the shot's `focus` subject.
