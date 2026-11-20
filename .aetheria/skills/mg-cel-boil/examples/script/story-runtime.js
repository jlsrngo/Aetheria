/**
 * mg-cel-boil story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-cel-boil',
    defaultTitle: '14-Cel-Boil — Spirit Sketchbook',
    camera: { limits: { maxZoom: 1.26, maxPan: 0.07, maxRollDeg: 2.5 } },
    measureShot: function (env) {
      if (!window.CelBoilKit || typeof window.CelBoilKit.measureShot !== 'function') return null;
      return window.CelBoilKit.measureShot(env.W, env.H, env.safe, env.shot, env.micro);
    },
    renderShot: function (env) {
      if (!env.ctx || !window.CelBoilKit) return null;
      env.ctx.save();
      var camRig = env.camera && env.camera.plan && env.camera.plan.active ? env.camera.rig : null;
      window.CelBoilKit.renderShot(
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
