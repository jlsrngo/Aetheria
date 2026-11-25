# AGENTS.md

Aturan untuk agent AI (dan manusia) yang mengubah repo ini. Isinya sudah dicocokkan dengan kode di repo. Jika sebuah aturan bertabrakan dengan kenyataan di kode, **berhenti dan laporkan** — jangan memilih diam-diam dan jangan mengarang isi file yang tidak ada.

---

## 1. Konteks Proyek

* **Target:** aplikasi desktop Windows (`.exe` / `.msi`) — Tauri v2 + Rust + React + mesin motion HTML5/JS modular.
* **Prioritas:** TikTok-first (P0); render lokal tanpa biaya cloud (headless browser CDP murni-Rust + FFmpeg); stok video; penjadwalan; analitik akun (views, likes, followers).
* **Peta repo:** `apps/` (React + Vite), `core/aetheria-engine/` (engine Rust), `core/ref_extractor/` (ekstraktor AST & pembanding visual Python), `src-tauri/` (shell Tauri), `scripts/` (dev/smoke/bundle & skrip E2E harness `test-f1..f6`, `test-showreel-eval-e2e.mjs`), `benchmarks/` (arsip acuan kebenaran / ground-truth kualitas motion), `.aetheria/skills/` (skill motion untuk Studio), `.aetheria/reference/` (`AM_API.md` kontrak tunggal runtime `window.AM`), `e2e/` (suite Playwright E2E), [`docs/backlog-integrasi-sosial-dan-akun.md`](docs/backlog-integrasi-sosial-dan-akun.md) (backlog fitur sosial/akun yang ditunda).
* **Rujukan UI:** [`apps/design.md`](apps/design.md) untuk visual UI (bila berbeda dengan variabel di `apps/src/index.css`, yang berlaku adalah kode yang berjalan; laporkan selisihnya). `bash` dan `codemode` tetap aktif di agent harness dengan guard anti-eksfiltrasi kredensial/SSRF dan isolasi scratch per sesi.
* **Acuan kebenaran motion (ground-truth benchmark):** [`benchmarks/labs-showreel-ground-truth/`](benchmarks/labs-showreel-ground-truth/) menyimpan acuan kebenaran remake manual dari referensi TikTok `@ngorzc` (`labs-showreel-remake.mp4` 1024×576 30fps 25.867s, `film.json`, `script/scene1.js`–`scene8.js` 1.618 baris, [`GROUND_TRUTH_FORENSICS.md`](benchmarks/labs-showreel-ground-truth/GROUND_TRUTH_FORENSICS.md), dan baseline skor `compare_result.json` = `0.8123` legacy 19-frame, `compare_result_8mid.json` = `0.8220` 8-mid, `compare_result_v2_fg.json` = `0.7822` metrik foreground-ROI). **Cara pakai:** gunakan hanya sebagai standar kualitas craft (detail vektor, timing sub-beat, tipografi, transisi) dan baseline regresi offline saat menguji perubahan pada `core/ref_extractor/`, `window.AM`, atau agent harness — **dilarang** menyertakan/memuat asset atau kode benchmark ini secara statis ke dalam engine maupun menyalin/memutarnya langsung saat agen menghasilkan proyek pengguna (patuh pada isolasi §4 dan anti-cheat `fidelity_guard.rs`).

---

## 2. Prinsip Kerja

Disarikan dari pengamatan Andrej Karpathy tentang kesalahan umum LLM saat menulis kode. Untuk tugas sepele, gunakan penilaian wajar.

**Pikir dulu.** Nyatakan asumsi. Jika ada beberapa tafsir, paparkan — jangan pilih diam-diam. Sebut solusi yang lebih sederhana bila ada. Bila ada yang ambigu atau bertentangan dengan setup yang ada, berhenti dan tanya.

**Sederhana dulu.** Kode minimum yang menyelesaikan masalah. Tanpa fitur yang tidak diminta, abstraksi spekulatif, konfigurasi berlebih, atau penanganan kasus yang mustahil terjadi. Jika 200 baris bisa jadi 50, tulis ulang.

