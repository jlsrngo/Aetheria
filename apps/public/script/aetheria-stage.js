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
  const ALLOWED_MATTE_MODES = ["alpha", "alphaInverted", "luma", "lumaInverted"];

  function validateLayerMatte(layerId, rawMatte) {
    if (rawMatte === undefined || rawMatte === null) return null;
    if (typeof rawMatte !== "object" || !rawMatte.layerId) {
      throw new Error("AetheriaStage.addLayer('" + layerId + "'): 'matte' requires { layerId, mode }.");
    }
    const targetId = String(rawMatte.layerId);
    if (targetId === layerId) {
      throw new Error("AetheriaStage.addLayer('" + layerId + "'): layer cannot use itself as a track matte.");
    }
    const mode = String(rawMatte.mode || "alpha");
    if (ALLOWED_MATTE_MODES.indexOf(mode) === -1) {
      throw new Error(
        "AetheriaStage.addLayer('" +
          layerId +
          "'): unknown matte mode '" +
          mode +
          "'. Allowed modes: " +
          ALLOWED_MATTE_MODES.join(", ") +
          "."
      );
    }
    return { layerId: targetId, mode };
  }

  function validateLayerEcho(layerId, rawEcho) {
    if (rawEcho === undefined || rawEcho === null) return null;
    if (typeof rawEcho !== "object") {
      throw new Error("AetheriaStage.addLayer('" + layerId + "'): 'echo' must be an object.");
    }
    const count = Math.max(0, Math.min(16, Math.round(Number(rawEcho.count ?? 4))));
    const echoTime = Number.isFinite(Number(rawEcho.echoTime)) ? Number(rawEcho.echoTime) : -1 / 30;
    const startIntensity = clamp(Number(rawEcho.startIntensity ?? 0.75), 0, 1);
    const decay = clamp(Number(rawEcho.decay ?? 0.65), 0, 1);
    const operator = String(rawEcho.operator || "compositeInBack");
    return { count, echoTime, startIntensity, decay, operator };
  }
  let reportedMissingTracks = false;
  let reportedMissingBehaviors = false;

  function reportStageErrorOnce(msg) {
    if (global && typeof global === "object") {
      global.__aetheriaErrors = Array.isArray(global.__aetheriaErrors) ? global.__aetheriaErrors : [];
      if (global.__aetheriaErrors.length < 16 && global.__aetheriaErrors.indexOf(msg) === -1) {
        global.__aetheriaErrors.push(msg);
      }
    }
  }

  function reportMissingTracksOnce() {
    if (reportedMissingTracks) return;
    reportedMissingTracks = true;
    reportStageErrorOnce("[aetheria-stage] layer.tracks ignored because window.AetheriaTracks is not loaded.");
  }

  function reportMissingBehaviorsOnce() {
    if (reportedMissingBehaviors) return;
    reportedMissingBehaviors = true;
    reportStageErrorOnce("[aetheria-stage] layer.behaviors ignored because window.AetheriaBehaviors is not loaded.");
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
      const matte = validateLayerMatte(id, spec.matte);
      const echo = validateLayerEcho(id, spec.echo);
      let behaviors = null;
      if (spec.behaviors !== undefined && spec.behaviors !== null) {
        if (!Array.isArray(spec.behaviors)) {
          throw new Error("AetheriaStage.addLayer('" + id + "'): 'behaviors' must be an array.");
        }
        if (global.AetheriaBehaviors && typeof global.AetheriaBehaviors.validateBehaviors === "function") {
          behaviors = global.AetheriaBehaviors.validateBehaviors(spec.behaviors, id);
        } else {
          behaviors = spec.behaviors.slice();
        }
      }
      let followLag = 0;
      if (spec.followLag !== undefined && spec.followLag !== null) {
        const lag = Number(spec.followLag);
        if (!Number.isFinite(lag) || lag < 0) {
          throw new Error("AetheriaStage.addLayer('" + id + "'): 'followLag' must be a non-negative finite number.");
        }
        followLag = lag;
      }
      const initX = Number(spec.x) || 0;
      const initY = Number(spec.y) || 0;
      const initW = Number(spec.width) || 0;
      const initH = Number(spec.height) || 0;
      const initSX = Number.isFinite(Number(spec.scaleX)) ? Number(spec.scaleX) : (Number.isFinite(Number(spec.scale)) ? Number(spec.scale) : 1);
      const initSY = Number.isFinite(Number(spec.scaleY)) ? Number(spec.scaleY) : (Number.isFinite(Number(spec.scale)) ? Number(spec.scale) : 1);
      const initRot = Number(spec.rotation) || 0;
      const initAnchor = Array.isArray(spec.anchor) && spec.anchor.length >= 2 ? [Number(spec.anchor[0]) || 0, Number(spec.anchor[1]) || 0] : [0.5, 0.5];
      const initOpacity = spec.opacity !== undefined ? clamp(Number(spec.opacity), 0, 1) : 1;
      const initVisible = spec.visible !== false;
      const layer = {
        id,
        parentId,
        kind: String(spec.kind || "canvas2d"),
        x: initX,
        y: initY,
        width: initW,
        height: initH,
        scaleX: initSX,
        scaleY: initSY,
        rotation: initRot,
        anchor: [initAnchor[0], initAnchor[1]],
        zIndex: Number.isFinite(Number(spec.zIndex)) ? Number(spec.zIndex) : layers.length,
        opacity: initOpacity,
        blendMode: spec.blendMode || "source-over",
        visible: initVisible,
        parallax: Number.isFinite(Number(spec.parallax)) ? Number(spec.parallax) : 1,
        mask: spec.mask || null,
        matte,
        matteSource: Boolean(spec.matteSource),
        echo,
        assetId: spec.assetId || null,
        assetOpts: spec.assetOpts || null,
        text: spec.text !== undefined ? String(spec.text) : null,
        textOpts: spec.textOpts || null,
        shape: spec.shape || null,
        shapeOpts: spec.shapeOpts || null,
        element: spec.element || null,
        threeCanvas: spec.threeCanvas || null,
        threeCamera: spec.threeCamera || null,
        baseCamPos: spec.baseCamPos || null,
        baseLookAt: spec.baseLookAt || null,
        draw: typeof spec.draw === "function" ? spec.draw : null,
        update: typeof spec.update === "function" ? spec.update : null,
        tracks,
        behaviors,
        followLag,
        _base: {
          x: initX,
          y: initY,
          width: initW,
          height: initH,
          scaleX: initSX,
          scaleY: initSY,
          rotation: initRot,
          anchor: [initAnchor[0], initAnchor[1]],
          opacity: initOpacity,
          visible: initVisible,
        },
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
      const tracksApi =
        global.AetheriaTracks && typeof global.AetheriaTracks.evaluateTrack === "function"
          ? global.AetheriaTracks
          : null;
      const behaviorsApi =
        global.AetheriaBehaviors && typeof global.AetheriaBehaviors.applyBehaviors === "function"
          ? global.AetheriaBehaviors
          : null;

      function evaluateLayerState(layer, sampleT, writeLive) {
        const b = layer._base;
        const target = writeLive
          ? layer
          : {
              id: layer.id,
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              scaleX: b.scaleX,
              scaleY: b.scaleY,
              rotation: b.rotation,
              anchor: [b.anchor[0], b.anchor[1]],
              opacity: b.opacity,
              visible: b.visible,
              tracks: layer.tracks,
              behaviors: layer.behaviors,
            };
        if (writeLive && (layer.tracks || layer.behaviors)) {
          layer.x = b.x;
          layer.y = b.y;
          layer.width = b.width;
          layer.height = b.height;
          layer.scaleX = b.scaleX;
          layer.scaleY = b.scaleY;
          layer.rotation = b.rotation;
          layer.anchor = [b.anchor[0], b.anchor[1]];
          layer.opacity = b.opacity;
          layer.visible = b.visible;
        }
        if (layer.tracks) {
          if (tracksApi) {
            applyTracksToLayer(target, sampleT, tracksApi);
          } else {
            reportMissingTracksOnce();
          }
        }
        if (layer.behaviors) {
          if (behaviorsApi) {
            behaviorsApi.applyBehaviors(target, sampleT, layer.behaviors, layer.id);
          } else {
            reportMissingBehaviorsOnce();
          }
        }
        if (layer.update) {
          layer.update(target, sampleT);
        }
        return target;
      }

      for (let i = 0; i < layers.length; i++) {
        evaluateLayerState(layers[i], t, true);
      }

      const worldMap = Object.create(null);
      function computeWorldAt(layer, sampleT, depth, isCurrentFrame) {
        if (isCurrentFrame && worldMap[layer.id]) return worldMap[layer.id];
        if (depth > 64) {
          throw new Error("AetheriaStage cycle while resolving world matrix for '" + layer.id + "'.");
        }
        const st = isCurrentFrame ? layer : evaluateLayerState(layer, sampleT, false);
        const ax = (st.width || 0) * (st.anchor[0] || 0);
        const ay = (st.height || 0) * (st.anchor[1] || 0);
        const localMat = matFromTransform(
          st.x,
          st.y,
          st.rotation,
          st.scaleX,
          st.scaleY,
          ax,
          ay
        );

        let worldMat = localMat;
        let worldOpacity = clamp(st.opacity, 0, 1);
        let worldVisible = st.visible !== false;

        if (layer.parentId && byId[layer.parentId]) {
          const lag = layer.followLag || 0;
          const parentT = sampleT - lag;
          const parentWorld = computeWorldAt(
            byId[layer.parentId],
            parentT,
            depth + 1,
            isCurrentFrame && lag === 0
          );
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
        if (isCurrentFrame) {
          worldMap[layer.id] = entry;
        }
        return entry;
      }

      for (let i = 0; i < layers.length; i++) {
        computeWorldAt(layers[i], t, 0, true);
      }
      return worldMap;
    }

    function resolveActiveCamera(t) {
      if (cameraTrack && global.AM && typeof global.AM.evalCameraTrack === "function") {
        return normalizeCamera(global.AM.evalCameraTrack(cameraTrack, t, width, height), width, height);
      }
      return normalizeCamera(cameraRaw, width, height);
    }

    const scratchPool = Object.create(null);
    function getScratch(key) {
      if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
      let c = scratchPool[key];
      if (!c) {
        c = document.createElement("canvas");
        scratchPool[key] = c;
      }
      if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
      }
      return c;
    }

    function drawCanvasLayerContent(targetCtx, layer, sec, world, cam) {
      if (layer.kind === "asset" && layer.assetId && global.AM && typeof global.AM.drawAsset === "function") {
        const aw = layer.width || 200;
        const ah = layer.height || 200;
        global.AM.drawAsset(targetCtx, layer.assetId, 0, 0, aw, ah, layer.assetOpts || {});
      } else if (layer.kind === "text" && layer.text !== null && global.AetheriaShapesText) {
        global.AetheriaShapesText.drawAnimatedText(targetCtx, layer.text, 0, 0, sec, layer.textOpts || {});
      } else if (layer.kind === "shape" && layer.shape && global.AetheriaShapesText) {
        const sOpts = Object.assign({ t: sec }, layer.shapeOpts || {});
        if (sOpts.repeater) {
          global.AetheriaShapesText.repeatDraw(targetCtx, sOpts.repeater, function (c) {
            global.AetheriaShapesText.drawShapePath(c, layer.shape, sOpts);
          });
        } else {
          global.AetheriaShapesText.drawShapePath(targetCtx, layer.shape, sOpts);
        }
      } else if (layer.draw) {
        layer.draw(targetCtx, sec, world, layer, cam);
      }
    }

    function compositeWithTrackMatte(mainCtx, layer, sec, world, finalMat, cam, worldMap) {
      const matteLayer = layer.matte ? byId[layer.matte.layerId] : null;
      const iso = getScratch("iso");
      const matCan = getScratch("matte");
      if (!matteLayer || !iso || !matCan) return false;
      const isoCtx = iso.getContext("2d");
      const matCtx = matCan.getContext("2d");
      if (!isoCtx || !matCtx) return false;

      isoCtx.setTransform(1, 0, 0, 1, 0, 0);
      isoCtx.clearRect(0, 0, width, height);
      isoCtx.save();
      isoCtx.setTransform(finalMat[0], finalMat[1], finalMat[2], finalMat[3], finalMat[4], finalMat[5]);
      isoCtx.globalAlpha = 1;
      isoCtx.globalCompositeOperation = "source-over";
      if (layer.mask) applyLayerMask(isoCtx, layer.mask);
      drawCanvasLayerContent(isoCtx, layer, sec, world, cam);
      isoCtx.restore();

      const mWorld = worldMap[matteLayer.id];
      matCtx.setTransform(1, 0, 0, 1, 0, 0);
      matCtx.clearRect(0, 0, width, height);
      if (mWorld) {
        const mCamMat = cameraMatrix2D(cam, width, height, matteLayer.parallax);
        const mFinalMat = matMultiply(mCamMat, mWorld.matrix);
        matCtx.save();
        matCtx.setTransform(mFinalMat[0], mFinalMat[1], mFinalMat[2], mFinalMat[3], mFinalMat[4], mFinalMat[5]);
        matCtx.globalAlpha = clamp(mWorld.opacity, 0, 1);
        matCtx.globalCompositeOperation = "source-over";
        if (matteLayer.mask) applyLayerMask(matCtx, matteLayer.mask);
        drawCanvasLayerContent(matCtx, matteLayer, sec, mWorld, cam);
        matCtx.restore();
      }

      const mode = layer.matte.mode;
      if (mode === "alpha" || mode === "alphaInverted") {
        isoCtx.save();
        isoCtx.setTransform(1, 0, 0, 1, 0, 0);
        isoCtx.globalCompositeOperation = mode === "alpha" ? "destination-in" : "destination-out";
        isoCtx.drawImage(matCan, 0, 0);
        isoCtx.restore();
      } else {
        // Exact Rec.709 luminance matte (`crates/render/src/layers.rs` L560-571)
        const isoImg = isoCtx.getImageData(0, 0, width, height);
        const matImg = matCtx.getImageData(0, 0, width, height);
        const id = isoImg.data;
        const md = matImg.data;
        const invert = mode === "lumaInverted";
        for (let p = 0; p < id.length; p += 4) {
          const ma = md[p + 3] / 255;
          const lum = (0.2126 * md[p] + 0.7152 * md[p + 1] + 0.0722 * md[p + 2]) / 255;
          const k = clamp(invert ? 1 - lum * ma : lum * ma, 0, 1);
          id[p + 3] = Math.round(id[p + 3] * k);
        }
        isoCtx.putImageData(isoImg, 0, 0);
      }

      mainCtx.save();
      mainCtx.setTransform(1, 0, 0, 1, 0, 0);
      mainCtx.globalAlpha = world.opacity;
      mainCtx.globalCompositeOperation = layer.blendMode || "source-over";
      mainCtx.drawImage(iso, 0, 0);
      mainCtx.restore();
      return true;
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
        if (layer.matteSource) continue;
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

        if (layer.echo && layer.echo.count > 0) {
          const ec = layer.echo;
          const compOp = ec.operator === "add" ? "lighter" : ec.operator === "screen" ? "screen" : layer.blendMode || "source-over";
          for (let ei = ec.count; ei >= 1; ei--) {
            const eSec = Math.max(0, sec + ei * ec.echoTime);
            const eWorldMap = resolveWorldState(eSec);
            const eWorld = eWorldMap[layer.id];
            if (!eWorld || !eWorld.visible) continue;
            const eCam = resolveActiveCamera(eSec);
            const eFinalMat = matMultiply(cameraMatrix2D(eCam, width, height, layer.parallax), eWorld.matrix);
            const eAlpha = clamp(eWorld.opacity * ec.startIntensity * Math.pow(ec.decay, ei), 0, 1);
            if (eAlpha <= 1e-3) continue;
            ctx.save();
            ctx.setTransform(eFinalMat[0], eFinalMat[1], eFinalMat[2], eFinalMat[3], eFinalMat[4], eFinalMat[5]);
            ctx.globalAlpha = eAlpha;
            ctx.globalCompositeOperation = compOp;
            if (layer.mask) applyLayerMask(ctx, layer.mask);
            drawCanvasLayerContent(ctx, layer, eSec, eWorld, eCam);
            ctx.restore();
          }
          // Restore current-frame state after lagged echo sampling
          resolveWorldState(sec);
        }

        if (layer.matte && compositeWithTrackMatte(ctx, layer, sec, world, finalMat, cam, worldMap)) {
          renderedLayers.push(layer.id);
          continue;
        }

        ctx.save();
        ctx.setTransform(finalMat[0], finalMat[1], finalMat[2], finalMat[3], finalMat[4], finalMat[5]);
        ctx.globalAlpha = world.opacity;
        ctx.globalCompositeOperation = layer.blendMode || "source-over";
        if (layer.mask) applyLayerMask(ctx, layer.mask);
        drawCanvasLayerContent(ctx, layer, sec, world, cam);
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
