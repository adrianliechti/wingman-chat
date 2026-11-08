import { expect, test as base, type Locator, type Page } from "@playwright/test";

const test = base.extend({
  context: async ({ browserName, context, playwright, baseURL, viewport, isMobile, hasTouch }, use, info) => {
    if (browserName !== "webkit") return use(context);
    // OPFS needs a persistent WebKit profile, including in mobile emulation.
    const persistent = await playwright.webkit.launchPersistentContext(info.outputPath("webkit-profile"), {
      baseURL,
      viewport,
      isMobile,
      hasTouch,
    });
    try {
      await use(persistent);
    } finally {
      await persistent.close();
    }
  },
});

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

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
  await expect(page.locator("[data-app-topbar]")).toBeVisible();
  if (query === "?seed") await expect(page.locator('[data-role="assistant"]').last()).toContainText("A long answer.");
}

// Playwright has no native phone keyboard. Exercise its actual viewport events
// separately from Android's layout-resize path below; device testing is still needed.
async function visualViewport(page: Page, height: number, offsetTop = 0, scale = 1) {
  await page.evaluate(
    (values) => {
      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(window.visualViewport, key, { configurable: true, get: () => value });
      }
      window.visualViewport!.dispatchEvent(new Event("resize"));
      window.visualViewport!.dispatchEvent(new Event("scroll"));
    },
    { height, offsetTop, scale },
  );
}

async function withinVisibleViewport(locator: Locator, top: number, bottom: number) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() => locator.evaluate((element) => element.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(top - 1);
  await expect
    .poll(() => locator.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(bottom + 1);
}

// Desktop browser emulation reports zero native insets. Supply asymmetric
// values to exercise the layout independently of a particular device model.
async function safeAreas(page: Page, { top = 0, bottom = 0, left = 0, right = 0 }) {
  await page.addStyleTag({
    content: `:root { --safe-top: ${top}px; --safe-left: ${left}px; --safe-right: ${right}px; }
      :root:not(.keyboard-open) { --safe-bottom: ${bottom}px; }`,
  });
}

for (const width of [390, 756]) {
  test(`sheet close controls stay on the right, with Back on the left at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await safeAreas(page, { left: 32, right: 20 });
    const dialog = page.getByRole("dialog");
    const panel = page.locator('[id^="headlessui-dialog-panel-"]');
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    const rightInset = () =>
      close.evaluate((element) => {
        const panel = element.closest('[id^="headlessui-dialog-panel-"]')!;
        return panel.getBoundingClientRect().right - element.getBoundingClientRect().right;
      });
    const onRight = async (button: Locator) => {
      await expect
        .poll(() =>
          button.evaluate((element) => {
            const panel = element.closest('[id^="headlessui-dialog-panel-"]')!.getBoundingClientRect();
            return element.getBoundingClientRect().left - (panel.left + panel.width / 2);
          }),
        )
        .toBeGreaterThan(0);
    };
    await page.getByRole("button", { name: "Fixture", exact: true }).click();
    await onRight(close);
    const modelInset = await rightInset();
    await dialog.getByRole("button", { name: /^Verbosity/ }).click();
    await expect(dialog.getByRole("heading", { name: "Verbosity", exact: true })).toBeVisible();
    await onRight(close);
    const back = dialog.getByRole("button", { name: "Back", exact: true });
    await expect
      .poll(() =>
        back.evaluate((element) => {
          const panel = element.closest('[id^="headlessui-dialog-panel-"]')!.getBoundingClientRect();
          return element.getBoundingClientRect().right - (panel.left + panel.width / 2);
        }),
      )
      .toBeLessThan(0);
    await back.click();
    await expect(dialog.getByRole("heading", { name: "Select model", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: /^Verbosity/ }).click();
    await close.click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Fixture", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Select model", exact: true })).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "More options", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Add to chat", exact: true })).toBeVisible();
    await onRight(close);
    await expect.poll(async () => Math.abs((await rightInset()) - modelInset)).toBeLessThanOrEqual(1);
    await withinVisibleViewport(panel, 0, 844);
    await close.click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await onRight(dialog.getByRole("button", { name: "Close settings", exact: true }));
  });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
]) {
  test(`safe areas protect the chat and header at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, "?seed");
    await safeAreas(page, { top: 32, bottom: 34, left: 44, right: 20 });
    const input = page.getByRole("textbox", { name: "Chat message input" });
    const nav = page.locator("[data-app-topbar]");
    await withinVisibleViewport(nav.locator(":scope > .flex"), 32, size.height - 34);
    await expect
      .poll(() => input.evaluate((element) => element.getBoundingClientRect().left))
      .toBeGreaterThanOrEqual(44);
    await expect
      .poll(() => input.evaluate((element) => element.getBoundingClientRect().right))
      .toBeLessThanOrEqual(size.width - 20);
    await expect
      .poll(() => page.locator("footer").evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)), {
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(34);
    const prompt = page.locator('[data-role="user"]').first();
    await prompt.evaluate((element) => {
      let parent = element.parentElement;
      while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
      if (parent) parent.scrollTop = 0;
    });
    await expect
      .poll(() =>
        prompt.evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            document.querySelector("[data-app-topbar]")!.getBoundingClientRect().bottom,
        ),
      )
      .toBeGreaterThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    await input.focus();
    await visualViewport(page, size.height - 180);
    await expect(page.locator("html")).toHaveClass(/keyboard-open/);
    await withinVisibleViewport(page.locator("footer"), 32, size.height - 180);
    await visualViewport(page, size.height);
    await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
  });
}

