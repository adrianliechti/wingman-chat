import { expect, test, type Page } from "@playwright/test";

const inventory = [
  { id: "gpt-6-astra" },
  { id: "claude-fable-5-1" },
  { id: "claude-mythos-5-1" },
  { id: "qwen3.8-max" },
  { id: "gpt-realtime-2.1" },
  { id: "gpt-live-transcribe" },
  { id: "gemini-3.1-flash-live-preview" },
  { id: "gpt-transcribe" },
  { id: "gpt-4o-mini-tts" },
  { id: "opaque", name: "API name", description: "Backend metadata", type: "completer" },
];

async function open(page: Page, config: Record<string, unknown> = {}, hold = false) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release!: () => void;
  const gate = hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const api = { data: inventory, status: 200, requests: 0 };
  await page.route("**/config.json", (route) => route.fulfill({ json: config }));
  await page.route("**/api/v1/models", async (route) => {
    api.requests++;
    const { data, status } = api;
    if (api.requests === 1) await gate;
    await route.fulfill({
      status,
      json: status === 200 ? { object: "list", data } : { error: { message: "Offline" } },
    });
  });
  await page.goto("/tests/browser/fixtures/models.html");
  await page.waitForFunction(() => !!window.modelsE2E);
  await expect.poll(() => api.requests).toBe(1);
  if (!hold) await page.waitForFunction(() => window.modelsE2E.state().all.length > 0);
  return { api, errors, release: () => release() };
}

test("all consumers share one request and use config type before API type and name detection", async ({ page }) => {
  const { api, errors } = await open(page, {
    models: [
      { id: "opaque", name: "Studio", type: "renderer", supportedQualities: [] },
      { id: "gpt-6-astra", name: "Astra", supportedEfforts: ["low", "xhigh"], effort: "low" },
      { id: "unavailable", name: "Unavailable", type: "completer" },
    ],
  });
  const state = await page.evaluate(() => window.modelsE2E.state());
  expect(state.chat.map((model) => model.id)).toEqual([
    "gpt-6-astra",
    "claude-fable-5-1",
    "claude-mythos-5-1",
    "qwen3.8-max",
  ]);
  expect(state.chat[1].hidden).toBe(true);
  expect(state.renderers).toMatchObject([
    { id: "opaque", type: "renderer", name: "Studio", description: "Backend metadata", supportedQualities: [] },
  ]);
  expect(state.selected).toMatchObject({
    id: "gpt-6-astra",
    effort: "low",
    defaultEffort: "low",
    supportedEfforts: ["low", "xhigh"],
  });
  expect(await page.evaluate(() => window.modelsE2E.resolveRenderer())).toBe("opaque");
  expect(api.requests).toBe(1);
  expect(errors).toEqual([]);
});

test("a renderer-only config leaves chat models visible", async ({ page }) => {
  await open(page, { models: [{ id: "opaque", name: "Studio", type: "renderer" }] });
  const state = await page.evaluate(() => window.modelsE2E.state());
  expect(state.chat).toHaveLength(4);
  expect(state.chat.every((model) => !model.hidden)).toBe(true);
});

for (const selection of ["realtime", "clear"] as const) {
  test(`a delayed initial response preserves the user's ${selection} choice`, async ({ page }) => {
    const { release, api } = await open(page, {}, true);
    await page.evaluate(
      (selection) => window.modelsE2E.select(selection === "realtime" ? { id: "realtime", name: "Voice" } : null),
      selection,
    );
    release();
    await page.waitForFunction(() => window.modelsE2E.state().all.length > 0);
    expect(await page.evaluate(() => window.modelsE2E.state().selected?.id ?? null)).toBe(
      selection === "realtime" ? "realtime" : null,
    );
    expect(api.requests).toBe(1);
  });
}

test("background refresh adds and removes models without switching an active model or effort", async ({ page }) => {
  const { api } = await open(page);
  await page.evaluate(() => {
    const model = window.modelsE2E.state().chat.find((model) => model.id === "gpt-6-astra")!;
    window.modelsE2E.select({ ...model, effort: "max" });
  });
  api.data = [{ id: "new-model" }, { id: "gpt-transcribe" }];
  await page.evaluate(() => window.modelsE2E.refresh());
  await expect
    .poll(() => page.evaluate(() => window.modelsE2E.state().chat.map((model) => model.id)))
    .toEqual(["new-model"]);
  expect(await page.evaluate(() => window.modelsE2E.state().selected)).toMatchObject({
    id: "gpt-6-astra",
    effort: "max",
  });
});

test("restores a supported saved effort but drops one excluded by the current profile", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("app_model", "qwen3.8-max@high"));
  await open(page);
  await page.waitForFunction(() => window.modelsE2E.state().selected?.id === "qwen3.8-max");
  const selected = await page.evaluate(() => window.modelsE2E.state().selected);
  expect(selected).toMatchObject({ supportedEfforts: ["none", "low", "medium", "xhigh"], defaultEffort: "xhigh" });
  expect(selected?.effort).toBeUndefined();
  await page.evaluate(() => window.modelsE2E.select({ ...window.modelsE2E.state().selected!, effort: "medium" }));
  // The init script intentionally writes the invalid legacy value on navigation;
  // replace it by selecting during the next mounted load instead of reloading.
  await page.getByRole("button", { name: "Toggle consumer" }).click();
  await page.getByRole("button", { name: "Toggle consumer" }).click();
  await expect.poll(() => page.evaluate(() => window.modelsE2E.state().selected?.effort)).toBe("medium");
});

test("a failed refresh retains the working inventory and a retry recovers", async ({ page }) => {
  const { api, errors } = await open(page);
  const before = await page.evaluate(() => window.modelsE2E.state());
  api.status = 503;
  await expect(page.evaluate(() => window.modelsE2E.refresh())).rejects.toThrow("Offline");
  expect(await page.evaluate(() => window.modelsE2E.state())).toEqual(before);
  api.status = 200;
  api.data = [];
  await page.evaluate(() => window.modelsE2E.refresh());
  await expect.poll(() => page.evaluate(() => window.modelsE2E.state().all)).toEqual([]);
  expect(api.requests).toBe(3);
  expect(errors).toEqual([]);
});

test("refreshes a stale catalogue on focus and removes timers and listeners on unmount", async ({ page }) => {
  await page.clock.install();
  const { api } = await open(page);
  await page.clock.setFixedTime(new Date(Date.now() + 61_000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => api.requests).toBe(2);
  await page.getByRole("button", { name: "Toggle consumer" }).click();
  await page.clock.fastForward(120_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(api.requests).toBe(2);
});
