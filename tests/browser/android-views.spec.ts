import { devices, expect, test as base, type CDPSession, type Locator, type Page } from "@playwright/test";

const test = base.extend<{ android: CDPSession }>({
  android: async ({ context, page }, use) => {
    const session = await context.newCDPSession(page);
    await use(session);
    await session.detach();
  },
});

test.skip(({ browserName }) => browserName !== "chromium", "Android layout checks require Chromium emulation");
test.use({ actionTimeout: 15_000 });

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
  await expect(page.getByRole("textbox", { name: "Chat message input" })).toBeEnabled();
  expect(await page.evaluate(() => navigator.userAgent)).toContain("Android");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
}

// Override the browser's native environment values, rather than replacing the
// app's CSS variables. The maximum inset stays stable as Android's chin moves.
async function safeAreas(android: CDPSession, bottom: number, left = 0, top = 0, right = 0) {
  await android.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top, right, bottom, left, topMax: top, rightMax: right, bottomMax: 24, leftMax: left },
  });
}

async function withinBounds(
  locator: Locator,
  {
    top = 0,
    bottom,
    left = 0,
    right,
  }: {
    top?: number;
    bottom: number;
    left?: number;
    right: number;
  },
) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() => locator.evaluate((element) => element.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(top - 1);
  await expect
    .poll(() => locator.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(bottom + 1);
  await expect
    .poll(() => locator.evaluate((element) => element.getBoundingClientRect().left))
    .toBeGreaterThanOrEqual(left - 1);
  await expect
    .poll(() => locator.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(right + 1);
}

async function navigate(page: Page, name: "Translate" | "Canvas") {
  if (await page.evaluate(() => innerWidth < 768)) {
    await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).tap();
  }
  await page.getByRole("link", { name, exact: true }).filter({ visible: true }).tap();
}

const profiles = [
  ["Pixel 10", devices["Pixel 10"]],
  ["Pixel 10 landscape", devices["Pixel 10 landscape"]],
  ["Pixel 10 Pro", devices["Pixel 10 Pro"]],
  ["Galaxy S24", devices["Galaxy S24"]],
  ["Galaxy S24 landscape", devices["Galaxy S24 landscape"]],
  ["Galaxy Tab S9", devices["Galaxy Tab S9"]],
  ["Galaxy Tab S9 landscape", devices["Galaxy Tab S9 landscape"]],
  [
    "Android tablet 800x1280",
    {
      ...devices["Galaxy Tab S9"],
      viewport: { width: 800, height: 1280 },
      screen: { width: 800, height: 1280 },
    },
  ],
] as const;

for (const [name, profile] of profiles) {
  test.describe(name, () => {
    const { defaultBrowserType: _browserType, ...options } = profile;
    test.use(options);

    test("native safe areas and dynamic browser bars protect the composer", async ({ page, android }, info) => {
      await open(page, "?seed");
      const { width, height } = profile.viewport;
      const left = width > height ? 32 : 0;
      const input = page.getByRole("textbox", { name: "Chat message input" });
      const footer = page.locator("footer");
      for (const bottom of [0, 24, 0, 24]) {
        await safeAreas(android, bottom, left);
        await expect
          .poll(() => footer.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)))
          .toBe(bottom + (width < 768 ? 8 : 16));
        await withinBounds(footer.locator(":scope > div"), { bottom: height - bottom, left, right: width });
        await withinBounds(input, { bottom: height - bottom, left, right: width });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      await page.screenshot({ path: info.outputPath("android-safe-area.png"), animations: "disabled" });
      if (width < 768) {
        await page.getByRole("button", { name: "Fixture", exact: true }).tap();
        const close = page.getByRole("dialog").getByRole("button", { name: "Close", exact: true });
        await withinBounds(close, { bottom: height - 24, left, right: width });
        await close.tap();
      }
    });

    test("layout-resizing keyboard preserves a multiline draft and restores gesture padding", async ({
      page,
      android,
    }, info) => {
      await open(page, "?seed");
      const { width, height } = profile.viewport;
      await safeAreas(android, 24);
      const input = page.getByRole("textbox", { name: "Chat message input" });
      const draft = "Android draft\n".repeat(20);
      await input.fill(draft);
      await expect(input).toBeFocused();
      const visibleHeight = height - Math.min(320, Math.round(height * 0.4));
      // interactive-widget=resizes-content resizes both viewports on Android.
      // Playwright does not open an OS keyboard; resize the actual layout viewport.
      await page.setViewportSize({ width, height: visibleHeight });
      await expect(page.locator("html")).toHaveClass(/keyboard-open/);
      await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
      await expect.poll(() => page.evaluate(() => visualViewport!.height)).toBe(visibleHeight);
      await withinBounds(input, { bottom: visibleHeight, right: width });
      await expect
        .poll(() =>
          input.evaluate(
            (element) =>
              element.getBoundingClientRect().top -
              document.querySelector("[data-app-topbar]")!.getBoundingClientRect().bottom,
          ),
        )
        .toBeGreaterThanOrEqual(0);
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath("android-keyboard.png"), animations: "disabled" });
      await page.setViewportSize({ width, height });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(draft);
      await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
      await expect
        .poll(() => page.locator("footer").evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)))
        .toBe(24 + (width < 768 ? 8 : 16));
      await input.fill("");
      await page.evaluate(() => window.reactUiE2E.flush());
    });

    test("translation, canvas and settings remain reachable with touch", async ({ page, android }) => {
      await open(page);
      const { width, height } = profile.viewport;
      await safeAreas(android, 24);
      await navigate(page, "Translate");
      const source = page.getByRole("textbox", { name: "Text to translate" });
      await source.fill("Translate an Android draft");
      const visibleHeight = height - Math.min(320, Math.round(height * 0.4));
      await page.setViewportSize({ width, height: visibleHeight });
      await withinBounds(source, { bottom: visibleHeight, right: width });
      await page.setViewportSize({ width, height });
      await source.blur();
      await navigate(page, "Canvas");
      await page.locator("[data-app-topbar]").getByRole("button", { name: "New creation", exact: true }).tap();
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
      await prompt.fill("An Android landscape");
      await page.setViewportSize({ width, height: visibleHeight });
      await withinBounds(page.locator('[id^="headlessui-dialog-panel-"]'), { bottom: visibleHeight, right: width });
      await withinBounds(page.getByRole("button", { name: "Generate", exact: true }), {
        bottom: visibleHeight,
        right: width,
      });
      await page.setViewportSize({ width, height });
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).tap();
      await expect(page.getByRole("dialog")).toBeHidden();
      if (width < 768) {
        await page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true }).tap();
        await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).tap();
      } else {
        await page.getByRole("button", { name: "Account menu", exact: true }).tap();
        await page.getByRole("menuitem", { name: "Settings", exact: true }).tap();
      }
      await page.getByRole("button", { name: "Profile", exact: true }).tap();
      const settingsInput = page.getByRole("dialog").locator("textarea").last();
      await settingsInput.fill("An Android profile draft");
      await page.setViewportSize({ width, height: visibleHeight });
      await withinBounds(page.locator('[id^="headlessui-dialog-panel-"]'), { bottom: visibleHeight, right: width });
      await settingsInput.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await withinBounds(settingsInput, { bottom: visibleHeight, right: width });
      await withinBounds(page.getByRole("button", { name: "Close settings", exact: true }), {
        bottom: visibleHeight,
        right: width,
      });
    });

    if (name === "Pixel 10") {
      test("rotation with the layout-resizing keyboard preserves the draft and controls", async ({ page, android }) => {
        await open(page, "?seed");
        const input = page.getByRole("textbox", { name: "Chat message input" });
        const draft = "Draft across rotation\n".repeat(20);
        await input.fill(draft);
        await safeAreas(android, 0);
        await page.setViewportSize({ width: 360, height: 440 });
        await expect(page.locator("html")).toHaveClass(/keyboard-open/);
        await page.setViewportSize({ width: 756, height: 185 });
        await safeAreas(android, 0, 32);
        await withinBounds(input, { top: 60, bottom: 185, left: 32, right: 756 });
        await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
        await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport();
        await page.setViewportSize({ width: 756, height: 308 });
        await safeAreas(android, 24, 32);
        await expect(input).toHaveValue(draft);
        await expect(input).toBeFocused();
        await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
        await withinBounds(input, { top: 60, bottom: 284, left: 32, right: 756 });
        await input.fill("");
        await page.evaluate(() => window.reactUiE2E.flush());
      });

      test("native pinch zoom preserves the layout and gesture inset", async ({ page, android }) => {
        await open(page, "?seed");
        await safeAreas(android, 24);
        await android.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
        await expect.poll(() => page.evaluate(() => visualViewport!.scale)).toBe(2);
        await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
        await expect
          .poll(() => page.locator("main").evaluate((element) => element.getBoundingClientRect().height))
          .toBe(732);
        await expect(page.locator("footer")).toHaveCSS("bottom", "0px");
        await expect(page.locator("footer")).toHaveCSS("padding-bottom", "32px");
        await android.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
        await expect.poll(() => page.evaluate(() => visualViewport!.scale)).toBe(1);
      });
    }
  });
}
