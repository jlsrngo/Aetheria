// Scene 5: Word Marquee Handoff -> Vertical Bento Slot "Information to Motion" (7.833s - 11.000s)
(function () {
  "use strict";
  var AM = window.AM;

  function drawPointer(ctx, x, y, sc, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang || 0);
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

  function drawSlotIcon(ctx, icon, fg) {
    ctx.save();
    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (icon === "sparkle") {
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.quadraticCurveTo(3, -3, 22, 0);
      ctx.quadraticCurveTo(3, 3, 0, 22);
      ctx.quadraticCurveTo(-3, 3, -22, 0);
      ctx.quadraticCurveTo(-3, -3, 0, -22);
      ctx.fill();
    } else if (icon === "logoL") {
      ctx.beginPath();
      ctx.moveTo(-4, -22); ctx.lineTo(12, -22); ctx.lineTo(-9, 22); ctx.lineTo(-24, 22);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-1, 11); ctx.lineTo(24, 11); ctx.lineTo(19, 22); ctx.lineTo(-6, 22);
      ctx.closePath(); ctx.fill();
    } else if (icon === "tumpuk") {
      ctx.beginPath();
      ctx.moveTo(-14, -10); ctx.lineTo(15, -22); ctx.lineTo(15, -8); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 8); ctx.lineTo(15, -4); ctx.lineTo(15, 10); ctx.lineTo(-14, 22); ctx.closePath(); ctx.fill();
    } else if (icon === "cRing") {
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0.45, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(14, -10, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (icon === "focus") {
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-22, -8); ctx.lineTo(-22, -22); ctx.lineTo(-8, -22);
      ctx.moveTo(8, 22); ctx.lineTo(22, 22); ctx.lineTo(22, 8);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    } else if (icon === "moon") {
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#B8B8BC";
      ctx.beginPath();
      ctx.arc(9, -6, 17, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // bean oval split
      ctx.rotate(0.42);
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#98989D";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, -20); ctx.lineTo(0, 20);
      ctx.stroke();
    }
    ctx.restore();
  }

  var SLOT_CARDS = [
    { icon: "sparkle", bg: "#1B1C1E", fg: "#EAEAEF" },
    { icon: "logoL", bg: "#F2F1EC", fg: "#161618" },
    { icon: "tumpuk", bg: "#2B2D30", fg: "#EAEAEF" },
    { icon: "cRing", bg: "#161719", fg: "#F2F1EC" },
    { icon: "focus", bg: "#262B27", fg: "#F2F1EC" },
    { icon: "moon", bg: "#B8B8BC", fg: "#18181A" },
    { icon: "bean", bg: "#98989D", fg: "#161618" }
  ];

  AM.registerScene("scene5_info_to_motion", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    // Part 5A: Horizontal ticker continuation -> blur out (0.00 -> 1.42s)
    if (localTime < 1.45) {
      var uA = AM.invLerp(0.0, 1.40, localTime);
      var words = ["Motion", "Designing", "Workflow", "Animation", "Launch"];
      var scrollX = AM.lerp(225, -420, AM.ease.inOutQuad(uA));
      var fadeOutA = 1.0 - AM.invLerp(0.95, 1.38, localTime);
      var blurPx = uA > 0.42 ? Math.min(8, (uA - 0.42) * 14) : 0;

      ctx.save();
      ctx.globalAlpha = fadeOutA;
      if (blurPx > 0.3) ctx.filter = "blur(" + blurPx.toFixed(1) + "px)";
      ctx.font = "400 42px Inter, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#EFEFF3";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (var w = 0; w < words.length; w++) {
        ctx.fillText(words[w], scrollX + w * 235, 290);
      }
      ctx.filter = "none";
      ctx.restore();

      // Cursor tracking words above/below
      var cu = AM.ease.inOutCubic(AM.invLerp(0.05, 1.25, localTime));
      var cx = AM.lerp(470, 585, cu);
      var cy = AM.lerp(355, 232, cu);
      ctx.save();
      ctx.globalAlpha = fadeOutA;
      drawPointer(ctx, cx, cy, 0.72, -0.25);
      ctx.restore();
    }

    // Part 5B: "Information to [vertical icon slot] Motion" (1.42 -> 3.167s)
    if (localTime >= 1.38) {
      var pB = AM.invLerp(1.38, 1.72, localTime);
      var slotReveal = AM.smoothstep(1.62, 1.90, localTime);
      var outB = 1.0 - AM.invLerp(2.96, dur, localTime);
      var alphaB = AM.clamp(pB, 0, 1) * outB;

      // Stepped smooth scroll across the 7 slot cards matching ref timing:
      // 9.80s(lt=1.97)->logoL(1), 10.00s(lt=2.17)->logoL(1), 10.40s(lt=2.57)->cRing(3), 10.60s(lt=2.77)->focus(4), 10.80s(lt=2.97)->moon(5)
      var keys = [
        [1.40, 1.0],
        [2.20, 1.0],
        [2.38, 2.0],
        [2.56, 3.0],
        [2.72, 4.0],
        [2.86, 4.0],
        [2.97, 5.0],
        [3.14, 6.0]
      ];
      var scrollIdx = 1.0;
      for (var k = 0; k < keys.length - 1; k++) {
        if (localTime >= keys[k][0] && localTime <= keys[k + 1][0]) {
          var frac = AM.ease.outCubic(AM.invLerp(keys[k][0], keys[k + 1][0], localTime));
          scrollIdx = AM.lerp(keys[k][1], keys[k + 1][1], frac);
          break;
        }
        if (localTime > keys[k + 1][0]) scrollIdx = keys[k + 1][1];
      }

      var cardW = 236;
      var cardH = 88;
      var cardStep = 94;

      // Clip central vertical slot window
      if (slotReveal > 0.01) {
      ctx.save();
      ctx.globalAlpha = alphaB * slotReveal;
      ctx.beginPath();
      ctx.rect(390, 130, cardW + 8, 316);
      ctx.clip();

      for (var i = 0; i < SLOT_CARDS.length; i++) {
        var dy = (i - scrollIdx) * cardStep;
        if (Math.abs(dy) > 190) continue;
        var card = SLOT_CARDS[i];
        var distNorm = Math.abs(dy) / 145;
        var cardAlpha = AM.clamp(1.0 - distNorm * 0.72, 0.08, 1.0);
        var cardY = 288 + dy;

        ctx.save();
        ctx.globalAlpha *= cardAlpha;
        ctx.fillStyle = card.bg;
        ctx.fillRect(512 - cardW * 0.5, cardY - cardH * 0.5, cardW, cardH);

        ctx.translate(512, cardY);
        drawSlotIcon(ctx, card.icon, card.fg);
        ctx.restore();
      }
      ctx.restore();
      }

      // Top & bottom gradient edge fades on vertical carousel column
      var fadeTop = ctx.createLinearGradient(0, 130, 0, 232);
      fadeTop.addColorStop(0, "rgba(12,11,14,1)");
      fadeTop.addColorStop(1, "rgba(12,11,14,0)");
      ctx.fillStyle = fadeTop;
      ctx.fillRect(388, 128, cardW + 12, 105);

      var fadeBot = ctx.createLinearGradient(0, 344, 0, 446);
      fadeBot.addColorStop(0, "rgba(12,11,14,0)");
      fadeBot.addColorStop(1, "rgba(12,11,14,1)");
      ctx.fillStyle = fadeBot;
      ctx.fillRect(388, 344, cardW + 12, 105);

      // Symmetrical crisp side labels "Information to" [card] "Motion"
      ctx.save();
      ctx.globalAlpha = alphaB;
      ctx.font = "400 20px Inter, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#E4E3E8";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      ctx.fillText("Information to", AM.lerp(505, 358, slotReveal), 288);
      ctx.textAlign = "left";
      ctx.fillText("Motion", AM.lerp(517, 666, slotReveal), 288);
      ctx.restore();

      // Hover cursor touching center right during card toggle
      if (localTime >= 1.50 && localTime <= 2.35) {
        var ch = AM.invLerp(1.50, 2.35, localTime);
        ctx.save();
        ctx.globalAlpha = alphaB * AM.hump(ch);
        drawPointer(ctx, AM.lerp(605, 520, ch), AM.lerp(330, 286, ch), 0.72, -0.2);
        ctx.restore();
      }
    }
  });
})();
