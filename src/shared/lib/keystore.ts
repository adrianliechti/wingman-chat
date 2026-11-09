/**
 * Keystore management.
 *
 * The keystore is a small JSON blob stored on the server that holds the
 * user's DEK wrapped with a PIN, passkey, or both independently. Plain keys are supported only
 * in memory during setup and when upgrading old unprotected server records:
 *
 *   { version: 2, kid: 1, pinProtected: false, dek: "<base64 raw key>" }
 *   { version: 2, kid: 1, pinProtected: true,  wrappedDek, nonce, kdf }
 *
 * `kid` names the key inside every frame envelope. The server treats
 * this body as opaque. CAS via If-Match prevents concurrent stomp; the
 * server discards obsolete keystore copies when protection changes.
 */

import * as api from "./storeClient";
import { readJson, writeJson } from "./opfs-core";
import { generateBackupKeys, importBackupPublicKey, importBackupPrivateKey } from "./backupCrypto";

interface BackupEnvelope {
  publicKey: string;
  encryptedPrivateKey: string;
}
import { createPasskeyEnvelope, unlockPasskeyEnvelope, type PasskeyEnvelope } from "./passkey";
import {
  type DEK,
  type RootKey,
  type UploadKey,
  encryptBlob,
  decryptBlob,
  fromBase64,
  generateDEK,
  hasRawKey,
  type KdfParams,
  kdfNeedsUpgrade,
  toBase64,
  unwrapDEKWithPin,
  wrapDEKWithPin,
} from "./crypto";

export const PIN_MIN_LENGTH = 8;
export const PIN_MAX_LENGTH = 32;

export interface PlainKeystore {
  backup?: BackupEnvelope;
  version: 2;
  /** Key id stamped into frame envelopes. */
  kid: number;
  pinProtected: false;
  passkeyProtected?: false;
  dek: string; // base64 32 bytes
}

export interface ProtectedKeystore {
  backup?: BackupEnvelope;
  version: 2;
  kid: number;
  pinProtected: true;
  passkeyProtected?: false;
  wrappedDek: string;
  nonce: string;
  kdf: KdfParams;
}

export interface PasskeyKeystore {
  backup?: BackupEnvelope;
  version: 2;
  kid: number;
  pinProtected: false;
  passkeyProtected: true;
  passkey: PasskeyEnvelope;
}

export interface DualProtectedKeystore extends Omit<ProtectedKeystore, "passkeyProtected"> {
  passkeyProtected: true;
  passkey: PasskeyEnvelope;
}

export type Keystore = PlainKeystore | ProtectedKeystore | PasskeyKeystore | DualProtectedKeystore;

export function isPasskeyProtected(k: Keystore): k is PasskeyKeystore | DualProtectedKeystore {
  return k.passkeyProtected === true;
}

export function isProtected(k: Keystore): boolean {
  return isPinProtected(k) || isPasskeyProtected(k);
}

export interface KeystoreState {
  keystore: Keystore;
  etag: string;
}

export function isPinProtected(k: Keystore): k is ProtectedKeystore | DualProtectedKeystore {
  return k.pinProtected === true;
}

function dekFromPlain(k: PlainKeystore): DEK {
  const raw = fromBase64(k.dek);
  if (raw.length !== 32) throw new Error("invalid DEK length");
  return { raw, kid: k.kid };
}

function plainFromDek(dek: DEK): PlainKeystore {
  return { version: 2, kid: dek.kid, pinProtected: false, dek: toBase64(dek.raw) };
}

/**
 * Load the keystore from the server. Returns null if none exists yet.
 */
export async function loadKeystore(): Promise<KeystoreState | null> {
  const res = await api.getKeystore();
  if (!res) return null;
  const keystore = JSON.parse(res.data) as Keystore;
  return { keystore, etag: res.etag };
}

/** Prepare a key only in memory. Nothing is uploaded until protection is chosen. */
export async function prepareSetup(): Promise<{ state: KeystoreState; dek: DEK }> {
  const dek = await generateDEK();
  return { state: { keystore: plainFromDek(dek), etag: "" }, dek };
}

async function saveProtected(state: KeystoreState, ks: Keystore): Promise<KeystoreState> {
  if (!isProtected(ks)) throw new Error("Backups require a PIN or passkey.");
  const etag = await api.putKeystore(JSON.stringify(ks), state.etag ? { ifMatch: state.etag } : { ifNoneMatch: "*" });
  return { keystore: ks, etag };
}

/**
 * Unwrap the DEK from a PIN-protected keystore.
 */
export async function unlockWithPin(state: KeystoreState, pin: string, userId: string): Promise<DEK> {
  if (!isPinProtected(state.keystore)) {
    if (isPasskeyProtected(state.keystore)) throw new Error("Use your passkey to unlock sync.");
    return dekFromPlain(state.keystore);
  }
  const pepper = state.keystore.kdf.name === "argon2id" && state.keystore.kdf.pepper ? await api.getPinPepper() : null;
  try {
    return await unwrapDEKWithPin(state.keystore, pin, userId, state.keystore.kid, pepper);
  } catch (err) {
    if (err instanceof Error && err.name === "OperationError") {
      throw new Error("Incorrect PIN. Please try again.", { cause: err });
    }
    throw err;
  }
}

/**
 * Add or update PIN protection, preserving any passkey. Requires the
 * current state (so we can use If-Match) and the current DEK.
 */
export async function setPin(state: KeystoreState, dek: DEK, pin: string, userId: string): Promise<KeystoreState> {
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new Error(`PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} characters.`);
  }
  return savePin(state, dek, pin, userId, await api.getPinPepper());
}

