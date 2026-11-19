(function () {
  'use strict';

  var THEMES = {
    'outrun-1986': {
      skyTop: '#060112',
      skyMid: '#1C0538',
      skyBot: '#4E0B52',
      haze: '#FF3D8C',
      grid: '#FF29D1',
      wire: '#38E0FF',
      sunTop: '#FFF59E',
      sunMid: '#FF9E38',
      sunBot: '#FF2A7A',
      neonScript: '#FF4DD2',
      chromeSky: '#7DD3FC',
      chromeGround: '#FF2A9D',
      floorBase: '#090118'
    },
    'miami-vice': {
      skyTop: '#050C24',
      skyMid: '#152250',
      skyBot: '#4A1554',
      haze: '#FF4D94',
      grid: '#00F5D4',
      wire: '#FF4D94',
      sunTop: '#FFF380',
      sunMid: '#FF8A3D',
      sunBot: '#FF3385',
      neonScript: '#00F5D4',
      chromeSky: '#67E8F9',
      chromeGround: '#F43F5E',
      floorBase: '#060E20'
    },
    'laser-crimson': {
      skyTop: '#0E0109',
      skyMid: '#2D0418',
      skyBot: '#6B0C2B',
      haze: '#FF2A54',
      grid: '#FF2A54',
      wire: '#FFB703',
      sunTop: '#FFF7AE',
      sunMid: '#FF7B00',
      sunBot: '#E60039',
      neonScript: '#FFB703',
      chromeSky: '#FDE68A',
      chromeGround: '#E11D48',
      floorBase: '#12020A'
    },
    'midnight-chrome': {
      skyTop: '#030614',
      skyMid: '#0F183D',
      skyBot: '#2C1B5E',
      haze: '#818CF8',
      grid: '#38BDF8',
      wire: '#E879F9',
      sunTop: '#FEF08A',
      sunMid: '#F472B6',
      sunBot: '#8B5CF6',
      neonScript: '#38BDF8',
      chromeSky: '#BAE6FD',
      chromeGround: '#A855F7',
      floorBase: '#05081A'
    },
    'vapor-teal': {
      skyTop: '#04121C',
      skyMid: '#0E2E42',
      skyBot: '#3C1B4E',
      haze: '#2DD4BF',
      grid: '#2DD4BF',
      wire: '#F472B6',
      sunTop: '#FEF08A',
      sunMid: '#FB7185',
      sunBot: '#EC4899',
      neonScript: '#F472B6',
      chromeSky: '#99F6E4',
      chromeGround: '#EC4899',
      floorBase: '#05141E'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['outrun-1986'];
  }

  function hash(n) {
    var s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function drawStarfield(ctx, w, horizonY, t) {
    ctx.save();
    for (var i = 0; i < 95; i++) {
      var sx = hash(i * 3 + 1) * w;
      var sy = hash(i * 5 + 2) * horizonY * 0.86;
      var sz = hash(i * 7 + 3) > 0.88 ? 3.5 : 1.8;
      var tw = 0.55 + 0.45 * Math.sin(t * (2.5 + hash(i) * 4) + i * 7);
      ctx.globalAlpha = tw * (1 - sy / (horizonY * 0.95));
      ctx.fillStyle = '#F5EEFF';
      ctx.fillRect(sx, sy, sz, sz);
      if (sz > 3) {
        // 4-point star flare
        ctx.fillRect(sx - 5, sy + 1, 13, 1.2);
        ctx.fillRect(sx + 1, sy - 5, 1.2, 13);
      }
    }
    // Shooting star streak
    var shoot = (t * 0.45) % 3.5;
    if (shoot < 0.7) {
      var u = shoot / 0.7;
      var x1 = w * (0.18 + u * 0.28);
      var y1 = horizonY * (0.14 + u * 0.14);
      var grad = ctx.createLinearGradient(x1, y1, x1 - 120, y1 - 45);
      grad.addColorStop(0, 'rgba(200, 245, 255, 0.95)');
      grad.addColorStop(1, 'rgba(200, 245, 255, 0)');
      ctx.globalAlpha = Math.sin(u * Math.PI);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 120, y1 - 45);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOutrunSun(ctx, cx, cy, r, theme, t) {
    ctx.save();
    // Wide warm atmospheric halo behind sun
    var halo = ctx.createRadialGradient(cx, cy, r * 0.65, cx, cy, r * 2.4);
    halo.addColorStop(0, theme.haze + '88');
    halo.addColorStop(0.45, theme.haze + '28');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // Clip to sun disc and paint scrolling horizontal slit cutouts
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    var sg = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    sg.addColorStop(0, theme.sunTop);
    sg.addColorStop(0.45, theme.sunMid);
    sg.addColorStop(1, theme.sunBot);
    ctx.fillStyle = sg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // Scrolling Outrun horizontal cut-outs widening toward bottom
    var scroll = (t * 0.55) % 1;
    ctx.fillStyle = theme.skyBot;
    for (var i = 0; i < 8; i++) {
      var frac = (i + scroll) / 8;
      var sy = cy + r * (0.04 + frac * 0.96);
      var sh = Math.max(2, frac * frac * r * 0.16);
      ctx.fillRect(cx - r - 4, sy, r * 2 + 8, sh);
    }
    ctx.restore();
    ctx.restore();
  }

  function drawWireframeMountains(ctx, w, horizonY, theme, t) {
    ctx.save();
    // Left and right flanking faceted wireframe mountain ranges (leaving center open for sun!)
    function drawSide(dir) {
      var pts = [];
      var steps = 14;
      for (var i = 0; i <= steps; i++) {
        var u = i / steps;
        var x = dir < 0 ? u * w * 0.44 : w - u * w * 0.44;
        var edgeEnv = Math.sin(u * Math.PI);
        var ridge = (0.35 + 0.65 * hash(i * 11 + (dir < 0 ? 3 : 29))) * edgeEnv;
        var mh = ridge * Math.min(w, horizonY) * 0.30;
        pts.push([x, horizonY - mh]);
      }

      // Dark indigo solid silhouette
      ctx.beginPath();
      ctx.moveTo(dir < 0 ? 0 : w, horizonY);
      for (var j = 0; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.lineTo(dir < 0 ? w * 0.44 : w * 0.56, horizonY);
      ctx.closePath();
      ctx.fillStyle = '#0D0220';
      ctx.fill();

      // Glowing magenta-to-cyan wireframe facet lines
      ctx.strokeStyle = theme.wire;
      ctx.shadowColor = theme.wire;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Internal triangulated ridge facets
      ctx.shadowBlur = 0;
      ctx.strokeStyle = theme.grid + 'AA';
      ctx.lineWidth = 1.5;
      for (var k = 1; k < pts.length - 1; k++) {
        var baseX = pts[k][0] + dir * 24;
        ctx.beginPath();
        ctx.moveTo(pts[k][0], pts[k][1]);
        ctx.lineTo(baseX, horizonY);
        ctx.stroke();
      }
    }
    drawSide(-1);
    drawSide(1);
    ctx.restore();
  }

  function drawPerspectiveHighway(ctx, w, h, horizonY, theme, t, speedMult) {
    var floorH = h - horizonY;
    ctx.fillStyle = theme.floorBase;
    ctx.fillRect(0, horizonY, w, floorH);

    // Rippling vertical sun reflection streak down highway center
    ctx.save();
    for (var ry = 0; ry < floorH; ry += 5) {
      var u = ry / floorH;
      var rip = 0.45 + 0.55 * Math.sin(ry * 0.14 - t * 8);
      var rw = (18 + u * w * 0.20) * rip;
      ctx.globalAlpha = (1 - u * 0.78) * 0.42 * rip;
      ctx.fillStyle = theme.sunMid;
      ctx.fillRect(w * 0.5 - rw * 0.5, horizonY + ry, rw, 3.5);
    }
    ctx.restore();

    // Glowing perspective neon grid
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.shadowColor = theme.grid;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.4;

    var cycle = (t * 1.15 * (speedMult || 1)) % 1;
    var rows = 16;
    for (var r = 0; r < rows; r++) {
      var ru = (r + cycle) / rows;
      var py = horizonY + Math.pow(ru, 2.35) * floorH;
      ctx.globalAlpha = Math.min(1, 0.25 + ru * 0.85);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Radiating perspective lanes
    ctx.globalAlpha = 0.85;
    for (var c = -10; c <= 10; c++) {
      var topX = w * 0.5 + c * 22;
      var botX = w * 0.5 + c * (w * 0.16);
      ctx.beginPath();
      ctx.moveTo(topX, horizonY);
      ctx.lineTo(botX, h);
      ctx.stroke();
    }

    // Hot white-pink 3px horizon glow line
    ctx.shadowColor = theme.haze;
    ctx.shadowBlur = 24;
    ctx.strokeStyle = '#FFE4F7';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();
    ctx.restore();
  }

  function drawPalmSilhouette(ctx, baseX, baseY, height, leanDir, theme) {
    ctx.save();
    ctx.translate(baseX, baseY);
    var topX = leanDir * height * 0.22;
    var topY = -height;

    // Hot pink rim-lit pass slightly offset + dark silhouette pass
    var passes = [[leanDir * -4, theme.haze], [0, '#090118']];
    for (var p = 0; p < passes.length; p++) {
      var dx = passes[p][0];
      ctx.fillStyle = passes[p][1];
      ctx.strokeStyle = passes[p][1];
      ctx.lineCap = 'round';

      // Curved tapered trunk
      ctx.lineWidth = Math.max(8, height * 0.042);
      ctx.beginPath();
      ctx.moveTo(dx, 0);
      ctx.quadraticCurveTo(dx + topX * 0.35, -height * 0.5, dx + topX, topY);
      ctx.stroke();

      // 7 arching palm fronds
      for (var f = -3; f <= 3; f++) {
        var ang = -Math.PI * 0.5 + f * 0.42;
        var flen = height * (0.34 - Math.abs(f) * 0.025);
        var ex = dx + topX + Math.cos(ang) * flen * 1.4;
        var ey = topY + Math.sin(ang) * flen * 0.45 + Math.abs(f) * height * 0.06;
        ctx.lineWidth = Math.max(5, height * 0.026);
        ctx.beginPath();
        ctx.moveTo(dx + topX, topY);
        ctx.quadraticCurveTo(dx + topX + (ex - dx - topX) * 0.55, topY - height * 0.14, ex, ey);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawOutrunCar(ctx, cx, cy, scale, theme, t, boost) {
    ctx.save();
    ctx.translate(cx, cy + Math.sin(t * 14) * 1.8);
    ctx.scale(scale, scale);

    // Wet-road crimson tail-light reflection streaks below car
    var reflG = ctx.createLinearGradient(0, 26, 0, 145);
    reflG.addColorStop(0, 'rgba(255, 25, 65, ' + (boost ? '0.68' : '0.45') + ')');
    reflG.addColorStop(1, 'rgba(255, 25, 65, 0)');
    ctx.fillStyle = reflG;
    ctx.fillRect(-92, 26, 56, 120);
    ctx.fillRect(36, 26, 56, 120);

    // Contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    ctx.ellipse(0, 32, 132, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rear tires
    ctx.fillStyle = '#070210';
    ctx.fillRect(-118, 2, 34, 34);
    ctx.fillRect(84, 2, 34, 34);

    // Iconic 80s wedge body silhouette (Countach / DeLorean rear view)
    ctx.beginPath();
    ctx.moveTo(-124, 16);
    ctx.lineTo(-112, -22);
    ctx.lineTo(-68, -64);
    ctx.lineTo(68, -64);
    ctx.lineTo(112, -22);
    ctx.lineTo(124, 16);
    ctx.closePath();
    var bodyG = ctx.createLinearGradient(0, -64, 0, 18);
    bodyG.addColorStop(0, '#2B1654');
    bodyG.addColorStop(0.5, '#14082C');
    bodyG.addColorStop(1, '#080214');
    ctx.fillStyle = bodyG;
    ctx.fill();
    ctx.strokeStyle = theme.wire;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Rear window louvers
    ctx.strokeStyle = theme.haze + 'AA';
    ctx.lineWidth = 2;
    for (var l = 0; l < 4; l++) {
      var ly = -56 + l * 8;
      var lw = 56 + l * 6;
      ctx.beginPath(); ctx.moveTo(-lw, ly); ctx.lineTo(lw, ly); ctx.stroke();
    }

    // Glowing crimson full-width taillight bar!
    ctx.shadowColor = '#FF1744';
    ctx.shadowBlur = boost ? 32 : 20;
    ctx.fillStyle = '#FF1744';
    ctx.fillRect(-104, -14, 72, 14);
    ctx.fillRect(32, -14, 72, 14);
    ctx.fillStyle = '#FFE4EC';
    ctx.fillRect(-96, -10, 56, 5);
    ctx.fillRect(40, -10, 56, 5);
    ctx.shadowBlur = 0;

    // Center license plate glow
    ctx.fillStyle = theme.wire;
    ctx.fillRect(-24, -12, 48, 16);
    ctx.fillStyle = '#090218';
    ctx.font = '900 11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1986', 0, -4);

    ctx.restore();
  }

  function drawChromeHeadline(ctx, lines, cx, topY, fontSize, maxW, theme, t) {
    ctx.save();
    ctx.font = 'italic 900 ' + fontSize + 'px "Impact", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < lines.length; i++) {
      var txt = lines[i];
      var y = topY + i * (fontSize * 1.08);

      // Deep dark-violet 3D bevel drop shadow
      ctx.fillStyle = '#140328';
      ctx.fillText(txt, cx + 6, y + 8, maxW);

      // Authentic 80s multi-stop metallic chrome horizon reflection gradient!
      var g = ctx.createLinearGradient(cx, y - fontSize * 0.48, cx, y + fontSize * 0.48);
      g.addColorStop(0.00, '#FFFFFF');
      g.addColorStop(0.28, theme.chromeSky);
      g.addColorStop(0.47, '#0F172A');
      g.addColorStop(0.51, '#FFFFFF');
      g.addColorStop(0.68, theme.chromeGround);
      g.addColorStop(0.92, '#FDE68A');
      g.addColorStop(1.00, '#FFFFFF');

      ctx.shadowColor = theme.haze;
      ctx.shadowBlur = 24;
      ctx.fillStyle = g;
      ctx.fillText(txt, cx, y, maxW);

      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.strokeText(txt, cx, y, maxW);
    }

    // Sweeping 4-point star glint on top-left corner of title
    var glintX = cx + Math.sin(t * 1.8) * (maxW * 0.28);
    var glintY = topY - fontSize * 0.28;
    var glintR = 26 + Math.sin(t * 6) * 6;
    ctx.save();
    ctx.translate(glintX, glintY);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, -glintR); ctx.lineTo(4, -4); ctx.lineTo(glintR, 0); ctx.lineTo(4, 4);
    ctx.lineTo(0, glintR); ctx.lineTo(-4, 4); ctx.lineTo(-glintR, 0); ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function drawNeonScript(ctx, text, cx, cy, fontSize, maxW, theme) {
    ctx.save();
    ctx.font = 'italic 700 ' + fontSize + 'px "Brush Script MT", "Segoe Script", "Georgia", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Double neon tube glow (wide outer + tight hot core)
    ctx.shadowColor = theme.neonScript;
    ctx.shadowBlur = 30;
    ctx.fillStyle = theme.neonScript;
    ctx.fillText(text, cx, cy, maxW);
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#FFF0FA';
    ctx.fillText(text, cx, cy, maxW);
    ctx.restore();
  }

  function drawVhsOsd(ctx, safe, t) {
    ctx.save();
    ctx.font = '700 28px "Courier New", "Consolas", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#00FF88';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#E8FFF2';
    ctx.fillText('PLAY ▶', safe.x + 12, safe.y + 8);
    var sec = Math.floor(t);
    var frm = Math.floor((t - sec) * 30);
    var tc = 'SP 00:00:' + String(sec).padStart(2, '0') + ':' + String(frm).padStart(2, '0');
    ctx.textAlign = 'right';
    ctx.fillText(tc, safe.x + safe.w - 12, safe.y + 8);
    ctx.restore();
  }

  function wrapLines(text, maxChars) {
    var words = String(text || '').trim().split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (test.length <= maxChars || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= 2) break;
      }
    }
    if (cur && lines.length < 3) lines.push(cur);
    return lines;
  }

  window.SynthwaveKit = {
    getTheme: getTheme,
    drawStarfield: drawStarfield,
    drawOutrunSun: drawOutrunSun,
    drawWireframeMountains: drawWireframeMountains,
    drawPerspectiveHighway: drawPerspectiveHighway,
    drawPalmSilhouette: drawPalmSilhouette,
    drawOutrunCar: drawOutrunCar,
    drawChromeHeadline: drawChromeHeadline,
    drawNeonScript: drawNeonScript,
    drawVhsOsd: drawVhsOsd,
    wrapLines: wrapLines
  };
})();
