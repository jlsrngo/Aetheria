# Storytelling Structure & Director Self-QC (`mg-stickman-story`)

## 1. Story Arc for 10s–45s Vertical Shorts
1. **Hook (`0–3s`):** Start mid-conflict or kinetic insert (ringing alarm, sudden question, dramatic pull-out) paired with immediate camera motion (`shake` -> `fly-to`, or `snap-zoom`). Never open on 3 seconds of a still wide shot.
2. **Setup & Escalation:** Cut or transition (`flash`, `whip`, `iris`) into reaction beats synced to narration words (`"word": "..."`), combining facial expression + pose + head emote (`idea`, `exclaim`) + comic overlay (`burst`).
3. **Payoff & Connection:** Resolve in a fresh set (`park`, `school-yard`, `living-room`) with locomotion (`follow` lag tracking) and a clean two-shot speech bubble + karaoke caption wrap-up.

## 2. Director Self-QC Checklist (3 Frames per Shot: `start`, `mid`, `end`)
After calling `capture_film_preview`, inspect `.aetheria/preview/contact_sheet.jpg`:
- **`start` frame (`+0.25s`):** Does an actor or prop visibly occupy the frame cleanly (not off-screen before an entrance finishes)?
- **`mid` frame (`55%`):** Are heads, glasses, eyes, and speech bubbles 100% unclipped inside the blue dashed TikTok safe zone? Do speech bubbles stay well above the bottom karaoke subtitle bar (`y < 0.78*H`)?
- **`end` frame (`-0.35s`):** Did the ending camera move land balanced without drifting partially off-screen?
- **`storyQa.directorWarnings`:** Resolve any `[CHECK]` warnings (phrase mismatch, monotonous shot sizes, or element collision) with at most 1 surgical pass on `story.json`.

## 3. User-Supplied VO + Script Mode
When the user provides their own voiceover WAV (`source.voPath`) and full script (`source.script`):
1. Slice the full script cleanly across `shots[]` so the concatenated per-shot `caption` text equals the user's supplied script verbatim (no dropped or invented sentences).
2. Pass `scenes[].voPath` (relative workspace path inside the project, e.g. `"input/shot1_vo.wav"`) to `film_audio`. The engine skips TTS synthesis, reads exact WAV duration via `read_wav_duration_secs`, detects speech segments via RMS energy (`±0.2s` estimated word timing when no external word-alignment JSON is supplied), and writes `audio/<id>.words.json` + `audio/<id>.levels.json` for tight subtitles and mouth lipsync.
