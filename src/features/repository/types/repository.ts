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
  segments?: Array<{
    text: string;
    vector: number[];
  }>;
  error?: string;
  uploadedAt: Date;
}
