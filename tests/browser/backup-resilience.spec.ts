import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { test } from "./helpers/backup-server";

const fixture = "/tests/browser/fixtures/sync-security.html";
const filePath = "agents/resilience/AGENTS.md";
const pin = "12345678";
test.use({ actionTimeout: 30_000 });
test.setTimeout(90_000);

async function connect(context: BrowserContext, server: string, user: string = randomUUID()) {
  const network = {
    offline: false,
    unavailable: false,
    interrupt: undefined as undefined | ((route: Route) => Promise<boolean>),
  };
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await context.route("**/api/v1/**", async (route) => {
    if (network.offline) return route.abort("internetdisconnected");
    if (network.unavailable) return route.fulfill({ status: 503, body: "Backup server temporarily unavailable" });
    if (await network.interrupt?.(route)) return;
    const request = route.request();
    const response = await route.fetch({
      url: `${server}${new URL(request.url()).pathname}${new URL(request.url()).search}`,
      headers: { ...request.headers(), "X-Forwarded-User": user },
    });
    await route.fulfill({ response });
  });
  return { network, user };
}

async function enableBackup(page: Page) {
  await page.goto(fixture);
  await choosePin(page);
}

async function choosePin(page: Page) {
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill(pin);
  await page.getByLabel("Confirm PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
}

async function sync(page: Page) {
  const button = page.getByRole("button", { name: "Sync now", exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
}

async function expectLocal(page: Page, text: string) {
  await expect.poll(() => page.evaluate(() => window.syncSecurityE2E.readChat()).then(JSON.stringify)).toContain(text);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const chat = (await window.syncSecurityE2E.readChat()) as { messages: unknown[] } | undefined;
        return chat?.messages.length;
      }),
    )
    .toBe(1);
  await expect.poll(() => page.evaluate((p) => window.syncSecurityE2E.read(p), filePath)).toBe(text);
}

async function restore(context: BrowserContext, server: string, user: string, text: string) {
  const device = await context.browser()!.newContext({ baseURL: "http://127.0.0.1:4175" });
  try {
    await connect(device, server, user);
    const page = await device.newPage();
    await page.goto(fixture);
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await page.getByLabel("PIN", { exact: true }).fill(pin);
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
    await expectLocal(page, text);
  } finally {
    await device.close();
  }
}

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
  await page.getByText("Error details", { exact: true }).click();
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
        const matches =
          upload === "chat"
            ? request.method() === "POST" && request.url().includes("/events")
            : request.method() === "PUT" && request.url().includes("/files/");
        if (!matches) return false;
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
        headers: { "X-Forwarded-User": user, "X-Backup-Key": backup.publicKey },
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
