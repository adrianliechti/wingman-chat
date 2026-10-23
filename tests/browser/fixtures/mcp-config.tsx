import "../../../src/index.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProvider } from "../../../src/features/agent/context/AgentProvider";
import { useAgents } from "../../../src/features/agent/hooks/useAgents";
import { SkillsProvider } from "../../../src/features/skills/context/SkillsProvider";
import { PluginsProvider } from "../../../src/features/plugins/context/PluginsProvider";
import { usePlugins } from "../../../src/features/plugins/hooks/usePlugins";
import { ArtifactsProvider } from "../../../src/features/artifacts/context/ArtifactsProvider";
import { ToolsProvider } from "../../../src/features/tools/context/ToolsProvider";
import { useToolsContext } from "../../../src/features/tools/hooks/useToolsContext";
import { McpApp } from "../../../src/features/chat/components/McpApp";
import { ChatInputAddMenu } from "../../../src/features/chat/components/ChatInputAddMenu";
import { BrowserOAuthClientProvider } from "../../../src/features/settings/lib/mcpAuth";
import { AppProvider } from "../../../src/shell/context/AppProvider";
import { loadConfig } from "../../../src/shared/config";

await loadConfig();
const owner = "plugin:demo";
const child = `${owner}:mcp:server`;
const html = `<!doctype html><html><body><p id="ready">Saved MCP app</p><script>
window.addEventListener('message', ({data}) => {
  if (data.id === 'init' && data.result) {
    parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}}, '*');
    parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:100}}, '*');
  } else if (data.method === 'ui/resource-teardown') {
    parent.postMessage({jsonrpc:'2.0',id:data.id,result:{}}, '*');
  }
});
parent.postMessage({jsonrpc:'2.0',id:'init',method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'saved',version:'1'},appCapabilities:{availableDisplayModes:['inline']}}}, '*');
</script></body></html>`;

function Fixture() {
  const tools = useToolsContext();
  const plugins = usePlugins();
  const agents = useAgents();
  const [widget, setWidget] = useState(() => localStorage.getItem("fixture_widget") === "true");
  useEffect(() => {
    window.mcpConfigE2E = {
      state: () => ({
        loaded: plugins.isLoaded,
        selected: JSON.parse(localStorage.getItem("app_tools") ?? "[]") as string[],
        plugins: plugins.plugins,
        providers: tools.providers.map((provider) => ({
          id: provider.id,
          state: tools.getProviderState(provider.id),
          enabled: tools.isProviderEnabled(provider.id),
          tools: provider.tools.map((tool) => tool.name),
        })),
        pluginEnabled: tools.isProviderEnabled(owner),
        pluginState: tools.getProviderState(owner),
        companionAvailable: tools.companionAvailable,
      }),
      install: () =>
        plugins.installPlugin(`${location.origin}/fixture-hub/`, {
          id: "demo",
          title: "Demo plugin",
          source: "fixture",
        }),
      uninstall: () => plugins.uninstallPlugin("demo"),
      toggle: tools.setProviderEnabled,
      call: async (id) => {
        const tool = tools.providers.find((provider) => provider.id === id)?.tools[0];
        if (!tool) throw new Error(`No tool for ${id}`);
        return tool.execute({}, undefined);
      },
      agent: async (required) => {
        if (required) await agents.createAgent("Required", { plugins: ["demo"] });
        else agents.setCurrentAgent(null);
      },
      seedToken: (endpoint) =>
        new BrowserOAuthClientProvider(child, endpoint).saveTokens({
          access_token: "fixture-token",
          token_type: "Bearer",
        }),
    };
  });
  return (
    <>
      <ChatInputAddMenu
        isScreenCaptureAvailable={false}
        isContinuousCaptureActive={false}
        canTranscribe={false}
        isTranscribing={false}
        isResponding={false}
        visibleProviders={tools.providers}
        isProviderEnabled={tools.isProviderEnabled}
        getProviderState={tools.getProviderState}
        getProviderPolicy={tools.getProviderPolicy}
        setProviderEnabled={tools.setProviderEnabled}
        skillSources={tools.skillSources}
        setSkillSources={tools.setSkillSources}
        onAttachmentClick={() => {}}
        onContinuousCaptureToggle={async () => {}}
        onTranscriptionClick={async () => {}}
        onDriveSelect={() => {}}
      />
      <button onClick={() => void tools.setProviderEnabled(owner, !tools.isProviderEnabled(owner))}>
        {tools.isProviderEnabled(owner) ? "Disable plugin" : "Enable plugin"}
      </button>
      <button
        onClick={() => {
          localStorage.setItem("fixture_widget", String(!widget));
          setWidget(!widget);
        }}
      >
        Toggle saved app
      </button>
      <div data-testid="saved-app">
        {widget && (
          <McpApp
            app={{
              type: "ui-resource",
              serverId: child,
              toolName: "widget",
              toolCallId: "saved",
              resource: { uri: "ui://fixture", mimeType: "text/html;profile=mcp-app", text: html },
            }}
            call={{ type: "tool-call", id: "saved", name: "widget", arguments: "{}", state: "complete" }}
            result={{ type: "tool-result", toolCallId: "saved", content: "Saved", state: "complete" }}
            isLastFullscreenApp={false}
          />
        )}
      </div>
    </>
  );
}

declare global {
  interface Window {
    mcpConfigE2E: {
      state(): {
        loaded: boolean;
        selected: string[];
        plugins: unknown[];
        providers: { id: string; state: string; enabled: boolean; tools: string[] }[];
        pluginEnabled: boolean;
        pluginState: string;
        companionAvailable: boolean;
      };
      install(): Promise<unknown>;
      uninstall(): Promise<void>;
      toggle(id: string, enabled: boolean): Promise<void>;
      call(id: string): Promise<unknown>;
      agent(required: boolean): Promise<void>;
      seedToken(endpoint: string): void;
    };
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AgentProvider>
      <SkillsProvider>
        <PluginsProvider>
          <ArtifactsProvider>
            <ToolsProvider>
              <AppProvider>
                <Fixture />
              </AppProvider>
            </ToolsProvider>
          </ArtifactsProvider>
        </PluginsProvider>
      </SkillsProvider>
    </AgentProvider>
  </StrictMode>,
);
