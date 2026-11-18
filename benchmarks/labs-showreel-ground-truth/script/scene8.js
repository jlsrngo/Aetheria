// Scene 8: Geometric "L" + Isometric Terracotta Voxel Mascot & "Labs Studio" Outro (20.000s - 25.867s)
(function () {
  "use strict";
  var AM = window.AM;

  function drawVoxelMascot(ctx, x, y, sc, sx, sy) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc * sx, sc * sy);

    // Soft warm glow beneath mascot feet
    var glow = ctx.createRadialGradient(0, 14, 4, 0, 14, 58);
    glow.addColorStop(0, "rgba(210, 102, 78, 0.28)");
    glow.addColorStop(1, "rgba(210, 102, 78, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-60, -45, 120, 80);

    // 4 stubby feet standing on bottom foot shelf
    ctx.fillStyle = "#944636";
    ctx.fillRect(-26, 14, 7, 13);
    ctx.fillRect(-13, 14, 7, 13);
    ctx.fillRect(7, 14, 7, 13);
    ctx.fillRect(20, 14, 7, 13);

    // Darker side depth extrusion for 3D legs
    ctx.fillStyle = "#703125";
    ctx.fillRect(-19, 14, 3, 13);
    ctx.fillRect(27, 14, 4, 13);

    // Right-side 3D bevel depth face
    ctx.fillStyle = "#763529";
    ctx.beginPath();
    ctx.moveTo(28, -24);
    ctx.lineTo(35, -20);
    ctx.lineTo(35, 17);
    ctx.lineTo(28, 14);
    ctx.closePath();
    ctx.fill();

    // Top 3D bevel face (cleanly sloping back-right without front corner overhang)
    ctx.fillStyle = "#C36C57";
    ctx.beginPath();
    ctx.moveTo(-29, -20);
    ctx.lineTo(-22, -25);
    ctx.lineTo(35, -25);
    ctx.lineTo(28, -20);
    ctx.closePath();
    ctx.fill();

    // Left & right ear/arm nubs
    ctx.fillStyle = "#B35B48";
    ctx.fillRect(-35, -13, 7, 13);
    ctx.fillStyle = "#9A4837";
    ctx.fillRect(28, -13, 9, 13);

    // Front rectangular body face
    ctx.fillStyle = "#A4513F";
    ctx.fillRect(-29, -20, 57, 35);

    // Two crisp dark voxel square eyes
    ctx.fillStyle = "#111012";
    ctx.fillRect(-21, -8, 6, 7);
    ctx.fillRect(14, -8, 6, 7);

    ctx.restore();
  }

  AM.registerScene("scene8_outro", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    // Brief closing echo of Scene 7 vertical stack (0.00 -> 0.56s)
    if (localTime < 0.58) {
      var echoFade = 1 - AM.ease.inOutCubic(AM.invLerp(0.08, 0.56, localTime));
      var echoShift = -16 * AM.ease.outCubic(AM.invLerp(0.0, 0.52, localTime));
      ctx.save();
      ctx.globalAlpha = echoFade;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "400 66px Inter, sans-serif";
      ctx.fillStyle = "rgba(222,221,226,0.34)";
      ctx.fillText("Creating", 512, 220 + echoShift);
      ctx.fillText("Finding", 512, 358 + echoShift);
      ctx.font = "500 78px Inter, sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText("Thinking", 512, 289 + echoShift);
      ctx.restore();
    }

    // 1. Slanted Left Pillar of "L" (0.58s -> lock)
    var pillarP = AM.clamp(AM.ease.outExpo(AM.invLerp(0.58, 1.05, localTime)), 0, 1);
    if (pillarP > 0.005) {
      ctx.save();
      ctx.beginPath();
      // Reveal clip wipe bottom-up/top-down crisp
      var topY = 148;
      var botY = 352;
      ctx.rect(380, topY, 180, (botY - topY + 10) * pillarP);
      ctx.clip();

      ctx.fillStyle = "#ECEBE4";
      ctx.beginPath();
      ctx.moveTo(494, 148);
      ctx.lineTo(548, 148);
      ctx.lineTo(458, 352);
      ctx.lineTo(404, 352);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 2. Bottom Horizontal Parallelogram Foot of "L" (1.02s -> slide out right)
    var footP = AM.clamp(AM.spring(Math.max(0, localTime - 1.02), { stiffness: 195, damping: 18 }), 0, 1);
    if (localTime >= 1.02) {
      ctx.save();
      ctx.globalAlpha = AM.clamp(footP * 2, 0, 1);
      var footSlideX = -76 * (1 - footP);
      ctx.translate(footSlideX, 0);
      ctx.fillStyle = "#ECEBE4";
      ctx.beginPath();
      ctx.moveTo(488, 312);
      ctx.lineTo(604, 312);
      ctx.lineTo(586, 352);
      ctx.lineTo(470, 352);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 3. Cute Isometric Voxel Bear Mascot dropping onto the shelf (1.68s -> settle)
    if (localTime >= 1.66) {
      var dtBear = localTime - 1.66;
      var dropP = AM.spring(dtBear, { stiffness: 210, damping: 14 });
      var yOffset = -115 * (1 - dropP);
      var bounceVel = AM.springV(dtBear, 2.3, 0.45);
      var squash = AM.squashStretch(bounceVel * 0.14, 0.12);
      var bearAlpha = AM.clamp(dtBear / 0.14, 0, 1);
      ctx.save();
      ctx.globalAlpha = bearAlpha;
      drawVoxelMascot(ctx, 544, 292 + yOffset, 1.04, squash.sx, squash.sy);
      ctx.restore();
    }

    // 4. Crisp "Labs Studio" lockup (2.68s -> 3.15s)
    if (localTime >= 2.68) {
      var titleP = AM.clamp(AM.spring(localTime - 2.68, { stiffness: 180, damping: 19 }), 0, 1);
      ctx.save();
      ctx.globalAlpha = titleP;
      ctx.fillStyle = "#EEEDE6";
      ctx.font = "600 28px Inter, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Labs Studio", 512, 396 + 18 * (1 - titleP));
      ctx.restore();
    }

    // 5. Micro wide-tracked caption "CLAWD NETWORK · DIBUAT DI LABS STUDIO" (3.10s -> 5.867s)
    if (localTime >= 3.05) {
      var subP = AM.smoothstep(3.05, 3.65, localTime);
      var raw = "CLAWD NETWORK  ·  DIBUAT DI LABS STUDIO";
      ctx.save();
      ctx.globalAlpha = 0.72 * subP;
      ctx.fillStyle = "#85838B";
      ctx.font = "500 9.5px Inter, 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      var tracking = 2.6;
      var totalSubW = 0;
      for (var c = 0; c < raw.length; c++) {
        totalSubW += ctx.measureText(raw[c]).width + (c < raw.length - 1 ? tracking : 0);
      }
      var sx = 512 - totalSubW * 0.5;
      for (var d = 0; d < raw.length; d++) {
        ctx.fillText(raw[d], sx, 428);
        sx += ctx.measureText(raw[d]).width + tracking;
      }
      ctx.restore();
    }
  });
})();