**Perubahan bedah.** Sentuh hanya yang perlu. Jangan refactor kode yang jalan dan tak terkait; jangan ubah format/komentar di sekitarnya; ikuti gaya yang ada. Bersihkan hanya yatim-piatu yang *kamu* buat (import/variabel/fungsi yang jadi tak terpakai karena perubahanmu). Kode mati atau `any` warisan yang tak terkait: laporkan, jangan hapus.
> Tes: setiap baris diff harus bisa ditelusuri ke permintaan.

**Berorientasi tujuan.** Ubah tugas samar menjadi kriteria yang bisa diverifikasi: "perbaiki bug" → reproduksi dulu, lalu buktikan sudah hilang tanpa regresi; "refactor X" → tes lulus sebelum dan sesudah. Untuk tugas bertahap, tulis rencana ringkas `langkah -> verifikasi`, dan sertakan skenario E2E-nya (lihat 3.3).

---

## 3. Definisi Selesai (Definition of Done)

Repo ini **tidak punya CI** (`.github/` ada di `.gitignore`), jadi gate di bawah adalah satu-satunya pemeriksaan. Jalankan dari root repo. Sebuah tugas baru boleh disebut selesai bila **3.1, 3.2, 3.3, dan 3.4 semuanya terpenuhi**.

### 3.1 Gate statis & unit — wajib, semua harus lulus

```bash
npm run typecheck             # tsc -b apps/tsconfig.json (strict)
npm run build                 # tsc --noEmit + vite build
(cd apps && npx vitest run)   # suite frontend (26 file / 103 tes termasuk skill-lint & paritas AM_API di apps/src/lib/motionHarnessSpec.test.ts)
```

`npm run verify` **bukan** bukti yang cukup: ia tidak menjalankan Vitest, dan `test:smoke` di dalamnya butuh engine yang sedang hidup.

### 3.2 Gate bersyarat

| Bila perubahan menyentuh | Wajib | Jika tidak bisa dijalankan |
|---|---|---|
| `core/` atau `src-tauri/` | `cargo test --workspace` | Tulis "Rust tidak terverifikasi: <alasan>". Dilarang menyatakan selesai untuk Rust yang tidak pernah dikompilasi. |
| dependensi (`package.json`, `Cargo.toml`) | lockfile (`package-lock.json` / `Cargo.lock`) ikut berubah; lisensi dependensi kompatibel dengan GPL-3.0-or-later | — |

Catatan lingkungan: target resmi adalah Windows. Di Linux, `cargo test` gagal bila paket dev GTK3 dan WebKitGTK tidak terpasang (dibutuhkan `wry`/`tao`).

### 3.3 Testing E2E — wajib untuk SETIAP tugas

**E2E** berarti menjalankan alur yang dipakai pengguna melewati lapisan nyata (UI → engine HTTP → hasil), **tanpa mock pada lapisan yang kamu ubah**. Typecheck, build, dan Vitest tidak menggantikan E2E.

**Pilih level sesuai area yang diubah:**

| Area yang diubah | E2E yang wajib | Alat |
|---|---|---|
| `core/` (session, provider, knowledge, studio/render) | Skenario API terhadap engine yang hidup | Pola `scripts/test-knowledge-e2e.ts`; `npm run test:knowledge` / `npm run test:smoke` bila relevan |
| `apps/src/` | Skenario browser terhadap `npm run dev:web` + engine hidup | Playwright (`@playwright/test` sudah terpasang) |
| `src-tauri/` / shell desktop | Jalankan aplikasi (`npm run tauri:dev`) dan lakukan skenario nyata | Manual di Windows |
| Lintas lapisan | Semua level yang tersentuh | — |
| Tidak mengubah perilaku runtime (dokumen, komentar) | Tulis `E2E: tidak berlaku — <alasan>` | — |

**Ceklis — Sebelum coding**

- [ ] Tulis skenario E2E 1–3 langkah (aksi pengguna → hasil yang terlihat/terukur) di rencana `langkah -> verifikasi`.
- [ ] Siapkan data uji di direktori sementara (`os.tmpdir()`), bukan folder `workspace/` bawaan dan bukan data pengguna.

