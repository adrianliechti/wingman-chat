/** OPFS test double with staged writes: bytes become visible only at close. */
export class MemoryOpfs {
  readonly files = new Map<string, Blob>();
  readonly directories = new Set<string>([""]);
  beforeWrite?: (path: string, blob: Blob) => Promise<void>;
  beforeRead?: (path: string) => Promise<void>;
  aborted: string[] = [];
  closed: string[] = [];

  readonly root = this.directory("");

  reset() {
    this.files.clear();
    this.directories.clear();
    this.directories.add("");
    this.beforeWrite = undefined;
    this.beforeRead = undefined;
    this.aborted = [];
    this.closed = [];
  }

  put(path: string, content: string | Blob) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.directories.add(parts.slice(0, i).join("/"));
    this.files.set(path, typeof content === "string" ? new Blob([content]) : content);
  }

  private directory(path: string): FileSystemDirectoryHandle {
    const child = (name: string) => {
      if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new TypeError("Invalid name");
      return path ? `${path}/${name}` : name;
    };
    return {
      kind: "directory",
      name: path.split("/").at(-1) ?? "",
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
        const full = child(name);
        if (this.files.has(full)) throw new DOMException("Not a directory", "TypeMismatchError");
        if (!this.directories.has(full)) {
          if (!options?.create) throw new DOMException("Missing directory", "NotFoundError");
          this.directories.add(full);
        }
        return this.directory(full);
      },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const full = child(name);
        if (this.directories.has(full)) throw new DOMException("Not a file", "TypeMismatchError");
        if (!this.files.has(full)) {
          if (!options?.create) throw new DOMException("Missing file", "NotFoundError");
          this.put(full, "");
        }
        return this.file(full);
      },
      removeEntry: async (name: string, options?: { recursive?: boolean }) => {
        const full = child(name);
        if (this.files.delete(full)) return;
        if (!this.directories.has(full)) throw new DOMException("Missing entry", "NotFoundError");
        const descendants = [...this.files.keys(), ...this.directories].filter((key) => key.startsWith(`${full}/`));
        if (descendants.length && !options?.recursive) throw new DOMException("Not empty", "InvalidModificationError");
        for (const key of descendants) {
          this.files.delete(key);
          this.directories.delete(key);
        }
        this.directories.delete(full);
      },
      entries: () => this.entries(path),
    } as unknown as FileSystemDirectoryHandle;
  }

  private async *entries(path: string) {
    const prefix = path ? `${path}/` : "";
    for (const full of [...this.directories, ...this.files.keys()]) {
      if (full === path || !full.startsWith(prefix) || full.slice(prefix.length).includes("/")) continue;
      yield [full.slice(prefix.length), this.files.has(full) ? this.file(full) : this.directory(full)];
    }
  }

  private file(path: string): FileSystemFileHandle {
    return {
      kind: "file",
      name: path.split("/").at(-1),
      getFile: async () => {
        await this.beforeRead?.(path);
        const blob = this.files.get(path);
        if (!blob) throw new DOMException("Missing file", "NotFoundError");
        // OPFS does not retain the MIME type supplied when writing a Blob.
        return new File([blob], path.split("/").at(-1)!, { lastModified: 1000 });
      },
      createWritable: async () => {
        let staged = new Blob();
        return {
          write: async (blob: Blob) => {
            staged = blob;
            await this.beforeWrite?.(path, blob);
          },
          close: async () => {
            this.closed.push(path);
            this.put(path, staged);
          },
          abort: async () => {
            this.aborted.push(path);
          },
        };
      },
    } as unknown as FileSystemFileHandle;
  }
}
