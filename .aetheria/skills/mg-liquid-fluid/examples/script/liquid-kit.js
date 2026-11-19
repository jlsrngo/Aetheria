/**
 * LiquidKit v2 — 3D Glossy Studio Liquid & SDF Jelly Engine
 * Adapted directly from references/aetheria-motion/demos/07-liquid/ (engine.js, shaders.js, textsdf.js, scene.js)
 * 100% offline, deterministic WebGL2 HDR + Bloom + Felzenszwalb EDT Letter SDF, adaptive for 9:16 & 16:9.
 */
(function () {
  'use strict';

  const PI = Math.PI;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, x) => clamp((x - a) / (b - a));
  const smooth = (t) => t * t * (3 - 2 * t);

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (s) => ((ax * s + bx) * s + cx) * s;
    const Y = (s) => ((ay * s + by) * s + cy) * s;
    const dX = (s) => (3 * ax * s + 2 * bx) * s + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, s = x;
      for (let i = 0; i < 12; i++) {
        const e = X(s) - x;
        if (Math.abs(e) < 1e-7) break;
        if (e > 0) hi = s; else lo = s;
        const d = dX(s);
        s = Math.abs(d) > 1e-6 ? s - e / d : (lo + hi) / 2;
        if (s <= lo || s >= hi) s = (lo + hi) / 2;
      }
      return Y(s);
    };
  }

  const flung = bezier(0.22, 1, 0.36, 1);
  const inOut = bezier(0.65, 0, 0.35, 1);
  const easeIn = bezier(0.5, 0, 0.9, 0.4);
  const outSoft = bezier(0.33, 0.9, 0.4, 1);
  const frontEase = bezier(0.28, 0.55, 0.42, 1);

  function spring(t, f = 4, z = 0.3) {
    if (t <= 0) return 0;
    const w = 2 * PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }

  function wob(t, f, decay) {
    return t <= 0 ? 0 : Math.exp(-t / decay) * Math.sin(2 * PI * f * t);
  }

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ================= 1. Felzenszwalb 2D Euclidean Distance Transform (textsdf.js) =================
  const INF = 1e20;
  function edt1d(f, d, v, z, n) {
    v[0] = 0; z[0] = -INF; z[1] = INF;
    let k = 0;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const r = q - v[k];
      d[q] = r * r + f[v[k]];
    }
  }

  function edt2d(grid, w, h) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
      edt1d(f, d, v, z, h);
      for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
      edt1d(f, d, v, z, w);
      for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
    }
  }

  function blur1(src, dst, w, h, sigma, horiz) {
    const r = Math.ceil(sigma * 3), ker = [];
    let s = 0;
    for (let i = -r; i <= r; i++) {
      const k = Math.exp(-i * i / (2 * sigma * sigma));
      ker.push(k);
      s += k;
    }
    for (let i = 0; i < ker.length; i++) ker[i] /= s;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          let xx = horiz ? x + i : x, yy = horiz ? y : y + i;
          xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
          yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
          acc += src[yy * w + xx] * ker[i + r];
        }
        dst[y * w + x] = acc;
      }
    }
  }

  function toHalf() {
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    return (v) => {
      f32[0] = v;
      const x = u32[0];
      const sign = (x >> 16) & 0x8000;
      let e = ((x >> 23) & 0xff) - 127 + 15;
      const m = x & 0x7fffff;
      if (e <= 0) return sign;
      if (e >= 31) return sign | 0x7c00;
      return sign | (e << 10) | (m >> 13);
    };
  }

  function buildLetterSDF(opts) {
    const word = (opts.word || 'drop').slice(0, 4).padEnd(4, 'o');
    const family = opts.family || 'Georgia, "Times New Roman", serif';
    const weight = opts.weight || 900;
    const size = opts.size || 380;
    const tracking = opts.tracking !== undefined ? opts.tracking : 12;
    const pad = opts.pad || 150;
    const sigma = opts.sigma || 9.0;

    const c0 = document.createElement('canvas');
    const cx = c0.getContext('2d');
    const fontStr = `${weight} ${size}px ${family}`;
    cx.font = fontStr;
    const xs = [];
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const pre = cx.measureText(word.slice(0, i + 1)).width;
      const one = cx.measureText(word[i]).width;
      xs.push(pre - one + tracking * i);
      total = pre + tracking * i;
    }
    const m = cx.measureText(word);
    const asc = Math.ceil(m.actualBoundingBoxAscent || size * 0.78);
    const desc = Math.ceil(m.actualBoundingBoxDescent || size * 0.26);
    const left = Math.ceil(m.actualBoundingBoxLeft || 10);
    const W = Math.ceil(total + left + pad * 2 + 24);
    const H = asc + desc + pad * 2;
    const baseX = pad + left, baseY = pad + asc;
    const out = new Float32Array(W * H * 4);
    const letters = [];
    const tmp = new Float64Array(W * H), tmp2 = new Float64Array(W * H);
    const outer = new Float64Array(W * H), inner = new Float64Array(W * H);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });

    for (let i = 0; i < 4; i++) {
      g.clearRect(0, 0, W, H);
      g.font = fontStr;
      g.fillStyle = '#fff';
      g.textBaseline = 'alphabetic';
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = '#fff';
      g.lineWidth = Math.round(size * 0.045); // Extra plump rounded liquid serifs like Fraunces Liquid Soft
      g.strokeText(word[i], baseX + xs[i], baseY);
      g.fillText(word[i], baseX + xs[i], baseY);

      const img = g.getImageData(0, 0, W, H).data;
      let minx = W, maxx = 0, miny = H, maxy = 0;
      for (let j = 0; j < W * H; j++) {
        const a = img[j * 4 + 3] / 255;
        if (a >= 1) { outer[j] = 0; inner[j] = INF; }
        else if (a <= 0) { outer[j] = INF; inner[j] = 0; }
        else {
          const d = 0.5 - a;
          outer[j] = d > 0 ? d * d : 0;
          inner[j] = d < 0 ? d * d : 0;
        }
        if (a > 0.5) {
          const x = j % W, y = (j / W) | 0;
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
      edt2d(outer, W, H);
      edt2d(inner, W, H);
      for (let j = 0; j < W * H; j++) {
        tmp[j] = Math.max(-200, Math.min(200, Math.sqrt(outer[j]) - Math.sqrt(inner[j])));
      }
      const sharp = new Float64Array(W * H), soft = new Float64Array(W * H);
      blur1(tmp, tmp2, W, H, 2.0, true); blur1(tmp2, sharp, W, H, 2.0, false);
      blur1(tmp, tmp2, W, H, sigma, true); blur1(tmp2, soft, W, H, sigma, false);
      for (let j = 0; j < W * H; j++) {
        const a = sharp[j], b = Math.min(soft[j], 0);
        let w = (-a - 3) / 18;
        w = w < 0 ? 0 : w > 1 ? 1 : w;
        w = w * w * (3 - 2 * w);
        out[j * 4 + i] = a > 0 ? Math.min(a, Math.max(soft[j], a * 0.5)) : a + (Math.min(b, a * 0.2) - a) * w;
      }
      letters.push({ ch: word[i], bbox: [minx, miny, maxx, maxy], pivot: [(minx + maxx) / 2, (miny + maxy) / 2] });
    }
    return { W, H, data: out, letters, baseX, baseY, asc, desc, width: total };
  }

  // ================= 2. GLSL Shaders (shaders.js exact port) =================
  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

  const COMMON = `
#define PI 3.14159265
float ss(float a, float b, float x){ float t = clamp((x - a)/(b - a), 0.0, 1.0); return t*t*(3.0 - 2.0*t); }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 noised(vec2 x){
  vec2 i = floor(x), f = fract(x);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga = hash22(i)*2.0-1.0, gb = hash22(i+vec2(1,0))*2.0-1.0, gc = hash22(i+vec2(0,1))*2.0-1.0, gd = hash22(i+vec2(1,1))*2.0-1.0;
  float va = dot(ga, f), vb = dot(gb, f-vec2(1,0)), vc = dot(gc, f-vec2(0,1)), vd = dot(gd, f-vec2(1,1));
  float v = va + u.x*(vb-va) + u.y*(vc-va) + u.x*u.y*(va-vb-vc+vd);
  vec2 d = ga + u.x*(gb-ga) + u.y*(gc-ga) + u.x*u.y*(ga-gb-gc+gd) + du*(u.yx*(va-vb-vc+vd) + vec2(vb,vc) - va);
  return vec3(v, d);
}
`;

  const FS_SCENE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 oCol;
${COMMON}
uniform vec2 uRes;
uniform float uT;
uniform vec4 uCam;
uniform vec2 uCam2;
uniform float uK;
#define NB 72
#define NS 20
uniform int uNB; uniform vec4 uB[NB]; uniform vec4 uBX[NB];
uniform int uNS; uniform vec4 uS[NS]; uniform vec4 uSX[NS];
uniform sampler2D uTex; uniform vec2 uTexSize;
uniform vec4 uL[4];
uniform vec4 uLX[4];
uniform vec4 uLM[4];
uniform vec4 uLP[4];
uniform vec4 uFl;
uniform vec4 uFlA;
uniform vec4 uFlB;
uniform vec4 uOv[3];
uniform vec4 uOvA[3];
uniform vec4 uOvB[3];
uniform vec3 uOvV;
uniform float uFloorY;
uniform float uHorizon;
uniform vec4 uRip;
uniform vec4 uSw;
uniform vec4 uKey;
uniform int uDbg;
uniform vec2 uSpot;
uniform vec4 uRing;
uniform vec4 uCrown;
uniform float uCaus;
uniform vec4 uPar;
#define NBUB 32
uniform vec4 uBub[NBUB];
uniform int uNBub;
uniform float uMbw;
uniform vec4 uLens;
uniform vec4 uLens2;

vec3 palThin(float u){ u=clamp(u,0.,1.);
  vec3 a=lin(vec3(1.00,0.74,0.30)), b=lin(vec3(1.00,0.50,0.66)), c=lin(vec3(0.84,0.52,1.00));
  return u<0.5 ? mix(a,b,u*2.0) : mix(b,c,u*2.0-1.0); }
vec3 palMid(float u){ u=clamp(u,0.,1.);
  vec3 a=lin(vec3(1.00,0.36,0.06)), b=lin(vec3(1.00,0.10,0.44)), c=lin(vec3(0.56,0.12,1.00));
  return u<0.5 ? mix(a,b,u*2.0) : mix(b,c,u*2.0-1.0); }
vec3 palDeep(float u){ u=clamp(u,0.,1.);
  vec3 a=lin(vec3(0.80,0.10,0.04)), b=lin(vec3(0.62,0.02,0.30)), c=lin(vec3(0.24,0.04,0.60));
  return u<0.5 ? mix(a,b,u*2.0) : mix(b,c,u*2.0-1.0); }

struct Fld { float m; float s; vec2 g; float u; };
void fadd(inout Fld f, float d, vec2 g, float u, float k){
  if (d < f.m){ float c = exp(-k*(f.m-d)); f.s = f.s*c+1.0; f.g = f.g*c+g; f.u = f.u*c+u; f.m = d; }
  else { float w = exp(-k*(d-f.m)); f.s += w; f.g += w*g; f.u += w*u; }
}
vec4 fres(Fld f, float k){ return vec4(f.m - log(max(f.s,1e-30))/k, f.g/max(f.s,1e-30), f.u/max(f.s,1e-30)); }

vec2 waveShape(float b, float amp, float fr, float ph, float lean){
  float s1 = sin(b*fr + ph), c1 = cos(b*fr + ph);
  float s2 = sin(b*fr*1.87 + ph*1.31 + 1.7), c2 = cos(b*fr*1.87 + ph*1.31 + 1.7);
  float s3 = sin(b*fr*3.13 - ph*0.63 + 4.1), c3 = cos(b*fr*3.13 - ph*0.63 + 4.1);
  float v = amp*(0.58*s1 + 0.30*s2 + 0.14*s3) + lean*(b-960.0);
  float d = amp*fr*(0.58*c1 + 0.30*1.87*c2 + 0.14*3.13*c3) + lean;
  return vec2(v, d);
}

vec3 floodSD(vec2 p, vec4 F, vec4 A, vec4 B){
  vec2 dir = B.xy, perp = vec2(-B.y, B.x);
  float a = dot(p, dir), b = dot(p, perp);
  vec2 f1 = waveShape(b, A.x, A.y, F.z, A.z);
  float bb = (b - B.w)/250.0; float bump = B.z*exp(-0.5*bb*bb);
  f1 += vec2(bump, -bump*bb/250.0);
  vec2 f2 = waveShape(b, A.x*0.85, A.y*0.93, F.z*0.8 + 2.3, -A.z*0.6);
  float nf = sqrt(1.0 + f1.y*f1.y), nb = sqrt(1.0 + f2.y*f2.y);
  float dF = (a - (F.x + f1.x))/nf;
  float dB = ((F.y + f2.x) - a)/nb;
  vec2 gF = (dir - f1.y*perp)/nf, gB = (-dir + f2.y*perp)/nb;
  gF = normalize(mix(gF, dir, ss(-24.0, -150.0, dF))); gB = normalize(mix(gB, -dir, ss(-24.0, -150.0, dB)));
  float k = 0.08; float m = max(dF, dB);
  float eF = exp(k*(dF - m)), eB = exp(k*(dB - m));
  return vec3(m + log(eF + eB)/k, (eF*gF + eB*gB)/(eF + eB));
}

vec4 field(vec2 p){
  Fld f = Fld(1e5, 0.0, vec2(0.0), 0.0);
  float gW[4]; float gU[4]; int gN = 0;
  for (int j=0;j<4;j++){ gW[j] = 0.0; gU[j] = 0.0; }
  float k = uK;
  for (int i=0;i<NB;i++){
    if (i>=uNB) break;
    vec4 b = uB[i]; vec4 bx = uBX[i];
    vec2 dp = p - b.xy;
    float ext = b.z*max(bx.x, 1.0/bx.x);
    if (dot(dp,dp) > (ext+140.0)*(ext+140.0)) continue;
    float ca = cos(bx.y), sa = sin(bx.y);
    vec2 q = vec2(ca*dp.x + sa*dp.y, -sa*dp.x + ca*dp.y);
    float ax = b.z*bx.x, ay = b.z/bx.x;
    vec2 qa = q/vec2(ax*ax, ay*ay);
    if (bx.z > 0.5){
      float rho = sqrt(dot(q, q/vec2(ax*ax, ay*ay)));
      gW[gN] = (1.0 - ss(0.25, 1.0, rho))*bx.w; gU[gN] = b.w; gN = min(gN+1, 3);
      continue;
    }
    float d = 0.5*b.z*(dot(q,qa) - 1.0);
    vec2 gq = b.z*qa;
    fadd(f, d, vec2(ca*gq.x - sa*gq.y, sa*gq.x + ca*gq.y), b.w, k);
  }
  for (int i=0;i<NS;i++){
    if (i>=uNS) break;
    vec4 s = uS[i]; vec4 sx = uSX[i];
    vec2 a = s.xy, ba = s.zw - s.xy, pa = p - a;
    float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-4), 0.0, 1.0);
    vec2 v = pa - ba*h; float r = max(mix(sx.x, sx.y, h), 0.3);
    float d = (dot(v,v) - r*r)/(2.0*r);
    fadd(f, d, v/r, sx.z, k);
  }
  for (int i=0;i<4;i++){
    vec4 L = uL[i]; vec4 LX = uLX[i]; vec4 LP = uLP[i];
    if (LX.w <= 0.0) continue;
    vec2 dp = p - L.xy;
    float ca = cos(LX.z), sa = sin(LX.z);
    vec2 q = vec2(ca*dp.x + sa*dp.y, -sa*dp.x + ca*dp.y) / LX.xy;
    q.x += LP.z*sin(q.y*0.021 + LP.w);
    q.y += LP.z*0.6*sin(q.x*0.017 + LP.w*1.3);
    vec2 tq = q + LP.xy;
    vec4 msk = vec4(i==0, i==1, i==2, i==3);
    vec2 e = vec2(1.0, 0.0);
    float sd = dot(texture(uTex, tq/uTexSize), msk);
    float sxp = dot(texture(uTex, (tq+e.xy)/uTexSize), msk), sxm = dot(texture(uTex, (tq-e.xy)/uTexSize), msk);
    float syp = dot(texture(uTex, (tq+e.yx)/uTexSize), msk), sym = dot(texture(uTex, (tq-e.yx)/uTexSize), msk);
    vec2 gq = vec2(sxp-sxm, syp-sym)*0.5 / LX.xy;
    float sc = sqrt(LX.x*LX.y);
    vec2 g = vec2(ca*gq.x - sa*gq.y, sa*gq.x + ca*gq.y) * sc;
    float dl = sd*sc - L.z;
    if (LX.w < 0.999){
      vec4 M = uLM[i]; vec2 eq = p - M.xy;
      float k0 = length(eq/M.zw), k1 = length(eq/(M.zw*M.zw));
      float de = k0*(k0 - 1.0)/max(k1, 1e-5);
      vec2 ge = normalize(eq/(M.zw*M.zw) + 1e-6);
      float m = smoothstep(0.0, 1.0, LX.w);
      dl = mix(de, dl, m); g = normalize(mix(ge, g, m) + 1e-6);
    }
    fadd(f, dl, g, L.w, k);
  }
  vec4 R = fres(f, k);
  for (int j=0;j<4;j++){ if (j >= gN) break; R.w = mix(R.w, gU[j], gW[j]); }
  if (uSw.w > 0.001){
    vec2 dq = (p - uSw.xy)/uSw.z; float rho = length(dq);
    if (rho < 1.25){
      float r1 = min(rho, 1.0);
      vec3 sp = vec3(dq/max(rho, 1.0), sqrt(max(0.0, 1.0 - r1*r1)));
      vec3 ax = normalize(vec3(0.35, 1.0, 0.28));
      float an = uT*0.70, ca = cos(an), sa = sin(an);
      sp = sp*ca + cross(ax, sp)*sa + ax*dot(ax, sp)*(1.0 - ca);
      vec3 nz = noised(sp.xz*1.35 + vec2(2.0, 5.0));
      vec3 nz2 = noised(sp.yx*1.1 + vec2(7.0, 1.0));
      float ph = 4.4*sp.y + 1.3*sin(3.1*sp.x + 2.2*sp.z) + 1.5*nz.x + 0.8*nz2.x;
      R.w = mix(R.w, 0.5 + 0.46*sin(ph), uSw.w*(1.0 - ss(0.82, 1.2, rho)));
    }
  }
  return R;
}

