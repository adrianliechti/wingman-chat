import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test, type Page } from "@playwright/test";

async function configure(page: Page, online?: boolean, store = true) {
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined }));
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], ...(online ? { onlineBackup: {} } : {}), ...(store ? { store: {} } : {}) } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice", name: "Alice" } });
    if (path.endsWith("/keystore")) return route.fulfill({ status: 404 });
    return route.fulfill({ json: [] });
  });
}

test("online backup mode hides local file controls", async ({ page }, testInfo) => {
  await configure(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Backups disabled — set a PIN or passkey", exact: true }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByRole("heading", { name: "Backup & Restore", exact: true, level: 3 })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Online backup", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Start backup", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Download backup", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Restore from file", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("region", { name: "Local backup files", exact: true })).toHaveCount(0);
  const danger = settings.getByRole("region", { name: "Danger zone", exact: true });
  const toggle = danger.getByRole("button", { name: "Danger zone", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(danger.getByRole("button", { name: "Reset online backup", exact: true })).toBeHidden();
  await toggle.click();
  await expect(danger.getByRole("button", { name: "Reset online backup", exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(danger.getByRole("button", { name: "Reset online backup", exact: true })).toBeHidden();
  await settings.getByRole("button", { name: "Start backup", exact: true }).click();
  await expect(settings.getByRole("radio", { name: "PIN", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("online-backup-view.png"), animations: "disabled" });
});

for (const mode of [
  { name: "disabled", enabled: false, store: true },
  { name: "unset", enabled: undefined, store: true },
  { name: "without a store", enabled: false, store: false },
]) {
  test(`local backup files work when online backup is ${mode.name}`, async ({ page }, testInfo) => {
    await configure(page, mode.enabled, mode.store);
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog");
    await settings.getByRole("button", { name: "Backup & Restore", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Backup & Restore", exact: true, level: 3 })).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Online backup", exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Reset online backup", exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Download backup", exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Restore from file", exact: true })).toBeVisible();
    await expect(settings.getByRole("region", { name: "Local backup files", exact: true })).toBeVisible();
    await expect(settings.getByText("These files don’t update automatically.", { exact: false })).toBeVisible();
    const downloadBox = await settings.getByRole("button", { name: "Download backup", exact: true }).boundingBox();
    const restoreBox = await settings.getByRole("button", { name: "Restore from file", exact: true }).boundingBox();
    expect(Math.abs(downloadBox!.y - restoreBox!.y)).toBeLessThan(1);
    expect(downloadBox!.x + downloadBox!.width).toBeLessThan(restoreBox!.x);
    await expect(settings.getByRole("region", { name: "Danger zone", exact: true })).toHaveCount(1);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle("merged-backup-check.txt", { create: true });
      const writer = await file.createWritable();
      await writer.write("a local backup copy");
      await writer.close();
    });
    const downloading = page.waitForEvent("download", { timeout: 15000 });
    await settings.getByRole("button", { name: "Download backup", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^wingman-backup-.*\.zip$/);
    const archive = await JSZip.loadAsync(await readFile((await download.path())!));
    expect(await archive.file("merged-backup-check.txt")?.async("string")).toBe("a local backup copy");
    const choosing = page.waitForEvent("filechooser", { timeout: 10000 });
    await settings.getByRole("button", { name: "Restore from file", exact: true }).click();
    expect((await choosing).isMultiple()).toBe(false);
    await settings.getByRole("button", { name: "Choose items instead", exact: true }).click();
    await expect(settings.getByRole("checkbox", { name: /Projects/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("backup-files-mobile.png"), animations: "disabled" });
    await settings.getByRole("button", { name: "Danger zone", exact: true }).click();
    const buttons = settings.getByRole("button", { name: "Delete all agents", exact: true });
    await buttons.scrollIntoViewIfNeeded();
    await expect(buttons).toBeInViewport();
    await expect(
      settings.getByRole("heading", { name: "Backup & Restore", exact: true, level: 3 }),
    ).not.toBeInViewport();
  });
}