test("tablet translation and canvas content clear the safe area and the whole header", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await open(page);
  await safeAreas(page, { top: 24, bottom: 34 });
  for (const name of ["Translate", "Canvas"]) {
    await page.getByRole("link", { name, exact: true }).filter({ visible: true }).click();
    await expect
      .poll(
        () =>
          page
            .locator("main")
            .evaluate(
              (element) =>
                element.getBoundingClientRect().top -
                document.querySelector("[data-app-topbar]")!.getBoundingClientRect().bottom,
            ),
        { timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => page.locator("main").evaluate((element) => element.getBoundingClientRect().bottom), { timeout: 5000 })
      .toBeLessThanOrEqual(1146);
  }
});

test("tablet sidebar and agent panel stay inside the safe content bounds", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await open(page);
  await safeAreas(page, { top: 24, bottom: 34 });
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  const sidebar = page.locator("aside");
  await expect(sidebar).toHaveCSS("padding-top", "24px");
  await expect(sidebar).toHaveCSS("padding-bottom", "34px", { timeout: 5000 });
  await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Manage agents", exact: true }).click();
  const panel = page
    .locator(".fixed")
    .filter({ has: page.getByRole("button", { name: "Resize agent panel", exact: true }) });
  await expect
    .poll(() =>
      panel.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          document.querySelector("[data-app-topbar]")!.getBoundingClientRect().bottom,
      ),
    )
    .toBeGreaterThanOrEqual(0);
  await expect(panel.locator(".border-l")).toHaveCSS("padding-bottom", "34px", { timeout: 5000 });
});

