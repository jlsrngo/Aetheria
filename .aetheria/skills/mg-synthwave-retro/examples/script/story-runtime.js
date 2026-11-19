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

  function drawVhsCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = 'italic 900 44px "Impact", "Arial Black", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 30, ctx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 72;
    SynthwaveKit.drawNeonCard(ctx, bx, by, tw, bh, theme);
    ctx.fillStyle = theme.sunTop;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = SynthwaveKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    SynthwaveKit.drawOutrunBackdrop(ctx, W, H, theme, t);

    var micro = isMicrostock();
    var layout = shot.layout || 'synth-hero';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'synth-hero' || layout === 'synth-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 900 : 660);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.48;
      box = { x: cx, y: cy, w: cw, h: ch };
      SynthwaveKit.drawNeonCard(ctx, cx, cy, cw, ch, theme);
      SynthwaveKit.drawSynthIcon(ctx, shot.icon || 'retro-sun', scx, cy + ch * 0.34, isPortrait ? 250 : 210, theme, t);

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.cyan;
          ctx.font = '700 24px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('▶ ' + shot.badge.toUpperCase(), scx, cy + ch * 0.56);
        }
        SynthwaveKit.drawChromeText(ctx, (shot.headline || '').toUpperCase(), scx, cy + ch * 0.70, isPortrait ? 64 : 72, cw - 96, theme);
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '600 26px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var subs = SynthwaveKit.wrapLines(ctx, shot.subtext, cw - 110, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.86 + j * 34);
          }
        }
      }
    } else if (layout === 'synth-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'ANALOG TAPE', icon: 'cassette-tape' }, { label: 'NEON DRIVE', icon: 'sport-car' }];
      var headH = micro ? 0 : 108;
      if (!micro) {
        SynthwaveKit.drawChromeText(ctx, (shot.headline || '').toUpperCase(), scx, safe.y + 46, 52, safe.w - 40, theme);
      }
      var gap = 28;
      var cardH = (safe.h - headH - gap) * 0.48;
      for (var k = 0; k < 2; k++) {
        var py = safe.y + headH + k * (cardH + gap);
        SynthwaveKit.drawNeonCard(ctx, safe.x, py, safe.w, cardH, theme);
        SynthwaveKit.drawSynthIcon(ctx, items[k].icon || 'neon-palm', scx, py + cardH * 0.42, 175, theme, t + k);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = 'italic 800 36px "Impact", "Arial Black", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'synth-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: '01. CHROME TYPE', icon: 'vhs-play' }, { label: '02. LASER GRID', icon: 'laser-grid' }, { label: '03. SUNSET GLOW', icon: 'retro-sun' }];
      var headH3 = micro ? 0 : 108;
      if (!micro) {
        SynthwaveKit.drawChromeText(ctx, (shot.headline || '').toUpperCase(), scx, safe.y + 46, 50, safe.w - 40, theme);
      }
      var rowGap = 24;
      var rowH = Math.min(256, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        SynthwaveKit.drawNeonCard(ctx, safe.x, ry, safe.w, rowH, theme);
        SynthwaveKit.drawSynthIcon(ctx, list[r].icon || 'laser-grid', safe.x + 120, ry + rowH * 0.5, 106, theme, t + r);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 32px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText((list[r].label || '').toUpperCase(), safe.x + 205, ry + rowH * 0.5, safe.w - 245);
        }
      }
    } else if (layout === 'synth-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      SynthwaveKit.drawNeonCard(ctx, mx, my, mw, mh, theme);
      SynthwaveKit.drawSynthIcon(ctx, shot.icon || 'sport-car', scx, my + mh * 0.28, 180, theme, t);
      if (!micro) {
        SynthwaveKit.drawChromeText(ctx, shot.metric || '1986', scx, my + mh * 0.60, 128, mw - 90, theme);
        ctx.fillStyle = theme.muted;
        ctx.font = '800 34px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var ml = SynthwaveKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 42);
        }
      }
    } else {
      // synth-horizon: 2x2 retro icons deck
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 920 : 660);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      SynthwaveKit.drawNeonCard(ctx, dx, dy, dw, dh, theme);
      var ic = ['retro-sun', 'cassette-tape', 'neon-palm', 'sport-car'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.72) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        SynthwaveKit.drawSynthIcon(ctx, ic[g], gx + tw2 * 0.5, gy + th2 * 0.5 + 14, Math.min(tw2, th2) * 0.58, theme, t + g);
      }
      if (!micro) {
        SynthwaveKit.drawChromeText(ctx, (shot.headline || '').toUpperCase(), scx, dy + dh * 0.85, 50, dw - 80, theme);
      }
    }

    drawVhsCaption(findCaption(t), theme, safe);

    // Subtle VHS scanline overlay
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (var sy = 0; sy < H; sy += 6) {
      ctx.fillRect(0, sy, W, 2);
    }

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
      title: (story.meta && story.meta.title) || 'Synthwave Retro 1986',
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
