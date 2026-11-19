/**
 * mg-paperclip-sticker story-runtime.js (Core API v1)
 * Delegates boot, dialect normalization, safe-zone, Mode 'M', and shot reporting to /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-paperclip-sticker',
    defaultTitle: '03-Paperclip-Sticker — Slap Pack',
    renderShot: function (env) {
      if (!env.ctx || !window.StickerKit) return null;
      env.ctx.save();
      window.StickerKit.renderShot(
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
