# Analisis Gap Kualitas: Video Agen vs Remake Manual

## 1. Tujuan dan sumber data

Laporan ini menjelaskan mengapa video yang dihasilkan agen Autonomus/Aetheria (`tiktok-real-eval-v3..v6/gemini-3.8-flash-high/output.mp4`) secara visual jauh di bawah remake yang ditulis manual (`labs-showreel-remake.mp4`), meskipun keduanya memakai reference video yang sama (`ref_tiktok.mp4`, 25,87s, 1024×576, 30fps, 114,5 BPM).

Sumber bukti:

| Jenis | Path |
|---|---|
| Metrik agen v3–v6 | `…\scratch\tiktok-real-eval-v{3,4,5,6}\gemini-3.8-flash-high\eval-report.json` |
| Metrik manual | `…\scratch\manual-tiktok-remake\compare_result.json`, `compare_result_8mid.json` |
| Kode agen (terbaik, v6) | `…\tiktok-real-eval-v6\...\workspace\projects\aetheria-studio-showreel-tiktok-motion-clone\script\scene*.js`, `film.json` |
| Kode manual | `…\manual-tiktok-remake\workspace\projects\labs-showreel-remake\script\scene*.js`, `film.json` |
| Ekstraksi reference | `…\tiktok-real-eval-v6\...\workspace\ref\extracted\style_ast.json`, `style.json`, `ref_report.md` |
| Implementasi ekstraktor | `core/ref_extractor/ref_extractor.py`, `core/aetheria-engine/src/studio/fidelity_guard.rs` |

Commit yang diuji: `bf631817d29214acf84915804fb8c5f4bb22b54e` + perubahan working tree yang belum di-commit (terutama `ref_extractor.py`, `fidelity_guard.rs`, `default.txt`, `film_audio.rs`).

**Keterbatasan:** model yang menulis laporan ini tidak dapat membaca gambar, sehingga `comparison_strip.jpg` tidak diperiksa secara visual. Semua kesimpulan berdasarkan metrik numerik, JSON AST, dan kode scene. Konfirmasi visual oleh manusia tetap diperlukan.

---

## 2. Ringkasan metrik

| Versi | SSIM mean | Color match | **Edge match** | Overall | Threshold | `passed` | Waktu | Catatan |
|---|---|---|---|---|---|---|---|---|
| Manual (8 frame mid) | 0,8579 | 0,9410 | **0,5535** | 0,8220 | 0,85 | false | — | Paling dekat;gagal hanya karena threshold ketat |
| Manual (19 frame) | 0,8526 | 0,9337 | **0,5294** | 0,8123 | 0,85 | false | — | Idem |
| Agen v3 | 0,8027 | 0,8767 | **0,2576** | 0,7158 | 0,65 | true | 194,6s | Attempt 3; threshold sudah diturunkan |
| Agen v4 | — | — | — | — | — | — | 601,7s | **Timeout**, `previewToolCompare: null` |
| Agen v5 | — | — | — | — | — | — | 480,2s | **Timeout**, `previewToolCompare: null` |
| Agen v6 | 0,8163 | 0,8684 | **0,3267** | 0,7340 | 0,55 | true | 471,5s | Attempt 8; 1 compare gagal di 0,618 lalu threshold diturunkan |

**Observasi utama:** gap-nya bukan warna (0,87 vs 0,94, selisih ~0,07) melainkan **struktur/edge** (0,26–0,33 vs 0,55, selisih ~0,23–0,29). SSIM juga dekat (0,80 vs 0,86). Artinya agen sudah "menebak palet dengan benar" tetapi **salah membangun objek, layout, dan gerak kamera**. Status `passed: true` pada v3/v6 menyesatkan karena threshold diturunkan (0,65 dan 0,55) dari 0,85.

---

## 3. Temuan akar

### F1 — AST kehilangan struktur domino/grid (kritis)

`style_ast.json` scene2 melaporkan:

```
"visual_archetype": "high-density-kinetic-showcase ...",
"density": 0 cards, 0 pills, 18 scatter elements
```

Reference scene2 sebenarnya adalah **grid bento 7×3 = 21 kartu** dengan 21 ikon vektor berbeda dan label monospace (`01 · MIRING`, `12 · TITIK`, …). Scene3 dilaporkan `0 cards, 0 pills, 7 scatter`, padahal reference-nya adalah **karusel 5×3 dengan blur** yang di-zoom.

