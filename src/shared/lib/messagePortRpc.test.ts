import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPortReply } from "./messagePortRpc";

class Channel {
  port1 = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onmessageerror: null as (() => void) | null,
    close: vi.fn(),
  };
  port2 = { close: vi.fn() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function channel() {
  const value = new Channel();
  vi.stubGlobal(
    "MessageChannel",
    class {
      constructor() {
        return value;
      }
    },
  );
  return value;
}

describe("message-port request ownership", () => {
  it("does not allocate or send for an already cancelled caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const create = vi.fn();
    vi.stubGlobal("MessageChannel", create);
    const send = vi.fn();
    await expect(requestPortReply(send, { signal: controller.signal })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["reply", "abort", "timeout", "clone", "decode"])("closes its channel on %s", async (mode) => {
    vi.useFakeTimers();
    const ports = channel();
    const controller = new AbortController();
    const result = requestPortReply(
      () => {
        if (mode === "clone") throw new Error("clone");
      },
      { signal: controller.signal, timeoutMs: 100 },
    );
    const check = mode === "reply" ? expect(result).resolves.toEqual({ answer: 42 }) : expect(result).rejects.toThrow();
    if (mode === "reply") ports.port1.onmessage?.({ data: { answer: 42 } });
    if (mode === "abort") controller.abort();
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(100);
    if (mode === "decode") ports.port1.onmessageerror?.();
    await check;
    expect(ports.port1.close).toHaveBeenCalledOnce();
    expect(ports.port2.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
