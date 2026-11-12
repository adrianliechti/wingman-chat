import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const markdown = "| A | B |\n| - | - |\n| x | y |\n";

for (const format of ["Markdown", "CSV", "Word"] as const) {
  test(`${format} export uses the browser download manager without opening a save picker`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/browser/fixtures/markdown.html?downloads");
    await page.waitForFunction(() => window.markdownE2E);
    await page.evaluate((source) => window.markdownE2E.render(source), markdown);
    await page.evaluate(() => {
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: async () => {
          throw new Error("Message exports must use the browser download manager");
        },
      });
    });

    const downloading = page.waitForEvent("download");
    if (format === "CSV") {
      await page.getByRole("button", { name: "Open table in full screen" }).click();
      await page.getByRole("button", { name: "Download table as CSV" }).click();
    } else {
      await page.getByRole("button", { name: "Download message" }).click();
      await page.getByRole("menuitem", { name: format === "Word" ? "Word (.docx)" : "Markdown (.md)" }).click();
    }

    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const bytes = await readFile((await download.path())!);
    if (format === "Word") {
      expect(download.suggestedFilename()).toMatch(/^message-.*\.docx$/);
      const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
      expect(await zip.file("word/document.xml")!.async("string")).toContain("<w:tbl>");
    } else if (format === "Markdown") {
      expect(download.suggestedFilename()).toMatch(/^message-.*\.md$/);
      expect(bytes.toString("utf8")).toBe(markdown);
    } else {
      expect(download.suggestedFilename()).toBe("table.csv");
      expect(bytes.toString("utf8")).toBe("\uFEFFA,B\r\nx,y");
    }
    await download.delete();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    if (format !== "CSV") await expect(page.getByRole("button", { name: "Download message" })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
