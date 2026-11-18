# Ground-Truth Remake Benchmark & Harness Forensics (`labs-showreel-remake`)

## 1. Archived Ground-Truth Reference
- Video: `labs-showreel-remake.mp4` (`1024x576`, `30fps`, `25.867s`, `114.5 BPM`, `9,925,415 bytes`)
- Manifest: `film.json` (8 scenes, exact contiguous timings `0.000 -> 25.867s`)
- Scene Scripts: `script/scene1.js` .. `script/scene8.js` (**1,618 lines / 55.2 KB total**)
- Measured Baseline Scores (`ref_compare.py`):
  - **19-frame dense (`compare_result.json`):** `overallFidelity = 0.8123`, `ssimMean = 0.8526`, `colorMatchMean = 0.9337`, `edgeMatchMean = 0.5294`
  - **8-frame mid (`compare_result_8mid.json`):** `overallFidelity = 0.8220`, `ssimMean = 0.8579`, `colorMatchMean = 0.9410`, `edgeMatchMean = 0.5535`

## 2. Scene-by-Scene Craft Comparison (`Manual Remake` vs `Agent v8`)
| Scene | Manual Remake Lines | Agent `v8` Lines | Why Agent `v8` Diverged |
|---|---:|---:|---|
| `scene1.js` | 222 (6.7 KB) | 66 (2.2 KB) | `ref_extractor.py` OCR emitted `.S` in `subBeats` and contour detector mislabeled morphing letters `ea` as `pill@(579,252)`. Agent literally rendered `.S` overlapping `Showreel` + duplicate `Showreel` pill box, skipping per-letter geometric morphs. |
| `scene2.js` | 336 (12.2 KB) | 106 (3.5 KB) | Agent followed measured tile wall (`SSIM 0.337 -> 0.651`), but painted bare digits `1..21` instead of 21 vector icons and added floating OCR letters `"S"`, `"8"`, `"△"`, `"L"` on top of tiles. |
| `scene3.js` | 186 (5.7 KB) | 75 (2.3 KB) | Missing `ctx.filter = "blur(6px)"` zoomed 5x3 carousel backdrop behind hero white vertical card. |
| `scene4.js` | 151 (5.5 KB) | 44 (1.4 KB) | Contour detector mislabeled 3D purple arrow silhouette as `pill@(429,359)` -> agent drew `"Explore Work"` pill; AND agent called `AM.drawExtrudedArrow3D(ctx, 512, 180, 1.2, { depth: 30 })` assuming multiplier `1.2` instead of pixel radius `90`, making the arrow a 1.2px speck. |
| `scene5.js` | 235 (8.1 KB) | 29 (0.9 KB) | High dark-background SSIM (`0.978`) masked the complete omission of the early horizontal word marquee (`Motion Designing Workflow Animation Launch`) and late vertical icon slot reel. |
| `scene6.js` | 237 (8.3 KB) | 100 (3.6 KB) | Copied garbled OCR words (`"Ertem"`, `"Estem"`, `"Enum"`, `"Environ"`) literally and omitted the second screen phase (purple concentric ripples + `Movement / Transitions / Design`). |
| `scene7.js` | 69 (2.7 KB) | 46 (1.4 KB) | Close structurally (`0.815`), smaller typography scale/weight polish headroom. |
| `scene8.js` | 182 (5.9 KB) | 71 (2.0 KB) | Drew `L` emblem + pixel bear + `Labs Studio` (`0.779`), simpler voxel geometry & no drop choreography. |

## 3. Proven Root Causes (Model vs Reference Extractor vs Aetheria Harness)
1. **Model Class Difference:** `v3..v8` ran `local-cli/gemini-3.8-flash-high` (`antigravity_auth.rs` maps to `gemini-3-flash`), NOT a frontier Pro/Opus model.
2. **Extractor False Positives (`ref_extractor.py`):** Non-rectangular contours & text-overlapping contours were labeled `"pill"`, and `.S` OCR fragments leaked into `subBeats`.
3. **API Scale Trap (`aetheria-motion.js` / `AM_API.md`):** `AM.drawExtrudedArrow3D` expected pixel `scale = 90` and unit `depth = 0.24`, whereas callers naturally passed multiplier `1.2` and pixel `depth: 30`.
4. **Vision Context Bloat (`preview_film.rs`):** Every `capture_film_preview` attached 13 images (`comparison_strip.jpg` + 12 duplicate `preview_0..11.jpg`), flooding multi-pass polish to 50+ images.
5. **Forced Shallow Batching (`subagent_store.rs` + `subagent_provider.rs`):** Instructing `"batch independent scene writes in parallel"` under `12,288` max tokens compressed 8 scenes into ~40–75 lines each instead of 2–3 craft-rich scenes per turn under `24,576` max tokens.
6. **AST Omission:** `gridTiltDeg` and `contrastTiles` were missing from `style_ast.json` (`ast_scene_obj`).
