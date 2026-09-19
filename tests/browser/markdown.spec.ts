import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/markdown.html");
  await page.waitForFunction(() => window.markdownE2E);
});

test("emoji have one wrapper, preserve sequences, and use Noto for hearts and suns", async ({ page }) => {
  const emojis = ["😀", "❤️", "☀️", "🗺️", "🏗️", "👩🏽‍💻", "🏳️‍🌈", "🇨🇭", "1️⃣", "❤️‍🔥"];
  await page.evaluate((values) => window.markdownE2E.render(values.join(" ")), emojis);
  await expect(page.locator(".noto-emoji")).toHaveCount(emojis.length);
  await expect(page.locator(".noto-emoji .noto-emoji")).toHaveCount(0);
  await page.waitForFunction(() => document.documentElement.classList.contains("noto-emoji-ready"));
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument");
  const { nodeIds } = await client.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".noto-emoji" });
  for (const [index, nodeId] of nodeIds.entries()) {
    const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(
      fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName),
      emojis[index],
    ).toEqual([expect.stringMatching(/^Noto Emoji/)]);
  }
  await expect(page.getByTestId("markdown")).toHaveText(emojis.join(" ").replaceAll("\uFE0F", ""));
  await page.evaluate(() => window.markdownE2E.mode("native"));
  await expect(page.getByTestId("markdown")).toHaveText(emojis.join(" "));
  await expect(page.locator(".noto-emoji").first()).not.toHaveCSS("font-family", /Noto Emoji/);
});

test("finishing a stream and loading math preserve preview state", async ({ page }) => {
  const source = "```markdown\n# Preview\n```";
  await page.evaluate((content) => window.markdownE2E.render(content, true), source);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator("pre")).toContainText("# Preview");
  await page.evaluate((content) => window.markdownE2E.render(content + "\n\n$$x^2$$"), source);
  await expect(page.locator(".katex")).toBeVisible();
  await expect(page.locator("pre")).toContainText("# Preview");
});

test("code shows the latest source while highlighting waits", async ({ page }) => {
  await page.evaluate(() => window.markdownE2E.render("```js\nconst oldValue = 1;\n```"));
  await expect(page.locator("pre.shiki")).toBeVisible();
  await page.clock.install();
  await page.evaluate(() => window.markdownE2E.render("```js\nconst newValue = 2;\n```", true));
  await expect(page.locator("pre")).toContainText("const newValue = 2;");
  await expect(page.locator("pre")).not.toContainText("oldValue");
});

test("resolved artifact images update without reparsing the Markdown", async ({ page }) => {
  await page.evaluate(() => window.markdownE2E.render("![example](image.svg)", false, true));
  await expect(page.getByRole("img")).toHaveAttribute("src", "image.svg");
  await page.evaluate(() => window.markdownE2E.releaseImage());
  await expect(page.getByRole("img")).toHaveAttribute("src", /^blob:/);
});
