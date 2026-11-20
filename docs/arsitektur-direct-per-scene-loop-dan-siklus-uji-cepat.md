# Arsitektur `Direct Per-Scene Loop` (Vision-First) & SOP Siklus Uji Cepat (~30 Detik)

Dokumen ini menjelaskan **mengapa** pendekatan orkestrasi multi-agen + laporan OCR/bbox OpenCV selama `v7..v12` membutuhkan waktu lama (~16 menit runtime agen, ~25 menit per siklus eksperimen) namun hasilnya belum menyamai [`labs-showreel-remake.mp4`](../benchmarks/labs-showreel-ground-truth/labs-showreel-remake.mp4), serta **bagaimana cara kerja pembuatan remake manual ditanam langsung ke dalam engine Aetheria** agar selesai dalam **~2,5–3 menit** dengan siklus uji pengembangan **~30 detik per scene**.

---

## 1. Perbandingan: Mengapa Cara Manual Berhasil Langsung, Sedangkan Agen `v7..v12` Lambat & Meleset?

| Aspek | Cara Kerja Remake Manual (`labs-showreel-remake.mp4`) | Cara Kerja Agen Saat Ini (`v7..v12`) | Dampak di `v7..v12` |
|---|---|---|---|
| **Sumber Kebenaran Visual** | **Murni gambar strip frame per scene** (`early -> mid -> late`) + data pasti (waktu cut, resolusi `1024×576`, `114.5 BPM`, warna latar `cleanPlate`). **Tidak membaca teks OCR/bbox OpenCV.** | Gambar frame **dicampur** ratusan baris teks tebakan OCR (`"Showrea"`, `"Shosea"`, `"Ertem"`) dan bbox kontur OpenCV (`980×552`). | Model seperti Gemini Flash lebih patuh pada teks prompt daripada gambar. Jika OCR salah baca `"Showrea"` atau bbox salah ukur `980×552`, agen langsung menggambar teks/ukuran yang salah. |
| **Alur Pengerjaan per Scene** | **2 langkah pasti per scene:** (1) Lihat strip frame Scene `K` → tulis `sceneK.js`; (2) Render frame Scene `K` → sandingkan gambar Referensi vs Hasil → koreksi 1x. | **~80–100 langkah bebas:** `Director` → `4x Subagent` → `capture_film_preview` berulang → `QA Verifier` → `Subagent Refine 5 scene sekaligus`. | Waktu habis di obrolan antar-agen (10–16 menit), dan pass refine massal di akhir sering merusak scene yang tadinya sudah bagus (mis. Scene 3 & Scene 7 di `v12`). |
| **Siklus Browser Preview** | Tab browser tetap terbuka, hanya panggil `window.renderAt(t)` (< 0,2 detik per frame). | Setiap `capture_film_preview` menyalakan proses headless Edge/Chrome baru dari nol + server HTTP baru (~6–8 detik per panggil). | 10–12 kali preview membuang ~75–90 detik hanya untuk buka-tutup browser. |
| **Siklus Uji Pengembangan** | Uji & koreksi **1 scene** yang sedang dikerjakan (~20–30 detik) sampai mirip, baru lanjut ke scene berikutnya. | Setiap ubah 1 aturan → `npm run build` Vite (4,5 menit) + `cargo test --workspace` + `build:engine` (7 menit) + live E2E 8 scene penuh (15 menit) = **~25 menit**. | Eksperimen menjadi sangat lambat dan sulit melacak efek perubahan pada 1 scene tertentu. |

---

## 2. Bedah Lengkap: Bagaimana Remake Manual (`labs-showreel-remake.mp4`) Dibuat dari Nol?

