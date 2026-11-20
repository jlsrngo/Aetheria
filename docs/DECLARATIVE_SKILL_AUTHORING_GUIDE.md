# Aetheria Declarative Motion Skill Authoring Guide (`kit.json` + `story.json`)

> **How to use this document:** Attach or send this `.md` file directly to any AI coding agent along with your target visual style brief (e.g., *"Create a declarative motion skill package for a dark neon tech explainer following this guide"*). The agent will produce a complete, self-contained skill package that can be **uploaded or imported directly into Aetheria** and executed on the **zero-JS `story.json` fast path without modifying or recompiling the Rust engine**.

---

## 1. Architecture Overview

A declarative motion skill separates reusable rendering craft from per-video storytelling:

1. **Reusable Kit Code (authored once per skill):** Pure Canvas 2D or Three.js (r128) visual builders, anti-overlap layouts, auto-framing math, and the `window.StoryRuntime` bootstrapper.
2. **Declarative Story Spec (`story.json`, authored per video):** A compact JSON specification (`<= 150` lines for a typical 6-shot ~30s film) describing shots, copy, palette accents, layouts/assets, and timing.

When invoked via `/<slug>`, the Aetheria engine automatically:
- Seeds all `examples/script/*.js` files and `examples/kit.json` into the active project folder.
- Validates `story.json` pre-render using `kit.json` (timeline continuity, WAV/duration alignment, custom enum values, safe `custom` script paths).
- Generates a managed `index.html` via `film_scaffold(storyMode: true)` with zero `script/scene*.js` stubs.
- Captures one midpoint frame per shot into `.aetheria/preview/contact_sheet.jpg`, reads `window.__shotReport` + `window.__storyStats`, and performs automatic rollback if a correction pass worsens validation.

---

## 2. Required Package Directory Structure

All package files must use relative paths inside the skill folder (`<slug>` in lowercase kebab-case, e.g. `neon-explainer` or `mg-flat-vector`):

```text
<slug>/
├── SKILL.md                        # Concise skill specification (target 3,000–4,800 chars)
├── tokens.json                     # Palette tokens, default canvas format, example index
└── examples/
    ├── kit.json                    # Generic kit manifest (read by the Rust engine)
    ├── story.schema.json           # JSON Schema contract for story.json
    ├── story.example.json          # Working 6-shot reference story (<= 150 lines)
    ├── story.html                  # Standalone local preview harness
    └── script/
        ├── <name>-kit.js           # Parametric visual primitives, icons, or 3D assets
        ├── <name>-layouts.js       # Layout presets + bbox & overlap calculation (optional if merged)
        └── story-runtime.js        # MUST be named `story-runtime.js` (exports window.StoryRuntime)
```

> **Security & Offline Constraints:** Allowed upload extensions are `.md`, `.json`, `.js`, `.html`, `.css`, `.svg`. Path traversal (`..`) and external CDN/network URLs are forbidden — every script must run **100% offline**. The engine already serves `/script/aetheria-motion.js`, `/script/story-core.js` (Core API v1), `/script/story-camera.js` (Camera API v1), and Three.js r128 at `/script/three.min.js`.

---

## 3. `examples/kit.json` Manifest Contract (Required for Zero-Recompile Fast Path)

The engine reads `examples/kit.json` generically to generate `index.html` and validate `story.json` enums without hardcoding the skill in Rust:

```json
{
  "renderer": "2d-neon-explainer",
  "core": 1,
  "useThree": false,
  "background": "#0B0F1A",
  "scripts": [
    "script/neon-kit.js",
    "script/story-runtime.js"
  ],
  "enums": {
    "theme": ["cyber-dark", "mint-light"],
    "layout": ["hero-title", "split-cards", "stat-big", "outro-cta"],
    "icon": ["bolt", "shield", "chart", "spark"],
    "transition": ["fade-zoom", "cut"]
  }
}
```

- `renderer`: Unique identifier for the skill (`"2d-<name>"` or `"3d-<name>"`).
- `core`: Optional integer `1` — injects `/script/story-core.js` (`window.StoryCore`) automatically before kit scripts so `story-runtime.js` stays thin (~20–40 lines) without duplicating bootstrap, dialect normalization, shot/caption lookup, safe-zone math, or Mode `'M'` handling.
- `useThree`: `false` for Canvas 2D (`#stage-2d`), `true` for Three.js WebGL (`#stage-webgl` + `#stage-hud`).
- `background`: Default CSS background color for the HTML stage.
- `scripts`: Ordered list of `script/*.js` files to load (end with `"script/story-runtime.js"`).
- `enums`: Map of field name to allowed string values. The Rust validator automatically enforces each enum on both root-level fields (e.g. `theme`) and per-shot fields (e.g. `layout`, `icon`, `transition`, or string arrays such as `accents`).

