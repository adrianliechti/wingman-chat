import { AppBridge, type McpUiHostCapabilities, type McpUiHostContext } from "@mcp-ui/client";
import type { McpUiDisplayMode, McpUiResourceMeta } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  CallToolResult,
  ContentBlock as MCPContentBlock,
  ResourceContents as MCPResourceContents,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";
import { Role, type Message, type ToolContext } from "@/shared/types/chat";

export const MCP_HOST_INFO = { name: "Wingman Chat", version: "1.0.0" };
export type DisplayMode = McpUiDisplayMode;
export type UiResourceEntry = { uri: string; content: MCPResourceContents; meta?: McpUiResourceMeta };
export type AppNotification = "tools" | "resources" | "prompts" | "disconnect";
type McpServerCapabilities = { tools?: { listChanged?: boolean }; resources?: { listChanged?: boolean } };
type AppHandlers = Partial<
  Pick<AppBridge, "oncalltool" | "onlistresources" | "onreadresource" | "onlistresourcetemplates" | "onlistprompts">
>;
export interface McpAppOptions {
  signal?: AbortSignal;
  initialResult?: CallToolResult;
  context?: Pick<ToolContext, "sendMessage" | "setContext" | "updateMeta">;
}

/** The renderer's SDK accepts object structured content; MCP 2 also allows primitives. */
export function toAppToolResult(result: CallToolResult) {
  const { structuredContent, ...rest } = result;
  return {
    ...rest,
    ...(structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)
      ? { structuredContent: structuredContent as Record<string, unknown> }
      : {}),
  };
}
export interface McpAppData {
  tool: MCPTool;
  html: string;
  input: Record<string, unknown>;
  result: ReturnType<typeof toAppToolResult>;
  resource: UiResourceEntry;
  capabilities: McpUiHostCapabilities;
  handlers: AppHandlers;
  context?: McpAppOptions["context"];
  subscribe: (listener: (kind: AppNotification) => void) => () => void;
}

/** App policy only. AppFrame owns sandbox loading, handshake and result delivery. */
export function createAppBridge(
  data: McpAppData,
  options: {
    getDisplayMode: () => DisplayMode;
    onDisplayModeRequested: (mode: DisplayMode) => void;
    hostContext?: McpUiHostContext;
  },
): AppBridge {
  const bridge = new AppBridge(null, MCP_HOST_INFO, data.capabilities, { hostContext: options.hostContext });
  Object.assign(bridge, data.handlers);
  const context = data.context ?? {};
  // AppFrame currently forwards CSP but omits resource permissions and sandbox.
  const sendResource = bridge.sendSandboxResourceReady.bind(bridge);
  bridge.sendSandboxResourceReady = (params) =>
    sendResource({ ...params, sandbox: "allow-scripts", permissions: data.resource.meta?.permissions });
  bridge.onrequestdisplaymode = async ({ mode }) => {
    const available = bridge.getAppCapabilities()?.availableDisplayModes ?? ["inline", "fullscreen"];
    if (!options.onDisplayModeRequested || !["inline", "fullscreen"].includes(mode) || !available.includes(mode))
      return { mode: options.getDisplayMode() };
    options.onDisplayModeRequested(mode);
    return { mode };
  };
  bridge.onopenlink = async ({ url }) => {
    if (!isSafeExternalUrl(url)) return { isError: true };
    window.open(url, "_blank", "noopener,noreferrer");
    return {};
  };
  bridge.onmessage = async ({ role, content }) => {
    if (!context.sendMessage || role !== "user") return { isError: true };
    const blocks = content.filter(
      (block): block is Extract<MCPContentBlock, { type: "text" }> => block.type === "text",
    );
    if (blocks.length === 0 || blocks.length !== content.length) return { isError: true };
    const message: Message = {
      role: Role.User,
      content: blocks.map((block) => ({ type: "text", text: block.text })),
    };
    await context.sendMessage(message);
    return {};
  };
  bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
    await context.setContext?.(serializeModelContext(content, structuredContent));
    return {};
  };
  bridge.onloggingmessage = ({ level, logger, data }) => {
    const log = level === "error" || level === "critical" || level === "emergency" ? console.error : console.debug;
    log(`[${logger ?? "MCP App"}] ${level}`, data);
  };
  return bridge;
}

export function getHtmlContent(resource: MCPResourceContents): string {
  if ("text" in resource && typeof resource.text === "string") {
    return resource.text;
  }

  if ("blob" in resource && typeof resource.blob === "string") {
    return new TextDecoder().decode(Uint8Array.from(atob(resource.blob), (char) => char.charCodeAt(0)));
  }

  return "<!doctype html><html><body>No content available.</body></html>";
}

