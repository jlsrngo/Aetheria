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

---

## 4. Fase 2 — Tuning Mesin Referensi, Filmstrip 1/1 Deterministik, & Matriks A/B (`Opsi A` vs `Opsi B`, `raw` vs `smart`)

Meskipun `Exp R5` mencatat `compositeScore = 0.6611`, inspeksi visual rapat menunjukkan gerakannya masih kaku dibanding acuan manual `AG5` (`medianDelta = 0.092`, `nearZero<0.08 = 47.1%` vs `REF` `medianDelta = 0.779`, `nearZero = 5.7%` dan `AG5` `medianDelta = 0.408`, `nearZero = 22.6%`). Masalahnya terbelah di dua sisi: deteksi cut/hero/beat di `core/ref_extractor/` melewatkan transisi gelap dan pengambilan sampel jarang membuat LLM tidak melihat kurva kecepatan frame-ke-frame.

### A. Perbaikan Offline Mesin Referensi (`core/ref_extractor/`)

1. **Deteksi Cut Transisi Gelap (`ref_temporal_cuts.py`):** Menambahkan heuristik `is_dark_layout_shift` (`eo < 0.14 && fg_iou < 0.14 && wd > 0.020`) dan batas `max_total_cuts` berbasis durasi (`8..16`), memisahkan `ref_original.mp4` secara akurat dari **8 → 13 scene** (memisahkan *Connected*, *Thought in motion*, dan *Logo*) sambil mempertahankan tepat **8 scene** pada video `16:9` `labs-showreel-remake.mp4`.
2. **Pemilihan Hero Settled & Pemisahan Margin Beat (`ref_extractor.py`, `ref_beat_strip.py`):** `select_best_hero_frame` memilih frame paling informatif di tengah scene (bukan frame hitam awal transisi), sementara `cam_min_gap_f = 45ms` + `motion_margin_f` mencegah titik `motion-peak` menumpuk pada `scene-start`/`scene-end`.
3. **Mesin Ekstrak Filmstrip 1/1 Deterministik (`ref_filmstrip.py`, `ref_filmstrip.rs`):** Membaca video sekali jalan secara berurutan (tanpa acak), mengemas **10 frame/lembar** (`5×2` portrait `1200×852` atau `2×5` landscape `768×1080`, selalu `≤ 1280px` sisi terpanjang) berlabel `fNNNN t.tts dX.X`, disertai `filmstrip_index.json` (profil gerak per scene: `meanDelta`, `medianDelta`, `staticPct`, `nearZeroPct`, `activeBursts`). Mendukung dua mode:
   - `raw` (murni 1/1: 104 lembar untuk 1.031 frame `ref_original.mp4`, irama tetap `0.033s/tile`),
   - `smart` (melipat run frame kembar identik menjadi tag `[HOLD]` — 94 lembar).
4. **Verifikasi Strip Gerak 2-Baris (`ref_frame_probe.py`, `ref_probe.rs`, `preview_film.rs`, `direct_scene_tools.rs`):** `motion-compare-strip` menyandingkan 8 frame `REF` vs `RND` dengan delta langkah antar frame dan memunculkan `MOTION FROZEN WARNING` bila render membeku ketika referensi bergerak.

### B. Papan Skor Matriks A/B Fase 2 (`9:16` Acuan & `16:9` Anti-Overfit)

