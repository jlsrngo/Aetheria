/**
 * Aetheria After Effects Keyframe & Speed-Graph Track Engine (`/script/aetheria-tracks.js`).
 *
 * Portions adapted from EffectCraft (https://github.com/storytold/effectcraft),
 * Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors, MIT License.
 *
 * Implements After Effects-compatible temporal Bezier speed/influence easing,
 * Catmull-Rom auto-Bezier 2D/3D spatial motion paths with 96-cell 5-point
 * Gauss-Legendre arc-length parameterization, hold keys, and velocity queries.
 */
(function (global) {
  "use strict";

  const LINEAR_SIDE_INFLUENCE = 1 / 6;
  const MIN_INFLUENCE = 0.1;
  const MAX_INFLUENCE = 100;
  const MAX_SPEED = 100;
  const ARC_N = 96;

  // 5-point Gauss-Legendre quadrature nodes and weights on [-1, 1]
  const GAUSS = [
    [0.0, 0.5688888888888889],
    [-0.5384693101056831, 0.4786286704993665],
    [0.5384693101056831, 0.4786286704993665],
    [-0.906179845938664, 0.2369268850561891],
    [0.906179845938664, 0.2369268850561891],
  ];

  function makePreset(outInf, outSpeed, inInf, inSpeed) {
    return {
      out: { influence: outInf, speed: outSpeed },
      in: { influence: inInf, speed: inSpeed },
    };
  }

  const EASE_PRESETS = {
    linear: makePreset(100 / 3, 1, 100 / 3, 1),
    easy: makePreset(100 / 3, 0, 100 / 3, 0),
    smooth: makePreset(40, 0.25, 40, 0.25),
    easeInOutSoft: makePreset(25, 0, 25, 0),
    easeInOut: makePreset(50, 0, 50, 0),
    easeInOutStrong: makePreset(75, 0, 75, 0),
    accelerate: makePreset(50, 0, 20, 1.5),
    accelerateStrong: makePreset(80, 0, 15, 2.5),
    decelerate: makePreset(20, 1.5, 50, 0),
    decelerateStrong: makePreset(15, 2.5, 80, 0),
    expoInOut: makePreset(88, 0, 88, 0),
    expoAccelerate: makePreset(75, 0, 12, 7),
    expoDecelerate: makePreset(12, 7, 75, 0),
  };

  const PRESET_NAMES = Object.keys(EASE_PRESETS);

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function linearSide() {
    return { influence: LINEAR_SIDE_INFLUENCE * 100, speed: 1 };
  }

  function sanitizeSide(obj, context) {
    const inf = Number(obj.influence);
    const spd = Number(obj.speed);
    if (!Number.isFinite(inf) || !Number.isFinite(spd)) {
      throw new Error(
        "AetheriaTracks: " + context + " ease requires finite numeric 'influence' and 'speed'."
      );
    }
    return {
      influence: clamp(inf, MIN_INFLUENCE, MAX_INFLUENCE),
      speed: clamp(spd, -MAX_SPEED, MAX_SPEED),
    };
  }

  /**
   * Resolves a preset name or `{ influence, speed }` / `{ out, in }` spec.
   * When `side` is `"out"` or `"in"`, returns `{ influence, speed }`; otherwise `{ out, in }`.
   */
  function resolveEase(spec, side) {
    if (spec === undefined || spec === null) {
      return side ? linearSide() : { out: linearSide(), in: linearSide() };
    }
    if (typeof spec === "string") {
      if (!Object.prototype.hasOwnProperty.call(EASE_PRESETS, spec)) {
        throw new Error(
          "AetheriaTracks: unknown ease preset '" +
            spec +
            "'. Valid presets: " +
            PRESET_NAMES.join(", ") +
            "."
        );
      }
      const p = EASE_PRESETS[spec];
      if (side === "out") return { influence: p.out.influence, speed: p.out.speed };
      if (side === "in") return { influence: p.in.influence, speed: p.in.speed };
      return {
        out: { influence: p.out.influence, speed: p.out.speed },
        in: { influence: p.in.influence, speed: p.in.speed },
      };
    }
    if (typeof spec === "object" && !Array.isArray(spec)) {
      if ("out" in spec || "in" in spec) {
        const out = resolveEase(spec.out, "out");
        const inn = resolveEase(spec.in, "in");
        if (side === "out") return out;
        if (side === "in") return inn;
        return { out, in: inn };
      }
      if ("influence" in spec || "speed" in spec) {
        const s = sanitizeSide(spec, side || "segment");
        if (side === "out" || side === "in") return s;
        return { out: { influence: s.influence, speed: s.speed }, in: { influence: s.influence, speed: s.speed } };
      }
    }
    throw new Error("AetheriaTracks: invalid ease specification.");
  }

  function bez(p0, p1, p2, p3, u) {
    const v = 1 - u;
    return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
  }

  function bezD(p0, p1, p2, p3, u) {
    const v = 1 - u;
    return 3 * v * v * (p1 - p0) + 6 * v * u * (p2 - p1) + 3 * u * u * (p3 - p2);
  }

  function solveU(x0, x1, x2, x3, x) {
    if (x <= x0) return 0;
    if (x >= x3) return 1;
    if (x1 === x3 && x2 === x0) {
      // Exact inverse when full 100% influence creates a flat derivative at u = 0.5
      const progress = (x - x0) / (x3 - x0);
      return 0.5 + Math.cbrt((progress - 0.5) * 0.25);
    }
    let u = (x - x0) / (x3 - x0);
    for (let i = 0; i < 8; i++) {
      const f = bez(x0, x1, x2, x3, u) - x;
      const d = bezD(x0, x1, x2, x3, u);
      if (Math.abs(d) < 1e-12) break;
      if (Math.abs(f / d) < 1e-12) return u;
      const n = u - f / d;
      if (n < 0 || n > 1 || !Number.isFinite(n)) break;
      u = n;
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) * 0.5;
      if (bez(x0, x1, x2, x3, mid) < x) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) * 0.5;
  }

  /**
   * Computes normalized curve progress in [0..1] (with optional overshoot).
   * Supports both 5-arg `(outSpeedN, outInf, inSpeedN, inInf, x)` (influences in 0..1)
   * and 2-arg `(presetNameOrSpec, x)` convenience form.
   */
  function easeProgress(outSpeedN, outInf, inSpeedN, inInf, x) {
    if (typeof outSpeedN === "string" || (outSpeedN && typeof outSpeedN === "object")) {
      const pair = resolveEase(outSpeedN);
      const t = Number(outInf);
      return easeProgress(pair.out.speed, pair.out.influence / 100, pair.in.speed, pair.in.influence / 100, t);
    }
    const i0 = clamp(Number(outInf), 0, 1);
    const i1 = clamp(Number(inInf), 0, 1);
    const u = solveU(0, i0, 1 - i1, 1, Number(x));
    return bez(0, Number(outSpeedN) * i0, 1 - Number(inSpeedN) * i1, 1, u);
  }

  function onChord(a, c, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd <= 1e-24) return false;
    const t = (vx * dx + vy * dy + vz * dz) / dd;
    if (t < 0 || t > 1) return false;
    const ox = vx - dx * t;
    const oy = vy - dy * t;
    const oz = vz - dz * t;
    return ox * ox + oy * oy + oz * oz <= dd * 1e-18;
  }

  function spatialPoint(p, u) {
    return [
      bez(p[0][0], p[1][0], p[2][0], p[3][0], u),
      bez(p[0][1], p[1][1], p[2][1], p[3][1], u),
      bez(p[0][2], p[1][2], p[2][2], p[3][2], u),
    ];
  }

  function spatialTangentLen(p, u) {
    const dx = bezD(p[0][0], p[1][0], p[2][0], p[3][0], u);
    const dy = bezD(p[0][1], p[1][1], p[2][1], p[3][1], u);
    const dz = bezD(p[0][2], p[1][2], p[2][2], p[3][2], u);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function spatialArc(p, a, b) {
    const m = (a + b) * 0.5;
    const h = (b - a) * 0.5;
    let sum = 0;
    for (let i = 0; i < GAUSS.length; i++) {
      sum += GAUSS[i][1] * spatialTangentLen(p, m + h * GAUSS[i][0]);
    }
    return sum * h;
  }

  function buildSpatialSeg(p) {
    const table = new Array(ARC_N + 1);
    table[0] = 0;
    let acc = 0;
    for (let i = 1; i <= ARC_N; i++) {
      acc += spatialArc(p, (i - 1) / ARC_N, i / ARC_N);
      table[i] = acc;
    }
    const totalLen = acc;
    return {
      p,
      length: totalLen,
      atLength: function (s) {
        if (!(totalLen > 0 && Number.isFinite(totalLen))) return p[0];
        const target = clamp(s, 0, totalLen);
        let lo = 0;
        let hi = ARC_N;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (table[mid] < target) lo = mid + 1;
          else hi = mid;
        }
        const i = clamp(lo, 1, ARC_N);
        const a = table[i - 1];
        const b = table[i];
        const u0 = (i - 1) / ARC_N;
        const u1 = i / ARC_N;
        let u = u0 + (b > a ? (target - a) / (b - a) : 0) * (u1 - u0);
        for (let iter = 0; iter < 4; iter++) {
          const d = spatialTangentLen(p, u);
          if (d <= 1e-12) break;
          const e = a + spatialArc(p, u0, u) - target;
          u = clamp(u - e / d, u0, u1);
          if (Math.abs(e) <= 1e-12 * Math.max(1, totalLen)) break;
        }
        return spatialPoint(p, u);
      },
    };
  }

  function pad3(v) {
    return [v[0], v[1], v.length >= 3 ? v[2] : 0];
  }

  function eq3(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  function autoSpatial(keys, i) {
    if (i >= keys.length || keys.length < 2) {
      return { tin: [0, 0, 0], tout: [0, 0, 0] };
    }
    const a = pad3(keys[Math.max(0, i - 1)].v);
    const c = pad3(keys[Math.min(keys.length - 1, i + 1)].v);
    const p = pad3(keys[i].v);
    const toutRaw = [(c[0] - a[0]) / 6, (c[1] - a[1]) / 6, (c[2] - a[2]) / 6];
    const tin = i > 0 && eq3(a, p) ? [0, 0, 0] : [-toutRaw[0], -toutRaw[1], -toutRaw[2]];
    const tout = i + 1 < keys.length && eq3(c, p) ? [0, 0, 0] : toutRaw;
    return { tin, tout };
  }

  function cloneValue(v) {
    return Array.isArray(v) ? v.slice() : v;
  }

  function prepareKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error("AetheriaTracks: track keys must be a non-empty array.");
    }
    let expectedShape = -1;
    const out = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!k || typeof k !== "object") {
        throw new Error("AetheriaTracks: key at index " + i + " must be an object.");
      }
      const t = Number(k.t);
      if (!Number.isFinite(t)) {
        throw new Error("AetheriaTracks: key at index " + i + " requires a finite numeric 't'.");
      }
      let normV;
      let shape;
      if (typeof k.v === "number") {
        if (!Number.isFinite(k.v)) {
          throw new Error("AetheriaTracks: scalar key value at t=" + t + " is not finite.");
        }
        normV = k.v;
        shape = 0;
      } else if (Array.isArray(k.v)) {
        if (k.v.length === 0) {
          throw new Error("AetheriaTracks: array key value at t=" + t + " must not be empty.");
        }
        normV = new Array(k.v.length);
        for (let d = 0; d < k.v.length; d++) {
          const num = Number(k.v[d]);
          if (typeof k.v[d] !== "number" || !Number.isFinite(num)) {
            throw new Error("AetheriaTracks: key value component at t=" + t + " index " + d + " is not a finite number.");
          }
          normV[d] = num;
        }
        shape = normV.length;
      } else {
        throw new Error("AetheriaTracks: key at t=" + t + " requires numeric or numeric-array 'v'.");
      }

      if (expectedShape === -1) {
        expectedShape = shape;
      } else if (shape !== expectedShape) {
        const gotLabel = shape === 0 ? "scalar" : shape + " components";
        const expLabel = expectedShape === 0 ? "scalar" : String(expectedShape);
        throw new Error("AetheriaTracks: key at t=" + t + " has " + gotLabel + ", expected " + expLabel + ".");
      }

      if (k.ease !== undefined) resolveEase(k.ease);
      if (k.outEase !== undefined) resolveEase(k.outEase, "out");
      if (k.inEase !== undefined) resolveEase(k.inEase, "in");

      out[i] = {
        t,
        v: normV,
        ease: k.ease,
        outEase: k.outEase,
        inEase: k.inEase,
        hold: Boolean(k.hold),
      };
    }
    out.sort(function (a, b) {
      return a.t - b.t;
    });
    return { keys: out, shape: expectedShape };
  }

  function segmentSides(a, b) {
    const segPreset = a.ease !== undefined && a.ease !== null ? resolveEase(a.ease) : null;
    const hasOut = a.outEase !== undefined && a.outEase !== null;
    const hasIn = b.inEase !== undefined && b.inEase !== null;
    if (!segPreset && !hasOut && !hasIn) return null;
    const eo = hasOut ? resolveEase(a.outEase, "out") : segPreset ? segPreset.out : linearSide();
    const ei = hasIn ? resolveEase(b.inEase, "in") : segPreset ? segPreset.in : linearSide();
    return { eo, ei };
  }

  function evaluatePrepared(prep, sec, opts) {
    const sorted = prep.keys;
    const shape = prep.shape;
    if (sorted.length === 1 || sec <= sorted[0].t) {
      return cloneValue(sorted[0].v);
    }
    const last = sorted[sorted.length - 1];
    if (sec >= last.t) {
      return cloneValue(last.v);
    }

    let idx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].t <= sec) idx = i;
      else break;
    }
    const a = sorted[idx];
    const b = sorted[idx + 1];
    if (a.hold) {
      return cloneValue(a.v);
    }

    const dur = Math.max(1e-12, b.t - a.t);
    const x = clamp((sec - a.t) / dur, 0, 1);
    const sides = segmentSides(a, b);
    const f = sides
      ? easeProgress(sides.eo.speed, sides.eo.influence / 100, sides.ei.speed, sides.ei.influence / 100, x)
      : x;

    const isSpatial = Boolean(opts && opts.spatial) && (shape === 2 || shape === 3);
    if (isSpatial) {
      const p0 = pad3(a.v);
      const p3 = pad3(b.v);
      const outT = autoSpatial(sorted, idx).tout;
      const inT = autoSpatial(sorted, idx + 1).tin;
      const p1 = [p0[0] + outT[0], p0[1] + outT[1], p0[2] + outT[2]];
      const p2 = [p3[0] + inT[0], p3[1] + inT[1], p3[2] + inT[2]];
      let pos;
      if (onChord(p0, p1, p3) && onChord(p0, p2, p3)) {
        pos = [p0[0] + (p3[0] - p0[0]) * f, p0[1] + (p3[1] - p0[1]) * f, p0[2] + (p3[2] - p0[2]) * f];
      } else {
        const seg = buildSpatialSeg([p0, p1, p2, p3]);
        pos = seg.atLength(f * seg.length);
      }
      return shape === 2 ? [pos[0], pos[1]] : [pos[0], pos[1], pos[2]];
    }

    if (shape === 0) {
      return a.v + (b.v - a.v) * f;
    }
    const res = new Array(shape);
    for (let d = 0; d < shape; d++) {
      res[d] = a.v[d] + (b.v[d] - a.v[d]) * f;
    }
    return res;
  }

  /** Evaluates a keyframe track at time `t` seconds. */
  function evaluateTrack(keys, t, opts) {
    const prep = prepareKeys(keys);
    return evaluatePrepared(prep, Number(t) || 0, opts || {});
  }

  /** Numeric central-difference velocity (units/s) at time `t`. */
  function velocityAt(keys, t, opts) {
    const prep = prepareKeys(keys);
    const sec = Number(t) || 0;
    const h = 1e-3;
    const va = evaluatePrepared(prep, sec - h, opts || {});
    const vb = evaluatePrepared(prep, sec + h, opts || {});
    const dt = 2 * h;
    if (typeof va === "number") {
      return (vb - va) / dt;
    }
    const out = new Array(va.length);
    for (let d = 0; d < va.length; d++) {
      out[d] = (vb[d] - va[d]) / dt;
    }
    return out;
  }

  global.AetheriaTracks = {
    version: 1,
    EASE_PRESETS,
    easeProgress,
    resolveEase,
    evaluateTrack,
    velocityAt,
  };
})(typeof window !== "undefined" ? window : globalThis);
