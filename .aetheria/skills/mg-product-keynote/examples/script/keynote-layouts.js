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

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOutCubic(p) { var x = 1 - clamp(p, 0, 1); return 1 - x * x * x; }

  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    var lines = [];
    var cur = words[0];
    for (var i = 1; i < words.length; i++) {
      var cand = cur + " " + words[i];
      if (ctx.measureText(cand).width <= maxW) cur = cand;
      else {
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
    ctx.font = "800 20px 'Inter', 'Segoe UI', sans-serif";
    var label = String(text).toUpperCase();
    var w = Math.min(540, ctx.measureText(label).width + 44);
    var h = 40;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 20);
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

  function drawGradientTitle(ctx, text, cx, y, maxW, fontSize, th, accent, accent2, maxLines) {
    if (!text) return 0;
    ctx.save();
    var fs = fontSize;
    ctx.font = "900 " + fs + "px 'Inter', 'Segoe UI', sans-serif";
    var lines = wrapLines(ctx, text, maxW, maxLines || 2);
    while (fs > 24 && lines.some(function (l) { return ctx.measureText(l).width > maxW; })) {
      fs -= 4;
      ctx.font = "900 " + fs + "px 'Inter', 'Segoe UI', sans-serif";
      lines = wrapLines(ctx, text, maxW, maxLines || 2);
    }
    var g = ctx.createLinearGradient(cx - maxW * 0.4, y - fs * 0.5, cx + maxW * 0.4, y + fs * lines.length);
    if (th.dark) {
      g.addColorStop(0, "#FFFFFF");
      g.addColorStop(0.65, "#E2E8F0");
      g.addColorStop(1, accent2 || accent);
    } else {
      g.addColorStop(0, th.ink);
      g.addColorStop(1, accent);
    }
    ctx.fillStyle = g;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var lh = fs * 1.15;
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lh, maxW);
    ctx.restore();
    return lines.length * lh;
  }

  function drawCenteredText(ctx, text, cx, y, maxW, fontSize, color, weight, maxLines) {
    if (!text) return 0;
    ctx.save();
    var fs = fontSize;
    ctx.font = (weight || "700") + " " + fs + "px 'Inter', 'Segoe UI', sans-serif";
    var lines = wrapLines(ctx, text, maxW, maxLines || 2);
    while (fs > 20 && lines.some(function (l) { return ctx.measureText(l).width > maxW; })) {
      fs -= 3;
      ctx.font = (weight || "700") + " " + fs + "px 'Inter', 'Segoe UI', sans-serif";
      lines = wrapLines(ctx, text, maxW, maxLines || 2);
    }
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var lh = fs * 1.2;
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lh, maxW);
    ctx.restore();
    return lines.length * lh;
  }

  function drawEmblemHalo(ctx, cx, cy, r, accent, accent2, t) {
    ctx.save();
    for (var ri = 0; ri < 3; ri++) {
      var rr = r * (1.25 + ri * 0.34);
      ctx.strokeStyle = ri === 0 ? accent : (ri === 1 ? accent2 : "rgba(255,255,255,0.12)");
      ctx.globalAlpha = 0.34 - ri * 0.08;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, t * (0.4 + ri * 0.2), t * (0.4 + ri * 0.2) + Math.PI * 1.45);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
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
      minX: Math.round(minX), minY: Math.round(minY),
      maxX: Math.round(maxX), maxY: Math.round(maxY),
      width: Math.round(maxX - minX), height: Math.round(maxY - minY)
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
      // Open-stage emblem pedestal + kinetic metallic headline + spec badge strip (no boxy prison!)
      var emblemY = sz.minY + safeH * 0.30 + (1 - ep) * 28;
      var emblemR = isPortrait ? 92 : 96;
      drawEmblemHalo(ctx, cx, emblemY, emblemR, accent, accent2, state.localTime);
      kit.drawGlassCard(ctx, cx - emblemR, emblemY - emblemR, emblemR * 2, emblemR * 2, emblemR * 0.56, th, {
        border: accent, borderWidth: 2.5, sheenP: (state.localTime * 0.42) % 1
      });
      kit.drawKeynoteIcon(ctx, shot.icon || "spark", cx, emblemY, emblemR * 0.52, accent, accent2);
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + safeH * 0.52, shot.eyebrow || "INTRODUCING", accent, th.dark, silent);
        drawGradientTitle(ctx, shot.headline || "AETHERIA STUDIO", cx, sz.minY + safeH * 0.64, safeW - 60, isPortrait ? 72 : 84, th, accent, accent2, 2);
        drawCenteredText(ctx, shot.subheadline || "Desktop GPU speed. Zero-cloud studio precision.", cx, sz.minY + safeH * 0.80, safeW - 100, isPortrait ? 28 : 30, th.muted, "500", 2);
      }
      rects.push({ x: sz.minX + 30, y: sz.minY + 60, w: safeW - 60, h: safeH - 120 });
    } else if (layout === "hero-device") {
      var topH = silent ? 0 : isPortrait ? 235 : 185;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 42, shot.eyebrow, accent, th.dark, silent);
        drawGradientTitle(ctx, shot.headline || "BUILT FOR CREATORS", cx, sz.minY + 122, safeW - 48, isPortrait ? 56 : 64, th, accent, accent2, 2);
        drawCenteredText(ctx, shot.subheadline, cx, sz.minY + 195, safeW - 80, isPortrait ? 26 : 28, th.muted, "500", 1);
        rects.push({ x: sz.minX + 20, y: sz.minY + 12, w: safeW - 40, h: topH - 12 });
      }
      var devTop = sz.minY + topH + 16;
      var devH = safeH - topH - 130;
      var devW = safeW - 44;
      kit.drawDeviceMockup(ctx, shot.device || "laptop", cx, devTop + devH / 2 + (1 - ep) * 40, devW, devH, th, {
        accent: accent, accent2: accent2, localTime: state.localTime, imageObj: state.heroImage, silent: silent
      });
      // Floating bottom spec strip anchors the device
      if (!silent) {
        var chipY = sz.maxY - 64;
        var chipW = (safeW - 84) / 2;
        ["3.2× Faster Local Render", "100% Private Engine"].forEach(function (lbl, ci) {
          var cbx = sz.minX + 28 + ci * (chipW + 28);
          kit.drawGlassCard(ctx, cbx, chipY - 28, chipW, 56, 28, th, { borderWidth: 1.5, shadowBlur: 16 });
          drawCenteredText(ctx, lbl, cbx + chipW / 2, chipY, chipW - 24, 21, th.ink, "700", 1);
        });
      }
      rects.push({ x: sz.minX + 22, y: devTop, w: devW, h: safeH - topH - 24 });
    } else if (layout === "bento-grid") {
      var headerH = silent ? 0 : isPortrait ? 190 : 150;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 34, shot.eyebrow, accent, th.dark, silent);
        drawGradientTitle(ctx, shot.headline || "FOUR CORE PILLARS", cx, sz.minY + 114, safeW - 48, isPortrait ? 52 : 58, th, accent, accent2, 2);
        rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: headerH - 8 });
      }
      var items = Array.isArray(shot.items) && shot.items.length > 0 ? shot.items.slice(0, 4) : [
        { stat: "3.2×", label: "Faster Local Render", icon: "bolt" },
        { stat: "100%", label: "Private & Offline", icon: "shield" },
        { stat: "4K", label: "Crisp 60fps Master", icon: "camera" },
        { stat: "$0", label: "Cloud Render Fees", icon: "check" }
      ];
      var cols = 2, rows = Math.ceil(items.length / cols), gap = 22;
      var gridTop = sz.minY + headerH + 16;
      var gridH = safeH - headerH - 30;
      var cw = (safeW - 48 - gap * (cols - 1)) / cols;
      var ch = (gridH - gap * (rows - 1)) / rows;
      items.forEach(function (it, idx) {
        var c = idx % cols, r = Math.floor(idx / cols);
        var bx = sz.minX + 24 + c * (cw + gap);
        var by = gridTop + r * (ch + gap);
        var sp = easeOutCubic(clamp((state.localTime - idx * 0.14) / 0.42, 0, 1));
        var offY = (1 - sp) * 32;
        var isAccentCard = idx === 0;
        kit.drawGlassCard(ctx, bx, by + offY, cw, ch, 28, th, {
          border: isAccentCard ? accent : undefined,
          borderWidth: isAccentCard ? 2.5 : 1.5,
          sheenP: ((state.localTime + idx * 0.22) * 0.32) % 1
        });
        kit.drawKeynoteIcon(ctx, it.icon || "spark", bx + cw / 2, by + offY + ch * 0.24, Math.min(cw, ch) * 0.15, accent, accent2);
        if (!silent) {
          if (it.stat) drawCenteredText(ctx, it.stat, bx + cw / 2, by + offY + ch * 0.54, cw - 32, isPortrait ? 58 : 60, accent, "900", 1);
          if (it.label) drawCenteredText(ctx, it.label, bx + cw / 2, by + offY + ch * 0.78, cw - 36, isPortrait ? 24 : 26, th.ink, "700", 2);
        }
        // Micro sparkline bar accent along bottom of every card
        for (var mb = 0; mb < 7; mb++) {
          var bw = 8, bh = 8 + ((mb * 7 + idx * 5) % 18) * sp;
          ctx.fillStyle = mb >= 5 ? accent : "rgba(148,163,184,0.28)";
          ctx.beginPath();
          ctx.roundRect(bx + cw * 0.5 - 42 + mb * 13, by + offY + ch - 24 - bh, bw, bh, 4);
          ctx.fill();
        }
        rects.push({ x: bx, y: by, w: cw, h: ch });
      });
    } else if (layout === "spec-counter") {
      var scW = Math.min(safeW - 44, isPortrait ? 840 : 1240);
      var scH = Math.min(safeH - 80, isPortrait ? 880 : 620);
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
      var ringR = Math.min(scW, scH) * 0.25;
      var ringY = sy + scH * 0.42;
      ctx.save();
      // Precision tick marks around gauge
      for (var tk = 0; tk < 36; tk++) {
        var ta = (tk / 36) * Math.PI * 2;
        ctx.strokeStyle = tk / 36 < 0.82 * easeOutCubic(frac) ? accent2 : "rgba(148,163,184,0.2)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ta) * (ringR + 14), ringY + Math.sin(ta) * (ringR + 14));
        ctx.lineTo(cx + Math.cos(ta) * (ringR + 24), ringY + Math.sin(ta) * (ringR + 24));
        ctx.stroke();
      }
      ctx.strokeStyle = th.dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.08)";
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, ringY, ringR, 0, Math.PI * 2);
      ctx.stroke();
      var arcG = ctx.createLinearGradient(cx - ringR, ringY - ringR, cx + ringR, ringY + ringR);
      arcG.addColorStop(0, accent);
      arcG.addColorStop(1, accent2);
      ctx.strokeStyle = arcG;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.82 * easeOutCubic(frac));
      ctx.stroke();
      ctx.restore();
      if (!silent) {
        drawEyebrowPill(ctx, cx, sy + 56, shot.eyebrow || "LIVE BENCHMARK", accent, th.dark, silent);
        drawGradientTitle(ctx, disp, cx, ringY, ringR * 1.75, isPortrait ? 86 : 104, th, accent, accent2, 1);
        drawCenteredText(ctx, shot.statLabel || shot.headline || "FASTER PIPELINE", cx, sy + scH * 0.77, scW - 96, isPortrait ? 38 : 44, th.ink, "800", 2);
        drawCenteredText(ctx, shot.subheadline, cx, sy + scH * 0.89, scW - 120, 24, th.muted, "500", 2);
      }
      rects.push({ x: sx, y: sy, w: scW, h: scH });
    } else if (layout === "ui-showcase") {
      var uTopH = silent ? 0 : isPortrait ? 200 : 160;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 34, shot.eyebrow, accent, th.dark, silent);
        drawGradientTitle(ctx, shot.headline || "INTELLIGENT WORKFLOW", cx, sz.minY + 114, safeW - 48, isPortrait ? 52 : 60, th, accent, accent2, 2);
        rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: uTopH - 8 });
      }
      var uiTop = sz.minY + uTopH + 16;
      var uiH = safeH - uTopH - 36;
      var uiW = Math.min(safeW - 44, isPortrait ? 820 : 1280);
      var ux = cx - uiW / 2;
      kit.drawGlassCard(ctx, ux, uiTop, uiW, uiH, 30, th, { sheenP: (state.localTime * 0.3) % 1 });
      var rowsList = Array.isArray(shot.items) && shot.items.length > 0 ? shot.items.slice(0, 3) : [
        { label: "Auto Framing Guard", stat: "0 Errors", icon: "shield" },
        { label: "Beat & Word Cue Sync", stat: "30 fps", icon: "wave" },
        { label: "3-Frame Contact Sheet", stat: "Instant", icon: "play" }
      ];
      var rGap = 20;
      var rH = (uiH - 92 - rGap * (rowsList.length - 1)) / rowsList.length;
      rowsList.forEach(function (row, idx) {
        var ry = uiTop + 46 + idx * (rH + rGap);
        var active = Math.floor((state.localTime / Math.max(0.5, state.duration)) * rowsList.length) === idx;
        kit.drawGlassCard(ctx, ux + 34, ry, uiW - 68, rH, 22, th, {
          border: active ? accent : th.cardBorder,
          borderWidth: active ? 3 : 1.5,
          shadowBlur: active ? 24 : 8
        });
        kit.drawKeynoteIcon(ctx, row.icon || "check", ux + 92, ry + rH / 2, Math.min(34, rH * 0.25), accent, accent2);
        // Live mini progress meter on each row
        var progBarW = uiW - 220;
        var progY = ry + rH - 26;
        ctx.fillStyle = th.dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)";
        ctx.beginPath();
        ctx.roundRect(ux + 148, progY, progBarW, 7, 3.5);
        ctx.fill();
        ctx.fillStyle = active ? accent : accent2;
        ctx.beginPath();
        ctx.roundRect(ux + 148, progY, progBarW * (active ? 0.92 : 0.65), 7, 3.5);
        ctx.fill();

        if (!silent) {
          ctx.save();
          ctx.fillStyle = th.ink;
          ctx.font = "700 " + (isPortrait ? 27 : 30) + "px 'Inter', sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(String(row.label || ""), ux + 148, ry + rH * 0.42, uiW - 350);
          if (row.stat) {
            ctx.fillStyle = accent;
            ctx.font = "800 " + (isPortrait ? 26 : 28) + "px 'Inter', sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(String(row.stat), ux + uiW - 64, ry + rH * 0.42);
          }
          ctx.restore();
        }
      });
      rects.push({ x: ux, y: uiTop, w: uiW, h: uiH });
    } else if (layout === "split-compare") {
      var sTopH = silent ? 0 : isPortrait ? 190 : 150;
      if (!silent) {
        drawEyebrowPill(ctx, cx, sz.minY + 34, shot.eyebrow, accent, th.dark, silent);
        drawGradientTitle(ctx, shot.headline || "REAL DIFFERENCE", cx, sz.minY + 110, safeW - 48, isPortrait ? 52 : 60, th, accent, accent2, 2);
        rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: sTopH - 8 });
      }
      var pair = Array.isArray(shot.items) && shot.items.length >= 2 ? shot.items.slice(0, 2) : [
        { stat: "Before", label: "Manual & Rigid Keyframes", icon: "layers" },
        { stat: "After", label: "Autonomous & Cinematic", icon: "bolt" }
      ];
      var bodyT = sz.minY + sTopH + 16;
      var bodyH = safeH - sTopH - 32;
      var gapS = 24;
      pair.forEach(function (it, idx) {
        var bx = sz.minX + 24, bw = safeW - 48, bh = (bodyH - gapS) / 2;
        var by = bodyT + idx * (bh + gapS);
        if (!isPortrait) {
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
      var ow = Math.min(safeW - 44, isPortrait ? 840 : 1200);
      var oh = Math.min(safeH - 80, isPortrait ? 760 : 580);
      var ox = cx - ow / 2, oy = cy - oh / 2;
      drawEmblemHalo(ctx, cx, oy + oh * 0.24, 68, accent, accent2, state.localTime);
      kit.drawGlassCard(ctx, ox, oy, ow, oh, 38, th, { border: accent, borderWidth: 2.5, sheenP: (state.localTime * 0.4) % 1 });
      kit.drawKeynoteIcon(ctx, shot.icon || "spark", cx, oy + oh * 0.24, 64, accent, accent2);
      if (!silent) {
        drawGradientTitle(ctx, shot.headline || "READY TO CREATE?", cx, oy + oh * 0.48, ow - 96, isPortrait ? 64 : 76, th, accent, accent2, 2);
        drawCenteredText(ctx, shot.subheadline || "Start crafting locally today.", cx, oy + oh * 0.66, ow - 120, isPortrait ? 28 : 32, th.muted, "500", 1);
        var ctaLabel = String(shot.cta || "GET STARTED");
        ctx.save();
        ctx.font = "800 28px 'Inter', sans-serif";
        var pillW = Math.min(ow - 120, Math.max(260, ctx.measureText(ctaLabel).width + 72));
        var pillH = 68;
        var pg = ctx.createLinearGradient(cx - pillW / 2, 0, cx + pillW / 2, 0);
        pg.addColorStop(0, accent);
        pg.addColorStop(1, accent2);
        ctx.beginPath();
        ctx.roundRect(cx - pillW / 2, oy + oh * 0.82 - pillH / 2, pillW, pillH, 34);
        ctx.fillStyle = pg;
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
    return { bbox: unionBox(rects), overlapCount: overlapCount };
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
      rects.push({ x: sz.minX + 30, y: sz.minY + 60, w: safeW - 60, h: safeH - 120 });
    } else if (layout === "hero-device") {
      var topH = silent ? 0 : isPortrait ? 235 : 185;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 12, w: safeW - 40, h: topH - 12 });
      rects.push({ x: sz.minX + 22, y: sz.minY + topH + 16, w: safeW - 44, h: safeH - topH - 24 });
    } else if (layout === "bento-grid") {
      var headerH = silent ? 0 : isPortrait ? 190 : 150;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: headerH - 8 });
      rects.push({ x: sz.minX + 24, y: sz.minY + headerH + 16, w: safeW - 48, h: safeH - headerH - 30 });
    } else if (layout === "spec-counter") {
      var scW = Math.min(safeW - 44, isPortrait ? 840 : 1240);
      var scH = Math.min(safeH - 80, isPortrait ? 880 : 620);
      rects.push({ x: cx - scW / 2, y: cy - scH / 2, w: scW, h: scH });
    } else if (layout === "ui-showcase") {
      var uTopH = silent ? 0 : isPortrait ? 200 : 160;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: uTopH - 8 });
      var uiW = Math.min(safeW - 44, isPortrait ? 820 : 1280);
      rects.push({ x: cx - uiW / 2, y: sz.minY + uTopH + 16, w: uiW, h: safeH - uTopH - 36 });
    } else if (layout === "split-compare") {
      var sTopH = silent ? 0 : isPortrait ? 190 : 150;
      if (!silent) rects.push({ x: sz.minX + 20, y: sz.minY + 8, w: safeW - 40, h: sTopH - 8 });
      rects.push({ x: sz.minX + 24, y: sz.minY + sTopH + 16, w: safeW - 48, h: safeH - sTopH - 32 });
    } else {
      var ow = Math.min(safeW - 44, isPortrait ? 840 : 1200);
      var oh = Math.min(safeH - 80, isPortrait ? 760 : 580);
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
