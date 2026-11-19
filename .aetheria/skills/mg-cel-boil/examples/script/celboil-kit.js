(function () {
  'use strict';

  var THEMES = {
    'sketch-cream': {
      bg: '#FDF6E7',
      card: '#FFFDF8',
      ink: '#181412',
      accentA: '#EF4444',
      accentB: '#FACC15',
      accentC: '#38BDF8',
      dots: 'rgba(24, 20, 18, 0.08)'
    },
    'comic-tomato': {
      bg: '#FEE2E2',
      card: '#FFFBF5',
      ink: '#181412',
      accentA: '#DC2626',
      accentB: '#FDE047',
      accentC: '#FB923C',
      dots: 'rgba(220, 38, 38, 0.12)'
    },
    'studio-butter': {
      bg: '#FEF3C7',
      card: '#FFFDF7',
      ink: '#1C1917',
      accentA: '#F97316',
      accentB: '#EF4444',
      accentC: '#2563EB',
      dots: 'rgba(28, 25, 23, 0.09)'
    },
    'ink-mint': {
      bg: '#DCFCE7',
      card: '#F9FFFB',
      ink: '#14221B',
      accentA: '#10B981',
      accentB: '#FACC15',
      accentC: '#F43F5E',
      dots: 'rgba(20, 34, 27, 0.09)'
    },
    'night-chalk': {
      bg: '#1A1921',
      card: '#262431',
      ink: '#FAF5EB',
      accentA: '#FB7185',
      accentB: '#FDE047',
      accentC: '#38BDF8',
      dots: 'rgba(250, 245, 235, 0.08)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['sketch-cream'];
  }

  function hash(n) {
    var s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function boilFrame(t) {
    // Stepped 12fps line-boil cycle (3 repeating hand-drawn frames)
    return Math.floor(t * 12) % 3;
  }

  function drawPaperBackdrop(ctx, w, h, theme, t) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle sketchbook halftone tooth pattern
    ctx.save();
    ctx.fillStyle = theme.dots;
    var step = 36;
    for (var y = 18; y < h; y += step) {
      for (var x = 18; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x + ((y / step) % 2) * 12, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Subtle radial comic action speedlines
    var bf = boilFrame(t);
    ctx.strokeStyle = theme.dots;
    ctx.lineWidth = 3;
    var cx = w * 0.5, cy = h * 0.42;
    for (var i = 0; i < 24; i++) {
      var a = (i / 24) * Math.PI * 2 + bf * 0.015;
      var r1 = Math.min(w, h) * (0.48 + hash(i + bf * 19) * 0.08);
      var r2 = Math.max(w, h) * 0.85;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoilRect(ctx, x, y, w, h, theme, t, fillCol) {
    var bf = boilFrame(t);
    ctx.save();
    // Off-register hand-colored fill
    ctx.fillStyle = fillCol || theme.card;
    ctx.fillRect(x + 7, y + 7, w, h);

    // Hard ink comic drop shadow
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var segs = 10;
    function wobblyLine(x1, y1, x2, y2, seed) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      for (var i = 1; i <= segs; i++) {
        var u = i / segs;
        var jx = (hash(seed + i * 7 + bf * 31) - 0.5) * 4.5;
        var jy = (hash(seed + i * 13 + bf * 47) - 0.5) * 4.5;
        ctx.lineTo(x1 + (x2 - x1) * u + jx, y1 + (y2 - y1) * u + jy);
      }
      ctx.stroke();
    }

    wobblyLine(x, y, x + w, y, 101);
    wobblyLine(x + w, y, x + w, y + h, 202);
    wobblyLine(x + w, y + h, x, y + h, 303);
    wobblyLine(x, y + h, x, y, 404);
    ctx.restore();
  }

  function drawWobblyPoly(ctx, pts, fill, stroke, bf, seed) {
    ctx.save();
    // Off-register fill
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0] + 6;
      var py = pts[i][1] + 5;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Boiling ink outline
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var jx = (hash(seed + j * 11 + bf * 23) - 0.5) * 5;
      var jy = (hash(seed + j * 17 + bf * 29) - 0.5) * 5;
      var ox = pts[j][0] + jx;
      var oy = pts[j][1] + jy;
      if (j === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    }
    ctx.closePath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawSprite(ctx, name, cx, cy, size, theme, t) {
    var bf = boilFrame(t);
    var steppedT = Math.floor(t * 12) / 12;
    var squash = 1 + Math.sin(steppedT * 6) * 0.06;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1 / squash, squash);
    var s = size * 0.5;

    if (name === 'flame-spirit') {
      var flame = [
        [0, -s * 0.95], [s * 0.45, -s * 0.3], [s * 0.72, s * 0.25],
        [s * 0.42, s * 0.85], [0, s * 0.92], [-s * 0.48, s * 0.82],
        [-s * 0.72, s * 0.2], [-s * 0.38, -s * 0.35]
      ];
      drawWobblyPoly(ctx, flame, theme.accentA, theme.ink, bf, 11);
      var core = [[0, -s * 0.35], [s * 0.32, s * 0.3], [0, s * 0.65], [-s * 0.32, s * 0.3]];
      drawWobblyPoly(ctx, core, theme.accentB, theme.ink, bf, 22);
      // Cute cartoon eyes
      ctx.fillStyle = theme.ink;
      ctx.beginPath(); ctx.arc(-s * 0.16, s * 0.15, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.16, s * 0.15, 7, 0, Math.PI * 2); ctx.fill();
    } else if (name === 'star-burst') {
      var star = [];
      for (var i = 0; i < 16; i++) {
        var ang = (i / 16) * Math.PI * 2 - Math.PI * 0.5;
        var rad = (i % 2 === 0) ? s * 0.92 : s * 0.44;
        star.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
      }
      drawWobblyPoly(ctx, star, theme.accentB, theme.ink, bf, 33);
    } else if (name === 'smoke-puff') {
      var cloud = [];
      for (var c = 0; c < 12; c++) {
        var ca = (c / 12) * Math.PI * 2;
        var cr = s * (0.68 + 0.22 * Math.sin(ca * 3));
        cloud.push([Math.cos(ca) * cr, Math.sin(ca) * cr * 0.78]);
      }
      drawWobblyPoly(ctx, cloud, theme.accentC, theme.ink, bf, 44);
    } else if (name === 'lightning-zap') {
      var bolt = [
        [s * 0.15, -s * 0.95], [-s * 0.55, s * 0.05], [-s * 0.05, s * 0.05],
        [-s * 0.25, s * 0.95], [s * 0.58, -s * 0.12], [s * 0.08, -s * 0.12]
      ];
      drawWobblyPoly(ctx, bolt, theme.accentB, theme.ink, bf, 55);
    } else if (name === 'pencil-nib') {
      var pen = [
        [-s * 0.65, s * 0.65], [-s * 0.35, -s * 0.15], [s * 0.45, -s * 0.85],
        [s * 0.82, -s * 0.48], [s * 0.12, s * 0.32]
      ];
      drawWobblyPoly(ctx, pen, theme.accentC, theme.ink, bf, 66);
    } else {
      // heart-pop
      var heart = [
        [0, s * 0.85], [-s * 0.82, s * 0.05], [-s * 0.78, -s * 0.55],
        [-s * 0.32, -s * 0.82], [0, -s * 0.42], [s * 0.32, -s * 0.82],
        [s * 0.78, -s * 0.55], [s * 0.82, s * 0.05]
      ];
      drawWobblyPoly(ctx, heart, theme.accentA, theme.ink, bf, 77);
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

  window.CelBoilKit = {
    getTheme: getTheme,
    drawPaperBackdrop: drawPaperBackdrop,
    drawBoilRect: drawBoilRect,
    drawSprite: drawSprite,
    wrapLines: wrapLines
  };
})();
