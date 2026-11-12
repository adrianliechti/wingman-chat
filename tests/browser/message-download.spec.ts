import { expect, test } from "@playwright/test";

const markdown = "| A | B |\n| - | - |\n| x | y |\n";

for (const format of ["Markdown", "CSV", "Word"] as const) {
  for (const outcome of ["saved", "cancelled", "failed"] as const) {
    test(`${format} export handles ${outcome} saves without unhandled errors`, async ({ page }) => {
      const errors: string[] = [];
      const downloads: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      await page.goto("/tests/browser/fixtures/markdown.html?downloads");
      await page.waitForFunction(() => window.markdownE2E);
      await page.evaluate((source) => window.markdownE2E.render(source), markdown);
      await page.evaluate((outcome) => {
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: async (options: { types: { accept: Record<string, string[]> }[] }) => {
            for (const type of options.types) {
              if (Object.keys(type.accept).some((mime) => mime.includes(";"))) {
                throw new TypeError("Picker MIME types cannot contain parameters");
              }
            }
            if (outcome === "cancelled") throw new DOMException("Cancelled", "AbortError");
            return {
              createWritable: async () =>
                new WritableStream({
                  write() {
                    if (outcome === "failed") throw new DOMException("Disk full", "QuotaExceededError");
                  },
                  close() {
                    document.body.dataset.saved = "true";
                  },
                }),
            };
          },
        });
      }, outcome);

      if (format === "CSV") {
        await page.getByRole("button", { name: "Open table in full screen" }).click();
        await page.getByRole("button", { name: "Download table as CSV" }).click();
      } else {
        await page.getByRole("button", { name: "Download message" }).click();
        await page.getByRole("menuitem", { name: format === "Word" ? "Word (.docx)" : "Markdown (.md)" }).click();
      }

      const toast = page.locator("[data-sonner-toast]");
      if (outcome === "failed") {
        await expect(toast).toContainText(
          format === "Word" ? "Couldn't export Word document" : "Couldn't save the file",
        );
        await expect(toast).toContainText("Disk full");
      } else if (outcome === "saved") {
        await expect(page.locator("body")).toHaveAttribute("data-saved", "true");
        await expect(toast).toHaveCount(0);
      } else {
        // Let the picker rejection and the UI's promise handlers finish.
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
        await expect(toast).toHaveCount(0);
        await expect(page.locator("body")).not.toHaveAttribute("data-saved");
      }
      if (format !== "CSV") await expect(page.getByRole("button", { name: "Download message" })).toBeEnabled();
      expect(downloads).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
