import { SdkHttpError } from "@modelcontextprotocol/client";
import type {
  ElicitRequest,
  ElicitResult,
  Implementation,
  JSONRPCMessage,
  JSONRPCRequest,
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/client";

const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";
/** Same cap as the SDK's own input_required driver. */
const MAX_INPUT_ROUNDS = 10;

export type ServerIdentity = { instructions?: string; serverInfo?: Implementation };

type Pending = {
  id: JSONRPCRequest["id"];
  wireId: JSONRPCRequest["id"];
  request: JSONRPCRequest;
  rounds: number;
  options?: TransportSendOptions;
  cleanup?: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wingman's request ownership and identity hooks around the SDK transport.
 * Both protocol eras share the same chat elicitation UI:
 * - 2025: `elicitation/create` requests and the initialize result.
 * - 2026-07-28: `input_required` results (answered and retried under the
 *   caller's request id) and the server/discover result.
 */
export function browserMcpTransport(
  transport: Transport,
  hooks: {
    elicit: (params: ElicitRequest["params"]) => Promise<ElicitResult>;
    initialized: (identity: ServerIdentity) => void;
    notification: (method: string, params?: Record<string, unknown>) => void;
    closed: () => void;
  },
): Transport {
  // Outgoing requests by wire id; a retry maps back to the caller's id.
  const pending = new Map<JSONRPCRequest["id"], Pending>();
  const active = new Map<JSONRPCRequest["id"], Pending>();
  let retries = 0;

  const forget = (entry: Pending) => {
    pending.delete(entry.wireId);
    active.delete(entry.id);
    entry.cleanup?.();
  };
  const current = (entry: Pending) => active.get(entry.id) === entry && !entry.options?.requestSignal?.aborted;
  const clear = () => {
    for (const entry of active.values()) forget(entry);
  };

  const deliver = (message: JSONRPCMessage) => bridge.onmessage?.(message);
  const fail = (id: JSONRPCRequest["id"], message: string) =>
    deliver({ jsonrpc: "2.0", id, error: { code: -32603, message } });

  async function answerInput(entry: Pending, result: Record<string, unknown>) {
    if (!current(entry)) return;
    if (entry.rounds >= MAX_INPUT_ROUNDS) {
      forget(entry);
      fail(entry.id, `The MCP server asked for input more than ${MAX_INPUT_ROUNDS} times`);
      return;
    }
    const requests = isRecord(result.inputRequests) ? result.inputRequests : {};
    const inputResponses: Record<string, unknown> = {};
    for (const [key, request] of Object.entries(requests)) {
      if (!isRecord(request) || request.method !== "elicitation/create") {
        const method = isRecord(request) ? String(request.method) : "unknown";
        forget(entry);
        fail(entry.id, `The MCP server asked for unsupported input: ${method}`);
        return;
      }
      inputResponses[key] = await hooks.elicit(request.params as ElicitRequest["params"]);
      if (!current(entry)) return;
    }
    const id = `wingman-input:${++retries}`;
    const params = { ...entry.request.params };
    delete params.inputResponses;
    delete params.requestState;
    const retry: JSONRPCRequest = {
      ...entry.request,
      id,
      params: {
        ...params,
        ...(Object.keys(inputResponses).length ? { inputResponses } : {}),
        ...(typeof result.requestState === "string" ? { requestState: result.requestState } : {}),
      },
    };
    entry.wireId = id;
    entry.rounds++;
    pending.set(id, entry);
    await transport.send(retry, entry.options);
  }

  const bridge: Transport = {
    start: () => transport.start(),
    send: async (message, options) => {
      if ("method" in message && "id" in message) {
        const entry: Pending = { id: message.id, wireId: message.id, request: message, rounds: 0, options };
        pending.set(message.id, entry);
        active.set(message.id, entry);
        const abort = () => forget(entry);
        options?.requestSignal?.addEventListener("abort", abort, { once: true });
        entry.cleanup = () => options?.requestSignal?.removeEventListener("abort", abort);
        if (options?.requestSignal?.aborted) forget(entry);
      } else if ("method" in message && message.method === "notifications/cancelled") {
        const entry = active.get(message.params?.requestId as JSONRPCRequest["id"]);
        if (entry) {
          message = { ...message, params: { ...message.params, requestId: entry.wireId } };
          forget(entry);
        }
      }
      try {
        await transport.send(message, options);
      } catch (error) {
        if (!("method" in message) || !("id" in message)) throw error;
        const entry = active.get(message.id);
        if (entry) forget(entry);
        // A 2025 server may answer the unknown probe method with a 5xx. The
        // SDK then fails the connection instead of using 2025 initialize.
        if (message.method === "server/discover" && error instanceof SdkHttpError && error.data.status >= 500) {
          deliver({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
          return;
        }
        throw error;
      }
    },
    close: () => {
      clear();
      return transport.close();
    },
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
    clear();
    bridge.onclose?.();
    hooks.closed();
  };
  transport.onerror = (error) => bridge.onerror?.(error);
  transport.onmessage = (message, extra) => {
    if ("id" in message && message.id !== undefined && !("method" in message)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (entry && "result" in message) {
        const result = message.result as Record<string, unknown>;
        if (result.resultType === "input_required") {
          answerInput(entry, result).catch((error: unknown) => {
            if (current(entry)) {
              forget(entry);
              fail(entry.id, error instanceof Error ? error.message : "Elicitation failed");
            }
          });
          return;
        }
        if (entry.request.method === "initialize" || entry.request.method === "server/discover") {
          const meta = isRecord(result._meta) ? result._meta : {};
          hooks.initialized({
            instructions: typeof result.instructions === "string" ? result.instructions : undefined,
            serverInfo: (result.serverInfo ?? meta[SERVER_INFO_META_KEY]) as Implementation | undefined,
          });
        }
      }
      if (entry) forget(entry);
      if (entry && entry.id !== message.id) {
        bridge.onmessage?.({ ...message, id: entry.id }, extra);
        return;
      }
    }
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
