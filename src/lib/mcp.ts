import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { Tool, ToolProvider } from '../types/chat';
import { Rocket } from "lucide-react";

export class MCPClient implements ToolProvider {
  readonly id: string;
  readonly url: string;

  readonly name: string;
  readonly description?: string;
  
  readonly icon = Rocket;

  private client: Client | null = null;
  
  private pingInterval: ReturnType<typeof setInterval> | undefined;
  
  // Callback for when auth is required
  onAuthRequired?: () => Promise<void>;

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
    
    // Check if auth is required after connection
    if (this.needsAuth() && this.onAuthRequired) {
      // Trigger the auth callback - this should be handled by UI
      try {
        await this.onAuthRequired();
      } catch (error) {
        console.warn('Auth required but user action needed:', error);
      }
    }
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
            
            if (result && result.content) {
              return processContent(result.content as ContentBlock[]);
            }
            
            return "no result";
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
  
  needsAuth(): boolean {
    const tokenKey = `${this.id}_token`;
    return !localStorage.getItem(tokenKey);
  }

  async initAuth(popupWindow?: Window | null): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if we already have a token
      const tokenKey = `${this.id}_token`;
      const existingToken = localStorage.getItem(tokenKey);
      
      if (existingToken) {
        console.log('MCP OAuth token already exists');
        // Close popup if it was pre-opened
        if (popupWindow && !popupWindow.closed) {
          popupWindow.close();
        }
        resolve();
        return;
      }
      
      console.log('Opening OAuth popup...');
      
      // Generate fake authorization code
      const fakeCode = generateRandomState();
      
      // Use pre-opened popup or create new one
      let authWindow = popupWindow;
      if (!authWindow || authWindow.closed) {
        // If no pre-opened window and we're not in a user action context,
        // this will be blocked by popup blockers
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        authWindow = window.open(
          'about:blank',
          'MCP OAuth Authorization',
          `width=${width},height=${height},left=${left},top=${top},popup=1`
        );
      }
      
      if (!authWindow || authWindow.closed) {
        const error = new Error('Popup was blocked by browser. Please allow popups for this site or manually trigger authentication.');
        console.warn('Popup blocked:', error.message);
        reject(error);
        return;
      }
      
      // Navigate to callback URL
      authWindow.location.href = `/mcp/callback?code=${fakeCode}`;
      
      console.log('OAuth popup opened successfully');
      
      // Listen for OAuth callback
      const handleMessage = (event: MessageEvent) => {
        // Verify origin
        if (event.origin !== window.location.origin) {
          return;
        }
        
        if (event.data?.type === 'oauth_callback') {
          window.removeEventListener('message', handleMessage);
          
          if (event.data.error) {
            reject(new Error(`OAuth failed: ${event.data.error}`));
            return;
          }
          
          if (event.data.token) {
            // Store token in localStorage
            localStorage.setItem(tokenKey, event.data.token);
            console.log('MCP OAuth token stored successfully');
            resolve();
          } else {
            reject(new Error('No token received from OAuth'));
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        if (authWindow && !authWindow.closed) {
          authWindow.close();
        }
        reject(new Error('OAuth timeout'));
      }, 300000);
      
      // Check if popup was closed
      const checkClosed = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(checkClosed);
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
          reject(new Error('OAuth popup closed'));
        }
      }, 1000);
    });
  }
}

function generateRandomState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

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