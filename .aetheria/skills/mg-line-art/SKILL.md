---
name: mg-line-art
description: Atelier Linea continuous one-line champagne-gold SVG path engine on deep navy drafting paper with parallax dot grid, floating gold motes, hot glowing pen tip, exponential breaking wave curl, and beveled anisotropic gold medallion.
---

# `mg-line-art` — Atelier Linea Continuous One-Line Engine (v2)

## 1. Visual DNA & Reference Craft (`02-line-art`)
- **Surface & Grid (`drawBackground` + `drawMotes`)**: Deep navy drafting paper (`#0B1320`) with radial vignette, 48px parallax dot grid (`rgba(160,180,210,0.09)`), and 40 floating warm gold motes.
- **Continuous One-Line Champagne-Gold Stroke (`buildPath` + `lineColor`)**: A single uninterrupted SVG path sampled at 1.2px intervals with organic hand-drawn wobble on natural segments and ruled precision on architectural/logo segments, grading from `AGED` (`#967D50`) → `GOLD` (`#E9D7A5`) → `HOT` (`#FFF6DC`) behind a glowing pen tip (`glowAt`).

## 2. Layouts (`examples/kit.json`)
1. `seed-sprout`: Ground line → seed → stems & leaves → curling tendril.
2. `pavilion-skyline`: Roof beam → arched pavilion → tower → city skyline.
3. `breaking-wave`: Horizon → concave wave back → counter-clockwise exponential spiral curl → rising lift.
4. `atelier-medallion`: Medallion ring + carved doorway arch → gold coin swell-in with directional bevel & expanding 1px echo ring.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/lineart-kit.js` or `examples/script/story-runtime.js`.

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-line-art/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all typography and hairline rules while preserving the continuous one-line drawing and gold medallion.
