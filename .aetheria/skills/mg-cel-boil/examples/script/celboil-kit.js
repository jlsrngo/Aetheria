/**
 * CelBoilKit v2 — Procedural Hand-Drawn 2D Cel Animation & Boil Engine
 * Inspired by references/aetheria-motion/demos/05-cel-boil/
 * Pure deterministic Canvas2D, zero external dependencies, 9:16 & 16:9 adaptive.
 */
(function () {
  'use strict';

  const PAL = {
    paper: '#F4E9D0',
    paperTooth: '#EADFC6',
    cream: '#FFF6E2',
    hi: '#FFF6E2',
    ink: '#1C1613',
    striker: '#332823',
    red: '#E5402B',
    redDark: '#C9311F',
    yel: '#FFC425',
    pencil: '#D9573F',
    onionBlue: '#5A7BB5',
    desk: '#231C18',
    pegMetal: '#4A3F38'
  };

  const REG = { dx: -5, dy: 4 }; // Off-register hand-coloring offset

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, v) => clamp((v - a) / (b - a));
  const sstep = (a, b, v) => { const u = inv(a, b, v); return u * u * (3 - 2 * u); };

  const E = {
    lin: (t) => t,
    in2: (t) => t * t,
    out2: (t) => 1 - (1 - t) * (1 - t),
    out3: (t) => 1 - Math.pow(1 - t, 3),
    io2: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outBack: (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
  };

  function hs(a, b = 0, c = 0, d = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Deterministic smooth value noise 2D/3D (replaces external simplex-noise)
  function N2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hs(ix, iy, 17) * 2 - 1;
    const b = hs(ix + 1, iy, 17) * 2 - 1;
    const c = hs(ix, iy + 1, 17) * 2 - 1;
    const d = hs(ix + 1, iy + 1, 17) * 2 - 1;
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  function N3(x, y, z) {
    const iz = Math.floor(z), fz = z - iz;
    const uz = fz * fz * (3 - 2 * fz);
    return lerp(N2(x + iz * 19.1, y + iz * 7.3), N2(x + (iz + 1) * 19.1, y + (iz + 1) * 7.3), uz);
  }

  // Exposure stepper: 'on-1s' (24fps), 'on-2s' (12fps), 'on-3s' (8fps)
  function getDrawingState(t, exposure, baseNo) {
    const fps = 24;
    const f = Math.max(0, Math.round(t * fps));
    const step = exposure === 'on-1s' ? 1 : exposure === 'on-3s' ? 3 : 2;
    const fq = Math.floor(f / step) * step;
    const id = (baseNo || 1) + Math.floor(f / step);
    const bv = id % 3; // 3-drawing boil cycle for held shapes
    return { f, fq, tq: fq / fps, t1: f / fps, step, id, bv };
  }

  // Geometry helpers
  function spline(pts, closed = false, segs = 6) {
    const n = pts.length;
    if (n < 2) return pts.slice();
    const get = (i) => (closed ? pts[(i + n * 10) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const out = [];
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const sharp = p1[2] ? 1 : 0;
      const m = sharp ? 2 : segs;
      for (let j = 0; j < m; j++) {
        const u = j / m;
        if (sharp) {
          out.push([lerp(p1[0], p2[0], u), lerp(p1[1], p2[1], u)]);
        } else {
          const u2 = u * u, u3 = u2 * u;
          out.push([
            0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
            0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)
          ]);
        }
      }
    }
    if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
    return out;
  }

  function arclen(pts, closed = false) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) {
      L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    if (closed && pts.length > 1) {
      L.push(L[L.length - 1] + Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]));
    }
    return L;
  }

  function resample(pts, step = 4, closed = false) {
    if (pts.length < 2) return pts.slice();
    const src = closed ? [...pts, pts[0]] : pts;
    const L = arclen(src);
    const total = L[L.length - 1];
    if (total < 1e-3) return [pts[0]];
    const n = Math.max(2, Math.round(total / step));
    const out = [];
    let j = 0;
    for (let i = 0; i <= (closed ? n - 1 : n); i++) {
      const s = (i / n) * total;
      while (j < L.length - 2 && L[j + 1] < s) j++;
      const f = (s - L[j]) / Math.max(1e-6, L[j + 1] - L[j]);
      out.push([lerp(src[j][0], src[j + 1][0], f), lerp(src[j][1], src[j + 1][1], f)]);
    }
    return out;
  }

  function dens(pts, perEdge = 10) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      for (let j = 0; j < perEdge; j++) {
        const u = j / perEdge;
        out.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]);
      }
    }
    return out;
  }

  function boil(pts, seed, amp = 1.6, scale = 55) {
    if (amp <= 0) return pts;
    const sx = (seed * 17.3) % 97, sy = (seed * 31.7) % 89;
    return pts.map(([x, y], i) => {
      const dx = N3(x / scale + sx, y / scale + sy, seed * 0.37) * amp
               + N2(i * 0.25 + sx, seed * 1.1) * amp * 0.28;
      const dy = N3(x / scale + sy + 19, y / scale + sx + 47, seed * 0.37 + 11) * amp
               + N2(i * 0.25 + sy + 7, seed * 1.3) * amp * 0.28;
      return [x + dx, y + dy];
    });
  }

  function xf(pts, o) {
    const x = o.x || 0, y = o.y || 0, r = o.r || 0;
    const sx = o.sx !== undefined ? o.sx : 1;
    const sy = o.sy !== undefined ? o.sy : 1;
    const kx = o.kx || 0, ky = o.ky || 0;
    const px = o.px || 0, py = o.py || 0;
    const c = Math.cos(r), s = Math.sin(r);
    return pts.map((p) => {
      let u = (p[0] - px) * sx, v = (p[1] - py) * sy;
      const u2 = u + kx * v, v2 = v + ky * u;
      return [u2 * c - v2 * s + x + px, u2 * s + v2 * c + y + py, p[2]];
    });
  }

  function circlePts(cx, cy, r, n = 40, rx) {
    const a = rx !== undefined ? rx : r;
    const out = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      out.push([cx + Math.cos(th) * a, cy + Math.sin(th) * r]);
    }
    return out;
  }

  function starPts(nSpikes, rOut, rIn, seed = 1, rot = 0, jitter = 0.25) {
    const out = [];
    const m = nSpikes * 2;
    for (let i = 0; i < m; i++) {
      const isOut = i % 2 === 0;
      const j = (hs(seed, i, 1) - 0.5) * jitter;
      const rj = 1 + (hs(seed, i, 2) - 0.5) * jitter * 1.3;
      const th = rot + ((i + j) / m) * Math.PI * 2;
      const r = (isOut ? rOut : rIn) * rj;
      out.push([Math.cos(th) * r, Math.sin(th) * r, 1]);
    }
    return out;
  }

  function polyPath(c, pts, close = true) {
    if (!pts.length) return;
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (close) c.closePath();
  }

  function fillPoly(c, pts, fill) {
    if (!pts || pts.length < 3) return;
    c.beginPath();
    polyPath(c, pts, true);
    c.fillStyle = fill;
    c.fill();
  }

  // Variable-width tapered brush outline polygon
  function outline(pts, widthFn, cap = true) {
    const n = pts.length;
    if (n < 2) return [];
    const L = arclen(pts);
    const total = Math.max(1e-4, L[n - 1]);
    const left = [], right = [], R = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
      let tx = p1[0] - p0[0], ty = p1[1] - p0[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const u = L[i] / total;
      const r = Math.max(0.25, widthFn(u, L[i], total, nx, ny) * 0.5);
      R.push(r);
      left.push([pts[i][0] + nx * r, pts[i][1] + ny * r]);
      right.push([pts[i][0] - nx * r, pts[i][1] - ny * r]);
    }
    const poly = [];
    if (cap && R[0] > 0.8) {
      const p = pts[0], q = pts[1];
      const a0 = Math.atan2(p[1] - q[1], p[0] - q[0]);
      for (let k = -3; k <= 3; k++) {
        const a = a0 + (k / 3) * (Math.PI * 0.5);
        poly.push([p[0] + Math.cos(a) * R[0], p[1] + Math.sin(a) * R[0]]);
      }
    }
    for (let i = 0; i < n; i++) poly.push(left[i]);
    if (cap && R[n - 1] > 0.8) {
      const p = pts[n - 1], q = pts[n - 2];
      const a0 = Math.atan2(p[1] - q[1], p[0] - q[0]);
      for (let k = -3; k <= 3; k++) {
        const a = a0 + (k / 3) * (Math.PI * 0.5);
        poly.push([p[0] + Math.cos(a) * R[n - 1], p[1] + Math.sin(a) * R[n - 1]]);
      }
    }
    for (let i = n - 1; i >= 0; i--) poly.push(right[i]);
    return poly;
  }

  function inkW(o) {
    const w = o.w !== undefined ? o.w : 6;
    const t0 = o.t0 !== undefined ? o.t0 : 10;
    const t1 = o.t1 !== undefined ? o.t1 : 12;
    const min = o.min !== undefined ? o.min : 0.18;
    const jit = o.jit !== undefined ? o.jit : 0.24;
    const heavy = o.heavy !== undefined ? o.heavy : 0.22;
    const seed = o.seed || 1;
    return (u, s, total, nx, ny) => {
      const a = t0 > 0 ? sstep(0, Math.min(t0, total * 0.45), s) : 1;
      const b = t1 > 0 ? sstep(0, Math.min(t1, total * 0.45), total - s) : 1;
      const tap = min + (1 - min) * Math.min(a, b);
      const pr = 1 + jit * N2(s / 38 + seed * 3.1, seed * 0.7);
      const sh = 1 + heavy * (nx * 0.6 + ny * 0.8);
      return w * tap * pr * sh;
    };
  }

  function inkStroke(c, pts, o = {}) {
    if (pts.length < 2) return;
    const step = o.step ?? 3.5;
    const raw = o.dense ? pts : resample(o.curve === false ? pts : spline(pts, false, 5), step);
    const boiled = boil(raw, o.seed || 1, o.amp ?? 1.5, o.scale ?? 50);
    const poly = outline(boiled, o.widthFn || inkW(o), o.cap !== false);
    fillPoly(c, poly, o.color || PAL.ink);
  }

  function inkLoop(c, pts, o = {}) {
    if (pts.length < 3) return;
    const step = o.step ?? 3.8;
    const raw = o.dense ? pts : resample(o.curve === false ? pts : spline(pts, true, 5), step, true);
    const n = raw.length;
    const gap = o.gap ?? 0;
    const start = Math.floor(hs(o.seed || 1, 7) * n);
    const ord = [];
    for (let i = 0; i <= n - gap; i++) ord.push(raw[(start + i) % n]);
    if (gap === 0 && ord.length > 2) ord.push(ord[0], ord[1]);
    const boiled = boil(ord, o.seed || 1, o.amp ?? 1.6, o.scale ?? 55);
    const poly = outline(boiled, inkW({ t0: 5, t1: 7, min: 0.45, ...o }), true);
    fillPoly(c, poly, o.color || PAL.ink);
  }

  // Off-register boiled fill
  function fillShape(c, pts, color, o = {}) {
    const step = o.step ?? 5;
    const raw = o.dense ? pts : resample(o.curve === false ? pts : spline(pts, true, 5), step, true);
    const dx = o.dx ?? REG.dx, dy = o.dy ?? REG.dy;
    const boiled = boil(raw, (o.seed || 1) + 77, o.amp ?? 2.0, o.scale ?? 65).map(([x, y]) => [x + dx, y + dy]);
    fillPoly(c, boiled, color);
  }

  // Diagonal hand-inked hatching clipped to a polygon
  function hatch(c, polyPts, o = {}) {
    const gap = o.gap ?? 11, ang = o.ang ?? -0.85, w = o.w ?? 2.8, seed = o.seed ?? 1;
    const color = o.color ?? PAL.ink, amp = o.amp ?? 1.2, inset = o.inset ?? 3;
    const clip = boil(polyPts, seed + 33, inset, 70);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of clip) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const R = Math.hypot(x1 - x0, y1 - y0) * 0.6 + 20;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const nx = -sa, ny = ca;
    c.save();
    c.beginPath();
    polyPath(c, clip, true);
    c.clip();
    const count = Math.ceil((R * 2) / gap);
    for (let i = -count; i <= count; i++) {
      const d = i * gap + (hs(seed, i) - 0.5) * 2.5;
      const ox = cx + nx * d, oy = cy + ny * d;
      const p0 = [ox - ca * R, oy - sa * R];
      const p1 = [ox + ca * R, oy + sa * R];
      inkStroke(c, [p0, p1], {
        seed: seed * 13 + i,
        w: w * (0.85 + 0.3 * hs(seed, i, 2)),
        t0: 8,
        t1: 8,
        amp,
        curve: false,
        step: 14,
        heavy: 0,
        color
      });
    }
    c.restore();
  }

  // Straight edge with animator corner overshoot
  function edge(c, a, b, o = {}) {
    const over = o.over ?? 7;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const o0 = over * (0.5 + 0.7 * hs(o.seed || 1, 1));
    const o1 = over * (0.5 + 0.7 * hs(o.seed || 1, 2));
    const p0 = [a[0] - ux * o0, a[1] - uy * o0];
    const p1 = [b[0] + ux * o1, b[1] + uy * o1];
    const mid = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5 + (o.sag || 0)];
    inkStroke(c, [p0, mid, p1], { t0: 10, t1: 10, min: 0.25, ...o });
  }

  // 1. Procedural Cel Paper Sheet + Tooth + Acme Peg Bar Holes
  function drawPaperSheet(c, W, H, D, opts = {}) {
    c.fillStyle = PAL.paper;
    c.fillRect(0, 0, W, H);

    // Subtle warm paper grain & boiling ink dust specks
    const v = D.bv;
    c.save();
    for (let i = 0; i < 42; i++) {
      const px = hs(i, v, 101) * W;
      const py = hs(i, v, 102) * H;
      const r = 1.2 + hs(i, v, 103) * 2.4;
      c.fillStyle = i % 3 === 0 ? 'rgba(28,22,19,0.08)' : 'rgba(217,87,63,0.06)';
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
    }
    // Fine horizontal paper fibers
    c.strokeStyle = 'rgba(28,22,19,0.025)';
    c.lineWidth = 1.5;
    for (let k = 0; k < 28; k++) {
      const y = ((k + 0.5) / 28) * H + (hs(k, v, 201) - 0.5) * 14;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y + (hs(k, v, 202) - 0.5) * 8);
      c.stroke();
    }
    c.restore();

    if (opts.hidePegHoles) return;

    // Top Acme Animation Peg-Bar Punch Holes (Round center + 2 horizontal capsules)
    const hy = Math.round(H * 0.042);
    const cx = W * 0.5;
    const span = Math.min(W * 0.34, 340);
    const holes = [
      circlePts(cx, hy, 14, 24),
      capsulePts(cx - span, hy, 46, 12),
      capsulePts(cx + span, hy, 46, 12)
    ];
    holes.forEach((pts, idx) => {
      const q = dens(pts, 3);
      fillShape(c, q, PAL.pegMetal, { seed: 9100 + idx + v, amp: 0.7, dx: -2, dy: 2 });
      inkLoop(c, q, { seed: 9120 + idx + v, w: 3.2, amp: 0.8, t0: 3, t1: 5 });
    });
  }

  function capsulePts(cx, cy, hw, hr) {
    const P = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI;
      P.push([cx + hw + Math.cos(a) * hr, cy + Math.sin(a) * hr]);
    }
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI;
      P.push([cx - hw + Math.cos(a) * hr, cy + Math.sin(a) * hr]);
    }
    return P;
  }

  // 2. Stepped Cel Light Pool (Multiply glow on paper)
  function drawLightPool(c, cx, cy, R, D) {
    if (R <= 10) return;
    const fv = D.bv;
    const rFlicker = R * (1 + 0.035 * (fv - 1));
    const scal = (rad, n, ph) => {
      const P = [];
      for (let i = 0; i < 84; i++) {
        const a = (i / 84) * Math.PI * 2;
        const q = Math.abs(Math.sin((a * n) / 2 + ph));
        const rr = rad * (0.97 + 0.04 * Math.sqrt(q));
        P.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      return P;
    };
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.globalAlpha = 0.72;
    fillShape(c, scal(rFlicker * 1.24, 20, fv * 0.7), '#FFF7DF', { seed: 8100 + fv, amp: 3.5, scale: 80, dx: 0, dy: 0 });
    fillShape(c, scal(rFlicker, 16, 1 + fv * 0.9), '#FFEBA8', { seed: 8200 + fv, amp: 3.5, scale: 80, dx: 0, dy: 0 });
    c.restore();
  }

  // 3. 3D Foreshortened Matchbox with Hatched Cast Shadow, Striker Grit & Overshot Edges
  function drawMatchbox(c, cx, cy, scale, D, state = {}) {
    const v = D.bv;
    const sq = state.squash || 1;
    const tilt = state.tilt || 0;
    const sx = scale / Math.pow(sq, 0.7);
    const sy = scale * sq;

    const T = (pts) => xf(pts, { x: cx, y: cy, r: tilt, sx, sy });

    const y0 = -205, y1 = -90, y2 = 90;
    const TL = [-295, y0], TR = [295, y0];
    const FL = [-350, y1], FR = [350, y1];
    const BL = [-342, y2], BR = [342, y2];
    const RBL = [368, -62], RBR = [362, 54];

    const topF = T([TL, TR, FR, FL]);
    const frontF = T([FL, FR, BR, BL]);
    const rightF = T([TR, RBL, RBR, BR, FR]);

    // Hatched cast shadow on the paper table
    const shPoly = T([[BL[0] - 16, BL[1] - 4], [BR[0] + 10, BR[1]], [RBR[0] + 35, RBR[1] + 10], [BR[0] + 42, BR[1] + 54], [BL[0] + 24, BL[1] + 52]]);
    hatch(c, shPoly, { seed: 91 + v, gap: 10 * scale, ang: -0.9, w: 2.8 * scale, amp: 1.2 });

    // Off-register gouache fills
    fillShape(c, dens(rightF, 6), PAL.striker, { seed: 10 + v, amp: 1.8 * scale, curve: false });
    fillShape(c, dens(frontF, 8), PAL.striker, { seed: 11 + v, amp: 2.0 * scale, curve: false });
    fillShape(c, dens(topF, 8), PAL.red, { seed: 12 + v, amp: 2.0 * scale, curve: false });

    // Diagonal hatching on the right side face
    hatch(c, rightF, { seed: 92 + v, gap: 9 * scale, ang: 0.72, w: 2.6 * scale, amp: 1 });

    // Top matchbox cream label border + small corner flame emblem
    const iTL = [-240, y0 + 20], iTR = [240, y0 + 20], iFR = [282, y1 - 22], iFL = [-282, y1 - 22];
    inkLoop(c, T(dens([iTL, iTR, iFR, iFL], 6)), {
      seed: 13 + v,
      w: 3.4 * scale,
      color: PAL.cream,
      amp: 1.1 * scale,
      curve: false,
      gap: 4
    });

    // Little corner flame emblem on top label
    const mFl = T([
      [-236, y1 - 34], [-244, y1 - 46], [-232, y1 - 58], [-218, y1 - 72],
      [-208, y1 - 56], [-200, y1 - 44], [-212, y1 - 34]
    ]);
    fillShape(c, mFl, PAL.yel, { seed: 14 + v, amp: 0.8 * scale, dx: -2, dy: 2 });

    // Striker strip: sunny yellow border + dark striker rectangle + cream grit specks + scratch line
    const sY0 = y1 + 30, sY1 = y2 - 30;
    const strip = T([[-296, sY0], [296, sY0], [290, sY1], [-290, sY1]]);
    const pad = T([[-314, sY0 - 11], [314, sY0 - 11], [308, sY1 + 11], [-308, sY1 + 11]]);
    fillShape(c, dens(pad, 6), PAL.yel, { seed: 15 + v, amp: 1.6 * scale, curve: false });
    fillShape(c, dens(strip, 6), PAL.striker, { seed: 16 + v, amp: 1.4 * scale, curve: false });
    inkLoop(c, dens(strip, 6), { seed: 17 + v, w: 3.8 * scale, amp: 1.2 * scale, curve: false });

    // Cream friction grit dots on the striker
    for (let i = 0; i < 30; i++) {
      const gx = lerp(-265, 265, hs(i, 1)), gy = lerp(sY0 + 10, sY1 - 10, hs(i, 2));
      const [px, py] = T([[gx, gy]])[0];
      const gr = (2.2 + 2.0 * hs(i, 3)) * scale;
      fillPoly(c, boil(circlePts(px, py, gr, 7), 500 + i + v * 41, 0.7 * scale, 18), PAL.cream);
    }

    // Strike scratch across the striker strip
    if (state.scratchProgress > 0) {
      const u = clamp(state.scratchProgress);
      const sx1 = lerp(-230, 260, u), sy1 = lerp(sY0 + 28, sY0 + 18, u);
      const scPts = T([[-230, sY0 + 28], [lerp(-230, sx1, 0.5), sy1 + 5], [sx1, sy1]]);
      inkStroke(c, scPts, {
        seed: 78 + v,
        w: 6.5 * scale,
        t0: 8,
        t1: 16,
        color: PAL.yel,
        amp: 1.2 * scale,
        heavy: 0
      });
    }

    // Hand-inked structural edges with corner overshoot
    const [pTL, pTR, pFR, pFL, pBL, pBR, pRBL, pRBR] = T([TL, TR, FR, FL, BL, BR, RBL, RBR]);
    const eo = (sd, wMul = 1, sag = 0) => ({
      seed: 20 + sd + v * 17,
      w: 6.8 * scale * wMul,
      amp: 1.5 * scale,
      over: 8 * scale,
      sag: sag * scale
    });
    edge(c, pTL, pTR, eo(1, 0.9, 2));
    edge(c, pTL, pFL, eo(2, 0.95));
    edge(c, pTR, pFR, eo(3, 1.0));
    edge(c, pFL, pFR, eo(4, 1.15, 2.5));
    edge(c, pFL, pBL, eo(5, 1.05));
    edge(c, pFR, pBR, eo(6, 1.1));
    edge(c, pBL, pBR, eo(7, 1.25, 2));
    edge(c, pTR, pRBL, eo(8, 0.85));
    edge(c, pRBL, pRBR, eo(9, 0.95));
    edge(c, pBR, pRBR, eo(10, 1.05));

    return { topY: cy + y1 * sy };
  }

  // 4. Matchstick + Strike Smear / Multiples + Teardrop Sparks
  function drawMatchstick(c, hx, hy, angle, scale, D, opts = {}) {
    const v = D.bv;
    const L = 240 * scale;
    const w0 = 10 * scale, w1 = 12.5 * scale;
    const stickLocal = [
      [-w0, 18 * scale, 1],
      [-w1, L, 1],
      [w1, L, 1],
      [w0, 18 * scale, 1]
    ];

    // If smear frame is active, draw classic animation multiples & speed lines first
    if (opts.smearFrom) {
      const [sx0, sy0, sa0] = opts.smearFrom;
      for (let g = 1; g <= 3; g++) {
        const u = g / 4;
        const gx = lerp(sx0, hx, u), gy = lerp(sy0, hy, u), ga = lerp(sa0, angle, u);
        const gStick = xf(dens(stickLocal, 4), { x: gx, y: gy, r: ga });
        c.save();
        c.globalAlpha = 0.28 + 0.12 * u;
        fillShape(c, gStick, PAL.cream, { seed: 210 + g + D.id, amp: 1.5 * scale });
        inkLoop(c, gStick, { seed: 220 + g + D.id, w: 3.5 * scale, amp: 1.4 * scale, gap: 8 });
        const gHead = xf(circlePts(0, -2 * scale, 25 * scale, 20, 21 * scale), { x: gx, y: gy, r: ga });
        fillShape(c, gHead, PAL.red, { seed: 230 + g + D.id, amp: 1.5 * scale });
        c.restore();
      }
      // Dry-brush speed lines along the strike vector
      for (let k = 0; k < 5; k++) {
        const offY = (k - 2) * 18 * scale;
        const p0 = [sx0 - 30 * scale, sy0 + offY];
        const p1 = [hx - 15 * scale, hy + offY * 0.7];
        inkStroke(c, [p0, p1], {
          seed: 260 + k + D.id,
          w: (4.5 - Math.abs(k - 2) * 0.8) * scale,
          t0: 25,
          t1: 8,
          amp: 1.2 * scale,
          color: k % 2 === 0 ? PAL.yel : PAL.ink
        });
      }
    }

    // Main matchstick shaft
    const stick = xf(dens(stickLocal, 6), { x: hx, y: hy, r: angle });
    fillShape(c, stick, PAL.cream, { seed: 200 + v, amp: 1.4 * scale });
    const cns = xf(stickLocal, { x: hx, y: hy, r: angle });
    inkStroke(c, [cns[0], cns[1]], { seed: 201 + v, w: 5.2 * scale, amp: 1.2 * scale });
    inkStroke(c, [cns[3], cns[2]], { seed: 202 + v, w: 5.8 * scale, amp: 1.2 * scale });
    inkStroke(c, [cns[1], cns[2]], { seed: 203 + v, w: 5.2 * scale, amp: 1.0 * scale });

    // Wood grain lines
    const g1 = xf([[-2 * scale, 65 * scale], [-3 * scale, 165 * scale]], { x: hx, y: hy, r: angle });
    inkStroke(c, g1, { seed: 204 + v, w: 2.4 * scale, t0: 14, t1: 14, amp: 1.0 * scale, heavy: 0 });

    // Bulbous red match head (or burnt ink-charcoal head with glowing ember)
    const headPts = xf(circlePts(0, -2 * scale, 28 * scale, 26, 23 * scale), { x: hx, y: hy, r: angle });
    fillShape(c, headPts, opts.burnt ? PAL.ink : PAL.red, { seed: 300 + v, amp: 1.6 * scale });
    inkLoop(c, headPts, { seed: 301 + v, w: 5.8 * scale, amp: 1.5 * scale });

    const hiPts = xf([[-9 * scale, -14 * scale], [-5 * scale, -2 * scale]], { x: hx, y: hy, r: angle });
    inkStroke(c, hiPts, {
      seed: 302 + v,
      w: 5.2 * scale,
      t0: 3,
      t1: 6,
      color: opts.burnt ? PAL.red : PAL.hi,
      amp: 0.8 * scale,
      heavy: 0
    });
  }

  function drawSpark(c, x, y, vx, vy, size, seed, inkOnly = false) {
    const a = Math.atan2(vy, vx);
    const L = Math.min(size * 3.6, Math.max(size * 1.5, Math.hypot(vx, vy) * 0.032));
    const raw = [[-L, 0, 1], [-size * 0.3, -size * 0.55], [size * 0.65, 0], [-size * 0.3, size * 0.55]];
    const P = xf(spline(raw, true, 4), { x, y, r: a });
    if (!inkOnly) fillShape(c, P, PAL.yel, { seed: seed + 1, amp: 1.0, dx: REG.dx * 0.5, dy: REG.dy * 0.5 });
    inkLoop(c, P, { seed, w: Math.max(2.4, size * 0.28), amp: 1.0, t0: 3, t1: 5 });
  }

  function drawTwinkle(c, x, y, r, seed, o = {}) {
    if (r < 2) return;
    const rot = o.rot ?? 0;
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : r * 0.25;
      pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad, i % 2 === 0 ? 1 : 0]);
    }
    const S = spline(pts, true, 4);
    fillShape(c, S, o.fill ?? PAL.yel, { seed: seed + 1, amp: 1.0, dx: REG.dx * 0.5, dy: REG.dy * 0.5 });
    inkLoop(c, S, { seed, w: o.w ?? 3.5, amp: 1.0, t0: 3, t1: 5 });
  }

  // 5. Expressive Hand-Drawn Flame Spirit Character (Outer red + inner yellow + cartoon gloves + face)
  function flameControl(H, W, lean, curl, seed, wild = 0.25) {
    const j = (k, a) => (hs(seed, k) - 0.5) * 2 * a * wild;
    return [
      [0, 0],
      [W * (0.44 + j(1, 0.1)), -H * (0.06 + j(2, 0.04))],
      [W * (0.58 + j(3, 0.14)) + lean * 0.2, -H * (0.30 + j(4, 0.05))],
      [W * (0.42 + j(5, 0.16)) + lean * 0.55, -H * (0.62 + j(6, 0.06))],
      [W * (0.18 + j(7, 0.14)) + lean * 0.85 + curl * 0.5, -H * (0.85 + j(8, 0.05))],
      [lean + curl + j(9, 0.12) * W, -H * (1.03 + j(10, 0.08)), 1],
      [-W * (0.20 + j(11, 0.14)) + lean * 0.8 + curl * 0.4, -H * (0.82 + j(12, 0.05))],
      [-W * (0.44 + j(13, 0.16)) + lean * 0.5, -H * (0.58 + j(14, 0.06))],
      [-W * (0.58 + j(15, 0.14)) + lean * 0.18, -H * (0.28 + j(16, 0.05))],
      [-W * (0.44 + j(17, 0.1)), -H * (0.06 + j(18, 0.04))]
    ];
  }

  function drawSpirit(c, s, D, tq) {
    if (!s || s.H < 8) return;
    const H = s.H;
    const W = (s.W ?? H * 0.76) * (s.spinW ?? 1);
    const seed = (s.seed ?? 500) + D.id * 13;
    const outerCtrl = flameControl(H, W, (s.lean || 0) * H, (s.curl || 0) * H, seed, s.wild ?? 0.22);
    const innerCtrl = flameControl(
      H * 0.68,
      W * 0.62,
      (s.lean || 0) * H * 0.65,
      (s.curl || 0) * H * 0.7,
      seed + 7,
      (s.wild ?? 0.22) * 0.85
    ).map(([x, y, cr]) => [x, y - H * 0.05, cr]);

    const T = (pts) => xf(pts, { x: s.x, y: s.y, r: s.r || 0, sx: s.sx ?? 1, sy: s.sy ?? 1, kx: s.kx || 0 });
    const outer = T(spline(outerCtrl, true, 6));
    const inner = T(spline(innerCtrl, true, 6));

    // Detached rising fire droplets near the tip
    if (s.drops !== false) {
      for (let k = 0; k < 2; k++) {
        const ph = ((tq * 3.4 + k * 0.53) % 1);
        const dr = H * 0.075 * (1 - ph * 0.72);
        if (dr > 3) {
          const tip = outerCtrl[5];
          const dx = tip[0] + (k ? -1 : 1) * W * 0.2 * (0.4 + ph) + (hs(D.id, k) - 0.5) * 14;
          const dy = tip[1] - ph * H * 0.34;
          const dp = T(circlePts(dx, dy, dr, 14, dr * 0.75));
          fillShape(c, dp, k === 0 ? PAL.red : PAL.yel, { seed: seed + 90 + k, amp: 1.2 });
          inkLoop(c, dp, { seed: seed + 95 + k, w: 3.8, amp: 1.2, t0: 4, t1: 4 });
        }
      }
    }

    // Off-register boiled red outer body + yellow inner core
    fillShape(c, outer, PAL.red, { seed, amp: 2.2 });
    fillShape(c, inner, PAL.yel, { seed: seed + 3, amp: 1.8, dx: REG.dx * 0.7, dy: REG.dy * 0.7 });

    // Hot paper-white specular glint inside core
    const coreGlint = T(circlePts((s.lean || 0) * H * 0.12 - W * 0.09, -H * 0.32, H * 0.11, 16, W * 0.1));
    fillShape(c, coreGlint, PAL.hi, { seed: seed + 5, amp: 1.4, dx: -2, dy: 2 });

    // Boiled brush outline around the spirit
    inkLoop(c, outer, { seed: seed + 1, w: s.inkW ?? 7.2, amp: 2.0, heavy: 0.35, t0: 10, t1: 12 });

    // Rubber-hose arms with big paper-white cartoon gloves (2 finger lines!)
    if (s.arms) {
      const aT = (pts) => xf(pts, {
        x: s.x,
        y: s.y,
        r: s.r || 0,
        sx: ((s.sx ?? 1) + 1) * 0.5,
        sy: ((s.sy ?? 1) + 1) * 0.5,
        kx: s.kx || 0
      });
      for (const side of [-1, 1]) {
        const a = side < 0 ? s.arms.L : s.arms.R;
        if (!a) continue;
        const sh = [side * W * 0.42, -H * 0.36];
        const len = (a.len ?? 0.44) * H;
        const ang = a.ang ?? 0.5;
        const bend = a.bend ?? 0.3;
        const dx = side * Math.cos(ang), dy = -Math.sin(ang);
        const hand = [sh[0] + dx * len, sh[1] + dy * len];
        const elbow = [
          (sh[0] + hand[0]) * 0.5 - dy * len * 0.25 * bend * side,
          (sh[1] + hand[1]) * 0.5 + dx * len * 0.25 * bend * side
        ];
        const armCurve = aT([sh, elbow, hand]);
        inkStroke(c, armCurve, {
          seed: seed + (side < 0 ? 31 : 32),
          w: Math.max(5.5, H * 0.046),
          t0: 4,
          t1: 4,
          min: 0.85,
          amp: 1.3,
          heavy: 0
        });

        // Big white cartoon glove
        const gR = H * 0.088 * (a.big ?? 1.05);
        const hp = armCurve[2];
        const ha = Math.atan2(hp[1] - armCurve[1][1], hp[0] - armCurve[1][0]);
        const glove = xf(circlePts(0, 0, gR, 20, gR * 1.18), { x: hp[0], y: hp[1], r: ha });
        fillShape(c, glove, PAL.hi, { seed: seed + (side < 0 ? 33 : 34), amp: 1.1, dx: -3, dy: 2.5 });
        inkLoop(c, glove, { seed: seed + (side < 0 ? 35 : 36), w: 4.5, amp: 1.1, t0: 3, t1: 5 });

        // Two ink finger creases on the glove
        for (const fk of [-0.34, 0.24]) {
          const f0 = xf([[gR * 0.2, fk * gR]], { x: hp[0], y: hp[1], r: ha })[0];
          const f1 = xf([[gR * 0.78, fk * gR * 1.06]], { x: hp[0], y: hp[1], r: ha })[0];
          inkStroke(c, [f0, f1], {
            seed: seed + (side < 0 ? 130 : 140) + Math.round(fk * 10),
            w: 2.6,
            t0: 2,
            t1: 3,
            amp: 0.6,
            heavy: 0
          });
        }
      }
    }

    // Expressive Cartoon Face
    if (s.face) {
      const f = s.face;
      const fx = (f.fx ?? 0) * W + (s.lean || 0) * H * 0.22;
      const fy = (f.fy ?? -0.35) * H;
      const sep = W * 0.175;
      const er = H * 0.044 * (f.pop ?? 1);

      for (const side of [-1, 1]) {
        const ex = fx + side * sep + (f.look ?? 0) * W * 0.06;
        const ey = fy;
        const mode = f.eyes === 'wink' && side > 0 ? 'happy' : (f.eyes || 'open');

        if (mode === 'open' || mode === 'fierce') {
          const ep = T(circlePts(ex, ey, er * 1.15, 16, er));
          fillPoly(c, boil(ep, seed + 40 + side, 0.8, 30), PAL.ink);
          const gl = T(circlePts(ex - er * 0.28, ey - er * 0.32, er * 0.38, 10));
          fillPoly(c, gl, PAL.hi);
          if (mode === 'fierce') {
            const br = T([
              [ex - side * er * 1.25, ey - er * 1.45],
              [ex + side * er * 1.15, ey - er * 0.65]
            ]);
            inkStroke(c, br, { seed: seed + 45 + side, w: 4.5, t0: 3, t1: 4, amp: 0.8, heavy: 0 });
          }
        } else if (mode === 'happy') {
          const arc = T([
            [ex - er * 1.15, ey + er * 0.2],
            [ex, ey - er * 0.95],
            [ex + er * 1.15, ey + er * 0.2]
          ]);
          inkStroke(c, arc, { seed: seed + 41 + side, w: 5.0, t0: 4, t1: 4, amp: 0.7, heavy: 0 });
        } else if (mode === 'squeeze') {
          const sqPts = T([
            [ex - side * er * 1.1, ey - er * 0.75],
            [ex + side * er * 0.9, ey, 1],
            [ex - side * er * 1.1, ey + er * 0.75]
          ]);
          inkStroke(c, sqPts, { seed: seed + 43 + side, w: 4.8, t0: 4, t1: 4, amp: 0.7, heavy: 0 });
        }
      }

      // Rosy cheeks
      if (f.cheeks !== false) {
        for (const side of [-1, 1]) {
          const ch = T(circlePts(fx + side * sep * 1.48, fy + H * 0.055, er * 0.75, 12, er * 1.05));
          fillShape(c, ch, PAL.red, { seed: seed + 60 + side, amp: 0.8, dx: 0, dy: 0 });
        }
      }

      // Mouth
      const my = fy + H * 0.1;
      const mw = W * 0.15;
      const mMode = f.mouth || 'smile';
      if (mMode === 'open' || mMode === 'grin') {
        const mp = T([
          [fx - mw, my - H * 0.01, 1],
          [fx, my - H * 0.005],
          [fx + mw, my - H * 0.01, 1],
          [fx + mw * 0.78, my + H * 0.075],
          [fx, my + H * 0.095],
          [fx - mw * 0.78, my + H * 0.075]
        ]);
        fillShape(c, mp, PAL.ink, { seed: seed + 51, amp: 0.8, dx: 0, dy: 0 });
        const tg = T(circlePts(fx, my + H * 0.065, H * 0.028, 12, mw * 0.52));
        fillShape(c, tg, PAL.red, { seed: seed + 52, amp: 0.7, dx: 0, dy: 0 });
      } else {
        const sm = T([
          [fx - mw * 0.85, my],
          [fx, my + H * 0.048],
          [fx + mw * 0.85, my]
        ]);
        inkStroke(c, sm, { seed: seed + 50, w: 4.5, t0: 4, t1: 4, amp: 0.7, heavy: 0 });
      }
    }
  }

  // 6. Boiled Cloud Puffs & Scalloped Fire Badge
  function drawPuff(c, x, y, r, seed, o = {}) {
    if (r < 2) return;
    const n = o.n ?? 4;
    const cs = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hs(seed, i) * 1.1;
      const d = i === 0 ? 0 : r * 0.52;
      cs.push({
        x: x + Math.cos(a) * d * (o.wide ?? 1),
        y: y + Math.sin(a) * d * 0.72 * (o.flat ?? 1),
        r: r * (i === 0 ? 0.82 : 0.48 + 0.25 * hs(seed, i, 2))
      });
    }
    const fill = o.fill ?? PAL.hi;
    const w = o.w ?? Math.max(3, r * 0.09);
    // Off-register fill first
    cs.forEach((q, k) => {
      fillShape(c, circlePts(q.x, q.y, q.r, 18), fill, {
        seed: seed + k * 7 + 3,
        amp: 1.5,
        dx: REG.dx * 0.7,
        dy: REG.dy * 0.7
      });
    });
    // Outer boiled ink outline arcs
    cs.forEach((q, k) => {
      if (k === 0 && n > 1) return;
      const a0 = Math.atan2(q.y - y, q.x - x);
      const arc = [];
      for (let j = 0; j <= 12; j++) {
        const th = a0 - 1.85 + (j / 12) * 3.7;
        arc.push([q.x + Math.cos(th) * q.r, q.y + Math.sin(th) * q.r]);
      }
      inkStroke(c, arc, { seed: seed + k * 11, w, t0: 6, t1: 6, amp: 1.4, heavy: 0.25 });
    });
  }

  function drawScallopedBadge(c, cx, cy, rx, ry, D, morph = 1) {
    const v = D.bv;
    const N = 20;
    const scallops = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const bx = cx + Math.cos(a) * rx * morph;
      const by = cy + Math.sin(a) * ry * morph;
      const br = ((k % 2 ? 42 : 52) + 8 * hs(k, 6)) * (rx / 320) * morph;
      scallops.push({ x: bx, y: by, r: br, a });
    }

    // Off-register tomato red fill of core + scallops
    fillShape(c, circlePts(cx, cy, ry * morph, 48, rx * morph), PAL.red, {
      seed: 1200 + v * 31,
      amp: 2.4,
      dx: REG.dx,
      dy: REG.dy
    });
    scallops.forEach((q, k) => {
      fillShape(c, circlePts(q.x, q.y, q.r, 18), PAL.red, {
        seed: 1220 + k * 7 + v * 19,
        amp: 2.0,
        dx: REG.dx,
        dy: REG.dy
      });
    });

    // Outer scalloped ink perimeter
    const perim = [];
    scallops.forEach((q) => {
      for (let j = -5; j <= 5; j++) {
        const th = q.a + (j / 5) * 1.18;
        perim.push([q.x + Math.cos(th) * q.r, q.y + Math.sin(th) * q.r]);
      }
    });
    inkLoop(c, perim, {
      seed: 1290 + v * 23,
      w: 7.5 * (rx / 320),
      amp: 2.0,
      dense: true,
      heavy: 0.35
    });

    // Inner boiling fire lumps & C-curls
    const lumps = [
      [-rx * 0.62, 0, 32 * (rx / 320)],
      [rx * 0.64, -ry * 0.22, 28 * (rx / 320)],
      [rx * 0.58, ry * 0.32, 24 * (rx / 320)]
    ];
    lumps.forEach(([ox, oy, lr], k) => {
      const lx = cx + ox + 4 * Math.sin(D.id * 0.8 + k);
      const ly = cy + oy + 3 * Math.cos(D.id * 0.9 + k);
      fillShape(c, circlePts(lx, ly, lr, 18), PAL.redDark, { seed: 1370 + k * 5 + v, amp: 2.2, dx: -2, dy: 2 });
      fillShape(c, circlePts(lx - lr * 0.25, ly - lr * 0.25, lr * 0.45, 14), PAL.yel, { seed: 1380 + k * 5 + v, amp: 1.4, dx: -2, dy: 2 });
      const curl = [];
      for (let i = 0; i <= 10; i++) {
        const aa = k * 1.7 + (i / 10) * 3.4;
        curl.push([lx + Math.cos(aa) * lr * 0.85, ly + Math.sin(aa) * lr * 0.85]);
      }
      inkStroke(c, curl, { seed: 1390 + k * 5 + v, w: 4.2, t0: 5, t1: 12, amp: 1.0, heavy: 0 });
    });
  }

  // 7. Hand-Lettered Boiled Vector Brush Alphabet (Zero system font dependency for hero titles)
  const GLYPHS = {
    A: { w: 0.7, s: [[[0, 1], [0.35, 0, 1], [0.7, 1]], [[0.14, 0.64], [0.56, 0.62]]] },
    B: { w: 0.62, s: [[[0, 0], [0, 1]], [[0, 0, 1], [0.42, 0.02], [0.58, 0.24], [0.4, 0.46], [0, 0.48, 1]], [[0, 0.48, 1], [0.48, 0.52], [0.62, 0.76], [0.42, 0.98], [0, 1, 1]]] },
    C: { w: 0.64, s: [[[0.62, 0.16], [0.34, 0], [0.06, 0.22], [0, 0.5], [0.08, 0.82], [0.36, 1], [0.64, 0.84]]] },
    D: { w: 0.64, s: [[[0, 0], [0, 1]], [[0, 0, 1], [0.38, 0.03], [0.62, 0.28], [0.62, 0.72], [0.36, 0.98], [0, 1, 1]]] },
    E: { w: 0.56, s: [[[0.56, 0], [0, 0, 1], [0, 1, 1], [0.58, 1]], [[0, 0.5], [0.46, 0.48]]] },
    F: { w: 0.54, s: [[[0.56, 0], [0, 0, 1], [0, 1]], [[0, 0.5], [0.44, 0.48]]] },
    G: { w: 0.66, s: [[[0.62, 0.16], [0.34, 0], [0.04, 0.24], [0, 0.52], [0.08, 0.84], [0.38, 1], [0.64, 0.82], [0.64, 0.52, 1], [0.36, 0.52]]] },
    H: { w: 0.64, s: [[[0, 0], [0, 1]], [[0.64, 0], [0.64, 1]], [[0, 0.5], [0.64, 0.48]]] },
    I: { w: 0.28, s: [[[0.14, 0], [0.14, 1]], [[0, 0], [0.28, 0]], [[0, 1], [0.28, 1]]] },
    J: { w: 0.54, s: [[[0.48, 0], [0.48, 0.74], [0.28, 1], [0.04, 0.82]]] },
    K: { w: 0.64, s: [[[0, 0], [0, 1]], [[0.62, 0], [0.04, 0.52, 1], [0.64, 1]]] },
    L: { w: 0.54, s: [[[0, 0], [0, 1, 1], [0.54, 1]]] },
    M: { w: 0.82, s: [[[0, 1], [0.04, 0, 1], [0.41, 0.68, 1], [0.78, 0, 1], [0.82, 1]]] },
    N: { w: 0.64, s: [[[0, 1], [0, 0, 1], [0.64, 1, 1], [0.64, 0]]] },
    O: { w: 0.68, s: [[[0.34, 0], [0.04, 0.22], [0, 0.52], [0.06, 0.82], [0.34, 1], [0.62, 0.82], [0.68, 0.5], [0.62, 0.2], [0.34, 0]]] },
    P: { w: 0.6, s: [[[0, 1], [0, 0]], [[0, 0, 1], [0.38, 0.02], [0.58, 0.22], [0.48, 0.46], [0, 0.5, 1]]] },
    Q: { w: 0.68, s: [[[0.34, 0], [0.04, 0.22], [0, 0.52], [0.06, 0.82], [0.34, 1], [0.62, 0.82], [0.68, 0.5], [0.62, 0.2], [0.34, 0]], [[0.42, 0.72], [0.7, 1.04]]] },
    R: { w: 0.62, s: [[[0, 1], [0, 0]], [[0, 0, 1], [0.38, 0.02], [0.58, 0.22], [0.48, 0.46], [0, 0.5, 1]], [[0.28, 0.5], [0.62, 1]]] },
    S: { w: 0.6, s: [[[0.56, 0.14], [0.3, 0], [0.04, 0.18], [0.12, 0.44], [0.5, 0.56], [0.58, 0.82], [0.3, 1], [0.02, 0.86]]] },
    T: { w: 0.62, s: [[[0, 0], [0.62, 0]], [[0.31, 0], [0.31, 1]]] },
    U: { w: 0.64, s: [[[0, 0], [0.02, 0.74], [0.32, 1], [0.62, 0.74], [0.64, 0]]] },
    V: { w: 0.66, s: [[[0, 0], [0.33, 1, 1], [0.66, 0]]] },
    W: { w: 0.86, s: [[[0, 0], [0.2, 1, 1], [0.43, 0.36, 1], [0.66, 1, 1], [0.86, 0]]] },
    X: { w: 0.64, s: [[[0, 0], [0.64, 1]], [[0.64, 0], [0, 1]]] },
    Y: { w: 0.64, s: [[[0, 0], [0.32, 0.5, 1], [0.64, 0]], [[0.32, 0.5], [0.32, 1]]] },
    Z: { w: 0.6, s: [[[0, 0], [0.6, 0, 1], [0, 1, 1], [0.6, 1]]] },
    '!': { w: 0.22, s: [[[0.11, 0], [0.11, 0.72]], [[0.11, 0.92], [0.11, 1]]] },
    '&': { w: 0.66, s: [[[0.62, 0.98], [0.12, 0.36], [0.28, 0.04], [0.48, 0.2], [0.06, 0.72], [0.32, 0.98], [0.64, 0.68]]] },
    '-': { w: 0.42, s: [[[0.04, 0.5], [0.38, 0.5]]] }
  };

  function drawBoiledWord(c, text, cx, cy, h, D, o = {}) {
    if (!text) return;
    const str = String(text).toUpperCase();
    const track = o.track ?? 0.28;
    let x = 0;
    const chars = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === ' ') {
        x += h * 0.48;
        continue;
      }
      const g = GLYPHS[ch] || GLYPHS.O;
      chars.push({ ch, x, g, i });
      x += (g.w + track) * h;
    }
    const totalW = Math.max(0, x - track * h);
    const xStart = cx - totalW * 0.5;
    const strokes = [];

    for (const item of chars) {
      const pop = o.pop ? o.pop(item.i) : 1;
      if (pop <= 0) continue;
      const bounce = Math.sin(item.i * 2.1 + D.bv * 0.8) * h * 0.04;
      const rot = (hs(item.i, 77) - 0.5) * 0.09;
      for (let k = 0; k < item.g.s.length; k++) {
        const S = item.g.s[k];
        const P = xf(
          S.map(([u, v, cr]) => [(u - item.g.w * 0.5) * h, (v - 0.5) * h, cr]),
          {
            x: xStart + item.x + item.g.w * h * 0.5,
            y: cy + bounce,
            r: rot,
            sx: pop,
            sy: pop
          }
        );
        strokes.push({
          P,
          st: {
            seed: 8000 + item.i * 17 + k * 3 + D.bv * 101,
            w: h * (o.wk ?? 0.17),
            t0: 5,
            t1: 5,
            min: 0.72,
            jit: 0.16,
            heavy: 0.15,
            amp: o.amp ?? 1.4,
            step: 3
          }
        });
      }
    }

    const ow = (o.outline ?? 4.5) * 2;
    const sh = o.shadow ?? 7;

    // 1. Solid ink block drop shadow
    if (sh > 0) {
      strokes.forEach(({ P, st }) => {
        inkStroke(
          c,
          P.map(([px, py, cr]) => [px + sh, py + sh * 1.15, cr]),
          { ...st, w: st.w + ow, color: PAL.ink }
        );
      });
    }
    // 2. Off-register color underfill
    if (o.underFill) {
      strokes.forEach(({ P, st }) => {
        inkStroke(
          c,
          P.map(([px, py, cr]) => [px + REG.dx * 1.1, py + REG.dy * 1.1, cr]),
          { ...st, w: st.w + ow * 0.7, color: o.underFill, seed: st.seed + 55 }
        );
      });
    }
    // 3. Boiled ink casing
    strokes.forEach(({ P, st }) => {
      inkStroke(c, P, { ...st, w: st.w + ow, color: PAL.ink });
    });
    // 4. Main letter fill stroke
    strokes.forEach(({ P, st }) => {
      inkStroke(c, P, { ...st, color: o.color ?? PAL.yel });
    });
  }

  // 8. Red Col-Erase Animator Construction Arcs & Exposure Sheet Corner Annotations
  function drawColEraseArc(c, pts, D, seed = 8400) {
    if (pts.length < 2) return;
    const dense = resample(spline(pts, false, 5), 22);
    c.save();
    c.globalAlpha = 0.82;
    for (let i = 0; i < dense.length; i++) {
      const [x, y] = dense[i];
      const r = 2.6 + 0.8 * hs(i, seed);
      fillShape(c, circlePts(x, y, r, 8), PAL.pencil, {
        seed: seed + i * 3 + D.bv,
        amp: 0.4,
        dx: 0,
        dy: 0
      });
    }
    c.restore();
  }

  function drawExposureSlate(c, safe, shot, D, microstockMode) {
    if (microstockMode) return;
    const v = D.bv;
    const jx = (hs(D.id, 71) - 0.5) * 1.5;
    const jy = (hs(D.id, 72) - 0.5) * 1.5;
    const expLabel = shot.exposure === 'on-1s' ? 'on 1s (24fps)' : shot.exposure === 'on-3s' ? 'on 3s (8fps)' : 'on 2s (12fps)';

    // Top-left Scene Slate Knock-out
    const tlX = safe.x + 14, tlY = safe.y + 18;
    const tlBox = dens([[tlX, tlY], [tlX + 162, tlY], [tlX + 162, tlY + 58], [tlX, tlY + 58]], 6);
    fillShape(c, tlBox, PAL.cream, { seed: 9510 + v, amp: 2.0, dx: -2, dy: 2 });
    inkLoop(c, tlBox, { seed: 9515 + v, w: 2.6, amp: 1.0, color: PAL.pencil, gap: 3 });

    c.save();
    c.fillStyle = PAL.pencil;
    c.font = '700 28px "Segoe Print", "Comic Sans MS", cursive';
    c.textAlign = 'left';
    c.fillText(shot.sceneCode || 'SC. 05', tlX + 16 + jx, tlY + 39 + jy);

    // Bottom-right Drawing Number & Exposure Note Knock-out
    const brX = safe.x + safe.w - 220, brY = safe.y + safe.h - 118;
    const brBox = dens([[brX, brY], [brX + 206, brY], [brX + 206, brY + 98], [brX, brY + 98]], 6);
    fillShape(c, brBox, PAL.cream, { seed: 9520 + v, amp: 2.2, dx: -2, dy: 2 });

    // Red col-erase hand-drawn loop circling the drawing number
    const loopPts = circlePts(brX + 104, brY + 38, 28, 28, 86);
    inkStroke(c, [...loopPts, loopPts[0], loopPts[1]], {
      seed: 9530 + v,
      w: 3.4,
      t0: 8,
      t1: 18,
      amp: 1.2,
      color: PAL.pencil,
      heavy: 0
    });

    c.fillStyle = PAL.pencil;
    c.textAlign = 'center';
    c.font = '700 32px "Segoe Print", "Comic Sans MS", cursive';
    c.fillText('No. ' + String(D.id).padStart(3, '0'), brX + 104 + jx, brY + 48 + jy);
    c.font = '600 21px "Segoe Print", "Comic Sans MS", cursive';
    c.fillText(expLabel, brX + 104 + jx, brY + 84 + jy);
    c.restore();
  }

  function measureShot(W, H, safe, shot, microstockMode) {
    const isPortrait = H > W;
    const sc = isPortrait ? safe.w / 896 : safe.h / 908;
    const cx = safe.x + safe.w * 0.5;
    const layout = (shot && shot.layout) || 'strike-smear';
    let minX, maxX, minY, maxY;
    if (layout === 'badge-riffle') {
      minX = Math.max(safe.x + 24, cx - 360 * sc);
      maxX = Math.min(safe.x + safe.w - 24, cx + 360 * sc);
      minY = Math.max(safe.y + 36, safe.y + 44 * sc);
      maxY = Math.min(safe.y + safe.h - 36, safe.y + safe.h - 44 * sc);
    } else {
      minX = Math.max(safe.x + 36, cx - 330 * sc);
      maxX = Math.min(safe.x + safe.w - 36, cx + 330 * sc);
      minY = microstockMode ? Math.max(safe.y + 80, safe.y + safe.h * 0.16) : Math.max(safe.y + 44, safe.y + 52 * sc);
      maxY = Math.min(safe.y + safe.h - 48, safe.y + safe.h - 110 * sc);
    }
    return {
      behind: false,
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  }

  // 9. Complete Shot Renderer (4 Distinct Narrative Cel Animation Stages)
  function renderShot(c, W, H, safe, shot, localTime, microstockMode, cameraRig) {
    const u = clamp(localTime / Math.max(0.01, shot.duration));
    const D = getDrawingState(localTime, shot.exposure || 'on-2s', shot.drawingNumber || 12);
    const cx = safe.x + safe.w * 0.5;
    const cy = safe.y + safe.h * 0.5;
    const isPortrait = H > W;
    const sc = isPortrait ? safe.w / 896 : safe.h / 908;

    // Layout 4 ('badge-riffle') pulls back onto the animator's light-table desk!
    if (shot.layout === 'badge-riffle') {
      renderLightTableFinale(c, W, H, safe, shot, u, D, sc, microstockMode, cameraRig);
      return;
    }

    drawPaperSheet(c, W, H, D);

    c.save();
    if (cameraRig && window.StoryCamera && typeof window.StoryCamera.apply2D === 'function') {
      window.StoryCamera.apply2D(c, cameraRig, W, H, { skipBlur: true });
    }

    if (shot.layout === 'strike-smear') {
      // SHOT 1: Matchbox on table + Matchstick striking across with smear multiples & ignition burst
      const boxY = safe.y + safe.h * (isPortrait ? 0.64 : 0.68);
      const strikeU = E.out3(clamp(u * 1.45));
      const boxSquash = 1 - 0.06 * Math.sin(clamp((u - 0.25) / 0.35) * Math.PI);

      drawLightPool(c, cx + 60 * sc, boxY - 120 * sc, (160 + 180 * strikeU) * sc, D);
      drawMatchbox(c, cx, boxY, 0.92 * sc, D, {
        squash: boxSquash,
        scratchProgress: clamp((u - 0.08) / 0.55)
      });

      // Red col-erase dotted trajectory guide arc for the match strike
      const arcPts = [
        [cx - 210 * sc, boxY - 60 * sc],
        [cx - 20 * sc, boxY - 95 * sc],
        [cx + 180 * sc, boxY - 140 * sc],
        [cx + 240 * sc, boxY - 245 * sc]
      ];
      drawColEraseArc(c, arcPts, D, 8410);

      // Matchstick pose + smear trail
      const hx = lerp(cx - 170 * sc, cx + 215 * sc, strikeU);
      const hy = lerp(boxY - 35 * sc, boxY - 210 * sc, E.in2(strikeU));
      const ang = lerp(-2.35, -0.55, strikeU);
      const prevHx = lerp(cx - 220 * sc, hx - 95 * sc, strikeU);
      const prevHy = lerp(boxY - 18 * sc, hy + 55 * sc, strikeU);

      drawMatchstick(c, hx, hy, ang, 0.95 * sc, D, {
        smearFrom: [prevHx, prevHy, ang - 0.45]
      });

      // Ignition starburst & flying teardrop sparks
      const burstR = (75 + 95 * Math.sin(u * Math.PI)) * sc;
      const star = spline(xf(starPts(11, burstR, burstR * 0.46, 40 + D.id, D.id * 0.35, 0.3), { x: hx, y: hy }), true, 4);
      fillShape(c, star, PAL.yel, { seed: 41 + D.id, amp: 1.8 });
      const core = spline(xf(starPts(8, burstR * 0.52, burstR * 0.26, 45 + D.id, D.id * 0.5, 0.3), { x: hx, y: hy }), true, 4);
      fillShape(c, core, PAL.hi, { seed: 46 + D.id, amp: 1.4, dx: -2, dy: 2 });
      inkLoop(c, star, { seed: 42 + D.id, w: 5.5 * sc, amp: 1.6 });

      for (let k = 0; k < 10; k++) {
        const sa = -2.7 + k * 0.38 + hs(D.id, k) * 0.22;
        const sd = burstR * (0.95 + 0.85 * ((u * 2 + k * 0.17) % 1));
        drawSpark(
          c,
          hx + Math.cos(sa) * sd,
          hy + Math.sin(sa) * sd,
          Math.cos(sa) * 700,
          Math.sin(sa) * 700,
          (8 + 6 * hs(k, 4)) * sc,
          60 + D.id * 13 + k
        );
      }

      if (!microstockMode) {
        const titleY = safe.y + safe.h * (isPortrait ? 0.22 : 0.20);
        drawBoiledWord(c, shot.headline || 'STRIKE!', cx, titleY, 82 * sc, D, {
          color: PAL.yel,
          underFill: PAL.red,
          outline: 5 * sc,
          shadow: 8 * sc
        });
        drawBoiledWord(c, shot.subheadline || 'SMEAR & MULTIPLES', cx, titleY + 86 * sc, 36 * sc, D, {
          color: PAL.hi,
          outline: 3.5 * sc,
          shadow: 5 * sc
        });
      }
    } else if (shot.layout === 'spirit-jump') {
      // SHOT 2: Newborn Flame Spirit leaps in a high squash-and-stretch arc from burnt matchstick onto the matchbox
      const boxY = safe.y + safe.h * (isPortrait ? 0.68 : 0.72);
      const boxX = cx - 45 * sc;

      // Parabolic jump arc
      const jumpU = clamp(u);
      const spX = lerp(cx + 210 * sc, boxX + 20 * sc, E.io2(jumpU));
      const arcLift = Math.sin(jumpU * Math.PI) * 240 * sc;
      const spY = lerp(boxY - 60 * sc, boxY - 88 * sc, jumpU) - arcLift;

      // Classic squash & stretch along jump trajectory
      const stretch = 1 + 0.32 * Math.cos(jumpU * Math.PI * 2);
      const sy = clamp(stretch, 0.72, 1.36);
      const sx = 1 / Math.pow(sy, 0.78);
      const lean = -0.28 * Math.cos(jumpU * Math.PI);

      drawLightPool(c, spX, spY - 95 * sc, 275 * sc, D);

      // Matchbox waiting on the left-center
      drawMatchbox(c, boxX, boxY, 0.88 * sc, D, {
        squash: jumpU > 0.82 ? 0.93 : 1,
        scratchProgress: 1
      });

      // Upright burnt matchstick on the right with curling smoke wisp
      const mX = cx + 225 * sc, mY = boxY - 55 * sc;
      drawMatchstick(c, mX, mY, 0.08, 0.86 * sc, D, { burnt: true });
      // Curling ink smoke wisp from burnt match head
      const wispPts = [];
      for (let i = 0; i <= 8; i++) {
        const wu = i / 8;
        wispPts.push([
          mX + Math.sin(wu * 5 + D.tq * 5) * 22 * sc * wu + 28 * sc * wu * wu,
          mY - 25 * sc - wu * 145 * sc
        ]);
      }
      inkStroke(c, wispPts, { seed: 700 + D.id, w: 4.5 * sc, t0: 16, t1: 32, amp: 1.2 * sc, heavy: 0 });

      // Red col-erase animator jump arc with spacing ticks
      const jumpArc = [];
      for (let i = 0; i <= 10; i++) {
        const ju = i / 10;
        jumpArc.push([
          lerp(cx + 210 * sc, boxX + 20 * sc, E.io2(ju)),
          lerp(boxY - 125 * sc, boxY - 155 * sc, ju) - Math.sin(ju * Math.PI) * 240 * sc
        ]);
      }
      drawColEraseArc(c, jumpArc, D, 8450);

      // Action speed lines trailing behind the jumping spirit
      for (let k = -1; k <= 1; k++) {
        const tr = [
          [spX + 95 * sc, spY - 65 * sc + k * 34 * sc],
          [spX + 35 * sc, spY - 80 * sc + k * 24 * sc]
        ];
        inkStroke(c, tr, { seed: 8300 + D.id * 3 + k, w: 4 * sc, t0: 25, t1: 10, amp: 1.1 * sc, heavy: 0 });
      }

      // Hatched contact shadow on top of the matchbox
      const shR = (75 * (1 - 0.55 * Math.sin(jumpU * Math.PI))) * sc;
      hatch(c, circlePts(spX + 10 * sc, boxY - 82 * sc, shR * 0.24, 24, shR), {
        seed: 7700 + D.bv,
        gap: 8 * sc,
        ang: -0.95,
        w: 2.3 * sc,
        amp: 0.9
      });

      // Jumping Flame Spirit Character
      drawSpirit(c, {
        x: spX,
        y: spY,
        H: 235 * sc,
        sx,
        sy,
        lean,
        curl: lean * 0.6,
        wild: 0.34,
        arms: {
          L: { ang: 0.95, bend: 0.35, big: 1.1 },
          R: { ang: 1.15, bend: -0.25, big: 1.1 }
        },
        face: {
          eyes: shot.spiritFace || 'squeeze',
          mouth: 'open',
          pop: 1.12,
          look: -0.45
        }
      }, D, D.tq);

      if (!microstockMode) {
        const titleY = safe.y + safe.h * (isPortrait ? 0.19 : 0.18);
        drawBoiledWord(c, shot.headline || 'IGNITE', cx, titleY, 84 * sc, D, {
          color: PAL.yel,
          underFill: PAL.red,
          outline: 5 * sc,
          shadow: 8 * sc
        });
        drawBoiledWord(c, shot.subheadline || 'SQUASH & STRETCH', cx, titleY + 84 * sc, 35 * sc, D, {
          color: PAL.hi,
          outline: 3.5 * sc,
          shadow: 5 * sc
        });
      }
    } else if (shot.layout === 'box-dance') {
      // SHOT 3: Hero Flame Spirit dancing Ta-Da atop the matchbox with big white cartoon gloves, dust puffs & twinkles
      const boxY = safe.y + safe.h * (isPortrait ? 0.72 : 0.75);
      const groundY = boxY - 82 * sc;
      const beat = Math.sin(D.tq * Math.PI * 4);
      const sq = 1 + 0.12 * Math.cos(D.tq * Math.PI * 4);

      drawLightPool(c, cx, groundY - 125 * sc, 320 * sc, D);
      drawMatchbox(c, cx, boxY, 0.96 * sc, D, { squash: 1 - 0.03 * Math.abs(beat), scratchProgress: 1 });

      // Hatched contact shadow under spirit on matchbox top
      hatch(c, circlePts(cx + 12 * sc, groundY + 4 * sc, 22 * sc, 28, 108 * sc), {
        seed: 7750 + D.bv,
        gap: 8 * sc,
        ang: -0.95,
        w: 2.4 * sc,
        amp: 0.9
      });

      // Boiled cream dust puffs & ink C-curls flanking the dancing spirit on the matchbox
      for (const side of [-1, 1]) {
        for (let j = 0; j < 2; j++) {
          const px = cx + side * (145 + j * 68) * sc;
          const py = groundY - (12 + j * 18) * sc;
          const pr = (32 - j * 7) * sc;
          drawPuff(c, px, py, pr, 1020 + side * 7 + j * 13 + D.id, {
            n: 4,
            w: 3.8 * sc,
            fill: PAL.cream,
            flat: 0.72,
            wide: 1.2
          });
        }
      }

      // Hero Flame Spirit in Ta-Da pose with big white cartoon gloves
      drawSpirit(c, {
        x: cx,
        y: groundY,
        H: 295 * sc,
        sx: 1 / Math.pow(sq, 0.78),
        sy: sq,
        lean: beat * 0.11,
        curl: beat * 0.08,
        wild: 0.2,
        arms: {
          L: { ang: 0.85 + beat * 0.25, bend: -0.2, len: 0.48, big: 1.18 },
          R: { ang: 0.85 - beat * 0.25, bend: -0.2, len: 0.48, big: 1.18 }
        },
        face: {
          eyes: shot.spiritFace || 'happy',
          mouth: 'grin',
          cheeks: true,
          look: beat * 0.3
        }
      }, D, D.tq);

      // Ta-Da 4-point twinkles popping around the spirit
      const twinkles = [
        [-195, -265, 34],
        [205, -275, 36],
        [-235, -135, 26],
        [230, -145, 28],
        [0, -355, 40]
      ];
      twinkles.forEach(([ox, oy, tr], k) => {
        const cyc = [1.0, 0.65, 0.85][(D.bv + k) % 3];
        drawTwinkle(c, cx + ox * sc, groundY + oy * sc, tr * sc * cyc, 1100 + k * 7 + D.id);
      });

      if (!microstockMode) {
        const titleY = safe.y + safe.h * (isPortrait ? 0.18 : 0.17);
        drawBoiledWord(c, shot.headline || 'CEL BOIL', cx, titleY, 86 * sc, D, {
          color: PAL.yel,
          underFill: PAL.red,
          outline: 5 * sc,
          shadow: 8 * sc
        });
        drawBoiledWord(c, shot.subheadline || 'OFF-REGISTER INK', cx, titleY + 86 * sc, 35 * sc, D, {
          color: PAL.hi,
          outline: 3.5 * sc,
          shadow: 5 * sc
        });
      }
    }

    // Bottom tagline pill + Animator exposure sheet annotations
    if (!microstockMode && shot.tagline) {
      c.save();
      c.fillStyle = PAL.ink;
      c.font = `700 ${Math.round(22 * sc)}px "Courier New", monospace`;
      c.textAlign = 'center';
      c.fillText(shot.tagline, cx, safe.y + safe.h - 148 * sc);
      c.restore();
    }
    drawExposureSlate(c, safe, shot, D, microstockMode);
    c.restore();
  }

  // 10. Shot 4 Finale: Animator's Light-Table Desk Pull-Back + Stacked Sheets + Blue Onion-Skin + Corner Riffle + Reborn Tiny Spirit
  function renderLightTableFinale(c, W, H, safe, shot, u, D, sc, microstockMode, cameraRig) {
    const v = D.bv;
    const isPortrait = H > W;

    // 1. Dark wooden animation desk background (stays full-bleed untransformed)
    c.fillStyle = PAL.desk;
    c.fillRect(0, 0, W, H);

    c.save();
    if (cameraRig && window.StoryCamera && typeof window.StoryCamera.apply2D === 'function') {
      window.StoryCamera.apply2D(c, cameraRig, W, H, { skipBlur: true });
    }

    // Scaled cel sheet sitting on the light table
    const sheetS = 0.84;
    const sw = W * sheetS, sh = H * sheetS;
    const sx0 = (W - sw) * 0.5, sy0 = (H - sh) * 0.5 + 16 * sc;

    // 2. Warm stepped light-table underlight glowing around the stack
    [[84, 0.14], [52, 0.24], [26, 0.38]].forEach(([m, alpha], k) => {
      const glowRect = dens([
        [sx0 - m, sy0 - m * 0.7],
        [sx0 + sw + m, sy0 - m * 0.7],
        [sx0 + sw + m, sy0 + sh + m * 0.8],
        [sx0 - m, sy0 + sh + m * 0.8]
      ], 14);
      fillShape(c, glowRect, `rgba(255,240,180,${alpha})`, { seed: 9170 + k * 5 + v, amp: 3.0, dx: 0, dy: 0 });
    });

    // 3. Taped Acme Peg Bar at top of the stack
    const barW = Math.min(sw * 0.78, 760 * sc);
    const barX = W * 0.5 - barW * 0.5, barY = sy0 - 24 * sc, barH = 44 * sc;
    const barPts = dens([[barX, barY], [barX + barW, barY], [barX + barW, barY + barH], [barX, barY + barH]], 6);
    fillShape(c, barPts, PAL.pegMetal, { seed: 9100 + v, amp: 1.0, dx: -2, dy: 2 });
    inkLoop(c, barPts, { seed: 9110 + v, w: 3.5 * sc, amp: 1.0 });
    // Masking tape tabs holding the peg bar
    for (const side of [-1, 1]) {
      const tape = dens(xf([[-34 * sc, -18 * sc], [34 * sc, -18 * sc], [34 * sc, 18 * sc], [-34 * sc, 18 * sc]], {
        x: W * 0.5 + side * (barW * 0.5),
        y: barY + barH * 0.4,
        r: side * 0.14
      }), 4);
      fillShape(c, tape, PAL.paperTooth, { seed: 9125 + side + v, amp: 1.2, dx: 0, dy: 0 });
      inkLoop(c, tape, { seed: 9128 + side + v, w: 2.4 * sc, amp: 1.0 });
    }

    // 4. Hard cel drop shadow & 3 offset underlying paper sheets in the stack
    const stackShadow = dens([
      [sx0 + 22 * sc, sy0 + 18 * sc],
      [sx0 + sw + 22 * sc, sy0 + 18 * sc],
      [sx0 + sw + 22 * sc, sy0 + sh + 18 * sc],
      [sx0 + 22 * sc, sy0 + sh + 18 * sc]
    ], 12);
    fillShape(c, stackShadow, 'rgba(0,0,0,0.42)', { seed: 9130 + v, amp: 1.5, dx: 0, dy: 0 });

    [[14, 11, '#DFD3B8'], [9, 7, '#E7DCC2'], [4, 3, '#EFE4CA']].forEach(([dx, dy, col], k) => {
      const rPts = dens([
        [sx0 + dx * sc, sy0 + dy * sc],
        [sx0 + sw + dx * sc, sy0 + dy * sc],
        [sx0 + sw + dx * sc, sy0 + sh + dy * sc],
        [sx0 + dx * sc, sy0 + sh + dy * sc]
      ], 10);
      fillShape(c, rPts, col, { seed: 9140 + k * 7 + v, amp: 1.0, dx: 0, dy: 0 });
      inkLoop(c, rPts, { seed: 9145 + k * 7 + v, w: 2.2 * sc, amp: 0.9 });
    });

    // 5. Top Active Animation Sheet
    const topRect = dens([[sx0, sy0], [sx0 + sw, sy0], [sx0 + sw, sy0 + sh], [sx0, sy0 + sh]], 12);
    fillShape(c, topRect, PAL.paper, { seed: 9150 + v, amp: 1.0, dx: 0, dy: 0 });
    inkLoop(c, topRect, { seed: 9155 + v, w: 2.8 * sc, amp: 0.9 });

    // Acme peg holes punched through top sheet
    const hy = sy0 + 30 * sc;
    const holeSpan = Math.min(sw * 0.28, 260 * sc);
    [
      circlePts(W * 0.5, hy, 12 * sc, 20),
      capsulePts(W * 0.5 - holeSpan, hy, 38 * sc, 10 * sc),
      capsulePts(W * 0.5 + holeSpan, hy, 38 * sc, 10 * sc)
    ].forEach((pts, idx) => {
      const q = dens(pts, 3);
      fillShape(c, q, PAL.pegMetal, { seed: 9160 + idx + v, amp: 0.6, dx: 0, dy: 0 });
      inkLoop(c, q, { seed: 9165 + idx + v, w: 2.4 * sc, amp: 0.6 });
    });

    // 6. Central Scalloped Boiled Fire Badge + Hero Brush Title + Reborn Tiny Spirit + Blue Onion-Skin Ghost
    const badgeCx = W * 0.5;
    const badgeCy = sy0 + sh * (isPortrait ? 0.45 : 0.46);
    const badgeRx = Math.min(sw * 0.41, 350 * sc);
    const badgeRy = badgeRx * (isPortrait ? 0.54 : 0.46);

    // Surrounding boiled cream smoke puffs & ink curl tails from the blast
    const puffAngles = [-2.6, -1.7, -0.7, 0.25, 0.95, 1.85, 2.55];
    puffAngles.forEach((ang, idx) => {
      const pd = badgeRx * 1.18;
      const px = badgeCx + Math.cos(ang) * pd;
      const py = badgeCy + Math.sin(ang) * (badgeRy * 1.25);
      drawPuff(c, px, py, 36 * sc, 1600 + idx * 13 + D.id, { n: 4, w: 4.2 * sc, fill: PAL.cream });
    });

    drawScallopedBadge(c, badgeCx, badgeCy, badgeRx, badgeRy, D, 1);

    // Blue Col-Erase Onion-Skin Ghost of the tiny spirit (from the drawing underneath on the light table!)
    const spX = badgeCx + badgeRx * 0.62;
    const spY = badgeCy - badgeRy * 0.78;
    c.save();
    c.globalAlpha = 0.24;
    const ghostCtrl = flameControl(125 * sc, 92 * sc, -18 * sc, -12 * sc, 3099, 0.15);
    const ghostPts = xf(spline(ghostCtrl, true, 5), { x: spX - 38 * sc, y: spY + 14 * sc, r: -0.12 });
    inkLoop(c, ghostPts, { seed: 3099, w: 4.5 * sc, color: PAL.onionBlue, amp: 1.0 });
    c.restore();

    // Reborn Tiny Flame Spirit perched on top-right of the badge holding up a glowing ember dot!
    drawSpirit(c, {
      x: spX,
      y: spY,
      H: 138 * sc,
      sx: 1,
      sy: 1,
      lean: 0.06,
      curl: 0.04,
      wild: 0.15,
      drops: false,
      arms: {
        L: { ang: -0.45, bend: 0.35 },
        R: { ang: 1.08, bend: -0.28, big: 1.15 }
      },
      face: {
        eyes: shot.spiritFace || 'wink',
        mouth: 'grin',
        look: -0.55
      }
    }, D, D.tq);

    // Glowing ember held up by the tiny spirit
    const emX = spX + 56 * sc, emY = spY - 115 * sc, emR = 26 * sc;
    fillShape(c, circlePts(emX, emY, emR, 20), PAL.red, { seed: 9600 + v, amp: 1.4, dx: -3, dy: 2 });
    fillShape(c, circlePts(emX - emR * 0.25, emY - emR * 0.25, emR * 0.48, 14), PAL.yel, { seed: 9605 + v, amp: 1.1, dx: -2, dy: 2 });
    inkLoop(c, circlePts(emX, emY, emR, 20), { seed: 9610 + v, w: 4.2 * sc, amp: 1.3 });

    // Twinkles around the badge lockup
    [
      [-badgeRx * 0.95, -badgeRy * 0.9, 28],
      [badgeRx * 1.02, -badgeRy * 1.05, 32],
      [-badgeRx * 1.0, badgeRy * 0.85, 24],
      [badgeRx * 0.96, badgeRy * 0.78, 26]
    ].forEach(([ox, oy, tr], k) => {
      drawTwinkle(c, badgeCx + ox, badgeCy + oy, tr * sc, 6200 + k * 13 + v, { rot: 0.15 * k });
    });

    if (!microstockMode) {
      drawBoiledWord(c, shot.headline || 'HAND MADE', badgeCx, badgeCy - 8 * sc, 72 * sc, D, {
        color: PAL.yel,
        underFill: PAL.ink,
        outline: 5 * sc,
        shadow: 8 * sc
      });
      drawBoiledWord(c, shot.subheadline || 'FRAME BY FRAME', badgeCx, badgeCy + badgeRy + 64 * sc, 36 * sc, D, {
        color: PAL.hi,
        outline: 3.5 * sc,
        shadow: 5 * sc
      });
    }

    // 7. Lifted Bottom-Right Corner Flap Riffle + Cartoon White Glove Thumb Pinching the Sheet!
    const crX = sx0 + sw, crY = sy0 + sh;
    const flapA = 165 * sc, flapB = 125 * sc;
    const P1 = [crX - flapA, crY], P2 = [crX, crY - flapB];
    const Q1 = [crX - flapA * 0.85, crY - flapB * 0.72];
    const Q2 = [crX - flapA * 0.25, crY - flapB * 0.96];
    const flapPoly = dens([P1, Q1, Q2, P2], 5);

    // Cast shadow of the curled page flap
    fillShape(c, xf(flapPoly, { x: -12 * sc, y: -10 * sc }), 'rgba(28,22,19,0.18)', { seed: 9180 + D.id, amp: 1.2, dx: 0, dy: 0 });
    // Curled page flap underside
    fillShape(c, flapPoly, PAL.paperTooth, { seed: 9182 + D.id, amp: 1.2, dx: 0, dy: 0 });
    inkLoop(c, flapPoly, { seed: 9186 + D.id, w: 3.8 * sc, amp: 1.2 });
    inkStroke(c, [Q1, Q2], { seed: 9188 + D.id, w: 8.5 * sc, t0: 12, t1: 12, amp: 1.0, heavy: 0 });

    // Animator's White Cartoon Glove Thumb riffle at the corner
    const tx = Q2[0] + 52 * sc, ty = Q2[1] + 44 * sc, tAng = -2.55;
    const thumb = dens(xf(circlePts(0, 0, 34 * sc, 32, 82 * sc), {
      x: tx - Math.cos(tAng) * 54 * sc,
      y: ty - Math.sin(tAng) * 54 * sc,
      r: tAng
    }), 3);
    fillShape(c, thumb, PAL.hi, { seed: 9250 + v, amp: 1.2, dx: -3, dy: 3 });
    inkLoop(c, thumb, { seed: 9255 + v, w: 5.2 * sc, amp: 1.2, heavy: 0.35 });

    // Red col-erase total drawing count annotation on the sheet
    if (!microstockMode) {
      const noteX = sx0 + 34 * sc, noteY = sy0 + sh - 38 * sc;
      c.save();
      c.fillStyle = PAL.pencil;
      c.font = `700 ${Math.round(30 * sc)}px "Segoe Print", "Comic Sans MS", cursive`;
      c.textAlign = 'left';
      c.fillText(shot.tagline || '146 DRAWINGS · ON TWOS', noteX, noteY);
      c.restore();
    }
    c.restore();
  }

  window.CelBoilKit = {
    PAL,
    REG,
    getDrawingState,
    drawPaperSheet,
    drawLightPool,
    drawMatchbox,
    drawMatchstick,
    drawSpirit,
    drawScallopedBadge,
    drawBoiledWord,
    measureShot,
    renderShot
  };
})();
