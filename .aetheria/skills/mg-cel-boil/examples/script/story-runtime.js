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
      if (t >= s.startSec && t < s.endSec) return s;
    }
    return story.shots[story.shots.length - 1];
  }

  function findCaption(t) {
    if (!story || !story.captions) return null;
    for (var i = 0; i < story.captions.length; i++) {
      var c = story.captions[i];
      if (t >= c.startSec && t < c.endSec) return c;
    }
    return null;
  }

  function drawComicCaption(caption, theme, safe, t) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '900 46px "Comic Sans MS", "Trebuchet MS", "Inter", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 74;
    CelBoilKit.drawBoilRect(ctx, bx, by, tw, bh, theme, t, theme.accentB);
    ctx.fillStyle = '#181412';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = CelBoilKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    CelBoilKit.drawPaperBackdrop(ctx, W, H, theme, t);

    var micro = isMicrostock();
    var layout = shot.layout || 'cel-hero';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'cel-hero' || layout === 'cel-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 940 : 680);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.5;
      box = { x: cx, y: cy, w: cw, h: ch };
      CelBoilKit.drawBoilRect(ctx, cx, cy, cw, ch, theme, t, theme.card);
      CelBoilKit.drawSprite(ctx, shot.sprite || 'flame-spirit', scx, cy + ch * 0.34, isPortrait ? 270 : 220, theme, t);

      if (!micro) {
        if (shot.badge) {
          var bw = Math.min(cw - 120, shot.badge.length * 18 + 56);
          CelBoilKit.drawBoilRect(ctx, scx - bw * 0.5, cy + ch * 0.55 - 22, bw, 44, theme, t, theme.accentB);
          ctx.fillStyle = '#181412';
          ctx.font = '800 22px "Trebuchet MS", "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shot.badge.toUpperCase(), scx, cy + ch * 0.55 + 2);
        }
        ctx.fillStyle = theme.ink;
        ctx.font = '900 60px "Trebuchet MS", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = CelBoilKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), cw - 96, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], scx, cy + ch * 0.70 + i * 68);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.ink;
          ctx.globalAlpha = 0.8;
          ctx.font = '700 26px "Trebuchet MS", "Inter", sans-serif';
          var subs = CelBoilKit.wrapLines(ctx, shot.subtext, cw - 110, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.87 + j * 34);
          }
          ctx.globalAlpha = 1;
        }
      }
    } else if (layout === 'cel-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'SQUASH', sprite: 'flame-spirit' }, { label: 'STRETCH', sprite: 'star-burst' }];
      var headH = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 50px "Trebuchet MS", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var gap = 28;
      var cardH = (safe.h - headH - gap) * 0.48;
      for (var k = 0; k < 2; k++) {
        var py = safe.y + headH + k * (cardH + gap);
        CelBoilKit.drawBoilRect(ctx, safe.x, py, safe.w, cardH, theme, t + k * 0.2, theme.card);
        CelBoilKit.drawSprite(ctx, items[k].sprite || 'star-burst', scx, py + cardH * 0.42, 180, theme, t + k * 0.3);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '900 36px "Trebuchet MS", "Arial Black", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'cel-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: 'ON TWOS', sprite: 'pencil-nib' }, { label: 'LINE BOIL', sprite: 'flame-spirit' }, { label: 'SMEAR FX', sprite: 'lightning-zap' }];
      var headH3 = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 48px "Trebuchet MS", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var rowGap = 24;
      var rowH = Math.min(260, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        CelBoilKit.drawBoilRect(ctx, safe.x, ry, safe.w, rowH, theme, t + r * 0.15, theme.card);
        CelBoilKit.drawSprite(ctx, list[r].sprite || 'smoke-puff', safe.x + 120, ry + rowH * 0.5, 110, theme, t + r * 0.25);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 32px "Trebuchet MS", "Inter", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(list[r].label || '', safe.x + 210, ry + rowH * 0.5, safe.w - 245);
        }
      }
    } else if (layout === 'cel-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      CelBoilKit.drawBoilRect(ctx, mx, my, mw, mh, theme, t, theme.card);
      CelBoilKit.drawSprite(ctx, shot.sprite || 'lightning-zap', scx, my + mh * 0.30, 190, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.accentA;
        ctx.font = '900 124px "Trebuchet MS", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '12 FPS', scx, my + mh * 0.62);
        ctx.fillStyle = theme.ink;
        ctx.font = '800 34px "Trebuchet MS", "Inter", sans-serif';
        var ml = CelBoilKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 42);
        }
      }
    } else {
      // cel-strip: 2x2 comic strip panels
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 960 : 700);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      CelBoilKit.drawBoilRect(ctx, dx, dy, dw, dh, theme, t, theme.card);
      var sp = ['flame-spirit', 'star-burst', 'smoke-puff', 'heart-pop'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.72) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        CelBoilKit.drawSprite(ctx, sp[g], gx + tw2 * 0.5, gy + th2 * 0.5, Math.min(tw2, th2) * 0.62, theme, t + g * 0.25);
      }
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 46px "Trebuchet MS", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, dy + dh * 0.86, dw - 80);
      }
    }

    drawComicCaption(findCaption(t), theme, safe, t);

    var bbox = {
      behind: false,
      minX: Math.round(box.x),
      minY: Math.round(box.y),
      maxX: Math.round(box.x + box.w),
      maxY: Math.round(box.y + box.h),
      width: Math.round(box.w),
      height: Math.round(box.h)
    };
    var inSafe = isPortrait ? (bbox.minX >= 48 && bbox.maxX <= 964 && bbox.minY >= 56 && bbox.maxY <= 1444) : true;

    window.__shotReport = window.__shotReport || {};
    window.__shotReport[shot.id] = {
      shotId: shot.id,
      t: +t.toFixed(3),
      localTime: +localT.toFixed(3),
      layout: layout,
      focusBboxInSafeZone: inSafe,
      bbox: bbox,
      overlapCount: 0,
      safeZone: { minX: safe.x, maxX: safe.x + safe.w, minY: safe.y, maxY: safe.y + safe.h },
      errors: inSafe ? [] : ['Outside safe zone']
    };
  }

  function renderAt(t) {
    if (!story || !ctx) return;
    var shot = findShot(t);
    if (!shot) return;
    renderShot(shot, t, Math.max(0, t - shot.startSec));
  }

  async function init() {
    var canvas = document.getElementById('stage-2d') || document.querySelector('canvas');
    if (!canvas) return;
    var res = await fetch('story.json');
    if (!res.ok) res = await fetch('story.example.json');
    story = await res.json();
    W = (story.meta && story.meta.width) || 1080;
    H = (story.meta && story.meta.height) || 1920;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');

    var dur = (story.meta && story.meta.durationSec) || 30;
    var fps = (story.meta && story.meta.fps) || 30;
    window.renderAt = renderAt;
    window.__filmMeta = {
      title: (story.meta && story.meta.title) || 'Cel Boil Hand-Drawn',
      width: W,
      height: H,
      fps: fps,
      duration: dur,
      durationInFrames: Math.round(dur * fps),
      scenes: (story.shots || []).map(function (s) {
        return { id: s.id, title: s.id, start: s.startSec, duration: s.endSec - s.startSec };
      })
    };
    renderAt(0);
    window.__ready = true;
  }

  init();
})();
