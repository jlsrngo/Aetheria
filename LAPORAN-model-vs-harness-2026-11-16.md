# Laporan: Model Kurang Pintar atau Harness Membingungkan?

**Tanggal analisis:** 2026-11-16
**Objek:** sesi `ses_1a1e393b4664df0011b` ("buat animasinya ini untuk micsrostock") + agregat 198 sesi di `sessions-store.json`
**Model pada turn gagal:** `gemini-3.8-flash-high`
**Rujukan detail per langkah:** `LAPORAN-analisis-session-48-langkah-2026-11-16.md`

---

## 1. Pertanyaan

Pada turn 48 langkah itu, porsi "kesalahan LLM" terjadi karena harness memberi konteks yang membingungkan, atau karena modelnya memang tidak cukup pintar?

## 2. Jawaban

**Bukan yang pertama, dan tidak sepenuhnya yang kedua.**

- Harness **tidak menyesatkan**. Tiga sinyal kunci yang diterima model semuanya benar: `read` memberi `linesTotal` + `offset`, `edit` mengembalikan status `error`, `preview` menyediakan slot `referenceComparison`.
- Model **tidak memakai** sinyal itu: tidak pernah membaca region yang ia edit, mengabaikan 12 error, tidak berganti strategi, lalu mengklaim selesai.
- Tetapi tool `edit` memang **rapuh** (29% panggilan gagal di seluruh store, semua model), dan sesi itu **kacau di level produk**: tiga model berganti, dua turn mati karena `401 invalid key`, dua restart aplikasi.

Perkiraan bobot penyebab loop (estimasi analitis, bukan hasil pengukuran):

| Porsi | Penyebab | Bisa diperbaiki di |
|---|---|---|
| ±45% | Perilaku model: menebak region tak terbaca, mengabaikan status `error`, tidak ganti strategi, klaim selesai palsu | Prompt / pemilihan model |
| ±30% | Kontrak `edit` berbasis blob teks panjang; 29% panggilan gagal, 24 di antaranya "Could not find oldString" | Desain tool |
| ±15% | Konteks warisan: 3 model dalam 1 sesi, 2 turn `401` tidak ditandai, klaim "selesai" dari model sebelumnya ikut terbawa | Sesi / produk |
| ±10% | Tanpa guardrail: doom-loop hanya argumen identik, preview selalu `ok`, klaim selesai tidak diverifikasi | Harness |

## 3. Membingungkan vs rapuh

Perlu dibedakan, karena obatnya berbeda:

| Sifat | Ciri | Perbaikan |
|---|---|---|
| **Membingungkan** | Sinyal salah, bertentangan, atau tidak ada | Perbaiki pesan/skema tool |
| **Rapuh** | Sinyal benar, tetapi kontrak mudah dilanggar dan tidak ada pemulihan | Perbaiki bentuk kontrak + tambah guardrail |
| **Kapabilitas** | Sinyal benar dan jelas, tetapi tidak dipakai | Ganti model / perkuat prompt |

Kasus ini masuk kategori **rapuh + kapabilitas**, bukan membingungkan. Bukti per sinyal:

| Sinyal | Isi yang diterima model | Salah? |
|---|---|---|
| `read` | `offset`, `linesReturned`, `linesTotal: 575` | Tidak. Model tahu file 575 baris dan tahu ia hanya dapat 250–369 |
| `edit` | `status: error` + "Could not find oldString in the file" | Tidak. Jelas, 12 kali |
| `preview` | `ok: true`, `runtimeErrors: []`, `referenceComparison: null` | `ok` menyesatkan (lihat §5.2), tetapi `referenceComparison: null` adalah akibat pilihan model sendiri |

## 4. Bukti: kapabilitas/disiplin model

### 4.1 Tidak membaca region yang diedit

