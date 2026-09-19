import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { artifacts: {}, models: [] } }));
  await page.goto("/tests/browser/fixtures/artifacts.html");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
}

async function ensureChat(page: Page) {
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  return id;
}

async function selectChat(page: Page, id: string | null) {
  await page.evaluate((id) => window.artifactsE2E.selectChat(id), id);
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
}

test("new and empty chats keep the panel empty; uploading before the first message creates one chat", async ({
  page,
}) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.artifactsE2E.state())).toMatchObject({
    chatId: null,
    chats: [],
    activeFile: null,
  });

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("Draft upload") });
  await expect(page.locator("pre")).toHaveText("Draft upload");
  const id = await ensureChat(page);
  expect(await page.evaluate(() => window.artifactsE2E.state())).toMatchObject({
    chats: [id],
    messages: 0,
    activeFile: "/draft.txt",
  });
  await page.evaluate(() => window.artifactsE2E.send());
  expect(await page.evaluate(() => window.artifactsE2E.state())).toMatchObject({
    chatId: id,
    chats: [id],
    messages: 2,
  });

  await selectChat(page, null);
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.artifactsE2E.state().activeFile)).toBeNull();
  const empty = await ensureChat(page);
  expect(empty).not.toBe(id);
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
});

test("files created through another manager refresh the open panel and selection follows rename and delete", async ({
  page,
}) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/one.txt", "First"), id);
  await expect(page.locator("pre")).toHaveText("First");
  await page.evaluate((id) => window.artifactsE2E.rename(id, "/one.txt", "/renamed.txt"), id);
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().activeFile)).toBe("/renamed.txt");
  await expect(page.locator("pre")).toHaveText("First");
  await page.evaluate((id) => window.artifactsE2E.remove(id, "/renamed.txt"), id);
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.artifactsE2E.state().activeFile)).toBeNull();
});

test("switching chats with identical paths never renders the previous chat's content", async ({ page }) => {
  await openFixture(page);
  const first = await ensureChat(page);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/same.txt", "First chat"), first);
  const second = await page.evaluate(() => window.artifactsE2E.createChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(second);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/same.txt", "Second chat"), second);
  await selectChat(page, first);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("pre")).toHaveText("First chat");
  await page.evaluate((id) => window.artifactsE2E.holdNextRead(id), second);
  await selectChat(page, second);
  await page.waitForFunction(() => window.artifactsE2E.readHeld());
  await expect(page.locator("pre")).toHaveCount(0);
  await page.evaluate(() => window.artifactsE2E.releaseRead());
  await expect(page.locator("pre")).toHaveText("Second chat");
  await page.evaluate((id) => window.artifactsE2E.deleteChat(id), second);
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
});

test("late content refreshes cannot overwrite newer content or resurrect a file in an empty chat", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/file.txt", "Original"), id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("pre")).toHaveText("Original");
  await page.evaluate(() => window.artifactsE2E.holdNextRead());
  await page.evaluate((id) => window.artifactsE2E.write(id, "/file.txt", "Older snapshot"), id);
  await page.waitForFunction(() => window.artifactsE2E.readHeld());
  await page.evaluate((id) => window.artifactsE2E.write(id, "/file.txt", "Newest snapshot"), id);
  await expect(page.locator("pre")).toHaveText("Newest snapshot");
  await page.evaluate(() => window.artifactsE2E.releaseRead());
  await expect(page.locator("pre")).toHaveText("Newest snapshot");

  await page.evaluate(() => window.artifactsE2E.holdNextRead());
  await page.evaluate((id) => window.artifactsE2E.write(id, "/file.txt", "Late snapshot"), id);
  await page.waitForFunction(() => window.artifactsE2E.readHeld());
  await selectChat(page, null);
  await page.evaluate(() => window.artifactsE2E.releaseRead());
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.artifactsE2E.state().activeFile)).toBeNull();
});

