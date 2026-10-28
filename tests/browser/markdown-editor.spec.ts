import { expect, test, type Page } from "@playwright/test";

/** Opens the artifacts drawer on a fresh file and returns a reader for its saved content. */
async function openFile(page: Page, path: string, content: string) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { artifacts: {}, models: [] } }));
  await page.goto("/tests/browser/fixtures/artifacts.html");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  const write = (next: string) =>
    page.evaluate(([id, path, next]) => window.artifactsE2E.write(id, path, next), [id, path, next] as const);
  await write(content);
  const read = () =>
    page.evaluate(([id, path]) => window.artifactsE2E.read(id, path).then((file) => file?.content), [
      id,
      path,
    ] as const);
  return { read, write };
}

const saveButton = (page: Page) => page.getByRole("button", { name: "Save", exact: true });
const cancelButton = (page: Page) => page.getByRole("button", { name: "Discard changes" });

const caretAtEnd = (textarea: HTMLTextAreaElement) => {
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
};

const NOTES = "# Title\n\nFirst   paragraph with  *odd*   spacing.\n\nSome **bold** words.\n\n- one\n- two\n";

test("the preview edits one block's source and saves only that block", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", NOTES);
  await expect(page.locator(".prose span.font-semibold")).toHaveText("bold");
  await expect(saveButton(page)).toBeHidden();

  // Clicking rendered text opens that block's source with the caret where the click landed.
  await page.locator(".prose span.font-semibold").click();
  const block = page.getByRole("textbox", { name: "Block source" });
  await expect(block).toHaveValue("Some **bold** words.");
  const caret = await block.evaluate((textarea: HTMLTextAreaElement) => textarea.selectionStart);
  expect(caret).toBeGreaterThanOrEqual("Some **".length);
  expect(caret).toBeLessThanOrEqual("Some **bold".length);

  await block.evaluate(caretAtEnd);
  await block.pressSequentially(" Added");
  expect(await read()).toBe(NOTES);
  await saveButton(page).click();
  await expect.poll(read).toBe(NOTES.replace("words.", "words. Added"));
  await expect(saveButton(page)).toBeHidden();

  // Arrows past the end continue into the next block; Escape shows it rendered again.
  await block.press("ArrowDown");
  await expect(block).toHaveValue("- one\n- two");
  await block.press("Escape");
  await expect(block).toBeHidden();
  await expect(page.locator(".prose p", { hasText: "Added" })).toHaveText("Some bold words. Added");
});

test("cancel drops unsaved edits", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", NOTES);
  await page.locator(".prose h1").click();
  const block = page.getByRole("textbox", { name: "Block source" });
  await block.evaluate(caretAtEnd);
  await block.pressSequentially(" draft");
  await cancelButton(page).click();
  await expect(block).toBeHidden();
  await expect(page.locator(".prose h1")).toHaveText("Title");
  await expect(saveButton(page)).toBeHidden();
  expect(await read()).toBe(NOTES);
});

for (const readOnly of [false, true]) {
  test(`fragment links navigate within the ${readOnly ? "archived" : "editable"} file preview without entering edit mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const source =
      "# Contents\n\n[Jump to details](#shell--config)\n\n" +
      // An embedded Markdown preview has its own headings and must not steal the jump.
      "```md\n## Shell & config\n\nEmbedded document.\n```\n\n" +
      "Filler paragraph.\n\n".repeat(60) +
      "## Shell & config\n\nDestination.\n\n" +
      "Following paragraph.\n\n".repeat(30);
    const { read, write } = await openFile(page, "/anchors.md", source);
    if (readOnly) {
      await write(`${source}\nAppendix.\n`);
      await expect(page.locator(".prose p", { hasText: "Appendix." })).toHaveCount(1);
      await page.getByRole("button", { name: "History" }).click();
      await page.getByRole("list", { name: "Revisions" }).getByRole("button").nth(1).click();
      await expect(page.locator(".prose [data-block-start]")).toHaveCount(0);
    }
    const before = await read();
    // A heading in another chat/document must not steal this file's fragment link.
    await page.evaluate(() => {
      const decoy = document.createElement("h2");
      decoy.id = "shell--config";
      decoy.textContent = "Other document";
      document.body.prepend(decoy);
    });
    const target = page.locator(".prose > h2");
    await expect(target).not.toBeInViewport();
    await page.getByRole("link", { name: "Jump to details" }).click();
    await expect(target).toBeInViewport();
    const gap = () =>
      target.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          element.closest("[data-markdown-document]")!.parentElement!.getBoundingClientRect().top,
      );
    await expect.poll(async () => Math.abs(await gap())).toBeLessThan(2);
    await expect(page.getByRole("button", { name: "History" })).toBeInViewport();
    await expect(page.getByRole("textbox", { name: "Block source" })).toHaveCount(0);
    await expect(saveButton(page)).toBeHidden();
    expect(await read()).toBe(before);
  });
}

