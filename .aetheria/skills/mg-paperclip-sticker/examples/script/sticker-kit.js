/**
 * StickerKit v2 — Paperclip Die-Cut Sticker & Editorial Infographic Engine
 * Adapted from references/aetheria-motion/demos/19-paperclip/index.html.
 * Pure deterministic Canvas2D, zero external dependencies, 9:16 & 16:9 adaptive.
 */
(function () {
  'use strict';

  const PAL = {
    desk: '#1D2731',
    deskDeep: '#161E26',
    bezel: '#0E141A',
    screen: '#E9EEF2',
    dot: '#C5CFD8',
    card: '#F7F9FB',
    border: '#CDD6DE',
    ink: '#25313D',
    mid: '#8C9AA8',
    orange: '#FF5A36'
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const wob = (dt, f = 4.5, k = 10) => (dt < 0 ? 0 : Math.exp(-k * dt) * Math.cos(2 * Math.PI * f * dt));

  // Sticker slap physics from 19-paperclip
  function slap(t, land, dur = 0.22, amp = 0.32) {
    const p = (t - (land - dur)) / dur;
    if (p < 0) return { o: 0, s: 1 + amp, r: 6, lift: 1 };
    if (p < 1) {
      const L = 1 - p * p;
      return { o: clamp(p * 5), s: 1 + amp * L, r: 6 * L, lift: L };
    }
    const w = wob(t - land, 4.5, 10);
    return { o: 1, s: 1 - 0.035 * w, r: -0.8 * w, lift: 0 };
  }

  function drawDotBoard(ctx, x, y, w, h, radius = 0) {
    ctx.save();
    if (radius > 0) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.clip();
    }
    ctx.fillStyle = PAL.screen;
    ctx.fillRect(x, y, w, h);

    const sp = 44;
    ctx.fillStyle = PAL.dot;
    for (let gy = y + 22; gy < y + h; gy += sp) {
      for (let gx = x + 22; gx < x + w; gx += sp) {
        ctx.beginPath();
        ctx.arc(gx, gy, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawDieCutSticker(ctx, x, y, w, h, rotDeg, sl, drawInner) {
    if (sl.o <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = sl.o;
    ctx.translate(x, y);
    ctx.rotate(((rotDeg + sl.r) * Math.PI) / 180);
    ctx.scale(sl.s, sl.s);

    // Dynamic lift shadow
    const shY = 6 + 28 * sl.lift;
    const shBlur = 10 + 26 * sl.lift;
    ctx.shadowColor = `rgba(22,34,46,${(0.24 - 0.08 * sl.lift).toFixed(2)})`;
    ctx.shadowBlur = shBlur;
    ctx.shadowOffsetY = shY;

    // Thick white die-cut sticker border
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(-w * 0.5, -h * 0.5, w, h, 22);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = PAL.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (drawInner) drawInner(ctx, w, h);
    ctx.restore();
  }

  // Vector hardware stickers (Smartphone, PCB Chip, Battery Cell)
  function drawPhoneSticker(ctx, w, h) {
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    ctx.roundRect(-w * 0.34, -h * 0.4, w * 0.68, h * 0.8, 18);
    ctx.fill();
    ctx.fillStyle = '#384858';
    ctx.beginPath();
    ctx.roundRect(-w * 0.28, -h * 0.33, w * 0.56, h * 0.66, 12);
    ctx.fill();
    ctx.fillStyle = PAL.orange;
    ctx.beginPath();
    ctx.arc(0, -h * 0.04, w * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawChipSticker(ctx, w, h) {
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    ctx.roundRect(-w * 0.28, -h * 0.28, w * 0.56, h * 0.56, 10);
    ctx.fill();
    ctx.strokeStyle = PAL.orange;
    ctx.lineWidth = 4;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * w * 0.14, -h * 0.38); ctx.lineTo(i * w * 0.14, -h * 0.28);
      ctx.moveTo(i * w * 0.14, h * 0.28); ctx.lineTo(i * w * 0.14, h * 0.38);
      ctx.moveTo(-w * 0.38, i * h * 0.14); ctx.lineTo(-w * 0.28, i * h * 0.14);
      ctx.moveTo(w * 0.28, i * h * 0.14); ctx.lineTo(w * 0.38, i * h * 0.14);
      ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBatterySticker(ctx, w, h) {
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    ctx.roundRect(-w * 0.24, -h * 0.32, w * 0.48, h * 0.66, 10);
    ctx.fill();
    ctx.fillRect(-w * 0.1, -h * 0.38, w * 0.2, h * 0.07);
    ctx.fillStyle = PAL.orange;
    ctx.beginPath();
    ctx.roundRect(-w * 0.17, -h * 0.06, w * 0.34, h * 0.32, 6);
    ctx.fill();
  }

  function drawElementTile(ctx, x, y, size, num, sym, sl, micro) {
    drawDieCutSticker(ctx, x, y, size, size, 0, sl, (c, w, h) => {
      c.fillStyle = PAL.card;
      c.beginPath();
      c.roundRect(-w * 0.44, -h * 0.44, w * 0.88, h * 0.88, 12);
      c.fill();
      if (!micro) {
        c.fillStyle = PAL.mid;
        c.font = `600 ${Math.round(size * 0.14)}px "Inter", sans-serif`;
        c.textAlign = 'left';
        c.fillText(num, -w * 0.34, -h * 0.24);
        c.fillStyle = PAL.ink;
        c.font = `800 ${Math.round(size * 0.36)}px "Inter", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(sym, 0, h * 0.06);
      } else {
        c.fillStyle = PAL.orange;
        c.beginPath();
        c.arc(0, 0, size * 0.18, 0, Math.PI * 2);
        c.fill();
      }
    });
  }

  function renderShot(ctx, W, H, safe, shot, localTime, micro) {
    const dur = Math.max(0.01, shot.duration || 7.5);
    const u = clamp(localTime / dur);
    const isPortrait = H > W;
    const sc = isPortrait ? safe.w / 896 : safe.h / 908;
    const cx = safe.x + safe.w * 0.5;
    const cy = safe.y + safe.h * 0.5;

    if (shot.layout === 'bezel-pullback') {
      // Dark desk + rounded device bezel pullback
      const g = ctx.createRadialGradient(W * 0.35, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
      g.addColorStop(0, '#27333F');
      g.addColorStop(0.55, PAL.desk);
      g.addColorStop(1, PAL.deskDeep);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const bw = safe.w * 0.92, bh = safe.h * 0.92;
      const bx = cx - bw * 0.5, by = cy - bh * 0.5;
      ctx.save();
      ctx.fillStyle = PAL.bezel;
      ctx.beginPath();
      ctx.roundRect(bx - 18 * sc, by - 18 * sc, bw + 36 * sc, bh + 36 * sc, 54 * sc);
      ctx.fill();
      ctx.strokeStyle = PAL.card;
      ctx.lineWidth = 6 * sc;
      ctx.stroke();
      ctx.restore();

      drawDotBoard(ctx, bx, by, bw, bh, 40 * sc);
    } else {
      drawDotBoard(ctx, 0, 0, W, H);
    }

    // Stickers & Editorial Elements
    if (shot.layout === 'sticker-slap') {
      drawDieCutSticker(ctx, cx, cy - 80 * sc, 280 * sc, 380 * sc, -4, slap(u, 0.18), drawPhoneSticker);
      drawDieCutSticker(ctx, cx - 190 * sc, cy + 190 * sc, 180 * sc, 180 * sc, 6, slap(u, 0.38), drawChipSticker);
      drawDieCutSticker(ctx, cx + 190 * sc, cy + 170 * sc, 170 * sc, 210 * sc, -5, slap(u, 0.55), drawBatterySticker);
    } else if (shot.layout === 'supply-chain') {
      // Dashed route connecting die-cut nodes
      const nodes = [
        [cx - 210 * sc, cy - 160 * sc],
        [cx + 200 * sc, cy - 60 * sc],
        [cx - 120 * sc, cy + 190 * sc],
        [cx + 180 * sc, cy + 230 * sc]
      ];
      ctx.save();
      ctx.strokeStyle = PAL.orange;
      ctx.lineWidth = 5 * sc;
      ctx.setLineDash([14 * sc, 10 * sc]);
      ctx.beginPath();
      nodes.forEach((n, i) => (i ? ctx.lineTo(n[0], n[1]) : ctx.moveTo(n[0], n[1])));
      ctx.stroke();
      ctx.restore();

      drawDieCutSticker(ctx, nodes[0][0], nodes[0][1], 170 * sc, 170 * sc, -6, slap(u, 0.15), drawChipSticker);
      drawDieCutSticker(ctx, nodes[1][0], nodes[1][1], 170 * sc, 200 * sc, 5, slap(u, 0.32), drawBatterySticker);
      drawDieCutSticker(ctx, nodes[2][0], nodes[2][1], 210 * sc, 270 * sc, -3, slap(u, 0.48), drawPhoneSticker);
      drawElementTile(ctx, nodes[3][0], nodes[3][1], 130 * sc, '27', 'Co', slap(u, 0.62), micro);
    } else if (shot.layout === 'chip-matrix') {
      const elems = [
        ['03', 'Li'], ['27', 'Co'],
        ['50', 'Sn'], ['57', 'La']
      ];
      elems.forEach(([num, sym], i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const tx = cx + (col - 0.5) * 230 * sc;
        const ty = cy + (row - 0.5) * 230 * sc;
        drawElementTile(ctx, tx, ty, 190 * sc, num, sym, slap(u, 0.12 + i * 0.14), micro);
      });
    } else {
      // bezel-pullback finale
      drawDieCutSticker(ctx, cx, cy - 60 * sc, 230 * sc, 310 * sc, -3, slap(u, 0.15), drawPhoneSticker);
      drawElementTile(ctx, cx - 210 * sc, cy + 160 * sc, 130 * sc, '03', 'Li', slap(u, 0.30), micro);
      drawElementTile(ctx, cx + 210 * sc, cy + 160 * sc, 130 * sc, '27', 'Co', slap(u, 0.42), micro);
    }

    if (!micro) {
      ctx.save();
      ctx.fillStyle = PAL.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `900 ${Math.round(54 * sc)}px "Inter", "Segoe UI", sans-serif`;
      ctx.fillText(String(shot.headline || 'PAPERCLIP').toUpperCase(), cx, safe.y + 92 * sc);

      if (shot.tagline) {
        ctx.fillStyle = PAL.orange;
        ctx.font = `700 ${Math.round(20 * sc)}px "Courier New", monospace`;
        ctx.fillText(String(shot.tagline).toUpperCase(), cx, safe.y + safe.h - 54 * sc);
      }
      ctx.restore();
    }
  }

  window.StickerKit = { renderShot, PAL };
})();
