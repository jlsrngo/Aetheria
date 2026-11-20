#!/usr/bin/env node
/**
 * Live-engine E2E test for the OpenCode-Grade Golden Harness Overhaul (Phases H1-H3):
 *   1. Anti-2KB truncation + 1-based line numbers + spill-to-disk (.aetheria/tool-output/).
 *   2. Real regex `grep`, persistent session `.aetheria/scratch/` across bash calls + tail truncation.
 *   3. `codemode` VM sandbox: workspace I/O succeeds; `require('fs')` & `../` escape blocked cleanly.
 *   4. Gemini 2.5 Flash wire parity: `temperature` omitted, `max_tokens` context-fitted,
 *      `Current local time:` absent from `<env>`, redundant `apply_patch` hidden when `edit`+`write`
 *      present, `extra_content.google.thought_signature` replayed, `content: null` on tool-call turn.
 *   5. Required failure paths: `read` Levenshtein "Did you mean", `read` binary NUL rejection,
 *      `grep` invalid regex error, `codemode` sandbox escape rejection — zero engine crash.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLiveStack } from "../e2e/live-stack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

async function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${urlPath}`);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Connection: "close" };
    if (authHeader) headers.Authorization = authHeader;
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload, "utf8");
    }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent: NO_KEEPALIVE_AGENT,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text,
            json,
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function startHarnessVerificationMockLlm() {
  let step = 0;
  const checks = {
    promptCacheDateOnly: false,
    geminiTempOmitted: false,
    maxTokensProvided: false,
    applyPatchHiddenForGemini: false,
    read18kbUntruncatedAndNumbered: false,
    read75kbSpilledToDisk: false,
    spillFilePath: null,
    readDidYouMeanHint: false,
    readBinaryRejected: false,
    grepRegexMatched: false,
    grepInvalidRegexRejected: false,
    bashScratchPersistedAndTailKept: false,
    codemodeWorkspaceWorked: false,
    codemodeEscapeBlocked: false,
    thoughtSignatureReplayed: false,
    toolCallTurnContentNull: false,
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {}

      step += 1;
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const toolNames = tools.map((t) => t?.function?.name).filter(Boolean);
      const sysText = String(messages[0]?.content || "");

      if (step === 1) {
        checks.promptCacheDateOnly =
          sysText.includes("Today's date:") && !sysText.includes("Current local time:");
        checks.geminiTempOmitted = body.temperature === undefined;
        checks.maxTokensProvided = typeof body.max_tokens === "number" && body.max_tokens >= 1024;
        checks.applyPatchHiddenForGemini =
          toolNames.includes("edit") &&
          toolNames.includes("write") &&
          !toolNames.includes("apply_patch");

        // Batch 1: read 18KB, read 75KB, typo read, binary read, regex grep, invalid regex grep, bash write scratch
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "cmpl_h_1",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_read_18kb",
                      type: "function",
                      extra_content: { google: { thought_signature: "sig_gemini_e2e_001" } },
                      function: { name: "read", arguments: JSON.stringify({ filePath: "large_18kb.js" }) },
                    },
                    {
                      id: "call_read_75kb",
                      type: "function",
                      function: { name: "read", arguments: JSON.stringify({ filePath: "huge_75kb.js" }) },
                    },
                    {
                      id: "call_read_typo",
                      type: "function",
                      function: { name: "read", arguments: JSON.stringify({ filePath: "large_18k.js" }) },
                    },
                    {
                      id: "call_read_bin",
                      type: "function",
                      function: { name: "read", arguments: JSON.stringify({ filePath: "binary_blob.bin" }) },
                    },
                    {
                      id: "call_grep_ok",
                      type: "function",
                      function: {
                        name: "grep",
                        arguments: JSON.stringify({ pattern: "function\\s+alpha_\\d+", include: "*.js" }),
                      },
                    },
                    {
                      id: "call_grep_bad",
                      type: "function",
                      function: { name: "grep", arguments: JSON.stringify({ pattern: "[unclosed" }) },
                    },
                    {
                      id: "call_bash_step1",
                      type: "function",
                      function: {
                        name: "bash",
                        arguments: JSON.stringify({
                          command:
                            "python -c \"import os; open(os.path.join(os.environ['AETHERIA_SCRATCH_DIR'], 'token.txt'), 'w').write('PERSIST_TOKEN_99'); print('SCRATCH_WRITTEN')\"",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })
        );
        return;
      }

      if (step === 2) {
        // Verify Gemini wire replay from step 1
        const prevAsst = messages.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
        if (prevAsst) {
          checks.toolCallTurnContentNull = prevAsst.content === null;
          checks.thoughtSignatureReplayed =
            prevAsst.tool_calls?.[0]?.extra_content?.google?.thought_signature ===
            "sig_gemini_e2e_001";
        }

        const toolMsg = (id) =>
          String(messages.find((m) => m.role === "tool" && m.tool_call_id === id)?.content || "");

        const r18 = toolMsg("call_read_18kb");
        checks.read18kbUntruncatedAndNumbered =
          r18.includes("1: function alpha_1()") &&
          r18.includes("360: function alpha_360()") &&
          !r18.includes("Output truncated by harness");

        const r75 = toolMsg("call_read_75kb");
        const spillMatch = r75.match(/\.aetheria\/tool-output\/tool_[^\s'"]+\.txt/);
        checks.read75kbSpilledToDisk =
          r75.includes("Output truncated by harness") && Boolean(spillMatch);
        if (spillMatch) checks.spillFilePath = spillMatch[0];

        const rTypo = toolMsg("call_read_typo");
        checks.readDidYouMeanHint =
          rTypo.includes("Did you mean") && rTypo.includes("large_18kb.js");

        const rBin = toolMsg("call_read_bin");
        checks.readBinaryRejected = rBin.toLowerCase().includes("binary file");

        const gOk = toolMsg("call_grep_ok");
        checks.grepRegexMatched = gOk.includes("alpha_1") && gOk.includes("large_18kb.js");

        const gBad = toolMsg("call_grep_bad");
        checks.grepInvalidRegexRejected = gBad.toLowerCase().includes("invalid regex");

        // Batch 2: bash step 2 (verify scratch persisted + 2200 lines tail truncation),
        // codemode workspace write/read, codemode escape attempt
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "cmpl_h_2",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_bash_step2",
                      type: "function",
                      function: {
                        name: "bash",
                        arguments: JSON.stringify({
                          command:
                            "python -c \"import os; tok=open(os.path.join(os.environ['AETHERIA_SCRATCH_DIR'], 'token.txt')).read().strip(); [print(f'LOG_LINE_{i:04d} padding data chunk') for i in range(2200)]; print(f'FATAL_TAIL_SENTINEL_{tok}')\"",
                        }),
                      },
                    },
                    {
                      id: "call_cm_ok",
                      type: "function",
                      function: {
                        name: "codemode",
                        arguments: JSON.stringify({
                          code: "writeJson('data/cm_ok.json', { ok: true, n: 77 }); return readJson('data/cm_ok.json').n;",
                        }),
                      },
                    },
                    {
                      id: "call_cm_escape",
                      type: "function",
                      function: {
                        name: "codemode",
                        arguments: JSON.stringify({
                          code: "const f = require('fs'); return f.readdirSync('/');",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })
        );
        return;
      }

      // Step 3: inspect batch 2 outputs and finalize cleanly
      const toolMsg = (id) =>
        String(messages.find((m) => m.role === "tool" && m.tool_call_id === id)?.content || "");

      const b2 = toolMsg("call_bash_step2");
      checks.bashScratchPersistedAndTailKept =
        b2.includes("FATAL_TAIL_SENTINEL_PERSIST_TOKEN_99") &&
        b2.includes("Output truncated by harness");

      const cmOk = toolMsg("call_cm_ok");
      checks.codemodeWorkspaceWorked = cmOk.includes("77");

      const cmEsc = toolMsg("call_cm_escape");
      checks.codemodeEscapeBlocked =
        cmEsc.toLowerCase().includes("error") || cmEsc.toLowerCase().includes("not defined");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "cmpl_h_3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "OpenCode-grade golden harness E2E checks complete.",
              },
            },
          ],
        })
      );
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        getChecks: () => ({ ...checks, steps: step }),
      });
    });
  });
}

async function run() {
  const mockLlm = await startHarnessVerificationMockLlm();
  let stack = null;

  try {
    stack = await startLiveStack({
      startWeb: false,
      aetheriaConfig: {
        provider: {
          "mock-gemini": {
            name: "Mock Gemini Provider",
            type: "openai",
            options: { baseURL: mockLlm.baseUrl, apiKey: "sk-mock-gemini" },
            models: {
              "gemini-2.5-flash": {
                name: "Gemini 2.5 Flash Mock",
                vision: true,
                limit: { context: 1000000, output: 65536 },
              },
            },
          },
        },
      },
    });

    const apiBase = stack.engineUrl;
    const authHeader = stack.authHeader;
    const workspaceDir = stack.workspaceDir;
    const dirQuery = `directory=${encodeURIComponent(workspaceDir)}`;
    const modelObj = {
      providerID: "mock-gemini",
      modelID: "gemini-2.5-flash",
      id: "gemini-2.5-flash",
    };

    // 1. Health check
    const health = await api(apiBase, "/api/health", { authHeader });
    if (!health.ok || health.json?.healthy !== true) {
      throw new Error(`Engine health failed: ${health.status} ${health.text}`);
    }

    // 2. Seed test files in isolated temp workspace
    const lines18 = [];
    for (let i = 1; i <= 360; i++) {
      lines18.push(`function alpha_${i}() { return 'payload_chunk_padding_for_18kb_file_${i}'; }`);
    }
    const content18 = lines18.join("\n") + "\n";
    if (content18.length < 15_000) {
      throw new Error(`Expected >=15KB fixture, got ${content18.length}`);
    }
    fs.writeFileSync(path.join(workspaceDir, "large_18kb.js"), content18, "utf8");

    const lines75 = [];
    for (let i = 1; i <= 1600; i++) {
      lines75.push(`// line ${i}: ${"x".repeat(42)}`);
    }
    const content75 = lines75.join("\n") + "\n";
    if (content75.length < 65_000) {
      throw new Error(`Expected >=65KB fixture, got ${content75.length}`);
    }
    fs.writeFileSync(path.join(workspaceDir, "huge_75kb.js"), content75, "utf8");
    fs.writeFileSync(
      path.join(workspaceDir, "binary_blob.bin"),
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x42, 0x43])
    );

    // 3. Create session pointing at mock Gemini 2.5 Flash endpoint
    const sessRes = await api(apiBase, `/api/session?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        title: "OpenCode Harness Overhaul E2E",
        model: modelObj,
      },
    });
    if (!sessRes.ok) {
      throw new Error(`Create session failed: ${sessRes.status} ${sessRes.text}`);
    }
    const sessionId = sessRes.json?.data?.id || sessRes.json?.id;
    if (!sessionId) throw new Error(`Missing session id: ${sessRes.text}`);

    // 4. Send coding prompt triggering GeneralCode profile + mock multi-step tool loop
    const msgRes = await api(apiBase, `/api/session/${sessionId}/prompt?${dirQuery}`, {
      method: "POST",
      authHeader,
      body: {
        model: modelObj,
        prompt: {
          text: "Edit dan periksa file large_18kb.js serta jalankan skrip pengecekan di workspace.",
        },
      },
    });
    if (!msgRes.ok) {
      throw new Error(`Send message failed: ${msgRes.status} ${msgRes.text}`);
    }

    // 5. Wait for turn completion
    const deadline = Date.now() + 90_000;
    let completed = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const [m, jobsRes] = await Promise.all([
        api(apiBase, `/api/session/${sessionId}/message?order=asc&${dirQuery}`, { authHeader }).catch(
          () => null
        ),
        api(apiBase, `/api/session/${sessionId}/jobs`, { authHeader }).catch(() => null),
      ]);
      const list = m?.json?.data ?? m?.json ?? [];
      const assistants = Array.isArray(list)
        ? list.filter((x) => (x.info?.role ?? x.role) === "assistant")
        : [];
      const jobs = jobsRes?.json?.data ?? [];
      const running = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running") : [];
      const latest = assistants[assistants.length - 1];
      if (
        assistants.length > 0 &&
        (latest?.info?.time?.completed || latest?.time?.completed) &&
        running.length === 0
      ) {
        completed = true;
        break;
      }
    }
    if (!completed) {
      throw new Error(`Timed out waiting for turn completion. checks=${JSON.stringify(mockLlm.getChecks())}`);
    }

    const checks = mockLlm.getChecks();
    console.log("E2E checks:", JSON.stringify(checks, null, 2));

    // Verify spill file on disk actually exists and contains full 75KB content
    if (!checks.spillFilePath) {
      throw new Error("Missing spillFilePath for 75KB read");
    }
    const spillAbs = path.join(workspaceDir, checks.spillFilePath);
    if (!fs.existsSync(spillAbs)) {
      throw new Error(`Spill file does not exist on disk: ${spillAbs}`);
    }
    const spilledText = fs.readFileSync(spillAbs, "utf8");
    if (!spilledText.includes("1600: // line 1600:")) {
      throw new Error("Spill file missing full line 1600 content");
    }

    // Verify codemode created data/cm_ok.json
    const cmOut = JSON.parse(fs.readFileSync(path.join(workspaceDir, "data/cm_ok.json"), "utf8"));
    if (cmOut.n !== 77) {
      throw new Error(`Unexpected codemode output file: ${JSON.stringify(cmOut)}`);
    }

    const requiredFlags = [
      "promptCacheDateOnly",
      "geminiTempOmitted",
      "maxTokensProvided",
      "applyPatchHiddenForGemini",
      "read18kbUntruncatedAndNumbered",
      "read75kbSpilledToDisk",
      "readDidYouMeanHint",
      "readBinaryRejected",
      "grepRegexMatched",
      "grepInvalidRegexRejected",
      "bashScratchPersistedAndTailKept",
      "codemodeWorkspaceWorked",
      "codemodeEscapeBlocked",
      "thoughtSignatureReplayed",
      "toolCallTurnContentNull",
    ];
    const failedFlags = requiredFlags.filter((k) => checks[k] !== true);
    if (failedFlags.length > 0) {
      throw new Error(`Failed E2E harness assertions: ${failedFlags.join(", ")}`);
    }

    // Final health check
    const health2 = await api(apiBase, "/api/health", { authHeader });
    if (!health2.ok || health2.json?.healthy !== true) {
      throw new Error(`Post-scenario engine health failed: ${health2.status}`);
    }

    console.log("PASS: OpenCode-grade Golden Harness E2E (15/15 assertions + disk spill + health)");
  } finally {
    await stack?.stop();
    await new Promise((r) => mockLlm.server.close(r));
  }
}

run().catch((err) => {
  console.error("FAIL:", err?.stack || err);
  process.exit(1);
});
