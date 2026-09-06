import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceMeta,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  CallToolResult,
  ContentBlock as MCPContentBlock,
  ResourceContents as MCPResourceContents,
  Tool as MCPTool,
} from "@modelcontextprotocol/sdk/types.js";
import { Role, type Message, type ToolContext } from "@/shared/types/chat";

export const MCP_HOST_INFO = { name: "Wingman Chat", version: "1.0.0" };
export type DisplayMode = McpUiDisplayMode;
export type UiResourceEntry = { uri: string; content: MCPResourceContents; meta?: McpUiResourceMeta };
type McpServerCapabilities = NonNullable<ReturnType<Client["getServerCapabilities"]>>;
type AppHandlers = Partial<
  Pick<AppBridge, "oncalltool" | "onlistresources" | "onreadresource" | "onlistresourcetemplates" | "onlistprompts">
>;

export interface McpAppOptions {
  iframe: HTMLIFrameElement;
  signal?: AbortSignal;
  displayMode?: DisplayMode;
  onDisplayModeRequested?: (mode: DisplayMode) => void;
  onSizeChange?: (height: number) => void;
  context?: Pick<ToolContext, "sendMessage" | "setContext" | "updateMeta">;
}

interface SessionOptions extends McpAppOptions {
  tool: MCPTool;
  resource: UiResourceEntry;
  input: Record<string, unknown>;
  result: CallToolResult;
  capabilities: McpUiHostCapabilities;
  handlers: AppHandlers;
  onClose: () => void;
}

/** One iframe owns one bridge. Server notifications are dispatched by MCPClient. */
export class McpAppSession {
  private readonly options: SessionOptions;
  private readonly bridge: AppBridge;
  private mode: DisplayMode;
  private closed = false;
  private initialized = false;
  private resourceSent = false;
  private connecting?: Promise<void>;
  private closePromise?: Promise<void>;
  private rejectReady?: (error: unknown) => void;
  private resolveReady?: () => void;
  private resizeObserver?: ResizeObserver;
  private themeObserver?: MutationObserver;
  private readonly onAbort = () => {
    void this.close().catch(console.error);
  };

  constructor(options: SessionOptions) {
    this.options = options;
    this.mode = options.displayMode ?? "inline";
    // Explicit handlers preserve the connection's discovery listeners and fan out
    // notifications to every app instead of replacing SDK handlers on the client.
    this.bridge = new AppBridge(null, MCP_HOST_INFO, options.capabilities, {
      hostContext: buildHostContext(options.tool, options.iframe, this.mode),
    });
    Object.assign(this.bridge, options.handlers);
    const bridge = this.bridge;
    const context = options.context ?? {};
    bridge.onsandboxready = async () => {
      if (this.closed || this.resourceSent) return;
      this.resourceSent = true;
      try {
        await bridge.sendSandboxResourceReady({
          html: getHtmlContent(options.resource.content),
          sandbox: "allow-scripts",
          csp: options.resource.meta?.csp,
          permissions: options.resource.meta?.permissions,
        });
      } catch (error) {
        this.rejectReady?.(error);
      }
    };
    bridge.oninitialized = () => {
      if (this.closed || this.initialized) return;
      this.initialized = true;
      const modes = bridge.getAppCapabilities()?.availableDisplayModes;
      if (modes?.length) {
        context.updateMeta?.({ appDisplayModes: modes });
        if (!modes.includes(this.mode)) {
          const mode = modes.find((value) => value === "inline" || value === "fullscreen");
          if (!mode || !options.onDisplayModeRequested) {
            this.rejectReady?.(new Error("MCP app has no supported display mode"));
            return;
          }
          this.setDisplayMode(mode);
          options.onDisplayModeRequested(mode);
        }
      }
      void bridge
        .sendToolInput({ arguments: options.input })
        .then(async () => {
          if (!this.closed) await bridge.sendToolResult(options.result);
        })
        .then(() => {
          if (!this.closed) this.resolveReady?.();
        })
        .catch((error) => this.rejectReady?.(error));
    };
    bridge.onsizechange = ({ height }) => {
      if (!this.closed && typeof height === "number" && Number.isFinite(height) && height > 0)
        options.onSizeChange?.(height);
    };
    bridge.onrequestdisplaymode = async ({ mode }) => {
      const available = bridge.getAppCapabilities()?.availableDisplayModes ?? ["inline", "fullscreen"];
      if (
        this.closed ||
        !options.onDisplayModeRequested ||
        !["inline", "fullscreen"].includes(mode) ||
        !available.includes(mode)
      )
        return { mode: this.mode };
      this.setDisplayMode(mode);
      options.onDisplayModeRequested(mode);
      return { mode };
    };
    bridge.onopenlink = async ({ url }) => {
      if (this.closed || !isSafeExternalUrl(url)) return { isError: true };
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.onmessage = async ({ role, content }) => {
      if (this.closed || !context.sendMessage || role !== "user") return { isError: true };
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
      if (!this.closed) await context.setContext?.(serializeModelContext(content, structuredContent));
      return {};
    };
    bridge.onloggingmessage = ({ level, logger, data }) => {
      const log = level === "error" || level === "critical" || level === "emergency" ? console.error : console.debug;
      log(`[${logger ?? "MCP App"}] ${level}`, data);
    };
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new DOMException("App closed", "AbortError"));
    return (this.connecting ??= this.connectInternal());
  }

