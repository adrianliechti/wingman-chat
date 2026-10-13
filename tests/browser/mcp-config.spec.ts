import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createHash } from "node:crypto";

test.use({ actionTimeout: 15_000 });
test.setTimeout(60_000);

const owner = "plugin:demo";
const child = `${owner}:mcp:server`;
const base = "http://127.0.0.1:4175";

type RequestLog = { path: string; method: string; authorization?: string; tenant?: string };
async function setup(page: Page, config: Record<string, unknown> = {}) {
  const state = {
    endpoint: `${base}/fixture-mcp/old`,
    tenant: "one",
    failure: false,
    holdInitialize: false,
    releaseInitialize: undefined as (() => void) | undefined,
    requireAuth: false,
    denyAuth: false,
    holdAuth: false,
    releaseAuth: undefined as (() => void) | undefined,
    requests: [] as RequestLog[],
    popups: 0,
    registrations: 0,
    tokenGrants: [] as string[],
    accessToken: "fixture-token",
    refreshToken: "",
    scope: "read",
    requiredScope: "read",
    codes: new Map<string, { challenge: string; scope: string }>(),
  };
  await page.context().route("**/config.json", (route) => route.fulfill({ json: { models: [], ...config } }));
  await page.context().route("**/skills", (route) => route.fulfill({ json: [] }));
  await page.context().route("**/api/v1/mcp", (route) => route.fulfill({ json: { data: [{ id: "managed" }] } }));
  await page.context().route("**/fixture-hub/demo.zip", async (route) => {
    const zip = new JSZip();
    zip.file(
      "mcp.json",
      JSON.stringify({
        mcpServers: {
          server: { type: "http", url: state.endpoint, headers: { "X-Tenant": state.tenant } },
          secondary: { type: "http", url: `${base}/fixture-mcp/secondary` },
          command: { type: "stdio", command: "never-execute" },
        },
      }),
    );
    await route.fulfill({ contentType: "application/zip", body: await zip.generateAsync({ type: "nodebuffer" }) });
  });
  await page.context().route(/\/(fixture-mcp\/|api\/v1\/mcp\/|companion\/mcp)/, async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ status: 405 });
    if (request.method() === "DELETE") return route.fulfill({ status: 200 });
    const body = request.postDataJSON();
    const path = new URL(request.url()).pathname;
    state.requests.push({
      path,
      method: body.method,
      authorization: request.headers().authorization,
      tenant: request.headers()["x-tenant"],
    });
    if (state.holdInitialize && path === "/fixture-mcp/old" && body.method === "initialize") {
      await new Promise<void>((resolve) => {
        state.releaseInitialize = resolve;
      });
    }
    if (state.failure) return route.fulfill({ status: 503 });
    if (
      state.requireAuth &&
      path !== "/fixture-mcp/secondary" &&
      request.headers().authorization !== `Bearer ${state.accessToken}`
    )
      return route.fulfill({
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` },
      });
    if (state.requireAuth && path !== "/fixture-mcp/secondary" && !state.scope.split(" ").includes(state.requiredScope))
      return route.fulfill({
        status: 403,
        headers: { "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${state.requiredScope}"` },
      });
    if (body.id === undefined) return route.fulfill({ status: 202 });
    if (body.method === "server/discover")
      return route.fulfill({
        json: { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } },
      });
    let result: unknown = {};
    if (body.method === "initialize")
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    if (body.method === "tools/list")
      result = {
        tools: [
          {
            name: "widget",
            inputSchema: { type: "object" },
            _meta: { ui: { resourceUri: "ui://fixture", visibility: ["model", "app"] } },
          },
        ],
      };
    if (body.method === "tools/call") result = { content: [{ type: "text", text: "ok" }] };
    await route.fulfill({
      json: { jsonrpc: "2.0", id: body.id, result },
      headers: { "Mcp-Session-Id": "fixture-session" },
    });
  });
  await page.context().route("**/.well-known/oauth-protected-resource", (route) =>
    route.fulfill({
      json: {
        resource: state.endpoint,
        authorization_servers: [base],
        bearer_methods_supported: ["header"],
        scopes_supported: ["read"],
      },
    }),
  );
  await page.context().route("**/.well-known/oauth-authorization-server", (route) =>
    route.fulfill({
      json: {
        issuer: base,
        authorization_endpoint: `${base}/fixture-oauth/authorize`,
        token_endpoint: `${base}/fixture-oauth/token`,
        registration_endpoint: `${base}/fixture-oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      },
    }),
  );
  await page.context().route("**/fixture-oauth/register", (route) => {
    state.registrations++;
    return route.fulfill({
      json: {
        client_id: "fixture-client",
        redirect_uris: [`${base}/oauth/callback`],
        token_endpoint_auth_method: "none",
      },
    });
  });
  await page.context().route("**/fixture-oauth/token", (route) => {
    const params = new URLSearchParams(route.request().postData()!);
    const grant = params.get("grant_type")!;
    state.tokenGrants.push(grant);
    if (grant === "authorization_code") {
      const code = params.get("code")!;
      const authorization = state.codes.get(code);
      state.codes.delete(code);
      const challenge = createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      if (!authorization || authorization.challenge !== challenge)
        return route.fulfill({ status: 400, json: { error: "invalid_grant" } });
      state.scope = authorization.scope;
    } else if (grant !== "refresh_token" || params.get("refresh_token") !== state.refreshToken) {
      return route.fulfill({ status: 400, json: { error: "invalid_grant" } });
    }
    state.accessToken = `fixture-token-${state.tokenGrants.length}`;
    state.refreshToken = `fixture-refresh-${state.tokenGrants.length}`;
    return route.fulfill({
      json: {
        access_token: state.accessToken,
        refresh_token: state.refreshToken,
        scope: state.scope,
        token_type: "Bearer",
        expires_in: 3600,
      },
    });
  });
  await page.context().route("**/fixture-oauth/authorize?**", async (route) => {
    state.popups++;
    const params = new URL(route.request().url()).searchParams;
    const code = `fixture-code-${state.popups}`;
    state.codes.set(code, { challenge: params.get("code_challenge")!, scope: params.get("scope") ?? "read" });
    if (state.holdAuth)
      await new Promise<void>((resolve) => {
        state.releaseAuth = resolve;
      });
    return route.fulfill({
      status: 302,
      headers: { Location: `${base}/oauth/callback?${state.denyAuth ? "error=access_denied" : `code=${code}`}` },
    });
  });
  await page.context().route("**/oauth/callback?**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><div id="root"></div><script type="module">
    import React from '/node_modules/.vite-browser-tests/deps/react.js';
    import {createRoot} from '/node_modules/.vite-browser-tests/deps/react-dom_client.js';
    import {OAuthCallbackPage} from '/src/features/settings/pages/OAuthCallbackPage.tsx';
    createRoot(document.getElementById('root')).render(React.createElement(OAuthCallbackPage));
  </script>`,
    }),
  );
  await page.goto("/tests/browser/fixtures/mcp-config.html");
  await expect.poll(() => page.evaluate(() => window.mcpConfigE2E?.state().loaded)).toBe(true);
  return state;
}
async function install(page: Page) {
  await page.evaluate(() => window.mcpConfigE2E.install());
  await expect
    .poll(() =>
      page.evaluate(
        () => window.mcpConfigE2E.state().providers.filter((provider) => provider.id.startsWith("plugin:")).length,
      ),
    )
    .toBe(2);
}
async function pluginState(page: Page, expected: string) {
  await expect.poll(() => page.evaluate(() => window.mcpConfigE2E.state().pluginState)).toBe(expected);
}
async function widgetReady(page: Page) {
  await expect(page.getByTestId("saved-app").locator("iframe")).toBeVisible();
  const proxy = await (await page.getByTestId("saved-app").locator("iframe").elementHandle())!.contentFrame();
  await expect.poll(() => proxy!.childFrames().length).toBe(1);
  await expect(proxy!.childFrames()[0].locator("#ready")).toHaveText("Saved MCP app");
}

