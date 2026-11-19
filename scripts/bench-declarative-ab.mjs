#!/usr/bin/env node
/**
 * K5 Real A/B Flash Benchmark for Declarative `story.json` vs Legacy Mode.
 *
 * Conditions (N=3 trials each in isolated `os.tmpdir()` workspaces):
 * - A: `mg-soft-clay-story` legacy (`AETHERIA_CLAY_STORY_MODE=legacy`)
 * - B: `mg-soft-clay-story` declarative `storyMode`
 * - C: 2 generic declarative skills (`mg-aurora-glass`, `mg-flat-vector`)
 *
 * Requires real provider credentials (`AETHERIA_TEST_PROVIDER`, `AETHERIA_TEST_MODEL`)
 * and a healthy live engine (`AETHERIA_API` / `AETHERIA_HEALTH`). Never simulates model
 * responses; exits with status `"Terblokir"` when credentials/engine are absent.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API_BASE = process.env.AETHERIA_API || "http://127.0.0.1:4196";
const HEALTH_URL = process.env.AETHERIA_HEALTH || `${API_BASE}/api/health`;
const PROVIDER = (process.env.AETHERIA_TEST_PROVIDER || "").trim();
const MODEL = (process.env.AETHERIA_TEST_MODEL || "").trim();
const TRIALS = Math.max(1, Number(process.env.AETHERIA_AB_TRIALS || 3));

const CONDITIONS = [
  {
    id: "A_clay_legacy",
    skill: "mg-soft-clay-story",
    mode: "legacy",
    prompt: "/mg-soft-clay-story Buat video pendek 12 detik tentang petani menanam bunga di ladang.",
  },
  {
    id: "B_clay_story_mode",
    skill: "mg-soft-clay-story",
    mode: "storyMode",
    prompt: "/mg-soft-clay-story Buat video pendek 12 detik tentang petani menanam bunga di ladang.",
  },
  {
    id: "C_generic_aurora",
    skill: "mg-aurora-glass",
    mode: "storyMode",
    prompt: "/mg-aurora-glass Buat video pendek 12 detik tentang asisten AI fokus suara.",
  },
  {
    id: "C_generic_flat_vector",
    skill: "mg-flat-vector",
    mode: "storyMode",
    prompt: "/mg-flat-vector Buat video pendek 12 detik tentang aplikasi chat modern.",
  },
];

function readBasicAuthHeader() {
  const credPath = path.join(os.homedir(), ".aetheria", "dev-server-password");
  if (!fs.existsSync(credPath)) return {};
  const raw = fs.readFileSync(credPath, "utf8").trim();
  if (!raw.includes(":")) return {};
  return { Authorization: "Basic " + Buffer.from(raw).toString("base64") };
}

async function checkPrereqs() {
  if (!PROVIDER || !MODEL) {
    return {
      ok: false,
      reason:
        "Missing AETHERIA_TEST_PROVIDER and/or AETHERIA_TEST_MODEL environment variables (real provider credentials required; never simulated).",
    };
  }
  try {
    const res = await fetch(HEALTH_URL, { headers: readBasicAuthHeader() });
    if (!res.ok) {
      return { ok: false, reason: `Engine health check returned HTTP ${res.status} at ${HEALTH_URL}.` };
    }
    const body = await res.json();
    if (!body || body.healthy !== true) {
      return { ok: false, reason: `Engine at ${HEALTH_URL} did not report healthy: true.` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `Engine unreachable at ${HEALTH_URL}: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

async function runTrial(cond, trialIdx, headers) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-ab-${cond.id}-t${trialIdx}-`));
  const t0 = Date.now();
  try {
    const createRes = await fetch(`${API_BASE}/api/session`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        directory: workDir,
        title: `AB ${cond.id} #${trialIdx}`,
      }),
    });
    if (!createRes.ok) {
      return { condition: cond.id, trial: trialIdx, ok: false, error: `create session HTTP ${createRes.status}`, elapsedMs: Date.now() - t0 };
    }
    const session = await createRes.json();
    const sid = session?.data?.id || session?.id;
    const msgRes = await fetch(`${API_BASE}/api/session/${sid}/message`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: PROVIDER,
        modelID: MODEL,
        parts: [{ type: "text", text: cond.prompt }],
      }),
    });
    const ok = msgRes.ok;
    const hasStoryJson = fs.existsSync(path.join(workDir, "story.json"));
    return {
      condition: cond.id,
      trial: trialIdx,
      ok,
      hasStoryJson,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const pre = await checkPrereqs();
  if (!pre.ok) {
    console.log(
      JSON.stringify(
        {
          status: "Terblokir",
          reason: pre.reason,
          provider: PROVIDER || null,
          model: MODEL || null,
          trialsConfigured: TRIALS,
          conditions: CONDITIONS.map((c) => c.id),
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const headers = readBasicAuthHeader();
  const results = [];
  for (const cond of CONDITIONS) {
    for (let t = 1; t <= TRIALS; t++) {
      results.push(await runTrial(cond, t, headers));
    }
  }
  const outPath = path.join(os.tmpdir(), "aetheria-k5-ab-report.json");
  const report = { status: "Selesai", provider: PROVIDER, model: MODEL, trials: TRIALS, results };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outPath, ...report }, null, 2));
}

main().catch((err) => {
  console.error("[bench-declarative-ab] FAILED:", err);
  process.exit(1);
});
