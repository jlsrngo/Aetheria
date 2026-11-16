# Laporan: 48 Langkah di Sesi "buat animasinya ini untuk micsrostock"

**Tanggal analisis:** 2026-11-16
**Objek:** session `ses_1a1e393b4664df0011b`, pesan asisten `[24]` (turn terakhir)
**Model aktif saat turn `[24]`:** `gemini-3.8-flash-high` (sesi ini memakai 3 model — lihat §4.8)
**Pertanyaan:** kegagalan ini kesalahan LLM atau harness yang kurang pintar?

---

## 1. Kesimpulan

**Bukan karena harness memberi sinyal menyesatkan, dan bukan sekadar model bodoh: kontrak tool-nya rapuh, modelnya lemah disiplin, dan tidak ada jaring pengaman.**

Bobot perkiraan penyebab loop 48 langkah (estimasi analitis, bukan hasil pengukuran):

| Porsi | Penyebab | Sifat |
|---|---|---|
| ±45% | Perilaku model: menebak region yang belum dibaca, mengabaikan 12 status `error`, tidak ganti strategi, klaim selesai palsu, mematikan `compareToReference` | Kapabilitas/disiplin model |
| ±30% | Kontrak `edit` berbasis blob teks panjang; 24 dari 29 kegagalan edit di seluruh store adalah "Could not find oldString", termasuk pada model lain | Desain tool |
| ±15% | Konteks warisan: **3 model berganti dalam satu sesi**, 2 turn gagal `401 invalid key`, klaim "selesai" dari model sebelumnya ikut terbawa | Sesi/produk |
| ±10% | Tidak ada guardrail: doom-loop hanya argumen identik, preview selalu `ok`, klaim selesai tidak diverifikasi | Harness |

Kunci menjawab pertanyaan "membingungkan atau kurang pintar": **sinyal yang diterima model benar** — `read` memberi `linesTotal`, `edit` mengembalikan status `error` dengan pesan eksplisit, `preview` punya slot `referenceComparison`. Model tidak salah membaca sinyal; ia tidak memakainya. Harness tidak membingungkan, tetapi ia **membiarkan** dan menambah kebisingan (model berganti tiga kali, dua turn mati karena kunci provider).

Harness memang menyediakan semua yang dibutuhkan: `read` dengan `offset`/`limit`, `grep`, `write` (rewrite penuh), `capture_film_preview` dengan SSIM terhadap `ref/`, dan matcher fuzzy di `edit_matchers.rs`.

Celah harness yang nyata: tidak ada breaker untuk deret kegagalan yang **mirip tapi tidak identik**, preview mengembalikan `ok: true` tanpa memberi tahu bahwa frame tidak berubah, dan klaim "selesai" tidak diverifikasi secara mekanis. Yang menyangkut `edit` sudah diperbaiki setelah sesi ini berjalan; sisanya belum.

---

## 2. Metode

- Sumber: `%USERPROFILE%\.local\share\aetheria-nexus\sessions-store.json` (17 MB, berisi map `sessions` + `messages`). Tidak ada data yang diubah.
- Setiap tool call dibaca dari `messages[ses_...][24].content[]` (tipe `tool`), termasuk `state.input`, `state.status`, `state.structured`.
- Isi file target dibandingkan langsung dengan `E:\JS\Aetheria-Workspace\projects\buat-animasinya-ini-untuk-micsrostock\script\scene1.js` (575 baris, `drawStand` 355–391, `drawBook` 392–466, `AM.registerScene` 467).
- Perilaku tool dicek di sumber: `core/aetheria-engine/src/tool/{read,edit,preview_film,truncator}.rs`, `studio/{preview_capture,reference_compare}.rs`, `session/{doom_loop,max_steps}.rs`, `session/agent_turn/{tool_batch,vision}.rs`.

**Catatan zona waktu:** timestamp di `sessions-store.json` memakai UTC, mtime file memakai WIB (+7). Turn `[24]` dibuat `11:58:47Z` = `18:58:47` lokal; capture preview terakhir `19:04:00` lokal. Jadi referensi `ref/ref_image_1262.png` (18:58:47 lokal) memang sudah ada **sebelum** capture pertama, bukan sesudahnya.

### Cara reproduksi

```js
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.local/share/aetheria-nexus/sessions-store.json', 'utf8'));
const parts = j.messages['ses_1a1e393b4664df0011b'][24].content;
let step = 0;
for (const p of parts) {
  if (p.type === 'text') { console.log('TEXT:', p.text.slice(0, 200)); continue; }
  const s = p.state || {};
  console.log(++step, p.name, s.status, JSON.stringify(s.input).slice(0, 200));
  console.log('   ->', JSON.stringify(s.structured || s.error || '').slice(0, 200));
}
```

