import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { models: [] } }));
  await page.goto("/tests/browser/fixtures/chat-lifecycle.html");
  await page.waitForFunction(() => window.chatE2E?.state().ready);
}

test("a native question survives reload and resumes from the saved tool call", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.chatE2E.send("Help me choose"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(() =>
    window.chatE2E.callTool(0, "ask_questions", {
      questions: [{ id: "destination", label: "Which destination?", type: "text", required: true }],
    }),
  );
  await expect(page.getByLabel("Which destination?", { exact: false })).toBeVisible();
  const id = await page.evaluate(() => window.chatE2E.state().chatId!);
  // Switching views disposes the old native client. Its cleanup must retain
  // the saved interrupt until the user answers it or explicitly presses Stop.
  await page.evaluate(() => window.chatE2E.select(null));
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  await page.evaluate((id) => window.chatE2E.select(id), id);
  await expect(page.getByLabel("Which destination?", { exact: false })).toBeVisible();
  await page.evaluate(() => window.chatE2E.flush());
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  await page.evaluate((id) => window.chatE2E.select(id), id);
  await expect(page.getByLabel("Which destination?", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(0);
  await page.getByLabel("Which destination?", { exact: false }).fill("Vaduz");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[0].input))).toContain("Vaduz");
  await page.evaluate(() => window.chatE2E.finish(0, "Destination selected"));
  await expect(page.getByTestId("messages")).toContainText("Destination selected");
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
});

test("native skill middleware loads browser resources and persists results across chat runs", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.setChatSkills(true));
  await page.evaluate(() => window.chatE2E.send("Build a report"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  const request = await page.evaluate(() => window.chatE2E.state().calls[0]);
  expect(request.instructions).toContain("fixture:reports");
  expect(request.tools).toContain("load_skill");
  expect(request.tools).toContain("read_skill_resource");
  await page.evaluate(() => window.chatE2E.callTool(0, "load_skill", { name: "fixture:reports" }));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[1].input))).toContain(
    "Verify every report",
  );
  await page.evaluate(() =>
    window.chatE2E.callTool(1, "read_skill_resource", { skill: "fixture:reports", path: "scripts/check.py" }),
  );
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 3);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[2].input))).toContain(
    "print('verified')",
  );
  await page.evaluate(() => window.chatE2E.callTool(2, "load_skill", { name: "fixture:reports" }));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 4);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[3].input))).toContain("already loaded");
  await page.evaluate(() => window.chatE2E.finish(3, "Verified report"));
  await expect(page.getByTestId("messages")).toContainText("Verified report");
  await page.evaluate(() => window.chatE2E.flush());
  const id = await page.evaluate(() => window.chatE2E.state().chatId!);
  expect(await page.evaluate(async (id) => JSON.stringify((await window.chatE2E.load(id)).messages), id)).toContain(
    "Verify every report",
  );

  await page.evaluate(() => window.chatE2E.send("Make another report"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 5);
  await page.evaluate(() => window.chatE2E.callTool(4, "load_skill", { name: "fixture:reports" }));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 6);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[5].input.at(-1)))).toContain(
    "Verify every report",
  );
  await page.evaluate(() => window.chatE2E.finish(5, "Another verified report"));
  await expect(page.getByTestId("messages")).toContainText("Another verified report");
});