test("switching views keeps the draft", async ({ page }) => {
  await openFile(page, "/notes.md", NOTES);
  await page.locator(".prose h1").click();
  const block = page.getByRole("textbox", { name: "Block source" });
  await block.evaluate(caretAtEnd);
  await block.pressSequentially("s");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveValue(NOTES.replace("Title", "Titles"));
  await expect(saveButton(page)).toBeVisible();
});

test("a cleared block is removed with its blank lines", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", "Keep\n\nDrop me\n\nKeep too\n");
  await page.locator(".prose p", { hasText: "Drop me" }).click();
  const block = page.getByRole("textbox", { name: "Block source" });
  await block.press("ControlOrMeta+a");
  await block.press("Backspace");
  await block.press("Escape");
  await saveButton(page).click();
  await expect.poll(read).toBe("Keep\n\nKeep too\n");
});

test("the code view formats from the selection menu and saves with the shortcut", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", NOTES);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue(NOTES);

  await source.evaluate((textarea: HTMLTextAreaElement) => {
    const start = textarea.value.indexOf("Title");
    textarea.focus();
    textarea.setSelectionRange(start, start + "Title".length);
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Italic (⌘I)" }).click();
  await expect(source).toHaveValue(NOTES.replace("Title", "_Title_"));

  // The toggle went through the textarea's own history.
  await source.press("ControlOrMeta+z");
  await expect(source).toHaveValue(NOTES);
  await source.press("ControlOrMeta+y");
  await source.press("ControlOrMeta+Shift+z");
  await expect(source).toHaveValue(NOTES.replace("Title", "_Title_"));
  await source.press("ControlOrMeta+s");
  await expect.poll(read).toBe(NOTES.replace("Title", "_Title_"));
});

test("asking about a selection saves first and cites the file's lines", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", NOTES);
  await page.locator(".prose li", { hasText: "two" }).click();
  const block = page.getByRole("textbox", { name: "Block source" });
  await block.evaluate(caretAtEnd);
  await block.pressSequentially("!");
  await block.evaluate((textarea: HTMLTextAreaElement) => {
    const start = textarea.value.indexOf("two");
    textarea.setSelectionRange(start, start + 3);
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Ask AI about selection" }).click();
  const input = page.getByRole("textbox", { name: "Edit instruction" });
  await input.fill("Spell it out");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().messages)).toBe(2);
  const message = await page.evaluate(() => window.artifactsE2E.lastUserMessage());
  expect(message?.[1]).toMatchObject({
    type: "text",
    metadata: { artifactSelection: { path: "/notes.md", text: "two", startLine: 8, endLine: 8 } },
  });
  await expect.poll(read).toBe(NOTES.replace("two", "two!"));
});

test("an outside change replaces clean text and waits behind a draft", async ({ page }) => {
  const { write } = await openFile(page, "/notes.md", NOTES);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue(NOTES);
  await write("# Rewritten\n");
  await expect(source).toHaveValue("# Rewritten\n");

  await source.evaluate(caretAtEnd);
  await source.pressSequentially("Mine");
  await write("# Theirs\n");
  await expect(page.getByText("The file changed while you were editing")).toBeVisible();
  await expect(source).toHaveValue("# Rewritten\nMine");
  await expect(saveButton(page)).toBeVisible();
  await cancelButton(page).click();
  await expect(source).toHaveValue("# Theirs\n");
});

