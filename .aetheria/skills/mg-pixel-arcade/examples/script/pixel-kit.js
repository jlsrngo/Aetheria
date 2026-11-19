(function () {
  'use strict';

  var THEMES = {
    'pico8-night': {
      skyTop: '#1D2B53',
      skyBot: '#29366F',
      panel: '#0B1020',
      border: '#FFF1E8',
      ink: '#FFF1E8',
      muted: '#C2C3C7',
      gold: '#FFEC27',
      red: '#FF004D',
      cyan: '#29ADFF',
      green: '#00E436'
    },
    'gameboy-dmg': {
      skyTop: '#9BBC0F',
      skyBot: '#8BAC0F',
      panel: '#0F380F',
      border: '#9BBC0F',
      ink: '#9BBC0F',
      muted: '#8BAC0F',
      gold: '#9BBC0F',
      red: '#306230',
      cyan: '#8BAC0F',
      green: '#9BBC0F'
    },
    'snes-sunset': {
      skyTop: '#3B1D5E',
      skyBot: '#B83B5E',
      panel: '#180B29',
      border: '#FFE8D6',
      ink: '#FFF8F0',
      muted: '#F0B7A4',
      gold: '#FFD166',
      red: '#EF476F',
      cyan: '#06D6A0',
      green: '#06D6A0'
    },
    'arcade-crt': {
      skyTop: '#0D0D1A',
      skyBot: '#1A1A36',
      panel: '#06060E',
      border: '#00F5D4',
      ink: '#F8FAFC',
      muted: '#94A3B8',
      gold: '#FEE440',
      red: '#F15BB5',
      cyan: '#00BBF9',
      green: '#00F5D4'
    },
    'cyber-bit': {
      skyTop: '#081C24',
      skyBot: '#133C4D',
      panel: '#040F14',
      border: '#38BDF8',
      ink: '#E0F2FE',
      muted: '#7DD3FC',
      gold: '#FACC15',
      red: '#FB7185',
      cyan: '#38BDF8',
      green: '#4ADE80'
    }
  };

  var SPRITES = {
    'hero-knight': [
      '..RRRR..',
      '.RRRRRR.',
      '.CCWWCC.',
      '.CCCCCC.',
      '..BBBB..',
      '.BGGGG.B',
      '..B..B..',
      '.BB..BB.'
    ],
    'coin-spin': [
      '..GGGG..',
      '.GWWWWG.',
      'GGWGGWGG',
      'GGWGGWGG',
      'GGWGGWGG',
      'GGWGGWGG',
      '.GGGGGG.',
      '..GGGG..'
    ],
    'slime-bounce': [
      '........',
      '..CCCC..',
      '.CCCCCC.',
      'CCWCCWCC',
      'CCBCCCBC',
      'CCCCCCCC',
      'CCCCCCCC',
      '.CCCCCC.'
    ],
    'treasure-chest': [
      '.GGGGGG.',
      'GRRRRRRG',
      'GGGGGGGG',
      'GRRWWWRG',
      'GRRRRRRG',
      'GRRRRRRG',
      'GGGGGGGG',
      '........'
    ],
    'heart-pixel': [
      '.RR..RR.',
      'RRRRRRRR',
      'RRWRRRRR',
      'RRRRRRRR',
      '.RRRRRR.',
      '..RRRR..',
      '...RR...',
      '........'
    ],
    'rocket-8bit': [
      '...WW...',
      '..WWWW..',
      '..WCCW..',
      '.WWWWWW.',
      '.WRWWRW.',
      'RRWWWWWR',
      'R.GGGG.R',
      '..G..G..'
    ]
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['pico8-night'];
  }

  function drawArcadeBackdrop(ctx, w, h, theme, t) {
    // Stepped pixel-banded sky (no smooth blur)
    var bands = 8;
    var bandH = Math.ceil(h / bands);
    for (var i = 0; i < bands; i++) {
      ctx.fillStyle = i % 2 === 0 ? theme.skyTop : theme.skyBot;
      ctx.fillRect(0, i * bandH, w, bandH);
    }

    // Parallax pixel stars moving in integer steps
    var stepX = Math.floor(t * 10) * 8;
    ctx.fillStyle = theme.ink;
    for (var s = 0; s < 28; s++) {
      var sx = ((s * 173 + stepX) % w);
      var sy = (s * 97) % (h - 200);
      ctx.fillRect(Math.floor(sx / 8) * 8, Math.floor(sy / 8) * 8, 8, 8);
    }

    // Ground pixel brick strip at bottom
    var gy = h - 96;
    ctx.fillStyle = theme.panel;
    ctx.fillRect(0, gy, w, 96);
    ctx.fillStyle = theme.border;
    ctx.fillRect(0, gy, w, 8);
  }

  function drawScanlines(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    for (var y = 0; y < h; y += 6) {
      ctx.fillRect(0, y, w, 2);
    }
    ctx.restore();
  }

  function drawPixelBox(ctx, x, y, w, h, theme) {
    var px = Math.round(x / 8) * 8;
    var py = Math.round(y / 8) * 8;
    var pw = Math.round(w / 8) * 8;
    var ph = Math.round(h / 8) * 8;
    ctx.save();
    // Hard 8-bit drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(px + 12, py + 12, pw, ph);
    // Outer pixel border
    ctx.fillStyle = theme.border;
    ctx.fillRect(px, py, pw, ph);
    // Inner dark panel
    ctx.fillStyle = theme.panel;
    ctx.fillRect(px + 8, py + 8, pw - 16, ph - 16);
    // Inner accent trim
    ctx.strokeStyle = theme.cyan;
    ctx.lineWidth = 4;
    ctx.strokeRect(px + 16, py + 16, pw - 32, ph - 32);
    ctx.restore();
  }

  function drawPixelSprite(ctx, name, cx, cy, size, theme, t) {
    var grid = SPRITES[name] || SPRITES['hero-knight'];
    var pxSize = Math.max(8, Math.floor(size / 8));
    var total = pxSize * 8;
    var bounceY = (Math.floor(t * 6) % 2 === 0) ? 0 : -pxSize;
    var sx = Math.round((cx - total * 0.5) / 4) * 4;
    var sy = Math.round((cy - total * 0.5 + bounceY) / 4) * 4;

    var cmap = {
      'R': theme.red,
      'G': theme.gold,
      'C': theme.cyan,
      'W': theme.ink,
      'B': theme.border
    };

    ctx.save();
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = cmap[ch] || theme.ink;
        ctx.fillRect(sx + c * pxSize, sy + r * pxSize, pxSize, pxSize);
      }
    }
    ctx.restore();
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    if (!text) return [];
    var words = String(text).split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  }

  window.PixelKit = {
    getTheme: getTheme,
    drawArcadeBackdrop: drawArcadeBackdrop,
    drawScanlines: drawScanlines,
    drawPixelBox: drawPixelBox,
    drawPixelSprite: drawPixelSprite,
    wrapLines: wrapLines
  };
})();
