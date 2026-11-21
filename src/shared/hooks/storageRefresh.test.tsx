// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePersistentCollection } from "./usePersistentCollection";
import { usePersistedState } from "./usePersistedState";
import { publishStorageChanges } from "../lib/storageChanges";
import { MemoryOpfs } from "../lib/test-support/memoryOpfs";
import { writeJson } from "../lib/opfs-core";

interface Item {
  id: string;
  title: string;
}
let disk: Item[] = [];
const storage = { load: vi.fn(async () => disk), store: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
let collection!: ReturnType<typeof usePersistentCollection<Item>>;
let profile!: ReturnType<typeof usePersistedState<{ name: string }>>;
let root: Root;
const memory = new MemoryOpfs();
function Fixture() {
  collection = usePersistentCollection(storage, "projects");
  profile = usePersistedState({ key: "profile.json", defaultValue: { name: "" }, debounceMs: 60_000 });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  memory.reset();
  disk = [{ id: "old", title: "initial" }];
  storage.load.mockImplementation(async () => disk);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => {
    await profile.flush();
    await collection.flush("old");
    root.unmount();
  });
  vi.unstubAllGlobals();
});

it("refreshes mounted collections and profile after a restore, including deletions", async () => {
  disk = [{ id: "new", title: "restored" }];
  await writeJson("profile.json", { name: "Restored profile" });
  await act(async () => publishStorageChanges(["projects/index.json", "profile.json"]));
  expect(collection.items).toEqual(disk);
  expect(profile.value.name).toBe("Restored profile");
  disk = [];
  await act(async () => publishStorageChanges(["projects/new/project.json"]));
  expect(collection.items).toEqual([]);
});

it("preserves unsaved local edits during a restore", async () => {
  await act(async () => {
    collection.update("old", (item) => ({ ...item, title: "unsaved" }));
    profile.setValue({ name: "Unsaved profile" });
    disk = [
      { id: "old", title: "remote" },
      { id: "new", title: "restored" },
    ];
    await writeJson("profile.json", { name: "Remote profile" });
    publishStorageChanges(["projects/index.json", "profile.json"]);
  });
  expect(collection.items).toContainEqual({ id: "old", title: "unsaved" });
  expect(collection.items).toContainEqual({ id: "new", title: "restored" });
  expect(profile.value.name).toBe("Unsaved profile");
});

it("preserves an edit made while the refresh read is in flight", async () => {
  let resolve!: (items: Item[]) => void;
  storage.load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => publishStorageChanges(["projects/index.json"]));
  await act(async () => {
    collection.update("old", (item) => ({ ...item, title: "during restore" }));
    await collection.flush("old");
    resolve([{ id: "old", title: "remote" }]);
  });
  expect(collection.items).toEqual([{ id: "old", title: "during restore" }]);
});
