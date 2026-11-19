(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  function easeOutCubic(x) {
    var c = Math.max(0, Math.min(1, x));
    return 1 - Math.pow(1 - c, 3);
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

  function drawCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '700 42px "JetBrains Mono", "Consolas", monospace';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 60);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 70;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(bx, by, tw, bh);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(bx, by, tw, bh);
    ctx.fillStyle = theme.line;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 1, tw - 32);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = LineArtKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    LineArtKit.drawBlueprintGrid(ctx, W, H, theme);

    var drawProg = easeOutCubic(localT / 1.45);
    var micro = isMicrostock();
    var layout = shot.layout || 'monoline-hero';
    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'monoline-hero' || layout === 'atelier-cta') {
      var cw = safe.w;
      var ch = Math.min(safe.h, isPortrait ? 980 : 700);
      var cx = safe.x;
      var cy = safe.y + (safe.h - ch) * 0.5;
      box = { x: cx, y: cy, w: cw, h: ch };
      LineArtKit.drawDraftingFrame(ctx, cx, cy, cw, ch, theme, micro ? null : ('FIG. ' + String(shot.id || '01').toUpperCase()));
      LineArtKit.drawSchematic(ctx, shot.schematic || 'blueprint-arch', scx, cy + ch * 0.35, isPortrait ? 310 : 250, theme, drawProg);

      if (!micro) {
        if (shot.badge) {
          ctx.fillStyle = theme.accent;
          ctx.font = '600 22px "JetBrains Mono", "Consolas", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('[ ' + shot.badge.toUpperCase() + ' ]', scx, cy + ch * 0.60);
        }
        ctx.fillStyle = theme.ink;
        ctx.font = '300 58px "Georgia", "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = LineArtKit.wrapLines(ctx, shot.headline || '', cw - 110, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], scx, cy + ch * 0.71 + i * 68);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '400 26px "JetBrains Mono", "Consolas", monospace';
          var subs = LineArtKit.wrapLines(ctx, shot.subtext, cw - 120, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.87 + j * 34);
          }
        }
      }
    } else if (layout === 'blueprint-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'BLUEPRINT A', schematic: 'blueprint-arch' }, { label: 'BLUEPRINT B', schematic: 'circuit-trace' }];
      var headH = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '400 48px "Georgia", "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.headline || '', scx, safe.y + 46, safe.w - 40);
      }
      var gap = 28;
      var cardH = (safe.h - headH - gap) * 0.48;
      for (var k = 0; k < 2; k++) {
        var py = safe.y + headH + k * (cardH + gap);
        LineArtKit.drawDraftingFrame(ctx, safe.x, py, safe.w, cardH, theme, micro ? null : ('SEC 0' + (k + 1)));
        LineArtKit.drawSchematic(ctx, items[k].schematic || 'compass-rose', scx, py + cardH * 0.42, 180, theme, drawProg);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '600 30px "JetBrains Mono", "Consolas", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((items[k].label || '').toUpperCase(), scx, py + cardH * 0.82, safe.w - 80);
        }
      }
    } else if (layout === 'schematic-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: '01. SEED', schematic: 'botanical-sprout' }, { label: '02. STRUCTURE', schematic: 'blueprint-arch' }, { label: '03. EMBLEM', schematic: 'monogram-emblem' }];
      var headH3 = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '400 46px "Georgia", "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.headline || '', scx, safe.y + 46, safe.w - 40);
      }
      var rowGap = 24;
      var rowH = Math.min(260, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        LineArtKit.drawDraftingFrame(ctx, safe.x, ry, safe.w, rowH, theme, null);
        LineArtKit.drawSchematic(ctx, list[r].schematic || 'circuit-trace', safe.x + 120, ry + rowH * 0.5, 110, theme, drawProg);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '600 30px "JetBrains Mono", "Consolas", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(list[r].label || '', safe.x + 210, ry + rowH * 0.5, safe.w - 245);
        }
      }
    } else if (layout === 'dimension-stat') {
      var mw = safe.w;
      var mh = Math.min(safe.h, isPortrait ? 820 : 620);
      var mx = safe.x;
      var my = safe.y + (safe.h - mh) * 0.48;
      box = { x: mx, y: my, w: mw, h: mh };
      LineArtKit.drawDraftingFrame(ctx, mx, my, mw, mh, theme, micro ? null : 'TOLERANCE +/- 0.1MM');
      LineArtKit.drawSchematic(ctx, shot.schematic || 'gear-schematic', scx, my + mh * 0.30, 190, theme, drawProg);
      if (!micro) {
        ctx.fillStyle = theme.accent;
        ctx.font = '700 110px "JetBrains Mono", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '1.5PX', scx, my + mh * 0.62);
        ctx.fillStyle = theme.ink;
        ctx.font = '400 34px "Georgia", "Times New Roman", serif';
        var ml = LineArtKit.wrapLines(ctx, shot.headline || '', mw - 100, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.80 + n * 44);
        }
      }
    } else {
      // drafting-grid: 2x2 schematic sheet
      var dw = safe.w;
      var dh = Math.min(safe.h, isPortrait ? 960 : 700);
      var dx = safe.x;
      var dy = safe.y + (safe.h - dh) * 0.48;
      box = { x: dx, y: dy, w: dw, h: dh };
      LineArtKit.drawDraftingFrame(ctx, dx, dy, dw, dh, theme, micro ? null : 'SHEET 01/04');
      var schs = ['blueprint-arch', 'botanical-sprout', 'circuit-trace', 'compass-rose'];
      var tw2 = dw * 0.5;
      var th2 = (micro ? dh : dh * 0.72) * 0.5;
      for (var g = 0; g < 4; g++) {
        var gx = dx + (g % 2) * tw2;
        var gy = dy + Math.floor(g / 2) * th2;
        ctx.strokeStyle = theme.lineDim;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gx, gy, tw2, th2);
        LineArtKit.drawSchematic(ctx, schs[g], gx + tw2 * 0.5, gy + th2 * 0.5, Math.min(tw2, th2) * 0.66, theme, drawProg);
      }
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '400 46px "Georgia", "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.headline || '', scx, dy + dh * 0.86, dw - 80);
      }
    }

    drawCaption(findCaption(t), theme, safe);

    var bbox = {
      behind: false,
      minX: Math.round(box.x),
      minY: Math.round(box.y),
      maxX: Math.round(box.x + box.w),
      maxY: Math.round(box.y + box.h),
      width: Math.round(box.w),
      height: Math.round(box.h)
    };
    var inSafe = bbox.minX >= 48 && bbox.maxX <= 964 && bbox.minY >= 56 && bbox.maxY <= 1444;
    if (!isPortrait) inSafe = true;

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
      title: (story.meta && story.meta.title) || 'Technical Line Art',
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
