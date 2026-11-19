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
  it("lints all 17 mg-* SKILL.md files against forbidden engine/non-harness boilerplate", () => {
    const skillFiles = listMgSkillFiles();
    // 16 original mg-* skills + 1 new declarative skill (mg-product-keynote)
    expect(skillFiles.length).toBe(17);

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
    for (const sym of ["drawCursor", "drawExtrudedArrow3D", "drawLaptopFrame", "drawWordWheel"]) {
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
});
