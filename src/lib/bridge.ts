import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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
 * Bridge Client that implements ToolProvider interface
 * Handles connection to a bridge server using SSE transport
 */
export class Bridge implements ToolProvider {
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
   * Connect to the Bridge server using SSE transport
   */
  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    this.isInitializing = true;

    const transport = new SSEClientTransport(new URL(this.serverUrl));

    const client = new Client({
      name: 'Wingman Chat',
      version: '1.0.0'
    });

    // Setup error and close handlers
    client.onclose = () => {
      console.warn('Bridge client connection closed');
      this.handleDisconnect();
    };

    client.onerror = (error) => {
      console.error('Bridge client connection error:', error);
      this.handleDisconnect();
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
   * Disconnect from the Bridge server
   */
  async disconnect(): Promise<void> {
    this.stopPing();
    
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('Error disconnecting Bridge client:', error);
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
          console.error('Bridge client ping failed:', error);
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
   * Call a Bridge tool
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      throw new Error('Bridge client not connected');
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
      console.error(`Error calling Bridge tool ${toolName}:`, error);
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

  /**
   * Static factory method to create and connect a Bridge instance
   */
  public static async create(baseUrl: string): Promise<Bridge | null> {
    if (baseUrl === "") {
      return null;
    }

    try {
      const sseUrl = new URL("/sse", baseUrl).toString();
      const bridge = new Bridge('bridge', 'Bridge', sseUrl);
      
      await bridge.connect();

      console.info("Bridge connected");
      return bridge;
    } catch (error) {
      console.error("Bridge connection failed:", error);
      return null;
    }
  }
}