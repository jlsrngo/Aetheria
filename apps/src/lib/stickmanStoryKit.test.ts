import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SKILL_DIR = path.join(REPO_ROOT, ".aetheria", "skills", "mg-stickman-story");

interface ActorState {
  id: string;
  x: number;
  y: number;
  scale: number;
  flip: number;
  facing: string;
  pose: string;
  expr: string;
  emote: { kind: string; t0: number; t1: number } | null;
}

function loadStickmanModules() {
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
  const camCode = fs.readFileSync(path.join(REPO_ROOT, "apps/public/script/story-camera.js"), "utf8");
  const rigCode = fs.readFileSync(path.join(SKILL_DIR, "examples/script/stickman-rig.js"), "utf8");
  const worldCode = fs.readFileSync(path.join(SKILL_DIR, "examples/script/stickman-world.js"), "utf8");
  const timelineCode = fs.readFileSync(path.join(SKILL_DIR, "examples/script/stickman-timeline.js"), "utf8");
  vm.runInNewContext(camCode, sandbox);
  vm.runInNewContext(rigCode, sandbox);
  vm.runInNewContext(worldCode, sandbox);
  vm.runInNewContext(timelineCode, sandbox);
  return win as {
    StickmanRig: {
      PRESETS: Record<string, unknown>;
      EXPR: Record<string, unknown>;
      POSES: Record<string, unknown>;
    };
    StickmanWorld: {
      WORLDS: Record<string, { back: unknown; front: unknown }>;
    };
    StickmanTimeline: {
      actorStateAt: (spec: Record<string, unknown>, t: number) => ActorState;
    };
  };
}

describe("mg-stickman-story kit & runtime modules", () => {
  it("loads all 13 presets, 20 expressions, 44 poses, 13 worlds, and valid 9:16 kit.json + story.example.json", () => {
    const kitJson = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "examples/kit.json"), "utf8"));
    expect(kitJson.renderer).toBe("2d-stickman-story");
    expect(kitJson.scripts).toEqual([
      "script/stickman-rig.js",
      "script/stickman-world.js",
      "script/stickman-overlay.js",
      "script/stickman-timeline.js",
      "script/story-runtime.js",
    ]);

    const story = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "examples/story.example.json"), "utf8"));
    expect(story.canvas).toEqual({ w: 1080, h: 1920, fps: 30 });
    expect(story.shots).toHaveLength(3);
    expect(story.shots[0].start).toBe(0);
    expect(story.shots[1].start).toBeCloseTo(story.shots[0].duration, 3);
    expect(story.shots[2].start).toBeCloseTo(story.shots[0].duration + story.shots[1].duration, 3);

    const mods = loadStickmanModules();
    expect(Object.keys(mods.StickmanRig.PRESETS).length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(mods.StickmanRig.EXPR).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(mods.StickmanRig.POSES).length).toBeGreaterThanOrEqual(44);
    expect(Object.keys(mods.StickmanWorld.WORLDS).length).toBeGreaterThanOrEqual(13);
  });

  it("evaluates actor travel, facing, pose transition, and emote windows deterministically", () => {
    const { StickmanTimeline } = loadStickmanModules();
    const spec = {
      id: "afro",
      x: -420,
      pose: "idle",
      expr: "excited",
      actions: [
        { at: 0.1, toX: -150, dur: 1.25, style: "run" },
        { at: 1.4, pose: "wave", expr: "laugh", facing: "right", emote: "sparkle", emoteDur: 1.8 },
      ],
    };

    const s0 = StickmanTimeline.actorStateAt(spec, 0.0);
    expect(s0.x).toBe(-420);
    expect(s0.emote).toBeNull();

    const sRun = StickmanTimeline.actorStateAt(spec, 0.72);
    expect(sRun.x).toBeGreaterThan(-420);
    expect(sRun.x).toBeLessThan(-150);
    expect(sRun.pose).toBe("run");
    expect(sRun.facing).toBe("right");

    const sWave = StickmanTimeline.actorStateAt(spec, 1.8);
    expect(sWave.x).toBe(-150);
    expect(sWave.pose).toBe("wave");
    expect(sWave.expr).toBe("laugh");
    expect(sWave.emote?.kind).toBe("sparkle");

    const sExpired = StickmanTimeline.actorStateAt(spec, 3.5);
    expect(sExpired.emote).toBeNull();
  });
});
