(function () {
  var AM = window.AM;

  // VISUAL PLAN:
  // Sub-beat phases:
  // 0.00s - 0.06s: Previous scene selection box ("Effective") exits upward at top-right.
  // 0.04s - 0.24s: Word "Smart" unblurs on line 1.
  // 0.12s - 0.70s: Two sweeping curved arcs grow and kiss under typography at (380, 640).
  // 0.34s - 0.54s: Word "decisions" unblurs on line 1 ("Smart decisions").
  // 0.54s - 1.10s: Continuous camera pan up (dy ≈ -25px) matching measured motion window.
  // 0.64s - 0.84s: Word "aren't" unblurs on line 2.
  // 0.94s - 1.14s: Word "Luck" unblurs on line 2 ("aren't Luck").
  // 1.14s - 2.05s: Living hold with turntable spin of top-left star, floating drift of right stars.
  //
  // Layer stack:
  // 1. Clean plate #DADADA background + subtle 45px grid.
  // 2. Intersecting curved ribbon arcs:
  //    - Arc 1 (Smile curve): from top-left (60, 0) dipping through (380, 645) up to (720, 420).
  //    - Arc 2 (Frown curve): from bottom-left (0, 920) peaking through (380, 635) down to (720, 880).
  // 3. Central Typography: "Smart decisions" / "aren't Luck" in italic Playfair Display.
  // 4. Stars:
  //    - Star 1 (Top-Left): sharp 4-point concave star with turntable 3D spin & drop shadow.
  //    - Star 2 (Upper-Right): blurred deep-purple 4-point star floating near (680, 775).
  //    - Star 3 (Lower-Right): blurred deep-purple 4-point star floating near (650, 1060).
  // 5. Exiting selection box ("Effective") at top-right (t = 0.00s..0.06s).

  function drawGrid(ctx, w, h, cellSize, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = cellSize; x < w; x += cellSize) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (var y = cellSize; y < h; y += cellSize) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawConcaveStar(ctx, cx, cy, rOuter, rCtrl, angle, gradStart, gradEnd, shadow) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    if (shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetX = 10;
      ctx.shadowOffsetY = 10;
    }

    var grad = ctx.createLinearGradient(-rOuter * 0.7, -rOuter * 0.7, rOuter * 0.7, rOuter * 0.7);
    grad.addColorStop(0, gradStart || '#220827');
    grad.addColorStop(1, gradEnd || '#621d6e');
    ctx.fillStyle = grad;

    ctx.beginPath();
    var tips = [
      { x: 0, y: -rOuter },
      { x: rOuter, y: 0 },
      { x: 0, y: rOuter },
      { x: -rOuter, y: 0 }
    ];

    var midAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];

    ctx.moveTo(tips[0].x, tips[0].y);
    for (var i = 0; i < 4; i++) {
      var nextTip = tips[(i + 1) % 4];
      var ctrlX = Math.cos(midAngles[i]) * rCtrl;
      var ctrlY = Math.sin(midAngles[i]) * rCtrl;
      ctx.quadraticCurveTo(ctrlX, ctrlY, nextTip.x, nextTip.y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawDashedPill(ctx, cx, cy, w, h, text) {
    ctx.save();
    var x = cx - w / 2;
    var y = cy - h / 2;

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    var handles = [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h },
      { x: x + w / 2, y: y },
      { x: x + w / 2, y: y + h },
      { x: x, y: y + h / 2 },
      { x: x + w, y: y + h / 2 }
    ];

    ctx.fillStyle = '#111111';
    for (var i = 0; i < handles.length; i++) {
      ctx.beginPath();
      ctx.arc(handles[i].x, handles[i].y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = 'italic 500 38px "Playfair Display", Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 2);

    ctx.restore();
  }

  function drawArcRibbon(ctx, p0, p1, p2, p3, progress, lineWidth, color) {
    if (progress <= 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var steps = 48;
    var maxStep = Math.min(steps, Math.floor(steps * progress));
    if (maxStep < 1) {
      ctx.restore();
      return;
    }

    ctx.beginPath();
    for (var i = 0; i <= maxStep; i++) {
      var u = i / steps;
      var inv = 1 - u;
      var inv2 = inv * inv;
      var inv3 = inv2 * inv;
      var u2 = u * u;
      var u3 = u2 * u;

      var px = inv3 * p0.x + 3 * inv2 * u * p1.x + 3 * inv * u2 * p2.x + u3 * p3.x;
      var py = inv3 * p0.y + 3 * inv2 * u * p1.y + 3 * inv * u2 * p2.y + u3 * p3.y;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  AM.registerScene('scene5_beat_5', function (ctx, t, dur, scene, AM) {
    var W = 720;
    var H = 1280;

    // Measured camera pan up across 0.54..1.10s beat
    var panY = -AM.lerp(0, 22, AM.ease.inOutCubic(AM.clamp((t - 0.45) / 0.70, 0, 1)));

    // 1. Background clean plate + grid
    ctx.fillStyle = '#DADADA';
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H, 45, 'rgba(0, 0, 0, 0.045)');

    ctx.save();
    ctx.translate(0, panY);

    // 2. Intersecting Translucent Gray Curved Arcs
    var arcColor = 'rgba(188, 188, 188, 0.58)';
    var arcWidth = 24;

    // Arc 1 (Smile curve): from top-left (55, 0) curving down through (380, 650) up to (730, 420)
    var arc1P0 = { x: 55, y: -20 };
    var arc1P1 = { x: 130, y: 720 };
    var arc1P2 = { x: 510, y: 740 };
    var arc1P3 = { x: 740, y: 415 };

    var arc1Progress = AM.clamp((t - 0.10) / 0.55, 0, 1);
    drawArcRibbon(ctx, arc1P0, arc1P1, arc1P2, arc1P3, AM.ease.outCubic(arc1Progress), arcWidth, arcColor);

    // Arc 2 (Frown curve): from bottom-left (0, 920) curving up through (380, 635) down to (730, 880)
    var arc2P0 = { x: -25, y: 920 };
    var arc2P1 = { x: 180, y: 550 };
    var arc2P2 = { x: 530, y: 560 };
    var arc2P3 = { x: 740, y: 880 };

    var arc2Progress = AM.clamp((t - 0.16) / 0.55, 0, 1);
    drawArcRibbon(ctx, arc2P0, arc2P1, arc2P2, arc2P3, AM.ease.outCubic(arc2Progress), arcWidth, arcColor);

    // 3. Central Typography
    var font = 'italic 500 42px "Playfair Display", Georgia, serif';
    var textColor = '#3d363f';

    ctx.font = font;
    var wSmart = ctx.measureText('Smart ').width;
    var wArent = ctx.measureText("aren't ").width;

    var line1X = 176;
    var line1Y = 621;
    var line2X = 175;
    var line2Y = 681;

    // Line 1: "Smart" then "decisions"
    AM.drawBlurRevealText(ctx, 'Smart', line1X, line1Y, t, 0.04, 0.22, {
      scaleFrom: 0.85,
      maxBlur: 14,
      risePx: 10,
      color: textColor,
      preBlurSec: 0.12
    });

    AM.drawBlurRevealText(ctx, 'decisions', line1X + wSmart, line1Y, t, 0.34, 0.22, {
      scaleFrom: 0.85,
      maxBlur: 14,
      risePx: 10,
      color: textColor,
      preBlurSec: 0.12
    });

    // Line 2: "aren't" then "Luck"
    AM.drawBlurRevealText(ctx, "aren't", line2X, line2Y, t, 0.64, 0.22, {
      scaleFrom: 0.85,
      maxBlur: 14,
      risePx: 10,
      color: textColor,
      preBlurSec: 0.12
    });

    AM.drawBlurRevealText(ctx, 'Luck', line2X + wArent, line2Y, t, 0.94, 0.22, {
      scaleFrom: 0.85,
      maxBlur: 14,
      risePx: 10,
      color: textColor,
      preBlurSec: 0.12
    });

    // 4. Ambient Stars
    // Star 1: Top-Left sharp star (rOuter = 104, rCtrl = 4)
    var s1Drift = AM.ease.outCubic(AM.clamp(t / 0.5, 0, 1));
    var s1X = AM.lerp(134, 137, s1Drift);
    var s1Y = AM.lerp(162, 194, s1Drift);

    // Hero Star with turntable 3D rotation & continuous spin
    AM.drawTurntableObject(ctx, s1X, s1Y, t, function (c) {
      drawConcaveStar(c, 0, 0, 104, 4, -0.14 + t * 0.38, '#220827', '#621d6e', true);
    }, {
      w: 220,
      h: 220,
      omega: 0.35,
      depth: 0.08
    });

    // Star 2: Upper-right blurred star (around x=680, y=775)
    var s2Float = AM.clamp((t - 0.08) / 0.5, 0, 1);
    var s2X = AM.lerp(720, 680, AM.ease.outCubic(s2Float)) + Math.sin(t * 1.8) * 8;
    var s2Y = AM.lerp(820, 775, AM.ease.outCubic(s2Float)) + Math.cos(t * 1.4) * 12;
    var s2Angle = -0.32 - t * 0.28;
    ctx.save();
    ctx.filter = 'blur(16px)';
    drawConcaveStar(ctx, s2X, s2Y, 126, 6, s2Angle, '#220827', '#621d6e', false);
    ctx.filter = 'none';
    ctx.restore();

    // Star 3: Lower-right blurred star (around x=650, y=1060)
    var s3Float = AM.clamp(t / 0.6, 0, 1);
    var s3X = AM.lerp(690, 650, AM.ease.outCubic(s3Float)) + Math.cos(t * 1.5) * 10;
    var s3Y = AM.lerp(1020, 1060, AM.ease.outCubic(s3Float)) + Math.sin(t * 1.2) * 14;
    var s3Angle = 0.35 + t * 0.32;
    ctx.save();
    ctx.filter = 'blur(18px)';
    drawConcaveStar(ctx, s3X, s3Y, 134, 7, s3Angle, '#220827', '#621d6e', false);
    ctx.filter = 'none';
    ctx.restore();

    ctx.restore(); // Undo panY for exiting element

    // 5. Outgoing Scene 4 transition box ("Effective") at top-right
    if (t < 0.06) {
      var exitP = AM.ease.inCubic(t / 0.05);
      var exitY = 36 - exitP * 90;
      var pillAlpha = 1 - exitP;

      ctx.save();
      ctx.globalAlpha = pillAlpha;
      drawDashedPill(ctx, 480, exitY, 260, 56, 'Effective');
      ctx.restore();
    }
  });
})();
