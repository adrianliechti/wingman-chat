import { expect, test, type Frame, type Page } from "@playwright/test";

async function guest(page: Page, id: string): Promise<Frame> {
  const proxy = await (await page.getByTestId(id).locator("iframe").elementHandle())!.contentFrame();
  await expect.poll(() => proxy!.childFrames().length).toBe(1);
  const frame = proxy!.childFrames()[0];
  await expect
    .poll(() =>
      frame.evaluate(
        () =>
          (window as any).guest?.state.events.filter((event: any) => event.method === "ui/notifications/tool-result")
            .length,
      ),
    )
    .toBe(1);
  return frame;
}
async function request(frame: Frame, id: string, method: string, params: unknown) {
  await frame.evaluate(({ id, method, params }) => (window as any).guest.request(id, method, params), {
    id,
    method,
    params,
  });
  await expect.poll(() => frame.evaluate((id) => (window as any).guest.state.replies[id], id)).toBeTruthy();
  return frame.evaluate((id) => (window as any).guest.state.replies[id], id);
}

test("two real sandboxes keep independent data and survive panel switching without reloads", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/mcp-apps.html");
  const first = await guest(page, "first");
  const second = await guest(page, "second");
  const initial = await first.evaluate(() => (window as any).guest.state);
  expect(
    initial.events
      .filter((event: any) => event.method.startsWith("ui/notifications/tool-"))
      .map((event: any) => event.params),
  ).toEqual([
    { arguments: { id: "first" } },
    { content: [{ type: "text", text: "first" }], structuredContent: { id: "first" } },
  ]);
  await expect(first.locator("#label")).toHaveText("Grüezi 世界");
  await page.getByTestId("first").getByRole("button").click();
  await expect.poll(() => first.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("fullscreen");
  await page.getByTestId("second").getByRole("button").click();
  await expect.poll(() => second.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("fullscreen");
  await expect.poll(() => first.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("inline");
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect.poll(() => second.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("inline");
  expect(await first.evaluate(() => (window as any).guest.state.instance)).toBe(initial.instance);
  expect(await page.evaluate(() => window.mcpE2E.state().reads)).toBe(2);
});

test("fullscreen-only apps share one panel and closing it hides the active iframe", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/fixtures/mcp-apps.html?fullscreen");
  const first = await guest(page, "first");
  await guest(page, "second");
  await expect.poll(() => page.evaluate(() => window.mcpE2E.state().active)).toContain("second");
  await expect(page.getByTestId("first").locator("iframe")).not.toBeVisible();
  await expect(page.getByTestId("second").locator("iframe")).toBeVisible();
  await page.getByTestId("first").getByRole("button").click();
  await expect(page.getByTestId("first").locator("iframe")).toBeVisible();
  await expect(page.getByTestId("second").locator("iframe")).not.toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByTestId("first").locator("iframe")).not.toBeVisible();
  expect(await first.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("fullscreen");
  expect(errors).toEqual([]);
});

test("server notifications reach both apps and updated visibility is enforced on guest calls", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/mcp-apps.html");
  const first = await guest(page, "first");
  const second = await guest(page, "second");
  expect(
    (await request(first, "allowed", "tools/call", { name: "guest_only", arguments: {} })).result.content[0].text,
  ).toBe("guest_only");
  expect(
    (await request(second, "denied", "tools/call", { name: "model_only", arguments: {} })).error.message,
  ).toContain("not available");
  await page.evaluate(() => window.mcpE2E.changed());
  for (const frame of [first, second]) {
    await expect
      .poll(() =>
        frame.evaluate(() =>
          (window as any).guest.state.events.some((event: any) => event.method === "notifications/tools/list_changed"),
        ),
      )
      .toBe(true);
  }
  expect(
    (await request(first, "removed", "tools/call", { name: "guest_only", arguments: {} })).error.message,
  ).toContain("not available");
  await page.evaluate(() => window.mcpE2E.remove("first"));
  expect(
    (await request(second, "still-alive", "tools/call", { name: "added", arguments: {} })).result.content[0].text,
  ).toBe("added");
  expect(await page.evaluate(() => window.mcpE2E.state().calls)).toEqual(["guest_only", "added"]);
});

test("unmount during resource loading cannot revive the removed app or disturb another iframe", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/mcp-apps.html");
  const second = await guest(page, "second");
  await page.evaluate(() => {
    window.mcpE2E.hold();
    window.mcpE2E.add("late");
  });
  await expect.poll(() => page.evaluate(() => window.mcpE2E.state().reads)).toBe(3);
  await page.evaluate(() => window.mcpE2E.remove("late"));
  await page.evaluate(() => window.mcpE2E.release());
  await expect(page.getByTestId("late")).toHaveCount(0);
  expect((await request(second, "alive", "tools/call", { name: "app", arguments: {} })).result.content[0].text).toBe(
    "app",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("checks message sources and links, and acknowledges the actual requested display mode", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/mcp-apps.html");
  const first = await guest(page, "first");
  await guest(page, "second");
  await page.evaluate(() =>
    window.postMessage({ jsonrpc: "2.0", id: "forged-parent", method: "tools/call", params: { name: "app" } }, "*"),
  );
  await first.evaluate(() =>
    parent.parent.postMessage(
      { jsonrpc: "2.0", id: "forged-guest", method: "tools/call", params: { name: "app" } },
      "*",
    ),
  );
  expect(
    (await request(first, "link", "ui/open-link", { url: "javascript:window.compromised=true" })).result.isError,
  ).toBe(true);
  expect((await request(first, "mode", "ui/request-display-mode", { mode: "fullscreen" })).result.mode).toBe(
    "fullscreen",
  );
  await expect.poll(() => first.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("fullscreen");
  expect((await request(first, "unsupported", "ui/request-display-mode", { mode: "pip" })).result.mode).toBe(
    "fullscreen",
  );
  expect((await request(first, "inline", "ui/request-display-mode", { mode: "inline" })).result.mode).toBe("inline");
  await expect.poll(() => first.evaluate(() => (window as any).guest.state.host.displayMode)).toBe("inline");
  expect(await page.evaluate(() => window.mcpE2E.state().calls)).toEqual([]);
});
