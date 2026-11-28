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

  /** Localized impact vibration (Video 1 padlock slam / Video 3 logo snap) — never continuous full-scene shake. */
  function localizedImpactShake(t, hitTime, amp, duration) {
    const dt = t - hitTime;
    const dur = duration || 0.28;
    if (dt < 0 || dt > dur) return { x: 0, y: 0 };
    const decay = Math.exp(-dt * 14);
    const a = amp || 6;
    return {
      x: Math.sin(dt * 68) * decay * a,
      y: Math.cos(dt * 58) * decay * (a * 0.72),
    };
  }

  /** Cylindrical 3D orbit interpolation around lookAt (Video 2 180-deg flip without zenith gimbal-flip). */
  function sampleCylindricalOrbit(pos0, pos1, look0, look1, u) {
    const lx = lerp(look0[0], look1[0], u);
    const ly = lerp(look0[1], look1[1], u);
    const lz = lerp(look0[2], look1[2], u);
    const r0 = Math.hypot(pos0[0] - look0[0], pos0[2] - look0[2]);
    const r1 = Math.hypot(pos1[0] - look1[0], pos1[2] - look1[2]);
    const a0 = Math.atan2(pos0[0] - look0[0], pos0[2] - look0[2]);
    let a1 = Math.atan2(pos1[0] - look1[0], pos1[2] - look1[2]);
    if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
    if (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
    const r = lerp(r0, r1, u);
    const ang = lerp(a0, a1, u);
    return {
      pos: [lx + Math.sin(ang) * r, lerp(pos0[1], pos1[1], u), lz + Math.cos(ang) * r],
      look: [lx, ly, lz],
    };
  }

  /** Velocity-driven 180-deg shutter motion blur amount in pixels during whip-pans (Video 2). */
  function computeShutterBlur(speed, threshold, maxPx) {
    const th = threshold != null ? threshold : 14;
    const cap = maxPx != null ? maxPx : 11;
    return Math.min(cap, Math.max(0, (speed - th) * 0.22));
  }

  /** Rhythmic beat-shake transform for horizontal tech icon ribbons (Video 3). */
  function computeBeatShake(t, idx, beatTimes) {
    let pulse = 0;
    const beats = beatTimes || [2.98, 3.48, 3.98, 4.48];
    for (let i = 0; i < beats.length; i++) {
      pulse += Math.exp(-Math.pow((t - beats[i]) * 14, 2));
    }
    const amp = 1.6 + pulse * 3.2;
    return {
      x: Math.sin(t * 27 + idx * 2.3) * amp + Math.cos(t * 41 + idx * 1.1) * amp * 0.45,
      y: Math.cos(t * 23 + idx * 1.9) * amp * 1.15,
      rot: Math.sin(t * 19 + idx * 1.7) * (0.09 + pulse * 0.10),
      scale: 1 + pulse * 0.08 * Math.sin(idx * 1.4 + t * 12),
    };
  }

  /** Neon radial score gauge with outer bloom (Video 4 Real Experience Score 96). */
  function drawNeonScoreGauge(ctx, opts) {
    const cx = opts.cx || 0;
    const cy = opts.cy || 0;
    const r = opts.radius || 104;
    const pct = clamp01(opts.progress || 0);
    const lineW = opts.lineWidth || 15;
    if (opts.trackAlpha && opts.trackAlpha > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${opts.trackAlpha.toFixed(3)})`;
      ctx.lineWidth = lineW - 1;
      ctx.stroke();
      ctx.restore();
    }
    if (pct > 0.005) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI * 0.5, -Math.PI * 0.5 + pct * Math.PI * 2);
      ctx.strokeStyle = opts.color || "#5CF2AE";
      ctx.lineWidth = lineW;
      ctx.lineCap = "round";
      ctx.shadowColor = opts.glow || "rgba(74, 222, 128, 0.92)";
      ctx.shadowBlur = opts.shadowBlur != null ? opts.shadowBlur : 32;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Frosted top-lit glass pill with optional inner ambient color spill (Video 5 Granola vertical/horizontal pills). */
  function drawFrostedGlassPill(ctx, opts) {
    const x = opts.x || -84;
    const y = opts.y || -172;
    const w = opts.w || 168;
    const h = opts.h || 344;
    const r = opts.r != null ? opts.r : Math.min(w, h) * 0.5;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(68, 70, 66, 0.72)");
    grad.addColorStop(0.35, "rgba(32, 34, 31, 0.88)");
    grad.addColorStop(1, "rgba(22, 24, 21, 0.94)");
    ctx.save();
    ctx.shadowColor = opts.glowColor || "rgba(155, 225, 60, 0.22)";
    ctx.shadowBlur = opts.glowBlur != null ? opts.glowBlur : 55;
    traceRoundedRect(ctx, x, y, w, h, r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    traceRoundedRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = opts.border || "rgba(255,255,255,0.22)";
    ctx.lineWidth = opts.borderWidth || 2;
    ctx.stroke();
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
    localizedImpactShake,
    sampleCylindricalOrbit,
    computeShutterBlur,
    computeBeatShake,
    traceRoundedRect,
    drawBacklitCard,
    drawGlowingEmblem,
    drawLetterWave,
    drawWaveformBars,
    drawNeonScoreGauge,
    drawFrostedGlassPill,
    projectCylinderRing,
    traceAuroraStar,
  };
});
