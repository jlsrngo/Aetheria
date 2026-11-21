# Laporan Analisis Latensi Showreel (`v4` vs OpenCode) & Saran Perbaikan

**Tanggal:** 21 November 2026  
**Target benchmark:** Showreel TikTok 9:16 15 detik (`120 BPM`, tanpa audio, referensi Pinterest `https://pin.it/byKoQ42rJ`)  
**Model & konfigurasi:** `9router/ComboMaut` (`variant: "high"`, dilayani oleh `antigravity/gemini-3.8-flash-high`)

---

## 1. Ringkasan Eksekutif

Setelah 4 optimasi mesin mendarat pada commit `3cd4c0b` (menaikkan batas `edit` tanpa rentang baris ke `800` baris, menaikkan batas output tool ke `100 KiB`, menambah salinan JPEG kompak `vision/` untuk frame referensi, serta memprioritaskan keyframe `q1`/`q3` pada scene berdurasi `>= 2.5s`), benchmark live **Aetheria v4** (`ses_1a1fdda04a462c80001`) lulus penuh di resolusi **1080×1920** dengan **`0` tool gagal**, peningkatan cache hit (`cacheRead = 5.204.405`), dan kualitas visual tertinggi di seluruh run (`SSIM = 0.6946`, `Color = 0.8628`).

Namun total waktu eksekusi Turn #2 v4 masih **`21.2 menit` (`1274.4s`)**, dibandingkan **OpenCode Turn #2** sebesar **`10.8 menit` (`650.4s`)**.

Audit forensik berbasis log `usageHistory` di database `9router` (`data.sqlite`), database sesi OpenCode (`opencode.db`), dan `engine_logs_tail.txt` menunjukkan bahwa **eksekusi tool lokal Aetheria bukan penyebab lambatnya**: seluruh 53 tool lokal selesai dalam kisaran puluhan detik (`read` `11–16 ms`, `edit` ~`0.9s`, `capture_film_preview` 11 frame `16.2s` dan 1 frame `1.1s`). Waktu `21.2 menit` disebabkan oleh kombinasi **3 faktor terukur**:

1. **Lonjakan latensi server upstream sore hari sebesar `3.4×` lipat** dibanding pagi saat OpenCode diuji (faktor terbesar, di luar kode Aetheria).
2. **Pola pasca-`write` yang masih melakukan `36` request beruntun (`14 menit 52 detik`)** — termasuk `20+` panggilan `read` potongan kecil setelah `index.html` ditulis, `9` `edit` besar, dan `3` ronde `capture_film_preview`.
3. **Pembengkakan konteks gambar ke `184.285` prompt tokens** (`+70k` di atas puncak OpenCode `114.033`), karena salinan JPEG kompak lolos dari ambang batas ukuran byte (`25 MiB`) tetapi tetap menumpuk puluhan gambar di riwayat percakapan.

---

## 2. Data Perbandingan Terukur (`9router` `usageHistory` & Telemetry Sesi)

Seluruh request pada ketiga klaster utama di bawah dilayani oleh model upstream yang **identik** (`antigravity/gemini-3.8-flash-high`, `status = ok`) pada tanggal `2026-11-21`:

| Metrik Terukur | OpenCode Turn #2 (Pagi) | Aetheria Run Siang (`#4`) | Aetheria v4 Turn #2 (Sore) |
|---|---:|---:|---:|
| **Jendela waktu (WIB)** | `09:04–09:15` | `12:02–12:17` | `18:25–18:46` |
| **Total HTTP request ke `9router`** | `71` req | `50` req | **`44` req** (`-38%` vs OpenCode) |
| **Rentang waktu (`usageHistory`)** | `654.7s` (`10.9m`) | `899.6s` (`15.0m`) | `1274.6s` (`21.2m`) |
| **Median jeda antar-request** | **`6.4s`** | `6.9s` | **`21.4s`** (`3.3×` lebih lambat) |
| **P90 jeda antar-request** | `14.3s` | — | **`46.1s`** |
| **Request kecil (`<= 100` comp tok)** | `n=27` · med **`5.1s`** · avg **`5.8s`** | — | `n=10` · med **`17.5s`** · avg **`17.8s`** (`3.4×`) |
| **Langkah `write index.html`** | `140.9s` (`21.058` tok ≈ `149.5 tok/s`) | — | `215.3s` (`25.726` tok ≈ `119.5 tok/s`) |
| **Puncak `promptTokens`** | **`114.033`** | `167.759` | **`184.285`** (`+62%`) |
| **Total `completionTokens` (`9router`)** | **`41.136`** | `77.201` | **`64.023`** (`+56%`) |
| **Tool calls berhasil (gagal)** | `68` (`0` gagal) | — | `53` (`0` gagal) |
| **Resolusi output HTML** | `720×1280` | `1080×1920` | `1080×1920` |