test("returning to a file during a pending tab switch waits for its fresh content", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.evaluate(async (id) => {
    await window.artifactsE2E.write(id, "/one.txt", "Old content");
    await window.artifactsE2E.write(id, "/two.txt", "Other file");
    window.artifactsE2E.openFile("/one.txt");
    window.artifactsE2E.showDrawer(true);
  }, id);
  await expect(page.locator("pre")).toHaveText("Old content");
  await page.evaluate(() => {
    window.artifactsE2E.holdNextRead();
    window.artifactsE2E.openFile("/two.txt");
  });
  await page.waitForFunction(() => window.artifactsE2E.readHeld());
  await page.evaluate((id) => window.artifactsE2E.write(id, "/one.txt", "Fresh content"), id);
  await page.evaluate(() => {
    window.artifactsE2E.holdNextRead();
    window.artifactsE2E.openFile("/one.txt");
  });
  await page.waitForFunction(() => window.artifactsE2E.readHeld());
  await expect(page.locator("pre")).toHaveCount(0);
  await page.evaluate(() => window.artifactsE2E.releaseRead());
  await expect(page.locator("pre")).toHaveCount(0);
  await page.evaluate(() => window.artifactsE2E.releaseRead());
  await expect(page.locator("pre")).toHaveText("Fresh content");
});

test("an upload finishing after navigation stays in its original chat without selecting a foreign file", async ({
  page,
}) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate(() => window.artifactsE2E.holdUpload());
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "late.txt", mimeType: "text/plain", buffer: Buffer.from("Late upload") });
  await page.waitForFunction(() => window.artifactsE2E.uploadHeld());
  await selectChat(page, null);
  const empty = await ensureChat(page);
  await page.evaluate(() => window.artifactsE2E.releaseUpload());
  await expect
    .poll(() => page.evaluate((id) => window.artifactsE2E.read(id, "/late.txt"), id))
    .toMatchObject({ content: "Late upload" });
  await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.artifactsE2E.state())).toMatchObject({ chatId: empty, activeFile: null });
  expect(await page.evaluate((id) => window.artifactsE2E.read(id, "/late.txt"), empty)).toBeUndefined();
  await selectChat(page, id);
  await expect(page.locator("pre")).toHaveText("Late upload");
});

test("concurrent first-message and filesystem requests use one chat and one workspace", async ({ page }) => {
  await openFixture(page);
  const [first, second] = await page.evaluate(() =>
    Promise.all([window.artifactsE2E.ensureChat(), window.artifactsE2E.ensureChat(), window.artifactsE2E.send()]),
  );
  expect(second).toBe(first);
  await expect
    .poll(() => page.evaluate(() => window.artifactsE2E.state()))
    .toMatchObject({ chatId: first, fsChatId: first, chats: [first], messages: 2 });
});

test("chat creation finishing after navigation does not replace the selected chat or its workspace", async ({
  page,
}) => {
  await openFixture(page);
  const existing = await ensureChat(page);
  await selectChat(page, null);
  await page.evaluate(() => window.artifactsE2E.holdChatSave());
  const pending = page.evaluate(() => window.artifactsE2E.ensureChat());
  await page.waitForFunction(() => window.artifactsE2E.chatSaveHeld());
  await selectChat(page, existing);
  await page.evaluate(() => window.artifactsE2E.releaseChatSave());
  const created = await pending;
  expect(created).not.toBe(existing);
  expect(await page.evaluate(() => window.artifactsE2E.state())).toMatchObject({
    chatId: existing,
    fsChatId: existing,
    activeFile: null,
  });
});

test("file picker, file panel and editor context agree after switching and reopening the drawer", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.evaluate(async (id) => {
    await window.artifactsE2E.write(id, "/one.txt", "One");
    await window.artifactsE2E.write(id, "/two.txt", "Two");
    window.artifactsE2E.openFile("one.txt");
  }, id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("pre")).toHaveText("One");
  await page.getByRole("button", { name: "one.txt", exact: true }).click();
  await page.getByRole("button", { name: "two.txt", exact: true }).click();
  await expect(page.locator("pre")).toHaveText("Two");
  await page.getByRole("button", { name: "one.txt", exact: true }).click();
  await expect(page.locator("pre")).toHaveText("One");
  expect(await page.evaluate(() => window.artifactsE2E.state().runtimeContext)).toContain('open_tabs: ["/one.txt"]');
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("pre")).toHaveText("One");
  await page.evaluate((id) => window.artifactsE2E.remove(id, "/one.txt"), id);
  await expect(page.locator("pre")).toHaveText("Two");
});

