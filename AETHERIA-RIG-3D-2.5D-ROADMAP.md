# Aetheria Rig — Roadmap & Arsitektur Mesin Penggerak 3D & 2.5D Berbasis Rust

Dokumen arah pengembangan untuk membangun **mesin penggerak (*rigging, IK, motion, & toon renderer*) 3D dan 2.5D murni Rust** di dalam **Aetheria Nexus** (`E:\JS\Aetheria`), dengan gaya visual terinspirasi dari skill **`3D-stickman`** dan **`stikman-cerita` (Ghibli Chibi)** — ringan seperti "mini-Blender khusus gerak", tanpa menginstal Blender eksternal dan tanpa beban Chromium saat ekspor video.

---

## 1. Visi, Masalah, & Batasan Ruang Lingkup

### Masalah yang Diselesaikan
1. **Skill Python `3D-stickman` (`E:\stikman-cerita\3D-stickman\scripts\engine3d.py`)** sudah punya estetika karakter 3D chibi bertinta + wajah 2D ekspresif yang kuat, tetapi:
   - Render CPU software berbasis Python + NumPy lambat untuk durasi panjang/1080p.
   - Gerak karakter masih terbatas (belum punya hierarki tulang IK penuh, *ground-lock* antislip, *multi-layer blending*, *spring-bone physics*, maupun impor motion-capture `.bvh`/Mixamo).
2. **Blender eksternal** terlalu berat untuk dibundel ke aplikasi desktop portable (±369 MB, ~1 dtk/frame di RX Vega 11) dan berlebihan karena 90% fitur Blender (sculpting, UV, fluid, Cycles raytracing) tidak dibutuhkan oleh Aetheria.
3. **Aetheria** sudah memiliki ~70% infrastruktur studio lokal (`core/aetheria-engine/src/studio/native_renderer.rs` pipa raw RGBA ke FFmpeg, deteksi GPU `gpu.rs`, isolasi proyek `project_registry.rs`, audio/VO, UI React, dan agent orchestrator `runner.rs`).

### Tujuan Utama
Membangun crate Rust mandiri **`core/aetheria-rig/`** yang menjadi **mesin penggerak & renderer GPU 3D/2.5D** di Aetheria:
- **Ukuran tambahan biner:** ±5–10 MB (dibundel langsung ke `aetheria-engine`).
- **Kecepatan render:** target **2–6 ms/frame** di GPU terintegrasi (AMD Radeon RX Vega 11 / Intel UHD / NVIDIA) via `wgpu` (DX12/Vulkan) → video 12 detik 1080p selesai dalam hitungan detik langsung ke pipa `ffmpeg`.
- **Gerak penuh seluruh tubuh:** semua sendi bergerak independen (pinggul, pinggang, dada, bahu, siku, pergelangan tangan, paha, lutut, pergelangan kaki, leher, kepala) + **2-Bone IK + Ground Lock** + **Secondary Spring Physics** + **Putar 360° mulus** + **impor mocap `.bvh` / Mixamo**.
- **Dua mode gaya dalam 1 mesin:**
  1. **Mode 3D-Stickman**: kepala bola halus 3D + wajah 2D ekspresif (39 ekspresi + lipsync VO) terbungkus melengkung di depan kepala + rambut afro/hijab/jambul 3D + badan & sendi halus + *inverted-hull ink outline* + *2-band cel shading* + diorama 3D.
  2. **Mode 2.5D Ghibli Chibi**: karakter 3D/2.5D toon menyatu dengan latar lukisan berlapis (*watercolor parallax cards* & properti 2.5D) dalam satu kamera perspektif 3D.

### Batasan Keras (Yang TIDAK Akan Dibangun)
Agar proyek tetap ringan, fokus, dan selesai dalam hitungan minggu (bukan tahun):
- **TIDAK** membangun editor *mesh modeling*, *sculpting*, *UV unwrapping*, atau *node-graph shader UI*.
- **TIDAK** membangun *path-tracing / raytracing*, simulasi cairan, asap, atau kain *finite-element* berat.
- **TIDAK** menyalin aset/kode benchmark (`benchmarks/`) secara statis ke engine (patuh `AGENTS.md` §1 & `fidelity_guard.rs`).
- Seluruh kontrol diarahkan lewat **skema JSON deklaratif (`rig-film.json`)**, **AI Agent Aetheria**, dan **kontrol timeline/preview ringan** di UI Studio.

