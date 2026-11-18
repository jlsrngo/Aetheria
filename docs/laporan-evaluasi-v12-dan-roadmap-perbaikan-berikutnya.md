# Laporan Evaluasi `v12-flash` & Roadmap Perbaikan Berikutnya (`v13`)

Dokumen ini merangkum hasil implementasi **Fase A (Dense Motion Clues)**, **Fase B (Structural Fidelity Gate)**, dan **Fase C (Sequential Batch & Scoped Preview Orchestration)** pada run live `v12-flash` (`local-cli/gemini-3.8-flash-high`), membandingkannya secara apel-ke-apel terhadap `v11-flash` dan acuan kebenaran manual [`benchmarks/labs-showreel-ground-truth/labs-showreel-remake.mp4`](../benchmarks/labs-showreel-ground-truth/labs-showreel-remake.mp4), serta merinci daftar perbaikan tahap berikutnya (`v13`).

---

## 1. Ringkasan Perubahan Arsitektur di `v12` (Fase A–C)

1. **Fase B — Structural Fidelity Gate ([`core/ref_extractor/ref_structural_compare.py`](../core/ref_extractor/ref_structural_compare.py), [`ref_compare.py`](../core/ref_extractor/ref_compare.py), [`fidelity_guard.rs`](../core/aetheria-engine/src/studio/fidelity_guard.rs)):**
   - **B1 (`fgBboxIou`, `fgScaleRatio`, `stackedRowMismatch`):** Mengukur IoU kotak pembatas objek aktif (`[x, y, w, h]` pada koordinat `1024×576`) serta jumlah pita horizontal (mendeteksi kesalahan menumpuk baris ikon di atas teks utama).
   - **B2 (`containerSpillDetected`):** Mendeteksi elemen preview yang bocor keluar dari wadah referensi (bezel laptop atau kartu).
   - **B3 (`clippedTextDetected`, `textDriftDetected`, `extraTextDetected`):** Menjalankan RapidOCR ber-cache (`.ocr_cache.json`) pada timestamp yang sama untuk menangkap teks terpotong di tepi wadah (`'Movement' -> 'ement'`), pergeseran sub-beat kata (`Thinking/Finding/Building` vs `Finding/Building/Creating`), atau subjudul tambahan yang tidak ada di referensi.
2. **Fase A — Dense Motion Clues ([`core/ref_extractor/ref_motion_clues.py`](../core/ref_extractor/ref_motion_clues.py), [`ref_extractor.py`](../core/ref_extractor/ref_extractor.py)):**
   - **A1 (`denseTimeline`):** Sampling 8 titik per scene (`0.05..0.95` durasi scene) dengan bbox aktif dan kata OCR per timestamp.
   - **A2 (`saturatedAccents`):** Mengekstrak elemen aksen kecil berkroma tinggi (`HSV S >= 90, V >= 85`) beserta hex, kotak piksel, dan timestamp yang sebelumnya hilang oleh klasterisasi palet berbasis luas area.
   - **A3 (`objectTrajectory`):** Melacak perpindahan bbox/pusat objek utama antar-waktu.
   - **A4 (`containerClip`):** Mendeteksi `outerBezel` dan `innerClipRect` beserta instruksi `ctx.clip()`.
   - **A5 (`kineticClues`):** Mendeteksi pita marquee horizontal lebar (`fontSize` besar) dan slot-reel vertikal 3-sel.
3. **Fase C — Orkestrasi Sekuensial & Scoped Preview ([`tool_batch.rs`](../core/aetheria-engine/src/session/agent_turn/tool_batch.rs), [`subagent_tool_batch.rs`](../core/aetheria-engine/src/session/agent_turn/subagent_tool_batch.rs), [`preview_film.rs`](../core/aetheria-engine/src/tool/preview_film.rs), [`reference_compare.rs`](../core/aetheria-engine/src/studio/reference_compare.rs), [`preview_capture.rs`](../core/aetheria-engine/src/studio/preview_capture.rs)):**
   - Menjalankan beberapa pemanggilan `task` dalam satu giliran Director secara **sekuensial** (tidak lagi tabrakan paralel via `join_all`).
   - Mengunci `capture_film_preview` otomatis ke timestamp `q1/mid/q3` milik scene yang sedang didelegasikan (`targetSceneIndices`) saat subagent mengerjakan subset `1..=3` scene, serta memisahkan histori skor (`project_key#ts_scope_sig`) dan memutar prioritas polish maksimal 2x per scene pada evaluasi film penuh (`SCENE_POLISH_ATTEMPTS`).

---

## 2. Evaluasi Kuantitatif & Visual (`v11-flash` vs `v12-flash` vs `Manual Remake`)

Seluruh angka di bawah diukur menggunakan evaluator struktural 19-frame terbaru (`ref_compare.py` + `ref_structural_compare.py`):

