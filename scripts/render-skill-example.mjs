#!/usr/bin/env node
/**
 * S0 Skill Example Renderer & Framing Baseline Tool (`scripts/render-skill-example.mjs`).
 *
 * Serves a skill `examples/` directory alongside offline `/script/three.min.js` and
 * `/script/aetheria-motion.js` via a temporary localhost HTTP server, renders N timestamps
 * to PNG in a temp/output directory via headless Playwright Chromium, measures 3D hero
 * projected bounding box vs portrait safe zone + lower-third emptiness + per-frame timing +
 * SHA-256 determinism hash, and writes `report.json` (+ optional `contact_sheet.png`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const BUILTIN_SCRIPT_MAP = {
  "/script/three.min.js": path.join(
    REPO_ROOT,
    "core",
    "aetheria-engine",
    "assets",
    "script",
    "three.min.js",
  ),
  "/script/aetheria-motion.js": path.join(
    REPO_ROOT,
    "apps",
    "public",
    "script",
    "aetheria-motion.js",
  ),
  "/script/story-core.js": path.join(
    REPO_ROOT,
    "apps",
    "public",
    "script",
    "story-core.js",
  ),
  "/script/story-camera.js": path.join(
    REPO_ROOT,
    "apps",
    "public",
    "script",
    "story-camera.js",
  ),
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};

function parseArgs(argv) {
  const opts = {
    all: false,
    microstock: false,
    dir: path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples"),
    html: "index.html",
    outDir: "",
    times: null,
    contactSheet: true,
    extraScriptRoots: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") opts.all = true;
    else if (a === "--microstock") opts.microstock = true;
    else if (a === "--dir" && argv[i + 1]) opts.dir = path.resolve(argv[++i]);
    else if (a === "--html" && argv[i + 1]) opts.html = argv[++i];
    else if (a === "--out-dir" && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === "--times" && argv[i + 1]) {
      const raw = argv[++i];
      if (raw === "auto") {
        opts.times = null;
      } else {
        opts.times = raw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n >= 0);
      }
    } else if (a === "--extra-script-dir" && argv[i + 1]) {
      opts.extraScriptRoots.push(path.resolve(argv[++i]));
    } else if (a === "--no-contact-sheet") {
      opts.contactSheet = false;
    }
  }
  if (!opts.all && !opts.times) {
    opts.times = [0.3, 1.5, 3.0, 4.5, 6.0, 7.5];
  }
  if (!opts.outDir) {
    opts.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-skill-render-"));
  } else {
    fs.mkdirSync(opts.outDir, { recursive: true });
  }
  return opts;
}

/**
 * Derives 1 midpoint timestamp per shot from `story.example.json` (or `story.json`),
 * supporting BOTH Dialect A (`start` + `duration`) and Dialect B (`startSec` + `endSec`).
 */
export function deriveShotMidpointsFromStory(examplesDir) {
  const candidates = [
    path.join(examplesDir, "story.example.json"),
    path.join(examplesDir, "story.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      const shots = Array.isArray(data.shots) ? data.shots : [];
      const mids = [];
      for (const sh of shots) {
        if (!sh || typeof sh !== "object") continue;
        let st = Number(sh.start);
        let du = Number(sh.duration);
        if (!Number.isFinite(st) || !Number.isFinite(du) || du <= 0) {
          const sSec = Number(sh.startSec);
          const eSec = Number(sh.endSec);
          if (Number.isFinite(sSec) && Number.isFinite(eSec) && eSec > sSec) {
            st = sSec;
            du = eSec - sSec;
          }
        }
        if (Number.isFinite(st) && Number.isFinite(du) && du > 0) {
          mids.push(Math.round((st + du * 0.5) * 1000) / 1000);
        }
      }
      if (mids.length > 0) return mids;
    } catch {
      // fall through
    }
  }
  return [0.5, 2.0, 3.5, 5.0];
}

export function discoverBuiltinSkillExamples() {
  const skillsRoot = path.join(REPO_ROOT, ".aetheria", "skills");
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("mg-"))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const dir = path.join(skillsRoot, name, "examples");
      const html = fs.existsSync(path.join(dir, "story.html")) ? "story.html" : "index.html";
      return { name, dir, html };
    })
    .filter((s) => fs.existsSync(path.join(s.dir, "story.example.json")));
}

