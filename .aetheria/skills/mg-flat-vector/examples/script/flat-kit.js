(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var THEMES = {
    "clean-light": { bg: "#F8FAFC", surface: "#FFFFFF", ink: "#0F172A", muted: "#475569", accent: "#2563EB", accent2: "#10B981", dot: "rgba(15,23,42,0.06)", border: "#E2E8F0", dark: false },
    "midnight-tech": { bg: "#0F172A", surface: "#1E293B", ink: "#F8FAFC", muted: "#94A3B8", accent: "#38BDF8", accent2: "#F59E0B", dot: "rgba(248,250,252,0.07)", border: "#334155", dark: true },
    "mint-fresh": { bg: "#ECFDF5", surface: "#FFFFFF", ink: "#064E3B", muted: "#047857", accent: "#10B981", accent2: "#0EA5E9", dot: "rgba(6,78,59,0.07)", border: "#A7F3D0", dark: false },
    "coral-pop": { bg: "#FFF7ED", surface: "#FFFFFF", ink: "#1C1917", muted: "#57534E", accent: "#F97316", accent2: "#EF4444", dot: "rgba(28,25,23,0.06)", border: "#FED7AA", dark: false },
    "cobalt-deck": { bg: "#1E3A8A", surface: "#172554", ink: "#F8FAFC", muted: "#BFDBFE", accent: "#FACC15", accent2: "#38BDF8", dot: "rgba(255,255,255,0.08)", border: "#3B82F6", dark: true }
  };

  function drawFlatBackground(ctx, w, h, themeName, t) {
    var th = THEMES[themeName] || THEMES["clean-light"];
    ctx.save();
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, w, h);

    // Clean flat decorative corner circles
    ctx.globalAlpha = th.dark ? 0.14 : 0.12;
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.arc(w * 0.88, h * 0.12 + Math.sin(t * 1.1) * 12, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.accent2;
    ctx.beginPath();
    ctx.arc(w * 0.1, h * 0.86 + Math.cos(t * 0.9) * 12, Math.min(w, h) * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Crisp dot matrix
    ctx.fillStyle = th.dot;
    var step = 52;
    for (var y = 26; y < h; y += step) {
      for (var x = 26; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return th;
  }

  function drawFlatCard(ctx, x, y, w, h, r, th, opts) {
    var o = opts || {};
    ctx.save();
    ctx.fillStyle = th.dark ? "rgba(0,0,0,0.28)" : "rgba(15,23,42,0.08)";
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 10, w, h, r || 26);
    ctx.fill();

    ctx.fillStyle = o.fill || th.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r || 26);
    ctx.fill();
    ctx.strokeStyle = o.border || th.border;
    ctx.lineWidth = o.borderWidth || 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawFlatIcon(ctx, kind, cx, cy, r, accent, accent2, t) {
    var a1 = accent || "#2563EB";
    var a2 = accent2 || "#10B981";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (kind === "dot-flow") {
      var pts = [[-0.55, 0.2], [0, -0.35], [0.55, 0.2]];
      ctx.strokeStyle = a1;
      ctx.lineWidth = Math.max(6, r * 0.14);
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * r, pts[0][1] * r);
      ctx.lineTo(pts[1][0] * r, pts[1][1] * r);
      ctx.lineTo(pts[2][0] * r, pts[2][1] * r);
      ctx.stroke();
      pts.forEach(function (pt, i) {
        ctx.fillStyle = i === 1 ? a2 : a1;
        ctx.beginPath();
        ctx.arc(pt[0] * r, pt[1] * r, r * (0.22 + (i === 1 ? Math.sin((t || 0) * 3) * 0.03 : 0)), 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (kind === "chart") {
      [[-0.45, 0.45, a2], [0, 0.72, a1], [0.45, 0.96, a2]].forEach(function (b) {
        var bh = r * 1.2 * b[1];
        ctx.fillStyle = b[2];
        ctx.beginPath();
        ctx.roundRect(b[0] * r - r * 0.16, r * 0.6 - bh, r * 0.32, bh, 10);
        ctx.fill();
      });
    } else if (kind === "clock") {
      ctx.fillStyle = a1;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = a2; ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.36); ctx.moveTo(0, 0); ctx.lineTo(r * 0.3, r * 0.12); ctx.stroke();
    } else if (kind === "shield") {
      ctx.fillStyle = a1;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.8); ctx.lineTo(r * 0.66, -r * 0.5); ctx.lineTo(r * 0.54, r * 0.22);
      ctx.quadraticCurveTo(0, r * 0.84, 0, r * 0.84); ctx.quadraticCurveTo(0, r * 0.84, -r * 0.54, r * 0.22);
      ctx.lineTo(-r * 0.66, -r * 0.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(-r * 0.24, 0); ctx.lineTo(-r * 0.04, r * 0.22); ctx.lineTo(r * 0.3, -r * 0.2); ctx.stroke();
    } else if (kind === "rocket") {
      ctx.rotate(-0.4);
      ctx.fillStyle = a1;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.82); ctx.quadraticCurveTo(r * 0.42, -r * 0.15, r * 0.28, r * 0.45);
      ctx.lineTo(-r * 0.28, r * 0.45); ctx.quadraticCurveTo(-r * 0.42, -r * 0.15, 0, -r * 0.82); ctx.fill();
      ctx.fillStyle = a2;
      ctx.beginPath(); ctx.moveTo(-r * 0.26, r * 0.16); ctx.lineTo(-r * 0.58, r * 0.56); ctx.lineTo(-r * 0.2, r * 0.45); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.26, r * 0.16); ctx.lineTo(r * 0.58, r * 0.56); ctx.lineTo(r * 0.2, r * 0.45); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "bulb") {
      ctx.fillStyle = a2; ctx.beginPath(); ctx.arc(0, -r * 0.16, r * 0.52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = a1; ctx.beginPath(); ctx.roundRect(-r * 0.24, r * 0.3, r * 0.48, r * 0.36, 8); ctx.fill();
    } else if (kind === "gear") {
      ctx.fillStyle = a1;
      ctx.beginPath();
      for (var i = 0; i < 16; i++) {
        var rr = i % 2 === 0 ? r * 0.78 : r * 0.56;
        var ang = (i / 16) * Math.PI * 2 + (t || 0) * 0.6;
        if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "globe") {
      ctx.fillStyle = a1; ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = r * 0.09;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.34, r * 0.72, 0, 0, Math.PI * 2); ctx.moveTo(-r * 0.72, 0); ctx.lineTo(r * 0.72, 0); ctx.stroke();
    } else if (kind === "coin") {
      ctx.fillStyle = a2; ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.arc(0, 0, r * 0.54, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === "leaf") {
      ctx.fillStyle = a2;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.5); ctx.quadraticCurveTo(-r * 0.6, -r * 0.6, r * 0.6, -r * 0.6); ctx.quadraticCurveTo(r * 0.6, r * 0.6, -r * 0.5, r * 0.5); ctx.fill();
      ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(-r * 0.45, r * 0.45); ctx.lineTo(r * 0.35, -r * 0.35); ctx.stroke();
    } else if (kind === "phone") {
      ctx.fillStyle = a1; ctx.beginPath(); ctx.roundRect(-r * 0.42, -r * 0.72, r * 0.84, r * 1.44, 18); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.roundRect(-r * 0.32, -r * 0.54, r * 0.64, r * 1.04, 10); ctx.fill();
      ctx.fillStyle = a2; ctx.beginPath(); ctx.roundRect(-r * 0.22, -r * 0.36, r * 0.44, r * 0.24, 6); ctx.fill();
    } else {
      ctx.fillStyle = a2; ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = r * 0.16;
      ctx.beginPath(); ctx.moveTo(-r * 0.3, 0.02 * r); ctx.lineTo(-r * 0.06, r * 0.26); ctx.lineTo(r * 0.34, -r * 0.22); ctx.stroke();
    }
    ctx.restore();
  }

  GLOBAL_SCOPE.FlatKit = {
    THEMES: THEMES,
    drawFlatBackground: drawFlatBackground,
    drawFlatCard: drawFlatCard,
    drawFlatIcon: drawFlatIcon
  };
})();