---

## 2. Arsitektur & Peta Modul (Patuh `AGENTS.md` §4 & §5)

### Penambahan Workspace Member
Tambahkan `core/aetheria-rig` ke `Cargo.toml` root (1 tanggung jawab per file, target <400–500 baris/modul, dependensi satu arah tanpa siklus):

```text
core/
├── aetheria-rig/                    # Crate baru: mesin tulang, gerak, karakter, & GPU toon renderer
│   ├── Cargo.toml                   # glam, wgpu, bytemuck, serde, serde_json, image, tiny-skia (semua MIT/Apache-2.0, kompatibel GPL-3.0-or-later)
│   └── src/
│       ├── lib.rs                   # Permukaan publik minimal: RigScene, RigRenderer, render_frame_rgba()
│       ├── schema.rs                # Kontrak JSON (RigFilmSpec, ActorSpec, TrackSpec, CameraSpec, StageSpec)
│       ├── skeleton.rs              # Hierarki 20 tulang (FK world matrices, bind pose, Dual-Quaternion / LBS skinning)
│       ├── ik.rs                    # Analytic 2-Bone IK (kaki & tangan) + Ground Lock (kaki 0 slip di y=0) + Pole Vector
│       ├── spring.rs                # Secondary motion spring-damper (afro bounce, hijab/kuncir, dasi kupu-kupu)
│       ├── motion.rs                # Keyframe Bezier, Multi-Layer Pose Blending (Lower / Upper / Face), easing
│       ├── procedural.rs            # Generator gerak bawaan (jalan tegak, lari, duduk hadap depan 0°, bangun, lambai, putar 360°, idle napas, micro-gesture bicara)
│       ├── bvh.rs                   # Parser & retargeter file motion-capture .bvh (Mixamo / CMU) -> 20-bone rig
│       ├── mesh.rs                  # Generator primitif halus (sphere, capsule, rounded-box, tapered-limb, curved-face-patch) + smooth vertex normals
│       ├── character.rs             # Builder preset gaya 3D-stickman & 2.5D Ghibli (Kribo, Habibie, Bos, Nadia, Sari, Raka, dll.)
│       ├── face_atlas.rs            # Rasterizer wajah 2D ekspresif (39 ekspresi, mata kedip/lirik, alis, mulut lipsync VO, kacamata) via tiny-skia -> tekstur GPU
│       ├── stage.rs                 # Set 3D diorama & mode 2.5D parallax backdrop (lantai, bangku/meja/properti 3D, lukisan latar berlapis, contact shadow)
│       ├── camera.rs                # Kamera 3D sinematik (push, pull, orbit, crane, tracking, OTS, rule-of-thirds, roll, shake)
│       ├── renderer.rs              # Headless wgpu device/pipeline, MSAA 4x, offscreen RGBA readback (tanpa window OS!)
│       └── shaders/
│           ├── outline.wgsl         # Pass 1: Inverted-hull toon outline (backface-culled, screen-space clamped anti-spike!)
│           ├── toon.wgsl            # Pass 2: 2-band Ghibli cel shading + rim light + curved 2D face texture + fog jarak
│           └── shadow_25d.wgsl      # Pass 3: Soft radial contact shadow & 2.5D alpha-blended parallax cards
└── aetheria-engine/
    └── src/studio/
        ├── rig_bridge.rs            # Sambungan tipis baru: validasi path guard -> panggil aetheria-rig -> pipe RGBA ke FFmpeg / preview PNG
        ├── native_renderer.rs       # (Eksisting) Pipa raw RGBA -> FFmpeg stdin (h264_amf / h264_nvenc / libx264)
        └── mod.rs                   # (Eksisting) Tambah 3 route tipis: /api/studio/rig/preview, /api/studio/rig/render, /api/studio/rig/presets
```

