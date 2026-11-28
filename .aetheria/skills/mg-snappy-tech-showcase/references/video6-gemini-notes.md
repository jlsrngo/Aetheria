# Video 6 Blueprint & Production Notes (`ref6_mc_7603768` — Gemini Aurora Star)

> **Status:** Planned / Deferred for next pass (per user direction: ship `mg-snappy-tech-showcase` skill first, then add Video 6 implementation & showcase).

## Native Reference Spec
- **Bundled reference video (portable across machines):** [ref6_mc_7603768.mp4](video6/ref6_mc_7603768.mp4) (`0.33 MB`, includes original audio for offline remake & side-by-side verification on any computer after `git pull`)
- **Format:** `1080×1080` (Square 1:1) · **60 fps CFR** · **590 frames** · **9.833s**
- **Theme mapping in skill:** `aurora-light`

## Frame-Exact Beat Architecture (Double-Drop Chorus + Scanline Outro)

| Segment | Time | Visual & Motion Choreography |
|---|---|---|
| **Cycle 1 — Star Pop & Click** | `0.00s–1.18s` | Clean alabaster canvas (`#F5F5F7`). 4-point Aurora star shaded with 4-quadrant rainbow gradient (red top `#EA4335`, yellow left `#FBBC05`, green bottom `#34A853`, blue right `#4285F4`) + soft drop shadow. Crisp macOS pointer cursor glides from bottom-right (`0.58s–1.00s`) and clicks star with subtle press dip. |
| **Cycle 1 — Aurora Iris Explosion** | `1.18s–1.58s` | Fullscreen 4-quadrant blurred aurora floods canvas while luminous white 4-point star iris expands exponentially (`expLerp(46, 1650)`) with slight rotation (`0 → 0.18 rad`), wiping into soft warm-grey stage (`#E4E4E6`). |
| **Cycle 1 — 4 Action Pills** | `1.66s–2.52s` | 4 floating white rounded pills stagger-pop vertically (`Create image`, `Write anything`, `Boost my day`, `Help me learn`). Cursor sweeps down across pills, hovers `Boost my day` (`scale 1.12x` + soft shadow lift), and clicks (`2.46s`). |
| **Cycle 1 — Prompt Morph & Kinetic Typing** | `2.50s–4.18s` | Clicked pill morphs into wide white AI Prompt Card (`+`, sliders, `Pro`, mic). Continuous zero-dead-stop zoom (`0.84x → 1.56x`) + horizontal tracking pan follows kinetic bouncy typing (`Everywhere i go i get 💸`), ending with edge vignette + brief `0.06s` CRT scanline glitch cut (`4.18s–4.24s`). |
| **Cycle 2 — Tight Chorus Repeat** | `4.24s–7.84s` | Tighter star intro (`0.48s` instead of `1.16s`) → Aurora iris explosion (`4.72s–5.14s`) → 4 action pills (`5.20s–6.06s`) → Prompt morph & kinetic typing (`6.06s–7.78s`) → CRT scanline cut (`7.78s–7.84s`). |
| **Outro — Dark Wave Scanlines** | `7.84s–9.83s` | Deep charcoal canvas (`#080809`) with subtle undulating horizontal wave lines, kinetic letter-reveal wordmark (`8.04s–8.52s`, rebrandable to `aetheria`), continuous subtle scale drift, and horizontal Gaussian light-blur fade out (`9.56s–9.83s`). |

## Implementation Checklist for Next Pass
- [ ] Rebrand outro wordmark (`mcvisuals` → `aetheria`) and optionally swap star gradient to Aetheria Aurora palette if requested.
- [ ] Reuse `SnappyTechKit.traceAuroraStar`, `SnappyTechKit.expLerp`, `SnappyTechKit.smoothGlide`, and `SnappyTechKit.springOut` from `script/snappy-tech-kit.js`.
- [ ] Verify fast 12-beat checksheet (`ASLI` vs `KITA`) before running full 590-frame 60fps CFR render with original reference audio.
- [ ] Verify exact `nb_read_frames == 590` and `r_frame_rate == "60/1"` via `ffprobe -count_frames` and visual playback inspection.
