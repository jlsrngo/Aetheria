# Re-Audit Khusus: Menu Studio & Pembuat Konten (Aetheria Nexus)

**Tanggal:** 2026-11-17  
**HEAD:** `c8e232e` (setelah 8 commit perbaikan sejak audit awal)  
**Fokus:** Khusus menu Studio (`apps/src/components/studio/`, `apps/src/hooks/useStudio*`, `useTimeline*`, `useMotionPlayback*`, dan engine `core/aetheria-engine/src/studio/`)  
**Metode:** Pembacaan mendalam baris demi baris pada 18 file studio frontend & engine backend.

---

## 1. Ringkasan Eksekutif

Setelah serangkaian commit perbaikan (`9547442`, `b635609`, `f31df7c`, `b315793`, `cd3a2ad`):
- **11 celah utama studio berhasil diperbaiki** (debounce sync per-komposisi, penghapusan fake render simulation, Space guard interaktif, single Ctrl+Z owner, honest error toast di Inspector, hex draft di Caption panel, pemisahan chunk workstation, dll.).
- Namun, audit menyeluruh terhadap seluruh komponen studio menemukan **20 celah yang masih bertahan atau baru muncul** (4 P0, 9 P1, 7 P2).
- **Titik paling rapuh saat ini:**
  1. `ClipEditModal.tsx` memiliki ketergantungan `useEffect` pada `activeComposition.props` (object reference) yang mereset semua draft input pengguna setiap kali terjadi update prop apa pun, berisiko tinggi menimpa editan pengguna di tengah mengetik.
  2. `htmlStageBridge.ts` mengalami memory leak `URL.createObjectURL` tanpa `URL.revokeObjectURL` pada preview aset lokal.
  3. Duplikasi logika render antara `RenderQueuePanel.tsx` dan `useTimelineActions.ts` (rentan desinkronisasi).
  4. Silent catch `catch {}` di beberapa titik kritis (generasi subtitle, GPU telemetry, scan script).

---

## 2. Status Perbaikan dari Audit Sebelumnya (Verifikasi Kode Aktual)

| Temuan Awal | Deskripsi Awal | Status di HEAD `c8e232e` | Lokasi Bukti di Kode |
|---|---|---|---|
| **U-01** | Backend sync race condition / single global timer menimpa mutasi komposisi lain | **SEMBUH** | `useStudioStore.ts:87, 94-110` — sekarang menggunakan `backendSyncTimers = new Map<string, Timer>()` per ID komposisi. |
| **U-02** | `updateActiveMetadata` tidak memicu backend sync ke disk | **SEMBUH** | `useStudioStore.ts:230` — sekarang memanggil `scheduleBackendPropsSync(mutatedId, updated.props, epoch)`. |
| **U-03** | Fake render simulation di frontend mengelabui user | **SEMBUH** | `useTimelineActions.ts:81` — sekarang memanggil `POST /render-media` nyata ke engine. |
| **U-04** | Duplikasi fake render simulation di RenderQueuePanel | **SEMBUH** | `RenderQueuePanel.tsx:129` — fake render dihapus, diganti panggilan riil `POST /render-media`. |
| **U-08** | Konflik Spacebar & ganda handler Ctrl+Z (timeline vs canvas) | **SEMBUH** | `useTimelineInteractions.ts:40` menghapus Space duplicate. `useStudioCanvasInteractions.ts:73-95` menambahkan pengecekan elemen interaktif (`input`, `textarea`, `button`, `select`, `[contenteditable]`, `[role="textbox"]`). |
| **U-14** | Color picker di Captions panel menolak input hex manual | **SEMBUH** | `ElementsCaptionsPanel.tsx:103-105` menambahkan sinkronisasi `hexDraft` dua arah. |
| **U-15** | InspectorPanel menelan error simpan/refresh | **SEMBUH** | `InspectorPanel.tsx:79-80, 115-119, 136-138` semua operasi I/O sekarang dibungkus `try/catch` dengan `toast.error`. |
| **E-01** | Tool `edit` rawan mismatch untuk blok panjang | **SEMBUH** | `core/aetheria-engine/src/tool/edit.rs:43` menambahkan guard & fallback fuzzy. |
| **E-03** | Tool `grep` tidak mendukung regex penuh | **SEMBUH** | `core/aetheria-engine/src/tool/grep.rs` menggunakan engine regex riil. |
| **E-04** | Tool `glob` tidak memberi tahu bila hasil terpotong | **SEMBUH** | `core/aetheria-engine/src/tool/glob.rs` menambahkan flag `truncated: true`. |
| **U-31** | Bundle workstation terlalu besar (>800kB) | **SEMBUH** | `apps/vite.config.ts:35` dan `AppLayout.tsx:15` memecah chunk workstation dan mengaktifkan lazy loading. |

