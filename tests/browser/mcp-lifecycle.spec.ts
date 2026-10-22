import { expect, test as base, type Page } from "@playwright/test";
import { Server, createMcpHandler, inputRequired, inputResponse } from "@modelcontextprotocol/server";
import { mcpToolName } from "../../src/features/settings/lib/mcpToolNames";

const test = base.extend({
  context: async ({ browserName, context, playwright, baseURL, viewport }, use, info) => {
    if (browserName !== "webkit") return use(context);
    const persistent = await playwright.webkit.launchPersistentContext(info.outputPath("webkit-profile"), {
      baseURL,
      viewport,
    });
    try {
      await use(persistent);
    } finally {
      await persistent.close();
    }
  },
});

const toolName = mcpToolName("internet", "web_research");
const handlers: ReturnType<typeof createMcpHandler>[] = [];
test.afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
});

async function setup(page: Page, mode: "plain" | "form" | "url" | "url-hold" | "hold" = "plain") {
  const requests: { input: unknown; action?: string; content?: unknown }[] = [];
  let release: (() => void) | undefined;
  let holdDiscovery = false;
  const discoveryWaiters = new Set<() => void>();
  const handler = createMcpHandler(() => {
    const server = new Server({ name: "Research", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", async () => {
      if (holdDiscovery)
        await new Promise<void>((resolve) => {
          discoveryWaiters.add(resolve);
        });
      return {
        tools: [
          {
            name: "web_research",
            inputSchema: {
              type: "object",
              properties: { instructions: { type: "string" } },
              required: ["instructions"],
            },
          },
        ],
      };
    });
    server.setRequestHandler("tools/call", async (request, ctx) => {
      const response = inputResponse(ctx.mcpReq.inputResponses, "consent");
      requests.push({
        input: request.params.arguments,
        ...(response.kind === "elicit" ? { action: response.action, content: response.content } : {}),
      });
      if (mode === "hold" || (mode === "url-hold" && response.kind === "elicit"))
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if ((mode === "form" || mode === "url" || mode === "url-hold") && response.kind === "missing") {
        return inputRequired({
          inputRequests: {
            consent:
              mode === "form"
                ? inputRequired.elicit({
                    message: "Choose a source",
                    requestedSchema: {
                      type: "object",
                      properties: { source: { type: "string", title: "Source" } },
                      required: ["source"],
                    },
                  })
                : {
                    method: "elicitation/create",
                    params: {
                      mode: "url",
                      elicitationId: "external",
                      message: "Connect a source",
                      url: "https://example.test/consent",
                    },
                  },
          },
          requestState: "consent-state",
        });
      }
      return {
        content: [
          { type: "text", text: response.kind === "elicit" ? `Consent: ${response.action}` : "Research evidence" },
        ],
      };
    });
    return server;
  });
  handlers.push(handler);
  await page.route("**/config.json", (route) => route.fulfill({ json: { models: [] } }));
  await page.context().route("https://example.test/consent", (route) => route.fulfill({ body: "Connected" }));
  await page.route("**/fixture-mcp", async (route) => {
    const request = route.request();
    const response = await handler.fetch(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        ...(request.postData() ? { body: request.postData()! } : {}),
      }),
    );
    const body = await response.text();
    await route
      .fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body })
      .catch(() => {});
  });
  await page.goto("/tests/browser/fixtures/chat-lifecycle.html?mcp");
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  return {
    requests,
    release: () => release?.(),
    holdDiscovery: () => {
      holdDiscovery = true;
    },
    discoveryHeld: () => !!discoveryWaiters.size,
    releaseDiscovery: () => {
      holdDiscovery = false;
      for (const resolve of discoveryWaiters) resolve();
      discoveryWaiters.clear();
    },
  };
}

