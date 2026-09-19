import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveArtifactRevision,
  copyArtifactRevisionHistory,
  listArtifactRevisionEntries,
  listArtifactRevisions,
  loadArtifactRevision,
} from "./opfs-artifacts";
import { readJson, writeJson } from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";

const memory = new MemoryOpfs();

function revision(path: string, content: string, createdAt: string, origin?: { actor: "assistant" | "user" | "system" }) {
  return { path, revision: `sha256:${content}`, content, contentType: "text/plain", createdAt, origin };
}

beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});
afterEach(() => vi.unstubAllGlobals());

describe("artifact revision log", () => {
  it("keeps revisions in production order and skips a repeated last revision", async () => {
    await archiveArtifactRevision("chat", revision("/a.md", "v1", "2026-01-01T00:00:00.000Z", { actor: "assistant" }));
    // A pre-image snapshot taken before an update repeats the last revision.
    await archiveArtifactRevision("chat", revision("/a.md", "v1", "2026-01-01T00:00:01.000Z"));
    await archiveArtifactRevision("chat", revision("/a.md", "v2", "2026-01-02T00:00:00.000Z", { actor: "user" }));
    // Restoring v1 reproduces its hash but is a new step in the history.
    await archiveArtifactRevision("chat", revision("/a.md", "v1", "2026-01-03T00:00:00.000Z", { actor: "user" }));

    const entries = await listArtifactRevisionEntries("chat", "/a.md");
    expect(entries.map((entry) => entry.revision)).toEqual(["sha256:v1", "sha256:v2", "sha256:v1"]);
    expect(entries[0]).toMatchObject({ size: 2, contentType: "text/plain", origin: { actor: "assistant" } });
    expect(await listArtifactRevisions("chat", "/a.md")).toEqual(expect.arrayContaining(["sha256:v1", "sha256:v2"]));
    expect(await listArtifactRevisions("chat", "/a.md")).toHaveLength(2);
  });

  it("merges revision files that predate the log by their stored timestamp", async () => {
    const directory = `chats/chat/artifact-versions/${encodeURIComponent("/legacy.md")}`;
    await writeJson(`${directory}/${encodeURIComponent("sha256:new")}.json`, revision("/legacy.md", "new", "2026-02-02T00:00:00.000Z"));
    await writeJson(`${directory}/${encodeURIComponent("sha256:old")}.json`, revision("/legacy.md", "old", "2026-02-01T00:00:00.000Z"));

    const entries = await listArtifactRevisionEntries("chat", "/legacy.md");
    expect(entries.map((entry) => entry.revision)).toEqual(["sha256:old", "sha256:new"]);

    const persisted = await readJson<{ entries: unknown[] }>(`${directory}/history.json`);
    expect(persisted?.entries).toHaveLength(2);
    // A later archive appends after the repaired log instead of reading files again.
    await archiveArtifactRevision("chat", revision("/legacy.md", "newest", "2026-02-03T00:00:00.000Z"));
    expect((await listArtifactRevisionEntries("chat", "/legacy.md")).map((entry) => entry.revision)).toEqual([
      "sha256:old",
      "sha256:new",
      "sha256:newest",
    ]);
  });

  it("tolerates a corrupt log and ignores malformed entries", async () => {
    const directory = `chats/chat/artifact-versions/${encodeURIComponent("/broken.md")}`;
    memory.put(`${directory}/history.json`, "{not json");
    await archiveArtifactRevision("chat", revision("/broken.md", "v1", "2026-03-01T00:00:00.000Z"));
    await writeJson(`${directory}/history.json`, {
      entries: [{ revision: "sha256:v1", createdAt: "2026-03-01T00:00:00.000Z", size: 2 }, { bogus: true }],
    });
    expect((await listArtifactRevisionEntries("chat", "/broken.md")).map((entry) => entry.revision)).toEqual([
      "sha256:v1",
    ]);
  });

  it("copies history and revision files to a renamed path", async () => {
    await archiveArtifactRevision("chat", revision("/from.md", "v1", "2026-04-01T00:00:00.000Z"));
    await archiveArtifactRevision("chat", revision("/from.md", "v2", "2026-04-02T00:00:00.000Z"));

    await copyArtifactRevisionHistory("chat", "/from.md", "/to.md");

    expect((await listArtifactRevisionEntries("chat", "/to.md")).map((entry) => entry.revision)).toEqual([
      "sha256:v1",
      "sha256:v2",
    ]);
    expect(await loadArtifactRevision("chat", "/to.md", "sha256:v1")).toMatchObject({ path: "/to.md", content: "v1" });
    // Copying again adds nothing.
    await copyArtifactRevisionHistory("chat", "/from.md", "/to.md");
    expect(await listArtifactRevisionEntries("chat", "/to.md")).toHaveLength(2);
  });
});
