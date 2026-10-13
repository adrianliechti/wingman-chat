import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { BrowserOAuthClientProvider } from "./mcpAuth";

const listeners = new Set<(event: MessageEvent) => void>();
const providers: BrowserOAuthClientProvider[] = [];
const popup = () => ({ closed: false, close: vi.fn() });
const open = vi.fn();
const provider = () => {
  const value = new BrowserOAuthClientProvider("test", `https://example.test/${crypto.randomUUID()}`);
  providers.push(value);
  return value;
};
const message = (source: unknown, code: string, origin = "https://chat.test") => {
  listeners.forEach((listener) =>
    listener({ source, origin, data: { type: "mcp_oauth_callback", code } } as MessageEvent),
  );
};
beforeEach(() => {
  vi.useFakeTimers();
  open.mockReset();
  listeners.clear();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return saved.size;
    },
    key: (index: number) => [...saved.keys()][index] ?? null,
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal("window", {
    location: { origin: "https://chat.test" },
    open,
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
  });
});
afterEach(() => {
  providers.splice(0).forEach((value) => value.cancelAuthorization());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("MCP OAuth popup ownership", () => {
  it("routes concurrent servers' callbacks only to their own popup", async () => {
    const firstPopup = popup();
    const secondPopup = popup();
    open.mockReturnValueOnce(firstPopup).mockReturnValueOnce(secondPopup);
    const first = provider();
    const second = provider();
    await first.redirectToAuthorization(new URL("https://auth.test/first"));
    await second.redirectToAuthorization(new URL("https://auth.test/second"));
    const firstCode = first.waitForAuthCode();
    const secondCode = second.waitForAuthCode();
    message(firstPopup, "wrong-origin", "https://unrelated.test");
    message({}, "wrong-window");
    expect(listeners.size).toBe(2);
    message(secondPopup, "second-code");
    expect(await secondCode).toBe("second-code");
    expect(listeners.size).toBe(1);
    message(firstPopup, "first-code");
    expect(await firstCode).toBe("first-code");
    expect(open.mock.calls[0][1]).not.toBe(open.mock.calls[1][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending authorization, closes its popup, and allows a fresh attempt", async () => {
    const firstPopup = popup();
    const secondPopup = popup();
    open.mockReturnValueOnce(firstPopup).mockReturnValueOnce(secondPopup);
    const auth = provider();
    await auth.redirectToAuthorization(new URL("https://auth.test/first"));
    const cancelled = expect(auth.waitForAuthCode()).rejects.toMatchObject({ reason: "cancelled" });
    auth.cancelAuthorization();
    await cancelled;
    expect(firstPopup.close).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await auth.redirectToAuthorization(new URL("https://auth.test/second"));
    const code = auth.waitForAuthCode();
    message(firstPopup, "stale");
    expect(listeners.size).toBe(1);
    message(secondPopup, "fresh");
    expect(await code).toBe("fresh");
  });

  it("retains popup failure for a later waiter without an unhandled rejection", async () => {
    open.mockReturnValue(null);
    const auth = provider();
    await auth.redirectToAuthorization(new URL("https://auth.test/blocked"));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(auth.waitForAuthCode()).rejects.toMatchObject({ reason: "blocked" });
  });
});

describe("endpoint credential isolation", () => {
  it("reuses normalized endpoint credentials but never forwards them to a different endpoint", async () => {
    const original = new BrowserOAuthClientProvider("same-id", "https://OLD.test:443/mcp#ignored");
    original.saveTokens({ access_token: "fake-old-host-token", token_type: "Bearer" });
    original.saveClientInformation({ client_id: "old-client" });
    original.saveCodeVerifier("old-verifier");
    expect(new BrowserOAuthClientProvider("renamed-id", "https://old.test/mcp").tokens()?.access_token).toBe(
      "fake-old-host-token",
    );
    for (const endpoint of [
      "https://new.test/mcp",
      "https://old.test/other",
      "https://old.test/mcp/",
      "https://old.test/mcp?tenant=new",
    ]) {
      const auth = new BrowserOAuthClientProvider("same-id", endpoint);
      expect(auth.tokens()).toBeUndefined();
      expect(auth.clientInformation()).toBeUndefined();
      expect(() => auth.codeVerifier()).toThrow();
      const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
      );
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider: auth, fetch: fetcher });
      await transport.start();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
      expect(new Headers(fetcher.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
      await transport.close();
    }
  });

  it("shares a login across IDs, isolates PKCE, and ignores unbound legacy credentials", () => {
    localStorage.setItem("mcp_oauth:demo:tokens", JSON.stringify({ access_token: "legacy" }));
    const first = new BrowserOAuthClientProvider("demo", "https://first.test/mcp");
    expect(first.tokens()).toBeUndefined();
    const other = new BrowserOAuthClientProvider("demo-extra", "https://first.test/mcp");
    first.saveTokens({ access_token: "fake", token_type: "Bearer" });
    first.saveClientInformation({ client_id: "shared-client" });
    first.saveCodeVerifier("private-verifier");
    expect(other.tokens()?.access_token).toBe("fake");
    expect(other.clientInformation()?.client_id).toBe("shared-client");
    expect(() => other.codeVerifier()).toThrow();
    expect(first.codeVerifier()).toBe("private-verifier");
    other.invalidateCredentials("tokens");
    expect(first.tokens()).toBeUndefined();
    expect(first.clientInformation()?.client_id).toBe("shared-client");
  });

  it("migrates the complete endpoint-bound login even when the provider ID has changed", () => {
    const prefix = `mcp_oauth:v2:old-id:${encodeURIComponent("https://first.test/mcp")}`;
    localStorage.setItem(`${prefix}:tokens`, JSON.stringify({ access_token: "bound-token", token_type: "Bearer" }));
    localStorage.setItem(`${prefix}:client_info`, JSON.stringify({ client_id: "bound-client" }));
    localStorage.setItem(`${prefix}:discovery`, JSON.stringify({ authorizationServerUrl: "https://auth.test" }));
    localStorage.setItem(`${prefix}:code_verifier`, JSON.stringify("stale-verifier"));
    expect(new BrowserOAuthClientProvider("old-id", "https://other.test/mcp").tokens()).toBeUndefined();
    const migrated = new BrowserOAuthClientProvider("renamed", "https://first.test/mcp");
    expect(migrated.tokens()?.access_token).toBe("bound-token");
    expect(migrated.clientInformation()?.client_id).toBe("bound-client");
    expect(migrated.discoveryState()?.authorizationServerUrl).toBe("https://auth.test");
    expect(() => migrated.codeVerifier()).toThrow();
    expect(localStorage.getItem(`${prefix}:tokens`)).toBeNull();
    migrated.invalidateCredentials("all");
    expect(new BrowserOAuthClientProvider("old-id", "https://first.test/mcp").tokens()).toBeUndefined();
  });

  it("does not replace a shared login with an old per-ID login", () => {
    const shared = new BrowserOAuthClientProvider("static", "https://first.test/mcp");
    shared.saveTokens({ access_token: "shared", token_type: "Bearer" });
    shared.saveClientInformation({ client_id: "shared-client" });
    const prefix = `mcp_oauth:v2:plugin:${encodeURIComponent("https://first.test/mcp")}`;
    localStorage.setItem(`${prefix}:tokens`, JSON.stringify({ access_token: "old", token_type: "Bearer" }));
    localStorage.setItem(`${prefix}:client_info`, JSON.stringify({ client_id: "old-client" }));
    const plugin = new BrowserOAuthClientProvider("plugin", "https://first.test/mcp");
    expect(plugin.tokens()?.access_token).toBe("shared");
    expect(plugin.clientInformation()?.client_id).toBe("shared-client");
    expect(localStorage.getItem(`${prefix}:tokens`)).toBeNull();
  });

  it("migrates an existing endpoint login instead of another ID's incomplete attempt", () => {
    const endpoint = "https://first.test/mcp";
    localStorage.setItem(
      `mcp_oauth:v2:a:${encodeURIComponent(endpoint)}:client_info`,
      JSON.stringify({ client_id: "incomplete" }),
    );
    const prefix = `mcp_oauth:v2:z:${encodeURIComponent(endpoint)}`;
    localStorage.setItem(`${prefix}:tokens`, JSON.stringify({ access_token: "existing", token_type: "Bearer" }));
    localStorage.setItem(`${prefix}:client_info`, JSON.stringify({ client_id: "existing-client" }));
    const migrated = new BrowserOAuthClientProvider("a", endpoint);
    expect(migrated.tokens()?.access_token).toBe("existing");
    expect(migrated.clientInformation()?.client_id).toBe("existing-client");
  });
});
