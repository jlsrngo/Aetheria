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
- `move` — Direct eased glide (`smootherstep` C2 quintic by default) to a new `{ size, focus, x, y, z, dx, dy }`.
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

## 3. Word-Cue Sync & Pacing Rules
- Attach reactions directly to narration via `"word": "idea"` (`"offset": -0.15`) so reveals pop on the exact spoken syllable.
- Switch shot or camera move at least every `<= 4.0s`.
- Never place 3 consecutive shots with the same `(size, stage)` — `storyQa.directorWarnings` will flag `[CHECK]`.
- Keep all focused heads inside the TikTok safe zone (`X:49..960, Y:60..1440`) across all 3 Self-QC frames (`start`, `mid`, `end`).
