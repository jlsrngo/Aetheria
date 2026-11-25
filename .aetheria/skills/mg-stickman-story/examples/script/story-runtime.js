/* .aetheria/skills/mg-stickman-story/examples/script/story-runtime.js
 * mg-stickman-story scene assembler (StoryCore v1 + Director Camera v2).
 * Render pipeline per frame: sky/world back layers (depth parallax) -> actors -> world front
 * (blanket/desk/bush occlusion) -> mood tint -> whip smear -> FX -> comic overlays -> speech bubbles
 * -> karaoke subtitles -> entry transitions -> global fades.
 */
(function (root) {
  'use strict';

  var Rig = root.StickmanRig;
  var World = root.StickmanWorld;
  var Overlay = root.StickmanOverlay;
  var Timeline = root.StickmanTimeline;
  var SC = root.StoryCamera;

  function num(v, d) {
    var n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function listOf(shot, key) {
    return Array.isArray(shot && shot[key]) ? shot[key] : [];
  }

  function presetFor(story, id) {
    var map = story.actorsMap || story.cast || {};
    if (Array.isArray(map)) {
      for (var i = 0; i < map.length; i++) {
        if (map[i] && map[i].id === id) return map[i].preset || map[i].base || map[i];
      }
      return id;
    }
    return map[id] !== undefined ? map[id] : id;
  }

  function actorAt(spec, t, when) {
    return Timeline.actorStateAt(spec, t, when);
  }

  function poseStateFor(st, t) {
    var cur = Rig.evalPoseState(st.pose, t);
    if (st.poseAlpha < 1) {
      return Rig.blendPoseStates(Rig.evalPoseState(st.prevPose, t), cur, st.poseAlpha);
    }
    return cur;
  }

  function cameraActorState(spec, t, when) {
    var st = actorAt(spec, t, when);
    var ps = Rig.evalPoseState(st.pose, t);
    return {
      x: st.x,
      y: st.y,
      scale: st.scale,
      sit: ps.lie ? 0 : clamp(ps.sit / 48, 0, 1),
      facing: st.facing
    };
  }

  var cameraCache = {};

  function directorFor(env, actors) {
    var shot = env.shot;
    var key = shot.id + '@' + env.W + 'x' + env.H;
    if (cameraCache[key]) return cameraCache[key];
    var byId = {};
    var ids = [];
    for (var i = 0; i < actors.length; i++) {
      if (actors[i] && actors[i].id) {
        byId[actors[i].id] = actors[i];
        ids.push(actors[i].id);
      }
    }
    cameraCache[key] = SC.createDirectorCamera(shot.camera || {}, {
      W: env.W,
      H: env.H,
      duration: env.duration,
      actorIds: ids,
      resolveWhen: env.when,
      resolveWhenEnd: env.whenEnd,
      getActorState: function (id, t) {
        return byId[id] ? cameraActorState(byId[id], t, env.when) : null;
      }
    });
    return cameraCache[key];
  }

  function project(cam, wx, wy, W, H) {
    return SC.projectWorld2D(wx, wy, cam, 1, W, H);
  }

  function unionBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY)
    };
  }

  function actorFocusBox(st, info, cam, W, H) {
    var s = st.scale;
    var hx = info.head[0];
    var top = info.topY;
    var chest = info.head[1] + 150 * s;
    var a = project(cam, hx - 135 * s, top, W, H);
    var b = project(cam, hx + 135 * s, chest, W, H);
    var box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    if (box.maxX < 0 || box.minX > W || box.maxY < 0 || box.minY > H) return null;
    return {
      minX: clamp(box.minX, 0, W), minY: clamp(box.minY, 0, H),
      maxX: clamp(box.maxX, 0, W), maxY: clamp(box.maxY, 0, H)
    };
  }

  function drawFloatingProps(c, shot, env, actorInfo, layer) {
    var props = listOf(shot, 'props');
    for (var i = 0; i < props.length; i++) {
      var pr = props[i] || {};
      var lyr = pr.layer || 'back';
      if ((layer === 'front') !== (lyr === 'front')) continue;
      var t0 = env.when(pr);
      var t1 = env.whenEnd(pr, env.duration + 1);
      if (env.localTime < t0 || env.localTime > t1) continue;
      var px = num(pr.x, 0);
      var py = num(pr.y, -200);
      if (pr.follow && actorInfo[pr.follow]) {
        px = actorInfo[pr.follow].head[0] + num(pr.dx, 0);
        py = actorInfo[pr.follow].topY + num(pr.dy, -40);
      }
      var kind = pr.kind || 'paper';
      c.setDepth(num(pr.depth, 1));
      if (['exclaim', 'question', 'idea', 'zzz', 'sparkle', 'star', 'heart', 'angry', 'annoyed', 'sweat', 'check', 'cross', 'music'].indexOf(kind) >= 0) {
        Rig.drawHeadIcon(c, kind, px, py, num(pr.scale, 1), env.localTime);
      } else {
        Rig.drawHeldProp(c, kind, px, py, num(pr.scale, 1.4), 1, 6, env.localTime);
      }
    }
    c.setDepth(1);
  }

  function talkLevel(id, bubbles, env, actorCount) {
    var hasBubbleOwner = false;
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i] || {};
      if (b.by !== id) continue;
      hasBubbleOwner = true;
      var t0 = env.when(b);
      var t1 = env.whenEnd(b, t0 + 2.0);
      if (env.localTime >= t0 && env.localTime <= Math.min(t1, t0 + 1.6)) {
        if (typeof env.talkLevel === 'number') return env.talkLevel;
        return 0.5 + 0.5 * Math.abs(Math.sin((env.localTime - t0) * 15));
      }
    }
    if (!hasBubbleOwner && bubbles.length === 0 && typeof env.talkLevel === 'number' && actorCount <= 1) {
      return env.talkLevel;
    }
    return null;
  }

  function drawScene(ctx, W, H, story, shot, env, cam, opts) {
    var c = new Rig.WorldCanvas(ctx, W, H, cam);
    var actors = listOf(shot, 'actors');
    var bubbles = listOf(shot, 'bubbles');
    var states = actors.map(function (a) { return actorAt(a, env.localTime, env.when); });
    var anySleeping = states.some(function (st) { return st.pose === 'sleep'; });
    var worldOpts = {
      timeOfDay: shot.timeOfDay || shot.mood || 'morning',
      clockTime: shot.clockTime,
      alarm: !!shot.alarm,
      blanket: shot.blanket,
      blanketFront: anySleeping,
      signText: shot.signText,
      boardText: shot.boardText,
      bgColor: shot.bgColor
    };
    var world = World.getWorld(shot.stage || 'park');

    var blurPx = cam.blur > 0.4 ? cam.blur * (Math.min(W, H) / 1080) : 0;
    if (blurPx > 0) ctx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
    world.back(c, worldOpts, env.localTime);
    ctx.filter = 'none';
    c.setDepth(1);
    drawFloatingProps(c, shot, env, {}, 'back');

    var box = null;
    var actorInfo = {};
    var order = states.map(function (st, i) { return i; }).sort(function (a, b) {
      return (states[a].pose === 'sleep' ? -1 : 0) - (states[b].pose === 'sleep' ? -1 : 0) || states[a].y - states[b].y;
    });
    for (var oi = 0; oi < order.length; oi++) {
      var idx = order[oi];
      var spec = actors[idx] || {};
      var st = states[idx];
      var preset = spec.preset || presetFor(story, spec.id);
      var emoteKind = st.emote ? st.emote.kind : null;
      var talk = spec.talk ? (typeof env.talkLevel === 'number' ? env.talkLevel : 0.5 + 0.5 * Math.abs(Math.sin(env.localTime * 14))) : talkLevel(spec.id, bubbles, env, actors.length);
      var info = Rig.drawCharacter(c, preset, {
        t: env.localTime,
        x: st.x,
        y: st.y,
        s: st.scale,
        flip: st.flip,
        poseState: poseStateFor(st, env.localTime),
        expr: st.expr,
        blink: Rig.blinkAt(env.localTime, idx * 0.9),
        emote: emoteKind,
        prop: st.prop,
        backpack: st.backpack,
        stride: st.stride,
        walkAmp: st.walkAmp,
        talk: talk
      });
      info.state = st;
      actorInfo[spec.id] = info;
      if (!opts || !opts.skipQa) box = unionBox(box, actorFocusBox(st, info, cam, W, H));
    }

    world.front(c, worldOpts, env.localTime);
    drawFloatingProps(c, shot, env, actorInfo, 'front');
    c.screen();
    World.applyMoodTint(c, worldOpts.timeOfDay);
    return { box: box, actorInfo: actorInfo, bubbles: bubbles };
  }

  function drawComicPage(ctx, W, H, story, shot, env) {
    var grid = Array.isArray(shot.grid) ? shot.grid : [2, 2];
    var cols = Math.max(1, num(grid[0], 2));
    var rows = Math.max(1, num(grid[1], 2));
    var panels = listOf(shot, 'panels');
    var u = Math.min(W, H) / 1080;
    var safe = env.safe || { x: 56, y: 80, w: W - 184, h: H - 580 };
    var padX = 12 * u;
    var padY = 12 * u;
    var left = safe.x + padX;
    var top = safe.y + padY;
    var gridW = Math.max(120, safe.w - padX * 2);
    var gridH = Math.max(120, safe.h - padY * 2);
    var gap = 22 * u;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = shot.pageColor === 'white' ? '#FFFFFF' : '#FFF6E5';
    ctx.fillRect(0, 0, W, H);

    var zoom = shot.zoom || null;
    var zp = 0;
    var zr = null;
    var pw = (gridW - gap * (cols - 1)) / cols;
    var ph = (gridH - gap * (rows - 1)) / rows;
    if (zoom) {
      var zt0 = env.when(zoom);
      zp = clamp((env.localTime - zt0) / Math.max(0.1, num(zoom.dur, 1.2)), 0, 1);
      zp = zp * zp * (3 - 2 * zp);
      var zi = Math.max(0, num(zoom.panel, 1) - 1);
      zr = { x: left + (zi % cols) * (pw + gap), y: top + Math.floor(zi / cols) * (ph + gap) };
    }
    ctx.save();
    if (zr && zp > 0) {
      var zCenterX = left + gridW * 0.5;
      var zCenterY = top + gridH * 0.5;
      var sc = 1 + (Math.min(gridW / pw, gridH / ph) - 1) * zp;
      var fcx = zCenterX + (zr.x + pw / 2 - zCenterX) * zp;
      var fcy = zCenterY + (zr.y + ph / 2 - zCenterY) * zp;
      ctx.translate(zCenterX, zCenterY);
      ctx.scale(sc, sc);
      ctx.translate(-fcx, -fcy);
    }
    var off = drawComicPage._buf || (drawComicPage._buf = document.createElement('canvas'));
    var ow = Math.max(2, Math.round(pw));
    var oh = Math.max(2, Math.round(ph));
    if (off.width !== ow || off.height !== oh) {
      off.width = ow;
      off.height = oh;
    }
    var octx = off.getContext('2d');
    var base = ctx.getTransform();
    for (var i = 0; i < panels.length && i < cols * rows; i++) {
      var pn = panels[i] || {};
      var t0 = num(pn.appear, i * 0.6);
      var age = env.localTime - t0;
      if (age < 0) continue;
      var pop = clamp(age / 0.3, 0, 1);
      var bounce = 1 + Math.sin(pop * Math.PI) * 0.06;
      var px = left + (i % cols) * (pw + gap);
      var py = top + Math.floor(i / cols) * (ph + gap);
      var panelEnv = Object.assign({}, env, { localTime: age });
      octx.setTransform(1, 0, 0, 1, 0, 0);
      drawScene(octx, ow, oh, story, pn, panelEnv, { x: 0, y: -300, z: num(pn.zoom, 0.86), r: 0, blur: 0 }, { skipQa: true });
      ctx.setTransform(base);
      ctx.translate(px + pw / 2, py + ph / 2);
      ctx.scale(pop * bounce, pop * bounce);
      ctx.drawImage(off, -pw / 2, -ph / 2, pw, ph);
      ctx.lineWidth = 7 * u;
      ctx.strokeStyle = '#181A20';
      ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { minX: left, minY: top, maxX: left + gridW, maxY: top + gridH };
  }

  function renderOverlays(ctx, env, shot, sceneInfo, cam) {
    var W = env.W;
    var H = env.H;
    var lt = env.localTime;
    var fx = listOf(shot, 'fx');
    for (var i = 0; i < fx.length; i++) {
      var f = typeof fx[i] === 'string' ? { kind: fx[i] } : (fx[i] || {});
      var t0 = env.when(f);
      var dur = num(f.dur !== undefined ? f.dur : f.duration, env.duration);
      if (lt >= t0 && lt <= t0 + dur) Overlay.drawScreenFx(ctx, W, H, f.kind, lt - t0, dur, env.t);
    }
    if (env.micro) return;

    var texts = listOf(shot, 'overlays');
    for (var k = 0; k < texts.length; k++) {
      var tx = texts[k] || {};
      var tt0 = env.when(tx);
      var tt1 = env.whenEnd(tx, env.duration + 1);
      if (lt >= tt0 && lt <= tt1) {
        var tb = Overlay.drawComicText(ctx, W, H, tx, lt - tt0);
        if (tb) env.pushOverlayBox(tb);
      }
    }

    var bubbles = sceneInfo.bubbles || [];
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b] || {};
      var bt0 = env.when(bb);
      var bt1 = env.whenEnd(bb, env.duration);
      if (lt < bt0 || lt > bt1) continue;
      var who = sceneInfo.actorInfo[bb.by];
      if (!who) continue;
      var head = SC.projectWorld2D(who.head[0], who.topY + 20, cam, 1, W, H);
      var box = Overlay.drawBubble(ctx, W, H, bb, { x: head.x, y: head.y }, lt - bt0);
      if (box) env.pushOverlayBox(box);
    }

    var capsOn = env.story.captions && env.story.captions.enabled !== false;
    if (capsOn && shot.caption) Overlay.drawSubtitle(ctx, W, H, env.words, lt);
  }

  function totalDuration(story) {
    var shots = story.shots || [];
    var last = shots[shots.length - 1];
    return last ? num(last.start, 0) + num(last.duration, 0) : 0;
  }

  function renderShot(env) {
    var ctx = env.ctx;
    var W = env.W;
    var H = env.H;
    var shot = env.shot;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var focus = null;
    if (shot.type === 'comic') {
      focus = drawComicPage(ctx, W, H, env.story, shot, env);
    } else {
      var actors = listOf(shot, 'actors');
      var director = directorFor(env, actors);
      var cam = director.evalAt(env.localTime);
      var info = drawScene(ctx, W, H, env.story, shot, env, cam);
      focus = info.box;
      if (cam.whipAmount > 0.02) Overlay.smear(ctx, W, H, cam.whipAmount * W * 0.16);
      renderOverlays(ctx, env, shot, info, cam);
      root.__stickmanCamera = root.__stickmanCamera || {};
      root.__stickmanCamera[shot.id] = { x: cam.x, y: cam.y, z: cam.z, r: cam.r, t: env.localTime };
    }

    Overlay.drawTransition(ctx, W, H, shot.transition, env.localTime);
    var total = totalDuration(env.story);
    var fin = num(env.story.fadeIn, 0);
    var fout = num(env.story.fadeOut, 0);
    var fade = 0;
    if (fin > 0 && env.t < fin) fade = 1 - env.t / fin;
    if (fout > 0 && env.t > total - fout) fade = Math.max(fade, (env.t - (total - fout)) / fout);
    Overlay.drawFade(ctx, W, H, fade);
    ctx.restore();

    if (!focus) {
      focus = { minX: W * 0.3, minY: H * 0.25, maxX: W * 0.7, maxY: H * 0.7 };
    }
    focus.width = focus.maxX - focus.minX;
    focus.height = focus.maxY - focus.minY;
    focus.behind = false;
    return focus;
  }

  if (root.StoryCore && typeof root.StoryCore.boot === 'function' && !root.__STICKMAN_NO_BOOT) {
    root.StoryCore.boot({
      id: 'mg-stickman-story',
      defaultTitle: 'Stickman Story',
      renderShot: renderShot
    });
  }

  root.StickmanStory = {
    version: 1,
    renderShot: renderShot,
    drawScene: drawScene
  };
})(typeof window !== 'undefined' ? window : globalThis);