### Progres Benchmark Aetheria `v1` -> `v4`

| Versi | Turn #1 | Turn #2 | Tool Calls (Gagal) | `cacheRead` | Skor 10-Frame vs `ref_video.mp4` |
|---|---:|---:|---|---:|---|
| **v1** | `38.2s` | `1692.5s` (`28.2m`) | `56` (`7`) | — | `overall 0.6591` (`360×640`) |
| **v2** | `40.3s` | `901.9s` (`15.0m`) | `24` (`0`) | `1.46M` | `SSIM 0.6833` · `Color 0.8462` · `Edge 0.3034` |
| **v3** | — | timeout `1800s` | `49` (`1`) | — | diarsipkan di `scratch/live-9router-run-v3` |
| **v4** | **`50.3s`** | **`1274.4s` (`21.2m`)** | **`53` (`0`)** | **`5.20M`** | **`SSIM 0.6946` · `Color 0.8628` · `Edge 0.2643`** (`overall 0.4518`*) |

*\*Catatan: `overallFidelity` (`0.4518`) di `v4` tertekan oleh penalti frame `t=0.73s` (`INIT` garis wireframe tipis di latar gelap, `combinedScore=0.12`) walaupun komponen `SSIM=0.8225` dan `Color=0.9445`. Nilai rata-rata `SSIM` (`0.6946`) dan `Color` (`0.8628`) di `v4` merupakan yang tertinggi di antara semua run.*

---

## 3. Analisis Tiga Akar Penyebab

### Akar Masalah 1 — Latensi & Throughput Upstream Turun Drastis pada Jam Sibuk (Bukan Bug Aetheria)
Pada sesi pagi OpenCode (`09:04 WIB`), request sangat kecil (`<= 100` completion token, mis. sekadar memanggil tool `read`) rata-rata selesai dalam **`5.8s`** (`median 5.1s`). Pada jam `18:25 WIB` di v4, panggilan setara yang hanya menghasilkan `47–67` completion token dan hampir seluruhnya sudah ter-cache (`cached_tokens` >95%) menunggu **`13.3s` hingga `27.4s`** (`median 17.5s`, `avg 17.8s`). Throughput generasi `write index.html` juga turun dari `149.5 tok/s` ke `119.5 tok/s`.

Dengan `44` HTTP request pada latensi pagi (`median 6.4s`), Turn #2 v4 akan berada di kisaran **~8–9 menit**; di jam sibuk sore hari (`median 21.4s`), `44` request otomatis membengkak menjadi `21.2 menit`.

### Akar Masalah 2 — Fase Revisi Pasca-`write` Memakan `14 Menit 52 Detik` (`36` Request)
Pecahan garis waktu v4 di `9router`:
- **Awal Turn #2 -> selesai `write index.html`:** hanya **`6 menit 23 detik`** (`8` HTTP request: `11:25:35Z` s/d `11:31:58Z`).
- **Revisi & polesan pasca-`write` (`#02` s/d `#37`):** **`14 menit 52 detik`** (`36` HTTP request: `11:32:15Z` s/d `11:46:50Z`).

