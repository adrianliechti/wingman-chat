import type { AppBridge, McpUiHostCapabilities, McpUiHostContext } from "@mcp-ui/client";
import type { McpUiDisplayMode, McpUiResourceMeta } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  CallToolResult,
  ResourceContents as MCPResourceContents,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";

export const MCP_HOST_INFO = { name: "Wingman Chat", version: "1.0.0" };
type DisplayMode = McpUiDisplayMode;
export type AppNotification = "tools" | "resources" | "prompts" | "disconnect";
type McpServerCapabilities = { tools?: { listChanged?: boolean }; resources?: { listChanged?: boolean } };
type AppHandlers = Partial<
  Pick<AppBridge, "oncalltool" | "onlistresources" | "onreadresource" | "onlistresourcetemplates" | "onlistprompts">
>;
export interface McpAppOptions {
  signal?: AbortSignal;
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
  resourceMeta?: McpUiResourceMeta;
  capabilities: McpUiHostCapabilities;
  handlers: AppHandlers;
  subscribe: (listener: (kind: AppNotification) => void) => () => void;
}

export function getHtmlContent(resource: MCPResourceContents): string {
  if ("text" in resource && typeof resource.text === "string") {
    return resource.text;
  }

  if ("blob" in resource && typeof resource.blob === "string") {
    return new TextDecoder().decode(Uint8Array.from(atob(resource.blob), (char) => char.charCodeAt(0)));
  }

  throw new Error(`Missing MCP app HTML: ${resource.uri}`);
}

export function buildHostCapabilities(
  resourceMeta?: McpUiResourceMeta,
  serverCapabilities?: McpServerCapabilities | null,
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
