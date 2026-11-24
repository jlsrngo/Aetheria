import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function loadTahap4Sandbox() {
  const camCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "story-camera.js"), "utf8");
  const postCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-post.js"), "utf8");
  const tracksCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-tracks.js"), "utf8");
  const stageCode = fs.readFileSync(path.join(REPO_ROOT, "apps", "public", "script", "aetheria-stage.js"), "utf8");

  const fakeWin: Record<string, unknown> = {};
  new Function("window", camCode)(fakeWin);
  new Function("window", postCode)(fakeWin);
  new Function("window", tracksCode)(fakeWin);
  new Function("window", stageCode)(fakeWin);

  return {
    AetheriaPost: fakeWin.AetheriaPost as {
      normalizePassOpts: (o: Record<string, unknown>) => Record<string, unknown>;
      hasActiveEffect: (p: Record<string, unknown>) => boolean;
      SHADERS: { FS_COMPOSITE: string };
    },
    AetheriaStage: fakeWin.AetheriaStage as {
      createStage: (opts: Record<string, unknown>) => {
        addLayer: (spec: Record<string, unknown>) => Record<string, unknown>;
      };
    },
  };
}

describe("Tahap 4 Track Mattes, Echo Trails & WebGL2 Optical Passes", () => {
  it("normalizes directionalBlur, radialBlur, and dof options and exposes GLSL uniforms", () => {
    const { AetheriaPost } = loadTahap4Sandbox();

    const idle = AetheriaPost.normalizePassOpts({});
    expect(AetheriaPost.hasActiveEffect(idle)).toBe(false);

    const dir = AetheriaPost.normalizePassOpts({ directionalBlur: 18, directionalAngle: 45 });
    expect(AetheriaPost.hasActiveEffect(dir)).toBe(true);
    expect(dir.directionalBlur).toBe(18);

    const rad = AetheriaPost.normalizePassOpts({ radialBlur: 0.12, radialCenter: [0.4, 0.6] });
    expect(AetheriaPost.hasActiveEffect(rad)).toBe(true);
    expect(rad.radialCenter).toEqual([0.4, 0.6]);

    const dof = AetheriaPost.normalizePassOpts({ dof: 12, dofFocus: [0.5, 0.4], dofRadius: 0.2, dofFeather: 0.3 });
    expect(AetheriaPost.hasActiveEffect(dof)).toBe(true);
    expect(dof.dof).toBe(12);

    expect(AetheriaPost.SHADERS.FS_COMPOSITE).toContain("uDirBlurVec");
    expect(AetheriaPost.SHADERS.FS_COMPOSITE).toContain("uRadialBlur");
    expect(AetheriaPost.SHADERS.FS_COMPOSITE).toContain("uDofAmt");
  });

  it("validates track matte modes, self-matte guard, and echo options in AetheriaStage", () => {
    const { AetheriaStage } = loadTahap4Sandbox();
    const stage = AetheriaStage.createStage({ width: 640, height: 360 });

    stage.addLayer({ id: "mask_shape", matteSource: true });
    const matted = stage.addLayer({
      id: "hero",
      matte: { layerId: "mask_shape", mode: "lumaInverted" },
      echo: { count: 4, echoTime: -0.04, startIntensity: 0.7, decay: 0.6, operator: "add" },
    });
    expect((matted.matte as { mode: string }).mode).toBe("lumaInverted");
    expect((matted.echo as { count: number }).count).toBe(4);

    expect(() => stage.addLayer({ id: "self_m", matte: { layerId: "self_m", mode: "alpha" } })).toThrow(
      /cannot use itself/,
    );
    expect(() => stage.addLayer({ id: "bad_m", matte: { layerId: "mask_shape", mode: "bogus" } })).toThrow(
      /unknown matte mode/,
    );
  });
});