---

## 3. Celah yang Masih Bertahan (Surviving Gaps) & Celah Baru

### Kategori A: Frontend Studio (`apps/src/components/studio/` & `apps/src/hooks/`)

#### 🔴 P0 — Kritis (Risiko Data Loss, Crash, atau Memory Leak Berat)

##### [S-01] `ClipEditModal.tsx:72–103` — Desync Draft Akibat Object Reference di `useEffect` Deps
- **File & Baris:** `apps/src/components/studio/ClipEditModal.tsx:72–103`
- **Gejala:** `useEffect` yang menyinkronkan draft input modal (`contentDraft`, `timingDraft`, `colorDraft`, dll.) memasukkan `activeComposition.props` ke dalam dependency array `[layer, activeComposition.props]`.
- **Dampak:** Karena `activeComposition.props` adalah object literal baru setiap kali ada pembaruan store (spread copy), setiap kali `handleSave` menyimpan perubahan atau background sync berjalan, seluruh draft lokal modal di-reset seketika. Jika pengguna sedang mengetik di input teks lain saat auto-sync atau event lain terjadi, ketikan pengguna **terhapus/tertimpa nilai lama**.
- **Solusi:** Ganti dependency `activeComposition.props` dengan primitive ID atau hashing stabil (mis. `layer.id` dan `layer.updatedAt`), jangan watch seluruh root object `props`.

##### [S-02] `htmlStageBridge.ts:234` — Memory Leak Blob URL Tanpa Revoke
- **File & Baris:** `apps/src/components/studio/htmlStageBridge.ts:234`
- **Gejala:** Fungsi `fetchWorkspaceBlobUrl` memanggil `URL.createObjectURL(blob)` setiap kali iframe stage memuat aset lokal (gambar, video clip, font), namun `URL.revokeObjectURL` tidak pernah dipanggil kapan pun selama siklus hidup sesi preview.
- **Dampak:** Setiap aset baru atau pergantian revisi aset menumpuk memori di dalam browser renderer process. Pada sesi kerja studio panjang dengan ratusan aset/frame revisi, memori webview/browser dapat membengkak hingga ratusan megabyte dan memicu tab crash.
- **Solusi:** Simpan daftar URL blob di dalam `Map<string, string>` dan panggil `URL.revokeObjectURL(oldUrl)` saat aset diganti, serta revoke semua blob saat iframe unmount/unload.

##### [S-03] `AppLayout.tsx:50–70` — Ketiadaan `ErrorBoundary` di Sekitar Lazy Route Suspense
- **File & Baris:** `apps/src/components/layout/AppLayout.tsx:50–70`
- **Gejala:** Komponen halaman Studio di-load secara dinamis via `React.lazy()` di dalam `<Suspense fallback={<RouteLoading />}>`, tetapi tidak dibungkus `ErrorBoundary` per-halaman.
- **Dampak:** Jika chunk JavaScript Studio gagal diunduh (koneksi terputus sesaat, update aplikasi lokal, atau error evaluasi modul), error React langsung menjalar ke root aplikasi dan membuat seluruh jendela aplikasi desktop blank putih (White Screen of Death).
- **Solusi:** Bungkus setiap `<Suspense>` route dengan `<ErrorBoundary fallback={<RouteErrorFallback />}>`.

##### [S-04] `RenderQueuePanel.tsx:95–171` vs `useTimelineActions.ts:61–124` — Duplikasi Logika Render Media
- **File & Baris:** `apps/src/components/studio/panels/RenderQueuePanel.tsx:95–171` dan `apps/src/hooks/useTimelineActions.ts:61–124`
- **Gejala:** Handler `handleStartRender` di `RenderQueuePanel` menyalin hampir 100% logika `handleQuickExport` dari `useTimelineActions` (pembuatan job payload, validasi active composition, POST `/render-media`, polling progress, dan error handling).
- **Dampak:** Melanggar prinsip DRY (AGENTS.md §5.1.4). Perubahan format payload render atau penanganan autentikasi di masa depan akan menyebabkan salah satu tempat tertinggal dan memicu bug render diam-diam.
- **Solusi:** Ekstrak logika eksekusi render ke satu service/hook tunggal (`exportMediaJob`), lalu panggil dari kedua komponen.

