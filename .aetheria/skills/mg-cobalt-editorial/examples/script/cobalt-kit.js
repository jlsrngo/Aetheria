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
      bg: '#040818',
      beamLow: 'rgba(18, 36, 98, 0.0)',
      beamMid: 'rgba(34, 68, 166, 0.26)',
      beamCore: 'rgba(64, 106, 212, 0.42)',
      beamHot: 'rgba(98, 138, 228, 0.14)',
      ink: '#F8FAFC',
      muted: 'rgba(203, 218, 255, 0.65)',
      accent: '#4F7DF3',
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
    static: { zoomFrom: 1.0, zoomTo: 1.0, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, curve: 'whip-out', velocityBlur: 0 },
    'dolly-in': { zoomFrom: 0.92, zoomTo: 1.18, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 14, panYTo: -8, rollFromDeg: 0, rollToDeg: 0, curve: 'whip-out', velocityBlur: 1.2 },
    'macro-pullback': { zoomFrom: 3.1, zoomTo: 1.0, pivotX: 0.28, pivotY: 0.34, panXFrom: -24, panXTo: 0, panYFrom: 18, panYTo: 0, rollFromDeg: 2.8, rollToDeg: 0, curve: 'whip-out', velocityBlur: 4.2 },
    'macro-zoom-in': { zoomFrom: 1.0, zoomTo: 2.35, pivotX: 0.32, pivotY: 0.45, panXFrom: 0, panXTo: 20, panYFrom: 0, panYTo: -16, rollFromDeg: 0, rollToDeg: -1.8, curve: 'whip-inout', velocityBlur: 3.8 },
    'pan-sweep': { zoomFrom: 1.16, zoomTo: 1.02, pivotX: 0.5, pivotY: 0.5, panXFrom: 120, panXTo: -95, panYFrom: 0, panYTo: 0, rollFromDeg: 1.8, rollToDeg: -1.4, curve: 'whip-out', velocityBlur: 2.6 },
    'tilt-push': { zoomFrom: 0.88, zoomTo: 1.42, pivotX: 0.55, pivotY: 0.55, panXFrom: -20, panXTo: 10, panYFrom: 52, panYTo: -22, rollFromDeg: -4.5, rollToDeg: 0.6, curve: 'whip-out', velocityBlur: 3.0 },
    'rack-focus-in': { zoomFrom: 1.32, zoomTo: 1.0, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, curve: 'whip-out', velocityBlur: 5.5 },
  };

  function easeOutExpo(x) {
    var c = clamp(x, 0, 1);
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  }

  function easeInOutExpo(x) {
    var c = clamp(x, 0, 1);
    if (c === 0) return 0;
    if (c === 1) return 1;
    return c < 0.5 ? Math.pow(2, 20 * c - 10) * 0.5 : (2 - Math.pow(2, -20 * c + 10)) * 0.5;
  }

  function evalCamCurve(curve, u) {
    if (curve === 'whip-inout') return easeInOutExpo(u);
    if (curve === 'linear') return clamp(u, 0, 1);
    return easeOutExpo(u);
  }

  function resolveCamera(shot, localTime, dur) {
    var cam = shot.camera && typeof shot.camera === 'object' ? shot.camera : {};
    var presetName = cam.preset || shot.cameraPreset || 'static';
    var base = CAMERA_PRESETS[presetName] || CAMERA_PRESETS.static;
    var curve = cam.curve || base.curve || 'whip-out';
    var span = Math.max(0.28, Number(cam.moveDuration) || Math.min(dur * 0.68, 0.95));
    var u = clamp(localTime / span, 0, 1);
    var uPrev = clamp((localTime - 0.033) / span, 0, 1);
    var p = evalCamCurve(curve, u);
    var pPrev = evalCamCurve(curve, uPrev);
    var vel = Math.abs(p - pPrev) / 0.033; // normalized curve velocity

    var lerp = function (a, b) { return a + (b - a) * p; };
    var z0 = cam.zoomFrom !== undefined ? cam.zoomFrom : base.zoomFrom;
    var z1 = cam.zoomTo !== undefined ? cam.zoomTo : base.zoomTo;
    var px0 = cam.panXFrom !== undefined ? cam.panXFrom : base.panXFrom;
    var px1 = cam.panXTo !== undefined ? cam.panXTo : base.panXTo;
    var py0 = cam.panYFrom !== undefined ? cam.panYFrom : base.panYFrom;
    var py1 = cam.panYTo !== undefined ? cam.panYTo : base.panYTo;
    var r0 = cam.rollFromDeg !== undefined ? cam.rollFromDeg : base.rollFromDeg;
    var r1 = cam.rollToDeg !== undefined ? cam.rollToDeg : base.rollToDeg;
    var pivX = cam.pivotX !== undefined ? cam.pivotX : (base.pivotX !== undefined ? base.pivotX : 0.5);
    var pivY = cam.pivotY !== undefined ? cam.pivotY : (base.pivotY !== undefined ? base.pivotY : 0.5);
    var vBlurScale = cam.velocityBlur !== undefined ? cam.velocityBlur : (base.velocityBlur || 0);

    // Optional exit whip-up in last 0.22s when shot.whipExit is true
    var exitPanY = 0;
    var exitBlur = 0;
    if (shot.whipExit && localTime > dur - 0.24) {
      var eu = clamp((localTime - (dur - 0.24)) / 0.24, 0, 1);
      var ep = eu * eu * eu;
      exitPanY = -ep * 260;
      exitBlur = ep * 9.0;
    }

    var manualBlur = 0;
    if (cam.blurFrom !== undefined || cam.blurTo !== undefined) {
      var b0 = cam.blurFrom !== undefined ? cam.blurFrom : 0;
      var b1 = cam.blurTo !== undefined ? cam.blurTo : 0;
      manualBlur = b0 + (b1 - b0) * easeOutExpo(clamp(localTime / 0.35, 0, 1));
    }

    var autoBlur = clamp(vel * 0.55 * vBlurScale, 0, 10.0);

    return {
      zoom: lerp(z0, z1),
      pivotX: pivX,
      pivotY: pivY,
      panX: lerp(px0, px1),
      panY: lerp(py0, py1) + exitPanY,
      rollRad: (lerp(r0, r1) * Math.PI) / 180,
      blur: Math.max(manualBlur, autoBlur, exitBlur),
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
    var drift = Math.sin(globalT * 0.36) * diag * 0.035;

    ctx.translate(cx, cy);
    ctx.rotate(-0.48); // gentle diffused diagonal wash

    // Single wide, ultra-soft atmospheric wash (no harsh zebra stripes)
    var mainW = diag * 0.82;
    var y0 = drift - mainW * 0.5;
    var y1 = drift + mainW * 0.5;
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0.0, theme.beamLow);
    g.addColorStop(0.28, theme.beamMid);
    g.addColorStop(0.50, theme.beamCore);
    g.addColorStop(0.72, theme.beamMid);
    g.addColorStop(1.0, theme.beamLow);
    ctx.fillStyle = g;
    ctx.fillRect(-diag, y0, diag * 2, mainW);

    // Subtle secondary wide soft glow near upper-left for depth
    var secW = diag * 0.56;
    var sy0 = -diag * 0.34 - drift * 0.5 - secW * 0.5;
    var sg = ctx.createLinearGradient(0, sy0, 0, sy0 + secW);
    sg.addColorStop(0.0, theme.beamLow);
    sg.addColorStop(0.50, theme.beamHot);
    sg.addColorStop(1.0, theme.beamLow);
    ctx.fillStyle = sg;
    ctx.fillRect(-diag, sy0, diag * 2, secW);
    ctx.restore();

    // Gentle radial edge vignette
    var vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.28, cx, cy, diag * 0.68);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(3,6,20,0.48)');
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

    if (style === 'brand-hero') {
      var bhg = ctx.createLinearGradient(x, y, x + w, y + h);
      bhg.addColorStop(0, '#16307A');
      bhg.addColorStop(0.6, '#3B6BE0');
      bhg.addColorStop(1, '#0E1840');
      ctx.fillStyle = bhg;
    } else if (style === 'editorial-light') {
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
    if (style === 'brand-hero') {
      ctx.save();
      ctx.shadowColor = '#60A5FA';
      ctx.shadowBlur = 22;
      drawBrandMark(ctx, x + w * 0.5, y + h * 0.42, Math.min(w, h) * 0.36, 1.0, '#FFFFFF');
      ctx.restore();
    } else if (style === 'editorial-light') {
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

    // Subtle specular glass border (brighter neon cyan rim on hero card)
    roundRect(ctx, x, y, w, h, 14);
    if (card && card.__isHeroCenter) {
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.95)';
      ctx.lineWidth = 2.4;
      ctx.shadowColor = '#3B82F6';
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

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
    if (layout !== 'brand-lockup-resolve' && layout !== 'logo-assemble' && layout !== 'prompt-type-send') {
      exitFade = clamp((dur - localTime) / 0.35, 0, 1);
    }

    // 2. Virtual 2.5D Camera Transform (off-center pivot zoom / pan / roll / velocity blur)
    var cam = resolveCamera(shot, localTime, dur);
    var pvx = W * cam.pivotX;
    var pvy = H * cam.pivotY;

    ctx.save();
    ctx.globalAlpha = exitFade;
    if (cam.blur > 0.2) {
      ctx.filter = 'blur(' + cam.blur.toFixed(1) + 'px)';
    }
    ctx.translate(pvx + cam.panX, pvy + cam.panY);
    ctx.rotate(cam.rollRad);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-pvx, -pvy);

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
    } else if (layout === 'coverflow-carousel' || layout === 'orbit-carousel') {
      // 3D Cylindrical Orbit Ring Carousel with glowing floor ring, mirror reflection,
      // and dynamic speed-ramp: spins FAST then brakes SUDDENLY onto the hero card!
      var cards = Array.isArray(shot.cards) && shot.cards.length
        ? shot.cards
        : [
            { title: 'Arunaki', tag: 'AI Motion Studio', style: 'brand-hero' },
            { title: '2.5D Camera', tag: 'Zoom • Tilt', style: 'dark-studio' },
            { title: 'Audio Sync', tag: 'BPM • SFX', style: 'waveform-ui' },
            { title: 'Aurora Glass', tag: 'FX Style', style: 'cobalt-hero' },
            { title: 'Editorial', tag: 'Typography', style: 'editorial-light' },
            { title: 'Story Core', tag: 'Dialect A', style: 'code-matrix' },
            { title: '3D Crystal', tag: 'UI Kit', style: 'cobalt-hero' },
            { title: 'Export MP4', tag: 'Zero Cloud', style: 'sunset-stat' },
          ];

      var nCards = cards.length;
      var targetIdx = shot.targetIndex !== undefined ? Number(shot.targetIndex) : 0;
      var enterC = easeOutCubic(clamp(localTime / 0.35, 0, 1));

      // Variable pace: fast multi-card spin (1.35 turns) during first 58% of shot,
      // then sudden exponential brake locking onto targetIdx for the last 42%!
      var spinDur = Math.max(0.6, dur * 0.62);
      var spinU = clamp(localTime / spinDur, 0, 1);
      var spinUprev = clamp((localTime - 0.033) / spinDur, 0, 1);
      // Steep exponential brake curve (1 - (1-u)^4.5)
      var spinEase = 1 - Math.pow(1 - spinU, 4.6);
      var spinEasePrev = 1 - Math.pow(1 - spinUprev, 4.6);
      var spinVel = Math.abs(spinEase - spinEasePrev) / 0.033;

      var totalSweepRad = (shot.spinTurns !== undefined ? Number(shot.spinTurns) : 1.25) * Math.PI * 2;
      var targetAngle = -(targetIdx / nCards) * Math.PI * 2;
      var currentRot = targetAngle - (1 - spinEase) * totalSweepRad;

      var ringRx = isPortrait ? safe.w * 0.44 : Math.min(520, W * 0.40);
      var ringRy = isPortrait ? 68 : 74;
      var ringCenterY = cy + (isPortrait ? 150 : 128);
      var baseW = isPortrait ? 245 : 210;
      var baseH = isPortrait ? 335 : 275;

      // 1. Glowing floor reflection pool + neon elliptical ring (matching Image 1!)
      ctx.save();
      ctx.globalAlpha = exitFade * enterC;
      var floorG = ctx.createRadialGradient(cx, ringCenterY + 12, 10, cx, ringCenterY + 12, ringRx * 1.18);
      floorG.addColorStop(0.0, 'rgba(37, 99, 235, 0.42)');
      floorG.addColorStop(0.55, 'rgba(29, 78, 216, 0.16)');
      floorG.addColorStop(1.0, 'rgba(2, 6, 24, 0.0)');
      ctx.fillStyle = floorG;
      ctx.beginPath();
      ctx.ellipse(cx, ringCenterY + 12, ringRx * 1.18, ringRy * 1.55, 0, 0, Math.PI * 2);
      ctx.fill();

      // Outer & inner luminous neon floor rings
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)';
      ctx.lineWidth = 2.4;
      ctx.shadowColor = '#3B82F6';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.ellipse(cx, ringCenterY + 10, ringRx * 1.04, ringRy * 1.08, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(147, 197, 253, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, ringCenterY + 10, ringRx * 0.88, ringRy * 0.86, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 2. Compute 3D cylindrical coordinates for each card (z = cos(theta), x = sin(theta))
      var items3d = [];
      for (var ci = 0; ci < nCards; ci++) {
        var theta = (ci / nCards) * Math.PI * 2 + currentRot;
        var sinT = Math.sin(theta);
        var cosT = Math.cos(theta); // +1 = front center, -1 = back center
        items3d.push({
          card: cards[ci],
          idx: ci,
          theta: theta,
          sinT: sinT,
          cosT: cosT,
        });
      }
      // Painter's algorithm: draw back-to-front (ascending cosT)
      items3d.sort(function (a, b) { return a.cosT - b.cosT; });

      var spinBlur = clamp(spinVel * 1.8, 0, 5.5);

      for (var oi = 0; oi < items3d.length; oi++) {
        var it = items3d[oi];
        var depth01 = (it.cosT + 1) * 0.5; // 0 at back, 1 at front
        var persp = 0.52 + 0.54 * Math.pow(depth01, 1.15);
        // Horizontal foreshortening on side cards so they angle along the cylinder!
        var foreshortenX = 0.62 + 0.38 * Math.abs(it.cosT);
        var cw = baseW * persp;
        var ch = baseH * persp;
        var cardX = cx + it.sinT * ringRx;
        var cardY = cy - 16 + it.cosT * (ringRy * 0.52) - (1 - depth01) * 38;
        var cardAlpha = clamp(0.22 + 0.78 * Math.pow(depth01, 1.3), 0.18, 1.0) * enterC;
        var isFrontHero = it.cosT > 0.92 && spinU > 0.72;

        // Subtle pulse on hero card when locked
        var lockBounce = isFrontHero ? 1.0 + 0.045 * Math.sin(clamp((spinU - 0.72) / 0.28, 0, 1) * Math.PI) : 1.0;

        ctx.save();
        ctx.globalAlpha = exitFade * cardAlpha;
        if (spinBlur > 0.35 && !isFrontHero) {
          ctx.filter = 'blur(' + (spinBlur * (1.1 - depth01 * 0.5)).toFixed(1) + 'px)';
        }

        // Draw faint floor mirror reflection for front-half cards
        if (it.cosT > 0.05) {
          ctx.save();
          ctx.globalAlpha = exitFade * cardAlpha * 0.18 * it.cosT;
          ctx.translate(cardX, cardY + ch * 0.5 + 14);
          ctx.scale(foreshortenX * lockBounce, -0.28);
          drawShowcaseCard(ctx, -cw * 0.5, -ch * 0.5, cw, ch, it.card, globalT, true, theme);
          ctx.restore();
        }

        ctx.translate(cardX, cardY);
        ctx.scale(foreshortenX * lockBounce, lockBounce);
        var cardCopy = Object.assign({}, it.card, { __isHeroCenter: isFrontHero });
        drawShowcaseCard(ctx, -cw * 0.5, -ch * 0.5, cw, ch, cardCopy, globalT, micro, theme);
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
      // Opal 2-phase perspective chart (matching user's Images 1 & 2):
      // Phase 1 (0 -> 0.48*dur): Card starts laid nearly flat in 3D perspective (foreshortened) -> stands up smoothly!
      // Phase 2 (0.48 -> 1.0*dur): Camera zooms deep (1.0x -> 2.15x) onto the center glowing bar as cyan->amber fill rises!
      var bars = Array.isArray(shot.bars) && shot.bars.length ? shot.bars : [0.35, 0.52, 0.44, 0.62, 0.92, 0.58, 0.48];
      var labels = Array.isArray(shot.labels) && shot.labels.length ? shot.labels : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      var hlIdx = shot.highlightIdx !== undefined ? Number(shot.highlightIdx) : 4;
      var cardW = isPortrait ? safe.w * 0.88 : Math.min(840, safe.w * 0.78);
      var cardH = isPortrait ? 470 : 390;

      var standEnd = dur * 0.46;
      var standP = easeInOutExpo(clamp(localTime / Math.max(0.3, standEnd), 0, 1));
      var zoomP = easeInOutExpo(clamp((localTime - standEnd * 0.92) / Math.max(0.35, dur * 0.44), 0, 1));
      var zoomPrev = easeInOutExpo(clamp((localTime - 0.033 - standEnd * 0.92) / Math.max(0.35, dur * 0.44), 0, 1));
      var zoomVelBlur = clamp(Math.abs(zoomP - zoomPrev) * 32, 0, 6.5);

      var barGap = (cardW * 0.78) / bars.length;
      var barW = barGap * 0.48;
      var hlBx = -cardW * 0.39 + hlIdx * barGap + barGap * 0.5;
      var baseY = cardH * 0.30;
      var maxBarH = cardH * 0.54;
      var avgY = baseY - maxBarH * 0.62;

      var localZoom = 0.88 + 0.14 * standP + 1.18 * zoomP; // 0.88 -> 1.02 -> 2.20x deep into focal bar!
      var perspScaleY = 0.44 + 0.56 * standP; // starts laid almost flat (0.44) -> stands upright (1.0)!
      var skewX = (1 - standP) * -0.14;
      var focusX = cx + hlBx * zoomP;
      var focusY = cy + (baseY - maxBarH * 0.45) * zoomP;

      ctx.save();
      if (zoomVelBlur > 0.25) ctx.filter = 'blur(' + zoomVelBlur.toFixed(1) + 'px)';
      ctx.translate(cx, cy + (1 - standP) * 54);
      ctx.scale(localZoom, localZoom * perspScaleY);
      ctx.transform(1, 0, skewX, 1, 0, 0);
      ctx.translate(-focusX + cx, -focusY + cy);

      roundRect(ctx, -cardW * 0.5, -cardH * 0.5, cardW, cardH, 22);
      ctx.fillStyle = 'rgba(16, 18, 24, 0.90)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Subtle vertical grid lines + avg dashed line
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (var gi = 0; gi <= bars.length; gi++) {
        var gx = -cardW * 0.39 + gi * barGap;
        ctx.beginPath();
        ctx.moveTo(gx, -cardH * 0.24);
        ctx.lineTo(gx, baseY);
        ctx.stroke();
      }
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
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

      for (var bi = 0; bi < bars.length; bi++) {
        var bp = easeOutCubic(clamp((localTime - 0.08 - bi * 0.05) / 0.45, 0, 1));
        var fullH = maxBarH * clamp(Number(bars[bi]) || 0.4, 0.1, 1.0) * bp;
        var bx = -cardW * 0.39 + bi * barGap + (barGap - barW) * 0.5;
        var by = baseY - fullH;

        // Draw muted track bar first
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        roundRect(ctx, bx, by, barW, Math.max(4, fullH), 6);
        ctx.fill();

        // Focal bar glows & fills up dynamically during Phase 2 zoom!
        if (bi === hlIdx) {
          var glowFillP = easeOutExpo(clamp((localTime - standEnd * 0.78) / Math.max(0.35, dur * 0.42), 0, 1));
          var glowH = Math.max(4, fullH * glowFillP);
          var glowY = baseY - glowH;
          ctx.save();
          var bg = ctx.createLinearGradient(bx, baseY, bx, glowY);
          bg.addColorStop(0.0, '#00F0FF');
          bg.addColorStop(0.62, '#38BDF8');
          bg.addColorStop(1.0, glowFillP > 0.65 ? '#F59E0B' : '#2EDFDA');
          ctx.fillStyle = bg;
          ctx.shadowColor = glowFillP > 0.65 ? '#F59E0B' : '#00F0FF';
          ctx.shadowBlur = 28;
          roundRect(ctx, bx, glowY, barW, glowH, 6);
          ctx.fill();
          ctx.restore();
        }
        if (!micro && labels[bi]) {
          ctx.fillStyle = bi === hlIdx ? theme.ink : theme.muted;
          ctx.font = '600 18px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(labels[bi]), bx + barW * 0.5, baseY + 28);
        }
      }
      ctx.restore();
    } else if (layout === 'metric-pills-tree') {
      // Opal sequential 1-by-1 organic pill reveal + passive camera zoom-out (matching user's Images 3, 4 & 5):
      // Beat 1: Pill 1 starts as glowing circle orb (macro zoomed 1.85x) -> expands into pill as border ring sweeps & number counts up!
      // Beat 2: Camera smoothly pulls back as Pill 2 & Pill 3 each bloom 1-by-1 from glowing circles into pills!
      // Beat 3: Camera pulls back to 1.0x as rounded connector bracket draws up & hero Score counts up!
      var pills = Array.isArray(shot.pills) && shot.pills.length
        ? shot.pills
        : [
            { label: 'Sleep', value: 67 },
            { label: 'Focus', value: 43 },
            { label: 'Rest', value: 33 },
          ];

      var pillW = isPortrait ? 208 : 186;
      var pillH = 76;
      var pillGap = isPortrait ? 24 : 38;
      var rowW = pills.length * pillW + (pills.length - 1) * pillGap;

      var tPill1 = 0.0;
      var tPill2 = dur * 0.24;
      var tPill3 = dur * 0.44;
      var tTree = dur * 0.64;

      var pSpread = easeInOutExpo(clamp((localTime - tPill2 * 0.85) / (dur * 0.34), 0, 1));
      var treeP = easeOutExpo(clamp((localTime - tTree) / Math.max(0.3, dur * 0.28), 0, 1));

      // Passive continuous camera zoom-out from 1.78x (macro on Pill 1) -> 1.0x (full tree) + subtle breathing
      var camZoom = 1.78 - 0.52 * pSpread - 0.26 * treeP + Math.sin(localTime * 1.4) * 0.012;
      var rowY = cy + treeP * 86;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-cx, -cy);

      // Luminous rounded connector bracket + hero score above (Beat 3)
      if (treeP > 0.01) {
        ctx.save();
        ctx.globalAlpha = exitFade * treeP;
        var leftX = cx - rowW * 0.5 + pillW * 0.5;
        var rightX = cx + rowW * 0.5 - pillW * 0.5;
        var midY = rowY - 72;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.62)';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = theme.accent || '#8D81B1';
        ctx.shadowBlur = 16;
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
          var scoreVal = Math.round((Number(shot.scoreValue) || 99) * treeP);
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

      // Sequential 1-by-1 pill bloom: circle orb -> expanding pill with sweeping glowing border!
      var startTimes = [tPill1, tPill2, tPill3];
      for (var pi = 0; pi < pills.length; pi++) {
        var st = startTimes[pi] !== undefined ? startTimes[pi] : pi * (dur * 0.22);
        var dt = localTime - st;
        if (dt < 0) continue;

        var appearP = easeOutCubic(clamp(dt / 0.22, 0, 1));
        var expandP = easeInOutExpo(clamp((dt - 0.08) / 0.42, 0, 1));
        var countLocalP = easeOutQuart(clamp((dt - 0.05) / 0.55, 0, 1));

        var curW = pillH + (pillW - pillH) * expandP; // starts as circle (pillH x pillH) -> expands to full pill!
        var finalCx = cx - rowW * 0.5 + pi * (pillW + pillGap) + pillW * 0.5;
        var pillCx = pi === 0 ? cx + (finalCx - cx) * pSpread : finalCx;

        ctx.save();
        ctx.globalAlpha = exitFade * appearP;
        ctx.translate(pillCx, rowY);

        // Opening luminous orb flash on the left edge when pill first spawns
        if (dt < 0.38) {
          var orbA = (1 - dt / 0.38) * 0.85;
          var og = ctx.createRadialGradient(-curW * 0.22, 0, 2, -curW * 0.22, 0, 38);
          og.addColorStop(0, 'rgba(255,255,255,' + orbA.toFixed(2) + ')');
          og.addColorStop(1, 'rgba(141,129,177,0)');
          ctx.fillStyle = og;
          ctx.beginPath();
          ctx.arc(-curW * 0.22, 0, 38, 0, Math.PI * 2);
          ctx.fill();
        }

        // Pill body + muted base rim
        roundRect(ctx, -curW * 0.5, -pillH * 0.5, curW, pillH, 999);
        ctx.fillStyle = 'rgba(13, 14, 24, 0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.26)';
        ctx.lineWidth = 2.0;
        ctx.stroke();

        // Sweeping glowing progress border around the pill!
        var perim = 2 * (curW - pillH) + Math.PI * pillH;
        ctx.save();
        roundRect(ctx, -curW * 0.5, -pillH * 0.5, curW, pillH, 999);
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.95)';
        ctx.lineWidth = 3.2;
        ctx.shadowColor = '#C4B5FD';
        ctx.shadowBlur = 18;
        ctx.setLineDash([perim * countLocalP, perim]);
        ctx.stroke();
        ctx.restore();

        if (!micro) {
          var pv = Math.round((Number(pills[pi].value) || 50) * countLocalP);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 32px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(pv), 0, 0);

          var lblP = easeOutCubic(clamp((dt - 0.24) / 0.28, 0, 1));
          ctx.globalAlpha = exitFade * appearP * lblP;
          ctx.fillStyle = theme.muted;
          ctx.font = '500 20px "Inter", "Segoe UI", sans-serif';
          ctx.fillText(String(pills[pi].label || ''), 0, pillH * 0.5 + 28);
        }
        ctx.restore();
      }
      ctx.restore();
    } else if (layout === 'neon-score-ring') {
      // Vercel-inspired emerald glow orb -> explosive radial ring sweep + pull-back reveal
      var sFrom = shot.scoreFrom !== undefined ? Number(shot.scoreFrom) : 10;
      var sTo = shot.scoreTo !== undefined ? Number(shot.scoreTo) : 98;
      var ringColor = theme.accent || '#6FEDA4';
      var orbPhase = clamp(localTime / 0.24, 0, 1);

      if (orbPhase < 0.99) {
        // Opening pure glowing emerald orb expanding from center (like 3.00s in reference!)
        var orbR = 14 + easeOutExpo(orbPhase) * 44;
        ctx.save();
        var og = ctx.createRadialGradient(cx, cy - 18, 2, cx, cy - 18, orbR * 2.2);
        og.addColorStop(0, '#FFFFFF');
        og.addColorStop(0.32, ringColor);
        og.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = og;
        ctx.globalAlpha = exitFade * (1 - orbPhase * 0.75);
        ctx.beginPath();
        ctx.arc(cx, cy - 18, orbR * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      var prog = easeOutExpo(clamp((localTime - 0.08) / Math.max(0.45, dur * 0.58), 0, 1));
      var curScore = Math.round(sFrom + (sTo - sFrom) * prog);
      var ringR = isPortrait ? 130 : 108;

      ctx.save();
      ctx.globalAlpha = exitFade * easeOutCubic(clamp((localTime - 0.06) / 0.18, 0, 1));
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(cx, cy - 18, ringR, 0, Math.PI * 2);
      ctx.stroke();

      var endAng = -Math.PI * 0.5 + (curScore / 100) * Math.PI * 2;
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = 32;
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

        var labelP = easeOutExpo(clamp((localTime - 0.35) / 0.38, 0, 1));
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
      // Vercel v0 2-phase macro camera: 3.4x locked on bottom-right arrow -> whip pull-back -> rapid type -> whip zoom-in!
      var boxW = isPortrait ? safe.w * 0.90 : Math.min(760, safe.w * 0.72);
      var boxH = 148;
      var promptStr = String(shot.promptText || 'Build a 30fps local motion launch film with SFX');
      var chips = Array.isArray(shot.chips) && shot.chips.length ? shot.chips : ['18 Skills', '2.5D Camera', 'Zero Cloud', 'SFX Sync'];

      var btnSz = 44;
      var bx = cx + boxW * 0.5 - btnSz - 18;
      var by = cy + boxH * 0.5 - btnSz - 16;

      // Internal 2-phase Vercel macro camera when shot.cameraPreset is 'static' or 'macro-pullback'
      var phase1Pull = easeInOutExpo(clamp((localTime - 0.32) / 0.52, 0, 1));
      var phase2Zoom = easeInOutExpo(clamp((localTime - (dur * 0.62)) / 0.45, 0, 1));
      var localZoom = 3.4 + (1.0 - 3.4) * phase1Pull + (1.82 - 1.0) * phase2Zoom;
      var localFocusX = (bx + btnSz * 0.5) + (cx - (bx + btnSz * 0.5)) * phase1Pull + ((cx - boxW * 0.24) - cx) * phase2Zoom;
      var localFocusY = (by + btnSz * 0.5) + (cy - (by + btnSz * 0.5)) * phase1Pull + ((cy - 12) - cy) * phase2Zoom;

      // Velocity blur during phase1Pull or phase2Zoom whips
      var p1Prev = easeInOutExpo(clamp((localTime - 0.033 - 0.32) / 0.52, 0, 1));
      var p2Prev = easeInOutExpo(clamp((localTime - 0.033 - (dur * 0.62)) / 0.45, 0, 1));
      var whipBlur = clamp((Math.abs(phase1Pull - p1Prev) + Math.abs(phase2Zoom - p2Prev)) * 38, 0, 7.5);

      ctx.save();
      if (shot.cameraPreset === 'static' || !shot.cameraPreset) {
        if (whipBlur > 0.25) ctx.filter = 'blur(' + whipBlur.toFixed(1) + 'px)';
        ctx.translate(cx, cy);
        ctx.scale(localZoom, localZoom);
        ctx.translate(-localFocusX, -localFocusY);
      }

      var typeP = clamp((localTime - 0.72) / Math.max(0.45, dur * 0.44), 0, 1);
      var visibleText = promptStr.slice(0, Math.round(promptStr.length * typeP));

      if (!micro) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 ' + (isPortrait ? 40 : 36) + 'px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(shot.headline || 'What do you want to create?'), cx, cy - boxH * 0.5 - 42);
      }

      roundRect(ctx, cx - boxW * 0.5, cy - boxH * 0.5, boxW, boxH, 18);
      ctx.fillStyle = 'rgba(12, 14, 22, 0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (!micro) {
        ctx.fillStyle = '#F8FAFC';
        ctx.font = '400 24px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(visibleText + (Math.floor(localTime * 4) % 2 === 0 ? '|' : ''), cx - boxW * 0.5 + 26, cy - boxH * 0.5 + 26, boxW - 110);

        ctx.fillStyle = theme.muted;
        ctx.font = '500 17px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(String(shot.modelTag || 'Arunaki Nexus Engine'), cx - boxW * 0.5 + 26, cy + boxH * 0.5 - 38);
      }

      // Glowing white submit arrow button
      ctx.save();
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 22;
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
      ctx.restore();
    } else if (layout === 'whip-cta-morph') {
      // Opal-inspired 2-phase logo + dropping spark -> motion-blurred morph into wide glossy dark-violet "▶ Start" pill!
      var impactT = dur * 0.42;
      if (localTime < impactT) {
        // Phase 1: Glossy dark rounded square brand icon + bright white light spark dropping from above!
        var iconScale = easeOutBack(clamp(localTime / 0.28, 0, 1)) * (1.0 + 0.08 * (localTime / impactT));
        var iconSz = isPortrait ? 154 : 128;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(iconScale, iconScale);
        roundRect(ctx, -iconSz * 0.5, -iconSz * 0.5, iconSz, iconSz, 30);
        ctx.fillStyle = '#09090D';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        drawBrandMark(ctx, 0, 0, iconSz * 0.52, 1.0, '#FFFFFF');
        ctx.restore();

        // Falling luminous spark streak above icon
        var dropU = clamp((localTime - 0.08) / Math.max(0.18, impactT - 0.08), 0, 1);
        var sparkY = cy - 220 * (1 - dropU * dropU);
        ctx.save();
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, cx - 5, sparkY - 12 - dropU * 18, 10, 24 + dropU * 26, 5);
        ctx.fill();
        ctx.restore();
      } else {
        // Phase 2: Fast motion-blurred horizontal expansion into wide glossy dark-violet glass pill ("▶ Start")
        var dt2 = localTime - impactT;
        var pMorph = easeOutExpo(clamp(dt2 / 0.36, 0, 1));
        var pPrev = easeOutExpo(clamp((dt2 - 0.033) / 0.36, 0, 1));
        var mBlur = clamp(Math.abs(pMorph - pPrev) * 44, 0, 8.5);
        var driftScale = 1.0 + 0.06 * clamp(dt2 / Math.max(0.4, dur - impactT), 0, 1);

        var pillW = 128 + ((isPortrait ? 620 : 540) - 128) * pMorph;
        var pillH = 128 + (92 - 128) * pMorph;

        ctx.save();
        if (mBlur > 0.25) ctx.filter = 'blur(' + mBlur.toFixed(1) + 'px)';
        ctx.translate(cx, cy);
        ctx.scale(driftScale, driftScale);

        var pg = ctx.createLinearGradient(0, -pillH * 0.5, 0, pillH * 0.5);
        pg.addColorStop(0.0, 'rgba(22, 20, 32, 0.94)');
        pg.addColorStop(0.75, 'rgba(54, 48, 78, 0.92)');
        pg.addColorStop(1.0, 'rgba(138, 126, 178, 0.88)');
        roundRect(ctx, -pillW * 0.5, -pillH * 0.5, pillW, pillH, 999);
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.34)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        if (!micro && pMorph > 0.30) {
          ctx.globalAlpha = exitFade * easeOutCubic((pMorph - 0.30) / 0.70);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '600 32px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('▶  ' + String(shot.ctaLabel || 'Start'), 0, 1);
        }
        ctx.restore();
      }
    } else if (layout === 'prompt-type-send') {
      // Dynamic variable-pace prompt choreography:
      // 1. Macro zoom (2.35x) on text input line, panning left as words are typed 1-by-1
      // 2. Whip-pan to bottom-right Send arrow button
      // 3. Button click press + shockwave ring -> full-screen bloom flash transition!
      var boxW = isPortrait ? safe.w * 0.90 : Math.min(780, safe.w * 0.74);
      var boxH = 152;
      var words = String(shot.promptText || 'Buat video launch 60fps lokal lengkap dengan SFX & kamera 2.5D')
        .trim()
        .split(/\s+/);
      var chips = Array.isArray(shot.chips) && shot.chips.length ? shot.chips : ['18 Skill', 'Kamera 2.5D', '0 Biaya Cloud', 'SFX Sinkron'];

      var btnSz = 46;
      var bx = cx + boxW * 0.5 - btnSz - 18;
      var by = cy + boxH * 0.5 - btnSz - 16;
      var btnCx = bx + btnSz * 0.5;
      var btnCy = by + btnSz * 0.5;

      var typeEndT = dur * 0.56;
      var whipBtnEndT = dur * 0.72;
      var clickT = dur * 0.74;
      var flashStartT = dur * 0.82;

      // Word-by-word reveal progress
      var typeU = clamp(localTime / Math.max(0.4, typeEndT), 0, 1);
      var wordFloat = typeU * words.length;
      var fullCount = Math.min(words.length, Math.floor(wordFloat));
      var partialWordAlpha = wordFloat - fullCount;

      ctx.font = '400 25px "Inter", "Segoe UI", sans-serif';
      var textStartX = cx - boxW * 0.5 + 28;
      var textBaseY = cy - boxH * 0.5 + 34;
      var currentTypedStr = words.slice(0, Math.min(words.length, fullCount + 1)).join(' ');
      var cursorOffsetPx = Math.min(boxW - 140, ctx.measureText(currentTypedStr).width);

      // Camera target during typing: follows the active word across the line (pans camera right -> text shifts left!)
      var SmoothCursorX = textStartX + Math.min(boxW - 160, (typeU * (boxW - 180)));
      var SmoothCursorY = textBaseY + 12;

      var whipToBtn = easeInOutExpo(clamp((localTime - typeEndT) / Math.max(0.18, whipBtnEndT - typeEndT), 0, 1));
      var whipToBtnPrev = easeInOutExpo(clamp((localTime - 0.033 - typeEndT) / Math.max(0.18, whipBtnEndT - typeEndT), 0, 1));
      var punchThru = easeInOutExpo(clamp((localTime - flashStartT) / Math.max(0.15, dur - flashStartT), 0, 1));

      var camZoom = 2.35 + (2.55 - 2.35) * whipToBtn + (6.8 - 2.55) * punchThru;
      var focusX = SmoothCursorX + (btnCx - SmoothCursorX) * whipToBtn;
      var focusY = SmoothCursorY + (btnCy - SmoothCursorY) * whipToBtn;
      var whipBlur = clamp(Math.abs(whipToBtn - whipToBtnPrev) * 42 + punchThru * 8.0, 0, 9.0);

      ctx.save();
      if (whipBlur > 0.25) {
        ctx.filter = 'blur(' + whipBlur.toFixed(1) + 'px)';
      }
      ctx.translate(cx, cy);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-focusX, -focusY);

      if (!micro) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 ' + (isPortrait ? 40 : 36) + 'px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(shot.headline || 'Apa yang ingin kamu ciptakan hari ini?'), cx, cy - boxH * 0.5 - 42);
      }

      // Prompt box
      roundRect(ctx, cx - boxW * 0.5, cy - boxH * 0.5, boxW, boxH, 18);
      ctx.fillStyle = 'rgba(12, 14, 22, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Word-by-word rendering with subtle pop on the newest word
      if (!micro) {
        ctx.font = '400 24px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        var wx = textStartX;
        var spW = ctx.measureText(' ').width;
        for (var wi = 0; wi < words.length; wi++) {
          if (wi > fullCount) break;
          var isNewest = wi === fullCount && localTime < typeEndT;
          var wAlpha = isNewest ? easeOutCubic(partialWordAlpha) : 1.0;
          var wDy = isNewest ? (1 - easeOutCubic(partialWordAlpha)) * 7 : 0;
          ctx.save();
          ctx.globalAlpha = wAlpha;
          ctx.fillStyle = isNewest ? (theme.accent || '#6FEDA4') : '#F8FAFC';
          ctx.fillText(words[wi], wx, textBaseY + wDy);
          ctx.restore();
          wx += ctx.measureText(words[wi]).width + spW;
        }
        // Caret
        if (localTime < whipBtnEndT) {
          ctx.fillStyle = theme.accent || '#6FEDA4';
          ctx.fillRect(wx + 2, textBaseY + 2, 2.5, 24);
        }

        ctx.fillStyle = theme.muted;
        ctx.font = '500 17px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(String(shot.modelTag || 'Arunaki Nexus Engine'), textStartX, cy + boxH * 0.5 - 38);
      }

      // Button click press & shockwave ripple
      var clickElapsed = localTime - clickT;
      var btnScale = 1.0;
      if (clickElapsed > 0) {
        if (clickElapsed < 0.09) {
          btnScale = 1.0 - 0.24 * (clickElapsed / 0.09);
        } else {
          btnScale = 0.76 + 0.24 * easeOutBack(clamp((clickElapsed - 0.09) / 0.18, 0, 1));
        }
      }

      if (clickElapsed > 0.04) {
        var ripP = clamp((clickElapsed - 0.04) / 0.42, 0, 1);
        ctx.save();
        ctx.strokeStyle = theme.accent || '#6FEDA4';
        ctx.globalAlpha = (1 - ripP) * 0.9;
        ctx.lineWidth = 3.0 * (1 - ripP * 0.6);
        ctx.beginPath();
        ctx.arc(btnCx, btnCy, btnSz * (0.55 + ripP * 1.65), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(btnCx, btnCy);
      ctx.scale(btnScale, btnScale);
      ctx.shadowColor = clickElapsed > 0.04 ? (theme.accent || '#6FEDA4') : '#FFFFFF';
      ctx.shadowBlur = clickElapsed > 0.04 ? 36 : 20;
      roundRect(ctx, -btnSz * 0.5, -btnSz * 0.5, btnSz, btnSz, 11);
      ctx.fillStyle = clickElapsed > 0.04 ? (theme.accent || '#6FEDA4') : '#FFFFFF';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#09090B';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, btnSz * 0.2);
      ctx.lineTo(0, -btnSz * 0.2);
      ctx.moveTo(-btnSz * 0.18, -btnSz * 0.04);
      ctx.lineTo(0, -btnSz * 0.22);
      ctx.lineTo(btnSz * 0.18, -btnSz * 0.04);
      ctx.stroke();
      ctx.restore();

      // Feature chips
      var chipW = (boxW - 36) / chips.length;
      for (var chi = 0; chi < chips.length; chi++) {
        var chx = cx - boxW * 0.5 + chi * (chipW + 12);
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
          ctx.fillText(String(chips[chi]), chx + chipW * 0.5, chy + 19, chipW - 14);
        }
      }
      ctx.restore();

      // Click-triggered radial bloom transition overlay at end of shot
      if (punchThru > 0.01) {
        ctx.save();
        ctx.globalAlpha = Math.pow(punchThru, 1.5);
        var fg = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.75);
        fg.addColorStop(0.0, '#FFFFFF');
        fg.addColorStop(0.45, theme.accent || '#6FEDA4');
        fg.addColorStop(1.0, 'rgba(2, 6, 23, 0.95)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
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
