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

const header = (page: Page, name: string) => page.locator("th", { hasText: name });

test("parquet opens in a windowed grid sorted by DuckDB", async ({ page }) => {
  test.setTimeout(240_000);
  const id = await openFixture(page);
  await page.evaluate(
    (id) =>
      window.artifactsE2E.writeParquet(
        id,
        "/data/trips.parquet",
        "SELECT range AS id, range * 2 AS fare, 'city-' || (range % 3) AS city FROM range(2500)",
      ),
    id,
  );
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().activeFile)).toBe("/data/trips.parquet");
  await expect(header(page, "fare")).toHaveAttribute("title", /BIGINT/i, { timeout: 180_000 });
  await expect(page.locator("td").nth(2)).toHaveText("city-0");

  // Sorting is done by DuckDB: numeric, over the whole file.
  await header(page, "fare").getByRole("button").first().click();
  await header(page, "fare").getByRole("button").first().click();
  await expect(page.locator("td").nth(1)).toHaveText("4998");

  // Scrolling far down fetches a later window instead of loading everything.
  await header(page, "fare").getByRole("button").first().click();
  await page.locator("table").evaluate((table) => {
    table.parentElement!.scrollTop = 35 * 2400;
  });
  await expect(page.locator("td", { hasText: /^2400$/ })).toBeVisible();
});

test("csv is typed and sorted numerically through DuckDB", async ({ page }) => {
  test.setTimeout(240_000);
  const id = await openFixture(page);
  await page.evaluate(
    (id) => window.artifactsE2E.write(id, "/sales.csv", "region,amount\nnorth,9\nsouth,10\neast,100\n"),
    id,
  );
  await expect(header(page, "amount")).toHaveAttribute("title", /BIGINT/i, { timeout: 180_000 });
  await expect(page.locator("td").nth(1)).toHaveText("9");
  await header(page, "amount").getByRole("button").first().click();
  await expect(page.locator("td").nth(1)).toHaveText("9");
  await expect(page.locator("td").nth(3)).toHaveText("10");
  await expect(page.locator("td").nth(5)).toHaveText("100");
  // The preview/code toggle is gone for data files; there is no raw view to keep in memory.
  await expect(page.getByTitle("Code")).toHaveCount(0);
});

test("jsonl opens in the grid as well", async ({ page }) => {
  test.setTimeout(240_000);
  const id = await openFixture(page);
  await page.evaluate(
    (id) => window.artifactsE2E.write(id, "/events.jsonl", '{"user":"a","n":1}\n{"user":"b","n":2}\n'),
    id,
  );
  await expect(header(page, "user")).toBeVisible({ timeout: 180_000 });
  await expect(page.locator("td").nth(2)).toHaveText("b");
});

test("the open grid refreshes its schema and rows after a file update", async ({ page }) => {
  const id = await openFixture(page);
  await page.evaluate((id) => window.artifactsE2E.write(id, "/data.csv", "value\n1\n"), id);
  await expect(page.locator("td").first()).toHaveText("1");
  await page.evaluate((id) => window.artifactsE2E.write(id, "/data.csv", "value,label\n2,two\n3,three\n"), id);
  await expect(header(page, "label")).toBeVisible();
  await expect(page.locator("td")).toHaveText(["2", "two", "3", "three"]);
});

test("a pinned data revision reads the archived snapshot without changing live data", async ({ page }) => {
  const id = await openFixture(page);
  await page.evaluate(async (id) => {
    await window.artifactsE2E.write(id, "/data.csv", "value\n1\n");
    await window.artifactsE2E.write(id, "/data.csv", "value\n2\n");
  }, id);
  await expect(page.locator("td").first()).toHaveText("2");
  await page.getByRole("button", { name: "History", exact: true }).click();
  const revisions = page.getByRole("list", { name: "Revisions" }).getByRole("button");
  await expect(revisions).toHaveCount(2);
  await revisions.nth(1).click();
  await expect(page.getByRole("status")).toContainText("Viewing revision");
  await expect(page.locator("td").first()).toHaveText("1");
  expect((await page.evaluate((id) => window.artifactsE2E.read(id, "/data.csv"), id))?.content).toBe("value\n2\n");
  await page.getByRole("button", { name: "Back to current version" }).click();
  await expect(page.locator("td").first()).toHaveText("2");
});
