/**
 * Aetheria Declarative Story Runtime Core (`/script/story-core.js`, Core API v1).
 *
 * Single shared runtime kernel served by `aetheria-engine` alongside `aetheria-motion.js`
 * and `three.min.js`. Eliminates duplicated bootstrap, dialect normalization, shot/caption
 * lookup, safe-zone reporting, Mode 'M' (?microstock=1) handling, and deterministic
 * `window.renderAt` / `window.__seek` / `window.__ready` / `window.__filmMeta` /
 * `window.__shotReport` plumbing across declarative `mg-*` skill runtimes.
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function easeOutCubic(x) {
    var c = clamp(x, 0, 1);
    return 1 - Math.pow(1 - c, 3);
  }

  function easeOutExpo(x) {
    var c = clamp(x, 0, 1);
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  }

  function isMicrostock(story, override) {
    var urlFlag = false;
    if (typeof global !== 'undefined' && global.location && global.location.search) {
      urlFlag = global.location.search.indexOf('microstock=1') !== -1;
    }
    var globalFlag = Boolean(typeof global !== 'undefined' && global.__microstockMode);
    var storyFlag = Boolean(story && story.microstockMode);
    return Boolean(urlFlag || globalFlag || override || storyFlag);
  }

  function computeSafeZone(width, height) {
    if (height > width) {
      return { x: 56, y: 80, w: 896, h: 1340, minX: 56, maxX: 952, minY: 80, maxY: 1420 };
    }
    var w = width - 220;
    var h = height - 220;
    return { x: 110, y: 80, w: w, h: h, minX: 110, maxX: 110 + w, minY: 80, maxY: 80 + h };
  }

  function computePortraitRailSafeZone(width, height) {
    if (height > width) {
      var minX = Math.round(width * 0.045);
      var maxX = Math.round(width * (960 / 1080));
      var minY = Math.round(height * (60 / 1920));
      var maxY = Math.round(height * (1440 / 1920));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    }
    var lMinX = Math.round(width * 0.05);
    var lMaxX = Math.round(width * 0.95);
    var lMinY = Math.round(height * 0.06);
    var lMaxY = Math.round(height * 0.88);
    return { x: lMinX, y: lMinY, w: lMaxX - lMinX, h: lMaxY - lMinY, minX: lMinX, maxX: lMaxX, minY: lMinY, maxY: lMaxY };
  }

  function isBoxInsideSafeZone(box, safe) {
    if (!box || !safe) return true;
    var minX = safe.minX !== undefined ? safe.minX : safe.x;
    var maxX = safe.maxX !== undefined ? safe.maxX : safe.x + safe.w;
    var minY = safe.minY !== undefined ? safe.minY : safe.y;
    var maxY = safe.maxY !== undefined ? safe.maxY : safe.y + safe.h;
    return box.minX >= minX && box.maxX <= maxX && box.minY >= minY && box.maxY <= maxY;
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  function normTokens(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/-/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function cleanNarrationWords(text) {
    return String(text || '')
      .replace(/\[[^\]]*\]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Punctuation-weighted speech word timing (`timing.py:kata_waktu` parity).
   * Pauses on commas/periods are absorbed after each punctuated word so active words match speech cadence.
   */
  function estimateSpeechWords(text, startSec, durationSec) {
    var ws = cleanNarrationWords(text);
    if (!ws.length) return [];
    var st = Number(startSec) || 0;
    var dur = Math.max(0.2, Number(durationSec) || 1);
    var startPad = Math.min(0.12, dur * 0.04);
    var totT = Math.max(0.15, dur - startPad - 0.12);
    var weights = ws.map(function (w) {
      var last = w.slice(-1);
      var pause = ',;:'.indexOf(last) !== -1 ? 3 : ('.?!'.indexOf(last) !== -1 ? 6 : 0);
      return { w: w, wt: w.length + 1 + pause, pause: pause };
    });
    var totW = weights.reduce(function (acc, x) { return acc + x.wt; }, 0) || 1;
    var acc = 0;
    return weights.map(function (item) {
      var core = item.wt - item.pause;
      var s0 = round3(st + startPad + (acc / totW) * totT);
      var e0 = round3(st + startPad + ((acc + core) / totW) * totT);
      acc += item.wt;
      return { word: item.w, start: s0, end: Math.max(s0 + 0.04, e0) };
    });
  }

  /**
   * Resolves relative seconds inside a shot when `phrase` starts being spoken.
   * Supports exact token match first, then 4-letter stem prefix match,
   * emitting a `[CHECK]` warning when not found.
   */
  function resolveCue(phrase, words, shotStart, occurrence, warningsOut, shotLabel) {
    var ws = normTokens(phrase);
    if (!ws.length) return 0;
    var list = Array.isArray(words) ? words : [];
    var sStart = Number(shotStart) || 0;
    var nth = Math.max(0, Number(occurrence) | 0);
    var toks = [];
    for (var i = 0; i < list.length; i++) {
      var wText = list[i] && (list[i].word !== undefined ? list[i].word : list[i][0]);
      var sub = normTokens(wText);
      for (var j = 0; j < sub.length; j++) {
        toks.push({ tk: sub[j], idx: i });
      }
    }
    var hits = [];
    for (var k = 0; k <= toks.length - ws.length; k++) {
      var exact = true;
      for (var m = 0; m < ws.length; m++) {
        if (toks[k + m].tk !== ws[m]) {
          exact = false;
          break;
        }
      }
      if (exact) hits.push(k);
    }
    if (!hits.length) {
      for (var k2 = 0; k2 <= toks.length - ws.length; k2++) {
        var prefOk = true;
        for (var m2 = 0; m2 < ws.length; m2++) {
          if (toks[k2 + m2].tk.slice(0, 4) !== ws[m2].slice(0, 4)) {
            prefOk = false;
            break;
          }
        }
        if (prefOk) hits.push(k2);
      }
    }
    if (hits.length > 0) {
      var chosen = hits[Math.min(nth, hits.length - 1)];
      var wEntry = list[toks[chosen].idx];
      var wStart = wEntry && (wEntry.start !== undefined ? Number(wEntry.start) : Number(wEntry[1] || 0));
      // Handle both shot-local word timestamps and global word timestamps seamlessly
      var rel = wStart >= sStart - 1e-4 && sStart > 0 ? wStart - sStart : wStart;
      return Math.max(0, round3(rel));
    }
    var msg = '[CHECK] ' + (shotLabel || 'shot') + ": phrase '" + phrase + "' not found in narration (falling back to t=0)";
    if (Array.isArray(warningsOut) && warningsOut.indexOf(msg) === -1) {
      warningsOut.push(msg);
    }
    if (typeof global !== 'undefined') {
      global.__storyWarnings = Array.isArray(global.__storyWarnings) ? global.__storyWarnings : [];
      if (global.__storyWarnings.indexOf(msg) === -1) global.__storyWarnings.push(msg);
    }
    return 0;
  }

  function resolveWhen(item, words, shotStart, warningsOut, shotLabel) {
    if (typeof item === 'number') return item;
    if (typeof item === 'string') {
      var clean = item.indexOf('word:') === 0 ? item.slice(5) : item;
      return resolveCue(clean, words, shotStart, 0, warningsOut, shotLabel);
    }
    if (item && typeof item === 'object') {
      var phrase = item.word;
      var off = Number(item.offset || 0) || 0;
      if (phrase !== undefined && phrase !== null && String(phrase).trim() !== '') {
        var occ = Number(item.occurrence || 0) || 0;
        return Math.max(0, round3(resolveCue(String(phrase), words, shotStart, occ, warningsOut, shotLabel) + off));
      }
      var baseT = Number(item.at !== undefined ? item.at : (item.t || 0)) || 0;
      return Math.max(0, round3(baseT + off));
    }
    return 0;
  }

  function resolveWhenEnd(item, endKey, defaultEnd, words, shotStart, warningsOut, shotLabel) {
    if (!item || typeof item !== 'object') return defaultEnd;
    var altWord = item.untilWord;
    if (altWord !== undefined && String(altWord).trim() !== '') {
      var ws = normTokens(altWord);
      var t0 = resolveCue(String(altWord), words, shotStart, 0, warningsOut, shotLabel);
      return round3(t0 + 0.35 * ws.length + 0.25);
    }
    var rawEnd = item[endKey] !== undefined ? item[endKey] : item.until;
    if (rawEnd !== undefined && rawEnd !== null) {
      if (typeof rawEnd === 'number') return rawEnd;
      return resolveWhen(rawEnd, words, shotStart, warningsOut, shotLabel);
    }
    return defaultEnd;
  }

  function boxesOverlap(a, b) {
    if (!a || !b) return false;
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }

  function computeOverlapCount(primaryBox, extraBoxes, W, H, captionsEnabled) {
    var count = 0;
    var list = Array.isArray(extraBoxes) ? extraBoxes.filter(Boolean) : [];
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (boxesOverlap(list[i], list[j])) count++;
      }
    }
    if (captionsEnabled && primaryBox && W > 0 && H > 0) {
      var subTopY = H >= W ? H * 0.78 : H * 0.85;
      if (primaryBox.maxY > subTopY + 12 && primaryBox.minY < H * 0.96 && (primaryBox.maxY - primaryBox.minY) < H * 0.72) {
        count++;
      }
    }
    return count;
  }

  function extractShotCamSizeAndStage(shot) {
    var s = shot || {};
    var cam = s.camera || {};
    var init = cam.initial || cam;
    var size =
      (typeof init === 'string' ? init : (init && init.size)) ||
      cam.preset ||
      cam.move ||
      s.layout ||
      'default';
    var stage = s.stage || s.layout || 'default';
    return { size: String(size), stage: String(stage) };
  }

  function computeDirectorWarnings(story, shotReportMap) {
    var warnings = [];
    var shots = (story && Array.isArray(story.shots)) ? story.shots : [];
    for (var i = 0; i < shots.length; i++) {
      var sh = shots[i] || {};
      var sid = sh.id || ('shot' + (i + 1));
      if (i >= 2) {
        var a = extractShotCamSizeAndStage(shots[i - 2]);
        var b = extractShotCamSizeAndStage(shots[i - 1]);
        var c = extractShotCamSizeAndStage(sh);
        if (a.size === b.size && b.size === c.size && a.stage === b.stage && b.stage === c.stage && a.size !== 'default') {
          warnings.push('[CHECK] ' + sid + ': 3 consecutive shots share the same framing (' + c.size + ') & stage (' + c.stage + ').');
        }
      }
      var dur = Number(sh.duration) || 0;
      var cam = sh.camera || {};
      var moves = cam.moves || [];
      var acts = sh.actions || [];
      if (dur > 4.6 && !cam.move && !cam.preset && (!Array.isArray(moves) || moves.length === 0) && (!Array.isArray(acts) || acts.length === 0) && !(story && story.cameraStyle)) {
        warnings.push('[CHECK] ' + sid + ': duration ' + dur.toFixed(1) + 's > 4.5s without camera motion or action variation.');
      }
      var rep = shotReportMap && shotReportMap[sid];
      if (rep && rep.overlapCount > 0) {
        warnings.push('[CHECK] ' + sid + ': detected ' + rep.overlapCount + ' UI/subtitle-zone overlap(s).');
      }
    }
    var storyWarns = (typeof global !== 'undefined' && Array.isArray(global.__storyWarnings)) ? global.__storyWarnings : [];
    for (var wi = 0; wi < storyWarns.length; wi++) {
      if (warnings.indexOf(storyWarns[wi]) === -1) warnings.push(storyWarns[wi]);
    }
    return warnings;
  }

  /**
   * Collects deterministic `[globalTimeSec, sfxKind, gain]` events from camera moves,
   * transitions, actor entrances/footsteps, head emotes, speech bubbles, and screen FX.
   */
  function collectAudioEvents(story, shotWordsMap) {
    var ev = [];
    var shots = (story && Array.isArray(story.shots)) ? story.shots : [];
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i] || {};
      var sid = s.id || ('shot' + (i + 1));
      var s0 = Number(s.start) || 0;
      var words = (shotWordsMap && shotWordsMap[sid]) || estimateSpeechWords(s.caption || '', 0, s.duration || 3);
      var when = function (x) { return resolveWhen(x, words, 0, null, sid); };

      // Transition SFX
      if (i > 0) {
        var tr = s.transition;
        var trKind = typeof tr === 'string' ? tr : (tr && (tr.kind || tr.type));
        var trDur = (tr && typeof tr === 'object' && Number(tr.dur)) ? Number(tr.dur) : 0.5;
        if (trKind === 'whip' || trKind === 'slide' || trKind === 'slide-push') {
          ev.push([round3(Math.max(0, s0 - trDur * 0.5)), 'whoosh', 0.8]);
        } else if (trKind === 'iris') {
          ev.push([round3(Math.max(0, s0 - trDur * 0.5)), 'iris', 0.7]);
        } else if (trKind === 'zoom' || trKind === 'zoom-cross' || trKind === 'blink') {
          ev.push([round3(Math.max(0, s0 - trDur * 0.5)), 'soft-whoosh', 0.75]);
        } else if (trKind === 'flash') {
          ev.push([round3(Math.max(0, s0 - 0.02)), 'flash', 0.8]);
        }
      }

      // Camera move SFX
      var cam = s.camera || {};
      var camMoves = Array.isArray(cam.moves) ? cam.moves : [];
      for (var cm = 0; cm < camMoves.length; cm++) {
        var g = camMoves[cm] || {};
        var gk = String(g.kind || g.type || g.move || '');
        var gt = s0 + when(g);
        if (gk === 'whip') ev.push([round3(gt), 'whoosh', 1.0]);
        else if (gk === 'fly-to' || gk === 'snap-zoom') ev.push([round3(gt), 'soft-whoosh', 0.7]);
        else if (gk === 'punch') ev.push([round3(gt), 'thud', 0.8]);
        else if (gk === 'shake') ev.push([round3(gt), 'thud', 1.0]);
      }

      // 2D `actors[]` actions / footsteps / emotes
      var actors = Array.isArray(s.actors) ? s.actors : [];
      for (var ai = 0; ai < actors.length; ai++) {
        var ac = actors[ai] || {};
        if (ac.enter) {
          var mt = s0 + when(ac.enter);
          var mg = ac.enter.style || 'walk';
          ev.push([round3(mt), mg === 'pop' ? 'pop' : (mg === 'drop' || mg === 'hop' ? 'boing' : 'footstep'), 0.8]);
        }
        var aActs = Array.isArray(ac.actions) ? ac.actions : [];
        for (var ak = 0; ak < aActs.length; ak++) {
          var act = aActs[ak] || {};
          var at0 = s0 + when(act);
          if (act.emote) {
            var icMap = { exclaim: 'ding', question: 'question', heart: 'sparkle', idea: 'sparkle', sparkle: 'sparkle', star: 'sparkle', sleep: 'zzz', zzz: 'zzz' };
            ev.push([round3(at0), icMap[act.emote] || 'pop', 0.8]);
          }
          if (act.style === 'hop' || act.anim === 'hop') ev.push([round3(at0), 'boing', 0.8]);
          else if (act.toX !== undefined || act.style === 'walk' || act.style === 'run') {
            var wDur = Number(act.dur || act.duration || 1.0);
            var steps = Math.max(1, Math.min(8, Math.round(wDur * (act.style === 'run' ? 4.2 : 2.6))));
            for (var si = 0; si < steps; si++) {
              ev.push([round3(at0 + (wDur * si) / steps), 'footstep', 0.45]);
            }
          }
        }
      }

      // Canonical 3D/2D `actions[]`
      var stdActs = Array.isArray(s.actions) ? s.actions : [];
      for (var sa = 0; sa < stdActs.length; sa++) {
        var sAct = stdActs[sa] || {};
        var sat = s0 + when(sAct);
        if (sAct.anim === 'pop-in') ev.push([round3(sat), 'pop', 0.75]);
        else if (sAct.anim === 'hop') ev.push([round3(sat), 'boing', 0.75]);
        else if (sAct.anim === 'shock') ev.push([round3(sat), 'ding', 0.8]);
        else if (sAct.emote === 'idea' || sAct.emote === 'heart') ev.push([round3(sat), 'sparkle', 0.75]);
        else if (sAct.emote === 'exclaim') ev.push([round3(sat), 'ding', 0.75]);
      }

      // Speech bubbles, comic overlays, screen FX, alarm
      var bubbles = s.bubbles || [];
      for (var bi = 0; bi < bubbles.length; bi++) ev.push([round3(s0 + when(bubbles[bi])), 'pop', 0.5]);
      var texts = s.overlays || [];
      for (var ti = 0; ti < texts.length; ti++) {
        var tg = texts[ti] && texts[ti].style;
        ev.push([round3(s0 + when(texts[ti])), tg === 'burst' ? 'burst' : 'tick', 0.7]);
      }
      var fxList = s.fx || [];
      for (var fi = 0; fi < fxList.length; fi++) {
        var fk = fxList[fi] && fxList[fi].kind;
        if (fk === 'flash') ev.push([round3(s0 + when(fxList[fi])), 'flash', 0.8]);
      }
      if (s.alarm || (s.options && s.options.alarm)) ev.push([round3(s0 + 0.2), 'alarm', 1.0]);
      var extraSfx = Array.isArray(s.sfx) ? s.sfx : [];
      for (var xi = 0; xi < extraSfx.length; xi++) {
        var sx = extraSfx[xi] || {};
        if (sx.kind) {
          ev.push([round3(s0 + when(sx)), String(sx.kind), Number(sx.gain || 1.0)]);
        }
      }
    }
    ev.sort(function (a, b) { return a[0] - b[0]; });
    return ev;
  }

  /**
   * Normalizes legacy Dialect B (`meta`, `startSec`/`endSec`, `captions[]`) into
   * canonical Dialect A (`canvas: { w, h, fps }`, `shots[i]: { start, duration }`,
   * `captions: { enabled, items }`). Idempotent on Dialect A inputs.
   */
  function normalizeStory(raw) {
    if (!raw || typeof raw !== 'object') return { title: 'Untitled', canvas: { w: 1080, h: 1920, fps: 30 }, captions: { enabled: false }, shots: [] };
    var story = Object.assign({}, raw);
    var meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : null;

    var w =
      (raw.canvas && raw.canvas.w) ||
      (meta && (meta.width || meta.w)) ||
      (raw.aspect === '16:9' ? 1920 : 1080);
    var h =
      (raw.canvas && raw.canvas.h) ||
      (meta && (meta.height || meta.h)) ||
      (raw.aspect === '16:9' ? 1080 : 1920);
    var fps =
      (raw.canvas && raw.canvas.fps) ||
      (meta && meta.fps) ||
      raw.fps ||
      30;

    story.canvas = { w: Number(w) || 1080, h: Number(h) || 1920, fps: Number(fps) || 30 };
    if (!story.title && meta && meta.title) story.title = meta.title;
    if (!story.theme && meta && meta.theme) story.theme = meta.theme;

    var rawShots = Array.isArray(raw.shots) ? raw.shots : [];
    var runningStart = 0;
    story.shots = rawShots.map(function (sh, idx) {
      var s = Object.assign({}, sh);
      if (!s.id) s.id = 'shot' + (idx + 1);
      var st = s.start !== undefined
        ? Number(s.start)
        : s.startSec !== undefined
          ? Number(s.startSec)
          : runningStart;
      var capWords = cleanNarrationWords(s.caption || '').length;
      var derivedDur = capWords > 0 ? Math.max(3.0, round3(capWords / 2.7 + 0.8)) : 4;
      var du =
        s.duration !== undefined
          ? Number(s.duration)
          : s.endSec !== undefined
            ? round3(Number(s.endSec) - st)
            : derivedDur;
      s.start = Number.isFinite(st) ? st : runningStart;
      s.duration = Number.isFinite(du) && du > 0 ? du : 4;
      runningStart = round3(s.start + s.duration);
      return s;
    });

    if (Array.isArray(raw.captions)) {
      var items = raw.captions.map(function (c) {
        var ci = Object.assign({}, c);
        var cs = ci.start !== undefined ? Number(ci.start) : Number(ci.startSec || 0);
        var cd =
          ci.duration !== undefined
            ? Number(ci.duration)
            : ci.endSec !== undefined
              ? round3(Number(ci.endSec) - cs)
              : 2;
        ci.start = Number.isFinite(cs) ? cs : 0;
        ci.duration = Number.isFinite(cd) && cd > 0 ? cd : 2;
        return ci;
      });
      story.captions = { enabled: items.length > 0, items: items };
    } else if (!raw.captions || typeof raw.captions !== 'object') {
      story.captions = { enabled: false };
    }

    return story;
  }

  function findShot(story, t) {
    if (!story || !Array.isArray(story.shots) || !story.shots.length) return null;
    var ts = Number(t) || 0;
    for (var i = 0; i < story.shots.length; i++) {
      var s = story.shots[i];
      var st = s.start !== undefined ? s.start : (s.startSec || 0);
      var du = s.duration !== undefined ? s.duration : Math.max(0.001, (s.endSec || st) - st);
      if (ts >= st && ts < st + du) {
        return { shot: s, index: i, start: st, duration: du, localTime: clamp(ts - st, 0, du) };
      }
    }
    var lastIdx = story.shots.length - 1;
    var last = story.shots[lastIdx];
    var lst = last.start !== undefined ? last.start : (last.startSec || 0);
    var ldu = last.duration !== undefined ? last.duration : Math.max(0.001, (last.endSec || lst) - lst);
    return { shot: last, index: lastIdx, start: lst, duration: ldu, localTime: clamp(ts - lst, 0, ldu) };
  }

  function findCaption(story, t) {
    if (!story || !story.captions) return null;
    if (!Array.isArray(story.captions) && story.captions.enabled === false) return null;
    var items = Array.isArray(story.captions) ? story.captions : (story.captions.items || []);
    var ts = Number(t) || 0;
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var cs = c.start !== undefined ? c.start : (c.startSec || 0);
      var ce = c.duration !== undefined ? cs + c.duration : (c.endSec || cs);
      if (ts >= cs && ts < ce) return c;
    }
    return null;
  }

  function synthesizeWords(text, start, duration) {
    var tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    var step = (Number(duration) || 1) / tokens.length;
    return tokens.map(function (w, idx) {
      return {
        word: w,
        start: round3((Number(start) || 0) + idx * step),
        end: round3((Number(start) || 0) + (idx + 1) * step),
      };
    });
  }

  async function fetchJson(url) {
    try {
      var res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (_err) {
      return null;
    }
  }

  async function loadStory() {
    var raw = await fetchJson('story.json');
    if (!raw) raw = await fetchJson('story.example.json');
    return normalizeStory(raw);
  }

  async function preloadImages(urls) {
    var map = {};
    var unique = Array.from(new Set((urls || []).filter(Boolean)));
    await Promise.all(
      unique.map(function (url) {
        return new Promise(function (resolve) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            map[url] = img;
            resolve();
          };
          img.onerror = function () {
            resolve();
          };
          img.src = url;
        });
      }),
    );
    return map;
  }

  function computeTotalDuration(story) {
    if (story && story.meta && Number(story.meta.durationSec) > 0) {
      return Number(story.meta.durationSec);
    }
    var shots = (story && story.shots) || [];
    var maxEnd = 0;
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      var st = s.start !== undefined ? s.start : (s.startSec || 0);
      var en = s.duration !== undefined ? st + s.duration : (s.endSec || st);
      if (en > maxEnd) maxEnd = en;
    }
    return maxEnd || 30;
  }

  /**
   * Boots a declarative skill runtime with standardized `window.renderAt`, `window.__seek`,
   * `window.__ready`, `window.__filmMeta`, `window.__shotReport`, and Mode 'M' (?microstock=1).
   */
  function boot(config) {
    var cfg = config || {};
    var story = null;
    var canvas = null;
    var ctx = null;
    var W = 1080;
    var H = 1920;
    var fps = 30;
    var totalDuration = 30;
    var currentTime = 0;
    var microOverride = false;
    var customState = null;
    var shotWordsMap = {};

    global.__storyRuntimeErrors = global.__storyRuntimeErrors || [];
    global.__storyWarnings = global.__storyWarnings || [];
    global.__directorWarnings = global.__directorWarnings || [];
    global.__audioEvents = global.__audioEvents || [];

    function getSafeZone() {
      if (typeof cfg.computeSafeZone === 'function') return cfg.computeSafeZone(W, H);
      return computeSafeZone(W, H);
    }

    function renderAt(t) {
      if (!story) return;
      currentTime = Number(t) || 0;
      var resolved = findShot(story, currentTime);
      if (!resolved) return;

      var safe = getSafeZone();
      var micro = isMicrostock(story, microOverride);
      var caption = micro ? null : findCaption(story, currentTime);
      var errors = [];
      var bbox = null;
      var extraBoxes = [];
      var camRes = null;
      var sid = resolved.shot.id;
      var activeWords = shotWordsMap[sid] || [];
      var shotWarnings = [];

      try {
        if (typeof cfg.renderShot === 'function') {
          var env = {
            story: story,
            shot: resolved.shot,
            shotIndex: resolved.index,
            t: currentTime,
            localTime: resolved.localTime,
            start: resolved.start,
            duration: resolved.duration,
            W: W,
            H: H,
            safe: safe,
            canvas: canvas,
            ctx: ctx,
            micro: micro,
            caption: caption,
            words: activeWords,
            when: function (item) {
              return resolveWhen(item, activeWords, 0, shotWarnings, sid);
            },
            whenEnd: function (item, defVal) {
              return resolveWhenEnd(item, 'until', defVal, activeWords, 0, shotWarnings, sid);
            },
            pushOverlayBox: function (b) {
              if (b) extraBoxes.push(b);
            },
            state: customState,
            camera: null,
          };

          var camCfg = cfg.camera && typeof cfg.camera === 'object' ? cfg.camera : null;
          var hasCamOptIn = Boolean(
            camCfg &&
              global.StoryCamera &&
              typeof global.StoryCamera.resolve === 'function' &&
              (story.cameraStyle || (resolved.shot && resolved.shot.camera && typeof resolved.shot.camera === 'object'))
          );
          if (hasCamOptIn) {
            var focusBox = typeof cfg.measureShot === 'function' ? cfg.measureShot(env) : null;
            camRes = global.StoryCamera.resolve(story, resolved.shot, resolved.localTime, resolved.duration, {
              W: W,
              H: H,
              safe: safe,
              focusBox: focusBox || null,
              allowAutoDollyOut: camCfg.allowAutoDollyOut !== false,
              limits: camCfg.limits || { maxZoom: 1.32, maxPan: 0.08, maxRollDeg: 3.0 },
            });
            env.camera = camRes;
          }

          if (camRes && camRes.plan && camRes.plan.active && camCfg && camCfg.applyToContext && ctx) {
            if (camCfg.backdrop) {
              ctx.fillStyle = typeof camCfg.backdrop === 'function' ? camCfg.backdrop(env) : camCfg.backdrop;
              ctx.fillRect(0, 0, W, H);
            }
            ctx.save();
            global.StoryCamera.apply2D(ctx, camRes.rig, W, H);
            bbox = cfg.renderShot(env) || null;
            ctx.restore();
          } else {
            bbox = cfg.renderShot(env) || null;
          }
          if (!bbox && typeof cfg.measureShot === 'function') {
            bbox = cfg.measureShot(env) || null;
          }
          if (
            bbox &&
            camRes &&
            camRes.plan &&
            camRes.plan.active &&
            !(camCfg && camCfg.skipBboxProject) &&
            global.StoryCamera &&
            typeof global.StoryCamera.projectBox2D === 'function'
          ) {
            bbox = global.StoryCamera.projectBox2D(bbox, camRes.rig, W, H);
          }
        }
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        errors.push(msg);
        global.__storyRuntimeErrors.push({ skill: cfg.id || 'unknown', t: currentTime, error: msg });
      }

      if (!bbox) {
        bbox = {
          behind: false,
          minX: safe.minX !== undefined ? safe.minX : safe.x,
          minY: safe.minY !== undefined ? safe.minY : safe.y,
          maxX: safe.maxX !== undefined ? safe.maxX : safe.x + safe.w,
          maxY: safe.maxY !== undefined ? safe.maxY : safe.y + safe.h,
          width: safe.w,
          height: safe.h,
        };
      }

      var captionsActive = !micro && Boolean(story.captions && story.captions.enabled);
      var overlapCount = computeOverlapCount(bbox, extraBoxes, W, H, captionsActive);

      global.__shotReport = global.__shotReport || {};
      global.__shotReport[resolved.shot.id] = {
        shotId: resolved.shot.id,
        t: round3(currentTime),
        localTime: round3(resolved.localTime),
        layout: resolved.shot.layout || resolved.shot.stage || null,
        focusBboxInSafeZone: isBoxInsideSafeZone(bbox, safe),
        bbox: bbox,
        overlapCount: overlapCount,
        warnings: shotWarnings,
        safeZone: {
          minX: safe.minX !== undefined ? safe.minX : safe.x,
          maxX: safe.maxX !== undefined ? safe.maxX : safe.x + safe.w,
          minY: safe.minY !== undefined ? safe.minY : safe.y,
          maxY: safe.maxY !== undefined ? safe.maxY : safe.y + safe.h,
        },
        errors: errors,
      };
      global.__directorWarnings = computeDirectorWarnings(story, global.__shotReport);
    }

    global.renderAt = renderAt;
    global.__seek = renderAt;

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('keydown', function (e) {
        if (e && (e.key === 'm' || e.key === 'M')) {
          microOverride = !microOverride;
          renderAt(currentTime);
        }
      });
    }

    async function loadShotWords(st) {
      var map = {};
      var shots = (st && Array.isArray(st.shots)) ? st.shots : [];
      await Promise.all(
        shots.map(async function (s) {
          var sid = s.id;
          var wordsUrl = (s.audio && s.audio.words) || (st.audio && st.audio.words) || '';
          if (wordsUrl && typeof fetch === 'function') {
            var clean = wordsUrl.charAt(0) === '/' ? wordsUrl : '/' + wordsUrl;
            var fetched = await fetchJson(clean);
            var arr = Array.isArray(fetched) ? fetched : (fetched && Array.isArray(fetched.words) ? fetched.words : null);
            if (arr && arr.length > 0) {
              map[sid] = arr;
              return;
            }
          }
          map[sid] = estimateSpeechWords(s.caption || '', 0, s.duration || 3);
        })
      );
      return map;
    }

    async function start() {
      var raw = await fetchJson('story.json');
      if (!raw) raw = await fetchJson('story.example.json');
      story = normalizeStory(raw);
      W = story.canvas.w;
      H = story.canvas.h;
      fps = story.canvas.fps;
      totalDuration = computeTotalDuration(story);
      shotWordsMap = await loadShotWords(story);
      global.__audioEvents = collectAudioEvents(story, shotWordsMap);

      if (cfg.contextType !== 'none' && typeof document !== 'undefined') {
        canvas =
          (cfg.canvasId ? document.getElementById(cfg.canvasId) : null) ||
          document.getElementById('stage-2d') ||
          document.querySelector('canvas');
        if (canvas) {
          canvas.width = W;
          canvas.height = H;
          if (!cfg.contextType || cfg.contextType === '2d') {
            ctx = canvas.getContext('2d');
          }
        }
      }

      if (typeof cfg.init === 'function') {
        customState = await cfg.init({
          story: story,
          canvas: canvas,
          ctx: ctx,
          W: W,
          H: H,
          fps: fps,
          totalDuration: totalDuration,
          safe: getSafeZone(),
        });
      }

      global.__filmMeta = {
        title: story.title || cfg.defaultTitle || cfg.id || 'Untitled',
        width: W,
        height: H,
        fps: fps,
        duration: totalDuration,
        durationInFrames: Math.round(totalDuration * fps),
        scenes: (story.shots || []).map(function (s) {
          return {
            id: s.id,
            title: s.id,
            start: s.start,
            duration: s.duration,
            layout: s.layout,
          };
        }),
      };

      renderAt(0);
      global.__ready = true;
    }

    start();
  }

  global.StoryCore = {
    version: 1,
    directorVersion: 2,
    clamp: clamp,
    easeOutCubic: easeOutCubic,
    easeOutExpo: easeOutExpo,
    isMicrostock: isMicrostock,
    computeSafeZone: computeSafeZone,
    computePortraitRailSafeZone: computePortraitRailSafeZone,
    isBoxInsideSafeZone: isBoxInsideSafeZone,
    boxesOverlap: boxesOverlap,
    computeOverlapCount: computeOverlapCount,
    normalizeStory: normalizeStory,
    findShot: findShot,
    findCaption: findCaption,
    synthesizeWords: synthesizeWords,
    estimateSpeechWords: estimateSpeechWords,
    resolveCue: resolveCue,
    resolveWhen: resolveWhen,
    resolveWhenEnd: resolveWhenEnd,
    collectAudioEvents: collectAudioEvents,
    computeDirectorWarnings: computeDirectorWarnings,
    fetchJson: fetchJson,
    loadStory: loadStory,
    preloadImages: preloadImages,
    computeTotalDuration: computeTotalDuration,
    boot: boot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
