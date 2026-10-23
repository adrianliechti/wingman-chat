import { describe, expect, it, vi } from "vitest";
import type { RepositoryFile } from "@/features/repository/types/repository";
import { queryFileChunks } from "./file-retrieval";

const file = (changes: Partial<RepositoryFile> = {}): RepositoryFile => ({
  id: "legacy:id:with:colons",
  name: "notes.txt",
  path: "/notes.txt",
  uploadedAt: new Date(),
  status: "completed",
  progress: 100,
  text: "First\nSecond",
  embeddingRequestModel: "requested-a",
  embeddingModel: "resolved-a",
  segments: [
    { text: "First", vector: [1, 0] },
    { text: "Second", vector: [0, 1] },
  ],
  ...changes,
});
const embed = () => vi.fn().mockResolvedValue({ model: "resolved-a", vector: [1, 0] });

describe("file retrieval", () => {
  it("forwards cancellation and rejects a late embedding result after the caller aborts", async () => {
    const controller = new AbortController();
    const embedding = vi.fn().mockImplementation(async (_model: string, _query: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return { model: "resolved-a", vector: [1, 0] };
    });
    await expect(
      queryFileChunks(
        () => [file()],
        () => "requested-a",
        embedding,
        "Query",
        10,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(embedding).toHaveBeenCalledOnce();
    await expect(
      queryFileChunks(
        () => [file()],
        () => "requested-a",
        embedding,
        "Query",
        10,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(embedding).toHaveBeenCalledOnce();
  });

  it("ranks completed files directly without parsing their IDs", async () => {
    const source = file();
    const embedding = embed();
    expect(
      await queryFileChunks(
        () => [source, file({ status: "error" })],
        () => "requested-a",
        embedding,
        "Query",
        1,
      ),
    ).toEqual([{ file: source, text: "First", similarity: 1 }]);
  });

  it.each([
    { embeddingRequestModel: undefined, embeddingModel: undefined },
    { embeddingRequestModel: "old-model" },
    { segments: undefined },
  ])("requires explicit reindexing for old or incompatible metadata: %j", async (changes) => {
    const embedding = embed();
    await expect(
      queryFileChunks(
        () => [file(changes)],
        () => "requested-a",
        embedding,
        "Query",
      ),
    ).rejects.toThrow("reindexing");
    expect(embedding).not.toHaveBeenCalled();
  });

  it("detects changed backend defaults even when vector dimensions are unchanged", async () => {
    const embedding = vi.fn().mockResolvedValue({ model: "resolved-b", vector: [1, 0] });
    await expect(
      queryFileChunks(
        () => [file({ embeddingRequestModel: "" })],
        () => "",
        embedding,
        "Query",
      ),
    ).rejects.toThrow("reindexing");
  });

  it("rechecks membership after the embedding response and excludes deleted or reprocessing files", async () => {
    let files = [file()];
    const embedding = vi.fn().mockImplementation(async () => {
      files = [file({ status: "processing" })];
      return { model: "resolved-a", vector: [1, 0] };
    });
    expect(
      await queryFileChunks(
        () => files,
        () => "requested-a",
        embedding,
        "Query",
      ),
    ).toEqual([]);
    files = [file()];
    embedding.mockImplementationOnce(async () => {
      files = [];
      return { model: "resolved-a", vector: [1, 0] };
    });
    expect(
      await queryFileChunks(
        () => files,
        () => "requested-a",
        embedding,
        "Query",
      ),
    ).toEqual([]);
  });

  it("refuses to return results when configuration changes while the query is pending", async () => {
    let model = "requested-a";
    const embedding = vi.fn().mockImplementation(async () => {
      model = "requested-b";
      return { model: "resolved-a", vector: [1, 0] };
    });
    await expect(
      queryFileChunks(
        () => [file()],
        () => model,
        embedding,
        "Query",
      ),
    ).rejects.toThrow("changed during search");
  });

  it("reports dimension changes instead of silently dropping incompatible files", async () => {
    const embedding = vi.fn().mockResolvedValue({ model: "resolved-a", vector: [1, 0, 0] });
    await expect(
      queryFileChunks(
        () => [file()],
        () => "requested-a",
        embedding,
        "Query",
      ),
    ).rejects.toThrow("reindexing");
  });

  it("does not make embedding requests for empty repositories, empty documents, blank queries or zero results", async () => {
    const embedding = embed();
    for (const files of [[], [file({ status: "processing" })], [file({ text: "", segments: [] })]])
      expect(
        await queryFileChunks(
          () => files,
          () => "requested-a",
          embedding,
          "Query",
        ),
      ).toEqual([]);
    expect(
      await queryFileChunks(
        () => [file()],
        () => "requested-a",
        embedding,
        " ",
      ),
    ).toEqual([]);
    expect(
      await queryFileChunks(
        () => [file()],
        () => "requested-a",
        embedding,
        "Query",
        0,
      ),
    ).toEqual([]);
    expect(embedding).not.toHaveBeenCalled();
  });
});
