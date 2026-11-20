(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;
  var OUTLINE_COLOR = 0x594637;

  var SUBTITLE_STYLE = {
    style: "neobrutalism",
    wordsPerGroup: 1,
    palette: ["#FFDE59", "#BAE6FD", "#FDA4AF", "#F5D0FE", "#FFFDF9"],
    textColor: "#2B2118",
    borderColor: "#594637",
    shadowColor: "#594637",
    borderWidth: 6,
    shadowOffsetX: 8,
    shadowOffsetY: 8,
    radius: 16,
    tiltDeg: 2.0,
    uppercase: true,
    fontSize: 72,
    y: 1580
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, p) {
    return a + (b - a) * p;
  }

  function computeSafeZone(width, height) {
    if (height > width) {
      return {
        minX: Math.round(width * 0.045),
        maxX: Math.round(width * (960 / 1080)),
        minY: Math.round(height * (60 / 1920)),
        maxY: Math.round(height * (1440 / 1920))
      };
    }
    return {
      minX: Math.round(width * 0.05),
      maxX: Math.round(width * 0.95),
      minY: Math.round(height * 0.06),
      maxY: Math.round(height * 0.88)
    };
  }

  function buildStageBackdrop(kit, stageKind, outlineMat) {
    var root = new THREE.Group();
    root.name = "stage_" + stageKind;
    var mats = {
      shirt: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      darkInk: new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR }),
      foliage1: new THREE.MeshLambertMaterial({ color: 0x4ade80 }),
      foliage2: new THREE.MeshLambertMaterial({ color: 0x86efac }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x9a5b32 }),
      winLit: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      winGlass: new THREE.MeshBasicMaterial({ color: 0x7dd3fc })
    };

    // Shared sun & drifting clouds
    var sunMesh = kit.addOutlinedMesh(
      new THREE.SphereGeometry(1.4, 24, 24),
      mats.winLit,
      outlineMat,
      0.06,
      false,
      false
    ).group;
    sunMesh.position.set(5.4, 9.8, -19.0);
    root.add(sunMesh);

    var clouds = [
      { x0: -6.0, y: 7.6, z: -15.0, speed: 0.28, group: new THREE.Group() },
      { x0: 4.8, y: 8.5, z: -16.2, speed: 0.2, group: new THREE.Group() }
    ];
    clouds.forEach(function (cl) {
      [
        [0, 0, 1.05],
        [-0.85, -0.1, 0.74],
        [0.85, -0.1, 0.78]
      ].forEach(function (p) {
        var puff = kit.addOutlinedMesh(
          new THREE.SphereGeometry(p[2], 18, 16),
          mats.shirt,
          outlineMat,
          0.045,
          false,
          false
        ).group;
        puff.position.set(p[0], p[1], 0);
        cl.group.add(puff);
      });
      cl.group.position.set(cl.x0, cl.y, cl.z);
      root.add(cl.group);
    });

    var cars = [];
    if (stageKind === "city-street") {
      // Extended foreground sidewalk so lower third of 9:16 portrait stays grounded
      var sidewalk = kit.addOutlinedMesh(
        new THREE.BoxGeometry(70, 0.28, 28.0),
        new THREE.MeshLambertMaterial({ color: 0xf1f5f9 }),
        outlineMat,
        0.04,
        false,
        true
      ).group;
      sidewalk.position.set(0, -0.14, 12.2);
      root.add(sidewalk);

      var road = new THREE.Mesh(
        new THREE.PlaneGeometry(90, 6.2),
        new THREE.MeshLambertMaterial({ color: 0x64748b })
      );
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.01, -4.6);
      root.add(road);

      [
        { x: -11.0, z: -10.4, w: 4.2, h: 4.6, d: 3.4, bodyHex: 0xfda4af, roofHex: 0xe11d48 },
        { x: -6.0, z: -10.4, w: 4.4, h: 5.2, d: 3.6, bodyHex: 0x93c5fd, roofHex: 0x0284c7 },
        { x: -0.8, z: -10.8, w: 4.6, h: 4.3, d: 3.6, bodyHex: 0xd8b4fe, roofHex: 0x7c3aed },
        { x: 4.4, z: -10.4, w: 4.4, h: 4.8, d: 3.6, bodyHex: 0xfdba74, roofHex: 0xea580c },
        { x: 9.6, z: -10.2, w: 4.2, h: 4.5, d: 3.4, bodyHex: 0x86efac, roofHex: 0x16a34a }
      ].forEach(function (cfg) {
        root.add(kit.createKawaiiBuilding(mats, outlineMat, cfg));
      });

      [-5.6, 5.6].forEach(function (tx) {
        root.add(kit.createKawaiiTree(mats, outlineMat, tx, -0.8, 0.92));
      });

      cars = [
        kit.createCuteRoundedCar(mats, outlineMat, 0xff8fab, 0xfff0f3, -9, -3.5, 1, 2.4),
        kit.createCuteRoundedCar(mats, outlineMat, 0x7dd3fc, 0xf0f9ff, 7, -5.6, -1, 2.7)
      ];
      cars.forEach(function (c) {
        root.add(c.group);
      });
    } else if (stageKind === "open-field") {
      // Preset 2: open-field (lush pastel paddy / meadow diorama extending cleanly into foreground)
      var meadow = new THREE.Mesh(
        new THREE.PlaneGeometry(110, 90),
        new THREE.MeshLambertMaterial({ color: 0x86efac })
      );
      meadow.rotation.x = -Math.PI / 2;
      meadow.position.set(0, -0.02, 4.0);
      meadow.receiveShadow = true;
      root.add(meadow);

      // Warm clay farm path running into foreground (gives lower third depth and grounding)
      var pathMat = new THREE.MeshLambertMaterial({ color: 0xe7c8a0 });
      var farmPath = kit.addOutlinedMesh(
        new THREE.BoxGeometry(5.2, 0.14, 64.0),
        pathMat,
        outlineMat,
        0.03,
        false,
        true
      ).group;
      farmPath.position.set(0, -0.06, 22.0);
      root.add(farmPath);

      // Stepping clay stones along the path for foreground depth & texture
      var stoneMat = new THREE.MeshLambertMaterial({ color: 0xd6b084 });
      for (var si = 0; si < 9; si++) {
        var stGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.08, 14);
        stGeo.scale(1.2, 1.0, 0.72);
        var stone = kit.addOutlinedMesh(stGeo, stoneMat, outlineMat, 0.02, false, true).group;
        stone.position.set((si % 2 === 0 ? -0.75 : 0.75), 0.02, 2.8 + si * 2.1);
        root.add(stone);
      }

      // Paddy terrace strips flanking the farm path
      var paddyMat1 = new THREE.MeshLambertMaterial({ color: 0xa3e635 });
      var paddyMat2 = new THREE.MeshLambertMaterial({ color: 0x4ade80 });
      for (var zi = -3; zi <= 8; zi++) {
        var stripMat = zi % 2 === 0 ? paddyMat1 : paddyMat2;
        [-7.5, 7.5].forEach(function (sx) {
          var strip = kit.addOutlinedMesh(
            new THREE.BoxGeometry(9.2, 0.16, 2.8),
            stripMat,
            outlineMat,
            0.03,
            false,
            true
          ).group;
          strip.position.set(sx, -0.04, zi * 3.2);
          root.add(strip);
        });
      }

      // Soft rolling clay hills in the distance
      [
        { x: -10.5, z: -15.5, rx: 9.0, ry: 3.4, rz: 4.5, hex: 0x4ade80 },
        { x: 0.5, z: -17.5, rx: 11.0, ry: 4.2, rz: 5.0, hex: 0x86efac },
        { x: 11.5, z: -15.0, rx: 8.5, ry: 3.2, rz: 4.5, hex: 0x4ade80 }
      ].forEach(function (h) {
        var geo = new THREE.SphereGeometry(1, 24, 16);
        geo.scale(h.rx, h.ry, h.rz);
        var hill = kit.addOutlinedMesh(
          geo,
          new THREE.MeshLambertMaterial({ color: h.hex }),
          outlineMat,
          0.06,
          false,
          true
        ).group;
        hill.position.set(h.x, -0.6, h.z);
        root.add(hill);
      });

      // Low wooden fence posts along background ridge
      var fenceMat = new THREE.MeshLambertMaterial({ color: 0xb47b4e });
      for (var fx = -8; fx <= 8; fx += 2.6) {
        var post = kit.addOutlinedMesh(
          new THREE.CylinderGeometry(0.11, 0.12, 0.95, 10),
          fenceMat,
          outlineMat,
          0.024
        ).group;
        post.position.set(fx, 0.45, -6.2);
        root.add(post);
      }
      var rail = kit.addOutlinedMesh(
        new THREE.BoxGeometry(17.5, 0.12, 0.12),
        fenceMat,
        outlineMat,
        0.02
      ).group;
      rail.position.set(0, 0.65, -6.2);
      root.add(rail);
    } else if (stageKind === "indoor-room") {
      // Preset 3: indoor-room (warm cozy pastel clay room for indoor/home/office scenes)
      sunMesh.visible = false;
      clouds.forEach(function (cl) {
        cl.group.visible = false;
      });
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshLambertMaterial({ color: 0xe7c8a0 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -0.02, 2.0);
      floor.receiveShadow = true;
      root.add(floor);

      var rugGeo = new THREE.CylinderGeometry(3.2, 3.3, 0.06, 28);
      var rug = kit.addOutlinedMesh(
        rugGeo,
        new THREE.MeshLambertMaterial({ color: 0xfda4af }),
        outlineMat,
        0.025,
        false,
        true
      ).group;
      rug.position.set(0, 0.02, 1.2);
      root.add(rug);

      var backWall = kit.addOutlinedMesh(
        new THREE.BoxGeometry(26, 12, 0.4),
        new THREE.MeshLambertMaterial({ color: 0xfef3c7 }),
        outlineMat,
        0.04,
        false,
        true
      ).group;
      backWall.position.set(0, 5.9, -4.8);
      root.add(backWall);

      var baseboard = kit.addOutlinedMesh(
        new THREE.BoxGeometry(26, 0.45, 0.5),
        new THREE.MeshLambertMaterial({ color: 0xfffdf9 }),
        outlineMat,
        0.02,
        false,
        true
      ).group;
      baseboard.position.set(0, 0.22, -4.7);
      root.add(baseboard);

      var winFrame = kit.addOutlinedMesh(
        new THREE.BoxGeometry(3.4, 2.6, 0.18),
        new THREE.MeshLambertMaterial({ color: 0xfffdf9 }),
        outlineMat,
        0.03,
        false,
        false
      ).group;
      winFrame.position.set(-2.4, 3.6, -4.52);
      var winPane = new THREE.Mesh(
        new THREE.BoxGeometry(2.9, 2.1, 0.2),
        mats.winGlass
      );
      winPane.position.set(-2.4, 3.6, -4.5);
      root.add(winFrame, winPane);

      var shelf = kit.addOutlinedMesh(
        new THREE.BoxGeometry(3.2, 0.22, 0.65),
        new THREE.MeshLambertMaterial({ color: 0xb47b4e }),
        outlineMat,
        0.026
      ).group;
      shelf.position.set(2.5, 3.1, -4.32);
      root.add(shelf);
    }

    return {
      root: root,
      update: function (globalT) {
        clouds.forEach(function (cl) {
          var span = 18;
          cl.group.position.x = ((cl.x0 + cl.speed * globalT + span) % (span * 2)) - span;
        });
        cars.forEach(function (car) {
          var span = 18;
          var pos = (car.x0 + car.speed * globalT + span) % (span * 2);
          if (pos < 0) pos += span * 2;
          car.group.position.x = pos - span;
          car.group.position.y = Math.abs(Math.sin(globalT * 10)) * 0.02;
        });
      }
    };
  }

  function projectBoxToPixels(box, camera, width, height) {
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    var xs = [box.min.x, box.max.x];
    var ys = [box.min.y, box.max.y];
    var zs = [box.min.z, box.max.z];
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    var behind = false;
    var v = new THREE.Vector3();

    for (var xi = 0; xi < 2; xi++) {
      for (var yi = 0; yi < 2; yi++) {
        for (var zi = 0; zi < 2; zi++) {
          v.set(xs[xi], ys[yi], zs[zi]);
          var camSpace = v.clone().applyMatrix4(camera.matrixWorldInverse);
          if (camSpace.z > -camera.near) behind = true;
          v.project(camera);
          var sx = (v.x * 0.5 + 0.5) * width;
          var sy = (-v.y * 0.5 + 0.5) * height;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
      }
    }
    return {
      behind: behind,
      minX: Math.round(minX * 10) / 10,
      minY: Math.round(minY * 10) / 10,
      maxX: Math.round(maxX * 10) / 10,
      maxY: Math.round(maxY * 10) / 10,
      width: Math.round((maxX - minX) * 10) / 10,
      height: Math.round((maxY - minY) * 10) / 10
    };
  }

  function isBoxInsideSafeZone(bbox, safeZone) {
    if (!bbox || bbox.behind) return false;
    return (
      bbox.minX >= safeZone.minX &&
      bbox.maxX <= safeZone.maxX &&
      bbox.minY >= safeZone.minY &&
      bbox.maxY <= safeZone.maxY
    );
  }

  function isVec3Array(v) {
    return (
      Array.isArray(v) &&
      v.length === 3 &&
      typeof v[0] === "number" &&
      Number.isFinite(v[0]) &&
      typeof v[1] === "number" &&
      Number.isFinite(v[1]) &&
      typeof v[2] === "number" &&
      Number.isFinite(v[2])
    );
  }

  function lerpAngle(a, b, t) {
    var diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + diff * clamp(t, 0, 1);
  }

  function easeLocomotion(p) {
    var x = clamp(p, 0, 1);
    // Gentle ease-in/out on start and stop, steady walking speed in middle
    return x * x * (3 - 2 * x) * 0.35 + x * 0.65;
  }

  /**
   * Computes camera position & lookAt target for any preset so the projected focus Box3
   * is guaranteed to remain strictly inside the portrait/landscape safeZone while tracking
   * moving actors smoothly without cancelling vertical walk bobbing or hop arcs.
   */
  function frameCameraToFocus(camera, steadyFocusBox, actualFocusBox, preset, shotProgress, width, height, safeZone, clayRig) {
    var p = clamp(shotProgress, 0, 1);
    var focusBox = steadyFocusBox;
    var liveBox = actualFocusBox || steadyFocusBox;
    var center = focusBox.getCenter(new THREE.Vector3());
    var size = focusBox.getSize(new THREE.Vector3());
    var halfW = Math.max(0.55, Math.max(size.x, size.z) * 0.56);
    var halfH = Math.max(0.55, size.y * 0.56);

    var az = 0.08;
    var el = 0.15;
    var fill = 0.72;

    if (preset === "wide") {
      az = lerp(-0.14, 0.06, p);
      el = 0.2;
      fill = 0.58;
    } else if (preset === "medium") {
      az = lerp(0.12, -0.06, p);
      el = 0.15;
      fill = 0.72;
    } else if (preset === "close") {
      az = lerp(0.05, -0.04, p);
      el = 0.1;
      fill = 0.84;
    } else if (preset === "dolly-in") {
      az = lerp(-0.1, 0.02, p);
      el = lerp(0.17, 0.1, p);
      fill = lerp(0.6, 0.84, p);
    } else if (preset === "orbit") {
      az = lerp(-0.36, 0.36, p);
      el = 0.17;
      fill = 0.74;
    }

    if (clayRig) {
      az = clamp(az + (clayRig.truckX || 0) * 2.2 + ((clayRig.orbitAz || 0) * Math.PI / 180) * 0.45, -0.58, 0.58);
      el = clamp(el - (clayRig.truckY || 0) * 1.15 + ((clayRig.tiltEl || 0) * Math.PI / 180) * 0.45, 0.05, 0.44);
      fill = clamp(fill * Math.pow(clayRig.zoom || 1, 0.72), 0.48, 0.88);
    }

    var safeW = safeZone.maxX - safeZone.minX;
    var safeH = safeZone.maxY - safeZone.minY;
    var safeCx = (safeZone.minX + safeZone.maxX) * 0.5;
    var safeCy = lerp(safeZone.minY, safeZone.maxY, 0.56);
    var usableW = safeW * 0.9;
    var usableH = safeH * 0.9;

    var vFovRad = THREE.MathUtils.degToRad(camera.fov);
    var tanHalfV = Math.tan(vFovRad * 0.5);
    var tanHalfH = tanHalfV * camera.aspect;

    var dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el)
    ).normalize();

    var distV = halfH / (tanHalfV * fill * (usableH / height));
    var distH = halfW / (tanHalfH * fill * (usableW / width));
    var dist = Math.max(distV, distH, Math.max(halfW, halfH) * 2.4);

    var lookTarget = center.clone();

    // Iteratively align projected steady bbox center onto safe zone center
    var bbox = null;
    var padPx = 14;
    var innerMinX = safeZone.minX + padPx;
    var innerMaxX = safeZone.maxX - padPx;
    var innerMinY = safeZone.minY + padPx;
    var innerMaxY = safeZone.maxY - padPx;
    var innerW = innerMaxX - innerMinX;
    var innerH = innerMaxY - innerMinY;

    for (var iter = 0; iter < 12; iter++) {
      camera.position.copy(lookTarget).addScaledVector(dir, dist);
      camera.lookAt(lookTarget);
      bbox = projectBoxToPixels(focusBox, camera, width, height);

      var midX = (bbox.minX + bbox.maxX) * 0.5;
      var midY = (bbox.minY + bbox.maxY) * 0.5;
      var errX = midX - safeCx;
      var errY = midY - safeCy;

      var worldH = 2 * dist * tanHalfV;
      var worldW = worldH * camera.aspect;
      var camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      var camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

      if (Math.abs(errX) > 3 || Math.abs(errY) > 3) {
        lookTarget.addScaledVector(camRight, (errX / width) * worldW * 0.85);
        lookTarget.addScaledVector(camUp, -(errY / height) * worldH * 0.85);
      }

      var scaleNeededX = bbox.width / innerW;
      var scaleNeededY = bbox.height / innerH;
      var maxScaleNeeded = Math.max(scaleNeededX, scaleNeededY);
      if (bbox.behind) {
        dist *= 1.45;
      } else if (maxScaleNeeded > 1.0) {
        dist *= maxScaleNeeded * 1.06;
      } else if (
        bbox.minX < innerMinX ||
        bbox.maxX > innerMaxX ||
        bbox.minY < innerMinY ||
        bbox.maxY > innerMaxY
      ) {
        dist *= 1.06;
      } else if (Math.abs(errX) <= 4 && Math.abs(errY) <= 4) {
        break;
      }
    }

    // Guarantee actual live animated geometry (e.g. jump apex / striding limbs) stays inside safeZone
    camera.position.copy(lookTarget).addScaledVector(dir, dist);
    camera.lookAt(lookTarget);
    var actualBbox = projectBoxToPixels(liveBox, camera, width, height);
    var guardClamped = false;
    for (var guardIter = 0; guardIter < 8; guardIter++) {
      if (
        !actualBbox.behind &&
        actualBbox.minX >= innerMinX &&
        actualBbox.maxX <= innerMaxX &&
        actualBbox.minY >= innerMinY &&
        actualBbox.maxY <= innerMaxY
      ) {
        break;
      }
      guardClamped = true;
      dist *= 1.08;
      camera.position.copy(lookTarget).addScaledVector(dir, dist);
      camera.lookAt(lookTarget);
      actualBbox = projectBoxToPixels(liveBox, camera, width, height);
    }

    if (clayRig) actualBbox._guardClamped = guardClamped;
    return actualBbox;
  }

  function synthesizeWordsFromCaption(captionText, duration) {
    if (!captionText || typeof captionText !== "string") return [];
    var tokens = captionText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    var startPad = Math.min(0.2, duration * 0.06);
    var usable = Math.max(0.4, duration - startPad - 0.2);
    var step = usable / tokens.length;
    return tokens.map(function (w, idx) {
      return {
        word: w,
        start: Math.round((startPad + idx * step) * 1000) / 1000,
        end: Math.round((startPad + (idx + 1) * step) * 1000) / 1000
      };
    });
  }

  function createStoryPlayer(storySpec, opts) {
    if (typeof THREE === "undefined") {
      throw new Error("THREE global missing; load /script/three.min.js before story-runtime.js");
    }
    var kit = GLOBAL_SCOPE.ClayKit;
    if (!kit || typeof kit.makeAsset !== "function") {
      throw new Error("ClayKit.makeAsset missing; load clay-kit.js and clay-assets.js before story-runtime.js");
    }

    var W = Number((storySpec.canvas && storySpec.canvas.w) || 1080);
    var H = Number((storySpec.canvas && storySpec.canvas.h) || 1920);
    var FPS = Number((storySpec.canvas && storySpec.canvas.fps) || 30);
    var safeZone = computeSafeZone(W, H);
    var glCanvas = opts.glCanvas;
    var hudCanvas = opts.hudCanvas;
    var hudCtx = hudCanvas ? hudCanvas.getContext("2d") : null;
    var forceSilentMicrostock = !!opts.isMicrostock;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xdbeafe, 0.006);

    var camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 180);
    var renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    if (typeof renderer.setPixelRatio === "function") renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);
    var sunLight = new THREE.DirectionalLight(0xfffbeb, 0.5);
    sunLight.position.set(10, 20, 14);
    sunLight.castShadow = true;
    scene.add(sunLight);

    var outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
    var stages = {
      "open-field": buildStageBackdrop(kit, "open-field", outlineMat),
      "city-street": buildStageBackdrop(kit, "city-street", outlineMat),
      "indoor-room": buildStageBackdrop(kit, "indoor-room", outlineMat)
    };
    scene.add(stages["open-field"].root);
    scene.add(stages["city-street"].root);
    scene.add(stages["indoor-room"].root);

    // Instantiate cast + props via ClayKit.makeAsset
    var actors = {};
    var defaults = {};
    var restBounds = {};
    var allEntries = []
      .concat(Array.isArray(storySpec.cast) ? storySpec.cast : [])
      .concat(Array.isArray(storySpec.props) ? storySpec.props : []);

    allEntries.forEach(function (entry) {
      var assetSpec = Object.assign({}, entry.asset, { id: entry.id });
      var handle = kit.makeAsset(assetSpec);
      handle.group.position.set(0, 0, 0);
      handle.group.rotation.set(0, 0, 0);
      handle.group.updateWorldMatrix(true, true);
      var rBox = new THREE.Box3().setFromObject(handle.group);
      var rXZ = Math.max(
        Math.abs(rBox.min.x),
        Math.abs(rBox.max.x),
        Math.abs(rBox.min.z),
        Math.abs(rBox.max.z),
        0.45
      );
      restBounds[entry.id] = {
        rXZ: rXZ,
        minY: rBox.min.y,
        maxY: rBox.max.y
      };

      var pos = Array.isArray(entry.pos) && entry.pos.length === 3 ? entry.pos : [0, 0, 0];
      var rotY = typeof entry.rotY === "number" ? entry.rotY : 0;
      var visible = entry.visible !== false;
      var expression = typeof entry.expression === "string" ? entry.expression : "happy";
      var emote = typeof entry.emote === "string" ? entry.emote : "";
      handle.group.position.set(pos[0], pos[1], pos[2]);
      handle.group.rotation.y = rotY;
      handle.group.visible = visible;
      scene.add(handle.group);
      actors[entry.id] = handle;
      defaults[entry.id] = { pos: pos.slice(), rotY: rotY, visible: visible, expression: expression, emote: emote };
    });

    var shots = Array.isArray(storySpec.shots) ? storySpec.shots : [];
    var totalDuration = shots.reduce(function (acc, s) {
      return Math.max(acc, Number(s.start || 0) + Number(s.duration || 0));
    }, 0.01);

    var customShotsCount = shots.filter(function (s) {
      return typeof s.custom === "string" && s.custom.trim().length > 0;
    }).length;
    var storyStats = {
      customShots: customShotsCount,
      totalShots: shots.length,
      customRatio: shots.length > 0 ? Math.round((customShotsCount / shots.length) * 1000) / 1000 : 0
    };

    var shotWords = {};
    shots.forEach(function (s) {
      shotWords[s.id] = synthesizeWordsFromCaption(s.caption || "", Number(s.duration || 1));
    });

    var captionsEnabled =
      !forceSilentMicrostock && !(storySpec.captions && storySpec.captions.enabled === false);

    var activeFocusGroup = null;
    GLOBAL_SCOPE.__shotReport = {};
    GLOBAL_SCOPE.__storyStats = storyStats;

    var worldRef = {
      scene: scene,
      camera: camera,
      renderer: renderer,
      actors: actors,
      stages: stages,
      getActiveFocusObject: function () {
        return activeFocusGroup;
      }
    };
    GLOBAL_SCOPE.__storyWorld = worldRef;

    function resolveShotAt(t) {
      var clampedT = clamp(Number(t) || 0, 0, Math.max(0.001, totalDuration - 0.0001));
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        var s0 = Number(s.start || 0);
        var s1 = s0 + Number(s.duration || 0);
        if (clampedT >= s0 && clampedT < s1) {
          return { shot: s, index: i, localTime: clampedT - s0, globalTime: clampedT };
        }
      }
      var last = shots[shots.length - 1];
      return {
        shot: last,
        index: shots.length - 1,
        localTime: Math.max(0, clampedT - Number(last.start || 0)),
        globalTime: clampedT
      };
    }

    function applyShotFrame(t) {
      var res = resolveShotAt(t);
      var shot = res.shot;
      var localT = res.localTime;
      var globalT = res.globalTime;
      var dur = Math.max(0.01, Number(shot.duration || 1));
      var errors = [];

      // Switch active stage preset & lighting mood
      var activeStage =
        shot.stage === "city-street"
          ? "city-street"
          : shot.stage === "indoor-room"
          ? "indoor-room"
          : "open-field";
      stages["open-field"].root.visible = activeStage === "open-field";
      stages["city-street"].root.visible = activeStage === "city-street";
      stages["indoor-room"].root.visible = activeStage === "indoor-room";
      stages[activeStage].update(globalT);

      var mood = shot.mood === "sunset" ? "sunset" : shot.mood === "night" ? "night" : "day";
      if (mood === "sunset") {
        ambientLight.color.setHex(0xffedd5);
        ambientLight.intensity = 0.68;
        sunLight.color.setHex(0xfb923c);
        sunLight.intensity = 0.58;
        scene.fog.color.setHex(0xfed7aa);
        scene.background = new THREE.Color(0xfdba74);
      } else if (mood === "night") {
        ambientLight.color.setHex(0xbfdbfe);
        ambientLight.intensity = 0.52;
        sunLight.color.setHex(0x93c5fd);
        sunLight.intensity = 0.42;
        scene.fog.color.setHex(0x1e293b);
        scene.background = new THREE.Color(0x1e293b);
      } else {
        ambientLight.color.setHex(0xffffff);
        ambientLight.intensity = 0.65;
        sunLight.color.setHex(0xfffbeb);
        sunLight.intensity = 0.5;
        scene.fog.color.setHex(0xdbeafe);
        scene.background = null;
      }

      // Reset all actors to default pose, expression, emote & placements, then apply shot overrides
      var shotRestRotY = {};
      Object.keys(actors).forEach(function (id) {
        var a = actors[id];
        var d = defaults[id];
        a.group.position.set(d.pos[0], d.pos[1], d.pos[2]);
        a.group.rotation.set(0, d.rotY, 0);
        a.group.visible = d.visible;
        shotRestRotY[id] = d.rotY;
        a.animate("idle", (globalT * 0.5) % 1);
        if (typeof a.setExpression === "function") a.setExpression(d.expression || "happy");
        if (typeof a.setEmote === "function") a.setEmote(d.emote || "", globalT);
      });

      if (shot.placements && typeof shot.placements === "object") {
        Object.keys(shot.placements).forEach(function (id) {
          var a = actors[id];
          var pl = shot.placements[id];
          if (!a || !pl) return;
          if (Array.isArray(pl.pos) && pl.pos.length === 3) {
            a.group.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
          }
          if (typeof pl.rotY === "number") {
            a.group.rotation.y = pl.rotY;
            shotRestRotY[id] = pl.rotY;
          }
          if (typeof pl.visible === "boolean") a.group.visible = pl.visible;
          if (typeof pl.expression === "string" && typeof a.setExpression === "function") {
            try {
              a.setExpression(pl.expression);
            } catch (eExpr) {
              errors.push(String(eExpr && eExpr.message ? eExpr.message : eExpr));
            }
          }
          if (typeof pl.emote === "string" && typeof a.setEmote === "function") {
            try {
              a.setEmote(pl.emote, globalT);
            } catch (eEm) {
              errors.push(String(eEm && eEm.message ? eEm.message : eEm));
            }
          }
        });
      }

      // Apply deterministic locomotion (from -> to) and pose animations cleanly
      var actions = Array.isArray(shot.actions) ? shot.actions : [];
      var hasMoved = {};
      var hasAnimated = {};
      for (var ai = 0; ai < actions.length; ai++) {
        var act = actions[ai];
        var target = actors[act.target];
        if (!target) {
          errors.push("Unknown action target: " + String(act.target));
          continue;
        }
        var actStart = Number(act.at || 0);
        var actDur = Math.max(0.001, Number(act.dur || 1));
        var actEnd = actStart + actDur;
        var hasFrom = isVec3Array(act.from);
        var hasTo = isVec3Array(act.to);

        if (localT < actStart) {
          if (hasFrom && !hasMoved[act.target]) {
            target.group.position.set(act.from[0], act.from[1], act.from[2]);
          }
          if ((act.anim === "pop-in" || act.anim === "grow") && actStart > 0.01 && !hasAnimated[act.target]) {
            try {
              target.animate(act.anim, 0);
            } catch (ePre) {
              errors.push(String(ePre && ePre.message ? ePre.message : ePre));
            }
          }
          continue;
        }

        // Action is currently active or completed (keep final `to` position without freezing pose)
        var p = clamp((localT - actStart) / actDur, 0, 1);
        if (hasTo) {
          var startPos = hasFrom
            ? act.from
            : [target.group.position.x, target.group.position.y, target.group.position.z];
          var moveP = easeLocomotion(p);
          target.group.position.set(
            lerp(startPos[0], act.to[0], moveP),
            lerp(startPos[1], act.to[1], moveP),
            lerp(startPos[2], act.to[2], moveP)
          );
          hasMoved[act.target] = true;

          var dx = act.to[0] - startPos[0];
          var dz = act.to[2] - startPos[2];
          if (act.faceMove !== false && dx * dx + dz * dz > 0.0004) {
            var travelYaw = Math.atan2(dx, dz);
            if (localT <= actEnd) {
              var turnIn = clamp((localT - actStart) / 0.25, 0, 1);
              target.group.rotation.y = lerpAngle(target.group.rotation.y, travelYaw, turnIn);
            } else {
              var turnOut = clamp((localT - actEnd) / 0.35, 0, 1);
              target.group.rotation.y = lerpAngle(travelYaw, shotRestRotY[act.target] || 0, turnOut);
            }
          }
        }

        if (localT <= actEnd) {
          hasAnimated[act.target] = true;
          try {
            target.animate(act.anim, p, { elapsedSec: localT - actStart });
            if (typeof act.expression === "string" && typeof target.setExpression === "function") {
              target.setExpression(act.expression);
            }
            if (typeof act.emote === "string" && typeof target.setEmote === "function") {
              target.setEmote(act.emote, localT - actStart);
            }
          } catch (e) {
            errors.push(String(e && e.message ? e.message : e));
          }
        }
      }

      // Compute steady focus Box3 (for jitter-free camera tracking) + actual live focus Box3
      var focusIds = Array.isArray(shot.focus) ? shot.focus : [shot.focus];
      var steadyFocusBox = new THREE.Box3();
      var focusBox = new THREE.Box3();
      var focusObjects = [];
      for (var fi = 0; fi < focusIds.length; fi++) {
        var fid = focusIds[fi];
        var fa = actors[fid];
        if (!fa) {
          errors.push("Unknown focus id: " + String(fid));
          continue;
        }
        fa.group.visible = true;
        fa.group.updateWorldMatrix(true, true);
        focusBox.expandByObject(fa.group);
        var rb = restBounds[fid];
        if (rb) {
          var gp = fa.group.position;
          steadyFocusBox.expandByPoint(new THREE.Vector3(gp.x - rb.rXZ, gp.y + rb.minY, gp.z - rb.rXZ));
          steadyFocusBox.expandByPoint(new THREE.Vector3(gp.x + rb.rXZ, gp.y + rb.maxY + 0.28, gp.z + rb.rXZ));
        } else {
          steadyFocusBox.expandByObject(fa.group);
        }
        focusObjects.push(fa.group);
      }

      // Expose a lightweight proxy object for external inspector tools
      activeFocusGroup = focusObjects.length === 1 ? focusObjects[0] : null;
      if (focusObjects.length > 1) {
        var tmpBox = focusBox.clone();
        activeFocusGroup = {
          updateWorldMatrix: function () {},
          traverse: function () {},
          isObject3D: true
        };
        // Attach exact world box lookup when inspector runs on multi-focus
        worldRef.getActiveFocusObject = function () {
          return focusObjects[0];
        };
        void tmpBox;
      } else {
        worldRef.getActiveFocusObject = function () {
          return activeFocusGroup;
        };
      }

      var preset = (shot.camera && shot.camera.preset) || "medium";
      var clayCam = shot.camera && typeof shot.camera === "object" ? shot.camera : null;
      var hasClayOptIn = Boolean(
        storySpec.cameraStyle ||
          (clayCam &&
            (clayCam.move ||
              clayCam.style ||
              clayCam.dir ||
              clayCam.intensity !== undefined ||
              clayCam.moveDuration !== undefined ||
              clayCam.curve ||
              clayCam.seed !== undefined))
      );
      var clayCamRes = null;
      if (hasClayOptIn && GLOBAL_SCOPE.StoryCamera && typeof GLOBAL_SCOPE.StoryCamera.resolve === "function") {
        // Strip clay's `camera.preset` (e.g. "dolly-in") so StoryCamera never treats it as a 2D Cobalt legacy preset
        var sanitizedShots = shots.map(function (sh) {
          if (!sh || !sh.camera || typeof sh.camera !== "object" || sh.camera.preset === undefined) return sh;
          var camCopy = Object.assign({}, sh.camera);
          delete camCopy.preset;
          return Object.assign({}, sh, { camera: camCopy });
        });
        var camStory = Object.assign({}, storySpec, { shots: sanitizedShots });
        var camShot = sanitizedShots[res.index] || shot;
        clayCamRes = GLOBAL_SCOPE.StoryCamera.resolve(camStory, camShot, localT, dur, {
          W: W,
          H: H,
          safe: safeZone,
          recordReport: false
        });
      }

      var bbox = null;
      var inSafe = false;
      if (!focusBox.isEmpty()) {
        bbox = frameCameraToFocus(
          camera,
          steadyFocusBox,
          focusBox,
          preset,
          localT / dur,
          W,
          H,
          safeZone,
          clayCamRes && clayCamRes.plan && clayCamRes.plan.active ? clayCamRes.rig : null
        );
        var wasClamped = Boolean(bbox && bbox._guardClamped);
        if (bbox && bbox._guardClamped !== undefined) delete bbox._guardClamped;
        inSafe = isBoxInsideSafeZone(bbox, safeZone);
        if (clayCamRes && clayCamRes.report) {
          GLOBAL_SCOPE.__cameraReport = GLOBAL_SCOPE.__cameraReport || {};
          GLOBAL_SCOPE.__cameraReport[shot.id] = Object.assign({}, clayCamRes.report, {
            guard: wasClamped ? "clamped" : "measured"
          });
        }
        if (!inSafe) {
          errors.push("Focus bbox outside safeZone on shot " + shot.id);
        }
      } else {
        errors.push("Empty focus bbox on shot " + shot.id);
      }

      // Optional custom escape hatch scene renderer
      if (hudCtx) {
        hudCtx.clearRect(0, 0, W, H);
      }
      var customFn =
        shot.custom && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.getSceneRenderer === "function"
          ? GLOBAL_SCOPE.AM.getSceneRenderer(shot.id, res.index)
          : null;
      if (customFn && hudCtx) {
        customFn(hudCtx, localT, dur, shot, GLOBAL_SCOPE.AM, worldRef, globalT);
      } else {
        renderer.render(scene, camera);
      }

      if (captionsEnabled && hudCtx && GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.drawSubtitles === "function") {
        var words = shotWords[shot.id] || [];
        if (words.length > 0) {
          GLOBAL_SCOPE.AM.drawSubtitles(hudCtx, words, localT, SUBTITLE_STYLE);
        }
      }

      GLOBAL_SCOPE.__shotReport[shot.id] = {
        shotId: shot.id,
        t: Math.round(globalT * 1000) / 1000,
        localTime: Math.round(localT * 1000) / 1000,
        focus: shot.focus,
        preset: preset,
        stage: activeStage,
        focusBboxInSafeZone: inSafe,
        bbox: bbox,
        safeZone: safeZone,
        errors: errors
      };

      return GLOBAL_SCOPE.__shotReport[shot.id];
    }

    function loadExternalWords() {
      var tasks = shots.map(function (s) {
        var wordsUrl = (s.audio && s.audio.words) || (storySpec.audio && storySpec.audio.words) || "";
        if (!wordsUrl || typeof fetch !== "function") return Promise.resolve();
        var cleanUrl = wordsUrl.charAt(0) === "/" ? wordsUrl : "/" + wordsUrl;
        return fetch(cleanUrl)
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (data) {
            if (data && Array.isArray(data.words) && data.words.length > 0) {
              shotWords[s.id] = data.words;
            }
          })
          .catch(function () {});
      });
      return Promise.all(tasks);
    }

    GLOBAL_SCOPE.__filmMeta = {
      title: storySpec.title || "Soft-Clay Story",
      width: W,
      height: H,
      fps: FPS,
      duration: totalDuration,
      durationInFrames: Math.round(totalDuration * FPS),
      captionsEnabled: captionsEnabled,
      storyStats: storyStats,
      scenes: shots.map(function (s) {
        return {
          id: s.id,
          title: s.id,
          start: s.start,
          duration: s.duration,
          audio: (s.audio && s.audio.wav) || (storySpec.audio && storySpec.audio.wav) || undefined,
          words: (s.audio && s.audio.words) || (storySpec.audio && storySpec.audio.words) || undefined
        };
      })
    };

    GLOBAL_SCOPE.renderAt = applyShotFrame;

    return {
      renderAt: applyShotFrame,
      loadExternalWords: loadExternalWords,
      world: worldRef,
      stats: storyStats,
      safeZone: safeZone
    };
  }

  function boot(opts) {
    var storyUrl = (opts && opts.storyUrl) || "/story.json";
    var fallbackUrl = (opts && opts.fallbackStoryUrl) || "/story.example.json";
    var loadSpec = function () {
      if (opts && opts.storySpec) return Promise.resolve(opts.storySpec);
      return fetch(storyUrl)
        .then(function (r) {
          if (r.ok) return r.json();
          if (fallbackUrl && fallbackUrl !== storyUrl) {
            return fetch(fallbackUrl).then(function (r2) {
              if (!r2.ok) throw new Error("Failed loading story spec from " + storyUrl + " or " + fallbackUrl);
              return r2.json();
            });
          }
          throw new Error("Failed loading story spec from " + storyUrl);
        });
    };

    return loadSpec()
      .then(function (spec) {
        var player = createStoryPlayer(spec, opts || {});
        return player.loadExternalWords().then(function () {
          player.renderAt(0);
          GLOBAL_SCOPE.__ready = true;
          return player;
        });
      })
      .catch(function (err) {
        GLOBAL_SCOPE.__runtimeError = String(err && err.message ? err.message : err);
        GLOBAL_SCOPE.__ready = true;
        throw err;
      });
  }

  GLOBAL_SCOPE.StoryRuntime = {
    createStoryPlayer: createStoryPlayer,
    boot: boot,
    computeSafeZone: computeSafeZone
  };
})();
