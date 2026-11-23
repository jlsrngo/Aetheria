// VISUAL PLAN:
// Scene 2/6: id="scene2_problem_or_context", 720x1280 @ 30fps, dur=3.704s
// Sub-beats:
//   0.00..0.15s: Clean grey grid plate, opening breathing hold
//   0.15..0.40s: "Your" unblurs top, 3D brain rises into center (y~655) inside dashed turntable ring
//   0.40..0.85s: "Your Brain" unblurs, "Makes" unblurs on line 2
//   0.85..1.10s: "over" reveals -> "Makes over", orange numeric counter sparks at (385, 943) reaching "484"
//   1.10..1.75s: Smooth upward pan (~146px): top text exits up into blur, brain rises to y~510, counter rises to y~786
//   1.75..2.04s: Counter rapidly ticks to exact measured milestones and locks at "35,000" with settle punch
//   2.04..2.35s: "decisions" reveals below counter in Playfair Display italic
//   2.35..3.20s: Progressive blur-reveal of "every", "single", "day" on line below
//   3.20..3.70s: Continuous 3D turntable spin + rotating dashed ring + outgoing pre-cut slide

(function () {
  var AM = window.AM;
  var brainImg = AM.loadImage('/img/brain.png');

  // Exact measured counter milestones
  var COUNT_KEYS = [
    { t: 0.82, v: 0 },
    { t: 1.04, v: 484 },
    { t: 1.17, v: 6327 },
    { t: 1.24, v: 12311 },
    { t: 1.30, v: 18152 },
    { t: 1.40, v: 24473 },
    { t: 1.50, v: 28540 },
    { t: 1.60, v: 31215 },
    { t: 1.70, v: 32976 },
    { t: 1.80, v: 34092 },
    { t: 1.90, v: 34726 },
    { t: 2.00, v: 34984 },
    { t: 2.04, v: 35000 }
  ];

  function getCount(t) {
    if (t < COUNT_KEYS[0].t) return 0;
    if (t >= COUNT_KEYS[COUNT_KEYS.length - 1].t) return 35000;
    for (var i = 0; i < COUNT_KEYS.length - 1; i++) {
      var k0 = COUNT_KEYS[i];
      var k1 = COUNT_KEYS[i + 1];
      if (t >= k0.t && t <= k1.t) {
        var p = (t - k0.t) / (k1.t - k0.t);
        return Math.round(AM.lerp(k0.v, k1.v, p));
      }
    }
    return 35000;
  }

  AM.registerScene("scene2_problem_or_context", function (ctx, t, dur, scene, AM) {
    var W = 720;
    var H = 1280;

    // Outgoing pre-cut drift starting at t=3.50s matching reference push-left
    var preCutX = 0;
    if (t >= 3.48) {
      preCutX = -AM.ease.inCubic((t - 3.48) / (dur - 3.48)) * 32;
    }

    // 1. Background clean plate & square grid
    ctx.fillStyle = '#DADADA';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(preCutX, 0);
    ctx.strokeStyle = '#C9C9C9';
    ctx.lineWidth = 1;
    var gridSize = 55.4;
    var startX = (W / 2) % gridSize;
    for (var x = startX; x < W + 40; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
    }
    var startY = (H / 2) % gridSize;
    for (var y = startY; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // 2. Vertical shift transition: t=1.10..1.70s camera pan up ~156px
    var shiftProgress = AM.clamp((t - 1.10) / 0.58, 0, 1);
    var shiftY = AM.ease.inOutCubic(shiftProgress) * -156;

    // 3. Top Phase Typography
    // In REF: "Your Brain" baseline ~226, "Makes over" baseline ~294
    if (t > 0.04 && t < 1.70) {
      var topExitP = AM.clamp((t - 1.10) / 0.45, 0, 1);
      var topY = 226 - AM.ease.inCubic(topExitP) * 110;

      ctx.save();
      ctx.textBaseline = 'alphabetic';

      if (t < 0.32) {
        // "Your" alone
        ctx.font = '700 52px "Inter", sans-serif';
        ctx.textAlign = 'center';
        AM.drawBlurRevealText(ctx, 'Your', 279, topY, t, 0.04, 0.12, {
          color: '#1D1D1D',
          maxBlur: 10,
          risePx: 8,
          exitAt: 0.31,
          exitDur: 0.05
        });
      } else {
        // "Your Brain"
        ctx.font = '700 52px "Inter", sans-serif';
        ctx.textAlign = 'center';
        AM.drawBlurRevealText(ctx, 'Your Brain', 359, topY, t, 0.32, 0.18, {
          color: '#1D1D1D',
          maxBlur: 10,
          risePx: 8,
          exitAt: 1.10,
          exitDur: 0.45
        });
      }

      // Line 2
      var line2Y = topY + 68;
      ctx.font = 'italic 500 56px "Playfair Display", serif';
      ctx.textAlign = 'center';
      if (t >= 0.40 && t < 0.85) {
        // "Makes"
        AM.drawBlurRevealText(ctx, 'Makes', 308, line2Y, t, 0.40, 0.16, {
          color: '#1D1D1D',
          maxBlur: 10,
          risePx: 8,
          exitAt: 0.84,
          exitDur: 0.05
        });
      } else if (t >= 0.85) {
        // "Makes over"
        AM.drawBlurRevealText(ctx, 'Makes over', 360, line2Y, t, 0.85, 0.16, {
          color: '#1D1D1D',
          maxBlur: 10,
          risePx: 8,
          exitAt: 1.10,
          exitDur: 0.45
        });
      }

      ctx.restore();
    }

    // 4. Hero 3D Turntable Brain + Dashed Orbital Ring
    // In REF: t=0.20s brain is lower (y~740) and smaller (scale~0.42), rising to 656 at t=0.55s
    var brainRiseP = AM.clamp((t - 0.05) / 0.50, 0, 1);
    var brainScale = AM.lerp(0.42, 1.0, AM.ease.outBack(brainRiseP));
    var brainAlpha = AM.clamp((t - 0.04) / 0.14, 0, 1);

    var baseBrainY = 656;
    var brainCX = 368 + preCutX;
    var brainCY = baseBrainY + (1 - AM.ease.outCubic(brainRiseP)) * 140 + shiftY;

    if (t > 0.04) {
      ctx.save();
      ctx.globalAlpha = brainAlpha;

      // Drop shadow under brain
      ctx.save();
      ctx.translate(brainCX, brainCY);
      ctx.scale(brainScale, brainScale);
      ctx.filter = 'blur(16px)';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 42, 108, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Draw Turntable Object with continuous 3D Y-axis rotation & spinning dashed ring
      var ringRad = 162 * brainScale;
      AM.drawTurntableObject(ctx, brainCX, brainCY, t, function (c) {
        if (brainImg && brainImg.complete && brainImg.naturalWidth > 0) {
          c.save();
          // Warm clay tone matching reference palette (#D9CCBE)
          c.filter = 'grayscale(0.42) contrast(1.08) brightness(1.12) sepia(0.20)';
          c.scale(-1, 1); // mirrored so cerebellum is lower left
          var bw = 296;
          var bh = bw * (brainImg.naturalHeight / brainImg.naturalWidth);
          c.drawImage(brainImg, -bw * 0.5, -bh * 0.5, bw, bh);
          c.restore();
        }
      }, {
        w: 296,
        h: 202,
        omega: 0.52,
        depth: 0.16,
        ringRadius: ringRad,
        ringOmega: 0.49,
        ringColor: '#5E5E5E'
      });

      ctx.restore();
    }

    // 5. Orange Numeric Counter ("484" -> "35,000")
    if (t >= 0.82) {
      var counterBaseY = 943 + shiftY;
      var countVal = getCount(t);
      var countStr = countVal.toLocaleString('en-US');

      var counterEnterP = AM.clamp((t - 0.82) / 0.18, 0, 1);
      var countScale = AM.ease.outBack(counterEnterP);
      if (t >= 2.04 && t < 2.22) {
        var punchP = (t - 2.04) / 0.18;
        countScale = 1.0 + Math.sin(punchP * Math.PI) * 0.05;
      }

      var countX = 380 + preCutX;

      ctx.save();
      ctx.translate(countX, counterBaseY);
      ctx.scale(countScale, countScale);

      // Warm radial glow
      var glowGrad = ctx.createRadialGradient(0, -25, 20, 0, -25, 210);
      glowGrad.addColorStop(0, 'rgba(238, 160, 48, 0.40)');
      glowGrad.addColorStop(0.45, 'rgba(238, 160, 48, 0.15)');
      glowGrad.addColorStop(1, 'rgba(238, 160, 48, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(0, -25, 210, 0, Math.PI * 2);
      ctx.fill();

      // Bold orange typography
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 86px "Montserrat", "Inter", sans-serif';

      // Soft bloom stroke
      ctx.save();
      ctx.shadowColor = 'rgba(235, 148, 28, 0.72)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#E59F35';
      ctx.fillText(countStr, 0, -20);
      ctx.restore();

      // Crisp foreground pass
      ctx.fillStyle = '#ECA93D';
      ctx.fillText(countStr, 0, -20);

      ctx.restore();
    }

    // 6. Subtitle Typography: "decisions" & "every single day"
    // In REF: "decisions" and "every" align at left margin x ~ 210
    var subX = 210 + preCutX;

    // "decisions" appears at t >= 2.02s
    if (t >= 2.00) {
      ctx.save();
      ctx.font = 'italic 500 58px "Playfair Display", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      AM.drawBlurRevealText(ctx, 'decisions', subX, 920, t, 2.00, 0.22, {
        color: '#1D1D1D',
        maxBlur: 12,
        risePx: 10
      });
      ctx.restore();
    }

    // "every single day" on line 2 (y ≈ 998)
    if (t >= 2.18) {
      ctx.save();
      ctx.font = 'italic 500 60px "Playfair Display", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      var line2Y = 998;

      // "every"
      AM.drawBlurRevealText(ctx, 'every', subX, line2Y, t, 2.18, 0.16, {
        color: '#1D1D1D',
        maxBlur: 12,
        risePx: 8
      });

      var wEvery = ctx.measureText('every ').width;

      // "single"
      if (t >= 2.68) {
        AM.drawBlurRevealText(ctx, 'single', subX + wEvery, line2Y, t, 2.68, 0.20, {
          color: '#1D1D1D',
          maxBlur: 12,
          risePx: 8
        });
      }

      var wSingle = ctx.measureText('single ').width;

      // "day" (lighter editorial tint)
      if (t >= 2.98) {
        AM.drawBlurRevealText(ctx, 'day', subX + wEvery + wSingle, line2Y, t, 2.98, 0.22, {
          color: '#767676',
          maxBlur: 12,
          risePx: 8
        });
      }

      ctx.restore();
    }
  });
})();
