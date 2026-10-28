import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { downloadHubPlugin } from "./hub";

afterEach(() => vi.unstubAllGlobals());

async function download(server: Record<string, unknown>) {
  const zip = new JSZip();
  zip.file(
    "mcp.json",
    JSON.stringify({ mcpServers: { research: { type: "http", url: "https://example.test/mcp", ...server } } }),
  );
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
  return downloadHubPlugin("https://hub.example.test", { id: "test", source: "test" });
}

it.each([undefined, "none", "individual", "delegated"] as const)("preserves plugin MCP approval mode %s", async (mode) => {
  const approval = mode === undefined ? undefined : { mode };
  const result = await download({ approval });
  expect(result.mcpServers[0].approval).toEqual(approval);
});

it.each([{ approval: "prompt" }, { approval: { mode: "always" } }, { needsApproval: true }])(
  "rejects invalid plugin approval instead of losing it: %j",
  async (server) => {
    await expect(download(server)).rejects.toMatchObject({ kind: "invalid" });
  },
);
