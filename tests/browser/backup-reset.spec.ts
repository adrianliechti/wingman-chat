import { randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { expect, type Page } from "@playwright/test";
import {
  choosePin,
  connect,
  enableBackup,
  expectLocal,
  filePath,
  fixture,
  restore,
  sync,
  unlockRestoredBackup,
} from "./helpers/backup-client";
import { test } from "./helpers/backup-server";

async function resetOnlineBackup(page: Page) {
  await page.getByRole("button", { name: "Danger zone", exact: true }).click();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).click();
  await page.getByRole("button", { name: "Delete online backup and reset", exact: true }).click();
}

async function saveLocal(page: Page, text: string) {
  await page.evaluate(
    async ({ filePath, text }) => {
      await window.syncSecurityE2E.saveChat(text);
      await window.syncSecurityE2E.save(filePath, text);
    },
    { filePath, text },
  );
}

test("a reset from another browser preserves local copies in both tabs and permits a fresh backup", async ({
  page,
  context,
  browser,
  baseURL,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await enableBackup(page);
  await saveLocal(page, "kept after reset on another device");
  await sync(page);
  const peer = await context.newPage();
  await peer.goto(fixture);
  await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();

  const other = await browser.newContext({ baseURL });
  try {
    await connect(other, backupServer, user);
    const resetter = await other.newPage();
    await unlockRestoredBackup(resetter);
    await resetOnlineBackup(resetter);
    await expect(resetter.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();

    await page.reload();
    for (const tab of [page, peer]) {
      await expect(tab.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
      await expectLocal(tab, "kept after reset on another device");
      expect(await tab.evaluate(() => window.syncSecurityE2E.read("_sync/backup.json"))).toBeUndefined();
    }
    await choosePin(page);
    await sync(page);
    await peer.reload();
    await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();
    await restore(context, backupServer, user, "kept after reset on another device");
  } finally {
    await other.close();
  }
});

test("reset bypasses an old keystore in the browser HTTP cache", async ({ page, baseURL, backupServer }) => {
  const user = randomUUID();
  let keystoreReads = 0;
  // A real same-origin server keeps Chromium's HTTP cache enabled. Emulate a
  // cache entry created before the server began serving keystores with no-store.
  const proxy = createServer((incoming, response) => {
    const path = incoming.url!;
    if (path === "/config.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ models: [], backup: { provider: "onedrive" } }));
      return;
    }
    const api = path === "/me" || path.startsWith("/api/v1/");
    const target = new URL(api ? backupServer : baseURL!);
    const readKeystore = incoming.method === "GET" && path === "/api/v1/keystore";
    if (readKeystore) keystoreReads++;
    const headers = { ...incoming.headers, host: target.host };
    const upstream = request(
      target,
      {
        path,
        method: incoming.method,
        headers: api ? { ...headers, "X-Forwarded-User": user } : headers,
      },
      (result) => {
        if (readKeystore && result.statusCode === 200) result.headers["cache-control"] = "private, max-age=3600";
        response.writeHead(result.statusCode!, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", (error) => response.destroy(error));
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Missing backup proxy address");
    await page.goto(`http://127.0.0.1:${address.port}${fixture}`);
    await choosePin(page);

    const before = keystoreReads;
    expect(await page.evaluate(async () => (await fetch("/api/v1/keystore", { cache: "reload" })).status)).toBe(200);
    expect(await page.evaluate(async () => (await fetch("/api/v1/keystore", { cache: "force-cache" })).status)).toBe(
      200,
    );
    expect(keystoreReads).toBe(before + 1);

    await resetOnlineBackup(page);
    await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/ })).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      proxy.close((error) => (error ? reject(error) : resolve()));
      proxy.closeAllConnections();
    });
  }
});

test("failed local cleanup resumes after reload without repeating the online delete", async ({
  page,
  context,
  backupServer,
}) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line typescript/unbound-method -- The wrapper calls the original with its filesystem handle.
    const removeEntry = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function (name, options) {
      if (name === "_sync" && sessionStorage.getItem("fail-reset-cleanup")) {
        return Promise.reject(new DOMException("Reset cleanup unavailable", "NotReadableError"));
      }
      return removeEntry.call(this, name, options);
    };
  });
  const { network } = await connect(context, backupServer);
  let deletes = 0;
  network.interrupt = async (route) => {
    if (route.request().method() === "DELETE" && route.request().url().endsWith("/v1/backup")) deletes++;
    return false;
  };
  await enableBackup(page);
  await saveLocal(page, "kept after cleanup retry");
  await page.evaluate(() => sessionStorage.setItem("fail-reset-cleanup", "true"));

  await resetOnlineBackup(page);
  await expect(page.getByRole("alert")).toContainText("Reset cleanup unavailable");
  await expectLocal(page, "kept after cleanup retry");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("wingman:backup-reset")!).phase)).toBe("local");

  await page.evaluate(() => sessionStorage.removeItem("fail-reset-cleanup"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
  await expectLocal(page, "kept after cleanup retry");
  expect(deletes).toBe(1);
});

