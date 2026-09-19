import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_STATE_MAX_BYTES,
  deleteArtifactState,
  readArtifactState,
  updateArtifactState,
  writeArtifactState,
} from "./opfs-artifact-state";
import { MemoryOpfs } from "./test-support/memoryOpfs";

const memory = new MemoryOpfs();

beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});
afterEach(() => vi.unstubAllGlobals());

describe("artifact state", () => {
  it("starts empty, round-trips JSON, and merges updates", async () => {
    expect(await readArtifactState("chat", "/dash.html")).toEqual({});
    await writeArtifactState("chat", "/dash.html", { filter: "eu" });
    await updateArtifactState("chat", "/dash.html", (state) => ({ ...state, page: 2 }));
    expect(await readArtifactState("chat", "/dash.html")).toEqual({ filter: "eu", page: 2 });
    await deleteArtifactState("chat", "/dash.html");
    expect(await readArtifactState("chat", "/dash.html")).toEqual({});
  });

  it("keeps state per artifact path and ignores corrupt files", async () => {
    await writeArtifactState("chat", "/a.html", { a: 1 });
    expect(await readArtifactState("chat", "/b.html")).toEqual({});
    memory.put(`chats/chat/artifact-state/${encodeURIComponent("/broken.html")}.json`, "[1,2");
    expect(await readArtifactState("chat", "/broken.html")).toEqual({});
  });

  it("refuses state over the size limit", async () => {
    await expect(
      writeArtifactState("chat", "/big.html", { blob: "x".repeat(ARTIFACT_STATE_MAX_BYTES) }),
    ).rejects.toThrow("limit");
  });
});
