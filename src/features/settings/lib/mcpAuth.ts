import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { UnauthorizedError } from "@modelcontextprotocol/client";
import { normalizeMcpUrl } from "./mcpConfig";

const STORAGE_PREFIX = "mcp_oauth";

function authKey(endpoint: string): string {
  return `v3:${encodeURIComponent(normalizeMcpUrl(endpoint))}`;
}

/** Only migrate credentials whose old key proves which endpoint they belong to. */
function migrateCredentials(endpoint: string, key: string): void {
  const endpointKey = encodeURIComponent(normalizeMcpUrl(endpoint));
  // The first endpoint login wins; never mix a client registration with another login's tokens.
  const fields = ["tokens", "client_info", "discovery", "auth_state"];
  try {
    const oldKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .filter((item) => item.startsWith(`${STORAGE_PREFIX}:v2:`) && item.split(":")[3] === endpointKey)
      .sort();
    // All IDs/tabs choose the same saved login, preferring tokens over an incomplete attempt.
    const oldPrefix =
      oldKeys.find((item) => item.endsWith(":tokens") && readJson<OAuthTokens>(item)?.access_token) ?? oldKeys[0];
    if (!oldPrefix) return;
    if (!fields.some((field) => readJson(storageKey(key, field)) !== undefined)) {
      const prefix = oldPrefix.slice(0, oldPrefix.lastIndexOf(":"));
      const snapshot = fields.map((field) => [field, localStorage.getItem(`${prefix}:${field}`)] as const);
      for (const [field, value] of snapshot) {
        if (value !== null) localStorage.setItem(storageKey(key, field), value);
      }
    }
    // Do not let an invalidated login get resurrected from an older per-ID copy.
    oldKeys.forEach((item) => localStorage.removeItem(item));
  } catch {
    // Keep old credentials if storage cannot be written.
  }
}

function storageKey(serverKey: string, suffix: string): string {
  return `${STORAGE_PREFIX}:${serverKey}:${suffix}`;
}

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[MCP OAuth] Failed to write credentials to localStorage:", e);
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export type McpAuthFailureReason = "denied" | "cancelled" | "blocked" | "expired" | "failed";

/** Thrown instead of retrying when a server's OAuth flow cannot proceed without user action. */
export class McpAuthRequiredError extends UnauthorizedError {
  readonly serverId: string;
  readonly reason: McpAuthFailureReason;

  constructor(serverId: string, reason: McpAuthFailureReason, message?: string) {
    super(message ?? `MCP authorization required for "${serverId}" (${reason})`);
    this.name = "McpAuthRequiredError";
    this.serverId = serverId;
    this.reason = reason;
  }
}

type McpAuthState = { blocked: true; reason: McpAuthFailureReason; at: number };

/** Whether a prior auth attempt for this server failed and must not auto-retry. */
function isAuthBlocked(serverKey: string): boolean {
  return readJson<McpAuthState>(storageKey(serverKey, "auth_state"))?.blocked === true;
}

function markAuthBlocked(serverKey: string, reason: McpAuthFailureReason): void {
  writeJson(storageKey(serverKey, "auth_state"), { blocked: true, reason, at: Date.now() });
}

function clearAuthBlocked(serverKey: string): void {
  removeKey(storageKey(serverKey, "auth_state"));
}

// Per-tab-session guards: one automatic auth attempt per endpoint per page load.
const sessionAutoAuthAttempted = new Set<string>();
const interactiveAuthArmed = new Set<string>();

/** Allow exactly one more popup for this server, triggered by an explicit user gesture. */
function armInteractiveAuth(serverKey: string): void {
  clearAuthBlocked(serverKey);
  sessionAutoAuthAttempted.delete(serverKey);
  interactiveAuthArmed.add(serverKey);
}

/**
 * Browser-compatible OAuthClientProvider for MCP servers.
 *
 * Shares persisted credentials by endpoint; PKCE belongs to this popup only.
 * Opens a popup window for the OAuth authorization redirect and receives the
 * authorization code back via postMessage from the /oauth/callback page.
 */
export class BrowserOAuthClientProvider implements OAuthClientProvider {
  private readonly serverKey: string;
  readonly serverId: string;
  private pendingAuthResolve: ((code: string) => void) | null = null;
  private pendingAuthReject: ((err: Error) => void) | null = null;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private authCodePromise: Promise<string> | null = null;
  private popup: Window | null = null;
  private verifier?: string;

  constructor(serverId: string, endpoint: string) {
    this.serverId = serverId;
    this.serverKey = authKey(endpoint);
    migrateCredentials(endpoint, this.serverKey);
  }

  armInteractiveAuth(): void {
    armInteractiveAuth(this.serverKey);
  }

