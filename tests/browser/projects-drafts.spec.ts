import { test, expect, type Page } from "@playwright/test";

test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

const composer = (page: Page) => page.getByRole("textbox", { name: "Chat message input" });
async function open(page: Page, query = "") {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], artifacts: {}, vision: {}, navigation: true } }),
  );
  await page.route("**/api/v1/models", (route) =>
    route.fulfill({ json: { data: [{ id: "fixture", name: "Fixture" }] } }),
  );
  await page.goto(`/tests/browser/fixtures/react-ui.html${query}`);
  await expect(composer(page)).toBeEnabled();
}
async function sidebar(page: Page) {
  const picker = page.getByRole("button", { name: "Choose project" });
  if (!(await picker.evaluate((el) => el.getBoundingClientRect().x >= 0)))
    await page.getByRole("button", { name: "Open sidebar", exact: true }).first().click();
  await expect(picker).toBeInViewport();
}
async function choose(page: Page, name: string) {
  await sidebar(page);
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText(name);
  await expect(composer(page)).toBeEnabled();
}
async function newProject(page: Page) {
  await sidebar(page);
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name: "New project", exact: true }).click();
  return page.getByRole("region", { name: "New project", exact: true });
}
async function openSettings(page: Page) {
  await sidebar(page);
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name: "Project settings", exact: true }).click();
  return page.getByRole("region", { name: "Project settings", exact: true });
}
/** Entry names in an OPFS folder, or null when the folder does not exist. */
const opfsList = (page: Page, path: string) =>
  page.evaluate(async (path) => {
    let folder = await navigator.storage.getDirectory();
    try {
      for (const part of path.split("/")) folder = await folder.getDirectoryHandle(part);
    } catch {
      return null;
    }
    const names: string[] = [];
    for await (const entry of folder.values()) names.push(entry.name);
    return names;
  }, path);
