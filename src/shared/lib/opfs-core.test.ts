import { beforeEach, describe, expect, it, vi } from "vitest";
import * as opfs from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";

const memory = new MemoryOpfs();
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

describe("OPFS writes", () => {
  it("aborts a failed write without committing its partial bytes over the last good file", async () => {
    memory.put("profile.json", '{"name":"Before"}');
    memory.beforeWrite = async () => {
      throw new Error("Quota exceeded");
    };
    await expect(opfs.writeJson("profile.json", { name: "After" })).rejects.toThrow("Quota exceeded");
    expect(await opfs.readJson("profile.json")).toEqual({ name: "Before" });
    expect(memory.aborted).toEqual(["profile.json"]);
    expect(memory.closed).toEqual([]);
  });

  it("does not treat corrupt JSON as a missing file", async () => {
    memory.put("profile.json", "{broken");
    await expect(opfs.readJson("profile.json")).rejects.toThrow(/profile.json/);
    expect(await opfs.readJson("missing.json")).toBeUndefined();
  });

  it("removes a newly created placeholder after failure so the next load is not poisoned", async () => {
    memory.beforeWrite = async () => {
      throw new Error("quota");
    };
    await expect(opfs.writeJson("new.json", { value: 1 })).rejects.toThrow("quota");
    expect(await opfs.readJson("new.json")).toBeUndefined();
  });
});

describe("collection indexes", () => {
  it("preserves concurrent additions", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => opfs.upsertIndexEntry("chats", { id: String(i), updated: "2026-01-01" })),
    );
    expect((await opfs.readIndex("chats")).map((entry) => entry.id).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i)).sort(),
    );
  });

  it("does not restore a removed entry when another record is saved concurrently", async () => {
    await opfs.upsertIndexEntry("chats", { id: "old", updated: "2026-01-01" });
    await Promise.all([
      opfs.removeIndexEntry("chats", "old"),
      opfs.upsertIndexEntry("chats", { id: "new", updated: "2026-01-02" }),
    ]);
    expect(await opfs.readIndex("chats")).toEqual([{ id: "new", updated: "2026-01-02" }]);
  });

  it("repairs an invalid index from stored records before updating it", async () => {
    memory.put("chats/index.json", '{"unexpected":true}');
    memory.put("chats/kept/chat.json", '{"id":"kept","title":"Kept","created":"2020-01-01","updated":"2020-01-02"}');
    await opfs.upsertIndexEntry("chats", { id: "new", updated: "2026-01-01" });
    expect(await opfs.readIndex("chats")).toEqual([
      { id: "kept", title: "Kept", created: "2020-01-01", updated: "2020-01-02" },
      { id: "new", updated: "2026-01-01" },
    ]);
  });

  it("repairs a corrupt index on read and keeps salvageable entries", async () => {
    memory.put("chats/index.json", '[{"id":"one","updated":"2019-05-05","customTitle":"Mine"},{"broken":true}]');
    memory.put("chats/one/chat.json", '{"id":"one","messages":[]}');
    memory.put("chats/two/chat.json", '{"id":"two","updated":"2021-01-01","messages":[]}');
    expect(await opfs.readIndex("chats")).toEqual([
      { id: "one", updated: "2019-05-05" },
      { id: "two", updated: "2021-01-01" },
    ]);
    expect(await opfs.readJson("chats/index.json")).toEqual([
      { id: "one", updated: "2019-05-05" },
      { id: "two", updated: "2021-01-01" },
    ]);
    memory.put("plugins/index.json", "not json");
    memory.put("plugins/tool/plugin.json", '{"id":"tool","title":"Tool","installedAt":"2022-02-02"}');
    expect(await opfs.readIndex("plugins")).toEqual([{ id: "tool", title: "Tool", updated: "2022-02-02" }]);
    memory.put("unknown/index.json", '[{"id":"a","updated":"2020-01-01"},null]');
    expect(await opfs.readIndex("unknown")).toEqual([{ id: "a", updated: "2020-01-01" }]);
  });
});
