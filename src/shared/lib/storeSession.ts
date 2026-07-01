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

import { getConfig } from "@/shared/config";
import { ChatSync } from "./chatSync";
import * as api from "./storeClient";
import type { DEK } from "./crypto";
import { FileSync } from "./fileSync";
import * as keystore from "./keystore";

export type SessionStatus = "disabled" | "initializing" | "locked" | "ready" | "error";

interface ReadySession {
  status: "ready";
  userId: string;
  dek: DEK;
  sync: ChatSync;
  files: FileSync;
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
    // Push anything that didn't reach the server last session (crash,
    // network blip). Cheap no-op when nothing is pending.
    void next.sync.flushPending().catch((err) => console.error("storeSession: flush failed", err));
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
  return getConfig().store === true;
}

async function readySession(userId: string, dek: DEK, ks: keystore.KeystoreState): Promise<ReadySession> {
  const sync = await ChatSync.create({ userId, dek });
  const files = await FileSync.create({ userId, dek });
  files.start();
  const s: ReadySession = { status: "ready", userId, dek, sync, files, keystore: ks };
  startAutoSync(s);
  return s;
}

// Auto sync ----------------------------------------------------------------
//
// The app is online-first: the session owns the polling cadence so parallel
// devices converge without user action. Chats pull every minute while the
// tab is visible (cheap no-op when nothing changed) and immediately on tab
// focus; the file tree reconciles every five minutes.

const CHAT_PULL_MS = 60_000;
const FILE_SYNC_MS = 300_000;

let autoSyncCleanup: (() => void) | null = null;

function startAutoSync(s: ReadySession): void {
  autoSyncCleanup?.();

  let lastChatPull = Date.now();
  let lastFileSync = Date.now();

  const tick = async (force = false) => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();

    if (force || now - lastChatPull >= CHAT_PULL_MS - 1_000) {
      lastChatPull = now;
      try {
        await s.sync.pull();
      } catch (err) {
        console.warn("autosync: chat pull failed", err);
      }
    }

    if (now - lastFileSync >= FILE_SYNC_MS - 1_000) {
      lastFileSync = now;
      try {
        await s.files.fullSync();
      } catch (err) {
        console.warn("autosync: file sync failed", err);
      }
    }
  };

  const timer = setInterval(() => void tick(), CHAT_PULL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void tick(true);
  };
  document.addEventListener("visibilitychange", onVisible);

  autoSyncCleanup = () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
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
        setSession(await readySession(me.id, created.dek, created.state));
      } else if (!state.keystore.pinProtected) {
        const dek = await keystore.unlockWithPin(state, "", me.id);
        setSession(await readySession(me.id, dek, state));
      } else {
        setSession({ status: "locked", userId: me.id, keystore: state });
      }
    } catch (err) {
      console.error("storeSession.init failed", err);
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
  setSession(await readySession(session.userId, dek, session.keystore));
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
  await s.files.fullSync();
}

/** Resolve when the session is ready, or reject if disabled/error. */
export async function whenReady(): Promise<ReadySession> {
  await initSession();
  if (session.status === "ready") return session;
  return new Promise((resolve, reject) => {
    // subscribeSession invokes the callback synchronously with the current
    // state — before `unsub` is assigned — so settle via a flag instead of
    // unsubscribing from inside the callback.
    let settled = false;
    let unsub: (() => void) | null = null;
    const settle = (fn: () => void) => {
      settled = true;
      fn();
      unsub?.();
    };
    unsub = subscribeSession((s) => {
      if (settled) return;
      if (s.status === "ready") settle(() => resolve(s));
      else if (s.status === "error") settle(() => reject(s.error));
      else if (s.status === "disabled") settle(() => reject(new Error("store disabled")));
    });
    if (settled) unsub();
  });
}
