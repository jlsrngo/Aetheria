---
name: mg-isometric
description: Isopolis 2.5D isometric floating city engine with lilac dot-grid sky, 4-layer stepped island base, depth-sorted 12x12 city map, blueprint cyan-edge clay extrusion, radial scanline pastel ignition, animated vehicles, and City OS HUD.
---

# `mg-isometric` — Isopolis 2.5D Floating City Engine (v2)

## 1. Visual DNA & Reference Craft (`03-isometric`)
- **Sky & Island (`drawBackground` + `drawIslandBase`)**: Soft lilac gradient (`#EEEAFC` → `#C4BAEF`), isometric dot grid (`#A79EE2`), floating clouds, and a 4-layer stepped soil slab (`#FFFFFF` → `#9F95E1`) supporting the 12×12 city grid.
- **Clay-to-Pastel Ignition (`drawIsoBox` + `drawWindows`)**: Buildings extrude in clay (`#F1EEFA`) with cyan blueprint edges (`#62F0F2`), then ignite into pastel facades (`#FFC4AC` peach, `#A8D2FF` sky, `#D9D1FA` lilac, `#FFE6A1` butter) with warm lit windows (`#FFF0C8`).

## 2. Layouts (`examples/kit.json`)
1. `clay-grid`: Buildings extrude upward in clay with cyan blueprint edges.
2. `city-ignition`: Expanding cyan pulse ring sweeps outward from the central core tower, igniting pastel colors.
3. `traffic-flow`: Full-color city with animated vehicles cruising the perimeter road loop.
4. `isopolis-overview`: Complete floating metropolis overview with glowing core antenna and City OS HUD.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/isometric-kit.js` or `examples/script/story-runtime.js`.

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-isometric/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all HUD titles and metrics while preserving the full 2.5D isometric city.
