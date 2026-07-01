/**
 * Client-side crypto primitives for the encrypted chat store.
 *
 * Threat model:
 *   - Server is *not* trusted to read chat contents.
 *   - Server *is* trusted to identify the user (via reverse-proxy headers).
 *   - PIN, when set, protects the DEK against server-disk-theft scenarios.
 *     A PIN is short by definition and trivially brute-forceable if the
 *     wrapped DEK leaks — treat PIN as a speed bump, not a vault.
 *
 * Primitives:
 *   - PBKDF2-SHA256, 600 000 iterations → 256-bit KEK from PIN + salt.
 *   - AES-256-GCM with random 12-byte nonce for both DEK-wrap and event/blob.
 *   - AAD pins identity into ciphertext (userId:chatId:seq for events,
 *     userId:blobId for blobs). Wrong AAD ⇒ decrypt fails.
 *   - Hash chain inside event plaintext (prevHash) lets the client detect
 *     log truncation that the opaque server cannot.
 */

const PBKDF2_ITERATIONS = 600_000;
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

export interface DEK {
  /** Raw 32-byte key material, used to derive AES-GCM CryptoKeys per call. */
  raw: Bytes;
  /** Key id (1–255) stamped into every frame envelope, so the DEK can be
   *  rotated later without guess-decrypting old history. */
  kid: number;
}

export async function generateDEK(kid = 1): Promise<DEK> {
  if (!Number.isInteger(kid) || kid < 1 || kid > 255) throw new Error(`invalid key id: ${kid}`);
  return { raw: randomBytes(DEK_BYTES), kid };
}

async function importDekForAesGcm(dek: DEK): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bufFrom(dek.raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// KEK from PIN -----------------------------------------------------------

export interface KdfParams {
  name: "pbkdf2-sha256";
  salt: string; // base64
  iter: number;
}

async function deriveKEK(pin: string, kdf: KdfParams): Promise<CryptoKey> {
  if (kdf.name !== "pbkdf2-sha256") {
    throw new Error(`unsupported kdf: ${String(kdf.name)}`);
  }

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

export interface WrappedDek {
  kdf: KdfParams;
  nonce: string; // base64
  wrappedDek: string; // base64
}

export async function wrapDEKWithPin(dek: DEK, pin: string, userId: string): Promise<WrappedDek> {
  const kdf: KdfParams = {
    name: "pbkdf2-sha256",
    salt: toBase64(randomBytes(SALT_BYTES)),
    iter: PBKDF2_ITERATIONS,
  };

  const kek = await deriveKEK(pin, kdf);
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

export async function unwrapDEKWithPin(w: WrappedDek, pin: string, userId: string, kid = 1): Promise<DEK> {
  const kek = await deriveKEK(pin, w.kdf);
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
//   v2 (all new writes): 0x02 || kid(1) || nonce(12) || ciphertext || tag(16)
//   v1 (legacy):                          nonce(12) || ciphertext || tag(16)
//
// The kid byte is a routing hint, not authenticated data — a tampered kid
// selects the wrong key and the GCM tag check fails, same as any other
// corruption. Legacy frames have no header; a v1 nonce can start with 0x02
// by chance, so decryption tries the v2 parse first and falls back.

async function aesGcmEncryptBytes(dek: DEK, plaintext: Uint8Array, aad: string): Promise<Bytes> {
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

async function aesGcmEncrypt(dek: DEK, plaintext: Uint8Array, aad: string): Promise<string> {
  return toBase64(await aesGcmEncryptBytes(dek, plaintext, aad));
}

async function aesGcmDecryptAt(dek: DEK, bytes: Bytes, offset: number, aad: string): Promise<Bytes> {
  const nonce = bufFrom(bytes.slice(offset, offset + NONCE_BYTES));
  const ct = bufFrom(bytes.slice(offset + NONCE_BYTES));
  const key = await importDekForAesGcm(dek);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: encodeUtf8(aad) }, key, ct),
  );
  return bufFrom(pt);
}

async function aesGcmDecrypt(dek: DEK, frame: string, aad: string): Promise<Bytes> {
  return aesGcmDecryptBytes(dek, fromBase64(frame), aad);
}

async function aesGcmDecryptBytes(dek: DEK, bytes: Bytes, aad: string): Promise<Bytes> {
  if (bytes.length < NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error("frame too short");
  }

  const isV2 = bytes[0] === FRAME_V2 && bytes.length >= 2 + NONCE_BYTES + GCM_TAG_BYTES;

  if (isV2 && bytes[1] === dek.kid) {
    try {
      return await aesGcmDecryptAt(dek, bytes, 2, aad);
    } catch {
      // Could be a legacy frame whose random nonce starts with 0x02 and
      // whose second byte happens to match the kid — fall through.
    }
  }

  try {
    return await aesGcmDecryptAt(dek, bytes, 0, aad);
  } catch (err) {
    if (isV2 && bytes[1] !== dek.kid) {
      throw new Error(`frame encrypted with unknown key id ${bytes[1]} (have ${dek.kid})`);
    }
    throw err;
  }
}

function eventAad(userId: string, chatId: string, seq: number): string {
  return `event:${userId}:${chatId}:${seq}`;
}

function blobAad(userId: string, blobId: string): string {
  return `blob:${userId}:${blobId}`;
}

export async function encryptEvent(
  dek: DEK,
  payload: unknown,
  userId: string,
  chatId: string,
  seq: number,
): Promise<string> {
  const json = JSON.stringify(payload);
  return aesGcmEncrypt(dek, encodeUtf8(json), eventAad(userId, chatId, seq));
}

export async function decryptEvent<T = unknown>(
  dek: DEK,
  frame: string,
  userId: string,
  chatId: string,
  seq: number,
): Promise<T> {
  const pt = await aesGcmDecrypt(dek, frame, eventAad(userId, chatId, seq));
  return JSON.parse(decoder.decode(pt)) as T;
}

export async function encryptBlob(dek: DEK, data: Uint8Array, userId: string, blobId: string): Promise<Bytes> {
  return aesGcmEncryptBytes(dek, data, blobAad(userId, blobId));
}

export async function decryptBlob(dek: DEK, data: Uint8Array, userId: string, blobId: string): Promise<Bytes> {
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
  dek: DEK,
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
  dek: DEK,
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
