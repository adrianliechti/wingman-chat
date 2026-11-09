/**
 * Client-side crypto primitives for the encrypted chat store.
 *
 * Threat model:
 *   - Server is *not* trusted to read chat contents.
 *   - Server *is* trusted to identify the user (via reverse-proxy headers).
 *   - PIN, when set, protects the DEK against storage-theft scenarios. A PIN
 *     is low-entropy: without the server pepper it is brute-forceable offline
 *     if the wrapped DEK leaks, so Argon2id only raises the cost per guess.
 *
 * Primitives:
 *   - Argon2id (64 MiB, t=3) + HKDF-SHA256 keyed by an optional server-held
 *     per-user pepper → 256-bit KEK from PIN + salt. Legacy PBKDF2-SHA256
 *     (600 000 iterations) wraps stay readable and upgrade on unlock.
 *   - AES-256-GCM with random 12-byte nonce for both DEK-wrap and event/blob.
 *   - AAD pins identity into ciphertext (userId:chatId:seq for events,
 *     userId:blobId for blobs). Wrong AAD ⇒ decrypt fails.
 *   - Hash chain inside event plaintext (prevHash) detects reordered,
 *     dropped or misplaced frames.
 *
 * Not covered: authorship. Backup frames (v3) are sealed to a public key the
 * server also holds, so a compromised server can create frames that decrypt
 * and chain correctly. AAD and the hash chain catch corruption and mix-ups,
 * not forgery; that would need a signing key the server never sees.
 */

import { type BackupKeys, encryptBackup, decryptBackup } from "./backupCrypto";

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const DEK_BYTES = 32;
const GCM_TAG_BYTES = 16;

/** Leading magic byte of the versioned frame envelope (see below). */
const FRAME_V2 = 0x02;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Bytes is short for Uint8Array<ArrayBuffer> — the ArrayBuffer-backed
// variant Web Crypto expects (Uint8Array<ArrayBufferLike> is rejected by
// strict typings because of the SharedArrayBuffer distinction).
type Bytes = Uint8Array<ArrayBuffer>;

function bufFrom(view: Uint8Array | ArrayBuffer): Bytes {
  if (view instanceof Uint8Array) {
    const out = new Uint8Array(new ArrayBuffer(view.byteLength));
    out.set(view);
    return out as Bytes;
  }
  return new Uint8Array(view) as Bytes;
}

// base64 (standard alphabet, to match the server's `frame` field).
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length)) as Bytes;
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Bytes {
  const out = new Uint8Array(new ArrayBuffer(n)) as Bytes;
  crypto.getRandomValues(out);
  return out;
}

function encodeUtf8(s: string): Bytes {
  return bufFrom(encoder.encode(s));
}

// DEK ---------------------------------------------------------------------

export interface UploadKey {
  kid: number;
  backup: BackupKeys;
  raw?: never;
  key?: never;
}

export interface DEK {
  backup?: BackupKeys;
  /** Raw 32-byte key material, used to derive AES-GCM CryptoKeys per call. */
  raw: Bytes;
  key?: never;
  /** Key id (1–255) stamped into every frame envelope, so the DEK can be
   *  rotated later without guess-decrypting old history. */
  kid: number;
}

/**
 * Root key restored from a remembered device. The non-extractable AES-GCM key
 * can decrypt and encrypt, but its bytes can never be read back, so it cannot
 * re-wrap the root for new PIN or passkey protection.
 */
export interface DeviceKey {
  backup?: BackupKeys;
  key: CryptoKey;
  raw?: never;
  kid: number;
}

export type RootKey = DEK | DeviceKey;

export type StoreKey = RootKey | UploadKey;

export function canRestore(key: StoreKey): key is RootKey {
  return key.raw !== undefined || key.key !== undefined;
}

export function hasRawKey(key: StoreKey): key is DEK {
  return key.raw !== undefined;
}

export async function generateDEK(kid = 1): Promise<DEK> {
  if (!Number.isInteger(kid) || kid < 1 || kid > 255) throw new Error(`invalid key id: ${kid}`);
  return { raw: randomBytes(DEK_BYTES), kid };
}

