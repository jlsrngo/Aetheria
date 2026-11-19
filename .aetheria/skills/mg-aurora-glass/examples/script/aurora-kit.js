(function () {
  'use strict';

  var THEMES = {
    'indigo-aurora': {
      base: '#040312',
      plumes: ['#7050FF', '#2F46F2', '#34CFF0', '#B653F0', '#8C8CFF'],
      tintA: 'rgba(112, 80, 255, 0.24)',
      tintB: 'rgba(52, 207, 240, 0.16)',
      accent: '#34CFF0',
      glow: '#7050FF',
      ink: '#F8FAFC',
      muted: 'rgba(226, 232, 240, 0.78)'
    },
    'emerald-northern': {
      base: '#030E12',
      plumes: ['#10B981', '#06B6D4', '#38BDF8', '#34D399', '#6366F1'],
      tintA: 'rgba(16, 185, 129, 0.22)',
      tintB: 'rgba(56, 189, 248, 0.16)',
      accent: '#2DD4BF',
      glow: '#10B981',
      ink: '#F0FDF4',
      muted: 'rgba(209, 250, 229, 0.78)'
    },
    'rose-nebula': {
      base: '#110312',
      plumes: ['#EC4899', '#A855F7', '#F43F5E', '#6366F1', '#F472B6'],
      tintA: 'rgba(236, 72, 153, 0.22)',
      tintB: 'rgba(168, 85, 247, 0.18)',
      accent: '#F472B6',
      glow: '#A855F7',
      ink: '#FFF1F2',
      muted: 'rgba(252, 231, 243, 0.78)'
    },
    'obsidian-cyan': {
      base: '#030710',
      plumes: ['#0EA5E9', '#2563EB', '#22D3EE', '#6366F1', '#38BDF8'],
      tintA: 'rgba(14, 165, 233, 0.22)',
      tintB: 'rgba(34, 211, 238, 0.16)',
      accent: '#38BDF8',
      glow: '#2563EB',
      ink: '#F8FAFC',
      muted: 'rgba(186, 230, 253, 0.78)'
    },
    'twilight-violet': {
      base: '#080418',
      plumes: ['#8B5CF6', '#D946EF', '#3B82F6', '#38BDF8', '#C084FC'],
      tintA: 'rgba(139, 92, 246, 0.24)',
      tintB: 'rgba(217, 70, 239, 0.16)',
      accent: '#C084FC',
      glow: '#8B5CF6',
      ink: '#F5F3FF',
      muted: 'rgba(233, 213, 255, 0.78)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['indigo-aurora'];
  }

  function hash(n) {
    var s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
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

  // Deep luminous 7-plume aurora mesh + subtle floating dust motes (matching 12-aurora-glass)
  function drawAuroraMesh(ctx, w, h, theme, t) {
    ctx.fillStyle = theme.base;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var plumes = [
      { cx: 0.28, cy: 0.26, rx: 0.56, ry: 0.34, ang: 0.32, sp: 0.32, ph: 0.2, alpha: 0.68 },
      { cx: 0.76, cy: 0.22, rx: 0.48, ry: 0.30, ang: -0.45, sp: 0.28, ph: 1.8, alpha: 0.58 },
      { cx: 0.72, cy: 0.64, rx: 0.52, ry: 0.36, ang: 0.52, sp: 0.36, ph: 3.1, alpha: 0.64 },
      { cx: 0.34, cy: 0.74, rx: 0.58, ry: 0.32, ang: -0.18, sp: 0.26, ph: 4.5, alpha: 0.60 },
      { cx: 0.52, cy: 0.46, rx: 0.42, ry: 0.34, ang: 0.14, sp: 0.40, ph: 2.2, alpha: 0.48 }
    ];
    for (var i = 0; i < plumes.length; i++) {
      var p = plumes[i];
      var ox = (p.cx + Math.sin(t * p.sp + p.ph) * 0.12) * w;
      var oy = (p.cy + Math.cos(t * p.sp * 0.85 + p.ph) * 0.08) * h;
      var rad = Math.max(w, h) * p.rx;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(p.ang + Math.sin(t * 0.2 + i) * 0.08);
      ctx.scale(1, p.ry / p.rx);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      var col = theme.plumes[i % theme.plumes.length];
      g.addColorStop(0, col);
      g.addColorStop(0.45, col + '66');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Subtle floating luminous dust motes
    ctx.save();
    for (var d = 0; d < 28; d++) {
      var dx = hash(d * 3 + 1) * w;
      var dy = ((hash(d * 5 + 2) * h - t * (10 + hash(d) * 14)) % h + h) % h;
      var dr = 1.2 + hash(d * 7) * 2.2;
      ctx.globalAlpha = 0.25 + 0.35 * Math.sin(t * 2 + d * 4);
      ctx.fillStyle = '#E0F2FE';
      ctx.beginPath();
      ctx.arc(dx, dy, dr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Authentic Frosted Liquid-Glass Panel with Fresnel bevel, internal aurora glow bleed & specular catch-light
  function drawLiquidGlassPanel(ctx, x, y, w, h, theme, t, opts) {
    opts = opts || {};
    var r = opts.radius || 34;
    var tilt = opts.tilt || 0;

    ctx.save();
    ctx.translate(x + w * 0.5, y + h * 0.5);
    if (tilt) ctx.rotate(tilt);
    var lx = -w * 0.5, ly = -h * 0.5;

    // Deep ambient shadow
    ctx.shadowColor = 'rgba(2, 2, 16, 0.58)';
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 24;
    roundRect(ctx, lx, ly, w, h, r);
    ctx.fillStyle = 'rgba(18, 16, 46, 0.42)';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Clip interior frosted refraction + aurora tint bleed
    ctx.save();
    roundRect(ctx, lx, ly, w, h, r);
    ctx.clip();

    // Internal luminous aurora bleed through frosted glass
    var bleed = ctx.createLinearGradient(lx, ly, lx + w, ly + h);
    bleed.addColorStop(0, theme.tintA);
    bleed.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
    bleed.addColorStop(1, theme.tintB);
    ctx.fillStyle = bleed;
    ctx.fillRect(lx, ly, w, h);

    // Subtle top-left luminous glow spot inside glass
    var spot = ctx.createRadialGradient(lx + w * 0.22, ly + h * 0.14, 10, lx + w * 0.22, ly + h * 0.14, Math.max(w, h) * 0.72);
    spot.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    spot.addColorStop(0.5, theme.glow + '22');
    spot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(lx, ly, w, h);

    // Gliding specular catch-light sweep
    var sweepX = lx + ((Math.sin(t * 0.65 + (opts.phase || 0)) * 0.5 + 0.5) * 1.4 - 0.2) * w;
    var sheen = ctx.createLinearGradient(sweepX - 180, ly, sweepX + 180, ly + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(lx, ly, w, h);
    ctx.restore();

    // Iridescent Fresnel specular border (bright top-left catch-light -> cyan/violet rim)
    var rim = ctx.createLinearGradient(lx, ly, lx + w, ly + h);
    rim.addColorStop(0, 'rgba(255, 255, 255, 0.68)');
    rim.addColorStop(0.35, theme.accent + '88');
    rim.addColorStop(0.70, 'rgba(255, 255, 255, 0.16)');
    rim.addColorStop(1, theme.glow + '99');
    roundRect(ctx, lx, ly, w, h, r);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Crisp top specular hairline
    ctx.beginPath();
    ctx.moveTo(lx + r, ly + 1.5);
    ctx.lineTo(lx + w - r, ly + 1.5);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();
  }

  // Luminous AI Orb icon (like "Aurora" header orb in 12-aurora-glass)
  function drawAuroraOrb(ctx, cx, cy, r, theme, t) {
    ctx.save();
    var p = 1 + Math.sin(t * 2.4) * 0.08;
    var g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 2, cx, cy, r * 1.8 * p);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.32, theme.accent);
    g.addColorStop(0.68, theme.glow + '66');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8 * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Voice Listening Glass Card ("Listening 0:03" + animated equalizer bars)
  function drawListeningCard(ctx, x, y, w, h, theme, t, micro) {
    drawLiquidGlassPanel(ctx, x, y, w, h, theme, t, { radius: 26, tilt: -0.025, phase: 0.4 });
    ctx.save();
    ctx.translate(x + w * 0.5, y + h * 0.5);
    ctx.rotate(-0.025);
    var lx = -w * 0.5, ly = -h * 0.5;

    if (!micro) {
      ctx.fillStyle = theme.muted;
      ctx.font = '500 22px "Inter", "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Listening  0:0' + Math.min(9, Math.floor(t % 10)), lx + 28, ly + 34);
    }

    // Animated luminous voice waveform bars
    var bars = 15;
    var bw = 6;
    var span = w - 84;
    var baseY = ly + h * 0.62;
    for (var i = 0; i < bars; i++) {
      var u = (i - (bars - 1) * 0.5) / ((bars - 1) * 0.5);
      var env = 1 - u * u * 0.72;
      var bh = (12 + 44 * (0.5 + 0.5 * Math.sin(t * 5.2 + i * 0.72))) * env;
      var bx = lx + 42 + (i / (bars - 1)) * span;
      ctx.fillStyle = i % 3 === 0 ? theme.accent : '#FFFFFF';
      roundRect(ctx, bx - bw * 0.5, baseY - bh * 0.5, bw, bh, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  // Focus & Glow Controls Card (matching foreground glass card in 12-aurora-glass!)
  function drawControlsCard(ctx, x, y, w, h, theme, t, opts, micro) {
    opts = opts || {};
    drawLiquidGlassPanel(ctx, x, y, w, h, theme, t, { radius: 30, tilt: 0.02, phase: 1.4 });
    ctx.save();
    ctx.translate(x + w * 0.5, y + h * 0.5);
    ctx.rotate(0.02);
    var lx = -w * 0.5, ly = -h * 0.5;

    // Row 1: Focus toggle switch
    var r1Y = ly + h * 0.34;
    drawAuroraOrb(ctx, lx + 48, r1Y, 12, theme, t);
    if (!micro) {
      ctx.fillStyle = theme.ink;
      ctx.font = '600 28px "Inter", "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.toggleLabel || 'Focus', lx + 78, r1Y - 8);
      ctx.fillStyle = theme.muted;
      ctx.font = '400 18px "Inter", "Segoe UI", sans-serif';
      ctx.fillText('Ambient quiet mode active', lx + 78, r1Y + 18);
    }
    // Glowing toggle pill
    var tw = 86, th = 44;
    var tx = lx + w - tw - 34, ty = r1Y - th * 0.5;
    roundRect(ctx, tx, ty, tw, th, 22);
    var tg = ctx.createLinearGradient(tx, ty, tx + tw, ty);
    tg.addColorStop(0, theme.glow);
    tg.addColorStop(1, theme.accent);
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(tx + tw - 22, r1Y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Row 2: Glow slider bar
    var r2Y = ly + h * 0.72;
    if (!micro) {
      ctx.fillStyle = theme.ink;
      ctx.font = '500 24px "Inter", "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.sliderLabel || 'Glow', lx + 42, r2Y);
    }
    var pct = Math.max(15, Math.min(95, (opts.sliderPct || 74) + Math.sin(t * 1.4) * 8));
    var sx = lx + 148, sw = w - 250;
    roundRect(ctx, sx, r2Y - 4, sw, 8, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    var fillW = sw * (pct / 100);
    roundRect(ctx, sx, r2Y - 4, fillW, 8, 4);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(sx + fillW, r2Y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (!micro) {
      ctx.fillStyle = theme.muted;
      ctx.font = '600 22px "Inter", "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(pct) + '%', lx + w - 34, r2Y);
    }
    ctx.restore();
  }

  // Liquid-Glass Refractive Droplet Lens (chromatic rim + specular crescent)
  function drawLiquidLens(ctx, cx, cy, r, theme, t) {
    ctx.save();
    // Chromatic dispersion rings
    ctx.beginPath();
    ctx.arc(cx - 3.5, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(52, 207, 240, 0.72)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx + 3.5, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 121, 249, 0.65)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Refractive glass interior
    var lg = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, r * 0.06, cx, cy, r);
    lg.addColorStop(0, 'rgba(255,255,255,0.42)');
    lg.addColorStop(0.55, 'rgba(255,255,255,0.08)');
    lg.addColorStop(0.86, theme.accent + '44');
    lg.addColorStop(1, 'rgba(255,255,255,0.58)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = lg;
    ctx.fill();

    // Curved specular crescent highlight
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.80, -Math.PI * 0.80 + Math.sin(t) * 0.05, -Math.PI * 0.34 + Math.sin(t) * 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Luminous Crystal Glass Ring (matching end-card title of 12-aurora-glass!)
  function drawCrystalRing(ctx, cx, cy, r, theme, t) {
    ctx.save();
    var pulse = 1 + Math.sin(t * 1.8) * 0.03;
    var rr = r * pulse;
    // Soft bloom halo behind ring
    var bloom = ctx.createRadialGradient(cx, cy, rr * 0.4, cx, cy, rr * 1.85);
    bloom.addColorStop(0, theme.accent + '55');
    bloom.addColorStop(0.5, theme.glow + '38');
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, rr * 1.85, 0, Math.PI * 2);
    ctx.fill();

    // Glass ring stroke with iridescent gradient
    var rg = ctx.createLinearGradient(cx - rr, cy - rr, cx + rr, cy + rr);
    rg.addColorStop(0, 'rgba(255,255,255,0.85)');
    rg.addColorStop(0.35, theme.accent);
    rg.addColorStop(0.70, theme.glow);
    rg.addColorStop(1, 'rgba(255,255,255,0.72)');
    ctx.strokeStyle = rg;
    ctx.lineWidth = 10;
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Sharp specular glints on ring
    var a1 = -Math.PI * 0.72 + Math.sin(t * 0.8) * 0.12;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr, 6, 0, Math.PI * 2);
    ctx.fill();
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

  window.AuroraKit = {
    getTheme: getTheme,
    roundRect: roundRect,
    drawAuroraMesh: drawAuroraMesh,
    drawLiquidGlassPanel: drawLiquidGlassPanel,
    drawAuroraOrb: drawAuroraOrb,
    drawListeningCard: drawListeningCard,
    drawControlsCard: drawControlsCard,
    drawLiquidLens: drawLiquidLens,
    drawCrystalRing: drawCrystalRing,
    wrapLines: wrapLines
  };
})();
