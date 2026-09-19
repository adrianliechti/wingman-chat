/// <reference types="vite/client" />

declare module "virtual:artifact-library-source/three" {
  const source: string;
  export default source;
}

declare module "virtual:artifact-library-source/lucide" {
  const source: string;
  export default source;
}

declare module "virtual:artifact-library-source/wingman-sdk" {
  const source: string;
  export default source;
}

declare module "virtual:artifact-library-source/echarts" {
  const source: string;
  export default source;
}

declare module "virtual:artifact-library-url/three" {
  const url: string;
  export default url;
}

declare module "virtual:artifact-library-url/lucide" {
  const url: string;
  export default url;
}

declare module "virtual:artifact-library-url/echarts" {
  const url: string;
  export default url;
}

// File System Access API type extensions
// These extend the built-in types with methods that aren't fully typed yet

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
}
