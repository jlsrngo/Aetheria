# Laporan Audit Kepatuhan AGENTS.md — File Besar & Working Tree

Tanggal: 2026-11-22 · HEAD: `4687683` · Objek: working tree dengan 20 file termodifikasi + 3 file untracked (`git status --short`) · Bersifat **audit statis**, tanpa perubahan kode.

Catatan: `docs/*` masuk `.gitignore:88`, jadi laporan ini **tidak akan ter-track** tanpa penambahan pengecualian seperti laporan lain di folder yang sama.

Aturan `AGENTS.md:3` meminta: bila aturan bertabrakan dengan kenyataan di kode, **berhenti dan laporkan**, jangan memilih diam-diam. Bagian 1 memuat tabrakan tersebut. Bagian 2–5 memuat temuan pada file ribuan baris.

## Ringkasan eksekutif

- **Tidak ada pelanggaran keras baru** pada kode yang diubah: tidak ada `unwrap`/`expect`/`panic!` di jalur non-test, `unsafe`, `#[allow]`, log secret, aset benchmark statis, atau respons API non-`camelCase` baru.
- **Ada 2 temuan baru nyata**: path guard belum dipakai pada pembacaan filmstrip di `direct_scene_remake.rs:393-462`, dan `std::fs::read_to_string` di `async fn` `preview_film.rs:146`.
- **File terbesar justru hasil rewrite terbaru**: `direct_scene_remake.rs` sekarang 2.540 baris fisik (dulu 2.048), dengan satu fungsi 775 baris dan ~784 baris tes. Ini melanggar pemicu tinjau kohesi `AGENTS.md:150`, bukan sekadar batas panjang.
- **Angka baseline di AGENTS.md sudah usang** di hampir semua metrik, dan klaim "repo tidak punya CI" **salah**: `.github/workflows/ci.yml` ter-track.
- mayoritas pelanggaran lain adalah **legacy** dan sesuai perlakuan `AGENTS.md:25`: dilaporkan, tidak dihapus di luar scope.

## 1. Kontradiksi AGENTS.md dengan kode (diperlukan keputusan)

| `AGENTS.md` | Kenyataan di working tree | Status | Bukti |
|---|---|---|---|
| `:34` "repo tidak punya CI (`.github/` ada di `.gitignore`)" | CI **ada dan ter-track**, menjalankan typecheck/build/Vitest/`cargo test --workspace`/Playwright | **Salah** | `.github/workflows/ci.yml:1-58`; `.gitignore` berisi `.github/*` lalu `!.github/workflows/` |
| `:41` Vitest "26 file / 103 tes" | **32 file / 126 tes** (semua lulus) | Salah | `npx vitest run` → `Test Files 32 passed`, `Tests 126 passed` |
| `:150` "14 file TS >600 baris", `useWorkstationChat.ts` 1.737, `AnalyticsPage.tsx` 1.058 | **16 file** >600 baris fisik; `useWorkstationChat.ts` **1.927 fisik / 1.797 non-kosong / 1.746 non-komentar**; `AnalyticsPage.tsx` 1.058 fisik / 989 non-kosong | Salah/partial (campur metrik baris) | lihat lampiran daftar 16 file |
| `:166` "±177 `any`" | **193 `AnyKeyword` AST** di `apps/src` (214 token `\bany\b`, sebagian teks alami); 49 di 16 file besar | Usang | hotspot: `lib/api.ts` 24, `chat/mapper.ts` 23, `lib/engine.ts` 17 |
| `:175` "11 pemakaian index key" | **12** (3 berupa fallback `id \|\| idx`) | Usang | `CenterNoticeModal.tsx:94`, `InspectorCustomPropsSection.tsx:225`, `TimelineRulerTicks.tsx:92,106`, dll. |
| `:151` "`lib/` tidak mengimpor `components/`" | **2 impor**: satu type-only, satu runtime | Salah | `apps/src/lib/engine.ts:7`, `apps/src/lib/studioProxyPreview.ts:2` |
| `:200` "15 folder memakai `mod.rs`" | **16** folder | Usang | termasuk `session/agent_turn/` dan `studio/microstock/` |
| `:207` "±44 `Result<T, String>`" | **97 strict / 119 long match** di 44/49 file | Usang | seluruh `core/**/*.rs`, `src-tauri/**/*.rs` |
| `:208` "4 `unwrap()` di file tanpa blok test" | **4 file / 19 `unwrap()`** tanpa `#[cfg(test)]` inline (sebagian di file test yang di-wire lewat `mod.rs`) | Partial | `main.rs`, `build.rs`, `src-tauri/src/lib.rs`, `story_characterization_tests.rs` |
| `:211` "±7 blok `unsafe`" | **9 blok / 7 file**, hanya 2 berkomentar `SAFETY:` | Usang | `main.rs:10`, `server_auth.rs:24`, `vault_helpers.rs:105`, `desktop/sys.rs:85`, `desktop/window.rs:104,163`, `src-tauri/src/lib.rs:110,137`, `src-tauri/src/main.rs:11` |
| `:216` "±300 pemakaian `std::fs`" | **932 match / 107 file** (engine 928) | Sangat usang | seluruh `core/**/*.rs`, `src-tauri/**/*.rs` |
| `:218` "±38 `rename_all = "camelCase"`" | **90 atribut / 29 file** | Usang | seluruh `core/**/*.rs`, `src-tauri/**/*.rs` |
| `:223` "±59 modul `#[cfg(test)]`" | **140 file / 143 match** (`mod tests` 137) | Sangat usang | seluruh `core/**/*.rs`, `src-tauri/**/*.rs` |
| `:117` "±167 file belum sesuai rustfmt" | **219 file unik / 1.166 blok diff** (`cargo fmt --check`, **tanpa** `fmt --all`) | Usang | sampel 4/4 file gagal check |
| `:219` "belum ada crate logging" | Benar untuk engine, **salah untuk shell** | Partial | `src-tauri/Cargo.toml:20-21` memuat `log = "0.4"` + `tauri-plugin-log`; `src-tauri/src/lib.rs:26-27` |
| `:105` port dev | Sesuai (`:4096` vs `:4196` + override `AETHERIA_HEALTH`) | Sesuai | `scripts/dev-app.cjs:237`, `apps/vite.config.ts:71` |
| `:100` larangan `--release` di dev/E2E | Skrip `scripts/`/`e2e/` patuh; namun root `start` = `cargo run --release`, dan `:98`/`:100` menyebut `tauri:build`/`bundle:prepare`/`start` secara bergantian | Partial | `package.json:10`; teks AGENTS sendiri inkonsisten |

