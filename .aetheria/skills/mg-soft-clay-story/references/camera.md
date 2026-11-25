# Camera & Self-QC Guide (`mg-soft-clay-story` — Director Camera v2)

## 1. 3D Camera Presets (`shots[].camera.preset`)
All presets auto-frame `focus` inside the TikTok-first 9:16 safe zone (`X:49..960, Y:60..1440`; scaled cleanly on 16:9) via `StoryCamera`:
- `wide` — Opening/closing establishing shot revealing characters and full 3D set (`open-field`, `city-street`, `indoor-room`).
- `medium` — Waist-up framing for dialogue and two-character interaction (`focus: ["a", "b"]`).
- `close` — Tight face framing to showcase expressions (`happy`, `surprised`, `worried`) and head emotes (`exclaim`, `idea`, `heart`).
- `dolly-in` — Smooth push-in toward hero props or dramatic moments.
- `orbit` — Subtle cinematic arc around the focused cast during cooperative/climax beats.

## 2. Global Camera Choreography (`cameraStyle` + `seed`)
Always enable root `cameraStyle` + `seed` in `story.json` so every shot receives deterministic framing motion without brittle numeric overrides:
```json
"cameraStyle": "editorial",
"seed": 42
```
Available `cameraStyle` profiles: `calm`, `kinetic`, `editorial`.

## 3. Word-Cue Triggers (`word`) & Self-QC (3 Frames per Shot)
- Sync actions or emotes to narration phrases via `"word": "phrase"` + `"offset": -0.15` (backed by `audio/*.words.json` or speech estimation).
- `capture_film_preview` renders **3 frames per shot (`start`, `mid`, `end`)** into `.aetheria/preview/contact_sheet.jpg` alongside `storyQa.directorWarnings` (`[CHECK]`).
- Verify focused actors remain unclipped inside `[SAFE]` across all 3 phases and props never block camera line-of-sight; apply at most 1 targeted revision pass if any shot is flagged.
