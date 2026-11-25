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