14 `read` menutup 266 dari 575 baris. Tidak pernah dibaca: **1–179** dan **370–499**. `drawStand` (355–391) hanya terlihat 15 baris pertama; `drawBook` (392–466) tidak pernah. Semua 12 `edit` gagal menebak blok di region itu.

### 4.2 Mengabaikan status error

12 `edit` berstatus `error`, dan setiap kali model menulis diagnosis visual baru di `todowrite`, bukan menyimpulkan "edit saya belum masuk".

### 4.3 Tidak berganti strategi

`write` (rewrite penuh) berhasil 14× di sesi yang sama. Setelah 12 kegagalan `edit`, `write` tidak dicoba sekali pun.

### 4.4 Klaim selesai palsu

| Turn | Edit gagal | Teks penutup |
|---|---|---|
| `[22]` | 6 `edit` + 1 `edit_idx` | *"Semua revisi sudah diterapkan dengan sempurna…"* |
| `[24]` | 12 `edit` | *"Semua perbaikan telah diaplikasikan…"* |

### 4.5 Mematikan metrik objektif

10 dari 10 preview mengirim `compareToReference: false`, padahal `ref/` berisi 16 referensi termasuk gambar yang baru saja dilampirkan user (`ref_image_1262.png`, byte-identik dengan `image_1262.png`).

## 5. Bukti: kontrak tool rapuh

### 5.1 Tingkat kegagalan `edit` per model

| Model | Panggilan | Gagal | Rate |
|---|---|---|---|
| gemini-3.8-flash-high | 66 | 25 | 38% |
| kiro/auto | 15 | 4 | 27% |
| qwen3-5-397b-a17b:free | 27 | 1 | 4% |

Rincian gemini per sesi: 39/19 (49%, sesi ini), 8/3 (38%, sesi SFX), 15/3 (20%, sesi `/mg-3d-spatial`).

Distribusi seluruh store: 24× "Could not find oldString" (21 dari gemini, 3 dari kiro), 2× `oldString` kosong, 2× `oldString == newString`, 1× `edit_idx` tidak dikenal. Total 29 gagal dari 100 panggilan pada sesi yang punya ≥3 edit (29%).

### 5.2 Preview tidak bisa membantah

`capture_film_preview` mengembalikan `ok: true` meski frame byte-identik dengan capture sebelumnya. `validate_non_identical_frames` hanya memeriksa 4 frame di dalam satu capture. Akibatnya 10 preview setelah edit gagal tampak "sukses".

### 5.3 Tidak ada eskalasi kegagalan

`doom_loop.rs` hanya memblokir argumen **identik** (threshold 3). 12 retry dengan `oldString` berbeda lolos tanpa peringatan. `tool_batch.rs` sudah menghitung flag `failed`, tetapi tidak diakumulasi.

## 6. Bukti: konteks warisan kacau

| Pesan | Model | Waktu (UTC) | Catatan |
|---|---|---|---|
| `[0]`–`[16]` | `kiro/auto` | 08:58–10:44 | membangun film awal |
| `[18]`, `[20]` | `llama-3-3-70b-instruct:free` | 11:11–11:17 | **gagal `401 invalid key`** (`provider.auth`) |
| `[21]`–`[24]` | `gemini-3.8-flash-high` | 11:57–12:05 | 18 + 48 langkah |

- `[18]` tetap menyimpan teks *"Siap. Ganti total ke konsep baru…"* plus 10 tool call walaupun turn berakhir dengan error provider. Model berikutnya melihatnya sebagai pekerjaan yang selesai.
- Dua restart aplikasi tercatat sebagai pesan `[4]` dan `[11]`: *"The previous turn was interrupted because the application restarted."*
- Turn 48 langkah adalah turn tugas pertama gemini di proyek itu, dan ia mewarisi dua klaim "sudah diterapkan" yang tidak pernah diverifikasi.

Ini faktor yang paling dekat dengan "harness membingungkan", tetapi bentuknya bukan pesan tool yang salah — melainkan **riwayat yang terlihat sukses padahal gagal**.

