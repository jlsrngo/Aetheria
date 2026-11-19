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

  function drawCaptionBar(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    ctx.save();
    ctx.font = '700 44px "Inter", "Segoe UI", system-ui, sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 80, ctx.measureText(txt).width + 64);
    var bx = (W - tw) * 0.5;
    var by = H - 235;
    var bh = 74;
    AuroraKit.roundRectPath(ctx, bx, by, tw, bh, 999);
    ctx.fillStyle = 'rgba(10, 14, 30, 0.72)';
    ctx.fill();
    ctx.strokeStyle = theme.rimA;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, W * 0.5, by + bh * 0.5 + 2, tw - 36);
    ctx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = AuroraKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    AuroraKit.drawAuroraBackdrop(ctx, W, H, theme, t);

    var enter = easeOutCubic(localT / 0.65);
    var rise = (1 - enter) * 28;
    var alpha = Math.min(1, enter * 1.25);
    var micro = isMicrostock();
    var layout = shot.layout || 'glass-hero';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, rise);

    var box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h };

    if (layout === 'glass-hero' || layout === 'glass-cta') {
      var cw = Math.min(safe.w, isPortrait ? 856 : 1240);
      var ch = Math.min(safe.h, isPortrait ? 840 : 660);
      var cx = safe.x + (safe.w - cw) * 0.5;
      var cy = safe.y + (safe.h - ch) * 0.48;
      AuroraKit.drawGlassCard(ctx, cx, cy, cw, ch, theme, t, { radius: 36 });
      box = { x: cx, y: cy, w: cw, h: ch };

      var wSize = isPortrait ? 210 : 190;
      AuroraKit.drawWidget(ctx, shot.widget || 'orb-pulse', scx, cy + ch * 0.28, wSize, theme, t);

      if (!micro) {
        if (shot.badge) {
          AuroraKit.drawGlassPill(ctx, shot.badge.toUpperCase(), scx, cy + ch * 0.52, theme);
        }
        ctx.fillStyle = theme.ink;
        ctx.font = (isPortrait ? '300 60px' : '300 68px') + ' "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = AuroraKit.wrapLines(ctx, shot.headline || '', cw - 110, 2);
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], scx, cy + ch * 0.66 + i * 72);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '400 28px "Inter", "Segoe UI", system-ui, sans-serif';
          var subs = AuroraKit.wrapLines(ctx, shot.subtext, cw - 130, 2);
          for (var j = 0; j < subs.length; j++) {
            ctx.fillText(subs[j], scx, cy + ch * 0.83 + j * 38);
          }
        }
      }
    } else if (layout === 'glass-split') {
      var items = (shot.items && shot.items.length >= 2)
        ? shot.items.slice(0, 2)
        : [{ label: 'LIGHT', widget: 'orb-pulse' }, { label: 'CLARITY', widget: 'spark-prism' }];
      var headH = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '300 52px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.headline || '', scx, safe.y + 48, safe.w - 40);
      }
      var gap = 28;
      if (isPortrait) {
        var cardH = (safe.h - headH - gap) * 0.48;
        for (var k = 0; k < 2; k++) {
          var py = safe.y + headH + k * (cardH + gap);
          AuroraKit.drawGlassCard(ctx, safe.x, py, safe.w, cardH, theme, t + k * 0.8, { radius: 30 });
          AuroraKit.drawWidget(ctx, items[k].widget || 'waveform', scx, py + cardH * 0.42, 160, theme, t + k);
          if (!micro) {
            ctx.fillStyle = theme.ink;
            ctx.font = '600 34px "Inter", "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(items[k].label || '', scx, py + cardH * 0.78, safe.w - 80);
          }
        }
      } else {
        var cardW = (safe.w - gap) * 0.5;
        var cardH2 = safe.h - headH - 30;
        for (var m = 0; m < 2; m++) {
          var px = safe.x + m * (cardW + gap);
          var py2 = safe.y + headH;
          AuroraKit.drawGlassCard(ctx, px, py2, cardW, cardH2, theme, t + m * 0.8, { radius: 30 });
          AuroraKit.drawWidget(ctx, items[m].widget || 'waveform', px + cardW * 0.5, py2 + cardH2 * 0.42, 170, theme, t + m);
          if (!micro) {
            ctx.fillStyle = theme.ink;
            ctx.font = '600 34px "Inter", "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(items[m].label || '', px + cardW * 0.5, py2 + cardH2 * 0.78, cardW - 60);
          }
        }
      }
    } else if (layout === 'glass-stack') {
      var list = (shot.items && shot.items.length)
        ? shot.items.slice(0, 3)
        : [{ label: 'Layer 1', widget: 'orb-pulse' }, { label: 'Layer 2', widget: 'waveform' }, { label: 'Layer 3', widget: 'toggle-grid' }];
      var headH3 = micro ? 0 : 110;
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '300 50px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.headline || '', scx, safe.y + 48, safe.w - 40);
      }
      var rowGap = 24;
      var rowH = Math.min(250, (safe.h - headH3 - rowGap * (list.length - 1)) / list.length);
      for (var r = 0; r < list.length; r++) {
        var ry = safe.y + headH3 + r * (rowH + rowGap);
        var stagger = easeOutCubic((localT - r * 0.14) / 0.55);
        ctx.save();
        ctx.globalAlpha = alpha * stagger;
        ctx.translate((1 - stagger) * 32, 0);
        AuroraKit.drawGlassCard(ctx, safe.x, ry, safe.w, rowH, theme, t + r * 0.6, { radius: 26 });
        AuroraKit.drawWidget(ctx, list[r].widget || 'spark-prism', safe.x + 110, ry + rowH * 0.5, 96, theme, t + r);
        if (!micro) {
          ctx.fillStyle = theme.ink;
          ctx.font = '500 32px "Inter", "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(list[r].label || '', safe.x + 195, ry + rowH * 0.5, safe.w - 230);
        }
        ctx.restore();
      }
    } else if (layout === 'glass-metric') {
      var mw = Math.min(safe.w, isPortrait ? 856 : 1140);
      var mh = Math.min(safe.h, isPortrait ? 780 : 620);
      var mx = safe.x + (safe.w - mw) * 0.5;
      var my = safe.y + (safe.h - mh) * 0.48;
      AuroraKit.drawGlassCard(ctx, mx, my, mw, mh, theme, t, { radius: 36 });
      box = { x: mx, y: my, w: mw, h: mh };
      AuroraKit.drawWidget(ctx, shot.widget || 'metric-ring', scx, my + mh * 0.30, 190, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.accent;
        ctx.font = '700 112px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric || '99.4%', scx, my + mh * 0.60);
        ctx.fillStyle = theme.ink;
        ctx.font = '400 34px "Inter", "Segoe UI", system-ui, sans-serif';
        var ml = AuroraKit.wrapLines(ctx, shot.headline || '', mw - 120, 2);
        for (var n = 0; n < ml.length; n++) {
          ctx.fillText(ml[n], scx, my + mh * 0.78 + n * 42);
        }
      }
    } else {
      // glass-lens: hero glass card + gliding liquid-glass refractive lens
      var lw = Math.min(safe.w, isPortrait ? 856 : 1220);
      var lh = Math.min(safe.h, isPortrait ? 820 : 640);
      var lx = safe.x + (safe.w - lw) * 0.5;
      var ly = safe.y + (safe.h - lh) * 0.48;
      AuroraKit.drawGlassCard(ctx, lx, ly, lw, lh, theme, t, { radius: 36 });
      box = { x: lx, y: ly, w: lw, h: lh };

      AuroraKit.drawWidget(ctx, shot.widget || 'chat-bubble', scx, ly + lh * 0.34, 210, theme, t);
      if (!micro) {
        ctx.fillStyle = theme.ink;
        ctx.font = '300 56px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var ll = AuroraKit.wrapLines(ctx, shot.headline || '', lw - 110, 2);
        for (var q = 0; q < ll.length; q++) {
          ctx.fillText(ll[q], scx, ly + lh * 0.66 + q * 68);
        }
        if (shot.subtext) {
          ctx.fillStyle = theme.muted;
          ctx.font = '400 28px "Inter", "Segoe UI", system-ui, sans-serif';
          ctx.fillText(shot.subtext, scx, ly + lh * 0.84, lw - 120);
        }
      }
      var lensX = lx + lw * (0.28 + 0.44 * (0.5 + 0.5 * Math.sin(t * 1.15)));
      var lensY = ly + lh * 0.34 + Math.cos(t * 0.9) * 26;
      AuroraKit.drawGlassLens(ctx, lensX, lensY, 128, theme, t);
    }

    ctx.restore();

    drawCaptionBar(findCaption(t), theme, safe);

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
      title: (story.meta && story.meta.title) || 'Aurora Glass',
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
