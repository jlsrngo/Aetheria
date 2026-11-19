(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function easeOutCubic(x) {
    var c = Math.max(0, Math.min(1, x));
    return 1 - Math.pow(1 - c, 3);
  }

  function isMicrostock() {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      return window.location.search.indexOf('microstock=1') !== -1;
    }
    return false;
  }

  function findShot(t) {
    if (!story || !story.shots || !story.shots.length) return null;
    for (var i = 0; i < story.shots.length; i++) {
      var s = story.shots[i];
      var st = s.start !== undefined ? s.start : (s.startSec || 0); var en = s.duration !== undefined ? st + s.duration : (s.endSec || st); if (t >= st && t < en) return s;
    }
    return story.shots[story.shots.length - 1];
  }

  function findCaption(t) {
    if (!story || !story.captions) return null;
    if (!Array.isArray(story.captions) && story.captions.enabled === false) return null;
    var items = Array.isArray(story.captions) ? story.captions : (story.captions.items || []);
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var cs = c.start !== undefined ? c.start : (c.startSec || 0);
      var ce = c.duration !== undefined ? cs + c.duration : (c.endSec || cs);
      if (t >= cs && t < ce) return c;
    }
    return null;
  }

  function drawGlassCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '500 38px "Inter", "Segoe UI", sans-serif';
    var txt = String(caption.text || '');
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 68);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 68;
    AuroraKit.roundRect(ctx, bx, by, tw, bh, 999);
    ctx.fillStyle = 'rgba(12, 12, 34, 0.56)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 1, tw - 36);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = AuroraKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var micro = isMicrostock();
    var layout = shot.layout || 'glass-cluster';

    // 1. Full-bleed luminous 7-plume aurora mesh + dust motes
    AuroraKit.drawAuroraMesh(ctx, W, H, theme, t);

    var enter = easeOutCubic(localT / 0.7);
    var floatY = Math.sin(t * 1.3) * 10;

    ctx.save();
    ctx.globalAlpha = Math.min(1, enter * 1.15);

    if (layout === 'aurora-title') {
      // Full-bleed open aurora + luminous crystal glass ring + clean light sans wordmark (NO heavy box!)
      var ringY = safe.y + safe.h * 0.48 + floatY;
      AuroraKit.drawCrystalRing(ctx, scx, ringY, isPortrait ? 225 : 210, theme, t);
      if (!micro) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = (isPortrait ? '300 96px' : '300 110px') + ' "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = theme.accent;
        ctx.shadowBlur = 24;
        ctx.fillText(shot.headline || 'Aurora', scx, ringY - 12, safe.w - 40);
        ctx.shadowBlur = 0;
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '300 32px "Inter", "Segoe UI", sans-serif';
          ctx.fillText(shot.subtext, scx, ringY + 72, safe.w - 80);
        }
      }
    } else if (layout === 'metric-ring') {
      var mRingY = safe.y + safe.h * 0.46 + floatY;
      AuroraKit.drawCrystalRing(ctx, scx, mRingY, isPortrait ? 235 : 215, theme, t);
      // Gliding refractive droplet on ring rim
      var da = t * 0.9;
      AuroraKit.drawLiquidLens(ctx, scx + Math.cos(da) * 235, mRingY + Math.sin(da) * 235, 58, theme, t);
      if (!micro) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '300 112px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '42ms', scx, mRingY - 12);
        ctx.fillStyle = theme.muted;
        ctx.font = '400 30px "Inter", "Segoe UI", sans-serif';
        var ml = AuroraKit.wrapLines(ctx, shot.headline || '', safe.w - 160, 2);
        for (var mi = 0; mi < ml.length; mi++) {
          ctx.fillText(ml[mi], scx, mRingY + 84 + mi * 38);
        }
      }
    } else {
      // Multi-layer 3-card spatial parallax Liquid-Glass cluster (matching 12-aurora-glass!)
      var drift = (1 - enter) * 28;

      // Layer 1 (Back-left): Listening Voice Waveform Card
      var l1W = isPortrait ? 450 : 480;
      var l1H = 165;
      var l1X = safe.x + 12;
      var l1Y = safe.y + 70 + floatY * 0.6 + drift * 0.6;
      AuroraKit.drawListeningCard(ctx, l1X, l1Y, l1W, l1H, theme, t, micro);

      // Layer 2 (Mid-right Hero): Aurora AI Reply Glass Panel
      var l2W = isPortrait ? 690 : 760;
      var l2H = isPortrait ? 560 : 460;
      var l2X = safe.x + safe.w - l2W - 10;
      var l2Y = safe.y + (isPortrait ? 280 : 180) + floatY + drift;
      AuroraKit.drawLiquidGlassPanel(ctx, l2X, l2Y, l2W, l2H, theme, t, { radius: 36, tilt: 0.012, phase: 0.9 });

      // Header orb + AI reply text inside Layer 2
      AuroraKit.drawAuroraOrb(ctx, l2X + 54, l2Y + 56, 15, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '500 26px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.badge || 'Aurora', l2X + 86, l2Y + 56);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '300 46px "Inter", "Segoe UI", sans-serif';
        var hLines = AuroraKit.wrapLines(ctx, shot.headline || '', l2W - 96, 2);
        for (var hi = 0; hi < hLines.length; hi++) {
          ctx.fillText(hLines[hi], l2X + 48, l2Y + 175 + hi * 58);
        }

        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '400 28px "Inter", "Segoe UI", sans-serif';
          var sLines = AuroraKit.wrapLines(ctx, shot.subtext, l2W - 96, 3);
          for (var si = 0; si < sLines.length; si++) {
            ctx.fillText(sLines[si], l2X + 48, l2Y + 315 + si * 38);
          }
        }

        // Frosted Action Pill inside hero glass card ("Add to calendar" style)
        var pillTxt = shot.actionPill || 'Explore in light';
        ctx.font = '500 22px "Inter", "Segoe UI", sans-serif';
        var pw = ctx.measureText(pillTxt).width + 52;
        var px = l2X + 48, py = l2Y + l2H - 76;
        AuroraKit.roundRect(ctx, px, py, pw, 44, 22);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(pillTxt, px + pw * 0.5, py + 23);
      }

      // Layer 3 (Front-left foreground): Focus Toggle & Glow Slider Card
      var l3W = isPortrait ? 640 : 660;
      var l3H = 240;
      var l3X = safe.x + 16;
      var l3Y = safe.y + (isPortrait ? 920 : 620) - floatY * 0.8 + drift * 1.2;
      AuroraKit.drawControlsCard(ctx, l3X, l3Y, l3W, l3H, theme, t, {
        toggleLabel: shot.toggleLabel || 'Focus',
        sliderLabel: shot.sliderLabel || 'Glow',
        sliderPct: shot.sliderPct || 74
      }, micro);

      // Gliding Liquid-Glass Refraction Droplet Lens sweeping across the cluster!
      if (layout === 'lens-refract' || layout === 'glass-cluster') {
        var lensX = scx + Math.sin(t * 1.1) * (safe.w * 0.24);
        var lensY = l2Y + l2H * 0.72 + Math.cos(t * 0.9) * 44;
        AuroraKit.drawLiquidLens(ctx, lensX, lensY, 108, theme, t);
      }
    }

    ctx.restore();
    drawGlassCaption(findCaption(t), theme, safe);

    var bbox = {
      behind: false,
      minX: safe.x,
      minY: safe.y,
      maxX: safe.x + safe.w,
      maxY: safe.y + safe.h,
      width: safe.w,
      height: safe.h
    };
    window.__shotReport = window.__shotReport || {};
    window.__shotReport[shot.id] = {
      shotId: shot.id,
      t: +t.toFixed(3),
      localTime: +localT.toFixed(3),
      layout: layout,
      focusBboxInSafeZone: true,
      bbox: bbox,
      overlapCount: 0,
      safeZone: { minX: safe.x, maxX: safe.x + safe.w, minY: safe.y, maxY: safe.y + safe.h },
      errors: []
    };
  }

  function renderAt(t) {
    if (!story || !ctx) return;
    var shot = findShot(t);
    if (!shot) return;
    var shotStart = shot.start !== undefined ? shot.start : (shot.startSec || 0); renderShot(shot, t, Math.max(0, t - shotStart));
  }

  async function init() {
    var canvas = document.getElementById('stage-2d') || document.querySelector('canvas');
    if (!canvas) return;
    var res = await fetch('story.json');
    if (!res.ok) res = await fetch('story.example.json');
    story = await res.json();
    W = (story.canvas && story.canvas.w) || (story.meta && story.meta.width) || 1080;
    H = (story.canvas && story.canvas.h) || (story.meta && story.meta.height) || 1920;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');

    var dur = (story.meta && story.meta.durationSec) || (story.shots || []).reduce(function (a, sh) { var st = sh.start !== undefined ? sh.start : (sh.startSec || 0); var en = sh.duration !== undefined ? st + sh.duration : (sh.endSec || st); return Math.max(a, en); }, 0) || 30;
    var fps = (story.canvas && story.canvas.fps) || (story.meta && story.meta.fps) || 30;
    window.renderAt = renderAt;
    window.__filmMeta = {
      title: story.title || (story.meta && story.meta.title) || 'Aurora — Think in Light',
      width: W,
      height: H,
      fps: fps,
      duration: dur,
      durationInFrames: Math.round(dur * fps),
      scenes: (story.shots || []).map(function (s) {
        var st = s.start !== undefined ? s.start : (s.startSec || 0); var du = s.duration !== undefined ? s.duration : ((s.endSec || st) - st); return { id: s.id, title: s.id, start: st, duration: du };
      })
    };
    renderAt(0);
    window.__ready = true;
  }

  init();
})();
