import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function archive(entries: Record<string, string>): Promise<number[]> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(entries)) zip.file(name, contents);
  return Array.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/office-editors.html");
});

test("places DOCX zoom below the page stack and applies it without repagination", async ({ page }) => {
  const bytes = await archive({
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Zoomable document</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
  });
  await page.evaluate((data) => window.officeEditorsE2E.renderDocx(data), bytes);

  const zoom = page.getByRole("group", { name: "Zoom" });
  await expect(zoom).toBeVisible();
  const documentFrame = page.frameLocator('iframe[title="document.docx"]');
  await expect(documentFrame.locator("body > .pg")).toHaveCount(1);
  const initialZoom = await documentFrame.locator("body").evaluate((body) => Number.parseFloat(body.style.zoom));

  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toContainText("125%");
  await expect
    .poll(() => documentFrame.locator("body").evaluate((body) => Number.parseFloat(body.style.zoom)))
    .toBeCloseTo(initialZoom * 1.25, 3);
  await expect(documentFrame.locator("body > .pg")).toHaveCount(1);
});

test("places PPTX zoom at the lower right without a custom find toolbar", async ({ page }) => {
  const bytes = await archive({
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${officeRelationshipNamespace}"><p:sldIdLst><p:sldId id="256" r:id="slide1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="slide1" Type="${officeRelationshipNamespace}/slide" Target="slides/slide1.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Single slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  });
  await page.evaluate((data) => window.officeEditorsE2E.renderPptx(data), bytes);

  const zoom = page.getByRole("group", { name: "Zoom" });
  await expect(zoom).toBeVisible();
  await expect(page.getByPlaceholder("Find in slides")).toHaveCount(0);
  await expect(page.getByText("Slide 1 of 1")).toBeVisible();
  const placement = await zoom.evaluate((controls) => {
    const rect = controls.getBoundingClientRect();
    return { right: Math.round(rect.right), bottom: Math.round(rect.bottom) };
  });
  const viewport = page.viewportSize();
  expect(placement).toEqual({ right: viewport?.width, bottom: viewport?.height });

  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toContainText("125%");
});
