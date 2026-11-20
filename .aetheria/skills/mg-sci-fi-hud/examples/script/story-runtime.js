/**
 * mg-sci-fi-hud story-runtime.js (Core API v1)
 * Skill-specific layout rendering powered by /script/story-core.js.
 */
(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;

  

  function measureHudShot(env) {
    var safe = env.safe;
    var minX = safe.x + 20;
    var maxX = safe.x + safe.w - 20;
    var minY = safe.y + 18;
    var maxY = safe.y + safe.h - 18;
    return {
      behind: false,
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY)
    };
  }

  window.StoryCore.boot({
    id: 'mg-sci-fi-hud',
    defaultTitle: 'KESTREL-9 FUI HUD',
    camera: { limits: { maxZoom: 1.30, maxPan: 0.08, maxRollDeg: 2.5 } },
    measureShot: measureHudShot,
    init: function (env) {
      story = env.story;
      ctx = env.ctx;
      W = env.W;
      H = env.H;
    },
    renderShot: function (env) {
      story = env.story;
      ctx = env.ctx;
      W = env.W;
      H = env.H;
      var shot = env.shot;
      var t = env.t;
      var localT = env.localTime;
      var theme = HudKit.getTheme(shot.theme || story.theme || (story.meta && story.meta.theme));
    var isPortrait = H > W;
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };
    var scx = safe.x + safe.w * 0.5;
    var micro = env.micro;
    var layout = shot.layout || 'scope-search';
    var locked = layout === 'target-locked' || layout === 'orbital-dive' || theme === HudKit.getTheme('alert-amber');

    // 1. Full-bleed technical hex/coordinate backdrop + outer frame corner brackets
    HudKit.drawHexGridBackdrop(ctx, W, H, safe, theme, t);

    ctx.save();
    if (env.camera && env.camera.plan && env.camera.plan.active && window.StoryCamera) {
      window.StoryCamera.apply2D(ctx, env.camera.rig, W, H, { skipBlur: true });
    }

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
    ctx.restore();

    // 6. Bottom FUI Caption bar
    var cap = env.caption;
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

    return measureHudShot(env);
    }
  });
})();
