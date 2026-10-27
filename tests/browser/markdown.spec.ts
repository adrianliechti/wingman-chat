import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASIC = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
const WINGMAN = "urn:wingman:inline-ui:catalog:1";
const bind = (path: string) => ({ "@path": path });
const call = (name: string, args: Record<string, unknown>, catalogId?: string) => ({
  "@call": name,
  args,
  ...(catalogId && { catalogId }),
});
const text = (id: string, value: string) => ({ id, component: "Text", text: call("formatString", { value }) });
const custom = (id: string, component: string, props: Record<string, unknown>) => ({
  id,
  component,
  catalogId: WINGMAN,
  ...props,
});
const set = (path: string, value: unknown) => ({ functionCall: call("setValue", { path, value }, WINGMAN) });
const ui = (components: unknown[], dataModel: Record<string, unknown>) =>
  "```ui\n" +
  JSON.stringify({
    version: "v1.0",
    createSurface: { surfaceId: "example", catalogId: BASIC, components, dataModel },
  }) +
  "\n```";
const check = (name: string, path: string) => ({
  condition: call(name, { value: bind(path) }, BASIC),
  message: "Check this field",
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/tests/browser/fixtures/markdown.html");
  await page.waitForFunction(() => window.markdownE2E);
});

test("Inline UI repairs invalid Text visibility with the documented Wingman visibility wrapper", async ({ page }) => {
  await page.evaluate(
    (source) => window.markdownE2E.render(source),
    ui(
      [
        { id: "root", component: "Column", children: ["drawtext"] },
        { id: "drawtext", component: "Text", text: "Drawing details", visible: true },
      ],
      {},
    ),
  );
  await expect(page.getByRole("alert")).toHaveText("This interface could not be displayed.");
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByText(/Unrecognized key\(s\) in object: 'visible'/)).toBeVisible();

  const reference = readFileSync("skills/studio/inline-ui/references/layout.md", "utf8");
  const source = reference.match(/```ui\n[\s\S]*?\n```/)![0];
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const drawing = page.locator('[data-a2ui-id="drawtext"]');
  const toggle = page.getByRole("switch", { name: "Show drawing details" });
  await expect(drawing).toBeVisible();
  await toggle.click();
  await expect(drawing).toHaveCount(0);
  await toggle.click();
  await expect(drawing).toBeVisible();
});