/** Import root key bytes as a non-extractable key suitable for device storage. */
export async function toDeviceKey(root: RootKey): Promise<DeviceKey> {
  if (!hasRawKey(root)) return { key: root.key, kid: root.kid };
  const key = await crypto.subtle.importKey("raw", bufFrom(root.raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { key, kid: root.kid };
}

async function importDekForAesGcm(dek: RootKey): Promise<CryptoKey> {
  if (!hasRawKey(dek)) return dek.key;
  return crypto.subtle.importKey("raw", bufFrom(dek.raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// KEK from PIN -----------------------------------------------------------

export interface Pbkdf2Params {
  name: "pbkdf2-sha256";
  salt: string; // base64
  iter: number;
}

export interface Argon2idParams {
  name: "argon2id";
  salt: string; // base64
  /** Memory cost in KiB. */
  m: number;
  t: number;
  p: number;
  /** Mixes in the server's per-user PIN pepper, required to unlock. */
  pepper?: boolean;
}

export type KdfParams = Pbkdf2Params | Argon2idParams;

const ARGON2_COST = { m: 64 * 1024, t: 3, p: 1 } as const;
// Bound server-supplied parameters so a hostile keystore cannot exhaust the browser.
const ARGON2_MAX_MEMORY_KIB = 256 * 1024;
const ARGON2_MAX_ITERATIONS = 16;
const ARGON2_MAX_PARALLELISM = 8;
const PEPPER_BYTES = 32;

export class PinPepperUnavailableError extends Error {
  constructor() {
    super("This server can't unlock PIN-protected backups right now. Use your passkey or contact your administrator.");
    this.name = "PinPepperUnavailableError";
  }
}

/** True when a wrap should be refreshed with current KDF settings. */
export function kdfNeedsUpgrade(kdf: KdfParams, pepperAvailable: boolean): boolean {
  if (kdf.name !== "argon2id") return true;
  if (kdf.m < ARGON2_COST.m || kdf.t < ARGON2_COST.t) return true;
  return pepperAvailable && !kdf.pepper;
}

async function deriveKEK(pin: string, kdf: KdfParams, userId: string, pepper: Bytes | null): Promise<CryptoKey> {
  if (kdf.name === "pbkdf2-sha256") {
    const baseKey = await crypto.subtle.importKey("raw", encodeUtf8(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: fromBase64(kdf.salt),
        iterations: kdf.iter,
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  if (kdf.name !== "argon2id") {
    throw new Error(`unsupported kdf: ${String((kdf as { name?: unknown }).name)}`);
  }
  if (
    !Number.isInteger(kdf.m) ||
    !Number.isInteger(kdf.t) ||
    !Number.isInteger(kdf.p) ||
    kdf.m < 8 * kdf.p ||
    kdf.m > ARGON2_MAX_MEMORY_KIB ||
    kdf.t < 1 ||
    kdf.t > ARGON2_MAX_ITERATIONS ||
    kdf.p < 1 ||
    kdf.p > ARGON2_MAX_PARALLELISM
  ) {
    throw new Error("unsupported PIN key parameters");
  }
  if (kdf.pepper && !pepper) throw new PinPepperUnavailableError();

  const { deriveArgon2id } = await import("./argon2");
  const stretched = await deriveArgon2id(encodeUtf8(pin), fromBase64(kdf.salt), kdf);
  const material = await crypto.subtle.importKey("raw", stretched, "HKDF", false, ["deriveKey"]);
  stretched.fill(0);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // The pepper keys HKDF-Extract, so a leaked keystore alone cannot be brute-forced offline.
      salt: kdf.pepper && pepper ? pepper : new Uint8Array(new ArrayBuffer(0)),
      info: encodeUtf8(`wingman:pin:${userId}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface WrappedDek {
  kdf: KdfParams;
  nonce: string; // base64
  wrappedDek: string; // base64
}

export async function wrapDEKWithPin(
  dek: DEK,
  pin: string,
  userId: string,
  pepper: Uint8Array | null = null,
): Promise<WrappedDek> {
  if (pepper && pepper.length !== PEPPER_BYTES) throw new Error("invalid PIN pepper");
  const kdf: Argon2idParams = {
    name: "argon2id",
    salt: toBase64(randomBytes(SALT_BYTES)),
    ...ARGON2_COST,
    ...(pepper ? { pepper: true } : {}),
  };

  const kek = await deriveKEK(pin, kdf, userId, pepper ? bufFrom(pepper) : null);
  const nonce = randomBytes(NONCE_BYTES);

  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encodeUtf8(`keystore:${userId}`) },
      kek,
      bufFrom(dek.raw),
    ),
  );

  return {
    kdf,
    nonce: toBase64(nonce),
    wrappedDek: toBase64(ct),
  };
}

export async function unwrapDEKWithPin(
  w: WrappedDek,
  pin: string,
  userId: string,
  kid = 1,
  pepper: Uint8Array | null = null,
): Promise<DEK> {
  const kek = await deriveKEK(pin, w.kdf, userId, pepper ? bufFrom(pepper) : null);
  const raw = bufFrom(
    new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(w.nonce), additionalData: encodeUtf8(`keystore:${userId}`) },
        kek,
        fromBase64(w.wrappedDek),
      ),
    ),
  );
  if (raw.length !== DEK_BYTES) {
    throw new Error(`unexpected DEK size: ${raw.length}`);
  }
  return { raw, kid };
}

// Event encryption -------------------------------------------------------
//
// Wire format for a "frame" (the base64 payload the server stores):
//   0x02 || kid(1) || nonce(12) || ciphertext || tag(16)
//
// The kid byte is a routing hint, not authenticated data — a tampered kid
// selects the wrong key and the GCM tag check fails, same as any other
// corruption.

async function aesGcmEncryptBytes(dek: StoreKey, plaintext: Uint8Array, aad: string): Promise<Bytes> {
  if (dek.backup) return encryptBackup(dek.backup, dek.kid, plaintext, aad);
  if (!canRestore(dek)) throw new Error("Missing encryption key.");
  const key = await importDekForAesGcm(dek);
  const nonce = randomBytes(NONCE_BYTES);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encodeUtf8(aad) },
      key,
      bufFrom(plaintext),
    ),
  );
  const out = new Uint8Array(new ArrayBuffer(2 + nonce.length + ct.length)) as Bytes;
  out[0] = FRAME_V2;
  out[1] = dek.kid;
  out.set(nonce, 2);
  out.set(ct, 2 + nonce.length);
  return out;
}

async function aesGcmEncrypt(dek: StoreKey, plaintext: Uint8Array, aad: string): Promise<string> {
  return toBase64(await aesGcmEncryptBytes(dek, plaintext, aad));
}

async function aesGcmDecrypt(dek: StoreKey, frame: string, aad: string): Promise<Bytes> {
  return aesGcmDecryptBytes(dek, fromBase64(frame), aad);
}

async function aesGcmDecryptBytes(dek: StoreKey, bytes: Bytes, aad: string): Promise<Bytes> {
  if (bytes[0] === 3) return decryptBackup(dek.backup, dek.kid, bytes, aad);
  if (!canRestore(dek)) throw new Error("Unlock with your PIN or passkey to restore server data.");
  if (bytes.length < 2 + NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error("frame too short");
  }
  if (bytes[0] !== FRAME_V2) {
    throw new Error(`unknown frame version ${bytes[0]}`);
  }
  if (bytes[1] !== dek.kid) {
    throw new Error(`frame encrypted with unknown key id ${bytes[1]} (have ${dek.kid})`);
  }

  const nonce = bufFrom(bytes.slice(2, 2 + NONCE_BYTES));
  const ct = bufFrom(bytes.slice(2 + NONCE_BYTES));
  const key = await importDekForAesGcm(dek);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: encodeUtf8(aad) }, key, ct),
  );
  return bufFrom(pt);
}

function eventAad(userId: string, chatId: string, seq: number): string {
  return `event:${userId}:${chatId}:${seq}`;
}

function blobAad(userId: string, blobId: string): string {
  return `blob:${userId}:${blobId}`;
}

export async function encryptEvent(
  dek: StoreKey,
  payload: unknown,
  userId: string,
  chatId: string,
  seq: number,
): Promise<string> {
  const json = JSON.stringify(payload);
  return aesGcmEncrypt(dek, encodeUtf8(json), eventAad(userId, chatId, seq));
}

export async function decryptEvent<T = unknown>(
  dek: StoreKey,
  frame: string,
  userId: string,
  chatId: string,
  seq: number,
): Promise<T> {
  const pt = await aesGcmDecrypt(dek, frame, eventAad(userId, chatId, seq));
  return JSON.parse(decoder.decode(pt)) as T;
}

export async function encryptBlob(dek: StoreKey, data: Uint8Array, userId: string, blobId: string): Promise<Bytes> {
  return aesGcmEncryptBytes(dek, data, blobAad(userId, blobId));
}

export async function decryptBlob(dek: StoreKey, data: Uint8Array, userId: string, blobId: string): Promise<Bytes> {
  return aesGcmDecryptBytes(dek, bufFrom(data), blobAad(userId, blobId));
}

// File envelope ------------------------------------------------------------
//
// Synced OPFS files travel as one encrypted message whose plaintext is
//   utf8(JSON(header)) || 0x0A || raw file bytes
// The header carries the real path + mtime, so the server only ever sees
// an opaque id and ciphertext.

function fileAad(userId: string, fileId: string): string {
  return `file:${userId}:${fileId}`;
}

export async function encryptFile(
  dek: StoreKey,
  header: unknown,
  bytes: Uint8Array,
  userId: string,
  fileId: string,
): Promise<Bytes> {
  const headerBytes = encodeUtf8(JSON.stringify(header));
  const plaintext = new Uint8Array(new ArrayBuffer(headerBytes.length + 1 + bytes.length));
  plaintext.set(headerBytes, 0);
  plaintext[headerBytes.length] = 0x0a;
  plaintext.set(bytes, headerBytes.length + 1);
  return aesGcmEncryptBytes(dek, plaintext, fileAad(userId, fileId));
}

export async function decryptFile<T>(
  dek: StoreKey,
  data: Uint8Array,
  userId: string,
  fileId: string,
): Promise<{ header: T; bytes: Bytes }> {
  const pt = await aesGcmDecryptBytes(dek, bufFrom(data), fileAad(userId, fileId));
  const nl = pt.indexOf(0x0a);
  if (nl < 0) throw new Error("file envelope: missing header");
  const header = JSON.parse(decoder.decode(pt.slice(0, nl))) as T;
  return { header, bytes: bufFrom(pt.slice(nl + 1)) };
}

// Hash chain --------------------------------------------------------------

export const ZERO_HASH = toBase64(new Uint8Array(new ArrayBuffer(32)));

export async function hashFrame(frame: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(frame));
  return toBase64(new Uint8Array(digest));
}
