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
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  text?: string;
  segments?: Array<{
    text: string;
    vector: number[];
  }>;
  error?: string;
  uploadedAt: Date;
}
