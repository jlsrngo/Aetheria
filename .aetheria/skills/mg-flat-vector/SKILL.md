---
name: mg-flat-vector
description: Popwise bold flat-vector and spring-pop motion engine on ultramarine tone-on-tone sky with coral sun & 12 rays, spring-popped skyline, puffy cream clouds, notification ping bubble, and bouncing dot wordmark.
---

# `mg-flat-vector` — Popwise Bold Flat-Vector Engine (v2)

## 1. Visual DNA & Reference Craft (`01-flat-vector`)
- **Ultramarine Tone-on-Tone Sky (`drawSkyShapes`)**: Bold `#2B2BFF` backdrop with `#3B3BFF` geometric accents, `#FF5A4E` coral sun with 12 rounded rays, `#FFC62B` sunny yellow, `#2EE6A8` mint, and `#FFF6E9` cream.
- **Spring-Pop Physics (`spring`)**: Damped spring (`f = 2.4`, `zeta = 0.42`) driving skyline buildings, clouds, notification bubbles, and the bouncing coral dot.

## 2. Layouts (`examples/kit.json`)
1. `sky-dot-bounce`: Coral dot bounces and blooms into a 12-ray sun.
2. `city-pop-rise`: Far skyline and foreground flat-vector buildings spring up beneath drifting clouds.
3. `character-ping`: Notification ping bubble pops above the skyline.
4. `popwise-wordmark`: Clean wordmark lockup with bouncing coral full-stop dot.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/flat-kit.js` or `examples/script/story-runtime.js`.

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-flat-vector/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all text headlines and taglines while preserving the flat-vector shapes and bouncing coral dot.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus integer `"seed"`) for deterministic framing variation; avoid raw numeric camera overrides unless a shot explicitly needs `shots[].camera.move`.