### Aturan Isolasi & Keamanan (`AGENTS.md` §4)
- Semua path input/output proyek (`rig-film.json`, file `.bvh`, backdrop kustom, hasil `.mp4`) **wajib** divalidasi lewat `contains_path` (`core/aetheria-engine/src/paths.rs`) dan `resolve_isolated_path` (`core/aetheria-engine/src/tool/path_guard.rs`).
- Tidak pernah memuat asset dari `workspace/` secara statis saat kompilasi.

---

## 3. Desain Teknis 4 Pilar Utama

### Pilar 1: Hierarki 20 Tulang, 2-Bone IK, & Fisika Susulan (`skeleton.rs`, `ik.rs`, `spring.rs`)
Sistem koordinat kanan-tangan (`+Y` atas, `+Z` depan menghadap kamera, `Y = 0.0` lantai dunia, satuan meter — seragam dengan `3D-stickman`):

```text
Root (posisi dunia X/Y/Z + yaw 0..360°)
└── Pelvis (weight-shift, squat/sit drop, hip sway)
    ├── SpineLower → SpineUpper/Chest → Neck → Head
    │   ├── HairSpring (fisika membal afro / kuncir / hijab)
    │   ├── BowtieSpring (goyang halus dasi)
    │   └── FaceRig (ekspresi, kedip, arah lirik, bukaan mulut VO)
    ├── Clavicle.L → UpperArm.L → ForeArm.L → Hand.L   [opsi 2-Bone IK target tangan]
    ├── Clavicle.R → UpperArm.R → ForeArm.R → Hand.R   [opsi 2-Bone IK target tangan]
    ├── Thigh.L → Shin.L → Foot.L → Toe.L              [2-Bone IK + Ground Lock y=0]
    └── Thigh.R → Shin.R → Foot.R → Toe.R              [2-Bone IK + Ground Lock y=0]
```

**Prinsip anti-kaku yang dikunci sejak awal:**
- **Roll & Sumbu Simetris**: seluruh tulang kiri/kanan memakai konvensi sumbu lokal konsisten (`+X` kanan, `+Y` sepanjang tulang, `+Z` depan) sehingga animasi simetris dan mudah diretarget.
- **Ground Lock**: saat fase *stance* berjalan atau duduk, posisi `IK_Foot` dikunci ke koordinat dunia lantai (`y = 0.0`) sehingga telapak sepatu **0 slip** walau `Pelvis` turun/naik atau `Root` maju.
- **Preserve Volume Skinning**: sendi lutut & siku memakai *Dual-Quaternion Skinning* (atau *blended capsule weights*) agar celana/lengan tidak menjepit saat menekuk 90° (duduk/lari).
- **Deterministic Spring Physics**: simulasi pegas `dt = 1/fps` disimulasikan deterministik dari frame `0` (atau pre-roll 12 frame) sehingga render acak per-frame (untuk QC/scrubbing) selalu menghasilkan gambar identik.

### Pilar 2: Multi-Layer Blending & Motion Capture (`motion.rs`, `procedural.rs`, `bvh.rs`)
Satu karakter bisa menjalankan **3 layer animasi secara bersamaan**:
1. **Layer 0 — Base / Lower Body**: `idle`, `walk` (tegak lurus anatomis), `run`, `sneak`, `sit_front` (duduk hadap depan `0°` di atas kursi/bangku 3D), `stand_up`, `jump_land`, `turn_360`, atau klip **`.bvh` Mixamo**.
2. **Layer 1 — Upper Body Override (Masked: `SpineUpper`, `Clavicle`, `Arm`, `Hand`, `Head`)**: `wave`, `point`, `shrug`, `think_chin`, `hold_prop`, `talk_gesture` — menimpa badan atas dengan bobot halus (`0.0..1.0`) tanpa mengganggu langkah kaki atau posisi duduk.
3. **Layer 2 — Face & Micro-Life**: kedip mata organik (seeded), lirik mata (*eye dart* ke arah target/kamera), **lipsync VO** otomatis dari amplop audio (`audio/`), dan 39 preset ekspresi wajah (`senang`, `tenang`, `kaget`, `mikir`, `marah`, `sedih`, `semangat`, `jahil`, dll.).

