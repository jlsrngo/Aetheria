import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function loadStageSandbox() {
  const camCode = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "story-camera.js"),
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
  new Function("window", stageCode)(fakeWin);
  new Function("window", amCode)(fakeWin);
  return {
    AetheriaStage: fakeWin.AetheriaStage as {
      createStage: (opts: Record<string, unknown>) => {
        addLayer: (spec: Record<string, unknown>) => unknown;
        setCamera: (cam: Record<string, unknown>) => void;
        resolveWorldState: (t: number) => Record<
          string,
          {
            matrix: number[];
            opacity: number;
            visible: boolean;
            localToWorld: (x: number, y: number) => { x: number; y: number };
          }
        >;
        render: (
          ctx: unknown,
          t: number,
          opts?: Record<string, unknown>,
        ) => { renderedLayers: string[]; camera: Record<string, number> };
      };
      syncCamera: (cam: Record<string, unknown>, targets: Record<string, unknown>) => {
        pose3D: { position: number[]; lookAt: number[]; rollRad: number } | null;
      };
    },
    AM: fakeWin.AM as {
      createStage: (opts: Record<string, unknown>) => unknown;
      syncCamera: (cam: Record<string, unknown>, targets: Record<string, unknown>) => unknown;
    },
  };
}

describe("AetheriaStage Universal Layer Compositor & Camera Adapter (Phase 3)", () => {
  it("computes parent-child world transforms, inherits opacity, sorts zIndex, and rejects cycles", () => {
    const { AetheriaStage } = loadStageSandbox();
    const stage = AetheriaStage.createStage({ width: 1000, height: 1000 });

    stage.addLayer({
      id: "parent_rig",
      kind: "group",
      x: 200,
      y: 100,
      scaleX: 2,
      scaleY: 2,
      anchor: [0, 0],
      opacity: 0.5,
    });
    stage.addLayer({
      id: "child_orb",
      parentId: "parent_rig",
      kind: "canvas2d",
      x: 50,
      y: 25,
      anchor: [0, 0],
      opacity: 0.8,
      zIndex: 20,
      draw: () => {},
    });
    stage.addLayer({
      id: "bg_particles",
      kind: "canvas2d",
      zIndex: 5,
      parallax: 0.5,
      draw: () => {},
    });

    const world = stage.resolveWorldState(1.0);
    // Parent at (200,100) scale 2x + child local (50,25) => world (300, 150)
    const pt = world.child_orb.localToWorld(0, 0);
    expect(pt.x).toBeCloseTo(300, 4);
    expect(pt.y).toBeCloseTo(150, 4);
    expect(world.child_orb.opacity).toBeCloseTo(0.4, 4);

    // Cycle detection rejects self or ancestor cycles immediately
    expect(() =>
      stage.addLayer({
        id: "parent_rig",
        parentId: "child_orb",
        kind: "group",
      }),
    ).toThrow(/cyclic parentId/i);

    const drawOrder: string[] = [];
    const mockCtx = {
      canvas: { width: 1000, height: 1000 },
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
    };
    const res = stage.render(mockCtx, 1.0);
    expect(res.renderedLayers).toEqual(["bg_particles", "child_orb"]);
    expect(drawOrder).toEqual([]);
  });

  it("synchronizes unified camera pose across DOM/SVG elements and Three.js 3D camera", () => {
    const { AetheriaStage, AM } = loadStageSandbox();
    const stage = AM.createStage({ width: 640, height: 360 }) as ReturnType<
      typeof AetheriaStage.createStage
    >;
    const domEl = { style: { visibility: "", opacity: "", zIndex: "", transformOrigin: "", transform: "" } };
    let threePos: number[] = [];
    let threeLook: number[] = [];
    let threeRoll = 0;
    const fakeThreeCam = {
      position: { set: (x: number, y: number, z: number) => (threePos = [x, y, z]) },
      lookAt: (x: number, y: number, z: number) => (threeLook = [x, y, z]),
      rotateZ: (r: number) => (threeRoll = r),
    };

    stage.setCamera({ zoom: 1.25, panX: 40, panY: -20, roll: 6 });
    stage.addLayer({ id: "three_bg", kind: "three", zIndex: 1, threeCamera: fakeThreeCam, baseCamPos: [0, 0, 8], baseLookAt: [0, 0, 0] });
    stage.addLayer({ id: "svg_title", kind: "svg", zIndex: 10, element: domEl, x: 100, y: 50, anchor: [0, 0] });

    const out = stage.render(null, 0.5);
    expect(out.renderedLayers).toEqual(["three_bg", "svg_title"]);
    expect(domEl.style.visibility).toBe("visible");
    expect(domEl.style.transform).toContain("matrix(");
    expect(threePos).toHaveLength(3);
    expect(threePos[2]).toBeLessThan(8); // Dolly in for zoom=1.25
    expect(threeLook).toHaveLength(3);
    expect(threeRoll).toBeGreaterThan(0.05);
  });
});