Catatan metrik: angka di prompt audit awal (1.797 / 989 / 874 / …) adalah **baris non-kosong**, sedangkan angka di AGENTS.md sebagian memakai **baris fisik**. Perbaikan dokumen harus menyebut satuan yang dipakai.

## 2. Temuan pada kode yang baru diubah (working tree)

| Prioritas | `path:line` | Aturan | Bukti | Status |
|---|---|---|---|---|
| **P0** | `core/aetheria-engine/src/session/agent_turn/direct_scene_remake.rs:393-462` | §4 / §5.3.8 | `collect_scene_filmstrip_pass1_images` membaca `filmstrip_index.json` di `:396`, lalu `extracted_dir.join(rel_vis)` / `join(rel_raw)` di `:452-453` langsung dari field JSON dan hanya memeriksa `.is_file()` di `:454-456`, lalu `encode_jpeg_data_url` di `:462` dan hero di `:467-468`. Tidak ada `contains_path`/`resolve_isolated_path`. Pola yang sama di file baru `tool/ref_filmstrip.rs:225-235` **memakai** `crate::paths::contains_path(ws_root, &path)`. Field `relPath`/`visionRelPath` berasal dari file di proyek pengguna, sehingga `..` dapat keluar dari `ws_root`. | **Baru** |
| **P1** | `core/aetheria-engine/src/tool/preview_film.rs:143-146` | §5.3.11 | `std::fs::read_to_string(chosen)` di dalam `pub async fn execute_capture_film_preview` (`:122`) — blok I/O sinkron ini baru di diff. Gunakan `tokio::fs::read_to_string`. | **Baru** |
| P2 | `core/aetheria-engine/src/tool/ref_filmstrip.rs:12,172` | §5.1.5 | `pub fn read_filmstrip_tool_definition` dan `pub fn execute_read_filmstrip`; pemakai hanya `tool/catalog.rs:72`, `tool/mod.rs:256`, `direct_scene_tools.rs:180,861`, tidak ada konsumsi lintas-crate → `pub(crate)` cukup. | Baru, minor |
| P2 | `core/ref_extractor/ref_extractor.py:1829-1866` | §2 / penanganan error | `except Exception:` menelan semua kegagalan filmstrip tanpa log; 3 env flag tersembunyi (`AETHERIA_DISABLE_FILMSTRIP`, `_MODE`, `_HOLD_EPS`) mengubah output hasil ekstraksi. | Baru |
| P2 | `core/ref_extractor/ref_extractor.py:1357-1408`, `ref_frame_probe.py:334-440`, `ref_temporal_cuts.py:199-203,255-260` | §5.1.6 | Konstanta sampling/Canny/bobot/ambang tanpa penjelasan; `ref_temporal_cuts.py:255-260` memakai `min(16, max(dur_cap, min(16, …)))` yang berlebihan. | Baru |
| P2 | `ref_extractor.py:1577-1580`, `ref_filmstrip.py:244-251`, `ref_frame_probe.py:380-383`, `eval_reference_accuracy.py:98-100` | §5.1.4 | Empat implementasi gray-absdiff motion dengan proxy berbeda (160², 180×320, 64×36) — duplikasi logika yang sudah pernah merusak banyak titik panggil. | Baru + legacy |
| P3 | `core/ref_extractor/ref_filmstrip.py:240-254` | §2 / performa | Video didekode kedua kalinya dengan semua tile ditahan: ~776 frame × 240×560×3 ≈ 300 MB portrait, di samping `cached_frames` full-res. | Baru |
| P3 | `core/ref_extractor/test_ref_filmstrip.py:5` | §3.4 | `import os` tidak dipakai. | Baru, minor |
| P3 | `test_ref_extractor_and_compare.py:36-62` vs `ref_extractor.py:1829-1866` | §3.3 | Tes memeriksa `style.json`, tetapi belum mengassert `blueprint["filmstrip"]` / `scene["filmstripSheets"]`. | Baru, celah tes |

