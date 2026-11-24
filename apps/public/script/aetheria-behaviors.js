/**
 * Aetheria Additive Behaviors, Deterministic Wiggle & Track Looping (`/script/aetheria-behaviors.js`).
 *
 * Portions adapted from EffectCraft (https://github.com/storytold/effectcraft),
 * Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors, MIT License.
 *
 * Provides:
 * - SplitMix64-based deterministic C2 value noise and octave `wiggle` (overflow-safe at large `t`).
 * - After Effects `loopTrack` (`cycle`, `pingpong`, `offset`, `continue`, `in` / `out`).
 * - 22 non-destructive additive behavior presets layered cleanly on top of keyframes.
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;
  const MASK64 = 0xffffffffffffffffn;
  const DIV53 = 9007199254740992; // 2^53

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function mod(a, d) {
    return ((a % d) + d) % d;
  }

  function hash64(x) {
    let h = (BigInt.asUintN(64, x) + 0x9e3779b97f4a7c15n) & MASK64;
    h = ((h ^ (h >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    h = ((h ^ (h >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (h ^ (h >> 31n)) & MASK64;
  }

  function mixSeed(parts) {
    let h = 0x2545f4914f6cdd1dn;
    for (let i = 0; i < parts.length; i++) {
      h = hash64(h ^ hash64(BigInt.asUintN(64, BigInt(parts[i]))));
    }
    return h;
  }

  function seedFromKey(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) {
      return BigInt(Math.trunc(seed * 1000));
    }
    if (typeof seed === "string") {
      let h = 0x2545f4914f6cdd1dn;
      for (let i = 0; i < seed.length; i++) {
        h = hash64(h ^ BigInt(seed.charCodeAt(i) + i * 31));
      }
      return h;
    }
    return 1n;
  }

  function unit64(seed) {
    return Number(hash64(seed) >> 11n) / DIV53;
  }

  function lattice(seed, idxBig) {
    return unit64(seed ^ hash64(BigInt.asUintN(64, idxBig))) * 2 - 1;
  }

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** Smooth C2 1D value noise in [-1, 1], overflow-safe for arbitrarily large `x`. */
  function noise1(seedBig, x) {
    if (!Number.isFinite(x)) return 0;
    const fl = Math.floor(x);
    if (!Number.isFinite(fl)) return 0;
    const u = fade(x - fl);
    const iBig = BigInt(Math.trunc(fl));
    const a = lattice(seedBig, iBig);
    const b = lattice(seedBig, iBig + 1n);
    return a + (b - a) * u;
  }

  /**
   * Deterministic octave wiggle offset(s) matching EffectCraft `crates/expr/src/noise.rs`.
   * Returns a number when `dims === 1` (default) or `number[]` when `dims > 1`.
   * When `opts.base` is provided (number or array), adds the wiggle offset onto `base`.
   */
  function wiggle(t, freq, amp, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const sec = Number(t);
    const f0 = Number(freq);
    const a0 = Number(amp);
    if (!Number.isFinite(sec) || !Number.isFinite(f0) || !Number.isFinite(a0)) {
      throw new Error("AetheriaBehaviors.wiggle requires finite numeric 't', 'freq', and 'amp'.");
    }
    const base = o.base;
    const dims = Array.isArray(base)
      ? base.length
      : Math.max(1, Math.min(16, Math.round(Number(o.dims) || 1)));
    const octaves = Number.isFinite(Number(o.octaves))
      ? Math.floor(clamp(Number(o.octaves), 1, 16))
      : 1;
    const ampMult = Number.isFinite(Number(o.ampMult)) ? Number(o.ampMult) : 0.5;
    const rootSeed = seedFromKey(o.seed !== undefined ? o.seed : 1);

    const offsets = new Array(dims);
    for (let d = 0; d < dims; d++) {
      let a = a0;
      let f = f0;
      let sum = 0;
      for (let k = 0; k < octaves; k++) {
        const s = mixSeed([rootSeed, BigInt(d), BigInt(k)]);
        sum += a * noise1(s, f * sec + unit64(s) * 1000);
        a *= ampMult;
        f *= 2;
      }
      offsets[d] = sum;
    }

    if (Array.isArray(base)) {
      return base.map(function (v, idx) {
        return Number(v) + offsets[idx];
      });
    }
    if (typeof base === "number") {
      return base + offsets[0];
    }
    return dims === 1 ? offsets[0] : offsets;
  }

  function addVal(a, b) {
    if (Array.isArray(a)) {
      return a.map(function (x, i) {
        return x + (Array.isArray(b) ? b[i] : b);
      });
    }
    return a + b;
  }

  function subVal(a, b) {
    if (Array.isArray(a)) {
      return a.map(function (x, i) {
        return x - (Array.isArray(b) ? b[i] : b);
      });
    }
    return a - b;
  }

  function scaleVal(a, k) {
    if (Array.isArray(a)) {
      return a.map(function (x) {
        return x * k;
      });
    }
    return a * k;
  }

  /**
   * After Effects `loopOut` / `loopIn` evaluator ported from EffectCraft `prelude.js` (`__loop`).
   * Supports `type: "cycle" | "pingpong" | "offset" | "continue"`, `direction: "out" | "in"`,
   * `numKeyframes`, `duration`, and `spatial`.
   */
  function loopTrack(keys, t, opts) {
    const tracksApi = global.AetheriaTracks;
    if (!tracksApi || typeof tracksApi.evaluateTrack !== "function") {
      throw new Error("AetheriaBehaviors.loopTrack requires window.AetheriaTracks to be loaded.");
    }
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error("AetheriaBehaviors.loopTrack requires a non-empty keys array.");
    }
    const o = opts && typeof opts === "object" ? opts : {};
    const dir = String(o.direction || "out").toLowerCase();
    const out = dir !== "in";
    const type = String(o.type || "cycle").toLowerCase();
    if (type !== "cycle" && type !== "pingpong" && type !== "offset" && type !== "continue") {
      throw new Error(
        "AetheriaBehaviors.loopTrack: unknown loop type '" +
          type +
          "'. Valid types: cycle, pingpong, offset, continue."
      );
    }
    const evalOpts = { spatial: Boolean(o.spatial) };
    const sec = Number(t) || 0;
    const sorted = keys.slice().sort(function (a, b) {
      return Number(a.t) - Number(b.t);
    });
    const N = sorted.length;
    const evalAt = function (timeSec) {
      return tracksApi.evaluateTrack(sorted, timeSec, evalOpts);
    };
    if (N === 1) return evalAt(sec);

    const n = Math.max(0, Math.floor(Number(o.numKeyframes) || 0));
    const durOpt = Number(o.duration);
    let tStart;
    let tEnd;
    if (out) {
      tEnd = Number(sorted[N - 1].t);
      if (sec <= tEnd) return evalAt(sec);
      if (Number.isFinite(durOpt) && durOpt > 0) tStart = tEnd - durOpt;
      else if (n > 0 && N - 1 - n >= 0) tStart = Number(sorted[N - 1 - n].t);
      else tStart = Number(sorted[0].t);
    } else {
      tStart = Number(sorted[0].t);
      if (sec >= tStart) return evalAt(sec);
      if (Number.isFinite(durOpt) && durOpt > 0) tEnd = tStart + durOpt;
      else if (n > 0 && n < N) tEnd = Number(sorted[n].t);
      else tEnd = Number(sorted[N - 1].t);
    }

    const h = 1e-3;
    if (type === "continue") {
      if (out) {
        const ve = evalAt(tEnd);
        const slope = scaleVal(subVal(ve, evalAt(tEnd - h)), 1 / h);
        return addVal(ve, scaleVal(slope, sec - tEnd));
      }
      const vs = evalAt(tStart);
      const slopeIn = scaleVal(subVal(evalAt(tStart + h), vs), 1 / h);
      return addVal(vs, scaleVal(slopeIn, sec - tStart));
    }

    const d = tEnd - tStart;
    if (!(d > 0)) return evalAt(sec);
    const ph = mod(sec - tStart, d);

    if (type === "pingpong") {
      if (out) {
        const k = Math.floor((sec - tStart) / d);
        return evalAt(k % 2 === 1 ? tEnd - ph : tStart + ph);
      }
      const kIn = Math.floor((tEnd - sec) / d);
      const phIn = mod(tStart - sec, d);
      return evalAt(kIn % 2 === 1 ? tStart + phIn : tEnd - phIn);
    }

    if (type === "offset") {
      const kOff = Math.floor((sec - tStart) / d);
      const delta = subVal(evalAt(tEnd), evalAt(tStart));
      return addVal(evalAt(tStart + ph), scaleVal(delta, kOff));
    }

    return evalAt(tStart + ph);
  }

  function applyEnvelope(t, cfg) {
    const start = Number.isFinite(Number(cfg.startSec)) ? Number(cfg.startSec) : -Infinity;
    const end = Number.isFinite(Number(cfg.endSec)) ? Number(cfg.endSec) : Infinity;
    if (t < start || t > end) return 0;
    const ramp = Number.isFinite(Number(cfg.rampSec)) ? Math.max(0, Number(cfg.rampSec)) : 0;
    if (ramp <= 0) return 1;
    let w = 1;
    if (Number.isFinite(start)) w = Math.min(w, clamp((t - start) / ramp, 0, 1));
    if (Number.isFinite(end)) w = Math.min(w, clamp((end - t) / ramp, 0, 1));
    return w;
  }

  // All 22 original EffectCraft behavior presets (additive/multiplicative on top of layer state)
  const BEHAVIOR_PRESETS = {
    wiggleSoft: function (st, t, cfg, seed, w) {
      const off = wiggle(t, cfg.freq ?? 1.2, (cfg.amp ?? 30) * w, { dims: 2, seed });
      st.x += off[0];
      st.y += off[1];
    },
    shake: function (st, t, cfg, seed, w) {
      const off = wiggle(t, cfg.freq ?? 14, (cfg.amp ?? 12) * w, { dims: 2, seed });
      st.x += off[0];
      st.y += off[1];
    },
    floatUpDown: function (st, t, cfg, _s, w) {
      st.y += Math.sin(t * (cfg.freq ?? 2)) * (cfg.amp ?? 18) * w;
    },
    sway: function (st, t, cfg, _s, w) {
      st.x += Math.sin(t * (cfg.freq ?? 1.6)) * (cfg.amp ?? 40) * w;
    },
    orbit: function (st, t, cfg, _s, w) {
      const f = cfg.freq ?? 2;
      const r = (cfg.amp ?? 80) * w;
      st.x += Math.cos(t * f) * r;
      st.y += Math.sin(t * f) * r;
    },
    figureEight: function (st, t, cfg, _s, w) {
      const f = cfg.freq ?? 1.5;
      const ax = (cfg.ampX ?? cfg.amp ?? 100) * w;
      const ay = (cfg.ampY ?? (cfg.amp !== undefined ? cfg.amp * 0.45 : 45)) * w;
      st.x += Math.sin(t * f) * ax;
      st.y += Math.sin(t * f * 2) * ay;
    },
    bouncingBall: function (st, t, cfg, _s, w) {
      st.y += -Math.abs(Math.sin(t * (cfg.freq ?? 3.2))) * (cfg.amp ?? 140) * w;
    },
    driftRight: function (st, t, cfg, _s, w) {
      st.x += t * (cfg.speed ?? cfg.amp ?? 40) * w;
    },
    driftDiagonal: function (st, t, cfg, _s, w) {
      st.x += t * (cfg.speedX ?? cfg.amp ?? 30) * w;
      st.y += t * (cfg.speedY ?? (cfg.amp !== undefined ? cfg.amp * 0.6 : 18)) * w;
    },
    pendulum: function (st, t, cfg, _s, w) {
      st.rotation += Math.sin(t * (cfg.freq ?? 2.4)) * (cfg.amp ?? 25) * w * DEG;
    },
    wobble: function (st, t, cfg, seed, w) {
      st.rotation += wiggle(t, cfg.freq ?? 2, (cfg.amp ?? 10) * w, { dims: 1, seed }) * DEG;
    },
    spinSlow: function (st, t, cfg, _s, w) {
      st.rotation += t * (cfg.speed ?? cfg.amp ?? 36) * w * DEG;
    },
    spinFast: function (st, t, cfg, _s, w) {
      st.rotation += t * (cfg.speed ?? cfg.amp ?? 720) * w * DEG;
    },
    pulse: function (st, t, cfg, _s, w) {
      const k = 1 + (cfg.amp ?? 0.12) * w * Math.sin(t * (cfg.freq ?? 4));
      st.scaleX *= k;
      st.scaleY *= k;
    },
    heartbeat: function (st, t, cfg, _s, w) {
      const f = cfg.freq ?? 1;
      const p = mod(t * f, 1);
      const b = p < 0.3 ? Math.sin((p / 0.3) * Math.PI) : p < 0.6 ? 0.7 * Math.sin(((p - 0.3) / 0.3) * Math.PI) : 0;
      const k = 1 + (cfg.amp ?? 0.2) * w * b;
      st.scaleX *= k;
      st.scaleY *= k;
    },
    breathe: function (st, t, cfg, _s, w) {
      const k = 1 + (cfg.amp ?? 0.06) * w * Math.sin(t * (cfg.freq ?? 1.1));
      st.scaleX *= k;
      st.scaleY *= k;
    },
    rubberBand: function (st, t, cfg, _s, w) {
      const s = (cfg.amp ?? 0.15) * w * Math.sin(t * (cfg.freq ?? 5));
      st.scaleX *= 1 + s;
      st.scaleY *= 1 - s;
    },
    jitterScale: function (st, t, cfg, seed, w) {
      const off = wiggle(t, cfg.freq ?? 8, (cfg.amp ?? 0.06) * w, { dims: 2, seed });
      st.scaleX *= 1 + off[0];
      st.scaleY *= 1 + off[1];
    },
    blink: function (st, t, cfg, _s, w) {
      if (w > 0 && Math.floor(t * (cfg.freq ?? 4)) % 2 !== 0) {
        st.opacity *= 1 - w;
      }
    },
    strobe: function (st, t, cfg, _s, w) {
      if (w > 0 && mod(t * (cfg.freq ?? 6), 1) >= (cfg.duty ?? 0.25)) {
        st.opacity *= 1 - w;
      }
    },
    flicker: function (st, t, cfg, seed, w) {
      const off = wiggle(t, cfg.freq ?? 14, (cfg.amp ?? 0.45) * w, { dims: 1, seed });
      st.opacity = clamp(st.opacity + off, 0, 1);
    },
    fadePulse: function (st, t, cfg, _s, w) {
      const depth = clamp(cfg.amp ?? 0.33, 0, 0.5) * w;
      st.opacity = clamp(st.opacity * (1 - depth + depth * Math.sin(t * (cfg.freq ?? 2.5))), 0, 1);
    },
  };

  const PRESET_NAMES = Object.keys(BEHAVIOR_PRESETS);

  function validateBehaviors(behaviors, context) {
    if (behaviors === undefined || behaviors === null) return null;
    if (!Array.isArray(behaviors)) {
      throw new Error("AetheriaBehaviors(" + (context || "layer") + "): 'behaviors' must be an array.");
    }
    const normalized = new Array(behaviors.length);
    for (let i = 0; i < behaviors.length; i++) {
      const item = behaviors[i];
      const cfg = typeof item === "string" ? { preset: item } : item;
      if (!cfg || typeof cfg !== "object" || typeof cfg.preset !== "string") {
        throw new Error(
          "AetheriaBehaviors(" + (context || "layer") + "): behavior at index " + i + " must be a preset string or { preset, ... }."
        );
      }
      if (!Object.prototype.hasOwnProperty.call(BEHAVIOR_PRESETS, cfg.preset)) {
        throw new Error(
          "AetheriaBehaviors(" +
            (context || "layer") +
            "): unknown behavior preset '" +
            cfg.preset +
            "'. Valid presets: " +
            PRESET_NAMES.join(", ") +
            "."
        );
      }
      normalized[i] = cfg;
    }
    return normalized;
  }

  /** Applies an array of validated behaviors non-destructively onto `state` at time `t`. */
  function applyBehaviors(state, t, behaviors, seedBase) {
    if (!state || !Array.isArray(behaviors) || behaviors.length === 0) return state;
    const sec = Number(t) || 0;
    for (let i = 0; i < behaviors.length; i++) {
      const item = behaviors[i];
      const cfg = typeof item === "string" ? { preset: item } : item;
      const fn = BEHAVIOR_PRESETS[cfg.preset];
      if (!fn) {
        throw new Error(
          "AetheriaBehaviors: unknown behavior preset '" +
            String(cfg && cfg.preset) +
            "'. Valid presets: " +
            PRESET_NAMES.join(", ") +
            "."
        );
      }
      const w = applyEnvelope(sec, cfg);
      if (w <= 0) continue;
      const phase = Number.isFinite(Number(cfg.phase)) ? Number(cfg.phase) : 0;
      const seed = cfg.seed !== undefined ? cfg.seed : String(seedBase || "layer") + ":" + cfg.preset + ":" + i;
      fn(state, sec + phase, cfg, seed, w);
    }
    return state;
  }

  global.AetheriaBehaviors = {
    version: 1,
    PRESET_NAMES,
    BEHAVIOR_PRESETS,
    wiggle,
    loopTrack,
    validateBehaviors,
    applyBehaviors,
  };
})(typeof window !== "undefined" ? window : globalThis);
