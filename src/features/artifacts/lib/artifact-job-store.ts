import { readJson, writeJson } from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";
import {
  ArtifactJobSchema,
  ArtifactManifestSchema,
  type ArtifactJob,
  type ArtifactManifest,
} from "@/shared/types/artifact";

interface StoredArtifactJobs {
  jobs: ArtifactJob[];
  manifests: ArtifactManifest[];
}

const EMPTY: StoredArtifactJobs = { jobs: [], manifests: [] };

function storePath(chatId: string): string {
  return `chats/${chatId}/artifact-jobs.json`;
}

export async function loadArtifactJobs(chatId: string): Promise<StoredArtifactJobs> {
  const stored = await readJson<unknown>(storePath(chatId));
  if (!stored || typeof stored !== "object") return EMPTY;
  const value = stored as { jobs?: unknown[]; manifests?: unknown[] };
  return {
    jobs: (value.jobs ?? []).flatMap((job) => {
      const parsed = ArtifactJobSchema.safeParse(job);
      return parsed.success ? [parsed.data] : [];
    }),
    manifests: (value.manifests ?? []).flatMap((manifest) => {
      const parsed = ArtifactManifestSchema.safeParse(manifest);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

export async function upsertArtifactJob(chatId: string, job: ArtifactJob): Promise<void> {
  const parsed = ArtifactJobSchema.parse(job);
  await updateStoredJobs(chatId, (stored) => ({
    ...stored,
    jobs: [...stored.jobs.filter((candidate) => candidate.id !== parsed.id), parsed],
  }));
}

export async function upsertArtifactManifest(chatId: string, manifest: ArtifactManifest): Promise<void> {
  const parsed = ArtifactManifestSchema.parse(manifest);
  await updateStoredJobs(chatId, (stored) => ({
    ...stored,
    manifests: [...stored.manifests.filter((candidate) => candidate.jobId !== parsed.jobId), parsed],
  }));
}

async function updateStoredJobs(
  chatId: string,
  update: (stored: StoredArtifactJobs) => StoredArtifactJobs,
): Promise<void> {
  await withPersistenceLock(`artifact-jobs:${chatId}`, async () => {
    await writeJson(storePath(chatId), update(await loadArtifactJobs(chatId)));
  });
}

export async function findArtifactJobForRun(chatId: string, runId: string): Promise<ArtifactJob | undefined> {
  return (await loadArtifactJobs(chatId)).jobs.find((job) => job.runId === runId);
}
