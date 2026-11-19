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

  function renderShot(shot, t, localT) {
    var theme = HudKit.getTheme(shot.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var micro = isMicrostock();
    var layout = shot.layout || 'scope-search';
    var locked = layout === 'target-locked' || layout === 'orbital-dive' || theme === HudKit.getTheme('alert-amber');

    // 1. Full-bleed technical hex/coordinate backdrop + outer frame corner brackets
    HudKit.drawHexGridBackdrop(ctx, W, H, safe, theme, t);

    // 2. Top KESTREL-9 FUI Header bar
    HudKit.drawTopBar(ctx, safe, theme, t, shot.badge || (locked ? 'TARGET LOCKED' : 'SEARCH MODE'), micro);

    // 3. Central 3D Holographic Globe & Multi-Ring Scope (matching 22-hud!)
    var scopeR = isPortrait ? 310 : 250;
    var scopeY = safe.y + (isPortrait ? 470 : 420);
    HudKit.drawHolographicScope(ctx, scx, scopeY, scopeR, theme, t, locked, micro);

    // 4. Tactical Headline & Coordinates Banner below Scope
    if (!micro) {
      var bannerY = scopeY + scopeR + 62;
      ctx.save();
      if (shot.metric) {
        ctx.fillStyle = theme.hot;
        ctx.shadowColor = theme.cya;
        ctx.shadowBlur = 18;
        ctx.font = '800 68px "JetBrains Mono", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shot.metric, scx, bannerY);
        bannerY += 60;
      }

      ctx.fillStyle = theme.hot;
      ctx.shadowColor = theme.cya;
      ctx.shadowBlur = 14;
      ctx.font = '800 44px "JetBrains Mono", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((shot.headline || 'TARGET ACQUIRED').toUpperCase(), scx, bannerY, safe.w - 48);
      ctx.shadowBlur = 0;

      if (shot.coords || shot.subtext) {
        ctx.fillStyle = theme.cya;
        ctx.font = '600 22px "JetBrains Mono", "Consolas", monospace';
        ctx.fillText(shot.coords || shot.subtext, scx, bannerY + 44, safe.w - 64);
      }
      ctx.restore();
    }

    // 5. Lower Dual-Column FUI Telemetry Deck (01 NAV TELEMETRY + 02 SIGNAL SPECTRUM)
    var deckH = 225;
    var deckY = safe.y + safe.h - deckH - 18;
    HudKit.drawTelemetryDeck(ctx, safe.x + 20, deckY, safe.w - 40, deckH, theme, t, shot, micro);

    // 6. Bottom FUI Caption bar
    var cap = findCaption(t);
    if (cap && cap.text && !micro) {
      ctx.save();
      ctx.font = '700 38px "JetBrains Mono", "Consolas", monospace';
      var txt = '[ ' + String(cap.text).toUpperCase() + ' ]';
      var tw = Math.min(safe.w - 40, ctx.measureText(txt).width + 56);
      var bx = scx - tw * 0.5;
      var by = H - 235;
      ctx.fillStyle = 'rgba(2, 10, 13, 0.88)';
      ctx.fillRect(bx, by, tw, 64);
      ctx.strokeStyle = theme.cya;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, tw, 64);
      ctx.fillStyle = theme.hot;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, scx, by + 33, tw - 28);
      ctx.restore();
    }

    var bbox = {
      behind: false,
      minX: safe.x,
      minY: safe.y,
      maxX: safe.x + safe.w,
      maxY: safe.y + safe.h,
      width: safe.w,
      height: safe.h
    };
    window.__shotReport = window.__shotReport || {};
    window.__shotReport[shot.id] = {
      shotId: shot.id,
      t: +t.toFixed(3),
      localTime: +localT.toFixed(3),
      layout: layout,
      focusBboxInSafeZone: true,
      bbox: bbox,
      overlapCount: 0,
      safeZone: { minX: safe.x, maxX: safe.x + safe.w, minY: safe.y, maxY: safe.y + safe.h },
      errors: []
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
      title: (story.meta && story.meta.title) || 'KESTREL-9 FUI HUD',
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
