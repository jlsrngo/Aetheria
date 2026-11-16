import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
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

function findAvailablePort(preferred) {
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
  return assistants.every((m) => {
    const info = m.info ?? m;
    if (!info.time?.completed && !info.error) return false;
    const parts = Array.isArray(m.parts)
      ? m.parts
      : Array.isArray(m.content)
        ? m.content
        : [];
    return !parts.some(
      (p) =>
        (p.type === "tool" || p.type === "tool_use") &&
        (p.state?.status === "running" || p.state?.status === "pending")
    );
  });
}

async function sendAndWaitTurn(baseUrl, authHeader, dirQuery, sessionID, text, modelObj, timeoutMs = 90_000) {
  const prevCount = extractMessages(
    (await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader })).json
  ).filter((m) => (m.info?.role ?? m.role) === "assistant").length;

  const sendRes = await api(baseUrl, `/api/session/${sessionID}/prompt?${dirQuery}`, {
    method: "POST",
    authHeader,
    body: { model: modelObj, prompt: { text } },
  });
  if (!sendRes.ok) {
    throw new Error(`POST prompt failed (${sendRes.status}): ${sendRes.text}`);
  }

  const start = Date.now();
  let lastMsgs = [];
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    const msgRes = await api(baseUrl, `/api/session/${sessionID}/message?${dirQuery}`, { authHeader });
    if (!msgRes.ok) continue;
    const msgs = extractMessages(msgRes.json);
    lastMsgs = msgs;
    const assistants = msgs.filter((m) => (m.info?.role ?? m.role) === "assistant");
    if (assistants.length > prevCount && isTurnFinished(msgs)) {
      await new Promise((r) => setTimeout(r, 200));
      return msgs;
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant turn (msgs=${JSON.stringify(lastMsgs)})`);
}

function writeSseToolCalls(res, toolCalls) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const formatted = toolCalls.map((tc, index) => ({
    index,
    id: tc.id,
    type: "function",
    function: {
      name: tc.name,
      arguments:
        typeof tc.rawArguments === "string"
          ? tc.rawArguments
          : JSON.stringify(tc.arguments),
    },
  }));
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { role: "assistant", tool_calls: formatted }, finish_reason: null }],
    })}\n\n`
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    })}\n\n`
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function writeSseText(res, text, finishReason = "stop") {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { role: "assistant", content: text }, finish_reason: null }],
    })}\n\n`
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: finishReason }],
    })}\n\n`
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function buildValidSolidPng(width, height, r, g, b) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function seedTempFilm(workspaceDir) {
  fs.mkdirSync(path.join(workspaceDir, "script"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "ref"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "ref", "ref_image_1.png"),
    buildValidSolidPng(64, 64, 16, 32, 48)
  );

  fs.writeFileSync(
    path.join(workspaceDir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Harness E2E Film</title></head>
<body style="margin:0;overflow:hidden;background:#0f172a;">
<canvas id="stage" width="320" height="180"></canvas>
<script src="script/scene1.js"></script>
</body>
</html>`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(workspaceDir, "script", "scene1.js"),
    `window.AETHERIA_FILM = { title: "Harness Test", width: 320, height: 180, fps: 30, duration: 4 };
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
window.renderAt = function(t) {
  ctx.fillStyle = "#102030";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(40 + Math.round(t * 45), 45, 70, 70);
};
window.renderAt(0);
window.__ready = true;
`,
    "utf8"
  );
}

function buildUpdatedSceneCode() {
  return `window.AETHERIA_FILM = { title: "Harness Test Updated", width: 320, height: 180, fps: 30, duration: 4 };
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
window.renderAt = function(t) {
  ctx.fillStyle = "#1e1b4b";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(80 + Math.round(t * 40), 90, 42, 0, Math.PI * 2);
  ctx.fill();
};
window.renderAt(0);
window.__ready = true;
`;
}

