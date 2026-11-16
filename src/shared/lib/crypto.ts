/**
 * Client-side crypto primitives for the encrypted chat store.
 *
 * Threat model:
 *   - Server is *not* trusted to read chat contents.
 *   - Account isolation comes from the storage provider (the delegated
 *     Microsoft Graph token), not from this code.
 *   - PIN, when set, protects the DEK against storage-theft scenarios. A PIN
 *     is low-entropy: it is brute-forceable offline
 *     if the wrapped DEK leaks, so Argon2id only raises the cost per guess.
 *
 * Primitives:
 *   - Argon2id (64 MiB, t=3) + HKDF-SHA256 → 256-bit KEK from PIN + salt.
 *   - Events, attachments and files: AES-256-GCM with the root key (DEK) and
 *     a fresh random nonce per item. The DEK is wrapped by PIN or passkey.
 *   - AAD pins identity into ciphertext (accountId:chatId:seq for events,
 *     accountId:blobId for blobs; accountId comes from the keystore).
 *     Wrong AAD ⇒ decrypt fails, so frames cannot be reordered or moved.
 */

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const DEK_BYTES = 32;
const GCM_TAG_BYTES = 16;

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

export interface DEK {
  /** Raw 32-byte key material, used to derive AES-GCM CryptoKeys per call. */
  raw: Bytes;
  key?: never;
}

/**
 * Root key restored from a remembered device. The non-extractable AES-GCM key
 * can decrypt and encrypt, but its bytes can never be read back, so it cannot
 * re-wrap the root for new PIN or passkey protection.
 */
export interface DeviceKey {
  key: CryptoKey;
  raw?: never;
}

export type RootKey = DEK | DeviceKey;

export function hasRawKey(key: RootKey): key is DEK {
  return key.raw !== undefined;
}

export function generateDEK(): DEK {
  return { raw: randomBytes(DEK_BYTES) };
}

/** Import root key bytes as a non-extractable key suitable for device storage. */
export async function toDeviceKey(root: RootKey): Promise<DeviceKey> {
  if (!hasRawKey(root)) return { key: root.key };
  const key = await crypto.subtle.importKey("raw", bufFrom(root.raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { key };
}

async function importDekForAesGcm(dek: RootKey): Promise<CryptoKey> {
  if (!hasRawKey(dek)) return dek.key;
  return crypto.subtle.importKey("raw", bufFrom(dek.raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// KEK from PIN -----------------------------------------------------------

export interface KdfParams {
  name: "argon2id";
  salt: string; // base64
  /** Memory cost in KiB. */
  m: number;
  t: number;
  p: number;
}

const ARGON2_COST = { m: 64 * 1024, t: 3, p: 1 } as const;
// Bound server-supplied parameters so a hostile keystore cannot exhaust the browser.
const ARGON2_MAX_MEMORY_KIB = 256 * 1024;
const ARGON2_MAX_ITERATIONS = 16;
const ARGON2_MAX_PARALLELISM = 8;

async function deriveKEK(pin: string, kdf: KdfParams, userId: string): Promise<CryptoKey> {
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

  const { deriveArgon2id } = await import("./argon2");
  const stretched = await deriveArgon2id(encodeUtf8(pin), fromBase64(kdf.salt), kdf);
  const material = await crypto.subtle.importKey("raw", stretched, "HKDF", false, ["deriveKey"]);
  stretched.fill(0);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(new ArrayBuffer(0)),
      info: encodeUtf8(`wingman:pin:${userId}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

interface WrappedDek {
  kdf: KdfParams;
  nonce: string; // base64
  wrappedDek: string; // base64
}

export async function wrapDEKWithPin(dek: DEK, pin: string, userId: string): Promise<WrappedDek> {
  const kdf: KdfParams = {
    name: "argon2id",
    salt: toBase64(randomBytes(SALT_BYTES)),
    ...ARGON2_COST,
  };

  const kek = await deriveKEK(pin, kdf, userId);
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

export async function unwrapDEKWithPin(w: WrappedDek, pin: string, userId: string): Promise<DEK> {
  const kek = await deriveKEK(pin, w.kdf, userId);
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
  return { raw };
}

// Content encryption -----------------------------------------------------
//
//   nonce(12) || ciphertext || tag(16)

async function seal(root: RootKey, plaintext: Uint8Array, aad: string): Promise<Bytes> {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encodeUtf8(aad) },
      await importDekForAesGcm(root),
      bufFrom(plaintext),
    ),
  );
  const out = new Uint8Array(new ArrayBuffer(nonce.length + ct.length)) as Bytes;
  out.set(nonce);
  out.set(ct, nonce.length);
  return out;
}

async function open(root: RootKey, sealed: Uint8Array, aad: string): Promise<Bytes> {
  if (sealed.length < NONCE_BYTES + GCM_TAG_BYTES) throw new Error("ciphertext too short");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufFrom(sealed.slice(0, NONCE_BYTES)), additionalData: encodeUtf8(aad) },
    await importDekForAesGcm(root),
    bufFrom(sealed.slice(NONCE_BYTES)),
  );
  return new Uint8Array(pt) as Bytes;
}

function eventAad(userId: string, chatId: string, seq: number): string {
  return `event:${userId}:${chatId}:${seq}`;
}

function blobAad(userId: string, blobId: string): string {
  return `blob:${userId}:${blobId}`;
}

export async function encryptEvent(
  dek: RootKey,
  payload: unknown,
  userId: string,
  chatId: string,
  seq: number,
): Promise<string> {
  const json = JSON.stringify(payload);
  return toBase64(await seal(dek, encodeUtf8(json), eventAad(userId, chatId, seq)));
}

export async function decryptEvent<T = unknown>(
  dek: RootKey,
  frame: string,
  userId: string,
  chatId: string,
  seq: number,
): Promise<T> {
  const pt = await open(dek, fromBase64(frame), eventAad(userId, chatId, seq));
  return JSON.parse(decoder.decode(pt)) as T;
}

export async function encryptBlob(dek: RootKey, data: Uint8Array, userId: string, blobId: string): Promise<Bytes> {
  return seal(dek, data, blobAad(userId, blobId));
}

export async function decryptBlob(dek: RootKey, data: Uint8Array, userId: string, blobId: string): Promise<Bytes> {
  return open(dek, bufFrom(data), blobAad(userId, blobId));
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
  dek: RootKey,
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
  return seal(dek, plaintext, fileAad(userId, fileId));
}

export async function decryptFile<T>(
  dek: RootKey,
  data: Uint8Array,
  userId: string,
  fileId: string,
): Promise<{ header: T; bytes: Bytes }> {
  const pt = await open(dek, bufFrom(data), fileAad(userId, fileId));
  const nl = pt.indexOf(0x0a);
  if (nl < 0) throw new Error("file envelope: missing header");
  const header = JSON.parse(decoder.decode(pt.slice(0, nl))) as T;
  return { header, bytes: bufFrom(pt.slice(nl + 1)) };
}
