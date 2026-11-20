/**
 * mg-3d-spatial story-runtime.js (Core API v1)
 * Dual WebGL + HUD canvas adapter powered by /script/story-core.js.
 */
(function () {
  'use strict';

  window.StoryCore.boot({
    id: 'mg-3d-spatial',
    defaultTitle: '06-3D-Spatial — PBR Product Stage',
    contextType: 'none',
    init: function (env) {
      var webglCanvas = document.getElementById('stage-webgl');
      var hudCanvas = document.getElementById('stage-hud');
      if (webglCanvas) { webglCanvas.width = env.W; webglCanvas.height = env.H; }
      if (hudCanvas) { hudCanvas.width = env.W; hudCanvas.height = env.H; }
      return { webglCanvas: webglCanvas, hudCanvas: hudCanvas };
    },
    renderShot: function (env) {
      if (!env.state || !env.state.webglCanvas || !env.state.hudCanvas || !window.SpatialKit) return null;
      return window.SpatialKit.renderShot(
        env.state.webglCanvas,
        env.state.hudCanvas,
        env.W,
        env.H,
        env.safe,
        Object.assign({}, env.shot, { start: env.start, duration: env.duration }),
        env.localTime,
        env.micro,
        env.story
      ) || null;
    }
  });
})();
