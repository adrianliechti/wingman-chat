import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as MCPTool, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from '../types/chat';

export interface MCPConnectionStatus {
  connected: boolean;
  connecting: boolean;
  error?: string;
}

export interface MCPConnection {
  client: Client;
  tools: MCPTool[];
  status: MCPConnectionStatus;
}

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
 * Singleton MCP Client Manager
 * Handles MCP connections, tools, and lifecycle
 */
class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();
  private listeners: Set<(serverUrl: string, connection: MCPConnection | null) => void> = new Set();

  /**
   * Connect to an MCP server
   */
  async connect(serverUrl: string): Promise<MCPConnection> {
    if (this.connections.has(serverUrl)) {
      return this.connections.get(serverUrl)!;
    }

    console.log('Connecting to MCP server:', serverUrl);

    const connection: MCPConnection = {
      client: null!,
      tools: [],
      status: { connected: false, connecting: true }
    };

    this.connections.set(serverUrl, connection);
    this.notifyListeners(serverUrl, connection);

    try {
      // Only support HTTP/HTTPS URLs for browser compatibility
      if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
        throw new Error(`Unsupported MCP server URL: ${serverUrl}. Only HTTP/HTTPS URLs are supported in browser environment (e.g., http://localhost:1234/mcp).`);
      }

      // Use StreamableHTTPClientTransport for HTTP/HTTPS
      const transport = new StreamableHTTPClientTransport(new URL(serverUrl));

      // Create and connect client
      const client = new Client({
        name: 'Wingman Chat',
        version: '1.0.0'
      });

      await client.connect(transport);

      // List available tools
      const toolsResponse = await client.listTools();
      const tools = toolsResponse.tools || [];

      // Update connection
      connection.client = client;
      connection.tools = tools;
      connection.status = { connected: true, connecting: false };

      console.log(`Connected to MCP server ${serverUrl}, found ${tools.length} tools`);
      this.notifyListeners(serverUrl, connection);

      // Handle disconnection
      client.onclose = () => {
        console.log('MCP client disconnected:', serverUrl);
        this.handleDisconnection(serverUrl);
      };

      client.onerror = (error: Error) => {
        console.error('MCP client error:', serverUrl, error);
        connection.status = { connected: false, connecting: false, error: error.message || 'Connection error' };
        this.notifyListeners(serverUrl, connection);
      };

      return connection;

    } catch (error) {
      console.error('Failed to connect to MCP server:', serverUrl, error);
      connection.status = { 
        connected: false, 
        connecting: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      };
      this.notifyListeners(serverUrl, connection);
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverUrl: string): Promise<void> {
    const connection = this.connections.get(serverUrl);
    if (!connection) return;

    console.log('Disconnecting from MCP server:', serverUrl);

    try {
      if (connection.client) {
        await connection.client.close();
      }
    } catch (error) {
      console.error('Error disconnecting MCP client:', error);
    }

    this.connections.delete(serverUrl);
    this.notifyListeners(serverUrl, null);
  }

  /**
   * Get connection for a server URL
   */
  getConnection(serverUrl: string): MCPConnection | null {
    return this.connections.get(serverUrl) || null;
  }

  /**
   * Call an MCP tool
   */
  async callTool(serverUrl: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const connection = this.getConnection(serverUrl);
    if (!connection || !connection.status.connected || !connection.client) {
      throw new Error('MCP server not connected');
    }

    try {
      console.log('Calling MCP tool:', toolName, args);
      const result = await connection.client.callTool({
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

  /**
   * Convert MCP tools to our Tool format
   */
  getMCPTools(serverUrl: string): Tool[] {
    const connection = this.getConnection(serverUrl);
    if (!connection || !connection.status.connected || !connection.tools) {
      return [];
    }

    return connection.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || {},
      function: async (args: Record<string, unknown>) => {
        return this.callTool(serverUrl, tool.name, args);
      },
    }));
  }

  /**
   * Add a listener for connection changes
   */
  addListener(listener: (serverUrl: string, connection: MCPConnection | null) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: (serverUrl: string, connection: MCPConnection | null) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Handle disconnection cleanup
   */
  private handleDisconnection(serverUrl: string): void {
    const connection = this.connections.get(serverUrl);
    if (connection) {
      connection.status = { connected: false, connecting: false };
      this.notifyListeners(serverUrl, connection);
    }
  }

  /**
   * Notify all listeners of connection changes
   */
  private notifyListeners(serverUrl: string, connection: MCPConnection | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(serverUrl, connection);
      } catch (error) {
        console.error('Error in MCP listener:', error);
      }
    });
  }

  /**
   * Cleanup all connections
   */
  async cleanup(): Promise<void> {
    const serverUrls = Array.from(this.connections.keys());
    await Promise.all(serverUrls.map(url => this.disconnect(url)));
    this.listeners.clear();
  }
}

// Export singleton instance
export const mcpClientManager = new MCPClientManager();