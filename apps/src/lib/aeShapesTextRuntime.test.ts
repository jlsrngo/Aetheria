import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface ShapePath {
  vertices: number[][];
  inTangents: number[][];
  outTangents: number[][];
  closed: boolean;
}

interface ShapesTextApi {
  version: number;
  TEXT_PRESET_NAMES: string[];
  evalTextSelector: (sel: Record<string, unknown>, idx: number, count: number, t: number) => number;
  combineSelector: (acc: number, v: number, mode: string) => number;
  drawAnimatedText: (ctx: unknown, text: string, x: number, y: number, t: number, opts?: Record<string, unknown>) => { renderedChars: number };
  rectPath: (w: number, h: number, cx?: number, cy?: number, roundness?: number) => ShapePath;
  ellipsePath: (w: number, h: number, cx?: number, cy?: number) => ShapePath;
  polystarPath: (opts?: Record<string, unknown>) => ShapePath;
  trimPaths: (paths: ShapePath | ShapePath[], opts?: Record<string, unknown>) => ShapePath[];
  roundCorners: (paths: ShapePath | ShapePath[], radius: number) => ShapePath[];
  puckerBloat: (paths: ShapePath | ShapePath[], amount: number) => ShapePath[];
  wigglePaths: (paths: ShapePath | ShapePath[], params: Record<string, unknown>, t: number) => ShapePath[];
  morphPath: (a: ShapePath, b: ShapePath, u: number, opts?: Record<string, unknown>) => ShapePath;
  repeatDraw: (ctx: unknown, opts: Record<string, unknown>, drawFn: (c: unknown, i: number, k: number, alpha: number) => void) => number;
}

function loadShapesTextSandbox() {
  const stCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-shapes-text.js"), "utf8");
  const amCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"), "utf8");
  const fakeWin: Record<string, unknown> = {};
  new Function("window", stCode)(fakeWin);
  new Function("window", amCode)(fakeWin);
  return {
    ST: fakeWin.AetheriaShapesText as ShapesTextApi,
    AM: fakeWin.AM as Record<string, (...args: unknown[]) => unknown>,
  };
}

function makeFakeCtx() {
  const ops: Array<{ op: string; args: unknown[] }> = [];
  return {
    ops,
    globalAlpha: 1,
    font: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    filter: "none",
    save: () => ops.push({ op: "save", args: [] }),
    restore: () => ops.push({ op: "restore", args: [] }),
    translate: (x: number, y: number) => ops.push({ op: "translate", args: [x, y] }),
    rotate: (a: number) => ops.push({ op: "rotate", args: [a] }),
    scale: (x: number, y: number) => ops.push({ op: "scale", args: [x, y] }),
    measureText: (s: string) => ({ width: s.length * 20 }),
    fillText: (ch: string, x: number, y: number) => ops.push({ op: "fillText", args: [ch, x, y] }),
    strokeText: () => {},
  };
}

describe("AetheriaShapesText AE Text Animators & Path Operators (Tahap 3)", () => {
  it("evaluates Range & Wiggly selectors, combine modes, and all 8 text presets", () => {
    const { ST } = loadShapesTextSandbox();
    expect(ST.TEXT_PRESET_NAMES).toHaveLength(8);

    // RampUp holds 1.0 past end and 0 before start
    expect(ST.evalTextSelector({ kind: "range", shape: "rampUp", start: 20, end: 80 }, 0, 10, 0)).toBe(0);
    expect(ST.evalTextSelector({ kind: "range", shape: "rampUp", start: 20, end: 80 }, 9, 10, 0)).toBe(1);
    expect(ST.evalTextSelector({ kind: "range", shape: "triangle", start: 0, end: 100 }, 5, 11, 0)).toBeCloseTo(1, 6);
    expect(ST.combineSelector(0.4, 0.7, "subtract")).toBe(0);
    expect(ST.combineSelector(0.5, 0.5, "intersect")).toBeCloseTo(0.25, 6);

    for (const preset of ST.TEXT_PRESET_NAMES) {
      const ctx = makeFakeCtx();
      const res = ST.drawAnimatedText(ctx, "HELLO WORLD", 320, 180, 0.65, { preset, startSec: 0, durationSec: 1.0 });
      expect(res.renderedChars).toBeGreaterThanOrEqual(0);
    }

    expect(() => ST.drawAnimatedText(makeFakeCtx(), "HI", 0, 0, 0, { preset: "unknownTextPreset" })).toThrow(
      /unknown text preset/,
    );
  });

  it("trims paths accurately by arc length, rounds corners, puckers/bloats, wiggles, morphs, and repeats", () => {
    const { ST, AM } = loadShapesTextSandbox();

    const sq = ST.rectPath(100, 100, 0, 0, 0);
    // 50% of 400px perimeter -> 2 sides -> 200px total length
    const trimmed = ST.trimPaths(sq, { start: 0, end: 50, offset: 0 });
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].vertices.length).toBeGreaterThanOrEqual(3);
    expect(trimmed[0].closed).toBe(false);

    // Wrap-around offset stays 1 unbroken chain across seam
    const wrapped = ST.trimPaths(sq, { start: 0, end: 25, offset: 315 });
    expect(wrapped).toHaveLength(1);

    const rounded = ST.roundCorners(sq, 12);
    expect(rounded[0].vertices.length).toBe(8);

    const bloated = ST.puckerBloat(sq, 40);
    expect(bloated[0].vertices[0][0]).toBeCloseTo(30, 6);

    const wiggled1 = ST.wigglePaths(sq, { size: 8, detail: 2, seed: 5 }, 0.5);
    const wiggled2 = ST.wigglePaths(sq, { size: 8, detail: 2, seed: 5 }, 0.5);
    expect(wiggled1).toEqual(wiggled2);

    // Morph triangle (3 verts) -> 5-point star (10 verts) cleanly preserves target vertex count
    const tri = ST.polystarPath({ points: 3, star: false, outerRadius: 60 });
    const star = ST.polystarPath({ points: 5, star: true, outerRadius: 80, innerRadius: 35 });
    const mid = AM.morphPath(tri, star, 0.5, { bendingResistance: 60 }) as ShapePath;
    expect(mid.vertices.length).toBe(10);

    // Repeater AE 2026 opacity step rule: 3 copies, start 100%, end 40% -> 1.0, 0.8, 0.6
    const alphas: number[] = [];
    const ctx = makeFakeCtx();
    ST.repeatDraw(
      ctx,
      { copies: 3, position: [50, 0], startOpacity: 100, endOpacity: 40, composite: "above" },
      (_c, _i, _k, alpha) => alphas.push(Number(alpha.toFixed(2))),
    );
    expect(alphas).toEqual([1, 0.8, 0.6]);
  });
});
