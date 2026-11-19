import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface Box3Like {
  min: Vector3Like;
  max: Vector3Like;
  isEmpty: () => boolean;
  getSize: (target: Vector3Like) => Vector3Like;
}

interface Object3DLike {
  name: string;
  position: Vector3Like;
  updateWorldMatrix: (updateParents: boolean, updateChildren: boolean) => void;
  getWorldPosition: (target: Vector3Like) => Vector3Like;
}

interface ClayAssetHandle {
  group: Object3DLike;
  anchors: {
    head: Object3DLike;
    "hand-L": Object3DLike;
    "hand-R": Object3DLike;
    ground: Object3DLike;
  };
  animate: (name: string, progress: number, opts?: Record<string, unknown>) => Object3DLike;
  setExpression: (name: string) => Object3DLike;
  setEmote: (name: string, elapsedSec?: number) => Object3DLike;
}

interface ClaySpecError extends Error {
  code?: string;
  path?: string;
  hint?: string;
}

interface ClaySandbox {
  THREE: {
    Box3: new () => { setFromObject: (obj: Object3DLike) => Box3Like };
    Vector3: new () => Vector3Like;
  };
  ClayKit: {
    ASSET_KINDS: string[];
    HUMANOID_ACCESSORIES: string[];
    ASSET_ANIMATIONS: string[];
    KIND_VARIANTS: { humanoid: string[]; building: string[] };
    HAIR_STYLES: string[];
    EXPRESSIONS: string[];
    EMOTES: string[];
    makeAsset: (spec: unknown) => ClayAssetHandle;
  };
}

