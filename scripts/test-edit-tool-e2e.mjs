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

function findAvailablePort(preferred = 4696) {
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

function isTurnFinished(messages) {
  const assistants = messages.filter((m) => (m.info?.role ?? m.role) === "assistant");
  if (assistants.length === 0) return false;
  const last = assistants[assistants.length - 1];
  const info = last.info ?? last;
  if (!info.time?.completed && !info.error) return false;
  const parts = Array.isArray(last.parts) ? last.parts : Array.isArray(last.content) ? last.content : [];
  return !parts.some(
    (p) => (p.type === "tool" || p.type === "tool_use") && (p.state?.status === "running" || p.state?.status === "pending")
  );
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4696);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-edit-e2e-"));
  const targetFile = path.join(tempWorkspace, "notes.txt");
  fs.writeFileSync(targetFile, "line 1: alpha\nline 2: old_value\nline 3: omega\n", "utf8");

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

  let sessionID = null;
  const dirQuery = `directory=${encodeURIComponent(tempWorkspace)}`;
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
      throw new Error("Negative checks failed");
    }

    const createRes = await api(baseUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        title: "Edit Tool E2E",
        model: { providerID: "local-cli", id: "gemini-2.5-flash" },
      },
    });
    sessionID = createRes.json?.data?.id ?? createRes.json?.id;
    if (!sessionID) throw new Error(`Missing sessionID: ${createRes.text}`);

    const promptRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: { providerID: "local-cli", modelID: "gemini-2.5-flash", id: "gemini-2.5-flash" },
        prompt: {
          text: 'Use the `edit` tool on `notes.txt` with startLine: 2, endLine: 2, newString: "line 2: updated_value". Do not call any other tools.',
        },
      },
    });
    if (!promptRes.ok) throw new Error(`Prompt failed: ${promptRes.status} ${promptRes.text}`);

    const start = Date.now();
    let settled = false;
    let lastMsgs = [];
    while (Date.now() - start < 60_000) {
      await new Promise((r) => setTimeout(r, 2000));
      const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader });
      if (!msgRes.ok) continue;
      const raw = msgRes.json?.data ?? msgRes.json;
      const msgs = Array.isArray(raw) ? raw : Array.isArray(raw?.messages) ? raw.messages : [];
      lastMsgs = msgs;
      if (msgs.length > 0 && isTurnFinished(msgs)) {
        settled = true;
        break;
      }
    }

    const finalContent = fs.readFileSync(targetFile, "utf8");
    console.log("[FILE_CONTENT]", JSON.stringify(finalContent));
    if (!settled || !finalContent.includes("line 2: updated_value") || finalContent.includes("old_value")) {
      console.log("[ENGINE_LOGS]", engineLogs.join("").slice(-2000));
      console.log("[ALL_MSGS]", JSON.stringify(lastMsgs));
      throw new Error(`Edit tool E2E failed: settled=${settled}, content=${finalContent}`);
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
