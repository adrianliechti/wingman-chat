import { expect, test as base, type Page } from "@playwright/test";

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
    const activity = page.getByRole("status", { name: "Assistant is working" });
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
  const activity = page.getByRole("status", { name: "Assistant is working" });
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

test("research approvals and child tools use chat disclosures and remain operable on a narrow screen", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "?seed&research");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Research this topic");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.callTool("search_agent", { prompt: "Find evidence about the topic" }));
  const requests = page.getByLabel("Agent requests");
  await expect(requests.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(requests).toContainText("Approval required to run Web research");
  await expect(page.locator("footer").getByLabel("Agent requests")).toHaveCount(0);
  expect(
    await requests.evaluate(
      (element) =>
        element.getBoundingClientRect().top >= element.previousElementSibling!.getBoundingClientRect().bottom,
    ),
  ).toBe(true);
  await requests.getByText("View details", { exact: true }).click();
  await expect(requests.locator("details")).toContainText("Find evidence about the topic");
  await expect(requests.locator("pre")).toHaveCount(0);
  await requests.getByText("View details", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("approval.png") });
  await requests.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  const child = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Researching the web" }) })
    .first();
  await expect(child).toBeVisible();
  await page.evaluate(() => window.reactUiE2E.callTool("web_search", { queries: ["A useful research query"] }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
  const result = child.getByRole("button", { name: "Searched the web", exact: false });
  await expect(result).toBeVisible();
  await result.click();
  await expect(child).toContainText("Research evidence");
  await result.click();
  await page.screenshot({ path: info.outputPath("research.png") });
  await page.setViewportSize({ width: 390, height: 750 });
  await expect(result).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.reactUiE2E.finish("Findings with sources"));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(4);
  await page.evaluate(() => window.reactUiE2E.finish("Here is the answer"));
  await expect(page.locator('[data-role="assistant"]').last()).toContainText("Here is the answer");
  await expect(requests).toHaveCount(0);
  await expect(page.getByText("Web research", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Used 2 tools", exact: true })).toHaveCount(0);
  await page.getByText("Web research", { exact: true }).click();
  await expect(page.getByText("Findings with sources", { exact: true })).toBeVisible();
  await page.evaluate(() => window.reactUiE2E.flush());
  expect(errors).toEqual([]);
});

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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const footer = document.querySelector("footer")!;
        const message = document.querySelector('[data-role="assistant"]')!;
        const content = message.parentElement!.parentElement!;
        return Math.abs(
          parseFloat(getComputedStyle(content).paddingBottom) - footer.getBoundingClientRect().height - 24,
        );
      }),
    )
    .toBeLessThan(1);
  await input.fill("A taller draft\n".repeat(8));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const footer = document.querySelector("footer")!;
        const content = document.querySelector('[data-role="assistant"]')!.parentElement!.parentElement!;
        return Math.abs(
          parseFloat(getComputedStyle(content).paddingBottom) - footer.getBoundingClientRect().height - 24,
        );
      }),
    )
    .toBeLessThan(1);
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
