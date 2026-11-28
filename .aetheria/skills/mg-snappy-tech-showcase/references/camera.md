# Snappy Tech Showcase — Camera Choreography & Optical Lens Guide

## 1. Zero Dead-Stop Principle
Never let the camera or hero surface come to a dead stop (`velocity == 0`). Every beat maintains a subtle continuous push-in or pull-out (`±4–8%` scale via `SnappyTechKit.expLerp`) so cuts and morphs feel like one continuous kinetic take.

## 2. Exponential Optical Zoom (`expLerp`)
Linear scale interpolation (`lerp(4.0, 1.0, t)`) appears slow at high magnification and slams abruptly at `1.0x`. Always interpolate camera scale exponentially:

```js
const scale = SnappyTechKit.expLerp(startScale, endScale, SnappyTechKit.smoothGlide(t0, t1, t));
```

- Recommended glide duration: **`0.45s–0.65s`** using `smoothGlide` (65% cosine + 35% cubic S-curve) so the viewer's eye comfortably tracks the dolly at 60fps.

## 3. Whip-Pans & Cylindrical 3D Orbits (`plush-3d-studio`)
- **Whip-pans:** Use `SnappyTechKit.whipEase(t0, t1, t)` over `0.28s–0.38s` with shutter motion blur (`blur(0..10px)`) proportional to camera speed.
- **180° Flips:** Interpolate camera position along a cylindrical orbit around `lookAt` (`r = lerp(r0, r1, u)`, `ang = lerp(a0, a1, u)`) so the camera never passes over the zenith gimbal pole.
- **Macro Shallow-DoF:** Project the active hero subject into screen Y and apply a soft `backdrop-filter: blur(...)` gradient mask outside the subject's focus band (`±14–18%`).

## 4. 360° Tilted Card Ring (`cobalt-editorial`)
Use `SnappyTechKit.projectCylinderRing(count, scrollPos, opts)` with subtle downward pitch (`pitchY ≈ 20`) so back-row cards peek above front-row cards and ±90° cards compress cleanly into crisp vertical edge-slivers.