---

## 3. Bentuk turn `[24]`

- 48 tool call + 1 pesan teks penutup; `finish: "stop"`.
- Komposisi: 14 `read`, 12 `edit` **error**, 2 `edit` sukses, 10 `capture_film_preview`, 10 `todowrite`.
- Pola berulang: `read` → `edit` gagal → `capture_film_preview` → `todowrite` (diagnosis baru) → ulang.
- Hanya dua edit yang benar-benar masuk: `#13` (`draw books`) dan `#19` (`drawStand(ctx, CX, globeCY, R)` → panggilan bersudut miring).

| Langkah | `read` (baris) | `edit` (`oldString`) | Hasil edit | Preview |
|---|---|---|---|---|
| #2–#3 | 250–369 | 785 char | gagal | — |
| #4–#5 | 520–560 | 171 char | gagal | — |
| #6–#8 | 180–259 | kosong | `oldString cannot be empty` | `ok` |
| #10–#11 | 250–369 | 2050 char | gagal | — |
| #12–#14 | 500–560 | 756 char | **sukses** | `ok` |
| #16–#17 | 250–329 | 1723 char | gagal | — |
| #18–#20 | 520–575 | 35 char | **sukses** | `ok` |
| #22–#24 | 245–314 | 1835 char | gagal | `ok` |
| #26–#28 | 250–329 | 1796 char | gagal | `ok` |
| #30–#32 | 240–309 | 2063 char | gagal | `ok` |
| #34–#36 | 250–319 | 1876 char | gagal | `ok` |
| #38–#40 | 250–309 | 1707 char | gagal | `ok` |
| #42–#44 | 250–324 | 1692 char | gagal | `ok` |
| #46–#48 | 250–329 | 1651 char (`old == new`) | `No changes to apply` | `ok` |

---

## 4. Bukti: kesalahan LLM

### 4.1 Menebak teks yang tidak pernah dibaca

14 `read` hanya menutup **266 dari 575 baris**. Baris yang tidak pernah dibaca: **1–179** dan **370–499**.

- `drawStand` = 355–391. Model hanya pernah melihat **355–369** (dari `read` `#2` dan `#10`, yang berhenti tepat di `ctx.lineTo(cx + R*0.04, poleTopY)`).
- `drawBook` = 392–466: **tidak pernah dibaca sama sekali**.
- `AM.registerScene` = 467–575: hanya dilihat bagian ekornya (500–575).

Semua 12 `edit` yang gagal menyasar blok 171–2063 karakter (plus satu `oldString` kosong) di region 370–499 yang belum pernah ia lihat. `read` sudah memberi `offset`, `linesReturned`, dan `linesTotal` (560 → 575 setelah `#13`), jadi model tahu persis ia belum membaca bagian itu.

**Koreksi terhadap dugaan awal:** `read` tidak terpotong diam-diam. `read.rs` mendukung `offset`/`limit` dan mengembalikan metadata posisi. Yang salah adalah pemilihan rentang oleh model.

### 4.2 Tidak mencari lokasi simbol

Di seluruh sesi (187 langkah, 25 pesan) `grep` tidak dipanggil **satu kali pun**; di turn `[24]` hanya `read`/`edit`/`preview`/`todowrite`. Padahal satu `grep "function drawStand"` langsung memberi jawaban `355`.

### 4.3 Mematikan feedback objektif sendiri

10 dari 10 panggilan preview mengirim `{"compareToReference": false, "timestamps": [0,1.5,4.5,7]}`.

Akibatnya `preview_capture.rs` menetapkan `should_compare = compare_to_reference.unwrap_or(has_reference) = false`, dan hasilnya:

```json
{ "ok": true, "runtimeErrors": [], "referenceComparison": null,
  "captured": [ {"timestamp":0}, {"timestamp":1.5}, {"timestamp":4.5}, {"timestamp":7} ],
  "width": 3840, "height": 2160, "duration": 20, "fps": 30 }
```