| Run / Arsitektur | Cakupan | Mode / Strip | Composite | Visual | Motion | Edge | `meanΔ` | `medΔ` | `p90Δ` | `<0.08%` | Wall(s) | Temuan Kunci |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `REF` (`ref_original.mp4`) | 9:16 (13 sc, 1031f) | Ground truth | **1.0000** | 1.0000 | 1.0000 | 1.0000 | **2.356** | **0.779** | **4.043** | **5.7%** | — | Acuan target |
| `AG5` (`craft-remake-v5.mp4`) | 9:16 (1031f) | Manual craft | **0.7239** | 0.6317 | **0.8622** | 0.2759 | **2.080** | **0.408** | 3.304 | **22.6%** | — | Acuan craft manual |
| `Exp R5` (`exp_R5_concise_hybrid`) | 9:16 (8 sc) | Standard baseline lama | 0.6611 | **0.6871** | 0.6220 | 0.3208 | 1.432 | 0.092 | 2.313 | 47.1% | 1202.0s | Cepat diam pada morph & orbit |
| `Exp F1` (`exp_F1_opsi_b_smart`) | 9:16 | Opsi B naive `smart` | — | — | — | — | — | — | — | — | 1320.4s (TO) | Gagal (0 HTML): prune agresif rusak KV cache |
| `Exp F1v2_smart` (`exp_F1v2_opsi_b_smart`) | 9:16 (13 sc) | Opsi B fixed `smart` | 0.5796 | 0.6521 | 0.4707 | 0.1877 | 1.148 | 0.103 | 1.190 | 43.7% | 1440.6s | 13 scene lengkap, tapi LLM 0× panggil `read_filmstrip` |
| `Exp F3_probe4_smart` | Sc 1–4 (220f) | Opsi A v1 (`probe=0,max=4`, `smart`) | 0.3614 | 0.4327 | 0.2545 | 0.1626 | 0.657* | 0.123* | 0.414* | 12.8%* | 798.9s | Sc 2–3 cair, Sc 1 & 4 ditulis sebagai placeholder |
| `Exp F3_probe4_v2_smart` | Sc 1–4 (220f) | Opsi A v2 (`probe=1,max=5`, anti-stub, `smart`) | 0.3783 | 0.4525 | 0.2669 | 0.1814 | 2.491† | 0.382† | 4.063† | 32.3%† | 1082.0s | 0 stub; Sc 1 `medΔ=0.442` |
| **`Exp F2_probe4_raw`** | Sc 1–4 (220f) | Opsi A v2 (`probe=1,max=5`, **`raw` 1/1**) | 0.4537 | 0.4742 | 0.4231 | 0.2200 | **3.550†** | **0.538†** | **7.142†** | **21.4%†** | **1018.2s** | **Menang telak atas `smart`**: lebih cepat 64s; Sc 1 `medΔ=2.193` (5× `smart`), blur rotasi & bintang 3D |
| **`Exp F3_full13_winner`** | **9:16 (13 sc penuh)** | **Opsi A Auto-Scaffold Paralel 3-Scene (`raw`, `auto`)** | **0.7174** | **0.6849** | **0.7662** | **0.3592** | **1.707** | 0.112 | **3.360** | 37.7% | 1426.5s | Mendekati `AG5` (bahkan unggul visual di *Form*, *Create rhythm*, *Logo*), kecuali `scene12.js` kena bug rollback stub |
| **`Exp GEN2_16x9`** | **16:9 (8 sc, 776f)** | **Default Produksi (`--remake-mode auto`, tanpa override)** | **0.7870** | 0.7470 | **0.8470** | 0.3824 | 1.591 | 0.043‡ | 2.985 | 56.0%‡ | **913.6s** | **8/8 scene terisi penuh (0 stub)**, bento/laptop/word-stack/logo akurat |

\* `Exp F3_probe4_*` diukur pada video 1031 frame penuh (Scene 5–13 masih diam) untuk kolom full, sedangkan angka bertanda `†` (`F3_probe4_v2_smart` & `F2_probe4_raw`) diukur khusus pada window aktif **Scenes 1–4 (220 frame pertama)** terhadap `REF` (`meanΔ=5.115, medΔ=1.588`) & `AG5` (`meanΔ=4.733, medΔ=0.682`).
‡ Pada acuan `16:9` `labs-showreel-remake.mp4` (`776f`), `REF` sendiri memiliki segmen hold teks (`meanΔ=1.908, medΔ=0.128, <0.08=42.6%`); skor `0.7870` (`motionScore=0.8470`) mengungguli baseline `exp_GEN_showreel_16x9` (`0.7844`, `motionScore=0.8084`) dan selesai ~407 detik lebih cepat berkat paralelisme 3 scene.

### C. Kesimpulan Keputusan & Perbaikan Pasca-Temuan

