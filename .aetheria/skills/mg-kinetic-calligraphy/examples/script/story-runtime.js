(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function slamScale(x) {
    var c = Math.max(0, Math.min(1, x));
    if (c < 0.6) return 1.25 - (c / 0.6) * 0.25;
    return 1.0;
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

  function drawBrushCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '900 48px "Georgia", "Times New Roman", serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 68);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 74;
    ctx.fillStyle = theme.ink;
    ctx.fillRect(bx, by, tw, bh);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(bx, by, 14, bh);
    ctx.fillStyle = theme.bg === '#0D0D10' || theme.bg === '#14090A' ? '#121212' : '#FAF5EB';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5 + 4, by + bh * 0.5 + 2, tw - 36);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = CalligraphyKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    CalligraphyKit.drawScrollBackdrop(ctx, W, H, theme, t);

    var prog = Math.min(1, localT / 0.9);
    var slam = slamScale(localT / 0.35);
    var micro = isMicrostock();
    var layout = shot.layout || 'brush-hero';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'brush-hero' || layout === 'brush-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 960 : 680);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.5;
      box = { x: cx, y: cy, w: cw, h: ch };
      CalligraphyKit.drawScrollCard(ctx, cx, cy, cw, ch, theme);
      CalligraphyKit.drawMotif(ctx, shot.motif || 'enso-circle', scx, cy + ch * 0.34, isPortrait ? 290 : 230, theme, prog);

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.accent;
          ctx.font = '800 22px "Georgia", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('— ' + shot.badge.toUpperCase() + ' —', scx, cy + ch * 0.58);
        }
        ctx.save();
        ctx.translate(scx, cy + ch * 0.71);
        ctx.scale(slam, slam);
        ctx.fillStyle = theme.ink;
        ctx.font = '900 62px "Georgia", "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = CalligraphyKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), cw - 110, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], 0, (i - (lines.length - 1) * 0.5) * 70);
        }
        ctx.restore();
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '600 26px "Georgia", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var subs = CalligraphyKit.wrapLines(ctx, shot.subtext, cw - 120, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.88 + j * 34);
          }
        }
      }
    } else if (layout === 'brush-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'STROKE', motif: 'enso-circle' }, { label: 'IMPACT', motif: 'katana-slash' }];
      var headH = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 50px "Georgia", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var gap = 28;
      var cardH = (safe.h - headH - gap) * 0.48;
      for (var k = 0; k < 2; k++) {
        var py = safe.y + headH + k * (cardH + gap);
        CalligraphyKit.drawScrollCard(ctx, safe.x, py, safe.w, cardH, theme);
        CalligraphyKit.drawMotif(ctx, items[k].motif || 'brush-wave', scx, py + cardH * 0.42, 180, theme, prog);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '900 36px "Georgia", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'brush-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: '01. INK', motif: 'enso-circle' }, { label: '02. FLOW', motif: 'brush-wave' }, { label: '03. SEAL', motif: 'hanko-seal' }];
      var headH3 = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 48px "Georgia", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var rowGap = 24;
      var rowH = Math.min(260, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        CalligraphyKit.drawScrollCard(ctx, safe.x, ry, safe.w, rowH, theme);
        CalligraphyKit.drawMotif(ctx, list[r].motif || 'spark-kanji', safe.x + 120, ry + rowH * 0.5, 110, theme, prog);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 32px "Georgia", serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(list[r].label || '', safe.x + 210, ry + rowH * 0.5, safe.w - 245);
        }
      }
    } else if (layout === 'brush-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      CalligraphyKit.drawScrollCard(ctx, mx, my, mw, mh, theme);
      CalligraphyKit.drawMotif(ctx, shot.motif || 'hanko-seal', scx, my + mh * 0.28, 175, theme, prog);
      if (!micro) {
        ctx.fillStyle = theme.accent;
        ctx.font = '900 128px "Georgia", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '100%', scx, my + mh * 0.60);
        ctx.fillStyle = theme.ink;
        ctx.font = '800 34px "Georgia", serif';
        var ml = CalligraphyKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 42);
        }
      }
    } else {
      // brush-slash: explosive diagonal brush poster
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 940 : 680);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      CalligraphyKit.drawScrollCard(ctx, dx, dy, dw, dh, theme);
      CalligraphyKit.drawMotif(ctx, 'katana-slash', scx, dy + dh * 0.44, 380, theme, prog);
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 58px "Georgia", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, dy + dh * 0.80, dw - 90);
      }
    }

    drawBrushCaption(findCaption(t), theme, safe);

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
      title: (story.meta && story.meta.title) || 'Kinetic Calligraphy',
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
