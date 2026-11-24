import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface MockImage {
  src: string;
  crossOrigin: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

interface DrawCall {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function loadAmSandbox(imageSizes: Record<string, { w: number; h: number }>, fetchJson?: unknown) {
  const code = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
    "utf8",
  );

  class FakeImage implements MockImage {
    src = "";
    crossOrigin = "";
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
      // Trigger async load once src is assigned.
      queueMicrotask(() => {
        const size = imageSizes[this.src];
        if (size) {
          this.naturalWidth = size.w;
          this.naturalHeight = size.h;
          this.complete = true;
          this.onload?.();
        } else {
          this.complete = true;
          this.onerror?.();
        }
      });
    }
  }

  const fakeWin: { AM?: Record<string, (...args: unknown[]) => unknown> } = {};
  const fakeFetch = async () =>
    fetchJson === undefined
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => fetchJson };

  new Function("window", "Image", "fetch", code)(fakeWin, FakeImage, fakeFetch);
  return fakeWin.AM!;
}

describe("AM Unified Asset Registry Runtime (Phase 1)", () => {
  it("loads assets.json, resolves by id/path/url, and draws using alphaBbox & pivot", async () => {
    const manifest = {
      version: 1,
      assets: [
        {
          id: "orb_cutout",
          path: "img/orb_cutout.png",
          url: "/img/orb_cutout.png",
          kind: "raster_cutout",
          width: 400,
          height: 300,
          hasAlpha: true,
          alphaBbox: { x: 50, y: 50, w: 200, h: 100 },
          pivot: [0.5, 0.5],
          valid: true,
        },
        {
          id: "broken_img",
          path: "img/broken.png",
          url: "/img/broken.png",
          kind: "raster",
          width: 0,
          height: 0,
          hasAlpha: false,
          valid: false,
          warnings: ["Corrupted header"],
        },
      ],
    };

    const AM = loadAmSandbox({ "/img/orb_cutout.png": { w: 400, h: 300 } }, manifest);
    const loaded = (await AM.loadAssetManifest("/assets.json")) as { version: number; assets: unknown[] };
    expect(loaded.version).toBe(1);
    expect(loaded.assets).toHaveLength(2);

    const byId = AM.getAsset("orb_cutout") as { ready: boolean; meta: { kind: string } };
    const byPath = AM.getAsset("img/orb_cutout.png") as { ready: boolean };
    const byUrl = AM.getAsset("/img/orb_cutout.png") as { ready: boolean };
    expect(byId?.ready).toBe(true);
    expect(byId?.meta.kind).toBe("raster_cutout");
    expect(byPath?.ready).toBe(true);
    expect(byUrl?.ready).toBe(true);

    const broken = AM.getAsset("broken_img") as { ready: boolean };
    expect(broken?.ready).toBe(false);

    const drawCalls: DrawCall[] = [];
    const transforms: string[] = [];
    const mockCtx = {
      globalAlpha: 1,
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      translate: (tx: number, ty: number) => transforms.push(`T:${tx},${ty}`),
      rotate: (r: number) => transforms.push(`R:${r.toFixed(2)}`),
      scale: (sx: number, sy: number) => transforms.push(`S:${sx},${sy}`),
      drawImage: (
        _img: unknown,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => {
        drawCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
      },
    };

    const ok = AM.drawAsset(mockCtx, "orb_cutout", 100, 200, 400, 200, { rot: 0.5, flipX: true });
    expect(ok).toBe(true);
    expect(drawCalls).toHaveLength(1);
    // alphaBbox (50,50,200,100) has 2:1 ratio, fitting cleanly into 400x200 box -> dw=400, dh=200
    expect(drawCalls[0]).toEqual({
      sx: 50,
      sy: 50,
      sw: 200,
      sh: 100,
      dx: -200,
      dy: -100,
      dw: 400,
      dh: 200,
    });
    expect(transforms).toContain("T:300,300");
    expect(transforms).toContain("R:0.50");
    expect(transforms).toContain("S:-1,1");

    // Invalid or missing assets return false safely without throwing
    expect(AM.drawAsset(mockCtx, "broken_img", 0, 0, 100, 100)).toBe(false);
    expect(AM.drawAsset(mockCtx, "non_existent", 0, 0, 100, 100)).toBe(false);
  });

  it("handles missing assets.json (404) gracefully without throwing", async () => {
    const AM = loadAmSandbox({}, undefined);
    const res = (await AM.loadAssetManifest("/assets.json")) as { version: number; assets: unknown[] };
    expect(res).toEqual({ version: 1, assets: [] });
  });
});
