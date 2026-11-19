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

  function drawArcadeCaption(caption, theme, safe, t) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '900 40px "Courier New", "Consolas", monospace';
    var cursor = (Math.floor(t * 4) % 2 === 0) ? '_' : ' ';
    var txt = '> ' + String(caption.text || '').toUpperCase() + cursor;
    var tw = Math.min(safe.w - 24, ctx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 236;
    var bh = 72;
    PixelKit.drawPixelBox(ctx, bx, by, tw, bh, theme);
    ctx.fillStyle = theme.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 40);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = PixelKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    ctx.imageSmoothingEnabled = false;
    PixelKit.drawArcadeBackdrop(ctx, W, H, theme, t);

    var micro = isMicrostock();
    var layout = shot.layout || 'arcade-title';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'arcade-title' || layout === 'arcade-continue') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 940 : 680);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.5;
      box = { x: cx, y: cy, w: cw, h: ch };
      PixelKit.drawPixelBox(ctx, cx, cy, cw, ch, theme);
      PixelKit.drawPixelSprite(ctx, shot.sprite || 'hero-knight', scx, cy + ch * 0.34, isPortrait ? 224 : 192, theme, t);

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.gold;
          ctx.font = '900 26px "Courier New", "Consolas", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('★ ' + shot.badge.toUpperCase() + ' ★', scx, cy + ch * 0.56);
        }
        ctx.fillStyle = theme.ink;
        ctx.font = '900 54px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = PixelKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), cw - 110, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], scx, cy + ch * 0.69 + i * 62);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '700 24px "Courier New", "Consolas", monospace';
          var typed = shot.subtext.slice(0, Math.max(4, Math.floor(localT * 42)));
          var subs = PixelKit.wrapLines(ctx, typed, cw - 120, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.86 + j * 34);
          }
        }
      }
    } else if (layout === 'arcade-vs') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'P1 HERO', sprite: 'hero-knight' }, { label: 'BOSS SLIME', sprite: 'slime-bounce' }];
      var headH = micro ? 0 : 108;
      if (!micro) {
        ctx.fillStyle = theme.gold;
        ctx.font = '900 46px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var gap = 28;
      var cardH = (safe.h - headH - gap) * 0.48;
      for (var k = 0; k < 2; k++) {
        var py = safe.y + headH + k * (cardH + gap);
        PixelKit.drawPixelBox(ctx, safe.x, py, safe.w, cardH, theme);
        PixelKit.drawPixelSprite(ctx, items[k].sprite || 'slime-bounce', scx, py + cardH * 0.42, 160, theme, t + k * 0.5);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '900 34px "Courier New", "Consolas", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'arcade-quests') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: 'COLLECT COINS', sprite: 'coin-spin' }, { label: 'DEFEAT SLIME', sprite: 'slime-bounce' }, { label: 'OPEN CHEST', sprite: 'treasure-chest' }];
      var headH3 = micro ? 0 : 108;
      if (!micro) {
        ctx.fillStyle = theme.gold;
        ctx.font = '900 44px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var rowGap = 24;
      var rowH = Math.min(256, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        PixelKit.drawPixelBox(ctx, safe.x, ry, safe.w, rowH, theme);
        PixelKit.drawPixelSprite(ctx, list[r].sprite || 'coin-spin', safe.x + 120, ry + rowH * 0.5, 96, theme, t + r * 0.3);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 30px "Courier New", "Consolas", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText((list[r].label || '').toUpperCase(), safe.x + 205, ry + rowH * 0.5, safe.w - 245);
        }
      }
    } else if (layout === 'arcade-highscore') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      PixelKit.drawPixelBox(ctx, mx, my, mw, mh, theme);
      PixelKit.drawPixelSprite(ctx, shot.sprite || 'treasure-chest', scx, my + mh * 0.28, 160, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.gold;
        ctx.font = '900 108px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '99999', scx, my + mh * 0.60);
        ctx.fillStyle = theme.ink;
        ctx.font = '800 32px "Courier New", "Consolas", monospace';
        var ml = PixelKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 40);
        }
      }
    } else {
      // arcade-level: 2x2 inventory/sprite grid
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 940 : 680);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      PixelKit.drawPixelBox(ctx, dx, dy, dw, dh, theme);
      var sp = ['hero-knight', 'coin-spin', 'heart-pixel', 'rocket-8bit'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.72) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        PixelKit.drawPixelSprite(ctx, sp[g], gx + tw2 * 0.5, gy + th2 * 0.5 + 16, 128, theme, t + g * 0.4);
      }
      if (!micro) {
        ctx.fillStyle = theme.gold;
        ctx.font = '900 44px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, dy + dh * 0.85, dw - 80);
      }
    }

    drawArcadeCaption(findCaption(t), theme, safe, t);
    PixelKit.drawScanlines(ctx, W, H);

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
      title: (story.meta && story.meta.title) || 'Pixel Arcade 16-Bit',
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
