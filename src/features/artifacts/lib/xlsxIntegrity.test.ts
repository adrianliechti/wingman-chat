import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateXlsxIntegrity } from "./xlsxIntegrity";

const SHEET = "xl/worksheets/sheet1.xml";
const NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const TABLE_RELS =
  '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>';

function worksheet(body: string, { tableParts = true }: { tableParts?: boolean } = {}): string {
  const parts = tableParts ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : "";
  return `<worksheet ${NS}>${body}${parts}</worksheet>`;
}

function addTablePackage(zip: JSZip, options: { tableXml: string; sheetXml: string }): void {
  zip.file(SHEET, options.sheetXml);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", TABLE_RELS);
  zip.file("xl/tables/table1.xml", options.tableXml);
}

function validate(zip: JSZip) {
  return validateXlsxIntegrity(zip, [SHEET]);
}

const TWO_COLUMN_ROWS =
  '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>April</t></is></c><c r="B2" t="n"><v>10</v></c></row></sheetData>';

const TWO_COLUMN_TABLE =
  '<table id="1" name="MonthlyData" displayName="MonthlyData" ref="A1:B2"><autoFilter ref="A1:B2"/><tableColumns count="2"><tableColumn id="1" name="Month"/><tableColumn id="2" name="Amount"/></tableColumns></table>';

describe("XLSX table integrity", () => {
  it("accepts a related table with matching text headers", async () => {
    const zip = new JSZip();
    addTablePackage(zip, { sheetXml: worksheet(TWO_COLUMN_ROWS), tableXml: TWO_COLUMN_TABLE });

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("rejects the header, merge, and range defects that cause Excel table recovery", async () => {
    const zip = new JSZip();
    addTablePackage(zip, {
      sheetXml: worksheet(
        '<sheetData><row r="1"><c r="A1" t="n"><v>2026</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>April</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>',
      ),
      tableXml:
        '<table id="1" name="A1" displayName="A1" ref="A1:B2"><autoFilter ref="A1:C2"/><tableColumns count="1"><tableColumn id="1" name="2026"/></tableColumns></table>',
    });

    const issues = await validate(zip);

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("looks like a cell reference"),
        expect.stringContaining("range is 2 columns wide"),
        expect.stringContaining("autoFilter range"),
        expect.stringContaining("overlaps merged cells"),
        expect.stringContaining("blank, non-text, or formula header"),
      ]),
    );
  });

  it("accepts a multi-line header that OOXML escapes in the column name", async () => {
    const zip = new JSZip();
    addTablePackage(zip, {
      sheetXml: worksheet(
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue\n($mm)</t></is></c><c r="B1" t="inlineStr"><is><t>Growth</t></is></c></row><row r="2"><c r="A2" t="n"><v>1</v></c><c r="B2" t="n"><v>2</v></c></row></sheetData>',
      ),
      tableXml:
        '<table id="1" name="Model" displayName="Model" ref="A1:B2"><tableColumns count="2"><tableColumn id="1" name="Revenue_x000a_($mm)"/><tableColumn id="2" name="Growth"/></tableColumns></table>',
    });

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("treats a header-name mismatch as a warning, not a failure", async () => {
    const zip = new JSZip();
    addTablePackage(zip, {
      sheetXml: worksheet(TWO_COLUMN_ROWS),
      tableXml:
        '<table id="1" name="MonthlyData" displayName="MonthlyData" ref="A1:B2"><tableColumns count="2"><tableColumn id="1" name="Month"/><tableColumn id="2" name="Total"/></tableColumns></table>',
    });

    const issues = await validate(zip);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toContain("do not match worksheet header cells");
  });

  it("flags a worksheet AutoFilter laid over a structured table", async () => {
    const zip = new JSZip();
    addTablePackage(zip, {
      sheetXml: worksheet(`${TWO_COLUMN_ROWS}<autoFilter ref="A1:B2"/>`),
      tableXml: TWO_COLUMN_TABLE,
    });

    const issues = await validate(zip);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("fail");
    expect(issues[0].message).toContain("worksheet AutoFilter");
  });

  it("flags a table whose relationship target is missing", async () => {
    const zip = new JSZip();
    zip.file(SHEET, worksheet(TWO_COLUMN_ROWS));
    zip.file("xl/worksheets/_rels/sheet1.xml.rels", TABLE_RELS);
    zip.file("xl/tables/table2.xml", TWO_COLUMN_TABLE);

    const issues = await validate(zip);

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("targets missing xl/tables/table1.xml"),
        expect.stringContaining("not referenced by a worksheet tablePart"),
      ]),
    );
  });
});

describe("XLSX worksheet integrity", () => {
  it("flags merged ranges that overlap each other", async () => {
    const zip = new JSZip();
    zip.file(
      SHEET,
      worksheet('<mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="B1:D1"/></mergeCells>', {
        tableParts: false,
      }),
    );

    const issues = await validate(zip);

    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("xlsx.merges");
    expect(issues[0].message).toContain("B1:D1 overlaps A1:C1");
  });

  it("accepts merged ranges that only touch", async () => {
    const zip = new JSZip();
    zip.file(
      SHEET,
      worksheet('<mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="D1:F1"/></mergeCells>', {
        tableParts: false,
      }),
    );

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("flags a conditional formatting formula written with a leading =", async () => {
    const zip = new JSZip();
    zip.file(
      SHEET,
      worksheet(
        '<conditionalFormatting sqref="A1:A5"><cfRule type="expression" dxfId="0" priority="1"><formula>=A1&gt;3</formula></cfRule></conditionalFormatting>',
        { tableParts: false },
      ),
    );

    const issues = await validate(zip);

    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("xlsx.conditional-formatting");
    expect(issues[0].message).toContain("Excel rejects the leading");
  });

  it("accepts a conditional formatting formula without the leading =", async () => {
    const zip = new JSZip();
    zip.file(
      SHEET,
      worksheet(
        '<conditionalFormatting sqref="A1:A5"><cfRule type="expression" dxfId="0" priority="1"><formula>A1&gt;3</formula></cfRule></conditionalFormatting>',
        { tableParts: false },
      ),
    );

    await expect(validate(zip)).resolves.toEqual([]);
  });
});
