# Motion Specification Intermediate Representation (`SceneMotionSpec` v1)

## 1. Purpose

`SceneMotionSpec` is a compact, typed, deterministic JSON contract produced **before** writing `script/sceneK.js` (`write_motion_spec` tool) and stored alongside the scene at `script/sceneK.motion_spec.json`.

It solves two proven failures from the [Motion Quality Audit](../qa/MOTION_QUALITY_AUDIT.md):
1. **Planning Failures (caught before coding):** Missing required 30fps motion (rotating hero, spinning accent, blur text reveal), invalid time intervals, contradictory hold behavior, or manual previous-scene redraws when a runtime `push_*` bridge is active.
2. **Implementation Failures (caught at `write_scene_script` / `patch_scene_script`):** Code silently dropping planned motion, collapsing diverse planned easings into uniform `outCubic`, or freezing declared living elements.

---

## 2. Schema (`schemaVersion: 1`)

### Required Top-Level Fields
- `schemaVersion`: integer (`1`)
- `sceneId`: string (must match active scene ID in `film.json`)
- `durationSec`: number (`> 0`, within `±0.15s` of scene duration)
- `mode`: `"remake" | "original"` (explicitly separates Reference Remake from Original Creation)
- `elements`: non-empty array of `MotionElementSpec` (`1..=16` elements)

### Optional Top-Level Fields
- `cameraIntent`: `{ kind: "static" | "zoom_in" | "zoom_out" | "pan" | "tracked", startSec?, endSec?, easing?, note? }` (defaults to `"static"`)
- `handoff`: `{ incomingBridge?: "none" | "hard_cut" | "push_left" | "push_right" | "push_up" | "push_down" | "zoom_blur", outgoingIntent?: "hard_cut" | "keep_alive_for_bridge" | "exit_clean" }`

### `MotionElementSpec` Fields

| Field | Required? | Type / Values | Purpose |
|---|---|---|---|
| `id` | **Required** | unique string (`a-z0-9_-`) | Stable identifier for parent/child & QA attribution |
| `role` | **Required** | `"hero" \| "supporting" \| "text" \| "accent" \| "background"` | Enforces motion hierarchy |
| `motionKind` | **Required** | `"enter_settle" \| "blur_reveal" \| "turntable_3d" \| "rotate" \| "sweep" \| "orbit" \| "morph" \| "counter" \| "marching_dash" \| "static_plate"` | Maps deterministically to runtime primitives & compliance checks |
| `startSec` | **Required** | number (`>= 0`, `< endSec`) | Local motion/visibility onset |
| `endSec` | **Required** | number (`<= durationSec + 0.15`) | Local motion/visibility end |
| `easing` | Optional (default `"aeGlide"`) | `"aeGlide" \| "outQuint" \| "inOutQuint" \| "aeSnap" \| "outExpo" \| "outBack" \| "spring" \| "inOutCubic" \| "inCubic" \| "outCubic" \| "linear"` | Prevents accidental `outCubic` monotony |
| `holdBehavior` | Optional (default `"steady"`) | `"steady" \| "living"` | Must align with `hasLivingHold` in `"remake"` mode |
| `omegaDegPerSec` | Optional | number (signed deg/s) | Required (`|omega| >= 25`) for `rotate` / `turntable_3d` |
| `parentId` | Optional | string | Parent element `id` for follow-through / attachment |
| `evidenceRef` | Optional | string | Measured `style.json` cue (e.g. `"secondaryMotion[0]"`, `"filmstrip t=0.40s"`) |
| `intent` | Optional | string (<= 140 chars) | Why this motion exists |

---

## 3. Valid Example (`remake` Mode)

```json
{
  "schemaVersion": 1,
  "sceneId": "scene5_beat_5",
  "durationSec": 2.049,
  "mode": "remake",
  "cameraIntent": { "kind": "static" },
  "handoff": { "incomingBridge": "push_up", "outgoingIntent": "keep_alive_for_bridge" },
  "elements": [
    {
      "id": "bg_grid",
      "role": "background",
      "motionKind": "static_plate",
      "startSec": 0.0,
      "endSec": 2.049
    },
    {
      "id": "crossing_ribbons",
      "role": "supporting",
      "motionKind": "sweep",
      "startSec": 0.03,
      "endSec": 2.049,
      "easing": "aeGlide",
      "holdBehavior": "living",
      "evidenceRef": "secondaryMotion:sweep"
    },
    {
      "id": "headline_smart_luck",
      "role": "text",
      "motionKind": "blur_reveal",
      "startSec": 0.02,
      "endSec": 1.25,
      "easing": "aeGlide",
      "holdBehavior": "steady"
    },
    {
      "id": "top_left_star",
      "role": "accent",
      "motionKind": "rotate",
      "startSec": 0.0,
      "endSec": 2.049,
      "easing": "linear",
      "omegaDegPerSec": 140,
      "holdBehavior": "living",
      "evidenceRef": "spinningObjects:top_left"
    }
  ]
}
```

