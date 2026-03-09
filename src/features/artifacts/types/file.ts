export interface File {
  path: string;
  content: string;
  contentType?: string;
}

export interface FileEntry {
  path: string;
  contentType?: string;
  size?: number;
}

export interface FileSystem {
  [path: string]: File;
}
