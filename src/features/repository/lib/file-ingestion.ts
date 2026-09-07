import { allocateRepositoryFilePath } from "@/features/repository/lib/repository-paths";
import type { RepositoryFile, RepositoryFileStore } from "@/features/repository/types/repository";
import { combineAbortSignals } from "@/shared/lib/abortSignals";
import { type Embedding, validateEmbeddingVector } from "@/shared/lib/embeddings";

export interface IngestionDependencies extends RepositoryFileStore {
  getModel: (repositoryId: string) => string;
  convert: (file: File, signal: AbortSignal) => Promise<string>;
  segment: (text: string, signal: AbortSignal) => Promise<string[]>;
  embed: (model: string, text: string, signal: AbortSignal) => Promise<Embedding>;
}

interface Job {
  repositoryId: string;
  fileId: string;
  controller: AbortController;
  text?: string;
}

const CONCURRENCY = 10;
const interrupted = "File processing was interrupted. Retry indexing or upload the file again.";

/** Jobs belong to the original repository; the owner supplies storage and lifetime. */
export class FileIngestion {
  private readonly jobs = new Map<string, Job>();
  private readonly deps: IngestionDependencies;

  constructor(deps: IngestionDependencies) {
    this.deps = deps;
  }

  async addFile(repositoryId: string, source: File): Promise<void> {
    const files = this.deps.getFiles(repositoryId);
    // A queued batch can outlive the repository it was uploaded to.
    if (!files) return;
    const id = crypto.randomUUID();
    const file: RepositoryFile = {
      id,
      name: source.name,
      path: allocateRepositoryFilePath(
        source.name,
        id,
        files.flatMap((file) => (file.path ? [file.path] : [])),
      ),
      uploadedAt: new Date(),
      status: "processing",
      progress: 0,
    };
    // Synchronous insertion reserves the path across every consumer.
    this.deps.insertFile(repositoryId, file);
    await this.run(repositoryId, file, source);
  }

  async reindexFile(repositoryId: string, fileId: string): Promise<void> {
    const file = this.deps.getFiles(repositoryId)?.find((file) => file.id === fileId);
    if (!file || file.text === undefined) return;
    await this.run(repositoryId, file);
  }

  cancelFile(repositoryId: string, fileId: string): void {
    const key = this.key(repositoryId, fileId);
    this.jobs.get(key)?.controller.abort();
    this.jobs.delete(key);
  }

  cancelRepository(repositoryId: string): void {
    for (const job of this.jobs.values()) {
      if (job.repositoryId === repositoryId) this.cancelFile(job.repositoryId, job.fileId);
    }
  }

  cancelAll(): void {
    const jobs = [...this.jobs.values()];
    for (const job of jobs) this.cancelFile(job.repositoryId, job.fileId);
    for (const job of jobs) {
      try {
        this.deps.updateFile(job.repositoryId, job.fileId, { status: "error", error: interrupted, text: job.text });
      } catch (error) {
        // Cancellation must still finish if the owner or storage has already shut down.
        console.error("Could not record interrupted file processing:", error);
      }
    }
  }

  private key(repositoryId: string, fileId: string): string {
    return JSON.stringify([repositoryId, fileId]);
  }

  private async run(repositoryId: string, file: RepositoryFile, source?: File): Promise<void> {
    this.cancelFile(repositoryId, file.id);
    const key = this.key(repositoryId, file.id);
    const job: Job = { repositoryId, fileId: file.id, controller: new AbortController(), text: file.text };
    this.jobs.set(key, job);
    const signal = job.controller.signal;
    // Capture once, before conversion. A configuration change cannot mix models within a file.
    const check = () => {
      if (this.jobs.get(key) !== job || !this.deps.getFiles(repositoryId)?.some((current) => current.id === file.id))
        job.controller.abort();
      signal.throwIfAborted();
    };
    const publish = (changes: Partial<RepositoryFile>) => {
      check();
      this.deps.updateFile(repositoryId, file.id, changes);
    };
    try {
      const model = this.deps.getModel(repositoryId);
      publish({ status: "processing", progress: 0, error: undefined });
      job.text = source ? await this.deps.convert(source, signal) : file.text!;
      // Checkpoint extracted text for retry after a reload. Partial vectors are never published.
      publish({
        progress: 10,
        text: job.text,
        segments: undefined,
        embeddingModel: undefined,
        embeddingRequestModel: undefined,
      });
      const segments = job.text.trim() ? await this.deps.segment(job.text, signal) : [];
      check();
      if (
        segments.some((segment) => typeof segment !== "string" || !segment.trim()) ||
        (job.text.trim() && !segments.length)
      )
        throw new Error("The segmentation service returned no usable text segments");
      publish({ progress: 20 });
      const chunks: NonNullable<RepositoryFile["segments"]> = [];
      let completed = 0;
      let next = 0;
      let embeddingModel: string | undefined;
      let dimension: number | undefined;
      let failure: { error: unknown } | undefined;
      const failed = new AbortController();
      const combined = combineAbortSignals(signal, failed.signal);
      try {
        // Workers claim one segment at a time. On failure no queued segments start,
        // and all active requests settle before the job publishes its terminal state.
        const worker = async () => {
          try {
            while (next < segments.length) {
              check();
              combined.signal!.throwIfAborted();
              const index = next++;
              const result = await this.deps.embed(model, segments[index], combined.signal!);
              check();
              combined.signal!.throwIfAborted();
              validateEmbeddingVector(result.vector);
              if (!result.model || (embeddingModel !== undefined && result.model !== embeddingModel))
                throw new Error("The embedding model changed during indexing. Please retry.");
              if (dimension !== undefined && result.vector.length !== dimension)
                throw new Error("The embedding service returned inconsistent vector dimensions");
              embeddingModel = result.model;
              dimension = result.vector.length;
              chunks[index] = { text: segments[index], vector: result.vector };
              publish({ progress: 20 + Math.floor((++completed / segments.length) * 79) });
            }
          } catch (error) {
            failure ??= { error };
            failed.abort();
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segments.length) }, worker));
      } finally {
        combined.cleanup();
      }
      check();
      if (failure) throw failure.error;
      // Text, vectors and model provenance are published together, once every chunk is valid.
      publish({
        status: "completed",
        progress: 100,
        error: undefined,
        text: job.text,
        segments: chunks,
        embeddingRequestModel: model,
        embeddingModel,
      });
      await this.deps.flush(repositoryId);
    } catch (error) {
      if (
        signal.aborted ||
        this.jobs.get(key) !== job ||
        !this.deps.getFiles(repositoryId)?.some((current) => current.id === file.id)
      )
        return;
      publish({
        status: "error",
        progress: 0,
        error: error instanceof Error ? error.message : "File processing failed",
        text: job.text,
        segments: undefined,
        embeddingRequestModel: undefined,
        embeddingModel: undefined,
      });
      // The persistence queue retains failed writes for retry and reports I/O errors.
      await this.deps.flush(repositoryId).catch(() => {});
    } finally {
      if (this.jobs.get(key) === job) this.jobs.delete(key);
    }
  }
}
