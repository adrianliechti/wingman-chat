import { expect } from "@playwright/test";
import { test } from "./helpers/backup-server";
import {
  connect,
  enableBackup,
  choosePin,
  sync,
  expectLocal,
  restore,
  matchesUpload,
  fixture,
  filePath,
  pin,
} from "./helpers/backup-client";

test.use({ actionTimeout: 30_000 });
test.setTimeout(90_000);

test("backup and restore chats and files on a fresh device", async ({ page, context, backupServer }) => {
  const { user } = await connect(context, backupServer);
  await enableBackup(page);
  await page.evaluate(
    async ({ filePath }) => {
      await window.syncSecurityE2E.saveChat("original backup");
      await window.syncSecurityE2E.save(filePath, "original backup");
    },
    { filePath },
  );
  await sync(page);
  await restore(context, backupServer, user, "original backup");
});

test("missing backup routes report 404 and recover when routing is fixed", async ({ page, context, backupServer }) => {
  await connect(context, backupServer);
  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 404, body: "404 page not found" }));
  await page.goto(fixture);
  await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText(/404: 404 page not found/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toHaveCount(0);
  await page.unroute("**/api/v1/me");
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
});

test("startup without a backup connection keeps local edits and retries automatically", async ({
  page,
  context,
  backupServer,
}) => {
  const { network, user } = await connect(context, backupServer);
  network.offline = true;
  await page.goto(fixture);
  await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
  await page.evaluate(
    async ({ filePath }) => {
      await window.syncSecurityE2E.saveChat("written before connecting");
      await window.syncSecurityE2E.save(filePath, "written before connecting");
    },
    { filePath },
  );
  await expectLocal(page, "written before connecting");
  network.offline = false;
  // Exercise the production initialization retry (15 seconds), without a reload or manual init.
  await choosePin(page);
  await sync(page);
  await restore(context, backupServer, user, "written before connecting");
});

for (const failure of ["offline", "unavailable"] as const) {
  test(`${failure} edits survive reload and upload after reconnection`, async ({ page, context, backupServer }) => {
    const { network, user } = await connect(context, backupServer);
    await enableBackup(page);
    network[failure] = true;
    await page.evaluate(
      async ({ filePath }) => {
        await window.syncSecurityE2E.saveChat("queued while disconnected");
        await window.syncSecurityE2E.save(filePath, "queued while disconnected");
      },
      { filePath },
    );
    await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
    await expectLocal(page, "queued while disconnected");
    await page.reload();
    await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
    await expectLocal(page, "queued while disconnected");
    network[failure] = false;
    await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
    await restore(context, backupServer, user, "queued while disconnected");
  });
}

for (const upload of ["chat", "file"] as const) {
  for (const committed of [false, true]) {
    test(`${upload} connection breaks ${committed ? "after server commit, before acknowledgement" : "before upload commits"}`, async ({
      page,
      context,
      backupServer,
    }) => {
      const { network, user } = await connect(context, backupServer);
      await enableBackup(page);
      let interrupted = 0;
      network.interrupt = async (route) => {
        const request = route.request();
        if (!matchesUpload(route, upload)) return false;
        if (committed) {
          const response = await route.fetch({
            url: `${backupServer}${new URL(request.url()).pathname}`,
            headers: { ...request.headers(), "X-Forwarded-User": user },
          });
          expect(response.ok()).toBe(true);
        }
        network.offline = true;
        interrupted++;
        await route.abort("connectionreset");
        return true;
      };
      await page.evaluate(() => window.syncSecurityE2E.saveChat("interrupted backup"));
      await page.evaluate((p) => window.syncSecurityE2E.save(p, "interrupted backup"), filePath);
      await expect.poll(() => interrupted).toBe(1);
      await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
      await expectLocal(page, "interrupted backup");
      // Check what was committed independently of the browser's pending state.
      const keystore = await page.request.get(`${backupServer}/api/v1/keystore`, {
        headers: { "X-Forwarded-User": user },
      });
      expect(keystore.ok()).toBe(true);
      const { backup } = await keystore.json();
      const remote = await page.request.get(`${backupServer}/api/v1/${upload === "chat" ? "chats" : "files"}`, {
        headers: { "X-Forwarded-User": user, "X-Backup-Generation": backup.generation },
      });
      expect(remote.ok()).toBe(true);
      expect(await remote.json()).toHaveLength(committed ? 1 : 0);
      network.interrupt = undefined;
      network.offline = false;
      await sync(page);
      await restore(context, backupServer, user, "interrupted backup");
    });
  }
}

