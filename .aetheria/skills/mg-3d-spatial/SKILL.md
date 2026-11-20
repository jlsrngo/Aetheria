---
name: mg-3d-spatial
description: Soft 3D PBR spatial render engine using Three.js with instanced hexagonal pastel capsule bed, extruded 3D sculpted wordmark, glossy vermilion sphere, radial capsule shockwaves, and soft studio shadows.
---

# `mg-3d-spatial` — Soft 3D PBR Hex-Capsule Bed Engine (v2)

## 1. Visual DNA & Reference Craft (`04-3d-render`)
- **Studio PBR & Hexagonal Capsule Bed (`initThree`)**: Soft pastel studio cyclorama (`#FDE8F0`), `PCFSoftShadowMap`, hemisphere + key + rim lights, and an instanced hexagonal bed of pastel capsules (`#F9B4C4`, `#FFE2A8`, `#D7C8F9`, `#BCEAD5`, `#FFC7B2`).
- **3D Sculpted Letters & Glossy Sphere (`buildLetterMesh`)**: Extruded beveled 3D `S O F T` letterforms paired with a glossy vermilion sphere (`#FF5B4D`) that triggers radial capsule shockwaves.

## 2. Layouts (`examples/kit.json`)
1. `capsule-bed-drop`: Letter `S` drops onto the capsule bed, triggering a radial ripple.
2. `letter-cascade`: Letters `O`, `F`, `T` cascade down in sequence.
3. `sphere-shockwave`: Giant vermilion sphere slams into the bed, launching a radial capsule crown.
4. `soft-finale`: Wide 3D `SOFT.` overview with gentle breathing motion.

## 3. Declarative Contract (`story.json`)
- Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/spatial-kit.js` or `examples/script/story-runtime.js`.
- **Shared Camera Rig (`/script/story-camera.js`)**: Set `"cameraStyle": "calm"` (or `"editorial"` | `"kinetic"`) at root with an integer `"seed"` so 3D camera orbits, cranes, trucks, and push-ins vary deterministically across shots while keeping the projected `THREE.Box3` of active letters + sphere inside the safe zone (`guard: "measured"` / `"clamped"`). Do not author raw numeric camera offsets unless a shot explicitly needs custom framing.

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-3d-spatial/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses the 2D HUD overlay while preserving the full 3D PBR render.