Bagian ini mendokumentasikan secara rinci proses pembuatan [`benchmarks/labs-showreel-ground-truth/labs-showreel-remake.mp4`](../benchmarks/labs-showreel-ground-truth/labs-showreel-remake.mp4) beserta kode [`benchmarks/labs-showreel-ground-truth/script/scene1.js`](../benchmarks/labs-showreel-ground-truth/script/scene1.js) s/d [`scene8.js`](../benchmarks/labs-showreel-ground-truth/script/scene8.js) (**1.618 baris / 55,2 KB**) agar menjadi cetak biru langsung bagi engine Aetheria.

### 2.1. Tahap A — Ekstraksi Frame Rapat & Pembacaan Visual Murni (Tanpa Teks OCR)
1. Dari video referensi `ref_tiktok.mp4` (`1024×576`, `30fps`, `25.867s`, `114.5 BPM`), diekstrak **23 keyframe rapat** yang mencakup awal, tengah, dan akhir setiap sub-beat (`0.20s, 0.80s, 1.50s, 2.50s, 3.30s, 4.20s, 5.20s, 5.80s, 6.20s, 6.80s, 7.30s, 8.20s, 9.50s, 10.60s, 11.50s, 13.50s, 15.50s, 16.50s, 18.00s, 19.20s, 20.50s, 22.50s, 25.00s`) ditambah 2 lembar contact sheet (`contact_sheet_1.jpg`, `contact_sheet_2.jpg`).
2. **Aturan kunci yang dipakai saat membuat remake manual:**
   - **Data mesin yang dipakai hanya 4 hal pasti:** (a) timestamp batas 8 scene (`0.00s, 3.167s, 5.60s, 6.667s, 7.833s, 11.00s, 16.00s, 20.00s, 25.867s`), (b) dimensi `1024×576 @ 30fps`, (c) `114.5 BPM`, dan (d) sampel warna heksadesimal langsung dari piksel latar/objek.
   - **Tidak memakai output teks OCR atau daftar bbox otomatis OpenCV**, melainkan mengamati gambar keyframe tiap scene dari awal ke akhir (`early -> mid -> late`) untuk memetakan geometri, urutan gerak, dan transisi.

### 2.2. Tahap B — Konstruksi Kode Kanvas Per Scene (`scene1.js` – `scene8.js`, 1.618 Baris)

