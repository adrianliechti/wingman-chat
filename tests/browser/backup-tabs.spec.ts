import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/backup-server";
import {
  connect,
  enableBackup,
  expectLocal,
  filePath,
  fixture,
  matchesUpload,
  restore,
  sync,
  withRestoredBackup,
} from "./helpers/backup-client";

test.use({ actionTimeout: 30_000 });
test.setTimeout(90_000);

async function openPeer(page: Page) {
  const peer = await page.context().newPage();
  await peer.goto(fixture);
  await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await sync(peer);
  return peer;
}

test("three tabs concurrently back up separate chats and files without dropping shared tracking", async ({
  page,
  context,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await enableBackup(page);
  const tabs = [page, await openPeer(page), await openPeer(page)];
  for (let round = 0; round < 3; round++) {
    await Promise.all(
      tabs.map((tab, index) =>
        tab.evaluate(
          async ({ index, round }) => {
            const text = `tab ${index}, revision ${round}`;
            await window.syncSecurityE2E.saveChat(text, `chat-tab-${index}`);
            await window.syncSecurityE2E.save(`agents/tab-${index}/AGENTS.md`, text);
          },
          { index, round },
        ),
      ),
    );
    await Promise.all(tabs.map(sync));
  }
  const tracking = await page.evaluate(async () => ({
    chats: JSON.parse((await window.syncSecurityE2E.read("_sync/state.json"))!),
    files: JSON.parse((await window.syncSecurityE2E.read("_sync/files.json"))!),
  }));
  expect(Object.keys(tracking.chats.heads).sort()).toEqual(["chat-tab-0", "chat-tab-1", "chat-tab-2"]);
  expect(Object.keys(tracking.files.entries).sort()).toEqual(tabs.map((_, index) => `agents/tab-${index}/AGENTS.md`));
  await withRestoredBackup(context, backupServer, user, async (restored) => {
    for (let index = 0; index < tabs.length; index++) {
      const text = `tab ${index}, revision 2`;
      await expect
        .poll(() =>
          restored.evaluate(
            async (index) => ({
              chat: await window.syncSecurityE2E.readChat(`chat-tab-${index}`),
              file: await window.syncSecurityE2E.read(`agents/tab-${index}/AGENTS.md`),
            }),
            index,
          ),
        )
        .toMatchObject({
          chat: { messages: [{ role: "user", parts: [{ type: "text", content: text }] }] },
          file: text,
        });
    }
  });
});

for (const upload of ["chat", "file"] as const) {
  for (const outcome of ["acknowledged", "closed before commit", "closed after commit"] as const) {
    test(`${upload}: a peer keeps newer edits when the uploading tab is ${outcome}`, async ({
      page,
      context,
      backupServer,
    }) => {
      const { network, user } = await connect(context, backupServer);
      await enableBackup(page);
      const peer = await openPeer(page);
      let captured = false;
      let held = false;
      let attempts = 0;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => (release = resolve));
      network.interrupt = async (route) => {
        if (!matchesUpload(route, upload)) return false;
        attempts++;
        if (captured) return false;
        captured = true;
        const request = route.request();
        expect(request.frame().page()).toBe(page);
        const response =
          outcome === "closed after commit"
            ? await route.fetch({
                url: `${backupServer}${new URL(request.url()).pathname}`,
                headers: { ...request.headers(), "X-Forwarded-User": user },
              })
            : undefined;
        if (response) expect(response.ok()).toBe(true);
        held = true;
        await blocked;
        if (outcome === "acknowledged") return false;
        await route.abort("connectionreset");
        return true;
      };
      try {
        await page.evaluate(async (path) => {
          await window.syncSecurityE2E.saveChat("older in-flight revision");
          await window.syncSecurityE2E.save(path, "older in-flight revision");
        }, filePath);
        await expect.poll(() => held).toBe(true);
        await peer.evaluate(async (path) => {
          await window.syncSecurityE2E.saveChat("newer revision from peer");
          await window.syncSecurityE2E.save(path, "newer revision from peer");
        }, filePath);
        await expectLocal(peer, "newer revision from peer");
        await peer.getByRole("button", { name: "Sync now", exact: true }).click();
        // Prove actual contention on native cross-tab locks before allowing the upload to finish.
        await expect
          .poll(() =>
            peer.evaluate(
              async (kind) =>
                (await navigator.locks.query()).pending?.some((lock) =>
                  kind === "chat" ? lock.name?.endsWith(":reset-chat") : lock.name?.startsWith("wingman:file-sync:"),
                ),
              upload,
            ),
          )
          .toBe(true);
        expect(attempts).toBe(1);
        if (outcome !== "acknowledged") await page.close();
        release();
        await expect(peer.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
        await sync(peer);
        await expectLocal(peer, "newer revision from peer");
        await restore(context, backupServer, user, "newer revision from peer");
      } finally {
        release();
        network.interrupt = undefined;
      }
    });
  }
}

test("a stale peer deletes another tab's chat and directory without resurrecting them during concurrent syncs", async ({
  page,
  context,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await enableBackup(page);
  const peer = await openPeer(page);
  await page.evaluate(async () => {
    await window.syncSecurityE2E.saveChat("keep this chat", "kept-chat");
    await window.syncSecurityE2E.saveChat("delete this chat", "deleted-chat");
    await window.syncSecurityE2E.save("agents/kept/AGENTS.md", "keep this file");
    await window.syncSecurityE2E.save("agents/deleted/AGENTS.md", "remove this file");
    await window.syncSecurityE2E.save("agents/deleted/nested/file.txt", "remove this too");
    await window.syncSecurityE2E.save("agents/single.md", "remove individually");
  });
  await sync(page);
  await peer.evaluate(async () => {
    await window.syncSecurityE2E.removeChat("deleted-chat");
    await window.syncSecurityE2E.removeDirectory("agents/deleted");
    await window.syncSecurityE2E.removeFile("agents/single.md");
  });
  await Promise.all([sync(page), sync(peer)]);
  for (const tab of [page, peer]) {
    const remaining = await tab.evaluate(async () => ({
      chat: await window.syncSecurityE2E.readChat("deleted-chat"),
      file: await window.syncSecurityE2E.read("agents/deleted/AGENTS.md"),
      nested: await window.syncSecurityE2E.read("agents/deleted/nested/file.txt"),
      single: await window.syncSecurityE2E.read("agents/single.md"),
    }));
    expect(remaining).toEqual({ chat: undefined, file: undefined, nested: undefined, single: undefined });
  }
  await withRestoredBackup(context, backupServer, user, async (restored) => {
    await expect
      .poll(() =>
        restored.evaluate(async () => ({
          keptChat: await window.syncSecurityE2E.readChat("kept-chat"),
          deletedChat: await window.syncSecurityE2E.readChat("deleted-chat"),
          keptFile: await window.syncSecurityE2E.read("agents/kept/AGENTS.md"),
          deletedFile: await window.syncSecurityE2E.read("agents/deleted/AGENTS.md"),
          nested: await window.syncSecurityE2E.read("agents/deleted/nested/file.txt"),
          single: await window.syncSecurityE2E.read("agents/single.md"),
        })),
      )
      .toMatchObject({
        keptChat: { messages: [{ role: "user", parts: [{ type: "text", content: "keep this chat" }] }] },
        keptFile: "keep this file",
        deletedChat: undefined,
        deletedFile: undefined,
        nested: undefined,
        single: undefined,
      });
  });
});
