import { useEffect, useMemo, useState } from "react";
import type { FileSystemManager } from "../lib/fs";
import type { File, FileEntry } from "@/shared/types/file";

const EMPTY_ENTRIES: FileEntry[] = [];

export function useArtifactEntries(fs: FileSystemManager | null): FileEntry[] {
  const workspace = useMemo(() => ({ fs }), [fs]);
  const [loaded, setLoaded] = useState<{ workspace: typeof workspace; files: FileEntry[] } | null>(null);
  useEffect(() => {
    const { fs } = workspace;
    if (!fs) return;
    let version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const files = await fs.listEntries();
        if (request === version) setLoaded({ workspace, files });
      } catch (error) {
        console.error("Error loading artifact files:", error);
        if (request === version) setLoaded({ workspace, files: [] });
      }
    };
    const subscriptions = [
      fs.subscribe("fileCreated", load),
      fs.subscribe("fileUpdated", load),
      fs.subscribe("fileDeleted", load),
      fs.subscribe("fileRenamed", load),
    ];
    void load();
    return () => {
      version++;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [workspace]);
  return loaded?.workspace === workspace ? loaded.files : EMPTY_ENTRIES;
}

export function useArtifactFile(fs: FileSystemManager | null, path: string | null): File | null {
  // Each selection has its own identity, including A → B → A. A previous
  // visit's content cannot reappear while the new read of A is still pending.
  const selection = useMemo(() => ({ fs, path }), [fs, path]);
  const [loaded, setLoaded] = useState<{ selection: typeof selection; file: File | null } | null>(null);
  useEffect(() => {
    const { fs, path } = selection;
    if (!fs || !path) return;
    let version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const file = (await fs.getFile(path)) ?? null;
        if (request === version) setLoaded({ selection, file });
      } catch (error) {
        console.error("Error loading artifact content:", error);
        if (request === version) setLoaded({ selection, file: null });
      }
    };
    const refresh = (changed: string) => {
      if (changed === path) void load();
    };
    const subscriptions = [
      fs.subscribe("fileCreated", refresh),
      fs.subscribe("fileUpdated", refresh),
      fs.subscribe("fileRenamed", (from, to) => {
        if (from === path || to === path) void load();
      }),
      fs.subscribe("fileDeleted", (deleted) => {
        if (deleted !== path) return;
        version++;
        setLoaded({ selection, file: null });
      }),
    ];
    void load();
    return () => {
      version++;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [selection]);
  // Matching paths alone are insufficient: chats can contain the same filename.
  return loaded?.selection === selection ? loaded.file : null;
}
