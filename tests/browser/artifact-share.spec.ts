import { expect, test, type Page, type Request } from "@playwright/test";
import JSZip from "jszip";

async function openFixture(page: Page, share: { retentionDays?: number; maxSize?: number } | undefined) {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { artifacts: share ? { share } : {}, models: [] } }),
  );
  await page.goto("/tests/browser/fixtures/artifacts.html");
  await page.waitForFunction(() => window.artifactsE2E?.state().ready);
  const id = await page.evaluate(() => window.artifactsE2E.ensureChat());
  await expect.poll(() => page.evaluate(() => window.artifactsE2E.state().fsChatId)).toBe(id);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  return id;
}

async function writeWorkspace(page: Page, id: string) {
  await page.evaluate(async (id) => {
    await window.artifactsE2E.write(id, "/notes.md", "# Notes");
    await window.artifactsE2E.write(id, "/data/rows.json", '[{"region":"EU"}]');
    // Written last, so the drawer opens it and the share starts there.
    await window.artifactsE2E.write(
      id,
      "/reports/deck.html",
      '<!doctype html><html><body><script src="/.lib/three.js"></script><p>Deck</p></body></html>',
    );
  }, id);
}

test("publishes the workspace without library bytes and shows the link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await openFixture(page, { retentionDays: 3, maxSize: 1 << 20 });
  await writeWorkspace(page, id);

  const uploads: Request[] = [];
  await page.route(
    (url) => url.pathname === "/artifacts",
    (route) => {
      uploads.push(route.request());
      return route.fulfill({
        status: 201,
        json: { id: "abc", url: "/artifacts/abc", entry: "reports/deck.html", expiresAt: "2026-10-25T12:00:00Z" },
      });
    },
  );

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Publishes all 3 files")).toBeVisible();
  await expect(page.getByText("deck.html", { exact: true })).toBeVisible();
  await expect(page.getByText("view it for 3 days")).toBeVisible();

  await page.getByRole("button", { name: "Create link" }).click();
  const link = page.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(new URL("/artifacts/abc", page.url()).href);
  await expect(page.getByText(/^Expires /)).toBeVisible();

  expect(uploads).toHaveLength(1);
  const upload = uploads[0];
  expect(upload.method()).toBe("POST");
  expect(upload.headers()["content-type"]).toBe("application/zip");
  expect(new URL(upload.url()).searchParams.get("entry")).toBe("reports/deck.html");

  // The folder export: relative library references, every workspace file, no library copies.
  const zip = await JSZip.loadAsync(upload.postDataBuffer()!);
  const names = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  expect(names).toEqual(["data/rows.json", "notes.md", "reports/deck.html"]);
  expect(await zip.file("reports/deck.html")!.async("string")).toContain('<script src="../.lib/three.js"></script>');

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL("/artifacts/abc", page.url()).href);
  await expect(page.getByRole("link", { name: "Open shared page" })).toHaveAttribute(
    "href",
    new URL("/artifacts/abc", page.url()).href,
  );
});

test("shows why the server rejected the upload", async ({ page }) => {
  const id = await openFixture(page, { retentionDays: 7, maxSize: 1 << 20 });
  await writeWorkspace(page, id);
  await page.route(
    (url) => url.pathname === "/artifacts",
    (route) =>
      route.fulfill({
        status: 413,
        contentType: "text/plain; charset=utf-8",
        body: "the workspace exceeds the share size limit\n",
      }),
  );

  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("The workspace exceeds the share size limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create link" })).toBeEnabled();
});

test("blocks workspaces over the size limit before uploading", async ({ page }) => {
  const id = await openFixture(page, { maxSize: 16 });
  await writeWorkspace(page, id);

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(/larger than the 16 B sharing limit/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create link" })).toBeDisabled();
});

test("offers sharing only with a page to open and a server that stores shares", async ({ page }) => {
  let id = await openFixture(page, { retentionDays: 7 });
  await page.evaluate((id) => window.artifactsE2E.write(id, "/notes.md", "# Notes"), id);
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);

  id = await openFixture(page, undefined);
  await writeWorkspace(page, id);
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
});
