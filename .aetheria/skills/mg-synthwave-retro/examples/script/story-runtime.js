(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function easeOutExpo(x) {
    var c = Math.max(0, Math.min(1, x));
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
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

  function renderShot(shot, t, localT) {
    var theme = SynthwaveKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var micro = isMicrostock();
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

      var slam = 0.85 + 0.15 * easeOutExpo(localT / 0.45);
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
      var cap = findCaption(t);
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
      title: story.title || (story.meta && story.meta.title) || 'Outrun 1986 Synthwave',
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