Konsekuensi di kode agen:

- `v6/script/scene2.js` membangun checkerboard **6×4** dengan ikon primitif (`△`, lingkaran, garis) dan font Inter 20–45px.
- `v6/script/scene3.js` hanya dua persegi abu (`#CFC5C9`) + teks `L`, `Making logo`, `01.MIRING` di atas background flat.

Bandingkan dengan kode manual:

- `manual/.../scene2.js` berisi tabel `TILES` 21 entri + 21 cabang `drawIcon()` + stagger per tile + pointer + pill `Logo`.
- `manual/.../scene3.js` berisi `ctx.filter = "blur(6px)"`, grid 5×3, zoom ~0,95→1,28.

Akar kode: deteksi kartu di `ref_extractor.py:911-957` memakai `Canny` + `findContours` + filter area; grid bento yang miring dan terisi ikon tidak lolos, sehingga `card_count = 0`. Archetype fallback di `ref_extractor.py:845,965` selalu `high-density-kinetic-showcase`. Agen mengikuti AST secara harfiah, bukan frame asli.

**Dampak:** `edgeSimilarity` 0,26–0,33 (vs 0,55 manual). Dua scene terburuk di kedua versi konsisten: scene2 dan scene3.

### F2 — Clean plate terbalik polaritasnya

AST scene2:

```
"cleanPlate": { "fillHex": "#A1A19C", "bottomHex": "#817F7E", "hasGradient": true }
```

Reference scene2 sebenarnya ber-background gelap `#0C0B0E` dengan kartu terang `#F1F0EC`/gelap `#17181A`. Fungsi `extract_clean_plate_background()` (`ref_extractor.py:221-253`) mengambil median 8 piksel tepi dari temporal median; karena grid terang memenuhi hampir seluruh frame, tepi ikut terang. `reconcile_palette_with_clean_plate()` (`ref_extractor.py:269-288`) kemudian dapat menimpa `bgHex` dengan nilai terang itu.

Agen v6 mematuhi AST: `scene2.js` mengisi gradient `#D7D8CE → #A1A19C`. Manual memakai `#0C0B0E` + kartu bimodal. Diagnostik engine sendiri mengonfirmasi:

```
lumaCorrelation = 0.112, luminanceDelta = +0.318
"INVERTED POLARITY/ORIENTATION vs ref ... too bright vs ref"
```

Fungsi `detect_bimodal_contrast_tiles()` (`ref_extractor.py:309-328`) sebenarnya sudah ada di working tree dan dirancang untuk kasus ini, tetapi:

1. Hasilnya **tidak disalin** ke `ast_scene_obj` (`ref_extractor.py:1398-1408`) — hanya masuk `layout` di `style.json`. Konsumen AST (agen) tidak pernah melihatnya.
2. Di data v6 tidak ada field `contrastTiles` sama sekali → detektor mengembalikan `null` karena threshold kaku (`gray < 55`, `gray > 185`, minimal 20% tiap sisi) pada frame mid yang sudah ter-zoom/detail.

### F3 — Gerak kamera global tidak diekstrak

`analyze_layer_motion_curve()` (`ref_extractor.py:331-...`) mengukur Farneback optical flow **di dalam crop satu box teks** lalu meregresi menjadi `spring`/`ease.outCubic`. Tidak ada estimasi transformasi global (zoom, rotasi, pan, blur) antar frame awal–tengah–akhir.

Yang hilang dari scene2 manual: `zoomStart = 2.15`, `angle -0.048 → 0`, `gridScale 0,86 → 1,56`, stagger per tile, kursor klik, pill `Logo`.
Yang hilang dari scene3 manual: zoom carousel `~0,95 → 1,28` + blur latar.

Agen hanya menghasilkan animasi entrance teks; grid/carousel diam. Ini menjelaskan mengapa `motionEnergy` di AST tidak pernah diterjemahkan menjadi koreografi dan mengapa edge tetap rendah walau warna sudah benar.

Catatan: `gridTiltDeg = -2,8°` memang berhasil diekstrak (`style.json` scene2, `ref_report.md:52`) dan agen v6 memakainya (`ctx.rotate(-0.0489)`), membuktikan bahwa **field yang masuk laporan dipakai, field yang tidak masuk laporan diabaikan**.

