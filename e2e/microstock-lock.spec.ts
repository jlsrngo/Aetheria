import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

async function startLockTestMockLlm() {
  const capturedCalls: Array<{ step: number; allText: string }> = [];
  let callIndex = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-lock", object: "model" }] }));
        return;
      }

      callIndex += 1;
      const bodyStr = Buffer.concat(chunks).toString("utf8");
      const payload = JSON.parse(bodyStr) as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      const msgs = payload.messages ?? [];
      const allText = msgs.map((m) => JSON.stringify(m.content ?? "")).join("\n");
      capturedCalls.push({ step: callIndex, allText });

      let message: Record<string, unknown>;
      let finishReason = "stop";

      if (callIndex === 1) {
        // Simulate premature announcement without tool calls (must trigger auto-continue)
        message = {
          role: "assistant",
          content: "Sekarang saya akan membuat scene1.js dan index.html secara paralel:",
        };
      } else if (callIndex === 2) {
        // Attempt writing Portrait 1080x1920 while M is locked to 1920x1080 (must flag MICROSTOCK_RATIO_MISMATCH)
        finishReason = "tool_calls";
        message = {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_bad_portrait",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  filePath: "projects/winter-town/index.html",
                  content: `<!DOCTYPE html><html><body><canvas width="1080" height="1920"></canvas><script>window.__filmMeta={title:"Winter",width:1080,height:1920,fps:30,duration:6,scenes:[{id:"s1",duration:6}]};window.renderAt=function(){};window.__ready=true;</script></body></html>`,
                }),
              },
            },
          ],
        };
      } else if (callIndex === 3) {
        // Fix to 1920x1080 Landscape
        finishReason = "tool_calls";
        message = {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_good_landscape",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  filePath: "projects/winter-town/index.html",
                  content: `<!DOCTYPE html><html><body><canvas width="1920" height="1080"></canvas><script>window.__filmMeta={title:"Winter",width:1920,height:1080,fps:30,duration:6,scenes:[{id:"s1",duration:6}]};window.renderAt=function(){};window.__ready=true;</script></body></html>`,
                }),
              },
            },
          ],
        };
      } else {
        message = {
          role: "assistant",
          content: "Selesai 1920x1080.",
        };
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: finishReason, message }],
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    capturedCalls,
    close: async () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe("Microstock Ratio Lock, Folder Reuse & Continuation E2E", () => {
  let stack: LiveStack;
  let mockLlm: Awaited<ReturnType<typeof startLockTestMockLlm>>;

  test.beforeEach(async () => {
    mockLlm = await startLockTestMockLlm();
    stack = await startLiveStack({
      aetheriaConfig: {
        provider: {
          "e2e-mock": {
            name: "E2E Mock Provider",
            type: "openai",
            options: {
              baseURL: mockLlm.url,
              apiKey: "e2e-key",
            },
            models: {
              "mock-lock": { name: "Mock Lock" },
            },
          },
        },
      },
    });
  });

  test.afterEach(async () => {
    await stack?.stop();
    await mockLlm?.close();
  });

  test("preserves M lock across new projects, avoids bogus restyle folders, nudges premature stops, and rejects 1080x1920 portrait", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const appErrors: string[] = [];
    page.on("pageerror", (err) => appErrors.push(err.message));

    await page.addInitScript(
      ({ workspaceDir }: { workspaceDir: string }) => {
        if (window !== window.top) return;
        localStorage.setItem("aetheria_active_folder", workspaceDir);
      },
      { workspaceDir: stack.workspaceDir }
    );

    await page.goto(`${stack.webUrl}/?folder=${encodeURIComponent(stack.workspaceDir)}`);

    // 1. Toggle Microstock M ON in UI (switches to 16:9 Landscape 1920x1080)
    const mBtn = page.getByTestId("timeline-motion-logo-btn");
    const ratioBtn = page.getByTestId("timeline-ratio-btn");
    await expect(mBtn).toBeVisible({ timeout: 20_000 });
    await mBtn.click();
    await expect(mBtn).toHaveAttribute("data-active", "true");
    await expect(ratioBtn).toContainText("16:9");
    await expect
      .poll(async () => {
        const r = await fetch(
          `${stack.engineUrl}/api/studio/microstock/manifest?directory=${encodeURIComponent(stack.workspaceDir)}`,
          { headers: { Authorization: stack.authHeader } }
        );
        const j = (await r.json()) as { data?: { enabled?: boolean } };
        return Boolean(j.data?.enabled);
      })
      .toBe(true);
    await page.getByTestId("activity-bar-microstock-btn").click();
    await expect(page.getByTestId("microstock-sidebar-panel")).toBeVisible();

    // 2. Create project "Winter Town" and confirm it inherits M lock (1920x1080)
    const createProjRes = await fetch(
      `${stack.engineUrl}/api/studio/projects/create?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Winter Town" }),
      }
    );
    expect(createProjRes.ok).toBe(true);

    const inheritedRes = await fetch(
      `${stack.engineUrl}/api/studio/microstock/manifest?directory=${encodeURIComponent(stack.workspaceDir)}&project=winter-town`,
      { headers: { Authorization: stack.authHeader } }
    );
    const inheritedJson = (await inheritedRes.json()) as {
      data?: { enabled?: boolean; preset?: string };
    };
    expect(inheritedJson.data?.enabled).toBe(true);
    expect(inheritedJson.data?.preset).toBe("1920x1080");

    // 3. Send restyle prompt with /mg-soft-clay-story and verify agent turn behavior
    const sesRes = await fetch(
      `${stack.engineUrl}/api/session?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Lock Check",
          model: { providerID: "e2e-mock", id: "mock-lock" },
        }),
      }
    );
    const sesJson = (await sesRes.json()) as { data?: { id?: string } };
    const sessionId = sesJson.data?.id;
    expect(sessionId).toBeTruthy();

    const msgRes = await fetch(
      `${stack.engineUrl}/api/session/${sessionId}/message?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: { providerID: "e2e-mock", id: "mock-lock" },
          prompt: {
            text: "/mg-soft-clay-story pakai style ini aja buat rapih dan rasionya buat lanscape",
          },
          text: "/mg-soft-clay-story pakai style ini aja buat rapih dan rasionya buat lanscape",
        }),
      }
    );
    expect(msgRes.ok).toBe(true);

    // Wait for mock LLM step 4 ("Selesai 1920x1080.")
    await expect.poll(() => mockLlm.capturedCalls.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);

    // Must have injected hard override 1920x1080 over /mg-soft-clay-story
    expect(mockLlm.capturedCalls[0]?.allText).toContain("microstock_hard_override");
    expect(mockLlm.capturedCalls[0]?.allText).toContain("width=1920, height=1080");

    // Step 2 must have received the premature-announcement continuation nudge
    expect(mockLlm.capturedCalls[1]?.allText).toContain(
      "announcing your next action without emitting any tool calls"
    );

    // Step 3 must have received MICROSTOCK_RATIO_MISMATCH after trying 1080x1920
    expect(mockLlm.capturedCalls[2]?.allText).toContain("MICROSTOCK_RATIO_MISMATCH");

    // Restyle prompt must reuse winter-town instead of creating a bogus sentence folder
    expect(fs.existsSync(path.join(stack.workspaceDir, "projects", "winter-town", "index.html"))).toBe(
      true
    );
    expect(
      fs.existsSync(
        path.join(
          stack.workspaceDir,
          "projects",
          "pakai-style-ini-aja-buat-rapih-dan-rasionya-buat-lanscape"
        )
      )
    ).toBe(false);

    expect(appErrors.filter((e) => !e.includes("sandboxed"))).toEqual([]);
  });
});
