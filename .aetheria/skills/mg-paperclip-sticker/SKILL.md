---
name: mg-paperclip-sticker
description: Paperclip die-cut sticker and editorial tech-infographic engine on a 44px dot-grid board with slap-physics drop shadows, damped wobble, periodic element tiles, dashed route connectors, and device bezel pullback.
---

# `mg-paperclip-sticker` — Die-Cut Sticker & Editorial Infographic Engine (v2)

## 1. Visual DNA & Reference Craft (`19-paperclip`)
- **Dot-Grid Board & Device Bezel (`drawDotBoard`)**: Crisp `#E9EEF2` board with `#C5CFD8` dot grid, `#25313D` ink, `#FF5A36` vermilion orange accents, and dark desk `#1D2731` / `#0E141A` bezel pullback.
- **Slap Physics (`slap` + `drawDieCutSticker`)**: Stickers drop from `1.32×` scale with dynamic lift shadow and damped wobble (`wob`).

## 2. Layouts (`examples/kit.json`)
1. `sticker-slap`: Die-cut smartphone, PCB chip, and battery stickers slap onto the board.
2. `supply-chain`: Dashed orange route connecting hardware & element nodes.
3. `chip-matrix`: 2×2 periodic element tile matrix (`Li`, `Co`, `Sn`, `La`).
4. `bezel-pullback`: Full device bezel pullback over the dark studio desk.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/sticker-kit.js` or `examples/script/story-runtime.js`.

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-paperclip-sticker/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all text headlines, taglines, and element symbols while keeping the die-cut stickers and dot-grid board.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus integer `"seed"`) for deterministic framing variation; avoid raw numeric camera overrides unless a shot explicitly needs `shots[].camera.move`.
