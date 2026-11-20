---
name: mg-cel-boil
description: Hand-drawn 2D cel animation and variable-width brush boil engine (on-ones 24fps / on-twos 12fps / on-threes 8fps) with off-register gouache fills, diagonal ink hatching, smear multiples, rubber-hose flame spirit character, col-erase construction arcs, and light-table peg-bar pullback.
---

# `mg-cel-boil` — Declarative Hand-Drawn Cel Animation & Boil Engine (v2)

## 1. Visual DNA & Reference Craft (`05-cel-boil`)
- **Surface & Ink**: Warm animation cel paper (`#F4E9D0`), highlight cream (`#FFF6E2`), dense sumi ink (`#1C1613`), tomato red (`#E5402B`), sunny yellow (`#FFC425`), col-erase red pencil (`#D9573F`), and onion-skin blue (`#5A7BB5`).
- **Variable-Width Tapered Brush Engine (`outline` + `inkW` + `inkStroke` + `inkLoop`)**: Converts Catmull-Rom splines into variable-width polygons with round caps, tapered start/end, pressure jitter, heavier weight along the lower-right shadow normal, and animator corner overshoot (`edge`).
- **Off-Register Boiled Fills (`fillShape`, `REG = { dx: -5, dy: 4 }`) & Hand-Inked Hatching (`hatch`)**: Every gouache fill is independently boiled and shifted `(-5px, +4px)` off-register under the ink line, paired with clipped diagonal ink hatch strokes on cast shadows and box side faces.
- **Stepped Exposure Timing (`getDrawingState`)**: Supports `"on-1s"` (24fps fast action/smears), `"on-2s"` (12fps main character performance), and `"on-3s"` (8fps held locks with 3-drawing boil cycle).

## 2. Layouts (`examples/kit.json`)
1. `strike-smear`: 3D foreshortened matchbox on the paper table + matchstick striking across the gritty striker strip with classic animation smear multiples, dry-brush speed lines, teardrop friction sparks, and red col-erase trajectory arc.
2. `spirit-jump`: Newborn Flame Spirit leaping in a parabolic squash-and-stretch arc from the upright smoking burnt matchstick onto the matchbox top, guided by red col-erase spacing dots.
3. `box-dance`: Hero rubber-hose Flame Spirit (with big paper-white cartoon gloves and two finger creases, rosy cheeks, expressive eyes, and rising fire droplets) performing a Ta-Da bounce atop the matchbox surrounded by boiled cream dust puffs and 4-point twinkles.
4. `badge-riffle`: Pullback to the animator's wooden light-table desk (`84%` scale) showing warm stepped underlight, taped Acme peg bar, stacked paper sheets, blue col-erase onion-skin ghost, scalloped boiled fire badge, reborn tiny spirit holding a glowing ember, and a cartoon white-gloved thumb riffling the lifted lower-right page corner.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/celboil-kit.js` or `examples/script/story-runtime.js`.

```json
{
  "aspect": "9:16",
  "fps": 24,
  "seed": 505,
  "microstockMode": false,
  "shots": [
    {
      "id": "shot_1_strike",
      "layout": "strike-smear",
      "start": 0.0,
      "duration": 2.5,
      "exposure": "on-1s",
      "drawingNumber": 12,
      "sceneCode": "SC. 05A",
      "headline": "STRIKE!",
      "subheadline": "SMEAR & MULTIPLES",
      "tagline": "24 FPS ON ONES · FRICTION SPARKS",
      "spiritFace": "fierce"
    }
  ]
}
```

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-cel-boil/examples" --out "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all text titles, exposure slates, and drawing numbers while keeping the full hand-drawn cel animation intact.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` + `"seed"` for deterministic variation; avoid raw camera numbers unless needed.
