/**
 * mg-pixel-arcade story-runtime.js (Core API v1)
 * Skill-specific layout rendering powered by /script/story-core.js.
 */
(function () {
  'use strict';

  var story = null;
  var ctx = null;
  var W = 1080;
  var H = 1920;
  var PW = 180;
  var PH = 320;
  var buf = null;

  function splitWords(text, maxChars) {
    var words = String(text || '').trim().split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var cand = cur ? cur + ' ' + words[i] : words[i];
      if (cand.length <= maxChars || !cur) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= 2) break;
      }
    }
    if (cur && lines.length < 3) lines.push(cur);
    return lines;
  }

  function measurePixelShot(env) {
    var safe = env.safe;
    var isPortrait = env.H > env.W;
    var sx = env.W / (isPortrait ? 180 : 320);
    var sy = env.H / (isPortrait ? 320 : 180);
    var minX = Math.max(safe.x + 12, Math.round((isPortrait ? 12 : 18) * sx));
    var maxX = Math.min(safe.x + safe.w - 12, Math.round((isPortrait ? 166 : 300) * sx));
    var minY = env.micro
      ? Math.max(safe.y + 40, Math.round((isPortrait ? 130 : 62) * sy))
      : Math.max(safe.y + 12, Math.round((isPortrait ? 20 : 10) * sy));
    var maxY = Math.min(safe.y + safe.h - 24, Math.round((isPortrait ? 236 : 156) * sy));
    return {
      behind: false,
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY,
      width: Math.max(10, maxX - minX),
      height: Math.max(10, maxY - minY)
    };
  }

  window.StoryCore.boot({
    id: 'mg-pixel-arcade',
    defaultTitle: 'Pixel Quest 16-Bit',
    camera: { limits: { maxZoom: 1.28, maxPan: 0.08, maxRollDeg: 2.5 } },
    measureShot: measurePixelShot,
    init: function (env) {
      story = env.story;
      ctx = env.ctx;
      W = env.W;
      H = env.H;
      PW = H > W ? 180 : 320;
      PH = H > W ? 320 : 180;
      buf = PixelKit.createPixelBuffer(PW, PH);
      return { PW: PW, PH: PH, buf: buf };
    },
    renderShot: function (env) {
      story = env.story;
      ctx = env.ctx;
      W = env.W;
      H = env.H;
      var shot = env.shot;
      var t = env.t;
      var localT = env.localTime;
      var stage = shot.theme || story.theme || (story.meta && story.meta.theme) || 'day';
    var f = Math.round(t * 30);
    var lut = PixelKit.makeLUT(stage, f);
    var micro = env.micro;
    var isPortrait = H > W;
    var layout = shot.layout || 'side-scroll';

    var camX = layout === 'title-logo' || layout === 'stage-clear'
      ? Math.round(t * 8)
      : Math.round(t * 24);

    // 1. Render full-bleed SNES parallax world!
    var groundY = buf.drawWorld(stage, camX, f, {
      waterfall: true,
      bridge: layout === 'side-scroll' || layout === 'boss-encounter' || layout === 'dialogue-cutscene'
    });

    // 2. Hero & world props choreography
    var action = shot.heroAction || (layout === 'treasure-reveal' ? 'get' : (layout === 'stage-clear' ? 'cheer' : 'run'));
    var heroSpr = PixelKit.getHeroSprite(action === 'item-get' ? 'get' : (action === 'bop' ? 'jump' : action), f);
    var heroX = Math.round(PW * (layout === 'treasure-reveal' ? 0.42 : (layout === 'boss-encounter' ? 0.30 : 0.34)));
    var jumpArc = (action === 'jump' || action === 'bop') ? Math.round(Math.abs(Math.sin(t * 4.5)) * 22) : 0;
    var heroY = groundY - heroSpr.h + 4 - jumpArc;

    // Spinning coins arc
    if (layout === 'side-scroll' || layout === 'boss-encounter') {
      var coinSpr = PixelKit.COIN[Math.floor(f / 4) & 3];
      for (var c = 0; c < 3; c++) {
        var cx = Math.round(PW * 0.56 + c * 15);
        var cy = groundY - 26 - (c === 1 ? 8 : 0) + Math.round(Math.sin(t * 5 + c) * 2);
        buf.blit(coinSpr, cx, cy, false);
      }
    }

    // Slime enemy on right
    if (layout === 'side-scroll' || layout === 'boss-encounter') {
      var slimeSpr = (Math.floor(f / 6) % 2 === 0) ? PixelKit.SLIME_A : PixelKit.SLIME_B;
      var slimeX = Math.round(PW * 0.72 + Math.sin(t * 2.5) * 8);
      var slimeY = groundY - slimeSpr.h + 1;
      buf.blit(slimeSpr, slimeX, slimeY, false);
    }

    // Treasure chest + radiant crystal aura!
    if (layout === 'treasure-reveal' || layout === 'title-logo' || layout === 'stage-clear') {
      var chestOpen = layout !== 'dialogue-cutscene';
      var chestSpr = chestOpen ? PixelKit.CHEST_OPEN : PixelKit.CHEST_CLOSED;
      var chX = Math.round(PW * 0.62);
      var chY = groundY - chestSpr.h + 2;

      if (chestOpen) {
        // Radiant blue/gold crystal aura behind hero & chest
        var auraX = heroX + (heroSpr.w >> 1);
        var auraY = heroY + 6;
        var auraR = 24 + Math.round(Math.sin(t * 6) * 3);
        for (var ay = -auraR; ay <= auraR; ay++) {
          for (var ax = -auraR; ax <= auraR; ax++) {
            var d = Math.sqrt(ax * ax + ay * ay);
            if (d < auraR && ((ax + ay + f) & 3) === 0) {
              buf.px(auraX + ax, auraY + ay, d < auraR * 0.5 ? PixelKit.M(7) : PixelKit.M(5));
            }
          }
        }
        buf.blit(PixelKit.ORB, auraX - 5, heroY - 12 + Math.round(Math.sin(t * 4) * 2), false);
      }
      buf.blit(chestSpr, chX, chY, false);

      // Twinkling sparkles
      var spSpr = PixelKit.SPARK[Math.floor(f / 5) % 3];
      buf.blit(spSpr, chX - 8, chY - 14, false);
      buf.blit(spSpr, chX + 18, chY - 10, false);
    }

    buf.blit(heroSpr, heroX, heroY, false);

    // 3. Top Pixel HUD + Extruded 3D Pixel Title + RPG Dialogue Box (hidden in Mode 'M'!)
    var safe = isPortrait
      ? { x: 56, y: 80, w: 896, h: 1340 }
      : { x: 110, y: 80, w: W - 220, h: H - 220 };

    if (!micro) {
      // Top SCORE & COINS pixel HUD (strictly inside safe zone!)
      var hudY = isPortrait ? 20 : 10;
      var hudX = isPortrait ? 14 : 18;
      var scoreVal = String(shot.score !== undefined ? shot.score : (1200 + Math.floor(t * 150))).padStart(6, '0');
      buf.drawSmallText('SCORE', hudX, hudY, PixelKit.M(8), PixelKit.M(0), 1);
      buf.drawSmallText(scoreVal, hudX, hudY + 9, PixelKit.M(14), PixelKit.M(0), 1);

      var coinCount = 'X' + String(shot.coins !== undefined ? shot.coins : Math.floor(t * 2 + 5)).padStart(2, '0');
      buf.blit(PixelKit.COIN[Math.floor(f / 5) & 3], PW - (isPortrait ? 46 : 44), hudY, false);
      buf.drawSmallText(coinCount, PW - (isPortrait ? 34 : 32), hudY + 2, PixelKit.M(8), PixelKit.M(0), 1);

      // Center extruded 3D golden pixel headline in sky area!
      var maxLineChars = isPortrait ? 10 : 14;
      var titleLines = splitWords(shot.headline || 'PIXEL QUEST', maxLineChars);
      var longestLine = 0;
      for (var tl = 0; tl < titleLines.length; tl++) {
        if (titleLines[tl].length > longestLine) longestLine = titleLines[tl].length;
      }
      var cellSize = isPortrait ? (longestLine >= 8 ? 2 : 3) : (longestLine >= 12 ? 2 : 3);
      var titleTopY = isPortrait ? 52 : 28;
      var shinePos = ((localT * 0.7) % 1.6) - 0.3;
      buf.drawExtrudedTitle(titleLines, Math.round(PW * 0.48), titleTopY, cellSize, shinePos);

      // Metric badge / crimson ribbon below title
      if (shot.metric || shot.badge) {
        var ribText = String(shot.metric || shot.badge).toUpperCase();
        var ribW = Math.min(PW - 32, ribText.length * 6 + 16);
        var ribX = Math.round(PW * 0.48 - ribW * 0.5);
        var ribY = titleTopY + titleLines.length * (7 * cellSize + cellSize + 4) + 6;
        buf.rect(ribX + 2, ribY + 2, ribW, 13, PixelKit.M(0));
        buf.rect(ribX, ribY, ribW, 13, PixelKit.M(27));
        buf.rect(ribX, ribY, ribW, 1, PixelKit.M(12));
        buf.rect(ribX, ribY + 12, ribW, 1, PixelKit.M(26));
        buf.drawSmallText(ribText, ribX + 8, ribY + 3, PixelKit.M(15), PixelKit.M(0), 1);
      }

      // RPG Dialogue Box (typewriter cadence) in lower safe region for dialogue/subtext
      if (shot.subtext) {
        var boxW = isPortrait ? PW - 28 : Math.round(PW * 0.72);
        var boxH = isPortrait ? 42 : 30;
        var boxX = isPortrait ? 12 : Math.round((PW - boxW) * 0.5);
        var boxY = isPortrait ? 156 : (groundY - 40);
        buf.drawDialogueFrame(boxX, boxY, boxW, boxH);
        var typedLen = Math.max(6, Math.floor(localT * 36));
        var typed = String(shot.subtext).slice(0, typedLen);
        var dLines = splitWords(typed, isPortrait ? 22 : 34);
        for (var dl = 0; dl < Math.min(3, dLines.length); dl++) {
          buf.drawSmallText(dLines[dl], boxX + 8, boxY + 8 + dl * 10, PixelKit.M(8), PixelKit.M(0), 1);
        }
        // Blinking triangle/block cursor
        if ((Math.floor(f / 8) % 2) === 0) {
          buf.rect(boxX + boxW - 10, boxY + boxH - 9, 4, 4, PixelKit.M(14));
        }
      }

      // Bottom Caption bar inside pixel canvas
      var cap = env.caption;
      if (cap && cap.text) {
        var cTxt = String(cap.text).toUpperCase();
        var cw = Math.min(PW - 24, cTxt.length * 6 + 16);
        var cx2 = Math.round(PW * 0.48 - cw * 0.5);
        var cy2 = PH - (isPortrait ? 46 : 22);
        buf.drawDialogueFrame(cx2, cy2, cw, 15);
        buf.drawSmallText(cTxt, cx2 + 8, cy2 + 4, PixelKit.M(14), PixelKit.M(0), 1);
      }
    }

    // 4. Flush integer-scaled pixel buffer + CRT scanlines onto output canvas!
    var camActive = Boolean(env.camera && env.camera.plan && env.camera.plan.active && window.StoryCamera);
    if (camActive) {
      ctx.fillStyle = '#0B1021';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      window.StoryCamera.apply2D(ctx, env.camera.rig, W, H);
      buf.flushToCanvas(ctx, W, H, lut);
      ctx.restore();
    } else {
      buf.flushToCanvas(ctx, W, H, lut);
    }

    return measurePixelShot(env);
    }
  });
})();