### F4 — Drift timing scene5–scene8 (1,83 detik)

| Scene | Reference / manual (start + dur) | Agen v6 | Selisih start |
|---|---|---|---|
| 1 | 0,000 + 3,167 | 0,000 + 3,167 | 0 |
| 2 | 3,167 + 2,433 | 3,167 + 2,430 | 0 |
| 3 | 5,600 + 1,067 | 5,597 + 1,070 | ~0 |
| 4 | 6,667 + 1,166 | 6,667 + 1,166 | 0 |
| 5 | 7,833 + **3,167** | 7,833 + **5,000** | 0 (dur salah +1,833) |
| 6 | 11,000 + 5,000 | **12,833** + 5,000 | +1,833 |
| 7 | 16,000 + 4,000 | **17,833** + 4,000 | +1,833 |
| 8 | 20,000 + 5,867 | **21,833** + 5,867 | +1,833 |
| Total | **25,867** | **27,700** | +1,833 |

AST sudah benar (`scene5 duration 3.167`), tetapi agen menyalin durasi scene6 (`5.0`) ke scene5 lalu menghitung ulang start kumulatif. Bukti di metrik: frame `end` v6 berada di `t = 27,55s`, padahal reference `25,72s`. Akibatnya semua beat setelah 7,833s bergeser hingga 1,83s — sinkronisasi audio/visual dan perbandingan frame scene7/8 ikut turun.

### F5 — Palet per-scene tidak diterapkan

`v6/film.json` memberi **semua 8 scene** `accent: "#f59e0b"`. Manual memakai aksen terukur per scene: `#7D56EF`, `#D4D6CE`, `#6C4DF6`, `#7D56EF`, `#DEDDDF`, `#D8B85C`, `#FFFFFF`, `#A05240`. Ini melanggar direktif eksplisit `ref_report.md` butir 3 ("never substitute generic default colors") dan menunjukkan agen tidak membaca/menerapkan measured palette meski sudah tersedia.

### F6 — Loop perbaikan tidak pernah menghasilkan edit terarah

| Versi | Perilaku |
|---|---|
| v3 | `write_to_file` ditolak role `director`; subagent `motion-designer` `finalText: ""` (tidak ada hasil tertulis); lolos di attempt 3 setelah threshold 0,65 |
| v4 | Timeout 601,7s; 3 subagent motion-designer; `previewToolCompare: null` |
| v5 | Timeout 480,2s; 7 session (qa-verifier + 5 motion-designer + general); `previewToolCompare: null` |
| v6 | 8 attempt; step limit 30 pada subagent; `capture_film_preview` identik diblokir; satu attempt gagal di 0,618 lalu lolos di 0,734 setelah threshold 0,55 |

`targetWorstScenes` sudah memuat diagnosis yang sangat spesifik (termasuk `script: "script/scene2.js"` dan `INVERTED POLARITY ... darken backdrop`), tetapi agen tidak pernah mengubahnya menjadi patch kecil pada scene itu — ia terus menulis ulang seluruh scene. Sementara itu `default.txt` mengizinkan `passThreshold: 0.65` untuk adaptasi, sehingga status "lulus" tercapai tanpa perbaikan struktur.

### F7 — Perbedaan proses: manual membaca frame padat, agen hanya membaca AST

Manual memiliki `dense_ref/` berisi 24 frame padat (`k_00.20s.jpg` … `k_25.00s.jpg`), 2 sheet transisi, dan `ref_audio.wav`. Kode `scene2.js` manual secara eksplisit menyebut `k_04.20s.jpg` sebagai acuan grid. Agen hanya menerima `ref/extracted/frames/*` + dua contact sheet dari ekstraktor, dan promptnya mengarahkan ke `style_ast.json` sebagai sumber tunggal (`ref_report.md:106-110`).

Jadi perbedaannya bukan "manual lebih pintar menggambar", melainkan **manual memiliki akses ke bukti visual yang benar dan memakainya; agen diberi ringkasan yang kehilangan informasi struktur lalu dipaksa mempercayainya**.

---

## 4. Rekomendasi perbaikan

### P0 — Perbaiki kontrak data (dampak terbesar pada edge)

