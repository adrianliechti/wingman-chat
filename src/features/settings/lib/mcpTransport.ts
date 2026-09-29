import type { ElicitRequest, ElicitResult, InitializeResult, Transport } from "@modelcontextprotocol/client";

/** TanStack does not yet expose legacy elicitation or initialize metadata. */
export function browserMcpTransport(
  transport: Transport,
  hooks: {
    elicit: (params: ElicitRequest["params"]) => Promise<ElicitResult>;
    initialized: (result: InitializeResult) => void;
    notification: (method: string, params?: Record<string, unknown>) => void;
    closed: () => void;
  },
): Transport {
  const bridge: Transport = {
    start: () => transport.start(),
    send: (message, options) => transport.send(message, options),
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
    bridge.onclose?.();
    hooks.closed();
  };
  transport.onerror = (error) => bridge.onerror?.(error);
  transport.onmessage = (message, extra) => {
    if ("result" in message && "serverInfo" in message.result) hooks.initialized(message.result as InitializeResult);
    if ("method" in message) {
      if (message.method === "elicitation/create" && "id" in message) {
        void hooks
          .elicit(message.params as ElicitRequest["params"])
          .then(
            (result) => transport.send({ jsonrpc: "2.0", id: message.id, result }, { relatedRequestId: message.id }),
            (error: unknown) =>
              transport.send(
                {
                  jsonrpc: "2.0",
                  id: message.id,
                  error: { code: -32600, message: error instanceof Error ? error.message : "Elicitation failed" },
                },
                { relatedRequestId: message.id },
              ),
          )
          .catch((error: Error) => bridge.onerror?.(error));
        return;
      }
      if (!("id" in message)) hooks.notification(message.method, message.params as Record<string, unknown> | undefined);
    }
    bridge.onmessage?.(message, extra);
  };
  return bridge;
}
