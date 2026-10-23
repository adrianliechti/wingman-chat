import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { emptyCapabilities } from "../../src/shared/lib/artifactSdk/protocol";

const shareId = "0123456789abcdef0123456789abcdef";
const root = `/artifacts/${shareId}`;
const capabilities = { ...emptyCapabilities(), files: true, store: true, duckdb: true };

const html = (body: string) => `<!doctype html><html><head></head><body><pre id="out">pending</pre><script>
(async () => {
  const w = window.wingman;
  const out = document.getElementById('out');
  try { ${body} } catch (error) { out.textContent = 'error: ' + error.message; }
})();
</script></body></html>`;

/** Exercise the real app, SDK, opaque-origin frame and DuckDB worker with a fixed published workspace. */
async function openShare(page: Page, files: Record<string, string | Buffer>) {
  // Route-fulfilled documents have no loopback address-space metadata. Inline
  // the real bundled SDK so Chromium's local-network policy does not block
  // its request from the mocked opaque-origin document.
  const sdkResponse = await page.request.get("/__artifact-libraries__/wingman-sdk.js");
  expect(sdkResponse.ok()).toBe(true);
  const sdkSource = (await sdkResponse.text()).replace(/<\/script/gi, "<\\/script");
  await page.route("**/config.json", (route) => route.fulfill({ json: { title: "Viewer test", models: [] } }));
  await page.route(`**${root}/share.json`, (route) =>
    route.fulfill({
      json: {
        id: shareId,
        title: "Shared page",
        entry: "index.html",
        expiresAt: "2099-01-01T00:00:00Z",
        files: Object.keys(files),
        capabilities,
      },
    }),
  );
  await page.route(`**${root}/files/**`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(`${root}/files/`.length));
    let body = files[name];
    if (body === undefined) return route.fulfill({ status: 404 });
    const isHtml = name.endsWith(".html");
    if (isHtml && route.request().resourceType() === "document") {
      const sdk = `<script data-token="${shareId}" data-path="/${name}" data-capabilities="${JSON.stringify(capabilities).replace(/"/g, "&quot;")}">${sdkSource}</script>`;
      body = String(body).replace("<head>", `<head>${sdk}`);
    }
    return route.fulfill({
      body,
      contentType: isHtml ? "text/html" : name.endsWith(".csv") ? "text/csv" : "application/octet-stream",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Security-Policy": "sandbox allow-scripts" },
    });
  });
  await page.goto(root, { waitUntil: "domcontentloaded" });
}

async function workbook() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>amount</t></is></c></row><row r="2"><c r="A2"><v>9</v></c></row></sheetData></worksheet>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("shared SQL reads its files while blocking other URLs and changes to its restrictions", async ({ page }) => {
  const privateRequests: string[] = [];
  await page
    .context()
    .addCookies([{ name: "session", value: "viewer", url: "http://127.0.0.1:4175", sameSite: "Lax" }]);
  await page.route("**/viewer-private.json", (route) => {
    privateRequests.push(route.request().method());
    return route.fulfill({ json: [{ secret: "synthetic private data" }] });
  });
  await openShare(page, {
    "data/sales.csv": "region,amount\nEU,3\nUS,7\n",
    "data/o'hare.json": '[{"amount":5}]',
    "book.xlsx": await workbook(),
    "index.html": html(`
      const conn = await w.duckdb.connect();
      const csv = await conn.query("SELECT sum(amount) AS total FROM 'sales.csv'");
      const json = await conn.query("SELECT sum(amount) AS total FROM read_json_auto(?)", ["data/o'hare.json"]);
      const xlsx = await conn.query("SELECT sum(amount) AS total FROM read_xlsx('book.xlsx')");
      const url = location.origin + '/viewer-private.json';
      const attempts = [
        ["SELECT * FROM read_json_auto('" + url + "')"],
        ["SELECT * FROM read_json_auto(?)", [url]],
        ["SET enable_external_access = true"],
        ["RESET allowed_paths"],
        ["SET allowed_paths = ['" + url + "']"],
        ["SET lock_configuration = false"],
        ["LOAD '" + url + "'"],
      ];
      const blocked = [];
      for (const [sql, params] of attempts) {
        try { await conn.query(sql, params); blocked.push(null); }
        catch (error) { blocked.push(error.message); }
      }
      const after = await conn.query("SELECT sum(amount) AS total FROM 'data/sales.csv' WHERE amount > ?", [5]);
      await conn.close();
      out.textContent = JSON.stringify({ csv:csv.rows, json:json.rows, xlsx:xlsx.rows, after:after.rows, blocked });
    `),
  });
  const out = page.frameLocator("iframe").locator("#out");
  await expect(out).toContainText('"blocked"');
  const result = JSON.parse((await out.textContent())!);
  expect(result).toMatchObject({
    csv: [{ total: 10 }],
    json: [{ total: 5 }],
    xlsx: [{ total: 9 }],
    after: [{ total: 7 }],
  });
  expect(result.blocked).toHaveLength(7);
  for (const error of result.blocked) expect(error).toMatch(/disabled|locked|configuration/i);
  expect(privateRequests).toEqual([]);
});

