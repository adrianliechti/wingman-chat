import { AsyncRetryer } from "@tanstack/pacer";
import { ProviderState } from "@/shared/types/chat";
import type { MCPClient } from "./mcp";
import { McpAuthRequiredError } from "./mcpAuth";

/**
 * Retry transient failures only while this provider selection still owns the
 * attempt: three tries with linear backoff (0.5 s, then 1 s). An authentication
 * failure stops at once and asks for the user; an abort ends the attempt
 * without publishing a state.
 */
export async function connectMcpWithRetry(
  client: Pick<MCPClient, "connect">,
  signal: AbortSignal,
  setState: (state: ProviderState) => void,
): Promise<void> {
  if (signal.aborted) return;
  let settled = false;
  const retryer = new AsyncRetryer(() => client.connect(), {
    // Once the outcome is known there is nothing left to retry.
    maxAttempts: () => (settled ? 1 : 3),
    backoff: "linear",
    baseWait: 500,
    jitter: 0,
    throwOnError: false,
    onError: (error) => {
      if (error instanceof McpAuthRequiredError && !signal.aborted && !settled) {
        settled = true;
        setState(ProviderState.Unauthorized);
      }
    },
    onSuccess: () => {
      if (signal.aborted || settled) return;
      settled = true;
      setState(ProviderState.Connected);
    },
    onLastError: (error) => {
      if (signal.aborted || settled) return;
      settled = true;
      console.error("Failed to connect MCP:", error);
      setState(ProviderState.Failed);
    },
  });
  const onAbort = () => retryer.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await retryer.execute();
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