test("a different account cannot complete a pending reset", async ({ page, context, backupServer }) => {
  const { network } = await connect(context, backupServer);
  await enableBackup(page);
  let deletes = 0;
  let switchAfterConfirmation = true;
  let otherAccount = false;
  network.interrupt = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/me" && otherAccount) {
      await route.fulfill({ json: { id: "other-account" } });
      return true;
    }
    // The reset request looks up the signed-in account before it reads the keystore.
    if (path === "/api/v1/keystore" && route.request().method() === "GET" && switchAfterConfirmation) {
      otherAccount = true;
      switchAfterConfirmation = false;
    }
    if (path === "/api/v1/backup" && route.request().method() === "DELETE") deletes++;
    return false;
  };

  await resetOnlineBackup(page);
  await expect(page.getByRole("alert")).toContainText("another account's local workspace");
  expect(deletes).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("wingman:backup-reset")!).phase)).toBe("delete");

  otherAccount = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
  expect(deletes).toBe(1);
});

test("retry after a lost reset response preserves a replacement backup and shows it locked", async ({
  page,
  context,
  browser,
  baseURL,
  backupServer,
}) => {
  const { network, user } = await connect(context, backupServer);
  await enableBackup(page);
  await saveLocal(page, "kept after remote replacement");
  let replacementReady = false;
  let committed = false;
  network.interrupt = async (route) => {
    const req = route.request();
    if (req.method() !== "DELETE" || new URL(req.url()).pathname !== "/api/v1/backup" || replacementReady) return false;
    if (!committed) {
      const result = await route.fetch({
        url: `${backupServer}/api/v1/backup`,
        headers: { ...req.headers(), "X-Forwarded-User": user },
      });
      expect(result.status()).toBe(204);
      committed = true;
    }
    await route.abort("connectionreset");
    return true;
  };

  await resetOnlineBackup(page);
  await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
  expect(committed).toBe(true);

  const replacement = await browser.newContext({ baseURL });
  try {
    await connect(replacement, backupServer, user);
    await enableBackup(await replacement.newPage());
    const staleDelete = page.waitForResponse(
      (response) => response.request().method() === "DELETE" && response.url().endsWith("/v1/backup"),
    );
    replacementReady = true;
    await page.reload();
    expect((await staleDelete).status()).toBe(412);
    await expect(page.getByRole("button", { name: "Unlock backup", exact: true })).toBeVisible();
    await expectLocal(page, "kept after remote replacement");
    expect(await page.evaluate(() => localStorage.getItem("wingman:backup-reset"))).toBeNull();
  } finally {
    await replacement.close();
  }
});

test("reset from an unreadable backup error returns to setup", async ({ page, context, backupServer }) => {
  const { network } = await connect(context, backupServer);
  let unreadable = true;
  network.interrupt = async (route) => {
    const req = route.request();
    if (req.method() === "GET" && req.url().endsWith("/v1/keystore") && unreadable) {
      await route.fulfill({ status: 422, body: "Backup index is unreadable" });
      return true;
    }
    if (req.method() === "DELETE" && req.url().endsWith("/v1/backup")) {
      expect(req.headers()["x-confirm-backup-reset"]).toBe("unreadable");
      unreadable = false;
      await route.fulfill({ status: 204 });
      return true;
    }
    return false;
  };
  await page.goto(fixture);
  await expect(page.getByRole("alert")).toContainText("Backup index is unreadable");
  await saveLocal(page, "kept from unreadable backup");
  await resetOnlineBackup(page);
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
  await expectLocal(page, "kept from unreadable backup");
});
