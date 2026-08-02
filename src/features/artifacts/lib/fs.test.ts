import { beforeEach, describe, expect, it, vi } from "vitest";

const opfs = vi.hoisted(() => ({
  archiveArtifactRevision: vi.fn(),
  deleteArtifact: vi.fn(),
  deleteArtifactFolder: vi.fn(),
  listArtifactEntries: vi.fn(),
  listArtifacts: vi.fn(),
  readArtifact: vi.fn(),
  writeArtifact: vi.fn(),
}));

vi.mock("@/shared/lib/opfs", () => opfs);

import { FileSystemManager } from "./fs";

describe("FileSystemManager.renameFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a folder move when any destination file already exists", async () => {
    const files = new Map([
      ["/source/a.html", { content: "a" }],
      ["/source/nested/b.css", { content: "b" }],
      ["/target/nested/b.css", { content: "existing" }],
    ]);
    opfs.listArtifacts.mockResolvedValue([...files.keys()]);
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));

    const moved = await new FileSystemManager("chat").renameFile("/source", "/target");

    expect(moved).toBe(false);
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifactFolder).not.toHaveBeenCalled();
  });

  it("rolls back staged destination files when a folder write fails", async () => {
    const files = new Map([
      ["/source/a.html", { content: "a" }],
      ["/source/b.css", { content: "b" }],
    ]);
    opfs.listArtifacts.mockResolvedValue([...files.keys()]);
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));
    opfs.writeArtifact.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("quota write failure"));
    opfs.deleteArtifact.mockResolvedValue(undefined);

    await expect(new FileSystemManager("chat").renameFile("/source", "/target")).rejects.toThrow("quota write failure");

    expect(opfs.deleteArtifactFolder).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).toHaveBeenCalledTimes(2);
    expect(opfs.deleteArtifact).toHaveBeenCalledWith("chat", "/target/a.html");
    expect(opfs.deleteArtifact).toHaveBeenCalledWith("chat", "/target/b.css");
  });

  it("removes a partial destination when a file write fails", async () => {
    opfs.listArtifacts.mockResolvedValue(["/source.html"]);
    opfs.readArtifact.mockResolvedValue({ content: "source" });
    opfs.writeArtifact.mockRejectedValue(new Error("stream close failure"));
    opfs.deleteArtifact.mockResolvedValue(undefined);

    await expect(new FileSystemManager("chat").renameFile("/source.html", "/target.html")).rejects.toThrow(
      "stream close failure",
    );

    expect(opfs.deleteArtifact).toHaveBeenCalledTimes(1);
    expect(opfs.deleteArtifact).toHaveBeenCalledWith("chat", "/target.html");
  });

  it("rejects moving a folder into itself", async () => {
    opfs.listArtifacts.mockResolvedValue(["/source/a.html"]);

    const moved = await new FileSystemManager("chat").renameFile("/source", "/source/nested");

    expect(moved).toBe(false);
    expect(opfs.readArtifact).not.toHaveBeenCalled();
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });
});

describe("FileSystemManager.applyOverlayDelta", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("restores the complete live snapshot when a later write fails", async () => {
    const files = new Map<string, { content: string; contentType?: string }>([
      ["/existing.txt", { content: "before", contentType: "text/plain" }],
    ]);
    opfs.listArtifactEntries.mockImplementation(async () =>
      [...files].map(([path, file]) => ({
        path,
        contentType: file.contentType,
        size: file.content.length,
      })),
    );
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));
    opfs.archiveArtifactRevision.mockResolvedValue(undefined);
    opfs.deleteArtifact.mockImplementation(async (_chatId: string, path: string) => {
      files.delete(path);
    });
    let writeAttempt = 0;
    opfs.writeArtifact.mockImplementation(
      async (_chatId: string, path: string, content: string, contentType?: string) => {
        files.set(path, { content, contentType });
        writeAttempt++;
        if (writeAttempt === 2) throw new Error("quota write failure");
      },
    );

    await expect(
      new FileSystemManager("chat").applyOverlayDelta({
        upserts: {
          "/existing.txt": { content: "changed", contentType: "text/plain" },
          "/created.txt": { content: "partial", contentType: "text/plain" },
        },
        deletes: [],
      }),
    ).rejects.toThrow("quota write failure");

    expect([...files]).toEqual([["/existing.txt", { content: "before", contentType: "text/plain" }]]);
  });

  it("validates every path before mutating storage", async () => {
    await expect(
      new FileSystemManager("chat").applyOverlayDelta({
        upserts: {
          "/valid.txt": { content: "valid" },
          "../escape.txt": { content: "invalid" },
        },
        deletes: [],
      }),
    ).rejects.toThrow("Artifact path is required");

    expect(opfs.readArtifact).not.toHaveBeenCalled();
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });
});
