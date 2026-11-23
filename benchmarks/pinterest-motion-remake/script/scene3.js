// VISUAL PLAN:
// Scene 3: "When you learn Structured Problem Solving Methods."
// Phases:
// 1. t=0.00..0.40s: Outgoing push/exit + incoming purple circle pop & top-right concave sparkle entrance at (625, 138).
// 2. t=0.32..0.85s: "When you learn" character blur reveal; purple circle glides into center (430, 955).
// 3. t=0.85..1.20s: "Structured" character blur reveal; purple circle morphs to diamond, dot detaches from SE socket and arcs to NW tab; NE socket forms.
// 4. t=1.60..2.10s: Hero headline "Problem" character blur reveal in Impact/Anton condensed display @ (82, 505).
// 5. t=2.08..2.60s: Hero headline "Solving" character blur reveal in Impact/Anton condensed display @ (80, 680).
// 6. t=2.60..3.34s: "Methods." character blur reveal in Playfair italic @ (98, 752); puzzle piece and sparkle hold with subtle living drift.
//
// Layer Stack:
// - Background: #DADADA with subtle grid (45px squares, rgba(0,0,0,0.055))
// - Top-Right Accent: 4-pointed concave star with purple/magenta gradient at center (625, 138)
// - Typography (revealed progressively via AM.drawBlurRevealText):
//   * "When you learn" (Playfair Display italic ~44px) baseline @ (98, 260)
//   * "Structured" (Playfair Display italic ~44px) baseline @ (98, 318)
//   * "Problem" ("Anton", Impact condensed ~146px) baseline @ (82, 505)
//   * "Solving" ("Anton", Impact condensed ~146px) baseline @ (80, 680)
//   * "Methods." (Playfair Display italic ~46px) baseline @ (98, 752)
// - Interactive Graphic: Procedural purple jigsaw puzzle piece at (430, 955) via AM.drawTurntableObject

