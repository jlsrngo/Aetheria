import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function createMockCtx() {
  const calls: string[] = [];
  const noop = () => {};
  return {
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
    measureText: (text: string) => ({ width: String(text || "").length * 20 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    __calls: calls,
  };
}

interface KeynoteSandbox {
  KeynoteKit: {
    KEYNOTE_THEMES: string[];
    DEVICE_KINDS: string[];
    ICON_KINDS: string[];
    drawKeynoteIcon: (ctx: unknown, kind: string, cx: number, cy: number, r: number) => void;
    drawDeviceMockup: (ctx: unknown, kind: string, cx: number, cy: number, w: number, h: number, th: unknown) => void;
  };
  KeynoteLayouts: {
    LAYOUT_PRESETS: string[];
  };
  StoryRuntime: {
    createKeynotePlayer: (spec: unknown, opts: unknown) => { renderAt: (t: number) => { focusBboxInSafeZone: boolean; overlapCount: number; errors: string[] } };
  };
}

function loadSandbox(): KeynoteSandbox {
  const ctx: Record<string, unknown> = {
    console, Math, Array, Object, Number, String, Boolean, Error, RegExp, Promise,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;

  for (const f of [
    path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-product-keynote", "examples", "script", "keynote-kit.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-product-keynote", "examples", "script", "keynote-layouts.js"),
    path.join(REPO_ROOT, ".aetheria", "skills", "mg-product-keynote", "examples", "script", "story-runtime.js"),
  ]) {
    vm.runInNewContext(fs.readFileSync(f, "utf8"), ctx, { filename: path.basename(f) });
  }
  return ctx as unknown as KeynoteSandbox;
}

describe("mg-product-keynote declarative 2D showreel kit", () => {
  const sb = loadSandbox();

  it("exports all 5 themes, 6 devices, 12 icons, and 8 layout presets", () => {
    expect(sb.KeynoteKit.KEYNOTE_THEMES).toHaveLength(5);
    expect(sb.KeynoteKit.DEVICE_KINDS).toEqual(["laptop", "phone", "tablet", "watch", "chip", "card"]);
    expect(sb.KeynoteKit.ICON_KINDS).toHaveLength(12);
    expect(sb.KeynoteLayouts.LAYOUT_PRESETS).toHaveLength(8);
  });

  it("renders every icon, device, and all 6 shots cleanly in both 16:9 landscape and 9:16 portrait plus Microstock silent mode", () => {
    const mock = createMockCtx();
    const theme = { dark: true, accent: "#2997FF", accent2: "#A855F7", cardBg: "#111", cardBorder: "#333", glow: "rgba(0,0,0,0.2)" };
    for (const ic of sb.KeynoteKit.ICON_KINDS) expect(() => sb.KeynoteKit.drawKeynoteIcon(mock, ic, 100, 100, 60)).not.toThrow();
    for (const dv of sb.KeynoteKit.DEVICE_KINDS) expect(() => sb.KeynoteKit.drawDeviceMockup(mock, dv, 500, 500, 600, 400, theme)).not.toThrow();

    const examplePath = path.join(REPO_ROOT, ".aetheria", "skills", "mg-product-keynote", "examples", "story.example.json");
    const landscapeSpec = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    const portraitSpec = JSON.parse(JSON.stringify(landscapeSpec));
    portraitSpec.canvas = { w: 1080, h: 1920, fps: 30 };

    for (const spec of [landscapeSpec, portraitSpec]) {
      const c = createMockCtx();
      const player = sb.StoryRuntime.createKeynotePlayer(spec, { canvas: { width: spec.canvas.w, height: spec.canvas.h, getContext: () => c }, isMicrostock: false });
      for (const t of [2, 6, 10, 14, 18, 22]) {
        const r = player.renderAt(t);
        expect(r.focusBboxInSafeZone).toBe(true);
        expect(r.overlapCount).toBe(0);
        expect(r.errors).toEqual([]);
      }
      expect(c.__calls.length).toBeGreaterThan(0);
    }

    // Silent Microstock Mode 'M' -> zero text drawn
    const silent = createMockCtx();
    const sPlayer = sb.StoryRuntime.createKeynotePlayer(landscapeSpec, { canvas: { width: 1920, height: 1080, getContext: () => silent }, isMicrostock: true });
    for (const t of [2, 6, 10, 14, 18, 22]) {
      const r = sPlayer.renderAt(t);
      expect(r.focusBboxInSafeZone).toBe(true);
      expect(r.overlapCount).toBe(0);
      expect(r.errors).toEqual([]);
    }
    expect(silent.__calls).toEqual([]);
  });
});
