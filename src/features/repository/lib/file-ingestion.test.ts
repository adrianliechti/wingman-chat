import { describe, expect, it, vi } from "vitest";
import type { RepositoryFile } from "@/features/repository/types/repository";
import type { Embedding } from "@/shared/lib/embeddings";
import { FileIngestion, type IngestionDependencies } from "./file-ingestion";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const embedding = (vector = [1, 2], model = "resolved-a"): Embedding => ({ vector, model });
function setup() {
  const repositories = new Map<string, RepositoryFile[]>([["a", []]]);
  const snapshots: RepositoryFile[] = [];
  let model = "requested-a";
  const deps: IngestionDependencies = {
    getFiles: (id) => repositories.get(id),
    insertFile: (id, file) => {
      repositories.set(id, [...repositories.get(id)!, file]);
      snapshots.push(file);
    },
    updateFile: (id, fileId, changes) => {
      const files = repositories.get(id);
      if (!files) return;
      repositories.set(
        id,
        files.map((file) => {
          if (file.id !== fileId) return file;
          const next = { ...file, ...changes };
          snapshots.push(next);
          return next;
        }),
      );
    },
    getModel: () => model,
    flush: vi.fn().mockResolvedValue(undefined),
    convert: vi.fn().mockResolvedValue("Extracted text"),
    segment: vi.fn().mockResolvedValue(["First", "Second"]),
    embed: vi.fn().mockResolvedValue(embedding()),
  };
  const jobs = new FileIngestion(deps);
  return {
    repositories,
    deps,
    jobs,
    snapshots,
    current: () => repositories.get("a")![0],
    setModel: (next: string) => {
      model = next;
    },
    start: () => jobs.addFile("a", new File(["source"], "notes.txt")),
  };
}

