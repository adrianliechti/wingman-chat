import { expect, test } from "@playwright/test";

test("mixed-catalog gallery renders and responds to edits", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/tests/browser/fixtures/inline-ui-gallery.html");
  await expect(page.locator('svg[role="img"]')).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Event name")).toHaveValue("Room for good ideas");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-11-04");
  await page.getByLabel("Event name").fill("Make space for tomorrow");
  await expect(page.getByRole("heading", { name: "Make space for tomorrow" })).toBeVisible();
  await page.getByRole("button", { name: "Share this plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Shared: Make space for tomorrow");
  await page.getByRole("radio", { name: "This quarter", exact: true }).click();
  await expect(page.getByRole("radio", { name: "This quarter", exact: true })).toBeChecked();
  await page.getByRole("tab", { name: "Launch activity" }).click();
  await expect(page.getByText("Private beta", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);

  if (process.env.UPDATE_INLINE_UI_GALLERY === "1") {
    await page.reload();
    await expect(page.locator('svg[role="img"]')).toHaveCount(1);
    await expect(page.getByLabel("Event name")).toHaveValue("Room for good ideas");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: "docs/assets/inline-ui-examples.png", fullPage: true, animations: "disabled" });
  }
});
