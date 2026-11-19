/**
 * CalligraphyKit v2 — Kinetic Calligraphy & Spring-Extruded Display Engine
 * Adapted from references/aetheria-motion/demos/18-hanazi/ (index.html spring physics, HZ extrusion, focus rays, sparkles).
 * Pure deterministic Canvas2D, zero external dependencies, 9:16 & 16:9 adaptive.
 */
(function () {
  'use strict';

  const PAL = {
    paper: '#F4EFE6',
    paperWarm: '#EAE2D3',
    ink: '#181614',
    red: '#C82822',
    gold: '#D4A359',
    white: '#FFFFFF'
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // Damped spring from 18-hanazi: zeta=0.517, omega=22 -> overshoot 1.15
  function spring(t, z = 0.517, w = 22) {
    if (t <= 0) return 0;
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }

  function hs(a, b = 0, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function drawXuanPaper(ctx, W, H) {
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, W, H);
    // Warm radial paper vignette
    const rg = ctx.createRadialGradient(W * 0.5, H * 0.45, W * 0.1, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    rg.addColorStop(0, 'rgba(255,252,245,0.45)');
    rg.addColorStop(1, 'rgba(218,205,186,0.52)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Subtle ink-paper fibers
    ctx.save();
    ctx.strokeStyle = 'rgba(24,22,20,0.035)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 36; i++) {
      const x = hs(i, 1) * W, y = hs(i, 2) * H;
      const a = hs(i, 3) * Math.PI * 2, len = 18 + hs(i, 4) * 32;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Variable-pressure sumi-e brush stroke along a spline
  function drawBrushStroke(ctx, pts, progress, maxW, seed = 1) {
    if (progress <= 0.01 || pts.length < 2) return;
    const steps = 48;
    const endStep = Math.max(2, Math.floor(steps * clamp(progress)));
    ctx.save();
    ctx.fillStyle = PAL.ink;
    for (let i = 0; i < endStep; i++) {
      const u = i / steps;
      const idx = u * (pts.length - 1);
      const i0 = Math.floor(idx), i1 = Math.min(pts.length - 1, i0 + 1), f = idx - i0;
      const x = lerp(pts[i0][0], pts[i1][0], f);
      const y = lerp(pts[i0][1], pts[i1][1], f);
      const taper = Math.sin(Math.pow(u, 0.75) * Math.PI);
      const r = maxW * (0.22 + 0.78 * taper) * (0.92 + 0.16 * hs(seed, i));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Enso (Zen circle) & expressive sumi-e calligraphy strokes
  function drawCalligraphyArt(ctx, cx, cy, sc, u, layout) {
    // Sweeping Enso circle
    const ensoPts = [];
    const ensoR = 210 * sc;
    for (let i = 0; i <= 24; i++) {
      const a = -Math.PI * 0.78 + (i / 24) * Math.PI * 1.88;
      ensoPts.push([cx + Math.cos(a) * ensoR, cy + Math.sin(a) * ensoR]);
    }
    const ensoProg = layout === 'brush-reveal' ? smooth(0.05, 0.75, u) : 1.0;
    drawBrushStroke(ctx, ensoPts, ensoProg, 24 * sc, 101);

    // Diagonal slash & horizontal balance stroke
    const slashPts = [
      [cx - 240 * sc, cy + 160 * sc],
      [cx - 40 * sc, cy - 20 * sc],
      [cx + 220 * sc, cy - 190 * sc]
    ];
    const slashProg = layout === 'brush-reveal' ? smooth(0.45, 0.95, u) : 1.0;
    drawBrushStroke(ctx, slashPts, slashProg, 16 * sc, 202);

    // Ink splatter droplets around the brush energy
    const splatCount = layout === 'ink-cascade' ? 22 : 12;
    const splatVis = layout === 'brush-reveal' ? smooth(0.5, 0.9, u) : 1.0;
    if (splatVis > 0.05) {
      ctx.save();
      ctx.fillStyle = PAL.ink;
      for (let k = 0; k < splatCount; k++) {
        const a = hs(k, 11) * Math.PI * 2;
        const d = (150 + hs(k, 12) * 210) * sc * splatVis;
        const r = (3 + hs(k, 13) * 11) * sc;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Manga/Editorial radial focus rays (from 18-hanazi focusD)
  function drawFocusRays(ctx, cx, cy, W, H, sc, alpha) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.fillStyle = PAL.ink;
    ctx.globalAlpha = alpha * 0.14;
    const n = 48;
    const R = Math.max(W, H) * 0.85;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (hs(i, 7) - 0.5) * 0.06;
      const w = 0.008 + hs(i, 8) * 0.014;
      const ri = (240 + hs(i, 9) * 110) * sc;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
      ctx.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R);
      ctx.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 4-point sparkle from 18-hanazi
  function drawSparkle(ctx, x, y, r, col) {
    if (r < 2) return;
    const k = r * 0.16;
    ctx.save();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + k, y - k, x + r, y);
    ctx.quadraticCurveTo(x + k, y + k, x, y + r);
    ctx.quadraticCurveTo(x - k, y + k, x - r, y);
    ctx.quadraticCurveTo(x - k, y - k, x, y - r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Spring-extruded kinetic display wordmark (18-hanazi HZ style)
  function drawKineticTitle(ctx, text, cx, cy, sc, localTime) {
    if (!text) return;
    const str = String(text).toUpperCase();
    const size = Math.round(92 * sc);
    ctx.save();
    ctx.font = `900 ${size}px "Arial Black", "Impact", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const widths = [...str].map((ch) => ctx.measureText(ch).width);
    const track = 8 * sc;
    const totalW = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, str.length - 1);
    let x = cx - totalW * 0.5;

    [...str].forEach((ch, i) => {
      const cw = widths[i];
      const t0 = i * 0.08;
      const u = localTime - t0;
      const s = u > 0 ? spring(u * 2.2) : 0;
      if (s > 0.01) {
        const px = x + cw * 0.5;
        const py = cy + Math.sin(localTime * 3 + i * 0.9) * 3 * sc;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(s, s);
        // 1. Extrude shadow
        ctx.fillStyle = PAL.ink;
        ctx.fillText(ch, 5 * sc, 7 * sc);
        // 2. White inner stroke
        ctx.lineJoin = 'round';
        ctx.strokeStyle = PAL.white;
        ctx.lineWidth = 10 * sc;
        ctx.strokeText(ch, 0, 0);
        // 3. Main sumi ink fill
        ctx.fillStyle = PAL.ink;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
      x += cw + track;
    });
    ctx.restore();
  }

  // Traditional Vermilion Hanko Seal Stamp
  function drawHankoStamp(ctx, cx, cy, sc, sealText, u) {
    const s = u < 0.25 ? lerp(1.6, 1.0, smooth(0, 0.25, u)) : 1.0;
    const alpha = smooth(0, 0.15, u);
    const size = 96 * sc;
    ctx.save();
    ctx.globalAlpha = alpha * 0.92;
    ctx.translate(cx, cy);
    ctx.rotate(-0.06);
    ctx.scale(s, s);
    ctx.strokeStyle = PAL.red;
    ctx.lineWidth = 6 * sc;
    ctx.strokeRect(-size * 0.5, -size * 0.5, size, size);
    ctx.fillStyle = PAL.red;
    ctx.font = `900 ${Math.round(54 * sc)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sealText || '印', 0, 2 * sc);
    ctx.restore();
  }

  function renderShot(ctx, W, H, safe, shot, localTime, micro) {
    const dur = Math.max(0.01, shot.duration || 7.5);
    const u = clamp(localTime / dur);
    const isPortrait = H > W;
    const sc = isPortrait ? safe.w / 896 : safe.h / 908;
    const cx = safe.x + safe.w * 0.5;
    const cy = safe.y + safe.h * 0.46;

    drawXuanPaper(ctx, W, H);

    if (shot.layout === 'focus-burst' || shot.layout === 'ink-cascade') {
      drawFocusRays(ctx, cx, cy, W, H, sc, smooth(0.05, 0.35, u));
    }

    drawCalligraphyArt(ctx, cx, cy, sc, u, shot.layout);

    // Sparkles around the Enso
    drawSparkle(ctx, cx - 230 * sc, cy - 180 * sc, 22 * sc * smooth(0.2, 0.5, u), PAL.gold);
    drawSparkle(ctx, cx + 240 * sc, cy + 170 * sc, 18 * sc * smooth(0.3, 0.6, u), PAL.red);

    if (!micro) {
      drawKineticTitle(ctx, shot.headline || 'SHODO', cx, cy, sc, localTime);
      drawHankoStamp(ctx, cx + 220 * sc, cy + 220 * sc, sc, shot.sealText || '印', u);

      if (shot.tagline) {
        ctx.save();
        ctx.fillStyle = PAL.ink;
        ctx.globalAlpha = 0.78 * smooth(0.15, 0.4, u);
        ctx.font = `700 ${Math.round(20 * sc)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(String(shot.tagline).toUpperCase(), cx, safe.y + safe.h - 48 * sc);
        ctx.restore();
      }
    }
  }

  window.CalligraphyKit = { renderShot, PAL };
})();
