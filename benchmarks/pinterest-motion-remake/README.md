# Pinterest Motion Remake Benchmark (`ref_pinterest.mp4` — Run 9)

Arsip benchmark offline untuk evaluasi regresi kualitas rekonstruksi gerak (*motion feel*), komposisi, tipografi, dan aset 3D pada pipeline **Direct Per-Scene Agentic Remake** (`core/aetheria-engine/` + `core/ref_extractor/` + `apps/public/script/aetheria-motion.js`).

> **Catatan Isolasi (`AGENTS.md §1 & §4`):** Folder ini hanya untuk acuan kualitas dan regresi offline. Engine, prompt, dan agen **dilarang** memuat, menyalin, atau meng-hardcode aset/skrip dari folder ini saat menghasilkan proyek pengguna.

## Isi Arsip

| File | Keterangan |
|---|---|
| `ref_pinterest.mp4` | Video referensi asli (`720×1280`, `29.97fps`, `17.88s`, `536` frame, 6 scene). |
| `remake_run9.mp4` | Video hasil render otomatis penuh **Run 9** (`720×1280`, `30fps`, `537` frame, `AETHERIA_MOTION_BLUR=auto`). |
| `stopmotion_ref_vs_run9_6fps.mp4` | Video perbandingan berdampingan (`REFERENCE` vs `RUN 9`, 6fps di-encode ke 30fps H.264). |
| `film.json` + `script/scene1.js..scene6.js` + `img/brain.png` | Proyek modular hasil generasi otomatis Run 9 (6 scene, 0 runtime error, 0 hazard). |
| `fidelity_36frame_run9.json` | Hasil evaluasi `ref_compare.py` pada 36 timestamp merata. |
| `compare_result_run9.json` | Hasil evaluasi `scripts/compare-result-vs-ref.py` (cut offset, motion ratio, palette drift). |
| `motion_feel_run9.json` | Hasil evaluasi `scripts/motion-feel-report.py` (dead hold lag-15 & seam pop ratio). |
| `summary_run9.json` | Ringkasan telemetri sesi & skor per-scene (`ses_1a2087682d5074c0001`). |

## Progres Benchmark (Run 1 → Run 9)

| Run | Fokus Perubahan Generik | 36-Frame Overall | SSIM | Color | Edge | Low-Edge (`<=0.15`) | Dead Holds | Seam POP | Catatan Utama |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Run 1 | Baseline awal sebelum perbaikan forensik | `0.5772` | — | — | — | tinggi | — | — | Banyak drift posisi, teks statis, otak prosedural 2D |
| Run 5 | Multi-phase tracks + keyframe chronology | `0.7136` | — | — | — | — | `0/26` | `2/5` | Baseline Prompt 11 |
| Run 7 | Prompt 11 M0–M4 (honest ease, living hold, feel, soft-cut) | — | — | — | — | — | `0/26` | `1/5` | Transisi lebih mulus, otak S2 masih belum GrabCut bersih |
| Run 8 | Paket A+B (GrabCut cutout, multi-phase OCR, pixel shift, motion blur auto) | **`0.7204`** | `0.806` | `0.885` | `0.517` | **`0/36`** | `0/26` | `3/5` | Rekor 36-frame overall; S2 ter-rollback ke statis (`turntable=0`) |
| **Run 9** | **360° continuous `AM.drawTurntableObject` + 30fps signal hazards + rollback guard + Openverse fallback** | `0.6830` | `0.787` | `0.867` | `0.498` | `3/36` | **`0/26`** | **`1/5`** | **S1 (`0.679`) & S2 (`0.773`, `energyRatio=0.96`) rekor tertinggi; otak S2 bersih & berputar 360° penuh; semua 6 scene `0` hazard & `0` rollback.** |

## Skor Per-Scene Run 9 (`summary_run9.json`)