**Yang sudah benar pada kode baru** (penting untuk menghindari "perbaikan" yang tidak perlu):

- `unwrap()`/`expect()` di `direct_scene_remake.rs` seluruhnya berada di dalam `#[cfg(test)]` mulai `:1756` — tidak ada di jalur produksi.
- Tidak ada `unsafe`, `#[allow(...)]` baru, `panic!`, secret/token yang dicetak, atau path `benchmarks/`/`labs-showreel`/`ngorzc` pada diff.
- `eval_reference_accuracy.py:1-7,85-116,343-447` memakai benchmark hanya sebagai evaluasi offline dengan `TemporaryDirectory`; `ref_extractor.py:1839-1841,1963,2040-2053` dan `ref_filmstrip.py:280-283,382-385` hanya menulis filmstrip dari video pengguna ke `out_dir` dan menyimpan metadata relatif → patuh §1.
- Tes Python baru memakai `TemporaryDirectory`, tanpa `skip`/`xfail`, assertion pada file/metrik nyata.

## 3. File ribuan baris: kohesi dan rekomendasi

Satuan: **fisik / non-kosong**. Semua adalah `legacy` kecuali `direct_scene_remake.rs`, `ref_extractor.py`, dan `ref_filmstrip.rs` yang disentuh working tree.

