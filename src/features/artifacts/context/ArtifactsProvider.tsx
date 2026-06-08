import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { getConfig } from "@/shared/config";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { ArtifactsContext } from "./ArtifactsContext";

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [fs, setFs] = useState<FileSystemManager | null>(null);
  const config = getConfig();
  const [isAvailable] = useState(() => {
    try {
      return !!config.artifacts;
    } catch (error) {
      console.warn("Failed to get artifacts config:", error);
      return false;
    }
  });

  // Externally-injected filesystem setter. The chat feature calls this
  // whenever the active chat changes; artifacts owns no chat knowledge.
  const setFileSystem = useCallback((next: FileSystemManager | null) => {
    setFs(next);
  }, []);

  // When the active filesystem changes, reconcile the active file:
  //  - Draft chat (fs === null): clear the active file.
  //  - Chat with files: clear the active file if it no longer exists in the
  //    new chat.
  // Artifacts itself is always active when available, so there is no enabled
  // state to toggle here. The drawer is never auto-opened — created files
  // surface as inline chips in the conversation; the user opens the panel on
  // demand.
  useEffect(() => {
    if (!fs) {
      setActiveFile(null);
      return;
    }

    let cancelled = false;

    // Clear active file if it doesn't exist in the new filesystem
    setActiveFile((current) => {
      if (!current) return current;
      // Kick off async existence check; updates state when resolved.
      fs.fileExists(current).then((exists) => {
        if (!cancelled && !exists) {
          setActiveFile((prev) => (prev === current ? null : prev));
        }
      });
      return current;
    });

    return () => {
      cancelled = true;
    };
  }, [fs]);

  // Subscribe to filesystem events for UI state changes
  useEffect(() => {
    if (!fs) return undefined;

    const unsubscribeDeleted = fs.subscribe("fileDeleted", (path: string) => {
      // Clear active file if it was the deleted one.
      setActiveFile((currentActive) => (currentActive === path ? null : currentActive));
    });

    const unsubscribeRenamed = fs.subscribe("fileRenamed", (oldPath: string, newPath: string) => {
      setActiveFile((prev) => (prev === oldPath ? newPath : prev));
    });

    // Cleanup function
    return () => {
      unsubscribeDeleted();
      unsubscribeRenamed();
    };
  }, [fs]);

  const openFile = useCallback((path: string) => {
    // Normalize so `activeFile` is always canonical and matches paths emitted
    // by the filesystem (see FileSystemManager.createFile/deleteFile/renameFile).
    const normalized = normalizeArtifactPath(path);
    if (normalized) setActiveFile(normalized);
  }, []);

  const toggleArtifactsDrawer = useCallback(() => {
    setShowArtifactsDrawer((prev) => !prev);
  }, []);

  const value = {
    isAvailable,
    fs,
    activeFile,
    showArtifactsDrawer,
    openFile,
    setShowArtifactsDrawer,
    toggleArtifactsDrawer,
    setFileSystem,
  };

  return <ArtifactsContext.Provider value={value}>{children}</ArtifactsContext.Provider>;
}