async function project(page: Page, name: string, instructions: string) {
  await newProject(page);
  const dialog = page.getByRole("region", { name: "New project", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Instructions", exact: true }).fill(instructions);
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Project settings", exact: true })).toBeHidden();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText(name);
}

test("project creation, edits and file changes respect Save and Close", async ({ page }) => {
  await open(page);
  let editor = await newProject(page);
  await expect(editor.getByRole("button", { name: "Create project", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Close project", exact: true }).click();
  await expect(editor).toBeHidden();
  editor = await newProject(page);
  await editor.getByLabel("Name", { exact: true }).fill("Atlas");
  await editor.getByLabel("Description", { exact: true }).fill("A shared workspace");
  await editor.getByRole("textbox", { name: "Instructions", exact: true }).fill("Original instructions");
  await editor.getByLabel("Add project files").setInputFiles([
    { name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from("Keep these bytes") },
    { name: "discard.txt", mimeType: "text/plain", buffer: Buffer.from("Discard these bytes") },
  ]);
  await editor.getByRole("button", { name: "Remove discard.txt", exact: true }).click();
  await editor.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText("Atlas");

  editor = await openSettings(page);
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("A shared workspace");
  await expect(editor.getByText("keep.txt", { exact: true })).toBeVisible();
  await expect(editor.getByText("discard.txt", { exact: true })).toHaveCount(0);
  await editor.getByLabel("Name", { exact: true }).fill("   ");
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await editor.getByLabel("Name", { exact: true }).fill("Unsaved name");
  await editor.getByRole("textbox", { name: "Instructions", exact: true }).fill("Unsaved instructions");
  await editor.getByRole("button", { name: "Remove keep.txt", exact: true }).click();
  await editor
    .getByLabel("Add project files")
    .setInputFiles({ name: "unsaved.txt", mimeType: "text/plain", buffer: Buffer.from("Unsaved file") });
  await editor.getByRole("button", { name: "Close project", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await discard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unsaved name");
  await editor.getByRole("button", { name: "Close project", exact: true }).click();
  await discard.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(editor).toBeHidden();

  editor = await openSettings(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Atlas");
  await expect(editor.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue("Original instructions");
  await expect(editor.getByText("keep.txt", { exact: true })).toBeVisible();
  await expect(editor.getByText("unsaved.txt", { exact: true })).toHaveCount(0);
  await editor.getByLabel("Name", { exact: true }).fill("  Atlas revised  ");
  await editor.getByRole("textbox", { name: "Instructions", exact: true }).fill("Revised instructions");
  await editor.getByRole("button", { name: "Remove keep.txt", exact: true }).click();
  await editor
    .getByLabel("Add project files")
    .setInputFiles({ name: "revised.txt", mimeType: "text/plain", buffer: Buffer.from("Revised file") });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText("Atlas revised");
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  editor = await openSettings(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Atlas revised");
  await expect(editor.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue("Revised instructions");
  await expect(editor.getByText("keep.txt", { exact: true })).toHaveCount(0);
  await expect(editor.getByText("revised.txt", { exact: true })).toBeVisible();
  const atlasId = await page.evaluate(() => localStorage.getItem("app_project"));
  expect(atlasId).toBeTruthy();
  // Removing keep.txt also removed its bytes; only revised.txt is stored.
  expect(await opfsList(page, `projects/${atlasId}/files`)).toHaveLength(1);
});

test("a failed project save stays open and retries creation without duplicating the project", async ({ page }) => {
  await open(page);
  const editor = await newProject(page);
  await editor.getByLabel("Name", { exact: true }).fill("Retry project");
  await editor.getByRole("textbox", { name: "Instructions", exact: true }).fill("Keep these instructions");
  await editor
    .getByLabel("Add project files")
    .setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("Keep this file") });
  await page.evaluate(() => {
    // Restored on the prototype and invoked with its original receiver below.
    // oxlint-disable-next-line typescript/unbound-method
    const original = FileSystemFileHandle.prototype.createWritable;
    let writes = 0;
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (this.name === "project.json" && ++writes === 2) {
        FileSystemFileHandle.prototype.createWritable = original;
        return Promise.reject(new DOMException("Simulated project save failure", "QuotaExceededError"));
      }
      return original.apply(this, args);
    };
  });
  await editor.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Some changes could not be saved");
  await expect(editor.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
    "Keep these instructions",
  );
  await expect(editor.getByText("retry.txt", { exact: true })).toBeVisible();
  // Let the storage notification expire without hovering over the footer.
  await page.mouse.move(0, 0);
  await expect(page.getByText("Couldn't save changes", { exact: true })).toBeHidden();
  await editor.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("button", { name: "Choose project" }).click();
  await expect(page.getByRole("menuitem", { name: "Retry project", exact: true })).toHaveCount(1);
  await page.getByRole("menuitem", { name: "Project settings", exact: true }).click();
  const saved = page.getByRole("region", { name: "Project settings", exact: true });
  await expect(saved.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
    "Keep these instructions",
  );
  await expect(saved.getByText("retry.txt", { exact: true })).toBeVisible();
});

test("projects apply shared context, retain draft attachments, and switch to All chats on the first click", async ({
  page,
}) => {
  await open(page);
  await project(page, "Atlas", "Always use the Atlas reporting format.");
  await openSettings(page);
  const settings = page.getByRole("region", { name: "Project settings", exact: true });
  await settings
    .getByLabel("Add project files")
    .setInputFiles({ name: "facts.txt", mimeType: "text/plain", buffer: Buffer.from("Atlas revenue is 42.") });
  await expect(settings.getByText("facts.txt", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name: "Project settings", exact: true }).click();
  await expect(settings).toBeVisible();
  await expect(page.getByRole("menu")).toBeHidden();
  const navigation = (await page.getByRole("navigation").boundingBox())!;
  expect((await settings.getByRole("heading", { name: "Project settings" }).boundingBox())!.y).toBeGreaterThan(
    navigation.y + navigation.height,
  );
  await expect(settings.getByText(/Recent chats/)).toHaveCount(0);
  await page.screenshot({ path: "/private/tmp/wingman-project-settings.png" });
  await settings.getByRole("button", { name: "Close project" }).click();
  await composer(page).fill("Atlas unsent draft");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("An unsent attachment") });
  await expect(page.getByTitle("draft.txt", { exact: true })).toBeVisible();
  await choose(page, "All chats");
  await expect(composer(page)).toHaveValue("");
  await composer(page).fill("General unsent draft");
  await choose(page, "Atlas");
  await expect(composer(page)).toHaveValue("Atlas unsent draft");
  await expect(page.getByTitle("draft.txt", { exact: true })).toBeVisible();
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await expect(composer(page)).toHaveValue("");
  const state = await page.evaluate(() => window.reactUiE2E.state());
  expect(state.instructions).toContain("Always use the Atlas reporting format.");
  expect(state.instructions).toContain("facts.txt");
  expect(state.tools).toContain("project_read");
  await page.evaluate(() => window.reactUiE2E.callTool("project_read", { path: "/facts.txt" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(JSON.stringify(await page.evaluate(() => window.reactUiE2E.state().input))).toContain("Atlas revenue is 42");
  await page.evaluate(() => window.reactUiE2E.finish("Atlas report ready."));
  await expect(page.getByText("Atlas report ready.", { exact: true })).toBeVisible();
  await page.getByText("Atlas unsent draft", { exact: true }).hover();
  await page.getByRole("button", { name: "Restore to composer" }).click();
  await expect(composer(page)).toHaveValue("Atlas unsent draft");
  await expect(page.locator("footer").getByTitle("draft.txt", { exact: true })).toBeVisible();
  await composer(page).fill("Draft in the saved chat");
  const savedUrl = page.url();
  await choose(page, "All chats");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(composer(page)).toHaveValue("General unsent draft");
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  await expect(composer(page)).toHaveValue("General unsent draft");
  await sidebar(page);
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText("All chats");
  await page.goto(savedUrl);
  await expect(composer(page)).toHaveValue("Draft in the saved chat");
  await sidebar(page);
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText("Atlas");
});

test("drafts survive reload with original image and file bytes", async ({ page }) => {
  await open(page);
  await composer(page).fill("Keep these attachments");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: "small.png", mimeType: "image/png", buffer: png },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Draft attachment bytes") },
    ]);
  await expect(page.getByTitle("notes.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  await expect(composer(page)).toHaveValue("Keep these attachments");
  await expect(page.getByTitle("notes.txt", { exact: true })).toBeVisible();
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await (
      await (await root.getDirectoryHandle("drafts")).getDirectoryHandle("new-chat")
    ).getDirectoryHandle("files");
    const result: { size: number; text: string }[] = [];
    for await (const entry of folder.values())
      if (entry.kind === "file") {
        const file = await (entry as FileSystemFileHandle).getFile();
        result.push({ size: file.size, text: await file.text() });
      }
    return result;
  });
  expect(files.some((file) => file.text === "Draft attachment bytes")).toBe(true);
  expect(files.some((file) => file.size === png.byteLength)).toBe(true);
});

test("moving and deleting projects preserves conversations and changes their context", async ({ page }) => {
  await open(page);
  await project(page, "Nova", "Nova-only instructions.");
  await composer(page).fill("A conversation to move");
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.finish("A saved answer."));
  await expect(page.getByText("A saved answer.", { exact: true })).toBeVisible();
  await project(page, "Orion", "Orion-only instructions.");
  await choose(page, "Nova");
  await page.getByRole("button", { name: /^Chat options for/ }).click();
  await page.getByRole("menuitem", { name: "Move to project" }).click();
  await page.getByLabel("Destination project").selectOption({ label: "Orion" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Chat options for/ })).toHaveCount(0);
  await choose(page, "Orion");
  await page.getByRole("complementary").getByRole("button", { name: "Fixture", exact: true }).click();
  await expect(page.getByText("A saved answer.", { exact: true })).toBeVisible();
  await composer(page).fill("Use the updated project");
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  const state = await page.evaluate(() => window.reactUiE2E.state());
  expect(state.instructions).toContain("Orion-only instructions.");
  expect(state.instructions).not.toContain("Nova-only instructions.");
  await page.evaluate(() => window.reactUiE2E.finish("Moved successfully."));
  await expect(page.getByText("Moved successfully.", { exact: true })).toBeVisible();
  const orionId = await page.evaluate(() => localStorage.getItem("app_project"));
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await composer(page).fill("An unsent Orion draft");
  await expect.poll(() => opfsList(page, `drafts/new-${orionId}`)).toContain("draft.json");
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name: "Project settings" }).click();
  await page.getByRole("button", { name: "Delete project", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Orion?" }).getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByRole("button", { name: "Choose project" })).toHaveText("All chats");
  await expect.poll(() => opfsList(page, `drafts/new-${orionId}`)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("app_project"))).toBeNull();
  await page.getByRole("complementary").getByRole("button", { name: "Fixture", exact: true }).click();
  await expect(page.getByText("Moved successfully.", { exact: true })).toBeVisible();
});

test("project settings fit mobile and accept dropped files", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await project(page, "A project with a long name for a small screen", "Mobile context");
  await openSettings(page);
  const settings = page.getByRole("region", { name: "Project settings", exact: true });
  const heading = settings.getByRole("heading", { name: "Project settings" });
  const navigation = (await page.getByRole("navigation").boundingBox())!;
  expect((await heading.boundingBox())!.y).toBeGreaterThan(navigation.y + navigation.height);
  expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const files = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["Dropped file bytes"], "dropped.txt", { type: "text/plain" }));
    return data;
  });
  await settings.getByRole("button", { name: "Upload project files" }).dispatchEvent("drop", { dataTransfer: files });
  await expect(settings.getByText("dropped.txt", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await sidebar(page);
  await expect
    .poll(async () => {
      const close = (await page.getByRole("button", { name: "Close sidebar", exact: true }).boundingBox())!;
      return close.x + close.width;
    })
    .toBeGreaterThan(370);
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name: "Project settings" }).click();
  await expect(settings.getByText("dropped.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose project" })).not.toBeInViewport();
  await settings.evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: "/private/tmp/wingman-project-settings-mobile.png" });
});