### Pilar 3: Gaya Visual 3D-Stickman × 2.5D Ghibli (`character.rs`, `face_atlas.rs`, `stage.rs`)
- **Kepala & Wajah 2D Melengkung (*Curved Face Patch*)**:
  - Diadopsi langsung dari keunggulan `3D-stickman`: wajah digambar tajam di kanvas 2D (`512×512` via `tiny-skia`: mata anime tajam/bulat, kacamata kotak/bulat, alis, blush, mulut lipsync) lalu diproyeksikan melengkung menempel mulus di permukaan depan bola kepala 3D — **0 tonjolan aneh saat dilihat dari profil samping**, tajam di semua sudut 360°!
  - Di-cache berdasarkan hash `(ekspresi, blink_step, mouth_open_step, look_step)` sehingga biaya rasterisasi hampir 0.
- **Outline Bersih Bebas Artefak (`outline.wgsl`)**:
  - Memakai *averaged smooth normals* (bukan *face normals* tajam di ujung silinder) + ketebalan dibatasi di *clip-space* agar garis tinta coklat-hangat/hitam tetap merata tipis baik saat *close-up* maupun *wide shot*, bebas *spike* seperti bug *Solidify* di Blender.
- **Mode 2.5D Ghibli**:
  - Mendukung latar lukisan cat air PNG berlapis (`depth_z`: langit, bukit jauh, bangunan/pagar, lantai/trotoar 3D, properti depan) sehingga karakter 3D toon terasa hidup di dalam dunia lukisan 2D Studio Ghibli — dengan bayangan kontak lunak di lantai.

### Pilar 4: Headless `wgpu` Renderer → Pipa FFmpeg Aetheria (`renderer.rs`, `rig_bridge.rs`)
- Inisialisasi `wgpu::Instance` headless (tanpa perlu membuat jendela OS; fallback otomatis DX12 → Vulkan → WARP software adapter bila di mesin tanpa GPU).
- Render ke offscreen texture `RGBA8Unorm` (MSAA 4× resolve) → salin ke staging buffer → langsung kirim slice `&[u8]` ke pipa `ffmpeg` stdin yang sudah ada di pola `core/aetheria-engine/src/studio/native_renderer.rs` (pilih `h264_amf` / `h264_nvenc` / `h264_qsv` / `libx264` sesuai `gpu.rs`).
- **Mode Preview Cepat UI**: endpoint `GET /api/studio/rig/preview?project=<slug>&t=<sec>&w=640` merender 1 frame dalam **<15 ms** (JPEG/PNG) untuk *timeline scrubbing* dan lembar QC otomatis oleh AI Agent!

---

## 4. Kontrak Adegan JSON (`rig-film.json`) & Integrasi Agent

Skema dibuat ringkas agar mudah ditulis oleh **AI Agent Aetheria** maupun **skill `.aetheria/skills/mg-rig-3d-stickman/`**:

```json
{
  "version": 1,
  "mode": "3d-stickman",
  "width": 1280,
  "height": 720,
  "fps": 24,
  "audio": { "vo": "audio/vo.wav", "bgm": "audio/bgm.mp3" },
  "stage": {
    "preset": "taman_ghibli_sore",
    "backdrop_25d": "assets/ghibli_street.png",
    "props": [
      { "id": "bangku_1", "kind": "park_bench", "pos": [1.6, 0.0, -0.24], "seat_height": 0.28 }
    ]
  },
  "actors": [
    {
      "id": "kribo",
      "preset": "kribo",
      "style_override": { "shirt": "#2c2e34", "bowtie": "#448a90", "pants": "#a4a8ae", "outline": "#2a201c" }
    }
  ],
  "timeline": [
    { "t": [0.0, 1.5], "actor": "kribo", "base": "idle", "upper": "wave", "yaw": 0, "expr": "senang" },
    { "t": [1.5, 2.0], "actor": "kribo", "base": "turn", "yaw_to": 90 },
    { "t": [2.0, 5.5], "actor": "kribo", "base": "walk", "move_to": [1.6, 0.0, 0.0], "yaw": 90 },
    { "t": [5.5, 6.2], "actor": "kribo", "base": "turn", "yaw_to": 0, "move_to": [1.6, 0.0, -0.14] },
    { "t": [6.2, 9.3], "actor": "kribo", "base": "sit_front", "target_prop": "bangku_1", "yaw": 0, "expr": "tenang" },
    { "t": [9.3, 12.0], "actor": "kribo", "base": "stand_then_turn_360", "yaw_to": 360 }
  ],
  "camera": [
    { "t": [0.0, 6.2], "mode": "track", "target": "kribo", "dist": 3.8, "fov": 38 },
    { "t": [6.2, 9.3], "mode": "orbit", "target": "kribo", "angle_deg": 18, "dist": 3.5 },
    { "t": [9.3, 12.0], "mode": "static_track", "target": "kribo", "dist": 3.8 }
  ]
}
```

