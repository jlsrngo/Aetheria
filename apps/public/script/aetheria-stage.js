/**
 * Aetheria Universal Compositing / Layer Engine & Unified Camera Adapter (`/script/aetheria-stage.js`).
 *
 * Unifies Canvas 2D, SVG/HTML DOM overlays, registered cutout/SVG assets (`assets.json`),
 * Three.js 3D canvases, and WebGL2 post-processing (`aetheria-post.js`) under a single
 * deterministic `window.renderAt(t)` timeline and synchronized 2D/3D camera contract:
 * - Layer IDs, parent-child affine transform hierarchy (`localToWorld`), anchor/pivot,
 *   z-order sorting, opacity inheritance, blend modes, masks/clipping, and depth parallax.
 * - Shared camera adapter syncing `AM.evalCameraTrack` / `StoryCamera` across Canvas 2D,
 *   DOM/SVG transforms, and Three.js `PerspectiveCamera` (`applyTo3D`).
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;
  const ALLOWED_TRACK_NAMES = [
    "x",
    "y",
    "position",
    "scale",
    "scaleX",
    "scaleY",
    "rotation",
    "rotationDeg",
    "opacity",
    "anchor",
    "width",
    "height",
  ];
  let reportedMissingTracks = false;

  function reportMissingTracksOnce() {
    if (reportedMissingTracks) return;
    reportedMissingTracks = true;
    const text = "[aetheria-stage] layer.tracks ignored because window.AetheriaTracks is not loaded.";
    if (global && typeof global === "object") {
      global.__aetheriaErrors = Array.isArray(global.__aetheriaErrors) ? global.__aetheriaErrors : [];
      if (global.__aetheriaErrors.length < 16 && global.__aetheriaErrors.indexOf(text) === -1) {
        global.__aetheriaErrors.push(text);
      }
    }
  }

  function validateLayerTracks(layerId, rawTracks) {
    if (rawTracks === undefined || rawTracks === null) return null;
    if (typeof rawTracks !== "object" || Array.isArray(rawTracks)) {
      throw new Error("AetheriaStage.addLayer('" + layerId + "'): 'tracks' must be a plain object.");
    }
    const names = Object.keys(rawTracks);
    const clean = Object.create(null);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (ALLOWED_TRACK_NAMES.indexOf(name) === -1) {
        throw new Error(
          "AetheriaStage.addLayer('" +
            layerId +
            "'): unknown track '" +
            name +
            "'. Allowed tracks: " +
            ALLOWED_TRACK_NAMES.join(", ") +
            "."
        );
      }
      const keys = rawTracks[name];
      if (!Array.isArray(keys) || keys.length === 0) {
        throw new Error(
          "AetheriaStage.addLayer('" + layerId + "'): track '" + name + "' must be a non-empty array."
        );
      }
      clean[name] = keys;
    }
    return clean;
  }

  function applyTracksToLayer(layer, t, tracksApi) {
    const tr = layer.tracks;
    if (!tr) return;
    if (tr.x) layer.x = Number(tracksApi.evaluateTrack(tr.x, t));
    if (tr.y) layer.y = Number(tracksApi.evaluateTrack(tr.y, t));
    if (tr.position) {
      const pos = tracksApi.evaluateTrack(tr.position, t, { spatial: true });
      if (Array.isArray(pos) && pos.length >= 2) {
        layer.x = Number(pos[0]);
        layer.y = Number(pos[1]);
      }
    }
    if (tr.scale) {
      const sc = tracksApi.evaluateTrack(tr.scale, t);
      if (Array.isArray(sc)) {
        layer.scaleX = Number(sc[0]);
        layer.scaleY = Number(sc.length >= 2 ? sc[1] : sc[0]);
      } else {
        layer.scaleX = Number(sc);
        layer.scaleY = Number(sc);
      }
    }
    if (tr.scaleX) layer.scaleX = Number(tracksApi.evaluateTrack(tr.scaleX, t));
    if (tr.scaleY) layer.scaleY = Number(tracksApi.evaluateTrack(tr.scaleY, t));
    if (tr.rotation) layer.rotation = Number(tracksApi.evaluateTrack(tr.rotation, t));
    if (tr.rotationDeg) layer.rotation = Number(tracksApi.evaluateTrack(tr.rotationDeg, t)) * DEG;
    if (tr.opacity) layer.opacity = clamp(Number(tracksApi.evaluateTrack(tr.opacity, t)), 0, 1);
    if (tr.anchor) {
      const anc = tracksApi.evaluateTrack(tr.anchor, t);
      if (Array.isArray(anc) && anc.length >= 2) {
        layer.anchor = [Number(anc[0]), Number(anc[1])];
      }
    }
    if (tr.width) layer.width = Number(tracksApi.evaluateTrack(tr.width, t));
    if (tr.height) layer.height = Number(tracksApi.evaluateTrack(tr.height, t));
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // 2D affine matrix [a, b, c, d, e, f] matching DOMMatrix / Canvas2D setTransform(a,b,c,d,e,f)
  function matIdentity() {
    return [1, 0, 0, 1, 0, 0];
  }

  function matMultiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  function matFromTransform(x, y, rotRad, sx, sy, anchorPxX, anchorPxY) {
    const cos = Math.cos(rotRad || 0);
    const sin = Math.sin(rotRad || 0);
    const a = cos * sx;
    const b = sin * sx;
    const c = -sin * sy;
    const d = cos * sy;
    const e = x - (a * anchorPxX + c * anchorPxY);
    const f = y - (b * anchorPxX + d * anchorPxY);
    return [a, b, c, d, e, f];
  }

  function applyMatrixToPoint(m, px, py) {
    return {
      x: m[0] * px + m[2] * py + m[4],
      y: m[1] * px + m[3] * py + m[5],
    };
  }

  /**
   * Normalizes either `AM.evalCameraTrack` (`{ s, cx, cy, rot }`) or `StoryCamera` rig
   * (`{ zoom, dolly, panX, panY, truckX, truckY, orbitAz, tiltEl, roll, rollRad, pivotX, pivotY }`)
   * into one canonical camera pose usable by 2D Canvas, DOM/SVG, and Three.js 3D cameras.
   */
  function normalizeCamera(raw, W, H) {
    const w = Math.max(1, Number(W) || 1080);
    const h = Math.max(1, Number(H) || 1920);
    const c = raw && typeof raw === "object" ? raw : {};

    const zoom = Number.isFinite(Number(c.zoom))
      ? Math.max(0.05, Number(c.zoom))
      : Number.isFinite(Number(c.s))
        ? Math.max(0.05, Number(c.s))
        : Number.isFinite(Number(c.dolly)) && Number(c.dolly) > 0
          ? 1 / Number(c.dolly)
          : 1;
    const dolly = Number.isFinite(Number(c.dolly)) && Number(c.dolly) > 0 ? Number(c.dolly) : 1 / zoom;

    const pivotX = Number.isFinite(Number(c.pivotX)) ? Number(c.pivotX) : 0.5;
    const pivotY = Number.isFinite(Number(c.pivotY)) ? Number(c.pivotY) : 0.5;

    let panX = Number.isFinite(Number(c.panX)) ? Number(c.panX) : 0;
    let panY = Number.isFinite(Number(c.panY)) ? Number(c.panY) : 0;
    if (!Number.isFinite(Number(c.panX)) && Number.isFinite(Number(c.cx))) {
      panX = w * 0.5 - Number(c.cx);
    }
    if (!Number.isFinite(Number(c.panY)) && Number.isFinite(Number(c.cy))) {
      panY = h * 0.5 - Number(c.cy);
    }

    const truckX = Number.isFinite(Number(c.truckX)) ? Number(c.truckX) : -panX / w;
    const truckY = Number.isFinite(Number(c.truckY)) ? Number(c.truckY) : panY / h;
    const rollDeg = Number.isFinite(Number(c.roll))
      ? Number(c.roll)
      : Number.isFinite(Number(c.rot))
        ? Number(c.rot)
        : Number.isFinite(Number(c.rollRad))
          ? Number(c.rollRad) / DEG
          : 0;
    const rollRad = Number.isFinite(Number(c.rollRad)) ? Number(c.rollRad) : rollDeg * DEG;
    const orbitAz = Number.isFinite(Number(c.orbitAz)) ? Number(c.orbitAz) : 0;
    const tiltEl = Number.isFinite(Number(c.tiltEl)) ? Number(c.tiltEl) : 0;

    return {
      zoom,
      dolly,
      panX,
      panY,
      truckX,
      truckY,
      orbitAz,
      tiltEl,
      roll: rollDeg,
      rollRad,
      pivotX,
      pivotY,
      blur: Number.isFinite(Number(c.blur)) ? Math.max(0, Number(c.blur)) : 0,
    };
  }

  function cameraMatrix2D(cam, W, H, parallax) {
    const k = Number.isFinite(Number(parallax)) ? Number(parallax) : 1;
    const effZoom = 1 + (cam.zoom - 1) * k;
    const effPanX = cam.panX * k;
    const effPanY = cam.panY * k;
    const effRoll = cam.rollRad * k;
    const pvx = W * cam.pivotX;
    const pvy = H * cam.pivotY;
    const cos = Math.cos(effRoll);
    const sin = Math.sin(effRoll);
    const a = cos * effZoom;
    const b = sin * effZoom;
    const c = -sin * effZoom;
    const d = cos * effZoom;
    const e = pvx + effPanX - (a * pvx + c * pvy);
    const f = pvy + effPanY - (b * pvx + d * pvy);
    return [a, b, c, d, e, f];
  }

  /**
   * Synchronizes a canonical camera pose across Canvas 2D, DOM/SVG elements, and a Three.js camera.
   */
  function syncCamera(rawCam, targets) {
    const tgt = targets && typeof targets === "object" ? targets : {};
    const W = Number(tgt.width) || (tgt.ctx && tgt.ctx.canvas && tgt.ctx.canvas.width) || 1080;
    const H = Number(tgt.height) || (tgt.ctx && tgt.ctx.canvas && tgt.ctx.canvas.height) || 1920;
    const cam = normalizeCamera(rawCam, W, H);
    const mat = cameraMatrix2D(cam, W, H, tgt.parallax !== undefined ? tgt.parallax : 1);

    if (tgt.ctx && typeof tgt.ctx.transform === "function") {
      tgt.ctx.transform(mat[0], mat[1], mat[2], mat[3], mat[4], mat[5]);
    }

    if (tgt.domElement && tgt.domElement.style) {
      tgt.domElement.style.transformOrigin = "0 0";
      tgt.domElement.style.transform =
        "matrix(" +
        mat[0].toFixed(5) + "," +
        mat[1].toFixed(5) + "," +
        mat[2].toFixed(5) + "," +
        mat[3].toFixed(5) + "," +
        mat[4].toFixed(3) + "," +
        mat[5].toFixed(3) + ")";
    }

    let pose3D = null;
    if (tgt.threeCamera) {
      const basePos = Array.isArray(tgt.baseCamPos) ? tgt.baseCamPos : [0, 0, 6];
      const baseLookAt = Array.isArray(tgt.baseLookAt) ? tgt.baseLookAt : [0, 0, 0];
      if (global.StoryCamera && typeof global.StoryCamera.applyTo3D === "function") {
        pose3D = global.StoryCamera.applyTo3D(tgt.threeCamera, basePos, baseLookAt, cam);
      } else {
        const dx = basePos[0] - baseLookAt[0];
        const dy = basePos[1] - baseLookAt[1];
        const dz = basePos[2] - baseLookAt[2];
        const r = Math.max(0.1, Math.hypot(dx, dy, dz));
        const shiftX = cam.truckX * r * 0.55;
        const shiftY = cam.truckY * r * 0.45;
        const lx = baseLookAt[0] + shiftX;
        const ly = baseLookAt[1] + shiftY;
        const lz = baseLookAt[2];
        const px = lx + dx * cam.dolly;
        const py = ly + dy * cam.dolly;
        const pz = lz + dz * cam.dolly;
        if (tgt.threeCamera.position && typeof tgt.threeCamera.position.set === "function") {
          tgt.threeCamera.position.set(px, py, pz);
        }
        if (typeof tgt.threeCamera.lookAt === "function") {
          tgt.threeCamera.lookAt(lx, ly, lz);
        }
        if (Math.abs(cam.rollRad) > 1e-6 && typeof tgt.threeCamera.rotateZ === "function") {
          tgt.threeCamera.rotateZ(cam.rollRad);
        }
        pose3D = { position: [px, py, pz], lookAt: [lx, ly, lz], rollRad: cam.rollRad };
      }
    }

    return { cam, matrix2D: mat, pose3D };
  }

  function applyLayerMask(ctx, mask) {
    if (!mask || typeof ctx.clip !== "function") return;
    if (typeof mask === "function") {
      ctx.beginPath();
      mask(ctx);
      ctx.clip();
      return;
    }
    if (typeof mask === "object") {
      ctx.beginPath();
      if (mask.type === "circle") {
        ctx.arc(Number(mask.cx) || 0, Number(mask.cy) || 0, Math.max(0, Number(mask.r) || 0), 0, Math.PI * 2);
      } else {
        ctx.rect(
          Number(mask.x) || 0,
          Number(mask.y) || 0,
          Math.max(0, Number(mask.w) || 0),
          Math.max(0, Number(mask.h) || 0)
        );
      }
      ctx.clip();
    }
  }

  function createStage(stageOpts) {
    const cfg = stageOpts && typeof stageOpts === "object" ? stageOpts : {};
    const width = Math.max(1, Number(cfg.width) || 1080);
    const height = Math.max(1, Number(cfg.height) || 1920);
    const layers = [];
    const byId = Object.create(null);
    let cameraRaw = null;
    let cameraTrack = null;

    function detectCycle(layerId, parentId) {
      let cur = parentId;
      let steps = 0;
      while (cur) {
        if (cur === layerId) return true;
        const p = byId[cur];
        if (!p || steps > 64) break;
        cur = p.parentId;
        steps++;
      }
      return false;
    }

    function addLayer(spec) {
      if (!spec || typeof spec !== "object" || !spec.id) {
        throw new Error("AetheriaStage.addLayer requires a layer object with a non-empty 'id'.");
      }
      const id = String(spec.id);
      const parentId = spec.parentId ? String(spec.parentId) : null;
      if (parentId && detectCycle(id, parentId)) {
        throw new Error("AetheriaStage cyclic parentId detected for layer '" + id + "' -> '" + parentId + "'.");
      }
      const existing = byId[id];
      const tracks = validateLayerTracks(id, spec.tracks);
      const layer = {
        id,
        parentId,
        kind: String(spec.kind || "canvas2d"),
        x: Number(spec.x) || 0,
        y: Number(spec.y) || 0,
        width: Number(spec.width) || 0,
        height: Number(spec.height) || 0,
        scaleX: Number.isFinite(Number(spec.scaleX)) ? Number(spec.scaleX) : (Number.isFinite(Number(spec.scale)) ? Number(spec.scale) : 1),
        scaleY: Number.isFinite(Number(spec.scaleY)) ? Number(spec.scaleY) : (Number.isFinite(Number(spec.scale)) ? Number(spec.scale) : 1),
        rotation: Number(spec.rotation) || 0,
        anchor: Array.isArray(spec.anchor) && spec.anchor.length >= 2 ? [Number(spec.anchor[0]) || 0, Number(spec.anchor[1]) || 0] : [0.5, 0.5],
        zIndex: Number.isFinite(Number(spec.zIndex)) ? Number(spec.zIndex) : layers.length,
        opacity: spec.opacity !== undefined ? clamp(Number(spec.opacity), 0, 1) : 1,
        blendMode: spec.blendMode || "source-over",
        visible: spec.visible !== false,
        parallax: Number.isFinite(Number(spec.parallax)) ? Number(spec.parallax) : 1,
        mask: spec.mask || null,
        assetId: spec.assetId || null,
        assetOpts: spec.assetOpts || null,
        element: spec.element || null,
        threeCanvas: spec.threeCanvas || null,
        threeCamera: spec.threeCamera || null,
        baseCamPos: spec.baseCamPos || null,
        baseLookAt: spec.baseLookAt || null,
        draw: typeof spec.draw === "function" ? spec.draw : null,
        update: typeof spec.update === "function" ? spec.update : null,
        tracks,
        _order: existing ? existing._order : layers.length,
      };
      if (existing) {
        const idx = layers.indexOf(existing);
        if (idx >= 0) layers[idx] = layer;
      } else {
        layers.push(layer);
      }
      byId[id] = layer;
      return layer;
    }

    function getLayer(id) {
      return byId[String(id)] || null;
    }

    function removeLayer(id) {
      const key = String(id);
      const existing = byId[key];
      if (!existing) return false;
      delete byId[key];
      const idx = layers.indexOf(existing);
      if (idx >= 0) layers.splice(idx, 1);
      return true;
    }

    function setCamera(camOrTrack) {
      if (Array.isArray(camOrTrack)) {
        cameraTrack = camOrTrack;
        cameraRaw = null;
      } else {
        cameraRaw = camOrTrack || null;
        cameraTrack = null;
      }
    }

    function resolveWorldState(t) {
      // Evaluate declarative AE keyframe tracks before layer.update so update() can still override
      const tracksApi =
        global.AetheriaTracks && typeof global.AetheriaTracks.evaluateTrack === "function"
          ? global.AetheriaTracks
          : null;
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].tracks) {
          if (tracksApi) {
            applyTracksToLayer(layers[i], t, tracksApi);
          } else {
            reportMissingTracksOnce();
          }
        }
      }
      // Allow per-layer dynamic update(layer, t) before world matrix resolution
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].update) {
          layers[i].update(layers[i], t);
        }
      }

      const worldMap = Object.create(null);
      function computeWorld(layer, depth) {
        if (worldMap[layer.id]) return worldMap[layer.id];
        if (depth > 64) {
          throw new Error("AetheriaStage cycle while resolving world matrix for '" + layer.id + "'.");
        }
        const ax = (layer.width || 0) * (layer.anchor[0] || 0);
        const ay = (layer.height || 0) * (layer.anchor[1] || 0);
        const localMat = matFromTransform(
          layer.x,
          layer.y,
          layer.rotation,
          layer.scaleX,
          layer.scaleY,
          ax,
          ay
        );

        let worldMat = localMat;
        let worldOpacity = clamp(layer.opacity, 0, 1);
        let worldVisible = layer.visible !== false;

        if (layer.parentId && byId[layer.parentId]) {
          const parentWorld = computeWorld(byId[layer.parentId], depth + 1);
          worldMat = matMultiply(parentWorld.matrix, localMat);
          worldOpacity *= parentWorld.opacity;
          worldVisible = worldVisible && parentWorld.visible;
        }

        const entry = {
          matrix: worldMat,
          opacity: worldOpacity,
          visible: worldVisible,
          localToWorld: function (lx, ly) {
            return applyMatrixToPoint(worldMat, Number(lx) || 0, Number(ly) || 0);
          },
        };
        worldMap[layer.id] = entry;
        return entry;
      }

      for (let i = 0; i < layers.length; i++) {
        computeWorld(layers[i], 0);
      }
      return worldMap;
    }

    function resolveActiveCamera(t) {
      if (cameraTrack && global.AM && typeof global.AM.evalCameraTrack === "function") {
        return normalizeCamera(global.AM.evalCameraTrack(cameraTrack, t, width, height), width, height);
      }
      return normalizeCamera(cameraRaw, width, height);
    }

    function render(ctx, t, renderOpts) {
      const opts = renderOpts && typeof renderOpts === "object" ? renderOpts : {};
      const sec = Number(t) || 0;
      const worldMap = resolveWorldState(sec);
      const cam = resolveActiveCamera(sec);

      const ordered = layers.slice().sort(function (a, b) {
        return a.zIndex !== b.zIndex ? a.zIndex - b.zIndex : a._order - b._order;
      });

      const renderedLayers = [];
      for (let i = 0; i < ordered.length; i++) {
        const layer = ordered[i];
        const world = worldMap[layer.id];
        if (!world || !world.visible || world.opacity <= 1e-4) {
          if ((layer.kind === "dom" || layer.kind === "svg") && layer.element && layer.element.style) {
            layer.element.style.visibility = "hidden";
          }
          continue;
        }

        const camMat = cameraMatrix2D(cam, width, height, layer.parallax);
        const finalMat = matMultiply(camMat, world.matrix);

        if (layer.kind === "group") {
          continue;
        }

        if (layer.kind === "dom" || layer.kind === "svg") {
          if (layer.element && layer.element.style) {
            layer.element.style.visibility = "visible";
            layer.element.style.opacity = String(world.opacity);
            layer.element.style.zIndex = String(Math.round(layer.zIndex));
            layer.element.style.transformOrigin = "0 0";
            layer.element.style.transform =
              "matrix(" +
              finalMat[0].toFixed(5) + "," +
              finalMat[1].toFixed(5) + "," +
              finalMat[2].toFixed(5) + "," +
              finalMat[3].toFixed(5) + "," +
              finalMat[4].toFixed(3) + "," +
              finalMat[5].toFixed(3) + ")";
          }
          if (layer.draw) layer.draw(ctx, sec, world, layer, cam);
          renderedLayers.push(layer.id);
          continue;
        }

        if (layer.kind === "three" || layer.kind === "webgl") {
          let pose3D = null;
          if (layer.threeCamera) {
            pose3D = syncCamera(cam, {
              width,
              height,
              threeCamera: layer.threeCamera,
              baseCamPos: layer.baseCamPos,
              baseLookAt: layer.baseLookAt,
            }).pose3D;
          }
          if (layer.draw) {
            layer.draw(ctx, sec, world, layer, cam, pose3D);
          }
          if (ctx && layer.threeCanvas && typeof ctx.drawImage === "function") {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = world.opacity;
            ctx.globalCompositeOperation = layer.blendMode || "source-over";
            if (layer.mask) applyLayerMask(ctx, layer.mask);
            ctx.drawImage(layer.threeCanvas, 0, 0, width, height);
            ctx.restore();
          }
          renderedLayers.push(layer.id);
          continue;
        }

        if (!ctx) continue;
        ctx.save();
        ctx.setTransform(finalMat[0], finalMat[1], finalMat[2], finalMat[3], finalMat[4], finalMat[5]);
        ctx.globalAlpha = world.opacity;
        ctx.globalCompositeOperation = layer.blendMode || "source-over";
        if (layer.mask) applyLayerMask(ctx, layer.mask);

        if (layer.kind === "asset" && layer.assetId && global.AM && typeof global.AM.drawAsset === "function") {
          const aw = layer.width || 200;
          const ah = layer.height || 200;
          global.AM.drawAsset(ctx, layer.assetId, 0, 0, aw, ah, layer.assetOpts || {});
        } else if (layer.draw) {
          layer.draw(ctx, sec, world, layer, cam);
        }
        ctx.restore();
        renderedLayers.push(layer.id);
      }

      if (opts.postProcess && ctx && global.AM && typeof global.AM.postProcess === "function") {
        global.AM.postProcess(ctx, sec, opts.postProcess);
      }

      return { renderedLayers, camera: cam, worldMap };
    }

    return {
      width,
      height,
      addLayer,
      getLayer,
      removeLayer,
      setCamera,
      resolveWorldState,
      resolveActiveCamera,
      render,
      listLayers: function () {
        return layers.slice();
      },
    };
  }

  global.AetheriaStage = {
    version: 1,
    createStage,
    normalizeCamera,
    cameraMatrix2D,
    syncCamera,
    matIdentity,
    matMultiply,
    matFromTransform,
    applyMatrixToPoint,
  };
})(typeof window !== "undefined" ? window : globalThis);
