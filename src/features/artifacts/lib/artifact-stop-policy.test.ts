import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { ArtifactManifestSchema, type ArtifactJob, type ArtifactMutation } from "@/shared/types/artifact";
import type { Message } from "@/shared/types/chat";
import { loadArtifactJobs } from "./artifact-job-store";
import { applyArtifactStopPolicy } from "./artifact-stop-policy";
import { verifyArtifactJob } from "./artifact-verifier";
import type { FileSystemManager } from "./fs";

vi.mock("./artifact-verifier", () => ({ verifyArtifactJob: vi.fn() }));

const memory = new MemoryOpfs();
const fs = { chatId: "chat" } as FileSystemManager;
const verify = vi.mocked(verifyArtifactJob);

function manifest(job: ArtifactJob, missingScript = false) {
  return ArtifactManifestSchema.parse({
    jobId: job.id,
    primaryPath: job.primaryPath,
    files: [{ path: job.primaryPath, role: "primary", size: 100, revision: "v1", checksum: "checksum" }],
    verification: {
      status: missingScript ? "blocked" : "clean",
      checks: missingScript
        ? [
            {
              id: "html.local-ref",
              scope: job.primaryPath,
              status: "fail",
              message: "Missing local script: /lib/three.js",
            },
          ]
        : [],
      verifiedAt: new Date().toISOString(),
    },
  });
}

function changes(...batches: ArtifactMutation[][]): Message[] {
  return batches.map((mutations, index) => ({
    role: "user",
    runId: "run",
    content: [
      {
        type: "tool_result",
        id: `write-${index}`,
        name: "execute_javascript_code",
        arguments: "{}",
        result: [],
        meta: { artifactDelta: { mutations } },
      },
    ],
  }));
}

beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  verify.mockReset().mockImplementation(async (_fs, job) => manifest(job));
});
afterEach(() => vi.unstubAllGlobals());

it("infers the HTML entry point even when its library is written later", async () => {
  const messages = changes(
    [{ operation: "create", path: "/game.html" }],
    [{ operation: "create", path: "/lib/three.js" }],
  );
  const decision = await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  expect(decision).toMatchObject({ action: "finish", appendContent: [{ type: "artifact_ref", path: "/game.html" }] });
  expect((await loadArtifactJobs("chat")).jobs).toEqual([
    expect.objectContaining({ kind: "html", primaryPath: "/game.html", inferred: true, phase: "ready" }),
  ]);
});

it("selects the document entry point from a batch that also creates companion files", async () => {
  const messages = changes([
    { operation: "create", path: "/game.html" },
    { operation: "create", path: "/lib/three.js" },
    { operation: "create", path: "/assets/hero.png" },
  ]);
  await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  expect(verify).toHaveBeenCalledWith(fs, expect.objectContaining({ primaryPath: "/game.html" }));
});

it("verifies the game rather than an accompanying readme written last", async () => {
  const messages = changes([
    { operation: "create", path: "/game.html" },
    { operation: "create", path: "/README.md" },
  ]);
  await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  expect(verify).toHaveBeenCalledWith(fs, expect.objectContaining({ primaryPath: "/game.html" }));
});

it("does not recreate outputs that were deleted or moved during the run", async () => {
  const messages = changes(
    [{ operation: "create", path: "/draft.html" }],
    [{ operation: "move", from: "/draft.html", path: "/game.html" }],
    [{ operation: "delete", path: "/game.html" }],
  );
  messages.unshift({ ...changes([{ operation: "create", path: "/old.html" }])[0], runId: "older-run" });
  expect(await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages })).toEqual({ action: "finish" });
  expect(verify).not.toHaveBeenCalled();
  expect((await loadArtifactJobs("chat")).jobs).toEqual([]);
});

it("continues to repair a missing dependency without a declaration", async () => {
  verify.mockImplementationOnce(async (_fs, job) => manifest(job, true));
  const messages = changes([{ operation: "create", path: "/game.html" }]);
  const first = await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  expect(first).toMatchObject({
    action: "continue",
    feedback: { content: [{ type: "runtime_feedback", text: expect.stringContaining("/lib/three.js") }] },
  });
  expect((await loadArtifactJobs("chat")).jobs).toEqual([
    expect.objectContaining({ primaryPath: "/game.html", phase: "repairing", repairAttempts: 1 }),
  ]);
  messages.push(...changes([{ operation: "create", path: "/lib/three.js" }]));
  const second = await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  expect(second).toMatchObject({ action: "finish", appendContent: [{ type: "artifact_ref", path: "/game.html" }] });
  expect((await loadArtifactJobs("chat")).jobs).toEqual([
    expect.objectContaining({ primaryPath: "/game.html", phase: "ready", repairAttempts: 1 }),
  ]);
});

it("follows an inferred output renamed during repair", async () => {
  verify.mockImplementationOnce(async (_fs, job) => manifest(job, true));
  const messages = changes([{ operation: "create", path: "/draft.html" }]);
  await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  messages.push(...changes([{ operation: "move", from: "/draft.html", path: "/game.html" }]));
  const decision = await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  expect(decision).toMatchObject({ action: "finish", appendContent: [{ type: "artifact_ref", path: "/game.html" }] });
  expect((await loadArtifactJobs("chat")).jobs).toEqual([
    expect.objectContaining({ primaryPath: "/game.html", phase: "ready", repairAttempts: 1 }),
  ]);
});

it("retains the inferred output when compaction removes its original write from history", async () => {
  verify.mockImplementationOnce(async (_fs, job) => manifest(job, true));
  const messages = changes([{ operation: "create", path: "/game.html" }]);
  await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  const compacted: Message[] = [{ role: "assistant", content: [{ type: "summary", text: "Created /game.html." }] }];
  compacted.push(...changes([{ operation: "create", path: "/lib/three.js" }]));
  const decision = await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages: compacted });
  expect(decision).toMatchObject({ action: "finish", appendContent: [{ type: "artifact_ref", path: "/game.html" }] });
});

it("retires an inferred output deleted during repair without asking to recreate it", async () => {
  verify.mockImplementationOnce(async (_fs, job) => manifest(job, true));
  const messages = changes([{ operation: "create", path: "/draft.html" }]);
  await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages });
  messages.push(...changes([{ operation: "delete", path: "/draft.html" }]));
  expect(await applyArtifactStopPolicy({ chatId: "chat", runId: "run", fs, messages })).toEqual({ action: "finish" });
  expect(verify).toHaveBeenCalledOnce();
  expect((await loadArtifactJobs("chat")).jobs[0].phase).toBe("interrupted");
});