describe("file ingestion jobs", () => {
  it("supports independent repositories and model choices through the same storage interface", async () => {
    const { repositories, deps, jobs } = setup();
    repositories.set("b", []);
    deps.getModel = (repositoryId) => `model-${repositoryId}`;
    deps.embed = vi.fn().mockImplementation(async (model) => embedding([1, 2], model));
    await Promise.all([
      jobs.addFile("a", new File(["Source A"], "notes.txt")),
      jobs.addFile("b", new File(["Source B"], "notes.txt")),
    ]);
    expect(repositories.get("a")![0]).toMatchObject({
      status: "completed",
      path: "/notes.txt",
      embeddingModel: "model-a",
      embeddingRequestModel: "model-a",
    });
    expect(repositories.get("b")![0]).toMatchObject({
      status: "completed",
      path: "/notes.txt",
      embeddingModel: "model-b",
      embeddingRequestModel: "model-b",
    });
  });

  it("commits ordered chunks and model identity once, after out-of-order embedding responses", async () => {
    const { deps, start, current, snapshots } = setup();
    const first = deferred<Embedding>();
    const second = deferred<Embedding>();
    deps.embed = vi.fn().mockImplementation((_model, text) => (text === "First" ? first.promise : second.promise));
    const running = start();
    await vi.waitFor(() => expect(deps.embed).toHaveBeenCalledTimes(2));
    const uploadedAt = current().uploadedAt;
    second.resolve(embedding([0, 1]));
    await vi.waitFor(() => expect(current().progress).toBeGreaterThan(20));
    expect(current().segments).toBeUndefined();
    expect(current().text).toBe("Extracted text");
    first.resolve(embedding([1, 0]));
    await running;
    expect(current()).toMatchObject({
      uploadedAt,
      status: "completed",
      progress: 100,
      text: "Extracted text",
      embeddingRequestModel: "requested-a",
      embeddingModel: "resolved-a",
      segments: [
        { text: "First", vector: [1, 0] },
        { text: "Second", vector: [0, 1] },
      ],
    });
    expect(snapshots.filter((file) => file.status === "completed")).toHaveLength(1);
    expect(snapshots.filter((file) => file.status === "processing").every((file) => file.progress < 100)).toBe(true);
    expect(deps.flush).toHaveBeenCalledOnce();
  });

  it("pins the requested model before conversion even if configuration changes meanwhile", async () => {
    const { deps, start, current, setModel } = setup();
    const conversion = deferred<string>();
    deps.convert = vi.fn().mockReturnValue(conversion.promise);
    const running = start();
    setModel("requested-b");
    conversion.resolve("Converted");
    await running;
    expect(deps.embed).toHaveBeenCalledWith("requested-a", "First", expect.any(AbortSignal));
    expect(current().embeddingRequestModel).toBe("requested-a");
  });

  it("cancels conversion and ignores a late failure from a converter that does not honor abort", async () => {
    const { deps, jobs, repositories, start, current, snapshots } = setup();
    const conversion = deferred<string>();
    deps.convert = vi.fn().mockReturnValue(conversion.promise);
    const running = start();
    jobs.cancelFile("a", current().id);
    repositories.set("a", []);
    const count = snapshots.length;
    conversion.reject(new Error("Late conversion failure"));
    await running;
    expect(snapshots).toHaveLength(count);
    expect(deps.segment).not.toHaveBeenCalled();
    expect(vi.mocked(deps.convert).mock.calls[0][1].aborted).toBe(true);
  });

  it("also ignores a late failure when membership was changed outside the ingestion API", async () => {
    const { deps, repositories, start } = setup();
    const conversion = deferred<string>();
    deps.convert = vi.fn().mockReturnValue(conversion.promise);
    const running = start();
    repositories.set("a", []);
    conversion.reject(new Error("Late failure"));
    await expect(running).resolves.toBeUndefined();
    expect(repositories.get("a")).toEqual([]);
  });

  it("stops queued embeddings, aborts active siblings and publishes one stable error after a partial failure", async () => {
    const { deps, start, current, snapshots } = setup();
    const requests = Array.from({ length: 12 }, () => deferred<Embedding>());
    deps.segment = vi.fn().mockResolvedValue(requests.map((_, index) => String(index)));
    deps.embed = vi.fn().mockImplementation((_model, text) => requests[Number(text)].promise);
    const running = start();
    await vi.waitFor(() => expect(deps.embed).toHaveBeenCalledTimes(10));
    requests[0].reject(new Error("Embedding quota exhausted"));
    await vi.waitFor(() => expect(vi.mocked(deps.embed).mock.calls.every(([, , signal]) => signal.aborted)).toBe(true));
    // Even transports that return success after abort cannot change progress or start queued work.
    for (const request of requests.slice(1, 10)) request.resolve(embedding());
    await running;
    expect(deps.embed).toHaveBeenCalledTimes(10);
    expect(current()).toMatchObject({ status: "error", error: "Embedding quota exhausted", text: "Extracted text" });
    expect(current().segments).toBeUndefined();
    expect(snapshots.filter((file) => file.status === "error")).toHaveLength(1);
    expect(snapshots.at(-1)?.status).toBe("error");
  });

  it("repository deletion cancels every active upload and prevents a queued batch from starting more", async () => {
    const { deps, jobs, repositories, start } = setup();
    const conversion = deferred<string>();
    deps.convert = vi.fn().mockReturnValue(conversion.promise);
    const first = start();
    const second = start();
    jobs.cancelRepository("a");
    repositories.delete("a");
    conversion.resolve("Late success");
    await Promise.all([first, second, start()]);
    expect(deps.convert).toHaveBeenCalledTimes(2);
    expect(deps.segment).not.toHaveBeenCalled();
    expect(deps.flush).not.toHaveBeenCalled();
  });

  it("retries extracted text under the new model with the same file identity, path and upload date", async () => {
    const { deps, jobs, start, current, setModel } = setup();
    deps.embed = vi.fn().mockRejectedValue(new Error("Temporarily unavailable"));
    await start();
    const original = current();
    setModel("requested-b");
    deps.embed = vi.fn().mockResolvedValue(embedding([3, 4], "resolved-b"));
    await jobs.reindexFile("a", original.id);
    expect(deps.convert).toHaveBeenCalledOnce();
    expect(current()).toMatchObject({
      id: original.id,
      path: original.path,
      uploadedAt: original.uploadedAt,
      status: "completed",
      embeddingRequestModel: "requested-b",
      embeddingModel: "resolved-b",
    });
    expect(current().error).toBeUndefined();
  });

  it.each([
    ["empty", []],
    ["non-finite", [NaN, 1]],
    ["Float32 overflow", [1e100, 1]],
    ["zero", [0, 0]],
  ])("does not publish or persist completed results with %s vectors", async (_label, vector) => {
    const { deps, start, current, snapshots } = setup();
    deps.embed = vi.fn().mockResolvedValue(embedding(vector as number[]));
    await start();
    expect(current().status).toBe("error");
    expect(current().segments).toBeUndefined();
    expect(snapshots.some((file) => file.status === "completed")).toBe(false);
  });

  it.each([
    ["dimensions", embedding([1, 2, 3])],
    ["models", embedding([1, 2], "resolved-b")],
  ])("rejects a file containing inconsistent embedding %s", async (_label, result) => {
    const { deps, start, current } = setup();
    deps.embed = vi.fn().mockResolvedValueOnce(embedding()).mockResolvedValueOnce(result);
    await start();
    expect(current().status).toBe("error");
    expect(current().segments).toBeUndefined();
  });

  it("treats an empty document as completed without making segmentation or embedding requests", async () => {
    const { deps, start, current } = setup();
    deps.convert = vi.fn().mockResolvedValue("");
    await start();
    expect(current()).toMatchObject({ status: "completed", text: "", segments: [] });
    expect(deps.segment).not.toHaveBeenCalled();
    expect(deps.embed).not.toHaveBeenCalled();
  });

  it("marks interrupted jobs retryable when their owner unmounts and ignores late results", async () => {
    const { deps, start, jobs, current } = setup();
    const segments = deferred<string[]>();
    deps.segment = vi.fn().mockReturnValue(segments.promise);
    const running = start();
    await vi.waitFor(() => expect(deps.segment).toHaveBeenCalledOnce());
    jobs.cancelAll();
    segments.resolve(["Late chunk"]);
    await running;
    expect(current()).toMatchObject({
      status: "error",
      text: "Extracted text",
      error: expect.stringContaining("interrupted"),
    });
    expect(deps.embed).not.toHaveBeenCalled();
  });

  it("cancels every job even when the owner no longer accepts state updates during cleanup", async () => {
    const { deps, jobs, start } = setup();
    const conversion = deferred<string>();
    deps.convert = vi.fn().mockReturnValue(conversion.promise);
    const first = start();
    const second = start();
    deps.updateFile = vi.fn().mockImplementation(() => {
      throw new Error("Storage was reset");
    });
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => jobs.cancelAll()).not.toThrow();
      expect(vi.mocked(deps.convert).mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
      conversion.resolve("Late result");
      await Promise.all([first, second]);
      expect(deps.segment).not.toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });

  it("does not report indexing complete when the final persistence flush fails", async () => {
    const { deps, start, current } = setup();
    deps.flush = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined);
    await start();
    expect(current()).toMatchObject({ status: "error", error: "Disk full", text: "Extracted text" });
    expect(current().segments).toBeUndefined();
  });

  it("superseding a reindex cancels the old job and ignores its late result for the same file", async () => {
    const { deps, jobs, start, current, setModel } = setup();
    await start();
    const id = current().id;
    const old = deferred<Embedding>();
    deps.embed = vi.fn().mockReturnValue(old.promise);
    const previous = jobs.reindexFile("a", id);
    await vi.waitFor(() => expect(deps.embed).toHaveBeenCalledTimes(2));
    const signal = vi.mocked(deps.embed).mock.calls[0][2];
    setModel("requested-b");
    deps.embed = vi.fn().mockResolvedValue(embedding([3, 4], "resolved-b"));
    await jobs.reindexFile("a", id);
    expect(signal.aborted).toBe(true);
    old.resolve(embedding());
    await previous;
    expect(current()).toMatchObject({
      id,
      status: "completed",
      embeddingModel: "resolved-b",
      embeddingRequestModel: "requested-b",
    });
  });

  it("reuses a deleted file's path without allowing its pending upload to overwrite the replacement", async () => {
    const { deps, jobs, repositories, start, current } = setup();
    const old = deferred<string>();
    deps.convert = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("Replacement");
    const previous = start();
    const id = current().id;
    jobs.cancelFile("a", id);
    repositories.set("a", []);
    await start();
    old.resolve("Old source");
    await previous;
    expect(repositories.get("a")).toHaveLength(1);
    expect(current()).toMatchObject({ status: "completed", path: "/notes.txt", text: "Replacement" });
    expect(current().id).not.toBe(id);
  });
});
