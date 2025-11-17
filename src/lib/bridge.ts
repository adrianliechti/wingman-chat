import type { Tool } from "../types/chat";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";

interface BridgeConfig {
  name: string;
  instructions?: string; 
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

  return JSON.stringify(content)
}

export class Bridge {
    private mcp: Client | undefined;
    private instructions: string | null = null;

    private constructor(mcp?: Client) {
        this.mcp = mcp;
    }

    public static create(baseUrl: string): Bridge {
        const bridge = new Bridge();

        if (baseUrl === "") {
            return bridge;
        }

        (async () => {
            try {
                const response = await fetch(new URL("/.well-known/wingman", baseUrl));

                if (!response.ok) {
                    console.info("Bridge not available");
                    return;
                }

                const config : BridgeConfig = await response.json();

                if (config.instructions?.trim()) {
                    bridge.instructions = config.instructions;
                }
            } catch {
                return;
            }

            let client: Client | undefined;
            let transport: Transport | undefined;

            try {
                transport = new SSEClientTransport(
                    new URL("/sse", baseUrl),
                );

                client = new Client({
                    name: 'wingman-bridge',
                    version: '1.0.0'
                });

                await client.connect(transport);
                bridge.mcp = client;

                const instructions = client.getInstructions();

                if (instructions !== undefined) {
                    bridge.instructions = instructions;
                }

                console.info("Bridge connected");
            } catch {
                if (client) client.close();
                if (transport) transport.close();
            }
        })();

        return bridge;
    }

    public isConnected(): boolean {
        return this.mcp !== undefined;
    }

    public async listTools(): Promise<Tool[]> {
        if (!this.mcp) {
            return [];
        }

        const result = await this.mcp.listTools();

        return result.tools.map((tool) => {
            return {
                name: tool.name,
                description: tool.description ?? "",

                parameters: tool.inputSchema,

                function: async (args: Record<string, unknown>) => {
                    if (!this.mcp) {
                        return "tool currently unavailable";
                    }

                    try {
                        const callResult = await this.mcp.callTool({
                            name: tool.name,
                            arguments: args,
                        });

                        return processContent((callResult?.content as ContentBlock[]) || []);
                    }
                    catch (error) {
                        console.error(`Error calling tool ${tool.name}:`, error);
                        return "tool failed";
                    }
                },
            };
        });
    }

    public getInstructions(): string | null {
        return this.instructions;
    }
}