for (const existingChat of [false, true]) {
  test(`agent settings survive a missing catalog in ${existingChat ? "an existing" : "a new"} chat`, async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() =>
      window.chatE2E.setModel({
        id: "fixture",
        name: "Fixture",
        effort: "low",
        verbosity: "low",
        supportedEfforts: ["low", "high"],
      }),
    );
    await expect.poll(() => page.evaluate(() => window.chatE2E.state().model?.effort)).toBe("low");
    if (existingChat) {
      await page.evaluate(() => window.chatE2E.send("Before selecting the agent"));
      await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
      await page.evaluate(() => window.chatE2E.finish(0, "Draft updated. First answer"));
      await expect(page.getByTestId("messages")).toContainText("First answer");
    }
    await page.evaluate(() =>
      window.setChatAgent({
        id: "agent",
        name: "Agent",
        model: "fixture",
        effort: "high",
        verbosity: "high",
        skills: [],
        plugins: [],
        tools: [],
        servers: [],
      }),
    );
    await expect
      .poll(() => page.evaluate(() => window.chatE2E.state().model))
      .toMatchObject({
        id: "fixture",
        effort: "high",
        verbosity: "high",
      });
    await page.evaluate(() => window.chatE2E.refreshModels([]));
    await expect
      .poll(() => page.evaluate(() => window.chatE2E.state().model))
      .toMatchObject({
        id: "fixture",
        effort: "high",
        verbosity: "high",
      });
    await page.evaluate(() => window.chatE2E.send("Use the agent settings"));
    const requestIndex = existingChat ? 1 : 0;
    await page.waitForFunction((index) => window.chatE2E.state().calls.length === index + 1, requestIndex);
    expect(await page.evaluate((index) => window.chatE2E.state().calls[index], requestIndex)).toMatchObject({
      model: "fixture",
      effort: "high",
      verbosity: "high",
    });
    await page.evaluate((index) => window.chatE2E.finish(index, "Agent answer"), requestIndex);
    await expect(page.getByTestId("messages")).toContainText("Agent answer");
    if (existingChat) {
      await page.evaluate(() => window.setChatAgent(null));
      await expect
        .poll(() => page.evaluate(() => window.chatE2E.state().model))
        .toMatchObject({
          effort: "low",
          verbosity: "low",
        });
    }
  });
}

test("an unavailable agent model does not apply its settings to a different cached model", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.chatE2E.setModel({ id: "fixture", name: "Fixture", effort: "low" }));
  await page.evaluate(() => window.chatE2E.refreshModels([]));
  await page.evaluate(() =>
    window.setChatAgent({
      id: "agent",
      name: "Agent",
      model: "other",
      effort: "high",
      skills: [],
      plugins: [],
      tools: [],
      servers: [],
    }),
  );
  await expect
    .poll(() => page.evaluate(() => window.chatE2E.state().model))
    .toMatchObject({
      id: "fixture",
      effort: "low",
    });
});

test("streaming leaves list, action, and composer subscribers unchanged; queued sends retain fresh history", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.chatE2E.send("First"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(() => window.chatE2E.stream(0, "Draft"));
  await expect(page.getByTestId("messages")).toContainText("Draft");
  const before = await page.evaluate(() => window.chatE2E.state().renders);
  await page.evaluate(() => window.chatE2E.stream(0, "Draft updated"));
  await expect(page.getByTestId("messages")).toContainText("Draft updated");
  expect(await page.evaluate(() => window.chatE2E.state().renders)).toEqual(before);
  await page.evaluate(() => {
    window.chatE2E.send("Second");
    window.chatE2E.send("Third");
  });
  await page.waitForFunction(() => window.chatE2E.state().queue.length === 2);
  await page.evaluate(() => window.chatE2E.finish(0, "Draft updated. First answer"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
  const input = await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[1].input));
  expect(input).toContain("First answer");
  expect(input).toContain("Second");
  expect(input).toContain("Third");
  await page.evaluate(() => window.chatE2E.finish(1, "Done"));
  await expect(page.getByTestId("messages")).toContainText("Done");
});

