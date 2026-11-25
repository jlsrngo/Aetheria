/* .aetheria/skills/mg-stickman-story/examples/script/stickman-world.js
 * 13 Layered 2.5D Cartoon Worlds ([back, front]) + 4 Time-of-Day Palettes.
 * Supports true multi-depth parallax via WorldCanvas.setDepth(d) and foreground occlusion.
 */
(function (root) {
  'use strict';

  var OUT = '#181A20';
  var GROUND_Y = 0;

  var TIME_PALETTES = {
    morning: {
      skyTop: '#A8E0FF', skyBot: '#FFF5DC', sun: '#FFE169',
      wall: '#FFF5E4', floor: '#E6C79C', grass: '#7FD17C', grassFar: '#A4E29E',
      tint: null
    },
    day: {
      skyTop: '#72C8FF', skyBot: '#E8F8FF', sun: '#FFE66D',
      wall: '#FAF3E8', floor: '#DFC196', grass: '#6BCB77', grassFar: '#95DF95',
      tint: null
    },
    sunset: {
      skyTop: '#FF9E7D', skyBot: '#FFE29A', sun: '#FF6B6B',
      wall: '#FFE8D6', floor: '#D4AA7D', grass: '#84B86B', grassFar: '#A7CC84',
      tint: 'rgba(255, 138, 76, 0.10)'
    },
    night: {
      skyTop: '#1B264F', skyBot: '#394A7A', sun: '#FFF3B0',
      wall: '#D8DFEE', floor: '#8D869C', grass: '#3B6E5C', grassFar: '#2C5147',
      tint: 'rgba(18, 26, 58, 0.28)'
    }
  };

  function getPalette(tod) {
    return TIME_PALETTES[tod] || TIME_PALETTES.morning;
  }

  function fillSkyScreen(c, topCol, botCol) {
    var ctx = c.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var g = ctx.createLinearGradient(0, 0, 0, c.H);
    g.addColorStop(0, topCol);
    g.addColorStop(1, botCol);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.W, c.H);
    ctx.restore();
  }

  function drawSkyClouds(c, pal, tod, t) {
    c.setDepth(0.22);
    var sunX = tod === 'sunset' ? -520 : 280;
    var sunY = tod === 'sunset' ? -240 : -520;
    c.ell(sunX, sunY, 74, 74, pal.sun, 0);
    if (tod === 'night') {
      var stars = [[-520, -640], [-280, -520], [-80, -680], [180, -560], [380, -620], [520, -490]];
      for (var si = 0; si < stars.length; si++) c.ell(stars[si][0], stars[si][1], 5, 5, '#FFF8D6', 0);
    }
    var drift = ((t || 0) * 14) % 2200;
    var clouds = [[-640, -560, 1.0], [-40, -640, 0.85], [520, -510, 1.1]];
    var cloudCol = tod === 'night' ? 'rgba(220,230,255,0.22)' : 'rgba(255,255,255,0.92)';
    for (var i = 0; i < clouds.length; i++) {
      var cx = ((clouds[i][0] + drift + 1100) % 2200) - 1100;
      var cy = clouds[i][1];
      var cs = clouds[i][2];
      c.ell(cx, cy, 88 * cs, 42 * cs, cloudCol, 0);
      c.ell(cx - 52 * cs, cy + 10 * cs, 54 * cs, 30 * cs, cloudCol, 0);
      c.ell(cx + 56 * cs, cy + 12 * cs, 58 * cs, 32 * cs, cloudCol, 0);
    }
    c.setDepth(1.0);
  }

  function drawTree(c, x, y, s, col) {
    c.rect(x - 16 * s, y - 130 * s, 32 * s, 134 * s, 8 * s, '#8B5A3C', 5.5 * s, OUT);
    c.ell(x, y - 195 * s, 96 * s, 84 * s, col || '#52B788', 6 * s, OUT);
    c.ell(x - 58 * s, y - 162 * s, 64 * s, 56 * s, col || '#52B788', 5.5 * s, OUT);
    c.ell(x + 58 * s, y - 162 * s, 64 * s, 56 * s, col || '#52B788', 5.5 * s, OUT);
  }

  function drawRoomShell(c, pal, wallCol, floorCol) {
    fillSkyScreen(c, wallCol || pal.wall, wallCol || pal.wall);
    c.setDepth(0.88);
    c.rect(-1800, -1400, 3600, 1400 - 30, 0, wallCol || pal.wall, 0);
    c.setDepth(1.0);
    c.rect(-1800, -32, 3600, 1200, 0, floorCol || pal.floor, 6, OUT);
    c.rect(-1800, -46, 3600, 18, 0, '#C8A27A', 5, OUT);
  }

  function drawAlarmClock(c, x, y, clockStr, ringing, t) {
    var shakeX = ringing ? Math.sin((t || 0) * 44) * 5.5 : 0;
    var shakeRot = ringing ? Math.sin((t || 0) * 38) * 6 : 0;
    var cx = x + shakeX;
    var cy = y - (ringing ? Math.abs(Math.sin((t || 0) * 22)) * 5 : 0);

    c.ell(cx - 34, cy - 42, 16, 12, '#FFCA3A', 5, OUT, -24 + shakeRot);
    c.ell(cx + 34, cy - 42, 16, 12, '#FFCA3A', 5, OUT, 24 + shakeRot);
    c.line([[cx, cy - 34], [cx + (ringing ? Math.sin((t || 0) * 55) * 10 : 0), cy - 52]], OUT, 5);

    c.rect(cx - 56, cy - 34, 112, 68, 16, '#FF595E', 6, OUT);
    c.rect(cx - 44, cy - 22, 88, 44, 9, '#1E2430', 4, OUT);
    c.text(clockStr || '07:00', cx, cy + 1, 28, '#72EFDD', 'center', 0, null, 900);

    if (ringing) {
      c.curve([[cx - 72, cy - 36], [cx - 82, cy - 52], [cx - 64, cy - 66]], '#FF595E', 5, false);
      c.curve([[cx + 72, cy - 36], [cx + 82, cy - 52], [cx + 64, cy - 66]], '#FF595E', 5, false);
      c.curve([[cx - 86, cy - 42], [cx - 98, cy - 62], [cx - 76, cy - 80]], '#FF9F1C', 4.5, false);
      c.curve([[cx + 86, cy - 42], [cx + 98, cy - 62], [cx + 76, cy - 80]], '#FF9F1C', 4.5, false);
    }
  }

  var WORLDS = {
    bedroom: {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        drawRoomShell(c, pal, '#FFF4E6', '#E5C39B');

        c.setDepth(0.85);
        c.rect(280, -660, 260, 230, 14, pal.skyTop, 6, OUT);
        c.ell(465, -605, 28, 28, pal.sun, 0);
        c.line([[410, -660], [410, -430]], OUT, 5.5);
        c.line([[280, -545], [540, -545]], OUT, 5.5);
        c.rect(258, -672, 44, 254, 12, '#74C0FC', 5.5, OUT);
        c.rect(518, -672, 44, 254, 12, '#74C0FC', 5.5, OUT);
        c.rect(-680, -640, 150, 115, 10, '#FFE066', 5.5, OUT);
        c.ell(-605, -582, 34, 26, '#FF6B6B', 4.5, OUT);
        c.rect(-200, -660, 120, 150, 10, '#B8F2E6', 5.5, OUT);
        c.poly([[-180, -540], [-140, -610], [-100, -540]], '#52B788', 4.5, OUT);

        c.setDepth(1.0);
        c.ell(60, 40, 380, 40, '#A8DADC', 5.5, OUT);

        c.rect(-580, -430, 46, 430, 14, '#9C6644', 6, OUT);
        c.rect(-560, -125, 600, 125, 12, '#B07D56', 6, OUT);
        c.rect(-560, -220, 600, 105, 18, '#FFF8F0', 6, OUT);
        c.ell(-380, -238, 82, 32, '#FFFFFF', 5.5, OUT);
        c.ell(-5, -252, 30, 28, '#FFD6E0', 5, OUT);
        c.ell(-17, -290, 9, 22, '#FFD6E0', 4.5, OUT);
        c.ell(7, -290, 9, 22, '#FFD6E0', 4.5, OUT);
        c.ell(-14, -256, 3.5, 3.5, OUT, 0);
        c.ell(4, -256, 3.5, 3.5, OUT, 0);
        if (opts.blanket !== false && !opts.blanketFront) {
          c.blob([[-300, -232], [-60, -238], [20, -214], [-10, -160], [-310, -160]], '#FF8FAB', 6, OUT, 6);
        }

        c.rect(105, -180, 160, 180, 12, '#B07D56', 6, OUT);
        c.rect(122, -150, 126, 64, 8, '#DDB892', 5, OUT);
        c.ell(185, -118, 8, 8, OUT, 0);
        drawAlarmClock(c, 185, -214, opts.clockTime || '07:00', !!opts.alarm, t);
      },
      front: function (c, opts) {
        if (opts.blanket !== false && opts.blanketFront) {
          c.setDepth(1.0);
          c.blob([[-300, -306], [-60, -312], [20, -262], [25, -205], [-305, -205], [-318, -258]], '#FF8FAB', 6, OUT, 7);
          c.curve([[-285, -276], [-140, -268], [-10, -276]], '#FFC2D1', 6, false);
        }
      }
    },

    park: {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        fillSkyScreen(c, pal.skyTop, pal.skyBot);
        drawSkyClouds(c, pal, opts.timeOfDay, t);

        c.setDepth(0.42);
        c.ell(-440, -30, 760, 260, pal.grassFar, 5.5, OUT);
        c.ell(440, -10, 820, 280, pal.grassFar, 5.5, OUT);

        c.setDepth(0.78);
        drawTree(c, -480, -35, 1.05, '#40916C');
        drawTree(c, 480, -30, 1.1, '#52B788');
        c.rect(-130, -125, 260, 28, 8, '#BC6C25', 5.5, OUT);
        c.rect(-140, -82, 280, 24, 8, '#DDA15E', 5.5, OUT);
        c.rect(-105, -58, 20, 56, 4, '#3D405B', 5, OUT);
        c.rect(85, -58, 20, 56, 4, '#3D405B', 5, OUT);

        c.setDepth(1.0);
        c.rect(-2000, -35, 4000, 1200, 0, pal.grass, 6, OUT);
        c.rect(-2000, -8, 4000, 118, 0, '#F3DFC1', 5.5, OUT);
        var fl = [-420, -240, 290, 460];
        for (var fi = 0; fi < fl.length; fi++) {
          c.ell(fl[fi], -22, 11, 11, fi % 2 ? '#FF70A6' : '#FFD166', 4, OUT);
        }
      },
      front: function (c) {
        c.setDepth(1.28);
        c.ell(-680, 230, 210, 105, '#2D6A4F', 6, OUT);
        c.ell(680, 235, 220, 110, '#2D6A4F', 6, OUT);
        c.setDepth(1.0);
      }
    },

    classroom: {
      back: function (c, opts) {
        var pal = getPalette(opts.timeOfDay);
        drawRoomShell(c, pal, '#F4F1DE', '#D9B99B');
        c.setDepth(0.9);
        c.rect(-420, -450, 840, 310, 14, '#2D6A4F', 7, OUT);
        c.rect(-440, -146, 880, 20, 6, '#B07D56', 5.5, OUT);
        c.text(opts.boardText || "Today's Lesson", 0, -330, 42, '#FFF8E7', 'center', 0, null, 700);
        c.setDepth(1.0);
      },
      front: function (c) {
        c.setDepth(1.12);
        c.rect(-620, 45, 280, 190, 10, '#C68B59', 6, OUT);
        c.rect(340, 45, 280, 190, 10, '#C68B59', 6, OUT);
        c.setDepth(1.0);
      }
    },

    study: {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        drawRoomShell(c, pal, '#F6F4FB', '#DEC09E');
        c.setDepth(0.88);
        c.rect(-560, -440, 240, 440, 10, '#B07D56', 6, OUT);
        c.rect(-538, -410, 196, 95, 6, '#FFF8F0', 4.5, OUT);
        c.rect(-538, -290, 196, 95, 6, '#FFF8F0', 4.5, OUT);
        drawAlarmClock(c, 420, -290, opts.clockTime || '19:30', false, t);
        c.setDepth(1.0);
      },
      front: function (c) {
        c.setDepth(1.05);
        c.rect(-340, -150, 680, 34, 10, '#C68B59', 6, OUT);
        c.rect(-300, -116, 36, 116, 6, '#9C6644', 5.5, OUT);
        c.rect(264, -116, 36, 116, 6, '#9C6644', 5.5, OUT);
        c.setDepth(1.0);
      }
    },

    'living-room': {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        drawRoomShell(c, pal, '#FFF6EC', '#E2C29B');
        c.setDepth(0.88);
        c.rect(-260, -450, 180, 130, 10, '#A8DADC', 5.5, OUT);
        c.rect(40, -450, 180, 130, 10, '#FFD166', 5.5, OUT);
        c.setDepth(1.0);
        c.rect(-380, -250, 760, 180, 28, '#457B9D', 6, OUT);
        c.rect(-420, -170, 65, 170, 22, '#1D3557', 6, OUT);
        c.rect(355, -170, 65, 170, 22, '#1D3557', 6, OUT);
        c.rect(-380, -100, 760, 100, 18, '#619B8A', 6, OUT);
        var wag = Math.sin((t || 0) * 4.5) * 14;
        c.ell(480, -12, 38, 22, '#F4A261', 5, OUT);
        c.ell(452, -28, 20, 18, '#F4A261', 5, OUT);
        c.curve([[516, -14], [544, -34 + wag], [556, -52 + wag]], '#F4A261', 8, false);
      },
      front: function () {}
    },

    street: {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        fillSkyScreen(c, pal.skyTop, pal.skyBot);
        drawSkyClouds(c, pal, opts.timeOfDay, t);
        c.setDepth(0.65);
        for (var hx = -1600; hx <= 1600; hx += 640) {
          c.rect(hx - 180, -340, 360, 310, 10, hx % 1280 === 0 ? '#FFE5D9' : '#E2ECE9', 6, OUT);
          c.poly([[hx - 210, -335], [hx, -470], [hx + 210, -335]], '#E07A5F', 6, OUT);
          c.rect(hx - 45, -165, 90, 135, 8, '#9C6644', 5.5, OUT);
          drawTree(c, hx + 270, -30, 0.88, '#52B788');
        }
        c.setDepth(1.0);
        c.rect(-2600, -36, 5200, 68, 0, '#D8D2C5', 5.5, OUT);
        c.rect(-2600, 32, 5200, 900, 0, '#4A4E69', 6, OUT);
        for (var dx = -2000; dx <= 2000; dx += 260) {
          c.rect(dx, 115, 120, 14, 4, '#FFF3B0', 0);
        }
      },
      front: function () {}
    },

    'school-yard': {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        fillSkyScreen(c, pal.skyTop, pal.skyBot);
        drawSkyClouds(c, pal, opts.timeOfDay, t);
        c.setDepth(0.76);
        c.rect(-480, -410, 960, 385, 14, '#FFF1D0', 6.5, OUT);
        c.poly([[-530, -405], [0, -545], [530, -405]], '#E76F51', 6.5, OUT);
        c.rect(-190, -370, 380, 64, 12, '#264653', 5.5, OUT);
        c.text(opts.signText || 'SUNNY HIGH', 0, -338, 32, '#FFFFFF', 'center', 0, null, 800);
        c.rect(-95, -240, 190, 215, 10, '#8D5B4C', 5.5, OUT);
        drawTree(c, -600, -25, 1.0, '#52B788');
        drawTree(c, 600, -25, 1.0, '#52B788');
        c.setDepth(1.0);
        c.rect(-2000, -25, 4000, 1000, 0, pal.grass, 6, OUT);
        c.rect(-260, -25, 520, 420, 0, '#E9D8A6', 5.5, OUT);
      },
      front: function () {}
    },

    cafeteria: {
      back: function (c, opts) {
        var pal = getPalette(opts.timeOfDay);
        drawRoomShell(c, pal, '#FFF8EE', '#E4C59E');
        c.setDepth(0.88);
        c.rect(-460, -260, 920, 260, 14, '#F4A261', 6, OUT);
        c.rect(-480, -390, 960, 85, 14, '#E76F51', 6, OUT);
        c.text('CAFE BAR', 0, -347, 38, '#FFFFFF', 'center', 0, null, 800);
        c.setDepth(1.0);
      },
      front: function () {}
    },

    field: {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        fillSkyScreen(c, pal.skyTop, pal.skyBot);
        drawSkyClouds(c, pal, opts.timeOfDay, t);
        c.setDepth(0.8);
        c.rect(-620, -380, 220, 350, 8, 'rgba(255,255,255,0.35)', 6, '#FFFFFF');
        c.rect(400, -380, 220, 350, 8, 'rgba(255,255,255,0.35)', 6, '#FFFFFF');
        c.setDepth(1.0);
        c.rect(-2000, -35, 4000, 1000, 0, '#52B788', 6, OUT);
        c.ell(0, 45, 260, 52, 'rgba(255,255,255,0.2)', 5, '#FFFFFF');
      },
      front: function () {}
    },

    'house-front': {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        fillSkyScreen(c, pal.skyTop, pal.skyBot);
        drawSkyClouds(c, pal, opts.timeOfDay, t);
        c.setDepth(0.8);
        c.rect(-400, -380, 800, 355, 14, '#FFF3E2', 6.5, OUT);
        c.poly([[-450, -375], [0, -545], [450, -375]], '#D66853', 6.5, OUT);
        c.rect(-75, -245, 150, 220, 10, '#9C6644', 5.5, OUT);
        drawTree(c, 520, -25, 1.05, '#52B788');
        c.setDepth(1.0);
        c.rect(-2000, -28, 4000, 1000, 0, pal.grass, 6, OUT);
      },
      front: function () {}
    },

    'dining-room': {
      back: function (c, opts) {
        var pal = getPalette(opts.timeOfDay);
        drawRoomShell(c, pal, '#FFF7ED', '#E2C199');
      },
      front: function (c) {
        c.setDepth(1.06);
        c.rect(-420, -150, 840, 38, 12, '#B07D56', 6, OUT);
        c.rect(-360, -112, 40, 112, 6, '#8D5B4C', 5.5, OUT);
        c.rect(320, -112, 40, 112, 6, '#8D5B4C', 5.5, OUT);
        c.ell(-140, -156, 58, 14, '#FFFFFF', 4.5, OUT);
        c.ell(140, -156, 58, 14, '#FFFFFF', 4.5, OUT);
        c.setDepth(1.0);
      }
    },

    meadow: {
      back: function (c, opts, t) {
        var pal = getPalette(opts.timeOfDay);
        fillSkyScreen(c, pal.skyTop, pal.skyBot);
        drawSkyClouds(c, pal, opts.timeOfDay, t);
        c.setDepth(0.45);
        c.ell(-420, -20, 860, 290, pal.grassFar, 5.5, OUT);
        c.ell(460, -10, 920, 310, pal.grassFar, 5.5, OUT);
        c.setDepth(1.0);
        c.rect(-2000, -30, 4000, 1000, 0, pal.grass, 6, OUT);
      },
      front: function () {}
    },

    plain: {
      back: function (c, opts) {
        var bg = opts.bgColor || '#FFFDF7';
        fillSkyScreen(c, bg, bg);
        c.setDepth(1.0);
        c.line([[-1400, 4], [1400, 4]], 'rgba(24,26,32,0.12)', 4);
      },
      front: function () {}
    }
  };

  function getWorld(name) { return WORLDS[name] || WORLDS.park; }

  function applyMoodTint(c, tod) {
    var pal = getPalette(tod);
    if (pal.tint) {
      c.ctx.save();
      c.ctx.fillStyle = pal.tint;
      c.ctx.fillRect(0, 0, c.W, c.H);
      c.ctx.restore();
    }
  }

  root.StickmanWorld = {
    version: 1,
    WORLDS: WORLDS,
    TIME_PALETTES: TIME_PALETTES,
    getWorld: getWorld,
    drawAlarmClock: drawAlarmClock,
    applyMoodTint: applyMoodTint
  };
})(typeof window !== 'undefined' ? window : globalThis);
