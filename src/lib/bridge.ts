import { MCPClient } from './mcp';
import type { Tool, ToolProvider } from '../types/chat';

/**
 * Bridge Client that wraps MCPClient for SSE-based bridge connections
 * Delegates to MCPClient implementation
 */
export class Bridge implements ToolProvider {
  private client: MCPClient;

  constructor(id: string, name: string, url: string, description?: string) {
    this.client = new MCPClient(id, url, name, description);
  }

  get id(): string {
    return this.client.id;
  }

  get name(): string {
    return this.client.name;
  }

  get description(): string | undefined {
    return this.client.description;
  }

  get icon() {
    return this.client.icon;
  }

  get isEnabled(): boolean {
    return this.client.isEnabled;
  }

  get isInitializing(): boolean {
    return this.client.isInitializing;
  }

  async connect(): Promise<void> {
    return this.client.connect();
  }

  async disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    return this.client.setEnabled(enabled);
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  get instructions(): string | undefined {
    return this.client.instructions;
  }

  async tools(): Promise<Tool[]> {
    return this.client.tools();
  }

  /**
   * Static factory method to create and connect a Bridge instance
   */
  public static async create(baseUrl: string): Promise<Bridge | null> {
    if (baseUrl === "") {
      return null;
    }

    try {
      const url = new URL("/mcp", baseUrl).toString();
      const bridge = new Bridge('bridge', url, 'Bridge', 'Local connected tools');
      
      await bridge.connect();

      console.info("Bridge connected");
      return bridge;
    } catch (error) {
      console.error("Bridge connection failed:", error);
      return null;
    }
  }
}