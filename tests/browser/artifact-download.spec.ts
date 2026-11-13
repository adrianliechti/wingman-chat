import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const filename = "presentation.pptx";
const mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const saveAttempts = 3;

// Same synthetic slide structure used by the Office editor browser tests.
async function powerpoint(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="slide1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="slide1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Download integrity test</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

let sourceBytes: Buffer;
test.beforeAll(async () => {
  sourceBytes = await powerpoint();
});

test.beforeEach(async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { artifacts: {}, models: [] } }));
  await page.goto("/tests/browser/fixtures/artifacts.html?inline-download");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType, buffer: sourceBytes });
  await expect(page.getByRole("region", { name: "Artifact panel" }).getByTitle(`Download ${filename}`)).toBeVisible();
});

// Chromium exposes the picker, but artifact downloads must still reach its
// download manager. A picker call fails the test instead of opening native UI.
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        throw new Error("Artifact downloads must use the browser download manager");
      },
    });
  });
});

for (const surface of ["Artifact panel", "Inline artifact"]) {
  test(`${surface} repeatedly downloads PowerPoint with unchanged bytes and intact ZIP entries`, async ({ page }) => {
    for (let attempt = 1; attempt <= saveAttempts; attempt++) {
      await test.step(`download ${attempt}/${saveAttempts}`, async () => {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15_000 }),
          page.getByRole("region", { name: surface, exact: true }).getByTitle(`Download ${filename}`).click(),
        ]);
        expect(await download.failure()).toBeNull();
        expect(download.suggestedFilename()).toBe(filename);
        const saved = await readFile((await download.path())!);
        expect(saved).toEqual(sourceBytes);
        await JSZip.loadAsync(saved, { checkCRC32: true });
        await download.delete();
      });
    }
    await expect(page.getByText("Couldn't save the file", { exact: true })).toHaveCount(0);
  });
}

test("Download all uses the browser download manager and preserves artifact bytes in the ZIP", async ({ page }) => {
  await page.getByRole("button", { name: "Show file list", exact: true }).click();
  await page.getByRole("button", { name: "File actions", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("menuitem", { name: "Download all", exact: true }).click(),
  ]);
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toBe("filesystem.zip");
  const zip = await JSZip.loadAsync(await readFile((await download.path())!), { checkCRC32: true });
  expect(await zip.file(filename)!.async("nodebuffer")).toEqual(sourceBytes);
  await download.delete();
});
