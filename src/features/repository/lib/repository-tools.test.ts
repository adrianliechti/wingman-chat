import { describe, expect, it, vi } from "vitest";
import { createReadonlyFileTools, type ReadonlyFileSource } from "@/shared/lib/file-tools";
import type { Tool } from "@/shared/types/chat";
import type { RepositoryFile } from "../types/repository";
import { createRepositoryFileSource, createRepositoryTools, type FileChunk } from "./repository-tools";

function repositoryFile(overrides: Partial<RepositoryFile> & Pick<RepositoryFile, "id" | "name">): RepositoryFile {
  return {
    status: "completed",
    progress: 100,
    text: "first\nneedle\nlast",
    uploadedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function byName(tools: Tool[], name: string): Tool {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

async function resultText(tool: Tool, args: Record<string, unknown>): Promise<string> {
  const result = await tool.function(args);
  const first = result[0];
  if (!first || first.type !== "text") throw new Error("Expected text result");
  return first.text;
}

describe("repository tools", () => {
  it("uses the exact shared read/grep/glob schemas with a repository namespace", () => {
    const files = [repositoryFile({ id: "aaaaaaaa-0000", name: "notes.txt", path: "/notes.txt" })];
    const tools = createRepositoryTools(files, async () => []);
    const source: ReadonlyFileSource = {
      async list() {
        return [];
      },
      async read() {
        return undefined;
      },
    };
    const artifactTools = createReadonlyFileTools(source, {
      namespace: "artifacts",
      spaceName: "artifact workspace",
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "repository_read",
      "repository_grep",
      "repository_glob",
      "repository_search",
    ]);
    for (const operation of ["read", "grep", "glob"]) {
      expect(byName(tools, `repository_${operation}`).parameters).toEqual(
        byName(artifactTools, `artifacts_${operation}`).parameters,
      );
    }
  });

  it("backfills duplicate legacy names into distinct paths and reads by canonical path", async () => {
    const files = [
      repositoryFile({
        id: "aaaaaaaa-0000",
        name: "report.pdf",
        text: "older report",
        uploadedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
      repositoryFile({ id: "bbbbbbbb-0000", name: "Report.pdf", text: "newer report" }),
    ];
    const tools = createRepositoryTools(files, async () => []);

    const listing = await resultText(byName(tools, "repository_glob"), { pattern: "**/*" });
    expect(listing).toContain("/report.pdf");
    expect(listing).toContain("/Report~bbbbbbbb.pdf");

    const read = await resultText(byName(tools, "repository_read"), {
      file_path: "/Report~bbbbbbbb.pdf",
    });
    expect(read).toContain("1: newer report");
    expect(read).not.toContain("older report");
  });

  it("exposes only completed extracted files through the shared source", async () => {
    const files = [
      repositoryFile({ id: "done", name: "done.txt", path: "/done.txt", text: "" }),
      repositoryFile({ id: "pending", name: "pending.txt", path: "/pending.txt", status: "processing", text: "x" }),
      repositoryFile({ id: "failed", name: "failed.txt", path: "/failed.txt", status: "error", text: undefined }),
    ];
    const { source } = createRepositoryFileSource(files);

    expect(await source.list()).toEqual([expect.objectContaining({ path: "/done.txt", size: 0 })]);
    expect(await source.read("/pending.txt")).toBeUndefined();
  });

  it("shares bounded offset/limit reads and strict regex errors", async () => {
    const files = [repositoryFile({ id: "notes", name: "notes.txt", path: "/notes.txt" })];
    const tools = createRepositoryTools(files, async () => []);

    const read = await resultText(byName(tools, "repository_read"), {
      file_path: "/notes.txt",
      offset: 2,
      limit: 1,
    });
    expect(read).toContain("lines 2-2 of 3");
    expect(read).toContain("2: needle");
    expect(read).toContain("offset=3");

    const grep = await resultText(byName(tools, "repository_grep"), { pattern: "[" });
    expect(JSON.parse(grep).error).toContain("invalid regex pattern");
  });

  it("reports semantic-search failures separately from empty results", async () => {
    const file = repositoryFile({ id: "notes", name: "notes.txt", path: "/notes.txt" });
    const failing = createRepositoryTools([file], async () => {
      throw new Error("embedding unavailable");
    });
    const empty = createRepositoryTools([file], async () => []);

    expect(JSON.parse(await resultText(byName(failing, "repository_search"), { query: "needle" })).error).toContain(
      "embedding unavailable",
    );
    expect(await resultText(byName(empty, "repository_search"), { query: "missing" })).toContain(
      "No repository results",
    );
  });

  it("does not surface stale semantic chunks for pending or failed documents", async () => {
    const files = [
      repositoryFile({ id: "pending", name: "pending.txt", status: "processing" }),
      repositoryFile({ id: "failed", name: "failed.txt", status: "error" }),
      repositoryFile({ id: "missing-text", name: "missing.txt", text: undefined }),
    ];
    const tools = createRepositoryTools(files, async () => files.map((file) => ({ file, text: "stale secret" })));
    const output = await resultText(byName(tools, "repository_search"), { query: "secret" });
    expect(output).toContain("No repository results");
    expect(output).not.toContain("stale secret");
  });

  it("returns canonical paths and inferred line ranges from semantic search", async () => {
    const file = repositoryFile({ id: "notes", name: "notes.txt", path: "/notes.txt" });
    const query = vi.fn(async (): Promise<FileChunk[]> => [{ file, text: "needle\nlast", similarity: 0.91 }]);
    const search = byName(createRepositoryTools([file], query), "repository_search");

    const output = await resultText(search, { query: "ending", limit: 3 });

    expect(query).toHaveBeenCalledWith("ending", 3);
    expect(output).toBe("[91%] /notes.txt:2-3: needle last");
    expect(JSON.parse(await resultText(search, { query: "ending", limit: 0 })).error).toContain("limit must be");
  });
});