---

## 4. `examples/script/story-runtime.js` Runtime Contract (Required)

Preferred approach (Core API v1, `"core": 1` in `kit.json`): load `/script/story-core.js` and call `window.StoryCore.boot({ id, defaultTitle, init?, renderShot, measureShot? })`. `StoryCore` handles fetching `/story.json` (with `/story.example.json` fallback), Dialect A/B normalization, `window.renderAt`, `window.__seek`, `window.__ready`, `window.__filmMeta`, `window.__shotReport`, and Mode `'M'` (`?microstock=1` + key `M`).

The headless previewer and renderer rely on the following global contract:

1. **Export `window.StoryRuntime.boot(opts)`:**
   - Receives `{ canvas, storyUrl, fallbackStoryUrl, isMicrostock }` (2D) or `{ glCanvas, hudCanvas, storyUrl, fallbackStoryUrl, isMicrostock }` (3D).
   - Fetches `storyUrl` (falling back to `fallbackStoryUrl`), renders frame `t = 0` (frame 0 must already be visually composed — never blank or black), and sets **`window.__ready = true`**.
2. **Export `window.__filmMeta`:**
   ```js
   window.__filmMeta = {
     title: spec.title || "Untitled",
     width: W,
     height: H,
     fps: FPS,
     duration: totalDuration,
     durationInFrames: Math.round(totalDuration * FPS),
     captionsEnabled: captionsEnabled,
     storyStats: { customShots, totalShots, customRatio },
     scenes: shots.map(s => ({
       id: s.id, title: s.id, start: s.start, duration: s.duration,
       audio: s.audio?.wav, words: s.audio?.words
     }))
   };
   ```
3. **Export Pure Deterministic `window.renderAt(t)`:**
   - Must be a pure deterministic function of time `t` (seconds). **Never** use `Date.now()`, `Math.random()`, `requestAnimationFrame`, or CSS transitions.
   - Two consecutive calls to `renderAt(t)` with the same `t` **must** produce byte-identical frames.
   - Must populate **`window.__shotReport[shot.id]`** on every render:
     ```js
     window.__shotReport[shot.id] = {
       shotId: shot.id,
       t: Math.round(globalT * 1000) / 1000,
       localTime: Math.round(localT * 1000) / 1000,
       focusBboxInSafeZone: inSafe, // required boolean
       bbox: { behind: false, minX, minY, maxX, maxY, width, height },
       overlapCount: overlapCount,  // 0 when no visual regions collide
       safeZone: safeZone,
       errors: errors               // [] when clean
     };
     ```
   - Must expose **`window.__storyStats = { customShots, totalShots, customRatio }`**.
4. **Safe-Zone Coordinates:**
   - **Portrait 9:16 (`1080×1920`):** `minX = round(w * 0.045)` (`49`), `maxX = round(w * 960/1080)` (`960`), `minY = round(h * 60/1920)` (`60`), `maxY = round(h * 1440/1920)` (`1440`). Regions `Y > 1750` and `X > 960` are TikTok/Reels UI deadzones.
   - **Landscape 16:9 (`1920×1080`):** `minX = round(w * 0.05)`, `maxX = round(w * 0.95)`, `minY = round(h * 0.06)`, `maxY = round(h * 0.88)`.
5. **Microstock Silent Mode `'M'` (Required):**
   - When `opts.isMicrostock === true`, draw **zero text** (`fillText`, `strokeText`, and `AM.drawSubtitles` disabled) — render pure graphics/icons/motion only.
6. **Custom Escape Hatch (`shots[].custom`):**
   - When `shot.custom` is set (e.g. `"script/scene3.js"`), invoke `window.AM?.getSceneRenderer?.(shot.id, index)` if registered, and count it in `window.__storyStats.customShots`.

---

## 4.5 Shared Declarative Camera Rig (`/script/story-camera.js`, Camera API v1)

Declarative skills can keep one visual identity while varying camera motion deterministically across shots and across videos by opting into `/script/story-camera.js` (`window.StoryCamera`):

