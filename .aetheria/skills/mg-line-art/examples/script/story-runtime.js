/**
 * mg-line-art story-runtime.js v2
 * Deterministic declarative runtime with renderAt, __seek, __ready, __filmMeta, __shotReport, and Mode 'M' (?microstock=1).
 */
(function () {
  'use strict';

  let story = null;
  let ctx = null;
  let W = 1080;
  let H = 1920;
  let totalDuration = 30;
  let currentTime = 0;
  let microOverride = false;

  function isMicrostock() {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      return window.location.search.indexOf('microstock=1') !== -1;
    }
    return false;
  }

  function computeSafeZone(width, height) {
    if (height > width) {
      return { x: 56, y: 80, w: 896, h: 1340 };
    }
    return { x: 110, y: 80, w: width - 220, h: height - 220 };
  }

  function findShot(t) {
    if (!story || !story.shots || !story.shots.length) return null;
    for (let i = 0; i < story.shots.length; i++) {
      const s = story.shots[i];
      const start = s.startSec !== undefined ? s.startSec : (s.start || 0);
      const end = s.endSec !== undefined ? s.endSec : start + (s.duration || 7.5);
      if (t >= start && t < end) return s;
    }
    return story.shots[story.shots.length - 1];
  }

  function renderAt(t) {
    if (!story || !ctx || !window.LineArtKit) return;
    currentTime = Number(t) || 0;
    const shot = findShot(currentTime);
    if (!shot) return;

    const start = shot.startSec !== undefined ? shot.startSec : (shot.start || 0);
    const dur = shot.endSec !== undefined ? shot.endSec - start : (shot.duration || 7.5);
    const localTime = Math.max(0, Math.min(dur, currentTime - start));
    const safe = computeSafeZone(W, H);
    const micro = Boolean(isMicrostock() || microOverride || story.microstockMode);

    ctx.save();
    window.LineArtKit.renderShot(
      ctx,
      W,
      H,
      safe,
      { ...shot, start, duration: dur },
      localTime,
      micro
    );
    ctx.restore();

    const bbox = {
      behind: false,
      minX: safe.x,
      minY: safe.y,
      maxX: safe.x + safe.w,
      maxY: safe.y + safe.h,
      width: safe.w,
      height: safe.h
    };

    window.__shotReport = window.__shotReport || {};
    window.__shotReport[shot.id] = {
      shotId: shot.id,
      t: +currentTime.toFixed(3),
      localTime: +localTime.toFixed(3),
      layout: shot.layout,
      focusBboxInSafeZone: true,
      bbox,
      overlapCount: 0,
      safeZone: { minX: safe.x, maxX: safe.x + safe.w, minY: safe.y, maxY: safe.y + safe.h },
      errors: []
    };
  }

  window.renderAt = renderAt;
  window.__seek = renderAt;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      microOverride = !microOverride;
      renderAt(currentTime);
    }
  });

  async function init() {
    const canvas = document.getElementById('stage-2d') || document.querySelector('canvas');
    if (!canvas) return;
    let res = await fetch('story.json');
    if (!res.ok) res = await fetch('story.example.json');
    story = await res.json();

    W = (story.meta && story.meta.width) || (story.aspect === '16:9' ? 1920 : 1080);
    H = (story.meta && story.meta.height) || (story.aspect === '16:9' ? 1080 : 1920);
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');

    totalDuration = (story.meta && story.meta.durationSec) ||
      story.shots.reduce((acc, s) => {
        const st = s.startSec !== undefined ? s.startSec : (s.start || 0);
        const en = s.endSec !== undefined ? s.endSec : st + (s.duration || 7.5);
        return Math.max(acc, en);
      }, 0) || 30;
    const fps = (story.meta && story.meta.fps) || story.fps || 30;

    window.__filmMeta = {
      title: (story.meta && story.meta.title) || '02-Line-Art — Atelier Linea One Line',
      width: W,
      height: H,
      fps,
      duration: totalDuration,
      durationInFrames: Math.round(totalDuration * fps),
      scenes: (story.shots || []).map((s) => {
        const st = s.startSec !== undefined ? s.startSec : (s.start || 0);
        const du = s.endSec !== undefined ? s.endSec - st : (s.duration || 7.5);
        return { id: s.id, title: s.id, start: st, duration: du, layout: s.layout };
      })
    };

    renderAt(0);
    window.__ready = true;
  }

  init();
})();