test("enter continues lists and tab nests them", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", "- [x] ship\n");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.evaluate((textarea: HTMLTextAreaElement) => {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length - 1, textarea.value.length - 1);
  });
  await source.press("Enter");
  await source.pressSequentially("test");
  await source.press("Tab");
  await source.press("Enter");
  await source.press("Enter");
  await expect(source).toHaveValue("- [x] ship\n  - [ ] test\n- [ ] \n");
  await saveButton(page).click();
  await expect.poll(read).toBe("- [x] ship\n  - [ ] test\n- [ ] \n");
});

test("task boxes toggle the source", async ({ page }) => {
  const { read } = await openFile(page, "/notes.md", "Plan\n\n- [ ] draft\n- [x] review\n");
  await page.locator(".prose input[type='checkbox']").first().click();
  await expect(page.locator(".prose input[type='checkbox']").first()).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Block source" })).toBeHidden();
  await saveButton(page).click();
  await expect.poll(read).toBe("Plan\n\n- [x] draft\n- [x] review\n");
});

const SAMPLE = [
  "# Sample Document",
  "",
  "A short sample showing common Markdown elements.",
  "",
  "## Overview",
  "",
  "This file demonstrates **bold**, *italic*, `inline code`, and [links](https://example.com).",
  "",
  "## Lists",
  "",
  "- First item",
  "- Second item",
  "  - Nested item",
  "- Third item",
  "",
  "1. Step one",
  "2. Step two",
  "",
  "## Code",
  "",
  "```python",
  "def greet(name: str) -> str:",
  '    return f"Hello, {name}!"',
  "```",
  "",
].join("\n");

/** Tops of the rendered text elements, relative to the first one. */
const textTops = (page: Page) =>
  page.locator(".prose").evaluate((prose) => {
    const tops = Array.from(prose.querySelectorAll("h1, h2, p, li, pre")).map(
      (element) => element.getBoundingClientRect().top,
    );
    return tops.map((top) => Math.round(top - tops[0]));
  });

test("the editable preview lays blocks out like the read-only one", async ({ page }) => {
  const { write } = await openFile(page, "/notes.md", SAMPLE);
  await expect(page.locator(".prose h2", { hasText: "Code" })).toBeVisible();
  await write(`${SAMPLE}\nAppendix.\n`);
  await expect(page.locator(".prose p", { hasText: "Appendix" })).toBeVisible();
  await expect(page.locator(".prose [data-block-start]").first()).toBeAttached();
  const editable = await textTops(page);

  // An archived revision is shown read-only, rendered as one document.
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("list", { name: "Revisions" }).getByRole("button").nth(1).click();
  await expect(page.locator(".prose p", { hasText: "Appendix" })).toHaveCount(0);
  await expect(page.locator(".prose [data-block-start]")).toHaveCount(0);
  const readOnly = await textTops(page);
  expect(editable.slice(0, readOnly.length)).toEqual(readOnly);
});

test("editing a heading keeps its size and the blocks below in place", async ({ page }) => {
  await openFile(page, "/notes.md", SAMPLE);
  const below = page.locator(".prose h2", { hasText: "Lists" });
  await expect(below).toBeVisible();
  const before = (await below.boundingBox())!.y;
  await page.locator(".prose h2", { hasText: "Overview" }).click();
  const block = page.getByRole("textbox", { name: "Block source" });
  await expect(block).toHaveValue("## Overview");
  expect((await below.boundingBox())!.y).toBeCloseTo(before, 0);
  const size = await block.evaluate((textarea) => getComputedStyle(textarea).fontSize);
  expect(size).toBe(await below.evaluate((heading) => getComputedStyle(heading).fontSize));
});

