import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { test as backupTest } from "./helpers/backup-server";

// Real browser WebAuthn/PRF and production backup routes. The virtual
// authenticator approves requests automatically; it cannot count OS dialogs.
const test = backupTest.extend<{
  ceremonies: string[];
  creationPrf: boolean;
  backupUser: string;
  passkeysAvailable: boolean;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  backupUser: async ({}, use) => use(randomUUID()),
  creationPrf: [true, { option: true }],
  passkeysAvailable: [true, { option: true }],
  ceremonies: [
    async ({ page, context, browserName }, use) => {
      test.skip(browserName !== "chromium", "Virtual PRF authenticator requires Chromium CDP");
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      const ceremonies: string[] = [];
      cdp.on("WebAuthn.credentialAdded", () => ceremonies.push("create"));
      cdp.on("WebAuthn.credentialAsserted", () => ceremonies.push("get"));
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
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
      await use(ceremonies);
      await cdp.detach();
    },
    { auto: true },
  ],
});
test.use({ actionTimeout: 30_000 });

async function connect(context: BrowserContext, backupServer: string, user: string) {
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const response = await route.fetch({
      url: `${backupServer}${new URL(request.url()).pathname}${new URL(request.url()).search}`,
      headers: { ...request.headers(), "X-Forwarded-User": user },
    });
    await route.fulfill({ response });
  });
}

test.beforeEach(async ({ page, context, backupServer, creationPrf, backupUser, passkeysAvailable }) => {
  if (!passkeysAvailable) {
    await page.addInitScript(() => Object.defineProperty(window, "PublicKeyCredential", { value: undefined }));
  }
  if (!creationPrf) {
    // Simulate a provider that enables PRF at creation but only returns output on get.
    await page.addInitScript(() => {
      const create = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create = async (options) => {
        const credential = await create(options);
        if (credential instanceof PublicKeyCredential) {
          const extensions = credential.getClientExtensionResults();
          credential.getClientExtensionResults = () => ({ ...extensions, prf: { enabled: true } });
        }
        return credential;
      };
    });
  }
  await connect(context, backupServer, backupUser);
  // WebAuthn requires a domain RP ID; the default 127.0.0.1 is invalid.
  await page.goto("http://localhost:4175/tests/browser/fixtures/sync-security.html");
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await setPin(page, "Create PIN");
});

async function setPin(page: Page, button: string) {
  await page.getByLabel("New PIN", { exact: true }).fill("recovery-123456");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("recovery-123456");
  await page.getByRole("button", { name: button, exact: true }).click();
  if (button === "Create PIN") {
    await expect(page.getByRole("heading", { name: "Create your passkey", exact: true })).toBeVisible();
  } else await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
}

