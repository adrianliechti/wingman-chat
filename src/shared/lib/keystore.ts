/**
 * Keystore management.
 *
 * The keystore is a small JSON blob stored on the server that holds the
 * user's DEK wrapped with a PIN, passkey, or both independently. The server
 * only accepts protected keystores; setup keeps an unprotected placeholder in
 * memory until protection is chosen:
 *
 *   { version: 2, kid: 1, accountId, pinProtected: true, wrappedDek, nonce, kdf }
 *
 * `kid` names the key inside every frame envelope. The server treats
 * this body as opaque. CAS via If-Match prevents concurrent stomp; the
 * server discards obsolete keystore copies when protection changes.
 *
 * `accountId` is a random ID bound into every ciphertext (AAD and key
 * derivation). It lives with the keystore instead of being derived from the
 * sign-in identity, so renaming the account cannot orphan the backup.
 */

import * as api from "./storeClient";
import { readJson, writeJson } from "./opfs-core";
import { generateBackupKeys, importBackupPublicKey, importBackupPrivateKey } from "./backupCrypto";
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
  toBase64,
  unwrapDEKWithPin,
  wrapDEKWithPin,
} from "./crypto";

interface BackupEnvelope {
  generation: string;
  publicKey: string;
  encryptedPrivateKey: string;
}

export const PIN_MIN_LENGTH = 8;
export const PIN_MAX_LENGTH = 32;

/** In-memory setup placeholder; never uploaded. */
interface SetupKeystore {
  /** Random ID bound into every ciphertext of this backup. */
  accountId: string;
  backup?: BackupEnvelope;
  version: 2;
  /** Key id stamped into frame envelopes. */
  kid: number;
  pinProtected: false;
  passkeyProtected?: false;
}

interface ProtectedKeystore {
  accountId: string;
  backup?: BackupEnvelope;
  version: 2;
  kid: number;
  pinProtected: true;
  passkeyProtected?: false;
  wrappedDek: string;
  nonce: string;
  kdf: KdfParams;
}

interface PasskeyKeystore {
  accountId: string;
  backup?: BackupEnvelope;
  version: 2;
  kid: number;
  pinProtected: false;
  passkeyProtected: true;
  passkey: PasskeyEnvelope;
}

interface DualProtectedKeystore extends Omit<ProtectedKeystore, "passkeyProtected"> {
  passkeyProtected: true;
  passkey: PasskeyEnvelope;
}

export type Keystore = SetupKeystore | ProtectedKeystore | PasskeyKeystore | DualProtectedKeystore;

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

function newAccountId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isPinProtected(k: Keystore): k is ProtectedKeystore | DualProtectedKeystore {
  return k.pinProtected === true;
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
  return {
    state: { keystore: { version: 2, kid: dek.kid, accountId: newAccountId(), pinProtected: false }, etag: "" },
    dek,
  };
}

async function saveProtected(state: KeystoreState, ks: Keystore): Promise<KeystoreState> {
  if (!isProtected(ks)) throw new Error("Backups require a PIN or passkey.");
  const etag = await api.putKeystore(JSON.stringify(ks), state.etag ? { ifMatch: state.etag } : { ifNoneMatch: "*" });
  return { keystore: ks, etag };
}

/**
 * Unwrap the DEK from a PIN-protected keystore.
 */
export async function unlockWithPin(state: KeystoreState, pin: string): Promise<DEK> {
  if (!isPinProtected(state.keystore)) {
    throw new Error(
      isPasskeyProtected(state.keystore) ? "Use your passkey to unlock sync." : "Sync is not PIN-protected.",
    );
  }
  try {
    return await unwrapDEKWithPin(state.keystore, pin, state.keystore.accountId, state.keystore.kid);
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
export async function setPin(state: KeystoreState, dek: DEK, pin: string): Promise<KeystoreState> {
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new Error(`PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} characters.`);
  }
  const { accountId } = state.keystore;
  const wrapped = await wrapDEKWithPin(dek, pin, accountId);
  const pinState: ProtectedKeystore = {
    version: 2,
    kid: dek.kid,
    accountId,
    pinProtected: true,
    backup: state.keystore.backup,
    ...wrapped,
  };
  const ks: ProtectedKeystore | DualProtectedKeystore = isPasskeyProtected(state.keystore)
    ? { ...pinState, passkeyProtected: true, passkey: state.keystore.passkey }
    : pinState;
  return saveProtected(state, ks);
}

/** Add or replace a passkey after verification, preserving any PIN protection. */
export async function setPasskey(state: KeystoreState, dek: DEK): Promise<KeystoreState> {
  const { accountId } = state.keystore;
  const passkey = await createPasskeyEnvelope(dek, accountId);
  const passkeyState: PasskeyKeystore = {
    version: 2,
    kid: dek.kid,
    accountId,
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

export async function unlockWithPasskey(state: KeystoreState): Promise<DEK> {
  if (!isPasskeyProtected(state.keystore)) throw new Error("Sync is not passkey-protected.");
  return unlockPasskeyEnvelope(state.keystore.passkey, state.keystore.accountId, state.keystore.kid);
}

/** Provision the backup key pair once while unlocked; its private key is sealed with the root key. */
export async function enableBackupUploads<K extends RootKey>(
  state: KeystoreState,
  dek: K,
  userId: string,
): Promise<{ state: KeystoreState; dek: K }> {
  if (!isProtected(state.keystore)) throw new Error("Backups require a PIN or passkey.");
  // Seal only with the root key, never recursively with the backup public key.
  const root = (hasRawKey(dek) ? { raw: dek.raw, kid: dek.kid } : { key: dek.key, kid: dek.kid }) as K;
  const { accountId } = state.keystore;
  let current = state;
  if (!current.keystore.backup) {
    const pair = await generateBackupKeys();
    const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const encryptedPrivateKey = toBase64(await encryptBlob(root, privateBytes, accountId, `backup-private:${dek.kid}`));
    privateBytes.fill(0);
    const backup = {
      generation: crypto.randomUUID(),
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
    accountId,
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