export function buildHostCapabilities(
  resourceMeta?: McpUiResourceMeta,
  serverCapabilities?: McpServerCapabilities | null,
  supportsMessages = false,
  supportsModelContext = false,
): McpUiHostCapabilities {
  const capabilities: McpUiHostCapabilities = {
    openLinks: {},
    logging: {},
    sandbox: {
      permissions: resourceMeta?.permissions,
      csp: resourceMeta?.csp,
    },
  };

  if (serverCapabilities?.tools) {
    capabilities.serverTools = serverCapabilities.tools.listChanged ? { listChanged: true } : {};
  }

  if (serverCapabilities?.resources) {
    capabilities.serverResources = serverCapabilities.resources.listChanged ? { listChanged: true } : {};
  }

  if (supportsMessages) {
    capabilities.message = { text: {} };
  }

  if (supportsModelContext) {
    capabilities.updateModelContext = {
      text: {},
      structuredContent: {},
    };
  }

  return capabilities;
}

/** Max height (px) for inline apps to prevent them from dominating the chat scroll. */
const INLINE_MAX_HEIGHT = 600;

export function buildHostContext(tool: MCPTool, iframe: HTMLElement, displayMode?: DisplayMode): McpUiHostContext {
  const isDark = document.documentElement.classList.contains("dark");
  const currentMode = displayMode ?? "inline";

  // Per spec, containerDimensions signals how the host sizes the container:
  //   - Fixed (width/height): host controls size, view fills it
  //   - Flexible (maxWidth/maxHeight): view controls size up to a max
  //   - Unbounded (field omitted): view controls size with no limit
  // Width is always fixed: the host controls it (CSS w-full for inline, ResizeObserver
  // for fullscreen). The view should fill the available width per the spec.
  // Height: inline uses maxHeight (flexible, capped); fullscreen is unbounded (omitted).
  const containerWidth =
    iframe.clientWidth ||
    iframe.parentElement?.getBoundingClientRect().width ||
    iframe.closest(".min-h-\\[60px\\]")?.getBoundingClientRect().width ||
    // Final fallback: use viewport-derived width when the element hasn't laid out yet
    Math.min(window.innerWidth - 48, 800);
  const containerDimensions: McpUiHostContext["containerDimensions"] = {
    ...(typeof containerWidth === "number" && containerWidth > 0 ? { width: containerWidth } : {}),
    ...(currentMode === "inline" ? { maxHeight: INLINE_MAX_HEIGHT } : {}),
  };

  return {
    toolInfo: { tool: tool as NonNullable<McpUiHostContext["toolInfo"]>["tool"] },
    theme: isDark ? "dark" : "light",
    styles: {
      variables: {
        "--color-background-primary": isDark ? "#0a0a0a" : "#ffffff",
        "--color-text-primary": isDark ? "#fafafa" : "#171717",
        "--color-border-primary": isDark ? "#404040" : "#d4d4d4",
        "--font-sans": "ui-sans-serif, system-ui, sans-serif",
        "--font-mono": "ui-monospace, SFMono-Regular, monospace",
      } as NonNullable<NonNullable<McpUiHostContext["styles"]>["variables"]>,
    },
    displayMode: currentMode,
    availableDisplayModes: ["inline", "fullscreen"],
    containerDimensions,
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent,
    platform: window.innerWidth < 768 ? "mobile" : "web",
    deviceCapabilities: {
      touch: window.matchMedia("(pointer: coarse)").matches,
      hover: window.matchMedia("(hover: hover)").matches,
    },
  };
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function serializeModelContext(
  content?: MCPContentBlock[],
  structuredContent?: Record<string, unknown>,
): string | null {
  const textParts = (content ?? []).map(serializeModelContextBlock).filter((part): part is string => !!part);

  if (structuredContent && Object.keys(structuredContent).length > 0) {
    textParts.push(`Structured context:\n${JSON.stringify(structuredContent, null, 2)}`);
  }

  if (textParts.length === 0) {
    return null;
  }

  return textParts.join("\n\n");
}

function serializeModelContextBlock(block: MCPContentBlock): string | null {
  if (block.type === "text") {
    const text = block.text?.trim();
    return text ? text : null;
  }

  if (block.type === "image") {
    return `[Image context: ${block.mimeType ?? "image"}]`;
  }

  if (block.type === "audio") {
    return `[Audio context: ${block.mimeType ?? "audio"}]`;
  }

  if (block.type === "resource_link") {
    return `[Resource link context: ${block.uri}]`;
  }

  if (block.type === "resource") {
    return `[Embedded resource context: ${block.resource?.uri ?? "resource"}]`;
  }

  return JSON.stringify(block);
}
