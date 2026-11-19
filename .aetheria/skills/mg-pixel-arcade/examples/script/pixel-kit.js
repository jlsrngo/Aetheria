(function () {
  'use strict';

  // QUEST-32 Master Palette (32 indexed SNES/GBA colours)
  var HEX = [
    '0d0b1a','1b1a33','2a2f5a','3d4a8a','4f6fc0','5b9bea','8cc8f5','c8ecff',
    'ffffff','3b1f47','6b2d5c','b0415f','e8665a','f59a4a','ffd166','fff3b0',
    '0f2a2a','1d4a3a','2e7a45','4fae4a','93d65a','2b1a1f','5a3326','8a5236',
    'c07a45','e8b27c','7a1f2e','d23c3c','ffc9a0','4a5270','7d88a8','b8c2d9'
  ];
  var MP = HEX.map(function (h) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  });

  var STAGE_INDEX = { day: 0, afternoon: 1, golden: 2, sunset: 3, dusk: 4, night: 5 };
  var NSLOT = 128;
  var SM = [];
  for (var si = 0; si < NSLOT; si++) SM[si] = [0, 0, 0, 0, 0, 0];
  function M(i) { return 64 + i; }
  for (var di = 0; di < 32; di++) SM[64 + di] = [di, di, di, di, di, di];

  var E = {};
  var nS = 1;
  function env(n, a) { E[n] = nS; SM[nS] = a; nS++; }
  //            DAY AFT GLD SUN DSK NGT
  env('s0',   [ 4,  4,  3,  3,  2,  1]);
  env('s1',   [ 5,  5,  4, 10,  3,  2]);
  env('s2',   [ 6,  6, 25, 11, 10,  3]);
  env('s3',   [ 7, 15, 14, 12, 11,  9]);
  env('s4',   [ 7, 14, 13, 13, 12, 10]);
  env('sun',  [15, 15, 15, 14, 13, 13]);
  env('sunG', [ 8, 15, 14, 13, 12, 11]);
  env('clL',  [ 8,  8, 15, 13, 11,  3]);
  env('clD',  [31, 25, 24, 11, 10,  2]);
  env('mD',   [ 5,  5, 29, 10,  9,  1]);
  env('mL',   [ 6, 25, 24, 11, 10,  2]);
  env('mS',   [ 8, 15, 15, 12, 11,  3]);
  env('rD',   [29, 22, 22,  9,  9,  1]);
  env('rM',   [30, 23, 24, 10, 10,  2]);
  env('rL',   [31, 25, 28, 11, 11,  3]);
  env('fD',   [17, 17, 17,  9,  9,  0]);
  env('fM',   [18, 18, 18, 17, 16, 16]);
  env('fL',   [19, 20, 20, 24, 17, 17]);
  env('hD',   [17, 17, 17,  9, 16,  0]);
  env('hM',   [18, 18, 18, 17, 17, 16]);
  env('hL',   [19, 20, 20, 24, 18, 17]);
  env('gD',   [18, 18, 18, 17, 16, 16]);
  env('gM',   [19, 19, 19, 18, 17, 17]);
  env('gL',   [20, 20, 20, 24, 18,  3]);
  env('dD',   [22, 22, 22, 21, 21,  0]);
  env('dM',   [23, 23, 23, 22, 22, 21]);
  env('dL',   [24, 24, 24, 23, 23, 22]);
  env('flw',  [ 8,  8, 15, 14, 11,  3]);
  env('rvB',  [ 5,  5,  5, 10,  2,  1]);
  env('rvD',  [ 4,  4,  4,  9,  1,  0]);
  env('rvG',  [ 8,  8, 15, 15, 11,  6]);
  var WAT = [[4, 4, 4, 10, 2, 1], [5, 5, 5, 11, 3, 2], [6, 6, 15, 10, 10, 2], [8, 8, 8, 12, 11, 30]];
  for (var wi = 0; wi < 4; wi++) env('w' + wi, WAT[wi]);
  var WS = [E.w0, E.w1, E.w2, E.w3];
  for (var ki = 0; ki < 4; ki++) env('st' + ki, [8, 8, 8, 8, 8, 8]);
  var STS = [E.st0, E.st1, E.st2, E.st3];
  var STAR_SEQ = [8, 31, 29, 31];

  var BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bay(x, y) { return (BAY[(y & 3) * 4 + (x & 3)] + 0.5) / 16; }
  function hash(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function makeLUT(stageName, f) {
    var sIdx = STAGE_INDEX[stageName];
    if (sIdx === undefined) sIdx = 0;
    var lut = new Uint8Array(NSLOT);
    for (var s = 0; s < NSLOT; s++) lut[s] = SM[s][sIdx];
    var ph = Math.floor(f / 3);
    for (var k = 0; k < 4; k++) lut[WS[k]] = SM[WS[(k - ph) & 3]][sIdx];
    var sp = Math.floor(f / 4);
    for (var j = 0; j < 4; j++) lut[STS[j]] = STAR_SEQ[(j + sp) & 3];
    return lut;
  }

  // Sprite legend & helpers
  var LEG = {
    k: M(0), w: M(8), r: M(27), R: M(26), o: M(12), s: M(28), S: M(25),
    b: M(4), B: M(3), y: M(14), Y: M(13), u: M(15), l: M(23), L: M(22),
    e: M(21), t: M(24), p: M(11), P: M(10), g: M(19), G: M(18), q: M(20),
    c: M(5), v: M(6), z: M(7), C: M(3), n: M(2), m: M(9), i: M(29),
    I: M(30), h: M(31), x: M(1)
  };

  function spr(rows) {
    var h = rows.length;
    var w = 0;
    for (var i = 0; i < h; i++) if (rows[i].length > w) w = rows[i].length;
    var d = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var r = rows[y];
      for (var x = 0; x < r.length; x++) {
        var c = LEG[r[x]];
        if (c) d[y * w + x] = c;
      }
    }
    return { w: w, h: h, d: d };
  }

  function outline(s, col) {
    col = col || M(0);
    var w = s.w + 2, h = s.h + 2;
    var d = new Uint8Array(w * h);
    for (var y = 0; y < s.h; y++) {
      for (var x = 0; x < s.w; x++) {
        if (s.d[y * s.w + x]) d[(y + 1) * w + x + 1] = s.d[y * s.w + x];
      }
    }
    var o = d.slice();
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        if (!d[yy * w + xx]) {
          if ((xx > 0 && d[yy * w + xx - 1]) || (xx < w - 1 && d[yy * w + xx + 1]) ||
              (yy > 0 && d[(yy - 1) * w + xx]) || (yy < h - 1 && d[(yy + 1) * w + xx])) {
            o[yy * w + xx] = col;
          }
        }
      }
    }
    return { w: w, h: h, d: o };
  }

  function O(rows) { return outline(spr(rows)); }

  // Detailed Hero Adventurer (red hood, animated run/jump/cheer/item-get)
  var HEAD = spr([
    '...rrrrr...',
    '.rrrorrrrr.',
    'rrrorrrrrrr',
    'rrrrrRRRRrr',
    'rRrrRssssRr',
    'rRrRsssskss',
    'RRrRsssskss',
    '.RRRSssssS.',
    '..RRRSSSS..'
  ]);
  var RUN_POSES = [
    { bob: 0, bf: [-3, 3], ff: [3, 4], bh: [3, 1], fh: [-2, 2] },
    { bob: 1, bf: [-3, 2], ff: [1, 4], bh: [2, 2], fh: [-1, 3] },
    { bob: 0, bf: [0, 2], ff: [-1, 4], bh: [0, 3], fh: [1, 3] },
    { bob: 0, bf: [3, 4], ff: [-3, 3], bh: [-2, 2], fh: [3, 1] },
    { bob: 1, bf: [1, 4], ff: [-3, 2], bh: [-1, 3], fh: [2, 2] },
    { bob: 0, bf: [-1, 4], ff: [0, 2], bh: [1, 3], fh: [0, 3] }
  ];
  var STATIC_POSES = {
    jump:  { bob: 0, bf: [-2, 2], ff: [2, 3], bh: [-3, -1], fh: [3, -3], tail: 'up' },
    cheer: { bob: 0, bf: [-2, 4], ff: [2, 4], bh: [-5, -5], fh: [5, -5], tail: 'hang' },
    get:   { bob: 0, bf: [-2, 4], ff: [2, 4], bh: [-2, -10], fh: [2, -10], tail: 'hang', lit: 1 },
    idle:  { bob: 0, bf: [-1, 4], ff: [1, 4], bh: [0, 3], fh: [0, 3], tail: 'hang' }
  };

  function bresLine(x0, y0, x1, y1, fn) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
    for (;;) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }

  var heroCache = {};
  function getHeroSprite(action, f) {
    var poseIdx = action === 'run' ? (Math.floor(f / 3) % 6) : 0;
    var key = action + ':' + poseIdx;
    if (heroCache[key]) return heroCache[key];
    var p = action === 'run' ? RUN_POSES[poseIdx] : (STATIC_POSES[action] || STATIC_POSES.idle);
    var w = 26, h = 28, OX = 5, OY = 6;
    var d = new Uint8Array(w * h);
    function P(x, y, c) { x += OX; y += OY; if (x >= 0 && x < w && y >= 0 && y < h) d[y * w + x] = c; }
    var b = p.bob;
    // Flowing red hood tail
    var tailPts = p.tail === 'hang'
      ? [[3, 5], [2, 6], [2, 7], [1, 8], [1, 9]]
      : [[3, 4], [2, 4], [1, 5], [0, 5], [-1, 6], [-2, 6]];
    for (var ti = 0; ti < tailPts.length; ti++) {
      P(tailPts[ti][0], tailPts[ti][1] + b, M(27));
      if (ti < 4) P(tailPts[ti][0], tailPts[ti][1] + 1 + b, M(26));
    }
    // Back arm
    bresLine(5, 12 + b, 6 + p.bh[0], 12 + b + p.bh[1], function (x, y) { P(x, y, p.lit ? M(5) : M(3)); });
    // Back leg
    var bfx = 6 + p.bf[0], bfy = 15 + p.bf[1];
    bresLine(6, 15 + b, bfx, bfy - 1, function (x, y) { P(x, y, M(22)); P(x + 1, y, M(22)); });
    P(bfx, bfy, M(21)); P(bfx + 1, bfy, M(21)); P(bfx + 2, bfy, M(21));
    // Tunic torso
    var T = ['bbbbbb', 'Bbbbbb', 'yyyuyy', 'BbbbbB'];
    for (var tj = 0; tj < T.length; tj++) {
      for (var tii = 0; tii < 6; tii++) P(5 + tii, 11 + b + tj, LEG[T[tj][tii]]);
    }
    // Front leg
    var ffx = 8 + p.ff[0], ffy = 15 + p.ff[1];
    bresLine(8, 15 + b, ffx, ffy - 1, function (x, y) { P(x, y, M(23)); P(x + 1, y, M(23)); });
    P(ffx, ffy, M(22)); P(ffx + 1, ffy, M(22)); P(ffx + 2, ffy, M(22));
    // Head
    for (var hj = 0; hj < HEAD.h; hj++) {
      for (var hi = 0; hi < HEAD.w; hi++) {
        var hc = HEAD.d[hj * HEAD.w + hi];
        if (hc) P(3 + hi, 2 + b + hj, hc);
      }
    }
    // Front arm
    bresLine(10, 12 + b, 9 + p.fh[0], 12 + b + p.fh[1], function (x, y) { P(x, y, p.lit ? M(6) : M(5)); P(x + 1, y, M(4)); });
    var out = outline({ w: w, h: h, d: d });
    heroCache[key] = out;
    return out;
  }

  var COIN = [
    O(['.yyyy.', 'uyyyyY', 'uyYYyY', 'uyYYyY', 'uyYYyY', 'uyYYyY', 'uyyyYY', '.YYYY.']),
    O(['.yy.', 'uyyY', 'uyYY', 'uyYY', 'uyYY', 'uyYY', 'uyyY', '.YY.']),
    O(['uY', 'uY', 'uY', 'uY', 'uY', 'uY', 'uY', 'uY']),
    O(['.yy.', 'Yyyu', 'YYyu', 'YYyu', 'YYyu', 'YYyu', 'Yyyu', '.YY.'])
  ];
  var SLIME_A = O([
    '....pppp....',
    '..pppppppp..',
    '.pwwpppppppP',
    '.pwppkppkppP',
    'pppppkppkpPP',
    'ppppppppppPP',
    'PpppppppppPP',
    '.PPPPPPPPPP.'
  ]);
  var SLIME_B = O([
    '...pppppp...',
    '.pwwppppppP.',
    'pwpppkppkppP',
    'pppppkppkpPP',
    'PpppppppppPP',
    '.PPPPPPPPPP.'
  ]);
  var CH_LID = ['.hIuuttttttttttIh.', 'ihuttttttttttttlhi', 'iItttttttttttllLIi', 'iILlllllllllllLLIi', 'iiiiiiiuyyYiiiiiii'];
  var CH_BODY = [
    'iItttttyykYtttttIi', 'ihlllllYYkYlllllhi', 'iIllllllllllllllIi', 'iILLLLLLLLLLLLLLIi',
    'iItlllllllllllllIi', 'ihllllllllllllllhi', 'iIlllllllllllllLIi', 'iILLLLLLLLLLLLLLIi',
    'iieeeeeeeeeeeeeeii'
  ];
  var CHEST_CLOSED = O(CH_LID.concat(CH_BODY));
  var CHEST_OPEN = O([
    '...iILLLLLLLLIi...', '..iIeLLLLLLLLeIi..', '..ihLLLLLLLLLLhi..', '.iIeeeeeeeeeeeeIi.',
    'iIuwwwwwwwwwwwwuIi', 'iIyuywyyuyywyuyyIi', 'iIYyYYyYYyYYyYyYIi'
  ].concat(CH_BODY));
  var ORB = O([
    '..zzvvc..', '.zwwzvvc.', 'zwwwzvvcc', 'zwwzvvvcc',
    'zzvvvvccb', 'vvvvvccbb', 'vvvvccbbC', '.vvccbCC.', '..cbbCC..'
  ]);
  var SPARK = [
    spr(['.u.', 'uwu', '.u.']),
    spr(['..w..', '..u..', 'wuwuw', '..u..', '..w..']),
    spr(['...w...', '...u...', '...u...', 'wuuwuuw', '...u...', '...u...', '...w...'])
  ];

  // Crisp 5x7 pixel bitmap font for extruded titles & pixel HUD
  var FONT5 = {
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    'B': ['11110','10001','10001','11110','10001','10001','11110'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
    'D': ['11110','10001','10001','10001','10001','10001','11110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'G': ['01110','10001','10000','10111','10001','10001','01110'],
    'H': ['10001','10001','10001','11111','10001','10001','10001'],
    'I': ['11111','00100','00100','00100','00100','00100','11111'],
    'J': ['00111','00010','00010','00010','10010','10010','01100'],
    'K': ['10001','10010','10100','11000','10100','10010','10001'],
    'L': ['10000','10000','10000','10000','10000','10000','11111'],
    'M': ['10001','11011','10101','10101','10001','10001','10001'],
    'N': ['10001','11001','10101','10011','10001','10001','10001'],
    'O': ['01110','10001','10001','10001','10001','10001','01110'],
    'P': ['11110','10001','10001','11110','10000','10000','10000'],
    'Q': ['01110','10001','10001','10001','10101','10010','01101'],
    'R': ['11110','10001','10001','11110','10100','10010','10001'],
    'S': ['01111','10000','10000','01110','00001','00001','11110'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'V': ['10001','10001','10001','10001','10001','01010','00100'],
    'W': ['10001','10001','10001','10101','10101','11011','10001'],
    'X': ['10001','10001','01010','00100','01010','10001','10001'],
    'Y': ['10001','10001','01010','00100','00100','00100','00100'],
    'Z': ['11111','00001','00010','00100','01000','10000','11111'],
    '0': ['01110','10011','10101','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00110','01000','10000','11111'],
    '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['01110','10000','11110','10001','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00001','01110'],
    '!': ['00100','00100','00100','00100','00100','00000','00100'],
    '+': ['00000','00100','00100','11111','00100','00100','00000'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
    ':': ['00000','00100','00100','00000','00100','00100','00000'],
    '.': ['00000','00000','00000','00000','00000','01100','01100'],
    ',': ['00000','00000','00000','00000','00000','00100','01000'],
    '%': ['11001','11010','00100','01000','10110','00110','00000'],
    '/': ['00001','00010','00100','01000','10000','00000','00000'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000']
  };

  function createPixelBuffer(W, H) {
    var IB = new Uint8Array(W * H);

    function px(x, y, c) {
      var ix = x | 0, iy = y | 0;
      if (ix >= 0 && ix < W && iy >= 0 && iy < H) IB[iy * W + ix] = c;
    }

    function rect(x, y, w, h, c) {
      var x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
      var x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
      for (var j = y0; j < y1; j++) {
        var row = j * W;
        for (var i = x0; i < x1; i++) IB[row + i] = c;
      }
    }

    function blit(s, x, y, flip) {
      var bx = x | 0, by = y | 0;
      for (var j = 0; j < s.h; j++) {
        var yy = by + j;
        if (yy < 0 || yy >= H) continue;
        for (var i = 0; i < s.w; i++) {
          var c = s.d[j * s.w + (flip ? s.w - 1 - i : i)];
          if (!c) continue;
          var xx = bx + i;
          if (xx < 0 || xx >= W) continue;
          IB[yy * W + xx] = c;
        }
      }
    }

    function drawSmallText(str, x, y, col, sh, scale) {
      scale = scale || 1;
      var s = String(str || '').toUpperCase();
      var cx = x | 0;
      for (var ci = 0; ci < s.length; ci++) {
        var g = FONT5[s[ci]] || FONT5[' '];
        for (var r = 0; r < 7; r++) {
          for (var c = 0; c < 5; c++) {
            if (g[r][c] === '1') {
              if (sh) rect(cx + c * scale + 1, y + r * scale + 1, scale, scale, sh);
              rect(cx + c * scale, y + r * scale, scale, scale, col);
            }
          }
        }
        cx += 6 * scale;
      }
      return cx - x;
    }

    // Chunky 3D-extruded golden pixel logo with top bevel, dithered gold->orange ramp, 3D drop & 1px black outline
    function drawExtrudedTitle(lines, centerX, topY, cell, shinePos) {
      var ext = Math.max(2, Math.floor(cell));
      var lineGap = cell + 3;
      for (var li = 0; li < lines.length; li++) {
        var word = String(lines[li] || '').toUpperCase().trim();
        if (!word) continue;
        var lw = word.length * 6 * cell - cell;
        var ox = Math.round(centerX - lw * 0.5);
        var oy = Math.round(topY + li * (7 * cell + ext + lineGap));

        // Build mask for this line
        var mw = lw + 2, mh = 7 * cell + ext + 2;
        var mask = new Uint8Array(mw * mh);
        var rowY = new Int16Array(mw * mh);
        for (var ci = 0; ci < word.length; ci++) {
          var g = FONT5[word[ci]] || FONT5[' '];
          var gx = 1 + ci * 6 * cell;
          for (var r = 0; r < 7; r++) {
            for (var c = 0; c < 5; c++) {
              if (g[r][c] !== '1') continue;
              for (var yy = 0; yy < cell; yy++) {
                for (var xx = 0; xx < cell; xx++) {
                  var p = (1 + r * cell + yy) * mw + (gx + c * cell + xx);
                  mask[p] = 1;
                  rowY[p] = r * cell + yy;
                }
              }
            }
          }
        }

        // Shade face + 3D extrusion + outline
        var out = new Uint8Array(mw * mh);
        var totalH = 7 * cell;
        for (var y = 0; y < mh; y++) {
          for (var x = 0; x < mw; x++) {
            if (!mask[y * mw + x]) continue;
            var frac = rowY[y * mw + x] / totalH;
            var col;
            if (frac < 0.12) col = M(15);
            else if (frac < 0.42) col = M(14);
            else if (frac < 0.56) col = ((x + y) & 1) ? M(14) : M(13);
            else if (frac < 0.80) col = M(13);
            else col = ((x + y) & 1) ? M(13) : M(12);
            // Diagonal shine sweep
            if (shinePos !== null && Math.abs((x + y * 0.6) - shinePos * mw) < cell * 1.4) {
              col = M(8);
            }
            if (y > 0 && !mask[(y - 1) * mw + x]) col = M(15);
            out[y * mw + x] = col;
          }
        }
        // 3D extrusion below
        for (var y2 = mh - 1; y2 >= 0; y2--) {
          for (var x2 = 0; x2 < mw; x2++) {
            if (!mask[y2 * mw + x2]) continue;
            for (var d = 1; d <= ext; d++) {
              var yy2 = y2 + d;
              if (yy2 < mh && !mask[yy2 * mw + x2] && !out[yy2 * mw + x2]) {
                out[yy2 * mw + x2] = d < ext ? M(26) : M(9);
              }
            }
          }
        }
        // 1px black outline & blit
        for (var y3 = 0; y3 < mh; y3++) {
          for (var x3 = 0; x3 < mw; x3++) {
            var c3 = out[y3 * mw + x3];
            if (!c3) {
              if ((x3 > 0 && out[y3 * mw + x3 - 1]) || (x3 < mw - 1 && out[y3 * mw + x3 + 1]) ||
                  (y3 > 0 && out[(y3 - 1) * mw + x3]) || (y3 < mh - 1 && out[(y3 + 1) * mw + x3])) {
                c3 = M(0);
              }
            }
            if (c3) px(ox + x3 - 1, oy + y3 - 1, c3);
          }
        }
      }
    }

    // Full parallax SNES side-scroller world (Bayer dithered sky, sun, clouds, snow mountains, waterfall cliff, pine forest, bushes, brick ground & bridge)
    function drawWorld(stageName, camX, f, opts) {
      opts = opts || {};
      var groundY = Math.round(H * (H > W ? 0.72 : 0.83));
      var skyStops = [E.s0, E.s1, E.s2, E.s3, E.s4];

      // 1. Bayer 4x4 dithered sky gradient
      for (var y = 0; y < groundY; y++) {
        var u = (y / groundY) * (skyStops.length - 1);
        var idx = Math.min(skyStops.length - 2, Math.floor(u));
        var frac = u - idx;
        var row = y * W;
        for (var x = 0; x < W; x++) {
          IB[row + x] = frac > bay(x, y) ? skyStops[idx + 1] : skyStops[idx];
        }
      }

      // 2. Twinkling stars for dusk/night
      if (stageName === 'dusk' || stageName === 'night') {
        for (var si2 = 0; si2 < 42; si2++) {
          var sx = Math.floor(hash(si2, 11) * W);
          var sy = Math.floor(hash(si2, 29) * (groundY * 0.62));
          px(sx, sy, STS[si2 & 3]);
        }
      }

      // 3. Bayer-dithered glowing sun
      if (stageName !== 'night') {
        var sunX = Math.round(W * 0.76 - (camX * 0.04));
        var sunY = Math.round(groundY * (stageName === 'sunset' || stageName === 'dusk' ? 0.54 : 0.28));
        var sunR = Math.round(Math.min(W, H) * 0.075);
        for (var dy = -sunR * 2; dy <= sunR * 2; dy++) {
          for (var dx = -sunR * 2; dx <= sunR * 2; dx++) {
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < sunR) px(sunX + dx, sunY + dy, E.sun);
            else if (dist < sunR * 1.9) {
              var gfrac = 1 - (dist - sunR) / (sunR * 0.9);
              if (gfrac > bay(sunX + dx, sunY + dy)) px(sunX + dx, sunY + dy, E.sunG);
            }
          }
        }
      }

      // 4. Fluffy layered pixel clouds
      var clouds = [
        { x: 34, y: Math.round(groundY * 0.16), w: 34, h: 10 },
        { x: 118, y: Math.round(groundY * 0.28), w: 28, h: 8 },
        { x: 210, y: Math.round(groundY * 0.18), w: 38, h: 10 },
        { x: 292, y: Math.round(groundY * 0.30), w: 26, h: 8 }
      ];
      for (var ci = 0; ci < clouds.length; ci++) {
        var cl = clouds[ci];
        var cx = ((cl.x - Math.floor(camX * 0.08)) % (W + 60) + (W + 60)) % (W + 60) - 30;
        for (var cy2 = 0; cy2 < cl.h; cy2++) {
          var span = Math.round(cl.w * Math.sin(((cy2 + 1) / (cl.h + 1)) * Math.PI));
          var col = cy2 >= cl.h - 2 ? E.clD : E.clL;
          rect(cx - (span >> 1), cl.y + cy2, span, 1, col);
        }
      }

      // 5. Far snow-capped triangular mountains (parallax x0.18)
      var mtOff = Math.floor(camX * 0.18);
      var peakW = 54;
      for (var mx = 0; mx < W; mx++) {
        var wx = mx + mtOff;
        var cellIdx = Math.floor(wx / peakW);
        var localX = ((wx % peakW) + peakW) % peakW;
        var peakH = Math.round(groundY * (0.34 + 0.14 * hash(cellIdx, 7)));
        var half = peakW * 0.5;
        var distFromPeak = Math.abs(localX - half);
        var topY = groundY - Math.round(peakH * (1 - distFromPeak / half)) - 14;
        for (var my = Math.max(0, topY); my < groundY; my++) {
          var depth = my - topY;
          var isSnow = depth < Math.round(peakH * 0.24) + ((wx & 3) === 0 ? 1 : 0);
          var isLit = localX < half;
          px(mx, my, isSnow ? E.mS : (isLit ? E.mL : E.mD));
        }
      }

      // 6. Midground pine tree forest silhouette (parallax x0.42)
      var fOff = Math.floor(camX * 0.42);
      for (var fx = 0; fx < W; fx++) {
        var wfx = fx + fOff;
        var treeStep = 14;
        var tIdx = Math.floor(wfx / treeStep);
        var tx = ((wfx % treeStep) + treeStep) % treeStep;
        var tH = 26 + Math.floor(hash(tIdx, 19) * 18);
        var dCenter = Math.abs(tx - 7);
        var canopyTop = groundY - tH + dCenter * 2 + (dCenter > 0 ? (tx & 1) : 0);
        for (var fy = Math.max(0, canopyTop); fy < groundY; fy++) {
          var fDepth = fy - canopyTop;
          var fCol = fDepth < 5 ? E.fL : (fDepth < 14 ? E.fM : E.fD);
          if (fDepth >= 5 && ((wfx + fy) % 5 === 0)) fCol = E.fL;
          px(fx, fy, fCol);
        }
      }

      // 7. Stone waterfall cliff tower (world-anchored, parallax x0.65)
      if (opts.waterfall !== false) {
        var wfW = 36, wfH = Math.round(groundY * 0.40);
        var wfX = Math.round(W * 0.36 - Math.floor(camX * 0.55) % 80);
        var wfY = groundY - wfH;
        // Stone cliff blocks
        for (var wy = wfY; wy < groundY; wy++) {
          for (var wx2 = wfX; wx2 < wfX + wfW; wx2++) {
            var relX = wx2 - wfX;
            var isWater = relX >= 12 && relX < 24;
            if (isWater) {
              var wfIdx = (Math.floor((wy - f * 1.4) / 3) + (relX & 1)) & 3;
              px(wx2, wy, WS[wfIdx]);
            } else {
              var brickRow = Math.floor((wy - wfY) / 5);
              var brickCol = ((wx2 + (brickRow & 1) * 4) % 8 === 0) || ((wy - wfY) % 5 === 0);
              var cStone = relX < 5 ? E.rL : (relX > wfW - 6 ? E.rD : E.rM);
              px(wx2, wy, brickCol ? E.rD : cStone);
            }
          }
        }
        // Grass cap on top of cliff
        rect(wfX - 1, wfY - 2, wfW + 2, 3, E.gL);
        rect(wfX, wfY + 1, wfW, 2, E.gM);
      }

      // 8. Foreground rolling bushes + wildflowers (parallax x0.80)
      var bOff = Math.floor(camX * 0.80);
      for (var bx = 0; bx < W; bx++) {
        var wbx = bx + bOff;
        var bArch = Math.round(Math.abs(Math.sin(wbx * 0.11)) * 9) + 4;
        for (var by = groundY - bArch; by < groundY; by++) {
          var bd = by - (groundY - bArch);
          px(bx, by, bd < 2 ? E.hL : (bd < 6 ? E.hM : E.hD));
        }
        if ((wbx % 19) === 3) px(bx, groundY - 3, E.flw);
      }

      // 9. Ground layer: lush grass strip + textured brick earth + optional wooden bridge over river
      var riverStart = opts.bridge ? Math.round(W * 0.62) : W + 100;
      var riverEnd = opts.bridge ? Math.round(W * 0.94) : W + 100;
      var gOff = Math.floor(camX);
      for (var gx = 0; gx < W; gx++) {
        var inRiver = gx >= riverStart && gx < riverEnd;
        if (inRiver) {
          // Animated shimmering river water
          for (var ry = groundY + 4; ry < H; ry++) {
            var wave = ((gx + Math.floor(f * 0.7) + ry * 3) % 13) < 2;
            var rCol = ry < groundY + 7 ? WS[(gx + f) & 3] : (wave ? E.rvG : ((ry & 3) === 0 ? E.rvD : E.rvB));
            px(gx, ry, rCol);
          }
          // Wooden bridge deck & posts
          rect(gx, groundY - 1, 1, 4, (gx % 6 === 0) ? M(21) : M(23));
          px(gx, groundY - 1, M(24));
          if ((gx - riverStart) % 14 === 2) {
            rect(gx, groundY - 7, 2, 7, M(22));
            px(gx, groundY - 7, M(24));
          }
          px(gx, groundY - 5, M(23));
        } else {
          // Grass top strip
          px(gx, groundY, E.gL);
          px(gx, groundY + 1, E.gM);
          px(gx, groundY + 2, E.gM);
          px(gx, groundY + 3, ((gx + gOff) & 3) === 0 ? E.gM : E.gD);
          // Brick dirt earth
          for (var dy2 = groundY + 4; dy2 < H; dy2++) {
            var rowIdx = Math.floor((dy2 - groundY - 4) / 7);
            var bxOff = (gx + gOff + (rowIdx & 1) * 6) % 12;
            var isMortar = ((dy2 - groundY - 4) % 7 === 0) || (bxOff === 0);
            var isHi = ((dy2 - groundY - 4) % 7 === 1) && bxOff > 0;
            px(gx, dy2, isMortar ? E.dD : (isHi ? E.dL : E.dM));
          }
        }
      }

      return groundY;
    }

    function drawDialogueFrame(x, y, w, h) {
      rect(x + 2, y + 2, w, h, M(0));
      rect(x, y, w, h, M(8));
      rect(x + 1, y + 1, w - 2, h - 2, M(2));
      rect(x + 2, y + 2, w - 4, h - 4, M(0));
      // Corner rivets
      px(x + 3, y + 3, M(14));
      px(x + w - 4, y + 3, M(14));
      px(x + 3, y + h - 4, M(14));
      px(x + w - 4, y + h - 4, M(14));
    }

    function flushToCanvas(ctx, outW, outH, lut) {
      var off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      var octx = off.getContext('2d');
      var img = octx.createImageData(W, H);
      var data = img.data;
      for (var i = 0; i < IB.length; i++) {
        var rgb = MP[lut[IB[i]]];
        var p = i * 4;
        data[p] = rgb[0];
        data[p + 1] = rgb[1];
        data[p + 2] = rgb[2];
        data[p + 3] = 255;
      }
      octx.putImageData(img, 0, 0);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, outW, outH);

      // Subtle CRT scanlines + soft corner vignette (preserves razor-sharp pixel grid!)
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (var sy = 0; sy < outH; sy += 6) {
        ctx.fillRect(0, sy, outW, 2);
      }
      var vig = ctx.createRadialGradient(outW * 0.5, outH * 0.5, Math.min(outW, outH) * 0.36, outW * 0.5, outH * 0.5, Math.max(outW, outH) * 0.72);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, outW, outH);
      ctx.restore();
    }

    return {
      W: W,
      H: H,
      px: px,
      rect: rect,
      blit: blit,
      drawSmallText: drawSmallText,
      drawExtrudedTitle: drawExtrudedTitle,
      drawWorld: drawWorld,
      drawDialogueFrame: drawDialogueFrame,
      flushToCanvas: flushToCanvas
    };
  }

  window.PixelKit = {
    M: M,
    E: E,
    makeLUT: makeLUT,
    getHeroSprite: getHeroSprite,
    COIN: COIN,
    SLIME_A: SLIME_A,
    SLIME_B: SLIME_B,
    CHEST_CLOSED: CHEST_CLOSED,
    CHEST_OPEN: CHEST_OPEN,
    ORB: ORB,
    SPARK: SPARK,
    createPixelBuffer: createPixelBuffer
  };
})();
