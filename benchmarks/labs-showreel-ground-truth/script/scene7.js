// Scene 7: Vertical Kinetic Focus Word Wheel (16.000s - 20.000s)
(function () {
  "use strict";
  var AM = window.AM;

  // Measured beats matching dense_ref contact_sheet_2 (16.00..20.00s) & k_18.00s.jpg
  var STATES = [
    { start: 0.00, top: "Building", center: "Busy in", bot: "Thinking" },
    { start: 0.52, top: "Thinking", center: "Finding", bot: "Building" },
    { start: 1.02, top: "Creating", center: "Thinking", bot: "Finding" },
    { start: 1.48, top: "Thinking", center: "Finding", bot: "Building" },
    { start: 3.04, top: "Finding", center: "Building", bot: "Creating" },
    { start: 3.44, top: "Thinking", center: "Finding", bot: "Building" },
    { start: 3.84, top: "Building", center: "Creating", bot: "Thinking" }
  ];

  AM.registerScene("scene7_word_stack", function (ctx, localTime, dur, scene, AM) {
    var W = 1024;
    var H = 576;
    ctx.fillStyle = "#0C0B0E";
    ctx.fillRect(0, 0, W, H);

    // Subtle residual purple zoom flash at frame 0..0.14s fading seamlessly out of Scene 6
    if (localTime < 0.16) {
      var introFade = 1 - AM.invLerp(0.0, 0.16, localTime);
      ctx.fillStyle = "rgba(88, 28, 135, " + (0.42 * introFade) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    var idx = 0;
    for (var i = STATES.length - 1; i >= 0; i--) {
      if (localTime >= STATES[i].start) {
        idx = i;
        break;
      }
    }
    var st = STATES[idx];
    var dt = localTime - st.start;

    // Snappy vertical wheel settle when switching slots
    var settle = dt < 0.16 ? AM.ease.outExpo(dt / 0.16) : 1.0;
    var slideOffset = idx > 0 ? 22 * (1 - settle) : 14 * (1 - AM.clamp(localTime / 0.18, 0, 1));
    var centerPop = idx > 0 ? 0.96 + 0.04 * settle : 1.0;

    // Subtle overall breathing drift matching slight wheel zoom feel
    var microDrift = Math.sin(localTime * 1.4) * 2;

    // Draw muted background upper & lower words FIRST so crisp white foreground overlaps cleanly
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "400 100px Inter, 'Segoe UI', Arial, sans-serif";
    ctx.fillStyle = "rgba(222, 221, 226, 0.34)";
    ctx.fillText(st.top, 515, 210 + slideOffset + microDrift);
    ctx.fillText(st.bot, 515, 372 + slideOffset + microDrift);
    ctx.restore();

    // Draw razor-crisp pure white active focal word on top
    ctx.save();
    ctx.translate(515, 291 + slideOffset + microDrift);
    ctx.scale(centerPop, centerPop);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "400 120px Inter, 'Segoe UI', Arial, sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(st.center, 0, 0);
    ctx.restore();
  });
})();