---

## 5. Rencana Implementasi Bertahap (`langkah -> verifikasi`)

Seluruh pengembangan mengikuti aturan **Build Debug Harian** di `AGENTS.md` §3 (`npm run build:engine` ~4–5 dtk; dilarang `--release` untuk dev/E2E) dan gerbang verifikasi lengkap.

### Fase 0 — Fondasi Crate & Headless `wgpu` Smoke (1–2 hari)
- **Langkah:** Buat `core/aetheria-rig` di `Cargo.toml` workspace; setup `wgpu` headless offscreen RGBA + `shaders/toon.wgsl` + `shaders/outline.wgsl`; render 1 bola toon cel-shaded + outline ke buffer RGBA.
- **Verifikasi:** `cargo test -p aetheria-rig` lulus (pixel uji mengonfirmasi warna cel-shading & outline benar di buffer RGBA, jalan di DX12/Vulkan RX Vega 11 dalam <15 ms/frame).

### Fase 1 — Skeleton 20 Tulang, 2-Bone IK + Ground Lock, & Karakter Kribo (2–3 hari)
- **Langkah:** Implementasi `skeleton.rs`, `ik.rs`, `spring.rs`, `mesh.rs`, `character.rs` (preset `kribo` + 3 preset awal: `habibie`, `bos`, `nadia`), dan `face_atlas.rs` (wajah 2D ekspresif + kacamata + lipsync melengkung di kepala).
- **Verifikasi:** Unit test IK (error jarak kaki ke lantai `y=0` < `0.001 m` sepanjang siklus jalan & duduk), render otomatis 6 pose QC (`qc_sheet.png`: sapa, jalan contact, jalan passing tegak, duduk hadap depan, samping, belakang) dan inspeksi visual.

### Fase 2 — Multi-Layer Motion, Stage 3D/2.5D, & Pipa FFmpeg (2–3 hari)
- **Langkah:** Implementasi `motion.rs`, `procedural.rs`, `stage.rs` (bangku/meja 3D + mode backdrop 2.5D Ghibli parallax + soft radial contact shadow), `camera.rs`, serta `core/aetheria-engine/src/studio/rig_bridge.rs` yang menyambung frame RGBA langsung ke pipa `ffmpeg`.
- **Verifikasi:** Render demo 12 detik 1280×720 @ 24 fps (sapa → jalan tegak → duduk hadap depan → putar 360°) menghasilkan MP4 valid (`ffprobe` durasi/codec/fps tepat) dalam target **<10 detik** total waktu render.

### Fase 3 — Impor Mocap `.bvh` / Mixamo & Sinkronisasi VO Lipsync (2 hari)
- **Langkah:** Implementasi `bvh.rs` (retarget tulang Mixamo standar ke 20 tulang `aetheria-rig`) dan pembacaan amplop audio WAV/MP3 untuk mendorong bukaan mulut + *micro-gesture* bicara otomatis.
- **Verifikasi:** Unit test parser `.bvh` + uji render klip Mixamo (jalan/duduk/menunjuk) dengan audio VO tersinkron.

### Fase 4 — Integrasi API, UI Studio Preview, & Skill Agent Aetheria (2–3 hari)
- **Langkah:**
  - Tambah route tipis `/api/studio/rig/preview`, `/api/studio/rig/render`, `/api/studio/rig/presets` di `core/aetheria-engine/src/studio/mod.rs`.
  - Buat panel preview/scrubbing modular di `apps/src/components/studio/` (via `apiFetch`, tanpa `any`, lazy-loaded bila berat).
  - Buat skill baru `.aetheria/skills/mg-rig-3d-stickman/` agar AI Agent Aetheria bisa menyusun `rig-film.json`, mengecek lembar QC otomatis, lalu merender MP4 final.
