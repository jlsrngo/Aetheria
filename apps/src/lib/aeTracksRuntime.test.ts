import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface TracksApi {
  version: number;
  EASE_PRESETS: Record<
    string,
    { out: { influence: number; speed: number }; in: { influence: number; speed: number } }
  >;
  easeProgress: (...args: unknown[]) => number;
  resolveEase: (spec: unknown, side?: string) => unknown;
  evaluateTrack: (keys: unknown[], t: number, opts?: { spatial?: boolean }) => number | number[];
  velocityAt: (keys: unknown[], t: number, opts?: { spatial?: boolean }) => number | number[];
}

function loadTracksSandbox(includeTracks = true) {
  const camCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "story-camera.js"),
    "utf8",
  );
  const tracksCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-tracks.js"),
    "utf8",
  );
  const stageCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-stage.js"),
    "utf8",
  );
  const amCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
    "utf8",
  );

  const fakeWin: Record<string, unknown> = {};
  new Function("window", camCode)(fakeWin);
  if (includeTracks) {
    new Function("window", tracksCode)(fakeWin);
  }
  new Function("window", stageCode)(fakeWin);
  new Function("window", amCode)(fakeWin);

  return {
    fakeWin,
    AetheriaTracks: fakeWin.AetheriaTracks as TracksApi | undefined,
    AetheriaStage: fakeWin.AetheriaStage as {
      createStage: (opts: Record<string, unknown>) => {
        addLayer: (spec: Record<string, unknown>) => unknown;
        resolveWorldState: (t: number) => Record<
          string,
          {
            matrix: number[];
            opacity: number;
            visible: boolean;
          }
        >;
      };
    },
    AM: fakeWin.AM as {
      evalTrack: (keys: unknown[], t: number, opts?: { spatial?: boolean }) => number | number[] | null;
      createStage: (opts: Record<string, unknown>) => unknown;
    },
  };
}

