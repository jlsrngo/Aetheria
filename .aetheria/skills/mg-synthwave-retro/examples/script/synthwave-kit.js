(function () {
  'use strict';

  var THEMES = {
    'outrun-1986': {
      skyTop: '#0B021D',
      skyBot: '#2D0A4E',
      grid: '#FF2E93',
      cyan: '#00F0FF',
      sunTop: '#FFE600',
      sunBot: '#FF007F',
      panel: 'rgba(13, 4, 34, 0.78)',
      ink: '#FFFFFF',
      muted: '#F0ABFC'
    },
    'miami-vice': {
      skyTop: '#08182E',
      skyBot: '#2A144A',
      grid: '#00F5D4',
      cyan: '#FF4D94',
      sunTop: '#FFEA00',
      sunBot: '#FF4D94',
      panel: 'rgba(8, 22, 42, 0.78)',
      ink: '#FFFFFF',
      muted: '#99F6E4'
    },
    'laser-crimson': {
      skyTop: '#14030D',
      skyBot: '#3D0720',
      grid: '#FF2A54',
      cyan: '#FF9E00',
      sunTop: '#FFF275',
      sunBot: '#FF2A54',
      panel: 'rgba(22, 4, 14, 0.80)',
      ink: '#FFF1F2',
      muted: '#FDA4AF'
    },
    'midnight-chrome': {
      skyTop: '#050816',
      skyBot: '#161D42',
      grid: '#38BDF8',
      cyan: '#E879F9',
      sunTop: '#FDE047',
      sunBot: '#A855F7',
      panel: 'rgba(8, 12, 30, 0.80)',
      ink: '#F8FAFC',
      muted: '#BAE6FD'
    },
    'vapor-teal': {
      skyTop: '#0A1026',
      skyBot: '#1A344D',
      grid: '#2DD4BF',
      cyan: '#F472B6',
      sunTop: '#FDE047',
      sunBot: '#EC4899',
      panel: 'rgba(10, 20, 38, 0.78)',
      ink: '#F0FDFA',
      muted: '#A5F3FC'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['outrun-1986'];
  }

  function drawStripedSun(ctx, cx, cy, r, theme) {
    ctx.save();
    var g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, theme.sunTop);
    g.addColorStop(0.55, '#FF6A00');
    g.addColorStop(1, theme.sunBot);
    ctx.shadowColor = theme.sunBot;
    ctx.shadowBlur = 36;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Classic horizontal Outrun slit cutouts on lower half
    ctx.fillStyle = theme.skyBot;
    for (var i = 0; i < 6; i++) {
      var sy = cy + r * (0.08 + i * 0.145);
      var sh = 3 + i * 2.4;
      ctx.fillRect(cx - r - 4, sy, r * 2 + 8, sh);
    }
    ctx.restore();
  }

  function drawOutrunBackdrop(ctx, w, h, theme, t) {
    var skyH = h * 0.62;
    var sg = ctx.createLinearGradient(0, 0, 0, skyH);
    sg.addColorStop(0, theme.skyTop);
    sg.addColorStop(1, theme.skyBot);
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, skyH);

    // Starfield
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (var s = 0; s < 36; s++) {
      var sx = (s * 197 + 41) % w;
      var sy = (s * 83 + 19) % (skyH * 0.72);
      ctx.fillRect(sx, sy, 3, 3);
    }

    // Horizon sun
    drawStripedSun(ctx, w * 0.5, skyH - 20, Math.min(w, h) * 0.18, theme);

    // Wireframe mountain silhouette on horizon
    ctx.save();
    ctx.fillStyle = theme.skyTop;
    ctx.strokeStyle = theme.cyan;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, skyH);
    var peaks = [0.12, 0.25, 0.38, 0.62, 0.76, 0.90];
    var heights = [90, 145, 70, 80, 155, 95];
    for (var m = 0; m < peaks.length; m++) {
      ctx.lineTo(w * peaks[m], skyH - heights[m]);
      ctx.lineTo(w * (peaks[m] + 0.08), skyH);
    }
    ctx.lineTo(w, skyH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Perspective neon grid plane rushing toward camera
    ctx.fillStyle = '#090218';
    ctx.fillRect(0, skyH, w, h - skyH);
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.shadowColor = theme.grid;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.2;

    // Horizontal perspective lines cycling seamlessly
    var cycle = (t * 0.85) % 1;
    for (var row = 0; row < 12; row++) {
      var u = (row + cycle) / 12;
      var py = skyH + Math.pow(u, 2.1) * (h - skyH);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }
    // Radiating perspective verticals
    for (var col = -8; col <= 8; col++) {
      var bx = w * 0.5 + col * (w * 0.18);
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + col * 24, skyH);
      ctx.lineTo(bx, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNeonCard(ctx, x, y, w, h, theme) {
    ctx.save();
    ctx.fillStyle = theme.panel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.cyan;
    ctx.shadowColor = theme.cyan;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowColor = theme.grid;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
    ctx.restore();
  }

  function drawChromeText(ctx, text, cx, cy, fontSize, maxW, theme) {
    ctx.save();
    ctx.font = 'italic 900 ' + fontSize + 'px "Impact", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var g = ctx.createLinearGradient(cx, cy - fontSize * 0.5, cx, cy + fontSize * 0.5);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.42, theme.cyan);
    g.addColorStop(0.50, '#1E1B4B');
    g.addColorStop(0.60, theme.grid);
    g.addColorStop(1, '#FFF1F2');
    ctx.shadowColor = theme.grid;
    ctx.shadowBlur = 18;
    ctx.fillStyle = g;
    ctx.fillText(text, cx, cy, maxW);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeText(text, cx, cy, maxW);
    ctx.restore();
  }

  function drawSynthIcon(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;
    ctx.strokeStyle = theme.cyan;
    ctx.shadowColor = theme.cyan;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3.5;

    if (name === 'retro-sun') {
      drawStripedSun(ctx, 0, 0, s * 0.85, theme);
    } else if (name === 'cassette-tape') {
      ctx.fillStyle = 'rgba(255,46,147,0.18)';
      ctx.fillRect(-s * 0.86, -s * 0.56, size * 0.86, size * 0.56);
      ctx.strokeRect(-s * 0.86, -s * 0.56, size * 0.86, size * 0.56);
      ctx.beginPath(); ctx.arc(-s * 0.36, -s * 0.05, s * 0.22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(s * 0.36, -s * 0.05, s * 0.22, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = theme.grid;
      ctx.strokeRect(-s * 0.52, s * 0.28, size * 0.52, s * 0.24);
    } else if (name === 'neon-palm') {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(-s * 0.1, s * 0.85); ctx.quadraticCurveTo(-s * 0.22, 0, 0, -s * 0.45); ctx.stroke();
      ctx.strokeStyle = theme.cyan;
      ctx.lineWidth = 4;
      for (var f = -2; f <= 2; f++) {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.45);
        ctx.quadraticCurveTo(f * s * 0.42, -s * 0.85, f * s * 0.72, -s * 0.25 + Math.abs(f) * 14);
        ctx.stroke();
      }
    } else if (name === 'sport-car') {
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, s * 0.25);
      ctx.lineTo(-s * 0.45, -s * 0.28);
      ctx.lineTo(s * 0.45, -s * 0.28);
      ctx.lineTo(s * 0.85, s * 0.25);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = theme.grid;
      ctx.fillRect(-s * 0.72, s * 0.02, s * 0.34, s * 0.14);
      ctx.fillRect(s * 0.38, s * 0.02, s * 0.34, s * 0.14);
    } else if (name === 'laser-grid') {
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.82); ctx.lineTo(s * 0.82, s * 0.65); ctx.lineTo(-s * 0.82, s * 0.65); ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = theme.cyan;
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, s * 0.18); ctx.lineTo(s * 0.5, s * 0.18);
      ctx.moveTo(0, -s * 0.82); ctx.lineTo(0, s * 0.65);
      ctx.stroke();
    } else {
      // vhs-play
      ctx.fillStyle = theme.cyan;
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.58);
      ctx.lineTo(s * 0.62, 0);
      ctx.lineTo(-s * 0.45, s * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = theme.grid;
      ctx.strokeRect(-s * 0.82, -s * 0.76, size * 0.82, size * 0.76);
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

  window.SynthwaveKit = {
    getTheme: getTheme,
    drawOutrunBackdrop: drawOutrunBackdrop,
    drawNeonCard: drawNeonCard,
    drawChromeText: drawChromeText,
    drawSynthIcon: drawSynthIcon,
    wrapLines: wrapLines
  };
})();
