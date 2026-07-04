/**
 * Keystore management.
 *
 * The keystore is a small JSON blob stored on the server that holds the
 * user's DEK in one of two shapes:
 *
 *   { version: 2, kid: 1, pinProtected: false, dek: "<base64 raw key>" }
 *   { version: 2, kid: 1, pinProtected: true,  wrappedDek, nonce, kdf }
 *
 * `kid` names the key inside every frame envelope. The server treats
 * this body as opaque. CAS via If-Match prevents concurrent stomp; the
 * server keeps `keystore.prev.json` as a one-version backup against
 * immediate user regret.
 */

import * as api from "./storeClient";
import {
  type DEK,
  fromBase64,
  generateDEK,
  type KdfParams,
  toBase64,
  unwrapDEKWithPin,
  wrapDEKWithPin,
} from "./crypto";

export interface PlainKeystore {
  version: 2;
  /** Key id stamped into frame envelopes. */
  kid: number;
  pinProtected: false;
  dek: string; // base64 32 bytes
}

export interface ProtectedKeystore {
  version: 2;
  kid: number;
  pinProtected: true;
  wrappedDek: string;
  nonce: string;
  kdf: KdfParams;
}

export type Keystore = PlainKeystore | ProtectedKeystore;

export interface KeystoreState {
  keystore: Keystore;
  etag: string;
}

export function isPinProtected(k: Keystore): k is ProtectedKeystore {
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

/**
 * Create the initial keystore on the server if it doesn't already exist.
 * Generates a fresh plaintext DEK. Returns the new keystore + the DEK.
 *
 * If a keystore was created concurrently (another tab), the function
 * re-fetches and returns the existing state — the caller should treat
 * this as a no-op and use the returned state as-is.
 */
export async function bootstrapKeystore(): Promise<{ state: KeystoreState; dek: DEK; created: boolean }> {
  const dek = await generateDEK();
  const body = JSON.stringify(plainFromDek(dek));

  try {
    const etag = await api.putKeystore(body, { ifNoneMatch: "*" });
    return { state: { keystore: JSON.parse(body), etag }, dek, created: true };
  } catch (err) {
    if (err instanceof api.ServerError && err.status === 412) {
      const existing = await loadKeystore();
      if (!existing) throw new Error("keystore race: 412 but no keystore present");
      if (existing.keystore.pinProtected) {
        // Cannot return a DEK because we don't have the PIN. The caller
        // must handle this by prompting for the PIN separately.
        throw new Error("keystore exists and is PIN-protected");
      }
      return { state: existing, dek: dekFromPlain(existing.keystore), created: false };
    }
    throw err;
  }
}

/**
 * Unwrap the DEK from a PIN-protected keystore.
 */
export async function unlockWithPin(state: KeystoreState, pin: string, userId: string): Promise<DEK> {
  if (!isPinProtected(state.keystore)) {
    return dekFromPlain(state.keystore);
  }
  return unwrapDEKWithPin(state.keystore, pin, userId, state.keystore.kid);
}

/**
 * Replace the keystore with a PIN-protected version. Requires the
 * current state (so we can use If-Match) and the current DEK.
 */
export async function setPin(state: KeystoreState, dek: DEK, pin: string, userId: string): Promise<KeystoreState> {
  const wrapped = await wrapDEKWithPin(dek, pin, userId);
  const ks: ProtectedKeystore = { version: 2, kid: dek.kid, pinProtected: true, ...wrapped };
  const body = JSON.stringify(ks);
  const etag = await api.putKeystore(body, { ifMatch: state.etag });
  return { keystore: ks, etag };
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

/**
 * Replace the keystore with a plaintext-DEK version. Requires the
 * current PIN to unlock first.
 */
export async function removePin(
  state: KeystoreState,
  pin: string,
  userId: string,
): Promise<{ state: KeystoreState; dek: DEK }> {
  const dek = await unlockWithPin(state, pin, userId);
  const ks = plainFromDek(dek);
  const body = JSON.stringify(ks);
  const etag = await api.putKeystore(body, { ifMatch: state.etag });
  return { state: { keystore: ks, etag }, dek };
}
