/**
 * mg-synthwave-retro story-runtime.js (Core API v1)
 * Skill-specific layout rendering powered by /script/story-core.js.
 */
(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  

  window.StoryCore.boot({
    id: 'mg-synthwave-retro',
    defaultTitle: 'Outrun 1986 Synthwave',
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
      var theme = SynthwaveKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var micro = env.micro;
    var layout = shot.layout || 'highway-cruise';

    var horizonY = Math.round(H * (isPortrait ? 0.56 : 0.58));

    // 1. Full-bleed twilight sky gradient
    var skyG = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyG.addColorStop(0, theme.skyTop);
    skyG.addColorStop(0.55, theme.skyMid);
    skyG.addColorStop(1, theme.skyBot);
    ctx.fillStyle = skyG;
    ctx.fillRect(0, 0, W, horizonY);

    // 2. Starfield + shooting star
    SynthwaveKit.drawStarfield(ctx, W, horizonY, t);

    // 3. Massive segmented Outrun Sun sitting on horizon
    var sunR = Math.round(Math.min(W, H) * (isPortrait ? 0.25 : 0.22));
    var sunY = horizonY - sunR * 0.42;
    SynthwaveKit.drawOutrunSun(ctx, W * 0.5, sunY, sunR, theme, t);

    // 4. Flanking 3D wireframe mountain ranges
    SynthwaveKit.drawWireframeMountains(ctx, W, horizonY, theme, t);

    // 5. High-speed perspective neon grid highway + sun reflection streak
    var speedMult = (shot.carMode === 'boost' || layout === 'car-chase') ? 1.85 : 1.0;
    SynthwaveKit.drawPerspectiveHighway(ctx, W, H, horizonY, theme, t, speedMult);

    // 6. Rushing silhouetted palm trees with hot pink rim light
    var palmCycle = (t * 0.45) % 1;
    var pScaleL = 0.55 + palmCycle * 0.75;
    var pScaleR = 0.55 + ((palmCycle + 0.5) % 1) * 0.75;
    SynthwaveKit.drawPalmSilhouette(ctx, W * (0.14 - palmCycle * 0.10), horizonY + 120 * pScaleL, 260 * pScaleL, -1, theme);
    SynthwaveKit.drawPalmSilhouette(ctx, W * (0.86 + ((palmCycle + 0.5) % 1) * 0.10), horizonY + 120 * pScaleR, 260 * pScaleR, 1, theme);

    // 7. 1986 Wedge Supercar cruising down center highway!
    if (shot.carMode !== 'hidden') {
      var carY = horizonY + (H - horizonY) * (isPortrait ? 0.44 : 0.46);
      var carScale = isPortrait ? 1.45 : 1.55;
      SynthwaveKit.drawOutrunCar(ctx, W * 0.5, carY, carScale, theme, t, shot.carMode === 'boost');
    }

    // 8. Full-bleed Chrome 3D Title + Neon Script + VHS OSD (hidden in Mode 'M'!)
    if (!micro) {
      SynthwaveKit.drawVhsOsd(ctx, safe, t);

      var slam = 0.85 + 0.15 * StoryCore.easeOutExpo(localT / 0.45);
      ctx.save();
      ctx.translate(scx, 0);
      ctx.scale(slam, slam);
      ctx.translate(-scx, 0);

      if (layout === 'neon-metric' && shot.metric) {
        SynthwaveKit.drawChromeHeadline(ctx, [shot.metric], scx, isPortrait ? 310 : 210, isPortrait ? 148 : 136, safe.w - 40, theme, t);
        var subLines = SynthwaveKit.wrapLines((shot.headline || '').toUpperCase(), 18);
        SynthwaveKit.drawNeonScript(ctx, subLines.join(' '), scx, isPortrait ? 450 : 325, isPortrait ? 52 : 48, safe.w - 60, theme);
      } else {
        var lines = SynthwaveKit.wrapLines((shot.headline || 'NEON DRIVE').toUpperCase(), isPortrait ? 12 : 16);
        var titleFs = isPortrait ? (lines.length > 1 ? 94 : 108) : 114;
        var titleY = isPortrait ? 275 : 195;
        SynthwaveKit.drawChromeHeadline(ctx, lines, scx, titleY, titleFs, safe.w - 30, theme, t);

        if (shot.badge) {
          var scriptY = titleY + lines.length * (titleFs * 0.92) + 28;
          SynthwaveKit.drawNeonScript(ctx, shot.badge, scx, scriptY, isPortrait ? 64 : 58, safe.w - 50, theme);
        }
      }
      ctx.restore();

      if (shot.subtext) {
        ctx.save();
        ctx.font = '700 28px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#F8FAFC';
        var sLines = SynthwaveKit.wrapLines(shot.subtext, isPortrait ? 36 : 54);
        var subBaseY = isPortrait ? 1205 : (H - 135);
        for (var si = 0; si < sLines.length; si++) {
          ctx.fillText(sLines[si], scx, subBaseY + si * 36, safe.w - 40);
        }
        ctx.restore();
      }

      // Bottom Caption pill
      var cap = env.caption;
      if (cap && cap.text) {
        ctx.save();
        ctx.font = 'italic 900 44px "Impact", "Arial Black", sans-serif';
        var cTxt = String(cap.text).toUpperCase();
        var tw = Math.min(safe.w - 40, ctx.measureText(cTxt).width + 64);
        var bx = scx - tw * 0.5;
        var by = H - 230;
        ctx.fillStyle = 'rgba(10, 2, 24, 0.82)';
        ctx.fillRect(bx, by, tw, 68);
        ctx.strokeStyle = theme.wire;
        ctx.shadowColor = theme.wire;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.strokeRect(bx, by, tw, 68);
        ctx.shadowBlur = 0;
        ctx.fillStyle = theme.sunTop;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cTxt, scx, by + 35, tw - 28);
        ctx.restore();
      }
    }

    // 9. Authentic subtle VHS scanlines + vignette
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    for (var sy = 0; sy < H; sy += 5) {
      ctx.fillRect(0, sy, W, 1.8);
    }
    var vig = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.74);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(4,0,12,0.46)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

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
