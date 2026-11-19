(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function slapPop(x) {
    var c = Math.max(0, Math.min(1, x));
    if (c < 0.7) return 0.8 + (c / 0.7) * 0.28;
    return 1.08 - ((c - 0.7) / 0.3) * 0.08;
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

  function drawStickerCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '800 44px "Inter", "Segoe UI", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 74;
    StickerKit.roundRect(ctx, bx, by, tw, bh, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = theme.highlight;
    ctx.fillRect(bx + 14, by + bh * 0.54, tw - 28, 22);
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = StickerKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    StickerKit.drawDeskBackdrop(ctx, W, H, theme);

    var pop = slapPop(localT / 0.35);
    var markProg = Math.min(1, localT / 0.65);
    var micro = isMicrostock();
    var layout = shot.layout || 'sticker-hero';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'sticker-hero' || layout === 'sticker-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 940 : 680);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.5;
      box = { x: cx, y: cy, w: cw, h: ch };

      StickerKit.drawStickerCard(ctx, cx, cy, cw, ch, theme, { tape: true, clip: true });
      ctx.save();
      ctx.translate(scx, cy + ch * 0.34);
      ctx.scale(pop, pop);
      StickerKit.drawDiecutSticker(ctx, shot.sticker || 'phone-diecut', 0, 0, isPortrait ? 250 : 210, theme, t);
      ctx.restore();

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.accent;
          ctx.font = '800 22px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shot.badge.toUpperCase(), scx, cy + ch * 0.56);
        }
        // Highlighter marker sweep behind headline
        var hlW = (cw - 140) * markProg;
        ctx.fillStyle = theme.highlight;
        ctx.fillRect(cx + 70, cy + ch * 0.66 - 14, hlW, 44);

        ctx.fillStyle = theme.ink;
        ctx.font = '900 58px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = StickerKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), cw - 110, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], scx, cy + ch * 0.68 + i * 68);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '600 26px "Inter", "Segoe UI", sans-serif';
          var subs = StickerKit.wrapLines(ctx, shot.subtext, cw - 120, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.86 + j * 34);
          }
        }
      }
    } else if (layout === 'sticker-compare') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'INPUT', sticker: 'chip-diecut' }, { label: 'OUTPUT', sticker: 'battery-diecut' }];
      var headH = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 48px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var gap = 28;
      var cardH = (safe.h - headH - gap) * 0.48;
      for (var k = 0; k < 2; k++) {
        var py = safe.y + headH + k * (cardH + gap);
        StickerKit.drawStickerCard(ctx, safe.x, py, safe.w, cardH, theme, { tape: k === 0, clip: k === 1 });
        StickerKit.drawDiecutSticker(ctx, items[k].sticker || 'globe-diecut', scx, py + cardH * 0.42, 175, theme, t + k);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 34px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'sticker-bars') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: 'Silikon', pct: 85, sticker: 'chip-diecut' }, { label: 'Litium', pct: 64, sticker: 'battery-diecut' }, { label: 'Tembaga', pct: 48, sticker: 'flask-diecut' }];
      var bw = safe.w;
      var bh = Math.min(safe.h, isPortrait ? 980 : 700);
      var bx = safe.x;
      var by = safe.y + (safe.h - bh) * 0.48;
      box = { x: bx, y: by, w: bw, h: bh };
      StickerKit.drawStickerCard(ctx, bx, by, bw, bh, theme, { tape: true });

      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 44px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), bx + 48, by + 84, bw - 96);
      }

      var barStart = by + 160;
      var rowH = (bh - 220) / list.length;
      for (var r = 0; r < list.length; r++) {
        var ry = barStart + r * rowH;
        var pct = Math.max(10, Math.min(100, list[r].pct || 70));
        StickerKit.drawDiecutSticker(ctx, list[r].sticker || 'chip-diecut', bx + 98, ry + rowH * 0.48, 86, theme, t + r);
        var trackX = bx + 172;
        var trackW = bw - 230;
        var fillW = trackW * (pct / 100) * markProg;
        StickerKit.roundRect(ctx, trackX, ry + rowH * 0.52, trackW, 34, 10);
        ctx.fillStyle = theme.bg;
        ctx.fill();
        StickerKit.roundRect(ctx, trackX, ry + rowH * 0.52, Math.max(24, fillW), 34, 10);
        ctx.fillStyle = r === 0 ? theme.accent : theme.accent2;
        ctx.fill();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 3;
        ctx.stroke();
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 28px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(list[r].label || '', trackX, ry + rowH * 0.28, trackW - 80);
          ctx.textAlign = 'right';
          ctx.fillStyle = theme.accent;
          ctx.fillText(pct + '%', trackX + trackW, ry + rowH * 0.28);
        }
      }
    } else if (layout === 'sticker-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      StickerKit.drawStickerCard(ctx, mx, my, mw, mh, theme, { clip: true });
      StickerKit.drawDiecutSticker(ctx, shot.sticker || 'phone-diecut', scx, my + mh * 0.28, 175, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.accent;
        ctx.font = '900 130px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '70+', scx, my + mh * 0.60);
        ctx.fillStyle = theme.ink;
        ctx.font = '800 34px "Inter", "Segoe UI", sans-serif';
        var ml = StickerKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 42);
        }
      }
    } else {
      // sticker-grid: 2x2 periodic / explainer sticker deck
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 960 : 700);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      StickerKit.drawStickerCard(ctx, dx, dy, dw, dh, theme, { tape: true, clip: true });
      var st = ['phone-diecut', 'chip-diecut', 'globe-diecut', 'battery-diecut'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.72) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        StickerKit.drawDiecutSticker(ctx, st[g], gx + tw2 * 0.5, gy + th2 * 0.5 + 10, Math.min(tw2, th2) * 0.58, theme, t + g * 0.4);
      }
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 44px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, dy + dh * 0.86, dw - 80);
      }
    }

    drawStickerCaption(findCaption(t), theme, safe);

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
      title: (story.meta && story.meta.title) || 'PaperClip Sticker Explainer',
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
