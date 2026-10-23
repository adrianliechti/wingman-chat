import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateOoxmlPackage } from "./ooxmlPackage";
import { validateXlsxIntegrity } from "./xlsxIntegrity";

const CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STRICT_RELATIONSHIPS = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const SPREADSHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const STRICT_SPREADSHEET = "http://purl.oclc.org/ooxml/spreadsheetml/main";
const SHEET = "xl/worksheets/report.xml";
const TABLE = "xl/tables/data.xml";

function relationships(...entries: string[]): string {
  return `<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${entries.join("")}</Relationships>`;
}

function contentTypes({ table = false }: { table?: boolean } = {}): string {
  return `<Types xmlns="${CONTENT_TYPES}">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    ${table ? `<Override PartName="/${TABLE}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>` : ""}
  </Types>`;
}

interface WorkbookOptions {
  sharedStringsXml?: string;
  stylesXml?: string;
  strict?: boolean;
  tableXml?: string;
}

function worksheet(
  body: string,
  {
    strict = false,
    tableParts = true,
  }: {
    strict?: boolean;
    tableParts?: boolean;
  } = {},
): string {
  const spreadsheet = strict ? STRICT_SPREADSHEET : SPREADSHEET;
  const relationshipNamespace = strict ? STRICT_RELATIONSHIPS : RELATIONSHIPS;
  const parts = tableParts ? '<tableParts count="1"><tablePart r:id="tableData"/></tableParts>' : "";
  return `<worksheet xmlns="${spreadsheet}" xmlns:r="${relationshipNamespace}">${body}${parts}</worksheet>`;
}

function addWorkbook(zip: JSZip, sheetXml: string, options: WorkbookOptions = {}): void {
  const relationshipNamespace = options.strict ? STRICT_RELATIONSHIPS : RELATIONSHIPS;
  const spreadsheet = options.strict ? STRICT_SPREADSHEET : SPREADSHEET;
  zip.file("[Content_Types].xml", contentTypes({ table: options.tableXml !== undefined }));
  zip.file(
    "_rels/.rels",
    relationships(
      `<Relationship Id="packageMain" Type="${relationshipNamespace}/officeDocument" Target="/xl/workbook.xml"/>`,
    ),
  );
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${spreadsheet}" xmlns:r="${relationshipNamespace}"><sheets><sheet name="Report" sheetId="1" r:id="sheetData"/></sheets></workbook>`,
  );
  const workbookRelationships = [
    `<Relationship Id="sheetData" Type="${relationshipNamespace}/worksheet" Target="worksheets/report.xml"/>`,
  ];
  if (options.sharedStringsXml !== undefined) {
    workbookRelationships.push(
      `<Relationship Id="stringData" Type="${relationshipNamespace}/sharedStrings" Target="strings/shared.xml"/>`,
    );
    zip.file("xl/strings/shared.xml", options.sharedStringsXml);
  }
  if (options.stylesXml !== undefined) {
    workbookRelationships.push(
      `<Relationship Id="styleData" Type="${relationshipNamespace}/styles" Target="styles/custom.xml"/>`,
    );
    zip.file("xl/styles/custom.xml", options.stylesXml);
  }
  zip.file("xl/_rels/workbook.xml.rels", relationships(...workbookRelationships));
  zip.file(SHEET, sheetXml);
  if (options.tableXml !== undefined) {
    zip.file(
      "xl/worksheets/_rels/report.xml.rels",
      relationships(`<Relationship Id="tableData" Type="${relationshipNamespace}/table" Target="../tables/data.xml"/>`),
    );
    zip.file(TABLE, options.tableXml);
  }
}

async function validate(zip: JSZip) {
  const packageInfo = await validateOoxmlPackage(zip, "xlsx");
  return [...packageInfo.issues, ...(await validateXlsxIntegrity(packageInfo))];
}

const TWO_COLUMN_ROWS =
  '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>April</t></is></c><c r="B2" t="n"><v>10</v></c></row></sheetData>';

const TWO_COLUMN_TABLE = `<table xmlns="${SPREADSHEET}" id="1" name="MonthlyData" displayName="MonthlyData" ref="A1:B2"><autoFilter ref="A1:B2"/><tableColumns count="2"><tableColumn id="1" name="Month"/><tableColumn id="2" name="Amount"/></tableColumns></table>`;