| File | Baris | Isi / campuran tanggung jawab | Verdict §5.1.2 |
|---|---|---|---|
| `session/agent_turn/direct_scene_remake.rs` | 2.540 / 2.424 | impl `:1-1755` + tes `:1756-2540`; deteksi/scaffold `:66-295`, I/O vision+base64 `:297-517`, rollback/trace `:518-589`, `run_single_direct_scene` `:620-1393` (**775 baris**), orkestrasi `:1395-1707`, formatter `:1708-1755` | **Perlu dipecah.** Campur env config, I/O proyek, klien LLM, micro-tool, state rollback, dan presentasi. Rewrite menambah ~490 baris tanpa justifikasi kohesi tertulis. |
| `session/agent_turn/runner.rs` | 2.195 / 2.082 | `run_agent_turn` `:91-764` (**674 baris**), assembly pesan `:785-1093`, resolusi provider `:1094-1350`, kompaksi `:1386-1477`, event `:1540-1661`, tool list `:1854-1860` | **Perlu dipecah**: orkestrasi + transport + prompt + event + diagnostik. |
| `core/ref_extractor/ref_extractor.py` | 2.186 / 2.005 | audio BPM `:52-233`, clean-plate `:234-320`, CV `:321-591`, generator JS `:592-715`, OCR `:716-792`, contact sheet `:853-1042`, layout/hero `:1043-1408`, orkestrator `:1410-2177`, CLI `:2180-2186` | **Campuran beberapa domain**; tambahan baru mengikuti pola lama. Jangan direfactor di luar tugas khusus. |
| `apps/src/components/workstation/chat/useWorkstationChat.ts` | 1.927 / 1.797 | TanStack Query `:161-175`, auto-scroll `:239-281`, listener online/offline `:284-334`, localStorage `:338-359`, antrean prompt `:949-958`, watchdog/abort `:961-982`, **parsing SSE `:1045-1814`**, polling `:1846-1871` | **Perlu dipecah**: I/O jaringan + state UI + orkestrasi session. Sesuai `AGENTS.md:150` untuk tidak menambah fitur langsung ke sini. |
| `core/voicebox/voicebox_engine.py` | 1.834 / 1.627 | normalizer `:65-376`, preset `:378-545`, DSP `:547-661`, 3 penyedia TTS `:884-1215`, alignment `:1216-1309`, `generate_speech` `:1403-1710` (~308 baris), HTTP server+CLI `:1713-1834` | Satu domain luas (TTS) dengan subdomain terpisah; ukuran tidak bisa dibenarkan sebagai satu tanggung jawab sempit, tetapi **legacy**. |
| `tool/film_scaffold.rs` | 1.621 / 1.527 | definisi tool `:72-162`, generator HTML `:203-645` (~400 baris template), baca defaults `:646-679`, `execute_film_scaffold` `:680-1255` | **Perlu dipecah**: presentasi HTML/manifest bercampur I/O proyek. |
| `session/agent_turn/subagent.rs` | 1.364 / 1.297 | — | Melewati pemicu tinjau; perlu justifikasi kohesi bila disentuh. |
| `session/agent_turn/history.rs` | 1.320 / 1.254 | — | Dimodifikasi (97 baris diff); perlu justifikasi kohesi. |
| `tool/ref_extractor.rs` | 1.331 / 1.252 | helper AST `:14-329`, probe Python `:330-341`, formatter prompt `:342-592`, definisi tool `:593-621`, subprocess `:622-766`, `execute_ref_extractor` `:767-944`, tes `:945-1331` | **Perlu dipecah**: parser + subprocess + template prompt + I/O + response. |
| `tool/film_feedback.rs` | 1.280 / 1.194 | — | Legacy, satu domain umpan balik film dengan tes besar. |
| `studio/preview_capture.rs` | 1.247 / 1.165 | state digest `:36-76`, policy `:57-158`, timestamp `:182-302`, `run_cdp_preview_capture` `:378-710` (333 baris), orkestrasi+rollback `:711-959`, tes `:960-1247` | **Perlu justifikasi atau split**: satu domain capture, tetapi CDP + static server + policy + anti-cheat digabung. |
| `pages/AnalyticsPage.tsx` | 1.058 / 989 | state+localStorage `:113-153`, 7 state draft `:130-147`, data telemetri **mock** `:261-320`, 3 tab `:327-375`, modal OAuth/token `:737-1038` | **Perlu dipecah**; juga melanggar §5.2.6-7 pada `:140-148` (`useEffect` menyalin nilai turunan ke state draft). |
| `tool/ref_filmstrip.rs` (**baru**) | 379 / 354 | `generate_filmstrips` `:207-385` (~178 baris): decode video, delta motion, mapping scene, render sheet, statistik, tulis JSON | Kohesif per domain, tapi padat; tidak melewati pemicu 500 baris Rust. |

## 4. Pelanggaran legacy pada file besar (dilaporkan, tidak diubah)

