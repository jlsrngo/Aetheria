/**
 * mg-shape-morph story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-shape-morph',
    defaultTitle: '02-Shape-Morph — Elastic Studio',
    camera: { limits: { maxZoom: 1.26, maxPan: 0.07, maxRollDeg: 2.5 } },
    measureShot: function (env) {
      if (!window.MorphKit || typeof window.MorphKit.measureShot !== 'function') return null;
      return window.MorphKit.measureShot(env.W, env.H, env.safe, env.shot, env.micro);
    },
    renderShot: function (env) {
      if (!env.ctx || !window.MorphKit) return null;
      env.ctx.save();
      var camRig = env.camera && env.camera.plan && env.camera.plan.active ? env.camera.rig : null;
      window.MorphKit.renderShot(
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
