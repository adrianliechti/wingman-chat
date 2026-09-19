/**
 * Contract between an HTML artifact page and the app hosting its preview.
 * The page talks through `window.wingman` (see `sdk.ts`), which posts RPC
 * requests to the parent window with a MessagePort for the reply.
 */

/** Reserved path prefix inside a preview session; artifacts cannot write here. */
export const SDK_PREFIX = "__wingman__/";
export const SDK_PATH = `${SDK_PREFIX}sdk.js`;
export const SDK_RPC_TYPE = "wingman:rpc";
export const SDK_HELLO_TYPE = "wingman:hello";

export type SdkCapabilityName =
  | "llm"
  | "vision"
  | "ocr"
  | "translate"
  | "render"
  | "synthesize"
  | "transcribe"
  | "files"
  | "store"
  | "tools"
  | "duckdb";

export type SdkCapabilities = Record<SdkCapabilityName, boolean>;

export interface SdkRpcRequest {
  type: typeof SDK_RPC_TYPE;
  token: string;
  method: string;
  params: unknown[];
}

export type SdkRpcReply = { ok: true; value: unknown } | { ok: false; error: string };

export interface SdkHello {
  type: typeof SDK_HELLO_TYPE;
  token: string;
  capabilities: SdkCapabilities;
}

export function emptyCapabilities(): SdkCapabilities {
  return {
    llm: false,
    vision: false,
    ocr: false,
    translate: false,
    render: false,
    synthesize: false,
    transcribe: false,
    files: false,
    store: false,
    tools: false,
    duckdb: false,
  };
}

export function isSdkRpcRequest(data: unknown): data is SdkRpcRequest {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return (
    record.type === SDK_RPC_TYPE &&
    typeof record.token === "string" &&
    typeof record.method === "string" &&
    Array.isArray(record.params)
  );
}