float softRect(vec2 q, vec2 hs, float soft){
  vec2 d = abs(q) - hs;
  float o = length(max(d,0.0)) + min(max(d.x,d.y),0.0);
  return 1.0 - ss(-soft, soft, o);
}
vec3 env(vec3 r){
  vec3 c = lin(vec3(0.10,0.03,0.12))*0.5;
  float up = clamp(-r.y, 0.0, 1.0), dn = clamp(r.y, 0.0, 1.0);
  c += lin(vec3(0.60,0.40,0.75))*0.55*up*up;
  c += lin(vec3(1.0,0.30,0.32))*0.32*ss(0.2,0.95,dn);
  float zf = max(r.z, 0.06);
  vec2 q = r.xy/zf;
  vec2 kq = q - uKey.xy;
  float kb = softRect(kq, vec2(0.60,0.36), 0.10);
  c += lin(vec3(1.0,0.97,0.93))*30.0*kb*(0.75 + 0.25*ss(0.36,-0.36,kq.y));
  c += lin(vec3(1.0,0.90,0.95))*12.0*softRect(q - vec2(0.95,-1.25), vec2(0.20,0.14), 0.07);
  c += lin(vec3(1.0,0.80,0.92))*14.0*softRect(q - vec2(1.55,-0.05), vec2(0.07,1.3), 0.04);
  c += lin(vec3(1.0,0.80,0.70))*4.0*softRect(q - vec2(-1.7,0.7), vec2(0.08,0.45), 0.08);
  float gr = pow(1.0 - clamp(r.z,0.0,1.0), 4.0);
  vec2 rd = normalize(r.xy + 1e-5);
  c += gr*(lin(vec3(1.0,0.72,0.70))*1.1*ss(0.2,-0.9,rd.x+rd.y) + lin(vec3(1.0,0.38,0.70))*0.9*ss(0.5,1.0,rd.x));
  return c;
}

vec4 shadeLiquid(vec2 p, vec4 F, float deepNoise, float mirror){
  float D = F.x; vec2 gD = F.yz; float u = F.w;
  float gl = max(length(gD), 0.2);
  float cov = clamp(0.5 - D/gl, 0.0, 1.0);
  if (cov <= 0.0) return vec4(0.0);
  const float R = 95.0, Hc = 210.0;
  float x = max(-D, 0.0);
  float h0 = sqrt(2.0*R*x + 2.0*R*0.6);
  float th = tanh(h0/Hc);
  float h = Hc*th;
  float dhdx = (1.0 - th*th)*R/h0;
  vec2 gh = -dhdx*gD;
  float deep = ss(90.0, 320.0, x)*deepNoise;
  float du = 0.0, sheen = 0.0;
  if (deep > 0.001){
    vec2 q = p*0.00118 + vec2(uT*0.085, -uT*0.04);
    vec3 w1 = noised(q*0.8 + vec2(1.3, 4.1));
    vec3 w2 = noised(q + 1.25*w1.yz + vec2(uT*0.06, 2.0));
    vec3 m = noised(q*1.15 + 1.8*w2.yz + vec2(5.2, 1.1));
    float ph = 6.2*m.x + 1.8*w1.x;
    float band = sin(ph);
    vec2 gph = (6.2*m.yz*1.15 + 1.8*w1.yz*0.8)*0.00118;
    float A = 26.0*deep;
    h += A*(0.5 + 0.5*band);
    gh += A*0.5*cos(ph)*gph;
    float vein = ss(0.35, 0.8, band) - ss(-0.35, -0.8, band);
    float fl = 1.0 - 0.85*ss(4.08, 4.16, uT)*(1.0 - ss(4.5, 4.62, uT));
    du = deep*(0.40*vein + 0.10*w2.x);
    h -= (1.0 - fl)*A*(0.5 + 0.5*band); gh -= (1.0 - fl)*A*0.5*cos(ph)*gph;
    sheen = deep*fl;
  }
  if (mirror > 0.5 && mirror < 1.5) gh.y = -gh.y;
  float ovl = step(1.5, mirror);
  vec3 n = normalize(vec3(-gh, 1.0));
  float uu = u + du;
  vec3 body = mix(palThin(uu), palMid(uu), ss(0.0, 5.0, x));
  body = mix(body, palDeep(uu), ss(40.0, 260.0, x)*mix(0.55, 0.22, ss(200.0, 400.0, x)));
  vec3 L = normalize(vec3(-0.55, -0.7, 0.62));
  float ndl = dot(n, L);
  float side = 1.0 - n.z;
  vec3 col = body*(0.26 + 0.50*(0.5 + 0.5*ndl))*(0.50 + 0.50*n.z);
  vec2 l2 = normalize(L.xy);
  float away = dot(normalize(n.xy + 1e-6), -l2);
  float trans = pow(max(away, 0.0), 1.2)*ss(0.10, 0.50, side)*(1.0 - 0.85*ss(0.70, 1.0, side));
  col += (palMid(uu)*1.4 + palThin(uu)*0.3)*trans*1.0;
  col += palMid(uu)*exp(-x/3.0)*0.22;
  vec3 V = vec3(0,0,1);
  vec3 r = reflect(-V, n);
  float fr = 0.04 + 0.96*pow(1.0 - clamp(n.z,0.0,1.0), 5.0);
  vec3 e = env(r);
  float frc = mix(fr, min(fr, 0.05), ovl*ss(30.0, 48.0, x));
  col = col*(1.0 - frc) + e*frc;
  if (sheen > 0.0){
    vec3 Lb = normalize(vec3(-0.16, -0.22, 1.0));
    float sb = pow(max(dot(r, Lb), 0.0), 380.0);
    vec3 Lc = normalize(vec3(0.20, 0.10, 1.0));
    float sc = pow(max(dot(r, Lc), 0.0), 600.0);
    col += (lin(vec3(1.0,0.93,0.95))*sb*2.2 + lin(vec3(1.0,0.80,0.90))*sc*1.2)*sheen;
  }
  vec3 Ls = normalize(vec3(-0.46, -0.62, 0.64));
  float sp = pow(max(dot(r, Ls), 0.0), 900.0);
  col += vec3(1.0,0.97,0.94)*sp*22.0;
  float gb = (p.x*0.8 - p.y*0.6) - uKey.z;
  col += vec3(1.0,0.95,0.98)*uKey.w*exp(-gb*gb/(2.0*34.0*34.0))*ss(0.35,0.75,side)*(1.0-ss(0.9,1.0,side))*1.1;
  return vec4(col, cov);
}

vec3 backdrop(vec2 p){
  vec2 p0 = p; p += uPar.xy;
  float y = p.y/1080.0;
  vec3 top = lin(vec3(0.070,0.018,0.090));
  vec3 hor = lin(vec3(0.205,0.058,0.235));
  vec3 c = mix(top, hor, ss(0.0, uHorizon/1080.0, y));
  vec2 d = (p - vec2(960.0, 500.0) - uPar.zw)/vec2(1050.0, 620.0);
  c += lin(vec3(0.34,0.10,0.35))*0.55*uSpot.x*exp(-dot(d,d)*1.6);
  vec2 dh = (p0 - vec2(960.0, 470.0))/vec2(620.0, 300.0);
  c += lin(vec3(0.62,0.16,0.42))*0.42*uSpot.y*exp(-dot(dh,dh)*2.2);
  if (uRing.w > 0.001){
    float rl = length((p0 - uRing.xy)*vec2(1.0, 1.18));
    float e = (rl - uRing.z)/120.0;
    c += lin(vec3(1.0,0.58,0.66))*uRing.w*(1.5*exp(-e*e) + 0.14*ss(uRing.z + 60.0, 0.0, rl));
  }
  if (uCrown.w > 0.001){
    float x = p0.x - uCrown.x, hw = 540.0, ax = abs(x)/hw;
    if (ax < 1.0){
      float env = 1.0 - ax*ax, h = 0.40 + 0.08*sin(x*0.011 + 1.7), bead = 0.0;
      float up = clamp((uCrown.y - p0.y)/max(uCrown.z, 1.0), 0.0, 1.5);
      for (int k=0;k<7;k++){
        float fk = float(k), hk = fract(sin(fk*12.9898 + 4.1)*43758.5453);
        float xk = -450.0 + fk*150.0 + (hk - 0.5)*70.0;
        float wk = 20.0 + 18.0*fract(hk*7.13);
        float ak = (0.5 + 0.5*hk)*(1.0 - pow(abs(xk)/hw, 2.0));
        float g = ak*exp(-pow((x - xk - xk*0.2*up)/(wk*(1.0 + 1.6*max(0.0, 0.35 - up))), 2.0));
        h = h + g - h*g;
        vec2 bc = vec2(xk*(1.0 + 0.2*ak), uCrown.y - uCrown.z*ak - 16.0 - 40.0*(1.0 - uCrown.w));
        if (hk > 0.3) bead = max(bead, ss(7.0 + 5.0*hk, 4.5 + 5.0*hk, length(vec2(x, p0.y) - bc)));
      }
      float top = uCrown.y - uCrown.z*env*h;
      float sd = top - p0.y;
      float body = ss(1.2, -1.2, sd)*ss(uCrown.y + 30.0, uCrown.y - 40.0, p0.y);
      float depth = clamp((p0.y - top)/max(uCrown.z*0.5, 1.0), 0.0, 1.0);
      vec3 trans = mix(lin(vec3(1.0,0.74,0.50))*1.5, lin(vec3(0.80,0.14,0.42))*0.55, pow(depth, 0.45));
      c = mix(c, trans, max(body*mix(0.62, 0.30, depth), bead*0.8)*uCrown.w);
      c += lin(vec3(1.0,0.90,0.84))*1.3*exp(-sd*sd/10.0)*uCrown.w*env;
    }
  }
  return c;
}
vec3 floorCol(vec2 p){
  vec2 p0 = p; p += uPar.xy*0.6;
  float yy = (p.y - uHorizon)/(1080.0 - uHorizon);
  vec3 near = lin(vec3(0.034,0.009,0.044));
  vec3 far = lin(vec3(0.165,0.046,0.188));
  vec3 c = mix(far, near, pow(clamp(yy,0.0,1.0), 0.55));
  vec2 d = (p - vec2(960.0, uHorizon + 30.0))/vec2(950.0, 150.0);
  c += lin(vec3(0.32,0.09,0.32))*0.30*uSpot.x*exp(-dot(d,d)*1.5);
  if (uRing.w > 0.001){
    float rl = length((p0 - vec2(uRing.x, uFloorY))*vec2(1.0, 3.6));
    float e = (rl - uRing.z)/140.0;
    c += lin(vec3(1.0,0.56,0.64))*uRing.w*(0.8*exp(-e*e) + 0.12*ss(uRing.z + 60.0, 0.0, rl));
  }
  return c;
}
float ripRings(vec2 p){
  if (uRip.w <= 0.0) return 0.0;
  vec2 rd = (p - uRip.xy)*vec2(1.0, 4.6);
  float rr = length(rd), ring = 0.0;
  for (int k=0;k<2;k++){
    float fk = uRip.z*470.0*(1.0 - 0.12*float(k)) - float(k)*22.0;
    if (fk > 0.0) ring += exp(-pow((rr-fk)/(2.6+fk*0.008), 2.0))*exp(-fk/380.0)*(1.0-0.3*float(k));
  }
  return ring*uRip.w*ss(952.0, 905.0, p.y);
}

