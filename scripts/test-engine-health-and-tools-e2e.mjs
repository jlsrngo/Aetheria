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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const engineBin = resolveEngineBinary();
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const occupiedPort = blocker.address().port;

  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-bind-e2e-"));

  const logs = [];
  // Intentionally request the occupied port to verify graceful ephemeral port fallback (E-24)
  const engine = spawn(engineBin, ["serve", "--port", String(occupiedPort), "--hostname", "127.0.0.1"], {
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
  engine.stdout.on("data", (d) => logs.push(d.toString()));
  engine.stderr.on("data", (d) => logs.push(d.toString()));

  try {
    let actualPort = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const joined = logs.join("");
      const match = joined.match(/Axum API Engine listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        actualPort = Number(match[1]);
        break;
      }
    }
    assert(actualPort && actualPort !== occupiedPort, `Expected ephemeral fallback port away from ${occupiedPort}, got ${actualPort}\n${logs.join("")}`);

    const healthRes = await fetch(`http://127.0.0.1:${actualPort}/api/health`, {
      headers: { Authorization: authHeader },
    });
    assert(healthRes.ok, `Healthcheck failed: ${healthRes.status}`);
    const healthJson = await healthRes.json();
    assert((healthJson?.data?.healthy ?? healthJson?.healthy) === true, `Expected healthy:true, got ${JSON.stringify(healthJson)}`);

    const unauthRes = await fetch(`http://127.0.0.1:${actualPort}/api/health`);
    assert(unauthRes.status === 401, `Expected 401 on unauthenticated healthcheck, got ${unauthRes.status}`);

    console.log("ENGINE_PORT_FALLBACK_AND_HEALTH_E2E_PASSED");
  } finally {
    await new Promise((resolve) => {
      let doneFlag = false;
      const done = () => {
        if (!doneFlag) {
          doneFlag = true;
          resolve();
        }
      };
      engine.once("exit", done);
      engine.kill("SIGKILL");
      setTimeout(done, 1500);
    });
    blocker.close();
    fs.rmSync(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error("ENGINE_PORT_FALLBACK_AND_HEALTH_E2E_FAILED:", err);
  process.exit(1);
});