test("catalog install, saved widget reopen, parent disable, reload and uninstall share one selection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await setup(page);
  await install(page);
  await page.getByRole("button", { name: "Toggle saved app" }).click();
  await expect(page.getByRole("button", { name: "Enable and reopen" })).toBeVisible();
  expect(state.requests).toEqual([]);
  await page.getByRole("button", { name: "Enable and reopen" }).click();
  await pluginState(page, "connected");
  await widgetReady(page);
  expect(await page.evaluate(() => window.mcpConfigE2E.state().selected)).toEqual([owner]);
  expect(state.requests.find((request) => request.path === "/fixture-mcp/old")?.tenant).toBe("one");
  await page.reload();
  await widgetReady(page);
  await page.getByRole("button", { name: "Disable plugin" }).click();
  await pluginState(page, "disconnected");
  await expect(page.getByTestId("saved-app").locator("iframe")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Enable and reopen" })).toBeVisible();
  expect(await page.evaluate(() => window.mcpConfigE2E.state().selected)).toEqual([]);
  expect(
    (await page.evaluate(() => window.mcpConfigE2E.state().providers)).every(
      (provider) => !provider.id.startsWith("plugin:") || provider.tools.length === 0,
    ),
  ).toBe(true);
  await page.evaluate(() => window.mcpConfigE2E.uninstall());
  await expect.poll(() => page.evaluate(() => window.mcpConfigE2E.state().plugins.length)).toBe(0);
  expect(errors).toEqual([]);
});