| Scene | Final Score | SSIM | Color | Edge | Runtime Errors | Hazards | Rollback |
|---|---:|---:|---:|---:|---:|---:|---|
| Scene 1 (`scene1_hook`) | `0.6787` | `0.7955` | `0.8973` | `0.5931` | `0` | `0` | `false` |
| Scene 2 (`scene2_problem_or_context`) | **`0.7733`** | `0.7757` | `0.9263` | `0.5947` | `0` | `0` | `false` |
| Scene 3 (`scene3_proof_or_demo`) | `0.7376` | `0.7513` | `0.9046` | `0.5028` | `0` | `0` | `false` |
| Scene 4 (`scene4_cta`) | `0.7269` | `0.8213` | `0.7933` | **`0.7870`** | `0` | `0` | `false` |
| Scene 5 (`scene5_beat_5`) | `0.6380` | `0.8067` | `0.8558` | `0.3561` | `0` | `0` | `false` |
| Scene 6 (`scene6_beat_6`) | `0.6656` | `0.8039` | `0.8546` | `0.4417` | `0` | `0` | `false` |

### Catatan Kejujuran Teknis (Run 9)
- **Scene 2** mencapai kualitas terbaik sepanjang seluruh pengujian: foto otak 3D bersih tanpa label/latar merah (`img/brain.png`), berputar kontinu 360° via `AM.drawTurntableObject`, seluruh kata memakai `AM.drawBlurRevealText`, dan rasio energi gerak `res/ref = 0.96`.
- **Scene 6** mencatat *false positive* minor dari detektor `turntable_3d` pada pop-in target panahan sehingga target datar ikut dibungkus `AM.drawTurntableObject` (sedikit melengkung secara sferis). Ini menjadi temuan bersih untuk penyempurnaan detektor `ref_motion_transitions.py` berikutnya.

## Baseline Motion Smoothness (`scripts/motion-smooth-report.py`, Run 11 vs Ref)

> **Catatan batasan alat ukur:** `motion-smooth-report.py` adalah proksi optical flow Farneback pada 360×640 (bukan ukuran rasa subjektif, tidak menghapus derau kompresi, tidak mengukur bentuk kurva kecepatan satu elemen atau kualitas blur).

| Scene | `fastShare` Ref (`p97 > 3px`) | `fastShare` Run 11 | `p97Ratio` (Run 11 / Ref) | `active` Ref | `active` Run 11 |
|---|---:|---:|---:|---:|---:|
| S1 | `0.52` | `0.30` | `0.70` | `0.158` | `0.096` |
| S2 | `0.29` | `0.20` | `1.17` | `0.174` | `0.159` |
| S3 | `0.61` | `0.05` | `0.34` | `0.105` | `0.064` |
| S4 | `0.07` | `0.05` | `0.98` | `0.025` | `0.018` |
| S5 | `1.00` | `0.08` | `0.17` | `0.113` | `0.152` |
| S6 | `0.32` | `0.19` | `0.84` | `0.081` | `0.058` |
| **Total `fastSeconds`** | **`6.61s`** | **`2.20s`** | — | — | — |

## Cara Reproduksi Evaluasi Offline

Wajib sertakan `--scene-cuts` (dari `cuts[]` hasil ekstraktor `style.json`, atau langsung berikan path `style.json`) agar evaluasi memecah seluruh 6 scene termasuk soft cut:

```bash
python scripts/compare-result-vs-ref.py benchmarks/pinterest-motion-remake/ref_pinterest.mp4 benchmarks/pinterest-motion-remake/remake_run11.mp4 --scene-cuts "2.502,6.206,9.543,13.513,15.682"
python scripts/motion-feel-report.py --scene-cuts "2.502,6.206,9.543,13.513,15.682" benchmarks/pinterest-motion-remake/ref_pinterest.mp4 benchmarks/pinterest-motion-remake/remake_run11.mp4
python scripts/motion-smooth-report.py --scene-cuts "2.502,6.206,9.543,13.513,15.682" benchmarks/pinterest-motion-remake/ref_pinterest.mp4 benchmarks/pinterest-motion-remake/remake_run11.mp4
```