---

#### 🟡 P1 — Moderat (Silent Failures, Desinkronisasi UI, Inkonsistensi Desain)

##### [S-05] `ElementsCaptionsPanel.tsx:200` — Silent Catch pada Kegagalan API Subtitle
- **File & Baris:** `apps/src/components/studio/panels/ElementsCaptionsPanel.tsx:200`
- **Gejala:** Panggilan API pembuatan subtitle otomatis menggunakan blok `catch {}` kosong tanpa toast error maupun log.
- **Dampak:** Jika engine gagal memproses transkripsi suara atau LLM timeout, tombol berhenti berputar dan UI diam-diam jatuh ke fallback lokal tanpa memberitahu pengguna mengapa subtitle tidak muncul.
- **Solusi:** Tambahkan `toast.error("Gagal membuat subtitle otomatis: " + (err.message || "Engine tidak merespons"))`.

##### [S-06] `RenderQueuePanel.tsx:60, 89` — Silent Catch pada Telemetry GPU dan Polling Render
- **File & Baris:** `apps/src/components/studio/panels/RenderQueuePanel.tsx:60, 89`
- **Gejala:** Panggilan `GET /studio/gpu-telemetry` (L60) dan `GET /render-progress` (L89) memiliki blok `catch {}` kosong.
- **Dampak:** Jika engine mengalami restart atau network crash saat render, polling terus berjalan di latar belakang tanpa memberitahu status koneksi putus, dan kartu render tetap macet di status "rendering" selamanya.
- **Solusi:** Tambahkan counter kegagalan berurutan (mis. 5 kali gagal berturut-turut) untuk mengubah status job menjadi error "Koneksi ke engine terputus".

##### [S-07] `ScriptPanel.tsx:187, 252, 258` — Silent Catch Tiga Titik & Penggunaan `any[]`
- **File & Baris:** `apps/src/components/studio/panels/ScriptPanel.tsx:112, 115, 187, 252, 258`
- **Gejala:** L112 dan L115 menggunakan `any[]` eksplisit untuk pesan chat. L187, L252, dan L258 menelan error fetch file script dan directory scan dengan `catch {}` kosong.
- **Dampak:** Script pengguna tidak muncul di editor saat terjadi kegagalan pembacaan disk, dan tidak ada pesan diagnostik yang menjelaskan bahwa pembacaan file gagal.
- **Solusi:** Ganti `any[]` dengan tipe `ChatMessage` dan tambahkan error notification.

##### [S-08] `ClipEditModal.tsx:121–155` — `handleSave` Tanpa Guard `try/catch`
- **File & Baris:** `apps/src/components/studio/ClipEditModal.tsx:121–155`
- **Gejala:** Fungsi `handleSave` memanggil 4 mutasi store berturut-turut (`onSaveContent`, `onSaveTiming`, `onSaveColor`, `actions.updateActiveProps`) tanpa blok `try/catch`.
- **Dampak:** Jika salah satu payload mengandung data korup atau setter melempar error, modal tertinggal dalam kondisi terbuka setengah-tersimpan dan state desinkron dengan timeline.
- **Solusi:** Bungkus seluruh rangkaian penyimpanan dalam satu blok `try/catch` dengan rollback atau toast error.

##### [S-09] Pelanggaran Sistem Desain: Hex Literals di Seluruh Komponen Panel Studio
- **File & Baris:**
  - `apps/src/components/studio/panels/InspectorPanel.tsx:216, 417, 460` (`#cf6613`, `#b8580f`, `#e07b27`)
  - `apps/src/components/studio/panels/ElementsCaptionsPanel.tsx:401` (`#cf6613`, `#b8580f`, `#e07b27`)
  - `apps/src/components/studio/ClipEditModal.tsx:263, 301, 329, 369, 399, 472, 567, 678, 727` (`#cf6613` dan `#0284c7`)
