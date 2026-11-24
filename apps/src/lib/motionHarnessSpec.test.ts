import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Single source of truth for forbidden boilerplate/non-harness strings across mg-* skills.
 */
const FORBIDDEN_SKILL_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  { label: "window.renderAt = function", regex: /window\.renderAt\s*=\s*function/i },
  { label: "__filmMeta", regex: /__filmMeta/ },
  { label: "workspace/script", regex: /workspace\/script/i },
  { label: "workspace/index.html", regex: /workspace\/index\.html/i },
  { label: "render at full resolution", regex: /render at full resolution/i },
  {
    label: "Aetheria Modular HTML Motion Engine Contract",
    regex: /Aetheria Modular HTML Motion Engine Contract/i,
  },
  {
    label: "Before you deliver, score yourself honestly",
    regex: /Before you deliver, score yourself honestly/i,
  },
  { label: "genre-correct music", regex: /genre-correct music/i },
  { label: "Master to the output spec", regex: /Master to the output spec/i },
  { label: "Write an honest self-critique", regex: /Write an honest self-critique/i },
  { label: "exactly 10.00 s", regex: /exactly\s+10\.00\s*s/i },
  { label: "render to output/video.mp4", regex: /render to\s+`?output\/video\.mp4`?/i },
];

function listMgSkillFiles(): string[] {
  const skillsRoot = path.join(REPO_ROOT, ".aetheria", "skills");
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("mg-"))
    .map((d) => path.join(skillsRoot, d.name, "SKILL.md"))
    .sort();
}

function parseRuntimeAmApiExports(): Set<string> {
  const runtimePath = path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js");
  const src = fs.readFileSync(runtimePath, "utf8");
  const match = src.match(/const API\s*=\s*\{([\s\S]*?)\};/);
  if (!match) {
    throw new Error("Could not locate `const API = { ... }` export block in aetheria-motion.js");
  }
  const keys = new Set<string>();
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim().replace(/,$/, "");
    if (!line || line.startsWith("//")) continue;
    const key = line.split(":")[0].trim();
    if (key) keys.add(key);
  }
  return keys;
}

