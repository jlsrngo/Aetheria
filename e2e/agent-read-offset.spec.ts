import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

const SCRIPT = "(function(){\n  'use strict';\n  window.__x = 1;\n})();\n";

test.describe("Agent read tool offset E2E", () => {
  let stack: LiveStack | undefined;

  test.afterEach(async () => {
    await stack?.stop();
    stack = undefined;
  });

  test("read(offset: 1) returns line 1 to the model, and a missing file returns a clear error", async () => {
    const toolOutputs: Record<string, string> = {};
    let turnIndex = 0;

    const scriptedLlm = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (req.url?.endsWith("/models")) {
          res.end(JSON.stringify({ data: [{ id: "e2e-read", object: "model" }] }));
          return;
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const msgs: Array<{ role: string; tool_call_id?: string; content?: unknown }> =
          Array.isArray(payload.messages) ? payload.messages : [];
        for (const m of msgs) {
          if (m.role === "tool" && m.tool_call_id && typeof m.content === "string") {
            toolOutputs[m.tool_call_id] = m.content;
          }
        }
        turnIndex += 1;
        if (turnIndex === 1) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_read_first",
                        type: "function",
                        function: {
                          name: "read",
                          arguments: JSON.stringify({ filePath: "script/scene1.js", offset: 1, limit: 2000 }),
                        },
                      },
                      {
                        id: "call_read_missing",
                        type: "function",
                        function: {
                          name: "read",
                          arguments: JSON.stringify({ filePath: "script/missing.js", offset: 1 }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }
        res.end(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Read verified." } }],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => scriptedLlm.listen(0, "127.0.0.1", () => resolve()));
    const addr = scriptedLlm.address();
    if (!addr || typeof addr === "string") throw new Error("Scripted LLM failed to bind port");

    try {
      stack = await startLiveStack({
        startWeb: false,
        aetheriaConfig: {
          provider: {
            "e2e-read": {
              name: "E2E Read Provider",
              type: "openai",
              options: { baseURL: `http://127.0.0.1:${addr.port}/v1`, apiKey: "e2e-read-key" },
              models: { "e2e-read": { name: "E2E Read Model" } },
            },
          },
        },
      });
      const live = stack;
      fs.mkdirSync(path.join(live.workspaceDir, "script"), { recursive: true });
      fs.writeFileSync(path.join(live.workspaceDir, "script", "scene1.js"), SCRIPT);

      const headers = { "Content-Type": "application/json", Authorization: live.authHeader };
      const dirQs = `directory=${encodeURIComponent(live.workspaceDir)}`;
      const sessRes = await fetch(`${live.engineUrl}/api/session?${dirQs}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Read offset E2E",
          directory: live.workspaceDir,
          model: { providerID: "e2e-read", id: "e2e-read" },
        }),
      });
      expect(sessRes.ok).toBe(true);
      const sessJson = await sessRes.json();
      const sessionId = sessJson?.data?.id || sessJson?.id;
      expect(sessionId).toBeTruthy();

      const promptRes = await fetch(
        `${live.engineUrl}/api/session/${encodeURIComponent(sessionId)}/prompt?${dirQs}`,
        { method: "POST", headers, body: JSON.stringify({ prompt: { text: "Read scene1.js" } }) },
      );
      expect(promptRes.ok).toBe(true);

      await expect
        .poll(() => Object.keys(toolOutputs).length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(2);

      const first = JSON.parse(toolOutputs.call_read_first) as { content?: string; offset?: number };
      expect(first.content?.startsWith("(function(){")).toBe(true);
      expect(first.offset).toBe(1);

      const missing = toolOutputs.call_read_missing;
      expect(missing).toMatch(/error/i);
      expect(missing).not.toContain("(function(){");
    } finally {
      scriptedLlm.closeAllConnections?.();
      await new Promise<void>((resolve) => scriptedLlm.close(() => resolve()));
    }
  });
});
