import { afterEach, describe, expect, it, vi } from "vitest";
import { PersistenceQueue, withPersistenceLock } from "./persistence";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("PersistenceQueue", () => {
  it("coalesces edits and serializes an update arriving during a slow write", async () => {
    const gate = deferred();
    const writes: string[] = [];
    const queue = new PersistenceQueue(vi.fn());
    queue.schedule("chat", async () => {
      writes.push("discarded");
    });
    queue.schedule("chat", async () => {
      writes.push("first");
      await gate.promise;
    });
    const flush = queue.flush();
    await vi.waitFor(() => expect(writes).toEqual(["first"]));
    queue.schedule("chat", async () => {
      writes.push("latest");
    });
    expect(queue.flush()).toBe(flush);
    expect(writes).toEqual(["first"]);
    gate.resolve();
    await flush;
    expect(writes).toEqual(["first", "latest"]);
  });

  it("a deletion replaces a queued save and follows an in-flight save", async () => {
    const gate = deferred();
    const writes: string[] = [];
    const queue = new PersistenceQueue(vi.fn());
    queue.schedule("chat", async () => {
      await gate.promise;
      writes.push("saved");
    });
    const flush = queue.flush();
    await Promise.resolve();
    queue.schedule("chat", async () => {
      writes.push("stale");
    });
    queue.schedule("chat", async () => {
      writes.push("deleted");
    });
    gate.resolve();
    await flush;
    expect(writes).toEqual(["saved", "deleted"]);
  });

  it("keeps failed changes retryable without blocking other records", async () => {
    const queue = new PersistenceQueue(vi.fn());
    const write = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined);
    const other = vi.fn().mockResolvedValue(undefined);
    queue.schedule("chat", write);
    queue.schedule("other", other);
    await expect(queue.flush()).rejects.toThrow("could not be saved");
    expect(write).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("reports the result of the requested record independently of another failed save", async () => {
    const queue = new PersistenceQueue(vi.fn());
    queue.schedule("broken", async () => {
      throw new Error("quota");
    });
    const successful = vi.fn().mockResolvedValue(undefined);
    queue.schedule("new", successful);
    await expect(queue.flushRecord("new")).resolves.toBeUndefined();
    expect(successful).toHaveBeenCalledTimes(1);
    await expect(queue.flushRecord("broken")).rejects.toThrow();
  });

  it("does not retry an obsolete failed snapshot after a newer one succeeded", async () => {
    const gate = deferred();
    const queue = new PersistenceQueue(vi.fn());
    const latest = vi.fn().mockResolvedValue(undefined);
    queue.schedule("chat", async () => {
      await gate.promise;
      throw new Error("old write");
    });
    const flush = queue.flush();
    await Promise.resolve();
    queue.schedule("chat", latest);
    gate.resolve();
    await flush;
    await queue.flush();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("saves during continuous edits instead of postponing persistence indefinitely", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const queue = new PersistenceQueue(vi.fn(), 100);
    for (let i = 0; i < 5; i++) {
      queue.schedule("chat", write);
      await vi.advanceTimersByTimeAsync(25);
    }
    expect(write).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });
});

it("serializes the entire read/modify/write operation and releases locks after failure", async () => {
  let index: string[] = [];
  const append = (id: string) =>
    withPersistenceLock("test-index", async () => {
      const snapshot = [...index];
      await Promise.resolve();
      index = [...snapshot, id];
    });
  await Promise.all([append("a"), append("b")]);
  expect(index).toEqual(["a", "b"]);
  await expect(
    withPersistenceLock("test-index", async () => {
      throw new Error("write failed");
    }),
  ).rejects.toThrow();
  await append("c");
  expect(index).toEqual(["a", "b", "c"]);
});
