import { createContext } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";

export interface ArtifactsContextType {
  isAvailable: boolean;
  isEnabled: boolean;
  /**
   * The active filesystem. `null` while no chat is active (e.g. a draft
   * chat before the first message). Injected from the outside via
   * `setFileSystem` — artifacts has no knowledge of chats. The instance
   * identity is stable per filesystem and can be used as an effect
   * dependency or React key.
   */
  fs: FileSystemManager | null;
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  openFile: (path: string) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
  /**
   * Inject the active filesystem. Pass `null` to clear (draft chat / no
   * chat selected). Typically called by the chat feature when the active
   * chat changes.
   */
  setFileSystem: (fs: FileSystemManager | null) => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
