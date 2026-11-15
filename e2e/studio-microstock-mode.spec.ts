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
<head><meta charset="utf-8"><title>Microstock Mode Test</title></head>
<body style="margin:0;overflow:hidden;background:#0f172a;">
<canvas id="stage" width="1080" height="1920"></canvas>
<script>
window.AETHERIA_FILM = { title: "Warm Abstract Motion", width: 1080, height: 1920, fps: 30, duration: 6 };
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
window.renderAt = function(t) {
  const phase = (t / 6) * Math.PI * 2;
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
      const cs = getComputedStyle(el);
      for (const prop of ["color", "borderTopColor", "backgroundColor"] as const) {
        const val = cs[prop];
        if (
          val === "rgb(16, 185, 129)" ||
          val === "rgb(52, 211, 153)" ||
          val === "rgb(5, 150, 105)" ||
          val === "rgb(34, 197, 94)"
        ) {
          found.push(`${prop}: ${val}`);
        }
      }
    }
    return found.slice(0, 10);
  });
  expect(violations).toEqual([]);
}

test.describe("Studio M Button Adobe Stock Microstock Mode E2E", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
    writeDeterministicMicrostockFilm(stack.workspaceDir);
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("clicking M switches Studio in-place from 9:16 to 16:9 Adobe Stock mode, enforces AI/checklist gate, and syncs manifest across themes", async ({
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
    const ratioBtn = page.getByTestId("timeline-ratio-btn");

    await expect(mBtn).toBeVisible();
    await expect(mBtn).toHaveAttribute("data-active", "false");
    await expect(ratioBtn).toContainText("9:16");

    // 1. Click M -> stays in same Studio UI, switches ratio to 16:9, activates M, opens popover
    await mBtn.click();
    await expect(mBtn).toHaveAttribute("data-active", "true");
    await expect(ratioBtn).toContainText("16:9");

    const popover = page.getByTestId("microstock-toolbar-popover");
    await expect(popover).toBeVisible();

    // Verify ratio dropdown restricts 4:5 when in Microstock mode
    await ratioBtn.click();
    await expect(page.getByText("16:9 Landscape")).toBeVisible();
    await expect(page.getByText("4:5 Portrait")).toHaveCount(0);
    await ratioBtn.click();

    // 2. Negative path: validation banner shows AI_DECLARATION_MISSING before user selects AI disclosure
    const validationBanner = page.getByTestId("microstock-validation-banner");
    await expect(validationBanner).toBeVisible();
    await expect(validationBanner).toContainText("AI_DECLARATION_MISSING");

    // 3. Complete AI disclosure + 4-item compliance checklist
    await page.getByTestId("microstock-ai-no").click();
    await page.getByTestId("microstock-check-upscaled").check();
    await page.getByTestId("microstock-check-nologos").check();
    await page.getByTestId("microstock-check-rights").check();
    await page.getByTestId("microstock-check-noref").check();

    await expect(validationBanner).toHaveCount(0);

    // 4. Verify zero green/emerald tokens across all 3 themes while popover is open
    for (const theme of ["dark", "light", "neobrutalism"] as const) {
      await applyTheme(page, theme);
      await assertNoGreenTokens(page);
    }

    // 5. Verify backend manifest was updated via live engine API
    const manifestRes = await fetch(
      `${stack.engineUrl}/api/studio/microstock/manifest?directory=${encodeURIComponent(stack.workspaceDir)}`,
      {
        headers: { Authorization: stack.authHeader },
      }
    );
    expect(manifestRes.ok).toBe(true);
    const manifestJson = (await manifestRes.json()) as {
      data?: {
        enabled?: boolean;
        preset?: string;
        provenance?: { aiDeclared?: boolean };
        checklist?: {
          noLogosOrBrands?: boolean;
          noArtistOrIpNames?: boolean;
          noIdentifiablePeopleOrProperty?: boolean;
          noThirdPartyFontsOrGraphicsWithoutLicense?: boolean;
        };
      };
    };
    expect(manifestJson.data?.enabled).toBe(true);
    expect(manifestJson.data?.preset).toBe("1920x1080");
    expect(manifestJson.data?.provenance?.aiDeclared).toBe(false);
    expect(manifestJson.data?.checklist?.noLogosOrBrands).toBe(true);

    // 6. Toggle M back OFF via the switch button -> returns to 9:16
    await page.getByTestId("microstock-mode-switch-btn").click();
    await expect(mBtn).toHaveAttribute("data-active", "false");
    await expect(ratioBtn).toContainText("9:16");

    expect(appErrors).toEqual([]);
  });
});
