import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecuteMessage } from "./interpreterProtocol";
import { createWorkerHost } from "./workerHost";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";

class TestWorker extends EventTarget {
  requests: ExecuteMessage[] = [];
  terminate = vi.fn();
  postMessage(message: ExecuteMessage) {
    this.requests.push(message);
  }
  finish(index: number, output: string) {
    const port = this.requests[index].port;
    port.postMessage({ type: "result", result: { success: true, output, files: {} } });
    port.close();
  }
}

describe("interpreter host coordination", () => {
  afterEach(() => vi.useRealTimers());

  it("honors parent invocation cancellation without a separate execution signal", async () => {
    const worker = new TestWorker();
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage: async () => undefined,
      crashMessage: "crashed",
    });
    const parent = new AbortController();
    const context = { invocationContext: new AgentInvocationContext({ signal: parent.signal }) };
    const first = host.execute({ code: "while True: pass" }, { context });
    parent.abort();
    expect((await first).error).toBe("Code execution aborted");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect((await host.execute({ code: "must not start" }, { context })).error).toBe("Execution cancelled");
    expect(worker.requests).toHaveLength(1);
  });

  it("settles a failed execution post and recovers with a new worker", async () => {
    const broken = new TestWorker();
    vi.spyOn(broken, "postMessage").mockImplementation(() => {
      throw new Error("Cannot clone input");
    });
    const fresh = new TestWorker();
    const host = createWorkerHost({
      createWorker: vi.fn().mockReturnValueOnce(broken).mockReturnValueOnce(fresh),
      handleMessage: async () => undefined,
      crashMessage: "crashed",
    });
    expect((await host.execute({ code: "broken" })).error).toBe("Cannot clone input");
    const next = host.execute({ code: "next" });
    fresh.finish(0, "recovered");
    expect((await next).output).toBe("recovered");
    expect(broken.terminate).toHaveBeenCalledOnce();
  });

  it("keeps the compute watchdog paused if started arrives while an RPC is pending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const worker = new TestWorker();
    let release!: () => void;
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      crashMessage: "crashed",
      computeStallMs: 100,
    });
    const run = host.execute({ code: "await llm('Question')" });
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "llm-request",
          prompt: "Question",
          port: { postMessage: vi.fn(), close: vi.fn() },
        },
      }),
    );
    worker.requests[0].port.postMessage({ type: "started" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.terminate).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect((await run).error).toContain("Code execution stalled");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts unfinished RPCs when their execution ends, without aborting the parent run", async () => {
    const worker = new TestWorker();
    let signal: AbortSignal | undefined;
    const handleMessage = vi.fn((_message, options) => {
      signal = options?.signal;
      return new Promise((resolve) => signal?.addEventListener("abort", () => resolve("cancelled"), { once: true }));
    });
    const parent = new AbortController();
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage,
      crashMessage: "crashed",
    });
    const run = host.execute({ code: "void llm('Question')" }, { signal: parent.signal });
    const port = { postMessage: vi.fn(), close: vi.fn() };
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "llm-request", prompt: "Question", port } }));
    worker.finish(0, "done");
    await run;
    expect(signal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  it("cancels RPCs on a crash and ignores a retired worker crashing during the next run", async () => {
    const old = new TestWorker();
    const current = new TestWorker();
    const createWorker = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(current);
    let signal: AbortSignal | undefined;
    const handleMessage = vi.fn((_message, options) => {
      signal = options?.signal;
      return new Promise((resolve) => signal?.addEventListener("abort", () => resolve("cancelled"), { once: true }));
    });
    const host = createWorkerHost({ createWorker, handleMessage, crashMessage: "crashed" });
    const first = host.execute({ code: "llm('Question')" });
    old.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "llm-request",
          prompt: "Question",
          port: { postMessage: vi.fn(), close: vi.fn() },
        },
      }),
    );
    old.dispatchEvent(new Event("error"));
    expect((await first).success).toBe(false);
    const firstSignal = signal;
    const second = host.execute({ code: "second" });
    old.dispatchEvent(new Event("error"));
    current.finish(0, "second finished");
    expect((await second).output).toBe("second finished");
    expect(current.terminate).not.toHaveBeenCalled();
    expect(firstSignal?.aborted).toBe(true);
  });

  it("passes the owning run's model and budget to RPCs and ignores messages after completion", async () => {
    const worker = new TestWorker();
    const handleMessage = vi.fn(async () => "Answer");
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage,
      crashMessage: "crashed",
    });
    const context = { model: "run-model", invocationContext: new AgentInvocationContext({ maxModelCalls: 3 }) };
    const run = host.execute({ code: "llm('Question')", files: {} }, { context });
    const rpc = () => {
      const port = { postMessage: vi.fn(), close: vi.fn() };
      worker.dispatchEvent(new MessageEvent("message", { data: { type: "llm-request", prompt: "Question", port } }));
    };
    rpc();
    expect(handleMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "llm-request" }), {
      signal: expect.any(AbortSignal),
      context,
    });
    worker.finish(0, "done");
    await run;
    rpc();
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
  it("serializes callers independently of the artifact workspace they use", async () => {
    const worker = new TestWorker();
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage: async () => undefined,
      crashMessage: "crashed",
    });
    const first = host.execute({ code: "first", files: {} });
    const second = host.execute({ code: "second", files: {} });
    expect(worker.requests.map((request) => request.request.code)).toEqual(["first"]);
    worker.finish(0, "one");
    expect((await first).output).toBe("one");
    expect(worker.requests.map((request) => request.request.code)).toEqual(["first", "second"]);
    worker.finish(1, "two");
    expect((await second).output).toBe("two");
  });

  it("cancelling queued execution neither starts it nor terminates the active worker", async () => {
    const worker = new TestWorker();
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage: async () => undefined,
      crashMessage: "crashed",
    });
    const first = host.execute({ code: "first", files: {} });
    const controller = new AbortController();
    const second = host.execute({ code: "cancelled", files: {} }, { signal: controller.signal });
    controller.abort();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.finish(0, "done");
    await first;
    expect((await second).success).toBe(false);
    expect(worker.requests).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});