| Metrik (19-Frame Dense) | `v11-flash` | **`v12-flash`** | Selisih (`v12 - v11`) | Baseline `labs-showreel-remake` |
|---|---:|---:|---:|---:|
| **`overallFidelity`** | `0.5829` | **`0.6134`** | **`+0.0305`** | `0.7416` |
| **`ssimMean`** | `0.7497` | **`0.7675`** | **`+0.0178`** | `0.8066` |
| **`edgeMatchMean`** | `0.2850` | **`0.3077`** | **`+0.0227`** | `0.5294` |
| **`colorMatchMean`** | `0.8728` | `0.8461` | `-0.0267` | `0.9103` |
| **Blank / Crashed Frames** | `0` | **`0`** | `0` | `0` |
| **Status Sesi Live** | `timedOut: true` (601.7s) | **`timedOut: false` (959.4s)** | Selesai bersih | — |

### Perbandingan Skor Per Titik Waktu & Bukti Visual

| Titik Uji (`t`) | Scene / Fase | `v11-flash` | **`v12-flash`** | Manual Remake | Bukti Perubahan Visual di `v12-flash` |
|---:|---|---:|---:|---:|---|
| `1.50s` | `s1_morph` | `0.6810` | **`0.7761`** | `0.8344` | **Berhasil menghapus baris ikon `S L ● ‖` yang bertumpuk di atas teks**; teks kembali ke satu baseline segaris (`y=233`). *Gap tersisa:* agen menyalin string OCR `"Showrea"` secara harfiah dan belum me-morph huruf `e-e-l` menjadi bentuk warna-warni di `1.50s`. |
| `4.38s` | `scene2_problem_or_context` | `0.6917` | `0.6678` | `0.7267` | Ubin terang memiliki ikon vektor bersih (3x3 dots, orbit, segitiga, bintang, bulan sabit, `L`, badge `Labs`), namun beberapa ubin gelap (`darkTile`) dibiarkan kosong tanpa ikon putih. |
| `6.13s` | `scene3_proof_or_demo` | `0.5877` | **`0.6480`** | `0.6698` | Skor naik karena luas warna terang, tetapi secara visual kartu putih melebar memenuhi layar pada pass refine terakhir (lihat Temuan #1 di bawah). |
| `6.80s` | `s4_3d_cursor` | `0.4320` | **`0.4748`** | `0.5820` | Panah 3D ungu tampil dengan glow dan mulai bergerak/berubah ukuran menuju `7.25s`. |
| `7.25s` | `scene4_cta` | `0.5800` | **`0.6746`** | `0.6010` | **Panah 3D kini menyusut & melipat ke paruh bawah layar** (tidak lagi statis raksasa di tengah seperti `v11`). |
| `8.20s` | `s5_marquee` | `0.5810` | `0.4468` | `0.7730` | **Ukuran huruf marquee horizontal berhasil diperbesar drastis** (`signing Workflow Anima` + kursor ungu, tidak lagi mikroskopis 22px seperti `v11`), namun penalti OCR memotong skor karena kata `"Motion"` sudah bergulir keluar di `t=8.20s`. |
| `10.60s` | `s5_info_motion` | `0.5420` | **`0.6743`** | `0.8515` | Teks `"Information to Motion"` terpusat rapi, namun slot-reel vertikal 3-ikon terhapus saat pass refine massal terakhir. |
| `15.50s` | `s6_purple_design` | `0.3040` | **`0.5616`** | `0.6535` | **Lonjakan terbesar (`+0.2576`):** layar ungu ripple konsentris, teks `"Movement"`, `"Transitions"`, dan serif italic `"Design"` kini **100% ter-clip rapi di dalam bezel laptop** tanpa bocor keluar (`containerSpill = false`) dan tanpa teks terpotong (`clippedText = false`). |
| `18.00s` | `scene7_beat_7` | `0.6640` | `0.6276` | `0.8445` | Timing kata atas (`Thinking`) dan bawah (`Building`) sudah tepat pada `t=18.00s` (tidak lagi bergeser ke `Creating`), tetapi kata aktif tengah (`Finding`) tidak tergambar akibat regresi pada pass refine massal terakhir. |
| `22.93s` | `scene8_beat_8` | `0.6330` | **`0.7701`** | `0.8620` | Logo `L` miring + beruang pixel cokelat + `"Labs Studio"` tampil jauh lebih bersih (teks tambahan di bawah diperkecil drastis). |

---

## 3. Akar Masalah yang Tersisa & Roadmap Perbaikan Berikutnya (`v13`)

Berdasarkan forensik log dan visual `v12-flash`, ada **4 akar masalah spesifik** yang perlu diselesaikan pada iterasi berikutnya (`v13`) untuk mencapai target minimal setara remake manual di seluruh 8 scene:

### 3.1. Perbaikan #1 — Guard Rollback Otomatis Per-Scene & Larangan Polish Massal `> 2` Scene (`subagent.rs` & `preview_capture.rs`)
- **Bukti di `v12-flash`:** Setelah keempat batch awal selesai, Director memanggil satu subagent terakhir dengan tugas *"Refine scene 3, 4, 5, 6, 7 scripts to fix fidelity score (>0.65)"* (5 scene sekaligus). Karena `target_scenes.len() == 5 > 3`, `is_focused_scene_subset` menjadi `false`, dan subagent memodifikasi 5 file sekaligus dalam satu giliran — yang justru merusak kartu Scene 3, menghapus slot-reel Scene 5 (`10.60s`), dan menghilangkan kata tengah `"Finding"` di Scene 7 (`18.00s`).
- **Tindakan `v13`:**
  1. Batasi delegasi `motion-designer` maksimal **2 scene per pemanggilan `task`** (tolak atau potong otomatis jika Director menyebut `> 2` scene dalam satu `task`).
  2. Simpan snapshot konten `script/sceneK.js` yang memiliki skor `sceneScores[sceneId].overallMean` tertinggi; bila pass refine menurunkan `sceneScores[sceneId].overallMean` sebesar `> 0.015`, **otomatis rollback file `sceneK.js` tersebut** ke versi terbaik sebelumnya.

### 3.2. Perbaikan #2 — Deteksi Kontur Kartu Tengah vs Latar Terang di `ref_motion_clues.py` (Khusus Scene 3 & Marquee Scene 5)
- **Bukti di `v12-flash`:** Pada Scene 3 (`5.60s..6.67s`), latar belakang adalah carousel ubin terang yang di-blur (`#E0D6D9`). Karena seluruh frame terang dan berbeda dari piksel sudut tertentu, `_foreground_box_and_mask` mencatat `5.68s:[14,13,980x552]` di `Dense 6-Slice Timeline`. Subagent refine mengira kartu putih utama harus berukuran `980×552` (memenuhi layar), bukan kartu vertikal `312×506` di tengah layar.
- **Tindakan `v13`:**
  1. Pada `ref_motion_clues.py`, bila `area_frac > 0.72` (latar penuh), jalankan detektor kontur kartu internal (`Canny + approxPolyDP` di area tengah `x = 0.2..0.8 W`) untuk melaporkan `heroCardBox: [356, 34, 312, 506]` secara eksplisit terpisah dari `blurredBackdrop: full-bleed 3-card carousel`.
  2. Pada `ref_structural_compare.py`, untuk frame bertipe `marquee` (teks bergulir horizontal seperti Scene 5 `8.20s`), cocokkan keberadaan **minimal satu** token marquee (`Motion` / `Designing` / `Workflow`) dengan tinggi huruf yang sesuai (`h >= 48px`) agar kecepatan gulir sedikit berbeda tidak dihukum sebagai `textDriftDetected`.

### 3.3. Perbaikan #3 — Koreksi String OCR Terpotong Morph & Ekstraksi Slot Huruf Berwarna (Scene 1)
- **Bukti di `v12-flash`:** Karena huruf `e-e-l` di ujung `"Showreel"` sedang bermorph menjadi bentuk geometris berwarna, RapidOCR membaca `"Showrea"` atau `"Shosea"`. Agen di `v12-flash` mematuhi posisi baseline `y=233`, tetapi menggambar teks statis `"Showrea"` berwarna abu-abu tanpa bentuk morph ungu/hijau/pink di sebelah kanan `"Showre"`.
- **Tindakan `v13`:**
  1. Di `ref_extractor.py` & `ref_motion_clues.py`, deteksi saat sebuah kata hero berdampingan langsung di sebelah kanannya pada baseline `y` yang sama dengan `saturatedAccents` (`#884BF9`, `#3EF5B6`, `#F0721F`, `#365BBA`), lalu tandai secara eksplisit sebagai:
     `INLINE GLYPH MORPH: prefix="Showre" + 3 morphing colored vector glyphs at x=540..780 on baseline y=235..345 resolving into full word "Showreel" (NEVER render literal truncated OCR string "Showrea"/"Shosea")`.

### 3.4. Perbaikan #4 — Deteksi Sel Ubin Kosong (`emptyTileCells`) pada Dinding Ubin (Scene 2)
- **Bukti di `v12-flash`:** Di Scene 2 (`4.38s`), agen menggambar ikon hitam di dalam ubin terang (`lightTile`), tetapi membiarkan beberapa ubin gelap (`darkTile`) kosong tanpa ikon putih.
- **Tindakan `v13`:**
  1. Pada `measure_contrast_tile_grid` (`ref_extractor.py`) dan `ref_structural_compare.py`, ukur kepadatan kontras/tepi di bagian tengah setiap sel `(r, c)` (`margin 22%`). Bila di referensi sel `(r, c)` memiliki ikon di tengahnya namun di preview sel tersebut polos (`std < 6.0`), laporkan koordinat sel yang kosong (`EMPTY BENTO CELLS at (row=1,col=1), (row=1,col=3) — draw white stroke/fill vector icons inside dark tiles too`).
