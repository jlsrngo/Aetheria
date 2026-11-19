(function () {
  'use strict';

  var story = null;
  var hudCtx = null;
  var engine3d = null;
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

  function drawHudCard(x, y, w, h, theme) {
    hudCtx.save();
    hudCtx.shadowColor = 'rgba(15, 23, 42, 0.14)';
    hudCtx.shadowBlur = 24;
    hudCtx.shadowOffsetY = 10;
    SpatialKit.roundRect(hudCtx, x, y, w, h, 30);
    hudCtx.fillStyle = theme.cardBg;
    hudCtx.fill();
    hudCtx.shadowColor = 'transparent';
    hudCtx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    hudCtx.lineWidth = 2;
    hudCtx.stroke();
    hudCtx.restore();
  }

  function drawSpatialCaption(caption, theme, safe) {
    if (!caption || isMicrostock()) return;
    hudCtx.save();
    hudCtx.font = '800 42px "Inter", "Segoe UI", sans-serif';
    var txt = String(caption.text || '').toUpperCase();
    var tw = Math.min(safe.w - 30, hudCtx.measureText(txt).width + 64);
    var bx = safe.x + (safe.w - tw) * 0.5;
    var by = H - 235;
    var bh = 72;
    SpatialKit.roundRect(hudCtx, bx, by, tw, bh, 999);
    hudCtx.fillStyle = theme.accent;
    hudCtx.fill();
    hudCtx.fillStyle = '#FFFFFF';
    hudCtx.textAlign = 'center';
    hudCtx.textBaseline = 'middle';
    hudCtx.fillText(txt, bx + tw * 0.5, by + bh * 0.5 + 2, tw - 32);
    hudCtx.restore();
  }

  function renderShot(shot, t, localT) {
    var theme = SpatialKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;

    // 1. Render Three.js 3D studio scene onto #stage-webgl
    engine3d.render3D(theme, shot.object || 'candy-torus', t, localT);

    // 2. Render clean floating spatial HUD card onto #stage-hud (lower portion so 3D hero shines above!)
    hudCtx.clearRect(0, 0, W, H);
    var micro = isMicrostock();
    var layout = shot.layout || 'spatial-hero';

    var cardH = isPortrait ? 390 : 280;
    var cardW = safe.w;
    var cardX = safe.x;
    var cardY = safe.y + safe.h - cardH;
    var box = { x: cardX, y: safe.y + 80, w: cardW, h: safe.h - 80 };

    if (!micro) {
      if (layout === 'spatial-specs' && shot.items && shot.items.length) {
        var list = shot.items.slice(0, 3);
        cardH = isPortrait ? 440 : 300;
        cardY = safe.y + safe.h - cardH;
        drawHudCard(cardX, cardY, cardW, cardH, theme);
        hudCtx.fillStyle = theme.accent;
        hudCtx.font = '800 32px "Inter", "Segoe UI", sans-serif';
        hudCtx.textAlign = 'left';
        hudCtx.textBaseline = 'middle';
        hudCtx.fillText((shot.headline || '').toUpperCase(), cardX + 44, cardY + 62, cardW - 88);
        for (var r = 0; r < list.length; r++) {
          var ry = cardY + 138 + r * 92;
          hudCtx.fillStyle = theme.accent;
          hudCtx.beginPath();
          hudCtx.arc(cardX + 60, ry, 10, 0, Math.PI * 2);
          hudCtx.fill();
          hudCtx.fillStyle = theme.ink;
          hudCtx.font = '700 32px "Inter", "Segoe UI", sans-serif';
          hudCtx.fillText(list[r].label || '', cardX + 92, ry, cardW - 130);
        }
      } else if (layout === 'spatial-metric') {
        drawHudCard(cardX, cardY, cardW, cardH, theme);
        hudCtx.fillStyle = theme.accent;
        hudCtx.font = '900 116px "Inter", "Segoe UI", sans-serif';
        hudCtx.textAlign = 'center';
        hudCtx.textBaseline = 'middle';
        hudCtx.fillText(shot.metric || '60 FPS', scx, cardY + cardH * 0.42);
        hudCtx.fillStyle = theme.ink;
        hudCtx.font = '800 34px "Inter", "Segoe UI", sans-serif';
        hudCtx.fillText((shot.headline || '').toUpperCase(), scx, cardY + cardH * 0.78, cardW - 80);
      } else {
        drawHudCard(cardX, cardY, cardW, cardH, theme);
        if (shot.badge) {
          hudCtx.fillStyle = theme.accent;
          hudCtx.font = '800 22px "Inter", "Segoe UI", sans-serif';
          hudCtx.textAlign = 'center';
          hudCtx.textBaseline = 'middle';
          hudCtx.fillText(shot.badge.toUpperCase(), scx, cardY + 64);
        }
        hudCtx.fillStyle = theme.ink;
        hudCtx.font = '900 54px "Inter", "Segoe UI", sans-serif';
        hudCtx.textAlign = 'center';
        hudCtx.textBaseline = 'middle';
        var lines = SpatialKit.wrapLines(hudCtx, (shot.headline || '').toUpperCase(), cardW - 96, 2);
        for (var i = 0; i < lines.length; i++) {
          hudCtx.fillText(lines[i], scx, cardY + 150 + i * 62);
        }
        if (shot.subtext) {
          hudCtx.fillStyle = theme.muted;
          hudCtx.font = '500 26px "Inter", "Segoe UI", sans-serif';
          var subs = SpatialKit.wrapLines(hudCtx, shot.subtext, cardW - 110, 2);
          for (var j = 0; j < subs.length; j++) {
            hudCtx.fillText(subs[j], scx, cardY + 296 + j * 34);
          }
        }
      }
      drawSpatialCaption(findCaption(t), theme, safe);
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
    if (!story || !hudCtx || !engine3d) return;
    var shot = findShot(t);
    if (!shot) return;
    renderShot(shot, t, Math.max(0, t - shot.startSec));
  }

  async function init() {
    var glCanvas = document.getElementById('stage-webgl');
    var hudCanvas = document.getElementById('stage-hud');
    if (!glCanvas || !hudCanvas) return;
    var res = await fetch('story.json');
    if (!res.ok) res = await fetch('story.example.json');
    story = await res.json();
    W = (story.meta && story.meta.width) || 1080;
    H = (story.meta && story.meta.height) || 1920;
    glCanvas.width = W;
    glCanvas.height = H;
    hudCanvas.width = W;
    hudCanvas.height = H;
    hudCtx = hudCanvas.getContext('2d');
    engine3d = SpatialKit.createSpatialEngine(glCanvas, W, H);

    var dur = (story.meta && story.meta.durationSec) || 30;
    var fps = (story.meta && story.meta.fps) || 30;
    window.renderAt = renderAt;
    window.__filmMeta = {
      title: (story.meta && story.meta.title) || '3D Spatial Motion',
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
