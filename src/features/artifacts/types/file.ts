export interface File {
  path: string;
  content: string;
  contentType?: string;
}

export interface FileSystem {
  [path: string]: File;
}
