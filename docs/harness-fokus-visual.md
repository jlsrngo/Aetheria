# Harness Fokus Visual & Gerak (F0–F7)

Dokumen ini merangkum perubahan arsitektur harness pada `aetheria-engine` (`F0` hingga `F6` mulai commit `7861f99` sampai `52892f1`) untuk mengurangi beban non-kreatif pada LLM, menegakkan aturan kritis secara deterministik di level tool/engine, dan memangkas noise konteks tanpa menurunkan kemampuan desain visual atau gerak.

> **Catatan Evaluasi Kualitas:** Angka di dokumen ini adalah pengukuran ukuran konteks, mekanisme tool, dan sinkronisasi teknis. Peningkatan kualitas visual/gerak output hanya boleh dinilai melalui evaluasi buta manusia pada eksperimen A/B (`F8`).

---

## 1. Pemetaan Aturan Lama → Penegakan Engine (`F1`–`F6`)

| Fase | Aturan Lama (Instruksi Prompt / Prose) | Ditegakkan Oleh (Kode & Validasi Engine) | Berkas Utama |
|---|---|---|---|
| **F1** | Daftar manual 42 nama API `AM.*` dan kontrak boilerplate `index.html` diulang di `default.txt` + semua 16 skill `mg-*` | Satu sumber kebenaran [`.aetheria/reference/AM_API.md`](../.aetheria/reference/AM_API.md) yang diuji paritas 51 ekspor terhadap [`aetheria-motion.js`](../apps/public/script/aetheria-motion.js); disuntikkan selektif hanya pada subagent `motion-designer` & turn video koordinator (`should_inject_am_api_reference`); `skill-lint` di Vitest melarang regresi boilerplate pada seluruh 16 skill `mg-*` | [`context.rs`](../core/aetheria-engine/src/session/agent_turn/context.rs), [`subagent_store.rs`](../core/aetheria-engine/src/session/agent_turn/subagent_store.rs), [`command_resolvers.rs`](../core/aetheria-engine/src/session/agent_turn/command_resolvers.rs), [`motionHarnessSpec.test.ts`](../apps/src/lib/motionHarnessSpec.test.ts) |
| **F2** | LLM diminta membaca `.words.json`, menghitung durasi audio, mencegah `duration < wavDur`, serta diingatkan soal pelafalan & remapping jeda | Tool deterministik [`film_audio`](../core/aetheria-engine/src/tool/film_audio.rs) + validator `validate_scenes_audio_durations` di [`film_scaffold.rs`](../core/aetheria-engine/src/tool/film_scaffold.rs) membaca durasi RIFF WAV aktual (`read_wav_duration_secs`), otomatis menghitung `duration = wav + 0.6s` buffer, menolak `AUDIO_LONGER_THAN_SCENE` / `MICROSTOCK_AUDIO_FORBIDDEN`; `voicebox_engine.py` melakukan `remap_word_timings` pada `WordBoundary` `edge-neural` pasca trim/pause-compress + `--workspace` scoping lexicon | [`film_audio.rs`](../core/aetheria-engine/src/tool/film_audio.rs), [`film_scaffold.rs`](../core/aetheria-engine/src/tool/film_scaffold.rs), [`voicebox_engine.py`](../core/voicebox/voicebox_engine.py) |
| **F3** | Larangan prose agar agent video tidak memakai `bash`, `codemode`, `apply_patch`, atau `websearch`, sementara `qa-verifier` jatuh ke `_ => true` (30 tool) | Allowlist berbasis peran di [`profiles.rs`](../core/aetheria-engine/src/tool/profiles.rs) (`director` = `10` tool + `render_video` kondisional, `motion-designer` = `8` tool, `qa-verifier` = `7` tool, `audio-director` = `5`, `explore` = `5`, `general` = `29`) beserta snapshot unit test | [`profiles.rs`](../core/aetheria-engine/src/tool/profiles.rs), [`runner.rs`](../core/aetheria-engine/src/session/agent_turn/runner.rs), [`subagent_store.rs`](../core/aetheria-engine/src/session/agent_turn/subagent_store.rs) |
| **F4** | LLM diimbau menghindari patch `edit` rapuh dan kadang terpotong batas output `4096` token pada `motion-designer` | `validate_edit_strategy` di [`edit.rs`](../core/aetheria-engine/src/tool/edit.rs) menolak `oldString` > 25 baris tanpa `startLine`/`endLine` (mengarahkan ke `write` penuh atau `grep` + `startLine`/`endLine`); `resolve_subagent_max_tokens` menaikkan default terukur `motion-designer` menjadi `12288` (di-clamp ke `model.limit.output`, role lain tetap `4096`), konfigurasi per-peran `agent.<id>.max_tokens` & hook opt-in `agent.<id>.reasoning` (diabaikan bersih dengan log bila model tak mendukung; default global tak diubah) | [`edit.rs`](../core/aetheria-engine/src/tool/edit.rs), [`subagent_provider.rs`](../core/aetheria-engine/src/session/agent_turn/subagent_provider.rs), [`subagent.rs`](../core/aetheria-engine/src/session/agent_turn/subagent.rs), [`antigravity.rs`](../core/aetheria-engine/src/bridge/antigravity.rs), [`codex.rs`](../core/aetheria-engine/src/bridge/codex.rs) |
| **F5** | LLM mengandalkan `todowrite` untuk melacak scene dan bisa mengklaim selesai saat masih ada stub atau gagal edit | [`film_state.rs`](../core/aetheria-engine/src/tool/film_state.rs) menghitung `sceneProgress` berbasis disk (`missing`, `stub`, `drafted`, `previewed` + hash SHA-256 di `.aetheria/preview/preview_state.json`) pada hasil `film_scaffold`, `capture_film_preview`, dan `write`/`edit`; `film_feedback.rs` mengecek `MISSING_REGISTER_SCENE` dan ketidakcocokan ID per-file `film.json`; `runner.rs`, `turn_finalize.rs`, dan `subagent.rs` memblokir/menandai `[Verification notice: ...]` bila masih ada error tool atau scene `stub`/`missing` | [`film_state.rs`](../core/aetheria-engine/src/tool/film_state.rs), [`film_feedback.rs`](../core/aetheria-engine/src/tool/film_feedback.rs), [`preview_capture.rs`](../core/aetheria-engine/src/studio/preview_capture.rs), [`history.rs`](../core/aetheria-engine/src/session/agent_turn/history.rs), [`runner.rs`](../core/aetheria-engine/src/session/agent_turn/runner.rs), [`turn_finalize.rs`](../core/aetheria-engine/src/session/agent_turn/turn_finalize.rs) |
| **F6** | Semua catatan `knowledge_base`, `living_memory` (hingga 40 file), 18 katalog skill verbose, dan `plugin_rules` disuntikkan mentah ke setiap turn | [`dynamic_context.rs`](../core/aetheria-engine/src/session/agent_turn/dynamic_context.rs) memfilter relevansi berdasarkan intent turn (nol blok dinamis pada greeting, tanpa katalog motion skill pada prompt non-video, hanya skill relevan saat `/mg-*` eksplisit) dan membatasi tiap blok (`maxLivingMemoryChars=900`, `maxKnowledgeChars=1500`, `maxSkillsChars=1600`, `maxPluginRulesChars=1500`, `maxDynamicChars=3500`) dengan log `[F6_CONTEXT_CAP]` & `[F6_DYNAMIC_CONTEXT]` | [`dynamic_context.rs`](../core/aetheria-engine/src/session/agent_turn/dynamic_context.rs), [`context.rs`](../core/aetheria-engine/src/session/agent_turn/context.rs), [`runner.rs`](../core/aetheria-engine/src/session/agent_turn/runner.rs) |

