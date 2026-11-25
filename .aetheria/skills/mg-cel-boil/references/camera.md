# Camera & Self-QC Guide (mg-cel-boil)

## 1. Default Canvas & TikTok Safe Zone
- **Default format:** `1080x1920` (9:16 portrait, 30 fps) — keep focal heroes and text inside `X: 49..960, Y: 60..1440` above the bottom caption band (`Y: 1440..1700`).

## 2. Active Camera Choreography (StoryCamera)
Always enable root `cameraStyle` + deterministic `seed` (or per-shot `shots[].camera.move`) so frames glide smoothly rather than sitting statically:
```json
"cameraStyle": "kinetic",
"seed": 42
```
Allowed `shots[].camera.move` presets: `hold`, `push-in`, `pull-out`, `pan`, `tilt`, `truck`, `orbit`, `crane`, `handheld`, `whip`, `rack-focus-in`.

## 3. Word-Cue Timing & 3-Frame Self-QC
- Actions and reveals support spoken `"word"` + `"offset"` cues resolved against `audio/*.words.json`.
- `capture_film_preview` inspects **3 frames per shot (`start`, `mid`, `end`)** into `.aetheria/preview/contact_sheet.jpg` alongside `storyQa.directorWarnings` (`[CHECK]`).
- Visual assets: [visual-gallery.png](../assets/visual-gallery.png) · [qc-sheet-example.jpg](../assets/qc-sheet-example.jpg).