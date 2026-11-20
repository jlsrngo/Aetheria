/**
 * mg-liquid-fluid story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-liquid-fluid',
    defaultTitle: '11-Liquid-Fluid — Neon Metaballs',
    camera: { limits: { maxZoom: 1.24, maxPan: 0.07, maxRollDeg: 2.0 } },
    measureShot: function (env) {
      if (!window.LiquidKit || typeof window.LiquidKit.measureShot !== 'function') return null;
      return window.LiquidKit.measureShot(env.W, env.H, env.safe, env.shot, env.micro);
    },
    renderShot: function (env) {
      if (!env.ctx || !window.LiquidKit) return null;
      env.ctx.save();
      var camRig = env.camera && env.camera.plan && env.camera.plan.active ? env.camera.rig : null;
      window.LiquidKit.renderShot(
        env.ctx,
        env.W,
        env.H,
        env.safe,
        Object.assign({}, env.shot, { start: env.start, duration: env.duration }),
        env.localTime,
        env.micro,
        camRig
      );
      env.ctx.restore();
      return null;
    }
  });
})();
