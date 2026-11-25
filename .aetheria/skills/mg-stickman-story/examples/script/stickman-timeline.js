/* .aetheria/skills/mg-stickman-story/examples/script/stickman-timeline.js
 * Pure actor timeline evaluator: resolves an actor spec + `actions[]` beats into deterministic state
 * at local time t (position, travel, facing, pose blend, expression, emote, prop).
 * Shared by the renderer and Director Camera (`getActorState`) so camera tracking follows real motion.
 */
(function (root) {
  'use strict';

  var POSE_BLEND_SEC = 0.3;

  function num(v, d) {
    var n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smoothstep(p) {
    var x = clamp(p, 0, 1);
    return x * x * (3 - 2 * x);
  }
  function facingToFlip(h, fallback) {
    if (h === 'left') return -1;
    if (h === 'right') return 1;
    return fallback;
  }
  function defaultWhen(item) {
    if (typeof item === 'number') return item;
    if (!item || typeof item !== 'object') return 0;
    return num(item.at !== undefined ? item.at : item.t, 0) + num(item.offset, 0);
  }

  function compileBeats(spec, whenFn) {
    var when = typeof whenFn === 'function' ? whenFn : defaultWhen;
    var raw = Array.isArray(spec.actions) ? spec.actions : [];
    var beats = raw.map(function (a, i) {
      return { a: a || {}, t0: Math.max(0, num(when(a || {}), 0)), i: i };
    });
    var enter = spec.enter;
    if (enter && typeof enter === 'object') {
      var from = enter.from || 'left';
      var dx = from === 'right' ? 1150 : -1150;
      beats.push({
        a: { toX: num(spec.x, 0), dur: num(enter.dur, 1.0), style: enter.style || 'walk', _fromX: num(spec.x, 0) + dx },
        t0: Math.max(0, num(when(enter), 0)),
        i: -1
      });
    }
    beats.sort(function (p, q) { return p.t0 !== q.t0 ? p.t0 - q.t0 : p.i - q.i; });
    return beats;
  }

  /**
   * Evaluates an actor at local time t. `whenFn` resolves `at`/`word` cues.
   * Returns { id, x, y, scale, flip, facing, pose, prevPose, poseAlpha, expr, emote, prop,
   *           moving, style, stride, walkAmp, backpack, talk }.
   */
  function actorStateAt(spec, t, whenFn) {
    var s = spec || {};
    var beats = compileBeats(s, whenFn);
    var enter = s.enter;
    var x = num(s.x, 0);
    var hasEnterBeat = beats.some(function (b) { return b.a._fromX !== undefined; });
    if (hasEnterBeat && enter) {
      var from = enter.from || 'left';
      x += from === 'right' ? 1150 : -1150;
    }
    var st = {
      id: s.id,
      x: x,
      y: num(s.y, 0),
      scale: num(s.scale, 1),
      flip: facingToFlip(s.facing, 1),
      pose: s.pose || 'idle',
      prevPose: s.pose || 'idle',
      poseT0: -10,
      expr: s.expr || 'happy',
      emote: null,
      prop: s.prop || null,
      moving: false,
      style: null,
      stride: 0,
      walkAmp: 0,
      backpack: !!s.backpack,
      talk: null
    };
    var lastMoveEnd = -1;

    function setPose(p, at) {
      if (!p || p === st.pose) return;
      st.prevPose = st.pose;
      st.pose = p;
      st.poseT0 = at;
    }

    for (var bi = 0; bi < beats.length; bi++) {
      var b = beats[bi];
      if (b.t0 > t + 1e-9) break;
      var a = b.a;
      var toX = a.toX !== undefined ? a.toX : a.to_x;
      if (toX !== undefined && Number.isFinite(Number(toX))) {
        var fromX = a._fromX !== undefined ? a._fromX : st.x;
        var dur = Math.max(0.05, num(a.dur !== undefined ? a.dur : a.duration, 1.0));
        var style = a.style || 'walk';
        var p = clamp((t - b.t0) / dur, 0, 1);
        var e = smoothstep(p);
        var dist = Number(toX) - fromX;
        st.x = fromX + dist * e;
        if (Math.abs(dist) > 1) st.flip = dist > 0 ? 1 : -1;
        var strideLen = style === 'run' ? 150 : 110;
        st.stride = (Math.abs(dist) * e / strideLen) * Math.PI;
        if (p < 1) {
          st.moving = true;
          st.style = style;
          st.walkAmp = 1;
        } else {
          st.moving = false;
          st.style = null;
          st.walkAmp = 0;
        }
        lastMoveEnd = b.t0 + dur;
      }
      if (a.pose) setPose(a.pose, b.t0);
      if (a.expr) st.expr = a.expr;
      if (a.facing) st.flip = facingToFlip(a.facing, st.flip);
      if (a.prop !== undefined) st.prop = a.prop;
      if (a.emote) {
        var ed = Math.max(0.2, num(a.emoteDur !== undefined ? a.emoteDur : a.dur, 1.6));
        st.emote = { kind: a.emote, t0: b.t0, t1: b.t0 + ed };
      }
    }

    if (st.emote && t > st.emote.t1) st.emote = null;
    if (st.moving && st.style) {
      st.prevPose = st.pose;
      st.pose = st.style;
      st.poseT0 = -10;
    } else if (lastMoveEnd >= 0 && t - lastMoveEnd < POSE_BLEND_SEC && t >= lastMoveEnd) {
      st.prevPose = 'walk';
      st.poseT0 = lastMoveEnd;
    }
    st.poseAlpha = clamp((t - st.poseT0) / POSE_BLEND_SEC, 0, 1);
    st.facing = st.flip < 0 ? 'left' : 'right';
    return st;
  }

  root.StickmanTimeline = {
    version: 1,
    POSE_BLEND_SEC: POSE_BLEND_SEC,
    actorStateAt: actorStateAt
  };
})(typeof window !== 'undefined' ? window : globalThis);
