import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { models: [] } }));
  await page.goto("/tests/browser/fixtures/persistence.html");
  await page.waitForFunction(() => window.persistenceE2E?.state().ready && window.profileE2E?.isLoaded);
}

test("chat edits in the same event persist once with their combined changes and survive reload", async ({ page }) => {
  await open(page);
  const id = await page.evaluate(async () => {
    const api = window.persistenceE2E;
    const chat = await api.createChat();
    api.updateChat(chat.id, () => ({ title: "First" }));
    api.updateChat(chat.id, (current) => ({ customTitle: `${current.title} + second`, customIndex: 7 }));
    await api.flush();
    return chat.id;
  });
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().ready);
  expect(await page.evaluate(() => window.persistenceE2E.state().chats)).toMatchObject([
    { id, title: "First", customTitle: "First + second", customIndex: 7 },
  ]);
});

test("deletion during a held chat save cannot recreate the chat or its index entry", async ({ page }) => {
  await open(page);
  const id = await page.evaluate(async () => (await window.persistenceE2E.createChat()).id);
  await page.evaluate((id) => {
    const api = window.persistenceE2E;
    api.holdWrite(`chats/${id}/chat.json`);
    api.updateChat(id, () => ({ title: "In flight" }));
    api.startFlush();
  }, id);
  await page.waitForFunction(() => window.persistenceE2E.held());
  await page.evaluate((id) => {
    window.persistenceE2E.deleteChat(id);
    window.persistenceE2E.release();
  }, id);
  await page.evaluate(() => window.persistenceE2E.finishFlush());
  expect(await page.evaluate(() => window.persistenceE2E.list("chats"))).toEqual([]);
  expect(await page.evaluate(() => window.persistenceE2E.read("chats/index.json"))).toEqual([]);
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().ready);
  expect(await page.evaluate(() => window.persistenceE2E.state().chats)).toEqual([]);
});

test("concurrent creates from two tabs preserve every chat in the index", async ({ page, context }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  const ids = (
    await Promise.all(
      [page, other].map((tab) =>
        tab.evaluate(async () =>
          (await Promise.all(Array.from({ length: 4 }, () => window.persistenceE2E.createChat()))).map(
            (chat) => chat.id,
          ),
        ),
      ),
    )
  )
    .flat()
    .sort();
  const stored = await page.evaluate(async () =>
    (await window.persistenceE2E.read<{ id: string }[]>("chats/index.json"))!.map((entry) => entry.id).sort(),
  );
  expect(stored).toEqual(ids);
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().ready);
  expect(
    await page.evaluate(() =>
      window.persistenceE2E
        .state()
        .chats.map((chat) => chat.id)
        .sort(),
    ),
  ).toEqual(ids);
});

test("agent file and server changes share one selected snapshot and persist deletions", async ({ page }) => {
  await open(page);
  const id = await page.evaluate(async () => {
    const api = window.persistenceE2E;
    const agent = await api.createAgent('Research: "quoted"\nname', { tools: ["mcp:tool,one"], memory: true });
    const file = {
      id: "file",
      name: "test.txt",
      text: "",
      status: "completed" as const,
      progress: 100,
      uploadedAt: new Date(),
      segments: [{ text: "chunk", vector: [0.5, 1] }],
    };
    api.upsertFile(agent.id, file);
    const server = api.addServer(agent.id, {
      name: "Server",
      description: "",
      url: "https://example.test/mcp",
      enabled: true,
    });
    api.toggleServer(agent.id, server.id);
    await api.flush();
    return agent.id;
  });
  await expect
    .poll(() => page.evaluate(() => window.persistenceE2E.state().currentAgent))
    .toMatchObject({ id, files: [{ id: "file", text: "" }], servers: [{ enabled: false }] });
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().currentAgent);
  expect(await page.evaluate(() => window.persistenceE2E.state().currentAgent)).toMatchObject({
    name: 'Research: "quoted"\nname',
    tools: ["mcp:tool,one"],
    files: [{ id: "file", text: "" }],
  });
  await page.evaluate(async (id) => {
    window.persistenceE2E.removeFile(id, "file");
    await window.persistenceE2E.flush();
  }, id);
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().currentAgent);
  expect(await page.evaluate(() => window.persistenceE2E.state().currentAgent!.files ?? [])).toEqual([]);
});

test("clearing a profile then unmounting flushes the deletion", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.profileE2E.setValue({ name: "Before" }));
  await expect(page.getByTestId("profile")).toHaveText("Before");
  await page.evaluate(() => window.profileE2E.flush());
  await page.evaluate(() => window.profileE2E.setValue({}));
  await expect(page.getByTestId("profile")).toHaveText("empty");
  await page.evaluate(() => window.persistenceE2E.showProfile(false));
  await expect(page.getByTestId("profile")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.persistenceE2E.read("profile.json")), { timeout: 3000 })
    .toBeUndefined();
});

test("changing the profile key saves the old edit to its original file", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.persistenceE2E.write("second.json", { name: "Second" });
    window.profileE2E.setValue({ name: "First pending edit" });
    window.persistenceE2E.setStorageKey("second.json");
  });
  await expect(page.getByTestId("profile")).toHaveText("Second");
  await page.evaluate(() => window.persistenceE2E.flush());
  expect(await page.evaluate(() => window.persistenceE2E.read("profile.json"))).toEqual({ name: "First pending edit" });
  expect(await page.evaluate(() => window.persistenceE2E.read("second.json"))).toEqual({ name: "Second" });
});