- **Gejala:** Tombol aktif dan aksi utama menggunakan hex hardcoded alih-alih CSS variables (`var(--accent-primary)`, dll.). Melanggar aturan ketat AGENTS.md §6 ("Dilarang hex literal baru — nilainya berbeda per tema").
- **Dampak:** Tombol terlihat aneh atau kontras buruk pada tema gelap vs terang.
- **Solusi:** Ganti hex hardcoded dengan variabel CSS `--accent-primary` atau utilitas Tailwind standar yang terikat tema.

##### [S-10] `ElementsCaptionsPanel.tsx:415` — Index Digunakan Sebagai Bagian Kunci React
- **File & Baris:** `apps/src/components/studio/panels/ElementsCaptionsPanel.tsx:415`
- **Gejala:** `key={`${cue.startFrame}-${idx}`}` menggunakan loop index `idx`.
- **Dampak:** Ketika pengguna menghapus cue atau mengurutkan ulang urutan subtitle, rekonsiliasi DOM React dapat mempertahankan state fokus atau animasi yang salah.
- **Solusi:** Gunakan `cue.id` yang unik dan stabil.

##### [S-11] `ClipEditModal.tsx:175` — Ketiadaan Backdrop Dismiss & Focus Trap
- **File & Baris:** `apps/src/components/studio/ClipEditModal.tsx:168–175`
- **Gejala:** Modal memiliki `role="dialog"` dan `aria-modal="true"`, tetapi klik di backdrop luar tidak memicu `onClose`, dan tidak ada focus trap (pengguna bisa menekan Tab hingga fokus keyboard keluar dari modal).
- **Dampak:** Aksesibilitas keyboard dan standar UX dialog terlanggar.
- **Solusi:** Pasang `onClick={onClose}` pada backdrop container dan pasang listener tab-trap.

##### [S-12] `useMotionPlayback.ts:189, 225` — Lonjakan Timestamp Frame Saat Perubahan Dependensi Playback
- **File & Baris:** `apps/src/hooks/useMotionPlayback.ts:189, 225`
- **Gejala:** Ketika `fps` atau `playbackRate` berubah di tengah playback aktif, RAF dibatalkan dan dimulai ulang tanpa mereset `lastTsRef.current`.
- **Dampak:** Terdapat lonjakan delta waktu (`dtSec`) pada frame pertama setelah restart, yang dapat menyebabkan audio dan visual melompat hingga 3 frame (meski sudah dibatasi parsial oleh `Math.min(0.1, ...)`).
- **Solusi:** Reset `lastTsRef.current = null` di dalam cleanup effect atau saat dependensi berubah.

##### [S-13] `Timeline.tsx:211, 223` — Fire-and-Forget Async Actions Berisiko Toast pada Unmounted Component
- **File & Baris:** `apps/src/components/studio/Timeline.tsx:211, 223`
- **Gejala:** Pemanggilan `microstock.actions.toggleMode(next)` dan `runRenderAndPreflight` dieksekusi secara asinkron tanpa memeriksa apakah komponen masih mounted saat promise selesai.
- **Dampak:** Meski pustaka toast bersifat global, bila terdapat operasi lanjutan yang menyentuh state lokal, akan timbul React warning.
- **Solusi:** Tambahkan pengecekan flag mounted sebelum eksekusi lanjutan.

---

#### 🟢 P2 — Rendah (Minor Polish, Accessibility, Code Hygiene)

##### [S-14] `AppLayout.tsx:37–44` — Nested RAF Leak Parsial
- **File & Baris:** `apps/src/components/layout/AppLayout.tsx:37–44`
- **Gejala:** Kode menggunakan double RAF (`requestAnimationFrame(raf1)` yang memanggil `requestAnimationFrame(raf2)`), namun fungsi cleanup hanya membatalkan `raf1`. Jika unmount terjadi setelah tick pertama, callback kedua tetap dieksekusi.

##### [S-15] `useTimelineInteractions.ts:28, 103` — Guard Hotkey Belum Menangkap `role="textbox"`
- **File & Baris:** `apps/src/hooks/useTimelineInteractions.ts:28, 103`
- **Gejala:** Guard keyboard shortcut mengecualikan tag HTML native (`input`, `textarea`, `select`, `contentEditable`), namun elemen kustom dengan atribut ARIA `[role="textbox"]` tidak terdeteksi, sehingga shortcut split/delete (S/C/Delete) bisa terpicu saat user mengetik di custom editor.

