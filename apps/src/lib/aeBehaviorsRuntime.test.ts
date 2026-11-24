import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface BehaviorsApi {
  version: number;
  PRESET_NAMES: string[];
  wiggle: (t: number, freq: number, amp: number, opts?: Record<string, unknown>) => number | number[];
  loopTrack: (keys: unknown[], t: number, opts?: Record<string, unknown>) => number | number[];
  applyBehaviors: (
    state: Record<string, number>,
    t: number,
    behaviors: unknown[],
    seedBase?: string,
  ) => Record<string, number>;
}

function loadBehaviorsSandbox() {
  const camCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "story-camera.js"), "utf8");
  const tracksCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-tracks.js"), "utf8");
  const behaviorsCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-behaviors.js"),
    "utf8",
  );
  const stageCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-stage.js"), "utf8");
  const amCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"), "utf8");

  const fakeWin: Record<string, unknown> = {};
  new Function("window", camCode)(fakeWin);
  new Function("window", tracksCode)(fakeWin);
  new Function("window", behaviorsCode)(fakeWin);
  new Function("window", stageCode)(fakeWin);
  new Function("window", amCode)(fakeWin);

  return {
    AetheriaBehaviors: fakeWin.AetheriaBehaviors as BehaviorsApi,
    AetheriaStage: fakeWin.AetheriaStage as {
      createStage: (opts: Record<string, unknown>) => {
        addLayer: (spec: Record<string, unknown>) => unknown;
        resolveWorldState: (t: number) => Record<string, { matrix: number[]; opacity: number }>;
      };
    },
    AM: fakeWin.AM as {
      wiggle: (t: number, freq: number, amp: number, opts?: Record<string, unknown>) => number | number[];
      loopTrack: (keys: unknown[], t: number, opts?: Record<string, unknown>) => number | number[];
    },
  };
}

describe("AetheriaBehaviors Wiggle, LoopTrack, 22 Presets & FollowLag (Tahap 2)", () => {
  it("evaluates deterministic overflow-safe wiggle and exposes all 22 EffectCraft presets", () => {
    const { AetheriaBehaviors, AM } = loadBehaviorsSandbox();
    expect(AetheriaBehaviors.PRESET_NAMES).toHaveLength(22);

    const w1 = AM.wiggle(1.25, 2, 30, { dims: 2, seed: "card" }) as number[];
    const w2 = AM.wiggle(1.25, 2, 30, { dims: 2, seed: "card" }) as number[];
    expect(w1).toEqual(w2);
    expect(Math.abs(w1[0])).toBeLessThanOrEqual(30);
    expect(Math.abs(w1[1])).toBeLessThanOrEqual(30);

    // Overflow guard (#786): huge frequency * time remains finite and bounded
    const huge = AetheriaBehaviors.wiggle(1e6, 9007199254740993, 30, { dims: 2, octaves: 1 }) as number[];
    expect(Number.isFinite(huge[0]) && Math.abs(huge[0]) <= 30).toBe(true);
    expect(Number.isFinite(huge[1]) && Math.abs(huge[1]) <= 30).toBe(true);

    // Every preset runs cleanly on a baseline layer state
    for (const preset of AetheriaBehaviors.PRESET_NAMES) {
      const st = { x: 100, y: 200, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
      AetheriaBehaviors.applyBehaviors(st, 0.37, [preset], "test");
      expect(Number.isFinite(st.x) && Number.isFinite(st.y)).toBe(true);
      expect(Number.isFinite(st.scaleX) && Number.isFinite(st.scaleY)).toBe(true);
      expect(Number.isFinite(st.rotation) && Number.isFinite(st.opacity)).toBe(true);
    }
  });

  it("evaluates loopTrack cycle, pingpong, offset, continue, and loopIn", () => {
    const { AM } = loadBehaviorsSandbox();
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 100 },
    ];
    expect(AM.loopTrack(keys, 1.25, { type: "cycle" })).toBeCloseTo(25, 6);
    expect(AM.loopTrack(keys, 1.25, { type: "pingpong" })).toBeCloseTo(75, 6);
    expect(AM.loopTrack(keys, 2.25, { type: "pingpong" })).toBeCloseTo(25, 6);
    expect(AM.loopTrack(keys, 2.25, { type: "offset" })).toBeCloseTo(225, 6);
    expect(AM.loopTrack(keys, 2.0, { type: "continue" })).toBeCloseTo(200, 3);
    expect(AM.loopTrack(keys, -0.25, { direction: "in", type: "cycle" })).toBeCloseTo(75, 6);
    expect(AM.loopTrack(keys, -0.25, { direction: "in", type: "continue" })).toBeCloseTo(-25, 3);
  });

  it("layers additive behaviors non-destructively on tracks and supports parent-child followLag", () => {
    const { AetheriaStage } = loadBehaviorsSandbox();
    const stage = AetheriaStage.createStage({ width: 800, height: 600 });

    stage.addLayer({
      id: "parent",
      kind: "canvas2d",
      width: 100,
      height: 100,
      anchor: [0, 0],
      tracks: {
        x: [
          { t: 0, v: 100 },
          { t: 1, v: 300 },
        ],
      },
      behaviors: [{ preset: "floatUpDown", amp: 20, freq: Math.PI }],
    });

    stage.addLayer({
      id: "child_lagged",
      parentId: "parent",
      followLag: 0.2,
      kind: "canvas2d",
      x: 50,
      y: 0,
      width: 40,
      height: 40,
      anchor: [0, 0],
    });

    // Calling resolveWorldState twice at the same t must be idempotent (no accumulation drift!)
    const wA = stage.resolveWorldState(0.5);
    const wB = stage.resolveWorldState(0.5);
    expect(wA.parent.matrix[4]).toBeCloseTo(200, 6);
    expect(wA.parent.matrix[5]).toBeCloseTo(20, 6); // sin(0.5 * PI) * 20 = 20
    expect(wB.parent.matrix[5]).toBeCloseTo(wA.parent.matrix[5], 9);

    // Child lagged by 0.2s sees parent at t = 0.3s: x = 160 + local 50 = 210
    expect(wA.child_lagged.matrix[4]).toBeCloseTo(210, 6);
    expect(wA.child_lagged.matrix[5]).toBeCloseTo(Math.sin(0.3 * Math.PI) * 20, 6);

    expect(() =>
      stage.addLayer({ id: "bad_beh", behaviors: ["notARealBehavior"] }),
    ).toThrow(/unknown behavior preset 'notARealBehavior'/);

    expect(() =>
      stage.addLayer({ id: "bad_lag", parentId: "parent", followLag: -0.1 }),
    ).toThrow(/followLag/);
  });
});
