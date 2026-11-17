import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const candidates = [
    path.join(REPO_ROOT, "target", "debug", exe),
    path.join(REPO_ROOT, "target", "release", exe),
  ].filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    throw new Error('Engine binary not found. Run "npm run build:engine" first.');
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort(preferred = 4896) {
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort(4896);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-sec-e2e-"));
  const wsA = path.join(tempRoot, "ws-a");
  const wsB = path.join(tempRoot, "ws-b");
  fs.mkdirSync(path.join(wsA, "output"), { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });
  fs.writeFileSync(path.join(wsA, "a.txt"), "alpha workspace", "utf8");
  fs.writeFileSync(path.join(wsA, "output", "a_marker.mp4"), Buffer.from("0123456789ABCDEF"));
  fs.writeFileSync(path.join(wsB, "b.txt"), "beta workspace", "utf8");

  const engineLogs = [];
  const engine = spawn(engineBin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: wsA,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_WORKSPACE: wsA,
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
        const res = await fetch(`${baseUrl}/api/health`, { headers: { Authorization: authHeader } });
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.healthy ?? json?.healthy) {
            healthy = true;
            break;
          }
        }
      } catch {
        // wait
      }
    }
    assert(healthy, `Engine failed healthcheck:\n${engineLogs.join("")}`);

    // 1. Open wsA as active project workspace
    const initRes = await fetch(`${baseUrl}/api/desktop/init-workspace`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: wsA }),
    });
    assert(initRes.ok, `init-workspace failed: ${initRes.status}`);

    // 2. Query /api/file with ?directory=wsB (read query only)
    const listBRes = await fetch(`${baseUrl}/api/file?directory=${encodeURIComponent(wsB)}`, {
      headers: { Authorization: authHeader },
    });
    assert(listBRes.ok, `/api/file for wsB failed: ${listBRes.status}`);
    const listBText = await listBRes.text();
    assert(listBText.includes("b.txt"), `Expected b.txt in wsB listing, got ${listBText}`);

    // 3. E-12 regression guard: ACTIVE_WORKSPACE_ROOT must remain wsA!
    const streamARes = await fetch(`${baseUrl}/api/studio/stream-video?file=a_marker.mp4`, {
      headers: { Authorization: authHeader, Range: "bytes=0-3" },
    });
    assert(
      streamARes.status === 206,
      `Expected active workspace wsA to remain intact after ?directory=wsB query (got status ${streamARes.status})`
    );
    const chunk = Buffer.from(await streamARes.arrayBuffer());
    assert(chunk.toString("utf8") === "0123", `Unexpected stream bytes: ${chunk.toString("utf8")}`);

    // 4. Negative check: traversal via /api/file/content
    const travRes = await fetch(
      `${baseUrl}/api/file/content?directory=${encodeURIComponent(wsA)}&path=${encodeURIComponent("../../escaped.txt")}`,
      { headers: { Authorization: authHeader } }
    );
    assert(travRes.status === 403, `Expected 403 for path traversal, got ${travRes.status}`);

    // 5. Session creation & retrieval round-trip + invalid ID negative check
    const sessCreate = await fetch(`${baseUrl}/api/session?directory=${encodeURIComponent(wsA)}`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Security Isolation E2E" }),
    });
    assert(sessCreate.ok, `Create session failed: ${sessCreate.status}`);
    const sessJson = await sessCreate.json();
    const sid = sessJson?.data?.id ?? sessJson?.id;
    assert(Boolean(sid), `Missing session id in response: ${JSON.stringify(sessJson)}`);

    const missingSess = await fetch(`${baseUrl}/api/session/nonexistent_session_id/prompt`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: { text: "ping" } }),
    });
    assert(missingSess.status >= 400, `Expected 4xx/5xx for missing session, got ${missingSess.status}`);

    console.log("SECURITY_ISOLATION_E2E_PASSED");
  } finally {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      engine.once("exit", done);
      engine.kill("SIGKILL");
      setTimeout(done, 1500);
    });
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error("SECURITY_ISOLATION_E2E_FAILED:", err);
  process.exit(1);
});
