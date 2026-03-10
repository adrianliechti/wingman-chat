import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as ClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, ContentBlock as MCPContentBlock, ResourceContents as MCPResourceContents, Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { AppBridge, PostMessageTransport, RESOURCE_MIME_TYPE, getToolUiResourceUri, isToolVisibilityAppOnly } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostCapabilities, McpUiHostContext, McpUiResourceMeta } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Role, type Tool, type ToolContext, type ToolProvider, type TextContent, type ImageContent, type AudioContent, type FileContent, type Message } from '@/shared/types/chat';

const HOST_INFO = {
  name: 'Wingman Chat',
  version: '1.0.0',
};

const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui';

type UiResourceEntry = {
  uri: string;
  content: MCPResourceContents;
  meta?: McpUiResourceMeta;
};

type McpServerCapabilities = NonNullable<ReturnType<Client['getServerCapabilities']>>;

export class MCPClient implements ToolProvider {
  readonly id: string;
  readonly url: string;

  readonly name: string;
  readonly description?: string;
  
  icon?: string;

  readonly headers?: Record<string, string>;

  private client: Client | null = null;
  private activeBridge: AppBridge | null = null;
  
  private pingInterval: ReturnType<typeof setInterval> | undefined;

  instructions?: string;

  tools: Tool[] = [];
  uiResources: Map<string, UiResourceEntry> = new Map();
  toolDefinitions: Map<string, MCPTool> = new Map();

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
    };

    const url = new URL(this.url);
    const transport = new ClientTransport(url, opts);

    const client = new Client(HOST_INFO, {
      capabilities: {
        extensions: {
          [MCP_UI_EXTENSION]: {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      } as never,
    });

    // Setup error and close handlers
    client.onclose = () => {
      console.warn('MCP client connection closed');
      //this.handleDisconnect();
    };

    client.onerror = (error) => {
      console.error('MCP client connection error:', error);
      //this.handleDisconnect();
    };

    await client.connect(transport);

    console.log('MCP client connected');
    
    this.client = client;

    // Load and store tools and instructions after connection
    await this.loadToolsAndInstructions();

    this.startPing();
  }
  
  async disconnect(): Promise<void> {
    this.stopPing();
    await this.cleanupActiveBridge();
    
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('Error disconnecting MCP client:', error);
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
      console.error('Error closing MCP app bridge:', error);
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
        .map((tool) => ({
        name: tool.name,

        description: tool.description || "",
        parameters: tool.inputSchema || {},

        function: async (args: Record<string, unknown>, context?: ToolContext) => {
          if (!this.client) {
            throw new Error('MCP client not connected');
          }

          const result = await this.client.callTool({
            name: tool.name,
            arguments: args
          });
          
          // Handle both current and compatibility result formats
          // Compatibility format has toolResult field, current has content field
          const normalizedResult: CallToolResult = 'toolResult' in result
            ? (result.toolResult as CallToolResult) 
            : (result as CallToolResult);
          
          const resource = this.uiResources.get(tool.name);
          
          if (resource && context?.render) {
            await this.renderToolUI(tool.name, resource, normalizedResult, args, context);
            context.setMeta?.({ toolProvider: this.id, toolResource: resource.uri });
          }
          
          return processContent(normalizedResult.content as MCPContentBlock[]);
        },
      }));
      
      // Load resources for tools that have ui/resourceUri meta field
      await this.loadUIResources(tools);
    } catch (error) {
      console.error('Error loading tools and instructions:', error);
    }
  }
  
  private async renderToolUI(
    toolName: string,
    resource: UiResourceEntry,
    result: CallToolResult,
    args: Record<string, unknown>,
    context: ToolContext
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
      { hostContext: buildHostContext(toolDefinition, iframe) }
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
        console.error('Error closing MCP app bridge:', error);
      }
    });
    
    const transport = new PostMessageTransport(
      iframe.contentWindow!,
      iframe.contentWindow!,
    );
    
    bridge.onsandboxready = () => {
      bridge.sendSandboxResourceReady({
        html: getHtmlContent(resource.content),
        sandbox: 'allow-scripts',
        csp: resource.meta?.csp,
        permissions: resource.meta?.permissions,
      }).catch((error) => {
        console.error(`Failed to load sandbox resource for ${toolName}:`, error);
      });
    };

    bridge.oninitialized = () => {
      console.log('Guest UI initialized for tool:', toolName);
      bridge.sendToolInput({ arguments: args })
        .then(() => bridge.sendToolResult(result))
        .catch((error) => {
          console.error(`Failed to send MCP app data for ${toolName}:`, error);
        });
    };

    bridge.onsizechange = ({ width, height }) => {
      if (typeof width === 'number' && width > 0) {
        iframe.style.width = `${width}px`;
      }

      if (typeof height === 'number' && height > 0) {
        iframe.style.height = `${height}px`;
      }
    };

    bridge.onopenlink = async ({ url }) => {
      if (!isSafeExternalUrl(url)) {
        return { isError: true };
      }

      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      return opened ? {} : { isError: true };
    };

    bridge.onrequestdisplaymode = async () => ({ mode: 'inline' });

    bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
      try {
        if (!context.setContext) {
          throw new Error('setContext is not supported by the host context');
        }

        await context.setContext(serializeModelContext(content, structuredContent));
        return {};
      } catch (error) {
        console.error(`Failed to update model context for ${toolName}:`, error);
        throw error instanceof Error ? error : new Error('Failed to update model context');
      }
    };

    bridge.onmessage = async ({ role, content }) => {
      if (!context.sendMessage || role !== 'user') {
        return { isError: true };
      }

      const textBlocks = content.filter((block): block is Extract<MCPContentBlock, { type: 'text' }> => block.type === 'text');

      if (textBlocks.length !== content.length || textBlocks.length === 0) {
        return { isError: true };
      }

      const message: Message = {
        role: Role.User,
        content: textBlocks.map((block) => ({
          type: 'text',
          text: block.text ?? '',
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
      const prefix = logger ? `[${logger}]` : '[MCP App]';
      const line = `${prefix} ${level}`;

      if (level === 'error' || level === 'critical' || level === 'alert' || level === 'emergency') {
        console.error(line, data);
        return;
      }

      if (level === 'warning') {
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
  ): Promise<void> {
    if (!this.client) {
      throw new Error('MCP client not connected');
    }

    // Convert stored content back to MCP CallToolResult format
    const result: CallToolResult = {
      content: storedResult.map(c => {
        if (c.type === 'text') return { type: 'text' as const, text: c.text };
        if (c.type === 'image') {
          const match = c.data?.match(/^data:([^;]+);base64,(.+)$/);
          if (match) return { type: 'image' as const, mimeType: match[1], data: match[2] };
        }
        return { type: 'text' as const, text: JSON.stringify(c) };
      }),
    };

    // Try to use cached resource, otherwise re-fetch
    let resource = this.uiResources.get(toolName);
    if (!resource) {
      try {
        const readResult = await this.client.readResource({ uri: uiResourceUri });
        const content = readResult.contents[0];
        if (!content || content.mimeType !== RESOURCE_MIME_TYPE || !content.uri?.startsWith('ui://')) {
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

    await this.renderToolUI(toolName, resource, result, args, context);
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
          const content = result.contents[0];

          if (!content || content.mimeType !== RESOURCE_MIME_TYPE || !content.uri?.startsWith('ui://')) {
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
      })
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
          console.error('MCP client ping failed:', error);
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
}

type ToolResultContent = TextContent | ImageContent | AudioContent | FileContent;

function processContent(input: MCPContentBlock[]): ToolResultContent[] {
  if (!input?.length) {
    return [{ type: 'text' as const, text: 'no content' }];
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

  return result.length ? result : [{ type: 'text' as const, text: JSON.stringify(input.length === 1 ? input[0] : input) }];
}

function getHtmlContent(resource: MCPResourceContents): string {
  if ('text' in resource && typeof resource.text === 'string') {
    return resource.text;
  }

  if ('blob' in resource && typeof resource.blob === 'string') {
    return atob(resource.blob);
  }

  return '<!doctype html><html><body>No content available.</body></html>';
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

function buildHostContext(tool: MCPTool, iframe: HTMLIFrameElement): McpUiHostContext {
  const isDark = document.documentElement.classList.contains('dark');
  const width = iframe.clientWidth || undefined;
  const height = iframe.clientHeight || undefined;

  return {
    toolInfo: { tool },
    theme: isDark ? 'dark' : 'light',
    styles: {
      variables: {
        '--color-background-primary': isDark ? '#0a0a0a' : '#ffffff',
        '--color-text-primary': isDark ? '#fafafa' : '#171717',
        '--color-border-primary': isDark ? '#404040' : '#d4d4d4',
        '--font-sans': 'ui-sans-serif, system-ui, sans-serif',
        '--font-mono': 'ui-monospace, SFMono-Regular, monospace',
      } as NonNullable<NonNullable<McpUiHostContext['styles']>['variables']>,
    },
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    containerDimensions: {
      ...(typeof width === 'number' ? { maxWidth: width } : {}),
      ...(typeof height === 'number' ? { maxHeight: height } : {}),
    },
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent,
    platform: window.innerWidth < 768 ? 'mobile' : 'web',
    deviceCapabilities: {
      touch: window.matchMedia('(pointer: coarse)').matches,
      hover: window.matchMedia('(hover: hover)').matches,
    },
  };
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
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

  return textParts.join('\n\n');
}

function serializeModelContextBlock(block: MCPContentBlock): string | null {
  if (block.type === 'text') {
    const text = block.text?.trim();
    return text ? text : null;
  }

  if (block.type === 'image') {
    return `[Image context: ${block.mimeType ?? 'image'}]`;
  }

  if (block.type === 'audio') {
    return `[Audio context: ${block.mimeType ?? 'audio'}]`;
  }

  if (block.type === 'resource_link') {
    return `[Resource link context: ${block.uri}]`;
  }

  if (block.type === 'resource') {
    return `[Embedded resource context: ${block.resource?.uri ?? 'resource'}]`;
  }

  return JSON.stringify(block);
}