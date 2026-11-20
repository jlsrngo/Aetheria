/**
 * Aetheria Declarative Story Runtime Core (`/script/story-core.js`, Core API v1).
 *
 * Single shared runtime kernel served by `aetheria-engine` alongside `aetheria-motion.js`
 * and `three.min.js`. Eliminates duplicated bootstrap, dialect normalization, shot/caption
 * lookup, safe-zone reporting, Mode 'M' (?microstock=1) handling, and deterministic
 * `window.renderAt` / `window.__seek` / `window.__ready` / `window.__filmMeta` /
 * `window.__shotReport` plumbing across declarative `mg-*` skill runtimes.
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function easeOutCubic(x) {
    var c = clamp(x, 0, 1);
    return 1 - Math.pow(1 - c, 3);
  }

  function easeOutExpo(x) {
    var c = clamp(x, 0, 1);
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  }

  function isMicrostock(story, override) {
    var urlFlag = false;
    if (typeof global !== 'undefined' && global.location && global.location.search) {
      urlFlag = global.location.search.indexOf('microstock=1') !== -1;
    }
    var globalFlag = Boolean(typeof global !== 'undefined' && global.__microstockMode);
    var storyFlag = Boolean(story && story.microstockMode);
    return Boolean(urlFlag || globalFlag || override || storyFlag);
  }

  function computeSafeZone(width, height) {
    if (height > width) {
      return { x: 56, y: 80, w: 896, h: 1340, minX: 56, maxX: 952, minY: 80, maxY: 1420 };
    }
    var w = width - 220;
    var h = height - 220;
    return { x: 110, y: 80, w: w, h: h, minX: 110, maxX: 110 + w, minY: 80, maxY: 80 + h };
  }

  function computePortraitRailSafeZone(width, height) {
    if (height > width) {
      var minX = Math.round(width * 0.045);
      var maxX = Math.round(width * (960 / 1080));
      var minY = Math.round(height * (60 / 1920));
      var maxY = Math.round(height * (1440 / 1920));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    }
    var lMinX = Math.round(width * 0.05);
    var lMaxX = Math.round(width * 0.95);
    var lMinY = Math.round(height * 0.06);
    var lMaxY = Math.round(height * 0.88);
    return { x: lMinX, y: lMinY, w: lMaxX - lMinX, h: lMaxY - lMinY, minX: lMinX, maxX: lMaxX, minY: lMinY, maxY: lMaxY };
  }

  function isBoxInsideSafeZone(box, safe) {
    if (!box || !safe) return true;
    var minX = safe.minX !== undefined ? safe.minX : safe.x;
    var maxX = safe.maxX !== undefined ? safe.maxX : safe.x + safe.w;
    var minY = safe.minY !== undefined ? safe.minY : safe.y;
    var maxY = safe.maxY !== undefined ? safe.maxY : safe.y + safe.h;
    return box.minX >= minX && box.maxX <= maxX && box.minY >= minY && box.maxY <= maxY;
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  /**
   * Normalizes legacy Dialect B (`meta`, `startSec`/`endSec`, `captions[]`) into
   * canonical Dialect A (`canvas: { w, h, fps }`, `shots[i]: { start, duration }`,
   * `captions: { enabled, items }`). Idempotent on Dialect A inputs.
   */
  function normalizeStory(raw) {
    if (!raw || typeof raw !== 'object') return { title: 'Untitled', canvas: { w: 1080, h: 1920, fps: 30 }, captions: { enabled: false }, shots: [] };
    var story = Object.assign({}, raw);
    var meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : null;

    var w =
      (raw.canvas && raw.canvas.w) ||
      (meta && (meta.width || meta.w)) ||
      (raw.aspect === '16:9' ? 1920 : 1080);
    var h =
      (raw.canvas && raw.canvas.h) ||
      (meta && (meta.height || meta.h)) ||
      (raw.aspect === '16:9' ? 1080 : 1920);
    var fps =
      (raw.canvas && raw.canvas.fps) ||
      (meta && meta.fps) ||
      raw.fps ||
      30;

    story.canvas = { w: Number(w) || 1080, h: Number(h) || 1920, fps: Number(fps) || 30 };
    if (!story.title && meta && meta.title) story.title = meta.title;
    if (!story.theme && meta && meta.theme) story.theme = meta.theme;

    var rawShots = Array.isArray(raw.shots) ? raw.shots : [];
    story.shots = rawShots.map(function (sh, idx) {
      var s = Object.assign({}, sh);
      if (!s.id) s.id = 'shot' + (idx + 1);
      var st = s.start !== undefined ? Number(s.start) : Number(s.startSec || 0);
      var du =
        s.duration !== undefined
          ? Number(s.duration)
          : s.endSec !== undefined
            ? round3(Number(s.endSec) - st)
            : 4;
      s.start = Number.isFinite(st) ? st : 0;
      s.duration = Number.isFinite(du) && du > 0 ? du : 4;
      return s;
    });

    if (Array.isArray(raw.captions)) {
      var items = raw.captions.map(function (c) {
        var ci = Object.assign({}, c);
        var cs = ci.start !== undefined ? Number(ci.start) : Number(ci.startSec || 0);
        var cd =
          ci.duration !== undefined
            ? Number(ci.duration)
            : ci.endSec !== undefined
              ? round3(Number(ci.endSec) - cs)
              : 2;
        ci.start = Number.isFinite(cs) ? cs : 0;
        ci.duration = Number.isFinite(cd) && cd > 0 ? cd : 2;
        return ci;
      });
      story.captions = { enabled: items.length > 0, items: items };
    } else if (!raw.captions || typeof raw.captions !== 'object') {
      story.captions = { enabled: false };
    }

    return story;
  }

  function findShot(story, t) {
    if (!story || !Array.isArray(story.shots) || !story.shots.length) return null;
    var ts = Number(t) || 0;
    for (var i = 0; i < story.shots.length; i++) {
      var s = story.shots[i];
      var st = s.start !== undefined ? s.start : (s.startSec || 0);
      var du = s.duration !== undefined ? s.duration : Math.max(0.001, (s.endSec || st) - st);
      if (ts >= st && ts < st + du) {
        return { shot: s, index: i, start: st, duration: du, localTime: clamp(ts - st, 0, du) };
      }
    }
    var lastIdx = story.shots.length - 1;
    var last = story.shots[lastIdx];
    var lst = last.start !== undefined ? last.start : (last.startSec || 0);
    var ldu = last.duration !== undefined ? last.duration : Math.max(0.001, (last.endSec || lst) - lst);
    return { shot: last, index: lastIdx, start: lst, duration: ldu, localTime: clamp(ts - lst, 0, ldu) };
  }

  function findCaption(story, t) {
    if (!story || !story.captions) return null;
    if (!Array.isArray(story.captions) && story.captions.enabled === false) return null;
    var items = Array.isArray(story.captions) ? story.captions : (story.captions.items || []);
    var ts = Number(t) || 0;
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var cs = c.start !== undefined ? c.start : (c.startSec || 0);
      var ce = c.duration !== undefined ? cs + c.duration : (c.endSec || cs);
      if (ts >= cs && ts < ce) return c;
    }
    return null;
  }

  function synthesizeWords(text, start, duration) {
    var tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    var step = (Number(duration) || 1) / tokens.length;
    return tokens.map(function (w, idx) {
      return {
        word: w,
        start: round3((Number(start) || 0) + idx * step),
        end: round3((Number(start) || 0) + (idx + 1) * step),
      };
    });
  }

  async function fetchJson(url) {
    try {
      var res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (_err) {
      return null;
    }
  }

  async function loadStory() {
    var raw = await fetchJson('story.json');
    if (!raw) raw = await fetchJson('story.example.json');
    return normalizeStory(raw);
  }

  async function preloadImages(urls) {
    var map = {};
    var unique = Array.from(new Set((urls || []).filter(Boolean)));
    await Promise.all(
      unique.map(function (url) {
        return new Promise(function (resolve) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            map[url] = img;
            resolve();
          };
          img.onerror = function () {
            resolve();
          };
          img.src = url;
        });
      }),
    );
    return map;
  }

  function computeTotalDuration(story) {
    if (story && story.meta && Number(story.meta.durationSec) > 0) {
      return Number(story.meta.durationSec);
    }
    var shots = (story && story.shots) || [];
    var maxEnd = 0;
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      var st = s.start !== undefined ? s.start : (s.startSec || 0);
      var en = s.duration !== undefined ? st + s.duration : (s.endSec || st);
      if (en > maxEnd) maxEnd = en;
    }
    return maxEnd || 30;
  }

  /**
   * Boots a declarative skill runtime with standardized `window.renderAt`, `window.__seek`,
   * `window.__ready`, `window.__filmMeta`, `window.__shotReport`, and Mode 'M' (?microstock=1).
   */
  function boot(config) {
    var cfg = config || {};
    var story = null;
    var canvas = null;
    var ctx = null;
    var W = 1080;
    var H = 1920;
    var fps = 30;
    var totalDuration = 30;
    var currentTime = 0;
    var microOverride = false;
    var customState = null;

    global.__storyRuntimeErrors = global.__storyRuntimeErrors || [];

    function getSafeZone() {
      if (typeof cfg.computeSafeZone === 'function') return cfg.computeSafeZone(W, H);
      return computeSafeZone(W, H);
    }

    function renderAt(t) {
      if (!story) return;
      currentTime = Number(t) || 0;
      var resolved = findShot(story, currentTime);
      if (!resolved) return;

      var safe = getSafeZone();
      var micro = isMicrostock(story, microOverride);
      var caption = micro ? null : findCaption(story, currentTime);
      var errors = [];
      var bbox = null;
      var camRes = null;

      try {
        if (typeof cfg.renderShot === 'function') {
          var env = {
            story: story,
            shot: resolved.shot,
            shotIndex: resolved.index,
            t: currentTime,
            localTime: resolved.localTime,
            start: resolved.start,
            duration: resolved.duration,
            W: W,
            H: H,
            safe: safe,
            canvas: canvas,
            ctx: ctx,
            micro: micro,
            caption: caption,
            state: customState,
            camera: null,
          };

          var camCfg = cfg.camera && typeof cfg.camera === 'object' ? cfg.camera : null;
          var hasCamOptIn = Boolean(
            camCfg &&
              global.StoryCamera &&
              typeof global.StoryCamera.resolve === 'function' &&
              (story.cameraStyle || (resolved.shot && resolved.shot.camera && typeof resolved.shot.camera === 'object'))
          );
          if (hasCamOptIn) {
            var focusBox = typeof cfg.measureShot === 'function' ? cfg.measureShot(env) : null;
            camRes = global.StoryCamera.resolve(story, resolved.shot, resolved.localTime, resolved.duration, {
              W: W,
              H: H,
              safe: safe,
              focusBox: focusBox || null,
              allowAutoDollyOut: camCfg.allowAutoDollyOut !== false,
              limits: camCfg.limits || { maxZoom: 1.32, maxPan: 0.08, maxRollDeg: 3.0 },
            });
            env.camera = camRes;
          }

          if (camRes && camRes.plan && camRes.plan.active && camCfg && camCfg.applyToContext && ctx) {
            if (camCfg.backdrop) {
              ctx.fillStyle = typeof camCfg.backdrop === 'function' ? camCfg.backdrop(env) : camCfg.backdrop;
              ctx.fillRect(0, 0, W, H);
            }
            ctx.save();
            global.StoryCamera.apply2D(ctx, camRes.rig, W, H);
            bbox = cfg.renderShot(env) || null;
            ctx.restore();
          } else {
            bbox = cfg.renderShot(env) || null;
          }
          if (!bbox && typeof cfg.measureShot === 'function') {
            bbox = cfg.measureShot(env) || null;
          }
          if (
            bbox &&
            camRes &&
            camRes.plan &&
            camRes.plan.active &&
            !(camCfg && camCfg.skipBboxProject) &&
            global.StoryCamera &&
            typeof global.StoryCamera.projectBox2D === 'function'
          ) {
            bbox = global.StoryCamera.projectBox2D(bbox, camRes.rig, W, H);
          }
        }
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        errors.push(msg);
        global.__storyRuntimeErrors.push({ skill: cfg.id || 'unknown', t: currentTime, error: msg });
      }

      if (!bbox) {
        bbox = {
          behind: false,
          minX: safe.minX !== undefined ? safe.minX : safe.x,
          minY: safe.minY !== undefined ? safe.minY : safe.y,
          maxX: safe.maxX !== undefined ? safe.maxX : safe.x + safe.w,
          maxY: safe.maxY !== undefined ? safe.maxY : safe.y + safe.h,
          width: safe.w,
          height: safe.h,
        };
      }

      global.__shotReport = global.__shotReport || {};
      global.__shotReport[resolved.shot.id] = {
        shotId: resolved.shot.id,
        t: round3(currentTime),
        localTime: round3(resolved.localTime),
        layout: resolved.shot.layout || null,
        focusBboxInSafeZone: isBoxInsideSafeZone(bbox, safe),
        bbox: bbox,
        overlapCount: 0,
        safeZone: {
          minX: safe.minX !== undefined ? safe.minX : safe.x,
          maxX: safe.maxX !== undefined ? safe.maxX : safe.x + safe.w,
          minY: safe.minY !== undefined ? safe.minY : safe.y,
          maxY: safe.maxY !== undefined ? safe.maxY : safe.y + safe.h,
        },
        errors: errors,
      };
    }

    global.renderAt = renderAt;
    global.__seek = renderAt;

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('keydown', function (e) {
        if (e && (e.key === 'm' || e.key === 'M')) {
          microOverride = !microOverride;
          renderAt(currentTime);
        }
      });
    }

    async function start() {
      story = await loadStory();
      W = story.canvas.w;
      H = story.canvas.h;
      fps = story.canvas.fps;
      totalDuration = computeTotalDuration(story);

      if (cfg.contextType !== 'none' && typeof document !== 'undefined') {
        canvas =
          (cfg.canvasId ? document.getElementById(cfg.canvasId) : null) ||
          document.getElementById('stage-2d') ||
          document.querySelector('canvas');
        if (canvas) {
          canvas.width = W;
          canvas.height = H;
          if (!cfg.contextType || cfg.contextType === '2d') {
            ctx = canvas.getContext('2d');
          }
        }
      }

      if (typeof cfg.init === 'function') {
        customState = await cfg.init({
          story: story,
          canvas: canvas,
          ctx: ctx,
          W: W,
          H: H,
          fps: fps,
          totalDuration: totalDuration,
          safe: getSafeZone(),
        });
      }

      global.__filmMeta = {
        title: story.title || cfg.defaultTitle || cfg.id || 'Untitled',
        width: W,
        height: H,
        fps: fps,
        duration: totalDuration,
        durationInFrames: Math.round(totalDuration * fps),
        scenes: (story.shots || []).map(function (s) {
          return {
            id: s.id,
            title: s.id,
            start: s.start,
            duration: s.duration,
            layout: s.layout,
          };
        }),
      };

      renderAt(0);
      global.__ready = true;
    }

    start();
  }

  global.StoryCore = {
    version: 1,
    clamp: clamp,
    easeOutCubic: easeOutCubic,
    easeOutExpo: easeOutExpo,
    isMicrostock: isMicrostock,
    computeSafeZone: computeSafeZone,
    computePortraitRailSafeZone: computePortraitRailSafeZone,
    isBoxInsideSafeZone: isBoxInsideSafeZone,
    normalizeStory: normalizeStory,
    findShot: findShot,
    findCaption: findCaption,
    synthesizeWords: synthesizeWords,
    fetchJson: fetchJson,
    loadStory: loadStory,
    preloadImages: preloadImages,
    computeTotalDuration: computeTotalDuration,
    boot: boot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
