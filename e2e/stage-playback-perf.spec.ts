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
window.AETHERIA_FILM = { title: "Smooth Perf Test", width: 1920, height: 1080, fps: 30, duration: 1.5 };
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

function findHostFfmpeg(): string | undefined {
  if (process.env.AETHERIA_FFMPEG && fs.existsSync(process.env.AETHERIA_FFMPEG)) {
    return process.env.AETHERIA_FFMPEG;
  }
  const localApp = process.env.LOCALAPPDATA || "";
  const capcutRoot = path.join(localApp, "CapCut", "Apps");
  if (fs.existsSync(capcutRoot)) {
    for (const ent of fs.readdirSync(capcutRoot, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const candidate = path.join(capcutRoot, ent.name, "ffmpeg.exe");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  const pkgRoot = path.join(localApp, "Microsoft", "WinGet", "Packages");
  if (fs.existsSync(pkgRoot)) {
    for (const pkg of fs.readdirSync(pkgRoot)) {
      if (!pkg.toLowerCase().includes("ffmpeg")) continue;
      const stack = [path.join(pkgRoot, pkg)];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
          const full = path.join(cur, ent.name);
          if (ent.isDirectory()) stack.push(full);
          else if (ent.isFile() && ent.name.toLowerCase() === "ffmpeg.exe") {
            return full;
          }
        }
      }
    }
  }
  return undefined;
}

test.describe("Studio Stage Imperative Frame Playback Optimization E2E", () => {
  let stack: LiveStack;

  test.beforeEach(async () => {
    const ffmpegBin = findHostFfmpeg();
    stack = await startLiveStack({
      env: ffmpegBin ? { AETHERIA_FFMPEG: ffmpegBin } : {},
    });
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
        previewFlag: Boolean(
          (window as unknown as { __AETHERIA_PREVIEW_STAGE__?: boolean }).__AETHERIA_PREVIEW_STAGE__
        ),
      }));

    // Multiple frames delivered cleanly, preview stage flag active, & time progressed continuously
    expect(after.previewFlag).toBe(true);
    expect(after.count - before.count).toBeGreaterThanOrEqual(8);
    expect(after.t).toBeGreaterThan(before.t + 0.3);

    // Part B: Build Rust Proxy MP4 preview and verify hardware <video> stage activates
    const proxyBtn = page.getByTestId("studio-proxy-preview-btn");
    await expect(proxyBtn).toBeVisible();
    await proxyBtn.click();

    await expect
      .poll(
        async () => {
          const r = await fetch(
            `${stack.engineUrl}/api/studio/proxy-preview?directory=${encodeURIComponent(stack.workspaceDir)}`,
            { headers: { Authorization: stack.authHeader } }
          );
          const j = (await r.json()) as { data?: { state?: string; message?: string } };
          if (j.data?.state === "error") {
            throw new Error(`Proxy build failed on engine: ${j.data.message}`);
          }
          return j.data?.state;
        },
        { timeout: 45_000 }
      )
      .toBe("ready");

    const proxyVideo = page.getByTestId("studio-proxy-video");
    await expect(proxyVideo).toBeVisible({ timeout: 15_000 });
    expect(
      fs.existsSync(path.join(stack.workspaceDir, ".aetheria", "proxy_preview.mp4"))
    ).toBe(true);

    // Negative / failure path: building proxy in an empty folder without index.html returns HTTP 400
    const emptyDir = path.join(stack.workspaceDir, "empty-no-film");
    fs.mkdirSync(emptyDir, { recursive: true });
    const badRes = await fetch(
      `${stack.engineUrl}/api/studio/proxy-preview/build?directory=${encodeURIComponent(emptyDir)}`,
      {
        method: "POST",
        headers: {
          Authorization: stack.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ directory: emptyDir }),
      }
    );
    expect(badRes.status).toBe(400);
    const badJson = (await badRes.json()) as { error?: string };
    expect(badJson.error).toContain("No index.html found");

    expect(appErrors).toEqual([]);
  });
});