for (const language of ["javascript", "python"] as const) {
  test(`${language} editor cancels on file and chat switches and releases the next Run button`, async ({ page }) => {
    await openFixture(page);
    const id = await ensureChat(page);
    const extension = language === "python" ? "py" : "js";
    const loop =
      language === "python"
        ? 'from pathlib import Path\nPath("discard.txt").write_text("discard")\nwhile True: pass'
        : 'vfs.write("/discard.txt", "discard"); while (true) {}';
    const safe = language === "python" ? 'print("Recovered")' : 'console.log("Recovered");';
    await page.evaluate(
      async ({ id, extension, loop, safe }) => {
        await window.artifactsE2E.write(id, `/loop.${extension}`, loop);
        await window.artifactsE2E.write(id, `/safe.${extension}`, safe);
        window.artifactsE2E.openFile(`/loop.${extension}`);
        window.artifactsE2E.showDrawer(true);
      },
      { id, extension, loop, safe },
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Running...", exact: true })).toBeDisabled();
    await page.evaluate((extension) => window.artifactsE2E.openFile(`/safe.${extension}`), extension);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator("pre").filter({ hasText: /^Recovered$/ })).toBeVisible();
    expect(await page.evaluate((id) => window.artifactsE2E.read(id, "/discard.txt"), id)).toBeUndefined();

    await page.evaluate((extension) => window.artifactsE2E.openFile(`/loop.${extension}`), extension);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Running...", exact: true })).toBeDisabled();
    await selectChat(page, null);
    await expect(page.getByText("No artifacts yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Run|Running\.\.\.)$/ })).toHaveCount(0);
    const other = await ensureChat(page);
    const result = await page.evaluate(
      ({ id, language, code }) => window.artifactsE2E.tool(`execute_${language}_code`, { code }, id),
      { id: other, language, code: safe },
    );
    expect(JSON.stringify(result)).toContain("Recovered");
    expect(await page.evaluate((id) => window.artifactsE2E.read(id, "/discard.txt"), id)).toBeUndefined();
  });

  test(`${language} editor runs save generated files and share them with interpreter tools`, async ({ page }) => {
    await openFixture(page);
    const id = await ensureChat(page);
    const path = language === "python" ? "/main.py" : "/main.js";
    const code =
      language === "python"
        ? 'from pathlib import Path\nPath("output.txt").write_text("editor result")\nprint("editor done")'
        : 'vfs.write("/output.txt", "editor result"); console.log("editor done");';
    await page.evaluate(
      async ({ id, path, code }) => {
        await window.artifactsE2E.write(id, path, code);
        window.artifactsE2E.openFile(path);
        window.artifactsE2E.showDrawer(true);
      },
      { id, path, code },
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect
      .poll(() => page.evaluate((id) => window.artifactsE2E.read(id, "/output.txt"), id))
      .toMatchObject({ content: "editor result" });
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    const result = await page.evaluate(
      ({ id, language }) =>
        window.artifactsE2E.tool(
          `execute_${language}_code`,
          {
            code:
              language === "python"
                ? 'from pathlib import Path\nprint(Path("output.txt").read_text())'
                : 'console.log(vfs.read("/output.txt"));',
          },
          id,
        ),
      { id, language },
    );
    expect(JSON.stringify(result)).toContain("editor result");
  });
}

test("artifact changes in another browser tab refresh the selected file without changing chats", async ({
  page,
  context,
}) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/shared.txt", "Before"), id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("pre")).toHaveText("Before");
  const other = await context.newPage();
  await openFixture(other);
  await other.evaluate((id) => window.artifactsE2E.write(id, "/shared.txt", "From another tab"), id);
  await expect(page.locator("pre")).toHaveText("From another tab");
  await other.evaluate((id) => window.artifactsE2E.rename(id, "/shared.txt", "/moved.txt"), id);
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().activeFile)).toBe("/moved.txt");
  expect(await page.evaluate(() => window.artifactsE2E.state().chatId)).toBe(id);
  await other.close();
});
