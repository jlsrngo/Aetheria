import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

test.describe("Agent protected built-in runtime guard E2E", () => {
  let stack: LiveStack | undefined;

  test.afterEach(async () => {
    await stack?.stop();
    stack = undefined;
  });

  test("blocks write on script/aetheria-motion.js while allowing normal script/scene1.js writes", async () => {
    const toolOutputs: Record<string, string> = {};
    let turnIndex = 0;

    const scriptedLlm = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (req.url?.endsWith("/models")) {
          res.end(JSON.stringify({ data: [{ id: "e2e-guard", object: "model" }] }));
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
                        id: "call_write_runtime",
                        type: "function",
                        function: {
                          name: "write",
                          arguments: JSON.stringify({
                            filePath: "script/aetheria-motion.js",
                            content: "window.__shadowed = true;",
                          }),
                        },
                      },
                      {
                        id: "call_write_scene",
                        type: "function",
                        function: {
                          name: "write",
                          arguments: JSON.stringify({
                            filePath: "script/scene1.js",
                            content: "window.renderAt = function(t) {}; window.__ready = true;",
                          }),
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
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Guard verified." } }],
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
            "e2e-guard": {
              name: "E2E Guard Provider",
              type: "openai",
              options: { baseURL: `http://127.0.0.1:${addr.port}/v1`, apiKey: "e2e-guard-key" },
              models: { "e2e-guard": { name: "E2E Guard Model" } },
            },
          },
        },
      });
      const live = stack;
      const headers = { "Content-Type": "application/json", Authorization: live.authHeader };
      const dirQs = `directory=${encodeURIComponent(live.workspaceDir)}`;

      const sessRes = await fetch(`${live.engineUrl}/api/session?${dirQs}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Protected Runtime Guard E2E",
          directory: live.workspaceDir,
          model: { providerID: "e2e-guard", id: "e2e-guard" },
        }),
      });
      expect(sessRes.ok).toBe(true);
      const sessJson = await sessRes.json();
      const sessionId = sessJson?.data?.id || sessJson?.id;
      expect(sessionId).toBeTruthy();

      const promptRes = await fetch(
        `${live.engineUrl}/api/session/${encodeURIComponent(sessionId)}/prompt?${dirQs}`,
        { method: "POST", headers, body: JSON.stringify({ prompt: { text: "Create motion script" } }) },
      );
      expect(promptRes.ok).toBe(true);

      await expect
        .poll(() => Object.keys(toolOutputs).length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(2);

      expect(toolOutputs.call_write_runtime).toContain("Protected Built-in Runtime Error");
      expect(fs.existsSync(path.join(live.workspaceDir, "script", "aetheria-motion.js"))).toBe(false);

      const sceneRes = JSON.parse(toolOutputs.call_write_scene) as { ok?: boolean };
      expect(sceneRes.ok).toBe(true);
      expect(fs.existsSync(path.join(live.workspaceDir, "script", "scene1.js"))).toBe(true);
    } finally {
      scriptedLlm.closeAllConnections?.();
      await new Promise<void>((resolve) => scriptedLlm.close(() => resolve()));
    }
  });
});
