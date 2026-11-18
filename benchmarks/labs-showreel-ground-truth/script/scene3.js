// Scene 3: "Making logo" Blurred Carousel Focus Card (5.600s - 6.667s)
(function () {
  "use strict";
  var AM = window.AM;

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

  function drawBlurBackdrop(ctx, zoom) {
    ctx.save();
    ctx.filter = "blur(6px)";
    ctx.translate(512, 290);
    ctx.scale(zoom, zoom);

    var cw = 258;
    var ch = 436;
    var gap = 10;

    // 5x3 blurred carousel matching 5.80s (zoom ~0.95) -> 6.13s (zoom ~1.28)
    for (var r = -1; r <= 1; r++) {
      for (var c = -2; c <= 2; c++) {
        var bx = c * (cw + gap);
        var by = r * (ch + gap);
        var isLight = (Math.abs(r + c) % 2 === 1);
        if (r === 0 && c === -1) {
          ctx.fillStyle = "#EDE6E8";
        } else if (r === 0 && c === 1) {
          ctx.fillStyle = "#DCD5D8";
        } else {
          ctx.fillStyle = isLight ? "#ECE7E9" : "#343035";
        }
        ctx.fillRect(bx - cw * 0.5, by - ch * 0.5, cw, ch);

        if (r === 0 && c === -1) {
          ctx.fillStyle = "#4F494E";
          ctx.beginPath();
          ctx.arc(bx, by, 42, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#EDE6E8";
          ctx.lineWidth = 11;
          ctx.beginPath();
          ctx.moveTo(bx - 36, by + 36);
          ctx.lineTo(bx + 36, by - 36);
          ctx.stroke();
        } else if (r === 0 && c === 1) {
          ctx.fillStyle = "#5D565B";
          ctx.beginPath();
          ctx.moveTo(bx - 22, by - 18); ctx.lineTo(bx + 24, by - 40); ctx.lineTo(bx + 24, by - 14); ctx.lineTo(bx - 22, by + 8); ctx.closePath(); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(bx - 22, by + 12); ctx.lineTo(bx + 24, by - 10); ctx.lineTo(bx + 24, by + 16); ctx.lineTo(bx - 22, by + 38); ctx.closePath(); ctx.fill();
        }
      }
    }
    ctx.restore();
    ctx.filter = "none";
  }

  function drawPointerOutline(ctx, x, y, sc, angleRad) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad || 0);
    ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(36, 19);
    ctx.quadraticCurveTo(18, 22, 16, 40);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#6C4DF6";
    ctx.stroke();
    ctx.restore();
  }

  AM.registerScene("scene3_card_zoom", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;

    ctx.fillStyle = "#595257";
    ctx.fillRect(0, 0, W, H);

    // Smooth zoom curve matching 5.60s(0.62) -> 5.80s(0.95) -> 6.13s(1.26) -> 6.40s(1.30)
    var zoomIn = AM.ease.outQuad(AM.invLerp(0.0, 0.58, localTime));
    var settleZoom = AM.lerp(0.62, 1.28, zoomIn);
    drawBlurBackdrop(ctx, settleZoom);

    var cardScale = settleZoom;
    var cardW = 262;
    var cardH = 440;

    ctx.save();
    ctx.translate(512, 290);
    ctx.scale(cardScale, cardScale);

    ctx.shadowColor = "rgba(18, 14, 24, 0.24)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#F4F3EF";
    ctx.fillRect(-cardW * 0.5, -cardH * 0.5, cardW, cardH);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Centered crisp geometric L
    ctx.save();
    ctx.translate(0, -18);
    drawLogoL(ctx, "#141416", 92);
    ctx.restore();

    // Purple swoosh arc around top-left of logo during entrance
    if (localTime >= 0.14 && localTime <= 0.65) {
      var arcP = AM.hump(AM.invLerp(0.14, 0.65, localTime));
      ctx.save();
      ctx.globalAlpha = arcP;
      ctx.strokeStyle = "#6C4DF6";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(-44, -40, 18, Math.PI, Math.PI * 1.48);
      ctx.stroke();
      ctx.restore();
    }

    // White capsule badge "Making logo"
    var badgeP = AM.clamp(AM.spring(Math.max(0, localTime - 0.10), { stiffness: 210, damping: 17 }), 0, 1);
    ctx.save();
    ctx.translate(0, 134);
    ctx.scale(0.88 + 0.12 * badgeP, 0.88 + 0.12 * badgeP);
    ctx.globalAlpha = badgeP;
    ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#FFFFFF";
    AM.roundRect(ctx, -90, -23, 180, 46, 23);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = "400 22px Inter, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = "#18181C";
    ctx.fillText("Making", -2, 1);
    ctx.textAlign = "left";
    ctx.fillStyle = "#6C4DF6";
    ctx.fillText("logo", 4, 1);
    ctx.restore();

    // Tiny monospace code bottom-left
    ctx.fillStyle = "#8C8A90";
    ctx.font = "500 8.5px Consolas, 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("01 · MIRING", -cardW * 0.5 + 24, cardH * 0.5 - 16);

    ctx.restore();

    // Sweeping multiplayer cursor touching card
    if (localTime >= 0.10) {
      var cu = AM.ease.inOutCubic(AM.invLerp(0.10, 0.88, localTime));
      var cx = AM.lerp(158, 398, cu);
      var cy = AM.lerp(88, 224, cu) - 25 * Math.sin(cu * Math.PI);
      drawPointerOutline(ctx, cx, cy, 1.0, -0.05 + 0.25 * cu);
    }

    // Rapid darken & bottom-left corner peek for Scene 4 handoff (0.95..1.067s)
    var dimP = AM.invLerp(0.94, dur, localTime);
    if (dimP > 0) {
      ctx.fillStyle = "rgba(12, 11, 14, " + (0.68 * dimP) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  });
})();
