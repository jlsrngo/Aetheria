import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface StoryCoreApi {
  version: number;
  clamp: (v: number, lo: number, hi: number) => number;
  easeOutCubic: (x: number) => number;
  isMicrostock: (story?: Record<string, unknown>, override?: boolean) => boolean;
  computeSafeZone: (w: number, h: number) => {
    x: number;
    y: number;
    w: number;
    h: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  isBoxInsideSafeZone: (
    box: { minX: number; maxX: number; minY: number; maxY: number },
    safe: { minX: number; maxX: number; minY: number; maxY: number },
  ) => boolean;
  normalizeStory: (raw: unknown) => {
    title?: string;
    theme?: string;
    canvas: { w: number; h: number; fps: number };
    captions: { enabled: boolean; items?: Array<{ start: number; duration: number; text: string }> };
    shots: Array<{ id: string; start: number; duration: number; layout?: string }>;
  };
  findShot: (
    story: unknown,
    t: number,
  ) => { shot: { id: string }; index: number; start: number; duration: number; localTime: number } | null;
  findCaption: (story: unknown, t: number) => { text: string } | null;
  synthesizeWords: (text: string, start: number, duration: number) => Array<{ word: string; start: number; end: number }>;
  computeTotalDuration: (story: unknown) => number;
}

function loadStoryCore(search = ""): StoryCoreApi {
  const corePath = path.resolve(__dirname, "../../public/script/story-core.js");
  const code = fs.readFileSync(corePath, "utf8");
  const sandbox: Record<string, unknown> = {
    window: { location: { search } },
    console,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
    Promise,
    Set,
  };
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(code, sandbox);
  return (sandbox.window as { StoryCore: StoryCoreApi }).StoryCore;
}

describe("apps/public/script/story-core.js (Core API v1)", () => {
  it("normalizes legacy Dialect B into canonical Dialect A idempotently", () => {
    const core = loadStoryCore();
    expect(core.version).toBe(1);

    const legacy = {
      meta: { title: "Legacy", width: 1080, height: 1920, fps: 30, theme: "indigo-aurora" },
      shots: [
        { id: "s1", startSec: 0, endSec: 2.5, layout: "hero" },
        { id: "s2", startSec: 2.5, endSec: 6.0, layout: "outro" },
      ],
      captions: [{ startSec: 0.5, endSec: 2.0, text: "Hello world" }],
    };
    const norm = core.normalizeStory(legacy);
    expect(norm.title).toBe("Legacy");
    expect(norm.theme).toBe("indigo-aurora");
    expect(norm.canvas).toEqual({ w: 1080, h: 1920, fps: 30 });
    expect(norm.shots[0]).toMatchObject({ id: "s1", start: 0, duration: 2.5 });
    expect(norm.shots[1]).toMatchObject({ id: "s2", start: 2.5, duration: 3.5 });
    expect(norm.captions.enabled).toBe(true);
    expect(norm.captions.items?.[0]).toMatchObject({ start: 0.5, duration: 1.5, text: "Hello world" });

    // Idempotent on Dialect A
    const norm2 = core.normalizeStory(norm);
    expect(norm2.canvas).toEqual(norm.canvas);
    expect(norm2.shots).toEqual(norm.shots);
  });

  it("resolves active shot, localTime, caption, and microstock mode accurately", () => {
    const coreNormal = loadStoryCore("");
    const coreMicro = loadStoryCore("?microstock=1");

    const story = coreNormal.normalizeStory({
      canvas: { w: 1080, h: 1920, fps: 30 },
      shots: [
        { id: "s1", start: 0, duration: 3 },
        { id: "s2", start: 3, duration: 4 },
      ],
      captions: {
        enabled: true,
        items: [{ start: 1, duration: 1.5, text: "Active cue" }],
      },
    });

    const hit = coreNormal.findShot(story, 4.25);
    expect(hit?.shot.id).toBe("s2");
    expect(hit?.index).toBe(1);
    expect(hit?.localTime).toBeCloseTo(1.25, 3);
    expect(coreNormal.computeTotalDuration(story)).toBe(7);

    expect(coreNormal.findCaption(story, 1.5)?.text).toBe("Active cue");
    expect(coreNormal.findCaption(story, 0.2)).toBeNull();
    expect(coreNormal.isMicrostock(story, false)).toBe(false);
    expect(coreNormal.isMicrostock(story, true)).toBe(true);
    expect(coreMicro.isMicrostock(story, false)).toBe(true);
  });

  it("computes portrait/landscape safe zones, bbox containment, easing, and word synthesis", () => {
    const core = loadStoryCore();
    const sz = core.computeSafeZone(1080, 1920);
    expect(sz).toMatchObject({ x: 56, y: 80, w: 896, h: 1340 });
    expect(core.isBoxInsideSafeZone({ minX: 100, maxX: 900, minY: 100, maxY: 1300 }, sz)).toBe(true);
    expect(core.isBoxInsideSafeZone({ minX: 10, maxX: 900, minY: 100, maxY: 1300 }, sz)).toBe(false);
    expect(core.clamp(5, 0, 1)).toBe(1);
    expect(core.easeOutCubic(0)).toBe(0);
    expect(core.easeOutCubic(1)).toBe(1);

    const words = core.synthesizeWords("One Two", 1.0, 2.0);
    expect(words).toEqual([
      { word: "One", start: 1.0, end: 2.0 },
      { word: "Two", start: 2.0, end: 3.0 },
    ]);
  });
});
