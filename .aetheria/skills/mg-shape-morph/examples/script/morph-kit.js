/**
 * MorphKit v2 — Swiss flat-colour icon-morph engine (adapted from references/aetheria-motion/demos/08-morph/).
 * One hero shape travels a day: drop -> mug -> sun -> sunset -> gull -> paper plane (loop flight) -> pin -> heart -> wordmark.
 * Every icon is resampled to the same vertex count and morphs through a shared circle ("via circle"), on
 * expanding colour-block field wipes (cream / marigold / vermilion / ultramarine / ink). Pure function of t, offline.
 */
(function () {
  'use strict';

  const W = 1920, H = 1080, FPS = 30, FR = 1 / FPS;
  const C = { ink: '#16151B', cream: '#F4EEE3', mari: '#FFB627', verm: '#FF4F2B', ultra: '#2438E8' };
  const CUES = {
    land: { cup: 0.4, sun: 2.0, sunset: 3.2, gull: 4.4, plane: 5.4, pin: 6.4, heart: 7.6, m: 8.6 },
    morphs: [
      { a: 'drop', b: 'cup', t0: 0.0, t1: 0.62 }, { a: 'cup', b: 'sun', t0: 1.3, t1: 2.0 },
      { a: 'sun', b: 'sunset', t0: 2.4, t1: 3.2 }, { a: 'sunset', b: 'gull', t0: 3.6, t1: 4.4 },
      { a: 'gull', b: 'plane', t0: 4.8, t1: 5.4 }, { a: 'plane', b: 'pin', t0: 6.3, t1: 6.4 },
      { a: 'pin', b: 'heart', t0: 7.0, t1: 7.6 }, { a: 'heart', b: 'm', t0: 8.0, t1: 8.6 }
    ],
    flight: { t0: 5.4, launch: 5.6, apex: 6.04, dive: 6.14, t1: 6.4 },
    wipes: { sun: 1.62, sky: 2.453, sea: 2.6, flood: 3.98, heart: 7.233, ink: 8.02 },
    heartbeat: [7.8, 7.93],
    letters: { t0: 8.32, step: 0.075, fly: 0.32 },
    captions: [0.0, 1.6, 2.8, 4.0, 5.2, 6.3, 7.3],
    loop: { cx: 1215, cy: 387, r: 255, ground: 642 },
    shock: 6.367
  };
  const EN = ['GOOD MORNING', 'SUNRISE', 'SUNSET', 'SEA BREEZE', 'TAKE OFF', 'ARRIVAL', 'LOVE'];

  // ------------------------------------------------------------ math / easing / colour
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const deg = Math.PI / 180;
  function bez(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }
  const EM = bez(0.7, 0, 0.3, 1), EO = bez(0.16, 1, 0.3, 1), EIO = bez(0.45, 0, 0.55, 1), EB = bez(0.42, 0, 0.12, 1);
  const ECL = bez(0.32, 0, 0.1, 1);
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function oklab(h) {
    const [r, g, b] = hexRgb(h).map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromOklab([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return '#' + [r, g, bb].map((c) => Math.round(clamp(toSrgb(clamp(c))) * 255).toString(16).padStart(2, '0')).join('');
  }
  const mixC = (h1, h2, t) => (t <= 0 ? h1 : t >= 1 ? h2 : fromOklab(oklab(h1).map((v, i) => lerp(v, oklab(h2)[i], t))));
  const tone = (h, dL) => { const A = oklab(h); A[0] += dL; return fromOklab(A); };

  // ------------------------------------------------------------ geometry (lazy: needs the DOM for SVG path sampling)
  const NB = 240, NH = 72, NM = 24, NS = 60;
  let svg = null;
  function sampleD(d, n, closed = true) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); svg.appendChild(p);
    const L = p.getTotalLength(), o = [], den = closed ? n : n - 1;
    for (let i = 0; i < n; i++) { const q = p.getPointAtLength((L * i) / den); o.push([q.x, q.y]); }
    svg.removeChild(p); return o;
  }
  const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const orient = (P) => (area(P) < 0 ? P.slice().reverse() : P);
  const centroid = (P) => { let x = 0, y = 0; for (const p of P) { x += p[0]; y += p[1]; } return [x / P.length, y / P.length]; };
  function resamplePoly(P, n) {
    const L = [0];
    for (let i = 1; i <= P.length; i++) { const a = P[i - 1], b = P[i % P.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const tot = L[P.length], o = []; let j = 0;
    for (let i = 0; i < n; i++) { const s = (tot * i) / n; while (L[j + 1] < s) j++; const a = P[j], b = P[(j + 1) % P.length], u = (s - L[j]) / (L[j + 1] - L[j] || 1); o.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]); }
    return o;
  }
  const circ = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  function bestShift(A, B) {
    const n = A.length; let best = Infinity, bs = 0;
    for (let s = 0; s < n; s++) { let e = 0; for (let i = 0; i < n; i += 2) { const b = B[(i + s) % n], dx = A[i][0] - b[0], dy = A[i][1] - b[1]; e += dx * dx + dy * dy; if (e >= best) break; } if (e < best) { best = e; bs = s; } }
    return bs;
  }
  const shiftP = (B, s) => B.map((_, i) => B[(i + s) % B.length]);
  const alignTo = (A, B) => shiftP(B, bestShift(A, B));
  const lerpP = (A, B, t) => A.map((a, i) => [lerp(a[0], B[i][0], t), lerp(a[1], B[i][1], t)]);
  const rep = (p, n) => Array.from({ length: n }, () => [p[0], p[1]]);
  const qbez = (a, c, b, t) => [lerp(lerp(a[0], c[0], t), lerp(c[0], b[0], t), t), lerp(lerp(a[1], c[1], t), lerp(c[1], b[1], t), t)];
  function rpoly(pts, r) {
    const n = pts.length; let d = '';
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], rr = Array.isArray(r) ? r[i] : r;
      const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]), k1 = Math.min(rr, da / 2) / da, k2 = Math.min(rr, db / 2) / db;
      d += (i ? 'L' : 'M') + (p[0] + (a[0] - p[0]) * k1) + ',' + (p[1] + (a[1] - p[1]) * k1) + 'Q' + p[0] + ',' + p[1] + ' ' + (p[0] + (b[0] - p[0]) * k2) + ',' + (p[1] + (b[1] - p[1]) * k2);
    }
    return d + 'Z';
  }
  function trim(pts, f) {
    return pts.map((_, i) => { const u = (i / (NM - 1)) * f * (NM - 1), k = Math.min(NM - 2, Math.floor(u)), r = u - k; return [lerp(pts[k][0], pts[k + 1][0], r), lerp(pts[k][1], pts[k + 1][1], r)]; });
  }

  let I = null, MP = null, drop = null, FP = null, WMK = null;
  function build() {
    if (I) return;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute'; svg.style.left = '-10px'; svg.style.top = '-10px';
    document.body.appendChild(svg);
    const S = (d) => orient(sampleD(d, NB));
    const strokeD = (d, w) => ({ pts: sampleD(d, NM, false), w });
    const ray = (a, r1, r2, w, cx = 0, cy = 0) => { const c = Math.cos(a * deg), s = Math.sin(a * deg); return strokeD(`M${cx + r1 * c},${cy + r1 * s}L${cx + r2 * c},${cy + r2 * s}`, w); };
    const dotS = (p) => ({ pts: rep(p, NM), w: 0 });
    const hole = (pts, on = true) => ({ pts, on });
    const noHole = (p) => hole(rep(p, NH), false);
    const noShade = (p) => ({ pts: rep(p, NS), on: false });
    I = {};
    { // CUP
      const HR = 22 / 0.95, HC = [138, 30], HO = HR + 30, yj = Math.sqrt(HO * HO - (HC[0] - 105) ** 2), q = 14 / 0.95;
      const body = S(`M ${-130 + q},-70 L ${105 - q},-70 Q 105,-70 105,${-70 + q} L 105,${HC[1] - yj} A ${HO},${HO} 0 1 1 105,${HC[1] + yj} L 105,${135 - q} Q 105,135 ${105 - q},135 L ${-130 + q},135 Q -130,135 -130,${135 - q} L -130,${-70 + q} Q -130,-70 ${-130 + q},-70 Z`);
      const st = Array.from({ length: 8 }, () => dotS([-12, 30]));
      st[7] = strokeD('M -75,-98 C -97,-128 -53,-150 -75,-182', 19); st[7].steam = 0;
      st[0] = strokeD('M -12,-98 C -34,-133 10,-160 -12,-202', 19); st[0].steam = 1;
      st[1] = strokeD('M 51,-98 C 29,-128 73,-150 51,-182', 19); st[1].steam = 2;
      st[4] = strokeD('M -178,170 L 150,170', 19); st[4].saucer = true;
      I.cup = { body, holes: [hole(circ(HC[0], HC[1], HR, NH))], strokes: st, shade: { pts: orient(sampleD(rpoly([[105, -70], [105, 135], [-8, 135]], [3, 3, 3]), NS)), on: true },
        shadeC: mixC(C.ink, C.cream, 0.1), fill: C.ink, pos: [942, 548], scale: 0.95, piv: [0, 170] };
    }
    { // SUN
      const st = Array.from({ length: 8 }, (_, k) => ray(-90 + 45 * k, 165, 214, 18));
      I.sun = { body: circ(0, 0, 125, NB), holes: [noHole([0, 0])], strokes: st, shade: noShade([0, 0]), fill: C.verm, pos: [960, 468], scale: 1, piv: [0, 0] };
    }
    { // SUNSET
      const st = [];
      const up = { 6: -168, 7: -129, 0: -90, 1: -51, 2: -12 };
      for (const k in up) st[k] = ray(up[k], 192, 234, 18, 0, 40);
      st[3] = strokeD('M -150,100 L 150,100', 18); st[4] = strokeD('M -100,140 L 100,140', 18); st[5] = strokeD('M -52,180 L 52,180', 18);
      I.sunset = { body: circ(0, 40, 150, NB), holes: [noHole([0, 40])], strokes: st, shade: noShade([0, 40]), fill: C.mari, pos: [960, 520], scale: 1, piv: [0, 40] };
    }
    { // GULL
      const arcP = (a, b, R, n) => {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), h = Math.sqrt(Math.max(0, R * R - (L * L) / 4));
        let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; }
        const c = [mx + nx * h, my + ny * h], a0 = Math.atan2(a[1] - c[1], a[0] - c[0]); let da = Math.atan2(b[1] - c[1], b[0] - c[0]) - a0;
        while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        return Array.from({ length: n }, (_, i) => [c[0] + R * Math.cos(a0 + (da * i) / (n - 1)), c[1] + R * Math.sin(a0 + (da * i) / (n - 1))]);
      };
      const gp = (ty) => {
        const TL = [-205, ty], TR = [205, ty];
        return [...arcP(TL, [-13, 12], 125, 48), [0, 18], ...arcP([13, 12], TR, 125, 48), ...arcP(TR, [21, 40], 250, 48).slice(1),
          ...Array.from({ length: 13 }, (_, i) => [21 * Math.cos((Math.PI * (i + 1)) / 14), 40 + 21 * Math.sin((Math.PI * (i + 1)) / 14)]), ...arcP([-21, 40], TL, 250, 48).slice(0, -1)];
      };
      const up = orient(resamplePoly(gp(-62), NB));
      const dn = alignTo(up, orient(resamplePoly(gp(40), NB)));
      I.gull = { body: up, down: dn, holes: [noHole([0, 20])], strokes: Array.from({ length: 8 }, () => dotS([0, 22])), shade: noShade([0, 20]), fill: C.cream, pos: [960, 424], scale: 1.02, piv: [0, 0] };
    }
    { // PAPER PLANE
      const N = [205, -125], L = [-205, 5], F = [-40, 45], K = [-5, 160], Q = [F[0] + 0.32 * (N[0] - F[0]), F[1] + 0.32 * (N[1] - F[1])];
      I.plane = { body: S(rpoly([N, L, F, K], [19, 19, 19, 19])), holes: [noHole([0, 0])], strokes: Array.from({ length: 8 }, () => dotS([0, 10])),
        shade: { pts: orient(sampleD(rpoly([F, K, Q], [8, 19, 8]), NS)), on: true },
        fill: C.cream, shadeC: mixC(C.cream, C.ultra, 0.3), pos: [690, 642], scale: 0.74, rot0: 35 * deg, piv: [0, 0] };
    }
    { // PIN
      const R = 140, cy = -3, v = cy + R * Math.SQRT2, t = R / Math.SQRT2, q = 14 / 0.85 / Math.SQRT2;
      const body = S(`M ${-q},${v - q} L ${-t},${cy + t} A ${R},${R} 0 1 1 ${t},${cy + t} L ${q},${v - q} Q 0,${v} ${-q},${v - q} Z`);
      I.pin = { body, holes: [hole(circ(0, cy, 22 / 0.85, NH))], strokes: Array.from({ length: 8 }, () => dotS([0, cy])),
        shade: { pts: orient(sampleD(rpoly([[0, v + 4], [t + 2, cy + t], [0, cy]], [2, 2, 2]), NS)), on: true }, shadeC: '#D93A1C',
        fill: C.verm, pos: [960, 480], scale: 0.85, piv: [0, 190] };
    }
    { // HEART
      const a = 234, h = a / Math.SQRT2, rc = a / 2, yc = 6, q = 14 / 0.86 / Math.SQRT2;
      const body = S(`M ${-q},${yc + h - q} L ${-h},${yc} A ${rc},${rc} 0 0 1 0,${yc - h} A ${rc},${rc} 0 0 1 ${h},${yc} L ${q},${yc + h - q} Q 0,${yc + h} ${-q},${yc + h - q} Z`);
      I.heart = { body, holes: [noHole([0, 0])], strokes: Array.from({ length: 8 }, () => dotS([0, 0])),
        shade: { pts: orient(sampleD(rpoly([[0, yc + h + 4], [h + 2, yc], [0, yc]], [2, 2, 2]), NS)), on: true },
        shadeC: mixC(C.cream, C.verm, 0.15), fill: C.cream, pos: [960, 522], scale: 0.86, piv: [0, 0] };
    }
    // WORDMARK target: the hero becomes the disc that buds the letters (system font outlines, measured once)
    {
      const m = document.createElement('canvas').getContext('2d');
      const FS = 250, word = 'morphe', font = `600 ${FS}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      m.font = font;
      const advs = [...word].map((ch) => m.measureText(ch).width), track = -5, dotR = 22, dotGap = 9;
      const total = advs.reduce((a, b) => a + b, 0) + track * (word.length - 1) + dotGap + 2 * dotR;
      let x = 960 - total / 2; const yB = 566, letters = [];
      [...word].forEach((ch, k) => { letters.push({ ch, x, cen: [x + advs[k] / 2, yB - FS * 0.26], w: advs[k] }); x += advs[k] + track; });
      WMK = { font, FS, yB, letters, dot: { cen: [x - track + dotGap + dotR, yB - dotR], r: dotR } };
      const m0 = letters[0];
      I.m = { body: circ(0, 0, 62, NB), holes: [noHole([0, 0])], strokes: Array.from({ length: 8 }, () => dotS([0, 0])), shade: noShade([0, 0]),
        fill: C.cream, pos: m0.cen, scale: 1, piv: [0, 0] };
    }
    MP = {
      'cup>sun': { via: [0, 18, 116], rot: 24, ctrl: [70, -10], sq: 0.13 },
      'sun>sunset': { rot: 0, ctrl: [0, 0], sq: 0.05 },
      'sunset>gull': { via: [0, 30, 118], rot: -18, ctrl: [-60, 10], sq: 0.12 },
      'gull>plane': { via: [0, 10, 98], rot: -26, ctrl: [110, -70], sq: 0.14 },
      'plane>pin': { via: [0, 5, 100] },
      'pin>heart': { via: [0, -12, 120], rot: 18, ctrl: [0, -190], sq: 0.13, sw: [0.49, 0.51] },
      'heart>m': { via: [0, -6, 112], rot: -20, ctrl: [40, -70], sq: 0.12 }
    };
    for (const m of CUES.morphs) {
      const key = m.a + '>' + m.b, P = MP[key]; if (!P) continue; m.key = key; m.P = P;
      const A = I[m.a].body, B = I[m.b].body;
      if (P.via) { const c = circ(P.via[0], P.via[1], P.via[2], NB); P.Ca = alignTo(A, c); P.Cb = alignTo(B, c); }
      else P.sAB = bestShift(A, B);
    }
    drop = CUES.morphs[0];
    drop.Ca = alignTo(I.cup.body, circ(-12, 30, 105, NB));
    const LP = CUES.loop, x0 = I.plane.pos[0], g = LP.ground, cx = LP.cx, cy = LP.cy, r = LP.r;
    const d = `M ${x0},${g} L ${cx},${g} A ${r},${r} 0 0 0 ${cx + r},${cy} A ${r},${r} 0 0 0 ${cx},${cy - r} A ${r},${r} 0 0 0 ${cx - r},${cy} L ${I.pin.pos[0]},${I.pin.pos[1]}`;
    const n = 1200, len = cx - x0 + 1.5 * Math.PI * r + (I.pin.pos[1] - cy);
    FP = { pts: sampleD(d, n, false), n, len, uTop: (cx - x0 + Math.PI * r) / len };
  }

  // ------------------------------------------------------------ icon "life"
  function state(name, t) {
    const ic = I[name];
    if (name === 'cup') {
      const strokes = ic.strokes.map((s) => {
        if (s.steam !== undefined) {
          const j = s.steam, ph = j * 1.9, ta = 0.4 + [0.02, 0, 0.04][j], tb = ta + 0.2, base = s.pts[0];
          if (t < tb) {
            if (t < ta) return { pts: rep(base, NM), w: 0 };
            const e = EIO((t - ta) / (tb - ta)), S0 = [[-150, 118], [128, 110], [160, 124]][j], Cc = [[-205, -330], [70, -420], [175, -300]][j];
            const hd = lerp(0.05, 1, e);
            return { pts: Array.from({ length: NM }, (_, i) => qbez(S0, Cc, base, Math.max(0, hd - 0.05 * (1 - i / (NM - 1))))), w: lerp(26, 17, e) };
          }
          const f = smooth(tb, tb + 0.42, t);
          const pts = trim(s.pts, Math.max(0.001, f)).map((p, i) => { const u = (i / (NM - 1)) * f; return [p[0] + 10 * u * Math.sin(u * 5 - t * 16 + ph), p[1] - 7 * u * Math.sin(t * 6.8 + ph)]; });
          return { pts, w: lerp(17, s.w, clamp(f * 3)) };
        }
        if (s.saucer) { const f = EO(clamp((t - 0.37) / 0.3)); return { pts: s.pts.map((p) => [lerp(-12, p[0], f), p[1]]), w: s.w * clamp(f * 3) }; }
        return s;
      });
      const hf = smooth(0.5, 0.66, t);
      return { ...ic, strokes, holes: [{ pts: lerpP(rep([138, 30], NH), ic.holes[0].pts, hf), on: true }] };
    }
    if (name === 'sun') {
      const nb = clamp((t - 1.98) / 0.4, 0, 2.2), a = 12 * (Math.floor(nb) + EO(clamp((nb % 1) / 0.45))) * deg, c = Math.cos(a), s = Math.sin(a);
      const push = 1 + 0.075 * Math.sin(Math.PI * clamp((t - 1.97) / 0.34));
      return { ...ic, strokes: ic.strokes.map((st) => ({ w: st.w, pts: st.pts.map((p) => [(p[0] * c - p[1] * s) * push, (p[0] * s + p[1] * c) * push]) })) };
    }
    if (name === 'sunset') return { ...ic, strokes: ic.strokes.map((st, k) => (k >= 3 && k <= 5 ? { w: st.w, pts: st.pts.map((p) => [p[0] * (1 + 0.05 * Math.sin(t * 6.3 + k * 2.1)) + (k % 2 ? 9 : -9) * Math.cos((Math.PI * (t - 3.2)) / 0.4), p[1]]) } : st)) };
    if (name === 'gull') { const f = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - 4.2)) / 0.2); return { ...ic, body: lerpP(ic.body, ic.down, f) }; }
    return ic;
  }

  function pathAt(u) {
    const x = clamp(u) * (FP.n - 1), k = Math.min(FP.n - 2, Math.floor(x)), r = x - k, a = FP.pts[k], b = FP.pts[k + 1];
    const k0 = Math.max(0, k - 2), k1 = Math.min(FP.n - 1, k + 3);
    return { p: [lerp(a[0], b[0], r), lerp(a[1], b[1], r)], ang: Math.atan2(FP.pts[k1][1] - FP.pts[k0][1], FP.pts[k1][0] - FP.pts[k0][0]) };
  }
  function flightU(t) {
    const FL = CUES.flight;
    if (t <= FL.launch) return 0;
    const u0 = FP.uTop - 6 / FP.len;
    if (t < FL.apex + 0.03) return u0 * ECL((t - FL.launch) / (FL.apex + 0.03 - FL.launch));
    if (t < FL.dive) return u0 + (8 / FP.len) * smooth(FL.apex + 0.03, FL.dive + 0.05, t);
    const ud = u0 + (8 / FP.len) * smooth(FL.apex + 0.03, FL.dive + 0.05, FL.dive);
    return Math.min(1, ud + (1 - ud) * Math.pow(clamp((t - FL.dive) / (FL.t1 - FL.dive)), 1.65));
  }

  const IMP = [{ t: 0.4, A: 0.26, who: 'cup' }, { t: 2.0, A: 0.07, who: 'sun', uni: true }, { t: 3.2, A: 0.07, who: 'sunset' },
    { t: 6.4, A: 0.24, who: 'pin' }, { t: 7.6, A: 0.14, who: 'heart' }, { t: 8.6, A: 0.1, who: 'm' }];
  const ANT = { cup: 0.17, sunset: 0.1, gull: 0.12, heart: 0.12 };
  function impact(t, who) {
    let q = 0, uni = 0;
    for (const im of IMP) {
      if (im.who !== who) continue;
      const tau = t - (im.t - 2 * FR); if (tau < 0 || tau > 1.2) continue;
      const v = im.A * Math.sin((2 * Math.PI * tau) / 0.28) * Math.exp(-tau * 7.5); if (im.uni) uni += v; else q += v;
    }
    for (const m of CUES.morphs) {
      const an = ANT[m.a]; if (!an || m.a !== who) continue; const tau = t - (m.t0 - 0.3);
      if (tau > 0 && tau < 0.3) q += an * EIO(clamp(tau / 0.2));
      else if (tau >= 0.3 && tau < 0.42) q += an * (1 - EO((tau - 0.3) / 0.12)) - 0.35 * an * Math.sin((Math.PI * (tau - 0.3)) / 0.12);
    }
    if (who === 'pin') { const tau = t - 6.86; if (tau > 0 && tau < 0.2) q += 0.12 * Math.sin((Math.PI * tau) / 0.2); }
    if (who === 'heart') for (const [tb, a] of [[CUES.heartbeat[0], 0.09], [CUES.heartbeat[1], 0.06]]) { const tau = t - tb + FR; if (tau > 0 && tau < 0.16) uni += a * Math.sin((Math.PI * tau) / 0.16); }
    return { q, uni };
  }
  function makeM(pos, rot, sc, phi, k, q, piv) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = [c * sc, -s * sc, s * sc, c * sc], D = [1 + q, 0, 0, 1 - q];
    const cp = Math.cos(phi), sp = Math.sin(phi), ik = 1 / k;
    const Q = [cp * cp * k + sp * sp * ik, cp * sp * (k - ik), cp * sp * (k - ik), sp * sp * k + cp * cp * ik];
    const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
    const QR = mul(Q, R), A = mul(QR, D);
    const dp = [piv[0] - D[0] * piv[0], piv[1] - D[3] * piv[1]];
    return { A, b: [pos[0] + QR[0] * dp[0] + QR[1] * dp[1], pos[1] + QR[2] * dp[0] + QR[3] * dp[1]] };
  }
  const seaSurface = (t) => (t < CUES.wipes.sea ? H + 2000 : lerp(H + 1400, 560, EO(clamp((t - CUES.wipes.sea) / 0.5))));
  const heroClip = (t) => (t <= 2.3 || t >= 4.45 ? null : seaSurface(t) + 300 * EIO(clamp((t - 3.84) / 0.13)));

  function blendParts(A, B, u, P) {
    let body, holes;
    const via = P && P.Ca, gA = EM(clamp(u / 0.5)), gB = EM(clamp((u - 0.5) / 0.5)), g = EM(u);
    if (via) body = u < 0.5 ? lerpP(A.body, P.Ca, gA) : lerpP(P.Cb, B.body, gB);
    else body = lerpP(A.body, shiftP(B.body, P ? P.sAB : 0), g);
    const hA = A.holes[0], hB = B.holes[0];
    if (hA.on && hB.on && !via) holes = [{ pts: lerpP(hA.pts, hB.pts, g), on: true }];
    else holes = [u < 0.5 ? { pts: lerpP(hA.pts, rep(centroid(hA.pts), NH), clamp(gA / 0.6)) } : { pts: lerpP(rep(centroid(hB.pts), NH), hB.pts, clamp((gB - 0.4) / 0.6)) }];
    const strokes = A.strokes.map((sa, k) => {
      const sb = B.strokes[k], o = [7, 0, 1, 2, 6, 3, 5, 4].indexOf(k) * 0.03, gk = EIO(clamp((u - 0.06 - o) / 0.7));
      const dies = sb.w === 0 && sa.w > 0, wk = dies ? 1 - smooth(0.2, 0.48, u) : 1;
      let pts = dies ? (() => { const md = sa.pts[NM >> 1], f = 1 - 0.7 * smooth(0.05, 0.48, u); return sa.pts.map((p) => [lerp(md[0], p[0], f), lerp(md[1], p[1], f)]); })() : lerpP(sa.pts, sb.pts, gk);
      if (via && P.via && !dies) {
        const s = Math.sin(Math.PI * clamp(u)), cx = P.via[0], cy = P.via[1], Rm = (P.via[2] + lerp(sa.w, sb.w, gk) / 2 + 18) * Math.min(1, 1.6 * s);
        const mid = pts[NM >> 1], sh = 1 - 0.55 * s;
        pts = pts.map((p) => { const q = [lerp(mid[0], p[0], sh), lerp(mid[1], p[1], sh)]; const dx = q[0] - cx, dy = q[1] - cy, d = Math.hypot(dx, dy) || 1; return d < Rm ? [cx + (dx / d) * Rm, cy + (dy / d) * Rm] : q; });
      }
      return { pts, w: lerp(sa.w, sb.w, gk) * wk };
    });
    const sA = A.shade, sB = B.shade;
    const shade = u < 0.5 ? { pts: lerpP(sA.pts, rep(centroid(sA.pts), NS), clamp(gA / 0.5)), on: sA.on } : { pts: lerpP(rep(centroid(sB.pts), NS), sB.pts, clamp((gB - 0.5) / 0.5)), on: sB.on };
    return { body, holes, strokes, shade };
  }

  function heroAt(t) {
    const L = CUES.land, FL = CUES.flight;
    if (t < drop.t1) {
      const ic = I.cup, st = state('cup', t), tl = L.cup;
      const body = t < 0.36 ? drop.Ca : lerpP(drop.Ca, st.body, EM((t - 0.36) / 0.26));
      const tt = Math.min(t, tl), y = ic.pos[1] - 700 * tl - 1600 * tl * tl + 700 * tt + 1600 * tt * tt;
      const k = 1 + 0.35 * (1 - smooth(tl - 2 * FR, tl + FR, t)), im = impact(t, 'cup');
      return { ...st, body, fill: C.ink, strokeC: C.ink, shadeC: ic.shadeC, shade: { pts: lerpP(rep(centroid(st.shade.pts), NS), st.shade.pts, EM(clamp((t - 0.36) / 0.26))), on: t > 0.4 },
        M: makeM([ic.pos[0], y], 0, ic.scale, Math.PI / 2, k, im.q, [0, 135]) };
    }
    if (t >= FL.t0 && t < FL.t1) {
      const u = flightU(t), pa = pathAt(u), pb = pathAt(flightU(t + 0.004));
      const speed = Math.hypot(pb.p[0] - pa.p[0], pb.p[1] - pa.p[1]) / 0.004;
      const m = CUES.morphs.find((x) => x.key === 'plane>pin'), mu = clamp((t - m.t0) / (m.t1 - m.t0)), g = EM(mu);
      const A = state('plane', t), B = state('pin', t), parts = t < m.t0 ? A : blendParts(A, B, mu, m.P);
      const rot = mu < 0.5 ? pa.ang + 35 * deg : pa.ang - 90 * deg;
      const ant = t < FL.launch ? EIO(clamp((t - FL.t0 - 0.02) / 0.2)) : 1 - EO(clamp((t - FL.launch) / 0.1));
      const hang = Math.sin(Math.PI * clamp((t - FL.apex + 0.01) / 0.15));
      const k = 1 - 0.16 * ant + 0.13 * clamp(speed / 2600) - 0.1 * hang + 0.08 * Math.sin(Math.PI * g);
      const pos = [pa.p[0] - 34 * ant * (t < FL.launch ? 1 : 0.6), pa.p[1]], im = impact(t, 'pin');
      return { ...parts, fill: C.cream, sweep: { to: C.verm, p: clamp(mu / 0.45), dir: pa.ang }, strokeC: C.cream, shadeC: mu < 0.5 ? I.plane.shadeC : I.pin.shadeC,
        M: makeM(pos, rot, lerp(I.plane.scale, I.pin.scale, g), pa.ang, k, mu > 0.5 ? im.q : 0, [0, 190]) };
    }
    const m = CUES.morphs.find((x) => x.P && x.key !== 'plane>pin' && t >= x.t0 && t < x.t1);
    if (m) {
      const u = clamp((t - m.t0) / (m.t1 - m.t0)), g = EM(u), A = state(m.a, t), B = state(m.b, t), IA = I[m.a], IB = I[m.b], P = m.P;
      const parts = blendParts(A, B, u, P);
      const ctrl = [(IA.pos[0] + IB.pos[0]) / 2 + P.ctrl[0], (IA.pos[1] + IB.pos[1]) / 2 + P.ctrl[1]];
      const pos = qbez(IA.pos, ctrl, IB.pos, g), p2 = qbez(IA.pos, ctrl, IB.pos, Math.min(1, g + 0.02)), p1 = qbez(IA.pos, ctrl, IB.pos, Math.max(0, g - 0.02));
      const phi = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 0.5 ? Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) : Math.PI / 2;
      const k = 1 + P.sq * Math.sin(Math.PI * g);
      const im = u > 0.5 ? impact(t, m.b) : impact(t, m.a), piv = u > 0.5 ? IB.piv : IA.piv;
      const swp = IA.fill !== IB.fill ? clamp((u - (P.sw ? P.sw[0] : 0.08)) / (P.sw ? P.sw[1] - P.sw[0] : 0.37)) : 0;
      return { ...parts, fill: IA.fill, sweep: IA.fill !== IB.fill ? { to: IB.fill, p: swp, dir: phi } : null, strokeC: mixC(IA.fill, IB.fill, smooth(0.47, 0.53, u)),
        shadeC: u < 0.5 ? IA.shadeC || IB.shadeC : IB.shadeC || IA.shadeC, clipY: heroClip(t),
        M: makeM(pos, lerp(IA.rot0 || 0, IB.rot0 || 0, g) + P.rot * deg * Math.sin(Math.PI * g), lerp(IA.scale, IB.scale, g) * (1 + im.uni), phi, k, im.q, piv) };
    }
    const order = ['cup', 'sun', 'sunset', 'gull', 'plane', 'pin', 'heart', 'm'];
    let cur = 'cup'; for (const n of order) if (t >= L[n]) cur = n;
    const ic = I[cur], st = state(cur, t), im = impact(t, cur);
    let pos = ic.pos, rot = 0;
    if (cur === 'gull') pos = [pos[0], pos[1] - 10 * Math.sin((2 * Math.PI * (t - 4.2)) / 0.4)];
    if (cur === 'pin') {
      const tau = t - L.pin; rot = 6 * deg * Math.sin((2 * Math.PI * tau) / 0.42) * Math.exp(-tau * 3.2) * smooth(0, 0.06, tau);
      const pv = ic.piv, c = Math.cos(rot), s = Math.sin(rot);
      pos = [pos[0] + ic.scale * (pv[0] - (c * pv[0] - s * pv[1])), pos[1] + ic.scale * (pv[1] - (s * pv[0] + c * pv[1]))];
    }
    const bq = ((t % 0.4) + 0.4) % 0.4, pulse = t < 8.0 ? 0.02 * Math.exp(-bq * 11) * (1 - Math.exp(-bq * 60)) * 1.25 : 0;
    return { ...st, fill: ic.fill, strokeC: ic.fill, shadeC: ic.shadeC, clipY: heroClip(t), M: makeM(pos, rot, ic.scale * (1 + im.uni + pulse), Math.PI / 2, 1, im.q, ic.piv) };
  }

  // ------------------------------------------------------------ colour-block field wipes
  const WP = CUES.wipes, LP = CUES.loop;
  const ORG = {};
  const org = (k, t) => ORG[k] || (ORG[k] = heroAt(t).M.b.slice());
  const farR = (o) => Math.max(...[[-600, -900], [W + 600, -900], [-600, H + 900], [W + 600, H + 900]].map((c) => Math.hypot(c[0] - o[0], c[1] - o[1])));
  function circleReg(t, t0, t1, o, r0 = 40) {
    if (t < t0) return null; if (t >= t1) return 'full';
    return { circle: [o[0], o[1], lerp(r0, farR(o), EB(clamp((t - t0) / (t1 - t0))))] };
  }
  function shockReg(t) {
    const t0 = CUES.shock, T = 0.55, tc = 0.045; if (t < t0) return null; if (t >= t0 + T) return 'full';
    const o = [960, LP.ground], tau = clamp(t - t0, 0, T);
    return { circle: [o[0], o[1], lerp(14, farR(o), (1 - Math.exp(-tau / tc)) / (1 - Math.exp(-T / tc)))] };
  }
  const seaTop = (t) => (t < WP.flood ? seaSurface(t) : lerp(560, -80, EIO(clamp((t - WP.flood) / 0.42))));
  const FIELDS = [
    { c: C.cream, ink: C.ink, reg: () => 'full' },
    { c: C.mari, ink: C.ink, reg: (t) => circleReg(t, WP.sun, WP.sun + 0.6, org('sun', WP.sun), 50) },
    { c: C.verm, ink: C.cream, reg: (t) => circleReg(t, WP.sky, WP.sky + 0.6, org('sky', WP.sky), 110) },
    { c: C.ultra, ink: C.cream, reg: (t) => { const y = seaTop(t); if (y >= H + 1950) return null; if (y <= -60) return 'full'; return { rect: [-2000, y, W + 4000, H - y + 4000] }; } },
    { c: C.cream, ink: C.ink, reg: shockReg },
    { c: C.verm, ink: C.cream, reg: (t) => circleReg(t, WP.heart, WP.heart + 0.55, org('heart', WP.heart), 98) },
    { c: C.ink, ink: C.cream, reg: (t) => circleReg(t, WP.ink, WP.ink + 0.6, org('ink', WP.ink), 60) }
  ];
  function inkAt(t) { let ink = C.ink; for (const f of FIELDS) if (f.reg(t) === 'full') ink = f.ink; return ink; }

  // ------------------------------------------------------------ drawing
  function polyPath(path, P) { path.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) path.lineTo(P[i][0], P[i][1]); path.closePath(); }
  function drawHero(ctx, t) {
    const h = heroAt(t), { A, b } = h.M, T = (p) => [A[0] * p[0] + A[1] * p[1] + b[0], A[2] * p[0] + A[3] * p[1] + b[1]];
    const gk = 1 - smooth(8.1, 8.5, t);
    const body = h.body.map(T); let y0 = 1e9, y1 = -1e9; for (const p of body) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const path = new Path2D(); polyPath(path, body); for (const hl of h.holes) polyPath(path, hl.pts.map(T));
    ctx.save();
    if (h.clipY != null) { ctx.beginPath(); ctx.rect(-2000, -2000, W + 4000, h.clipY + 2000); ctx.clip(); }
    const gr = ctx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, tone(h.fill, 0.028 * gk)); gr.addColorStop(1, tone(h.fill, -0.022 * gk));
    ctx.fillStyle = gr; ctx.fill(path, 'evenodd');
    if (h.sweep && h.sweep.p > 0) {
      ctx.save(); ctx.clip(path, 'evenodd');
      const nx = Math.cos(h.sweep.dir), ny = Math.sin(h.sweep.dir); let p0 = 1e9, p1 = -1e9;
      for (const q of body) { const d = q[0] * nx + q[1] * ny; if (d < p0) p0 = d; if (d > p1) p1 = d; }
      const e = p1 - (p1 - p0 + 4) * EIO(h.sweep.p), ox = nx * e, oy = ny * e, tx = -ny * 5000, ty = nx * 5000;
      ctx.fillStyle = h.sweep.to; ctx.beginPath();
      ctx.moveTo(ox - tx, oy - ty); ctx.lineTo(ox + tx, oy + ty); ctx.lineTo(ox + tx + nx * 5000, oy + ty + ny * 5000); ctx.lineTo(ox - tx + nx * 5000, oy - ty + ny * 5000); ctx.closePath();
      ctx.fill(); ctx.restore();
    }
    if (h.shade && h.shade.on && h.shadeC) { const sp = new Path2D(); polyPath(sp, h.shade.pts.map(T)); ctx.save(); ctx.clip(path, 'evenodd'); ctx.fillStyle = h.shadeC; ctx.fill(sp); ctx.restore(); }
    const sc = Math.sqrt(Math.abs(A[0] * A[3] - A[1] * A[2]));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = h.strokeC;
    for (const s of h.strokes) {
      const w = s.w * sc; if (w < 0.6) continue;
      const Q = s.pts.map(T); let len = 0; for (let i = 1; i < Q.length; i++) len += Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]);
      const al = smooth(0.7, 1.0, len / w); if (al <= 0.01) continue;
      ctx.globalAlpha = al; ctx.lineWidth = w; ctx.beginPath(); Q.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
    }
    ctx.restore();
  }

  function drawDecor(ctx, ink, t) {
    const FL = CUES.flight;
    if (t >= FL.launch && t < 6.4 + 4 * FR) { // dashed loop route behind the plane, collapses into the pin's ground ring
      const ue = Math.min(flightU(Math.min(t, 6.4)) - 125 / FP.len, 1), ce = clamp((t - 6.4) / (4 * FR)) ** 3;
      if (ue > 0.002) {
        ctx.save(); ctx.strokeStyle = ink; ctx.globalAlpha = 0.92; ctx.lineWidth = lerp(3, 5, ce); ctx.setLineDash(ce > 0.5 ? [] : [18, 13]);
        ctx.beginPath();
        for (let i = 0; i <= 400; i++) {
          const v = i / 400; let p = pathAt(lerp(0, ue, v)).p;
          if (ce > 0) { const a = Math.PI - 2 * Math.PI * v; p = [lerp(p[0], 960 + 24 * Math.cos(a), ce), lerp(p[1], 642 + 24 * 0.24 * Math.sin(a), ce)]; }
          i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke(); ctx.restore();
      }
    }
    if (t >= 6.38 && t < 7.4) {
      ctx.save(); ctx.strokeStyle = ink;
      for (let j = 0; j < 3; j++) {
        const tau = t - [6.4, 6.4 + 4 * FR, 6.64][j]; if (tau < 0 || tau > 0.85) continue; const e = EO(tau / 0.85);
        ctx.globalAlpha = 0.5 * (1 - tau / 0.85); ctx.lineWidth = 4.5 * (1 - e) + 1;
        ctx.beginPath(); ctx.ellipse(960, 642, 24 + 360 * e, (24 + 360 * e) * 0.24, 0, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.restore();
    }
    if (t >= 6.36 && t < 7.2) {
      const hop = t > 7.0 ? clamp((t - 7.0) / 0.12) : 0;
      ctx.save(); ctx.fillStyle = ink; ctx.globalAlpha = 0.14 * smooth(6.36, 6.44, t) * (1 - hop);
      ctx.beginPath(); ctx.ellipse(960, 644, 62 * (1 - 0.4 * hop), 11, 0, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
    }
  }

  function drawFields(ctx, t) {
    let start = 0; for (let i = FIELDS.length - 1; i >= 0; i--) if (FIELDS[i].reg(t) === 'full') { start = i; break; }
    for (let i = start; i < FIELDS.length; i++) {
      const r = FIELDS[i].reg(t); if (!r) continue;
      ctx.save();
      if (r !== 'full') { ctx.beginPath(); if (r.circle) ctx.arc(r.circle[0], r.circle[1], r.circle[2], 0, 2 * Math.PI); else ctx.rect(...r.rect); ctx.clip(); }
      ctx.fillStyle = FIELDS[i].c; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
      drawDecor(ctx, FIELDS[i].ink, t);
      ctx.restore();
    }
  }

  // wordmark: letters bud out of the hero disc and drop into their slots; vermilion full stop
  function drawWordmark(ctx, t, micro) {
    const LT = CUES.letters; if (t < LT.t0 - FR) return;
    const hm = I.m.pos;
    ctx.save(); ctx.font = WMK.font; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    WMK.letters.forEach((l, k) => {
      if (micro) return;
      const ts = LT.t0 + LT.step * Math.max(0, k - 1), tau = t - ts; if (k > 0 && tau < 0) return;
      const fly = k === 0 ? smooth(8.52, 8.62, t) : EO(clamp(tau / LT.fly));
      if (k === 0 && fly <= 0) return;
      const sx = k === 0 ? 0 : lerp(hm[0] - l.cen[0], 0, fly), sy = k === 0 ? 0 : lerp(hm[1] - l.cen[1], 0, fly) - 90 * Math.sin(Math.PI * fly);
      const land = k === 0 ? 0 : 0.12 * Math.sin((2 * Math.PI * clamp((tau - LT.fly) / 0.28))) * Math.exp(-clamp(tau - LT.fly, 0, 2) * 7.5) * (tau > LT.fly ? 1 : 0);
      const s = k === 0 ? 1 : lerp(0.2, 1, fly);
      ctx.save(); ctx.translate(l.cen[0] + sx, WMK.yB + sy); ctx.scale(s * (1 + land), s * (1 - land)); ctx.translate(-l.cen[0], -WMK.yB);
      ctx.globalAlpha = k === 0 ? fly : 1; ctx.fillStyle = C.cream; ctx.fillText(l.ch, l.x, WMK.yB); ctx.restore();
    });
    // full stop (the film's circle) lands last; then the heartbeat rings
    const td = LT.t0 + LT.step * 6, dk = EO(clamp((t - td) / LT.fly));
    if (dk > 0) {
      const d = WMK.dot, x = lerp(hm[0], d.cen[0], dk), y = lerp(hm[1], d.cen[1], dk) - 120 * Math.sin(Math.PI * dk);
      const beat = 1 + 0.12 * Math.exp(-Math.max(0, t - 9.4) * 9) * (t > 9.4 ? 1 : 0);
      ctx.fillStyle = C.verm; ctx.beginPath(); ctx.arc(x, y, d.r * beat, 0, 2 * Math.PI); ctx.fill();
      for (const [t0, col, R] of [[9.4, C.mari, 260], [9.43, C.verm, 200], [9.53, C.ultra, 240], [9.56, C.cream, 160]]) {
        const tau = t - t0; if (tau <= 0 || tau > 0.42) continue; const e = EO(clamp(tau / 0.45));
        ctx.globalAlpha = 1 - smooth(0.08, 0.42, tau); ctx.strokeStyle = col; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(d.cen[0], d.cen[1], 30 + (R - 30) * e, 0, 2 * Math.PI); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ camera (world drift + push to loop apex + impact shake)
  function camAt(t) {
    const dA = 1 - smooth(8.3, 9.0, t), rot = dA * 0.5 * deg * Math.sin((2 * Math.PI * t) / 6.4 + 0.6);
    const zx = clamp((t - 8.5) / 1.9);
    const z = 1.018 + dA * 0.012 * Math.sin((2 * Math.PI * t) / 3.2 + 2.2) + 0.036 * (1 - (1 - zx) * (1 - zx));
    const push = EIO(clamp((t - 5.78) / 0.28)), rel = EIO(clamp((t - 6.16) / 0.14));
    const hz = (0.1 * push + 0.012 * smooth(6.04, 6.16, t)) * (1 - rel);
    const apex = [LP.cx, LP.cy - LP.r], tip = [960, LP.ground], A = [lerp(apex[0], tip[0], rel), lerp(apex[1], tip[1], rel)];
    let dy = 110 * push * (1 - rel);
    for (const [ti, amp] of [[6.4, 13], [0.4, 5], [7.6, 5]]) { const tau = t - ti; if (tau > 0 && tau < 0.5) dy += amp * Math.sin((2 * Math.PI * tau) / 0.11) * Math.exp(-tau * 14); }
    const Z = z * (1 + hz), c = Math.cos(rot), s = Math.sin(rot), vx = -hz * A[0] - W / 2, vy = -hz * A[1] - H / 2;
    return [Z * c, Z * s, -Z * s, Z * c, z * (c * vx - s * vy) + W / 2, z * (s * vx + c * vy) + H / 2 + dy];
  }

  // ------------------------------------------------------------ UI: chapter caption + 7-dot progress (screen space)
  function drawUI(ctx, CW, CH, safe, ink, t, shot) {
    const a = 1 - smooth(8.0, 8.3, t); if (a <= 0) return;
    const tc = CUES.captions; let i = 0; for (let k = 0; k < tc.length; k++) if (t >= tc[k]) i = k;
    const p = i === 0 ? clamp((t - 0.05) / 0.36) : clamp((t - tc[i]) / 0.36), e = EM(p);
    const sc = Math.min(1, safe.w / 896);
    const x = safe.x + 8, y = safe.y + safe.h - 24;
    ctx.save(); ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic';
    ctx.beginPath(); ctx.rect(x - 6, y - 52 * sc, safe.w * 0.7, 66 * sc); ctx.clip();
    const label = (k) => (shot && shot.captions && shot.captions[k]) || EN[k];
    const draw = (k, dy, al) => {
      if (al <= 0.001) return; ctx.globalAlpha = a * al;
      ctx.font = `500 ${Math.round(20 * sc)}px "Courier New", monospace`; ctx.fillText(String(k + 1).padStart(2, '0'), x, y + dy - 3);
      ctx.globalAlpha = a * al * 0.45; ctx.fillText('/07', x + 30 * sc, y + dy - 3); ctx.globalAlpha = a * al;
      ctx.font = `600 ${Math.round(36 * sc)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`; ctx.fillText(label(k), x + 92 * sc, y + dy);
    };
    if (i === 0) draw(0, 52 * (1 - e), e); else if (p < 1) { draw(i - 1, -52 * e, 1 - e); draw(i, 52 * (1 - e), e); } else draw(i, 0, 1);
    ctx.restore();
    const act = i === 0 ? 0 : i - 1 + e;
    ctx.save(); ctx.fillStyle = ink; let xr = safe.x + safe.w - 10; const yd = y - 12 * sc;
    for (let k = 6; k >= 0; k--) {
      const wgt = Math.max(0, 1 - Math.abs(k - act)), len = 22 * EM(wgt) * sc, r = 4.5 * sc;
      ctx.globalAlpha = a * (0.3 + 0.7 * wgt); ctx.beginPath();
      ctx.arc(xr - len, yd, r, Math.PI / 2, (3 * Math.PI) / 2); ctx.arc(xr, yd, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      xr -= len + 20 * sc;
    }
    ctx.restore();
  }

  function drawTagline(ctx, safe, t, shot) {
    if (!shot.tagline || t < 8.95) return;
    const a = smooth(8.95, 9.35, t), sc = Math.min(1, safe.w / 896);
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = C.cream; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `500 ${Math.round(24 * sc)}px "Courier New", monospace`;
    ctx.fillText(String(shot.tagline).toUpperCase().split('').join(' '), safe.x + safe.w / 2, safe.y + safe.h - 40 - 12 * (1 - a));
    ctx.restore();
  }

  // ------------------------------------------------------------ public API
  const WINDOWS = { 'morning-cup': [0.55, 2.25], 'sun-to-sea': [2.65, 4.72], 'flight-loop': [5.35, 6.95], 'heart-wordmark': [7.45, 9.65] };
  function filmTime(layout, u) { const w = WINDOWS[layout] || WINDOWS['heart-wordmark']; return lerp(w[0], w[1], clamp(u)); }

  function measureShot(CW, CH, safe, shot, micro) {
    const portrait = CH > CW;
    const cx = CW * 0.5;
    const cy = portrait ? safe.y + safe.h * 0.47 : CH * 0.5;
    const halfW = Math.min(safe.w * 0.40, portrait ? 320 : 420);
    const halfH = Math.min(safe.h * 0.34, portrait ? 340 : 280);
    const minX = Math.max(safe.x + 24, cx - halfW);
    const maxX = Math.min(safe.x + safe.w - 24, cx + halfW);
    const minY = Math.max(safe.y + 32, cy - halfH);
    const maxY = Math.min(safe.y + safe.h - 32, cy + halfH);
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

  function renderShot(ctx, CW, CH, safe, shot, localTime, micro, cameraRig) {
    build();
    const u = clamp(localTime / Math.max(0.01, shot.duration || 7.5));
    const t = Math.round(filmTime(shot.layout, u) * FPS) / FPS;
    // world 1920x1080 -> canvas: landscape = identity fit, portrait = centred 1.38x crop of the action column
    const portrait = CH > CW;
    const s = portrait ? (CW / W) * 1.38 : CW / W;
    const ox = CW / 2 - 960 * s, oy = portrait ? safe.y + safe.h * 0.47 - 560 * s : CH / 2 - 540 * s;
    const cam = camAt(t);
    if (cameraRig && window.StoryCamera && typeof window.StoryCamera.apply2D === 'function') {
      // Keep full-bleed color fields untransformed so pull-out/pan never exposes edges
      ctx.save();
      ctx.setTransform(s, 0, 0, s, ox, oy); ctx.transform(...cam);
      drawFields(ctx, t);
      ctx.restore();

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      window.StoryCamera.apply2D(ctx, cameraRig, CW, CH);
      ctx.transform(s, 0, 0, s, ox, oy); ctx.transform(...cam);
      if (t < 8.55 || micro) drawHero(ctx, t);
      drawWordmark(ctx, t, micro);
      ctx.restore();
    } else {
      ctx.save();
      ctx.setTransform(s, 0, 0, s, ox, oy); ctx.transform(...cam);
      drawFields(ctx, t);
      // Once 'm' letter takes over at t >= 8.55, hide the circular hero placeholder (unless in microstock mode where the geometric disc stays visible!)
      if (t < 8.55 || micro) drawHero(ctx, t);
      drawWordmark(ctx, t, micro);
      ctx.restore();
    }
    if (!micro) { drawUI(ctx, CW, CH, safe, inkAt(t), t, shot); drawTagline(ctx, safe, t, shot); }
  }

  window.MorphKit = { renderShot, measureShot, filmTime, COLORS: C };
})();
