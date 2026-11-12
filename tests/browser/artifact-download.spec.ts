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

for (const surface of ["Artifact panel", "Inline artifact"]) {
  for (const stage of ["create-writable", "write", "close"] as const) {
    test(`${surface} reports AbortError during ${stage} after Save is confirmed`, async ({ page }) => {
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      await page.evaluate((stage) => {
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: async () => ({
            createWritable: async () => {
              const failure = new DOMException("The save was blocked", "AbortError");
              if (stage === "create-writable") throw failure;
              return new WritableStream({
                write() {
                  if (stage === "write") throw failure;
                },
                close() {
                  if (stage === "close") throw failure;
                },
              });
            },
          }),
        });
      }, stage);
      await page.getByRole("region", { name: surface, exact: true }).getByTitle(`Download ${filename}`).click();
      await expect(page.getByText("Couldn't save the file", { exact: true })).toBeVisible();
      expect(downloads).toEqual([]);
    });
  }
}

test("repeated native PowerPoint saves commit the original bytes to real writable file streams", async ({ page }) => {
  await page.evaluate(() => {
    let attempt = 0;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle("download-test-output", { create: true });
        return directory.getFileHandle(`saved-${++attempt}.pptx`, { create: true });
      },
    });
  });
  for (let attempt = 1; attempt <= saveAttempts; attempt++) {
    await test.step(`native save ${attempt}/${saveAttempts}`, async () => {
      await page.getByRole("region", { name: "Artifact panel" }).getByTitle(`Download ${filename}`).click();
      await expect
        .poll(async () =>
          page.evaluate(async (attempt) => {
            try {
              const root = await navigator.storage.getDirectory();
              const directory = await root.getDirectoryHandle("download-test-output");
              const handle = await directory.getFileHandle(`saved-${attempt}.pptx`);
              return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
            } catch {
              return null;
            }
          }, attempt),
        )
        .toEqual([...sourceBytes]);
    });
  }
  await expect(page.getByText("Couldn't save the file", { exact: true })).toHaveCount(0);
});

test("repeated fallback PowerPoint downloads complete with unchanged bytes and intact ZIP entries", async ({
  page,
}) => {
  await page.evaluate(() =>
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined }),
  );
  for (let attempt = 1; attempt <= saveAttempts; attempt++) {
    await test.step(`fallback download ${attempt}/${saveAttempts}`, async () => {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        page.getByRole("region", { name: "Inline artifact" }).getByTitle(`Download ${filename}`).click({ delay: 150 }),
      ]);
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toBe(filename);
      const saved = await readFile((await download.path())!);
      expect(saved).toEqual(sourceBytes);
      await JSZip.loadAsync(saved, { checkCRC32: true });
      await download.delete();
    });
  }
});
