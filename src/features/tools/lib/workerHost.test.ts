import { describe, expect, it, vi } from "vitest";
import type { ExecuteMessage } from "./interpreterProtocol";
import { createWorkerHost } from "./workerHost";

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
