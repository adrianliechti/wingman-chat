export interface File {
  path: string;
  content: string;
  contentType?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileSystem {
  [path: string]: File;
}
