import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/markdown.html");
  await page.waitForFunction(() => window.markdownE2E);
});

const intelligentControls =
  "```ui\n" +
  JSON.stringify({
    title: "Explore the controls",
    state: { gear: 1, mode: "road", locked: false },
    children: [
      {
        type: "select",
        label: "Gear",
        description: "Choose a gear",
        bind: "gear",
        disabled: "locked",
        options: [
          { value: 1, label: "First gear" },
          { value: 2, label: "Second gear" },
        ],
      },
      { type: "segmented", label: "Mode", bind: "mode", disabled: "locked", options: ["road", "track"] },
      { type: "toggle", label: "Lock controls", description: "Keep the current settings", bind: "locked" },
      { type: "text", text: "Next gear: {{ gear + 1 }}; mode: {{ mode }}" },
    ],
  }) +
  "\n```";

for (const dark of [false, true]) {
  test(`intelligent controls support keyboard selection and bound values (${dark ? "dark narrow" : "light"})`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    if (dark) await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      ({ source, dark }) => {
        document.documentElement.classList.toggle("dark", dark);
        window.markdownE2E.render(source);
      },
      { source: intelligentControls, dark },
    );
    const gear = page.getByRole("button", { name: /^Gear/ });
    await expect(gear).toHaveAccessibleDescription("Choose a gear");
    await gear.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(page.getByRole("option", { name: "First gear" })).toHaveAttribute("aria-selected", "true");
    await listbox.press("ArrowDown");
    await listbox.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(gear).toBeFocused();
    await expect(gear).toContainText("Second gear");
    await expect(page.getByTestId("markdown")).toContainText("Next gear: 3; mode: road");

    const modes = page.getByRole("radiogroup", { name: "Mode" });
    await modes.getByRole("radio", { name: "road", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(modes.getByRole("radio", { name: "track", exact: true })).toBeChecked();
    await expect(page.getByTestId("markdown")).toContainText("Next gear: 3; mode: track");

    const toggle = page.getByRole("switch", { name: "Lock controls" });
    await expect(toggle).toHaveAccessibleDescription("Keep the current settings");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await expect(gear).toBeDisabled();
    await expect(modes.getByRole("radio", { name: "road", exact: true })).toBeDisabled();
    await toggle.click();
    await gear.click();
    await expect(listbox).toBeVisible();
    const bounds = await listbox.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(gear).toBeFocused();
  });
}

test("intelligent controls stay disabled during streaming and handle missing or empty choices", async ({ page }) => {
  test.setTimeout(45_000);
  await page.evaluate((source) => window.markdownE2E.render(source, true), intelligentControls);
  await expect(page.getByRole("button", { name: /^Gear/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "road", exact: true })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Lock controls" })).toBeDisabled();
  await page.evaluate((source) => window.markdownE2E.render(source), intelligentControls);
  await expect(page.getByRole("button", { name: /^Gear/ })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "road", exact: true })).toBeEnabled();
  await expect(page.getByRole("switch", { name: "Lock controls" })).toBeEnabled();

  const source =
    "```ui\n" +
    JSON.stringify({
      state: { choice: "missing" },
      children: [
        {
          type: "select",
          label: "Choice",
          bind: "choice",
          placeholder: "Pick one",
          options: [
            { value: 0, label: "Zero" },
            { value: "", label: "Empty value" },
          ],
        },
        { type: "select", label: "No options", bind: "choice", options: [] },
        { type: "text", text: "Value: [{{ choice }}]" },
      ],
    }) +
    "\n```";
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  const choice = page.getByRole("button", { name: /^Choice/ });
  await expect(choice).toContainText("Pick one");
  await expect(page.getByRole("button", { name: /^No options/ })).toBeDisabled();
  await choice.click();
  await page.getByRole("option", { name: "Zero", exact: true }).click();
  await expect(page.getByTestId("markdown")).toContainText("Value: [0]");
  await choice.click();
  await page.getByRole("option", { name: "Empty value", exact: true }).click();
  await expect(choice).toContainText("Empty value");
  await expect(page.getByTestId("markdown")).toContainText("Value: []");
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
  await page.evaluate((content) => window.markdownE2E.render(content), source);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator("pre")).toContainText("# Preview");
  await page.evaluate((content) => window.markdownE2E.render(content, true), source);
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
  await expect(page.locator("pre")).toContainText("# Preview");
  await page.evaluate((content) => window.markdownE2E.render(content + "\n\n$$x^2$$"), source);
  await expect(page.locator(".katex")).toBeVisible();
  await expect(page.locator("pre")).toContainText("# Preview");
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
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

test("math updates safely and uses valid paragraph markup", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.evaluate(() => window.markdownE2E.render("$$\nx^2\n$$"));
  await expect(page.locator(".katex-display")).toBeVisible();
  await expect(page.locator("p div")).toHaveCount(0);
  await page.evaluate(() => window.markdownE2E.render("$$y^3$$"));
  await expect(page.locator('annotation[encoding="application/x-tex"]')).toHaveText("y^3");
  await page.evaluate(() => window.markdownE2E.render("$$\\href{javascript:alert(1)}{click}$$"));
  await expect(page.locator(".katex")).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("loose task lists keep checkboxes and task styling", async ({ page }) => {
  await page.evaluate(() => window.markdownE2E.render("- [x] done\n\n- [ ] pending"));
  await expect(page.locator("ul.task-list")).toHaveCount(1);
  await expect(page.locator("li.task-list-item")).toHaveCount(2);
  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.first()).toBeChecked();
  await expect(checkboxes.last()).not.toBeChecked();
  await expect(checkboxes.first()).toBeDisabled();
});

