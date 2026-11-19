/**
 * mg-cel-boil story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-cel-boil',
    defaultTitle: '14-Cel-Boil — Spirit Sketchbook',
    renderShot: function (env) {
      if (!env.ctx || !window.CelBoilKit) return null;
      env.ctx.save();
      window.CelBoilKit.renderShot(
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
