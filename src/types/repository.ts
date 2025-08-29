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

export interface RemoteFileSource {
  id: string;
  name: string;
  type: 'onedrive' | 'googledrive' | 'dropbox' | 'sharepoint' | 'github';
  enabled: boolean;
}

export interface RemoteFileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  modifiedAt?: Date;
  mimeType?: string;
}

export interface RemoteFileSystemResponse {
  items: RemoteFileItem[];
  hasMore: boolean;
  nextToken?: string;
}
