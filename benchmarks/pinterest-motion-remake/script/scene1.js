// VISUAL PLAN:
// Phase 1 (0.00s - 1.10s):
//   - t=0.00..0.06s: White background with 72px light gray grid (#EEEEEE).
//   - t=0.06..0.09s: Purple line expands horizontally to 504px at y=627.
//   - t=0.09..0.12s: Height expands to 72px -> exact box [97, 591, 504x72].
//   - t=0.16..0.40s: Expands upward to box [96, 346, 506x313].
//   - t=0.18..0.38s: 3D Lime sphere drops, bounces, and settles on top-right card corner.
//   - t=0.20..0.40s: Progressive blur reveals "Did" (0.20..0.28), "You" (0.27..0.35), "Know?" (0.33..0.40).
//   - t=0.40..0.70s: Card reaches rounded hold pose [98, 325, 502, 333] (radius 0->62px).
//   - t=0.70..1.10s: Steady hold with resting 3D sphere at (555, 305).
// Phase 2 Transition (1.10s - 1.58s):
//   - t=1.10..1.40s: Card expands to measured refFgBox [11, 24, 699x608].
//   - t=1.40..1.58s: Card slides up off screen (y: 24 -> -680).
// Phase 2 Content (1.30s - 2.502s):
//   - Periwinkle lavender swoosh ribbon (#C9C3DE) arches from bottom-left to top-right.
//   - Lime corner petals (#E1FFAD) fade in at t >= 1.68s with subtle rotation.
//   - Progressive blur reveals:
//     * "research" in #230298 at (66, 688), tStart=1.32s, dur=0.30s.
//     * "shows" in italic #111111 at (69, 786), tStart=1.70s, dur=0.25s.
//     * "that" in upright serif #111111 at (338, 952), tStart=1.95s, dur=0.15s.
//   - Micro camera zoom drift (1.00 -> 1.03) until cut at t = 2.502s.

