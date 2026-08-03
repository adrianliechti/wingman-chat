import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateXlsxTableIntegrity } from "./xlsxTableIntegrity";

function addTablePackage(zip: JSZip, options: { tableXml: string; sheetXml: string }): void {
  zip.file("xl/worksheets/sheet1.xml", options.sheetXml);
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>',
  );
  zip.file("xl/tables/table1.xml", options.tableXml);
}

describe("XLSX table integrity", () => {
  it("accepts a related table with matching text headers", async () => {
    const zip = new JSZip();
    addTablePackage(zip, {
      sheetXml:
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>April</t></is></c><c r="B2" t="n"><v>10</v></c></row></sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>',
      tableXml:
        '<table id="1" name="MonthlyData" displayName="MonthlyData" ref="A1:B2"><autoFilter ref="A1:B2"/><tableColumns count="2"><tableColumn id="1" name="Month"/><tableColumn id="2" name="Amount"/></tableColumns></table>',
    });

    await expect(validateXlsxTableIntegrity(zip, ["xl/worksheets/sheet1.xml"])).resolves.toEqual([]);
  });

  it("rejects the header, merge, and range defects that cause Excel table recovery", async () => {
    const zip = new JSZip();
    addTablePackage(zip, {
      sheetXml:
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="n"><v>2026</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>April</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>',
      tableXml:
        '<table id="1" name="A1" displayName="A1" ref="A1:B2"><autoFilter ref="A1:C2"/><tableColumns count="1"><tableColumn id="1" name="2026"/></tableColumns></table>',
    });

    const issues = await validateXlsxTableIntegrity(zip, ["xl/worksheets/sheet1.xml"]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("looks like a cell reference"),
        expect.stringContaining("range is 2 columns wide"),
        expect.stringContaining("autoFilter range"),
        expect.stringContaining("overlaps merged cells"),
        expect.stringContaining("blank, non-text, or formula header"),
      ]),
    );
  });
});
