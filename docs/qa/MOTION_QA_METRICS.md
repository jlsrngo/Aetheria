# Context-Aware Motion QA Metrics & Failure Taxonomy

## 1. Core Principle

No single number defines "smooth, professional motion." Static visual similarity (`SSIM`) hides frozen animation; high frame-difference energy (`fastShare`) hides erratic jitter or wrong-direction motion; zero dead windows (`0/26`) still permits timid `0.34×` energy.

Therefore, AetheriaNexus separates **Hard Gates** (objective regressions that block early exit or trigger rollback) from **Diagnostics** (context-sensitive signals for revision and human review).

---

## 2. Metrics Definition & Algorithms

| Metric | Source Tool | Formula / Algorithm | Role | Context Sensitivity |
|---|---|---|---|---|
| **Runtime Errors** | CDP capture (`preview_capture.rs`) | Count of uncaught JS exceptions / console errors | **Hard Gate** (`== 0`) | Universal |
| **Spec Compliance & Static Motion Hazards** | `motion_spec.rs` + `direct_scene_prompt.rs` | Deterministic AST/pattern check against `SceneMotionSpec` & 30fps `style.json` signals | **Hard Gate** (`hazards == 0` preferred in checkpoint selection) | Driven per-scene by `style.json` & `mode` |
| **30fps Flow `fastShare`** | `ref_motion_gate.py` & `motion-smooth-report.py` | Share of adjacent `1/30s` pairs at `360×640` with 97th-percentile Farneback flow `> 3.0 px/frame` | **Hard Gate** when `fastShareRef >= 0.18` (`res >= 0.50 * ref`) | Ignored on genuinely static scenes (`fastShareRef < 0.18`) |
| **30fps Flow `p97Ratio`** | `ref_motion_gate.py` & `motion-smooth-report.py` | `mean(p97_res) / max(mean(p97_ref), 1e-4)` across adjacent `1/30s` pairs | **Hard Gate** when `meanRef >= 1.8 px/fr` (`ratio >= 0.50`) | Ignored on static holds (`meanRef < 1.8`) |
| **Velocity Snap / Mid-Motion Freeze** | `ref_motion_gate.py` (new P0) | Adjacent-pair flow discontinuity where `ref_p97[i] >= 2.0` while `res_p97[i] < 0.25` (`duplicatePairCount`) or sudden drop `res_p97[i] / max(res_p97[i-1], 1e-3)` vs ref (`velocitySnapCount`) | **Diagnostic** (Hard Gate only when `duplicatePairCount >= 2` while ref moves) | Distinguishes intentional hard cuts (excluded by `safe_lo+0.14..safe_hi-0.14`) from unintended mid-scene freezes |
| **Lag-15 Hold Energy (`Dead Holds`)** | `scripts/motion-feel-report.py` | 15-frame (`0.5s`) mean pixel diff across non-overlapping windows; dead if `refLag15 >= 0.015` and `resLag15 < 0.004` | **Diagnostic** (target `0` regressions vs baseline) | Uses `refLag15` so genuinely static holds never false-alarm |
| **Seam POP Ratio** | `scripts/motion-feel-report.py` | `(resPeak / max(resPre, eps)) / (refPeak / max(refPre, eps))` across each scene cut | **Diagnostic** (flag POP when `res/ref >= 3.0×` and `resRatio > 12`) | Separate interpretation for hard cuts vs `push_*` soft bridges |
| **36-Frame Visual Fidelity** | `core/ref_extractor/ref_compare.py` | Foreground-weighted SSIM + Color + Edge + Geometry Gate across 36 evenly spaced frames | **Diagnostic / Regression Gate** (`overall` & `edge` must not regress) | Geometry gate prevents white-background SSIM inflation |

---

## 3. Automated Failure Classification (`failureClass`)

To prevent blind "rewrite everything" loops, QA classifies every motion gate outcome:

