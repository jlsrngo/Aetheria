---
name: mg-kinetic-calligraphy
description: Kinetic calligraphy and spring-extruded display typography engine on warm Xuan paper with variable-pressure sumi-e brush strokes, radial manga focus rays, ink splatters, and vermilion hanko seal stamp.
---

# `mg-kinetic-calligraphy` — Kinetic Calligraphy & Spring Typography Engine (v2)

## 1. Visual DNA & Reference Craft (`18-hanazi`)
- **Xuan Paper & Sumi Brush (`drawXuanPaper` + `drawBrushStroke`)**: Warm textured Xuan paper (`#F4EFE6`), variable-pressure sumi ink (`#181614`) Enso & slash strokes, ink splatters, and 4-point gold/vermilion sparkles.
- **Spring-Extruded Display & Hanko Seal (`drawKineticTitle` + `drawHankoStamp`)**: Damped spring pop (`zeta = 0.517`, `omega = 22`) with white inner stroke + extruded ink shadow, paired with a vermilion hanko seal (`#C82822`).

## 2. Layouts (`examples/kit.json`)
1. `brush-reveal`: Enso & diagonal brush strokes draw in with ink splatter.
2. `focus-burst`: Radial manga focus rays + spring-extruded headline.
3. `ink-cascade`: Dense ink splatter energy + focus rays.
4. `hanko-seal`: Full calligraphy lockup + stamped vermilion hanko seal.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/calligraphy-kit.js` or `examples/script/story-runtime.js`.

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-kinetic-calligraphy/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all text headlines, taglines, and hanko seal text while preserving the sumi-e brush art and focus rays.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus integer `"seed"`) for deterministic framing variation; avoid raw numeric camera overrides unless a shot explicitly needs `shots[].camera.move`.
