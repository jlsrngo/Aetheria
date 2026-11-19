(function () {
  'use strict';

  var THEMES = {
    'cream-1919': {
      paper: '#F1E9DA',
      margin: '#EAE0CE',
      ink: '#121212',
      red: '#E03C31',
      yellow: '#F2B705',
      blue: '#1E4FA3',
      grid: 'rgba(18, 18, 18, 0.14)'
    },
    'weimar-ochre': {
      paper: '#EFE3C8',
      margin: '#E4D5B4',
      ink: '#141210',
      red: '#D93829',
      yellow: '#E8A810',
      blue: '#1B4994',
      grid: 'rgba(20, 18, 16, 0.14)'
    },
    'dessau-dark': {
      paper: '#141414',
      margin: '#0D0D0D',
      ink: '#F1E9DA',
      red: '#E03C31',
      yellow: '#F2B705',
      blue: '#2E6BD9',
      grid: 'rgba(241, 233, 218, 0.14)'
    },
    'swiss-red': {
      paper: '#F4EDE0',
      margin: '#E8DEC9',
      ink: '#111111',
      red: '#D92B22',
      yellow: '#F2B705',
      blue: '#111111',
      grid: 'rgba(17, 17, 17, 0.15)'
    },
    'zurich-mono': {
      paper: '#ECEAE4',
      margin: '#E0DDD5',
      ink: '#0F0F0F',
      red: '#E03C31',
      yellow: '#525252',
      blue: '#1E4FA3',
      grid: 'rgba(15, 15, 15, 0.15)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['cream-1919'];
  }

  function io2(u) {
    var c = Math.max(0, Math.min(1, u));
    return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
  }

  // 12-detent mechanical escapement rotation (quantized 7.5-degree teeth like 09-bauhaus)
  function escapementAngle(u) {
    var P = io2(u);
    var x = P * 12;
    var k = Math.min(12, Math.floor(x + 1e-9));
    var f = x - k;
    return (-90 + 7.5 * (k + io2(Math.max(0, Math.min(1, (f - 0.35) / 0.65))))) * (Math.PI / 180);
  }

  // Lithograph Passkreuz registration target (ring + 4 crosshair ticks + center dot)
  function drawPasskreuz(ctx, x, y, scale, color) {
    var s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(-26, -1.2, 18, 2.4);
    ctx.fillRect(8, -1.2, 18, 2.4);
    ctx.fillRect(-1.2, -26, 2.4, 18);
    ctx.fillRect(-1.2, 8, 2.4, 18);
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Full-bleed lithograph paper sheet + modular grid + trim Passkreuz marks (matching 09-bauhaus)
  function drawLithoSheet(ctx, w, h, safe, theme, beatNum, micro) {
    // Outer press margin + inner poster trim sheet
    ctx.fillStyle = theme.margin;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = theme.paper;
    ctx.fillRect(safe.x, safe.y, safe.w, safe.h);

    // Subtle modular construction lines inside sheet
    var mod = 112;
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.2;
    for (var gx = safe.x + mod; gx < safe.x + safe.w; gx += mod) {
      ctx.beginPath(); ctx.moveTo(gx, safe.y); ctx.lineTo(gx, safe.y + safe.h); ctx.stroke();
    }
    for (var gy = safe.y + mod; gy < safe.y + safe.h; gy += mod) {
      ctx.beginPath(); ctx.moveTo(safe.x, gy); ctx.lineTo(safe.x + safe.w, gy); ctx.stroke();
    }
    ctx.restore();

    // 4 Corner Passkreuz registration marks
    drawPasskreuz(ctx, safe.x + 24, safe.y + 24, 0.75, theme.ink);
    drawPasskreuz(ctx, safe.x + safe.w - 24, safe.y + 24, 0.75, theme.ink);
    drawPasskreuz(ctx, safe.x + 24, safe.y + safe.h - 24, 0.75, theme.ink);
    drawPasskreuz(ctx, safe.x + safe.w - 24, safe.y + safe.h - 24, 0.75, theme.ink);

    if (!micro) {
      ctx.save();
      ctx.fillStyle = theme.ink;
      ctx.font = '700 16px "Inter", "Helvetica Neue", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var bStr = String(beatNum).padStart(2, '0');
      ctx.fillText('SCHLAG ' + bStr + ' / 20', safe.x + 56, safe.y + 24);
      ctx.fillText('BOGEN 09 — KONSTRUKTION · 120 BPM · M = 112 PX', safe.x + 56, safe.y + safe.h - 24);
      ctx.restore();
    }
  }

  // Monumental Kandinsky Constructivist Geometry (Red Circle + Yellow Triangle + Blue Square + Black Bar + Pivot)
  function drawKandinskyGroup(ctx, cx, cy, mod, theme, t, localT, mode) {
    ctx.save();
    ctx.translate(cx, cy);

    if (mode === 'escapement-pivot') {
      var ang = escapementAngle(Math.min(1, localT / 1.8));
      ctx.rotate(ang);
    }

    var slideIn = io2(Math.min(1, localT / 0.65));
    var rCircle = mod * 1.65;

    // Off-beat construction Passkreuz targets
    drawPasskreuz(ctx, mod * 0.45, -mod * 0.15, 1.35, theme.ink);

    // 1. Heavy Black Structural Bar & Cobalt Blue Square
    if (mode === 'kandinsky-assembly') {
      ctx.fillStyle = theme.blue;
      ctx.fillRect(-mod * 0.6, -mod * 2.95, mod * 1.45 * slideIn, mod * 1.45 * slideIn);
      ctx.fillStyle = theme.ink;
      ctx.fillRect(-mod * 0.6, -mod * 3.65, mod * 3.2 * slideIn, mod * 0.72);
    }

    // 2. Monumental Primary Red Circle
    var circleX = (mode === 'kandinsky-assembly') ? (-mod * 0.15 + (1 - slideIn) * mod * 1.2) : (mod * 0.68);
    var circleY = (mode === 'kandinsky-assembly') ? (-mod * 0.35) : (-mod * 1.45);
    ctx.fillStyle = theme.red;
    ctx.beginPath();
    ctx.arc(circleX, circleY, rCircle, 0, Math.PI * 2);
    ctx.fill();

    // 3. Monumental Yellow Triangle whose apex kisses the Red Circle!
    var triApexX = circleX;
    var triApexY = circleY + rCircle;
    var triBaseY = triApexY + mod * 2.85 * slideIn;
    var triHalfW = mod * 1.55;
    ctx.fillStyle = theme.yellow;
    ctx.beginPath();
    ctx.moveTo(triApexX, triApexY);
    ctx.lineTo(triApexX + triHalfW, triBaseY);
    ctx.lineTo(triApexX - triHalfW, triBaseY);
    ctx.closePath();
    ctx.fill();

    // 4. Black Quarter-Circle Sector & Horizon Rule
    if (mode !== 'kandinsky-assembly') {
      // Sweeping black quarter-circle at bottom-left of triangle
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      ctx.moveTo(triApexX - triHalfW, triBaseY);
      ctx.arc(triApexX - triHalfW, triBaseY, mod * 1.45, -Math.PI, -Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();

      // Top-left small black quarter-circle counterpoint
      ctx.beginPath();
      ctx.moveTo(circleX - rCircle - mod * 0.85, circleY - mod * 0.45);
      ctx.arc(circleX - rCircle - mod * 0.85, circleY - mod * 0.45, mod * 0.72, 0, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();

      // Horizontal structural rule & pivot ring at kiss point
      ctx.fillStyle = theme.ink;
      ctx.fillRect(-mod * 2.2, triApexY - 3, mod * 4.8 * slideIn, 6);
      drawPasskreuz(ctx, triApexX + mod * 0.75, triApexY, 1.5, theme.ink);
    }

    ctx.restore();
  }

  // Phase-shifted 120 BPM Modular Tile Cascade & Two-Sided Card Flip (Frames 4 & 5 of 09-bauhaus!)
  function drawTileCascade(ctx, safe, theme, t, localT, flipMode) {
    var cols = 4;
    var rows = 6;
    var padX = 56, padY = 120;
    var gridW = safe.w - padX * 2;
    var gridH = safe.h - padY * 2;
    var tw = gridW / cols;
    var th = tw;
    var startX = safe.x + padX;
    var startY = safe.y + (safe.h - rows * th) * 0.5;

    ctx.save();
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var tx = startX + c * tw;
        var ty = startY + r * th;
        var phase = (r * 0.18 + c * 0.24);
        var beat = Math.floor((t * 2 + phase));
        var frac = (t * 2 + phase) - beat;
        var snap = frac < 0.35 ? io2(frac / 0.35) : 1;

        ctx.save();
        ctx.translate(tx + tw * 0.5, ty + th * 0.5);

        if (flipMode && c >= 2) {
          // Two-sided card flip revealing stark black back-plate with primary geometry
          var flipScale = Math.cos(snap * Math.PI);
          ctx.scale(Math.abs(flipScale), 1);
          ctx.fillStyle = theme.ink;
          ctx.fillRect(-tw * 0.5, -th * 0.5, tw + 1, th + 1);
          ctx.fillStyle = (r % 3 === 0) ? theme.red : ((r % 3 === 1) ? theme.yellow : theme.blue);
          if (r % 2 === 0) {
            ctx.beginPath();
            ctx.moveTo(-tw * 0.5, th * 0.5);
            ctx.arc(-tw * 0.5, th * 0.5, tw, -Math.PI * 0.5, 0);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(-tw * 0.35, -th * 0.35, tw * 0.7, th * 0.7);
          }
        } else {
          // Rotating quarter-circle Bauhaus tile
          var rot = ((beat + snap) % 4) * (Math.PI * 0.5);
          ctx.rotate(rot);
          var isTop = r < 3;
          ctx.fillStyle = isTop
            ? ((c + r) % 3 === 0 ? theme.ink : theme.red)
            : ((c === 3) ? theme.yellow : theme.ink);
          ctx.beginPath();
          ctx.moveTo(-tw * 0.5, th * 0.5);
          ctx.arc(-tw * 0.5, th * 0.5, tw, -Math.PI * 0.5, 0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // Iconic Vertical Monumental BAUHAUS Wordmark + ▲■● Primary Triad + Rotated Baseline (Frame 6 of 09-bauhaus!)
  function drawVerticalMonument(ctx, safe, theme, word, subtitle, headline, micro) {
    if (micro) return;
    var chars = String(word || 'BAUHAUS').toUpperCase().slice(0, 8).split('');
    var startX = safe.x + 115;
    var topY = safe.y + 135;
    var botY = safe.y + safe.h - 145;
    var stepY = (botY - topY) / Math.max(1, chars.length - 1);

    ctx.save();
    ctx.fillStyle = theme.ink;
    ctx.font = '900 108px "Inter", "Helvetica Neue", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Vertical letter stack (rotated -90 deg per glyph just like 09-bauhaus!)
    for (var i = 0; i < chars.length; i++) {
      var gy = botY - i * stepY;
      ctx.save();
      ctx.translate(startX, gy);
      ctx.rotate(-Math.PI * 0.5);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
    }

    // Iconic tiny ▲ yellow / ■ red / ● blue primary triad beside top letter!
    var tx = startX + 76;
    var ty = topY - 26;
    // Yellow triangle
    ctx.fillStyle = theme.yellow;
    ctx.beginPath();
    ctx.moveTo(tx - 10, ty - 8); ctx.lineTo(tx + 10, ty - 8); ctx.lineTo(tx, ty - 26);
    ctx.closePath();
    ctx.fill();
    // Red square
    ctx.fillStyle = theme.red;
    ctx.fillRect(tx - 9, ty + 2, 18, 18);
    // Blue circle
    ctx.fillStyle = theme.blue;
    ctx.beginPath();
    ctx.arc(tx, ty + 36, 9, 0, Math.PI * 2);
    ctx.fill();

    // Rotated letter-spaced baseline "FORM · FARBE · FUNKTION"
    ctx.save();
    ctx.translate(startX + 82, botY);
    ctx.rotate(-Math.PI * 0.5);
    ctx.fillStyle = theme.ink;
    ctx.font = '700 22px "Inter", "Helvetica Neue", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(subtitle || 'FORM  ·  FARBE  ·  FUNKTION', 0, 0);
    ctx.restore();

    // Clean Swiss headline caption at top-right
    if (headline) {
      ctx.fillStyle = theme.ink;
      ctx.font = '900 44px "Inter", "Helvetica Neue", sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(headline.toUpperCase(), safe.x + safe.w - 56, safe.y + 72, safe.w * 0.62);
    }

    ctx.restore();
  }

  window.BauhausKit = {
    getTheme: getTheme,
    drawLithoSheet: drawLithoSheet,
    drawKandinskyGroup: drawKandinskyGroup,
    drawTileCascade: drawTileCascade,
    drawVerticalMonument: drawVerticalMonument
  };
})();