async function start(page: Page) {
  await page.evaluate(() => window.chatE2E.send("Research a topic"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate((name) => window.chatE2E.callTool(0, name, { instructions: "Find public evidence" }), toolName);
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
  return page.evaluate(() => window.chatE2E.state().chatId!);
}

async function reloadChat(page: Page, id: string) {
  await page.evaluate(() => window.chatE2E.flush());
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  await page.evaluate((id) => window.chatE2E.select(id), id);
  await page.waitForFunction((id) => window.chatE2E.state().loadedId === id, id);
}

async function startBatch(page: Page) {
  await page.evaluate(() => window.chatE2E.send("Compare two sources"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(
    (name) =>
      window.chatE2E.callTools(0, [
        { name, args: { instructions: "Public source" } },
        { name, args: { instructions: "Private source" } },
      ]),
    toolName,
  );
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toHaveCount(2);
  return page.evaluate(() => window.chatE2E.state().chatId!);
}

test("parallel approvals remain atomic through a staged decision, reload, and mixed responses", async ({ page }) => {
  const server = await setup(page);
  const id = await startBatch(page);
  const publicRequest = page.locator("fieldset").filter({ hasText: "Public source" });
  const privateRequest = page.locator("fieldset").filter({ hasText: "Private source" });
  await publicRequest.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(publicRequest.getByRole("button", { name: "Allow", exact: true })).toBeDisabled();
  expect(server.requests).toHaveLength(0);

  await reloadChat(page, id);
  // Staged answers are not durable. A reload must ask again before executing any sibling.
  await expect(publicRequest.getByRole("button", { name: "Allow", exact: true })).toBeEnabled();
  await expect(privateRequest.getByRole("button", { name: "Allow", exact: true })).toBeEnabled();
  expect(server.requests).toHaveLength(0);
  await privateRequest.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(privateRequest.getByRole("button", { name: "Decline", exact: true })).toBeDisabled();
  expect(server.requests).toHaveLength(0);
  await publicRequest.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  expect(server.requests.map((request) => request.input)).toEqual([{ instructions: "Public source" }]);
  const input = await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[0].input));
  expect(input).toContain("Research evidence");
  expect(input).toMatch(/denied|declined|not approved/i);
  await page.evaluate(() => window.chatE2E.finish(0, "Compared the permitted source"));
  await expect(page.getByTestId("messages")).toContainText("Compared the permitted source");
  await reloadChat(page, id);
  await expect(page.getByTestId("messages")).toContainText("Compared the permitted source");
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  expect(server.requests).toHaveLength(1);
  expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(0);
});

test("a completed tool is never replayed when a later mixed question and approval batch reloads", async ({ page }) => {
  const server = await setup(page);
  const id = await start(page);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
  expect(server.requests).toHaveLength(1);
  await page.evaluate(
    (name) =>
      window.chatE2E.callTools(1, [
        { name, args: { instructions: "Extra source" } },
        {
          name: "ask_questions",
          args: { questions: [{ id: "scope", label: "Which scope?", type: "text", required: true }] },
        },
      ]),
    toolName,
  );
  // The engine collects approvals before executing generic interrupt tools.
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeEnabled();
  await reloadChat(page, id);
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeEnabled();
  expect(server.requests).toHaveLength(1);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByLabel("Which scope?", { exact: false })).toBeVisible();
  await reloadChat(page, id);
  await expect(page.getByLabel("Which scope?", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
  await page.getByLabel("Which scope?", { exact: false }).fill("Only the original public evidence");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  const input = await page.evaluate(() => JSON.stringify(window.chatE2E.state().calls[0].input));
  expect(input).toContain("Research evidence");
  expect(input).toContain("Only the original public evidence");
  expect(server.requests).toHaveLength(1);
  await page.evaluate(() => window.chatE2E.finish(0, "Report based on the original evidence"));
  await expect(page.getByTestId("messages")).toContainText("Report based on the original evidence");
  await reloadChat(page, id);
  await expect(page.getByTestId("messages")).toContainText("Report based on the original evidence");
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  const record = await page.evaluate((id) => window.chatE2E.readRecord(id), id);
  const completed = record!.messages
    .flatMap((message) => message.parts)
    .filter(
      (part) => part.type === "tool-call" && part.name === toolName && part.arguments.includes("Find public evidence"),
    );
  expect(completed).toHaveLength(1);
  expect(JSON.stringify(completed[0])).toContain("Research evidence");
  expect(server.requests).toHaveLength(1);
});

test("Stop cancels a partially approved batch and permits a clean new turn after reload", async ({ page }) => {
  const server = await setup(page);
  const id = await startBatch(page);
  await page
    .locator("fieldset")
    .filter({ hasText: "Public source" })
    .getByRole("button", { name: "Allow", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  await reloadChat(page, id);
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  await page.evaluate(() => window.chatE2E.send("Start a different task"));
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
  await page.evaluate(() => window.chatE2E.finish(0, "Clean recovery"));
  await expect(page.getByTestId("messages")).toContainText("Clean recovery");
  await reloadChat(page, id);
  await expect(page.getByTestId("messages")).toContainText("Clean recovery");
  expect(server.requests).toHaveLength(0);
});

for (const corruption of ["missing", "incomplete"] as const) {
  test(`a ${corruption} saved binding abandons the entire approval batch and preserves its recovery record`, async ({
    page,
  }) => {
    const server = await setup(page);
    const id = await startBatch(page);
    await page.evaluate(() => window.chatE2E.flush());
    await page.evaluate(() => window.chatE2E.unmount());
    await page.evaluate(() => window.chatE2E.flush());
    const original = await page.evaluate(
      async ({ id, corruption }) => {
        const record = (await window.chatE2E.readRecord(id))!;
        const interrupt = record.resume!.pendingInterrupts![0];
        interrupt.metadata = {
          ...interrupt.metadata,
          "tanstack:interruptBinding": corruption === "missing" ? undefined : { generation: 0 },
        };
        await window.chatE2E.writeRecord(id, record);
        return window.chatE2E.readRecord(id);
      },
      { id, corruption },
    );
    expect(original!.resume!.pendingInterrupts).toHaveLength(2);
    await reloadChat(page, id);
    await expect(page.getByTestId("messages")).toContainText("Compare two sources");
    await expect(page.getByLabel("Agent requests")).toHaveCount(0);
    expect(await page.evaluate((id) => window.chatE2E.readRecord(id, true), id)).toEqual(original);
    expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(0);
    await page.evaluate(() => window.chatE2E.send("Fresh task after migration"));
    await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
    await page.evaluate(() => window.chatE2E.finish(0, "Recovered without executing old tools"));
    await expect(page.getByTestId("messages")).toContainText("Recovered without executing old tools");
    await reloadChat(page, id);
    await expect(page.getByTestId("messages")).toContainText("Recovered without executing old tools");
    await expect(page.getByLabel("Agent requests")).toHaveCount(0);
    expect(await page.evaluate((id) => window.chatE2E.readRecord(id, true), id)).toEqual(original);
    expect(server.requests).toHaveLength(0);
  });
}

for (const action of ["Allow", "Decline", "Cancel"] as const) {
  test(`MCP ${action} after chat switch and reload sends input only on approval`, async ({ page }) => {
    const server = await setup(page);
    const id = await start(page);
    expect(server.requests).toHaveLength(0);
    await page.evaluate(() => window.chatE2E.select(null));
    await expect(page.getByLabel("Agent requests")).toHaveCount(0);
    await page.evaluate((id) => window.chatE2E.select(id), id);
    await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
    await page.evaluate(() => window.chatE2E.flush());
    server.holdDiscovery();
    await page.reload();
    await page.waitForFunction(() => !!window.chatE2E);
    await page.evaluate((id) => window.chatE2E.select(id), id);
    await expect.poll(server.discoveryHeld).toBe(true);
    expect(server.requests).toHaveLength(0);
    server.releaseDiscovery();
    await page.waitForFunction(() => window.chatE2E.state().ready);
    await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(0);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByLabel("Agent requests")).toHaveCount(0);
    if (action === "Allow") {
      await expect.poll(() => server.requests.length).toBe(1);
      expect(server.requests[0].input).toEqual({ instructions: "Find public evidence" });
    } else expect(server.requests).toHaveLength(0);
    await page.waitForFunction(() => window.chatE2E.state().calls.length === 1);
    await page.evaluate(() => window.chatE2E.finish(0, "Handled the decision"));
    await expect(page.getByTestId("messages")).toContainText("Handled the decision");
    await page.evaluate(() => window.chatE2E.flush());
    await page.reload();
    await page.waitForFunction(() => window.chatE2E?.state().ready);
    await page.evaluate((id) => window.chatE2E.select(id), id);
    await expect(page.getByLabel("Agent requests")).toHaveCount(0);
    expect(server.requests).toHaveLength(action === "Allow" ? 1 : 0);
  });
}

for (const action of ["Submit", "Decline", "Cancel"] as const) {
  test(`server form elicitation ${action} reaches the gateway with the correct action`, async ({ page }) => {
    const server = await setup(page, "form");
    await start(page);
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByLabel("Source", { exact: false })).toBeVisible();
    if (action === "Submit") await page.getByLabel("Source", { exact: false }).fill("Primary sources");
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => server.requests.length).toBe(2);
    expect(server.requests[1].action).toBe(action === "Submit" ? "accept" : action.toLowerCase());
    if (action === "Submit") expect(server.requests[1].content).toEqual({ source: "Primary sources" });
    else expect(server.requests[1].content).toBeUndefined();
    await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
    await page.evaluate(() => window.chatE2E.finish(1, "Answered"));
    await expect(page.getByTestId("messages")).toContainText("Answered");
  });
}

test("URL consent is sent without requiring a completion notification", async ({ page }) => {
  const server = await setup(page, "url");
  await start(page);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.getByRole("link", { name: "Open page (opens in a new tab)", exact: true }).click();
  await expect.poll(() => server.requests.length).toBe(2);
  expect(server.requests[1].action).toBe("accept");
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
});

test("Stop before approval persists cancellation and never contacts the gateway", async ({ page }) => {
  const server = await setup(page);
  const id = await start(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  await page.evaluate(() => window.chatE2E.flush());
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  await page.evaluate((id) => window.chatE2E.select(id), id);
  await expect(page.getByLabel("Agent requests")).toHaveCount(0);
  expect(server.requests).toHaveLength(0);
});

test("Stop during research ignores the late result and does not replay after reload", async ({ page }) => {
  const server = await setup(page, "hold");
  const id = await start(page);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  server.release();
  await page.evaluate(() => window.chatE2E.flush());
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  await page.evaluate((id) => window.chatE2E.select(id), id);
  expect(server.requests).toHaveLength(1);
  expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().messages))).not.toContain("Research evidence");
});

