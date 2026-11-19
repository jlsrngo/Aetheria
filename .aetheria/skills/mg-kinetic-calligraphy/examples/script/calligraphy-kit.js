(function () {
  'use strict';

  var THEMES = {
    'sumi-rice': {
      bg: '#F4EFE6',
      card: '#FAF6EE',
      ink: '#121212',
      brush: '#181818',
      accent: '#C81E1E',
      muted: '#57534E',
      splatter: 'rgba(18, 18, 18, 0.14)'
    },
    'crimson-impact': {
      bg: '#14090A',
      card: '#1F0E10',
      ink: '#FAF5EB',
      brush: '#DC2626',
      accent: '#F59E0B',
      muted: '#FCA5A5',
      splatter: 'rgba(220, 38, 38, 0.22)'
    },
    'obsidian-gold': {
      bg: '#0D0D10',
      card: '#17171C',
      ink: '#F8F4EA',
      brush: '#D97706',
      accent: '#FBBF24',
      muted: '#D6D3D1',
      splatter: 'rgba(251, 191, 36, 0.18)'
    },
    'indigo-brush': {
      bg: '#ECEFF4',
      card: '#F8FAFC',
      ink: '#0F172A',
      brush: '#1E3A8A',
      accent: '#DC2626',
      muted: '#475569',
      splatter: 'rgba(30, 58, 138, 0.16)'
    },
    'vermilion-scroll': {
      bg: '#B91C1C',
      card: '#FAF4E8',
      ink: '#111111',
      brush: '#111111',
      accent: '#B91C1C',
      muted: '#44403C',
      splatter: 'rgba(17, 17, 17, 0.16)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['sumi-rice'];
  }

  function hash(n) {
    var s = Math.sin(n * 91.7 + 17.3) * 43758.5453;
    return s - Math.floor(s);
  }

  function drawScrollBackdrop(ctx, w, h, theme, t) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Dynamic diagonal dry-brush sweep across background
    ctx.save();
    ctx.strokeStyle = theme.splatter;
    ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      ctx.lineWidth = 18 + i * 7;
      ctx.beginPath();
      ctx.moveTo(-60, h * (0.18 + i * 0.13));
      ctx.quadraticCurveTo(w * 0.5, h * (0.10 + i * 0.13) + Math.sin(t + i) * 18, w + 60, h * (0.24 + i * 0.13));
      ctx.stroke();
    }

    // Floating ink splatter particles
    ctx.fillStyle = theme.splatter;
    for (var p = 0; p < 28; p++) {
      var px = hash(p * 3 + 1) * w;
      var py = hash(p * 5 + 2) * h;
      var pr = 3 + hash(p * 7 + 3) * 11;
      ctx.beginPath();
      ctx.arc(px + Math.sin(t * 1.4 + p) * 6, py + Math.cos(t * 1.2 + p) * 6, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHankoSeal(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.fillRect(-size * 0.5, -size * 0.5, size, size);
    ctx.strokeStyle = '#FAF5EB';
    ctx.lineWidth = 3;
    ctx.strokeRect(-size * 0.4, -size * 0.4, size * 0.8, size * 0.8);
    ctx.beginPath();
    ctx.moveTo(-size * 0.22, 0); ctx.lineTo(size * 0.22, 0);
    ctx.moveTo(0, -size * 0.22); ctx.lineTo(0, size * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  function drawScrollCard(ctx, x, y, w, h, theme) {
    ctx.save();
    ctx.fillStyle = theme.card;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 6;
    ctx.strokeRect(x, y, w, h);
    // Double inner hairline
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
    ctx.restore();
  }

  function drawMotif(ctx, name, cx, cy, size, theme, prog) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;
    var p = Math.max(0.18, Math.min(1, prog));

    if (name === 'enso-circle') {
      // Tapered Zen brush Enso circle
      var segs = 36;
      var maxI = Math.floor(segs * p);
      ctx.strokeStyle = theme.brush;
      ctx.lineCap = 'round';
      for (var i = 0; i < maxI; i++) {
        var a1 = -Math.PI * 0.75 + (i / segs) * Math.PI * 1.82;
        var a2 = -Math.PI * 0.75 + ((i + 1) / segs) * Math.PI * 1.82;
        var taper = Math.sin((i / segs) * Math.PI);
        ctx.lineWidth = Math.max(4, size * 0.14 * taper);
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.76, a1, a2);
        ctx.stroke();
      }
      drawHankoSeal(ctx, s * 0.48, s * 0.48, size * 0.18, theme.accent);
    } else if (name === 'brush-wave') {
      ctx.strokeStyle = theme.brush;
      ctx.lineCap = 'round';
      for (var wv = -1; wv <= 1; wv++) {
        ctx.lineWidth = wv === 0 ? size * 0.10 : size * 0.05;
        ctx.beginPath();
        ctx.moveTo(-s * 0.85, wv * s * 0.34);
        ctx.bezierCurveTo(-s * 0.25, wv * s * 0.34 - s * 0.45 * p, s * 0.25, wv * s * 0.34 + s * 0.45 * p, s * 0.85, wv * s * 0.34);
        ctx.stroke();
      }
    } else if (name === 'katana-slash') {
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(-s * 0.92, s * 0.65);
      ctx.lineTo(s * 0.92 * p, -s * 0.72 * p);
      ctx.lineTo(s * 0.78 * p, -s * 0.42 * p);
      ctx.lineTo(-s * 0.65, s * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = theme.brush;
      ctx.lineWidth = size * 0.07;
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, -s * 0.45);
      ctx.lineTo(s * 0.75 * p, s * 0.55 * p);
      ctx.stroke();
    } else if (name === 'ink-blossom') {
      ctx.fillStyle = theme.accent;
      for (var b = 0; b < 5; b++) {
        var ba = (b / 5) * Math.PI * 2 - Math.PI * 0.5;
        ctx.beginPath();
        ctx.ellipse(Math.cos(ba) * s * 0.42 * p, Math.sin(ba) * s * 0.42 * p, s * 0.34, s * 0.20, ba, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = theme.brush;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (name === 'hanko-seal') {
      drawHankoSeal(ctx, 0, 0, size * 0.72 * p, theme.accent);
    } else {
      // spark-kanji
      ctx.strokeStyle = theme.brush;
      ctx.lineWidth = size * 0.11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s * 0.65, -s * 0.35); ctx.lineTo(s * 0.65, -s * 0.35);
      ctx.moveTo(0, -s * 0.78); ctx.lineTo(0, s * 0.78);
      ctx.moveTo(-s * 0.55, s * 0.45); ctx.lineTo(s * 0.55, s * 0.45);
      ctx.stroke();
      drawHankoSeal(ctx, s * 0.55, -s * 0.55, size * 0.20, theme.accent);
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

  window.CalligraphyKit = {
    getTheme: getTheme,
    drawScrollBackdrop: drawScrollBackdrop,
    drawHankoSeal: drawHankoSeal,
    drawScrollCard: drawScrollCard,
    drawMotif: drawMotif,
    wrapLines: wrapLines
  };
})();
