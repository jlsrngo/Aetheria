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
  it("lints all 16 mg-* SKILL.md files against forbidden engine/non-harness boilerplate", () => {
    const skillFiles = listMgSkillFiles();
    expect(skillFiles.length).toBe(16);

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
    expect(exported.size).toBeGreaterThanOrEqual(42);

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
});