(function () {
  var AM = window.AM;

  // Preload project assets
  var brainImg = AM.loadImage("/img/brain.png");

  AM.registerScene("scene1_hook", function (ctx, t, dur, scene, AM) {
    var W = 720;
    var H = 1280;

    // Background fill
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);

    // Global camera drift for late phase
    var camScale = 1.0;
    var camY = 0;
    if (t > 1.6) {
      var pCam = (t - 1.6) / (dur - 1.6);
      camScale = AM.lerp(1.0, 1.03, AM.ease.outCubic(pCam));
      camY = AM.lerp(0, -6, pCam);
    }

    ctx.save();
    if (camScale !== 1.0 || camY !== 0) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(camScale, camScale);
      ctx.translate(-W / 2, -H / 2 + camY);
    }

    // 1. Grid lines (present throughout entire scene)
    var gridStep = 72;
    ctx.save();
    ctx.strokeStyle = "#ECECEC";
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (var gx = gridStep; gx < W; gx += gridStep) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
    }
    for (var gy = gridStep; gy < H; gy += gridStep) {
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy);
    }
    ctx.stroke();
    ctx.restore();

    // 2. PHASE 2 ELEMENTS (Lavender swoosh ribbon, corner accents, and typography)
    if (t >= 1.25) {
      var pPhase2 = AM.clamp((t - 1.25) / 0.30, 0, 1);
      ctx.save();
      ctx.globalAlpha = pPhase2;

      // Curved swoosh ribbon with measured surface lavender (#C9C3DE / #CCC6E0)
      ctx.save();
      ctx.fillStyle = "#C9C3DE";
      ctx.beginPath();
      ctx.moveTo(-30, 920);
      ctx.bezierCurveTo(160, 780, 420, 510, 680, 180);
      ctx.bezierCurveTo(580, 310, 340, 640, -30, 1080);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Lime corner accents only appear at t >= 1.68s
      if (t >= 1.68) {
        var pCorn = AM.clamp((t - 1.68) / 0.20, 0, 1);
        ctx.save();
        ctx.globalAlpha = pPhase2 * pCorn;

        // Top-left lime accent (#E1FFAD)
        ctx.save();
        ctx.translate(60, 50);
        ctx.rotate(Math.sin(t * 2.2) * 0.04);
        ctx.translate(-60, -50);
        ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#E1FFAD";
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(130, -10);
        ctx.bezierCurveTo(110, 60, 40, 95, -10, 95);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Bottom-right lime accent (#E1FFAD)
        ctx.save();
        ctx.translate(630, 1190);
        ctx.rotate(-Math.sin(t * 2.2) * 0.04);
        ctx.translate(-630, -1190);
        ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetX = -2;
        ctx.shadowOffsetY = -4;
        ctx.fillStyle = "#E1FFAD";
        ctx.beginPath();
        ctx.moveTo(W + 10, H + 10);
        ctx.lineTo(W - 160, H + 10);
        ctx.bezierCurveTo(W - 130, H - 80, W - 45, H - 120, W + 10, H - 120);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.restore();
      }

      // Typography Phase 2:
      // Line 1: "research" (Inter 800, #230298) at (66, 688)
      ctx.font = "800 94px 'Inter', sans-serif";
      AM.drawBlurRevealText(ctx, "research", 66, 688, t, 1.32, 0.30, {
        color: "#230298",
        maxBlur: 16,
        risePx: 12,
        scaleFrom: 0.78,
        preBlurSec: 0.12,
      });

      // Line 2: "shows" (Playfair Display Italic 700, #111111) at (69, 786)
      if (t >= 1.65) {
        ctx.font = "italic 700 64px 'Playfair Display', serif";
        AM.drawBlurRevealText(ctx, "shows", 69, 786, t, 1.70, 0.25, {
          color: "#111111",
          maxBlur: 14,
          risePx: 10,
          scaleFrom: 0.82,
          preBlurSec: 0.10,
        });
      }

      // Line 3: "that" (Playfair Display 700 upright, #111111) at (338, 952)
      if (t >= 1.90) {
        ctx.font = "700 86px 'Playfair Display', serif";
        AM.drawBlurRevealText(ctx, "that", 338, 952, t, 1.95, 0.15, {
          color: "#111111",
          maxBlur: 14,
          risePx: 8,
          scaleFrom: 0.85,
          preBlurSec: 0.08,
        });
      }

      ctx.restore();
    }

    // 3. PHASE 1 ELEMENTS (Purple card + Lime 3D ball)
    if (t < 1.60) {
      var cardX = 98;
      var cardY = 325;
      var cardW = 502;
      var cardH = 333;
      var cardRadius = 0;
      var isVisible = false;

      // Card trajectory matched exactly to measured trajectory table:
      if (t >= 0.06 && t < 0.09) {
        // Horizontal line expansion at y=627
        isVisible = true;
        var pW = (t - 0.06) / 0.03;
        cardW = AM.lerp(0, 504, AM.ease.outCubic(pW));
        cardH = 4;
        cardX = 349 - cardW / 2;
        cardY = 627 - cardH / 2;
      } else if (t >= 0.09 && t < 0.15) {
        // Flat bar [97, 591, 504x72]
        isVisible = true;
        cardW = 504;
        cardX = 97;
        var pH = AM.clamp((t - 0.09) / 0.03, 0, 1);
        cardH = AM.lerp(4, 72, AM.ease.outCubic(pH));
        cardY = 627 - cardH / 2;
      } else if (t >= 0.15 && t < 0.40) {
        // Expands upward to [96, 346, 506x313]
        isVisible = true;
        var pUp1 = (t - 0.15) / 0.25;
        var eu1 = AM.ease.outCubic(pUp1);
        cardX = AM.lerp(97, 96, eu1);
        cardW = AM.lerp(504, 506, eu1);
        cardH = AM.lerp(72, 313, eu1);
        cardY = 663 - cardH;
      } else if (t >= 0.40 && t < 0.70) {
        // Reaches [97, 300, 504x358] with corner rounding to 62px
        isVisible = true;
        var pUp2 = (t - 0.40) / 0.30;
        var eu2 = AM.ease.outCubic(pUp2);
        cardX = AM.lerp(96, 97, eu2);
        cardW = AM.lerp(506, 504, eu2);
        cardH = AM.lerp(313, 358, eu2);
        cardY = AM.lerp(346, 300, eu2);
        cardRadius = AM.lerp(0, 62, eu2);
      } else if (t >= 0.70 && t < 1.10) {
        // Steady hold at [98, 325, 502x333]
        isVisible = true;
        var pSettle = AM.clamp((t - 0.70) / 0.20, 0, 1);
        var euSettle = AM.ease.outCubic(pSettle);
        cardX = AM.lerp(97, 98, euSettle);
        cardY = AM.lerp(300, 325, euSettle);
        cardW = AM.lerp(504, 502, euSettle);
        cardH = AM.lerp(358, 333, euSettle);
        cardRadius = 62;
      } else if (t >= 1.10) {
        // Exit transition: expands to refFgBox [11, 24, 699x608] at t=1.40, then slides off
        isVisible = true;
        cardRadius = 64;
        var pExit = (t - 1.10) / 0.48; // 0 to 1 as t goes 1.10 -> 1.58
        if (pExit <= 0.625) {
          // 1.10s -> 1.40s: precisely matches refFgBox [11, 24, 699x608]
          var uExit1 = pExit / 0.625;
          var euExit1 = AM.ease.inOutCubic(uExit1);
          cardX = AM.lerp(98, 11, euExit1);
          cardY = AM.lerp(325, 24, euExit1);
          cardW = AM.lerp(502, 699, euExit1);
          cardH = AM.lerp(333, 608, euExit1);
        } else {
          // 1.40s -> 1.58s: slides up and exits top of canvas
          var uExit2 = (pExit - 0.625) / 0.375;
          var euExit2 = AM.ease.inCubic(uExit2);
          cardX = AM.lerp(11, -20, euExit2);
          cardY = AM.lerp(24, -680, euExit2);
          cardW = AM.lerp(699, 760, euExit2);
          cardH = AM.lerp(608, 650, euExit2);
        }
      }

      if (isVisible && cardW > 0 && cardH > 0) {
        ctx.save();

        // Draw card background
        ctx.fillStyle = "#230298";
        ctx.beginPath();
        if (cardRadius > 0 && ctx.roundRect) {
          ctx.roundRect(cardX, cardY, cardW, cardH, cardRadius);
        } else {
          ctx.rect(cardX, cardY, cardW, cardH);
        }
        ctx.fill();

        // Clip card content
        ctx.beginPath();
        if (cardRadius > 0 && ctx.roundRect) {
          ctx.roundRect(cardX, cardY, cardW, cardH, cardRadius);
        } else {
          ctx.rect(cardX, cardY, cardW, cardH);
        }
        ctx.clip();

        // Card typography (scaled proportionally to card)
        if (t >= 0.20) {
          var cardScale = cardW / 502;
          var textX = cardX + 51 * cardScale;
          var didYouY = cardY + 140 * cardScale;
          var knowY = cardY + 250 * cardScale;

          var fSize1 = Math.round(81 * cardScale);
          var fSize2 = Math.round(78 * cardScale);

          // Word 1: "Did" (tStart=0.20, dur=0.08)
          ctx.font = "800 " + fSize1 + "px 'Inter', sans-serif";
          AM.drawBlurRevealText(ctx, "Did", textX, didYouY, t, 0.20, 0.08, {
            color: "#FFFFFF",
            maxBlur: 12,
            risePx: 6,
            scaleFrom: 0.80,
            preBlurSec: 0.04,
          });

          // Word 2: "You" (tStart=0.27, dur=0.08)
          if (t >= 0.25) {
            var didW = ctx.measureText("Did ").width;
            AM.drawBlurRevealText(ctx, "You", textX + didW, didYouY, t, 0.27, 0.08, {
              color: "#FFFFFF",
              maxBlur: 12,
              risePx: 6,
              scaleFrom: 0.80,
              preBlurSec: 0.04,
            });
          }

          // Line 2: "Know?" (tStart=0.33, dur=0.07)
          if (t >= 0.31) {
            ctx.font = "800 " + fSize2 + "px 'Inter', sans-serif";
            AM.drawBlurRevealText(ctx, "Know?", textX, knowY, t, 0.33, 0.07, {
              color: "#FFFFFF",
              maxBlur: 12,
              risePx: 6,
              scaleFrom: 0.80,
              preBlurSec: 0.04,
            });
          }
        }

        ctx.restore();

        // Lime 3D Sphere (bounces and settles at top-right corner of card)
        if (t >= 0.18) {
          var ballX = cardX + cardW - 45;
          var ballY = cardY - 20;
          var ballR = 54;

          if (t < 0.44) {
            var pDrop = (t - 0.18) / 0.26;
            if (pDrop < 0.45) {
              // Falling down
              var s1 = pDrop / 0.45;
              ballX = AM.lerp(500, 535, s1);
              ballY = AM.lerp(120, cardY + 15, s1 * s1);
            } else if (pDrop < 0.75) {
              // Bouncing up
              var s2 = (pDrop - 0.45) / 0.30;
              ballX = AM.lerp(535, cardX + cardW - 45, s2);
              ballY = AM.lerp(cardY + 15, cardY - 40, Math.sin(s2 * Math.PI));
            } else {
              // Settling
              var s3 = (pDrop - 0.75) / 0.25;
              ballX = cardX + cardW - 45;
              ballY = AM.lerp(cardY - 40, cardY - 20, AM.ease.outCubic(s3));
            }
          } else if (t < 1.10) {
            // Resting hold with subtle float
            ballX = cardX + cardW - 45;
            ballY = cardY - 20 + Math.sin((t - 0.44) * 3.5) * 1.2;
          } else {
            // Attached to expanding/exiting card
            var exitScale = cardW / 502;
            ballX = cardX + cardW - 45 * exitScale;
            ballY = cardY - 20 * exitScale;
            ballR = 54 * exitScale;
          }

          // Draw 3D Sphere
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.20)";
          ctx.shadowBlur = 12;
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 6;

          var grad = ctx.createRadialGradient(
            ballX - ballR * 0.28,
            ballY - ballR * 0.28,
            ballR * 0.08,
            ballX,
            ballY,
            ballR
          );
          grad.addColorStop(0.0, "#E0FF8C");
          grad.addColorStop(0.35, "#B8E65A");
          grad.addColorStop(0.75, "#8EBF34");
          grad.addColorStop(1.0, "#608A1B");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    ctx.restore();
  });
})();
