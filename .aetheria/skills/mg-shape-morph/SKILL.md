---
name: mg-shape-morph
description: Swiss flat-color via-circle icon morph engine (240-vertex resampled contour correspondence, topological via-circle bridge, Oklab color-field radial & sea-horizon wipes, 360-degree loop flight path, and 7-dot capsule chapter HUD).
---

# `mg-shape-morph` — Continuous Via-Circle Icon Morph Engine (v2)

## 1. Visual DNA & Reference Craft (`08-morph`)
- **Palette (`COLORS`) & Oklab Mixing (`oklab` / `fromOklab` / `mixC` / `tone`)**: Deep Ink (`#16151B`), Warm Cream (`#F4EEE3`), Marigold (`#FFB627`), Vermilion (`#FF4F2B`), Ultramarine (`#2438E8`), with perceptually uniform Oklab gradients and fold-facet shading.
- **240-Vertex Via-Circle Topological Bridge (`blendParts` + `alignTo` + `bestShift`)**: Every hero icon consists of a 240-vertex closed body (`NB = 240`), a 72-vertex counter hole (`NH = 72`), eight 24-vertex round-cap auxiliary strokes (`NM = 24`), and a 60-vertex facet shade (`NS = 60`). Rather than folding self-intersecting edges directly across disparate silhouettes, each transition passes through a shared intermediate circle (`P.via = [cx, cy, R]`) at `u = 0.5` with rotational & directional squash-stretch (`makeM`).
- **Expanding Color-Block Field Wipes (`FIELDS`)**: Radial circle blooms (`circleReg`), rising sea horizon flood (`seaTop`), and impact shockwave ring (`shockReg`) transition the entire canvas between Cream, Marigold, Vermilion, Ultramarine, and Ink in sync with the hero morphs.

## 2. Layouts (`examples/kit.json`)
1. `morning-cup`: Falling drop lands and morphs into the steaming Ink coffee mug (`cup` with ring handle, saucer stroke, and 3 animated sine-wave steam plumes), then blooms a Marigold field and morphs via circle into the spinning 8-ray Vermilion `sun`.
2. `sun-to-sea`: The sun sinks into the rising Ultramarine sea (`sunset` with 5 upper rays and 3 rippling water-reflection bars), then dives and breaches via circle into the flapping Cream `gull`.
3. `flight-loop`: The gull morphs via circle into the faceted 3D `plane`, which accelerates around a full 360° vertical loop-the-loop (with trailing dashed trajectory path), stalls at the apex, and dives into the ground as the Vermilion map `pin` with 3 expanding elliptical shockwave rings.
4. `heart-wordmark`: The pin hops and morphs via circle into the double-beating Cream `heart` over a Vermilion bloom, which then triggers an Ink wipe and buds out the letters of the `morphe.` wordmark + Vermilion full stop with 4 concentric heartbeat rings.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/morph-kit.js` or `examples/script/story-runtime.js`.

```json
{
  "aspect": "9:16",
  "fps": 30,
  "seed": 808,
  "microstockMode": false,
  "shots": [
    {
      "id": "shot_3_flight_loop",
      "layout": "flight-loop",
      "start": 15.0,
      "duration": 7.5,
      "tagline": "05 / 07 · TAKE OFF LOOP → ARRIVAL PIN",
      "captions": ["GOOD MORNING", "SUNRISE", "SUNSET", "SEA BREEZE", "TAKE OFF", "ARRIVAL", "LOVE"]
    }
  ]
}
```

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-shape-morph/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all chapter captions, wordmark letters, and taglines while preserving the pure geometric icon morphs, color-field wipes, and heartbeat rings.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` + `"seed"` for deterministic variation; avoid raw camera numbers unless needed.
