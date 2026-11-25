#!/usr/bin/env node
/**
 * Universal Visual Asset & 3-Frame QC Sheet Generator for all 19 mg-* skills.
 * 100% English outputs, badges, and phase labels (`start`, `mid`, `end`):
 * - Bespoke gallery skills (`mg-stickman-story`, `mg-soft-clay-story`): `assets/character-gallery.png` (+ `assets/hero-rig-qa.png`)
 * - All other 17 `mg-*` skills: `assets/visual-gallery.png`
 * - ALL 19 `mg-*` skills: `assets/qc-sheet-example.jpg` (3 frames per shot: start, mid, end)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.join(REPO_ROOT, ".aetheria", "skills");

const BUILTIN_SCRIPTS = new Map([
  [
    "/script/three.min.js",
    path.join(REPO_ROOT, "core", "aetheria-engine", "assets", "script", "three.min.js"),
  ],
]);

const appScriptDir = path.join(REPO_ROOT, "apps", "public", "script");
if (fs.existsSync(appScriptDir)) {
  for (const name of fs.readdirSync(appScriptDir)) {
    if (name.endsWith(".js")) {
      BUILTIN_SCRIPTS.set(`/script/${name}`, path.join(appScriptDir, name));
    }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function parseArgs(argv) {
  let skill = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && argv[i + 1]) skill = argv[++i];
  }
  return { skill };
}

function safeResolveUnder(rootDir, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, clean);
  const norm = path.resolve(rootDir);
  if (resolved !== norm && !resolved.startsWith(norm + path.sep)) return null;
  return resolved;
}

function startStaticServer(examplesDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      if (BUILTIN_SCRIPTS.has(urlPath) && fs.existsSync(BUILTIN_SCRIPTS.get(urlPath))) {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(fs.readFileSync(BUILTIN_SCRIPTS.get(urlPath)));
        return;
      }
      const target = safeResolveUnder(examplesDir, urlPath === "/" ? "story.html" : urlPath);
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(target).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function readStoryMeta(examplesDir) {
  const storyPath = path.join(examplesDir, "story.example.json");
  if (!fs.existsSync(storyPath)) return { width: 1080, height: 1920, shots: [] };
  const raw = JSON.parse(fs.readFileSync(storyPath, "utf8"));
  const width = Number((raw.canvas && raw.canvas.w) || (raw.meta && raw.meta.width) || 1080);
  const height = Number((raw.canvas && raw.canvas.h) || (raw.meta && raw.meta.height) || 1920);
  const shots = [];
  let cursor = 0;
  for (const sh of raw.shots || []) {
    if (!sh || typeof sh !== "object") continue;
    const st = Number.isFinite(Number(sh.start))
      ? Number(sh.start)
      : Number.isFinite(Number(sh.startSec))
        ? Number(sh.startSec)
        : cursor;
    const dur = Number.isFinite(Number(sh.duration))
      ? Number(sh.duration)
      : Number.isFinite(Number(sh.endSec))
        ? Math.max(0.5, Number(sh.endSec) - st)
        : 4.0;
    cursor = st + dur;
    shots.push({
      id: sh.id || `shot${shots.length + 1}`,
      layout: sh.layout || sh.stage || "",
      start: st,
      duration: dur,
    });
  }
  return { width, height, shots };
}

function readPaletteHexes(skillDir) {
  const p = path.join(skillDir, "tokens.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf8");
    const matches = raw.match(/#[0-9A-Fa-f]{6}\b/g) || [];
    return [...new Set(matches.map((m) => m.toUpperCase()))].slice(0, 7);
  } catch {
    return [];
  }
}

async function waitFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

async function stitchImagesInBrowser(composerPage, payload) {
  const dataUrl = await composerPage.evaluate(async (cfg) => {
    const imgs = await Promise.all(
      cfg.tiles.map(
        (tile) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ img, tile });
            img.onerror = () => reject(new Error("Failed loading captured frame for sheet"));
            img.src = `data:image/png;base64,${tile.b64}`;
          }),
      ),
    );

    const cols = cfg.cols;
    const rows = Math.ceil(imgs.length / cols);
    const padX = cfg.padX || 20;
    const padY = cfg.padY || 18;
    const headerH = cfg.headerH || 78;
    const labelH = cfg.labelH || 34;

    const first = imgs[0].img;
    const aspect = first.height / Math.max(1, first.width);
    const cellW = Math.floor((cfg.sheetW - padX * (cols + 1)) / cols);
    const cellH = Math.min(cfg.maxCellH || 620, Math.round(cellW * aspect));
    const sheetH = cfg.sheetH || headerH + rows * (cellH + labelH + padY) + 22;

    const canvas = document.createElement("canvas");
    canvas.width = cfg.sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = cfg.bg || "#111319";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#F8FAFC";
    ctx.font = '800 28px "Inter", "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.title, padX, 32);

    ctx.fillStyle = "#94A3B8";
    ctx.font = '600 15px "Inter", "Segoe UI", sans-serif';
    ctx.fillText(cfg.subtitle, padX, 58);

    if (Array.isArray(cfg.swatches) && cfg.swatches.length) {
      const r = 13;
      const startX = cfg.sheetW - padX - cfg.swatches.length * 34;
      for (let s = 0; s < cfg.swatches.length; s++) {
        ctx.fillStyle = cfg.swatches[s];
        ctx.beginPath();
        ctx.arc(startX + s * 34, 40, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.stroke();
      }
    }

    for (let i = 0; i < imgs.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padX + col * (cellW + padX);
      const y = headerH + row * (cellH + labelH + padY);
      const { img, tile } = imgs[i];

      ctx.fillStyle = "#1B1F29";
      ctx.fillRect(x, y, cellW, cellH + labelH);

      const scale = Math.min(cellW / img.width, cellH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, x + (cellW - dw) * 0.5, y + (cellH - dh) * 0.5, dw, dh);

      ctx.strokeStyle = tile.borderColor || "#334155";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cellW, cellH);

      if (tile.badge) {
        ctx.font = '800 13px "Inter", "Segoe UI", sans-serif';
        const bw = ctx.measureText(tile.badge).width + 18;
        ctx.fillStyle = tile.badgeColor || "#38BDF8";
        ctx.fillRect(x + 8, y + 8, bw, 22);
        ctx.fillStyle = "#0F172A";
        ctx.textBaseline = "middle";
        ctx.fillText(tile.badge, x + 17, y + 19);
      }

      ctx.fillStyle = "#E2E8F0";
      ctx.font = '700 14px "Inter", "Segoe UI", sans-serif';
      ctx.textBaseline = "middle";
      ctx.fillText(tile.label, x + 10, y + cellH + labelH * 0.5);
    }

    return canvas.toDataURL(cfg.mime || "image/png", cfg.quality || 0.9);
  }, payload);

  const b64 = dataUrl.split(",")[1];
  return Buffer.from(b64, "base64");
}

async function captureGalleryPage(browser, baseUrl, relUrl, width, height, outPath) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${baseUrl}/${relUrl}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 25_000 });
    await waitFrames(page);
    const buf = await page.screenshot({ type: "png", animations: "disabled", timeout: 90_000 });
    fs.writeFileSync(outPath, buf);
    if (errors.length) throw new Error(`Gallery runtime errors for ${relUrl}: ${errors.join("; ")}`);
  } finally {
    await ctx.close();
  }
}

async function renderSkillAssets(browser, composerPage, skillName) {
  const skillDir = path.join(SKILLS_ROOT, skillName);
  const examplesDir = path.join(skillDir, "examples");
  const assetsDir = path.join(skillDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const meta = readStoryMeta(examplesDir);
  const swatches = readPaletteHexes(skillDir);
  const { server, baseUrl } = await startStaticServer(examplesDir);

  try {
    const galleryHtml = path.join(examplesDir, "gallery.html");
    if (fs.existsSync(galleryHtml)) {
      if (skillName === "mg-stickman-story") {
        await captureGalleryPage(
          browser,
          baseUrl,
          "gallery.html?mode=main",
          1920,
          1080,
          path.join(assetsDir, "character-gallery.png"),
        );
        await captureGalleryPage(
          browser,
          baseUrl,
          "gallery.html?mode=hero",
          1560,
          960,
          path.join(assetsDir, "hero-rig-qa.png"),
        );
      } else {
        await captureGalleryPage(
          browser,
          baseUrl,
          "gallery.html",
          1920,
          1080,
          path.join(assetsDir, "character-gallery.png"),
        );
      }
    }

    const htmlFile = fs.existsSync(path.join(examplesDir, "story.html")) ? "story.html" : "index.html";
    const ctx = await browser.newContext({
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    try {
      await page.goto(`${baseUrl}/${htmlFile}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });

      const filmMeta = await page.evaluate(() => window.__filmMeta || {});
      const rw = Number(filmMeta.width) || meta.width;
      const rh = Number(filmMeta.height) || meta.height;
      if (rw !== meta.width || rh !== meta.height) {
        await page.setViewportSize({ width: rw, height: rh });
      }

      const captureAt = async (ts) => {
        await page.evaluate((sec) => {
          if (typeof window.renderAt === "function") window.renderAt(sec);
        }, ts);
        await waitFrames(page);
        const buf = await page.screenshot({ type: "png", animations: "disabled", timeout: 90_000 });
        const qa = await page.evaluate(() => window.__shotReport || null);
        return { b64: buf.toString("base64"), qa };
      };

      if (!fs.existsSync(galleryHtml)) {
        const galleryShots = meta.shots.slice(0, 6);
        const tiles = [];
        for (let i = 0; i < galleryShots.length; i++) {
          const sh = galleryShots[i];
          const mid = Math.round((sh.start + sh.duration * 0.52) * 1000) / 1000;
          const cap = await captureAt(mid);
          tiles.push({
            b64: cap.b64,
            badge: `#${i + 1}`,
            badgeColor: "#38BDF8",
            label: `${sh.id}${sh.layout ? ` \u2022 ${sh.layout}` : ""} @ ${mid.toFixed(2)}s`,
          });
        }
        const cols = Math.min(3, Math.max(2, tiles.length));
        const pngBuf = await stitchImagesInBrowser(composerPage, {
          sheetW: 1920,
          cols,
          maxCellH: rw >= rh ? 420 : 540,
          bg: "#0F1219",
          title: `${skillName.toUpperCase()} \u2014 VISUAL & PALETTE GALLERY`,
          subtitle: `Default canvas ${rw}\u00D7${rh} \u2022 ${meta.shots.length} example shots from story.example.json`,
          swatches,
          tiles,
          mime: "image/png",
        });
        fs.writeFileSync(path.join(assetsDir, "visual-gallery.png"), pngBuf);
      }

      const qcShots = meta.shots.slice(0, 3);
      const qcTiles = [];
      const phaseSpecs = [
        { key: "start", frac: null, delta: 0.25 },
        { key: "mid", frac: 0.55, delta: null },
        { key: "end", frac: null, delta: -0.35 },
      ];
      for (const sh of qcShots) {
        for (const ph of phaseSpecs) {
          const tRaw =
            ph.frac !== null
              ? sh.start + sh.duration * ph.frac
              : ph.delta > 0
                ? sh.start + Math.min(ph.delta, sh.duration * 0.15)
                : sh.start + Math.max(sh.duration * 0.55, sh.duration + ph.delta);
          const ts = Math.round(tRaw * 1000) / 1000;
          const cap = await captureAt(ts);
          const entry = cap.qa && cap.qa[sh.id];
          const ok = !entry || (entry.errors && entry.errors.length === 0 && entry.focusBboxInSafeZone !== false);
          qcTiles.push({
            b64: cap.b64,
            badge: ok ? "SAFE" : "CHECK",
            badgeColor: ok ? "#22C55E" : "#F59E0B",
            borderColor: ok ? "#22C55E" : "#F59E0B",
            label: `${sh.id} [${ph.key}] t=${ts.toFixed(2)}s`,
          });
        }
      }
      const jpgBuf = await stitchImagesInBrowser(composerPage, {
        sheetW: rw >= rh ? 1920 : 1440,
        cols: 3,
        maxCellH: rw >= rh ? 380 : 520,
        bg: "#0D1017",
        title: `${skillName} \u2014 3-FRAME SELF-QC SHEET EXAMPLE`,
        subtitle: "Aetheria Self-QC standard: col 1 = start (+0.25s), col 2 = mid (55%), col 3 = end (-0.35s)",
        swatches,
        tiles: qcTiles,
        mime: "image/jpeg",
        quality: 0.88,
      });
      fs.writeFileSync(path.join(assetsDir, "qc-sheet-example.jpg"), jpgBuf);

      if (errors.length) {
        throw new Error(`Story runtime errors in ${skillName}: ${errors.join("; ")}`);
      }
    } finally {
      await ctx.close();
    }
  } finally {
    server.close();
  }
}

async function main() {
  const { skill } = parseArgs(process.argv.slice(2));
  const dirs = fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("mg-"))
    .map((d) => d.name)
    .sort()
    .filter((n) => !skill || n === skill);

  if (!dirs.length) {
    throw new Error(`No matching mg-* skill directory found for "${skill}"`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
  });

  const composerCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const composerPage = await composerCtx.newPage();
  await composerPage.setContent("<!doctype html><html><body></body></html>");

  try {
    for (let i = 0; i < dirs.length; i++) {
      const name = dirs[i];
      const t0 = Date.now();
      await renderSkillAssets(browser, composerPage, name);
      const files = fs.readdirSync(path.join(SKILLS_ROOT, name, "assets")).sort();
      console.log(`[${i + 1}/${dirs.length}] ${name} -> ${files.join(", ")} (${Date.now() - t0}ms)`);
    }
  } finally {
    await composerCtx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