test("stop discards queued sends, and late callbacks cannot overwrite a restarted run", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.chatE2E.send("First"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(() => window.chatE2E.stream(0, "Partial"));
  await expect(page.getByTestId("messages")).toContainText("Partial");
  await page.evaluate(() => window.chatE2E.send("Queued"));
  await page.waitForFunction(() => window.chatE2E.state().queue.length === 1);
  await page.evaluate(() => window.chatE2E.stop());
  expect(await page.evaluate(() => window.chatE2E.state().queue)).toEqual([]);
  await page.evaluate(() => window.chatE2E.send("New request"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
  await page.evaluate(() => {
    window.chatE2E.stream(0, "Stale draft");
    window.chatE2E.finish(0, "Stale answer");
    window.chatE2E.finish(1, "Current answer");
  });
  await expect(page.getByTestId("messages")).toContainText("Current answer");
  await expect(page.getByTestId("messages")).not.toContainText("Stale");
  expect(await page.evaluate(() => window.chatE2E.state().calls[0].aborted)).toBe(true);
});

test("startup reads entries only, selection is race safe, and media stays deferred until visible", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.chatE2E.seed("first", [
      { type: "text", text: "search needle" },
      { type: "image", data: "data:image/jpeg;base64,YWJj" },
    ]);
    await window.chatE2E.seed("second", [{ type: "text", text: "Other chat" }]);
  });
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  expect(await page.evaluate(() => window.chatE2E.state().reads.filter((path) => path.startsWith("chats/")))).toEqual([
    "chats/index.json",
  ]);
  expect(await page.evaluate(() => window.chatE2E.search("needle"))).toEqual(["first"]);
  expect(await page.evaluate(() => window.chatE2E.state().reads.some((path) => path.includes("/blobs/")))).toBe(false);
  await page.evaluate(() => {
    window.chatE2E.holdRead("first");
    window.chatE2E.select("first");
  });
  await page.waitForFunction(() => window.chatE2E.readHeld());
  expect(await page.evaluate(() => window.chatE2E.state().loading)).toBe(true);
  await page.evaluate(() => window.chatE2E.select("second"));
  await page.waitForFunction(() => window.chatE2E.state().loadedId === "second");
  await page.evaluate(() => window.chatE2E.releaseRead());
  await expect(page.getByTestId("messages")).toHaveText("Other chat");
  await page.evaluate(() => window.chatE2E.select("first"));
  await expect(page.getByTestId("messages")).toContainText("search needle");
  expect(await page.evaluate(() => window.chatE2E.state().reads.some((path) => path.includes("/blobs/")))).toBe(false);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByTestId("attachment")).toContainText("data:image/jpeg;base64,YWJj");
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().messages))).toContain("blob:sha256-");
});

test("replacing or unmounting elicitation settles every pending promise", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.chatE2E.ask("first");
    window.chatE2E.ask("second");
  });
  await page.waitForFunction(() => window.chatE2E.state().results.length === 1);
  expect(await page.evaluate(() => window.chatE2E.state().results[0])).toEqual({
    id: "first",
    result: { action: "cancel" },
  });
  await page.evaluate(() => window.chatE2E.answer({ action: "accept", content: {} }));
  await page.waitForFunction(() => window.chatE2E.state().results.length === 2);
  await page.evaluate(() => window.chatE2E.ask("third"));
  await page.waitForFunction(() => window.chatE2E.state().pending === "third");
  await page.evaluate(() => window.chatE2E.unmount());
  expect(await page.evaluate(() => window.chatE2E.state().results.at(-1))).toEqual({
    id: "third",
    result: { action: "cancel" },
  });
});

test("a send delayed by loading is discarded if the user navigates to another chat", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.chatE2E.seed("first", [{ type: "text", text: "First history" }]);
    await window.chatE2E.seed("second", [{ type: "text", text: "Second history" }]);
  });
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  await page.evaluate(() => {
    window.chatE2E.holdRead("first");
    window.chatE2E.select("first");
    window.chatE2E.send("Wait for me");
  });
  await page.waitForFunction(() => window.chatE2E.readHeld());
  await page.evaluate(() => window.chatE2E.select("second"));
  await page.waitForFunction(() => window.chatE2E.state().loadedId === "second");
  await page.evaluate(async () => {
    window.chatE2E.releaseRead();
    await window.chatE2E.load("first");
  });
  await page.evaluate(() => window.chatE2E.select("first"));
  await page.waitForFunction(() => window.chatE2E.state().loadedId === "first");
  const state = await page.evaluate(() => window.chatE2E.state());
  expect(state.queue).toEqual([]);
  expect(state.calls).toHaveLength(0);
});