test("updating a plugin changes live endpoint and headers without forwarding the previous token", async ({ page }) => {
  const state = await setup(page);
  await install(page);
  await page.evaluate((endpoint) => window.mcpConfigE2E.seedToken(endpoint), state.endpoint);
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await pluginState(page, "connected");
  expect(
    state.requests.some(
      (request) => request.path === "/fixture-mcp/old" && request.authorization === "Bearer fixture-token",
    ),
  ).toBe(true);
  state.endpoint = `${base}/fixture-mcp/new`;
  state.tenant = "two";
  await install(page);
  await pluginState(page, "connected");
  expect(state.requests.some((request) => request.path === "/fixture-mcp/new" && request.tenant === "two")).toBe(true);
  expect(
    state.requests
      .filter((request) => request.path === "/fixture-mcp/new")
      .every((request) => request.authorization === undefined),
  ).toBe(true);
  state.tenant = "three";
  await install(page);
  await expect
    .poll(() => state.requests.some((request) => request.path === "/fixture-mcp/new" && request.tenant === "three"))
    .toBe(true);
});

test("static gateway filtering, direct headers and companion URLs survive the unified lifecycle", async ({ page }) => {
  await page.route("**/companion/.well-known/wingman-configuration", (route) => route.fulfill({ json: {} }));
  const state = await setup(page, {
    bridge: { url: `${base}/companion/` },
    tools: [
      { id: "managed" },
      { id: "hidden" },
      { id: "direct", url: `${base}/api/v1/mcp/direct`, headers: { "X-Tenant": "static" } },
      { id: "bad", url: "file:///bad" },
      { id: "companion", url: `${base}/collision` },
    ],
  });
  await expect
    .poll(() => page.evaluate(() => window.mcpConfigE2E.state().providers.map((provider) => provider.id)))
    .toEqual(["managed", "direct", "companion"]);
  await page.evaluate(async () => {
    await window.mcpConfigE2E.toggle("managed", true);
    await window.mcpConfigE2E.toggle("direct", true);
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.mcpConfigE2E.state().providers.every((provider) => provider.state === "connected")),
    )
    .toBe(true);
  expect(state.requests.some((request) => request.path === "/api/v1/mcp/direct" && request.tenant === "static")).toBe(
    true,
  );
  expect(state.requests.some((request) => request.path === "/companion/mcp")).toBe(true);
});