function safeResolveUnder(rootDir, relUrlPath) {
  const clean = decodeURIComponent(relUrlPath.split("?")[0]).replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, clean);
  const normRoot = path.resolve(rootDir);
  if (resolved !== normRoot && !resolved.startsWith(normRoot + path.sep)) {
    return null;
  }
  return resolved;
}

function startStaticServer(rootDir, extraScriptRoots = []) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      if (BUILTIN_SCRIPT_MAP[urlPath] && fs.existsSync(BUILTIN_SCRIPT_MAP[urlPath])) {
        const buf = fs.readFileSync(BUILTIN_SCRIPT_MAP[urlPath]);
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(buf);
        return;
      }
      let target = safeResolveUnder(rootDir, urlPath === "/" ? "index.html" : urlPath);
      if ((!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) && urlPath.startsWith("/script/")) {
        const fname = path.basename(urlPath);
        for (const extra of extraScriptRoots) {
          const cand = path.resolve(extra, fname);
          if (cand.startsWith(path.resolve(extra) + path.sep) && fs.existsSync(cand)) {
            target = cand;
            break;
          }
        }
      }
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      fs.createReadStream(target).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

/**
 * Portrait 9:16 safe zone derived from `.aetheria/skills/mg-soft-clay-story/SKILL.md`:
 * - Zone 0..3 visual subject area: Y in [60, 1440] (Zone 4 subtitles start at Y=1440, deadzone Y>1750)
 * - Horizontal margin: X in [48, 960] (TikTok right UI rail deadzone X>960)
 */
export function computeSafeZone(width, height) {
  if (height > width) {
    return {
      minX: Math.round(width * 0.045),
      maxX: Math.round(width * (960 / 1080)),
      minY: Math.round(height * (60 / 1920)),
      maxY: Math.round(height * (1440 / 1920)),
    };
  }
  return {
    minX: Math.round(width * 0.05),
    maxX: Math.round(width * 0.95),
    minY: Math.round(height * 0.06),
    maxY: Math.round(height * 0.88),
  };
}

function classifyBbox(bbox, width, height, safeZone) {
  if (!bbox) {
    return { inViewport: false, inSafeZone: false, clippedEdges: ["missing_hero"] };
  }
  const clippedViewport = [];
  if (bbox.minX < 0) clippedViewport.push("left");
  if (bbox.maxX > width) clippedViewport.push("right");
  if (bbox.minY < 0) clippedViewport.push("top");
  if (bbox.maxY > height) clippedViewport.push("bottom");

  const clippedSafe = [];
  if (bbox.minX < safeZone.minX) clippedSafe.push("safe_left");
  if (bbox.maxX > safeZone.maxX) clippedSafe.push("safe_right");
  if (bbox.minY < safeZone.minY) clippedSafe.push("safe_top");
  if (bbox.maxY > safeZone.maxY) clippedSafe.push("safe_bottom");

  return {
    inViewport: clippedViewport.length === 0,
    inSafeZone: clippedSafe.length === 0,
    clippedViewportEdges: clippedViewport,
    clippedSafeEdges: clippedSafe,
  };
}

