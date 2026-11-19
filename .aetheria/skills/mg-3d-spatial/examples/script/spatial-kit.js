/**
 * SpatialKit v2 — Soft 3D PBR Hexagonal Capsule Bed & Sculpted Wordmark Engine
 * Adapted from references/aetheria-motion/demos/04-3d-render/ (common.py, scene.py, cues.json).
 * Uses offline Three.js (/script/three.min.js) with InstancedMesh hex-capsule bed, 3D extruded sculpted
 * letters ('S','O','F','T'), glossy vermilion sphere, radial shockwave physics, and soft studio PBR lighting.
 */
(function () {
  'use strict';

  const PAL = {
    bg: 0xFDE8F0,
    fog: 0xF7DCE8,
    capsules: [0xF9B4C4, 0xFFE2A8, 0xD7C8F9, 0xBCEAD5, 0xFFC7B2],
    letterCoral: 0xFF7A6B,
    letterCream: 0xFFF6EE,
    sphere: 0xFF5B4D,
    ink: '#3A2632'
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(clamp(t) - 1, 3) + c1 * Math.pow(clamp(t) - 1, 2); };

  function hs(a, b = 0) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  let renderer = null, scene = null, camera = null;
  let capsules = [], capMesh = null;
  let letters = [], sphereMesh = null;
  let dummy = null;
  let curW = 0, curH = 0;

  // Build extruded 3D letter geometries from crisp 2D Shape paths
  function buildLetterMesh(ch, mat) {
    const s = new THREE.Shape();
    if (ch === 'S') {
      s.moveTo(0.45, 0.85); s.bezierCurveTo(0.45, 1.15, -0.45, 1.15, -0.45, 0.72);
      s.bezierCurveTo(-0.45, 0.32, 0.45, 0.35, 0.45, -0.05);
      s.bezierCurveTo(0.45, -0.42, -0.45, -0.42, -0.45, -0.1);
      s.lineTo(-0.22, -0.1); s.bezierCurveTo(-0.22, -0.22, 0.22, -0.22, 0.22, -0.05);
      s.bezierCurveTo(0.22, 0.15, -0.68, 0.12, -0.68, 0.72);
      s.bezierCurveTo(-0.68, 1.32, 0.68, 1.32, 0.68, 0.85); s.closePath();
    } else if (ch === 'O') {
      s.absarc(0, 0.42, 0.54, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0.42, 0.24, 0, Math.PI * 2, true);
      s.holes.push(hole);
    } else if (ch === 'F') {
      s.moveTo(-0.38, -0.22); s.lineTo(-0.38, 1.05); s.lineTo(0.42, 1.05);
      s.lineTo(0.42, 0.82); s.lineTo(-0.12, 0.82); s.lineTo(-0.12, 0.52);
      s.lineTo(0.30, 0.52); s.lineTo(0.30, 0.30); s.lineTo(-0.12, 0.30);
      s.lineTo(-0.12, -0.22); s.closePath();
    } else { // T
      s.moveTo(-0.46, 1.05); s.lineTo(0.46, 1.05); s.lineTo(0.46, 0.82);
      s.lineTo(0.13, 0.82); s.lineTo(0.13, -0.22); s.lineTo(-0.13, -0.22);
      s.lineTo(-0.13, 0.82); s.lineTo(-0.46, 0.82); s.closePath();
    }
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.36, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 4, curveSegments: 20
    });
    geo.center();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function initThree(canvas, W, H) {
    if (renderer && curW === W && curH === H) return;
    curW = W; curH = H;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
    }
    renderer.setSize(W, H, false);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.bg);
    scene.fog = new THREE.Fog(PAL.fog, 12, 26);

    camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 60);

    // Studio PBR Lighting
    const hemi = new THREE.HemisphereLight(0xFFF8FC, 0xE6B8D0, 1.15);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xFFF6EE, 1.85);
    key.position.set(5.5, 9.5, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 25;
    key.shadow.camera.left = -6; key.shadow.camera.right = 6;
    key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    key.shadow.bias = -0.0005;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xFFD6E8, 0.85);
    rim.position.set(-6, 4, -5);
    scene.add(rim);

    // Studio Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: PAL.bg, roughness: 0.92, metalness: 0.0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.35;
    floor.receiveShadow = true;
    scene.add(floor);

    // Instanced Hexagonal Capsule Bed
    const pitch = 0.44;
    const capGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.56, 18);
    const capMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05 });
    capsules = [];
    for (let row = -9; row <= 9; row++) {
      for (let col = -10; col <= 10; col++) {
        const x = (col + (row % 2 ? 0.5 : 0)) * pitch;
        const z = row * pitch * 0.866;
        if (Math.hypot(x, z) > 4.6) continue;
        capsules.push({ x, z, colIdx: Math.abs(row * 7 + col * 13) % PAL.capsules.length, seed: row * 31 + col * 17 });
      }
    }
    capMesh = new THREE.InstancedMesh(capGeo, capMat, capsules.length);
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    const tmpColor = new THREE.Color();
    capsules.forEach((c, i) => {
      tmpColor.setHex(PAL.capsules[c.colIdx]);
      capMesh.setColorAt(i, tmpColor);
    });
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
    scene.add(capMesh);

    // 3D Sculpted Letters ('S', 'O', 'F', 'T')
    const letterMatA = new THREE.MeshStandardMaterial({ color: PAL.letterCoral, roughness: 0.32, metalness: 0.06 });
    const letterMatB = new THREE.MeshStandardMaterial({ color: PAL.letterCream, roughness: 0.35, metalness: 0.05 });
    const chars = ['S', 'O', 'F', 'T'];
    const xs = [-1.95, -0.75, 0.42, 1.48];
    letters = chars.map((ch, i) => {
      const m = buildLetterMesh(ch, i % 2 === 0 ? letterMatA : letterMatB);
      m.position.set(xs[i], 0.45, 0);
      scene.add(m);
      return { mesh: m, baseX: xs[i], idx: i };
    });

    // Giant Glossy Vermilion Sphere (Full Stop)
    sphereMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 32, 24),
      new THREE.MeshStandardMaterial({ color: PAL.sphere, roughness: 0.18, metalness: 0.12 })
    );
    sphereMesh.castShadow = true;
    sphereMesh.receiveShadow = true;
    sphereMesh.position.set(2.45, 0.38, 0);
    scene.add(sphereMesh);

    dummy = new THREE.Object3D();
  }

  function renderShot(webglCanvas, hudCanvas, W, H, safe, shot, localTime, micro) {
    initThree(webglCanvas, W, H);
    const dur = Math.max(0.01, shot.duration || 7.5);
    const u = clamp(localTime / dur);
    const isPortrait = H > W;

    // Camera choreography per layout
    let camPos = [0, 4.2, isPortrait ? 11.2 : 7.8];
    let lookAt = [0, 0.25, 0];
    let impactCenter = [0, 0], impactU = -1;

    if (shot.layout === 'capsule-bed-drop') {
      camPos = [lerp(-1.6, -0.6, u), lerp(3.4, 4.0, u), isPortrait ? 9.6 : 6.8];
      lookAt = [-1.4, 0.3, 0];
      impactCenter = [-1.95, 0];
      impactU = u;
      letters.forEach((l, i) => {
        if (i === 0) {
          const dropY = u < 0.25 ? lerp(4.2, 0.45, easeOutBack(u / 0.25)) : 0.45;
          l.mesh.position.set(l.baseX, dropY, 0);
          l.mesh.visible = true;
        } else {
          l.mesh.visible = false;
        }
      });
      sphereMesh.visible = false;
    } else if (shot.layout === 'letter-cascade') {
      camPos = [lerp(-0.4, 0.5, u), 4.4, isPortrait ? 10.6 : 7.4];
      lookAt = [0.1, 0.35, 0];
      impactCenter = [0.42, 0];
      impactU = u;
      letters.forEach((l, i) => {
        l.mesh.visible = true;
        const t0 = i * 0.18;
        const lu = clamp((u - t0) / 0.28);
        const dropY = i === 0 ? 0.45 : lerp(4.5, 0.45, easeOutBack(lu));
        l.mesh.position.set(l.baseX, dropY, 0);
      });
      sphereMesh.visible = false;
    } else if (shot.layout === 'sphere-shockwave') {
      camPos = [lerp(0.8, 0.2, u), lerp(4.5, 5.2, u), isPortrait ? 11.4 : 8.0];
      lookAt = [0.4, 0.3, 0];
      impactCenter = [2.45, 0];
      impactU = clamp((u - 0.3) / 0.7);
      letters.forEach((l) => {
        l.mesh.visible = true;
        const hop = impactU > 0 ? Math.sin(clamp(impactU * 2.5) * Math.PI) * 0.45 * (1 - impactU) : 0;
        l.mesh.position.set(l.baseX, 0.45 + hop, 0);
      });
      sphereMesh.visible = true;
      const sy = u < 0.3 ? lerp(4.6, 0.42, (u / 0.3) ** 2) : 0.42 + Math.abs(Math.sin((u - 0.3) * Math.PI * 3)) * 0.28 * (1 - u);
      sphereMesh.position.set(2.45, sy, 0);
    } else {
      // soft-finale
      camPos = [lerp(0.4, 0.0, u), lerp(5.0, 4.6, u), isPortrait ? 11.8 : 8.2];
      lookAt = [0.2, 0.35, 0];
      impactCenter = [0.2, 0];
      impactU = u * 0.5;
      letters.forEach((l, i) => {
        l.mesh.visible = true;
        const breathe = Math.sin(u * Math.PI * 2 + i * 0.6) * 0.05;
        l.mesh.position.set(l.baseX, 0.45 + breathe, 0);
      });
      sphereMesh.visible = true;
      sphereMesh.position.set(2.45, 0.42 + Math.sin(u * Math.PI * 2 + 2.4) * 0.06, 0);
    }

    camera.position.set(camPos[0], camPos[1], camPos[2]);
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);

    // Update Instanced Hexagonal Capsule Bed with radial ripple & sink
    capsules.forEach((c, i) => {
      const dist = Math.hypot(c.x - impactCenter[0], c.z - impactCenter[1]);
      let y = 0;
      let tilt = 0;
      if (impactU > 0) {
        const waveFront = impactU * 6.5;
        const dWave = Math.abs(dist - waveFront);
        if (dWave < 1.35) {
          const amp = (1 - dWave / 1.35) * (1 - impactU * 0.65);
          y += Math.sin(amp * Math.PI) * 0.72;
          tilt = amp * 0.35;
        }
      }
      // Subtle sink under resting letters
      if (Math.abs(c.z) < 0.7 && c.x > -2.4 && c.x < 2.8) {
        y -= 0.14;
      }
      dummy.position.set(c.x, y - 0.12, c.z);
      dummy.rotation.set(tilt * Math.sin(c.seed), 0, tilt * Math.cos(c.seed));
      dummy.updateMatrix();
      capMesh.setMatrixAt(i, dummy.matrix);
    });
    capMesh.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);

    // 2D HUD Overlay
    const hctx = hudCanvas.getContext('2d');
    hctx.clearRect(0, 0, W, H);
    if (!micro) {
      const sc = Math.min(1, safe.w / 896);
      const alpha = smooth(0.05, 0.3, u);
      hctx.save();
      hctx.globalAlpha = alpha;
      hctx.fillStyle = PAL.ink;
      hctx.textAlign = 'center';
      hctx.textBaseline = 'alphabetic';
      hctx.font = `800 ${Math.round(52 * sc)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      hctx.fillText(String(shot.headline || 'SOFT.').toUpperCase(), safe.x + safe.w * 0.5, safe.y + safe.h - 90 * sc);
      if (shot.tagline) {
        hctx.globalAlpha = alpha * 0.72;
        hctx.font = `600 ${Math.round(19 * sc)}px "Courier New", monospace`;
        hctx.fillText(String(shot.tagline).toUpperCase(), safe.x + safe.w * 0.5, safe.y + safe.h - 48 * sc);
      }
      hctx.restore();
    }
  }

  window.SpatialKit = { renderShot, PAL };
})();
