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

function findAvailablePort(preferred = 4796) {
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
  const parts = Array.isArray(last.parts)
    ? last.parts
    : Array.isArray(last.content)
      ? last.content
      : [];
  return !parts.some(
    (p) =>
      (p.type === "tool" || p.type === "tool_use") &&
      (p.state?.status === "running" || p.state?.status === "pending")
  );
}

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs = 180_000) {
  const prevCount = extractMessages(
    (await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader })).json
  ).filter((m) => (m.info?.role ?? m.role) === "assistant").length;

  const sendRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
    method: "POST",
    authHeader,
    body: {
      model: modelObj,
      prompt: { text },
    },
  });
  if (!sendRes.ok) {
    throw new Error(`POST prompt failed (${sendRes.status}): ${sendRes.text}`);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader });
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
    if (assistants.length > prevCount && isTurnFinished(msgs)) {
      await new Promise((r) => setTimeout(r, 800));
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn`);
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4796);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-scaffold-e2e-"));
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

  const dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
  let sessionID = null;

  try {
    let healthy = false;
    let lastHealthErr = "";
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await api(baseUrl, "/api/health", { authHeader });
        if (res.ok && (res.json?.data?.healthy ?? res.json?.healthy)) {
          healthy = true;
          break;
        }
        lastHealthErr = `status=${res.status} ${res.text}`;
      } catch (e) {
        lastHealthErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (!healthy) throw new Error(`Engine did not become healthy (${lastHealthErr})\n${engineLogs.join("")}`);
    console.log("[HEALTH] ok");

    await api(baseUrl, "/api/providers/local-cli/status", { authHeader });
    await api(baseUrl, `/api/model?${dirQuery}`, { authHeader });

    const unauth = await fetch(`${baseUrl}/api/health`);
    const badSess = await api(baseUrl, `/api/session/missing/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { prompt: { text: "hi" } },
    });
    console.log("[NEGATIVE_CHECK]", `unauth=${unauth.status}`, `badSess=${badSess.status}`);
    if (unauth.status !== 401 || badSess.status < 400) {
      throw new Error("Negative HTTP checks failed");
    }

    const modelObj = { providerID: "local-cli", modelID: "gemini-2.5-flash", id: "gemini-2.5-flash" };
    const createRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Solar System Beat", model: modelObj },
    });
    sessionID = createRes.json?.data?.id ?? createRes.json?.id;
    if (!sessionID) throw new Error(`Missing sessionID: ${createRes.text}`);

    const prompt1 = [
      'Create a 3-scene landscape animation (`1920x1080`, `fps: 30`) titled "Solar System Beat".',
      'First call `film_scaffold` with `title: "Solar System Beat"`, `preset: "landscape"`, and `scenes`: `scene1_sun` (3s, accent `#f59e0b`), `scene2_earth` (3s, accent `#06b6d4`), `scene3_moon` (3s, accent `#a855f7`).',
      'Then edit/write the animation bodies ONLY via relative path `script/scene1.js`, `script/scene2.js`, `script/scene3.js` (do NOT prefix with `projects/...` and do NOT overwrite `index.html`) so each scene draws distinct full-canvas color & animated shapes for its beat.',
      'Finally call `capture_film_preview` with `timestamps: [1.0, 4.0, 7.0]` and `compareToReference: false`.',
    ].join(" ");

    const msgs1 = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, prompt1, modelObj);
    const assistantErr1 = msgs1
      .filter((m) => (m.info?.role ?? m.role) === "assistant")
      .map((m) => (m.info ?? m).error)
      .filter(Boolean);
    if (assistantErr1.length > 0) {
      console.log("[ASSISTANT_ERR_1]", JSON.stringify(assistantErr1));
    }

    const filmMetaRes = await api(baseUrl, `/api/studio/film-meta?${dirQuery}`, { authHeader });
    const filmMeta = filmMetaRes.json?.data ?? filmMetaRes.json;
    console.log("[FILM_META]", JSON.stringify({ htmlPath: filmMeta?.htmlPath, width: filmMeta?.width, height: filmMeta?.height, duration: filmMeta?.duration, lintValid: filmMeta?.lint?.valid, scenes: filmMeta?.scenes?.length }));

    const filmDir = path.dirname(filmMeta?.htmlPath || "");
    const activeProjFile = path.join(tempWorkspace, ".aetheria", "active-project.json");
    console.log("[ACTIVE_PROJ_EXISTS]", fs.existsSync(activeProjFile), "filmDir=", filmDir);
    const hasFilmJson = fs.existsSync(path.join(filmDir, "film.json"));
    const hasManagedHtml = fs.existsSync(path.join(filmDir, "index.html"));
    const rootScriptDir = path.join(tempWorkspace, "script");
    const rootScripts = fs.existsSync(rootScriptDir) ? fs.readdirSync(rootScriptDir) : [];
    const noRootLeak =
      rootScripts.length === 0 &&
      !fs.existsSync(path.join(tempWorkspace, "index.html")) &&
      !fs.existsSync(path.join(tempWorkspace, "film.json"));
    console.log("[ROOT_LEAK_CHECK]", { noRootLeak, rootScripts });
    const scene1Text = fs.readFileSync(path.join(filmDir, "script", "scene1.js"), "utf8");
    const scene2Text = fs.readFileSync(path.join(filmDir, "script", "scene2.js"), "utf8");
    const scene3Text = fs.readFileSync(path.join(filmDir, "script", "scene3.js"), "utf8");

    const previewDir = path.join(filmDir, ".aetheria", "preview");
    const previews = fs.existsSync(previewDir)
      ? fs.readdirSync(previewDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort()
      : [];
    const distinctPreviewSizes = new Set(
      previews.map((f) => fs.statSync(path.join(previewDir, f)).size)
    );
    const distinctPreviewHashes = new Set(
      previews.map((f) => crypto.createHash("sha1").update(fs.readFileSync(path.join(previewDir, f))).digest("hex"))
    );

    // Trigger post-write wiring error check (writing unregistered script/scene9.js)
    const prompt2 =
      'Call `write` on `script/scene9.js` with content `AM.registerScene("scene9", function(ctx){ ctx.fillRect(0,0,10,10); });`. Do not fix it or call `film_scaffold`; simply report the tool result.';
    const msgs2 = await sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, prompt2, modelObj, 60_000);
    const hasWiringRejection = msgs2.some((m) =>
      JSON.stringify(m).includes("UNREGISTERED_SCENE_FILE")
    );

    const checks = {
      hasFilmJson,
      hasManagedHtml,
      noRootLeak,
      width1920: filmMeta?.width === 1920,
      height1080: filmMeta?.height === 1080,
      scenes3: filmMeta?.scenes?.length === 3,
      lintValid: filmMeta?.lint?.valid === true,
      hasAllRegisterScenes:
        scene1Text.includes("scene1_sun") &&
        scene2Text.includes("scene2_earth") &&
        scene3Text.includes("scene3_moon"),
      previewsCount: previews.length,
      previewsDistinct: distinctPreviewHashes.size >= 2,
      distinctPreviewSizesCount: distinctPreviewSizes.size,
      hasWiringRejection,
    };
    console.log("[VERIFICATION_CHECKS]", JSON.stringify(checks, null, 2));

    const passed =
      checks.hasFilmJson &&
      checks.hasManagedHtml &&
      checks.noRootLeak &&
      checks.width1920 &&
      checks.height1080 &&
      checks.scenes3 &&
      checks.lintValid &&
      checks.hasAllRegisterScenes &&
      checks.previewsCount >= 3 &&
      checks.previewsDistinct &&
      checks.hasWiringRejection;

    if (!passed) {
      throw new Error(`Film scaffold E2E failed checks: ${JSON.stringify(checks)}`);
    }
    console.log("[E2E_RESULT] PASSED");
  } finally {
    if (sessionID) {
      await api(baseUrl, `/api/session/${sessionID}?${dirQuery}`, {
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
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[E2E_FATAL]", err);
  process.exit(1);
});
