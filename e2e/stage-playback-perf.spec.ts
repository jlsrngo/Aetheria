import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function writePerfInstrumentedFilm(dir: string) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Stage Playback Perf E2E</title></head>
<body style="margin:0;overflow:hidden;background:#090d16;">
<canvas id="stage" width="1920" height="1080"></canvas>
<script>
window.AETHERIA_FILM = { title: "Smooth Perf Test", width: 1920, height: 1080, fps: 30, duration: 5 };
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
window.__renderCallCount = 0;
window.__lastRenderedTime = -1;
window.renderAt = function(t) {
  window.__renderCallCount += 1;
  window.__lastRenderedTime = t;
  ctx.fillStyle = "#090d16";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect((t * 240) % 1720, 440, 200, 200);
};
window.renderAt(0);
window.__ready = true;
</script>
</body>
</html>`
  );
}

test.describe("Studio Stage Imperative Frame Playback Optimization E2E", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
    writePerfInstrumentedFilm(stack.workspaceDir);
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("delivers continuous renderAt(t) updates to iframe via imperative frame subscription without console errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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

    const frame = page.frameLocator('iframe[sandbox="allow-scripts"]');
    await expect(frame.locator("canvas#stage")).toBeVisible({ timeout: 15_000 });

    const before = await frame
      .locator("canvas#stage")
      .evaluate(() => ({
        count: (window as unknown as { __renderCallCount?: number }).__renderCallCount ?? 0,
        t: (window as unknown as { __lastRenderedTime?: number }).__lastRenderedTime ?? 0,
      }));

    // Click Play toggle in timeline
    const playToggle = page.getByTestId("timeline-play-toggle");
    await expect(playToggle).toBeVisible();
    await expect(playToggle).toHaveAttribute("data-state", "paused");
    await playToggle.click();
    await expect(playToggle).toHaveAttribute("data-state", "playing");

    await page.waitForTimeout(700);

    // Pause playback
    await playToggle.click();
    await expect(playToggle).toHaveAttribute("data-state", "paused");

    const after = await frame
      .locator("canvas#stage")
      .evaluate(() => ({
        count: (window as unknown as { __renderCallCount?: number }).__renderCallCount ?? 0,
        t: (window as unknown as { __lastRenderedTime?: number }).__lastRenderedTime ?? 0,
      }));

    // Multiple frames delivered cleanly & time progressed continuously
    expect(after.count - before.count).toBeGreaterThanOrEqual(8);
    expect(after.t).toBeGreaterThan(before.t + 0.3);
    expect(appErrors).toEqual([]);
  });
});
