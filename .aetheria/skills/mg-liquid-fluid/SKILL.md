---
name: mg-liquid-fluid
description: 3D glossy studio liquid and SDF jelly typography engine (WebGL2 HDR ray-shaded smooth-union metaballs, Felzenszwalb EDT letter SDFs, softbox Fresnel reflections, splash crown tendrils, diagonal flood sheets, and polished floor mirror ripples).
---

# `mg-liquid-fluid` — 3D Glossy Studio Liquid & SDF Jelly Engine (v2)

## 1. Visual DNA & Reference Craft (`07-liquid`)
- **Studio Cyclorama & Lighting (`FS_SCENE` + `FS_BRIGHT` + `FS_POST`)**: Deep plum studio cyclorama (`#120517` to `#340F3C`) with curved horizon falloff, polished floor mirror reflections (`2.0 * uFloorY - p.y`), contact darkening, cast liquid shadows, colored floor/wall caustics, and 4 studio softboxes (`env(r)` key upper-left, top-right catchlight, right strip light, lower-left kicker).
- **3D Height-Dome & Thickness Shading (`shadeLiquid`)**: Log-sum-exp smooth-union SDF (`Fld`, `fadd`, `fres`, sharpness `uK`) reconstructed into a 3D dome (`R = 95px`, `Hc = 210px`, `tanh(h0/Hc)`) with thickness-driven beer-lambert coloring (`palThin` → `palMid` → `palDeep` across Tangerine `#FFBD4D` → Hot Pink `#FF1A70` → Violet `#8F1FFF`), transmitted rim glow, Fresnel reflection (`R0 = 0.04`), wet specular hotspot (`pow(900)`), diagonal glint sweep, and mipmapped HDR bloom + film grain.
- **Felzenszwalb 2D EDT Letter SDF (`buildLetterSDF`)**: Generates 4-channel sub-pixel Euclidean Distance Transform textures (`RGBA16F`) from any 4-letter hero wordmark (default `"drop"`), blending sharp edge contours with a smoothed interior dome so medial-axis creases vanish.

## 2. Layouts (`examples/kit.json`)
1. `pour-macro`: Macro pour bulb with barrel-refracted ball-lens image (`uLens`), thinning viscous neck pinch-off (`pour_snap`), splash crown tendrils with detaching ballistic beads, and P1–P4 drop landings.
2. `marbled-leap`: Merged liquid mass gathering into a dome and leaping into a 3D marbled swirl sphere (`uSw` curl-warped 3D bands) with a stretching/snapping remnant floor thread.
3. `flood-immersion`: Three diagonal flood sheets (`sheetV` violet L→R, `sheetO` tangerine R→L, `sheetP` hot pink L→R) with bright meniscus rims, 4 under-surface caustic light shafts, rising micro-bubbles, and dense backlit seed blobs.
4. `jelly-wordmark`: Fused liquid bar pinching and splitting into the 4 glossy 3D jelly letters of the wordmark (`drop`) with gooey snapping inter-letter bridges, radial light ring + backlit crown sheet, rising carbonation bubbles, hanging descender drip that snaps and lands on the polished floor, and expanding specular ripple rings.

## 3. Declarative Contract (`story.json`)
Only author `story.json` (validated against `examples/story.schema.json`). Do not edit `examples/script/liquid-kit.js` or `examples/script/story-runtime.js`.

```json
{
  "aspect": "9:16",
  "fps": 30,
  "seed": 707,
  "microstockMode": false,
  "shots": [
    {
      "id": "shot_4_jelly_wordmark",
      "layout": "jelly-wordmark",
      "start": 22.5,
      "duration": 7.5,
      "wordmark": "drop",
      "tagline": "IT ALL STARTS WITH A DROP",
      "subheadline": "EVERYTHING BEGINS AS A DROP · LIQUID MOTION"
    }
  ]
}
```

## 4. Verification & Mode `'M'`
- Deterministic render & contact sheet:
  `node scripts/render-skill-example.mjs --dir ".aetheria/skills/mg-liquid-fluid/examples" --html "story.html" --times "1,5,10,16,22,27" --out-dir "<outDir>"`
- Microstock clean-plate mode (`?microstock=1` or key `'M'`): Suppresses all front typography and replaces the wordmark SDF glyphs with pure 3D glossy liquid spheres and drips.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` + `"seed"` for deterministic variation; avoid raw camera numbers unless needed.
