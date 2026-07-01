import { useEffect, useState } from "react";
import * as chatSession from "@/shared/lib/chatSession";
import type { SyncActivity } from "@/shared/lib/chatSync";
import type { FileSyncActivity } from "@/shared/lib/fileSync";

export type SessionStatus = "disabled" | "initializing" | "locked" | "ready" | "error";

/** One word the UI can trust: is everything on the server or not. */
export type SyncHealth = "disabled" | "connecting" | "locked" | "error" | "syncing" | "pending" | "synced";

export interface SyncStatus {
  session: SessionStatus;
  health: SyncHealth;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  pinProtected: boolean;
}

function computeHealth(session: SessionStatus, chat: SyncActivity | null, files: FileSyncActivity | null): SyncHealth {
  switch (session) {
    case "disabled":
      return "disabled";
    case "initializing":
      return "connecting";
    case "locked":
      return "locked";
    case "error":
      return "error";
  }
  if (chat?.lastError || files?.lastError) return "error";
  if (chat?.syncing || files?.syncing) return "syncing";
  if ((chat?.pendingCount ?? 0) + (files?.pendingCount ?? 0) > 0) return "pending";
  return "synced";
}

export function useSyncStatus(): SyncStatus {
  const [session, setSession] = useState<SessionStatus>(() => chatSession.getSession().status);
  const [pinProtected, setPinProtected] = useState(false);
  const [chat, setChat] = useState<SyncActivity | null>(null);
  const [files, setFiles] = useState<FileSyncActivity | null>(null);

  useEffect(() => {
    void chatSession.initSession();
    // Unlock replaces the sync instances, so re-subscribe on every "ready".
    let unsubChat: (() => void) | undefined;
    let unsubFiles: (() => void) | undefined;
    const unsub = chatSession.subscribeSession((s) => {
      setSession(s.status);
      if (s.status === "ready" || s.status === "locked") {
        setPinProtected(s.keystore.keystore.pinProtected === true);
      }
      if (s.status === "ready") {
        unsubChat?.();
        unsubFiles?.();
        unsubChat = s.sync.subscribeActivity(setChat);
        unsubFiles = s.files.subscribeActivity(setFiles);
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
    session,
    health: computeHealth(session, chat, files),
    pendingCount: (chat?.pendingCount ?? 0) + (files?.pendingCount ?? 0),
    lastSyncAt,
    lastError: files?.lastError ?? chat?.lastError ?? null,
    pinProtected,
  };
}