**Ceklis — Menjalankan**

- [ ] Engine hidup dan sehat: `GET /api/health` mengembalikan `healthy: true`.
- [ ] Engine/Vite dijalankan **ulang setelah** kodemu berubah (melalui build dev incremental `npm run build:engine`); skenario berjalan pada build yang berisi perubahanmu, bukan proses lama.
- [ ] Jalur sukses lulus.
- [ ] Minimal satu jalur gagal berperilaku semestinya (input tidak valid, engine mati, atau error provider): pesan error jelas, tidak crash, jendela tidak reload.
- [ ] Bug fix: skenario **gagal** di kode lama, **lulus** di kode baru.
- [ ] Tidak ada error baru di console browser maupun log engine selama skenario.

**Ceklis — Setelah**

- [ ] Skenario disimpan sebagai tes yang bisa diulang (skrip di `scripts/` untuk API, spec Playwright untuk UI), bukan hanya klik manual.
- [ ] Tes itu dijalankan dua kali berturut-turut dari keadaan bersih dan lulus keduanya (mencegah tes flaky).
- [ ] Data uji dibersihkan (direktori sementara, session).
- [ ] Laporan memuat perintah, hasil, dan commit yang diuji.

**Panduan Build: Debug Harian vs Rilis Penuh (wajib dipatuhi agent)**

`Cargo.toml` mengatur `[profile.release]` dengan `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`, dan `strip = true` (~18 menit build/link). Gunakan jalur yang tepat sesuai tujuannya:

| Kebutuhan | Perintah | Mode & Kapan Dipakai |
|---|---|---|
| Compile & tes harian engine (`core/`) | `npm run build:engine` / `npm run dev:engine` / `npm run check:rs` (atau `npm run dev:desktop` / `npm run dev:app`) | **Debug incremental (`~4.6 detik` setelah cache dependensi)**. Pakai ini untuk iterasi coding, bugfix, dan tes API/Playwright (`e2e/live-stack.mjs` otomatis memilih biner terbaru di `target/debug` atau `target/release`). |
| Verifikasi desktop Tauri harian (`src-tauri/` + UI) | `npm run tauri:dev` | **Debug + Vite HMR (`devUrl`)**. Menjalankan shell desktop Tauri mode debug tanpa full release link maupun re-embed `apps/dist`. |
| Full rilis / `.exe` portable & installer | `npm run bundle:prepare` (atau `npm run tauri:build`, `npm run start`) | **Release penuh (`--release`, LTO `thin`, `codegen-units = 1`)**. Hanya dijalankan untuk `tauri:build`, `bundle:prepare`, dan pengukuran performa. |

* **Aturan keras agent:** Dilarang memakai `--release` untuk dev/E2E (`npm run bundle:prepare`, `npm run tauri:build`, `npm run start`, atau `cargo build/run --release`). Jalur release hanya boleh dijalankan untuk `tauri:build`, `bundle:prepare`, dan pengukuran performa saat diminta eksplisit.

**Catatan engine & lingkungan**

* Untuk dev dan skenario E2E, bangun biner dev incremental dengan `npm run build:engine`, lalu jalankan engine dev (`npm run dev:engine`, `npm run dev:desktop`, atau `npm run dev:app`) dan jalankan skenario E2E. Dilarang memakai `--release` untuk dev/E2E; release hanya untuk `tauri:build`, `bundle:prepare`, dan pengukuran performa. Autentikasi memakai Basic auth; kredensial ada di `~/.aetheria/dev-server-password` (format `user:password`).
* **Port dev di repo:** `scripts/dev-app.cjs` memakai `:4096`, sedangkan proxy Vite, default `test:smoke`, dan `scripts/test-knowledge-e2e.ts` memakai `:4196` (mengikuti port `AETHERIA_HEALTH` bila diset). Set `AETHERIA_HEALTH` dan `AETHERIA_API` bila engine tidak di `:4196`.
* `test:knowledge` dan `test:smoke` memanggil model sungguhan (`AETHERIA_TEST_PROVIDER`, `AETHERIA_TEST_MODEL`). Tanpa kredensial provider, statusnya **Terblokir**, bukan lulus.
* **Suite Playwright (`playwright.config.ts` & `e2e/`):** konfigurasi Playwright, helper live stack (`e2e/live-stack.mjs`), spec `e2e/*.spec.ts`, dan Chromium sudah terpasang. Jalankan tes UI dengan `npx playwright test e2e/<spec>.spec.ts`.
* E2E butuh engine nyata, yang target resminya Windows. Agent yang tidak bisa menghidupkan engine **tidak boleh** menulis "Selesai"; pakai "Selesai sebagian" atau "Terblokir".