  private async connectInternal(): Promise<void> {
    const { iframe, signal } = this.options;
    signal?.throwIfAborted();
    if (this.closed) throw new DOMException("App closed", "AbortError");
    const target = iframe.contentWindow;
    if (!target) throw new Error("MCP iframe is unavailable");
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const timer = setTimeout(() => this.rejectReady?.(new Error("MCP app did not initialize in time")), 15_000);
    signal?.addEventListener("abort", this.onAbort, { once: true });
    try {
      await Promise.all([this.bridge.connect(new PostMessageTransport(target, target)), ready]);
      signal?.throwIfAborted();
      if (this.closed) throw new DOMException("App closed", "AbortError");
      this.resizeObserver = new ResizeObserver(() => this.updateHostContext());
      this.resizeObserver.observe(iframe);
      this.themeObserver = new MutationObserver(() => this.updateHostContext());
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      this.updateHostContext();
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      clearTimeout(timer);
      this.resolveReady = undefined;
      this.rejectReady = undefined;
    }
  }

  setDisplayMode(mode: DisplayMode): void {
    if (this.closed) return;
    this.mode = mode;
    this.updateHostContext();
  }

  private updateHostContext(): void {
    if (!this.closed && this.initialized)
      this.bridge.setHostContext(buildHostContext(this.options.tool, this.options.iframe, this.mode));
  }

  async notify(kind: "tools" | "resources" | "prompts"): Promise<void> {
    if (this.closed || !this.initialized) return;
    if (kind === "tools") await this.bridge.sendToolListChanged();
    else if (kind === "resources") await this.bridge.sendResourceListChanged();
    else await this.bridge.sendPromptListChanged();
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.rejectReady?.(new DOMException("App closed", "AbortError"));
    this.options.signal?.removeEventListener("abort", this.onAbort);
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.options.onClose();
    this.closePromise = (async () => {
      if (this.initialized && !this.options.signal?.aborted && this.options.iframe.isConnected) {
        await this.bridge.teardownResource({}, { timeout: 1000 }).catch(() => {});
      }
      await this.bridge.close();
    })();
    return this.closePromise;
  }
}

function getHtmlContent(resource: MCPResourceContents): string {
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

function buildHostContext(tool: MCPTool, iframe: HTMLIFrameElement, displayMode?: DisplayMode): McpUiHostContext {
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
    toolInfo: { tool },
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
