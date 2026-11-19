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

  window.StoryCore.boot({
    id: 'mg-bauhaus-swiss',
    defaultTitle: '09-Bauhaus Konstruktion',
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
