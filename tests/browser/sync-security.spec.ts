import { expect, test, type Page } from "@playwright/test";

async function expectStableSyncHeight(page: Page) {
  const card = page.getByRole("region", { name: "Online backup", exact: true });
  const button = card.getByRole("button", { name: "Sync now", exact: true });
  const originalViewport = page.viewportSize()!;
  for (const width of [1280, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(button).toBeEnabled();
    const before = (await card.boundingBox())!.height;
    await button.click();
    await expect(button).toBeDisabled();
    await expect(card.getByText("Backing up changes", { exact: true })).toBeVisible();
    expect((await card.boundingBox())!.height).toBe(before);
    await expect(button).toBeEnabled();
    expect((await card.boundingBox())!.height).toBe(before);
  }
  await page.setViewportSize(originalViewport);
}

// Exercise upload-only sessions separately from the UI action that stops all sync.
async function enterUploadOnlyMode(page: Page) {
  await page.evaluate(() => window.syncSecurityE2E.forgetUnlock());
  await page.reload();
  await expect(page.getByText("Backup is running", { exact: true })).toBeVisible();
}

test("PIN and passkey protection survive reload and permit PIN changes", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Virtual PRF authenticator requires Chromium CDP");
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  let stored: Record<string, unknown> | null = null;
  let revision = 0;
  let rejectNextUpdate = false;
  const files = new Map<string, { bytes: Buffer; etag: string }>();
  let fileDownloads = 0;
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [...files].map(([id, entry]) => ({
          id,
          etag: entry.etag,
          size: entry.bytes.length,
          updated: new Date().toISOString(),
        })),
      });
    if (path.includes("/files/")) {
      const id = path.split("/").at(-1)!;
      if (request.method() === "PUT") {
        const etag = String(Date.now());
        files.set(id, { bytes: request.postDataBuffer()!, etag });
        return route.fulfill({ status: 204, headers: { ETag: `"${etag}"` } });
      }
      fileDownloads++;
      const entry = files.get(id);
      return entry
        ? route.fulfill({ body: entry.bytes, headers: { ETag: `"${entry.etag}"` } })
        : route.fulfill({ status: 404 });
    }
    if (!path.endsWith("/keystore")) return route.fulfill({ json: [] });
    if (request.method() === "GET") {
      return stored
        ? route.fulfill({ json: stored, headers: { ETag: `"${revision}"` } })
        : route.fulfill({ status: 404 });
    }
    if (rejectNextUpdate) {
      rejectNextUpdate = false;
      return route.fulfill({ status: 412, body: "Keystore changed on another device" });
    }
    const ifMatch = request.headers()["if-match"];
    if (ifMatch && ifMatch !== `"${revision}"`) return route.fulfill({ status: 412 });
    stored = request.postDataJSON();
    revision++;
    return route.fulfill({ status: 204, headers: { ETag: `"${revision}"` } });
  });
  await page.goto("http://localhost:4175/tests/browser/fixtures/sync-security.html");
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  await expect(page.getByText("Your data is saved only in this browser.", { exact: false })).toBeVisible();
  expect(stored).toBeNull();
  expect(files.size).toBe(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.getByRole("form", { name: "Create your backup PIN", exact: true })).toBeVisible();
  await expect(page.getByText("Backup is off", { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toContainText("Create PIN");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText("Create PIN");
  await expect(page.getByText("Backup is off", { exact: true })).toHaveCount(0);
  expect(stored).toBeNull();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Create passkey", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Backup options", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await expect(page.getByText("Protection", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Restore access", { exact: true })).toHaveCount(0);
  expect(stored).toMatchObject({ passkeyProtected: true });
  expect(stored).not.toHaveProperty("dek");
  await expect(page.getByRole("button", { name: /Remove.*(PIN|passkey)/ })).toHaveCount(0);
  await expectStableSyncHeight(page);
  const peer = await context.newPage();
  await peer.goto("http://localhost:4175/tests/browser/fixtures/sync-security.html");
  await expect(peer.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Backup options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Deactivate backup", exact: true }).click();
  for (const tab of [page, peer]) {
    await expect(tab.getByRole("button", { name: "Turn on backup", exact: true })).toHaveCount(0);
    await expect(tab.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true })).toBeVisible();
    expect(await tab.evaluate(() => window.syncSecurityE2E.sessionStatus())).toBe("locked");
    expect(await tab.evaluate(() => window.syncSecurityE2E.uploadCache())).toBeUndefined();
  }
  await page.evaluate(() => window.syncSecurityE2E.save("chats/stopped/artifacts/local.txt", "kept locally"));
  await page.waitForTimeout(2200);
  expect(files.size).toBe(0);
  expect(await page.evaluate(() => window.syncSecurityE2E.read("chats/stopped/artifacts/local.txt"))).toBe(
    "kept locally",
  );
  // Remove the probe before continuing the existing upload-count assertions.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("chats", { recursive: true });
  });
  await peer.close();
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Backup options", exact: true })).toBeVisible();
  await enterUploadOnlyMode(page);
  await page.reload();
  await expect(page.getByText("Backup is running", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true })).toBeVisible();
  await expectStableSyncHeight(page);
  await page.evaluate(() => window.syncSecurityE2E.save("agents/upload-test/AGENTS.md", "automatically uploaded"));
  await expect.poll(() => files.size).toBe(1);
  expect([...files.values()][0].bytes[0]).toBe(3);
  expect(fileDownloads).toBe(0);
  expect(Object.keys((await page.evaluate(() => window.syncSecurityE2E.uploadCache())) as object).sort()).toEqual([
    "kid",
    "publicKey",
    "userId",
  ]);
  // Simulate a new browser with no local data or trusted public-key cache.
  await page.evaluate(() => window.syncSecurityE2E.clear());
  await page.reload();
  await expect(page.getByText("Ready to restore", { exact: true })).toBeVisible();
  expect(fileDownloads).toBe(0);
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.syncSecurityE2E.read("agents/upload-test/AGENTS.md")))
    .toBe("automatically uploaded");
  expect(fileDownloads).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.syncSecurityE2E.sessionStatus())).toBe("ready");
  rejectNextUpdate = true;
  await page.getByRole("button", { name: "Replace passkey", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("412");
  await page.reload();
  await expect(page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/ })).toHaveCount(0);
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Replace passkey", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace passkey", exact: true })).toBeEnabled();
  // Replacement enrollment must not overwrite the original credential before its keystore commit.
  const credentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials.credentials).toHaveLength(3);
  await page.getByRole("button", { name: "Change PIN", exact: true }).click();
  await page.getByLabel("Current PIN", { exact: true }).fill("12345678");
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm new PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace passkey", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change PIN", exact: true }).click();
  await expect(page.getByLabel("Current PIN", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(stored).toMatchObject({ pinProtected: true, passkeyProtected: true });
  expect(stored).toHaveProperty("passkey");
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await enterUploadOnlyMode(page);
  await page.reload();
  await expect(page.getByLabel("PIN", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Use PIN instead", exact: true }).click();
  await expect(page.getByLabel("PIN", { exact: true })).toBeFocused();
  await page.getByLabel("PIN", { exact: true }).fill("not-saved");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("PIN", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Use PIN instead", exact: true }).click();
  await expect(page.getByLabel("PIN", { exact: true })).toHaveValue("");
  await page.getByLabel("PIN", { exact: true }).fill("wrong-pin");
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Incorrect PIN. Please try again.");
  await page.getByLabel("PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
});

test("initialization failures show the backend error", async ({ page }) => {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 401, body: "unauthorized" }));
  await page.goto("/tests/browser/fixtures/sync-security.html");
  await expect(page.getByText("401: unauthorized", { exact: true })).toBeVisible();
});

test("new backups stay local until PIN protection is configured", async ({ page }) => {
  let key: Record<string, unknown> | null = null;
  const writes: Record<string, unknown>[] = [];
  let uploads = 0;
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/keystore")) {
      if (request.method() === "GET")
        return key
          ? route.fulfill({ json: key, headers: { ETag: `"${writes.length}"` } })
          : route.fulfill({ status: 404 });
      const next = request.postDataJSON() as Record<string, unknown>;
      expect(next.pinProtected).toBe(true);
      expect(next).not.toHaveProperty("dek");
      if (!key) expect(request.headers()["if-none-match"]).toBe("*");
      key = next;
      writes.push(next);
      return route.fulfill({ status: 204, headers: { ETag: `"${writes.length}"` } });
    }
    if (request.method() === "PUT" && path.includes("/files/")) {
      expect(key?.pinProtected).toBe(true);
      uploads++;
      return route.fulfill({ status: 204, headers: { ETag: '"file"' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:4175/tests/browser/fixtures/sync-security.html");
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  await page.evaluate(() => window.syncSecurityE2E.save("agents/local/AGENTS.md", "saved before setup"));
  await page.reload();
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText("Create PIN");
  await expect(page.getByText("Backup is off", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect.poll(() => uploads).toBe(1);
  await expect(page.getByRole("button", { name: "Remove PIN", exact: true })).toHaveCount(0);
});

test("PIN setup recovers when protection saves but backup key provisioning fails", async ({ page }) => {
  let key: Record<string, unknown> | null = null;
  let revision = 0;
  let failProvisioning = true;
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (!path.endsWith("/keystore")) return route.fulfill({ json: [] });
    if (request.method() === "GET")
      return key ? route.fulfill({ json: key, headers: { ETag: `"${revision}"` } }) : route.fulfill({ status: 404 });
    const next = request.postDataJSON() as Record<string, unknown>;
    if (next.backup && failProvisioning) {
      failProvisioning = false;
      return route.fulfill({ status: 500, body: "Temporary provisioning failure" });
    }
    if (key) expect(request.headers()["if-match"]).toBe(`"${revision}"`);
    key = next;
    revision++;
    return route.fulfill({ status: 204, headers: { ETag: `"${revision}"` } });
  });
  await page.goto("http://localhost:4175/tests/browser/fixtures/sync-security.html");
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await expect(page.getByText("Ready to restore", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PIN", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await page.getByLabel("PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  expect(revision).toBe(2);
});

test("reset confirms deletion, keeps local files, resets other tabs, and permits fresh backups", async ({
  page,
  context,
}) => {
  let key: Record<string, unknown> | null = null;
  let revision = 0;
  let resets = 0;
  let uploads = 0;
  const files = new Map<string, { bytes: Buffer; etag: string }>();
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await context.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/backup") && request.method() === "DELETE") {
      expect(request.headers()["x-confirm-backup-reset"]).toBe("true");
      resets++;
      key = null;
      files.clear();
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/keystore")) {
      if (request.method() === "GET")
        return key ? route.fulfill({ json: key, headers: { ETag: `"${revision}"` } }) : route.fulfill({ status: 404 });
      key = request.postDataJSON();
      revision++;
      return route.fulfill({ status: 204, headers: { ETag: `"${revision}"` } });
    }
    if (request.method() === "PUT" && path.includes("/files/")) {
      expect(key?.backup).toBeTruthy();
      expect(request.headers()["x-backup-key"]).toBeUndefined();
      uploads++;
      files.set(path, { bytes: request.postDataBuffer()!, etag: String(uploads) });
      return route.fulfill({ status: 204, headers: { ETag: `"${uploads}"` } });
    }
    return route.fulfill({ json: [] });
  });
  const fixture = "/tests/browser/fixtures/sync-security.html";
  await page.goto(fixture);
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await enterUploadOnlyMode(page);
  const originalPublicKey = (key!.backup as { publicKey: string }).publicKey;
  await page.evaluate(() => window.syncSecurityE2E.save("agents/keep/AGENTS.md", "keep me"));
  await expect.poll(() => uploads).toBe(1);
  await page.reload();
  await expect(page.getByText("Backup is running", { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto(fixture);
  await expect(other.getByText("Backup is running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Danger zone", exact: true }).click();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Local chats and files stay on this browser");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(resets).toBe(0);
  expect(key).not.toBeNull();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).click();
  await page.getByRole("button", { name: "Delete online backup and reset", exact: true }).click();
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  await expect(other.getByText("Backup is off", { exact: true })).toBeVisible();
  expect(resets).toBe(1);
  expect(key).toBeNull();
  expect(files.size).toBe(0);
  expect(await page.evaluate(() => window.syncSecurityE2E.uploadCache())).toBeUndefined();
  expect(await page.evaluate(() => window.syncSecurityE2E.read("agents/keep/AGENTS.md"))).toBe("keep me");
  await other.close();
  await page.reload();
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  expect(uploads).toBe(1);
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill("87654321");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("87654321");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect.poll(() => uploads).toBe(2);
  expect((key!.backup as { publicKey: string }).publicKey).not.toBe(originalPublicKey);
});

test("a failed reset preserves local data and retries on reload", async ({ page }) => {
  let fail = true;
  let resets = 0;
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/backup")) {
      resets++;
      return fail ? route.fulfill({ status: 500, body: "Reset unavailable" }) : route.fulfill({ status: 204 });
    }
    if (path.endsWith("/keystore")) return route.fulfill({ status: 404 });
    return route.fulfill({ json: [] });
  });
  await page.goto("/tests/browser/fixtures/sync-security.html");
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  await page.evaluate(() => window.syncSecurityE2E.save("agents/keep/AGENTS.md", "keep me"));
  await page.getByRole("button", { name: "Danger zone", exact: true }).click();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).click();
  await page.getByRole("button", { name: "Delete online backup and reset", exact: true }).click();
  await page.getByText("Error details", { exact: true }).click();
  await expect(page.getByText("500: Reset unavailable", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.syncSecurityE2E.read("agents/keep/AGENTS.md"))).toBe("keep me");
  fail = false;
  await page.reload();
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  expect(resets).toBe(2);
  expect(await page.evaluate(() => window.syncSecurityE2E.read("agents/keep/AGENTS.md"))).toBe("keep me");
});

test("reset waits for a peer upload's local writes and fences the stale tab afterward", async ({ page, context }) => {
  let key: Record<string, unknown> | null = null;
  let revision = 0;
  let resets = 0;
  let appends = 0;
  let releaseAppend!: () => void;
  const appendHeld = new Promise<void>((resolve) => {
    releaseAppend = resolve;
  });
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/backup")) {
      resets++;
      key = null;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/keystore")) {
      if (request.method() === "GET")
        return key ? route.fulfill({ json: key, headers: { ETag: `"${revision}"` } }) : route.fulfill({ status: 404 });
      key = request.postDataJSON();
      revision++;
      return route.fulfill({ status: 204, headers: { ETag: `"${revision}"` } });
    }
    if (request.method() === "POST" && path.endsWith("/events")) {
      appends++;
      await appendHeld;
      return route.fulfill({ json: { newSeq: request.postData()!.split("\n").length } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/tests/browser/fixtures/sync-security.html");
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await enterUploadOnlyMode(page);
  const peer = await context.newPage();
  // Simulate a tab whose reset notification is delayed/suppressed. Correctness
  // must come from the storage gate and generation, not the reload notification.
  await peer.addInitScript(() =>
    window.addEventListener("storage", (event) => {
      if (event.key === "wingman:backup-reset" || event.key === "wingman:backup-generation")
        event.stopImmediatePropagation();
    }),
  );
  await peer.goto("/tests/browser/fixtures/sync-security.html");
  await expect(peer.getByText("Backup is running", { exact: true })).toBeVisible();
  await peer.evaluate(() => window.syncSecurityE2E.saveChat("retained during reset"));
  await expect.poll(() => appends).toBe(1);
  await page.getByRole("button", { name: "Danger zone", exact: true }).click();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).click();
  await page.getByRole("button", { name: "Delete online backup and reset", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.locks.query()).pending?.some(
          (lock) => lock.name === "wingman:backup-reset" && lock.mode === "exclusive",
        ),
      ),
    )
    .toBe(true);
  expect(resets).toBe(0);
  releaseAppend();
  await expect(page.getByText("Backup is off", { exact: true })).toBeVisible();
  expect(resets).toBe(1);
  expect(JSON.stringify(await page.evaluate(() => window.syncSecurityE2E.readChat()))).toContain(
    "retained during reset",
  );
  expect(await page.evaluate(() => window.syncSecurityE2E.read("chats/reset-chat/history.jsonl"))).toBeUndefined();
  expect(await page.evaluate(() => window.syncSecurityE2E.read("_sync/state.json"))).toBeUndefined();
  await peer.evaluate(() => window.syncSecurityE2E.saveChat("new local edit from stale tab"));
  expect(JSON.stringify(await page.evaluate(() => window.syncSecurityE2E.readChat()))).toContain(
    "new local edit from stale tab",
  );
  expect(appends).toBe(1);
  expect(await page.evaluate(() => window.syncSecurityE2E.read("_sync/state.json"))).toBeUndefined();
});

test("PIN setup validates before sending data when passkeys are unavailable", async ({ page }) => {
  let writes = 0;
  await page.setViewportSize({ width: 375, height: 850 });
  await page.addInitScript(() => Object.defineProperty(window, "PublicKeyCredential", { value: undefined }));
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") writes++;
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/keystore")) return route.fulfill({ status: 404 });
    return route.fulfill({ json: [] });
  });
  await page.goto("/tests/browser/fixtures/sync-security.html");
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.getByRole("list", { name: "Backup setup progress" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("New PIN", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("at least 8 characters");
  await page.getByLabel("New PIN", { exact: true }).fill("123");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("at least 8 characters");
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("87654321");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("PINs do not match");
  expect(writes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Turn on backup", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("New PIN", { exact: true })).toHaveValue("");
});

test("danger zone stays at the bottom and scrolls with the whole section in short views", async ({ page }) => {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "alice" } });
    if (path.endsWith("/keystore")) return route.fulfill({ status: 404 });
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/tests/browser/fixtures/sync-security.html");
  const danger = page.getByRole("region", { name: "Danger zone" });
  await expect(danger).toBeVisible();
  const fullView = await page.getByRole("main").boundingBox();
  const dangerBox = await danger.boundingBox();
  expect(Math.abs(dangerBox!.y + dangerBox!.height - (fullView!.y + fullView!.height - 24))).toBeLessThan(2);
  await page.setViewportSize({ width: 375, height: 420 });
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  const setup = await page.getByRole("form", { name: "Create your backup PIN" }).boundingBox();
  const shortViewDanger = await danger.boundingBox();
  expect(shortViewDanger!.y).toBeGreaterThanOrEqual(setup!.y + setup!.height + 16);
  await expect(page.getByRole("button", { name: "Reset online backup", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Danger zone", exact: true }).click();
  await page.getByRole("button", { name: "Reset online backup", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Reset online backup", exact: true })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Online backup", exact: true })).not.toBeInViewport();
});

test("remembered PIN devices resume sync and reject changed account or backup protection", async ({
  page,
}, testInfo) => {
  let userId = "alice";
  let stored: Record<string, unknown> | null = null;
  let revision = 0;
  let chatPulls = 0;
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { id: userId } });
    if (path.endsWith("/keystore")) {
      if (request.method() === "GET")
        return stored
          ? route.fulfill({ json: stored, headers: { ETag: `"${revision}"` } })
          : route.fulfill({ status: 404 });
      stored = request.postDataJSON();
      revision++;
      return route.fulfill({ status: 204, headers: { ETag: `"${revision}"` } });
    }
    if (path.endsWith("/chats")) chatPulls++;
    return route.fulfill({ json: [] });
  });
  await page.goto("/tests/browser/fixtures/sync-security.html");
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByLabel("New PIN", { exact: true }).fill("12345678");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("remembered-device.png"), animations: "disabled" });
  const beforeReload = chatPulls;
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect.poll(() => chatPulls).toBeGreaterThan(beforeReload);
  await expect(page.getByRole("button", { name: "Unlock backup", exact: true })).toHaveCount(0);
  // The remembered root key is stored as a non-extractable CryptoKey, never as readable bytes.
  const device = await page.evaluate(
    () =>
      new Promise<{ fields: string[]; extractable: boolean; exportable: boolean }>((resolve, reject) => {
        const open = indexedDB.open("wingman-backup-device", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction("keys").objectStore("keys").get("device");
          get.onerror = () => reject(get.error);
          get.onsuccess = async () => {
            const key = get.result.key as CryptoKey;
            const exportable = await crypto.subtle.exportKey("raw", key).then(
              () => true,
              () => false,
            );
            open.result.close();
            resolve({ fields: Object.keys(get.result).sort(), extractable: key.extractable, exportable });
          };
        };
      }),
  );
  expect(device).toEqual({ fields: ["key", "kid", "protection", "userId"], extractable: false, exportable: false });

  await page.getByRole("button", { name: "Change PIN", exact: true }).click();
  await page.getByLabel("Current PIN", { exact: true }).fill("12345678");
  await page.getByLabel("New PIN", { exact: true }).fill("87654321");
  await page.getByLabel("Confirm new PIN", { exact: true }).fill("87654321");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Current PIN", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  // Deactivating backup persists across reload, keeps protection on the server,
  // and requires a successful PIN unlock before backup resumes.
  const protectionBeforeStop = structuredClone(stored!);
  await page.getByRole("button", { name: "Backup options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Deactivate backup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Backup options", exact: true })).toHaveCount(0);
  expect(stored).toEqual(protectionBeforeStop);
  await page.reload();
  await expect(page.getByRole("button", { name: "Backup options", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByRole("button", { name: "Backup options", exact: true })).toHaveCount(0);
  await page.getByLabel("PIN", { exact: true }).fill("87654321");
  await page.getByRole("button", { name: /^(Unlock backup|Restore backup)$/, exact: true }).click();
  await expect(page.getByRole("button", { name: "Backup options", exact: true })).toBeVisible();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();

  // A different server protection record requires another explicit unlock.
  const original = structuredClone(stored!);
  stored = { ...original, nonce: "different-protection" };
  const beforeProtectionChange = chatPulls;
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock backup", exact: true })).toBeVisible();
  expect(chatPulls).toBe(beforeProtectionChange);
  stored = original;
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock backup", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unlock backup", exact: true }).click();
  await page.getByLabel("PIN", { exact: true }).fill("87654321");
  await page.getByRole("button", { name: "Unlock backup", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();

  // Even an identical keystore must never unlock for another signed-in account.
  userId = "bob";
  const beforeAccountChange = chatPulls;
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.syncSecurityE2E.sessionStatus())).toBe("error");
  await expect(page.getByText(/another account.s local workspace/)).toBeVisible();
  expect(chatPulls).toBe(beforeAccountChange);
  userId = "alice";
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await page.evaluate(() => window.syncSecurityE2E.clear());
  await page.reload();
  await expect(page.getByRole("button", { name: "Restore backup", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("restore-new-device.png"), animations: "disabled" });
});
