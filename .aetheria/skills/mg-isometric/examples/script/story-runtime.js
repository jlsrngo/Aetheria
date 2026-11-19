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

  function drawIsoCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '800 42px "Inter", "Segoe UI", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 30, ctx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 72;
    IsometricKit.roundRect(ctx, bx, by, tw, bh, 18);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = IsometricKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    IsometricKit.drawIsoBackdrop(ctx, W, H, theme);

    var micro = isMicrostock();
    var layout = shot.layout || 'iso-hero';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'iso-hero' || layout === 'iso-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 940 : 680);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.48;
      box = { x: cx, y: cy, w: cw, h: ch };
      IsometricKit.drawIsoCard(ctx, cx, cy, cw, ch, theme);
      IsometricKit.drawStructure(ctx, shot.structure || 'smart-tower', scx, cy + ch * 0.34, isPortrait ? 250 : 210, theme, t);

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.accent;
          ctx.font = '800 22px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shot.badge.toUpperCase(), scx, cy + ch * 0.58);
        }
        ctx.fillStyle = theme.ink;
        ctx.font = '900 56px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = IsometricKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), cw - 110, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], scx, cy + ch * 0.70 + i * 66);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '500 26px "Inter", "Segoe UI", sans-serif';
          var subs = IsometricKit.wrapLines(ctx, shot.subtext, cw - 120, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.87 + j * 34);
          }
        }
      }
    } else if (layout === 'iso-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'CLOUD NODE', structure: 'cloud-node' }, { label: 'SERVER RACK', structure: 'server-rack' }];
      var headH = micro ? 0 : 108;
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
        IsometricKit.drawIsoCard(ctx, safe.x, py, safe.w, cardH, theme);
        IsometricKit.drawStructure(ctx, items[k].structure || 'server-rack', scx, py + cardH * 0.42, 175, theme, t + k);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 34px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'iso-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: '01. EDGE', structure: 'cloud-node' }, { label: '02. CORE', structure: 'server-rack' }, { label: '03. GRID', structure: 'energy-grid' }];
      var headH3 = micro ? 0 : 108;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 46px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, safe.y + 46, safe.w - 40);
      }
      var rowGap = 24;
      var rowH = Math.min(256, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        IsometricKit.drawIsoCard(ctx, safe.x, ry, safe.w, rowH, theme);
        IsometricKit.drawStructure(ctx, list[r].structure || 'data-cube', safe.x + 120, ry + rowH * 0.52, 108, theme, t + r);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '800 32px "Inter", "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(list[r].label || '', safe.x + 215, ry + rowH * 0.5, safe.w - 250);
        }
      }
    } else if (layout === 'iso-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      IsometricKit.drawIsoCard(ctx, mx, my, mw, mh, theme);
      IsometricKit.drawStructure(ctx, shot.structure || 'data-cube', scx, my + mh * 0.28, 175, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.accent;
        ctx.font = '900 118px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '99.99%', scx, my + mh * 0.60);
        ctx.fillStyle = theme.ink;
        ctx.font = '800 34px "Inter", "Segoe UI", sans-serif';
        var ml = IsometricKit.wrapLines(ctx, (shot.headline || '').toUpperCase(), mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 42);
        }
      }
    } else {
      // iso-campus: 2x2 miniature isometric city blocks
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 920 : 660);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      IsometricKit.drawIsoCard(ctx, dx, dy, dw, dh, theme);
      var st = ['smart-tower', 'server-rack', 'factory-hub', 'energy-grid'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.72) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        IsometricKit.drawStructure(ctx, st[g], gx + tw2 * 0.5, gy + th2 * 0.54, Math.min(tw2, th2) * 0.54, theme, t + g);
      }
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '900 46px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shot.headline || '').toUpperCase(), scx, dy + dh * 0.85, dw - 80);
      }
    }

    drawIsoCaption(findCaption(t), theme, safe);

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
      title: (story.meta && story.meta.title) || 'Isometric 2.5D',
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
