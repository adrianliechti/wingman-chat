import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as ClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, ContentBlock as MCPContentBlock, ResourceContents as MCPResourceContents, Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Content, Tool, ToolContext, ToolProvider } from '../types/chat';
import { Rocket } from "lucide-react";

export class MCPClient implements ToolProvider {
  readonly id: string;
  readonly url: string;

  readonly name: string;
  readonly description?: string;
  
  readonly icon = Rocket;

  private client: Client | null = null;
  
  private pingInterval: ReturnType<typeof setInterval> | undefined;

  instructions?: string;

  tools: Tool[] = [];
  uiResources: Map<string, MCPResourceContents> = new Map();

  constructor(
    id: string, 
    url: string, 
    name: string, 
    description: string
  ) {
    this.id = id;
    this.url = url;
    
    this.name = name;
    this.description = description;
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
      }
    };

    const url = new URL(this.url);
    const transport = new ClientTransport(url, opts);

    const client = new Client({
      name: 'Wingman Chat',
      version: '1.0.0'
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
  
  private handleDisconnect(): void {
    this.stopPing();
    this.client = null;
    this.tools = [];
    this.uiResources.clear();
    this.instructions = undefined;
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

      this.tools = tools.map((tool) => ({
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
            await this.renderToolUI(tool.name, resource, normalizedResult, context);
            return "The tool result has been rendered in an interactive UI component and is now visible to the user.";
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
    resource: MCPResourceContents,
    result: CallToolResult,
    context: ToolContext
  ): Promise<void> {
    const iframe = await context.render!();
    
    const bridge = new AppBridge(
      this.client!,
      { name: "Wingman Chat", version: "1.0.0" },
      { openLinks: {}, serverTools: {}, logging: {} }
    );
    
    const transport = new PostMessageTransport(
      iframe.contentWindow!,
      iframe.contentWindow!,
    );
    
    bridge.oninitialized = () => {
      console.log("Guest UI initialized for tool:", toolName);
      bridge.sendToolResult(result);
    };
    
    await bridge.connect(transport);
    
    const htmlContent = 'text' in resource
      ? (resource.text as string)
      : 'blob' in resource
        ? atob(resource.blob as string)
        : '<html><body>No content available</body></html>';
    
    iframe.contentWindow!.document.open();
    iframe.contentWindow!.document.writeln(htmlContent);
    iframe.contentWindow!.document.close();
  }
  
  private async loadUIResources(tools: MCPTool[]): Promise<void> {
    if (!this.client) {
      return;
    }

    // Collect unique resource URIs and their associated tool names
    const uriToTools = new Map<string, string[]>();
    
    for (const tool of tools) {
      const resourceUri = tool._meta?.['ui/resourceUri'] as string | undefined;

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

          if (content) {
            for (const toolName of toolNames) {
              this.uiResources.set(toolName, content);
            }
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

    // Ping every 30 seconds
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

function processContent(input: MCPContentBlock[]): string | Content[] {
  if (!input?.length) {
    return "no content";
  }

  if (input.length === 1 && input[0].type === "text") {
    return input[0].text || "";
  }

  const result: Content[] = input
    .map(block => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text || "" };
      }

      if (block.type === "image") {
        return { type: "image" as const, data: block.data || "", mimeType: block.mimeType || "image/png" };
      }

      return null;
    })
    .filter(c => c !== null);

  return result.length ? result : JSON.stringify(input.length === 1 ? input[0] : input);
}