export async function renderSkillExample(opts, sharedBrowser = null) {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const { server, baseUrl } = await startStaticServer(opts.dir, opts.extraScriptRoots || []);
  const runtimeErrors = [];
  const http404s = [];
  let browser = sharedBrowser;
  const ownsBrowser = !sharedBrowser;
  let context = null;
  try {
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-webgl",
          "--ignore-gpu-blocklist",
          "--no-sandbox",
        ],
      });
    }
    context = await browser.newContext({
      viewport: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Non-invasive hook: capture the world returned by ClayKit.initStage (or StoryRuntime)
    // without editing the skill's index.html or clay-kit.js.
    await page.addInitScript(() => {
      let internalClayKit;
      Object.defineProperty(window, "ClayKit", {
        configurable: true,
        enumerable: true,
        get() {
          return internalClayKit;
        },
        set(val) {
          if (val && typeof val.initStage === "function" && !val.__wrappedForInspector) {
            const origInit = val.initStage;
            val.initStage = function (...args) {
              const world = origInit.apply(this, args);
              window.__clayStageWorld = world;
              return world;
            };
            val.__wrappedForInspector = true;
          }
          internalClayKit = val;
        },
      });
    });

    page.on("response", (res) => {
      if (res.status() === 404) http404s.push(res.url());
    });
    page.on("pageerror", (err) => runtimeErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Browser logs network 404s (e.g. optional /audio/*.words.json) separately in `http404s`.
        if (/status of 404/i.test(text)) return;
        runtimeErrors.push(`console.error: ${text}`);
      }
    });

    const qs = opts.microstock ? "?microstock=1" : "";
    const targetUrl = `${baseUrl}/${opts.html.replace(/^\/+/, "")}${qs}`;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });

    const meta = await page.evaluate(() => {
      const m = window.__filmMeta || {};
      return {
        title: m.title || "Untitled",
        width: Number(m.width) || 1080,
        height: Number(m.height) || 1920,
        fps: Number(m.fps) || 30,
        duration: Number(m.duration) || 8.0,
      };
    });

    if (meta.width !== 1080 || meta.height !== 1920) {
      await page.setViewportSize({ width: meta.width, height: meta.height });
    }
    const safeZone = computeSafeZone(meta.width, meta.height);
    const frames = [];

    for (let i = 0; i < opts.times.length; i++) {
      const t = opts.times[i];
      const t0 = performance.now();
      const metrics = await page.evaluate((ts) => {
        if (typeof window.renderAt === "function") {
          window.renderAt(ts);
        }
        const W = Number((window.__filmMeta && window.__filmMeta.width) || 1080);
        const H = Number((window.__filmMeta && window.__filmMeta.height) || 1920);
        const world = window.__clayStageWorld || window.__storyWorld || null;

        let heroBbox = null;
        let bboxMeasured = false;
        let reportedSafeZone = null;
        if (world && world.camera && typeof THREE !== "undefined") {
          const targetObj =
            (world.getActiveFocusObject && world.getActiveFocusObject()) ||
            (world.hero && world.hero.root) ||
            null;
          if (targetObj) {
            targetObj.updateWorldMatrix(true, true);
            world.camera.updateMatrixWorld(true);
            world.camera.updateProjectionMatrix();
            const box = new THREE.Box3().setFromObject(targetObj);
            if (!box.isEmpty()) {
              const xs = [box.min.x, box.max.x];
              const ys = [box.min.y, box.max.y];
              const zs = [box.min.z, box.max.z];
              let minX = Infinity;
              let maxX = -Infinity;
              let minY = Infinity;
              let maxY = -Infinity;
              const v = new THREE.Vector3();
              for (const x of xs) {
                for (const y of ys) {
                  for (const z of zs) {
                    v.set(x, y, z).project(world.camera);
                    const sx = (v.x * 0.5 + 0.5) * W;
                    const sy = (-v.y * 0.5 + 0.5) * H;
                    if (sx < minX) minX = sx;
                    if (sx > maxX) maxX = sx;
                    if (sy < minY) minY = sy;
                    if (sy > maxY) maxY = sy;
                  }
                }
              }
              heroBbox = {
                minX: Math.round(minX * 10) / 10,
                minY: Math.round(minY * 10) / 10,
                maxX: Math.round(maxX * 10) / 10,
                maxY: Math.round(maxY * 10) / 10,
                width: Math.round((maxX - minX) * 10) / 10,
                height: Math.round((maxY - minY) * 10) / 10,
              };
              bboxMeasured = true;
            }
          }
        } else if (window.__shotReport) {
          const vals = Object.values(window.__shotReport);
          const match = vals.find((r) => r && Math.abs(Number(r.t) - ts) < 0.01) || vals[vals.length - 1];
          if (match && match.bbox) {
            heroBbox = match.bbox;
            reportedSafeZone = match.safeZone || null;
            if (typeof match.bboxMeasured === "boolean") {
              bboxMeasured = match.bboxMeasured;
            } else if (reportedSafeZone) {
              const sameAsSafe =
                Math.abs(Number(heroBbox.minX) - Number(reportedSafeZone.minX)) <= 1 &&
                Math.abs(Number(heroBbox.maxX) - Number(reportedSafeZone.maxX)) <= 1 &&
                Math.abs(Number(heroBbox.minY) - Number(reportedSafeZone.minY)) <= 1 &&
                Math.abs(Number(heroBbox.maxY) - Number(reportedSafeZone.maxY)) <= 1;
              bboxMeasured = !sameAsSafe;
            } else {
              bboxMeasured = true;
            }
          }
        }

        // Measure lower-third emptiness on the WebGL canvas (fraction of pixels with near-flat gradient/sidewalk color)
        let lowerThirdEmptyFraction = null;
        const glCanvas = document.getElementById("stage-webgl");
        if (glCanvas) {
          const sample = document.createElement("canvas");
          const sw = 180;
          const sh = Math.round((H / W) * sw);
          sample.width = sw;
          sample.height = sh;
          const sctx = sample.getContext("2d");
          sctx.drawImage(glCanvas, 0, 0, sw, sh);
          const yStart = Math.floor(sh * (2 / 3));
          const img = sctx.getImageData(0, yStart, sw, sh - yStart).data;
          const totalPx = sw * (sh - yStart);
          // Compare each pixel against bottom-center reference sidewalk/sky pixel
          const refIdx = ((sh - yStart - 2) * sw + Math.floor(sw / 2)) * 4;
          const rr = img[refIdx];
          const rg = img[refIdx + 1];
          const rb = img[refIdx + 2];
          const ra = img[refIdx + 3];
          let emptyPx = 0;
          for (let p = 0; p < img.length; p += 4) {
            const a = img[p + 3];
            if (a < 20) {
              emptyPx++;
              continue;
            }
            const dist =
              Math.abs(img[p] - rr) +
              Math.abs(img[p + 1] - rg) +
              Math.abs(img[p + 2] - rb) +
              Math.abs(a - ra);
            if (dist < 28) emptyPx++;
          }
          lowerThirdEmptyFraction = Math.round((emptyPx / Math.max(1, totalPx)) * 1000) / 1000;
        }

        const shotReport = window.__shotReport ? JSON.parse(JSON.stringify(window.__shotReport)) : null;
        const cameraReport = window.__cameraReport ? JSON.parse(JSON.stringify(window.__cameraReport)) : null;
        return { heroBbox, bboxMeasured, reportedSafeZone, lowerThirdEmptyFraction, shotReport, cameraReport };
      }, t);

      const pngName = `frame_${String(i).padStart(2, "0")}_t${t.toFixed(2).replace(".", "_")}.png`;
      const pngPath = path.join(opts.outDir, pngName);
      const pngBuf = await page.screenshot({ type: "png" });
      fs.writeFileSync(pngPath, pngBuf);
      const renderMs = Math.round((performance.now() - t0) * 10) / 10;
      const sha256 = crypto.createHash("sha256").update(pngBuf).digest("hex");
      const sameAsRendererSafe =
        metrics.heroBbox &&
        Math.abs(Number(metrics.heroBbox.minX) - safeZone.minX) <= 1 &&
        Math.abs(Number(metrics.heroBbox.maxX) - safeZone.maxX) <= 1 &&
        Math.abs(Number(metrics.heroBbox.minY) - safeZone.minY) <= 1 &&
        Math.abs(Number(metrics.heroBbox.maxY) - safeZone.maxY) <= 1;
      const bboxMeasured = Boolean(metrics.bboxMeasured && !sameAsRendererSafe);
      const boxStatus = classifyBbox(metrics.heroBbox, meta.width, meta.height, safeZone);

      frames.push({
        t,
        pngName,
        pngPath,
        sha256,
        renderMs,
        heroBbox: metrics.heroBbox,
        bboxMeasured,
        inViewport: bboxMeasured ? boxStatus.inViewport : null,
        inSafeZone: bboxMeasured ? boxStatus.inSafeZone : null,
        clippedViewportEdges: bboxMeasured ? boxStatus.clippedViewportEdges : [],
        clippedSafeEdges: bboxMeasured ? boxStatus.clippedSafeEdges : [],
        lowerThirdEmptyFraction: metrics.lowerThirdEmptyFraction,
        shotReport: metrics.shotReport,
        cameraReport: metrics.cameraReport,
      });
    }

    let contactSheetPath = null;
    if (opts.contactSheet && frames.length > 0) {
      contactSheetPath = path.join(opts.outDir, "contact_sheet.png");
      await buildContactSheet(browser, frames, meta, safeZone, contactSheetPath);
    }

    const measuredFrames = frames.filter((f) => f.bboxMeasured);
    const unmeasuredFrameCount = frames.length - measuredFrames.length;
    const bboxMeasured = measuredFrames.length > 0;
    const outOfSafeZoneCount = measuredFrames.filter((f) => f.inSafeZone === false).length;
    const outOfViewportCount = measuredFrames.filter((f) => f.inViewport === false).length;
    const totalRenderMs = Math.round(frames.reduce((s, f) => s + f.renderMs, 0) * 10) / 10;
    const avgRenderMs = Math.round((totalRenderMs / Math.max(1, frames.length)) * 10) / 10;
    const lowerFracs = frames
      .map((f) => f.lowerThirdEmptyFraction)
      .filter((v) => typeof v === "number");
    const meanLowerThirdEmptyFraction =
      lowerFracs.length > 0
        ? Math.round((lowerFracs.reduce((a, b) => a + b, 0) / lowerFracs.length) * 1000) / 1000
        : null;
    const lastCameraReport = frames[frames.length - 1]?.cameraReport || null;
    const cameraEntries = lastCameraReport ? Object.values(lastCameraReport) : [];
    const cameraRepeatOfPreviousCount = cameraEntries.filter((e) => e && e.repeatOfPrevious === true).length;

    const report = {
      skillDir: opts.dir,
      html: opts.html,
      outDir: opts.outDir,
      contactSheetPath,
      canvas: { width: meta.width, height: meta.height, fps: meta.fps, duration: meta.duration },
      safeZone,
      summary: {
        frameCount: frames.length,
        bboxMeasured,
        measuredFrameCount: measuredFrames.length,
        unmeasuredFrameCount,
        runtimeErrorsCount: runtimeErrors.length,
        avgRenderMs,
        totalRenderMs,
        outOfSafeZoneCount: bboxMeasured ? outOfSafeZoneCount : null,
        outOfSafeZonePct: bboxMeasured
          ? Math.round((outOfSafeZoneCount / Math.max(1, measuredFrames.length)) * 1000) / 10
          : null,
        outOfViewportCount: bboxMeasured ? outOfViewportCount : null,
        outOfViewportPct: bboxMeasured
          ? Math.round((outOfViewportCount / Math.max(1, measuredFrames.length)) * 1000) / 10
          : null,
        meanLowerThirdEmptyFraction,
        cameraReportCount: cameraEntries.length,
        cameraRepeatOfPreviousCount,
      },
      cameraReport: lastCameraReport,
      runtimeErrors,
      http404s,
      frames,
    };

    const reportPath = path.join(opts.outDir, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { report, reportPath };
  } finally {
    if (context) await context.close();
    if (ownsBrowser && browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
}

export async function renderAllSkillExamples(opts) {
  const skills = discoverBuiltinSkillExamples();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
  });
  const results = [];
  let totalErrors = 0;
  try {
    for (const sk of skills) {
      const times = opts.times && opts.times.length > 0 ? opts.times : deriveShotMidpointsFromStory(sk.dir);
      const skillOut = path.join(opts.outDir, sk.name);
      const { report, reportPath } = await renderSkillExample(
        {
          dir: sk.dir,
          html: sk.html,
          outDir: skillOut,
          times,
          contactSheet: opts.contactSheet,
          microstock: opts.microstock,
          extraScriptRoots: opts.extraScriptRoots,
        },
        browser,
      );
      totalErrors += report.summary.runtimeErrorsCount;
      results.push({
        skill: sk.name,
        html: sk.html,
        reportPath,
        frameCount: report.summary.frameCount,
        bboxMeasured: report.summary.bboxMeasured,
        measuredFrameCount: report.summary.measuredFrameCount,
        unmeasuredFrameCount: report.summary.unmeasuredFrameCount,
        outOfSafeZoneCount: report.summary.outOfSafeZoneCount,
        cameraRepeatOfPreviousCount: report.summary.cameraRepeatOfPreviousCount,
        runtimeErrorsCount: report.summary.runtimeErrorsCount,
        avgRenderMs: report.summary.avgRenderMs,
        hashes: report.frames.map((f) => ({ t: f.t, sha256: f.sha256 })),
      });
    }
  } finally {
    await browser.close();
  }
  const summaryPath = path.join(opts.outDir, "summary.json");
  const summary = {
    outDir: opts.outDir,
    microstock: Boolean(opts.microstock),
    skillCount: results.length,
    totalRuntimeErrors: totalErrors,
    skills: results,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  return { summary, summaryPath };
}

async function buildContactSheet(browser, frames, meta, safeZone, outPath) {
  const thumbW = 270;
  const thumbH = Math.round((meta.height / meta.width) * thumbW);
  const cols = Math.min(3, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const pad = 16;
  const headerH = 38;
  const sheetW = cols * thumbW + (cols + 1) * pad;
  const sheetH = rows * (thumbH + headerH) + (rows + 1) * pad;

  const items = frames.map((f) => ({
    t: f.t,
    bboxMeasured: Boolean(f.bboxMeasured),
    inSafeZone: f.inSafeZone,
    inViewport: f.inViewport,
    heroBbox: f.heroBbox,
    lowerEmpty: f.lowerThirdEmptyFraction,
    dataUrl: `data:image/png;base64,${fs.readFileSync(f.pngPath).toString("base64")}`,
  }));

  const page = await browser.newPage({ viewport: { width: sheetW, height: sheetH } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#111827"><canvas id="c" width="${sheetW}" height="${sheetH}"></canvas></body></html>`);
  await page.evaluate(
    async ({ items, meta, safeZone, thumbW, thumbH, cols, pad, headerH }) => {
      const c = document.getElementById("c");
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, c.width, c.height);
      const sx = thumbW / meta.width;
      const sy = thumbH / meta.height;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * (thumbW + pad);
        const y = pad + row * (thumbH + headerH + pad);

        ctx.fillStyle = "#1f2937";
        ctx.fillRect(x, y, thumbW, headerH);
        ctx.fillStyle = !it.bboxMeasured ? "#fbbf24" : it.inSafeZone ? "#4ade80" : "#f87171";
        ctx.font = "bold 13px monospace";
        const tag = !it.bboxMeasured ? "UNMEASURED" : it.inSafeZone ? "SAFE" : it.inViewport ? "OUT-SAFE" : "CLIPPED";
        ctx.fillText(`t=${it.t.toFixed(2)}s [${tag}] lowEmpty=${Math.round((it.lowerEmpty || 0) * 100)}%`, x + 8, y + 23);

        const img = new Image();
        await new Promise((res) => {
          img.onload = res;
          img.src = it.dataUrl;
        });
        ctx.drawImage(img, x, y + headerH, thumbW, thumbH);

        // Draw safe zone dashed box
        ctx.save();
        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(
          x + safeZone.minX * sx,
          y + headerH + safeZone.minY * sy,
          (safeZone.maxX - safeZone.minX) * sx,
          (safeZone.maxY - safeZone.minY) * sy,
        );
        ctx.restore();

        // Draw projected hero bbox
        if (it.heroBbox) {
          ctx.save();
          ctx.strokeStyle = it.inSafeZone ? "#22c55e" : "#ef4444";
          ctx.lineWidth = 2;
          ctx.strokeRect(
            x + it.heroBbox.minX * sx,
            y + headerH + it.heroBbox.minY * sy,
            it.heroBbox.width * sx,
            it.heroBbox.height * sy,
          );
          ctx.restore();
        }
      }
    },
    { items, meta, safeZone, thumbW, thumbH, cols, pad, headerH },
  );
  await page.screenshot({ path: outPath, type: "png" });
  await page.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const runner = opts.all
    ? renderAllSkillExamples(opts).then(({ summary, summaryPath }) => {
        console.log(
          JSON.stringify(
            {
              summaryPath,
              skillCount: summary.skillCount,
              totalRuntimeErrors: summary.totalRuntimeErrors,
              microstock: summary.microstock,
            },
            null,
            2,
          ),
        );
        process.exit(summary.totalRuntimeErrors > 0 ? 1 : 0);
      })
    : renderSkillExample(opts).then(({ report, reportPath }) => {
        console.log(
          JSON.stringify(
            { reportPath, contactSheetPath: report.contactSheetPath, summary: report.summary },
            null,
            2,
          ),
        );
        process.exit(report.summary.runtimeErrorsCount > 0 ? 1 : 0);
      });
  runner.catch((err) => {
    console.error("[render-skill-example] FAILED:", err);
    process.exit(1);
  });
}
