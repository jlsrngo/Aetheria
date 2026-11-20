import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface CameraRig {
  dolly: number;
  zoom: number;
  truckX: number;
  truckY: number;
  panX: number;
  panY: number;
  orbitAz: number;
  tiltEl: number;
  roll: number;
  rollRad: number;
  pivotX: number;
  pivotY: number;
  blur: number;
}

interface CameraReportEntry {
  move: string;
  dir: string;
  seed: number;
  intensity: number;
  params: Record<string, number>;
  guard: "measured" | "clamped" | "unmeasured";
  repeatOfPrevious: boolean;
}

interface StoryCameraApi {
  version: number;
  MOVES: Record<string, unknown>;
  CAMERA_STYLES: Record<string, unknown>;
  LEGACY_PRESETS: Record<string, Record<string, number | string>>;
  planStoryMoves: (story: Record<string, unknown>) => Record<string, {
    active: boolean;
    mode: string;
    move: string;
    dir: string;
    seed: number;
    intensity: number;
    repeatOfPrevious: boolean;
  }>;
  resolveLegacyPreset: (shot: Record<string, unknown>, localTime: number, dur: number, W?: number, H?: number) => CameraRig;
  resolve: (
    story: Record<string, unknown>,
    shot: Record<string, unknown>,
    localTime: number,
    dur: number,
    options?: Record<string, unknown>,
  ) => { rig: CameraRig; report: CameraReportEntry };
  projectBox2D: (
    box: { minX: number; minY: number; maxX: number; maxY: number },
    rig: CameraRig,
    W: number,
    H: number,
  ) => { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  compute3DPose: (
    baseCamPos: [number, number, number],
    baseLookAt: [number, number, number],
    rig: CameraRig,
  ) => { position: [number, number, number]; lookAt: [number, number, number]; rollRad: number };
}

function loadStoryCamera(): { api: StoryCameraApi; code: string; win: Record<string, unknown> } {
  const camPath = path.resolve(__dirname, "../../public/script/story-camera.js");
  const code = fs.readFileSync(camPath, "utf8");
  const win: Record<string, unknown> = {};
  const sandbox: Record<string, unknown> = {
    window: win,
    globalThis: win,
    console,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
  };
  vm.runInNewContext(code, sandbox);
  return { api: (win as { StoryCamera: StoryCameraApi }).StoryCamera, code, win };
}

// Reference copy of cobalt-kit.js original CAMERA_PRESETS & resolveCamera for C1(c) exact parity test.
function evalOriginalCobaltCamera(presetName: string, localTime: number, dur: number) {
  const PRESETS: Record<string, {
    zoomFrom: number; zoomTo: number; pivotX: number; pivotY: number;
    panXFrom: number; panXTo: number; panYFrom: number; panYTo: number;
    rollFromDeg: number; rollToDeg: number; curve: string; velocityBlur: number;
  }> = {
    static: { zoomFrom: 1.0, zoomTo: 1.0, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, curve: "whip-out", velocityBlur: 0 },
    "dolly-in": { zoomFrom: 0.92, zoomTo: 1.18, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 14, panYTo: -8, rollFromDeg: 0, rollToDeg: 0, curve: "whip-out", velocityBlur: 1.2 },
    "macro-pullback": { zoomFrom: 3.1, zoomTo: 1.0, pivotX: 0.28, pivotY: 0.34, panXFrom: -24, panXTo: 0, panYFrom: 18, panYTo: 0, rollFromDeg: 2.8, rollToDeg: 0, curve: "whip-out", velocityBlur: 4.2 },
    "macro-zoom-in": { zoomFrom: 1.0, zoomTo: 2.35, pivotX: 0.32, pivotY: 0.45, panXFrom: 0, panXTo: 20, panYFrom: 0, panYTo: -16, rollFromDeg: 0, rollToDeg: -1.8, curve: "whip-inout", velocityBlur: 3.8 },
    "pan-sweep": { zoomFrom: 1.16, zoomTo: 1.02, pivotX: 0.5, pivotY: 0.5, panXFrom: 120, panXTo: -95, panYFrom: 0, panYTo: 0, rollFromDeg: 1.8, rollToDeg: -1.4, curve: "whip-out", velocityBlur: 2.6 },
    "tilt-push": { zoomFrom: 0.88, zoomTo: 1.42, pivotX: 0.55, pivotY: 0.55, panXFrom: -20, panXTo: 10, panYFrom: 52, panYTo: -22, rollFromDeg: -4.5, rollToDeg: 0.6, curve: "whip-out", velocityBlur: 3.0 },
    "rack-focus-in": { zoomFrom: 1.32, zoomTo: 1.0, pivotX: 0.5, pivotY: 0.5, panXFrom: 0, panXTo: 0, panYFrom: 0, panYTo: 0, rollFromDeg: 0, rollToDeg: 0, curve: "whip-out", velocityBlur: 5.5 },
  };
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const easeOutExpo = (x: number) => {
    const c = clamp(x, 0, 1);
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  };
  const easeInOutExpo = (x: number) => {
    const c = clamp(x, 0, 1);
    if (c === 0) return 0;
    if (c === 1) return 1;
    return c < 0.5 ? Math.pow(2, 20 * c - 10) * 0.5 : (2 - Math.pow(2, -20 * c + 10)) * 0.5;
  };
  const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const base = PRESETS[presetName];
  const span = Math.max(0.28, Math.min(dur * 0.68, 0.95));
  const u = clamp(localTime / span, 0, 1);
  const uPrev = clamp((localTime - 0.033) / span, 0, 1);
  const evalC = (x: number) => (base.curve === "whip-inout" ? easeInOutExpo(x) : easeOutExpo(x));
  const p = evalC(u);
  const pPrev = evalC(uPrev);
  const vel = Math.abs(p - pPrev) / 0.033;
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const enterMotionBlur =
    Math.abs(base.zoomTo - base.zoomFrom) > 0.02 ||
    Math.abs(base.panXTo - base.panXFrom) > 4 ||
    Math.abs(base.panYTo - base.panYFrom) > 4
      ? (1 - easeOutCubic(clamp(localTime / 0.26, 0, 1))) * 4.5
      : 0;
  const autoBlur = clamp(vel * 0.95 * base.velocityBlur, 0, 14.0);
  return {
    zoom: lerp(base.zoomFrom, base.zoomTo),
    pivotX: base.pivotX,
    pivotY: base.pivotY,
    panX: lerp(base.panXFrom, base.panXTo),
    panY: lerp(base.panYFrom, base.panYTo),
    rollRad: (lerp(base.rollFromDeg, base.rollToDeg) * Math.PI) / 180,
    blur: Math.max(0, autoBlur, 0, enterMotionBlur),
  };
}

describe("apps/public/script/story-camera.js (Camera API v1)", () => {
  it("(a) same seed -> identical sequence & rig; different seed -> different sequence/rig", () => {
    const { api } = loadStoryCamera();
    expect(api.version).toBe(1);
    expect(Object.keys(api.MOVES).length).toBeGreaterThanOrEqual(10);

    const makeStory = (seed: number) => ({
      seed,
      cameraStyle: "editorial",
      canvas: { w: 1280, h: 720, fps: 30 },
      shots: [
        { id: "s1", start: 0, duration: 3 },
        { id: "s2", start: 3, duration: 3 },
        { id: "s3", start: 6, duration: 3 },
        { id: "s4", start: 9, duration: 3 },
      ],
    });

    const p1a = api.planStoryMoves(makeStory(101));
    const p1b = api.planStoryMoves(makeStory(101));
    const p2 = api.planStoryMoves(makeStory(202));
    expect(p1a).toEqual(p1b);

    const moves1 = Object.values(p1a).map((v) => `${v.move}:${v.dir}:${v.intensity}`);
    const moves2 = Object.values(p2).map((v) => `${v.move}:${v.dir}:${v.intensity}`);
    expect(moves1).not.toEqual(moves2);
  });

  it("(b) absent camera/cameraStyle or intensity=0 -> exact identity rig (2D & 3D)", () => {
    const { api } = loadStoryCamera();
    const storyNoCam = {
      seed: 42,
      canvas: { w: 1080, h: 1920, fps: 30 },
      shots: [{ id: "s1", start: 0, duration: 4 }],
    };
    const rAbsent = api.resolve(storyNoCam, storyNoCam.shots[0], 1.5, 4);
    expect(rAbsent.rig).toMatchObject({
      dolly: 1,
      zoom: 1,
      truckX: 0,
      truckY: 0,
      panX: 0,
      panY: 0,
      orbitAz: 0,
      tiltEl: 0,
      roll: 0,
      rollRad: 0,
      blur: 0,
    });
    const pose3d = api.compute3DPose([1, 4, 8], [0, 0.3, 0], rAbsent.rig);
    expect(pose3d.position).toEqual([1, 4, 8]);
    expect(pose3d.lookAt).toEqual([0, 0.3, 0]);
    expect(pose3d.rollRad).toBe(0);

    const storyZero = {
      seed: 42,
      cameraStyle: "kinetic",
      canvas: { w: 1280, h: 720, fps: 30 },
      shots: [{ id: "s1", start: 0, duration: 3, camera: { move: "pan", intensity: 0 } }],
    };
    const rZero = api.resolve(storyZero, storyZero.shots[0], 1.2, 3);
    expect(rZero.rig.zoom).toBe(1);
    expect(rZero.rig.panX).toBe(0);
    expect(rZero.rig.panY).toBe(0);
    expect(rZero.rig.rollRad).toBe(0);
  });

  it("(c) LEGACY_PRESETS matches original cobalt CAMERA_PRESETS within <= 1e-6 on 5 times x 7 presets", () => {
    const { api } = loadStoryCamera();
    const presetNames = Object.keys(api.LEGACY_PRESETS);
    expect(presetNames).toHaveLength(7);
    const times = [0.0, 0.15, 0.45, 0.9, 2.2];
    const dur = 3.0;
    let maxDiff = 0;

    for (const preset of presetNames) {
      for (const t of times) {
        const expected = evalOriginalCobaltCamera(preset, t, dur);
        const actual = api.resolveLegacyPreset({ id: "s", cameraPreset: preset }, t, dur, 1280, 720);
        for (const k of ["zoom", "pivotX", "pivotY", "panX", "panY", "rollRad", "blur"] as const) {
          const d = Math.abs(actual[k] - expected[k]);
          if (d > maxDiff) maxDiff = d;
          expect(d).toBeLessThanOrEqual(1e-6);
        }
      }
    }
    expect(maxDiff).toBeLessThanOrEqual(1e-6);
  });

  it("(d) framing guard reduces intensity until focusBox fits safeZone, and reports unmeasured without bbox", () => {
    const { api } = loadStoryCamera();
    const safe = { minX: 110, maxX: 1170, minY: 80, maxY: 640 };
    // Large wide focus box close to edges; aggressive pan/zoom would push it out of safeZone
    const focusBox = { minX: 145, maxX: 1135, minY: 220, maxY: 500 };
    const story = {
      seed: 7,
      canvas: { w: 1280, h: 720, fps: 30 },
      shots: [{ id: "s1", start: 0, duration: 3, camera: { move: "whip", dir: "right", intensity: 1.0 } }],
    };

    const guarded = api.resolve(story, story.shots[0], 2.5, 3, {
      W: 1280,
      H: 720,
      safe,
      focusBox,
    });
    expect(guarded.report.guard).toBe("clamped");
    expect(guarded.report.intensity).toBeLessThan(1.0);
    const projected = api.projectBox2D(focusBox, guarded.rig, 1280, 720);
    expect(projected.minX).toBeGreaterThanOrEqual(safe.minX);
    expect(projected.maxX).toBeLessThanOrEqual(safe.maxX);
    expect(projected.minY).toBeGreaterThanOrEqual(safe.minY);
    expect(projected.maxY).toBeLessThanOrEqual(safe.maxY);

    const unmeasured = api.resolve(story, story.shots[0], 1.5, 3, {
      W: 1280,
      H: 720,
      safe,
      limits: { maxZoom: 1.2, maxPan: 0.05, maxRollDeg: 2 },
    });
    expect(unmeasured.report.guard).toBe("unmeasured");
    expect(unmeasured.rig.zoom).toBeLessThanOrEqual(1.2 + 1e-6);
    expect(Math.abs(unmeasured.rig.truckX)).toBeLessThanOrEqual(0.05 + 1e-6);
  });

  it("(e) move director produces repeatOfPrevious = false across 10 consecutive shots", () => {
    const { api } = loadStoryCamera();
    for (const style of ["calm", "kinetic", "editorial"]) {
      for (const seed of [1, 42, 777, 9999]) {
        const shots = Array.from({ length: 10 }, (_, idx) => ({
          id: `s${idx + 1}`,
          start: idx * 3,
          duration: 3,
        }));
        const plans = api.planStoryMoves({ seed, cameraStyle: style, shots });
        const list = shots.map((sh) => plans[sh.id]);
        for (let i = 1; i < list.length; i++) {
          expect(list[i].repeatOfPrevious).toBe(false);
          expect(list[i].move).not.toBe(list[i - 1].move);
          if (list[i].dir !== "none" && list[i - 1].dir !== "none") {
            expect(list[i].dir).not.toBe(list[i - 1].dir);
          }
        }
      }
    }
  });

  it("(f) source contains zero Math.random or Date.now calls", () => {
    const { code } = loadStoryCamera();
    expect(code).not.toMatch(/\bMath\.random\b/);
    expect(code).not.toMatch(/\bDate\.now\b/);
  });
});
