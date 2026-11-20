(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var LAYOUT_PRESETS = [
    "brand-intro",
    "hero-device",
    "bento-grid",
    "spec-counter",
    "feature-spotlight",
    "ui-showcase",
    "split-compare",
    "cta-outro"
  ];

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function easeOutCubic(p) {
    var x = 1 - clamp(p, 0, 1);
    return 1 - x * x * x;
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    var lines = [];
    var cur = words[0];
    for (var i = 1; i < words.length; i++) {
      var cand = cur + " " + words[i];
      if (ctx.measureText(cand).width <= maxW) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = words[i];
        if (maxLines && lines.length >= maxLines - 1) {
          var rest = words.slice(i).join(" ");
          while (rest.length > 3 && ctx.measureText(rest + "...").width > maxW) rest = rest.slice(0, -1).trim();
          lines.push(ctx.measureText(rest).width <= maxW ? rest : rest + "...");
          return lines;
        }
      }
    }
    lines.push(cur);
    return lines;
  }

  function drawEyebrowPill(ctx, cx, cy, text, accent, dark, silent) {
    if (silent || !text) return null;
    ctx.save();
    ctx.font = "700 22px 'Inter', 'Segoe UI', sans-serif";
    var label = String(text).toUpperCase();
    var w = Math.min(540, ctx.measureText(label).width + 44);
    var h = 42;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 21);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.08)" : "rgba(0,113,227,0.10)";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 1, w - 24);
    ctx.restore();
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }

  function drawCenteredText(ctx, text, cx, y, maxW, fontSize, color, weight, maxLines) {
    if (!text) return 0;
    ctx.save();
    var fs = fontSize;
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
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, y + i * lh, maxW);
    }
    ctx.restore();
    return lines.length * lh;
  }

  function boxesOverlap(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w - 4 && a.x + a.w > b.x + 4 && a.y < b.y + b.h - 4 && a.y + a.h > b.y + 4;
  }

  function unionBox(rects) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (!r) continue;
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    if (!Number.isFinite(minX)) return null;
    return {
      behind: false,
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY)
    };
  }

  function renderShotLayout(ctx, shot, state) {
    var kit = GLOBAL_SCOPE.KeynoteKit;
    var sz = state.safeZone;
    var safeW = sz.maxX - sz.minX;
    var safeH = sz.maxY - sz.minY;
    var cx = sz.minX + safeW / 2;
    var cy = sz.minY + safeH / 2;
    var isPortrait = state.height > state.width;
    var th = state.theme;
    var accent = shot.accentColor || th.accent;
    var accent2 = shot.secondaryColor || th.accent2;
    var silent = state.silentMode;
    var ep = easeOutCubic(state.enterP);
    var rects = [];
    var layout = shot.layout || "brand-intro";

    if (layout === "brand-intro") {
      var cardW = Math.min(safeW - 40, isPortrait ? 840 : 1260);
      var cardH = Math.min(safeH - 60, isPortrait ? 760 : 620);
      var bx = cx - cardW / 2, by = cy - cardH / 2;
      kit.drawGlassCard(ctx, bx, by, cardW, cardH, 36, th, { sheenP: (state.localTime * 0.4) % 1 });
      var iconR = isPortrait ? 76 : 84;
      kit.drawKeynoteIcon(ctx, shot.icon || "spark", cx, by + cardH * 0.28 + (1 - ep) * 24, iconR, accent, accent2);
      if (!silent) {
        drawEyebrowPill(ctx, cx, by + cardH * 0.5, shot.eyebrow || "INTRODUCING", accent, th.dark, silent);
        drawCenteredText(ctx, shot.headline || "AETHERIA PRO", cx, by + cardH * 0.68, cardW - 96, isPortrait ? 68 : 88, th.ink, "900", 2);
        drawCenteredText(ctx, shot.subheadline || "Dirancang presisi untuk kreator modern.", cx, by + cardH * 0.86, cardW - 120, isPortrait ? 28 : 32, th.muted, "500", 2);
      }
      rects.push({ x: bx, y: by, w: cardW, h: cardH });
    } else if (layout === "hero-device") {
      var topH = silent ? 0 : isPortrait ? 240 : 190;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 42, shot.eyebrow, accent, th.dark, silent);
        drawCenteredText(ctx, shot.headline || "PERFORMA GENERASI BARU", cx, sz.minY + 124, safeW - 48, isPortrait ? 56 : 64, th.ink, "900", 2);
        drawCenteredText(ctx, shot.subheadline, cx, sz.minY + 194, safeW - 80, isPortrait ? 26 : 28, th.muted, "500", 1);
        rects.push({ x: sz.minX + 20, y: sz.minY + 12, w: safeW - 40, h: topH - 12 });
      }
      var devTop = sz.minY + topH + 16;
      var devH = safeH - topH - 32;
      var devW = safeW - 48;
      kit.drawDeviceMockup(ctx, shot.device || "laptop", cx, devTop + devH / 2 + (1 - ep) * 40, devW, devH, th, {
        accent: accent, accent2: accent2, localTime: state.localTime, imageObj: state.heroImage
      });
      rects.push({ x: sz.minX + 24, y: devTop, w: devW, h: devH });
    } else if (layout === "bento-grid") {
      var headerH = silent ? 0 : isPortrait ? 180 : 150;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 34, shot.eyebrow, accent, th.dark, silent);
        drawCenteredText(ctx, shot.headline || "SEMUA DALAM SATU SISTEM", cx, sz.minY + 106, safeW - 48, isPortrait ? 50 : 58, th.ink, "900", 2);
        rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: headerH - 8 });
      }
      var items = Array.isArray(shot.items) && shot.items.length > 0 ? shot.items.slice(0, 4) : [
        { stat: "3.2×", label: "Render Lebih Cepat", icon: "bolt" },
        { stat: "100%", label: "Lokal & Privat", icon: "shield" },
        { stat: "4K", label: "Kualitas Studio", icon: "spark" },
        { stat: "0", label: "Biaya Cloud", icon: "check" }
      ];
      var cols = 2;
      var rows = Math.ceil(items.length / cols);
      var gap = 24;
      var gridTop = sz.minY + headerH + 16;
      var gridH = safeH - headerH - 28;
      var cw = (safeW - 48 - gap * (cols - 1)) / cols;
      var ch = (gridH - gap * (rows - 1)) / rows;
      items.forEach(function (it, idx) {
        var c = idx % cols, r = Math.floor(idx / cols);
        var bx = sz.minX + 24 + c * (cw + gap);
        var by = gridTop + r * (ch + gap);
        var sp = easeOutCubic(clamp((state.localTime - idx * 0.16) / 0.42, 0, 1));
        var offY = (1 - sp) * 32;
        kit.drawGlassCard(ctx, bx, by + offY, cw, ch, 28, th, { sheenP: ((state.localTime + idx * 0.2) * 0.3) % 1 });
        kit.drawKeynoteIcon(ctx, it.icon || "spark", bx + cw / 2, by + offY + ch * 0.28, Math.min(cw, ch) * 0.16, accent, accent2);
        if (!silent) {
          if (it.stat) drawCenteredText(ctx, it.stat, bx + cw / 2, by + offY + ch * 0.6, cw - 36, isPortrait ? 52 : 58, accent, "900", 1);
          if (it.label) drawCenteredText(ctx, it.label, bx + cw / 2, by + offY + ch * 0.82, cw - 40, isPortrait ? 24 : 26, th.ink, "700", 2);
        }
        rects.push({ x: bx, y: by, w: cw, h: ch });
      });
    } else if (layout === "spec-counter") {
      var scW = Math.min(safeW - 40, isPortrait ? 840 : 1240);
      var scH = Math.min(safeH - 60, isPortrait ? 820 : 620);
      var sx = cx - scW / 2, sy = cy - scH / 2;
      kit.drawGlassCard(ctx, sx, sy, scW, scH, 36, th, { sheenP: (state.localTime * 0.35) % 1 });
      var rawStat = String(shot.statValue || "2.4×");
      var m = rawStat.match(/^([^0-9.-]*)([0-9.]+)(.*)$/);
      var disp = rawStat;
      var frac = clamp(state.localTime / Math.min(1.5, state.duration * 0.5), 0, 1);
      if (m) {
        var target = Number(m[2]);
        var hasDec = m[2].indexOf(".") !== -1;
        var cur = target * easeOutCubic(frac);
        disp = m[1] + (hasDec ? cur.toFixed(1) : Math.round(cur)) + m[3];
      }
      // Progress ring arc
      var ringR = Math.min(scW, scH) * 0.26;
      ctx.save();
      ctx.strokeStyle = th.dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.08)";
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, sy + scH * 0.42, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, sy + scH * 0.42, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.82 * easeOutCubic(frac));
      ctx.stroke();
      ctx.restore();
      if (!silent) {
        drawEyebrowPill(ctx, cx, sy + 56, shot.eyebrow || "BENCHMARK", accent, th.dark, silent);
        drawCenteredText(ctx, disp, cx, sy + scH * 0.42, ringR * 1.75, isPortrait ? 88 : 104, th.ink, "900", 1);
        drawCenteredText(ctx, shot.statLabel || shot.headline || "LEBIH EFISIEN", cx, sy + scH * 0.78, scW - 96, isPortrait ? 38 : 44, th.ink, "800", 2);
        drawCenteredText(ctx, shot.subheadline, cx, sy + scH * 0.9, scW - 120, 24, th.muted, "500", 1);
      }
      rects.push({ x: sx, y: sy, w: scW, h: scH });
    } else if (layout === "feature-spotlight") {
      var fw = Math.min(safeW - 40, isPortrait ? 840 : 1260);
      var fh = Math.min(safeH - 60, isPortrait ? 820 : 620);
      var fx = cx - fw / 2, fy = cy - fh / 2;
      kit.drawGlassCard(ctx, fx, fy, fw, fh, 36, th, { sheenP: (state.localTime * 0.3) % 1 });
      // Pedestal circle
      var pedR = isPortrait ? 120 : 112;
      ctx.save();
      var pg = ctx.createRadialGradient(cx, fy + fh * 0.34, 12, cx, fy + fh * 0.34, pedR * 1.4);
      pg.addColorStop(0, th.glow);
      pg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(cx, fy + fh * 0.34, pedR * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      kit.drawKeynoteIcon(ctx, shot.icon || "shield", cx, fy + fh * 0.34 + (1 - ep) * 20, pedR * 0.72, accent, accent2);
      if (!silent) {
        drawEyebrowPill(ctx, cx, fy + fh * 0.56, shot.eyebrow, accent, th.dark, silent);
        drawCenteredText(ctx, shot.headline || "FITUR UNGGULAN", cx, fy + fh * 0.72, fw - 96, isPortrait ? 56 : 68, th.ink, "900", 2);
        drawCenteredText(ctx, shot.subheadline, cx, fy + fh * 0.87, fw - 120, isPortrait ? 26 : 30, th.muted, "500", 2);
      }
      rects.push({ x: fx, y: fy, w: fw, h: fh });
    } else if (layout === "ui-showcase") {
      var uTopH = silent ? 0 : isPortrait ? 200 : 160;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 34, shot.eyebrow, accent, th.dark, silent);
        drawCenteredText(ctx, shot.headline || "ANTARMUKA INTUITIF", cx, sz.minY + 110, safeW - 48, isPortrait ? 52 : 60, th.ink, "900", 2);
        rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: uTopH - 8 });
      }
      var uiTop = sz.minY + uTopH + 16;
      var uiH = safeH - uTopH - 32;
      var uiW = Math.min(safeW - 48, isPortrait ? 820 : 1280);
      var ux = cx - uiW / 2;
      kit.drawGlassCard(ctx, ux, uiTop, uiW, uiH, 30, th, { sheenP: (state.localTime * 0.3) % 1 });
      var rowsList = Array.isArray(shot.items) && shot.items.length > 0 ? shot.items.slice(0, 3) : [
        { label: "Analisis Otomatis", stat: "Aktif", icon: "spark" },
        { label: "Sinkronisasi Beat", stat: "30 fps", icon: "wave" },
        { label: "Ekspor Studio", stat: "Siap", icon: "check" }
      ];
      var rGap = 20;
      var rH = (uiH - 96 - rGap * (rowsList.length - 1)) / rowsList.length;
      rowsList.forEach(function (row, idx) {
        var ry = uiTop + 48 + idx * (rH + rGap);
        var active = Math.floor((state.localTime / Math.max(0.5, state.duration)) * rowsList.length) === idx;
        kit.drawGlassCard(ctx, ux + 36, ry, uiW - 72, rH, 20, th, {
          border: active ? accent : th.cardBorder,
          borderWidth: active ? 3 : 1.5,
          shadowBlur: active ? 24 : 8
        });
        kit.drawKeynoteIcon(ctx, row.icon || "check", ux + 96, ry + rH / 2, Math.min(34, rH * 0.28), accent, accent2);
        if (!silent) {
          ctx.save();
          ctx.fillStyle = th.ink;
          ctx.font = "700 " + (isPortrait ? 28 : 30) + "px 'Inter', sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(String(row.label || ""), ux + 150, ry + rH / 2, uiW - 340);
          if (row.stat) {
            ctx.fillStyle = accent;
            ctx.textAlign = "right";
            ctx.fillText(String(row.stat), ux + uiW - 64, ry + rH / 2);
          }
          ctx.restore();
        }
      });
      rects.push({ x: ux, y: uiTop, w: uiW, h: uiH });
    } else if (layout === "split-compare") {
      var sTopH = silent ? 0 : isPortrait ? 190 : 150;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 34, shot.eyebrow, accent, th.dark, silent);
        drawCenteredText(ctx, shot.headline || "PERBEDAAN NYATA", cx, sz.minY + 108, safeW - 48, isPortrait ? 52 : 60, th.ink, "900", 2);
        rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: sTopH - 8 });
      }
      var pair = Array.isArray(shot.items) && shot.items.length >= 2 ? shot.items.slice(0, 2) : [
        { stat: "Lama", label: "Manual & Lambat", icon: "layers" },
        { stat: "Baru", label: "Otomatis & Presisi", icon: "bolt" }
      ];
      var bodyT = sz.minY + sTopH + 16;
      var bodyH = safeH - sTopH - 32;
      var gapS = 24;
      pair.forEach(function (it, idx) {
        var bx, by, bw, bh;
        if (isPortrait) {
          bw = safeW - 48;
          bh = (bodyH - gapS) / 2;
          bx = sz.minX + 24;
          by = bodyT + idx * (bh + gapS);
        } else {
          bw = (safeW - 48 - gapS) / 2;
          bh = bodyH;
          bx = sz.minX + 24 + idx * (bw + gapS);
          by = bodyT;
        }
        var isHero = idx === 1;
        kit.drawGlassCard(ctx, bx, by, bw, bh, 30, th, {
          border: isHero ? accent : th.cardBorder,
          borderWidth: isHero ? 3 : 1.5,
          sheenP: isHero ? (state.localTime * 0.35) % 1 : undefined
        });
        kit.drawKeynoteIcon(ctx, it.icon || (isHero ? "bolt" : "layers"), bx + bw / 2, by + bh * 0.3, Math.min(bw, bh) * 0.16, isHero ? accent : th.muted, accent2);
        if (!silent) {
          if (it.stat) drawCenteredText(ctx, it.stat, bx + bw / 2, by + bh * 0.62, bw - 48, isPortrait ? 52 : 60, isHero ? accent : th.muted, "900", 1);
          if (it.label) drawCenteredText(ctx, it.label, bx + bw / 2, by + bh * 0.82, bw - 60, isPortrait ? 26 : 30, th.ink, "700", 2);
        }
        rects.push({ x: bx, y: by, w: bw, h: bh });
      });
    } else {
      // cta-outro
      var ow = Math.min(safeW - 40, isPortrait ? 840 : 1200);
      var oh = Math.min(safeH - 60, isPortrait ? 720 : 580);
      var ox = cx - ow / 2, oy = cy - oh / 2;
      kit.drawGlassCard(ctx, ox, oy, ow, oh, 38, th, { border: accent, borderWidth: 2.5, sheenP: (state.localTime * 0.4) % 1 });
      kit.drawKeynoteIcon(ctx, shot.icon || "spark", cx, oy + oh * 0.25, 68, accent, accent2);
      if (!silent) {
        drawCenteredText(ctx, shot.headline || "SIAP MENCOBA?", cx, oy + oh * 0.5, ow - 96, isPortrait ? 64 : 78, th.ink, "900", 2);
        drawCenteredText(ctx, shot.subheadline || "Tersedia sekarang.", cx, oy + oh * 0.66, ow - 120, isPortrait ? 28 : 32, th.muted, "500", 1);
        var ctaLabel = String(shot.cta || "MULAI SEKARANG");
        ctx.save();
        ctx.font = "800 28px 'Inter', sans-serif";
        var pillW = Math.min(ow - 120, Math.max(260, ctx.measureText(ctaLabel).width + 72));
        var pillH = 68;
        ctx.beginPath();
        ctx.roundRect(cx - pillW / 2, oy + oh * 0.82 - pillH / 2, pillW, pillH, 34);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ctaLabel, cx, oy + oh * 0.82 + 1, pillW - 36);
        ctx.restore();
      }
      rects.push({ x: ox, y: oy, w: ow, h: oh });
    }

    var overlapCount = 0;
    for (var i = 0; i < rects.length; i++) {
      for (var j = i + 1; j < rects.length; j++) {
        if (boxesOverlap(rects[i], rects[j])) overlapCount++;
      }
    }

    return {
      bbox: unionBox(rects),
      overlapCount: overlapCount
    };
  }

  function measureShotLayout(shot, state) {
    var sz = state.safeZone;
    var safeW = sz.maxX - sz.minX;
    var safeH = sz.maxY - sz.minY;
    var cx = sz.minX + safeW / 2;
    var cy = sz.minY + safeH / 2;
    var isPortrait = state.height > state.width;
    var silent = !!state.silentMode;
    var rects = [];
    var layout = shot.layout || "brand-intro";

    if (layout === "brand-intro") {
      var cardW = Math.min(safeW - 40, isPortrait ? 840 : 1260);
      var cardH = Math.min(safeH - 60, isPortrait ? 760 : 620);
      rects.push({ x: cx - cardW / 2, y: cy - cardH / 2, w: cardW, h: cardH });
    } else if (layout === "hero-device") {
      var topH = silent ? 0 : isPortrait ? 240 : 190;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 12, w: safeW - 40, h: topH - 12 });
      rects.push({ x: sz.minX + 24, y: sz.minY + topH + 16, w: safeW - 48, h: safeH - topH - 32 });
    } else if (layout === "bento-grid") {
      var headerH = silent ? 0 : isPortrait ? 180 : 150;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: headerH - 8 });
      rects.push({ x: sz.minX + 24, y: sz.minY + headerH + 16, w: safeW - 48, h: safeH - headerH - 28 });
    } else if (layout === "spec-counter") {
      var scW = Math.min(safeW - 40, isPortrait ? 840 : 1240);
      var scH = Math.min(safeH - 60, isPortrait ? 820 : 620);
      rects.push({ x: cx - scW / 2, y: cy - scH / 2, w: scW, h: scH });
    } else if (layout === "feature-spotlight") {
      var fw = Math.min(safeW - 40, isPortrait ? 840 : 1260);
      var fh = Math.min(safeH - 60, isPortrait ? 820 : 620);
      rects.push({ x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh });
    } else if (layout === "ui-showcase") {
      var uTopH = silent ? 0 : isPortrait ? 200 : 160;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: uTopH - 8 });
      var uiW = Math.min(safeW - 48, isPortrait ? 820 : 1280);
      rects.push({ x: cx - uiW / 2, y: sz.minY + uTopH + 16, w: uiW, h: safeH - uTopH - 32 });
    } else if (layout === "split-compare") {
      var sTopH = silent ? 0 : isPortrait ? 190 : 150;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: sTopH - 8 });
      rects.push({ x: sz.minX + 24, y: sz.minY + sTopH + 16, w: safeW - 48, h: safeH - sTopH - 32 });
    } else {
      var ow = Math.min(safeW - 40, isPortrait ? 840 : 1200);
      var oh = Math.min(safeH - 60, isPortrait ? 720 : 580);
      rects.push({ x: cx - ow / 2, y: cy - oh / 2, w: ow, h: oh });
    }
    return unionBox(rects);
  }

  GLOBAL_SCOPE.KeynoteLayouts = {
    LAYOUT_PRESETS: LAYOUT_PRESETS,
    measureShotLayout: measureShotLayout,
    renderShotLayout: renderShotLayout
  };
})();