describe("XLSX table integrity", () => {
  it("accepts arbitrary relationship ids and non-numbered worksheet paths", async () => {
    const zip = new JSZip();
    addWorkbook(zip, worksheet(TWO_COLUMN_ROWS), { tableXml: TWO_COLUMN_TABLE });

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("accepts Strict SpreadsheetML and relationship namespaces", async () => {
    const zip = new JSZip();
    addWorkbook(zip, worksheet(TWO_COLUMN_ROWS, { strict: true }), {
      strict: true,
      tableXml: TWO_COLUMN_TABLE.replace(SPREADSHEET, STRICT_SPREADSHEET),
    });

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("rejects the header, merge, and range defects that cause Excel table recovery", async () => {
    const zip = new JSZip();
    addWorkbook(
      zip,
      worksheet(
        '<sheetData><row r="1"><c r="A1" t="n"><v>2026</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>April</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>',
      ),
      {
        tableXml: `<table xmlns="${SPREADSHEET}" id="1" name="A1" displayName="A1" ref="A1:B2"><autoFilter ref="A1:C2"/><tableColumns count="1"><tableColumn id="1" name="2026"/></tableColumns></table>`,
      },
    );

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
    addWorkbook(
      zip,
      worksheet(
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue\n($mm)</t></is></c><c r="B1" t="inlineStr"><is><t>Growth</t></is></c></row><row r="2"><c r="A2" t="n"><v>1</v></c><c r="B2" t="n"><v>2</v></c></row></sheetData>',
      ),
      {
        tableXml: `<table xmlns="${SPREADSHEET}" id="1" name="Model" displayName="Model" ref="A1:B2"><tableColumns count="2"><tableColumn id="1" name="Revenue_x000a_($mm)"/><tableColumn id="2" name="Growth"/></tableColumns></table>`,
      },
    );

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("treats a header-name mismatch as a warning, not a failure", async () => {
    const zip = new JSZip();
    addWorkbook(zip, worksheet(TWO_COLUMN_ROWS), {
      tableXml: `<table xmlns="${SPREADSHEET}" id="1" name="MonthlyData" displayName="MonthlyData" ref="A1:B2"><tableColumns count="2"><tableColumn id="1" name="Month"/><tableColumn id="2" name="Total"/></tableColumns></table>`,
    });

    const issues = await validate(zip);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toContain("do not match worksheet header cells");
  });

  it("flags a worksheet AutoFilter laid over a structured table", async () => {
    const zip = new JSZip();
    addWorkbook(zip, worksheet(`${TWO_COLUMN_ROWS}<autoFilter ref="A1:B2"/>`), { tableXml: TWO_COLUMN_TABLE });

    const issues = await validate(zip);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("fail");
    expect(issues[0].message).toContain("worksheet AutoFilter");
  });

  it("flags a table whose relationship target is missing", async () => {
    const zip = new JSZip();
    addWorkbook(zip, worksheet(TWO_COLUMN_ROWS), { tableXml: TWO_COLUMN_TABLE });
    zip.remove(TABLE);

    const issues = await validate(zip);

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`targets missing part ${TABLE}`),
        expect.stringContaining(`targets missing ${TABLE}`),
      ]),
    );
  });
});

describe("XLSX worksheet integrity", () => {
  it("flags merged ranges that overlap each other", async () => {
    const zip = new JSZip();
    addWorkbook(
      zip,
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
    addWorkbook(
      zip,
      worksheet('<mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="D1:F1"/></mergeCells>', {
        tableParts: false,
      }),
    );

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("ignores merge-like elements from a foreign namespace", async () => {
    const zip = new JSZip();
    addWorkbook(
      zip,
      worksheet(
        '<foreign:mergeCells xmlns:foreign="urn:not-spreadsheet"><foreign:mergeCell ref="not-a-range"/></foreign:mergeCells>',
        { tableParts: false },
      ),
    );

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("flags a conditional formatting formula written with a leading =", async () => {
    const zip = new JSZip();
    addWorkbook(
      zip,
      worksheet(
        '<conditionalFormatting sqref="A1:A5"><cfRule type="expression" priority="1"><formula>=A1&gt;3</formula></cfRule></conditionalFormatting>',
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
    addWorkbook(
      zip,
      worksheet(
        '<conditionalFormatting sqref="A1:A5"><cfRule type="expression" priority="1"><formula>A1&gt;3</formula></cfRule></conditionalFormatting>',
        { tableParts: false },
      ),
    );

    await expect(validate(zip)).resolves.toEqual([]);
  });

  it("validates shared-string and style references through workbook relationships", async () => {
    const zip = new JSZip();
    addWorkbook(
      zip,
      worksheet(
        '<sheetData><row r="1"><c r="A1" t="s" s="2"><v>4</v></c></row></sheetData><conditionalFormatting sqref="A1"><cfRule type="expression" dxfId="3" priority="1"><formula>A1&gt;0</formula></cfRule></conditionalFormatting>',
        { tableParts: false },
      ),
      {
        sharedStringsXml: `<sst xmlns="${SPREADSHEET}" uniqueCount="1"><si><t>Only value</t></si></sst>`,
        stylesXml: `<styleSheet xmlns="${SPREADSHEET}"><cellXfs count="1"><xf/></cellXfs><dxfs count="1"><dxf/></dxfs></styleSheet>`,
      },
    );

    const issues = await validate(zip);
    const messages = issues.map((issue) => issue.message);

    expect(messages).toContainEqual(expect.stringContaining("invalid shared-string index 4"));
    expect(messages).toContainEqual(expect.stringContaining("invalid style index 2"));
    expect(messages).toContainEqual(expect.stringContaining("invalid dxfId 3"));
  });
});
