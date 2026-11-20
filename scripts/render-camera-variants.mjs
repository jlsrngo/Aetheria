#!/usr/bin/env node
/**
 * C0.4 Camera Variants Matrix Renderer (`scripts/render-camera-variants.mjs`).
 *
 * Serves one declarative skill directory via a temporary localhost HTTP server while
 * patching `story.json` / `story.example.json` IN MEMORY (never mutating repo files),
 * renders a matrix of camera variants x timestamps to PNG in a temp directory, and
 * computes quantitative pixel diffs, color histogram similarity, and contact sheet.
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

export const BUILTIN_SCRIPT_MAP = {
  "/script/three.min.js": path.join(REPO_ROOT, "core", "aetheria-engine", "assets", "script", "three.min.js"),
  "/script/aetheria-motion.js": path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
  "/script/story-core.js": path.join(REPO_ROOT, "apps", "public", "script", "story-core.js"),
  "/script/story-camera.js": path.join(REPO_ROOT, "apps", "public", "script", "story-camera.js"),
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};

function safeResolveUnder(rootDir, relUrlPath) {
  const clean = decodeURIComponent(relUrlPath.split("?")[0]).replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, clean);
  const normRoot = path.resolve(rootDir);
  if (resolved !== normRoot && !resolved.startsWith(normRoot + path.sep)) return null;
  return resolved;
}

export function startPatchedStoryServer(rootDir, getPatchedStory) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/story.json" || urlPath === "/story.example.json") {
        const storyObj = getPatchedStory();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(storyObj));
        return;
      }
      if (BUILTIN_SCRIPT_MAP[urlPath] && fs.existsSync(BUILTIN_SCRIPT_MAP[urlPath])) {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end(fs.readFileSync(BUILTIN_SCRIPT_MAP[urlPath]));
        return;
      }
      const target = safeResolveUnder(rootDir, urlPath === "/" ? "story.html" : urlPath);
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(target).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function l1ColorHistSim(hA, hB) {
  let inter = 0;
  for (let i = 0; i < hA.length; i++) inter += Math.min(hA[i], hB[i]);
  return Math.round(inter * 10000) / 10000;
}

function meanAbsPixelDiff(bufA, bufB) {
  const len = Math.min(bufA.length, bufB.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < len; i += 4) {
    sum += Math.abs(bufA[i] - bufB[i]) + Math.abs(bufA[i + 1] - bufB[i + 1]) + Math.abs(bufA[i + 2] - bufB[i + 2]);
    count += 3;
  }
  return Math.round((sum / Math.max(1, count)) * 1000) / 1000;
}

export async function renderCameraVariants({
  skillName = "mg-cobalt-editorial",
  shotId = "s2-icons",
  localTimes = [0.15, 0.6, 1.5, 2.8],
  variants,
  outDir,
  microstock = false,
  sharedBrowser = null,
}) {
  const skillDir = path.join(REPO_ROOT, ".aetheria", "skills", skillName, "examples");
  const html = fs.existsSync(path.join(skillDir, "story.html")) ? "story.html" : "index.html";
  const baseStory = JSON.parse(fs.readFileSync(path.join(skillDir, "story.example.json"), "utf8"));
  const out = outDir || fs.mkdtempSync(path.join(os.tmpdir(), `aetheria-cam-variants-${skillName}-`));
  fs.mkdirSync(out, { recursive: true });

  const shotIdx = (baseStory.shots || []).findIndex((s) => s.id === shotId);
  if (shotIdx < 0) {
    throw new Error(`Shot '${shotId}' not found in ${skillName}/examples/story.example.json`);
  }
  const baseShot = baseStory.shots[shotIdx];
  const shotStart = baseShot.start !== undefined ? Number(baseShot.start) : Number(baseShot.startSec || 0);
  const shotDur =
    baseShot.duration !== undefined
      ? Number(baseShot.duration)
      : Math.max(0.1, Number(baseShot.endSec || shotStart + 3) - shotStart);

  let currentStory = baseStory;
  const { server, baseUrl } = await startPatchedStoryServer(skillDir, () => currentStory);
  let browser = sharedBrowser;
  const ownsBrowser = !sharedBrowser;

  try {
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
      });
    }

    const variantRows = [];
    for (const v of variants) {
      const patched = JSON.parse(JSON.stringify(baseStory));
      if (typeof v.patchStory === "function") {
        v.patchStory(patched, patched.shots[shotIdx]);
      } else {
        if (v.rootPatch) Object.assign(patched, v.rootPatch);
        if (v.shotPatch) Object.assign(patched.shots[shotIdx], v.shotPatch);
      }
      currentStory = patched;

      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const runtimeErrors = [];
      page.on("pageerror", (e) => runtimeErrors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && !/status of 404/i.test(m.text())) runtimeErrors.push(m.text());
      });

      const qs = microstock ? "?microstock=1" : "";
      await page.goto(`${baseUrl}/${html}${qs}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });
      const meta = await page.evaluate(() => ({
        width: Number(window.__filmMeta?.width) || 1280,
        height: Number(window.__filmMeta?.height) || 720,
      }));
      if (meta.width !== 1280 || meta.height !== 720) {
        await page.setViewportSize({ width: meta.width, height: meta.height });
      }

      const frames = [];
      for (let ti = 0; ti < localTimes.length; ti++) {
        const lt = localTimes[ti];
        const absT = Math.round((shotStart + Math.min(lt, Math.max(0.01, shotDur - 0.01))) * 1000) / 1000;
        const evalData = await page.evaluate(
          ({ tVal, sId }) => {
            window.renderAt(tVal);
            const W = Number(window.__filmMeta?.width) || 1280;
            const H = Number(window.__filmMeta?.height) || 720;
            const sw = 160;
            const sh = Math.max(40, Math.round((H / W) * sw));
            const tmp = document.createElement("canvas");
            tmp.width = sw;
            tmp.height = sh;
            const tctx = tmp.getContext("2d");
            const canvases = Array.from(document.querySelectorAll("#stage canvas"));
            for (const c of canvases) tctx.drawImage(c, 0, 0, sw, sh);
            const rgba = Array.from(tctx.getImageData(0, 0, sw, sh).data);
            // 4x4x4 RGB histogram (64 bins)
            const hist = new Array(64).fill(0);
            const total = sw * sh;
            let rightEdgeBright = 0;
            for (let y = 0; y < sh; y++) {
              for (let x = 0; x < sw; x++) {
                const p = (y * sw + x) * 4;
                const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
                const bin = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
                hist[bin]++;
                if (x >= sw - 3 && (r + g + b) / 3 > 120) rightEdgeBright++;
              }
            }
            for (let b = 0; b < 64; b++) hist[b] /= Math.max(1, total);
            const shotRep = window.__shotReport ? window.__shotReport[sId] || null : null;
            const camRep = window.__cameraReport ? window.__cameraReport[sId] || null : null;
            return { sw, sh, rgba, hist, rightEdgeBright, shotRep, camRep };
          },
          { tVal: absT, sId: shotId },
        );

        const pngName = `${v.name}_t${lt.toFixed(2).replace(".", "_")}.png`;
        const pngPath = path.join(out, pngName);
        const pngBuf = await page.screenshot({ type: "png", timeout: 90_000 });
        fs.writeFileSync(pngPath, pngBuf);
        const sha256 = crypto.createHash("sha256").update(pngBuf).digest("hex");

        frames.push({
          localTime: lt,
          t: absT,
          pngName,
          pngPath,
          sha256,
          rightEdgeBrightPx: evalData.rightEdgeBright,
          hist: evalData.hist,
          rgba: evalData.rgba,
          shotReport: evalData.shotRep,
          cameraReport: evalData.camRep,
        });
      }

      // C4 check: diff between 3rd and 4th timestamps (e.g. t=1.5s vs t=2.8s)
      let lateDriftDiff = null;
      if (frames.length >= 4) {
        lateDriftDiff = meanAbsPixelDiff(frames[2].rgba, frames[3].rgba);
      }
      variantRows.push({
        name: v.name,
        runtimeErrors,
        lateDriftDiff,
        frames,
      });
      await context.close();
    }

    // Cross-variant comparison at each time index
    const crossVariant = localTimes.map((lt, ti) => {
      const hashes = new Set(variantRows.map((r) => r.frames[ti].sha256));
      let diffSum = 0;
      let histSum = 0;
      let pairs = 0;
      for (let i = 0; i < variantRows.length; i++) {
        for (let j = i + 1; j < variantRows.length; j++) {
          diffSum += meanAbsPixelDiff(variantRows[i].frames[ti].rgba, variantRows[j].frames[ti].rgba);
          histSum += l1ColorHistSim(variantRows[i].frames[ti].hist, variantRows[j].frames[ti].hist);
          pairs++;
        }
      }
      return {
        localTime: lt,
        uniqueHashes: hashes.size,
        totalVariants: variantRows.length,
        meanInterVariantPixelDiff: pairs ? Math.round((diffSum / pairs) * 1000) / 1000 : 0,
        meanInterVariantColorHistSim: pairs ? Math.round((histSum / pairs) * 10000) / 10000 : 1,
      };
    });

    // Build matrix contact sheet (rows = variants, cols = localTimes)
    const contactSheetPath = path.join(out, "camera_variants_contact_sheet.png");
    const thumbW = 280;
    const thumbH = Math.round(((baseStory.canvas?.h || 720) / (baseStory.canvas?.w || 1280)) * thumbW);
    const pad = 12;
    const headerH = 28;
    const cols = localTimes.length;
    const rows = variantRows.length;
    const sheetW = cols * thumbW + (cols + 1) * pad;
    const sheetH = rows * (thumbH + headerH) + (rows + 1) * pad;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const f = variantRows[r].frames[c];
        cells.push({
          row: r,
          col: c,
          label: `${variantRows[r].name} | lt=${f.localTime.toFixed(2)}s`,
          dataUrl: `data:image/png;base64,${fs.readFileSync(f.pngPath).toString("base64")}`,
        });
      }
    }
    const cPage = await browser.newPage({ viewport: { width: sheetW, height: sheetH } });
    await cPage.setContent(`<!doctype html><html><body style="margin:0;background:#0f172a"><canvas id="c" width="${sheetW}" height="${sheetH}"></canvas></body></html>`);
    await cPage.evaluate(
      async ({ cells, thumbW, thumbH, pad, headerH }) => {
        const cv = document.getElementById("c");
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, cv.width, cv.height);
        for (const cell of cells) {
          const x = pad + cell.col * (thumbW + pad);
          const y = pad + cell.row * (thumbH + headerH + pad);
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(x, y, thumbW, headerH);
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "bold 12px monospace";
          ctx.fillText(cell.label, x + 8, y + 18);
          const img = new Image();
          await new Promise((res) => { img.onload = res; img.src = cell.dataUrl; });
          ctx.drawImage(img, x, y + headerH, thumbW, thumbH);
        }
      },
      { cells, thumbW, thumbH, pad, headerH },
    );
    await cPage.screenshot({ path: contactSheetPath, type: "png" });
    await cPage.close();

    // Strip raw rgba/hist arrays from JSON output
    const report = {
      skillName,
      shotId,
      outDir: out,
      contactSheetPath,
      localTimes,
      crossVariant,
      variants: variantRows.map((r) => ({
        name: r.name,
        runtimeErrors: r.runtimeErrors,
        lateDriftDiff_t2_vs_t3: r.lateDriftDiff,
        frames: r.frames.map((f) => ({
          localTime: f.localTime,
          t: f.t,
          pngName: f.pngName,
          sha256: f.sha256,
          rightEdgeBrightPx: f.rightEdgeBrightPx,
          cameraReport: f.cameraReport,
          shotReport: f.shotReport,
        })),
      })),
    };
    const reportPath = path.join(out, "variants_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { report, reportPath, rawVariants: variantRows };
  } finally {
    if (ownsBrowser && browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let outDir = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out-dir" && args[i + 1]) outDir = path.resolve(args[++i]);
  }
  // Default C0.4 reproduction of C3/C4/C5: 5 variants on mg-cobalt-editorial s2-icons
  const defaultVariants = [
    { name: "A_dolly-in", shotPatch: { cameraPreset: "dolly-in", camera: undefined } },
    { name: "B_pan-sweep", shotPatch: { cameraPreset: "pan-sweep", camera: undefined } },
    { name: "C_macro-zoom-in", shotPatch: { cameraPreset: "macro-zoom-in", camera: undefined } },
    { name: "D_tilt-push", shotPatch: { cameraPreset: "tilt-push", camera: undefined } },
    {
      name: "E_custom-drift",
      shotPatch: {
        cameraPreset: "static",
        camera: {
          zoomFrom: 0.94,
          zoomTo: 1.24,
          panXFrom: -40,
          panXTo: 40,
          rollFromDeg: -1.5,
          rollToDeg: 1.5,
          moveDuration: 3.0,
          curve: "linear",
          velocityBlur: 0,
        },
      },
    },
  ];
  renderCameraVariants({
    skillName: "mg-cobalt-editorial",
    shotId: "s2-icons",
    localTimes: [0.15, 0.6, 1.5, 2.8],
    variants: defaultVariants,
    outDir,
  })
    .then(({ report, reportPath }) => {
      console.log(
        JSON.stringify(
          {
            reportPath,
            contactSheetPath: report.contactSheetPath,
            crossVariant: report.crossVariant,
            variantsSummary: report.variants.map((v) => ({
              name: v.name,
              runtimeErrors: v.runtimeErrors.length,
              lateDriftDiff_t15_vs_t28: v.lateDriftDiff_t2_vs_t3,
              rightEdgeBright_t15: v.frames[2]?.rightEdgeBrightPx,
              rightEdgeBright_t28: v.frames[3]?.rightEdgeBrightPx,
              hashes: v.frames.map((f) => f.sha256.slice(0, 10)),
            })),
          },
          null,
          2,
        ),
      );
    })
    .catch((err) => {
      console.error("[render-camera-variants] FAILED:", err);
      process.exit(1);
    });
}