test("navigation releases SQL without another RPC and preserves early calls and history restores", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const workers = { active: 0 };
    Object.assign(window, { shareWorkers: workers });
    window.Worker = class extends NativeWorker {
      private counted: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.counted = String(url).includes("duckdb-browser");
        if (this.counted) workers.active++;
      }
      override terminate() {
        if (this.counted) {
          workers.active--;
          this.counted = false;
        }
        super.terminate();
      }
    };
  });
  const activeWorkers = () =>
    page.evaluate(() => (window as unknown as { shareWorkers: { active: number } }).shareWorkers.active);
  let finishImage!: () => void;
  await page.route("**/hold-viewer-load.png", async (route) => {
    await new Promise<void>((resolve) => {
      finishImage = resolve;
    });
    await route.fulfill({ status: 204 });
  });
  await openShare(page, {
    "index.html": html(`
      window.heldConnection = await w.duckdb.connect();
      await window.heldConnection.query('CREATE TEMP TABLE held AS SELECT 7 AS n');
      out.textContent = 'ready';
    `).replace("<body>", '<body><img src="/hold-viewer-load.png">'),
    "static.html": "<!doctype html><html><head></head><body>Static page</body></html>",
  });
  const out = page.frameLocator("iframe").locator("#out");
  await expect(out).toHaveText("ready");
  finishImage();
  await page.unroute("**/hold-viewer-load.png");
  await page.route("**/hold-viewer-load.png", (route) => route.fulfill({ status: 204 }));
  const frame = page.frames().find((f) => f.url().includes(`${root}/files/`))!;
  await frame.waitForLoadState("load");
  const heldValue = () =>
    frame.evaluate(async () => {
      const connection = (
        window as unknown as { heldConnection: { query(sql: string): Promise<{ rows: { n: number }[] }> } }
      ).heldConnection;
      return (await connection.query("SELECT n FROM held")).rows[0].n;
    });
  expect(await heldValue()).toBe(7);
  expect(await activeWorkers()).toBe(1);
  await frame.goto(`${root}/files/static.html`);
  await expect.poll(activeWorkers).toBe(0);

  await frame.goto(`${root}/files/index.html`);
  await expect(out).toHaveText("ready");
  expect(await heldValue()).toBe(7);
  await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect.poll(activeWorkers).toBe(0);
  const restored = await frame.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    const w = (window as unknown as { wingman: { duckdb: { query(sql: string): Promise<{ rows: { n: number }[] }> } } })
      .wingman;
    return (await w.duckdb.query("SELECT 9 AS n")).rows[0].n;
  });
  expect(restored).toBe(9);
  expect(await activeWorkers()).toBe(1);
});
