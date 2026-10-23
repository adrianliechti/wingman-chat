import { expect, it, vi } from "vitest";
import * as opfs from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import { PersistenceQueue, registerPersistenceQueue } from "./persistence";

it("a full reset waits for an active write and prevents queued or late work from recreating data", async () => {
  const memory = new MemoryOpfs();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  let release!: () => void;
  let held = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  memory.beforeWrite = async () => {
    held = true;
    await gate;
  };
  const queue = new PersistenceQueue(vi.fn());
  const unregister = registerPersistenceQueue(queue);
  queue.schedule("active", () => opfs.writeJson("active.json", {}));
  const writing = queue.flush();
  await vi.waitFor(() => expect(held).toBe(true));
  queue.schedule("queued", () => opfs.writeJson("queued.json", {}));
  const resetting = opfs.clearAll();
  release();
  await Promise.all([writing, resetting]);
  expect(memory.files.size).toBe(0);
  expect(() => queue.schedule("late", () => opfs.writeJson("late.json", {}))).toThrow("reset");
  await expect(opfs.writeJson("background.json", {})).rejects.toThrow("reset");
  unregister();
});
