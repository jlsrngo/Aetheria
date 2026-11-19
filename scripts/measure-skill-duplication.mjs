#!/usr/bin/env node
/**
 * K0 Duplication Metrics for built-in declarative `mg-*` skill runtimes.
 *
 * Scans `.aetheria/skills/mg-<name>/examples/script/story-runtime.js` (zero external deps)
 * and outputs JSON with:
 * - per-skill total lines, meaningful lines, and function declarations
 * - function names duplicated across >1 skill
 * - meaningful lines shared across >=2 and >=10 skills
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.join(REPO_ROOT, ".aetheria", "skills");

function isMeaningfulLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return false;
  if (trimmed === "{" || trimmed === "}" || trimmed === "});" || trimmed === "})();" || trimmed === ");") return false;
  return true;
}

function extractFunctionNames(source) {
  const names = new Set();
  const fnDecl = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = fnDecl.exec(source)) !== null) {
    names.add(m[1]);
  }
  const varFn = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/g;
  while ((m = varFn.exec(source)) !== null) {
    names.add(m[1]);
  }
  return Array.from(names).sort();
}

export function measureSkillDuplication() {
  const dirs = fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("mg-"))
    .map((d) => d.name)
    .sort();

  const perSkill = [];
  const fnOccurrences = new Map(); // fnName -> Set<skill>
  const lineOccurrences = new Map(); // normalized meaningful line -> Set<skill>
  let totalLinesAll = 0;
  let totalMeaningfulAll = 0;

  for (const skill of dirs) {
    const rtPath = path.join(SKILLS_ROOT, skill, "examples", "script", "story-runtime.js");
    if (!fs.existsSync(rtPath)) continue;
    const raw = fs.readFileSync(rtPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const meaningful = lines.filter(isMeaningfulLine).map((l) => l.trim());
    const fns = extractFunctionNames(raw);

    totalLinesAll += lines.length;
    totalMeaningfulAll += meaningful.length;

    const uniqueLinesInSkill = new Set(meaningful);
    for (const line of uniqueLinesInSkill) {
      if (!lineOccurrences.has(line)) lineOccurrences.set(line, new Set());
      lineOccurrences.get(line).add(skill);
    }
    for (const fn of fns) {
      if (!fnOccurrences.has(fn)) fnOccurrences.set(fn, new Set());
      fnOccurrences.get(fn).add(skill);
    }

    perSkill.push({
      skill,
      totalLines: lines.length,
      meaningfulLines: meaningful.length,
      functionCount: fns.length,
      functions: fns,
    });
  }

  const duplicatedFunctions = Array.from(fnOccurrences.entries())
    .filter(([, set]) => set.size > 1)
    .map(([name, set]) => ({ name, count: set.size, skills: Array.from(set).sort() }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  let meaningfulLinesInSharedGe2 = 0;
  let meaningfulLinesInSharedGe10 = 0;
  for (const s of perSkill) {
    const rtPath = path.join(SKILLS_ROOT, s.skill, "examples", "script", "story-runtime.js");
    const lines = fs.readFileSync(rtPath, "utf8").split(/\r?\n/).filter(isMeaningfulLine).map((l) => l.trim());
    for (const l of lines) {
      const freq = lineOccurrences.get(l)?.size || 0;
      if (freq >= 2) meaningfulLinesInSharedGe2++;
      if (freq >= 10) meaningfulLinesInSharedGe10++;
    }
  }

  const corePath = path.join(REPO_ROOT, "apps", "public", "script", "story-core.js");
  const storyCoreLines = fs.existsSync(corePath)
    ? fs.readFileSync(corePath, "utf8").split(/\r?\n/).length
    : 0;

  return {
    skillCount: perSkill.length,
    totalLinesAll,
    totalMeaningfulAll,
    storyCoreLines,
    duplicatedFunctionCount: duplicatedFunctions.length,
    duplicatedFunctions,
    sharedMeaningfulLinesGe2Pct:
      totalMeaningfulAll > 0
        ? Math.round((meaningfulLinesInSharedGe2 / totalMeaningfulAll) * 1000) / 10
        : 0,
    sharedMeaningfulLinesGe10Pct:
      totalMeaningfulAll > 0
        ? Math.round((meaningfulLinesInSharedGe10 / totalMeaningfulAll) * 1000) / 10
        : 0,
    perSkill: perSkill.map(({ functions: _f, ...rest }) => rest),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = measureSkillDuplication();
  console.log(JSON.stringify(result, null, 2));
}
