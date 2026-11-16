import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_STANDALONE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Christmas Card UI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@700&display=swap" rel="stylesheet" />
  <style>
    @keyframes twinkle { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
    .star { animation: twinkle 2s infinite; }
  </style>
</head>
<body class="bg-slate-950">
  <svg id="main-svg" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1920" height="1080" fill="#071324" />
    <g id="snowflakes"></g>
    <polygon points="960,180 760,680 1160,680" fill="#14532d" />
    <circle class="star" cx="960" cy="170" r="24" fill="#facc15" />
    <text x="960" y="920" text-anchor="middle" fill="#ffffff" font-size="64">Merry Christmas</text>
  </svg>
  <div id="control-panel">
    <button id="btn-play">Play</button>
    <input id="progress-slider" type="range" min="0" max="100" value="0" />
  </div>
  <script>
    function createSnowflakes() {
      const g = document.getElementById("snowflakes");
      for (let i = 0; i < 40; i++) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", String(Math.random() * 1920));
        c.setAttribute("cy", String(Math.random() * 1080));
        c.setAttribute("r", String(2 + Math.random() * 4));
        c.setAttribute("fill", "#ffffff");
        g.appendChild(c);
      }
    }
    createSnowflakes();
    function loop() {
      const t = performance.now() / 1000;
      document.getElementById("progress-slider").value = String((t * 10) % 100);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

function resolveEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const candidates = [
    path.join(REPO_ROOT, "target", "debug", exe),
    path.join(REPO_ROOT, "target", "release", exe),
  ].filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    throw new Error(`Engine binary not found under target/debug or target/release. Run "npm run build:engine" first.`);
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort(preferred = 4396) {
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

async function api(baseUrl, route, { method = "GET", body, authHeader } = {}) {
  const headers = authHeader ? { Authorization: authHeader } : {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json response
  }
  return { ok: res.ok, status: res.status, text, json };
}

async function waitForHealth(baseUrl, authHeader, engineLogs, engineState, timeoutMs = 30_000) {
  const start = Date.now();
  let lastErr = "none";
  while (Date.now() - start < timeoutMs) {
    if (engineState.exited) {
      throw new Error(`Engine exited early with code ${engineState.code}\nLogs:\n${engineLogs.join("")}`);
    }
    try {
      const res = await api(baseUrl, "/api/health", { authHeader });
      const data = res.json?.data ?? res.json;
      if (res.ok && data?.healthy === true) {
        return data;
      }
      lastErr = `status=${res.status} body=${res.text.slice(0, 200)}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for /api/health (lastErr=${lastErr})\nLogs:\n${engineLogs.join("")}`);
}

function chooseModel(modelsPayload) {
  const envProvider = process.env.AETHERIA_TEST_PROVIDER;
  const envModel = process.env.AETHERIA_TEST_MODEL;
  if (envProvider && envModel) {
    return { providerID: envProvider, modelID: envModel };
  }
  const models = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  const preferredOrder = [
    (m) => m.providerID === "local-cli" && m.id === "gemini-2.5-flash",
    (m) => m.providerID === "local-cli" && m.id === "claude-3-5-sonnet",
    (m) => m.providerID === "local-cli" && m.id === "claude-3-7-sonnet",
    (m) => m.providerID === "local-cli",
  ];
  for (const pred of preferredOrder) {
    const found = models.find(pred);
    if (found) {
      return { providerID: found.providerID, modelID: found.id };
    }
  }
  return null;
}

function listFilesRecursive(dir, base = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, base));
    } else {
      results.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }
  return results;
}

function extractMessages(msgPayload) {
  const raw = msgPayload?.data ?? msgPayload;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.messages)) return raw.messages;
  return [];
}

function isTurnFinished(messages) {
  const assistants = messages.filter((m) => (m.info?.role ?? m.role) === "assistant");
  if (assistants.length === 0) return false;
  const last = assistants[assistants.length - 1];
  const info = last.info ?? last;
  if (!info.time?.completed && !info.error) return false;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  return !parts.some(
    (p) => p.type === "tool" && (p.state?.status === "running" || p.state?.status === "pending")
  );
}