test("phone project menu follows the visible viewport while searching", async ({ page }) => {
  await open(page);
  await safeAreas(page, { left: 24, right: 12, bottom: 34 });
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  await visualViewport(page, 380, 40);
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toHaveCSS("bottom", "424px", { timeout: 5000 });
  await withinVisibleViewport(menu, 40, 420);
  const create = menu.getByRole("menuitem", { name: "New project", exact: true });
  await expect
    .poll(() => create.evaluate((element) => element.getBoundingClientRect().left))
    .toBeGreaterThanOrEqual(24);
  await expect.poll(() => create.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(378);
  await create.click();
  const editor = page.getByRole("region", { name: "New project", exact: true });
  await expect(editor.locator("footer")).toHaveCSS("padding-bottom", "0px");
  await visualViewport(page, 844);
  await expect(editor.locator("footer")).toHaveCSS("padding-bottom", "34px");
});

for (const [format, source] of [
  ["table", "| Name | Value |\n| --- | --- |\n| A | 1 |"],
  ["CSV", "```csv\nName,Value\nA,1\n```"],
]) {
  test(`full screen ${format} controls clear every safe-area edge`, async ({ page }) => {
    await page.goto("/tests/browser/fixtures/markdown.html");
    await page.waitForFunction(() => window.markdownE2E);
    // This fixture normally runs on desktop and has no viewport declaration.
    await page.evaluate(() => {
      const viewport = document.createElement("meta");
      viewport.name = "viewport";
      viewport.content = "width=device-width, initial-scale=1, viewport-fit=cover";
      document.head.append(viewport);
    });
    await safeAreas(page, { top: 59, bottom: 34, left: 24, right: 12 });
    await page.evaluate((content) => window.markdownE2E.render(content), source);
    await page.getByRole("button", { name: `Open ${format} in full screen`, exact: true }).click();
    const panel = page.locator('[id^="headlessui-dialog-panel-"]');
    const toolbar = panel.locator(":scope > div").first();
    await withinVisibleViewport(toolbar, 59, 810);
    await expect
      .poll(() => toolbar.evaluate((element) => element.getBoundingClientRect().left))
      .toBeGreaterThanOrEqual(24);
    await expect
      .poll(() => toolbar.evaluate((element) => element.getBoundingClientRect().right))
      .toBeLessThanOrEqual(378);
    await withinVisibleViewport(panel.locator(":scope > div").last(), 59, 810);
  });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
]) {
  test(`chat remains usable with a keyboard at ${size.width}x${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await open(page, "?seed");
    const input = page.getByRole("textbox", { name: "Chat message input" });
    await input.fill("A multiline draft\n".repeat(20));
    const visibleHeight = size.height - Math.min(320, Math.round(size.height * 0.45));
    await visualViewport(page, visibleHeight);
    await withinVisibleViewport(page.locator("footer"), 0, visibleHeight);
    await withinVisibleViewport(input, 0, visibleHeight);
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBeGreaterThan(30);
    await expect
      .poll(() => page.locator("main").evaluate((element) => element.getBoundingClientRect().bottom))
      .toBe(visibleHeight);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    await expect
      .poll(() =>
        input.evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            document.querySelector("[data-app-topbar]")!.getBoundingClientRect().bottom,
        ),
      )
      .toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: info.outputPath("keyboard-open.png"), animations: "disabled" });
    await visualViewport(page, size.height);
    await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
    await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
    await expect(input).toHaveValue("A multiline draft\n".repeat(20));
    await input.fill("");
    await page.evaluate(() => window.reactUiE2E.flush());
  });
}

test("Safari viewport panning keeps the top bar, composer and history in the same bounds", async ({ page }) => {
  await open(page, "?seed");
  await page.getByRole("textbox", { name: "Chat message input" }).focus();
  await visualViewport(page, 380, 60);
  await expect(page.locator("[data-app-topbar]")).toHaveCSS("top", "60px");
  await withinVisibleViewport(page.locator("footer"), 60, 440);
  await expect.poll(() => page.locator("main").evaluate((element) => element.getBoundingClientRect().top)).toBe(60);
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  await withinVisibleViewport(page.locator("aside"), 60, 440);
  await withinVisibleViewport(page.getByRole("button", { name: "Settings", exact: true }), 60, 440);
});

test("pinch zoom does not shrink the layout or masquerade as a keyboard", async ({ page }) => {
  await open(page, "?seed");
  await visualViewport(page, 422, 70, 2);
  await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
  await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
  await expect.poll(() => page.locator("main").evaluate((element) => element.getBoundingClientRect().height)).toBe(844);
  await visualViewport(page, 524);
  await expect(page.locator("footer")).toHaveCSS("bottom", "320px");
  await visualViewport(page, 262, 40, 2);
  await expect(page.locator("footer")).toHaveCSS("bottom", "320px");
  await visualViewport(page, 844);
  await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
});

test("Android layout resizing does not subtract the keyboard twice and restores while still focused", async ({
  page,
}) => {
  await open(page, "?seed");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await expect(input).toBeEnabled();
  await input.focus();
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 390, height: 524 });
  await withinVisibleViewport(page.locator("footer"), 0, 524);
  await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
  await expect(page.locator("html")).toHaveClass(/keyboard-open/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeFocused();
  await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
  await expect.poll(() => page.locator("main").evaluate((element) => element.getBoundingClientRect().height)).toBe(844);
});

test("rotation with an open keyboard fits the landscape composer", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Draft before rotation");
  await visualViewport(page, 524);
  await page.setViewportSize({ width: 844, height: 390 });
  await visualViewport(page, 210);
  await withinVisibleViewport(input, 56, 210);
  await withinVisibleViewport(page.locator("footer"), 0, 210);
  await expect(input).toHaveValue("Draft before rotation");
});

test("settings fields fit above the keyboard", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const input = page.getByRole("dialog").locator("textarea").last();
  await input.fill("A profile draft");
  await expect(input).toHaveCSS("font-size", "16px");
  await visualViewport(page, 360, 30);
  const panel = page.locator('[id^="headlessui-dialog-panel-"]');
  await withinVisibleViewport(panel, 30, 390);
  await input.scrollIntoViewIfNeeded();
  await withinVisibleViewport(input, 30, 390);
  await page.screenshot({ path: info.outputPath("settings-keyboard.png") });
});

test("translation keeps its text field and controls above the keyboard", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).click();
  await page.getByRole("link", { name: "Translate", exact: true }).filter({ visible: true }).click();
  const input = page.getByRole("textbox", { name: "Text to translate" });
  await input.fill("Text to translate");
  await visualViewport(page, 400, 20);
  await withinVisibleViewport(input, 20, 420);
  await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBeGreaterThan(30);
  await withinVisibleViewport(page.locator("main"), 20, 420);
  await page.screenshot({ path: info.outputPath("translate-keyboard.png"), animations: "disabled" });
});

test("landscape safe areas keep the composer and navigation clear of cutouts", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await open(page, "?seed");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-left", "44px");
    document.documentElement.style.setProperty("--safe-right", "44px");
  });
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(44);
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(800);
  const nav = page.locator("[data-app-topbar]");
  await expect(nav).toHaveCSS("padding-left", "44px");
  await expect(nav).toHaveCSS("padding-right", "44px");
});

test("image prompt keeps Generate reachable and ignores IME confirmation", async ({ page }, info) => {
  await open(page, "?canvas");
  await page.locator("[data-app-topbar]").getByRole("button", { name: "New creation", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Prompt" });
  await input.fill("山と海");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.reactUiE2E.state().renders)).toHaveLength(0);
  await expect(input).toHaveCSS("font-size", "16px");
  await visualViewport(page, 300, 20);
  await withinVisibleViewport(page.locator('[id^="headlessui-dialog-panel-"]'), 20, 320);
  await withinVisibleViewport(page.getByRole("button", { name: "Generate", exact: true }), 20, 320);
  await page.screenshot({ path: info.outputPath("image-keyboard.png") });
});