test("text files are edited in place", async ({ page }) => {
  const { read } = await openFile(page, "/notes.txt", "Shopping\n");
  const text = page.getByRole("textbox", { name: "Text" });
  await expect(text).toHaveValue("Shopping\n");
  await text.evaluate(caretAtEnd);
  await text.press("Tab");
  await text.pressSequentially("milk");
  await text.press("Enter");
  await text.pressSequentially("eggs");
  await text.press("ControlOrMeta+s");
  await expect.poll(read).toBe("Shopping\n\tmilk\n\teggs");
});

test("long source lines scroll horizontally and keep the editor mirror aligned", async ({ page }) => {
  const code = `const message = "${"long source line ".repeat(30)}";\n`;
  const { read } = await openFile(page, "/wide.ts", code);
  const source = page.getByRole("textbox", { name: "Source" });
  const mirror = page.locator("pre[aria-hidden].syntax-highlight");
  await expect(source).toHaveValue(code);
  await expect(source).toHaveAttribute("wrap", "off");
  await expect(mirror).toHaveCSS("white-space", "pre");
  await expect(mirror.locator(".th-keyword")).toHaveText("const");
  const bounds = await mirror.evaluate((pre) => {
    const textarea = pre.parentElement!.querySelector("textarea")!;
    const scroller = pre.parentElement!.parentElement!;
    scroller.scrollLeft = 300;
    return {
      mirrorWidth: pre.getBoundingClientRect().width,
      editorWidth: textarea.getBoundingClientRect().width,
      height: pre.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(pre).lineHeight),
      viewport: scroller.clientWidth,
      scrollLeft: scroller.scrollLeft,
    };
  });
  expect(bounds.mirrorWidth).toBeGreaterThan(bounds.viewport);
  expect(bounds.editorWidth).toBe(bounds.mirrorWidth);
  expect(bounds.scrollLeft).toBe(300);
  expect(bounds.height).toBe(32 + 2 * bounds.lineHeight);
  await source.evaluate(caretAtEnd);
  await source.pressSequentially("// edited");
  await expect(mirror).toHaveJSProperty("textContent", code + "// edited");
  await saveButton(page).click();
  await expect.poll(read).toBe(code + "// edited");
});

test("source files keep and open indentation", async ({ page }) => {
  const { read } = await openFile(page, "/app.ts", "function main() {}\n");
  const source = page.getByRole("textbox", { name: "Source" });
  await expect(source).toHaveValue("function main() {}\n");
  const mirror = page.locator("pre[aria-hidden].syntax-highlight");
  await expect(mirror.locator(".th-keyword")).toHaveText("function");
  await source.evaluate((textarea: HTMLTextAreaElement) => {
    textarea.focus();
    textarea.setSelectionRange(17, 17);
  });
  await source.press("Enter");
  await source.pressSequentially("return 1;");
  await expect(source).toHaveValue("function main() {\n  return 1;\n}\n");
  await expect(mirror).toHaveJSProperty("textContent", "function main() {\n  return 1;\n}\n ");
  await expect(mirror.locator(".th-number")).toHaveText("1");

  // Shift+Tab outdents the line; the edit is one undo step.
  await source.press("Shift+Tab");
  await expect(source).toHaveValue("function main() {\nreturn 1;\n}\n");
  await source.press("ControlOrMeta+z");
  await expect(source).toHaveValue("function main() {\n  return 1;\n}\n");
  await saveButton(page).click();
  await expect.poll(read).toBe("function main() {\n  return 1;\n}\n");
});

test("editing a fenced code block preserves long lines", async ({ page }) => {
  const code = `const message = "${"long source line ".repeat(30)}";`;
  await openFile(page, "/wide.md", "```ts\n" + code + "\n```\n");
  await expect(page.locator("pre code")).toHaveText(code);
  await page.locator("pre .th-keyword").click();
  const source = page.getByRole("textbox", { name: "Block source" });
  await expect(source).toHaveValue("```ts\n" + code + "\n```");
  await expect(source).toHaveAttribute("wrap", "off");
  await expect(page.locator("pre[aria-hidden]")).toHaveCSS("white-space", "pre");
  await source.press("Escape");
  await expect(page.locator("pre code")).toHaveText(code);
  await expect(saveButton(page)).toBeHidden();
});

