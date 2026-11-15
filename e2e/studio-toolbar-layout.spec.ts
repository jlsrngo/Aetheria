import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

function writeMinimalStudioFilm(dir: string) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "script", "scene1.js"),
    `(function(){ AM.registerScene("scene1", { render: function(ctx) { ctx.fillStyle = "#18181b"; ctx.fillRect(0,0,1080,1920); } }); })();\n`
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Toolbar Test Film</title></head>
<body>
<canvas id="stage" width="1080" height="1920"></canvas>
<script src="/script/aetheria-motion.js"></script>
<script src="/script/scene1.js"></script>
<script>
window.__filmMeta = { title: "Toolbar Test Film", width: 1080, height: 1920, fps: 30, duration: 5, scenes: [{ id: "scene1", duration: 5 }] };
window.renderAt = function() {};
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

test.describe("Studio Timeline & Preview Toolbar Layout E2E (Real Engine + Browser)", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    stack = await startLiveStack();
    writeMinimalStudioFilm(stack.workspaceDir);
  });

  test.afterEach(async () => {
    await stack?.stop();
  });

  test("renders square-paused/round-playing play glyph, circular ratio/speed/fps + M logo, and spaced preview bar across all themes", async ({
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

    // Wait for workspace film stage to finish mounting before driving playback controls
    await expect(
      page.frameLocator('iframe[sandbox="allow-scripts"]').locator("canvas#stage")
    ).toBeVisible({ timeout: 20_000 });

    // 1. Play button shape: paused = square, playing = circle
    const playToggle = page.getByTestId("timeline-play-toggle");
    const playShape = page.getByTestId("timeline-play-shape");
    await expect(playToggle).toBeVisible({ timeout: 20_000 });
    await expect(playToggle).toHaveAttribute("data-state", "paused");

    const pausedMetrics = await playShape.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      return { width: r.width, height: r.height, br };
    });
    expect(pausedMetrics.width).toBeGreaterThanOrEqual(8);
    expect(Math.abs(pausedMetrics.width - pausedMetrics.height)).toBeLessThanOrEqual(1);
    expect(pausedMetrics.br).toBeLessThanOrEqual(4);

    await playToggle.click();
    await expect(playToggle).toHaveAttribute("data-state", "playing");

    const playingMetrics = await playShape.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      return { width: r.width, height: r.height, br };
    });
    expect(playingMetrics.width).toBeGreaterThanOrEqual(10);
    expect(Math.abs(playingMetrics.width - playingMetrics.height)).toBeLessThanOrEqual(1);
    expect(playingMetrics.br).toBeGreaterThanOrEqual(playingMetrics.width / 2);

    await playToggle.click();
    await expect(playToggle).toHaveAttribute("data-state", "paused");

    // 2. Timecode pill + circular Ratio, Speed, FPS + circular M logo beside FPS
    const timecodeBadge = page.getByTestId("timeline-timecode-badge");
    const ratioBtn = page.getByTestId("timeline-ratio-btn");
    const speedBtn = page.getByTestId("timeline-speed-btn");
    const fpsBtn = page.getByTestId("timeline-fps-btn");
    const motionLogoBtn = page.getByTestId("timeline-motion-logo-btn");

    for (const loc of [timecodeBadge, ratioBtn, speedBtn, fpsBtn, motionLogoBtn]) {
      await expect(loc).toBeVisible();
    }

    const timecodeBr = await timecodeBadge.evaluate(
      (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
    );
    expect(timecodeBr).toBeGreaterThanOrEqual(999);

    for (const circleBtn of [ratioBtn, speedBtn, fpsBtn, motionLogoBtn]) {
      const m = await circleBtn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        return { width: r.width, height: r.height, br };
      });
      expect(m.width).toBeGreaterThanOrEqual(34);
      expect(Math.abs(m.width - m.height)).toBeLessThanOrEqual(1);
      expect(m.br).toBeGreaterThanOrEqual(m.width / 2);
    }

    // Confirm M logo sits immediately to the right of FPS on the same toolbar row
    const fpsBox = await fpsBtn.boundingBox();
    const mBox = await motionLogoBtn.boundingBox();
    expect(fpsBox).not.toBeNull();
    expect(mBox).not.toBeNull();
    expect(mBox!.x).toBeGreaterThan(fpsBox!.x + fpsBox!.width - 1);
    expect(Math.abs(mBox!.y - fpsBox!.y)).toBeLessThanOrEqual(4);

    // Interactive check: Ratio, Speed, FPS dropdowns + M logo click
    await motionLogoBtn.click();

    await ratioBtn.click();
    await page.getByRole("button", { name: /1:1 Square/i }).click();
    await expect(ratioBtn).toContainText("1:1");

    await speedBtn.click();
    await page.getByRole("button", { name: /1\.5x/i }).click();
    await expect(speedBtn).toContainText("1.5x");

    await fpsBtn.click();
    const fps60Option = page.getByRole("button", { name: /60 FPS/i });
    await expect(fps60Option).toBeVisible();
    await fps60Option.click();
    await expect(fps60Option).toHaveCount(0);

    // 3. Preview controls bar should distribute Left / Center / Right groups (not crammed left with empty right)
    const previewBar = page.getByTestId("studio-preview-controls-bar");
    await expect(previewBar).toBeVisible();
    const barLayout = await previewBar.evaluate((el) => {
      const barRect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const children = Array.from(el.children).map((c) => {
        const r = c.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      });
      return {
        justifyContent: cs.justifyContent,
        barLeft: barRect.left,
        barRight: barRect.right,
        barWidth: barRect.width,
        children,
      };
    });
    expect(barLayout.justifyContent).toBe("space-between");
    expect(barLayout.children.length).toBe(3);
    const [leftGroup, centerGroup, rightGroup] = barLayout.children;
    expect(centerGroup.left - leftGroup.right).toBeGreaterThanOrEqual(10);
    expect(rightGroup.left - centerGroup.right).toBeGreaterThanOrEqual(10);
    expect(barLayout.barRight - rightGroup.right).toBeLessThanOrEqual(24);

    // 4. Verify across dark, light, neobrutalism themes with zero green tokens
    for (const theme of ["dark", "light", "neobrutalism"] as const) {
      await applyTheme(page, theme);
      await expect(ratioBtn).toBeVisible();
      await expect(motionLogoBtn).toBeVisible();
      await expect(previewBar).toBeVisible();
      await assertNoGreenTokens(page);
      if (stack.screenshotDir) {
        await page.screenshot({
          path: path.join(stack.screenshotDir, `studio-toolbar-${theme}.png`),
          fullPage: false,
        });
      }
    }

    // 5. Empty workspace fallback: still renders toolbar controls without crashing, and FPS selector updates live
    const emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-empty-studio-"));
    try {
      await page.goto(`${stack.webUrl}/?folder=${encodeURIComponent(emptyWorkspace)}`);
      await expect(page.getByTestId("timeline-play-toggle")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("timeline-motion-logo-btn")).toBeVisible();
      await expect(page.getByTestId("studio-preview-controls-bar")).toBeVisible();
      await page.getByTestId("timeline-fps-btn").click();
      await page.getByRole("button", { name: /60 FPS/i }).click();
      await expect(page.getByTestId("timeline-fps-btn")).toContainText("60f");
      if (stack.screenshotDir) {
        await page.screenshot({
          path: path.join(stack.screenshotDir, "studio-toolbar-empty.png"),
          fullPage: false,
        });
      }
    } finally {
      fs.rmSync(emptyWorkspace, { recursive: true, force: true });
    }

    expect(appErrors).toEqual([]);
  });
});
