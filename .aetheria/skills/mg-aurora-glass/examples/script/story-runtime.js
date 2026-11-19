/**
 * mg-aurora-glass story-runtime.js (Core API v1)
 * Skill-specific layout rendering powered by /script/story-core.js.
 */
(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function drawGlassCaption(caption, theme, safe) {
    if (!caption || StoryCore.isMicrostock(story)) return;
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

  window.StoryCore.boot({
    id: 'mg-aurora-glass',
    defaultTitle: 'Aurora — Think in Light',
    init: function (env) {
      story = env.story;
      ctx = env.ctx;
      W = env.W;
      H = env.H;
    },
    renderShot: function (env) {
      story = env.story;
      ctx = env.ctx;
      W = env.W;
      H = env.H;
      var shot = env.shot;
      var t = env.t;
      var localT = env.localTime;
      var theme = AuroraKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var micro = env.micro;
    var layout = shot.layout || 'glass-cluster';

    // 1. Full-bleed luminous 7-plume aurora mesh + dust motes
    AuroraKit.drawAuroraMesh(ctx, W, H, theme, t);

    var enter = StoryCore.easeOutCubic(localT / 0.7);
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
    drawGlassCaption(env.caption, theme, safe);

    var bbox = {
      behind: false,
      minX: safe.x,
      minY: safe.y,
      maxX: safe.x + safe.w,
      maxY: safe.y + safe.h,
      width: safe.w,
      height: safe.h
    };
      return bbox;
    }
  });
})();