##### [S-16] `InspectorPanel.tsx:361–373` — Swatch Buttons Menggunakan `title` Tanpa `aria-label`
- **File & Baris:** `apps/src/components/studio/panels/InspectorPanel.tsx:361–373`
- **Gejala:** Tombol swatch warna hanya memiliki atribut `title` tanpa `aria-label`, mengurangi aksesibilitas untuk screen reader pada navigasi keyboard.

---

### Kategori B: Engine Studio (`core/aetheria-engine/src/studio/` & `src/tool/`)

#### 🟡 P1 — Moderat (Engine Reliability & Subprocess Integrity)

##### [S-17] `html_renderer.rs:25–28, 227` — Ephemeral Port TOCTOU Race Condition pada CDP Chrome
- **File & Baris:** `core/aetheria-engine/src/studio/html_renderer.rs:25–28, 227`
- **Gejala:** Fungsi `pick_ephemeral_port()` membuka `TcpListener` pada port random OS, mengambil nomor port, lalu **menutup listener tersebut** sebelum melewatkan port ke Chrome flag `--remote-debugging-port=<port>`.
- **Dampak:** Time-Of-Check-To-Time-Of-Use (TOCTOU): terdapat celah waktu di mana proses lain di Windows dapat merebut port tersebut sebelum Chrome sempat melakukan bind. Jika ini terjadi, koneksi WebSocket CDP gagal dan render/preview crash seketika.
- **Solusi:** Implementasikan retry loop dengan port acak baru jika handshake CDP awal gagal terhubung dalam 1.5 detik.

##### [S-18] `html_renderer.rs:59, 222` — Pembuatan Direktori Output/Profile Menelan Error
- **File & Baris:** `core/aetheria-engine/src/studio/html_renderer.rs:59, 222`
- **Gejala:** `let _ = std::fs::create_dir_all(&profile_dir)` dan `let _ = std::fs::create_dir_all(parent)` mengabaikan error I/O.
- **Dampak:** Jika disk penuh, path read-only, atau permission Windows menolak, pembuatan direktori gagal tanpa pesan jelas, dan Chrome kemudian crash dengan error yang menyesatkan.
- **Solusi:** Ganti `let _ =` dengan `std::fs::create_dir_all(...).map_err(...)` dan teruskan error secara eksplisit.

##### [S-19] `film_static_server.rs:40` — Pembacaan `index.html` Gagal Menyajikan Halaman Kosong
- **File & Baris:** `core/aetheria-engine/src/studio/film_static_server.rs:40`
- **Gejala:** `std::fs::read_to_string(&index_path).unwrap_or_default()` menyajikan string kosong jika `index.html` terkunci (file lock oleh editor lain) atau terjadi kesalahan I/O.
- **Dampak:** Browser iframe menerima respons HTTP 200 dengan body kosong (bukan 404/500). Preview stage tampak blank hitam tanpa ada indikator error yang memberitahu bahwa file terkunci.
- **Solusi:** Kembalikan status HTTP 500 dengan pesan error deskriptif jika pembacaan file gagal.

##### [S-20] `film_feedback.rs:400–550` — Mesin Diagnostik Belum Memiliki Fitur Auto-Fix (W-08)
- **File & Baris:** `core/aetheria-engine/src/tool/film_feedback.rs:400–550`
- **Gejala:** Diagnostik mendeteksi kesalahan umum seperti `SCENE_ID_MISMATCH`, script scene yang belum terdaftar di `index.html`, atau scene ID yang tertinggal, tetapi **hanya menghasilkan pesan error teks**.
- **Dampak:** LLM atau pengguna harus melakukan manual edit baris per baris untuk membetulkan tag `<script>` atau ID yang tidak cocok, membuang turn agent dan membuka potensi salah edit teks.
- **Solusi:** Tambahkan fungsi auto-repair sederhana yang otomatis menyisipkan tag `<script>` yang hilang atau menyeimbangkan nama ID jika diminta.

---

## 4. Matriks Perbandingan & Rangkuman Celah

