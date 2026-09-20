import {
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  Client,
  ProtocolError,
  ProtocolErrorCode,
  StreamableHTTPClientTransport as ClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type {
  CallToolRequest,
  CallToolResult,
  ElicitResult,
  ContentBlock as MCPContentBlock,
  ResourceContents as MCPResourceContents,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";
import { trace } from "@opentelemetry/api";
import { textToDataUrl } from "@/shared/lib/fileContent";
import {
  type AudioContent,
  type FileContent,
  type ImageContent,
  type TextContent,
  type Tool,
  type ToolContext,
  type ToolIcon,
  type ToolProvider,
} from "@/shared/types/chat";
import type { ElicitationSchema } from "@/shared/types/elicitation";
import { BrowserOAuthClientProvider, McpAuthRequiredError } from "./mcpAuth";
import { mcpToolName } from "./mcpToolNames";

import {
  buildHostCapabilities,
  McpAppSession,
  MCP_HOST_INFO as HOST_INFO,
  type McpAppOptions,
  type UiResourceEntry,
} from "./mcpAppSession";

const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";

/** A response may contain several resources; only render the requested one. */
function toUiResourceEntry(uri: string, contents: MCPResourceContents[]): UiResourceEntry | null {
  const content = contents.find((entry) => entry.mimeType === RESOURCE_MIME_TYPE && entry.uri === uri);
  if (!content) return null;
  return { uri, content, meta: content._meta?.ui as McpUiResourceMeta | undefined };
}

type McpIcon = { src: string; mimeType?: string; sizes?: string[]; theme?: "light" | "dark" };
type ActiveToolCall = { context?: ToolContext };

function pickIcon(icons: McpIcon[] | undefined): string | undefined {
  if (!icons || icons.length === 0) return undefined;
  return (icons.find((i) => i.theme === "light") ?? icons.find((i) => !i.theme) ?? icons[0]).src;
}

export class MCPClient implements ToolProvider {
  readonly id: string;
  readonly url: string;

  readonly name: string;
  readonly description?: string;

  icon?: ToolIcon;

  readonly headers?: Record<string, string>;

  private readonly _configIcon?: ToolIcon;
  private client: Client | null = null;
  private pendingClient: Client | null = null;
  private connectionVersion = 0;
  private connecting?: Promise<void>;
  private readonly appSessions = new Set<McpAppSession>();
  private authProvider: BrowserOAuthClientProvider;
  private readonly activeToolCalls = new Set<ActiveToolCall>();
  private readonly elicitations = new Map<string, ActiveToolCall>();
  private discovery?: { client: Client; dirty: boolean; promise: Promise<void> };

  private pingInterval: ReturnType<typeof setInterval> | undefined;

  instructions?: string;

  tools: Tool[] = [];
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
    icon?: ToolIcon,
  ) {
    this.id = id;
    this.url = url;
    this.name = name;
    this.description = description;
    this.headers = headers;
    this._configIcon = icon;
    this.icon = icon ?? this.iconUrl();
    this.authProvider = new BrowserOAuthClientProvider(id);
  }

  /** Resolve the server's default icon, ensuring a trailing slash so the path isn't dropped. */
  private iconUrl(): string {
    const base = this.url.endsWith("/") ? this.url : `${this.url}/`;
    return new URL("icon", base).href;
  }

  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.client) return Promise.resolve();
    const version = ++this.connectionVersion;
    const promise = this.connectInternal(true, version).finally(() => {
      if (this.connecting === promise) this.connecting = undefined;
    });
    this.connecting = promise;
    return promise;
  }

  private async connectInternal(allowAuth: boolean, version: number): Promise<void> {
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
          url: {},
        },
        extensions: {
          [MCP_UI_EXTENSION]: {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      } as never,
    });
    this.pendingClient = client;
    const assertCurrent = () => {
      if (this.connectionVersion !== version) throw new DOMException("MCP connection cancelled", "AbortError");
    };

    client.setRequestHandler("elicitation/create", async (request): Promise<ElicitResult> => {
      assertCurrent();
      // The SDK does not expose which outgoing call an incoming elicitation belongs
      // to. Never send a concurrent call's request to whichever context ran last.
      const [call] = this.activeToolCalls;
      const context = call?.context;
      if (this.activeToolCalls.size !== 1 || !context?.elicit || context.signal?.aborted) {
        throw new ProtocolError(ProtocolErrorCode.InvalidRequest, "Elicitation requires a single active tool context");
      }

      if (request.params.mode === "url") {
        const { elicitationId } = request.params;
        this.elicitations.set(elicitationId, call);
        try {
          const result = await context.elicit({
            mode: "url",
            message: request.params.message,
            url: request.params.url,
            elicitationId,
          });
          return { action: result.action };
        } finally {
          if (this.elicitations.get(elicitationId) === call) this.elicitations.delete(elicitationId);
        }
      }

      const requestedSchema = normalizeRequestedSchema(request.params.requestedSchema);

      const result = await context.elicit({
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

    // Log only — the transport auto-reconnects (reconnectionOptions) and the ping
    // loop calls handleDisconnect() on a genuine failure.
    client.onclose = () => {
      console.warn("MCP client connection closed");
    };

    client.onerror = (error) => {
      console.error("MCP client connection error:", error);
    };

    try {
      await client.connect(transport);
      assertCurrent();
    } catch (error) {
      await client.close().catch(() => {});
      if (this.pendingClient === client) this.pendingClient = null;
      assertCurrent();
      if (error instanceof UnauthorizedError) {
        if (!allowAuth) {
          throw new McpAuthRequiredError(
            this.id,
            "expired",
            `Authorization for "${this.name}" expired again after a fresh token exchange`,
          );
        }

        // The transport has already called authProvider.redirectToAuthorization(),
        // opening the OAuth popup. Notify listeners and wait for the auth code.
        console.log(`[MCP OAuth] Authorization required for "${this.name}". Waiting for OAuth flow...`);
        this.onAuthenticating?.();

        let authCode: string;
        try {
          authCode = await this.authProvider.waitForAuthCode();
          assertCurrent();
        } catch (authError) {
          assertCurrent();
          this.onAuthComplete?.();
          throw authError;
        }

        try {
          await transport.finishAuth(authCode);
          assertCurrent();
        } catch (finishError) {
          assertCurrent();
          this.onAuthComplete?.();
          throw new McpAuthRequiredError(
            this.id,
            "failed",
            `Failed to complete authorization for "${this.name}": ${String(finishError)}`,
          );
        }
        this.onAuthComplete?.();

        console.log(`[MCP OAuth] Authorization complete for "${this.name}". Reconnecting...`);
        // Reconnect without allowing another auth round, so a repeat 401 fails fast.
        await this.connectInternal(false, version);
        return;
      }
      throw error;
    }

    console.log("MCP client connected");

    this.client = client;
    this.pendingClient = null;

    // Pick up the server-published icon when no config/agent icon was provided.
    if (!this._configIcon) {
      const serverIcons = client.getServerVersion()?.icons as McpIcon[] | undefined;
      this.icon = pickIcon(serverIcons) ?? this.iconUrl();
    }

    // Listen before discovery so changes during the initial scan are not lost.
    if (client.getServerCapabilities()?.tools?.listChanged) {
      client.setNotificationHandler("notifications/tools/list_changed", async () => {
        if (this.client !== client) return;
        await this.loadToolsAndInstructions(client);
        if (this.client === client) await this.notifyApps("tools");
      });
    }

    if (client.getServerCapabilities()?.resources?.listChanged) {
      client.setNotificationHandler("notifications/resources/list_changed", async () => {
        if (this.client === client) await this.notifyApps("resources");
      });
    }
    if (client.getServerCapabilities()?.prompts?.listChanged) {
      client.setNotificationHandler("notifications/prompts/list_changed", async () => {
        if (this.client === client) await this.notifyApps("prompts");
      });
    }

    // Register elicitation complete notification handler
    client.setNotificationHandler("notifications/elicitation/complete", (notification) => {
      if (this.client !== client) return;
      const { elicitationId } = notification.params;
      this.elicitations.get(elicitationId)?.context?.onElicitationComplete?.(elicitationId);
    });

    try {
      await this.loadToolsAndInstructions(client);
      assertCurrent();
      this.startPing();
    } catch (error) {
      if (this.client === client) await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    ++this.connectionVersion;
    this.authProvider.cancelAuthorization();
    this.connecting = undefined;
    this.stopPing();
    const clients = [this.client, this.pendingClient];
    this.client = null;
    this.pendingClient = null;
    this.tools = [];
    this.discovery = undefined;
    this.activeToolCalls.clear();
    this.elicitations.clear();
    this.toolDefinitions.clear();
    this.instructions = undefined;
    await this.closeApps();
    await Promise.allSettled(clients.flatMap((client) => (client ? [client.close()] : [])));
  }

  onDisconnected: (() => void) | null = null;

  private handleDisconnect(): void {
    void this.disconnect();
    this.onDisconnected?.();
  }

  private async closeApps(): Promise<void> {
    const sessions = [...this.appSessions];
    await Promise.allSettled(sessions.map((session) => session.close()));
  }

  private async notifyApps(kind: "tools" | "resources" | "prompts"): Promise<void> {
    await Promise.allSettled([...this.appSessions].map((session) => session.notify(kind)));
  }

  private loadToolsAndInstructions(client = this.client): Promise<void> {
    if (!client || this.client !== client) return Promise.resolve();
    if (this.discovery?.client === client) {
      this.discovery.dirty = true;
      return this.discovery.promise;
    }
    const discovery = { client, dirty: true, promise: Promise.resolve() };
    this.discovery = discovery;
    discovery.promise = Promise.resolve()
      .then(async () => {
        while (discovery.dirty && this.client === client) {
          discovery.dirty = false;
          const tools: MCPTool[] = [];
          if (client.getServerCapabilities()?.tools) {
            // The SDK walks every page itself and rejects runaway pagination (listMaxPages).
            const page = await client.listTools();
            if (this.client !== client) return;
            tools.push(...page.tools);
          }
          // A notification invalidates the entire scan, including earlier pages.
          if (discovery.dirty) continue;
          this.toolDefinitions = new Map(
            tools.flatMap((tool) => [[tool.name, tool] as const, [mcpToolName(this.id, tool.name), tool] as const]),
          );
          this.tools = tools.filter((tool) => !isToolVisibilityAppOnly(tool)).map((tool) => this.toTool(tool, client));
          this.instructions = client.getInstructions();
          this.onToolsChanged?.();
        }
      })
      .finally(() => {
        if (this.discovery === discovery) this.discovery = undefined;
      });
    return discovery.promise;
  }

  private toTool(tool: MCPTool, client: Client): Tool {
    let resourceUri: string | undefined;
    try {
      resourceUri = getToolUiResourceUri(tool);
    } catch (error) {
      console.warn(`Skipping invalid MCP UI resource URI for ${tool.name}:`, error);
    }
    return {
      name: mcpToolName(this.id, tool.name),
      title: tool.title ?? (tool.annotations as { title?: string } | undefined)?.title,
      icon: pickIcon(tool.icons as McpIcon[] | undefined) ?? (typeof this.icon === "string" ? this.icon : undefined),
      description: tool.description || "",
      parameters: tool.inputSchema || {},
      function: async (args, context) => {
        annotateMcpSpan(this.url, context);
        const result = await this.callTool(client, { name: tool.name, arguments: args }, context);
        context?.signal?.throwIfAborted();
        if (resourceUri) {
          const ui = tool._meta?.ui as { defaultDisplayMode?: string; availableDisplayModes?: string[] } | undefined;
          context?.setMeta?.({
            toolProvider: this.id,
            toolResource: resourceUri,
            ...(ui?.defaultDisplayMode ? { defaultDisplayMode: ui.defaultDisplayMode } : {}),
            ...(ui?.availableDisplayModes ? { appDisplayModes: ui.availableDisplayModes } : {}),
          });
        }
        // structuredContent is any JSON value on the wire; the UI context takes an object.
        const structured = result.structuredContent;
        if (structured && typeof structured === "object" && !Array.isArray(structured)) {
          context?.setContent?.(structured as Record<string, unknown>);
        }
        return processContent(result.content, client, context?.signal);
      },
    };
  }

  private async callTool(
    client: Client,
    params: CallToolRequest["params"],
    context?: ToolContext,
  ): Promise<CallToolResult> {
    if (this.client !== client) throw new Error("MCP connection changed; reload tools before calling");
    const call = { context };
    this.activeToolCalls.add(call);
    try {
      const result = await client.callTool(params, { signal: context?.signal });
      context?.signal?.throwIfAborted();
      if (this.client !== client) throw new Error("MCP connection changed during tool call");
      return "toolResult" in result ? (result.toolResult as CallToolResult) : (result as CallToolResult);
    } finally {
      this.activeToolCalls.delete(call);
      for (const [id, owner] of this.elicitations) {
        if (owner === call) this.elicitations.delete(id);
      }
    }
  }

  /**
   * Restore an MCP App UI from persisted chat data.
   * Fetches the UI resource, renders the iframe, and replays stored tool input + result.
   */
  async restoreToolUI(
    toolName: string,
    uiResourceUri: string,
    args: Record<string, unknown>,
    storedResult: (TextContent | ImageContent | AudioContent | FileContent)[],
    content: Record<string, unknown> | undefined,
    options: McpAppOptions,
  ): Promise<McpAppSession> {
    options.signal?.throwIfAborted();
    const client = this.client;
    if (!client) throw new Error("MCP client not connected");

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
      ...(content ? { structuredContent: content } : {}),
    };

    const tool = this.toolDefinitions.get(toolName);
    if (!tool) throw new Error(`MCP tool definition not found for ${toolName}`);
    if (!uiResourceUri.startsWith("ui://")) throw new Error(`Invalid MCP UI resource URI: ${uiResourceUri}`);
    // Fetch per opening: HTML may depend on the current server session or tool result.
    const readResult = await client.readResource({ uri: uiResourceUri }, { signal: options.signal });
    options.signal?.throwIfAborted();
    if (this.client !== client) throw new Error("MCP connection changed while opening app");
    const resource = toUiResourceEntry(uiResourceUri, readResult.contents);
    if (!resource) throw new Error(`Invalid UI resource for ${toolName}`);
    const capabilities = client.getServerCapabilities();
    const session = new McpAppSession({
      ...options,
      tool,
      resource,
      result,
      input: args,
      capabilities: buildHostCapabilities(
        resource.meta,
        capabilities,
        !!options.context?.sendMessage,
        !!options.context?.setContext,
      ),
      handlers: {
        ...(capabilities?.tools
          ? {
              oncalltool: async (params, extra) => {
                const definition = this.toolDefinitions.get(params.name);
                if (!definition || definition.name !== params.name || isToolVisibilityModelOnly(definition)) {
                  throw new ProtocolError(ProtocolErrorCode.InvalidRequest, "Tool is not available to this app");
                }
                return this.callTool(client, params, { signal: extra.mcpReq.signal });
              },
            }
          : {}),
        ...(capabilities?.resources
          ? {
              onlistresources: (params, extra) => client.listResources(params, { signal: extra.mcpReq.signal }),
              onreadresource: (params, extra) => client.readResource(params, { signal: extra.mcpReq.signal }),
              onlistresourcetemplates: (params, extra) =>
                client.listResourceTemplates(params, { signal: extra.mcpReq.signal }),
            }
          : {}),
        ...(capabilities?.prompts
          ? { onlistprompts: (params, extra) => client.listPrompts(params, { signal: extra.mcpReq.signal }) }
          : {}),
      },
      onClose: () => this.appSessions.delete(session),
    });
    this.appSessions.add(session);
    try {
      await session.connect();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  private startPing(): void {
    // Clear any existing interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Ping every 20 seconds
    this.pingInterval = setInterval(async () => {
      const client = this.client;
      if (client) {
        try {
          await client.ping();
        } catch (error) {
          console.error("MCP client ping failed:", error);
          if (this.client === client) this.handleDisconnect();
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

  isAuthBlocked(): boolean {
    return this.authProvider.isAuthBlocked();
  }
}

type ToolResultContent = TextContent | ImageContent | AudioContent | FileContent;

/** Derive a download filename from a resource URI (e.g. "runs://id/chart.png" -> "chart.png"). */
function filenameFromUri(uri: string | undefined, fallback = "resource"): string {
  const segment = uri?.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  if (!segment) return fallback;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Convert MCP resource contents (embedded, or fetched via resources/read) into a
 * displayable block. Images/audio are surfaced as such (inline preview); everything
 * else becomes a file (type-specific preview + download button).
 */
function resourceToContent(res: MCPResourceContents, fallbackName?: string): ToolResultContent | null {
  const mimeType = (res.mimeType as string | undefined) || "application/octet-stream";
  const name = fallbackName ?? filenameFromUri(res.uri as string | undefined);

  let data: string;
  if ("blob" in res && typeof res.blob === "string") {
    data = `data:${mimeType};base64,${res.blob}`; // resource blobs are already base64
  } else if ("text" in res && typeof res.text === "string") {
    data = textToDataUrl(res.text, mimeType);
  } else {
    return null;
  }

  if (mimeType.startsWith("image/")) return { type: "image", name, data };
  if (mimeType.startsWith("audio/")) return { type: "audio", name, data };
  return { type: "file", name, data };
}

/**
 * Fetch a resource_link's bytes via resources/read and map them. Resources can be
 * session-scoped and discarded after the run, so we fetch eagerly here (while alive)
 * rather than lazily on click. Falls back to a text marker if the fetch fails.
 */
async function resolveResourceLink(
  block: Extract<MCPContentBlock, { type: "resource_link" }>,
  client?: Client | null,
  signal?: AbortSignal,
): Promise<ToolResultContent[]> {
  const label = block.name || block.uri;
  if (!client) {
    return [{ type: "text", text: `[Resource: ${label}]` }];
  }
  try {
    const read = await client.readResource({ uri: block.uri }, { signal });
    signal?.throwIfAborted();
    const mapped = ((read.contents ?? []) as MCPResourceContents[])
      .map((c) => resourceToContent(c, block.name))
      .filter((c): c is ToolResultContent => c !== null);
    return mapped.length ? mapped : [{ type: "text", text: `[Resource: ${label}]` }];
  } catch (error) {
    signal?.throwIfAborted();
    console.error("Failed to read MCP resource link", block.uri, error);
    return [{ type: "text", text: `Could not load resource: ${label}` }];
  }
}

/** Map a single MCP content block to zero or more displayable blocks. */
async function processBlock(
  block: MCPContentBlock,
  client?: Client | null,
  signal?: AbortSignal,
): Promise<ToolResultContent[]> {
  switch (block.type) {
    case "text":
      return [{ type: "text", text: block.text || "" }];
    case "image":
      return [{ type: "image", data: `data:${block.mimeType || "image/png"};base64,${block.data || ""}` }];
    case "audio":
      return [{ type: "audio", data: `data:${block.mimeType || "audio/mpeg"};base64,${block.data || ""}` }];
    case "resource": {
      const mapped = resourceToContent(block.resource);
      return mapped ? [mapped] : [];
    }
    case "resource_link":
      return resolveResourceLink(block, client, signal);
    default:
      return [];
  }
}

async function processContent(
  input: MCPContentBlock[],
  client?: Client | null,
  signal?: AbortSignal,
): Promise<ToolResultContent[]> {
  if (!input?.length) {
    return [{ type: "text", text: "no content" }];
  }

  // Resource links resolve in parallel; original order is preserved.
  const result = (await Promise.all(input.map((block) => processBlock(block, client, signal)))).flat();

  return result.length ? result : [{ type: "text", text: JSON.stringify(input.length === 1 ? input[0] : input) }];
}

function annotateMcpSpan(serverUrl: string, toolContext?: ToolContext): void {
  const span = toolContext?.agentContext ? trace.getSpan(toolContext.agentContext) : trace.getActiveSpan();
  if (!span) return;

  span.setAttribute("mcp.method.name", "tools/call");
  span.setAttribute("url.full", serverUrl);

  try {
    const url = new URL(serverUrl);
    if (url.hostname) span.setAttribute("server.address", url.hostname);
    if (url.port) span.setAttribute("server.port", Number(url.port));
    if (url.protocol) span.setAttribute("network.protocol.name", url.protocol.replace(":", ""));
  } catch {
    // Malformed URL — skip the standard server.* attributes.
  }
}

function normalizeRequestedSchema(
  schema:
    | {
        $schema?: string;
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
      }
    | undefined,
): ElicitationSchema | undefined {
  if (!schema) return undefined;
  return {
    $schema: schema.$schema,
    type: "object",
    properties: schema.properties as ElicitationSchema["properties"],
    required: schema.required,
  };
}
