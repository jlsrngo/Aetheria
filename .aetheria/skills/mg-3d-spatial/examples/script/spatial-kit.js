(function () {
  'use strict';

  var THEMES = {
    'pastel-candy': {
      bgHex: 0xFDE8F0,
      heroHex: 0xFF6B9D,
      accentHex: 0x8B5CF6,
      clonerHex: 0xFBCFE8,
      cardBg: 'rgba(255, 255, 255, 0.84)',
      ink: '#1E1B4B',
      muted: '#6B21A8',
      accent: '#EC4899'
    },
    'studio-cream': {
      bgHex: 0xF5EFE6,
      heroHex: 0xF97316,
      accentHex: 0x0EA5E9,
      clonerHex: 0xE7DEC8,
      cardBg: 'rgba(255, 253, 248, 0.86)',
      ink: '#1C1917',
      muted: '#57534E',
      accent: '#EA580C'
    },
    'obsidian-chrome': {
      bgHex: 0x090B14,
      heroHex: 0x38BDF8,
      accentHex: 0xC084FC,
      clonerHex: 0x1E293B,
      cardBg: 'rgba(15, 23, 42, 0.78)',
      ink: '#F8FAFC',
      muted: '#94A3B8',
      accent: '#38BDF8'
    },
    'mint-ceramic': {
      bgHex: 0xE6F7F0,
      heroHex: 0x10B981,
      accentHex: 0xF59E0B,
      clonerHex: 0xA7F3D0,
      cardBg: 'rgba(255, 255, 255, 0.84)',
      ink: '#064E3B',
      muted: '#047857',
      accent: '#059669'
    },
    'lilac-dream': {
      bgHex: 0xEFEAFF,
      heroHex: 0x7C3AED,
      accentHex: 0xEC4899,
      clonerHex: 0xDDD6FE,
      cardBg: 'rgba(255, 255, 255, 0.84)',
      ink: '#1E1B4B',
      muted: '#5B21B6',
      accent: '#7C3AED'
    }
  };

  function getTheme(name) {
    return THEMES[name] || THEMES['pastel-candy'];
  }

  function createSpatialEngine(glCanvas, w, h) {
    var renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0, 1.4, 8.2);
    camera.lookAt(0, 0.2, 0);

    // Three-point studio lighting
    var hemi = new THREE.HemisphereLight(0xFFFFFF, 0xCBD5E1, 0.95);
    scene.add(hemi);
    var keyLight = new THREE.DirectionalLight(0xFFF7ED, 1.15);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);
    var rimLight = new THREE.DirectionalLight(0xBAE6FD, 0.75);
    rimLight.position.set(-6, 4, -4);
    scene.add(rimLight);

    // MoGraph 5x5 cloner sphere field beneath hero
    var clonerGroup = new THREE.Group();
    clonerGroup.position.set(0, -1.6, -0.8);
    var clonerGeo = new THREE.SphereGeometry(0.22, 20, 16);
    var clonerMat = new THREE.MeshStandardMaterial({ color: 0xFBCFE8, roughness: 0.35, metalness: 0.1 });
    var cloners = [];
    for (var gx = -2; gx <= 2; gx++) {
      for (var gz = -2; gz <= 2; gz++) {
        var m = new THREE.Mesh(clonerGeo, clonerMat);
        m.position.set(gx * 0.82, 0, gz * 0.82);
        m.userData = { gx: gx, gz: gz };
        clonerGroup.add(m);
        cloners.push(m);
      }
    }
    scene.add(clonerGroup);

    // Hero object container
    var heroRoot = new THREE.Group();
    heroRoot.position.set(0, 0.95, 0);
    scene.add(heroRoot);

    var heroMat = new THREE.MeshStandardMaterial({ color: 0xFF6B9D, roughness: 0.28, metalness: 0.18 });
    var accentMat = new THREE.MeshStandardMaterial({ color: 0x8B5CF6, roughness: 0.22, metalness: 0.35 });

    // Pre-build all 6 sculpted hero objects (toggled via visibility)
    var objects = {};

    // 1. candy-torus
    var torusGrp = new THREE.Group();
    var torus = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.36, 28, 64), heroMat);
    var innerOrb = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 20), accentMat);
    torusGrp.add(torus);
    torusGrp.add(innerOrb);
    objects['candy-torus'] = torusGrp;

    // 2. crystal-icosa
    var icoGrp = new THREE.Group();
    var ico = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), heroMat);
    var icoRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 16, 48), accentMat);
    icoRing.rotation.x = Math.PI * 0.38;
    icoGrp.add(ico);
    icoGrp.add(icoRing);
    objects['crystal-icosa'] = icoGrp;

    // 3. floating-capsule
    var capGrp = new THREE.Group();
    var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 28), heroMat);
    var topCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 28, 20), heroMat);
    topCap.position.y = 0.6;
    var botCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 28, 20), accentMat);
    botCap.position.y = -0.6;
    capGrp.add(cyl, topCap, botCap);
    capGrp.rotation.z = 0.38;
    objects['floating-capsule'] = capGrp;

    // 4. gyro-rings
    var gyroGrp = new THREE.Group();
    var r1 = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.12, 20, 56), heroMat);
    var r2 = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.11, 20, 56), accentMat);
    r2.rotation.x = Math.PI * 0.5;
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 20), heroMat);
    gyroGrp.add(r1, r2, core);
    objects['gyro-rings'] = gyroGrp;

    // 5. prism-cube
    var cubeGrp = new THREE.Group();
    var cube = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.45, 1.45), heroMat);
    var sat = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16), accentMat);
    sat.position.set(1.15, 0.85, 0);
    cubeGrp.add(cube, sat);
    objects['prism-cube'] = cubeGrp;

    // 6. orb-cluster
    var cluGrp = new THREE.Group();
    var c0 = new THREE.Mesh(new THREE.SphereGeometry(0.72, 28, 24), heroMat);
    var c1 = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), accentMat);
    c1.position.set(0.75, 0.42, 0.2);
    var c2 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 20), accentMat);
    c2.position.set(-0.72, -0.34, 0.3);
    cluGrp.add(c0, c1, c2);
    objects['orb-cluster'] = cluGrp;

    Object.keys(objects).forEach(function (k) {
      objects[k].visible = false;
      heroRoot.add(objects[k]);
    });

    function render3D(theme, objName, t, localT) {
      scene.background = new THREE.Color(theme.bgHex);
      heroMat.color.setHex(theme.heroHex);
      accentMat.color.setHex(theme.accentHex);
      clonerMat.color.setHex(theme.clonerHex);

      // Cloner radial effector ripple
      for (var i = 0; i < cloners.length; i++) {
        var m = cloners[i];
        var dist = Math.sqrt(m.userData.gx * m.userData.gx + m.userData.gz * m.userData.gz);
        m.position.y = Math.sin(t * 2.6 - dist * 1.1) * 0.24;
      }

      var activeKey = objects[objName] ? objName : 'candy-torus';
      Object.keys(objects).forEach(function (k) {
        objects[k].visible = (k === activeKey);
      });

      var active = objects[activeKey];
      // Damped squash-and-stretch entrance + smooth continuous studio orbit
      var e = Math.min(1, localT / 0.55);
      var bounce = 1 + Math.sin(e * Math.PI) * 0.12 * (1 - e);
      active.scale.set(bounce, 1 / bounce, bounce);
      active.rotation.y = t * 0.85;
      active.rotation.x = Math.sin(t * 0.65) * 0.28;
      heroRoot.position.y = 0.95 + Math.sin(t * 1.8) * 0.14;

      camera.position.x = Math.sin(t * 0.4) * 0.45;
      camera.lookAt(0, 0.2, 0);
      renderer.render(scene, camera);
    }

    return { render3D: render3D };
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    if (!text) return [];
    var words = String(text).split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  }

  window.SpatialKit = {
    getTheme: getTheme,
    createSpatialEngine: createSpatialEngine,
    roundRect: roundRect,
    wrapLines: wrapLines
  };
})();
