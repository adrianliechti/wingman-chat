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

test("keeps the link while the popover is closed and stops sharing on request", async ({ page }) => {
  const id = await openFixture(page, { retentionDays: 7, maxSize: 1 << 20 });
  await writeWorkspace(page, id);

  const requests: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/artifacts"),
    (route) => {
      const request = route.request();
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      if (request.method() === "DELETE") return route.fulfill({ status: 204 });
      return route.fulfill({
        status: 201,
        json: {
          id: "abc",
          url: "/artifacts/abc",
          entry: "reports/deck.html",
          expiresAt: "2099-01-01T00:00:00Z",
          revocable: true,
        },
      });
    },
  );

  const share = page.getByRole("button", { name: "Share", exact: true });
  const link = page.getByRole("textbox", { name: "Share link" });
  const create = page.getByRole("button", { name: "Create link" });

  await share.click();
  await create.click();
  await expect(link).toHaveValue(/\/artifacts\/abc$/);

  // The share stays live on the server, so closing the popover must not lose its link.
  await share.click();
  await expect(link).toBeHidden();
  await share.click();
  await expect(link).toHaveValue(/\/artifacts\/abc$/);
  await expect(create).toHaveCount(0);
  expect(requests).toEqual(["POST /artifacts"]);

  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(create).toBeVisible();
  expect(requests).toEqual(["POST /artifacts", "DELETE /artifacts/abc"]);

  await share.click();
  await expect(create).toBeHidden();
  await share.click();
  await expect(create).toBeVisible();
  await expect(link).toHaveCount(0);
});

test("offers no way to stop a share the server cannot attribute", async ({ page }) => {
  const id = await openFixture(page, { retentionDays: 7, maxSize: 1 << 20 });
  await writeWorkspace(page, id);
  await page.route(
    (url) => url.pathname === "/artifacts",
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          id: "abc",
          url: "/artifacts/abc",
          entry: "reports/deck.html",
          expiresAt: "2099-01-01T00:00:00Z",
          revocable: false,
        },
      }),
  );

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("textbox", { name: "Share link" })).toHaveValue(/\/artifacts\/abc$/);
  await expect(page.getByRole("button", { name: "Create new link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop sharing" })).toHaveCount(0);
});

test("names the files it publishes and waits for unsaved edits", async ({ page }) => {
  const id = await openFixture(page, { retentionDays: 7, maxSize: 1 << 20 });
  await page.evaluate(async (id) => {
    await window.artifactsE2E.write(id, "/index.html", "<!doctype html><p>Page</p>");
    // An upload that sharing would publish along with the page.
    await window.artifactsE2E.write(id, "/uploads/contract.txt", "confidential\n");
    window.artifactsE2E.openFile("/uploads/contract.txt");
  }, id);

  const share = page.getByRole("button", { name: "Share", exact: true });
  const create = page.getByRole("button", { name: "Create link" });
  const text = page.getByRole("textbox", { name: "Text" });
  await expect(text).toHaveValue("confidential\n");

  await share.click();
  const published = page.getByRole("list", { name: "Files that will be published" }).getByRole("listitem");
  await expect(published).toHaveCount(2);
  await expect(published.filter({ hasText: "uploads/contract.txt" })).toBeVisible();
  await expect(published.filter({ hasText: "index.html" })).toBeVisible();
  await expect(create).toBeEnabled();
  await share.click();
  await expect(create).toBeHidden();

  // The upload reads saved files; an edit still open in the editor would be left out.
  await text.pressSequentially("draft ");
  await share.click();
  await expect(page.getByText("Save or discard your changes to contract.txt first")).toBeVisible();
  await expect(create).toBeDisabled();
  await share.click();
  await expect(create).toBeHidden();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await share.click();
  await expect(create).toBeEnabled();
  await expect(page.getByText("Save or discard your changes")).toHaveCount(0);
});
