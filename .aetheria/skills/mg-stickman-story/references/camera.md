# Director Camera v2 & Cinematography Rules (`mg-stickman-story`)

Never leave a shot completely frozen. Every shot runs `StoryCamera.createDirectorCamera` with **always-on living camera drift** (`livingHold: true` subtle breathing + `creep: 0.05` slow push) plus explicit multi-beat `moves[]`.

## 1. Semantic Shot Sizes (`camera.initial` / `moves[].to`)
| Size | World Zoom `z` | Vertical Framing | Best Used For |
|---|---|---|---|
| `extreme-wide` | `0.56` | Full environment & horizon | Establishing locations (`park`, `street`, `field`) |
| `wide` | `0.86` | Full body + surrounding room/prop | Action entrances, two-character staging |
| `full` | `1.25` | Full figure framed tight (ideal for 9:16) | Solo dialogue, expressive poses, walking beats |
| `medium` | `1.90` | Waist up | Emotional reactions, shared two-shots, gestures |
| `close` | `3.00` | Head & shoulders | Punchlines, realization, eyebrow/eye beats |
| `extreme-close` | `5.20` | Eyes / mouth / macro prop | Tense silence, shocked reveal, alarm dial |

> **9:16 Portrait Rule:** On `1080x1920`, prefer `full`, `medium`, and `close` (or moderate `z: 1.0..2.8`) so characters fill the vertical frame boldly above the bottom subtitle band (`y > 0.78*H`).

## 2. Camera Moves Catalog (`camera.moves[]`)
- `fly-to` — Smooth log-space curve with automatic mid-flight zoom-out dip when crossing distance (hero -> clock -> wide room).
- `move` — Direct eased glide (`smootherstep` C2 quintic by default) to a new `{ size, focus, x, y, z, dx, dy }`. Works for directional **pan** (`dx`), **tilt** (`dy`), and **crane** (`dy` + `z` change) moves.
- `push` / `push-in` — Smooth zoom-in (`mult`, default `1.4`) to heighten focus.
- `pull` / `pull-out` / `reveal` — Pulls back (`mult`, default `1.4`) to reveal context or a surprise character.
- `snap-zoom` — Fast whip punch-in (`dur: 0.25s`, `ease: "snap"`) with soft whoosh SFX for comedy / realization (`"AHA!"`).
- `whip` — Fast pan across set with automatic horizontal motion smear (`dur: 0.38s`) and whoosh SFX.
- `follow` — Smooth 7-sample historical lag tracking of a moving actor (`focus: "afro"`, `lag: 0.5`, `until: 1.4`) with automatic facing look-room.
- `punch` — Crisp beat kick (`strength: 0.14`, `dur: 0.45`) with `thud` SFX.
- `shake` — Zoom-normalized decaying camera rumble (`strength: 8..16`, `dur: 0.5..0.8`) paired with alarm or stomp.
- `orbit-sway` — Gentle sinusoidal horizontal drift (`strength: 50`, `period: 6.0`) for lingering emotional holds.
- `dutch` — Subtle roll tilt (`r: -6..6` deg) for comic tension or off-balance panic.
- `rack-focus` — Soft background blur pulse (`blur: 6`) isolating foreground focus.
- `cut` — Instant hard cut mid-shot to a new framing target.

## 3. 15-Row Moment -> Camera Recipe Table
| Narrative Moment | `initial` | `moves[]` Sequence | Suggested `transition` |
|---|---|---|---|
| Opening hook (insert) | `{ size: "close", focus: "<prop>" }` | `fly-to` -> `{ size: "full", focus: "<hero>" }` | `fade` (`0.3s`) |
| Alarm / wake-up shock | `{ x: 185, y: -214, z: 2.8 }` | `shake` (`strength: 8, dur: 0.8`) -> `fly-to` `{ size: "full" }` | `cut` / `flash` |
| Realization / "AHA!" | `{ size: "full", focus: "<hero>" }` | `punch` (`0.14`) + `snap-zoom` on `"word"` (`z: 1.65`) | `flash` (`0.28s`) |
| Running entrance | `{ size: "full", focus: "<hero>" }` | `follow` (`until: 1.35`) -> `push` (`focus: [a, b]`) | `whip` (`left`/`right`) |
| Two-character banter | `{ size: "wide", focus: ["a", "b"] }` | `orbit-sway` (`strength: 45, period: 5.5`) + `push` | `slide-push` / `cut` |
| Tense silence / reveal | `{ size: "medium", focus: "<hero>" }` | `push` (`mult: 1.35, ease: "linear"`) | `blink` / `cut` |
| Dramatic reveal (context) | `{ size: "close", focus: "<hero>" }` | `pull` (`mult: 1.55, dur: 1.2`) | `iris` |
| Comic panic / spiral | `{ size: "full", focus: "<hero>" }` | `dutch` (`r: -4.5, dur: 0.6`) + `shake` (`strength: 10`) | `whip` |
| Warm / emotional beat | `{ size: "medium", focus: "<hero>" }` | `orbit-sway` (`strength: 32, period: 6.0`) | `crossfade` |
| Walk-and-talk exposition | `{ size: "full", focus: "<hero>" }` | `follow` (`lag: 0.45`) + pan (`move` `dx`) | `slide-push` |
| Punchline beat | `{ size: "medium", focus: "<hero>" }` | `snap-zoom` (`to: { size: "close", focus: "<hero>" }`) | `cut` |
| Crowd / room establish | `{ size: "extreme-wide" }` | `move` (`dy: -40, z: 1.05` crane down) | `zoom-cross` |
| Quick location switch | `{ size: "full", focus: "<hero>" }` | `whip` (`dir: "left"`, `dur: 0.38`) | `whip` |
| Comic / montage recap | `{ grid: [2, 2], panels: [...] }` | `zoom` onto hero panel (`dur: 1.0`) | `zoom-cross` |
| Closing wave / CTA | `{ size: "full", focus: ["a", "b"] }` | `push` (`mult: 1.15`) -> gentle `orbit-sway` | `fade` (`0.4s`) |

## 4. Word-Cue Sync, Aspect Ratio & 9-Frame Strip Inspection
- Attach reactions directly to narration via `"word": "idea"` (`"offset": -0.15`) so reveals pop on the exact spoken syllable.
- Switch shot or camera move at least every `<= 4.0s`; never place 3 consecutive shots with the same `(size, stage)` or `storyQa.directorWarnings` will flag `[CHECK]`.
- **Optional 16:9 Landscape (`1920x1080`):** Only use when explicitly requested by the user (`z: 0.85..1.90` feels wider horizontally; adjust `overlays[].pos` inside `0.15..0.85`).
- **On-Demand 9-Frame Motion Strip:** Default `capture_film_preview` captures 3 frames per shot (`start`, `mid`, `end`). For fast `follow`, `fly-to`, or `whip` shots, call `capture_film_preview({ framesPerShot: 9, stripShotId: "<shotId>" })` to inspect `.aetheria/preview/strip_<shotId>.jpg`.
- Keep all focused heads inside the TikTok safe zone (`X:49..960, Y:60..1440`) across all Self-QC frames.