- **Verifikasi E2E Wajib (`AGENTS.md` §3.1–3.3):**
  1. `npm run typecheck`, `npm run build`, `(cd apps && npx vitest run)`, `cargo test --workspace`.
  2. Hidupkan engine dev (`npm run build:engine` + engine hidup `GET /api/health` → `healthy: true`).
  3. Skenario API & Playwright E2E di `os.tmpdir()`: kirim `rig-film.json` valid → preview frame 200 OK → render MP4 selesai & valid; kirim payload/path tidak valid (`../escape`) → ditolak bersih dengan error jelas tanpa crash; jalankan 2× berturut-turut lulus tanpa error console/log.

### Fase 5 — Perluasan Katalog Karakter & Diorama (Berkelanjutan)
- Port seluruh 17+ preset pemeran dari `E:\stikman-cerita\3D-stickman` & `stikman-cerita` + 21 diorama 3D & set 2.5D Ghibli ke format data JSON/preset (data-driven, bukan hardcoded di Rust).

---

## 6. Perbandingan Target Performa

| Aspek | Python `3D-stickman` (`engine3d.py`) | Blender 4.2 Portable (`bpy`) | **Aetheria Rig (`core/aetheria-rig` Rust + `wgpu`)** |
|---|---|---|---|
| Ukuran tambahan | 0 MB (Python) | ±369 MB eksternal | **±5–10 MB** (menyatu di `.exe` Aetheria) |
| Kecepatan render (720p/1080p) | ~1–3 dtk/frame (CPU) | ~0,9 dtk/frame (~4,5 mnt / 12 dtk) | **~2–6 ms/frame (~2–5 dtk / 12 dtk)** |
| Gerak tubuh & kaki | Terbatas (tanpa IK penuh) | Penuh (berat & rumit) | **Penuh: 20 tulang + 2-Bone IK + Ground Lock + Spring + `.bvh` Mixamo** |
| Gaya visual | 3D-stickman + wajah 2D | 3D Toon EEVEE | **3D-stickman + 2.5D Ghibli Chibi dalam 1 mesin** |
| Kontrol UI & AI Agent | CLI terpisah | Headless script terpisah | **Langsung terintegrasi di UI Studio, Timeline, & Agent Aetheria** |

---

## 7. Rujukan & Modul Reuse Open-Source (`storytold/anicraft` & `storytold/texturecraft`)

Kedua repositori dari ekosistem ArtCraft ini **100% murni Rust** dan berlisensi ganda **`MIT OR Apache-2.0`** — sepenuhnya kompatibel dengan lisensi **`GPL-3.0-or-later`** milik Aetheria (wajib menyertakan atribusi MIT/Apache-2.0 di `ATTRIBUTION.md` / header file yang diadaptasi).

> **Aturan Integrasi Keras (Jangan `cargo add` Langsung!):**
> Baik `anicraft` maupun `texturecraft` memakai `edition = "2024"`, `resolver = "3"`, `rust-version = "1.95"`, UI `egui`, dan git deps `storytold/craft-libs`, sedangkan Aetheria memakai `edition = "2021"`, `resolver = "2"`, dan UI React + Tauri.
> **Selalu *cherry-pick* & adaptasi hanya file logika murni yang dibutuhkan** ke `core/aetheria-rig/` agar kompilasi cepat, biner tetap kecil, dan tidak menarik `egui`/dependensi asing.