  get redirectUrl(): string {
    return `${window.location.origin}/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Wingman Chat",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  /** Trust the server's declared resource; proxied MCPs have an upstream resource that won't match the proxy URL. */
  async validateResourceURL(_serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    return resource ? new URL(resource) : undefined;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readJson<OAuthClientInformationMixed>(storageKey(this.serverKey, "client_info"));
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    writeJson(storageKey(this.serverKey, "client_info"), info);
  }

  tokens(): OAuthTokens | undefined {
    return readJson<OAuthTokens>(storageKey(this.serverKey, "tokens"));
  }

  saveTokens(tokens: OAuthTokens): void {
    writeJson(storageKey(this.serverKey, "tokens"), tokens);
    clearAuthBlocked(this.serverKey);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    const v = this.verifier;
    if (!v) throw new Error("[MCP OAuth] No code verifier saved");
    return v;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    writeJson(storageKey(this.serverKey, "discovery"), state);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return readJson<OAuthDiscoveryState>(storageKey(this.serverKey, "discovery"));
  }

  /**
   * Opens a popup window for OAuth authorization and returns a Promise that
   * resolves with the authorization code once the user completes the flow.
   *
   * Refuses to reopen a popup if a prior attempt failed and wasn't re-armed by a user gesture.
   */
  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this._cleanup();

    const key = this.serverKey;
    const armed = interactiveAuthArmed.delete(key);

    if (!armed && (isAuthBlocked(key) || sessionAutoAuthAttempted.has(key))) {
      this.authCodePromise = Promise.reject(new McpAuthRequiredError(this.serverId, "failed"));
      void this.authCodePromise.catch(() => {});
      return Promise.resolve();
    }

    sessionAutoAuthAttempted.add(key);

    return new Promise<void>((resolve) => {
      const popup = window.open(
        authorizationUrl.toString(),
        `mcp_oauth_${crypto.randomUUID()}`,
        "popup,width=600,height=700,left=200,top=100",
      );

      if (!popup) {
        markAuthBlocked(key, "blocked");
        this.authCodePromise = Promise.reject(
          new McpAuthRequiredError(
            this.serverId,
            "blocked",
            "Popup was blocked. Please allow popups for this site and try again.",
          ),
        );
        void this.authCodePromise.catch(() => {});
        resolve();
        return;
      }
      this.popup = popup;

      // Set up the auth code promise so waitForAuthCode() can await it
      this.authCodePromise = new Promise<string>((res, rej) => {
        this.pendingAuthResolve = res;
        this.pendingAuthReject = rej;
      });
      // A popup can fail before the transport starts awaiting the code.
      void this.authCodePromise.catch(() => {});

      // Attach postMessage listener to receive the auth code from /oauth/callback
      const listener = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== popup) return;
        if (event.data?.type !== "mcp_oauth_callback") return;

        if (event.data.error) {
          markAuthBlocked(key, "denied");
          this.pendingAuthReject?.(
            new McpAuthRequiredError(this.serverId, "denied", `OAuth error: ${event.data.error}`),
          );
        } else if (event.data.code) {
          this.pendingAuthResolve?.(event.data.code as string);
        }
        this._cleanup();
      };

      this.messageListener = listener;
      window.addEventListener("message", listener);

      // Poll for closed popup (user may close it manually)
      this.pollTimer = setInterval(() => {
        if (popup.closed) {
          if (this.pendingAuthReject) {
            markAuthBlocked(key, "cancelled");
            this.pendingAuthReject(
              new McpAuthRequiredError(
                this.serverId,
                "cancelled",
                "OAuth popup was closed before authorization completed",
              ),
            );
          }
          this._cleanup();
        }
      }, 500);

      resolve();
    });
  }

  /**
   * Awaits the authorization code from the popup. Call this after catching
   * UnauthorizedError and after redirectToAuthorization has been called.
   */
  waitForAuthCode(): Promise<string> {
    if (!this.authCodePromise) return Promise.reject(new Error("[MCP OAuth] No pending authorization"));
    return this.authCodePromise;
  }

  cancelAuthorization(): void {
    if (this.pendingAuthReject) sessionAutoAuthAttempted.delete(this.serverKey);
    this._cleanup();
    this.authCodePromise = null;
    this.verifier = undefined;
  }

  invalidateCredentials(scope: CredentialScope): void {
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
    removeCredentials(this.serverKey, scope);
  }

  /** True once a prior auth attempt failed and requires an explicit user gesture to retry. */
  isAuthBlocked(): boolean {
    return isAuthBlocked(this.serverKey);
  }

  private _cleanup(): void {
    this.popup?.close();
    this.popup = null;
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Reject any promise still awaited by a superseded waitForAuthCode() caller.
    this.pendingAuthReject?.(new McpAuthRequiredError(this.serverId, "cancelled", "OAuth flow was superseded"));
    this.pendingAuthResolve = null;
    this.pendingAuthReject = null;
  }
}

type CredentialScope = "all" | "client" | "tokens" | "verifier" | "discovery";

function removeCredentials(serverKey: string, scope: CredentialScope): void {
  if (scope === "all" || scope === "tokens") removeKey(storageKey(serverKey, "tokens"));
  if (scope === "all" || scope === "client") removeKey(storageKey(serverKey, "client_info"));
  if (scope === "all" || scope === "verifier") removeKey(storageKey(serverKey, "code_verifier"));
  if (scope === "all" || scope === "discovery") removeKey(storageKey(serverKey, "discovery"));
}