---

## 2. Pengukuran Sebelum (F0 `7861f99`) vs Sesudah (F6 `52892f1`)

Semua taksiran token memakai rumus kasar `ceil(karakter / 4)` via [`scripts/measure-harness-context.mjs`](../scripts/measure-harness-context.mjs).

### 2.1 Ukuran Prompt & Skema Tool

| Komponen | Sebelum (`F0`, `7861f99`) | Sesudah (`F6`, `52892f1`) | Catatan |
|---|---:|---:|---|
| `default.txt` (statis) | `19,482` chr (~`4,871` tok, 122 baris) | `16,741` chr (~`4,186` tok, 102 baris) | `-2,741` chr (kontrak `AM_API` dipindah ke referensi selektif `5,323` chr) |
| Koordinator video (`director`) | `28` tool (`33,078` chr / ~`8,270` tok) | `10` tool (`16,442` chr / ~`4,111` tok) | `-50.3%` skema tool JSON (`render_video` kondisional → `11`) |
| `subagent:motion-designer` | `12` tool (`15,060` chr / ~`3,765` tok) | `8` tool (`10,951` chr / ~`2,738` tok) | Tanpa `bash`, `codemode`, `apply_patch`, `websearch` |
| `subagent:qa-verifier` | `29` tool (`37,100` chr / ~`9,275` tok) | `7` tool (`10,050` chr / ~`2,513` tok) | `-72.9%` skema tool JSON |
| `mg-soft-clay-story/SKILL.md` | `12,199` chr (`43,922` total skill) | `8,955` chr (`40,678` total skill) | Seluruh 16 skill `mg-*` dibersihkan dari duplikasi runtime/Remotion |

