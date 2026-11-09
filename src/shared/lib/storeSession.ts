/**
 * Session owns backup engines; remembered devices resume unlocked sync automatically.
 *
 * Lifecycle:
 *   1. App boots → init() resolves the keystore.
 *      - No keystore or legacy plaintext key → setup; choose PIN/passkey before uploading.
 *      - Remembered device + matching protected keystore → automatic unlocked sync.
 *      - Protected keystore + trusted public cache → upload-only, no decryption key.
 *      - No trusted public cache → unlock once to provision uploads.
 *   2. useChats / migration code waits on whenReady() before touching sync.
 *   3. Protection changes rewrap the existing DEK and update the keystore.
 */

import { getConfig } from "@/shared/config";
import { prepareBackupDestination } from "./backupDestination";
import { notify } from "./notify";
import { completePendingBackupReset } from "./backupReset";
import { invalidateBackupSessions, isBackupSessionCurrent, withBackupStorage } from "./backupLifecycle";
import { onChatBackupReady } from "./chatBackupActivity";
import { ChatSync } from "./chatSync";
import * as api from "./storeClient";
import { type DEK, type RootKey, type StoreKey, hasRawKey } from "./crypto";
import { FileSync } from "./fileSync";
import { deleteFile } from "./opfs-core";
import { flushPersistence, withPersistenceLock } from "./persistence";
import * as keystore from "./keystore";
import { forgetBackup, loadRememberedBackup, rememberBackup } from "./rememberedBackup";

interface SetupSession {
  status: "setup";
  userId: string;
  dek: DEK;
  keystore: keystore.KeystoreState;
}

interface ReadySession {
  status: "ready";
  remembered: boolean;
  userId: string;
  /** Remembered devices hold a non-extractable key until the user unlocks again. */
  dek: RootKey;
  sync: ChatSync;
  files: FileSync;
  keystore: keystore.KeystoreState;
}

interface UploadSession {
  status: "upload-only";
  userId: string;
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
  userId?: string;
  error?: unknown;
}

type Session = SetupSession | ReadySession | UploadSession | LockedSession | PendingSession;

let session: Session = { status: "initializing" };
let initPromise: Promise<Session> | null = null;
const listeners = new Set<(s: Session) => void>();

