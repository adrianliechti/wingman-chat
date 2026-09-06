import { beforeEach, expect, it, vi } from "vitest";
import { ArtifactJobSchema, ArtifactManifestSchema } from "@/shared/types/artifact";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { loadArtifactJobs, upsertArtifactJob, upsertArtifactManifest } from "./artifact-job-store";

const memory = new MemoryOpfs();
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

it("concurrent job and manifest updates preserve both lists", async () => {
  const now = new Date().toISOString();
  const job = ArtifactJobSchema.parse({
    id: "job",
    chatId: "chat",
    kind: "html",
    primaryPath: "/index.html",
    phase: "ready",
    createdAt: now,
    updatedAt: now,
  });
  const manifest = ArtifactManifestSchema.parse({
    jobId: "job",
    primaryPath: "/index.html",
    files: [],
    verification: { status: "clean", checks: [], verifiedAt: now },
  });
  await Promise.all([upsertArtifactJob("chat", job), upsertArtifactManifest("chat", manifest)]);
  expect(await loadArtifactJobs("chat")).toEqual({ jobs: [job], manifests: [manifest] });
});
