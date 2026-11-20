/**
 * Aetheria Shared Declarative Camera Rig (`/script/story-camera.js`, Camera API v1).
 *
 * Single deterministic camera layer shared by 2D Canvas and 3D Three.js declarative skills:
 * - Pure seeded RNG (mulberry32 + FNV-1a hash; strictly deterministic, no wall-clock or random state)
 * - Data-driven move library (>= 10 moves) + 3 cameraStyle presets + cobalt legacyPresets
 * - Deterministic anti-repeat shot move director
 * - Pure framing guard (measured / clamped / unmeasured)
 * - Unified 2D Canvas (`apply2D`) & 3D Three.js (`applyTo3D`) adapters + `window.__cameraReport`
 */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(x) {
    var c = clamp(x, 0, 1);
    return 1 - Math.pow(1 - c, 3);
  }

  function easeInOutCubic(x) {
    var c = clamp(x, 0, 1);
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
  }

  function easeOutExpo(x) {
    var c = clamp(x, 0, 1);
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  }

  function easeInOutExpo(x) {
    var c = clamp(x, 0, 1);
    if (c === 0) return 0;
    if (c === 1) return 1;
    return c < 0.5 ? Math.pow(2, 20 * c - 10) * 0.5 : (2 - Math.pow(2, -20 * c + 10)) * 0.5;
  }

  function evalCurve(curve, u) {
    var c = clamp(u, 0, 1);
    if (curve === 'linear') return c;
    if (curve === 'ease-in-out') return easeInOutCubic(c);
    if (curve === 'whip' || curve === 'whip-out') return easeOutExpo(c);
    if (curve === 'whip-inout') return easeInOutExpo(c);
    return easeOutCubic(c);
  }

  function hashSeed() {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < arguments.length; i++) {
      var s = String(arguments[i] === undefined || arguments[i] === null ? '' : arguments[i]);
      for (var j = 0; j < s.length; j++) {
        h ^= s.charCodeAt(j);
        h = Math.imul(h, 16777619) >>> 0;
      }
      h ^= 0xff;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function createRng(seed) {
    var a = (Number(seed) >>> 0) || 1;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var IDENTITY_RIG = Object.freeze({
    dolly: 1,
    zoom: 1,
    truckX: 0,
    truckY: 0,
    panX: 0,
    panY: 0,
    orbitAz: 0,
    tiltEl: 0,
    roll: 0,
    rollRad: 0,
    pivotX: 0.5,
    pivotY: 0.5,
    blur: 0,
  });

  function makeIdentityRig() {
    return {
      dolly: 1,
      zoom: 1,
      truckX: 0,
      truckY: 0,
      panX: 0,
      panY: 0,
      orbitAz: 0,
      tiltEl: 0,
      roll: 0,
      rollRad: 0,
      pivotX: 0.5,
      pivotY: 0.5,
      blur: 0,
    };
  }

  var CAMERA_STYLES = {
    calm: {
      allowedMoves: ['push-in', 'pull-out', 'pan', 'tilt', 'truck', 'orbit', 'crane', 'hold'],
      intensityRange: [0.3, 0.55],
      defaultSpan: 'shot',
      defaultCurve: 'ease-in-out',
    },
    kinetic: {
      allowedMoves: ['push-in', 'pull-out', 'pan', 'tilt', 'truck', 'orbit', 'crane', 'handheld', 'whip', 'rack-focus-in'],
      intensityRange: [0.65, 1.0],
      defaultSpan: 'burst',
      defaultCurve: 'whip',
    },
    editorial: {
      allowedMoves: ['push-in', 'pull-out', 'pan', 'tilt', 'truck', 'orbit', 'crane', 'rack-focus-in', 'handheld'],
      intensityRange: [0.45, 0.78],
      defaultSpan: 'shot',
      defaultCurve: 'ease-out',
    },
  };

  // Data-driven move library (>= 11 moves). Offsets are normalized:
  // dolly (1 = base, <1 = push in / zoom in), truckX/truckY (fraction of W/H), orbitAz/tiltEl/roll (deg).
  var MOVES = {
    hold: {
      dirs: ['none'],
      defaultSpan: 'shot',
      defaultCurve: 'linear',
      dolly: [0, 0, 0, 0],
      truckX: [0, 0],
      truckY: [0, 0],
      orbitAz: [0, 0],
      tiltEl: [0, 0],
      roll: [0, 0],
      blur: [0, 0],
    },
    'push-in': {
      dirs: ['in'],
      defaultSpan: 'shot',
      defaultCurve: 'ease-out',
      dolly: [0.02, 0.06, -0.09, -0.17],
      truckX: [-0.015, 0.015],
      truckY: [-0.015, 0.015],
      orbitAz: [-4, 4],
      tiltEl: [-2, 3],
      roll: [-1.0, 1.0],
      blur: [0.6, 0.4],
    },
    'pull-out': {
      dirs: ['out'],
      defaultSpan: 'shot',
      defaultCurve: 'ease-out',
      dolly: [-0.14, -0.08, 0.02, 0.06],
      truckX: [-0.015, 0.015],
      truckY: [-0.015, 0.015],
      orbitAz: [-4, 4],
      tiltEl: [-2, 2],
      roll: [-1.2, 1.2],
      blur: [0.8, 0.45],
    },
    pan: {
      dirs: ['left', 'right'],
      defaultSpan: 'shot',
      defaultCurve: 'ease-in-out',
      dolly: [-0.05, -0.02, -0.03, -0.01],
      truckX: [0.045, 0.085],
      truckY: [-0.01, 0.01],
      orbitAz: [7, 15],
      tiltEl: [-1.5, 1.5],
      roll: [0.8, 2.0],
      blur: [0.8, 0.55],
    },
    tilt: {
      dirs: ['up', 'down'],
      defaultSpan: 'shot',
      defaultCurve: 'ease-out',
      dolly: [-0.05, -0.02, -0.08, -0.04],
      truckX: [-0.012, 0.012],
      truckY: [0.035, 0.075],
      orbitAz: [-3, 3],
      tiltEl: [5, 11],
      roll: [-1.8, 1.8],
      blur: [0.7, 0.5],
    },
    truck: {
      dirs: ['left', 'right'],
      defaultSpan: 'shot',
      defaultCurve: 'linear',
      dolly: [-0.04, -0.01, -0.04, -0.01],
      truckX: [0.04, 0.08],
      truckY: [-0.008, 0.008],
      orbitAz: [5, 11],
      tiltEl: [-1, 1],
      roll: [0.4, 1.2],
      blur: [0.4, 0.3],
    },
    orbit: {
      dirs: ['left', 'right'],
      defaultSpan: 'shot',
      defaultCurve: 'ease-in-out',
      dolly: [-0.04, 0.02, -0.08, 0.0],
      truckX: [0.03, 0.06],
      truckY: [-0.012, 0.012],
      orbitAz: [12, 24],
      tiltEl: [2, 6],
      roll: [1.0, 2.4],
      blur: [0.5, 0.35],
    },
    crane: {
      dirs: ['up', 'down'],
      defaultSpan: 'shot',
      defaultCurve: 'ease-in-out',
      dolly: [-0.02, 0.04, -0.09, -0.03],
      truckX: [-0.015, 0.015],
      truckY: [0.04, 0.08],
      orbitAz: [-5, 5],
      tiltEl: [7, 14],
      roll: [-1.2, 1.2],
      blur: [0.5, 0.35],
    },
    handheld: {
      dirs: ['none'],
      defaultSpan: 'shot',
      defaultCurve: 'linear',
      dolly: [-0.03, -0.01, -0.05, -0.02],
      truckX: [0.014, 0.028],
      truckY: [0.012, 0.024],
      orbitAz: [2.2, 4.8],
      tiltEl: [1.4, 3.2],
      roll: [0.7, 1.6],
      blur: [0, 0],
      handheld: true,
    },
    whip: {
      dirs: ['left', 'right', 'up', 'down'],
      defaultSpan: 'burst',
      defaultCurve: 'whip',
      dolly: [-0.08, -0.04, -0.02, 0.0],
      truckX: [0.06, 0.11],
      truckY: [0.045, 0.085],
      orbitAz: [10, 18],
      tiltEl: [5, 10],
      roll: [1.6, 3.2],
      blur: [2.2, 1.6],
    },
    'rack-focus-in': {
      dirs: ['in'],
      defaultSpan: 'burst',
      defaultCurve: 'whip',
      dolly: [-0.14, -0.09, 0.0, 0.0],
      truckX: [-0.008, 0.008],
      truckY: [-0.008, 0.008],
      orbitAz: [-2, 2],
      tiltEl: [-1, 1],
      roll: [-0.6, 0.6],
      blur: [4.5, 2.4],
    },
  };

  // Exact Cobalt legacy preset table (guarantees <= 1e-6 parity with cobalt-kit.js CAMERA_PRESETS).
  var LEGACY_PRESETS = {
    static: { zoomFrom: 1.0, zoomTo: 1.0, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, curve: 'whip-out', velocityBlur: 0 },
    'dolly-in': { zoomFrom: 0.92, zoomTo: 1.18, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 14, panYTo: -8, rollFromDeg: 0, rollToDeg: 0, curve: 'whip-out', velocityBlur: 1.2 },
    'macro-pullback': { zoomFrom: 3.1, zoomTo: 1.0, pivotX: 0.28, pivotY: 0.34, panXFrom: -24, panXTo: 0, panYFrom: 18, panYTo: 0, rollFromDeg: 2.8, rollToDeg: 0, curve: 'whip-out', velocityBlur: 4.2 },
    'macro-zoom-in': { zoomFrom: 1.0, zoomTo: 2.35, pivotX: 0.32, pivotY: 0.45, panXFrom: 0, panXTo: 20, panYFrom: 0, panYTo: -16, rollFromDeg: 0, rollToDeg: -1.8, curve: 'whip-inout', velocityBlur: 3.8 },
    'pan-sweep': { zoomFrom: 1.16, zoomTo: 1.02, pivotX: 0.5, pivotY: 0.5, panXFrom: 120, panXTo: -95, panYFrom: 0, panYTo: 0, rollFromDeg: 1.8, rollToDeg: -1.4, curve: 'whip-out', velocityBlur: 2.6 },
    'tilt-push': { zoomFrom: 0.88, zoomTo: 1.42, pivotX: 0.55, pivotY: 0.55, panXFrom: -20, panXTo: 10, panYFrom: 52, panYTo: -22, rollFromDeg: -4.5, rollToDeg: 0.6, curve: 'whip-out', velocityBlur: 3.0 },
    'rack-focus-in': { zoomFrom: 1.32, zoomTo: 1.0, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, curve: 'whip-out', velocityBlur: 5.5 },
  };

  function hasLegacyNumericOverrides(cam) {
    if (!cam || typeof cam !== 'object') return false;
    var keys = ['zoomFrom', 'zoomTo', 'panXFrom', 'panXTo', 'panYFrom', 'panYTo', 'rollFromDeg', 'rollToDeg', 'velocityBlur', 'blurFrom', 'blurTo'];
    for (var i = 0; i < keys.length; i++) {
      if (cam[keys[i]] !== undefined) return true;
    }
    return false;
  }

  function isLegacyCobaltShot(shot) {
    if (!shot || typeof shot !== 'object') return false;
    var cam = shot.camera && typeof shot.camera === 'object' ? shot.camera : null;
    if (cam && cam.move) return false;
    if (cam && cam.preset && LEGACY_PRESETS[cam.preset]) return true;
    if (shot.cameraPreset && LEGACY_PRESETS[shot.cameraPreset]) return true;
    if (hasLegacyNumericOverrides(cam)) return true;
    if (shot.whipExit) return true;
    return false;
  }

  function resolveLegacyPreset(shot, localTime, dur, W, H) {
    var cam = shot && shot.camera && typeof shot.camera === 'object' ? shot.camera : {};
    var presetName = cam.preset || (shot && shot.cameraPreset) || 'static';
    var base = LEGACY_PRESETS[presetName] || LEGACY_PRESETS.static;
    var curve = cam.curve || base.curve || 'whip-out';
    var rawDur = cam.moveDuration === 'shot' ? dur : Number(cam.moveDuration);
    var span = Math.max(0.28, rawDur || Math.min(dur * 0.68, 0.95));
    var u = clamp(localTime / span, 0, 1);
    var uPrev = clamp((localTime - 0.033) / span, 0, 1);
    var p = evalCurve(curve, u);
    var pPrev = evalCurve(curve, uPrev);
    var vel = Math.abs(p - pPrev) / 0.033;

    var z0 = cam.zoomFrom !== undefined ? cam.zoomFrom : base.zoomFrom;
    var z1 = cam.zoomTo !== undefined ? cam.zoomTo : base.zoomTo;
    var px0 = cam.panXFrom !== undefined ? cam.panXFrom : base.panXFrom;
    var px1 = cam.panXTo !== undefined ? cam.panXTo : base.panXTo;
    var py0 = cam.panYFrom !== undefined ? cam.panYFrom : base.panYFrom;
    var py1 = cam.panYTo !== undefined ? cam.panYTo : base.panYTo;
    var r0 = cam.rollFromDeg !== undefined ? cam.rollFromDeg : base.rollFromDeg;
    var r1 = cam.rollToDeg !== undefined ? cam.rollToDeg : base.rollToDeg;
    var pivX = cam.pivotX !== undefined ? cam.pivotX : (base.pivotX !== undefined ? base.pivotX : 0.5);
    var pivY = cam.pivotY !== undefined ? cam.pivotY : (base.pivotY !== undefined ? base.pivotY : 0.5);
    var vBlurScale = cam.velocityBlur !== undefined ? cam.velocityBlur : (base.velocityBlur || 0);

    var exitPanY = 0;
    var exitBlur = 0;
    if (shot && shot.whipExit && localTime > dur - 0.24) {
      var eu = clamp((localTime - (dur - 0.28)) / 0.28, 0, 1);
      var ep = eu * eu * eu;
      exitPanY = -ep * 300;
      exitBlur = ep * 14.0;
    }

    var manualBlur = 0;
    if (cam.blurFrom !== undefined || cam.blurTo !== undefined) {
      var b0 = cam.blurFrom !== undefined ? cam.blurFrom : 0;
      var b1 = cam.blurTo !== undefined ? cam.blurTo : 0;
      manualBlur = b0 + (b1 - b0) * easeOutExpo(clamp(localTime / 0.35, 0, 1));
    }

    var enterMotionBlur =
      Math.abs(z1 - z0) > 0.02 || Math.abs(px1 - px0) > 4 || Math.abs(py1 - py0) > 4
        ? (1 - easeOutCubic(clamp(localTime / 0.26, 0, 1))) * 4.5
        : 0;
    var autoBlur = clamp(vel * 0.95 * vBlurScale, 0, 14.0);

    var zoom = lerp(z0, z1, p);
    var panX = lerp(px0, px1, p);
    var panY = lerp(py0, py1, p) + exitPanY;
    var roll = lerp(r0, r1, p);
    var safeW = Math.max(1, Number(W) || 1280);
    var safeH = Math.max(1, Number(H) || 720);

    return {
      dolly: zoom > 1e-4 ? 1 / zoom : 1,
      zoom: zoom,
      truckX: panX / safeW,
      truckY: panY / safeH,
      panX: panX,
      panY: panY,
      orbitAz: 0,
      tiltEl: 0,
      roll: roll,
      rollRad: roll * DEG,
      pivotX: pivX,
      pivotY: pivY,
      blur: Math.max(manualBlur, autoBlur, exitBlur, enterMotionBlur),
    };
  }

  function pickDir(moveSpec, requestedDir, rng, prevDir) {
    var dirs = moveSpec.dirs || ['none'];
    if (requestedDir && requestedDir !== 'auto' && dirs.indexOf(requestedDir) !== -1) {
      return requestedDir;
    }
    if (dirs.length === 1) return dirs[0];
    var candidates = prevDir && prevDir !== 'none'
      ? dirs.filter(function (d) { return d !== prevDir; })
      : dirs;
    if (!candidates.length) candidates = dirs;
    return candidates[Math.floor(rng() * candidates.length) % candidates.length];
  }

  /**
   * Deterministically plans camera move, direction, seed, and intensity for every shot in `story`.
   * Pure function of `(story.seed, story.cameraStyle, story.shots)` — independent of render order.
   */
  function planStoryMoves(story) {
    var s = story || {};
    var shots = Array.isArray(s.shots) ? s.shots : [];
    var rootSeed = Number(s.seed) | 0;
    var rootStyleName = s.cameraStyle && CAMERA_STYLES[s.cameraStyle] ? s.cameraStyle : null;
    var plans = {};
    var prev = null;

    for (var i = 0; i < shots.length; i++) {
      var sh = shots[i] || {};
      var sid = String(sh.id || ('shot' + (i + 1)));
      var cam = sh.camera && typeof sh.camera === 'object' ? sh.camera : null;
      var shotSeed = hashSeed(rootSeed, sid, 'camera', cam && cam.seed !== undefined ? Number(cam.seed) | 0 : 0);
      var rng = createRng(shotSeed);

      // Opt-in D1: if neither root cameraStyle nor shot.camera/cameraPreset/whipExit exists -> inactive identity
      var legacyMode = isLegacyCobaltShot(sh);
      var explicitMove = cam && cam.move && MOVES[cam.move] ? cam.move : null;
      var styleName = (cam && cam.style && CAMERA_STYLES[cam.style]) ? cam.style : rootStyleName;
      var active = Boolean(explicitMove || legacyMode || styleName);

      if (!active) {
        plans[sid] = {
          active: false,
          mode: 'none',
          move: 'none',
          dir: 'none',
          seed: shotSeed,
          intensity: 0,
          repeatOfPrevious: false,
        };
        prev = null;
        continue;
      }

      if (legacyMode && !explicitMove) {
        var presetName = (cam && cam.preset) || sh.cameraPreset || 'static';
        var repLegacy = Boolean(prev && prev.move === presetName && presetName !== 'static');
        plans[sid] = {
          active: true,
          mode: 'legacy',
          move: presetName,
          dir: 'none',
          seed: shotSeed,
          intensity: 1,
          repeatOfPrevious: repLegacy,
        };
        prev = plans[sid];
        continue;
      }

      var styleDef = CAMERA_STYLES[styleName || 'editorial'];
      var chosenMove = explicitMove;
      if (!chosenMove) {
        var allowed = styleDef.allowedMoves.slice();
        var filtered = prev
          ? allowed.filter(function (m) {
              if (m === prev.move) return false;
              var spec = MOVES[m];
              if (spec && spec.dirs.length === 1 && spec.dirs[0] !== 'none' && spec.dirs[0] === prev.dir) {
                return false;
              }
              return true;
            })
          : allowed;
        if (!filtered.length) filtered = allowed;
        chosenMove = filtered[Math.floor(rng() * filtered.length) % filtered.length];
      }

      var spec = MOVES[chosenMove] || MOVES.hold;
      var dir = pickDir(spec, cam && cam.dir, rng, prev ? prev.dir : null);
      var intensity =
        cam && cam.intensity !== undefined && Number.isFinite(Number(cam.intensity))
          ? clamp(Number(cam.intensity), 0, 1)
          : lerp(styleDef.intensityRange[0], styleDef.intensityRange[1], rng());
      intensity = Math.round(intensity * 1000) / 1000;

      // Sample deterministic per-shot parameters from RNG
      var params = {
        dollyFrom: lerp(spec.dolly[0], spec.dolly[1], rng()),
        dollyTo: lerp(spec.dolly[2], spec.dolly[3], rng()),
        txAmp: lerp(spec.truckX[0], spec.truckX[1], rng()),
        tyAmp: lerp(spec.truckY[0], spec.truckY[1], rng()),
        azAmp: lerp(spec.orbitAz[0], spec.orbitAz[1], rng()),
        elAmp: lerp(spec.tiltEl[0], spec.tiltEl[1], rng()),
        rollAmp: lerp(spec.roll[0], spec.roll[1], rng()),
        pivotX: cam && cam.pivotX !== undefined ? clamp(Number(cam.pivotX), 0.1, 0.9) : lerp(0.42, 0.58, rng()),
        pivotY: cam && cam.pivotY !== undefined ? clamp(Number(cam.pivotY), 0.1, 0.9) : lerp(0.42, 0.58, rng()),
        phaseA: rng() * Math.PI * 2,
        phaseB: rng() * Math.PI * 2,
        phaseC: rng() * Math.PI * 2,
        curve: (cam && cam.curve) || spec.defaultCurve || styleDef.defaultCurve,
        spanMode: (cam && cam.moveDuration !== undefined) ? cam.moveDuration : (spec.defaultSpan || styleDef.defaultSpan),
      };

      var repeatOfPrev = Boolean(
        prev &&
        prev.active &&
        chosenMove !== 'hold' &&
        (chosenMove === prev.move || (dir !== 'none' && dir === prev.dir))
      );

      plans[sid] = {
        active: true,
        mode: 'rig',
        move: chosenMove,
        dir: dir,
        seed: shotSeed,
        intensity: intensity,
        params: params,
        repeatOfPrevious: repeatOfPrev,
      };
      prev = plans[sid];
    }

    return plans;
  }

  function evaluateMoveRig(plan, localTime, dur, W, H, intensityScale) {
    var scale = clamp(intensityScale === undefined ? 1 : intensityScale, 0, 1);
    var eff = (plan.intensity || 0) * scale;
    if (!plan.active || eff <= 1e-6 || plan.move === 'hold') {
      return makeIdentityRig();
    }

    var safeW = Math.max(1, Number(W) || 1280);
    var safeH = Math.max(1, Number(H) || 720);
    var p = plan.params;
    var spec = MOVES[plan.move] || MOVES.hold;

    var span;
    if (p.spanMode === 'shot') span = Math.max(0.2, dur);
    else if (p.spanMode === 'burst') span = Math.max(0.28, Math.min(dur * 0.65, 0.95));
    else if (Number.isFinite(Number(p.spanMode)) && Number(p.spanMode) >= 0.1) span = Number(p.spanMode);
    else span = Math.max(0.2, dur);

    var u = clamp(localTime / span, 0, 1);
    var uPrev = clamp((localTime - 0.033) / span, 0, 1);
    var k = evalCurve(p.curve, u);
    var kPrev = evalCurve(p.curve, uPrev);
    var vel = Math.abs(k - kPrev) / 0.033;

    var signX = plan.dir === 'left' ? -1 : plan.dir === 'right' ? 1 : (p.txAmp < 0 ? -1 : 1);
    var signY = plan.dir === 'up' ? -1 : plan.dir === 'down' ? 1 : (p.tyAmp < 0 ? -1 : 1);

    var dollyOff;
    var tx;
    var ty;
    var az;
    var el;
    var roll;

    if (spec.handheld) {
      var tau = localTime;
      var wx =
        Math.sin(tau * 1.45 + p.phaseA) * 0.55 +
        Math.sin(tau * 2.7 + p.phaseB) * 0.3 +
        Math.sin(tau * 4.1 + p.phaseC) * 0.15;
      var wy =
        Math.cos(tau * 1.2 + p.phaseB) * 0.55 +
        Math.sin(tau * 2.35 + p.phaseC) * 0.3 +
        Math.cos(tau * 3.8 + p.phaseA) * 0.15;
      var wr = Math.sin(tau * 1.1 + p.phaseC) * 0.65 + Math.cos(tau * 2.1 + p.phaseA) * 0.35;
      dollyOff = lerp(p.dollyFrom, p.dollyTo, k) * eff;
      tx = wx * Math.abs(p.txAmp) * eff;
      ty = wy * Math.abs(p.tyAmp) * eff;
      az = wx * Math.abs(p.azAmp) * eff;
      el = wy * Math.abs(p.elAmp) * eff;
      roll = wr * Math.abs(p.rollAmp) * eff;
    } else {
      dollyOff = lerp(p.dollyFrom, p.dollyTo, k) * eff;
      var centered = (k - 0.5) * 2;
      tx = centered * Math.abs(p.txAmp) * signX * eff;
      ty = centered * Math.abs(p.tyAmp) * signY * eff;
      az = centered * Math.abs(p.azAmp) * signX * eff;
      el = centered * Math.abs(p.elAmp) * signY * eff;
      roll = centered * Math.abs(p.rollAmp) * signX * eff;
    }

    var dolly = clamp(1 + dollyOff, 0.45, 1.85);
    var zoom = 1 / dolly;
    var enterBlur = spec.blur[0] * eff * (1 - easeOutCubic(clamp(localTime / 0.28, 0, 1)));
    var velBlur = clamp(vel * spec.blur[1] * eff, 0, 12);

    return {
      dolly: dolly,
      zoom: zoom,
      truckX: tx,
      truckY: ty,
      panX: tx * safeW,
      panY: ty * safeH,
      orbitAz: az,
      tiltEl: el,
      roll: roll,
      rollRad: roll * DEG,
      pivotX: p.pivotX,
      pivotY: p.pivotY,
      blur: Math.max(enterBlur, velBlur),
    };
  }

  function projectBox2D(box, rig, W, H) {
    var pvx = W * rig.pivotX;
    var pvy = H * rig.pivotY;
    var c = Math.cos(rig.rollRad);
    var s = Math.sin(rig.rollRad);
    var corners = [
      [box.minX, box.minY],
      [box.maxX, box.minY],
      [box.maxX, box.maxY],
      [box.minX, box.maxY],
    ];
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < 4; i++) {
      var dx = (corners[i][0] - pvx) * rig.zoom;
      var dy = (corners[i][1] - pvy) * rig.zoom;
      var rx = dx * c - dy * s + pvx + rig.panX;
      var ry = dx * s + dy * c + pvy + rig.panY;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    return {
      minX: Math.round(minX * 10) / 10,
      minY: Math.round(minY * 10) / 10,
      maxX: Math.round(maxX * 10) / 10,
      maxY: Math.round(maxY * 10) / 10,
      width: Math.round((maxX - minX) * 10) / 10,
      height: Math.round((maxY - minY) * 10) / 10,
    };
  }

  function boxInsideSafe(box, safe) {
    if (!box || !safe) return true;
    var minX = safe.minX !== undefined ? safe.minX : safe.x;
    var maxX = safe.maxX !== undefined ? safe.maxX : safe.x + safe.w;
    var minY = safe.minY !== undefined ? safe.minY : safe.y;
    var maxY = safe.maxY !== undefined ? safe.maxY : safe.y + safe.h;
    return box.minX >= minX && box.maxX <= maxX && box.minY >= minY && box.maxY <= maxY;
  }

  function clampRigByLimits(rig, limits, W, H) {
    if (!limits || typeof limits !== 'object') return rig;
    var safeW = Math.max(1, Number(W) || 1280);
    var safeH = Math.max(1, Number(H) || 720);
    var maxZoom = Number(limits.maxZoom) > 1 ? Number(limits.maxZoom) : 1.35;
    var minZoom = Number(limits.minZoom) > 0 && Number(limits.minZoom) < 1 ? Number(limits.minZoom) : 1 / maxZoom;
    var maxPan = Number(limits.maxPan) > 0 ? Number(limits.maxPan) : 0.08;
    var maxRoll = Number(limits.maxRollDeg) >= 0 ? Number(limits.maxRollDeg) : 4;

    var zoom = clamp(rig.zoom, minZoom, maxZoom);
    var tx = clamp(rig.truckX, -maxPan, maxPan);
    var ty = clamp(rig.truckY, -maxPan, maxPan);
    var roll = clamp(rig.roll, -maxRoll, maxRoll);
    return {
      dolly: 1 / zoom,
      zoom: zoom,
      truckX: tx,
      truckY: ty,
      panX: tx * safeW,
      panY: ty * safeH,
      orbitAz: clamp(rig.orbitAz, -22, 22),
      tiltEl: clamp(rig.tiltEl, -14, 14),
      roll: roll,
      rollRad: roll * DEG,
      pivotX: rig.pivotX,
      pivotY: rig.pivotY,
      blur: rig.blur,
    };
  }

  /**
   * Pure framing guard: evaluates 12 samples along the shot and scales down intensity
   * (<= 4 steps, factor 0.7) until projected focusBox stays inside safeZone for all samples.
   * Without a measured focusBox/projectFn, applies conservative limits and reports `unmeasured`.
   */
  function guard(evalRigAtU, focusBoxOrProjectFn, safe, options) {
    var opts = options || {};
    var samples = Math.max(2, Number(opts.samples) || 12);
    var W = Number(opts.W) || 1280;
    var H = Number(opts.H) || 720;

    if (!focusBoxOrProjectFn || !safe) {
      return {
        intensityScale: 1,
        guard: 'unmeasured',
        steps: 0,
      };
    }

    var isProjectFn = typeof focusBoxOrProjectFn === 'function';
    function allInSafe(scale) {
      for (var i = 0; i < samples; i++) {
        var u = samples === 1 ? 0.5 : i / (samples - 1);
        var rig = evalRigAtU(u, scale);
        var proj = isProjectFn
          ? focusBoxOrProjectFn(rig, u)
          : projectBox2D(focusBoxOrProjectFn, rig, W, H);
        if (!boxInsideSafe(proj, safe)) return false;
      }
      return true;
    }

    if (allInSafe(1)) {
      return { intensityScale: 1, guard: 'measured', steps: 0 };
    }

    var scale = 1;
    for (var step = 1; step <= 4; step++) {
      scale *= 0.7;
      if (allInSafe(scale)) {
        return { intensityScale: Math.round(scale * 10000) / 10000, guard: 'clamped', steps: step };
      }
    }

    // Fallback to identity rig if even 0.7^4 exceeded safe zone
    return { intensityScale: 0, guard: 'clamped', steps: 4 };
  }

  function resolve(story, shot, localTime, dur, options) {
    var opts = options || {};
    var W = Number(opts.W) || (story && story.canvas && story.canvas.w) || 1280;
    var H = Number(opts.H) || (story && story.canvas && story.canvas.h) || 720;
    var safe = opts.safe || null;
    var limits = opts.limits || null;
    var plans = planStoryMoves(story);
    var sid = String((shot && shot.id) || 'shot1');
    var plan = plans[sid] || {
      active: false,
      mode: 'none',
      move: 'none',
      dir: 'none',
      seed: 0,
      intensity: 0,
      repeatOfPrevious: false,
    };

    var rig;
    var guardState = 'unmeasured';
    var effectiveScale = 1;

    if (!plan.active) {
      rig = makeIdentityRig();
      guardState = opts.focusBox || opts.projectFocus ? 'measured' : 'unmeasured';
    } else if (plan.mode === 'legacy') {
      rig = resolveLegacyPreset(shot, localTime, dur, W, H);
      if (opts.focusBox && safe) {
        var projLeg = projectBox2D(opts.focusBox, rig, W, H);
        guardState = boxInsideSafe(projLeg, safe) ? 'measured' : 'unmeasured';
      }
    } else {
      var focusTarget = opts.projectFocus || opts.focusBox || null;
      var gRes = guard(
        function (u, sc) {
          return evaluateMoveRig(plan, u * dur, dur, W, H, sc);
        },
        focusTarget,
        safe,
        { samples: opts.samples || 12, W: W, H: H }
      );
      effectiveScale = gRes.intensityScale;
      guardState = gRes.guard;
      rig = evaluateMoveRig(plan, localTime, dur, W, H, effectiveScale);
      if (guardState === 'unmeasured' && limits) {
        rig = clampRigByLimits(rig, limits, W, H);
      }
    }

    var reportEntry = {
      move: plan.move,
      dir: plan.dir,
      seed: plan.seed,
      intensity: Math.round((plan.intensity || 0) * effectiveScale * 1000) / 1000,
      params: {
        dolly: Math.round(rig.dolly * 10000) / 10000,
        zoom: Math.round(rig.zoom * 10000) / 10000,
        truckX: Math.round(rig.truckX * 10000) / 10000,
        truckY: Math.round(rig.truckY * 10000) / 10000,
        orbitAz: Math.round(rig.orbitAz * 100) / 100,
        tiltEl: Math.round(rig.tiltEl * 100) / 100,
        roll: Math.round(rig.roll * 100) / 100,
        blur: Math.round(rig.blur * 100) / 100,
      },
      guard: guardState,
      repeatOfPrevious: Boolean(plan.repeatOfPrevious),
    };

    if (opts.recordReport !== false) {
      global.__cameraReport = global.__cameraReport || {};
      global.__cameraReport[sid] = reportEntry;
    }

    return { rig: rig, plan: plan, report: reportEntry };
  }

  function apply2D(ctx, rig, W, H) {
    if (!ctx || !rig) return;
    if (
      Math.abs(rig.zoom - 1) < 1e-6 &&
      Math.abs(rig.panX) < 1e-6 &&
      Math.abs(rig.panY) < 1e-6 &&
      Math.abs(rig.rollRad) < 1e-6 &&
      rig.blur <= 0.2
    ) {
      return;
    }
    var pvx = W * rig.pivotX;
    var pvy = H * rig.pivotY;
    if (rig.blur > 0.2) {
      ctx.filter = 'blur(' + rig.blur.toFixed(1) + 'px)';
    }
    ctx.translate(pvx + rig.panX, pvy + rig.panY);
    ctx.rotate(rig.rollRad);
    ctx.scale(rig.zoom, rig.zoom);
    ctx.translate(-pvx, -pvy);
  }

  function compute3DPose(baseCamPos, baseLookAt, rig) {
    if (
      !rig ||
      (Math.abs(rig.dolly - 1) < 1e-6 &&
        Math.abs(rig.truckX) < 1e-6 &&
        Math.abs(rig.truckY) < 1e-6 &&
        Math.abs(rig.orbitAz) < 1e-6 &&
        Math.abs(rig.tiltEl) < 1e-6 &&
        Math.abs(rig.roll) < 1e-6)
    ) {
      return {
        position: [baseCamPos[0], baseCamPos[1], baseCamPos[2]],
        lookAt: [baseLookAt[0], baseLookAt[1], baseLookAt[2]],
        rollRad: 0,
      };
    }

    var dx = baseCamPos[0] - baseLookAt[0];
    var dy = baseCamPos[1] - baseLookAt[1];
    var dz = baseCamPos[2] - baseLookAt[2];
    var r = Math.max(0.1, Math.hypot(dx, dy, dz));
    var horiz = Math.max(1e-5, Math.hypot(dx, dz));
    var az = Math.atan2(dx, dz);
    var el = Math.atan2(dy, horiz);

    var r2 = r * rig.dolly;
    var az2 = az + rig.orbitAz * DEG;
    var el2 = clamp(el + rig.tiltEl * DEG, 0.08, 1.48);

    // Camera right vector on XZ plane
    var rightX = Math.cos(az2);
    var rightZ = -Math.sin(az2);
    var shiftX = rig.truckX * r * 0.55;
    var shiftY = rig.truckY * r * 0.45;

    var lx = baseLookAt[0] + rightX * shiftX;
    var ly = baseLookAt[1] + shiftY;
    var lz = baseLookAt[2] + rightZ * shiftX;

    var h2 = r2 * Math.cos(el2);
    var px = lx + h2 * Math.sin(az2);
    var py = ly + r2 * Math.sin(el2);
    var pz = lz + h2 * Math.cos(az2);

    return {
      position: [px, py, pz],
      lookAt: [lx, ly, lz],
      rollRad: rig.rollRad || 0,
    };
  }

  function applyTo3D(camera, baseCamPos, baseLookAt, rig) {
    if (!camera) return null;
    var pose = compute3DPose(baseCamPos, baseLookAt, rig);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
    if (Math.abs(pose.rollRad) > 1e-6 && typeof camera.rotateZ === 'function') {
      camera.rotateZ(pose.rollRad);
    }
    return pose;
  }

  global.StoryCamera = {
    version: 1,
    IDENTITY_RIG: IDENTITY_RIG,
    CAMERA_STYLES: CAMERA_STYLES,
    MOVES: MOVES,
    LEGACY_PRESETS: LEGACY_PRESETS,
    hashSeed: hashSeed,
    createRng: createRng,
    planStoryMoves: planStoryMoves,
    resolveLegacyPreset: resolveLegacyPreset,
    resolve: resolve,
    guard: guard,
    projectBox2D: projectBox2D,
    clampRigByLimits: clampRigByLimits,
    apply2D: apply2D,
    compute3DPose: compute3DPose,
    applyTo3D: applyTo3D,
  };
})(typeof window !== 'undefined' ? window : globalThis);
