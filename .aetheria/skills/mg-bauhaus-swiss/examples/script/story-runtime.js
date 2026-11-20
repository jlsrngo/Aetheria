/**
 * mg-bauhaus-swiss story-runtime.js (Core API v1)
 * Skill-specific layout rendering powered by /script/story-core.js.
 */
(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function drawSwissCaption(caption, theme, safe) {
    if (!caption || StoryCore.isMicrostock(story)) return;
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

  function measureBauhausShot(env) {
    var safe = env.safe;
    var shot = env.shot || {};
    var layout = shot.layout || 'bauhaus-poster';
    var scx = safe.x + safe.w * 0.5;
    var scy = safe.y + safe.h * 0.5;
    var mod = env.H > env.W ? 148 : 136;
    var minX = safe.x + 48;
    var maxX = safe.x + safe.w - 48;
    var minY = safe.y + 64;
    var maxY = safe.y + safe.h - 64;
    if (layout === 'kandinsky-assembly' || layout === 'escapement-pivot') {
      minX = Math.max(safe.x + 48, scx - mod * 2.4);
      maxX = Math.min(safe.x + safe.w - 48, scx + mod * 2.4);
      minY = env.micro ? Math.max(safe.y + 64, scy + 40 - mod * 2.2) : safe.y + 64;
      maxY = Math.min(safe.y + safe.h - 64, scy + 40 + mod * 2.2);
    } else if (layout === 'constructivist-stat') {
      minX = safe.x + 52;
      maxX = Math.min(safe.x + safe.w - 48, scx + 70 + mod * 2.1);
      minY = safe.y + 84;
      maxY = Math.min(safe.y + safe.h - 64, scy + 70 + mod * 2.1);
    }
    return {
      behind: false,
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY)
    };
  }

  window.StoryCore.boot({
    id: 'mg-bauhaus-swiss',
    defaultTitle: '09-Bauhaus Konstruktion',
    camera: { limits: { maxZoom: 1.32, maxPan: 0.08, maxRollDeg: 3.0 } },
    measureShot: measureBauhausShot,
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
      var theme = BauhausKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var scy = safe.y + safe.h * 0.5;
    var micro = env.micro;
    var layout = shot.layout || 'bauhaus-poster';

    var beatNum = Math.min(20, Math.floor(t * 2) + 1);
    BauhausKit.drawLithoSheet(ctx, W, H, safe, theme, beatNum, micro);

    ctx.save();
    ctx.beginPath();
    ctx.rect(safe.x, safe.y, safe.w, safe.h);
    ctx.clip();
    if (env.camera && env.camera.plan && env.camera.plan.active && window.StoryCamera) {
      window.StoryCamera.apply2D(ctx, env.camera.rig, W, H);
    }

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
    drawSwissCaption(env.caption, theme, safe);
    return measureBauhausShot(env);
    }
  });
})();