/**
 * Re-wrap an existing PIN with the current KDF and server pepper after a
 * successful unlock. Older PINs keep working even below today's minimum length.
 * Returns the unchanged state when no upgrade is needed or possible.
 */
export async function upgradePinProtection(
  state: KeystoreState,
  dek: DEK,
  pin: string,
  userId: string,
): Promise<KeystoreState> {
  if (!isPinProtected(state.keystore)) return state;
  let pepper: Uint8Array<ArrayBuffer> | null;
  try {
    pepper = await api.getPinPepper();
  } catch {
    return state;
  }
  if (!kdfNeedsUpgrade(state.keystore.kdf, pepper !== null)) return state;
  return savePin(state, dek, pin, userId, pepper);
}

async function savePin(
  state: KeystoreState,
  dek: DEK,
  pin: string,
  userId: string,
  pepper: Uint8Array<ArrayBuffer> | null,
): Promise<KeystoreState> {
  const wrapped = await wrapDEKWithPin(dek, pin, userId, pepper);
  const pinState: ProtectedKeystore = {
    version: 2,
    kid: dek.kid,
    pinProtected: true,
    backup: state.keystore.backup,
    ...wrapped,
  };
  const ks: ProtectedKeystore | DualProtectedKeystore = isPasskeyProtected(state.keystore)
    ? { ...pinState, passkeyProtected: true, passkey: state.keystore.passkey }
    : pinState;
  return saveProtected(state, ks);
}

/**
 * Re-wrap the DEK with a new PIN. Requires the old PIN to unlock first.
 */
export async function changePin(
  state: KeystoreState,
  oldPin: string,
  newPin: string,
  userId: string,
): Promise<KeystoreState> {
  const dek = await unlockWithPin(state, oldPin, userId);
  return setPin(state, dek, newPin, userId);
}

/** Add or replace a passkey after verification, preserving any PIN protection. */
export async function setPasskey(state: KeystoreState, dek: DEK, userId: string): Promise<KeystoreState> {
  const passkey = await createPasskeyEnvelope(dek, userId);
  const passkeyState: PasskeyKeystore = {
    version: 2,
    kid: dek.kid,
    pinProtected: false,
    passkeyProtected: true,
    backup: state.keystore.backup,
    passkey,
  };
  const ks: PasskeyKeystore | DualProtectedKeystore = isPinProtected(state.keystore)
    ? {
        ...passkeyState,
        pinProtected: true,
        wrappedDek: state.keystore.wrappedDek,
        nonce: state.keystore.nonce,
        kdf: state.keystore.kdf,
      }
    : passkeyState;
  return saveProtected(state, ks);
}

export async function unlockWithPasskey(state: KeystoreState, userId: string): Promise<DEK> {
  if (!isPasskeyProtected(state.keystore)) throw new Error("Sync is not passkey-protected.");
  return unlockPasskeyEnvelope(state.keystore.passkey, userId, state.keystore.kid);
}

/** Upgrade once while unlocked, preserving old symmetric history and its protected key. */
export async function enableBackupUploads<K extends RootKey>(
  state: KeystoreState,
  dek: K,
  userId: string,
): Promise<{ state: KeystoreState; dek: K }> {
  if (!isProtected(state.keystore)) throw new Error("Backups require a PIN or passkey.");
  // Seal only with the root key, never recursively with the backup public key.
  const root = (hasRawKey(dek) ? { raw: dek.raw, kid: dek.kid } : { key: dek.key, kid: dek.kid }) as K;
  let current = state;
  if (!current.keystore.backup) {
    const pair = await generateBackupKeys();
    const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const encryptedPrivateKey = toBase64(await encryptBlob(root, privateBytes, userId, `backup-private:${dek.kid}`));
    privateBytes.fill(0);
    const backup = {
      publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))),
      encryptedPrivateKey,
    };
    const ks = { ...current.keystore, backup };
    const etag = await api.putKeystore(JSON.stringify(ks), { ifMatch: current.etag });
    current = { keystore: ks, etag };
  }
  const envelope = current.keystore.backup!;
  const publicKey = await importBackupPublicKey(fromBase64(envelope.publicKey));
  const privateBytes = await decryptBlob(
    root,
    fromBase64(envelope.encryptedPrivateKey),
    userId,
    `backup-private:${dek.kid}`,
  );
  const privateKey = await importBackupPrivateKey(privateBytes);
  privateBytes.fill(0);
  // Detect a mismatched public/private pair before permitting uploads.
  const probe = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, probe);
  const unwrapped = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrapped));
  if (!unwrapped.every((byte, index) => byte === probe[index])) throw new Error("Backup key pair does not match.");
  await writeJson("_sync/upload-key.json", { userId, kid: dek.kid, publicKey: envelope.publicKey });
  return { state: current, dek: { ...root, backup: { publicKey, privateKey } } };
}

export async function uploadKey(state: KeystoreState, userId: string): Promise<UploadKey | null> {
  const trusted = await readJson<{ userId: string; kid: number; publicKey: string }>("_sync/upload-key.json");
  if (
    !isProtected(state.keystore) ||
    !state.keystore.backup ||
    trusted?.userId !== userId ||
    trusted.kid !== state.keystore.kid ||
    trusted.publicKey !== state.keystore.backup.publicKey
  )
    return null;
  return {
    kid: state.keystore.kid,
    backup: { publicKey: await importBackupPublicKey(fromBase64(state.keystore.backup.publicKey)) },
  };
}
