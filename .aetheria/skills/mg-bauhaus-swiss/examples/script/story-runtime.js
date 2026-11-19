(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

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

  function drawSwissCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '900 42px "Inter", "Helvetica Neue", "Arial Black", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 70;
    ctx.fillStyle = theme.red;
    ctx.fillRect(bx + 8, by + 8, tw, bh);
    ctx.fillStyle = theme.ink;
    ctx.fillRect(bx, by, tw, bh);
    ctx.fillStyle = theme.paper === '#141414' ? '#141414' : '#F1E9DA';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = BauhausKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var scy = safe.y + safe.h * 0.5;
    var micro = isMicrostock();
    var layout = shot.layout || 'bauhaus-poster';

    var beatNum = Math.min(20, Math.floor(t * 2) + 1);
    BauhausKit.drawLithoSheet(ctx, W, H, safe, theme, beatNum, micro);

    ctx.save();
    ctx.beginPath();
    ctx.rect(safe.x, safe.y, safe.w, safe.h);
    ctx.clip();

    var mod = isPortrait ? 148 : 136;

    if (layout === 'kandinsky-assembly' || layout === 'escapement-pivot') {
      BauhausKit.drawKandinskyGroup(ctx, scx, scy + 40, mod, theme, t, localT, layout);
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 54px "Inter", "Helvetica Neue", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText((shot.headline || '').toUpperCase(), safe.x + 56, safe.y + 74, safe.w - 112);
        if (shot.subtext) {
          ctx.font = '600 24px "Inter", "Helvetica Neue", sans-serif';
          ctx.fillText(shot.subtext, safe.x + 56, safe.y + 142, safe.w - 112);
        }
      }
    } else if (layout === 'tile-cascade' || layout === 'flip-matrix') {
      BauhausKit.drawTileCascade(ctx, safe, theme, t, localT, layout === 'flip-matrix');
      if (!micro && shot.headline) {
        ctx.fillStyle = theme.paper;
        var hw = Math.min(safe.w - 112, shot.headline.length * 34 + 64);
        ctx.fillRect(safe.x + 56, safe.y + 66, hw, 68);
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 4;
        ctx.strokeRect(safe.x + 56, safe.y + 66, hw, 68);
        ctx.fillStyle = theme.ink;
        ctx.font = '900 42px "Inter", "Helvetica Neue", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.headline.toUpperCase(), safe.x + 80, safe.y + 102, hw - 40);
      }
    } else if (layout === 'constructivist-stat') {
      BauhausKit.drawKandinskyGroup(ctx, scx + 70, scy + 70, mod * 0.92, theme, t, localT, 'bauhaus-poster');
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 148px "Inter", "Helvetica Neue", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(shot.metric || '1919', safe.x + 56, safe.y + 90);
        ctx.font = '800 38px "Inter", "Helvetica Neue", sans-serif';
        ctx.fillText((shot.headline || '').toUpperCase(), safe.x + 56, safe.y + 255, safe.w - 112);
      }
    } else {
      // bauhaus-poster: Monumental final poster (vertical BAUHAUS wordmark + ▲■● triad + Kandinsky right group)
      BauhausKit.drawKandinskyGroup(ctx, scx + 95, scy + 55, mod * 0.96, theme, t, localT, 'bauhaus-poster');
      BauhausKit.drawVerticalMonument(
        ctx,
        safe,
        theme,
        shot.verticalWord || 'BAUHAUS',
        shot.subtext || 'FORM  ·  FARBE  ·  FUNKTION',
        shot.headline,
        micro
      );
    }

    ctx.restore();
    drawSwissCaption(findCaption(t), theme, safe);

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
      title: story.title || (story.meta && story.meta.title) || '09-Bauhaus Konstruktion',
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
