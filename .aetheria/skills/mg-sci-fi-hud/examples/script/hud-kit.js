(function () {
  'use strict';

  var THEMES = {
    'cyber-cyan': {
      bg: '#020A0D',
      cya: '#00E5FF',
      dim: '#0B7C8C',
      deep: '#0E3A42',
      hot: '#E8FEFF',
      alert: '#FF2A1F'
    },
    'alert-amber': {
      bg: '#0D0602',
      cya: '#FF7A00',
      dim: '#9E4700',
      deep: '#3D1A00',
      hot: '#FFF3E0',
      alert: '#FF2A1F'
    },
    'crimson-lock': {
      bg: '#0E0205',
      cya: '#FF2A54',
      dim: '#9E1432',
      deep: '#3B0613',
      hot: '#FFE4E9',
      alert: '#FFBE0B'
    },
    'stealth-emerald': {
      bg: '#020D08',
      cya: '#00F5A0',
      dim: '#0A875B',
      deep: '#073B28',
      hot: '#E6FFF6',
      alert: '#FF6A00'
    },
    'orbital-violet': {
      bg: '#060312',
      cya: '#A855F7',
      dim: '#6B21A8',
      deep: '#2E1065',
      hot: '#FAF5FF',
      alert: '#00E5FF'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['cyber-cyan'];
  }

  function hash(a, b) {
    var s = Math.sin(a * 127.1 + (b || 0) * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // Precomputed 36-segment counter-rotating tactical ring intervals
  var SEGS = (function () {
    var r = [], a = 0, i = 0;
    while (a < 360 && i < 36) {
      var len = 5 + hash(3, i) * 26;
      var gap = 4 + hash(4, i) * 9;
      r.push([a, Math.min(a + len, 360), hash(5, i) > 0.65]);
      a += len + gap;
      i++;
    }
    return r;
  })();

  function drawHexGridBackdrop(ctx, w, h, safe, theme, t) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle radial bloom behind central scope
    var cx = safe.x + safe.w * 0.5;
    var cy = safe.y + safe.h * 0.44;
    var bgGlow = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.48);
    bgGlow.addColorStop(0, theme.cya + '22');
    bgGlow.addColorStop(0.55, theme.deep + '33');
    bgGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, w, h);

    // Fine technical coordinate grid + corner calibration brackets
    ctx.save();
    ctx.strokeStyle = theme.deep;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    var step = 64;
    for (var gx = safe.x; gx <= safe.x + safe.w; gx += step) {
      ctx.beginPath(); ctx.moveTo(gx, safe.y); ctx.lineTo(gx, safe.y + safe.h); ctx.stroke();
    }
    for (var gy = safe.y; gy <= safe.y + safe.h; gy += step) {
      ctx.beginPath(); ctx.moveTo(safe.x, gy); ctx.lineTo(safe.x + safe.w, gy); ctx.stroke();
    }

    // Outer frame corner L-brackets (like frameCorners in 22-hud)
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 2;
    var arm = 28;
    var corners = [
      [safe.x, safe.y, 1, 1],
      [safe.x + safe.w, safe.y, -1, 1],
      [safe.x + safe.w, safe.y + safe.h, -1, -1],
      [safe.x, safe.y + safe.h, 1, -1]
    ];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0], c[1] + c[3] * arm);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0] + c[2] * arm, c[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Top FUI Header Bar (KESTREL-9 hexagon logo + hexagonal mode badge + UTC clock + blinking REC dot)
  function drawTopBar(ctx, safe, theme, t, modeLabel, micro) {
    var x0 = safe.x + 18;
    var x1 = safe.x + safe.w - 18;
    var y = safe.y + 32;
    var cx = safe.x + safe.w * 0.5;

    ctx.save();
    // Hexagon + slash logo mark
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var an = (i * 60 + 30) * Math.PI / 180;
      var hx = x0 + 14 + 12 * Math.cos(an);
      var hy = y + 12 * Math.sin(an);
      if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + 8, y + 6); ctx.lineTo(x0 + 20, y - 6); ctx.stroke();

    // Horizontal top divider rules
    ctx.strokeStyle = theme.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y + 26); ctx.lineTo(cx - 170, y + 26);
    ctx.moveTo(cx + 170, y + 26); ctx.lineTo(x1, y + 26);
    ctx.stroke();

    // Center hexagonal status box
    var bw = 310, bh = 32, bx = cx - bw * 0.5, by = y - 16;
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 12, by);
    ctx.lineTo(bx + bw - 12, by);
    ctx.lineTo(bx + bw, by + bh * 0.5);
    ctx.lineTo(bx + bw - 12, by + bh);
    ctx.lineTo(bx + 12, by + bh);
    ctx.lineTo(bx, by + bh * 0.5);
    ctx.closePath();
    ctx.fillStyle = theme.cya + '22';
    ctx.fill();
    ctx.stroke();

    // Blinking REC red indicator dot
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = theme.alert;
      ctx.beginPath();
      ctx.arc(x1 - 165, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!micro) {
      ctx.fillStyle = theme.cya;
      ctx.font = '700 20px "JetBrains Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('KESTREL-9', x0 + 36, y);

      ctx.fillStyle = theme.hot;
      ctx.font = '700 17px "JetBrains Mono", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(modeLabel || 'TARGET LOCKED', cx, y + 1);

      var sec = Math.floor(52 + t) % 60;
      var frm = Math.floor((t * 30) % 30);
      var clk = 'UTC 03:14:' + String(sec).padStart(2, '0') + '.' + String(frm).padStart(2, '0');
      ctx.fillStyle = theme.cya;
      ctx.font = '500 15px "JetBrains Mono", "Consolas", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(clk, x1, y);
    }
    ctx.restore();
  }

  // 3D Wireframe + Dotted-Land Holographic Globe + Multi-Ring Scope + Conic Radar Sweep (matching 22-hud!)
  function drawHolographicScope(ctx, cx, cy, R, theme, t, locked, micro) {
    var DEG = Math.PI / 180;
    ctx.save();

    // 1. 3D Holographic Globe inside scope (r = R * 0.68)
    var gR = R * 0.68;
    var rotLon = t * 0.45;
    var tiltLat = 0.32;

    // Globe limb glow
    var limb = ctx.createRadialGradient(cx, cy, gR * 0.2, cx, cy, gR);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(0.75, theme.deep + '44');
    limb.addColorStop(1, theme.cya + '55');
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(cx, cy, gR, 0, Math.PI * 2);
    ctx.fill();

    // Latitude / Longitude 3D projected graticule & procedural continent landmass dots
    ctx.strokeStyle = theme.dim;
    ctx.lineWidth = 1.1;
    for (var lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      var started = false;
      for (var lon = 0; lon <= 360; lon += 8) {
        var phi = lat * DEG, lam = lon * DEG + rotLon;
        var x3 = Math.cos(phi) * Math.sin(lam);
        var y3 = Math.sin(phi) * Math.cos(tiltLat) - Math.cos(phi) * Math.cos(lam) * Math.sin(tiltLat);
        var z3 = Math.sin(phi) * Math.sin(tiltLat) + Math.cos(phi) * Math.cos(lam) * Math.cos(tiltLat);
        if (z3 > -0.15) {
          var sx = cx + x3 * gR, sy = cy - y3 * gR;
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }
    for (var lon2 = 0; lon2 < 360; lon2 += 30) {
      ctx.beginPath();
      var st2 = false;
      for (var lat2 = -80; lat2 <= 80; lat2 += 8) {
        var phi2 = lat2 * DEG, lam2 = lon2 * DEG + rotLon;
        var vx = Math.cos(phi2) * Math.sin(lam2);
        var vy = Math.sin(phi2) * Math.cos(tiltLat) - Math.cos(phi2) * Math.cos(lam2) * Math.sin(tiltLat);
        var vz = Math.sin(phi2) * Math.sin(tiltLat) + Math.cos(phi2) * Math.cos(lam2) * Math.cos(tiltLat);
        if (vz > 0) {
          var px = cx + vx * gR, py = cy - vy * gR;
          if (!st2) { ctx.moveTo(px, py); st2 = true; } else ctx.lineTo(px, py);
        } else {
          st2 = false;
        }
      }
      ctx.stroke();
    }

    // Dotted continent point-cloud + horizontal holographic scan plane
    var scanY = Math.sin(t * 1.6) * 0.85;
    for (var dLat = -65; dLat <= 70; dLat += 6) {
      for (var dLon = 0; dLon < 360; dLon += 6) {
        // Procedural continent mask
        var cVal = Math.sin(dLat * 0.06) * Math.cos(dLon * 0.045) + 0.5 * Math.sin((dLat + dLon) * 0.08);
        if (cVal < 0.08) continue;
        var pPhi = dLat * DEG, pLam = dLon * DEG + rotLon;
        var dx = Math.cos(pPhi) * Math.sin(pLam);
        var dy = Math.sin(pPhi) * Math.cos(tiltLat) - Math.cos(pPhi) * Math.cos(pLam) * Math.sin(tiltLat);
        var dz = Math.sin(pPhi) * Math.sin(tiltLat) + Math.cos(pPhi) * Math.cos(pLam) * Math.cos(tiltLat);
        if (dz <= 0.05) continue;
        var nearScan = Math.abs(dy - scanY) < 0.12;
        ctx.fillStyle = nearScan ? theme.hot : theme.cya;
        ctx.globalAlpha = nearScan ? 0.95 : (dz * 0.75);
        ctx.fillRect(cx + dx * gR - 1.5, cy - dy * gR - 1.5, nearScan ? 3.5 : 2.5, nearScan ? 3.5 : 2.5);
      }
    }
    ctx.globalAlpha = 1;

    // 2. Conic radar sweep trail over scope
    var sweepAng = (t * 1.8) % (Math.PI * 2);
    for (var w = 0; w < 18; w++) {
      var a0 = sweepAng - (w + 1) * 0.055;
      var a1 = sweepAng - w * 0.055;
      ctx.fillStyle = theme.cya;
      ctx.globalAlpha = (1 - w / 18) * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 0.93, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = theme.hot;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(sweepAng) * 20, cy + Math.sin(sweepAng) * 20);
    ctx.lineTo(cx + Math.cos(sweepAng) * R * 0.93, cy + Math.sin(sweepAng) * R * 0.93);
    ctx.stroke();

    // 3. Outer 4-quadrant ring (R) + cardinal notches
    var rot1 = t * 0.12;
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 1.6;
    for (var q = 0; q < 4; q++) {
      var qa0 = rot1 + (q * 90 + 5) * DEG;
      var qa1 = rot1 + (q * 90 + 85) * DEG;
      ctx.beginPath();
      ctx.arc(cx, cy, R, qa0, qa1);
      ctx.stroke();

      var cn = rot1 + q * Math.PI * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(cn) * (R - 6), cy + Math.sin(cn) * (R - 6));
      ctx.lineTo(cx + Math.cos(cn) * (R + 8), cy + Math.sin(cn) * (R + 8));
      ctx.stroke();
    }

    // 4. 120-tick Azimuth Bearing Ring (R * 0.94) + degree labels
    var rTick = R * 0.94;
    for (var ti = 0; ti < 120; ti++) {
      var tan = (ti * 3 - 90) * DEG;
      var big = ti % 10 === 0, mid = ti % 5 === 0;
      var tlen = big ? 13 : (mid ? 8 : 4);
      ctx.strokeStyle = big ? theme.cya : theme.dim;
      ctx.lineWidth = big ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(tan) * rTick, cy + Math.sin(tan) * rTick);
      ctx.lineTo(cx + Math.cos(tan) * (rTick - tlen), cy + Math.sin(tan) * (rTick - tlen));
      ctx.stroke();
      if (!micro && big && ti % 20 === 0) {
        ctx.fillStyle = theme.dim;
        ctx.font = '600 13px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ti * 3).padStart(3, '0'), cx + Math.cos(tan) * (R + 22), cy + Math.sin(tan) * (R + 22));
      }
    }

    // 5. Counter-rotating 36-segment tactical ring (R * 0.86) + dashed ring (R * 0.80)
    var rSeg = R * 0.86;
    var rot2 = -t * 0.35;
    for (var si = 0; si < SEGS.length; si++) {
      var seg = SEGS[si];
      ctx.strokeStyle = seg[2] ? theme.cya : theme.dim;
      ctx.lineWidth = seg[2] ? 3.2 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rSeg, rot2 + seg[0] * DEG, rot2 + seg[1] * DEG);
      ctx.stroke();
    }
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 6. Central Target Crosshair & Converging Lock-On Brackets!
    var bSize = locked ? (28 + Math.sin(t * 10) * 2) : 52;
    var bCol = locked ? theme.hot : theme.cya;
    ctx.strokeStyle = bCol;
    ctx.lineWidth = 2.2;
    var bDirs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (var bi = 0; bi < 4; bi++) {
      var bd = bDirs[bi];
      var bx2 = cx + bd[0] * bSize, by2 = cy + bd[1] * bSize;
      ctx.beginPath();
      ctx.moveTo(bx2, by2 - bd[1] * 14);
      ctx.lineTo(bx2, by2);
      ctx.lineTo(bx2 - bd[0] * 14, by2);
      ctx.stroke();
    }
    // Center reticle lines
    ctx.strokeStyle = theme.hot;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 38, cy); ctx.lineTo(cx - 12, cy);
    ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 38, cy);
    ctx.moveTo(cx, cy - 38); ctx.lineTo(cx, cy - 12);
    ctx.moveTo(cx, cy + 12); ctx.lineTo(cx, cy + 38);
    ctx.stroke();

    // Corner scope readouts (MAG, FOV, HDG, TLT)
    if (!micro) {
      ctx.fillStyle = theme.cya;
      ctx.font = '600 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('MAG ×6.4', cx - R, cy - R - 10);
      ctx.fillText('HDG 121.4°', cx - R, cy + R + 22);
      ctx.textAlign = 'right';
      ctx.fillText('FOV 1.94°', cx + R, cy - R - 10);
      ctx.fillText('TLT 31.2°', cx + R, cy + R + 22);
    }

    ctx.restore();
  }

  // FUI Telemetry Panel Chrome (like panel() in 22-hud)
  function drawFuiSubPanel(ctx, x, y, w, h, idx, title, theme, micro) {
    ctx.save();
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y + 20); ctx.lineTo(x + w, y + 20);
    ctx.stroke();
    ctx.fillStyle = theme.cya;
    ctx.fillRect(x, y + 18, 22, 3.5);

    ctx.strokeStyle = theme.dim;
    ctx.beginPath();
    ctx.moveTo(x, y + 26); ctx.lineTo(x, y + h);
    ctx.moveTo(x, y + h); ctx.lineTo(x + 16, y + h);
    ctx.moveTo(x + w - 16, y + h); ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - 16);
    ctx.stroke();

    if (!micro) {
      ctx.fillStyle = theme.dim;
      ctx.font = '600 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(idx, x, y + 14);
      ctx.fillStyle = theme.cya;
      ctx.fillText(title, x + 28, y + 14);
    }
    ctx.restore();
  }

  // Live Sparkline & 24-Bar LED Spectrum Analyzer (bottom telemetry deck)
  function drawTelemetryDeck(ctx, x, y, w, h, theme, t, shot, micro) {
    var colW = (w - 28) * 0.5;
    // Left sub-panel: 01 NAV TELEMETRY + SLANT RNG
    drawFuiSubPanel(ctx, x, y, colW, h, '01', 'NAV TELEMETRY', theme, micro);
    var rng = (shot.rangeKm || 1648.3) - (t * 12.4) % 240;
    if (!micro) {
      ctx.fillStyle = theme.hot;
      ctx.font = '700 54px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(rng.toFixed(1), x + 12, y + 34);
      ctx.fillStyle = theme.cya;
      ctx.font = '700 18px "JetBrains Mono", monospace';
      ctx.fillText('KM', x + colW - 36, y + 60);
    }
    // 20-tick zoom meter
    for (var z = 0; z < 20; z++) {
      var on = z < 14 + Math.floor(Math.sin(t * 3) * 4);
      ctx.fillStyle = on ? theme.cya : theme.deep;
      ctx.fillRect(x + 12 + z * ((colW - 24) / 20), y + 102, ((colW - 24) / 20) - 3, 7);
    }
    // Telemetry rows
    var rows = [
      ['AZM', '121.29°', 0.78],
      ['ALT', '512.08 KM', 0.64],
      ['SNR', '41.2 dB', 0.92]
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y + 132 + r * 30;
      if (!micro) {
        ctx.fillStyle = theme.dim;
        ctx.font = '600 14px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(rows[r][0], x + 12, ry);
        ctx.fillStyle = theme.hot;
        ctx.fillText(rows[r][1], x + 68, ry);
      }
      var bx = x + colW * 0.56, bw = colW * 0.40;
      ctx.fillStyle = theme.deep;
      ctx.fillRect(bx, ry - 10, bw, 5);
      ctx.fillStyle = theme.cya;
      ctx.fillRect(bx, ry - 10, bw * rows[r][2], 5);
    }

    // Right sub-panel: 02 SIGNAL SPECTRUM & WAVEFORM
    var rx = x + colW + 28;
    drawFuiSubPanel(ctx, rx, y, colW, h, '02', 'SIGNAL ANALYSIS', theme, micro);

    // Live Sparkline waveform
    var spY = y + 42, spH = 54, spW = colW - 20;
    ctx.strokeStyle = theme.cya;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (var i = 0; i <= 40; i++) {
      var u = i / 40;
      var v = 0.5 + 0.32 * Math.sin(u * 12 + t * 6) + 0.12 * Math.cos(u * 23 - t * 4);
      var px = rx + 10 + u * spW;
      var py = spY + (1 - v) * spH;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // 20-bar segmented LED Spectrum Equalizer
    var bars = 20;
    var barW = spW / bars;
    var baseEqY = y + h - 18;
    for (var b = 0; b < bars; b++) {
      var pk = b === 13;
      var lvl = pk ? 11 : Math.max(2, Math.round((0.3 + 0.65 * Math.abs(Math.sin(b * 0.55 + t * 5))) * 10));
      for (var q = 0; q < lvl; q++) {
        ctx.fillStyle = pk ? theme.hot : (q > 7 ? theme.cya : theme.dim);
        ctx.fillRect(rx + 10 + b * barW, baseEqY - q * 6.5, barW - 3, 4);
      }
    }
  }

  window.HudKit = {
    getTheme: getTheme,
    drawHexGridBackdrop: drawHexGridBackdrop,
    drawTopBar: drawTopBar,
    drawHolographicScope: drawHolographicScope,
    drawTelemetryDeck: drawTelemetryDeck
  };
})();
