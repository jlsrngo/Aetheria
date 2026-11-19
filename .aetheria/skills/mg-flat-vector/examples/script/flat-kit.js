/**
 * FlatKit v2 — Popwise Bold Flat-Vector & Spring-Pop Engine
 * Adapted from references/aetheria-motion/demos/01-flat-vector/index.html.
 * Pure deterministic Canvas2D, zero external dependencies, 9:16 & 16:9 adaptive.
 */
(function () {
  'use strict';

  const C = {
    U: '#2B2BFF',
    UT: '#3B3BFF',
    UL: '#4D4DFF',
    CO: '#FF5A4E',
    SU: '#FFC62B',
    MI: '#2EE6A8',
    CR: '#FFF6E9',
    INK: '#151433'
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  function spring(t, f = 2.4, z = 0.42) {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * f, a = z * w, b = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-a * t) * (Math.cos(b * t) + (a / b) * Math.sin(b * t));
  }

  function hs(a, b = 0) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function drawSkyShapes(ctx, W, H, sc, u) {
    ctx.fillStyle = C.U;
    ctx.fillRect(0, 0, W, H);

    // Tone-on-tone geometric brand shapes
    ctx.save();
    ctx.strokeStyle = C.UT;
    ctx.fillStyle = C.UT;
    ctx.lineCap = 'round';
    ctx.lineWidth = 22 * sc;

    const s1 = spring(u * 2.2);
    if (s1 > 0.01) {
      ctx.beginPath();
      ctx.arc(W * 0.22, H * 0.26, 68 * sc * s1, 0, Math.PI * 2);
      ctx.stroke();
    }

    const px = W * 0.78, py = H * 0.30, pr = 26 * sc * spring(Math.max(0, u - 0.1) * 2.2);
    if (pr > 1) {
      ctx.beginPath();
      ctx.moveTo(px - pr, py); ctx.lineTo(px + pr, py);
      ctx.moveTo(px, py - pr); ctx.lineTo(px, py + pr);
      ctx.stroke();
    }

    const pw = 160 * sc * spring(Math.max(0, u - 0.15) * 2.2);
    if (pw > 2) {
      ctx.beginPath();
      ctx.roundRect(W * 0.28 - pw * 0.5, H * 0.62, pw, 52 * sc, 26 * sc);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCloud(ctx, x, y, sc) {
    ctx.save();
    ctx.fillStyle = C.CR;
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.roundRect(-80, -22, 160, 44, 22);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-20, -24, 34, 0, Math.PI * 2);
    ctx.arc(32, -16, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSunAndRays(ctx, cx, cy, r, sc, u) {
    ctx.save();
    ctx.fillStyle = C.CO;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 12 crisp rounded rays
    ctx.strokeStyle = C.CO;
    ctx.lineWidth = 10 * sc;
    ctx.lineCap = 'round';
    const rayLen = 36 * sc * smooth(0.1, 0.5, u);
    if (rayLen > 1) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + u * 0.35;
        const r0 = r + 18 * sc, r1 = r0 + rayLen;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSkyline(ctx, W, H, safe, sc, u) {
    const groundY = safe.y + safe.h * 0.78;

    // Far tone-on-tone skyline
    ctx.save();
    ctx.fillStyle = C.UL;
    for (let i = 0; i < 10; i++) {
      const bw = (70 + hs(i, 1) * 70) * sc;
      const bh = (160 + hs(i, 2) * 180) * sc * spring(Math.max(0, u - i * 0.03) * 2.0);
      const bx = safe.x + (i / 9.5) * safe.w * 0.92;
      ctx.fillRect(bx, groundY - bh, bw, bh);
    }
    ctx.restore();

    // Hero foreground flat-vector buildings
    const blds = [
      { f: 0.16, w: 120, h: 240, col: C.CR },
      { f: 0.36, w: 145, h: 330, col: C.SU },
      { f: 0.58, w: 130, h: 280, col: C.CR },
      { f: 0.78, w: 115, h: 210, col: C.MI }
    ];
    blds.forEach((b, i) => {
      const s = spring(Math.max(0, u - i * 0.06) * 2.1);
      const bh = b.h * sc * s;
      const bw = b.w * sc;
      const bx = safe.x + safe.w * b.f - bw * 0.5;
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.roundRect(bx, groundY - bh, bw, bh, [14 * sc, 14 * sc, 0, 0]);
      ctx.fill();

      // Crisp rounded windows
      ctx.fillStyle = b.col === C.CR ? C.U : C.INK;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          const wx = bx + bw * (0.26 + c * 0.34);
          const wy = groundY - bh + 30 * sc + r * 48 * sc;
          if (wy < groundY - 24 * sc) {
            ctx.beginPath();
            ctx.roundRect(wx, wy, 18 * sc, 24 * sc, 5 * sc);
            ctx.fill();
          }
        }
      }
    });

    // Ground strip
    ctx.fillStyle = C.INK;
    ctx.fillRect(0, groundY, W, H - groundY);
  }

  function renderShot(ctx, W, H, safe, shot, localTime, micro) {
    const dur = Math.max(0.01, shot.duration || 7.5);
    const u = clamp(localTime / dur);
    const isPortrait = H > W;
    const sc = isPortrait ? safe.w / 896 : safe.h / 908;
    const cx = safe.x + safe.w * 0.5;
    const cy = safe.y + safe.h * 0.45;

    if (shot.layout === 'sky-dot-bounce') {
      drawSkyShapes(ctx, W, H, sc, u);
      const bounceY = cy + 160 * sc - Math.abs(Math.sin(u * Math.PI * 2.5)) * 280 * sc * (1 - u * 0.5);
      drawSunAndRays(ctx, cx, bounceY, 68 * sc, sc, smooth(0.5, 0.9, u));
    } else if (shot.layout === 'city-pop-rise') {
      drawSkyShapes(ctx, W, H, sc, 1);
      drawSunAndRays(ctx, safe.x + safe.w * 0.76, safe.y + safe.h * 0.25, 74 * sc, sc, 1);
      drawCloud(ctx, safe.x + safe.w * 0.24 + u * 30 * sc, safe.y + safe.h * 0.22, sc * 0.9);
      drawCloud(ctx, safe.x + safe.w * 0.72 - u * 24 * sc, safe.y + safe.h * 0.38, sc * 0.7);
      drawSkyline(ctx, W, H, safe, sc, u);
    } else if (shot.layout === 'character-ping') {
      drawSkyShapes(ctx, W, H, sc, 1);
      drawSunAndRays(ctx, safe.x + safe.w * 0.76, safe.y + safe.h * 0.25, 74 * sc, sc, 1);
      drawSkyline(ctx, W, H, safe, sc, 1);

      // Notification Ping Bubble popping above the skyline
      const ps = spring(Math.max(0, u - 0.12) * 2.5);
      if (ps > 0.01) {
        const bx = cx, by = safe.y + safe.h * 0.36;
        ctx.save();
        ctx.translate(bx, by);
        ctx.scale(ps, ps);
        ctx.fillStyle = C.SU;
        ctx.beginPath();
        ctx.roundRect(-110 * sc, -48 * sc, 220 * sc, 96 * sc, 48 * sc);
        ctx.fill();
        ctx.fillStyle = C.CO;
        ctx.beginPath();
        ctx.arc(-50 * sc, 0, 18 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.INK;
        ctx.beginPath();
        ctx.roundRect(-12 * sc, -10 * sc, 84 * sc, 20 * sc, 10 * sc);
        ctx.fill();
        ctx.restore();
      }
    } else {
      // popwise-wordmark finale
      ctx.fillStyle = C.U;
      ctx.fillRect(0, 0, W, H);
      drawSkyShapes(ctx, W, H, sc, 1);

      // Bouncing Coral Dot next to wordmark
      const dotS = spring(u * 2.2);
      const dotY = cy - Math.abs(Math.sin(clamp((u - 0.3) * 2.5) * Math.PI)) * 60 * sc;
      ctx.fillStyle = C.CO;
      ctx.beginPath();
      ctx.arc(cx + (micro ? 0 : 230 * sc), dotY, 42 * sc * dotS, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!micro) {
      ctx.save();
      ctx.fillStyle = C.CR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const isFinale = shot.layout === 'popwise-wordmark';
      ctx.font = `800 ${Math.round((isFinale ? 96 : 56) * sc)}px "Fredoka", "Segoe UI", sans-serif`;
      ctx.fillText(String(shot.headline || 'popwise'), isFinale ? cx - 28 * sc : cx, isFinale ? cy : safe.y + 84 * sc);

      if (shot.tagline) {
        ctx.fillStyle = C.SU;
        ctx.font = `700 ${Math.round(20 * sc)}px "Courier New", monospace`;
        ctx.fillText(String(shot.tagline).toUpperCase(), cx, safe.y + safe.h - 48 * sc);
      }
      ctx.restore();
    }
  }

  window.FlatKit = { renderShot, C };
})();