| `failureClass` | Trigger Condition | Targeted Remediation Action |
|---|---|---|
| `none` | Flow, continuity, and spec compliance pass | Accept checkpoint |
| `planning_failure` | `validate_motion_spec` rejects spec (missing required 30fps element, invalid bounds, forbidden double-push) | Revise `write_motion_spec` BEFORE coding |
| `implementation_spec_mismatch` | Valid spec exists, but `check_code_against_motion_spec` detects missing primitive/easing/dash | Patch `script/sceneK.js` to implement declared spec element |
| `implementation_motion_deficit` | `fastShareRes < 0.50 * fastShareRef` or `p97Ratio < 0.50` while ref is active | Increase secondary/element velocity (`omega`, sweep speed, living hold) in `sceneK.js` |
| `implementation_velocity_snap` | `duplicatePairCount >= 2` or severe mid-motion stall while ref moves continuously | Remove `if/else` zero-velocity plateau or frozen frame branch in `sceneK.js` |
| `extraction_low_confidence` | Reference scene itself has `fastShareRef < 0.18` and `p97MeanRef < 1.8` | Do NOT trigger deficit warning; keep steady hold locked |
| `renderer_failure` | Runtime JS errors, blank frames, or hard-cut ghosting | Inspect runtime (`aetheria-motion.js`) / `motion_blur.rs` / `html_renderer.rs` |

---

## 4. Calibrated Baseline & Known Metric Limits

From `benchmarks/pinterest-motion-remake/` (`ref_pinterest.mp4`):
- **Run 11 baseline:** `fastSeconds = 2.20s` (ref `6.61s`), `S3 p97Ratio = 0.34`, `S5 p97Ratio = 0.17`, `Dead Holds = 0/26`, `Seam POP = 3/5`.
- **Run 12 (`109e3ce`):** `36-frame = 0.7220`, `Edge = 0.5709`, `fastSeconds = 2.07s`, `S3 p97Ratio = 0.66`, `S5 p97Ratio = 0.38`, `Dead Holds = 1/26`, `Seam POP = 3/5`.
- **Offline upgraded (`6b7e3ae`):** `fastSeconds = 2.50s`, `S3 p97Ratio = 0.79`, `S5 p97Ratio = 0.64`, `Seam POP = 2/5` (S2→S3 `4.3× → 2.5×`).

**What automated optical-flow metrics CANNOT measure (false-positive / false-negative boundaries):**
- Compression noise or subtle film grain in the reference can inflate `p97_ref` slightly.
- Dense Farneback flow cannot distinguish graceful After Effects speed-graph curves from crude linear motion of equal average speed.
- Optical flow cannot judge typographic kerning, illustration craft, or aesthetic blur quality.

---

## 5. Human Review Rubric (1–5 Scale per Dimension)

Every candidate benchmark release must be scored visually by a human reviewer (side-by-side 6fps stop-motion + full-speed 30fps MP4):

| Dimension | 1 (Poor) | 3 (Acceptable) | 5 (Studio-Grade) |
|---|---|---|---|
| **Naturalness** | Robotic stops, pops, linear glides | Smooth primary motion, stiff holds | Organic acceleration/deceleration & inertia |
| **Intentionality** | Random wobble or unexplained stillness | Follows main beats accurately | Every move has clear motivation & weight |
| **Polish** | Aliased edges, harsh cuts, flat 2D | Clean shapes, occasional seam artifacts | Cohesive lighting, shutter blur, crisp typography |
| **Rhythm & Timing** | Off-beat reveals, awkward pauses | Matches major beats within ~0.15s | Tight sub-beat cadence & overlapping follow-through |
| **Visual Hierarchy** | Competing clutter or flat focus | Clear foreground/background split | Eye naturally guided from hero to supporting details |
| **Continuity** | Jump-cuts or position teleports across scenes | Clean hard cuts, minor bridge seam | Seamless camera/stage handoff across all cuts |
| **Reference Fidelity** | Wrong layout/timing/palette | Recognizable layout & main beats | Faithful timing, silhouette, palette, and motion feel |
