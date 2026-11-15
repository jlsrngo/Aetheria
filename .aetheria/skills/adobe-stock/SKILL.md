---
name: adobe-stock
description: "Adobe Stock Microstock Motion Graphics Engine: deterministic pure-visual backgrounds & abstract motion (1920x1080 / 4K, 24-60fps, 5-60s), zero text/logos/audio/external URLs, continuous motion, and automatic Adobe Stock CSV/manifest metadata."
tags:
  - adobe-stock
  - microstock
  - loop
  - abstract-background
  - deterministic
  - commercial-stock
command: /adobe-stock
---

# Adobe Stock (Microstock) — Pure Visual Motion & Metadata Specification

When **Adobe Stock Mode (`M`)** or `/adobe-stock` is active, the engine and LLM operate strictly under Adobe Stock Contributor technical and content standards (verified 2026-11-15).

---

## 1. Hard Technical & Content Invariants (MUST ENFORCE)

1. **Pure Visuals — ZERO Text, Logos, or Trademarks (`TEXT_IN_COMPOSITION` = FAIL):**
   - **FORBIDDEN:** `ctx.fillText`, `ctx.strokeText`, `<text>`, `<tspan>`, visible HTML text nodes, titles, lower-thirds, watermarks, signatures, brand logos, company names, or UI chrome.
   - Stock buyers overlay their own typography; embedded text or transitions cause refusal (*"Do not add text overlays, transitions, or introductions"* — Adobe Stock Video Best Practices).

2. **100% Deterministic Frame Evaluation (`MOTION_LINT_ERRORS` = FAIL):**
   - **FORBIDDEN:** `Math.random()`, `Date.now()`, `performance.now()`, `setInterval`, `setTimeout`, or autonomous `requestAnimationFrame` loops.
   - **REQUIRED:** Every visual state must be a pure mathematical function of `t` (seconds) inside `window.renderAt(t)` (or `AM.registerScene(..., { render(ctx, t) })`), with `window.__ready = true`.
   - If the clip is designed as a seamless loop (`isLoop: true`), ensure periodic continuity (`sin(2 * Math.PI * t / duration)`, `cos(2 * Math.PI * t / duration)`) so `renderAt(0)` and `renderAt(duration)` match seamlessly.

3. **Zero External URLs & Zero Unlicensed Assets (`EXTERNAL_URL_IN_PROJECT` / `LICENSE_MISSING` = FAIL):**
   - **FORBIDDEN:** Any `http://` or `https://` URL in `index.html` or `script/*.js` (no Google Fonts CDN, no external images/scripts). Use procedural Canvas 2D / WebGL (`AM` or local `/script/three.min.js`) only.

4. **Continuous Motion & No Black Frames (`LOW_MOTION` / `BLACK_FRAMES`):**
   - **FORBIDDEN:** Static holds (*still frames*), frozen segments, or fade-from-black / fade-to-black transitions.
   - **REQUIRED:** Multi-layered continuous motion from `t = 0` to `t = duration` with smooth color gradients, anti-band dithering/grain, and balanced contrast.

5. **Locked Adobe Stock Format & Silent Stream (`HAS_AUDIO` = FAIL):**
   - **Resolution:** Default `1920x1080` (`16:9` Landscape). Allowed Adobe Stock presets: `1920x1080`, `3840x2160`, `1080x1920`, `2160x3840`, `1080x1080`, `2160x2160`.
   - **Frame Rate (FPS):** Integer in `{24, 25, 30, 50, 60}` (default `30`).
   - **Duration:** `5` to `60` seconds (default `8` or `10` seconds).
   - **Audio:** Strictly **NO audio** (`-an`). Do NOT attach `audio` or `sfx` properties to scenes in `window.__filmMeta`, and do NOT generate voiceover/music tracks.

6. **Palette via CSS Custom Properties:**
   - Define palette colors on `:root` CSS custom properties (e.g., `--pal-bg-0`, `--pal-bg-1`, `--pal-accent-0`, `--pal-accent-1`) and read them in `renderAt(t)`, without copying specific artists or copyrighted IP.

7. **Built-in Runtimes & File Layout (`PROTECTED_RUNTIME`):**
   - Put HTML markup in `index.html`, metadata in `microstock/manifest.json`, and all scene code plus `window.__filmMeta`, `window.renderAt(t)`, and `window.__ready = true` in `script/scene1.js`..`script/sceneN.js` (or `script/main.js`).
   - **NEVER create, edit, or overwrite `script/aetheria-motion.js`, `script/three.min.js`, or `script/three.js`.** These are built-in offline engine runtimes served automatically (load `/script/aetheria-motion.js` before `/script/scene1.js` if using `window.AM`, or `/script/three.min.js` if using Three.js). Writing to `script/aetheria-motion.js` shadows `window.AM` and is ignored by the film linter (`MISSING_RENDER_AT`).

---

## 2. Automatic Metadata & Manifest Generation

Whenever you create or update a project in Adobe Stock mode, also write/update `microstock/manifest.json` inside the active project folder (or workspace root) with valid Adobe Stock metadata:
- `metadata.title`: Plain English descriptive title **<= 70 characters**, no commas, no special characters, no artist/brand/IP names (e.g. `"Abstract Flowing Golden Silk Waves Seamless Loop Background"`).
- `metadata.keywords`: Array of **5 to 49 unique lowercase keywords**, ordered by relevance (first 10 carry the highest weight), single language, no trademarks or artist names.
- `metadata.category`: One of the 21 official Adobe Stock categories (e.g. `"Graphic resources"`, `"Technology"`, `"Business"`, `"Science"`, `"Abstract"` -> mapped to `"Graphic resources"`).
