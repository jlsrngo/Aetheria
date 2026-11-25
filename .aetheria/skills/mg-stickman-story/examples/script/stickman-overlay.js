/* .aetheria/skills/mg-stickman-story/examples/script/stickman-overlay.js
 * Screen-space comic layer: speech/thought/shout bubbles, comic overlays, screen FX,
 * entry transitions, whip smear, and word-by-word karaoke subtitles.
 * All functions draw in SCREEN pixels (identity transform) and never mutate world state.
 */
(function (root) {
  'use strict';

  var OUT = '#181A20';
  var FONT = '"Fredoka", "Nunito", "Trebuchet MS", "Segoe UI", sans-serif';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOutBack(p) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    var x = clamp(p, 0, 1) - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }
  function hash01(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function wrapLines(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var trial = cur ? cur + ' ' + words[i] : words[i];
      if (cur && ctx.measureText(trial).width > maxW) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = trial;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Speech bubble anchored to a speaker head (screen px). Returns bubble bbox for QA. */
  function drawBubble(ctx, W, H, b, anchor, age) {
    var u = Math.min(W, H) / 1080;
    var pop = easeOutBack(clamp(age / 0.22, 0, 1));
    if (pop <= 0.01) return null;
    var style = b.style || 'speak';
    var fs = 38 * u;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '800 ' + fs.toFixed(1) + 'px ' + FONT;
    var maxLineW = Math.min(W * 0.56, 520 * u);
    var lines = wrapLines(ctx, b.text || '', maxLineW);
    var tw = 0;
    for (var i = 0; i < lines.length; i++) tw = Math.max(tw, ctx.measureText(lines[i]).width);
    var bw = tw + 52 * u;
    var bh = lines.length * fs * 1.18 + 36 * u;
    var side = b.side || 'auto';
    var dir = side === 'left' ? -1 : side === 'right' ? 1 : (anchor.x > W * 0.5 ? -1 : 1);
    var bx = anchor.x + dir * 24 * u - (dir < 0 ? bw : 0);
    var by = anchor.y - bh - 56 * u;
    bx = clamp(bx, 48 * u, W - bw - 120 * u);
    by = clamp(by, 60 * u, H * 0.72 - bh);

    var cx = bx + bw * 0.5;
    var cy = by + bh * 0.5;
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -cy);

    ctx.lineWidth = 5.5 * u;
    ctx.strokeStyle = OUT;
    ctx.fillStyle = style === 'shout' ? '#FFF3B0' : '#FFFFFF';
    ctx.lineJoin = 'round';

    var tipX = clamp(anchor.x, bx + 28 * u, bx + bw - 28 * u);
    if (style === 'think') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, bw * 0.56, bh * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      var dots = [[0.35, 14], [0.62, 10]];
      for (var d = 0; d < dots.length; d++) {
        var px = tipX + (anchor.x - tipX) * dots[d][0];
        var py = by + bh + (anchor.y - by - bh) * dots[d][0];
        ctx.beginPath();
        ctx.arc(px, py, dots[d][1] * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (style === 'shout') {
      ctx.beginPath();
      var spikes = 18;
      for (var k = 0; k <= spikes * 2; k++) {
        var ang = (k / (spikes * 2)) * Math.PI * 2;
        var rr = k % 2 ? 1.0 : 1.16;
        var px2 = cx + Math.cos(ang) * bw * 0.58 * rr;
        var py2 = cy + Math.sin(ang) * bh * 0.66 * rr;
        if (k === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      roundRectPath(ctx, bx, by, bw, bh, 24 * u);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tipX - 16 * u, by + bh - 3 * u);
      ctx.lineTo(anchor.x, Math.min(anchor.y - 12 * u, by + bh + 52 * u));
      ctx.lineTo(tipX + 16 * u, by + bh - 3 * u);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(tipX - 14 * u, by + bh - 8 * u, 28 * u, 8 * u);
    }

    ctx.fillStyle = OUT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], cx, by + 18 * u + fs * 0.62 + li * fs * 1.18);
    }
    ctx.restore();
    return { minX: bx, minY: by, maxX: bx + bw, maxY: by + bh };
  }

  function resolvePos(pos, W, H) {
    if (Array.isArray(pos) && pos.length >= 2) return { x: Number(pos[0]) * W, y: Number(pos[1]) * H };
    if (pos === 'top') return { x: W * 0.5, y: H * 0.16 };
    if (pos === 'bottom') return { x: W * 0.5, y: H * 0.7 };
    return { x: W * 0.5, y: H * 0.45 };
  }

  /** Comic text overlay (`burst`, `title`, `pill`, `big-word`). Returns bbox. */
  function drawComicText(ctx, W, H, item, age) {
    var u = Math.min(W, H) / 1080;
    var style = item.style || 'burst';
    var text = String(item.text || '');
    if (!text) return null;
    var pop = easeOutBack(clamp(age / 0.26, 0, 1));
    var p = resolvePos(item.pos, W, H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var box = null;
    if (style === 'burst' || style === 'big-word') {
      var fs = (style === 'burst' ? 104 : 136) * u;
      var tilt = ((item.tiltDeg !== undefined ? Number(item.tiltDeg) : -8) + Math.sin(age * 7) * 2.2) * Math.PI / 180;
      ctx.translate(p.x, p.y);
      ctx.rotate(tilt);
      ctx.scale(pop, pop);
      ctx.font = '900 ' + fs.toFixed(1) + 'px ' + FONT;
      var tw = ctx.measureText(text).width;
      if (style === 'burst') {
        ctx.beginPath();
        var n = 16;
        for (var k = 0; k <= n * 2; k++) {
          var a = (k / (n * 2)) * Math.PI * 2;
          var rr = k % 2 ? 0.78 : 1.0;
          var px = Math.cos(a) * (tw * 0.5 + 64 * u) * rr;
          var py = Math.sin(a) * (fs * 0.5 + 56 * u) * rr;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#FF5A4E';
        ctx.fill();
        ctx.lineWidth = 6.5 * u;
        ctx.strokeStyle = OUT;
        ctx.stroke();
      }
      ctx.lineJoin = 'round';
      ctx.lineWidth = 14 * u;
      ctx.strokeStyle = OUT;
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = '#FFD60A';
      ctx.fillText(text, 0, 0);
      var hw = (tw * 0.5 + 64 * u) * pop;
      var hh = (fs * 0.5 + 56 * u) * pop;
      box = { minX: p.x - hw, minY: p.y - hh, maxX: p.x + hw, maxY: p.y + hh };
    } else {
      var fs2 = (style === 'title' ? 58 : 38) * u;
      ctx.font = '800 ' + fs2.toFixed(1) + 'px ' + FONT;
      var tw2 = ctx.measureText(text).width;
      var bw = tw2 + 60 * u;
      var bh = fs2 + 32 * u;
      ctx.translate(p.x, p.y);
      ctx.scale(pop, pop);
      roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
      ctx.fillStyle = style === 'title' ? '#4A7A7C' : '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 5.5 * u;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.fillStyle = style === 'title' ? '#FFFFFF' : OUT;
      ctx.fillText(text, 0, 2 * u);
      box = { minX: p.x - bw / 2, minY: p.y - bh / 2, maxX: p.x + bw / 2, maxY: p.y + bh / 2 };
    }
    ctx.restore();
    return box;
  }

  /** Screen FX: `speed-lines`, `flash`, `vignette`, `dim`, `letterbox`, `rain`, `snow`. */
  function drawScreenFx(ctx, W, H, kind, age, dur, t) {
    var u = Math.min(W, H) / 1080;
    var env = clamp(age / 0.12, 0, 1) * (1 - clamp((age - (dur - 0.2)) / 0.2, 0, 1));
    if (env <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (kind === 'speed-lines') {
      var frame = Math.floor(t * 24);
      ctx.fillStyle = 'rgba(24,26,32,' + (0.85 * env).toFixed(3) + ')';
      for (var i = 0; i < 64; i++) {
        var a = (i / 64) * Math.PI * 2 + hash01(i + frame * 0.37) * 0.08;
        var r0 = Math.hypot(W, H) * (0.32 + hash01(i * 3.1 + frame) * 0.12);
        var r1 = Math.hypot(W, H) * 0.75;
        var wdt = (0.006 + hash01(i * 7.7) * 0.01);
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1);
        ctx.lineTo(W / 2 + Math.cos(a - wdt) * r0, H / 2 + Math.sin(a - wdt) * r0);
        ctx.lineTo(W / 2 + Math.cos(a + wdt) * r0, H / 2 + Math.sin(a + wdt) * r0);
        ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'flash') {
      ctx.fillStyle = 'rgba(255,255,255,' + (1 - clamp(age / Math.max(0.05, dur), 0, 1)).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    } else if (kind === 'vignette' || kind === 'dim') {
      var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(10,12,20,' + ((kind === 'dim' ? 0.8 : 0.5) * env).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (kind === 'letterbox') {
      ctx.fillStyle = '#0B0C10';
      ctx.fillRect(0, 0, W, H * 0.1 * env);
      ctx.fillRect(0, H - H * 0.1 * env, W, H * 0.1 * env);
    } else if (kind === 'rain' || kind === 'snow') {
      var snow = kind === 'snow';
      ctx.strokeStyle = 'rgba(180,210,255,' + (0.7 * env).toFixed(3) + ')';
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * env).toFixed(3) + ')';
      ctx.lineWidth = 3 * u;
      for (var k = 0; k < 120; k++) {
        var sp = snow ? 90 : 900;
        var x0 = hash01(k * 1.7) * W;
        var y0 = (hash01(k * 9.1) * H + t * sp * u) % H;
        if (snow) {
          ctx.beginPath();
          ctx.arc(x0 + Math.sin(t + k) * 12 * u, y0, (3 + hash01(k) * 4) * u, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 - 8 * u, y0 + 34 * u);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /** Horizontal whip smear by compositing shifted copies of the rendered frame. */
  function smear(ctx, W, H, amountPx) {
    if (!(amountPx > 1) || typeof document === 'undefined') return;
    var off = smear._buf || (smear._buf = document.createElement('canvas'));
    if (off.width !== W || off.height !== H) {
      off.width = W;
      off.height = H;
    }
    var octx = off.getContext('2d');
    octx.clearRect(0, 0, W, H);
    octx.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var taps = 8;
    for (var i = 1; i <= taps; i++) {
      ctx.globalAlpha = 0.5 / i + 0.05;
      ctx.drawImage(off, ((i / taps) - 0.5) * amountPx, 0);
    }
    ctx.restore();
  }

  /** Entry transition overlay (`cut`, `flash`, `whip`, `slide`, `wipe`, `fade`, `blink`, `iris`). */
  function drawTransition(ctx, W, H, tr, localTime) {
    if (!tr) return;
    var spec = typeof tr === 'string' ? { kind: tr } : tr;
    var kind = spec.kind || spec.type || 'cut';
    var dur = Math.max(0.05, Number(spec.dur || spec.duration || (kind === 'iris' ? 0.55 : 0.32)));
    var p = clamp(localTime / dur, 0, 1);
    if (p >= 1 || kind === 'cut') return;
    if (kind === 'whip' || kind === 'slide' || kind === 'wipe') {
      smear(ctx, W, H, (1 - p) * W * 0.18);
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (kind === 'flash') {
      ctx.fillStyle = 'rgba(255,255,255,' + (1 - p).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    } else if (kind === 'fade') {
      ctx.fillStyle = 'rgba(12,12,16,' + (1 - p).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    } else if (kind === 'blink') {
      var h = (1 - p) * H * 0.5;
      ctx.fillStyle = '#0B0C10';
      ctx.fillRect(0, 0, W, h);
      ctx.fillRect(0, H - h, W, h);
    } else if (kind === 'iris') {
      var cx = Number(spec.x !== undefined ? spec.x : 0.5) * W;
      var cy = Number(spec.y !== undefined ? spec.y : 0.5) * H;
      var r = Math.hypot(W, H) * p * p;
      ctx.fillStyle = '#0B0C10';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    }
    ctx.restore();
  }

  /** Word-by-word karaoke subtitle bar placed cleanly inside portrait Zone 4 (y ~ 0.81*H) or 16:9 bottom. */
  function drawSubtitle(ctx, W, H, words, localTime) {
    if (!Array.isArray(words) || !words.length) return null;
    var u = Math.min(W, H) / 1080;
    var active = -1;
    for (var i = 0; i < words.length; i++) {
      if (localTime >= Number(words[i].start) - 0.02) active = i;
    }
    if (active < 0) return null;
    var lastEnd = Number(words[words.length - 1].end || 0);
    if (localTime > lastEnd + 0.6) return null;
    var chunk = H > W ? 4 : 5;
    var c0 = Math.floor(active / chunk) * chunk;
    var group = words.slice(c0, c0 + chunk);
    var fs = (H > W ? 44 : 46) * u;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '800 ' + fs.toFixed(1) + 'px ' + FONT;
    var gap = 16 * u;
    var widths = group.map(function (w) { return ctx.measureText(String(w.word || w.text || '')).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (group.length - 1);
    var bw = total + 56 * u;
    var bh = fs + 30 * u;
    var bx = (H > W ? 495 : W * 0.5) - bw * 0.5;
    var by = (H > W ? H * 0.815 : H * 0.885) - bh * 0.5;
    roundRectPath(ctx, bx, by, bw, bh, 18 * u);
    ctx.fillStyle = 'rgba(24,26,32,0.84)';
    ctx.fill();
    var x = bx + 28 * u;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (var k = 0; k < group.length; k++) {
      ctx.fillStyle = c0 + k === active ? '#FFD60A' : '#FFFFFF';
      ctx.fillText(String(group[k].word || group[k].text || ''), x, by + bh * 0.5 + 2 * u);
      x += widths[k] + gap;
    }
    ctx.restore();
    return { minX: bx, minY: by, maxX: bx + bw, maxY: by + bh };
  }

  function drawFade(ctx, W, H, alpha) {
    if (!(alpha > 0.001)) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,' + clamp(alpha, 0, 1).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  root.StickmanOverlay = {
    version: 1,
    drawBubble: drawBubble,
    drawComicText: drawComicText,
    drawScreenFx: drawScreenFx,
    drawTransition: drawTransition,
    drawSubtitle: drawSubtitle,
    drawFade: drawFade,
    smear: smear
  };
})(typeof window !== 'undefined' ? window : globalThis);
