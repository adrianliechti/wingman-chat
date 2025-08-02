export interface File {
  path: string;
  content: Blob;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileSystem {
  [path: string]: File;
}
