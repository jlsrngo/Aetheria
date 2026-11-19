(function () {
  'use strict';

  var THEMES = {
    'cobalt-pop': {
      bg: '#1D4ED8',
      bgBand: '#1E40AF',
      card: '#FFFFFF',
      ink: '#0F172A',
      muted: '#475569',
      shapeA: '#FACC15',
      shapeB: '#38BDF8',
      accent: '#2563EB'
    },
    'coral-field': {
      bg: '#F43F5E',
      bgBand: '#E11D48',
      card: '#FFFDFB',
      ink: '#1C1917',
      muted: '#57534E',
      shapeA: '#FDE047',
      shapeB: '#FB923C',
      accent: '#E11D48'
    },
    'emerald-morph': {
      bg: '#059669',
      bgBand: '#047857',
      card: '#FFFFFF',
      ink: '#064E3B',
      muted: '#374151',
      shapeA: '#A7F3D0',
      shapeB: '#FACC15',
      accent: '#059669'
    },
    'violet-pulse': {
      bg: '#6D28D9',
      bgBand: '#5B21B6',
      card: '#FAF5FF',
      ink: '#1E1B4B',
      muted: '#4C1D95',
      shapeA: '#F472B6',
      shapeB: '#38BDF8',
      accent: '#7C3AED'
    },
    'amber-studio': {
      bg: '#F59E0B',
      bgBand: '#D97706',
      card: '#FFFDF7',
      ink: '#1C1917',
      muted: '#57534E',
      shapeA: '#2563EB',
      shapeB: '#EF4444',
      accent: '#D97706'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['cobalt-pop'];
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

  function sampleShape(name, idx, total) {
    var a = (idx / total) * Math.PI * 2 - Math.PI * 0.5;
    var c = Math.cos(a), s = Math.sin(a);
    if (name === 'circle') {
      return [c * 0.86, s * 0.86];
    }
    if (name === 'squircle') {
      var sx = Math.sign(c) * Math.pow(Math.abs(c), 0.55);
      var sy = Math.sign(s) * Math.pow(Math.abs(s), 0.55);
      return [sx * 0.85, sy * 0.85];
    }
    if (name === 'star-6') {
      var r = 0.64 + 0.28 * Math.cos(a * 6);
      return [c * r, s * r];
    }
    if (name === 'triangle') {
      var n = 3;
      var sector = (Math.PI * 2) / n;
      var rem = ((a + Math.PI * 2.5) % sector) - sector * 0.5;
      var rad = 0.58 / Math.cos(rem);
      return [c * rad, s * rad];
    }
    if (name === 'capsule') {
      return [c * 0.96, s * 0.52];
    }
    // diamond
    var d = Math.abs(c) + Math.abs(s);
    return [(c / d) * 0.96, (s / d) * 0.96];
  }

  function drawColorFieldBackdrop(ctx, w, h, theme, t) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle geometric color-field wipe bands
    ctx.save();
    ctx.fillStyle = theme.bgBand;
    var shift = Math.sin(t * 0.8) * 32;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62 + shift);
    ctx.lineTo(w, h * 0.46 - shift);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawMorphCard(ctx, x, y, w, h, theme) {
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 16;
    roundRect(ctx, x, y, w, h, 36);
    ctx.fillStyle = theme.card;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.restore();
  }

  function drawMorphedShape(ctx, fromName, toName, cx, cy, size, theme, t) {
    // Hold-and-release morph cycle: 0..1 smooth cubic
    var cycle = (t * 0.55) % 2;
    var raw = cycle <= 1 ? cycle : 2 - cycle;
    var u = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    var N = 64;
    var s = size * 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(u * Math.PI * 0.25);
    var squash = 1 + Math.sin(u * Math.PI) * 0.08;
    ctx.scale(squash, 1 / squash);

    // Background accent ring
    ctx.strokeStyle = theme.shapeB;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.96, 0, Math.PI * 2);
    ctx.stroke();

    // Equal-vertex interpolated morph path
    ctx.beginPath();
    for (var i = 0; i < N; i++) {
      var p1 = sampleShape(fromName || 'circle', i, N);
      var p2 = sampleShape(toName || 'star-6', i, N);
      var px = (p1[0] + (p2[0] - p1[0]) * u) * s;
      var py = (p1[1] + (p2[1] - p1[1]) * u) * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = theme.shapeA;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 5;
    ctx.stroke();

    // Inner counter-rotating dot motif
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
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

  window.MorphKit = {
    getTheme: getTheme,
    roundRect: roundRect,
    drawColorFieldBackdrop: drawColorFieldBackdrop,
    drawMorphCard: drawMorphCard,
    drawMorphedShape: drawMorphedShape,
    wrapLines: wrapLines
  };
})();
