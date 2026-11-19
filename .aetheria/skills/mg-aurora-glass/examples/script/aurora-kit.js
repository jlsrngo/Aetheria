(function () {
  'use strict';

  var THEMES = {
    'indigo-aurora': {
      bgTop: '#050714',
      bgBot: '#0D1028',
      orbs: ['#6366F1', '#22D3EE', '#A855F7', '#38BDF8'],
      ink: '#F8FAFC',
      muted: '#CBD5E1',
      accent: '#38BDF8',
      rimA: 'rgba(165, 243, 252, 0.55)',
      rimB: 'rgba(192, 132, 252, 0.35)',
      glassFill: 'rgba(255, 255, 255, 0.085)'
    },
    'emerald-northern': {
      bgTop: '#031214',
      bgBot: '#071F24',
      orbs: ['#10B981', '#2DD4BF', '#38BDF8', '#34D399'],
      ink: '#F0FDF4',
      muted: '#A7F3D0',
      accent: '#2DD4BF',
      rimA: 'rgba(167, 243, 208, 0.55)',
      rimB: 'rgba(56, 189, 248, 0.32)',
      glassFill: 'rgba(255, 255, 255, 0.08)'
    },
    'rose-nebula': {
      bgTop: '#140614',
      bgBot: '#1E0B24',
      orbs: ['#F43F5E', '#E879F9', '#8B5CF6', '#FB7185'],
      ink: '#FFF1F2',
      muted: '#FBCFE8',
      accent: '#F472B6',
      rimA: 'rgba(251, 207, 232, 0.55)',
      rimB: 'rgba(167, 139, 250, 0.35)',
      glassFill: 'rgba(255, 255, 255, 0.085)'
    },
    'obsidian-cyan': {
      bgTop: '#04070D',
      bgBot: '#09111E',
      orbs: ['#06B6D4', '#3B82F6', '#0EA5E9', '#67E8F9'],
      ink: '#F8FAFC',
      muted: '#94A3B8',
      accent: '#22D3EE',
      rimA: 'rgba(103, 232, 249, 0.55)',
      rimB: 'rgba(96, 165, 250, 0.35)',
      glassFill: 'rgba(255, 255, 255, 0.075)'
    },
    'twilight-violet': {
      bgTop: '#0B0718',
      bgBot: '#181030',
      orbs: ['#8B5CF6', '#EC4899', '#6366F1', '#38BDF8'],
      ink: '#F5F3FF',
      muted: '#DDD6FE',
      accent: '#C084FC',
      rimA: 'rgba(221, 214, 254, 0.55)',
      rimB: 'rgba(244, 114, 182, 0.35)',
      glassFill: 'rgba(255, 255, 255, 0.085)'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['indigo-aurora'];
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawAuroraBackdrop(ctx, w, h, theme, t) {
    var bgGrad = ctx.createLinearGradient(0, 0, w * 0.4, h);
    bgGrad.addColorStop(0, theme.bgTop);
    bgGrad.addColorStop(1, theme.bgBot);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 4 drifting aurora mesh orbs with additive screen glow
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var orbits = [
      { cx: 0.25, cy: 0.22, rx: 0.16, ry: 0.10, sp: 0.45, ph: 0.0, r: 0.52 },
      { cx: 0.78, cy: 0.30, rx: 0.14, ry: 0.12, sp: 0.38, ph: 1.7, r: 0.48 },
      { cx: 0.45, cy: 0.72, rx: 0.18, ry: 0.09, sp: 0.52, ph: 3.1, r: 0.56 },
      { cx: 0.72, cy: 0.80, rx: 0.12, ry: 0.11, sp: 0.42, ph: 4.6, r: 0.44 }
    ];
    for (var i = 0; i < orbits.length; i++) {
      var o = orbits[i];
      var ox = (o.cx + Math.sin(t * o.sp + o.ph) * o.rx) * w;
      var oy = (o.cy + Math.cos(t * o.sp * 0.8 + o.ph) * o.ry) * h;
      var rad = Math.min(w, h) * o.r;
      var grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, rad);
      grad.addColorStop(0, theme.orbs[i % theme.orbs.length]);
      grad.addColorStop(0.45, theme.orbs[i % theme.orbs.length] + '55');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Subtle atmospheric horizon veil for contrast
    var veil = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
    veil.addColorStop(0, 'rgba(255,255,255,0.03)');
    veil.addColorStop(1, 'rgba(2,4,12,0.48)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGlassCard(ctx, x, y, w, h, theme, t, opts) {
    opts = opts || {};
    var r = opts.radius || 30;
    ctx.save();

    // Outer ambient shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 18;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = theme.glassFill;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Clip inner frosted sheen & specular light sweep
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();

    // Milky frosted vertical gradient
    var milk = ctx.createLinearGradient(x, y, x + w, y + h);
    milk.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    milk.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
    milk.addColorStop(1, 'rgba(255, 255, 255, 0.09)');
    ctx.fillStyle = milk;
    ctx.fillRect(x, y, w, h);

    // Specular light sheen gliding gently
    var sweepX = x + ((Math.sin(t * 0.75) * 0.5 + 0.5) * 1.4 - 0.2) * w;
    var sheen = ctx.createLinearGradient(sweepX - 160, y, sweepX + 160, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Iridescent specular border
    var rimGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    rimGrad.addColorStop(0, theme.rimA);
    rimGrad.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    rimGrad.addColorStop(1, theme.rimB);
    roundRectPath(ctx, x, y, w, h, r);
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top inner specular hairline
    ctx.beginPath();
    ctx.moveTo(x + r, y + 1.5);
    ctx.lineTo(x + w - r, y + 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
  }

  function drawGlassLens(ctx, cx, cy, radius, theme, t) {
    ctx.save();
    // Chromatic rim rings (cyan / magenta dispersion)
    ctx.beginPath();
    ctx.arc(cx - 3, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx + 3, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 121, 249, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Refractive sphere interior
    var lensGrad = ctx.createRadialGradient(
      cx - radius * 0.3, cy - radius * 0.3, radius * 0.08,
      cx, cy, radius
    );
    lensGrad.addColorStop(0, 'rgba(255,255,255,0.34)');
    lensGrad.addColorStop(0.55, 'rgba(255,255,255,0.08)');
    lensGrad.addColorStop(0.88, theme.accent + '33');
    lensGrad.addColorStop(1, 'rgba(255,255,255,0.42)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = lensGrad;
    ctx.fill();

    // Curved specular crescent highlight
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.82, -Math.PI * 0.82 + Math.sin(t) * 0.06, -Math.PI * 0.35 + Math.sin(t) * 0.06);
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawWidget(ctx, name, cx, cy, size, theme, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size * 0.5;
    if (name === 'orb-pulse') {
      var pulse = 1 + Math.sin(t * 2.6) * 0.07;
      var glow = ctx.createRadialGradient(0, 0, 4, 0, 0, s * 1.15 * pulse);
      glow.addColorStop(0, '#FFFFFF');
      glow.addColorStop(0.35, theme.accent);
      glow.addColorStop(0.75, theme.orbs[0] + '66');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.15 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.68, 0, Math.PI * 2);
      ctx.stroke();
    } else if (name === 'waveform') {
      var bars = 9;
      var bw = size / (bars * 1.8);
      for (var i = 0; i < bars; i++) {
        var norm = (i - (bars - 1) / 2) / ((bars - 1) / 2);
        var env = 1 - norm * norm * 0.65;
        var bh = (0.32 + 0.68 * (0.5 + 0.5 * Math.sin(t * 4.5 + i * 0.75))) * size * 0.78 * env;
        var bx = -size * 0.46 + i * (size * 0.92 / (bars - 1)) - bw * 0.5;
        var g = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5);
        g.addColorStop(0, theme.accent);
        g.addColorStop(1, theme.orbs[2]);
        ctx.fillStyle = g;
        roundRectPath(ctx, bx, -bh * 0.5, bw, bh, bw * 0.5);
        ctx.fill();
      }
    } else if (name === 'chat-bubble') {
      var w1 = size * 0.92, h1 = size * 0.42;
      roundRectPath(ctx, -w1 * 0.5, -h1 * 0.72, w1, h1, h1 * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.strokeStyle = theme.rimA;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (var d = -1; d <= 1; d++) {
        var dy = Math.sin(t * 4 + d * 0.9) * 3;
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(d * size * 0.16, -h1 * 0.22 + dy, size * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
      roundRectPath(ctx, -w1 * 0.34, h1 * 0.05, w1 * 0.76, h1 * 0.66, h1 * 0.33);
      ctx.fillStyle = theme.accent + '44';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.stroke();
    } else if (name === 'toggle-grid') {
      var pw = size * 0.82, ph = size * 0.32;
      for (var r = 0; r < 2; r++) {
        var ty = (r === 0 ? -ph * 0.78 : ph * 0.18);
        var on = (r === 0);
        roundRectPath(ctx, -pw * 0.5, ty, pw, ph, ph * 0.5);
        ctx.fillStyle = on ? theme.accent + '66' : 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.strokeStyle = on ? theme.rimA : 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 2;
        ctx.stroke();
        var kx = on ? pw * 0.5 - ph * 0.5 : -pw * 0.5 + ph * 0.5;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(kx, ty + ph * 0.5, ph * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (name === 'metric-ring') {
      ctx.lineWidth = Math.max(6, size * 0.09);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.76, 0, Math.PI * 2);
      ctx.stroke();
      var arcEnd = -Math.PI * 0.5 + Math.PI * 1.55 + Math.sin(t * 1.8) * 0.15;
      var rg = ctx.createLinearGradient(-s, -s, s, s);
      rg.addColorStop(0, theme.accent);
      rg.addColorStop(1, theme.orbs[2]);
      ctx.strokeStyle = rg;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.76, -Math.PI * 0.5, arcEnd);
      ctx.stroke();
    } else {
      // spark-prism
      ctx.rotate(Math.sin(t * 1.4) * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.9);
      ctx.lineTo(s * 0.65, 0);
      ctx.lineTo(0, s * 0.9);
      ctx.lineTo(-s * 0.65, 0);
      ctx.closePath();
      var pg = ctx.createLinearGradient(-s, -s, s, s);
      pg.addColorStop(0, '#FFFFFF');
      pg.addColorStop(0.45, theme.accent);
      pg.addColorStop(1, theme.orbs[2]);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
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

  function drawGlassPill(ctx, text, cx, cy, theme) {
    ctx.save();
    ctx.font = '600 21px "Inter", "Segoe UI", system-ui, sans-serif';
    var tw = ctx.measureText(text).width;
    var pw = tw + 40;
    var ph = 42;
    roundRectPath(ctx, cx - pw * 0.5, cy - ph * 0.5, pw, ph, 999);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = theme.rimA;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 1);
    ctx.restore();
  }

  window.AuroraKit = {
    getTheme: getTheme,
    roundRectPath: roundRectPath,
    drawAuroraBackdrop: drawAuroraBackdrop,
    drawGlassCard: drawGlassCard,
    drawGlassLens: drawGlassLens,
    drawWidget: drawWidget,
    wrapLines: wrapLines,
    drawGlassPill: drawGlassPill
  };
})();
