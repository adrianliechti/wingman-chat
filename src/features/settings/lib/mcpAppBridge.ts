import { AppBridge, type McpUiHostContext } from "@mcp-ui/client";
import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";
import { MCP_HOST_INFO, type McpAppData } from "./mcpAppSession";

type DisplayMode = McpUiDisplayMode;

/** App policy only. AppFrame owns sandbox loading, handshake and result delivery. */
export function createAppBridge(
  data: McpAppData,
  options: {
    getDisplayMode: () => DisplayMode;
    onDisplayModeRequested: (mode: DisplayMode) => void;
    hostContext?: McpUiHostContext;
    onPrompt?: (text: string) => Promise<void>;
  },
): AppBridge {
  const bridge = new AppBridge(
    null,
    MCP_HOST_INFO,
    {
      ...data.capabilities,
      ...(options.onPrompt ? { message: {} } : {}),
    },
    { hostContext: options.hostContext },
  );
  Object.assign(bridge, data.handlers);
  const onPrompt = options.onPrompt;
  if (onPrompt) {
    bridge.onmessage = async ({ content }) => {
      const prompt = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
      if (!prompt) return { isError: true };
      await onPrompt(prompt);
      return {};
    };
  }
  // AppFrame currently forwards CSP but omits resource permissions and sandbox.
  const sendResource = bridge.sendSandboxResourceReady.bind(bridge);
  bridge.sendSandboxResourceReady = (params) =>
    sendResource({ ...params, sandbox: "allow-scripts", permissions: data.resourceMeta?.permissions });
  bridge.onrequestdisplaymode = async ({ mode }) => {
    const available = bridge.getAppCapabilities()?.availableDisplayModes ?? ["inline", "fullscreen"];
    if (!["inline", "fullscreen"].includes(mode) || !available.includes(mode))
      return { mode: options.getDisplayMode() };
    options.onDisplayModeRequested(mode);
    return { mode };
  };
  bridge.onopenlink = async ({ url }) => {
    if (!isSafeExternalUrl(url)) return { isError: true };
    window.open(url, "_blank", "noopener,noreferrer");
    return {};
  };
  bridge.onloggingmessage = ({ level, logger, data }) => {
    const log = level === "error" || level === "critical" || level === "emergency" ? console.error : console.debug;
    log(`[${logger ?? "MCP App"}] ${level}`, data);
  };
  return bridge;
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
