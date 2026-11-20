(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var LAYOUT_PRESETS = [
    "dossier-hero",
    "split-compare",
    "evidence-board",
    "stat-callout",
    "timeline-strip",
    "quote-scrap"
  ];

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
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
          while (rest.length > 3 && ctx.measureText(rest + "...").width > maxW) {
            rest = rest.slice(0, -1).trim();
          }
          lines.push(ctx.measureText(rest).width <= maxW ? rest : rest + "...");
          return lines;
        }
      }
    }
    lines.push(cur);
    return lines;
  }

  function drawHeadlinePlaque(ctx, box, title, subtitle, plaqueColor, textColor, silentMode) {
    if (silentMode || (!title && !subtitle)) return null;
    ctx.save();
    ctx.fillStyle = "#1A1A1A";
    ctx.fillRect(box.x + 8, box.y + 8, box.w, box.h);
    ctx.fillStyle = plaqueColor || "#C0392B";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "#1A1A1A";
    ctx.lineWidth = 4;
    ctx.strokeRect(box.x, box.y, box.w, box.h);

    var padX = 28;
    var maxW = box.w - padX * 2;
    var fontSize = box.h >= 210 ? 54 : 44;
    ctx.font = "900 " + fontSize + "px 'Impact', 'Arial Black', sans-serif";
    var lines = wrapLines(ctx, String(title || "").toUpperCase(), maxW, 2);
    while (fontSize > 28 && lines.some(function (l) { return ctx.measureText(l).width > maxW; })) {
      fontSize -= 4;
      ctx.font = "900 " + fontSize + "px 'Impact', 'Arial Black', sans-serif";
      lines = wrapLines(ctx, String(title || "").toUpperCase(), maxW, 2);
    }

    ctx.fillStyle = textColor || "#FFFDF7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var lineH = fontSize * 1.12;
    var hasSub = Boolean(subtitle && String(subtitle).trim());
    var blockH = lines.length * lineH + (hasSub ? 38 : 0);
    var startY = box.y + (box.h - blockH) / 2 + lineH * 0.5;
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], box.x + box.w / 2, startY + i * lineH);
    }
    if (hasSub) {
      ctx.font = "700 24px 'Courier New', monospace";
      var subText = String(subtitle).trim();
      var subW = Math.min(maxW, ctx.measureText(subText).width + 28);
      var subY = startY + (lines.length - 0.5) * lineH + 22;
      ctx.fillStyle = "#FFDE59";
      ctx.fillRect(box.x + (box.w - subW) / 2, subY - 17, subW, 34);
      ctx.fillStyle = "#1A1A1A";
      ctx.fillText(subText, box.x + box.w / 2, subY + 1, maxW - 12);
    }
    ctx.restore();
    return box;
  }

  function boxesOverlap(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w - 4 && a.x + a.w > b.x + 4 && a.y < b.y + b.h - 4 && a.y + a.h > b.y + 4;
  }

  function computeUnionBox(rects) {
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
    var kit = GLOBAL_SCOPE.CollageKit;
    var sz = state.safeZone;
    var safeW = sz.maxX - sz.minX;
    var safeH = sz.maxY - sz.minY;
    var isPortrait = state.height > state.width;
    var silent = state.silentMode;
    var primary = shot.accentColor || "#C0392B";
    var secondary = shot.secondaryColor || "#F59E0B";
    var enterP = state.enterP;
    var elev = Math.max(0, 1 - enterP);
    var squashY = enterP > 0.72 && enterP < 0.96 ? 1 - Math.sin(((enterP - 0.72) / 0.24) * Math.PI) * 0.04 : 1;
    var boil = kit.boilOffset(shot.id, state.globalT, 12);
    var rects = [];

    // Zone 0: Archival header + top-right stamp (never overlaps center hero)
    var headerH = isPortrait ? 110 : 88;
    var headerBox = { x: sz.minX + 12, y: sz.minY + 10, w: safeW - 24, h: headerH };
    if (!silent && (shot.header || shot.stamp)) {
      ctx.save();
      if (shot.header) {
        ctx.fillStyle = state.theme.ink;
        ctx.font = "700 24px 'Courier New', monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(String(shot.header).toUpperCase(), headerBox.x + 8, headerBox.y + 34, safeW * 0.62);
        ctx.fillRect(headerBox.x + 8, headerBox.y + 56, safeW * 0.56, 3);
      }
      if (shot.stamp) {
        kit.drawStamp(ctx, headerBox.x + headerBox.w - 115, headerBox.y + 44, shot.stamp, primary, 0.14);
      }
      ctx.restore();
      rects.push(headerBox);
    }

    var bodyTop = sz.minY + headerH + 22;
    var plaqueH = silent ? 0 : isPortrait ? 235 : 175;
    var bodyBottom = sz.maxY - (plaqueH > 0 ? plaqueH + 24 : 16);
    var bodyH = Math.max(240, bodyBottom - bodyTop);
    var cx = sz.minX + safeW / 2;
    var layout = shot.layout || "dossier-hero";

    if (layout === "dossier-hero") {
      // Zone 1: Angled newsprint bed
      var bedW = Math.min(safeW - 44, isPortrait ? 780 : 960);
      var bedH = Math.min(bodyH - 28, isPortrait ? 650 : 470);
      kit.drawTornScrap(ctx, cx - bedW / 2 + boil.dx * 0.4, bodyTop + (bodyH - bedH) / 2, bedW, bedH, {
        angle: -0.05 + boil.rot * 0.4,
        fill: "#EFE7D6",
        seed: shot.id + ":bed",
        style: "newsprint"
      });
      // Zone 2: Hero cutout with slap-drop + white scissor rim + tape + push-pin
      var heroW = Math.min(bedW * 0.72, isPortrait ? 560 : 540);
      var heroH = Math.min(bedH * 0.92, isPortrait ? 610 : 450);
      var dropY = (1 - enterP) * -140;
      kit.drawHeroCutout(ctx, cx + boil.dx, bodyTop + bodyH / 2 + dropY + boil.dy, heroW, heroH, {
        cutout: shot.cutout || "portrait",
        imageObj: state.heroImage,
        primary: primary,
        accent: secondary,
        angle: 0.03 + boil.rot,
        scaleX: 1 / squashY,
        scaleY: squashY,
        elevation: elev,
        seed: shot.id + ":hero"
      });
      rects.push({ x: cx - heroW / 2, y: bodyTop + (bodyH - heroH) / 2, w: heroW, h: heroH });
    } else if (layout === "split-compare") {
      var items = Array.isArray(shot.items) && shot.items.length >= 2 ? shot.items.slice(0, 2) : [
        { label: "SEBELUM", cutout: shot.cutout || "clock" },
        { label: "SESUDAH", cutout: "rocket" }
      ];
      var gap = 28;
      var cardW = (safeW - 56 - gap) / 2;
      var cardH = Math.min(bodyH - 40, isPortrait ? 600 : 460);
      var cardY = bodyTop + (bodyH - cardH) / 2;
      items.forEach(function (it, idx) {
        var cardX = sz.minX + 28 + idx * (cardW + gap);
        var stagger = clamp((state.localTime - idx * 0.25) / 0.45, 0, 1);
        var offY = (1 - stagger) * -120;
        kit.drawHeroCutout(ctx, cardX + cardW / 2 + boil.dx, cardY + cardH / 2 + offY + boil.dy, cardW - 8, cardH - 16, {
          cutout: it.cutout || (idx === 0 ? "clock" : "rocket"),
          primary: idx === 0 ? "#334155" : primary,
          accent: secondary,
          angle: idx === 0 ? -0.04 : 0.04,
          elevation: 1 - stagger,
          seed: shot.id + ":cmp" + idx
        });
        if (!silent && it.label) {
          ctx.save();
          ctx.fillStyle = "#1A1A1A";
          ctx.fillRect(cardX + 22, cardY + cardH - 66, cardW - 44, 46);
          ctx.fillStyle = "#FFDE59";
          ctx.font = "900 24px 'Impact', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(it.label).toUpperCase(), cardX + cardW / 2, cardY + cardH - 42, cardW - 60);
          ctx.restore();
        }
        rects.push({ x: cardX, y: cardY, w: cardW, h: cardH });
      });
      if (!silent) {
        kit.drawStamp(ctx, cx, cardY + cardH / 2, "VS", primary, -0.18);
      }
    } else if (layout === "evidence-board") {
      var cards = Array.isArray(shot.items) && shot.items.length > 0 ? shot.items.slice(0, 4) : [
        { label: "BUKTI 1", cutout: "eye" },
        { label: "BUKTI 2", cutout: "brain" },
        { label: "BUKTI 3", cutout: "gear" }
      ];
      var cols = cards.length <= 2 ? 2 : 2;
      var rows = Math.ceil(cards.length / cols);
      var gapX = 28, gapY = 28;
      var cw = (safeW - 56 - gapX * (cols - 1)) / cols;
      var ch = Math.min((bodyH - 24 - gapY * (rows - 1)) / rows, 360);
      var startY = bodyTop + (bodyH - (rows * ch + gapY * (rows - 1))) / 2;
      // Red yarn connecting pins
      ctx.save();
      ctx.strokeStyle = "#C0392B";
      ctx.lineWidth = 4;
      ctx.beginPath();
      cards.forEach(function (_, idx) {
        var c = idx % cols, r = Math.floor(idx / cols);
        var px = sz.minX + 28 + c * (cw + gapX) + cw / 2;
        var py = startY + r * (ch + gapY) + 18;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();

      cards.forEach(function (it, idx) {
        var c = idx % cols, r = Math.floor(idx / cols);
        var bx = sz.minX + 28 + c * (cw + gapX);
        var by = startY + r * (ch + gapY);
        var st = clamp((state.localTime - idx * 0.22) / 0.4, 0, 1);
        kit.drawHeroCutout(ctx, bx + cw / 2 + boil.dx * 0.6, by + ch / 2 + (1 - st) * -80 + boil.dy * 0.6, cw - 12, ch - 12, {
          cutout: it.cutout || "star",
          primary: primary,
          accent: secondary,
          angle: (idx % 2 === 0 ? -1 : 1) * 0.035,
          elevation: 1 - st,
          seed: shot.id + ":ev" + idx
        });
        if (!silent && it.label) {
          ctx.save();
          ctx.fillStyle = "#1A1A1A";
          ctx.font = "700 22px 'Courier New', monospace";
          ctx.textAlign = "center";
          ctx.fillText(String(it.label).toUpperCase(), bx + cw / 2, by + ch - 26, cw - 36);
          ctx.restore();
        }
        rects.push({ x: bx, y: by, w: cw, h: ch });
      });
    } else if (layout === "stat-callout") {
      var scrapW = safeW - 56;
      var scrapH = Math.min(bodyH - 28, isPortrait ? 620 : 440);
      var sy = bodyTop + (bodyH - scrapH) / 2;
      kit.drawTornScrap(ctx, sz.minX + 28 + boil.dx, sy + boil.dy, scrapW, scrapH, {
        angle: -0.02 + boil.rot,
        fill: "#FAF6EC",
        seed: shot.id + ":stat",
        style: "grid"
      });
      kit.drawPushPin(ctx, cx, sy + 18, primary);
      var statVal = shot.statValue || "87%";
      var numMatch = String(statVal).match(/^([^0-9.-]*)([0-9.]+)(.*)$/);
      var displayStat = statVal;
      if (numMatch) {
        var targetNum = Number(numMatch[2]);
        var curNum = Math.round(targetNum * clamp(state.localTime / Math.min(1.6, state.duration * 0.55), 0, 1));
        displayStat = numMatch[1] + curNum + numMatch[3];
      }
      // Draw glyph at upper half, stat number below
      ctx.save();
      ctx.translate(cx, sy + scrapH * 0.3);
      kit.drawCutoutGlyph(ctx, shot.cutout || "chart", 110, primary, secondary);
      ctx.restore();
      if (!silent) {
        var hlP = clamp((state.localTime - 0.35) / 0.5, 0, 1);
        ctx.save();
        ctx.fillStyle = "#FFDE59";
        ctx.fillRect(cx - 210, sy + scrapH * 0.62, 420 * hlP, 76);
        ctx.fillStyle = "#1A1A1A";
        ctx.font = "900 104px 'Impact', 'Arial Black', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayStat, cx, sy + scrapH * 0.67, scrapW - 80);
        if (shot.statLabel) {
          ctx.font = "700 28px 'Courier New', monospace";
          ctx.fillText(String(shot.statLabel).toUpperCase(), cx, sy + scrapH * 0.86, scrapW - 80);
        }
        ctx.restore();
      }
      rects.push({ x: sz.minX + 28, y: sy, w: scrapW, h: scrapH });
    } else if (layout === "timeline-strip") {
      var steps = Array.isArray(shot.items) && shot.items.length > 0 ? shot.items.slice(0, 3) : [
        { tag: "01", label: "AWAL MULA", cutout: "lightbulb" },
        { tag: "02", label: "PROSES", cutout: "gear" },
        { tag: "03", label: "HASIL", cutout: "rocket" }
      ];
      var rowGap = 24;
      var rowH = Math.min(195, (bodyH - rowGap * (steps.length - 1) - 16) / steps.length);
      var totalH = steps.length * rowH + rowGap * (steps.length - 1);
      var sy0 = bodyTop + (bodyH - totalH) / 2;
      var stripW = safeW - 56;
      steps.forEach(function (stItem, idx) {
        var ry = sy0 + idx * (rowH + rowGap);
        var slideP = clamp((state.localTime - idx * 0.3) / 0.45, 0, 1);
        var slideX = (1 - slideP) * (idx % 2 === 0 ? -160 : 160);
        kit.drawTornScrap(ctx, sz.minX + 28 + slideX + boil.dx * 0.5, ry + boil.dy * 0.5, stripW, rowH, {
          angle: (idx % 2 === 0 ? -1 : 1) * 0.015,
          fill: "#FAF6EC",
          seed: shot.id + ":tl" + idx,
          style: "lined"
        });
        kit.drawPushPin(ctx, sz.minX + 58 + slideX, ry + rowH / 2, primary);
        ctx.save();
        ctx.translate(sz.minX + 145 + slideX, ry + rowH / 2);
        kit.drawCutoutGlyph(ctx, stItem.cutout || "star", rowH * 0.34, primary, secondary);
        ctx.restore();
        if (!silent) {
          ctx.save();
          ctx.fillStyle = primary;
          ctx.font = "900 32px 'Impact', sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(String(stItem.tag || "0" + (idx + 1)), sz.minX + 225 + slideX, ry + rowH * 0.36);
          ctx.fillStyle = "#1A1A1A";
          ctx.font = "800 30px 'Arial Black', sans-serif";
          ctx.fillText(String(stItem.label || "").toUpperCase(), sz.minX + 225 + slideX, ry + rowH * 0.68, stripW - 250);
          ctx.restore();
        }
        rects.push({ x: sz.minX + 28, y: ry, w: stripW, h: rowH });
      });
    } else {
      // quote-scrap
      var qw = safeW - 56;
      var qh = Math.min(bodyH - 36, isPortrait ? 580 : 420);
      var qy = bodyTop + (bodyH - qh) / 2;
      kit.drawTornScrap(ctx, sz.minX + 28 + boil.dx, qy + boil.dy, qw, qh, {
        angle: -0.02 + boil.rot,
        fill: "#FFFDF7",
        seed: shot.id + ":quote",
        style: "lined"
      });
      kit.drawWashiTape(ctx, sz.minX + 110, qy + 12, 130, 32, -0.35, "#E9D5A1");
      kit.drawWashiTape(ctx, sz.minX + 28 + qw - 90, qy + qh - 12, 130, 32, -0.35, "#E9D5A1");
      if (!silent) {
        var hlSweep = clamp((state.localTime - 0.25) / 0.7, 0, 1);
        ctx.save();
        ctx.font = "900 44px 'Impact', 'Arial Black', sans-serif";
        var qLines = wrapLines(ctx, String(shot.quote || shot.headline || "IDE BESAR DIMULAI DARI POTONGAN KECIL.").toUpperCase(), qw - 120, 4);
        var lh = 62;
        var y0 = qy + (qh - qLines.length * lh) / 2 + 24;
        for (var qi = 0; qi < qLines.length; qi++) {
          var lw = Math.min(qw - 100, ctx.measureText(qLines[qi]).width + 24);
          if (qi === 0) {
            ctx.fillStyle = "#FFDE59";
            ctx.fillRect(cx - lw / 2, y0 - 26, lw * hlSweep, 52);
          }
          ctx.fillStyle = "#1A1A1A";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(qLines[qi], cx, y0 + qi * lh, qw - 110);
        }
        ctx.restore();
      }
      rects.push({ x: sz.minX + 28, y: qy, w: qw, h: qh });
    }

    // Zone 3: Optional collage accents positioned cleanly on outer lower corners (non-overlapping)
    var accents = Array.isArray(shot.accents) ? shot.accents.slice(0, 2) : [];
    accents.forEach(function (acc, idx) {
      var ax = idx === 0 ? sz.minX + 76 : sz.maxX - 76;
      var ay = bodyBottom - 36;
      kit.drawAccent(ctx, acc, ax + boil.dx, ay + boil.dy, 48, primary, secondary);
    });

    // Zone 4: Bold Constructivist headline plaque
    if (plaqueH > 0 && (shot.headline || shot.subheadline)) {
      var pBox = { x: sz.minX + 24, y: bodyBottom + 16, w: safeW - 48, h: plaqueH };
      drawHeadlinePlaque(ctx, pBox, shot.headline, shot.subheadline, primary, "#FFFDF7", silent);
      rects.push(pBox);
    }

    var overlapCount = 0;
    for (var i = 0; i < rects.length; i++) {
      for (var j = i + 1; j < rects.length; j++) {
        if (boxesOverlap(rects[i], rects[j])) overlapCount++;
      }
    }

    return {
      bbox: computeUnionBox(rects),
      overlapCount: overlapCount
    };
  }

  function measureShotLayout(shot, state) {
    var sz = state.safeZone;
    var safeW = sz.maxX - sz.minX;
    var safeH = sz.maxY - sz.minY;
    var isPortrait = state.height > state.width;
    var silent = !!state.silentMode;
    var rects = [];

    var headerH = isPortrait ? 110 : 88;
    if (!silent && (shot.header || shot.stamp)) {
      rects.push({ x: sz.minX + 12, y: sz.minY + 10, w: safeW - 24, h: headerH });
    }

    var bodyTop = sz.minY + headerH + 22;
    var plaqueH = silent ? 0 : isPortrait ? 235 : 175;
    var bodyBottom = sz.maxY - (plaqueH > 0 ? plaqueH + 24 : 16);
    var bodyH = Math.max(240, bodyBottom - bodyTop);
    var cx = sz.minX + safeW / 2;
    var layout = shot.layout || "dossier-hero";

    if (layout === "dossier-hero") {
      var bedW = Math.min(safeW - 44, isPortrait ? 780 : 960);
      var bedH = Math.min(bodyH - 28, isPortrait ? 650 : 470);
      var heroW = Math.min(bedW * 0.72, isPortrait ? 560 : 540);
      var heroH = Math.min(bedH * 0.92, isPortrait ? 610 : 450);
      rects.push({ x: cx - heroW / 2, y: bodyTop + (bodyH - heroH) / 2, w: heroW, h: heroH });
    } else if (layout === "split-compare") {
      var gap = 28;
      var cardW = (safeW - 56 - gap) / 2;
      var cardH = Math.min(bodyH - 40, isPortrait ? 600 : 460);
      var cardY = bodyTop + (bodyH - cardH) / 2;
      rects.push({ x: sz.minX + 28, y: cardY, w: cardW * 2 + gap, h: cardH });
    } else if (layout === "evidence-board") {
      var count = Array.isArray(shot.items) && shot.items.length > 0 ? Math.min(4, shot.items.length) : 3;
      var cols = 2;
      var rows = Math.ceil(count / cols);
      var gapX = 28, gapY = 28;
      var cw = (safeW - 56 - gapX * (cols - 1)) / cols;
      var ch = Math.min((bodyH - 24 - gapY * (rows - 1)) / rows, 360);
      var startY = bodyTop + (bodyH - (rows * ch + gapY * (rows - 1))) / 2;
      rects.push({ x: sz.minX + 28, y: startY, w: cols * cw + gapX * (cols - 1), h: rows * ch + gapY * (rows - 1) });
    } else if (layout === "stat-callout") {
      var scrapW = safeW - 56;
      var scrapH = Math.min(bodyH - 28, isPortrait ? 620 : 440);
      var sy = bodyTop + (bodyH - scrapH) / 2;
      rects.push({ x: sz.minX + 28, y: sy, w: scrapW, h: scrapH });
    } else if (layout === "timeline-strip") {
      var stepsCount = Array.isArray(shot.items) && shot.items.length > 0 ? Math.min(3, shot.items.length) : 3;
      var rowGap = 24;
      var rowH = Math.min(195, (bodyH - rowGap * (stepsCount - 1) - 16) / stepsCount);
      var totalH = stepsCount * rowH + rowGap * (stepsCount - 1);
      var sy0 = bodyTop + (bodyH - totalH) / 2;
      rects.push({ x: sz.minX + 28, y: sy0, w: safeW - 56, h: totalH });
    } else {
      var qw = safeW - 56;
      var qh = Math.min(bodyH - 36, isPortrait ? 580 : 420);
      var qy = bodyTop + (bodyH - qh) / 2;
      rects.push({ x: sz.minX + 28, y: qy, w: qw, h: qh });
    }

    if (plaqueH > 0 && (shot.headline || shot.subheadline)) {
      rects.push({ x: sz.minX + 24, y: bodyBottom + 16, w: safeW - 48, h: plaqueH });
    }
    return computeUnionBox(rects);
  }

  GLOBAL_SCOPE.CollageLayouts = {
    LAYOUT_PRESETS: LAYOUT_PRESETS,
    measureShotLayout: measureShotLayout,
    renderShotLayout: renderShotLayout
  };
})();
