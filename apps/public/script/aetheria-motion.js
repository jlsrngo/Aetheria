/**
 * Aetheria Motion Engine Runtime (v2.1 — Modular Per-Scene Architecture)
 * Deterministic 2D/SVG/Canvas Motion Graphics Toolkit for AI Film Generation.
 *
 * Every function in this runtime is a pure function of time `t` (seconds) and `seed`.
 * Exposed globally as `window.AetheriaMotion` and `window.AM`.
 */
(function (global) {
  "use strict";

  const TAU = Math.PI * 2;
  const SCENE_REGISTRY = Object.create(null);

  // ============================================================================
  // 1. Core Math & Interpolation
  // ============================================================================

  function clamp(v, min = 0, max = 1) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function invLerp(a, b, v) {
    if (Math.abs(b - a) < 1e-9) return 0;
    return clamp((v - a) / (b - a), 0, 1);
  }

  function remap(v, inMin, inMax, outMin, outMax, easeFn) {
    const u = invLerp(inMin, inMax, v);
    const k = typeof easeFn === "function" ? easeFn(u) : u;
    return lerp(outMin, outMax, k);
  }

  function smoothstep(edge0, edge1, x) {
    const t = invLerp(edge0, edge1, x);
    return t * t * (3 - 2 * t);
  }

  // ============================================================================
  // 2. Deterministic Seeded PRNG & Procedural Noise (Zero Math.random)
  // ============================================================================

  function hashUint32(seed) {
    let x = (seed | 0) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  }

  function rand(seed) {
    return hashUint32(Math.floor(seed * 100003) ^ 0x6d2b79f5) / 4294967296;
  }

  function rng(seed = 1) {
    let state = hashUint32(seed) || 1;
    // Callable PRNG that also exposes `.next()`, `.range(min, max)`, and `.pick(arr)`
    // so both `const r = AM.rng(7); r()` and `r.next()` work without throwing TypeError.
    const next = function () {
      state = hashUint32(state);
      return state / 4294967296;
    };
    next.next = next;
    next.range = function (min, max) {
      return min + (max - min) * next();
    };
    next.pick = function (arr) {
      if (!arr || !arr.length) return undefined;
      return arr[Math.floor(next() * arr.length)];
    };
    return next;
  }

  function noise1D(x, seed = 0) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = rand(i + seed * 1337) * 2 - 1;
    const b = rand(i + 1 + seed * 1337) * 2 - 1;
    return lerp(a, b, u);
  }

  function noise2D(x, y, seed = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const h = (dx, dy) => rand((ix + dx) * 374761 + (iy + dy) * 668265 + seed * 982451) * 2 - 1;
    const n00 = h(0, 0);
    const n10 = h(1, 0);
    const n01 = h(0, 1);
    const n11 = h(1, 1);
    return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy);
  }

  // ============================================================================
  // 3. Studio-Grade Easing & Spring Physics
  // ============================================================================

  const ease = {
    linear: (t) => clamp(t, 0, 1),
    inQuad: (t) => {
      const x = clamp(t, 0, 1);
      return x * x;
    },
    outQuad: (t) => {
      const x = clamp(t, 0, 1);
      return 1 - (1 - x) * (1 - x);
    },
    inOutQuad: (t) => {
      const x = clamp(t, 0, 1);
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    },
    inCubic: (t) => {
      const x = clamp(t, 0, 1);
      return x * x * x;
    },
    outCubic: (t) => {
      const x = clamp(t, 0, 1);
      return 1 - Math.pow(1 - x, 3);
    },
    inOutCubic: (t) => {
      const x = clamp(t, 0, 1);
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    },
    outQuart: (t) => {
      const x = clamp(t, 0, 1);
      return 1 - Math.pow(1 - x, 4);
    },
    inOutQuart: (t) => {
      const x = clamp(t, 0, 1);
      return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
    },
    outQuint: (t) => {
      const x = clamp(t, 0, 1);
      return 1 - Math.pow(1 - x, 5);
    },
    inOutQuint: (t) => {
      const x = clamp(t, 0, 1);
      return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
    },
    outExpo: (t) => {
      const x = clamp(t, 0, 1);
      return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
    },
    inOutExpo: (t) => {
      const x = clamp(t, 0, 1);
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
    },
    inBack: (t, overshoot = 1.70158) => {
      const x = clamp(t, 0, 1);
      const c3 = overshoot + 1;
      return c3 * x * x * x - overshoot * x * x;
    },
    outBack: (t, overshoot = 1.70158) => {
      const x = clamp(t, 0, 1);
      const c3 = overshoot + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2);
    },
    outElastic: (t) => {
      const x = clamp(t, 0, 1);
      if (x <= 0 || x >= 1) return x;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    },
    outBounce: (t) => {
      let x = clamp(t, 0, 1);
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
      if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
      return n1 * (x -= 2.625 / d1) * x + 0.984375;
    },
  };

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (u) => {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      let t = u;
      for (let i = 0; i < 10; i++) {
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t = clamp(t - (sx(t) - u) / d, 0, 1);
      }
      return sy(t);
    };
  }

  ease.pop = bezier(0.34, 1.56, 0.64, 1);
  ease.snap = bezier(0.85, 0, 0.15, 1);
  ease.aeGlide = bezier(0.16, 1, 0.3, 1);
  ease.aeSnap = bezier(0.76, 0, 0.24, 1);

  // Shorthand easing table E (compatible with 01-flat-vector / aetheria-motion demos)
  const E = {
    inQ: ease.inQuad,
    outQ: ease.outQuad,
    ioQ: ease.inOutQuad,
    inC: ease.inCubic,
    outC: ease.outCubic,
    ioC: ease.inOutCubic,
    outQt: ease.outQuart,
    ioQt: ease.inOutQuart,
    outQn: ease.outQuint,
    ioQn: ease.inOutQuint,
    outX: ease.outExpo,
    outB: ease.outBack,
    inB: (u, s = 1.70158) => {
      const x = clamp(u, 0, 1);
      return (s + 1) * x * x * x - s * x * x;
    },
    pop: ease.pop,
    snap: ease.snap,
    aeGlide: ease.aeGlide,
    aeSnap: ease.aeSnap,
  };

  /**
   * Closed-form damped spring (0 -> 1).
   * Supports both (t, f = 2, z = 0.4) from aetheria-motion AND (t, { stiffness, damping, mass }).
   */
  function spring(t, fOrOpts = 2, z = 0.4) {
    if (t <= 0) return 0;
    if (typeof fOrOpts === "number") {
      const f = fOrOpts;
      const zeta = clamp(z, 0.01, 0.999);
      const w = 2 * Math.PI * f;
      const a = zeta * w;
      const b = w * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-a * t) * (Math.cos(b * t) + (a / b) * Math.sin(b * t));
    }
    const opts = fOrOpts || {};
    const stiffness = opts.stiffness || 220;
    const damping = opts.damping || 16;
    const mass = opts.mass || 1;
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return (
        1 -
        Math.exp(-zeta * w0 * t) *
          (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
      );
    }
    return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  }

  /**
   * Closed-form derivative (velocity) of damped spring (f in Hz, damping ratio z).
   */
  function springV(t, f = 2, z = 0.4) {
    if (t <= 0) return 0;
    const zeta = clamp(z, 0.01, 0.999);
    const w = 2 * Math.PI * f;
    const a = zeta * w;
    const b = w * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-a * t) * ((w * w) / b) * Math.sin(b * t);
  }

  /**
   * Damped impulse wave (0 -> peak -> 0) starting at t0.
   * Ideal for camera impact shake, head nod, hair bounce, and landing thuds.
   */
  function kick(t, t0 = 0, f = 3, z = 0.35) {
    if (t <= t0) return 0;
    const zeta = clamp(z, 0.01, 0.999);
    const w = 2 * Math.PI * f;
    const tt = t - t0;
    return Math.exp(-zeta * w * tt) * Math.sin(w * Math.sqrt(1 - zeta * zeta) * tt);
  }

  /**
   * Spring pop with automatic velocity-driven squash & stretch [s, k].
   * Residual is pinned to [1, 0] after `pin` seconds so there is zero sub-pixel drift under camera zoom.
   */
  function pop(t, t0 = 0, f = 2.4, z = 0.42, amt = 0.12, pin = 0.9) {
    const tt = t - t0;
    let s = spring(tt, f, z);
    let k = clamp((springV(tt, f, z) / (2 * Math.PI * f)) * amt * 2, -0.3, 0.3);
    const w = E.ioQ(invLerp(pin * 0.7, pin, tt));
    s = lerp(s, 1, w);
    k = lerp(k, 0, w);
    return [s, k];
  }

  /**
   * Parabolic arc 0 -> 1 -> 0 for u in [0, 1].
   */
  function hump(u) {
    const x = clamp(u, 0, 1);
    return 4 * x * (1 - x);
  }

  /**
   * Frame-quantized selective shutter so flat wipe edges stay razor-sharp.
   */
  function crisp(t, k = 0.08, fps = 30) {
    const f0 = Math.round(t * fps) / fps;
    return f0 + (t - f0) * k;
  }

  /**
   * Quadratic Bezier jump arc between P0 and P1 with apex height H.
   */
  function arcP(P0, P1, H, q) {
    const u = clamp(q, 0, 1);
    const cx = (P0.x + P1.x) / 2;
    const cy = Math.min(P0.y, P1.y) - H;
    return {
      x: (1 - u) * (1 - u) * P0.x + 2 * (1 - u) * u * cx + u * u * P1.x,
      y: (1 - u) * (1 - u) * P0.y + 2 * (1 - u) * u * cy + u * u * P1.y,
    };
  }

  function anticipation(p, dip = 0.12) {
    const x = clamp(p, 0, 1);
    if (x < 0.18) {
      const u = x / 0.18;
      return -dip * Math.sin(u * Math.PI);
    }
    const u = (x - 0.18) / 0.82;
    return ease.outBack(u, 1.85);
  }

  function stagger(t, index, startTime = 0, stepDelay = 0.08, duration = 0.45, easeFn) {
    const local = (t - (startTime + index * stepDelay)) / Math.max(0.001, duration);
    const u = clamp(local, 0, 1);
    return typeof easeFn === "function" ? easeFn(u) : ease.outBack(u);
  }

  function squashStretch(v, amount = 0.12) {
    const stretch = 1 + clamp(v, -1, 1) * amount;
    const squash = 1 / Math.max(0.5, stretch);
    return { scaleX: squash, scaleY: stretch };
  }

  // ============================================================================
  // 3B. SVG Scene-Graph & Accent Primitives (from 01-flat-vector)
  // ============================================================================
  const SVG_NS = "http://www.w3.org/2000/svg";
  const f3 = (v) => Math.round(v * 1000) / 1000;

  function el(tag, attrs, parent) {
    if (typeof document === "undefined") return null;
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function G(parent, attrs) {
    return el("g", attrs, parent);
  }

  function tf(node, x, y, sx = 1, sy = sx, r = 0) {
    if (!node) return;
    if (Math.abs(sx) < 1e-4 || Math.abs(sy) < 1e-4) {
      sx = 0;
      sy = 0;
    }
    node.setAttribute(
      "transform",
      `translate(${f3(x)} ${f3(y)}) rotate(${f3(r)}) scale(${sx.toFixed(5)} ${sy.toFixed(5)})`
    );
  }

  function vis(node, visible) {
    if (!node || !node.style) return;
    node.style.display = visible ? "" : "none";
  }

  function burstLine(ln, cx, cy, a, r0, r1, t, t0, dur = 10 / 30) {
    const h = E.outC(invLerp(t0, t0 + dur * 0.7, t));
    const tl = E.outC(invLerp(t0 + dur * 0.3, t0 + dur, t));
    if (t < t0 || tl >= 1) {
      vis(ln, false);
      return;
    }
    vis(ln, true);
    const ra = lerp(r0, r1, tl);
    const rb = lerp(r0, r1, h);
    ln.setAttribute("x1", cx + Math.cos(a) * ra);
    ln.setAttribute("y1", cy + Math.sin(a) * ra);
    ln.setAttribute("x2", cx + Math.cos(a) * rb);
    ln.setAttribute("y2", cy + Math.sin(a) * rb);
  }

  function ring(c, t, t0, r0, r1, w0, dur = 12 / 30) {
    const u = invLerp(t0, t0 + dur, t);
    if (t < t0 || u >= 1) {
      vis(c, false);
      return;
    }
    vis(c, true);
    const w = w0 * Math.pow(1 - u, 1.15);
    if (w < 1.5) {
      vis(c, false);
      return;
    }
    c.setAttribute("r", lerp(r0, r1, E.outQ(u)));
    c.setAttribute("stroke-width", w);
  }

  function mixHex(a, b, k) {
    const parse = (h) => {
      let s = String(h || "#000000").trim();
      if (!s.startsWith("#")) s = "#" + s;
      if (s.length === 4) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
      return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) || 0);
    };
    const A = parse(a);
    const B = parse(b);
    return (
      "#" +
      A.map((v, i) => Math.round(v + (B[i] - v) * clamp(k, 0, 1)).toString(16).padStart(2, "0")).join("")
    );
  }

  /**
   * Canvas 2D equivalent of burstLine(): draws radial impact lines whose head shoots out and tail chases.
   */
  function drawBurstLines(ctx, cx, cy, count, r0, r1, t, t0, dur = 0.35, color = "#FFC62B", lineWidth = 8) {
    const h = E.outC(invLerp(t0, t0 + dur * 0.7, t));
    const tl = E.outC(invLerp(t0 + dur * 0.3, t0 + dur, t));
    if (t < t0 || tl >= 1) return;
    const ra = lerp(r0, r1, tl);
    const rb = lerp(r0, r1, h);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * ra, cy + Math.sin(a) * ra);
      ctx.lineTo(cx + Math.cos(a) * rb, cy + Math.sin(a) * rb);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Canvas 2D equivalent of ring(): draws an expanding shockwave ring whose stroke-width thins to 0.
   */
  function drawShockRing(ctx, cx, cy, t, t0, r0, r1, w0 = 16, dur = 0.4, color = "#FF5A4E") {
    const u = invLerp(t0, t0 + dur, t);
    if (t < t0 || u >= 1) return;
    const w = w0 * Math.pow(1 - u, 1.15);
    if (w < 1.2) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, lerp(r0, r1, E.outQ(u)), 0, TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.restore();
  }

  // ============================================================================
  // 4. Modular Scene Registry & Multi-Scene Timeline Router
  // ============================================================================

  /**
   * Registers a modular scene renderer function from `workspace/script/sceneN.js`.
   * Resilient to naming variations (`"scene1_hook"`, `"scene1"`, `1`, `0`).
   */
  function registerScene(idOrIndex, renderFn) {
    if (typeof renderFn !== "function") return;
    const key = String(idOrIndex).trim();
    SCENE_REGISTRY[key] = renderFn;
    const m = key.match(/^scene[_-]?(\d+)/i);
    if (m) {
      const num = Number(m[1]);
      if (!SCENE_REGISTRY[`scene${num}`]) SCENE_REGISTRY[`scene${num}`] = renderFn;
      if (!SCENE_REGISTRY[String(num - 1)]) SCENE_REGISTRY[String(num - 1)] = renderFn;
    }
  }

  function getSceneRenderer(sceneId, index) {
    if (sceneId && SCENE_REGISTRY[sceneId]) return SCENE_REGISTRY[sceneId];
    const byOneBased = SCENE_REGISTRY[`scene${index + 1}`];
    if (byOneBased) return byOneBased;
    const byZeroIndex = SCENE_REGISTRY[String(index)];
    if (byZeroIndex) return byZeroIndex;
    if (sceneId) {
      const prefixKey = Object.keys(SCENE_REGISTRY).find(
        (k) => sceneId.startsWith(k) || k.startsWith(`scene${index + 1}`)
      );
      if (prefixKey) return SCENE_REGISTRY[prefixKey];
    }
    return null;
  }

  function resolveScene(t, scenes) {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      return { scene: null, index: 0, localTime: t, duration: 10, progress: clamp(t / 10, 0, 1) };
    }
    let cursor = 0;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const start = typeof s.start === "number" ? s.start : cursor;
      const dur =
        typeof s.duration === "number"
          ? s.duration
          : typeof s.end === "number"
          ? s.end - start
          : 5;
      const end = start + dur;
      cursor = end;
      if (t + 0.012 < end || i === scenes.length - 1) {
        const localTime = clamp(t - start, 0, dur);
        return {
          scene: s,
          index: i,
          start,
          end,
          duration: dur,
          localTime,
          progress: dur > 0 ? clamp(localTime / dur, 0, 1) : 0,
        };
      }
    }
    const last = scenes[scenes.length - 1];
    return { scene: last, index: scenes.length - 1, localTime: 0, duration: 1, progress: 1 };
  }

  let _trBufA = null;
  let _trBufB = null;

  function _ensureTransitionBuffer(slot, W, H) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    let buf = slot === 0 ? _trBufA : _trBufB;
    if (!buf || buf.width !== W || buf.height !== H) {
      buf = document.createElement("canvas");
      buf.width = W;
      buf.height = H;
      if (slot === 0) _trBufA = buf;
      else _trBufB = buf;
    }
    return buf;
  }

  function _computeSceneIntervals(scenes) {
    const out = [];
    let cursor = 0;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const start = typeof s.start === "number" ? s.start : cursor;
      const dur =
        typeof s.duration === "number"
          ? s.duration
          : typeof s.end === "number"
          ? s.end - start
          : 5;
      const end = start + Math.max(0.001, dur);
      cursor = end;
      out.push({ scene: s, index: i, start, dur: Math.max(0.001, dur), end });
    }
    return out;
  }

  function evalCurve(curve, u) {
    const t = clamp(Number(u) || 0, 0, 1);
    if (!Array.isArray(curve) || curve.length < 2) {
      return ease.inOutCubic(t);
    }
    const n = curve.length;
    const pos = t * (n - 1);
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(pos)));
    const frac = pos - i0;
    return clamp(lerp(Number(curve[i0]) || 0, Number(curve[i0 + 1]) || 0, frac), 0, 1);
  }

  function resolveTransition(t, scenes) {
    if (global.__isolateSceneTransition === true) return null;
    if (!Array.isArray(scenes) || scenes.length < 2) return null;
    const sec = Number.isFinite(t) ? Math.max(0, t) : 0;
    const intervals = _computeSceneIntervals(scenes);
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const cur = intervals[i];
      const tb = cur.scene && cur.scene.transitionBridge;
      if (!tb || typeof tb.kind !== "string") {
        continue;
      }
      const isPush = tb.kind.indexOf("push_") === 0;
      const isZoomBlur =
        tb.kind === "zoom_blur" ||
        tb.kind === "zoom_in" ||
        tb.kind === "zoom_out" ||
        tb.kind === "blur_dissolve";
      if (!isPush && !isZoomBlur) {
        continue;
      }
      const t0 = Number(tb.tStart);
      const t1 = Number(tb.tEnd);
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
        continue;
      }
      if (sec >= t0 && sec <= t1) {
        const u = clamp((sec - t0) / (t1 - t0), 0, 1);
        const progress = evalCurve(tb.curve, u);
        const cutSec = Number.isFinite(Number(tb.cutSec)) ? Number(tb.cutSec) : cur.start;
        const totalDispPx = Number.isFinite(Number(tb.totalDispPx)) ? Number(tb.totalDispPx) : 0;
        return {
          active: true,
          kind: tb.kind,
          fromIndex: prev.index,
          toIndex: cur.index,
          fromScene: prev.scene,
          toScene: cur.scene,
          fromLocalTime: clamp(sec - prev.start, 0, prev.dur),
          toLocalTime: clamp(sec - cur.start, 0, cur.dur),
          tStart: t0,
          tEnd: t1,
          cutSec,
          totalDispPx,
          u,
          progress,
          curve: tb.curve,
        };
      }
    }
    return null;
  }

  function renderFrameWithTransitions(ctx, sec, scenes, W = 1080, H = 1920, renderSceneFn) {
    if (!ctx || !Array.isArray(scenes) || scenes.length === 0 || typeof renderSceneFn !== "function") {
      return;
    }
    const tr = resolveTransition(sec, scenes);
    if (!tr) {
      const resolved = resolveScene(sec, scenes);
      renderSceneFn(ctx, resolved.scene, resolved.index, resolved.localTime, sec);
      return;
    }

    const bufA = _ensureTransitionBuffer(0, W, H);
    const bufB = _ensureTransitionBuffer(1, W, H);
    const cA = bufA && typeof bufA.getContext === "function" ? bufA.getContext("2d") : null;
    const cB = bufB && typeof bufB.getContext === "function" ? bufB.getContext("2d") : null;

    // 1. MotionCraft-style Zoom + Optical Blur Cross-Dissolve Bridge
    if (
      tr.kind === "zoom_blur" ||
      tr.kind === "zoom_in" ||
      tr.kind === "zoom_out" ||
      tr.kind === "blur_dissolve"
    ) {
      const p = ease.inOutQuart(tr.u);
      const outScale = tr.kind === "zoom_out" ? lerp(1.0, 0.86, p) : lerp(1.0, 1.16, p);
      const inScale = tr.kind === "zoom_out" ? lerp(1.14, 1.0, p) : lerp(0.90, 1.0, p);
      const outBlur = p * 12;
      const inBlur = (1 - p) * 12;
      if (cA && cB) {
        cA.setTransform(1, 0, 0, 1, 0, 0);
        cA.clearRect(0, 0, W, H);
        renderSceneFn(cA, tr.fromScene, tr.fromIndex, tr.fromLocalTime, sec);

        cB.setTransform(1, 0, 0, 1, 0, 0);
        cB.clearRect(0, 0, W, H);
        renderSceneFn(cB, tr.toScene, tr.toIndex, tr.toLocalTime, sec);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = clamp(1 - p, 0, 1);
        if (outBlur > 0.5) ctx.filter = `blur(${outBlur.toFixed(1)}px)`;
        ctx.translate(W * 0.5, H * 0.5);
        ctx.scale(outScale, outScale);
        ctx.drawImage(bufA, -W * 0.5, -H * 0.5);
        ctx.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = clamp(p, 0, 1);
        if (inBlur > 0.5) ctx.filter = `blur(${inBlur.toFixed(1)}px)`;
        ctx.translate(W * 0.5, H * 0.5);
        ctx.scale(inScale, inScale);
        ctx.drawImage(bufB, -W * 0.5, -H * 0.5);
        ctx.restore();
      } else {
        const resolved = resolveScene(sec, scenes);
        renderSceneFn(ctx, resolved.scene, resolved.index, resolved.localTime, sec);
      }
      return;
    }

    // 2. Continuous Full-Canvas Side-by-Side Camera Push (follows measured 16-point curve `tr.progress`
    // seamlessly across `tStart..cutSec..tEnd` with zero blank strip, zero cutSec snap, and zero clip seam)
    const p = tr.progress;
    let fx = 0;
    let fy = 0;
    let tx = 0;
    let ty = 0;
    if (tr.kind === "push_left") {
      fx = -p * W;
      tx = (1 - p) * W;
    } else if (tr.kind === "push_right") {
      fx = p * W;
      tx = -(1 - p) * W;
    } else if (tr.kind === "push_up") {
      fy = -p * H;
      ty = (1 - p) * H;
    } else if (tr.kind === "push_down") {
      fy = p * H;
      ty = -(1 - p) * H;
    }

    if (cA && cB) {
      cA.setTransform(1, 0, 0, 1, 0, 0);
      cA.clearRect(0, 0, W, H);
      renderSceneFn(cA, tr.fromScene, tr.fromIndex, tr.fromLocalTime, sec);

      cB.setTransform(1, 0, 0, 1, 0, 0);
      cB.clearRect(0, 0, W, H);
      renderSceneFn(cB, tr.toScene, tr.toIndex, tr.toLocalTime, sec);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bufA, fx, fy);
      ctx.drawImage(bufB, tx, ty);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(fx, fy);
      renderSceneFn(ctx, tr.fromScene, tr.fromIndex, tr.fromLocalTime, sec);
      ctx.restore();
      ctx.save();
      ctx.translate(tx, ty);
      renderSceneFn(ctx, tr.toScene, tr.toIndex, tr.toLocalTime, sec);
      ctx.restore();
    }
  }

  // ============================================================================
  // 5. Studio Canvas Drawing Primitives & Shared Layout Zones
  // ============================================================================

  function normalizeCornerRadii(r, maxR) {
    if (Array.isArray(r)) {
      const n = r.length;
      const v0 = n > 0 ? clamp(Number(r[0]) || 0, 0, maxR) : 0;
      const v1 = n > 1 ? clamp(Number(r[1]) || 0, 0, maxR) : v0;
      const v2 = n > 2 ? clamp(Number(r[2]) || 0, 0, maxR) : v0;
      const v3 = n > 3 ? clamp(Number(r[3]) || 0, 0, maxR) : v1;
      return [v0, v1, v2, v3];
    }
    const s = clamp(Number(r) || 0, 0, maxR);
    return [s, s, s, s];
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rw = Math.max(0, Number(w) || 0);
    const rh = Math.max(0, Number(h) || 0);
    const maxR = Math.min(rw / 2, rh / 2);
    const [tl, tr, br, bl] = normalizeCornerRadii(r, maxR);
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + rw - tr, y);
    if (tr > 0) ctx.arcTo(x + rw, y, x + rw, y + tr, tr);
    ctx.lineTo(x + rw, y + rh - br);
    if (br > 0) ctx.arcTo(x + rw, y + rh, x + rw - br, y + rh, br);
    ctx.lineTo(x + bl, y + rh);
    if (bl > 0) ctx.arcTo(x, y + rh, x, y + rh - bl, bl);
    ctx.lineTo(x, y + tl);
    if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, w, h, r) {
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function strokeRoundRect(ctx, x, y, w, h, r) {
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  function hexAlpha(hex, alpha) {
    const clean = String(hex || "#FFC62B").replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16) || 255;
    const g = parseInt(clean.substring(2, 4), 16) || 200;
    const b = parseInt(clean.substring(4, 6), 16) || 50;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function drawGridBackdrop(ctx, t, accentColor, bgTop, bgBottom, W = 1080, H = 1920) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, bgTop || "#131836");
    grad.addColorStop(1, bgBottom || "#090D1A");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    const step = 90;
    const offset = (t * 18) % step;
    for (let x = 0; x <= W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = -step + offset; y <= H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const rad = ctx.createRadialGradient(W / 2, 720, 40, W / 2, 720, 520);
    rad.addColorStop(0, hexAlpha(accentColor, 0.22));
    rad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 180, W, 1080);
    ctx.restore();
  }

  function drawTopHeader(ctx, scene, localTimeOrIdx, globalTime) {
    const lt = typeof localTimeOrIdx === "number" ? localTimeOrIdx : 0.5;
    const gt = typeof globalTime === "number" ? globalTime : lt;
    const enter = spring(lt + 0.25, { stiffness: 240, damping: 18 });
    const accent = scene.accent || "#FFC62B";
    const secondary = scene.secondary || "#38BDF8";
    ctx.save();
    ctx.translate(0, (1 - enter) * -60);

    roundRect(ctx, 64, 72, 260, 54, 27);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#151433";
    ctx.stroke();

    ctx.font = "800 22px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#151433";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scene.code || scene.tag || `SCENE ${scene.index || scene.id || ""}`, 64 + 130, 99);

    roundRect(ctx, 344, 72, 672, 54, 27);
    ctx.fillStyle = "rgba(21, 20, 51, 0.85)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hexAlpha(accent, 0.55);
    ctx.stroke();

    ctx.font = "700 21px 'Inter', sans-serif";
    ctx.fillStyle = "#FFF6E9";
    ctx.textAlign = "left";
    ctx.fillText(scene.era || scene.title || scene.headline || "", 374, 99);

    const pulse = 0.5 + 0.5 * Math.sin(gt * 6);
    ctx.beginPath();
    ctx.arc(976, 99, 8 + pulse * 3, 0, TAU);
    ctx.fillStyle = secondary;
    ctx.fill();
    ctx.restore();
  }

  function drawHeadlinePlaque(ctx, scene, localTime) {
    const pop = spring(Math.max(0.05, localTime + 0.15), { stiffness: 210, damping: 17 });
    const accent = scene.accent || "#FFC62B";
    ctx.save();
    ctx.translate(540, 1285);
    ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);

    const cardW = 952;
    const cardH = 196;
    ctx.fillStyle = "#07070E";
    roundRect(ctx, -cardW / 2 + 10, -cardH / 2 + 12, cardW, cardH, 26);
    ctx.fill();

    ctx.fillStyle = "#151433";
    roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 26);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = accent;
    ctx.stroke();

    ctx.fillStyle = accent;
    roundRect(ctx, -cardW / 2 + 28, -cardH / 2 + 20, 180, 10, 5);
    ctx.fill();

    const mainTitle = scene.headline || scene.title || "";
    const subTitle = scene.subheadline || scene.subtitle || "";

    ctx.font = "900 42px 'Inter', sans-serif";
    ctx.fillStyle = "#FFF6E9";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(mainTitle, 0, -18);

    if (subTitle) {
      ctx.font = "600 25px 'Inter', sans-serif";
      ctx.fillStyle = "#CBD5E1";
      ctx.fillText(subTitle, 0, 42);
    }

    ctx.restore();
  }

  function drawElectricBolt(ctx, x1, y1, x2, y2, segments, jitterAmp, seed, color, width) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i < segments; i++) {
      const u = i / segments;
      const bx = lerp(x1, x2, u);
      const by = lerp(y1, y2, u);
      const nx = -(y2 - y1);
      const ny = x2 - x1;
      const len = Math.hypot(nx, ny) || 1;
      const n = noise1D(i * 2.3 + seed * 11.7, seed) * jitterAmp;
      ctx.lineTo(bx + (nx / len) * n, by + (ny / len) * n);
    }
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color || "#38BDF8";
    ctx.lineWidth = width || 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color || "#38BDF8";
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Applies a 2D studio camera transform (zoom `s`, focus center `cx`, `cy`, rotation `rot`) on Canvas 2D.
   */
  function applyCamera(ctx, cam, W = 1080, H = 1920) {
    if (!ctx || !cam) return;
    const s = typeof cam.s === "number" ? cam.s : 1;
    const cx = typeof cam.cx === "number" ? cam.cx : W / 2;
    const cy = typeof cam.cy === "number" ? cam.cy : H / 2;
    const rot = ((cam.rot || 0) * Math.PI) / 180;
    ctx.translate(W / 2, H / 2);
    if (rot !== 0) ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
  }

  function evalCameraTrack(track, localT, W = 1080, H = 1920) {
    if (!Array.isArray(track) || track.length === 0) return null;
    const t = Number.isFinite(localT) ? Math.max(0, localT) : 0;
    let k0 = track[0];
    let k1 = track[track.length - 1];
    if (t <= Number(k0.t || 0)) {
      k1 = k0;
    } else if (t >= Number(k1.t || 0)) {
      k0 = k1;
    } else {
      for (let i = 0; i < track.length - 1; i++) {
        const a = track[i];
        const b = track[i + 1];
        if (t >= Number(a.t || 0) && t <= Number(b.t || 0)) {
          k0 = a;
          k1 = b;
          break;
        }
      }
    }
    const u = k0 === k1 ? 0 : invLerp(Number(k0.t || 0), Number(k1.t || 0), t);
    const s = Math.max(1e-4, lerp(Number(k0.s ?? 1), Number(k1.s ?? 1), u));
    const tx = lerp(Number(k0.tx || 0), Number(k1.tx || 0), u);
    const ty = lerp(Number(k0.ty || 0), Number(k1.ty || 0), u);
    const rot = lerp(Number(k0.rot || 0), Number(k1.rot || 0), u);
    const rad = (rot * Math.PI) / 180;
    const a = s * Math.cos(rad);
    const b = -s * Math.sin(rad);
    const c = s * Math.sin(rad);
    const d = s * Math.cos(rad);
    const s2 = s * s;
    const cx = W * 0.5 - (a * tx + c * ty) / s2;
    const cy = H * 0.5 - (b * tx + d * ty) / s2;
    return { s, cx, cy, rot };
  }

  function applyTrackedCamera(ctx, track, localT, W = 1080, H = 1920) {
    const cam = evalCameraTrack(track, localT, W, H);
    if (!cam) return false;
    applyCamera(ctx, cam, W, H);
    return true;
  }

  /**
   * Multi-layer Flat-Vector Shape Wipe transition (from 01-flat-vector W1 -> W2 -> W3):
   * Layer 1: Expanding circle from (originX, originY)
   * Layer 2: Rotating capsule sweep
   * Layer 3: Slamming half-disc with kick overshoot
   */
  function drawShapeWipe(ctx, t, tStart, dur = 0.65, colors, originX = 540, originY = 660, W = 1080, H = 1920) {
    const tc = crisp(t, 0.08);
    if (tc < tStart || tc > tStart + dur + 0.35) return;
    const palette = Array.isArray(colors) && colors.length >= 3 ? colors : ["#FF5A4E", "#2EE6A8", "#FFF6E9"];

    // W1: Expanding circle
    const u1 = invLerp(tStart, tStart + dur * 0.55, tc);
    if (u1 > 0 && u1 < 1) {
      const r1 = 48 * Math.exp(lerp(Math.log(1), Math.log(48), E.ioQ(u1)));
      ctx.save();
      ctx.fillStyle = palette[0];
      ctx.beginPath();
      ctx.arc(lerp(originX, W / 2, u1), lerp(originY, H / 2, u1), r1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // W2: Rotating capsule
    const t2 = tStart + dur * 0.22;
    const u2 = invLerp(t2, t2 + dur * 0.55, tc);
    if (u2 > 0 && u2 < 1) {
      const k = Math.exp(lerp(Math.log(0.04), Math.log(1.35), E.ioQ(u2)));
      ctx.save();
      ctx.translate(lerp(originX, W / 2, E.outQ(u2)), lerp(originY, H / 2, E.outQ(u2)));
      ctx.rotate(((25 * (1 - E.outB(u2, 1.6))) * Math.PI) / 180);
      ctx.scale(k, k);
      ctx.fillStyle = palette[1];
      roundRect(ctx, -1200, -900, 2400, 1800, 900);
      ctx.fill();
      ctx.restore();
    }

    // W3: Half-disc slam with kick
    const t3 = tStart + dur * 0.45;
    const sl = tStart + dur * 0.85;
    const u3 = invLerp(t3, sl, tc);
    if (u3 > 0 && tc < sl + 0.25) {
      const kk = kick(tc, sl, 3.5, 0.4);
      const fadeOut = 1 - invLerp(sl + 0.05, sl + 0.25, tc);
      ctx.save();
      ctx.globalAlpha = fadeOut;
      ctx.translate(W / 2, H / 2 - 2200 * (1 - E.inQ(u3)) + 40 * kk);
      ctx.rotate(((7 * (1 - u3)) * Math.PI) / 180);
      ctx.scale(1, 1 - 0.06 * kk);
      ctx.fillStyle = palette[2];
      ctx.beginPath();
      ctx.arc(0, 0, 1700, Math.PI, 0, false);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Articulated Flat-Vector Character Rig (from 01-flat-vector CH -> neck -> head -> eyes/brows/mouth + shoulders/elbows/hands).
   * Supports custom arm angles, hand-held props (`onRightHand`, `onLeftHand`), hairstyles (`"bun"`, `"short"`, `"beard"`, `"colonial"`, `"curly"`),
   * and facial expressions (`"smile"`, `"surprised"`, `"shocked"`, `"focused"`).
   */
  function drawCharacterRig(ctx, t, opts = {}) {
    const x = opts.x !== undefined ? opts.x : 540;
    const y = opts.y !== undefined ? opts.y : 780;
    const scale = opts.scale !== undefined ? opts.scale : 1;
    const coatColor = opts.coatColor || "#2EE6A8";
    const coatShade = opts.coatShade || "#1FC28C";
    const skinColor = opts.skinColor || "#FFB48C";
    const hairColor = opts.hairColor || "#151433";
    const hairStyle = opts.hairStyle || "bun";
    const hasGlasses = opts.glasses !== undefined ? opts.glasses : true;
    const reactTime = opts.reactTime !== undefined ? opts.reactTime : 1.8;
    const reachTime = opts.reachTime !== undefined ? opts.reachTime : 2.4;

    const [enterS, enterK] = pop(t + 0.25, 0, 2.4, 0.42, 0.18);
    const hs = pop(t, reactTime, 2.6, 0.35, 0, 1.4)[0];
    const lean = (opts.lean !== undefined ? opts.lean : 3.5 * pop(t, reactTime, 2.0, 0.4)[0]);
    const nod = 6 * Math.pow(1 - Math.abs(Math.sin(TAU * t)), 4);
    const blink = Math.max(
      hump(invLerp(1.1, 1.24, t % 3.2)),
      hump(invLerp(reactTime - 0.1, reactTime + 0.05, t))
    );
    const rch = E.outB(invLerp(reachTime, reachTime + 0.35, t), 1.8);
    const expr =
      opts.expression ||
      (t > reactTime && t < reachTime + 0.55 ? "surprised" : "smile");

    ctx.save();
    ctx.translate(x, y);
    ctx.scale((scale * Math.max(0.01, enterS)) / (1 + enterK), scale * Math.max(0.01, enterS) * (1 + enterK));
    ctx.rotate((lean * Math.PI) / 180);

    // Torso
    ctx.fillStyle = coatColor;
    roundRect(ctx, -170, -200, 340, 280, 85);
    ctx.fill();
    ctx.fillStyle = coatShade;
    roundRect(ctx, 90, -195, 80, 275, 40);
    ctx.fill();

    // Collar V-neck / Cravat
    ctx.fillStyle = opts.collarColor || skinColor;
    ctx.beginPath();
    ctx.moveTo(-38, -200);
    ctx.lineTo(0, -148);
    ctx.lineTo(38, -200);
    ctx.closePath();
    ctx.fill();

    // Left Arm (Shoulder -> Upper -> Forearm -> Hand)
    const lSh =
      opts.leftSh !== undefined
        ? opts.leftSh
        : 14 + 3 * Math.sin(t * 5.5);
    const lFo =
      opts.leftFo !== undefined
        ? opts.leftFo
        : -92 + 7 * Math.sin(t * 5.5);
    ctx.save();
    ctx.translate(-142, -148);
    ctx.rotate((lSh * Math.PI) / 180);
    ctx.strokeStyle = coatShade;
    ctx.lineWidth = 56;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 112);
    ctx.stroke();
    ctx.translate(0, 112);
    ctx.rotate((lFo * Math.PI) / 180);
    ctx.strokeStyle = skinColor;
    ctx.lineWidth = 38;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 96);
    ctx.stroke();
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(0, 102, 24, 0, TAU);
    ctx.fill();
    if (typeof opts.onLeftHand === "function") {
      ctx.save();
      ctx.translate(0, 102);
      opts.onLeftHand(ctx);
      ctx.restore();
    }
    ctx.restore();

    // Neck & Head Group (drawn before Right Arm if Right Arm reaches across face/hair)
    ctx.save();
    const hr =
      opts.headTilt !== undefined
        ? opts.headTilt
        : 10 * Math.max(hs, 0) * (t > reactTime ? 1 : 0);
    ctx.translate(8 * hs * (t > reactTime ? 1 : 0), -200 + nod * 0.4);
    ctx.rotate(((hr * 0.35) * Math.PI) / 180);
    ctx.fillStyle = skinColor;
    ctx.fillRect(-25, -40, 50, 56);

    ctx.translate(0, -86 + nod);
    ctx.rotate(((hr * 0.65) * Math.PI) / 180);

    // Back hair for colonial / curly / beard styles
    if (hairStyle === "colonial" || hairStyle === "curly") {
      ctx.fillStyle = hairColor;
      ctx.beginPath();
      ctx.arc(-82, 4, 34, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(82, 4, 34, 0, TAU);
      ctx.fill();
    }

    // Ears & Head base
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(-90, 12, 18, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(90, 12, 18, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 94, 0, TAU);
    ctx.fill();

    // Hair style variations
    if (hairStyle === "bun") {
      ctx.save();
      const bunRot = -8 * kick(t, reactTime, 2.4, 0.3);
      ctx.rotate((bunRot * Math.PI) / 180);
      ctx.fillStyle = hairColor;
      ctx.beginPath();
      ctx.arc(34, -116, 36, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.arc(0, -14, 96, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();

    if (hairStyle === "beard") {
      // Ancient Greek philosopher beard & laurel/headband
      ctx.strokeStyle = "#FFC62B";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(-88, -32);
      ctx.quadraticCurveTo(0, -48, 88, -32);
      ctx.stroke();

      ctx.fillStyle = hairColor;
      ctx.beginPath();
      ctx.moveTo(-72, 28);
      ctx.quadraticCurveTo(-78, 118, 0, 132);
      ctx.quadraticCurveTo(78, 118, 72, 28);
      ctx.quadraticCurveTo(0, 56, -72, 28);
      ctx.closePath();
      ctx.fill();
    }

    // Cheek blush
    ctx.fillStyle = "#FF8C82";
    ctx.beginPath();
    ctx.arc(-52, 38, 13, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(52, 38, 13, 0, TAU);
    ctx.fill();

    // Eyes with blink & look shift
    const look = opts.lookX !== undefined ? opts.lookX : t > reactTime ? 8 * hs : 0;
    const lookY = opts.lookY !== undefined ? opts.lookY : 0;
    const eyeScale = expr === "surprised" || expr === "shocked" ? 1.25 : 1.0;
    const eyeRy = Math.max(1.5, 12 * eyeScale * (1 - 0.9 * blink));
    ctx.fillStyle = "#151433";
    [-34, 34].forEach((ex) => {
      ctx.beginPath();
      ctx.ellipse(ex + look, 10 + lookY, 9 * eyeScale, eyeRy, 0, 0, TAU);
      ctx.fill();
    });

    // Glasses
    if (hasGlasses) {
      ctx.strokeStyle = "#151433";
      ctx.lineWidth = 6;
      [-34, 34].forEach((gx) => {
        ctx.beginPath();
        ctx.arc(gx, 10, 27, 0, TAU);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(-7, 6);
      ctx.quadraticCurveTo(0, 0, 7, 6);
      ctx.stroke();
    }

    // Eyebrows
    const browLift =
      expr === "surprised" || expr === "shocked" ? -12 : t > reactTime ? -8 * hs : 0;
    ctx.strokeStyle = "#151433";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(s * 20, -28 + browLift);
      ctx.lineTo(s * 46, -24 + browLift);
      ctx.stroke();
    });

    // Mouth (Smile vs Surprised O-mouth vs Shocked)
    if (expr === "surprised" || expr === "shocked") {
      ctx.fillStyle = "#151433";
      ctx.beginPath();
      ctx.ellipse(
        look * 0.5,
        52,
        expr === "shocked" ? 14 : 10,
        expr === "shocked" ? 17 : 13,
        0,
        0,
        TAU
      );
      ctx.fill();
    } else {
      ctx.strokeStyle = "#151433";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-18 + look * 0.5, 45);
      ctx.quadraticCurveTo(look * 0.5, 59, 18 + look * 0.5, 45);
      ctx.stroke();
    }

    ctx.restore();

    // Right Arm (Foreground — Reaches out or holds props)
    const rSh =
      opts.rightSh !== undefined
        ? opts.rightSh
        : lerp(-14 + 3 * Math.sin(t * 5.5 + 2), -78, rch);
    const rFo =
      opts.rightFo !== undefined
        ? opts.rightFo
        : lerp(92 + 7 * Math.sin(t * 5.5 + 2), 14, rch);
    ctx.save();
    ctx.translate(142, -148);
    ctx.rotate((rSh * Math.PI) / 180);
    ctx.strokeStyle = coatShade;
    ctx.lineWidth = 56;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 112);
    ctx.stroke();
    ctx.translate(0, 112);
    ctx.rotate((rFo * Math.PI) / 180);
    ctx.strokeStyle = skinColor;
    ctx.lineWidth = 38;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 96);
    ctx.stroke();
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(0, 102, 24, 0, TAU);
    ctx.fill();
    if (typeof opts.onRightHand === "function") {
      ctx.save();
      ctx.translate(0, 102);
      opts.onRightHand(ctx);
      ctx.restore();
    }
    ctx.restore();

    ctx.restore();
  }

  // ============================================================================
  // 6. Kinetic Subtitles (Canvas 2D & SVG) synced with Voicebox .words.json
  // ============================================================================

  function drawSubtitles(ctx, words, localTime, opts) {
    if (!ctx || !Array.isArray(words) || words.length === 0) return;
    const normalizedOpts =
      typeof opts === "string" ? { activeColor: opts } : opts || {};
    const explicitStyle = String(normalizedOpts.style || normalizedOpts.variant || "").toLowerCase();
    const wantsLegacyPill =
      explicitStyle === "pill" ||
      explicitStyle === "dark" ||
      explicitStyle === "classic" ||
      (normalizedOpts.wordsPerGroup != null &&
        Number(normalizedOpts.wordsPerGroup) > 1 &&
        explicitStyle !== "neobrutalism") ||
      (normalizedOpts.bgColor != null && explicitStyle !== "neobrutalism");
    const isNeobrutal = !wantsLegacyPill;
    const options = Object.assign(
      {
        x: 540,
        y: isNeobrutal ? 1580 : 1600,
        maxWidth: 920,
        wordsPerGroup: isNeobrutal ? 1 : 5,
        fontSize: isNeobrutal ? 72 : 56,
        fontFamily: isNeobrutal
          ? "'Fredoka', 'Inter', 'Plus Jakarta Sans', system-ui, sans-serif"
          : "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif",
        activeColor: "#FFDE59",
        pastColor: "#FFFFFF",
        upcomingColor: "rgba(255,255,255,0.6)",
        bgColor: "rgba(12, 12, 20, 0.86)",
        borderColor: isNeobrutal ? "#594637" : "rgba(255, 255, 255, 0.14)",
        shadowColor: "#594637",
        textColor: "#2B2118",
        borderWidth: 6,
        shadowOffsetX: 8,
        shadowOffsetY: 8,
        radius: 16,
        tiltDeg: 2.0,
        uppercase: isNeobrutal,
        holdAfterEnd: isNeobrutal ? 0.24 : 0.6,
        palette: ["#FFDE59", "#BAE6FD", "#FDA4AF", "#F5D0FE", "#FFFDF9"],
      },
      normalizedOpts
    );

    let activeIdx = -1;
    let exactMatch = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (localTime >= w.start && localTime <= w.end + 0.12) {
        activeIdx = i;
        exactMatch = true;
        break;
      }
      if (localTime >= w.start) {
        activeIdx = i;
      }
    }
    if (activeIdx < 0) return;

    const activeWord = words[activeIdx];
    const nextWord = words[activeIdx + 1];
    if (isNeobrutal) {
      if (!exactMatch) {
        const gapToNext = nextWord ? nextWord.start - activeWord.end : Infinity;
        const graceEnd = Math.min(activeWord.end + options.holdAfterEnd, nextWord ? nextWord.start : activeWord.end + options.holdAfterEnd);
        if (localTime > graceEnd && (!nextWord || gapToNext > options.holdAfterEnd)) {
          return;
        }
      }
    } else {
      const lastWord = words[words.length - 1];
      if (localTime > (lastWord.end || 0) + options.holdAfterEnd) return;
    }

    if (isNeobrutal && Number(options.wordsPerGroup) === 1) {
      const rawText = String(activeWord.word || "").trim();
      if (!rawText) return;
      const label = options.uppercase ? rawText.toUpperCase() : rawText;
      const palette = Array.isArray(options.palette) && options.palette.length > 0
        ? options.palette
        : ["#FFDE59", "#BAE6FD", "#FDA4AF", "#F5D0FE", "#FFFDF9"];
      const fillBg = palette[activeIdx % palette.length];
      const [popS, popK] = pop(Math.max(0, localTime), activeWord.start, 3.1, 0.44, 0.22, 0.36);
      const sx = Math.max(0.01, popS) / (1 + popK);
      const sy = Math.max(0.01, popS) * (1 + popK);
      const tiltRad = ((activeIdx % 2 === 0 ? -1 : 1) * Number(options.tiltDeg || 0) * Math.PI) / 180;

      ctx.save();
      ctx.font = `900 ${options.fontSize}px ${options.fontFamily}`;
      const textW = ctx.measureText(label).width;
      const padX = Math.max(40, Math.round(options.fontSize * 0.62));
      const padY = Math.max(22, Math.round(options.fontSize * 0.34));
      const boxW = Math.min(options.maxWidth, textW + padX * 2);
      const boxH = options.fontSize + padY * 2;
      const radius = Math.max(0, Number(options.radius ?? 16));
      const bw = Math.max(3, Number(options.borderWidth ?? 6));
      const shX = Number(options.shadowOffsetX ?? 8);
      const shY = Number(options.shadowOffsetY ?? 8);

      ctx.translate(options.x, options.y);
      ctx.rotate(tiltRad);
      ctx.scale(sx, sy);

      // Hard zero-blur neobrutalist offset shadow
      ctx.fillStyle = options.shadowColor || "#594637";
      roundRect(ctx, -boxW / 2 + shX, -boxH / 2 + shY, boxW, boxH, radius);
      ctx.fill();

      // Bold pastel sticker block fill + thick solid border
      ctx.fillStyle = fillBg;
      ctx.strokeStyle = options.borderColor || "#594637";
      ctx.lineWidth = bw;
      roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, radius);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = options.textColor || "#2B2118";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 2, options.maxWidth - padX);
      ctx.restore();
      return;
    }

    const groupIndex = Math.floor(activeIdx / options.wordsPerGroup);
    const startIdx = groupIndex * options.wordsPerGroup;
    const chunk = words.slice(startIdx, startIdx + options.wordsPerGroup);
    if (!chunk.length) return;

    ctx.save();
    ctx.font = `800 ${options.fontSize}px ${options.fontFamily}`;
    ctx.textBaseline = "middle";

    const spaceW = options.fontSize * 0.34;
    const metrics = chunk.map((w) => ({
      text: String(w.word || "").trim(),
      width: ctx.measureText(String(w.word || "").trim()).width,
      start: w.start,
      end: w.end,
    }));

    const lines = [];
    let currentLine = [];
    let currentW = 0;
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      const nextW = currentLine.length === 0 ? m.width : currentW + spaceW + m.width;
      if (nextW > options.maxWidth && currentLine.length > 0) {
        lines.push({ items: currentLine, width: currentW });
        currentLine = [{ ...m, globalIdx: startIdx + i }];
        currentW = m.width;
      } else {
        currentLine.push({ ...m, globalIdx: startIdx + i });
        currentW = nextW;
      }
    }
    if (currentLine.length > 0) {
      lines.push({ items: currentLine, width: currentW });
    }

    const lineH = options.fontSize * 1.32;
    const totalH = lines.length * lineH;
    const maxLineW = Math.max(...lines.map((l) => l.width), 160);
    const padX = 36;
    const padY = 24;
    const boxW = Math.min(options.maxWidth + padX * 2, maxLineW + padX * 2);
    const boxH = totalH + padY * 2;
    const boxX = options.x - boxW / 2;
    const boxY = options.y - boxH / 2;

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    roundRect(ctx, boxX + 6, boxY + 8, boxW, boxH, 22);
    ctx.fill();

    ctx.fillStyle = options.bgColor;
    roundRect(ctx, boxX, boxY, boxW, boxH, 22);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = options.borderColor;
    ctx.stroke();

    lines.forEach((line, lineIdx) => {
      let cursorX = options.x - line.width / 2;
      const lineY = boxY + padY + lineH * (lineIdx + 0.5);

      line.items.forEach((item) => {
        const isCurrent = item.globalIdx === activeIdx;
        const isPast = item.globalIdx < activeIdx;
        const wordElapsed = Math.max(0, localTime - item.start);
        const popScale = isCurrent ? 1 + 0.14 * Math.exp(-wordElapsed * 10) * Math.sin(wordElapsed * 24) : 1;

        ctx.save();
        const wordCenterX = cursorX + item.width / 2;
        ctx.translate(wordCenterX, lineY);
        ctx.scale(popScale, popScale);

        if (isCurrent) {
          ctx.fillStyle = "rgba(255, 222, 89, 0.18)";
          roundRect(ctx, -item.width / 2 - 10, -options.fontSize * 0.56, item.width + 20, options.fontSize * 1.12, 12);
          ctx.fill();
        }

        ctx.font = `800 ${options.fontSize}px ${options.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillText(item.text, 2, 3);

        ctx.fillStyle = isCurrent
          ? options.activeColor
          : isPast
          ? options.pastColor
          : options.upcomingColor;
        ctx.fillText(item.text, 0, 0);
        ctx.restore();

        cursorX += item.width + spaceW;
      });
    });

    ctx.restore();
  }

  // ============================================================================
  // 8. MotionClone-Grade Keyframe Track, Reveal & SVG Path Helpers
  // ============================================================================

  function _easeModeValue(p, mode) {
    const u = clamp(p, 0, 1);
    if (mode === "step") return 0;
    if (mode === "smooth") return u * u * (3 - 2 * u);
    if (mode === "out") return 1 - Math.pow(1 - u, 3);
    return u;
  }

  function evalKeyframes(frames, t, easingMode = "linear") {
    if (!Array.isArray(frames) || frames.length === 0) {
      return { t: 0, x: 0, y: 0, w: 0, h: 0, opacity: 1, rotation: 0, blur: 0, reveal: 1 };
    }
    const sorted = frames.length > 1
      ? frames.slice().sort((a, b) => (a.t || 0) - (b.t || 0))
      : frames;
    if (t <= (sorted[0].t || 0) || sorted.length === 1) {
      const f = sorted[0];
      return {
        t,
        x: f.x ?? 0,
        y: f.y ?? 0,
        w: f.w ?? 0,
        h: f.h ?? 0,
        opacity: f.opacity ?? 1,
        rotation: f.rotation ?? 0,
        blur: f.blur ?? 0,
        reveal: f.reveal ?? 1,
      };
    }
    const last = sorted[sorted.length - 1];
    if (t >= (last.t || 0)) {
      return {
        t,
        x: last.x ?? 0,
        y: last.y ?? 0,
        w: last.w ?? 0,
        h: last.h ?? 0,
        opacity: last.opacity ?? 1,
        rotation: last.rotation ?? 0,
        blur: last.blur ?? 0,
        reveal: last.reveal ?? 1,
      };
    }
    let a = sorted[0];
    let b = last;
    for (let i = 0; i < sorted.length - 1; i++) {
      if ((sorted[i].t || 0) <= t && t <= (sorted[i + 1].t || 0)) {
        a = sorted[i];
        b = sorted[i + 1];
        break;
      }
    }
    const span = Math.max(1e-6, (b.t || 0) - (a.t || 0));
    const k = _easeModeValue((t - (a.t || 0)) / span, easingMode);
    return {
      t,
      x: lerp(a.x ?? 0, b.x ?? a.x ?? 0, k),
      y: lerp(a.y ?? 0, b.y ?? a.y ?? 0, k),
      w: lerp(a.w ?? 0, b.w ?? a.w ?? 0, k),
      h: lerp(a.h ?? 0, b.h ?? a.h ?? 0, k),
      opacity: lerp(a.opacity ?? 1, b.opacity ?? a.opacity ?? 1, k),
      rotation: lerp(a.rotation ?? 0, b.rotation ?? a.rotation ?? 0, k),
      blur: lerp(a.blur ?? 0, b.blur ?? a.blur ?? 0, k),
      reveal: lerp(a.reveal ?? 1, b.reveal ?? a.reveal ?? 1, k),
    };
  }

  function textReveal(text, reveal = 1) {
    const str = String(text || "");
    const p = clamp(reveal, 0, 1);
    if (p <= 0) return "";
    if (p >= 1) return str;
    return str.slice(0, Math.max(1, Math.ceil(str.length * p)));
  }

  function clipWipe(ctx, x, y, w, h, reveal, drawFn) {
    const p = clamp(reveal, 0, 1);
    if (p <= 0 || typeof drawFn !== "function") return;
    ctx.save();
    if (p < 1) {
      ctx.beginPath();
      ctx.rect(x, y, w * p, h);
      ctx.clip();
    }
    drawFn();
    ctx.restore();
  }

  function drawSVGPath(ctx, pathStr, x, y, w, h, opts = {}) {
    if (!pathStr || typeof Path2D !== "function") return;
    const viewW = opts.viewBoxW || 100;
    const viewH = opts.viewBoxH || 100;
    const sx = w / Math.max(1e-3, viewW);
    const sy = h / Math.max(1e-3, viewH);
    const p2d = new Path2D(pathStr);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill(p2d);
    }
    if (opts.stroke) {
      const progress = clamp(opts.progress ?? 1, 0, 1);
      if (progress > 0) {
        ctx.strokeStyle = opts.stroke;
        ctx.lineWidth = (opts.lineWidth ?? 4) / Math.max(0.01, Math.min(sx, sy));
        ctx.lineCap = opts.lineCap || "round";
        ctx.lineJoin = opts.lineJoin || "round";
        if (progress < 1) {
          const approxLen = opts.approxLength || 420;
          ctx.setLineDash([approxLen * progress, approxLen]);
        }
        ctx.stroke(p2d);
      }
    }
    ctx.restore();
  }

  function drawCursor(ctx, x, y, opts = {}) {
    if (!ctx) return;
    const sc = opts.scale ?? 1;
    const ang = opts.angle ?? 0;
    const fill = opts.fill || "#FFFFFF";
    const stroke = opts.stroke || "#7D56EF";
    const glow = opts.glowColor || "rgba(125,86,239,0.55)";
    const lw = opts.lineWidth ?? 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(sc, sc);
    if (glow && glow !== "none") {
      ctx.shadowColor = glow;
      ctx.shadowBlur = opts.glowBlur ?? 10;
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(14, 24);
    ctx.quadraticCurveTo(6, 20, -1, 27);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (lw > 0) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    ctx.restore();
  }

  function _rot3D(p, rx, ry, rz) {
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const x1 = p[0] * cy + p[2] * sy;
    const z1 = -p[0] * sy + p[2] * cy;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const y2 = p[1] * cx - z1 * sx;
    const z2 = p[1] * sx + z1 * cx;
    const cz = Math.cos(rz), sz = Math.sin(rz);
    return [x1 * cz - y2 * sz, x1 * sz + y2 * cz, z2];
  }

  function _proj3D(p, cx, cy, sc, focal) {
    const depth = focal / Math.max(120, focal + p[2] * sc);
    return [cx + p[0] * sc * depth, cy + p[1] * sc * depth];
  }

  function drawExtrudedArrow3D(ctx, cx, cy, scale = 90, opts = {}) {
    if (!ctx) return;
    // Normalize multiplier-style scale (e.g. 1.0..8.0) into pixel radius (~90px default)
    // and pixel-style depth (e.g. 20..40) into unit-space extrusion (~0.24) so callers never draw a 1px speck.
    const sc = scale > 0 && scale <= 8 ? scale * 90 : (scale || 90);
    const rx = opts.rx ?? 0.2;
    const ry = opts.ry ?? -0.26;
    const rz = opts.rz ?? 0.06;
    const depthZ = opts.depth !== undefined
      ? (opts.depth > 2 ? opts.depth / Math.max(40, sc) : opts.depth)
      : 0.24;
    const focal = opts.focal ?? 680;
    const pts = [[1.15, 0.06], [-0.92, -0.82]];
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const qx = (1 - u) * (1 - u) * -0.92 + 2 * (1 - u) * u * -0.36 + u * u * -0.84;
      const qy = (1 - u) * (1 - u) * -0.82 + 2 * (1 - u) * u * 0.02 + u * u * 0.84;
      pts.push([qx, qy]);
    }
    const f2 = [];
    const b2 = [];
    for (let i = 0; i < pts.length; i++) {
      f2.push(_proj3D(_rot3D([pts[i][0], pts[i][1], -depthZ * 0.5], rx, ry, rz), cx, cy, sc, focal));
      b2.push(_proj3D(_rot3D([pts[i][0], pts[i][1], depthZ * 0.5], rx, ry, rz), cx, cy, sc, focal));
    }

    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha *= clamp(opts.alpha, 0, 1);
    const sideColor = opts.sideColor || "#7C4DFF";
    const strokeColor = opts.strokeColor || "#8C63FF";
    for (let j = 0; j < f2.length; j++) {
      const k = (j + 1) % f2.length;
      ctx.beginPath();
      ctx.moveTo(f2[j][0], f2[j][1]);
      ctx.lineTo(f2[k][0], f2[k][1]);
      ctx.lineTo(b2[k][0], b2[k][1]);
      ctx.lineTo(b2[j][0], b2[j][1]);
      ctx.closePath();
      ctx.fillStyle = sideColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    ctx.beginPath();
    for (let m = 0; m < f2.length; m++) {
      if (m === 0) ctx.moveTo(f2[m][0], f2[m][1]);
      else ctx.lineTo(f2[m][0], f2[m][1]);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(f2[1][0], f2[1][1], f2[0][0], f2[0][1]);
    grad.addColorStop(0, opts.topMid || "#E4DCFF");
    grad.addColorStop(1, opts.topLight || "#FFFFFF");
    ctx.shadowColor = opts.glowColor || "rgba(125,86,239,0.5)";
    ctx.shadowBlur = opts.glowBlur ?? 16;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function drawLaptopFrame(ctx, opts = {}, drawScreenFn) {
    if (!ctx) return;
    const x = opts.x ?? 244;
    const y = opts.y ?? 104;
    const w = opts.w ?? 536;
    const h = opts.h ?? 342;
    const bezel = opts.bezel ?? 10;
    const r = opts.radius ?? 14;

    ctx.save();
    ctx.fillStyle = opts.bezelColor || "#1D1D22";
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = opts.borderColor || "#3E3E46";
    ctx.lineWidth = opts.borderWidth ?? 2;
    ctx.stroke();

    const sx = x + bezel;
    const sy = y + bezel;
    const sw = Math.max(16, w - bezel * 2);
    const sh = Math.max(16, h - bezel * 2);

    ctx.save();
    roundRect(ctx, sx, sy, sw, sh, Math.max(4, r - 6));
    ctx.clip();
    ctx.fillStyle = opts.screenBg || "#060608";
    ctx.fillRect(sx, sy, sw, sh);
    if (typeof drawScreenFn === "function") {
      if (drawScreenFn.length >= 3) {
        // Supports legacy/shorthand callbacks expecting (ctx, w, h) translated to screen origin (0, 0).
        ctx.save();
        ctx.translate(sx, sy);
        drawScreenFn(ctx, sw, sh, { x: 0, y: 0, w: sw, h: sh, cx: sw * 0.5, cy: sh * 0.5 });
        ctx.restore();
      } else {
        drawScreenFn(ctx, { x: sx, y: sy, w: sw, h: sh, cx: sx + sw * 0.5, cy: sy + sh * 0.5 });
      }
    }
    ctx.restore();

    const baseW = opts.baseWidth ?? Math.round(w * 1.24);
    const baseH = opts.baseHeight ?? 14;
    const baseX = x + w * 0.5 - baseW * 0.5;
    const baseY = y + h + 2;
    const deckGrad = ctx.createLinearGradient(0, baseY, 0, baseY + baseH);
    deckGrad.addColorStop(0, "#383840");
    deckGrad.addColorStop(0.55, "#26262C");
    deckGrad.addColorStop(1, "#18181D");
    ctx.fillStyle = deckGrad;
    roundRect(ctx, baseX, baseY, baseW, baseH, 5);
    ctx.fill();

    const notchW = Math.min(baseW * 0.25, 88);
    ctx.fillStyle = "#19191E";
    roundRect(ctx, x + w * 0.5 - notchW * 0.5, baseY, notchW, 5, 2.5);
    ctx.fill();
    ctx.restore();
  }

  function drawWordWheel(ctx, opts = {}) {
    if (!ctx) return;
    const words = Array.isArray(opts.words) ? opts.words : [];
    if (!words.length) return;
    const idx = Math.max(0, Math.min(words.length - 1, Math.round(opts.centerIndex ?? 0)));
    const cx = opts.cx ?? 512;
    const cy = opts.cy ?? 288;
    const stepY = opts.stepY ?? 82;
    const slideY = opts.slideOffset ?? 0;

    ctx.save();
    ctx.textAlign = opts.align || "center";
    ctx.textBaseline = "middle";
    ctx.font = opts.dimFont || "400 84px Inter, sans-serif";
    ctx.fillStyle = opts.dimColor || "rgba(222,221,226,0.34)";
    if (idx > 0) ctx.fillText(String(words[idx - 1]), cx, cy - stepY + slideY);
    if (idx + 1 < words.length) ctx.fillText(String(words[idx + 1]), cx, cy + stepY + slideY);

    ctx.font = opts.activeFont || "400 104px Inter, sans-serif";
    ctx.fillStyle = opts.activeColor || "#FFFFFF";
    ctx.fillText(String(words[idx]), cx, cy + slideY);
    ctx.restore();
  }

  // ============================================================================
  // 10. Deterministic Local Image Asset Preloader (`/img/*`)
  // ============================================================================

  const IMAGE_CACHE = Object.create(null);
  const IMAGE_PROMISES = [];

  function normalizeImageUrl(url) {
    const raw = String(url || "").trim().replace(/\\/g, "/");
    if (!raw) return "";
    if (/^(https?:|data:|blob:|\/)/i.test(raw)) return raw;
    return "/" + raw.replace(/^\.?\//, "");
  }

  /**
   * Preloads a project image (e.g. downloaded via `fetch_web_image` to `/img/brain.png`)
   * and registers its load promise so `AM.whenImagesReady()` settles before `window.__ready = true`.
   */
  function loadImage(url) {
    const src = normalizeImageUrl(url);
    if (!src) return null;
    if (IMAGE_CACHE[src]) return IMAGE_CACHE[src];
    if (typeof Image === "undefined") return null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    const readyPromise = new Promise((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
    });
    img.src = src;
    IMAGE_CACHE[src] = img;
    IMAGE_PROMISES.push(readyPromise);
    return img;
  }

  function whenImagesReady() {
    if (!IMAGE_PROMISES.length) return Promise.resolve([]);
    return Promise.all(IMAGE_PROMISES);
  }

  /**
   * Draws a loaded HTMLImageElement cleanly inside `{x, y, w, h}` using `"contain"` or `"cover"`.
   */
  function drawImageFit(ctx, img, x, y, w, h, mode = "contain") {
    if (!img || !img.complete || !(img.naturalWidth > 0) || !(img.naturalHeight > 0)) {
      return false;
    }
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale =
      mode === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = x + (w - dw) * 0.5;
    const dy = y + (h - dh) * 0.5;
    ctx.save();
    if (mode === "cover") {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  // Unified cross-scene asset registry (`assets.json`) with metadata, alphaBbox & pivot support.
  const ASSET_BY_ID = Object.create(null);
  const ASSET_BY_KEY = Object.create(null);

  function _normalizeAssetKey(key) {
    return String(key || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  }

  function registerAsset(record) {
    if (!record || typeof record !== "object") return null;
    const rawUrl = String(record.url || (record.path ? "/" + String(record.path).replace(/^\/+/, "") : "")).trim();
    if (!rawUrl) return null;
    const cleanPath = String(record.path || rawUrl.replace(/^\/+/, "")).replace(/^\/+/, "");
    const id = String(record.id || cleanPath.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase());
    const pivot = Array.isArray(record.pivot) && record.pivot.length >= 2
      ? [clamp(Number(record.pivot[0]) || 0.5, 0, 1), clamp(Number(record.pivot[1]) || 0.5, 0, 1)]
      : [0.5, 0.5];
    const bbox = record.alphaBbox && Number(record.alphaBbox.w) > 0 && Number(record.alphaBbox.h) > 0
      ? {
          x: Math.max(0, Number(record.alphaBbox.x) || 0),
          y: Math.max(0, Number(record.alphaBbox.y) || 0),
          w: Number(record.alphaBbox.w),
          h: Number(record.alphaBbox.h),
        }
      : null;
    const kind = String(record.kind || (cleanPath.toLowerCase().endsWith(".svg") ? "svg" : record.hasAlpha ? "raster_cutout" : "raster"));
    const valid = record.valid !== false;
    const meta = {
      id,
      path: cleanPath,
      url: rawUrl.startsWith("/") || /^https?:\/\//i.test(rawUrl) || /^data:/i.test(rawUrl) ? rawUrl : "/" + rawUrl,
      kind,
      width: Number(record.width) || 0,
      height: Number(record.height) || 0,
      hasAlpha: Boolean(record.hasAlpha || kind === "svg" || kind === "raster_cutout"),
      alphaBbox: bbox,
      pivot,
      valid,
      warnings: Array.isArray(record.warnings) ? record.warnings.slice() : [],
    };

    const image = valid && kind !== "model3d" ? loadImage(meta.url) : null;
    const entry = { meta, image };
    ASSET_BY_ID[id.toLowerCase()] = entry;
    ASSET_BY_KEY[_normalizeAssetKey(cleanPath)] = entry;
    ASSET_BY_KEY[_normalizeAssetKey(meta.url)] = entry;
    return entry;
  }

  function loadAssetManifest(url = "/assets.json") {
    if (typeof fetch !== "function") {
      return Promise.resolve({ version: 1, assets: [] });
    }
    return fetch(url)
      .then((res) => (res && res.ok ? res.json() : { version: 1, assets: [] }))
      .then((data) => {
        const list = data && Array.isArray(data.assets) ? data.assets : [];
        for (let i = 0; i < list.length; i++) {
          registerAsset(list[i]);
        }
        return whenImagesReady().then(() => ({ version: Number(data && data.version) || 1, assets: list }));
      })
      .catch(() => ({ version: 1, assets: [] }));
  }

  function getAsset(idOrPath) {
    if (!idOrPath) return null;
    const key = _normalizeAssetKey(idOrPath);
    const entry = ASSET_BY_ID[key] || ASSET_BY_KEY[key] || null;
    if (!entry) return null;
    const img = entry.image;
    const ready = Boolean(entry.meta.valid && img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    return { meta: entry.meta, image: img, ready };
  }

  /**
   * Draws a registered asset (PNG cutout, raster photo, or SVG) using its validated metadata,
   * optional `alphaBbox` tight crop, and normalized `pivot` anchor.
   */
  function drawAsset(ctx, idOrPath, x, y, w, h, opts = {}) {
    if (!ctx || !(w > 0) || !(h > 0)) return false;
    const asset = getAsset(idOrPath);
    if (!asset || !asset.ready || !asset.image) return false;
    const img = asset.image;
    const meta = asset.meta;

    const useBbox = opts.useAlphaBbox !== false && meta.alphaBbox;
    const sx = useBbox ? meta.alphaBbox.x : 0;
    const sy = useBbox ? meta.alphaBbox.y : 0;
    const sw = useBbox ? Math.min(meta.alphaBbox.w, img.naturalWidth - sx) : img.naturalWidth;
    const sh = useBbox ? Math.min(meta.alphaBbox.h, img.naturalHeight - sy) : img.naturalHeight;
    if (!(sw > 0) || !(sh > 0)) return false;

    const mode = opts.mode || "contain";
    const fitScale = mode === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
    const dw = sw * fitScale;
    const dh = sh * fitScale;
    const pivot = Array.isArray(opts.pivot) && opts.pivot.length >= 2 ? opts.pivot : meta.pivot;
    const px = clamp(Number(pivot[0]) ?? 0.5, 0, 1);
    const py = clamp(Number(pivot[1]) ?? 0.5, 0, 1);
    const ax = x + w * px;
    const ay = y + h * py;
    const scaleX = (Number.isFinite(Number(opts.scaleX)) ? Number(opts.scaleX) : (Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1)) * (opts.flipX ? -1 : 1);
    const scaleY = (Number.isFinite(Number(opts.scaleY)) ? Number(opts.scaleY) : (Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1)) * (opts.flipY ? -1 : 1);
    const rot = Number(opts.rot) || 0;
    const alpha = opts.alpha !== undefined ? clamp(Number(opts.alpha), 0, 1) : 1;

    ctx.save();
    if (mode === "cover") {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.globalAlpha *= alpha;
    if (opts.shadow && typeof opts.shadow === "object") {
      ctx.shadowColor = opts.shadow.color || "rgba(0,0,0,0.35)";
      ctx.shadowBlur = Number(opts.shadow.blur) || 18;
      ctx.shadowOffsetX = Number(opts.shadow.offsetX) || 0;
      ctx.shadowOffsetY = Number(opts.shadow.offsetY) || 8;
    }
    ctx.translate(ax, ay);
    if (rot) ctx.rotate(rot);
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.drawImage(img, sx, sy, sw, sh, -dw * px, -dh * py, dw, dh);
    ctx.restore();
    return true;
  }

  /**
   * Applies modular WebGL2 post-processing passes (bloom, chromatic aberration, color grading,
   * filmic tonemap, vignette, deterministic grain) via `/script/aetheria-post.js` with safe 2D fallback.
   */
  function postProcess(ctx, t, opts = {}) {
    if (!ctx || !opts || typeof opts !== "object") return false;
    if (global.AetheriaPost && typeof global.AetheriaPost.apply === "function") {
      return Boolean(global.AetheriaPost.apply(ctx, t, opts));
    }
    return false;
  }

  /**
   * Creates a unified multi-renderer compositing stage (Canvas 2D, Assets, SVG/DOM, Three.js,
   * WebGL2 post-processing) with parent-child transforms & shared camera via `/script/aetheria-stage.js`.
   */
  function createStage(opts = {}) {
    if (global.AetheriaStage && typeof global.AetheriaStage.createStage === "function") {
      return global.AetheriaStage.createStage(opts);
    }
    return null;
  }

  /**
   * Evaluates an After Effects-style keyframe track (`[{ t, v, ease?, outEase?, inEase?, hold? }]`)
   * via `/script/aetheria-tracks.js` (`window.AetheriaTracks`).
   */
  function evalTrack(keys, t, opts = {}) {
    if (global.AetheriaTracks && typeof global.AetheriaTracks.evaluateTrack === "function") {
      return global.AetheriaTracks.evaluateTrack(keys, t, opts);
    }
    return null;
  }

  /**
   * Deterministic After Effects-style octave wiggle via `/script/aetheria-behaviors.js`.
   */
  function wiggle(t, freq, amp, opts = {}) {
    if (global.AetheriaBehaviors && typeof global.AetheriaBehaviors.wiggle === "function") {
      return global.AetheriaBehaviors.wiggle(t, freq, amp, opts);
    }
    return opts && opts.base !== undefined ? opts.base : 0;
  }

  /**
   * Evaluates a looping AE keyframe track (`cycle`, `pingpong`, `offset`, `continue`)
   * via `/script/aetheria-behaviors.js` + `/script/aetheria-tracks.js`.
   */
  function loopTrack(keys, t, opts = {}) {
    if (global.AetheriaBehaviors && typeof global.AetheriaBehaviors.loopTrack === "function") {
      return global.AetheriaBehaviors.loopTrack(keys, t, opts);
    }
    return evalTrack(keys, t, opts);
  }

  /** AE Text Animator Selector typography renderer via `/script/aetheria-shapes-text.js`. */
  function drawAnimatedText(ctx, text, x, y, t, opts = {}) {
    if (global.AetheriaShapesText && typeof global.AetheriaShapesText.drawAnimatedText === "function") {
      return global.AetheriaShapesText.drawAnimatedText(ctx, text, x, y, t, opts);
    }
    return { renderedChars: 0 };
  }

  function trimPaths(paths, opts = {}) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.trimPaths(paths, opts) : paths;
  }

  function roundCorners(paths, radius) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.roundCorners(paths, radius) : paths;
  }

  function puckerBloat(paths, amount) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.puckerBloat(paths, amount) : paths;
  }

  function wigglePaths(paths, params, t = 0) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.wigglePaths(paths, params, t) : paths;
  }

  function morphPath(pathA, pathB, u, opts = {}) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.morphPath(pathA, pathB, u, opts) : pathA;
  }

  function drawShapePath(ctx, paths, opts = {}) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.drawShapePath(ctx, paths, opts) : [];
  }

  function repeatDraw(ctx, opts, drawFn) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.repeatDraw(ctx, opts, drawFn) : 0;
  }

  function polystarPath(opts = {}) {
    return global.AetheriaShapesText ? global.AetheriaShapesText.polystarPath(opts) : null;
  }

  /**
   * Synchronizes one canonical camera pose across Canvas 2D, DOM/SVG elements, and Three.js cameras.
   */
  function syncCamera(camState, targets = {}) {
    if (global.AetheriaStage && typeof global.AetheriaStage.syncCamera === "function") {
      return global.AetheriaStage.syncCamera(camState, targets);
    }
    return null;
  }

  /**
   * Renders a physically inspired 3-layer additive optical glow/bloom orb
   * (wide atmospheric halo + saturated mid bloom + over-exposed white hot core).
   */
  function drawOpticalGlow(ctx, x, y, radius, colorHex = "#FF8800", intensity = 1.0) {
    if (!ctx || !(radius > 0) || !(intensity > 0)) return;
    const inten = clamp(intensity, 0, 2.5);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Layer 1: Wide atmospheric bloom
    const rOuter = radius * 2.35;
    const gOuter = ctx.createRadialGradient(x, y, 0, x, y, rOuter);
    gOuter.addColorStop(0, hexAlpha(colorHex, Math.min(1, 0.48 * inten)));
    gOuter.addColorStop(0.42, hexAlpha(colorHex, Math.min(1, 0.2 * inten)));
    gOuter.addColorStop(1, hexAlpha(colorHex, 0));
    ctx.fillStyle = gOuter;
    ctx.beginPath();
    ctx.arc(x, y, rOuter, 0, TAU);
    ctx.fill();

    // Layer 2: Saturated mid halo
    const rMid = radius * 1.15;
    const gMid = ctx.createRadialGradient(x, y, 0, x, y, rMid);
    gMid.addColorStop(0, hexAlpha("#FFF4DC", Math.min(1, 0.82 * inten)));
    gMid.addColorStop(0.38, hexAlpha(colorHex, Math.min(1, 0.65 * inten)));
    gMid.addColorStop(1, hexAlpha(colorHex, 0));
    ctx.fillStyle = gMid;
    ctx.beginPath();
    ctx.arc(x, y, rMid, 0, TAU);
    ctx.fill();

    // Layer 3: Over-exposed white hot core
    const rCore = Math.max(2, radius * 0.42);
    const gCore = ctx.createRadialGradient(x, y, 0, x, y, rCore);
    gCore.addColorStop(0, hexAlpha("#FFFFFF", Math.min(1, 0.96 * inten)));
    gCore.addColorStop(0.55, hexAlpha("#FFFDF5", Math.min(1, 0.55 * inten)));
    gCore.addColorStop(1, hexAlpha("#FFFFFF", 0));
    ctx.fillStyle = gCore;
    ctx.beginPath();
    ctx.arc(x, y, rCore, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Strokes any path drawn by `drawPathFn(ctx)` with a smooth blurred additive optical bloom
   * (never hard stepped stripes: uses Gaussian `ctx.filter = 'blur(...)'` + additive `lighter`).
   */
  function drawBloomStroke(ctx, drawPathFn, opts = {}) {
    if (!ctx || typeof drawPathFn !== "function") return;
    const color = opts.color || "#FF9922";
    const coreColor = opts.coreColor || "#FFFDF5";
    const lineWidth = Number(opts.lineWidth ?? 4);
    const glowRadius = Number(opts.glowRadius ?? Math.max(18, lineWidth * 6));
    const intensity = clamp(Number(opts.intensity ?? 1.0), 0, 2.5);
    const lineCap = opts.lineCap || "round";
    const lineJoin = opts.lineJoin || "round";

    ctx.save();
    ctx.lineCap = lineCap;
    ctx.lineJoin = lineJoin;
    ctx.globalCompositeOperation = "lighter";

    // Pass 1: Wide soft Gaussian atmospheric bloom (no hard edges)
    ctx.save();
    ctx.filter = `blur(${Math.max(4, Math.round(glowRadius * 0.75))}px)`;
    ctx.strokeStyle = hexAlpha(color, Math.min(1, 0.55 * intensity));
    ctx.lineWidth = lineWidth * 2.4;
    ctx.beginPath();
    drawPathFn(ctx);
    ctx.stroke();
    ctx.restore();

    // Pass 2: Medium soft Gaussian halo
    ctx.save();
    ctx.filter = `blur(${Math.max(2, Math.round(glowRadius * 0.25))}px)`;
    ctx.strokeStyle = hexAlpha(color, Math.min(1, 0.85 * intensity));
    ctx.lineWidth = lineWidth * 1.25;
    ctx.beginPath();
    drawPathFn(ctx);
    ctx.stroke();
    ctx.restore();

    // Pass 3: Crisp bright core
    ctx.strokeStyle = hexAlpha(coreColor, Math.min(1, 0.96 * intensity));
    ctx.lineWidth = Math.max(1, lineWidth * 0.75);
    ctx.beginPath();
    drawPathFn(ctx);
    ctx.stroke();

    ctx.restore();
  }

  let _lensSrcCanvas = null;
  let _lensDstCanvas = null;

  /**
   * Renders content drawn by `drawContentFn` through a deterministic
   * spherical / water-bubble refractive glass lens (`strength` 0 = flat, 0.3..1.4 = convex bubble).
   * Supports both 1-arg main-canvas coordinates `drawContentFn(c)` centered around `(cx, cy)` and
   * 2-arg local `0..size` coordinates `drawContentFn(lc, size)` centered at `(size/2, size/2)`,
   * plus optional `opts.coordSpace` (`"canvas" | "local"`), chromatic dispersion, and rim highlight.
   */
  function drawSphericalLens(ctx, cx, cy, radius, strength, drawContentFn, opts = {}) {
    if (!ctx || !(radius > 2) || typeof drawContentFn !== "function") return;
    const size = Math.min(640, Math.max(32, Math.ceil(radius * 2)));
    const k = clamp(Number(strength ?? 0.8), 0, 2.0);
    const chromatic = clamp(Number(opts.chromatic ?? 0.04), 0, 0.25);
    const rimAlpha = clamp(Number(opts.rimAlpha ?? 0.45), 0, 1);
    const rimColor = opts.rimColor || "#FFD9A0";
    const useLocal =
      opts.coordSpace === "local" ||
      (opts.coordSpace !== "canvas" && drawContentFn.length >= 2);
    const srcScale = size / (radius * 2);

    if (typeof document === "undefined") {
      ctx.save();
      if (useLocal) {
        ctx.translate(cx - size * 0.5, cy - size * 0.5);
      }
      drawContentFn(ctx, size, { cx, cy, radius, size });
      ctx.restore();
      return;
    }

    if (!_lensSrcCanvas) _lensSrcCanvas = document.createElement("canvas");
    if (!_lensDstCanvas) _lensDstCanvas = document.createElement("canvas");
    if (_lensSrcCanvas.width !== size || _lensSrcCanvas.height !== size) {
      _lensSrcCanvas.width = size;
      _lensSrcCanvas.height = size;
      _lensDstCanvas.width = size;
      _lensDstCanvas.height = size;
    }
    const sCtx = _lensSrcCanvas.getContext("2d", { willReadFrequently: true });
    const dCtx = _lensDstCanvas.getContext("2d", { willReadFrequently: true });

    function renderOffscreen(localMode) {
      sCtx.clearRect(0, 0, size, size);
      sCtx.save();
      if (!localMode) {
        sCtx.translate(size * 0.5, size * 0.5);
        if (Math.abs(srcScale - 1) > 1e-4) sCtx.scale(srcScale, srcScale);
        sCtx.translate(-cx, -cy);
      }
      drawContentFn(sCtx, size, { cx, cy, radius, size });
      sCtx.restore();
    }

    function bufferHasAlpha(data) {
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
      }
      return false;
    }

    renderOffscreen(useLocal);
    let src = sCtx.getImageData(0, 0, size, size).data;
    let hasPixels = bufferHasAlpha(src);
    if (
      !hasPixels &&
      opts.coordSpace == null &&
      (Math.abs(cx - size * 0.5) > 2 || Math.abs(cy - size * 0.5) > 2)
    ) {
      renderOffscreen(!useLocal);
      src = sCtx.getImageData(0, 0, size, size).data;
      hasPixels = bufferHasAlpha(src);
    }
    if (!hasPixels && typeof window !== "undefined") {
      const msg =
        "drawSphericalLens: drawContentFn painted nothing inside the lens disc (cx=" +
        Math.round(cx) +
        ", cy=" +
        Math.round(cy) +
        ", r=" +
        Math.round(radius) +
        ")";
      if (
        Array.isArray(window.__aetheriaErrors) &&
        window.__aetheriaErrors.length < 16 &&
        window.__aetheriaErrors.indexOf(msg) === -1
      ) {
        window.__aetheriaErrors.push(msg);
      }
    }

    if (k <= 0.005) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.clip();
      ctx.drawImage(_lensSrcCanvas, cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.restore();
      return;
    }

    const dstImg = dCtx.createImageData(size, size);
    const dst = dstImg.data;
    const half = size * 0.5;
    const invHalf = 1 / half;

    for (let y = 0; y < size; y++) {
      const ny = (y - half) * invHalf;
      const ny2 = ny * ny;
      for (let x = 0; x < size; x++) {
        const nx = (x - half) * invHalf;
        const r2 = nx * nx + ny2;
        if (r2 > 1.0) continue;
        // Spherical water-bubble refraction: edge pixels bend strongly outward/inward
        const lensFactor = Math.pow(r2, 0.5 * k) * (1 - 0.35 * k * (1 - r2));
        const scaleBase = r2 > 1e-6 ? lensFactor / Math.sqrt(r2) : 1 - 0.35 * k;
        const outIdx = (y * size + x) * 4;

        const channels = [
          { ch: 0, s: scaleBase * (1 + chromatic * r2) },
          { ch: 1, s: scaleBase },
          { ch: 2, s: scaleBase * (1 - chromatic * r2) },
        ];
        let maxA = 0;
        for (let c = 0; c < 3; c++) {
          const sx = Math.round(half + nx * half * channels[c].s);
          const sy = Math.round(half + ny * half * channels[c].s);
          if (sx >= 0 && sx < size && sy >= 0 && sy < size) {
            const si = (sy * size + sx) * 4;
            dst[outIdx + channels[c].ch] = src[si + channels[c].ch];
            if (src[si + 3] > maxA) maxA = src[si + 3];
          }
        }
        dst[outIdx + 3] = maxA;
      }
    }

    dCtx.putImageData(dstImg, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.clip();
    ctx.drawImage(_lensDstCanvas, cx - radius, cy - radius, radius * 2, radius * 2);

    if (rimAlpha > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const rimGrad = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, radius);
      rimGrad.addColorStop(0, hexAlpha(rimColor, 0));
      rimGrad.addColorStop(0.84, hexAlpha(rimColor, rimAlpha * 0.45 * Math.min(1, k)));
      rimGrad.addColorStop(0.96, hexAlpha("#FFFFFF", rimAlpha * 0.85 * Math.min(1, k)));
      rimGrad.addColorStop(1, hexAlpha(rimColor, 0));
      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Draws a variable-width tapered crescent / calligraphic light ribbon along `points` (`[{x, y}]` or `[[x, y]]`),
   * tapering smoothly to 0px at both tail and head with a soft Gaussian outer aura (never a stiff uniform wire).
   */
  function drawTaperedRibbon(ctx, points, maxWidth = 24, opts = {}) {
    if (!ctx || !Array.isArray(points) || points.length < 3 || !(maxWidth > 0)) return;
    const pts = points.map((p) =>
      Array.isArray(p)
        ? { x: Number(p[0]) || 0, y: Number(p[1]) || 0 }
        : { x: Number(p.x) || 0, y: Number(p.y) || 0 }
    );
    const n = pts.length;
    const color = opts.color || "#FF9624";
    const coreColor = opts.coreColor || "#FFF9E6";
    const alpha = clamp(Number(opts.alpha ?? 1.0), 0, 1);
    const asymmetry = clamp(Number(opts.asymmetry ?? 0.78), 0.5, 0.95);
    const glowBlur = Math.max(2, Number(opts.glowBlur ?? Math.round(maxWidth * 0.55)));
    if (alpha <= 0.005) return;

    const leftPts = [];
    const rightPts = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const w = Math.sin(Math.pow(u, 0.74) * Math.PI) * maxWidth;
      const pPrev = pts[Math.max(0, i - 1)];
      const pNext = pts[Math.min(n - 1, i + 1)];
      const tx = pNext.x - pPrev.x;
      const ty = pNext.y - pPrev.y;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      leftPts.push({ x: pts[i].x + nx * w * asymmetry, y: pts[i].y + ny * w * asymmetry });
      rightPts.push({
        x: pts[i].x - nx * w * (1 - asymmetry),
        y: pts[i].y - ny * w * (1 - asymmetry),
      });
    }

    const traceHull = () => {
      ctx.beginPath();
      ctx.moveTo(leftPts[0].x, leftPts[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(rightPts[i].x, rightPts[i].y);
      ctx.closePath();
    };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    ctx.save();
    ctx.filter = `blur(${glowBlur}px)`;
    ctx.fillStyle = hexAlpha(color, 0.72 * alpha);
    traceHull();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.filter = "blur(2px)";
    ctx.fillStyle = hexAlpha(color, 0.88 * alpha);
    traceHull();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = hexAlpha(coreColor, 0.92 * alpha);
    ctx.lineWidth = Math.max(1.5, maxWidth * 0.1);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Computes a deterministic damped spring collision jolt `{ dx, dy, rot, sx, sy }`
   * when an impulse/dot impacts an element at `hitTime`.
   */
  function impactRecoil(t, hitTime, opts = {}) {
    const dt = Number(t) - Number(hitTime);
    const dur = Number(opts.duration ?? 1.05);
    if (!(dt > 0) || dt > dur) {
      return { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
    }
    const ampX = Number(opts.ampX ?? 0);
    const ampY = Number(opts.ampY ?? -22);
    const ampRot = Number(opts.ampRot ?? -0.085);
    const squash = Number(opts.squash ?? 0.06);
    const damping = Number(opts.damping ?? 6.5);
    const freq = Number(opts.freq ?? 26.0);
    const decay = Math.exp(-damping * dt);
    const osc = Math.sin(dt * freq);
    return {
      dx: ampX * decay * osc,
      dy: ampY * decay * osc,
      rot: ampRot * decay * Math.sin(dt * (freq * 0.82)),
      sx: 1 + squash * decay * osc,
      sy: 1 - squash * decay * osc,
    };
  }

  /**
   * Applies deterministic elastic vertex-lag rotation / 3D shear to an array of 2D vertices
   * (`[{x, y}]` or `[[x, y]]`), so trailing vertices lag behind leading vertices ("meleyot" / follow-through).
   */
  function twistPolygon(points, angle, lagFactor = 0.35) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const pts = points.map((p) =>
      Array.isArray(p)
        ? { x: Number(p[0]) || 0, y: Number(p[1]) || 0 }
        : { x: Number(p.x) || 0, y: Number(p.y) || 0 }
    );
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].y > maxY) maxY = pts[i].y;
    }
    const spanY = Math.max(1e-4, maxY - minY);
    const baseAngle = Number(angle) || 0;
    const lag = Number(lagFactor) || 0;
    return pts.map((p) => {
      const v = (p.y - minY) / spanY;
      const localA = baseAngle - v * lag;
      const c = Math.cos(localA);
      return {
        x: p.x * c + Math.sin(localA) * (p.y * 0.18 * lag),
        y: p.y + Math.sin(localA) * (p.x * 0.08 * lag),
      };
    });
  }

  /**
   * MotionCraft-inspired progressive left-to-right character blur-rise reveal with 3D Z-depth zoom
   * (far + small + heavily blurred -> close + full-size + solid sharp).
   * Locks exact full-string kerning width via `ctx.measureText(text.slice(0, i)).width` so characters
   * never reflow while zooming in from `scaleFrom` (`0.28 -> 1.0`) and unblurring left-to-right.
   */
  function drawBlurRevealText(ctx, text, x, y, t, tStart = 0, dur = 0.45, opts = {}) {
    if (!ctx || typeof text !== "string" || text.length === 0) return;
    const elapsed = Number(t) - Number(tStart);
    const preBlurSec = Number(opts.preBlurSec) || 0;
    if (elapsed < -preBlurSec) return;

    const totalDur = Math.max(0.08, Number(dur) || 0.45);
    const maxBlur = Number.isFinite(Number(opts.maxBlur)) ? Number(opts.maxBlur) : 18;
    const risePx = Number.isFinite(Number(opts.risePx)) ? Number(opts.risePx) : 14;
    const scaleFrom =
      opts.depthZoom === false
        ? 1.0
        : Number.isFinite(Number(opts.scaleFrom))
        ? clamp(Number(opts.scaleFrom), 0.12, 1.5)
        : 0.92;
    const baseColor = opts.color || ctx.fillStyle || "#111116";
    const inkStart = opts.inkStart || null;
    const baseAlpha = Number.isFinite(Number(opts.alpha)) ? Number(opts.alpha) : 1;

    ctx.save();
    if (opts.font) ctx.font = opts.font;
    if (opts.textBaseline) ctx.textBaseline = opts.textBaseline;
    const align = opts.textAlign || ctx.textAlign || "left";
    ctx.textAlign = "left";

    const fullW = ctx.measureText ? ctx.measureText(text).width : text.length * 24;
    let startX = Number(x) || 0;
    if (align === "center") startX -= fullW * 0.5;
    else if (align === "right" || align === "end") startX -= fullW;
    const baseY = Number(y) || 0;
    const pivotX = startX + fullW * (Number.isFinite(Number(opts.zoomPivotX)) ? Number(opts.zoomPivotX) : 0.16);
    const pivotY = baseY - 22;

    // Pre-reveal far-away soft blurred ghost preview (e.g. "shows" pre-blurring beneath "research")
    if (elapsed < 0) {
      const preU = clamp((elapsed + preBlurSec) / Math.max(0.02, preBlurSec), 0, 1);
      const preScale = lerp(scaleFrom * 0.78, scaleFrom, ease.outQuad(preU));
      ctx.globalAlpha = baseAlpha * preU * 0.35;
      ctx.filter = `blur(${(maxBlur * 0.95).toFixed(1)}px)`;
      ctx.fillStyle = inkStart && typeof baseColor === "string" && baseColor[0] === "#"
        ? mixHex(inkStart, baseColor, 0.3)
        : baseColor;
      ctx.translate(pivotX, pivotY);
      ctx.scale(preScale, preScale);
      ctx.translate(-pivotX, -pivotY);
      ctx.fillText(text, startX, baseY + risePx * 0.5);
      ctx.restore();
      return;
    }

    const exitAt = Number.isFinite(Number(opts.exitAt)) ? Number(opts.exitAt) : null;
    const exitDur = Math.max(0.06, Number(opts.exitDur) || 0.28);
    if (exitAt !== null && Number(t) >= exitAt + exitDur) {
      ctx.restore();
      return;
    }
    const isExiting = exitAt !== null && Number(t) >= exitAt;

    // Fast path only after the last character's damped spring has fully settled (prevents 1-frame snap)
    if (!isExiting && elapsed >= totalDur + 0.52) {
      ctx.globalAlpha = baseAlpha;
      ctx.filter = "none";
      ctx.fillStyle = baseColor;
      ctx.fillText(text, startX, baseY);
      ctx.restore();
      return;
    }

    // 3D Z-depth camera approach: zooms smoothly from far/small (scaleFrom) to close/solid (1.0),
    // and smoothly blurs/drifts out when `exitAt` is reached.
    const wordU = clamp(elapsed / totalDur, 0, 1);
    const exitWordU = isExiting ? clamp((Number(t) - exitAt) / exitDur, 0, 1) : 0;
    const wordScale = lerp(scaleFrom, 1.0, ease.outCubic(wordU)) * lerp(1.0, 0.90, ease.inQuad(exitWordU));
    if (Math.abs(wordScale - 1.0) > 0.002) {
      ctx.translate(pivotX, pivotY);
      ctx.scale(wordScale, wordScale);
      ctx.translate(-pivotX, -pivotY);
    }

    const chars = Array.from(text);
    const n = chars.length;
    const staggerSpan = totalDur * 0.58;
    const charDur = Math.max(0.06, totalDur * 0.48);
    const stepDelay = n > 1 ? staggerSpan / (n - 1) : 0;
    const exitStaggerSpan = exitDur * 0.45;
    const exitCharDur = Math.max(0.05, exitDur * 0.60);
    const exitStepDelay = n > 1 ? exitStaggerSpan / (n - 1) : 0;

    let prefix = "";
    for (let i = 0; i < n; i++) {
      const ch = chars[i];
      const offsetX = prefix.length > 0 && ctx.measureText ? ctx.measureText(prefix).width : i * 22;
      prefix += ch;
      if (ch === " ") continue;

      const cElapsed = elapsed - i * stepDelay;
      // Right-hand characters already appear dimly in deep blur while left-hand characters solidify
      const u = clamp((cElapsed + charDur * 0.32) / (charDur * 1.32), 0, 1);
      if (u <= 0.01) continue;
      const eOut = ease.outCubic(u);
      const sp = spring(Math.max(0, cElapsed), { stiffness: 150, damping: 12, mass: 0.7 });
      let blurPx = Math.pow(1 - eOut, 1.15) * maxBlur;
      let dy = (1 - clamp(sp, 0, 1.12)) * risePx;
      let cAlpha = clamp(0.14 + Math.pow(u, 1.25) * 0.96, 0.12, 1) * baseAlpha;
      let charScale = lerp(0.84, 1.0, eOut);

      if (isExiting) {
        const cExitU = clamp((Number(t) - exitAt - i * exitStepDelay) / exitCharDur, 0, 1);
        if (cExitU >= 0.995) continue;
        const eEx = ease.inQuad(cExitU);
        blurPx = Math.max(blurPx, eEx * maxBlur);
        dy -= eEx * risePx * 0.75;
        cAlpha *= 1 - eEx;
        charScale *= lerp(1.0, 0.88, eEx);
      }

      ctx.save();
      ctx.globalAlpha = cAlpha;
      ctx.filter = blurPx > 0.45 ? `blur(${blurPx.toFixed(1)}px)` : "none";
      if (inkStart && typeof baseColor === "string" && baseColor[0] === "#") {
        ctx.fillStyle = mixHex(inkStart, baseColor, eOut);
      } else {
        ctx.fillStyle = baseColor;
      }
      const chW = ctx.measureText ? ctx.measureText(ch).width : 20;
      const gx = startX + offsetX;
      const gy = baseY + dy;
      const gcx = gx + chW * 0.5;
      const gcy = gy - 16;
      ctx.translate(gcx, gcy);
      ctx.scale(charScale, charScale);
      ctx.fillText(ch, -chW * 0.5, 16);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * MotionCraft `<Word>` staggered word-by-word spring rise + optical blur + ink-tint transition,
   * with faster exit than entrance (`exitDur = 0.28s` vs `enterDur = 0.38s`).
   */
  function drawBlurRiseWords(ctx, wordsOrText, x, y, t, tStart = 0, opts = {}) {
    if (!ctx || !wordsOrText) return;
    const words = Array.isArray(wordsOrText)
      ? wordsOrText.map(String)
      : String(wordsOrText).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const stepDelay = Number.isFinite(Number(opts.stagger)) ? Number(opts.stagger) : 0.12;
    const enterDur = Number.isFinite(Number(opts.enterDur)) ? Number(opts.enterDur) : 0.38;
    const maxBlur = Number.isFinite(Number(opts.maxBlur)) ? Number(opts.maxBlur) : 10;
    const risePx = Number.isFinite(Number(opts.risePx)) ? Number(opts.risePx) : 18;
    const exitAt = Number.isFinite(Number(opts.exitAt)) ? Number(opts.exitAt) : null;
    const exitDur = Number.isFinite(Number(opts.exitDur)) ? Number(opts.exitDur) : 0.28;
    const baseColor = opts.color || ctx.fillStyle || "#16181D";
    const inkStart = opts.inkStart || null;

    ctx.save();
    if (opts.font) ctx.font = opts.font;
    if (opts.textBaseline) ctx.textBaseline = opts.textBaseline;
    const align = opts.textAlign || ctx.textAlign || "left";
    ctx.textAlign = "left";

    const spaceW = ctx.measureText ? ctx.measureText(" ").width : 12;
    const widths = words.map((w) => (ctx.measureText ? ctx.measureText(w).width : w.length * 20));
    const totalW = widths.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * spaceW;
    let cursorX = Number(x) || 0;
    if (align === "center") cursorX -= totalW * 0.5;
    else if (align === "right" || align === "end") cursorX -= totalW;

    for (let i = 0; i < words.length; i++) {
      const wStart = Number(tStart) + i * stepDelay;
      const wW = widths[i];
      let exitMul = 1;
      let exitDy = 0;
      let exitBlur = 0;
      if (exitAt !== null && Number(t) > exitAt + i * (stepDelay * 0.5)) {
        const eu = clamp((Number(t) - (exitAt + i * (stepDelay * 0.5))) / Math.max(0.05, exitDur), 0, 1);
        const eIn = ease.inCubic(eu);
        exitMul = 1 - eIn;
        exitDy = -eIn * (risePx * 0.75);
        exitBlur = eIn * (maxBlur * 0.8);
      }
      if (exitMul > 0.01) {
        drawBlurRevealText(ctx, words[i], cursorX, Number(y) + exitDy, t, wStart, enterDur, {
          maxBlur: maxBlur + exitBlur,
          risePx,
          color: baseColor,
          inkStart,
          alpha: exitMul,
          preBlurSec: opts.preBlurSec || 0,
        });
      }
      cursorX += wW + spaceW;
    }
    ctx.restore();
  }

  /**
   * MotionCraft `<Headline>` balanced multi-line breaker using `ctx.measureText` with zero orphan words.
   */
  function layoutBalancedHeadline(ctx, text, maxWidth = 800) {
    const clean = String(text || "").trim();
    if (!clean) return [];
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [clean];
    const measure = (s) => (ctx && typeof ctx.measureText === "function" ? ctx.measureText(s).width : s.length * 22);
    if (measure(clean) <= maxWidth) return [clean];

    // Find optimal 2-line balanced split avoiding 1-word orphan on line 2 when words.length >= 4
    if (words.length >= 2) {
      let bestIdx = 1;
      let bestScore = Infinity;
      const minSecondLineWords = words.length >= 4 ? 2 : 1;
      for (let split = 1; split <= words.length - minSecondLineWords; split++) {
        const l1 = words.slice(0, split).join(" ");
        const l2 = words.slice(split).join(" ");
        const w1 = measure(l1);
        const w2 = measure(l2);
        const overPenalty = (Math.max(0, w1 - maxWidth) + Math.max(0, w2 - maxWidth)) * 4;
        const diff = Math.abs(w1 - w2) + overPenalty;
        if (diff < bestScore) {
          bestScore = diff;
          bestIdx = split;
        }
      }
      const bestL1 = words.slice(0, bestIdx).join(" ");
      const bestL2 = words.slice(bestIdx).join(" ");
      if (measure(bestL1) <= maxWidth * 1.15 && measure(bestL2) <= maxWidth * 1.15) {
        return [bestL1, bestL2];
      }
    }

    // Greedy wrap fallback with orphan prevention on last line
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const cand = `${cur} ${words[i]}`;
      if (measure(cand) <= maxWidth) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    if (cur) lines.push(cur);
    if (lines.length >= 2 && !lines[lines.length - 1].includes(" ")) {
      const prevWords = lines[lines.length - 2].split(" ");
      if (prevWords.length >= 3) {
        const moved = prevWords.pop();
        lines[lines.length - 2] = prevWords.join(" ");
        lines[lines.length - 1] = `${moved} ${lines[lines.length - 1]}`;
      }
    }
    return lines;
  }

  let _ttSrcBuf = null;
  let _ttDstBuf = null;

  function _ensureTurntableBuffers(bw, bh) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    if (!_ttSrcBuf || _ttSrcBuf.width !== bw || _ttSrcBuf.height !== bh) {
      _ttSrcBuf = document.createElement("canvas");
      _ttSrcBuf.width = bw;
      _ttSrcBuf.height = bh;
      _ttDstBuf = document.createElement("canvas");
      _ttDstBuf.width = bw;
      _ttDstBuf.height = bh;
    }
    return { src: _ttSrcBuf, dst: _ttDstBuf };
  }

  /**
   * True 3D Ellipsoid Y-Axis Turntable Surface Shader + spinning orbital dashed ring helper
   * for 3D hero objects/images (e.g. rotating brain, globe, coin, icon).
   * Rolls internal surface details/gyri across the curved 3D hemisphere with spherical cosine
   * foreshortening at the edges and a dynamic 3D directional lighting sweep.
   */
  function drawTurntableObject(ctx, cx, cy, t, drawFnOrImg, opts = {}) {
    if (!ctx) return;
    const sec = Number(t) || 0;
    const rawOmega = Number.isFinite(Number(opts.omega)) ? Number(opts.omega) : 2.1;
    // Clamp ultra-slow positive omegas (< 1.25 rad/s) up to 1.45 so 3D rotation is visibly readable over short 2-4s scenes
    const omega = rawOmega === 0 ? 0 : (Math.abs(rawOmega) < 1.25 ? Math.sign(rawOmega) * 1.45 : rawOmega);
    const depth = clamp(Number.isFinite(Number(opts.depth)) ? Number(opts.depth) : 0.26, 0, 0.48);
    const tiltRad = Number.isFinite(Number(opts.tiltRad)) ? Number(opts.tiltRad) : 0.055;
    const floatPx = Number.isFinite(Number(opts.floatPx)) ? Number(opts.floatPx) : 4.5;
    const w = Math.max(32, Math.round(Number(opts.w) || 260));
    const h = Math.max(32, Math.round(Number(opts.h) || 220));

    // 1. Optional continuous spinning dashed orbital ring
    const ringR = Number(opts.ringRadius) || 0;
    if (ringR > 4) {
      const ringOmega = Number.isFinite(Number(opts.ringOmega)) ? Number(opts.ringOmega) : 0.65;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sec * ringOmega);
      ctx.strokeStyle = opts.ringColor || "rgba(80, 80, 88, 0.58)";
      ctx.lineWidth = Number(opts.ringLineWidth) || 1.8;
      if (typeof ctx.setLineDash === "function") {
        ctx.setLineDash(Array.isArray(opts.ringDash) ? opts.ringDash : [6, 8]);
      }
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, TAU);
      ctx.stroke();
      if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
      ctx.restore();
    }

    // Bypass spherical 3D pixel-warp when omega === 0 or depth <= 0.005 so flat 2D shapes
    // (targets, badges, icons) are never spherically distorted or cross-blended.
    if (omega === 0 || depth <= 0.005) {
      ctx.save();
      ctx.translate(cx, cy);
      if (typeof drawFnOrImg === "function") {
        drawFnOrImg(ctx, w, h, 0);
      } else if (drawFnOrImg) {
        drawImageFit(ctx, drawFnOrImg, -w * 0.5, -h * 0.5, w, h, opts.fitMode || "contain");
      }
      ctx.restore();
      return;
    }

    const phase = sec * omega;
    const rock = Math.sin(phase * 0.75) * tiltRad;
    const dy = Math.sin(sec * 2.5) * floatPx;
    const dx = Math.sin(phase) * (w * 0.03);

    // 2. Try 3D Ellipsoid Spherical Surface Turntable Warp via offscreen pixel buffer
    const pad = 28;
    const bw = w + pad * 2;
    const bh = h + pad * 2;
    const bufs = _ensureTurntableBuffers(bw, bh);
    const sCtx = bufs && bufs.src && typeof bufs.src.getContext === "function" ? bufs.src.getContext("2d") : null;
    const dCtx = bufs && bufs.dst && typeof bufs.dst.getContext === "function" ? bufs.dst.getContext("2d") : null;

    if (sCtx && dCtx && typeof sCtx.getImageData === "function" && typeof ctx.drawImage === "function") {
      sCtx.setTransform(1, 0, 0, 1, 0, 0);
      sCtx.clearRect(0, 0, bw, bh);
      sCtx.save();
      sCtx.translate(bw * 0.5, bh * 0.5);
      if (typeof drawFnOrImg === "function") {
        drawFnOrImg(sCtx, w, h, phase);
      } else if (drawFnOrImg) {
        drawImageFit(sCtx, drawFnOrImg, -w * 0.5, -h * 0.5, w, h, opts.fitMode || "contain");
      }
      sCtx.restore();

      try {
        const srcImg = sCtx.getImageData(0, 0, bw, bh);
        const sData = srcImg.data;
        // Find tight solid bounding box (alpha > 64 ignores soft outer drop-shadows so ellipsoid stays centered)
        let minX = bw, minY = bh, maxX = -1, maxY = -1;
        for (let y = 0; y < bh; y += 2) {
          const rowOff = y * bw * 4;
          for (let x = 0; x < bw; x += 2) {
            if (sData[rowOff + x * 4 + 3] > 64) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX > minX + 6 && maxY > minY + 6) {
          minX = Math.max(0, minX - 4);
          minY = Math.max(0, minY - 4);
          maxX = Math.min(bw - 1, maxX + 4);
          maxY = Math.min(bh - 1, maxY + 4);
          const objCx = (minX + maxX) * 0.5;
          const objCy = (minY + maxY) * 0.5;
          const rx = Math.max(12, (maxX - minX) * 0.5);
          const ry = Math.max(12, (maxY - minY) * 0.5);

          const dstImg = dCtx.createImageData(bw, bh);
          const dData = dstImg.data;
          // True 360-degree continuous 3D Y-axis turntable rotation (default) using dual-phase spherical
          // flow-map longitude wrapping so surface details roll endlessly in one direction across the curved
          // hemisphere with genuine asin(nx) limb compression, zero seam pop, and rotating directional lighting.
          // Pass `opts.spinMode = "rock"` to explicitly request bounded oscillation instead.
          const isRockMode = opts.spinMode === "rock";
          const yaw = Math.sin(phase) * (0.58 + depth * 0.72);
          const pitch = Math.cos(phase * 0.7) * 0.14;
          const cosY = Math.cos(yaw);
          const sinY = Math.sin(yaw);
          const spinRad = phase * (0.68 + depth * 0.45);
          const lightX = Math.cos(phase * 0.9) * 0.65;
          const lightY = -0.24;
          const lightZ = 0.72 + Math.sin(phase * 0.9) * 0.12;

          for (let y = minY; y <= maxY; y++) {
            const ny = (y - objCy) / ry;
            const ny2 = ny * ny;
            const rowOff = y * bw * 4;
            for (let x = minX; x <= maxX; x++) {
              const dIdx = rowOff + x * 4;
              const a0 = sData[dIdx + 3];
              if (a0 === 0) continue;

              const nx = (x - objCx) / rx;
              const r2 = nx * nx + ny2;
              const clampedR2 = Math.min(0.96, r2);
              const nz = Math.sqrt(Math.max(0.04, 1.0 - clampedR2));

              // Dynamic 3D Lambertian + limb ambient occlusion + specular highlight sweep
              const lambert = nx * lightX + ny * lightY + nz * lightZ;
              const limbAo = 0.78 + 0.22 * nz;
              const shade = clamp((0.84 + lambert * 0.28) * limbAo, 0.58, 1.24);
              const spec = Math.max(0, lambert - 0.56) * 48;

              let rCol, gCol, bCol;
              if (isRockMode) {
                const uSurf = clamp(nx * cosY - nz * sinY * 0.78, -0.96, 0.96);
                const vSurf = clamp(ny - nz * pitch * 0.30, -0.96, 0.96);
                const sxPx = clamp(Math.round(objCx + uSurf * rx), minX, maxX);
                const syPx = clamp(Math.round(objCy + vSurf * ry), minY, maxY);
                const sIdx = (syPx * bw + sxPx) * 4;
                const useIdx = sData[sIdx + 3] > 32 ? sIdx : dIdx;
                rCol = sData[useIdx];
                gCol = sData[useIdx + 1];
                bCol = sData[useIdx + 2];
              } else {
                const theta = Math.asin(clamp(nx, -0.985, 0.985));
                const p1 = ((((theta + spinRad) / Math.PI) % 1) + 1) % 1;
                const p2 = p1 >= 0.5 ? p1 - 0.5 : p1 + 0.5;
                const u1 = (p1 * 2 - 1) * 0.92;
                const u2 = (p2 * 2 - 1) * 0.92;
                const vSurf = clamp(ny - nz * pitch * 0.22, -0.95, 0.95);
                const syPx = clamp(Math.round(objCy + vSurf * ry), minY, maxY);
                const sx1 = clamp(Math.round(objCx + u1 * rx), minX, maxX);
                const sx2 = clamp(Math.round(objCx + u2 * rx), minX, maxX);
                const sIdx1 = (syPx * bw + sx1) * 4;
                const sIdx2 = (syPx * bw + sx2) * 4;
                const ok1 = sData[sIdx1 + 3] > 32;
                const ok2 = sData[sIdx2 + 3] > 32;
                const edgeT = clamp((Math.abs(u1) - 0.54) / 0.38, 0, 1);
                const wb = edgeT * edgeT * (3 - 2 * edgeT);
                if (ok1 && ok2) {
                  const wa = 1 - wb;
                  rCol = sData[sIdx1] * wa + sData[sIdx2] * wb;
                  gCol = sData[sIdx1 + 1] * wa + sData[sIdx2 + 1] * wb;
                  bCol = sData[sIdx1 + 2] * wa + sData[sIdx2 + 2] * wb;
                } else {
                  const useIdx = ok1 ? sIdx1 : (ok2 ? sIdx2 : dIdx);
                  rCol = sData[useIdx];
                  gCol = sData[useIdx + 1];
                  bCol = sData[useIdx + 2];
                }
              }

              dData[dIdx] = clamp(Math.round(rCol * shade + spec), 0, 255);
              dData[dIdx + 1] = clamp(Math.round(gCol * shade + spec), 0, 255);
              dData[dIdx + 2] = clamp(Math.round(bCol * shade + spec * 0.85), 0, 255);
              dData[dIdx + 3] = a0;
            }
          }

          dCtx.putImageData(dstImg, 0, 0);
          const silSx = isRockMode
            ? 1 - depth * 0.42 * (0.5 - 0.5 * Math.cos(phase))
            : 1 - depth * 0.24 * (0.5 - 0.5 * Math.cos(phase * 2));
          const silSy = 1 + depth * 0.12 * Math.sin(phase);
          ctx.save();
          ctx.translate(cx + dx, cy + dy);
          ctx.rotate(rock);
          ctx.scale(silSx, silSy);
          ctx.drawImage(bufs.dst, -bw * 0.5, -bh * 0.5);
          ctx.restore();
          return;
        }
      } catch (_) {
        // Fallback to 2D affine turntable below
      }
    }

    // 3. Fallback 2D affine foreshortening + rock
    const sx = 1 - depth * (0.5 - 0.5 * Math.cos(phase));
    const sy = 1 + depth * 0.18 * Math.sin(phase);
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.rotate(rock);
    ctx.scale(sx, sy);
    if (typeof drawFnOrImg === "function") {
      drawFnOrImg(ctx, w, h, phase);
    } else if (drawFnOrImg) {
      drawImageFit(ctx, drawFnOrImg, -w * 0.5, -h * 0.5, w, h, opts.fitMode || "contain");
    }
    ctx.restore();
  }

  /**
   * MotionCraft `<MorphTransition>` vertex-matched polygon morph between `ptsA` and `ptsB` at progress `p` (0..1).
   */
  function drawMorphPolygon(ctx, ptsA, ptsB, p, opts = {}) {
    if (!ctx || !Array.isArray(ptsA) || !Array.isArray(ptsB) || ptsA.length === 0 || ptsB.length === 0) {
      return [];
    }
    const norm = (arr) =>
      arr.map((pt) =>
        Array.isArray(pt)
          ? { x: Number(pt[0]) || 0, y: Number(pt[1]) || 0 }
          : { x: Number(pt.x) || 0, y: Number(pt.y) || 0 }
      );
    const a = norm(ptsA);
    const b = norm(ptsB);
    const count = Math.max(a.length, b.length);
    const u = clamp(Number(p) || 0, 0, 1);
    const morphed = [];
    for (let i = 0; i < count; i++) {
      const pa = a[Math.min(a.length - 1, Math.floor((i * a.length) / count))];
      const pb = b[Math.min(b.length - 1, Math.floor((i * b.length) / count))];
      morphed.push({
        x: lerp(pa.x, pb.x, u),
        y: lerp(pa.y, pb.y, u),
      });
    }

    if (opts.draw !== false && morphed.length >= 3) {
      ctx.save();
      if (Number.isFinite(Number(opts.cx)) || Number.isFinite(Number(opts.cy))) {
        ctx.translate(Number(opts.cx) || 0, Number(opts.cy) || 0);
      }
      if (Number.isFinite(Number(opts.rot)) && Number(opts.rot) !== 0) {
        ctx.rotate(Number(opts.rot));
      }
      if (Number.isFinite(Number(opts.scale)) && Number(opts.scale) !== 1) {
        ctx.scale(Number(opts.scale), Number(opts.scale));
      }
      ctx.beginPath();
      ctx.moveTo(morphed[0].x, morphed[0].y);
      for (let i = 1; i < morphed.length; i++) {
        ctx.lineTo(morphed[i].x, morphed[i].y);
      }
      ctx.closePath();
      if (opts.fill) {
        ctx.fillStyle = opts.fill;
        ctx.fill();
      }
      if (opts.stroke) {
        ctx.strokeStyle = opts.stroke;
        ctx.lineWidth = Number(opts.lineWidth) || 2;
        ctx.stroke();
      }
      ctx.restore();
    }
    return morphed;
  }

  const API = {
    TAU,
    clamp,
    lerp,
    invLerp,
    inv: invLerp,
    remap,
    smoothstep,
    rand,
    rng,
    noise1D,
    noise2D,
    bezier,
    ease,
    E,
    spring,
    springV,
    kick,
    pop,
    hump,
    crisp,
    arcP,
    anticipation,
    stagger,
    squashStretch,
    f3,
    el,
    G,
    tf,
    vis,
    burstLine,
    ring,
    mixHex,
    drawBurstLines,
    drawShockRing,
    applyCamera,
    drawShapeWipe,
    drawCharacterRig,
    registerScene,
    getSceneRenderer,
    resolveScene,
    evalCurve,
    resolveTransition,
    renderFrameWithTransitions,
    roundRect,
    fillRoundRect,
    strokeRoundRect,
    hexAlpha,
    drawGridBackdrop,
    drawTopHeader,
    drawHeadlinePlaque,
    drawElectricBolt,
    drawSubtitles,
    evalKeyframes,
    textReveal,
    clipWipe,
    drawSVGPath,
    drawCursor,
    drawExtrudedArrow3D,
    drawLaptopFrame,
    drawWordWheel,
    loadImage,
    whenImagesReady,
    drawImageFit,
    registerAsset,
    loadAssetManifest,
    getAsset,
    drawAsset,
    postProcess,
    createStage,
    evalTrack,
    wiggle,
    loopTrack,
    drawAnimatedText,
    trimPaths,
    roundCorners,
    puckerBloat,
    wigglePaths,
    morphPath,
    drawShapePath,
    repeatDraw,
    polystarPath,
    syncCamera,
    drawOpticalGlow,
    drawBloomStroke,
    drawSphericalLens,
    drawTaperedRibbon,
    impactRecoil,
    twistPolygon,
    drawBlurRevealText,
    drawBlurRiseWords,
    layoutBalancedHeadline,
    drawTurntableObject,
    drawMorphPolygon,
    evalCameraTrack,
    applyTrackedCamera,
  };

  global.AetheriaMotion = API;
  global.AM = API;
})(typeof window !== "undefined" ? window : globalThis);