1. **`core/ref_extractor/ref_extractor.py` — `ast_scene_obj` (sekitar baris 1398-1408):** sertakan `gridTiltDeg`, `contrastTiles`, `tileGrid` (`rows/cols/polarity/icon silhouette`), dan `cameraMotion` (`zoom/rotation/pan/blur` per sub-beat). Apa pun yang tidak masuk AST tidak akan dipakai agen (bukti F3).
2. **Deteksi kartu:** turunkan ketergantungan pada `Canny`+kontur; tambahkan deteksi grid berbasis *line intersections* / template rectangle dengan toleransi rotasi, atau manfaatkan frame padat `k_*.jpg` yang sudah diekstrak. Target: scene2 `card_count = 21`, scene3 `card_count = 15`, archetype bukan `high-density-kinetic-showcase`.
3. **`detect_bimodal_contrast_tiles()`:** ganti threshold absolut (`<55`/`>185`, 20%) dengan Otsu adaptif per scene, dan taruh hasilnya di `cleanPlate.tiles[]` dengan `baseHex` gelap. Jika bimodal terdeteksi, `reconcile_palette_with_clean_plate()` tidak boleh menimpa `bgHex` dengan warna terang.
4. **`analyze_layer_motion_curve()`:** tambahkan estimasi transform global (ECC homography atau flow median seluruh frame) antara `fr_start`/`fr_mid`/`fr_end`, keluarkan `cameraMotion.zoom[]`, `rotation[]`, `blur[]`.

### P1 — Perbaiki loop dan validasi

5. **Validasi timing di film-lint:** tolak film bila `start[k+1] != start[k] + duration[k]` atau `Σ duration != metadata duration`. Ini langsung menangkap F4 sebelum render.
6. **`core/aetheria-engine/src/studio/fidelity_guard.rs`:** diagnosis sudah bagus; tambahkan `patchScope` yang membatasi perbaikan hanya ke `script` yang disebut, dan larang regenerate seluruh scene saat `edgeSimilarity < 0.4`.
7. **`core/aetheria-engine/src/session/prompt/default.txt`:** (a) wajibkan membaca frame padat/contact sheet sebelum menulis scene; (b) larang menurunkan `passThreshold` di bawah nilai yang ditetapkan pengguna; (c) catat sebagai `degraded` bila threshold diturunkan, bukan `passed`.
8. **Isolasi subagent:** `finalText: ""` pada v3/v4/v5 menunjukkan hasil tulis subagent tidak kembali ke koordinator. Pastikan `motion-designer` mengembalikan ringkasan file yang ditulis (lihat juga perubahan working tree di `subagent.rs`).

### P2 — Perbaiki evaluasi

9. Simpan `contrastTiles`/`structure` ke `eval-report.json` sehingga regression bisa dilihat tanpa membuka gambar.
10. Tambahkan metrik `cameraMotionMatch` (zoom/rotasi) agar kegagalan F3 terukur, bukan hanya lewat `edgeSimilarity`.

---

## 5. Kesimpulan

Agen kalah bukan karena tidak bisa menulis Canvas/JS, tetapi karena **representasi antara (AST) membuang tiga hal yang menentukan kesamaan visual: struktur grid/kartu, polaritas background, dan gerak kamera global**. Ia lalu "berhasil" menyalin palet dan timing scene awal, tapi salah struktur (edge 0,26–0,33), salah polaritas (scene2), dan meleset 1,83s setelah scene5. Remake manual menang karena membaca frame referensi yang padat dan membangun struktur itu secara eksplisit.

Perbaikan paling murah dan berdampak besar adalah **menyalin field yang sudah dihitung (`gridTiltDeg`, `contrastTiles`) ke `style_ast.json`**, memperbaiki deteksi grid, dan menambah validasi timing di film-lint — bukan menaikkan kemampuan model menggambar.

---

## 6. Verifikasi

- Sumber metrik: `eval-report.json` v3–v6, `compare_result.json` & `compare_result_8mid.json` (manual).
- Kode: `scene2.js`/`scene3.js` v6 vs manual; `film.json` keduanya.
- Ekstraktor: `core/ref_extractor/ref_extractor.py` baris 221-328, 331-375, 911-965, 1371-1408.
- Gate statis/unit dan E2E untuk perubahan dokumen ini: lihat laporan penutup di sesi.
