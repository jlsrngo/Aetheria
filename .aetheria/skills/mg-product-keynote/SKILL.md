---
name: mg-product-keynote
description: "Declarative Apple-keynote style product launch & commercial showreel skill driven by story.json + Bento Grid, device mockups, and studio lighting."
tags:
  - motion-graphics
  - aetheria-motion
  - aetheria-html
  - product-launch
  - keynote
  - showreel
command: /mg-product-keynote
---

# Product Launch & Keynote Showreel (`story.json`)

**Supported Formats:** `1920×1080` (Landscape 16:9 Product Demo / Commercial, default) · `1080×1920` (Portrait 9:16 TikTok/Reels Product Ad) · Supports silent Microstock Mode `'M'` (`captions.enabled = false`).

**Seeded Runtime Package (auto-copied to `script/` — DO NOT overwrite or hand-code Canvas 2D):**
- `script/keynote-kit.js` (`KeynoteKit`), `script/keynote-layouts.js` (`KeynoteLayouts`), `script/story-runtime.js` (`StoryRuntime`)
- Reference spec & example: [story.schema.json](examples/story.schema.json), [story.example.json](examples/story.example.json)

## How to Author a Product Showreel (Zero Hand-Written JS)

1. Generate showreel BGM/SFX or optional voiceover via `film_audio` (skip audio in Microstock Mode `'M'`).
2. Write **one** declarative `story.json` with `"renderer": "2d-product-keynote"` inside the active project subfolder (`<= 150` lines). Do **NOT** write `index.html` or `script/scene*.js` unless a shot truly needs an escape hatch (`shots[].custom: "script/sceneK.js"`).
3. Optional real product screenshots: place PNG/JPG inside `img/...` and reference `"image": "img/screen.png"` on a `hero-device` shot (auto-masked inside the device bezel).
4. Call `film_scaffold(..., { storyMode: true, useThree: false })` to generate the managed 2D `index.html` and run pre-render `storyLint` validation (`0` errors required).
5. Call `capture_film_preview` to render one midpoint frame per shot into `.aetheria/preview/contact_sheet.jpg` and inspect `storyQa` (`__shotReport`). Apply **at most 1 targeted correction pass** if any shot fails framing/overlap.

## `story.json` Specification (Compact Schema)

```json
{
  "renderer": "2d-product-keynote",
  "title": "Product Launch Title",
  "theme": "obsidian-pro",
  "canvas": { "w": 1920, "h": 1080, "fps": 30 },
  "shots": [
    {
      "id": "shot1_intro",
      "start": 0,
      "duration": 4.0,
      "layout": "brand-intro",
      "theme": "obsidian-pro",
      "eyebrow": "INTRODUCING",
      "headline": "PRODUCT NAME PRO",
      "subheadline": "Precision crafted for modern creators.",
      "icon": "spark",
      "accentColor": "#2997FF",
      "secondaryColor": "#A855F7",
      "transition": "zoom-cross"
    }
  ],
  "captions": { "enabled": false }
}
```

## Valid Enum Values & Contracts
- **`renderer`:** `"2d-product-keynote"` (required so `story_lint` & `film_scaffold` boot the Product Keynote runtime).
- **`layout` (8, auto-adapted to both 16:9 and 9:16 with 0 overlap):** `brand-intro` | `hero-device` (`device`, optional `image`) | `bento-grid` (`items[2..4]`) | `spec-counter` (`statValue`, `statLabel`) | `feature-spotlight` (`icon`, `headline`) | `ui-showcase` (`items[2..3]`) | `split-compare` (`items[2]`) | `cta-outro` (`cta`)
- **`theme` (5):** `pearl-studio` (light Apple studio) | `obsidian-pro` (dark matte) | `titanium-warm` (titanium & gold) | `aurora-keynote` (deep indigo glow) | `mint-editorial` (clean light mint)
- **`device` (6, for `hero-device`):** `laptop` | `phone` | `tablet` | `watch` | `chip` | `card`
- **`icon` (12):** `spark` | `bolt` | `shield` | `cpu` | `layers` | `globe` | `wave` | `lock` | `camera` | `play` | `chart` | `check`
- **`transition` (3):** `zoom-cross` (default) | `slide-push` | `cut`
- **Camera (opt-in `StoryCamera`):** Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus `"seed"` for deterministic variation); avoid numeric camera overrides unless a shot specifically needs `shots[].camera.move`.
- **Timeline continuity:** `shots[0].start == 0`, `shots[k+1].start == shots[k].start + shots[k].duration`, and `duration >= wavDuration`.
- **Captions:** For silent music-driven product commercials, set `captions.enabled: false`; for narrated explainers, set `captions.enabled: true`. Never call `AM.drawTopHeader`.
