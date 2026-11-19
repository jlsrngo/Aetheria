(function () {
  'use strict';

  var THEMES = {
    'desk-slate': {
      bg: '#E9EEF2',
      dots: 'rgba(15, 23, 42, 0.10)',
      card: '#FFFFFF',
      ink: '#0F172A',
      muted: '#475569',
      accent: '#FF5A36',
      accent2: '#2563EB',
      tape: 'rgba(253, 224, 71, 0.68)',
      highlight: 'rgba(254, 240, 138, 0.85)'
    },
    'explainer-coral': {
      bg: '#FDECE8',
      dots: 'rgba(234, 88, 12, 0.12)',
      card: '#FFFFFF',
      ink: '#1E1B18',
      muted: '#57534E',
      accent: '#EA580C',
      accent2: '#0D9488',
      tape: 'rgba(147, 197, 253, 0.65)',
      highlight: 'rgba(253, 186, 116, 0.72)'
    },
    'studio-mint': {
      bg: '#E6F4F1',
      dots: 'rgba(13, 148, 136, 0.12)',
      card: '#FFFFFF',
      ink: '#0F2926',
      muted: '#3F625D',
      accent: '#0D9488',
      accent2: '#F97316',
      tape: 'rgba(251, 191, 36, 0.62)',
      highlight: 'rgba(167, 243, 208, 0.85)'
    },
    'notebook-warm': {
      bg: '#F4EFE6',
      dots: 'rgba(28, 25, 23, 0.11)',
      card: '#FFFDF9',
      ink: '#1C1917',
      muted: '#57534E',
      accent: '#E11D48',
      accent2: '#2563EB',
      tape: 'rgba(196, 181, 253, 0.65)',
      highlight: 'rgba(254, 240, 138, 0.88)'
    },
    'blueprint-desk': {
      bg: '#DCE7F3',
      dots: 'rgba(30, 58, 138, 0.12)',
      card: '#FFFFFF',
      ink: '#0F172A',
      muted: '#334155',
      accent: '#2563EB',
      accent2: '#FF5A36',
      tape: 'rgba(253, 186, 116, 0.68)',
      highlight: 'rgba(186, 230, 253, 0.90)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['desk-slate'];
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawDeskBackdrop(ctx, w, h, theme) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Drafting dot matrix
    ctx.fillStyle = theme.dots;
    var step = 40;
    for (var y = 24; y < h; y += step) {
      for (var x = 24; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawWashiTape(ctx, cx, cy, w, h, angle, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
    ctx.restore();
  }

  function drawPaperclip(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.18);
    ctx.scale(scale || 1, scale || 1);
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, 26);
    ctx.lineTo(-12, -28);
    ctx.arc(0, -28, 12, Math.PI, 0, false);
    ctx.lineTo(12, 34);
    ctx.arc(2, 34, 10, 0, Math.PI, false);
    ctx.lineTo(-8, -14);
    ctx.arc(0, -14, 8, Math.PI, 0, false);
    ctx.lineTo(8, 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawStickerCard(ctx, x, y, w, h, theme, opts) {
    opts = opts || {};
    ctx.save();
    // Soft realistic desk shadow
    ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, x, y, w, h, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Thick die-cut white border + bold ink outline
    roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 18);
    ctx.fillStyle = theme.card;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 4;
    ctx.stroke();

    if (opts.tape) {
      drawWashiTape(ctx, x + w * 0.5, y + 6, 150, 32, -0.05, theme.tape);
    }
    if (opts.clip) {
      drawPaperclip(ctx, x + 62, y + 10, 1.0);
    }
    ctx.restore();
  }

  function drawDiecutSticker(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var tilt = Math.sin(t * 2.2) * 0.04;
    ctx.rotate(tilt);
    var s = size * 0.5;

    // White die-cut sticker halo + drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.90, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.stroke();

    if (name === 'phone-diecut') {
      roundRect(ctx, -s * 0.36, -s * 0.58, s * 0.72, s * 1.16, 14);
      ctx.fillStyle = theme.ink;
      ctx.fill();
      roundRect(ctx, -s * 0.28, -s * 0.44, s * 0.56, s * 0.84, 6);
      ctx.fillStyle = theme.accent2;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-s * 0.14, -s * 0.18, s * 0.28, s * 0.08);
      ctx.fillRect(-s * 0.14, 0, s * 0.20, s * 0.08);
    } else if (name === 'chip-diecut') {
      roundRect(ctx, -s * 0.44, -s * 0.44, s * 0.88, s * 0.88, 12);
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-s * 0.22, -s * 0.22, s * 0.44, s * 0.44);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 4;
      for (var p = -1; p <= 1; p++) {
        ctx.beginPath();
        ctx.moveTo(p * s * 0.24, -s * 0.44); ctx.lineTo(p * s * 0.24, -s * 0.68);
        ctx.moveTo(p * s * 0.24, s * 0.44); ctx.lineTo(p * s * 0.24, s * 0.68);
        ctx.stroke();
      }
    } else if (name === 'globe-diecut') {
      ctx.fillStyle = theme.accent2;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.54, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.26, s * 0.54, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.54, 0); ctx.lineTo(s * 0.54, 0); ctx.stroke();
    } else if (name === 'flask-diecut') {
      ctx.beginPath();
      ctx.moveTo(-s * 0.16, -s * 0.55);
      ctx.lineTo(s * 0.16, -s * 0.55);
      ctx.lineTo(s * 0.16, -s * 0.18);
      ctx.lineTo(s * 0.48, s * 0.48);
      ctx.lineTo(-s * 0.48, s * 0.48);
      ctx.lineTo(-s * 0.16, -s * 0.18);
      ctx.closePath();
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.stroke();
    } else if (name === 'battery-diecut') {
      roundRect(ctx, -s * 0.52, -s * 0.32, s * 0.94, s * 0.64, 10);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(-s * 0.42, -s * 0.22, s * 0.58, s * 0.44);
      ctx.fillStyle = theme.ink;
      ctx.fillRect(s * 0.42, -s * 0.14, s * 0.14, s * 0.28);
    } else {
      // rocket-diecut
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.62);
      ctx.quadraticCurveTo(s * 0.42, -s * 0.1, s * 0.24, s * 0.46);
      ctx.lineTo(-s * 0.24, s * 0.46);
      ctx.quadraticCurveTo(-s * 0.42, -s * 0.1, 0, -s * 0.62);
      ctx.closePath();
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(0, -s * 0.10, s * 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    if (!text) return [];
    var words = String(text).split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  }

  window.StickerKit = {
    getTheme: getTheme,
    roundRect: roundRect,
    drawDeskBackdrop: drawDeskBackdrop,
    drawStickerCard: drawStickerCard,
    drawDiecutSticker: drawDiecutSticker,
    wrapLines: wrapLines
  };
})();
