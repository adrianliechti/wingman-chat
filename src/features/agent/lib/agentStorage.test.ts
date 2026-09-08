import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../types/agent";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { loadAgent, storeAgent, parseAgentMd, serializeAgentMd } from "./agentStorage";

const memory = new MemoryOpfs();
const agent = (): Agent => ({
  id: "agent",
  name: "Agent",
  skills: [],
  plugins: [],
  tools: [],
  servers: [],
});
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

describe("agent storage", () => {
  it("persists requested and resolved embedding models with the file's vectors", async () => {
    const value = {
      ...agent(),
      files: [
        {
          id: "file",
          name: "notes.txt",
          uploadedAt: new Date(),
          status: "completed" as const,
          progress: 100,
          text: "Source",
          segments: [{ text: "Source", vector: [1, 2] }],
          embeddingRequestModel: "",
          embeddingModel: "backend-default-a",
        },
      ],
    };
    await storeAgent(value);
    expect((await loadAgent(value.id))!.files![0]).toMatchObject({
      embeddingRequestModel: "",
      embeddingModel: "backend-default-a",
      segments: [{ text: "Source", vector: [1, 2] }],
    });
  });

  it.each(["processing", "pending"] as const)(
    "loads interrupted %s files as retryable errors without changing stored bytes",
    async (status) => {
      await storeAgent({
        ...agent(),
        files: [
          {
            id: "file",
            name: "notes.txt",
            status,
            progress: 40,
            text: "Extracted",
            uploadedAt: new Date(),
          },
        ],
      });
      const writes = memory.closed.length;
      expect((await loadAgent("agent"))!.files![0]).toMatchObject({
        status: "error",
        error: expect.stringContaining("interrupted"),
        text: "Extracted",
        progress: 0,
      });
      expect(memory.closed).toHaveLength(writes);
    },
  );

  it("rejects finite numbers that overflow the persisted Float32 representation before writing any files", async () => {
    await expect(
      storeAgent({
        ...agent(),
        files: [
          {
            id: "file",
            name: "notes.txt",
            status: "completed",
            progress: 100,
            uploadedAt: new Date(),
            segments: [{ text: "Source", vector: [1e100] }],
          },
        ],
      }),
    ).rejects.toThrow("Invalid embedding");
    expect(memory.closed).toEqual([]);
  });
  it("round-trips quoted names, model IDs, and lists containing punctuation", () => {
    const value = {
      ...agent(),
      name: 'Name: "Quoted"\nline',
      model: "provider:model",
      skills: ["a,b", "it's"],
      tools: ["one,two"],
      memory: true,
      instructions: "Instructions",
    };
    expect(parseAgentMd(serializeAgentMd(value))).toEqual({
      name: value.name,
      model: value.model,
      skills: value.skills,
      plugins: [],
      tools: value.tools,
      memory: true,
      instructions: value.instructions,
    });
    expect(parseAgentMd("---\r\nname: Shared\r\nskills: ['a', 'b']\r\n---\r\nBody")).toMatchObject({
      name: "Shared",
      skills: ["a", "b"],
      instructions: "Body",
    });
  });

  it("persists empty text and clears removed segments instead of loading stale data", async () => {
    const value = agent();
    value.files = [
      {
        id: "file",
        name: "x.txt",
        status: "completed",
        progress: 100,
        uploadedAt: new Date(),
        text: "old",
        segments: [{ text: "chunk", vector: [0.5, 1] }],
      },
    ];
    await storeAgent(value);
    await storeAgent({ ...value, files: [{ ...value.files[0], text: "", segments: [] }] });
    const file = (await loadAgent(value.id))!.files![0];
    expect(file.text).toBe("");
    expect(file.segments).toBeUndefined();
    expect(memory.files.has("agents/agent/files/file/embeddings.bin")).toBe(false);
  });

  it("removes files from authoritative membership before cleanup and preserves unrelated memory", async () => {
    const value = agent();
    value.files = [
      {
        id: "file",
        name: "x.txt",
        status: "completed",
        progress: 100,
        uploadedAt: new Date(),
        text: "old",
      },
    ];
    await storeAgent(value);
    memory.put("agents/agent/MEMORY.md", "Remember");
    await storeAgent({ ...value, files: [] });
    // Even a leftover folder from interrupted cleanup cannot resurrect a file.
    memory.put("agents/agent/files/leftover/metadata.json", JSON.stringify(value.files[0]));
    expect((await loadAgent(value.id))!.files).toBeUndefined();
    expect(await memory.files.get("agents/agent/MEMORY.md")!.text()).toBe("Remember");
  });

  it("does not mutate storage while normalizing older file paths during loading", async () => {
    memory.put("agents/agent/AGENTS.md", serializeAgentMd(agent()));
    memory.put(
      "agents/agent/files/file/metadata.json",
      JSON.stringify({
        id: "file",
        name: "a.txt",
        status: "completed",
        progress: 100,
        uploadedAt: "2026-01-01",
      }),
    );
    const value = await loadAgent("agent");
    expect(value!.files![0].path).toBeTruthy();
    expect(memory.closed).toEqual([]);
  });

  it("rejects truncated embeddings instead of constructing silently truncated vectors", async () => {
    const value = agent();
    value.files = [
      {
        id: "file",
        name: "x",
        status: "completed",
        progress: 100,
        uploadedAt: new Date(),
        segments: [{ text: "text", vector: [1, 2] }],
      },
    ];
    await storeAgent(value);
    memory.put("agents/agent/files/file/embeddings.bin", new Blob([new Float32Array([2, 1])]));
    await expect(loadAgent("agent")).rejects.toThrow("Invalid embeddings");
  });

  it("restores all previous agent files when a later metadata write fails", async () => {
    const value = {
      ...agent(),
      files: [
        {
          id: "file",
          name: "x.txt",
          status: "completed" as const,
          progress: 100,
          uploadedAt: new Date(),
          text: "before",
          segments: [{ text: "old chunk", vector: [1, 2] }],
        },
      ],
    };
    await storeAgent(value);
    const before = new Map(
      await Promise.all([...memory.files].map(async ([path, blob]) => [path, await blob.text()] as const)),
    );
    let failed = false;
    memory.beforeWrite = async (path) => {
      if (path.endsWith("AGENTS.md") && !failed) {
        failed = true;
        throw new Error("quota");
      }
    };
    await expect(
      storeAgent({
        ...value,
        name: "After",
        files: [{ ...value.files[0], text: "after", segments: [{ text: "new chunk", vector: [3, 4] }] }],
      }),
    ).rejects.toThrow("quota");
    const after = new Map(
      await Promise.all([...memory.files].map(async ([path, blob]) => [path, await blob.text()] as const)),
    );
    expect(after).toEqual(before);
    expect((await loadAgent("agent"))!.files![0].text).toBe("before");
  });
});
