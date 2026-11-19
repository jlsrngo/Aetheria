(function () {
  'use strict';

  var THEMES = {
    'midnight-gold': {
      bg: '#0B1320',
      grid: 'rgba(233, 215, 165, 0.10)',
      line: '#E9D7A5',
      lineDim: 'rgba(233, 215, 165, 0.36)',
      accent: '#FBBF24',
      ink: '#F8F4E8',
      muted: '#C7BDA4',
      cardBg: 'rgba(15, 24, 42, 0.55)'
    },
    'blueprint-cyan': {
      bg: '#081B33',
      grid: 'rgba(125, 211, 252, 0.12)',
      line: '#7DD3FC',
      lineDim: 'rgba(125, 211, 252, 0.35)',
      accent: '#38BDF8',
      ink: '#F0F9FF',
      muted: '#BAE6FD',
      cardBg: 'rgba(10, 34, 66, 0.55)'
    },
    'archival-ink': {
      bg: '#F7F3E9',
      grid: 'rgba(30, 41, 59, 0.10)',
      line: '#1E293B',
      lineDim: 'rgba(30, 41, 59, 0.32)',
      accent: '#B45309',
      ink: '#0F172A',
      muted: '#475569',
      cardBg: 'rgba(255, 253, 248, 0.72)'
    },
    'obsidian-silver': {
      bg: '#121215',
      grid: 'rgba(226, 232, 240, 0.09)',
      line: '#E2E8F0',
      lineDim: 'rgba(226, 232, 240, 0.32)',
      accent: '#94A3B8',
      ink: '#F8FAFC',
      muted: '#94A3B8',
      cardBg: 'rgba(24, 24, 30, 0.60)'
    },
    'atelier-emerald': {
      bg: '#071A17',
      grid: 'rgba(110, 231, 183, 0.10)',
      line: '#6EE7B7',
      lineDim: 'rgba(110, 231, 183, 0.34)',
      accent: '#34D399',
      ink: '#ECFDF5',
      muted: '#A7F3D0',
      cardBg: 'rgba(10, 36, 32, 0.55)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['midnight-gold'];
  }

  function drawBlueprintGrid(ctx, w, h, theme) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    var step = 60;
    for (var x = step; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (var y = step; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Major drafting coordinates
    ctx.strokeStyle = theme.lineDim;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(36, 36, w - 72, h - 72);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawDraftingFrame(ctx, x, y, w, h, theme, dimLabel) {
    ctx.save();
    ctx.fillStyle = theme.cardBg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Corner L-brackets
    var c = 18;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = theme.accent;
    var corners = [
      [x, y, 1, 1], [x + w, y, -1, 1],
      [x, y + h, 1, -1], [x + w, y + h, -1, -1]
    ];
    for (var i = 0; i < corners.length; i++) {
      var cx = corners[i][0], cy = corners[i][1], sx = corners[i][2], sy = corners[i][3];
      ctx.beginPath();
      ctx.moveTo(cx + sx * c, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * c);
      ctx.stroke();
    }

    if (dimLabel) {
      ctx.fillStyle = theme.lineDim;
      ctx.font = '600 18px "JetBrains Mono", "Consolas", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(dimLabel, x + w - 16, y - 8);
    }
    ctx.restore();
  }

  function tracePolyline(ctx, pts, progress, theme, glowTip) {
    if (!pts || pts.length < 2) return;
    var segLens = [];
    var total = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0];
      var dy = pts[i][1] - pts[i - 1][1];
      var len = Math.sqrt(dx * dx + dy * dy);
      segLens.push(len);
      total += len;
    }
    var target = Math.max(0, Math.min(1, progress)) * total;
    var drawn = 0;
    var tipX = pts[0][0], tipY = pts[0][1];

    ctx.save();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var j = 0; j < segLens.length; j++) {
      var sl = segLens[j];
      if (drawn + sl <= target) {
        ctx.lineTo(pts[j + 1][0], pts[j + 1][1]);
        tipX = pts[j + 1][0];
        tipY = pts[j + 1][1];
        drawn += sl;
      } else {
        var rem = (target - drawn) / (sl || 1);
        tipX = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * rem;
        tipY = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * rem;
        ctx.lineTo(tipX, tipY);
        break;
      }
    }
    ctx.stroke();

    if (glowTip) {
      var g = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, 18);
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(0.4, theme.accent);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSchematic(ctx, name, cx, cy, size, theme, prog) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;
    var p = Math.max(0.15, Math.min(1, prog));

    // Reference dashed construction circle
    ctx.save();
    ctx.strokeStyle = theme.lineDim;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    if (name === 'blueprint-arch') {
      var archPts = [
        [-s * 0.85, s * 0.65], [-s * 0.85, -s * 0.15], [-s * 0.45, -s * 0.55],
        [-s * 0.05, -s * 0.15], [-s * 0.05, s * 0.65], [s * 0.15, s * 0.65],
        [s * 0.15, -s * 0.72], [s * 0.72, -s * 0.72], [s * 0.72, s * 0.65],
        [-s * 0.92, s * 0.65]
      ];
      tracePolyline(ctx, archPts, p, theme, true);
    } else if (name === 'botanical-sprout') {
      var stemPts = [
        [0, s * 0.78], [0, 0], [-s * 0.48, -s * 0.35], [-s * 0.12, -s * 0.55],
        [0, -s * 0.18], [0, -s * 0.78], [s * 0.45, -s * 0.45], [s * 0.12, -s * 0.25], [0, -s * 0.10]
      ];
      tracePolyline(ctx, stemPts, p, theme, true);
    } else if (name === 'circuit-trace') {
      var pcbPts = [
        [-s * 0.82, s * 0.45], [-s * 0.38, s * 0.45], [-s * 0.12, 0],
        [s * 0.32, 0], [s * 0.58, -s * 0.45], [s * 0.82, -s * 0.45]
      ];
      tracePolyline(ctx, pcbPts, p, theme, true);
      var nodes = [[-s * 0.82, s * 0.45], [-s * 0.12, 0], [s * 0.32, 0], [s * 0.82, -s * 0.45]];
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.5;
      for (var i = 0; i < nodes.length; i++) {
        ctx.beginPath();
        ctx.arc(nodes[i][0], nodes[i][1], 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (name === 'compass-rose') {
      var starPts = [
        [0, -s * 0.85], [s * 0.22, -s * 0.22], [s * 0.85, 0], [s * 0.22, s * 0.22],
        [0, s * 0.85], [-s * 0.22, s * 0.22], [-s * 0.85, 0], [-s * 0.22, -s * 0.22], [0, -s * 0.85]
      ];
      tracePolyline(ctx, starPts, p, theme, true);
    } else if (name === 'gear-schematic') {
      var gPts = [];
      var teeth = 8;
      for (var k = 0; k <= teeth * 2; k++) {
        var ang = (k / (teeth * 2)) * Math.PI * 2;
        var rad = (k % 2 === 0) ? s * 0.82 : s * 0.62;
        gPts.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
      }
      tracePolyline(ctx, gPts, p, theme, true);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2 * p);
      ctx.stroke();
    } else {
      // monogram-emblem
      var mPts = [
        [-s * 0.68, s * 0.65], [0, -s * 0.75], [s * 0.68, s * 0.65],
        [-s * 0.46, 0.08 * s], [s * 0.46, 0.08 * s]
      ];
      tracePolyline(ctx, mPts, p, theme, true);
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

  window.LineArtKit = {
    getTheme: getTheme,
    drawBlueprintGrid: drawBlueprintGrid,
    drawDraftingFrame: drawDraftingFrame,
    drawSchematic: drawSchematic,
    wrapLines: wrapLines
  };
})();