### 3.4 Kebersihan diff

- [ ] Setiap baris diff terlacak ke permintaan.
- [ ] Tidak ada `any`, `@ts-ignore`, atau `@ts-expect-error` baru.
- [ ] Tidak ada tes yang di-skip, dihapus, atau dilonggarkan demi lulus.
- [ ] Tidak menambah `--release` pada skrip dev/E2E.
- [ ] Tidak ada secret, `.env`, kredensial, `dist/`, atau `target/` yang ikut ter-commit.
- [ ] Tidak menjalankan `cargo fmt --all`: saat aturan ini ditulis, ±167 file belum sesuai rustfmt, sehingga hasilnya diff raksasa. Ikuti gaya file di sekitar.
- [ ] Gate gagal karena kode lama? Buktikan dengan menjalankannya pada commit sebelum perubahanmu, laporkan, dan jangan memperbaikinya diam-diam di luar scope.
- [ ] Perubahan UI sudah dilihat langsung di setiap tema yang didefinisikan `apps/src/index.css`, termasuk state kosong/error. Bila UI tidak bisa dibuka, tulis "UI tidak dilihat langsung".

### 3.5 Laporan penutup (format wajib)

```
Status: Selesai | Selesai sebagian | Terblokir
Berubah: <1–2 kalimat>
Diverifikasi: <perintah -> hasil>
E2E: <skenario -> hasil, commit yang diuji> | tidak berlaku — <alasan>
Tidak diverifikasi: <apa + alasannya> | tidak ada
Temuan di luar scope: <jika ada>
```

"Selesai" hanya boleh dipakai bila gate 3.1 lulus, gate bersyarat 3.2 yang relevan lulus, E2E 3.3 lulus (atau sah dinyatakan tidak berlaku), dan semua yang diminta terpenuhi. Selain itu pakai "Selesai sebagian" atau "Terblokir", dan tulis apa yang belum terverifikasi beserta alasannya.

---

## 4. Isolasi Workspace (aturan utama)

Engine dan UI IDE wajib sepenuhnya terisolasi dari folder proyek pengguna (`workspace/`, tidak di-track git). Error di folder proyek tidak boleh mematahkan build/runtime IDE.

* Setiap I/O terhadap proyek pengguna wajib lewat path guard: `contains_path` (`core/aetheria-engine/src/paths.rs`) dan `resolve_isolated_path` (`core/aetheria-engine/src/tool/path_guard.rs`).
* Jangan bergantung pada folder `workspace/` bawaan repo, dan jangan memuat asset/kode proyek secara statis saat kompilasi engine.

---

## 5. Aturan Kode: Modular, React, dan Rust

### 5.1 Aturan modular (semua bahasa)

