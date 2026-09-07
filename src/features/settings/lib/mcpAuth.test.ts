import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserOAuthClientProvider } from "./mcpAuth";

const listeners = new Set<(event: MessageEvent) => void>();
const providers: BrowserOAuthClientProvider[] = [];
const popup = () => ({ closed: false, close: vi.fn() });
const open = vi.fn();
const provider = () => {
  const value = new BrowserOAuthClientProvider(crypto.randomUUID());
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
