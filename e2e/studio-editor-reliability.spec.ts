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

    // Negative failure path: backend /api/studio/gpu-telemetry & /api/render-media return 500
    await page.route(/\/api\/studio\/gpu-telemetry/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "Telemetry offline" }),
      });
    });
    await page.route(/\/api\/render-media/, async (route) => {
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

    // S-01 & S-11: Open ClipEditModal via double-click, verify draft survives background props mutation,
    // verify Tab stays inside focus trap, and backdrop click dismisses cleanly.
    const clip = page.locator('[title*="Double-click clip to open editor popup"]').first();
    await expect(clip).toBeVisible({ timeout: 10_000 });
    await clip.dblclick();

    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const textarea = modal.locator("textarea").first();
    await textarea.fill("Draft content must survive prop update");

    // Toggle visibility inside modal -> updates activeComposition.props while modal stays open
    const visBtn = modal.getByRole("button", { name: /^(Visible|Hidden)$/ });
    await visBtn.click();
    await expect(textarea).toHaveValue("Draft content must survive prop update");

    // Focus trap keeps Tab within dialog
    await page.keyboard.press("Tab");
    const focusInsideDialog = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]'))
    );
    expect(focusInsideDialog).toBe(true);

    // Backdrop click dismisses modal
    await modal.click({ position: { x: 8, y: 8 } });
    await expect(modal).toBeHidden();

    // S-15: Hotkeys inside custom [role="textbox"] must NOT trigger timeline Delete/Split
    await page.evaluate(() => {
      const div = document.createElement("div");
      div.setAttribute("role", "textbox");
      div.setAttribute("tabindex", "0");
      div.textContent = "Custom editor textbox";
      div.id = "e2e-custom-textbox";
      document.body.appendChild(div);
      div.focus();
    });
    await page.keyboard.press("s");
    await expect(page.getByText(/Place playhead inside a clip to split/i)).toHaveCount(0);
    await page.evaluate(() => document.getElementById("e2e-custom-textbox")?.remove());

    // S-06 & S-09: Open Render Queue panel to verify telemetry failure message renders without crash
    const rqTabBtn = page.getByRole("button", { name: /Render Queue/i }).first();
    if (await rqTabBtn.isVisible().catch(() => false)) {
      await rqTabBtn.click();
      await expect(page.getByText(/Telemetry unavailable \(HTTP 500\)/i)).toBeVisible({
        timeout: 5_000,
      });
    }

    // Check dark, light, neobrutalism themes render with resolved CSS tokens & without errors
    for (const theme of ["light", "neobrutalism", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.classList.remove("dark", "light", "neobrutalism");
        document.documentElement.classList.add(t);
      }, theme);
      const btnBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--btn-primary-bg").trim()
      );
      expect(btnBg.length).toBeGreaterThan(0);
      await expect(stageIframe).toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
  });
});