(function () {
  var AM = window.AM;

  // Draw 4-point concave sparkle star rotated 45 degrees
  function drawSparkle(ctx, cx, cy, outerR, innerR, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    var grad = ctx.createLinearGradient(-outerR, -outerR, outerR, outerR);
    grad.addColorStop(0, "#D044E2");
    grad.addColorStop(0.4, "#9215BA");
    grad.addColorStop(1, "#4C0572");
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, -outerR);
    ctx.quadraticCurveTo(innerR, -innerR, outerR, 0);
    ctx.quadraticCurveTo(innerR, innerR, 0, outerR);
    ctx.quadraticCurveTo(-innerR, innerR, -outerR, 0);
    ctx.quadraticCurveTo(-innerR, -innerR, 0, -outerR);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Draw jigsaw tab/socket outline
  // S: square size (~152px)
  // cr: corner radius (~22px)
  // nwTabP: 0..1 (male knob on NW side, y = -h)
  // neHoleP: 0..1 (female socket on NE side, x = h)
  // seHoleP: 0..1 (female socket on SE side, y = h)
  function drawJigsawPiece(ctx, S, cr, nwTabP, seHoleP, neHoleP, morphCircle) {
    ctx.fillStyle = "#7901BC";

    if (morphCircle > 0.01) {
      var rad = S * 0.44;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    var h = S / 2;
    var neckW = 16;
    var tabR = 26;

    ctx.beginPath();
    // Top-left corner to Top edge
    ctx.moveTo(-h + cr, -h);

    // Top edge with NW TAB (male knob extending outwards, y < -h)
    if (nwTabP > 0.01) {
      var effTab = tabR * nwTabP;
      var effDist = 20 * nwTabP;
      ctx.lineTo(-neckW * 1.5, -h);
      ctx.quadraticCurveTo(-neckW, -h, -neckW, -h - 4 * nwTabP);
      ctx.bezierCurveTo(
        -neckW - 8 * nwTabP, -h - effDist,
        -effTab, -h - effDist - effTab * 0.8,
        0, -h - effDist - effTab
      );
      ctx.bezierCurveTo(
        effTab, -h - effDist - effTab * 0.8,
        neckW + 8 * nwTabP, -h - effDist,
        neckW, -h - 4 * nwTabP
      );
      ctx.quadraticCurveTo(neckW, -h, neckW * 1.5, -h);
    }
    ctx.lineTo(h - cr, -h);

    // Top-right corner
    ctx.quadraticCurveTo(h, -h, h, -h + cr);

    // Right edge with NE HOLE (female socket cutting inward, x < h)
    if (neHoleP > 0.01) {
      var effHoleNE = tabR * neHoleP;
      var effDistNE = 20 * neHoleP;
      ctx.lineTo(h, -neckW * 1.5);
      ctx.quadraticCurveTo(h, -neckW, h - 4 * neHoleP, -neckW);
      ctx.bezierCurveTo(
        h - effDistNE, -neckW - 8 * neHoleP,
        h - effDistNE - effHoleNE * 0.8, -effHoleNE,
        h - effDistNE - effHoleNE, 0
      );
      ctx.bezierCurveTo(
        h - effDistNE - effHoleNE * 0.8, effHoleNE,
        h - effDistNE, neckW + 8 * neHoleP,
        h - 4 * neHoleP, neckW
      );
      ctx.quadraticCurveTo(h, neckW, h, neckW * 1.5);
    }
    ctx.lineTo(h, h - cr);

    // Bottom-right corner
    ctx.quadraticCurveTo(h, h, h - cr, h);

    // Bottom edge with SE HOLE (female socket cutting inward, y < h)
    if (seHoleP > 0.01) {
      var effHoleSE = tabR * seHoleP;
      var effDistSE = 20 * seHoleP;
      ctx.lineTo(neckW * 1.5, h);
      ctx.quadraticCurveTo(neckW, h, neckW, h - 4 * seHoleP);
      ctx.bezierCurveTo(
        neckW + 8 * seHoleP, h - effDistSE,
        effHoleSE, h - effDistSE + effHoleSE * 0.8,
        0, h - effDistSE + effHoleSE
      );
      ctx.bezierCurveTo(
        -effHoleSE, h - effDistSE + effHoleSE * 0.8,
        -neckW - 8 * seHoleP, h - effDistSE,
        -neckW, h - 4 * seHoleP
      );
      ctx.quadraticCurveTo(-neckW, h, -neckW * 1.5, h);
    }
    ctx.lineTo(-h + cr, h);

    // Bottom-left corner
    ctx.quadraticCurveTo(-h, h, -h, h - cr);

    // Left edge (SW) - smooth flat edge
    ctx.lineTo(-h, -h + cr);

    // Top-left corner
    ctx.quadraticCurveTo(-h, -h, -h + cr, -h);

    ctx.closePath();
    ctx.fill();
  }

  AM.registerScene("scene3_proof_or_demo", function (ctx, t, dur, scene, AM) {
    var W = 720;
    var H = 1280;

    // 1. Background Fill
    ctx.fillStyle = "#DADADA";
    ctx.fillRect(0, 0, W, H);

    // Subtle Grid (45px squares)
    ctx.strokeStyle = "rgba(0, 0, 0, 0.055)";
    ctx.lineWidth = 1;
    var gridSize = 45;
    ctx.beginPath();
    for (var gx = 0; gx <= W; gx += gridSize) {
      ctx.moveTo(gx + 0.5, 0);
      ctx.lineTo(gx + 0.5, H);
    }
    for (var gy = 0; gy <= H; gy += gridSize) {
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(W, gy + 0.5);
    }
    ctx.stroke();

    // 2. Top-Right Concave Sparkle Star at measured center (625, 138)
    if (t >= 0.12) {
      var starProgress = AM.clamp((t - 0.12) / 0.32, 0, 1);
      var starScale = AM.ease.outBack(starProgress);
      var starOuterR = 115 * starScale;
      var starInnerR = 34 * starScale;
      var starRot = Math.PI / 4.2 + (t - 0.12) * 0.04;
      drawSparkle(ctx, 625, 138, starOuterR, starInnerR, starRot);
    }

    // 3. Purple Circle / Puzzle Piece at Bottom (430, 955)
    var basePuzzleX = 430;
    var basePuzzleY = 955;
    var puzzleS = 152;
    var puzzleCR = 22;
    var puzzleRot = -Math.PI / 4; // -45 deg

    // Living hold drift
    var idleDY = 0;
    var idleDX = 0;
    if (t >= 1.15) {
      var holdPhase = (t - 1.15) * ((Math.PI * 2) / 0.87);
      idleDY = Math.sin(holdPhase) * 3.5;
      idleDX = Math.cos(holdPhase * 0.5) * 1.5;
    }

    if (t >= 0.08) {
      var enterP = AM.clamp((t - 0.08) / 0.28, 0, 1);
      var curX = AM.lerp(660, basePuzzleX, AM.ease.outCubic(enterP)) + idleDX;
      var curY = basePuzzleY + idleDY;

      // Morph progress: 1 = circle, 0 = diamond
      var morphP = 1 - AM.clamp((t - 0.72) / 0.14, 0, 1);

      // Sockets & Tabs
      var seHoleP = AM.clamp((t - 0.85) / 0.12, 0, 1);
      var neHoleP = AM.clamp((t - 1.05) / 0.12, 0, 1);
      var nwTabP = AM.clamp((t - 1.10) / 0.10, 0, 1);

      // Draw puzzle piece wrapped in AM.drawTurntableObject
      AM.drawTurntableObject(
        ctx,
        curX,
        curY,
        t,
        function (c) {
          c.save();
          c.rotate(puzzleRot);
          drawJigsawPiece(c, puzzleS, puzzleCR, nwTabP, seHoleP, neHoleP, morphP);
          c.restore();
        },
        { w: puzzleS * 1.3, h: puzzleS * 1.3, omega: 0, depth: 0 }
      );

      // Detached hopping dot (t=0.85 .. 1.12s)
      if (t >= 0.85 && t < 1.12) {
        var dotP = AM.clamp((t - 0.85) / 0.27, 0, 1);
        var dotR = 20;
        var dotX, dotY;

        if (dotP < 0.45) {
          // Detaching from SE hole to hover point
          var subP = dotP / 0.45;
          dotX = AM.lerp(curX + 60, curX + 115, AM.ease.outCubic(subP));
          dotY = AM.lerp(curY + 30, curY + 65, AM.ease.outCubic(subP));
        } else {
          // Arcing up to NW tab position
          var flightP = (dotP - 0.45) / 0.55;
          var easedFlight = AM.ease.inOutCubic(flightP);
          var startDX = 115, startDY = 65;
          var endDX = -65, endDY = -65;
          dotX = curX + AM.lerp(startDX, endDX, easedFlight) + Math.sin(flightP * Math.PI) * 45;
          dotY = curY + AM.lerp(startDY, endDY, easedFlight) - Math.sin(flightP * Math.PI) * 70;
        }

        ctx.save();
        ctx.fillStyle = "#7901BC";
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 4. Headline Typography (revealed progressively via AM.drawBlurRevealText)

    // A. "When you learn" (Playfair Display italic ~44px) baseline @ (98, 260)
    if (t >= 0.30) {
      ctx.font = 'italic 500 44px "Playfair Display", Georgia, serif';
      AM.drawBlurRevealText(ctx, "When you learn", 98, 260, t, 0.32, 0.42, {
        scaleFrom: 0.75,
        maxBlur: 14,
        risePx: 10,
        color: "#141414"
      });
    }

    // B. "Structured" (Playfair Display italic ~44px) baseline @ (98, 318)
    if (t >= 0.90) {
      ctx.font = 'italic 500 44px "Playfair Display", Georgia, serif';
      AM.drawBlurRevealText(ctx, "Structured", 98, 318, t, 0.95, 0.36, {
        scaleFrom: 0.75,
        maxBlur: 14,
        risePx: 10,
        color: "#141414"
      });
    }

    // C. "Problem" ("Anton", Impact condensed ~146px) baseline @ (82, 505)
    if (t >= 1.55) {
      ctx.font = '146px "Anton", Impact, sans-serif';
      AM.drawBlurRevealText(ctx, "Problem", 82, 505, t, 1.62, 0.42, {
        scaleFrom: 0.80,
        maxBlur: 18,
        risePx: 12,
        color: "#141414"
      });
    }

    // D. "Solving" ("Anton", Impact condensed ~146px) baseline @ (80, 680)
    if (t >= 2.05) {
      ctx.font = '146px "Anton", Impact, sans-serif';
      AM.drawBlurRevealText(ctx, "Solving", 80, 680, t, 2.10, 0.45, {
        scaleFrom: 0.80,
        maxBlur: 18,
        risePx: 12,
        color: "#141414"
      });
    }

    // E. "Methods." (Playfair Display italic ~46px) baseline @ (98, 752)
    if (t >= 2.58) {
      ctx.font = 'italic 600 46px "Playfair Display", Georgia, serif';
      AM.drawBlurRevealText(ctx, "Methods.", 98, 752, t, 2.62, 0.40, {
        scaleFrom: 0.82,
        maxBlur: 14,
        risePx: 8,
        color: "#141414"
      });
    }
  });
})();
