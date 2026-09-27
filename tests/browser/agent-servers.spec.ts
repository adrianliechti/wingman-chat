import { expect, test } from "@playwright/test";

test("agent servers can be disabled without disabling configured or plugin MCPs or deleting saved definitions", async ({
  page,
  baseURL,
}) => {
  let enableCustomMCP: boolean | undefined = false;
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        enableCustomMCP,
        tools: [
          {
            id: "configured",
            name: "Configured server",
            description: "Deployment MCP",
            url: `${baseURL}/fixture-mcp/configured`,
          },
        ],
      },
    }),
  );
  await page.route("**/fixture-mcp/**", async (route) => {
    const request = route.request();
    const server = new URL(request.url()).pathname.split("/").pop()!;
    requests.push(server);
    if (request.method() !== "POST") return route.fulfill({ status: 405 });
    const body = request.postDataJSON();
    if (body.id === undefined) return route.fulfill({ status: 202 });
    const result =
      body.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: server, version: "1" },
          }
        : body.method === "tools/list"
          ? { tools: [] }
          : {};
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
  });

  const open = async () => {
    await page.goto("/tests/browser/fixtures/react-ui.html?agent-servers");
    await expect.poll(() => requests.includes("configured") && requests.includes("plugin")).toBe(true);
    await page.getByRole("button", { name: "Open agent", exact: true }).click();
  };
  await open();
  await expect(page.getByText("Configured server", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add MCP", exact: true })).toHaveCount(0);
  await expect(page.getByText("Custom agent server", { exact: true })).toHaveCount(0);
  expect(requests).not.toContain("custom");

  await page.locator('button[aria-haspopup="menu"]').filter({ hasText: "MCP Agent" }).click();
  await page.getByRole("menuitem", { name: "Manage agents" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByPlaceholder("My Agent").fill("New agent");
  await expect(page.getByRole("button", { name: /Real-time Voice/ })).toHaveCount(0);
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Enable tools", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add MCP Server", exact: true })).toHaveCount(0);

  // Removing the flag restores the original imported server without reimporting it.
  enableCustomMCP = undefined;
  requests.length = 0;
  await open();
  await expect(page.getByRole("button", { name: "Add MCP", exact: true })).toBeVisible();
  await expect(page.getByText("Custom agent server", { exact: true })).toBeVisible();
  await expect.poll(() => requests.includes("custom")).toBe(true);
  expect(errors).toEqual([]);
});
