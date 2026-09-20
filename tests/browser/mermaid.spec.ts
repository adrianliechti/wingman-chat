import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/mermaid.html");
});

test("renders a flowchart to SVG with the bundled layout engine", async ({ page }) => {
  await page.evaluate(() =>
    window.mermaidE2E.render("flowchart LR\n  A[Start] --> B{Decide}\n  B -->|yes| C[Done]\n  B -->|no| A"),
  );
  const svg = page.locator("svg[id^='mermaid-']");
  await expect(svg).toBeVisible();
  await expect(svg).toContainText("Start");
  await expect(svg).toContainText("Decide");
  await expect(svg).toContainText("Done");
  expect(await svg.locator(".node").count()).toBe(3);
});

test("renders a sequence diagram", async ({ page }) => {
  await page.evaluate(() => window.mermaidE2E.render("sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi"));
  const svg = page.locator("svg[id^='mermaid-']");
  await expect(svg).toBeVisible();
  await expect(svg).toContainText("Hello");
  await expect(svg).toContainText("Hi");
});

test("reports a syntax error instead of a blank preview", async ({ page }) => {
  await page.evaluate(() => window.mermaidE2E.render("flowchart LR\n  A --> "));
  await expect(page.getByText("Couldn't render this diagram")).toBeVisible();
});