describe("worker lifetime boundaries", () => {
  afterEach(() => vi.useRealTimers());

  it("cancels a queued run promptly without letting a later run overlap the active one", async () => {
    const worker = new TestWorker();
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage: async () => {},
      crashMessage: "crashed",
    });
    const first = host.execute({ code: "first" });
    const controller = new AbortController();
    const cancelled = host.execute({ code: "cancelled" }, { signal: controller.signal });
    controller.abort();
    expect((await cancelled).success).toBe(false);
    const third = host.execute({ code: "third" });
    expect(worker.requests).toHaveLength(1);
    worker.finish(0, "first");
    await first;
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    expect(worker.requests[1].request.code).toBe("third");
    worker.finish(1, "third");
    expect((await third).output).toBe("third");
  });

  it("closes pending RPC ports even when the handler ignores cancellation", async () => {
    const worker = new TestWorker();
    const host = createWorkerHost({
      createWorker: () => worker as unknown as Worker,
      handleMessage: () => new Promise(() => {}),
      crashMessage: "crashed",
    });
    const run = host.execute({ code: "unfinished RPC" });
    const port = { postMessage: vi.fn(), close: vi.fn() };
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "llm-request", prompt: "pending", port } }));
    worker.finish(0, "done");
    await run;
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("retires idle runtimes, then recovers after a message decoding failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const workers = [new TestWorker(), new TestWorker()];
    const createWorker = vi.fn().mockReturnValueOnce(workers[0]).mockReturnValueOnce(workers[1]);
    const host = createWorkerHost({
      createWorker,
      handleMessage: async () => {},
      crashMessage: "crashed",
      idleTimeoutMs: 100,
    });
    const first = host.execute({ code: "first" });
    workers[0].finish(0, "done");
    await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const second = host.execute({ code: "second" });
    workers[1].dispatchEvent(new Event("messageerror"));
    expect((await second).error).toBe("crashed");
    expect(workers[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