for (const width of [390, 1920]) {
  for (const size of ["", 'width="100%"', 'width="1000" height="800"']) {
    test(`Inline UI SVG fits its height without clipping the bottom (${width}px, ${size || "viewBox"})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const source = ui(
        [
          { id: "root", component: "Column", children: ["drawing", "caption"] },
          custom("drawing", "Svg", {
            height: 180,
            label: "Complete house drawing",
            markup: `<svg viewBox="0 0 1000 800" ${size}><rect width="1000" height="800" fill="#ecf7fc"/><rect x="20" y="740" width="960" height="40" fill="#334155"/><text x="500" y="775" text-anchor="middle" fill="white">Foundation</text></svg>`,
          }),
          { id: "caption", component: "Text", text: "After the complete drawing" },
        ],
        {},
      );
      await page.evaluate((source) => window.markdownE2E.render(source), source);
      const drawing = page.getByRole("img", { name: "Complete house drawing" });
      await expect(drawing.locator("svg")).toBeVisible();
      const bounds = await drawing.evaluate((element) => {
        const container = element.getBoundingClientRect();
        const svg = element.querySelector("svg")!.getBoundingClientRect();
        const foundation = element.querySelector("text")!.getBoundingClientRect();
        return {
          height: container.height,
          svgBottom: svg.bottom - container.top,
          foundationBottom: foundation.bottom - container.top,
          width: container.width,
          svgWidth: svg.width,
        };
      });
      expect(bounds.height).toBeLessThanOrEqual(181);
      expect(bounds.svgBottom).toBeLessThanOrEqual(bounds.height + 1);
      expect(bounds.foundationBottom).toBeLessThanOrEqual(bounds.height + 1);
      expect(bounds.svgWidth).toBeLessThanOrEqual(bounds.width + 1);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }
}

test("Inline UI validates forms and preserves disclosure inputs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = ui(
    [
      { id: "root", component: "Column", children: ["form", "result"] },
      custom("form", "Form", {
        children: ["email", "plan", "details"],
        submit: "Submit request",
        action: set("/submitted", true),
      }),
      {
        id: "email",
        component: "TextField",
        label: "Email",
        value: bind("/email"),
        checks: [check("required", "/email"), check("email", "/email")],
      },
      custom("plan", "Select", {
        label: "Plan",
        value: bind("/plan"),
        options: [
          { value: "basic", label: "Basic" },
          { value: "pro", label: "Pro" },
        ],
        checks: [check("required", "/plan")],
      }),
      custom("details", "Collapsible", { title: "Details", children: ["notes"] }),
      {
        id: "notes",
        component: "TextField",
        label: "Notes",
        value: bind("/notes"),
        checks: [check("required", "/notes")],
      },
      text("result", "Submitted: ${/submitted}"),
    ],
    { email: "", plan: "", notes: "", submitted: false },
  );
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  await page.getByLabel("Email", { exact: true }).fill("invalid");
  await page.getByLabel("Email", { exact: true }).press("Tab");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Check the highlighted fields.")).toBeVisible();
  await expect(page.getByText("Submitted: false", { exact: true })).toBeVisible();
  const plan = page.getByRole("button", { name: /^Plan / });
  await expect(plan).toHaveAttribute("aria-invalid", "true");
  const errorId = await plan.getAttribute("aria-errormessage");
  expect(errorId).toBeTruthy();
  await expect(page.locator(`[id="${errorId}"]`)).not.toBeEmpty();
  await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
  await plan.click();
  await page.getByRole("option", { name: "Pro", exact: true }).click();
  await expect(plan).not.toHaveAttribute("aria-invalid", "true");
  const disclosure = page.locator("summary").filter({ hasText: "Details" });
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(disclosure).toHaveCSS("outline-style", "solid");
  await expect(disclosure).toHaveCSS("outline-width", "2px");
  await page.getByLabel("Notes", { exact: true }).fill("Keep this value");
  await disclosure.focus();
  await disclosure.press("Space");
  await expect(page.getByLabel("Notes", { exact: true })).not.toBeVisible();
  await disclosure.press("Enter");
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Keep this value");
  await page.getByLabel("Email", { exact: true }).press("Enter");
  await expect(page.getByText("Submitted: true", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

const controls = ui(
  [
    { id: "root", component: "Column", children: ["gear", "mode", "lock", "result"] },
    custom("gear", "Select", {
      label: "Gear",
      description: "Choose a gear",
      value: bind("/gear"),
      disabled: bind("/locked"),
      options: [
        { value: "1", label: "First gear" },
        { value: "2", label: "Second gear" },
      ],
    }),
    custom("mode", "Segmented", {
      label: "Mode",
      value: bind("/mode"),
      disabled: bind("/locked"),
      options: [
        { value: "road", label: "road" },
        { value: "track", label: "track" },
      ],
    }),
    custom("lock", "Toggle", {
      label: "Lock controls",
      description: "Keep the current settings",
      value: bind("/locked"),
    }),
    text("result", "Gear: ${/gear}; mode: ${/mode}"),
  ],
  { gear: "1", mode: "road", locked: false },
);

test("Inline UI table sorting works with the keyboard and pagination follows updated rows", async ({ page }) => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ value: index + 1 }));
  const source = ui(
    [
      { id: "root", component: "Column", children: ["table", "button"] },
      custom("table", "Table", { columns: [{ key: "value", label: "Value" }], rows: bind("/rows"), pageSize: 2 }),
      { id: "button", component: "Button", child: "label", action: set("/rows", rows.slice(0, 4)) },
      { id: "label", component: "Text", text: "Limit rows" },
    ],
    { rows },
  );
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator("tbody td")).toHaveText(["17", "18"]);
  await page.getByRole("button", { name: "Limit rows" }).click();
  await expect(page.locator("tbody td")).toHaveText(["3", "4"]);
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.locator("tbody td")).toHaveText(["1", "2"]);
  const sort = page.getByRole("button", { name: "Value", exact: true });
  await sort.focus();
  await sort.press("Enter");
  await expect(page.getByRole("columnheader", { name: "Value" })).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("tbody td")).toHaveText(["4", "3"]);
  await sort.press("Space");
  await expect(page.getByRole("columnheader", { name: "Value" })).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("tbody td")).toHaveText(["1", "2"]);
});

test("identical UI blocks stay independent across owners and reloads", async ({ page }) => {
  const source = ui(
    [
      { id: "root", component: "Column", children: ["count", "button"] },
      text("count", "Count: ${/n}"),
      {
        id: "button",
        component: "Button",
        child: "label",
        action: set("/n", call("evaluate", { expression: "n + 1", values: { n: bind("/n") } }, WINGMAN)),
      },
      { id: "label", component: "Text", text: "Increment" },
    ],
    { n: 1 },
  );
  const content = source + "\n\n" + source;
  const show = (owner: string) =>
    page.evaluate(({ content, owner }) => window.markdownE2E.render(content, false, false, false, owner), {
      content,
      owner,
    });
  await show("chat-a/message-a/part-a");
  await page.getByRole("button", { name: "Increment", exact: true }).first().click();
  await expect(page.getByText("Count: 2", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Count: 1", { exact: true })).toHaveCount(1);
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(
      (key) => key.startsWith("wingman:a2ui:1:") && JSON.parse(localStorage.getItem(key)!).models?.example?.n === 2,
    ),
  );
  await page.reload();
  await page.waitForFunction(() => window.markdownE2E);
  await show("chat-a/message-a/part-a");
  await expect(page.getByText("Count: 2", { exact: true })).toHaveCount(1);
  await show("chat-b/message-a/part-a");
  await expect(page.getByText("Count: 1", { exact: true })).toHaveCount(2);
  await show("chat-a/message-a/part-a");
  await expect(page.getByText("Count: 2", { exact: true })).toHaveCount(1);
});

test("a chart with pending data keeps neighbouring controls usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = ui(
    [
      { id: "root", component: "Column", children: ["chart", "button"] },
      custom("chart", "Chart", { kind: "bar", data: bind("/rows"), x: "name", y: "value" }),
      { id: "button", component: "Button", child: "label", action: set("/rows", [{ name: "A", value: 1 }]) },
      { id: "label", component: "Text", text: "Load data" },
    ],
    { rows: [] },
  );
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  await expect(page.getByText("No data to chart", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load data", exact: true }).click();
  await expect(page.getByText("No data to chart", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("markdown").locator("svg[role=img]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const dark of [false, true]) {
  test(`Inline UI keyboard controls (${dark ? "dark narrow" : "light"})`, async ({ page }) => {
    test.setTimeout(45_000);
    if (dark) await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      ({ source, dark }) => {
        document.documentElement.classList.toggle("dark", dark);
        window.markdownE2E.render(source);
      },
      { source: controls, dark },
    );
    const gear = page.getByRole("button", { name: /^Gear/ });
    await expect(gear).toHaveAccessibleDescription("Choose a gear");
    await expect(gear).toHaveCSS("cursor", "pointer");
    await gear.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(page.getByRole("option", { name: "First gear" })).toHaveAttribute("aria-selected", "true");
    await listbox.press("ArrowDown");
    await listbox.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(gear).toBeFocused();
    await expect(gear).toContainText("Second gear");
    await expect(page.getByTestId("markdown")).toContainText("Gear: 2; mode: road");
    const modes = page.getByRole("radiogroup", { name: "Mode" });
    await modes.getByRole("radio", { name: "road", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(modes.getByRole("radio", { name: "track", exact: true })).toBeChecked();
    await expect(page.getByTestId("markdown")).toContainText("Gear: 2; mode: track");
    const toggle = page.getByRole("switch", { name: "Lock controls" });
    await expect(toggle).toHaveAccessibleDescription("Keep the current settings");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await expect(gear).toBeDisabled();
    await expect(gear).toHaveCSS("cursor", "not-allowed");
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

test("Inline UI disables streaming controls and handles empty choices", async ({ page }) => {
  await page.evaluate((source) => window.markdownE2E.render(source, true), controls);
  await expect(page.getByRole("button", { name: /^Gear/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "road", exact: true })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Lock controls" })).toBeDisabled();
  await page.evaluate((source) => window.markdownE2E.render(source), controls);
  await expect(page.getByRole("button", { name: /^Gear/ })).toBeEnabled();
  const source = ui(
    [
      { id: "root", component: "Column", children: ["choice", "none", "value"] },
      custom("choice", "Select", {
        label: "Choice",
        value: bind("/choice"),
        options: [
          { value: "0", label: "Zero" },
          { value: "", label: "Empty value" },
        ],
      }),
      custom("none", "Select", { label: "No options", value: bind("/choice"), options: [] }),
      text("value", "Value: [${/choice}]"),
    ],
    { choice: "missing" },
  );
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  const choice = page.getByRole("button", { name: /^Choice/ });
  await expect(page.getByRole("button", { name: /^No options/ })).toBeDisabled();
  await choice.click();
  await page.getByRole("option", { name: "Zero", exact: true }).click();
  await expect(page.getByTestId("markdown")).toContainText("Value: [0]");
  await choice.click();
  await page.getByRole("option", { name: "Empty value", exact: true }).click();
  await expect(choice).toContainText("Empty value");
  await expect(page.getByTestId("markdown")).toContainText("Value: []");
});

test("emoji preserve sequences, use Noto glyphs, and keep plain hearts colored", async ({ page }) => {
  const emojis = ["😀", "☀️", "🗺️", "🏗️", "👩🏽‍💻", "🏳️‍🌈", "🇨🇭", "1️⃣", "💔", "❤️‍🔥", "❤️‍🩹"];
  const hearts = ["❤️", "❤", "🩷", "🧡", "💛", "💚", "💙", "🩵", "💜", "🤎", "🖤", "🩶", "🤍"];
  const source = [...emojis, ...hearts].join(" ");
  await page.evaluate((source) => window.markdownE2E.render(source), source);
  await expect(page.locator(".noto-emoji")).toHaveCount(emojis.length);
  await expect(page.locator(".noto-emoji .noto-emoji")).toHaveCount(0);
  await expect(page.locator(".emoji-swatch-heart")).toHaveText(hearts);
  await expect(page.locator(".emoji-swatch-heart .noto-emoji")).toHaveCount(0);
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
  await expect(page.getByTestId("markdown")).toHaveText(
    `${emojis.join(" ").replaceAll("\uFE0F", "")} ${hearts.join(" ")}`,
  );
  await page.evaluate(() => window.markdownE2E.mode("native"));
  await expect(page.getByTestId("markdown")).toHaveText(source);
  await expect(page.locator(".emoji-swatch-heart")).toHaveCount(0);
  await expect(page.locator(".noto-emoji")).toHaveCount(emojis.length + hearts.length);
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

test("mixed task lists preserve ordinary bullet and number markers", async ({ page }) => {
  const markdown = "- [x] Completed task\n- Ordinary bullet\n\n1. [ ] Pending task\n2. Ordinary numbered item";
  await page.evaluate(({ source, markdown }) => window.markdownE2E.render(source + "\n\n" + markdown), {
    source: ui([{ id: "root", component: "Text", text: markdown }], {}),
    markdown,
  });
  const bullets = page.getByRole("listitem").filter({ hasText: /^Ordinary bullet$/ });
  const numbers = page.getByRole("listitem").filter({ hasText: /^Ordinary numbered item$/ });
  await expect(bullets).toHaveCount(2);
  await expect(numbers).toHaveCount(2);
  for (const bullet of await bullets.all()) await expect(bullet).toHaveCSS("list-style-type", "disc");
  for (const number of await numbers.all()) await expect(number).toHaveCSS("list-style-type", "decimal");
  await expect(page.getByRole("checkbox")).toHaveCount(4);
});

for (const dark of [false, true]) {
  test(`Inline UI choices and Markdown stay readable and keyboard accessible (${dark ? "dark narrow" : "light"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: dark ? 390 : 1050, height: 1200 });
    await page.addStyleTag({ content: "html, body, #root { position: static; height: auto; overflow: visible; }" });
    const source = ui(
      [
        { id: "root", component: "Column", children: ["copy", "choices", "notes"] },
        {
          id: "copy",
          component: "Text",
          text: "## A little more room to think\n\nA **clear plan** starts with the right choices. Adjust the controls below, then review your `next_step`.\n\n> Good interfaces keep the detail readable and the decisions close.\n\n- [x] Gather the context\n  - Keep related notes together\n- [ ] Choose what happens next\n\n| Milestone | Owner | Days |\n| :-- | :-- | --: |\n| Discovery | Product | 3 |\n| Prototype | Design | 5 |\n\n```text\nA long code line stays inside its own scroll area: abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz\n```",
        },
        custom("choices", "Grid", { columns: 2, children: ["left", "right"] }),
        { id: "left", component: "Card", child: "left_column" },
        { id: "left_column", component: "Column", children: ["notify", "chips", "multi"] },
        { id: "notify", component: "CheckBox", label: "Send an update", value: bind("/notify") },
        {
          id: "chips",
          component: "ChoicePicker",
          label: "Include in the plan",
          variant: "multipleSelection",
          displayStyle: "chips",
          value: bind("/topics"),
          options: [
            { value: "design", label: "Design" },
            { value: "research", label: "Research" },
            { value: "review", label: "Review" },
          ],
        },
        custom("multi", "MultiSelect", {
          label: "Deliverables",
          value: bind("/deliverables"),
          options: [
            { value: "brief", label: "Project brief" },
            { value: "prototype", label: "Working prototype" },
          ],
        }),
        { id: "right", component: "Card", child: "right_column" },
        { id: "right_column", component: "Column", children: ["radio", "checklist"] },
        custom("radio", "Radio", {
          label: "Working pace",
          value: bind("/pace"),
          options: [
            { value: "steady", label: "Steady" },
            { value: "focused", label: "Focused" },
          ],
        }),
        custom("checklist", "Checklist", {
          label: "Ready to begin",
          value: bind("/ready"),
          items: [
            { label: "Agree on scope", description: "Keep the first milestone focused." },
            { label: "Invite the team", description: "Give everyone the context they need." },
          ],
        }),
        {
          id: "notes",
          component: "TextField",
          label: "Notes",
          value: bind("/notes"),
          placeholder: "What should we keep in mind?",
        },
      ],
      {
        notify: true,
        topics: ["design"],
        deliverables: ["brief"],
        pace: "steady",
        ready: ["Agree on scope"],
        notes: "",
      },
    );
    await page.evaluate(
      ({ source, dark }) => {
        document.documentElement.classList.toggle("dark", dark);
        window.markdownE2E.render(
          source +
            "\n\n### Notes from the conversation\n\n- [x] A completed Markdown task\n\n  Supporting detail stays below its task.\n\n  - A nested list also stays on its own line.\n\n- [ ] The next step stays easy to spot.",
        );
      },
      { source, dark },
    );
    const notify = page.getByRole("checkbox", { name: "Send an update", exact: true });
    await expect(notify).toBeChecked();
    await expect(notify).toHaveCSS("appearance", "none");
    await notify.focus();
    await notify.press("Space");
    await expect(notify).not.toBeChecked();
    await expect(notify).toBeFocused();
    await expect(notify).toHaveCSS("outline-width", "2px");
    await page.getByText("Send an update", { exact: true }).click();
    await expect(notify).toBeChecked();
    const research = page.getByRole("checkbox", { name: "Research", exact: true });
    await research.focus();
    await research.press("Space");
    await expect(research).toBeChecked();
    const prototype = page.getByRole("checkbox", { name: "Working prototype", exact: true });
    await page.getByText("Working prototype", { exact: true }).click();
    await expect(prototype).toBeChecked();
    await page.getByRole("radio", { name: "Steady", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Focused", exact: true })).toBeChecked();
    await page.getByText("Invite the team", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Invite the team", exact: true })).toBeChecked();
    const copy = page.locator("[data-a2ui-text]");
    await expect(copy.getByRole("heading", { name: "A little more room to think" })).toBeVisible();
    await expect(copy.getByRole("checkbox").first()).toBeDisabled();
    await expect(copy.getByRole("checkbox").first()).toBeChecked();
    await expect(copy.locator("ul ul")).toHaveText("Keep related notes together");
    await expect(copy.getByRole("columnheader", { name: "Days" })).toHaveCSS("text-align", "right");
    await expect(copy.locator("pre code")).toContainText("abcdefghijklmnopqrstuvwxyz");
    await expect(page.locator("li.task-list-item li").last()).toContainText("A nested list");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.UPDATE_INLINE_UI_GALLERY === "1") {
      await page.getByLabel("Notes", { exact: true }).focus();
      await page.screenshot({
        path: `docs/assets/inline-ui-controls${dark ? "-dark" : ""}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}
