import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";

export const fixture = "/tests/browser/fixtures/sync-security.html";
export const filePath = "agents/resilience/AGENTS.md";
export const pin = "12345678";

export async function connect(context: BrowserContext, server: string, user: string = randomUUID()) {
  const network = {
    offline: false,
    unavailable: false,
    interrupt: undefined as undefined | ((route: Route) => Promise<boolean>),
  };
  await context.route("**/config.json", (route) =>
    route.fulfill({ json: { models: [], backup: { provider: "onedrive" } } }),
  );
  await context.route("**/api/v1/**", async (route) => {
    if (network.offline) return route.abort("internetdisconnected");
    if (network.unavailable) return route.fulfill({ status: 503, body: "Backup server temporarily unavailable" });
    if (await network.interrupt?.(route)) return;
    const request = route.request();
    const response = await route.fetch({
      url: `${server}${new URL(request.url()).pathname}${new URL(request.url()).search}`,
      headers: { ...request.headers(), "X-Forwarded-User": user },
    });
    await route.fulfill({ response });
  });
  return { network, user };
}

export async function enableBackup(page: Page) {
  await page.goto(fixture);
  await choosePin(page);
}

export async function choosePin(page: Page) {
  await page.getByRole("button", { name: "Turn on backup", exact: true }).click();
  await page.getByLabel("New PIN", { exact: true }).fill(pin);
  await page.getByLabel("Confirm PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "Create PIN", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
}

export async function sync(page: Page) {
  const button = page.getByRole("button", { name: "Sync now", exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
}

export async function expectLocal(page: Page, text: string) {
  await expect.poll(() => page.evaluate(() => window.syncSecurityE2E.readChat()).then(JSON.stringify)).toContain(text);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const chat = (await window.syncSecurityE2E.readChat()) as { messages: unknown[] } | undefined;
        return chat?.messages.length;
      }),
    )
    .toBe(1);
  await expect.poll(() => page.evaluate((p) => window.syncSecurityE2E.read(p), filePath)).toBe(text);
}

export async function restore(context: BrowserContext, server: string, user: string, text: string) {
  await withRestoredBackup(context, server, user, (page) => expectLocal(page, text));
}

export async function withRestoredBackup(
  context: BrowserContext,
  server: string,
  user: string,
  verify: (page: Page) => Promise<void>,
) {
  const device = await context.browser()!.newContext({ baseURL: new URL(context.pages()[0].url()).origin });
  try {
    await connect(device, server, user);
    const page = await device.newPage();
    await page.goto(fixture);
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await page.getByLabel("PIN", { exact: true }).fill(pin);
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await expect(page.getByText("Everything looks fine", { exact: true })).toBeVisible();
    await verify(page);
  } finally {
    await device.close();
  }
}

export function matchesUpload(route: Route, kind: "chat" | "file") {
  const request = route.request();
  return kind === "chat"
    ? request.method() === "POST" && request.url().includes("/events")
    : request.method() === "PUT" && request.url().includes("/files/");
}