test("connection failures stay selected and recover on an explicit retry; agent plugins stay required", async ({
  page,
}) => {
  const state = await setup(page);
  await install(page);
  state.failure = true;
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await pluginState(page, "failed");
  expect(await page.evaluate(() => window.mcpConfigE2E.state().pluginEnabled)).toBe(true);
  const attempts = state.requests.length;
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Skills / Plugins" }).hover();
  const pluginToggle = page.getByRole("menuitemcheckbox", { name: /Demo plugin/ });
  await expect(pluginToggle).toBeChecked();
  await expect(pluginToggle.getByLabel("Connection failed")).toBeVisible();
  await pluginToggle.click();
  await expect(pluginToggle).not.toBeChecked();
  state.failure = false;
  await pluginToggle.click();
  await expect(pluginToggle).toBeChecked();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await pluginState(page, "connected");
  expect(state.requests.length).toBeGreaterThan(attempts);
  await page.evaluate(() => window.mcpConfigE2E.agent(true));
  await page.evaluate((id) => window.mcpConfigE2E.toggle(id, false), child);
  await pluginState(page, "connected");
  await page.evaluate(() => window.mcpConfigE2E.agent(false));
  await page.getByRole("button", { name: "Disable plugin" }).click();
  await pluginState(page, "disconnected");
});

test("OAuth denial waits for an explicit retry, then the real callback completes authentication", async ({ page }) => {
  const state = await setup(page);
  await install(page);
  state.requireAuth = true;
  state.denyAuth = true;
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await pluginState(page, "unauthorized");
  expect(state.popups).toBe(1);
  expect(await page.evaluate(() => window.mcpConfigE2E.state().pluginEnabled)).toBe(true);
  await page.getByRole("button", { name: "Toggle saved app" }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect(state.popups).toBe(1);
  state.denyAuth = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await pluginState(page, "connected");
  await widgetReady(page);
  expect(state.popups).toBe(2);
  await page.reload();
  await widgetReady(page);
  expect(state.popups).toBe(2);
});

test("disabling a plugin during initialization cancels it and permits a clean reconnect", async ({ page }) => {
  const state = await setup(page);
  await install(page);
  state.holdInitialize = true;
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await expect.poll(() => Boolean(state.releaseInitialize)).toBe(true);
  await page.getByRole("button", { name: "Disable plugin" }).click();
  await pluginState(page, "disconnected");
  state.holdInitialize = false;
  state.releaseInitialize!();
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await pluginState(page, "connected");
  await page.getByRole("button", { name: "Toggle saved app" }).click();
  await widgetReady(page);
  expect(await page.evaluate(() => window.mcpConfigE2E.state().selected)).toEqual([owner]);
  await page.evaluate(() => window.mcpConfigE2E.uninstall());
  await expect.poll(() => page.evaluate(() => window.mcpConfigE2E.state().providers.length)).toBe(0);
});

test("static and plugin entries share one OAuth login and rotating refresh token, including across tabs", async ({
  page,
  context,
}) => {
  const state = await setup(page, { tools: [{ id: "direct", url: `${base}/fixture-mcp/old` }] });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await install(page);
  state.requireAuth = true;
  await page.evaluate(async () => {
    await Promise.all([window.mcpConfigE2E.toggle("plugin:demo", true), window.mcpConfigE2E.toggle("direct", true)]);
  });
  await pluginState(page, "connected");
  expect(state.popups).toBe(1);
  expect(state.registrations).toBe(1);
  expect(state.tokenGrants).toEqual(["authorization_code"]);

  state.accessToken = "expired";
  await page.evaluate(async () => {
    await Promise.all([window.mcpConfigE2E.call("plugin:demo:mcp:server"), window.mcpConfigE2E.call("direct")]);
  });
  expect(state.tokenGrants).toEqual(["authorization_code", "refresh_token"]);
  await pluginState(page, "connected");

  const second = await context.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.goto("/tests/browser/fixtures/mcp-config.html");
  await pluginState(second, "connected");
  await expect
    .poll(() => second.evaluate(() => window.mcpConfigE2E.state().providers.find((p) => p.id === "direct")?.state))
    .toBe("connected");
  state.accessToken = "expired-again";
  await Promise.all([
    page.evaluate(() => window.mcpConfigE2E.call("direct")),
    second.evaluate(() => window.mcpConfigE2E.call("direct")),
  ]);
  expect(state.tokenGrants).toEqual(["authorization_code", "refresh_token", "refresh_token"]);
  expect(state.popups).toBe(1);
  await second.close();

  await page.evaluate(() => window.mcpConfigE2E.uninstall());
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.mcpConfigE2E.state().providers.find((p) => p.id === "direct")?.state))
    .toBe("connected");
  state.accessToken = "expired-after-uninstall";
  await page.evaluate(() => window.mcpConfigE2E.call("direct"));
  expect(state.tokenGrants).toEqual(["authorization_code", "refresh_token", "refresh_token", "refresh_token"]);
  expect(state.popups).toBe(1);
  expect(errors).toEqual([]);
});

