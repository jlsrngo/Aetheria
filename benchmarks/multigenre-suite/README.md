# Multi-Genre Motion Graphics Benchmark & Render Stability Suite (Phase 5)

Harness evaluasi offline yang dapat direproduksi terhadap biner `aetheria-engine` (murni browser CDP + FFmpeg, tanpa Remotion) lintas beberapa genre motion graphics.

## Kategori Uji Saat Ini (4 Genre Inti)

| Genre | Lapisan yang Diuji |
|---|---|
| `kinetic_typography` | `AM.drawBlurRevealText`, `AM.drawBlurRiseWords`, kurva AE (`aeGlide`) |
| `cutout_collage` | Unified Asset Registry (`assets.json`), `AM.drawAsset` PNG cutout + SVG |
| `3d_multilayer_compositing` | `AetheriaStage` 5-layer serentak (SVG + cutout parent-child rig + 2D + Three.js + `StoryCamera` sinkron + WebGL2 post-process) |
| `shader_heavy` | `AetheriaPost` WebGL2 multi-pass bloom + chromatic aberration + filmic tonemap + vignette + film grain |

## Dimensi Pelaporan Terpisah
Setiap genre melaporkan 4 dimensi secara terpisah (tidak dirangkum menjadi satu skor klaim persentase universal):
- **Visual & Determinism:** `activeForegroundShare`, `determinismMae` (selisih piksel absolut rata-rata antar dua render independen; target `<= 0.05`).
- **Motion:** `frameCount`, `motionMeanDiff`, `frozenPairs`.
- **Runtime Stability:** `runtimeErrors === 0`, serta isolasi jalur gagal (`outputName` traversal `../escape.mp4` ditolak HTTP 400 tanpa menjatuhkan engine).
- **Performance:** `renderMsRunA`, `renderMsRunB`, `effectiveFps`, `outputBytes`.

## Cara Reproduksi

```bash
npm run build:engine
node scripts/run-multigenre-benchmark.mjs
```
