(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;

  function buildHouse(ctx) {
    var pal = ctx.spec.palette;
    var wallMat = ctx.lambert(pal.primary !== undefined ? pal.primary : 0xfef3c7);
    var roofMat = ctx.lambert(pal.accent !== undefined ? pal.accent : 0xea580c);
    var trimMat = ctx.lambert(pal.secondary !== undefined ? pal.secondary : 0xfffdf9);
    var doorMat = ctx.lambert(pal.door !== undefined ? pal.door : 0x92400e);
    var winMat = ctx.basic(pal.windowGlass !== undefined ? pal.windowGlass : 0x7dd3fc);
    var litMat = ctx.basic(pal.windowLit !== undefined ? pal.windowLit : 0xfef08a);

    var g = new THREE.Group();
    var w = 3.0, h = 2.3, d = 2.5;
    var body = ctx.addOutlined(new THREE.BoxGeometry(w, h, d), wallMat, 0.05);
    body.position.set(0, h / 2, 0);
    g.add(body);

    // Pitched triangular gable roof (4-sided prism via CylinderGeometry rotated 45deg)
    var roofGeo = new THREE.ConeGeometry(2.45, 1.45, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.06, 1.0, 0.92);
    var roof = ctx.addOutlined(roofGeo, roofMat, 0.05);
    roof.position.set(0, h + 0.72, 0);
    g.add(roof);

    // Cozy chimney
    var chim = ctx.addOutlined(new THREE.BoxGeometry(0.45, 0.95, 0.45), trimMat, 0.035);
    chim.position.set(0.85, h + 0.92, -0.35);
    g.add(chim);

    // Front door + porch step
    var door = ctx.addOutlined(new THREE.BoxGeometry(0.76, 1.24, 0.12), doorMat, 0.032, false, false);
    door.position.set(-0.55, 0.62, d / 2 + 0.04);
    var step = ctx.addOutlined(new THREE.BoxGeometry(1.05, 0.16, 0.45), trimMat, 0.025, false, true);
    step.position.set(-0.55, 0.08, d / 2 + 0.22);
    g.add(door, step);

    // Warm window + flower sill
    var win = ctx.addOutlined(new THREE.BoxGeometry(0.82, 0.72, 0.1), litMat, 0.032, false, false);
    win.position.set(0.65, 1.28, d / 2 + 0.05);
    var sill = ctx.addOutlined(new THREE.BoxGeometry(0.96, 0.14, 0.24), trimMat, 0.022, false, false);
    sill.position.set(0.65, 0.86, d / 2 + 0.1);
    var atticWin = ctx.addOutlined(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 18), winMat, 0.025, false, false);
    atticWin.rotation.x = Math.PI / 2;
    atticWin.position.set(0, h + 0.36, d / 2 - 0.18);
    g.add(win, sill, atticWin);

    return { group: g, height: h + 1.45, halfW: 1.8 };
  }

  function buildHut(ctx) {
    var pal = ctx.spec.palette;
    var woodMat = ctx.lambert(pal.secondary !== undefined ? pal.secondary : 0xa16207);
    var deckMat = ctx.lambert(pal.primary !== undefined ? pal.primary : 0xfde68a);
    var thatchMat = ctx.lambert(pal.accent !== undefined ? pal.accent : 0xd97706);

    var g = new THREE.Group();
    // Raised bamboo/wooden platform on 4 stilts (saung / gubuk sawah)
    var deck = ctx.addOutlined(new THREE.BoxGeometry(2.7, 0.22, 2.3), deckMat, 0.04, true, true);
    deck.position.set(0, 0.72, 0);
    g.add(deck);

    [[-1.15, -0.95], [1.15, -0.95], [-1.15, 0.95], [1.15, 0.95]].forEach(function (pt) {
      var post = ctx.addOutlined(new THREE.CylinderGeometry(0.11, 0.13, 2.25, 12), woodMat, 0.028);
      post.position.set(pt[0], 1.12, pt[1]);
      g.add(post);
    });

    // Low railings on back and sides
    var backRail = ctx.addOutlined(new THREE.BoxGeometry(2.4, 0.16, 0.12), woodMat, 0.022);
    backRail.position.set(0, 1.25, -0.95);
    var leftRail = ctx.addOutlined(new THREE.BoxGeometry(0.12, 0.16, 1.95), woodMat, 0.022);
    leftRail.position.set(-1.15, 1.25, 0);
    var rightRail = ctx.addOutlined(new THREE.BoxGeometry(0.12, 0.16, 1.95), woodMat, 0.022);
    rightRail.position.set(1.15, 1.25, 0);
    g.add(backRail, leftRail, rightRail);

    // Steep layered thatched roof
    var roofGeo = new THREE.ConeGeometry(2.35, 1.55, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.06, 1.0, 0.94);
    var roof = ctx.addOutlined(roofGeo, thatchMat, 0.05);
    roof.position.set(0, 2.82, 0);
    g.add(roof);

    return { group: g, height: 3.6, halfW: 1.7 };
  }

  function buildBarn(ctx) {
    var pal = ctx.spec.palette;
    var wallMat = ctx.lambert(pal.primary !== undefined ? pal.primary : 0xef4444);
    var roofMat = ctx.lambert(pal.accent !== undefined ? pal.accent : 0x78716c);
    var trimMat = ctx.lambert(pal.secondary !== undefined ? pal.secondary : 0xfffdf9);

    var g = new THREE.Group();
    var body = ctx.addOutlined(new THREE.BoxGeometry(3.2, 2.35, 2.5), wallMat, 0.05);
    body.position.set(0, 1.175, 0);
    g.add(body);

    // Rounded gambrel/barrel barn roof arching upward atop walls
    var roofGeo = new THREE.CylinderGeometry(1.66, 1.66, 2.7, 18, 1, false, Math.PI / 2, Math.PI);
    roofGeo.rotateX(Math.PI / 2);
    roofGeo.scale(1.05, 0.72, 1.0);
    var roof = ctx.addOutlined(roofGeo, roofMat, 0.048);
    roof.position.set(0, 2.32, 0);
    g.add(roof);

    // Iconic white-trimmed barn doors + upper loft window
    var doorFrame = ctx.addOutlined(new THREE.BoxGeometry(1.42, 1.48, 0.12), trimMat, 0.028, false, false);
    doorFrame.position.set(0, 0.74, 1.27);
    var doorInner = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.26, 0.14), wallMat);
    doorInner.position.set(0, 0.74, 1.28);
    var cross1 = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.11, 0.16), trimMat);
    cross1.position.set(0, 0.74, 1.29);
    cross1.rotation.z = 0.75;
    var cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.11, 0.16), trimMat);
    cross2.position.set(0, 0.74, 1.29);
    cross2.rotation.z = -0.75;
    var loftWin = ctx.addOutlined(new THREE.BoxGeometry(0.62, 0.52, 0.12), trimMat, 0.024, false, false);
    loftWin.position.set(0, 1.92, 1.27);
    g.add(doorFrame, doorInner, cross1, cross2, loftWin);

    return { group: g, height: 3.65, halfW: 1.9 };
  }

  function buildApartment(ctx) {
    var pal = ctx.spec.palette;
    var wallMat = ctx.lambert(pal.primary !== undefined ? pal.primary : 0x93c5fd);
    var roofMat = ctx.lambert(pal.accent !== undefined ? pal.accent : 0x3b82f6);
    var trimMat = ctx.lambert(pal.secondary !== undefined ? pal.secondary : 0xf1f5f9);
    var litMat = ctx.basic(pal.windowLit !== undefined ? pal.windowLit : 0xfef08a);
    var glassMat = ctx.basic(pal.windowGlass !== undefined ? pal.windowGlass : 0xe0f2fe);

    var g = new THREE.Group();
    var w = 2.6, h = 3.85, d = 2.2;
    var body = ctx.addOutlined(new THREE.BoxGeometry(w, h, d), wallMat, 0.05);
    body.position.set(0, h / 2, 0);
    var parapet = ctx.addOutlined(new THREE.BoxGeometry(w + 0.24, 0.24, d + 0.24), roofMat, 0.04);
    parapet.position.set(0, h + 0.12, 0);
    var tank = ctx.addOutlined(new THREE.CylinderGeometry(0.32, 0.32, 0.44, 16), trimMat, 0.028);
    tank.position.set(0.6, h + 0.44, -0.35);
    g.add(body, parapet, tank);

    // 3 stories x 2 columns windows + balconies
    for (var row = 0; row < 3; row++) {
      var wy = 1.25 + row * 1.0;
      [-0.62, 0.62].forEach(function (wx, ci) {
        var win = ctx.addOutlined(
          new THREE.BoxGeometry(0.64, 0.56, 0.08),
          (row + ci) % 2 === 0 ? litMat : glassMat,
          0.026,
          false,
          false
        );
        win.position.set(wx, wy, d / 2 + 0.05);
        g.add(win);
      });
      if (row > 0) {
        var balc = ctx.addOutlined(new THREE.BoxGeometry(2.25, 0.12, 0.26), trimMat, 0.022, false, false);
        balc.position.set(0, wy - 0.34, d / 2 + 0.12);
        g.add(balc);
      }
    }
    var entry = ctx.addOutlined(new THREE.BoxGeometry(0.84, 0.84, 0.1), glassMat, 0.028, false, false);
    entry.position.set(0, 0.42, d / 2 + 0.05);
    g.add(entry);

    return { group: g, height: h + 0.72, halfW: 1.55 };
  }

  function buildSchool(ctx) {
    var pal = ctx.spec.palette;
    var wallMat = ctx.lambert(pal.primary !== undefined ? pal.primary : 0xfde68a);
    var roofMat = ctx.lambert(pal.accent !== undefined ? pal.accent : 0xe11d48);
    var trimMat = ctx.lambert(pal.secondary !== undefined ? pal.secondary : 0xfffdf9);
    var glassMat = ctx.basic(pal.windowGlass !== undefined ? pal.windowGlass : 0x7dd3fc);
    var darkInk = ctx.basic(0x594637);

    var g = new THREE.Group();
    var w = 3.7, h = 2.4, d = 2.1;
    var body = ctx.addOutlined(new THREE.BoxGeometry(w, h, d), wallMat, 0.05);
    body.position.set(0, h / 2, 0);
    var roof = ctx.addOutlined(new THREE.BoxGeometry(w + 0.3, 0.32, d + 0.3), roofMat, 0.045);
    roof.position.set(0, h + 0.16, 0);
    g.add(body, roof);

    // Central clock tower pediment
    var tower = ctx.addOutlined(new THREE.BoxGeometry(1.25, 1.15, 0.95), trimMat, 0.038);
    tower.position.set(0, h + 0.72, 0.42);
    var towerRoofGeo = new THREE.ConeGeometry(0.95, 0.65, 4);
    towerRoofGeo.rotateY(Math.PI / 4);
    var towerRoof = ctx.addOutlined(towerRoofGeo, roofMat, 0.035);
    towerRoof.position.set(0, h + 1.58, 0.42);
    var clockFace = ctx.addOutlined(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 18), trimMat, 0.022, false, false);
    clockFace.rotation.x = Math.PI / 2;
    clockFace.position.set(0, h + 0.78, 0.92);
    var hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.04), darkInk);
    hand1.position.set(0, h + 0.84, 0.97);
    var hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.04), darkInk);
    hand2.position.set(0.06, h + 0.78, 0.97);
    g.add(tower, towerRoof, clockFace, hand1, hand2);

    // Door + twin wing windows
    var door = ctx.addOutlined(new THREE.BoxGeometry(0.88, 1.12, 0.1), roofMat, 0.028, false, false);
    door.position.set(0, 0.56, d / 2 + 0.05);
    g.add(door);
    [-1.2, 1.2].forEach(function (wx) {
      var win = ctx.addOutlined(new THREE.BoxGeometry(0.82, 0.76, 0.08), glassMat, 0.026, false, false);
      win.position.set(wx, 1.32, d / 2 + 0.05);
      g.add(win);
    });

    return { group: g, height: h + 1.9, halfW: 2.05 };
  }

  function build(variant, ctx) {
    if (variant === "house") return buildHouse(ctx);
    if (variant === "hut") return buildHut(ctx);
    if (variant === "barn") return buildBarn(ctx);
    if (variant === "apartment") return buildApartment(ctx);
    if (variant === "school") return buildSchool(ctx);
    return buildHouse(ctx);
  }

  GLOBAL_SCOPE.ClayKit = GLOBAL_SCOPE.ClayKit || {};
  GLOBAL_SCOPE.ClayKit.__buildings = { build: build };
})();
