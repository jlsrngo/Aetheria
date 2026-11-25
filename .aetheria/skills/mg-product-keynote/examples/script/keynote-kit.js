(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var KEYNOTE_THEMES = ["pearl-studio", "obsidian-pro", "titanium-warm", "aurora-keynote", "mint-editorial"];
  var DEVICE_KINDS = ["laptop", "phone", "tablet", "watch", "chip", "card"];
  var ICON_KINDS = ["spark", "bolt", "shield", "cpu", "layers", "globe", "wave", "lock", "camera", "play", "chart", "check"];

  var THEME_MAP = {
    "pearl-studio": {
      bgTop: "#FFFFFF", bgBot: "#E6E8F0", ink: "#111827", muted: "#4B5563",
      cardBg: "rgba(255,255,255,0.86)", cardBorder: "rgba(17,24,39,0.12)",
      accent: "#0071E3", accent2: "#38BDF8", glow: "rgba(0,113,227,0.18)", dark: false
    },
    "obsidian-pro": {
      bgTop: "#121520", bgBot: "#040508", ink: "#F8FAFC", muted: "#94A3B8",
      cardBg: "rgba(22,26,38,0.78)", cardBorder: "rgba(255,255,255,0.16)",
      accent: "#38BDF8", accent2: "#818CF8", glow: "rgba(56,189,248,0.26)", dark: true
    },
    "titanium-warm": {
      bgTop: "#201C18", bgBot: "#0C0A09", ink: "#FAF6EF", muted: "#BFB6A8",
      cardBg: "rgba(38,34,30,0.82)", cardBorder: "rgba(226,199,153,0.24)",
      accent: "#E7C896", accent2: "#F59E0B", glow: "rgba(231,200,150,0.22)", dark: true
    },
    "aurora-keynote": {
      bgTop: "#0C122E", bgBot: "#050714", ink: "#F8FAFC", muted: "#94A3B8",
      cardBg: "rgba(17,24,52,0.74)", cardBorder: "rgba(165,180,252,0.24)",
      accent: "#38BDF8", accent2: "#C084FC", glow: "rgba(129,140,248,0.28)", dark: true
    },
    "mint-editorial": {
      bgTop: "#F6FBF9", bgBot: "#E1F0EA", ink: "#0F172A", muted: "#475569",
      cardBg: "rgba(255,255,255,0.90)", cardBorder: "rgba(15,23,42,0.10)",
      accent: "#0284C7", accent2: "#14B8A6", glow: "rgba(2,132,199,0.16)", dark: false
    }
  };

  function drawStudioBackground(ctx, w, h, themeName, globalT) {
    var th = THEME_MAP[themeName] || THEME_MAP["obsidian-pro"];
    ctx.save();
    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, th.bgTop);
    bg.addColorStop(1, th.bgBot);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Volumetric dual overhead light cones
    var shift = Math.sin(globalT * 0.45) * w * 0.08;
    var cone = ctx.createRadialGradient(w * 0.5 + shift, h * 0.14, 16, w * 0.5, h * 0.44, Math.max(w, h) * 0.65);
    cone.addColorStop(0, th.glow);
    cone.addColorStop(0.55, th.dark ? "rgba(99,102,241,0.08)" : "rgba(56,189,248,0.07)");
    cone.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cone;
    ctx.fillRect(0, 0, w, h);

    // Soft studio horizon rim arc
    ctx.strokeStyle = th.dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.07)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.84, w * 0.72, h * 0.12, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // Precision micro-dot architectural matrix
    ctx.fillStyle = th.dark ? "rgba(255,255,255,0.09)" : "rgba(15,23,42,0.08)";
    var step = 64;
    for (var x = step; x < w; x += step) {
      for (var y = step; y < h; y += step) {
        var fade = 1 - Math.min(1, Math.hypot(x - w * 0.5, y - h * 0.45) / (Math.max(w, h) * 0.62));
        if (fade <= 0.15) continue;
        ctx.globalAlpha = fade * 0.6;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    ctx.globalAlpha = 1;

    // Subtle floating specular bokeh motes
    for (var bi = 0; bi < 8; bi++) {
      var bx = w * (0.12 + ((bi * 0.13 + Math.sin(globalT * 0.25 + bi) * 0.04) % 0.8));
      var by = h * (0.14 + ((bi * 0.17 + Math.cos(globalT * 0.3 + bi * 1.3) * 0.05) % 0.72));
      ctx.fillStyle = th.dark ? "rgba(255,255,255,0.14)" : "rgba(0,113,227,0.12)";
      ctx.beginPath();
      ctx.arc(bx, by, 2 + (bi % 3) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return th;
  }

  function drawGlassCard(ctx, x, y, w, h, radius, th, opts) {
    var o = opts || {};
    ctx.save();
    ctx.shadowColor = th.dark ? "rgba(0,0,0,0.55)" : "rgba(15,23,42,0.14)";
    ctx.shadowBlur = o.shadowBlur !== undefined ? o.shadowBlur : 36;
    ctx.shadowOffsetY = o.shadowY !== undefined ? o.shadowY : 16;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius || 28);
    ctx.fillStyle = o.fill || th.cardBg;
    ctx.fill();
    ctx.shadowColor = "transparent";

    var rim = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    rim.addColorStop(0, th.dark ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.98)");
    rim.addColorStop(0.45, th.cardBorder);
    rim.addColorStop(1, th.cardBorder);
    ctx.strokeStyle = o.border || rim;
    ctx.lineWidth = o.borderWidth || 2;
    ctx.stroke();

    if (o.sheenP !== undefined) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius || 28);
      ctx.clip();
      var sx = x - w * 0.45 + o.sheenP * w * 1.9;
      var sh = ctx.createLinearGradient(sx, y, sx + w * 0.32, y + h * 0.7);
      sh.addColorStop(0, "rgba(255,255,255,0)");
      sh.addColorStop(0.5, th.dark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.42)");
      sh.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sh;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawKeynoteIcon(ctx, kind, cx, cy, r, accent, accent2) {
    var a1 = accent || "#0071E3";
    var a2 = accent2 || "#38BDF8";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    var grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, a1);
    grad.addColorStop(1, a2);
    ctx.strokeStyle = grad;
    ctx.fillStyle = grad;
    ctx.lineWidth = Math.max(4, r * 0.12);

    if (kind === "spark") {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.quadraticCurveTo(r * 0.14, -r * 0.14, r * 0.85, 0);
      ctx.quadraticCurveTo(r * 0.14, r * 0.14, 0, r * 0.85);
      ctx.quadraticCurveTo(-r * 0.14, r * 0.14, -r * 0.85, 0);
      ctx.quadraticCurveTo(-r * 0.14, -r * 0.14, 0, -r * 0.85);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "bolt") {
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 0.85);
      ctx.lineTo(-r * 0.48, r * 0.08);
      ctx.lineTo(r * 0.04, r * 0.08);
      ctx.lineTo(-r * 0.16, r * 0.85);
      ctx.lineTo(r * 0.48, -r * 0.12);
      ctx.lineTo(-r * 0.04, -r * 0.12);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "shield") {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.8);
      ctx.lineTo(r * 0.65, -r * 0.5);
      ctx.lineTo(r * 0.56, r * 0.2);
      ctx.quadraticCurveTo(0, r * 0.85, 0, r * 0.85);
      ctx.quadraticCurveTo(0, r * 0.85, -r * 0.56, r * 0.2);
      ctx.lineTo(-r * 0.65, -r * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.24, r * 0.02);
      ctx.lineTo(-r * 0.04, r * 0.22);
      ctx.lineTo(r * 0.3, -r * 0.18);
      ctx.stroke();
    } else if (kind === "cpu") {
      ctx.beginPath();
      ctx.roundRect(-r * 0.46, -r * 0.46, r * 0.92, r * 0.92, r * 0.16);
      ctx.stroke();
      ctx.fillRect(-r * 0.2, -r * 0.2, r * 0.4, r * 0.4);
      [-0.24, 0, 0.24].forEach(function (off) {
        ctx.beginPath();
        ctx.moveTo(off * r, -r * 0.46); ctx.lineTo(off * r, -r * 0.72);
        ctx.moveTo(off * r, r * 0.46); ctx.lineTo(off * r, r * 0.72);
        ctx.moveTo(-r * 0.46, off * r); ctx.lineTo(-r * 0.72, off * r);
        ctx.moveTo(r * 0.46, off * r); ctx.lineTo(r * 0.72, off * r);
        ctx.stroke();
      });
    } else if (kind === "layers") {
      [-0.36, 0, 0.36].forEach(function (dy, idx) {
        ctx.beginPath();
        ctx.moveTo(0, (dy - 0.24) * r);
        ctx.lineTo(r * 0.72, dy * r);
        ctx.lineTo(0, (dy + 0.24) * r);
        ctx.lineTo(-r * 0.72, dy * r);
        ctx.closePath();
        if (idx === 0) ctx.fill();
        else ctx.stroke();
      });
    } else if (kind === "globe") {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.34, r * 0.72, 0, 0, Math.PI * 2);
      ctx.moveTo(-r * 0.72, 0); ctx.lineTo(r * 0.72, 0);
      ctx.stroke();
    } else if (kind === "wave") {
      [-0.54, -0.27, 0, 0.27, 0.54].forEach(function (x, i) {
        var bh = [0.35, 0.72, 1.0, 0.68, 0.4][i] * r * 0.72;
        ctx.beginPath();
        ctx.moveTo(x * r, -bh);
        ctx.lineTo(x * r, bh);
        ctx.stroke();
      });
    } else if (kind === "lock") {
      ctx.beginPath();
      ctx.arc(0, -r * 0.24, r * 0.32, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-r * 0.52, -r * 0.14, r * 1.04, r * 0.84, r * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, r * 0.26, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "camera") {
      ctx.beginPath();
      ctx.roundRect(-r * 0.72, -r * 0.44, r * 1.44, r * 0.96, r * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, r * 0.04, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === "play") {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.34);
      ctx.lineTo(r * 0.38, 0);
      ctx.lineTo(-r * 0.2, r * 0.34);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "chart") {
      [-0.44, 0, 0.44].forEach(function (x, i) {
        var bh = [0.42, 0.72, 1.0][i] * r * 1.1;
        ctx.beginPath();
        ctx.roundRect(x * r - r * 0.14, r * 0.56 - bh, r * 0.28, bh, 8);
        ctx.fill();
      });
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.32, r * 0.02);
      ctx.lineTo(-r * 0.06, r * 0.28);
      ctx.lineTo(r * 0.36, -r * 0.24);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDeviceMockup(ctx, kind, cx, cy, boxW, boxH, th, opts) {
    var o = opts || {};
    var accent = o.accent || th.accent;
    var accent2 = o.accent2 || th.accent2;
    var p = o.localTime || 0;
    ctx.save();
    ctx.translate(cx, cy + Math.sin(p * 1.6) * 5);

    // Soft studio glow pedestal under device
    var gRad = ctx.createRadialGradient(0, boxH * 0.28, 12, 0, boxH * 0.28, Math.max(boxW, boxH) * 0.55);
    gRad.addColorStop(0, th.glow);
    gRad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gRad;
    ctx.fillRect(-boxW * 0.55, -boxH * 0.45, boxW * 1.1, boxH * 0.95);

    function drawScreenUI(sx, sy, sw, sh) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw, sh, 12);
      ctx.clip();
      if (o.imageObj && o.imageObj.complete && o.imageObj.naturalWidth > 0) {
        var iw = o.imageObj.naturalWidth, ih = o.imageObj.naturalHeight;
        var sc = Math.max(sw / iw, sh / ih);
        ctx.drawImage(o.imageObj, sx + (sw - iw * sc) / 2, sy + (sh - ih * sc) / 2, iw * sc, ih * sc);
      } else {
        var sg = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
        sg.addColorStop(0, "#090D16");
        sg.addColorStop(1, "#131C31");
        ctx.fillStyle = sg;
        ctx.fillRect(sx, sy, sw, sh);

        var orb = ctx.createRadialGradient(sx + sw * 0.68, sy + sh * 0.28, 8, sx + sw * 0.68, sy + sh * 0.28, sw * 0.48);
        orb.addColorStop(0, accent);
        orb.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = orb;
        ctx.fillRect(sx, sy, sw, sh);
        ctx.globalAlpha = 1;

        // Studio toolbar header
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(sx, sy, sw, 36);
        for (var di = 0; di < 3; di++) {
          ctx.fillStyle = ["#EF4444", "#F59E0B", "#38BDF8"][di];
          ctx.beginPath();
          ctx.arc(sx + 18 + di * 15, sy + 18, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (!o.silent) {
          ctx.fillStyle = "rgba(56,189,248,0.2)";
          ctx.beginPath();
          ctx.roundRect(sx + sw - 122, sy + 9, 108, 18, 9);
          ctx.fill();
          ctx.fillStyle = accent;
          ctx.font = "700 10px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("60 FPS • GPU", sx + sw - 68, sy + 18);
        }

        // Stage preview pane + live animated bezier curve
        var pad = 16;
        var prevH = sh * 0.44;
        ctx.fillStyle = "rgba(15,23,42,0.75)";
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(sx + pad, sy + 48, sw - pad * 2, prevH, 10);
        ctx.fill();
        ctx.stroke();

        // Sine motion curve inside monitor
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (var k = 0; k <= 36; k++) {
          var kx = sx + pad + 16 + ((sw - pad * 2 - 32) * k) / 36;
          var ky = sy + 48 + prevH * 0.5 + Math.sin(k * 0.35 + p * 3.2) * prevH * 0.25;
          if (k === 0) ctx.moveTo(kx, ky); else ctx.lineTo(kx, ky);
        }
        ctx.stroke();

        // Multi-track timeline bars + moving scrub playhead
        var trY = sy + 60 + prevH;
        var trW = sw - pad * 2;
        var colors = [accent, accent2, "#F59E0B"];
        for (var ti = 0; ti < 3; ti++) {
          var rowY = trY + ti * 24;
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.beginPath();
          ctx.roundRect(sx + pad, rowY, trW, 16, 6);
          ctx.fill();
          var segX = sx + pad + trW * (0.08 + ti * 0.16);
          var segW = trW * (0.34 + ((ti * 0.14) % 0.25));
          ctx.fillStyle = colors[ti];
          ctx.beginPath();
          ctx.roundRect(segX, rowY + 2, segW, 12, 4);
          ctx.fill();
        }
        var scrubX = sx + pad + ((p * 0.38) % 1) * trW;
        ctx.strokeStyle = "#F8FAFC";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(scrubX, trY - 6);
        ctx.lineTo(scrubX, trY + 72);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (kind === "phone") {
      var pw = Math.min(boxW * 0.62, boxH * 0.52);
      var ph = Math.min(boxH * 0.94, pw * 1.92);
      drawGlassCard(ctx, -pw / 2, -ph / 2, pw, ph, 42, th, { fill: "#18181B", border: "#71717A", borderWidth: 4, sheenP: (p * 0.3) % 1 });
      drawScreenUI(-pw / 2 + 12, -ph / 2 + 14, pw - 24, ph - 28);
      ctx.fillStyle = "#09090B";
      ctx.beginPath();
      ctx.roundRect(-pw * 0.16, -ph / 2 + 22, pw * 0.32, 16, 8);
      ctx.fill();
    } else if (kind === "tablet") {
      var tw = Math.min(boxW * 0.9, boxH * 1.24);
      var tht = Math.min(boxH * 0.86, tw * 0.72);
      drawGlassCard(ctx, -tw / 2, -tht / 2, tw, tht, 28, th, { fill: "#18181B", border: "#94A3B8", borderWidth: 4, sheenP: (p * 0.25) % 1 });
      drawScreenUI(-tw / 2 + 16, -tht / 2 + 16, tw - 32, tht - 32);
    } else if (kind === "watch") {
      var ww = Math.min(boxW, boxH) * 0.48;
      var wh = ww * 1.18;
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.roundRect(-ww * 0.34, -wh * 0.95, ww * 0.68, wh * 1.9, 18);
      ctx.fill();
      drawGlassCard(ctx, -ww / 2, -wh / 2, ww, wh, 38, th, { fill: "#18181B", border: accent, borderWidth: 4 });
      drawScreenUI(-ww / 2 + 12, -wh / 2 + 12, ww - 24, wh - 24);
    } else if (kind === "chip") {
      var cs = Math.min(boxW, boxH) * 0.68;
      drawGlassCard(ctx, -cs / 2, -cs / 2, cs, cs, 34, th, { fill: "#18181B", border: accent, borderWidth: 4, sheenP: (p * 0.35) % 1 });
      drawKeynoteIcon(ctx, "cpu", 0, 0, cs * 0.28, accent, accent2);
    } else if (kind === "card") {
      var cw = Math.min(boxW * 0.88, boxH * 1.48);
      var ch = Math.min(boxH * 0.72, cw * 0.62);
      var cg = ctx.createLinearGradient(-cw / 2, -ch / 2, cw / 2, ch / 2);
      cg.addColorStop(0, accent);
      cg.addColorStop(1, accent2);
      drawGlassCard(ctx, -cw / 2, -ch / 2, cw, ch, 28, th, { fill: cg, border: "rgba(255,255,255,0.45)", borderWidth: 2, sheenP: (p * 0.3) % 1 });
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.roundRect(-cw * 0.38, -ch * 0.16, cw * 0.16, ch * 0.24, 8);
      ctx.fill();
    } else {
      var lw = Math.min(boxW * 0.94, boxH * 1.42);
      var lh = Math.min(boxH * 0.76, lw * 0.64);
      var lidRim = ctx.createLinearGradient(-lw / 2, -lh / 2, lw / 2, lh / 2);
      lidRim.addColorStop(0, "#CBD5E1");
      lidRim.addColorStop(0.5, "#64748B");
      lidRim.addColorStop(1, "#94A3B8");
      drawGlassCard(ctx, -lw / 2, -lh / 2 - 12, lw, lh, 22, th, { fill: "#111827", border: lidRim, borderWidth: 4, sheenP: (p * 0.28) % 1 });
      drawScreenUI(-lw / 2 + 16, -lh / 2 + 4, lw - 32, lh - 32);
      var baseG = ctx.createLinearGradient(-lw * 0.56, 0, lw * 0.56, 0);
      baseG.addColorStop(0, "#64748B");
      baseG.addColorStop(0.5, "#F1F5F9");
      baseG.addColorStop(1, "#64748B");
      ctx.fillStyle = baseG;
      ctx.beginPath();
      ctx.roundRect(-lw * 0.56, lh / 2 - 10, lw * 1.12, 22, [4, 4, 14, 14]);
      ctx.fill();
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.roundRect(-lw * 0.1, lh / 2 - 10, lw * 0.2, 6, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  GLOBAL_SCOPE.KeynoteKit = {
    KEYNOTE_THEMES: KEYNOTE_THEMES,
    DEVICE_KINDS: DEVICE_KINDS,
    ICON_KINDS: ICON_KINDS,
    drawStudioBackground: drawStudioBackground,
    drawGlassCard: drawGlassCard,
    drawKeynoteIcon: drawKeynoteIcon,
    drawDeviceMockup: drawDeviceMockup
  };
})();