function setSession(next: Session) {
  session = next;
  for (const l of listeners) l(next);
  if (next.status === "ready" || next.status === "upload-only") {
    // Push anything that didn't reach the server last session (crash,
    // network blip). Cheap no-op when nothing is pending.
    const reconcile = async () => {
      try {
        if (next.status === "ready") await next.sync.pull();
      } finally {
        await next.sync.flushPending();
      }
    };
    void reconcile().catch((err) => console.error("storeSession: sync failed", err));
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

function isEnabled(): boolean {
  return getConfig().store === true;
}

async function engines(userId: string, key: StoreKey) {
  const sync = await ChatSync.create({ userId, dek: key });
  const files = await FileSync.create({ userId, dek: key });
  files.start();
  return { sync, files };
}

async function readySession(userId: string, dek: RootKey, ks: keystore.KeystoreState): Promise<ReadySession> {
  return withBackupStorage(() => {
    if (!isBackupSessionCurrent()) throw new Error("Backup settings changed. Reload before syncing.");
    return readySessionUnlocked(userId, dek, ks);
  });
}

async function readySessionUnlocked(userId: string, dek: RootKey, ks: keystore.KeystoreState): Promise<ReadySession> {
  const upgraded = await keystore.enableBackupUploads(ks, dek, userId);
  await rememberBackup(userId, upgraded.state, upgraded.dek);
  api.setBackupKey(upgraded.state.keystore.backup!.publicKey);
  const wasUploading = session.status === "upload-only" && session.userId === userId;
  const active =
    session.status === "upload-only" && session.userId === userId
      ? { sync: session.sync, files: session.files }
      : await engines(userId, upgraded.dek);
  active.sync.setKey(upgraded.dek);
  active.files.setKey(upgraded.dek);
  const s: ReadySession = {
    status: "ready",
    remembered: true,
    userId,
    dek: upgraded.dek,
    ...active,
    keystore: upgraded.state,
  };
  startAutoSync(s);
  // Resume files immediately when restore is unlocked, not five minutes later.
  if (wasUploading) void s.files.restore().catch((err) => console.warn("restore: file pull failed", err));
  return s;
}

/** Preserve committed protection if later provisioning/cache writes fail. */
async function activateRestore(userId: string, dek: DEK, state: keystore.KeystoreState): Promise<void> {
  try {
    setSession(await readySession(userId, dek, state));
  } catch (error) {
    const latest = await keystore.loadKeystore().catch(() => null);
    const current = session;
    if (current.status === "upload-only" && current.userId === userId) {
      setSession({ ...current, keystore: latest ?? state });
    } else {
      setSession({ status: "locked", userId, keystore: latest ?? state });
    }
    throw error;
  }
}

async function uploadSession(userId: string, ks: keystore.KeystoreState): Promise<UploadSession | LockedSession> {
  return withBackupStorage(() => {
    if (!isBackupSessionCurrent()) throw new Error("Backup settings changed. Reload before syncing.");
    return uploadSessionUnlocked(userId, ks);
  });
}

async function uploadSessionUnlocked(
  userId: string,
  ks: keystore.KeystoreState,
): Promise<UploadSession | LockedSession> {
  const key = await keystore.uploadKey(ks, userId);
  if (!key) return { status: "locked", userId, keystore: ks };
  api.setBackupKey(ks.keystore.backup!.publicKey);
  const active = await engines(userId, key);
  const s: UploadSession = { status: "upload-only", userId, ...active, keystore: ks };
  startAutoSync(s);
  return s;
}

// Auto sync ----------------------------------------------------------------
//
// Uploads run without unlocking. Only unlocked sessions pull remote data; Chats pull every minute while the
// tab is visible (cheap no-op when nothing changed) and immediately on tab
// focus; the file tree reconciles every five minutes.

const CHAT_PULL_MS = 60_000;
const FILE_SYNC_MS = 300_000;

let autoSyncCleanup: (() => void) | null = null;

function startAutoSync(s: ReadySession | UploadSession): void {
  autoSyncCleanup?.();

  let lastChatPull = Date.now();
  let lastFileSync = Date.now();

  const tick = async (force = false) => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();

    if (s.status === "ready" && (force || now - lastChatPull >= CHAT_PULL_MS - 1_000)) {
      lastChatPull = now;
      try {
        await s.sync.pull();
      } catch (err) {
        console.warn("autosync: chat pull failed", err);
      }
    }

    await s.sync.flushPending();

    if (now - lastFileSync >= FILE_SYNC_MS - 1_000) {
      lastFileSync = now;
      try {
        await s.files.fullSync();
      } catch (err) {
        console.warn("autosync: file sync failed", err);
      }
    }
  };

  const unsubscribeBackup = onChatBackupReady(() => {
    void s.sync.flushPending().catch((error) => console.warn("Chat backup failed", error));
    void s.files.flushDirty().catch((error) => console.warn("File backup failed", error));
  });
  const timer = setInterval(() => void tick(), CHAT_PULL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void tick(true);
  };
  document.addEventListener("visibilitychange", onVisible);

  autoSyncCleanup = () => {
    unsubscribeBackup();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export async function initSession(): Promise<Session> {
  if (!isEnabled()) {
    setSession({ status: "disabled" });
    return session;
  }
  if (initPromise) {
    await initPromise;
    return session;
  }

  initPromise = (async () => {
    try {
      const me = await api.fetchMe();
      if (!(await prepareBackupDestination(me.id, me.backupDestination ?? "server", me.previousId))) {
        setSession({ status: "initializing", userId: me.id });
        // Queued chat saves can be awaiting initSession itself. Resolve first
        // so they can finish saving locally before this page reloads.
        void flushPersistence()
          .then(() => window.location.reload())
          .catch((error) => notify.error("Couldn't save before backup destination changed", error));
        return session;
      }
      await completePendingBackupReset(me.id);

      const state = await keystore.loadKeystore();

      let remembered: RootKey | null = null;
      if (state && keystore.isProtected(state.keystore)) {
        try {
          remembered = await loadRememberedBackup(me.id, state);
        } catch (error) {
          console.warn("Couldn't read remembered device access", error);
        }
      } else await forgetBackup();

      if (remembered && state) {
        try {
          setSession(await readySession(me.id, remembered, state));
          return session;
        } catch (error) {
          console.warn("Remembered device requires another unlock", error);
          await forgetBackup();
        }
      }
      if (!state) {
        const prepared = await keystore.prepareSetup();
        setSession({ status: "setup", userId: me.id, dek: prepared.dek, keystore: prepared.state });
      } else if (!keystore.isProtected(state.keystore)) {
        const dek = await keystore.unlockWithPin(state, "", me.id);
        setSession({ status: "setup", userId: me.id, dek, keystore: state });
      } else if (state.keystore.backup) {
        setSession(await uploadSession(me.id, state));
      } else {
        setSession({ status: "locked", userId: me.id, keystore: state });
      }
    } catch (err) {
      console.error("storeSession.init failed", err);
      setSession({ status: "error", error: err });
      // Transient failures (server restart, network blip) must not disable
      // sync for the tab's lifetime — retry with a fresh init.
      setTimeout(() => {
        if (session.status === "error") {
          initPromise = null;
          void initSession();
        }
      }, 15_000);
    }
    return session;
  })();

  return initPromise;
}

/** Unlock a PIN-protected keystore. Promotes session to "ready" on success. */
export async function unlock(pin: string): Promise<void> {
  if (session.status !== "locked" && session.status !== "upload-only") {
    throw new Error(`session is not locked (status=${session.status})`);
  }
  const { userId, keystore: state } = session;
  const dek = await keystore.unlockWithPin(state, pin, userId);
  const upgraded = await keystore.upgradePinProtection(state, dek, pin, userId).catch((error: unknown) => {
    console.warn("Couldn't upgrade PIN protection", error);
    return state;
  });
  await activateRestore(userId, dek, upgraded);
}

/** True when a remembered device must confirm the PIN before adding a passkey. */
export function needsPinToChangeProtection(): boolean {
  return (
    session.status === "ready" && !hasRawKey(session.dek) && !keystore.isPasskeyProtected(session.keystore.keystore)
  );
}

/** Confirm the PIN on a remembered device so protection can be changed this page session. */
export async function confirmPin(pin: string): Promise<void> {
  const current = session;
  if (current.status !== "ready") throw new Error("Unlock backup to change protection.");
  const dek = await keystore.unlockWithPin(current.keystore, pin, current.userId);
  const upgraded = await keystore
    .upgradePinProtection(current.keystore, dek, pin, current.userId)
    .catch((error: unknown) => {
      console.warn("Couldn't upgrade PIN protection", error);
      return current.keystore;
    });
  const root: DEK = { ...dek, backup: current.dek.backup };
  if (upgraded !== current.keystore) await updateProtection({ ...current, dek: root }, upgraded);
  else session = { ...current, dek: root };
}

/**
 * Protection changes must re-wrap the root key bytes, which a remembered
 * device's non-extractable key cannot provide. Passkeys re-authenticate inline;
 * PIN-only devices call confirmPin first.
 */
async function rootBytes(current: SetupSession | ReadySession): Promise<DEK> {
  if (hasRawKey(current.dek)) return current.dek;
  if (!keystore.isPasskeyProtected(current.keystore.keystore)) {
    throw new Error("Enter your PIN to change backup protection.");
  }
  const dek = await keystore.unlockWithPasskey(current.keystore, current.userId);
  const root: DEK = { ...dek, backup: current.dek.backup };
  if (session === current) session = { ...current, dek: root };
  return root;
}

/** Configure protection before starting any backup engine. */
export async function setPin(pin: string): Promise<void> {
  const current = session;
  if (current.status !== "ready" && current.status !== "setup") throw new Error("Unlock backup to change protection.");
  const dek = await rootBytes(current);
  const newState = await keystore.setPin(current.keystore, dek, pin, current.userId);
  await updateProtection({ ...current, dek }, newState);
}

/** Change the PIN. Requires the old PIN. */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  if (session.status !== "ready") throw new Error("session not ready");
  const current = session;
  const dek = await keystore.unlockWithPin(current.keystore, oldPin, current.userId);
  const newState = await keystore.setPin(current.keystore, dek, newPin, current.userId);
  await updateProtection({ ...current, dek: { ...dek, backup: current.dek.backup } }, newState);
}

/** Keep local trust bound to the newly committed protection record. */
async function updateProtection(current: SetupSession | ReadySession, state: keystore.KeystoreState): Promise<void> {
  if (current.status === "setup") {
    setSession({ status: "locked", userId: current.userId, keystore: state });
    await activateRestore(current.userId, current.dek, state);
    return;
  }
  setSession({ ...current, keystore: state, remembered: false });
  await withBackupStorage(async () => {
    if (!isBackupSessionCurrent()) throw new Error("Backup settings changed. Reload before syncing.");
    await rememberBackup(current.userId, state, current.dek);
    setSession({ ...current, keystore: state, remembered: true });
  });
}

/** Stop this browser's uploads and incoming sync until the next explicit unlock. */
export async function stopDeviceSync(): Promise<void> {
  await flushPersistence();
  await withPersistenceLock("backup-reset", async () => {
    if (!isBackupSessionCurrent()) throw new Error("Backup settings changed. Reload before syncing.");
    if (session.status !== "ready" && session.status !== "upload-only") throw new Error("Backup is already locked.");
    await forgetBackup();
    await deleteFile("_sync/upload-key.json");
    invalidateBackupSessions();
    autoSyncCleanup?.();
    session.files.stop();
  });
  window.location.reload();
}

/** Manual sync: pull remote changes, then push pending local edits. */
export async function syncNow(): Promise<void> {
  await initSession();
  if (session.status === "upload-only") {
    await session.sync.flushPending();
    await session.files.fullSync();
    return;
  }
  if (session.status === "setup") throw new Error("Set a PIN or passkey to enable backups.");
  const s = await whenReady();
  await s.sync.pull();
  await s.sync.flushPending();
  await s.files.fullSync();
}

/** Resolve when the session is ready, or reject if disabled/error. */
async function whenReady(): Promise<ReadySession> {
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

/** Unlock on a user gesture so the browser can show its passkey prompt. */
export async function unlockPasskey(): Promise<void> {
  const current = session;
  if (current.status !== "locked" && current.status !== "upload-only") throw new Error("session is not locked");
  const dek = await keystore.unlockWithPasskey(current.keystore, current.userId);
  await activateRestore(current.userId, dek, current.keystore);
}

export async function setPasskey(): Promise<void> {
  const current = session;
  if (current.status !== "ready" && current.status !== "setup") throw new Error("Unlock backup to change protection.");
  const dek = await rootBytes(current);
  const newState = await keystore.setPasskey(current.keystore, dek, current.userId);
  await updateProtection({ ...current, dek }, newState);
}