for (const upload of ["chat", "file"] as const) {
  for (const committed of [false, true]) {
    test(`${upload} survives repeated tab closure ${committed ? "after commit" : "before commit"} with newer edits pending`, async ({
      page,
      context,
      backupServer,
    }) => {
      const { network, user } = await connect(context, backupServer);
      await enableBackup(page);
      let activePage = page;
      // Interrupt both an initial upload and an update to an existing remote resource.
      for (let round = 0; round < 2; round++) {
        let entered = false;
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => (release = resolve));
        network.interrupt = async (route) => {
          if (!matchesUpload(route, upload)) return false;
          if (committed) {
            const request = route.request();
            const response = await route.fetch({
              url: `${backupServer}${new URL(request.url()).pathname}`,
              headers: { ...request.headers(), "X-Forwarded-User": user },
            });
            expect(response.ok()).toBe(true);
          }
          network.offline = true;
          entered = true;
          await blocked;
          await route.abort("connectionreset");
          return true;
        };
        try {
          await activePage.evaluate(async (path) => {
            await window.syncSecurityE2E.saveChat("in-flight revision");
            await window.syncSecurityE2E.save(path, "in-flight revision");
          }, filePath);
          await expect.poll(() => entered).toBe(true);
          const latest = `newer offline revision ${round}`;
          await activePage.evaluate(
            async ({ path, latest }) => {
              await window.syncSecurityE2E.saveChat(latest);
              await window.syncSecurityE2E.save(path, latest);
            },
            { path: filePath, latest },
          );
          await expectLocal(activePage, latest);
          // Close while the request is unresolved: the engine cannot handle its failure first.
          await activePage.close();
          network.interrupt = undefined;
          release();
          network.offline = false;
          activePage = await context.newPage();
          await activePage.goto(fixture);
          await expectLocal(activePage, latest);
          await sync(activePage);
          await restore(context, backupServer, user, latest);
        } finally {
          release();
          network.interrupt = undefined;
          network.offline = false;
        }
      }
    });
  }
}

for (const download of ["chat", "file"] as const) {
  test(`${download} restore resumes after a download interruption and reload`, async ({
    page,
    context,
    backupServer,
  }) => {
    const { user } = await connect(context, backupServer);
    await enableBackup(page);
    await page.evaluate(async (path) => {
      await window.syncSecurityE2E.saveChat("interrupted restore");
      await window.syncSecurityE2E.save(path, "interrupted restore");
    }, filePath);
    await sync(page);
    const device = await context.browser()!.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const { network } = await connect(device, backupServer, user);
      let interrupted = 0;
      network.interrupt = async (route) => {
        const request = route.request();
        const matches = download === "chat" ? request.url().includes("/events") : request.url().includes("/files/");
        if (request.method() !== "GET" || !matches) return false;
        interrupted++;
        network.offline = true;
        await route.abort("connectionreset");
        return true;
      };
      const restored = await device.newPage();
      await restored.goto(fixture);
      await restored.getByRole("button", { name: "Restore backup", exact: true }).click();
      await restored.getByLabel("PIN", { exact: true }).fill(pin);
      await restored.getByRole("button", { name: "Restore backup", exact: true }).click();
      await expect.poll(() => interrupted).toBe(1);
      await expect(restored.getByText("Backup needs attention", { exact: true })).toBeVisible();
      if (download === "chat") expect(await restored.evaluate(() => window.syncSecurityE2E.readChat())).toBeUndefined();
      else expect(await restored.evaluate((path) => window.syncSecurityE2E.read(path), filePath)).toBeUndefined();
      network.interrupt = undefined;
      network.offline = false;
      await restored.reload();
      await sync(restored);
      await expectLocal(restored, "interrupted restore");
      // Another sync cannot replay an already restored message.
      await sync(restored);
      await expectLocal(restored, "interrupted restore");
    } finally {
      await device.close();
    }
  });
}

for (const failure of ["missing", "corrupt"] as const) {
  test(`${failure} workspace contents report an incomplete restore and recover on retry`, async ({
    page,
    context,
    backupServer,
  }) => {
    const { user } = await connect(context, backupServer);
    await enableBackup(page);
    await page.evaluate(async (path) => {
      await window.syncSecurityE2E.saveChat("recoverable backup");
      await window.syncSecurityE2E.save(path, "recoverable backup");
    }, filePath);
    await sync(page);

    const device = await context.browser()!.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const { network } = await connect(device, backupServer, user);
      let failedDownloads = 0;
      network.interrupt = async (route) => {
        const request = route.request();
        if (request.method() !== "GET" || !new URL(request.url()).pathname.includes("/files/")) return false;
        failedDownloads++;
        await route.fulfill(
          failure === "missing"
            ? { status: 404, body: "Backup contents missing" }
            : { status: 200, contentType: "application/octet-stream", body: Buffer.from([0, 1, 2, 3]) },
        );
        return true;
      };
      const restored = await device.newPage();
      await restored.goto(fixture);
      await restored.getByRole("button", { name: "Restore backup", exact: true }).click();
      await restored.getByLabel("PIN", { exact: true }).fill(pin);
      await restored.getByRole("button", { name: "Restore backup", exact: true }).click();
      await expect.poll(() => failedDownloads).toBeGreaterThan(0);
      await expect(restored.getByText("Backup needs attention", { exact: true })).toBeVisible();
      expect(await restored.evaluate((path) => window.syncSecurityE2E.read(path), filePath)).toBeUndefined();
      // Healthy chat data remains available even though the workspace restore failed.
      await expect
        .poll(() => restored.evaluate(() => window.syncSecurityE2E.readChat()).then(JSON.stringify))
        .toContain("recoverable backup");

      network.interrupt = undefined;
      await sync(restored);
      await expectLocal(restored, "recoverable backup");
    } finally {
      await device.close();
    }
  });
}
