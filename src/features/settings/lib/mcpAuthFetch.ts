import {
  auth,
  computeScopeUnion,
  createFetchWithInit,
  extractWWWAuthenticateParams,
  isStrictScopeSuperset,
  UnauthorizedError,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { withAbort } from "@/shared/lib/abortSignals";
import { withPersistenceLock } from "@/shared/lib/persistence";
import { BrowserOAuthClientProvider, McpAuthRequiredError } from "./mcpAuth";
import { normalizeMcpUrl } from "./mcpConfig";

/** Let an interactive login outlive the SDK's handshake request timeout. */
export class McpAuthorizationPending extends UnauthorizedError {
  readonly authorization: Promise<void>;

  constructor(authorization: Promise<void>) {
    super();
    this.authorization = authorization;
    void authorization.catch(() => {});
  }
}

/** Coordinate whole OAuth grants, including refresh, across clients and browser tabs. */
export function mcpAuthFetch(
  provider: BrowserOAuthClientProvider,
  endpoint: string,
  options: {
    signal: AbortSignal;
    headers?: Record<string, string>;
    authenticating: () => void;
    complete: () => void;
    mode: () => "defer" | "inline" | "disabled";
  },
): FetchLike {
  const serverUrl = normalizeMcpUrl(endpoint);
  const fetcher = fetch;
  // OAuth discovery and token requests bypass this wrapper to avoid recursive authorization.
  const authFetch = createFetchWithInit(
    async (input, init) => {
      options.signal.throwIfAborted();
      const response = await fetcher(input, { ...init, signal: options.signal });
      options.signal.throwIfAborted();
      return response;
    },
    { headers: options.headers },
  );

  return async (input, init) => {
    const response = await fetcher(input, init);
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (normalizeMcpUrl(requestUrl) !== serverUrl) return response;
    const challenge = extractWWWAuthenticateParams(response);
    const stepUp = response.status === 403 && challenge.error === "insufficient_scope";
    if (response.status !== 401 && !stepUp) return response;
    const rejectedToken = new Headers(init?.headers).get("Authorization");
    await response.body?.cancel();
    const mode = options.mode();
    if (mode === "disabled") throw new McpAuthRequiredError(provider.serverId, "expired");
    options.authenticating();
    const authorization = withAbort(options.signal, () =>
      withPersistenceLock(`mcp-oauth:${serverUrl}`, async () => {
        options.signal.throwIfAborted();
        const current = provider.tokens();
        const scope = computeScopeUnion(current?.scope, challenge.scope);
        const forceReauthorization = stepUp && isStrictScopeSuperset(scope, current?.scope);
        // Another client/tab may already have refreshed the token while this request waited.
        if (current && `Bearer ${current.access_token}` !== rejectedToken && !forceReauthorization) return;
        const authOptions = {
          serverUrl,
          scope,
          forceReauthorization,
          resourceMetadataUrl: challenge.resourceMetadataUrl,
          fetchFn: authFetch,
        };
        if ((await auth(provider, authOptions)) === "REDIRECT") {
          const authorizationCode = await withAbort(options.signal, () => provider.waitForAuthCode());
          options.signal.throwIfAborted();
          await auth(provider, { ...authOptions, authorizationCode });
        }
        options.signal.throwIfAborted();
      }),
    ).finally(options.complete);
    if (mode === "defer") throw new McpAuthorizationPending(authorization);
    await authorization;
    options.signal.throwIfAborted();
    const headers = new Headers(init?.headers);
    const tokens = provider.tokens();
    if (tokens) headers.set("Authorization", `Bearer ${tokens.access_token}`);
    const retried = await fetcher(input, { ...init, headers });
    if (retried.status === 401) {
      await retried.body?.cancel();
      throw new McpAuthRequiredError(provider.serverId, "expired");
    }
    return retried;
  };
}
