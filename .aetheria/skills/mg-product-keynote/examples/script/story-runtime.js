(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var SUBTITLE_STYLE = {
    style: "clean",
    wordsPerGroup: 3,
    textColor: "#F5F5F7",
    activeColor: "#2997FF",
    fontSize: 44,
    y: 980
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function computeSafeZone(w, h) {
    if (h > w) {
      return {
        minX: Math.round(w * 0.045),
        maxX: Math.round(w * (960 / 1080)),
        minY: Math.round(h * (60 / 1920)),
        maxY: Math.round(h * (1440 / 1920))
      };
    }
    return {
      minX: Math.round(w * 0.05),
      maxX: Math.round(w * 0.95),
      minY: Math.round(h * 0.06),
      maxY: Math.round(h * 0.88)
    };
  }

  function isBoxInsideSafeZone(bbox, sz) {
    if (!bbox) return false;
    return (
      bbox.minX >= sz.minX - 6 &&
      bbox.maxX <= sz.maxX + 6 &&
      bbox.minY >= sz.minY - 6 &&
      bbox.maxY <= sz.maxY + 6
    );
  }

  function synthesizeWords(captionText, duration) {
    if (!captionText || typeof captionText !== "string") return [];
    var tokens = captionText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    var startPad = Math.min(0.2, duration * 0.06);
    var usable = Math.max(0.4, duration - startPad - 0.2);
    var step = usable / tokens.length;
    return tokens.map(function (w, idx) {
      return {
        word: w,
        start: Math.round((startPad + idx * step) * 1000) / 1000,
        end: Math.round((startPad + (idx + 1) * step) * 1000) / 1000
      };
    });
  }

  function createKeynotePlayer(storySpec, opts) {
    var kit = GLOBAL_SCOPE.KeynoteKit;
    var layouts = GLOBAL_SCOPE.KeynoteLayouts;
    if (!kit || !layouts) {
      throw new Error("KeynoteKit/KeynoteLayouts missing; load keynote-kit.js and keynote-layouts.js before story-runtime.js");
    }
    var W = Number((storySpec.canvas && storySpec.canvas.w) || 1920);
    var H = Number((storySpec.canvas && storySpec.canvas.h) || 1080);
    var FPS = Number((storySpec.canvas && storySpec.canvas.fps) || 30);
    var safeZone = computeSafeZone(W, H);
    var canvas = opts.canvas || opts.glCanvas || opts.hudCanvas;
    if (canvas && (canvas.width !== W || canvas.height !== H)) {
      canvas.width = W;
      canvas.height = H;
    }
    var ctx = canvas.getContext("2d");
    var forceSilent = !!opts.isMicrostock;
    var captionsEnabled = !forceSilent && !(storySpec.captions && storySpec.captions.enabled === false);

    var shots = Array.isArray(storySpec.shots) ? storySpec.shots : [];
    var totalDuration = shots.reduce(function (acc, s) {
      return Math.max(acc, Number(s.start || 0) + Number(s.duration || 0));
    }, 0.01);

    var customShotsCount = shots.filter(function (s) {
      return typeof s.custom === "string" && s.custom.trim().length > 0;
    }).length;
    var storyStats = {
      customShots: customShotsCount,
      totalShots: shots.length,
      customRatio: shots.length > 0 ? Math.round((customShotsCount / shots.length) * 1000) / 1000 : 0
    };

    var shotWords = {};
    shots.forEach(function (s) {
      shotWords[s.id] = synthesizeWords(s.caption || "", Number(s.duration || 1));
    });

    var loadedImages = {};
    function preloadImages() {
      if (typeof Image === "undefined") return Promise.resolve();
      var tasks = [];
      shots.forEach(function (s) {
        if (typeof s.image === "string" && s.image.trim()) {
          var src = s.image.trim();
          var url = src.charAt(0) === "/" ? src : "/" + src;
          tasks.push(
            new Promise(function (resolve) {
              var img = new Image();
              img.onload = function () { loadedImages[s.id] = img; resolve(); };
              img.onerror = function () { resolve(); };
              img.src = url;
            })
          );
        }
      });
      return Promise.all(tasks);
    }

    function loadExternalWords() {
      if (typeof fetch !== "function") return Promise.resolve();
      return Promise.all(
        shots.map(function (s) {
          var wordsUrl = (s.audio && s.audio.words) || (storySpec.audio && storySpec.audio.words) || "";
          if (!wordsUrl) return Promise.resolve();
          var clean = wordsUrl.charAt(0) === "/" ? wordsUrl : "/" + wordsUrl;
          return fetch(clean)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && Array.isArray(d.words) && d.words.length > 0) shotWords[s.id] = d.words; })
            .catch(function () {});
        })
      );
    }

    GLOBAL_SCOPE.__shotReport = {};
    GLOBAL_SCOPE.__storyStats = storyStats;

    function resolveShotAt(t) {
      var clampedT = clamp(Number(t) || 0, 0, Math.max(0.001, totalDuration - 0.0001));
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        var s0 = Number(s.start || 0);
        var s1 = s0 + Number(s.duration || 0);
        if (clampedT >= s0 && clampedT < s1) {
          return { shot: s, index: i, localTime: clampedT - s0, globalTime: clampedT };
        }
      }
      var last = shots[shots.length - 1];
      return { shot: last, index: shots.length - 1, localTime: Math.max(0, clampedT - Number(last.start || 0)), globalTime: clampedT };
    }

    function renderAt(t) {
      var res = resolveShotAt(t);
      var shot = res.shot;
      var localT = res.localTime;
      var globalT = res.globalTime;
      var dur = Math.max(0.01, Number(shot.duration || 1));
      var errors = [];

      var enterP = clamp(0.42 + (localT / 0.45) * 0.58, 0, 1);
      var themeName = shot.theme || storySpec.theme || "pearl-studio";
      var theme = kit.drawStudioBackground(ctx, W, H, themeName, globalT);

      // Subtle keynote transition transform on exit (last 0.2s)
      var trans = shot.transition || "zoom-cross";
      ctx.save();
      if (trans === "zoom-cross" && res.index < shots.length - 1 && localT > dur - 0.2) {
        var zp = clamp((localT - (dur - 0.2)) / 0.2, 0, 1);
        ctx.translate(W / 2, H / 2);
        ctx.scale(1 + zp * 0.04, 1 + zp * 0.04);
        ctx.translate(-W / 2, -H / 2);
        ctx.globalAlpha = 1 - zp * 0.35;
      } else if (trans === "slide-push" && res.index < shots.length - 1 && localT > dur - 0.2) {
        var sp = clamp((localT - (dur - 0.2)) / 0.2, 0, 1);
        ctx.translate(-sp * sp * W * 0.18, 0);
        ctx.globalAlpha = 1 - sp * 0.35;
      }

      var customFn =
        shot.custom && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.getSceneRenderer === "function"
          ? GLOBAL_SCOPE.AM.getSceneRenderer(shot.id, res.index)
          : null;

      var hasCamOptIn = Boolean(storySpec.cameraStyle || (shot.camera && typeof shot.camera === "object"));
      var camRes = null;
      if (!customFn && hasCamOptIn && GLOBAL_SCOPE.StoryCamera && typeof GLOBAL_SCOPE.StoryCamera.resolve === "function") {
        var focusBox = typeof layouts.measureShotLayout === "function"
          ? layouts.measureShotLayout(shot, { width: W, height: H, safeZone: safeZone, silentMode: forceSilent })
          : null;
        camRes = GLOBAL_SCOPE.StoryCamera.resolve(storySpec, shot, localT, dur, {
          W: W,
          H: H,
          safe: safeZone,
          focusBox: focusBox,
          allowAutoDollyOut: true,
          limits: { maxZoom: 1.28, maxPan: 0.08, maxRollDeg: 2.8 }
        });
      }

      var layoutResult;
      if (customFn) {
        customFn(ctx, localT, dur, shot, GLOBAL_SCOPE.AM, { kit: kit, safeZone: safeZone, theme: theme }, globalT);
        layoutResult = {
          bbox: { behind: false, minX: safeZone.minX, minY: safeZone.minY, maxX: safeZone.maxX, maxY: safeZone.maxY, width: safeZone.maxX - safeZone.minX, height: safeZone.maxY - safeZone.minY },
          overlapCount: 0
        };
      } else {
        if (camRes && camRes.plan && camRes.plan.active && GLOBAL_SCOPE.StoryCamera) {
          GLOBAL_SCOPE.StoryCamera.apply2D(ctx, camRes.rig, W, H);
        }
        layoutResult = layouts.renderShotLayout(ctx, shot, {
          width: W,
          height: H,
          safeZone: safeZone,
          theme: theme,
          localTime: localT,
          globalT: globalT,
          duration: dur,
          enterP: enterP,
          silentMode: forceSilent,
          heroImage: loadedImages[shot.id] || null
        });
        if (camRes && camRes.plan && camRes.plan.active && layoutResult && layoutResult.bbox && GLOBAL_SCOPE.StoryCamera) {
          layoutResult.bbox = GLOBAL_SCOPE.StoryCamera.projectBox2D(layoutResult.bbox, camRes.rig, W, H);
        }
      }
      ctx.restore();

      if (captionsEnabled && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.drawSubtitles === "function") {
        var words = shotWords[shot.id] || [];
        if (words.length > 0) {
          var subStyle = Object.assign({}, SUBTITLE_STYLE, {
            textColor: theme.ink,
            activeColor: shot.accentColor || theme.accent,
            fontSize: H > W ? 54 : 40,
            y: H > W ? 1600 : Math.round(H * 0.93)
          });
          GLOBAL_SCOPE.AM.drawSubtitles(ctx, words, localT, subStyle);
        }
      }

      var inSafe = isBoxInsideSafeZone(layoutResult.bbox, safeZone);
      if (!inSafe) errors.push("Keynote layout bbox outside safeZone on shot " + shot.id);
      if (layoutResult.overlapCount > 0) errors.push("Keynote overlapCount=" + layoutResult.overlapCount + " on shot " + shot.id);

      GLOBAL_SCOPE.__shotReport[shot.id] = {
        shotId: shot.id,
        t: Math.round(globalT * 1000) / 1000,
        localTime: Math.round(localT * 1000) / 1000,
        layout: shot.layout || "brand-intro",
        theme: themeName,
        focusBboxInSafeZone: inSafe,
        bbox: layoutResult.bbox,
        overlapCount: layoutResult.overlapCount,
        safeZone: safeZone,
        errors: errors
      };
      return GLOBAL_SCOPE.__shotReport[shot.id];
    }

    GLOBAL_SCOPE.__filmMeta = {
      title: storySpec.title || "Product Keynote Showreel",
      width: W,
      height: H,
      fps: FPS,
      duration: totalDuration,
      durationInFrames: Math.round(totalDuration * FPS),
      captionsEnabled: captionsEnabled,
      storyStats: storyStats,
      scenes: shots.map(function (s) {
        return {
          id: s.id,
          title: s.id,
          start: s.start,
          duration: s.duration,
          audio: (s.audio && s.audio.wav) || (storySpec.audio && storySpec.audio.wav) || undefined,
          words: (s.audio && s.audio.words) || (storySpec.audio && storySpec.audio.words) || undefined
        };
      })
    };

    GLOBAL_SCOPE.renderAt = function (t) { return renderAt(t); };

    return {
      renderAt: renderAt,
      loadAssets: function () { return Promise.all([preloadImages(), loadExternalWords()]); }
    };
  }

  function boot(opts) {
    var storyUrl = (opts && opts.storyUrl) || "/story.json";
    var fallbackUrl = (opts && opts.fallbackStoryUrl) || "/story.example.json";
    var fetchJson = function (url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.json();
      });
    };
    return fetchJson(storyUrl)
      .catch(function () { return fetchJson(fallbackUrl); })
      .then(function (spec) {
        var player = createKeynotePlayer(spec, opts);
        return player.loadAssets().then(function () {
          player.renderAt(0);
          GLOBAL_SCOPE.__ready = true;
          return player;
        });
      })
      .catch(function (err) {
        GLOBAL_SCOPE.__storyBootError = String(err && err.message ? err.message : err);
        throw err;
      });
  }

  GLOBAL_SCOPE.StoryRuntime = {
    createKeynotePlayer: createKeynotePlayer,
    boot: boot,
    computeSafeZone: computeSafeZone
  };
})();