| Scene & Waktu | File & Ukuran | Cara Pengerjaan & Detail Geometri yang Ditulis di Remake Manual |
|---|---|---|
| **Scene 1** (`0.000s–3.167s`) | [`scene1.js`](../benchmarks/labs-showreel-ground-truth/script/scene1.js) (222 baris, 6,7 KB) | **Konsep Inline Per-Letter Morph:** Kata `"Showreel"` dibagi menjadi 8 slot huruf (`S, h, o, w, r, e, e, l`) pada **satu baseline horizontal yang sama (`y = 288`)**. Setiap slot memiliki jadwal `morphStart..morphEnd` berurutan dari kiri ke kanan mengikuti lintasan kursor putih: sebelum kursor lewat, slot menampilkan bentuk ikon geometris berwarna (huruf `S` neon ungu `#A855F7`, kapsul vertikal ungu `#7C3AED` dengan titik merah muda `#F43F5E`, cincin biru `#3B82F6` terbelah dua, kotak hijau zamrud `#10B981`, bentuk setengah lingkaran emas, silang/garis miring magenta `#EC4899`); begitu kursor melewati slot tersebut, bentuk geometris bertransformasi (skala + rotasi spring) menjadi huruf `"Showreel"` berwarna putih-perak `#EAE9EE`. Di akhir scene (`t > 2.75s`), tirai diagonal menyapu layar menuju warna latar Scene 2. |
| **Scene 2** (`3.167s–5.600s`) | [`scene2.js`](../benchmarks/labs-showreel-ground-truth/script/scene2.js) (336 baris, 12,2 KB) | **Dinding Ubin Miring Asimetris + 21 Ikon Vektor Kustom:** Kanvas diputar `-2.8°` (`ctx.rotate(-0.0489)`), lalu digambar grid 7 kolom × 3 baris (`pitch 158×255px`, `origin (-24, -90)`) mengikuti peta warna terukur `LDLDLDL / LDLLLDD / DLDLDLL` (ubin terang `#F0EEEC`, ubin gelap `#1D1E21`, dan ubin aksen abu-kehijauan `#C8CCC0`). **Setiap sel — baik ubin terang maupun ubin gelap — digambari fungsi ikon vektor tersendiri** (grid 3×3 titik, orbit elips miring, segitiga garis, bintang 4-sudut, bulan sabit, gelombang paralel, badge angka `00`, panah 45°, kubus isometrik 3D, lingkaran larangan/split, monogram `L` tebal, gelombang WiFi, cincin `C`, daun/tetes, diagram batang, petir, ikon `L` dalam kotak, bingkai sudut fokus, chevron, dan grid 2×2 kotak) dengan warna kontras terbalik (`#1D1E21` di atas ubin terang, `#F0EEEC` di atas ubin gelap), ditambah kursor putih dengan badge pill `"Labs"`. |
| **Scene 3** (`5.600s–6.667s`) | [`scene3.js`](../benchmarks/labs-showreel-ground-truth/script/scene3.js) (186 baris, 5,7 KB) | **Pemisahan 2 Layer Kedalaman (Blurred 3-Card Carousel + Sharp Hero Card):** (1) Layer latar dirender dengan `ctx.filter = "blur(7px)"`, menggambar 3 kartu besar berjajar horizontal yang bergeser pelan (kartu kiri berisi ikon lingkaran split, kartu kanan berisi ikon gelombang miring); (2) Setelah `ctx.filter = "none"`, di tengah layar digambar **1 kartu vertikal tajam** (`w ≈ 290px, h ≈ 490px`, warna krem hangat `#ECE6E5`, bayangan lembut) berisi monogram `L` miring tebal di pusat kartu, pill `"Making logo"` (kata `"logo"` berwarna ungu `#6C4DF6`), label `"01 . MIRING"` di sudut kiri bawah kartu, serta kursor ungu dengan cincin riak klik (`click ripple`) di sudut kiri atas kartu. |
| **Scene 4** (`6.667s–7.833s`) | [`scene4.js`](../benchmarks/labs-showreel-ground-truth/script/scene4.js) (151 baris, 5,5 KB) | **Proyeksi & Ekstrusi 3D Kursor Panah Berekor Cekung:** Di atas latar `#0C0B0E` dengan pendaran radial ungu (`createRadialGradient`), poligon panah berekor cekung diproyeksikan dalam ruang 3D (`rotX, rotY, rotZ`) lengkap dengan dinding samping ekstrusi (`depth`) yang diurutkan berdasarkan kedalaman (`painter's algorithm`) dan diberi pencahayaan berbeda antara bidang atas (`#F3EEFF`) dan dinding tebal samping (`#6D44F8`). Lintasan dianimasikan secara kontinu: masuk dari kiri-bawah (`x ≈ 330, y ≈ 420` pada `t = 6.80s`) sambil berputar dan melipat pipih horizontal menyerupai siluet atap di tengah-bawah (`t = 7.25s`). |
| **Scene 5** (`7.833s–11.000s`) | [`scene5.js`](../benchmarks/labs-showreel-ground-truth/script/scene5.js) (235 baris, 8,1 KB) | **Tiga Sub-Beat Berbeda dalam Satu Scene:** (1) `t = 7.83s..8.95s`: Marquee horizontal ukuran besar (`62px`, `"Motion   Designing   Workflow   Animation"`) yang meluncur cepat ke kiri dengan kursor ungu kecil di atas huruf `"Motion"`; (2) `t = 8.95s..10.05s`: Transisi ke kalimat tunggal `"Information to Motion"` (`22px`) tepat di tengah layar saat kursor putih mendekat dari bawah; (3) `t = 10.05s..11.00s`: Kata `"Information to"` bergeser ke kiri dan `"Motion"` ke kanan, membuka **jendela slot-reel vertikal 3 sel** (`128×260px`) di tengah layar yang ter-clip rapi dan menggulirkan 3 kartu ikon (atas: busur `C` pada kartu gelap, tengah: 4 sudut fokus putih pada kartu abu-gelap, bawah: bulan sabit pada kartu bergradasi terang/hangat). |
| **Scene 6** (`11.000s–16.000s`) | [`scene6.js`](../benchmarks/labs-showreel-ground-truth/script/scene6.js) (237 baris, 8,3 KB) | **Mockup Laptop dengan `ctx.clip()` Ketat & Transisi Layar 2 Fase:** Pertama digambar bodi/bezel MacBook Pro terpusat di `(512, 290)` (`layar dalam: x=265, y=124, w=494, h=316`), lalu seluruh gambar layar dalam dibungkus `ctx.save(); ctx.beginPath(); ctx.roundRect(265, 124, 494, 316, 8); ctx.clip();` agar **mustahil bocor keluar bezel**. Di dalam area clip tersebut: (1) `11.0s..14.3s` menampilkan antarmuka gelap `#121116` dengan 4 baris kata dan kapsul pill emas (`#D8B85C`: `"Support"`, `"System"`, `"Environment"`, `"Results"`) yang menyala saat kursor mengklik; (2) `14.3s..16.0s` layar dalam menyapu menjadi kanvas gelombang cincin konsentris ungu (`#5E24E8..#B87CFF`) dengan teks sans-serif putih `"Movement"` & `"Transitions"` di kiri atas (margin `28px` dari tepi kiri layar) dan teks serif italic besar `"Design"` (`64px`) di kanan bawah. |
| **Scene 7** (`16.000s–20.000s`) | [`scene7.js`](../benchmarks/labs-showreel-ground-truth/script/scene7.js) (69 baris, 2,7 KB) | **Roda Kata Vertikal (`Word Wheel`) Presisi Waktu + Partikel Debu:** Daftar kata `["Thinking", "Finding", "Building", "Creating"]` digulirkan vertikal menggunakan kurva `AM.ease.inOutCubic` antar-ketukan sehingga tepat pada `t = 18.00s` indeks pusat berada di `1.0` (**`"Finding"`** tampil paling besar `88px` dan paling terang `alpha = 1.0` di `y = 288`, diapit `"Thinking"` `68px` redup di `y = 205` dan `"Building"` `68px` redup di `y = 371`), ditemani 18 partikel titik redup deterministik (`AM.rng`). |
| **Scene 8** (`20.000s–25.867s`) | [`scene8.js`](../benchmarks/labs-showreel-ground-truth/script/scene8.js) (182 baris, 5,9 KB) | **Koreografi Jatuh Maskot Beruang Voxel ke Monogram `L`:** Monogram `L` miring putih krem (`#EEEDE6`) muncul dengan spring scale di tengah layar, lalu karakter beruang voxel cokelat (`#A05240`, lengkap dengan telinga, moncong, mata piksel hitam, dan kaki) jatuh dari atas dengan fisika pantulan (`bounce`) dan mendarat tepat di atas lengan horizontal huruf `L`. Setelah mendarat (`t > 22.6s`), teks `"Labs Studio"` (`24px bold`) dan baris kredit tipis di bawahnya muncul perlahan (`fade + slide up`). |