async function main() {
  const engineBin = resolveEngineBinary();
  const enginePort = await findAvailablePort(4896);
  const mockLlmPort = await findAvailablePort(4996);
  const engineUrl = `http://127.0.0.1:${enginePort}`;
  const mockLlmBase = `http://127.0.0.1:${mockLlmPort}/v1`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-harness-e2e-"));
  const tempHome = path.join(tempRoot, "home");
  const tempConfig = path.join(tempRoot, "config");
  const tempData = path.join(tempRoot, "data");
  const tempWorkspace = path.join(tempRoot, "workspace");
  fs.mkdirSync(path.join(tempConfig, "aetheria-nexus"), { recursive: true });
  fs.mkdirSync(path.join(tempHome, ".config", "aetheria-nexus"), { recursive: true });
  fs.mkdirSync(tempData, { recursive: true });
  fs.mkdirSync(tempWorkspace, { recursive: true });
  seedTempFilm(tempWorkspace);

  const mockConfig = {
    provider: {
      "e2e-mock": {
        options: { baseURL: mockLlmBase, apiKey: "e2e-test-key" },
        models: { "mock-model": { id: "mock-model", name: "Mock Model" } },
      },
    },
  };
  fs.writeFileSync(
    path.join(tempConfig, "aetheria-nexus", "aetheria.json"),
    JSON.stringify(mockConfig, null, 2)
  );
  fs.writeFileSync(
    path.join(tempHome, ".config", "aetheria-nexus", "aetheria.json"),
    JSON.stringify(mockConfig, null, 2)
  );

  const recordedRequests = [];
  let coordStep = 0;
  let subagentStep = 0;

  const mockServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        // ignore
      }
      const sysPrompt = String(body?.messages?.[0]?.content || "");
      const isMotionSubagent = sysPrompt.includes("Motion Designer Subagent");

      if (isMotionSubagent) {
        subagentStep += 1;
        recordedRequests.push({ role: "subagent", step: subagentStep, url: req.url, body });

        if (subagentStep === 1) {
          return writeSseToolCalls(res, [
            {
              id: "sub_call_write_1",
              name: "write",
              arguments: { filePath: "script/scene1.js", content: buildUpdatedSceneCode() },
            },
          ]);
        }
        if (subagentStep === 2) {
          // Premature exit without capture_film_preview -> blocked by Subagent Verification Gate
          return writeSseText(res, "Updated scene1 cleanly without running preview.");
        }
        if (subagentStep === 3) {
          // Still refuses preview -> subagent exits Incomplete (ok: false)
          return writeSseText(res, "Still skipping preview capture.");
        }
        if (subagentStep === 4) {
          // Recovery subagent runs capture_film_preview cleanly
          return writeSseToolCalls(res, [
            {
              id: "sub_call_prev_ok",
              name: "capture_film_preview",
              arguments: { timestamps: [0.5, 2.0], compareToReference: false },
            },
          ]);
        }
        return writeSseText(res, "Subagent verified scene1 via capture_film_preview.");
      }

      coordStep += 1;
      recordedRequests.push({ role: "coordinator", step: coordStep, url: req.url, body });

      if (coordStep === 1) {
        return writeSseToolCalls(res, [
          {
            id: "call_syntax_err",
            name: "edit",
            rawArguments: "{broken_json_scene1",
          },
          {
            id: "call_edit_1",
            name: "edit",
            arguments: { filePath: "script/scene1.js", oldString: "wrong_guess_1", newString: "x" },
          },
          {
            id: "call_prev_1",
            name: "capture_film_preview",
            arguments: { timestamps: [0.5, 2.0], compareToReference: false },
          },
        ]);
      }
      if (coordStep === 2) {
        return writeSseToolCalls(res, [
          {
            id: "call_edit_2",
            name: "edit",
            arguments: { filePath: "script/scene1.js", oldString: "wrong_guess_2", newString: "y" },
          },
          {
            id: "call_prev_2",
            name: "capture_film_preview",
            arguments: { timestamps: [0.5, 2.0], compareToReference: false },
          },
        ]);
      }
      if (coordStep === 3) {
        return writeSseToolCalls(res, [
          {
            id: "call_edit_3",
            name: "edit",
            arguments: { filePath: "script/scene1.js", oldString: "wrong_guess_3", newString: "z" },
          },
          {
            id: "call_prev_3",
            name: "capture_film_preview",
            arguments: { timestamps: [0.5, 2.0], compareToReference: false },
          },
        ]);
      }
      if (coordStep === 4) {
        return writeSseToolCalls(res, [
          {
            id: "call_edit_4",
            name: "edit",
            arguments: { filePath: "script/scene1.js", oldString: "wrong_guess_4", newString: "w" },
          },
          {
            id: "call_prev_4_blocked",
            name: "capture_film_preview",
            arguments: { timestamps: [0.5, 2.0], compareToReference: false },
          },
        ]);
      }
      if (coordStep === 5) {
        // Model tries to falsely claim completion with finish_reason="tool_calls" (empty tool_calls)!
        return writeSseText(res, "Semua perbaikan sudah diterapkan dengan sempurna.", "tool_calls");
      }
      if (coordStep === 6) {
        // After verification gate bounces it back, model recovers by writing script/scene1.js cleanly
        return writeSseToolCalls(res, [
          {
            id: "call_write_ok",
            name: "write",
            arguments: { filePath: "script/scene1.js", content: buildUpdatedSceneCode() },
          },
        ]);
      }
      if (coordStep === 7) {
        return writeSseToolCalls(res, [
          {
            id: "call_prev_5",
            name: "capture_film_preview",
            arguments: { timestamps: [0.5, 2.0], compareToReference: false },
          },
        ]);
      }
      if (coordStep === 8) {
        return writeSseText(res, "Fixed cleanly via write and verified changed preview.");
      }
      if (coordStep === 9) {
        // Turn 2 simulates 401 provider auth error after failing!
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "401 invalid key in test" } }));
        return;
      }
      if (coordStep === 10) {
        return writeSseText(res, "Acknowledged prior failed turn.");
      }
      if (coordStep === 11) {
        // Turn 4: delegate motion-designer task without running preview inside subagent
        return writeSseToolCalls(res, [
          {
            id: "call_sub_incomplete",
            name: "task",
            arguments: {
              subagent_type: "motion-designer",
              description: "Update film",
              prompt: "Update script/scene1.js and run preview.",
              background: false,
            },
          },
        ]);
      }
      if (coordStep === 12) {
        return writeSseText(res, "Subagent reported done.");
      }
      if (coordStep === 13) {
        return writeSseText(res, "Reporting honestly: subagent stopped incomplete without preview.");
      }
      if (coordStep === 14) {
        // Turn 5: recover same subagent bucket cleanly with capture_film_preview
        return writeSseToolCalls(res, [
          {
            id: "call_sub_recover",
            name: "task",
            arguments: {
              subagent_type: "motion-designer",
              description: "Update film",
              prompt: "Run capture_film_preview to verify scene1.",
              background: false,
            },
          },
        ]);
      }
      if (coordStep === 15) {
        return writeSseText(res, "Recovered motion-designer task cleanly.");
      }
      return writeSseText(res, "Cross-turn history confirmed clean.");
    });
  });

  await new Promise((resolve) => mockServer.listen(mockLlmPort, "127.0.0.1", resolve));

  const engineLogs = [];
  const engine = spawn(engineBin, ["serve", "--port", String(enginePort), "--hostname", "127.0.0.1"], {
    cwd: tempWorkspace,
    env: {
      ...process.env,
      // Keep USERPROFILE intact on Windows so headless Edge initializes normally;
      // XDG_CONFIG_HOME & XDG_DATA_HOME completely isolate aetheria.json & sessions-store.json.
      XDG_CONFIG_HOME: tempConfig,
      XDG_DATA_HOME: tempData,
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
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await api(engineUrl, "/api/health", { authHeader });
        if (res.ok && (res.json?.data?.healthy ?? res.json?.healthy)) {
          healthy = true;
          break;
        }
      } catch {
        // retry
      }
    }
    if (!healthy) throw new Error(`Engine failed health check:\n${engineLogs.join("")}`);
    console.log("[HEALTH] ok");

    // Negative check: unauthenticated health request blocked with 401
    const unauth = await fetch(`${engineUrl}/api/health`);
    if (unauth.status !== 401) {
      throw new Error(`Expected 401 on unauth /api/health, got ${unauth.status}`);
    }
    console.log("[UNAUTH_401] ok");

    const modelObj = {
      providerID: "e2e-mock",
      modelID: "mock-model",
      id: "mock-model",
      baseURL: mockLlmBase,
      apiKey: "e2e-test-key",
    };
    const createRes = await api(engineUrl, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: { title: "Harness Resilience E2E", model: modelObj },
    });
    sessionID = createRes.json?.data?.id ?? createRes.json?.id;
    if (!sessionID) throw new Error(`Create session failed: ${createRes.text}`);

    // Turn 1: exercises failure-streak, failed-edit-does-not-reset-preview, unchanged preview,
    // compareToReference override, verification gate block, recovery via write, and changed preview.
    const msgs1 = await sendAndWaitTurn(
      engineUrl,
      authHeader,
      dirQuery,
      sessionID,
      "Fix scene1 animation",
      modelObj
    );
    const assistant1 = msgs1.filter((m) => (m.info?.role ?? m.role) === "assistant").pop();
    const parts1 = assistant1?.parts ?? assistant1?.content ?? [];
    const byId = new Map(parts1.filter((p) => p.type === "tool").map((p) => [p.id, p]));

    const edit3Out = byId.get("call_edit_3")?.state?.structured;
    if (!String(edit3Out?.harnessIntervention || "").includes("HARNESS FAILURE-STREAK ESCALATION")) {
      throw new Error(`Expected failure-streak escalation on 3rd edit, got: ${JSON.stringify(edit3Out)}`);
    }
    console.log("[STREAK_ESCALATION] ok");

    const prev1Out = byId.get("call_prev_1")?.state?.structured;
    if (prev1Out?.compareToReferenceOverridden !== true || prev1Out?.changedSinceLastCapture !== null) {
      throw new Error(`Expected compareToReferenceOverridden=true & changedSinceLastCapture=null on prev1, got: ${JSON.stringify(prev1Out)}`);
    }
    const prev2Out = byId.get("call_prev_2")?.state?.structured;
    if (prev2Out?.changedSinceLastCapture !== false || !String(prev2Out?.unchangedWarning || "").includes("byte-identical")) {
      throw new Error(`Expected changedSinceLastCapture=false & unchangedWarning on prev2, got: ${JSON.stringify(prev2Out)}`);
    }
    console.log("[PREVIEW_UNCHANGED_DETECTION_&_REF_OVERRIDE] ok");

    const prev4BlockedOut = byId.get("call_prev_4_blocked")?.state?.structured;
    if (!String(prev4BlockedOut?.error || "").includes("Repeated identical invocation")) {
      throw new Error(`Expected doom-loop to block 4th identical capture_film_preview after failed edits, got: ${JSON.stringify(prev4BlockedOut)}`);
    }
    console.log("[FAILED_EDIT_NO_LOOP_RESET] ok");

    // Verify Verification Gate intercepted step 5's fake completion (even with finish_reason="tool_calls")
    const gateReq = recordedRequests.find((r) => r.role === "coordinator" && r.step === 6);
    const gateSerialized = JSON.stringify(gateReq?.body?.messages || []);
    if (!gateSerialized.includes("COMPLETION BLOCKED BY VERIFICATION GATE")) {
      throw new Error(`Expected verification gate prompt before step 6, got: ${gateSerialized.slice(-800)}`);
    }
    console.log("[VERIFICATION_GATE_&_TOOL_CALLS_FINISH_GUARD] ok");

    // Verify invalid-JSON syntax error did NOT leave a sticky false-positive verification notice after write succeeded
    const syntaxOut = byId.get("call_syntax_err")?.state?.structured;
    if (syntaxOut?.syntaxError !== true) {
      throw new Error(`Expected syntaxError=true on call_syntax_err, got: ${JSON.stringify(syntaxOut)}`);
    }
    const turn1FinalText = parts1
      .filter((p) => p.type === "text")
      .map((p) => String(p.text || ""))
      .join("\n");
    if (turn1FinalText.includes("unresolved tool failure(s)")) {
      throw new Error(`Unexpected false-positive verification notice in Turn 1 after write recovery: ${turn1FinalText}`);
    }
    console.log("[SYNTAX_ERROR_NO_FALSE_GATE] ok");

    const prev5Out = byId.get("call_prev_5")?.state?.structured;
    if (prev5Out?.ok !== true || prev5Out?.changedSinceLastCapture !== true) {
      throw new Error(`Expected prev5 after successful write to pass & detect change, got: ${JSON.stringify(prev5Out)}`);
    }
    console.log("[WRITE_RECOVERY_&_CHANGED_PREVIEW] ok");

    // Turn 2: fails with 401
    await sendAndWaitTurn(engineUrl, authHeader, dirQuery, sessionID, "Try failing turn", modelObj);

    // Turn 3: check history.rs marked failed Turn 2 explicitly
    await sendAndWaitTurn(engineUrl, authHeader, dirQuery, sessionID, "Continue after failure", modelObj);
    const turn3Req = recordedRequests.find((r) => r.role === "coordinator" && r.step === 10);
    const histSerialized = JSON.stringify(turn3Req?.body?.messages || []);
    if (!histSerialized.includes("FAILED TURN")) {
      throw new Error(`Expected [FAILED TURN ...] marker in Turn 3 history, got: ${histSerialized.slice(-1000)}`);
    }
    console.log("[FAILED_TURN_HISTORY_MARKER] ok");

    // Turn 4: subagent motion-designer skips capture_film_preview -> blocked by Subagent Verification Gate -> Incomplete
    const msgs4 = await sendAndWaitTurn(
      engineUrl,
      authHeader,
      dirQuery,
      sessionID,
      "Delegate motion task to subagent",
      modelObj
    );
    const subGateReq = recordedRequests.find((r) => r.role === "subagent" && r.step === 3);
    const subGateSerialized = JSON.stringify(subGateReq?.body?.messages || []);
    if (!subGateSerialized.includes("SUBAGENT VERIFICATION GATE")) {
      throw new Error(`Expected SUBAGENT VERIFICATION GATE before subagent step 3, got: ${subGateSerialized.slice(-800)}`);
    }
    const allParts4 = msgs4
      .filter((m) => (m.info?.role ?? m.role) === "assistant")
      .flatMap((m) => m.parts ?? m.content ?? []);
    const subIncompleteOut = allParts4.find(
      (p) => p.type === "tool" && p.id === "call_sub_incomplete"
    )?.state?.structured;
    if (subIncompleteOut?.ok !== false || subIncompleteOut?.state !== "incomplete") {
      throw new Error(
        `Expected incomplete subagent result when preview omitted, got: ${JSON.stringify(subIncompleteOut)}`
      );
    }
    console.log("[SUBAGENT_VERIFICATION_GATE] ok");

    // Turn 5: recover same subagent bucket cleanly with capture_film_preview
    const msgs5 = await sendAndWaitTurn(
      engineUrl,
      authHeader,
      dirQuery,
      sessionID,
      "Recover motion subagent",
      modelObj
    );
    const allParts5 = msgs5
      .filter((m) => (m.info?.role ?? m.role) === "assistant")
      .flatMap((m) => m.parts ?? m.content ?? []);
    const subRecoverOut = allParts5.find(
      (p) => p.type === "tool" && p.id === "call_sub_recover"
    )?.state?.structured;
    if (subRecoverOut?.ok !== true || subRecoverOut?.state !== "completed") {
      throw new Error(`Expected completed subagent recovery, got: ${JSON.stringify(subRecoverOut)}`);
    }

    // Turn 6: verify Turn 4's stale UNRESOLVED TOOL ERRORS marker was cleared once Turn 5 recovered the bucket
    await sendAndWaitTurn(engineUrl, authHeader, dirQuery, sessionID, "Check cleaned history", modelObj);
    const turn6Req = recordedRequests[recordedRequests.length - 1];
    const turn6Messages = turn6Req?.body?.messages || [];
    const staleTaskWarnings = turn6Messages.filter((m) => {
      const txt = typeof m?.content === "string" ? m.content : "";
      return txt.includes("UNRESOLVED TOOL ERRORS IN TURN") && txt.includes("subagent:motion-designer:update film");
    });
    if (staleTaskWarnings.length > 0) {
      throw new Error(`Expected cross-turn recovery to suppress stale unresolved subagent marker, found: ${JSON.stringify(staleTaskWarnings)}`);
    }
    console.log("[CROSS_TURN_UNRESOLVED_SUPPRESSION] ok");
    console.log("[E2E_RESULT] PASSED");
  } catch (err) {
    console.error("[E2E_DEBUG] coordStep=", coordStep, "subagentStep=", subagentStep, "recorded=", recordedRequests.length);
    console.error("[E2E_ENGINE_LOGS]", engineLogs.join("").slice(-3000));
    throw err;
  } finally {
    if (sessionID) {
      await api(engineUrl, `/api/session/${sessionID}?${dirQuery}`, {
        method: "DELETE",
        authHeader,
      }).catch(() => {});
    }
    try {
      mockServer.close();
    } catch {
      // ignore
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
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[E2E_FATAL]", err);
  process.exit(1);
});
