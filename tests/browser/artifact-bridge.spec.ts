import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { artifacts: {}, models: [] } }));
  await page.goto("/tests/browser/fixtures/artifacts.html");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
}

async function ensureChat(page: Page) {
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  return id;
}

/** A page that exercises the SDK and reports into #out as JSON. */
const page = (body: string) => `<!doctype html>
<html><body><pre id="out">pending</pre>
<script>
(async () => {
  const out = document.getElementById("out");
  try {
    const w = window.wingman;
    ${body}
  } catch (error) {
    out.textContent = "error: " + (error && error.message ? error.message : error);
  }
})();
</script></body></html>`;

test("the preview receives window.wingman with files, store and capabilities", async ({ page: browser }) => {
  await openFixture(browser);
  const id = await ensureChat(browser);
  await browser.getByRole("button", { name: "Toggle artifacts" }).click();
  await browser.evaluate(
    ([id, html]) => window.artifactsE2E.write(id, "/index.html", html),
    [
      id,
      page(`
    if (!w) throw new Error("no sdk");
    const visits = ((await w.store.get("visits")) ?? 0) + 1;
    await w.store.set("visits", visits);
    await w.files.writeText("/notes/from-page.txt", "written " + visits);
    const back = await w.files.readText("/notes/from-page.txt");
    out.textContent = JSON.stringify({ visits, back, files: await w.files.list(), caps: w.capabilities, path: w.path });
  `),
    ] as const,
  );
  const frame = browser.frameLocator("iframe");
  await expect(frame.locator("#out")).toContainText('"visits":1');
  const first = JSON.parse((await frame.locator("#out").textContent())!);
  expect(first).toMatchObject({ visits: 1, back: "written 1", path: "/index.html" });
  expect(first.files).toEqual(expect.arrayContaining(["/index.html", "/notes/from-page.txt"]));
  expect(first.caps).toMatchObject({ files: true, store: true, llm: true, duckdb: true });

  // The page's own write did not reload it; state survives a real reload.
  await expect(frame.locator("#out")).toContainText('"visits":1');
  await browser.evaluate((id) => window.artifactsE2E.write(id, "/style.css", "body{}"), id);
  await expect(frame.locator("#out")).toContainText('"visits":2');
  expect(await browser.evaluate((id) => window.artifactsE2E.read(id, "/notes/from-page.txt").then((f) => f?.content), id)).toBe(
    "written 2",
  );
});

test("DuckDB answers SQL over workspace files by name", async ({ page: browser }) => {
  test.setTimeout(240_000);
  await openFixture(browser);
  const id = await ensureChat(browser);
  await browser.getByRole("button", { name: "Toggle artifacts" }).click();
  await browser.evaluate(
    (id) => window.artifactsE2E.write(id, "/data/flights.csv", "carrier,delay\nAA,10\nAA,20\nUA,5\n"),
    id,
  );
  await browser.evaluate(
    ([id, html]) => window.artifactsE2E.write(id, "/report.html", html),
    [
      id,
      page(`
    const conn = await w.duckdb.connect();
    const byCarrier = await conn.query("SELECT carrier, SUM(delay) AS total FROM 'flights.csv' GROUP BY carrier ORDER BY carrier");
    const byPath = await w.duckdb.query("SELECT count(*) AS n FROM 'data/flights.csv' WHERE delay > $1", [7]);
    await conn.close();
    out.textContent = JSON.stringify({ byCarrier: byCarrier.rows, byPath: byPath.rows, files: await w.duckdb.files() });
  `),
    ] as const,
  );
  await browser.evaluate(() => window.artifactsE2E.openFile("/report.html"));
  const out = browser.frameLocator("iframe").locator("#out");
  await expect(out).toContainText("byCarrier", { timeout: 180_000 });
  const result = JSON.parse((await out.textContent())!);
  expect(result).toEqual({
    byCarrier: [
      { carrier: "AA", total: 30 },
      { carrier: "UA", total: 5 },
    ],
    byPath: [{ n: 2 }],
    files: ["data/flights.csv", "flights.csv"],
  });
});

