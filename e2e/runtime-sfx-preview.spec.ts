import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function writeRuntimeSfxFilm(dir: string, audioEventsExpr: string) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "script", "scene1.js"),
    `(function(){ AM.registerScene("scene1", { render: function(ctx) { ctx.fillStyle = "#141418"; ctx.fillRect(0,0,720,1280); } }); })();\n`
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Runtime SFX Preview Test</title></head>
<body>
<canvas id="stage" width="720" height="1280"></canvas>
<script src="/script/aetheria-motion.js"></script>
<script src="/script/scene1.js"></script>
<script>
window.__filmMeta = { title: "Runtime SFX Preview Test", width: 720, height: 1280, fps: 30, duration: 2, scenes: [{ id: "scene1", duration: 2 }] };
window.__audioEvents = ${audioEventsExpr};
window.renderAt = function() {};
window.__ready = true;
</script>
</body>
</html>`
  );
}

test.describe("Live Preview Runtime SFX (window.__audioEvents) E2E", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("receives aetheria:audioEvents from sandboxed film and triggers Web Audio SFX during live playback", async ({
    page,
  }) => {
    writeRuntimeSfxFilm(
      stack.workspaceDir,
      `[[0.12, "pop", 0.85], [0.38, "whoosh", 0.75], [0.68, "ding", 0.7], [0.95, "fold", 0.7]]`
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    const appErrors: string[] = [];
    page.on("pageerror", (err) => appErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("fonts.googleapis.com")) {
        appErrors.push(`console.error: ${msg.text()}`);
      }
    });

    await page.addInitScript(
      ({ workspaceDir }: { workspaceDir: string }) => {
        if (window !== window.top) return;
        localStorage.setItem("aetheria_active_folder", workspaceDir);
        localStorage.setItem("aetheria_theme", "dark");

        const win = window as unknown as {
          __e2eAudioEventsReceived?: unknown[];
          __e2eWebAudioNodesCreated?: number;
        };
        win.__e2eAudioEventsReceived = [];
        win.__e2eWebAudioNodesCreated = 0;

        window.addEventListener("message", (ev) => {
          if (ev.data && typeof ev.data === "object" && (ev.data as { type?: string }).type === "aetheria:audioEvents") {
            const events = (ev.data as { events?: unknown[] }).events;
            if (Array.isArray(events)) {
              win.__e2eAudioEventsReceived = events;
            }
          }
        });

        const AC = window.AudioContext;
        if (AC && AC.prototype) {
          const origOsc = AC.prototype.createOscillator;
          AC.prototype.createOscillator = function () {
            win.__e2eWebAudioNodesCreated = (win.__e2eWebAudioNodesCreated ?? 0) + 1;
            return origOsc.call(this);
          };
          const origBuf = AC.prototype.createBufferSource;
          AC.prototype.createBufferSource = function () {
            win.__e2eWebAudioNodesCreated = (win.__e2eWebAudioNodesCreated ?? 0) + 1;
            return origBuf.call(this);
          };
        }
      },
      { workspaceDir: stack.workspaceDir }
    );

    await page.goto(`${stack.webUrl}/?folder=${encodeURIComponent(stack.workspaceDir)}`);

    await expect(
      page.frameLocator('iframe[sandbox="allow-scripts"]').locator("canvas#stage")
    ).toBeVisible({ timeout: 20_000 });

    // 1. Verify sandboxed iframe posted window.__audioEvents to parent stage
    await expect
      .poll(
        () =>
          page.evaluate(
            () => ((window as unknown as { __e2eAudioEventsReceived?: unknown[] }).__e2eAudioEventsReceived ?? []).length
          ),
        { timeout: 10_000 }
      )
      .toBe(4);

    // 2. Click Play and verify Web Audio synthesizer nodes are created on time steps
    const playToggle = page.getByTestId("timeline-play-toggle");
    await expect(playToggle).toBeVisible({ timeout: 15_000 });
    await playToggle.click();
    await expect(playToggle).toHaveAttribute("data-state", "playing");

    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { __e2eWebAudioNodesCreated?: number }).__e2eWebAudioNodesCreated ?? 0
          ),
        { timeout: 6_000 }
      )
      .toBeGreaterThanOrEqual(2);

    await playToggle.click();
    expect(appErrors).toEqual([]);
  });

  test("ignores malformed window.__audioEvents gracefully without crashing or console errors", async ({
    page,
  }) => {
    writeRuntimeSfxFilm(
      stack.workspaceDir,
      `[null, "invalid", ["bad", "pop"], [NaN, "whoosh", 1], [-5, "tick", 0.5]]`
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    const appErrors: string[] = [];
    page.on("pageerror", (err) => appErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("fonts.googleapis.com")) {
        appErrors.push(`console.error: ${msg.text()}`);
      }
    });

    await page.addInitScript(
      ({ workspaceDir }: { workspaceDir: string }) => {
        if (window !== window.top) return;
        localStorage.setItem("aetheria_active_folder", workspaceDir);
        localStorage.setItem("aetheria_theme", "dark");
      },
      { workspaceDir: stack.workspaceDir }
    );

    await page.goto(`${stack.webUrl}/?folder=${encodeURIComponent(stack.workspaceDir)}`);

    await expect(
      page.frameLocator('iframe[sandbox="allow-scripts"]').locator("canvas#stage")
    ).toBeVisible({ timeout: 20_000 });

    const playToggle = page.getByTestId("timeline-play-toggle");
    await expect(playToggle).toBeVisible({ timeout: 15_000 });
    await playToggle.click();
    await page.waitForTimeout(450);
    await playToggle.click();

    expect(appErrors).toEqual([]);
  });
});
