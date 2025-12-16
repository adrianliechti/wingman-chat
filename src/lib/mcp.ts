import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { Content, Tool, ToolProvider } from '../types/chat';
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
    const transport = new StreamableHTTPClientTransport(url, opts);

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
      this.instructions = undefined;
    }
  }
  
  private handleDisconnect(): void {
    this.stopPing();
    this.client = null;
    this.tools = [];
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

        function: async (args: Record<string, unknown>) => {
          if (!this.client) {
            throw new Error('MCP client not connected');
          }

          try {
            const result = await this.client.callTool({
              name: tool.name,
              arguments: args
            });
            
            return processContent(result?.content as ContentBlock[])
          } catch (error) {
            console.error(`Error calling MCP tool ${tool.name}:`, error);
            throw error;
          }
        },
      }));
    } catch (error) {
      console.error('Error loading tools and instructions:', error);
    }
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

function processContent(input: ContentBlock[]): string | Content[] {
  if (!input || input.length === 0) {
    return "no content";
  }

  if (input.length === 1 && input[0].type === "text") {
    return input[0].text || "";
  }

  const result: Content[] = input
    .map(block => {
      switch (block.type) {
        case "text":
          return {
            type: "text" as const,
            text: block.text || ""
          };
        
        case "image":
          return {
            type: "image" as const,
            data: block.data || "",
            mimeType: block.mimeType || "image/png"
          };
        
        default:
          return null;
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (result.length === 0) {
    if (input.length === 1) {
      return JSON.stringify(input[0]);
    }
    return JSON.stringify(input);
  }

  return result;
}