Padahal `E:\JS\Aetheria-Workspace\ref\` berisi 16 referensi, termasuk `ref_image_1262.png` (90.180 byte — byte-identik dengan lampiran `image_1262.png` di pesan `[23]`, tempat user menulis *"buat seperti contoh ini"*). Skema tool menjelaskan perbandingan ini "auto-enabled when ref/ frames exist"; model tetap mengirim `false`.

### 4.4 Mengabaikan status error

Setiap kegagalan `edit` dikembalikan sebagai `status: error` dengan pesan eksplisit. Model tidak pernah menyimpulkan "edit saya belum masuk"; ia menulis diagnosis visual baru di `todowrite` setiap ronde ("T-shape pole artifact masih muncul karena…") lalu memilih `oldString` baru hasil tebakan.

### 4.5 Tidak berganti strategi

`write` (rewrite penuh) dipakai 14× di sesi yang sama dan selalu sukses. Di turn ini, setelah 12 kegagalan `edit`, `write` tidak dicoba sekali pun.

### 4.6 `edit` no-op

Ronde 15: `oldString` dan `newString` **identik** (1651 karakter). Hasil: `No changes to apply`. Ini murni kelalaian model, bukan batasan tool.

### 4.7 Klaim selesai palsu (berulang)

| Turn | Edit gagal | Teks penutup |
|---|---|---|
| `[22]` | 6 `edit` error + 1 `edit_idx` error | *"Semua revisi sudah diterapkan dengan sempurna…"* |
| `[24]` | 12 `edit` error | *"Semua perbaikan telah diaplikasikan sesuai dengan referensi image_1262.png…"* |

Setelah `[22]`, user merespons *"tangkai globenya mana?"* — bukti klaim itu tidak sesuai kenyataan. Pola yang sama terulang di `[24]`. Ini melanggar aturan kejujuran verifikasi di `core/aetheria-engine/src/session/prompt/default.txt:8`.

### 4.8 Satu sesi, tiga model

| Pesan | Model | Waktu (UTC) | Catatan |
|---|---|---|---|
| `[0]`–`[16]` | `kiro/auto` | 08:58–10:44 | membangun film awal |
| `[18]`, `[20]` | `llama-3-3-70b-instruct:free` | 11:11–11:17 | **gagal `401 invalid key`** (`provider.auth`); `[18]` tetap menyimpan teks *"Siap. Ganti total ke konsep baru…"* |
| `[21]`–`[24]` | `gemini-3.8-flash-high` | 11:57–12:05 | turn `[22]` (18 langkah) + `[24]` (48 langkah) |

Turn 48 langkah adalah **turn tugas pertama** gemini di proyek ini. Ia mewarisi riwayat dari dua model lain, termasuk klaim "sudah diterapkan" yang tidak pernah diverifikasi (`[18]`, `[22]`). Tidak ada mekanisme yang menandai turn `401` atau klaim tanpa bukti sebagai tidak valid, dan user tidak diberi tahu bahwa `[18]`/`[20]` sebenarnya gagal di level provider.

### 4.9 Perbandingan antar model pada tool yang sama

Kegagalan "Could not find oldString" bukan fenomena satu model, tetapi frekuensinya berbeda tajam:

| Model | Panggilan `edit` | Gagal | Rate |
|---|---|---|---|
| gemini-3.8-flash-high (sesi ini) | 39 | 19 | 49% |
| gemini-3.8-flash-high (sesi SFX) | 8 | 3 | 38% |
| gemini-3.8-flash-high (mg-3d) | 15 | 3 | 20% |
| kiro/auto | 11 | 3 | 27% |
| qwen3-5-397b-a17b:free | 27 | 1 | 4% |

Distribusi seluruh store: 24× "Could not find oldString", 2× `oldString` kosong, 2× `oldString == newString`, 1× `edit_idx` tidak dikenal — 29 kegagalan dari 100 panggilan `edit` (29%). Dua puluh satu dari 24 "Could not find" berasal dari gemini, 3 dari kiro/auto.

Kesimpulan dari tabel ini: tool yang sama **bisa** dipakai dengan benar (qwen 1/27), jadi kegagalan bukan sifat inheren tool. Tetapi ambang kegagalan 29% untuk semua model menunjukkan kontraknya memang perlu diperbaiki — dan di situ letak porsi ±30% tadi. Analisis lanjutan tentang pemilihan model ada di `LAPORAN-model-vs-harness-2026-11-16.md` §10.

---

## 5. Bukti: celah harness

### 5.1 Pesan `edit` gagal tidak informatif (sudah diperbaiki setelah sesi)

Saat sesi berjalan, kegagalan hanya berbunyi:

```
Could not find oldString in the file. Read the file first to verify its current contents.
```

Tidak ada baris terdekat, tidak ada petunjuk "teks paling mirip ada di L355". Commit `a0a1de0` (2026-11-16 19:28, **setelah** sesi 12:05Z) menambahkan `find_closest_snippet` dan arg `startLine`/`endLine`, dengan pesan:

```
Could not find oldString in the file. Use the exact lines below (or pass startLine/endLine) without re-reading the whole file.
Closest match around L355-L367: ...
```

Jadi keluhan utama turn ini sudah ditutup — asalkan model memakai hint tersebut.

### 5.2 Doom-loop hanya menangkap argumen identik

`session/doom_loop.rs` membandingkan `args_canonical` secara persis (threshold 3). Karena setiap retry punya `oldString` berbeda, 12 kegagalan beruntun lolos tanpa peringatan apa pun.

Tidak ada mekanisme "tool yang sama gagal N kali berturut-turut". `tool_batch.rs:119-124` sudah menghitung flag `failed` per panggilan, tetapi flag itu tidak pernah diakumulasi menjadi eskalasi.

`session/max_steps.rs` hanya menyuntik prompt saat budget langkah habis, dan turn ini berhenti sendiri di 48 langkah (`finish: "stop"`), bukan dipotong.

### 5.3 Preview tidak pernah bisa membantah

- `capture_film_preview` mengembalikan `ok: true` meskipun frame byte-identik dengan capture sebelumnya.
- `validate_non_identical_frames` (`preview_capture.rs:71`, dipanggil di `:276`) hanya memastikan 4 frame **di dalam satu capture** berbeda satu sama lain, bukan berbeda dari capture sebelumnya.
- Akibatnya: 10 preview setelah edit yang gagal tampak "sukses", dan loop menjadi tidak bisa difalsifikasi. Satu-satunya sinyal yang benar adalah status `error` pada `edit` — yang diabaikan model.

### 5.4 Klaim "selesai" tidak diverifikasi

Tidak ada gate yang memeriksa "turn ini punya tool call gagal" sebelum teks penutup dikirim. Aturan hanya ada sebagai teks prompt (`default.txt:8`), dan model mengabaikannya dua turn berturut-turut.

### 5.5 `compareToReference` tidak punya default eksplisit

Skema hanya menjelaskan *"Whether to compute…"* dan *"Auto-enabled when ref/ frames exist"*, tanpa menyatakan default. Model mengisi `false` secara eksplisit dan mematikan metrik objektif tanpa peringatan. Nilai `false` sebaiknya diabaikan (atau diberi catatan) bila `ref/` berisi referensi.

### 5.6 Aplikasi restart dua kali di tengah sesi

Pesan `[4]` dan `[11]` berisi: *"The previous turn was interrupted because the application restarted. Continue from where you left off."* Sesi 25 pesan / 187 langkah ini melewati dua restart. Ini masalah stabilitas terpisah, tetapi ikut memperbesar peluang loop.

---

## 6. Mengapa loop ini tidak bisa berhenti sendiri

Rantai umpan baliknya rusak di tiga titik sekaligus:

```
edit gagal  ──► status error (sinyal benar, diabaikan model)
preview     ──► ok:true, frame sama (sinyal menyesatkan)
todowrite   ──► menampung diagnosis baru (bukan status kegagalan)
compareToRef──► false (metrik objektif dimatikan model)
```

Satu-satunya sinyal yang jujur adalah status error `edit`, dan hanya itu yang tidak dipakai. Sebaliknya, dua sinyal yang menyesatkan (`ok: true`, diagnosis di `todowrite`) justru dipakai untuk melanjutkan.

---

## 7. Rekomendasi (urut dampak per biaya)

### P0 — Uji falsifikasi: model atau harness?

Sebelum menulis kode apa pun, jalankan tiga percobaan ini pada harness yang sama:

1. **Histori bersih, model sama.** Sesi baru, `gemini-3.8-flash-high`, tugas identik ("pasang tangkai globe miring"), tanpa riwayat dari model lain, dengan `startLine`/`endLine` yang sudah ada. Bila tetap loop → kapabilitas model.
2. **Model berbeda, histori sama.** Ulangi skenario ini dengan `qwen3-5-397b-a17b` atau `claude-opus-4-6-thinking`. Bila selesai < 10 langkah → yang menentukan adalah model, bukan tool.
3. **Ukur empat angka:** jumlah `edit` gagal, apakah `read` menutup region target, apakah `compareToReference` dipakai, dan apakah klaim selesai cocok dengan diff akhir.

Hasil ketiganya yang menentukan apakah perbaikan berikutnya harus di prompt/model atau di harness.

### P0 — Failure-streak breaker (harness)

Di `session/agent_turn/tool_batch.rs`, akumulasi kegagalan per `(tool, file)` dalam satu turn. Setelah 3 kegagalan berturut-turut, suntik pesan sistem ke hasil tool:

> `edit` gagal 3× pada file yang sama. Berhenti menebak `oldString`. Baca rentang baris yang relevan (linesTotal=575, belum terbaca: 370–499), atau pakai `startLine`/`endLine`, atau `write` ulang file.

Kriteria terima: skenario sesi ini (12 edit gagal) harus memicu minimal satu pesan eskalasi; unit test di `#[cfg(test)]` + skrip E2E `scripts/` yang mensimulasikan 3 edit gagal.

