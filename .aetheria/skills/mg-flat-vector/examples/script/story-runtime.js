(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var SUBTITLE_STYLE = {
    style: "neobrutalism",
    wordsPerGroup: 1,
    palette: ["#FFDE59", "#BAE6FD", "#A7F3D0", "#FED7AA"],
    textColor: "#0F172A",
    borderColor: "#0F172A",
    shadowColor: "#0F172A",
    borderWidth: 5,
    shadowOffsetX: 6,
    shadowOffsetY: 6,
    radius: 14,
    tiltDeg: 1.5,
    uppercase: true,
    fontSize: 60,
    y: 1590
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOutBack(p) { var x = clamp(p, 0, 1) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; }

  function computeSafeZone(w, h) {
    return h > w
      ? { minX: Math.round(w * 0.045), maxX: Math.round(w * (960 / 1080)), minY: Math.round(h * (60 / 1920)), maxY: Math.round(h * (1440 / 1920)) }
      : { minX: Math.round(w * 0.05), maxX: Math.round(w * 0.95), minY: Math.round(h * 0.06), maxY: Math.round(h * 0.88) };
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var lines = [], cur = words[0];
    for (var i = 1; i < words.length; i++) {
      var cand = cur + " " + words[i];
      if (ctx.measureText(cand).width <= maxW) cur = cand;
      else {
        lines.push(cur);
        cur = words[i];
        if (maxLines && lines.length >= maxLines - 1) {
          lines.push(words.slice(i).join(" "));
          return lines;
        }
      }
    }
    lines.push(cur);
    return lines;
  }

  function drawTextBlock(ctx, text, cx, cy, maxW, size, color, weight, maxLines) {
    if (!text) return;
    ctx.save();
    var fs = size;
    ctx.font = (weight || "800") + " " + fs + "px 'Inter', 'Segoe UI', sans-serif";
    var lines = wrapLines(ctx, text, maxW, maxLines || 2);
    while (fs > 22 && lines.some(function (l) { return ctx.measureText(l).width > maxW; })) {
      fs -= 4;
      ctx.font = (weight || "800") + " " + fs + "px 'Inter', 'Segoe UI', sans-serif";
      lines = wrapLines(ctx, text, maxW, maxLines || 2);
    }
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var lh = fs * 1.18;
    var y0 = cy - ((lines.length - 1) * lh) / 2;
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y0 + i * lh, maxW);
    ctx.restore();
  }

  function synthesizeWords(caption, dur) {
    var tokens = String(caption || "").trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    var pad = Math.min(0.2, dur * 0.06);
    var step = Math.max(0.4, dur - pad - 0.2) / tokens.length;
    return tokens.map(function (w, i) { return { word: w, start: +(pad + i * step).toFixed(3), end: +(pad + (i + 1) * step).toFixed(3) }; });
  }

  function createFlatPlayer(spec, opts) {
    var kit = GLOBAL_SCOPE.FlatKit;
    var W = Number((spec.canvas && spec.canvas.w) || 1080);
    var H = Number((spec.canvas && spec.canvas.h) || 1920);
    var FPS = Number((spec.canvas && spec.canvas.fps) || 30);
    var sz = computeSafeZone(W, H);
    var canvas = opts.canvas || opts.glCanvas || opts.hudCanvas;
    if (canvas && (canvas.width !== W || canvas.height !== H)) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext("2d");
    var silent = !!opts.isMicrostock;
    var captionsEnabled = !silent && !(spec.captions && spec.captions.enabled === false);
    var shots = Array.isArray(spec.shots) ? spec.shots : [];
    var totalDuration = shots.reduce(function (a, s) { return Math.max(a, Number(s.start || 0) + Number(s.duration || 0)); }, 0.01);
    var customShots = shots.filter(function (s) { return typeof s.custom === "string" && s.custom.trim().length > 0; }).length;
    var storyStats = { customShots: customShots, totalShots: shots.length, customRatio: shots.length ? +(customShots / shots.length).toFixed(3) : 0 };
    var shotWords = {};
    shots.forEach(function (s) { shotWords[s.id] = synthesizeWords(s.caption || "", Number(s.duration || 1)); });

    GLOBAL_SCOPE.__shotReport = {};
    GLOBAL_SCOPE.__storyStats = storyStats;

    function resolveShot(t) {
      var ct = clamp(Number(t) || 0, 0, Math.max(0.001, totalDuration - 0.0001));
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i], s0 = Number(s.start || 0), s1 = s0 + Number(s.duration || 0);
        if (ct >= s0 && ct < s1) return { shot: s, index: i, localTime: ct - s0, globalTime: ct };
      }
      var last = shots[shots.length - 1];
      return { shot: last, index: shots.length - 1, localTime: Math.max(0, ct - Number(last.start || 0)), globalTime: ct };
    }

    function renderAt(t) {
      var res = resolveShot(t);
      var shot = res.shot, lt = res.localTime, gt = res.globalTime, dur = Math.max(0.01, Number(shot.duration || 1));
      var th = kit.drawFlatBackground(ctx, W, H, shot.theme || spec.theme || "clean-light", gt);
      var accent = shot.accentColor || th.accent;
      var accent2 = shot.secondaryColor || th.accent2;
      var sw = sz.maxX - sz.minX, sh = sz.maxY - sz.minY, cx = sz.minX + sw / 2, cy = sz.minY + sh / 2;
      var isPortrait = H > W;
      var ep = clamp(0.45 + easeOutBack(clamp(lt / 0.4, 0, 1)) * 0.55, 0, 1.06);
      var rects = [];
      var layout = shot.layout || "hero-center";

      var customFn = shot.custom && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.getSceneRenderer === "function"
        ? GLOBAL_SCOPE.AM.getSceneRenderer(shot.id, res.index) : null;

      if (customFn) {
        customFn(ctx, lt, dur, shot, GLOBAL_SCOPE.AM, { kit: kit, safeZone: sz, theme: th }, gt);
        rects.push({ x: sz.minX, y: sz.minY, w: sw, h: sh });
      } else if (layout === "hero-center" || layout === "callout-card") {
        var cw = sw - 48, ch = Math.min(sh - 80, isPortrait ? 940 : 680);
        var bx = cx - cw / 2, by = cy - ch / 2;
        kit.drawFlatCard(ctx, bx, by, cw, ch, 32, th, { border: accent, borderWidth: 4 });
        kit.drawFlatIcon(ctx, shot.icon || "dot-flow", cx, by + ch * 0.32, Math.min(cw, ch) * 0.2 * ep, accent, accent2, gt);
        if (!silent) {
          if (shot.badge) {
            ctx.fillStyle = accent;
            ctx.beginPath(); ctx.roundRect(cx - 140, by + ch * 0.56 - 22, 280, 44, 22); ctx.fill();
            drawTextBlock(ctx, String(shot.badge).toUpperCase(), cx, by + ch * 0.56, 250, 22, "#FFFFFF", "800", 1);
          }
          drawTextBlock(ctx, shot.headline || "FLAT VECTOR EXPLAINER", cx, by + ch * 0.72, cw - 80, isPortrait ? 56 : 64, th.ink, "900", 2);
          drawTextBlock(ctx, shot.subheadline, cx, by + ch * 0.87, cw - 96, 26, th.muted, "600", 2);
        }
        rects.push({ x: bx, y: by, w: cw, h: ch });
      } else if (layout === "split-compare") {
        var hdrH = silent ? 0 : 150;
        if (!silent) {
          drawTextBlock(ctx, shot.headline || "PERBANDINGAN", cx, sz.minY + 75, sw - 48, 52, th.ink, "900", 2);
          rects.push({ x: sz.minX + 20, y: sz.minY + 12, w: sw - 40, h: hdrH - 12 });
        }
        var items = Array.isArray(shot.items) && shot.items.length >= 2 ? shot.items.slice(0, 2) : [{ label: "SEBELUM", icon: "clock" }, { label: "SESUDAH", icon: "rocket" }];
        var gap = 24, topY = sz.minY + hdrH + 16, remH = sh - hdrH - 32;
        items.forEach(function (it, idx) {
          var bw = isPortrait ? sw - 48 : (sw - 48 - gap) / 2;
          var bh = isPortrait ? (remH - gap) / 2 : remH;
          var bx = isPortrait ? sz.minX + 24 : sz.minX + 24 + idx * (bw + gap);
          var by = isPortrait ? topY + idx * (bh + gap) : topY;
          kit.drawFlatCard(ctx, bx, by, bw, bh, 28, th, { border: idx === 1 ? accent : th.border, borderWidth: idx === 1 ? 5 : 3 });
          kit.drawFlatIcon(ctx, it.icon || (idx === 0 ? "clock" : "rocket"), bx + bw / 2, by + bh * 0.38, Math.min(bw, bh) * 0.22, idx === 1 ? accent : th.muted, accent2, gt);
          if (!silent) drawTextBlock(ctx, it.label || "", bx + bw / 2, by + bh * 0.76, bw - 48, 34, th.ink, "800", 2);
          rects.push({ x: bx, y: by, w: bw, h: bh });
        });
      } else if (layout === "step-list" || layout === "timeline-flow") {
        var hH = silent ? 0 : 150;
        if (!silent) {
          drawTextBlock(ctx, shot.headline || "TIGA LANGKAH", cx, sz.minY + 75, sw - 48, 52, th.ink, "900", 2);
          rects.push({ x: sz.minX + 20, y: sz.minY + 12, w: sw - 40, h: hH - 12 });
        }
        var steps = Array.isArray(shot.items) && shot.items.length ? shot.items.slice(0, 3) : [{ label: "LANGKAH 1", icon: "bulb" }, { label: "LANGKAH 2", icon: "gear" }, { label: "LANGKAH 3", icon: "check" }];
        var rGap = 24, tY = sz.minY + hH + 16, rH = (sh - hH - 32 - rGap * (steps.length - 1)) / steps.length;
        steps.forEach(function (st, idx) {
          var ry = tY + idx * (rH + rGap);
          kit.drawFlatCard(ctx, sz.minX + 24, ry, sw - 48, rH, 24, th, { border: idx === 0 ? accent : th.border });
          kit.drawFlatIcon(ctx, st.icon || "check", sz.minX + 120, ry + rH / 2, Math.min(60, rH * 0.34), accent, accent2, gt);
          if (!silent) {
            ctx.save();
            ctx.fillStyle = th.ink;
            ctx.font = "800 32px 'Inter', sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(String(st.label || "STEP " + (idx + 1)), sz.minX + 210, ry + rH / 2, sw - 260);
            ctx.restore();
          }
          rects.push({ x: sz.minX + 24, y: ry, w: sw - 48, h: rH });
        });
      } else {
        // stat-counter
        var cw2 = sw - 48, ch2 = Math.min(sh - 80, isPortrait ? 880 : 640);
        var bx2 = cx - cw2 / 2, by2 = cy - ch2 / 2;
        kit.drawFlatCard(ctx, bx2, by2, cw2, ch2, 32, th, { border: accent, borderWidth: 4 });
        kit.drawFlatIcon(ctx, shot.icon || "chart", cx, by2 + ch2 * 0.25, 86, accent, accent2, gt);
        var sv = String(shot.statValue || "85%");
        var mm = sv.match(/^([^0-9.-]*)([0-9.]+)(.*)$/);
        var disp = mm ? mm[1] + Math.round(Number(mm[2]) * clamp(lt / Math.min(1.4, dur * 0.5), 0, 1)) + mm[3] : sv;
        if (!silent) {
          drawTextBlock(ctx, disp, cx, by2 + ch2 * 0.56, cw2 - 80, 112, accent, "900", 1);
          drawTextBlock(ctx, shot.statLabel || shot.headline || "METRIK UTAMA", cx, by2 + ch2 * 0.8, cw2 - 96, 38, th.ink, "800", 2);
        }
        rects.push({ x: bx2, y: by2, w: cw2, h: ch2 });
      }

      if (captionsEnabled && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.drawSubtitles === "function") {
        var words = shotWords[shot.id] || [];
        if (words.length) GLOBAL_SCOPE.AM.drawSubtitles(ctx, words, lt, Object.assign({}, SUBTITLE_STYLE, { y: isPortrait ? 1590 : Math.round(H * 0.9) }));
      }

      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      rects.forEach(function (r) { if (r.x < minX) minX = r.x; if (r.y < minY) minY = r.y; if (r.x + r.w > maxX) maxX = r.x + r.w; if (r.y + r.h > maxY) maxY = r.y + r.h; });
      var bbox = { behind: false, minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY), width: Math.round(maxX - minX), height: Math.round(maxY - minY) };
      var inSafe = bbox.minX >= sz.minX - 6 && bbox.maxX <= sz.maxX + 6 && bbox.minY >= sz.minY - 6 && bbox.maxY <= sz.maxY + 6;
      GLOBAL_SCOPE.__shotReport[shot.id] = { shotId: shot.id, t: +gt.toFixed(3), localTime: +lt.toFixed(3), layout: layout, focusBboxInSafeZone: inSafe, bbox: bbox, overlapCount: 0, safeZone: sz, errors: inSafe ? [] : ["Outside safe zone"] };
      return GLOBAL_SCOPE.__shotReport[shot.id];
    }

    GLOBAL_SCOPE.__filmMeta = { title: spec.title || "Flat Vector Film", width: W, height: H, fps: FPS, duration: totalDuration, durationInFrames: Math.round(totalDuration * FPS), captionsEnabled: captionsEnabled, storyStats: storyStats, scenes: shots.map(function (s) { return { id: s.id, title: s.id, start: s.start, duration: s.duration }; }) };
    GLOBAL_SCOPE.renderAt = renderAt;
    return { renderAt: renderAt };
  }

  function boot(opts) {
    var load = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); };
    return load(opts.storyUrl || "/story.json").catch(function () { return load(opts.fallbackStoryUrl || "/story.example.json"); })
      .then(function (spec) { var p = createFlatPlayer(spec, opts); p.renderAt(0); GLOBAL_SCOPE.__ready = true; return p; });
  }

  GLOBAL_SCOPE.StoryRuntime = { createFlatPlayer: createFlatPlayer, boot: boot };
})();