test("edits during a delayed profile load keep saved fields and the user's newer input", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.persistenceE2E.write("second.json", { name: "Saved", role: "Keep" });
    window.persistenceE2E.holdRead("second.json");
    window.persistenceE2E.setStorageKey("second.json");
  });
  await page.waitForFunction(() => window.persistenceE2E.held());
  await page.evaluate(() => {
    window.profileE2E.setValue((value) => ({ ...value, name: "Edited" }));
    window.persistenceE2E.release();
  });
  await page.waitForFunction(() => window.profileE2E.isLoaded);
  await page.evaluate(() => window.profileE2E.flush());
  expect(await page.evaluate(() => window.persistenceE2E.read("second.json"))).toEqual({
    name: "Edited",
    role: "Keep",
  });
});

test("same-event skill additions use one identity and renames survive reload without duplicates", async ({ page }) => {
  await open(page);
  const id = await page.evaluate(async () => {
    const api = window.persistenceE2E;
    const first = api.addSkill({ name: "example", description: 'Line: "one"\nLine two', content: "Body" });
    const second = api.addSkill({ name: "example", description: 'Line: "one"\nLine two', content: "Latest" });
    if (first.id !== second.id) throw new Error("Duplicate skill identities");
    await api.flush();
    api.updateSkill(first.id, { name: "renamed" });
    await api.flush();
    return first.id;
  });
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().skills.length === 1);
  expect(await page.evaluate(() => window.persistenceE2E.state().skills)).toMatchObject([
    { id, name: "renamed", description: 'Line: "one"\nLine two', content: "Latest" },
  ]);
  expect(await page.evaluate(() => window.persistenceE2E.list("skills"))).toEqual(["renamed"]);
  await page.evaluate(async (id) => {
    window.persistenceE2E.removeSkill(id);
    await window.persistenceE2E.flush();
  }, id);
  expect(await page.evaluate(() => window.persistenceE2E.read("skills/index.json"))).toEqual([]);
});

test("backups flush pending chat, image, agent, skill and profile data and restore it alongside existing records", async ({
  page,
}) => {
  await open(page);
  const { bytes, id } = await page.evaluate(async () => {
    const api = window.persistenceE2E;
    const chat = await api.createChat();
    api.updateChat(chat.id, () => ({
      customTitle: "Backup",
      messages: [{ role: "user", content: [{ type: "image", data: "data:image/jpeg;base64,YWJj" }] }],
    }));
    await api.createAgent("Agent");
    await api.createImage({ model: "renderer", prompt: "Prompt", data: "data:image/png;base64,YWJj" });
    api.addSkill({ name: "backup-skill", description: "Description", content: "Body" });
    window.profileE2E.setValue({ name: "Latest profile" });
    return { bytes: await api.backup(), id: chat.id };
  });
  const extra = await page.evaluate(
    async ({ id, bytes }) => {
      const api = window.persistenceE2E;
      api.deleteChat(id);
      await api.flush();
      const extra = await api.createChat();
      await api.restore(bytes);
      return extra.id;
    },
    { id, bytes },
  );
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().ready && window.profileE2E?.isLoaded);
  const state = await page.evaluate(() => window.persistenceE2E.state());
  expect(state.chats.map((chat) => chat.id).sort()).toEqual([id, extra].sort());
  expect(state.chats.find((chat) => chat.id === id)).toMatchObject({
    customTitle: "Backup",
  });
  const loaded = await page.evaluate((id) => window.persistenceE2E.loadChat(id), id);
  expect(loaded.messages[0].content[0]).toMatchObject({ type: "image" });
  expect(JSON.stringify(loaded.messages)).toContain("blob:sha256-");
  expect(state.agents).toHaveLength(1);
  expect(state.skills).toHaveLength(1);
  expect(state.images).toMatchObject([{ data: "data:image/png;base64,YWJj" }]);
  expect(await page.evaluate(() => window.profileE2E.value)).toEqual({ name: "Latest profile" });
});

test("a failed agent save rolls back real OPFS files and a subsequent flush retries the latest edit", async ({
  page,
}) => {
  await open(page);
  const id = await page.evaluate(async () => (await window.persistenceE2E.createAgent("Before")).id);
  const error = await page.evaluate(async (id) => {
    const api = window.persistenceE2E;
    api.holdWrite(`agents/${id}/AGENTS.md`, true);
    api.updateAgent(id, {
      name: "After",
      servers: [{ id: "new", name: "New", description: "", url: "https://example.test", enabled: true }],
    });
    try {
      await api.flush();
      return "unexpected success";
    } catch {
      return "failed";
    }
  }, id);
  expect(error).toBe("failed");
  expect(await page.evaluate((id) => window.persistenceE2E.read(`agents/${id}/servers.json`), id)).toBeUndefined();
  await page.evaluate(() => window.persistenceE2E.flush());
  await page.reload();
  await page.waitForFunction(() => window.persistenceE2E?.state().currentAgent?.name === "After");
  expect(await page.evaluate(() => window.persistenceE2E.state().currentAgent)).toMatchObject({
    servers: [{ id: "new" }],
  });
});
