import { z } from "zod";
import {
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  ProtocolError,
  ProtocolErrorCode,
  StreamableHTTPClientTransport as ClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type {
  CallToolRequest,
  CallToolResult,
  ElicitRequest,
  ElicitResult,
  Transport,
  ContentBlock as MCPContentBlock,
  ResourceContents as MCPResourceContents,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";
import { createMCPClient, type MCPClient as NativeMCPClient } from "@tanstack/ai-mcp";
import { browserMcpTransport } from "./mcpTransport";
import { trace } from "@opentelemetry/api";
import { withAbort } from "@/shared/lib/abortSignals";
import { textToDataUrl } from "@/shared/lib/fileContent";
import type { ContentPart } from "@tanstack/ai";
import { mediaDataUrl, mediaFromDataUrl } from "@/shared/lib/messages";
import { type Tool, type ToolContext, type ToolIcon, type ToolProvider } from "@/shared/types/chat";
import type { ElicitationSchema } from "@/shared/types/elicitation";
import { BrowserOAuthClientProvider, McpAuthRequiredError } from "./mcpAuth";
import { mcpToolName } from "./mcpToolNames";

import {
  buildHostCapabilities,
  toAppToolResult,
  type McpAppData,
  MCP_HOST_INFO as HOST_INFO,
  type McpAppOptions,
  type UiResourceEntry,
  getHtmlContent,
  type AppNotification,
} from "./mcpAppSession";

const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";

function toUiResourceEntry(uri: string, contents: MCPResourceContents[]): UiResourceEntry | null {
  const content = contents.find((entry) => entry.mimeType === RESOURCE_MIME_TYPE && entry.uri === uri);
  if (!content) return null;
  return { uri, content, meta: content._meta?.ui as McpUiResourceMeta | undefined };
}

type McpIcon = { src: string; theme?: "light" | "dark" };
type ActiveToolCall = { context?: ToolContext };
function pickIcon(icons?: McpIcon[]): string | undefined {
  return (icons?.find((icon) => icon.theme === "light") ?? icons?.find((icon) => !icon.theme) ?? icons?.[0])?.src;
}

/** Browser authentication and Wingman's tool/storage boundary around TanStack MCP. */
export class MCPClient implements ToolProvider {
  icon?: ToolIcon;
  instructions?: string;
  tools: Tool[] = [];
  toolDefinitions = new Map<string, MCPTool>();
  onAuthenticating: (() => void) | null = null;
  onAuthComplete: (() => void) | null = null;
  onToolsChanged: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;
  private client: NativeMCPClient | null = null;
  private pendingTransport?: Transport;
  private connectionVersion = 0;
  private connecting?: Promise<void>;
  private readonly authProvider: BrowserOAuthClientProvider;
  private readonly activeToolCalls = new Set<ActiveToolCall>();
  private readonly elicitations = new Map<string, ActiveToolCall>();
  private readonly appListeners = new Set<(kind: AppNotification) => void>();
  private discovery?: { client: NativeMCPClient; dirty: boolean; promise: Promise<void> };

  readonly id: string;
  readonly url: string;
  readonly name: string;
  readonly description: string;
  readonly headers?: Record<string, string>;
  private readonly configIcon?: ToolIcon;

  constructor(
    id: string,
    url: string,
    name: string,
    description: string,
    headers?: Record<string, string>,
    configIcon?: ToolIcon,
  ) {
    this.id = id;
    this.url = url;
    this.name = name;
    this.description = description;
    this.headers = headers;
    this.configIcon = configIcon;
    this.icon = configIcon ?? new URL("icon", url.endsWith("/") ? url : `${url}/`).href;
    this.authProvider = new BrowserOAuthClientProvider(id);
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
    const assertCurrent = () => {
      if (this.connectionVersion !== version) throw new DOMException("MCP connection cancelled", "AbortError");
    };
    const transport = new ClientTransport(new URL(this.url), {
      authProvider: this.authProvider,
      requestInit: this.headers ? { headers: this.headers } : undefined,
    });
    this.pendingTransport = transport;
    const definitions = new Map<string, MCPTool>();
    let client: NativeMCPClient;
    try {
      client = await createMCPClient({
        name: HOST_INFO.name,
        version: HOST_INFO.version,
        transport: browserMcpTransport(transport, {
          elicit: (params) => {
            assertCurrent();
            return this.elicit(params);
          },
          initialized: ({ instructions, serverInfo }) => {
            if (this.connectionVersion !== version) return;
            this.instructions = instructions;
            if (!this.configIcon) this.icon = pickIcon(serverInfo?.icons) ?? this.icon;
          },
          notification: (method, params) => {
            if (this.connectionVersion !== version) return;
            if (method === "notifications/tools/list_changed") {
              void this.loadTools(client, definitions)
                .then(() => this.notifyApps("tools"))
                .catch(console.error);
            } else if (method === "notifications/resources/list_changed") this.notifyApps("resources");
            else if (method === "notifications/prompts/list_changed") this.notifyApps("prompts");
            else if (method === "notifications/elicitation/complete" && typeof params?.elicitationId === "string") {
              this.elicitations.get(params.elicitationId)?.context?.onElicitationComplete?.(params.elicitationId);
            }
          },
          closed: () => {
            if (this.connectionVersion === version && this.client) {
              void this.disconnect();
              this.onDisconnected?.();
            }
          },
        }),
        clientOptions: {
          capabilities: {
            elicitation: { form: {}, url: {} },
            // TanStack declares sampling by default; Wingman cannot answer it.
            sampling: undefined,
            extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
          },
        },
        // Retain the server's full app metadata; TanStack's public tool metadata
        // intentionally contains only the fields needed for model execution.
        toolFilter: (tool) => {
          definitions.set(tool.name, tool);
          return true;
        },
      });
      if (this.connectionVersion !== version) {
        await client.close();
        assertCurrent();
      }
    } catch (error) {
      await transport.close().catch(() => {});
      if (this.pendingTransport === transport) this.pendingTransport = undefined;
      assertCurrent();
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (!(cause instanceof UnauthorizedError)) throw error;
      if (!allowAuth)
        throw new McpAuthRequiredError(
          this.id,
          "expired",
          `Authorization for "${this.name}" expired again after a fresh token exchange`,
        );
      this.onAuthenticating?.();
      try {
        const code = await this.authProvider.waitForAuthCode();
        assertCurrent();
        await transport.finishAuth(code);
        assertCurrent();
      } finally {
        if (this.connectionVersion === version) this.onAuthComplete?.();
      }
      await this.connectInternal(false, version);
      return;
    }
    this.client = client;
    this.pendingTransport = undefined;
    try {
      await this.loadTools(client, definitions);
      assertCurrent();
    } catch (error) {
      if (this.client === client) await this.disconnect();
      throw error;
    }
  }

  private async elicit(params: ElicitRequest["params"]): Promise<ElicitResult> {
    const [call] = this.activeToolCalls;
    const context = call?.context;
    if (this.activeToolCalls.size !== 1 || !context?.elicit || context.signal?.aborted) {
      throw new Error("Elicitation requires a single active tool context");
    }
    if (params.mode === "url") {
      this.elicitations.set(params.elicitationId, call);
      try {
        const result = await context.elicit({
          mode: "url",
          message: params.message,
          url: params.url,
          elicitationId: params.elicitationId,
        });
        return { action: result.action };
      } finally {
        this.elicitations.delete(params.elicitationId);
      }
    }
    return context.elicit({
      message: params.message,
      requestedSchema: normalizeRequestedSchema(params.requestedSchema),
    });
  }

  async disconnect(): Promise<void> {
    ++this.connectionVersion;
    this.authProvider.cancelAuthorization();
    this.connecting = undefined;
    const client = this.client;
    const transport = this.pendingTransport;
    this.client = null;
    this.pendingTransport = undefined;
    this.tools = [];
    this.instructions = undefined;
    this.discovery = undefined;
    this.toolDefinitions.clear();
    this.activeToolCalls.clear();
    this.elicitations.clear();
    this.notifyApps("disconnect");
    this.appListeners.clear();
    await Promise.allSettled([client?.close(), transport?.close()]);
  }

  private notifyApps(kind: AppNotification): void {
    for (const listener of this.appListeners) listener(kind);
  }

  private loadTools(client: NativeMCPClient | undefined, definitions: Map<string, MCPTool>): Promise<void> {
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
          definitions.clear();
          const nativeTools = client.capabilities.tools ? await client.tools() : [];
          if (this.client !== client) return;
          if (discovery.dirty) continue;
          this.toolDefinitions = new Map(
            [...definitions.values()].flatMap((tool) => [
              [tool.name, tool],
              [mcpToolName(this.id, tool.name), tool],
            ]),
          );
          this.tools = nativeTools.flatMap((native) => {
            const tool = definitions.get(native.metadata.mcp.serverToolName);
            return tool && !isToolVisibilityAppOnly(tool) ? [this.toTool(tool, client)] : [];
          });
          this.onToolsChanged?.();
        }
      })
      .finally(() => {
        if (this.discovery === discovery) this.discovery = undefined;
      });
    return discovery.promise;
  }
  private toTool(tool: MCPTool, client: NativeMCPClient): Tool {
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
      inputSchema: z.fromJSONSchema(tool.inputSchema as Record<string, unknown>),
      execute: async (args, execution) => {
        const context = execution?.context;
        annotateMcpSpan(this.url, context);
        const result = await this.callTool(client, { name: tool.name, arguments: args }, context);
        context?.signal?.throwIfAborted();
        if (result.isError) {
          context?.setError?.({
            code: "MCP_TOOL_ERROR",
            message:
              result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ||
              `MCP tool "${tool.name}" returned an error`,
          });
        }
        if (resourceUri) {
          const ui = tool._meta?.ui as { defaultDisplayMode?: string; availableDisplayModes?: string[] } | undefined;
          context?.setMeta?.({
            toolProvider: this.id,
            toolResource: resourceUri,
            mcpResult: result,
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
    client: NativeMCPClient,
    params: CallToolRequest["params"],
    context?: ToolContext,
  ): Promise<CallToolResult> {
    if (this.client !== client) throw new Error("MCP connection changed; reload tools before calling");
    const call = { context };
    this.activeToolCalls.add(call);
    try {
      const result = await client.callTool(params.name, params.arguments, { signal: context?.signal });
      context?.signal?.throwIfAborted();
      if (this.client !== client) throw new Error("MCP connection changed during tool call");
      return result as CallToolResult;
    } finally {
      this.activeToolCalls.delete(call);
      for (const [id, owner] of this.elicitations) {
        if (owner === call) this.elicitations.delete(id);
      }
    }
  }

  async restoreToolUI(
    toolName: string,
    uiResourceUri: string,
    args: Record<string, unknown>,
    storedResult: ContentPart[],
    content: Record<string, unknown> | undefined,
    options: McpAppOptions,
  ): Promise<McpAppData> {
    options.signal?.throwIfAborted();
    const client = this.client;
    if (!client) throw new Error("MCP client not connected");

    // Convert stored content back to MCP CallToolResult format
    const result: CallToolResult = options.initialResult ?? {
      content: storedResult.map((c) => {
        if (c.type === "text") return { type: "text" as const, text: c.content };
        if (c.type === "image") {
          const match = mediaDataUrl(c)?.match(/^data:([^;]+);base64,(.+)$/);
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
    const readResult = await readResource(client, uiResourceUri, options.signal);
    options.signal?.throwIfAborted();
    if (this.client !== client) throw new Error("MCP connection changed while opening app");
    const resource = toUiResourceEntry(uiResourceUri, readResult.contents);
    if (!resource) throw new Error(`Invalid UI resource for ${toolName}`);
    const capabilities = client.capabilities;
    return {
      tool,
      input: args,
      result: toAppToolResult(result),
      html: getHtmlContent(resource.content),
      resource,
      capabilities: buildHostCapabilities(resource.meta, capabilities),
      handlers: {
        oncalltool: async (params, extra) => {
          const definition = this.toolDefinitions.get(params.name);
          if (!definition || definition.name !== params.name || isToolVisibilityModelOnly(definition))
            throw new ProtocolError(ProtocolErrorCode.InvalidRequest, "Tool is not available to this app");
          return toAppToolResult(await this.callTool(client, params, { signal: extra.signal }));
        },
        onlistresources: async () => ({ resources: await client.resources() }),
        onreadresource: async ({ uri }) => client.readResource(uri),
        onlistresourcetemplates: async () => ({ resourceTemplates: await client.resourceTemplates() }),
        onlistprompts: async () => ({ prompts: await client.prompts() }),
      },
      subscribe: (listener) => {
        this.appListeners.add(listener);
        return () => {
          this.appListeners.delete(listener);
        };
      },
    };
  }

  isConnected(): boolean {
    return this.client !== null;
  }
  isAuthBlocked(): boolean {
    return this.authProvider.isAuthBlocked();
  }
}

// TanStack's readResource currently has no signal parameter. Stop waiting and
// prevent stale results from reaching the UI when the owning run is cancelled.
function readResource(client: NativeMCPClient, uri: string, signal?: AbortSignal) {
  return signal ? withAbort(signal, () => client.readResource(uri)) : client.readResource(uri);
}

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
function resourceToContent(res: MCPResourceContents, fallbackName?: string): ContentPart | null {
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

  return mediaFromDataUrl(
    data,
    name,
    mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : "document",
  );
}

/**
 * Fetch a resource_link's bytes via resources/read and map them. Resources can be
 * session-scoped and discarded after the run, so we fetch eagerly here (while alive)
 * rather than lazily on click. Falls back to a text marker if the fetch fails.
 */
async function resolveResourceLink(
  block: Extract<MCPContentBlock, { type: "resource_link" }>,
  client?: NativeMCPClient | null,
  signal?: AbortSignal,
): Promise<ContentPart[]> {
  const label = block.name || block.uri;
  if (!client) {
    return [{ type: "text", content: `[Resource: ${label}]` }];
  }
  try {
    const read = await readResource(client, block.uri, signal);
    signal?.throwIfAborted();
    const mapped = ((read.contents ?? []) as MCPResourceContents[])
      .map((c) => resourceToContent(c, block.name))
      .filter((c): c is ContentPart => c !== null);
    return mapped.length ? mapped : [{ type: "text", content: `[Resource: ${label}]` }];
  } catch (error) {
    signal?.throwIfAborted();
    console.error("Failed to read MCP resource link", block.uri, error);
    return [{ type: "text", content: `Could not load resource: ${label}` }];
  }
}

/** Map a single MCP content block to zero or more displayable blocks. */
async function processBlock(
  block: MCPContentBlock,
  client?: NativeMCPClient | null,
  signal?: AbortSignal,
): Promise<ContentPart[]> {
  switch (block.type) {
    case "text":
      return [{ type: "text", content: block.text || "" }];
    case "image":
      return [mediaFromDataUrl(`data:${block.mimeType || "image/png"};base64,${block.data || ""}`, undefined, "image")];
    case "audio":
      return [
        mediaFromDataUrl(`data:${block.mimeType || "audio/mpeg"};base64,${block.data || ""}`, undefined, "audio"),
      ];
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
  client?: NativeMCPClient | null,
  signal?: AbortSignal,
): Promise<ContentPart[]> {
  if (!input?.length) {
    return [{ type: "text", content: "no content" }];
  }

  // Resource links resolve in parallel; original order is preserved.
  const result = (await Promise.all(input.map((block) => processBlock(block, client, signal)))).flat();

  return result.length ? result : [{ type: "text", content: JSON.stringify(input.length === 1 ? input[0] : input) }];
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
