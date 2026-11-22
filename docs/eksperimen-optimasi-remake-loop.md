# Laporan Eksperimen & Optimasi Loop Remake Otomatis (`9router / AI-Agents`)

Dokumen ini merangkum seluruh hasil eksperimen A/B/C terkontrol serta loop iterasi optimasi (*Auto-Keep / Auto-Revert*) untuk menyamai kualitas craft remake manual ground-truth (`AG5`) pada engine Aetheria.

---

## 1. Papan Skor Lengkap (Ref `9:16` `@ngorzc` & Generalisasi `16:9` Showreel)

### A. Seri Acuan `ref_original.mp4` (Portrait `9:16`, 34.37s, 8 scene)

| Run / Arsitektur | Mode | Composite | Visual | Motion | SSIM | Color | Edge | Static% | Snappy% | Wall(s) | Keputusan |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `REF` (`ref_original.mp4`) | Ground truth video | **1.0000** | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 40.78% | 7.38% | — | Target |
| `AG5` (`antigravity-craft-remake-v5.mp4`) | Manual craft benchmark | **0.7239** | 0.6317 | 0.8622 | 0.6854 | 0.8716 | 0.2759 | 53.20% | 8.06% | — | Acuan Craft |
| `V1` | Engine lama (`prompt` awal) | 0.5447 | 0.6609 | 0.3705 | — | — | 0.2975 | 84.08% | — | — | Baseline |
| `V2` | Engine lama | 0.5314 | 0.6608 | 0.3372 | — | — | 0.2221 | 87.28% | — | — | Baseline |
| `V5` | Beat-strip + budget nudge | 0.5624 | 0.6473 | 0.4349 | — | — | 0.2062 | 83.40% | — | — | Baseline (regresi visual) |
| `V6` | Beat-strip + strict nudge | 0.5610 | 0.6288 | 0.4592 | — | — | 0.1629 | 79.42% | — | — | Reverted sebelum loop |
| `Exp A` (`exp_A_free_bash`) | Standard + `prompt_free_bash.txt` (13 baris) | **0.6311** | 0.6677 | **0.5762** | 0.8186 | 0.8822 | 0.2795 | 80.00% | 3.69% | 1080.5s | A/B Best Standard Awal |
| `Exp B` (`exp_B_composite_card`) | Standard + Composite Cards + `prompt_composite_clean.txt` | 0.6002 | **0.6820** | 0.4776 | **0.8297** | **0.9092** | 0.2646 | 81.17% | 3.79% | 1081.0s | Rekor Visual Awal |
| `Exp C` (`exp_C_direct_per_scene`) | Direct Per-Scene baseline (`script/scene1..8.js`) | 0.5538 | 0.5597 | 0.5450 | 0.6474 | 0.7522 | **0.3111** | 82.04% | 3.50% | 1265.6s | A/B Direct Baseline (Sc6 crash) |
| `Exp R1` (`exp_R1_direct_fix_bugs`) | Direct + Stack/Array/`PostWriteToolPhase` | 0.5684 | 0.6369 | 0.4657 | 0.7796 | 0.8448 | 0.2767 | 80.68% | 1.94% | 1502.4s (TO Sc6) | **KEEP** (`errs=0`, Sc1-6 patched) |
| `Exp R2` (`exp_R2_motion_and_optics`) | Direct + `ref_compare` motion delta + 34m | 0.5909 | 0.6677 | 0.4757 | 0.7895 | 0.8937 | 0.2995 | 78.16% | 1.75% | 2027.1s (8/8 OK) | **KEEP (Best Direct)** |
| `Exp R3` (`exp_R3_continuity_polish`) | Direct + `_card.jpg` Pass 1 | 0.5422 | 0.6001 | 0.4555 | 0.7591 | 0.8369 | 0.2038 | 77.38% | 1.84% | 2040.1s (TO Sc7) | **REVERT -> R2** |
| `Exp R4` (`exp_R4_standard_tuned`) | Standard + 14-beat `preview_capture` + prompt 50 baris | 0.5956 | 0.6642 | 0.4927 | 0.8126 | 0.8817 | 0.2365 | 79.13% | 2.62% | 1200.2s | Keep `preview_capture` 14-beat; reject prompt panjang |
| **`Exp R5` (`exp_R5_concise_hybrid`)** | **Standard + 14-beat + Composite Cards + `AM.ease.inBack` + prompt ringkas (~17 baris)** | **0.6611** | **0.6871** | **0.6220** | 0.8203 | 0.8788 | **0.3208** | **74.27%** | **5.24%** | 1202.0s | **KEEP & PROMOTE -> `default.txt`** |

