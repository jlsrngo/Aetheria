/**
 * LineArtKit v2 — Atelier Linea Continuous One-Line & Gold Medallion Engine
 * Adapted from references/aetheria-motion/demos/02-line-art/film.js.
 * Pure deterministic Canvas2D + SVG path sampling, zero external dependencies, 9:16 & 16:9 adaptive.
 */
(function () {
  'use strict';

  const W = 1920, H = 1080, FPS = 30;
  const GOLD = [233, 215, 165], AGED = [150, 125, 80], HOT = [255, 246, 220], NAVY = [11, 19, 32];
  const MCX = 925, MCY = 330, MR = 135, FY = 454.58;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };

  function cubicBezier(p1x, p1y, p2x, p2y) {
    const bx = (t) => 3 * p1x * t * (1 - t) ** 2 + 3 * p2x * t * t * (1 - t) + t ** 3;
    const by = (t) => 3 * p1y * t * (1 - t) ** 2 + 3 * p2y * t * t * (1 - t) + t ** 3;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
      return by((lo + hi) / 2);
    };
  }
  const easeIO = cubicBezier(0.65, 0, 0.35, 1);
  const easeOut = cubicBezier(0.16, 1, 0.3, 1);
  const easeSwell = cubicBezier(0.24, 0.3, 0.2, 1);

  function mulberry(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngN = mulberry(20260927);
  const LAT = Array.from({ length: 4096 }, () => rngN() * 2 - 1);
  const vnoise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(LAT[i & 4095], LAT[(i + 1) & 4095], u); };

  const MOTES = Array.from({ length: 40 }, (_, i) => {
    const r = mulberry(4000 + i * 17);
    return { x: r() * 2300 - 230, y: r() * 1250 - 80, d: 0.3 + r() * 1.3, s: 0.7 + r() * 1.6, a: 0.05 + r() * 0.11, ph: r() * 6.283, sp: 3 + r() * 9 };
  });

  // ------------------------------------------------------------ Lazy SVG One-Line Path Builder
  let BUILT = false;
  let X = [], Y = [], S = [], P = [], WX = null, WY = null, FLOOR = null, N = 0, TOTAL = 0;
  let pieceStart = {}, pieceEnd = {};
  const LOGO = new Set(['ring', 'foot', 'arch']);

  function buildPath() {
    if (BUILT) return;
    BUILT = true;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute'; svg.style.left = '-10px'; svg.style.top = '-10px';
    document.body.appendChild(svg);

    const WV = { cx: 1400, cy: 600, r0: 64, r1: 22, th0: 0, th1: -2 * Math.PI };
    const wvPt = (u) => { const th = WV.th0 + u * (WV.th1 - WV.th0), r = WV.r0 * (WV.r1 / WV.r0) ** u; return [WV.cx + r * Math.cos(th), WV.cy + r * Math.sin(th)]; };
    const wvDir = (u0, u1) => { const a = wvPt(u0), b = wvPt(u1), l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const f3 = (v) => v.toFixed(3);
    const curlD = () => { let d = ''; for (let k = 1; k <= 180; k++) { const [x, y] = wvPt(k / 180); d += `L${f3(x)},${f3(y)} `; } return d; };
    const waveD = () => {
      const J = wvPt(0), dj = wvDir(0, 0.004), b0 = [1606, 721], l = Math.hypot(26, 3), bd = [-26 / l, -3 / l];
      return `C1628,740 1632,724 1606,721 C${f3(b0[0] + 75 * bd[0])},${f3(b0[1] + 75 * bd[1])} ${f3(J[0] - 55 * dj[0])},${f3(J[1] - 55 * dj[1])} ${f3(J[0])},${f3(J[1])}`;
    };
    const liftD = () => { const E = wvPt(1), de = wvDir(0.996, 1); return `C${f3(E[0] + 110 * de[0])},${f3(E[1] + 110 * de[1])} 1150,440 925,465`; };

    let L_TENDRIL = 60;
    const PIECES = [
      { n: 'ground0', a: 0.22, d: 'M-160,740 L272,740' },
      { n: 'seed', a: 0.3, d: 'C284,740 287,726 291,719 C294,713 298,709 302,706 C306,713 313,724 312,732 C311,739 302,742 296,740 C293,734 296,722 302,706' },
      { n: 'stem1', a: 0.4, d: 'C301,700 297,696 297,690' },
      { n: 'leaf1', a: 0.4, d: 'C288,694 267,691 253,674 C268,667 287,672 298,683' },
      { n: 'stem2', a: 0.4, d: 'C301,672 305,660 304,648' },
      { n: 'leaf2', a: 0.4, d: 'C314,650 335,646 349,628 C334,623 315,630 305,640' },
      { n: 'stem3', a: 0.4, d: 'C303,628 300,616 301,606' },
      { n: 'leaf3', a: 0.4, d: 'C293,607 279,603 270,589 C281,585 294,591 302,599' },
      { n: 'shoot', a: 0.3, d: 'C305,588 310,572 322,564 C334,558 346,560 358,560' },
      { n: 'tendril', a: 0.3, d: 'C372,560 384,552 386,540 C388,528 378,522 372,528' },
      { n: 'roof', a: 0.08, d: () => `M${(358 + L_TENDRIL).toFixed(3)},560 L660,560` },
      { n: 'pavilion', a: 0.06, d: 'L660,569 L462,569 L462,740 L529,740 L529,696 A22,22 0 0 1 573,696 L573,740 L660,740' },
      { n: 'tower', a: 0.05, d: 'L660,500 L742,470 L742,740' },
      { n: 'sky', a: 0.05, d: 'L770,740 L770,600 L808,600 L808,562 L852,562 L852,740 L874,740 L874,668 A37,37 0 0 1 948,668 L948,740 L972,740 L972,590 L990,590 L996,528 L1002,590 L1020,590 L1020,740' },
      { n: 'horizon', a: 0.14, d: 'L1600,740' },
      { n: 'wave', a: 0.3, d: waveD },
      { n: 'curl', a: 0.22, d: curlD() },
      { n: 'lift', a: 0.14, d: liftD },
      { n: 'ring', a: 0, d: 'A135,135 0 1 1 925,195 A135,135 0 1 1 925,465' },
      { n: 'foot', a: 0, d: 'A135,135 0 0 1 873,454.58' },
      { n: 'arch', a: 0, d: 'L873,318 A52,52 0 0 1 977,318 L977,454.58' }
    ];

    const STEP = 1.2;
    let s0 = 0, last = null;
    PIECES.forEach((pc, pi) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dd = typeof pc.d === 'function' ? pc.d() : pc.d;
      const d = dd.startsWith('M') ? dd : `M${last[0]},${last[1]} ${dd}`;
      el.setAttribute('d', d); svg.appendChild(el);
      const L = el.getTotalLength(), n = Math.max(2, Math.ceil(L / STEP));
      pieceStart[pc.n] = s0;
      for (let k = pi === 0 ? 0 : 1; k <= n; k++) {
        const p = el.getPointAtLength((L * k) / n);
        X.push(p.x); Y.push(p.y); S.push(s0 + (L * k) / n); P.push(pi);
      }
      s0 += L; pieceEnd[pc.n] = s0; last = [X[X.length - 1], Y[Y.length - 1]];
      if (pc.n === 'tendril') L_TENDRIL = L;
      svg.removeChild(el);
    });
    document.body.removeChild(svg);

    N = X.length; TOTAL = S[N - 1];
    WX = new Float32Array(N); WY = new Float32Array(N); FLOOR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2);
      let tx = X[b] - X[a], ty = Y[b] - Y[a]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const amp = PIECES[P[i]].a;
      const w = amp * (0.75 * vnoise(S[i] / 17) + 0.45 * vnoise(S[i] / 5.5 + 300));
      WX[i] = X[i] - ty * w; WY[i] = Y[i] + tx * w;
      const nm = PIECES[P[i]].n;
      if (LOGO.has(nm)) FLOOR[i] = 0.96;
      else if (nm === 'lift') FLOOR[i] = lerp(0.4, 0.96, smoother(0.1, 1, (S[i] - pieceStart.lift) / (pieceEnd.lift - pieceStart.lift)));
      else FLOOR[i] = 0.4;
    }
  }

  function idxAtS(s) {
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  function pointAtS(s) {
    const i = idxAtS(s), j = Math.min(N - 1, i + 1), f = S[j] > S[i] ? clamp((s - S[i]) / (S[j] - S[i])) : 0;
    return [lerp(WX[i], WX[j], f), lerp(WY[i], WY[j], f)];
  }

  function lineColor(b) {
    if (b <= 1) { const k = clamp((b - 0.4) / 0.6); return [lerp(AGED[0], GOLD[0], k), lerp(AGED[1], GOLD[1], k), lerp(AGED[2], GOLD[2], k)]; }
    const k = clamp((b - 1) / 0.6); return [lerp(GOLD[0], HOT[0], k), lerp(GOLD[1], HOT[1], k), lerp(GOLD[2], HOT[2], k)];
  }

  function doorPath(g, closed) {
    const aR = Math.atan2(FY - MCY, 52), aL = Math.atan2(FY - MCY, -52);
    g.beginPath(); g.moveTo(873, FY); g.lineTo(873, 318); g.arc(925, 318, 52, Math.PI, Math.PI * 2); g.lineTo(977, FY);
    if (closed) { g.arc(MCX, MCY, MR, aR, aL, false); g.closePath(); }
  }

  function drawBackground(ctx, CW, CH, c, t) {
    ctx.fillStyle = '#0B1320'; ctx.fillRect(0, 0, CW, CH);
    const rg = ctx.createRadialGradient(CW * 0.5, CH * 0.46, 0, CW * 0.5, CH * 0.5, Math.max(CW, CH) * 0.62);
    rg.addColorStop(0, 'rgba(26,40,62,0.58)'); rg.addColorStop(0.55, 'rgba(15,25,42,0.28)'); rg.addColorStop(1, 'rgba(4,8,14,0.0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, CW, CH);
    const sp = 48, r = 1.2;
    ctx.fillStyle = `rgba(160,180,210,${0.085 + 0.04 * (1 - smooth(0.2, 0.5, t))})`;
    const ox = (c.cx * 0.3) % sp, oy = (c.cy * 0.3) % sp;
    for (let gx = -ox; gx < CW; gx += sp) for (let gy = -oy; gy < CH; gy += sp) ctx.fillRect(gx - r, gy - r, 2 * r, 2 * r);
  }

  function drawMotes(ctx, CW, CH, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const m of MOTES) {
      const sx = ((m.x + 12 * Math.sin(t * 0.37 + m.ph)) / W) * CW;
      const sy = (((m.y - t * m.sp * 6 + 6 * Math.sin(t * 0.61 + m.ph * 1.7)) % H + H) % H / H) * CH;
      const r = m.s * (0.7 + 0.8 * m.d) * 2.2;
      const a = m.a * (0.8 + 0.2 * Math.sin(t * 1.3 + m.ph));
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(226,196,138,${a})`); g.addColorStop(1, 'rgba(226,196,138,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  function glowAt(ctx, sx, sy, r, a, col) {
    if (a <= 0.002) return;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
  }

  function drawMedallion(ctx, t, fillStart, zoom) {
    if (t < fillStart) return;
    const u = clamp((t - fillStart) / 0.55), e = easeSwell(u);
    const ri = Math.max(0, MR * (1 - Math.min(1, e)));
    const ro = MR + 1.5 / zoom;
    ctx.save();
    const lgr = ctx.createLinearGradient(815, 205, 1035, 455);
    lgr.addColorStop(0, '#F2E0AE'); lgr.addColorStop(0.42, '#DDC284'); lgr.addColorStop(0.7, '#CCAB6C'); lgr.addColorStop(1, '#A8874E');
    ctx.beginPath(); ctx.arc(MCX, MCY, ro, 0, Math.PI * 2);
    if (ri > 0.3) { ctx.moveTo(MCX + ri, MCY); ctx.arc(MCX, MCY, ri, 0, Math.PI * 2, true); }
    ctx.fillStyle = lgr; ctx.fill('evenodd');
    // Carve doorway arch
    ctx.fillStyle = '#0B1320'; doorPath(ctx, true); ctx.fill();
    // Directional bevel
    const bev = smooth(fillStart + 0.15, fillStart + 0.45, t);
    if (bev > 0) {
      ctx.lineWidth = 2.0 / zoom;
      ctx.strokeStyle = `rgba(255,246,220,${0.75 * bev})`; ctx.beginPath(); ctx.arc(MCX, MCY, ro - 0.8 / zoom, Math.PI * 0.86, Math.PI * 1.86); ctx.stroke();
      ctx.strokeStyle = `rgba(110,84,40,${0.9 * bev})`; ctx.beginPath(); ctx.arc(MCX, MCY, ro - 0.5 / zoom, Math.PI * 1.86, Math.PI * 2.86); ctx.stroke();
      ctx.strokeStyle = `rgba(255,246,220,${0.85 * bev})`; doorPath(ctx, false); ctx.stroke();
    }
    // Expanding 1px echo ring
    const eq = clamp((t - (fillStart + 0.12)) / 0.85);
    if (eq > 0 && eq < 1) {
      ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = `rgba(240,222,176,${(0.75 * (1 - eq) ** 1.4).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(MCX, MCY, MR * (1 + 0.6 * (1 - (1 - eq) ** 2)), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTypography(ctx, CW, CH, safe, shot, u, micro) {
    if (micro) return;
    const sc = Math.min(1, safe.w / 896);
    const cx = safe.x + safe.w * 0.5;
    const y = shot.layout === 'atelier-medallion' ? safe.y + safe.h * 0.72 : safe.y + safe.h - 110 * sc;
    const word = String(shot.headline || 'ATELIER LINEA').toUpperCase();
    const alpha = smooth(0.08, 0.35, u);
    ctx.save();
    ctx.globalAlpha = alpha * 0.95; ctx.fillStyle = '#E9D7A5'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `500 ${Math.round((shot.layout === 'atelier-medallion' ? 48 : 34) * sc)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(word.split('').join(' '), cx, y);
    if (shot.tagline) {
      const ty = y + 42 * sc;
      ctx.globalAlpha = alpha * 0.75;
      ctx.font = `400 ${Math.round(18 * sc)}px "Courier New", monospace`;
      const tag = String(shot.tagline).toUpperCase().split('').join(' ');
      const tw = ctx.measureText(tag).width;
      ctx.fillText(tag, cx, ty);
      const hl = 28 * easeOut(clamp(u * 1.6)) * sc, gap = 18 * sc;
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillRect(cx - tw / 2 - gap - hl, ty - 6 * sc, hl, 1.5);
      ctx.fillRect(cx + tw / 2 + gap, ty - 6 * sc, hl, 1.5);
    }
    ctx.restore();
  }

  const RANGES = {
    'seed-sprout': ['ground0', 'tendril', 1.8, 0.35],
    'pavilion-skyline': ['roof', 'sky', 1.35, 0.55],
    'breaking-wave': ['horizon', 'lift', 1.35, 0.65],
    'atelier-medallion': ['ring', 'arch', 1.55, 0.52]
  };

  function renderShot(ctx, CW, CH, safe, shot, localTime, micro) {
    buildPath();
    const u = clamp(localTime / Math.max(0.01, shot.duration || 7.5));
    const [pStart, pEnd, zoomTarget, camYFrac] = RANGES[shot.layout] || RANGES['atelier-medallion'];
    const sA = pieceStart[pStart], sB = pieceEnd[pEnd];
    const drawU = shot.layout === 'atelier-medallion' ? easeIO(clamp(u / 0.42)) : easeIO(clamp(u / 0.88));
    const sHead = lerp(sA, sB, drawU);
    const tip = pointAtS(sHead);

    // Camera follows the drawing tip, then settles onto the hero composition
    const baseScale = CH > CW ? (CW / W) * zoomTarget * 1.45 : (CW / W) * zoomTarget;
    const settle = smooth(0.55, 0.92, u);
    const midX = (pointAtS(sA)[0] + pointAtS(sB)[0]) * 0.5;
    const midY = (pointAtS(sA)[1] + pointAtS(sB)[1]) * 0.5;
    const cx = shot.layout === 'atelier-medallion' ? MCX : lerp(tip[0], midX, settle);
    const cy = shot.layout === 'atelier-medallion' ? MCY + 40 : lerp(tip[1], midY, settle);

    drawBackground(ctx, CW, CH, { cx, cy }, localTime);
    drawMotes(ctx, CW, CH, localTime);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(CW * 0.5, safe.y + safe.h * camYFrac);
    ctx.scale(baseScale, baseScale);
    ctx.translate(-cx, -cy);

    // Draw continuous line from origin up to sHead
    const iHead = idxAtS(sHead);
    const CHUNK = 10;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i0 = 0; i0 < iHead; i0 += CHUNK) {
      const i1 = Math.min(iHead, i0 + CHUNK), im = (i0 + i1) >> 1;
      const distFromHead = Math.max(0, sHead - S[im]);
      const b = FLOOR[im] + (1 - FLOOR[im]) * Math.exp(-distFromHead / 180);
      const col = lineColor(b);
      const taper0 = smooth(0, 110, S[im]);
      const r = lerp(NAVY[0], col[0], taper0), g = lerp(NAVY[1], col[1], taper0), bl = lerp(NAVY[2], col[2], taper0);
      ctx.lineWidth = (3.5 / baseScale) * (0.4 + 0.6 * taper0);
      ctx.strokeStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
      ctx.beginPath(); ctx.moveTo(WX[i0], WY[i0]);
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(WX[i], WY[i]);
      if (i1 === iHead) ctx.lineTo(tip[0], tip[1]);
      ctx.stroke();
    }

    if (shot.layout === 'atelier-medallion') {
      drawMedallion(ctx, u, 0.42, baseScale);
    }
    ctx.restore();

    // Hot glowing pen tip in screen space
    const sx = CW * 0.5 + (tip[0] - cx) * baseScale;
    const sy = safe.y + safe.h * camYFrac + (tip[1] - cy) * baseScale;
    const tipVis = shot.layout === 'atelier-medallion' ? 1 - smooth(0.4, 0.55, u) : 1;
    if (tipVis > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, sx, sy, 44, 0.14 * tipVis, '214,178,112');
      glowAt(ctx, sx, sy, 16, 0.45 * tipVis, '238,210,150');
      glowAt(ctx, sx, sy, 4, 0.95 * tipVis, '255,250,236');
      ctx.restore();
    }

    drawTypography(ctx, CW, CH, safe, shot, u, micro);
  }

  window.LineArtKit = { renderShot };
})();
