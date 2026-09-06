import { ProviderState } from "@/shared/types/chat";
import type { MCPClient } from "./mcp";
import { McpAuthRequiredError } from "./mcpAuth";

/** Retry transient failures only while this provider selection still owns the attempt. */
export async function connectMcpWithRetry(
  client: Pick<MCPClient, "connect">,
  signal: AbortSignal,
  setState: (state: ProviderState) => void,
): Promise<void> {
  for (let attempt = 0; attempt <= 2 && !signal.aborted; attempt++) {
    try {
      await client.connect();
      if (!signal.aborted) setState(ProviderState.Connected);
      return;
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof McpAuthRequiredError) {
        setState(ProviderState.Unauthorized);
        return;
      }
      if (attempt === 2) {
        console.error("Failed to connect MCP:", error);
        setState(ProviderState.Failed);
        return;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 500 * (attempt + 1));
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
