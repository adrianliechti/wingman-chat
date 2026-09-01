import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const spreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function workbookArchive(sheetCount: number): Promise<number[]> {
  const zip = new JSZip();
  const sheetEntries = Array.from(
    { length: sheetCount },
    (_, index) => `<sheet name="Worksheet ${index + 1} Long Name" sheetId="${index + 1}" r:id="sheet${index + 1}"/>`,
  ).join("");
  const relationships = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="sheet${index + 1}" Type="${officeRelationshipNamespace}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="${spreadsheetNamespace}" xmlns:r="${officeRelationshipNamespace}"><sheets>${sheetEntries}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="${relationshipNamespace}">${relationships}</Relationships>`,
  );
  const worksheet = `<?xml version="1.0"?><worksheet xmlns="${spreadsheetNamespace}"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="52" width="12" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Frozen</t></is></c></row><row r="200"><c r="AZ200" t="inlineStr"><is><t>Far cell</t></is></c></row></sheetData></worksheet>`;
  for (let index = 0; index < sheetCount; index++) zip.file(`xl/worksheets/sheet${index + 1}.xml`, worksheet);
  return Array.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

test("keeps worksheet headers and frozen panes synchronized with native scrolling", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/office-editors.html");
  const bytes = await workbookArchive(16);
  await page.evaluate((data) => window.officeEditorsE2E.renderXlsx(data), bytes);

  const grid = page.getByTestId("xlsx-grid-scroll");
  await expect(grid).toBeVisible();

  const offsets = await grid.evaluate(async (element) => {
    element.scrollLeft = 480;
    element.scrollTop = 320;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const columnTrack = document.querySelector<HTMLElement>('[data-testid="xlsx-column-header-track"]');
    const rowTrack = document.querySelector<HTMLElement>('[data-testid="xlsx-row-header-track"]');
    const frozenCell = element.querySelector<HTMLElement>('[role="gridcell"][aria-rowindex="1"][aria-colindex="1"]');
    if (!columnTrack || !rowTrack || !frozenCell) throw new Error("Worksheet synchronization elements are missing");
    const columnMatrix = new DOMMatrix(getComputedStyle(columnTrack).transform);
    const rowMatrix = new DOMMatrix(getComputedStyle(rowTrack).transform);
    const frozenMatrix = new DOMMatrix(getComputedStyle(frozenCell).transform);
    return {
      left: element.scrollLeft,
      top: element.scrollTop,
      columnX: columnMatrix.m41,
      rowY: rowMatrix.m42,
      frozenX: frozenMatrix.m41,
      frozenY: frozenMatrix.m42,
    };
  });

  expect(offsets.left).toBeGreaterThan(0);
  expect(offsets.top).toBeGreaterThan(0);
  expect(offsets.columnX).toBeCloseTo(-offsets.left, 4);
  expect(offsets.rowY).toBeCloseTo(-offsets.top, 4);
  expect(offsets.frozenX).toBeCloseTo(offsets.left, 4);
  expect(offsets.frozenY).toBeCloseTo(offsets.top, 4);
});

test("uses a scrolling sheet strip and shared lower-right zoom without custom find or copy buttons", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/office-editors.html");
  const bytes = await workbookArchive(16);
  await page.evaluate((data) => window.officeEditorsE2E.renderXlsx(data), bytes);

  const grid = page.getByTestId("xlsx-grid-scroll");
  await expect(grid).toBeVisible();
  await expect(page.getByPlaceholder("Find in sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy selection" })).toHaveCount(0);

  const sheets = page.locator('[aria-label="Worksheets"]');
  const zoom = page.getByRole("group", { name: "Zoom" });
  const layout = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>('[aria-label="Worksheets"]');
    const controls = document.querySelector<HTMLElement>('[role="group"][aria-label="Zoom"]');
    if (!strip || !controls) throw new Error("Bottom controls are missing");
    const stripRect = strip.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    return {
      tabsOverflow: strip.scrollWidth > strip.clientWidth,
      adjacent: Math.abs(stripRect.right - controlsRect.left) <= 1,
      separator: getComputedStyle(controls).borderLeftWidth,
      controlsBottom: Math.round(controlsRect.bottom),
      viewportBottom: window.innerHeight,
    };
  });
  expect(await sheets.getAttribute("aria-label")).toBe("Worksheets");
  expect(layout).toEqual({
    tabsOverflow: true,
    adjacent: true,
    separator: "1px",
    controlsBottom: layout.viewportBottom,
    viewportBottom: layout.viewportBottom,
  });

  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toContainText("125%");
});
