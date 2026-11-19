#!/usr/bin/env node
/**
 * K4 Composition Similarity, Spec Utilization & 17x4 Contact Sheet Tool.
 *
 * Reads rendered PNGs from `--in-dir` (produced by `render-skill-example.mjs --all`),
 * computes normalized Sobel edge-map cosine similarity and 64-bin RGB histogram cosine
 * similarity with intra-skill vs inter-skill control, measures `kit.json` enum utilization
 * in `story.example.json`, and generates `contact_sheet_17x4.png` in `--out-dir` (temp dir).
 *
 * Zero external dependencies beyond Playwright (already installed).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.join(REPO_ROOT, ".aetheria", "skills");

function parseArgs(argv) {
  const opts = {
    inDir: path.join(os.tmpdir(), "aetheria-k2-r1"),
    outDir: path.join(os.tmpdir(), "aetheria-k4-diversity"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in-dir" && argv[i + 1]) opts.inDir = path.resolve(argv[++i]);
    else if (argv[i] === "--out-dir" && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
  }
  fs.mkdirSync(opts.outDir, { recursive: true });
  return opts;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function meanVec(vecs) {
  if (!vecs.length) return [];
  const out = new Float64Array(vecs[0].length);
  for (const v of vecs) {
    for (let i = 0; i < v.length; i++) out[i] += v[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= vecs.length;
  return Array.from(out);
}

function measureKitUtilization() {
  const dirs = fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("mg-"))
    .map((d) => d.name)
    .sort();

  const rows = [];
  for (const skill of dirs) {
    const ex = path.join(SKILLS_ROOT, skill, "examples");
    const kitPath = path.join(ex, "kit.json");
    const storyPath = path.join(ex, "story.example.json");
    if (!fs.existsSync(kitPath) || !fs.existsSync(storyPath)) continue;
    const kit = JSON.parse(fs.readFileSync(kitPath, "utf8"));
    const story = JSON.parse(fs.readFileSync(storyPath, "utf8"));
    const declaredLayouts = (kit.enums && kit.enums.layout) || kit.layouts || [];
    const usedLayouts = new Set((story.shots || []).map((s) => s.layout).filter(Boolean));
    const matched = declaredLayouts.filter((l) => usedLayouts.has(l)).length;
    rows.push({
      skill,
      declaredLayouts: declaredLayouts.length,
      usedLayouts: usedLayouts.size,
      utilizationPct:
        declaredLayouts.length > 0
          ? Math.round((matched / declaredLayouts.length) * 1000) / 10
          : null,
    });
  }
  return rows;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const summaryPath = path.join(opts.inDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Missing ${summaryPath}. Run render-skill-example.mjs --all first.`);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
    await page.setContent(`<!doctype html><html><body><canvas id="c"></canvas></body></html>`);

    const skillDescriptors = [];
    const sheetRows = [];

    for (const sk of summary.skills) {
      const report = JSON.parse(fs.readFileSync(sk.reportPath, "utf8"));
      const frames = report.frames || [];
      const edgeVecs = [];
      const histVecs = [];

      for (const f of frames) {
        const dataUrl = `data:image/png;base64,${fs.readFileSync(f.pngPath).toString("base64")}`;
        const desc = await page.evaluate(async (url) => {
          const img = new Image();
          await new Promise((res) => {
            img.onload = res;
            img.src = url;
          });
          const sw = 48;
          const sh = 85;
          const c = document.getElementById("c");
          c.width = sw;
          c.height = sh;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, sw, sh);
          const data = ctx.getImageData(0, 0, sw, sh).data;

          // 64-bin RGB color histogram (4x4x4)
          const hist = new Array(64).fill(0);
          const gray = new Float32Array(sw * sh);
          for (let i = 0; i < sw * sh; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            const bin = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
            hist[bin]++;
          }

          // Sobel edge magnitude map (46x83 = 3818 dims, downsampled 2x2 -> 23x41 = 943 dims)
          const ew = Math.floor((sw - 2) / 2);
          const eh = Math.floor((sh - 2) / 2);
          const edges = new Array(ew * eh).fill(0);
          for (let y = 1; y < sh - 1; y++) {
            for (let x = 1; x < sw - 1; x++) {
              const gx =
                -gray[(y - 1) * sw + (x - 1)] +
                gray[(y - 1) * sw + (x + 1)] -
                2 * gray[y * sw + (x - 1)] +
                2 * gray[y * sw + (x + 1)] -
                gray[(y + 1) * sw + (x - 1)] +
                gray[(y + 1) * sw + (x + 1)];
              const gy =
                -gray[(y - 1) * sw + (x - 1)] -
                2 * gray[(y - 1) * sw + x] -
                gray[(y - 1) * sw + (x + 1)] +
                gray[(y + 1) * sw + (x - 1)] +
                2 * gray[(y + 1) * sw + x] +
                gray[(y + 1) * sw + (x + 1)];
              const mag = Math.hypot(gx, gy);
              const bx = Math.min(ew - 1, Math.floor((x - 1) / 2));
              const by = Math.min(eh - 1, Math.floor((y - 1) / 2));
              edges[by * ew + bx] += mag;
            }
          }
          return { edges, hist };
        }, dataUrl);

        edgeVecs.push(desc.edges);
        histVecs.push(desc.hist);
      }

      // Pick 4 evenly spaced frames for 17x4 contact sheet
      const picked = [];
      for (let k = 0; k < 4; k++) {
        const idx = Math.min(frames.length - 1, Math.floor((k * frames.length) / 4));
        picked.push(frames[idx]);
      }
      sheetRows.push({
        skill: sk.skill,
        frames: picked.map((f) => ({
          t: f.t,
          dataUrl: `data:image/png;base64,${fs.readFileSync(f.pngPath).toString("base64")}`,
        })),
      });

      // Intra-skill control similarity
      let intraEdgeSum = 0;
      let intraHistSum = 0;
      let intraPairs = 0;
      for (let i = 0; i < edgeVecs.length; i++) {
        for (let j = i + 1; j < edgeVecs.length; j++) {
          intraEdgeSum += cosine(edgeVecs[i], edgeVecs[j]);
          intraHistSum += cosine(histVecs[i], histVecs[j]);
          intraPairs++;
        }
      }

      skillDescriptors.push({
        skill: sk.skill,
        frameCount: frames.length,
        meanEdge: meanVec(edgeVecs),
        meanHist: meanVec(histVecs),
        intraEdgeSim: intraPairs > 0 ? Math.round((intraEdgeSum / intraPairs) * 1000) / 1000 : null,
        intraHistSim: intraPairs > 0 ? Math.round((intraHistSum / intraPairs) * 1000) / 1000 : null,
      });
    }

    // Inter-skill pairwise similarities (17*16/2 = 136 pairs)
    const interPairs = [];
    for (let i = 0; i < skillDescriptors.length; i++) {
      for (let j = i + 1; j < skillDescriptors.length; j++) {
        const a = skillDescriptors[i];
        const b = skillDescriptors[j];
        const edgeSim = cosine(a.meanEdge, b.meanEdge);
        const histSim = cosine(a.meanHist, b.meanHist);
        const combined = 0.5 * edgeSim + 0.5 * histSim;
        interPairs.push({
          a: a.skill,
          b: b.skill,
          edgeSim: Math.round(edgeSim * 1000) / 1000,
          histSim: Math.round(histSim * 1000) / 1000,
          combined: Math.round(combined * 1000) / 1000,
        });
      }
    }
    interPairs.sort((x, y) => y.combined - x.combined);

    const meanIntraEdge =
      Math.round(
        (skillDescriptors.reduce((s, d) => s + (d.intraEdgeSim || 0), 0) / skillDescriptors.length) *
          1000,
      ) / 1000;
    const meanIntraHist =
      Math.round(
        (skillDescriptors.reduce((s, d) => s + (d.intraHistSim || 0), 0) / skillDescriptors.length) *
          1000,
      ) / 1000;
    const meanInterEdge =
      Math.round((interPairs.reduce((s, p) => s + p.edgeSim, 0) / interPairs.length) * 1000) / 1000;
    const meanInterHist =
      Math.round((interPairs.reduce((s, p) => s + p.histSim, 0) / interPairs.length) * 1000) / 1000;

    // Render 17x4 contact sheet in temp dir
    const thumbW = 135;
    const thumbH = 240;
    const labelW = 210;
    const pad = 8;
    const sheetW = labelW + 4 * (thumbW + pad) + pad;
    const sheetH = sheetRows.length * (thumbH + pad) + pad;

    const sheetPage = await browser.newPage({ viewport: { width: sheetW, height: sheetH } });
    await sheetPage.setContent(
      `<!doctype html><html><body style="margin:0;background:#0f172a"><canvas id="s" width="${sheetW}" height="${sheetH}"></canvas></body></html>`,
    );
    await sheetPage.evaluate(
      async ({ rows, thumbW, thumbH, labelW, pad }) => {
        const c = document.getElementById("s");
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, c.width, c.height);
        for (let r = 0; r < rows.length; r++) {
          const y = pad + r * (thumbH + pad);
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(pad, y, labelW - pad * 2, thumbH);
          ctx.fillStyle = "#f8fafc";
          ctx.font = "bold 14px monospace";
          ctx.fillText(rows[r].skill, pad + 10, y + thumbH / 2 + 5);
          for (let col = 0; col < rows[r].frames.length; col++) {
            const f = rows[r].frames[col];
            const x = labelW + col * (thumbW + pad);
            const img = new Image();
            await new Promise((res) => {
              img.onload = res;
              img.src = f.dataUrl;
            });
            ctx.drawImage(img, x, y, thumbW, thumbH);
          }
        }
      },
      { rows: sheetRows, thumbW, thumbH, labelW, pad },
    );
    const contactSheetPath = path.join(opts.outDir, "contact_sheet_17x4.png");
    await sheetPage.screenshot({ path: contactSheetPath, type: "png" });
    await sheetPage.close();

    const kitUtilization = measureKitUtilization();
    const result = {
      skillCount: skillDescriptors.length,
      interPairCount: interPairs.length,
      controlIntraSkill: {
        meanEdgeCosine: meanIntraEdge,
        meanHistCosine: meanIntraHist,
      },
      interSkill: {
        meanEdgeCosine: meanInterEdge,
        meanHistCosine: meanInterHist,
        top5MostSimilar: interPairs.slice(0, 5),
        bottom5MostDistinct: interPairs.slice(-5).reverse(),
      },
      kitUtilization,
      contactSheetPath,
    };

    const reportPath = path.join(opts.outDir, "diversity_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("[measure-skill-diversity] FAILED:", err);
  process.exit(1);
});