async function main() {
  const engineBin = resolveEngineBinary();
  const sampleHtmlPath = process.env.AETHERIA_SAMPLE_HTML;
  const sampleHtml =
    sampleHtmlPath && fs.existsSync(sampleHtmlPath)
      ? fs.readFileSync(sampleHtmlPath, "utf8")
      : DEFAULT_STANDALONE_HTML;

  const port = await findAvailablePort(4396);
  const baseUrl = `http://127.0.0.1:${port}`;
  const authUser = "e2e";
  const authPass = crypto.randomBytes(12).toString("base64url");
  const authHeader = `Basic ${Buffer.from(`${authUser}:${authPass}`).toString("base64")}`;

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-svg-extract-e2e-"));
  const engineLogs = [];
  const engineState = { exited: false, code: null };
  const engine = spawn(engineBin, ["serve", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      AETHERIA_PORT: String(port),
      AETHERIA_ROOT: REPO_ROOT,
      AETHERIA_HEADLESS: "1",
      AETHERIA_DISABLE_OPEN_BROWSER: "1",
      AETHERIA_SERVER_USERNAME: authUser,
      AETHERIA_SERVER_PASSWORD: authPass,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  engine.stdout.on("data", (d) => engineLogs.push(d.toString()));
  engine.stderr.on("data", (d) => engineLogs.push(d.toString()));
  engine.on("exit", (code) => {
    engineState.exited = true;
    engineState.code = code;
  });

  let createdSessionId = null;
  let dirQuery = "";
  try {
    const health = await waitForHealth(baseUrl, authHeader, engineLogs, engineState);
    console.log("[HEALTH]", JSON.stringify(health));

    dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    const modelsRes = await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });
    if (!modelsRes.ok) {
      throw new Error(`GET /api/model failed (${modelsRes.status}): ${modelsRes.text}`);
    }
    const chosen = chooseModel(modelsRes.json);
    if (!chosen) {
      console.error("[BLOCKED] No local-cli or AETHERIA_TEST_PROVIDER/MODEL configured.");
      process.exitCode = 2;
      return;
    }
    console.log("[MODEL]", JSON.stringify(chosen));

    // Negative checks: unauthenticated GET + malformed JSON POST
    const unauthRes = await fetch(`${baseUrl}/api/health`);
    const badJsonRes = await fetch(`${baseUrl}/api/studio/microstock/mode?${dirQuery}`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: "{not-valid-json",
    });
    if (unauthRes.status !== 401 || badJsonRes.status < 400) {
      throw new Error(`Negative checks failed (unauth=${unauthRes.status}, badJson=${badJsonRes.status})`);
    }
    console.log("[NEGATIVE_CHECK]", `unauth=${unauthRes.status} badJson=${badJsonRes.status}`);

    // Pre-seed stale active project (`clay-kit.js`) and stale `ref/ref_report.md` to verify isolation on file upload
    const staleProjDir = path.join(
      tempWorkspace,
      "projects",
      "pakai-style-ini-aja-buat-rapih-dan-rasionya-buat-lanscap",
      "script"
    );
    fs.mkdirSync(staleProjDir, { recursive: true });
    fs.writeFileSync(path.join(staleProjDir, "clay-kit.js"), "// Stale SpongeBob ClayKit\n", "utf8");
    fs.mkdirSync(path.join(tempWorkspace, ".aetheria"), { recursive: true });
    fs.writeFileSync(
      path.join(tempWorkspace, ".aetheria", "active-project.json"),
      JSON.stringify({ project: "pakai-style-ini-aja-buat-rapih-dan-rasionya-buat-lanscap" }, null, 2),
      "utf8"
    );
    fs.mkdirSync(path.join(tempWorkspace, "ref"), { recursive: true });
    fs.writeFileSync(
      path.join(tempWorkspace, "ref", "ref_report.md"),
      "# Stale Reference (ref_pinterest.jpg): Flat vector nightscape lake cabin",
      "utf8"
    );

    // Enable Microstock Mode 'M' (1920x1080 @ 30fps)
    const microRes = await api(baseUrl, `/api/studio/microstock/mode?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { directory: tempWorkspace, enabled: true, preset: "1920x1080", fps: 30 },
    });
    if (!microRes.ok) {
      throw new Error(`POST /api/studio/microstock/mode failed (${microRes.status}): ${microRes.text}`);
    }

    // Create new session
    const sessRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        title: "SVG Extract Render Conversion E2E",
        model: { providerID: chosen.providerID, id: chosen.modelID },
      },
    });
    if (!sessRes.ok) {
      throw new Error(`POST /api/session failed (${sessRes.status}): ${sessRes.text}`);
    }
    const sessionID = (sessRes.json?.data ?? sessRes.json)?.id;
    if (!sessionID) {
      throw new Error(`Missing session id: ${sessRes.text}`);
    }
    createdSessionId = sessionID;
    console.log("[SESSION_CREATED]", sessionID);

    const promptText = "rapihkan buat di render nanti";
    const htmlBase64 = Buffer.from(sampleHtml, "utf8").toString("base64");
    const attachedFiles = [
      {
        name: "animasi_natal_microstock.html",
        uri: `data:text/html;base64,${htmlBase64}`,
        mime: "text/html",
      },
    ];

    const sendRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        prompt: {
          text: promptText,
          files: attachedFiles,
        },
      },
    });
    if (!sendRes.ok && sendRes.status >= 400) {
      throw new Error(`POST message failed (${sendRes.status}): ${sendRes.text}`);
    }

    const pollStart = Date.now();
    const timeoutMs = 360_000;
    let finalMessages = [];
    let settled = false;
    while (Date.now() - pollStart < timeoutMs) {
      await new Promise((r) => setTimeout(r, 3000));
      const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader });
      if (!msgRes.ok) continue;
      const msgs = extractMessages(msgRes.json);
      finalMessages = msgs;
      const elapsedSec = Math.round((Date.now() - pollStart) / 1000);
      console.log(`[POLL ${elapsedSec}s] messages=${msgs.length}`);
      if (isTurnFinished(msgs)) {
        await new Promise((r) => setTimeout(r, 1500));
        settled = true;
        break;
      }
    }

    for (const a of finalMessages.filter((m) => (m.info?.role ?? m.role) === "assistant")) {
      const info = a.info ?? a;
      if (info.error) console.log("[ASSISTANT_ERROR]", JSON.stringify(info.error));
    }

    const files = listFilesRecursive(tempWorkspace);
    console.log("[WORKSPACE_FILES]", JSON.stringify(files));

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    console.log("[FILM_META_API]", filmMetaRes.status, JSON.stringify(filmMeta));

    const manifestRes = await api(baseUrl, `/api/studio/microstock/manifest?${dirQuery}`, { authHeader });
    const manifestData = manifestRes.json?.data ?? manifestRes.json;
    console.log("[MANIFEST_API]", manifestRes.status, JSON.stringify(manifestData?.metadata));

    const preflightRes = await api(baseUrl, `/api/studio/microstock/preflight?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { fps: 30, duration: 10 },
    });
    const preflightData = preflightRes.json?.data ?? preflightRes.json;
    const preflightFailCodes = (preflightData?.findings ?? [])
      .filter((f) => f.severity === "fail")
      .map((f) => f.code);
    console.log("[PREFLIGHT_API]", preflightRes.status, "failCodes=", JSON.stringify(preflightFailCodes));

    const targetProjRel = "projects/animasi-natal-microstock";
    const indexPath = path.join(tempWorkspace, targetProjRel, "index.html");
    const indexContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
    const scriptFiles = files.filter(
      (f) => f.startsWith(`${targetProjRel}/script/`) && f.endsWith(".js")
    );
    const allCode = [
      indexContent,
      ...scriptFiles.map((f) => fs.readFileSync(path.join(tempWorkspace, f), "utf8")),
    ].join("\n");
    const staleIndexCreated = fs.existsSync(
      path.join(
        tempWorkspace,
        "projects/pakai-style-ini-aja-buat-rapih-dan-rasionya-buat-lanscap/index.html"
      )
    );

    const checks = {
      settled,
      hasIndexHtml: fs.existsSync(indexPath),
      staleProjectUntouched: !staleIndexCreated,
      hasRenderAt: /window\.renderAt\s*=|function\s+renderAt/.test(allCode),
      hasReadyFlag: /window\.__ready\s*=/.test(allCode),
      hasFilmMetaInCode: /window\.__filmMeta\s*=/.test(allCode),
      lintValid: filmMeta?.lint?.valid === true,
      landscape1920x1080: filmMeta?.width === 1920 && filmMeta?.height === 1080,
      hasSvg: /<svg[\s>]/i.test(indexContent),
      hasControlPanelInDom: /<div[^>]*id=["']control-panel|<button[^>]*id=["']btn/i.test(indexContent),
      hasTailwindCdnLeftover: /cdn\.tailwindcss\.com/i.test(allCode),
      hasMathRandomLeftover: /Math\.random\s*\(/.test(allCode),
      hasWallClockLeftover: /performance\.now\s*\(|requestAnimationFrame\s*\(|setInterval\s*\(/.test(allCode),
      manifestTitlePopulated: Boolean(manifestData?.metadata?.title?.trim()),
      manifestKeywordsPopulated: Array.isArray(manifestData?.metadata?.keywords) && manifestData.metadata.keywords.length >= 5,
      preflightNotBlockedByTextOrFont:
        !preflightFailCodes.includes("TEXT_IN_COMPOSITION") &&
        !preflightFailCodes.includes("LICENSE_MISSING"),
    };
    console.log("[VERIFICATION_CHECKS]", JSON.stringify(checks, null, 2));

    const postHealth = await api(baseUrl, "/api/health", { authHeader });
    console.log("[POST_HEALTH]", JSON.stringify(postHealth.json?.data ?? postHealth.json));

    const passed =
      checks.settled &&
      checks.hasIndexHtml &&
      checks.staleProjectUntouched &&
      checks.hasRenderAt &&
      checks.hasReadyFlag &&
      checks.lintValid &&
      checks.landscape1920x1080 &&
      checks.hasSvg &&
      !checks.hasControlPanelInDom &&
      !checks.hasTailwindCdnLeftover &&
      !checks.hasMathRandomLeftover &&
      !checks.hasWallClockLeftover &&
      checks.manifestTitlePopulated &&
      checks.manifestKeywordsPopulated &&
      checks.preflightNotBlockedByTextOrFont;

    if (!passed) {
      console.error("[E2E_RESULT] FAILED checks");
      process.exitCode = 1;
    } else {
      console.log("[E2E_RESULT] PASSED");
    }
  } finally {
    if (createdSessionId && dirQuery) {
      await api(baseUrl, `/api/session/${createdSessionId}?${dirQuery}`, {
        method: "DELETE",
        authHeader,
      }).catch(() => {});
    }
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
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exitCode = 1;
});
