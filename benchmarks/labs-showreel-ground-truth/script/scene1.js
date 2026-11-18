// Scene 1: "Showreel" Kinetic Letter Morph & Cursor Sweep (0.000s - 3.167s)
(function () {
  "use strict";
  var AM = window.AM;

  function drawCursor(ctx, x, y, sc, angleRad) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad || 0);
    ctx.scale(sc || 1, sc || 1);
    ctx.shadowColor = "rgba(125, 86, 239, 0.55)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(14, 24);
    ctx.quadraticCurveTo(6, 20, -1, 27);
    ctx.closePath();
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(180, 160, 245, 0.85)";
    ctx.stroke();
    ctx.restore();
  }

  function drawMorphShape(ctx, idx, cx, cy, p) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = 0.62 + 0.38 * p;
    ctx.scale(s, s);
    if (idx === 0) {
      ctx.fillStyle = "#B429F9";
      ctx.font = "600 94px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("S", 0, 2);
    } else if (idx === 1) {
      ctx.fillStyle = "#7C3AED";
      AM.roundRect(ctx, -18, -32, 36, 64, 14);
      ctx.fill();
      ctx.fillStyle = "#EC4899";
      ctx.beginPath();
      ctx.arc(8, -22, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (idx === 2) {
      ctx.strokeStyle = "#2563EB";
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(0, 2, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#0C0B0E";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-24, 22);
      ctx.lineTo(24, -18);
      ctx.stroke();
    } else if (idx === 3) {
      ctx.fillStyle = "#3B82F6";
      ctx.save();
      ctx.transform(1, 0, -0.35, 1, 0, 0);
      AM.roundRect(ctx, -20, -22, 14, 46, 5);
      ctx.fill();
      AM.roundRect(ctx, 4, -22, 14, 46, 5);
      ctx.fill();
      ctx.restore();
    } else if (idx === 4) {
      ctx.fillStyle = "#EA580C";
      AM.roundRect(ctx, -16, -24, 34, 13, 6);
      ctx.fill();
      AM.roundRect(ctx, -16, 4, 24, 13, 6);
      ctx.fill();
    } else if (idx === 5) {
      // Purple rounded square badge with dark geometric cutout matching k_01.50s.jpg
      ctx.fillStyle = "#7C3AED";
      AM.roundRect(ctx, -34, -32, 68, 66, 18);
      ctx.fill();
      ctx.strokeStyle = "#0C0B0E";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(8, -14);
      ctx.lineTo(-14, 10);
      ctx.lineTo(14, 10);
      ctx.stroke();
    } else if (idx === 6) {
      // Emerald slanted wireframe oval + bright green dot matching k_01.50s.jpg
      ctx.save();
      ctx.rotate(-0.48);
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.ellipse(0, 2, 28, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#34D399";
      ctx.beginPath();
      ctx.arc(22, -16, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Hot pink angular chevrons matching k_01.50s.jpg
      ctx.fillStyle = "#DB2777";
      ctx.save();
      ctx.transform(1, 0, -0.4, 1, 0, 0);
      AM.roundRect(ctx, -14, -28, 12, 54, 3);
      ctx.fill();
      ctx.fillRect(-14, 14, 30, 11);
      ctx.restore();
    }
    ctx.restore();
  }

  AM.registerScene("scene1_hook", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;

    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    var word = "Showreel";
    var fontSpec = "400 124px Inter, 'Segoe UI', Arial, sans-serif";
    ctx.font = fontSpec;

    var widths = [];
    var totalW = 0;
    for (var i = 0; i < word.length; i++) {
      var cw = ctx.measureText(word[i]).width;
      widths.push(cw);
      totalW += cw;
    }

    var startX = 504 - totalW * 0.5;
    var baseY = 318;

    var slashP = AM.invLerp(2.58, 3.05, localTime);
    var endFade = 1.0 - 0.52 * AM.ease.inCubic(AM.invLerp(2.85, dur, localTime));
    var wordScale = 1.0 - 0.06 * AM.ease.inOutCubic(AM.invLerp(2.70, dur, localTime));

    ctx.save();
    ctx.translate(512, baseY);
    ctx.scale(wordScale, wordScale);
    ctx.translate(-512, -baseY);
    ctx.globalAlpha = endFade;

    var curX = startX;
    for (var j = 0; j < word.length; j++) {
      var ch = word[j];
      var cw2 = widths[j];
      var gx = curX + cw2 * 0.5;
      curX += cw2;

      // Exact stagger matching k_01.50s.jpg: at 1.50s, 'Showr' crisp white while 'eel' mid-morph
      var tAppear = 0.14 + j * 0.165;
      var dt = localTime - tAppear;
      if (dt < 0) continue;

      var popP = AM.spring(dt, { stiffness: 220, damping: 16 });
      var morphEnd = 0.56;
      var whiteMix = AM.smoothstep(morphEnd - 0.10, morphEnd + 0.08, dt);

      if (whiteMix < 0.99) {
        ctx.save();
        ctx.globalAlpha *= 1 - whiteMix;
        drawMorphShape(ctx, j, gx, baseY - 28, popP);
        ctx.restore();
      }

      if (whiteMix > 0.01) {
        ctx.save();
        ctx.globalAlpha *= whiteMix;
        ctx.font = fontSpec;
        ctx.fillStyle = "#EAEAEF";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        var slideY = 8 * (1 - AM.clamp(popP, 0, 1));
        ctx.fillText(ch, gx, baseY + slideY);
        ctx.restore();
      }
    }
    ctx.restore();

    if (slashP > 0) {
      var slashAlpha = Math.sin(Math.PI * slashP) * 0.72 + (slashP > 0.5 ? 0.25 : 0);
      ctx.save();
      ctx.strokeStyle = "rgba(215, 215, 226, " + AM.clamp(slashAlpha, 0, 0.78) + ")";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      var pDraw = AM.ease.outCubic(AM.clamp(slashP * 1.4, 0, 1));
      ctx.beginPath();
      ctx.moveTo(375, -20);
      ctx.lineTo(AM.lerp(375, 965, pDraw), AM.lerp(-20, 596, pDraw));
      ctx.stroke();
      ctx.restore();
    }

    if (localTime >= 0.14) {
      var cx, cy, ang;
      if (localTime < 1.95) {
        var u1 = AM.ease.inOutCubic(AM.invLerp(0.14, 1.95, localTime));
        cx = AM.lerp(205, 705, u1) + 45 * Math.sin(u1 * Math.PI);
        cy = AM.lerp(425, 168, u1) + 95 * Math.sin(u1 * Math.PI);
        ang = AM.lerp(-0.35, 0.18, u1);
      } else if (localTime < 2.48) {
        var u2 = AM.invLerp(1.95, 2.48, localTime);
        cx = AM.lerp(705, 692, u2);
        cy = AM.lerp(168, 174, u2);
        ang = 0.22;
      } else {
        var u3 = AM.ease.inOutCubic(AM.invLerp(2.48, 3.05, localTime));
        cx = AM.lerp(692, 492, u3);
        cy = AM.lerp(174, 314, u3);
        ang = AM.lerp(0.22, -0.35, u3);
      }
      var curAlpha = AM.invLerp(0.14, 0.28, localTime) * (1 - AM.invLerp(3.00, dur, localTime));
      ctx.save();
      ctx.globalAlpha = curAlpha;
      drawCursor(ctx, cx, cy, 0.92, ang);
      ctx.restore();
    }
  });
})();
