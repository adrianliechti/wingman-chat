import { SdkHttpError } from "@modelcontextprotocol/client";
import type { Implementation, JSONRPCRequest, Transport } from "@modelcontextprotocol/client";

const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";
export type ServerIdentity = { instructions?: string; serverInfo?: Implementation };

/** Observe server identity and notifications; the SDK owns requests and input rounds. */
export function browserMcpTransport(
  transport: Transport,
  hooks: {
    initialized: (identity: ServerIdentity) => void;
    notification: (method: string, params?: Record<string, unknown>) => void;
    closed: () => void;
  },
): Transport {
  const handshakes = new Set<JSONRPCRequest["id"]>();
  const bridge: Transport = {
    start: () => transport.start(),
    send: async (message, options) => {
      if ("id" in message && "method" in message && ["initialize", "server/discover"].includes(message.method))
        handshakes.add(message.id);
      try {
        await transport.send(message, options);
      } catch (error) {
        // Some 2025 servers return HTTP 5xx for the unknown discovery probe.
        // Translate it so SDK version negotiation can fall back to initialize.
        if (
          "id" in message &&
          "method" in message &&
          message.method === "server/discover" &&
          error instanceof SdkHttpError &&
          error.data.status >= 500
        ) {
          handshakes.delete(message.id);
          bridge.onmessage?.({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
          return;
        }
        throw error;
      }
    },
    close: () => transport.close(),
    get sessionId() {
      return transport.sessionId;
    },
    get hasPerRequestStream() {
      return transport.hasPerRequestStream;
    },
    setProtocolVersion: (version) => transport.setProtocolVersion?.(version),
    setSupportedProtocolVersions: (versions) => transport.setSupportedProtocolVersions?.(versions),
  };
  transport.onclose = () => {
    handshakes.clear();
    bridge.onclose?.();
    hooks.closed();
  };
  transport.onerror = (error) => bridge.onerror?.(error);
  transport.onmessage = (message, extra) => {
    if (
      "id" in message &&
      message.id !== undefined &&
      !("method" in message) &&
      handshakes.delete(message.id) &&
      "result" in message
    ) {
      const result = message.result as ServerIdentity & { _meta?: Record<string, unknown> };
      hooks.initialized({
        instructions: typeof result.instructions === "string" ? result.instructions : undefined,
        serverInfo: result.serverInfo ?? (result._meta?.[SERVER_INFO_META_KEY] as Implementation | undefined),
      });
    }
    if ("method" in message && !("id" in message))
      hooks.notification(message.method, message.params as Record<string, unknown> | undefined);
    bridge.onmessage?.(message, extra);
  };
  return bridge;
}