1. **1 modul = 1 alasan untuk berubah.** Nama file menyebut tanggung jawabnya (`motion_linter.rs`, `useMotionPlayback.ts`). Jangan mencampur I/O, logika domain, dan presentasi dalam satu modul.
2. **Fitur baru = modul baru + sambungan tipis**, bukan menumpuk baris ke file besar. Pemicu tinjau (bukan batas keras): file baru atau yang kamu ubah melewati ±400 baris (TS/TSX) atau ±500 baris (Rust) → tulis alasan kohesinya di laporan, atau pecah. File yang sudah >600 baris (saat ini 14 file TS, mis. `useWorkstationChat.ts` 1.737 baris dan `AnalyticsPage.tsx` 1.058 baris): jangan menambah fitur baru langsung ke dalamnya; taruh di modul baru lalu impor. Jangan memecah file lama kecuali memang itu tugasnya.
3. **Arah dependensi satu arah, tanpa siklus.** Frontend: `pages`/`components` → `hooks` → `lib`/`types` (saat ini `lib/` tidak mengimpor `components/`; jaga). Rust: handler/command → service domain → util. Modul domain tidak mengimpor handler atau UI.
4. **Pakai ulang sebelum menulis.** Cari util yang sudah ada (`lib/utils.ts`, `lib/api.ts`, `paths.rs`) sebelum membuat yang baru. Salinan ganda dari logika yang sama pernah merusak banyak titik panggil sekaligus (lihat komentar di `apps/src/lib/engine.ts`).
5. **Permukaan publik sekecil mungkin.** TS: `export` hanya yang dipakai modul lain. Rust: mulai dari privat, lalu `pub(crate)`; `pub` hanya bila dipakai crate lain.
6. Komentar menjelaskan *mengapa*, bukan *apa*.

### 5.2 Frontend — best practice React (`apps/src/`)

Stack: React 19, Vite, Tailwind 4, TanStack Query, TypeScript strict (`apps/tsconfig.json`). Repo **tidak punya ESLint**, jadi aturan hooks tidak ditegakkan alat — periksa sendiri.

**Struktur & tanggung jawab**

1. 1 komponen/hook = 1 tanggung jawab kohesif. Pecah bila mencampur lebih dari satu concern atau UI berat dengan efek samping; jangan memecah komponen kohesif hanya karena panjang.
2. Folder yang ada: `components/ui` (primitif), `components/layout`, `components/studio` (`HtmlMotionPlayer`, `HtmlFilmStage`, `SceneAudioSync`, `panels/`), `components/workstation`, `components/common`, `hooks/`, `lib/`, `pages/`, `types/`. Domain stok/jadwal/analitik belum punya folder komponen sendiri; buat saat fiturnya dikerjakan.
3. Komponen presentational hanya menerima props + callback dan tidak memegang state orkestrasi. Logika murni (transformasi data, builder URL, kalkulasi koordinat/layer) di modul `.ts` terpisah agar bisa dites tanpa render DOM.
4. Tipe eksplisit untuk props, state, payload event, dan respons API. Tipe lintas fitur di `apps/src/types/`; tipe lokal boleh berdampingan dengan modulnya. Pakai `import type` untuk impor tipe saja. Impor memakai path relatif (tidak ada alias `@/`).
5. `any`: jangan menambah yang baru. Repo punya ±177 pemakaian warisan; kurangi hanya pada file yang memang sedang kamu ubah karena tugasnya.

**Render, state, dan efek**

6. Render itu murni: tanpa efek samping atau mutasi saat render. Turunkan nilai saat render; jangan menyalinnya ke state lewat `useEffect`.
7. `useEffect` hanya untuk sinkronisasi dengan sistem luar (DOM API, timer, listener keyboard/window, `requestAnimationFrame`, `ResizeObserver`, jaringan), dengan dependency lengkap dan fungsi cleanup. Efek yang panjang ditarik ke hook terfokus di `apps/src/hooks/` (contoh: `useMotionPlayback.ts`).
8. State lokal dulu (`useState`); naikkan hanya seperlunya. State lintas-komponen memakai store berbasis `useSyncExternalStore` di `apps/src/hooks/` (pola `useStudioStore.ts`, `useScheduleStore.ts`). Jangan menambah Context atau library state baru tanpa persetujuan.
9. Data dari engine yang perlu di-cache/di-refetch: pakai TanStack Query (`QueryClient` sudah dikonfigurasi di `App.tsx`), jangan menulis cache manual di `useEffect`. Pola yang ada beragam (hook + `apiFetch`, store); jangan memakai dua mekanisme untuk data yang sama.
10. **Semua panggilan ke engine lewat `apiFetch` (`lib/api.ts`) atau adapter `lib/engine.ts`.** `fetch()` langsung kehilangan kredensial Basic auth dan base URL.
11. Daftar dinamis memakai `key` stabil dari ID data, bukan index (ada 11 pemakaian index warisan; jangan menambah).

