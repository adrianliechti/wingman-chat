import { expect, test as base, type Page } from "@playwright/test";
import { mcpToolName } from "../../src/features/settings/lib/mcpToolNames";

const AGENT_TOOL_NAME = mcpToolName("internet", "@agent");

const test = base.extend({
  context: async ({ browserName, context, playwright, baseURL, viewport }, use, info) => {
    if (browserName !== "webkit") return use(context);
    // WebKit's ephemeral contexts do not support OPFS. Use an isolated profile
    // so these UI tests exercise the same chat persistence as a real browser.
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

async function open(page: Page, query = "") {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        models: [],
        navigation: true,
        artifacts: {},
        translator: { model: "fixture", files: [], languages: ["English", "German"] },
        renderer: { model: "fixture" },
      },
    }),
  );
  await page.goto(`/tests/browser/fixtures/react-ui.html${query}`, { waitUntil: "domcontentloaded" });
}

test("invalid inline UI repairs automatically and stays repaired after reload", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Show a pairing result");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  const surface = {
    version: "v1.0",
    createSurface: {
      surfaceId: "pairing",
      catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
      components: [
        { id: "root", component: "Column", children: ["pair_result"] },
        {
          id: "pair_result",
          component: "Callout",
          catalogId: "urn:wingman:inline-ui:catalog:1",
          text: "Pairing succeeded",
          tone: { "@path": "/tone" } as unknown,
        },
      ],
      dataModel: { tone: "success" },
    },
  };
  const ui = () => "```ui\n" + JSON.stringify(surface) + "\n```";
  await page.evaluate((reply) => window.reactUiE2E.finish(reply), ui());
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain("tone: Expected");
  expect(await page.evaluate(() => window.reactUiE2E.state().tools)).toEqual([]);
  surface.createSurface.components[1].tone = "success";
  await page.evaluate((reply) => window.reactUiE2E.finish(reply), ui());
  await expect(page.getByText("Pairing succeeded", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  await expect(page.getByText("Pairing succeeded", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("activity content has no extra gap beneath its title", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Build an HTML explorer");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.callTool("load_skill", { name: "html-artifacts" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  await page.evaluate(() =>
    window.reactUiE2E.callTool("read_skill_resource", {
      skill: "html-artifacts",
      path: "references/sdk.md",
    }),
  );
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
  await page.evaluate(() => window.reactUiE2E.think("Check the interface before finishing."));
  const group = page.locator('[data-role="tool-group"]');
  await group.getByRole("button").first().click();
  const rows = group.getByRole("button", { name: /^Read skill/ });
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  const rowGap = second!.y - first!.y - first!.height;

  const thinking = page.getByRole("button", { name: /^Thinking/ });
  const preview = page.getByRole("region", { name: "Thinking preview" });
  await expect(preview).toHaveText("Check the interface before finishing.");
  const thinkingBounds = await thinking.boundingBox();
  const contentTop = await preview
    .locator("p")
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(contentTop - thinkingBounds!.y - thinkingBounds!.height).toBeLessThanOrEqual(rowGap + 1);

  await rows.first().click();
  await expect(page.getByRole("heading", { name: "HTML artifact runtime", exact: true })).toBeVisible();
  const toolGap = await rows.first().evaluate((row) => {
    const content = row.nextElementSibling!.firstElementChild!;
    return content.getBoundingClientRect().top - row.getBoundingClientRect().bottom;
  });
  expect(toolGap).toBeLessThanOrEqual(rowGap + 1);
  await page.evaluate(() => window.reactUiE2E.finish("Done"));
});

test("thinking previews the latest update and expands into the chat without an inner scrollbar", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Plan an explorer");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  const reasoning =
    "**Planning the explorer**\n\n" +
    Array.from({ length: 100 }, (_, index) => `Reasoning paragraph ${index}: consider the next step.`).join("\n\n");
  await page.evaluate((text) => window.reactUiE2E.think(text), reasoning);
  const preview = page.getByRole("region", { name: "Thinking preview" });
  const output = page.getByRole("region", { name: "Thinking output" });
  const thinking = page.getByRole("button", { name: /Thinking….*Planning the explorer/ });
  await expect(thinking).toHaveAttribute("aria-expanded", "false");
  await expect(preview).toHaveText("Reasoning paragraph 99: consider the next step.");
  await expect(output).toHaveCount(0);

  const longUpdate = "Now checking the next step. ".repeat(100);
  const latest = reasoning + "\n\n" + longUpdate;
  await page.evaluate((text) => window.reactUiE2E.think(text), latest);
  await expect(preview).toContainText(longUpdate.trim());
  await expect(preview).not.toContainText("Reasoning paragraph 99");
  await expect(preview).toHaveCSS("-webkit-line-clamp", "3");
  expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(68);
  await expect(preview).toHaveCSS("overflow-y", "hidden");

  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-expanded", "true");
  await expect(preview).toHaveCount(0);
  await expect(output).toContainText("Reasoning paragraph 0");
  await expect(output).toContainText(longUpdate.trim());
  await expect(output).toHaveCSS("overflow-y", "visible");
  expect((await output.boundingBox())!.height).toBeGreaterThan(128);
  expect(await output.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);

  const finalReasoning = latest + "\n\nFinal checks are done.";
  await page.evaluate((text) => window.reactUiE2E.think(text), finalReasoning);
  await expect(output).toContainText("Final checks are done.");
  await expect(thinking).toHaveAttribute("aria-expanded", "true");
  await thinking.click();
  await expect(preview).toHaveText("Final checks are done.");
  await expect(output).toHaveCount(0);
  await thinking.click();
  await expect(output).toBeVisible();

  await page.evaluate(() => window.reactUiE2E.finish("Done"));
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(output).toHaveCount(0);
  const thought = page.getByRole("button", { name: /^Thought/ });
  await expect(thought).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  await thought.click();
  await expect(output).toContainText("Reasoning paragraph 0");
  await expect(output).toContainText("Final checks are done.");
  await expect(output).toHaveCSS("overflow-y", "visible");
});

for (const legacySelection of [false, true]) {
  test(`built-in skills load on demand without a Studio menu (${legacySelection ? "legacy selection" : "fresh settings"})`, async ({
    page,
  }) => {
    await page.addInitScript((selected) => {
      localStorage.setItem("app_tools", JSON.stringify(selected ? ["studio"] : []));
      localStorage.setItem("app_skills", "[]");
    }, legacySelection);
    const loaded: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/skills/") && path.endsWith(".md")) loaded.push(path);
    });
    await open(page);
    const input = page.getByRole("textbox", { name: "Chat message input" });
    await expect(input).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Add File", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Studio/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await input.fill("Build an HTML data explorer");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
    const request = await page.evaluate(() => window.reactUiE2E.state());
    expect(request.tools).toContain("load_skill");
    expect(request.tools).toContain("read_skill_resource");
    expect(request.instructions).toContain("html-artifacts");
    expect(request.instructions).toContain("document-drafting");
    expect(request.instructions).not.toContain("## Studio");
    expect(loaded).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("app_tools") ?? "[]"))).not.toContain("studio");

    await page.evaluate(() => window.reactUiE2E.callTool("load_skill", { name: "html-artifacts" }));
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
    expect(loaded).toEqual(["/skills/studio/html-artifacts/SKILL.md"]);
    await page.getByRole("button", { name: /^Read skill\b/ }).click({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "HTML artifact runtime", exact: true })).toBeVisible();
    await page.evaluate(() =>
      window.reactUiE2E.callTool("read_skill_resource", {
        skill: "html-artifacts",
        path: "references/sdk.md",
      }),
    );
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
    expect(loaded).toEqual([
      "/skills/studio/html-artifacts/SKILL.md",
      "/skills/studio/html-artifacts/references/sdk.md",
    ]);
    await page.evaluate(() => window.reactUiE2E.finish("Done"));
  });
}