describe("Harness F1 spec guards (skill-lint & AM API parity)", () => {
  it("lints all 18 mg-* SKILL.md files against forbidden engine/non-harness boilerplate", () => {
    const skillFiles = listMgSkillFiles();
    // 16 original mg-* skills + mg-product-keynote + mg-cobalt-editorial
    expect(skillFiles.length).toBe(18);

    const violations: string[] = [];
    for (const file of skillFiles) {
      const rel = path.relative(REPO_ROOT, file);
      const content = fs.readFileSync(file, "utf8");

      for (const rule of FORBIDDEN_SKILL_PATTERNS) {
        if (rule.regex.test(content)) {
          violations.push(`${rel}: matched forbidden pattern "${rule.label}"`);
        }
      }

      for (const [idx, line] of content.split(/\r?\n/).entries()) {
        if (
          /drawTopHeader/.test(line) &&
          !/(DO NOT|NEVER|FORBIDDEN|ZERO|OMIT|optional)/i.test(line)
        ) {
          violations.push(`${rel}:${idx + 1}: mandatory drawTopHeader mention -> "${line.trim()}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("ensures every AM.<symbol> in AM_API.md, prompts, and mg-* skills exists in aetheria-motion.js", () => {
    const exported = parseRuntimeAmApiExports();
    expect(exported.size).toBeGreaterThanOrEqual(46);
    for (const sym of [
      "drawCursor",
      "drawExtrudedArrow3D",
      "drawLaptopFrame",
      "drawWordWheel",
      "evalTrack",
      "wiggle",
      "loopTrack",
      "drawAnimatedText",
      "trimPaths",
      "roundCorners",
      "puckerBloat",
      "wigglePaths",
      "morphPath",
      "drawShapePath",
      "repeatDraw",
      "polystarPath",
    ]) {
      expect(exported.has(sym)).toBe(true);
    }

    const targets = [
      path.join(REPO_ROOT, ".aetheria", "reference", "AM_API.md"),
      path.join(REPO_ROOT, "core", "aetheria-engine", "src", "session", "prompt", "default.txt"),
      path.join(
        REPO_ROOT,
        "core",
        "aetheria-engine",
        "src",
        "session",
        "agent_turn",
        "command_resolvers.rs"
      ),
      path.join(
        REPO_ROOT,
        "core",
        "aetheria-engine",
        "src",
        "session",
        "agent_turn",
        "subagent_store.rs"
      ),
      ...listMgSkillFiles(),
    ];

    const unknownRefs: string[] = [];
    for (const file of targets) {
      const rel = path.relative(REPO_ROOT, file);
      const content = fs.readFileSync(file, "utf8");
      for (const m of content.matchAll(/\bAM\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        const sym = m[1];
        if (!exported.has(sym)) {
          unknownRefs.push(`${rel}: AM.${sym}`);
        }
      }
    }

    expect(unknownRefs).toEqual([]);
  });

  it("drawLaptopFrame supports both (ctx, rect) and 3-arg (ctx, w, h) callbacks cleanly", () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
      "utf8",
    );
    const fakeWin: { AM?: Record<string, (...args: unknown[]) => void> } = {};
    new Function("window", code)(fakeWin);
    const AM = fakeWin.AM;
    expect(AM).toBeDefined();

    const calls: string[] = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: (tx: number, ty: number) => calls.push(`translate:${tx},${ty}`),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      clip: () => {},
      fill: () => {},
      stroke: () => {},
      fillRect: (rx: number, ry: number, rw: number, rh: number) => calls.push(`fillRect:${rx},${ry},${rw},${rh}`),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };

    AM?.drawLaptopFrame(mockCtx, { x: 100, y: 50, w: 320, h: 200, bezel: 10 }, (_c: unknown, rect: { x: number; y: number; w: number; h: number }) => {
      calls.push(`twoArg:${rect.x},${rect.y},${rect.w},${rect.h}`);
    });
    expect(calls).toContain("twoArg:110,60,300,180");

    calls.length = 0;
    AM?.drawLaptopFrame(mockCtx, { x: 100, y: 50, w: 320, h: 200, bezel: 10 }, (_c: unknown, sw: number, sh: number) => {
      calls.push(`threeArg:${sw},${sh}`);
    });
    expect(calls).toContain("translate:110,60");
    expect(calls).toContain("threeArg:300,180");
  });

  it("drawExtrudedArrow3D auto-normalizes multiplier scale (<=8) and pixel depth (>2)", () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
      "utf8",
    );
    const fakeWin: { AM?: Record<string, (...args: unknown[]) => void> } = {};
    new Function("window", code)(fakeWin);
    const AM = fakeWin.AM;
    expect(AM).toBeDefined();

    const xs: number[] = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: (x: number) => xs.push(x),
      lineTo: (x: number) => xs.push(x),
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      shadowColor: "",
      shadowBlur: 0,
      globalAlpha: 1,
    };

    AM?.drawExtrudedArrow3D(mockCtx, 512, 288, 1.2, { depth: 30, rx: 0.2, ry: -0.2 });
    const span = Math.max(...xs) - Math.min(...xs);
    // Multiplier 1.2 should auto-scale to ~108px radius (~180-230px total width), NOT a ~2px speck.
    expect(span).toBeGreaterThan(120);
    expect(span).toBeLessThan(350);

    // AM.rng supports both callable `r()` and object methods `r.next()` / `r.range()` / `r.pick()`
    const rngFn = (AM as unknown as {
      rng: (s: number) => { (): number; next: () => number; range: (a: number, b: number) => number; pick: <T>(arr: T[]) => T };
    }).rng;
    const rA = rngFn(777);
    const rB = rngFn(777);
    expect(rA()).toBe(rB.next());
    expect(rA.range(10, 20)).toBeGreaterThanOrEqual(10);
    expect(rA.pick(["a", "b"])).toMatch(/^[ab]$/);
  });

  it("drawSphericalLens preserves main-canvas coords for 1-arg callbacks and local coords for 2-arg callbacks", () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
      "utf8",
    );
    const fakeWin: { AM?: Record<string, (...args: unknown[]) => void> } = {};
    new Function("window", code)(fakeWin);
    const AM = fakeWin.AM;
    expect(AM).toBeDefined();

    const calls: string[] = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: (tx: number, ty: number) => calls.push(`translate:${tx},${ty}`),
      fillText: (txt: string, x: number, y: number) => calls.push(`fillText:${txt}@${x},${y}`),
    };

    // 1-arg callback draws in main-canvas coordinates around (cx, cy) -> zero translation offset
    AM?.drawSphericalLens(mockCtx, 360, 640, 290, 0.8, (c: unknown) => {
      (c as typeof mockCtx).fillText("With a Motions", 360, 640);
    });
    expect(calls.some((c) => c.startsWith("translate:"))).toBe(false);
    expect(calls).toContain("fillText:With a Motions@360,640");

    calls.length = 0;
    // 2-arg callback draws in local 0..size coordinates -> translated by (cx - size/2, cy - size/2)
    AM?.drawSphericalLens(mockCtx, 360, 640, 290, 0.8, (c: unknown, sz: number) => {
      (c as typeof mockCtx).fillText(`sz=${sz}`, sz * 0.5, sz * 0.5);
    });
    expect(calls).toContain("translate:70,350");
    expect(calls).toContain("fillText:sz=580@290,290");
  });

  it("AM.resolveScene advances cleanly on rounded 30fps hard-cut boundaries without early shift", () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
      "utf8",
    );
    const fakeWin: {
      AM?: {
        resolveScene: (t: number, scenes: Array<{ id: string; start: number; duration: number }>) => { index: number };
        drawSphericalLens: (...args: unknown[]) => void;
      };
      __aetheriaErrors?: string[];
    } = { __aetheriaErrors: [] };
    new Function("window", code)(fakeWin);
    const AM = fakeWin.AM!;

    // 6 rounded-up 30fps boundaries matching 1.667/4.967/7.367/9.267/14.467/22.367
    const ends = [1.667, 4.967, 7.367, 9.267, 14.467, 22.367, 26.0];
    const scenes = ends.map((end, i) => {
      const start = i === 0 ? 0 : ends[i - 1];
      return { id: `s${i + 1}`, start, duration: Number((end - start).toFixed(3)) };
    });
    const cutFrames = [50, 149, 221, 278, 434, 671, 780];
    cutFrames.forEach((k, idx) => {
      expect(AM.resolveScene((k - 1) / 30, scenes).index).toBe(idx);
      expect(AM.resolveScene(k / 30, scenes).index).toBe(Math.min(idx + 1, scenes.length - 1));
    });

    // Rounded-down boundary 4.333 (frame 130) and 29.97fps boundary 2.502 (frame 75)
    const downScenes = [
      { id: "a", start: 0, duration: 2.502 },
      { id: "b", start: 2.502, duration: 1.831 },
      { id: "c", start: 4.333, duration: 2.0 },
    ];
    expect(AM.resolveScene(74 / 30, downScenes).index).toBe(0);
    expect(AM.resolveScene(75 / 30, downScenes).index).toBe(1);
    expect(AM.resolveScene(129 / 30, downScenes).index).toBe(1);
    expect(AM.resolveScene(130 / 30, downScenes).index).toBe(2);
  });

  it("drawSphericalLens records runtime diagnostic when callback paints zero alpha pixels", () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
      "utf8",
    );
    const emptyBuf = new Uint8ClampedArray(128 * 128 * 4);
    const makeOffCtx = () => ({
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    });
    const prevDoc = (globalThis as { document?: unknown }).document;
    const prevWin = (globalThis as { window?: unknown }).window;
    const fakeWin: { AM?: { drawSphericalLens: (...args: unknown[]) => void }; __aetheriaErrors: string[] } = {
      __aetheriaErrors: [],
    };
    (globalThis as { window?: unknown }).window = fakeWin;
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({
        width: 128,
        height: 128,
        getContext: () => makeOffCtx(),
      }),
    };
    try {
      new Function("window", code)(fakeWin);
      const mainCtx = {
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        arc: () => {},
        clip: () => {},
        drawImage: () => {},
        stroke: () => {},
      };
      expect(emptyBuf.length).toBeGreaterThan(0);
      fakeWin.AM?.drawSphericalLens(mainCtx, 360, 640, 64, 0, () => {});
      expect(fakeWin.__aetheriaErrors.some((e) => e.includes("painted nothing inside the lens disc"))).toBe(true);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
      (globalThis as { window?: unknown }).window = prevWin;
    }
  });

  it("supports 30fps cross-scene push transitions, isolation flag, and multi-pulse cameraTrack", () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
      "utf8",
    );
    const prevWin = (globalThis as { window?: unknown }).window;
    const prevDoc = (globalThis as { document?: unknown }).document;
    const fakeWin: {
      __isolateSceneTransition?: boolean;
      AM?: {
        evalCurve: (curve: number[], u: number) => number;
        resolveTransition: (t: number, scenes: Array<Record<string, unknown>>) => Record<string, unknown> | null;
        renderFrameWithTransitions: (
          ctx: unknown,
          sec: number,
          scenes: Array<Record<string, unknown>>,
          W: number,
          H: number,
          fn: (targetCtx: unknown, sc: Record<string, unknown>, idx: number, lt: number) => void,
        ) => void;
        evalCameraTrack: (track: Array<Record<string, number>>, lt: number, W: number, H: number) => { s: number; cx: number; cy: number; rot: number } | null;
      };
    } = {};
    (globalThis as { window?: unknown }).window = fakeWin;
    (globalThis as { document?: unknown }).document = undefined;
    try {
      new Function("window", code)(fakeWin);
      const AM = fakeWin.AM!;
      expect(AM.evalCurve([0, 0.25, 1], 0)).toBe(0);
      expect(AM.evalCurve([0, 0.25, 1], 0.5)).toBeCloseTo(0.25, 4);
      expect(AM.evalCurve([0, 0.25, 1], 1)).toBe(1);

      const scenes = [
        { id: "scene1", start: 0, duration: 2.0 },
        {
          id: "scene2",
          start: 2.0,
          duration: 2.0,
          transitionBridge: {
            kind: "push_left",
            tStart: 1.8,
            tEnd: 2.4,
            curve: [0, 0.5, 1],
          },
        },
        {
          id: "scene3",
          start: 4.0,
          duration: 2.0,
          transitionBridge: { kind: "hard_cut", leadInBlankSec: 0.067 },
        },
      ];
      expect(AM.resolveTransition(1.5, scenes)).toBeNull();
      expect(AM.resolveTransition(4.05, scenes)).toBeNull();
      const mid = AM.resolveTransition(2.1, scenes)!;
      expect(mid.kind).toBe("push_left");
      expect(mid.progress).toBeCloseTo(0.5, 3);
      expect(mid.fromIndex).toBe(0);
      expect(mid.toIndex).toBe(1);

      fakeWin.__isolateSceneTransition = true;
      expect(AM.resolveTransition(2.1, scenes)).toBeNull();
      fakeWin.__isolateSceneTransition = false;

      const drawn: Array<{ tx: number; id: unknown }> = [];
      let curTx = 0;
      const mockCtx = {
        save: () => {},
        restore: () => {},
        translate: (x: number, _y: number) => {
          curTx = x;
        },
      };
      AM.renderFrameWithTransitions(mockCtx, 2.1, scenes, 720, 1280, (_c, sc) => {
        drawn.push({ tx: curTx, id: sc.id });
      });
      expect(drawn.length).toBe(2);
      expect(drawn[0].id).toBe("scene1");
      expect(drawn[0].tx).toBeCloseTo(-360, 2);
      expect(drawn[1].id).toBe("scene2");
      expect(drawn[1].tx).toBeCloseTo(360, 2);

      // Even when totalDispPx > 0 with offscreen buffers, push_left must composite bufA & bufB
      // continuously side-by-side (tx - fx === W) with zero cutSec snap and zero clip-rect seam.
      const pushDraws: Array<{ x: number; y: number }> = [];
      const makeOffBuf = () => ({
        width: 720,
        height: 1280,
        getContext: () => ({
          setTransform: () => {},
          clearRect: () => {},
        }),
      });
      (globalThis as { document?: unknown }).document = { createElement: makeOffBuf };
      const mainCanvasCtx = {
        save: () => {},
        restore: () => {},
        setTransform: () => {},
        drawImage: (_buf: unknown, dx: number, dy: number) => pushDraws.push({ x: dx, y: dy }),
      };
      const measuredScenes = [
        { id: "sA", start: 0, duration: 2.0 },
        {
          id: "sB",
          start: 2.0,
          duration: 2.0,
          transitionBridge: {
            kind: "push_left",
            tStart: 1.8,
            cutSec: 2.0,
            tEnd: 2.4,
            totalDispPx: 353.6,
            curve: [0, 0.25, 0.5, 0.75, 1],
          },
        },
      ];
      for (const probeT of [1.95, 2.05]) {
        pushDraws.length = 0;
        AM.renderFrameWithTransitions(mainCanvasCtx, probeT, measuredScenes, 720, 1280, () => {});
        expect(pushDraws.length).toBe(2);
        expect(pushDraws[1].x - pushDraws[0].x).toBeCloseTo(720, 3);
      }
      (globalThis as { document?: unknown }).document = undefined;

      const track = [
        { t: 0.0, tx: 0, ty: 0, s: 1.0, rot: 0 },
        { t: 0.5, tx: 0, ty: 0, s: 1.0, rot: 0 },
        { t: 1.0, tx: 0, ty: -120, s: 1.2, rot: 0 },
        { t: 2.0, tx: 0, ty: -120, s: 1.2, rot: 0 },
      ];
      const holdStart = AM.evalCameraTrack(track, 0.25, 720, 1280)!;
      expect(holdStart.s).toBeCloseTo(1.0, 3);
      expect(holdStart.cy).toBeCloseTo(640, 2);
      const midPan = AM.evalCameraTrack(track, 0.75, 720, 1280)!;
      expect(midPan.s).toBeCloseTo(1.1, 3);
      expect(midPan.cy).toBeGreaterThan(640);
      const holdEnd = AM.evalCameraTrack(track, 1.5, 720, 1280)!;
      expect(holdEnd.s).toBeCloseTo(1.2, 3);
      expect(holdEnd.cy).toBeCloseTo(640 + 120 / 1.2, 2);

      // MotionCraft choreography helpers: layoutBalancedHeadline, drawBlurRevealText, drawBlurRiseWords, drawTurntableObject, drawMorphPolygon
      const measureCtx = {
        font: "700 48px Inter",
        fillStyle: "#111116",
        textAlign: "left",
        globalAlpha: 1,
        filter: "none",
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {},
        arc: () => {},
        setLineDash: () => {},
        measureText: (s: string) => ({ width: s.length * 18 }),
        fillText: () => {},
      };
      const lines = (AM as unknown as {
        layoutBalancedHeadline: (c: unknown, txt: string, maxW: number) => string[];
        drawBlurRevealText: (c: unknown, txt: string, x: number, y: number, t: number, t0: number, dur: number, opts?: unknown) => void;
        drawBlurRiseWords: (c: unknown, txt: string, x: number, y: number, t: number, t0: number, opts?: unknown) => void;
        drawTurntableObject: (c: unknown, cx: number, cy: number, t: number, fn: () => void, opts?: unknown) => void;
        drawMorphPolygon: (c: unknown, a: number[][], b: number[][], p: number, opts?: unknown) => Array<{ x: number; y: number }>;
      }).layoutBalancedHeadline(measureCtx, "Smart decisions aren't Luck", 280);
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Smart decisions");
      expect(lines[1]).toBe("aren't Luck");

      const amExt = AM as unknown as {
        ease: {
          inOutQuart: (u: number) => number;
          outQuint: (u: number) => number;
          inOutQuint: (u: number) => number;
          aeGlide: (u: number) => number;
          aeSnap: (u: number) => number;
        };
        E: {
          ioQt: (u: number) => number;
          outQn: (u: number) => number;
          ioQn: (u: number) => number;
          aeGlide: (u: number) => number;
          aeSnap: (u: number) => number;
        };
        drawBlurRevealText: (c: unknown, txt: string, x: number, y: number, t: number, t0: number, dur: number, opts?: unknown) => void;
        drawBlurRiseWords: (c: unknown, txt: string, x: number, y: number, t: number, t0: number, opts?: unknown) => void;
        drawTurntableObject: (c: unknown, cx: number, cy: number, t: number, fn: () => void, opts?: unknown) => void;
        drawMorphPolygon: (c: unknown, a: number[][], b: number[][], p: number, opts?: unknown) => Array<{ x: number; y: number }>;
      };
      expect(typeof amExt.ease.inOutQuart).toBe("function");
      expect(amExt.ease.inOutQuart(0.5)).toBeCloseTo(0.5, 4);
      expect(amExt.E.ioQt(0.5)).toBeCloseTo(0.5, 4);
      expect(amExt.ease.outQuint(0.5)).toBeGreaterThan(0.95);
      expect(amExt.ease.inOutQuint(0.5)).toBeCloseTo(0.5, 4);
      expect(amExt.E.outQn(0.5)).toBeCloseTo(amExt.ease.outQuint(0.5), 5);
      expect(amExt.E.ioQn(0.5)).toBeCloseTo(0.5, 4);
      expect(amExt.ease.aeGlide(0.25)).toBeGreaterThan(0.65);
      expect(amExt.ease.aeSnap(0.5)).toBeCloseTo(0.5, 2);
      expect(amExt.E.aeGlide(1)).toBe(1);
      expect(amExt.E.aeSnap(0)).toBe(0);
      let ttCalled = 0;
      const alphaTrack: number[] = [];
      const origFillText = measureCtx.fillText;
      measureCtx.fillText = () => {
        alphaTrack.push(measureCtx.globalAlpha);
      };
      amExt.drawBlurRevealText(measureCtx, "research", 80, 600, 0.2, 0.0, 0.45, {
        scaleFrom: 0.28,
        maxBlur: 18,
        exitAt: 1.0,
        exitDur: 0.28,
      });
      expect(alphaTrack.length).toBeGreaterThan(0);
      alphaTrack.length = 0;
      // During exit window (t = 1.14 is 50% through exitAt=1.0..1.28), characters fade & blur out
      amExt.drawBlurRevealText(measureCtx, "research", 80, 600, 1.14, 0.0, 0.45, {
        scaleFrom: 0.28,
        maxBlur: 18,
        exitAt: 1.0,
        exitDur: 0.28,
      });
      expect(alphaTrack.length).toBeGreaterThan(0);
      expect(alphaTrack[0]).toBeLessThan(0.95);
      alphaTrack.length = 0;
      // Past exitAt + exitDur (t = 1.35), nothing is drawn
      amExt.drawBlurRevealText(measureCtx, "research", 80, 600, 1.35, 0.0, 0.45, {
        scaleFrom: 0.28,
        maxBlur: 18,
        exitAt: 1.0,
        exitDur: 0.28,
      });
      expect(alphaTrack.length).toBe(0);
      measureCtx.fillText = origFillText;
      amExt.drawBlurRiseWords(measureCtx, "shows that", 80, 680, 0.3, 0.0, { preBlurSec: 0.15 });
      amExt.drawTurntableObject(measureCtx, 360, 440, 0.5, () => {
        ttCalled += 1;
      }, { ringRadius: 120 });
      amExt.drawTurntableObject(measureCtx, 360, 440, 1.5, () => {
        ttCalled += 1;
      }, { ringRadius: 120, spinMode: "rock" });
      // Zero-omega bypasses spherical 3D warp cleanly and still renders flat 2D content once
      amExt.drawTurntableObject(measureCtx, 360, 440, 1.0, () => {
        ttCalled += 1;
      }, { omega: 0, ringRadius: 0 });
      expect(ttCalled).toBe(3);
      const morphed = amExt.drawMorphPolygon(
        measureCtx,
        [[0, -40], [40, 0], [0, 40], [-40, 0]],
        [[-30, -30], [30, -30], [30, 30], [-30, 30]],
        0.5,
        { fill: "#7602BD" },
      );
      expect(morphed.length).toBe(4);
      expect(morphed[0].x).toBeCloseTo(-15, 2);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
      (globalThis as { window?: unknown }).window = prevWin;
    }
  });
});
