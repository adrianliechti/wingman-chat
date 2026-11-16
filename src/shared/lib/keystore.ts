/**
 * Keystore management.
 *
 * The keystore is a small JSON blob stored on the server that holds the
 * user's DEK wrapped with a PIN, passkey, or both independently. The server
 * only accepts protected keystores; setup keeps an unprotected placeholder in
 * memory until protection is chosen:
 *
 *   { accountId, generation, pinProtected: true, wrappedDek, nonce, kdf }
 *
 * CAS via If-Match prevents concurrent stomp. The server rejects updates that
 * change `accountId` or `generation`.
 *
 * `accountId` is a random ID bound into every ciphertext (AAD and key
 * derivation). It lives with the keystore instead of being derived from the
 * sign-in identity, so renaming the account cannot orphan the backup.
 * `generation` identifies this backup; requests from devices that still hold
 * a previous backup's generation are rejected after a reset.
 */

import * as api from "./storeClient";
import { createPasskeyEnvelope, unlockPasskeyEnvelope, type PasskeyEnvelope } from "./passkey";
import { type DEK, generateDEK, type KdfParams, unwrapDEKWithPin, wrapDEKWithPin } from "./crypto";

export const PIN_MIN_LENGTH = 8;
export const PIN_MAX_LENGTH = 32;

/** In-memory setup placeholder; never uploaded. */
interface SetupKeystore {
  /** Random ID bound into every ciphertext of this backup. */
  accountId: string;
  /** Random ID that fences devices from before a reset. */
  generation: string;
  pinProtected: false;
  passkeyProtected?: false;
}

interface ProtectedKeystore {
  accountId: string;
  generation: string;
  pinProtected: true;
  passkeyProtected?: false;
  wrappedDek: string;
  nonce: string;
  kdf: KdfParams;
}

interface PasskeyKeystore {
  accountId: string;
  generation: string;
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
export function prepareSetup(): { state: KeystoreState; dek: DEK } {
  return {
    state: {
      keystore: { accountId: newAccountId(), generation: crypto.randomUUID(), pinProtected: false },
      etag: "",
    },
    dek: generateDEK(),
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
    return await unwrapDEKWithPin(state.keystore, pin, state.keystore.accountId);
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
  const { accountId, generation } = state.keystore;
  const wrapped = await wrapDEKWithPin(dek, pin, accountId);
  const pinState: ProtectedKeystore = { accountId, generation, pinProtected: true, ...wrapped };
  const ks: ProtectedKeystore | DualProtectedKeystore = isPasskeyProtected(state.keystore)
    ? { ...pinState, passkeyProtected: true, passkey: state.keystore.passkey }
    : pinState;
  return saveProtected(state, ks);
}

/** Add or replace a passkey after verification, preserving any PIN protection. */
export async function setPasskey(state: KeystoreState, dek: DEK): Promise<KeystoreState> {
  const { accountId, generation } = state.keystore;
  const passkey = await createPasskeyEnvelope(dek, accountId);
  const passkeyState: PasskeyKeystore = { accountId, generation, pinProtected: false, passkeyProtected: true, passkey };
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
  return unlockPasskeyEnvelope(state.keystore.passkey, state.keystore.accountId);
}