test("sidebar resizing keeps its cursor and releases the drag overlay", async ({ page }) => {
  test.setTimeout(45_000);
  await open(page, "?seed");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await expect(input).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  const handle = page.getByRole("button", { name: "Resize sidebar", exact: true });
  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS("cursor", "ew-resize");
  await handle.hover();
  const before = await handle.boundingBox();
  await page.mouse.down();
  await page.mouse.move(before!.x + 90, before!.y + 30, { steps: 5 });
  await expect(input).toHaveCSS("cursor", "ew-resize");
  await expect.poll(async () => (await handle.boundingBox())!.x - before!.x).toBeGreaterThan(50);
  await page.mouse.up();
  await expect(input).not.toHaveCSS("cursor", "ew-resize");
  await input.fill("The resize overlay is gone");
  await expect(input).toHaveValue("The resize overlay is gone");
});

test("Canvas loads optional image styles from the shared design reference", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/skills/") && path.endsWith(".md")) loaded.push(path);
  });
  await open(page);
  await page.getByRole("link", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Style", exact: true }).click();
  await page.getByRole("menuitem", { name: "Watercolor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watercolor", exact: true })).toBeVisible();
  expect(loaded).toEqual(["/skills/studio/canvas-design/references/image-styles.md"]);
});

test("Activity retains drafts, stops hidden effects and portals, and leaves persistent iframes alive", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "?panels");
  const draft = page.getByRole("textbox", { name: "Panel draft" });
  const frameDraft = page.frameLocator('iframe[title="Persistent app"]').getByRole("textbox");
  await draft.fill("Unsaved draft");
  await frameDraft.fill("Live app state");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().effects)).toBe(1);
  await page.getByRole("button", { name: "Toggle panels" }).click();
  await expect(draft).toBeHidden();
  await expect(page.getByRole("button", { name: "Panel portal" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().effects)).toBe(0);
  await page.getByRole("button", { name: "Toggle panels" }).click();
  await expect(draft).toHaveValue("Unsaved draft");
  await expect(frameDraft).toHaveValue("Live app state");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().effects)).toBe(1);
  await page.getByRole("button", { name: "Change workspace" }).click();
  await expect(draft).toHaveValue("");
  expect(errors).toEqual([]);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`navigation highlight follows routes, history and resizing (${reducedMotion})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion });
    await open(page);
    await expect(page.getByRole("textbox", { name: "Chat message input" })).toBeVisible();
    const nav = page.locator("nav");
    const chat = nav.getByRole("link", { name: "Chat", exact: true });
    const translate = nav.getByRole("link", { name: "Translate", exact: true });
    const highlight = nav.locator('a[data-page] > span[aria-hidden="true"]');
    await expect(highlight).toHaveCount(1);
    await translate.click();
    await expect(page).toHaveURL(/\/translate$/);
    await expect(translate.locator('span[aria-hidden="true"]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(chat.locator('span[aria-hidden="true"]')).toBeVisible();
    await page.setViewportSize({ width: 900, height: 700 });
    await expect
      .poll(async () => {
        const link = await chat.boundingBox();
        const marker = await highlight.boundingBox();
        return !!link && !!marker && Math.abs(link.x - marker.x) < 1 && Math.abs(link.width - marker.width) < 1;
      })
      .toBe(true);
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(chat).toBeHidden();
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect(highlight).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const existingChat of [false, true]) {
  test(`shows activity before the first token in ${existingChat ? "an existing" : "a new"} chat`, async ({ page }) => {
    await open(page, existingChat ? "?seed" : "");
    const input = page.getByRole("textbox", { name: "Chat message input" });
    await input.fill("Please think about this");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
    const activity = page.locator('[data-role="assistant"]').getByRole("status");
    await expect(activity).toBeVisible();
    await expect(activity).not.toBeEmpty();
    await page.evaluate(() => window.reactUiE2E.stream("Here is my answer"));
    await expect(activity).toHaveCount(0);
    await expect(page.locator('[data-role="assistant"]').last()).toContainText("Here is my answer");
    await page.evaluate(() => window.reactUiE2E.finish("Here is my answer"));
    await input.fill("Think again");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
    await expect(activity).toBeVisible();
    await page.getByRole("button", { name: "Stop generating (Esc)", exact: true }).click();
    await expect(activity).toHaveCount(0);
  });
}

test("activity labels vary across responses and stay stable while composing", async ({ page }) => {
  await page.addInitScript(() => {
    let id = 0;
    crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  });
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  const activity = page.locator('[data-role="assistant"]').getByRole("status");
  const labels = new Set<string>();
  for (let turn = 1; turn <= 4; turn++) {
    await input.fill("Think about this");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(turn);
    await expect(activity).toBeVisible();
    const label = (await activity.textContent())!;
    labels.add(label);
    await input.fill("A draft while waiting");
    await expect(activity).toHaveText(label);
    await input.fill("");
    await page.evaluate(() => window.reactUiE2E.finish("Done"));
    await expect(activity).toHaveCount(0);
  }
  expect(labels.size).toBeGreaterThan(1);
});

test("Stop clears subagent loading activity and keeps it stopped after reload", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Delegate this task");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().tools)).toContain("agent");
  await page.evaluate(() => window.reactUiE2E.callTool("agent", { prompt: "Find evidence" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  const card = page.locator('[class~="group/subagent"]');
  await expect(card.locator("summary .animate-spin")).toHaveCount(1);
  await page.getByRole("button", { name: "Stop generating (Esc)", exact: true }).click();
  await expect(card.locator("summary")).toContainText("Stopped");
  await expect(card.locator(".animate-spin")).toHaveCount(0);
  await page.evaluate(() => window.reactUiE2E.finish("Late child reply"));
  await expect(page.getByText("Late child reply", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  await expect(card.locator("summary")).toContainText("Stopped");
  await expect(card.locator(".animate-spin")).toHaveCount(0);
});

for (const feature of [
  { name: "web_research", label: "Deep research" },
  { name: "web_search", label: "Web Search" },
  { name: "web_fetch", label: "Web Fetch" },
]) {
  test(`approved research can use ${feature.name} without another prompt and remains usable on a narrow screen`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    let remoteCalls = 0;
    const instructions =
      "Compare recent public reports on electric vehicle charging infrastructure in Switzerland, focusing on coverage, reliability, and expansion plans. Prefer primary sources and include direct source URLs.\n\nDistinguish confirmed findings from estimates, identify the publication date for each source, and explain where reports disagree. Keep the answer concise and state any gaps in the available evidence.";
    const args =
      feature.name === "web_research"
        ? { instructions }
        : feature.name === "web_search"
          ? {
              queries: ["Adrian Liechti public professional profiles", "Adrian Liechti projects"],
              allowed_domains: ["github.com"],
              max_results: 8,
            }
          : {
              url: "https://example.test/reports/charging-infrastructure?country=Switzerland",
              query: "Coverage and reliability",
              max_chars: 4096,
            };
    const originalViewport = page.viewportSize()!;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/fixture-research-mcp", async (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ status: 405 });
      const request = route.request().postDataJSON();
      if (request.id === undefined) return route.fulfill({ status: 202 });
      if (request.method === "server/discover")
        return route.fulfill({
          json: { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } },
        });
      let result = {};
      if (request.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "Web", version: "1" },
        };
      if (request.method === "tools/list")
        result = {
          tools: [
            {
              name: feature.name,
              title: feature.label,
              description: "Find sources",
              inputSchema: {
                type: "object",
                properties: {},
              },
            },
          ],
        };
      if (request.method === "tools/call") {
        remoteCalls++;
        expect(request.params._meta.progressToken).toBeDefined();
        expect(request.params.arguments).toEqual(args);
        result = { content: [{ type: "text", text: "Research evidence" }] };
      }
      await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
    });
    const discovery = page.waitForResponse(
      (response) =>
        response.url().endsWith("/fixture-research-mcp") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.method === "tools/list",
    );
    await open(page, "?seed&research");
    await discovery;
    await expect(page.getByRole("button", { name: "Fixture", exact: true })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Chat message input" });
    await input.fill("Research this topic for CLIENT_SECRET");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().tools)).toContain(AGENT_TOOL_NAME);
    expect(await page.evaluate(() => window.reactUiE2E.state().tools)).not.toContain(
      mcpToolName("internet", feature.name),
    );
    await page.evaluate(({ name, args }) => window.reactUiE2E.callTool(name, args), {
      name: AGENT_TOOL_NAME,
      args: { prompt: instructions },
    });
    const requests = page.getByLabel("Agent requests");
    const approve = requests.getByRole("button", { name: "Allow", exact: true });
    await expect(approve).toBeVisible();
    await expect(page.getByRole("button", { name: "Latest", exact: true })).toHaveCount(0);
    await expect(requests.getByRole("heading", { name: "Allow Web Search?", exact: true })).toBeVisible();
    await expect(page.locator("footer").getByLabel("Agent requests")).toHaveCount(0);
    expect(
      await requests.evaluate(
        (element) =>
          element.getBoundingClientRect().top >= element.previousElementSibling!.getBoundingClientRect().bottom,
      ),
    ).toBe(true);
    await expect(requests.getByLabel("Prompt shared with Web Search")).toHaveText(instructions);
    await expect(requests.getByRole("textbox")).toHaveCount(0);
    await expect(requests.locator("pre, details")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("approval.png") });
    await page.setViewportSize({ width: 390, height: 750 });
    const label = requests.getByRole("heading", { name: "Allow Web Search?" });
    await expect(label).toBeVisible();
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(approve).toBeVisible();
    await expect(page.getByRole("button", { name: "Latest", exact: true })).toHaveCount(0);
    for (const name of ["Allow", "Decline", "Cancel"]) {
      const button = requests.getByRole("button", { name, exact: true });
      // Resizing animates the sidebar and chat layout; wait for the button to be unobstructed.
      await expect
        .poll(() =>
          button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
        )
        .toBe(true);
    }
    await page.screenshot({ path: info.outputPath("approval-narrow.png") });
    await page.setViewportSize(originalViewport);
    expect(remoteCalls).toBe(0);
    await approve.click();
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
    const card = page.locator('[class~="group/subagent"]');
    await expect(card).not.toHaveAttribute("open");
    await card.locator("summary").click();
    expect(remoteCalls).toBe(0);
    expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).not.toContain("CLIENT_SECRET");
    expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).not.toContain("Question 119");
    await page.evaluate(({ name, args }) => window.reactUiE2E.callTool(name, args), {
      name: mcpToolName("internet", feature.name),
      args,
    });
    await expect(page.getByText("Searching sources", { exact: true })).toBeVisible();
    expect(remoteCalls).toBe(1);
    expect(await page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
    await expect(requests).toHaveCount(0);
    await page.evaluate(() => window.reactUiE2E.researchProgress(2, "Reading sources", 4));
    await expect(page.getByText("Reading sources · 50%", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("progress.png") });
    await page.evaluate(() => window.reactUiE2E.finishResearch());
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
    await expect(page.getByText("Reading sources · 50%", { exact: true })).toHaveCount(0);
    const result = page.getByRole("button", { name: feature.label, exact: false });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByText("Research evidence", { exact: true })).toBeVisible();
    await result.click();
    await page.screenshot({ path: info.outputPath("research.png") });
    await page.setViewportSize({ width: 390, height: 750 });
    await expect(result).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.reactUiE2E.finish("Public report with sources"));
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(4);
    await page.evaluate(() => window.reactUiE2E.finish("Here is the answer"));
    await expect(page.locator('[data-role="assistant"]').last()).toContainText("Here is the answer");
    await expect(requests).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Used 2 tools", exact: true })).toHaveCount(0);
    await page.evaluate(() => window.reactUiE2E.flush());
    expect(errors).toEqual([]);
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`large text chunks render progressively and Stop retains the full text (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await open(page);
    const input = page.getByRole("textbox", { name: "Chat message input" });
    await input.fill("Stream a response");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
    const burst = "Hello 🌍. A received text chunk. ".repeat(30);
    const lengths = await page.evaluate(async (text) => {
      const sizes: number[] = [];
      const observer = new MutationObserver(() => {
        const value = [...document.querySelectorAll('[data-role="assistant"]')].at(-1)?.textContent?.trim() ?? "";
        if (text.startsWith(value) && sizes.at(-1) !== value.length) sizes.push(value.length);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      window.reactUiE2E.stream(text);
      await new Promise((resolve) => setTimeout(resolve, 350));
      observer.disconnect();
      return sizes;
    }, burst);
    expect(lengths.some((length) => length > 0 && length < burst.trim().length)).toBe(
      reducedMotion === "no-preference",
    );
    await expect(page.locator('[data-role="assistant"]').last()).toHaveText(burst.trim());

    const final = burst + "More text that must survive Stop. ".repeat(30);
    await page.evaluate((text) => {
      window.reactUiE2E.stream(text);
      // Stop while the newly received burst is still being revealed.
      setTimeout(() => document.querySelector<HTMLButtonElement>('button[title="Stop generating (Esc)"]')?.click(), 30);
    }, final);
    await expect(page.getByRole("button", { name: "Stop generating (Esc)", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-role="assistant"]').last()).toContainText(final.trim());
    await page.evaluate(() => window.reactUiE2E.finish("Late provider completion"));
    await expect(page.locator('[data-role="assistant"]').last()).toContainText(final.trim());
  });
}

test("compiled chat keeps stream DOM stable, measures the composer and updates virtualized search", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "?seed");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await expect(input).toBeVisible();
  await expect(page.locator('[data-role="assistant"]')).toContainText("A long answer.");
  const composerGap = () =>
    page.locator("main > div.overflow-auto > div").evaluate((content) => {
      const footer = document.querySelector("footer")!;
      return Math.abs(parseFloat(getComputedStyle(content).paddingBottom) - footer.getBoundingClientRect().height - 24);
    });
  await expect.poll(composerGap).toBeLessThan(1);
  await input.fill("A taller draft\n".repeat(8));
  await expect.poll(composerGap).toBeLessThan(1);
  await input.fill("Follow up");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.stream("First draft"));
  const response = page.locator('[data-role="assistant"]').last();
  await expect(response).toContainText("First draft");
  await response.hover();
  await expect(response.getByRole("button")).toHaveCount(0);
  await response.evaluate((element) => element.setAttribute("data-stream-instance", "original"));
  await page.evaluate(() => window.reactUiE2E.stream("First draft updated"));
  await expect(response).toContainText("First draft updated");
  await page.evaluate(() => window.reactUiE2E.finish("First draft updated. Final answer"));
  await expect(response).toContainText("Final answer");
  await expect(response).toHaveAttribute("data-stream-instance", "original");
  await expect(response.getByRole("button", { name: "Copy to clipboard (Alt+click for raw markdown)" })).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Search chats" }).click();
  const search = page.getByPlaceholder("Search…", { exact: true });
  await search.fill("Saved chat 1");
  await expect(page.getByRole("button", { name: "Saved chat 118", exact: true })).toBeVisible();
  await search.fill("Saved chat 42");
  await expect(page.getByRole("button", { name: "Saved chat 42", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved chat 118", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Saved chat 42", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/history-42$/);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  await expect(page.locator('[data-role="assistant"]')).toContainText("Answer 42");
  expect(errors).toEqual([]);
});

test("hi then long Markdown keeps the start readable; Latest follows until the reader scrolls up", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("hi");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.finish("Hi! How can I help?"));
  await expect(page.locator('[data-role="assistant"]')).toContainText("Hi! How can I help?");
  await input.fill("Render a long Markdown answer with headings, paragraphs, lists and a table.");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  const response = page.locator('[data-role="assistant"]').last();
  const scroll = page.locator("main > div.overflow-auto");
  const gap = () => scroll.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  const prompt = page.locator('[data-role="user"]').last();
  const promptTop = () => prompt.evaluate((element) => element.getBoundingClientRect().top);
  await expect.poll(promptTop).toBeCloseTo(72, 0);
  let markdown = "";
  for (let section = 1; section <= 4; section++) {
    markdown += `## Section ${section}\n\n${"A paragraph with **bold** and _italic_ text.\n\n".repeat(8)}- One\n- Two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`js\nconsole.log("Example");\n\`\`\`\n\n`;
    await page.evaluate((text) => window.reactUiE2E.stream(text), markdown);
    await expect(response).toContainText(`Section ${section}`);
    await expect(response.getByRole("button")).toHaveCount(0);
    if (section <= 2) {
      await expect.poll(promptTop).toBeCloseTo(72, 0);
    }
    if (section === 2) {
      await page.getByRole("button", { name: "Latest", exact: true }).click();
    }
    if (section >= 2) await expect.poll(gap).toBeLessThan(3);
  }
  await scroll.hover();
  await page.mouse.wheel(0, -650);
  await expect(page.getByRole("button", { name: "Latest", exact: true })).toBeVisible();
  const readingPosition = await scroll.evaluate((element) => element.scrollTop);
  markdown += "## While reading\n\n" + "More streamed text.\n\n".repeat(12);
  await page.evaluate((text) => window.reactUiE2E.stream(text), markdown);
  await expect(response).toContainText("While reading");
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(readingPosition, 0);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect.poll(gap).toBeLessThan(3);
  markdown += "## Final section\n\n" + "Final streamed text.\n\n".repeat(10);
  await page.evaluate((text) => window.reactUiE2E.stream(text), markdown);
  await expect(response).toContainText("Final section");
  await expect.poll(gap).toBeLessThan(3);
  let releaseImage!: () => void;
  const imageReady = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  await page.route("**/react-ui-delayed-image.svg", async (route) => {
    await imageReady;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="teal"/></svg>',
    });
  });
  markdown += "\n\n![Delayed layout](/react-ui-delayed-image.svg)\n\n";
  await page.evaluate((text) => window.reactUiE2E.stream(text), markdown);
  const image = response.getByRole("img", { name: "Delayed layout" });
  await expect(image).toHaveCount(1);
  releaseImage();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalHeight)).toBe(900);
  await expect.poll(gap).toBeLessThan(3);
  await page.evaluate((text) => window.reactUiE2E.finish(text), markdown);
  await expect(input).toBeEnabled();
  await expect(
    response.getByRole("button", { name: "Copy to clipboard (Alt+click for raw markdown)", exact: true }),
  ).toHaveCount(1);
  await expect(response.getByRole("button", { name: "Copy table for Excel", exact: true })).toHaveCount(4);
  await expect(response.getByRole("button", { name: "Copy", exact: true })).toHaveCount(4);
  await expect.poll(gap).toBeLessThan(3);
  await page.setViewportSize({ width: 700, height: 550 });
  await expect.poll(gap).toBeLessThan(3);
  // Scrollbar/accessibility scrolling also pauses, then reaching the end resumes.
  await scroll.evaluate((element) => {
    element.scrollTop -= 300;
  });
  await expect(page.getByRole("button", { name: "Latest", exact: true })).toBeVisible();
  await scroll.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(gap).toBeLessThan(3);
  // WebKit can update scrollTop before delivering the scroll event that
  // restores follow mode. Wait for the UI to observe reaching the end.
  await expect(page.getByRole("button", { name: "Latest", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 650, height: 450 });
  await expect.poll(gap).toBeLessThan(3);
  await input.fill("Another question");
  await input.press("Enter");
  await expect.poll(promptTop).toBeCloseTo(72, 0);
  expect(errors).toEqual([]);
});

