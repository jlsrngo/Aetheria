/**
 * CobaltKit — Procedural Canvas 2D Engine for `mg-cobalt-editorial`.
 *
 * Inspired by minimalist cobalt light-shaft editorial showreels (`@ngorzc`):
 * - Full-bleed diagonal volumetric cobalt light beams on obsidian-navy
 * - 6 signature layouts: kinetic-word-reveal, icon-row-morph, radial-wheel-list,
 *   coverflow-carousel, logo-assemble (with blackout impact), brand-lockup-resolve
 * - 100% deterministic (pure function of time), responsive 16:9 & 9:16, Mode 'M' compliant.
 */
(function (global) {
  'use strict';

  var THEMES = {
    'cobalt-beam': {
      bg: '#020516',
      beamLow: 'rgba(18, 43, 128, 0.0)',
      beamMid: 'rgba(34, 78, 224, 0.56)',
      beamCore: 'rgba(92, 146, 255, 0.78)',
      beamHot: 'rgba(155, 195, 255, 0.42)',
      ink: '#F8FAFC',
      muted: 'rgba(203, 218, 255, 0.62)',
      accent: '#3B82F6',
    },
    'indigo-shaft': {
      bg: '#04041A',
      beamLow: 'rgba(40, 28, 136, 0.0)',
      beamMid: 'rgba(72, 62, 232, 0.54)',
      beamCore: 'rgba(128, 122, 255, 0.75)',
      beamHot: 'rgba(190, 188, 255, 0.38)',
      ink: '#F8FAFC',
      muted: 'rgba(216, 214, 255, 0.62)',
      accent: '#6366F1',
    },
    'obsidian-ice': {
      bg: '#020914',
      beamLow: 'rgba(12, 62, 112, 0.0)',
      beamMid: 'rgba(24, 118, 206, 0.52)',
      beamCore: 'rgba(72, 186, 255, 0.74)',
      beamHot: 'rgba(186, 234, 255, 0.38)',
      ink: '#F8FAFC',
      muted: 'rgba(186, 230, 253, 0.62)',
      accent: '#38BDF8',
      backdropMode: 'beams',
    },
    'obsidian-violet': {
      bg: '#06060B',
      beamLow: 'rgba(89, 86, 118, 0.0)',
      beamMid: 'rgba(141, 129, 177, 0.24)',
      beamCore: 'rgba(167, 152, 214, 0.36)',
      beamHot: 'rgba(46, 223, 218, 0.25)',
      ink: '#F8FAFC',
      muted: 'rgba(203, 213, 225, 0.62)',
      accent: '#2EDFDA',
      secondary: '#F59E0B',
      backdropMode: 'obsidian-glow',
    },
    'obsidian-emerald': {
      bg: '#020303',
      beamLow: 'rgba(37, 108, 64, 0.0)',
      beamMid: 'rgba(54, 142, 86, 0.20)',
      beamCore: 'rgba(111, 237, 164, 0.32)',
      beamHot: 'rgba(166, 255, 227, 0.24)',
      ink: '#F8FAFC',
      muted: 'rgba(209, 250, 229, 0.62)',
      accent: '#6FEDA4',
      secondary: '#A6FFE3',
      backdropMode: 'obsidian-glow',
    },
    'obsidian-crimson': {
      bg: '#050406',
      beamLow: 'rgba(127, 29, 29, 0.0)',
      beamMid: 'rgba(194, 59, 71, 0.24)',
      beamCore: 'rgba(244, 63, 94, 0.34)',
      beamHot: 'rgba(254, 205, 211, 0.22)',
      ink: '#F8FAFC',
      muted: 'rgba(241, 245, 249, 0.62)',
      accent: '#C23B47',
      secondary: '#FB7185',
      backdropMode: 'obsidian-glow',
    },
  };

  var CAMERA_PRESETS = {
    static: { zoomFrom: 1.0, zoomTo: 1.0, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, blurFrom: 0, blurTo: 0 },
    'dolly-in': { zoomFrom: 0.94, zoomTo: 1.14, panXFrom: 0, panXTo: 0, panYFrom: 12, panYTo: -6, rollFromDeg: 0, rollToDeg: 0, blurFrom: 0, blurTo: 0 },
    'macro-pullback': { zoomFrom: 2.15, zoomTo: 1.0, panXFrom: -40, panXTo: 0, panYFrom: 28, panYTo: 0, rollFromDeg: 3.5, rollToDeg: 0, blurFrom: 4.5, blurTo: 0 },
    'macro-zoom-in': { zoomFrom: 0.92, zoomTo: 1.48, panXFrom: 0, panXTo: 18, panYFrom: 18, panYTo: -24, rollFromDeg: -1.5, rollToDeg: 1.0, blurFrom: 2.0, blurTo: 0 },
    'pan-sweep': { zoomFrom: 1.08, zoomTo: 1.04, panXFrom: 75, panXTo: -75, panYFrom: 0, panYTo: 0, rollFromDeg: 1.2, rollToDeg: -1.2, blurFrom: 0, blurTo: 0 },
    'tilt-push': { zoomFrom: 0.90, zoomTo: 1.22, panXFrom: 0, panXTo: 0, panYFrom: 45, panYTo: -18, rollFromDeg: -4.0, rollToDeg: 0.5, blurFrom: 2.5, blurTo: 0 },
    'rack-focus-in': { zoomFrom: 1.18, zoomTo: 1.0, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, blurFrom: 7.0, blurTo: 0 },
  };

  function resolveCamera(shot, localTime, dur) {
    var cam = shot.camera && typeof shot.camera === 'object' ? shot.camera : {};
    var presetName = cam.preset || shot.cameraPreset || 'static';
    var base = CAMERA_PRESETS[presetName] || CAMERA_PRESETS.static;
    var p = easeOutQuart(clamp(localTime / Math.max(0.4, dur * 0.78), 0, 1));
    var lerp = function (a, b) { return a + (b - a) * p; };
    var z0 = cam.zoomFrom !== undefined ? cam.zoomFrom : base.zoomFrom;
    var z1 = cam.zoomTo !== undefined ? cam.zoomTo : base.zoomTo;
    var px0 = cam.panXFrom !== undefined ? cam.panXFrom : base.panXFrom;
    var px1 = cam.panXTo !== undefined ? cam.panXTo : base.panXTo;
    var py0 = cam.panYFrom !== undefined ? cam.panYFrom : base.panYFrom;
    var py1 = cam.panYTo !== undefined ? cam.panYTo : base.panYTo;
    var r0 = cam.rollFromDeg !== undefined ? cam.rollFromDeg : base.rollFromDeg;
    var r1 = cam.rollToDeg !== undefined ? cam.rollToDeg : base.rollToDeg;
    var b0 = cam.blurFrom !== undefined ? cam.blurFrom : base.blurFrom;
    var b1 = cam.blurTo !== undefined ? cam.blurTo : base.blurTo;
    var blurP = easeOutCubic(clamp(localTime / Math.max(0.3, dur * 0.35), 0, 1));
    return {
      zoom: lerp(z0, z1),
      panX: lerp(px0, px1),
      panY: lerp(py0, py1),
      rollRad: (lerp(r0, r1) * Math.PI) / 180,
      blur: b0 + (b1 - b0) * blurP,
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function easeOutCubic(x) {
    var c = clamp(x, 0, 1);
    return 1 - Math.pow(1 - c, 3);
  }

  function easeOutQuart(x) {
    var c = clamp(x, 0, 1);
    return 1 - Math.pow(1 - c, 4);
  }

  function easeOutBack(x) {
    var c = clamp(x, 0, 1) - 1;
    var s = 1.65;
    return 1 + (s + 1) * c * c * c + s * c * c;
  }

  function springPop(t) {
    if (t <= 0) return 0;
    if (t >= 1.2) return 1;
    return 1 - Math.exp(-7.5 * t) * Math.cos(11.5 * t);
  }

  function getTheme(name) {
    return THEMES[name] || THEMES['cobalt-beam'];
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * Full-bleed diagonal volumetric cobalt light-beam backdrop.
   */
  function drawCobaltBeams(ctx, W, H, theme, globalT, intensity) {
    var mult = intensity === undefined ? 1.0 : clamp(intensity, 0, 1);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    if (mult <= 0.005) return;

    if (theme.backdropMode === 'obsidian-glow') {
      ctx.save();
      ctx.globalAlpha = mult;
      var gx = W * (0.5 + Math.sin(globalT * 0.35) * 0.08);
      var gy = H * (0.18 + Math.cos(globalT * 0.25) * 0.04);
      var rg = ctx.createRadialGradient(gx, gy, 10, gx, gy, Math.max(W, H) * 0.68);
      rg.addColorStop(0.0, theme.beamCore);
      rg.addColorStop(0.45, theme.beamMid);
      rg.addColorStop(1.0, theme.beamLow);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = mult;
    var diag = Math.hypot(W, H);
    var cx = W * 0.5;
    var cy = H * 0.5;
    var drift = Math.sin(globalT * 0.42) * diag * 0.045;
    var drift2 = Math.cos(globalT * 0.29) * diag * 0.035;

    ctx.translate(cx, cy);
    ctx.rotate(-0.54); // ~-31 deg signature diagonal shaft angle

    var bands = [
      { offset: -diag * 0.27 + drift, width: diag * 0.25, alpha: 0.92 },
      { offset: diag * 0.04 + drift2, width: diag * 0.30, alpha: 1.0 },
      { offset: diag * 0.36 - drift * 0.7, width: diag * 0.24, alpha: 0.85 },
    ];

    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var y0 = b.offset - b.width * 0.5;
      var y1 = b.offset + b.width * 0.5;
      var g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0.0, theme.beamLow);
      g.addColorStop(0.26, theme.beamMid);
      g.addColorStop(0.50, theme.beamCore);
      g.addColorStop(0.74, theme.beamMid);
      g.addColorStop(1.0, theme.beamLow);
      ctx.save();
      ctx.globalAlpha = mult * b.alpha;
      ctx.fillStyle = g;
      ctx.fillRect(-diag, y0, diag * 2, b.width);
      ctx.restore();
    }

    // Subtle specular hot streak along primary center beam
    var hy0 = diag * 0.04 + drift2 - diag * 0.07;
    var hy1 = diag * 0.04 + drift2 + diag * 0.07;
    var hg = ctx.createLinearGradient(0, hy0, 0, hy1);
    hg.addColorStop(0, 'rgba(255,255,255,0)');
    hg.addColorStop(0.5, theme.beamHot);
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(-diag, hy0, diag * 2, hy1 - hy0);
    ctx.restore();

    // Soft radial edge vignette for cinematic contrast
    var vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.22, cx, cy, diag * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(2,4,18,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * Crisp white micro-UI icon set for `icon-row-morph`.
   */
  function drawMicroIcon(ctx, kind, cx, cy, size, color) {
    var r = size * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.6, size * 0.09);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (kind === 'layers') {
      for (var li = -1; li <= 1; li++) {
        ctx.beginPath();
        ctx.moveTo(0, li * r * 0.42 - r * 0.22);
        ctx.lineTo(r * 0.78, li * r * 0.42);
        ctx.lineTo(0, li * r * 0.42 + r * 0.22);
        ctx.lineTo(-r * 0.78, li * r * 0.42);
        ctx.closePath();
        if (li === -1) ctx.fill();
        else ctx.stroke();
      }
    } else if (kind === 'wave') {
      var heights = [0.35, 0.85, 0.55, 0.95, 0.45];
      for (var wi = 0; wi < heights.length; wi++) {
        var bx = (wi - 2) * r * 0.36;
        var bh = r * 1.45 * heights[wi];
        roundRect(ctx, bx - r * 0.1, -bh * 0.5, r * 0.2, bh, r * 0.1);
        ctx.fill();
      }
    } else if (kind === 'sparkle') {
      ctx.beginPath();
      for (var si = 0; si < 8; si++) {
        var ang = (si * Math.PI) / 4;
        var rad = si % 2 === 0 ? r * 0.88 : r * 0.24;
        var px = Math.cos(ang) * rad;
        var py = Math.sin(ang) * rad;
        if (si === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'cube') {
      ctx.beginPath();
      for (var ci = 0; ci < 6; ci++) {
        var ca = (ci * Math.PI) / 3 - Math.PI / 2;
        var cpx = Math.cos(ca) * r * 0.78;
        var cpy = Math.sin(ca) * r * 0.78;
        if (ci === 0) ctx.moveTo(cpx, cpy);
        else ctx.lineTo(cpx, cpy);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, r * 0.78);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(-Math.PI / 6) * r * 0.78, Math.sin(-Math.PI / 6) * r * 0.78);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos((-5 * Math.PI) / 6) * r * 0.78, Math.sin((-5 * Math.PI) / 6) * r * 0.78);
      ctx.stroke();
    } else if (kind === 'sliders') {
      for (var sdi = -1; sdi <= 1; sdi++) {
        var sy = sdi * r * 0.5;
        ctx.beginPath();
        ctx.moveTo(-r * 0.75, sy);
        ctx.lineTo(r * 0.75, sy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sdi * r * 0.35, sy, r * 0.19, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'play') {
      roundRect(ctx, -r * 0.82, -r * 0.68, r * 1.64, r * 1.36, r * 0.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.22, -r * 0.32);
      ctx.lineTo(r * 0.38, 0);
      ctx.lineTo(-r * 0.22, r * 0.32);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'code') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, -r * 0.45);
      ctx.lineTo(-r * 0.72, 0);
      ctx.lineTo(-r * 0.25, r * 0.45);
      ctx.moveTo(r * 0.25, -r * 0.45);
      ctx.lineTo(r * 0.72, 0);
      ctx.lineTo(r * 0.25, r * 0.45);
      ctx.stroke();
    } else if (kind === 'bolt') {
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 0.82);
      ctx.lineTo(-r * 0.48, r * 0.08);
      ctx.lineTo(r * 0.05, r * 0.08);
      ctx.lineTo(-r * 0.14, r * 0.82);
      ctx.lineTo(r * 0.52, -r * 0.12);
      ctx.lineTo(-r * 0.02, -r * 0.12);
      ctx.closePath();
      ctx.fill();
    } else {
      // grid badge
      var gSz = r * 0.58;
      roundRect(ctx, -r * 0.72, -r * 0.72, gSz, gSz, r * 0.14);
      ctx.fill();
      roundRect(ctx, r * 0.14, -r * 0.72, gSz, gSz, r * 0.14);
      ctx.fill();
      roundRect(ctx, -r * 0.72, r * 0.14, gSz, gSz, r * 0.14);
      ctx.fill();
      roundRect(ctx, r * 0.14, r * 0.14, gSz, gSz, r * 0.14);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Geometric Aetheria italicized chevron-slash monogram (2 interlocking pieces).
   */
  function drawBrandMark(ctx, cx, cy, size, assembleP, color) {
    var p = clamp(assembleP, 0, 1);
    var ease = easeOutQuart(p);
    var inv = 1 - ease;
    var s = size;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;

    // Piece 1: Left bold slanted pillar (flies in from upper-left with slight tilt)
    ctx.save();
    ctx.translate(-inv * s * 1.15, -inv * s * 0.55);
    ctx.rotate(-inv * 0.35);
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, -s * 0.48);
    ctx.lineTo(s * 0.14, -s * 0.48);
    ctx.lineTo(-s * 0.24, s * 0.48);
    ctx.lineTo(-s * 0.46, s * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Piece 2: Right slanted stroke + base bar (flies in from lower-right)
    ctx.save();
    ctx.translate(inv * s * 1.15, inv * s * 0.55);
    ctx.rotate(inv * 0.32);
    ctx.beginPath();
    ctx.moveTo(s * 0.18, -s * 0.48);
    ctx.lineTo(s * 0.40, -s * 0.48);
    ctx.lineTo(s * 0.48, s * 0.48);
    ctx.lineTo(s * 0.25, s * 0.48);
    ctx.lineTo(s * 0.21, s * 0.14);
    ctx.lineTo(-s * 0.08, s * 0.14);
    ctx.lineTo(-s * 0.01, -s * 0.06);
    ctx.lineTo(s * 0.19, -s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  /**
   * Draws a miniature editorial UI/artwork showcase card for `coverflow-carousel`.
   */
  function drawShowcaseCard(ctx, x, y, w, h, card, t, micro, theme) {
    ctx.save();
    var style = (card && card.style) || 'cobalt-hero';

    // Outer card shadow + rounded frame
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, x, y, w, h, 14);

    if (style === 'editorial-light') {
      ctx.fillStyle = '#F4F6FB';
    } else if (style === 'cobalt-hero') {
      var cg = ctx.createLinearGradient(x, y, x + w, y + h);
      cg.addColorStop(0, '#0B1A5C');
      cg.addColorStop(0.55, '#2563EB');
      cg.addColorStop(1, '#0F172A');
      ctx.fillStyle = cg;
    } else if (style === 'sunset-stat') {
      var sg = ctx.createLinearGradient(x, y, x, y + h);
      sg.addColorStop(0, '#111827');
      sg.addColorStop(1, '#1E1B4B');
      ctx.fillStyle = sg;
    } else {
      ctx.fillStyle = '#090D1F';
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Clip interior
    ctx.save();
    roundRect(ctx, x, y, w, h, 14);
    ctx.clip();

    // Procedural miniature graphic per card style
    if (style === 'editorial-light') {
      ctx.fillStyle = '#1D4ED8';
      roundRect(ctx, x + w * 0.12, y + h * 0.14, w * 0.36, h * 0.09, 6);
      ctx.fill();
      ctx.fillStyle = '#E2E8F0';
      roundRect(ctx, x + w * 0.12, y + h * 0.30, w * 0.76, h * 0.34, 10);
      ctx.fill();
      ctx.fillStyle = '#0F172A';
      roundRect(ctx, x + w * 0.18, y + h * 0.36, w * 0.44, h * 0.06, 4);
      ctx.fill();
      ctx.fillStyle = '#3B82F6';
      roundRect(ctx, x + w * 0.18, y + h * 0.46, w * 0.62, h * 0.12, 6);
      ctx.fill();
    } else if (style === 'cobalt-hero') {
      // Glowing orbital ring
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.45, Math.min(w, h) * 0.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.45, Math.min(w, h) * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'waveform-ui') {
      // Audio waveform equalizer bars
      var bars = 12;
      for (var bi = 0; bi < bars; bi++) {
        var bh = h * (0.12 + 0.34 * Math.abs(Math.sin(t * 2.4 + bi * 0.65)));
        var bx = x + w * 0.12 + (bi / bars) * w * 0.76;
        ctx.fillStyle = bi % 3 === 0 ? '#60A5FA' : 'rgba(248,250,252,0.75)';
        roundRect(ctx, bx, y + h * 0.48 - bh * 0.5, w * 0.04, bh, 3);
        ctx.fill();
      }
    } else if (style === 'code-matrix') {
      // Dot matrix / timeline blocks
      for (var r = 0; r < 5; r++) {
        for (var c = 0; c < 6; c++) {
          var on = ((r * 7 + c * 3) % 5) < 3;
          ctx.fillStyle = on ? '#38BDF8' : 'rgba(148,163,184,0.22)';
          roundRect(ctx, x + w * 0.14 + c * w * 0.125, y + h * 0.20 + r * h * 0.085, w * 0.08, h * 0.05, 3);
          ctx.fill();
        }
      }
    } else {
      // Dark studio timeline UI
      ctx.fillStyle = 'rgba(59,130,246,0.22)';
      roundRect(ctx, x + w * 0.1, y + h * 0.18, w * 0.8, h * 0.28, 8);
      ctx.fill();
      var trackCols = ['#3B82F6', '#818CF8', '#38BDF8'];
      for (var ti = 0; ti < 3; ti++) {
        ctx.fillStyle = trackCols[ti];
        var tw = w * (0.35 + ((ti * 23) % 35) / 100);
        var tx = x + w * (0.1 + ti * 0.12);
        roundRect(ctx, tx, y + h * (0.54 + ti * 0.085), tw, h * 0.055, 4);
        ctx.fill();
      }
    }

    if (!micro && card) {
      var darkText = style === 'editorial-light';
      ctx.fillStyle = darkText ? '#0F172A' : '#F8FAFC';
      ctx.font = '700 ' + Math.round(w * 0.092) + 'px "Inter", "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(card.title || ''), x + w * 0.1, y + h * 0.87, w * 0.8);

      if (card.tag) {
        ctx.fillStyle = darkText ? '#3B82F6' : 'rgba(191,219,254,0.78)';
        ctx.font = '600 ' + Math.round(w * 0.058) + 'px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(String(card.tag).toUpperCase(), x + w * 0.1, y + h * 0.94, w * 0.8);
      }
    }

    ctx.restore();

    // Subtle specular glass border
    roundRect(ctx, x, y, w, h, 14);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Main deterministic shot renderer called by `story-runtime.js`.
   */
  function renderShot(ctx, W, H, safe, shot, localTime, globalT, defaultTheme, micro) {
    var theme = getTheme(shot.theme || defaultTheme || 'cobalt-beam');
    var layout = shot.layout || 'kinetic-word-reveal';
    var dur = Math.max(0.5, Number(shot.duration) || 4.0);
    var isPortrait = H > W;
    var cx = W * 0.5;
    var cy = H * 0.5;

    // Blackout curve for `logo-assemble` dramatic drop
    var beamIntensity = 1.0;
    if (layout === 'logo-assemble' && shot.blackout !== false) {
      var bStart = dur * 0.52;
      var bEnd = dur * 0.82;
      if (localTime >= bStart && localTime <= bEnd) {
        var fadeInDrop = clamp((localTime - bStart) / 0.12, 0, 1);
        var fadeOutDrop = clamp((bEnd - localTime) / 0.22, 0, 1);
        beamIntensity = 1.0 - Math.min(fadeInDrop, fadeOutDrop);
      }
    }

    // 1. Signature diagonal cobalt light-beam (or obsidian glow) backdrop
    drawCobaltBeams(ctx, W, H, theme, globalT, beamIntensity);

    // Subtle shot-end fade when transitioning out (except brand-lockup-resolve hold)
    var exitFade = 1.0;
    if (layout !== 'brand-lockup-resolve' && layout !== 'logo-assemble') {
      exitFade = clamp((dur - localTime) / 0.35, 0, 1);
    }

    // 2. Virtual 2.5D Camera Transform (zoom / pan / roll / rack-focus blur)
    var cam = resolveCamera(shot, localTime, dur);

    ctx.save();
    ctx.globalAlpha = exitFade;
    if (cam.blur > 0.15) {
      ctx.filter = 'blur(' + cam.blur.toFixed(1) + 'px)';
    }
    ctx.translate(cx + cam.panX, cy + cam.panY);
    ctx.rotate(cam.rollRad);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cx, -cy);

    if (layout === 'kinetic-word-reveal') {
      if (!micro) {
        var words = String(shot.headline || 'Kreativitas butuh ruang bermain.').trim().split(/\s+/);
        var fs = isPortrait ? 46 : 42;
        ctx.font = '500 ' + fs + 'px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        var spaceW = ctx.measureText(' ').width;
        var wordWidths = words.map(function (w) { return ctx.measureText(w).width; });
        var totalW = wordWidths.reduce(function (a, b) { return a + b; }, 0) + spaceW * Math.max(0, words.length - 1);
        var maxLineW = safe.w * 0.88;
        var scaleFit = totalW > maxLineW ? maxLineW / totalW : 1.0;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scaleFit, scaleFit);
        var cursorX = -totalW * 0.5;
        var revealSpan = Math.min(dur * 0.62, Math.max(0.9, words.length * 0.26));
        var step = revealSpan / Math.max(1, words.length);

        for (var wi = 0; wi < words.length; wi++) {
          var wt = localTime - wi * step;
          var alpha = easeOutCubic(wt / 0.38);
          var dy = (1 - easeOutCubic(wt / 0.42)) * 12;
          if (alpha > 0.01) {
            ctx.save();
            ctx.globalAlpha = exitFade * alpha;
            ctx.fillStyle = theme.ink;
            ctx.shadowColor = 'rgba(147, 197, 253, 0.35)';
            ctx.shadowBlur = (1 - alpha) * 14;
            ctx.fillText(words[wi], cursorX, dy);
            ctx.restore();
          }
          cursorX += wordWidths[wi] + spaceW;
        }
        ctx.restore();
      } else {
        // Mode 'M': minimal luminous horizon bar
        var barW = W * 0.24 * easeOutCubic(localTime / 0.8);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        roundRect(ctx, cx - barW * 0.5, cy - 3, barW, 6, 3);
        ctx.fill();
      }
    } else if (layout === 'icon-row-morph') {
      var leftIcons = shot.leftIcons || ['layers', 'wave', 'sparkle', 'cube', 'sliders'];
      var rightIcons = shot.rightIcons || ['play', 'code', 'bolt', 'grid'];
      var anchor = String(shot.anchor || 'Aetheria');
      var iconSz = isPortrait ? 34 : 30;
      var gap = isPortrait ? 48 : 44;

      var anchorFs = isPortrait ? 42 : 36;
      ctx.font = '600 ' + anchorFs + 'px "Inter", "Segoe UI", sans-serif';
      var anchorW = micro ? 0 : ctx.measureText(anchor).width + 36;

      var leftSpan = leftIcons.length * gap;
      var rightSpan = rightIcons.length * gap;
      var fullW = leftSpan + anchorW + rightSpan;
      var startX = cx - fullW * 0.5;

      // Left icon row
      for (var li = 0; li < leftIcons.length; li++) {
        var lt = localTime - li * 0.11;
        var lp = springPop(lt);
        if (lp > 0.01) {
          ctx.save();
          ctx.globalAlpha = exitFade * clamp(lp, 0, 1);
          var ix = startX + li * gap + gap * 0.5;
          ctx.translate(ix, cy);
          ctx.scale(lp, lp);
          drawMicroIcon(ctx, leftIcons[li], 0, 0, iconSz, theme.ink);
          ctx.restore();
        }
      }

      // Center anchor word
      if (!micro) {
        var ap = easeOutCubic(localTime / 0.35);
        ctx.save();
        ctx.globalAlpha = exitFade * ap;
        ctx.fillStyle = theme.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(anchor, startX + leftSpan + anchorW * 0.5, cy);
        ctx.restore();
      }

      // Right icon row
      for (var ri = 0; ri < rightIcons.length; ri++) {
        var rt = localTime - (leftIcons.length * 0.11 + 0.12 + ri * 0.11);
        var rp = springPop(rt);
        if (rp > 0.01) {
          ctx.save();
          ctx.globalAlpha = exitFade * clamp(rp, 0, 1);
          var rx = startX + leftSpan + anchorW + ri * gap + gap * 0.5;
          ctx.translate(rx, cy);
          ctx.scale(rp, rp);
          drawMicroIcon(ctx, rightIcons[ri], 0, 0, iconSz, theme.ink);
          ctx.restore();
        }
      }
    } else if (layout === 'radial-wheel-list') {
      var items = Array.isArray(shot.items) && shot.items.length
        ? shot.items
        : [
            '18 Skill Deklaratif',
            'Mesin Motion Lokal',
            'Render CDP + FFmpeg',
            'Preview Instan',
            'Mode Microstock',
            'Audio & SFX Sinkron',
            'Zero Biaya Cloud',
            'AI Agent Otonom',
          ];
      var anchorWord = String(shot.anchor || 'Aetheria');
      var enterW = easeOutCubic(localTime / 0.45);
      var progress = clamp((localTime - 0.25) / Math.max(0.8, dur - 0.7), 0, 1);
      // Smooth stepped rotation across all items
      var floatIdx = progress * (items.length - 1);

      var anchorX = isPortrait ? cx - 190 : cx - 125;
      var dotX = isPortrait ? cx - 65 : cx - 30;
      var listX = isPortrait ? cx - 30 : cx + 6;
      var itemFs = isPortrait ? 38 : 34;

      // Anchor word + bright focal dot
      ctx.save();
      ctx.globalAlpha = exitFade * enterW;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '600 ' + itemFs + 'px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(anchorWord, dotX - 24, cy);
      }
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      ctx.arc(dotX, cy, isPortrait ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Tilted curved radial drum list
      var radius = isPortrait ? 460 : 390;
      var angleStep = 0.145;
      for (var ii = 0; ii < items.length; ii++) {
        var delta = ii - floatIdx;
        if (Math.abs(delta) > 4.2) continue;
        var ang = delta * angleStep - 0.055; // signature slight counter-clockwise tilt
        var dist = Math.abs(delta);
        var alphaItem = clamp(1.0 - dist * 0.26, 0.06, 1.0) * enterW;
        var yOff = Math.sin(ang) * radius;
        var xCurve = (1 - Math.cos(ang)) * -120;

        ctx.save();
        ctx.globalAlpha = exitFade * alphaItem;
        ctx.translate(listX + xCurve, cy + yOff);
        ctx.rotate(ang * 0.48);

        if (!micro) {
          ctx.fillStyle = dist < 0.42 ? '#FFFFFF' : theme.muted;
          ctx.font = (dist < 0.42 ? '600 ' : '400 ') + itemFs + 'px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          if (dist < 0.42) {
            ctx.shadowColor = 'rgba(147, 197, 253, 0.45)';
            ctx.shadowBlur = 12;
          }
          ctx.fillText(String(items[ii]), 0, 0, W - listX - 40);
        } else {
          // Mode 'M': abstract luminous pill bars on radial arc
          ctx.fillStyle = dist < 0.42 ? '#FFFFFF' : 'rgba(203, 218, 255, 0.35)';
          roundRect(ctx, 0, -8, 180 + ((ii * 37) % 90), 16, 8);
          ctx.fill();
        }
        ctx.restore();
      }
    } else if (layout === 'coverflow-carousel') {
      var cards = Array.isArray(shot.cards) && shot.cards.length
        ? shot.cards
        : [
            { title: 'Aurora Glass', tag: 'Liquid UI', style: 'cobalt-hero' },
            { title: 'Editorial', tag: 'Minimalist', style: 'editorial-light' },
            { title: 'Audio Sync', tag: 'BPM + SFX', style: 'waveform-ui' },
            { title: 'Timeline', tag: '30fps Local', style: 'dark-studio' },
            { title: 'Story Core', tag: 'Dialect A', style: 'code-matrix' },
            { title: '3D Spatial', tag: 'WebGL PBR', style: 'cobalt-hero' },
            { title: 'Export MP4', tag: 'Zero Cloud', style: 'sunset-stat' },
          ];

      var enterC = easeOutCubic(localTime / 0.45);
      var sweep = clamp(localTime / dur, 0, 1);
      var focusFloat = 0.6 + sweep * Math.max(1, cards.length - 2.2);
      var baseCardW = isPortrait ? 300 : 215;
      var baseCardH = isPortrait ? 410 : 285;
      var spacing = isPortrait ? 205 : 152;

      // Sort back-to-front by distance from focusFloat so center card overlaps cleanly
      var order = cards.map(function (c, idx) {
        return { card: c, idx: idx, dist: Math.abs(idx - focusFloat) };
      });
      order.sort(function (a, b) { return b.dist - a.dist; });

      for (var oi = 0; oi < order.length; oi++) {
        var entry = order[oi];
        var d = entry.idx - focusFloat;
        var absD = Math.abs(d);
        if (absD > 3.6) continue;

        var scale = clamp(1.06 - absD * 0.14, 0.58, 1.06) * (0.85 + 0.15 * enterC);
        var cw = baseCardW * scale;
        var ch = baseCardH * scale;
        var offsetX = d * spacing * (1 - absD * 0.045);
        var cardAlpha = clamp(1.0 - absD * 0.18, 0.25, 1.0) * enterC;

        ctx.save();
        ctx.globalAlpha = exitFade * cardAlpha;
        drawShowcaseCard(ctx, cx + offsetX - cw * 0.5, cy - ch * 0.5, cw, ch, entry.card, globalT, micro, theme);
        ctx.restore();
      }
    } else if (layout === 'logo-assemble') {
      var markSize = isPortrait ? 190 : 145;
      var assembleP = clamp(localTime / (dur * 0.42), 0, 1);
      var pulse = 1.0 + Math.sin(clamp(localTime - dur * 0.42, 0, 1) * Math.PI) * 0.06;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      drawBrandMark(ctx, 0, 0, markSize, assembleP, '#FFFFFF');
      ctx.restore();
    } else if (layout === 'brand-lockup-resolve') {
      var brand = String(shot.brand || 'Aetheria');
      var subtitle = String(shot.subtitle || 'LOCAL AI MOTION STUDIO').toUpperCase();
      var markSz = isPortrait ? 128 : 96;
      var brandFs = isPortrait ? 92 : 74;
      var subFs = isPortrait ? 20 : 15;

      ctx.font = '700 ' + brandFs + 'px "Inter", "Segoe UI", sans-serif';
      var brandW = micro ? 0 : ctx.measureText(brand).width;
      var gapMark = micro ? 0 : markSz * 0.24;
      var lockupW = markSz + gapMark + brandW;

      var slideP = easeOutQuart(localTime / 0.7);
      var markFinalX = cx - lockupW * 0.5 + markSz * 0.5;
      var markX = cx + (markFinalX - cx) * slideP;

      drawBrandMark(ctx, markX, cy - (isPortrait ? 10 : 6), markSz, 1.0, '#FFFFFF');

      if (!micro) {
        var textX = markFinalX + markSz * 0.5 + gapMark;
        var revealP = clamp((localTime - 0.35) / 0.75, 0, 1);

        // Halftone / dot-matrix dissolve into crisp solid wordmark
        if (revealP > 0.01 && revealP < 0.95) {
          ctx.save();
          ctx.globalAlpha = exitFade * (1 - revealP) * 0.85;
          ctx.fillStyle = '#93C5FD';
          var cols = 22;
          var rows = 6;
          for (var rr = 0; rr < rows; rr++) {
            for (var cc = 0; cc < cols; cc++) {
              var hash = Math.sin(rr * 17.3 + cc * 31.7) * 0.5 + 0.5;
              if (hash < revealP * 1.15) {
                var dx = textX + (cc / cols) * brandW;
                var dy = cy - brandFs * 0.38 + (rr / rows) * brandFs * 0.76;
                ctx.beginPath();
                ctx.arc(dx, dy, 2.2 * (1 - revealP * 0.6), 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
          ctx.restore();
        }

        if (revealP > 0.2) {
          var solidA = easeOutCubic((revealP - 0.2) / 0.8);
          ctx.save();
          ctx.globalAlpha = exitFade * solidA;
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 ' + brandFs + 'px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(brand, textX, cy - (isPortrait ? 10 : 6));
          ctx.restore();
        }

        // Wide-tracked uppercase subtitle underneath
        var subP = easeOutCubic((localTime - 0.95) / 0.55);
        if (subP > 0.01) {
          ctx.save();
          ctx.globalAlpha = exitFade * subP * 0.82;
          ctx.fillStyle = '#CBD5E1';
          ctx.font = '700 ' + subFs + 'px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var spaced = subtitle.split('').join(' ');
          ctx.fillText(spaced, cx, cy + (isPortrait ? 78 : 56), safe.w * 0.9);
          ctx.restore();
        }
      }
    } else if (layout === 'tilted-chart-dolly') {
      // Opal-inspired 3D-foreshortened perspective bar chart with glowing cyan->amber focal bar
      var bars = Array.isArray(shot.bars) && shot.bars.length ? shot.bars : [0.35, 0.52, 0.44, 0.62, 0.92, 0.58, 0.48];
      var labels = Array.isArray(shot.labels) && shot.labels.length ? shot.labels : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      var hlIdx = shot.highlightIdx !== undefined ? Number(shot.highlightIdx) : 4;
      var cardW = isPortrait ? safe.w * 0.88 : Math.min(820, safe.w * 0.78);
      var cardH = isPortrait ? 460 : 380;
      var tiltP = easeOutQuart(clamp(localTime / (dur * 0.55), 0, 1));
      var perspScaleY = 0.72 + 0.28 * tiltP;

      ctx.save();
      ctx.translate(cx, cy + (1 - tiltP) * 36);
      ctx.scale(1.0, perspScaleY);
      roundRect(ctx, -cardW * 0.5, -cardH * 0.5, cardW, cardH, 22);
      ctx.fillStyle = 'rgba(18, 20, 28, 0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Avg dashed reference line
      var baseY = cardH * 0.30;
      var maxBarH = cardH * 0.54;
      var avgY = baseY - maxBarH * 0.62;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(-cardW * 0.42, avgY);
      ctx.lineTo(cardW * 0.42, avgY);
      ctx.stroke();
      ctx.restore();

      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '700 32px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(shot.metric || '9h 15m'), -cardW * 0.42, -cardH * 0.32);
        ctx.fillStyle = theme.muted;
        ctx.font = '500 18px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(shot.avgLabel || 'avg'), cardW * 0.42, avgY - 8);
      }

      var barGap = (cardW * 0.78) / bars.length;
      var barW = barGap * 0.46;
      for (var bi = 0; bi < bars.length; bi++) {
        var bp = easeOutCubic(clamp((localTime - 0.12 - bi * 0.06) / 0.55, 0, 1));
        var bh = maxBarH * clamp(Number(bars[bi]) || 0.4, 0.1, 1.0) * bp;
        var bx = -cardW * 0.39 + bi * barGap + (barGap - barW) * 0.5;
        var by = baseY - bh;
        ctx.save();
        if (bi === hlIdx) {
          var bg = ctx.createLinearGradient(bx, baseY, bx, by);
          bg.addColorStop(0, theme.accent || '#2EDFDA');
          bg.addColorStop(0.55, '#38BDF8');
          bg.addColorStop(1, theme.secondary || '#F59E0B');
          ctx.fillStyle = bg;
          ctx.shadowColor = theme.accent || '#2EDFDA';
          ctx.shadowBlur = 24;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
        }
        roundRect(ctx, bx, by, barW, Math.max(4, bh), 6);
        ctx.fill();
        ctx.restore();
        if (!micro && labels[bi]) {
          ctx.fillStyle = bi === hlIdx ? theme.ink : theme.muted;
          ctx.font = '600 18px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(labels[bi]), bx + barW * 0.5, baseY + 28);
        }
      }
      ctx.restore();
    } else if (layout === 'metric-pills-tree') {
      // Opal-inspired glowing counter pills + connector bracket rising to hero score
      var pills = Array.isArray(shot.pills) && shot.pills.length
        ? shot.pills
        : [
            { label: 'Sleep', value: 67 },
            { label: 'Focus', value: 43 },
            { label: 'Rest', value: 33 },
          ];
      var countP = easeOutQuart(clamp(localTime / (dur * 0.65), 0, 1));
      var treeP = easeOutCubic(clamp((localTime - dur * 0.32) / (dur * 0.35), 0, 1));
      var pillW = isPortrait ? 210 : 185;
      var pillH = 74;
      var pillGap = isPortrait ? 24 : 38;
      var rowW = pills.length * pillW + (pills.length - 1) * pillGap;
      var rowY = cy + (treeP * 84);

      // Luminous connector bracket + hero score above
      if (treeP > 0.02) {
        ctx.save();
        ctx.globalAlpha = exitFade * treeP;
        var leftX = cx - rowW * 0.5 + pillW * 0.5;
        var rightX = cx + rowW * 0.5 - pillW * 0.5;
        var midY = rowY - 72;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = theme.accent || '#8D81B1';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(leftX, rowY - pillH * 0.5 - 8);
        ctx.lineTo(leftX, midY);
        ctx.lineTo(rightX, midY);
        ctx.lineTo(rightX, rowY - pillH * 0.5 - 8);
        ctx.moveTo(cx, midY);
        ctx.lineTo(cx, midY - 34);
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (!micro) {
          var scoreVal = Math.round((Number(shot.scoreValue) || 94) * countP);
          ctx.fillStyle = theme.muted;
          ctx.font = '500 22px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(shot.scoreLabel || 'Score'), cx, midY - 122);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 72px "Inter", "Segoe UI", sans-serif';
          ctx.fillText(String(scoreVal) + ' ▲', cx, midY - 58);
        }
        ctx.restore();
      }

      for (var pi = 0; pi < pills.length; pi++) {
        var pop = springPop(localTime - pi * 0.18);
        if (pop <= 0.01) continue;
        var px = cx - rowW * 0.5 + pi * (pillW + pillGap);
        ctx.save();
        ctx.globalAlpha = exitFade * clamp(pop, 0, 1);
        ctx.translate(px + pillW * 0.5, rowY);
        ctx.scale(pop, pop);
        roundRect(ctx, -pillW * 0.5, -pillH * 0.5, pillW, pillH, 999);
        ctx.fillStyle = 'rgba(15, 16, 26, 0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = theme.accent || '#8D81B1';
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (!micro) {
          var pv = Math.round((Number(pills[pi].value) || 50) * countP);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 32px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(pv), 0, 0);
          ctx.fillStyle = theme.muted;
          ctx.font = '500 20px "Inter", "Segoe UI", sans-serif';
          ctx.fillText(String(pills[pi].label || ''), 0, pillH * 0.5 + 26);
        }
        ctx.restore();
      }
    } else if (layout === 'neon-score-ring') {
      // Vercel-inspired neon emerald radial score ring counting up with macro pull-back
      var sFrom = shot.scoreFrom !== undefined ? Number(shot.scoreFrom) : 12;
      var sTo = shot.scoreTo !== undefined ? Number(shot.scoreTo) : 96;
      var prog = easeOutQuart(clamp(localTime / (dur * 0.68), 0, 1));
      var curScore = Math.round(sFrom + (sTo - sFrom) * prog);
      var ringR = isPortrait ? 130 : 108;
      var ringColor = theme.accent || '#6FEDA4';

      // Track ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(cx, cy - 18, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Glowing progress arc
      var endAng = -Math.PI * 0.5 + (curScore / 100) * Math.PI * 2;
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = 28;
      ctx.beginPath();
      ctx.arc(cx, cy - 18, ringR, -Math.PI * 0.5, endAng);
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (!micro) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 ' + (isPortrait ? 78 : 66) + 'px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(curScore), cx, cy - 18);

        var labelP = easeOutCubic(clamp((localTime - dur * 0.35) / 0.45, 0, 1));
        ctx.globalAlpha = exitFade * labelP;
        ctx.fillStyle = theme.muted;
        ctx.font = '500 22px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(String(shot.headline || 'Real Experience Score'), cx, cy - ringR - 46);
        ctx.fillStyle = ringColor;
        ctx.font = '600 22px "Inter", "Segoe UI", sans-serif';
        ctx.fillText('● ' + String(shot.badge || 'Above 90 — Great'), cx, cy + ringR + 36);
      }
      ctx.restore();
    } else if (layout === 'macro-ui-prompt') {
      // Vercel v0-inspired dark obsidian AI prompt bar with typing reveal + glowing arrow button
      var boxW = isPortrait ? safe.w * 0.90 : Math.min(760, safe.w * 0.72);
      var boxH = 148;
      var promptStr = String(shot.promptText || 'Build a 30fps local motion showreel with synced SFX');
      var typeP = clamp((localTime - 0.35) / Math.max(0.6, dur * 0.55), 0, 1);
      var visibleText = promptStr.slice(0, Math.round(promptStr.length * typeP));
      var chips = Array.isArray(shot.chips) && shot.chips.length ? shot.chips : ['18 Skills', 'Local CDP', 'Zero Cloud', 'SFX Sync'];

      if (!micro) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 ' + (isPortrait ? 40 : 36) + 'px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(shot.headline || 'What do you want to create?'), cx, cy - boxH * 0.5 - 42);
      }

      // Prompt box
      roundRect(ctx, cx - boxW * 0.5, cy - boxH * 0.5, boxW, boxH, 18);
      ctx.fillStyle = 'rgba(12, 14, 22, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (!micro) {
        ctx.fillStyle = '#F8FAFC';
        ctx.font = '400 24px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(visibleText + (Math.floor(localTime * 3) % 2 === 0 ? '|' : ''), cx - boxW * 0.5 + 26, cy - boxH * 0.5 + 26, boxW - 110);

        ctx.fillStyle = theme.muted;
        ctx.font = '500 17px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(String(shot.modelTag || 'Aetheria Engine v2'), cx - boxW * 0.5 + 26, cy + boxH * 0.5 - 38);
      }

      // Glowing white submit arrow button
      var btnSz = 44;
      var bx = cx + boxW * 0.5 - btnSz - 18;
      var by = cy + boxH * 0.5 - btnSz - 16;
      ctx.save();
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 18;
      roundRect(ctx, bx, by, btnSz, btnSz, 11);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#09090B';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + btnSz * 0.5, by + btnSz * 0.7);
      ctx.lineTo(bx + btnSz * 0.5, by + btnSz * 0.3);
      ctx.moveTo(bx + btnSz * 0.32, by + btnSz * 0.46);
      ctx.lineTo(bx + btnSz * 0.5, by + btnSz * 0.28);
      ctx.lineTo(bx + btnSz * 0.68, by + btnSz * 0.46);
      ctx.stroke();
      ctx.restore();

      // Feature chips underneath
      var chipW = (boxW - 36) / chips.length;
      for (var ci = 0; ci < chips.length; ci++) {
        var chx = cx - boxW * 0.5 + ci * (chipW + 12);
        var chy = cy + boxH * 0.5 + 22;
        roundRect(ctx, chx, chy, chipW, 38, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.stroke();
        if (!micro) {
          ctx.fillStyle = theme.muted;
          ctx.font = '500 16px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(chips[ci]), chx + chipW * 0.5, chy + 19, chipW - 14);
        }
      }
    }

    ctx.restore();
  }

  global.CobaltKit = {
    THEMES: THEMES,
    CAMERA_PRESETS: CAMERA_PRESETS,
    getTheme: getTheme,
    resolveCamera: resolveCamera,
    drawCobaltBeams: drawCobaltBeams,
    drawBrandMark: drawBrandMark,
    renderShot: renderShot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