### A. Modul Reuse dari `storytold/anicraft` (Animasi 2D, Fisika Pegas, & Lipsync)
| Sumber di `anicraft` | Kegunaan di `core/aetheria-rig` | Fase |
|---|---|---|
| `crates/audio/src/analysis.rs` (687 baris) | **Auto Lip-Sync Viseme (A/I/U/E/O/M/F)** + amplop RMS berbasis formant FFT (*Peterson & Barney*), 0 model AI, 100% deterministik → untuk wajah 2D ekspresif & lipsync VO. | Fase 3 |
| `crates/doc/src/spring.rs` (185 baris) | **Stateless Deterministic Bone Springs** (backward Euler 4 substep + jendela *taper*) → fisika membal afro, hijab/kuncir, dan dasi kupu-kupu yang **identik bit-per-bit saat scrubbing acak**. | Fase 1 |
| `crates/doc/src/easing.rs` & `motion/retime.rs` | 9 keluarga easing (`Quad`–`Elastic`), `CubicBezier`, `CustomEase` (dengan overshoot), & retiming kurva keyframe. | Fase 2 |
| `crates/doc/src/armature.rs` & `skin.rs` (336 baris) | Algoritma **CCD IK + joint limits + joint slide** dan **Linear Blend Skinning (LBS)** untuk melengkungkan part/vektor pada **mode 2.5D**. | Fase 1–2 |
| `crates/gpu/Cargo.toml` (pola `naga` dev-dep) | Validasi otomatis seluruh shader `.wgsl` di dalam `cargo test` agar bebas error lintas-backend (DX12/Vulkan). | Fase 0 |

### B. Modul Reuse dari `storytold/texturecraft` (Infrastruktur 3D `wgpu`, Readback, & Importer)
| Sumber di `texturecraft` | Kegunaan di `core/aetheria-rig` | Fase |
|---|---|---|
| `crates/render/src/headless.rs` & `readback.rs` | Boilerplate **inisialisasi `wgpu` headless (tanpa window OS)** + **GPU-to-CPU RGBA buffer readback** berkecepatan tinggi → langsung disambung ke pipa `ffmpeg` di `rig_bridge.rs`. | Fase 0 |
| `crates/geom/src/camera.rs`, `mesh.rs`, & `primitives.rs` | **Kamera 3D `glam`** (perspektif/orbit) dan struktur mesh + primitif 3D bersih untuk panggung & properti. | Fase 0–1 |
| `crates/render/src/shaders/shadow.wgsl` | Pola **shadow map GPU** ringan bila kelak ingin menambah bayangan proyeksi nyata selain *soft radial contact shadow*. | Fase 2 |
| `crates/formats/src/mesh_import/` (`gltf.rs`, `fbx.rs`, `obj.rs`) | Rujukan parser murni Rust untuk **impor properti/karakter 3D eksternal** (glTF, FBX, OBJ) di luar primitif bawaan. | Fase 3–5 |
| `crates/compose/src/` (`timber.rs`, `fabric.rs`, `organic.rs`, `environment_sky.rs`) | Generator prosedural **serat kayu, kain, noise organik/cat air, & langit** murni kode (tanpa paket tekstur besar) untuk memperkaya properti & diorama Ghibli. | Fase 2–5 |

### C. Bagian Inti yang Tetap Dibangun Khusus oleh Aetheria (Tidak Ada di Keduanya)
1. **Hierarki 20 Tulang 3D (`glam` Mat4/Quat) + 3D 2-Bone IK + Ground Lock** (`skeleton.rs`, `ik.rs`).
2. **Multi-Layer Motion Blending & Retargeter `.bvh`/Mixamo 3D** (`motion.rs`, `procedural.rs`, `bvh.rs`).
3. **Builder Karakter Gaya `3D-stickman` & `2.5D Ghibli Chibi` + Wajah 2D Melengkung (`face_atlas.rs`)**.
4. **Shader Toon 2-Band Ghibli + *Inverted-Hull Outline* 3D Bebas *Spike*** (`toon.wgsl`, `outline.wgsl`).

---

## 8. Keputusan Awal Sebelum Mulai Coding (Fase 0)

1. **Prioritas gaya visual Fase 1:** Apakah MVP Fase 1 langsung mendukung **keduanya** (*3D-stickman* + *backdrop 2.5D Ghibli*), atau fokus *3D-stickman* penuh dulu baru *2.5D parallax* di Fase 2? *(Disarankan: 3D-stickman + 1 card backdrop 2.5D Ghibli sejak Fase 1 karena biayanya hanya 1 quad bertekstur di `wgpu`.)*
2. **Backend rasterisasi wajah 2D (`face_atlas.rs`):** Memakai `tiny-skia` (murni Rust, MIT/BSD, tanpa dependensi C/system font rumit) agar kompilasi Windows cepat & deterministik.
3. **Target hardware utama:** Tetap diverifikasi langsung di AMD Radeon RX Vega 11 (DX12/Vulkan) dan jalur fallback software untuk tes headless.
