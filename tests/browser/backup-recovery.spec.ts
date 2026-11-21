import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/backup-server";
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
  withRestoredBackup,
} from "./helpers/backup-client";

test("adopting a workspace reloads both tabs and keeps the original account backup", async ({
  page,
  context,
  backupServer,
}) => {
  const { network, user: original } = await connect(context, backupServer);
  await enableBackup(page);
  await page.evaluate(async (path) => {
    await window.syncSecurityE2E.saveChat("workspace retained by both accounts");
    await window.syncSecurityE2E.save(path, "workspace retained by both accounts");
  }, filePath);
  await sync(page);

  const peer = await context.newPage();
  await peer.goto(fixture);
  await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();
  const next = randomUUID();
  network.user = next;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("another account's local workspace");

  await page.getByRole("button", { name: "Use with my account", exact: true }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Use with my account", exact: true });
  await confirm.click();
  for (const tab of [page, peer]) {
    await expect(tab.getByRole("button", { name: "Turn on backup", exact: true })).toBeVisible();
    await expectLocal(tab, "workspace retained by both accounts");
  }
  await choosePin(page);
  await sync(page);
  await restore(context, backupServer, next, "workspace retained by both accounts");
  await restore(context, backupServer, original, "workspace retained by both accounts");
});

test("divergent offline edits and their attachments restore as two chats on a third browser", async ({
  page,
  context,
  browser,
  baseURL,
  backupServer,
}) => {
  const { network, user } = await connect(context, backupServer);
  await enableBackup(page);
  await page.evaluate(() => window.syncSecurityE2E.saveChat("shared starting message"));
  await sync(page);

  const other = await browser.newContext({ baseURL });
  try {
    const { network: otherNetwork } = await connect(other, backupServer, user);
    const remote = await other.newPage();
    await unlockRestoredBackup(remote);
    await expect.poll(() => remote.evaluate(() => window.syncSecurityE2E.readChat())).toBeDefined();

    network.offline = otherNetwork.offline = true;
    await page.evaluate(() => window.syncSecurityE2E.appendChat("First device edit", "data:image/png;base64,QQ=="));
    await remote.evaluate(() => window.syncSecurityE2E.appendChat("Second device edit", "data:image/png;base64,Qg=="));
    otherNetwork.offline = false;
    await sync(remote);
    network.offline = false;
    await sync(page);

    await withRestoredBackup(context, backupServer, user, async (fresh) => {
      await expect
        .poll(() =>
          fresh.evaluate(async () => {
            const path = "/src/shared/lib/localChats.ts";
            const { readLocalMirror } = (await import(
              /* @vite-ignore */ path
            )) as typeof import("../../src/shared/lib/localChats");
            const chats = await readLocalMirror();
            return chats.map(({ id, customTitle, messages }) => ({
              id,
              customTitle,
              count: messages.length,
              parts: messages[1]?.parts,
            }));
          }),
        )
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "reset-chat",
              count: 2,
              parts: expect.arrayContaining([
                expect.objectContaining({ type: "text", content: "First device edit" }),
                expect.objectContaining({ type: "image", source: expect.objectContaining({ value: "QQ==" }) }),
              ]),
            }),
            expect.objectContaining({
              id: expect.stringMatching(/^conflict-/),
              customTitle: expect.stringContaining("(conflicted copy)"),
              count: 2,
              parts: expect.arrayContaining([
                expect.objectContaining({ type: "text", content: "Second device edit" }),
                expect.objectContaining({ type: "image", source: expect.objectContaining({ value: "Qg==" }) }),
              ]),
            }),
          ]),
        );
    });
  } finally {
    await other.close();
  }
});

test("a restored chat resolves the artifact revision it attached before an edit in another tab", async ({
  page,
  context,
  backupServer,
}) => {
  const { user } = await connect(context, backupServer);
  await enableBackup(page);
  const originalRevision = await page.evaluate(async () => {
    const fsPath = "/src/features/artifacts/lib/fs.ts";
    const { FileSystemManager } = (await import(
      /* @vite-ignore */ fsPath
    )) as typeof import("../../src/features/artifacts/lib/fs");
    const messagePath = "/src/shared/lib/messages.ts";
    const { artifactRefPart, text, userMessage } = (await import(
      /* @vite-ignore */ messagePath
    )) as typeof import("../../src/shared/lib/messages");
    const storagePath = "/src/features/chat/lib/syncedChatStorage.ts";
    const { syncedChatStorage } = (await import(
      /* @vite-ignore */ storagePath
    )) as typeof import("../../src/features/chat/lib/syncedChatStorage");
    const id = "pinned-artifact";
    const fs = new FileSystemManager(id);
    const revision = (await fs.createFile("/report.txt", "Original attached report", "text/plain"))?.revision;
    if (!revision) throw new Error("Missing original artifact revision");
    await syncedChatStorage.store({
      id,
      created: new Date(),
      updated: new Date(),
      model: null,
      messages: [
        userMessage([text("Report with a pinned attachment"), artifactRefPart({ path: "/report.txt", revision })]),
      ],
    });
    return revision;
  });
  await sync(page);
  const peer = await context.newPage();
  await peer.goto(fixture);
  await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await peer.evaluate(async () => {
    const fsPath = "/src/features/artifacts/lib/fs.ts";
    const { FileSystemManager } = (await import(
      /* @vite-ignore */ fsPath
    )) as typeof import("../../src/features/artifacts/lib/fs");
    await new FileSystemManager("pinned-artifact").createFile("/report.txt", "Edited report", "text/plain");
  });
  await sync(peer);

  await withRestoredBackup(context, backupServer, user, async (fresh) => {
    await expect
      .poll(() =>
        fresh.evaluate(async () => {
          const fsPath = "/src/features/artifacts/lib/fs.ts";
          const { FileSystemManager } = (await import(
            /* @vite-ignore */ fsPath
          )) as typeof import("../../src/features/artifacts/lib/fs");
          const messagesPath = "/src/shared/lib/messages.ts";
          const { textMetadata } = (await import(
            /* @vite-ignore */ messagesPath
          )) as typeof import("../../src/shared/lib/messages");
          const chatsPath = "/src/shared/lib/localChats.ts";
          const { readLocalChat } = (await import(
            /* @vite-ignore */ chatsPath
          )) as typeof import("../../src/shared/lib/localChats");
          const chat = await readLocalChat("pinned-artifact");
          const part = chat?.messages[0].parts[1];
          const ref = part?.type === "text" ? textMetadata(part).artifactRef : undefined;
          if (!ref?.revision || !chat) return;
          const fs = new FileSystemManager(chat.id);
          return {
            revision: ref.revision,
            attached: (await fs.readRevision(ref.path, ref.revision))?.content,
            current: (await fs.getFile(ref.path))?.content,
          };
        }),
      )
      .toEqual({ revision: originalRevision, attached: "Original attached report", current: "Edited report" });
  });
});