test("a remembered PIN device confirms the PIN before adding a passkey", async ({
  page,
  backupServer,
  backupUser,
  ceremonies,
}) => {
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  const keystore = await (
    await page.request.get(`${backupServer}/api/v1/keystore`, { headers: { "X-Forwarded-User": backupUser } })
  ).json();
  expect(keystore.kdf).toMatchObject({ name: "argon2id", m: 65536, t: 3, p: 1 });

  // After reload only the non-extractable device key remains, so adding a method needs the PIN.
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByRole("form", { name: "Confirm your PIN", exact: true })).toBeVisible();
  await page.getByLabel("PIN", { exact: true }).fill("wrong-pin");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Incorrect PIN. Please try again.");
  await page.getByLabel("PIN", { exact: true }).fill("recovery-123456");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Two ways to unlock your backup", exact: true })).toBeVisible();

  // Replacing the passkey later re-authenticates through the existing passkey instead.
  await page.reload();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
  const before = ceremonies.length;
  await page.getByRole("button", { name: "Replace passkey", exact: true }).click();
  await expect.poll(() => ceremonies.slice(before)).toEqual(expect.arrayContaining(["get", "create"]));
  await expect(page.getByRole("button", { name: "Replace passkey", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const enrollment of ["during setup", "after skipping"]) {
  test(`adding a passkey ${enrollment} preserves both methods and either can restore encrypted data`, async ({
    page,
    context,
    backupServer,
    backupUser,
  }) => {
    if (enrollment === "during setup") {
      await page.getByRole("button", { name: "Create passkey", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Skip for now", exact: true }).click();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
      await page.evaluate(() => {
        const create = navigator.credentials.create.bind(navigator.credentials);
        navigator.credentials.create = async () => {
          navigator.credentials.create = create;
          throw new DOMException("Cancelled", "NotAllowedError");
        };
      });
      await page.getByRole("button", { name: "Add passkey", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Cancelled");
      await page.getByRole("button", { name: "Add passkey", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Two ways to unlock your backup", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({ path: test.info().outputPath("both-recovery-methods-mobile.png"), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(async () => {
      await window.syncSecurityE2E.save("agents/recovery/AGENTS.md", "restored with either method");
      await window.syncSecurityE2E.saveChat("dual recovery chat");
    });
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();

    // A fresh browser with no passkey authenticator must restore through the PIN.
    const device = await context.browser()!.newContext();
    try {
      await connect(device, backupServer, backupUser);
      const fresh = await device.newPage();
      if (enrollment === "during setup") {
        await fresh.addInitScript(() => Object.defineProperty(window, "PublicKeyCredential", { value: undefined }));
      }
      await fresh.goto("http://localhost:4175/tests/browser/fixtures/sync-security.html");
      await fresh.getByRole("button", { name: "Use PIN instead", exact: true }).click();
      await fresh.getByLabel("PIN", { exact: true }).fill("wrong-pin");
      await fresh.getByRole("button", { name: "Restore backup", exact: true }).click();
      await expect(fresh.getByRole("alert")).toHaveText("Incorrect PIN. Please try again.");
      await fresh.getByLabel("PIN", { exact: true }).fill("recovery-123456");
      await fresh.getByRole("button", { name: "Restore backup", exact: true }).click();
      await expect(fresh.getByText("Everything looks fine", { exact: true })).toBeVisible();
      await expect
        .poll(() => fresh.evaluate(() => window.syncSecurityE2E.read("agents/recovery/AGENTS.md")))
        .toBe("restored with either method");
      await expect
        .poll(() => fresh.evaluate(() => window.syncSecurityE2E.readChat()).then(JSON.stringify))
        .toContain("dual recovery chat");
    } finally {
      await device.close();
    }

    await page.evaluate(async () => {
      await window.syncSecurityE2E.forgetUnlock();
      await window.syncSecurityE2E.clear();
    });
    await page.reload();
    // Cancellation leaves the PIN fallback visible, and passkey retry still works.
    await page.evaluate(() => {
      const get = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.get = async () => {
        navigator.credentials.get = get;
        throw new DOMException("Cancelled", "NotAllowedError");
      };
    });
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Cancelled");
    await expect(page.getByRole("button", { name: "Use PIN instead", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.syncSecurityE2E.read("agents/recovery/AGENTS.md")))
      .toBe("restored with either method");
    await expect
      .poll(() => page.evaluate(() => window.syncSecurityE2E.readChat()).then(JSON.stringify))
      .toContain("dual recovery chat");
  });
}

for (const reason of ["unavailable", "cancelled"]) {
  test.describe(reason, () => {
    test.use({ passkeysAvailable: reason !== "unavailable" });
    test("skipping the passkey keeps PIN recovery working", async ({ page, ceremonies }) => {
      if (reason === "unavailable") {
        await expect(page.getByRole("button", { name: "Create passkey", exact: true })).toBeDisabled();
      } else {
        await page.evaluate(() => {
          navigator.credentials.create = async () => {
            throw new DOMException("Cancelled", "NotAllowedError");
          };
        });
        await page.getByRole("button", { name: "Create passkey", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Your PIN will keep working");
      }
      await page.getByRole("button", { name: "Skip for now", exact: true }).click();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(ceremonies).toEqual([]);
      await page.evaluate(async () => {
        await window.syncSecurityE2E.forgetUnlock();
        await window.syncSecurityE2E.clear();
      });
      await page.reload();
      await page.getByRole("button", { name: "Restore backup", exact: true }).click();
      await page.getByLabel("PIN", { exact: true }).fill("recovery-123456");
      await page.getByRole("button", { name: "Restore backup", exact: true }).click();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
    });
  });
}

for (const creationPrf of [true, false]) {
  test.describe(creationPrf ? "with creation PRF output" : "without creation PRF output", () => {
    test.use({ creationPrf });

    test("setup uses the minimum requests and restore requests only one", async ({ page, ceremonies }) => {
      const setupCeremonies = creationPrf ? ["create", "get"] : ["create", "get", "get"];
      await page.getByRole("button", { name: "Create passkey", exact: true }).click();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
      expect(ceremonies).toEqual(setupCeremonies);

      await page.evaluate(async () => {
        await window.syncSecurityE2E.save("agents/passkey/AGENTS.md", "passkey encrypted backup");
      });
      await page.getByRole("button", { name: "Sync now", exact: true }).click();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
      expect(ceremonies).toEqual(setupCeremonies);

      // Remove remembered unlock and local files so restore must decrypt server data.
      await page.evaluate(async () => {
        await window.syncSecurityE2E.forgetUnlock();
        await window.syncSecurityE2E.clear();
      });
      await page.reload();
      await expect(page.getByText("Ready to restore", { exact: true })).toBeVisible();
      expect(ceremonies).toEqual(setupCeremonies);
      await page.getByRole("button", { name: "Restore backup", exact: true }).click();
      await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.syncSecurityE2E.read("agents/passkey/AGENTS.md")))
        .toBe("passkey encrypted backup");
      expect(ceremonies).toEqual([...setupCeremonies, "get"]);
    });

    for (const cancelledAssertion of creationPrf ? [1] : [1, 2]) {
      test(`cancelling confirmation ${cancelledAssertion} keeps the PIN backup active and permits retry`, async ({
        page,
      }) => {
        let writes = 0;
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/v1/") && request.method() !== "GET") writes++;
        });
        // Forward to the real authenticator except for the one cancelled request.
        await page.evaluate((cancelAt) => {
          const get = navigator.credentials.get.bind(navigator.credentials);
          let assertions = 0;
          navigator.credentials.get = async (options) => {
            if (++assertions === cancelAt) throw new DOMException("User cancelled confirmation", "NotAllowedError");
            return get(options);
          };
        }, cancelledAssertion);
        await page.getByRole("button", { name: "Create passkey", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Passkey setup didn’t finish");
        await expect(page.getByRole("button", { name: "Skip for now", exact: true })).toBeEnabled();
        await expect(page.locator('[aria-current="step"]')).toContainText("Add passkey (optional)");
        expect(writes).toBe(0);
        expect(await page.evaluate(() => window.syncSecurityE2E.sessionStatus())).toBe("ready");

        await page.getByRole("button", { name: "Create passkey", exact: true }).click();
        await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(writes).toBeGreaterThan(0);
      });
    }
  });
}
