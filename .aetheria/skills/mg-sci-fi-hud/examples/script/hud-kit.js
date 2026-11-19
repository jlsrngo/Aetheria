(function () {
  'use strict';

  var THEMES = {
    'cyber-cyan': {
      bg: '#030A10',
      grid: 'rgba(0, 229, 255, 0.08)',
      panel: 'rgba(0, 229, 255, 0.06)',
      primary: '#00E5FF',
      secondary: '#38BDF8',
      alert: '#FF6A00',
      ink: '#E0F7FA',
      muted: '#67E8F9'
    },
    'alert-amber': {
      bg: '#100802',
      grid: 'rgba(255, 136, 0, 0.09)',
      panel: 'rgba(255, 136, 0, 0.07)',
      primary: '#FF8800',
      secondary: '#FBBF24',
      alert: '#EF4444',
      ink: '#FFF7ED',
      muted: '#FDBA74'
    },
    'stealth-emerald': {
      bg: '#020F0A',
      grid: 'rgba(16, 185, 129, 0.09)',
      panel: 'rgba(16, 185, 129, 0.06)',
      primary: '#10B981',
      secondary: '#34D399',
      alert: '#FACC15',
      ink: '#ECFDF5',
      muted: '#6EE7B7'
    },
    'orbital-violet': {
      bg: '#070414',
      grid: 'rgba(168, 85, 247, 0.09)',
      panel: 'rgba(168, 85, 247, 0.07)',
      primary: '#C084FC',
      secondary: '#38BDF8',
      alert: '#F43F5E',
      ink: '#FAF5FF',
      muted: '#D8B4FE'
    },
    'crimson-lock': {
      bg: '#120306',
      grid: 'rgba(244, 63, 94, 0.10)',
      panel: 'rgba(244, 63, 94, 0.07)',
      primary: '#FB7185',
      secondary: '#FF6A00',
      alert: '#FACC15',
      ink: '#FFF1F2',
      muted: '#FDA4AF'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['cyber-cyan'];
  }

  function chamferPath(ctx, x, y, w, h, c) {
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y);
    ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  }

  function drawHudBackdrop(ctx, w, h, theme, t) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Technical grid + rolling coordinate ticks
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    var step = 72;
    for (var x = step; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (var y = step; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Subtle holographic scanline sweep
    var scanY = ((t * 140) % (h + 120)) - 60;
    var sg = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
    sg.addColorStop(0, 'rgba(0,0,0,0)');
    sg.addColorStop(0.5, theme.primary + '22');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, scanY - 40, w, 80);
    ctx.restore();
  }

  function drawHudPanel(ctx, x, y, w, h, theme, tag) {
    ctx.save();
    chamferPath(ctx, x, y, w, h, 24);
    ctx.fillStyle = theme.panel;
    ctx.fill();
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Bright corner telemetry ticks
    ctx.fillStyle = theme.primary;
    ctx.fillRect(x + 28, y - 3, 64, 6);
    ctx.fillRect(x + w - 92, y + h - 3, 64, 6);

    if (tag) {
      ctx.fillStyle = theme.muted;
      ctx.font = '700 18px "JetBrains Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(tag, x + 28, y - 10);
    }
    ctx.restore();
  }

  function drawModule(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;
    ctx.strokeStyle = theme.primary;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 12;

    if (name === 'radar-sweep') {
      ctx.lineWidth = 2;
      for (var r = 1; r <= 3; r++) {
        ctx.beginPath(); ctx.arc(0, 0, s * (r * 0.3), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-s * 0.92, 0); ctx.lineTo(s * 0.92, 0);
      ctx.moveTo(0, -s * 0.92); ctx.lineTo(0, s * 0.92);
      ctx.stroke();
      var ang = t * 1.8;
      ctx.fillStyle = theme.primary + '44';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, s * 0.9, ang - 0.55, ang);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.alert;
      ctx.beginPath(); ctx.arc(s * 0.42, -s * 0.28, 7, 0, Math.PI * 2); ctx.fill();
    } else if (name === 'target-reticle') {
      ctx.save();
      ctx.rotate(t * 0.9);
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 12]);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.86, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.rotate(-t * 1.4);
      ctx.strokeStyle = theme.alert;
      ctx.lineWidth = 3;
      for (var b = 0; b < 4; b++) {
        ctx.rotate(Math.PI * 0.5);
        ctx.beginPath();
        ctx.moveTo(s * 0.42, -s * 0.16);
        ctx.lineTo(s * 0.58, -s * 0.16);
        ctx.lineTo(s * 0.58, s * 0.16);
        ctx.lineTo(s * 0.42, s * 0.16);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = theme.alert;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    } else if (name === 'wire-globe') {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.84, 0, Math.PI * 2); ctx.stroke();
      for (var m = -2; m <= 2; m++) {
        var rx = Math.abs(Math.cos(t * 0.7 + m * 0.55)) * s * 0.84;
        ctx.beginPath(); ctx.ellipse(0, 0, Math.max(4, rx), s * 0.84, 0, 0, Math.PI * 2); ctx.stroke();
      }
      for (var l = -1; l <= 1; l++) {
        var ly = l * s * 0.42;
        var lw = Math.sqrt(Math.max(0, s * 0.84 * s * 0.84 - ly * ly));
        ctx.beginPath(); ctx.moveTo(-lw, ly); ctx.lineTo(lw, ly); ctx.stroke();
      }
    } else if (name === 'signal-wave') {
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      for (var x = -s * 0.88; x <= s * 0.88; x += 8) {
        var u = x / (s * 0.88);
        var env = 1 - u * u;
        var y = Math.sin(u * 10 + t * 5) * s * 0.55 * env;
        if (x === -s * 0.88) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = theme.alert;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-s * 0.9, 0); ctx.lineTo(s * 0.9, 0); ctx.stroke();
    } else if (name === 'hex-core') {
      ctx.rotate(t * 0.5);
      for (var ring = 1; ring <= 2; ring++) {
        var hr = s * (ring === 1 ? 0.48 : 0.84);
        ctx.lineWidth = ring === 1 ? 3.5 : 2;
        ctx.beginPath();
        for (var h = 0; h < 6; h++) {
          var ha = (h / 6) * Math.PI * 2;
          var hx = Math.cos(ha) * hr, hy = Math.sin(ha) * hr;
          if (h === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      // orbital-rings
      ctx.lineWidth = 2.5;
      for (var o = 0; o < 3; o++) {
        ctx.save();
        ctx.rotate(t * (0.6 + o * 0.35) * (o % 2 === 0 ? 1 : -1) + o * 1.05);
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.88, s * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = theme.alert;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
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

  window.HudKit = {
    getTheme: getTheme,
    drawHudBackdrop: drawHudBackdrop,
    drawHudPanel: drawHudPanel,
    drawModule: drawModule,
    wrapLines: wrapLines
  };
})();