**Performa**

12. Jangan memakai `memo`/`useMemo`/`useCallback` secara refleks. Pakai bila ada alasan: referensi stabil untuk dependency effect atau props anak ber-`memo`, atau perhitungan mahal yang terukur.
13. Halaman atau panel berat baru → `lazy()` + `Suspense` (pola `components/layout/AppLayout.tsx`, `components/workstation/tabs/CenterTabRenderer.tsx`). Chunk utama sudah ±869 kB (peringatan build): dependensi besar baru dimuat lazy atau dimasukkan ke `manualChunks` di `apps/vite.config.ts`.

**UI, aksesibilitas, keamanan**

14. Pakai primitif `components/ui/` (`Button`, `Card`, `Badge`, `Input`, `Textarea`, `Dialog`) sebelum membuat elemen baru; varian lewat `cva`, penggabungan class lewat `cn` (`lib/utils.ts`). Visual mengikuti bagian 6.
15. Elemen interaktif memakai `<button>`/`<a>`/`<input>`, bukan `<div onClick>`; tombol ikon-saja (lucide-react) wajib `aria-label`; fokus keyboard tetap terlihat.
16. Komponen baru tidak memakai `forwardRef` (React 19: `ref` sebagai prop). Pemakaian warisan dibiarkan.
17. Tanpa `dangerouslySetInnerHTML` (saat ini 0). HTML/JS milik proyek pengguna hanya dirender di area stage yang dibungkus `ErrorBoundary` (`components/common/ErrorBoundary.tsx`, dipakai di `StudioPreview` dan `HtmlMotionPlayer`); error-nya tidak boleh menjalar ke luar stage.

**Tes**

18. Logika murni → Vitest `*.test.ts` berdampingan dengan modulnya. Belum ada tes komponen (`.test.tsx` = 0; `@testing-library` terpasang tanpa pola). Perilaku komponen diverifikasi lewat E2E (3.3); jangan membangun infrastruktur tes komponen tanpa diminta.

### 5.3 Engine Rust (`core/aetheria-engine/` & `src-tauri/`)

Stack: Rust edition 2021, `axum` 0.7, `tokio` (full), `reqwest` (rustls), `serde`; jendela via `tao`/`wry`; shell Tauri v2 di `src-tauri/`. Rute berparameter memakai sintaks axum 0.7 (`/:id`), bukan `{id}`.

**Struktur**

1. **1 file = 1 tanggung jawab kohesif** (kohesi, bukan batas baris; file panjang boleh bila satu domain utuh beserta tesnya). Contoh pemisahan di `core/aetheria-engine/src/studio/`: `motion_linter.rs` (linter) terpisah dari `film_inspector.rs` (inspektor scene), `film_static_server.rs` (static HTTP), `ffmpeg_pipeline.rs` (pipeline FFmpeg), `html_renderer.rs` (orkestrator browser CDP); serta pada lapisan harness: `tool/film_audio.rs` (sintesis audio + parser durasi WAV RIFF + validator durasi scene), `tool/profiles.rs` (allowlist tool berbasis peran), `tool/film_state.rs` (status progres scene berbasis disk & validasi completion gate), `tool/edit.rs` (guard `oldString` >25 baris tanpa range), dan `session/agent_turn/dynamic_context.rs` (filter relevansi & cap blok dinamis).
2. **Baseline konteks harness (terukur `scripts/measure-harness-context.mjs`, formula kasar `ceil(chars/4)`):** Baseline F0 (`7861f99`) pada `default.txt` = `19,482` chr (`~4,871` tok), definisi tool koordinator default = `28` tool (`33,078` chr), `qa-verifier` = `29` tool (`37,100` chr), `mg-soft-clay-story/SKILL.md` = `12,199` chr, blok dinamis `E:\JS\Aetheria-Workspace` = `5,073` chr; setelah F1–F6 (`52892f1`), `default.txt` = `16,741` chr, `profile:director` = `10` tool (`16,442` chr), `motion-designer` = `8` tool (`10,951` chr), `qa-verifier` = `7` tool (`10,050` chr), `mg-soft-clay-story/SKILL.md` = `8,955` chr, blok dinamis video unstyled = `2,027` chr (explicit skill = `715` chr, non-video = `427` chr, greeting = `0` chr).
2. **Handler tipis, service kohesif.** Handler Axum dan command Tauri (`src-tauri/src/*_cmds.rs`: `cli_auth_cmds`, `studio_cmds`, `window_cmds`) hanya memvalidasi input, mendelegasikan ke modul domain, lalu memformat respons. Logika domain tetap di engine, bukan di `src-tauri/`. Jangan mencampur handler dengan parser/linter, peluncur subprocess, atau protocol client dalam satu file.
3. **Fungsi ramping.** Ekstrak helper privat saat sebuah fungsi menyentuh beberapa langkah I/O atau level abstraksi; jangan memecah file hanya karena panjang.
4. Ikuti konvensi folder yang ada (15 folder memakai `mod.rs`, selebihnya file bernama); jangan mengubah gaya modul sebuah folder di luar tugas.

