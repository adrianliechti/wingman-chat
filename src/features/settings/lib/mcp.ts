import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceMeta,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  AppBridge,
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as ClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CallToolResult,
  ElicitResult,
  ContentBlock as MCPContentBlock,
  ResourceContents as MCPResourceContents,
  Tool as MCPTool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ElicitRequestSchema,
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { traceMCP } from "@/shared/lib/otel";
import {
  type AudioContent,
  type FileContent,
  type ImageContent,
  type Message,
  Role,
  type TextContent,
  type Tool,
  type ToolContext,
  type ToolProvider,
} from "@/shared/types/chat";
import type { ElicitationSchema } from "@/shared/types/elicitation";
import { BrowserOAuthClientProvider } from "./mcpAuth";

export type { McpUiDisplayMode };

export type DisplayModeOptions = {
  displayMode?: McpUiDisplayMode;
  onDisplayModeRequested?: (mode: McpUiDisplayMode) => void;
};

const HOST_INFO = {
  name: "Wingman Chat",
  version: "1.0.0",
};

const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";

type UiResourceEntry = {
  uri: string;
  content: MCPResourceContents;
  meta?: McpUiResourceMeta;
};

type McpServerCapabilities = NonNullable<ReturnType<Client["getServerCapabilities"]>>;

export class MCPClient implements ToolProvider {
  readonly id: string;
  readonly url: string;

  readonly name: string;
  readonly description?: string;

  icon?: string;

  readonly headers?: Record<string, string>;

  private client: Client | null = null;
  private activeBridge: AppBridge | null = null;
  private authProvider: BrowserOAuthClientProvider;
  private activeToolContext: ToolContext | null = null;

  private pingInterval: ReturnType<typeof setInterval> | undefined;

  instructions?: string;

  tools: Tool[] = [];
  uiResources: Map<string, UiResourceEntry> = new Map();
  toolDefinitions: Map<string, MCPTool> = new Map();

  /** Called when the OAuth flow starts (popup opened) */
  onAuthenticating: (() => void) | null = null;
  /** Called when the OAuth flow completes (success or failure) */
  onAuthComplete: (() => void) | null = null;
  /** Called when the server notifies that its tool list has changed and tools have been reloaded */
  onToolsChanged: (() => void) | null = null;

  constructor(
    id: string,
    url: string,
    name: string,
    description: string,
    headers?: Record<string, string>,
    icon?: string,
  ) {
    this.id = id;
    this.url = url;
    this.name = name;
    this.description = description;
    this.headers = headers;
    this.icon = icon;
    this.authProvider = new BrowserOAuthClientProvider(id);
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    const opts = {
      reconnectionOptions: {
        maxReconnectionDelay: 30000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: -1,
      },
      requestInit: this.headers ? { headers: this.headers } : undefined,
      authProvider: this.authProvider,
    };

    const url = new URL(this.url);
    const transport = new ClientTransport(url, opts);

    const client = new Client(HOST_INFO, {
      capabilities: {
        elicitation: {
          form: {},
        },
        extensions: {
          [MCP_UI_EXTENSION]: {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      } as never,
    });

    client.setRequestHandler(ElicitRequestSchema, async (request): Promise<ElicitResult> => {
      if (!this.activeToolContext?.elicit) {
        throw new McpError(ErrorCode.InvalidRequest, "No active tool context available for elicitation");
      }

      if (request.params.mode === "url") {
        throw new McpError(ErrorCode.InvalidParams, "URL elicitation is not supported");
      }

      const requestedSchema = normalizeRequestedSchema(request.params.requestedSchema);

      const result = await this.activeToolContext.elicit({
        message: request.params.message,
        requestedSchema,
      });

      if (result.action !== "accept") {
        return { action: result.action };
      }

      return {
        action: "accept",
        ...(result.content ? { content: result.content } : {}),
      };
    });

    // Setup error and close handlers
    client.onclose = () => {
      console.warn("MCP client connection closed");
      //this.handleDisconnect();
    };

    client.onerror = (error) => {
      console.error("MCP client connection error:", error);
      //this.handleDisconnect();
    };

    try {
      await client.connect(transport);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        // The transport has already called authProvider.redirectToAuthorization(),
        // opening the OAuth popup. Notify listeners and wait for the auth code.
        console.log(`[MCP OAuth] Authorization required for "${this.name}". Waiting for OAuth flow...`);
        this.onAuthenticating?.();

        let authCode: string;
        try {
          authCode = await this.authProvider.waitForAuthCode();
        } catch (authError) {
          this.onAuthComplete?.();
          throw authError;
        }

        // Exchange the auth code for tokens via the transport, then reconnect.
        await transport.finishAuth(authCode);
        this.onAuthComplete?.();

        console.log(`[MCP OAuth] Authorization complete for "${this.name}". Reconnecting...`);
        // Reconnect with the freshly obtained tokens.
        await this.connect();
        return;
      }
      throw error;
    }

    console.log("MCP client connected");

    this.client = client;

    // Load and store tools and instructions after connection
    await this.loadToolsAndInstructions();

    // Register list-changed notification handler if the server supports it
    if (this.client.getServerCapabilities()?.tools?.listChanged) {
      this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        await this.loadToolsAndInstructions();
      });
    }

