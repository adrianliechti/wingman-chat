import { createContext } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { ArtifactReadWriteManager } from "@/features/artifacts/lib/artifactFileTools";
import type { ArtifactEditRequest } from "@/features/artifacts/lib/editRequest";

export interface ArtifactsContextType {
  isAvailable: boolean;
  /**
   * The active filesystem. `null` while no chat is active (e.g. a draft
   * chat before the first message). Injected from the outside via
   * `setFileSystem` — artifacts has no knowledge of chats. The instance
   * identity is stable per filesystem and can be used as an effect
   * dependency or React key.
   */
  fs: FileSystemManager | null;
  /** Shared observations across the exclusive chat/voice modes and user turns. */
  readWriteManager: ArtifactReadWriteManager;
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  /** Async callers pass their workspace so a late completion cannot select a file in another chat. */
  openFile: (path: string, origin?: FileSystemManager) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
  /**
   * Inject the active filesystem. Pass `null` to clear (draft chat / no
   * chat selected). Typically called by the chat feature when the active
   * chat changes.
   */
  setFileSystem: (fs: FileSystemManager | null) => void;
  /**
   * Sends a "change this highlighted passage" request through the active
   * conversation. `null` when no host has registered one, in which case the
   * viewer offers no select-to-edit control.
   */
  requestEdit: ((request: ArtifactEditRequest) => void) | null;
  setEditRequestHandler: (handler: ((request: ArtifactEditRequest) => void) | null) => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