test("common syntax renders through the actual chat component", async ({ page }) => {
  await page.evaluate(() =>
    window.markdownE2E.render(
      "Heading\n=======\n\nA &amp; B. <https://example.com> a@example.com\n\n    literal \\(x\\)\n\n| A | B |\n| - | -: |\n| first | second |\n\nNote[^n].\n\n[^n]: Footnote.",
    ),
  );
  await expect(page.getByRole("heading", { name: "Heading", exact: true })).toBeVisible();
  await expect(page.getByTestId("markdown")).toContainText("A & B.");
  await expect(page.getByRole("link", { name: "https://example.com", exact: true })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  await expect(page.getByRole("link", { name: "a@example.com", exact: true })).toHaveAttribute(
    "href",
    "mailto:a@example.com",
  );
  await expect(page.locator("pre")).toContainText("literal \\(x\\)");
  await expect(page.locator("tbody td").last()).toHaveCSS("text-align", "right");
  await expect(page.locator("[data-footnote-ref]")).toHaveAttribute("href", "#user-content-fn-n");
  await expect(page.locator("#user-content-fn-n")).toContainText("Footnote.");
});

test("code blocks preserve their trailing blank line", async ({ page }) => {
  await page.evaluate(() => window.markdownE2E.render("```text\nfirst\n\n```", true));
  await expect(page.locator("pre")).toBeVisible();
  expect(await page.locator("pre").textContent()).toBe("first\n");
});

for (const mode of ["characters", "words"] as const) {
  test(`streaming by ${mode} keeps tables mounted and respects block boundaries`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const table = "| A | B |\n| - | - |\n| x | y |\n";
    await page.evaluate((source) => window.markdownE2E.render(source), table);
    await expect(page.locator("table")).toHaveCount(1);
    await page.evaluate(
      async ({ table, mode }) => {
        const original = document.querySelector("table");
        const tail = "---  \n\n> Heading\n> ===\noutside\n\nfirst\n  \nsecond\n\n$$\nx\n---\n$$";
        const chunks = mode === "characters" ? tail.split("") : tail.match(/\S+\s*|\s+/g)!;
        let prefix = table;
        for (const chunk of chunks) {
          prefix += chunk;
          window.markdownE2E.render(prefix, true);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          if (document.querySelector("table") !== original) throw new Error(`Table remounted at ${prefix}`);
        }
        window.markdownE2E.render(prefix, false);
      },
      { table, mode },
    );
    await expect(page.locator("blockquote")).toHaveText("Heading");
    await expect(page.locator("blockquote + p")).toHaveText("outside");
    await expect(page.locator("p").filter({ hasText: /^first$/ })).toHaveCount(1);
    await expect(page.locator("p").filter({ hasText: /^second$/ })).toHaveCount(1);
    await expect(page.locator("h2")).toHaveCount(0);
    await expect(page.locator(".katex-display")).toBeVisible();
    await expect(page.locator("p div")).toHaveCount(0);
  });

  test(`streaming by ${mode} preserves previews and finishes with correct Markdown`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    // Disable the reveal animation so each supplied prefix reaches the renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const preview = "```markdown\n# Preview\n```\n\n";
    await page.evaluate((content) => window.markdownE2E.render(content), preview);
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const tail =
      "Heading\n=======\n\n[link](https://example.com) &amp; :smile: 👩🏽‍💻\n\n- [x] done\n\n| A | B |\n| - | - |\n| x | y |\n\n\\(x^2\\)\n\n~~~text\n\\(literal\\) [label](unfinished\n~~~";
    const finalSource = preview + tail;
    await page.evaluate(
      async ({ prefix, tail, mode }) => {
        const chunks = mode === "characters" ? tail.split("") : tail.match(/\S+\s*|\s+/g)!;
        for (const chunk of chunks) {
          prefix += chunk;
          window.markdownE2E.render(prefix, true);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }
        window.markdownE2E.render(prefix, false);
      },
      { prefix: preview, tail, mode },
    );
    await expect(page.getByRole("heading", { name: "Heading", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "link", exact: true })).toHaveAttribute("href", "https://example.com");
    await expect(page.getByRole("checkbox")).toBeChecked();
    await expect(page.locator("tbody td")).toHaveCount(2);
    await expect(page.locator(".katex")).toBeVisible();
    await expect(page.locator("pre").first()).toContainText("# Preview");
    await expect(page.locator("pre").last()).toContainText("\\(literal\\) [label](unfinished");
    await expect(page.locator(".noto-emoji")).toHaveCount(2);
    const streamedText = await page.getByTestId("markdown").textContent();
    await page.evaluate((content) => window.markdownE2E.render(content), finalSource);
    await expect(page.getByTestId("markdown")).toHaveText(streamedText!);
    expect(errors).toEqual([]);
  });
}