test("reloading during server elicitation abandons the live request without sending an answer", async ({ page }) => {
  const server = await setup(page, "form");
  const id = await start(page);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.getByLabel("Source", { exact: false })).toBeVisible();
  await page.evaluate(() => window.chatE2E.flush());
  await page.reload();
  await page.waitForFunction(() => window.chatE2E?.state().ready);
  await page.evaluate((id) => window.chatE2E.select(id), id);
  await expect(page.getByLabel("Source", { exact: false })).toHaveCount(0);
  expect(server.requests).toHaveLength(1);
  expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(0);
});

for (const action of ["Decline", "Cancel"] as const) {
  test(`URL elicitation ${action} sends that action without opening the URL`, async ({ page }) => {
    const server = await setup(page, "url");
    await start(page);
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open page (opens in a new tab)", exact: true })).toBeVisible();
    const popups: Page[] = [];
    page.on("popup", (popup) => popups.push(popup));
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => server.requests.length).toBe(2);
    expect(server.requests[1].action).toBe(action.toLowerCase());
    expect(popups).toHaveLength(0);
  });
}

test("Cancel while waiting for URL completion aborts the owning tool and ignores a late result", async ({
  page,
}, info) => {
  const server = await setup(page, "url-hold");
  await start(page);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.getByRole("link", { name: "Open page (opens in a new tab)", exact: true }).click();
  await expect.poll(() => server.requests.length).toBe(2);
  await expect(page.getByRole("heading", { name: "Finish in your browser" })).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open again (opens in a new tab)", exact: true }).click();
  const reopened = await popup;
  await expect(reopened).toHaveURL("https://example.test/consent");
  await reopened.close();
  expect(server.requests).toHaveLength(2);
  await page.screenshot({ path: info.outputPath("url-waiting.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finish in your browser" })).toHaveCount(0);
  server.release();
  await page.waitForFunction(() => window.chatE2E.state().calls.length === 2);
  expect(await page.evaluate(() => JSON.stringify(window.chatE2E.state().messages))).not.toContain("Consent: accept");
});

for (const action of ["stop", "switch"] as const) {
  test(`${action} during server elicitation does not retry with a late answer`, async ({ page }) => {
    const server = await setup(page, "form");
    const id = await start(page);
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByLabel("Source", { exact: false })).toBeVisible();
    if (action === "stop") await page.getByRole("button", { name: "Stop", exact: true }).click();
    else await page.evaluate(() => window.chatE2E.select(null));
    await expect(page.getByLabel("Source", { exact: false })).toHaveCount(0);
    await page.evaluate((id) => window.chatE2E.select(id), id);
    await page.evaluate(() => window.chatE2E.flush());
    expect(server.requests).toHaveLength(1);
    expect(await page.evaluate(() => window.chatE2E.state().calls.length)).toBe(1);
  });
}
