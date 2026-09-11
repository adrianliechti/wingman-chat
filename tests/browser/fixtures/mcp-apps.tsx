import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { McpApp } from "../../../src/features/chat/components/McpApp";
import { MCPClient } from "../../../src/features/settings/lib/mcp";
import {
  ToolsContext,
  type ToolsContextValue,
} from "../../../src/features/tools/context/ToolsContext";
import { ProviderState, type ToolResultContent } from "../../../src/shared/types/chat";
import { AppProvider } from "../../../src/shell/context/AppProvider";
import { useApp } from "../../../src/shell/hooks/useApp";

const fullscreenOnly = new URLSearchParams(location.search).has("fullscreen");
const modes = fullscreenOnly ? ["fullscreen"] : ["inline", "fullscreen"];
// A tiny wire-protocol guest, deliberately independent of the host SDK. It runs
// inside the production nested sandbox with no same-origin access to the host.
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p id="label">Grüezi 世界</p><script>
const state = { instance: Math.random(), events: [], replies: {}, host: null };
window.guest = { state, request: (id, method, params) => parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*') };
window.addEventListener('message', ({ data }) => {
  if (data.id === 'init' && data.result) {
    state.host = data.result.hostContext;
    parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
    parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 180 } }, '*');
  } else if (data.method === 'ui/resource-teardown') {
    parent.postMessage({ jsonrpc: '2.0', id: data.id, result: {} }, '*');
  } else if (data.method) {
    state.events.push(data);
    if (data.method === 'ui/notifications/host-context-changed') state.host = { ...state.host, ...data.params };
  } else if (data.id) state.replies[data.id] = data;
});
window.guest.request('init', 'ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'fixture', version: '1' }, appCapabilities: { availableDisplayModes: ${JSON.stringify(modes)} } });
</script></body></html>`;
const tool = (name: string, visibility = ["model", "app"]) => ({
  name,
  inputSchema: { type: "object" },
  _meta: { ui: { resourceUri: "ui://fixture", visibility, availableDisplayModes: modes } },
});
const stats = { reads: 0, calls: [] as string[], lists: 0 };
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let tools = [tool("app"), tool("guest_only", ["app"]), tool("model_only", ["model"])];
let holdResource: (() => void) | undefined;
let hold = false;
const fetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (
    (input instanceof Request ? input.url : input.toString()) !== `${location.origin}/fixture-mcp`
  )
    return fetch(input, init);
  if (init?.method === "GET") {
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
        },
      }),
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }
  if (init?.method === "DELETE") return new Response(null, { status: 200 });
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  const request = JSON.parse(init.body);
  if (request.id === undefined) return new Response(null, { status: 202 });
  let result: unknown;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
        serverInfo: { name: "fixture", version: "1" },
      };
      break;
    case "tools/list":
      stats.lists++;
      result = { tools };
      break;
    case "tools/call":
      stats.calls.push(request.params.name);
      result = { content: [{ type: "text", text: request.params.name }] };
      break;
    case "resources/read": {
      stats.reads++;
      if (hold)
        await new Promise<void>((resolve) => {
          holdResource = resolve;
        });
      init?.signal?.throwIfAborted();
      const bytes = new TextEncoder().encode(html);
      result = {
        contents: [
          {
            uri: "ui://fixture",
            mimeType: "text/html;profile=mcp-app",
            blob: btoa(String.fromCharCode(...bytes)),
          },
        ],
      };
      break;
    }
    case "ping":
      result = {};
      break;
    default:
      throw new Error(`Unexpected MCP fixture request: ${request.method}`);
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
    headers: { "Content-Type": "application/json", "Mcp-Session-Id": "fixture-session" },
  });
};
const client = new MCPClient("fixture", `${location.origin}/fixture-mcp`, "Fixture", "Fixture");
await client.connect();
const toolsContext: ToolsContextValue = {
  providers: [client],
  getProviderState: () => ProviderState.Connected,
  getProviderPolicy: () => "optional",
  setProviderEnabled: async () => client.connect(),
  setModelOverrides: () => {},
  skillSources: { personal: false },
  setSkillSources: () => {},
  companionAvailable: false,
  companionEnabled: false,
  toggleCompanion: () => {},
  restoreToolUI: (_provider, name, uri, args, result, content, options) =>
    client.restoreToolUI(name, uri, args, result, content, options),
};
function Fixture() {
  const app = useApp();
  const [ids, setIds] = useState(["first", "second"]);
  useEffect(() => {
    window.mcpE2E = {
      state: () => ({
        ...stats,
        active: app.activeAppKey,
        showing: app.showAppDrawer,
        tools: client.tools.map((value) => value.name),
      }),
      remove: (id: string) => setIds((previous) => previous.filter((value) => value !== id)),
      add: (id: string) => setIds((previous) => [...previous, id]),
      hold: () => {
        hold = true;
      },
      release: () => {
        hold = false;
        holdResource?.();
      },
      changed: () => {
        tools = [tool("app"), tool("guest_only", ["model"]), tool("added")];
        stream!.enqueue(
          new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`,
          ),
        );
      },
    };
  });
  return (
    <>
      <button onClick={() => void app.closeApp()}>Close panel</button>
      <aside
        ref={app.registerDrawerTarget}
        style={{ position: "fixed", top: 20, right: 20, width: 350, height: 350 }}
      />
      {ids.map((id, index) => {
        const result: ToolResultContent = {
          type: "tool_result",
          id,
          name: "app",
          arguments: JSON.stringify({ id }),
          result: [{ type: "text", text: id }],
          content: { id },
          meta: { toolProvider: "fixture", toolResource: "ui://fixture", appDisplayModes: modes },
        };
        return (
          <section key={id} data-testid={id} style={{ width: 450 }}>
            <McpApp toolResult={result} isLastFullscreenApp={index === ids.length - 1} />
          </section>
        );
      })}
    </>
  );
}
declare global {
  interface Window {
    mcpE2E: {
      state(): {
        reads: number;
        calls: string[];
        lists: number;
        active: string | null;
        showing: boolean;
        tools: string[];
      };
      remove(id: string): void;
      add(id: string): void;
      hold(): void;
      release(): void;
      changed(): void;
    };
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToolsContext value={toolsContext}>
      <AppProvider>
        <Fixture />
      </AppProvider>
    </ToolsContext>
  </StrictMode>,
);
