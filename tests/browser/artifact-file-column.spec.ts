import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { artifacts: {}, models: [] } }));
  await page.goto("/tests/browser/fixtures/artifacts.html");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  return id;
}

test("the file column on a wide drawer can be hidden, is remembered, and hands over to the navigator", async ({
  page,
}) => {
  const id = await openFixture(page);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/one.txt", "First"), id);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/two.txt", "Second"), id);
  // The first file stays open; the second write only adds to the list.
  await expect(page.locator("pre")).toHaveText("First");

  // Wide drawer: file column visible, no breadcrumb popover.
  await expect(page.getByText("Files", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Browse files")).toHaveCount(0);

  await page.getByRole("button", { name: "Hide file list" }).click();
  await expect(page.getByText("Files", { exact: true })).toHaveCount(0);
  await page.getByTitle("Browse files").click();
  await page.getByRole("button", { name: "two.txt", exact: true }).click();
  await expect(page.locator("pre")).toHaveText("Second");

  // The choice survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
  await page.evaluate((id) => window.artifactsE2E.selectChat(id), id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("pre")).toBeVisible();
  await expect(page.getByText("Files", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show file list" }).click();
  await expect(page.getByText("Files", { exact: true })).toBeVisible();
});