test("a generated artifact can be saved to the project and read in another chat", async ({ page }) => {
  await open(page);
  await project(page, "Reports", "Reuse shared reports.");
  await composer(page).fill("Create a report");
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() =>
    window.reactUiE2E.callTool("artifacts_create", { path: "/report.txt", content: "Generated report: 42" }),
  );
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  await page.evaluate(() => window.reactUiE2E.finish("Report ready."));
  await expect(page.getByText("Report ready.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open artifacts", exact: true }).click();
  await page.getByRole("button", { name: "Save to project", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reports", exact: true }).click();
  await expect(page.getByText("Saved to project", { exact: true })).toBeVisible();
  await sidebar(page);
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("menuitem", { name: "Project settings" }).click();
  const settings = page.getByRole("region", { name: "Project settings", exact: true });
  await expect(settings.getByText("report.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close sidebar overlay" })).toBeHidden();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await composer(page).fill("Read the shared report");
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(3);
  expect((await page.evaluate(() => window.reactUiE2E.state())).instructions).toContain("report.txt");
  await page.evaluate(() => window.reactUiE2E.callTool("project_read", { path: "/report.txt" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(4);
  expect(JSON.stringify(await page.evaluate(() => window.reactUiE2E.state().input))).toContain("Generated report: 42");
});

test("a failed chat save preserves the draft, skills and attachments for retry", async ({ page }) => {
  await open(page, "?composer");
  await composer(page).fill("/draft");
  await page.getByRole("option", { name: /draft-response/ }).click();
  await composer(page).fill("Keep my unsent message");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from("Keep these bytes") });
  await expect(page.getByTitle("keep.txt", { exact: true })).toBeVisible();
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.evaluate(() => {
    // Restored on the prototype and invoked with its original receiver below.
    // oxlint-disable-next-line typescript/unbound-method
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (this.name === "chat.json") {
        FileSystemFileHandle.prototype.createWritable = original;
        return Promise.reject(new DOMException("Simulated storage failure", "QuotaExceededError"));
      }
      return original.apply(this, args);
    };
  });
  await composer(page).press("Enter");
  await expect(page.getByText("Message failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove skill draft-response" })).toBeEnabled();
  await expect(composer(page)).toBeEnabled();
  await expect(composer(page)).toHaveValue("Keep my unsent message");
  await expect(page.getByTitle("keep.txt", { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.reactUiE2E.state())).calls).toBe(0);
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await expect(composer(page)).toHaveValue("");
  await expect(page.locator("footer").getByTitle("keep.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove skill draft-response" })).toHaveCount(0);
});

