import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { ArtifactReadWriteManager } from "@/features/artifacts/lib/artifactFileTools";
import { getConfig } from "@/shared/config";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { ArtifactsContext } from "./ArtifactsContext";

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [{ fs, activeFile }, setWorkspace] = useState<{
    fs: FileSystemManager | null;
    activeFile: string | null;
  }>({ fs: null, activeFile: null });
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [readWriteManager] = useState(() => new ArtifactReadWriteManager());
  const isAvailable = !!getConfig().artifacts;

  // Externally-injected filesystem setter. The chat feature calls this
  // whenever the active chat changes; artifacts owns no chat knowledge.
  const setFileSystem = useCallback((next: FileSystemManager | null) => {
    // A path belongs to its workspace, even when another chat has the same path.
    // Change both together so no render can pair new storage with old selection.
    setWorkspace((current) =>
      current.fs === next
        ? current
        : { fs: next, activeFile: next && current.fs?.chatId === next.chatId ? current.activeFile : null },
    );
  }, []);

  // Subscribe to filesystem events for UI state changes
  useEffect(() => {
    if (!fs) return undefined;

    const unsubscribeDeleted = fs.subscribe("fileDeleted", (path: string) => {
      // Clear active file if it was the deleted one.
      setWorkspace((current) =>
        current.fs === fs && current.activeFile === path ? { ...current, activeFile: null } : current,
      );
    });

    const unsubscribeRenamed = fs.subscribe("fileRenamed", (oldPath: string, newPath: string) => {
      setWorkspace((current) =>
        current.fs === fs && current.activeFile === oldPath ? { ...current, activeFile: newPath } : current,
      );
    });

    // Cleanup function
    return () => {
      unsubscribeDeleted();
      unsubscribeRenamed();
    };
  }, [fs]);

  const openFile = useCallback((path: string, origin?: FileSystemManager) => {
    // Normalize so `activeFile` is always canonical and matches paths emitted
    // by the filesystem (see FileSystemManager.createFile/deleteFile/renameFile).
    const normalized = normalizeArtifactPath(path);
    if (!normalized) return;
    setWorkspace((current) => {
      if (!current.fs || (origin && origin.chatId !== current.fs.chatId)) return current;
      return current.activeFile === normalized ? current : { ...current, activeFile: normalized };
    });
  }, []);

  const toggleArtifactsDrawer = useCallback(() => {
    setShowArtifactsDrawer((prev) => !prev);
  }, []);

  const value = {
    isAvailable,
    fs,
    readWriteManager,
    activeFile,
    showArtifactsDrawer,
    openFile,
    setShowArtifactsDrawer,
    toggleArtifactsDrawer,
    setFileSystem,
  };

  return <ArtifactsContext value={value}>{children}</ArtifactsContext>;
}
