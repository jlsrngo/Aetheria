// Scene 2: Slanted 7x3 Bento Checkerboard Matrix & Card Select (3.167s - 5.600s)
(function () {
  "use strict";
  var AM = window.AM;

  // Measured grid cards matching k_04.20s.jpg (3 rows x 7 columns)
  var TILES = [
    // Row 0
    { icon: "dots", label: "12 · TITIK", bg: "#F1F0EC", fg: "#161618" },
    { icon: "orbit", label: "06 · ORBIT", bg: "#17181A", fg: "#F1F0EC" },
    { icon: "triangle", label: "15 · PRISMA", bg: "#F1F0EC", fg: "#161618" },
    { icon: "sparkle", label: "02 · PERCIK", bg: "#17181A", fg: "#F1F0EC" },
    { icon: "moon", label: "17 · BULAN", bg: "#F1F0EC", fg: "#161618" },
    { icon: "waves", label: "08 · ARUS", bg: "#202322", fg: "#F1F0EC" },
    { icon: "simpul", label: "19 · SIMPUL", bg: "#D4D6CE", fg: "#161618" },
    // Row 1 (Center Row, Col 3 = 01 · MIRING centered at 512, 288)
    { icon: "arrowNE", label: "13 · PANAH", bg: "#D4D6CE", fg: "#161618" },
    { icon: "cube", label: "10 · KUBUS", bg: "#17181A", fg: "#F1F0EC" },
    { icon: "slashCircle", label: "03 · BELAH", bg: "#F1F0EC", fg: "#161618" },
    { icon: "logoL", label: "01 · MIRING", bg: "#F4F3EF", fg: "#141416" },
    { icon: "tumpuk", label: "04 · TUMPUK", bg: "#D4D6CE", fg: "#161618" },
    { icon: "wifi", label: "14 · SINYAL", bg: "#17181A", fg: "#F1F0EC" },
    { icon: "cRing", label: "11 · CINCIN", bg: "#202325", fg: "#F1F0EC" },
    // Row 2
    { icon: "bean", label: "16 · BIJI", bg: "#18191B", fg: "#F1F0EC" },
    { icon: "bars", label: "05 · TANGGA", bg: "#F1F0EC", fg: "#161618" },
    { icon: "bolt", label: "07 · KILAT", bg: "#181A19", fg: "#F1F0EC" },
    { icon: "squareL", label: "09 · BINGKAI", bg: "#F1F0EC", fg: "#161618" },
    { icon: "focus", label: "18 · FOKUS", bg: "#222423", fg: "#F1F0EC" },
    { icon: "foldL", label: "20 · SUDUT", bg: "#F1F0EC", fg: "#161618" },
    { icon: "grid2", label: "21 · GRID", bg: "#F1F0EC", fg: "#161618" }
  ];

  function drawLogoL(ctx, fg, s) {
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-0.08 * s, -0.44 * s);
    ctx.lineTo(0.24 * s, -0.44 * s);
    ctx.lineTo(-0.18 * s, 0.44 * s);
    ctx.lineTo(-0.48 * s, 0.44 * s);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-0.03 * s, 0.22 * s);
    ctx.lineTo(0.48 * s, 0.22 * s);
    ctx.lineTo(0.38 * s, 0.44 * s);
    ctx.lineTo(-0.13 * s, 0.44 * s);
    ctx.closePath();
    ctx.fill();
  }

  function drawIcon(ctx, type, fg, size) {
    ctx.save();
    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    var r = size * 0.42;

    if (type === "dots") {
      for (var ry = -1; ry <= 1; ry++) {
        for (var rx = -1; rx <= 1; rx++) {
          var rad = (rx === 0 && ry === 0) ? 2.8 : (Math.abs(rx) + Math.abs(ry) === 2 ? 2.8 : 4.6);
          ctx.beginPath();
          ctx.arc(rx * 13, ry * 13, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (type === "orbit") {
      ctx.rotate(-0.65);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(20, -9, 3.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "triangle") {
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(20, 16);
      ctx.lineTo(-20, 16);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(4, 16);
      ctx.stroke();
    } else if (type === "sparkle") {
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.quadraticCurveTo(3, -3, 24, 0);
      ctx.quadraticCurveTo(3, 3, 0, 24);
      ctx.quadraticCurveTo(-3, 3, -24, 0);
      ctx.quadraticCurveTo(-3, -3, 0, -24);
      ctx.fill();
    } else if (type === "moon") {
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#F1F0EC";
      ctx.beginPath();
      ctx.arc(9, -6, 17, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "waves") {
      ctx.lineWidth = 7;
      for (var w = -1; w <= 1; w += 2) {
        ctx.beginPath();
        ctx.moveTo(-16 + w * 4, 14 + w * 4);
        ctx.bezierCurveTo(-2 + w * 4, 14 + w * 4, 2 + w * 4, -14 + w * 4, 16 + w * 4, -14 + w * 4);
        ctx.stroke();
      }
    } else if (type === "simpul") {
      ctx.lineWidth = 4.2;
      AM.roundRect(ctx, -22, -11, 24, 22, 6);
      ctx.stroke();
      AM.roundRect(ctx, -2, -11, 24, 22, 6);
      ctx.stroke();
    } else if (type === "arrowNE") {
      ctx.rotate(-Math.PI * 0.25);
      ctx.fillRect(-18, -3.5, 22, 7);
      ctx.beginPath();
      ctx.moveTo(2, -13);
      ctx.lineTo(20, 0);
      ctx.lineTo(2, 13);
      ctx.closePath();
      ctx.fill();
    } else if (type === "cube") {
      ctx.lineWidth = 2.6;
      var cPts = [[0, -22], [19, -11], [19, 11], [0, 22], [-19, 11], [-19, -11]];
      ctx.beginPath();
      for (var ci = 0; ci < cPts.length; ci++) {
        if (ci === 0) ctx.moveTo(cPts[ci][0], cPts[ci][1]);
        else ctx.lineTo(cPts[ci][0], cPts[ci][1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 22);
      ctx.moveTo(0, 0); ctx.lineTo(19, -11);
      ctx.moveTo(0, 0); ctx.lineTo(-19, -11);
      ctx.stroke();
    } else if (type === "slashCircle") {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#F1F0EC";
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(-22, 22);
      ctx.lineTo(22, -22);
      ctx.stroke();
    } else if (type === "logoL") {
      drawLogoL(ctx, fg, size);
    } else if (type === "tumpuk") {
      ctx.beginPath();
      ctx.moveTo(-14, -12); ctx.lineTo(16, -24); ctx.lineTo(16, -8); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 8); ctx.lineTo(16, -4); ctx.lineTo(16, 12); ctx.lineTo(-14, 24); ctx.closePath(); ctx.fill();
    } else if (type === "wifi") {
      ctx.lineWidth = 4.6;
      ctx.beginPath(); ctx.arc(-11, 13, 3.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-13, 15, 14, -Math.PI * 0.48, 0.02); ctx.stroke();
      ctx.beginPath(); ctx.arc(-13, 15, 24, -Math.PI * 0.48, 0.02); ctx.stroke();
      ctx.beginPath(); ctx.arc(-13, 15, 34, -Math.PI * 0.48, 0.02); ctx.stroke();
    } else if (type === "cRing") {
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0.45, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(14, -10, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "bean") {
      ctx.rotate(0.4);
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 23, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#18191B";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, -21); ctx.lineTo(0, 21);
      ctx.stroke();
    } else if (type === "bars") {
      ctx.fillRect(-16, -20, 8, 40);
      ctx.fillRect(-3, -6, 8, 26);
      ctx.fillRect(10, 8, 8, 12);
    } else if (type === "bolt") {
      ctx.beginPath();
      ctx.moveTo(4, -22); ctx.lineTo(-13, 2); ctx.lineTo(-1, 2);
      ctx.lineTo(-5, 22); ctx.lineTo(13, -2); ctx.lineTo(1, -2);
      ctx.closePath(); ctx.fill();
    } else if (type === "squareL") {
      AM.roundRect(ctx, -20, -20, 40, 40, 9);
      ctx.fill();
      ctx.fillStyle = "#F1F0EC";
      ctx.beginPath();
      ctx.moveTo(-4, -11); ctx.lineTo(5, -11); ctx.lineTo(-4, 7); ctx.lineTo(11, 7); ctx.lineTo(9, 13); ctx.lineTo(-11, 13);
      ctx.closePath();
      ctx.fill();
    } else if (type === "focus") {
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-18, -8); ctx.lineTo(-18, -18); ctx.lineTo(-8, -18);
      ctx.moveTo(8, 18); ctx.lineTo(18, 18); ctx.lineTo(18, 8);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    } else if (type === "foldL") {
      ctx.beginPath();
      ctx.moveTo(-14, -18); ctx.lineTo(-4, -12); ctx.lineTo(-4, 10); ctx.lineTo(-14, 18); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, 10); ctx.lineTo(16, -2); ctx.lineTo(16, 10); ctx.lineTo(-4, 22); ctx.closePath(); ctx.fill();
    } else {
      ctx.lineWidth = 2.6;
      AM.roundRect(ctx, -18, -18, 15, 15, 4); ctx.stroke();
      AM.roundRect(ctx, 3, -18, 15, 15, 4); ctx.fill();
      AM.roundRect(ctx, -18, 3, 15, 15, 4); ctx.stroke();
      AM.roundRect(ctx, 3, 3, 15, 15, 4); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPointer(ctx, x, y, sc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.shadowColor = "rgba(125,86,239,0.55)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(14, 24);
    ctx.quadraticCurveTo(6, 20, -1, 27);
    ctx.closePath();
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7D56EF";
    ctx.stroke();
    ctx.restore();
  }

  AM.registerScene("scene2_bento_grid", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    var openP = AM.spring(localTime, { stiffness: 185, damping: 18 });
    var zoomStart = 2.15;
    var zoomP = AM.ease.inCubic(AM.invLerp(zoomStart, dur, localTime));
    var angle = AM.lerp(-0.048, 0.0, zoomP);
    var gridScale = AM.lerp(0.86, 1.0, AM.clamp(openP, 0, 1)) * AM.lerp(1.0, 1.56, zoomP);

    var cols = 7;
    var rows = 3;
    var cellW = 148;
    var cellH = 232;
    var gap = 6;

    ctx.save();
    ctx.translate(AM.lerp(514, 512, zoomP), AM.lerp(292, 290, zoomP));
    ctx.rotate(angle);
    ctx.scale(gridScale, gridScale);

    for (var r = 0; r < rows; r++) {
      var rowShift = (r === 0 ? -1 : r === 2 ? 1 : 0) * 140 * (1 - AM.clamp(openP, 0, 1));
      for (var c = 0; c < cols; c++) {
        var idx = r * cols + c;
        var tile = TILES[idx];
        var distFromCenter = Math.abs(c - 3) + Math.abs(r - 1);
        var tileP = AM.clamp(AM.spring(Math.max(0, localTime - distFromCenter * 0.045), { stiffness: 220, damping: 19 }), 0, 1.15);
        if (tileP <= 0.01) continue;

        var cx = (c - 3) * (cellW + gap) + rowShift;
        var cy = (r - 1) * (cellH + gap);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(0.82 + 0.18 * AM.clamp(tileP, 0, 1), 0.82 + 0.18 * AM.clamp(tileP, 0, 1));
        ctx.globalAlpha = AM.clamp(tileP * 1.4, 0, 1);

        // Card base
        ctx.fillStyle = tile.bg;
        ctx.fillRect(-cellW * 0.5, -cellH * 0.5, cellW, cellH);

        // Vector icon at card center
        drawIcon(ctx, tile.icon, tile.fg, 52);

        // Monospace footer label matching reference
        ctx.fillStyle = tile.bg === "#F1F0EC" || tile.bg === "#F4F3EF" || tile.bg === "#D4D6CE"
          ? "rgba(24,24,28,0.65)"
          : "rgba(235,235,240,0.52)";
        ctx.font = "500 8px Consolas, 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(tile.label, -cellW * 0.5 + 12, cellH * 0.5 - 12);

        ctx.restore();
      }
    }

    // Mini "Logo" pill popup when cursor hovers center card (4.55s..4.95s -> localTime 1.38..1.78s)
    if (localTime >= 1.32 && localTime <= 1.85) {
      var pillP = AM.hump(AM.invLerp(1.32, 1.85, localTime));
      ctx.save();
      ctx.globalAlpha = pillP;
      ctx.fillStyle = "#FFFFFF";
      ctx.shadowColor = "rgba(0,0,0,0.22)";
      ctx.shadowBlur = 10;
      AM.roundRect(ctx, -18, 56, 36, 16, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#18181C";
      ctx.font = "600 8px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Logo", 0, 64);
      ctx.restore();
    }

    ctx.restore();

    // Pointer cursor clicking center tile
    if (localTime >= 0.85 && localTime < zoomStart) {
      var u = AM.ease.inOutCubic(AM.invLerp(0.85, 1.48, localTime));
      var px = AM.lerp(580, 526, u);
      var py = AM.lerp(475, 315, u);
      var clickScale = 0.78 - 0.14 * AM.kick(localTime, 1.45, 5.0, 0.5);
      drawPointer(ctx, px, py, clickScale);
    }
  });
})();
