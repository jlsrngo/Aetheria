import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function createMockCanvasContext() {
  const calls: string[] = [];
  const noop = () => {};
  const ctx: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arcTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    drawImage: noop,
    fillText: (text: string) => calls.push(`text:${text}`),
    strokeText: (text: string) => calls.push(`strokeText:${text}`),
    measureText: (text: string) => ({ width: String(text || "").length * 22 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    __calls: calls,
  };
  return ctx;
}

interface CollageSandbox {
  CollageKit: {
    PAPER_THEMES: string[];
    CUTOUT_KINDS: string[];
    ACCENT_KINDS: string[];
    boilOffset: (seed: string, t: number, fps: number) => { dx: number; dy: number; rot: number };
    drawCutoutGlyph: (ctx: unknown, kind: string, r: number, p?: string, a?: string) => void;
    drawAccent: (ctx: unknown, kind: string, cx: number, cy: number, size: number) => void;
  };
  CollageLayouts: {
    LAYOUT_PRESETS: string[];
  };
  StoryRuntime: {
    createCollagePlayer: (spec: unknown, opts: unknown) => { renderAt: (t: number) => Record<string, unknown> };
  };
  __shotReport: Record<string, { focusBboxInSafeZone: boolean; overlapCount: number; errors: string[] }>;
}

function loadCollageSandbox(): CollageSandbox {
  const ctx: Record<string, unknown> = {
    console,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    RegExp,
    Promise,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;

  const files = [
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-cutout-collage", "examples", "script", "collage-kit.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-cutout-collage", "examples", "script", "collage-layouts.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-cutout-collage", "examples", "script", "story-runtime.js"),
  ];
  for (const f of files) {
    vm.runInNewContext(fs.readFileSync(f, "utf8"), ctx, { filename: path.basename(f) });
  }
  return ctx as unknown as CollageSandbox;
}

describe("S7 mg-cutout-collage declarative 2D kit", () => {
  const sandbox = loadCollageSandbox();

  it("exports all 5 paper themes, 16 cutouts, 8 accents, and 6 layout presets", () => {
    expect(sandbox.CollageKit.PAPER_THEMES).toEqual(["kraft", "newsprint", "corkboard", "charcoal", "scrapbook"]);
    expect(sandbox.CollageKit.CUTOUT_KINDS).toHaveLength(16);
    expect(sandbox.CollageKit.ACCENT_KINDS).toHaveLength(8);
    expect(sandbox.CollageLayouts.LAYOUT_PRESETS).toEqual([
      "dossier-hero",
      "split-compare",
      "evidence-board",
      "stat-callout",
      "timeline-strip",
      "quote-scrap",
    ]);
  });

  it("draws every cutout kind and accent cleanly and produces deterministic 12fps boil", () => {
    const mockCtx = createMockCanvasContext();
    for (const kind of sandbox.CollageKit.CUTOUT_KINDS) {
      expect(() => sandbox.CollageKit.drawCutoutGlyph(mockCtx, kind, 120, "#C0392B", "#F59E0B")).not.toThrow();
    }
    for (const acc of sandbox.CollageKit.ACCENT_KINDS) {
      expect(() => sandbox.CollageKit.drawAccent(mockCtx, acc, 100, 100, 48)).not.toThrow();
    }
    const b1 = sandbox.CollageKit.boilOffset("shot1", 1.25, 12);
    const b2 = sandbox.CollageKit.boilOffset("shot1", 1.25, 12);
    expect(b1).toEqual(b2);
  });

  it("renders all 6 shots of story.example.json inside safeZone with zero overlaps and supports silent Microstock mode", () => {
    const examplePath = path.join(REPO_ROOT, ".aetheria", "skills", "mg-cutout-collage", "examples", "story.example.json");
    const spec = JSON.parse(fs.readFileSync(examplePath, "utf8"));

    const normalCtx = createMockCanvasContext();
    const player = sandbox.StoryRuntime.createCollagePlayer(spec, {
      canvas: { getContext: () => normalCtx },
      isMicrostock: false,
    });
    for (const t of [2.5, 7.5, 12.5, 17.5, 22.5, 27.5]) {
      const rep = player.renderAt(t) as { focusBboxInSafeZone: boolean; overlapCount: number; errors: string[] };
      expect(rep.focusBboxInSafeZone).toBe(true);
      expect(rep.overlapCount).toBe(0);
      expect(rep.errors).toEqual([]);
    }
    expect((normalCtx.__calls as string[]).length).toBeGreaterThan(0);

    // Silent Microstock Mode 'M': zero text rendered
    const silentCtx = createMockCanvasContext();
    const silentPlayer = sandbox.StoryRuntime.createCollagePlayer(spec, {
      canvas: { getContext: () => silentCtx },
      isMicrostock: true,
    });
    for (const t of [2.5, 7.5, 12.5, 17.5, 22.5, 27.5]) {
      const rep = silentPlayer.renderAt(t) as { focusBboxInSafeZone: boolean; overlapCount: number; errors: string[] };
      expect(rep.focusBboxInSafeZone).toBe(true);
      expect(rep.overlapCount).toBe(0);
      expect(rep.errors).toEqual([]);
    }
    expect(silentCtx.__calls as string[]).toEqual([]);
  });
});