vec4 bubbleLayer(vec2 p, float u){
  vec3 bc = vec3(0.0); float ba = 0.0;
  for (int i=0;i<NBUB;i++){
    if (i >= uNBub) break;
    vec4 b = uBub[i];
    vec2 d = (p - b.xy)/b.z;
    float rr = length(d);
    if (rr > 1.6) continue;
    float rim = ss(0.55, 0.95, rr)*(1.0 - ss(0.95, 1.25, rr));
    float pip = exp(-dot(d - vec2(-0.35,-0.38), d - vec2(-0.35,-0.38))*22.0);
    bc += (palThin(u)*1.2*rim + vec3(1.0,0.97,0.95)*pip*2.4)*b.w;
    ba = max(ba, (0.55*rim + pip)*b.w);
  }
  return vec4(bc, ba);
}

void main(){
  vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = (sp - 0.5*uRes)/uCam.x + uCam.yz + uCam2;
  vec4 F = field(p);
  vec3 col;
  float hzc = uHorizon - 42.0*pow((p.x - 960.0)/980.0, 2.0);
  float hb = ss(-85.0, 65.0, p.y - hzc);
  col = mix(backdrop(p), floorCol(p), hb);
  vec2 so = vec2(24.0, 32.0);
  vec4 Fs = field(p - so);
  float sh = ss(26.0, -34.0, Fs.x);
  col *= 1.0 - 0.50*sh;
  float ca = ss(-8.0, -60.0, Fs.x);
  col += palMid(Fs.w)*0.075*ca + palThin(Fs.w)*0.05*ss(-30.0,-110.0,Fs.x);
  if (uCaus > 0.001){
    float wy = hzc - p.y;
    float reg = ss(-40.0, 50.0, wy)*exp(-max(wy, 0.0)/260.0)*exp(-pow((p.x - 960.0)/820.0, 2.0));
    if (reg > 0.002){
      vec2 cq = vec2(p.x*0.0046, (p.y - uHorizon)*0.0105);
      vec3 c1 = noised(cq + vec2(uT*0.42, -uT*0.33));
      vec3 c2 = noised(cq*1.9 + c1.yz*0.55 + vec2(-uT*0.37, uT*0.45));
      float web = pow(1.0 - abs(c2.x), 4.0)*(0.55 + 0.45*c1.x);
      col += lin(vec3(1.0,0.60,0.80))*web*reg*uCaus*0.09;
    }
  }
  if (p.y > uHorizon){
    float ring = ripRings(p);
    col += lin(vec3(1.0,0.66,0.82))*ring*0.55*exp(-uRip.z*2.2);
  }
  if (p.y > uFloorY){
    float dy = p.y - uFloorY;
    vec2 pm = vec2(p.x, 2.0*uFloorY - p.y);
    if (uRip.w > 0.0){
      vec2 rd = (p - uRip.xy)*vec2(1.0, 4.6);
      float rr = length(rd);
      float w = exp(-pow((rr - uRip.z*470.0)/50.0, 2.0))*uRip.w*exp(-uRip.z*1.6);
      pm.x += w*12.0*sin(rr*0.08); pm.y += w*9.0*cos(rr*0.08);
    }
    vec4 Fm = field(pm);
    vec4 lm = shadeLiquid(pm, Fm, 1.0, 1.0);
    float fade = exp(-dy/80.0)*0.50*ss(170.0, 90.0, dy);
    col = mix(col, lm.rgb*0.75, lm.a*fade);
  }
  {
    vec4 Fc = field(vec2(p.x, uFloorY - 3.0));
    float cont = ss(4.0, -10.0, Fc.x)*exp(-abs(p.y - uFloorY)/7.0);
    col *= 1.0 - 0.65*cont;
  }
  float hl = exp(-abs(p.y - hzc)/34.0)*ss(0.0, 800.0, 980.0-abs(p.x-960.0));
  col += lin(vec3(0.60,0.30,0.62))*hl*0.035;
  vec4 L = shadeLiquid(p, F, 1.0, 0.0);
  if (L.a > 0.0 && uNBub > 0){ vec4 bb = bubbleLayer(p, F.w); L.rgb = L.rgb*(1.0 - 0.35*bb.a) + bb.rgb*0.8; }
  if (uLens2.w > 0.0 && L.a > 0.0){
    vec2 q = (p - uLens.xy)/uLens.zw;
    float rq = length(q);
    if (rq < 0.95){
      float pxs = uLens2.z/(uLens.z*uCam.x);
      vec2 sw = vec2(sin(uT*11.0 + 0.7), cos(uT*8.3))*3.0*pxs;
      vec2 tq = uLens2.xy - q*(1.0 + 0.48*rq*rq)*uLens2.z/1.12 + sw;
      vec2 rdir = q/max(rq, 1e-3)*pxs*(0.6 + 1.6*rq);
      vec4 tA = texture(uTex, (tq + rdir)/uTexSize), tB = texture(uTex, tq/uTexSize), tC = texture(uTex, (tq - rdir)/uTexSize);
      vec3 sd3 = vec3(min(min(tA.r, tA.g), min(tA.b, tA.a)), min(min(tB.r, tB.g), min(tB.b, tB.a)), min(min(tC.r, tC.g), min(tC.b, tC.a)));
      float soft = 1.4*pxs*(1.0 + 0.6*rq);
      vec3 ink = vec3(ss(soft, -soft, sd3.x), ss(soft, -soft, sd3.y), ss(soft, -soft, sd3.z))*(1.0 - ss(0.55, 0.9, rq));
      vec3 tint = lin(vec3(1.0, 0.741, 0.302));
      float lum = dot(L.rgb, vec3(0.3, 0.55, 0.15));
      vec3 tgt = mix(L.rgb, L.rgb*0.35 + tint*(0.55 + 1.2*lum)*(1.25 - 0.45*rq), 0.6);
      L.rgb = mix(L.rgb, tgt, ink*uLens2.w);
    }
  }
  col = mix(col, L.rgb, L.a);
  for (int i=0;i<3;i++){
    if (uOv[i].w < 0.5) continue;
    float bw = max(i==2 ? 3.0 : (i==1 ? 5.0 : 8.0), uOvV[i]*uCam.x*uMbw*1.7);
    vec3 fsd = floodSD(p - so*1.4, uOv[i], uOvA[i], uOvB[i]);
    col *= 1.0 - 0.55*ss(30.0 + bw*0.5, -40.0 - bw*0.5, fsd.x);
    vec3 fd = floodSD(p, uOv[i], uOvA[i], uOvB[i]);
    float ca2 = ss(bw*0.5, -bw*0.5, fd.x*uCam.x);
    if (ca2 <= 0.0) continue;
    vec4 O = shadeLiquid(p, vec4(min(fd.x/(1.0 + 0.12*bw/uCam.x), -0.6), fd.yz, uOvA[i].w), 0.0, 2.0);
    {
      float inner = ss(50.0, 240.0, -fd.x);
      if (inner > 0.0){
        float sy = clamp((p.y - uCam.z + 540.0/uCam.x)/(1080.0/uCam.x), 0.0, 1.0);
        float uo = uOvA[i].w;
        vec3 lf = mix(palThin(uo)*1.05, palDeep(uo)*0.42, ss(0.0, 1.0, sy));
        float shf = 0.0;
        for (int k=0;k<4;k++){ float fk = float(k); float xk = 260.0 + 470.0*fk + 70.0*sin(uT*0.6 + fk*1.9);
          float dd = (p.x + (p.y - 200.0)*0.34 - xk)/(40.0 + 26.0*fract(fk*0.37)); shf += exp(-dd*dd)*(0.6 + 0.4*sin(uT*1.4 + fk*2.3)); }
        lf += palThin(uo)*shf*0.42*(1.0 - 0.75*sy);
        O.rgb = mix(O.rgb, lf, inner*0.72);
      }
    }
    float mw = 3.4 + 0.5*bw/uCam.x;
    float men = exp(-pow((fd.x + 7.0 + 0.3*bw/uCam.x)/mw, 2.0))*(3.4/mw);
    O.rgb += (palThin(uOvA[i].w)*1.1 + lin(vec3(1.0,0.94,0.96))*0.75)*men;
    if (F.x < -3.0){
      float xin = -F.x;
      vec2 gn = F.yz/max(length(F.yz), 1e-3);
      float edge = exp(-xin/16.0);
      vec3 nb = normalize(vec3(gn*(0.25 + 1.5*edge), 1.0));
      vec2 kd = normalize(vec2(-0.55, -0.7));
      float coreK = ss(4.0, 46.0, xin)*(0.62 + 0.38*dot(-gn, -kd)*(1.0 - edge));
      vec3 bodyC = mix(palDeep(F.w)*0.55, palThin(F.w)*1.9 + lin(vec3(1.0,0.72,0.45))*0.5, coreK);
      vec2 pr = p - nb.xy*25.0;
      float shr = 0.0;
      for (int k=0;k<4;k++){ float fk = float(k); float xk = 260.0 + 470.0*fk + 70.0*sin(uT*0.6 + fk*1.9);
        float dd = (pr.x + (pr.y - 200.0)*0.34 - xk)/(40.0 + 26.0*fract(fk*0.37)); shr += exp(-dd*dd); }
      bodyC += palThin(F.w)*shr*0.5;
      float cb = ss(-1.0, -4.0, F.x);
      float rim = exp(-pow((F.x + 2.0)/1.2, 2.0));
      vec3 rb = reflect(vec3(0.0,0.0,-1.0), nb);
      float spk = pow(max(dot(rb, normalize(vec3(-0.5, -0.62, 0.6))), 0.0), 220.0);
      O.rgb = mix(O.rgb, bodyC, cb*0.88) + palThin(F.w)*rim*0.45 + lin(vec3(1.0,0.96,0.94))*spk*3.0*cb;
    }
    if (uNBub > 0){ vec4 bb = bubbleLayer(p, uOvA[i].w); O.rgb = O.rgb*(1.0 - 0.35*bb.a) + bb.rgb*0.55; }
    col = mix(col, O.rgb, ca2);
  }
  oCol = vec4(col, 1.0);
}`;

  const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
${COMMON}
uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){
  vec3 c = vec3(0.0);
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) c += texture(uSrc, vUv + vec2(i,j)*uTexel).rgb;
  c /= 9.0;
  float l = max(max(c.r,c.g),c.b);
  vec3 b = c*ss(0.85, 2.2, l);
  o = vec4(b, 1.0);
}`;

  const FS_POST = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
