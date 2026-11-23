import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test, type Page } from "@playwright/test";
import { choosePin } from "./helpers/backup-client";

async function configure(page: Page, online?: boolean, store = true) {
  let keystore: unknown = null;
  let revision = 0;
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined }));
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { models: [], ...(online ? { backup: { provider: "onedrive" } } : {}), ...(store ? { store: {} } : {}) },
    }),
  );
  await page.route(/\/api\/v1\/|\/me$/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/store/usage")) return route.fulfill({ json: { bytes: 12949914 } });
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice", name: "Alice" } });
    if (path === "/api/v1/store" && request.method() === "DELETE") {
      keystore = null;
      return route.fulfill({ status: 204 });
    }
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

test("backup settings reopen after reset and show a loader until the server responds", async ({ page }) => {
  await configure(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Backup is off — click to turn on", exact: true }).click();
  await choosePin(page);

  let releaseReset!: () => void;
  const resetPaused = new Promise<void>((resolve) => {
    releaseReset = resolve;
  });
  await page.route("**/api/v1/store", async (route) => {
    if (route.request().method() === "DELETE") await resetPaused;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Danger zone", exact: true }).click();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).click();
  const deleteRequest = page.waitForRequest(
    (request) => request.method() === "DELETE" && request.url().endsWith("/api/v1/store"),
  );
  try {
    await page.getByRole("button", { name: "Delete online backup and reset", exact: true }).click();
    await deleteRequest;
    const backup = page.getByRole("region", { name: "Online backup", exact: true }).getByRole("status");
    await expect(backup).toContainText("Deletion pending");
    await expect(page.getByRole("button", { name: /^(Turn on backup|Unlock backup|Restore backup)$/ })).toHaveCount(0);
  } finally {
    releaseReset();
  }
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
  await expect(page.getByText("Deletion pending", { exact: true })).toHaveCount(0);
});

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
  await page.route("**/api/v1/store/keystore", async (route) => {
    if (route.request().method() === "PUT") {
      provisioningStarted();
      await provisioning;
    }
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Backup is off — click to turn on", exact: true }).click();
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.getByText("Without your PIN or a passkey,", { exact: false })).toBeVisible();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
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

test("initial backup and restore display confirmed file counts and progress bars", async ({ page }, testInfo) => {
  await configure(page, true);
  const releases: (() => void)[] = [];
  const files = new Map<string, Buffer>();
  await page.route("**/api/v1/store/files/**", async (route) => {
    if (route.request().method() === "PUT") {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      files.set(id, route.request().postDataBuffer()!);
      await new Promise<void>((resolve) => releases.push(resolve));
    }
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Backup is off — click to turn on", exact: true }).click();
  await page.evaluate(async () => {
    const modulePath = "/src/shared/lib/opfs-core.ts";
    const { writeText } = await import(/* @vite-ignore */ modulePath);
    await writeText("skills/first/SKILL.md", "first skill");
    await writeText("skills/second/SKILL.md", "second skill");
  });
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  const progress = page.getByRole("progressbar", { name: /^Backing up files/ });
  try {
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("value", "0");
    const total = Number(await progress.getAttribute("max"));
    expect(total).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(`Backing up files · 0 / ${total}`, { exact: true })).toBeVisible();
    await expect.poll(() => releases.length).toBe(1);
    releases[0]();
    await expect(progress).toHaveAttribute("value", "1");
    await expect(page.getByText(`Backing up files · 1 / ${total}`, { exact: true })).toBeVisible();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: testInfo.outputPath(`backup-progress-${width}.png`), animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally {
    await page.unroute("**/api/v1/store/files/**");
    for (const release of releases) release();
  }
  await expect(progress).toHaveCount(0);
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();

  // A fresh local workspace restores the exact ciphertext uploaded above.
  await page.getByRole("button", { name: "Backup options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Deactivate backup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Backup locked — unlock in Backup", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
  });
  const downloads: (() => void)[] = [];
  await page.route("**/api/v1/store/files", (route) =>
    route.fulfill({
      json: Array.from(files, ([id, data]) => ({
        id,
        etag: '"file"',
        size: data.length,
        updated: "2026-11-05T00:00:00Z",
      })),
    }),
  );
  await page.route("**/api/v1/store/files/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const data = files.get(id);
    if (route.request().method() !== "GET" || !data) return route.fallback();
    await new Promise<void>((resolve) => downloads.push(resolve));
    await route.fulfill({ body: data, contentType: "application/octet-stream", headers: { ETag: '"file"' } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Backup locked — unlock in Backup", exact: true }).click();
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  await page.getByLabel("PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  const restoring = page.getByRole("progressbar", { name: /^Restoring files/ });
  try {
    await expect(restoring).toBeVisible();
    await expect(restoring).toHaveAttribute("value", "0");
    await expect(restoring).toHaveAttribute("max", String(files.size));
    await expect.poll(() => downloads.length).toBe(1);
    downloads[0]();
    await expect(restoring).toHaveAttribute("value", "1");
    await expect(page.getByText(`Restoring files · 1 / ${files.size}`, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("restore-progress-375.png"), animations: "disabled" });
  } finally {
    await page.unroute("**/api/v1/store/files/**");
    for (const release of downloads) release();
  }
  await expect(restoring).toHaveCount(0);
});

test("online backup keeps local recovery controls in a collapsed section", async ({ page }, testInfo) => {
  await configure(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Backup is off — click to turn on", exact: true }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByRole("heading", { name: "Online backup", exact: true, level: 3 })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Online backup", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
  const localFiles = settings.getByRole("region", { name: "Local backup files", exact: true });
  const localToggle = localFiles.getByRole("button", { name: "Local backup files", exact: true });
  await expect(localToggle).toHaveAttribute("aria-expanded", "false");
  await expect(localFiles.getByRole("button", { name: "Download backup", exact: true })).toBeHidden();
  await expect(localFiles.getByRole("button", { name: "Restore from file", exact: true })).toBeHidden();
  await localToggle.focus();
  await page.keyboard.press("Enter");
  await expect(localToggle).toHaveAttribute("aria-expanded", "true");
  await expect(localFiles.getByRole("button", { name: "Download backup", exact: true })).toBeVisible();
  await expect(localFiles.getByRole("button", { name: "Restore from file", exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await localFiles.getByRole("button", { name: "Download backup", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/^wingman-backup-.*\.zip$/);
  await localToggle.click();
  await expect(localToggle).toHaveAttribute("aria-expanded", "false");
  await expect(localFiles.getByRole("button", { name: "Download backup", exact: true })).toBeHidden();
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
  await protection.getByLabel("New PIN", { exact: true }).fill("12345678");
  await protection.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
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
  await settings.getByLabel("PIN", { exact: true }).fill("12345678");
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
    await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
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

test("a downloaded ZIP merges through Settings and both tabs can open restored data", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aS6QAAAAASUVORK5CYII=";
  const source = await browser.newContext({ baseURL });
  const configureLocal = async (tab: Page) => {
    await configure(tab, false, false);
    await tab.setViewportSize({ width: 375, height: 740 });
    await tab.goto("/");
  };
  const openBackup = async (tab: Page) => {
    await tab.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
    await tab.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = tab.getByRole("dialog");
    await settings.getByRole("button", { name: "Backup", exact: true }).click();
    return settings;
  };
  const seed = (tab: Page, id: string, title: string, message: string, attachment?: string) =>
    tab.evaluate(
      async ({ id, title, message, attachment }) => {
        const storagePath = "/src/features/chat/lib/chatStorage.ts";
        const { storeChat } = (await import(
          /* @vite-ignore */ storagePath
        )) as typeof import("../../src/features/chat/lib/chatStorage");
        const messagesPath = "/src/shared/lib/messages.ts";
        const { mediaFromDataUrl, text, userMessage } = (await import(
          /* @vite-ignore */ messagesPath
        )) as typeof import("../../src/shared/lib/messages");
        const parts = [
          text(message),
          ...(attachment ? [mediaFromDataUrl(`data:image/png;base64,${attachment}`, "pixel.png")] : []),
        ];
        await storeChat({
          id,
          customTitle: title,
          created: new Date(),
          updated: new Date(),
          model: null,
          messages: [userMessage(parts)],
        });
      },
      { id, title, message, attachment },
    );

  try {
    const exporting = await source.newPage();
    await configureLocal(exporting);
    await seed(exporting, "zip-chat", "Recovered conversation", "Conversation from the downloaded backup", image);
    const exportSettings = await openBackup(exporting);
    const downloading = exporting.waitForEvent("download");
    await exportSettings.getByRole("button", { name: "Download backup", exact: true }).click();
    const archive = await downloading;

    await configureLocal(page);
    await seed(page, "local-chat", "Keep this conversation", "Existing conversation in the destination");
    await seed(page, "zip-chat", "Previous copy", "Older version in the destination");
    const peer = await context.newPage();
    await configureLocal(peer);
    const importSettings = await openBackup(page);
    const choosing = page.waitForEvent("filechooser");
    await importSettings.getByRole("button", { name: "Restore from file", exact: true }).click();
    const chooser = await choosing;
    await chooser.setFiles({
      name: archive.suggestedFilename(),
      mimeType: "application/zip",
      buffer: await readFile((await archive.path())!),
    });
    const dialog = page.getByRole("dialog", { name: "Restore backup?" });
    await expect(dialog.getByRole("heading", { name: "Restore backup?" })).toBeVisible();
    const reloaded = page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() });
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await reloaded;
    await peer.reload();

    for (const tab of [page, peer]) {
      await tab.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
      await expect(tab.getByText("Keep this conversation", { exact: true })).toBeVisible();
      await expect(tab.getByText("Previous copy", { exact: true })).toHaveCount(0);
      await tab.getByText("Recovered conversation", { exact: true }).click();
      await expect(tab.getByText("Conversation from the downloaded backup", { exact: true })).toBeVisible();
      const attachment = await tab.evaluate(async () => {
        const path = "/src/features/chat/lib/chatStorage.ts";
        const { loadChat } = (await import(
          /* @vite-ignore */ path
        )) as typeof import("../../src/features/chat/lib/chatStorage");
        return (await loadChat("zip-chat"))?.messages[0].parts[1];
      });
      expect(attachment).toMatchObject({
        type: "image",
        source: { type: "data", mimeType: "image/png", value: image },
      });
    }
  } finally {
    await source.close();
  }
});