## 4. Invalid Example (Rejected by Deterministic Validator Before Coding)

```json
{
  "schemaVersion": 1,
  "sceneId": "scene3_proof_or_demo",
  "durationSec": 3.337,
  "mode": "remake",
  "handoff": { "incomingBridge": "push_left" },
  "elements": [
    {
      "id": "prev_scene_exit",
      "role": "supporting",
      "motionKind": "enter_settle",
      "startSec": 0.0,
      "endSec": 0.28,
      "intent": "redraw previous scene sliding left"
    },
    {
      "id": "star_top_right",
      "role": "accent",
      "motionKind": "rotate",
      "startSec": 3.5,
      "endSec": 2.0,
      "omegaDegPerSec": 0,
      "parentId": "nonexistent_parent"
    }
  ]
}
```

**Validator rejections:**
1. `prev_scene_exit`: forbidden manual previous-scene redraw when `incomingBridge == "push_left"` (runtime compositor handles outgoing scene).
2. `star_top_right`: `startSec (3.5) >= endSec (2.0)` and `startSec > durationSec`.
3. `star_top_right`: `motionKind: "rotate"` requires `|omegaDegPerSec| >= 20`.
4. `star_top_right`: dangling `parentId: "nonexistent_parent"`.

---

## 5. Reference Remake vs Original Creation Rules

| Rule | `mode: "remake"` | `mode: "original"` |
|---|---|---|
| Schema / time bounds / unique IDs / valid `parentId` | **Hard Error** | **Hard Error** |
| `turntable_3d` / `rotate` / `blur_reveal` required by `style.json` 30fps signals | **Hard Error** if omitted | Not applicable (no reference video) |
| Manual previous-scene redraw when incoming `push_*` bridge exists | **Hard Error** | **Hard Error** |
| `holdBehavior: "living"` when `hasLivingHold == false` in `style.json` | **Warning** (avoid unreferenced wobble) | Allowed freely when intentional |
| At least one `hero` or `text` element with intentional non-static motion | **Warning** | **Hard Error** (prevents blank/static original scenes) |

---

## 6. Runtime API Mapping & Spec-to-Code Compliance

| `motionKind` / `easing` in Spec | Expected Runtime Call in `script/sceneK.js` | Automated Check |
|---|---|---|
| `turntable_3d` | `AM.drawTurntableObject(...)` with non-zero `omega` | `SPEC COMPLIANCE: missing AM.drawTurntableObject` |
| `rotate` (`|omega| >= 20`) | `ctx.rotate(...)` (continuous `t`-driven angle) | `SPEC COMPLIANCE: missing ctx.rotate` |
| `blur_reveal` | `AM.drawBlurRevealText(...)` or `AM.drawBlurRiseWords(...)` | `SPEC COMPLIANCE: missing blur reveal text helper` |
| `marching_dash` | `ctx.setLineDash(...)` + `ctx.lineDashOffset` | `SPEC COMPLIANCE: missing animated lineDashOffset` |
| `morph` | `AM.drawMorphPolygon(...)` or continuous `AM.lerp` | Checked with frozen-morph cutoff hazard |
| `easing: "spring"` | `AM.spring(...)` or `AM.pop(...)` | Diagnostic warning if missing |
| `easing: "aeGlide" \| "outQuint" \| "aeSnap" \| "outExpo"` | Matching `AM.ease.*` / `AM.E.*` / `AM.bezier` | Warning if entire script fell back exclusively to `outCubic` |

## 7. Backward Compatibility & Versioning
- `schemaVersion: 1` is optional on legacy projects (`film.json` without `sceneK.motion_spec.json` renders unchanged).
- Controlled via `AETHERIA_DIRECT_MOTION_SPEC=on|off` (default `on` in filmstrip direct remake; set `off` for controlled A/B baseline experiments).