**Error & keamanan**

5. Fungsi yang bisa gagal mengembalikan `Result`. Pola yang ada: `Result<T, String>` (±44 tempat); ikuti di modul yang sudah memakainya. Pesan error menyebut apa yang gagal beserta konteksnya (path/ID). Jangan menambah `anyhow`/`thiserror` tanpa persetujuan.
6. Tidak ada `unwrap()`/`expect()`/`panic!` di jalur input pengguna, I/O, parsing, atau jaringan. File tanpa blok test saat ini hanya punya 4 `unwrap()`; jaga. Menelan error (`let _ =`) hanya untuk upaya best-effort yang disengaja, dengan komentar.
7. Semua endpoint HTTP berada di balik middleware CORS + Basic auth (`http_guard.rs`, `cors_and_auth_middleware`); endpoint baru tidak boleh melewatinya. Jangan mencetak secret/token/API key/password ke log (lihat `cred_store/`).
8. I/O ke proyek pengguna lewat path guard (bagian 4).
9. `unsafe` hanya bila perlu (FFI/Windows API; ±7 blok sekarang). Setiap blok baru wajib berkomentar `// SAFETY:` yang menyebut invarian yang dijaga.
10. Jangan menambah `#[allow(...)]` / `#![allow(...)]` baru tanpa komentar alasan (warisan: `aetheria/memory.rs`, `permission/mod.rs`). Tidak ada konfigurasi clippy/rustfmt di repo; clippy bukan gate.

**Async & kontrak API**

11. Jangan memblokir runtime tokio: I/O file besar, CPU berat, atau subprocess sinkron di dalam handler async dipindah ke `tokio::fs`, `tokio::process`, atau `tokio::task::spawn_blocking` (pola yang sudah dipakai). Ada ±300 pemakaian `std::fs` warisan; jangan menambah di jalur async.
12. Jangan menahan guard `std::sync::Mutex` melewati `.await`; bila lock harus melintasi `.await`, pakai `tokio::sync::Mutex`. Task `tokio::spawn` yang berumur panjang punya jalur berhenti dan tidak membuang error diam-diam.
13. **Kontrak ke frontend:** JSON memakai `camelCase` (`#[serde(rename_all = "camelCase")]`, ±38 pemakaian) dan respons dibungkus `{ "data": ... }` (pola dominan); ikuti handler di sekitarnya. Mengubah bentuk respons berarti mengubah `apps/src/types/` dan `apps/src/lib/engine.ts` pada tugas yang sama, plus menjalankan E2E (3.3).
14. Log memakai `println!`/`eprintln!` (belum ada crate logging); jangan menambah `tracing`/`log` tanpa persetujuan.

**Tes**

15. Tes unit di `#[cfg(test)]` pada file yang sama (±59 modul); `#[tokio::test]` untuk kode async. Tes tidak menyentuh folder `workspace/` bawaan atau home pengguna; pakai direktori sementara. Perilaku end-to-end: bagian 3.3.

---

## 6. Sistem Desain UI

