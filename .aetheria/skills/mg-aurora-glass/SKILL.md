---
name: mg-aurora-glass
description: "Declarative Liquid-Glass & Aurora Mesh motion graphics skill matching 12-aurora-glass craft: multi-plume luminous aurora mesh, parallax 3-layer frosted glass UI cluster (Listening waveform, AI reply card, Focus toggle & Glow slider), refractive droplet lens, and luminous crystal ring title."
tags:
  - motion-graphics
  - declarative-kit
  - aurora-glass
  - glassmorphism
command: /mg-aurora-glass
---

# Aurora Liquid Glass (Multi-Layer Spatial UI) — Declarative Fast-Path Skill

## Visual Identity
Luxury 2026 AI-launch Liquid Glass aesthetic matching `12-aurora-glass`: deep indigo-black velvet void lit by 5 drifting elliptical aurora plumes + dust motes, 3-layer parallax frosted glass cluster (voice waveform card, AI reply panel with luminous orb & pill CTA, foreground Focus toggle + Glow slider card), gliding chromatic-dispersion liquid lens, and open crystal-ring title bloom.

## Zero-JS Workflow
Do **not** write custom canvas JS. Author only `story.json` matching `examples/kit.json` and `examples/story.schema.json`.
1. Read `examples/kit.json` and `examples/story.example.json` for valid enums and structure.
2. Write `story.json` with 2–12 shots (`durationSec` 3–90, `fps: 30`, `1080x1920` or `1920x1080`).
3. Validate via `story_lint`, preview via `capture_film_preview`, and inspect `contact_sheet.jpg`.
4. Mode `'M'` (`?microstock=1`) hides all text and captions while keeping the full aurora mesh, translucent glass panels, waveform, controls, refractive lens, and crystal ring.

## Kit Enums (`examples/kit.json`)
- **themes**: `indigo-aurora`, `emerald-northern`, `rose-nebula`, `obsidian-cyan`, `twilight-violet`
- **layouts**: `glass-cluster`, `voice-listening`, `focus-controls`, `lens-refract`, `metric-ring`, `aurora-title`
- **transitions**: `light-sweep`, `glass-part`, `luminance-fade`

## Limits & Safe-Zone Contract
- `headline` <= 44 chars; `subtext` <= 96 chars.
- Pure deterministic function of `t`: aurora plume drift, specular catch-light sweeps, lens orbit, and waveform bars derive strictly from `t`.

## Camera (`StoryCamera`, opt-in)
- Set root `"cameraStyle": "calm" | "kinetic" | "editorial"` (plus integer `"seed"`) for deterministic framing variation; avoid raw numeric camera overrides unless a shot explicitly needs `shots[].camera.move`.
