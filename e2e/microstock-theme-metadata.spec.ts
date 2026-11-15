import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function writeSampleFilm(dir: string) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Ocean Waves Motion</title></head>
<body style="margin:0;overflow:hidden;background:#07131e;">
<canvas id="stage" width="1920" height="1080"></canvas>
<script>
window.AETHERIA_FILM = { title: "Ocean Waves Motion", width: 1920, height: 1080, fps: 30, duration: 6 };
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
window.renderAt = function(t) {
  ctx.fillStyle = "#07131e";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect((t * 100) % 1920, 400, 180, 180);
};
window.renderAt(0);
window.__ready = true;
</script>
</body>
</html>`
  );
}

test.describe("Microstock Dynamic Theme Metadata E2E", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
    writeSampleFilm(stack.workspaceDir);
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("starts with empty metadata (no hardcoded placeholder) and dynamically syncs AI-written theme metadata without reload", async ({
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

    const mBtn = page.getByTestId("timeline-motion-logo-btn");
    await expect(mBtn).toBeVisible();
    await mBtn.click();

    await page.getByTestId("activity-bar-microstock-btn").click();
    await expect(page.getByTestId("microstock-sidebar-panel")).toBeVisible();

    const titleInput = page.getByTestId("microstock-title-input");
    const keywordsInput = page.getByTestId("microstock-keywords-input");

    // 1. Fresh project starts empty — zero hardcoded "Abstract Warm Geometric Motion Background Loop"
    await expect(titleInput).toHaveValue("");
    await expect(keywordsInput).toHaveValue("");

    // Complete gate while metadata is still empty: validation banner surfaces missing metadata
    await page.getByTestId("microstock-ai-no").click();
    await page.getByTestId("microstock-check-upscaled").check();
    await page.getByTestId("microstock-check-nologos").check();
    await page.getByTestId("microstock-check-rights").check();
    await page.getByTestId("microstock-check-noref").check();
    await expect(page.getByTestId("microstock-validation-banner")).toContainText(
      "Title is required"
    );

    // 2. Simulate LLM updating microstock/manifest.json on disk for an Ocean Waves theme
    fs.mkdirSync(path.join(stack.workspaceDir, "microstock"), { recursive: true });
    const existingRaw = fs.readFileSync(
      path.join(stack.workspaceDir, "microstock", "manifest.json"),
      "utf-8"
    );
    const existingJson = JSON.parse(existingRaw) as Record<string, unknown>;
    existingJson.metadata = {
      title: "Deep Blue Ocean Caustic Light Waves Seamless Loop",
      keywords: [
        "ocean",
        "water",
        "waves",
        "caustics",
        "blue",
        "underwater",
        "seamless",
        "loop",
      ],
      category: "Nature",
    };
    fs.writeFileSync(
      path.join(stack.workspaceDir, "microstock", "manifest.json"),
      JSON.stringify(existingJson, null, 2)
    );

    // Notify app via file-edited event just like SSE/write tool does
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("aetheria:sse-file-edited", {
          detail: { file: "microstock/manifest.json" },
        })
      );
    });

    // 3. UI immediately reflects the new LLM-generated theme metadata without page reload and clears validation errors
    await expect(titleInput).toHaveValue(
      "Deep Blue Ocean Caustic Light Waves Seamless Loop",
      { timeout: 10_000 }
    );
    await expect(keywordsInput).toHaveValue(
      "ocean, water, waves, caustics, blue, underwater, seamless, loop"
    );
    await expect(page.getByTestId("microstock-check-upscaled")).toBeChecked();
    await expect(page.getByTestId("microstock-check-noref")).toBeChecked();
    await expect(page.getByTestId("microstock-validation-banner")).toHaveCount(0);

    expect(appErrors).toEqual([]);
  });
});