test("composer skill picker loads disabled skills with resources on follow-ups and after reload", async ({ page }) => {
  await open(page, "?composer");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  const suggestions = page.getByRole("listbox", { name: "Skill suggestions" });
  await input.fill("/");
  await expect(suggestions.getByRole("option")).toHaveCount(3);
  await expect(suggestions.getByRole("option", { name: /draft-response/ })).toBeVisible();
  await expect(suggestions.getByRole("option", { name: /support:escalate/ })).toBeVisible();
  await expect(suggestions.getByRole("option", { name: /html-artifacts/ })).toHaveCount(0);
  await input.press("Escape");
  await expect(suggestions).toHaveCount(0);
  await expect(input).toHaveValue("/");
  expect(await page.evaluate(() => window.reactUiE2E.state().calls)).toBe(0);

  await input.fill("Please /draft then reply");
  for (let i = 0; i < " then reply".length; i++) await input.press("ArrowLeft");
  expect(
    await input.evaluate((el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      focused: document.activeElement === el,
    })),
  ).toEqual({ start: 13, end: 13, focused: true });
  await expect(suggestions.getByRole("option", { name: /draft-response/ })).toBeVisible();
  await input.press("Tab");
  await expect(input).toHaveValue("Please  then reply");
  await expect(page.getByRole("button", { name: "Remove skill draft-response" })).toBeVisible();
  await page.getByRole("button", { name: "Remove skill draft-response" }).click();

  await input.fill("/draft");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  expect(await page.evaluate(() => window.reactUiE2E.state().calls)).toBe(0);
  await expect(suggestions).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "Remove skill draft-response" })).toBeVisible();
  expect(await page.evaluate(() => window.reactUiE2E.state().calls)).toBe(0);
  await input.fill("Please reply");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  const state = await page.evaluate(() => window.reactUiE2E.state());
  expect(JSON.stringify(state.input.at(-1))).toContain("load_skill");
  expect(state.instructions).not.toContain("Follow the customer response template.");
  expect(await page.evaluate(() => localStorage.getItem("app_skills"))).toBeNull();
  await page.evaluate(() => window.reactUiE2E.callTool("load_skill", { name: "draft-response" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "Follow the customer response template.",
  );
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "references/response.md",
  );
  await page.evaluate(() => window.reactUiE2E.finish("Reply ready"));
  await expect(page.getByText("Reply ready", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Selected skill")).toHaveText("draft-response");
  await input.fill("Check the reply against the checklist");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
  await page.evaluate(() =>
    window.reactUiE2E.callTool("read_skill_resource", { skill: "draft-response", path: "references/response.md" }),
  );
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(4);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "Follow the customer response template.",
  );
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "Response checklist: acknowledge, explain, resolve.",
  );
  await page.evaluate(() => window.reactUiE2E.finish("Checklist complete"));
  await expect(page.getByText("Checklist complete", { exact: true })).toBeVisible();
  await page.evaluate(() => window.reactUiE2E.flush());
  const id = new URL(page.url()).pathname.split("/").pop();
  await page.goto(`/tests/browser/fixtures/react-ui.html?composer&chat=${id}`);
  await input.fill("Use that checklist again");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() =>
    window.reactUiE2E.callTool("read_skill_resource", { skill: "draft-response", path: "references/response.md" }),
  );
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "Response checklist: acknowledge, explain, resolve.",
  );
  await page.evaluate(() =>
    window.reactUiE2E.callTool("execute_script", { path: "/skills/draft-response/scripts/check.js" }),
  );
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "Selected skill script ran",
  );
  await page.evaluate(() => window.reactUiE2E.finish("Review complete"));
  await expect(page.getByText("Review complete", { exact: true })).toBeVisible();
  await page.getByTitle("Edit message", { exact: true }).first().click();
  await page.getByRole("button", { name: "Remove skill draft-response" }).click();
  await page.getByTitle("Save & Submit", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(4);
  expect(await page.evaluate(() => window.reactUiE2E.state().instructions)).not.toContain("draft-response");
  await expect(page.getByTitle("Selected skill")).toHaveCount(0);
});

test("composer can send only a plugin skill without enabling the plugin", async ({ page }) => {
  await open(page, "?composer");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("/support");
  await page.getByRole("option", { name: /support:escalate/ }).click();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.callTool("load_skill", { name: "support:escalate" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input))).toContain(
    "Follow the escalation procedure.",
  );
  expect(await page.evaluate(() => localStorage.getItem("app_tools"))).not.toContain("plugin:support");
});

test("composer can send an attachment without typed text", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await expect(input).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "attachment-only.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A document sent without a caption."),
    });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(input).toHaveValue("");
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(window.reactUiE2E.state().input.at(-1)))).toContain(
    "/attachment-only.txt",
  );
  await page.evaluate(() => window.reactUiE2E.finish("Document received"));
  await expect(page.getByText("Document received", { exact: true })).toBeVisible();
  await expect(send).toHaveCount(0);
});
