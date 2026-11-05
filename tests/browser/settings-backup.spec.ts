import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test, type Page } from "@playwright/test";

async function configure(page: Page, online?: boolean, store = true) {
  let keystore: unknown = null;
  let revision = 0;
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined }));
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], ...(online ? { onlineBackup: {} } : {}), ...(store ? { store: {} } : {}) } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/backup/usage")) return route.fulfill({ json: { bytes: 12949914 } });
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice", name: "Alice" } });
    if (path.endsWith("/keystore")) {
      if (request.method() === "GET") {
        return keystore
          ? route.fulfill({ json: keystore, headers: { ETag: `"${revision}"` } })
          : route.fulfill({ status: 404 });
      }
      keystore = request.postDataJSON();
      return route.fulfill({ status: 204, headers: { ETag: `"${++revision}"` } });
    }
    if (request.method() === "PUT") return route.fulfill({ status: 204, headers: { ETag: '"file"' } });
    return route.fulfill({ json: [] });
  });
}

test("PIN setup stays visible until the optional passkey step is ready", async ({ page }) => {
  await configure(page, true);
  let releaseProvisioning!: () => void;
  let provisioningStarted!: () => void;
  const provisioning = new Promise<void>((resolve) => {
    releaseProvisioning = resolve;
  });
  const started = new Promise<void>((resolve) => {
    provisioningStarted = resolve;
  });
  await page.route("**/api/v1/keystore", async (route) => {
    if (route.request().method() === "PUT" && route.request().postDataJSON().backup) {
      provisioningStarted();
      await provisioning;
    }
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Backups disabled — set a PIN or passkey", exact: true }).click();
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.getByText("Without your PIN or a passkey,", { exact: false })).toBeVisible();
  await page.getByLabel("New PIN", { exact: true }).fill("123456");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("123456");
  await page.getByRole("list", { name: "Backup setup progress" }).evaluate((progress) => {
    const observer = new MutationObserver(() => {
      if (!progress.isConnected) {
        document.documentElement.setAttribute("data-backup-setup-interrupted", "true");
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await started;
  try {
    await expect(page.getByRole("form", { name: "Create your backup PIN" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(page.getByText("Ready to restore", { exact: true })).toHaveCount(0);
  } finally {
    releaseProvisioning();
  }
  await expect(page.getByRole("heading", { name: "Create your passkey", exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-backup-setup-interrupted");
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
});

test("online backup mode hides local file controls", async ({ page }, testInfo) => {
  await configure(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Backups disabled — set a PIN or passkey", exact: true }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByRole("heading", { name: "Online backup", exact: true, level: 3 })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Online backup", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
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
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await settings.getByRole("button", { name: "Turn on backup", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`backup-off-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await settings.getByRole("button", { name: "Turn on backup", exact: true }).click();
  const protection = settings.getByRole("region", { name: "Backup protection", exact: true });
  await expect(protection.getByRole("form", { name: "Create your backup PIN", exact: true })).toBeVisible();
  await protection.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Turn on backup", exact: true })).toBeFocused();
  await settings.getByRole("button", { name: "Turn on backup", exact: true }).click();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`backup-pin-${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await protection.getByLabel("New PIN", { exact: true }).fill("123456");
  await protection.getByLabel("Confirm PIN", { exact: true }).fill("123456");
  await protection.getByRole("button", { name: "Create PIN", exact: true }).click();
  await expect(protection.getByRole("heading", { name: "Create your passkey", exact: true })).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`backup-passkey-${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await protection.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(settings.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect(settings.getByLabel("Approximate online backup size: ≈ 12.4 MB", { exact: true })).toBeVisible();
  const titleBar = settings.getByRole("heading", { name: "Online backup", exact: true, level: 3 }).locator("..");
  const menu = titleBar.getByRole("button", { name: "Backup options", exact: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await menu.scrollIntoViewIfNeeded();
    await expect(menu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`backup-title-menu-${width}.png`), animations: "disabled" });
  }
  await menu.click();
  await expect(page.getByRole("menuitem", { name: "Deactivate backup", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Deactivate backup", exact: true }).click();
  await page.getByRole("button", { name: "Backup locked — unlock in Backup", exact: true }).click();
  await expect(settings.getByText("Ready to restore", { exact: true })).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const restore = settings.getByRole("button", { name: "Restore backup", exact: true });
    await restore.scrollIntoViewIfNeeded();
    await expect(restore).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`backup-locked-${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await settings.getByRole("button", { name: "Restore backup", exact: true }).click();
  await settings.getByLabel("PIN", { exact: true }).fill("123456");
  await settings.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(settings.getByText("Everything looks fine", { exact: true })).toBeVisible();
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
    await settings.getByRole("button", { name: "Backup", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Backup", exact: true, level: 3 })).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Online backup", exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Reset online backup", exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Download backup", exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Restore from file", exact: true })).toBeVisible();
    await expect(settings.getByRole("region", { name: "Local backup files", exact: true })).toBeVisible();
    await expect(settings.getByText("These files don’t update automatically.", { exact: false })).toBeVisible();
    // Sample both controls in one frame while the settings opening animation runs.
    const [downloadBox, restoreBox] = await settings
      .getByRole("button", { name: /^(Download backup|Restore from file)$/ })
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width } = button.getBoundingClientRect();
          return { x, y, width };
        }),
      );
    expect(Math.abs(downloadBox.y - restoreBox.y)).toBeLessThan(1);
    expect(downloadBox.x + downloadBox.width).toBeLessThan(restoreBox.x);
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
    await expect(settings.getByRole("heading", { name: "Backup", exact: true, level: 3 })).not.toBeInViewport();
  });
}
