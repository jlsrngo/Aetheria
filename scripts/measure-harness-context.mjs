#!/usr/bin/env node
/**
 * F0 Harness Context & Session Baseline Measurement (Zero-LLM, 100% deterministic).
 * Usage:
 *   node scripts/measure-harness-context.mjs [--skill=mg-soft-clay-story] [--workspace=E:\JS\Aetheria-Workspace] [--out=docs/baseline-f0-2026-11-17.md]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = {
    skill: "mg-soft-clay-story",
    workspace: "E:\\JS\\Aetheria-Workspace",
    outMd: path.join(REPO_ROOT, "docs", "baseline-f0-2026-11-17.md"),
    outJson: path.join(REPO_ROOT, "scripts", "out", "baseline-f0.json"),
    checkDeterminism: false,
  };
  for (const a of argv) {
    if (a.startsWith("--skill=")) opts.skill = a.slice("--skill=".length);
    else if (a.startsWith("--workspace=")) opts.workspace = a.slice("--workspace=".length);
    else if (a.startsWith("--out=")) opts.outMd = path.resolve(REPO_ROOT, a.slice("--out=".length));
    else if (a.startsWith("--json=")) opts.outJson = path.resolve(REPO_ROOT, a.slice("--json=".length));
    else if (a === "--stdout-only") {
      opts.outMd = null;
      opts.outJson = null;
    }
  }
  return opts;
}

function roughTokens(chars) {
  return Math.ceil(chars / 4);
}

function stripRustComments(src) {
  let out = "";
  let inStr = false;
  let escaped = false;
  let rawHashes = -1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (rawHashes >= 0) {
      out += ch;
      if (ch === '"') {
        let h = 0;
        while (src[i + 1 + h] === "#" && h < rawHashes) h++;
        if (h === rawHashes) {
          out += "#".repeat(rawHashes);
          i += rawHashes;
          rawHashes = -1;
        }
      }
      continue;
    }
    if (inStr) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 1;
      continue;
    }
    if (ch === "r" && (next === '"' || next === "#")) {
      let h = 0;
      while (src[i + 1 + h] === "#") h++;
      if (src[i + 1 + h] === '"') {
        out += src.slice(i, i + 2 + h);
        i += 1 + h;
        rawHashes = h;
        continue;
      }
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function extractBalancedBlock(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return null;
}

function resolveRustJsonLiterals(rustFilePath, rawBlock) {
  const dir = path.dirname(rustFilePath);
  const replacedInclude = rawBlock.replace(
    /include_str!\(\s*"([^"]+)"\s*\)/g,
    (_, relPath) => {
      const target = path.resolve(dir, relPath);
      const txt = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      return JSON.stringify(txt);
    }
  );
  // Normalize Rust string concatenation inside arrays or JSON literals if any
  try {
    const stripped = replacedInclude.trim();
    if (stripped.startsWith("json!(") && stripped.endsWith(")")) {
      const inner = stripped.slice("json!(".length, -1).trim();
      return JSON.parse(inner);
    }
    if (stripped.startsWith("{") && stripped.endsWith("}")) {
      return JSON.parse(stripped);
    }
  } catch {
    // Fallback below: strip Rust non-JSON expressions if needed
  }
  return null;
}

function collectSingleToolDefsFromRust(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const clean = stripRustComments(raw);
  const defs = [];
  const jsonRe = /json!\s*\(\s*\{/g;
  let m;
  while ((m = jsonRe.exec(clean)) !== null) {
    const braceStart = clean.indexOf("{", m.index);
    const block = extractBalancedBlock(clean, braceStart, "{", "}");
    if (!block) continue;
    if (!block.includes('"type"') || !block.includes('"function"')) continue;
    const parsed = resolveRustJsonLiterals(filePath, `json!(${block})`);
    if (parsed && parsed.type === "function" && parsed.function?.name) {
      defs.push({
        name: parsed.function.name,
        sourceFile: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
        jsonChars: JSON.stringify(parsed).length,
      });
    } else {
      // Measure expanded literal size even if Rust expression interpolation is present inside json!()
      const expanded = block.replace(/include_str!\(\s*"([^"]+)"\s*\)/g, (_, relPath) => {
        const target = path.resolve(path.dirname(filePath), relPath);
        const txt = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
        return JSON.stringify(txt);
      });
      const nameMatch = expanded.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        defs.push({
          name: nameMatch[1],
          sourceFile: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
          jsonChars: expanded.replace(/\s+/g, " ").length,
        });
      }
    }
  }
  return defs;
}

function parseCatalogTools() {
  const toolDir = path.join(REPO_ROOT, "core", "aetheria-engine", "src", "tool");
  const subagentFile = path.join(
    REPO_ROOT,
    "core",
    "aetheria-engine",
    "src",
    "session",
    "agent_turn",
    "subagent.rs"
  );
  const files = fs
    .readdirSync(toolDir)
    .filter((f) => f.endsWith(".rs"))
    .sort()
    .map((f) => path.join(toolDir, f));
  files.push(subagentFile);

  const byName = new Map();
  for (const fp of files) {
    for (const def of collectSingleToolDefsFromRust(fp)) {
      if (!byName.has(def.name)) {
        byName.set(def.name, def);
      }
    }
  }

  // Filter strictly to tools registered in build_tool_definitions() in catalog.rs
  const catalogSrc = fs.readFileSync(path.join(toolDir, "catalog.rs"), "utf8");
  const registeredOrder = [];
  const fnRe = /(\w+)::(\w+_tool_definition)\(\)|(\w+_tool_definition)\(\)|skill_tool_definitions\(\)/g;
  const catalogFnIdx = catalogSrc.indexOf("pub fn build_tool_definitions()");
  const catalogBody = extractBalancedBlock(
    catalogSrc,
    catalogSrc.indexOf("{", catalogFnIdx),
    "{",
    "}"
  );
  if (catalogBody) {
    if (catalogBody.includes("skill_tool_definitions()")) {
      for (const n of [
        "plugin_install",
        "plugin_list",
        "plugin_toggle",
        "plugin_update",
        "plugin_uninstall",
      ]) {
        if (byName.has(n)) registeredOrder.push(byName.get(n));
      }
    }
    const callNames = [
      "film_scaffold",
      "produce_video",
      "render_video",
      "capture_film_preview",
      "voicebox_speak",
      "generate_smart_sfx",
      "extract_video_reference",
      "fetch_web_image",
      "read",
      "write",
      "edit",
      "glob",
      "grep",
      "todowrite",
      "websearch",
      "question",
      "manage_operational_tasks",
      "bash",
      "apply_patch",
      "webfetch",
      "lsp",
      "snapshot",
      "codemode",
      "register_motion_style",
      "task",
    ];
    for (const name of callNames) {
      // Only count if present in catalog.rs / subagent.rs
      const presentInCatalog =
        name === "task"
          ? catalogBody.includes("spawn_subagent_tool_definition")
          : name === "register_motion_style"
            ? catalogBody.includes("register_style_tool_definition")
            : catalogBody.includes(name) ||
              catalogBody.includes(name.replace(/_video|_film|_speak|manage_operational_/, "")) ||
              byName.has(name);
      if (presentInCatalog && byName.has(name)) {
        registeredOrder.push(byName.get(name));
      }
    }
  }

  // Validate against build_tool_definitions call expressions directly
  const allCatalogDefs = [];
  const seen = new Set();
  const fnCallRe = /(?:(\w+)::)?(\w+_tool_definition(?:s)?)\(\)/g;
  let cm;
  while ((cm = fnCallRe.exec(catalogBody || "")) !== null) {
    const modName = cm[1];
    const fnName = cm[2];
    if (fnName === "skill_tool_definitions") {
      for (const n of [
        "plugin_install",
        "plugin_list",
        "plugin_toggle",
        "plugin_update",
        "plugin_uninstall",
      ]) {
        if (byName.has(n) && !seen.has(n)) {
          seen.add(n);
          allCatalogDefs.push(byName.get(n));
        }
      }
      continue;
    }
    const candidateFile =
      fnName === "spawn_subagent_tool_definition"
        ? subagentFile
        : fnName === "register_style_tool_definition"
          ? path.join(toolDir, "catalog.rs")
          : path.join(toolDir, `${modName}.rs`);
    if (fs.existsSync(candidateFile)) {
      const defsInFile = collectSingleToolDefsFromRust(candidateFile);
      for (const d of defsInFile) {
        if (!seen.has(d.name)) {
          seen.add(d.name);
          allCatalogDefs.push(d);
        }
      }
    }
  }
  allCatalogDefs.sort((a, b) => a.name.localeCompare(b.name));
  return allCatalogDefs;
}

function measureRoles(allTools) {
  const runnerSrc = fs.readFileSync(
    path.join(REPO_ROOT, "core", "aetheria-engine", "src", "session", "agent_turn", "runner.rs"),
    "utf8"
  );
  const subStoreSrc = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "core",
      "aetheria-engine",
      "src",
      "session",
      "agent_turn",
      "subagent_store.rs"
    ),
    "utf8"
  );

  // Extract coordinator exclusion list or role profile if refactored in F3
  const coordFnIdx = runnerSrc.indexOf("fn build_main_coordinator_tools");
  const coordBody =
    coordFnIdx >= 0
      ? extractBalancedBlock(runnerSrc, runnerSrc.indexOf("{", coordFnIdx), "{", "}") || ""
      : "";

  const subFnIdx = subStoreSrc.indexOf("pub fn build_subagent_tools");
  const subBody =
    subFnIdx >= 0
      ? extractBalancedBlock(subStoreSrc, subStoreSrc.indexOf("{", subFnIdx), "{", "}") || ""
      : "";

  function extractAllowlist(matchSrc, personaKey) {
    const idx = matchSrc.indexOf(`"${personaKey}" =>`);
    if (idx < 0) return null;
    const armEnd = matchSrc.indexOf("=>", idx);
    // Stop before next match arm so we never bleed into an earlier/later arm's matches!()
    const nextArmRel = matchSrc.slice(armEnd + 2).search(/\n\s*"[a-z-]+"\s*=>|\n\s*_\s*=>/);
    const slice =
      nextArmRel >= 0
        ? matchSrc.slice(armEnd, armEnd + 2 + nextArmRel)
        : matchSrc.slice(armEnd, armEnd + 700);
    const negMatch = slice.match(/!matches!\s*\(\s*name\s*,([\s\S]*?)\)/);
    if (negMatch) {
      return {
        negated: true,
        names: Array.from(negMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]),
      };
    }
    const matchesBlock = slice.match(/matches!\s*\(\s*name\s*,([\s\S]*?)\)/);
    if (!matchesBlock) return null;
    return {
      negated: false,
      names: Array.from(matchesBlock[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]),
    };
  }

  const roles = {};
  const profilesFile = path.join(REPO_ROOT, "core", "aetheria-engine", "src", "tool", "profiles.rs");
  const rawProfilesSrc = fs.existsSync(profilesFile) ? fs.readFileSync(profilesFile, "utf8") : "";
  const fnIdx = rawProfilesSrc.indexOf("pub fn is_tool_allowed_in_role");
  const pSrc = fnIdx >= 0 ? rawProfilesSrc.slice(fnIdx) : rawProfilesSrc;

  const coordExcluded = new Set();
  if (coordBody.includes("!matches!")) {
    const excl = coordBody.match(/!matches!\s*\(\s*name\s*,([\s\S]*?)\)/);
    if (excl) {
      for (const m of excl[1].matchAll(/"([^"]+)"/g)) coordExcluded.add(m[1]);
    }
  } else if (pSrc) {
    const genSpec = extractAllowlist(pSrc, "general");
    if (genSpec && genSpec.negated) {
      for (const n of genSpec.names) coordExcluded.add(n);
    }
  }
  roles.coordinator_default = allTools.filter((t) => !coordExcluded.has(t.name));

  // If F3 tool profiles exist (tool/profiles.rs), read them explicitly too
  if (pSrc) {
    for (const pName of ["director", "motion-designer", "qa-verifier", "audio-director", "general"]) {
      const spec = extractAllowlist(pSrc, pName);
      if (spec) {
        const nameSet = new Set(spec.names);
        roles[`profile:${pName}`] = spec.negated
          ? allTools.filter((t) => !nameSet.has(t.name))
          : allTools.filter((t) => nameSet.has(t.name));
      }
    }
  }

  for (const persona of ["explore", "audio-director", "motion-designer", "qa-verifier"]) {
    const spec = extractAllowlist(subBody, persona) || (pSrc ? extractAllowlist(pSrc, persona) : null);
    if (spec) {
      const nameSet = new Set(spec.names);
      roles[`subagent:${persona}`] = spec.negated
        ? allTools.filter((t) => !nameSet.has(t.name))
        : allTools.filter((t) => nameSet.has(t.name));
    } else {
      // Fallback `_ => true` removes `question` and (at max depth) `task`
      roles[`subagent:${persona}`] = allTools.filter((t) => t.name !== "question");
    }
  }

  const summary = {};
  for (const [role, list] of Object.entries(roles)) {
    const totalJsonChars = list.reduce((acc, t) => acc + t.jsonChars, 0);
    summary[role] = {
      count: list.length,
      jsonChars: totalJsonChars,
      roughTokens: roughTokens(totalJsonChars),
      tools: list.map((t) => t.name),
    };
  }
  return summary;
}

function walkFilesSorted(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) results.push(full);
    }
  }
  return results.sort();
}

function measureSkillInjection(skillName) {
  const skillsRoot = path.join(REPO_ROOT, ".aetheria", "skills");
  const allSkills = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const perSkillSummary = allSkills.map((name) => {
    const sdir = path.join(skillsRoot, name);
    const skillMd = fs.existsSync(path.join(sdir, "SKILL.md"))
      ? fs.readFileSync(path.join(sdir, "SKILL.md"), "utf8").length
      : 0;
    const styleMd = fs.existsSync(path.join(sdir, "style.md"))
      ? fs.readFileSync(path.join(sdir, "style.md"), "utf8").length
      : 0;
    const tokensJson = fs.existsSync(path.join(sdir, "tokens.json"))
      ? fs.readFileSync(path.join(sdir, "tokens.json"), "utf8").length
      : 0;
    const remotionBrief = fs.existsSync(path.join(sdir, "REMOTION_BRIEF.md"))
      ? fs.readFileSync(path.join(sdir, "REMOTION_BRIEF.md"), "utf8").length
      : 0;
    const exFiles = walkFilesSorted(path.join(sdir, "examples")).slice(0, 6);
    let examplesInjectedChars = 0;
    for (const ef of exFiles) {
      const content = fs.readFileSync(ef, "utf8");
      if (examplesInjectedChars + content.length <= 35_000) {
        examplesInjectedChars += content.length;
      }
    }
    const primaryDocChars = styleMd > 0 ? styleMd : skillMd;
    const totalInjected = primaryDocChars + tokensJson + remotionBrief + examplesInjectedChars;
    return {
      name,
      skillMdChars: skillMd,
      styleMdChars: styleMd,
      tokensJsonChars: tokensJson,
      remotionBriefChars: remotionBrief,
      examplesInjectedChars,
      totalInjectedChars: totalInjected,
      roughTokens: roughTokens(totalInjected),
    };
  });

  const chosen =
    perSkillSummary.find((s) => s.name === skillName) || perSkillSummary[0] || null;
  return { chosen, allSkills: perSkillSummary };
}

function measureDynamicContext(workspaceDir) {
  const ws = workspaceDir;
  const exists = fs.existsSync(ws);
  if (!exists) {
    return { workspace: ws, exists: false };
  }

  let rawLivingMemoryChars = 0;
  let rawLivingMemory = "";
  const aetheriaMd = path.join(ws, ".aetheria", "AETHERIA.md");
  if (fs.existsSync(aetheriaMd)) {
    rawLivingMemory = fs.readFileSync(aetheriaMd, "utf8").trim();
    rawLivingMemoryChars += rawLivingMemory.length;
  }
  const corrections = path.join(ws, ".aetheria", "user-corrections.jsonl");
  if (fs.existsSync(corrections)) {
    rawLivingMemoryChars += fs.readFileSync(corrections, "utf8").trim().length;
  }

  // F6 compacted living memory (<= 8 catalog entries, <= 900 chars)
  const memLines = [];
  let inCat = false;
  let catKept = 0;
  let catOmitted = 0;
  for (const line of rawLivingMemory.split(/\r?\n/)) {
    const ltrim = line.trimStart();
    if (ltrim.startsWith("## ")) {
      if (inCat && catOmitted > 0) memLines.push(`- ... (${catOmitted} more files; inspect via \`glob\`)`);
      inCat = ltrim.startsWith("## Workspace Catalog");
      catKept = 0;
      catOmitted = 0;
      memLines.push(line);
      continue;
    }
    if (ltrim.startsWith("<!--") && ltrim.endsWith("-->")) continue;
    if (inCat && ltrim.startsWith("- ")) {
      if (catKept < 8) { memLines.push(line); catKept++; } else catOmitted++;
      continue;
    }
    memLines.push(line);
  }
  if (inCat && catOmitted > 0) memLines.push(`- ... (${catOmitted} more files; inspect via \`glob\`)`);
  const livingMemoryCapped = memLines.join("\n").trim().slice(0, 900);
  const livingMemoryChars = livingMemoryCapped.length;

  let rawKnowledgeChars = 0;
  let knowledgeNotes = 0;
  const knNodes = [];
  const knPath = path.join(ws, ".aetheria", "knowledge.json");
  if (fs.existsSync(knPath)) {
    try {
      const kn = JSON.parse(fs.readFileSync(knPath, "utf8"));
      const nodes = Array.isArray(kn) ? kn : Array.isArray(kn?.nodes) ? kn.nodes : [];
      const active = nodes
        .filter((n) => n && n.active === true && n.id !== "main-ai-node")
        .slice(0, 10);
      knowledgeNotes = active.length;
      for (const n of active) {
        const title = String(n.title || "Note");
        const content = String(n.content || "").slice(0, 4000);
        rawKnowledgeChars += `--- ${title} ---\n${content}\n`.length;
        knNodes.push({ title, body: String(n.content || "").slice(0, 320), pinned: Boolean(n.pinned || n.alwaysInject) });
      }
    } catch {
      // ignore parse errors
    }
  }
  const knowledgeChars = knNodes
    .slice(0, 5)
    .reduce((acc, n) => (acc + n.body.length + n.title.length + 12 <= 1500 ? acc + n.body.length + n.title.length + 12 : acc), 0);

  let rawSkillsCatalogChars = 0;
  let skillsCatalogCount = 0;
  const compactSkillLines = [];
  const seenSkills = new Set();
  for (const base of [
    path.join(ws, ".aetheria", "skills"),
    path.join(ws, ".agents", "skills"),
    path.join(ws, "skills"),
    path.join(ws, ".opencode", "skills"),
    path.join(REPO_ROOT, ".aetheria", "skills"),
    path.join(REPO_ROOT, ".agents", "skills"),
    path.join(REPO_ROOT, ".opencode", "skills"),
  ]) {
    if (!fs.existsSync(base)) continue;
    const entries = fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (!ent.isDirectory() || seenSkills.has(ent.name)) continue;
      const smd = path.join(base, ent.name, "SKILL.md");
      if (!fs.existsSync(smd)) continue;
      seenSkills.add(ent.name);
      skillsCatalogCount++;
      const lines = fs.readFileSync(smd, "utf8").split("\n").slice(0, 30);
      let sName = ent.name;
      let sDesc = "";
      for (const l of lines) {
        const t = l.trim();
        if (t.startsWith("name:")) sName = t.slice(5).trim();
        else if (t.startsWith("description:")) sDesc = t.slice(12).trim();
      }
      if (!sDesc) sDesc = `Skill: ${sName}`;
      rawSkillsCatalogChars += `- ${sName}: ${sDesc} (Path: ${smd})\n`.length;
      const shortDesc = sDesc.length <= 72 ? sDesc : `${sDesc.slice(0, 69).trimEnd()}...`;
      compactSkillLines.push({ slug: ent.name, name: sName, line: `- ${sName}: ${shortDesc}`, smd });
    }
  }
  const skillHdr = "<skills>\nMotion/domain skills in `.aetheria/skills/<name>/SKILL.md` (call `read` to inspect; use `/<name>` to lock):\n";
  let skillsCatalogChars = 0;
  if (compactSkillLines.length > 0) {
    let used = skillHdr.length + "\n</skills>".length;
    for (const s of compactSkillLines) {
      if (used + s.line.length + 1 > 1600) break;
      used += s.line.length + 1;
    }
    skillsCatalogChars = Math.min(used + 45, 1600);
  }
  const clay = compactSkillLines.find((s) => s.slug === "mg-soft-clay-story") || compactSkillLines[0];
  const skillsExplicitChars = clay ? (skillHdr.length + clay.line.length + clay.smd.length + 14) : 0;

  let rawPluginRulesChars = 0;
  const pluginsDir = path.join(ws, ".aetheria", "plugins");
  if (fs.existsSync(pluginsDir)) {
    for (const ent of fs.readdirSync(pluginsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!ent.isDirectory()) continue;
      const rulesDir = path.join(pluginsDir, ent.name, "rules");
      if (!fs.existsSync(rulesDir)) continue;
      for (const rf of fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort()) {
        rawPluginRulesChars += fs.readFileSync(path.join(rulesDir, rf), "utf8").trim().length;
      }
    }
  }
  const pluginRulesChars = Math.min(rawPluginRulesChars, 1500);

  const rawDynamicChars = rawLivingMemoryChars + rawKnowledgeChars + rawSkillsCatalogChars + rawPluginRulesChars;
  const totalDynamicChars = Math.min(livingMemoryChars + knowledgeChars + skillsCatalogChars + pluginRulesChars, 3500);
  const explicitSkillTurnChars = Math.min(livingMemoryChars + knowledgeChars + skillsExplicitChars + pluginRulesChars, 3500);
  const nonVideoTurnChars = Math.min(livingMemoryChars + knowledgeChars + pluginRulesChars, 3500);
  return {
    workspace: ws,
    exists: true,
    livingMemoryChars,
    rawLivingMemoryChars,
    livingMemoryTokensRough: roughTokens(livingMemoryChars),
    knowledgeNotes,
    knowledgeChars,
    rawKnowledgeChars,
    knowledgeTokensRough: roughTokens(knowledgeChars),
    skillsCatalogCount,
    skillsCatalogChars,
    rawSkillsCatalogChars,
    skillsCatalogTokensRough: roughTokens(skillsCatalogChars),
    pluginRulesChars,
    rawPluginRulesChars,
    pluginRulesTokensRough: roughTokens(pluginRulesChars),
    rawDynamicChars,
    rawDynamicTokensRough: roughTokens(rawDynamicChars),
    totalDynamicChars,
    totalDynamicTokensRough: roughTokens(totalDynamicChars),
    explicitSkillTurnChars,
    nonVideoTurnChars,
    greetingTurnChars: 0,
  };
}

function measureSessionsStore() {
  const storePath = path.join(
    os.homedir(),
    ".local",
    "share",
    "aetheria-nexus",
    "sessions-store.json"
  );
  if (!fs.existsSync(storePath)) {
    return { status: "tidak terverifikasi", reason: `File tidak ditemukan: ${storePath}` };
  }

  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const sessionEntries = Object.entries(store.sessions || {}).sort(([aId, a], [bId, b]) => {
    const ta = a?.time?.created || a?.createdAt || 0;
    const tb = b?.time?.created || b?.createdAt || 0;
    return ta !== tb ? ta - tb : aId.localeCompare(bId);
  });

  const targetTools = new Set([
    "read",
    "edit",
    "write",
    "todowrite",
    "task",
    "question",
    "capture_film_preview",
  ]);
  const videoSessions = [];
  const agg = {
    totalSessions: sessionEntries.length,
    videoSessionsCount: 0,
    editCalls: 0,
    editErrors: 0,
    readCalls: 0,
    writeCalls: 0,
    todowriteCalls: 0,
    taskCalls: 0,
    questionCalls: 0,
    previewCalls: 0,
  };

  for (const [sid, meta] of sessionEntries) {
    const msgs = store.messages?.[sid] || [];
    const counts = {
      read: 0,
      edit: 0,
      editErrors: 0,
      write: 0,
      todowrite: 0,
      task: 0,
      question: 0,
      capture_film_preview: 0,
    };
    let stepsBeforeFirstPreview = null;
    let totalToolCalls = 0;
    let sawVideoCue = false;

    for (const m of msgs) {
      const parts = m.parts || m.content || [];
      if (!Array.isArray(parts)) continue;
      for (const p of parts) {
        if (p.type !== "tool" && p.type !== "tool_use") continue;
        const name = p.tool || p.name || "";
        totalToolCalls++;
        if (
          name === "capture_film_preview" ||
          name === "film_scaffold" ||
          name === "produce_video" ||
          name === "render_video" ||
          name === "voicebox_speak"
        ) {
          sawVideoCue = true;
        }
        const fp = String(p.state?.input?.filePath || "");
        if (fp.includes("scene") || fp.endsWith("index.html")) sawVideoCue = true;

        if (targetTools.has(name)) {
          counts[name]++;
          if (name === "edit" && p.state?.status === "error") counts.editErrors++;
          if (name === "capture_film_preview" && stepsBeforeFirstPreview === null) {
            stepsBeforeFirstPreview = totalToolCalls;
          }
        }
      }
    }

    if (sawVideoCue && !String(meta?.parentID || "")) {
      agg.videoSessionsCount++;
      agg.editCalls += counts.edit;
      agg.editErrors += counts.editErrors;
      agg.readCalls += counts.read;
      agg.writeCalls += counts.write;
      agg.todowriteCalls += counts.todowrite;
      agg.taskCalls += counts.task;
      agg.questionCalls += counts.question;
      agg.previewCalls += counts.capture_film_preview;

      videoSessions.push({
        id: sid,
        title: String(meta?.title || "").slice(0, 60),
        counts,
        editFailRatePct:
          counts.edit > 0 ? Number(((counts.editErrors / counts.edit) * 100).toFixed(1)) : 0,
        stepsBeforeFirstPreview,
      });
    }
  }

  return {
    status: "terverifikasi",
    storePath,
    aggregate: {
      ...agg,
      editFailRatePct:
        agg.editCalls > 0 ? Number(((agg.editErrors / agg.editCalls) * 100).toFixed(1)) : 0,
    },
    videoSessions,
  };
}

function formatMarkdownReport(data) {
  const lines = [];
  lines.push("# Baseline F0 — Ukuran Konteks Harness & Statistik Sesi");
  lines.push("");
  lines.push("> **Catatan:** Semua taksiran token di bawah memakai rumus `ceil(karakter / 4)` (**taksiran kasar**, bukan tokenizer penyedia LLM).");
  lines.push("");
  lines.push("## 1. Ukuran Statis Prompt Utama (`default.txt`) & Referensi Runtime");
  lines.push("");
  lines.push(`- **default.txt:** \`${data.defaultPrompt.chars}\` karakter (${data.defaultPrompt.lines} baris) → **~${data.defaultPrompt.roughTokens}** token (taksiran kasar)`);
  if (data.amReference) {
    lines.push(`- **AM_API.md:** \`${data.amReference.chars}\` karakter → **~${data.amReference.roughTokens}** token (taksiran kasar)`);
  }
  lines.push("");
  lines.push("## 2. Ukuran Definisi Tool (JSON) & Jumlah Tool per Peran");
  lines.push("");
  lines.push("| Peran / Profil | Jumlah Tool | Total Karakter JSON | Taksiran Token (~chars/4) | Daftar Tool |");
  lines.push("|---|---:|---:|---:|---|");
  for (const [role, info] of Object.entries(data.roles)) {
    lines.push(
      `| \`${role}\` | ${info.count} | ${info.jsonChars} | ${info.roughTokens} | \`${info.tools.join(", ")}\` |`
    );
  }
  lines.push("");
  lines.push("## 3. Injeksi Skill Motion (`mg-*`)");
  lines.push("");
  if (data.skills.chosen) {
    const c = data.skills.chosen;
    lines.push(
      `- **Skill contoh (\`${c.name}\`):** SKILL.md=${c.skillMdChars} chr, style.md=${c.styleMdChars} chr, tokens.json=${c.tokensJsonChars} chr, REMOTION_BRIEF.md=${c.remotionBriefChars} chr, examples=${c.examplesInjectedChars} chr → Total **${c.totalInjectedChars}** chr (**~${c.roughTokens}** token, taksiran kasar)`
    );
  }
  lines.push("");
  lines.push("| Skill | SKILL/style (chr) | tokens.json (chr) | REMOTION_BRIEF (chr) | examples (chr) | Total (chr) | ~Token |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const s of data.skills.allSkills) {
    const doc = s.styleMdChars > 0 ? `${s.styleMdChars} (style)` : `${s.skillMdChars}`;
    lines.push(
      `| \`${s.name}\` | ${doc} | ${s.tokensJsonChars} | ${s.remotionBriefChars} | ${s.examplesInjectedChars} | ${s.totalInjectedChars} | ${s.roughTokens} |`
    );
  }
  lines.push("");
  lines.push("## 4. Konteks Dinamis pada Workspace Contoh");
  lines.push("");
  if (!data.dynamicContext.exists) {
    lines.push(`- Workspace \`${data.dynamicContext.workspace}\` tidak ditemukan (tidak terverifikasi).`);
  } else {
    const d = data.dynamicContext;
    lines.push(`- Workspace: \`${d.workspace}\``);
    lines.push(`- Living memory: raw \`${d.rawLivingMemoryChars}\` chr → F6 capped \`${d.livingMemoryChars}\` chr (~${d.livingMemoryTokensRough} token)`);
    lines.push(`- Knowledge base (${d.knowledgeNotes} catatan aktif): raw \`${d.rawKnowledgeChars}\` chr → F6 capped \`${d.knowledgeChars}\` chr (~${d.knowledgeTokensRough} token)`);
    lines.push(`- Katalog skills (${d.skillsCatalogCount} skill): raw \`${d.rawSkillsCatalogChars}\` chr → F6 compact \`${d.skillsCatalogChars}\` chr (~${d.skillsCatalogTokensRough} token)`);
    lines.push(`- Plugin rules: raw \`${d.rawPluginRulesChars}\` chr → F6 capped \`${d.pluginRulesChars}\` chr (~${d.pluginRulesTokensRough} token)`);
    lines.push(`- **Total blok dinamis (F0 raw):** **${d.rawDynamicChars}** chr (~${d.rawDynamicTokensRough} token)`);
    lines.push(`- **Total blok dinamis (F6 compact video unstyled):** **${d.totalDynamicChars}** chr (**~${d.totalDynamicTokensRough}** token, taksiran kasar)`);
    lines.push(`- **Total per mode relevan:** explicit \`/mg-soft-clay-story\`=\`${d.explicitSkillTurnChars}\` chr (~${roughTokens(d.explicitSkillTurnChars)} tok), non-video=\`${d.nonVideoTurnChars}\` chr (~${roughTokens(d.nonVideoTurnChars)} tok), greeting=\`${d.greetingTurnChars}\` chr`);
  }
  lines.push("");
  lines.push("## 5. Statistik Sesi Video (`sessions-store.json`)");
  lines.push("");
  if (data.sessions.status !== "terverifikasi") {
    lines.push(`- Status: **${data.sessions.status}** (${data.sessions.reason})`);
  } else {
    const a = data.sessions.aggregate;
    lines.push(
      `- Total sesi: **${a.totalSessions}** (${a.videoSessionsCount} sesi video root)`
    );
    lines.push(
      `- Agregat sesi video: \`read=${a.readCalls}\`, \`edit=${a.editCalls}\` (gagal=${a.editErrors}, **${a.editFailRatePct}%**), \`write=${a.writeCalls}\`, \`todowrite=${a.todowriteCalls}\`, \`task=${a.taskCalls}\`, \`question=${a.questionCalls}\`, \`capture_film_preview=${a.previewCalls}\``
    );
    lines.push("");
    lines.push("| Session ID | Judul | read | edit (gagal / %) | write | todowrite | task | question | preview | Step -> Preview #1 |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const s of data.sessions.videoSessions) {
      lines.push(
        `| \`${s.id}\` | ${s.title.replace(/\|/g, "/")} | ${s.counts.read} | ${s.counts.edit} (${s.counts.editErrors} / ${s.editFailRatePct}%) | ${s.counts.write} | ${s.counts.todowrite} | ${s.counts.task} | ${s.counts.question} | ${s.counts.capture_film_preview} | ${s.stepsBeforeFirstPreview ?? "-"} |`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const defaultTxtPath = path.join(
    REPO_ROOT,
    "core",
    "aetheria-engine",
    "src",
    "session",
    "prompt",
    "default.txt"
  );
  const defaultTxt = fs.readFileSync(defaultTxtPath, "utf8");
  const amRefPath = path.join(REPO_ROOT, ".aetheria", "reference", "AM_API.md");
  const amRefTxt = fs.existsSync(amRefPath) ? fs.readFileSync(amRefPath, "utf8") : null;

  const allTools = parseCatalogTools();
  const roles = measureRoles(allTools);
  const skills = measureSkillInjection(opts.skill);
  const dynamicContext = measureDynamicContext(opts.workspace);
  const sessions = measureSessionsStore();

  const reportData = {
    defaultPrompt: {
      path: "core/aetheria-engine/src/session/prompt/default.txt",
      chars: defaultTxt.length,
      lines: defaultTxt.split(/\r?\n/).length,
      roughTokens: roughTokens(defaultTxt.length),
    },
    amReference: amRefTxt
      ? {
          path: ".aetheria/reference/AM_API.md",
          chars: amRefTxt.length,
          roughTokens: roughTokens(amRefTxt.length),
        }
      : null,
    catalogToolCount: allTools.length,
    roles,
    skills,
    dynamicContext,
    sessions,
  };

  const md = formatMarkdownReport(reportData);
  const jsonStr = JSON.stringify(reportData, null, 2) + "\n";

  if (opts.outJson) {
    fs.mkdirSync(path.dirname(opts.outJson), { recursive: true });
    fs.writeFileSync(opts.outJson, jsonStr, "utf8");
  }
  if (opts.outMd) {
    fs.mkdirSync(path.dirname(opts.outMd), { recursive: true });
    fs.writeFileSync(opts.outMd, md, "utf8");
  }

  process.stdout.write(md);
}

main();
