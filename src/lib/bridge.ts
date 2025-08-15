import type { Tool } from "../types/chat";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

interface BridgeConfig {
  name: string;

  instructions?: string; 
}

interface ToolTextResult {
    type: string;
    text?: string;
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
                console.log("Bridge config", config);
                
                bridge.instructions = config.instructions || null;
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
                        console.log("call local tool", tool.name, args);

                        const callResult = await this.mcp.callTool({
                            name: tool.name,
                            arguments: args,
                        });

                        const results = callResult?.content as ToolTextResult[] | undefined;
                        const texts: string[] = [];

                        if (results) {
                            for (const res of results) {
                                if (res.type === "text" && res.text) {
                                    texts.push(res.text);
                                }
                            }
                        }

                        return texts.join("\n\n");
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