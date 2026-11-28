/**
 * SnappyTechKit — Reusable motion-craft primitives for `mg-snappy-tech-showcase`.
 * Synthesized from verified 30fps/60fps studio benchmarks (obsidian bloom, 3D plush studio,
 * cobalt 360-degree card rings, photo-OS demos, and aurora star iris transitions).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SnappyTechKit = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, v) => clamp01((v - a) / Math.max(1e-5, b - a));

  /** True optical exponential zoom (prevents linear-scale slam/stutter at 60fps). */
  function expLerp(a, b, t) {
    const safeA = Math.max(1e-4, a);
    const safeB = Math.max(1e-4, b);
    return safeA * Math.pow(safeB / safeA, clamp01(t));
  }

  /** Broad cosine-cubic S-curve for smooth cinema dollies the eye can track. */
  function smoothGlide(a, b, v) {
    const x = inv(a, b, v);
    const cos = 0.5 - 0.5 * Math.cos(Math.PI * x);
    const cub = x * x * (3 - 2 * x);
    return 0.65 * cos + 0.35 * cub;
  }

  /** Spring overshoot arrival for tactile UI pills, cards, and letter-wave entries. */
  function springOut(a, b, v) {
    const x = inv(a, b, v);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return 1 - Math.exp(-7.5 * x) * Math.cos(8.5 * x);
  }

  /** Snappy exponential whip-pan ease for fast 0.28-0.38s camera cuts. */
  function whipEase(a, b, v) {
    const x = inv(a, b, v);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? Math.pow(2, 12 * x - 6) * 0.5 : 1 - Math.pow(2, -12 * x + 6) * 0.5;
  }

  /** Physical press-in + spring recoil impulse when a mascot or prop lands on a surface. */
  function impactDip(t, hitTime, depth) {
    const dt = t - hitTime;
    if (dt < -0.02 || dt > 0.36) return 0;
    const u = Math.max(0, dt);
    return -(depth || 0.12) * Math.exp(-11 * u) * Math.sin(u * 20 + 0.35);
  }

  function traceRoundedRect(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /** Dark obsidian glass card with soft backlit halo shadow and hairline rim. */
  function drawBacklitCard(ctx, opts) {
    const x = opts.x || 0;
    const y = opts.y || 0;
    const w = opts.w || 640;
    const h = opts.h || 360;
    const r = opts.r != null ? opts.r : 26;
    ctx.save();
    ctx.shadowColor = opts.glowColor || "rgba(255,255,255,0.20)";
    ctx.shadowBlur = opts.glowBlur != null ? opts.glowBlur : 85;
    traceRoundedRect(ctx, x, y, w, h, r);
    ctx.fillStyle = opts.fill || "#09090B";
    ctx.fill();
    ctx.restore();
    traceRoundedRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = opts.border || "rgba(255,255,255,0.16)";
    ctx.lineWidth = opts.borderWidth || 1.5;
    ctx.stroke();
  }

  /** Multi-pass optical halation bloom wrapper for any luminous emblem/shape callback. */
  function drawGlowingEmblem(ctx, drawShapeFn, glowStrength) {
    const gl = Math.max(0, glowStrength || 0);
    if (gl > 0.02) {
      ctx.save();
      ctx.filter = `blur(${(14 * gl).toFixed(1)}px)`;
      ctx.globalAlpha *= Math.min(1, 0.55 * gl);
      drawShapeFn(ctx, 1.08);
      ctx.filter = `blur(${(5 * gl).toFixed(1)}px)`;
      ctx.globalAlpha = Math.min(1, 0.72 * gl);
      drawShapeFn(ctx, 1.03);
      ctx.filter = "none";
      ctx.restore();
    }
    ctx.save();
    if (gl > 0.15) ctx.filter = `blur(${(1.2 * Math.min(1, gl)).toFixed(1)}px)`;
    drawShapeFn(ctx, 1.0);
    ctx.filter = "none";
    ctx.restore();
  }

  /** Per-character Letter Wave drop-in with ripple bounce and peak highlight flash. */
  function drawLetterWave(ctx, text, opts) {
    const t = opts.t || 0;
    const startT = opts.startT || 0;
    const step = opts.step || 0.022;
    const dur = opts.dur || 0.26;
    const baseColor = opts.color || "#D4D4D8";
    const flashColor = opts.flashColor || "#FFFFFF";
    const font = opts.font || '500 38px "Inter", sans-serif';
    ctx.save();
    ctx.font = font;
    let curX = opts.x || 0;
    const baseY = opts.y || 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const cw = ctx.measureText(ch).width;
      const cStart = startT + i * step;
      const rawIn = inv(cStart, cStart + dur, t);
      if (rawIn > 0.005) {
        const sp = springOut(cStart, cStart + dur, t);
        const yWave = lerp(-(opts.drop || 36), 0, sp) - Math.sin(rawIn * Math.PI) * 7;
        const sc = lerp(0.84, 1.0, sp);
        const flash = Math.exp(-Math.pow((rawIn - 0.30) * 4.8, 2));
        const blur = Math.max(0, 1 - rawIn * 2.2) * 9;
        ctx.save();
        ctx.globalAlpha *= clamp01(rawIn * 2.5);
        if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
        if (flash > 0.05) {
          ctx.shadowColor = "rgba(255,255,255,0.92)";
          ctx.shadowBlur = 20 * flash;
        }
        ctx.translate(curX + cw * 0.5, baseY + yWave);
        ctx.scale(sc, sc);
        ctx.fillStyle = flash > 0.22 ? flashColor : baseColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ch, 0, 0);
        ctx.filter = "none";
        ctx.restore();
      }
      curX += cw;
    }
    ctx.restore();
    return curX;
  }

  /** Animated neon equalizer bars (used inside horizontal & vertical frosted audio pills). */
  function drawWaveformBars(ctx, opts) {
    const t = opts.t || 0;
    const count = opts.count || 5;
    const cx = opts.cx || 0;
    const cy = opts.cy || 0;
    const barW = opts.barW || 10;
    const gap = opts.gap || 18;
    const maxH = opts.maxH || 72;
    const totalW = (count - 1) * gap;
    ctx.save();
    ctx.fillStyle = opts.color || "#B8F848";
    ctx.shadowColor = opts.glow || "rgba(163, 230, 53, 0.95)";
    ctx.shadowBlur = opts.shadowBlur != null ? opts.shadowBlur : 28;
    for (let i = 0; i < count; i++) {
      const boost = opts.leftBoost ? (i === 0 ? 1.45 : i === 1 ? 1.15 : 0.72) : 1.0;
      const wave = 0.26 + 0.74 * Math.abs(Math.sin(t * 11.5 + i * 1.15) * Math.cos(t * 4.2 + i * 0.7));
      const bh = Math.min(maxH, (14 + wave * (maxH * 0.7)) * boost);
      traceRoundedRect(ctx, cx - totalW * 0.5 + i * gap - barW * 0.5, cy - bh * 0.5, barW, bh, barW * 0.5);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Projects N cards onto a true 360-degree tilted 3D cylinder ring (sorted back-to-front). */
  function projectCylinderRing(count, scrollPos, opts) {
    const cx = opts.cx || 640;
    const cy = opts.cy || 360;
    const radiusX = opts.radiusX || 435;
    const cardW = opts.cardW || 225;
    const cardH = opts.cardH || 320;
    const pitchY = opts.pitchY != null ? opts.pitchY : 20;
    const masterScale = opts.scale != null ? opts.scale : 1.0;
    const items = [];
    for (let i = 0; i < count; i++) {
      const ang = (i - scrollPos) * ((Math.PI * 2) / count);
      const sinA = Math.sin(ang);
      const cosA = Math.cos(ang);
      const persp = (0.80 + 0.20 * cosA) * masterScale;
      items.push({
        index: i,
        x: cx + sinA * radiusX * masterScale,
        y: cy + cosA * pitchY * masterScale,
        z: cosA * radiusX,
        w: cardW * persp * Math.max(0.09, Math.abs(cosA)),
        h: cardH * persp,
        isBack: cosA < 0,
        alpha: cosA >= 0 ? 1.0 : 0.78 + 0.22 * (1 + cosA),
      });
    }
    items.sort((a, b) => a.z - b.z);
    return items;
  }

  /** Traces a 4-point Gemini/Aurora star centered at (0,0) with radius R. */
  function traceAuroraStar(ctx, radius, innerRatio) {
    const r = radius || 100;
    const k = innerRatio || 0.24;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * k, -r * k, r, 0);
    ctx.quadraticCurveTo(r * k, r * k, 0, r);
    ctx.quadraticCurveTo(-r * k, r * k, -r, 0);
    ctx.quadraticCurveTo(-r * k, -r * k, 0, -r);
    ctx.closePath();
  }

  return {
    clamp01,
    lerp,
    inv,
    expLerp,
    smoothGlide,
    springOut,
    whipEase,
    impactDip,
    traceRoundedRect,
    drawBacklitCard,
    drawGlowingEmblem,
    drawLetterWave,
    drawWaveformBars,
    projectCylinderRing,
    traceAuroraStar,
  };
});
