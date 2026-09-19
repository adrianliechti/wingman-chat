import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { artifacts: {}, models: [] } }));
  await page.goto("/tests/browser/fixtures/artifacts.html");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
}

async function ensureChat(page: Page) {
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  return id;
}

/** Highlight an element's text the way a mouse drag would, then release. */
function selectContents(target: Element) {
  const doc = target.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(target);
  const selection = doc.defaultView!.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  doc.dispatchEvent(new doc.defaultView!.MouseEvent("mouseup", { bubbles: true }));
}

async function sendInstruction(page: Page, instruction: string) {
  const pill = page.getByRole("button", { name: "Edit selection" });
  await expect(pill).toBeVisible();
  await pill.click();
  const input = page.getByRole("textbox", { name: "Edit instruction" });
  await input.fill(instruction);
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().messages)).toBe(2);
  await expect(pill).toBeHidden();
  return page.evaluate(() => window.artifactsE2E.lastUserMessage());
}

test("editing a highlighted markdown passage sends the instruction with the quoted text and its line", async ({
  page,
}) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.md", "# Title\n\nQuarterly revenue grew.\n"), id);
  await expect(page.locator(".prose p")).toHaveText("Quarterly revenue grew.");

  await page.locator(".prose p").evaluate(selectContents);
  const message = await sendInstruction(page, "Make it shorter");

  expect(message).toEqual([
    { type: "text", text: "Make it shorter" },
    { type: "artifact_selection", path: "/notes.md", text: "Quarterly revenue grew.", startLine: 3, endLine: 3 },
  ]);
  await expect(page.getByText("Selected in", { exact: false })).toHaveCount(0); // fixture renders no chat list
});

test("a code selection reports the highlighted lines even when the text repeats", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/script.py", "x = 1\nprint(x)\nprint(x)\n"), id);
  const line = page.locator("code > span.line").nth(1);
  await expect(line).toHaveText("print(x)");

  await line.evaluate(selectContents);
  const message = await sendInstruction(page, "Log it instead");

  expect(message?.[1]).toMatchObject({ type: "artifact_selection", path: "/script.py", text: "print(x)", startLine: 2, endLine: 2 });
});

test("a selection inside the html preview offers the same control", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate(
    (id) =>
      window.artifactsE2E.write(
        id,
        "/index.html",
        '<!doctype html>\n<html><body>\n<p id="target">Hello preview</p>\n</body></html>\n',
      ),
    id,
  );
  const target = page.frameLocator("iframe").locator("#target");
  await expect(target).toHaveText("Hello preview");

  await target.evaluate(selectContents);
  const message = await sendInstruction(page, "Make it a heading");

  expect(message?.[1]).toMatchObject({ type: "artifact_selection", path: "/index.html", text: "Hello preview", startLine: 3, endLine: 3 });
});

test("escape closes the control without sending", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/plain.txt", "Some plain text"), id);
  await expect(page.locator("pre")).toHaveText("Some plain text");

  await page.locator("pre").evaluate(selectContents);
  const pill = page.getByRole("button", { name: "Edit selection" });
  await expect(pill).toBeVisible();
  await pill.click();
  await page.getByRole("textbox", { name: "Edit instruction" }).press("Escape");
  await expect(pill).toBeHidden();
  expect(await page.evaluate(() => window.artifactsE2E.state().messages)).toBe(0);
});

test("a press outside the control closes it, in the page and inside the preview frame", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.md", "# Title\n\nQuarterly revenue grew.\n"), id);
  await expect(page.locator(".prose p")).toHaveText("Quarterly revenue grew.");

  const pill = page.getByRole("button", { name: "Edit selection" });
  const input = page.getByRole("textbox", { name: "Edit instruction" });

  // Page: press on the drawer chrome while the input is open.
  await page.locator(".prose p").evaluate(selectContents);
  await pill.click();
  await expect(input).toBeVisible();
  await page.getByRole("button", { name: "History" }).dispatchEvent("pointerdown");
  await expect(input).toBeHidden();
  await expect(pill).toBeHidden();

  // Preview frame: a press inside the iframe never reaches the page.
  await page.evaluate(
    (id) => window.artifactsE2E.write(id, "/index.html", '<!doctype html>\n<html><body><p id="target">Hello preview</p><div id="space" style="height:400px"></div></body></html>\n'),
    id,
  );
  await page.evaluate(() => window.artifactsE2E.openFile("/index.html"));
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#target")).toHaveText("Hello preview");
  await frame.locator("#target").evaluate(selectContents);
  await pill.click();
  await expect(input).toBeVisible();
  await frame.locator("#space").dispatchEvent("pointerdown");
  await expect(input).toBeHidden();
  await expect(pill).toBeHidden();
  expect(await page.evaluate(() => window.artifactsE2E.state().messages)).toBe(0);
});