1. **Mengapa `Opsi A + raw 1/1` ditetapkan sebagai default produksi:**
   - **Pure `1/1 (raw)` mengalahkan `smart`:** Irama seragam `0.033s/tile` membuat model langsung menangkap kecepatan sesungguhnya tanpa harus menghitung `[HOLD]` secara mental — di Scenes 1–4 (`Exp F2_probe4_raw`), `meanΔ` naik `2.491 → 3.550`, `medΔ` naik `0.382 → 0.538`, Scene 1 naik 5× lipat (`0.442 → 2.193`), dan waktu jalan **64 detik lebih cepat**.
   - **Auto-Scaffold + Direct Parallel 3-Scene (`Opsi A`) mengalahkan Standard Mode (`Opsi B`):** Dalam Standard Mode (`Exp F1v2`), LLM berulang kali mengabaikan instruksi pemanggilan `read_filmstrip` (`0×` dipanggil vs `11× inspect_ref_frame`) dan terhambat KV-cache thrashing di batas 16 gambar. Dengan auto-scaffold deterministik di `runner.rs` (`step >= 1` saat `filmstrip_index.json` berdurasi multi-scene ada) serta eksekusi paralel `Semaphore(3)` + `render_lock`, seluruh 13 scene 9:16 selesai dengan `0` rate-limit dalam `23.8m` dan seluruh 8 scene 16:9 selesai dalam `15.2m`.
   - **Tool `Opsi B` tetap dipertahankan:** `read_filmstrip`, sliding-window pruning cache-safe (`history.rs`), dan `capture_film_preview({ motionStrip })` tetap aktif untuk proyek single-scene maupun mode `stageMode: "hybrid"`.
2. **Perbaikan Bug `scene12.js` Stub Rollback & Promosi Default:**
   - Investigasi `Exp F3_full13_winner` menemukan `scene12.js` kembali menjadi stub `670 B` tepat pada render akhir bukan karena LLM gagal menulis, melainkan karena `fidelity_guard.rs` (`reconcile_per_scene_snapshots_and_rollback`) menyalin stub saat scene lain lebih dulu dirender lalu me-rollback `scene12.js` kembali ke stub ketika render pertama Scene 12 mencatat error runtime.
   - **Fix yang diterapkan:** `fidelity_guard.rs` dilarang men-snapshot atau me-rollback isi `is_scaffold_stub_content`, `!runtime_errors_empty` dibatasi hanya ke scene yang dievaluasi pada perbandingan tersebut, `PreviewCaptureOptions.disable_auto_rollback` mematikan guard global saat `direct_scene_remake` memakai checkpoint per-scene miliknya sendiri, `should_restore_best_checkpoint` menolak me-restore stub, dan `direct_scene_remake.rs` mempromosikan `probe_steps=1`, `cross_context=summary`, `concurrency=3`, serta `max_steps=6` (≥ 8 scene) sebagai default saat 1/1 filmstrip aktif. Hasilnya langsung terverifikasi pada **`Exp GEN2_16x9`** dengan **8/8 scene terisi utuh dan 0 stub**.
3. **Tuning Build Dev Rust (`Cargo.toml`, `.cargo/config.toml`):** Mengaktifkan `codegen-units = 16` pada profil `[profile.dev]` & `[profile.test]` serta `jobs = 2` (diikuti pembersihan `11,5 GB` cache `target/debug/incremental` lama + pengecualian Windows Defender) memangkas build dev incremental `npm run build:engine` kembali ke ~65 detik pada mesin RAM 12 GB tanpa menyentuh konfigurasi `[profile.release]`.

### D. Tautan Artefak Visual & MP4 Fase 2

- **Exp F1v2 (`Opsi B fixed smart`):** [exp_F1v2_opsi_b_smart.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F1v2_opsi_b_smart/exp_F1v2_opsi_b_smart.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F1v2_opsi_b_smart/compare_strip.jpg)
- **Exp F2 Sc1–4 (`Opsi A raw 1/1`):** [exp_F2_probe4_raw.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F2_probe4_raw/exp_F2_probe4_raw.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F2_probe4_raw/compare_strip.jpg)
- **Exp F3 Full 13 Winner (`Opsi A Paralel 3-Scene raw 1/1`, `0.7174`):** [exp_F3_full13_winner.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F3_full13_winner/exp_F3_full13_winner.mp4) · [strip_scene1_dense.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F3_full13_winner/eval/strip_scene1_dense.jpg) · [strip_scene2_dense.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F3_full13_winner/eval/strip_scene2_dense.jpg) · [strip_10scenes.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_F3_full13_winner/eval/strip_10scenes.jpg)
- **Exp GEN2 `16:9` Anti-Overfit (Default Produksi, `0.7870`, 8/8 scene):** [exp_GEN2_16x9.mp4](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_GEN2_16x9/exp_GEN2_16x9.mp4) · [compare_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_GEN2_16x9/compare_strip.jpg) · [comparison_strip.jpg](file:///C:/Users/Asus/.gemini/antigravity/brain/7321be9c-6cd2-47ff-90b1-f94fe9cc1067/experiments/exp_GEN2_16x9/previews/comparison_strip.jpg)
