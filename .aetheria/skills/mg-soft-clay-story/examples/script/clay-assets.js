(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;
  var OUTLINE_COLOR = 0x594637;

  var ASSET_KINDS = [
    "humanoid",
    "flower-row",
    "container",
    "insect",
    "tree",
    "building",
    "vehicle",
    "blob"
  ];

  var HUMANOID_ACCESSORIES = ["hat-conical", "hat-cap", "towel"];
  var ASSET_ANIMATIONS = ["idle", "walk", "hop", "grow", "pop-in"];

  function specError(code, path, hint) {
    var err = new Error("[" + code + "] " + (path || "<root>") + ": " + hint);
    err.name = "ClayAssetSpecError";
    err.code = code;
    err.path = path || "";
    err.hint = hint;
    return err;
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  function makeRng(seedStr) {
    var seed = hashString(String(seedStr || "clay"));
    if (GLOBAL_SCOPE.AM && typeof GLOBAL_SCOPE.AM.rng === "function") {
      return GLOBAL_SCOPE.AM.rng(seed);
    }
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function parseColorHex(value, path) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 0xffffff) {
      return Math.floor(value);
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
        return parseInt(trimmed.slice(1), 16);
      }
      if (/^0x[0-9a-fA-F]{6}$/i.test(trimmed)) {
        return parseInt(trimmed.slice(2), 16);
      }
    }
    throw specError(
      "INVALID_PALETTE",
      path,
      "Expected 6-digit hex color string (e.g. '#FB7185') or 24-bit integer."
    );
  }

  function validateSpec(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw specError(
        "INVALID_SPEC",
        "",
        "Provide an asset object: { id, kind, palette?, scale?, accessories?, tags? }."
      );
    }
    if (typeof spec.id !== "string" || !spec.id.trim()) {
      throw specError("INVALID_ID", "id", "Provide a non-empty string id (e.g. 'farmer-1').");
    }
    if (typeof spec.kind !== "string" || ASSET_KINDS.indexOf(spec.kind) === -1) {
      throw specError(
        "UNKNOWN_KIND",
        "kind",
        "Unsupported kind '" + String(spec.kind) + "'. Valid kinds: " + ASSET_KINDS.join(", ") + "."
      );
    }
    var scale = 1.0;
    if (spec.scale !== undefined) {
      if (typeof spec.scale !== "number" || !Number.isFinite(spec.scale) || spec.scale <= 0.1 || spec.scale > 10) {
        throw specError("INVALID_SCALE", "scale", "Scale must be a finite number in (0.1, 10].");
      }
      scale = spec.scale;
    }
    var palette = {};
    if (spec.palette !== undefined) {
      if (!spec.palette || typeof spec.palette !== "object" || Array.isArray(spec.palette)) {
        throw specError("INVALID_PALETTE", "palette", "Palette must be a key-value map of hex colors.");
      }
      var pKeys = Object.keys(spec.palette);
      for (var pi = 0; pi < pKeys.length; pi++) {
        var pk = pKeys[pi];
        palette[pk] = parseColorHex(spec.palette[pk], "palette." + pk);
      }
    }
    var accessories = [];
    if (spec.accessories !== undefined) {
      if (!Array.isArray(spec.accessories)) {
        throw specError("INVALID_ACCESSORIES", "accessories", "Accessories must be an array of strings.");
      }
      var allowed = spec.kind === "humanoid" ? HUMANOID_ACCESSORIES : [];
      for (var ai = 0; ai < spec.accessories.length; ai++) {
        var acc = spec.accessories[ai];
        if (typeof acc !== "string" || allowed.indexOf(acc) === -1) {
          throw specError(
            "UNKNOWN_ACCESSORY",
            "accessories[" + ai + "]",
            allowed.length > 0
              ? "Unsupported accessory '" + String(acc) + "' for '" + spec.kind + "'. Allowed: " + allowed.join(", ") + "."
              : "Kind '" + spec.kind + "' does not accept accessories (pass [] or omit)."
          );
        }
        if (accessories.indexOf(acc) === -1) accessories.push(acc);
      }
    }
    var tags = [];
    if (spec.tags !== undefined) {
      if (!Array.isArray(spec.tags)) {
        throw specError("INVALID_TAGS", "tags", "Tags must be an array of strings.");
      }
      for (var ti = 0; ti < spec.tags.length; ti++) {
        if (typeof spec.tags[ti] !== "string") {
          throw specError("INVALID_TAGS", "tags[" + ti + "]", "Each tag must be a string.");
        }
        tags.push(spec.tags[ti]);
      }
    }
    return {
      id: spec.id.trim(),
      kind: spec.kind,
      palette: palette,
      scale: scale,
      accessories: accessories,
      tags: tags
    };
  }

  function clamp01(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function easeOutBack(p) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    var x = clamp01(p) - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }

  function lambert(hex) {
    return new THREE.MeshLambertMaterial({ color: hex });
  }

  function basic(hex) {
    return new THREE.MeshBasicMaterial({ color: hex });
  }

  function makeAnchor(name, x, y, z) {
    var obj = new THREE.Object3D();
    obj.name = "anchor_" + name;
    obj.position.set(x, y, z);
    return obj;
  }

  function addOutlined(kit, geo, mat, outlineMat, thickness, castShadow, receiveShadow) {
    return kit.addOutlinedMesh(geo, mat, outlineMat, thickness, castShadow, receiveShadow);
  }

  function buildHumanoid(kit, spec, outlineMat) {
    var pal = spec.palette;
    var skinMat = lambert(pal.skin !== undefined ? pal.skin : 0xfde2c8);
    var shirtMat = lambert(pal.primary !== undefined ? pal.primary : (pal.shirt !== undefined ? pal.shirt : 0x60a5fa));
    var pantsMat = lambert(pal.secondary !== undefined ? pal.secondary : (pal.pants !== undefined ? pal.pants : 0x78716c));
    var accentMat = lambert(pal.accent !== undefined ? pal.accent : 0xfb7185);
    var hairMat = lambert(pal.hair !== undefined ? pal.hair : 0x594637);
    var darkInk = basic(OUTLINE_COLOR);
    var blushMat = basic(pal.blush !== undefined ? pal.blush : 0xfda4af);

    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);

    // Rounded clay head
    var headGroup = new THREE.Group();
    headGroup.position.set(0, 1.76, 0);
    bodyBounce.add(headGroup);
    var headGeo = new THREE.SphereGeometry(0.64, 32, 24);
    headGeo.scale(1.06, 0.96, 0.94);
    headGroup.add(addOutlined(kit, headGeo, skinMat, outlineMat, 0.048).group);

    // Soft hair cap at back/top
    var hairGeo = new THREE.SphereGeometry(0.66, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.54);
    hairGeo.scale(1.06, 0.95, 0.96);
    var hairMesh = addOutlined(kit, hairGeo, hairMat, outlineMat, 0.036).group;
    hairMesh.position.set(0, 0.04, -0.04);
    hairMesh.rotation.x = -0.18;
    headGroup.add(hairMesh);

    // Eyes, blush & smile
    [-0.22, 0.22].forEach(function (ex) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 14), darkInk);
      eye.scale.set(0.85, 1.15, 0.4);
      eye.position.set(ex, 0.02, 0.58);
      headGroup.add(eye);
      var cheek = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), blushMat);
      cheek.scale.set(1.15, 0.78, 0.25);
      cheek.position.set(ex * 1.65, -0.1, 0.54);
      headGroup.add(cheek);
    });
    var smilePts = [
      new THREE.Vector3(-0.08, -0.14, 0.59),
      new THREE.Vector3(0, -0.19, 0.61),
      new THREE.Vector3(0.08, -0.14, 0.59)
    ];
    headGroup.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(smilePts), 12, 0.022, 8, false),
        darkInk
      )
    );

    // Torso (shirt + pants)
    var torso = new THREE.Group();
    torso.position.set(0, 0.86, 0);
    bodyBounce.add(torso);
    var shirt = addOutlined(kit, kit.createSmoothTorsoPartGeometry(0.54, 0.62, 0.62, 0.76), shirtMat, outlineMat, 0.045);
    shirt.group.position.set(0, 0.12, 0);
    torso.add(shirt.group);
    var pants = addOutlined(kit, kit.createSmoothTorsoPartGeometry(0.60, 0.54, 0.44, 0.76), pantsMat, outlineMat, 0.045);
    pants.group.position.set(0, -0.24, 0);
    torso.add(pants.group);

    // Arms & legs
    function makeLimbArm(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.62, 1.06, 0);
      var sleeve = addOutlined(kit, new THREE.SphereGeometry(0.16, 18, 16), shirtMat, outlineMat, 0.036).group;
      sleeve.scale.set(1.15, 0.88, 0.88);
      sleeve.position.set(side * 0.12, -0.05, 0);
      var hand = addOutlined(kit, new THREE.SphereGeometry(0.14, 18, 16), skinMat, outlineMat, 0.036).group;
      hand.position.set(side * 0.28, -0.14, 0.04);
      g.add(sleeve, hand);
      return g;
    }
    function makeLimbLeg(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.25, 0.44, 0);
      var leg = addOutlined(kit, kit.createSmoothTorsoPartGeometry(0.18, 0.16, 0.28, 0.86), pantsMat, outlineMat, 0.036).group;
      leg.position.set(0, -0.1, 0);
      var foot = addOutlined(kit, new THREE.SphereGeometry(0.17, 18, 14), accentMat, outlineMat, 0.038).group;
      foot.scale.set(0.95, 0.72, 1.25);
      foot.position.set(0, -0.29, 0.06);
      g.add(leg, foot);
      return g;
    }
    var leftArm = makeLimbArm(-1);
    var rightArm = makeLimbArm(1);
    var leftLeg = makeLimbLeg(-1);
    var rightLeg = makeLimbLeg(1);
    bodyBounce.add(leftArm, rightArm, leftLeg, rightLeg);

    // Accessories
    var topY = 2.42;
    for (var i = 0; i < spec.accessories.length; i++) {
      var acc = spec.accessories[i];
      if (acc === "hat-conical") {
        var hatG = new THREE.Group();
        var strawMat = lambert(pal.hat !== undefined ? pal.hat : 0xfde68a);
        var bandMat = lambert(pal.accent !== undefined ? pal.accent : 0xd97706);
        var coneGeo = new THREE.ConeGeometry(1.02, 0.56, 28);
        var cone = addOutlined(kit, coneGeo, strawMat, outlineMat, 0.04).group;
        cone.position.set(0, 0.26, 0);
        var bandGeo = new THREE.TorusGeometry(0.56, 0.055, 10, 28);
        bandGeo.rotateX(Math.PI / 2);
        var band = new THREE.Mesh(bandGeo, bandMat);
        band.position.set(0, 0.12, 0);
        hatG.add(cone, band);
        hatG.position.set(0, 0.34, -0.02);
        headGroup.add(hatG);
        topY = Math.max(topY, 2.74);
      } else if (acc === "hat-cap") {
        var capG = new THREE.Group();
        var capMat = lambert(pal.hat !== undefined ? pal.hat : 0xfb7185);
        var domeGeo = new THREE.SphereGeometry(0.68, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.52);
        var dome = addOutlined(kit, domeGeo, capMat, outlineMat, 0.038).group;
        var brimGeo = new THREE.CylinderGeometry(0.52, 0.56, 0.08, 20, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
        var brim = addOutlined(kit, brimGeo, capMat, outlineMat, 0.03).group;
        brim.position.set(0, 0.04, 0.42);
        brim.rotation.x = 0.14;
        var button = addOutlined(kit, new THREE.SphereGeometry(0.08, 12, 10), accentMat, outlineMat, 0.02).group;
        button.position.set(0, 0.68, 0);
        capG.add(dome, brim, button);
        capG.position.set(0, 0.08, 0);
        headGroup.add(capG);
        topY = Math.max(topY, 2.66);
      } else if (acc === "towel") {
        var towelG = new THREE.Group();
        var towelMat = lambert(pal.towel !== undefined ? pal.towel : 0xfffdf9);
        var stripeMat = lambert(pal.accent !== undefined ? pal.accent : 0x38bdf8);
        var collarGeo = new THREE.TorusGeometry(0.54, 0.11, 14, 28);
        collarGeo.rotateX(Math.PI / 2);
        collarGeo.scale(1.04, 1.0, 0.85);
        towelG.add(addOutlined(kit, collarGeo, towelMat, outlineMat, 0.032).group);
        [-0.36, 0.36].forEach(function (tx) {
          var tailGeo = new THREE.BoxGeometry(0.22, 0.48, 0.1);
          var tail = addOutlined(kit, tailGeo, towelMat, outlineMat, 0.028).group;
          tail.position.set(tx, -0.22, 0.42);
          tail.rotation.z = tx < 0 ? 0.12 : -0.12;
          var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.07, 0.115), stripeMat);
          stripe.position.set(0, -0.14, 0);
          tail.add(stripe);
          towelG.add(tail);
        });
        towelG.position.set(0, 0.39, 0);
        torso.add(towelG);
      }
    }

    var anchors = {
      head: makeAnchor("head", 0, topY - 1.76, 0),
      "hand-L": makeAnchor("hand-L", -0.34, -0.14, 0.04),
      "hand-R": makeAnchor("hand-R", 0.34, -0.14, 0.04),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    headGroup.add(anchors.head);
    leftArm.add(anchors["hand-L"]);
    rightArm.add(anchors["hand-R"]);
    rig.add(anchors.ground);

    return {
      rig: rig,
      bodyBounce: bodyBounce,
      anchors: anchors,
      parts: { headGroup: headGroup, leftArm: leftArm, rightArm: rightArm, leftLeg: leftLeg, rightLeg: rightLeg }
    };
  }

  function buildFlowerRow(kit, spec, outlineMat, rng) {
    var pal = spec.palette;
    var soilMat = lambert(pal.soil !== undefined ? pal.soil : 0x926243);
    var stemMat = lambert(pal.stem !== undefined ? pal.stem : 0x4ade80);
    var petalMat = lambert(pal.primary !== undefined ? pal.primary : 0xfb923c);
    var centerMat = lambert(pal.accent !== undefined ? pal.accent : 0xfacc15);

    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);

    // Raised soft soil bed resting on y=0
    var bedGeo = new THREE.CylinderGeometry(0.52, 0.62, 2.5, 20);
    bedGeo.rotateZ(Math.PI / 2);
    bedGeo.scale(1.0, 0.42, 0.9);
    var bed = addOutlined(kit, bedGeo, soilMat, outlineMat, 0.04, true, true).group;
    bed.position.set(0, 0.24, 0);
    bodyBounce.add(bed);

    var flowers = [];
    var count = 5;
    for (var i = 0; i < count; i++) {
      var fx = -0.96 + (i / (count - 1)) * 1.92;
      var fz = (rng() - 0.5) * 0.26;
      var stemH = 0.72 + (i % 2) * 0.18 + rng() * 0.1;

      var fGroup = new THREE.Group();
      fGroup.position.set(fx, 0.40, fz);
      bodyBounce.add(fGroup);

      var stem = addOutlined(kit, new THREE.CylinderGeometry(0.05, 0.065, stemH, 12), stemMat, outlineMat, 0.025).group;
      stem.position.set(0, stemH / 2, 0);
      fGroup.add(stem);

      [-1, 1].forEach(function (side) {
        var leafGeo = new THREE.SphereGeometry(0.14, 14, 10);
        leafGeo.scale(1.35, 0.45, 0.75);
        var leaf = addOutlined(kit, leafGeo, stemMat, outlineMat, 0.022).group;
        leaf.position.set(side * 0.16, stemH * 0.48, 0);
        leaf.rotation.z = side * 0.45;
        fGroup.add(leaf);
      });

      var head = new THREE.Group();
      head.position.set(0, stemH + 0.08, 0);
      var core = addOutlined(kit, new THREE.SphereGeometry(0.14, 16, 14), centerMat, outlineMat, 0.025).group;
      core.scale.set(1, 0.75, 1);
      head.add(core);
      for (var pi = 0; pi < 6; pi++) {
        var ang = (pi / 6) * Math.PI * 2;
        var pGeo = new THREE.SphereGeometry(0.11, 12, 10);
        pGeo.scale(1.05, 0.62, 1.05);
        var petal = addOutlined(kit, pGeo, petalMat, outlineMat, 0.02).group;
        petal.position.set(Math.cos(ang) * 0.19, 0.02, Math.sin(ang) * 0.19);
        head.add(petal);
      }
      fGroup.add(head);
      flowers.push({ group: fGroup, head: head, phase: i * 0.12 });
    }

    var anchors = {
      head: makeAnchor("head", 0, 1.48, 0),
      "hand-L": makeAnchor("hand-L", -1.25, 0.6, 0),
      "hand-R": makeAnchor("hand-R", 1.25, 0.6, 0),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);

    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: { flowers: flowers } };
  }

  function buildContainer(kit, spec, outlineMat) {
    var pal = spec.palette;
    var bodyMat = lambert(pal.primary !== undefined ? pal.primary : 0x38bdf8);
    var capMat = lambert(pal.accent !== undefined ? pal.accent : 0xfacc15);
    var labelMat = lambert(pal.secondary !== undefined ? pal.secondary : 0xfffdf9);

    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);

    var bodyGeo = kit.createSmoothTorsoPartGeometry(0.56, 0.62, 1.12, 0.66);
    var body = addOutlined(kit, bodyGeo, bodyMat, outlineMat, 0.045).group;
    body.position.set(0, 0.58, 0);
    bodyBounce.add(body);

    var handleGeo = new THREE.TorusGeometry(0.24, 0.068, 12, 22, Math.PI);
    var handle = addOutlined(kit, handleGeo, bodyMat, outlineMat, 0.028).group;
    handle.position.set(-0.14, 1.12, 0);
    bodyBounce.add(handle);

    var neck = addOutlined(kit, new THREE.CylinderGeometry(0.11, 0.13, 0.22, 16), bodyMat, outlineMat, 0.026).group;
    neck.position.set(0.26, 1.18, 0);
    neck.rotation.z = -0.25;
    var cap = addOutlined(kit, new THREE.CylinderGeometry(0.135, 0.135, 0.13, 16), capMat, outlineMat, 0.026).group;
    cap.position.set(0.29, 1.32, 0);
    cap.rotation.z = -0.25;
    bodyBounce.add(neck, cap);

    var label = addOutlined(kit, new THREE.BoxGeometry(0.62, 0.44, 0.06), labelMat, outlineMat, 0.02, false, false).group;
    label.position.set(0, 0.58, 0.39);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.075), capMat);
    stripe.position.set(0, 0.06, 0);
    label.add(stripe);
    bodyBounce.add(label);

    var anchors = {
      head: makeAnchor("head", 0, 1.46, 0),
      "hand-L": makeAnchor("hand-L", -0.62, 0.72, 0),
      "hand-R": makeAnchor("hand-R", 0.62, 0.72, 0),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);

    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: {} };
  }

  function buildInsect(kit, spec, outlineMat) {
    var pal = spec.palette;
    var bodyMat = lambert(pal.primary !== undefined ? pal.primary : 0xa3e635);
    var wingMat = lambert(pal.accent !== undefined ? pal.accent : 0xe0f2fe);
    var stripeMat = lambert(pal.secondary !== undefined ? pal.secondary : 0x4d7c0f);
    var darkInk = basic(OUTLINE_COLOR);

    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);

    var abdomenGeo = new THREE.SphereGeometry(0.44, 24, 18);
    abdomenGeo.scale(1.28, 0.86, 0.88);
    var abdomen = addOutlined(kit, abdomenGeo, bodyMat, outlineMat, 0.038).group;
    abdomen.position.set(-0.14, 0.52, 0);
    bodyBounce.add(abdomen);

    var headGeo = new THREE.SphereGeometry(0.34, 22, 18);
    var head = addOutlined(kit, headGeo, stripeMat, outlineMat, 0.036).group;
    head.position.set(0.44, 0.64, 0);
    bodyBounce.add(head);

    [-0.16, 0.16].forEach(function (ez) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), darkInk);
      eye.position.set(0.68, 0.72, ez);
      bodyBounce.add(eye);
      var antPts = [
        new THREE.Vector3(0.56, 0.9, ez * 0.7),
        new THREE.Vector3(0.76, 1.15, ez * 1.25),
        new THREE.Vector3(0.92, 1.1, ez * 1.45)
      ];
      bodyBounce.add(
        new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(antPts), 10, 0.025, 8, false), darkInk)
      );
    });

    var leftWing = new THREE.Group();
    var rightWing = new THREE.Group();
    [
      { g: leftWing, side: -1 },
      { g: rightWing, side: 1 }
    ].forEach(function (w) {
      w.g.position.set(0.04, 0.82, w.side * 0.22);
      var wGeo = new THREE.SphereGeometry(0.32, 18, 12);
      wGeo.scale(1.45, 0.24, 0.72);
      var mesh = addOutlined(kit, wGeo, wingMat, outlineMat, 0.024).group;
      mesh.position.set(-0.22, 0.06, w.side * 0.2);
      w.g.add(mesh);
      bodyBounce.add(w.g);
    });

    [-0.32, 0.0, 0.26].forEach(function (lx) {
      [-0.32, 0.32].forEach(function (lz) {
        var leg = addOutlined(kit, new THREE.CylinderGeometry(0.04, 0.04, 0.36, 10), stripeMat, outlineMat, 0.018).group;
        leg.position.set(lx, 0.18, lz);
        leg.rotation.x = lz > 0 ? 0.28 : -0.28;
        bodyBounce.add(leg);
      });
    });

    var anchors = {
      head: makeAnchor("head", 0.44, 1.16, 0),
      "hand-L": makeAnchor("hand-L", 0, 0.52, -0.52),
      "hand-R": makeAnchor("hand-R", 0, 0.52, 0.52),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);

    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: { leftWing: leftWing, rightWing: rightWing } };
  }

  function buildTree(kit, spec, outlineMat) {
    var pal = spec.palette;
    var mats = {
      trunk: lambert(pal.trunk !== undefined ? pal.trunk : 0x9a5b32),
      foliage1: lambert(pal.primary !== undefined ? pal.primary : 0x4ade80),
      foliage2: lambert(pal.secondary !== undefined ? pal.secondary : 0x86efac)
    };
    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);
    bodyBounce.add(kit.createKawaiiTree(mats, outlineMat, 0, 0, 1.0));

    var anchors = {
      head: makeAnchor("head", 0, 2.75, 0),
      "hand-L": makeAnchor("hand-L", -1.05, 1.95, 0),
      "hand-R": makeAnchor("hand-R", 1.05, 1.95, 0),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);
    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: {} };
  }

  function buildBuilding(kit, spec, outlineMat) {
    var pal = spec.palette;
    var mats = {
      winLit: basic(pal.windowLit !== undefined ? pal.windowLit : 0xfef08a),
      winGlass: basic(pal.windowGlass !== undefined ? pal.windowGlass : 0x7dd3fc)
    };
    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);
    var bldg = kit.createKawaiiBuilding(mats, outlineMat, {
      x: 0,
      z: 0,
      w: 2.8,
      h: 3.1,
      d: 2.3,
      bodyHex: pal.primary !== undefined ? pal.primary : 0xfda4af,
      roofHex: pal.accent !== undefined ? pal.accent : 0xe11d48,
      hasAwning: true
    });
    bodyBounce.add(bldg);

    var anchors = {
      head: makeAnchor("head", 0, 3.55, 0),
      "hand-L": makeAnchor("hand-L", -1.55, 1.8, 0),
      "hand-R": makeAnchor("hand-R", 1.55, 1.8, 0),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);
    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: {} };
  }

  function buildVehicle(kit, spec, outlineMat) {
    var pal = spec.palette;
    var mats = {
      winGlass: basic(pal.windowGlass !== undefined ? pal.windowGlass : 0x7dd3fc),
      darkInk: basic(OUTLINE_COLOR),
      shirt: lambert(0xffffff)
    };
    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);
    var car = kit.createCuteRoundedCar(
      mats,
      outlineMat,
      pal.primary !== undefined ? pal.primary : 0xff8fab,
      pal.accent !== undefined ? pal.accent : 0xfff0f3,
      0,
      0,
      1,
      0
    );
    bodyBounce.add(car.group);

    var anchors = {
      head: makeAnchor("head", 0, 1.25, 0),
      "hand-L": makeAnchor("hand-L", -1.08, 0.48, 0),
      "hand-R": makeAnchor("hand-R", 1.08, 0.48, 0),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);
    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: {} };
  }

  function buildBlob(kit, spec, outlineMat) {
    var pal = spec.palette;
    var topHex = pal.primary !== undefined ? pal.primary : 0xfef08a;
    var botHex = pal.secondary !== undefined ? pal.secondary : 0xfde047;
    var rimHex = pal.accent !== undefined ? pal.accent : 0xf5d0fe;
    var bodyMat =
      typeof kit.createSoftClayMaterial === "function"
        ? kit.createSoftClayMaterial(topHex, botHex, rimHex)
        : lambert(topHex);
    var darkInk = basic(OUTLINE_COLOR);
    var blushMat = basic(pal.blush !== undefined ? pal.blush : 0xfda4af);

    var rig = new THREE.Group();
    var bodyBounce = new THREE.Group();
    rig.add(bodyBounce);

    var blobGeo = kit.createSmoothTorsoPartGeometry(0.68, 0.88, 1.42, 0.86);
    var body = addOutlined(kit, blobGeo, bodyMat, outlineMat, 0.05).group;
    body.position.set(0, 0.72, 0);
    bodyBounce.add(body);

    [-0.26, 0.26].forEach(function (ex) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 14), darkInk);
      eye.scale.set(0.86, 1.12, 0.36);
      eye.position.set(ex, 0.86, 0.68);
      bodyBounce.add(eye);
      var cheek = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), blushMat);
      cheek.scale.set(1.15, 0.8, 0.25);
      cheek.position.set(ex * 1.6, 0.7, 0.64);
      bodyBounce.add(cheek);
    });

    var anchors = {
      head: makeAnchor("head", 0, 1.52, 0),
      "hand-L": makeAnchor("hand-L", -0.82, 0.68, 0),
      "hand-R": makeAnchor("hand-R", 0.82, 0.68, 0),
      ground: makeAnchor("ground", 0, 0, 0)
    };
    bodyBounce.add(anchors.head, anchors["hand-L"], anchors["hand-R"]);
    rig.add(anchors.ground);
    return { rig: rig, bodyBounce: bodyBounce, anchors: anchors, parts: {} };
  }

  function makeAsset(rawSpec) {
    if (typeof THREE === "undefined") {
      throw specError("MISSING_THREE", "", "THREE global is required before calling ClayKit.makeAsset.");
    }
    var kit = GLOBAL_SCOPE.ClayKit;
    if (!kit || typeof kit.addOutlinedMesh !== "function") {
      throw specError("MISSING_CLAY_KIT", "", "Load clay-kit.js before clay-assets.js.");
    }
    var spec = validateSpec(rawSpec);
    var rng = makeRng(spec.id + ":" + spec.kind);
    var outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

    var built;
    switch (spec.kind) {
      case "humanoid":
        built = buildHumanoid(kit, spec, outlineMat);
        break;
      case "flower-row":
        built = buildFlowerRow(kit, spec, outlineMat, rng);
        break;
      case "container":
        built = buildContainer(kit, spec, outlineMat);
        break;
      case "insect":
        built = buildInsect(kit, spec, outlineMat);
        break;
      case "tree":
        built = buildTree(kit, spec, outlineMat);
        break;
      case "building":
        built = buildBuilding(kit, spec, outlineMat);
        break;
      case "vehicle":
        built = buildVehicle(kit, spec, outlineMat);
        break;
      case "blob":
        built = buildBlob(kit, spec, outlineMat);
        break;
      default:
        throw specError("UNKNOWN_KIND", "kind", "Unsupported kind: " + spec.kind);
    }

    var group = new THREE.Group();
    group.name = "asset_" + spec.id;
    group.userData.assetSpec = spec;
    built.rig.scale.setScalar(spec.scale);
    group.add(built.rig);

    var leftLegBaseY = built.parts.leftLeg ? built.parts.leftLeg.position.y : 0;
    var rightLegBaseY = built.parts.rightLeg ? built.parts.rightLeg.position.y : 0;

    function resetPose() {
      var bb = built.bodyBounce;
      bb.position.set(0, 0, 0);
      bb.rotation.set(0, 0, 0);
      bb.scale.set(1, 1, 1);
      var parts = built.parts;
      if (parts.leftArm) parts.leftArm.rotation.set(0, 0, 0);
      if (parts.rightArm) parts.rightArm.rotation.set(0, 0, 0);
      if (parts.leftLeg) {
        parts.leftLeg.rotation.set(0, 0, 0);
        parts.leftLeg.position.y = leftLegBaseY;
      }
      if (parts.rightLeg) {
        parts.rightLeg.rotation.set(0, 0, 0);
        parts.rightLeg.position.y = rightLegBaseY;
      }
      if (parts.headGroup) parts.headGroup.rotation.set(0, 0, 0);
      if (parts.leftWing) parts.leftWing.rotation.set(0, 0, 0);
      if (parts.rightWing) parts.rightWing.rotation.set(0, 0, 0);
      if (parts.flowers) {
        for (var fi = 0; fi < parts.flowers.length; fi++) {
          parts.flowers[fi].group.scale.set(1, 1, 1);
          parts.flowers[fi].head.scale.set(1, 1, 1);
        }
      }
    }

    function animate(name, progress, opts) {
      if (ASSET_ANIMATIONS.indexOf(name) === -1) {
        throw specError(
          "UNKNOWN_ANIMATION",
          "anim",
          "Unsupported animation '" + String(name) + "'. Supported: " + ASSET_ANIMATIONS.join(", ") + "."
        );
      }
      var p = clamp01(progress);
      resetPose();
      var bb = built.bodyBounce;
      var parts = built.parts;

      if (name === "idle") {
        var cyc = p * Math.PI * 2;
        var breath = Math.sin(cyc) * 0.04;
        bb.scale.set(1 - breath * 0.5, 1 + breath, 1 - breath * 0.5);
        bb.rotation.z = Math.sin(cyc) * 0.035;
        if (parts.headGroup) {
          parts.headGroup.rotation.y = Math.sin(cyc) * 0.09;
          parts.headGroup.rotation.z = -Math.sin(cyc) * 0.025;
        }
        if (parts.leftArm && parts.rightArm) {
          parts.leftArm.rotation.x = Math.sin(cyc) * 0.16;
          parts.rightArm.rotation.x = -Math.sin(cyc) * 0.16;
        }
        if (parts.leftWing && parts.rightWing) {
          var fl = Math.sin(cyc * 4) * 0.25;
          parts.leftWing.rotation.x = fl;
          parts.rightWing.rotation.x = -fl;
        }
      } else if (name === "walk") {
        var walkPhase;
        if (opts && typeof opts.elapsedSec === "number" && Number.isFinite(opts.elapsedSec)) {
          walkPhase = Math.max(0, opts.elapsedSec) * Math.PI * 2 * 1.45;
        } else {
          var walkCycles = opts && typeof opts.cycles === "number" && opts.cycles > 0 ? opts.cycles : 4;
          walkPhase = p * Math.PI * 2 * walkCycles;
        }
        var walkEnv = opts && opts.taper === false ? 1 : Math.min(1, p / 0.08, (1 - p) / 0.12);
        var stride = Math.sin(walkPhase) * walkEnv;
        var stepBounce = Math.abs(stride);

        if (parts.leftLeg && parts.rightLeg) {
          // Crisp bipedal chibi stride: opposite leg swing + subtle foot lift + counter-arm swing + waddle
          parts.leftLeg.rotation.x = stride * 0.78;
          parts.rightLeg.rotation.x = -stride * 0.78;
          parts.leftLeg.position.y = leftLegBaseY + Math.max(0, stride) * 0.11;
          parts.rightLeg.position.y = rightLegBaseY + Math.max(0, -stride) * 0.11;

          if (parts.leftArm && parts.rightArm) {
            parts.leftArm.rotation.x = -stride * 0.62;
            parts.rightArm.rotation.x = stride * 0.62;
            parts.leftArm.rotation.z = (0.08 + stepBounce * 0.06) * walkEnv;
            parts.rightArm.rotation.z = (-0.08 - stepBounce * 0.06) * walkEnv;
          }

          bb.position.y = stepBounce * 0.14;
          bb.rotation.x = 0.07 * walkEnv;
          bb.rotation.z = stride * 0.075;
          bb.rotation.y = -stride * 0.08;
          var wSq = stepBounce * 0.045;
          bb.scale.set(1 - wSq * 0.4, 1 + wSq, 1 - wSq * 0.4);

          if (parts.headGroup) {
            parts.headGroup.rotation.z = -stride * 0.045;
            parts.headGroup.rotation.x = (-0.04 + stepBounce * 0.04) * walkEnv;
          }
        } else if (parts.leftWing && parts.rightWing) {
          // Insect scuttle with rapid wing flutter
          bb.position.y = stepBounce * 0.18;
          bb.rotation.z = stride * 0.12;
          bb.rotation.y = stride * 0.08;
          var scuttleFlap = Math.sin(walkPhase * 3) * 0.48 * walkEnv;
          parts.leftWing.rotation.x = scuttleFlap;
          parts.rightWing.rotation.x = -scuttleFlap;
        } else {
          // Vehicle/blob/prop rolling waddle bounce
          bb.position.y = stepBounce * 0.12;
          bb.rotation.z = stride * 0.065;
          var bSq = stepBounce * 0.05;
          bb.scale.set(1 - bSq * 0.4, 1 + bSq, 1 - bSq * 0.4);
        }
      } else if (name === "hop") {
        var arc = Math.sin(p * Math.PI);
        var hopH = spec.kind === "insect" ? 0.95 : 0.65;
        bb.position.y = arc * hopH;
        var sq = p < 0.15 ? -0.18 * (1 - p / 0.15) : p > 0.85 ? -0.16 * ((p - 0.85) / 0.15) : arc * 0.12;
        bb.scale.set(1 - sq * 0.65, 1 + sq, 1 - sq * 0.65);
        if (parts.leftWing && parts.rightWing) {
          var wFlap = Math.sin(p * Math.PI * 10) * 0.55;
          parts.leftWing.rotation.x = wFlap;
          parts.rightWing.rotation.x = -wFlap;
        }
        if (parts.leftLeg && parts.rightLeg) {
          parts.leftLeg.rotation.x = arc * 0.45;
          parts.rightLeg.rotation.x = -arc * 0.35;
        }
      } else if (name === "grow") {
        if (parts.flowers) {
          for (var i = 0; i < parts.flowers.length; i++) {
            var flItem = parts.flowers[i];
            var localP = clamp01((p - flItem.phase * 0.55) / (1 - flItem.phase * 0.55));
            var stemScale = Math.max(0.05, easeOutBack(localP));
            flItem.group.scale.set(0.55 + 0.45 * localP, stemScale, 0.55 + 0.45 * localP);
            var bloomP = clamp01((localP - 0.35) / 0.65);
            var bloomS = Math.max(0.05, easeOutBack(bloomP));
            flItem.head.scale.setScalar(bloomS);
          }
        } else {
          var gs = Math.max(0.05, easeOutBack(p));
          bb.scale.set(0.65 + 0.35 * gs, gs, 0.65 + 0.35 * gs);
        }
      } else if (name === "pop-in") {
        var ps = Math.max(0.001, easeOutBack(p));
        bb.scale.setScalar(ps);
      }
      return group;
    }

    return {
      group: group,
      anchors: built.anchors,
      animate: animate,
      spec: spec
    };
  }

  GLOBAL_SCOPE.ClayKit = GLOBAL_SCOPE.ClayKit || {};
  GLOBAL_SCOPE.ClayKit.makeAsset = makeAsset;
  GLOBAL_SCOPE.ClayKit.ASSET_KINDS = ASSET_KINDS.slice();
  GLOBAL_SCOPE.ClayKit.HUMANOID_ACCESSORIES = HUMANOID_ACCESSORIES.slice();
  GLOBAL_SCOPE.ClayKit.ASSET_ANIMATIONS = ASSET_ANIMATIONS.slice();
})();