### 2.3. Tahap C — Render Headless & Verifikasi Strip 19-Titik (`render_and_verify.mjs` + `ref_compare.py`)
1. Seluruh 8 file `script/scene1..8.js` dimuat ke dalam `index.html` standar Aetheria (`window.__filmMeta = { width: 1024, height: 576, fps: 30, duration: 25.867 }`).
2. Satu tab headless browser CDP dibuka, memanggil `window.renderAt(f / 30.0)` secara berurutan dari frame `0` sampai `775`, lalu di-mux bersama trek audio BGM+SFX (`114.5 BPM`) menjadi `labs-showreel-remake.mp4`.
3. `ref_compare.py` dijalankan pada 19 pasang frame (`8 midpoint + 11 sub-beat`) untuk menghasilkan `comparison_strip.jpg` (`Referensi | Hasil Render | Diff Heatmap`), lalu setiap baris diperiksa secara visual sampai seluruh 8 scene selaras dan bebas dari artefak.

---

## 3. Penerapan ke Engine Aetheria: Arsitektur `Direct Per-Scene Vision-First Loop`

Seluruh cara kerja remake manual di atas dapat diterapkan langsung ke dalam engine Aetheria melalui **3 komponen** berikut:

### 3.1. Komponen 1 — Mode `Hard-Facts + Beat Strip Only` di `core/ref_extractor/ref_extractor.py`
Alih-alih menyuapi LLM dengan hasil tebakan OCR dan kontur OpenCV yang rentan salah, `ref_report.md` dan `style_ast.json` yang dikirim ke LLM dipangkas menjadi **hanya data deterministik yang tidak bisa salah**:

1. **Data Pasti yang Dipertahankan:**
   - Metadata global: `width`, `height`, `fps`, `totalDuration`, `bpm` + `bpmSource` (`"measured"` vs `"fallback"`, mencetak `"BPM tak terukur"` saat fallback) + `bpmConfidence`, `audioProfile.mode` (`bgm-sfx-only` vs `narrated`), serta `cuts[]` dengan `evidence` (`"hard"` tidak pernah digeser ke audio onset — kebijakan D1; `nearestOnsetSec` tetap dilaporkan).
   - Per scene (`Scene 1..N`): `id`, `start`, `end`, `duration`, `cleanPlate` (`fillHex`, `kind: "tile-wall"` + `confidence` dengan guard polaritas agar latar gelap dinding ubin tidak tertimpa warna rata-rata terang), `cameraMotion` (`segments[]` skala/rotasi/pan/easing + `pivot`, dipetakan langsung ke `AM.applyCamera`), `gridTiltDeg` + `contrastTiles` (khusus scene dinding ubin seperti Scene 2: `lightTileHex`, `darkTileHex`, `pitch`, `origin`, peta baris `LDLDLDL`), dan palet warna terukur (`bgHex`, `surfaceHex`, `textHex`, `accentHex`, ditambah `saturatedAccents` hanya sebagai daftar kode warna `#HEX` tanpa memaksa bbox heuristik).
   - Gambar visual utama per scene: **`ref_scene_0K_beats.jpg`** (strip adaptif hingga 6 panel `3×2` dengan `beatStripTimestamps` & `beatStripPanels[].reason` yang selalu mencakup frame awal pasca-cut, frame akhir pra-cut, puncak perubahan `cameraMotion`, dan puncak energi gerak) + frame `q1`, `mid`, `q3`.
2. **Data Berisik yang Dihapus dari Prompt LLM:**
   - Daftar string OCR mentah (`"Showrea"`, `"Shosea"`, `"Ertem"`, `"Estem"`, `"1 ahe"`).
   - Kotak pembatas (`bbox`) heuristik satu layar penuh (`[14,13,980x552]`) yang menyesatkan skala kartu/elemen.
   - *(Catatan: RapidOCR dan bbox struktural di `ref_structural_compare.py` tetap boleh dipakai secara internal oleh gate evaluator untuk menghitung skor, tetapi **tidak boleh** disalin mentah sebagai instruksi teks yang menyuruh LLM menulis `"Showrea"` atau membuat kartu berukuran `980×552`).*