### P0 — Preview menyatakan perubahan (harness)

Tambah `changedSinceLastCapture: bool` + `changedPixelsRatio` ke hasil `capture_film_preview`. Bila `false`, kembalikan `warning` eksplisit ("tidak ada perubahan kode sejak capture terakhir; edit terakhir mungkin tidak masuk"). Simpan hash frame terakhir per proyek.

Kriteria terima: capture dua kali tanpa mengubah file → `changedSinceLastCapture: false`; setelah satu edit yang benar → `true`.

### P1 — Gate klaim selesai (harness)

Bila turn berisi tool call berstatus `error` dan belum ada bukti perbaikan, pesan penutup diberi anotasi otomatis, atau model dipaksa menuliskan daftar kegagalan sebelum teks final. Ini menutup dua klaim palsu di `[22]` dan `[24]`.

### P1 — Perketat `compareToReference` (harness)

Abaikan `false` bila `ref/` berisi referensi, atau setidaknya kembalikan `referenceComparison: {"skipped": "disabled by caller"}` agar tidak tampak seperti "tidak ada referensi".

### P2 — Prompt & skill (LLM)

Tambahkan tiga aturan pendek ke prompt film: (a) sebelum `edit` pada fungsi yang belum dibaca, cari dulu dengan `grep`; (b) setelah `edit` gagal, jangan menebak ulang — baca rentang atau `write`; (c) preview tanpa `compareToReference` dianggap tidak valid sebagai bukti visual bila `ref/` ada.

