# Backlog Integrasi Sosial, Analitik, Penjadwalan, dan Akun

Dokumen pelacakan item UI dan integrasi eksternal yang saat ini **ditunda** agar fokus penuh terlebih dahulu pada pembuatan video, audio, keandalan engine/tools, dan editor Studio.

> **Status Global:** `akan dikerjakan`

---

## Arsitektur Target: Antrean Lokal + Multi-Adapter API (`SocialPublisher`)

1. **Stok & Antrean Tak Terbatas di Lokal (Tanpa LLM):**
   - Seluruh stok video (`MP4`), caption, hashtag, jam tayang, dan pelacakan status (`draft` → `scheduled_local` → `queued_provider` → `published` / `failed`) disimpan dan diatur secara deterministik oleh aplikasi + worker Rust (`nexus-scheduler`).
   - **Rolling Queue Window (mengatasi limit provider pihak ke-3):** untuk provider seperti Buffer Free yang membatasi 10 antrean per channel, worker Rust hanya mendorong beberapa jadwal terdekat (misalnya jendela H-12 / H-24 jam) sehingga batas 10 slot di Buffer tidak pernah penuh, sekaligus tetap aman bila aplikasi ditutup mendekati jam tayang.
   - **Tanpa Browser Crawling UI:** seluruh publikasi memakai jalur HTTP API deterministik (bukan klik UI otomatis lewat MCP browser) agar tidak rapuh, tidak boros token, dan tidak terkena challenge anti-bot.

2. **Peran LLM Terbatas di Menu Akun / Jadwal:**
   - LLM **tidak** dipakai untuk polling jadwal maupun eksekusi upload/posting.
   - LLM hanya dipanggil on-demand di menu Akun/Jadwal untuk membantu pembuatan dan optimasi **caption, hashtag, judul, variasi hook deskripsi**, serta ringkasan evaluasi konten.

3. **Dukungan Multi-Provider via Trait `SocialPublisher` (`core/aetheria-engine/src/studio/`):**
   - **Jalur API Platform Langsung (Direct OAuth / BYO API Key):**
     - **TikTok:** Content Posting API (`open.tiktokapis.com`) + metrik performa akun (views, likes, followers).
     - **YouTube:** YouTube Data API v3 (upload video/Shorts, `publishAt` scheduling) + YouTube Analytics API.
     - **Instagram:** Instagram Graph API (Reels media container + publish + IG Insights).
   - **Jalur Pihak ke-3 (Aggregator BYO API Key / MCP):**
     - **Buffer GraphQL API (utama untuk posting):** mendukung koneksi multi-channel (TikTok/YT/IG) memakai *rolling push* dari antrean lokal agar bebas limit 10 antrean pada paket Free (`$0`) dan tanpa batas 20 post/bulan.
     - **Metricool MCP Server (khusus analitik `$0`, on-demand):** dipakai hanya untuk membaca metrik akun, performa konten, dan rekomendasi *best time to post* di menu Analitik/asisten LLM — **bukan** untuk eksekusi posting (paket Free Metricool dibatasi 20 post/bulan, sedangkan REST API langsung `X-Mc-Auth` hanya tersedia di paket Advanced).
     - **Publer REST API (opsional):** mendukung akun bisnis yang membutuhkan kontrol carousel/duet/stitch serta analitik lanjutan via API.

---

## Daftar Item (`akan dikerjakan`)

| ID | Area / File | Cakupan Pekerjaan | Status | Ketergantungan Utama |
|---|---|---|---|---|
| **U-05** | `apps/src/pages/AnalyticsPage.tsx` | Integrasi backend/provider metrik analitik akun (direct API TikTok/YouTube/Instagram, aggregator Buffer/Publer, atau **Metricool MCP khusus analitik on-demand**) menggantikan pesan sync stub. | `akan dikerjakan` | Backend endpoint analitik + `U-28` |
| **U-06** | `apps/src/pages/SchedulePage.tsx` | Antrean stok & jadwal lokal tanpa batas + trigger `Publish Now` / *rolling schedule* nyata serta tombol asisten LLM khusus generate caption/hashtag/judul. | `akan dikerjakan` | Trait `SocialPublisher` + `nexus-scheduler` (`U-29`) |
| **U-16** | `apps/src/pages/SettingsPage.tsx` / akun Pro | Alur login akun Pro, pengaturan BYO API key / MCP token (Buffer/Publer/Metricool/TikTok/YouTube/Instagram), dan status koneksi channel persisten. | `akan dikerjakan` | `cred_store/` (`U-28`) & endpoint akun |
| **U-17** | `AnalyticsPage.tsx`, `SchedulePage.tsx`, `StockVaultPage.tsx` | Polish dialog/modal konfirmasi, error state empty/offline/rate-limit, dan sinkronisasi penuh antrean stok lokal. | `akan dikerjakan` | `U-05`, `U-06`, `U-29` |
| **U-28** | `core/aetheria-engine/src/cred_store/` | Penyimpanan aman & terisolasi untuk OAuth token langsung (TikTok, YouTube, Instagram) dan API key pihak ke-3 (Buffer, Publer) beserta refresh & revocation. | `akan dikerjakan` | Skema credential per-provider |
| **U-29** | `core/aetheria-engine/src/studio/` | Implementasi trait `SocialPublisher` (adapter Buffer, Publer, TikTok, YouTube, Instagram) + worker *rolling queue* di `nexus-scheduler` dengan retry & log status ke UI. | `akan dikerjakan` | `U-06`, `U-28` |

---

## Catatan

- Fitur di atas tidak memblokir pipeline utama pembuatan video (`index.html`, `script/scene*.js`, Voicebox TTS, FFmpeg render, Studio Editor).
- Saat salah satu item di atas mulai dikerjakan, pecah komponen/modul baru terpisah sesuai `AGENTS.md §5.1` (hindari menambah baris ke `AnalyticsPage.tsx` yang sudah >1.000 baris).
