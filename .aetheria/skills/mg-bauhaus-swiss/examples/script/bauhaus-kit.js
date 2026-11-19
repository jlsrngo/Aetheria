(function () {
  'use strict';

  var THEMES = {
    'cream-1919': {
      bg: '#F1E9DA',
      grid: 'rgba(17, 17, 17, 0.14)',
      ink: '#111111',
      card: '#FAF6ED',
      red: '#E03C31',
      yellow: '#F2B705',
      blue: '#1E4FA3',
      accentText: '#FFFFFF'
    },
    'swiss-red': {
      bg: '#D92B22',
      grid: 'rgba(255, 255, 255, 0.18)',
      ink: '#111111',
      card: '#F6F2E9',
      red: '#111111',
      yellow: '#F2B705',
      blue: '#1E4FA3',
      accentText: '#FFFFFF'
    },
    'dessau-dark': {
      bg: '#121212',
      grid: 'rgba(241, 233, 218, 0.14)',
      ink: '#F1E9DA',
      card: '#1C1C1C',
      red: '#E03C31',
      yellow: '#F2B705',
      blue: '#2E6BD9',
      accentText: '#111111'
    },
    'zurich-mono': {
      bg: '#ECEAE4',
      grid: 'rgba(17, 17, 17, 0.16)',
      ink: '#0F0F0F',
      card: '#FFFFFF',
      red: '#E03C31',
      yellow: '#111111',
      blue: '#525252',
      accentText: '#FFFFFF'
    },
    'weimar-ochre': {
      bg: '#E8B838',
      grid: 'rgba(17, 17, 17, 0.16)',
      ink: '#111111',
      card: '#F7F1E1',
      red: '#D93829',
      yellow: '#1E4FA3',
      blue: '#111111',
      accentText: '#FFFFFF'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['cream-1919'];
  }

  function beatAngle(t) {
    // 120 BPM (0.5s per beat) crisp step-in-out 90-degree snap
    var beat = Math.floor(t * 2);
    var frac = (t * 2) - beat;
    var snap = frac < 0.28 ? Math.pow(frac / 0.28, 2) : 1;
    return ((beat + snap) % 4) * (Math.PI * 0.5);
  }

  function drawSwissGrid(ctx, w, h, theme) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    var mod = 120;
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    for (var x = mod; x < w; x += mod) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var y = mod; y < h; y += mod) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Registration crosshairs on key intersections
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 2;
    var pts = [[120, 120], [w - 120, 120], [120, h - 120], [w - 120, h - 120]];
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0], py = pts[i][1];
      ctx.beginPath();
      ctx.moveTo(px - 14, py); ctx.lineTo(px + 14, py);
      ctx.moveTo(px, py - 14); ctx.lineTo(px, py + 14);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlock(ctx, x, y, w, h, fill, stroke, strokeW) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeW || 4;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
  }

  function drawGlyph(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;
    var ang = beatAngle(t);

    if (name === 'quarter-arc') {
      ctx.rotate(ang);
      ctx.fillStyle = theme.red;
      ctx.beginPath();
      ctx.moveTo(-s, s);
      ctx.arc(-s, s, size, -Math.PI * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.blue;
      ctx.fillRect(-s, -s, s * 0.55, s * 0.55);
      ctx.fillStyle = theme.yellow;
      ctx.beginPath();
      ctx.arc(s * 0.45, -s * 0.45, s * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (name === 'split-circle') {
      ctx.fillStyle = theme.red;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.9, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.blue;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.9, Math.PI * 0.5, Math.PI * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(ang);
      ctx.fillStyle = theme.yellow;
      ctx.fillRect(-s * 0.9, -s * 0.12, size * 0.9, s * 0.24);
    } else if (name === 'bauhaus-tri') {
      ctx.fillStyle = theme.yellow;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.92);
      ctx.lineTo(s * 0.92, s * 0.82);
      ctx.lineTo(-s * 0.92, s * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      ctx.arc(0, s * 0.22, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.red;
      ctx.fillRect(-s * 0.92, s * 0.64, size * 0.92, s * 0.22);
    } else if (name === 'grid-cross') {
      ctx.rotate(ang);
      ctx.fillStyle = theme.ink;
      ctx.fillRect(-s * 0.24, -s * 0.9, s * 0.48, size * 0.9);
      ctx.fillStyle = theme.red;
      ctx.fillRect(-s * 0.9, -s * 0.24, size * 0.9, s * 0.48);
      ctx.fillStyle = theme.yellow;
      ctx.fillRect(-s * 0.24, -s * 0.24, s * 0.48, s * 0.48);
    } else if (name === 'concentric-ring') {
      ctx.fillStyle = theme.blue;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.92, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.card;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.64, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.red;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * s * 0.18, Math.sin(ang) * s * 0.18, s * 0.36, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // diagonal-bars
      ctx.fillStyle = theme.yellow;
      ctx.fillRect(-s * 0.88, -s * 0.88, size * 0.88, size * 0.88);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = s * 0.26;
      ctx.beginPath();
      ctx.moveTo(-s * 0.72, s * 0.72);
      ctx.lineTo(s * 0.72, -s * 0.72);
      ctx.stroke();
      ctx.fillStyle = theme.red;
      ctx.beginPath();
      ctx.arc(-s * 0.45, -s * 0.45, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
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

  window.BauhausKit = {
    getTheme: getTheme,
    drawSwissGrid: drawSwissGrid,
    drawBlock: drawBlock,
    drawGlyph: drawGlyph,
    wrapLines: wrapLines
  };
})();