${COMMON}
uniform sampler2D uHdr; uniform sampler2D uBloom; uniform sampler2D uType;
uniform vec2 uRes; uniform float uFrame; uniform float uBloomAmt; uniform float uFlash;
vec3 bloomAt(vec2 uv){
  vec3 b = vec3(0.0);
  float w = 0.0;
  for (int l=1;l<7;l++){
    float lf = float(l);
    vec2 px = exp2(lf)/vec2(960.0,540.0);
    vec3 s = textureLod(uBloom, uv + px*vec2(0.5,0.5), lf).rgb + textureLod(uBloom, uv + px*vec2(-0.5,0.5), lf).rgb
           + textureLod(uBloom, uv + px*vec2(0.5,-0.5), lf).rgb + textureLod(uBloom, uv + px*vec2(-0.5,-0.5), lf).rgb;
    float wl = 1.0/(1.0+lf*0.6);
    b += s*0.25*wl; w += wl;
  }
  return b/w;
}
vec3 tonemap(vec3 x){
  float m = max(max(x.r,x.g),x.b);
  float k = 0.72;
  float mt = m < k ? m : k + (1.0-k)*(1.0 - exp(-(m-k)/(1.0-k)));
  vec3 c = x*(mt/max(m,1e-5));
  float wh = ss(1.0, 6.0, m);
  return mix(c, vec3(mt), wh*0.85);
}
void main(){
  vec3 hdr = texture(uHdr, vUv).rgb;
  hdr += bloomAt(vUv)*uBloomAmt;
  hdr *= exp2(uFlash);
  vec3 c = tonemap(hdr);
  vec2 q = vUv - 0.5; q.x *= uRes.x/uRes.y;
  c *= 1.0 - 0.28*ss(0.35, 1.05, length(q));
  vec3 s = pow(max(c,0.0), vec3(1.0/2.2));
  vec4 ty = texture(uType, vec2(vUv.x, 1.0-vUv.y));
  s = s*(1.0-ty.a) + ty.rgb;
  vec2 fc = gl_FragCoord.xy;
  float g = hash12(fc + uFrame*vec2(37.1, 91.7)) + hash12(fc*1.37 + uFrame*vec2(11.3, 53.9)) - 1.0;
  float lum = dot(s, vec3(0.299,0.587,0.114));
  s += g*(0.030*(1.0-lum)*ss(0.0,0.25,lum) + 0.012);
  o = vec4(s, 1.0);
}`;

  // ================= 3. WebGL2 HDR + Bloom Engine (engine.js) =================
  const NB = 72, NS = 20;
  function compileSh(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function createProg(gl, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileSh(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compileSh(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), u = {};
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  function createTex(gl, w, h, ifmt, fmt, type, filter, data = null, mips = false) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function createFbo(gl, t) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
  }

  function createWebGLEngine(W, H) {
    const glCanvas = document.createElement('canvas');
    glCanvas.width = W;
    glCanvas.height = H;
    const gl = glCanvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: false,
      premultipliedAlpha: false
    });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    gl.getExtension('OES_texture_float_linear');

    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const P = {
      scene: createProg(gl, FS_SCENE),
      bright: createProg(gl, FS_BRIGHT),
      post: createProg(gl, FS_POST)
    };
    const hdrT = createTex(gl, W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    const hdrF = createFbo(gl, hdrT);
    const bw = Math.floor(W / 2), bh = Math.floor(H / 2);
    const brT = createTex(gl, bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, null, true);
    const brF = createFbo(gl, brT);
    gl.bindTexture(gl.TEXTURE_2D, brT);
    gl.generateMipmap(gl.TEXTURE_2D);
    const typeT = createTex(gl, W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    let sdfT = null, sdfSize = [1, 1];

    const bufB = new Float32Array(NB * 4), bufBX = new Float32Array(NB * 4);
    const bufS = new Float32Array(NS * 4), bufSX = new Float32Array(NS * 4);

    function setSDF(sdf) {
      const h = toHalf();
      const n = sdf.W * sdf.H * 4;
      const hd = new Uint16Array(n);
      for (let i = 0; i < n; i++) hd[i] = h(sdf.data[i]);
      sdfT = createTex(gl, sdf.W, sdf.H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, hd);
      sdfSize = [sdf.W, sdf.H];
    }

    function drawScene(S) {
      const { p, u } = P.scene;
      gl.useProgram(p);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uT, S.t);
      gl.uniform4f(u.uCam, S.cam.zoom, S.cam.px, S.cam.py, 0);
      gl.uniform2f(u.uCam2, S.cam.ox, S.cam.oy);
      gl.uniform1f(u.uK, S.k);
      gl.uniform1i(u.uDbg, S.dbg || 0);
      gl.uniform2f(u.uSpot, S.spot ?? 1, S.halo || 0);
      bufB.fill(0); bufBX.fill(0); bufS.fill(0); bufSX.fill(0);
      const nb = Math.min(NB, S.balls.length);
      for (let i = 0; i < nb; i++) {
        const b = S.balls[i];
        bufB.set([b.x, b.y, Math.max(0.01, b.r), b.u], i * 4);
        bufBX.set([b.s || 1, b.a || 0, b.ghost ? 1 : 0, b.amt ?? 1], i * 4);
      }
      const ns = Math.min(NS, S.segs.length);
      for (let i = 0; i < ns; i++) {
        const s = S.segs[i];
        bufS.set([s.ax, s.ay, s.bx, s.by], i * 4);
        bufSX.set([s.ra, s.rb, s.u, 0], i * 4);
      }
      gl.uniform1i(u.uNB, nb); gl.uniform4fv(u.uB, bufB); gl.uniform4fv(u.uBX, bufBX);
      gl.uniform1i(u.uNS, ns); gl.uniform4fv(u.uS, bufS); gl.uniform4fv(u.uSX, bufSX);
      const L = new Float32Array(16), LX = new Float32Array(16), LP = new Float32Array(16), LM = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        const l = S.letters[i];
        if (!l) continue;
        L.set([l.x, l.y, l.grow, l.u], i * 4);
        LX.set([l.sx, l.sy, l.a || 0, l.on ? (l.m ?? 1) : 0], i * 4);
        LM.set(l.ell || [0, 0, 1, 1], i * 4);
        LP.set([l.px, l.py, l.wob || 0, l.wph || 0], i * 4);
      }
      gl.uniform4fv(u.uL, L); gl.uniform4fv(u.uLM, LM); gl.uniform4fv(u.uLX, LX); gl.uniform4fv(u.uLP, LP);
      gl.uniform2f(u.uTexSize, sdfSize[0], sdfSize[1]);
      const fl = S.flood;
      gl.uniform4f(u.uFl, fl.front, fl.back, fl.phase, fl.on ? 1 : 0);
      gl.uniform4f(u.uFlA, fl.amp, fl.freq, fl.lean, fl.u);
      gl.uniform4f(u.uFlB, fl.dx ?? 1, fl.dy ?? 0, fl.bump || 0, fl.bumpC || 0);
      const ov = new Float32Array(12), ova = new Float32Array(12), ovb = new Float32Array(12), ovv = [0, 0, 0];
      S.overlays.forEach((o, i) => {
        ov.set([o.front, o.back, o.phase, o.on ? 1 : 0], i * 4);
        ova.set([o.amp, o.freq, o.lean, o.u], i * 4);
        ovb.set([o.dx ?? 1, o.dy ?? 0, o.bump || 0, o.bumpC || 0], i * 4);
        ovv[i] = o.vel || 0;
      });
      gl.uniform4fv(u.uOv, ov); gl.uniform4fv(u.uOvA, ova); gl.uniform4fv(u.uOvB, ovb);
      gl.uniform3f(u.uOvV, ovv[0], ovv[1], ovv[2]);
      const bb = new Float32Array(32 * 4);
      const nbb = Math.min(32, (S.bubbles || []).length);
      for (let i = 0; i < nbb; i++) bb.set(S.bubbles[i], i * 4);
      gl.uniform4fv(u.uBub, bb); gl.uniform1i(u.uNBub, nbb);
      gl.uniform1f(u.uFloorY, S.floorY); gl.uniform1f(u.uHorizon, S.horizon);
      gl.uniform4f(u.uRip, S.rip.x, S.rip.y, S.rip.age, S.rip.amp);
      if (u.uMbw) gl.uniform1f(u.uMbw, S.mbw || 0);
      const ln = S.lens || [0, 0, 1, 1, 0, 0, 1, 0];
      if (u.uLens) {
        gl.uniform4f(u.uLens, ln[0], ln[1], ln[2], ln[3]);
        gl.uniform4f(u.uLens2, ln[4], ln[5], ln[6], ln[7]);
      }
      const sw = S.sw || [0, 0, 1, 0];
      if (u.uSw) gl.uniform4f(u.uSw, sw[0], sw[1], sw[2], sw[3]);
      const r = S.ring || [0, 0, 0, 0];
      if (u.uRing) gl.uniform4f(u.uRing, r[0], r[1], r[2], r[3]);
      const c = S.crown || [0, 0, 0, 0];
      if (u.uCrown) gl.uniform4f(u.uCrown, c[0], c[1], c[2], c[3]);
      const q = S.par || [0, 0, 0, 0];
      if (u.uPar) gl.uniform4f(u.uPar, q[0], q[1], q[2], q[3]);
      if (u.uCaus) gl.uniform1f(u.uCaus, S.caus || 0);
      gl.uniform4f(u.uKey, S.key.x, S.key.y, S.key.glint, S.key.glintAmp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sdfT);
      gl.uniform1i(u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function render(S, typeCanvas) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, hdrF);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawScene(S);

      // Bright pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, brF);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(P.bright.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrT);
      gl.uniform1i(P.bright.u.uSrc, 0);
      gl.uniform2f(P.bright.u.uTexel, 1 / W, 1 / H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, brT);
      gl.generateMipmap(gl.TEXTURE_2D);

      // Post tonemap + bloom + typography + grain
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      const pp = P.post;
      gl.useProgram(pp.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrT);
      gl.uniform1i(pp.u.uHdr, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, brT);
      gl.uniform1i(pp.u.uBloom, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, typeT);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, typeCanvas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.uniform1i(pp.u.uType, 2);
      gl.uniform2f(pp.u.uRes, W, H);
      gl.uniform1f(pp.u.uFrame, S.frame);
      gl.uniform1f(pp.u.uBloomAmt, S.bloom);
      gl.uniform1f(pp.u.uFlash, S.flash || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.finish();
    }

    return { glCanvas, setSDF, render };
  }

  // ================= 4. Exact 07-liquid Choreography (scene.js) =================
  const CUES = {
    pour_snap: 0.167,
    landings: [
      { id: 'P1', t: 0.4, x: 640, size: 1.0, u: 0.05 },
      { id: 'P2', t: 0.8, x: 1250, size: 0.85, u: 0.62 },
      { id: 'P3', t: 1.2, x: 405, size: 0.8, u: 0.95 },
      { id: 'P4', t: 1.6, x: 960, size: 1.35, u: 0.36 }
    ],
    merges: [2.0, 2.4, 2.8],
    leap: 3.2,
    thread_snap: 3.433,
    apex: 3.6,
    reveal_start: 4.55,
    logo_snap: 6.4,
    letter_bridge_snap: 6.417,
    glint: 7.2,
    drip_land: 8.4
  };

  function createFilmState(word) {
    const R = rng(20260927);
    const rr = (a, b) => a + (b - a) * R();
    const FY = 872, HOR = 786, G = 5000;

    const CAM = [
      [-0.5, 5.4, 640, 382], [0.0, 5.3, 640, 398], [0.167, 4.9, 640, 452], [0.30, 3.8, 642, 690], [0.42, 3.3, 648, 800],
      [0.8, 2.6, 1010, 832], [1.2, 2.15, 745, 812],
      [1.7, 1.6, 880, 758], [2.4, 1.64, 925, 764], [3.05, 1.72, 960, 764], [3.6, 1.46, 960, 590],
      [4.0, 1.42, 960, 640], [4.6, 1.2, 960, 560], [5.0, 1.13, 960, 548], [5.9, 1.0, 960, 540], [8.0, 1.0, 960, 540],
      [10.0, 1.0, 960, 540], [10.5, 1.0, 960, 540]
    ];

    function camAt(t) {
      let i = 1;
      while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++;
      const k0 = CAM[i - 1], k1 = CAM[i], k2 = CAM[i + 1], k3 = CAM[i + 2];
      const u = Math.min(1, Math.max(0, (t - k1[0]) / (k2[0] - k1[0])));
      const out = [];
      for (let c = 1; c < 4; c++) {
        const m1 = (k2[c] - k0[c]) / (k2[0] - k0[0]) * (k2[0] - k1[0]);
        const m2 = (k3[c] - k1[c]) / (k3[0] - k1[0]) * (k2[0] - k1[0]);
        const u2 = u * u, u3 = u2 * u;
        out.push((2 * u3 - 3 * u2 + 1) * k1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[c] + (u3 - u2) * m2);
      }
      return out;
    }

    function ball(S, x, y, r, u, sv = 1, ang = PI / 2) {
      if (r > 0.3) S.balls.push({ x, y, r, u, s: sv, a: ang });
    }
    function seg(S, ax, ay, bx, by, ra, rb, u) {
      if (Math.max(ra, rb) > 0.35) S.segs.push({ ax, ay, bx, by, ra, rb, u });
    }

    function makeDroplet(o) {
      o.fy = o.fy ?? 0;
      o.r *= 1 + o.fy / 180;
      const dy = FY + o.fy - o.r - o.y0;
      const tf = (o.vy + Math.sqrt(o.vy * o.vy + 2 * G * dy)) / G;
      o.tHit = o.tEmit + tf;
      o.xHit = o.x0 + o.vx * tf;
      o.melt = o.melt ? o.melt(o.xHit, o.tHit) : false;
      o.vHit = -o.vy + G * tf;
      return o;
    }

    function emitDroplet(S, d, t) {
      const grow = d.tGrow ?? 0.066;
      if (t < d.tEmit - grow) return;
      let r = d.r;
      if (t < d.tEmit) {
        const k = inv(d.tEmit - grow, d.tEmit, t);
        r *= 0.4 + 0.6 * k;
        ball(S, d.x0, d.y0 + (1 - k) * 10, r, d.u, 1);
        return;
      }
      if (t < d.tHit) {
        const tt = t - d.tEmit;
        const x = d.x0 + d.vx * tt, y = d.y0 - d.vy * tt + 0.5 * G * tt * tt;
        const vx = d.vx, vy = -d.vy + G * tt, sp = Math.hypot(vx, vy);
        const sv = 1 + Math.min(0.45, sp / 5200);
        const ang = Math.atan2(vy, vx);
        ball(S, x, y, r, d.u, sv, ang);
        return;
      }
      const tl = t - d.tHit;
      if (d.melt) {
        r *= 1 - smooth(inv(0, 0.12, tl));
        if (r < 0.5) return;
      }
      if (d.absorb !== undefined && t > d.absorb) r *= 1 - smooth(inv(d.absorb, d.absorb + 0.12, t));
      if (r < 0.5) return;
      const sv = 1.25 + (0.62 - 1.25) * spring(tl, 7, 0.38);
      let x = d.xHit;
      if (d.follow) x += d.follow(t);
      ball(S, x, FY + d.fy - r * sv + 0.5, r, d.u, sv);
    }

    const drops = [
      { id: 'P1', x: 640, r: 56, u: 0.05, tLand: CUES.landings[0].t, z: 0.5 },
      { id: 'P2', x: 1250, r: 46, u: 0.62, tLand: CUES.landings[1].t, z: 0.5 },
      { id: 'P3', x: 405, r: 42, u: 0.95, tLand: CUES.landings[2].t, z: 0.5 },
      { id: 'P4', x: 960, r: 74, u: 0.36, tLand: CUES.landings[3].t, z: 0.62 }
    ];
    const SV_PUD = 0.5;
    const svLand = (d, tl) => {
      const s = 1.3 + (SV_PUD - 1.3) * spring(tl + 1.3 / 30, 6, d.z);
      return s < SV_PUD ? SV_PUD - (SV_PUD - s) * 0.45 : s;
    };
    const TEN_T = 0.27;
    const tendrils = drops.map((d) => {
      const big = d.id === 'P4', n = big ? 7 : 5, out = [];
      for (let k = 0; k < n; k++) {
        const c = (k / (n - 1)) * 2 - 1 + rr(-0.07, 0.07);
        const ang = c * 0.95 + rr(-0.12, 0.12);
        const L = d.r * (0.9 + 0.5 * Math.abs(c)) * rr(0.72, 1.22) * (big ? 1.08 : 1);
        const tDet = 0.07 + rr(0, 1.1 / 30) + 0.02 * Math.abs(c);
        out.push({ c, ang, L, tDet, rb: d.r * rr(0.1, 0.135) * rr(0.6, 1.4) });
      }
      return out;
    });

    function tendrilState(d, w, tl) {
      if (tl < 0 || tl > TEN_T) return null;
      const sv = svLand(d, tl), ax = d.r / sv, ay = d.r * sv, cy = FY - ay + 1;
      const bx = d.x + w.c * ax * 0.46;
      const by = cy - ay * Math.sqrt(Math.max(0, 1 - (w.c * 0.46) ** 2)) + ay * 0.45;
      let len, pinch = 0, bead = 0;
      if (tl < w.tDet) {
        const k = inv(0, w.tDet, tl);
        len = w.L * flung(k); pinch = smooth(inv(0.45, 1, k)); bead = 0.55 + 0.45 * k;
      } else {
        const q = 1 - spring(tl - w.tDet, 5, 0.34);
        len = w.L * 0.62 * (q >= 0 ? q : -0.45 * q) * (1 - smooth(inv(0.17, TEN_T, tl)));
      }
      const dx = Math.sin(w.ang), dy = -Math.cos(w.ang);
      const droop = 0.22 * len * Math.abs(dx);
      const mx = bx + dx * len * 0.5, my = by + dy * len * 0.5 + droop * 0.25;
      const tx = bx + dx * len, ty = by + dy * len + droop;
      const ra = d.r * 0.16 * (1 - 0.3 * Math.abs(w.c)), rm = lerp(ra * 0.55, ra * 0.42, pinch), rt = lerp(rm * 0.8, d.r * 0.035, pinch);
      return { bx, by, mx, my, tx, ty, ra, rm, rt, bead: bead * w.rb, len };
    }

    const crown = [];
    drops.forEach((d, di) => {
      const big = d.id === 'P4';
      const melt = (xh) => Math.abs(xh - d.x) < d.r / SV_PUD * 0.85;
      tendrils[di].forEach((w) => {
        const s = tendrilState(d, w, w.tDet - 1e-4);
        const ang = w.ang + rr(-0.21, 0.21), sp = rr(480, 760) * rr(0.75, 1.25) * (big ? 1.15 : 1);
        const x0 = s.tx + Math.sin(w.ang) * w.rb, y0 = s.ty - Math.cos(w.ang) * w.rb, fy = rr(-36, 30);
        const T = rr(6, 8.5) / 30 * (big ? 1.15 : 1), vy = (0.5 * G * T * T - (FY + fy - w.rb - y0)) / T;
        crown.push(makeDroplet({
          x0, y0, vx: Math.sin(ang) * sp * 1.1, vy, fy,
          r: w.rb, u: d.u + rr(-0.05, 0.05), tEmit: d.tLand + w.tDet, tGrow: 0.001, owner: di, melt
        }));
      });
      for (let i = 0; i < (big ? 3 : 2); i++) {
        const side = i % 2 ? 1 : -1;
        crown.push(makeDroplet({
          x0: d.x + side * d.r * rr(0.9, 1.4), y0: FY - d.r * 0.55, vx: side * rr(320, big ? 820 : 640), vy: rr(520, big ? 1100 : 900),
          r: rr(3.5, big ? 8 : 6), u: d.u + rr(-0.05, 0.05), tEmit: d.tLand + 2 / 30 + rr(0, 1 / 30), tGrow: 0.03, owner: di, melt, fy: rr(-36, 30)
        }));
      }
    });
    {
      const land = crown.filter((c) => !c.melt).sort((a, b) => a.tHit - b.tHit);
      land.forEach((c, i) => {
        for (let j = 0; j < i; j++) {
          const o = land[j];
          if (!o.melt && Math.hypot(c.xHit - o.xHit, c.fy - o.fy) < 15 + c.r + o.r) {
            c.melt = true;
            break;
          }
        }
      });
    }

    const MX = 960, GH = 5000, TH = 0.34;
    const hops = [
      { who: 0, tc: CUES.merges[0] },
      { who: 2, tc: CUES.merges[1] },
      { who: 1, tc: CUES.merges[2] }
    ];
    hops.forEach((h) => {
      const d = drops[h.who];
      h.side = Math.sign(d.x - MX);
      h.tTake = h.tc - TH;
      h.x0 = d.x;
      h.x1 = MX + h.side * 42;
      h.vy = GH * TH / 2 + 60 / TH;
    });
    const hopOf = (i) => hops.find((h) => h.who === i);
    function mergeK(i, t) {
      const h = hopOf(i);
      return smooth(inv(h.tc - 0.02, h.tc + 0.16, t));
    }
    function massShift(t) {
      let s = 0;
      for (const h of hops) s += h.side * 20 * wob(t - h.tc, 2.8, 0.22);
      return s;
    }
    function massR(t) {
      let a = drops[3].r ** 2;
      for (const h of hops) a += drops[h.who].r ** 2 * mergeK(h.who, t);
      return Math.sqrt(a);
    }
    function ghosts(S, t, cx, cy, R, sv, fade = 1) {
      hops.forEach((h, j) => {
        const k = smooth(inv(h.tc + 0.02, h.tc + 0.3, t)) * fade;
        if (k <= 0.01) return;
        const a = j * 2.1 + 1.5 * (t - h.tc) + h.side * 0.9;
        const rg = Math.min(drops[h.who].r * 0.9, R * 0.62);
        const gx = cx + Math.cos(a) * 0.40 * R / sv, gy = cy + Math.sin(a) * 0.34 * R * sv;
        S.balls.push({ x: gx, y: gy, r: rg, u: drops[h.who].u, s: 1.7, a: a + PI / 2, ghost: true, amt: 0.85 * k });
      });
    }
    const hLow = (h) => ({ ...h, vy: h.vy * 0.8 });
    function hopPos(h, r, tt) {
      const yb = FY - r * 0.92, yl = FY - 50;
      const x = lerp(h.x0, h.x1, tt / TH);
      const y = yb - h.vy * tt + 0.5 * GH * tt * tt + (yl - yb) * (tt / TH);
      const vx = (h.x1 - h.x0) / TH, vy = -h.vy + GH * tt + (yl - yb) / TH;
      return { x, y, vx, vy };
    }
    crown.forEach((c) => {
      if (c.melt) return;
      const i = c.owner, d = drops[i];
      const tA = i === 3 ? CUES.leap - 0.3 : hopOf(i).tTake - 0.14;
      c.follow = (t) => (d.x + Math.sign(c.xHit - d.x) * d.r * 1.2 - c.xHit) * flung(inv(tA, tA + 0.16, t));
      c.absorb = tA + 0.1;
      if (Math.abs(c.xHit - d.x) > 420) { c.follow = null; c.absorb = 99; }
    });
    const sat = { tSnap: hopOf(1).tTake + 0.13 };

    const tLeap = CUES.leap, tApex = CUES.apex, tImpact = 4.0;
    const GL = 3750;
    const vLeap = GL * (tApex - tLeap);
    const massRLeap = 118, heroR = 132;
    const leapY0 = FY - massRLeap * 1.0;
    function sphereY(t) {
      const tt = t - tLeap;
      return leapY0 - vLeap * tt + 0.5 * GL * tt * tt;
    }
    const tThread = CUES.thread_snap;
    const remR = 36;
    const spray = [];
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1;
      spray.push({ x0: MX + side * rr(40, 260), y0: FY - rr(30, 90), vx: side * rr(80, 700), vy: rr(1500, 2700), r: rr(9, 26), u: rr(0.2, 0.9), t0: tImpact + rr(1, 3) / 30 });
    }

    const mkDir = (dx) => { const l = Math.hypot(dx, 1); return [dx / l, -1 / l]; };
    const dir = mkDir(0.42);
    const aOf = (x, y) => x * dir[0] + y * dir[1];
    function sheet(delay, rdelay, u, amp, freq, ph0, lean, dx, dur = 0.46) {
      const d = dx === undefined ? dir : mkDir(dx);
      const A = (x, y) => x * d[0] + y * d[1], B = (x, y) => -d[1] * x + d[0] * y;
      const vis = [[220, 260], [1700, 260], [220, 1040], [1700, 1040]];
      const all = [[-40, -80], [1960, -80], [-40, 1200], [1960, 1200]];
      const aStart = Math.min(...vis.map(([x, y]) => A(x, y))) - 60, aImp = A(MX, FY - 20);
      const aEnd = Math.max(...all.map(([x, y]) => A(x, y))) + 330, aLow = Math.min(...all.map(([x, y]) => A(x, y))) - 400;
      const bs = all.map(([x, y]) => B(x, y)), bLo = Math.min(...bs) + 150, bHi = Math.max(...bs) - 150;
      const bump0 = Math.max(380, aImp - aStart + 170), bumpC = B(MX, FY);
      const t0 = tImpact + 0.035 + delay, t1 = t0 + dur;
      const r0 = CUES.reveal_start + rdelay, r1 = r0 + 0.6;
      const frontAt = (t) => lerp(aStart, aEnd, frontEase(inv(t0, t1, t))) + 700 * smooth(inv(t1, t1 + 0.3, t));
      const backAt = (t) => lerp(aLow, aEnd + 260, inOut(inv(r0, r1, t)));
      return (t) => {
        if (t < t0 || t > r1 + 0.02) return { on: false, front: 0, back: 0, phase: 0, amp: 0, freq: 0, lean: 0, u };
        const front = frontAt(t), back = backAt(t);
        const bumpAt = (tt) => bump0 * smooth(inv(t0 - 0.01, t0 + 0.13, tt)) * (1 - smooth(inv(t0 + 0.1, t0 + 0.45, tt)));
        const bump = bumpAt(t);
        const vel = Math.max(
          Math.abs(frontAt(t + 1 / 60) - frontAt(t - 1 / 60)) + Math.abs(bumpAt(t + 1 / 60) - bumpAt(t - 1 / 60)),
          Math.abs(backAt(t + 1 / 60) - backAt(t - 1 / 60))
        ) * 0.5 + 6;
        return { on: true, front, back, phase: ph0 + t * 5.2, amp, freq, lean, u, dx: d[0], dy: d[1], bump, bumpC, vel, bLo, bHi };
      };
    }
    const sheetV = sheet(0.0, 0.14, 0.9, 80, 0.0115, 0.3, 0.02, 0.42, 0.62);
    const sheetO = sheet(0.07, 0.07, 0.06, 85, 0.0102, 2.1, -0.03, -0.55);
    const sheetP = sheet(0.14, 0.0, 0.46, 90, 0.0125, 4.4, 0.04, 0.3);
    const lead = [];
    [[0.0, 0.88], [0.1, 0.08], [0.2, 0.48]].forEach(([delay, u]) => {
      for (let i = 0; i < 7; i++) lead.push({ delay, u: u + rr(-0.05, 0.05), bf: rr(0.02, 0.98), ahead: rr(60, 220), r: rr(8, 22), ph: rr(0, 6) });
    });

    const L = word.letters;
    const letterU = [0.04, 0.26, 0.5, 0.86];
    const tSnap = CUES.logo_snap;
    const clusters = L.map((l, i) => {
      const w = l.bbox[2] - l.bbox[0], h = l.bbox[3] - l.bbox[1];
      const cx = (l.bbox[0] + l.bbox[2]) / 2, cy = i === 1 || i === 2 ? (l.bbox[1] + l.bbox[3]) / 2 : (word.massY ?? word.baseY - 100);
      const main = [74, 52, 64, 64][i];
      return {
        i, cx, cy: i === 3 ? cy + 10 : cy, u: letterU[i],
        parts: [
          { dx: 0, dy: 0, r: main, sx: rr(-70, 70), sy: rr(-60, 20) },
          { dx: rr(-0.3, 0.3) * w, dy: -h * 0.28, r: main * 0.46, sx: rr(-120, 120), sy: rr(-150, -60) },
          { dx: rr(-0.3, 0.3) * w, dy: h * 0.22, r: main * 0.36, sx: rr(-120, 120), sy: rr(-40, 60) }
        ],
        tFree: 0
      };
    });
    clusters.forEach((c) => {
      const aTop = aOf(c.cx, c.cy - c.parts[0].r) + 150;
      for (let tt = CUES.reveal_start; tt < CUES.reveal_start + 1.2; tt += 1 / 240) {
        const sh = sheetV(tt);
        if (sh.on && sh.back > aTop) { c.tFree = tt; break; }
      }
      if (!c.tFree) c.tFree = CUES.reveal_start + 0.6;
    });

    const massY = word.massY ?? word.baseY - 100, SLOT = 0.55;
    const slotX = L.map((l) => 960 + (l.sx0 - 960) * SLOT);
    const MASS = { hx: 104, vy: 60 };
    const hxP = slotX.map((x, i) => 0.5 * Math.min(i > 0 ? x - slotX[i - 1] : 1e9, i < 3 ? slotX[i + 1] - x : 1e9) * 0.96);
    const vyP = MASS.vy * 1.18;
    const snapDrops = [];
    for (let i = 0; i < 15; i++) {
      const li = i % 4, side = li < 2 ? (R() < 0.8 ? -1 : 1) : (R() < 0.8 ? 1 : -1);
      const x0 = lerp(L[li].bbox[0], L[li].bbox[2], rr(0.15, 0.85)), y0 = massY + rr(-60, 70), r = rr(4, 11);
      const T = rr(8, 14) / 30, dy = FY - r - y0, vy = (0.5 * G * T * T - dy) / T;
      snapDrops.push(makeDroplet({ x0, y0, vx: side * rr(260, 980), vy, r, u: letterU[li], tEmit: tSnap + rr(1, 2.2) / 30, tGrow: 0.03, melt: () => true, fy: rr(-4, 22) }));
    }

    const inkRow = (li, y, fromRight) => {
      const b = L[li].bbox;
      if (fromRight) { for (let x = Math.round(b[2]); x > b[0]; x--) if (word.sd(li, x, y) < -6) return x; }
      else { for (let x = Math.round(b[0]); x < b[2]; x++) if (word.sd(li, x, y) < -6) return x; }
      return fromRight ? b[2] : b[0];
    };
    const bridges = [0, 1, 2].map((i) => ({
      i, j: i + 1, y: massY + [20, -10, 15][i],
      xa: inkRow(i, massY + [20, -10, 15][i], true) - 16,
      xb: inkRow(i + 1, massY + [20, -10, 15][i], false) + 16,
      r: [21, 18, 20][i]
    }));

    const dripSpots = [
      { li: 0, fx: 0.40, len: 26, r: 10, t0: 7.0 },
      { li: 1, fx: 0.30, len: 16, r: 8, t0: 7.25 },
      { li: 2, fx: 0.52, len: 30, r: 11, t0: 7.1 }
    ].map((d) => {
      const l = L[d.li];
      const x = lerp(l.bbox[0], l.bbox[2], d.fx);
      return { ...d, x, y: (word.bottomAt(d.li, x) ?? l.bbox[3]) - 4 };
    });

    const pL = L[3];
    let pxBest = (pL.bbox[0] + pL.bbox[2]) / 2, pyBest = -1;
    for (let x = pL.bbox[0]; x < pL.bbox[2]; x += 2) {
      const y = word.bottomAt(3, x);
      if (y !== null && y > pyBest) { pyBest = y; pxBest = x; }
    }
    let x0r = pxBest, x1r = pxBest;
    while (word.bottomAt(3, x0r - 2) !== null && word.bottomAt(3, x0r - 2) >= pyBest - 3) x0r -= 2;
    while (word.bottomAt(3, x1r + 2) !== null && word.bottomAt(3, x1r + 2) >= pyBest - 3) x1r += 2;
    const hero = { x: (x0r + x1r) / 2, y: pyBest - 6, rMax: 25, tLand: CUES.drip_land };
    hero.ySnap = hero.y + 78; hero.vSnap = 240;
    {
      const dy = FY - hero.rMax * 1.1 - hero.ySnap;
      const tf = (-hero.vSnap + Math.sqrt(hero.vSnap ** 2 + 2 * G * dy)) / G;
      hero.tSnap = hero.tLand - tf;
    }
    hero.tStart = hero.tSnap - 0.85;

    const splat = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      splat.push(makeDroplet({ x0: hero.x + side * rr(10, 30), y0: FY - 10, vx: side * rr(120, 330), vy: rr(260, 520), r: rr(3, 5.5), u: 0.84, tEmit: hero.tLand + 2 / 30, tGrow: 0.05 }));
    }

    const floodBub = [];
    for (let i = 0; i < 30; i++) floodBub.push({ x: rr(260, 1660), y0: rr(560, 1120), sp: rr(240, 520), r: rr(1.6, 4.6), t0: rr(4.14, 4.62), dur: rr(0.45, 0.8), wob: rr(3, 10), wf: rr(8, 16), ph: rr(0, 6) });
    const bubbles = [];
    L.forEach((l, li) => {
      const cols = [];
      for (let x = l.bbox[0] + 6; x < l.bbox[2] - 6; x += 3) {
        let y = l.bbox[3] - 4, bottom = null, top = null;
        for (; y > l.bbox[1]; y -= 2) {
          const d = word.sd(li, x, y);
          if (d < -9) { if (bottom === null) bottom = y; top = y; }
          else if (bottom !== null) break;
        }
        if (bottom !== null && bottom - top > 90) cols.push({ x, bottom, top });
      }
      for (let j = 0; j < 7 && cols.length; j++) {
        const c = cols[Math.floor(R() * cols.length)];
        bubbles.push({ li, x: c.x, y0: c.bottom - 4, y1: c.top + 10, sp: rr(38, 62), r: rr(3.4, 7.2), ph: R(), t0: tSnap + 0.35 + rr(0, 0.9), wob: rr(1.5, 3.5), wf: rr(5, 9) });
      }
    });

    const KICKS = [7.2, 7.4, 8.0];
    const JELLY_HITS = [[7.2, 0.07, 1], [7.6, 0.035, 1], [8.0, 0.05, 1], [8.4, 0.045, -1], [8.8, 0.03, 1], [9.2, 0.018, 1]];

    return function evalAt(t) {
      const S = {
        t, frame: Math.round(t * 30), k: 0.1, floorY: FY, horizon: HOR,
        cam: { zoom: 1, px: 960, py: 540, ox: 0, oy: 0 },
        balls: [], segs: [], letters: [],
        flood: { on: false, front: 0, back: 0, phase: 0, amp: 0, freq: 0, lean: 0, u: 0 },
        overlays: [
          { on: false, front: 0, back: 0, phase: 0, amp: 0, freq: 0, lean: 0, u: 0 },
          { on: false, front: 0, back: 0, phase: 0, amp: 0, freq: 0, lean: 0, u: 0 },
          { on: false, front: 0, back: 0, phase: 0, amp: 0, freq: 0, lean: 0, u: 0 }
        ],
        rip: { x: 0, y: 0, age: 0, amp: 0 },
        key: { x: -0.78, y: -0.95, glint: -9999, glintAmp: 0 },
        bloom: 0.55, flash: 0
      };

      const cz = camAt(t);
      let punch = 0.016 * wob(t - tImpact, 3.0, 0.2);
      drops.forEach((d, i) => { punch += (i === 3 ? 0.022 : 0.013) * wob(t - d.tLand, 3.2, 0.16); });
      let zmul = 1;
      if (t >= tSnap) {
        const ts = t - tSnap;
        zmul = ts < 2 / 30 ? lerp(1, 1.07, outSoft(ts * 15)) : ts < 14 / 30 ? lerp(1.07, 1.02, inOut(inv(2 / 30, 14 / 30, ts))) : 1.02;
        zmul += 0.045 * (0.5 - 0.5 * Math.cos(PI * inv(tSnap + 14 / 30, 10.0, t)));
      }
      S.cam = { zoom: cz[0] * (1 + punch) * zmul, px: cz[1], py: cz[2] - 60 * (zmul - 1), ox: 0, oy: 0 };

      S.k = 0.1;
      if (t > 5.2) S.k = lerp(0.062, 0.105, smooth(inv(tSnap, tSnap + 0.2, t)));
      if (t > 5.2 && t < 5.9) S.k = lerp(0.1, 0.062, smooth(inv(5.2, 5.9, t)));

      // POUR (P1)
      const P1 = drops[0];
      const tPS = CUES.pour_snap;
      const pourGeo = (tt) => {
        const bottom = 454 + 45 * tt + 2500 * tt * tt, v = 45 + 5000 * tt;
        const neckPull = tt < tPS ? Math.pow(tt / tPS, 1.6) : 0;
        const sv = 1 + 0.26 * clamp(v / 2045) + 0.16 * neckPull;
        const cy = bottom - P1.r * sv, top = cy - P1.r * sv * 0.82;
        return { bottom, v, neckPull, sv, cy, top, pinchY: top - 34 - 30 * neckPull };
      };
      if (t < P1.tLand) {
        const bottom = 454 + 45 * t + 2500 * t * t, v = 45 + 5000 * t;
        const neckPull = t < tPS ? Math.pow(t / tPS, 1.6) : 0;
        const sv = 1 + 0.26 * clamp(v / 2045) + 0.16 * neckPull;
        const cy = bottom - P1.r * sv;
        ball(S, P1.x, cy, P1.r, P1.u, sv);
        const wb = word.bbox, ww = wb[2] - wb[0];
        S.lens = [P1.x, cy, P1.r / sv, P1.r * sv, (wb[0] + wb[2]) / 2 - word.offX, (wb[1] + wb[3]) / 2 - word.offY, ww / 0.92, 0.72 * (1 - smooth(inv(0.25, 0.35, t)))];
        if (t < tPS) {
          const top = cy - P1.r * sv * 0.82;
          const pinchY = top - 34 - 30 * neckPull;
          seg(S, P1.x, -90, P1.x, pinchY, 25, lerp(8, 1.2, neckPull), P1.u + 0.02);
          seg(S, P1.x, pinchY, P1.x, top + 8, lerp(8, 1.2, neckPull), lerp(16, 12, neckPull), P1.u);
        } else {
          const k = spring(t - tPS, 7, 0.45);
          const top = cy - P1.r * sv * 0.8;
          const len = 42 * (1 - k);
          if (len > 1) seg(S, P1.x, top - len, P1.x, top + 6, 3.5 * (1 - k) + 1, 13, P1.u);
          ball(S, P1.x, top - len, 5 * (1 - k * 0.8), P1.u);
        }
      }
      if (t >= tPS && t < 1.4) {
        const endSnap = pourGeo(tPS - 1e-4).pinchY;
        const k = spring(t - tPS, 5.5, 0.32);
        const end = endSnap - 58 * k - 1500 * easeIn(inv(0.34, 1.2, t));
        if (end > -80) {
          seg(S, P1.x, -90, P1.x, end, 25 - 6 * inv(0.3, 1.2, t), 7 + 3 * k, P1.u + 0.02);
          ball(S, P1.x, end, 9 + 3 * k, P1.u + 0.02);
        }
      }

      // DROPS & HOPS
      drops.forEach((d, i) => {
        if (i === 0 && t < d.tLand) return;
        if (t < d.tLand) {
          const tau = d.tLand - t, vL = 2500, Gd = 4200;
          if (tau > 0.52) return;
          const bottom = FY - vL * tau + 0.5 * Gd * tau * tau, v = vL - Gd * tau;
          const sv = 1 + 0.30 * clamp(v / vL);
          const cy = bottom - d.r * sv;
          ball(S, d.x, cy, d.r, d.u, sv);
          const lag = 0.03 * v;
          ball(S, d.x, cy - d.r * sv * 0.9 - lag, d.r * 0.32, d.u, 1.3);
          seg(S, d.x, cy - d.r * 0.3, d.x, cy - d.r * sv * 0.9 - lag, d.r * 0.5, d.r * 0.18, d.u);
          return;
        }
        if (t >= 4.0) return;
        const tl = t - d.tLand;
        tendrils[i].forEach((w) => {
          const a = tendrilState(d, w, tl);
          if (!a || a.len < 1) return;
          seg(S, a.bx, a.by, a.mx, a.my, a.ra, a.rm, d.u);
          seg(S, a.mx, a.my, a.tx, a.ty, a.rm, a.rt, d.u);
          if (a.bead > 0.5) ball(S, a.tx + Math.sin(w.ang) * a.bead * 0.8, a.ty - Math.cos(w.ang) * a.bead * 0.8, a.bead, d.u, 1.12, w.ang - PI / 2);
        });
        if (i === 3) {
          if (t > tLeap - 0.25) return;
          const r = massR(t);
          let sv = svLand(d, tl);
          for (const h of hops) sv += 0.16 * wob(t - h.tc, 3.6, 0.2);
          ball(S, MX + massShift(t), FY - r * sv + 1.0, r, d.u, sv);
          ghosts(S, t, MX + massShift(t), FY - r * sv + 1.0, r, sv);
          return;
        }
        const h = hopOf(i), r = d.r;
        const hopBody = (rs, tt, rr_, uOff, delay) => {
          if (tt < -0.1) {
            if (rs < 1) return;
            const sv = svLand(d, tl);
            ball(S, h.x0, FY - rr_ * sv + 1, rr_, d.u, sv);
            return;
          }
          if (tt < 0) {
            const k = inv(-0.1, 0, tt);
            const sv = lerp(rs < 1 ? 0.62 : SV_PUD, 0.40, smooth(k));
            const x = rs < 1 ? h.x0 - h.side * r * 1.25 : h.x0 + h.side * 8 * k;
            ball(S, x, FY - rr_ * sv + 1, rr_, d.u + uOff, sv);
            return;
          }
          if (tt < TH) {
            const P = hopPos(rs < 1 ? hLow(h) : h, rr_, tt);
            const sp = Math.hypot(P.vx, P.vy);
            let sv = 1 + 0.26 * Math.min(1, sp / 1400) + 0.35 * Math.exp(-tt / 0.05);
            sv = lerp(sv, 0.74, smooth(inv(TH - 0.06, TH, tt)));
            ball(S, P.x, P.y, rr_, d.u + uOff, sv, Math.atan2(P.vy, P.vx));
            if (tt < 0.09 && rs === 1) {
              const k = tt / 0.09;
              seg(S, h.x0, FY - 6, lerp(h.x0, P.x, 0.5), lerp(FY - 6, P.y, 0.5), lerp(rr_ * 0.5, 8, k), lerp(rr_ * 0.4, 0.6, k), d.u);
            }
            return;
          }
          const tm = t - delay - h.tc;
          const k = smooth(inv(0, 0.15, tm)), ks = smooth(inv(0, 0.05, tm)), kd = smooth(inv(0.0, 0.15, tm));
          const P = hopPos(rs < 1 ? hLow(h) : h, rr_, TH);
          const x = lerp(P.x, MX + massShift(t), k * 0.8), y = lerp(P.y + rr_ * 0.35 * ks, FY - massR(t) * 0.42, kd);
          const rm = rr_ * Math.sqrt(1 - k);
          ball(S, x, y, rm, d.u + uOff, lerp(0.74, 0.55, ks) * (1 - 0.1 * k));
          if (rs === 1 && tm > 0.02 && tm < 0.2) {
            const kb = inv(0.02, 0.2, tm);
            ball(S, lerp(P.x, MX - h.side * 90, kb) + massShift(t), P.y + rr_ * 0.45 + 6 * kb, rr_ * 0.55 * Math.sin(PI * kb), d.u + uOff, 0.7);
          }
        };
        hopBody(1, t - h.tTake, r, 0, 0);
        hopBody(0.27, t - 0.17 - h.tTake, r * 0.27, 0.03, 0.17);
        if (i === 1) {
          const tt = t - h.tTake;
          if (tt > 0 && tt < 0.4) {
            const P = hopPos(h, r, Math.min(tt, TH));
            const bx = h.x0 - h.side * r * 1.25, by = FY - r * 0.34 * 0.5;
            if (t < sat.tSnap) {
              const k = inv(h.tTake, sat.tSnap, t);
              const mx = lerp(bx, P.x, 0.5), my = lerp(by, P.y, 0.5) + 10;
              const rm = lerp(6, 0.6, Math.pow(k, 0.8));
              seg(S, bx, by, mx, my, 7, rm, d.u + 0.03);
              seg(S, mx, my, P.x - h.side * -r * 0.3, P.y + r * 0.3, rm, 10, d.u);
            } else {
              const k = spring(t - sat.tSnap, 7, 0.4);
              const f = 0.45 * (1 - k);
              if (f > 0.02) {
                seg(S, bx, by, lerp(bx, P.x, f), lerp(by, P.y, f), 6, 2.5, d.u + 0.03);
                seg(S, P.x, P.y + r * 0.4, lerp(P.x, bx, f), lerp(P.y, by, f), 9, 2.5, d.u);
              }
            }
          }
        }
      });
      crown.forEach((c) => { if (t < 4.05) emitDroplet(S, c, t); });

      // LEAP
      if (t >= tLeap - 0.25 && t < tImpact + 0.3) {
        const u = 0.36;
        if (t < tLeap) {
          const k = inOut(inv(tLeap - 0.25, tLeap - 0.07, t));
          let sv = lerp(SV_PUD, 0.86, k);
          sv = lerp(sv, 0.55, smooth(inv(tLeap - 0.08, tLeap, t)));
          const r = lerp(massR(t), massRLeap, k);
          ball(S, MX, FY - r * sv + 1, r, u, sv);
          ghosts(S, t, MX, FY - r * sv + 1, r, sv);
        } else if (t < tImpact) {
          const tt = t - tLeap;
          const y = sphereY(t);
          const r = lerp(massRLeap, heroR, smooth(inv(tLeap, tApex, t)));
          let sv = 1 + 0.36 * Math.exp(-tt / 0.12) * Math.cos(tt * 18) + 0.10 * wob(tt - 0.08, 3.4, 0.35) + 0.14 * smooth(inv(tApex + 0.1, tImpact, t));
          sv += 0.05 * Math.sin(2 * PI * 3 * (t - tApex)) * smooth(inv(tApex - 0.35, tApex - 0.12, t)) * (1 - smooth(inv(tApex + 0.2, tApex + 0.32, t)));
          S.sw = [MX, y, r * 1.02, 0.82 * smooth(inv(tLeap + 0.04, tLeap + 0.3, t)) * (1 - smooth(inv(tImpact - 0.03, tImpact + 0.02, t)))];
          ball(S, MX, y, r, u, sv);
          ghosts(S, t, MX, y, r * 0.95, sv);
          const wa = 0.5 + 0.5 * Math.exp(-tt / 0.4);
          for (let j = 0; j < 3; j++) {
            const ang = j * 2.1 + tt * (1.6 + j * 0.4);
            ball(S, MX + Math.cos(ang) * r * 0.55, y + Math.sin(ang) * r * 0.55, r * 0.42 * wa, u + 0.04 * (j - 1), 1);
          }
          const remSv = 0.5 + 0.25 * wob(t - tThread, 6, 0.2);
          const remR2 = remR * (1 - smooth(inv(tImpact - 0.08, tImpact, t)));
          ball(S, MX, FY - remR2 * remSv + 1, remR2, u + 0.05, remSv);
          const sb = y + r * sv * 0.85, rt = FY - remR2 * remSv * 1.6;
          if (t < tThread) {
            const k = inv(tLeap, tThread, t);
            const my = lerp(sb, rt, 0.55);
            const rm = lerp(14, 0.7, Math.pow(k, 0.9));
            seg(S, MX, sb - 10, MX, my, lerp(38, 16, k), rm, u);
            seg(S, MX, my, MX, rt + 6, rm, lerp(22, 12, k), u + 0.04);
          } else {
            const k = spring(t - tThread, 6.5, 0.36);
            const up = (rt - sb) * 0.45 * (1 - k);
            if (up > 2) {
              seg(S, MX, sb - 8, MX, sb + up, 14, 3, u);
              seg(S, MX, rt - up, MX, rt + 6, 3, 12, u + 0.04);
              ball(S, MX, rt - up, 4, u + 0.04);
            }
          }
        } else {
          const tl = t - tImpact;
          const sv = 1.15 + (0.3 - 1.15) * spring(tl, 5, 0.5);
          const drain = 1 - smooth(inv(0.05, 0.19, tl));
          if (drain > 0.02) ball(S, MX, FY - heroR * sv * drain, heroR * (1 + 0.3 * smooth(inv(0, 0.2, tl))) * drain, 0.4, sv);
        }
      }
      spray.forEach((d) => {
        if (t < d.t0 || t > 5.0) return;
        const tt = t - d.t0;
        const x = d.x0 + d.vx * tt, y = d.y0 - d.vy * tt + 0.5 * G * tt * tt;
        const vy = -d.vy + G * tt;
        const r = d.r * smooth(inv(0, 0.05, tt));
        ball(S, x, y, r, d.u, 1 + Math.min(0.5, Math.hypot(d.vx, vy) / 5000), Math.atan2(vy, d.vx));
      });

      // FLOOD
      S.overlays = [sheetV(t), sheetO(t), sheetP(t)];
      lead.forEach((d) => {
        const sh = [sheetV, sheetO, sheetP][d.delay === 0 ? 0 : d.delay < 0.15 ? 1 : 2](t);
        if (!sh.on) return;
        const t0 = tImpact - 0.03 + d.delay;
        const tt = t - t0;
        if (tt < 0.05 || tt > 0.6) return;
        const b = lerp(sh.bLo, sh.bHi, d.bf);
        const ahead = d.ahead * Math.sin(PI * inv(0.05, 0.6, tt));
        const a = sh.front + ahead + 60;
        const x = a * sh.dx - b * sh.dy, y = a * sh.dy + b * sh.dx;
        ball(S, x, y, d.r * Math.sin(PI * inv(0.05, 0.6, tt)), d.u, 1.35, Math.atan2(sh.dy, sh.dx));
      });

      // LOGO BLOBS
      if (t > 4.12 && t < tSnap) {
        const fk = inOut(inv(tSnap - 0.3, tSnap - 1 / 30, t));
        const squat = smooth(inv(tSnap - 0.2, tSnap - 1 / 30, t));
        clusters.forEach((c) => {
          const tFree = c.tFree;
          const gk = flung(inv(tFree - 0.05, tSnap - 0.2, t));
          const squeeze = smooth(inv(tSnap - 0.22, tSnap - 0.02, t));
          c.parts.forEach((p, j) => {
            const lagk = flung(inv(tFree - 0.05 + j * 0.08, tSnap - 0.2 + j * 0.03, t));
            const k = j === 0 ? gk : lagk;
            let x = c.cx + lerp(p.sx + p.dx, p.dx * 0.25, k);
            let y = c.cy + lerp(p.sy + p.dy, p.dy * 0.25, k);
            const tug = t < tFree ? 1 : 0;
            const reb = t >= tFree ? wob(t - tFree, 3.2, 0.22) : 0;
            y += -30 * tug * inv(tFree - 0.3, tFree, t) - 22 * reb;
            let r = p.r;
            if (t < tFree) {
              const shv = sheetV(t);
              r *= shv.on ? smooth(inv(0, 220, shv.front - aOf(c.cx, c.cy))) : 0;
              const pre = 1 - smooth(inv(4.12, tFree, t));
              x += (p.sx * 1.3 + (c.i - 1.5) * 70) * pre;
              y += 190 * pre;
            }
            let sv = 1 + 0.35 * tug * inv(tFree - 0.3, tFree, t) - 0.18 * reb - 0.16 * squeeze;
            if (fk > 0) {
              const hx0 = r / sv, vy0 = r * sv;
              const tx = slotX[c.i] + (j ? p.dx * 0.1 : 0), ty = massY;
              x = lerp(x, tx, fk); y = lerp(y, ty, fk);
              let hx = j ? hx0 * (1 - fk) : lerp(hx0, MASS.hx * (1 + 0.06 * squat), fk);
              let vy = j ? vy0 * (1 - fk) : lerp(vy0, MASS.vy * (1 - 0.15 * squat), fk);
              const pn = inOut(inv(tSnap - 3.5 / 30, tSnap - 0.6 / 30, t));
              if (!j && pn > 0) { hx = lerp(hx, hxP[c.i], pn); vy = lerp(vy, vyP, pn); }
              if (hx < 0.5) return;
              r = Math.sqrt(hx * vy); sv = Math.sqrt(vy / hx);
            }
            ball(S, x, y, r, c.u, sv);
            if (j === 0 && t < tFree + 0.02 && t > tFree - 0.35) {
              const sh = sheetV(t);
              if (sh.on) {
                const k2 = inv(tFree - 0.35, tFree, t);
                const topY = y - r * sv * 0.8;
                const edgeY = topY - lerp(20, 130, k2);
                const rm = lerp(18, 0.6, Math.pow(k2, 0.8));
                seg(S, x, topY + 6, x + 4, (topY + edgeY) / 2, lerp(26, 12, k2), rm, c.u);
                seg(S, x + 4, (topY + edgeY) / 2, x + 6, edgeY - 40, rm, lerp(30, 16, k2), 0.85);
              }
            }
          });
        });
      }

      // LETTERS
      if (t >= tSnap) {
        const ts = t - tSnap;
        const pos = [];
        L.forEach((l, i) => {
          const tl = ts;
          const m = clamp((ts * 30 - 0.6 * i + 1.5) / 2);
          const P = tl > 0 ? spring(tl, 4, 0.35) : 0;
          const x = 960 + (l.sx0 - 960) * lerp(SLOT, 1, P);
          const gs = lerp(SLOT, 1, P <= 1 ? P : 1 + 0.25 * (P - 1));
          const sq = m * smooth(clamp((P - 0.95) / 0.36));
          let jelly = 0;
          for (const [tk, ak, dk] of JELLY_HITS) jelly += ak * wob(t - tk - (dk > 0 ? i : 3 - i) * 0.04, 3.4, 0.22);
          const breathe = 0.025 * Math.sin(2 * PI * 0.7 * (t - 6.9) - i * PI / 2) * smooth(inv(6.9, 7.6, t));
          const sxJ = 1 + 0.12 * sq + jelly + breathe, syJ = 1 - 0.08 * sq + breathe - jelly * 0.6;
          const dy = tl > 0 ? -18 * (1 - spring(tl, 3.4, 0.45)) * m : 0;
          const gooWob = 3.2 * Math.exp(-Math.max(0, tl) / 0.35) + 0.9 + 0.5 * smooth(inv(6.9, 7.5, t));
          const yc = massY + (l.sy0 - massY) * gs + dy;
          const y = yc + (1 - syJ) * (l.bbox[3] - l.sy0) * 0.9 * gs;
          pos.push({ x, y: yc, gs });
          S.letters.push({
            x, y, px: l.px, py: l.py, grow: 3 * (1 - smooth(inv(0, 0.15, Math.max(0, tl)))), u: letterU[i], sx: gs * sxJ, sy: gs * syJ,
            a: tl > 0 ? 0.012 * wob(tl, 2.4, 0.4) * (i % 2 ? 1 : -1) : 0, on: true, m: Math.max(1e-3, m), wob: gooWob, wph: t * 7.0 + i * 1.7,
            ell: [x, massY + dy, hxP[i] * (1 + 0.4 * m), vyP * (1 + 0.4 * m)]
          });
        });
        bridges.forEach((br) => {
          const Pa = pos[br.i], Pb = pos[br.j], la = L[br.i], lb = L[br.j];
          const A = [Pa.x + (br.xa - la.sx0) * Pa.gs, Pa.y + (br.y - la.sy0) * Pa.gs];
          const B = [Pb.x + (br.xb - lb.sx0) * Pb.gs, Pb.y + (br.y - lb.sy0) * Pb.gs];
          const tBr = tSnap + (br.i + 0.5) / 30;
          if (t < tBr) {
            const k = inv(tSnap, tBr, t);
            const rm = lerp(br.r * 0.85, 1.0, Math.pow(k, 0.6));
            const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 6 * k];
            const ra = br.r * 1.1 * Pa.gs;
            seg(S, A[0], A[1], M[0], M[1], ra, rm, letterU[br.i]);
            seg(S, M[0], M[1], B[0], B[1], rm, ra, letterU[br.j]);
          } else if (t < tBr + 0.3) {
            const tt = t - tBr, k = spring(tt, 7, 0.35);
            const half = [(B[0] - A[0]) / 2, (B[1] - A[1]) / 2];
            const ra = br.r * (1 - 0.5 * smooth(inv(0, 0.25, tt)));
            seg(S, A[0], A[1], A[0] + half[0] * (1 - k) * 0.8, A[1] + half[1] * (1 - k) + 6, ra, 2.5 + 3 * (1 - k), letterU[br.i]);
            seg(S, B[0], B[1], B[0] - half[0] * (1 - k) * 0.8, B[1] - half[1] * (1 - k) + 6, ra, 2.5 + 3 * (1 - k), letterU[br.j]);
          }
        });
        snapDrops.forEach((d) => emitDroplet(S, d, t));
      }

      dripSpots.forEach((d) => {
        if (t < d.t0) return;
        const k = outSoft(inv(d.t0, 10.2, t));
        const len = d.len * k, r = d.r * (0.4 + 0.6 * smooth(inv(d.t0, d.t0 + 0.6, t)));
        const sway = 1.5 * Math.sin(t * 3 + d.li);
        if (len + r < 3) return;
        seg(S, d.x, d.y - 8, d.x + sway * 0.5, d.y + len, r * 1.25, r * 0.55, letterU[d.li]);
        ball(S, d.x + sway, d.y + len + r * 0.35, r * (0.6 + 0.4 * k), letterU[d.li], 1.12);
      });

      if (t > hero.tStart) {
        const u = letterU[3];
        if (t < hero.tSnap) {
          const k = inv(hero.tStart, hero.tSnap, t), kk = easeIn(k);
          const by = lerp(hero.y + 8, hero.ySnap, kk);
          const br = hero.rMax * (0.35 + 0.65 * smooth(inv(0, 0.55, k)));
          const neckY = lerp(hero.y + 6, by - br * 0.9, 0.5);
          const rn = lerp(16, 2.2, Math.pow(inv(0.35, 1, k), 1.2));
          seg(S, hero.x, hero.y - 10, hero.x, neckY, 22, rn, u);
          seg(S, hero.x, neckY, hero.x, by - br * 0.5, rn, br * 0.7, u);
          ball(S, hero.x, by, br, u, 1 + 0.18 * kk);
        } else if (t < hero.tLand) {
          const tt = t - hero.tSnap;
          const y = hero.ySnap + hero.vSnap * tt + 0.5 * G * tt * tt;
          const v = hero.vSnap + G * tt;
          const sv = 1.12 + 0.2 * clamp(v / 1400);
          ball(S, hero.x, y, hero.rMax, u, sv);
          const k = spring(tt, 8, 0.45);
          const len = 30 * (1 - k);
          if (len > 1) seg(S, hero.x, y - hero.rMax * sv - len, hero.x, y - hero.rMax * 0.6, 2, 8, u);
        } else {
          const tl = t - hero.tLand;
          const sv = 1.3 + (0.42 - 1.3) * spring(tl, 5.5, 0.4);
          const r = hero.rMax * (1 + 0.1 * smooth(inv(0, 0.3, tl)));
          ball(S, hero.x, FY - r * sv + 0.5, r, u, sv);
          S.rip = { x: hero.x, y: FY, age: tl, amp: 1 };
        }
        if (t >= hero.tSnap && t < hero.tSnap + 0.6) {
          const k = spring(t - hero.tSnap, 6, 0.33);
          const len = 40 * (1 - k) + 3;
          seg(S, hero.x, hero.y - 10, hero.x, hero.y + len, 18, 4 + 3 * (1 - k), u);
        }
      }
      splat.forEach((d) => emitDroplet(S, d, t));

      // LIGHT & BLOOM
      const g2 = inv(9.0, 9.0 + 10 / 30, t);
      const glint1 = t > CUES.glint - 0.1 && t < CUES.glint + 0.8;
      const kd = smooth(inv(6.9, 10.0, t));
      S.key = {
        x: -0.78 + 0.06 * Math.sin(t * 0.6) + 0.30 * kd,
        y: -0.95 + 0.12 * kd,
        glint: glint1 ? lerp(-900, 1700, inOut(inv(CUES.glint - 0.1, CUES.glint + 0.75, t))) : lerp(-300, 1900, inOut(g2)),
        glintAmp: glint1 ? 1 : (g2 > 0 && g2 < 1 ? 2.2 * Math.sin(PI * g2) : 0)
      };
      {
        const f = (t - tSnap) * 30;
        if (f >= 0 && f < 2.5) { S.key.glint = lerp(-200, 1300, f / 2.5); S.key.glintAmp = 2.8 * (1 - 0.5 * f / 2.5); }
      }
      const gA = inv(3.72, 3.72 + 6 / 30, t);
      if (gA > 0 && gA < 1) { S.key.glint = 0.8 * MX - 0.6 * sphereY(t) + lerp(-300, 300, inOut(gA)); S.key.glintAmp = 2.4 * Math.sin(PI * gA); }
      S.bloom = 0.55 + 0.45 * Math.exp(-Math.max(0, t - tSnap) / 0.25) * (t > tSnap ? 1 : 0);
      const gap = smooth(inv(tSnap - 0.2, tSnap - 1 / 30, t)) * (t < tSnap ? 1 : 0);
      S.spot = 1.0 - 0.55 * gap;
      if (t >= tSnap) S.spot = 1.12 + 0.45 * Math.exp(-(t - tSnap) / 0.15);
      {
        const tr = t - tSnap;
        if (tr >= 0 && tr < 0.6) {
          const ur = inv(0, 10 / 30, tr), kr = 1 - (1 - ur) * (1 - ur);
          S.ring = [960, massY + 10, 40 + 1360 * kr, 0.62 * (1 - 0.45 * kr) * (1 - smooth(inv(5 / 30, 12 / 30, tr)))];
          const kc = flung(inv(0, 3 / 30, tr)), fc = smooth(inv(3 / 30, 9 / 30, tr));
          if (tr < 9 / 30) S.crown = [960, massY - 30, 350 * kc * (1 - 0.6 * fc), (1 - fc) * smooth(inv(0, 1 / 30, tr))];
        }
        const ek = 0.5 - 0.5 * Math.cos(PI * inv(6.6, 10.0, t));
        S.caus = smooth(inv(6.55, 7.2, t)) * (1 + (t > CUES.drip_land ? 1.6 * Math.exp(-(t - CUES.drip_land) / 0.45) : 0));
        S.par = [8 * ek, -5 * ek, 80 * Math.sin(2 * PI * (t - 6.6) / 3.0) * smooth(inv(6.6, 7.4, t)), 18 * Math.sin(2 * PI * (t - 6.6) / 4.0) * smooth(inv(6.6, 7.4, t))];
      }
      for (const kt of KICKS) S.spot += 0.14 * Math.exp(-Math.max(0, t - kt) / 0.14) * (t >= kt ? 1 : 0);
      S.flash = -0.8 * gap;
      if (t >= tSnap) {
        const f = (t - tSnap) * 30;
        S.flash = f < 1 ? 0.9 : f < 2 ? 0.65 : 0.65 * (1 - smooth(inv(2, 8, f)));
      }
      S.bubbles = [];
      bubbles.forEach((b) => {
        if (t < b.t0) return;
        const len = b.y0 - b.y1, per = len / b.sp + 0.25;
        const ph = ((t - b.t0) / per + b.ph) % 1;
        const k = ph * per * b.sp / len;
        if (k > 1) return;
        const l = S.letters[b.li];
        if (!l) return;
        const y = lerp(b.y0, b.y1, k) + (l.y - L[b.li].sy0), x = b.x + b.wob * Math.sin((t - b.t0) * b.wf + b.ph * 6);
        const a = smooth(inv(0, 0.12, k)) * (1 - smooth(inv(0.88, 1, k))) * smooth(inv(b.t0, b.t0 + 0.3, t));
        S.bubbles.push([x, y, b.r * (0.8 + 0.4 * k), a]);
      });
      floodBub.forEach((b) => {
        const tt = t - b.t0;
        if (tt < 0 || tt > b.dur) return;
        const y = b.y0 - b.sp * tt - 160 * tt * tt, x = b.x + b.wob * Math.sin(tt * b.wf + b.ph);
        if (S.bubbles.length < 32) S.bubbles.push([x, y, b.r * (1 + 0.5 * tt), smooth(inv(0, 0.06, tt)) * (1 - smooth(inv(b.dur - 0.12, b.dur, tt)))]);
      });
      S.halo = t >= tSnap ? smooth(inv(tSnap, tSnap + 0.08, t)) * (0.55 + 0.45 * Math.exp(-(t - tSnap) / 0.3)) : 0;
      return S;
    };
  }

  // ================= 5. Cached Singleton Instance & Front Typography Layer =================
  let cachedEngine = null;
  let cachedW = 0, cachedH = 0, cachedWordStr = '';
  let cachedFilm = null;
  let cachedWord = null;
  let typeCanvas = null, typeCtx = null;

  function ensureEngine(W, H, wordStr) {
    const cleanWord = (wordStr || 'drop').slice(0, 4).padEnd(4, 'o');
    if (cachedEngine && cachedW === W && cachedH === H && cachedWordStr === cleanWord) {
      return;
    }
    cachedW = W;
    cachedH = H;
    cachedWordStr = cleanWord;
    cachedEngine = createWebGLEngine(W, H);

    const sdf = buildLetterSDF({
      word: cleanWord,
      family: 'Georgia, "Times New Roman", serif',
      weight: 900,
      size: 380,
      tracking: 12,
      pad: 160,
      sigma: 9
    });
    if (cachedEngine) cachedEngine.setSDF(sdf);

    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const l of sdf.letters) {
      x0 = Math.min(x0, l.bbox[0]);
      y0 = Math.min(y0, l.bbox[1]);
      x1 = Math.max(x1, l.bbox[2]);
      y1 = Math.max(y1, l.bbox[3]);
    }
    const offX = 960 - (x0 + x1) / 2;
    const offY = 452 - (y0 + sdf.baseY) / 2;
    cachedWord = {
      offX, offY, baseY: sdf.baseY + offY,
      bbox: [x0 + offX, y0 + offY, x1 + offX, y1 + offY],
      letters: sdf.letters.map((l) => ({
        ch: l.ch, px: l.pivot[0], py: l.pivot[1],
        sx0: l.pivot[0] + offX, sy0: l.pivot[1] + offY,
        bbox: [l.bbox[0] + offX, l.bbox[1] + offY, l.bbox[2] + offX, l.bbox[3] + offY]
      }))
    };
    cachedWord.sd = (i, x, y) => {
      const tx = Math.round(x - offX), ty = Math.round(y - offY);
      if (tx < 0 || ty < 0 || tx >= sdf.W || ty >= sdf.H) return 200;
      return sdf.data[(ty * sdf.W + tx) * 4 + i];
    };
    cachedWord.bottomAt = (i, x) => {
      for (let y = Math.round(cachedWord.letters[i].bbox[3]) + 4; y > cachedWord.letters[i].bbox[1]; y--) {
        if (cachedWord.sd(i, x, y) < 0) return y;
      }
      return null;
    };

    cachedFilm = createFilmState(cachedWord);
    typeCanvas = document.createElement('canvas');
    typeCanvas.width = W;
    typeCanvas.height = H;
    typeCtx = typeCanvas.getContext('2d');
  }

  function drawFrontTypography(g, W, H, safe, shot, localU, microstockMode) {
    g.clearRect(0, 0, W, H);
    if (microstockMode) return;

    const isPortrait = H > W;
    const sc = isPortrait ? safe.w / 896 : safe.h / 908;
    const cx = safe.x + safe.w * 0.5;
    const baseY = isPortrait ? safe.y + safe.h - 115 * sc : safe.y + safe.h - 54 * sc;
    const reveal = smooth(clamp(localU * 2.2));

    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';

    if (shot.tagline) {
      g.globalAlpha = 0.94 * reveal;
      g.fillStyle = 'rgb(255, 232, 240)';
      g.font = `600 ${Math.round(34 * sc)}px Georgia, "Times New Roman", serif`;
      g.fillText(String(shot.tagline).toUpperCase(), cx, baseY);
    }

    if (shot.subheadline) {
      g.globalAlpha = 0.72 * reveal;
      g.fillStyle = 'rgb(255, 200, 224)';
      g.font = `600 ${Math.round(19 * sc)}px Inter, "Segoe UI", Arial, sans-serif`;
      g.fillText(String(shot.subheadline).toUpperCase(), cx, baseY + 38 * sc);
    }
    g.restore();
  }

  // Map declarative shot layouts to the corresponding time window of the 10s 07-liquid choreography
  function mapShotToFilmTime(shot, localU) {
    const u = clamp(localU);
    switch (shot.layout) {
      case 'pour-macro':
        // Macro pour bulb (ball lens) -> P1 impact splash crown -> P2/P3/P4 landings (0.08s .. 1.95s)
        return lerp(0.10, 1.85, u);
      case 'splash-fuse':
        // Four puddles hopping & fusing into the center mass (1.85s .. 3.18s)
        return lerp(1.85, 3.18, u);
      case 'marbled-leap':
        // Merged mass leaps into a 3D marbled sphere with snapping thread & apex wobble (3.18s .. 3.98s)
        return lerp(3.22, 3.94, u);
      case 'flood-immersion':
        // 3 diagonal flood sheets with under-surface caustic shafts & backlit seed blobs (4.05s .. 6.15s)
        return lerp(4.12, 5.85, u);
      case 'jelly-wordmark':
      default:
        // SDF morph split into glossy 3D 'drop' jelly letters + carbonation bubbles + hero drip + floor ripples (6.42s .. 9.65s)
        return lerp(6.48, 9.55, u);
    }
  }

  function renderShot(ctx2d, W, H, safe, shot, localTime, microstockMode) {
    const dur = Math.max(0.01, shot.duration || 7.5);
    const localU = clamp(localTime / dur);
    const wordStr = microstockMode ? 'oooo' : (shot.wordmark || 'drop');
    ensureEngine(W, H, wordStr);

    const filmT = mapShotToFilmTime(shot, localU);
    const S = cachedFilm(filmT);

    // Adapt camera zoom for 9:16 portrait so the 1920px-wide 07-liquid world fits cleanly inside the 1080px portrait canvas
    if (H > W) {
      const portraitZoomScale = (W / 1920) * 1.24;
      S.cam.zoom *= portraitZoomScale;
      // Keep the action vertically centered in the portrait safe zone
      S.cam.py = lerp(S.cam.py, 595, 0.35);
    }

    // In microstockMode, suppress the jelly letter SDFs on the finale shot and replace with pure 3D liquid spheres & drip
    if (microstockMode && S.letters && S.letters.length) {
      S.letters.forEach((l, idx) => {
        l.on = false;
        S.balls.push({
          x: l.x,
          y: l.y - 25,
          r: 72 - idx * 4,
          u: l.u,
          s: 1.05 + 0.08 * Math.sin(filmT * 4 + idx),
          a: 0
        });
      });
    }

    drawFrontTypography(typeCtx, W, H, safe, shot, localU, microstockMode);

    if (cachedEngine) {
      cachedEngine.render(S, typeCanvas);
      ctx2d.clearRect(0, 0, W, H);
      ctx2d.drawImage(cachedEngine.glCanvas, 0, 0, W, H);
    }
  }

  window.LiquidKit = {
    buildLetterSDF,
    mapShotToFilmTime,
    renderShot
  };
})();
