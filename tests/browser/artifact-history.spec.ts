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

test("history lists revisions, previews them on hover, compares, and restores an earlier one", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.txt", "v1"), id);
  await expect(page.locator("pre")).toHaveText("v1");
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.txt", "v2"), id);
  await expect(page.locator("pre")).toHaveText("v2");

  await page.getByRole("button", { name: "History" }).click();
  const list = page.getByRole("list", { name: "Revisions" });
  const rows = list.getByRole("button");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Current");

  // Hovering an older revision previews it; leaving the list returns to the live file.
  await rows.nth(1).hover();
  await expect(page.locator("pre")).toHaveText("v1");
  await page.mouse.move(0, 0);
  await expect(page.locator("pre")).toHaveText("v2");

  // Clicking pins it with a banner, a diff against the live file, and restore.
  await rows.nth(1).click();
  await expect(list).toBeHidden();
  const banner = page.getByRole("status");
  await expect(banner).toContainText("Viewing revision");
  await expect(page.locator("pre")).toHaveText("v1");
  await expect(page.getByRole("button", { name: "Run" })).toHaveCount(0);

  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.locator("pre")).toContainText("v1");
  await expect(page.locator("pre")).toContainText("v2");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.locator("pre")).toHaveText("v1");

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator("pre")).toHaveText("v1");
  await expect
    .poll(() => page.evaluate((id) => window.artifactsE2E.read(id, "/notes.txt").then((file) => file?.content), id))
    .toBe("v1");

  await page.getByRole("button", { name: "History" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Current");
  await expect(rows.first()).toContainText("Restored");
});

test("closing the banner returns to the live file without changing it", async ({ page }) => {
  await openFixture(page);
  const id = await ensureChat(page);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.txt", "first"), id);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.txt", "second"), id);
  await expect(page.locator("pre")).toHaveText("second");

  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("list", { name: "Revisions" }).getByRole("button").nth(1).click();
  await expect(page.locator("pre")).toHaveText("first");
  await page.getByRole("button", { name: "Back to current version" }).click();
  await expect(page.getByRole("status")).toBeHidden();
  await expect(page.locator("pre")).toHaveText("second");
  expect(await page.evaluate((id) => window.artifactsE2E.read(id, "/notes.txt").then((file) => file?.content), id)).toBe(
    "second",
  );
});
