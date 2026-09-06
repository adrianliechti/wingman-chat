import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderState } from "@/shared/types/chat";
import { McpAuthRequiredError } from "./mcpAuth";
import { connectMcpWithRetry } from "./mcpRetry";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("MCP retry ownership", () => {
  it("retries transient failures and publishes only the final state", async () => {
    const client = { connect: vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined) };
    const state = vi.fn();
    const connecting = connectMcpWithRetry(client, new AbortController().signal, state);
    await vi.advanceTimersByTimeAsync(500);
    await connecting;
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(state.mock.calls).toEqual([[ProviderState.Connected]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("removal during backoff cancels the timer and never reconnects a removed provider", async () => {
    const client = { connect: vi.fn().mockRejectedValue(new Error("offline")) };
    const controller = new AbortController();
    const state = vi.fn();
    const connecting = connectMcpWithRetry(client, controller.signal, state);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await connecting;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.connect).toHaveBeenCalledOnce();
    expect(state).not.toHaveBeenCalled();
  });
  it("ignores a successful connection from an attempt that was disabled", async () => {
    let release!: () => void;
    const client = {
      connect: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const controller = new AbortController();
    const state = vi.fn();
    const connecting = connectMcpWithRetry(client, controller.signal, state);
    controller.abort();
    release();
    await connecting;
    expect(state).not.toHaveBeenCalled();
  });
  it("requires user action after authentication failure without scheduling retries", async () => {
    const client = { connect: vi.fn().mockRejectedValue(new McpAuthRequiredError("test", "denied")) };
    const state = vi.fn();
    await connectMcpWithRetry(client, new AbortController().signal, state);
    expect(state.mock.calls).toEqual([[ProviderState.Unauthorized]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
