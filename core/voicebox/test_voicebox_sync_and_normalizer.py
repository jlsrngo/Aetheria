#!/usr/bin/env python3
"""
F2 Automated Verification:
1. Synthetic WAV silence compaction + 35ms lead pad time-remapping (`error <= 10 ms`).
2. Indonesian speech normalizer coverage report (numbers, years, currency, %, x, abbr, foreign names).
3. Workspace lexicon isolation test (`workspace_dir` scoped, never reading repo `<root>/workspace/`).
"""
import json
import math
import pathlib
import sys
import tempfile
import unittest

import numpy as np

THIS_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

import voicebox_engine as vb  # noqa: E402


class TestVoiceboxSyncAndNormalizer(unittest.TestCase):
    def test_synthetic_wav_remap_within_10ms(self):
        sr = 24000
        # Build synthetic audio: 0.40s silence + 0.25s tone A + 1.20s pause + 0.30s tone B + 0.50s silence
        s_lead = np.zeros(int(0.40 * sr), dtype=np.float32)
        t_a = np.arange(int(0.25 * sr), dtype=np.float32) / sr
        tone_a = 0.4 * np.sin(2.0 * math.pi * 440.0 * t_a).astype(np.float32)
        s_mid = np.zeros(int(1.20 * sr), dtype=np.float32)
        t_b = np.arange(int(0.30 * sr), dtype=np.float32) / sr
        tone_b = 0.4 * np.sin(2.0 * math.pi * 550.0 * t_b).astype(np.float32)
        s_tail = np.zeros(int(0.50 * sr), dtype=np.float32)

        raw = np.concatenate([s_lead, tone_a, s_mid, tone_b, s_tail])
        raw_words = [
            {"word": "Halo", "start": 0.400, "duration": 0.250, "end": 0.650},
            {"word": "Dunia", "start": 1.850, "duration": 0.300, "end": 2.150},
        ]

        sanitized, time_map = vb.sanitize_voice_audio_with_map(raw, sr)
        final_dur = len(sanitized) / float(sr)
        remapped = vb.remap_word_timings(raw_words, time_map, final_dur)

        # Detect exact voiced island onsets in sanitized waveform at 1ms hop resolution
        hop = max(1, int(sr * 0.001))
        win = max(1, int(sr * 0.010))
        rms = np.array([
            float(np.sqrt(np.mean(sanitized[i * hop : i * hop + win] ** 2)))
            for i in range((len(sanitized) - win) // hop)
        ])
        peak = float(np.max(rms))
        thresh = max(0.004, peak * 0.15)
        voiced = rms >= thresh

        onsets_sec = []
        in_island = False
        for idx, v in enumerate(voiced):
            if v and not in_island:
                onsets_sec.append(idx * 0.001)
                in_island = True
            elif not v and in_island:
                in_island = False

        self.assertEqual(len(onsets_sec), 2, f"Expected 2 voiced islands in sanitized WAV, got {onsets_sec}")
        err_w1_ms = abs(remapped[0]["start"] - onsets_sec[0]) * 1000.0
        err_w2_ms = abs(remapped[1]["start"] - onsets_sec[1]) * 1000.0
        unmapped_err_w2_ms = abs(raw_words[1]["start"] - onsets_sec[1]) * 1000.0

        print(
            f"[SYNTHETIC_REMAP] onset1={onsets_sec[0]:.3f}s remapped={remapped[0]['start']:.3f}s err={err_w1_ms:.2f}ms | "
            f"onset2={onsets_sec[1]:.3f}s remapped={remapped[1]['start']:.3f}s err={err_w2_ms:.2f}ms "
            f"(raw_unmapped_err={unmapped_err_w2_ms:.1f}ms)"
        )
        self.assertLessEqual(err_w1_ms, 10.0)
        self.assertLessEqual(err_w2_ms, 10.0)
        self.assertGreater(unmapped_err_w2_ms, 300.0)
        self.assertLessEqual(remapped[-1]["end"], final_dur + 1e-6)

    def test_indonesian_normalizer_coverage_and_known_gaps(self):
        cases = [
            ("angka_int", "Ada 21 adegan utama", ["dua puluh satu"]),
            ("angka_decimal", "Skor naik 3.8 menjadi 0,75 poin", ["tiga koma delapan", "nol koma tujuh lima"]),
            ("angka_thousands", "Sebanyak 1.000.000 penonton", ["satu juta"]),
            ("tahun_range", "Perang 1939-1945 berakhir pada 2025", ["sembilan belas tiga puluh sembilan sampai sembilan belas empat puluh lima", "dua ribu dua puluh lima"]),
            ("mata_uang_idr_usd", "Harga Rp 15.000 atau $0.75 dan $15", ["lima belas ribu rupiah", "nol koma tujuh lima dolar", "lima belas dolar"]),
            ("persen_kali", "Kenaikan 100% dan lebih cepat 2x", ["seratus persen", "dua kali"]),
            ("singkatan_id", "btw dgn ini utkmu krn API key dan cache", ["ngomong-ngomong", "dengan", "karena", "E-P-I ki", "kes"]),
        ]
        for label, raw, expected_parts in cases:
            out = vb.normalize_indonesian_speech_text(raw)
            for part in expected_parts:
                self.assertIn(part.lower(), out.lower(), f"{label}: missing '{part}' in '{out}'")

        # Document current known gaps (not in base lexicon & English normalizer absent):
        gap_samples = {
            "acronym_CPU": vb.normalize_indonesian_speech_text("Prosesor CPU bekerja"),
            "acronym_BPJS": vb.normalize_indonesian_speech_text("Layanan BPJS Kesehatan"),
            "foreign_Claude": vb.normalize_indonesian_speech_text("Model Claude Opus"),
            "mixed_threejs": vb.normalize_indonesian_speech_text("Gunakan Three.js sekarang"),
        }
        print("[NORMALIZER_GAPS_OBSERVED]", json.dumps(gap_samples, ensure_ascii=False))
        self.assertIn("Ce-Pe-U", gap_samples["acronym_CPU"])
        self.assertIn("BPJS", gap_samples["acronym_BPJS"])
        self.assertIn("Claude", gap_samples["foreign_Claude"])
        self.assertIn("Three.js", gap_samples["mixed_threejs"])

    def test_workspace_lexicon_isolation(self):
        with tempfile.TemporaryDirectory(prefix="aetheria_lex_ws_") as tmp_dir:
            ws = pathlib.Path(tmp_dir)
            (ws / "pronunciation_lexicon.json").write_text(
                json.dumps({"terms": {"ArunakiBrand": "Arunaki Brend"}}),
                encoding="utf-8",
            )
            # Without passing workspace_dir, isolated project lexicon must NOT leak
            without_ws = vb.normalize_indonesian_speech_text("Halo ArunakiBrand", workspace_dir=None)
            with_ws = vb.normalize_indonesian_speech_text("Halo ArunakiBrand", workspace_dir=str(ws))
            self.assertNotIn("Arunaki Brend", without_ws)
            self.assertIn("Arunaki Brend", with_ws)

    def test_inline_audio_expression_tags_and_subtitle_stripping(self):
        script = (
            "[excited] Halo semuanya! "
            "[sighs] Awalnya aku pikir gagal... [pause] Semuanya berantakan. "
            "[whispers] Tapi tunggu dulu... [chuckles] Solusinya simpel! "
            "[angry] Kita selesaikan SEKARANG! "
            "[sad] Maaf ya... [gasps] Eh, tunggu! [laughs] Berhasil!"
        )
        segs = vb.parse_inline_audio_segments(script)
        tags = [s.get("tag") for s in segs if s["kind"] == "speech"]
        pauses = [s for s in segs if s["kind"] == "pause"]
        self.assertEqual(tags, ["excited", "sighs", "sighs", "whispers", "chuckles", "angry", "sad", "gasps", "laughs"])
        self.assertEqual(len(pauses), 1)
        self.assertEqual(pauses[0]["pause_ms"], 450)

        clean = vb.strip_inline_audio_tags(script)
        self.assertNotIn("[", clean)
        self.assertNotIn("]", clean)
        self.assertIn("Halo semuanya!", clean)
        self.assertIn("Berhasil!", clean)


if __name__ == "__main__":
    unittest.main(verbosity=2)