Perbandingan pola kerja setelah file HTML ditulis:
- **OpenCode:** tidak memanggil `read` terhadap HTML yang baru saja ditulis oleh dirinya sendiri (`0× read` HTML), lalu hanya melakukan **`4` kali `edit` ringkas** (`86–563` output token per edit).
- **Aetheria v4:** memanggil `read` berulang (`25× read` total di Turn #2) sering dalam potongan `offset`/`limit` kecil (`40–80` baris satu per satu — setiap panggilan kena tunggu upstream `13.3–27.4 detik`), diikuti `9× edit` (termasuk blok besar hingga `4.968` token/`48.3s` dan `3.164` token/`61.2s`), serta `3× capture_film_preview`. Hasilnya: total `completionTokens` v4 membengkak ke `64.023` (`+56%` di atas OpenCode `41.136`).

### Akar Masalah 3 — Pembengkakan Konteks Gambar ke `184.285` Token (`+70k` di Atas OpenCode)
Fungsi `bound_inline_images` di `core/aetheria-engine/src/session/agent_turn/history.rs` saat ini mem-prune gambar berdasarkan batas **ukuran byte** (`25 MiB` -> `15 MiB`). Setelah optimasi `3cd4c0b` memperkecil ukuran file JPEG menjadi puluhan KB, total byte gabungan dari:
- keyframe hasil `extract_video_reference`,
- `12× inspect_ref_frame`, dan
- 3 kali `capture_film_preview` (termasuk batch `11` timestamp + `1` timestamp akhir)

tidak pernah menyentuh `25 MiB`, sehingga **seluruh puluhan gambar tetap bertahan** di payload pesan. Di sisi Gemini, tiap gambar tetap memakan kuota token visual besar (terlihat pada request `#36` setelah preview ke-2 masuk, `uncached` melonjak `+13.098` token dan `promptTokens` mencapai **`184.285`**, jauh di atas puncak OpenCode `114.033`), memperlambat *time-to-first-token* dan pemikiran per langkah.

---

## 4. Saran Perbaikan Terprioritas (Untuk Mencapai Target `< 10 Menit`)

### P0-A — Pruning Gambar Berbasis Jumlah & Penggantian Screenshot Preview Lama
**Target file:** `core/aetheria-engine/src/session/agent_turn/history.rs` (`bound_inline_images`)
1. Tambahkan batas **jumlah maksimum gambar aktif** di payload request (mis. maks **`14–16` gambar**) selain batas byte `25 MiB`.
2. Saat `capture_film_preview` baru ditambahkan ke riwayat, ganti/hapus lampiran gambar dari ronde `capture_film_preview` sebelumnya (simpan hanya label teks path-nya jika diperlukan) agar screenshot preview tidak menumpuk lintas iterasi.
3. Pertahankan paling banyak keyframe referensi inti + batch `capture_film_preview` terbaru sehingga puncak `promptTokens` tetap terkendali di kisaran `80k–120k`.

### P0-B — Hilangkan `read` Ulang Pasca-`write` & Dorong 1-Pass Batch `edit`/`apply_patch`
**Target file:**
- `core/aetheria-engine/src/session/prompt/default.txt`
- `core/aetheria-engine/src/tool/prompt/edit.txt`
- `core/aetheria-engine/src/tool/prompt/read.txt`
- Guard di `core/aetheria-engine/src/tool/edit.rs`
1. Anggap file yang **baru saja dibuat atau diedit sendiri pada sesi yang sama** (`write`/`edit` berhasil) sudah memenuhi syarat "file telah dibaca" di `edit.rs`, sehingga model tidak perlu melakukan `read` ulang sebelum `edit`.
2. Instruksikan secara eksplisit agar model tidak melakukan `read` potongan kecil (`40–80` baris) secara berurutan pada file `index.html` (`read` utuh sekali bila perlu karena batas `truncator` sudah `100 KiB`).
3. Batasi siklus `capture_film_preview -> batch edit` ke **1 putaran polesan visual terfokus** setelah draft awal selesai (hanya ulangi jika ada cacat render/runtime kritis). Pengurangan `15–20` round-trip pasca-`write` diperkirakan memangkas **~5–7 menit** bahkan pada latensi sore hari.

### P1 — Opsi `variant` / Reasoning Effort untuk Mode Cepat (`< 8 Menit` di Jam Sibuk)
- Konfigurasi aktif `ComboMaut` dengan `variant: "high"` mengirim `reasoning_effort = "high"` (`28.277` reasoning token di v4, `215.3s` untuk 1 langkah `write`).
- Untuk profil cepat / target mutlak `< 10 menit` pada jam padat, dukung atau pilih `variant: "medium"` (`ag/gemini-3.8-flash-medium`), sambil tetap mempertahankan `variant: "high"` untuk mode kualitas maksimal.

### P2 — Observabilitas Latensi Per-Step di Log Engine
**Target file:** `core/aetheria-engine/src/session/agent_turn/runner.rs` / `step_http.rs`
- Catat `step_idx`, `llm_elapsed_ms`, `tools_elapsed_ms`, `prompt_tokens`, `cached_tokens`, `completion_tokens`, dan `active_inline_images` untuk setiap step LLM. Data ini langsung memisahkan apakah lonjakan durasi berasal dari **server upstream**, **jumlah gambar di konteks**, atau **rantai tool lokal**.
