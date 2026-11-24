/**
 * Aetheria AE Text Animator Selectors & Vector Path Operators (`/script/aetheria-shapes-text.js`).
 *
 * Portions adapted from EffectCraft (https://github.com/storytold/effectcraft),
 * Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors, MIT License.
 *
 * Includes:
 * - Pure After Effects Text Animator Selectors (Range shapes, Ease High/Low, Wiggly,
 *   Combine Modes, Randomize Order) + 8 built-in presets (`typewriter`, `fadeUpCharacters`,
 *   `bounceInWords`, `trackingIn`, `scramble`, `blurIn`, `jitter`, `dropInLines`).
 * - Exact arc-length Cubic Bezier `ShapePath` operators (`trimPaths`, `roundCorners`,
 *   `puckerBloat`, `wigglePaths`, Procrustes `morphPath`, `repeatDraw`, `polystarPath`).
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;
  const KAPPA = 0.5522847498307936;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerp2(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function mod(a, d) {
    return ((a % d) + d) % d;
  }

  // Deterministic 32-bit SplitMix hash -> [0, 1)
  function hash32(x) {
    let z = (x | 0) + 0x9e3779b9;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  }

  function catmullNoise(seed, idx, t) {
    const i = Math.floor(t);
    const f = t - i;
    const h = function (k) {
      return hash32((seed * 73856093) ^ (idx * 19349663) ^ ((i + k) * 83492791)) * 2 - 1;
    };
    const p0 = h(-1), p1 = h(0), p2 = h(1), p3 = h(2);
    const v = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    return clamp(v, -1, 1);
  }

  // =========================================================================
  // PART A: After Effects Text Animator Selectors (crates/text/src/selectors.rs)
  // =========================================================================

  function selectorEase(v, easeHigh, easeLow) {
    const t = clamp(v, 0, 1);
    const high = clamp(easeHigh || 0, -1, 1);
    const low = clamp(easeLow || 0, -1, 1);
    if (Math.abs(high) < 1e-6 && Math.abs(low) < 1e-6) return t;
    const p1 = (1 - low) / 3;
    const p2 = 1 - (1 - high) / 3;
    const u = 1 - t;
    return clamp(3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t, 0, 1);
  }

  function randomOrderMap(n, seed) {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    const s = Math.trunc(Number(seed) || 0) + 17;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(hash32(s ^ (i * 2654435761)) * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function rangeSelectorValue(sel, idx, n) {
    if (n <= 0) return 0;
    const rawStart = (sel.start !== undefined ? Number(sel.start) : 0) / 100;
    const rawEnd = (sel.end !== undefined ? Number(sel.end) : 100) / 100;
    const offset = (sel.offset !== undefined ? Number(sel.offset) : 0) / 100;
    const amount = (sel.amount !== undefined ? Number(sel.amount) : 100) / 100;
    const smoothness = clamp((sel.smoothness !== undefined ? Number(sel.smoothness) : 100) / 100, 0, 1);
    const easeHigh = clamp((sel.easeHigh || 0) / 100, -1, 1);
    const easeLow = clamp((sel.easeLow || 0) / 100, -1, 1);
    const shape = String(sel.shape || "square").toLowerCase();

    const s = Math.min(rawStart, rawEnd) + offset;
    const e = Math.max(rawStart, rawEnd) + offset;
    const unit = 1 / n;
    const c = (idx + 0.5) * unit;
    let v = 0;

    if (shape === "square") {
      const w = smoothness * unit;
      if (w <= 1e-9) {
        v = c >= s && c <= e ? 1 : 0;
      } else {
        const left = clamp((c - s) / w + 0.5, 0, 1);
        const right = clamp((e - c) / w + 0.5, 0, 1);
        v = Math.min(left, right);
      }
    } else {
      const span = e - s;
      const f = span > 1e-9 ? (c - s) / span : c >= e ? 1 : 0;
      if (shape === "rampup") {
        v = clamp(f, 0, 1);
      } else if (shape === "rampdown") {
        v = 1 - clamp(f, 0, 1);
      } else if (shape === "triangle") {
        v = f <= 0 || f >= 1 ? 0 : 1 - Math.abs(2 * f - 1);
      } else if (shape === "round") {
        if (f <= 0 || f >= 1) v = 0;
        else {
          const d = 2 * f - 1;
          v = Math.sqrt(Math.max(0, 1 - d * d));
        }
      } else if (shape === "smooth") {
        const tri = f <= 0 || f >= 1 ? 0 : 1 - Math.abs(2 * f - 1);
        v = tri * tri * (3 - 2 * tri);
      } else {
        v = c >= s && c <= e ? 1 : 0;
      }
    }
    return selectorEase(v, easeHigh, easeLow) * amount;
  }

  function wigglySelectorValue(sel, t, idx, dim) {
    const wps = Number.isFinite(Number(sel.wigglesPerSecond)) ? Number(sel.wigglesPerSecond) : 2;
    const corr = clamp((sel.correlation !== undefined ? Number(sel.correlation) : 50) / 100, 0, 1);
    const maxV = (sel.max !== undefined ? Number(sel.max) : 100) / 100;
    const minV = (sel.min !== undefined ? Number(sel.min) : -100) / 100;
    const phase = (Number(sel.temporalPhase) || 0) / 360;
    const spPhase = (Number(sel.spatialPhase) || 0) / 360;
    const seed = Math.trunc(Number(sel.seed) || 1);
    const tt = t * wps + phase;
    const shared = catmullNoise(seed, 99991 + dim, tt);
    const own = catmullNoise(seed, idx * 7 + dim, tt + spPhase + idx * 0.37);
    const n = clamp(shared * corr + own * (1 - corr), -1, 1);
    return minV + (maxV - minV) * ((n + 1) * 0.5);
  }

  function combineSelector(acc, v, mode) {
    const m = String(mode || "add").toLowerCase();
    if (m === "subtract") return acc >= 0 ? Math.max(0, acc - v) : acc - v;
    if (m === "intersect") return acc * v;
    if (m === "min") return Math.min(acc, v);
    if (m === "max") return Math.max(acc, v);
    if (m === "difference") return Math.abs(acc - v);
    return acc + v;
  }

  function evalTextSelector(sel, unitIndex, unitCount, t, dim) {
    if (!sel || typeof sel !== "object") return 1;
    if (sel.kind === "wiggly") {
      return wigglySelectorValue(sel, Number(t) || 0, unitIndex, dim || 0);
    }
    let idx = unitIndex;
    if (sel.randomizeOrder) {
      const perm = randomOrderMap(unitCount, sel.seed || 0);
      idx = perm[unitIndex];
    }
    return rangeSelectorValue(sel, idx, unitCount);
  }

  const TEXT_PRESETS = {
    typewriter: function (t, start, dur) {
      const u = clamp((t - start) / Math.max(0.01, dur), 0, 1);
      return [
        {
          properties: { opacity: 0 },
          selectors: [{ kind: "range", start: u * 100, end: 100, smoothness: 0 }],
        },
      ];
    },
    fadeUpCharacters: function (t, start, dur) {
      const u = clamp((t - start) / Math.max(0.01, dur), 0, 1);
      return [
        {
          properties: { opacity: 0, position: [0, 40] },
          selectors: [{ kind: "range", shape: "rampUp", easeHigh: 50, easeLow: 50, offset: -100 + u * 200 }],
        },
      ];
    },
    bounceInWords: function (t, start, dur) {
      const u1 = clamp((t - start) / Math.max(0.01, dur * 0.8), 0, 1);
      const u2 = clamp((t - (start + dur * 0.1)) / Math.max(0.01, dur * 0.9), 0, 1);
      return [
        {
          basedOn: "words",
          properties: { scale: [0, 0], opacity: 0 },
          selectors: [{ kind: "range", shape: "rampUp", offset: -100 + u1 * 200 }],
        },
        {
          basedOn: "words",
          properties: { scale: [130, 130] },
          selectors: [{ kind: "range", shape: "triangle", end: 35, offset: -35 + u2 * 135 }],
        },
      ];
    },
    trackingIn: function (t, start, dur) {
      const u = clamp((t - start) / Math.max(0.01, dur), 0, 1);
      const ease = 1 - Math.pow(1 - u, 3);
      return [
        {
          properties: { tracking: 40 * (1 - ease), opacity: clamp(u * 2, 0, 1) * 100 },
          selectors: [{ kind: "range", start: 0, end: 100 }],
        },
      ];
    },
    scramble: function (t, start, dur) {
      const u = clamp((t - start) / Math.max(0.01, dur), 0, 1);
      return [
        {
          properties: { characterOffset: 12 },
          selectors: [
            { kind: "range", start: u * 100, end: 100, smoothness: 0, randomizeOrder: true, seed: 7 },
            { kind: "wiggly", mode: "intersect", wigglesPerSecond: 8, correlation: 0 },
          ],
        },
      ];
    },
    blurIn: function (t, start, dur) {
      const u = clamp((t - start) / Math.max(0.01, dur), 0, 1);
      return [
        {
          properties: { blur: 22, opacity: 0, scale: [140, 140] },
          selectors: [{ kind: "range", shape: "rampUp", easeLow: 60, offset: -100 + u * 200 }],
        },
      ];
    },
    jitter: function (t) {
      return [
        {
          properties: { position: [0, 14], rotation: 10 },
          selectors: [
            { kind: "range", start: 0, end: 100 },
            { kind: "wiggly", mode: "intersect", wigglesPerSecond: 3, correlation: 20, seed: 3 },
          ],
        },
      ];
    },
    dropInLines: function (t, start, dur) {
      const u = clamp((t - start) / Math.max(0.01, dur), 0, 1);
      return [
        {
          basedOn: "lines",
          properties: { position: [0, -100], rotation: -8, opacity: 0 },
          selectors: [{ kind: "range", shape: "rampUp", easeHigh: 80, offset: -100 + u * 200 }],
        },
      ];
    },
  };

  const TEXT_PRESET_NAMES = Object.keys(TEXT_PRESETS);

  function shiftChar(ch, offset) {
    const code = ch.charCodeAt(0);
    const step = Math.round(offset);
    if (step === 0 || ch === " ") return ch;
    if (code >= 65 && code <= 90) return String.fromCharCode(65 + mod(code - 65 + step, 26));
    if (code >= 97 && code <= 122) return String.fromCharCode(97 + mod(code - 97 + step, 26));
    if (code >= 48 && code <= 57) return String.fromCharCode(48 + mod(code - 48 + step, 10));
    return ch;
  }

  function drawAnimatedText(ctx, text, x, y, t, opts) {
    if (!ctx) return { renderedChars: 0 };
    const o = opts && typeof opts === "object" ? opts : {};
    const str = String(text ?? "");
    const sec = Number(t) || 0;
    let animators = Array.isArray(o.animators) ? o.animators : [];
    if (typeof o.preset === "string") {
      if (!Object.prototype.hasOwnProperty.call(TEXT_PRESETS, o.preset)) {
        throw new Error(
          "AetheriaShapesText: unknown text preset '" + o.preset + "'. Valid presets: " + TEXT_PRESET_NAMES.join(", ") + "."
        );
      }
      const startSec = Number.isFinite(Number(o.startSec)) ? Number(o.startSec) : 0;
      const durationSec = Number.isFinite(Number(o.durationSec)) ? Number(o.durationSec) : 1.2;
      animators = TEXT_PRESETS[o.preset](sec, startSec, durationSec).concat(animators);
    }

    const lines = str.split("\n");
    const fontSize = Number(o.fontSize) || 56;
    const font = o.font || ("800 " + fontSize + "px Inter, sans-serif");
    const color = o.color || o.fillStyle || "#FFFFFF";
    const lineHeight = Number(o.lineHeight) || fontSize * 1.2;
    const align = String(o.align || "center").toLowerCase();
    const lineAnchor = Number.isFinite(Number(o.lineAnchor))
      ? clamp(Number(o.lineAnchor) / 100, 0, 1)
      : align === "left"
        ? 0
        : align === "right"
          ? 1
          : 0.5;

    // Build flat char metadata with char/word/line indices
    const chars = [];
    let charIdx = 0;
    let charNoSpaceIdx = 0;
    let wordIdx = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      let inWord = false;
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        const isSpace = /\s/.test(ch);
        if (!isSpace && !inWord) {
          if (chars.length > 0 && chars[chars.length - 1].lineIndex === li) wordIdx++;
          else if (li > 0 && wordIdx >= 0 && chars.length > 0) wordIdx++;
          inWord = true;
        } else if (isSpace) {
          inWord = false;
        }
        chars.push({
          ch,
          lineIndex: li,
          colIndex: ci,
          charIndex: charIdx++,
          charNoSpaceIndex: isSpace ? -1 : charNoSpaceIdx++,
          wordIndex: wordIdx,
        });
      }
    }
    const totalChars = Math.max(1, charIdx);
    const totalCharsNoSpace = Math.max(1, charNoSpaceIdx);
    const totalWords = Math.max(1, wordIdx + 1);
    const totalLines = Math.max(1, lines.length);

    ctx.save();
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    let renderedChars = 0;
    const baseAlpha = ctx.globalAlpha;

    for (let li = 0; li < lines.length; li++) {
      const lineChars = chars.filter(function (c) {
        return c.lineIndex === li;
      });
      if (lineChars.length === 0) continue;

      // Measure native prefix kerning advances via Canvas2D
      const lineStr = lines[li];
      const advances = new Array(lineChars.length);
      let prevW = 0;
      for (let i = 0; i < lineChars.length; i++) {
        const w = ctx.measureText(lineStr.slice(0, i + 1)).width;
        advances[i] = Math.max(0, w - prevW);
        prevW = w;
      }

      // Compute per-char animated transforms
      const states = lineChars.map(function (meta, i) {
        const st = {
          dx: 0,
          dy: 0,
          sx: 1,
          sy: 1,
          rot: 0,
          opacity: 1,
          tracking: Number(o.letterSpacing) || 0,
          blur: 0,
          charOffset: 0,
        };
        for (let ai = 0; ai < animators.length; ai++) {
          const anim = animators[ai];
          const props = anim.properties || {};
          const based = String(anim.basedOn || "chars").toLowerCase();
          let uIdx = meta.charIndex;
          let uCount = totalChars;
          if (based === "charsnospace") {
            if (meta.charNoSpaceIndex < 0) continue;
            uIdx = meta.charNoSpaceIndex;
            uCount = totalCharsNoSpace;
          } else if (based === "words") {
            uIdx = meta.wordIndex;
            uCount = totalWords;
          } else if (based === "lines") {
            uIdx = meta.lineIndex;
            uCount = totalLines;
          }
          const sels = Array.isArray(anim.selectors) && anim.selectors.length > 0 ? anim.selectors : [{ kind: "range" }];
          let k = 0;
          for (let si = 0; si < sels.length; si++) {
            const sv = evalTextSelector(sels[si], uIdx, uCount, sec, 0);
            k = si === 0 ? sv : combineSelector(k, sv, sels[si].mode);
          }
          k = clamp(k, -1, 1);
          if (Math.abs(k) < 1e-6) continue;
          if (Array.isArray(props.position)) {
            st.dx += (Number(props.position[0]) || 0) * k;
            st.dy += (Number(props.position[1]) || 0) * k;
          }
          if (Array.isArray(props.scale)) {
            st.sx *= 1 + ((Number(props.scale[0]) || 100) / 100 - 1) * k;
            st.sy *= 1 + ((Number(props.scale[1]) || 100) / 100 - 1) * k;
          }
          if (props.rotation !== undefined) {
            st.rot += Number(props.rotation) * k * DEG;
          }
          if (props.opacity !== undefined) {
            const targetOp = clamp(Number(props.opacity) / 100, 0, 1);
            st.opacity += (targetOp - st.opacity) * clamp(k, 0, 1);
          }
          if (props.tracking !== undefined) {
            st.tracking += Number(props.tracking) * k;
          }
          if (props.blur !== undefined) {
            const bv = Array.isArray(props.blur) ? Number(props.blur[0]) : Number(props.blur);
            st.blur += Math.abs(bv * k);
          }
          if (props.characterOffset !== undefined) {
            st.charOffset += Number(props.characterOffset) * k;
          }
        }
        return { meta, st, adv: advances[i], idxInLine: i };
      });

      // Symmetrical tracking layout with lineAnchor compensation
      let pen = 0;
      const centers = new Array(states.length);
      for (let i = 0; i < states.length; i++) {
        const tr = states[i].st.tracking;
        if (i > 0) pen += tr * 0.5;
        centers[i] = pen + states[i].adv * 0.5;
        pen += states[i].adv;
        if (i + 1 < states.length) pen += tr * 0.5;
      }
      const lineStartX = x - pen * lineAnchor;
      const lineY = y + (li - (lines.length - 1) * 0.5) * lineHeight;

      for (let i = 0; i < states.length; i++) {
        const item = states[i];
        const alpha = clamp(item.st.opacity, 0, 1) * baseAlpha;
        if (alpha <= 1e-3 || item.meta.ch === " ") continue;
        const gx = lineStartX + centers[i] + item.st.dx;
        const gy = lineY + item.st.dy;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (item.st.blur > 0.25 && "filter" in ctx) {
          ctx.filter = "blur(" + item.st.blur.toFixed(1) + "px)";
        }
        ctx.translate(gx, gy);
        if (Math.abs(item.st.rot) > 1e-5) ctx.rotate(item.st.rot);
        if (Math.abs(item.st.sx - 1) > 1e-5 || Math.abs(item.st.sy - 1) > 1e-5) {
          ctx.scale(item.st.sx, item.st.sy);
        }
        ctx.fillStyle = color;
        ctx.fillText(shiftChar(item.meta.ch, item.st.charOffset), 0, 0);
        if (o.strokeStyle && Number(o.lineWidth) > 0) {
          ctx.strokeStyle = o.strokeStyle;
          ctx.lineWidth = Number(o.lineWidth);
          ctx.strokeText(shiftChar(item.meta.ch, item.st.charOffset), 0, 0);
        }
        ctx.restore();
        renderedChars++;
      }
    }

    ctx.restore();
    return { renderedChars };
  }

  // =========================================================================
  // PART B: Cubic ShapePath & Vector Path Operators (crates/path + shapes.rs)
  // =========================================================================

  function normalizePath(p) {
    if (Array.isArray(p)) {
      const verts = p.map(function (pt) {
        return Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x), Number(pt.y)];
      });
      const z = verts.map(function () {
        return [0, 0];
      });
      return { vertices: verts, inTangents: z, outTangents: z.map(function (a) { return a.slice(); }), closed: true };
    }
    const verts = (p.vertices || []).map(function (v) {
      return [Number(v[0]), Number(v[1])];
    });
    const ins = verts.map(function (_, i) {
      const t = p.inTangents && p.inTangents[i];
      return t ? [Number(t[0]), Number(t[1])] : [0, 0];
    });
    const outs = verts.map(function (_, i) {
      const t = p.outTangents && p.outTangents[i];
      return t ? [Number(t[0]), Number(t[1])] : [0, 0];
    });
    return { vertices: verts, inTangents: ins, outTangents: outs, closed: p.closed !== false };
  }

  function rectPath(w, h, cx, cy, roundness) {
    const hw = w * 0.5;
    const hh = h * 0.5;
    const x = cx || 0;
    const y = cy || 0;
    const r = clamp(Number(roundness) || 0, 0, Math.min(hw, hh));
    if (r <= 1e-6) {
      return normalizePath({
        vertices: [[x + hw, y - hh], [x + hw, y + hh], [x - hw, y + hh], [x - hw, y - hh]],
        closed: true,
      });
    }
    const k = r * KAPPA;
    return {
      vertices: [
        [x + hw, y - hh + r],
        [x + hw, y + hh - r],
        [x + hw - r, y + hh],
        [x - hw + r, y + hh],
        [x - hw, y + hh - r],
        [x - hw, y - hh + r],
        [x - hw + r, y - hh],
        [x + hw - r, y - hh],
      ],
      inTangents: [[0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0]],
      outTangents: [[0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k], [0, 0], [k, 0]],
      closed: true,
    };
  }

  function ellipsePath(w, h, cx, cy) {
    const rx = w * 0.5;
    const ry = h * 0.5;
    const x = cx || 0;
    const y = cy || 0;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    return {
      vertices: [[x, y - ry], [x + rx, y], [x, y + ry], [x - rx, y]],
      inTangents: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
      outTangents: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
      closed: true,
    };
  }

  function polystarPath(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const pts = Math.max(3, Math.round(Number(o.points) || 5));
    const star = o.star !== false;
    const outerR = Number(o.outerRadius) || 100;
    const innerR = Number(o.innerRadius) || outerR * 0.5;
    const cx = Number(o.cx) || 0;
    const cy = Number(o.cy) || 0;
    const rot = (Number(o.rotationDeg) || 0) * DEG - Math.PI * 0.5;
    const count = star ? pts * 2 : pts;
    const vertices = [];
    for (let i = 0; i < count; i++) {
      const a = rot + (i / count) * Math.PI * 2;
      const r = star && i % 2 === 1 ? innerR : outerR;
      vertices.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return normalizePath({ vertices, closed: true });
  }

  function pathToCubics(raw) {
    const p = normalizePath(raw);
    const n = p.vertices.length;
    const segCount = p.closed ? n : Math.max(0, n - 1);
    const out = [];
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n;
      const a = p.vertices[i];
      const b = p.vertices[j];
      const ot = p.outTangents[i];
      const it = p.inTangents[j];
      out.push([a, [a[0] + ot[0], a[1] + ot[1]], [b[0] + it[0], b[1] + it[1]], b]);
    }
    return { cubics: out, closed: p.closed };
  }

  function cubicsToPath(cubics, closed) {
    if (cubics.length === 0) return { vertices: [], inTangents: [], outTangents: [], closed: false };
    const n = closed ? cubics.length : cubics.length + 1;
    const vertices = new Array(n);
    const inTangents = new Array(n);
    const outTangents = new Array(n);
    for (let i = 0; i < n; i++) {
      inTangents[i] = [0, 0];
      outTangents[i] = [0, 0];
    }
    for (let i = 0; i < cubics.length; i++) {
      const c = cubics[i];
      const j = closed ? (i + 1) % n : i + 1;
      vertices[i] = c[0].slice();
      outTangents[i] = [c[1][0] - c[0][0], c[1][1] - c[0][1]];
      inTangents[j] = [c[2][0] - c[3][0], c[2][1] - c[3][1]];
      if (!closed && j === n - 1) vertices[j] = c[3].slice();
    }
    return { vertices, inTangents, outTangents, closed };
  }

  function evalCubic(c, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
  }

  function splitCubic(c, t) {
    const p01 = lerp2(c[0], c[1], t);
    const p12 = lerp2(c[1], c[2], t);
    const p23 = lerp2(c[2], c[3], t);
    const a = lerp2(p01, p12, t);
    const b = lerp2(p12, p23, t);
    const m = lerp2(a, b, t);
    return [[c[0], p01, a, m], [m, b, p23, c[3]]];
  }

  function subsegmentCubic(c, t0, t1) {
    const right = t0 > 0 ? splitCubic(c, t0)[1] : c;
    const u = t1 < 1 ? clamp((t1 - t0) / Math.max(1e-12, 1 - t0), 0, 1) : 1;
    return u < 1 ? splitCubic(right, u)[0] : right;
  }

  function measureCubic(c, steps) {
    const S = steps || 32;
    const cum = new Array(S + 1);
    cum[0] = 0;
    let prev = c[0];
    for (let i = 1; i <= S; i++) {
      const q = evalCubic(c, i / S);
      cum[i] = cum[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
    }
    return { cum, len: cum[S], S };
  }

  function invArcCubic(m, target) {
    if (target <= 0 || m.len <= 1e-12) return 0;
    if (target >= m.len) return 1;
    let lo = 0, hi = m.S;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (m.cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = clamp(lo, 1, m.S);
    const f = (target - m.cum[i - 1]) / Math.max(1e-12, m.cum[i] - m.cum[i - 1]);
    return (i - 1 + f) / m.S;
  }

  function unitVec(dx, dy) {
    const l = Math.hypot(dx, dy);
    return l > 1e-9 ? [dx / l, dy / l] : [1, 0];
  }

  function cubicStartTan(c) {
    const d1 = [c[1][0] - c[0][0], c[1][1] - c[0][1]];
    if (Math.hypot(d1[0], d1[1]) > 1e-7) return unitVec(d1[0], d1[1]);
    const d2 = [c[2][0] - c[0][0], c[2][1] - c[0][1]];
    if (Math.hypot(d2[0], d2[1]) > 1e-7) return unitVec(d2[0], d2[1]);
    return unitVec(c[3][0] - c[0][0], c[3][1] - c[0][1]);
  }

  function cubicEndTan(c) {
    const d1 = [c[3][0] - c[2][0], c[3][1] - c[2][1]];
    if (Math.hypot(d1[0], d1[1]) > 1e-7) return unitVec(d1[0], d1[1]);
    const d2 = [c[3][0] - c[1][0], c[3][1] - c[1][1]];
    if (Math.hypot(d2[0], d2[1]) > 1e-7) return unitVec(d2[0], d2[1]);
    return unitVec(c[3][0] - c[0][0], c[3][1] - c[0][1]);
  }

  function trimIntervals(start, end, offsetDeg) {
    let s = Number(start ?? 0) / 100;
    let e = Number(end ?? 100) / 100;
    if (s > e) { const tmp = s; s = e; e = tmp; }
    s = clamp(s, 0, 1);
    e = clamp(e, 0, 1);
    if (e - s >= 1 - 1e-9) return null;
    if (e - s <= 1e-9) return [];
    const off = mod((Number(offsetDeg) || 0) / 360, 1);
    s += off;
    e += off;
    if (e <= 1) return [[s, e]];
    if (s >= 1) return [[s - 1, e - 1]];
    return [[s, 1], [0, e - 1]];
  }

  function trimSingleCubicList(cubics, measures, total, intervals) {
    const outPieces = [];
    for (let k = 0; k < intervals.length; k++) {
      const sa = intervals[k][0] * total;
      const sb = intervals[k][1] * total;
      let acc = 0;
      for (let i = 0; i < cubics.length; i++) {
        const len = measures[i].len;
        const s0 = acc, s1 = acc + len;
        acc = s1;
        if (s1 <= sa || s0 >= sb || len <= 1e-12) continue;
        const t0 = sa > s0 ? invArcCubic(measures[i], sa - s0) : 0;
        const t1 = sb < s1 ? invArcCubic(measures[i], sb - s0) : 1;
        if (t1 <= t0) continue;
        outPieces.push(subsegmentCubic(cubics[i], t0, t1));
      }
    }
    if (outPieces.length === 0) return [];
    // Group contiguous cubic chains so wrap-around seam stays one unbroken subpath
    const chains = [[outPieces[0]]];
    for (let i = 1; i < outPieces.length; i++) {
      const prevEnd = chains[chains.length - 1][chains[chains.length - 1].length - 1][3];
      const curStart = outPieces[i][0];
      if (Math.hypot(curStart[0] - prevEnd[0], curStart[1] - prevEnd[1]) <= 1e-4) {
        chains[chains.length - 1].push(outPieces[i]);
      } else {
        chains.push([outPieces[i]]);
      }
    }
    return chains.map(function (ch) {
      return cubicsToPath(ch, false);
    });
  }

  /** Exact arc-length Trim Paths (`simultaneous` or `individually`). */
  function trimPaths(pathOrList, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const list = Array.isArray(pathOrList) ? pathOrList : [pathOrList];
    const iv = trimIntervals(o.start, o.end, o.offset);
    if (iv === null) return list.map(normalizePath);
    if (iv.length === 0) return [];
    const individually = String(o.mode || "simultaneous").toLowerCase() === "individually";

    const measured = list.map(function (raw) {
      const { cubics } = pathToCubics(raw);
      const ms = cubics.map(function (c) { return measureCubic(c, 32); });
      const total = ms.reduce(function (s, m) { return s + m.len; }, 0);
      return { cubics, ms, total };
    });

    const out = [];
    if (!individually) {
      for (let i = 0; i < measured.length; i++) {
        if (measured[i].total > 0) {
          out.push.apply(out, trimSingleCubicList(measured[i].cubics, measured[i].ms, measured[i].total, iv));
        }
      }
      return out;
    }

    const grandTotal = measured.reduce(function (s, m) { return s + m.total; }, 0);
    if (grandTotal <= 1e-12) return [];
    let base = 0;
    for (let i = 0; i < measured.length; i++) {
      const m = measured[i];
      const localIv = [];
      for (let k = 0; k < iv.length; k++) {
        const la = Math.max(0, iv[k][0] * grandTotal - base);
        const lb = Math.min(m.total, iv[k][1] * grandTotal - base);
        if (lb > la && m.total > 1e-12) localIv.push([la / m.total, lb / m.total]);
      }
      if (localIv.length > 0) {
        out.push.apply(out, trimSingleCubicList(m.cubics, m.ms, m.total, localIv));
      }
      base += m.total;
    }
    return out;
  }

  /** Round Corners (`ops.rs` L270-345): exact circular-arc cubic bevel on sharp vertices. */
  function roundCorners(pathOrList, radius) {
    const r = Number(radius);
    const list = Array.isArray(pathOrList) ? pathOrList : [pathOrList];
    if (!(r > 0 && Number.isFinite(r))) return list.map(normalizePath);
    return list.map(function (raw) {
      const { cubics, closed } = pathToCubics(raw);
      const n = cubics.length;
      if (n === 0) return normalizePath(raw);
      const ms = cubics.map(function (c) { return measureCubic(c, 24); });
      const cut = new Array(n).fill(0);
      const phi = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        if (!closed && i === 0) continue;
        const prev = (i + n - 1) % n;
        const tin = cubicEndTan(cubics[prev]);
        const tout = cubicStartTan(cubics[i]);
        const turn = Math.abs(Math.atan2(tin[0] * tout[1] - tin[1] * tout[0], tin[0] * tout[0] + tin[1] * tout[1]));
        if (turn < 1e-3 || turn > Math.PI - 1e-3) continue;
        cut[i] = Math.min(r, ms[prev].len * 0.5, ms[i].len * 0.5);
        phi[i] = turn;
      }
      const trimmed = cubics.map(function (c, j) {
        const a = cut[j];
        const b = closed || j + 1 < n ? cut[(j + 1) % n] : 0;
        const t0 = a > 0 ? invArcCubic(ms[j], a) : 0;
        const t1 = Math.max(t0, b > 0 ? invArcCubic(ms[j], Math.max(0, ms[j].len - b)) : 1);
        const sub = subsegmentCubic(c, t0, t1);
        return { sub, tStart: cubicStartTan(sub), tEnd: cubicEndTan(sub) };
      });
      const outCubics = [];
      const pushArc = function (from, to, corner, ang) {
        const p = from.sub[3];
        const q = to.sub[0];
        const k = (4 / 3) * Math.tan(ang * 0.25) / Math.tan(ang * 0.5);
        const hp = Math.hypot(p[0] - corner[0], p[1] - corner[1]) * k;
        const hq = Math.hypot(q[0] - corner[0], q[1] - corner[1]) * k;
        outCubics.push([
          p,
          [p[0] + from.tEnd[0] * hp, p[1] + from.tEnd[1] * hp],
          [q[0] - to.tStart[0] * hq, q[1] - to.tStart[1] * hq],
          q,
        ]);
      };
      for (let j = 0; j < n; j++) {
        if (j > 0 && cut[j] > 0) pushArc(trimmed[j - 1], trimmed[j], cubics[j][0], phi[j]);
        const s = trimmed[j].sub;
        if (Math.hypot(s[3][0] - s[0][0], s[3][1] - s[0][1]) > 1e-6) outCubics.push(s);
      }
      if (closed && cut[0] > 0) pushArc(trimmed[n - 1], trimmed[0], cubics[0][0], phi[0]);
      return cubicsToPath(outCubics, closed);
    });
  }

  /** Pucker & Bloat (`ops.rs` L209-262): positive bloats handles outward, negative puckers inward. */
  function puckerBloat(pathOrList, amount) {
    const a = Number(amount || 0) / 100;
    const list = Array.isArray(pathOrList) ? pathOrList : [pathOrList];
    if (a === 0) return list.map(normalizePath);
    return list.map(function (raw) {
      const p = normalizePath(raw);
      const n = p.vertices.length;
      if (n === 0) return p;
      let cx = 0, cy = 0;
      for (let i = 0; i < n; i++) { cx += p.vertices[i][0]; cy += p.vertices[i][1]; }
      cx /= n; cy /= n;
      const mv = function (q) { return [q[0] + (cx - q[0]) * a, q[1] + (cy - q[1]) * a]; };
      const mvh = function (q) { return [q[0] + (q[0] - cx) * a, q[1] + (q[1] - cy) * a]; };
      const { cubics, closed } = pathToCubics(p);
      const warped = cubics.map(function (c) {
        return [mv(c[0]), mvh(c[1]), mvh(c[2]), mv(c[3])];
      });
      return cubicsToPath(warped, closed);
    });
  }

  /** Wiggle Paths (`ops.rs` L567-673): C1 Catmull-Rom temporal + cyclic spatial noise warp. */
  function wigglePaths(pathOrList, params, timeSec) {
    const w = params && typeof params === "object" ? params : {};
    const size = Number(w.size ?? 10);
    const list = Array.isArray(pathOrList) ? pathOrList : [pathOrList];
    if (size === 0) return list.map(normalizePath);
    const m = Math.max(1, Math.min(32, Math.round(Number(w.detail ?? 4)) + 1));
    const speed = Number(w.speed ?? 2);
    const corr = clamp(Number(w.correlation ?? 50) / 100, 0, 1);
    const smooth = w.smooth !== false;
    const seed = Math.trunc(Number(w.seed) || 1);
    const tt = (Number(timeSec) || 0) * speed + (Number(w.phaseDeg) || 0) / 360;
    const sharedX = catmullNoise(seed, 999983, tt);
    const sharedY = catmullNoise(seed, 999979, tt);

    return list.map(function (raw, pi) {
      const { cubics, closed } = pathToCubics(raw);
      if (cubics.length === 0) return normalizePath(raw);
      const pts = [];
      const tans = [];
      for (let j = 0; j < cubics.length; j++) {
        const ms = measureCubic(cubics[j], 24);
        for (let k = 0; k < m; k++) {
          const u = k === 0 ? 0 : invArcCubic(ms, (ms.len * k) / m);
          const q = evalCubic(cubics[j], u);
          const qNext = evalCubic(cubics[j], Math.min(1, u + 0.01));
          pts.push(q);
          tans.push(unitVec(qNext[0] - q[0], qNext[1] - q[1]));
        }
      }
      if (!closed) {
        const last = cubics[cubics.length - 1];
        pts.push(last[3]);
        tans.push(cubicEndTan(last));
      }
      const displaced = pts.map(function (pt, idx) {
        const ox = catmullNoise(seed, (pi * 1009 + idx) * 2, tt + idx * 0.37);
        const oy = catmullNoise(seed, (pi * 1009 + idx) * 2 + 1, tt + idx * 0.61);
        return [pt[0] + (sharedX * corr + ox * (1 - corr)) * size, pt[1] + (sharedY * corr + oy * (1 - corr)) * size];
      });
      const outCubics = [];
      const segs = closed ? displaced.length : displaced.length - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % displaced.length;
        const a = displaced[i], b = displaced[j];
        if (smooth) {
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]) / 3;
          outCubics.push([a, [a[0] + tans[i][0] * d, a[1] + tans[i][1] * d], [b[0] - tans[j][0] * d, b[1] - tans[j][1] * d], b]);
        } else {
          outCubics.push([a, a, b, b]);
        }
      }
      return cubicsToPath(outCubics, closed);
    });
  }

  // Smart Shape Morphing (`crates/path/src/interp.rs`: de Casteljau arc-length subdivision + Procrustes)
  function withVertexCount(raw, total) {
    const p = normalizePath(raw);
    const { cubics, closed } = pathToCubics(p);
    const m = cubics.length;
    const base = closed ? m : m + 1;
    if (m === 0 || total <= base) return p;
    const ms = cubics.map(function (c) { return measureCubic(c, 24); });
    const sum = Math.max(1e-12, ms.reduce(function (s, x) { return s + x.len; }, 0));
    const extra = total - base;
    const k = ms.map(function (x) { return 1 + Math.floor((x.len / sum) * extra); });
    let left = total - base + m - k.reduce(function (s, x) { return s + x; }, 0);
    const order = ms.map(function (x, i) { return { i, rem: (x.len / sum) * extra - Math.floor((x.len / sum) * extra) }; })
      .sort(function (a, b) { return b.rem - a.rem || a.i - b.i; });
    for (let idx = 0; left > 0; idx = (idx + 1) % order.length) {
      k[order[idx].i]++;
      left--;
    }
    const out = [];
    for (let i = 0; i < m; i++) {
      const pieces = k[i];
      if (pieces <= 1) {
        out.push(cubics[i]);
      } else {
        let prevT = 0;
        for (let j = 1; j <= pieces; j++) {
          const nextT = j === pieces ? 1 : invArcCubic(ms[i], (ms[i].len * j) / pieces);
          out.push(subsegmentCubic(cubics[i], prevT, nextT));
          prevT = nextT;
        }
      }
    }
    return cubicsToPath(out, closed);
  }

  function signedArea(verts) {
    let s = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s * 0.5;
  }

  function reversePath(p) {
    const n = p.vertices.length;
    const idx = [];
    if (p.closed) {
      for (let i = 0; i < n; i++) idx.push((n - i) % n);
    } else {
      for (let i = n - 1; i >= 0; i--) idx.push(i);
    }
    return {
      vertices: idx.map(function (i) { return p.vertices[i].slice(); }),
      inTangents: idx.map(function (i) { return p.outTangents[i].slice(); }),
      outTangents: idx.map(function (i) { return p.inTangents[i].slice(); }),
      closed: p.closed,
    };
  }

  function rotatePath(p, k) {
    const n = p.vertices.length;
    if (n === 0 || k % n === 0) return p;
    const rot = function (arr) {
      return arr.map(function (_, i) { return arr[(i + k) % n].slice(); });
    };
    return { vertices: rot(p.vertices), inTangents: rot(p.inTangents), outTangents: rot(p.outTangents), closed: p.closed };
  }

  function morphPath(rawA, rawB, u, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const t = clamp(Number(u) || 0, 0, 1);
    const pA0 = normalizePath(rawA);
    const pB0 = normalizePath(rawB);
    const targetN = Math.max(pA0.vertices.length, pB0.vertices.length);
    const a = withVertexCount(pA0, targetN);
    let b = withVertexCount(pB0, targetN);
    const n = a.vertices.length;
    if (n === 0 || b.vertices.length !== n) return a;

    // Match winding + best cyclic offset minimizing normalized L2 distance
    if (a.closed && b.closed) {
      if (signedArea(a.vertices) * signedArea(b.vertices) < 0) b = reversePath(b);
      let bestK = 0, bestCost = Infinity;
      for (let k = 0; k < n; k++) {
        let cost = 0;
        for (let i = 0; i < n; i++) {
          const av = a.vertices[i], bv = b.vertices[(i + k) % n];
          const dx = bv[0] - av[0], dy = bv[1] - av[1];
          cost += dx * dx + dy * dy;
        }
        if (cost < bestCost) { bestCost = cost; bestK = k; }
      }
      b = rotatePath(b, bestK);
    }

    // Closed-form 2D Procrustes rigid-similarity blend weighted by bendingResistance
    const bend = clamp(Number(o.bendingResistance ?? 50) / 100, 0, 1);
    const ca = [0, 0], cb = [0, 0];
    for (let i = 0; i < n; i++) {
      ca[0] += a.vertices[i][0]; ca[1] += a.vertices[i][1];
      cb[0] += b.vertices[i][0]; cb[1] += b.vertices[i][1];
    }
    ca[0] /= n; ca[1] /= n; cb[0] /= n; cb[1] /= n;
    let dot = 0, cross = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const ax = a.vertices[i][0] - ca[0], ay = a.vertices[i][1] - ca[1];
      const bx = b.vertices[i][0] - cb[0], by = b.vertices[i][1] - cb[1];
      dot += ax * bx + ay * by;
      cross += ax * by - ay * bx;
      ss += ax * ax + ay * ay;
    }
    const theta = Math.atan2(cross, dot);
    const scale = ss > 1e-9 ? Math.max(0.05, Math.hypot(dot, cross) / ss) : 1;
    const rotU = theta * t;
    const scaleU = Math.pow(scale, t);
    const cosU = Math.cos(rotU) * scaleU;
    const sinU = Math.sin(rotU) * scaleU;
    const cosF = Math.cos(theta) * scale;
    const sinF = Math.sin(theta) * scale;
    const cu = lerp2(ca, cb, t);

    const vertices = new Array(n);
    const inTangents = new Array(n);
    const outTangents = new Array(n);
    for (let i = 0; i < n; i++) {
      const av = a.vertices[i], bv = b.vertices[i];
      const lin = lerp2(av, bv, t);
      const ax = av[0] - ca[0], ay = av[1] - ca[1];
      const bRigidX = cb[0] + (ax * cosF - ay * sinF);
      const bRigidY = cb[1] + (ax * sinF + ay * cosF);
      const rigidX = cu[0] + (ax * cosU - ay * sinU) + (bv[0] - bRigidX) * t;
      const rigidY = cu[1] + (ax * sinU + ay * cosU) + (bv[1] - bRigidY) * t;
      vertices[i] = lerp2(lin, [rigidX, rigidY], bend);
      inTangents[i] = lerp2(a.inTangents[i], b.inTangents[i], t);
      outTangents[i] = lerp2(a.outTangents[i], b.outTangents[i], t);
    }
    return { vertices, inTangents, outTangents, closed: a.closed };
  }

  function drawShapePath(ctx, pathOrList, opts) {
    if (!ctx) return;
    const o = opts && typeof opts === "object" ? opts : {};
    let paths = Array.isArray(pathOrList) ? pathOrList.map(normalizePath) : [normalizePath(pathOrList)];
    if (o.puckerBloat) paths = puckerBloat(paths, o.puckerBloat);
    if (o.roundCorners) paths = roundCorners(paths, o.roundCorners);
    if (o.wigglePaths) paths = wigglePaths(paths, o.wigglePaths, o.t || 0);
    if (o.trim) paths = trimPaths(paths, o.trim);

    ctx.save();
    ctx.beginPath();
    for (let pi = 0; pi < paths.length; pi++) {
      const { cubics, closed } = pathToCubics(paths[pi]);
      if (cubics.length === 0) continue;
      ctx.moveTo(cubics[0][0][0], cubics[0][0][1]);
      for (let i = 0; i < cubics.length; i++) {
        const c = cubics[i];
        ctx.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]);
      }
      if (closed) ctx.closePath();
    }
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.fill(o.fillRule || "nonzero");
    }
    if (o.stroke) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = Number(o.lineWidth) || 3;
      ctx.lineCap = o.lineCap || "round";
      ctx.lineJoin = o.lineJoin || "round";
      ctx.stroke();
    }
    ctx.restore();
    return paths;
  }

  /** After Effects Repeater (`crates/render/src/shapes.rs` L440-503). */
  function repeatDraw(ctx, opts, drawFn) {
    if (!ctx || typeof drawFn !== "function") return 0;
    const o = opts && typeof opts === "object" ? opts : {};
    const copies = Math.max(0, Number(o.copies ?? 3));
    const n = Math.ceil(copies);
    if (n === 0) return 0;
    const offset = Number(o.offset) || 0;
    const anchor = Array.isArray(o.anchor) ? o.anchor : [0, 0];
    const pos = Array.isArray(o.position) ? o.position : [100, 0];
    const scale = Array.isArray(o.scale) ? o.scale : [100, 100];
    const rotDeg = Number(o.rotation) || 0;
    const so = clamp((o.startOpacity !== undefined ? Number(o.startOpacity) : 100) / 100, 0, 1);
    const eo = clamp((o.endOpacity !== undefined ? Number(o.endOpacity) : 100) / 100, 0, 1);
    const above = String(o.composite || "below").toLowerCase() === "above";
    const baseAlpha = ctx.globalAlpha;

    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    if (!above) order.reverse();

    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi];
      const k = i + offset;
      const frac = copies > 0 ? i / copies : 0;
      const opk = so + (eo - so) * frac;
      const partial = i + 1 === n && copies % 1 > 0 ? copies % 1 : 1;
      const alpha = baseAlpha * opk * partial;
      if (alpha <= 1e-4) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pos[0] * k, pos[1] * k);
      ctx.translate(anchor[0], anchor[1]);
      if (Math.abs(rotDeg * k) > 1e-6) ctx.rotate(rotDeg * k * DEG);
      const sx = Math.pow(scale[0] / 100, k);
      const sy = Math.pow(scale[1] / 100, k);
      if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) ctx.scale(sx, sy);
      ctx.translate(-anchor[0], -anchor[1]);
      drawFn(ctx, i, k, alpha);
      ctx.restore();
    }
    return n;
  }

  global.AetheriaShapesText = {
    version: 1,
    TEXT_PRESET_NAMES,
    TEXT_PRESETS,
    evalTextSelector,
    combineSelector,
    drawAnimatedText,
    rectPath,
    ellipsePath,
    polystarPath,
    trimPaths,
    roundCorners,
    puckerBloat,
    wigglePaths,
    morphPath,
    drawShapePath,
    repeatDraw,
  };
})(typeof window !== "undefined" ? window : globalThis);
