# Scene & Story Schema Reference (`mg-stickman-story`)

Every video is driven by a single declarative `story.json` rendered at 30fps via `StoryCore.boot` + `StickmanStory`.

## Root Fields
```json
{
  "renderer": "2d-stickman-story",
  "title": "Short Film Title",
  "canvas": { "w": 1080, "h": 1920, "fps": 30 },
  "actorsMap": { "afro": "afro", "nadia": "nadia" },
  "captions": { "enabled": true },
  "fadeIn": 0.3,
  "fadeOut": 0.4,
  "shots": [ ... ]
}
```
- `actorsMap`: maps scene actor IDs (`"afro"`, `"friend"`) to preset names or inline style overrides (`{ "base": "afro", "shirt": "#E05A47" }`).

## Per-Shot Fields (`shots[]`)
| Field | Type / Options | Description |
|---|---|---|
| `id` | `string` | Unique shot ID (`shot1_hook`, `shot2_idea`, ...) |
| `start`, `duration` | `number` | Continuous seconds (`shots[k+1].start == shots[k].start + shots[k].duration`) |
| `stage` | `bedroom` · `park` · `classroom` · `study` · `living-room` · `street` · `school-yard` · `cafeteria` · `field` · `house-front` · `dining-room` · `meadow` · `plain` | Layered 2.5D pastel environment with automatic foreground occlusion |
| `timeOfDay` | `morning` · `day` · `sunset` · `night` | Sky gradient, sun/stars, and warm/night atmospheric tint |
| `caption` | `string` | Spoken narration / word-by-word karaoke subtitle line (omitted in Mode `'M'`) |
| `actors` | `array` | Characters in this shot (`id`, `x`, `y`, `scale`, `facing`, `pose`, `expr`, `backpack`, `prop`, `talk`, `enter`, `actions[]`) |
| `camera` | `object` | `{ "initial": ..., "moves": [...] }` (Director Camera v2) |
| `props` | `array` | Independent world props/icons (`kind`, `x`, `y`, `follow`, `dx`, `dy`, `layer: "back"|"front"`, `at`/`word`, `until`) |
| `bubbles` | `array` | Speech bubbles (`by`, `text`, `style: "speak"|"think"|"shout"`, `side: "left"|"right"|"auto"`, `at`/`word`, `until`) |
| `overlays` | `array` | Comic typography (`text`, `style: "burst"|"title"|"pill"|"big-word"`, `pos: "top"|"center"|"bottom"|[rx,ry]`, `tiltDeg`, `at`/`word`, `until`) |
| `fx` | `array` | Screen effects (`speed-lines`, `flash`, `vignette`, `dim`, `letterbox`, `rain`, `snow`) — never use confetti |
| `transition` | `string \| object` | Entry transition into this shot: `cut`, `flash`, `whip`, `slide`, `wipe`, `fade`, `blink`, `iris` |
| Set Options | flags | `clockTime` (`"07:00"`), `alarm` (`true`), `blanket` (`true`), `signText`, `boardText`, `bgColor` |

## Timed Cue Triggers (`at` vs `word`)
Every item in `actor.actions[]`, `camera.moves[]`, `bubbles[]`, `overlays[]`, `props[]`, and `fx[]` accepts either:
- Numeric seconds: `"at": 1.4`
- Narration phrase cue: `"word": "idea"`, optional `"offset": -0.15`, optional `"occurrence": 0`, and `"untilWord": "morning"`. If the phrase is missing from `caption`/`.words.json`, `StoryCore` emits a `[CHECK]` warning in `storyQa.directorWarnings`.

## Multi-Panel Comic Grid Shot (`"type": "comic"`)
```json
{
  "id": "shot_montage",
  "start": 10.0,
  "duration": 5.0,
  "type": "comic",
  "grid": [2, 2],
  "pageColor": "cream",
  "zoom": { "panel": 3, "at": 3.4, "dur": 1.2 },
  "panels": [
    { "appear": 0.1, "stage": "bedroom", "timeOfDay": "morning", "actors": [{ "id": "afro", "pose": "idle" }] },
    { "appear": 0.9, "stage": "street", "timeOfDay": "morning", "actors": [{ "id": "afro", "pose": "run", "backpack": true }] }
  ]
}
```
