(function () {
  'use strict';

  var THEMES = {
    'plum-candy': {
      bgTop: '#1A0926',
      bgBot: '#2E0F45',
      card: 'rgba(42, 14, 64, 0.72)',
      liqA: '#FF5E3A',
      liqB: '#FF2A85',
      liqC: '#A855F7',
      ink: '#FFF8FA',
      muted: '#F5D0FE'
    },
    'ocean-splash': {
      bgTop: '#041C2C',
      bgBot: '#093550',
      card: 'rgba(6, 38, 60, 0.72)',
      liqA: '#00F5D4',
      liqB: '#00BBF9',
      liqC: '#3B82F6',
      ink: '#F0FDFA',
      muted: '#BAE6FD'
    },
    'citrus-fizz': {
      bgTop: '#1A1405',
      bgBot: '#332508',
      card: 'rgba(46, 34, 8, 0.72)',
      liqA: '#FDE047',
      liqB: '#FB923C',
      liqC: '#84CC16',
      ink: '#FEFCE8',
      muted: '#FDE68A'
    },
    'berry-velvet': {
      bgTop: '#1E0618',
      bgBot: '#3D0B30',
      card: 'rgba(54, 12, 42, 0.74)',
      liqA: '#F43F5E',
      liqB: '#EC4899',
      liqC: '#8B5CF6',
      ink: '#FFF1F2',
      muted: '#FBCFE8'
    },
    'obsidian-lava': {
      bgTop: '#120806',
      bgBot: '#290E08',
      card: 'rgba(38, 14, 10, 0.76)',
      liqA: '#FF4500',
      liqB: '#FF9500',
      liqC: '#EF4444',
      ink: '#FFF7ED',
      muted: '#FDBA74'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['plum-candy'];
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

  function drawOrganicBlob(ctx, cx, cy, r, lobes, amp, t, phase) {
    var pts = 48;
    ctx.beginPath();
    for (var i = 0; i <= pts; i++) {
      var a = (i / pts) * Math.PI * 2;
      var rad = r * (1 + amp * Math.sin(a * lobes + t * 2.2 + phase) + amp * 0.5 * Math.cos(a * (lobes + 2) - t * 1.6));
      var px = cx + Math.cos(a) * rad;
      var py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawFluidBackdrop(ctx, w, h, theme, t) {
    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, theme.bgTop);
    bg.addColorStop(1, theme.bgBot);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 3 flowing liquid ribbons at top and bottom
    ctx.save();
    var layers = [
      { y: h * 0.14, col: theme.liqC, alpha: 0.28, amp: 34, freq: 0.006, sp: 1.2 },
      { y: h * 0.84, col: theme.liqB, alpha: 0.34, amp: 44, freq: 0.005, sp: -1.5 },
      { y: h * 0.90, col: theme.liqA, alpha: 0.36, amp: 32, freq: 0.007, sp: 1.8 }
    ];
    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = L.col;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var x = 0; x <= w; x += 24) {
        var wy = L.y + Math.sin(x * L.freq + t * L.sp + l) * L.amp;
        ctx.lineTo(x, wy);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGlossySphere(ctx, cx, cy, r, colA, colB) {
    ctx.save();
    var g = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, r * 0.08, cx, cy, r);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.28, colA);
    g.addColorStop(0.85, colB);
    g.addColorStop(1, colB);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Specular pill highlight
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.28, cy - r * 0.34, r * 0.22, r * 0.11, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFluidCard(ctx, x, y, w, h, theme) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 16;
    roundRect(ctx, x, y, w, h, 44);
    ctx.fillStyle = theme.card;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    var rim = ctx.createLinearGradient(x, y, x + w, y + h);
    rim.addColorStop(0, theme.liqA);
    rim.addColorStop(0.5, theme.liqB);
    rim.addColorStop(1, theme.liqC);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  function drawForm(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;

    if (name === 'metaball-duo') {
      var sep = s * (0.28 + 0.16 * Math.sin(t * 2.4));
      // Connecting glossy neck
      ctx.fillStyle = theme.liqB;
      ctx.beginPath();
      ctx.ellipse(0, 0, sep * 1.15, s * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      drawGlossySphere(ctx, -sep, 0, s * 0.56, theme.liqA, theme.liqB);
      drawGlossySphere(ctx, sep, 0, s * 0.48, theme.liqB, theme.liqC);
    } else if (name === 'liquid-drop') {
      var g = ctx.createLinearGradient(0, -s, 0, s);
      g.addColorStop(0, theme.liqA);
      g.addColorStop(1, theme.liqB);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.92);
      ctx.bezierCurveTo(s * 0.78, -s * 0.05, s * 0.74, s * 0.85, 0, s * 0.85);
      ctx.bezierCurveTo(-s * 0.74, s * 0.85, -s * 0.78, -s * 0.05, 0, -s * 0.92);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.22, s * 0.12, s * 0.12, s * 0.28, -0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (name === 'splash-crown') {
      drawOrganicBlob(ctx, 0, 0, s * 0.68, 5, 0.20, t, 0.5);
      var sg = ctx.createRadialGradient(-s * 0.2, -s * 0.2, 6, 0, 0, s * 0.9);
      sg.addColorStop(0, '#FFFFFF');
      sg.addColorStop(0.3, theme.liqA);
      sg.addColorStop(1, theme.liqB);
      ctx.fillStyle = sg;
      ctx.fill();
      for (var d = 0; d < 5; d++) {
        var da = (d / 5) * Math.PI * 2 + t * 0.8;
        drawGlossySphere(ctx, Math.cos(da) * s * 0.86, Math.sin(da) * s * 0.86, s * 0.14, theme.liqA, theme.liqC);
      }
    } else if (name === 'ripple-pool') {
      for (var r = 3; r >= 1; r--) {
        var rad = s * (0.28 * r + 0.06 * Math.sin(t * 3 - r));
        ctx.strokeStyle = r === 1 ? theme.liqA : (r === 2 ? theme.liqB : theme.liqC);
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.ellipse(0, 0, rad, rad * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawGlossySphere(ctx, 0, -s * 0.12, s * 0.24, theme.liqA, theme.liqB);
    } else if (name === 'wave-ribbon') {
      ctx.strokeStyle = theme.liqA;
      ctx.lineWidth = size * 0.16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s * 0.82, 0);
      ctx.bezierCurveTo(-s * 0.3, -s * 0.75 * Math.sin(t * 2 + 1), s * 0.3, s * 0.75 * Math.sin(t * 2 + 1), s * 0.82, 0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = size * 0.04;
      ctx.stroke();
    } else {
      // bubble-cluster
      drawGlossySphere(ctx, -s * 0.32, s * 0.18, s * 0.42, theme.liqB, theme.liqC);
      drawGlossySphere(ctx, s * 0.30, -s * 0.16, s * 0.46, theme.liqA, theme.liqB);
      drawGlossySphere(ctx, 0, s * 0.38, s * 0.28, theme.liqA, theme.liqC);
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

  window.LiquidKit = {
    getTheme: getTheme,
    roundRect: roundRect,
    drawFluidBackdrop: drawFluidBackdrop,
    drawFluidCard: drawFluidCard,
    drawForm: drawForm,
    wrapLines: wrapLines
  };
})();
