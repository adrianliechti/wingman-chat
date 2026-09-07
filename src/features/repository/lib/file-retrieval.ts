import type { RepositoryFile } from "@/features/repository/types/repository";
import { type Embedding, validateEmbeddingVector } from "@/shared/lib/embeddings";

export interface FileChunk {
  file: RepositoryFile;
  text: string;
  similarity: number;
}

export function needsReindex(file: RepositoryFile, model: string): boolean {
  if (!file.text?.trim()) return false;
  return !file.embeddingModel || file.embeddingRequestModel !== model || !file.segments?.length;
}

const reindexMessage =
  "Some files need reindexing for the current embedding model. Use Reindex in the Knowledge Base; file reading and text search remain available.";

/** Search a repository's current completed files, without a second mutable copy of its index. */
export async function queryFileChunks(
  getFiles: () => readonly RepositoryFile[],
  getModel: () => string,
  embed: (model: string, query: string, signal?: AbortSignal) => Promise<Embedding>,
  query: string,
  topK = 10,
  signal?: AbortSignal,
): Promise<FileChunk[]> {
  signal?.throwIfAborted();
  if (!query.trim() || topK === 0) return [];
  if (!Number.isInteger(topK) || topK < 0) throw new Error("Search limit must be a non-negative integer");
  const model = getModel();
  const candidates = () => {
    const files = getFiles().filter((file) => file.status === "completed");
    if (files.some((file) => needsReindex(file, model))) throw new Error(reindexMessage);
    return files.filter((file) => file.segments?.length);
  };
  if (!candidates().length) return [];
  const embedding = await embed(model, query, signal);
  signal?.throwIfAborted();
  if (getModel() !== model) throw new Error("The embedding model changed during search. Please try again.");
  validateEmbeddingVector(embedding.vector);
  const results: FileChunk[] = [];
  // Read membership again after the request. Removed, replaced or unfinished files
  // cannot leak through a stale closure, and IDs need no special delimiter syntax.
  for (const file of candidates()) {
    if (file.embeddingModel !== embedding.model) throw new Error(reindexMessage);
    for (const segment of file.segments!) {
      validateEmbeddingVector(segment.vector);
      if (segment.vector.length !== embedding.vector.length) throw new Error(reindexMessage);
      let dot = 0;
      let left = 0;
      let right = 0;
      for (let index = 0; index < segment.vector.length; index++) {
        const a = embedding.vector[index];
        const b = segment.vector[index];
        dot += a * b;
        left += a * a;
        right += b * b;
      }
      results.push({ file, text: segment.text, similarity: Math.max(-1, Math.min(1, dot / Math.sqrt(left * right))) });
    }
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}
