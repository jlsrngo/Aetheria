/**
 * IsometricKit v2 — Isopolis 2.5D Floating City Engine
 * Adapted from references/aetheria-motion/demos/03-isometric/ (world.js, main.js, ui.js).
 * Pure deterministic Canvas2D isometric projection, depth-sorted 12x12 city island, clay->pastel scanline ignition,
 * animated vehicles, blossom/mint trees, clouds, and City OS HUD. Zero external dependencies.
 */
(function () {
  'use strict';

  const PAL = {
    bgTop: '#EEEAFC', bgMid: '#DAD3F7', bgLow: '#C4BAEF', dot: '#A79EE2',
    grass: ['#94DFBD', '#8CDBB6', '#9DE3C4', '#86D6B0'],
    plaza: '#F4F1FD', plaza2: '#ECE8FB', road: '#8781D0', mark: '#FBFAFF', water: '#8CC6FF',
    clay: '#F1EEFA', clayLeft: '#E2DFF2', clayRight: '#D0D4EE', clayGrass: '#E6E2F2', clayRoad: '#CFCBE6', clayWater: '#DDE3F4',
    soil: ['#FFFFFF', '#CBC3F3', '#B2A8EC', '#9F95E1'],
    data: '#62F0F2', winOff: '#98ACEE', winOn: '#FFF0C8', ink: '#2C2960',
    buildings: ['#FBFAFF', '#FFC4AC', '#A8D2FF', '#D9D1FA', '#FFE6A1', '#FF9E86'],
    leaf: ['#7FD3A6', '#93DDB5', '#6CC79A', '#A9E6C4'], blossom: '#FFB9A3', trunk: '#C9A48F'
  };

  // Exact 12x12 city map from 03-isometric/js/world.js
  const MAP = [
    'o..t.f..t...',
    '.f.....f..ww',
    '..rrrrrrrrww',
    't.rbbbbbbrww',
    '..rbbppbbrw.',
    'f.rbpccpbr.f',
    '..rbpccpbr.h',
    'ssrbbppbbrh.',
    'ssrbbbbbbr.h',
    '..rrrrrrrrhf',
    'h.hfh.hfh..f',
    '.hfh.hfh.hf.'
  ];
  const N = 12;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

  function hs(a, b = 0, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mixHex(h1, h2, t) {
    if (t <= 0) return h1; if (t >= 1) return h2;
    const a = hexRgb(h1), b = hexRgb(h2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }
  function shadeHex(hex, factor) {
    const [r, g, b] = hexRgb(hex);
    return `rgb(${clamp(Math.round(r * factor), 0, 255)},${clamp(Math.round(g * factor), 0, 255)},${clamp(Math.round(b * factor), 0, 255)})`;
  }

  // Isometric projection: x right-down, z left-down, y up
  function iso(x, y, z, cx, cy, tileW, tileH) {
    return [
      cx + (x - z) * (tileW * 0.5),
      cy + (x + z) * (tileH * 0.5) - y * tileH
    ];
  }

  function drawPoly(ctx, pts, fill, stroke, lw = 1) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }

  function drawIsoBox(ctx, x, y, z, w, h, d, topCol, leftCol, rightCol, cx, cy, tw, th, edgeCol = null, edgeLw = 1.2) {
    const hw = w * 0.5, hd = d * 0.5;
    const p000 = iso(x - hw, y, z - hd, cx, cy, tw, th);
    const p100 = iso(x + hw, y, z - hd, cx, cy, tw, th);
    const p101 = iso(x + hw, y, z + hd, cx, cy, tw, th);
    const p001 = iso(x - hw, y, z + hd, cx, cy, tw, th);
    const p010 = iso(x - hw, y + h, z - hd, cx, cy, tw, th);
    const p110 = iso(x + hw, y + h, z - hd, cx, cy, tw, th);
    const p111 = iso(x + hw, y + h, z + hd, cx, cy, tw, th);
    const p011 = iso(x - hw, y + h, z + hd, cx, cy, tw, th);

    // Left face (+Z)
    drawPoly(ctx, [p001, p101, p111, p011], leftCol, edgeCol, edgeLw);
    // Right face (+X)
    drawPoly(ctx, [p100, p101, p111, p110], rightCol, edgeCol, edgeLw);
    // Top face (+Y)
    drawPoly(ctx, [p010, p110, p111, p011], topCol, edgeCol, edgeLw);
    void p000;
  }

  function drawBackground(ctx, W, H, u) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.bgTop);
    g.addColorStop(0.55, PAL.bgMid);
    g.addColorStop(1, PAL.bgLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Subtle isometric dot grid
    const sp = 42;
    ctx.fillStyle = PAL.dot;
    ctx.globalAlpha = 0.28;
    for (let y = 20; y < H; y += sp) {
      const ox = ((y / sp) | 0) % 2 ? sp * 0.5 : 0;
      for (let x = ox; x < W; x += sp) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Soft floating pastel clouds
    const clouds = [
      { x: W * 0.18 + u * 24, y: H * 0.19, s: 1.0 },
      { x: W * 0.82 - u * 18, y: H * 0.25, s: 0.78 }
    ];
    clouds.forEach((cl) => {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.arc(cl.x, cl.y, 38 * cl.s, 0, Math.PI * 2);
      ctx.arc(cl.x + 34 * cl.s, cl.y - 10 * cl.s, 28 * cl.s, 0, Math.PI * 2);
      ctx.arc(cl.x - 32 * cl.s, cl.y + 4 * cl.s, 24 * cl.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawIslandBase(ctx, cx, cy, tw, th) {
    // 4-layer stepped soil slab under the 12x12 city grid
    const layers = [
      { y: -0.22, h: 0.22, col: PAL.soil[0] },
      { y: -0.52, h: 0.30, col: PAL.soil[1] },
      { y: -0.88, h: 0.36, col: PAL.soil[2] },
      { y: -1.30, h: 0.42, col: PAL.soil[3] }
    ];
    for (let k = layers.length - 1; k >= 0; k--) {
      const L = layers[k];
      const shrink = k * 0.12;
      drawIsoBox(
        ctx,
        5.5, L.y, 5.5,
        N - shrink, L.h, N - shrink,
        L.col, shadeHex(L.col, 0.92), shadeHex(L.col, 0.84),
        cx, cy, tw, th
      );
    }
  }

  function drawWindows(ctx, x, z, h, w, d, colorMix, cx, cy, tw, th, seed) {
    if (h < 0.45) return;
    const rows = Math.max(1, Math.floor((h - 0.15) / 0.28));
    const winCol = colorMix > 0.5 ? PAL.winOn : PAL.winOff;
    ctx.save();
    for (let r = 0; r < rows; r++) {
      const wy = 0.18 + r * 0.26;
      for (let c = -1; c <= 1; c += 2) {
        const lit = hs(seed, r, c) > 0.35;
        ctx.fillStyle = lit ? winCol : PAL.winOff;
        ctx.globalAlpha = lit ? 0.92 : 0.45;
        // Left face windows
        const pL = iso(x + c * w * 0.22, wy, z + d * 0.5 + 0.01, cx, cy, tw, th);
        ctx.fillRect(pL[0] - 3, pL[1] - 4, 6, 8);
        // Right face windows
        const pR = iso(x + w * 0.5 + 0.01, wy, z + c * d * 0.22, cx, cy, tw, th);
        ctx.fillRect(pR[0] - 3, pR[1] - 4, 6, 8);
      }
    }
    ctx.restore();
  }

  function drawTree(ctx, x, z, isBlossom, grow, colorMix, cx, cy, tw, th) {
    if (grow <= 0.05) return;
    const trunkH = 0.32 * grow;
    drawIsoBox(ctx, x, 0.02, z, 0.14, trunkH, 0.14, PAL.trunk, shadeHex(PAL.trunk, 0.88), shadeHex(PAL.trunk, 0.78), cx, cy, tw, th);
    const crownCol = mixHex(PAL.clayGrass, isBlossom ? PAL.blossom : PAL.leaf[0], colorMix);
    const p = iso(x, trunkH + 0.24 * grow, z, cx, cy, tw, th);
    const rad = tw * 0.22 * grow;
    ctx.save();
    ctx.fillStyle = crownCol;
    ctx.beginPath();
    ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(p[0] - rad * 0.25, p[1] - rad * 0.25, rad * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function measureShot(W, H, safe, shot, micro) {
    const isPortrait = H > W;
    const tw = isPortrait ? (safe.w / 13.8) : (safe.h / 8.2);
    const th = tw * 0.54;
    const cx = safe.x + safe.w * 0.5;
    const cy = safe.y + safe.h * (isPortrait ? 0.50 : 0.46);
    const halfW = Math.min(safe.w * 0.46, 6.2 * tw);
    const minX = Math.max(safe.x + 12, cx - halfW);
    const maxX = Math.min(safe.x + safe.w - 12, cx + halfW);
    const minY = micro ? Math.max(safe.y + 16, cy - 6.0 * th - 2.6 * tw * 0.55) : safe.y + 12;
    const maxY = Math.min(safe.y + safe.h - 24, cy + 6.4 * th + 28);
    return {
      behind: false,
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  }

  function renderShot(ctx, W, H, safe, shot, localTime, micro, cameraRig) {
    const dur = Math.max(0.01, shot.duration || 7.5);
    const u = clamp(localTime / dur);
    const isPortrait = H > W;
    const tw = isPortrait ? (safe.w / 13.8) : (safe.h / 8.2);
    const th = tw * 0.54;
    const cx = safe.x + safe.w * 0.5;
    const cy = safe.y + safe.h * (isPortrait ? 0.50 : 0.46);

    // Phase parameters per layout
    let colorMix = 1.0;
    let growScale = 1.0;
    let edgeGlow = 0.0;
    let pulseR = -1;
    let carPhase = u;

    if (shot.layout === 'clay-grid') {
      growScale = easeOut(clamp(u * 1.35));
      colorMix = 0.0;
      edgeGlow = 0.85;
    } else if (shot.layout === 'city-ignition') {
      growScale = 1.0;
      pulseR = u * 11.5;
      colorMix = smooth(0.1, 0.85, u);
      edgeGlow = 1 - colorMix;
    } else if (shot.layout === 'traffic-flow') {
      growScale = 1.0;
      colorMix = 1.0;
      carPhase = u * 2.0;
    } else {
      // isopolis-overview
      growScale = 1.0;
      colorMix = 1.0;
      carPhase = u * 1.5;
    }

    drawBackground(ctx, W, H, u);
    ctx.save();
    if (cameraRig && window.StoryCamera && typeof window.StoryCamera.apply2D === 'function') {
      window.StoryCamera.apply2D(ctx, cameraRig, W, H, { skipBlur: true });
    }
    drawIslandBase(ctx, cx, cy, tw, th);

    // Depth-sorted 12x12 tiles & buildings (painter's order: i + j ascending)
    for (let sum = 0; sum <= (N - 1) * 2; sum++) {
      for (let i = 0; i < N; i++) {
        const j = sum - i;
        if (j < 0 || j >= N) continue;
        const ch = MAP[j][i];
        const distFromCore = Math.hypot(i - 5.5, j - 5.5);
        const tileMix = pulseR >= 0 ? smooth(pulseR + 1.2, pulseR - 0.8, distFromCore) : colorMix;

        // Ground tile
        let tileCol = PAL.grass[(i + j) % PAL.grass.length];
        if (ch === 'r') tileCol = PAL.road;
        else if (ch === 'w') tileCol = PAL.water;
        else if (ch === 'p' || ch === 'c') tileCol = (i + j) % 2 ? PAL.plaza : PAL.plaza2;

        const clayTile = ch === 'r' ? PAL.clayRoad : ch === 'w' ? PAL.clayWater : PAL.clayGrass;
        const finalTile = mixHex(clayTile, tileCol, tileMix);
        drawIsoBox(ctx, i, 0, j, 0.96, 0.06, 0.96, finalTile, shadeHex(finalTile, 0.92), shadeHex(finalTile, 0.85), cx, cy, tw, th);

        // Road lane dashes
        if (ch === 'r' && (i === 2 || i === 9 || j === 2 || j === 9)) {
          const mp = iso(i, 0.07, j, cx, cy, tw, th);
          ctx.fillStyle = PAL.mark;
          ctx.globalAlpha = 0.7 * tileMix + 0.25;
          ctx.fillRect(mp[0] - 3, mp[1] - 1.5, 6, 3);
          ctx.globalAlpha = 1;
        }

        // Buildings & Core Tower
        if (ch === 'b' || ch === 'h' || ch === 'c' || ch === 's') {
          const seed = i * 31 + j * 17;
          const isCore = ch === 'c';
          const baseH = isCore ? 2.45 : ch === 'b' ? 0.9 + hs(seed, 1) * 1.4 : ch === 's' ? 0.75 + hs(seed, 2) * 0.7 : 0.48 + hs(seed, 3) * 0.4;
          const bH = baseH * growScale;
          const bCol = isCore ? '#FBFAFF' : PAL.buildings[(i + j * 2) % PAL.buildings.length];
          const topC = mixHex(PAL.clay, bCol, tileMix);
          const leftC = mixHex(PAL.clayLeft, shadeHex(bCol, 0.91), tileMix);
          const rightC = mixHex(PAL.clayRight, shadeHex(bCol, 0.82), tileMix);
          const edgeC = edgeGlow > 0.05 ? `rgba(98,240,242,${(edgeGlow * 0.85).toFixed(2)})` : null;

          drawIsoBox(ctx, i, 0.06, j, 0.72, bH, 0.72, topC, leftC, rightC, cx, cy, tw, th, edgeC, 1.5);
          drawWindows(ctx, i, j, bH, 0.72, 0.72, tileMix, cx, cy, tw, th, seed);

          // Glowing cyan core antenna
          if (isCore && i === 5 && j === 5) {
            const topP = iso(5.5, 0.06 + bH + 0.35, 5.5, cx, cy, tw, th);
            const g = ctx.createRadialGradient(topP[0], topP[1], 0, topP[0], topP[1], tw * 0.75);
            g.addColorStop(0, 'rgba(98,240,242,0.85)');
            g.addColorStop(1, 'rgba(98,240,242,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(topP[0], topP[1], tw * 0.75, 0, Math.PI * 2); ctx.fill();
          }
        } else if (ch === 't' || ch === 'f') {
          drawTree(ctx, i, j, ch === 'f', growScale, tileMix, cx, cy, tw, th);
        }
      }
    }

    // Animated vehicles cruising the perimeter road loop (rows/cols 2 & 9)
    if (colorMix > 0.3) {
      const cars = [
        { p: (carPhase * 0.8) % 1, col: '#FF9E86' },
        { p: (carPhase * 0.8 + 0.35) % 1, col: '#62F0F2' },
        { p: (carPhase * 0.8 + 0.68) % 1, col: '#FFE6A1' }
      ];
      cars.forEach((car) => {
        const seg = Math.floor(car.p * 4);
        const f = (car.p * 4) % 1;
        let vx = 2, vz = 2;
        if (seg === 0) { vx = lerp(2, 9, f); vz = 2; }
        else if (seg === 1) { vx = 9; vz = lerp(2, 9, f); }
        else if (seg === 2) { vx = lerp(9, 2, f); vz = 9; }
        else { vx = 2; vz = lerp(9, 2, f); }
        drawIsoBox(ctx, vx, 0.07, vz, 0.28, 0.14, 0.28, car.col, shadeHex(car.col, 0.88), shadeHex(car.col, 0.78), cx, cy, tw, th);
      });
    }

    // Expanding cyan ignition ring on the city plane
    if (pulseR >= 0 && pulseR < 10) {
      const rp = iso(5.5, 0.1, 5.5, cx, cy, tw, th);
      ctx.save();
      ctx.strokeStyle = PAL.data;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1 - pulseR / 10;
      ctx.beginPath();
      ctx.ellipse(rp[0], rp[1], pulseR * tw * 0.65, pulseR * th * 0.65, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Clean City OS HUD (suppressed in Mode 'M')
    if (!micro) {
      const sc = Math.min(1, safe.w / 896);
      ctx.save();
      ctx.fillStyle = PAL.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `800 ${Math.round(48 * sc)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(String(shot.headline || 'ISOPOLIS').toUpperCase(), safe.x + 12, safe.y + 12);

      ctx.font = `600 ${Math.round(18 * sc)}px "Courier New", monospace`;
      ctx.globalAlpha = 0.78;
      ctx.fillText(String(shot.tagline || '2.5D ISOMETRIC CITY'), safe.x + 14, safe.y + 68 * sc);

      if (shot.metric) {
        ctx.textAlign = 'right';
        ctx.globalAlpha = 0.9;
        ctx.fillText(String(shot.metric).toUpperCase(), safe.x + safe.w - 12, safe.y + 22 * sc);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  window.IsometricKit = { renderShot, measureShot, PAL };
})();
