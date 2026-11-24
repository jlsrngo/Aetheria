#!/usr/bin/env node
/**
 * Repeatable Phase 4 E2E test: Independent Visual & Motion Auditor + Targeted Revision Guard.
 *
 * Verifies end-to-end against a freshly built debug `aetheria-engine` + real HTTP mock LLM wire test:
 * 1. Live debug engine boots cleanly (`GET /api/health` -> `healthy: true`).
 * 2. Executes the live-wire HTTP OpenAI-compatible Independent Auditor test inside `aetheria-engine`
 *    (`scene_auditor::tests::live_wire_auditor_enforces_zero_tools_separate_prompt_and_persists_history`),
 *    proving over a real TCP/HTTP server that:
 *      - Auditor receives ZERO code-editing tools (`tools` omitted/empty),
 *      - Auditor receives the isolated `INDEPENDENT_AUDITOR_SYSTEM_PROMPT` & vision strip,
 *      - Structured `SceneAuditReport` (`sceneId`, `verdict`, `scores`, `findings[]`, `summary`) is parsed
 *        and persisted to `script/scene1.audit.json`,
 *      - Failure path (malformed auditor output) degrades cleanly without panicking.
 * 3. Verifies `direct_scene_remake` rollback + switch tests pass cleanly with the new auditor integration.
 */

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDebugEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const debugBin = path.join(REPO_ROOT, "target", "debug", exe);
  if (fs.existsSync(debugBin)) return debugBin;
  throw new Error(`Debug engine binary not found at ${debugBin}. Run "npm run build:engine" first.`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

function killProcessTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

async function waitForHealth(baseUrl, authHeader, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok && (await r.json())?.healthy === true) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`Timed out waiting for engine health at ${baseUrl}/api/health`);
}

async function main() {
  const engineBin = resolveDebugEngineBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "phase4-e2e-password";
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`).toString("base64");

  const engineProc = spawn(engineBin, ["serve", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
    },
    stdio: "ignore",
  });

  try {
    console.error("[phase4-e2e] 1/3 waiting for engine health...");
    await waitForHealth(baseUrl, authHeader);
    console.error("[phase4-e2e] 1/3 engine healthy, shutting down engine...");
  } finally {
    killProcessTree(engineProc);
  }

  console.error("[phase4-e2e] 2/3 running scene_auditor live-wire tests...");
  const testRun = spawnSync(
    "cargo",
    [
      "test",
      "--workspace",
      "--lib",
      "scene_auditor::tests::",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
  );
  if (testRun.status !== 0) {
    throw new Error(`scene_auditor live-wire tests failed (status=${testRun.status}, err=${testRun.error}):\n${testRun.stdout}\n${testRun.stderr}`);
  }

  console.error("[phase4-e2e] 3/3 running rollback regression guard test...");
  const rollbackRun = spawnSync(
    "cargo",
    [
      "test",
      "--workspace",
      "--lib",
      "direct_scene_remake::tests::restore_switch_controls_real_checkpoint_rollback_on_regression",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
  );
  if (rollbackRun.status !== 0) {
    throw new Error(`direct_scene_remake rollback test failed (status=${rollbackRun.status}, err=${rollbackRun.error}):\n${rollbackRun.stdout}\n${rollbackRun.stderr}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        engineHealthy: true,
        auditorLiveWireVerified: true,
        rollbackGuardVerified: true,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[phase4-e2e] FAILED:", err);
  process.exit(1);
});
