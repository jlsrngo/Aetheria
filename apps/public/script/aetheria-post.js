/**
 * Aetheria Modular WebGL2 Post-Processing Pipeline (`/script/aetheria-post.js`).
 *
 * Reusable deterministic post-processing passes extracted for the main production runtime:
 * - Selective bright-pass + separable 9-tap Gaussian bloom (half-res pooled ping-pong FBOs)
 * - Radial chromatic aberration
 * - Filmic tonemapping + color grading (exposure, contrast, saturation, temperature, tint)
 * - Vignette & deterministic frame-seeded film grain
 * - Explicit FBO/texture pooling, `webglcontextlost` recovery, shader error reporting to
 *   `window.__aetheriaErrors`, and automatic Canvas 2D fallback when WebGL2 is unavailable.
 */
(function (global) {
  "use strict";

  const VS_FULLSCREEN = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const FS_THRESHOLD = `#version 300 es
  precision highp float;
  in vec2 vUv;
  uniform sampler2D uSrc;
  uniform float uThreshold;
  uniform float uSoftKnee;
  out vec4 o;
  void main() {
    vec4 tex = texture(uSrc, vUv);
    float lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
    float knee = max(0.001, uSoftKnee);
    float soft = clamp((lum - uThreshold + knee) / (2.0 * knee), 0.0, 1.0);
    soft = soft * soft * knee;
    float excess = max(lum - uThreshold, soft);
    float denom = max(1.0 - uThreshold, 0.08);
    float contrib = clamp(excess / denom, 0.0, 1.0);
    o = vec4(tex.rgb * contrib, 1.0);
  }`;

  const FS_BLUR = `#version 300 es
  precision highp float;
  in vec2 vUv;
  uniform sampler2D uSrc;
  uniform vec2 uDir;
  out vec4 o;
  void main() {
    vec3 acc = texture(uSrc, vUv).rgb * 0.227027;
    acc += (texture(uSrc, vUv + uDir * 1.384615).rgb + texture(uSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
    acc += (texture(uSrc, vUv + uDir * 3.230769).rgb + texture(uSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
    o = vec4(acc, 1.0);
  }`;

  const FS_COMPOSITE = `#version 300 es
  precision highp float;
  in vec2 vUv;
  uniform sampler2D uSrc;
  uniform sampler2D uBloom;
  uniform vec2 uRes;
  uniform float uFrame;
  uniform float uBloomAmt;
  uniform float uChromatic;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uTemperature;
  uniform float uTint;
  uniform float uTonemap;
  uniform float uVignette;
  uniform float uVignetteSoft;
  uniform float uGrain;
  uniform vec2 uDirBlurVec;
  uniform float uRadialBlur;
  uniform vec2 uRadialCenter;
  uniform float uDofAmt;
  uniform vec2 uDofFocus;
  uniform float uDofRadius;
  uniform float uDofFeather;
  out vec4 o;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 filmicTonemap(vec3 x) {
    float m = max(max(x.r, x.g), x.b);
    float k = 0.72;
    float mt = m < k ? m : k + (1.0 - k) * (1.0 - exp(-(m - k) / (1.0 - k)));
    vec3 c = x * (mt / max(m, 1e-5));
    float wh = smoothstep(1.0, 5.5, m);
    return mix(c, vec3(mt), wh * 0.75);
  }

  vec3 sampleOptical(vec2 uv) {
    vec3 col = texture(uSrc, uv).rgb;
    float dirLen = length(uDirBlurVec);
    if (dirLen > 1e-5) {
      vec3 acc = col * 0.20;
      for (int i = 1; i <= 4; i++) {
        float w = (5.0 - float(i)) / 25.0;
        vec2 off = uDirBlurVec * (float(i) / 4.0);
        acc += (texture(uSrc, clamp(uv + off, 0.0, 1.0)).rgb + texture(uSrc, clamp(uv - off, 0.0, 1.0)).rgb) * w;
      }
      col = acc;
    }
    if (uRadialBlur > 1e-4) {
      vec2 toCenter = uv - uRadialCenter;
      vec3 racc = vec3(0.0);
      for (int i = 0; i < 9; i++) {
        float f = float(i) / 8.0;
        racc += texture(uSrc, clamp(uv - toCenter * uRadialBlur * f, 0.0, 1.0)).rgb;
      }
      col = mix(col, racc / 9.0, 0.85);
    }
    if (uDofAmt > 0.05) {
      vec2 df = uv - uDofFocus;
      df.x *= uRes.x / max(1.0, uRes.y);
      float coc = smoothstep(uDofRadius, uDofRadius + max(0.05, uDofFeather), length(df));
      if (coc > 1e-3) {
        vec2 pxRad = (uDofAmt * coc) / max(uRes, vec2(1.0));
        vec3 bacc = col;
        for (int i = 0; i < 8; i++) {
          float ang = float(i) * 0.78539816;
          vec2 dir = vec2(cos(ang), sin(ang)) * pxRad;
          bacc += texture(uSrc, clamp(uv + dir, 0.0, 1.0)).rgb;
          bacc += texture(uSrc, clamp(uv + dir * 0.5, 0.0, 1.0)).rgb;
        }
        col = mix(col, bacc / 17.0, coc);
      }
    }
    return col;
  }

  void main() {
    vec2 centered = vUv - 0.5;
    vec4 baseSample = texture(uSrc, vUv);
    vec3 col;
    if (uChromatic > 1e-5) {
      vec2 shift = centered * uChromatic;
      col.r = sampleOptical(clamp(vUv + shift, 0.0, 1.0)).r;
      col.g = sampleOptical(vUv).g;
      col.b = sampleOptical(clamp(vUv - shift, 0.0, 1.0)).b;
    } else {
      col = sampleOptical(vUv);
    }

    if (uBloomAmt > 1e-4) {
      col += texture(uBloom, vUv).rgb * uBloomAmt;
    }

    // Exposure & color balance
    col *= exp2(uExposure);
    col.r *= (1.0 + uTemperature * 0.16);
    col.b *= (1.0 - uTemperature * 0.16);
    col.g *= (1.0 + uTint * 0.12);

    // Saturation
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSaturation);

    // Contrast around mid-gray
    col = (col - 0.5) * uContrast + 0.5;
    col = max(col, 0.0);

    if (uTonemap > 0.5) {
      col = filmicTonemap(col);
    }

    // Vignette
    if (uVignette > 1e-4) {
      vec2 q = centered;
      q.x *= uRes.x / max(1.0, uRes.y);
      float vig = smoothstep(0.35, 0.35 + max(0.15, uVignetteSoft), length(q));
      col *= 1.0 - clamp(uVignette, 0.0, 0.95) * vig;
    }

    // Deterministic frame-seeded film grain
    if (uGrain > 1e-4) {
      vec2 fc = gl_FragCoord.xy;
      float g = hash12(fc + uFrame * vec2(37.1, 91.7))
              + hash12(fc * 1.37 + uFrame * vec2(11.3, 53.9)) - 1.0;
      float gLum = dot(col, vec3(0.299, 0.587, 0.114));
      col += g * uGrain * (0.75 * (1.0 - gLum) + 0.35);
    }

    o = vec4(clamp(col, 0.0, 1.0), baseSample.a);
  }`;

  function reportPostError(msg) {
    const text = "[aetheria-post] " + String(msg);
    if (global && typeof global === "object") {
      global.__aetheriaErrors = Array.isArray(global.__aetheriaErrors) ? global.__aetheriaErrors : [];
      if (global.__aetheriaErrors.length < 16 && global.__aetheriaErrors.indexOf(text) === -1) {
        global.__aetheriaErrors.push(text);
      }
    }
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function normalizePassOpts(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: o.enabled !== false,
      bloom: clamp(Number(o.bloom) || 0, 0, 2.5),
      bloomThreshold: clamp(Number.isFinite(Number(o.bloomThreshold)) ? Number(o.bloomThreshold) : 0.68, 0.05, 0.99),
      bloomRadius: clamp(Number.isFinite(Number(o.bloomRadius)) ? Number(o.bloomRadius) : 1.8, 0.5, 6.0),
      chromatic: clamp(Number(o.chromatic) || 0, 0, 0.03),
      exposure: clamp(Number(o.exposure) || 0, -2.0, 2.0),
      contrast: clamp(Number.isFinite(Number(o.contrast)) ? Number(o.contrast) : 1.0, 0.5, 2.0),
      saturation: clamp(Number.isFinite(Number(o.saturation)) ? Number(o.saturation) : 1.0, 0.0, 2.5),
      temperature: clamp(Number(o.temperature) || 0, -1.0, 1.0),
      tint: clamp(Number(o.tint) || 0, -1.0, 1.0),
      tonemap: Boolean(o.tonemap),
      vignette: clamp(Number(o.vignette) || 0, 0, 0.95),
      vignetteSoftness: clamp(Number.isFinite(Number(o.vignetteSoftness)) ? Number(o.vignetteSoftness) : 0.65, 0.15, 1.5),
      grain: clamp(Number(o.grain) || 0, 0, 0.25),
      directionalBlur: clamp(Number(o.directionalBlur) || 0, 0, 64),
      directionalAngle: Number.isFinite(Number(o.directionalAngle)) ? Number(o.directionalAngle) : 0,
      radialBlur: clamp(Number(o.radialBlur) || 0, 0, 0.35),
      radialCenter: Array.isArray(o.radialCenter) && o.radialCenter.length >= 2
        ? [clamp(Number(o.radialCenter[0]), 0, 1), clamp(Number(o.radialCenter[1]), 0, 1)]
        : [0.5, 0.5],
      dof: clamp(Number(o.dof) || 0, 0, 32),
      dofFocus: Array.isArray(o.dofFocus) && o.dofFocus.length >= 2
        ? [clamp(Number(o.dofFocus[0]), 0, 1), clamp(Number(o.dofFocus[1]), 0, 1)]
        : [0.5, 0.5],
      dofRadius: clamp(Number.isFinite(Number(o.dofRadius)) ? Number(o.dofRadius) : 0.22, 0.0, 1.0),
      dofFeather: clamp(Number.isFinite(Number(o.dofFeather)) ? Number(o.dofFeather) : 0.35, 0.05, 1.5),
      fps: Math.max(1, Number(o.fps) || 30),
      forceFallback2D: Boolean(o.forceFallback2D),
    };
  }

  function hasActiveEffect(p) {
    if (!p.enabled) return false;
    return (
      p.bloom > 1e-4 ||
      p.chromatic > 1e-5 ||
      Math.abs(p.exposure) > 1e-4 ||
      Math.abs(p.contrast - 1.0) > 1e-4 ||
      Math.abs(p.saturation - 1.0) > 1e-4 ||
      Math.abs(p.temperature) > 1e-4 ||
      Math.abs(p.tint) > 1e-4 ||
      p.tonemap ||
      p.vignette > 1e-4 ||
      p.grain > 1e-4 ||
      p.directionalBlur > 1e-3 ||
      p.radialBlur > 1e-4 ||
      p.dof > 1e-3
    );
  }

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || "unknown compile error";
      gl.deleteShader(sh);
      throw new Error(log);
    }
    return sh;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || "unknown link error";
      gl.deleteProgram(prog);
      throw new Error(log);
    }
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    const u = Object.create(null);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (info && info.name) {
        u[info.name] = gl.getUniformLocation(prog, info.name);
      }
    }
    return { prog, u };
  }

  function createTexture2D(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  function createFbo(gl, tex) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  }

  /**
   * Safe deterministic Canvas 2D fallback when WebGL2 is unavailable or context is lost.
   */
  function applyFallback2D(srcCanvas, targetCtx, t, p) {
    if (!targetCtx) return false;
    const w = (targetCtx.canvas && targetCtx.canvas.width) || (srcCanvas && srcCanvas.width) || 0;
    const h = (targetCtx.canvas && targetCtx.canvas.height) || (srcCanvas && srcCanvas.height) || 0;
    if (!(w > 0) || !(h > 0)) return false;

    const filterParts = [];
    if (Math.abs(p.exposure) > 1e-3) {
      filterParts.push("brightness(" + Math.pow(2, p.exposure).toFixed(3) + ")");
    }
    if (Math.abs(p.contrast - 1) > 1e-3) {
      filterParts.push("contrast(" + p.contrast.toFixed(3) + ")");
    }
    if (Math.abs(p.saturation - 1) > 1e-3) {
      filterParts.push("saturate(" + p.saturation.toFixed(3) + ")");
    }

    if (srcCanvas && srcCanvas !== targetCtx.canvas && typeof targetCtx.drawImage === "function") {
      targetCtx.save();
      if (filterParts.length) targetCtx.filter = filterParts.join(" ");
      targetCtx.drawImage(srcCanvas, 0, 0, w, h);
      targetCtx.restore();
    } else if (filterParts.length && typeof targetCtx.drawImage === "function" && srcCanvas) {
      targetCtx.save();
      targetCtx.filter = filterParts.join(" ");
      targetCtx.drawImage(srcCanvas, 0, 0, w, h);
      targetCtx.restore();
    }

    if (p.bloom > 1e-3 && srcCanvas && typeof targetCtx.drawImage === "function") {
      targetCtx.save();
      targetCtx.globalCompositeOperation = "lighter";
      targetCtx.globalAlpha = clamp(p.bloom * 0.28, 0, 0.65);
      targetCtx.filter = "blur(" + Math.round(6 * p.bloomRadius) + "px)";
      targetCtx.drawImage(srcCanvas, 0, 0, w, h);
      targetCtx.restore();
    }

    if (p.vignette > 1e-3 && typeof targetCtx.createRadialGradient === "function") {
      targetCtx.save();
      const cx = w * 0.5;
      const cy = h * 0.5;
      const r0 = Math.min(w, h) * 0.32;
      const r1 = Math.hypot(cx, cy);
      const grad = targetCtx.createRadialGradient(cx, cy, r0, cx, cy, r1);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0," + clamp(p.vignette, 0, 0.92).toFixed(3) + ")");
      targetCtx.fillStyle = grad;
      targetCtx.fillRect(0, 0, w, h);
      targetCtx.restore();
    }

    if (p.grain > 1e-3 && typeof targetCtx.fillRect === "function") {
      // Deterministic sparse film grain dots seeded from frame index
      const frame = Math.round((Number(t) || 0) * p.fps);
      let seed = (frame * 2654435761 + 1013904223) >>> 0;
      const count = Math.min(360, Math.max(40, Math.round(p.grain * 2400)));
      targetCtx.save();
      for (let i = 0; i < count; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const gx = (seed / 4294967296) * w;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const gy = (seed / 4294967296) * h;
        const bright = (seed & 1) === 0;
        targetCtx.fillStyle = bright
          ? "rgba(255,255,255," + (p.grain * 0.35).toFixed(3) + ")"
          : "rgba(0,0,0," + (p.grain * 0.35).toFixed(3) + ")";
        targetCtx.fillRect(gx, gy, 2, 2);
      }
      targetCtx.restore();
    }
    return true;
  }

  function createPipeline(width, height, initOpts) {
    const opts = initOpts && typeof initOpts === "object" ? initOpts : {};
    let w = Math.max(1, Math.round(Number(width) || 1));
    let h = Math.max(1, Math.round(Number(height) || 1));
    let bw = Math.max(1, Math.round(w * 0.5));
    let bh = Math.max(1, Math.round(h * 0.5));
    let gl = null;
    let glCanvas = null;
    let disposed = false;
    let contextLost = false;
    let backend = "fallback2d";
    let res = null;
    let passesRun = 0;

    function initWebGL() {
      if (opts.forceFallback2D) return false;
      if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
      try {
        glCanvas = document.createElement("canvas");
        glCanvas.width = w;
        glCanvas.height = h;
        glCanvas.addEventListener(
          "webglcontextlost",
          function (ev) {
            if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
            contextLost = true;
            backend = "fallback2d";
            reportPostError("WebGL2 context lost; switching to safe Canvas 2D fallback.");
          },
          false
        );

        gl = glCanvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        });
        if (!gl) return false;

        const pThresh = createProgram(gl, VS_FULLSCREEN, FS_THRESHOLD);
        const pBlur = createProgram(gl, VS_FULLSCREEN, FS_BLUR);
        const pComp = createProgram(gl, VS_FULLSCREEN, FS_COMPOSITE);

        const quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        const srcTex = createTexture2D(gl, w, h);
        const bloomTexA = createTexture2D(gl, bw, bh);
        const bloomTexB = createTexture2D(gl, bw, bh);
        const fboA = createFbo(gl, bloomTexA);
        const fboB = createFbo(gl, bloomTexB);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        res = { pThresh, pBlur, pComp, quadBuf, srcTex, bloomTexA, bloomTexB, fboA, fboB };
        backend = "webgl2";
        return true;
      } catch (err) {
        reportPostError(err && err.message ? err.message : String(err));
        cleanupResources();
        backend = "fallback2d";
        return false;
      }
    }

    function cleanupResources() {
      if (gl && res) {
        try {
          gl.deleteFramebuffer(res.fboA);
          gl.deleteFramebuffer(res.fboB);
          gl.deleteTexture(res.srcTex);
          gl.deleteTexture(res.bloomTexA);
          gl.deleteTexture(res.bloomTexB);
          gl.deleteBuffer(res.quadBuf);
          gl.deleteProgram(res.pThresh.prog);
          gl.deleteProgram(res.pBlur.prog);
          gl.deleteProgram(res.pComp.prog);
        } catch (_) {}
      }
      res = null;
    }

    function resize(newW, newH) {
      const nw = Math.max(1, Math.round(Number(newW) || 1));
      const nh = Math.max(1, Math.round(Number(newH) || 1));
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      bw = Math.max(1, Math.round(w * 0.5));
      bh = Math.max(1, Math.round(h * 0.5));
      if (gl && res && !contextLost) {
        glCanvas.width = w;
        glCanvas.height = h;
        gl.bindTexture(gl.TEXTURE_2D, res.srcTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, res.bloomTexA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, res.bloomTexB);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    }

    function drawQuad() {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.quadBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    initWebGL();

    return {
      isWebGL: function () {
        return backend === "webgl2" && Boolean(gl && res && !contextLost && !disposed);
      },
      getStats: function () {
        return { backend, width: w, height: h, contextLost, disposed, passesRun };
      },
      resize,
      apply: function (srcCanvas, targetCtx, t, rawPassOpts) {
        if (disposed || !targetCtx) return false;
        const p = normalizePassOpts(rawPassOpts);
        if (!hasActiveEffect(p)) return false;
        passesRun++;

        const src = srcCanvas || targetCtx.canvas;
        if (p.forceFallback2D || !this.isWebGL() || !src) {
          return applyFallback2D(src, targetCtx, t, p);
        }

        const sw = src.width || w;
        const sh = src.height || h;
        if (sw !== w || sh !== h) resize(sw, sh);

        try {
          // Upload source canvas with Y flipped so UV(0,0) maps bottom-left cleanly
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, res.srcTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);

          if (p.bloom > 1e-4) {
            // Pass 1: bright-pass threshold into half-res FBO A
            gl.bindFramebuffer(gl.FRAMEBUFFER, res.fboA);
            gl.viewport(0, 0, bw, bh);
            gl.useProgram(res.pThresh.prog);
            gl.uniform1i(res.pThresh.u.uSrc, 0);
            gl.uniform1f(res.pThresh.u.uThreshold, p.bloomThreshold);
            gl.uniform1f(res.pThresh.u.uSoftKnee, 0.22);
            drawQuad();

            // Pass 2 & 3: 2-iteration multi-scale separable Gaussian blur (tight + wide optical halo)
            gl.useProgram(res.pBlur.prog);
            gl.uniform1i(res.pBlur.u.uSrc, 0);
            const scales = [p.bloomRadius, p.bloomRadius * 2.2];
            for (let it = 0; it < scales.length; it++) {
              const rad = scales[it];
              // Horizontal A -> B
              gl.bindFramebuffer(gl.FRAMEBUFFER, res.fboB);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, res.bloomTexA);
              gl.uniform2f(res.pBlur.u.uDir, rad / bw, 0.0);
              drawQuad();
              // Vertical B -> A
              gl.bindFramebuffer(gl.FRAMEBUFFER, res.fboA);
              gl.bindTexture(gl.TEXTURE_2D, res.bloomTexB);
              gl.uniform2f(res.pBlur.u.uDir, 0.0, rad / bh);
              drawQuad();
            }
          }

          // Pass 4: final composite onto WebGL output canvas
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, w, h);
          gl.useProgram(res.pComp.prog);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, res.srcTex);
          gl.uniform1i(res.pComp.u.uSrc, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, res.bloomTexA);
          gl.uniform1i(res.pComp.u.uBloom, 1);
          gl.uniform2f(res.pComp.u.uRes, w, h);
          gl.uniform1f(res.pComp.u.uFrame, Math.round((Number(t) || 0) * p.fps));
          gl.uniform1f(res.pComp.u.uBloomAmt, p.bloom);
          gl.uniform1f(res.pComp.u.uChromatic, p.chromatic);
          gl.uniform1f(res.pComp.u.uExposure, p.exposure);
          gl.uniform1f(res.pComp.u.uContrast, p.contrast);
          gl.uniform1f(res.pComp.u.uSaturation, p.saturation);
          gl.uniform1f(res.pComp.u.uTemperature, p.temperature);
          gl.uniform1f(res.pComp.u.uTint, p.tint);
          gl.uniform1f(res.pComp.u.uTonemap, p.tonemap ? 1.0 : 0.0);
          gl.uniform1f(res.pComp.u.uVignette, p.vignette);
          gl.uniform1f(res.pComp.u.uVignetteSoft, p.vignetteSoftness);
          gl.uniform1f(res.pComp.u.uGrain, p.grain);
          const dirRad = (p.directionalAngle * Math.PI) / 180;
          gl.uniform2f(
            res.pComp.u.uDirBlurVec,
            (Math.cos(dirRad) * p.directionalBlur) / Math.max(1, w),
            (Math.sin(dirRad) * p.directionalBlur) / Math.max(1, h)
          );
          gl.uniform1f(res.pComp.u.uRadialBlur, p.radialBlur);
          gl.uniform2f(res.pComp.u.uRadialCenter, p.radialCenter[0], 1.0 - p.radialCenter[1]);
          gl.uniform1f(res.pComp.u.uDofAmt, p.dof);
          gl.uniform2f(res.pComp.u.uDofFocus, p.dofFocus[0], 1.0 - p.dofFocus[1]);
          gl.uniform1f(res.pComp.u.uDofRadius, p.dofRadius);
          gl.uniform1f(res.pComp.u.uDofFeather, p.dofFeather);
          drawQuad();
          gl.finish();

          targetCtx.save();
          targetCtx.setTransform(1, 0, 0, 1, 0, 0);
          targetCtx.globalAlpha = 1;
          targetCtx.globalCompositeOperation = "copy";
          targetCtx.filter = "none";
          targetCtx.drawImage(glCanvas, 0, 0, w, h);
          targetCtx.restore();
          return true;
        } catch (err) {
          reportPostError("Render pass error: " + (err && err.message ? err.message : String(err)));
          return applyFallback2D(src, targetCtx, t, p);
        }
      },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        cleanupResources();
        gl = null;
        glCanvas = null;
      },
    };
  }

  let _sharedPipeline = null;
  let _sharedForceFallback = false;

  function apply(ctx, t, passOpts) {
    if (!ctx) return false;
    const p = normalizePassOpts(passOpts);
    if (!hasActiveEffect(p)) return false;
    const w = (ctx.canvas && ctx.canvas.width) || 1080;
    const h = (ctx.canvas && ctx.canvas.height) || 1920;
    const wantFallback = Boolean(p.forceFallback2D);
    if (
      !_sharedPipeline ||
      _sharedPipeline.getStats().disposed ||
      wantFallback !== _sharedForceFallback
    ) {
      if (_sharedPipeline) _sharedPipeline.dispose();
      _sharedForceFallback = wantFallback;
      _sharedPipeline = createPipeline(w, h, { forceFallback2D: wantFallback });
    }
    return _sharedPipeline.apply(ctx.canvas, ctx, t, p);
  }

  function getSharedStats() {
    return _sharedPipeline ? _sharedPipeline.getStats() : { backend: "uninitialized", passesRun: 0 };
  }

  function disposeShared() {
    if (_sharedPipeline) {
      _sharedPipeline.dispose();
      _sharedPipeline = null;
    }
  }

  global.AetheriaPost = {
    version: 1,
    createPipeline,
    apply,
    normalizePassOpts,
    hasActiveEffect,
    getSharedStats,
    disposeShared,
    SHADERS: {
      VS_FULLSCREEN,
      FS_THRESHOLD,
      FS_BLUR,
      FS_COMPOSITE,
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
