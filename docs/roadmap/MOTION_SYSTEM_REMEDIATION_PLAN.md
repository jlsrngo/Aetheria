# Motion System Remediation Plan (P0 / P1 / P2)

## 1. Guiding Principles
- Keep modular HTML/JS + `window.AM` + headless CDP architecture (`.aetheria/AETHERIA.md`).
- Implement the **smallest P0 changes** that directly close proven audit findings, behind explicit switches so every change can be A/B tested cleanly against baseline.
- **Explicit Non-Goals (Do NOT Build):** No Remotion/React film runtime migration; no GSAP/Three.js wrapper bloat; no multi-agent committee rewrite of direct remake; no mandatory spring/parallax/overshoot checklist on every scene.

---

## 2. Phased Implementation Roadmap

### Already Completed & Verified (`597193d` & `6b7e3ae`)
- **P0-0a (`597193d`):** Removed `motion_gate_runs < 2` false-clean bypass in `direct_scene_tools.rs` and fixed asymmetric checkpoint rollback in `direct_scene_remake.rs`.
- **P0-0b (`6b7e3ae`):** Replaced broken two-phase `cutSec` push compositor with continuous side-by-side `bufA`/`bufB` panning in `apps/public/script/aetheria-motion.js`; enabled 180° tent-weighted shutter motion blur by default with hard-cut boundary clamping (`motion_blur.rs`, `html_renderer.rs`); added AE speed-graph curves (`outQuint`, `inOutQuint`, `aeGlide`, `aeSnap`); added static motion hazards (unused `t` in draw helpers, `DOUBLE-PUSH`, `FROZEN DASHED OUTLINE`).
- **Offline proof (`6b7e3ae`):** Re-rendering Run 12's 537 frames (0 LLM calls) improved `p97Ratio` in all 6 scenes (`S5: 0.38 → 0.64`), eliminated S2→S3 POP (`4.3× → 2.5×`), and raised `fastSeconds` (`2.07s → 2.50s`).

### P0 — Fundamental Planning Contract & Failure-Classified Temporal QA (Implement Now)

| Work Item | Files Changed | Verification | Rollback Switch |
|---|---|---|---|
| **P0-1: Typed `SceneMotionSpec` + Pre-Code Validator + Spec-to-Code Compliance Checker** | New `core/aetheria-engine/src/session/agent_turn/motion_spec.rs`; wire into `mod.rs`, `direct_scene_switches.rs`, `direct_scene_tools.rs`, `direct_scene_remake.rs`, `direct_scene_prompt.rs` | Rust unit tests (valid/invalid remake & original specs, spec-to-code mismatch detection, switch toggle), `cargo test --workspace`, 2× `test-forensic-accuracy-e2e.mjs` | `AETHERIA_DIRECT_MOTION_SPEC=off` |
| **P0-2: Velocity-Snap Diagnostics & Failure Classification in 30fps Motion Gate** | `core/ref_extractor/ref_motion_gate.py`, `core/ref_extractor/test_ref_motion_gate.py`, `core/aetheria-engine/src/studio/motion_gate.rs`, `direct_scene_tools.rs` | Python `unittest` (smooth vs mid-motion freeze/snap vs static ref), Rust unit tests, 2× E2E | Backward-compatible additive JSON fields |
| **P0-3: Fix Stale Docstring in `direct_scene_remake.rs`** | `core/aetheria-engine/src/session/agent_turn/direct_scene_remake.rs:1-17` | Code review + `cargo test` | Doc-only |

### P1 — Controlled A/B Live Benchmark Experiments (After P0 Passes Offline Gates)

Run controlled single-variable comparisons on `benchmarks/pinterest-motion-remake/ref_pinterest.mp4` and archive both successes and failures:

| Experiment | Env Configuration | Variable Isolated | Logged Outputs |
|---|---|---|---|
| **Exp A (Baseline `6b7e3ae` + `597193d`)** | `AETHERIA_DIRECT_MOTION_SPEC=off` | Measures compositor + 180° shutter + fixed motion gate without spec | `summary.json`, 36-frame fidelity, `motion-smooth-report`, `motion-feel-report`, wall time, token/step trace, human rubric |
| **Exp B (P0 Motion Spec Enabled)** | `AETHERIA_DIRECT_MOTION_SPEC=on` (default) | Isolates impact of validated `write_motion_spec` + spec-to-code lint | Same metrics + `planningFailures` vs `implementationFailures` counts |
| **Exp C (Cross-Scene Continuity Summary)** | `AETHERIA_DIRECT_MOTION_SPEC=on`, `AETHERIA_SCENE_CROSS_CONTEXT=summary` | Tests whether cross-scene style/easing summary improves rhythm consistency | Same metrics + human continuity score |

### P2 — Generalization & Extraction Refinement (Only If Justified by P1 Results)
1. **Multi-Video Benchmark Suite:** Add 2 non-Pinterest reference clips (kinetic editorial typography + UI/chart product showcase) and 1 `mode: "original"` prompt test to verify generalization beyond a single benchmark.
2. **Inflection-Point Element Track Sampling:** Upgrade `ref_element_tracks.py` from uniform 6-point sampling to curvature/velocity inflection points *only if* P1 traces still show `extraction_failure` on complex trajectories.
3. **Standard (`motion-designer`) Mode Adoption:** Expose the same `write_motion_spec` validator (`mode: "original"`) to the standard Director/Subagent path once P1 proves net positive quality on direct remake.

---

## 3. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extra `write_motion_spec` tool step consumes 1 step of the 12-step budget | Allow `write_motion_spec` during probing/planning without tripping the write gate, and auto-advance cleanly to `write_scene_script`; toggleable via `AETHERIA_DIRECT_MOTION_SPEC=off`. |
| Over-strict validator blocks valid creative implementations | Keep schema minimal (4 required fields per element); separate hard errors (impossible timestamps, missing measured 30fps signals, forbidden double-push) from soft warnings. |
| False-positive velocity-snap warnings on intentional static beats | Only flag `implementation_velocity_snap` when `ref_p97 >= 2.0 px/frame` on the exact same timestamps where `res_p97 < 0.25 px/frame`. |
