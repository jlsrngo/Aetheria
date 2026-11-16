import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const candidates = [
    path.join(REPO_ROOT, "target", "debug", exe),
    path.join(REPO_ROOT, "target", "release", exe),
  ].filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    throw new Error(`Engine binary not found. Run "npm run build:engine" first.`);
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort(preferred = 4496) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => {
      const ephem = net.createServer();
      ephem.unref();
      ephem.listen(0, "127.0.0.1", () => {
        const addr = ephem.address();
        const port = typeof addr === "object" && addr ? addr.port : preferred + 1;
        ephem.close(() => resolve(port));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });
}

async function api(baseUrl, urlPath, { method = "GET", authHeader, body } = {}) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }
  return { ok: res.ok, status: res.status, text, json };
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4496);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-ms-render-e2e-"));
  const projectSlug = "render-e2e-smoke";
  const projectDir = path.join(tempWorkspace, "projects", projectSlug);
  fs.mkdirSync(path.join(projectDir, "microstock"), { recursive: true });
  fs.mkdirSync(path.join(tempWorkspace, ".aetheria"), { recursive: true });

  fs.writeFileSync(
    path.join(tempWorkspace, ".aetheria", "active-project.json"),
    JSON.stringify({ project: projectSlug }, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(projectDir, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>E2E Render Test</title>
  <style>
    html, body { margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; background: #071324; }
    canvas { display: block; width: 1920px; height: 1080px; }
  </style>
</head>
<body>
  <canvas id="c" width="1920" height="1080"></canvas>
  <script>
    window.__filmMeta = {
      title: "E2E Render Test",
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 2,
      scenes: [{ id: "scene1", title: "Main", start: 0, duration: 2 }]
    };
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    window.renderAt = function(t) {
      ctx.fillStyle = "#071324";
      ctx.fillRect(0, 0, 1920, 1080);
      const x = 200 + ((t % 2) / 2) * 1500;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(x, 540, 120, 0, Math.PI * 2);
      ctx.fill();
    };
    window.renderAt(0);
    window.__ready = true;
  </script>
</body>
</html>`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(projectDir, "microstock", "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        profile: "adobe-stock",
        enabled: true,
        preset: "1920x1080",
        fps: 30,
        codec: "h264",
        provenance: { aiDeclared: false, declaredAt: new Date().toISOString() },
        checklist: {
          noLogosOrBrands: true,
          noArtistOrIpNames: true,
          noIdentifiablePeopleOrProperty: true,
          noThirdPartyFontsOrGraphicsWithoutLicense: true,
        },
        licenses: [],
        metadata: {
          title: "E2E Render Smoke Animation",
          keywords: ["animation", "motion", "background", "abstract", "loop"],
          category: "Graphic resources",
        },
      },
      null,
      2
    ),
    "utf8"
  );

  const engineLogs = [];
  const engine = spawn(engineBin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: tempWorkspace,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_WORKSPACE: tempWorkspace,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  engine.stdout.on("data", (d) => engineLogs.push(d.toString()));
  engine.stderr.on("data", (d) => engineLogs.push(d.toString()));

  try {
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await api(baseUrl, "/api/health", { authHeader });
        if (res.ok && (res.json?.data?.healthy ?? res.json?.healthy)) {
          healthy = true;
          break;
        }
      } catch {
        // wait
      }
    }
    if (!healthy) throw new Error(`Engine did not become healthy in time\n${engineLogs.join("")}`);
    console.log("[HEALTH] ok");

    const unauth = await api(baseUrl, "/api/studio/microstock/render", {
      method: "POST",
      body: {},
    });
    const dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
    const badProject = await api(
      baseUrl,
      `/api/studio/microstock/render?directory=${encodeURIComponent(path.join(tempWorkspace, "projects", "missing"))}`,
      { method: "POST", authHeader, body: {} }
    );
    console.log("[NEGATIVE_CHECK]", `unauth=${unauth.status}`, `missingProject=${badProject.status}`);
    if (unauth.status !== 401 || badProject.status < 400) {
      throw new Error("Negative checks did not return expected 401/4xx");
    }

    const t0 = Date.now();
    const renderRes = await api(baseUrl, `/api/studio/microstock/render?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        presetId: "1920x1080",
        duration: 5,
        autoPreflight: true,
      },
    });
    const elapsedMs = Date.now() - t0;
    const data = renderRes.json?.data ?? renderRes.json;
    console.log("[RENDER_API]", renderRes.status, `elapsedMs=${elapsedMs}`, JSON.stringify(data?.render ?? data));

    const stagingPath = data?.render?.stagingPath;
    const mp4Exists = Boolean(stagingPath && fs.existsSync(stagingPath));
    const mp4Size = mp4Exists ? fs.statSync(stagingPath).size : 0;
    console.log("[MP4_OUTPUT]", { mp4Exists, mp4Size, stagingPath });

    if (!renderRes.ok || !data?.render || !mp4Exists || mp4Size < 5000) {
      throw new Error(`Render failed or produced invalid MP4: status=${renderRes.status}`);
    }
    console.log("[E2E_RESULT] PASSED");
  } finally {
    try {
      if (process.platform === "win32" && engine.pid) {
        execSync(`taskkill /F /T /PID ${engine.pid}`, { stdio: "ignore", windowsHide: true });
      } else {
        engine.kill("SIGKILL");
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[E2E_FATAL]", err);
  process.exit(1);
});