describe("AetheriaTracks AE Keyframe & Stage Integration (Tahap 1)", () => {
  it("evaluates linear preset, easeInOut symmetry, 100%-influence exact inverse, and accelerate/decelerate", () => {
    const { AetheriaTracks } = loadTracksSandbox();
    expect(AetheriaTracks).toBeDefined();
    const T = AetheriaTracks!;

    for (const x of [0.1, 0.5, 0.9]) {
      expect(T.easeProgress("linear", x)).toBeCloseTo(x, 9);
    }

    expect(T.easeProgress("easeInOut", 0.5)).toBeCloseTo(0.5, 9);
    expect(T.easeProgress("easeInOut", 0.25)).toBeLessThan(0.25);
    expect(T.easeProgress("easeInOut", 0.75)).toBeCloseTo(
      1 - T.easeProgress("easeInOut", 0.25),
      9,
    );

    expect(T.easeProgress(0, 1, 0, 1, 0)).toBe(0);
    expect(T.easeProgress(0, 1, 0, 1, 1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const y = T.easeProgress(0, 1, 0, 1, i / 20);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }

    expect(T.easeProgress("decelerate", 0.2)).toBeGreaterThan(0.2);
    expect(T.easeProgress("accelerate", 0.2)).toBeLessThan(0.2);
  });

  it("handles clamping, single-key tracks, hold keys, and rejects malformed tracks or unknown presets", () => {
    const { AetheriaTracks } = loadTracksSandbox();
    const T = AetheriaTracks!;

    const single = [{ t: 1.0, v: [42, 84] }];
    const sRes = T.evaluateTrack(single, 0.2) as number[];
    expect(sRes).toEqual([42, 84]);
    sRes[0] = 999;
    expect(T.evaluateTrack(single, 3.0)).toEqual([42, 84]);

    const holdTrack = [
      { t: 0, v: 10, hold: true },
      { t: 1, v: 90, ease: "easeInOut" },
      { t: 2, v: 190 },
    ];
    expect(T.evaluateTrack(holdTrack, -1)).toBe(10);
    expect(T.evaluateTrack(holdTrack, 0.5)).toBe(10);
    expect(T.evaluateTrack(holdTrack, 0.999)).toBe(10);
    expect(T.evaluateTrack(holdTrack, 1.0)).toBe(90);
    expect(T.evaluateTrack(holdTrack, 1.5)).toBeCloseTo(140, 6);
    expect(T.evaluateTrack(holdTrack, 5.0)).toBe(190);

    expect(() =>
      T.evaluateTrack(
        [
          { t: 0, v: [1, 2] },
          { t: 0.5, v: [1, 2, 3] },
        ],
        0.25,
      ),
    ).toThrow(/3 components, expected 2/);

    expect(() =>
      T.evaluateTrack(
        [
          { t: 0, v: 0, ease: "nonExistentPreset" },
          { t: 1, v: 100 },
        ],
        0.5,
      ),
    ).toThrow(/unknown ease preset 'nonExistentPreset'/);
  });

  it("moves at uniform arc-length speed along curved spatial paths and holds on duplicate keys", () => {
    const { AetheriaTracks } = loadTracksSandbox();
    const T = AetheriaTracks!;

    const curved = [
      { t: 0, v: [0, 0] },
      { t: 1, v: [300, -240] },
      { t: 2, v: [600, 0] },
    ];
    const samples: number[][] = [];
    for (let i = 0; i <= 40; i++) {
      samples.push(T.evaluateTrack(curved, i / 40, { spatial: true }) as number[]);
    }
    const stepDists: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i][0] - samples[i - 1][0];
      const dy = samples[i][1] - samples[i - 1][1];
      stepDists.push(Math.hypot(dx, dy));
    }
    const mean = stepDists.reduce((a, b) => a + b, 0) / stepDists.length;
    const variance =
      stepDists.reduce((acc, d) => acc + (d - mean) * (d - mean), 0) / stepDists.length;
    const cv = Math.sqrt(variance) / mean;
    expect(cv).toBeLessThan(0.01);

    const dupHold = [
      { t: 0, v: [10, 20] },
      { t: 1, v: [200, 120] },
      { t: 2, v: [200, 120] },
      { t: 3, v: [400, 300] },
    ];
    for (const t of [1.1, 1.5, 1.9]) {
      const p = T.evaluateTrack(dupHold, t, { spatial: true }) as number[];
      expect(p[0]).toBeCloseTo(200, 9);
      expect(p[1]).toBeCloseTo(120, 9);
    }
  });

  it("computes central-difference velocityAt and delegates AM.evalTrack", () => {
    const { AetheriaTracks, AM } = loadTracksSandbox();
    const T = AetheriaTracks!;

    const linearTrack = [
      { t: 0, v: [10, 50] },
      { t: 2, v: [110, 250] },
    ];
    const vel = T.velocityAt(linearTrack, 1.0) as number[];
    expect(vel[0]).toBeCloseTo(50, 6);
    expect(vel[1]).toBeCloseTo(100, 6);

    const delegated = AM.evalTrack(linearTrack, 0.5) as number[];
    expect(delegated[0]).toBeCloseTo(35, 9);
    expect(delegated[1]).toBeCloseTo(100, 9);
  });

  it("applies layer.tracks in AetheriaStage before update(), rejects unknown tracks, and handles missing AetheriaTracks", () => {
    const { AetheriaStage } = loadTracksSandbox(true);
    const stage = AetheriaStage.createStage({ width: 1000, height: 1000 });

    stage.addLayer({
      id: "hero",
      kind: "canvas2d",
      width: 100,
      height: 100,
      anchor: [0, 0],
      tracks: {
        position: [
          { t: 0, v: [100, 200] },
          { t: 1, v: [300, 400] },
        ],
        rotationDeg: [
          { t: 0, v: 0 },
          { t: 1, v: 90 },
        ],
        opacity: [
          { t: 0, v: 0.2 },
          { t: 1, v: 0.8 },
        ],
      },
    });

    stage.addLayer({
      id: "overridden",
      kind: "canvas2d",
      width: 100,
      height: 100,
      anchor: [0, 0],
      tracks: {
        x: [
          { t: 0, v: 10 },
          { t: 1, v: 90 },
        ],
      },
      update: (layer: { x: number }) => {
        layer.x += 1000;
      },
    });

    const world = stage.resolveWorldState(0.5);
    expect(world.hero.matrix[4]).toBeCloseTo(200, 6);
    expect(world.hero.matrix[5]).toBeCloseTo(300, 6);
    expect(Math.atan2(world.hero.matrix[1], world.hero.matrix[0])).toBeCloseTo(Math.PI / 4, 6);
    expect(world.hero.opacity).toBeCloseTo(0.5, 6);

    expect(world.overridden.matrix[4]).toBeCloseTo(1050, 6);

    expect(() =>
      stage.addLayer({
        id: "bad",
        tracks: { nonexistentProp: [{ t: 0, v: 1 }] },
      }),
    ).toThrow(/unknown track 'nonexistentProp'/);

    const noTracksSandbox = loadTracksSandbox(false);
    const fallbackStage = noTracksSandbox.AetheriaStage.createStage({ width: 500, height: 500 });
    fallbackStage.addLayer({
      id: "box",
      x: 77,
      y: 88,
      tracks: { x: [{ t: 0, v: 10 }, { t: 1, v: 20 }] },
    });
    const fbWorld = fallbackStage.resolveWorldState(0.5);
    expect(fbWorld.box.matrix[4]).toBeCloseTo(77, 6);
    const errors = noTracksSandbox.fakeWin.__aetheriaErrors as string[];
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("AetheriaTracks");
  });
});
