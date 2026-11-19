(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var SUBTITLE_STYLE = {
    style: "neobrutalism",
    wordsPerGroup: 1,
    palette: ["#FFDE59", "#FAF6EC", "#FDA4AF", "#BAE6FD"],
    textColor: "#1A1A1A",
    borderColor: "#1A1A1A",
    shadowColor: "#1A1A1A",
    borderWidth: 5,
    shadowOffsetX: 7,
    shadowOffsetY: 7,
    radius: 10,
    tiltDeg: 1.8,
    uppercase: true,
    fontSize: 62,
    y: 1600
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function easeOutBack(p) {
    var x = clamp(p, 0, 1) - 1;
    var c1 = 1.70158;
    return 1 + (c1 + 1) * x * x * x + c1 * x * x;
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

  function createCollagePlayer(storySpec, opts) {
    var kit = GLOBAL_SCOPE.CollageKit;
    var layouts = GLOBAL_SCOPE.CollageLayouts;
    if (!kit || !layouts) {
      throw new Error("CollageKit/CollageLayouts missing; load collage-kit.js and collage-layouts.js before story-runtime.js");
    }
    var W = Number((storySpec.canvas && storySpec.canvas.w) || 1080);
    var H = Number((storySpec.canvas && storySpec.canvas.h) || 1920);
    var FPS = Number((storySpec.canvas && storySpec.canvas.fps) || 30);
    var safeZone = computeSafeZone(W, H);
    var canvas = opts.canvas || opts.glCanvas || opts.hudCanvas;
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
              img.onload = function () {
                loadedImages[s.id] = img;
                resolve();
              };
              img.onerror = function () {
                resolve();
              };
              img.src = url;
            })
          );
        }
      });
      return Promise.all(tasks);
    }

    function loadExternalWords() {
      if (typeof fetch !== "function") return Promise.resolve();
      var tasks = shots.map(function (s) {
        var wordsUrl = (s.audio && s.audio.words) || (storySpec.audio && storySpec.audio.words) || "";
        if (!wordsUrl) return Promise.resolve();
        var clean = wordsUrl.charAt(0) === "/" ? wordsUrl : "/" + wordsUrl;
        return fetch(clean)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && Array.isArray(d.words) && d.words.length > 0) shotWords[s.id] = d.words;
          })
          .catch(function () {});
      });
      return Promise.all(tasks);
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

      // Keep t=0 already composed (avoid blank frame 0), settle slap-drop within 0.35s
      var enterP = clamp(0.45 + easeOutBack(clamp(localT / 0.38, 0, 1)) * 0.55, 0, 1.04);
      var themeName = shot.paper || storySpec.theme || "kraft";
      var theme = kit.drawPaperBackground(ctx, W, H, themeName, globalT);

      var customFn =
        shot.custom && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.getSceneRenderer === "function"
          ? GLOBAL_SCOPE.AM.getSceneRenderer(shot.id, res.index)
          : null;

      var layoutResult;
      if (customFn) {
        customFn(ctx, localT, dur, shot, GLOBAL_SCOPE.AM, { kit: kit, safeZone: safeZone }, globalT);
        layoutResult = {
          bbox: { behind: false, minX: safeZone.minX, minY: safeZone.minY, maxX: safeZone.maxX, maxY: safeZone.maxY, width: safeZone.maxX - safeZone.minX, height: safeZone.maxY - safeZone.minY },
          overlapCount: 0
        };
      } else {
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
      }

      // Torn-paper transition sweep at end of shot (last 0.22s)
      var trans = shot.transition || "tear-wipe";
      if (trans === "tear-wipe" && res.index < shots.length - 1 && localT > dur - 0.22) {
        var wp = clamp((localT - (dur - 0.22)) / 0.22, 0, 1);
        kit.drawTornScrap(ctx, -40, H * (1 - wp * 1.15), W + 80, H * 0.35, {
          angle: -0.04,
          fill: "#F4EFE4",
          seed: shot.id + ":wipe",
          style: "newsprint"
        });
      }

      if (captionsEnabled && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.drawSubtitles === "function") {
        var words = shotWords[shot.id] || [];
        if (words.length > 0) {
          var subStyle = Object.assign({}, SUBTITLE_STYLE, { y: H > W ? 1600 : Math.round(H * 0.88) });
          GLOBAL_SCOPE.AM.drawSubtitles(ctx, words, localT, subStyle);
        }
      }

      var inSafe = isBoxInsideSafeZone(layoutResult.bbox, safeZone);
      if (!inSafe) errors.push("Collage layout bbox outside safeZone on shot " + shot.id);
      if (layoutResult.overlapCount > 0) errors.push("Collage overlapCount=" + layoutResult.overlapCount + " on shot " + shot.id);

      GLOBAL_SCOPE.__shotReport[shot.id] = {
        shotId: shot.id,
        t: Math.round(globalT * 1000) / 1000,
        localTime: Math.round(localT * 1000) / 1000,
        layout: shot.layout || "dossier-hero",
        paper: themeName,
        focusBboxInSafeZone: inSafe,
        bbox: layoutResult.bbox,
        overlapCount: layoutResult.overlapCount,
        safeZone: safeZone,
        errors: errors
      };
      return GLOBAL_SCOPE.__shotReport[shot.id];
    }

    GLOBAL_SCOPE.__filmMeta = {
      title: storySpec.title || "Cutout Collage Story",
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

    GLOBAL_SCOPE.renderAt = function (t) {
      return renderAt(t);
    };

    return {
      renderAt: renderAt,
      loadAssets: function () {
        return Promise.all([preloadImages(), loadExternalWords()]);
      }
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
        var player = createCollagePlayer(spec, opts);
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
    createCollagePlayer: createCollagePlayer,
    boot: boot,
    computeSafeZone: computeSafeZone
  };
})();
