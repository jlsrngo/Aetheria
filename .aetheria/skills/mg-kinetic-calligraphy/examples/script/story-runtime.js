/**
 * mg-kinetic-calligraphy story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-kinetic-calligraphy',
    defaultTitle: '08-Kinetic-Calligraphy — Sumi Flow',
    renderShot: function (env) {
      if (!env.ctx || !window.CalligraphyKit) return null;
      env.ctx.save();
      window.CalligraphyKit.renderShot(
        env.ctx,
        env.W,
        env.H,
        env.safe,
        Object.assign({}, env.shot, { start: env.start, duration: env.duration }),
        env.localTime,
        env.micro
      );
      env.ctx.restore();
      return null;
    }
  });
})();