| ID | Komponen | Area | Level | Dampak | Status |
|---|---|---|---|---|---|
| **S-01** | `ClipEditModal.tsx:72` | State Management | **P0** | Editan pengguna terhapus saat auto-sync aktif | Bertahan |
| **S-02** | `htmlStageBridge.ts:234` | Memory | **P0** | Webview membengkak & berisiko crash pada preview panjang | Bertahan |
| **S-03** | `AppLayout.tsx:50` | Error Handling | **P0** | App crash/blank jika chunk lazy studio gagal load | Bertahan |
| **S-04** | `RenderQueuePanel.tsx:95` | Arsitektur/DRY | **P0** | Duplikasi logika eksekusi render media | Bertahan (Baru) |
| **S-05** | `ElementsCaptionsPanel.tsx:200`| Error Handling | **P1** | Subtitle generator gagal diam-diam tanpa feedback | Bertahan |
| **S-06** | `RenderQueuePanel.tsx:60,89` | Error Handling | **P1** | Polling render & GPU telemetry mati diam-diam | Bertahan |
| **S-07** | `ScriptPanel.tsx:187,258` | Error Handling/Type | **P1** | File script gagal dimuat tanpa peringatan + `any[]` | Bertahan |
| **S-08** | `ClipEditModal.tsx:121` | Error Handling | **P1** | Simpan modal gagal meninggalkan state setengah-tersimpan | Bertahan |
| **S-09** | Multi-file Panels | Design System | **P1** | Hex literals hardcoded (`#cf6613`, dll.) melanggar aturan tema | Bertahan |
| **S-10** | `ElementsCaptionsPanel:415` | Rendering | **P1** | Index array digunakan pada key caption cues | Bertahan |
| **S-11** | `ClipEditModal.tsx:175` | A11y / UX | **P1** | Backdrop klik tidak dismiss modal & no focus trap | Bertahan |
| **S-12** | `useMotionPlayback.ts:189` | Playback Timing | **P1** | Lonjakan delta waktu saat pergantian FPS on-the-fly | Bertahan |
| **S-13** | `Timeline.tsx:211` | Async Flow | **P1** | Fire-and-forget async action tanpa guard unmount | Bertahan |
| **S-14** | `AppLayout.tsx:37` | Lifecycle | **P2** | Inner RAF tidak di-cancel saat unmount | Bertahan |
| **S-15** | `useTimelineInteractions:28` | Keyboard Guard | **P2** | `[role="textbox"]` tidak dilindungi dari hotkey timeline | Bertahan |
| **S-16** | `InspectorPanel.tsx:361` | Accessibility | **P2** | Swatch button tanpa `aria-label` | Bertahan |
| **S-17** | `html_renderer.rs:25` | Engine / CDP | **P1** | Ephemeral port TOCTOU race condition di Chrome CDP | Bertahan |
| **S-18** | `html_renderer.rs:59` | Engine / IO | **P1** | Error pembuatan direktori Chrome ditelan diam-diam | Bertahan |
| **S-19** | `film_static_server.rs:40` | Engine / HTTP | **P1** | Pembacaan index.html gagal menghasilkan HTTP 200 kosong | Bertahan |
| **S-20** | `film_feedback.rs:400` | Engine / Tool | **P1** | Tidak ada fitur auto-fix untuk scene wiring | Bertahan |

---

## 5. Rencana Tindakan Perbaikan Cepat (Prioritas Kerja)

1. **Prioritas 1 (Perbaikan P0 - Dalam 1 Hari):**
   - Perbaiki `ClipEditModal.tsx` baris 103: hapus `activeComposition.props` dari deps `useEffect`, ganti dengan `[layer.id, layer.type]`.
   - Tambahkan `URL.revokeObjectURL` pada `htmlStageBridge.ts` untuk membersihkan memori blob aset.
   - Bungkus `<Suspense>` Studio di `AppLayout.tsx` dengan `ErrorBoundary`.
   - Satukan logika eksekusi render dari `RenderQueuePanel` ke `useTimelineActions`.

2. **Prioritas 2 (Perbaikan P1 - 1–2 Hari):**
   - Ganti blok `catch {}` kosong di `ElementsCaptionsPanel.tsx`, `RenderQueuePanel.tsx`, dan `ScriptPanel.tsx` dengan toast notifikasi kesalahan.
   - Ganti hex `#cf6613`/`#e07b27` dengan token CSS variable (`var(--accent-primary)`).
   - Tambahkan retry loop pada binding port Chrome CDP di `html_renderer.rs`.
   - Bungkus `handleSave` di `ClipEditModal` dengan `try/catch`.