### B. Uji Generalisasi Anti-Overfit `16:9` (Landscape `labs-showreel-remake.mp4`, 25.87s, tanpa `--prompt-override`)

| Run | Mode / Prompt | Composite | Visual | Motion | SSIM | Color | Edge | Static% | Snappy% | Wall(s) | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **`exp_GEN_showreel_16x9`** | Standard (`default.txt` final yang ter-embed) | **0.7844** | **0.7684** | **0.8084** | **0.8810** | **0.9352** | **0.4091** | 79.10% | **8.13%** | 1320.3s | **PASS — Non-overfit verified** |

---

## 2. Akar Masalah yang Ditemukan & Perbaikan yang Dipertahankan (*Kept Fixes*)

1. **Iterasi Engine Cepat (`Cargo.toml` & `context.rs`):**
   - Menonaktifkan debug symbol (`debug = 0` di `[profile.dev]` & `[profile.test]`) dan menambahkan `opt-level = 2` pada `[profile.test.package."*"]` memangkas waktu `npm run build:engine` dari ~8m 40s menjadi ~12–45s.
   - `context.rs` (`load_base_prompt_template`) mendukung override prompt debug tanpa recompile (`AETHERIA_PROMPT_OVERRIDE_PATH`).

2. **Menghapus Penyumbat Poles Dini (`runner.rs`):**
   - `SYSTEM BUDGET NOTE` kini dikendalikan oleh `AETHERIA_STRICT_BUDGET_NUDGE == "1"` (default `OFF`) agar model tidak dipaksa berhenti saat masih memoles detail visual & fisika.

3. **Composite Scene Cards HD + Strip Multi-Beat (`ref_extractor.py`, `ref_extractor.rs`, `preview_film.rs`, `preview_capture.rs`):**
   - `build_scene_composite_card` menghasilkan `ref_scene_XX_card.jpg` (kiri `540x968` Hero HD untuk portrait atau atas `960x540` untuk landscape + 6 subframe progresi sub-beat), menghindari hilangnya ketajaman tipografi & gradien pada thumbnail strip kecil.
   - `preview_capture.rs` (`resolve_default_preview_timestamps`) kini otomatis memilih hingga **14 timestamp multi-beat (`q1`/`mid`/`q3`)** ketika `capture_film_preview({})` dipanggil tanpa `timestamps` pada proyek yang memiliki referensi, sementara `preview_film.rs` (`build_visual_ref_vs_preview_strip`) otomatis melampirkan strip visual `REF vs PREVIEW vs DIFF`. Pada `Exp R4`/`R5`, ini langsung menutup blind-spot morph (`2.79s`, `4.10s`, `30.77s`).

4. **Isolasi Canvas State & Primitif `window.AM` (`film_scaffold.rs`, `aetheria-motion.js`, `AM_API.md`):**
   - Menambahkan dukungan array radius `[tl, tr, br, bl]` pada `AM.roundRect`, serta ekspor resmi `AM.fillRoundRect`, `AM.strokeRoundRect`, dan `AM.ease.inBack` (`TypeError: ease.inBack is not a function` ditemukan di `Exp R4`).
   - `film_scaffold.rs` membungkus setiap render scene dalam `window.renderAt` dengan counter `__saveDepth` + blok `finally` (`while (__saveDepth > __baseDepth) ctx.restore()` + reset transform/alpha/filter/shadow), mencegah kebocoran stack transform saat salah satu scene melempar error runtime (akar masalah blank-hitam Scene 6–8 pada `Exp C`).