### 3.2. Komponen 2 — Orkestrator `Direct Per-Scene Loop` (2-Pass Deterministik + Auto-Rollback)
Pada saat pengguna meminta pembuatan video dari referensi (`ref/extracted/style.json` tersedia), engine menjalankan pipeline terstruktur per scene (baik dipicu oleh tool khusus maupun di dalam `subagent.rs` / `scene_compiler.rs`):

```
[1] extract_video_reference  -> menghasilkan style.json + ref_scene_01..0N_beats.jpg
[2] film_scaffold + film_audio -> menyiapkan index.html, film.json, audio/bgm_*.wav, audio/sfx_*.wav
[3] Buka 1 Persistent CDP Browser Session (tetap hidup selama seluruh scene dikerjakan)
[4] Loop Deterministik untuk setiap Scene K = 1..N:
    ├── Pass 1 (Draft ~12 detik, 1x panggilan LLM):
    │     Input : HANYA gambar `ref_scene_0K_beats.jpg` + `ref_scene_0K_q1/mid/q3.jpg`
    │             + data pasti Scene K (start, duration, cleanPlate, contrastTiles, AM_API)
    │     Output: kode `script/sceneK.js` (disimpan sebagai `sceneK.pass1.bak`)
    │
    ├── Render & Susun Strip Perbandingan 6-Panel (~0,8 detik di Persistent CDP Tab):
    │     - Reload / evaluasi `sceneK.js` di tab CDP yang sudah terbuka
    │     - Panggil `window.renderAt(t)` pada 6 titik waktu yang sama persis dengan 6 panel `ref_scene_0K_beats.jpg`
    │     - Cek `window.__aetheriaErrors` (0 runtime error)
    │     - Susun 1 gambar `scene_0K_compare_6beats.jpg`:
    │         * Baris Atas : 6 panel Referensi Scene K (t1..t6)
    │         * Baris Bawah: 6 panel Hasil Render Scene K (t1..t6)
    │         * Baris Bawah-2: Diff Heatmap per panel + skor `score_pass1`
    │
    ├── Pass 2 (Visual Self-Correction ~12 detik, 1x panggilan LLM):
    │     - Jika `score_pass1 >= 0.85` dan 0 error: langsung lanjut ke Scene K+1!
    │     - Jika belum: kirim `scene_0K_compare_6beats.jpg` + kode `sceneK.js` Pass 1 ke LLM:
    │       "Bandingkan 6 panel Referensi (atas) vs 6 panel Hasilmu (bawah) dari kiri ke kanan.
    │        Koreksi `script/sceneK.js` agar posisi, proporsi/ukuran, warna aksen, ikon di tiap sel,
    │        dan perubahan bentuk antar-panel (t1..t6) sama dengan baris atas."
    │
    └── Verifikasi & Auto-Rollback (~0,8 detik):
          - Render ulang 6 panel Pass 2 -> hitung `score_pass2` dan cek `window.__aetheriaErrors`
          - Jika `runtime_errors > 0` ATAU `score_pass2 + 0.005 < score_pass1`:
              -> Otomatis ROLLBACK `script/sceneK.js` ke `sceneK.pass1.bak`!
          - Kunci `script/sceneK.js` (tidak boleh lagi diubah oleh scene lain).
[5] Tutup Persistent CDP Browser Session -> jalankan `film_render` (MP4 akhir).
```

#### Keunggulan Langsung Arsitektur Ini:
1. **Waktu Run Turun dari 16 Menit → ~2,5–3 Menit:**
   - Setiap scene hanya butuh **maksimal 2 panggilan LLM** (~12 detik + ~12 detik) dan **2 kali capture cepat** (~0,8 detik + ~0,8 detik) = **~25 detik per scene** (8 scene = ~3 menit).
2. **Isolasi Mutlak Antar-Scene + Auto-Rollback:**
   - Tidak ada lagi subagent terakhir yang mengedit 5 scene sekaligus dan merusak Scene 3 atau Scene 7.
   - Kalau Pass 2 pada sebuah scene justru memperburuk tampilan (regresi), engine otomatis mengembalikan kode Pass 1 dalam hitungan milidetik.