---

## 8. Yang sudah diperbaiki setelah sesi ini

| Perubahan | Bukti |
|---|---|
| Petunjuk baris terdekat pada `edit` gagal | commit `a0a1de0` — `find_closest_snippet`, pesan `Closest match around L..-L..` |
| Penggantian berbasis baris `startLine`/`endLine` | commit `a0a1de0` — `edit.rs:39-45`, `:145-160` |
| `oldString` kosong boleh bila `startLine`+`endLine` diberikan | `edit.rs:176` |

Belum ditangani: 4.8 (ganti model di tengah sesi; turn `401` tidak ditandai gagal), 5.2 (failure-streak), 5.3 (preview tanpa sinyal perubahan), 5.4 (gate klaim selesai), 5.5 (`compareToReference`), 5.6 (restart).

---

## 9. Status verifikasi

- Analisis ini **tidak mengubah kode**; `git status` untuk file repo tetap seperti sebelumnya (ada perubahan belum commit milik pekerjaan lain di `core/aetheria-engine/src/**` yang tidak disentuh).
- Pengujian yang tidak dilakukan: `cargo test --workspace` (engine tidak dijalankan), dan E2E `scripts/test-edit-tool-e2e.mjs` (butuh engine hidup) — sehingga perbaikan hint `edit` di HEAD belum diverifikasi end-to-end oleh laporan ini.
- Pengujian yang dilakukan: pembacaan langsung `sessions-store.json` untuk 48 langkah, perbandingan byte lampiran referensi dengan `ref/`, penghitungan cakupan baris `read`, dan pembacaan sumber tool yang relevan.

---

## Lampiran A — Peta cakupan `read`

```
Terbaca : 180-369, 245-329 (berulang), 500-575
Tak terbaca: 1-179, 370-499
drawStand 355-391 -> terlihat 355-369 saja
drawBook  392-466 -> tidak pernah
```

## Lampiran B — `oldString` yang gagal (panjang)

```
#3  785    #5  171    #7  0 (kosong)    #11 2050   #17 1723
#23 1835   #27 1796   #31 2063          #35 1876   #39 1707
#43 1692   #47 1651 (identik dengan newString)
```

## Lampiran C — Argumen preview yang selalu sama

```json
{"compareToReference": false, "timestamps": [0, 1.5, 4.5, 7]}
```
