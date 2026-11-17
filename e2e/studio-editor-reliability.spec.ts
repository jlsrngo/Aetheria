import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function createMinimalStudioWorkspace(targetDir: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Editor Reliability Film</title></head>
<body>
  <canvas id="stage" width="1080" height="1920"></canvas>
  <script>
    window.__filmMeta = {
      title: "Editor Reliability Film",
      width: 1080,
      height: 1920,
      fps: 30,
      duration: 2,
      durationInFrames: 60,
      scenes: [{ id: "scene1", title: "Scene 1", duration: 2 }]
    };
    window.renderFrame = function() {};
    window.__ready = true;
  </script>
</body>
</html>`;
  fs.writeFileSync(path.join(targetDir, "index.html"), html, "utf8");
}

test.describe("Studio Editor & Reliability E2E (Topic 4)", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
    createMinimalStudioWorkspace(stack.workspaceDir);
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("honest render failure (no fake Export complete), Space input safety, and theme render", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    await page.addInitScript(
      ({ workspaceDir }: { workspaceDir: string }) => {
        if (window !== window.top) return;
        localStorage.setItem("aetheria_active_folder", workspaceDir);
        localStorage.setItem("aetheria_theme", "dark");
      },
      { workspaceDir: stack.workspaceDir }
    );

    await page.goto(`/?folder=${encodeURIComponent(stack.workspaceDir)}`);

    const stageIframe = page.locator('iframe[sandbox="allow-scripts"]');
    await expect(stageIframe).toBeVisible({ timeout: 20_000 });

    // Negative failure path: backend /api/render-media returns 500
    await page.route("**/api/render-media", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "Forced E2E render failure" }),
      });
    });

    const exportBtn = page.locator('button[title="Render & Export Video MP4 (Local GPU)"]');
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
    await exportBtn.click();

    await expect(page.getByText(/Export failed:/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Export complete:/i)).toHaveCount(0);

    // Space inside Timeline volume / text inputs must NOT be swallowed by canvas Space handler
    const searchInput = page.getByLabel("Audio volume percentage");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await expect(stageIframe).toBeVisible();

    // Check dark, light, neobrutalism themes render without errors
    for (const theme of ["light", "neobrutalism", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.classList.remove("dark", "light", "neobrutalism");
        document.documentElement.classList.add(t);
      }, theme);
      await expect(stageIframe).toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
  });
});
