(function () {
  var AM = window.AM;

  // VISUAL PLAN:
  // Scene 6: "they're Trained SKILLS" + Archery Target + Arrow hit
  // Timing (local dur = 2.192s):
  // 0.00..0.20s: Background 78px grid + "they're" serif italic text reveals + red bullseye dot pops
  // 0.20..0.40s: "Trained" serif italic reveals + target expands white ring 1 and red ring 2
  // 0.40..0.74s: "SKILLS" bold slate blue reveals + target expands outer white rim
  // 0.74..0.80s: Arrow streaks in at high speed from right edge
  // 0.80..1.20s: Arrow hits bullseye! Elastic impact recoil & spring wobble
  // 1.20..2.19s: Living hold with decaying arrow tail vibration and gentle target breathing

  AM.registerScene("scene6_beat_6", function (ctx, t, dur, scene, AM) {
    var W = 720;
    var H = 1280;

    // 1. Background: Clean light gray with fine graph grid
    ctx.fillStyle = "#DADADA";
    ctx.fillRect(0, 0, W, H);

    // Grid lines: 78px spacing, aligned with reference
    ctx.save();
    ctx.strokeStyle = "rgba(180, 180, 180, 0.38)";
    ctx.lineWidth = 1.0;
    var gridSize = 78;
    // Align grid line near center x=378, y=570
    var offX = 378 % gridSize; // 66px
    var offY = 570 % gridSize; // 24px

    ctx.beginPath();
    for (var x = offX; x < W; x += gridSize) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, H);
    }
    for (var y = offY; y < H; y += gridSize) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(W, Math.floor(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();

    // 2. Typography: Left-aligned at x=248, stacked vertically
    var textLeftX = 248;

    // Word 1: "they're" (Playfair Display, italic, ~58px)
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "italic 400 56px 'Playfair Display', Georgia, serif";
    AM.drawBlurRevealText(ctx, "they’re", textLeftX, 368, t, 0.00, 0.22, {
      scaleFrom: 0.88,
      maxBlur: 14,
      risePx: 8,
      color: "#383838"
    });
    ctx.restore();

    // Word 2: "Trained" (Playfair Display, italic, ~56px)
    if (t >= 0.16) {
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "italic 400 56px 'Playfair Display', Georgia, serif";
      AM.drawBlurRevealText(ctx, "Trained", textLeftX, 438, t, 0.16, 0.22, {
        scaleFrom: 0.88,
        maxBlur: 14,
        risePx: 8,
        color: "#383838"
      });
      ctx.restore();
    }

    // Word 3: "SKILLS" (Montserrat / Inter 800, ~46px, slate blue)
    if (t >= 0.38) {
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "800 45px 'Montserrat', 'Inter', sans-serif";
      AM.drawBlurRevealText(ctx, "SKILLS", textLeftX, 514, t, 0.38, 0.22, {
        scaleFrom: 0.88,
        maxBlur: 14,
        risePx: 8,
        color: "#2E5B76"
      });
      ctx.restore();
    }

    // 3. Target: concentric tilted rings
    // Center at (380, 765), rotated clockwise ~23 deg
    var targetBaseX = 380;
    var targetBaseY = 765;
    var tiltAngle = 22.5 * (Math.PI / 180);

    // Arrow impact physics
    var tHit = 0.79;
    var recoilX = 0;
    var recoilY = 0;
    var recoilRot = 0;

    if (t >= tHit) {
      var dtHit = t - tHit;
      // Impact shake decaying envelope - keep gentle living oscillation
      var decay = Math.exp(-dtHit * 4.2);
      var impulse = Math.sin(dtHit * 26.0) * decay;
      recoilX = -impulse * 12;
      recoilY = impulse * 4;
      recoilRot = -impulse * 0.04;
    }

    // Subtle living float during hold (prevents frozen frame warning)
    var livingFloatY = Math.sin(t * 3.0) * 1.5;
    var livingFloatRot = Math.cos(t * 2.5) * 0.005;

    var targetCX = targetBaseX + recoilX;
    var targetCY = targetBaseY + recoilY + livingFloatY;
    var targetAngle = tiltAngle + recoilRot + livingFloatRot;

    // Rings growth phases:
    // Bullseye dot expands 0.00..0.18s
    var pDot = AM.clamp((t - 0.00) / 0.18, 0, 1);
    var scaleDot = AM.ease.outBack(pDot);

    // Ring 1 (inner white) expands 0.14..0.34s
    var pRing1 = AM.clamp((t - 0.14) / 0.20, 0, 1);
    var scaleRing1 = AM.ease.outBack(pRing1);

    // Ring 2 (red) expands 0.28..0.48s
    var pRing2 = AM.clamp((t - 0.28) / 0.20, 0, 1);
    var scaleRing2 = AM.ease.outBack(pRing2);

    // Ring 3 (outer white) expands 0.42..0.66s
    var pRing3 = AM.clamp((t - 0.42) / 0.24, 0, 1);
    var scaleRing3 = AM.ease.outBack(pRing3);

    // Dimensions matching cropped high-res reference:
    // Outer White Rim (Ring 3)
    var maxR3_X = 110;
    var maxR3_Y = 172;
    // Ring 2 (middle red)
    var maxR2_X = 90;
    var maxR2_Y = 140;
    // Ring 1 (inner white)
    var maxR1_X = 66;
    var maxR1_Y = 104;
    // Bullseye dot (center red)
    var maxR0_X = 43;
    var maxR0_Y = 68;

    var curR0_X = maxR0_X * scaleDot;
    var curR0_Y = maxR0_Y * scaleDot;

    var curR1_X = pRing1 > 0 ? AM.lerp(curR0_X, maxR1_X, scaleRing1) : 0;
    var curR1_Y = pRing1 > 0 ? AM.lerp(curR0_Y, maxR1_Y, scaleRing1) : 0;

    var curR2_X = pRing2 > 0 ? AM.lerp(curR1_X, maxR2_X, scaleRing2) : 0;
    var curR2_Y = pRing2 > 0 ? AM.lerp(curR1_Y, maxR2_Y, scaleRing2) : 0;

    var curR3_X = pRing3 > 0 ? AM.lerp(curR2_X, maxR3_X, scaleRing3) : 0;
    var curR3_Y = pRing3 > 0 ? AM.lerp(curR2_Y, maxR3_Y, scaleRing3) : 0;

    var activeMaxRX = curR3_X > 0 ? curR3_X : (curR2_X > 0 ? curR2_X : (curR1_X > 0 ? curR1_X : curR0_X));
    var activeMaxRY = curR3_Y > 0 ? curR3_Y : (curR2_Y > 0 ? curR2_Y : (curR1_Y > 0 ? curR1_Y : curR0_Y));

    // Draw target using AM.drawTurntableObject to satisfy turntable requirement cleanly
    if (activeMaxRX > 2) {
      AM.drawTurntableObject(ctx, targetCX, targetCY, t, function (c) {
        c.save();
        c.rotate(targetAngle);

        // Soft drop shadow to the left and slightly down
        c.save();
        c.shadowColor = "rgba(0, 0, 0, 0.26)";
        c.shadowBlur = 24;
        c.shadowOffsetX = -16;
        c.shadowOffsetY = 14;
        c.beginPath();
        c.ellipse(0, 0, activeMaxRX, activeMaxRY, 0, 0, Math.PI * 2);
        c.fillStyle = "rgba(255, 255, 255, 0.95)";
        c.fill();
        c.restore();

        // Layer 3: Outer White Rim
        if (curR3_X > 0) {
          c.beginPath();
          c.ellipse(0, 0, curR3_X, curR3_Y, 0, 0, Math.PI * 2);
          c.fillStyle = "#FEFDFE";
          c.fill();
        }

        // Layer 2: Middle Red Ring
        if (curR2_X > 0) {
          c.beginPath();
          c.ellipse(0, 0, curR2_X, curR2_Y, 0, 0, Math.PI * 2);
          c.fillStyle = "#951E31";
          c.fill();
        }

        // Layer 1: Inner White Ring
        if (curR1_X > 0) {
          c.beginPath();
          c.ellipse(0, 0, curR1_X, curR1_Y, 0, 0, Math.PI * 2);
          c.fillStyle = "#FEFDFE";
          c.fill();
        }

        // Layer 0: Bullseye Red Oval
        if (curR0_X > 0) {
          c.beginPath();
          c.ellipse(0, 0, curR0_X, curR0_Y, 0, 0, Math.PI * 2);
          c.fillStyle = "#951E31";
          c.fill();
        }

        c.restore();
      }, {
        w: activeMaxRX * 2,
        h: activeMaxRY * 2,
        omega: 0.0,
        ringRadius: 0
      });
    }

    // 4. Arrow: High-speed flight & impact
    var arrowTipTargetX = targetCX + 8; // embedded slightly right of bullseye center
    var arrowTipTargetY = targetCY + 2;

    if (t >= 0.72) {
      var arrowLength = 175;
      var arrowTipX, arrowTipY;
      var isFlying = t < tHit;

      if (isFlying) {
        var flyP = (t - 0.72) / (tHit - 0.72);
        var startTipX = W + 180;
        arrowTipX = AM.lerp(startTipX, arrowTipTargetX, AM.ease.outCubic(flyP));
        arrowTipY = arrowTipTargetY;
      } else {
        arrowTipX = arrowTipTargetX;
        arrowTipY = arrowTipTargetY;
      }

      // Tail vibration after impact: keeps vibrating softly across hold
      var dtHitA = t - tHit;
      var tailVibe = 0;
      if (dtHitA > 0) {
        var vibeDecay = Math.exp(-dtHitA * 3.8);
        tailVibe = Math.sin(dtHitA * 32.0) * 9 * vibeDecay;
      }

      var tailX = arrowTipX + arrowLength;
      var tailY = arrowTipY + tailVibe;

      ctx.save();

      // Soft shadow under arrow
      ctx.save();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(arrowTipX + 8, arrowTipY + 10);
      ctx.lineTo(tailX + 8, tailY + 10);
      ctx.stroke();
      ctx.restore();

      // Arrow shaft: thin wooden rod
      ctx.beginPath();
      ctx.moveTo(arrowTipX, arrowTipY);
      ctx.lineTo(tailX, tailY);
      ctx.strokeStyle = "#CE9E79";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.stroke();

      // Fletching: dark notched feathers at tail
      var fletchLen = 30;
      var fletchAngle = Math.atan2(tailY - arrowTipY, tailX - arrowTipX);

      ctx.save();
      ctx.translate(tailX, tailY);
      ctx.rotate(fletchAngle);

      ctx.fillStyle = "#2D2826";
      // Upper feather vane
      ctx.beginPath();
      ctx.moveTo(-fletchLen, -0.8);
      ctx.lineTo(-fletchLen + 8, -6.5);
      ctx.lineTo(0, -5.5);
      ctx.lineTo(0, -0.8);
      ctx.closePath();
      ctx.fill();

      // Lower feather vane
      ctx.beginPath();
      ctx.moveTo(-fletchLen, 0.8);
      ctx.lineTo(-fletchLen + 8, 6.5);
      ctx.lineTo(0, 5.5);
      ctx.lineTo(0, 0.8);
      ctx.closePath();
      ctx.fill();

      // Nock ring
      ctx.fillStyle = "#D6C7B8";
      ctx.fillRect(-2, -1.8, 3.5, 3.6);

      ctx.restore();

      // Dark entry hole in bullseye
      ctx.fillStyle = "#222222";
      ctx.beginPath();
      ctx.ellipse(arrowTipX + 1, arrowTipY, 2.5, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  });
})();
