// VISUAL PLAN:
// Sub-beat phases across 0..4.101s:
// 0.00 - 0.15s: Empty grid paper background hold (opening breath lock)
// 0.15 - 0.75s: Headline "Your decisions become" blur-reveals + 4 gradient bars rise to baseline y=762
// 0.55 - 1.15s: First trend polyline draws progressively across bars ending with downward dip arrow at (388, 526)
// 0.95 - 1.35s: "Faster" dashed selection box pops in at cy=841
// 1.70 - 2.15s: Trend polyline morphs to breakthrough upward trajectory + "Sharper" dashed box pops in at cy=954
// 2.45 - 2.85s: "Effective" dashed selection box pops in at cy=1066
// 3.75 - 4.10s: Seamless upward camera push exit (cy: 640 -> 1328) + 3D turntable corner star entrance
//
// Layer stack:
// 1. Background grid paper (#DEDAD4 clean plate + 45px subtle grid cells)
// 2. Bar chart shadows & 4 vertical gradient bars (teal, purple, magenta, orange)
// 3. Polyline trend line with directional arrowhead
// 4. Headline typography ("Your", "decisions become")
// 5. Transform selection boxes ("Faster", "Sharper", "Effective" with dashed borders & 8 handles)
// 6. Turntable purple star during transition into Scene 5