test("selected skills follow project drafts through switching, reload, sending and restore", async ({ page }) => {
  await open(page, "?composer");
  await project(page, "Skills project", "Project and skill instructions should both apply.");
  await composer(page).fill("/draft");
  await page.getByRole("option", { name: /draft-response/ }).click();
  const selection = page.getByRole("button", { name: "Remove skill draft-response" });
  await expect(selection).toBeVisible();
  await choose(page, "All chats");
  await expect(selection).toHaveCount(0);
  await choose(page, "Skills project");
  await expect(selection).toBeVisible();
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.goto("/tests/browser/fixtures/react-ui.html?composer");
  await expect(selection).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await expect(selection).toHaveCount(0);
  expect((await page.evaluate(() => window.reactUiE2E.state())).instructions).toContain(
    "Project and skill instructions should both apply.",
  );
  await page.evaluate(() => window.reactUiE2E.callTool("load_skill", { name: "draft-response" }));
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(JSON.stringify(await page.evaluate(() => window.reactUiE2E.state().input))).toContain(
    "Follow the customer response template.",
  );
  await page.evaluate(() => window.reactUiE2E.finish("Project skill ready"));
  await expect(page.getByText("Project skill ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore to composer" }).click();
  await expect(selection).toBeVisible();
  await expect(composer(page)).toHaveValue("");
});