1. **Manifest (`examples/kit.json`):** Add `"camera": { "version": 1, "maxZoom": 1.35, "maxPan": 0.08, "maxRollDeg": 3.5 }` (or `"camera": 1`). The engine automatically injects `<script src="/script/story-camera.js"></script>` into managed `index.html` and validates `cameraStyle` / `shots[].camera` via `STORY_CAMERA_INVALID` (`studio/story_camera_lint.rs`).
2. **Opt-in `story.json` Contract:**
   - Root: `"cameraStyle"?: "calm" | "kinetic" | "editorial"` plus integer `"seed"` (never alters existing kit jitter semantics of `seed`). When both `cameraStyle` and `shot.camera` / `shot.cameraPreset` are omitted, `StoryCamera.resolve` returns the exact identity rig so existing examples remain pixel-identical.
   - Shot: `"camera"?: { "move"?, "intensity"?: 0..1, "dir"?: "auto|left|right|up|down|in|out", "seed"?: int, "moveDuration"?: number >= 0.1 | "shot", "curve"?: "ease-out|ease-in-out|linear|whip" }`.
   - Built-in move table (`StoryCamera.MOVES`, 11 moves): `hold`, `push-in`, `pull-out`, `pan`, `tilt`, `truck`, `orbit`, `crane`, `handheld`, `whip`, `rack-focus-in`.
   - Legacy compatibility (`StoryCamera.LEGACY_PRESETS`): Cobalt's 7 `cameraPreset` entries and numeric overrides remain bit-accurate (`<= 1e-6`).
3. **Determinism & Move Director:**
   - RNG is pure mulberry32 seeded via FNV-1a `hashSeed(story.seed|0, shot.id, "camera", camera.seed|0)` — never uses wall-clock or nondeterministic state.
   - When `camera.move` is omitted under `cameraStyle`, `StoryCamera.planStoryMoves(story)` avoids repeating the previous shot's move or direction (`repeatOfPrevious === false`).
4. **Framing Guard (`measured` / `clamped` / `unmeasured`):**
   - Provide a real projected focus bbox (`focusBox` in 2D via `measureShot`, or `projectFocus(rig, sampleU)` in 3D via `THREE.Box3`) so `StoryCamera.guard` verifies 12 samples across the shot and reduces intensity (up to 4 steps × `0.7`) until focus fits inside `safeZone`.
   - If a layout cannot provide a real bbox, pass `focusBox: null` — `StoryCamera` enforces conservative `kit.json` `camera` bounds and reports `guard: "unmeasured"` in `window.__cameraReport[shot.id]`. **Never report a skill without a real bbox as "in safe zone".**

---

## 5. `SKILL.md` Authoring Rules (Skill-Lint Compliant)

- Start with YAML frontmatter:
  ```yaml
  ---
  name: <slug>
  description: "One-sentence summary of the declarative motion style."
  tags:
    - motion-graphics
    - aetheria-motion
    - aetheria-html
  command: /<slug>
  ---
  ```
- Keep total length concise (**3,000–4,800 characters**): document the 4-step workflow (`film_audio` → write `story.json` → `film_scaffold(storyMode: true)` → `capture_film_preview`), one compact JSON example, and the exact enum lists matching `examples/kit.json`.
- **Forbidden boilerplate (rejected by skill-lint):** Never include `window.renderAt = function`, `__filmMeta`, `workspace/script`, `workspace/index.html`, `render at full resolution`, `exactly 10.00 s`, `render to output/video.mp4`, or mandatory `AM.drawTopHeader` instructions.

---

## 6. Importing / Uploading a Skill Package into Aetheria

Once the AI agent generates the package files, import them using any of these three methods (all immediately activate `/<slug>` on the zero-JS fast path):

1. **Multi-File API Upload (`POST /api/skills/add` or `/api/styles/add`):**
   ```json
   {
     "name": "Neon Explainer",
     "description": "Declarative 2D dark neon explainer skill.",
     "files": [
       { "path": "SKILL.md", "content": "..." },
       { "path": "tokens.json", "content": "..." },
       { "path": "examples/kit.json", "content": "..." },
       { "path": "examples/story.example.json", "content": "..." },
       { "path": "examples/script/neon-kit.js", "content": "..." },
       { "path": "examples/script/story-runtime.js", "content": "..." }
     ]
   }
   ```
2. **Local Directory Import (`POST /api/skills/add` or `add_skill` tool):**
   Pass `name` and `filePath` pointing to the local skill folder containing `SKILL.md` and `examples/`. The engine recursively copies all valid package files into `.aetheria/skills/<slug>/`.
3. **Direct Folder Drop:**
   Place the `<slug>/` folder inside `.aetheria/skills/<slug>/` and immediately invoke `/<slug>` in chat.

---

## 7. Pre-Release Verification Checklist

- [ ] `examples/kit.json` is valid JSON and every entry in `scripts[]` exists under `examples/script/`.
- [ ] `examples/story.example.json` has `shots[0].start == 0` and contiguous timing (`start[k+1] == start[k] + duration[k]`).
- [ ] 2× deterministic render passes: `node scripts/render-skill-example.mjs --dir .aetheria/skills/<slug>/examples --html story.html` → `outOfSafeZoneCount == 0`, `runtimeErrorsCount == 0`, and identical SHA-256 hashes across both runs.
- [ ] Microstock Mode `'M'` passes: `--html "story.html?microstock=1"` → zero text and zero runtime errors.
