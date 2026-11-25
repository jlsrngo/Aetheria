/* .aetheria/skills/mg-stickman-story/examples/script/stickman-rig.js
 * Procedural 2D Cartoon Vector Character Rig, Held Props & Head Emotes (60fps HTML5 Canvas2D).
 * World units (same as StoryCamera Director v2): floor y = 0, HEAD_Y = -282, HEAD_R = 88.
 */
(function (root) {
  'use strict';

  var OUT = '#181A20';
  var WHITE = '#FFFFFF';
  var DARK_RED = '#9B262B';
  var TONGUE = '#F28B8B';
  var PI = Math.PI;
  var DEG = PI / 180;

  var HEAD_Y = -282;
  var HEAD_R = 88;
  var NECK_Y = -194;
  var SHOULDER_Y = -190;
  var HIP_Y = -92;
  var FOOT_Y = 0;
  var GROUND_Y = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smootherstep(t) {
    var p = clamp(t, 0, 1);
    return p * p * p * (p * (p * 6 - 15) + 10);
  }

  function arcPts(cx, cy, rx, ry, deg0, deg1, steps) {
    var n = Math.max(3, steps || 16);
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = (deg0 + (deg1 - deg0) * (i / n)) * DEG;
      out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return out;
  }

  function ellPts(cx, cy, rx, ry, steps) {
    return arcPts(cx, cy, rx, ry, 0, 360, steps || 20);
  }

  function catmullRom(pts, closed, subdiv) {
    if (!pts || pts.length < 2) return pts || [];
    var n = pts.length;
    var sub = Math.max(3, subdiv || 8);
    var out = [];
    var count = closed ? n : n - 1;
    for (var i = 0; i < count; i++) {
      var p0 = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
      var p1 = pts[i];
      var p2 = pts[(i + 1) % n];
      var p3 = closed ? pts[(i + 2) % n] : pts[Math.min(n - 1, i + 2)];
      for (var j = 0; j < sub; j++) {
        var t = j / sub;
        var t2 = t * t;
        var t3 = t2 * t;
        var x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        var y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, y]);
      }
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }

  /**
   * Drawing facade in world units. Applies Director Camera transforms via `StoryCamera.applyWorldLayer2D`
   * for genuine 2.5D depth parallax; `fixed: true` preserves caller transform (used by galleries).
   */
  function WorldCanvas(ctx, W, H, cam, options) {
    this.ctx = ctx;
    this.W = W || 1080;
    this.H = H || 1920;
    this.cam = cam || { x: 0, y: -300, z: 1, r: 0 };
    this.fixed = !!(options && options.fixed);
    this.depth = 1.0;
    if (!this.fixed) this.setDepth(1.0);
  }

  WorldCanvas.prototype.setDepth = function (d) {
    this.depth = Number.isFinite(Number(d)) ? Number(d) : 1.0;
    if (this.fixed) return;
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var SC = root.StoryCamera;
    if (SC && typeof SC.applyWorldLayer2D === 'function') {
      SC.applyWorldLayer2D(ctx, this.cam, this.depth, this.W, this.H);
      return;
    }
    var u = this.W >= this.H ? this.H / 1080 : (this.W / 1080) * 1.25;
    var k = u * (1 + ((Number(this.cam.z) || 1) - 1) * this.depth);
    var ox = this.W * 0.5 - ((Number(this.cam.x) || 0) * this.depth) * k;
    var oy = this.H * 0.5 - (-300 + ((Number(this.cam.y) || -300) + 300) * this.depth) * k;
    ctx.translate(ox, oy);
    ctx.scale(k, k);
  };

  WorldCanvas.prototype.screen = function () { this.ctx.setTransform(1, 0, 0, 1, 0, 0); };
  WorldCanvas.prototype.zoomScale = function () { return 1; };
  WorldCanvas.prototype.p = function (wx, wy) { return [wx, wy]; };
  WorldCanvas.prototype.r = function (val) { return val; };

  WorldCanvas.prototype.poly = function (pts, fill, outlineW, outlineCol) {
    if (!pts || pts.length < 2) return;
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (outlineW && outlineW > 0) {
      ctx.strokeStyle = outlineCol || OUT;
      ctx.lineWidth = Math.max(1, outlineW);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  };

  WorldCanvas.prototype.blob = function (ctrlPts, fill, outlineW, outlineCol, subdiv) {
    this.poly(catmullRom(ctrlPts, true, subdiv || 9), fill, outlineW, outlineCol);
  };

  WorldCanvas.prototype.line = function (pts, strokeCol, width) {
    if (!pts || pts.length < 2) return;
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = strokeCol || OUT;
    ctx.lineWidth = Math.max(1, width || 5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  WorldCanvas.prototype.curve = function (ctrlPts, strokeCol, width, closed) {
    this.line(catmullRom(ctrlPts, !!closed, 8), strokeCol, width);
  };

  WorldCanvas.prototype.tube = function (pts, fill, innerW, outlineW, outlineCol) {
    if (!pts || pts.length < 2) return;
    var ow = outlineW != null ? outlineW : 6.2;
    this.line(pts, outlineCol || OUT, innerW + ow * 2);
    this.line(pts, fill, innerW);
  };

  WorldCanvas.prototype.ell = function (wx, wy, rx, ry, fill, outlineW, outlineCol, rotDeg) {
    var ctx = this.ctx;
    var tilt = (rotDeg || 0) * DEG;
    ctx.beginPath();
    ctx.ellipse(wx, wy, Math.max(0.5, rx), Math.max(0.5, ry), tilt, 0, PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (outlineW && outlineW > 0) {
      ctx.strokeStyle = outlineCol || OUT;
      ctx.lineWidth = Math.max(1, outlineW);
      ctx.stroke();
    }
  };

  WorldCanvas.prototype.rect = function (wx, wy, w, h, rad, fill, outlineW, outlineCol) {
    var rr = Math.min(rad || 0, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
    var pts = [];
    if (rr <= 0.5) {
      pts = [[wx, wy], [wx + w, wy], [wx + w, wy + h], [wx, wy + h]];
    } else {
      pts = pts
        .concat(arcPts(wx + w - rr, wy + rr, rr, rr, -90, 0, 4))
        .concat(arcPts(wx + w - rr, wy + h - rr, rr, rr, 0, 90, 4))
        .concat(arcPts(wx + rr, wy + h - rr, rr, rr, 90, 180, 4))
        .concat(arcPts(wx + rr, wy + rr, rr, rr, 180, 270, 4));
    }
    this.poly(pts, fill, outlineW, outlineCol);
  };

  WorldCanvas.prototype.text = function (str, wx, wy, size, fill, align, outlineW, outlineCol, weight) {
    if (!str) return;
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.font = (weight || 800) + ' ' + Math.max(8, size || 32).toFixed(1) + 'px "Fredoka", "Nunito", "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    if (outlineW && outlineW > 0) {
      ctx.strokeStyle = outlineCol || OUT;
      ctx.lineWidth = Math.max(1.5, outlineW);
      ctx.lineJoin = 'round';
      ctx.strokeText(str, 0, 0);
    }
    ctx.fillStyle = fill || OUT;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  };

  // --- 13 Character Presets ---
  var PRESETS = {
    afro: {
      skin: '#FAD7B8', hair: 'afro', hairColor: '#191C22',
      glasses: 'square', chibiEyes: false, thickBrows: true,
      shirt: '#4A7A7C', shortSleeves: true, tie: 'bowtie', tieColor: '#22262E',
      bottom: 'pants', bottomColor: '#242830', shoes: 'sneaker', shoeColor: '#1D2129',
      scale: 1.0
    },
    nadia: {
      skin: '#FFE0C4', hair: 'hijab', hijabStyle: 'modern', hairColor: '#202028', hijabShade: '#4C4E5C',
      glasses: 'round', chibiEyes: true, lashes: false,
      shirt: '#E0C29A', innerShirt: '#FFFFFF', blazer: true, whiteCollar: false, shortSleeves: false,
      bodyWidth: 1.05,
      bottom: 'skirt', bottomColor: '#2C2C34', shoes: 'flat', shoeColor: '#44342E',
      scale: 0.96
    },
    leo: {
      skin: '#F4C9A4', hair: 'spiky', hairColor: '#1E222B',
      glasses: null, chibiEyes: false, thickBrows: true,
      shirt: '#E05A47', shortSleeves: true, tie: null,
      bottom: 'pants', bottomColor: '#2B3548', shoes: 'sneaker', shoeColor: '#C83E32',
      scale: 1.0
    },
    ben: {
      skin: '#F7CFAF', hair: 'curly', hairColor: '#2B211B',
      glasses: null, chibiEyes: false, thickBrows: true, bodyWidth: 1.22,
      shirt: '#F2B138', shortSleeves: true,
      bottom: 'pants', bottomColor: '#343A46', shoes: 'sneaker', shoeColor: '#242830',
      scale: 1.02
    },
    sam: {
      skin: '#F9D6B8', hair: 'neat', hairColor: '#1F242D',
      glasses: 'square', chibiEyes: false,
      shirt: '#FFFFFF', shortSleeves: true, tie: 'long', tieColor: '#3B6EA8',
      bottom: 'pants', bottomColor: '#2A3F5F', shoes: 'sneaker', shoeColor: '#1E222A',
      scale: 0.99
    },
    mia: {
      skin: '#FDE1C8', hair: 'bob', hairColor: '#20232B',
      glasses: null, chibiEyes: true, lashes: true,
      shirt: '#F07167', shortSleeves: true,
      bottom: 'skirt', bottomColor: '#2F3644', shoes: 'flat', shoeColor: '#3A2A24',
      scale: 0.95
    },
    chloe: {
      skin: '#FCE0C5', hair: 'ponytail', hairColor: '#2B1E1A',
      glasses: null, chibiEyes: true, lashes: true,
      shirt: '#52B788', shortSleeves: true,
      bottom: 'skirt', bottomColor: '#2A3240', shoes: 'sneaker', shoeColor: '#2C6E49',
      scale: 0.93
    },
    dad: {
      skin: '#F1C39E', hair: 'neat', hairColor: '#232730', mustache: true,
      glasses: 'square', chibiEyes: false, thickBrows: true,
      shirt: '#457B9D', shortSleeves: false, tie: 'long', tieColor: '#1D3557',
      bottom: 'pants', bottomColor: '#1F242D', shoes: 'flat', shoeColor: '#221C18',
      scale: 1.08
    },
    mom: {
      skin: '#FAD8BC', hair: 'hijab', hairColor: '#B56576',
      glasses: null, chibiEyes: true, lashes: true,
      shirt: '#E8A598', shortSleeves: false,
      bottom: 'skirt', bottomColor: '#3D314A', shoes: 'flat', shoeColor: '#3B2820',
      scale: 1.02
    },
    teacher: {
      skin: '#EFC29D', hair: 'neat', hairColor: '#2D313A',
      glasses: 'square', chibiEyes: false, thickBrows: true,
      shirt: '#B68D40', shortSleeves: false,
      bottom: 'pants', bottomColor: '#232730', shoes: 'flat', shoeColor: '#1E1A18',
      scale: 1.07
    },
    'ms-claire': {
      skin: '#FCE0C6', hair: 'hijab', hairColor: '#3D5A80',
      glasses: 'round', chibiEyes: true, lashes: true,
      shirt: '#98C1D9', shortSleeves: false,
      bottom: 'skirt', bottomColor: '#293241', shoes: 'flat', shoeColor: '#2A211E',
      scale: 1.02
    },
    grandpa: {
      skin: '#ECC09B', hair: 'silver', hairColor: '#D4D8DF', mustache: true,
      glasses: 'round', chibiEyes: false,
      shirt: '#8D99AE', shortSleeves: false,
      bottom: 'pants', bottomColor: '#2B2D42', shoes: 'flat', shoeColor: '#2B2320',
      scale: 1.01
    },
    kid: {
      skin: '#FDE2CA', hair: 'afro', hairColor: '#20242C',
      glasses: null, chibiEyes: true,
      shirt: '#FFD166', shortSleeves: true,
      bottom: 'pants', bottomColor: '#26547C', shoes: 'sneaker', shoeColor: '#EF476F',
      scale: 0.76
    }
  };

  // --- 20 Expressions ---
  var EXPR = {
    happy:      { eye: 'open',    brow: 'calm',  mouth: 'open',        open: 0.62 },
    calm:       { eye: 'open',    brow: 'calm',  mouth: 'smile',       open: 0.3 },
    neutral:    { eye: 'open',    brow: 'calm',  mouth: 'flat',        open: 0.1 },
    laugh:      { eye: 'happy',   brow: 'up',    mouth: 'grin',        open: 0.92, blush: true },
    excited:    { eye: 'spark',   brow: 'up',    mouth: 'grin',        open: 0.85, blush: true },
    proud:      { eye: 'happy',   brow: 'up',    mouth: 'smirk',       open: 0.4,  blush: true },
    shy:        { eye: 'shy',     brow: 'sad',   mouth: 'wave',        open: 0.3,  blush: true },
    angry:      { eye: 'open',    brow: 'angry', mouth: 'grit',        open: 0.7,  vein: true },
    annoyed:    { eye: 'half',    brow: 'angry', mouth: 'frown',       open: 0.3 },
    surprised:  { eye: 'wide',    brow: 'high',  mouth: 'o',           open: 0.88 },
    panic:      { eye: 'wide',    brow: 'sad',   mouth: 'wave-o',      open: 0.92, sweat: true },
    scared:     { eye: 'wide',    brow: 'sad',   mouth: 'wave',        open: 0.5,  sweat: true },
    sad:        { eye: 'sad',     brow: 'sad',   mouth: 'frown',       open: 0.4,  tears: true },
    crying:     { eye: 'happy',   brow: 'sad',   mouth: 'yawn',        open: 0.9,  stream: true },
    thinking:   { eye: 'look-up', brow: 'quiz',  mouth: 'flat-tilted', open: 0.2 },
    confused:   { eye: 'open',    brow: 'quiz',  mouth: 'wave',        open: 0.35 },
    suspicious: { eye: 'half',    brow: 'quiz',  mouth: 'smirk',       open: 0.2 },
    sleepy:     { eye: 'half',    brow: 'sad',   mouth: 'yawn',        open: 0.75 },
    sleep:      { eye: 'closed',  brow: 'calm',  mouth: 'o',           open: 0.38 },
    tired:      { eye: 'half',    brow: 'sad',   mouth: 'wave',        open: 0.45, sweat: true }
  };

  // --- 44 Poses ---
  var POSES = {
    idle:            { L: [-58, -96],  R: [58, -96],   legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    greet:           { L: [-46, -126, 22], R: [108, -228, -16], legs: 'stand', sit: 0, lean: 0, tilt: -2, thumbR: true },
    wave:            { L: [-56, -98],  R: [104, -264, -18], legs: 'stand', sit: 0, lean: 0, tilt: -3, wave: 'R' },
    'wave-both':     { L: [-102, -266, 18], R: [102, -266, -18], legs: 'stand', sit: 0, lean: 0, tilt: 0, wave: 'LR' },
    'point-right':   { L: [-48, -126, 20], R: [128, -164, -6], legs: 'stand', sit: 0, lean: 3, tilt: 0, pointR: true },
    'point-left':    { L: [-128, -164, 6], R: [48, -126, -20], legs: 'stand', sit: 0, lean: -3, tilt: 0, pointL: true },
    'point-up':      { L: [-48, -126, 20], R: [86, -288, -12], legs: 'stand', sit: 0, lean: 0, tilt: -3, pointR: true },
    idea:            { L: [-48, -126, 20], R: [88, -284, -14], legs: 'stand', sit: 0, lean: 0, tilt: -4, pointR: true },
    'thumbs-up':     { L: [-48, -124, 22], R: [102, -206, -14], legs: 'stand', sit: 0, lean: 0, tilt: -2, thumbR: true },
    speak:           { L: [-72, -148, 16], R: [76, -156, -16], legs: 'stand', sit: 0, lean: 2, tilt: 0 },
    explain:         { L: [-86, -162, 12], R: [108, -178, -10], legs: 'stand', sit: 0, lean: 3, tilt: 0 },
    ask:             { L: [-92, -172, 18], R: [92, -172, -18], legs: 'stand', sit: 0, lean: 0, tilt: 5 },
    shrug:           { L: [-96, -184, 24], R: [96, -184, -24], legs: 'stand', sit: 0, lean: 0, tilt: 4 },
    'hands-on-hips': { L: [-44, -122, 34], R: [44, -122, -34], legs: 'wide',  sit: 0, lean: 0, tilt: 0 },
    'arms-crossed':  { L: [22, -142, 18],  R: [-22, -146, -18], legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    'hands-on-chest':{ L: [-24, -150, 26], R: [24, -150, -26], legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    think:           { L: [-44, -124, 28], R: [26, -214, 24],  legs: 'stand', sit: 0, lean: 0, tilt: 6 },
    'scratch-head':  { L: [-56, -98],      R: [56, -328, 36],  legs: 'stand', sit: 0, lean: 0, tilt: 5 },
    'hold-head':     { L: [-74, -304, -28], R: [74, -304, 28], legs: 'wide',  sit: 0, lean: 0, tilt: 0 },
    'cover-mouth':   { L: [-16, -222, -18], R: [16, -222, 18], legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    'cover-face':    { L: [-22, -262, -20], R: [22, -262, 20], legs: 'stand', sit: 0, lean: 4, tilt: 0 },
    surprised:       { L: [-98, -242, 18], R: [98, -242, -18], legs: 'wide',  sit: 0, lean: -4, tilt: 0 },
    cheer:           { L: [-92, -308, 16], R: [92, -308, -16], legs: 'wide',  sit: 0, lean: 0, tilt: 0 },
    'jump-joy':      { L: [-98, -314, 18], R: [98, -314, -18], legs: 'jump',  sit: -38, lean: 0, tilt: 0 },
    crying:          { L: [-34, -258, -22], R: [34, -258, 22], legs: 'stand', sit: 8, lean: 6, tilt: 4 },
    sad:             { L: [-46, -88],      R: [46, -88],       legs: 'stand', sit: 6, lean: 6, tilt: 6 },
    angry:           { L: [-74, -152, 28], R: [74, -152, -28], legs: 'wide',  sit: 4, lean: 6, tilt: 0 },
    'point-angry':   { L: [-52, -132, 26], R: [128, -182, -8], legs: 'wide',  sit: 2, lean: 8, tilt: 0, pointR: true },
    pray:            { L: [-10, -162, 20], R: [10, -162, -20], legs: 'stand', sit: 0, lean: 2, tilt: 3 },
    clap:            { L: [-18, -166, 18], R: [18, -166, -18], legs: 'stand', sit: 0, lean: 0, tilt: 0, wave: 'LR' },
    'hold-right':    { L: [-56, -98],      R: [78, -148, -12], legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    'hold-left':     { L: [-78, -148, 12], R: [56, -98],       legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    'hold-both':     { L: [-46, -148, 16], R: [46, -148, -16], legs: 'stand', sit: 0, lean: 0, tilt: 0 },
    read:            { L: [-38, -154, 18], R: [38, -154, -18], legs: 'stand', sit: 0, lean: 4, tilt: 5 },
    'check-phone':   { L: [-52, -98],      R: [36, -166, -22], legs: 'stand', sit: 0, lean: 3, tilt: 6 },
    drink:           { L: [-54, -98],      R: [24, -228, 28],  legs: 'stand', sit: 0, lean: -2, tilt: -6 },
    walk:            { L: [-64, -104],     R: [64, -104],      legs: 'walk',  sit: 0, lean: 4, tilt: 0, swing: 1.0 },
    run:             { L: [-78, -138, 26], R: [78, -138, -26], legs: 'run',   sit: 0, lean: 11, tilt: 2, swing: 1.65 },
    sneak:           { L: [-64, -132, 22], R: [64, -132, -22], legs: 'walk',  sit: 18, lean: 12, tilt: 4, swing: 0.65 },
    sit:             { L: [-42, -108, 14], R: [42, -108, -14], legs: 'sit',   sit: 48, lean: 0, tilt: 0 },
    'sit-desk':      { L: [-48, -138, 14], R: [48, -138, -14], legs: 'sit',   sit: 48, lean: 3, tilt: 0 },
    write:           { L: [-52, -136, 14], R: [28, -132, -18], legs: 'sit',   sit: 48, lean: 5, tilt: 5, wave: 'R' },
    squat:           { L: [-48, -74, 18],  R: [48, -74, -18],  legs: 'squat', sit: 68, lean: 8, tilt: 3 },
    sleep:           { L: [-46, -110],     R: [46, -110],      legs: 'sleep', sit: 0, lean: 0, tilt: 0, lie: true }
  };

  function getPoseDef(name) { return POSES[name] || POSES.idle; }

  function evalPoseState(name, t) {
    var d = getPoseDef(name);
    var L = [d.L[0], d.L[1], d.L[2] || 14];
    var R = [d.R[0], d.R[1], d.R[2] || -14];
    var w = d.wave || '';
    if (w.indexOf('R') >= 0) {
      R[1] += 22 * Math.sin(t * 9.0);
      R[0] += 6 * Math.sin(t * 4.5);
    }
    if (w.indexOf('L') >= 0) {
      L[1] += 22 * Math.sin(t * 9.0 + 1.3);
      L[0] -= 6 * Math.sin(t * 4.5 + 1.3);
    }
    return {
      L: L, R: R, legs: d.legs || 'stand',
      sit: d.sit || 0, lean: d.lean || 0, tilt: d.tilt || 0,
      swing: d.swing != null ? d.swing : 1.0,
      lie: !!d.lie, thumbR: !!d.thumbR, pointR: !!d.pointR, pointL: !!d.pointL
    };
  }

  function blendPoseStates(a, b, alpha) {
    var p = smootherstep(alpha);
    return {
      L: [lerp(a.L[0], b.L[0], p), lerp(a.L[1], b.L[1], p), lerp(a.L[2], b.L[2], p)],
      R: [lerp(a.R[0], b.R[0], p), lerp(a.R[1], b.R[1], p), lerp(a.R[2], b.R[2], p)],
      legs: p < 0.5 ? a.legs : b.legs,
      sit: lerp(a.sit, b.sit, p),
      lean: lerp(a.lean, b.lean, p),
      tilt: lerp(a.tilt, b.tilt, p),
      swing: lerp(a.swing, b.swing, p),
      lie: p < 0.5 ? a.lie : b.lie,
      thumbR: p < 0.5 ? a.thumbR : b.thumbR,
      pointR: p < 0.5 ? a.pointR : b.pointR,
      pointL: p < 0.5 ? a.pointL : b.pointL
    };
  }

  function blinkAt(t, seed) {
    var q = ((t + (seed || 0) * 1.7) % 3.3 + 3.3) % 3.3;
    return (q > 3.14 && q < 3.30) ? (1.0 - Math.abs(q - 3.22) / 0.08) : 0.0;
  }

  function makeCharPreset(spec) {
    if (typeof spec === 'string') return Object.assign({}, PRESETS[spec] || PRESETS.afro);
    if (spec && typeof spec === 'object') {
      var baseName = spec.base || spec.preset || 'afro';
      return Object.assign({}, PRESETS[baseName] || PRESETS.afro, spec);
    }
    return Object.assign({}, PRESETS.afro);
  }

  function elbowPoint(sx, sy, hx, hy, bend) {
    var mx = (sx + hx) * 0.5;
    var my = (sy + hy) * 0.5;
    var dx = hx - sx;
    var dy = hy - sy;
    var len = Math.hypot(dx, dy) || 1;
    return [mx + (-dy / len) * (bend || 0), my + (dx / len) * (bend || 0)];
  }

  function drawHairBack(c, p, H, HH, s, ow) {
    var r = p.hair || 'afro';
    var hc = p.hairColor || '#191C22';
    if (r === 'afro') {
      // 2-pass unified afro cloud: dark outline pass of all lobes, then fill pass -> seamless silhouette.
      var lobes = [[0, -38, HEAD_R * 1.16]];
      for (var li = 0; li < 11; li++) {
        var la = (160 + li * 22) * DEG;
        var lr = HEAD_R * (li % 2 ? 0.44 : 0.5);
        lobes.push([Math.cos(la) * HEAD_R * 1.08, -26 + Math.sin(la) * HEAD_R * 1.04, lr]);
      }
      for (var pa = 0; pa < lobes.length; pa++) {
        var lp = H(lobes[pa][0], lobes[pa][1]);
        c.ell(lp[0], lp[1], (lobes[pa][2] + ow * 0.9) * s, (lobes[pa][2] + ow * 0.9) * s, OUT, 0);
      }
      for (var pb = 0; pb < lobes.length; pb++) {
        var lq = H(lobes[pb][0], lobes[pb][1]);
        c.ell(lq[0], lq[1], lobes[pb][2] * s, lobes[pb][2] * s, hc, 0);
      }
    } else if (r === 'hijab') {
      if (p.hijabStyle === 'modern') {
        var modDome = [
          [-108, -10], [-96, -78], [-56, -118], [0, -130],
          [56, -118], [96, -78], [108, -10],
          [112, 46], [82, 86], [0, 96], [-82, 86], [-112, 46]
        ];
        c.blob(HH(modDome), hc, ow, OUT, 7);
        var hShade = p.hijabShade || '#4C4E5C';
        c.curve(HH([[-86, -58], [-52, -100], [0, -112]]), hShade, 3.0 * s, false);
        c.curve(HH([[86, -58], [52, -100], [0, -112]]), hShade, 3.0 * s, false);
      } else {
        var veil = [
          [0, -HEAD_R - 18], [HEAD_R + 18, -HEAD_R * 0.45],
          [HEAD_R + 24, 24], [HEAD_R * 0.85, 86], [0, 108],
          [-HEAD_R * 0.85, 86], [-HEAD_R - 24, 24], [-HEAD_R - 18, -HEAD_R * 0.45]
        ];
        c.blob(HH(veil), hc, ow, OUT, 8);
      }
    } else if (r === 'bob') {
      c.blob(HH([[-HEAD_R - 12, -32], [HEAD_R + 12, -32], [HEAD_R + 18, 56], [-HEAD_R - 18, 56]]), hc, ow, OUT, 6);
    } else if (r === 'ponytail') {
      var tp = H(0, -HEAD_R - 22);
      c.ell(tp[0], tp[1], 32 * s, 28 * s, hc, ow, OUT);
    }
  }

  function drawHairFront(c, p, H, HH, s, ow) {
    var r = p.hair || 'afro';
    var hc = p.hairColor || '#191C22';
    if (r === 'afro') {
      var topArc = arcPts(0, -14, HEAD_R * 1.18, HEAD_R * 1.06, 195, 345, 16);
      var innerFringe = [];
      for (var i = 14; i >= 0; i--) {
        var a = (198 + (342 - 198) * (i / 14)) * DEG;
        var rr = HEAD_R * (0.76 + 0.05 * Math.sin(i * 1.9));
        innerFringe.push([Math.cos(a) * rr * 1.02, Math.sin(a) * rr * 0.92 - 4]);
      }
      c.poly(HH(topArc.concat(innerFringe)), hc, 0);
    } else if (r === 'hijab') {
      if (p.hijabStyle === 'modern') {
        var hShadeF = p.hijabShade || '#4C4E5C';
        c.curve(HH([[-74, -14], [-44, -56], [0, -76], [44, -56], [74, -14]]), hShadeF, 3.0 * s, false);
        // Soft chest scarf wrap under chin so blazer shoulders & lapels stay visible
        var scarf = [
          [-92, 22], [-102, 74], [-78, 108], [-42, 122], [0, 134],
          [42, 122], [78, 108], [102, 74], [92, 22], [68, 66], [0, 88], [-68, 66]
        ];
        c.blob(HH(scarf), hc, ow * 0.85, OUT, 6);
        c.curve(HH([[-76, 94], [-34, 110], [0, 118], [34, 110], [76, 94]]), hShadeF, 3.6 * s, false);
        c.curve(HH([[-52, 112], [-16, 124], [24, 120]]), hShadeF, 3.0 * s, false);
      } else {
        var outerHood = arcPts(0, -2, HEAD_R + 16, HEAD_R + 18, 150, 390, 24);
        var innerFace = arcPts(0, 6, HEAD_R * 0.90, HEAD_R * 0.92, 385, 155, 22);
        c.poly(HH(outerHood.concat(innerFace)), hc, ow * 0.85, OUT);
        c.curve(HH([[-HEAD_R * 0.72, 68], [0, 92], [HEAD_R * 0.72, 68]]), OUT, 4.2 * s, false);
      }
    } else if (r === 'spiky') {
      var spikes = [
        [-84, -22], [-96, -68], [-64, -64], [-58, -112], [-24, -84],
        [0, -122], [28, -84], [62, -110], [66, -64], [94, -66], [84, -22],
        [52, -56], [16, -54], [-18, -56], [-54, -56]
      ];
      c.poly(HH(spikes), hc, ow * 0.85, OUT);
    } else if (r === 'curly') {
      for (var deg = 195; deg <= 345; deg += 22) {
        var rad = deg * DEG;
        var hp = H(Math.cos(rad) * HEAD_R * 0.88, Math.sin(rad) * HEAD_R * 0.86 - 4);
        c.ell(hp[0], hp[1], 26 * s, 26 * s, hc, ow * 0.8, OUT);
      }
    } else if (r === 'neat' || r === 'silver') {
      var top = arcPts(0, 0, HEAD_R + 6, HEAD_R + 6, 188, 352, 18);
      var fringe = [[72, -52], [40, -64], [10, -50], [-18, -62], [-48, -48], [-74, -54]];
      c.poly(HH(top.concat(fringe)), hc, ow * 0.85, OUT);
    } else if (r === 'bob') {
      var topB = arcPts(0, 0, HEAD_R + 7, HEAD_R + 7, 178, 362, 20);
      var frB = [[86, 2], [78, -50], [38, -60], [0, -50], [-38, -60], [-78, -50], [-86, 2]];
      c.poly(HH(topB.concat(frB)), hc, ow * 0.85, OUT);
    } else if (r === 'ponytail') {
      var topK = arcPts(0, 0, HEAD_R + 5, HEAD_R + 5, 190, 350, 18);
      var frK = [[74, -48], [44, -64], [14, -52], [-14, -66], [-48, -52], [-76, -50]];
      c.poly(HH(topK.concat(frK)), hc, ow * 0.85, OUT);
    }
  }

  function drawFace(c, p, ex, st, H, HH, s, ow, flip) {
    var eyeY = -10;
    var eyeSep = 31;
    var blink = clamp(Number(st.blink) || 0, 0, 1);
    var lookX = clamp(Number(st.lookX) || 0, -1, 1) * 5;
    var lookY = clamp(Number(st.lookY) || 0, -1, 1) * 4;
    var chibi = !!p.chibiEyes;
    var glasses = p.glasses;

    if (ex.blush || chibi) {
      var alphaCol = ex.blush ? 'rgba(244, 132, 132, 0.55)' : 'rgba(244, 148, 148, 0.30)';
      var blL = H(-50, 20);
      var blR = H(50, 20);
      c.ell(blL[0], blL[1], 14 * s, 8 * s, alphaCol, 0);
      c.ell(blR[0], blR[1], 14 * s, 8 * s, alphaCol, 0);
    }

    if (glasses === 'square') {
      c.poly(HH([[-60, eyeY - 17], [-6, eyeY - 17], [-6, eyeY + 17], [-60, eyeY + 17]]), WHITE, ow * 0.82, OUT);
      c.poly(HH([[6, eyeY - 17], [60, eyeY - 17], [60, eyeY + 17], [6, eyeY + 17]]), WHITE, ow * 0.82, OUT);
      c.line(HH([[-6, eyeY - 2], [6, eyeY - 2]]), OUT, 5.4 * s);
      c.line(HH([[-84, eyeY - 4], [-60, eyeY - 2]]), OUT, 5.0 * s);
      c.line(HH([[60, eyeY - 2], [84, eyeY - 4]]), OUT, 5.0 * s);
    } else if (glasses === 'round') {
      var glL = H(-eyeSep - 2, eyeY);
      var glR = H(eyeSep + 2, eyeY);
      c.ell(glL[0], glL[1], 25 * s, 24 * s, 'rgba(255,255,255,0.45)', ow * 0.78, OUT);
      c.ell(glR[0], glR[1], 25 * s, 24 * s, 'rgba(255,255,255,0.45)', ow * 0.78, OUT);
      c.line(HH([[-8, eyeY - 2], [8, eyeY - 2]]), OUT, 4.8 * s);
    }

    var eyeKind = blink > 0.72 ? 'closed' : (ex.eye || 'open');
    for (var side = -1; side <= 1; side += 2) {
      var ex0 = side * eyeSep;
      if (eyeKind === 'closed') {
        c.curve(HH([[ex0 - 13, eyeY + 2], [ex0, eyeY + 8], [ex0 + 13, eyeY + 2]]), OUT, 4.8 * s, false);
      } else if (eyeKind === 'happy') {
        c.curve(HH([[ex0 - 14, eyeY + 5], [ex0, eyeY - 9], [ex0 + 14, eyeY + 5]]), OUT, 5.2 * s, false);
      } else if (eyeKind === 'shy') {
        c.curve(HH([[ex0 - 12, eyeY + 4], [ex0, eyeY - 5], [ex0 + 12, eyeY + 4]]), OUT, 4.8 * s, false);
      } else {
        var erx = chibi ? 15.5 : (glasses === 'square' ? 7.5 : 10.5);
        var ery = chibi ? 17.0 : (glasses === 'square' ? 9.2 : 12.5);
        if (eyeKind === 'wide') { erx *= 1.15; ery *= 1.2; }
        if (eyeKind === 'half') { ery *= 0.55; }
        var ly = eyeKind === 'look-up' ? -4 : lookY;
        var ep = H(ex0 + lookX * flip, eyeY + ly);
        if (chibi) {
          c.ell(ep[0], ep[1], erx * s, ery * s, '#231F20', 0);
          var sp1 = H(ex0 + lookX * flip - 5, eyeY + ly - 5);
          var sp2 = H(ex0 + lookX * flip + 5, eyeY + ly + 5);
          c.ell(sp1[0], sp1[1], 5.2 * s, 5.2 * s, WHITE, 0);
          c.ell(sp2[0], sp2[1], 2.6 * s, 2.6 * s, WHITE, 0);
          if (p.lashes) c.line(HH([[ex0 + side * 12, eyeY - 12], [ex0 + side * 19, eyeY - 18]]), OUT, 3.8 * s);
        } else {
          c.ell(ep[0], ep[1], erx * s, ery * s, OUT, 0);
          var hi = H(ex0 + lookX * flip - 2.2, eyeY + ly - 3.2);
          c.ell(hi[0], hi[1], 2.7 * s, 2.7 * s, WHITE, 0);
        }
        if (eyeKind === 'spark') {
          var stp = H(ex0, eyeY - 2);
          c.ell(stp[0], stp[1], 4.2 * s, 4.2 * s, '#FFE066', 0);
        }
      }
      if (ex.tears) {
        c.poly(HH([[ex0 + side * 4, eyeY + 14], [ex0 + side * 11, eyeY + 34], [ex0 + side * 2, eyeY + 38], [ex0 - side * 3, eyeY + 28]]), '#7CC6FE', ow * 0.55, OUT);
      } else if (ex.stream) {
        c.line(HH([[ex0 + side * 6, eyeY + 12], [ex0 + side * 10, eyeY + 48]]), '#7CC6FE', 9 * s);
      }
    }

    var brow = ex.brow || 'calm';
    var bw = (p.thickBrows ? 5.6 : 4.4) * s;
    var by = glasses === 'square' ? -31 : -30;
    if (brow === 'angry') {
      c.line(HH([[-50, by - 8], [-14, by + 7]]), OUT, bw);
      c.line(HH([[50, by - 8], [14, by + 7]]), OUT, bw);
    } else if (brow === 'sad') {
      c.line(HH([[-50, by + 6], [-16, by - 6]]), OUT, bw);
      c.line(HH([[50, by + 6], [16, by - 6]]), OUT, bw);
    } else if (brow === 'high' || brow === 'up') {
      var lift = brow === 'high' ? -10 : -5;
      c.curve(HH([[-48, by + lift + 3], [-31, by + lift - 5], [-14, by + lift + 2]]), OUT, bw, false);
      c.curve(HH([[14, by + lift + 2], [31, by + lift - 5], [48, by + lift + 3]]), OUT, bw, false);
    } else if (brow === 'quiz') {
      c.line(HH([[-48, by], [-16, by - 2]]), OUT, bw);
      c.curve(HH([[14, by - 8], [32, by - 14], [48, by - 3]]), OUT, bw, false);
    } else {
      c.line(HH([[-47, by], [-16, by]]), OUT, bw);
      c.line(HH([[16, by], [47, by]]), OUT, bw);
    }

    if (ex.vein) {
      c.line(HH([[34, -48], [50, -48]]), '#E63946', 4.6 * s);
      c.line(HH([[42, -56], [42, -40]]), '#E63946', 4.6 * s);
    }
    if (ex.sweat) {
      c.poly(HH([[66, -28], [74, -8], [66, -2], [58, -8]]), '#90E0EF', ow * 0.5, OUT);
    }
    if (p.mustache) {
      c.curve(HH([[-24, 30], [0, 24], [24, 30]]), p.hairColor || OUT, 6.5 * s, false);
    }

    var mKind = ex.mouth || 'open';
    var mOpen = ex.open != null ? ex.open : 0.6;
    if (st.talk != null && st.talk > 0.02) {
      if (mKind !== 'o' && mKind !== 'yawn') mKind = 'open';
      mOpen = clamp(0.16 + 0.84 * st.talk, 0.15, 1.0);
    }
    var my = chibi ? 44 : 41;

    function drawDMouth(w, depth) {
      var top = [[-w, my - 1], [-w * 0.5, my - 3], [w * 0.5, my - 3], [w, my - 1]];
      var bot = arcPts(0, my - 1, w, depth, 0, 180, 14);
      c.poly(HH(top.concat(bot)), DARK_RED, ow * 0.82, OUT);
      if (depth > 13) c.poly(HH(ellPts(0, my + depth * 0.58, w * 0.52, depth * 0.30, 12)), TONGUE, 0);
    }

    if (mKind === 'open') {
      drawDMouth(chibi ? 19 : 23, lerp(7, 27, mOpen));
    } else if (mKind === 'grin') {
      drawDMouth(30, lerp(16, 35, mOpen));
    } else if (mKind === 'smile') {
      c.curve(HH(arcPts(0, my - 12, 23, 19, 28, 152, 10)), OUT, 4.6 * s, false);
    } else if (mKind === 'o' || mKind === 'wave-o') {
      var mp = H(0, my + 5);
      c.ell(mp[0], mp[1], (11 + 4 * mOpen) * s, (14 + 6 * mOpen) * s, DARK_RED, ow * 0.82, OUT);
    } else if (mKind === 'yawn') {
      var yp = H(0, my + 7);
      c.ell(yp[0], yp[1], 19 * s, 24 * s, DARK_RED, ow * 0.82, OUT);
    } else if (mKind === 'frown') {
      c.curve(HH(arcPts(0, my + 20, 21, 14, 205, 335, 10)), OUT, 4.6 * s, false);
    } else if (mKind === 'grit') {
      c.poly(HH([[-25, my], [25, my], [22, my + 17], [-22, my + 17]]), WHITE, ow * 0.8, OUT);
      c.line(HH([[-24, my + 8.5], [24, my + 8.5]]), OUT, 2.4 * s);
      c.line(HH([[-12, my], [-12, my + 17]]), OUT, 2.6 * s);
      c.line(HH([[0, my], [0, my + 17]]), OUT, 2.6 * s);
      c.line(HH([[12, my], [12, my + 17]]), OUT, 2.6 * s);
    } else if (mKind === 'flat-tilted') {
      c.line(HH([[-14, my + 7], [15, my + 1]]), OUT, 4.6 * s);
    } else if (mKind === 'smirk') {
      c.curve(HH([[-18, my + 3], [4, my + 9], [22, my - 5]]), OUT, 4.6 * s, false);
    } else if (mKind === 'wave') {
      var wpts = [];
      for (var wi = 0; wi <= 8; wi++) wpts.push([-20 + wi * 5, my + 5 + Math.sin(wi * 1.5) * 3.8]);
      c.line(HH(wpts), OUT, 4.4 * s);
    } else {
      c.line(HH([[-15, my + 4], [15, my + 4]]), OUT, 4.6 * s);
    }
  }

  function drawHeldProp(c, kind, wx, wy, s, flip, ow, t) {
    if (!kind) return;
    var k = String(kind).toLowerCase();
    var dir = flip >= 0 ? 1 : -1;
    if (k === 'phone') {
      c.rect(wx - 12 * s, wy - 22 * s, 24 * s, 42 * s, 6 * s, '#2B303A', ow * 0.75, OUT);
      c.rect(wx - 9 * s, wy - 17 * s, 18 * s, 31 * s, 3 * s, '#7BDFF2', 0);
    } else if (k === 'book') {
      c.rect(wx - 24 * s, wy - 18 * s, 48 * s, 36 * s, 5 * s, '#E76F51', ow * 0.75, OUT);
      c.rect(wx - 20 * s, wy - 14 * s, 40 * s, 28 * s, 3 * s, '#FFF8EE', ow * 0.5, OUT);
    } else if (k === 'pencil') {
      c.line([[wx - 18 * s * dir, wy + 12 * s], [wx + 22 * s * dir, wy - 18 * s]], '#F4A261', 8 * s);
      c.ell(wx + 24 * s * dir, wy - 20 * s, 4 * s, 4 * s, OUT, 0);
    } else if (k === 'ball') {
      c.ell(wx, wy + 4 * s, 24 * s, 24 * s, '#FF9F1C', ow * 0.8, OUT);
    } else if (k === 'cup') {
      c.rect(wx - 13 * s, wy - 18 * s, 26 * s, 34 * s, 5 * s, '#E0FBFC', ow * 0.75, OUT);
    } else if (k === 'gift') {
      c.rect(wx - 22 * s, wy - 20 * s, 44 * s, 40 * s, 6 * s, '#FF595E', ow * 0.8, OUT);
      c.line([[wx, wy - 20 * s], [wx, wy + 20 * s]], '#FFCA3A', 7 * s);
      c.line([[wx - 22 * s, wy], [wx + 22 * s, wy]], '#FFCA3A', 7 * s);
    } else if (k === 'flower') {
      c.line([[wx, wy + 22 * s], [wx, wy - 14 * s]], '#40916C', 5 * s);
      for (var bi = 0; bi < 5; bi++) {
        var ba = (bi * 72) * DEG;
        c.ell(wx + Math.cos(ba) * 11 * s, wy - 18 * s + Math.sin(ba) * 11 * s, 8 * s, 8 * s, '#FF70A6', ow * 0.55, OUT);
      }
      c.ell(wx, wy - 18 * s, 7 * s, 7 * s, '#FFD166', ow * 0.5, OUT);
    } else if (k === 'alarm') {
      var jiggle = Math.sin((t || 0) * 32) * 3 * s;
      c.ell(wx + jiggle, wy, 24 * s, 24 * s, '#FF595E', ow * 0.8, OUT);
      c.ell(wx + jiggle, wy, 18 * s, 18 * s, WHITE, ow * 0.5, OUT);
      c.line([[wx + jiggle, wy], [wx + jiggle, wy - 10 * s]], OUT, 3.5 * s);
      c.line([[wx + jiggle, wy], [wx + jiggle + 8 * s, wy + 2 * s]], OUT, 3.5 * s);
    } else if (k === 'umbrella') {
      c.line([[wx, wy + 24 * s], [wx, wy - 56 * s]], OUT, 5 * s);
      c.poly(arcPts(wx, wy - 52 * s, 48 * s, 32 * s, 180, 360, 14), '#4CC9F0', ow * 0.8, OUT);
    } else if (k === 'laptop') {
      c.rect(wx - 28 * s, wy - 22 * s, 56 * s, 34 * s, 5 * s, '#4A5568', ow * 0.75, OUT);
      c.rect(wx - 34 * s, wy + 10 * s, 68 * s, 8 * s, 4 * s, '#718096', ow * 0.75, OUT);
    } else {
      c.rect(wx - 18 * s, wy - 14 * s, 36 * s, 28 * s, 5 * s, '#FFF3B0', ow * 0.7, OUT);
    }
  }

  function drawHeadIcon(c, kind, wx, wy, s, t) {
    if (!kind) return;
    var k = String(kind).toLowerCase();
    var bob = Math.sin((t || 0) * 6.5) * 6 * s;
    var cy = wy + bob;
    var ow = 5.5 * s;

    if (k === 'exclaim') {
      c.rect(wx - 8 * s, cy - 42 * s, 16 * s, 38 * s, 7 * s, '#FF3B30', ow, OUT);
      c.ell(wx, cy + 12 * s, 8.5 * s, 8.5 * s, '#FF3B30', ow, OUT);
    } else if (k === 'question') {
      c.text('?', wx, cy - 10 * s, 68 * s, '#FF9F1C', 'center', 8 * s, OUT, 900);
    } else if (k === 'idea') {
      for (var ri = 0; ri < 5; ri++) {
        var ra = (-150 + ri * 30) * DEG;
        c.line([[wx + Math.cos(ra) * 34 * s, cy - 16 * s + Math.sin(ra) * 34 * s], [wx + Math.cos(ra) * 48 * s, cy - 16 * s + Math.sin(ra) * 48 * s]], '#FFD166', 5.2 * s);
      }
      c.ell(wx, cy - 18 * s, 24 * s, 25 * s, '#FFE066', ow, OUT);
      c.rect(wx - 11 * s, cy + 4 * s, 22 * s, 12 * s, 4 * s, '#ADB5BD', ow * 0.85, OUT);
    } else if (k === 'zzz') {
      var phase = ((t || 0) * 1.4) % 1;
      c.text('z', wx + 18 * s, cy + 8 * s - phase * 10 * s, 28 * s, '#5E60CE', 'center', 5 * s, WHITE, 900);
      c.text('Z', wx + 42 * s, cy - 18 * s - phase * 12 * s, 38 * s, '#5E60CE', 'center', 6 * s, WHITE, 900);
      c.text('Z', wx + 70 * s, cy - 48 * s - phase * 14 * s, 48 * s, '#4EA8DE', 'center', 7 * s, WHITE, 900);
    } else if (k === 'sparkle' || k === 'star') {
      c.poly([
        [wx, cy - 28 * s], [wx + 7 * s, cy - 7 * s], [wx + 28 * s, cy],
        [wx + 7 * s, cy + 7 * s], [wx, cy + 28 * s], [wx - 7 * s, cy + 7 * s],
        [wx - 28 * s, cy], [wx - 7 * s, cy - 7 * s]
      ], '#FFD166', ow * 0.85, OUT);
      c.poly([
        [wx + 36 * s, cy - 34 * s], [wx + 40 * s, cy - 22 * s], [wx + 52 * s, cy - 18 * s],
        [wx + 40 * s, cy - 14 * s], [wx + 36 * s, cy - 2 * s], [wx + 32 * s, cy - 14 * s],
        [wx + 20 * s, cy - 18 * s], [wx + 32 * s, cy - 22 * s]
      ], '#FFF3B0', ow * 0.7, OUT);
    } else if (k === 'heart') {
      c.blob([
        [wx, cy + 16 * s], [wx - 24 * s, cy - 6 * s], [wx - 14 * s, cy - 24 * s],
        [wx, cy - 12 * s], [wx + 14 * s, cy - 24 * s], [wx + 24 * s, cy - 6 * s]
      ], '#FF4D6D', ow * 0.85, OUT, 6);
    } else if (k === 'angry' || k === 'annoyed') {
      c.text('#', wx + 26 * s, cy - 8 * s, 52 * s, '#E63946', 'center', 6 * s, OUT, 900);
    } else if (k === 'sweat') {
      c.poly([[wx + 34 * s, cy - 22 * s], [wx + 46 * s, cy + 4 * s], [wx + 34 * s, cy + 14 * s], [wx + 22 * s, cy + 4 * s]], '#72EFDD', ow * 0.8, OUT);
    } else if (k === 'check') {
      c.line([[wx - 18 * s, cy - 4 * s], [wx - 4 * s, cy + 12 * s], [wx + 22 * s, cy - 18 * s]], '#2EC4B6', 10 * s);
    } else if (k === 'cross') {
      c.line([[wx - 16 * s, cy - 16 * s], [wx + 16 * s, cy + 16 * s]], '#E63946', 9 * s);
      c.line([[wx + 16 * s, cy - 16 * s], [wx - 16 * s, cy + 16 * s]], '#E63946', 9 * s);
    } else if (k === 'music') {
      c.text('♪', wx + 28 * s, cy - 10 * s, 54 * s, '#FF9F1C', 'center', 6 * s, OUT, 900);
    }
  }

  function drawCharacter(c, presetSpec, st) {
    var p = makeCharPreset(presetSpec);
    var t = Number(st && st.t) || 0;
    var s = (Number(st && st.s) || 1) * (p.scale || 1);
    var flip = (st && st.flip === -1) ? -1 : 1;
    var wx = Number(st && st.x) || 0;
    var wy = GROUND_Y + (Number(st && st.y) || 0);
    var ow = 6.2 * s;

    var ps = (st && st.poseState) ? st.poseState : evalPoseState((st && st.pose) || 'idle', t);
    var ex = EXPR[(st && st.expr) || 'happy'] || EXPR.happy;

    var stride = Number(st && st.stride) || 0;
    var walkAmp = Number(st && st.walkAmp) || 0;
    var hopY = 0;
    if (ps.legs === 'walk' || walkAmp > 0.05) {
      hopY = -Math.abs(Math.sin(stride)) * 14 * Math.max(0.4, walkAmp);
    } else if (ps.legs === 'run') {
      hopY = -Math.abs(Math.sin(stride)) * 26 * Math.max(0.5, walkAmp || 1);
    }

    var baseY = wy + (ps.sit + hopY) * s;
    var rotBody = ps.lie ? (-90 * DEG) : ((ps.lean * flip) * DEG * 0.6);

    function B(lx, ly) {
      var xx = lx * flip * s;
      var yy = ly * s;
      if (Math.abs(rotBody) > 1e-4) {
        var co = Math.cos(rotBody);
        var si = Math.sin(rotBody);
        var pivY = HIP_Y * s;
        var dy = yy - pivY;
        return [wx + (xx * co - dy * si), baseY + pivY + (xx * si + dy * co)];
      }
      return [wx + xx, baseY + yy];
    }

    function BB(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) out.push(B(list[i][0], list[i][1]));
      return out;
    }

    var headTilt = ((ps.tilt || 0) * flip) * DEG;
    var headCenter = B(0, HEAD_Y);

    function H(hx, hy) {
      var xx = hx * flip * s;
      var yy = hy * s;
      var ang = rotBody + headTilt;
      if (Math.abs(ang) > 1e-4) {
        var co = Math.cos(ang);
        var si = Math.sin(ang);
        return [headCenter[0] + xx * co - yy * si, headCenter[1] + xx * si + yy * co];
      }
      return [headCenter[0] + xx, headCenter[1] + yy];
    }

    function HH(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) out.push(H(list[i][0], list[i][1]));
      return out;
    }

    if (!ps.lie && st.shadow !== false) {
      c.ell(wx, wy + 5 * s, 56 * s, 11 * s, 'rgba(24, 26, 32, 0.14)', 0);
    }

    if (st && st.backpack) {
      c.poly(BB([[-48, -184], [-22, -188], [-22, -104], [-50, -108]]), '#E76F51', ow * 0.85, OUT);
    }

    drawHairBack(c, p, H, HH, s, ow);

    var legCol = p.bottom === 'skirt' ? p.skin : (p.bottomColor || '#242830');
    var legW = p.bottom === 'skirt' ? 13 : 20;
    var lHip = [-20, HIP_Y + 4];
    var rHip = [20, HIP_Y + 4];
    var lFoot = [-23, FOOT_Y - 8];
    var rFoot = [23, FOOT_Y - 8];

    if (ps.legs === 'wide') {
      lFoot = [-36, FOOT_Y - 8];
      rFoot = [36, FOOT_Y - 8];
    } else if (ps.legs === 'sit') {
      lFoot = [-34, HIP_Y + 52];
      rFoot = [34, HIP_Y + 52];
    } else if (ps.legs === 'jump') {
      lFoot = [-34, FOOT_Y - 26];
      rFoot = [34, FOOT_Y - 18];
    } else if (ps.legs === 'walk' || ps.legs === 'run' || walkAmp > 0.05) {
      var sw = (ps.legs === 'run' ? 42 : 28) * Math.max(0.4, walkAmp || 1);
      var liftL = Math.max(0, -Math.cos(stride)) * 18;
      var liftR = Math.max(0, Math.cos(stride)) * 18;
      lFoot = [-16 + Math.sin(stride) * sw, FOOT_Y - 8 - liftL];
      rFoot = [16 - Math.sin(stride) * sw, FOOT_Y - 8 - liftR];
    }

    c.tube(BB([lHip, lFoot]), legCol, legW * s, ow * 0.85, OUT);
    c.tube(BB([rHip, rFoot]), legCol, legW * s, ow * 0.85, OUT);

    var wMul = p.bodyWidth || 1.0;
    if (p.bottom === 'skirt') {
      c.poly(BB([[-36 * wMul, HIP_Y - 8], [36 * wMul, HIP_Y - 8], [52 * wMul, HIP_Y + 44], [-52 * wMul, HIP_Y + 44]]), p.bottomColor || '#23262E', ow * 0.9, OUT);
    } else {
      c.poly(BB([[-37 * wMul, HIP_Y - 12], [37 * wMul, HIP_Y - 12], [35 * wMul, HIP_Y + 18], [-35 * wMul, HIP_Y + 18]]), p.bottomColor || '#242830', ow * 0.9, OUT);
    }

    var shoePair = [[lFoot, -1], [rFoot, 1]];
    for (var si = 0; si < 2; si++) {
      var fp = shoePair[si][0];
      var sdir = shoePair[si][1];
      var sp = B(fp[0] + sdir * 4, fp[1] + 4);
      c.ell(sp[0], sp[1], 20 * s, 11 * s, p.shoeColor || '#1D2129', ow * 0.82, OUT);
      if (p.shoes === 'sneaker') {
        var toe = B(fp[0] + sdir * 13, fp[1] + 5);
        var heel = B(fp[0] - sdir * 7, fp[1] + 5);
        c.ell(toe[0], toe[1], 6.5 * s, 5.2 * s, WHITE, 0);
        c.ell(heel[0], heel[1], 4.5 * s, 4.0 * s, WHITE, 0);
      }
    }

    function drawArmSide(isRight) {
      var sh = isRight ? [37 * wMul, SHOULDER_Y + 10] : [-37 * wMul, SHOULDER_Y + 10];
      var target = isRight ? ps.R : ps.L;
      var elbow = elbowPoint(sh[0], sh[1], target[0], target[1], target[2] || (isRight ? -14 : 14));
      var armCol = p.shortSleeves ? p.skin : p.shirt;
      if (p.shortSleeves) {
        var capPos = B(sh[0] + (isRight ? 5 : -5), sh[1] + 6);
        c.ell(capPos[0], capPos[1], 14 * s, 17 * s, p.shirt, ow * 0.82, OUT);
      }
      c.tube(BB([sh, elbow, [target[0], target[1]]]), armCol, 13 * s, ow * 0.82, OUT);
      var handPos = B(target[0], target[1]);
      c.ell(handPos[0], handPos[1], 13.5 * s, 13.5 * s, p.skin, ow * 0.82, OUT);
      if ((isRight && ps.thumbR) || (isRight && ps.pointR) || (!isRight && ps.pointL)) {
        var th = B(target[0] + (isRight ? 4 : -4), target[1] - 15);
        c.ell(th[0], th[1], 6 * s, 9 * s, p.skin, ow * 0.72, OUT);
      }
      if (isRight && st && st.prop) drawHeldProp(c, st.prop, handPos[0], handPos[1], s, flip, ow, t);
    }

    var leftHigh = ps.L[1] < SHOULDER_Y - 52;
    var rightHigh = ps.R[1] < SHOULDER_Y - 52;
    if (!leftHigh) drawArmSide(false);

    c.poly(BB([[-13, NECK_Y - 6], [13, NECK_Y - 6], [14, SHOULDER_Y + 8], [-14, SHOULDER_Y + 8]]), p.skin, ow * 0.8, OUT);
    c.blob(BB([[-40 * wMul, SHOULDER_Y], [40 * wMul, SHOULDER_Y], [37 * wMul, HIP_Y - 4], [-37 * wMul, HIP_Y - 4]]), p.shirt, ow * 0.9, OUT, 5);

    if (p.blazer) {
      var innerCol = p.innerShirt || WHITE;
      c.poly(BB([[-18 * wMul, SHOULDER_Y + 3], [18 * wMul, SHOULDER_Y + 3], [12 * wMul, HIP_Y - 8], [-12 * wMul, HIP_Y - 8]]), innerCol, ow * 0.65, OUT);
      for (var sg = -1; sg <= 1; sg += 2) {
        c.poly(BB([
          [sg * 15 * wMul, SHOULDER_Y + 3],
          [sg * 32 * wMul, SHOULDER_Y + 13],
          [sg * 27 * wMul, SHOULDER_Y + 32],
          [sg * 33 * wMul, SHOULDER_Y + 40],
          [sg * 12 * wMul, HIP_Y - 12],
          [sg * 13 * wMul, SHOULDER_Y + 24]
        ]), '#EAD0AC', ow * 0.72, OUT);
      }
    } else if (p.whiteCollar) {
      c.poly(BB([[-16, SHOULDER_Y + 2], [16, SHOULDER_Y + 2], [10, SHOULDER_Y + 42], [-10, SHOULDER_Y + 42]]), WHITE, ow * 0.7, OUT);
    }
    if (p.tie === 'bowtie') {
      var dy = SHOULDER_Y + 8;
      c.poly(BB([[-16, dy - 7], [0, dy], [-16, dy + 7]]), p.tieColor || OUT, ow * 0.65, OUT);
      c.poly(BB([[16, dy - 7], [0, dy], [16, dy + 7]]), p.tieColor || OUT, ow * 0.65, OUT);
      var knot = B(0, dy);
      c.ell(knot[0], knot[1], 4.5 * s, 4.5 * s, p.tieColor || OUT, ow * 0.5, OUT);
    } else if (p.tie === 'long') {
      c.poly(BB([[-6, SHOULDER_Y + 4], [6, SHOULDER_Y + 4], [9, HIP_Y - 18], [0, HIP_Y - 8], [-9, HIP_Y - 18]]), p.tieColor || '#3B6EA8', ow * 0.65, OUT);
    }

    if (!rightHigh) drawArmSide(true);

    if (p.hair !== 'hijab') {
      var earL = H(-HEAD_R + 2, 4);
      var earR = H(HEAD_R - 2, 4);
      c.ell(earL[0], earL[1], 13 * s, 16 * s, p.skin, ow * 0.8, OUT);
      c.ell(earR[0], earR[1], 13 * s, 16 * s, p.skin, ow * 0.8, OUT);
    }
    c.ell(headCenter[0], headCenter[1], HEAD_R * s, (HEAD_R - 3) * s, p.skin, ow * 0.92, OUT);

    drawFace(c, p, ex, st || {}, H, HH, s, ow, flip);
    drawHairFront(c, p, H, HH, s, ow);

    if (leftHigh) drawArmSide(false);
    if (rightHigh) drawArmSide(true);

    var topHeadY = headCenter[1] - (p.hair === 'afro' ? 142 : 112) * s;
    if (st && st.emote) {
      drawHeadIcon(c, st.emote, headCenter[0], topHeadY - 18 * s, s, t);
    }

    return {
      head: headCenter,
      center: B(0, -145),
      topY: topHeadY,
      bottomY: baseY,
      facing: flip
    };
  }

  root.StickmanRig = {
    version: 1,
    GROUND_Y: GROUND_Y,
    HEAD_Y: HEAD_Y,
    HEAD_R: HEAD_R,
    PRESETS: PRESETS,
    EXPR: EXPR,
    POSES: POSES,
    WorldCanvas: WorldCanvas,
    makeCharPreset: makeCharPreset,
    evalPoseState: evalPoseState,
    blendPoseStates: blendPoseStates,
    blinkAt: blinkAt,
    drawCharacter: drawCharacter,
    drawHeldProp: drawHeldProp,
    drawHeadIcon: drawHeadIcon
  };
})(typeof window !== 'undefined' ? window : globalThis);
