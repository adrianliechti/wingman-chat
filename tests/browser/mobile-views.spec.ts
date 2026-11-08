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
  await page.getByRole("button", { name: "New image" }).first().click();
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
