import { describe, expect, it, vi } from "vitest";
import { createUiRuntime, getUiRuntime, hashSource } from "./runtime";
import { normalizeDocument } from "./schema";

const loan = () =>
  normalizeDocument({
    state: { principal: 1000, rate: 5, years: 2 },
    computed: {
      total: "{{ principal + interest }}",
      interest: "principal * rate / 100 * years",
      broken: "principal +",
      label: "{{ years }} years at {{ rate }}%",
    },
    children: [
      { type: "slider", bind: "principal", min: 0, max: 5000 },
      { type: "toggle", bind: "agree" },
      { type: "metric", label: "Total", value: "{{ total }}" },
    ],
  });

describe("createUiRuntime", () => {
  it("evaluates computed values in dependency order and reacts to state", () => {
    const runtime = createUiRuntime(loan());
    expect(runtime.scope.get().values.interest).toBe(100);
    expect(runtime.scope.get().values.total).toBe(1100);
    expect(runtime.scope.get().values.label).toBe("2 years at 5%");
    expect(runtime.scope.get().errors.broken).toMatch(/Unexpected end/);
    expect(runtime.scope.get().values.agree).toBeNull();

    runtime.setValue("principal", 2000);
    expect(runtime.scope.get().values.total).toBe(2200);
  });

  it("notifies subscribers once per change", () => {
    const runtime = createUiRuntime(loan());
    const listener = vi.fn();
    runtime.scope.subscribe(listener);
    runtime.setValue("rate", 10);
    runtime.setValue("rate", 10);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].values.interest).toBe(200);
  });

  it("resolves templates and reports expression errors inline", () => {
    const runtime = createUiRuntime(loan());
    expect(runtime.resolve("Total {{ total }}")).toBe("Total 1100");
    expect(runtime.resolve("{{ total }}")).toBe(1100);
    expect(runtime.resolve("{{ 1 + }}")).toMatch(/^⚠/);
    expect(runtime.resolve(5)).toBe(5);
  });

  it("evaluates visibility conditions as booleans, templates or bare expressions", () => {
    const runtime = createUiRuntime(loan());
    expect(runtime.condition(true)).toBe(true);
    expect(runtime.condition("principal > 500")).toBe(true);
    expect(runtime.condition("{{ principal > 5000 }}")).toBe(false);
    expect(runtime.condition("agree")).toBe(false);
    expect(runtime.condition("1 +")).toBe(false);
    expect(runtime.condition("")).toBe(false);
  });

  it("runs set, reset, send, copy and open actions through the host", async () => {
    const runtime = createUiRuntime(loan());
    const host = {
      sendMessage: vi.fn(),
      copyText: vi.fn(),
      openUrl: vi.fn(),
      notify: vi.fn(),
    };

    await runtime.run([{ type: "set", values: { principal: "{{ principal * 2 }}", agree: true } }], host);
    expect(runtime.state.get().principal).toBe(2000);
    expect(runtime.state.get().agree).toBe(true);

    await runtime.run([{ type: "send", message: "Explain a total of {{ total }}" }], host);
    expect(host.sendMessage).toHaveBeenCalledWith("Explain a total of 2200");

    await runtime.run([{ type: "send", message: "Review", context: true }], host);
    expect(host.sendMessage).toHaveBeenLastCalledWith(
      `Review\n\nCurrent values: ${JSON.stringify({ principal: 2000, rate: 5, years: 2, agree: true })}`,
    );

    await runtime.run([{ type: "copy", text: "{{ interest }}" }], host);
    expect(host.copyText).toHaveBeenCalledWith("200");

    await runtime.run([{ type: "open", url: "javascript:alert(1)" }], host);
    expect(host.openUrl).not.toHaveBeenCalled();
    await runtime.run([{ type: "open", url: "https://example.com/?p={{ principal }}" }], host);
    expect(host.openUrl).toHaveBeenCalledWith("https://example.com/?p=2000");

    await runtime.run([{ type: "reset", keys: ["principal"] }], host);
    expect(runtime.state.get().principal).toBe(1000);
    expect(runtime.state.get().agree).toBe(true);
    await runtime.run([{ type: "reset" }], host);
    expect(runtime.state.get().agree).toBeNull();
  });

  it("tells the host when sending is unavailable", async () => {
    const runtime = createUiRuntime(loan());
    const notify = vi.fn();
    await runtime.run([{ type: "send", message: "hi" }], { notify });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("not available"), "error");
  });

  it("does not let actions mutate the defaults used by reset", async () => {
    const runtime = createUiRuntime(
      normalizeDocument({
        state: { items: [1] },
        children: [{ type: "button", label: "Add", action: { set: { items: "{{ items + [2] }}" } } }],
      }),
    );
    await runtime.run([{ type: "set", values: { items: "{{ items + [2] }}" } }], {});
    expect(runtime.state.get().items).toEqual([1, 2]);
    runtime.reset();
    expect(runtime.state.get().items).toEqual([1]);
  });
});

describe("persistence", () => {
  it("restores saved values for declared keys and saves changes", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
      removeItem: (key: string) => void saved.delete(key),
    });
    vi.useFakeTimers();
    try {
      const key = hashSource("persisted");
      saved.set(`ui-state:${key}`, JSON.stringify({ principal: 4000, stale: 1 }));
      const runtime = getUiRuntime("persisted", loan());
      expect(runtime.state.get().principal).toBe(4000);
      expect(runtime.state.get()).not.toHaveProperty("stale");
      runtime.setValue("rate", 9);
      vi.advanceTimersByTime(400);
      expect(JSON.parse(saved.get(`ui-state:${key}`) ?? "{}")).toMatchObject({ principal: 4000, rate: 9 });
      expect(JSON.parse(saved.get("ui-state-index") ?? "[]")).toEqual([key]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("getUiRuntime", () => {
  it("reuses the runtime for the same source", () => {
    const doc = loan();
    const first = getUiRuntime("source-a", doc);
    first.setValue("principal", 42);
    expect(getUiRuntime("source-a", doc)).toBe(first);
    expect(getUiRuntime("source-b", doc)).not.toBe(first);
    expect(getUiRuntime("source-a", doc).state.get().principal).toBe(42);
  });
});
