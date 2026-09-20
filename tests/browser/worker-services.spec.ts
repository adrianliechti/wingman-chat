import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/worker-services.html");
  await page.waitForFunction(() => window.workerServicesE2E);
});

test("PDF rendering retains nearby canvases and releases its worker on close", async ({ page }) => {
  await page.evaluate(() => window.workerServicesE2E.showPdf(30));
  await expect(page.locator("canvas").first()).toHaveAttribute("width", /^[1-9]\d*$/);
  expect(await page.locator("canvas").count()).toBeLessThan(6);
  expect(await page.evaluate(() => window.workerServicesE2E.stats().active)).toBe(1);
  await page.locator("#root > div").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('canvas[aria-label="Page 30"]')).toHaveAttribute("width", /^[1-9]\d*$/);
  expect(await page.locator("canvas").count()).toBeLessThan(6);
  await expect(page.locator('canvas[aria-label="Page 1"]')).toHaveCount(0);
  await page.evaluate(() => window.workerServicesE2E.closePdf());
  await expect.poll(() => page.evaluate(() => window.workerServicesE2E.stats().active)).toBe(0);
});

test("PDF failure, extraction, rasterization and cancellation all release workers", async ({ page }) => {
  await page.evaluate(() => window.workerServicesE2E.invalidPdf());
  await expect(page.locator("#root")).toContainText(/invalid pdf/i);
  await expect.poll(() => page.evaluate(() => window.workerServicesE2E.stats().active)).toBe(0);
  // A failed document must not leave the viewer stuck in its error state.
  await page.evaluate(() => window.workerServicesE2E.showPdf());
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.evaluate(() => window.workerServicesE2E.closePdf());
  await expect.poll(() => page.evaluate(() => window.workerServicesE2E.stats().active)).toBe(0);
  expect(await page.evaluate(() => window.workerServicesE2E.extract())).toContain("Page 2");
  const pngSizes = await page.evaluate(() => window.workerServicesE2E.rasterize());
  expect(pngSizes).toHaveLength(1);
  expect(pngSizes[0]).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.workerServicesE2E.cancelPdf())).toBe("cancelled");
  await expect.poll(() => page.evaluate(() => window.workerServicesE2E.stats().active)).toBe(0);
});

test("SVG bridge rendering supports cancellation and rejects oversized canvases", async ({ page }) => {
  expect(await page.evaluate(() => window.workerServicesE2E.svg("render"))).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.workerServicesE2E.svg("cancel"))).toMatch(/^AbortError/);
  expect(await page.evaluate(() => window.workerServicesE2E.svg("oversized"))).toContain("8 million pixels");
});

test("preview sessions keep their own files and serve renamed SDK paths", async ({ page }) => {
  await page.evaluate(async () => {
    await window.workerServicesE2E.preview("first");
    await window.workerServicesE2E.preview("second");
  });
  await expect(page.frameLocator('iframe[data-id="first"]').locator("#out")).toHaveText("first");
  await expect(page.frameLocator('iframe[data-id="second"]').locator("#out")).toHaveText("second");
  await page.evaluate(() => window.workerServicesE2E.rename("first"));
  const frame = page.frames().find((frame) => frame.url().includes("/__preview__/"))!;
  const renamed = await frame.evaluate(async () => (await fetch("moved/page.html")).text());
  expect(renamed).toContain('data-path="/moved/page.html"');
  await page.evaluate(() => window.workerServicesE2E.remove("first"));
  expect(await frame.evaluate(async () => (await fetch("moved/data.txt")).status)).toBe(404);
  await page.evaluate(() => window.workerServicesE2E.closePreview("first"));
  const second = page.frames().find((frame) => frame.url().includes("/__preview__/"))!;
  expect(await second.evaluate(async () => (await fetch("folder/data.txt")).text())).toBe("data");
});