test("running a script runs the text on screen without saving it", async ({ page }) => {
  const { read } = await openFile(page, "/hello.js", "console.log('before');\n");
  const source = page.getByRole("textbox", { name: "Script source" });
  await expect(source).toHaveValue("console.log('before');\n");
  await source.fill("console.log('after');\n");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("after", { exact: true })).toBeVisible();
  expect(await read()).toBe("console.log('before');\n");
  await saveButton(page).click();
  await expect.poll(read).toBe("console.log('after');\n");
});

test("the html code view edits the page and the preview shows the draft", async ({ page }) => {
  const { read } = await openFile(page, "/page.html", "<h1>Old</h1>\n");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const source = page.getByRole("textbox", { name: "HTML source" });
  await expect(source).toHaveValue("<h1>Old</h1>\n");
  await source.fill("<h1>New</h1>\n");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.frameLocator("iframe").locator("h1")).toHaveText("New");
  await saveButton(page).click();
  await expect.poll(read).toBe("<h1>New</h1>\n");
});

test("unsaved edits stay as a draft when another file opens", async ({ page }) => {
  const { read } = await openFile(page, "/draft.txt", "first\n");
  const id = await page.evaluate(() => window.artifactsE2E.state().fsChatId!);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/other.txt", "other\n"), id);
  await page.evaluate(() => window.artifactsE2E.openFile("/draft.txt"));
  const text = page.getByRole("textbox", { name: "Text" });
  await expect(text).toHaveValue("first\n");
  await text.evaluate(caretAtEnd);
  await text.pressSequentially("edited");

  await page.evaluate(() => window.artifactsE2E.openFile("/other.txt"));
  await expect(text).toHaveValue("other\n");
  expect(await read()).toBe("first\n");
  await expect(saveButton(page)).toBeHidden();
  await page.getByRole("button", { name: "Show file list" }).click();
  // The dot is part of the row's name: "draft.txt Unsaved changes".
  const row = page.getByRole("button", { name: /^draft\.txt/ });
  await expect(row.getByRole("img", { name: "Unsaved changes" })).toBeVisible();

  await row.click();
  await expect(text).toHaveValue("first\nedited");
  await saveButton(page).click();
  await expect.poll(read).toBe("first\nedited");
  await expect(row.getByRole("img", { name: "Unsaved changes" })).toBeHidden();
});

test("a deleted file's draft goes with it", async ({ page }) => {
  await openFile(page, "/gone.txt", "text\n");
  const id = await page.evaluate(() => window.artifactsE2E.state().fsChatId!);
  const text = page.getByRole("textbox", { name: "Text" });
  await text.evaluate(caretAtEnd);
  await text.pressSequentially("draft");
  await page.evaluate((id) => window.artifactsE2E.remove(id, "/gone.txt"), id);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/gone.txt", "recreated\n"), id);
  await page.evaluate(() => window.artifactsE2E.openFile("/gone.txt"));
  await expect(text).toHaveValue("recreated\n");
  await expect(saveButton(page)).toBeHidden();
});

test("reopening a file with a draft does not report a conflict", async ({ page }) => {
  await openFile(page, "/again.md", "# Again\n");
  const id = await page.evaluate(() => window.artifactsE2E.state().fsChatId!);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/other.md", "# Other\n"), id);
  await page.evaluate(() => window.artifactsE2E.openFile("/again.md"));
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.evaluate(caretAtEnd);
  await source.pressSequentially("More\n");
  await page.evaluate(() => window.artifactsE2E.openFile("/other.md"));
  await expect(source).toHaveValue("# Other\n");
  await page.evaluate(() => window.artifactsE2E.openFile("/again.md"));
  await expect(source).toHaveValue("# Again\nMore\n");
  await expect(saveButton(page)).toBeVisible();
  await page.waitForTimeout(500);
  // A one-off count: a retrying assertion would just wait for the toast to fade.
  expect(await page.getByText("The file changed while you were editing").count()).toBe(0);
});