test("both interpreters can query workspace files with sql()", async ({ page: browser }) => {
  test.setTimeout(300_000);
  await openFixture(browser);
  const id = await ensureChat(browser);
  await browser.evaluate((id) => window.artifactsE2E.write(id, "/flights.csv", "carrier,delay\nAA,10\nUA,5\n"), id);

  const js = await browser.evaluate(
    (id) =>
      window.artifactsE2E.tool(
        "execute_javascript_code",
        { code: "const r = await sql('SELECT count(*) AS n FROM \\'flights.csv\\''); return JSON.stringify(r.rows);" },
        id,
      ),
    id,
  );
  expect(JSON.stringify(js)).toContain('[{\\"n\\":2}]');

  const py = await browser.evaluate(
    (id) =>
      window.artifactsE2E.tool(
        "execute_python_code",
        { code: "r = await sql(\"SELECT carrier FROM 'flights.csv' WHERE delay > $1 ORDER BY carrier\", [7])\nprint([row['carrier'] for row in r['rows']])" },
        id,
      ),
    id,
  );
  expect(JSON.stringify(py)).toContain("['AA']");
});

test("bundled extensions load from the app origin: read_xlsx works offline", async ({ page: browser, context }) => {
  test.setTimeout(240_000);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>city</t></is></c><c r="B1" t="inlineStr"><is><t>sales</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Bern</t></is></c><c r="B2"><v>10</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Basel</t></is></c><c r="B3"><v>32</v></c></row></sheetData></worksheet>',
  );
  const xlsx = await zip.generateAsync({ type: "base64" });

  // Nothing may leave the app origin; the extension must come from /duckdb/extensions.
  const external: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    external.push(url.href);
    return route.abort();
  });

  await openFixture(browser);
  const id = await ensureChat(browser);
  await browser.getByRole("button", { name: "Toggle artifacts" }).click();
  await browser.evaluate(
    ([id, data]) =>
      window.artifactsE2E.write(
        id,
        "/book.xlsx",
        `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${data}`,
      ),
    [id, xlsx] as const,
  );
  await browser.evaluate((id) => window.artifactsE2E.write(id, "/orders.json", '[{"qty":2},{"qty":5}]'), id);
  await browser.evaluate(
    ([id, html]) => window.artifactsE2E.write(id, "/sheet.html", html),
    [
      id,
      page(`
    const version = await w.duckdb.query("SELECT version() AS v");
    const rows = await w.duckdb.query("SELECT city, sales FROM read_xlsx('book.xlsx') ORDER BY sales");
    await w.duckdb.query("COPY (SELECT range AS i, range % 7 AS bucket FROM range(100000)) TO 'gen.parquet' (FORMAT PARQUET)");
    const parquet = await w.duckdb.query("SELECT count(*) AS n, count(DISTINCT bucket) AS buckets FROM 'gen.parquet'");
    const json = await w.duckdb.query("SELECT sum(qty) AS total FROM 'orders.json'");
    out.textContent = JSON.stringify({ version: version.rows[0].v, rows: rows.rows, parquet: parquet.rows[0], json: json.rows[0] });
  `),
    ] as const,
  );
  await browser.evaluate(() => window.artifactsE2E.openFile("/sheet.html"));
  const out = browser.frameLocator("iframe").locator("#out");
  await expect(out).toContainText("rows", { timeout: 180_000 });
  const result = JSON.parse((await out.textContent())!);
  expect(result.rows).toEqual([
    { city: "Bern", sales: 10 },
    { city: "Basel", sales: 32 },
  ]);
  expect(result.version).toMatch(/^v1\.4\./);
  expect(result.parquet).toEqual({ n: 100000, buckets: 7 });
  expect(result.json).toEqual({ total: 7 });
  expect(external).toEqual([]);
});
