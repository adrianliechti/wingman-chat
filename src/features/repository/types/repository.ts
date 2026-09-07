export interface Repository {
  id: string;
  name: string;

  embedder: string;

  instructions?: string; // instruction for this repository
  createdAt: Date;
  updatedAt: Date;
  files?: RepositoryFile[]; // files are stored with the repository
}

export interface RepositoryFile {
  id: string;
  /** Original upload name shown to the user. */
  name: string;
  /** Stable, collision-safe virtual path used by repository tools. Legacy records are backfilled on load. */
  path?: string;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  text?: string;
  /** Configuration used when indexing. Empty string means the backend default. */
  embeddingRequestModel?: string;
  /** Resolved backend model identity. Missing on older files, which need reindexing. */
  embeddingModel?: string;
  segments?: Array<{
    text: string;
    vector: number[];
  }>;
  error?: string;
  uploadedAt: Date;
}

/** Storage boundary for a knowledge source, independent of its agent or chat consumers. */
export interface RepositoryFileStore {
  /** Undefined means the repository no longer exists; an empty array means it has no files. */
  getFiles: (repositoryId: string) => readonly RepositoryFile[] | undefined;
  /** Insert synchronously so all consumers share the same path reservations. */
  insertFile: (repositoryId: string, file: RepositoryFile) => void;
  /** Only update existing membership; late processing must never recreate a deleted file. */
  updateFile: (repositoryId: string, fileId: string, changes: Partial<RepositoryFile>) => void;
  flush: (repositoryId: string) => Promise<void>;
}