    this.startPing();
  }

  async disconnect(): Promise<void> {
    this.stopPing();
    await this.cleanupActiveBridge();

    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error("Error disconnecting MCP client:", error);
      }
      this.client = null;
      this.tools = [];
      this.uiResources.clear();
      this.instructions = undefined;
    }
  }

  onDisconnected: (() => void) | null = null;

  private handleDisconnect(): void {
    this.stopPing();
    this.client = null;
    this.tools = [];
    this.uiResources.clear();
    this.toolDefinitions.clear();
    this.instructions = undefined;
    this.onDisconnected?.();
  }

  private async cleanupActiveBridge(): Promise<void> {
    if (!this.activeBridge) {
      return;
    }

    const bridge = this.activeBridge;
    this.activeBridge = null;

    try {
      await bridge.teardownResource({});
    } catch {
      // Ignore teardown failures for sessions that never fully initialized.
    }

    try {
      await bridge.close();
    } catch (error) {
      console.error("Error closing MCP app bridge:", error);
    }
  }

  private async loadToolsAndInstructions(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      // Load instructions
      this.instructions = this.client.getInstructions();

      // Load tools
      const toolsResponse = await this.client.listTools();
      const tools = toolsResponse.tools || [];
      this.toolDefinitions = new Map(tools.map((tool) => [tool.name, tool]));

      this.tools = tools
        .filter((tool) => !isToolVisibilityAppOnly(tool))
        .map((tool) => {
          const icons = tool.icons ?? [];
          const icon = (icons.find((i) => i.theme === "light") ?? icons.find((i) => !i.theme) ?? icons[0])?.src;
          return {
            name: tool.name,
            icon,

            description: tool.description || "",
            parameters: tool.inputSchema || {},

            function: async (args: Record<string, unknown>, context?: ToolContext) => {
              if (!this.client) {
                throw new Error("MCP client not connected");
              }

              this.activeToolContext = context ?? null;

              try {
                return await traceMCP(
                  "tools/call",
                  tool.name,
                  { toolName: tool.name, serverAddress: this.url },
                  async () => {
                    const result = await this.client!.callTool({
                      name: tool.name,
                      arguments: args,
                    });

                    // Handle both current and compatibility result formats
                    // Compatibility format has toolResult field, current has content field
                    const normalizedResult: CallToolResult =
                      "toolResult" in result ? (result.toolResult as CallToolResult) : (result as CallToolResult);

                    const resource = this.uiResources.get(tool.name);

                    if (resource && context?.setMeta) {
                      // Don't render the UI here — InlineMcpApp handles rendering via
                      // restoreToolUI with the correct display mode and target iframe.
                      // We only persist the metadata so InlineMcpApp knows what to render.
                      const toolUiMeta = tool._meta?.ui as
                        | { defaultDisplayMode?: string; availableDisplayModes?: string[] }
                        | undefined;
                      context.setMeta?.({
                        toolProvider: this.id,
                        toolResource: resource.uri,
                        ...(toolUiMeta?.defaultDisplayMode
                          ? { defaultDisplayMode: toolUiMeta.defaultDisplayMode }
                          : {}),
                        ...(toolUiMeta?.availableDisplayModes
                          ? { appDisplayModes: toolUiMeta.availableDisplayModes }
                          : {}),
                      });
                    }

                    return processContent(normalizedResult.content as MCPContentBlock[]);
                  },
                );
              } finally {
                this.activeToolContext = null;
              }
            },
          };
        });

      // Load resources for tools that have ui/resourceUri meta field
      await this.loadUIResources(tools);

      // Notify listeners that the tool list has been (re)loaded
      this.onToolsChanged?.();
    } catch (error) {
      console.error("Error loading tools and instructions:", error);
    }
  }

  private async renderToolUI(
    toolName: string,
    resource: UiResourceEntry,
    result: CallToolResult,
    args: Record<string, unknown>,
    context: ToolContext,
    displayModeOptions?: DisplayModeOptions,
  ): Promise<void> {
    const renderTarget = await context.render!();
    const { iframe } = renderTarget;
    const toolDefinition = this.toolDefinitions.get(toolName);

    if (!toolDefinition) {
      throw new Error(`MCP tool definition not found for ${toolName}`);
    }

    const bridge = new AppBridge(
      this.client!,
      HOST_INFO,
      buildHostCapabilities(
        resource.meta,
        this.client!.getServerCapabilities(),
        !!context.sendMessage,
        !!context.setContext,
      ),
      { hostContext: buildHostContext(toolDefinition, iframe, displayModeOptions?.displayMode) },
    );

    this.activeBridge = bridge;

    renderTarget.registerCleanup(async () => {
      if (this.activeBridge === bridge) {
        this.activeBridge = null;
      }

      try {
        await bridge.teardownResource({});
      } catch {
        // Ignore teardown failures for sessions that are still booting.
      }

      try {
        await bridge.close();
      } catch (error) {
        console.error("Error closing MCP app bridge:", error);
      }
    });

    const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!);

    bridge.onsandboxready = () => {
      bridge
        .sendSandboxResourceReady({
          html: getHtmlContent(resource.content),
          sandbox: "allow-scripts",
          csp: resource.meta?.csp,
          permissions: resource.meta?.permissions,
        })
        .catch((error) => {
          console.error(`Failed to load sandbox resource for ${toolName}:`, error);
        });
    };

    bridge.oninitialized = () => {
      console.log("Guest UI initialized for tool:", toolName);

      // Check guest app's declared capabilities and persist if available
      const appCaps = bridge.getAppCapabilities();
      const appModes = appCaps?.availableDisplayModes;
      if (appModes && appModes.length > 0) {
        // Guest-declared modes override server-declared modes
        context.updateMeta?.({ appDisplayModes: appModes });
      }

      // Check if the app is fullscreen-only based on its declared capabilities
      if (
        appModes &&
        appModes.length === 1 &&
        appModes[0] === "fullscreen" &&
        displayModeOptions?.displayMode !== "fullscreen"
      ) {
        displayModeOptions?.onDisplayModeRequested?.("fullscreen");
      }

      bridge
        .sendToolInput({ arguments: args })
        .then(() => bridge.sendToolResult(result))
        .catch((error) => {
          console.error(`Failed to send MCP app data for ${toolName}:`, error);
        });
    };

    bridge.onsizechange = ({ height }) => {
      // Per spec §Container Dimensions, width is fixed (host-controlled) so the host
      // does not need to respond to width from ui/notifications/size-changed.
      // Only height uses flexible (maxHeight) or unbounded mode, so we apply it here.

      if (typeof height === "number" && height > 0) {
        // Cap inline apps at INLINE_MAX_HEIGHT to prevent dominating the chat scroll
        const cappedHeight =
          displayModeOptions?.displayMode !== "fullscreen" ? Math.min(height, INLINE_MAX_HEIGHT) : height;
        iframe.style.height = `${cappedHeight}px`;
      }
    };

    bridge.onopenlink = async ({ url }) => {
      if (!isSafeExternalUrl(url)) {
        return { isError: true };
      }

      const opened = window.open(url, "_blank", "noopener,noreferrer");
      return opened ? {} : { isError: true };
    };

    bridge.onrequestdisplaymode = async ({ mode }) => {
      const currentMode = displayModeOptions?.displayMode ?? "inline";
      if (mode === "fullscreen" && currentMode !== "fullscreen") {
        displayModeOptions?.onDisplayModeRequested?.(mode);
        // Notify the view of the display mode change and updated container dimensions
        bridge.setHostContext(buildHostContext(toolDefinition, iframe, mode));
        return { mode };
      }
      if (mode === "inline" && currentMode !== "inline") {
        displayModeOptions?.onDisplayModeRequested?.(mode);
        bridge.setHostContext(buildHostContext(toolDefinition, iframe, mode));
        return { mode };
      }
      return { mode: currentMode };
    };

    bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
      try {
        if (!context.setContext) {
          throw new Error("setContext is not supported by the host context");
        }

        await context.setContext(serializeModelContext(content, structuredContent));
        return {};
      } catch (error) {
        console.error(`Failed to update model context for ${toolName}:`, error);
        throw error instanceof Error ? error : new Error("Failed to update model context");
      }
    };

    bridge.onmessage = async ({ role, content }) => {
      if (!context.sendMessage || role !== "user") {
        return { isError: true };
      }

      const textBlocks = content.filter(
        (block): block is Extract<MCPContentBlock, { type: "text" }> => block.type === "text",
      );

      if (textBlocks.length !== content.length || textBlocks.length === 0) {
        return { isError: true };
      }

      const message: Message = {
        role: Role.User,
        content: textBlocks.map((block) => ({
          type: "text",
          text: block.text ?? "",
        })),
      };

      try {
        await context.sendMessage(message);
        return {};
      } catch (error) {
        console.error(`Failed to process MCP app message for ${toolName}:`, error);
        return { isError: true };
      }
    };

    bridge.onloggingmessage = ({ level, logger, data }) => {
      const prefix = logger ? `[${logger}]` : "[MCP App]";
      const line = `${prefix} ${level}`;

      if (level === "error" || level === "critical" || level === "alert" || level === "emergency") {
        console.error(line, data);
        return;
      }

      if (level === "warning") {
        console.warn(line, data);
        return;
      }

      console.log(line, data);
    };

    await bridge.connect(transport);
  }

  /**
   * Restore an MCP App UI from persisted chat data.
   * Re-fetches the UI resource if not cached, renders the iframe, and replays stored tool input + result.
   */
  async restoreToolUI(
    toolName: string,
    uiResourceUri: string,
    args: Record<string, unknown>,
    storedResult: (TextContent | ImageContent | AudioContent | FileContent)[],
    context: ToolContext,
    displayModeOptions?: DisplayModeOptions,
  ): Promise<void> {
    if (!this.client) {
      throw new Error("MCP client not connected");
    }

    // Convert stored content back to MCP CallToolResult format
    const result: CallToolResult = {
      content: storedResult.map((c) => {
        if (c.type === "text") return { type: "text" as const, text: c.text };
        if (c.type === "image") {
          const match = c.data?.match(/^data:([^;]+);base64,(.+)$/);
          if (match)
            return {
              type: "image" as const,
              mimeType: match[1],
              data: match[2],
            };
        }
        return { type: "text" as const, text: JSON.stringify(c) };
      }),
    };

    // Try to use cached resource, otherwise re-fetch
    let resource = this.uiResources.get(toolName);
    if (!resource) {
      try {
        const readResult = await this.client.readResource({
          uri: uiResourceUri,
        });
        const content = readResult.contents.find(
          (entry) => entry.mimeType === RESOURCE_MIME_TYPE && entry.uri?.startsWith("ui://"),
        );
        if (!content) {
          throw new Error(`Invalid UI resource for ${toolName}`);
        }
        resource = {
          uri: uiResourceUri,
          content,
          meta: content._meta?.ui as McpUiResourceMeta | undefined,
        };
        this.uiResources.set(toolName, resource);
      } catch (error) {
        console.error(`Failed to fetch UI resource for ${toolName}:`, error);
        throw error;
      }
    }

    await this.renderToolUI(toolName, resource, result, args, context, displayModeOptions);
  }

  private async loadUIResources(tools: MCPTool[]): Promise<void> {
    if (!this.client) {
      return;
    }

    // Collect unique resource URIs and their associated tool names
    const uriToTools = new Map<string, string[]>();

    for (const tool of tools) {
      let resourceUri: string | undefined;

      try {
        resourceUri = getToolUiResourceUri(tool);
      } catch (error) {
        console.warn(`Skipping invalid MCP UI resource URI for ${tool.name}:`, error);
        continue;
      }

      if (resourceUri) {
        const toolNames = uriToTools.get(resourceUri) || [];
        toolNames.push(tool.name);
        uriToTools.set(resourceUri, toolNames);
      }
    }

    // Load resources in parallel
    await Promise.all(
      Array.from(uriToTools.entries()).map(async ([uri, toolNames]) => {
        try {
          const result = await this.client!.readResource({ uri });
          const content = result.contents.find(
            (entry) => entry.mimeType === RESOURCE_MIME_TYPE && entry.uri?.startsWith("ui://"),
          );

          if (!content) {
            return;
          }

          const entry: UiResourceEntry = {
            uri,
            content,
            meta: content._meta?.ui as McpUiResourceMeta | undefined,
          };

          for (const toolName of toolNames) {
            this.uiResources.set(toolName, entry);
          }
        } catch (error) {
          console.error(`Error loading resource ${uri}:`, error);
        }
      }),
    );
  }

  private startPing(): void {
    // Clear any existing interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Ping every 20 seconds
    this.pingInterval = setInterval(async () => {
      if (this.client) {
        try {
          await this.client.ping();
        } catch (error) {
          console.error("MCP client ping failed:", error);
          this.handleDisconnect();
        }
      } else {
        this.stopPing();
      }
    }, 20000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  /** Whether this client currently has a live app bridge (e.g. from an in-flight tool call). */
  hasActiveBridge(): boolean {
    return this.activeBridge !== null;
  }
}

type ToolResultContent = TextContent | ImageContent | AudioContent | FileContent;

function processContent(input: MCPContentBlock[]): ToolResultContent[] {
  if (!input?.length) {
    return [{ type: "text" as const, text: "no content" }];
  }

  const result = input
    .map((block): ToolResultContent | null => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text || "" };
      }

      if (block.type === "image") {
        const mimeType = block.mimeType || "image/png";
        const data = `data:${mimeType};base64,${block.data || ""}`;
        return { type: "image" as const, data };
      }

      return null;
    })
    .filter((c): c is ToolResultContent => c !== null);

  return result.length
    ? result
    : [
        {
          type: "text" as const,
          text: JSON.stringify(input.length === 1 ? input[0] : input),
        },
      ];
}

function getHtmlContent(resource: MCPResourceContents): string {
  if ("text" in resource && typeof resource.text === "string") {
    return resource.text;
  }

  if ("blob" in resource && typeof resource.blob === "string") {
    return atob(resource.blob);
  }

  return "<!doctype html><html><body>No content available.</body></html>";
}

function buildHostCapabilities(
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
    capabilities.serverTools = {
      ...(serverCapabilities.tools.listChanged ? { listChanged: true } : {}),
    };
  }

  if (serverCapabilities?.resources) {
    capabilities.serverResources = {
      ...(serverCapabilities.resources.listChanged ? { listChanged: true } : {}),
    };
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

function buildHostContext(tool: MCPTool, iframe: HTMLIFrameElement, displayMode?: McpUiDisplayMode): McpUiHostContext {
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

function normalizeRequestedSchema(schema: {
  $schema?: string;
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}): ElicitationSchema {
  return {
    $schema: schema.$schema,
    type: "object",
    properties: schema.properties as ElicitationSchema["properties"],
    required: schema.required,
  };
}