test("endpoint-bound credentials migrate after an ID rename without a popup", async ({ page }) => {
  await page.addInitScript(
    ({ endpoint }) => {
      if (localStorage.getItem("fixture_migrated")) return;
      localStorage.setItem("fixture_migrated", "true");
      localStorage.setItem(
        `mcp_oauth:v2:old-id:${encodeURIComponent(endpoint)}:tokens`,
        JSON.stringify({ access_token: "fixture-token", token_type: "Bearer" }),
      );
    },
    { endpoint: `${base}/fixture-mcp/old` },
  );
  const state = await setup(page, { tools: [{ id: "renamed", url: `${base}/fixture-mcp/old` }] });
  state.requireAuth = true;
  await page.evaluate(() => window.mcpConfigE2E.toggle("renamed", true));
  await expect.poll(() => page.evaluate(() => window.mcpConfigE2E.state().providers[0]?.state)).toBe("connected");
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.mcpConfigE2E.state().providers[0]?.state)).toBe("connected");
  expect(state.popups).toBe(0);
  expect(state.requests.every((request) => request.authorization === "Bearer fixture-token")).toBe(true);
});

test("an explicit retry upgrades OAuth scope without refreshing away the requested permissions", async ({ page }) => {
  const state = await setup(page);
  await install(page);
  state.requireAuth = true;
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await pluginState(page, "connected");
  state.requiredScope = "write";
  await page.getByRole("button", { name: "Disable plugin" }).click();
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await pluginState(page, "connected");
  expect(state.scope.split(" ").sort()).toEqual(["read", "write"]);
  expect(state.tokenGrants).toEqual(["authorization_code", "authorization_code"]);
  expect(state.popups).toBe(2);
});

test("a login can outlive the MCP handshake timeout", async ({ page }) => {
  const state = await setup(page);
  await install(page);
  await page.clock.install();
  state.requireAuth = true;
  state.holdAuth = true;
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await expect.poll(() => Boolean(state.releaseAuth)).toBe(true);
  await page.clock.fastForward(61_000);
  await pluginState(page, "authenticating");
  state.holdAuth = false;
  state.releaseAuth!();
  await pluginState(page, "connected");
  expect(state.popups).toBe(1);
  expect(state.tokenGrants).toEqual(["authorization_code"]);
});

test("cancelling one entry's popup releases shared authorization for another entry", async ({ page }) => {
  const state = await setup(page, { tools: [{ id: "direct", url: `${base}/fixture-mcp/old` }] });
  await install(page);
  state.requireAuth = true;
  state.holdAuth = true;
  await page.getByRole("button", { name: "Enable plugin" }).click();
  await expect.poll(() => Boolean(state.releaseAuth)).toBe(true);
  await page.evaluate(() => {
    void window.mcpConfigE2E.toggle("direct", true);
  });
  state.holdAuth = false;
  await page.getByRole("button", { name: "Disable plugin" }).click();
  state.releaseAuth!();
  await pluginState(page, "disconnected");
  await expect
    .poll(() => page.evaluate(() => window.mcpConfigE2E.state().providers.find((p) => p.id === "direct")?.state))
    .toBe("connected");
  expect(state.popups).toBe(2);
  expect(state.registrations).toBe(1);
  expect(state.tokenGrants).toEqual(["authorization_code"]);
});
