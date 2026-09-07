import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { models: [] } }));
  await page.goto("/tests/browser/fixtures/chat-lifecycle.html");
  await page.waitForFunction(() => window.chatE2E?.state().ready);
}

test("streaming leaves list, action, and composer subscribers unchanged; queued sends retain fresh history", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.chatE2E.send("First"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(() => window.chatE2E.stream(0, "Draft one"));
  await expect(page.getByTestId("messages")).toContainText("Draft one");
  const before = await page.evaluate(() => window.chatE2E.state().renders);
  await page.evaluate(() => window.chatE2E.stream(0, "Draft two"));
  await expect(page.getByTestId("messages")).toContainText("Draft two");
  expect(await page.evaluate(() => window.chatE2E.state().renders)).toEqual(before);
  await page.evaluate(() => {
    window.chatE2E.send("Second");
    window.chatE2E.send("Third");
  });
  await page.waitForFunction(() => window.chatE2E.state().queue.length === 2);
  await page.evaluate(() => window.chatE2E.finish(0, "First answer"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
  const input = await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[1].input));
  expect(input).toContain("First answer");
  expect(input).toContain("Second");
  expect(input).toContain("Third");
  await page.evaluate(() => window.chatE2E.finish(1, "Done"));
  await expect(page.getByTestId("messages")).toContainText("Done");
});

test("stop holds queued sends, and late callbacks cannot overwrite a restarted run", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.chatE2E.send("First"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(() => window.chatE2E.stream(0, "Partial"));
  await expect(page.getByTestId("messages")).toContainText("Partial");
  await page.evaluate(() => window.chatE2E.send("Queued"));
  await page.waitForFunction(() => window.chatE2E.state().queue.length === 1);
  await page.evaluate(() => window.chatE2E.stop());
  const held = await page.evaluate(() => window.chatE2E.state().queue[0]);
  expect(held.status).toBe("held");
  await page.evaluate((id) => window.chatE2E.sendHeld(id), held.id);
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

test("a send delayed by loading is held if the user navigates to another chat", async ({ page }) => {
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
  await page.waitForFunction(() => window.chatE2E.state().queue.length === 1);
  const state = await page.evaluate(() => window.chatE2E.state());
  expect(state.queue[0].status).toBe("held");
  expect(state.calls).toHaveLength(0);
});