### 2.2 Blok Dinamis pada Workspace Contoh (`E:\JS\Aetheria-Workspace`)

| Mode Turn | Sebelum (`F0` raw) | Sesudah (`F6`) | Penurunan |
|---|---:|---:|---:|
| Greeting (`"halo"`) | `5,073` chr (~`1,269` tok) | `0` chr (~`0` tok) | `-100%` |
| Turn non-video | `5,073` chr (~`1,269` tok) | `427` chr (~`107` tok) | `-91.6%` |
| Video `/mg-soft-clay-story` eksplisit | `5,073` chr (~`1,269` tok) | `715` chr (~`179` tok) | `-85.9%` |
| Video tanpa gaya (katalog terkompresi) | `5,073` chr (~`1,269` tok) | `2,027` chr (~`507` tok) | `-60.0%` |

### 2.3 Audio & Token Budget (`F2` & `F4` Terukur)

- **`edge-neural` remapping (`F2`):** `last_word_to_wav_end_ms` pada 3 narasi ID membaik dari overshoot `[-877, -849, -797]` ms menjadi `[20.0, 20.0, 20.0]` ms; error jeda pasca pause turun dari median `85` ms ke `50` ms dan p95 keseluruhan turun dari `558.0` ms ke `390.5` ms; normalizer + lexicon scoping teruji lewat [`core/voicebox/test_voicebox_sync_and_normalizer.py`](../core/voicebox/test_voicebox_sync_and_normalizer.py) (`3/3 OK`). Temuan T11: overlap antar-scene saat ekspor MP4 pada `ffmpeg_pipeline.rs` (`atrim` belum diubah di F2) tercatat untuk evaluasi terpisah.
- **Batas output `motion-designer` (`F4`):** Pada data historis `sessions-store.json` (`22` sesi `motion-designer`), `5/22` (`22.7%`, `6` hits) membentur limit `4096` (ukuran write P90 = `9,913` chr, max = `12,511` chr). Pada 2 uji hidup berjeda di `4096` (`mg-soft-clay-story` & `mg-kinetic-type`), `[F4_LENGTH_LIMIT]` muncul pada step 12 (`text_chars=0`) dan step 7 (`text_chars=410`). Setelah default `motion-designer` disesuaikan menjadi `12288` (dengan clamp `model.limit.output`), run E2E 3-scene selesai dalam 6–8 langkah dengan `length_hits=0`.

---

## 3. Verifikasi & Skrip E2E per Fase

- **Unit & Lint Statis:**
  - `cargo test --workspace` (`5` desktop + `251` engine pass, `1` ignored live edge-tts)
  - `npm run typecheck`, `npm run build`, dan `(cd apps && npx vitest run)` (`26` file / `102` tes termasuk [`motionHarnessSpec.test.ts`](../apps/src/lib/motionHarnessSpec.test.ts))
- **E2E End-to-End (tiap fase lulus 2× beruntun sebelum commit):**
  - F1: [`scripts/test-f1-dedupe-e2e.mjs`](../scripts/test-f1-dedupe-e2e.mjs)
  - F2: [`scripts/measure-audio-sync.py`](../scripts/measure-audio-sync.py), [`scripts/test-f2-audio-e2e.mjs`](../scripts/test-f2-audio-e2e.mjs)
  - F3: [`scripts/test-f3-profiles-e2e.mjs`](../scripts/test-f3-profiles-e2e.mjs)
  - F4: [`scripts/measure-f4-subagent-tokens.mjs`](../scripts/measure-f4-subagent-tokens.mjs), [`scripts/test-f4-edit-tokens-e2e.mjs`](../scripts/test-f4-edit-tokens-e2e.mjs)
  - F5: [`scripts/test-f5-scene-state-e2e.mjs`](../scripts/test-f5-scene-state-e2e.mjs)
  - F6: [`scripts/test-f6-dynamic-context-e2e.mjs`](../scripts/test-f6-dynamic-context-e2e.mjs)
