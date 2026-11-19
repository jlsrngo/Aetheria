(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  var PAPER_THEMES = ["kraft", "newsprint", "corkboard", "charcoal", "scrapbook"];
  var CUTOUT_KINDS = [
    "portrait",
    "brain",
    "globe",
    "rocket",
    "eye",
    "hand-point",
    "rose",
    "clock",
    "gear",
    "megaphone",
    "book",
    "coin",
    "chart",
    "lightbulb",
    "phone",
    "camera"
  ];
  var ACCENT_KINDS = [
    "rose",
    "manicule",
    "gear",
    "wax-seal",
    "star",
    "arrow",
    "paperclip",
    "scissors"
  ];

  var THEME_COLORS = {
    kraft: { bg: "#D7BE9B", grain: "rgba(92,64,36,0.08)", dot: "rgba(62,42,24,0.08)", ink: "#1A1A1A", paper: "#F4EFE4" },
    newsprint: { bg: "#E9E1CF", grain: "rgba(40,36,30,0.07)", dot: "rgba(26,26,26,0.07)", ink: "#1A1A1A", paper: "#FAF6EC" },
    corkboard: { bg: "#C29666", grain: "rgba(84,48,18,0.12)", dot: "rgba(56,32,12,0.10)", ink: "#1A1A1A", paper: "#F7F1E3" },
    charcoal: { bg: "#201D1A", grain: "rgba(244,239,228,0.05)", dot: "rgba(244,239,228,0.07)", ink: "#F4EFE4", paper: "#F4EFE4" },
    scrapbook: { bg: "#F2E2CE", grain: "rgba(130,86,54,0.06)", dot: "rgba(180,90,70,0.08)", ink: "#1F1A17", paper: "#FFFDF7" }
  };

  function hashStr(s) {
    var h = 2166136261 >>> 0;
    var str = String(s || "collage");
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  function makeRng(seed) {
    var s = (typeof seed === "number" ? seed : hashStr(seed)) >>> 0;
    return function () {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function boilOffset(seedKey, globalT, boilFps) {
    var step = Math.floor(Math.max(0, globalT) * (boilFps || 12));
    var rng = makeRng(String(seedKey) + ":" + step);
    return {
      dx: (rng() - 0.5) * 3.0,
      dy: (rng() - 0.5) * 3.0,
      rot: (rng() - 0.5) * 0.018
    };
  }

  function drawPaperBackground(ctx, w, h, themeName, globalT) {
    var th = THEME_COLORS[themeName] || THEME_COLORS.kraft;
    ctx.save();
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, w, h);

    // Soft editorial vignette
    var grad = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    grad.addColorStop(0, "rgba(255,255,255,0.08)");
    grad.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Deterministic subtle halftone grid & fiber flecks
    var rng = makeRng("bg:" + themeName);
    ctx.fillStyle = th.dot;
    var step = 36;
    for (var y = 18; y < h; y += step) {
      for (var x = 18; x < w; x += step) {
        if ((x + y) % 72 === 0) {
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = th.grain;
    ctx.lineWidth = 1.5;
    for (var i = 0; i < 65; i++) {
      var fx = rng() * w;
      var fy = rng() * h;
      var fl = 12 + rng() * 28;
      var ang = rng() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(ang) * fl, fy + Math.sin(ang) * fl);
      ctx.stroke();
    }

    // Subtle animated dust grain on 12fps grid
    var boil = Math.floor(Math.max(0, globalT || 0) * 12);
    var drng = makeRng("dust:" + boil);
    ctx.fillStyle = themeName === "charcoal" ? "rgba(255,255,255,0.06)" : "rgba(26,26,26,0.05)";
    for (var d = 0; d < 18; d++) {
      ctx.fillRect(drng() * w, drng() * h, 3, 3);
    }
    ctx.restore();
    return th;
  }

  function traceTornRect(ctx, x, y, w, h, seed, jag) {
    var rng = makeRng(seed);
    var j = jag || 5;
    var segX = Math.max(6, Math.round(w / 44));
    var segY = Math.max(6, Math.round(h / 44));
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (var i = 1; i <= segX; i++) {
      ctx.lineTo(x + (w * i) / segX, y + (i === segX ? 0 : (rng() - 0.5) * j * 2));
    }
    for (var k = 1; k <= segY; k++) {
      ctx.lineTo(x + w + (k === segY ? 0 : (rng() - 0.5) * j * 2), y + (h * k) / segY);
    }
    for (var m = segX - 1; m >= 0; m--) {
      ctx.lineTo(x + (w * m) / segX, y + h + (m === 0 ? 0 : (rng() - 0.5) * j * 2));
    }
    for (var n = segY - 1; n >= 1; n--) {
      ctx.lineTo(x + (rng() - 0.5) * j * 2, y + (h * n) / segY);
    }
    ctx.closePath();
  }

  function drawTornScrap(ctx, x, y, w, h, opts) {
    var o = opts || {};
    var angle = o.angle || 0;
    var fill = o.fill || "#F4EFE4";
    var seed = o.seed || "scrap";
    var style = o.style || "newsprint";
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(18,14,10,0.28)";
    ctx.shadowBlur = o.shadowBlur !== undefined ? o.shadowBlur : 16;
    ctx.shadowOffsetX = 8;
    ctx.shadowOffsetY = 10;
    traceTornRect(ctx, -w / 2, -h / 2, w, h, seed, o.jag || 5);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.save();
    ctx.clip();
    if (style === "newsprint") {
      ctx.fillStyle = "rgba(30,26,22,0.10)";
      var cols = 2;
      var colW = (w - 60) / cols;
      for (var c = 0; c < cols; c++) {
        var cx = -w / 2 + 24 + c * (colW + 12);
        for (var ry = -h / 2 + 28; ry < h / 2 - 22; ry += 18) {
          var lw = colW * (0.65 + ((Math.abs(ry * 7 + c * 13) % 35) / 100));
          ctx.fillRect(cx, ry, lw, 6);
        }
      }
    } else if (style === "lined") {
      ctx.strokeStyle = "rgba(59,130,246,0.22)";
      ctx.lineWidth = 2;
      for (var ly = -h / 2 + 34; ly < h / 2 - 16; ly += 28) {
        ctx.beginPath();
        ctx.moveTo(-w / 2 + 16, ly);
        ctx.lineTo(w / 2 - 16, ly);
        ctx.stroke();
      }
    } else if (style === "grid") {
      ctx.strokeStyle = "rgba(30,26,22,0.10)";
      ctx.lineWidth = 1.5;
      for (var gx = -w / 2 + 24; gx < w / 2; gx += 28) {
        ctx.beginPath();
        ctx.moveTo(gx, -h / 2);
        ctx.lineTo(gx, h / 2);
        ctx.stroke();
      }
      for (var gy = -h / 2 + 24; gy < h / 2; gy += 28) {
        ctx.beginPath();
        ctx.moveTo(-w / 2, gy);
        ctx.lineTo(w / 2, gy);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(26,26,26,0.22)";
    ctx.lineWidth = 2;
    traceTornRect(ctx, -w / 2, -h / 2, w, h, seed, o.jag || 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawWashiTape(ctx, cx, cy, len, width, angle, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle || 0);
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = color || "#E8D5A7";
    traceTornRect(ctx, -len / 2, -width / 2, len, width, "tape:" + Math.round(cx + cy), 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(26,26,26,0.15)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawPushPin(ctx, cx, cy, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.arc(5, 7, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color || "#C0392B";
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1A1A1A";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.arc(-5, -5, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStamp(ctx, cx, cy, text, color, angle) {
    if (!text) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle || -0.16);
    ctx.font = "900 28px 'Impact', 'Arial Black', sans-serif";
    var tw = Math.max(120, ctx.measureText(text.toUpperCase()).width + 36);
    var th = 50;
    ctx.strokeStyle = color || "#C0392B";
    ctx.lineWidth = 5;
    ctx.strokeRect(-tw / 2, -th / 2, tw, th);
    ctx.lineWidth = 2;
    ctx.strokeRect(-tw / 2 + 6, -th / 2 + 6, tw - 12, th - 12);
    ctx.fillStyle = color || "#C0392B";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.toUpperCase(), 0, 2);
    ctx.restore();
  }

  function drawCutoutGlyph(ctx, kind, r, primary, accent) {
    var p = primary || "#C0392B";
    var a = accent || "#F59E0B";
    var ink = "#1A1A1A";
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (kind === "portrait") {
      // Dada surrealist portrait silhouette + hinged head lid + eyes
      ctx.fillStyle = "#2C3E50";
      ctx.beginPath();
      ctx.roundRect(-r * 0.62, r * 0.25, r * 1.24, r * 0.62, r * 0.25);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = "#F4D6B8";
      ctx.beginPath();
      ctx.arc(0, -r * 0.14, r * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Vintage bowler/lid hat tilted open
      ctx.save();
      ctx.translate(r * 0.12, -r * 0.56);
      ctx.rotate(0.24);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.52, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -r * 0.04, r * 0.34, Math.PI, 0);
      ctx.fill();
      ctx.restore();
      // Expressive cutout eyes & mustache
      ctx.fillStyle = "#FFFDF7";
      ctx.beginPath();
      ctx.ellipse(-r * 0.16, -r * 0.16, r * 0.11, r * 0.08, 0, 0, Math.PI * 2);
      ctx.ellipse(r * 0.16, -r * 0.16, r * 0.11, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(-r * 0.15, -r * 0.16, r * 0.045, 0, Math.PI * 2);
      ctx.arc(r * 0.17, -r * 0.16, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p;
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, r * 0.06);
      ctx.quadraticCurveTo(0, r * 0.18, r * 0.18, r * 0.06);
      ctx.lineWidth = 6;
      ctx.stroke();
    } else if (kind === "brain") {
      ctx.fillStyle = "#F48FB1";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      [[-0.24, -0.14, 0.34], [0.24, -0.14, 0.34], [-0.34, 0.12, 0.28], [0.34, 0.12, 0.28], [0, -0.26, 0.32], [0, 0.14, 0.3]].forEach(function (c) {
        ctx.beginPath();
        ctx.arc(c[0] * r, c[1] * r, c[2] * r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.strokeStyle = "#880E4F";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.45);
      ctx.lineTo(0, r * 0.36);
      ctx.stroke();
    } else if (kind === "globe") {
      ctx.fillStyle = "#38BDF8";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#4ADE80";
      ctx.beginPath();
      ctx.ellipse(-r * 0.2, -r * 0.14, r * 0.24, r * 0.18, 0.3, 0, Math.PI * 2);
      ctx.ellipse(r * 0.22, r * 0.12, r * 0.26, r * 0.22, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(26,26,26,0.35)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.34, r * 0.68, 0, 0, Math.PI * 2);
      ctx.moveTo(-r * 0.68, 0);
      ctx.lineTo(r * 0.68, 0);
      ctx.stroke();
    } else if (kind === "rocket") {
      ctx.save();
      ctx.rotate(-0.45);
      ctx.fillStyle = "#F4EFE4";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.78);
      ctx.quadraticCurveTo(r * 0.38, -r * 0.2, r * 0.28, r * 0.45);
      ctx.lineTo(-r * 0.28, r * 0.45);
      ctx.quadraticCurveTo(-r * 0.38, -r * 0.2, 0, -r * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p;
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, r * 0.15);
      ctx.lineTo(-r * 0.56, r * 0.55);
      ctx.lineTo(-r * 0.22, r * 0.45);
      ctx.closePath();
      ctx.moveTo(r * 0.28, r * 0.15);
      ctx.lineTo(r * 0.56, r * 0.55);
      ctx.lineTo(r * 0.22, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#38BDF8";
      ctx.beginPath();
      ctx.arc(0, -r * 0.12, r * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, r * 0.48);
      ctx.lineTo(0, r * 0.85);
      ctx.lineTo(r * 0.18, r * 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (kind === "eye") {
      ctx.fillStyle = "#FFFDF7";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, 0);
      ctx.quadraticCurveTo(0, -r * 0.62, r * 0.78, 0);
      ctx.quadraticCurveTo(0, r * 0.62, -r * 0.78, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "hand-point") {
      ctx.fillStyle = "#F4D6B8";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(-r * 0.68, -r * 0.26, r * 0.78, r * 0.56, r * 0.16);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-r * 0.1, -r * 0.24, r * 0.84, r * 0.22, r * 0.11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p;
      ctx.fillRect(-r * 0.78, -r * 0.3, r * 0.22, r * 0.64);
      ctx.strokeRect(-r * 0.78, -r * 0.3, r * 0.22, r * 0.64);
    } else if (kind === "rose") {
      ctx.strokeStyle = "#15803D";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.15);
      ctx.lineTo(0, r * 0.78);
      ctx.stroke();
      ctx.fillStyle = "#22C55E";
      ctx.beginPath();
      ctx.ellipse(-r * 0.22, r * 0.45, r * 0.22, r * 0.1, -0.5, 0, Math.PI * 2);
      ctx.ellipse(r * 0.22, r * 0.52, r * 0.22, r * 0.1, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 4;
      for (var i = 0; i < 6; i++) {
        var ang = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * r * 0.24, -r * 0.15 + Math.sin(ang) * r * 0.24, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(0, -r * 0.15, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === "clock") {
      ctx.fillStyle = "#FFFDF7";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = p;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.38);
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.32, r * 0.14);
      ctx.stroke();
    } else if (kind === "gear") {
      ctx.fillStyle = a;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      var teeth = 8;
      ctx.beginPath();
      for (var t = 0; t < teeth * 2; t++) {
        var rr = t % 2 === 0 ? r * 0.68 : r * 0.5;
        var a0 = (t / (teeth * 2)) * Math.PI * 2;
        if (t === 0) ctx.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
        else ctx.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#F4EFE4";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === "megaphone") {
      ctx.fillStyle = p;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.18);
      ctx.lineTo(r * 0.52, -r * 0.56);
      ctx.lineTo(r * 0.52, r * 0.42);
      ctx.lineTo(-r * 0.55, r * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = a;
      ctx.fillRect(-r * 0.42, r * 0.1, r * 0.2, r * 0.45);
      ctx.strokeRect(-r * 0.42, r * 0.1, r * 0.2, r * 0.45);
    } else if (kind === "book") {
      ctx.fillStyle = p;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(-r * 0.62, -r * 0.52, r * 1.24, r * 1.04, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FFFDF7";
      ctx.fillRect(-r * 0.48, -r * 0.42, r * 0.42, r * 0.84);
      ctx.fillRect(r * 0.06, -r * 0.42, r * 0.42, r * 0.84);
      ctx.strokeRect(-r * 0.48, -r * 0.42, r * 0.42, r * 0.84);
      ctx.strokeRect(r * 0.06, -r * 0.42, r * 0.42, r * 0.84);
    } else if (kind === "coin") {
      ctx.fillStyle = a;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.64, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = "900 " + Math.round(r * 0.64) + "px 'Impact', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, 4);
    } else if (kind === "chart") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      var bars = [
        [-0.48, 0.35, "#38BDF8"],
        [-0.14, 0.58, a],
        [0.2, 0.88, p]
      ];
      bars.forEach(function (b) {
        var bh = r * 1.15 * b[1];
        ctx.fillStyle = b[2];
        ctx.fillRect(b[0] * r, r * 0.55 - bh, r * 0.28, bh);
        ctx.strokeRect(b[0] * r, r * 0.55 - bh, r * 0.28, bh);
      });
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, r * 0.55);
      ctx.lineTo(r * 0.62, r * 0.55);
      ctx.stroke();
    } else if (kind === "lightbulb") {
      ctx.fillStyle = "#FFDE59";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, -r * 0.16, r * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#94A3B8";
      ctx.fillRect(-r * 0.22, r * 0.28, r * 0.44, r * 0.34);
      ctx.strokeRect(-r * 0.22, r * 0.28, r * 0.44, r * 0.34);
    } else if (kind === "phone") {
      ctx.fillStyle = "#1E293B";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(-r * 0.4, -r * 0.68, r * 0.8, r * 1.36, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#BAE6FD";
      ctx.fillRect(-r * 0.3, -r * 0.5, r * 0.6, r * 0.96);
      ctx.fillStyle = p;
      ctx.fillRect(-r * 0.22, -r * 0.36, r * 0.44, r * 0.22);
    } else {
      // camera
      ctx.fillStyle = "#334155";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(-r * 0.64, -r * 0.38, r * 1.28, r * 0.88, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#38BDF8";
      ctx.beginPath();
      ctx.arc(0, r * 0.06, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p;
      ctx.beginPath();
      ctx.arc(r * 0.42, -r * 0.2, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHeroCutout(ctx, cx, cy, boxW, boxH, opts) {
    var o = opts || {};
    var seed = o.seed || "hero";
    var angle = o.angle || 0;
    var rim = o.rimColor || "#F4EFE4";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(o.scaleX || 1, o.scaleY || 1);

    // Shadow collapse from drop elevation
    var elev = o.elevation || 0;
    ctx.shadowColor = "rgba(18,14,10," + (0.34 - elev * 0.16).toFixed(2) + ")";
    ctx.shadowBlur = 14 + elev * 24;
    ctx.shadowOffsetX = 8 + elev * 14;
    ctx.shadowOffsetY = 12 + elev * 20;

    // White scissor-cut paper border
    traceTornRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, seed, 6);
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.shadowColor = "transparent";

    var pad = 16;
    if (o.imageObj && o.imageObj.complete && o.imageObj.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-boxW / 2 + pad, -boxH / 2 + pad, boxW - pad * 2, boxH - pad * 2);
      ctx.clip();
      var iw = o.imageObj.naturalWidth;
      var ih = o.imageObj.naturalHeight;
      var s = Math.max((boxW - pad * 2) / iw, (boxH - pad * 2) / ih);
      ctx.drawImage(o.imageObj, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
      ctx.restore();
    } else {
      ctx.fillStyle = o.cardFill || "#EFE7D6";
      ctx.fillRect(-boxW / 2 + pad, -boxH / 2 + pad, boxW - pad * 2, boxH - pad * 2);
      ctx.strokeStyle = "rgba(26,26,26,0.16)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-boxW / 2 + pad, -boxH / 2 + pad, boxW - pad * 2, boxH - pad * 2);
      drawCutoutGlyph(ctx, o.cutout || "portrait", Math.min(boxW, boxH) * 0.34, o.primary, o.accent);
    }

    // Washi tape on opposite corners + red push-pin at top center
    drawWashiTape(ctx, -boxW * 0.38, -boxH * 0.44, 118, 30, -0.58, o.tapeColor || "#E9D5A1");
    drawWashiTape(ctx, boxW * 0.38, boxH * 0.44, 118, 30, -0.58, o.tapeColor || "#E9D5A1");
    drawPushPin(ctx, 0, -boxH * 0.46, o.pinColor || "#C0392B");
    ctx.restore();
  }

  function drawAccent(ctx, kind, cx, cy, size, primary, accent) {
    ctx.save();
    ctx.translate(cx, cy);
    var r = size || 48;
    if (kind === "rose" || kind === "gear") {
      drawCutoutGlyph(ctx, kind, r, primary, accent);
    } else if (kind === "manicule") {
      drawCutoutGlyph(ctx, "hand-point", r, primary, accent);
    } else if (kind === "wax-seal") {
      ctx.fillStyle = primary || "#C0392B";
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === "star") {
      ctx.fillStyle = accent || "#F59E0B";
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var rr = i % 2 === 0 ? r * 0.75 : r * 0.34;
        var a = (i * Math.PI) / 5 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (kind === "arrow") {
      ctx.fillStyle = primary || "#C0392B";
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.18);
      ctx.lineTo(r * 0.1, -r * 0.18);
      ctx.lineTo(r * 0.1, -r * 0.48);
      ctx.lineTo(r * 0.72, 0);
      ctx.lineTo(r * 0.1, r * 0.48);
      ctx.lineTo(r * 0.1, r * 0.18);
      ctx.lineTo(-r * 0.7, r * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (kind === "paperclip") {
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.roundRect(-r * 0.28, -r * 0.65, r * 0.56, r * 1.3, r * 0.28);
      ctx.stroke();
    } else {
      // scissors
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.25);
      ctx.lineTo(r * 0.65, r * 0.35);
      ctx.moveTo(-r * 0.5, r * 0.25);
      ctx.lineTo(r * 0.65, -r * 0.35);
      ctx.stroke();
      ctx.strokeStyle = primary || "#C0392B";
      ctx.beginPath();
      ctx.arc(-r * 0.55, -r * 0.3, r * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-r * 0.55, r * 0.3, r * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  GLOBAL_SCOPE.CollageKit = {
    PAPER_THEMES: PAPER_THEMES,
    CUTOUT_KINDS: CUTOUT_KINDS,
    ACCENT_KINDS: ACCENT_KINDS,
    makeRng: makeRng,
    boilOffset: boilOffset,
    drawPaperBackground: drawPaperBackground,
    traceTornRect: traceTornRect,
    drawTornScrap: drawTornScrap,
    drawWashiTape: drawWashiTape,
    drawPushPin: drawPushPin,
    drawStamp: drawStamp,
    drawCutoutGlyph: drawCutoutGlyph,
    drawHeroCutout: drawHeroCutout,
    drawAccent: drawAccent
  };
})();
