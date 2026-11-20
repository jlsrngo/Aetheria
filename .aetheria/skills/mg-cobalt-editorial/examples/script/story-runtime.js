/**
 * mg-cobalt-editorial story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-cobalt-editorial',
    defaultTitle: 'Cobalt Editorial Showreel',
    renderShot: function (env) {
      if (!env.ctx || !window.CobaltKit) return null;
      env.ctx.save();
      var bbox = window.CobaltKit.renderShot(
        env.ctx,
        env.W,
        env.H,
        env.safe,
        Object.assign({}, env.shot, { start: env.start, duration: env.duration }),
        env.localTime,
        env.t,
        env.story.theme || 'cobalt-beam',
        env.micro,
        env.story
      );
      env.ctx.restore();
      return bbox || null;
    }
  });
})();
