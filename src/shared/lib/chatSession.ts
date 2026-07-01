/**
 * Singleton session that owns the unlocked DEK and the ChatSync instance.
 *
 * Lifecycle:
 *   1. App boots → init() resolves the keystore.
 *      - No keystore → create one (plaintext DEK) and we're done.
 *      - Plaintext keystore → unlock immediately.
 *      - PIN-protected keystore → state = "locked"; UI must call unlock(pin).
 *   2. useChats / migration code waits on whenReady() before touching sync.
 *   3. PIN ops (setPin / changePin / removePin) update the keystore and
 *      may rotate the DEK / re-init sync.
 */

import { migrateLocalChatsToServer } from "@/features/settings/lib/migrateToServer";
import { getConfig } from "@/shared/config";
import { ChatSync } from "./chatSync";
import * as api from "./chatstoreClient";
import type { DEK } from "./crypto";
import * as keystore from "./keystore";

export type SessionStatus = "disabled" | "initializing" | "locked" | "ready" | "error";

interface ReadySession {
  status: "ready";
  userId: string;
  dek: DEK;
  sync: ChatSync;
  keystore: keystore.KeystoreState;
}

interface LockedSession {
  status: "locked";
  userId: string;
  keystore: keystore.KeystoreState;
}

interface PendingSession {
  status: "initializing" | "disabled" | "error";
  error?: unknown;
}

type Session = ReadySession | LockedSession | PendingSession;

let session: Session = { status: "initializing" };
let initPromise: Promise<Session> | null = null;
const listeners = new Set<(s: Session) => void>();

function setSession(next: Session) {
  session = next;
  for (const l of listeners) l(next);
  if (next.status === "ready") {
    // Best-effort reconciliation of never-synced local chats; idempotent
    // and cheap when there is nothing to reconcile.
    void migrateLocalChatsToServer(next.sync).catch((err) => console.error("chatSession: reconciliation failed", err));
  }
}

export function subscribeSession(fn: (s: Session) => void): () => void {
  listeners.add(fn);
  fn(session);
  return () => listeners.delete(fn);
}

export function getSession(): Session {
  return session;
}

export function isEnabled(): boolean {
  return getConfig().chatstore === true;
}

export async function initSession(): Promise<Session> {
  if (!isEnabled()) {
    setSession({ status: "disabled" });
    return session;
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const me = await api.fetchMe();

      const state = await keystore.loadKeystore();

      if (!state) {
        const created = await keystore.bootstrapKeystore();
        const sync = await ChatSync.create({ userId: me.id, dek: created.dek });
        setSession({ status: "ready", userId: me.id, dek: created.dek, sync, keystore: created.state });
      } else if (!state.keystore.pinProtected) {
        const dek = await keystore.unlockWithPin(state, "", me.id);
        const sync = await ChatSync.create({ userId: me.id, dek });
        setSession({ status: "ready", userId: me.id, dek, sync, keystore: state });
      } else {
        setSession({ status: "locked", userId: me.id, keystore: state });
      }
    } catch (err) {
      console.error("chatSession.init failed", err);
      setSession({ status: "error", error: err });
    }
    return session;
  })();

  return initPromise;
}

/** Unlock a PIN-protected keystore. Promotes session to "ready" on success. */
export async function unlock(pin: string): Promise<void> {
  if (session.status !== "locked") {
    throw new Error(`session is not locked (status=${session.status})`);
  }
  const dek = await keystore.unlockWithPin(session.keystore, pin, session.userId);
  const sync = await ChatSync.create({ userId: session.userId, dek });
  setSession({ status: "ready", userId: session.userId, dek, sync, keystore: session.keystore });
}

/** Set or replace the PIN. Requires a ready session. */
export async function setPin(pin: string): Promise<void> {
  if (session.status !== "ready") throw new Error("session not ready");
  const newState = await keystore.setPin(session.keystore, session.dek, pin, session.userId);
  setSession({ ...session, keystore: newState });
}

/** Change the PIN. Requires the old PIN. */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  if (session.status !== "ready") throw new Error("session not ready");
  const newState = await keystore.changePin(session.keystore, oldPin, newPin, session.userId);
  setSession({ ...session, keystore: newState });
}

/** Remove the PIN, reverting the server keystore to plaintext DEK. */
export async function removePin(pin: string): Promise<void> {
  if (session.status !== "ready") throw new Error("session not ready");
  const result = await keystore.removePin(session.keystore, pin, session.userId);
  setSession({ ...session, keystore: result.state, dek: result.dek });
}

/** Manual sync: pull remote changes, then push pending local edits. */
export async function syncNow(): Promise<void> {
  const s = await whenReady();
  await s.sync.pull();
  await s.sync.flushPending();
}

/** Resolve when the session is ready, or reject if disabled/error. */
export async function whenReady(): Promise<ReadySession> {
  await initSession();
  if (session.status === "ready") return session;
  return new Promise((resolve, reject) => {
    const unsub = subscribeSession((s) => {
      if (s.status === "ready") {
        unsub();
        resolve(s);
      } else if (s.status === "error") {
        unsub();
        reject(s.error);
      } else if (s.status === "disabled") {
        unsub();
        reject(new Error("chatstore disabled"));
      }
    });
  });
}
