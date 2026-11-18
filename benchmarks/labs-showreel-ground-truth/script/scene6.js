// Scene 6: Laptop Hardware Frame -> Amber Pill Marquee -> Purple Ripple "Design" (11.000s - 16.000s)
(function () {
  "use strict";
  var AM = window.AM;

  function drawPointer(ctx, x, y, sc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc || 1, sc || 1);
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

  function drawMarqueeRow(ctx, y, tokens, offsetPx, activeHighlight) {
    ctx.save();
    ctx.font = "400 16px Inter, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    var totalW = 0;
    var items = [];
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      var tw = ctx.measureText(tk.label).width;
      var bw = tk.pill ? tw + 22 : tw + 10;
      items.push({ tk: tk, bw: bw, x: totalW });
      totalW += bw + 10;
    }

    var centerStart = 512 - totalW * 0.5 + offsetPx;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var ix = centerStart + it.x;
      var cx = ix + it.bw * 0.5;
      if (it.tk.solid && activeHighlight) {
        ctx.fillStyle = "#D8B85C";
        AM.roundRect(ctx, ix, y - 14, it.bw, 28, 14);
        ctx.fill();
        ctx.fillStyle = "#16140D";
        ctx.font = "600 16px Inter, sans-serif";
      } else if (it.tk.pill) {
        ctx.fillStyle = "rgba(170, 130, 50, 0.12)";
        AM.roundRect(ctx, ix, y - 14, it.bw, 28, 14);
        ctx.fill();
        ctx.strokeStyle = "#9D8039";
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.fillStyle = "#DFC170";
        ctx.font = "400 16px Inter, sans-serif";
      } else {
        ctx.fillStyle = "#727177";
        ctx.font = "400 16px Inter, sans-serif";
      }
      ctx.textAlign = "center";
      ctx.fillText(it.tk.label, cx, y + 0.5);
    }
    ctx.restore();
  }

  AM.registerScene("scene6_laptop_ui", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    // Camera kinematics: slide laptop smoothly up (0..0.55s), then zoom into screen corner (4.76..5.00s)
    var slideUpP = AM.spring(localTime, { stiffness: 165, damping: 18 });
    var slideY = 340 * (1 - AM.clamp(slideUpP, 0, 1.02));
    var endZoomP = AM.ease.inCubic(AM.invLerp(4.74, dur, localTime));
    var zoomScale = AM.lerp(1.0, 2.75, endZoomP);

    ctx.save();
    ctx.translate(AM.lerp(512, 625, endZoomP), AM.lerp(288, 338, endZoomP));
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-512, -288 + slideY);

    // Outer Laptop Lid / Display Shell (matched to k_13.50s / k_15.50s frame)
    var lidX = 244, lidY = 104, lidW = 536, lidH = 342;
    ctx.fillStyle = "#1D1D22";
    AM.roundRect(ctx, lidX, lidY, lidW, lidH, 14);
    ctx.fill();
    ctx.strokeStyle = "#3E3E46";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner clipped screen rectangle
    var sx = lidX + 10, sy = lidY + 10, sw = lidW - 20, sh = lidH - 20;
    ctx.save();
    AM.roundRect(ctx, sx, sy, sw, sh, 7);
    ctx.clip();

    // Dark screen base
    ctx.fillStyle = "#060608";
    ctx.fillRect(sx, sy, sw, sh);

    // Act 6A: Golden Interactive Node Pills inside screen (0.00 -> 2.95s)
    var rippleMix = AM.smoothstep(2.75, 3.05, localTime);
    if (rippleMix < 0.99) {
      ctx.save();
      ctx.globalAlpha = 1 - rippleMix;
      var drift1 = Math.sin(localTime * 0.9) * 14 - localTime * 8;
      var drift2 = -Math.sin(localTime * 0.9) * 14 + localTime * 7;

      drawMarqueeRow(ctx, 198, [
        { label: "Ertem", pill: false },
        { label: "Support", pill: true },
        { label: "System", pill: true },
        { label: "Sy", pill: false }
      ], drift1, false);

      drawMarqueeRow(ctx, 250, [
        { label: "Estem", pill: false },
        { label: "Environment", pill: true },
        { label: "Ertem", pill: false }
      ], drift2, false);

      drawMarqueeRow(ctx, 302, [
        { label: "Enum", pill: false },
        { label: "Results", pill: true, solid: true },
        { label: "Environ", pill: false }
      ], drift1 * 0.4, localTime >= 1.15);

      drawMarqueeRow(ctx, 354, [
        { label: "En", pill: false },
        { label: "Environment", pill: true },
        { label: "System", pill: true }
      ], drift2 * 0.5, false);

      // Soft horizontal vignette mask inside laptop screen
      var leftMask = ctx.createLinearGradient(sx, 0, sx + 125, 0);
      leftMask.addColorStop(0, "rgba(6,6,8,0.96)");
      leftMask.addColorStop(1, "rgba(6,6,8,0)");
      ctx.fillStyle = leftMask;
      ctx.fillRect(sx, sy, 125, sh);

      var rightMask = ctx.createLinearGradient(sx + sw - 125, 0, sx + sw, 0);
      rightMask.addColorStop(0, "rgba(6,6,8,0)");
      rightMask.addColorStop(1, "rgba(6,6,8,0.96)");
      ctx.fillStyle = rightMask;
      ctx.fillRect(sx + sw - 125, sy, 125, sh);

      // Cursor clicking "Results" gold pill
      if (localTime >= 1.35 && localTime <= 2.85) {
        var cu = AM.ease.inOutCubic(AM.invLerp(1.35, 1.95, localTime));
        drawPointer(ctx, AM.lerp(565, 502, cu), AM.lerp(395, 312, cu), 0.72);
      }
      ctx.restore();
    }

    // Act 6B: Concentric Violet Ripple Rings + "Movement / Transitions / Design" (2.75 -> 5.00s)
    if (rippleMix > 0.01) {
      var rt = Math.max(0, localTime - 2.75);
      ctx.save();
      ctx.globalAlpha = rippleMix;

      // Deep violet radial ambient canvas
      var baseRad = ctx.createRadialGradient(512, 275, 12, 512, 275, 345);
      baseRad.addColorStop(0, "#3B0764");
      baseRad.addColorStop(0.55, "#6D28D9");
      baseRad.addColorStop(1, "#9333EA");
      ctx.fillStyle = baseRad;
      ctx.fillRect(sx, sy, sw, sh);

      // Smooth pulsing concentric ripple halos
      var ringCount = 6;
      for (var r = 0; r < ringCount; r++) {
        var phase = ((r * 62 + rt * 105) % 372);
        var innerR = Math.max(0, phase - 28);
        var outerR = phase + 34;
        var ringGrad = ctx.createRadialGradient(512, 275, innerR, 512, 275, outerR);
        ringGrad.addColorStop(0, "rgba(192, 132, 252, 0)");
        ringGrad.addColorStop(0.5, "rgba(216, 180, 254, 0.25)");
        ringGrad.addColorStop(1, "rgba(88, 28, 135, 0)");
        ctx.fillStyle = ringGrad;
        ctx.fillRect(sx, sy, sw, sh);
      }

      // Clean editorial overlay copy matching k_15.50s.jpg
      var movP = AM.clamp(AM.spring(Math.max(0, localTime - 3.15), { stiffness: 200, damping: 19 }), 0, 1);
      var trnP = AM.clamp(AM.spring(Math.max(0, localTime - 3.42), { stiffness: 200, damping: 19 }), 0, 1);
      var desP = AM.clamp(AM.spring(Math.max(0, localTime - 3.62), { stiffness: 190, damping: 18 }), 0, 1);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "400 18px Inter, 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.globalAlpha *= movP;
      ctx.fillText("Movement", sx + 32, sy + 42 + 12 * (1 - movP));
      ctx.restore();

      ctx.save();
      ctx.globalAlpha *= trnP;
      ctx.fillText("Transitions", sx + 58, sy + 82 + 12 * (1 - trnP));
      ctx.restore();

      ctx.save();
      ctx.globalAlpha *= desP;
      ctx.fillStyle = "#F5EDFF";
      ctx.font = "italic 400 54px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "right";
      ctx.fillText("Design", sx + sw - 46, sy + sh - 68 + 18 * (1 - desP));
      ctx.restore();

      ctx.restore();
    }

    ctx.restore(); // end screen clip

    // Minimalist Aluminum/Dark Laptop Base Deck + Center Notch
    var baseX = 180, baseY = lidY + lidH + 2, baseW = 664, baseH = 14;
    var deckGrad = ctx.createLinearGradient(0, baseY, 0, baseY + baseH);
    deckGrad.addColorStop(0, "#383840");
    deckGrad.addColorStop(0.55, "#26262C");
    deckGrad.addColorStop(1, "#18181D");
    ctx.fillStyle = deckGrad;
    AM.roundRect(ctx, baseX, baseY, baseW, baseH, 5);
    ctx.fill();

    // Recessed thumb notch in middle of palm rest
    ctx.fillStyle = "#19191E";
    AM.roundRect(ctx, 512 - 44, baseY, 88, 5, 2.5);
    ctx.fill();

    ctx.restore(); // end laptop camera transform
  });
})();
