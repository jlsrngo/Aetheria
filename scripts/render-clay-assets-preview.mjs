#!/usr/bin/env node
/**
 * S1 Visual Verification Script (`scripts/render-clay-assets-preview.mjs`).
 *
 * Renders one deterministic studio PNG per ClayKit.makeAsset kind (all 8 kinds)
 * plus an 8-panel contact sheet (`assets_sheet.png`) in a temporary or specified output directory.
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

const SCRIPT_FILES = {
  "/script/three.min.js": path.join(REPO_ROOT, "core", "aetheria-engine", "assets", "script", "three.min.js"),
  "/script/aetheria-motion.js": path.join(REPO_ROOT, "apps", "public", "script", "aetheria-motion.js"),
  "/script/clay-kit.js": path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-kit.js"),
  "/script/clay-buildings.js": path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-buildings.js"),
  "/script/clay-people.js": path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-people.js"),
  "/script/clay-gestures.js": path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-gestures.js"),
  "/script/clay-assets.js": path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "examples", "script", "clay-assets.js"),
};

const SHOWCASE_SPECS = [
  { id: "farmer", kind: "humanoid", accessories: ["hat-conical", "towel"], palette: { primary: "#60A5FA", secondary: "#78716C", hat: "#FDE68A", accent: "#FB7185" }, anim: "idle", p: 0.25 },
  { id: "flowers", kind: "flower-row", palette: { primary: "#FB923C", accent: "#FACC15", stem: "#4ADE80" }, anim: "grow", p: 1.0 },
  { id: "canister", kind: "container", palette: { primary: "#38BDF8", accent: "#FACC15", secondary: "#FFFDF9" }, anim: "idle", p: 0.2 },
  { id: "hopper", kind: "insect", palette: { primary: "#A3E635", secondary: "#4D7C0F", accent: "#E0F2FE" }, anim: "hop", p: 0.5 },
  { id: "tree", kind: "tree", palette: { primary: "#4ADE80", secondary: "#86EFAC", trunk: "#9A5B32" }, anim: "idle", p: 0.2 },
  { id: "house", kind: "building", palette: { primary: "#FDA4AF", accent: "#E11D48" }, anim: "idle", p: 0.0 },
  { id: "car", kind: "vehicle", palette: { primary: "#FF8FAB", accent: "#FFF0F3" }, anim: "idle", p: 0.0 },
  { id: "blob", kind: "blob", palette: { primary: "#FEF08A", secondary: "#FDE047", accent: "#F5D0FE" }, anim: "pop-in", p: 1.0 },
];

const PRESET_SPECS = {
  base: SHOWCASE_SPECS,
  buildings: [
    { id: "b_shop", label: "building:shop", kind: "building", variant: "shop", palette: { primary: "#FDA4AF", accent: "#E11D48" }, anim: "idle", p: 0 },
    { id: "b_house", label: "building:house", kind: "building", variant: "house", palette: { primary: "#FEF3C7", accent: "#EA580C" }, anim: "idle", p: 0 },
    { id: "b_hut", label: "building:hut", kind: "building", variant: "hut", palette: { primary: "#FDE68A", accent: "#D97706" }, anim: "idle", p: 0 },
    { id: "b_barn", label: "building:barn", kind: "building", variant: "barn", palette: { primary: "#EF4444", accent: "#78716C" }, anim: "idle", p: 0 },
    { id: "b_apt", label: "building:apartment", kind: "building", variant: "apartment", palette: { primary: "#93C5FD", accent: "#3B82F6" }, anim: "idle", p: 0 },
    { id: "b_school", label: "building:school", kind: "building", variant: "school", palette: { primary: "#FDE68A", accent: "#E11D48" }, anim: "idle", p: 0 },
  ],
  people: [
    { id: "p_kid", label: "kid+spiky+backpack (wave)", kind: "humanoid", variant: "kid", hair: "spiky", accessories: ["backpack"], palette: { primary: "#38BDF8", accent: "#F97316" }, anim: "wave", p: 0.35, expression: "laugh", emote: "music" },
    { id: "p_elder", label: "elder+beard+glasses (talk)", kind: "humanoid", variant: "elder", hair: "bald", accessories: ["glasses", "beard"], palette: { primary: "#A78BFA", secondary: "#57534E" }, anim: "talk", p: 0.3, expression: "happy", emote: "idea" },
    { id: "p_hijab", label: "adult+hijab+glasses (cheer)", kind: "humanoid", variant: "adult", hair: "bun", accessories: ["hijab", "glasses"], palette: { primary: "#34D399", hat: "#F472B6" }, anim: "cheer", p: 0.3, expression: "laugh", emote: "heart" },
    { id: "p_long", label: "adult+long (shock/surprised)", kind: "humanoid", variant: "adult", hair: "long", palette: { primary: "#FB7185", hair: "#292524" }, anim: "shock", p: 0.25, expression: "surprised", emote: "exclaim" },
    { id: "p_chubby", label: "chubby+cap (angry)", kind: "humanoid", variant: "chubby", hair: "short", accessories: ["hat-cap"], palette: { primary: "#F59E0B", hat: "#EF4444" }, anim: "point", p: 0.4, expression: "angry", emote: "anger" },
    { id: "p_pony", label: "adult+ponytail (run)", kind: "humanoid", variant: "adult", hair: "ponytail", palette: { primary: "#60A5FA", accent: "#FACC15" }, anim: "run", p: 0.31, expression: "worried", emote: "sweat" },
    { id: "p_farmer", label: "adult+conical+towel (work)", kind: "humanoid", variant: "adult", hair: "short", accessories: ["hat-conical", "towel"], palette: { primary: "#4ADE80", hat: "#FDE68A" }, anim: "work", p: 0.35, expression: "happy", emote: "question" },
    { id: "p_sleep", label: "kid+bun (dance/sleepy)", kind: "humanoid", variant: "kid", hair: "bun", palette: { primary: "#F472B6", accent: "#38BDF8" }, anim: "dance", p: 0.35, expression: "sleepy", emote: "sleep" },
  ],
};
const HARNESS_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 540px; height: 540px; overflow: hidden;
      background: linear-gradient(180deg, #93C5FD 0%, #BAE6FD 52%, #E0F2FE 100%); }
    canvas { display: block; width: 540px; height: 540px; }
  </style>
  <script src="/script/three.min.js"></script>
  <script src="/script/aetheria-motion.js"></script>
  <script src="/script/clay-kit.js"></script>
  <script src="/script/clay-buildings.js"></script>
  <script src="/script/clay-people.js"></script>
  <script src="/script/clay-gestures.js"></script>
  <script src="/script/clay-assets.js"></script>
</head>
<body>
  <canvas id="gl" width="540" height="540"></canvas>
  <script>
    (function () {
      var canvas = document.getElementById("gl");
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(540, 540, false);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.NoToneMapping;

      var scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.68));
      var sun = new THREE.DirectionalLight(0xfffbeb, 0.55);
      sun.position.set(6, 12, 10);
      scene.add(sun);

      var ground = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 2.8, 0.22, 32),
        new THREE.MeshLambertMaterial({ color: 0xf1f5f9 })
      );
      ground.position.set(0, -0.11, 0);
      scene.add(ground);

      var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
      var currentObj = null;

      window.renderAssetSpec = function (spec) {
        if (currentObj) scene.remove(currentObj);
        var asset = window.ClayKit.makeAsset(spec);
        asset.animate(spec.anim || "idle", typeof spec.p === "number" ? spec.p : 0);
        if (spec.expression && typeof asset.setExpression === "function") asset.setExpression(spec.expression);
        if (spec.emote && typeof asset.setEmote === "function") asset.setEmote(spec.emote, 0.25);
        currentObj = asset.group;
        currentObj.rotation.y = spec.kind === "insect" || spec.kind === "vehicle" ? -0.45 : 0.28;
        scene.add(currentObj);

        currentObj.updateWorldMatrix(true, true);
        var box = new THREE.Box3().setFromObject(currentObj);
        var center = box.getCenter(new THREE.Vector3());
        var size = box.getSize(new THREE.Vector3());
        var radius = Math.max(size.x, size.y, size.z) * 0.65;
        var dist = (radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) * 1.45;
        camera.position.set(center.x, center.y + size.y * 0.16, center.z + dist);
        camera.lookAt(center);
        renderer.render(scene, camera);
        return {
          size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
          minY: +box.min.y.toFixed(3)
        };
      };
      window.__ready = true;
    })();
  </script>
</body>
</html>`;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HARNESS_HTML);
        return;
      }
      if (SCRIPT_FILES[urlPath] && fs.existsSync(SCRIPT_FILES[urlPath])) {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(fs.readFileSync(SCRIPT_FILES[urlPath]));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function main() {
  let outDir = "";
  let preset = "base";
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--out-dir" && process.argv[i + 1]) outDir = path.resolve(process.argv[++i]);
    else if (process.argv[i] === "--preset" && process.argv[i + 1]) preset = process.argv[++i];
  }
  const activeSpecs = PRESET_SPECS[preset] || SHOWCASE_SPECS;
  if (!outDir) outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-s1-assets-"));
  else fs.mkdirSync(outDir, { recursive: true });

  const { server, baseUrl } = await startServer();
  const runtimeErrors = [];
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 540, height: 540 }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => runtimeErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") runtimeErrors.push(`console.error: ${m.text()}`); });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ready === true);

    const rendered = [];
    for (const spec of activeSpecs) {
      const boxInfo = await page.evaluate((s) => window.renderAssetSpec(s), spec);
      const fileStem = preset === "base" ? spec.kind : spec.id;
      const pngPath = path.join(outDir, `${fileStem}.png`);
      const buf = await page.screenshot({ type: "png" });
      fs.writeFileSync(pngPath, buf);
      rendered.push({
        kind: spec.label || spec.kind,
        id: spec.id,
        pngPath,
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
        box: boxInfo,
        dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
      });
    }

    // Build 4x2 contact sheet PNG
    const cell = 320;
    const header = 34;
    const pad = 12;
    const cols = 4;
    const rows = 2;
    const sw = cols * cell + (cols + 1) * pad;
    const sh = rows * (cell + header) + (rows + 1) * pad;
    const sheetPage = await browser.newPage({ viewport: { width: sw, height: sh } });
    await sheetPage.setContent(`<!doctype html><html><body style="margin:0;background:#0f172a"><canvas id="c" width="${sw}" height="${sh}"></canvas></body></html>`);
    await sheetPage.evaluate(async ({ rendered, cell, header, pad, cols }) => {
      const c = document.getElementById("c");
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < rendered.length; i++) {
        const r = rendered[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * (cell + pad);
        const y = pad + row * (cell + header + pad);
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(x, y, cell, header);
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 15px monospace";
        ctx.fillText(`${r.kind} (${r.box.size.x}x${r.box.size.y}x${r.box.size.z})`, x + 10, y + 22);
        const img = new Image();
        await new Promise((res) => { img.onload = res; img.src = r.dataUrl; });
        ctx.drawImage(img, x, y + header, cell, cell);
      }
    }, { rendered, cell, header, pad, cols });
    const sheetPath = path.join(outDir, "assets_sheet.png");
    await sheetPage.screenshot({ path: sheetPath, type: "png" });
    await sheetPage.close();

    const summary = {
      outDir,
      sheetPath,
      runtimeErrors,
      assets: rendered.map(({ dataUrl: _omit, ...rest }) => rest),
    };
    fs.writeFileSync(path.join(outDir, "assets_report.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    process.exit(runtimeErrors.length > 0 ? 1 : 0);
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
