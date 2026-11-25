---
name: mg-stickman-story
description: "Declarative 2.5D Chibi & Stickman comic storytelling skill driven by story.json — default afro chibi hero 'afro' + 13 cast presets, 20 expressions, 44 poses, 13 layered pastel worlds with foreground occlusion, multi-beat Director v2 camera (push, pull, pan, tilt, fly-to, lag follow, whip, punch, shake, dutch, rack-focus), word-cue triggers, comic panels, and 3-frame Self-QC."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - stickman-story
  - 2d-chibi-storytelling
  - comic-animation
  - cinematic-camera
command: /mg-stickman-story
---

# Stickman Story — 2.5D Chibi Comic Storytelling & Director Camera (`story.json`)

**Default Format:** `1080x1920` (Portrait 9:16, `30 fps`, TikTok-first safe zone `X:49..960, Y:60..1440`) · Optional Landscape `1920x1080` · Supports silent Microstock Mode `'M'` (`captions.enabled = false`).

**Seeded Runtime Package (auto-copied to `script/` — DO NOT overwrite or hand-code Canvas 2D):**
- `script/stickman-rig.js` (`StickmanRig`), `script/stickman-world.js` (`StickmanWorld`), `script/stickman-overlay.js` (`StickmanOverlay`), `script/stickman-timeline.js` (`StickmanTimeline`), `script/story-runtime.js` (`StickmanStory`)
- Skill References & Galleries (read via `read` tool before authoring):
  - [camera.md](references/camera.md) — **MANDATORY:** Shot sizes, Director v2 multi-beat camera moves, moment recipes, transitions, rhythm rules
  - [scene-format.md](references/scene-format.md) — Complete `story.json` field reference (`shots[]`, `actors[]`, `actions[]`, `props[]`, `bubbles[]`, `overlays[]`, `fx[]`, comic grid)
  - [characters-and-actions.md](references/characters-and-actions.md) — 13 character presets (`afro` default hero), 20 expressions, 44 poses, stage anchor coordinates
  - [worlds-and-props.md](references/worlds-and-props.md) — 13 2.5D layered sets (`back` + `front` foreground occlusion), 4 times of day, held props & head emotes
  - [story-and-script.md](references/story-and-script.md) — Narrative structure, 0-3s hook rules, pacing, director QC checklist
  - Visual QA Galleries: [character-gallery.png](assets/character-gallery.png), [hero-rig-qa.png](assets/hero-rig-qa.png), [qc-sheet-example.jpg](assets/qc-sheet-example.jpg)

## How to Author a Story Film (Zero Hand-Written JS)

1. Read `references/camera.md` and `references/scene-format.md` first. Generate voiceover/SFX via `film_audio` (skip audio in Microstock Mode `'M'`).
2. Plan one tight beat per shot: `time | story beat | stage+timeOfDay | actors & action | camera (initial size -> moves -> reason) | emotes/overlays/fx | transition`. The hook must move inside `0-3s`; vary framing every `<= 4s`; never repeat the same shot size + stage 3 times in a row.
3. Write **one** declarative `story.json` (`<= 160` lines, default hero `"actorsMap": { "afro": "afro" }`) inside the active project subfolder. Keep compositions crisp (no confetti clutter; use head emotes `sparkle`/`heart`/`idea`, `speed-lines`, `flash`, `punch`, or `burst` comic callouts). Never call `AM.drawTopHeader`.
4. Call `film_scaffold(..., { storyMode: true, useThree: false })` to generate the managed 2D `index.html` and run pre-render `storyLint` (`0` errors required).
5. **Mandatory 3-Frame Self-QC:** Call `capture_film_preview` to inspect `.aetheria/preview/contact_sheet.jpg` (**3 frames per shot: `start`, `mid`, `end`**) plus `storyQa.directorWarnings` (`[CHECK]`). Verify zero clipped heads, zero empty frames at `t=0.25s`, zero collisions with bottom subtitles, and clean framing. Apply at most 1 targeted revision to `story.json` if needed.

## Compact `story.json` Example

```json
{
  "renderer": "2d-stickman-story",
  "title": "Afro's Bright Morning",
  "canvas": { "w": 1080, "h": 1920, "fps": 30 },
  "actorsMap": { "afro": "afro", "nadia": "nadia" },
  "captions": { "enabled": true },
  "shots": [
    {
      "id": "shot1_alarm_hook",
      "start": 0.0,
      "duration": 3.4,
      "stage": "bedroom",
      "timeOfDay": "morning",
      "clockTime": "07:00",
      "alarm": true,
      "blanket": true,
      "caption": "Seven AM! The alarm rings loudly while Afro is fast asleep.",
      "actors": [
        { "id": "afro", "x": -158, "y": -167, "pose": "sleep", "expr": "sleep", "actions": [{ "at": 1.0, "emote": "zzz", "emoteDur": 2.2 }] }
      ],
      "camera": {
        "initial": { "x": 185, "y": -214, "z": 2.8 },
        "moves": [
          { "at": 0.2, "kind": "shake", "strength": 8, "dur": 0.8 },
          { "at": 1.0, "kind": "fly-to", "to": { "size": "full", "x": -180, "y": -290 }, "dur": 1.5 }
        ]
      }
    }
  ]
}
```
