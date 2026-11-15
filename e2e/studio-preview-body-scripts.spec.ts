import fs from "node:fs";
import path from "node:path";
import { test, expect, type Frame, type Page } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

// Mirrors the Adobe Stock film that rendered blank in Studio: scripts referenced at the end of
// <body>, and the scene grabs the canvas at top level (not inside renderAt / load).
function writeBodyScriptFilm(dir: string, sceneCode: string) {
  fs.mkdirSync(path.join(dir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>canvas{display:block;width:100vw;height:100vh;background:#031f18}</style></head>
<body><canvas id="stage" width="1920" height="1080"></canvas><script src="script/scene1.js"></script><script src="script/film.js"></script></body>
</html>`,
  );
  fs.writeFileSync(path.join(dir, "script", "scene1.js"), sceneCode);
  fs.writeFileSync(
    path.join(dir, "script", "film.js"),
    `(function(){
  window.__filmMeta={title:'Body Script Film',width:1920,height:1080,fps:30,duration:4};
  window.renderAt=function(t){ if(window.BodyScene) window.BodyScene.render(t); };
  window.renderAt(0);
  window.__ready=true;
})();`,
  );
}

const DRAWING_SCENE = `(function(){
  const canvas=document.getElementById('stage');
  const ctx=canvas.getContext('2d');
  window.BodyScene={render:function(t){ ctx.fillStyle='rgb(255,0,0)'; ctx.fillRect(0,0,1920,1080); }};
})();`;

async function findStageFrame(page: Page): Promise<Frame> {
  await expect(page.frameLocator('iframe[sandbox="allow-scripts"]').locator("canvas#stage")).toBeVisible({
    timeout: 20_000,
  });
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
  if (!frame) throw new Error("stage iframe not found");
  return frame;
}

async function centerPixel(frame: Frame): Promise<number[]> {
  return frame.evaluate(() => {
    const c = document.getElementById("stage") as HTMLCanvasElement;
    const d = c.getContext("2d")?.getImageData(960, 540, 1, 1).data;
    return d ? Array.from(d) : [];
  });
}

async function openStudio(page: Page, stack: LiveStack, errors: string[]) {
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("fonts.googleapis.com")) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  await page.addInitScript(
    ({ workspaceDir }: { workspaceDir: string }) => {
      if (window !== window.top) return;
      localStorage.setItem("aetheria_active_folder", workspaceDir);
      localStorage.setItem("aetheria_theme", "dark");
    },
    { workspaceDir: stack.workspaceDir },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${stack.webUrl}/?folder=${encodeURIComponent(stack.workspaceDir)}`);
}

test.describe("Studio preview runs body-referenced scripts after the DOM they use", () => {
  let stack: LiveStack | undefined;

  test.afterEach(async () => {
    await stack?.stop();
    stack = undefined;
  });

  test("scene that grabs the body canvas at top level draws in the preview", async ({ page }) => {
    stack = await startLiveStack();
    writeBodyScriptFilm(stack.workspaceDir, DRAWING_SCENE);
    const errors: string[] = [];
    await openStudio(page, stack, errors);

    const frame = await findStageFrame(page);
    await expect.poll(() => centerPixel(frame), { timeout: 15_000 }).toEqual([255, 0, 0, 255]);
    expect(errors).toEqual([]);
  });

  test("a throwing scene script stays inside the stage without reloading the app", async ({ page }) => {
    stack = await startLiveStack();
    writeBodyScriptFilm(stack.workspaceDir, "(function(){ throw new Error('scene boom'); })();");
    const errors: string[] = [];
    await openStudio(page, stack, errors);

    await page.evaluate(() => {
      (window as unknown as { __noReloadMarker: boolean }).__noReloadMarker = true;
    });
    const frame = await findStageFrame(page);
    await page.waitForTimeout(1500);
    expect(await centerPixel(frame)).toEqual([0, 0, 0, 0]);
    expect(
      await page.evaluate(() => (window as unknown as { __noReloadMarker?: boolean }).__noReloadMarker),
    ).toBe(true);
    // Playwright also reports the sandboxed stage's own uncaught error; only that one is allowed.
    expect(errors).toContain("pageerror: scene boom");
    expect(errors.filter((e) => !e.includes("scene boom"))).toEqual([]);
  });
});
