# Backlog Integrasi Sosial, Analitik, Penjadwalan, dan Akun

Dokumen pelacakan item UI dan integrasi eksternal yang saat ini **ditunda** agar fokus penuh terlebih dahulu pada pembuatan video, audio, keandalan engine/tools, dan editor Studio.

> **Status Global:** `akan dikerjakan`

---

## Daftar Item (`akan dikerjakan`)

| ID | Area / File | Cakupan Pekerjaan | Status | Ketergantungan Utama |
|---|---|---|---|---|
| **U-05** | `apps/src/pages/AnalyticsPage.tsx` | Integrasi backend/provider metrik analitik akun TikTok (views, likes, followers) menggantikan pesan sync stub. | `akan dikerjakan` | Backend endpoint analitik & OAuth TikTok |
| **U-06** | `apps/src/pages/SchedulePage.tsx` | Integrasi worker upload & penjadwalan publikasi nyata (`Publish Now`) menggantikan state antrean simulasi frontend. | `akan dikerjakan` | Backend scheduler publisher & API platform |
| **U-16** | `apps/src/pages/SettingsPage.tsx` / akun Pro | Alur login akun Pro / cloud sync session nyata dengan backend autentikasi & status akun persisten. | `akan dikerjakan` | Endpoint auth akun Pro & penyimpan token |
| **U-17** | `AnalyticsPage.tsx`, `SchedulePage.tsx`, `StockVaultPage.tsx` | Polish dialog/modal konfirmasi, error state empty/offline, dan sinkronisasi data penuh untuk fitur sosial/stok. | `akan dikerjakan` | `U-05`, `U-06`, endpoint StockVault nyata |
| **U-28** | `core/aetheria-engine/src/cred_store/` | Penyimpanan token OAuth sosial (TikTok/YouTube/Instagram) terisolasi dengan refresh token aman dan revocation. | `akan dikerjakan` | Skema OAuth provider sosial |
| **U-29** | `core/aetheria-engine/src/studio/` | Worker background upload & retry video terjadwal beserta log status publikasi ke UI. | `akan dikerjakan` | `U-06`, `U-28` |

---

## Catatan

- Fitur di atas tidak memblokir pipeline utama pembuatan video (`index.html`, `script/scene*.js`, Voicebox TTS, FFmpeg render, Studio Editor).
- Saat salah satu item di atas mulai dikerjakan, pecah komponen/modul baru terpisah sesuai `AGENTS.md §5.1` (hindari menambah baris ke `AnalyticsPage.tsx` yang sudah >1.000 baris).
