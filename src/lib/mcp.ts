import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as MCPTool, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from '../types/chat';

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
 * Simple MCP Client
 * Handles connection to a single MCP server
 */
export class MCPClient {
  private client: Client | null = null;
  private serverUrl: string;

  private tools: MCPTool[] = [];
  private instructions: string | undefined;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Connect to the MCP server
   */
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

    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), opts);

    this.client = new Client({
      name: 'Wingman Chat',
      version: '1.0.0'
    });

    await this.client.connect(transport);

    this.instructions = this.client.getInstructions()

    const toolsResponse = await this.client.listTools();
    this.tools = toolsResponse.tools || [];

    console.log(`Connected to MCP server ${this.serverUrl}, found ${this.tools.length} tools`);
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('Error disconnecting MCP client:', error);
      }
      this.client = null;
      this.tools = [];
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
      console.log('Calling MCP tool:', toolName, args);
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

  getInstructions(): string | undefined {
    if (!this.isConnected()) {
      return undefined;
    }

    return this.instructions;
  }

  /**
   * Convert MCP tools to our Tool format
   */
  getTools(): Tool[] {
    if (!this.isConnected()) {
      return [];
    }

    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",

      parameters: tool.inputSchema || {},
      
      function: async (args: Record<string, unknown>) => {
        return this.callTool(tool.name, args);
      },
    }));
  }
}