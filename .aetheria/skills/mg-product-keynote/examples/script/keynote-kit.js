(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var KEYNOTE_THEMES = ["pearl-studio", "obsidian-pro", "titanium-warm", "aurora-keynote", "mint-editorial"];
  var DEVICE_KINDS = ["laptop", "phone", "tablet", "watch", "chip", "card"];
  var ICON_KINDS = ["spark", "bolt", "shield", "cpu", "layers", "globe", "wave", "lock", "camera", "play", "chart", "check"];

  var THEME_MAP = {
    "pearl-studio": {
      bgTop: "#FFFFFF", bgBot: "#EBEBEF", ink: "#1D1D1F", muted: "#6E6E73",
      cardBg: "rgba(255,255,255,0.88)", cardBorder: "rgba(29,29,31,0.10)",
      accent: "#0071E3", accent2: "#38BDF8", glow: "rgba(0,113,227,0.14)", dark: false
    },
    "obsidian-pro": {
      bgTop: "#111216", bgBot: "#050507", ink: "#F5F5F7", muted: "#A1A1A6",
      cardBg: "rgba(28,28,34,0.82)", cardBorder: "rgba(255,255,255,0.14)",
      accent: "#2997FF", accent2: "#A855F7", glow: "rgba(41,151,255,0.22)", dark: true
    },
    "titanium-warm": {
      bgTop: "#211F1D", bgBot: "#11100E", ink: "#F6F3EC", muted: "#B5AFA4",
      cardBg: "rgba(40,37,34,0.84)", cardBorder: "rgba(226,199,153,0.22)",
      accent: "#E2C799", accent2: "#F59E0B", glow: "rgba(226,199,153,0.18)", dark: true
    },
    "aurora-keynote": {
      bgTop: "#0C112B", bgBot: "#060814", ink: "#F8FAFC", muted: "#94A3B8",
      cardBg: "rgba(18,26,56,0.72)", cardBorder: "rgba(148,163,184,0.22)",
      accent: "#38BDF8", accent2: "#C084FC", glow: "rgba(56,189,248,0.24)", dark: true
    },
    "mint-editorial": {
      bgTop: "#F8FCFA", bgBot: "#E6F2EC", ink: "#0F172A", muted: "#475569",
      cardBg: "rgba(255,255,255,0.90)", cardBorder: "rgba(15,23,42,0.10)",
      accent: "#059669", accent2: "#0EA5E9", glow: "rgba(5,150,105,0.16)", dark: false
    }
  };

  function drawStudioBackground(ctx, w, h, themeName, globalT) {
    var th = THEME_MAP[themeName] || THEME_MAP["pearl-studio"];
    ctx.save();
    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, th.bgTop);
    bg.addColorStop(1, th.bgBot);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle moving ambient studio orb glow
    var gx = w * (0.5 + Math.sin(globalT * 0.45) * 0.14);
    var gy = h * (0.38 + Math.cos(globalT * 0.35) * 0.08);
    var orb = ctx.createRadialGradient(gx, gy, 20, gx, gy, Math.max(w, h) * 0.56);
    orb.addColorStop(0, th.glow);
    orb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);

    if (themeName === "aurora-keynote") {
      var gx2 = w * (0.28 + Math.cos(globalT * 0.4) * 0.12);
      var gy2 = h * 0.65;
      var orb2 = ctx.createRadialGradient(gx2, gy2, 10, gx2, gy2, Math.max(w, h) * 0.44);
      orb2.addColorStop(0, "rgba(192,132,252,0.20)");
      orb2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = orb2;
      ctx.fillRect(0, 0, w, h);
    }

    // Ultra-fine studio grid hairline
    ctx.strokeStyle = th.dark ? "rgba(255,255,255,0.03)" : "rgba(15,23,42,0.035)";
    ctx.lineWidth = 1;
    var step = 96;
    for (var x = step; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var y = step; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
    return th;
  }

  function drawGlassCard(ctx, x, y, w, h, radius, th, opts) {
    var o = opts || {};
    ctx.save();
    ctx.shadowColor = th.dark ? "rgba(0,0,0,0.45)" : "rgba(15,23,42,0.10)";
    ctx.shadowBlur = o.shadowBlur !== undefined ? o.shadowBlur : 32;
    ctx.shadowOffsetY = o.shadowY !== undefined ? o.shadowY : 14;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius || 28);
    ctx.fillStyle = o.fill || th.cardBg;
    ctx.fill();
    ctx.shadowColor = "transparent";

    // Top specular rim highlight
    var rim = ctx.createLinearGradient(x, y, x, y + h);
    rim.addColorStop(0, th.dark ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.95)");
    rim.addColorStop(0.45, th.cardBorder);
    rim.addColorStop(1, th.cardBorder);
    ctx.strokeStyle = o.border || rim;
    ctx.lineWidth = o.borderWidth || 2;
    ctx.stroke();

    // Animated diagonal glass sheen
    if (o.sheenP !== undefined) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius || 28);
      ctx.clip();
      var sx = x - w * 0.4 + o.sheenP * w * 1.8;
      var sh = ctx.createLinearGradient(sx, y, sx + w * 0.35, y + h * 0.6);
      sh.addColorStop(0, "rgba(255,255,255,0)");
      sh.addColorStop(0.5, th.dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.35)");
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
      // check
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
    ctx.translate(cx, cy + Math.sin(p * 1.6) * 6);

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
        sg.addColorStop(0, "#0F172A");
        sg.addColorStop(1, "#1E293B");
        ctx.fillStyle = sg;
        ctx.fillRect(sx, sy, sw, sh);
        // Clean abstract studio UI bars + glow ring
        var orb = ctx.createRadialGradient(sx + sw * 0.72, sy + sh * 0.32, 8, sx + sw * 0.72, sy + sh * 0.32, sw * 0.45);
        orb.addColorStop(0, accent);
        orb.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = orb;
        ctx.fillRect(sx, sy, sw, sh);
        ctx.globalAlpha = 1;
        // Top window dots
        for (var di = 0; di < 3; di++) {
          ctx.fillStyle = ["#EF4444", "#F59E0B", "#10B981"][di];
          ctx.beginPath();
          ctx.arc(sx + 20 + di * 16, sy + 18, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Abstract metric bars
        var barW = (sw - 64) / 3;
        for (var bi = 0; bi < 3; bi++) {
          var bh = sh * (0.28 + bi * 0.14) * (0.85 + Math.sin(p * 2 + bi) * 0.08);
          ctx.fillStyle = bi === 2 ? accent : "rgba(255,255,255,0.16)";
          ctx.beginPath();
          ctx.roundRect(sx + 24 + bi * (barW + 8), sy + sh - 24 - bh, barW, bh, 8);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    if (kind === "phone") {
      var pw = Math.min(boxW * 0.56, boxH * 0.52);
      var ph = Math.min(boxH * 0.94, pw * 1.95);
      drawGlassCard(ctx, -pw / 2, -ph / 2, pw, ph, 38, th, { fill: "#18181B", border: "#71717A", borderWidth: 4, sheenP: (p * 0.3) % 1 });
      drawScreenUI(-pw / 2 + 12, -ph / 2 + 14, pw - 24, ph - 28);
      ctx.fillStyle = "#09090B";
      ctx.beginPath();
      ctx.roundRect(-pw * 0.16, -ph / 2 + 22, pw * 0.32, 16, 8);
      ctx.fill();
    } else if (kind === "tablet") {
      var tw = Math.min(boxW * 0.88, boxH * 1.28);
      var tht = Math.min(boxH * 0.86, tw * 0.72);
      drawGlassCard(ctx, -tw / 2, -tht / 2, tw, tht, 28, th, { fill: "#18181B", border: "#94A3B8", borderWidth: 4, sheenP: (p * 0.25) % 1 });
      drawScreenUI(-tw / 2 + 16, -tht / 2 + 16, tw - 32, tht - 32);
    } else if (kind === "watch") {
      var ww = Math.min(boxW, boxH) * 0.46;
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
      var cw = Math.min(boxW * 0.86, boxH * 1.48);
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
      // laptop (default)
      var lw = Math.min(boxW * 0.86, boxH * 1.46);
      var lh = Math.min(boxH * 0.76, lw * 0.62);
      drawGlassCard(ctx, -lw / 2, -lh / 2 - 12, lw, lh, 22, th, { fill: "#18181B", border: "#94A3B8", borderWidth: 4, sheenP: (p * 0.25) % 1 });
      drawScreenUI(-lw / 2 + 16, -lh / 2 + 4, lw - 32, lh - 32);
      // Aluminum laptop base lip
      var baseG = ctx.createLinearGradient(-lw * 0.58, 0, lw * 0.58, 0);
      baseG.addColorStop(0, "#94A3B8");
      baseG.addColorStop(0.5, "#E2E8F0");
      baseG.addColorStop(1, "#94A3B8");
      ctx.fillStyle = baseG;
      ctx.beginPath();
      ctx.roundRect(-lw * 0.58, lh / 2 - 10, lw * 1.16, 20, [4, 4, 14, 14]);
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
