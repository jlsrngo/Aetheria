/**
 * mg-isometric story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-isometric',
    defaultTitle: '05-Isometric — Smart City Grid',
    camera: { limits: { maxZoom: 1.32, maxPan: 0.08, maxRollDeg: 3.0 } },
    measureShot: function (env) {
      if (!window.IsometricKit || typeof window.IsometricKit.measureShot !== 'function') return null;
      return window.IsometricKit.measureShot(env.W, env.H, env.safe, env.shot, env.micro);
    },
    renderShot: function (env) {
      if (!env.ctx || !window.IsometricKit) return null;
      env.ctx.save();
      var camRig = env.camera && env.camera.plan && env.camera.plan.active ? env.camera.rig : null;
      window.IsometricKit.renderShot(
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