5. **Perbaikan State Machine Direct Mode & Cek Delta Gerak (`direct_scene_remake.rs`, `direct_scene_prompt.rs`, `ref_compare.py`):**
   - Menambahkan `PostWriteToolPhase` (`VerifyDirtyScriptNow`, `FixRuntimeErrorsNow`, `ApplyPolishOrFinish`) untuk memutus pola loop `bash` tanpa edit pasca-render (`Exp C -> Exp R1/R2`: menaikkan Direct Mode dari `0.5538` ke `0.5909` dengan seluruh 8/8 scene bebas error).
   - `ref_compare.py` menghitung `meanAdjacentFrameDelta` & `refMeanAdjacentFrameDelta` dan memicu `MOTION ACTIVITY WARNING` di `direct_scene_prompt.rs` bila frame nyaris statis.
   - Sebaliknya, **Round 3 (`Exp R3`)** yang memasukkan gambar `_card.jpg` besar ke Pass 1 Direct Mode menambah latensi inferensi sehingga Scene 8 timeout -> **di-revert** bersih kembali ke `R2`.

6. **Kemenangan Prompt Ringkas Berkepercayaan Penuh (`Exp R5` -> `default.txt`):**
   - **Exp R4** membuktikan prompt prosedural panjang (50 baris) memicu pembengkakan konteks (~306k token) dan 24 panggilan `read` berulang (`0.5956`), sedangkan **Exp R5 (`prompt_concise_hybrid.txt` / `default.txt`, ~17 baris)** menggabungkan kebebasan alat `Exp A` (`bash` + Python pengukuran + `inspect_ref_frame`) dengan Composite Scene Cards, 14-beat visual diff, `window.AM` helpers, dan aturan gerak kontinyu -> mencetak rekor **`composite=0.6611` (`visual=0.6871`, `motion=0.6220`, `meanEdge=0.3208`, `snappyBurstPct=5.24%`)** serta skor generalisasi `16:9` **`composite=0.7844` (`visual=0.7684`, `motion=0.8084`, `meanEdge=0.4091`)**.

---

## 3. Tautan Artefak Visual & MP4 Terverifikasi

- Ground truth manual `AG5`: [antigravity-craft-remake-v5.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/antigravity-remake-6jPMJ8cpG/antigravity-craft-remake-v5.mp4)
- **Exp A** (`0.6311`): [exp_A_free_bash.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_A_free_bash/exp_A_free_bash.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_A_free_bash/compare_strip.jpg)
- **Exp B** (`0.6002` / visual `0.6820`): [exp_B_composite_card.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_B_composite_card/exp_B_composite_card.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_B_composite_card/compare_strip.jpg)
- **Exp C** (`0.5538`): [exp_C_direct_per_scene.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_C_direct_per_scene/exp_C_direct_per_scene.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_C_direct_per_scene/compare_strip.jpg)
- **Exp R1** (`0.5684` kept): [exp_R1_direct_fix_bugs.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R1_direct_fix_bugs/exp_R1_direct_fix_bugs.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R1_direct_fix_bugs/compare_strip.jpg)
- **Exp R2** (`0.5909` kept best Direct): [exp_R2_motion_and_optics.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R2_motion_and_optics/exp_R2_motion_and_optics.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R2_motion_and_optics/compare_strip.jpg)
- **Exp R3** (`0.5422` reverted): [exp_R3_continuity_polish.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R3_continuity_polish/exp_R3_continuity_polish.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R3_continuity_polish/compare_strip.jpg)
- **Exp R4** (`0.5956`): [exp_R4_standard_tuned.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R4_standard_tuned/exp_R4_standard_tuned.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R4_standard_tuned/compare_strip.jpg)
- **Exp R5** (**`0.6611` rekor otomatis 9:16**): [exp_R5_concise_hybrid.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R5_concise_hybrid/exp_R5_concise_hybrid.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R5_concise_hybrid/compare_strip.jpg) · [comparison_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_R5_concise_hybrid/previews/comparison_strip.jpg)
- **Exp GEN `16:9`** (**`0.7844` generalisasi tanpa override**): [exp_GEN_showreel_16x9.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_GEN_showreel_16x9/exp_GEN_showreel_16x9.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_GEN_showreel_16x9/compare_strip.jpg) · [comparison_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_GEN_showreel_16x9/previews/comparison_strip.jpg)
