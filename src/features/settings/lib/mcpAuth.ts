import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthDiscoveryState, OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

const STORAGE_PREFIX = "mcp_oauth";

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
    console.warn(`[MCP OAuth] Failed to write to localStorage (${key}):`, e);
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Browser-compatible OAuthClientProvider for MCP servers.
 *
 * Uses localStorage for persisting tokens, client registration, and PKCE state.
 * Opens a popup window for the OAuth authorization redirect and receives the
 * authorization code back via postMessage from the /oauth/callback page.
 */
export class BrowserOAuthClientProvider implements OAuthClientProvider {
  private readonly serverKey: string;
  private pendingAuthResolve: ((code: string) => void) | null = null;
  private pendingAuthReject: ((err: Error) => void) | null = null;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private authCodePromise: Promise<string> | null = null;

  constructor(serverKey: string) {
    this.serverKey = serverKey;
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
  }

  saveCodeVerifier(verifier: string): void {
    writeJson(storageKey(this.serverKey, "code_verifier"), verifier);
  }

  codeVerifier(): string {
    const v = readJson<string>(storageKey(this.serverKey, "code_verifier"));
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
   */
  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Clean up any previous popup/listener
    this._cleanup();

    return new Promise<void>((resolve) => {
      const popup = window.open(
        authorizationUrl.toString(),
        "mcp_oauth",
        "popup,width=600,height=700,left=200,top=100",
      );

      if (!popup) {
        this.authCodePromise = Promise.reject(
          new Error("Popup was blocked. Please allow popups for this site and try again."),
        );
        resolve();
        return;
      }

      // Set up the auth code promise so waitForAuthCode() can await it
      this.authCodePromise = new Promise<string>((res, rej) => {
        this.pendingAuthResolve = res;
        this.pendingAuthReject = rej;
      });

      // Attach postMessage listener to receive the auth code from /oauth/callback
      const listener = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== "mcp_oauth_callback") return;

        if (event.data.error) {
          this.pendingAuthReject?.(new Error(`OAuth error: ${event.data.error}`));
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
            this.pendingAuthReject(new Error("OAuth popup was closed before authorization completed"));
          }
          this._cleanup();
        }
      }, 500);

      // authCodePromise is now a proper private field — no type cast needed

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

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all" || scope === "tokens") {
      removeKey(storageKey(this.serverKey, "tokens"));
    }
    if (scope === "all" || scope === "client") {
      removeKey(storageKey(this.serverKey, "client_info"));
    }
    if (scope === "all" || scope === "verifier") {
      removeKey(storageKey(this.serverKey, "code_verifier"));
    }
    if (scope === "all" || scope === "discovery") {
      removeKey(storageKey(this.serverKey, "discovery"));
    }
  }

  private _cleanup(): void {
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pendingAuthResolve = null;
    this.pendingAuthReject = null;
  }
}

/**
 * Removes all OAuth localStorage entries for a given server key.
 * Call this when a server is deleted so stale credentials don't accumulate.
 */
export function clearMcpOAuthStorage(serverKey: string): void {
  removeKey(storageKey(serverKey, "tokens"));
  removeKey(storageKey(serverKey, "client_info"));
  removeKey(storageKey(serverKey, "code_verifier"));
  removeKey(storageKey(serverKey, "discovery"));
}
