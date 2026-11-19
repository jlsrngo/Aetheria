(function () {
  var GLOBAL_SCOPE = typeof window !== "undefined" ? window : globalThis;
  var OUTLINE_COLOR = 0x594637;

  function applyGesture(name, p, opts, bb, parts, leftLegBaseY, rightLegBaseY) {
    var elapsed = opts && typeof opts.elapsedSec === "number" && Number.isFinite(opts.elapsedSec) ? Math.max(0, opts.elapsedSec) : null;
    var env = opts && opts.taper === false ? 1 : Math.min(1, p / 0.08, (1 - p) / 0.12);

    if (name === "run") {
      var rPhase = elapsed !== null ? elapsed * Math.PI * 2 * 2.25 : p * Math.PI * 2 * 6;
      var stride = Math.sin(rPhase) * env;
      var bounce = Math.abs(stride);
      if (parts.leftLeg && parts.rightLeg) {
        parts.leftLeg.rotation.x = stride * 1.12;
        parts.rightLeg.rotation.x = -stride * 1.12;
        parts.leftLeg.position.y = leftLegBaseY + Math.max(0, stride) * 0.16;
        parts.rightLeg.position.y = rightLegBaseY + Math.max(0, -stride) * 0.16;
      }
      if (parts.leftArm && parts.rightArm) {
        parts.leftArm.rotation.x = -stride * 1.05;
        parts.rightArm.rotation.x = stride * 1.05;
        parts.leftArm.rotation.z = 0.16 * env;
        parts.rightArm.rotation.z = -0.16 * env;
      }
      bb.position.y = bounce * 0.24;
      bb.rotation.x = 0.2 * env;
      bb.rotation.z = stride * 0.1;
      if (parts.headGroup) parts.headGroup.rotation.x = -0.1 * env;
      return;
    }

    if (name === "wave") {
      var wPhase = elapsed !== null ? elapsed * Math.PI * 2 * 2.1 : p * Math.PI * 2 * 4;
      var wOsc = Math.sin(wPhase) * env;
      if (parts.rightArm) {
        parts.rightArm.rotation.z = 2.15 * env + wOsc * 0.34;
        parts.rightArm.rotation.x = -0.25 * env;
      }
      if (parts.leftArm) {
        parts.leftArm.rotation.z = 0.14 * env;
        parts.leftArm.rotation.x = Math.sin(wPhase * 0.5) * 0.12 * env;
      }
      bb.rotation.z = -0.06 * env + wOsc * 0.03;
      bb.position.y = Math.abs(wOsc) * 0.04;
      if (parts.headGroup) {
        parts.headGroup.rotation.z = -0.1 * env + wOsc * 0.05;
      }
      return;
    }

    if (name === "talk") {
      var tPhase = elapsed !== null ? elapsed * Math.PI * 2 * 1.8 : p * Math.PI * 2 * 4;
      var g1 = Math.sin(tPhase) * env;
      var g2 = Math.cos(tPhase * 1.3) * env;
      if (parts.leftArm && parts.rightArm) {
        parts.leftArm.rotation.x = -0.55 * env + g1 * 0.32;
        parts.rightArm.rotation.x = -0.55 * env - g2 * 0.32;
        parts.leftArm.rotation.z = 0.22 * env;
        parts.rightArm.rotation.z = -0.22 * env;
      }
      if (parts.headGroup) {
        parts.headGroup.rotation.x = Math.sin(tPhase * 1.5) * 0.1 * env;
        parts.headGroup.rotation.y = Math.sin(tPhase * 0.7) * 0.12 * env;
      }
      bb.position.y = Math.abs(g1) * 0.05;
      bb.rotation.z = g2 * 0.04;
      return;
    }

    if (name === "point") {
      var hold = Math.min(1, p / 0.18, (1 - p) / 0.16);
      if (parts.rightArm) {
        parts.rightArm.rotation.x = -1.25 * hold;
        parts.rightArm.rotation.z = 0.25 * hold;
      }
      if (parts.leftArm) parts.leftArm.rotation.x = 0.22 * hold;
      bb.rotation.y = -0.18 * hold;
      bb.rotation.x = 0.08 * hold;
      if (parts.headGroup) parts.headGroup.rotation.y = 0.14 * hold;
      return;
    }

    if (name === "cheer") {
      var cPhase = elapsed !== null ? elapsed * Math.PI * 2 * 1.85 : p * Math.PI * 2 * 3;
      var jump = Math.abs(Math.sin(cPhase)) * env;
      if (parts.leftArm && parts.rightArm) {
        parts.leftArm.rotation.z = -2.25 * env - jump * 0.2;
        parts.rightArm.rotation.z = 2.25 * env + jump * 0.2;
      }
      bb.position.y = jump * 0.42;
      var sq = jump * 0.09;
      bb.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      if (parts.headGroup) parts.headGroup.rotation.x = -0.1 * jump;
      return;
    }

    if (name === "shock") {
      var pop = Math.sin(Math.min(1, p * 2.2) * Math.PI);
      var shiver = Math.sin(p * Math.PI * 16) * (1 - p * 0.5) * env;
      bb.position.y = pop * 0.34;
      bb.rotation.x = -0.16 * env;
      bb.rotation.z = shiver * 0.09;
      if (parts.leftArm && parts.rightArm) {
        parts.leftArm.rotation.x = -1.25 * env;
        parts.rightArm.rotation.x = -1.25 * env;
        parts.leftArm.rotation.z = -0.65 * env;
        parts.rightArm.rotation.z = 0.65 * env;
      }
      if (parts.headGroup) parts.headGroup.rotation.y = shiver * 0.15;
      return;
    }

    if (name === "work") {
      var kPhase = elapsed !== null ? elapsed * Math.PI * 2 * 1.45 : p * Math.PI * 2 * 3;
      var swing = Math.sin(kPhase) * env;
      bb.rotation.x = (0.28 + Math.max(0, swing) * 0.14) * env;
      bb.position.y = Math.abs(swing) * 0.05;
      if (parts.leftArm && parts.rightArm) {
        parts.leftArm.rotation.x = -0.85 * env + swing * 0.45;
        parts.rightArm.rotation.x = -0.85 * env - swing * 0.45;
      }
      if (parts.headGroup) parts.headGroup.rotation.x = 0.14 * env;
      return;
    }

    if (name === "nod") {
      var nPhase = elapsed !== null ? elapsed * Math.PI * 2 * 1.9 : p * Math.PI * 2 * 3;
      var nd = Math.max(0, Math.sin(nPhase)) * env;
      if (parts.headGroup) parts.headGroup.rotation.x = nd * 0.36;
      bb.position.y = -nd * 0.03;
      return;
    }

    if (name === "dance") {
      var dPhase = elapsed !== null ? elapsed * Math.PI * 2 * 1.7 : p * Math.PI * 2 * 4;
      var groove = Math.sin(dPhase) * env;
      var beat = Math.abs(Math.sin(dPhase * 2)) * env;
      bb.position.y = beat * 0.16;
      bb.rotation.z = groove * 0.14;
      bb.rotation.y = groove * 0.22;
      if (parts.leftArm && parts.rightArm) {
        parts.leftArm.rotation.z = (-0.9 - Math.max(0, groove) * 1.1) * env;
        parts.rightArm.rotation.z = (0.9 + Math.max(0, -groove) * 1.1) * env;
      }
      if (parts.leftLeg && parts.rightLeg) {
        parts.leftLeg.rotation.x = groove * 0.35;
        parts.rightLeg.rotation.x = -groove * 0.35;
      }
      if (parts.headGroup) parts.headGroup.rotation.z = -groove * 0.1;
    }
  }

  function ensureFaceOverlay(parts) {
    if (!parts.headGroup || !parts.eyes) return null;
    if (parts.__faceOverlay) return parts.__faceOverlay;

    var darkInk = parts.darkInk || new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR });
    var mouthFill = new THREE.MeshBasicMaterial({ color: 0xe11d48 });
    var overlay = { current: "happy", groups: {} };

    function makeBrow(x, y, rotZ) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.042, 0.05), darkInk);
      b.position.set(x, y, 0.61);
      b.rotation.z = rotZ;
      return b;
    }
    function makeCurve(pts, radius) {
      return new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, radius || 0.022, 8, false),
        darkInk
      );
    }

    // Laugh: ^ ^ squint eyes + wide open D-mouth
    var laughG = new THREE.Group();
    [-0.22, 0.22].forEach(function (ex) {
      laughG.add(makeCurve([
        new THREE.Vector3(ex - 0.08, 0.0, 0.6),
        new THREE.Vector3(ex, 0.08, 0.62),
        new THREE.Vector3(ex + 0.08, 0.0, 0.6)
      ], 0.026));
    });
    var laughMouth = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), mouthFill);
    laughMouth.scale.set(1.25, 0.9, 0.32);
    laughMouth.position.set(0, -0.17, 0.6);
    laughG.add(laughMouth);
    overlay.groups.laugh = laughG;

    // Sad: droopy brows + frown
    var sadG = new THREE.Group();
    sadG.add(makeBrow(-0.22, 0.17, 0.34), makeBrow(0.22, 0.17, -0.34));
    sadG.add(makeCurve([
      new THREE.Vector3(-0.09, -0.2, 0.59),
      new THREE.Vector3(0, -0.13, 0.61),
      new THREE.Vector3(0.09, -0.2, 0.59)
    ]));
    overlay.groups.sad = sadG;

    // Surprised: high brows + O mouth
    var surpG = new THREE.Group();
    surpG.add(makeBrow(-0.22, 0.21, 0.12), makeBrow(0.22, 0.21, -0.12));
    var oMouth = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.026, 10, 18), darkInk);
    oMouth.position.set(0, -0.17, 0.61);
    surpG.add(oMouth);
    overlay.groups.surprised = surpG;

    // Angry: sharp V brows + tense frown
    var angG = new THREE.Group();
    angG.add(makeBrow(-0.2, 0.16, -0.38), makeBrow(0.2, 0.16, 0.38));
    angG.add(makeCurve([
      new THREE.Vector3(-0.1, -0.19, 0.59),
      new THREE.Vector3(0, -0.14, 0.61),
      new THREE.Vector3(0.1, -0.19, 0.59)
    ], 0.025));
    overlay.groups.angry = angG;

    // Worried: tilted brows + tiny flat/wavy mouth
    var worG = new THREE.Group();
    worG.add(makeBrow(-0.22, 0.18, 0.28), makeBrow(0.22, 0.18, -0.28));
    worG.add(makeCurve([
      new THREE.Vector3(-0.08, -0.17, 0.6),
      new THREE.Vector3(-0.02, -0.14, 0.61),
      new THREE.Vector3(0.03, -0.18, 0.61),
      new THREE.Vector3(0.09, -0.15, 0.6)
    ]));
    overlay.groups.worried = worG;

    // Sleepy: flat drooping eyelids + small yawn dot
    var slpG = new THREE.Group();
    [-0.22, 0.22].forEach(function (ex) {
      var lid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.05), darkInk);
      lid.position.set(ex, 0.02, 0.61);
      slpG.add(lid);
    });
    var yawn = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), darkInk);
    yawn.scale.set(0.9, 1.15, 0.4);
    yawn.position.set(0, -0.17, 0.6);
    slpG.add(yawn);
    overlay.groups.sleepy = slpG;

    Object.keys(overlay.groups).forEach(function (k) {
      overlay.groups[k].visible = false;
      parts.headGroup.add(overlay.groups[k]);
    });
    parts.__faceOverlay = overlay;
    return overlay;
  }

  function setExpression(parts, name) {
    var overlay = ensureFaceOverlay(parts);
    if (!overlay) return;
    var expr = name || "happy";
    overlay.current = expr;
    var showDefaultEyes = expr !== "laugh" && expr !== "sleepy";
    var eyeScaleY = expr === "surprised" ? 1.45 : expr === "sad" || expr === "worried" ? 0.92 : 1.15;
    for (var i = 0; i < parts.eyes.length; i++) {
      parts.eyes[i].visible = showDefaultEyes;
      parts.eyes[i].scale.y = eyeScaleY;
    }
    if (parts.smile) parts.smile.visible = expr === "happy";
    Object.keys(overlay.groups).forEach(function (k) {
      overlay.groups[k].visible = k === expr;
    });
  }

  function buildEmoteMesh(kind, outlineMat) {
    var g = new THREE.Group();
    var kit = GLOBAL_SCOPE.ClayKit;
    function out(geo, hex) {
      var mat = new THREE.MeshBasicMaterial({ color: hex });
      return kit && kit.addOutlinedMesh ? kit.addOutlinedMesh(geo, mat, outlineMat, 0.022, false, false).group : new THREE.Mesh(geo, mat);
    }

    if (kind === "exclaim") {
      var bar = out(new THREE.CylinderGeometry(0.075, 0.055, 0.42, 12), 0xef4444);
      bar.position.y = 0.28;
      var dot = out(new THREE.SphereGeometry(0.075, 12, 10), 0xef4444);
      dot.position.y = -0.02;
      g.add(bar, dot);
    } else if (kind === "question") {
      var arc = out(new THREE.TorusGeometry(0.14, 0.055, 10, 18, Math.PI * 1.35), 0x3b82f6);
      arc.position.set(0, 0.3, 0);
      arc.rotation.z = -0.4;
      var qdot = out(new THREE.SphereGeometry(0.068, 12, 10), 0x3b82f6);
      qdot.position.y = 0.0;
      g.add(arc, qdot);
    } else if (kind === "idea") {
      var bulb = out(new THREE.SphereGeometry(0.2, 16, 14), 0xfef08a);
      bulb.position.y = 0.24;
      var base = out(new THREE.CylinderGeometry(0.09, 0.08, 0.14, 12), 0x94a3b8);
      base.position.y = 0.02;
      g.add(bulb, base);
    } else if (kind === "heart") {
      var l1 = out(new THREE.SphereGeometry(0.13, 14, 12), 0xf43f5e);
      l1.position.set(-0.1, 0.24, 0);
      var l2 = out(new THREE.SphereGeometry(0.13, 14, 12), 0xf43f5e);
      l2.position.set(0.1, 0.24, 0);
      var tip = out(new THREE.ConeGeometry(0.19, 0.28, 14), 0xf43f5e);
      tip.rotation.z = Math.PI;
      tip.position.set(0, 0.08, 0);
      g.add(l1, l2, tip);
    } else if (kind === "sweat") {
      var drop = out(new THREE.ConeGeometry(0.12, 0.3, 14), 0x38bdf8);
      drop.position.set(0.45, -0.05, 0.15);
      var bot = out(new THREE.SphereGeometry(0.12, 12, 10), 0x38bdf8);
      bot.position.set(0.45, -0.18, 0.15);
      g.add(drop, bot);
    } else if (kind === "anger") {
      [0, Math.PI / 2].forEach(function (rz) {
        var barA = out(new THREE.BoxGeometry(0.32, 0.08, 0.08), 0xef4444);
        barA.rotation.z = rz + Math.PI / 4;
        barA.position.set(0.35, 0.16, 0.12);
        g.add(barA);
      });
    } else if (kind === "sleep") {
      [0, 1, 2].forEach(function (i) {
        var z = out(new THREE.BoxGeometry(0.14 + i * 0.04, 0.14 + i * 0.04, 0.06), 0xa78bfa);
        z.position.set(0.12 + i * 0.16, 0.05 + i * 0.22, 0);
        z.rotation.z = 0.2 - i * 0.1;
        g.add(z);
      });
    } else if (kind === "music") {
      var noteHead = out(new THREE.SphereGeometry(0.11, 12, 10), 0xec4899);
      noteHead.scale.set(1.2, 0.85, 0.7);
      noteHead.position.set(-0.08, 0.04, 0);
      var stem = out(new THREE.BoxGeometry(0.055, 0.38, 0.055), 0xec4899);
      stem.position.set(0.02, 0.22, 0);
      var flag = out(new THREE.BoxGeometry(0.18, 0.08, 0.055), 0xec4899);
      flag.position.set(0.1, 0.38, 0);
      flag.rotation.z = -0.3;
      g.add(noteHead, stem, flag);
    }
    return g;
  }

  function setEmote(anchors, parts, outlineMat, name, elapsedSec) {
    if (!anchors || !anchors.head) return;
    if (!parts.__emoteRoot) {
      var root = new THREE.Group();
      root.position.set(0, 0.32, 0.08);
      anchors.head.add(root);
      parts.__emoteRoot = root;
      parts.__emoteCache = {};
    }
    var emRoot = parts.__emoteRoot;
    Object.keys(parts.__emoteCache).forEach(function (k) {
      parts.__emoteCache[k].visible = false;
    });
    if (!name) return;
    if (!parts.__emoteCache[name]) {
      var mesh = buildEmoteMesh(name, outlineMat);
      emRoot.add(mesh);
      parts.__emoteCache[name] = mesh;
    }
    var active = parts.__emoteCache[name];
    active.visible = true;
    var t = typeof elapsedSec === "number" && Number.isFinite(elapsedSec) ? elapsedSec : 0;
    active.position.y = Math.sin(t * Math.PI * 2 * 1.6) * 0.08;
    var pulse = 1 + Math.sin(t * Math.PI * 2 * 2.2) * 0.08;
    active.scale.setScalar(pulse);
  }

  GLOBAL_SCOPE.ClayKit = GLOBAL_SCOPE.ClayKit || {};
  GLOBAL_SCOPE.ClayKit.__gestures = {
    applyGesture: applyGesture,
    setExpression: setExpression,
    setEmote: setEmote
  };
})();
