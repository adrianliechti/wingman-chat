import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { Tool, ToolProvider } from '../types/chat';
import { Rocket } from "lucide-react";

/**
 * Process MCP content blocks into a string response
 */
function processContent(content: ContentBlock[]): string {
  if (!content || content.length === 0) {
    return "no content";
  }

  if (content.every(item => item.type === "text")) {
    return content
      .map(item => item.text)
      .filter(text => text.trim() !== "")
      .join("\n\n");
  }

  if (content.length === 1) {
    return JSON.stringify(content[0]);
  }

  return JSON.stringify(content);
}

/**
 * MCP Client that implements ToolProvider interface
 * Handles connection to a single MCP server
 */
export class MCPClient implements ToolProvider {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon = Rocket;

  private client: Client | null = null;
  private serverUrl: string;
  private pingInterval: ReturnType<typeof setInterval> | undefined;
  
  isEnabled: boolean = false;
  isInitializing: boolean = false;

  constructor(id: string, name: string, serverUrl: string, description?: string) {
    this.id = id;
    
    this.name = name;
    this.description = description;

    this.serverUrl = serverUrl;
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    this.isInitializing = true;

    const opts = {
      reconnectionOptions: {
        maxReconnectionDelay: 30000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: -1,
      }
    };

    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), opts);

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

    // Only assign to instance properties after successful initialization
    this.client = client;
    this.isEnabled = true;
    this.isInitializing = false;

    // Start periodic ping
    this.startPing();
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    this.stopPing();
    
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('Error disconnecting MCP client:', error);
      }
      this.client = null;
      this.isEnabled = false;
      this.isInitializing = false;
    }
  }

  /**
   * Handle disconnect event
   */
  private handleDisconnect(): void {
    this.stopPing();
    this.client = null;
    this.isEnabled = false;
    this.isInitializing = false;
  }

  /**
   * Start periodic ping to detect connection issues
   */
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
    }, 30000);
  }

  /**
   * Stop periodic ping
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  /**
   * ToolProvider interface: Set enabled state
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.isEnabled) {
      await this.connect();
    } else if (!enabled && this.isEnabled) {
      await this.disconnect();
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Call an MCP tool
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args
      });
      
      // Process the content from the result
      if (result && result.content) {
        return processContent(result.content as ContentBlock[]);
      }
      
      return "no result";
    } catch (error) {
      console.error(`Error calling MCP tool ${toolName}:`, error);
      throw error;
    }
  }

  get instructions(): string | undefined {
    if (!this.isConnected()) {
      return undefined;
    }

    return this.client?.getInstructions();
  }

  /**
   * ToolProvider interface: Get tools
   */
  async tools(): Promise<Tool[]> {
    if (!this.isConnected() || !this.client) {
      return [];
    }

    const toolsResponse = await this.client.listTools();
    const tools = toolsResponse.tools || [];

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || {},
      function: async (args: Record<string, unknown>) => {
        return this.callTool(tool.name, args);
      },
    }));
  }
}