function loadClaySandbox(): ClaySandbox {
  const ctx: Record<string, unknown> = {
    console,
    Math,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    RangeError,
    RegExp,
    Float32Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;

  const files = [
    path.join(REPO_ROOT, "core", "aetheria-engine", "assets", "script", "three.min.js"),
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-kit.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-buildings.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-people.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-gestures.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-assets.js"),
  ];
  for (const f of files) {
    vm.runInNewContext(fs.readFileSync(f, "utf8"), ctx, { filename: path.basename(f) });
  }
  return ctx as unknown as ClaySandbox;
}

function measureBox(sandbox: ClaySandbox, obj: Object3DLike) {
  obj.updateWorldMatrix(true, true);
  const box = new sandbox.THREE.Box3().setFromObject(obj);
  const size = box.getSize(new sandbox.THREE.Vector3());
  return { box, size };
}

describe("S1 ClayKit.makeAsset declarative layer", () => {
  const sandbox = loadClaySandbox();

  it("exports all 8 kinds, 7 humanoid accessories, 14 animations, building/humanoid variants, hair, expressions, and emotes", () => {
    expect(sandbox.ClayKit.ASSET_KINDS).toEqual([
      "humanoid",
      "flower-row",
      "container",
      "insect",
      "tree",
      "building",
      "vehicle",
      "blob",
    ]);
    expect(sandbox.ClayKit.HUMANOID_ACCESSORIES).toEqual([
      "hat-conical",
      "hat-cap",
      "towel",
      "glasses",
      "backpack",
      "beard",
      "hijab",
    ]);
    expect(sandbox.ClayKit.ASSET_ANIMATIONS).toEqual([
      "idle",
      "walk",
      "hop",
      "grow",
      "pop-in",
      "run",
      "wave",
      "talk",
      "point",
      "cheer",
      "shock",
      "work",
      "nod",
      "dance",
    ]);
    expect(sandbox.ClayKit.KIND_VARIANTS.humanoid).toEqual(["adult", "kid", "elder", "chubby"]);
    expect(sandbox.ClayKit.KIND_VARIANTS.building).toEqual(["shop", "house", "hut", "barn", "apartment", "school"]);
    expect(sandbox.ClayKit.HAIR_STYLES).toEqual(["short", "long", "bun", "ponytail", "spiky", "bald"]);
    expect(sandbox.ClayKit.EXPRESSIONS).toEqual(["happy", "laugh", "sad", "surprised", "angry", "worried", "sleepy"]);
    expect(sandbox.ClayKit.EMOTES).toEqual(["exclaim", "question", "idea", "heart", "sweat", "anger", "sleep", "music"]);
  });

  it("builds all 8 kinds and all humanoid accessory combinations with valid anchors and reasonable bounding boxes", () => {
    const specs = [
      { id: "farmer-plain", kind: "humanoid", accessories: [] },
      { id: "farmer-conical", kind: "humanoid", accessories: ["hat-conical"], palette: { primary: "#60A5FA", hat: "#FDE68A" } },
      { id: "farmer-cap", kind: "humanoid", accessories: ["hat-cap"], palette: { primary: "#FB7185" } },
      { id: "farmer-towel", kind: "humanoid", accessories: ["towel"], palette: { towel: "#FFFDF9" } },
      { id: "farmer-full", kind: "humanoid", accessories: ["hat-conical", "towel"], scale: 1.05 },
      { id: "farmer-cap-towel", kind: "humanoid", accessories: ["hat-cap", "towel"] },
      { id: "kid-spiky", kind: "humanoid", variant: "kid", hair: "spiky", accessories: ["backpack"] },
      { id: "elder-beard", kind: "humanoid", variant: "elder", hair: "bald", accessories: ["glasses", "beard"] },
      { id: "chubby-hijab", kind: "humanoid", variant: "chubby", hair: "bun", accessories: ["hijab"] },
      { id: "girl-long", kind: "humanoid", variant: "adult", hair: "long", accessories: ["glasses"] },
      { id: "runner-ponytail", kind: "humanoid", variant: "adult", hair: "ponytail" },
      { id: "kenikir-row", kind: "flower-row", palette: { primary: "#FB923C", accent: "#FACC15" }, tags: ["crop"] },
      { id: "jeriken-1", kind: "container", palette: { primary: "#38BDF8", accent: "#FACC15" } },
      { id: "wereng-1", kind: "insect", palette: { primary: "#A3E635", accent: "#E0F2FE" } },
      { id: "pohon-1", kind: "tree", palette: { primary: "#4ADE80", secondary: "#86EFAC" } },
      { id: "rumah-shop", kind: "building", variant: "shop", palette: { primary: "#FDA4AF", accent: "#E11D48" } },
      { id: "rumah-house", kind: "building", variant: "house", palette: { primary: "#FEF3C7", accent: "#EA580C" } },
      { id: "rumah-hut", kind: "building", variant: "hut", palette: { primary: "#FDE68A", accent: "#D97706" } },
      { id: "rumah-barn", kind: "building", variant: "barn", palette: { primary: "#EF4444", accent: "#78716C" } },
      { id: "rumah-apt", kind: "building", variant: "apartment", palette: { primary: "#93C5FD", accent: "#3B82F6" } },
      { id: "rumah-school", kind: "building", variant: "school", palette: { primary: "#FDE68A", accent: "#E11D48" } },
      { id: "mobil-1", kind: "vehicle", palette: { primary: "#FF8FAB", accent: "#FFF0F3" } },
      { id: "blob-1", kind: "blob", palette: { primary: "#FEF08A", secondary: "#FDE047", accent: "#F5D0FE" } },
    ];

    for (const spec of specs) {
      const asset = sandbox.ClayKit.makeAsset(spec);
      expect(asset.group).toBeDefined();
      expect(asset.anchors.head).toBeDefined();
      expect(asset.anchors["hand-L"]).toBeDefined();
      expect(asset.anchors["hand-R"]).toBeDefined();
      expect(asset.anchors.ground).toBeDefined();

      const { box, size } = measureBox(sandbox, asset.group);
      expect(box.isEmpty()).toBe(false);
      expect(size.x).toBeGreaterThan(0.5);
      expect(size.x).toBeLessThan(5.0);
      expect(size.y).toBeGreaterThan(0.6);
      expect(size.y).toBeLessThan(5.0);
      expect(size.z).toBeGreaterThan(0.4);
      expect(size.z).toBeLessThan(5.0);
      expect(box.min.y).toBeGreaterThan(-0.35);

      const headPos = asset.anchors.head.getWorldPosition(new sandbox.THREE.Vector3());
      const groundPos = asset.anchors.ground.getWorldPosition(new sandbox.THREE.Vector3());
      expect(headPos.y).toBeGreaterThan(groundPos.y + 0.5);

      // Every standard animation, expression, and emote runs cleanly
      for (const anim of sandbox.ClayKit.ASSET_ANIMATIONS) {
        asset.animate(anim, 0);
        asset.animate(anim, 0.5);
        asset.animate(anim, 1);
      }
      if (spec.kind === "humanoid") {
        for (const expr of sandbox.ClayKit.EXPRESSIONS) {
          asset.setExpression(expr);
        }
        for (const em of sandbox.ClayKit.EMOTES) {
          asset.setEmote(em, 0.5);
        }
        asset.setEmote("", 0);
      }
    }
  });

  it("animates flower-row grow, insect hop, and pop-in deterministically without state drift", () => {
    const flowers = sandbox.ClayKit.makeAsset({ id: "fl-det", kind: "flower-row" });
    flowers.animate("grow", 0.0);
    const h0 = measureBox(sandbox, flowers.group).size.y;
    flowers.animate("grow", 1.0);
    const h1 = measureBox(sandbox, flowers.group).size.y;
    expect(h1).toBeGreaterThan(h0 + 0.4);

    const bug = sandbox.ClayKit.makeAsset({ id: "bug-det", kind: "insect" });
    bug.animate("hop", 0.0);
    const y0 = measureBox(sandbox, bug.group).box.min.y;
    bug.animate("hop", 0.5);
    const yApex1 = measureBox(sandbox, bug.group).box.min.y;
    expect(yApex1).toBeGreaterThan(y0 + 0.5);

    // Interleave idle then re-evaluate hop(0.5) -> must be identical
    bug.animate("idle", 0.37);
    bug.animate("hop", 0.5);
    const yApex2 = measureBox(sandbox, bug.group).box.min.y;
    expect(yApex2).toBeCloseTo(yApex1, 6);

    // Humanoid walk visibly lifts torso/feet mid-stride and stays deterministic
    const farmer = sandbox.ClayKit.makeAsset({ id: "farmer-walk", kind: "humanoid", accessories: ["hat-conical"] });
    farmer.animate("walk", 0.0);
    const restMinY = measureBox(sandbox, farmer.group).box.min.y;
    farmer.animate("walk", 0.3125); // peak stride sin(2.5*pi) = +1
    const strideMinY1 = measureBox(sandbox, farmer.group).box.min.y;
    expect(strideMinY1).toBeGreaterThan(restMinY + 0.05);
    farmer.animate("idle", 0.25);
    farmer.animate("walk", 0.3125);
    const strideMinY2 = measureBox(sandbox, farmer.group).box.min.y;
    expect(strideMinY2).toBeCloseTo(strideMinY1, 6);
  });

  it("throws structured { code, path, hint } errors on invalid specs and animations", () => {
    const invalidCases: Array<{ spec: unknown; expectedCode: string; expectedPath: string }> = [
      { spec: null, expectedCode: "INVALID_SPEC", expectedPath: "" },
      { spec: { kind: "blob" }, expectedCode: "INVALID_ID", expectedPath: "id" },
      { spec: { id: "x", kind: "spaceship" }, expectedCode: "UNKNOWN_KIND", expectedPath: "kind" },
      { spec: { id: "x", kind: "blob", scale: 0 }, expectedCode: "INVALID_SCALE", expectedPath: "scale" },
      { spec: { id: "x", kind: "blob", palette: { primary: "red" } }, expectedCode: "INVALID_PALETTE", expectedPath: "palette.primary" },
      { spec: { id: "x", kind: "humanoid", accessories: "hat-cap" }, expectedCode: "INVALID_ACCESSORIES", expectedPath: "accessories" },
      { spec: { id: "x", kind: "humanoid", accessories: ["jetpack"] }, expectedCode: "UNKNOWN_ACCESSORY", expectedPath: "accessories[0]" },
      { spec: { id: "x", kind: "tree", accessories: ["hat-cap"] }, expectedCode: "UNKNOWN_ACCESSORY", expectedPath: "accessories[0]" },
      { spec: { id: "x", kind: "blob", tags: [123] }, expectedCode: "INVALID_TAGS", expectedPath: "tags[0]" },
    ];

    for (const tc of invalidCases) {
      let caught: ClaySpecError | null = null;
      try {
        sandbox.ClayKit.makeAsset(tc.spec);
      } catch (e) {
        caught = e as ClaySpecError;
      }
      expect(caught).not.toBeNull();
      expect(caught?.code).toBe(tc.expectedCode);
      expect(caught?.path).toBe(tc.expectedPath);
      expect(typeof caught?.hint).toBe("string");
      expect((caught?.hint || "").length).toBeGreaterThan(5);
    }

    const okAsset = sandbox.ClayKit.makeAsset({ id: "anim-check", kind: "blob" });
    let animErr: ClaySpecError | null = null;
    try {
      okAsset.animate("backflip", 0.5);
    } catch (e) {
      animErr = e as ClaySpecError;
    }
    expect(animErr?.code).toBe("UNKNOWN_ANIMATION");
    expect(animErr?.path).toBe("anim");
  });
});
