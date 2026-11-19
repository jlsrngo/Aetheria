(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function snapEase(x) {
    var c = Math.max(0, Math.min(1, x));
    return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
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

  function drawSwissCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '900 46px "Helvetica Neue", "Arial Black", "Inter", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 64);
    var bx = (W - tw) * 0.5;
    var by = H - 235;
    var bh = 74;
    // Constructivist hard offset shadow block
    ctx.fillStyle = theme.red;
    ctx.fillRect(bx + 8, by + 8, tw, bh);
    ctx.fillStyle = theme.ink;
    ctx.fillRect(bx, by, tw, bh);
    ctx.fillStyle = theme.bg === '#121212' ? '#121212' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, W * 0.5, by + bh * 0.5 + 2, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = BauhausKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };

    BauhausKit.drawSwissGrid(ctx, W, H, theme);

    var enter = snapEase(localT / 0.35);
    var slide = (1 - enter) * 48;
    var micro = isMicrostock();
    var layout = shot.layout || 'bauhaus-poster';

    ctx.save();
    ctx.translate(slide, 0);

    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'bauhaus-poster' || layout === 'manifesto-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 1040 : 760);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.5;
      box = { x: cx, y: cy, w: cw, h: ch };

      // Hard Swiss frame
      BauhausKit.drawBlock(ctx, cx, cy, cw, ch, theme.card, theme.ink, 6);
      // Primary top color band
      BauhausKit.drawBlock(ctx, cx, cy, cw, 26, theme.red, null, 0);
      BauhausKit.drawBlock(ctx, cx + cw * 0.65, cy, cw * 0.35, 26, theme.blue, null, 0);
      BauhausKit.drawBlock(ctx, cx + cw * 0.85, cy, cw * 0.15, 26, theme.yellow, null, 0);

      // Constructivist glyph hero
      BauhausKit.drawGlyph(ctx, shot.glyph || 'quarter-arc', cx + cw * 0.5, cy + ch * 0.34, isPortrait ? 300 : 250, theme, t);

      // Horizontal structural rule
      ctx.fillStyle = theme.ink;
      ctx.fillRect(cx + 48, cy + ch * 0.56, cw - 96, 6);

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.red;
          ctx.font = '700 22px "JetBrains Mono", "Consolas", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(shot.badge.toUpperCase(), cx + 48, cy + ch * 0.62);
        }
        ctx.fillStyle = theme.ink;
        ctx.font = (isPortrait ? '900 66px' : '900 72px') + ' "Helvetica Neue", "Arial Black", "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var lines = BauhausKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), cw - 96, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], cx + 48, cy + ch * 0.72 + i * 74);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.ink;
          ctx.globalAlpha = 0.78;
          ctx.font = '600 26px "Helvetica Neue", "Inter", sans-serif';
          var subs = BauhausKit.wrapLines(ctx, shot.subtext, cw - 96, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], cx + 48, cy + ch * 0.89 + j * 34);
          }
          ctx.globalAlpha = 1;
        }
      }
    } else if (layout === 'swiss-grid-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'FORM', glyph: 'quarter-arc' }, { label: 'FUNKTION', glyph: 'split-circle' }];
      var headH = micro ? 0 : 120;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 56px "Helvetica Neue", "Arial Black", "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), safe.x, safe.y + 52, safe.w);
        ctx.fillRect(safe.x, safe.y + 92, safe.w, 6);
      }
      var gap = 28;
      if (isPortrait) {
        var cardH = (safe.h - headH - gap) * 0.48;
        for (var k = 0; k < 2; k++) {
          var py = safe.y + headH + k * (cardH + gap);
          BauhausKit.drawBlock(ctx, safe.x, py, safe.w, cardH, theme.card, theme.ink, 5);
          BauhausKit.drawBlock(ctx, safe.x, py, 24, cardH, k === 0 ? theme.red : theme.blue, null, 0);
          BauhausKit.drawGlyph(ctx, items[k].glyph || 'bauhaus-tri', safe.x + safe.w * 0.5, py + cardH * 0.42, 180, theme, t + k * 0.5);
          if (!micro) {
            ctx.fillStyle = theme.ink;
            ctx.font = '900 38px "Helvetica Neue", "Arial Black", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((items[k].label || '').toUpperCase(), safe.x + safe.w * 0.5, py + cardH * 0.82, safe.w - 80);
          }
        }
      } else {
        var cardW = (safe.w - gap) * 0.5;
        var cardH2 = safe.h - headH - 20;
        for (var m = 0; m < 2; m++) {
          var px = safe.x + m * (cardW + gap);
          var py2 = safe.y + headH;
          BauhausKit.drawBlock(ctx, px, py2, cardW, cardH2, theme.card, theme.ink, 5);
          BauhausKit.drawBlock(ctx, px, py2, cardW, 20, m === 0 ? theme.red : theme.blue, null, 0);
          BauhausKit.drawGlyph(ctx, items[m].glyph || 'bauhaus-tri', px + cardW * 0.5, py2 + cardH2 * 0.42, 180, theme, t + m * 0.5);
          if (!micro) {
            ctx.fillStyle = theme.ink;
            ctx.font = '900 38px "Helvetica Neue", "Arial Black", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((items[m].label || '').toUpperCase(), px + cardW * 0.5, py2 + cardH2 * 0.80, cardW - 60);
          }
        }
      }
    } else if (layout === 'modular-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: 'GRID', glyph: 'grid-cross' }, { label: 'COLOR', glyph: 'split-circle' }, { label: 'RHYTHM', glyph: 'diagonal-bars' }];
      var headH3 = micro ? 0 : 120;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 52px "Helvetica Neue", "Arial Black", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), safe.x, safe.y + 50, safe.w);
        ctx.fillRect(safe.x, safe.y + 92, safe.w, 6);
      }
      var rowGap = 24;
      var rowH = Math.min(270, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      var barCols = [theme.red, theme.yellow, theme.blue];
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        BauhausKit.drawBlock(ctx, safe.x, ry, safe.w, rowH, theme.card, theme.ink, 5);
        BauhausKit.drawBlock(ctx, safe.x, ry, 28, rowH, barCols[r % 3], null, 0);
        BauhausKit.drawGlyph(ctx, list[r].glyph || 'grid-cross', safe.x + 125, ry + rowH * 0.5, 110, theme, t + r * 0.25);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 34px "Helvetica Neue", "Arial Black", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText((list[r].label || '').toUpperCase(), safe.x + 215, ry + rowH * 0.5, safe.w - 250);
        }
      }
    } else if (layout === 'constructivist-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 860 : 640);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      BauhausKit.drawBlock(ctx, mx, my, mw, mh, theme.card, theme.ink, 6);
      BauhausKit.drawBlock(ctx, mx, my, mw, mh * 0.42, theme.blue, null, 0);
      BauhausKit.drawGlyph(ctx, shot.glyph || 'concentric-ring', mx + mw * 0.5, my + mh * 0.21, 180, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.red;
        ctx.font = '900 132px "Helvetica Neue", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '1919', mx + mw * 0.5, my + mh * 0.62);
        ctx.fillStyle = theme.ink;
        ctx.font = '800 36px "Helvetica Neue", "Arial Black", sans-serif';
        var ml = BauhausKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 96, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], mx + mw * 0.5, my + mh * 0.82 + n * 44);
        }
      }
    } else {
      // diagonal-matrix: 2x2 Bauhaus modular tile composition
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 960 : 720);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      BauhausKit.drawBlock(ctx, dx, dy, dw, dh, theme.card, theme.ink, 6);
      var glyphs = ['quarter-arc', 'split-circle', 'bauhaus-tri', 'diagonal-bars'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.66) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 3;
        ctx.strokeRect(gx, gy, tw2, th2);
        BauhausKit.drawGlyph(ctx, glyphs[g], gx + tw2 * 0.5, gy + th2 * 0.5, Math.min(tw2, th2) * 0.68, theme, t + g * 0.25);
      }
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.fillRect(dx, dy + dh * 0.66, dw, dh * 0.34);
        ctx.fillStyle = theme.yellow;
        ctx.font = '900 54px "Helvetica Neue", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var dl = BauhausKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), dw - 80, 2);
        for (var p = 0; p < dl.length; p++) {
          ctx.fillText(dl[p], dx + dw * 0.5, dy + dh * 0.78 + p * 60);
        }
      }
    }

    ctx.restore();

    drawSwissCaption(findCaption(t), theme, safe);

    var outOfSafe = (
      box.x < safe.x - 4 ||
      box.y < safe.y - 4 ||
      box.x + box.w > safe.x + safe.w + 4 ||
      box.y + box.h > safe.y + safe.h + 4
    );

    var bbox = {
      behind: false,
      minX: Math.round(box.x),
      minY: Math.round(box.y),
      maxX: Math.round(box.x + box.w),
      maxY: Math.round(box.y + box.h),
      width: Math.round(box.w),
      height: Math.round(box.h)
    };
    var inSafe = !outOfSafe;
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
      title: (story.meta && story.meta.title) || 'Bauhaus Swiss',
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
