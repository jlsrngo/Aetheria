import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { startLiveStack, type LiveStack } from "./live-stack.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

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

test.describe("Skill Manager Modal (/add skill) E2E (Real Engine + Browser)", () => {
  let stack: LiveStack;
  let draftTempDir = "";
  const testSlug = `e2e-ui-skill-${Date.now()}`;
  const installedSkillDir = path.join(REPO_ROOT, ".aetheria", "skills", testSlug);

  test.beforeEach(async () => {
    stack = await startLiveStack();
    draftTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-ui-skill-draft-"));
    fs.mkdirSync(path.join(draftTempDir, "examples", "script"), { recursive: true });
    fs.writeFileSync(
      path.join(draftTempDir, "SKILL.md"),
      `---\nname: ${testSlug}\ndescription: UI E2E imported declarative motion skill.\n---\n# ${testSlug}\n\nClean editorial test skill.\n`
    );
    fs.writeFileSync(
      path.join(draftTempDir, "examples", "kit.json"),
      JSON.stringify({ name: testSlug, scripts: ["script/demo-kit.js"] }, null, 2)
    );
    fs.writeFileSync(
      path.join(draftTempDir, "examples", "script", "demo-kit.js"),
      "window.DemoKit = {};\n"
    );
  });

  test.afterEach(async () => {
    fs.rmSync(installedSkillDir, { recursive: true, force: true });
    if (draftTempDir) fs.rmSync(draftTempDir, { recursive: true, force: true });
    await stack?.stop();
  });

  test("opens /add skill modal, validates failure path, imports package, inspects all 3 themes, and deletes custom skill while protecting built-ins", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const appErrors: string[] = [];
    let expectedNegative400Count = 0;
    page.on("pageerror", (err) => appErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("fonts.googleapis.com")) {
        if (msg.text().includes("status of 400")) {
          expectedNegative400Count += 1;
        } else {
          appErrors.push(`console.error: ${msg.text()}`);
        }
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

    // Open /add skill via chat slash command
    const chatBox = page.locator("textarea").first();
    await expect(chatBox).toBeVisible({ timeout: 20_000 });
    await chatBox.click();
    await chatBox.fill("/add");
    const addSkillCmd = page.getByRole("button", { name: /\/add skill/i }).first();
    await expect(addSkillCmd).toBeVisible({ timeout: 10_000 });
    await addSkillCmd.click();

    // Verify modal and 3 segmented tabs
    await expect(page.getByText("Kelola & Buat Skill Motion")).toBeVisible({ timeout: 10_000 });
    const refTab = page.getByRole("tab", { name: /Dari Referensi/i });
    const importTab = page.getByRole("tab", { name: /Import Paket/i });
    const manageTab = page.getByRole("tab", { name: /Kelola/i });
    await expect(refTab).toBeVisible();
    await expect(importTab).toBeVisible();
    await expect(manageTab).toBeVisible();

    // Verify Tab 1 (Dari Referensi) inputs exist
    await expect(page.locator("#ref-skill-source")).toBeVisible();
    await expect(page.locator("#ref-skill-name")).toBeVisible();

    // Switch to Tab 2 (Import Paket) & test failure path (missing file path)
    await importTab.click();
    await page.locator("#import-skill-name").fill(testSlug);
    await page.locator("#import-skill-path").fill(path.join(draftTempDir, "does-not-exist.md"));
    await page.getByRole("button", { name: /Daftarkan ke \.aetheria/i }).click();
    await expect(page.getByText(/Failed to read skill file/i)).toBeVisible({ timeout: 10_000 });
    // Modal remains open, no crash/reload
    await expect(page.getByText("Kelola & Buat Skill Motion")).toBeVisible();

    // Now test success path: import valid declarative package folder
    await page.locator("#import-skill-path").fill(draftTempDir);
    await page.getByRole("button", { name: /Daftarkan ke \.aetheria/i }).click();
    await expect(page.getByText(`Skill /${testSlug} berhasil didaftarkan`)).toBeVisible({ timeout: 10_000 });
    expect(fs.existsSync(path.join(installedSkillDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(installedSkillDir, "skill-meta.json"))).toBe(true);

    // Reopen /add skill modal and switch to Tab 3 (Kelola)
    await chatBox.click();
    await chatBox.fill("/add");
    await page.getByRole("button", { name: /\/add skill/i }).first().click();
    await expect(page.getByText("Kelola & Buat Skill Motion")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("tab", { name: /Kelola/i }).click();

    // Verify custom skill is listed with Hapus button, and built-in mg-soft-clay-story is locked
    await expect(page.getByText(`/${testSlug}`, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: `Hapus skill /${testSlug}` })).toBeVisible();
    await expect(page.getByText("/mg-soft-clay-story", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hapus skill /mg-soft-clay-story" })).toHaveCount(0);

    // Visual verification across all 3 themes
    const shotDir = process.env.E2E_SCREENSHOT_DIR || stack.screenshotDir;
    for (const theme of ["dark", "light", "neobrutalism"] as const) {
      await applyTheme(page, theme);
      await page.waitForTimeout(220);
      await expect(page.getByText(`/${testSlug}`, { exact: true })).toBeVisible();
      if (shotDir) {
        fs.mkdirSync(shotDir, { recursive: true });
        await page.screenshot({
          path: path.join(shotDir, `skill-manager-modal-${theme}.png`),
          fullPage: false,
        });
      }
    }
    await applyTheme(page, "dark");

    // Delete custom skill via 2-step confirmation
    await page.getByRole("button", { name: `Hapus skill /${testSlug}` }).click();
    await page.getByRole("button", { name: /^Hapus$/i }).click();
    await expect(page.getByText(`Skill /${testSlug} berhasil dihapus`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`/${testSlug}`, { exact: true })).toHaveCount(0);
    expect(fs.existsSync(installedSkillDir)).toBe(false);

    expect(expectedNegative400Count).toBe(1);
    expect(appErrors).toEqual([]);
  });
});
