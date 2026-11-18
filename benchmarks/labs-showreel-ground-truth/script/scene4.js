// Scene 4: 3D Extruded Purple-Lit Cursor Fly-In & Horizontal Ticker Handoff (6.667s - 7.833s)
(function () {
  "use strict";
  var AM = window.AM;

  function rotPoint(p, rx, ry, rz) {
    var x = p[0], y = p[1], z = p[2];
    var cy = Math.cos(ry), sy = Math.sin(ry);
    var x1 = x * cy + z * sy;
    var z1 = -x * sy + z * cy;
    var cx = Math.cos(rx), sx = Math.sin(rx);
    var y2 = y * cx - z1 * sx;
    var z2 = y * sx + z1 * cx;
    var cz = Math.cos(rz), sz = Math.sin(rz);
    return [x2z(x1, y2, cz, sz), y2z(x1, y2, cz, sz), z2];
  }
  function x2z(x, y, cz, sz) { return x * cz - y * sz; }
  function y2z(x, y, cz, sz) { return x * sz + y * cz; }

  function projPoint(p, cx, cy, sc) {
    var focal = 680;
    var depth = focal / Math.max(120, focal + p[2] * sc);
    return [cx + p[0] * sc * depth, cy + p[1] * sc * depth];
  }

  function buildArrowShapeSamples() {
    // Concave-tail pointer arrow polygon matching k_06.80s.jpg
    var pts = [];
    // Tip -> Top-left wing
    pts.push([1.15, 0.06, 0]);
    pts.push([-0.92, -0.82, 0]);
    // Sample quadratic concave curve (-0.92,-0.82) -> ctrl (-0.38,0.0) -> (-0.84,0.84)
    var steps = 10;
    for (var i = 1; i <= steps; i++) {
      var u = i / steps;
      var qx = (1 - u) * (1 - u) * (-0.92) + 2 * (1 - u) * u * (-0.36) + u * u * (-0.84);
      var qy = (1 - u) * (1 - u) * (-0.82) + 2 * (1 - u) * u * (0.02) + u * u * (0.84);
      pts.push([qx, qy, 0]);
    }
    return pts;
  }

  function drawExtrudedCursor(ctx, cx, cy, sc, rx, ry, rz, alpha) {
    var front3 = buildArrowShapeSamples();
    var depthZ = 0.24;
    var f2 = [];
    var b2 = [];
    for (var i = 0; i < front3.length; i++) {
      var fp = rotPoint([front3[i][0], front3[i][1], -depthZ * 0.5], rx, ry, rz);
      var bp = rotPoint([front3[i][0], front3[i][1], depthZ * 0.5], rx, ry, rz);
      f2.push(projPoint(fp, cx, cy, sc));
      b2.push(projPoint(bp, cx, cy, sc));
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // Draw extruded side bevel walls
    for (var j = 0; j < f2.length; j++) {
      var k = (j + 1) % f2.length;
      ctx.beginPath();
      ctx.moveTo(f2[j][0], f2[j][1]);
      ctx.lineTo(f2[k][0], f2[k][1]);
      ctx.lineTo(b2[k][0], b2[k][1]);
      ctx.lineTo(b2[j][0], b2[j][1]);
      ctx.closePath();
      ctx.fillStyle = (j >= 1 && j < f2.length - 1) ? "#7C4DFF" : "#6D3DF5";
      ctx.fill();
      ctx.strokeStyle = "#8C63FF";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Draw front luminous white-lavender face
    ctx.beginPath();
    for (var m = 0; m < f2.length; m++) {
      if (m === 0) ctx.moveTo(f2[m][0], f2[m][1]);
      else ctx.lineTo(f2[m][0], f2[m][1]);
    }
    ctx.closePath();
    var grad = ctx.createLinearGradient(f2[1][0], f2[1][1], f2[0][0], f2[0][1]);
    grad.addColorStop(0, "#E4DCFF");
    grad.addColorStop(0.55, "#F9F7FF");
    grad.addColorStop(1, "#FFFFFF");
    ctx.shadowColor = "rgba(125, 86, 239, 0.55)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  AM.registerScene("scene4_cursor_fly", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    // Deep ambient purple radial aura matching k_06.80s / 7.20s
    var glowAlpha = 0.82 * (1 - AM.invLerp(0.68, 0.96, localTime));
    if (glowAlpha > 0.01) {
      var rg = ctx.createRadialGradient(485, 300, 12, 485, 300, 340);
      rg.addColorStop(0, "rgba(109, 40, 217, " + (0.48 * glowAlpha) + ")");
      rg.addColorStop(0.5, "rgba(76, 29, 149, " + (0.28 * glowAlpha) + ")");
      rg.addColorStop(1, "rgba(12, 11, 14, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    // Expanding thin circle shock ring around 0.40s (7.07s global)
    if (localTime >= 0.30 && localTime <= 0.68) {
      var rp = AM.invLerp(0.30, 0.68, localTime);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, " + (0.22 * Math.sin(Math.PI * rp)) + ")";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(540, 296, AM.lerp(45, 195, rp), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3D Extruded cursor fly-in (0.00 -> 0.82s) matching k_06.80s (bbox 148..571, 269..575 at t=0.13s)
    if (localTime < 0.84) {
      var u = AM.ease.outCubic(AM.invLerp(0.0, 0.72, localTime));
      var px = AM.lerp(345, 512, u);
      var py = AM.lerp(428, 306, u) + (localTime > 0.62 ? 120 * AM.ease.inQuad(AM.invLerp(0.62, 0.84, localTime)) : 0);
      var sc = AM.lerp(228, 50, u);
      var rx = AM.lerp(0.14, 1.05, AM.invLerp(0.38, 0.82, localTime));
      var ry = AM.lerp(-0.22, 0.25, u);
      var rz = AM.lerp(0.04, -1.25, AM.invLerp(0.45, 0.82, localTime));
      var alpha = 1.0 - AM.invLerp(0.72, 0.84, localTime);
      drawExtrudedCursor(ctx, px, py, sc, rx, ry, rz, alpha);
    }

    // Word marquee enters cleanly from 0.72s -> 1.166s (continuing seamlessly into Scene 5!)
    if (localTime >= 0.70) {
      var tp = AM.invLerp(0.70, dur, localTime);
      var words = ["Motion", "Designing", "Workflow", "Animation", "Launch"];
      ctx.save();
      ctx.globalAlpha = AM.clamp(tp * 2.4, 0, 1);
      ctx.font = "400 42px Inter, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#EFEFF3";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      var scrollX = AM.lerp(560, 225, tp);
      for (var w = 0; w < words.length; w++) {
        ctx.fillText(words[w], scrollX + w * 235, 290);
      }
      ctx.restore();
    }
  });
})();
