import { expect, type BrowserContext, type Page } from "@playwright/test";
import { test } from "./helpers/backup-server";
import { choosePin, connect, fixture, pin, sync, withRestoredBackup } from "./helpers/backup-client";

test.use({ actionTimeout: 30_000 });
test.setTimeout(120_000);

const lockedButton = /^(Unlock backup|Restore backup)$/;

async function deactivate(page: Page) {
  await page.getByRole("button", { name: "Backup options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Deactivate backup", exact: true }).click();
  await expect(page.getByRole("button", { name: lockedButton })).toBeVisible();
}

async function unlock(page: Page) {
  await page.getByRole("button", { name: lockedButton }).click();
  await page.getByLabel("PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: lockedButton }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
}

const readChat = (page: Page, id: string) =>
  page.evaluate((id) => window.syncSecurityE2E.readChat(id).then((chat) => JSON.stringify(chat ?? null)), id);

const saveChat = (page: Page, id: string, text: string) =>
  page.evaluate(({ id, text }) => window.syncSecurityE2E.saveChat(text, id), { id, text });

async function serveConfig(context: BrowserContext, backup: boolean) {
  await context.unroute("**/config.json");
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: backup ? { models: [], backup: { provider: "onedrive" } } : { models: [] } }),
  );
}

test("chats created and edited while backup is deactivated upload after unlocking", async ({
  page,
  context,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await page.goto(fixture);
  await saveChat(page, "existing-chat", "written before backup");
  await choosePin(page);
  await sync(page);

  await deactivate(page);
  await saveChat(page, "existing-chat", "edited while deactivated");
  await saveChat(page, "created-chat", "created while deactivated");
  expect(await readChat(page, "existing-chat")).toContain("edited while deactivated");

  await unlock(page);
  await sync(page);
  await withRestoredBackup(context, backupServer, user, async (device) => {
    await expect.poll(() => readChat(device, "existing-chat")).toContain("edited while deactivated");
    await expect.poll(() => readChat(device, "created-chat")).toContain("created while deactivated");
  });
});

test("a chat deleted while backup is deactivated stays deleted after unlocking", async ({
  page,
  context,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await page.goto(fixture);
  await choosePin(page);
  await saveChat(page, "removed-chat", "delete me while deactivated");
  await saveChat(page, "kept-chat", "keep me");
  await sync(page);

  await deactivate(page);
  await page.evaluate(() => window.syncSecurityE2E.removeChat("removed-chat"));
  await unlock(page);
  await sync(page);
  expect(await readChat(page, "removed-chat")).toBe("null");

  await withRestoredBackup(context, backupServer, user, async (device) => {
    await expect.poll(() => readChat(device, "kept-chat")).toContain("keep me");
    expect(await readChat(device, "removed-chat")).toBe("null");
  });
});

test("edits made while the deployment has no backup upload when backup returns", async ({
  page,
  context,
  backupServer,
}) => {
  const { network, user } = await connect(context, backupServer);
  await page.goto(fixture);
  await choosePin(page);
  await saveChat(page, "plain-chat", "plain backed up");
  await saveChat(page, "outbox-chat", "outbox backed up");
  await sync(page);

  // Leave an unsent outbox behind, as a build without backup would find it.
  network.unavailable = true;
  await saveChat(page, "outbox-chat", "stale outbox");
  await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.syncSecurityE2E.read("chats/outbox-chat/target.json"))).toContain(
    "stale outbox",
  );

  await serveConfig(context, false);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.syncSecurityE2E.sessionStatus())).toBe("disabled");
  await saveChat(page, "plain-chat", "plain edited without backup");
  await saveChat(page, "outbox-chat", "outbox edited without backup");
  await saveChat(page, "fresh-chat", "created without backup");
  expect(await readChat(page, "outbox-chat")).toContain("outbox edited without backup");

  network.unavailable = false;
  await serveConfig(context, true);
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await sync(page);
  expect(await readChat(page, "outbox-chat")).toContain("outbox edited without backup");

  await withRestoredBackup(context, backupServer, user, async (device) => {
    await expect.poll(() => readChat(device, "plain-chat")).toContain("plain edited without backup");
    await expect.poll(() => readChat(device, "outbox-chat")).toContain("outbox edited without backup");
    await expect.poll(() => readChat(device, "fresh-chat")).toContain("created without backup");
    expect(await readChat(device, "outbox-chat")).not.toContain("stale outbox");
  });
});

test("turning on backup keeps the original of an older-format chat", async ({ page, context, backupServer }) => {
  const { user } = await connect(context, backupServer);
  const legacy = {
    id: "legacy-chat",
    title: "Legacy",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-02T00:00:00.000Z",
    messages: [
      {
        id: "u1",
        createdAt: "2026-01-01T00:00:01.000Z",
        role: "user",
        content: [{ type: "text", text: "hello from the old format" }],
      },
    ],
  };
  await page.goto(fixture);
  await page.evaluate(
    (json) => window.syncSecurityE2E.save("chats/legacy-chat/chat.json", json),
    JSON.stringify(legacy),
  );
  await choosePin(page);
  await sync(page);

  const kept = await page.evaluate(() => window.syncSecurityE2E.read("chats/legacy-chat/chat.legacy.json"));
  expect(JSON.parse(kept!)).toEqual(legacy);
  const converted = JSON.parse(
    (await page.evaluate(() => window.syncSecurityE2E.read("chats/legacy-chat/chat.json")))!,
  );
  expect(converted).toHaveProperty("version");

  await withRestoredBackup(context, backupServer, user, async (device) => {
    await expect.poll(() => readChat(device, "legacy-chat")).toContain("hello from the old format");
  });
});

test("repeated deactivate and unlock cycles with a second tab keep every edit", async ({
  page,
  context,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await page.goto(fixture);
  await saveChat(page, "cycled-chat", "cycle 0");
  await choosePin(page);
  await sync(page);
  const peer = await context.newPage();
  await peer.goto(fixture);
  await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();

  for (const cycle of [1, 2]) {
    await deactivate(page);
    await expect(peer.getByRole("button", { name: lockedButton })).toBeVisible();
    await saveChat(peer, "cycled-chat", `cycle ${cycle} from the peer`);
    await saveChat(page, `cycle-chat-${cycle}`, `created in cycle ${cycle}`);
    await unlock(page);
    await peer.reload();
    await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();
    await sync(page);
  }

  await withRestoredBackup(context, backupServer, user, async (device) => {
    await expect.poll(() => readChat(device, "cycled-chat")).toContain("cycle 2 from the peer");
    await expect.poll(() => readChat(device, "cycle-chat-1")).toContain("created in cycle 1");
    await expect.poll(() => readChat(device, "cycle-chat-2")).toContain("created in cycle 2");
  });
});