3. **Model Melihat Persis Apa yang Dilihat Pembuat Manual:**
   - Pada Pass 2, model melihat **6 panel Referensi berjajar tepat di atas 6 panel Hasil Rendernya sendiri** untuk 1 scene itu saja (bukan 16 baris kecil dari 8 scene berbeda yang bertumpuk dalam satu gambar panjang).

---

## 4. SOP Cara Pengerjaan & Siklus Uji Cepat (~30 Detik, Bukan 25 Menit)

Saat mengimplementasikan dan menguji arsitektur di atas, **dilarang** menjalankan siklus 25 menit untuk setiap perubahan kecil. Ikuti urutan kerja 3 tahap ini:

### Tahap 1 — Iterasi & Uji Per 1 Scene (`~20–30 Detik` per Percobaan)
1. Buat/gunakan skrip runner 1-scene (mis. `node scripts/test-single-scene-loop.mjs --scene 1` atau `--scene 3`) yang hanya menjalankan **2-Pass Loop** di atas pada **1 scene target** menggunakan folder `ref/extracted/` yang sudah ada (tidak perlu download ulang TikTok atau ekstrak ulang 8 scene setiap kali).
2. Uji pada 3 scene paling menantang secara terpisah:
   - **`--scene 1` (~25 detik):** Pastikan morph huruf `"Showreel"` muncul segaris dengan ikon warna-warni di `t=0.5s..1.5s` (bukan tulisan `"Showrea"` dan bukan ikon bertumpuk di atas).
   - **`--scene 2` (~25 detik):** Pastikan baik ubin terang maupun ubin gelap berisi ikon vektor.
   - **`--scene 3` (~25 detik):** Pastikan kartu putih vertikal berada di tengah di atas latar 3 kartu blur (bukan melebar satu layar penuh).
3. Setiap selesai 1 scene (~25 detik), buka langsung gambar `scene_0K_compare_6beats.jpg` dengan `read_file` untuk memastikan secara visual sudah setara [`labs-showreel-remake.mp4`](../benchmarks/labs-showreel-ground-truth/labs-showreel-remake.mp4).

### Tahap 2 — Aturan Build Selama Iterasi Kode (`~0–20 Detik`)
1. **Saat mengubah Python (`core/ref_extractor/*.py`) atau teks prompt:** tidak perlu menjalankan `cargo` atau `npm run build` sama sekali (**0 detik build**).
2. **Saat mengubah kode Rust (`core/aetheria-engine/src/**`):**
   - Selama iterasi, jalankan **hanya** `npm run build:engine` (debug incremental) atau `cargo test -p aetheria-engine <nama_tes_spesifik>`.
   - **Jangan** menjalankan `npm run build` (Vite frontend build ~4,5 menit) atau `cargo test --workspace` penuh berulang-ulang di tengah iterasi jika tidak menyentuh `apps/src/` atau `src-tauri/`.

### Tahap 3 — Gate Penuh & Uji 8 Scene Sekali Saja di Akhir Sebelum Push
Setelah uji 1-scene pada scene-scene kunci lulus secara visual:
1. Jalankan 1 kali uji live 8-scene penuh (~2,5–3 menit) dan periksa strip 3 kolom (`Referensi | Manual | Agen`).
2. Jalankan gate wajib `AGENTS.md` §3.1–3.3 **satu kali** di akhir sebelum commit/push:
   - `python -m unittest discover -s core/ref_extractor -p "test_*.py" -v`
   - `npm run typecheck`
   - `(cd apps && npx vitest run)`
   - `npm run build`
   - `cargo test --workspace` & `npm run build:engine`
   - E2E deterministik 2x berturut-turut (`test-showreel-eval-e2e.mjs` & `test-tiktok-session-e2e.mjs`).
