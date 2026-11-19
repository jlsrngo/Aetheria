(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  function addHairStyle(ctx, style, hasHijab) {
    if (hasHijab) return; // Hijab neatly drapes over hair
    var headGroup = ctx.headGroup;
    var hairMat = ctx.mats.hair;
    var accentMat = ctx.mats.accent;

    if (style === "long") {
      [-0.56, 0.56].forEach(function (sx) {
        var drapeGeo = new THREE.SphereGeometry(0.24, 16, 14);
        drapeGeo.scale(0.82, 2.35, 1.05);
        var drape = ctx.addOutlined(drapeGeo, hairMat, 0.032);
        drape.position.set(sx, -0.26, -0.14);
        headGroup.add(drape);
      });
      var backGeo = new THREE.SphereGeometry(0.56, 18, 14);
      backGeo.scale(1.08, 1.48, 0.62);
      var back = ctx.addOutlined(backGeo, hairMat, 0.035);
      back.position.set(0, -0.24, -0.38);
      headGroup.add(back);
    } else if (style === "bun") {
      var bun = ctx.addOutlined(new THREE.SphereGeometry(0.27, 18, 16), hairMat, 0.032);
      bun.position.set(0, 0.68, -0.16);
      var tieGeo = new THREE.TorusGeometry(0.22, 0.055, 10, 20);
      tieGeo.rotateX(Math.PI / 2);
      var tie = new THREE.Mesh(tieGeo, accentMat);
      tie.position.set(0, 0.54, -0.13);
      headGroup.add(bun, tie);
    } else if (style === "ponytail") {
      var tailGeo = new THREE.SphereGeometry(0.24, 16, 14);
      tailGeo.scale(0.95, 1.9, 0.95);
      var tail = ctx.addOutlined(tailGeo, hairMat, 0.032);
      tail.position.set(0, -0.05, -0.76);
      tail.rotation.x = 0.32;
      var scrunch = ctx.addOutlined(new THREE.SphereGeometry(0.12, 12, 10), accentMat, 0.02);
      scrunch.position.set(0, 0.24, -0.64);
      headGroup.add(tail, scrunch);
    } else if (style === "spiky") {
      [
        [-0.28, 0.62, 0.06, 0.36],
        [0.0, 0.72, 0.04, 0.0],
        [0.28, 0.62, 0.06, -0.36],
        [-0.14, 0.66, -0.18, 0.18],
        [0.14, 0.66, -0.18, -0.18]
      ].forEach(function (sp) {
        var spike = ctx.addOutlined(new THREE.ConeGeometry(0.16, 0.38, 12), hairMat, 0.024);
        spike.position.set(sp[0], sp[1], sp[2]);
        spike.rotation.z = sp[3];
        headGroup.add(spike);
      });
    } else if (style === "bald") {
      // Subtle glossy clay shine dot on crown
      var shine = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 12, 10),
        ctx.basic(0xfffbeb)
      );
      shine.scale.set(1.2, 0.38, 0.8);
      shine.position.set(-0.22, 0.54, 0.22);
      shine.rotation.z = 0.45;
      headGroup.add(shine);
    }
  }

  function addAccessory(ctx, acc) {
    var pal = ctx.spec.palette;
    var headGroup = ctx.headGroup;
    var torso = ctx.torso;

    if (acc === "glasses") {
      var frameMat = ctx.lambert(pal.glasses !== undefined ? pal.glasses : 0x334155);
      var glassG = new THREE.Group();
      [-0.22, 0.22].forEach(function (gx) {
        var rim = ctx.addOutlined(new THREE.TorusGeometry(0.155, 0.028, 10, 22), frameMat, 0.012);
        rim.position.set(gx, 0.02, 0.62);
        glassG.add(rim);
      });
      var bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.036, 0.04), frameMat);
      bridge.position.set(0, 0.03, 0.62);
      glassG.add(bridge);
      headGroup.add(glassG);
      return 2.42;
    }

    if (acc === "backpack") {
      var packMat = ctx.lambert(pal.backpack !== undefined ? pal.backpack : pal.accent !== undefined ? pal.accent : 0xf97316);
      var pocketMat = ctx.lambert(pal.secondary !== undefined ? pal.secondary : 0xfef3c7);
      var packG = new THREE.Group();
      var main = ctx.addOutlined(new THREE.BoxGeometry(0.78, 0.74, 0.42), packMat, 0.034);
      var pocket = ctx.addOutlined(new THREE.BoxGeometry(0.56, 0.34, 0.14), pocketMat, 0.022);
      pocket.position.set(0, -0.14, -0.24);
      packG.add(main, pocket);
      packG.position.set(0, 0.14, -0.58);
      torso.add(packG);
      return 2.42;
    }

    if (acc === "beard") {
      var beardMat = ctx.lambert(pal.hair !== undefined ? pal.hair : ctx.spec.variant === "elder" ? 0xe7e5e4 : 0x594637);
      var beardGeo = new THREE.SphereGeometry(0.32, 18, 14);
      beardGeo.scale(1.18, 0.85, 0.72);
      var beard = ctx.addOutlined(beardGeo, beardMat, 0.028);
      beard.position.set(0, -0.36, 0.44);
      headGroup.add(beard);
      return 2.42;
    }

    if (acc === "hijab") {
      var scarfMat = ctx.lambert(pal.hat !== undefined ? pal.hat : pal.accent !== undefined ? pal.accent : 0xf472b6);
      var wrapGeo = new THREE.SphereGeometry(0.71, 26, 20);
      wrapGeo.scale(1.07, 1.02, 0.84);
      var wrap = ctx.addOutlined(wrapGeo, scarfMat, 0.036);
      wrap.position.set(0, 0.04, -0.16);
      var drapeGeo = new THREE.CylinderGeometry(0.56, 0.72, 0.48, 20);
      drapeGeo.scale(1.05, 1.0, 0.82);
      var drape = ctx.addOutlined(drapeGeo, scarfMat, 0.032);
      drape.position.set(0, -0.52, -0.08);
      headGroup.add(wrap, drape);
      return 2.52;
    }

    return 2.42;
  }

  function applyBodyVariant(ctx, variant) {
    var headGroup = ctx.headGroup;
    var core = ctx.core;
    if (variant === "kid") {
      core.scale.set(0.86, 0.78, 0.86);
      headGroup.scale.setScalar(1.08);
      headGroup.position.y = 1.5;
      return 0.82;
    }
    if (variant === "elder") {
      core.scale.set(0.95, 0.94, 0.95);
      headGroup.position.set(0, 1.68, 0.07);
      headGroup.rotation.x = 0.06;
      return 0.94;
    }
    if (variant === "chubby") {
      core.scale.set(1.24, 0.98, 1.2);
      headGroup.scale.set(1.06, 0.98, 1.04);
      headGroup.position.y = 1.72;
      return 1.04;
    }
    return 1.0;
  }

  GLOBAL_SCOPE.ClayKit = GLOBAL_SCOPE.ClayKit || {};
  GLOBAL_SCOPE.ClayKit.__people = {
    addHairStyle: addHairStyle,
    addAccessory: addAccessory,
    applyBodyVariant: applyBodyVariant
  };
})();