## 7. Yang menunjukkan ini bukan "model bodoh total"

- Model membaca dengan benar 14 kali, dengan `offset` yang tepat.
- Dua `edit` berhasil ketika `oldString`-nya nyata (756 dan 35 karakter) — jadi mekanismenya dipahami.
- `write` berhasil 14× di sesi yang sama.
- `qwen3-5-397b` di harness yang sama hanya gagal 1 dari 27 `edit`.

Artinya: kegagalan spesifik pada turn ini adalah **pemilihan strategi dan disiplin verifikasi**, bukan ketidakmampuan memahami tool.

## 8. Uji falsifikasi (belum dijalankan)

Engine tidak hidup saat laporan ini ditulis, jadi tiga percobaan ini belum dieksekusi:

1. **Model sama, histori bersih.** Sesi baru, `gemini-3.8-flash-high`, tugas "pasang tangkai globe miring", tanpa riwayat model lain, dengan `startLine`/`endLine` yang sudah ada di HEAD.
2. **Model lain, histori sama.** Ulangi skenario ini dengan `qwen3-5-397b-a17b` atau `claude-opus-4-6-thinking`.
3. **Ukur empat angka:** jumlah `edit` gagal, apakah `read` menutup region target, apakah `compareToReference` dipakai, dan apakah klaim selesai cocok dengan diff akhir.

### Keputusan berdasarkan hasil

| Hasil | Kesimpulan | Tindakan |
|---|---|---|
| (1) tetap loop, (2) selesai cepat | Kapabilitas model | Ganti default model untuk tugas edit bedah, atau paksa `write` |
| (1) selesai, (2) juga selesai | Konteks warisan + kontrak tool | Perbaiki penandaan turn gagal + `startLine/endLine` + guardrail |
| Keduanya loop | Harness | Prioritaskan failure-streak breaker & preview `changed` |

## 9. Urutan perbaikan yang disarankan

1. **Tandai turn gagal di riwayat** — turn dengan `error` provider atau klaim tanpa bukti diberi penanda agar model berikutnya tidak menganggapnya selesai. (Menutup §6.)
2. **Failure-streak breaker** di `tool_batch.rs` — setelah 3 kegagalan `(tool, file)`, suntik saran konkret: baca rentang, pakai `startLine/endLine`, atau `write`.
3. **Preview menyatakan perubahan** — `changedSinceLastCapture` + warning bila frame sama.
4. **Gate klaim selesai** — anotasi otomatis bila turn punya tool `error`.
5. **Perketat `compareToReference`** — jangan biarkan `false` mematikan perbandingan ketika `ref/` ada.

## 10. Keterbatasan

- Sampel kecil: gemini 3 sesi, kiro 1 sesi, qwen 2 sesi. Angka rate bersifat indikatif, bukan benchmark.
- Jenis tugas berbeda antar sesi; gemini kebanyakan mengedit JS film yang panjang, qwen mengedit file yang lebih kecil — bisa ikut memengaruhi rate.
- `kiro/auto` adalah router, jadi angkanya rata-rata dari model dasar yang tidak diketahui.
- Data diambil dari store sesi (hasil yang tersimpan), bukan telemetri langsung; payload permintaan ke provider tidak tersedia, jadi ukuran konteks per panggilan tidak bisa diukur.
- Timestamp store memakai UTC; mtime file memakai WIB (+7).

## 11. Status verifikasi

- Tidak ada kode yang diubah untuk laporan ini.
- Pengujian yang dilakukan: pembacaan `sessions-store.json` (198 sesi), agregasi status `edit` per model, pembacaan field `model` per pesan, dan pembacaan `engine.log` untuk turn `401` serta durasi turn.
- Pengujian yang tidak dilakukan: uji falsifikasi §8, `cargo test`, dan E2E `scripts/test-edit-tool-e2e.mjs` (butuh engine hidup).
