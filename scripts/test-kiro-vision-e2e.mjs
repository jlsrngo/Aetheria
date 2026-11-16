import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_IMG =
  "C:/Users/AMD/.gemini/antigravity/brain/c45f00c3-99e0-4e1a-9a15-95af61428086/.user_uploaded/media_1794820133996_8f9c7fd4.jpg";

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

function findAvailablePort(preferred = 4596) {
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

function getAssistantText(msgs) {
  const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
  const last = assistants[assistants.length - 1];
  if (!last) return { finished: false, text: "", error: null };
  const info = last.info ?? last;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  const text = parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  const finished = Boolean(info.time?.completed || info.error);
  return { finished, text, error: info.error ?? null };
}

async function runVisionPromptCase(baseUrl, authHeader, dirQuery, modelID, imgDataUri) {
  const createRes = await api(baseUrl, `/api/session?${dirQuery}`, {
    method: "POST",
    authHeader,
    body: {
      title: `Vision E2E (${modelID})`,
      model: { providerID: "local-cli", modelID },
    },
  });
  if (!createRes.ok) {
    throw new Error(`Create session failed for ${modelID}: ${createRes.status} ${createRes.text}`);
  }
  const sessionID = createRes.json?.data?.id ?? createRes.json?.id;
  if (!sessionID) throw new Error(`Missing sessionID for ${modelID}`);

  try {
    const promptRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        prompt: {
          text: "Answer in 1 short sentence only without calling any tools or creating any files: what main illustration/object is shown inside the chat card on the right side of the attached image?",
          files: [
            {
              name: "earth_ref.jpg",
              uri: imgDataUri,
              mime: "image/jpeg",
            },
          ],
        },
      },
    });
    if (!promptRes.ok) {
      throw new Error(`POST prompt failed for ${modelID}: ${promptRes.status} ${promptRes.text}`);
    }

    const start = Date.now();
    while (Date.now() - start < 90_000) {
      await new Promise((r) => setTimeout(r, 2000));
      const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader });
      if (!msgRes.ok) continue;
      const msgs = extractMessages(msgRes.json);
      const { finished, text, error } = getAssistantText(msgs);
      if (finished) {
        return { sessionID, text, error };
      }
    }
    throw new Error(`Timed out waiting for ${modelID} reply`);
  } finally {
    await api(baseUrl, `/api/session/${sessionID}?${dirQuery}`, {
      method: "DELETE",
      authHeader,
    }).catch(() => {});
  }
}

async function main() {
  const imgPath = process.env.AETHERIA_VISION_IMG || DEFAULT_IMG;
  if (!fs.existsSync(imgPath)) {
    throw new Error(`Reference image not found at ${imgPath}`);
  }
  const imgDataUri = `data:image/jpeg;base64,${fs.readFileSync(imgPath).toString("base64")}`;

  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4596);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-kiro-vision-e2e-"));
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
    if (!healthy) throw new Error(`Engine did not become healthy\n${engineLogs.join("")}`);
    console.log("[HEALTH] ok");

    const dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
    const unauth = await fetch(`${baseUrl}/api/health`);
    const badSession = await api(baseUrl, `/api/session/nonexistent/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { prompt: { text: "hi" } },
    });
    console.log("[NEGATIVE_CHECK]", `unauth=${unauth.status}`, `badSession=${badSession.status}`);
    if (unauth.status !== 401 || badSession.status < 400) {
      throw new Error("Negative checks failed");
    }

    const kiroAutoRes = await runVisionPromptCase(baseUrl, authHeader, dirQuery, "kiro/auto", imgDataUri);
    console.log("[KIRO_AUTO]", JSON.stringify(kiroAutoRes));
    const kiroSawEarth = /\b(earth|globe|planet|bumi)\b/i.test(kiroAutoRes.text);

    const textOnlyRes = await runVisionPromptCase(baseUrl, authHeader, dirQuery, "kiro/deepseek-3.2", imgDataUri);
    console.log("[TEXT_ONLY_AUTO_CAPTION]", JSON.stringify(textOnlyRes));
    const textOnlySawEarth = /\b(earth|globe|planet|bumi)\b/i.test(textOnlyRes.text);

    if (!kiroSawEarth || !textOnlySawEarth) {
      throw new Error(`Vision E2E check failed: kiroSawEarth=${kiroSawEarth}, textOnlySawEarth=${textOnlySawEarth}`);
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