(function () {
  var AM = window.AM;

  AM.registerScene("scene4_cta", function (ctx, t, dur, scene, AM) {
    var W = 720;
    var H = 1280;

    // Camera push upward at the end matching measured camera track (t: 3.75s -> 4.101s)
    var camY = 640;
    if (t > 3.75) {
      var camP = AM.clamp((t - 3.75) / (dur - 3.75), 0, 1);
      camY = AM.lerp(640, 1328, AM.ease.inCubic(camP));
    }
    AM.applyCamera(ctx, { s: 1.0, cx: 360, cy: camY, rot: 0 }, W, H);

    // 1. BACKGROUND & GRID PAPER
    ctx.fillStyle = "#DAD7D2";
    ctx.fillRect(0, -400, W, H + 1200);

    // Grid pattern
    var gridSize = 45;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 0; gx <= W; gx += gridSize) {
      ctx.moveTo(gx + 0.5, -400);
      ctx.lineTo(gx + 0.5, H + 800);
    }
    for (var gy = -400; gy <= H + 800; gy += gridSize) {
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(W, gy + 0.5);
    }
    ctx.stroke();

    // 2. HEADLINE TYPOGRAPHY ("Your" & "decisions become")
    // Measured: "Your" center=(145, 220) box=[79, 188, 133x64]
    // "decisions become" center=(310, 275) box=[83, 246, 455x59]
    var textX = 84;
    var line1Baseline = 236;
    var line2Baseline = 292;

    if (t >= 0.12) {
      ctx.font = "italic 48px 'Playfair Display', Georgia, serif";
      AM.drawBlurRevealText(ctx, "Your", textX, line1Baseline, t, 0.12, 0.22, {
        scaleFrom: 0.85,
        maxBlur: 10,
        risePx: 8,
        color: "#1D1C1E"
      });
    }

    if (t >= 0.30) {
      ctx.font = "italic 44px 'Playfair Display', Georgia, serif";
      AM.drawBlurRevealText(ctx, "decisions", textX, line2Baseline, t, 0.30, 0.20, {
        scaleFrom: 0.85,
        maxBlur: 10,
        risePx: 8,
        color: "#1D1C1E"
      });
    }

    if (t >= 0.48) {
      ctx.font = "italic 44px 'Playfair Display', Georgia, serif";
      var decW = ctx.measureText("decisions ").width;
      AM.drawBlurRevealText(ctx, "become", textX + decW, line2Baseline, t, 0.48, 0.20, {
        scaleFrom: 0.85,
        maxBlur: 10,
        risePx: 8,
        color: "#1D1C1E"
      });
    }

    // 3. BAR CHART (baseline y = 762)
    var barBaseline = 762;
    var barW = 70;
    var barData = [
      { x: 180, fullH: 135, startT: 0.26, c1: "#53AEB1", c2: "#357788" }, // Teal
      { x: 277, fullH: 252, startT: 0.32, c1: "#6957A4", c2: "#48347E" }, // Purple
      { x: 374, fullH: 180, startT: 0.38, c1: "#B84E7F", c2: "#822658" }, // Magenta
      { x: 471, fullH: 312, startT: 0.44, c1: "#E9973D", c2: "#D44A29" }  // Orange
    ];

    for (var bi = 0; bi < barData.length; bi++) {
      var b = barData[bi];
      if (t < b.startT) continue;
      var bp = AM.clamp((t - b.startT) / 0.34, 0, 1);
      var growEase = AM.ease.outCubic(bp);
      var curH = b.fullH * growEase;
      if (curH <= 0.5) continue;

      var barTop = barBaseline - curH;
      var barRad = 4;

      ctx.save();
      // Drop shadow
      ctx.shadowColor = "rgba(30, 20, 10, 0.12)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 4;

      // Vertical gradient
      var grad = ctx.createLinearGradient(0, barTop, 0, barBaseline);
      grad.addColorStop(0, b.c1);
      grad.addColorStop(1, b.c2);
      ctx.fillStyle = grad;

      // Rounded top rect bar
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(b.x, barTop, barW, curH, [barRad, barRad, 0, 0]);
      } else {
        ctx.rect(b.x, barTop, barW, curH);
      }
      ctx.fill();
      ctx.restore();
    }

    // 4. TREND POLYLINE & DIRECTIONAL ARROW
    // Early stage: struggles and dips down towards bar 3 (t: 0.52 .. 1.65)
    // Later stage: morphs into breakout upward arrow above bar 4 (t >= 1.65)
    if (t >= 0.52) {
      var lineT = AM.clamp((t - 0.52) / 0.55, 0, 1);
      var ptsEarly = [
        { x: 214, y: 627 }, // top center of bar 1
        { x: 272, y: 468 }, // peak 1
        { x: 320, y: 516 }, // valley 1
        { x: 373, y: 480 }, // peak 2
        { x: 388, y: 526 }  // dip arrow tip pointing down-right
      ];

      var ptsLate = [
        { x: 214, y: 627 }, // top center of bar 1
        { x: 272, y: 468 }, // peak 1
        { x: 320, y: 516 }, // valley 1
        { x: 373, y: 480 }, // peak 2
        { x: 405, y: 580 }, // valley 2
        { x: 494, y: 368 }  // breakthrough arrow tip pointing up-right
      ];

      var morphP = AM.clamp((t - 1.65) / 0.42, 0, 1);
      var morphEase = AM.ease.inOutCubic(morphP);

      ctx.save();
      ctx.strokeStyle = "#2E2D30";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (morphP === 0) {
        // Draw early stage line progressively across 0.52..1.07s
        var maxSeg = 4;
        var totalDist = lineT * maxSeg;
        ctx.beginPath();
        ctx.moveTo(ptsEarly[0].x, ptsEarly[0].y);
        for (var si = 1; si <= maxSeg; si++) {
          if (totalDist >= si) {
            ctx.lineTo(ptsEarly[si].x, ptsEarly[si].y);
          } else if (totalDist > si - 1) {
            var frac = totalDist - (si - 1);
            var px = AM.lerp(ptsEarly[si - 1].x, ptsEarly[si].x, frac);
            var py = AM.lerp(ptsEarly[si - 1].y, ptsEarly[si].y, frac);
            ctx.lineTo(px, py);
            break;
          }
        }
        ctx.stroke();

        // Downward arrow at tip if drawn
        if (lineT >= 0.96) {
          renderArrowTip(ctx, ptsEarly[3], ptsEarly[4], "#627B55");
        }
      } else {
        // Morphing to late upward line
        ctx.beginPath();
        ctx.moveTo(ptsEarly[0].x, ptsEarly[0].y);
        ctx.lineTo(ptsEarly[1].x, ptsEarly[1].y);
        ctx.lineTo(ptsEarly[2].x, ptsEarly[2].y);
        ctx.lineTo(ptsEarly[3].x, ptsEarly[3].y);

        var curPt4X = AM.lerp(ptsEarly[4].x, ptsLate[4].x, morphEase);
        var curPt4Y = AM.lerp(ptsEarly[4].y, ptsLate[4].y, morphEase);
        ctx.lineTo(curPt4X, curPt4Y);

        if (morphEase > 0.08) {
          var shootP = AM.clamp((morphEase - 0.08) / 0.92, 0, 1);
          var curTipX = AM.lerp(curPt4X, ptsLate[5].x, shootP);
          var curTipY = AM.lerp(curPt4Y, ptsLate[5].y, shootP);
          ctx.lineTo(curTipX, curTipY);
          ctx.stroke();

          // Upward arrow at tip
          if (shootP > 0.05) {
            renderArrowTip(ctx, { x: curPt4X, y: curPt4Y }, { x: curTipX, y: curTipY }, "#627B55");
          }
        } else {
          ctx.stroke();
          renderArrowTip(ctx, ptsEarly[3], { x: curPt4X, y: curPt4Y }, "#627B55");
        }
      }
      ctx.restore();
    }

    // 5. DASHED SELECTION BOXES
    var boxData = [
      { text: "Faster", startT: 0.95, y: 841, w: 232, h: 58 },
      { text: "Sharper", startT: 1.80, y: 954, w: 274, h: 58 },
      { text: "Effective", startT: 2.50, y: 1066, w: 286, h: 58 }
    ];

    for (var k = 0; k < boxData.length; k++) {
      var item = boxData[k];
      if (t < item.startT) continue;
      var bpIn = AM.clamp((t - item.startT) / 0.28, 0, 1);
      var scale = AM.ease.outBack(bpIn);
      var alpha = AM.clamp(bpIn * 1.5, 0, 1);

      drawSelectionBox(ctx, 360, item.y, item.w, item.h, item.text, scale, alpha, t);
    }

    // 6. INCOMING 3D TURNTABLE PURPLE STAR (t >= 3.75)
    if (t >= 3.75) {
      var starP = AM.clamp((t - 3.75) / (dur - 3.75), 0, 1);
      var starX = AM.lerp(650, 580, starP);
      var starY = AM.lerp(1400, 1080, starP);
      var starSize = AM.lerp(70, 140, starP);

      AM.drawTurntableObject(ctx, starX, starY, t, function (c) {
        c.fillStyle = "#6F2A7E";
        drawConcaveStar(c, 0, 0, starSize, starSize * 0.28);
        c.fill();
      }, {
        w: starSize * 2,
        h: starSize * 2,
        omega: 2.0,
        depth: 0.24,
        ringRadius: starSize * 0.9,
        ringOmega: 0.65
      });
    }
  });

  // Helper: Directional Arrow Head
  function renderArrowTip(ctx, fromPt, toPt, color) {
    var dx = toPt.x - fromPt.x;
    var dy = toPt.y - fromPt.y;
    var angle = Math.atan2(dy, dx);
    var headLen = 11;
    var headW = 5;

    ctx.save();
    ctx.translate(toPt.x, toPt.y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-headLen, -headW);
    ctx.lineTo(-headLen * 0.7, 0);
    ctx.lineTo(-headLen, headW);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Helper: Selection Box with Dashed Border and 8 Handles
  function drawSelectionBox(ctx, cx, cy, w, h, text, scale, alpha, curT) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }

    var hw = w / 2;
    var hh = h / 2;

    // Dashed border
    ctx.strokeStyle = "#222024";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(-hw, -hh, w, h);

    // 8 resize handles
    ctx.setLineDash([]);
    ctx.fillStyle = "#222024";
    var handleR = 3.6;
    var handles = [
      { x: -hw, y: -hh },
      { x: 0,   y: -hh },
      { x: hw,  y: -hh },
      { x: hw,  y: 0 },
      { x: hw,  y: hh },
      { x: 0,   y: hh },
      { x: -hw, y: hh },
      { x: -hw, y: 0 }
    ];

    for (var i = 0; i < handles.length; i++) {
      ctx.beginPath();
      ctx.arc(handles[i].x, handles[i].y, handleR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Text inside box
    ctx.font = "italic 46px 'Playfair Display', Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#222024";
    ctx.fillText(text, 0, 1);

    ctx.restore();
  }

  // Helper: 4-Point Concave Star
  function drawConcaveStar(ctx, cx, cy, outerR, innerR) {
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var angleOut = (i * Math.PI) / 2;
      var angleIn = angleOut + Math.PI / 4;
      var ox = cx + Math.cos(angleOut) * outerR;
      var oy = cy + Math.sin(angleOut) * outerR;
      var ix = cx + Math.cos(angleIn) * innerR;
      var iy = cy + Math.sin(angleIn) * innerR;
      if (i === 0) {
        ctx.moveTo(ox, oy);
      } else {
        ctx.lineTo(ox, oy);
      }
      ctx.lineTo(ix, iy);
    }
    ctx.closePath();
  }
})();