| Area | Temuan | Bukti ringkas |
|---|---|---|
| Frontend §5.2.5 | 193 `any` AST repo-wide, 49 di 16 file >600 baris | `lib/engine.ts:209,345,349,373,377,383,414,422,543,545,546,549,568,577,889,911`; `useCliConnections.ts` 13 (11 `catch (err: any)`); `useWorkstationChat.ts` 8 |
| Frontend §5.2.10-11 | 12 index key; 0 `fetch` bypass adapter | `<div>/<span onClick>` 31 contoh, mis. `StockVaultPage.tsx:252`, `ChatMessageBubble.tsx:464,549`, `ClipEditModal.tsx:187,194`; 32 tombol ikon tanpa `aria-label` (kebanyakan hanya `title=`) |
| Frontend §5.2.6-7 | derived-state via `useEffect`, cleanup tidak lengkap | `AnalyticsPage.tsx:140-148`, `ClipEditModal.tsx:81-114`, `AudioPresetPanel.tsx:87-113`; `useWorkstationChat.ts:240-281` RAF tanpa `cancelAnimationFrame`; `useMicrostockStore.ts:792,804,808,812,816,820,825` listener level modul tanpa teardown |
| Frontend §5.2.12 | `memo` tidak berguna | `AnalyticsPage.tsx:104`, `StockVaultPage.tsx:22`, `SchedulePage.tsx:18` — komponen tanpa props |
| Frontend §6.2-3 | 17 hex berbeda / 77 kemunculan di 8 file besar; hijau masih ada | `AnalyticsPage.tsx:285,291,331,346,426`, `TimelineHeaderToolbar.tsx:229,761`, `ClipEditModal.tsx:57,91,96`; `AppFooter.tsx:34,37` (`#A3E635`, `#F0FDF4`, `#F7FEE7`) — dilarang `AGENTS.md:232` |
| Rust §5.3.11 | 43 situs `std::fs` di dalam `async fn` (14 non-test, 29 test) | `tool/ref_extractor.rs:826,873`, `tool/film_audio.rs:635,743`, `direct_scene_remake.rs:1411,1423`, dll. |
| Rust §5.3.10 | 12 `#[allow(...)]` di file target, sebagian tanpa alasan | `direct_scene_prompt.rs:139`, `direct_scene_remake.rs:564,1395`, `runner.rs:1853`, `preview_film.rs:103`, `step_http.rs:56`, `vision.rs:567,620` |
| Rust §5.3.9 | 9 blok `unsafe`, hanya 2 `SAFETY:` | `desktop/window.rs:104,163`, `src-tauri/src/lib.rs:110,137`, dll.; tidak ada di 38 file besar yang diaudit |
| Rust §5.3.12 | `std::sync::Mutex` legacy | `messaging/mod.rs:19`, `session/routes.rs:14`, `preview_capture.rs:20,844-848` — guard dilepas sebelum `.await`, jadi **tidak ada pelanggaran aktif** |
| Python §4 | Default ke `workspace/` bawaan repo | `ref_extractor.py:2183-2184`, `sfx_engine.py:262-268`, `voicebox_engine.py:1771,1794` |
| Python (luar scope) | CORS `*` + credentials | `voicebox_engine.py:1723-1729` |

Tidak ditemukan: `@ts-ignore`, `@ts-expect-error`, `dangerouslySetInnerHTML`, impor alias `@/`, `panic!`/`unwrap` di jalur input pengguna file besar, rute axum `{id}`, atau `tracing::` di engine. `forwardRef` warisan (12) secara eksplisit dibolehkan `AGENTS.md:186`.

## 5. Rekomendasi (tanpa eksekusi)

1. **Sebelum fitur baru apa pun**: perbaiki P0 (`direct_scene_remake.rs:452-453` tambah `contains_path(ws_root, &p)` mengikuti `ref_filmstrip.rs:229,234`) dan P1 (`preview_film.rs:146` → `tokio::fs`).
2. **Perbarui `AGENTS.md`** pada bagian 1 dan angka baseline bagian 3/5 agar tidak menyesatkan agen berikutnya; sebutkan satuan baris (fisik vs non-kosong) dan koreksi klaim CI.
3. **Jangan refactor file ribuan baris sebagai "cleanup"**. `direct_scene_remake.rs`, `runner.rs`, `useWorkstationChat.ts`, dan `ref_extractor.py` memerlukan tugas pemecahan tersendiri dengan tes sebelum/sesudah; `AGENTS.md:150` melarang menambah fitur langsung ke dalamnya.
4. Untuk Python baru: ubah `except Exception:` di `ref_extractor.py:1829-1866` menjadi log + fallthrough yang terdengar, dan tambahkan assertion filmstrip di `test_ref_extractor_and_compare.py:36-62`.
5. Biarkan pelanggaran legacy bagian 4 tetap apa adanya sampai ada tugas yang menargetkannya, sesuai `AGENTS.md:25`.

## Verifikasi

```
Status: Selesai (audit statis; tidak ada perubahan kode)
Berubah: Membuat docs/laporan-audit-kepatuhan-agents-file-besar.md; tidak ada file kode yang disentuh.
Diverifikasi: git status/diff + baca kode + grep + hitung baris -> temuan di atas; npm run typecheck -> lolos; npx vitest run (apps) -> 32 file / 126 tes lolos; cargo fmt --check (read-only) -> 219 file tidak bersih.
E2E: tidak berlaku — audit dokumentasi, tidak mengubah perilaku runtime (AGENTS.md:67).
Tidak diverifikasi: eksekusi `cargo test --workspace`, build engine, dan E2E API/Playwright (tidak ada perubahan runtime yang diuji; gate CI ter-track bertentangan dengan klaim AGENTS.md:34).
Temuan di luar scope: CI ter-track meski AGENTS.md:34 menyatakan tidak ada; CORS `*`+credentials di `core/voicebox/voicebox_engine.py:1723-1729` (legacy).
```
