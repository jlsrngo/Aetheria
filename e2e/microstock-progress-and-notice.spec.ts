import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function writeDeterministicMicrostockFilm(dir: string) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Progress & Notice E2E</title></head>
<body style="margin:0;overflow:hidden;background:#0f172a;">
<canvas id="stage" width="1920" height="1080"></canvas>
<script>
window.AETHERIA_FILM = { title: "Christmas Gold Motion", width: 1920, height: 1080, fps: 30, duration: 5 };
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
window.renderAt = function(t) {
  const phase = (t / 5) * Math.PI * 2;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(960 + Math.cos(phase) * 240, 540 + Math.sin(phase) * 140, 120, 0, Math.PI * 2);
  ctx.fill();
};
window.renderAt(0);
window.__ready = true;
</script>
</body>
</html>`
  );
}

async function applyTheme(page: Page, theme: "dark" | "light" | "neobrutalism") {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.classList.remove("light", "dark", "neobrutalism");
    if (t === "neobrutalism") {
      document.documentElement.classList.add("light", "neobrutalism");
    } else {
      document.documentElement.classList.add(t);
    }
  }, theme);
}

async function assertNoGreenTokens(page: Page) {
  const violations = await page.evaluate(() => {
    const classRe = /\b(?:bg|text|border|ring|accent|stroke|fill|from|to|via)-(?:emerald|green|teal)-/;
    const found: string[] = [];
    for (const el of document.querySelectorAll("*")) {
      const cls = typeof el.className === "string" ? el.className : "";
      if (cls && classRe.test(cls)) {
        found.push(`<${el.tagName.toLowerCase()}> ${cls}`);
      }
    }
    return found.slice(0, 10);
  });
  expect(violations).toEqual([]);
}

test.describe("Microstock Centered Notifications, Checkbox Persistence & Render Progress Bar E2E", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
    writeDeterministicMicrostockFilm(stack.workspaceDir);
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("shows centered gate modal (never tiny bottom toast) across themes and preserves rapid checkbox clicks against live engine", async ({
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

    const mBtn = page.getByTestId("timeline-motion-logo-btn");
    await expect(mBtn).toBeVisible();
    await mBtn.click();

    await page.getByTestId("activity-bar-microstock-btn").click();
    await expect(page.getByTestId("microstock-sidebar-panel")).toBeVisible();

    // 1. Click Render + Check while AI Disclosure + 4 checks are still incomplete
    await page.getByTestId("microstock-render-btn").click();

    const modal = page.getByTestId("center-notice-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("center-notice-title")).toContainText(
      "Compliance Gate Incomplete"
    );
    await expect(page.getByTestId("center-notice-details")).toContainText(
      "Generative AI disclosure"
    );
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    // Verify modal is centered in the 1440x900 viewport
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      expect(Math.abs(centerX - 720)).toBeLessThan(120);
      expect(Math.abs(centerY - 450)).toBeLessThan(120);
    }

    // Verify no green/emerald classes across all 3 themes while centered modal is visible
    for (const theme of ["dark", "light", "neobrutalism"] as const) {
      await applyTheme(page, theme);
      await assertNoGreenTokens(page);
    }
    await applyTheme(page, "dark");

    await page.getByTestId("center-notice-close").click();
    await expect(modal).toHaveCount(0);

    // 2. Rapidly click AI Disclosure + all 4 checkboxes without waiting between clicks
    await page.getByTestId("microstock-ai-no").click();
    await page.getByTestId("microstock-check-upscaled").click();
    await page.getByTestId("microstock-check-nologos").click();
    await page.getByTestId("microstock-check-rights").click();
    await page.getByTestId("microstock-check-noref").click();

    // Wait for serialized backend writes to settle and verify zero checkboxes un-checked
    await page.waitForTimeout(600);
    await expect(page.getByTestId("microstock-check-upscaled")).toBeChecked();
    await expect(page.getByTestId("microstock-check-nologos")).toBeChecked();
    await expect(page.getByTestId("microstock-check-rights")).toBeChecked();
    await expect(page.getByTestId("microstock-check-noref")).toBeChecked();

    // Verify persisted state on live Rust engine
    const manifestRes = await fetch(
      `${stack.engineUrl}/api/studio/microstock/manifest?directory=${encodeURIComponent(stack.workspaceDir)}`,
      { headers: { Authorization: stack.authHeader } }
    );
    expect(manifestRes.ok).toBe(true);
    const manifestJson = (await manifestRes.json()) as {
      data?: {
        provenance?: { aiDeclared?: boolean | null };
        checklist?: {
          noLogosOrBrands?: boolean;
          noArtistOrIpNames?: boolean;
          noIdentifiablePeopleOrProperty?: boolean;
          noThirdPartyFontsOrGraphicsWithoutLicense?: boolean;
        };
      };
    };
    expect(manifestJson.data?.provenance?.aiDeclared).toBe(false);
    expect(manifestJson.data?.checklist?.noLogosOrBrands).toBe(true);
    expect(manifestJson.data?.checklist?.noArtistOrIpNames).toBe(true);
    expect(manifestJson.data?.checklist?.noIdentifiablePeopleOrProperty).toBe(true);
    expect(
      manifestJson.data?.checklist?.noThirdPartyFontsOrGraphicsWithoutLicense
    ).toBe(true);

    expect(appErrors).toEqual([]);

    // 3. Negative backend path: break window.renderAt so live engine pre-render gate fails cleanly (400 Bad Request)
    fs.writeFileSync(
      path.join(stack.workspaceDir, "index.html"),
      `<!DOCTYPE html><html><body><canvas id="stage" width="1920" height="1080"></canvas><script>console.log("no renderAt");</script></body></html>`
    );

    const pageErrorsBefore400 = appErrors.length;
    await page.getByTestId("microstock-render-btn").click();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toHaveAttribute("data-severity", "error");
    await expect(page.getByTestId("center-notice-title")).toContainText(
      "Adobe Stock Render Blocked"
    );
    await page.getByTestId("center-notice-close").click();

    const extraErrors = appErrors
      .slice(pageErrorsBefore400)
      .filter((msg) => !msg.includes("400 (Bad Request)"));
    expect(extraErrors).toEqual([]);
  });

  test("displays live progress bar ticking via /api/render-progress and opens centered completion notice", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let capturedRenderId = "";
    let pollCount = 0;

    await page.route("**/api/render-progress**", async (route) => {
      const url = new URL(route.request().url());
      const reqId = url.searchParams.get("renderId") || capturedRenderId;
      pollCount += 1;
      const pct = pollCount === 1 ? 40 : 80;
      const done = pollCount === 1 ? 60 : 120;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          renderId: reqId,
          compositionId: "AdobeStock-1920x1080",
          status: "rendering",
          percent: pct,
          renderedFrames: done,
          totalFrames: 150,
          outputPath: "output/microstock/staging/christmas.mp4",
          error: null,
        }),
      });
    });

    await page.route("**/api/studio/microstock/render**", async (route) => {
      const payload = route.request().postDataJSON() as { renderId?: string };
      capturedRenderId = payload.renderId || "";
      // Hold long enough for 2 progress polls at 300ms interval
      await new Promise((r) => setTimeout(r, 950));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            renderId: capturedRenderId,
            render: {
              renderId: capturedRenderId,
              stagingPath: "output/microstock/staging/christmas.mp4",
              readyPath: "output/microstock/ready/christmas.mp4",
              sizeBytes: 123456,
              width: 1920,
              height: 1080,
              fps: 30,
              durationSec: 5,
              codec: "h264",
              container: "mp4",
              createdAt: Date.now(),
            },
            preflight: {
              status: "pass",
              checkedAt: Date.now(),
              items: [],
              promotedPath: "output/microstock/ready/christmas.mp4",
            },
          },
        }),
      });
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
    await page.getByTestId("timeline-motion-logo-btn").click();
    await page.getByTestId("activity-bar-microstock-btn").click();
    await expect(page.getByTestId("microstock-sidebar-panel")).toBeVisible();

    await page.getByTestId("microstock-ai-no").click();
    await page.getByTestId("microstock-check-upscaled").check();
    await page.getByTestId("microstock-check-nologos").check();
    await page.getByTestId("microstock-check-rights").check();
    await page.getByTestId("microstock-check-noref").check();

    await page.getByTestId("microstock-render-btn").click();

    const progressBox = page.getByTestId("microstock-render-progress");
    const progressPct = page.getByTestId("microstock-render-progress-pct");
    await expect(progressBox).toBeVisible({ timeout: 5_000 });
    await expect(progressPct).toContainText(/40%|80%/, { timeout: 5_000 });

    const modal = page.getByTestId("center-notice-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toHaveAttribute("data-severity", "success");
    await expect(page.getByTestId("center-notice-title")).toContainText(
      "Adobe Stock Render Complete"
    );
    await expect(progressPct).toContainText("100%");
    expect(capturedRenderId).toMatch(/^msrnd_/);
    expect(pollCount).toBeGreaterThanOrEqual(1);
    await assertNoGreenTokens(page);
  });
});
