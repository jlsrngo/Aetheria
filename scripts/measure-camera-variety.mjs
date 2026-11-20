#!/usr/bin/env node
/**
 * C4 Camera Variety & Style Consistency Measurement (`scripts/measure-camera-variety.mjs`).
 *
 * Measures across pilot skills (`mg-cobalt-editorial`, `mg-3d-spatial`):
 * 1. Motion variety across 6 distinct seeds x 4 timestamps (unique hashes, mean pixel diff, unique rigs).
 * 2. Style consistency: intra-skill color histogram similarity across seeds vs cross-skill control.
 * 3. Framing guard: % of samples inside safe zone, separated by `measured`/`clamped` vs `unmeasured`.
 * 4. Anti-repeat: `repeatOfPrevious` count across a 10-shot auto-directed sequence (`cameraStyle: "editorial"`).
 * 5. Microstock (`?microstock=1`) check: 0 runtime errors with active camera.
 * 6. Contact sheets (`6 seeds x 4 timestamps`) saved to a temp directory for human review.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { renderCameraVariants, startPatchedStoryServer } from "./render-camera-variants.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function l1ColorHistSim(hA, hB) {
  let inter = 0;
  for (let i = 0; i < hA.length; i++) inter += Math.min(hA[i], hB[i]);
  return inter;
}

function summarizePilot(name, res) {
  const { report, rawVariants } = res;
  const timesCount = report.localTimes.length;
  const timesWith5PlusUnique = report.crossVariant.filter((c) => c.uniqueHashes >= 5).length;
  const meanInterSeedPixelDiff =
    Math.round(
      (report.crossVariant.reduce((s, c) => s + c.meanInterVariantPixelDiff, 0) / Math.max(1, timesCount)) * 1000,
    ) / 1000;
  const meanIntraSkillColorHistSim =
    Math.round(
      (report.crossVariant.reduce((s, c) => s + c.meanInterVariantColorHistSim, 0) / Math.max(1, timesCount)) * 10000,
    ) / 10000;

  const uniqueRigs = new Set();
  let measuredTotal = 0;
  let measuredInSafe = 0;
  let unmeasuredTotal = 0;
  let clampedTotal = 0;
  let runtimeErrors = 0;

  for (const v of report.variants) {
    runtimeErrors += v.runtimeErrors.length;
    for (const f of v.frames) {
      const cr = f.cameraReport;
      if (cr) {
        uniqueRigs.add(`${cr.move}:${cr.dir}:${cr.intensity}:${cr.seed}`);
        if (cr.guard === "measured" || cr.guard === "clamped") {
          measuredTotal++;
          if (cr.guard === "clamped") clampedTotal++;
          if (f.shotReport && f.shotReport.focusBboxInSafeZone === true) {
            measuredInSafe++;
          }
        } else {
          unmeasuredTotal++;
        }
      }
    }
  }

  return {
    pilot: name,
    skillName: report.skillName,
    shotId: report.shotId,
    contactSheetPath: report.contactSheetPath,
    seedCount: report.variants.length,
    uniqueRigCount: uniqueRigs.size,
    timesWithAtLeast5UniqueHashes: `${timesWith5PlusUnique}/${timesCount}`,
    uniqueHashesPerTime: report.crossVariant.map((c) => ({ t: c.localTime, unique: c.uniqueHashes })),
    meanInterSeedPixelDiff,
    meanIntraSkillColorHistSim,
    framing: {
      measuredSamples: measuredTotal,
      clampedSamples: clampedTotal,
      measuredInSafeZone: measuredInSafe,
      measuredInSafeZonePct: measuredTotal ? Math.round((measuredInSafe / measuredTotal) * 1000) / 10 : null,
      unmeasuredSamples: unmeasuredTotal,
    },
    runtimeErrors,
    _rawHists: rawVariants.flatMap((rv) => rv.frames.map((f) => f.hist)),
  };
}

async function measureAutoRepeat10Shots(browser) {
  const skillDir = path.join(REPO_ROOT, ".aetheria", "skills", "mg-cobalt-editorial", "examples");
  const baseStory = JSON.parse(fs.readFileSync(path.join(skillDir, "story.example.json"), "utf8"));
  const patched = JSON.parse(JSON.stringify(baseStory));
  patched.seed = 777;
  patched.cameraStyle = "editorial";
  for (const sh of patched.shots) {
    delete sh.cameraPreset;
    delete sh.camera;
  }

  const { server, baseUrl } = await startPatchedStoryServer(skillDir, () => patched);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  try {
    await page.goto(`${baseUrl}/story.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });
    const midpoints = patched.shots.map((s) => s.start + s.duration * 0.5);
    const camRep = await page.evaluate((mids) => {
      for (const m of mids) window.renderAt(m);
      return JSON.parse(JSON.stringify(window.__cameraReport || {}));
    }, midpoints);
    const entries = patched.shots.map((s) => ({ id: s.id, ...(camRep[s.id] || {}) }));
    const repeatCount = entries.filter((e) => e.repeatOfPrevious === true).length;
    return { shotCount: entries.length, repeatOfPreviousCount: repeatCount, runtimeErrors, sequence: entries.map((e) => `${e.id}:${e.move}(${e.dir})`) };
  } finally {
    await context.close();
    await new Promise((r) => server.close(r));
  }
}

async function checkMicrostockActiveCamera(browser, skillName, shotId) {
  const skillDir = path.join(REPO_ROOT, ".aetheria", "skills", skillName, "examples");
  const baseStory = JSON.parse(fs.readFileSync(path.join(skillDir, "story.example.json"), "utf8"));
  const patched = JSON.parse(JSON.stringify(baseStory));
  patched.seed = 303;
  patched.cameraStyle = "editorial";
  for (const sh of patched.shots) {
    delete sh.cameraPreset;
    delete sh.camera;
  }
  const sh = patched.shots.find((s) => s.id === shotId) || patched.shots[0];
  const mid = (sh.start || 0) + (sh.duration || 3) * 0.5;
  const { server, baseUrl } = await startPatchedStoryServer(skillDir, () => patched);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  try {
    await page.goto(`${baseUrl}/story.html?microstock=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });
    const res = await page.evaluate((t) => {
      window.renderAt(t);
      return {
        cameraReportKeys: Object.keys(window.__cameraReport || {}).length,
        microDetected: window.StoryCore ? window.StoryCore.isMicrostock() : null,
      };
    }, mid);
    return { skillName, runtimeErrors: runtimeErrors.length, ...res };
  } finally {
    await context.close();
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  const args = process.argv.slice(2);
  let outRoot = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out-dir" && args[i + 1]) outRoot = path.resolve(args[++i]);
  }
  if (!outRoot) outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-cam-variety-"));
  fs.mkdirSync(outRoot, { recursive: true });

  const seeds = [101, 202, 303, 404, 505, 606];
  const makeSeedVariants = (clearLegacy = false) =>
    seeds.map((sd, idx) => ({
      name: `S${idx + 1}_seed${sd}`,
      patchStory: (story, shot) => {
        story.seed = sd;
        story.cameraStyle = "editorial";
        if (clearLegacy) {
          delete shot.cameraPreset;
          delete shot.camera;
        } else {
          delete shot.camera;
        }
      },
    }));

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });

  try {
    const cobaltRes = await renderCameraVariants({
      skillName: "mg-cobalt-editorial",
      shotId: "s2-icons",
      localTimes: [0.45, 1.05, 1.8, 2.55],
      variants: makeSeedVariants(true),
      outDir: path.join(outRoot, "cobalt_6seeds"),
      sharedBrowser: browser,
    });

    const spatialDropRes = await renderCameraVariants({
      skillName: "mg-3d-spatial",
      shotId: "shot_1_drop",
      localTimes: [2.0, 3.5, 5.0, 6.5],
      variants: makeSeedVariants(false),
      outDir: path.join(outRoot, "spatial_drop_6seeds"),
      sharedBrowser: browser,
    });

    const spatialFinaleRes = await renderCameraVariants({
      skillName: "mg-3d-spatial",
      shotId: "shot_4_finale",
      localTimes: [1.5, 3.0, 4.5, 6.0],
      variants: makeSeedVariants(false),
      outDir: path.join(outRoot, "spatial_finale_6seeds"),
      sharedBrowser: browser,
    });

    const pCobalt = summarizePilot("cobalt_s2-icons", cobaltRes);
    const pSpatialDrop = summarizePilot("spatial_shot_1_drop", spatialDropRes);
    const pSpatialFinale = summarizePilot("spatial_shot_4_finale", spatialFinaleRes);

    // Cross-skill color histogram similarity control (cobalt vs 3d-spatial)
    let crossSum = 0;
    let crossN = 0;
    for (const hA of pCobalt._rawHists) {
      for (const hB of pSpatialDrop._rawHists) {
        crossSum += l1ColorHistSim(hA, hB);
        crossN++;
      }
    }
    const crossSkillColorHistSim = crossN ? Math.round((crossSum / crossN) * 10000) / 10000 : 0;

    delete pCobalt._rawHists;
    delete pSpatialDrop._rawHists;
    delete pSpatialFinale._rawHists;

    const autoRepeat10 = await measureAutoRepeat10Shots(browser);
    const microCobalt = await checkMicrostockActiveCamera(browser, "mg-cobalt-editorial", "s2-icons");
    const microSpatial = await checkMicrostockActiveCamera(browser, "mg-3d-spatial", "shot_1_drop");

    const summary = {
      outDir: outRoot,
      seeds,
      pilots: [pCobalt, pSpatialDrop, pSpatialFinale],
      styleConsistencyControl: {
        cobaltIntraSkillHistSim: pCobalt.meanIntraSkillColorHistSim,
        spatialDropIntraSkillHistSim: pSpatialDrop.meanIntraSkillColorHistSim,
        spatialFinaleIntraSkillHistSim: pSpatialFinale.meanIntraSkillColorHistSim,
        crossSkillControlHistSim: crossSkillColorHistSim,
        cobaltMarginOverControl: Math.round((pCobalt.meanIntraSkillColorHistSim - crossSkillColorHistSim) * 10000) / 10000,
        spatialMarginOverControl: Math.round((pSpatialDrop.meanIntraSkillColorHistSim - crossSkillColorHistSim) * 10000) / 10000,
      },
      autoRepeat10Shots: autoRepeat10,
      microstockChecks: [microCobalt, microSpatial],
    };

    const reportPath = path.join(outRoot, "variety_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ reportPath, ...summary }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[measure-camera-variety] FAILED:", err);
  process.exit(1);
});