Rujukan visual: aplikasi Aetheria Agent. Semua komponen UI **wajib** memakai variabel CSS dari `apps/src/index.css`, bukan nilai literal.

1. **Sudut:** panel/kontainer `--radius-panel` (12px); kartu/bubble/baris file `--radius-card` (10px); tombol/input/ikon `--radius-control` (8px); nav/chip/badge `--radius-pill` (999px). Sudut 0° hanya untuk elemen yang menempel penuh ke tepi jendela.
2. **Warna:** `--bg-app`, `--bg-panel`, `--bg-card`, `--border-color`, `--text-primary`, `--text-secondary`. **Dilarang hex literal baru** — nilainya berbeda per tema. **Emerald/hijau diblokir 100%** di seluruh UI aplikasi: dilarang memakai kelas `emerald-*` / `green-*`, token bernama `emerald`, maupun hex hijau (`#10B981`, `#34D399`, `#059669`, `#22c55e`, dst.), termasuk sebagai aksen status "aktif". Aksen fungsional yang diizinkan: putih/netral untuk aktif/selesai, amber untuk proses berjalan/peringatan, rose untuk rekam/render/error.
3. **Border & bayangan:** pemisah modul 1px `--border-color`, bukan garis putih kontras. Shadow hanya untuk elemen mengambang (nav pill, dropdown, modal).
4. **Tipografi:** Inter untuk label, judul, isi, dan tombol. Monospace hanya untuk angka dan kode (ukuran file, frame, FPS, timestamp). Label kecil boleh all-caps + `tracking-wide`, tidak wajib.
5. **Layout & ketahanan:** layout 4 panel — Activity rail (selalu terlihat) | Explorer | Stage + Timeline | Chat. Navigasi bawah berupa pill mengambang, bukan footer full-width. Kegagalan preview hanya boleh me-remount area player; dilarang mereload seluruh window.

---

## 7. Standar Paket Skill Motion (`.aetheria/skills/mg-*`)

Setiap skill di `.aetheria/skills/mg-*` wajib mematuhi struktur paket standar berikut (diverifikasi oleh `motionHarnessSpec.test.ts` & `story_camera_lint.rs`):

```
.aetheria/skills/mg-<slug>/
  SKILL.md                     # Panduan utama <= 150 baris (Bahasa Inggris, tanpa boilerplate terlarang)
  tokens.json                  # Palet hex, tipografi, timing/motion tokens
  assets/                      # Aset visual render nyata (bukan placeholder)
    character-gallery.png      # (atau visual-gallery.png untuk skill non-karakter)
    qc-sheet-example.jpg       # Contoh lembar Self-QC 3 frame/shot (start, mid, end)
  references/
    camera.md                  # Panduan kamera, safe zone, pemicu kata ("word"), & Self-QC
  examples/
    kit.json                   # Manifes kit deklaratif (wajib untuk generic story kits)
    story.example.json         # Contoh kanonik 1080x1920 (9:16) dengan cameraStyle/camera aktif
    story.html                 # Harness pratinjau/render lokal 1080x1920
    script/                    # Runtime JS yang di-seed otomatis ke proyek (story-runtime.js + kit)
```

Aturan wajib isi & visual skill:
1. **100% Bahasa Inggris** untuk nama file, identifier kode, enum skema, label/badge aset visual, dokumentasi `SKILL.md`/`references/*.md`, dan copy `story.example.json` (kecuali ID tes internal yang menjaga kompatibilitas E2E).
2. **Portrait 9:16 (`1080x1920`) sebagai kanvas bawaan** pada setiap `story.example.json` & `story.html` (16:9 `1920x1080` tetap didukung sebagai opsi deklaratif).
3. **Kamera aktif & craft tinggi (anti kaku/murahan):** setiap contoh skill wajib mengaktifkan `StoryCamera` (`cameraStyle` + `seed` atau `camera.initial` + `camera.moves[]`) dan menghindari layout datar murahan (gunakan layer kedalaman, pencahayaan/gradien terarah, serta komposisi safe-zone TikTok `X:49..960, Y:60..1440`).