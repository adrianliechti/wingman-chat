import { useEffect, useState } from "react";
import * as storeSession from "@/shared/lib/storeSession";
import type { SyncActivity } from "@/shared/lib/chatSync";
import type { FileSyncActivity } from "@/shared/lib/fileSync";
import type { SyncProgress } from "@/shared/lib/syncProgress";

export type SessionStatus = "disabled" | "initializing" | "setup" | "locked" | "upload-only" | "ready" | "error";

/** One word the UI can trust: is everything on the server or not. */
export type SyncHealth =
  | "setup"
  | "disabled"
  | "connecting"
  | "locked"
  | "error"
  | "syncing"
  | "pending"
  | "upload-only"
  | "synced";

/** States that need the user to act before backups run normally. */
export function needsAttention(health: SyncHealth): boolean {
  return health === "error" || health === "locked" || health === "setup" || health === "upload-only";
}

export interface SyncStatus {
  progress: (SyncProgress & { unit: "chats" | "files" })[];
  session: SessionStatus;
  health: SyncHealth;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  pinProtected: boolean;
  passkeyProtected: boolean;
  remembered: boolean;
}

function computeHealth(session: SessionStatus, chat: SyncActivity | null, files: FileSyncActivity | null): SyncHealth {
  switch (session) {
    case "disabled":
      return "disabled";
    case "initializing":
      return "connecting";
    case "setup":
      return "setup";
    case "locked":
      return "locked";
    case "error":
      return "error";
  }
  if (chat?.lastError || files?.lastError) return "error";
  if (chat?.syncing || files?.syncing) return "syncing";
  if ((chat?.pendingCount ?? 0) + (files?.pendingCount ?? 0) > 0) return "pending";
  return session === "upload-only" ? "upload-only" : "synced";
}

export function useSyncStatus(): SyncStatus {
  const [session, setSession] = useState<SessionStatus>(() => storeSession.getSession().status);
  const [remembered, setRemembered] = useState(false);
  const [pinProtected, setPinProtected] = useState(false);
  const [passkeyProtected, setPasskeyProtected] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [chat, setChat] = useState<SyncActivity | null>(null);
  const [files, setFiles] = useState<FileSyncActivity | null>(null);

  useEffect(() => {
    void storeSession.initSession();
    // Unlock replaces the sync instances, so re-subscribe on every "ready".
    let unsubChat: (() => void) | undefined;
    let unsubFiles: (() => void) | undefined;
    const unsub = storeSession.subscribeSession((s) => {
      setSession(s.status);
      setRemembered(s.status === "ready" && s.remembered);
      setInitError(s.status === "error" ? (s.error instanceof Error ? s.error.message : String(s.error)) : null);
      if (s.status === "setup" || s.status === "ready" || s.status === "locked" || s.status === "upload-only") {
        setPinProtected(s.keystore.keystore.pinProtected === true);
        setPasskeyProtected(s.keystore.keystore.passkeyProtected === true);
      }
      if (s.status === "ready" || s.status === "upload-only") {
        unsubChat?.();
        unsubFiles?.();
        unsubChat = s.sync.subscribeActivity(setChat);
        unsubFiles = s.files.subscribeActivity(setFiles);
      } else {
        unsubChat?.();
        unsubFiles?.();
        setChat(null);
        setFiles(null);
      }
    });
    return () => {
      unsub();
      unsubChat?.();
      unsubFiles?.();
    };
  }, []);

  const lastSyncAt =
    [chat?.lastSyncAt, files?.lastSyncAt]
      .filter((t): t is string => t !== null && t !== undefined)
      .sort()
      .pop() ?? null;

  return {
    progress: [
      ...(chat?.progress ?? []).map((p) => ({ ...p, unit: "chats" as const })),
      ...(files?.progress ?? []).map((p) => ({ ...p, unit: "files" as const })),
    ],
    session,
    health: computeHealth(session, chat, files),
    pendingCount: (chat?.pendingCount ?? 0) + (files?.pendingCount ?? 0),
    lastSyncAt,
    lastError: initError ?? files?.lastError ?? chat?.lastError ?? null,
    pinProtected,
    passkeyProtected,
    remembered,
  };
}
