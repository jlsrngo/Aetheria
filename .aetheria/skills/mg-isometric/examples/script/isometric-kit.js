(function () {
  'use strict';

  var THEMES = {
    'pastel-city': {
      bg: '#EAE6F8',
      grid: 'rgba(79, 70, 229, 0.12)',
      card: '#FFFFFF',
      ink: '#1E1B4B',
      muted: '#4C1D95',
      accent: '#6366F1',
      topA: '#BAE6FD', leftA: '#38BDF8', rightA: '#0284C7',
      topB: '#FDE68A', leftB: '#FBBF24', rightB: '#D97706',
      topC: '#A7F3D0', leftC: '#34D399', rightC: '#059669'
    },
    'cloud-slate': {
      bg: '#E2E8F0',
      grid: 'rgba(15, 23, 42, 0.10)',
      card: '#F8FAFC',
      ink: '#0F172A',
      muted: '#475569',
      accent: '#2563EB',
      topA: '#93C5FD', leftA: '#3B82F6', rightA: '#1D4ED8',
      topB: '#CBD5E1', leftB: '#94A3B8', rightB: '#475569',
      topC: '#67E8F9', leftC: '#06B6D4', rightC: '#0E7490'
    },
    'mint-campus': {
      bg: '#DCFCE7',
      grid: 'rgba(5, 150, 105, 0.12)',
      card: '#FFFFFF',
      ink: '#064E3B',
      muted: '#047857',
      accent: '#10B981',
      topA: '#6EE7B7', leftA: '#10B981', rightA: '#047857',
      topB: '#FDE047', leftB: '#FACC15', rightB: '#CA8A04',
      topC: '#A5F3FC', leftC: '#22D3EE', rightC: '#0891B2'
    },
    'sunset-logistics': {
      bg: '#FFEDD5',
      grid: 'rgba(234, 88, 12, 0.12)',
      card: '#FFFBF5',
      ink: '#431407',
      muted: '#9A3412',
      accent: '#EA580C',
      topA: '#FDBA74', leftA: '#FB923C', rightA: '#EA580C',
      topB: '#FDA4AF', leftB: '#FB7185', rightB: '#E11D48',
      topC: '#FDE68A', leftC: '#FBBF24', rightC: '#D97706'
    },
    'dark-datacenter': {
      bg: '#090E1A',
      grid: 'rgba(56, 189, 248, 0.14)',
      card: '#111827',
      ink: '#F8FAFC',
      muted: '#94A3B8',
      accent: '#38BDF8',
      topA: '#38BDF8', leftA: '#0284C7', rightA: '#0369A1',
      topB: '#A78BFA', leftB: '#7C3AED', rightB: '#5B21B6',
      topC: '#34D399', leftC: '#059669', rightC: '#047857'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['pastel-city'];
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

  // True 30-degree isometric box drawer (2:1 slope)
  function drawIsoBox(ctx, cx, cy, wx, wy, h, topCol, leftCol, rightCol) {
    var cos30 = 0.866;
    var sin30 = 0.5;
    var pTop = [cx, cy - h];
    var pRight = [cx + wx * cos30, cy - h + wx * sin30];
    var pFront = [cx + (wx - wy) * cos30, cy - h + (wx + wy) * sin30];
    var pLeft = [cx - wy * cos30, cy - h + wy * sin30];

    var bRight = [pRight[0], pRight[1] + h];
    var bFront = [pFront[0], pFront[1] + h];
    var bLeft = [pLeft[0], pLeft[1] + h];

    ctx.save();
    // Top face (+15% light)
    ctx.beginPath();
    ctx.moveTo(pTop[0], pTop[1]);
    ctx.lineTo(pRight[0], pRight[1]);
    ctx.lineTo(pFront[0], pFront[1]);
    ctx.lineTo(pLeft[0], pLeft[1]);
    ctx.closePath();
    ctx.fillStyle = topCol;
    ctx.fill();

    // Left face (base)
    ctx.beginPath();
    ctx.moveTo(pLeft[0], pLeft[1]);
    ctx.lineTo(pFront[0], pFront[1]);
    ctx.lineTo(bFront[0], bFront[1]);
    ctx.lineTo(bLeft[0], bLeft[1]);
    ctx.closePath();
    ctx.fillStyle = leftCol;
    ctx.fill();

    // Right face (-20% shadow)
    ctx.beginPath();
    ctx.moveTo(pFront[0], pFront[1]);
    ctx.lineTo(pRight[0], pRight[1]);
    ctx.lineTo(bRight[0], bRight[1]);
    ctx.lineTo(bFront[0], bFront[1]);
    ctx.closePath();
    ctx.fillStyle = rightCol;
    ctx.fill();
    ctx.restore();
  }

  function drawIsoBackdrop(ctx, w, h, theme) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // 30-degree isometric diamond grid lines
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    var step = 96;
    for (var i = -h; i < w + h; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h * 1.732, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - h * 1.732, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawIsoCard(ctx, x, y, w, h, theme) {
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 14;
    roundRect(ctx, x, y, w, h, 32);
    ctx.fillStyle = theme.card;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = theme.accent + '44';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawStructure(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    var s = size * 0.42;
    var bob = Math.sin(t * 2.2) * 5;
    var baseY = cy + s * 0.25;

    // Platform base tile
    drawIsoBox(ctx, cx, baseY, s * 1.15, s * 1.15, s * 0.16, theme.topC, theme.leftC, theme.rightC);

    if (name === 'smart-tower') {
      drawIsoBox(ctx, cx - s * 0.22, baseY - s * 0.08, s * 0.56, s * 0.56, s * 1.15 + bob, theme.topA, theme.leftA, theme.rightA);
      drawIsoBox(ctx, cx + s * 0.36, baseY + s * 0.08, s * 0.44, s * 0.44, s * 0.72 - bob * 0.5, theme.topB, theme.leftB, theme.rightB);
    } else if (name === 'server-rack') {
      for (var i = 0; i < 3; i++) {
        drawIsoBox(ctx, cx, baseY - s * 0.16 - i * (s * 0.34) + (i === 2 ? bob : 0), s * 0.82, s * 0.64, s * 0.24, theme.topA, theme.leftA, theme.rightA);
      }
    } else if (name === 'cloud-node') {
      drawIsoBox(ctx, cx, baseY - s * 0.35 + bob, s * 0.78, s * 0.78, s * 0.42, theme.topA, theme.leftA, theme.rightA);
      drawIsoBox(ctx, cx - s * 0.42, baseY + s * 0.02, s * 0.32, s * 0.32, s * 0.32, theme.topB, theme.leftB, theme.rightB);
      drawIsoBox(ctx, cx + s * 0.42, baseY + s * 0.02, s * 0.32, s * 0.32, s * 0.32, theme.topB, theme.leftB, theme.rightB);
    } else if (name === 'factory-hub') {
      drawIsoBox(ctx, cx - s * 0.12, baseY - s * 0.05, s * 0.88, s * 0.62, s * 0.52, theme.topB, theme.leftB, theme.rightB);
      drawIsoBox(ctx, cx + s * 0.24, baseY - s * 0.52, s * 0.26, s * 0.26, s * 0.65 + bob, theme.topA, theme.leftA, theme.rightA);
    } else if (name === 'energy-grid') {
      drawIsoBox(ctx, cx, baseY - s * 0.10, s * 0.92, s * 0.48, s * 0.24, theme.topB, theme.leftB, theme.rightB);
      drawIsoBox(ctx, cx, baseY - s * 0.36 + bob, s * 0.44, s * 0.44, s * 0.74, theme.topA, theme.leftA, theme.rightA);
    } else {
      // data-cube
      drawIsoBox(ctx, cx, baseY - s * 0.24 + bob, s * 0.78, s * 0.78, s * 0.78, theme.topA, theme.leftA, theme.rightA);
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

  window.IsometricKit = {
    getTheme: getTheme,
    roundRect: roundRect,
    drawIsoBackdrop: drawIsoBackdrop,
    drawIsoCard: drawIsoCard,
    drawStructure: drawStructure,
    wrapLines: wrapLines
  };
})();
