import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function loadPostAndAm() {
  const postCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-post.js"),
    "utf8",
  );
  const amCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
    "utf8",
  );
  const fakeWin: Record<string, unknown> = {};
  new Function("window", postCode)(fakeWin);
  new Function("window", amCode)(fakeWin);
  return {
    AetheriaPost: fakeWin.AetheriaPost as {
      version: number;
      createPipeline: (w: number, h: number, opts?: Record<string, unknown>) => {
        isWebGL: () => boolean;
        getStats: () => { backend: string; width: number; height: number; disposed: boolean; passesRun: number };
        resize: (w: number, h: number) => void;
        apply: (src: unknown, ctx: unknown, t: number, opts: Record<string, unknown>) => boolean;
        dispose: () => void;
      };
      apply: (ctx: unknown, t: number, opts: Record<string, unknown>) => boolean;
      hasActiveEffect: (opts: Record<string, unknown>) => boolean;
      normalizePassOpts: (opts: Record<string, unknown>) => Record<string, unknown>;
      SHADERS: Record<string, string>;
    },
    AM: fakeWin.AM as {
      postProcess: (ctx: unknown, t: number, opts: Record<string, unknown>) => boolean;
    },
  };
}

describe("AetheriaPost Modular WebGL2 Post-Processing Runtime (Phase 2)", () => {
  it("exports valid GLSL 300 es shaders and detects inactive vs active pass options", () => {
    const { AetheriaPost } = loadPostAndAm();
    expect(AetheriaPost.version).toBe(1);
    for (const key of ["VS_FULLSCREEN", "FS_THRESHOLD", "FS_BLUR", "FS_COMPOSITE"]) {
      expect(AetheriaPost.SHADERS[key]).toContain("#version 300 es");
    }
    expect(AetheriaPost.hasActiveEffect(AetheriaPost.normalizePassOpts({}))).toBe(false);
    expect(AetheriaPost.hasActiveEffect(AetheriaPost.normalizePassOpts({ bloom: 0.4 }))).toBe(true);
    expect(AetheriaPost.hasActiveEffect(AetheriaPost.normalizePassOpts({ enabled: false, bloom: 0.9 }))).toBe(false);
  });

  it("executes deterministic Canvas 2D fallback cleanly when WebGL2 is unavailable and supports dispose()", () => {
    const { AetheriaPost, AM } = loadPostAndAm();
    const pipe = AetheriaPost.createPipeline(320, 180, { forceFallback2D: true });
    expect(pipe.isWebGL()).toBe(false);

    const opsRun1: string[] = [];
    const opsRun2: string[] = [];
    const makeMockCtx = (ops: string[]) => ({
      canvas: { width: 320, height: 180 },
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      fillStyle: "",
      save: () => {},
      restore: () => {},
      drawImage: () => ops.push("drawImage"),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: (x: number, y: number, w: number, h: number) =>
        ops.push(`rect:${Math.round(x)},${Math.round(y)},${w},${h}`),
    });

    const opts = { bloom: 0.5, vignette: 0.4, grain: 0.05, contrast: 1.1, fps: 30, forceFallback2D: true };
    expect(pipe.apply({ width: 320, height: 180 }, makeMockCtx(opsRun1), 1.5, opts)).toBe(true);
    expect(pipe.apply({ width: 320, height: 180 }, makeMockCtx(opsRun2), 1.5, opts)).toBe(true);
    expect(opsRun1.length).toBeGreaterThan(20);
    // Identical timestamp produces bit-for-bit identical grain & vignette draw ops
    expect(opsRun1).toEqual(opsRun2);

    // AM.postProcess bridge works seamlessly
    const bridgeOps: string[] = [];
    expect(AM.postProcess(makeMockCtx(bridgeOps), 1.5, opts)).toBe(true);
    expect(bridgeOps.length).toBeGreaterThan(20);

    pipe.resize(640, 360);
    expect(pipe.getStats().width).toBe(640);
    expect(pipe.getStats().height).toBe(360);
    pipe.dispose();
    expect(pipe.getStats().disposed).toBe(true);
    expect(pipe.apply({ width: 640, height: 360 }, makeMockCtx([]), 1.5, opts)).toBe(false);
  });
});
